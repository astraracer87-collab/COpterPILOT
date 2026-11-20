import type { CheckResult, FlightVerdict } from "../../shared/checks/types";
import { setSoraLayersAllowed } from "../../shared/geozoneCategories";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Api from "./api";
import { isLoggedInSync, waitForAuthReady } from "./auth";
import { schedulePreflightReminder, cancelPreflightReminder } from "./notifications";
import { DEFAULT_REACHABLE_ALTITUDE_M } from "../../shared/geozoneAltitudeFilter";
import { isDfsZonenEffective } from "./ctrAltitude";
import { migrateCachesToFiles, purgeAsyncStorageCaches, setItemResilient } from "./storageMaintenance";
import { fileCacheStorage, pruneFileCache, purgeFileCache } from "./fileCache";
import { DATA_CACHE_MAX_AGE_MS, DATA_CACHE_PREFIX } from "./dataCache";
import { entryUsesBattery, serialsMatch } from "./djiBatteryLink";
import {
  collectBlobGarbage,
  externalizeBlobs,
  hasInlineBlobs,
  hydrateBlobs,
  hydrateBlobsOne,
  type BlobSpec,
} from "./userBlobs";

function useServer(): boolean {
  return isLoggedInSync();
}

/**
 * Schluckt API-Fehler und fällt auf den Local-Pfad zurück. Genutzt für
 * Lese-Operationen, damit ein vorübergehender Server-Ausfall die App
 * nicht blockt. Schreib-Fehler werden absichtlich propagiert.
 */
async function safeApi<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.warn("[storage] server read failed, using local fallback:", (err as Error).message);
    return null;
  }
}

const BRIEFINGS_KEY = "@preflight/briefings";
const SETTINGS_KEY = "@preflight/settings";
const DRONES_KEY = "@preflight/drones";
const SELECTED_DRONE_KEY = "@preflight/selected_drone";

// ---------------------------------------------------------------------------
// Lokale Server-Snapshots (Offline-Resilienz)
// Wir spiegeln die letzte erfolgreiche Server-Antwort der "User-eigenen"
// Datasets in AsyncStorage. Wenn der Server später unerreichbar ist oder eine
// implausibel leere Antwort liefert (Session-Hiccup, kurzer 500er, …),
// nutzen wir den Snapshot statt dem User leere Listen zu zeigen.
// Jeder Snapshot hat einen Timestamp und eine TTL — danach wird er verworfen.
// ---------------------------------------------------------------------------
const SNAPSHOT_KEYS = {
  drones: "@preflight/snap/drones_v1",
  pilotProfile: "@preflight/snap/pilot_profile_v1",
  settings: "@preflight/snap/settings_v1",
  flightSessions: "@preflight/snap/flight_sessions_v1",
  flightSessionsTrash: "@preflight/snap/flight_sessions_trash_v1",
  logbook: "@preflight/snap/logbook_v1",
  droneHistory: "@preflight/snap/drone_history_v1",
} as const;
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Snapshot<T> {
  data: T;
  fetchedAt: number;
}

async function readSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  const snap = await getLocalData<Snapshot<T>>(key);
  if (!snap || typeof snap.fetchedAt !== "number") return null;
  if (Date.now() - snap.fetchedAt > SNAPSHOT_TTL_MS) return null;
  return snap;
}

async function writeSnapshot<T>(key: string, data: T): Promise<void> {
  try {
    await saveLocalData<Snapshot<T>>(key, { data, fetchedAt: Date.now() });
  } catch {
    // Snapshot ist best-effort.
  }
}

/** Löscht alle gespeicherten Server-Snapshots (z. B. beim Logout). */
async function clearAllSnapshots(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(SNAPSHOT_KEYS));
  } catch {
    // best-effort
  }
}
const FLIGHT_SESSIONS_KEY = "@preflight/flight_sessions";
const LOGBOOK_KEY = "@preflight/logbook";
const DRONE_HISTORY_KEY = "@preflight/drone_history";
const SYNC_STATUS_KEY = "@preflight/sync_status";
const PILOT_PROFILE_KEY = "@preflight/pilot_profile";

// ---------------------------------------------------------------------------
// In-Memory-Cache + In-Flight-Dedup für die "heißen" User-Datasets
// (Drohnen, Pilotenprofil, Settings). Sinn: Wenn `prefetchUserData()` direkt
// nach dem Login bereits einen Request gestartet hat, soll der nachfolgende
// Screen-Mount nicht erneut warten, sondern dieselbe Promise/dasselbe
// Ergebnis bekommen. TTL bewusst kurz (30 s) — der Cache ist eine Brücke
// zwischen Prefetch und Screen, kein Ersatz für eine echte Sync.
// ---------------------------------------------------------------------------
type CacheEntry<T> = { value: T; ts: number };
const PREFETCH_TTL_MS = 30_000;
const memCache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function readCache<T>(key: string): T | undefined {
  const hit = memCache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return undefined;
  if (Date.now() - hit.ts > PREFETCH_TTL_MS) {
    memCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache<T>(key: string, value: T): void {
  memCache.set(key, { value, ts: Date.now() });
}

function invalidateCache(prefix: string): void {
  for (const k of Array.from(memCache.keys())) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
}

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Leert alle In-Memory-Caches UND die persistenten Server-Snapshots
 * (beim Logout aufzurufen — sonst sieht der nächste User auf demselben
 * Gerät bei Server-Hiccup unsere alten Daten).
 */
export function clearUserDataCache(): void {
  memCache.clear();
  inflight.clear();
  void clearAllSnapshots();
  // Offline-Write-Queue gehört zum vorigen User — beim Login/Logout-Wechsel
  // wegwerfen, damit Userin B keine in der Queue liegen gebliebenen Writes
  // von User A unter ihrer Session an den Server schickt.
  void AsyncStorage.removeItem(WRITE_QUEUE_KEY).catch(() => undefined);
}

/**
 * Soft-Invalidate: nur In-Memory-Cache leeren, Snapshots beibehalten.
 * Aufzurufen wenn die App in den Vordergrund kommt oder das Netz wieder
 * verfügbar ist — die nächste Lese-Operation holt frische Daten vom Server
 * (und damit auch Änderungen, die in der Zwischenzeit über die Web-Version
 * gemacht wurden). Schlägt der Server fehl, wird auf den Snapshot
 * zurückgefallen.
 */
export function refreshUserDataCache(): void {
  memCache.clear();
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Offline Write Queue
// Wenn der User offline ist oder das Netz mitten in einem Save abreißt,
// puffern wir die Schreib-Operation in AsyncStorage und führen sie aus,
// sobald die App wieder Verbindung hat (Foreground / nächste manuelle Op).
// Bis dahin wird der lokale Snapshot optimistisch aktualisiert, damit der
// User seine Änderungen sofort sieht. Temp-IDs (Präfix "temp_") werden beim
// Flush durch die echten Server-IDs ersetzt, auch in nachgelagerten Ops.
// ---------------------------------------------------------------------------
const WRITE_QUEUE_KEY = "@preflight/write_queue_v1";
const TEMP_ID_PREFIX = "temp_";

// Serialisiert AsyncStorage Read-Modify-Write-Zyklen (Queue + Drohnen-Snapshot).
// Ohne diesen Mutex könnten zwei parallel laufende Mutations (saveDrone +
// updateDrone) den jeweils anderen Schreibvorgang überschreiben, weil
// AsyncStorage zwar atomar pro Key ist, aber kein RMW-Locking anbietet.
let storageMutex: Promise<unknown> = Promise.resolve();
function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = storageMutex.then(fn, fn);
  storageMutex = next.catch(() => undefined);
  return next;
}

type QueuedOp =
  | { kind: "drone.create"; tempId: string; payload: Partial<DroneProfile>; ts: number }
  | { kind: "drone.update"; id: string; updates: Partial<DroneProfile>; ts: number }
  | { kind: "drone.delete"; id: string; ts: number };

async function readWriteQueue(): Promise<QueuedOp[]> {
  return (await getLocalData<QueuedOp[]>(WRITE_QUEUE_KEY)) || [];
}

async function writeWriteQueue(q: QueuedOp[]): Promise<void> {
  await saveLocalData(WRITE_QUEUE_KEY, q);
}

async function enqueueWrite(op: QueuedOp): Promise<void> {
  await withStorageLock(async () => {
    const q = await readWriteQueue();
    q.push(op);
    await writeWriteQueue(q);
  });
}

function isNetworkError(err: unknown): boolean {
  // ApiError = HTTP-Antwort vom Server (4xx/5xx) — Request ist angekommen,
  // Re-Try würde nichts ändern. Alles andere (TypeError "Network request
  // failed", AbortError vom Timeout, DNS-Fehler, …) ist ein Verbindungs-
  // Problem und qualifiziert für die Offline-Queue.
  const ApiErrorCtor = (Api as unknown as { ApiError?: typeof Error }).ApiError;
  if (ApiErrorCtor && err instanceof ApiErrorCtor) return false;
  return true;
}

async function mergeDroneIntoSnapshot(drone: DroneProfile): Promise<void> {
  await withStorageLock(async () => {
    const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
    const list = snap && Array.isArray(snap.data) ? [...snap.data] : [];
    const idx = list.findIndex((d) => d.id === drone.id);
    if (idx === -1) list.unshift(drone);
    else list[idx] = drone;
    await writeSnapshot(SNAPSHOT_KEYS.drones, list);
  });
}

async function patchDroneInSnapshot(id: string, updates: Partial<DroneProfile>): Promise<void> {
  await withStorageLock(async () => {
    const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
    if (!snap || !Array.isArray(snap.data)) return;
    const now = new Date().toISOString();
    const list = snap.data.map((d) => (d.id === id ? { ...d, ...updates, updatedAt: now } : d));
    await writeSnapshot(SNAPSHOT_KEYS.drones, list);
  });
}

async function removeDroneFromSnapshot(id: string): Promise<void> {
  await withStorageLock(async () => {
    const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
    if (!snap || !Array.isArray(snap.data)) return;
    await writeSnapshot(SNAPSHOT_KEYS.drones, snap.data.filter((d) => d.id !== id));
  });
}

async function replaceDroneInSnapshot(oldId: string, newDrone: DroneProfile): Promise<void> {
  await withStorageLock(async () => {
    const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
    if (!snap || !Array.isArray(snap.data)) {
      await writeSnapshot(SNAPSHOT_KEYS.drones, [newDrone]);
      return;
    }
    const list = snap.data.map((d) => (d.id === oldId ? newDrone : d));
    if (!list.some((d) => d.id === newDrone.id)) list.unshift(newDrone);
    await writeSnapshot(SNAPSHOT_KEYS.drones, list);
  });
}

async function getPendingOptimisticDrones(): Promise<DroneProfile[]> {
  const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
  if (!snap || !Array.isArray(snap.data)) return [];
  return snap.data.filter((d) => typeof d.id === "string" && d.id.startsWith(TEMP_ID_PREFIX));
}

let flushPromise: Promise<void> | null = null;

/**
 * Drained die Offline-Schreib-Queue gegen den Server. Idempotent + safe
 * gegen parallele Aufrufe (nur ein Flush gleichzeitig). Wird automatisch
 * von App.tsx beim Foreground-Wechsel und nach Login aufgerufen.
 */
export function flushWriteQueue(): Promise<void> {
  if (flushPromise) return flushPromise;
  flushPromise = doFlushWriteQueue().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

async function doFlushWriteQueue(): Promise<void> {
  await waitForAuthReady();
  if (!useServer()) return;
  const queue = await readWriteQueue();
  if (queue.length === 0) return;
  const idMap: Record<string, string> = {};
  const remaining: QueuedOp[] = [];
  let dronesTouched = false;
  for (let i = 0; i < queue.length; i++) {
    const op = queue[i];
    try {
      if (op.kind === "drone.create") {
        const created = await Api.apiCreateDrone(op.payload);
        const normalized = normalizeDroneShape(created);
        idMap[op.tempId] = normalized.id;
        await replaceDroneInSnapshot(op.tempId, normalized);
        dronesTouched = true;
      } else if (op.kind === "drone.update") {
        const realId = idMap[op.id] ?? op.id;
        await Api.apiUpdateDrone(realId, op.updates);
        dronesTouched = true;
      } else if (op.kind === "drone.delete") {
        const realId = idMap[op.id] ?? op.id;
        await Api.apiDeleteDrone(realId);
        await removeDroneFromSnapshot(realId);
        dronesTouched = true;
      }
    } catch (e) {
      if (isNetworkError(e)) {
        // Netz wieder weg — Rest in der Queue lassen, Reihenfolge erhalten.
        remaining.push(...queue.slice(i));
        break;
      }
      // Permanenter Server-Fehler — Op verwerfen, Snapshot aufräumen,
      // damit der User keinen ewigen Phantom-Eintrag sieht.
      console.warn("[writeQueue] drop op (permanent error):", op.kind, e);
      if (op.kind === "drone.create") {
        await removeDroneFromSnapshot(op.tempId);
      }
    }
  }
  await writeWriteQueue(remaining);
  if (dronesTouched) {
    invalidateCache("drones:");
  }
}

async function getLocalData<T>(key: string): Promise<T | null> {
  try {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Lesen für Read-Modify-Write: anders als getLocalData wird ein Lesefehler
 * (z. B. Wert zu groß fürs Android-CursorWindow) NICHT als „leer“ gewertet –
 * sonst würde das anschließende Speichern alle vorhandenen Datensätze durch
 * eine Liste mit nur dem neuen Eintrag ersetzen.
 */
async function getLocalDataForWrite<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Gespeicherte Daten (${key}) sind beschädigt und werden nicht überschrieben.`);
  }
}

// Große Felder (Karten-Snapshots, Base64) liegen als Dateien (userBlobs.ts),
// im AsyncStorage-Wert steht nur ein Verweis. Hält flight_sessions/logbook klein.
export const SESSION_BLOB_SPEC: BlobSpec = {
  ns: "sessions",
  fields: [["mapSnapshotBase64"], ["trafficLog", "mapSnapshotBase64"]],
};
export const LOGBOOK_BLOB_SPEC: BlobSpec = {
  ns: "logbook",
  fields: [
    ["mapSnapshotBase64"],
    ["routeMapSnapshotBase64"],
    ["mapSatelliteSnapshotBase64"],
    ["routeMapSatelliteSnapshotBase64"],
    ["trafficLog", "mapSnapshotBase64"],
  ],
  // Ausgewertete DJI-Flugprotokolle (Track, Detailzeilen, Meldungen) und
  // GPS-Tracks: als JSON-Datei statt im AsyncStorage-Wert (CursorWindow ~2 MB).
  jsonFields: [["djiLogs"], ["djiLog"], ["gpsTrack"]],
};
const BLOB_SPECS: Record<string, BlobSpec> = {
  [FLIGHT_SESSIONS_KEY]: SESSION_BLOB_SPEC,
  [LOGBOOK_KEY]: LOGBOOK_BLOB_SPEC,
};

/** Alle re-fetchbaren Caches leeren (AsyncStorage + Datei-Cache), nie Nutzerdaten. */
export async function purgeAllCaches(): Promise<void> {
  await purgeAsyncStorageCaches(AsyncStorage);
  await purgeFileCache();
}

/** setItem für Nutzerdaten: bei vollem Speicher Caches leeren und einmal neu versuchen. */
async function setUserItem(key: string, value: string): Promise<void> {
  await setItemResilient(AsyncStorage, key, value, purgeAllCaches);
}

async function saveLocalData<T>(key: string, data: T): Promise<void> {
  const spec = BLOB_SPECS[key];
  const toStore = spec && Array.isArray(data) ? await externalizeBlobs(spec, data) : data;
  await setUserItem(key, JSON.stringify(toStore));
}

// Read-Modify-Write je Schlüssel serialisieren (sonst überschreiben sich
// parallele Änderungen, z. B. Start-Wartung und neue Session).
const keyLocks = new Map<string, Promise<unknown>>();
function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  keyLocks.set(key, next.catch(() => undefined));
  return next;
}

/**
 * Liste unter `key` lesen (strikt), mit `fn` ändern und speichern – unter
 * Sperre. `fn` liefert die neue Liste bzw. null (= nichts speichern).
 */
async function mutateLocalList<T, R>(
  key: string,
  fn: (list: T[]) => { list: T[] | null; result: R },
): Promise<R> {
  return withKeyLock(key, async () => {
    const current = (await getLocalDataForWrite<T[]>(key)) || [];
    const { list, result } = fn(current);
    if (list) await saveLocalData(key, list);
    return result;
  });
}

export interface AssessmentReason {
  type: "go" | "caution" | "nogo";
  message: string;
}

export interface WindAtAltitudeSnapshot {
  height: number;
  speed: number;
  gust?: number;
  direction: number;
}

export interface ValueAtAltitudeSnapshot {
  height: number;
  value: number;
}

export interface WeatherSnapshot {
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
  kpIndex?: number;
  windAtAltitude?: WindAtAltitudeSnapshot[];
  temperatureAtAltitude?: ValueAtAltitudeSnapshot[];
  /** Teil A: Vorhersage aus dem Offline-Speicher (Abrufzeit), „Offline-Vorhersage von HH:MM“. */
  offline?: { fetchedAt: number; cached: boolean };
}

export interface Briefing {
  id: string;
  createdAt: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  countryIso?: string;
  mapUrl?: string;
  status: "go" | "caution" | "nogo";
  hasRestrictions: boolean;
  restrictionNotes?: string;
  weatherData?: WeatherSnapshot;
  reasons?: AssessmentReason[];
  completed: boolean;
  droneId?: string;
}

export interface WeatherLimits {
  maxWind: number;
  maxGusts: number;
  maxRain: number;
  minTemp: number;
  maxTemp?: number;
  minCloudCeiling: number;
  minVisibility: number;
}

export type DroneClass = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "legacy";
export type DroneType = "selfie" | "standard" | "fpv_only" | "hybrid_fpv";
export type OpenCategory = "A1" | "A2" | "A3";

export interface DroneCompliance {
  operatorRegistered: boolean;
  eIdLabeledOnDrone: boolean;
  insuranceActive: boolean;
  competencyA1A3: boolean;
  certificateA2: boolean;
  remoteIdConfigured: boolean;
}

export interface PilotCompliance {
  insuranceActive: boolean;
  operatorRegistered: boolean;
  competencyA1A3: boolean;
  certificateA2: boolean;
}

export interface DroneBattery {
  id: string;
  name: string;
  serialNumber: string;
  createdAt: string;
  /** Ladezyklen laut letztem DJI-Flugprotokoll (optional, ältere Daten ohne). */
  cycleCount?: number;
  /** Zuletzt in einem DJI-Flugprotokoll gesehen (ISO). */
  lastSeenAt?: string;
  /** "dji-log": automatisch aus einem Flugprotokoll angelegt. */
  source?: "manual" | "dji-log";
}

export interface BatteryUsage {
  batteryId: string;
  name: string;
  serialNumber: string;
  /** Vor dem Start (Pre-Check): typischerweise 100 %. */
  percentBefore?: number;
  /** Nach der Landung (Debriefing): Restkapazität in %. */
  percentAfter?: number;
}

export interface DroneProfile {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  /** Optionale Seriennummer der Drohne (vom Hersteller-Aufkleber oder
   *  DJI-/UAS-Display). Wird in Logbuch-PDFs mitgeführt. */
  serialNumber?: string;
  /** AlphaTango-FRA-Nummer der Drohne (FR-Registrierung, Format
   *  z.B. "FRA-XXXXXX"). Wird im Flugprotokoll für Frankreich-Flüge
   *  ausgegeben und muss laut DGAC an der Drohne angebracht sein. */
  alphaTangoId?: string;
  /** Ablaufdatum der AlphaTango-Registrierung (TT.MM.JJJJ).
   *  Wird vom Expiry-Warner verwendet, um den Piloten rechtzeitig zu warnen. */
  alphaTangoExpirationDate?: string;
  /** Hinterlegte AlphaTango-Registrierung (FR, ab MTOM 800 g Pflicht).
   *  Als base64 gespeichertes PDF/Bild — siehe DocumentRef. */
  alphaTangoDocument?: import("./documents").DocumentRef | null;
  /** Hinterlegter D-Flight QR-Code (IT, kostenpflichtig ca. 6 EUR).
   *  Als base64 gespeichertes PDF/Bild — siehe DocumentRef. */
  dflightDocument?: import("./documents").DocumentRef | null;
  classMark: DroneClass;
  mtomGrams: number;
  hasCameraOrSensor: boolean;
  droneType: DroneType;
  openCategory: OpenCategory;
  hasRemoteId: boolean;
  altitudeLocked120m: boolean;
  /** Optionale Akku-Verwaltung pro Drohne. Wenn gesetzt, zeigen Pre-Check
   *  und Debriefing pro Akku Auswahl + Prozentwert. */
  batteries?: DroneBattery[];
  /**
   * Charakteristische Dimension (CD) in Metern – Diagonale zwischen den
   * Rotorspitzen (Multicopter) bzw. Spannweite (Starrflügler). Grundlage
   * für die VLOS-Berechnung nach EASA Issue 2 (04.10.2024).
   */
  charDimensionM?: number;
  /**
   * Tatsächlich vorhandene ND-Filter des Piloten (z. B. ["ND8","ND16","ND128"]).
   * Wenn gesetzt, überschreibt diese Liste das Hersteller-Ökosystem des Presets
   * im ND-Filter Finder. Leer/undef = kein eigener Bestand definiert.
   */
  ownedNdFilters?: string[];
  /** Zugeordnetes Ladegerät (Bluetooth-Adresse des ISDT MA331) */
  chargerMac?: string;
  compliance: DroneCompliance;
  limits: WeatherLimits;
  createdAt: string;
  updatedAt: string;
  /**
   * Soft-Archiv: ISO-Datum, wann die Drohne archiviert wurde.
   * null/undefined = aktive Drohne. Archivierte Drohnen erscheinen nur
   * im Archiv-Bereich, ihre Historie & Logbuch-Verlinkungen bleiben
   * erhalten.
   */
  archivedAt?: string | null;
  /** Lost & Found: pro Drohne ein optionaler öffentlicher Token. Wenn
   *  aktiviert, erreichbar unter /found/:foundToken — Finder können dem
   *  Piloten Kontakt + Fundort schicken. eID/Operator-ID werden niemals
   *  veröffentlicht. */
  foundEnabled?: boolean;
  foundToken?: string | null;
  foundDisplayName?: string | null;
  foundContactEmail?: string | null;
  foundContactPhone?: string | null;
  foundCustomMessage?: string | null;
}

export interface DroneFoundReport {
  id: string;
  droneId: string;
  userId: string;
  createdAt: string;
  finderName?: string | null;
  finderContact?: string | null;
  message?: string | null;
  lat?: number | null;
  lon?: number | null;
  readAt?: string | null;
}

export interface TcasLevelSettings {
  radiusKm: number;
  visual: boolean;
  audio: boolean;
  haptic: boolean;
}

export interface ProximityAlarmSettings {
  enabled: boolean;
  maxAltitudeM: number;
  radiusKm: number;
  approachRadiusM: number;
  ta: TcasLevelSettings;
  ra: TcasLevelSettings;
  tcasTimeEnabled: boolean;
  taTimeSec: number;
  raTimeSec: number;
  taTimeEnabled?: boolean;
  raTimeEnabled?: boolean;
}

export interface Settings {
  windUnit: "m/s" | "km/h";
  tempUnit: "C" | "F";
  limits: WeatherLimits;
  preferGermany: boolean;
  /**
   * ISO-2 Code des Landes, in dem der Pilot fliegt.
   * Steuert Karten-Zentrierung, NOTAM/Geozonen-Filter und Standard-Vorauswahl
   * in Flugplanung & Pre-Check. Default: "DE".
   */
  preferredCountryIso: string;
  /** ISO-Codes (Großbuchstaben) der vom Pilot favorisierten Länder. Werden in
   * Country-Pickern zuoberst sortiert. Default: leer. */
  favoriteCountries?: string[];
  /** Wie oft der Pilot ein Land schon ausgewählt hat — bestimmt die Reihenfolge
   * im Country-Picker (Most-Used zuerst, nach Favoriten). */
  countryUsageCounts?: Record<string, number>;
  proximityAlarm: ProximityAlarmSettings;
  geozoneSettings?: Record<string, Record<string, boolean>>;
  /** Wenn true (Default), wird in der Flugplanung für Länder MIT eigenen
   * Geozonen-Daten ZUSÄTZLICH die offizielle Staatskarte als Gegenprüfung
   * angeboten (nach dem eigenen Overlay). Aus = Gegenprüfung wird für solche
   * Länder übersprungen. Für Länder OHNE eigene Daten ist die offizielle Karte
   * immer Pflicht, unabhängig von dieser Einstellung. */
  officialMapCrossCheck?: boolean;
  /** Wenn true (Default), werden beim PDF-Export von Flugprotokollen die zum
   * Flugzeitpunkt gültigen Pilotendokumente (Allgemeinverfügung, A2-Zeugnis,
   * Versicherungsnachweis) standardmäßig mit angehängt. Pro Export überschreibbar. */
  attachPilotDocsToExports?: boolean;
  /** @deprecated Früherer „Wildtierretter-Modus“ (entfernt). Bleibt nur als
   *  optionales Feld, damit alte gespeicherte Einstellungen typkonform laden;
   *  wird nirgends mehr gelesen oder geschrieben. */
  wildlifeRescueMode?: boolean;
}

export type SessionPhase = "planning" | "preflight" | "hover" | "postlanding" | "debriefing" | "completed";

export interface PlanningData {
  plannedDate: string;
  plannedTime: string;
  /** Geplante Endzeit "HH:MM". Liegt sie vor/gleich plannedTime, endet der
   *  Flug am Folgetag (siehe shared/flightWindow.ts). Optional für Altbestände. */
  plannedEndTime?: string;
  flightPurpose?: string;
  maxAltitude?: number;
  maxDistance?: number;
  radiusKm?: number;
  /** Empfohlener VLOS-Radius in Metern auf Basis der charakteristischen
   *  Dimension der Drohne (EASA: VLOS = min(ALOS, DLOS)). */
  recommendedVlosM?: number;
  /** True, wenn der Planungsradius die aktive VLOS-Grenze überschreitet
   *  (direkte Distanz oder optional höhenkorrigierter horizontaler Richtwert). */
  vlosExceeded?: boolean;
  /** Snapshot der CD, mit der die VLOS berechnet wurde (m). */
  vlosCharDimensionM?: number;
  /** Ob die Flugplanung den horizontalen Radius anhand der geplanten Höhe
   *  geometrisch korrigiert; optional für Altbestände, Default aus = false. */
  vlosAltitudeCorrection?: boolean;
  /** Höhenkorrigierter horizontaler Planungsrichtwert (m), Snapshot. */
  vlosHorizontalLimitM?: number;
  estimatedDuration?: number;
  routeDescription?: string;
  forecastWeather?: WeatherSnapshot;
  checklistCompleted: string[];
  checklistPresented?: string[];
  isFpvFlight?: boolean;
  /** FPV-Modus: "spotter" (Standard, bis 120 m) oder "verband30m"
   *  (DMFV/DMO Verbandsbetriebserlaubnis nach Art. 16 EU-VO, max. 30 m, ohne Spotter). */
  fpvMode?: "spotter" | "verband30m";
  /** Wenn der Pilot trotz NO-GO-Status (z.B. verbotener Nachtflug) die Planung
   *  bewusst freigegeben hat — wird im Logbuch dokumentiert. */
  noGoOverride?: {
    acknowledgedAt: string;
    reasons: string[];
    originalStatus: "go" | "caution" | "nogo";
  };
  /** Drohnen-Snapshots (zum Planungszeitpunkt eingefroren) — werden im
   *  Flugprotokoll ausgegeben und überleben spätere Drohnen-Änderungen. */
  droneSerialNumber?: string;
  droneAlphaTangoId?: string;
  /** Pilot ist in FR mit MTOM >= 800 g geflogen OBWOHL keine
   *  AlphaTango-ID hinterlegt war (Override per Bestätigungsdialog). */
  alphaTangoMissingAcknowledged?: boolean;
  /** Gegenprüfung der offiziellen Staatskarte (Länder mit eigenen Geozonen-
   *  Daten): Der Pilot hat zusätzlich die offizielle Karte geprüft und
   *  angegeben, ob dort startverhindernde Geozonen liegen. Läuft separat von
   *  der automatischen Geozonen-/§21h-Erkennung. */
  officialMapCrossCheck?: { blocking: boolean; note?: string };
  /** NOTAM-Abfrage bei der Planung fehlgeschlagen (z. B. HTTP 401): Status
   *  unbekannt -> zählt im Ergebnis NICHT als sauberes "keine NOTAMs". */
  notamStatusUnknown?: boolean;
}

export interface PreflightData {
  actualWeather?: WeatherSnapshot;
  checklistCompleted: string[];
  checklistPresented?: string[];
  equipmentNotes?: string;
  completedAt?: string;
  /** Pro Flug erfasste Akku-Auswahl mit Anfangs-Prozenten (Pre-Check). */
  batteryUsage?: BatteryUsage[];
  /** CTR-Wetternachweis: METAR des zuständigen CTR-Flughafens + VMC-Prüfung
   *  gegen die Allgemeinverfügung. Nur gesetzt, wenn der Flugstandort in einer
   *  Kontrollzone liegt. */
  ctrWeather?: CtrWeatherSnapshot;
}

/**
 * Wetter-/VMC-Nachweis für einen Flug innerhalb einer CTR. Enthält die METAR des
 * zuständigen Flughafens und das Ergebnis der VMC-Prüfung gegen dessen
 * Allgemeinverfügung. Wird im Flugprotokoll-PDF als CTR-Wetternachweis ausgegeben.
 */
export interface CtrWeatherSnapshot {
  icao: string;
  airportName: string;
  ctrName: string;
  distanceKm: number;
  observedAt?: string | null;
  /** Roh-METAR (leer, falls nicht abrufbar). */
  raw?: string;
  visibilityM?: number | null;
  ceilingFt?: number | null;
  phenomenaText?: string | null;
  model: "dfs2026zonen" | "dfs2026" | "legacy50m";
  minVisibilityKm: number;
  minCeilingFt?: number | null;
  /** true = VMC erfüllt, false = nicht erfüllt, null = nicht verifizierbar. */
  vmcCompliant: boolean | null;
  vmcReasons?: string[];
  avReference?: string;
  avProvider?: string;
  /** False, wenn keine METAR abrufbar war (Section trotzdem als Nachweis dokumentieren). */
  metarAvailable: boolean;
}

export interface HoverCheckData {
  checklistCompleted?: string[];
  controlsOk?: boolean;
  signalOk?: boolean;
  hoverStable?: boolean;
  takeoffTime?: string;
  landingTime?: string;
  skippedFlightCheck?: boolean;
}

export interface PostLandingData {
  checklistCompleted: string[];
  uasPoweredOff: boolean;
  controllerPoweredOff: boolean;
  damageChecked: boolean;
}

export interface DebriefingData {
  flightDurationMinutes?: number;
  takeoffTime?: string;
  landingTime?: string;
  incidentOccurred: boolean;
  incidentDescription?: string;
  maintenanceRequired: boolean;
  maintenanceNotes?: string;
  generalNotes?: string;
  batteryUsedPercent?: number;
  checklistCompleted?: string[];
  /** Pro Flug erfasste Akku-Auswahl mit End-Prozenten (Debriefing).
   *  Wenn vorhanden, ist `batteryUsedPercent` zweitrangig. */
  batteryUsage?: BatteryUsage[];
}

export interface TrafficLogData {
  startTime: number;
  endTime: number | null;
  centerLatitude: number;
  centerLongitude: number;
  innerRadiusM: number;
  outerRadiusM: number;
  aircraft: Array<{
    icao24: string;
    callsign: string;
    firstSeen: number;
    lastSeen: number;
    minAltitudeM: number;
    maxAltitudeM: number;
    closestDistanceKm: number;
    zone: "inner" | "outer" | "approach";
    trail: Array<{
      latitude: number;
      longitude: number;
      altitudeM: number;
      timestamp: number;
      speedKmh?: number;
      heading?: number;
    }>;
  }>;
  mapSnapshotBase64?: string;
}

export interface FlightSession {
  id: string;
  droneId: string;
  createdAt: string;
  updatedAt: string;
  currentPhase: SessionPhase;
  latitude: number;
  longitude: number;
  locationName?: string;
  countryIso?: string;
  mapUrl?: string;
  hasRestrictions: boolean;
  /** Ergebnis der Einschränkungs-Stufe (PlanningRestrictions): "approved" =
   *  Genehmigung/AV/Ausnahme deckt alle Zonen, "limited" = Flug mit Auflagen,
   *  undefined bei hasRestrictions=true = Status ungeklärt (→ mind. CAUTION). */
  restrictionStatus?: "approved" | "limited";
  restrictionNotes?: string;
  /** Höchstes Policy-Urteil der Geozonen (shared/restrictionPolicy):
   *  "nogo" = aktive Flugverbotszone ohne dokumentierte Begründung → NO-GO. */
  restrictionVerdict?: "nogo" | "caution" | "info";
  /** Prüfkette (B4, shared/checks): alle Befunde der Planung bzw. des
   *  Pre-Checks (Geozonen, Abdeckung, NOTAM, Wetter, Nacht …), je Befund mit
   *  Kontext. Die Felder hasRestrictions/restrictionStatus/restrictionVerdict
   *  bleiben für Logbuch/PDF und Altdaten befüllt. */
  checkResults?: CheckResult[];
  /** Gesamturteil aus aggregate(checkResults) – ohne Pilot-Übersteuerung
   *  (die steht in planning.noGoOverride). */
  verdict?: FlightVerdict;
  detectedGeozones?: string[];
  savedGeozoneFeatures?: SavedGeozoneFeature[];
  savedDipulRestrictions?: SavedDipulRestriction[];
  status: "go" | "caution" | "nogo";
  reasons?: AssessmentReason[];
  planning?: PlanningData;
  preflight?: PreflightData;
  hoverCheck?: HoverCheckData;
  postLanding?: PostLandingData;
  debriefing?: DebriefingData;
  trafficLog?: TrafficLogData;
  /** Base64-PNG-Snapshot des geplanten Fluggebiets (Karte mit Standort + Radius), aufgenommen im Pre-Check. */
  mapSnapshotBase64?: string;
}

export interface SavedGeozoneFeature {
  layerLabel: string;
  name: string;
  details: string;
}

export interface SavedDipulRestriction {
  id: string;
  name: string;
  names: string[];
  category: "military" | "notam" | "nature" | "other";
  legalRef: string;
  legalExplanation: string;
  lowerAlt: number;
  lowerAltRef: string;
  upperAlt: number;
  upperAltRef: string;
  status: "active" | "upcoming";
  startTs: string | null;
  endTs: string | null;
  endTsIndefinite: boolean;
}

export interface GpsTrackPoint {
  lat: number;
  lon: number;
  alt?: number;
  ts?: number;
}

// DJI-Flugprotokoll-Typen: eine Quelle (djiLogCore.ts, RN-frei), hier re-exportiert.
export type { DjiLogRecord, DjiLogMessage, DjiLogMeta } from "./djiLogCore";
import type { DjiLogMeta } from "./djiLogCore";

export interface LogbookEntry {
  id: string;
  sessionId: string;
  droneId: string;
  droneName: string;
  droneClass: DroneClass;
  createdAt: string;
  flightDate: string;
  /** Beim Anlegen erkanntes Bundesland (für die flugzeitgenaue AV-Zuordnung). */
  bundesland?: string | null;
  locationName?: string;
  latitude: number;
  longitude: number;
  takeoffTime?: string;
  landingTime?: string;
  flightDurationMinutes?: number;
  maxAltitude?: number;
  weatherConditions?: WeatherSnapshot;
  incidentOccurred: boolean;
  incidentDescription?: string;
  maintenanceRequired: boolean;
  maintenanceNotes?: string;
  notes?: string;
  planning?: PlanningData;
  preflight?: PreflightData;
  hoverCheck?: HoverCheckData;
  postLanding?: PostLandingData;
  debriefing?: DebriefingData;
  hasRestrictions?: boolean;
  restrictionNotes?: string;
  detectedGeozones?: string[];
  savedGeozoneFeatures?: SavedGeozoneFeature[];
  savedDipulRestrictions?: SavedDipulRestriction[];
  status?: "go" | "caution" | "nogo";
  trafficLog?: TrafficLogData;
  /** GPS-Track des Fluges (aus App-Aufzeichnung ODER hochgeladenem DJI-Log). */
  gpsTrack?: GpsTrackPoint[];
  /** Metadaten + Auswertungsstatus eines hochgeladenen DJI-Controller-Flugprotokolls (Legacy, einzeln). */
  djiLog?: DjiLogMeta;
  /** Mehrere DJI-Logs pro Flug (Akku-Tausch), chronologisch sortiert. */
  djiLogs?: DjiLogMeta[];
  /** Base64-PNG-Snapshot des geplanten Fluggebiets — übernommen aus FlightSession beim Logbuch-Eintrag. */
  mapSnapshotBase64?: string;
  /** Base64-PNG-Snapshot der Karte mit Geozonen-Overlay + tatsächlicher Flugroute (in der Detailansicht erfasst). */
  routeMapSnapshotBase64?: string;
  /** Satelliten-Variante des geplanten Fluggebiets (fürs Protokoll-PDF). */
  mapSatelliteSnapshotBase64?: string;
  /** Satelliten-Variante der Flugroute mit Geozonen-Overlay (fürs Protokoll-PDF). */
  routeMapSatelliteSnapshotBase64?: string;
  /** Öffentliche Freigabe der Web-Protokoll-Ansicht aktiv (Standard: aus). */
  shareEnabled?: boolean;
  /** Schwer erratbares Token für den öffentlichen Freigabe-Link. */
  shareToken?: string | null;
  /** @deprecated Altdaten des entfernten „Wildtierretter-Modus“. Nur optional
   *  behalten, damit ältere Logbucheinträge unverändert laden; wird ignoriert. */
  wildlifeRescueAtFlight?: boolean | null;
  /** @deprecated siehe wildlifeRescueAtFlight – wird ignoriert. */
  wildlifeRescueOrdinanceIds?: string[] | null;
}

/**
 * Liefert die DJI-Logs eines Eintrags als Liste — rückwärtskompatibel: nutzt
 * `djiLogs` falls vorhanden, sonst das Legacy-Einzelfeld `djiLog`. Sortiert
 * chronologisch nach erstem Track-Zeitstempel bzw. Upload-Zeit.
 */
export function getEntryDjiLogs(entry: {
  djiLogs?: DjiLogMeta[];
  djiLog?: DjiLogMeta;
}): DjiLogMeta[] {
  const list =
    entry.djiLogs && entry.djiLogs.length > 0
      ? entry.djiLogs
      : entry.djiLog
        ? [entry.djiLog]
        : [];
  return sortDjiLogs(list);
}

/** Chronologische Sortierung: erster Track-ts, sonst uploadedAt/parsedAt. */
export function sortDjiLogs(logs: DjiLogMeta[]): DjiLogMeta[] {
  const key = (l: DjiLogMeta): number => {
    const ts = l.track?.find((p) => typeof p.ts === "number")?.ts;
    if (typeof ts === "number") return ts;
    const u = l.uploadedAt ? Date.parse(l.uploadedAt) : NaN;
    if (!isNaN(u)) return u;
    const p = l.parsedAt ? Date.parse(l.parsedAt) : NaN;
    return isNaN(p) ? 0 : p;
  };
  return [...logs].sort((a, b) => key(a) - key(b));
}

export const DEFAULT_LIMITS: WeatherLimits = {
  maxWind: 10,
  maxGusts: 12,
  maxRain: 0.5,
  minTemp: 0,
  maxTemp: 40,
  minCloudCeiling: 120,
  minVisibility: 1500,
};

export const DEFAULT_PROXIMITY_ALARM: ProximityAlarmSettings = {
  enabled: true,
  maxAltitudeM: 500,
  radiusKm: 5,
  approachRadiusM: 2000,
  ta: { radiusKm: 3, visual: true, audio: true, haptic: true },
  ra: { radiusKm: 1, visual: true, audio: true, haptic: true },
  tcasTimeEnabled: true,
  taTimeSec: 40,
  raTimeSec: 30,
  taTimeEnabled: true,
  raTimeEnabled: true,
};

export const DEFAULT_SETTINGS: Settings = {
  windUnit: "m/s",
  tempUnit: "C",
  limits: DEFAULT_LIMITS,
  preferGermany: true,
  preferredCountryIso: "DE",
  favoriteCountries: [],
  countryUsageCounts: {},
  proximityAlarm: DEFAULT_PROXIMITY_ALARM,
  officialMapCrossCheck: true,
  attachPilotDocsToExports: true,
};

export const DEFAULT_COMPLIANCE: DroneCompliance = {
  operatorRegistered: false,
  eIdLabeledOnDrone: false,
  insuranceActive: false,
  competencyA1A3: false,
  certificateA2: false,
  remoteIdConfigured: false,
};

export async function getBriefings(): Promise<Briefing[]> {
  try {
    const data = await AsyncStorage.getItem(BRIEFINGS_KEY);
    if (data) {
      const briefings: Briefing[] = JSON.parse(data);
      return briefings.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
    return [];
  } catch (error) {
    console.error("Error loading briefings:", error);
    return [];
  }
}

export async function getBriefing(id: string): Promise<Briefing | null> {
  const briefings = await getBriefings();
  return briefings.find((b) => b.id === id) || null;
}

export async function saveBriefing(briefing: Omit<Briefing, "id">): Promise<Briefing> {
  const briefings = (await getLocalDataForWrite<Briefing[]>(BRIEFINGS_KEY)) || [];
  const newBriefing: Briefing = {
    ...briefing,
    id: generateId(),
  };
  briefings.unshift(newBriefing);
  await setUserItem(BRIEFINGS_KEY, JSON.stringify(briefings));
  return newBriefing;
}

export async function updateBriefing(id: string, updates: Partial<Briefing>): Promise<void> {
  const briefings = (await getLocalDataForWrite<Briefing[]>(BRIEFINGS_KEY)) || [];
  const index = briefings.findIndex((b) => b.id === id);
  if (index !== -1) {
    briefings[index] = { ...briefings[index], ...updates };
    await setUserItem(BRIEFINGS_KEY, JSON.stringify(briefings));
  }
}

export async function deleteBriefing(id: string): Promise<void> {
  const briefings = (await getLocalDataForWrite<Briefing[]>(BRIEFINGS_KEY)) || [];
  const filtered = briefings.filter((b) => b.id !== id);
  await setUserItem(BRIEFINGS_KEY, JSON.stringify(filtered));
}

export async function getSettings(): Promise<Settings> {
  const cached = readCache<Settings>("settings");
  if (cached) return cached;
  return dedupe("settings", async () => {
    const result = await getSettingsFresh();
    writeCache("settings", result);
    return result;
  });
}

async function getSettingsFresh(): Promise<Settings> {
  await waitForAuthReady();
  const mergeRemote = (remote: Partial<Settings>): Settings => ({
    ...DEFAULT_SETTINGS,
    ...remote,
    limits: { ...DEFAULT_LIMITS, ...(remote.limits || {}) },
    proximityAlarm: {
      ...DEFAULT_PROXIMITY_ALARM,
      ...(remote.proximityAlarm || {}),
      ta: { ...DEFAULT_PROXIMITY_ALARM.ta, ...(remote.proximityAlarm?.ta || {}) },
      ra: { ...DEFAULT_PROXIMITY_ALARM.ra, ...(remote.proximityAlarm?.ra || {}) },
      tcasTimeEnabled: true,
      taTimeEnabled: remote.proximityAlarm?.taTimeEnabled ?? remote.proximityAlarm?.tcasTimeEnabled ?? true,
      raTimeEnabled: remote.proximityAlarm?.raTimeEnabled ?? remote.proximityAlarm?.tcasTimeEnabled ?? true,
    },
  });
  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetSettings());
    if (remote) {
      void writeSnapshot(SNAPSHOT_KEYS.settings, remote);
      return mergeRemote(remote);
    }
    const snap = await readSnapshot<Partial<Settings>>(SNAPSHOT_KEYS.settings);
    if (snap && snap.data) {
      console.warn("[storage] Server unerreichbar, nutze Settings-Snapshot.");
      return mergeRemote(snap.data);
    }
  }
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        limits: { ...DEFAULT_LIMITS, ...(parsed.limits || {}) },
        proximityAlarm: {
          ...DEFAULT_PROXIMITY_ALARM,
          ...(parsed.proximityAlarm || {}),
          ta: { ...DEFAULT_PROXIMITY_ALARM.ta, ...(parsed.proximityAlarm?.ta || {}) },
          ra: { ...DEFAULT_PROXIMITY_ALARM.ra, ...(parsed.proximityAlarm?.ra || {}) },
          tcasTimeEnabled: true,
          taTimeEnabled: parsed.proximityAlarm?.taTimeEnabled ?? (parsed.proximityAlarm?.tcasTimeEnabled ?? true),
          raTimeEnabled: parsed.proximityAlarm?.raTimeEnabled ?? (parsed.proximityAlarm?.tcasTimeEnabled ?? true),
        },
      };
    }
    return DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Error loading settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  invalidateCache("settings");
  await waitForAuthReady();
  if (useServer()) {
    try {
      await Api.apiSaveSettings(settings);
      // Lokal-Spiegel löschen, damit nach Logout der Server-Wert nicht
      // wieder durch Stale-Daten überschrieben wird.
      await AsyncStorage.removeItem(SETTINGS_KEY);
      return;
    } catch (error) {
      console.error("Error saving settings to server:", error);
      throw error;
    }
  }
  try {
    await setUserItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
}

function normalizeDroneShape(drone: DroneProfile): DroneProfile {
  return {
    ...drone,
    droneType: drone.droneType || ("standard" as DroneType),
    hasRemoteId: drone.hasRemoteId ?? false,
    altitudeLocked120m: drone.altitudeLocked120m ?? false,
  };
}

export async function getDrones(opts?: { includeArchived?: boolean; onlyArchived?: boolean }): Promise<DroneProfile[]> {
  const includeArchived = !!opts?.includeArchived;
  const onlyArchived = !!opts?.onlyArchived;
  const cacheKey = `drones:${includeArchived ? "1" : "0"}:${onlyArchived ? "1" : "0"}`;
  const cached = readCache<DroneProfile[]>(cacheKey);
  if (cached) return cached;
  return dedupe(cacheKey, async () => {
    const result = await getDronesFresh({ includeArchived, onlyArchived });
    writeCache(cacheKey, result);
    return result;
  });
}

async function getDronesFresh(opts: { includeArchived: boolean; onlyArchived: boolean }): Promise<DroneProfile[]> {
  await waitForAuthReady();
  const { includeArchived, onlyArchived } = opts;
  const filterFn = (d: DroneProfile) => {
    const archived = !!d.archivedAt;
    if (onlyArchived) return archived;
    if (includeArchived) return true;
    return !archived;
  };
  const shape = (list: DroneProfile[]) => list
    .map(normalizeDroneShape)
    .filter(filterFn)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetDrones({ includeArchived, onlyArchived }));
    if (remote) {
      // Server liefert leere Liste, obwohl wir lokal noch einen frischen
      // Snapshot mit Drohnen haben? Das ist mit überwältigender
      // Wahrscheinlichkeit ein Session-/Sync-Hiccup, nicht "User hat alles
      // gelöscht". Snapshot beibehalten, damit dem Piloten nicht ohne
      // Vorwarnung die Flotte verschwindet.
      if (remote.length === 0) {
        const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
        if (snap && Array.isArray(snap.data) && snap.data.length > 0) {
          console.warn(
            `[storage] Server lieferte 0 Drohnen, Snapshot enthält ${snap.data.length} (Alter ${Math.round((Date.now() - snap.fetchedAt) / 1000)}s). Snapshot wird beibehalten.`,
          );
          return shape(snap.data);
        }
      }
      // Snapshot wird nur über die vollständige Liste (inkl. archived)
      // geschrieben, damit alle Sichten denselben Stand verwenden können.
      // Vorher noch ausstehende Offline-Creates (temp_-IDs) reinmischen,
      // damit der User seine optimistisch angelegten Drohnen weiter sieht,
      // bis die Queue geflusht wird.
      if (includeArchived && !onlyArchived) {
        const pending = await getPendingOptimisticDrones();
        const merged = pending.length === 0
          ? remote
          : [...remote, ...pending.filter((p) => !remote.some((r) => r.id === p.id))];
        void writeSnapshot(SNAPSHOT_KEYS.drones, merged);
        return shape(merged);
      }
      return shape(remote);
    }
    // Server unerreichbar → Snapshot bevorzugen, vor dem alten Local-Store.
    const snap = await readSnapshot<DroneProfile[]>(SNAPSHOT_KEYS.drones);
    if (snap && Array.isArray(snap.data)) {
      console.warn("[storage] Server unerreichbar, nutze Drohnen-Snapshot.");
      return shape(snap.data);
    }
  }
  const drones = (await getLocalData<DroneProfile[]>(DRONES_KEY)) || [];
  return shape(drones);
}

export async function getArchivedDrones(): Promise<DroneProfile[]> {
  return getDrones({ onlyArchived: true });
}

export async function archiveDrone(id: string): Promise<void> {
  await updateDrone(id, { archivedAt: new Date().toISOString() } as Partial<DroneProfile>);
  const selectedId = await getSelectedDroneId();
  if (selectedId === id) {
    await setSelectedDroneId(null);
  }
}

export async function unarchiveDrone(id: string): Promise<void> {
  await updateDrone(id, { archivedAt: null } as Partial<DroneProfile>);
}

export async function getDrone(id: string): Promise<DroneProfile | null> {
  // includeArchived: Logbuch, DroneHistory & Session-Details müssen den
  // Drohnennamen/Klassen-Mark auch dann auflösen, wenn die Drohne längst
  // archiviert wurde — die Liste in DronesScreen filtert sie davon
  // unabhängig korrekt aus.
  const drones = await getDrones({ includeArchived: true });
  return drones.find((d) => d.id === id) || null;
}

export async function saveDrone(drone: Omit<DroneProfile, "id" | "createdAt" | "updatedAt">): Promise<DroneProfile> {
  invalidateCache("drones:");
  await waitForAuthReady();
  if (useServer()) {
    try {
      const created = await Api.apiCreateDrone(drone as Partial<DroneProfile>);
      const normalized = normalizeDroneShape(created);
      // Snapshot direkt mit dem Server-Ergebnis updaten, damit die nächste
      // Liste die neue Drohne sofort enthält (auch wenn der Server-Refresh
      // etwas hinterherhängt).
      await mergeDroneIntoSnapshot(normalized);
      return normalized;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      // Offline: optimistisch in den Snapshot schreiben, Op in die Queue.
      const now = new Date().toISOString();
      const tempId = `${TEMP_ID_PREFIX}${generateId()}`;
      const optimistic = normalizeDroneShape({
        ...drone,
        id: tempId,
        createdAt: now,
        updatedAt: now,
      } as DroneProfile);
      await mergeDroneIntoSnapshot(optimistic);
      await enqueueWrite({
        kind: "drone.create",
        tempId,
        payload: drone as Partial<DroneProfile>,
        ts: Date.now(),
      });
      console.warn("[storage] saveDrone offline → in Queue gepuffert");
      return optimistic;
    }
  }
  const drones = (await getLocalDataForWrite<DroneProfile[]>(DRONES_KEY)) || [];
  const now = new Date().toISOString();
  const newDrone: DroneProfile = {
    ...drone,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  drones.unshift(newDrone);
  await saveLocalData(DRONES_KEY, drones);
  return newDrone;
}

export async function updateDrone(id: string, updates: Partial<DroneProfile>): Promise<void> {
  invalidateCache("drones:");
  await waitForAuthReady();
  if (useServer()) {
    // Snapshot zuerst optimistisch patchen, damit die UI nach dem Speichern
    // den neuen Stand zeigt — egal ob der Server-Call gleich antwortet,
    // hängt oder in die Queue wandert.
    await patchDroneInSnapshot(id, updates);
    try {
      await Api.apiUpdateDrone(id, updates);
      return;
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      await enqueueWrite({ kind: "drone.update", id, updates, ts: Date.now() });
      console.warn("[storage] updateDrone offline → in Queue gepuffert");
      return;
    }
  }
  const drones = (await getLocalDataForWrite<DroneProfile[]>(DRONES_KEY)) || [];
  const index = drones.findIndex((d) => d.id === id);
  if (index !== -1) {
    drones[index] = { ...drones[index], ...updates, updatedAt: new Date().toISOString() };
    await saveLocalData(DRONES_KEY, drones);
  }
}

export async function deleteDrone(id: string): Promise<void> {
  invalidateCache("drones:");
  await waitForAuthReady();
  if (useServer()) {
    // Sonderfall: noch nicht synchronisierte Offline-Drohne (temp_-ID).
    // Wir können sie nie an den Server schicken, also Queue + Snapshot
    // lokal aufräumen und fertig.
    if (id.startsWith(TEMP_ID_PREFIX)) {
      const queue = await readWriteQueue();
      await writeWriteQueue(
        queue.filter((op) => {
          if (op.kind === "drone.create") return op.tempId !== id;
          if (op.kind === "drone.update" || op.kind === "drone.delete") return op.id !== id;
          return true;
        }),
      );
      await removeDroneFromSnapshot(id);
    } else {
      await removeDroneFromSnapshot(id);
      try {
        await Api.apiDeleteDrone(id);
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        await enqueueWrite({ kind: "drone.delete", id, ts: Date.now() });
        console.warn("[storage] deleteDrone offline → in Queue gepuffert");
      }
    }
  } else {
    const drones = (await getLocalDataForWrite<DroneProfile[]>(DRONES_KEY)) || [];
    const filtered = drones.filter((d) => d.id !== id);
    await saveLocalData(DRONES_KEY, filtered);
  }
  const selectedId = await getSelectedDroneId();
  if (selectedId === id) {
    await setSelectedDroneId(null);
  }
}

export async function getSelectedDroneId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SELECTED_DRONE_KEY);
  } catch (error) {
    console.error("Error getting selected drone:", error);
    return null;
  }
}

export async function setSelectedDroneId(id: string | null): Promise<void> {
  try {
    if (id) {
      await setUserItem(SELECTED_DRONE_KEY, id);
    } else {
      await AsyncStorage.removeItem(SELECTED_DRONE_KEY);
    }
  } catch (error) {
    console.error("Error setting selected drone:", error);
    throw error;
  }
}

export async function getSelectedDrone(): Promise<DroneProfile | null> {
  const id = await getSelectedDroneId();
  if (!id) return null;
  return getDrone(id);
}

// Erreichbare maximale Flughöhe (AGL, Meter) einer Drohne für den Geozonen-
// Höhen-Filter. DroneProfile hält aktuell keinen expliziten `maxAltitudeM`-Wert;
// falls künftig vorhanden, wird er genutzt, sonst der EU-Open-Standard 120 m.
export function getDroneMaxAltitudeM(drone?: DroneProfile | null): number {
  const m = (drone as any)?.maxAltitudeM;
  if (typeof m === "number" && Number.isFinite(m) && m > 0) return m;
  return DEFAULT_REACHABLE_ALTITUDE_M;
}

export function getDroneRequiredCompliance(drone: DroneProfile): {
  required: (keyof DroneCompliance)[];
  optional: (keyof DroneCompliance)[];
} {
  const required: (keyof DroneCompliance)[] = [];
  const optional: (keyof DroneCompliance)[] = [];

  if (drone.classMark === "C0") {
    if (drone.mtomGrams >= 250 || drone.hasCameraOrSensor) {
      required.push("eIdLabeledOnDrone");
    }
  } else {
    required.push("eIdLabeledOnDrone");
  }

  if (drone.classMark === "C1" || drone.classMark === "C2" || drone.classMark === "C3") {
    required.push("remoteIdConfigured");
  }

  return { required, optional };
}

export function getPilotRequiredCompliance(drone: DroneProfile): {
  required: (keyof PilotCompliance)[];
  optional: (keyof PilotCompliance)[];
} {
  const required: (keyof PilotCompliance)[] = [];
  const optional: (keyof PilotCompliance)[] = [];

  required.push("insuranceActive");
  if (drone.classMark === "C0") {
    if (drone.mtomGrams >= 250 || drone.hasCameraOrSensor) {
      required.push("operatorRegistered");
    }
  } else {
    required.push("operatorRegistered");
  }

  if (drone.classMark !== "C0") {
    required.push("competencyA1A3");
  }

  if (drone.classMark === "C2" && drone.openCategory === "A2") {
    required.push("certificateA2");
  }

  return { required, optional };
}

export function getPilotComplianceValues(pilot: PilotProfile): PilotCompliance {
  return {
    insuranceActive: pilot.insuranceActive,
    operatorRegistered: pilot.operatorRegistered || !!pilot.operatorId,
    competencyA1A3: pilot.licenseA1A3,
    certificateA2: pilot.licenseA2,
  };
}

export function getRequiredCompliance(drone: DroneProfile): {
  required: (keyof DroneCompliance)[];
  optional: (keyof DroneCompliance)[];
} {
  const droneReq = getDroneRequiredCompliance(drone);
  const pilotReq = getPilotRequiredCompliance(drone);
  return {
    required: [...pilotReq.required as (keyof DroneCompliance)[], ...droneReq.required],
    optional: [...pilotReq.optional as (keyof DroneCompliance)[], ...droneReq.optional],
  };
}

export function getComplianceStatus(drone: DroneProfile, pilot?: PilotProfile): "green" | "yellow" | "red" {
  const droneReq = getDroneRequiredCompliance(drone);
  const missingDroneRequired = droneReq.required.filter(key => !drone.compliance[key]);
  const missingDroneOptional = droneReq.optional.filter(key => !drone.compliance[key]);

  if (pilot) {
    const pilotReq = getPilotRequiredCompliance(drone);
    const pilotValues = getPilotComplianceValues(pilot);
    const missingPilotRequired = pilotReq.required.filter(key => !pilotValues[key]);
    if (missingDroneRequired.length > 0 || missingPilotRequired.length > 0) return "red";
    if (missingDroneOptional.length > 0) return "yellow";
    return "green";
  }

  const missingLegacy = droneReq.required.filter(key => !drone.compliance[key]);
  if (missingLegacy.length > 0) return "red";
  if (missingDroneOptional.length > 0) return "yellow";
  return "green";
}

export function getDefaultLimitsForClass(classMark: DroneClass): WeatherLimits {
  switch (classMark) {
    case "C0":
      return { maxWind: 8, maxGusts: 10, maxRain: 0.3, minTemp: 5, maxTemp: 40, minCloudCeiling: 120, minVisibility: 500 };
    case "C1":
      return { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: 0, maxTemp: 40, minCloudCeiling: 120, minVisibility: 1000 };
    case "C2":
      return { maxWind: 12, maxGusts: 15, maxRain: 0.5, minTemp: -5, maxTemp: 40, minCloudCeiling: 120, minVisibility: 2000 };
    case "C3":
    case "C4":
      return { maxWind: 15, maxGusts: 18, maxRain: 1.0, minTemp: -10, maxTemp: 40, minCloudCeiling: 120, minVisibility: 5000 };
    case "C5":
    case "C6":
      return { maxWind: 18, maxGusts: 22, maxRain: 1.5, minTemp: -15, maxTemp: 40, minCloudCeiling: 120, minVisibility: 8000 };
    case "legacy":
    default:
      return { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: 0, maxTemp: 40, minCloudCeiling: 120, minVisibility: 1500 };
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export const TRASH_RETENTION_DAYS = 90;

function isTrashed(s: FlightSession): boolean {
  return !!(s as any).deletedAt;
}

async function purgeOldLocalTrash(): Promise<void> {
  try {
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await mutateLocalList<FlightSession, void>(FLIGHT_SESSIONS_KEY, (sessions) => {
      const filtered = sessions.filter((s) => {
        const d = (s as any).deletedAt;
        if (!d) return true;
        const t = new Date(d).getTime();
        if (isNaN(t)) return true;
        return t >= cutoff;
      });
      return { list: filtered.length !== sessions.length ? filtered : null, result: undefined };
    });
  } catch {}
}

export async function getFlightSessions(): Promise<FlightSession[]> {
  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetSessions());
    if (remote) {
      void writeSnapshot(SNAPSHOT_KEYS.flightSessions, remote);
      return remote.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    }
    const snap = await readSnapshot<FlightSession[]>(SNAPSHOT_KEYS.flightSessions);
    if (snap && Array.isArray(snap.data)) {
      console.warn("[storage] Server unerreichbar, nutze Flight-Sessions-Snapshot.");
      return snap.data
        .filter((s) => !isTrashed(s))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }
  await purgeOldLocalTrash();
  const sessions = (await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY)) || [];
  return sessions
    .filter((s) => !isTrashed(s))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Liefert nur Sessions, die im Papierkorb liegen (Soft-Delete). */
export async function getTrashedFlightSessions(): Promise<FlightSession[]> {
  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetSessions({ trashed: true }));
    if (remote) {
      void writeSnapshot(SNAPSHOT_KEYS.flightSessionsTrash, remote);
      return remote.sort((a, b) => {
        const ad = new Date((a as any).deletedAt || a.updatedAt).getTime();
        const bd = new Date((b as any).deletedAt || b.updatedAt).getTime();
        return bd - ad;
      });
    }
    const snap = await readSnapshot<FlightSession[]>(SNAPSHOT_KEYS.flightSessionsTrash);
    if (snap && Array.isArray(snap.data)) {
      console.warn("[storage] Server unerreichbar, nutze Papierkorb-Snapshot.");
      return snap.data.sort((a, b) => {
        const ad = new Date((a as any).deletedAt || a.updatedAt).getTime();
        const bd = new Date((b as any).deletedAt || b.updatedAt).getTime();
        return bd - ad;
      });
    }
  }
  await purgeOldLocalTrash();
  const sessions = (await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY)) || [];
  return sessions
    .filter(isTrashed)
    .sort((a, b) => {
      const ad = new Date((a as any).deletedAt || a.updatedAt).getTime();
      const bd = new Date((b as any).deletedAt || b.updatedAt).getTime();
      return bd - ad;
    });
}

/** Verschiebt eine Session in den Papierkorb (Soft-Delete). */
export async function trashFlightSession(id: string): Promise<void> {
  const deletedAt = new Date().toISOString();
  if (useServer()) {
    try {
      await Api.apiUpdateSession(id, { deletedAt } as Partial<FlightSession>);
    } catch (err) {
      if (!(err instanceof Api.ApiError && err.status === 404)) throw err;
    }
  } else {
    await mutateLocalList<FlightSession, void>(FLIGHT_SESSIONS_KEY, (sessions) => {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx === -1) return { list: null, result: undefined };
      sessions[idx] = {
        ...sessions[idx],
        deletedAt,
        updatedAt: deletedAt,
      } as FlightSession;
      return { list: sessions, result: undefined };
    });
  }
  cancelPreflightReminder(id).catch(() => {});
}

/** Holt eine Session aus dem Papierkorb zurück. */
export async function restoreFlightSession(id: string): Promise<void> {
  if (useServer()) {
    try {
      await Api.apiUpdateSession(id, { deletedAt: null } as Partial<FlightSession>);
    } catch (err) {
      if (!(err instanceof Api.ApiError && err.status === 404)) throw err;
    }
  } else {
    await mutateLocalList<FlightSession, void>(FLIGHT_SESSIONS_KEY, (sessions) => {
      const idx = sessions.findIndex((s) => s.id === id);
      if (idx === -1) return { list: null, result: undefined };
      const restored: any = { ...sessions[idx], updatedAt: new Date().toISOString() };
      delete restored.deletedAt;
      sessions[idx] = restored;
      return { list: sessions, result: undefined };
    });
  }
}

export async function getFlightSession(id: string): Promise<FlightSession | null> {
  const sessions = await getFlightSessions();
  const found = sessions.find((s) => s.id === id) || null;
  // Listen liefern ausgelagerte Bilder als Verweis; die Einzelansicht lädt sie.
  return found ? hydrateBlobsOne(SESSION_BLOB_SPEC, found) : null;
}

export async function getActiveSessions(): Promise<FlightSession[]> {
  const sessions = await getFlightSessions();
  return sessions.filter(s => s.currentPhase !== "completed");
}

export async function getTodaysSessions(): Promise<FlightSession[]> {
  const sessions = await getFlightSessions();
  const today = new Date().toISOString().split("T")[0];
  return sessions.filter(s => {
    const sessionDate = s.planning?.plannedDate || s.createdAt.split("T")[0];
    return sessionDate === today;
  });
}

export async function createFlightSession(
  session: Omit<FlightSession, "id" | "createdAt" | "updatedAt">,
): Promise<FlightSession> {
  let created: FlightSession;
  if (useServer()) {
    created = await Api.apiCreateSession(session as Partial<FlightSession>);
  } else {
    const now = new Date().toISOString();
    const fresh: FlightSession = {
      ...session,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    created = await mutateLocalList<FlightSession, FlightSession>(FLIGHT_SESSIONS_KEY, (sessions) => {
      sessions.unshift(fresh);
      return { list: sessions, result: fresh };
    });
  }
  // Reminder eine Stunde vor geplanter Startzeit (nur iOS/Android).
  schedulePreflightReminder({
    sessionId: created.id,
    plannedDate: created.planning?.plannedDate,
    plannedTime: created.planning?.plannedTime,
    locationName: created.locationName,
  }).catch(() => {});
  return created;
}

export async function updateFlightSession(
  id: string,
  updates: Partial<FlightSession>,
): Promise<FlightSession | null> {
  let updated: FlightSession | null = null;
  if (useServer()) {
    try {
      updated = await Api.apiUpdateSession(id, updates);
    } catch (err) {
      if (err instanceof Api.ApiError && err.status === 404) return null;
      throw err;
    }
  } else {
    const raw = await mutateLocalList<FlightSession, FlightSession | null>(FLIGHT_SESSIONS_KEY, (sessions) => {
      const index = sessions.findIndex((s) => s.id === id);
      if (index === -1) return { list: null, result: null };
      sessions[index] = {
        ...sessions[index],
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      return { list: sessions, result: sessions[index] };
    });
    updated = raw ? await hydrateBlobsOne(SESSION_BLOB_SPEC, raw) : null;
  }
  if (updated) {
    // Falls Planung/Phase angefasst wurde, Reminder neu setzen. Wenn Phase
    // bereits hover/postlanding/debriefing/completed ist, wird der Reminder
    // gecancelt (parseTriggerDate liefert null für vergangene Zeitpunkte).
    const inFuturePhase = updated.currentPhase === "planning" || updated.currentPhase === "preflight";
    if (inFuturePhase) {
      schedulePreflightReminder({
        sessionId: updated.id,
        plannedDate: updated.planning?.plannedDate,
        plannedTime: updated.planning?.plannedTime,
        locationName: updated.locationName,
      }).catch(() => {});
    } else {
      cancelPreflightReminder(updated.id).catch(() => {});
    }
  }
  return updated;
}

export async function deleteFlightSession(id: string): Promise<void> {
  if (useServer()) {
    await Api.apiDeleteSession(id);
  } else {
    await mutateLocalList<FlightSession, void>(FLIGHT_SESSIONS_KEY, (sessions) => ({
      list: sessions.filter((s) => s.id !== id),
      result: undefined,
    }));
  }
  // Reminder erst entfernen, nachdem die Session erfolgreich gelöscht wurde —
  // sonst könnten Fehler beim Löschen einen verwaisten Reminder hinterlassen.
  cancelPreflightReminder(id).catch(() => {});
}

export async function getLogbook(): Promise<LogbookEntry[]> {
  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetLogbook());
    if (remote) {
      void writeSnapshot(SNAPSHOT_KEYS.logbook, remote);
      return remote.sort(
        (a, b) => new Date(b.flightDate).getTime() - new Date(a.flightDate).getTime(),
      );
    }
    const snap = await readSnapshot<LogbookEntry[]>(SNAPSHOT_KEYS.logbook);
    if (snap && Array.isArray(snap.data)) {
      console.warn("[storage] Server unerreichbar, nutze Logbuch-Snapshot.");
      return snap.data.sort(
        (a, b) => new Date(b.flightDate).getTime() - new Date(a.flightDate).getTime(),
      );
    }
  }
  const entries = await hydrateBlobs(LOGBOOK_BLOB_SPEC, (await getLocalData<LogbookEntry[]>(LOGBOOK_KEY)) || []);
  return entries.sort(
    (a, b) => new Date(b.flightDate).getTime() - new Date(a.flightDate).getTime(),
  );
}

export async function getLogbookEntry(id: string): Promise<LogbookEntry | null> {
  const entries = await getLogbook();
  return entries.find((e) => e.id === id) || null;
}

/**
 * Flughistorie eines einzelnen Akkus: alle Logbuch-Einträge der angegebenen
 * Drohne, in denen dieser Akku verwendet wurde (Pre-Check oder Debriefing).
 * Neueste zuerst sortiert.
 */
export async function getBatteryFlightHistory(
  droneId: string,
  batteryId: string,
  batterySerial?: string,
): Promise<LogbookEntry[]> {
  const entries = await getLogbook();
  return entries.filter((e) => {
    // DJI-Logs verweisen über batteryId/batterySn auf den Akku (auch wenn der
    // Eintrag keiner oder einer anderen Drohne zugeordnet ist).
    const viaLog = getEntryDjiLogs(e).some(
      (l) => l.batteryId === batteryId || (!!batterySerial && serialsMatch(l.batterySn, batterySerial)),
    );
    if (viaLog) return true;
    if (e.droneId !== droneId) return false;
    return entryUsesBattery(e, { id: batteryId });
  });
}

/**
 * DJI-Log an einen bestehenden Logbuch-Eintrag hängen (Akku-Tausch: mehrere
 * Logs je Flug). Ein Log mit gleicher Kennung (objectPath) wird ersetzt; das
 * Legacy-Einzelfeld djiLog wird dabei in djiLogs übernommen.
 */
export async function attachDjiLogToEntry(
  entryId: string,
  meta: DjiLogMeta,
): Promise<LogbookEntry | null> {
  // hydriert lesen (djiLogs kann als Datei ausgelagert sein)
  const current = await getLogbookEntry(entryId);
  if (!current) return null;
  const others = getEntryDjiLogs(current).filter((l) => l.objectPath !== meta.objectPath);
  await updateLogbookEntry(entryId, { djiLogs: sortDjiLogs([...others, meta]), djiLog: undefined });
  return getLogbookEntry(entryId);
}

export async function createLogbookEntry(
  entry: Omit<LogbookEntry, "id" | "createdAt">,
): Promise<LogbookEntry> {
  if (useServer()) {
    return Api.apiCreateLogbookEntry(entry as Partial<LogbookEntry>);
  }
  const newEntry: LogbookEntry = {
    ...entry,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  return mutateLocalList<LogbookEntry, LogbookEntry>(LOGBOOK_KEY, (entries) => {
    entries.unshift(newEntry);
    return { list: entries, result: newEntry };
  });
}

export async function updateLogbookEntry(
  id: string,
  updates: Partial<LogbookEntry>,
): Promise<void> {
  if (useServer()) {
    await Api.apiUpdateLogbookEntry(id, updates);
    return;
  }
  await mutateLocalList<LogbookEntry, void>(LOGBOOK_KEY, (entries) => {
    const index = entries.findIndex((e) => e.id === id);
    if (index === -1) return { list: null, result: undefined };
    entries[index] = { ...entries[index], ...updates };
    return { list: entries, result: undefined };
  });
}

export async function deleteLogbookEntry(id: string): Promise<void> {
  if (useServer()) {
    await Api.apiDeleteLogbookEntry(id);
    return;
  }
  await mutateLocalList<LogbookEntry, void>(LOGBOOK_KEY, (entries) => ({
    list: entries.filter((e) => e.id !== id),
    result: undefined,
  }));
}

export async function completeSessionWithLogEntry(
  sessionId: string,
  debriefing: DebriefingData
): Promise<LogbookEntry | null> {
  const session = await getFlightSession(sessionId);
  if (!session) return null;

  const drone = await getDrone(session.droneId);
  if (!drone) return null;

  await updateFlightSession(sessionId, {
    currentPhase: "completed",
    debriefing,
  });

  const logEntry = await createLogbookEntry({
    sessionId,
    droneId: session.droneId,
    droneName: drone.name,
    droneClass: drone.classMark,
    flightDate: session.planning?.plannedDate || new Date().toISOString().split("T")[0],
    locationName: session.locationName,
    latitude: session.latitude,
    longitude: session.longitude,
    takeoffTime: debriefing.takeoffTime || session.hoverCheck?.takeoffTime,
    landingTime: debriefing.landingTime || session.hoverCheck?.landingTime,
    flightDurationMinutes: debriefing.flightDurationMinutes,
    maxAltitude: session.planning?.maxAltitude,
    weatherConditions: session.preflight?.actualWeather || session.planning?.forecastWeather,
    incidentOccurred: debriefing.incidentOccurred,
    incidentDescription: debriefing.incidentDescription,
    maintenanceRequired: debriefing.maintenanceRequired,
    maintenanceNotes: debriefing.maintenanceNotes,
    notes: debriefing.generalNotes,
    planning: session.planning,
    preflight: session.preflight,
    hoverCheck: session.hoverCheck,
    postLanding: session.postLanding,
    debriefing,
    hasRestrictions: session.hasRestrictions,
    restrictionNotes: session.restrictionNotes,
    detectedGeozones: session.detectedGeozones,
    savedGeozoneFeatures: session.savedGeozoneFeatures,
    savedDipulRestrictions: session.savedDipulRestrictions,
    status: session.status,
    trafficLog: session.trafficLog,
    mapSnapshotBase64: session.mapSnapshotBase64,
  });

  return logEntry;
}

export async function archiveSessionToLogbook(
  sessionId: string
): Promise<LogbookEntry | null> {
  const session = await getFlightSession(sessionId);
  if (!session) return null;

  const drone = await getDrone(session.droneId);
  if (!drone) return null;

  await updateFlightSession(sessionId, {
    currentPhase: "completed",
  });

  const logEntry = await createLogbookEntry({
    sessionId,
    droneId: session.droneId,
    droneName: drone.name,
    droneClass: drone.classMark,
    flightDate: session.planning?.plannedDate || new Date().toISOString().split("T")[0],
    locationName: session.locationName,
    latitude: session.latitude,
    longitude: session.longitude,
    weatherConditions: session.preflight?.actualWeather || session.planning?.forecastWeather,
    incidentOccurred: session.debriefing?.incidentOccurred || false,
    incidentDescription: session.debriefing?.incidentDescription,
    maintenanceRequired: session.debriefing?.maintenanceRequired || false,
    maintenanceNotes: session.debriefing?.maintenanceNotes,
    notes: session.debriefing?.generalNotes || "Direkt in Logbook archiviert",
    takeoffTime: session.hoverCheck?.takeoffTime || session.debriefing?.takeoffTime,
    landingTime: session.hoverCheck?.landingTime || session.debriefing?.landingTime,
    flightDurationMinutes: session.debriefing?.flightDurationMinutes,
    maxAltitude: session.planning?.maxAltitude,
    planning: session.planning,
    preflight: session.preflight,
    hoverCheck: session.hoverCheck,
    postLanding: session.postLanding,
    debriefing: session.debriefing,
    hasRestrictions: session.hasRestrictions,
    restrictionNotes: session.restrictionNotes,
    detectedGeozones: session.detectedGeozones,
    savedGeozoneFeatures: session.savedGeozoneFeatures,
    savedDipulRestrictions: session.savedDipulRestrictions,
    status: session.status,
    trafficLog: session.trafficLog,
    mapSnapshotBase64: session.mapSnapshotBase64,
  });

  return logEntry;
}

export type DroneEventType = "repair" | "inspection" | "cleaning" | "rotor_change" | "damage" | "replacement" | "hard_landing" | "crash_landing" | "other";

export interface DroneHistoryEntry {
  id: string;
  droneId: string;
  eventType: DroneEventType;
  description: string;
  date: string;
  sessionId?: string | null;
  locationName?: string | null;
  createdAt: string;
}

export async function getDroneHistory(droneId: string): Promise<DroneHistoryEntry[]> {
  const sortAndFilter = (entries: DroneHistoryEntry[]) => entries
    .filter((e) => e.droneId === droneId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetDroneHistory(droneId));
    if (remote) {
      // Snapshot wird pro Drohne separat gespeichert (zusammengeführt als Map).
      void (async () => {
        try {
          const prior = await readSnapshot<Record<string, DroneHistoryEntry[]>>(SNAPSHOT_KEYS.droneHistory);
          const merged = { ...(prior?.data || {}), [droneId]: remote };
          await writeSnapshot(SNAPSHOT_KEYS.droneHistory, merged);
        } catch { /* best-effort */ }
      })();
      return sortAndFilter(remote);
    }
    const snap = await readSnapshot<Record<string, DroneHistoryEntry[]>>(SNAPSHOT_KEYS.droneHistory);
    const cached = snap?.data?.[droneId];
    if (cached && Array.isArray(cached)) {
      console.warn("[storage] Server unerreichbar, nutze Drone-History-Snapshot.");
      return sortAndFilter(cached);
    }
  }
  const json = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
  if (!json) return [];
  const allHistory: DroneHistoryEntry[] = JSON.parse(json);
  return sortAndFilter(allHistory);
}

export async function addDroneHistoryEntry(
  droneId: string,
  data: {
    eventType: DroneEventType;
    description: string;
    date: string;
    sessionId?: string | null;
    locationName?: string | null;
  },
): Promise<DroneHistoryEntry> {
  if (useServer()) {
    return Api.apiAddDroneHistory(droneId, { ...data, droneId });
  }
  const json = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
  const history: DroneHistoryEntry[] = json ? JSON.parse(json) : [];

  const newEntry: DroneHistoryEntry = {
    id: Date.now().toString(),
    droneId,
    eventType: data.eventType,
    description: data.description,
    date: data.date,
    sessionId: data.sessionId ?? null,
    locationName: data.locationName ?? null,
    createdAt: new Date().toISOString(),
  };

  history.push(newEntry);
  await setUserItem(DRONE_HISTORY_KEY, JSON.stringify(history));
  return newEntry;
}

export async function getLogbookEntryBySessionId(
  sessionId: string,
): Promise<LogbookEntry | null> {
  const entries = await getLogbook();
  return entries.find((e) => e.sessionId === sessionId) || null;
}

export async function deleteDroneHistoryEntry(droneId: string, entryId: string): Promise<void> {
  if (useServer()) {
    await Api.apiDeleteDroneHistory(droneId, entryId);
    return;
  }
  const json = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
  if (!json) return;
  const history: DroneHistoryEntry[] = JSON.parse(json);
  const filtered = history.filter((entry) => !(entry.id === entryId && entry.droneId === droneId));
  await setUserItem(DRONE_HISTORY_KEY, JSON.stringify(filtered));
}

export interface MigrationResult {
  success: boolean;
  dronesSync: number;
  sessionsSync: number;
  logbookSync: number;
  settingsSync: boolean;
  profileSync: boolean;
  historySync: number;
  hadAnyLocalData: boolean;
  error?: string;
}

/**
 * Pusht alle in AsyncStorage liegenden Daten einmalig auf den Server.
 * Wird nach erfolgreichem Login aufgerufen, damit ein zuvor offline
 * genutzter Account seine Drohnen, Sessions, Logbuch usw. übernimmt.
 *
 * Idempotenz: Erfolgreich gepushte Datensätze werden _einzeln_ aus
 * AsyncStorage entfernt, fehlerhafte bleiben dort liegen. Damit erzeugt
 * ein Re-Run nach Teilfehler keine Duplikate. `success` ist nur dann
 * `true`, wenn jeder Datensatz aller Buckets sauber durchlief.
 */
export async function migrateLocalDataToServer(): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    dronesSync: 0,
    sessionsSync: 0,
    logbookSync: 0,
    settingsSync: false,
    profileSync: false,
    historySync: 0,
    hadAnyLocalData: false,
  };

  if (!isLoggedInSync()) {
    return { ...result, success: false, error: "Nicht angemeldet" };
  }

  // Hilfsfunktion: pusht ein Array, schreibt nur die fehlgeschlagenen
  // Datensätze zurück in AsyncStorage und gibt zurück, wie viele
  // erfolgreich waren.
  async function pushArray<T>(
    key: string,
    items: T[],
    push: (item: T) => Promise<unknown>,
  ): Promise<{ ok: number; failed: T[] }> {
    const failed: T[] = [];
    let ok = 0;
    for (const item of items) {
      try {
        await push(item);
        ok++;
      } catch (err) {
        console.warn(`[migrate] ${key} item failed:`, (err as Error).message);
        failed.push(item);
      }
    }
    if (failed.length === 0) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(failed));
      result.success = false;
    }
    return { ok, failed };
  }

  try {
    // Drohnen
    const localDrones = (await getLocalData<DroneProfile[]>(DRONES_KEY)) || [];
    if (localDrones.length > 0) {
      result.hadAnyLocalData = true;
      const r = await pushArray(DRONES_KEY, localDrones, (d) => Api.apiCreateDrone(d));
      result.dronesSync = r.ok;
    }

    // Sessions
    const localSessions = (await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY)) || [];
    if (localSessions.length > 0) {
      result.hadAnyLocalData = true;
      const r = await pushArray(FLIGHT_SESSIONS_KEY, localSessions, (s) => Api.apiCreateSession(s));
      result.sessionsSync = r.ok;
    }

    // Logbuch
    const localLogbook = (await getLocalData<LogbookEntry[]>(LOGBOOK_KEY)) || [];
    if (localLogbook.length > 0) {
      result.hadAnyLocalData = true;
      const r = await pushArray(LOGBOOK_KEY, localLogbook, (e) => Api.apiCreateLogbookEntry(e));
      result.logbookSync = r.ok;
    }

    // Drohnen-Historie
    const histJson = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
    const localHistory: DroneHistoryEntry[] = histJson ? JSON.parse(histJson) : [];
    if (localHistory.length > 0) {
      result.hadAnyLocalData = true;
      const r = await pushArray(DRONE_HISTORY_KEY, localHistory, (h) => Api.apiAddDroneHistory(h.droneId, h));
      result.historySync = r.ok;
    }

    // Pilot-Profil — nur pushen wenn der Server noch keins hat,
    // damit ein bewusst leeres Profil beim Web-Account nicht
    // versehentlich vom Mobile-Default überschrieben wird.
    const localProfile = await getLocalData<PilotProfile>(PILOT_PROFILE_KEY);
    if (localProfile) {
      result.hadAnyLocalData = true;
      try {
        const remoteProfile = await Api.apiGetProfile();
        const remoteHasContent = !!(
          remoteProfile && (remoteProfile.name?.trim() || remoteProfile.pilotId?.trim() || remoteProfile.operatorId?.trim())
        );
        if (!remoteHasContent) {
          await Api.apiSaveProfile(localProfile);
          result.profileSync = true;
          await AsyncStorage.removeItem(PILOT_PROFILE_KEY);
        }
      } catch (err) {
        console.warn("[migrate] profile failed:", (err as Error).message);
        result.success = false;
      }
    }

    // Settings — gleiche Vorsicht wie Profil.
    const localSettingsJson = await AsyncStorage.getItem(SETTINGS_KEY);
    if (localSettingsJson) {
      result.hadAnyLocalData = true;
      try {
        const remoteSettings = await Api.apiGetSettings();
        if (!remoteSettings) {
          await Api.apiSaveSettings(JSON.parse(localSettingsJson));
          result.settingsSync = true;
          await AsyncStorage.removeItem(SETTINGS_KEY);
        }
      } catch (err) {
        console.warn("[migrate] settings failed:", (err as Error).message);
        result.success = false;
      }
    }

    // Geozonen-Layer-Auswahl pro Land — pusht alle lokalen Country-Maps.
    try {
      const GEOZONES_BASE = "@preflight/geozone_layers";
      const allKeys = await AsyncStorage.getAllKeys();
      const gzKeys = allKeys.filter((k) => k === GEOZONES_BASE || k.startsWith(`${GEOZONES_BASE}_`));
      for (const k of gzKeys) {
        const raw = await AsyncStorage.getItem(k);
        if (!raw) continue;
        let parsed: Record<string, boolean> | null = null;
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
        if (!parsed || typeof parsed !== "object") continue;
        const iso = k === GEOZONES_BASE ? "DE" : k.slice(GEOZONES_BASE.length + 1).toUpperCase();
        try {
          await Api.apiSaveGeozoneSettings(iso, parsed);
          await AsyncStorage.removeItem(k);
          result.hadAnyLocalData = true;
        } catch (err) {
          console.warn(`[migrate] geozones ${iso} failed:`, (err as Error).message);
          result.success = false;
        }
      }
    } catch (err) {
      console.warn("[migrate] geozones scan failed:", (err as Error).message);
    }

    return result;
  } catch (err) {
    return {
      ...result,
      success: false,
      error: (err as Error).message || "Unbekannter Fehler beim Synchronisieren",
    };
  }
}

/**
 * Prüft, ob in AsyncStorage überhaupt migrierbare Nutzdaten liegen.
 * Wird vor dem Migrations-Prompt aufgerufen, damit Erst-Logins
 * auf einem leeren Gerät keinen unnötigen Dialog sehen.
 */
export async function hasLocalUserData(): Promise<boolean> {
  const keys = [DRONES_KEY, FLIGHT_SESSIONS_KEY, LOGBOOK_KEY, DRONE_HISTORY_KEY, PILOT_PROFILE_KEY, SETTINGS_KEY];
  for (const key of keys) {
    const v = await AsyncStorage.getItem(key);
    if (!v) continue;
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed) ? parsed.length > 0 : !!parsed) return true;
    } catch {
      if (v.length > 2) return true;
    }
  }
  return false;
}

export async function resetSyncStatus(): Promise<void> {
  await AsyncStorage.removeItem(SYNC_STATUS_KEY);
}

export const BUNDESLAENDER = [
  "Baden-Württemberg",
  "Bayern",
  "Berlin",
  "Brandenburg",
  "Bremen",
  "Hamburg",
  "Hessen",
  "Mecklenburg-Vorpommern",
  "Niedersachsen",
  "Nordrhein-Westfalen",
  "Rheinland-Pfalz",
  "Saarland",
  "Sachsen",
  "Sachsen-Anhalt",
  "Schleswig-Holstein",
  "Thüringen",
] as const;

export type Bundesland = typeof BUNDESLAENDER[number];

/**
 * Standardisierter, bundesweit einheitlicher Erleichterungs-Katalog der
 * geografischen Allgemeinerlaubnis nach § 21h LuftVO (Art. 15 EU 2019/947),
 * basierend auf dem behördlichen Musterbescheid. Jeder Eintrag bündelt die
 * vom Bescheid erfassten Geozonen-Layer (`layerMatch`, Stichwörter werden
 * case-insensitiv gegen `layerLabel` geprüft) mit dem konkreten Auflagen-Text.
 *
 * Hinweis: Natur-/Vogelschutz, Nationalparks und FFH-Gebiete sind NICHT Teil
 * der geografischen Allgemeinerlaubnis und daher bewusst nicht enthalten —
 * dafür ist eine separate naturschutzrechtliche Genehmigung nötig.
 */
export interface Paragraph21hRule {
  id: string;
  label: string;
  /** Rechtsgrundlage / Paragraph aus dem Antragsformular (z. B. "§ 21h (3) Nr. 1 LuftVO"). */
  paragraph: string;
  /**
   * Tatbestand = die normale Regel: das geografische Gebiet, in dem der Betrieb
   * ohne Allgemeinerlaubnis grundsätzlich eingeschränkt/untersagt ist.
   */
  tatbestand: string;
  /**
   * Auflagen = was der:die Pilot:in MIT dieser Allgemeinerlaubnis tun darf und
   * unter welchen Bedingungen (Liste, wie im Antragsformular).
   */
  auflagen: string[];
  /** Stichwörter (lowercase), die gegen den Geozonen-Layer-Label geprüft werden. */
  layerMatch: string[];
  /**
   * Kann diese Zonenkategorie realistisch durch eine geografische Landes-
   * Allgemeinerlaubnis (§ 21h) abgedeckt werden? Nur Kategorien, für die die
   * Landesbehörde zuständig ist (Wohngrundstücke, Bundesfern-/Wasserstraßen,
   * Bahnanlagen), sind `true`. Luftsicherheits- und zustimmungspflichtige
   * Kategorien (Flugplätze/HEMS, Flughäfen/CTR, Industrie-/Energieanlagen,
   * Behörden/Sicherheit) sind `false` — sie werden über DFS/ATC, den Betreiber
   * oder die jeweilige Stelle freigegeben, NICHT über eine Landes-AV.
   */
  avEligible: boolean;
  /**
   * Gilt diese Kategorie als echtes Flugverbot für den Geozonen-Reiter-Schweregrad?
   * `false` = nur „bedingt zulässig" (Freigabe/Koordination einholbar) → orange Reiter.
   * `true` (Default, wenn nicht gesetzt) = tatsächlich untersagt ohne individuelle
   * Genehmigung → roter Reiter, wenn nicht durch Pilot-AV abgedeckt.
   *
   * Flugplätze/HEMS und CTR/Flughäfen sind NICHT prohibitionCategory, weil die FVK-
   * Freigabe bzw. Koordination mit dem Betreiber regulär eingeholt werden kann.
   */
  prohibitionCategory?: boolean;
}

export const PARAGRAPH_21H_RULES: Paragraph21hRule[] = [
  {
    id: "flugplaetze",
    label: "Flugplätze / HEMS",
    paragraph: "§ 21h (3) Nr. 1 LuftVO",
    tatbestand:
      "Normalfall: Betrieb weniger als 1,5 km von der Begrenzung von Flugplätzen für Rettungszwecke (HEMS) ist untersagt.",
    auflagen: [
      "Max. Höhe 30 m über Grund bzw. Höhe der umliegenden Gebäude",
      "Ggf. Anzeige-/Zustimmungspflicht der zuständigen Stelle",
      "Dem bemannten (Rettungs-)Luftverkehr stets ausweichen",
    ],
    layerMatch: ["flugplätze", "flugplatz", "hems", "hubschrauber"],
    avEligible: false,
    // Koordination mit Flugplatzbetreiber einholbar → „bedingt zulässig", kein Flugverbot.
    prohibitionCategory: false,
  },
  {
    id: "flughaefen",
    label: "Flughäfen / Kontrollzonen",
    paragraph: "§ 21h (3) Nr. 2 LuftVO",
    tatbestand:
      "Normalfall: Betrieb über und innerhalb 1000 m von der Flughafenbegrenzung sowie innerhalb 1000 m der beidseitig um je 5 km verlängerten Bahnmittellinien ist untersagt.",
    auflagen: [
      isDfsZonenEffective()
        ? "4-Zonen-Modell (NfL 2026-1-3960, hebt NfL 2023-1-2705 auf) – gilt nur in den CTR der 15 Flughäfen mit DFS-Flugplatzkontrolle"
        : "Neues 4-Zonen-Modell (NfL 2026-1-3960, gültig ab 06.08.2026, hebt NfL 2023-1-2705 auf) – gilt nur in den CTR der 15 Flughäfen mit DFS-Flugplatzkontrolle",
      "Zone 1 (Flughafenbereich + 1-km/5-km-Bereich, § 21h Abs. 3 Nr. 2): immer individuelle FVK-Freigabe der DFS; offene Kategorie zusätzlich Genehmigung der Landesluftfahrtbehörde (§ 21i)",
      "Zone 2 (bis 4 km): max. 25 m über Grund/Flugplatzhöhe (niedrigerer Wert); Zone 3 (bis 6 km): max. 45 m (niedrigerer Wert); Zone 4 (Rest-CTR): 100 m über Flugplatzhöhe oder 50 m über Grund (höherer Wert)",
      "Bodensicht mind. 800 m laut Flugplatzwettermeldung; max. 5 kg Flugmodelle / 25 kg UAS; vollautonome Flüge ausgeschlossen",
      "Zonen-Geometrie je Flughafen: Ergänzungen zur AIP GERMANY und dipul",
      "Auf dem Flughafen zusätzlich Zustimmung von Betreiber und Luftaufsichtsstelle",
    ],
    layerMatch: ["flughäfen", "flughafen", "kontrollzon", "ctr"],
    avEligible: false,
    // FVK-Freigabe beim Tower einholbar → „bedingt zulässig", kein echtes Flugverbot.
    prohibitionCategory: false,
  },
  {
    id: "industrieanlagen",
    label: "Industrieanlagen",
    paragraph: "§ 21h (3) Nr. 3 LuftVO",
    tatbestand:
      "Normalfall: Betrieb weniger als 100 m von der Begrenzung von Industrieanlagen ist untersagt.",
    auflagen: [
      "Betrieb nur in Unterkategorie A1 oder A2 möglich",
      "Überflug nur mit Zustimmung des Betreibers",
    ],
    layerMatch: ["industrieanlagen", "industrie"],
    avEligible: false,
  },
  {
    id: "energieanlagen",
    label: "Energieanlagen",
    paragraph: "§ 21h (3) Nr. 3 LuftVO",
    tatbestand:
      "Über und innerhalb eines seitlichen Abstands von 100 m zu Anlagen der zentralen Energieerzeugung und -verteilung ist der Betrieb nur mit ausdrücklicher Zustimmung der zuständigen Stelle oder des Betreibers zulässig.",
    auflagen: [
      "Außerhalb des 100-m-Abstands greift diese Zustimmungspflicht nach § 21h Abs. 3 Nr. 3 nicht; andere Regeln können gelten.",
      "Die 100 m messen sich ab der Anlagenbegrenzung; die Kartendistanz ist nur ein Hinweis.",
      "Ein Kartentreffer allein belegt weder die rechtliche Einstufung als zentrale Anlage noch deren genaue Begrenzung.",
    ],
    layerMatch: ["stromleitung", "umspannwerk", "kraftwerk", "windkraft", "energie"],
    avEligible: false,
  },
  {
    id: "behoerden",
    label: "Verfassungsorgane / Sicherheitsbehörden",
    paragraph: "§ 21h (3) Nr. 4 LuftVO",
    tatbestand:
      "Normalfall: Betrieb weniger als 100 m von Verfassungsorganen des Bundes/der Länder, obersten/oberen Bundes- oder Landesbehörden sowie Polizei- und Sicherheitsliegenschaften ist untersagt.",
    auflagen: [
      "Direkter Überflug nur mit ausdrücklicher Zustimmung der jeweiligen Stelle",
    ],
    layerMatch: [
      "behörd",
      "polizei",
      "sicherheitsbehörden",
      "jva",
      "maßregelvollzug",
      "diplomatische",
      "internationale organisationen",
      "verfassungsorgan",
    ],
    avEligible: false,
  },
  {
    id: "bundesfernstrassen",
    label: "Bundesfernstraßen",
    paragraph: "§ 21h (3) Nr. 5 LuftVO",
    tatbestand:
      "Normalfall: Betrieb über oder weniger als 100 m seitlich von Bundesfernstraßen (Autobahnen, Bundesstraßen) ist untersagt.",
    auflagen: [
      "Generell zügiger Überflug",
      "Überflughöhe mindestens 30 m über Grund",
      "Bundesstraßen mit unter 60 km/h: keine 1:1-Regel, keine Mindest-Überflughöhe, kein seitlicher Abstand erforderlich",
      "Bei Lärmschutzwand/-wall ohne Sicht auf die Fahrbahn: Heranflug bis zum Bauwerk, max. bis zu dessen Höhe",
    ],
    layerMatch: ["bundesautobahn", "autobahn", "bundesstraße", "bundesstrasse"],
    avEligible: true,
  },
  {
    id: "bundeswasserstrassen",
    label: "Bundeswasserstraßen",
    paragraph: "§ 21h (3) Nr. 5 LuftVO",
    tatbestand:
      "Normalfall: Betrieb über oder weniger als 100 m seitlich von Bundeswasserstraßen ist untersagt.",
    auflagen: [
      "Horizontaler Mindestabstand 25 m zu Wasserfahrzeugen",
      "Fahrweg von Wasserfahrzeugen nicht unter 200 m (300 m bei militärischen) kreuzen",
      "Überflug von Schiffen nur mit mind. 50 m vertikalem Abstand",
      "Wasserfahrzeugen stets Vorfahrt gewähren",
      "Abweichung nur mit Zustimmung von Besatzung/Eigner",
    ],
    layerMatch: ["binnenwasserstraße", "seewasserstraße", "wasserstraße", "wasserstrasse", "schifffahrtsanlagen"],
    avEligible: true,
  },
  {
    id: "bahnanlagen",
    label: "Bahnanlagen",
    paragraph: "§ 21h (3) Nr. 5 LuftVO",
    tatbestand:
      "Normalfall: Betrieb über oder weniger als 100 m seitlich von Bahnanlagen ist untersagt.",
    auflagen: [
      "Betrieb mindestens 5 m über den Leitungen",
      "Bei gesperrten Gleisen vertikaler Abstand von 5 m zu den Gleisen",
    ],
    layerMatch: ["bahnanlagen", "bahn"],
    avEligible: true,
  },
  {
    id: "naturschutzgebiete",
    label: "Naturschutz- / Natura-2000-Gebiete",
    paragraph: "§ 21h (3) Nr. 6 LuftVO",
    tatbestand:
      "Normalfall: Betrieb über Naturschutzgebieten, Nationalparks und Natura-2000-Gebieten (FFH- und Vogelschutzgebieten) ist untersagt.",
    auflagen: [
      "Betrieb nur mit ausdrücklicher Zustimmung/Genehmigung der zuständigen Naturschutzbehörde",
      "Nicht durch die luftrechtliche Landes-Allgemeinerlaubnis (§ 21h) gedeckt",
      "Störungen von Tieren, insbesondere in Brut-, Rast- und Setzzeiten, vermeiden",
      "Schutzgebiets- und Mindestflughöhen-Auflagen des jeweiligen Bundeslandes beachten",
    ],
    layerMatch: ["naturschutzgebiet", "naturschutz", "vogelschutz", "nationalpark", "ffh", "natura"],
    avEligible: false,
  },
  {
    id: "wohngrundstuecke",
    label: "Wohngrundstücke",
    paragraph: "§ 21h (3) Nr. 7 LuftVO",
    tatbestand:
      "Normalfall: Überflug von Wohngrundstücken ohne Zustimmung der Berechtigten ist untersagt.",
    auflagen: [
      "Nur in Unterkategorie A1 oder A2",
      "Nur wenn der Überflug zur Zweckerfüllung unumgänglich ist",
      "Betroffene vorab informieren (z. B. Postwurf/Aushang mit Name, Anschrift, Datum/Uhrzeit und ausstellender Behörde)",
      "Max. 30 min pro Tag an höchstens 4 Tagen im Kalenderjahr",
      "Ausreichende Flughöhe zur Wahrung der Privatsphäre",
    ],
    layerMatch: ["wohngrundstück", "wohngrundstuecke", "wohn"],
    avEligible: true,
  },
];

/**
 * Findet die § 21h-Regel, die den gegebenen Geozonen-Layer-Label abdeckt,
 * oder `null`, wenn der Layer nicht vom standardisierten Regelsatz erfasst ist.
 */
export function find21hRuleForLayer(layerLabel?: string | null): Paragraph21hRule | null {
  const label = (layerLabel || "").toLowerCase();
  if (!label) return null;
  for (const rule of PARAGRAPH_21H_RULES) {
    if (rule.layerMatch.some((kw) => label.includes(kw))) return rule;
  }
  return null;
}

/**
 * Kann der gegebene Geozonen-Layer durch eine geografische Landes-
 * Allgemeinerlaubnis (§ 21h) abgedeckt werden? Nur wenn eine passende Regel
 * existiert UND diese `avEligible` ist. Luftsicherheits- und
 * zustimmungspflichtige Kategorien (Flugplätze/HEMS, Flughäfen/CTR, Industrie-/
 * Energieanlagen, Behörden) liefern `false`, weil eine Landes-AV sie
 * rechtlich nicht deckt (DFS/ATC bzw. Betreiber-/Behörden-Zustimmung nötig).
 */
export function is21hLayerAvEligible(layerLabel?: string | null): boolean {
  const rule = find21hRuleForLayer(layerLabel);
  return rule !== null && rule.avEligible === true;
}

/**
 * Ist die Zone eine DEUTSCHE Geozone? DE-Zonen (dipul-WFS, DE-Kachelspeicher,
 * dipul-WMS-GetFeatureInfo) tragen historisch KEIN `country`-Feld; alle anderen
 * Quellen setzen es (ED-269: ISO des Datensatzes, CZ-Kachelspeicher: "CZ",
 * queryGeozonesInArea taggt jede Zone mit dem abgefragten Land). Fehlt das Feld,
 * entscheidet `fallbackIso` (Standortland), Standard "DE" (Legacy-Daten).
 */
export function isGermanGeozone(
  zone: { country?: string | null },
  fallbackIso: string | null = "DE",
): boolean {
  const iso = (zone.country || fallbackIso || "").toUpperCase();
  return iso === "DE";
}

/**
 * EINZIGE Stelle für "§ 21h-Regel einer Zone": liefert die Regel nur für
 * deutsche Zonen. Verhindert, dass die substring-basierte Label-Erkennung
 * ("bahn", "ctr", "energie", "natura" …) auf ausländische Zonen mit deutschen
 * Kategorie-Bezeichnungen greift (z. B. CZ-Kachelspeicher "Bahnanlagen",
 * "Kontrollzonen / ATZ").
 */
export function de21hRule(
  zone: { layerLabel?: string | null; country?: string | null },
  fallbackIso: string | null = "DE",
): Paragraph21hRule | null {
  if (!isGermanGeozone(zone, fallbackIso)) return null;
  return find21hRuleForLayer(zone.layerLabel);
}

/** Kann eine Landes-Allgemeinverfügung (§ 21h) die Zone decken? Nur DE + avEligible. */
export function isDe21hZoneAvEligible(
  zone: { layerLabel?: string | null; country?: string | null },
  fallbackIso: string | null = "DE",
): boolean {
  return de21hRule(zone, fallbackIso)?.avEligible === true;
}

export interface AdditionalDoc {
  title: string;
  url: string;
  icon: "file-text" | "download" | "info" | "shield" | "book-open" | "map" | "external-link";
  /** Nur anbieten, wenn am Standort eine Kontrollzone (CTR) betroffen ist. */
  requiresCtr?: boolean;
}

export interface BundeslandAvInfo {
  behorde: string;
  antragUrl: string;
  infoUrl?: string;
  pdfUrl?: string;
  additionalDocs?: AdditionalDoc[];
}

export const GENERAL_UAS_RESOURCES: AdditionalDoc[] = [
  {
    title: "EU-Drohnenverordnung FAQ (DJI)",
    url: "https://enterprise-insights.dji.com/hubfs/2024%20EU%20Event%20Download/regulation%20FAQ.pdf?hsLang=de",
    icon: "book-open",
  },
  {
    title: "dipul.de - Anträge & Behördendienste",
    url: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    icon: "file-text",
  },
];

export const BUNDESLAND_AV_INFO: Record<string, BundeslandAvInfo> = {
  "Baden-Württemberg": {
    behorde: "Regierungspräsidium Stuttgart",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    infoUrl: "https://rp.baden-wuerttemberg.de/rps/abt4/ref46/drohnen/",
  },
  "Bayern": {
    behorde: "Regierung von Oberbayern - Luftamt Südbayern",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    infoUrl: "https://www.regierung.oberbayern.bayern.de/aufgaben/wirtschaft/luftverkehr/",
  },
  "Berlin": {
    behorde: "Senatsverwaltung für Umwelt, Mobilität, Verbraucher- und Klimaschutz",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Brandenburg": {
    behorde: "Ministerium für Infrastruktur und Landesplanung",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Bremen": {
    behorde: "Senator für Wirtschaft, Arbeit und Häfen",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Hamburg": {
    behorde: "Behörde für Wirtschaft und Innovation",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Hessen": {
    behorde: "Regierungspräsidium Kassel",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    pdfUrl: "https://rp-kassel.hessen.de/sites/rp-kassel.hessen.de/files/2022-11/for_uas_gemeinsame_allgemeinerlaubnis_luftvo_rev5_0.pdf",
    additionalDocs: [
      {
        title: "DFS-Allgemeinverfügung Flugverkehrskontrollfreigaben CTR (NfL 2026-1-3884)",
        url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/nfl-2026-1-3884.pdf?cid=6cw",
        icon: "file-text",
        requiresCtr: true,
      },
      {
        title: "Einzelfreigabe CTR beantragen (DFS PilotService)",
        url: "https://ais.dfs.de/pilotservice/bnl/leisure/airdrone/airdrone_edit.jsp",
        icon: "external-link",
        requiresCtr: true,
      },
    ],
  },
  "Mecklenburg-Vorpommern": {
    behorde: "Landesamt für zentrale Aufgaben und Technik der Polizei, Brand- und Katastrophenschutz",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Niedersachsen": {
    behorde: "Niedersächsische Landesbehörde für Straßenbau und Verkehr",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Nordrhein-Westfalen": {
    behorde: "Bezirksregierung Düsseldorf",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    infoUrl: "https://www.brd.nrw.de/themen/verkehr/luftverkehr",
    additionalDocs: [
      {
        title: "UAS-Betrieb Fliegerhorst Nörvenich (Bundeswehr)",
        url: "https://www.bundeswehr.de/resource/blob/5822982/e2b2d7c06566274d0562f2ec541274f2/download-pdf-infoblatt-dronenfluege-taktisches-luftwaffengeschwader-31-boelcke-data.pdf",
        icon: "shield",
      },
    ],
  },
  "Rheinland-Pfalz": {
    behorde: "Landesbetrieb Mobilität Rheinland-Pfalz",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Saarland": {
    behorde: "Ministerium für Wirtschaft, Innovation, Digitales und Energie",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Sachsen": {
    behorde: "Landesdirektion Sachsen",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Sachsen-Anhalt": {
    behorde: "Landesverwaltungsamt Sachsen-Anhalt",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Schleswig-Holstein": {
    behorde: "Landesbetrieb Straßenbau und Verkehr Schleswig-Holstein",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Thüringen": {
    behorde: "Thüringer Landesamt für Bau und Verkehr",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
};

/**
 * Eine geografische Allgemeinerlaubnis nach § 21h LuftVO — wird pro Bundesland
 * einzeln bei der jeweiligen Landesluftfahrtbehörde beantragt und gilt nur im
 * ausstellenden Land. Setzt ein A2-Fernpilotenzeugnis voraus.
 */
export interface GeoAllgemeinerlaubnis {
  bundesland: Bundesland;
  /** Ablaufdatum (TT.MM.JJJJ). Leer = unbefristet/unbekannt. */
  expirationDate?: string;
  /** Hochgeladene Bescheid-PDF (oder Foto, base64). */
  document?: import("./documents").DocumentRef | null;
}

/** Strikte Datums-Validierung; akzeptiert TT.MM.JJJJ / TT/MM/JJJJ / JJJJ-MM-TT. */
export function parseGermanDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const build = (y: number, mIdx: number, d: number): Date | null => {
    if (y < 1900 || y > 2200 || mIdx < 0 || mIdx > 11 || d < 1 || d > 31) return null;
    const date = new Date(y, mIdx, d);
    if (
      isNaN(date.getTime()) ||
      date.getFullYear() !== y ||
      date.getMonth() !== mIdx ||
      date.getDate() !== d
    )
      return null;
    date.setHours(0, 0, 0, 0);
    return date;
  };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return build(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return build(year, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

/** True, wenn die Erlaubnis ein Ablaufdatum hat, das in der Vergangenheit liegt. */
export function isErlaubnisExpired(e: GeoAllgemeinerlaubnis, now: Date = new Date()): boolean {
  const exp = parseGermanDate(e.expirationDate);
  if (!exp) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return exp.getTime() < today.getTime();
}

/** True, wenn die Erlaubnis aktuell gültig ist (nicht abgelaufen). */
export function isErlaubnisValid(e: GeoAllgemeinerlaubnis, now: Date = new Date()): boolean {
  return !isErlaubnisExpired(e, now);
}

/**
 * Überführt das alte AV-Format ({enabled, bundeslaender[], geozoneTypes[]}) oder
 * eine bereits migrierte Liste in das neue Pro-Bundesland-Listenformat.
 */
export function migrateAllgemeinerlaubnis(raw: any): GeoAllgemeinerlaubnis[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((e) => e && typeof e.bundesland === "string")
      .map((e) => ({
        bundesland: e.bundesland as Bundesland,
        expirationDate: e.expirationDate || undefined,
        document: e.document ?? null,
      }));
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.bundeslaender)) {
    const seen = new Set<string>();
    const result: GeoAllgemeinerlaubnis[] = [];
    for (const bl of raw.bundeslaender) {
      if (typeof bl !== "string" || seen.has(bl)) continue;
      seen.add(bl);
      result.push({ bundesland: bl as Bundesland, expirationDate: undefined, document: null });
    }
    return result;
  }
  return [];
}

export const LICENSE_COUNTRIES = [
  { code: "DE", label: "Deutschland", flag: "DE" },
  { code: "AT", label: "\u00D6sterreich", flag: "AT" },
  { code: "CH", label: "Schweiz", flag: "CH" },
  { code: "LU", label: "Luxemburg", flag: "LU" },
  { code: "NL", label: "Niederlande", flag: "NL" },
  { code: "BE", label: "Belgien", flag: "BE" },
  { code: "FR", label: "Frankreich", flag: "FR" },
  { code: "PL", label: "Polen", flag: "PL" },
  { code: "CZ", label: "Tschechien", flag: "CZ" },
  { code: "DK", label: "D\u00E4nemark", flag: "DK" },
  { code: "IT", label: "Italien", flag: "IT" },
  { code: "ES", label: "Spanien", flag: "ES" },
  { code: "SE", label: "Schweden", flag: "SE" },
  { code: "PT", label: "Portugal", flag: "PT" },
  { code: "IE", label: "Irland", flag: "IE" },
  { code: "GB", label: "Vereinigtes K\u00F6nigreich", flag: "GB" },
  { code: "GR", label: "Griechenland", flag: "GR" },
  { code: "FI", label: "Finnland", flag: "FI" },
  { code: "HR", label: "Kroatien", flag: "HR" },
  { code: "BG", label: "Bulgarien", flag: "BG" },
  { code: "RO", label: "Rum\u00E4nien", flag: "RO" },
  { code: "HU", label: "Ungarn", flag: "HU" },
  { code: "SK", label: "Slowakei", flag: "SK" },
  { code: "SI", label: "Slowenien", flag: "SI" },
  { code: "LT", label: "Litauen", flag: "LT" },
  { code: "LV", label: "Lettland", flag: "LV" },
  { code: "EE", label: "Estland", flag: "EE" },
  { code: "CY", label: "Zypern", flag: "CY" },
  { code: "MT", label: "Malta", flag: "MT" },
  { code: "NO", label: "Norwegen", flag: "NO" },
  { code: "IS", label: "Island", flag: "IS" },
  { code: "LI", label: "Liechtenstein", flag: "LI" },
] as const;

export type LicenseCountryCode = typeof LICENSE_COUNTRIES[number]["code"];

export interface LicenseDetails {
  firstName: string;
  lastName: string;
  identificationNumber: string;
  expirationDate: string;
  country?: LicenseCountryCode;
  /**
   * Vom Piloten gescannter / einkopierter QR-Code-Inhalt seines physischen
   * Kompetenznachweises (z. B. EASA-Verifikations-URL des LBA, „https://...").
   * Wird auf der digitalen Lizenzkarte als QR statt der App-eigenen JSON-
   * Repräsentation gerendert, damit physische und digitale Karte denselben
   * Verifikationslink tragen.
   */
  qrCodeUrl?: string;
}

const DEFAULT_LICENSE_DETAILS: LicenseDetails = {
  firstName: "",
  lastName: "",
  identificationNumber: "",
  expirationDate: "",
  country: "DE",
  qrCodeUrl: "",
};

export interface CountrySpecificPilot {
  insuranceCH1Mio: boolean;
  insuranceATSzr: boolean;
  alphaTangoFR: boolean;
  dFlightIT: boolean;
  caaUK: boolean;
}

export const DEFAULT_COUNTRY_SPECIFIC: CountrySpecificPilot = {
  insuranceCH1Mio: false,
  insuranceATSzr: false,
  alphaTangoFR: false,
  dFlightIT: false,
  caaUK: false,
};

export interface PilotProfile {
  name: string;
  pilotId: string;
  operatorId: string;
  licenseA1A3: boolean;
  licenseA2: boolean;
  licenseSTS: boolean;
  licenseA1A3Details: LicenseDetails;
  licenseA2Details: LicenseDetails;
  licenseSTSDetails: LicenseDetails;
  /** Geografische Allgemeinerlaubnisse — eine Liste mit einem Eintrag pro Bundesland. */
  allgemeinverfuegung: GeoAllgemeinerlaubnis[];
  countrySpecific: CountrySpecificPilot;
  insuranceActive: boolean;
  /**
   * Gewerblich tätig (Berufspilot/Unternehmen). Steuert länderspezifische
   * Regeln, z. B. Frankreich (Arrêté Espace): Agglomeration nur gewerblich,
   * mit Vorab-Meldung an die Präfektur.
   */
  commercialOperator?: boolean;
  /** Ablaufdatum der Haftpflichtversicherung (TT.MM.JJJJ). */
  insuranceExpirationDate?: string;
  /** Hochgeladene Versicherungsbestätigung (PDF/Bild, base64). */
  insuranceDocument?: import("./documents").DocumentRef | null;
  /**
   * Verbands-Versicherung über DMFV / DMO (Deutschland-only). Dahinter
   * steht die LBA-Verbandsbetriebserlaubnis nach Art. 16 EU-VO 2019/947,
   * die FPV-Flüge bis 30 m AGL OHNE Spotter erlaubt. Über 30 m gilt
   * weiterhin Spotter-Pflicht (max. 120 m).
   */
  insuranceVerbandsregelDE?: boolean;
  operatorRegistered: boolean;
  /** Archiv ersetzter/abgelaufener Dokumentfassungen (AV/A2/Versicherung) zur
   * flugzeitgenauen Rekonstruktion. Wird serverseitig fortgeschrieben; der Client
   * sendet dieses Feld NICHT zurück (read-only Sicht). */
  documentArchive?: import("../../shared/schema").ArchivedDocument[] | null;
}

const DEFAULT_PILOT_PROFILE: PilotProfile = {
  name: "",
  pilotId: "",
  operatorId: "",
  licenseA1A3: false,
  licenseA2: false,
  licenseSTS: false,
  licenseA1A3Details: { ...DEFAULT_LICENSE_DETAILS },
  licenseA2Details: { ...DEFAULT_LICENSE_DETAILS },
  licenseSTSDetails: { ...DEFAULT_LICENSE_DETAILS },
  allgemeinverfuegung: [],
  countrySpecific: { ...DEFAULT_COUNTRY_SPECIFIC },
  insuranceActive: false,
  insuranceVerbandsregelDE: false,
  operatorRegistered: false,
};

function mergePilotProfile(data: PilotProfile): PilotProfile {
  // Backward-Compat: ältere Profile haben kein licenseSTSDetails. Wenn STS
  // aktiv ist, aber keine eigenen Details existieren, von A2 (bzw. A1/A3)
  // erben, damit die STS-Karte weiter rendert.
  const stsBase = data.licenseSTSDetails && Object.keys(data.licenseSTSDetails).length > 0
    ? data.licenseSTSDetails
    : (data.licenseA2Details || data.licenseA1A3Details || {});
  return {
    ...DEFAULT_PILOT_PROFILE,
    ...data,
    licenseA1A3Details: { ...DEFAULT_LICENSE_DETAILS, ...(data.licenseA1A3Details || {}) },
    licenseA2Details: { ...DEFAULT_LICENSE_DETAILS, ...(data.licenseA2Details || {}) },
    licenseSTSDetails: { ...DEFAULT_LICENSE_DETAILS, ...stsBase },
    allgemeinverfuegung: migrateAllgemeinerlaubnis(data.allgemeinverfuegung),
    countrySpecific: {
      ...DEFAULT_COUNTRY_SPECIFIC,
      ...(data.countrySpecific || {}),
    },
  };
}

export async function getPilotProfile(opts?: { force?: boolean }): Promise<PilotProfile> {
  // force: In-Memory-Cache UND laufende Anfrage verwerfen, damit wirklich
  // frisch vom Server geladen wird. Nötig, wenn während der Auth-Auflösung
  // (App-Start) versehentlich ein leeres DEFAULT-Profil gecacht wurde.
  if (opts?.force) {
    memCache.delete("pilotProfile");
    inflight.delete("pilotProfile");
  } else {
    const cached = readCache<PilotProfile>("pilotProfile");
    if (cached) return cached;
  }
  return dedupe("pilotProfile", async () => {
    const result = await getPilotProfileFresh();
    writeCache("pilotProfile", result);
    // SORA-Bodenrisiko (CH) nur mit STS-Lizenz auf der Karte
    setSoraLayersAllowed(!!result.licenseSTS);
    return result;
  });
}

async function getPilotProfileFresh(): Promise<PilotProfile> {
  await waitForAuthReady();
  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetProfile());
    if (remote) {
      void writeSnapshot(SNAPSHOT_KEYS.pilotProfile, remote);
      return mergePilotProfile(remote);
    }
    const snap = await readSnapshot<PilotProfile>(SNAPSHOT_KEYS.pilotProfile);
    if (snap && snap.data) {
      console.warn("[storage] Server unerreichbar, nutze Pilotenprofil-Snapshot.");
      return mergePilotProfile(snap.data);
    }
  }
  const data = await getLocalData<PilotProfile>(PILOT_PROFILE_KEY);
  if (!data) return { ...DEFAULT_PILOT_PROFILE };
  return mergePilotProfile(data);
}

export async function savePilotProfile(profile: PilotProfile): Promise<void> {
  invalidateCache("pilotProfile");
  setSoraLayersAllowed(!!profile.licenseSTS);
  await waitForAuthReady();
  if (useServer()) {
    await Api.apiSaveProfile(profile);
    await AsyncStorage.removeItem(PILOT_PROFILE_KEY);
    return;
  }
  await saveLocalData(PILOT_PROFILE_KEY, profile);
}

/**
 * Lädt im Hintergrund die wichtigsten User-Datasets vor (Drohnen, Profil,
 * Settings). Nach Login/App-Start aufrufen — Aufrufer kann das Ergebnis
 * ignorieren (fire-and-forget). Folgendes Fetch aus den Screens trifft dann
 * den 30 s In-Memory-Cache und ist sofort da.
 */
export async function prefetchUserData(): Promise<void> {
  try {
    await Promise.all([
      getDrones().catch(() => undefined),
      getDrones({ includeArchived: true }).catch(() => undefined),
      getPilotProfile().catch(() => undefined),
      getSettings().catch(() => undefined),
    ]);
  } catch {
    // Prefetch ist best-effort.
  }
}

async function loadLogbookEntriesForCounts(): Promise<LogbookEntry[]> {
  if (useServer()) {
    const remote = await safeApi(() => Api.apiGetLogbook());
    if (remote) return remote;
  }
  return (await getLocalData<LogbookEntry[]>(LOGBOOK_KEY)) || [];
}

export async function getFlightCountForDrone(droneId: string): Promise<number> {
  const entries = await loadLogbookEntriesForCounts();
  return entries.filter((e) => e.droneId === droneId).length;
}

export async function getFlightCountsForDrones(droneIds: string[]): Promise<Record<string, number>> {
  const entries = await loadLogbookEntriesForCounts();
  const counts: Record<string, number> = {};
  for (const id of droneIds) {
    counts[id] = 0;
  }
  for (const entry of entries) {
    if (entry.droneId in counts) {
      counts[entry.droneId]++;
    }
  }
  return counts;
}

export function isLicenseComplete(details: LicenseDetails): boolean {
  // Identifizierungsnummer wird zentral aus profile.pilotId bezogen
  // (gleiche ID für alle Lizenzen). Hier nur Name + Gültigkeitsdatum prüfen.
  return !!(
    details.firstName.trim() &&
    details.lastName.trim() &&
    details.expirationDate.trim()
  );
}

/**
 * Aufbauende Lizenz-Hierarchie:
 *   A1/A3 → Voraussetzung für A2 → Voraussetzung für STS.
 * Schaltet abhängige Lizenzen automatisch ab, wenn die Grundlage fehlt.
 */
export function enforceLicenseHierarchy(profile: PilotProfile): PilotProfile {
  const a1a3 = profile.licenseA1A3;
  const a2 = a1a3 && profile.licenseA2;
  const sts = a2 && profile.licenseSTS;
  if (a1a3 === profile.licenseA1A3 && a2 === profile.licenseA2 && sts === profile.licenseSTS) {
    return profile;
  }
  return { ...profile, licenseA1A3: a1a3, licenseA2: a2, licenseSTS: sts };
}

// ---------------------------------------------------------------------------
// Speicher-Wartung beim App-Start (fire-and-forget, wirft nie)
// ---------------------------------------------------------------------------

/** Große Inline-Bilder alter Datensätze in Dateien auslagern und verwaiste Dateien entfernen. */
async function compactBlobList(key: string, spec: BlobSpec): Promise<void> {
  try {
    const raw = await withKeyLock(key, async () => {
      const list = (await getLocalDataForWrite<unknown[]>(key)) || [];
      if (!Array.isArray(list)) return null;
      if (hasInlineBlobs(spec, list)) {
        await saveLocalData(key, list);
        return (await getLocalDataForWrite<unknown[]>(key)) || [];
      }
      return list;
    });
    // Nur aufräumen, wenn die Liste sicher gelesen wurde.
    if (Array.isArray(raw)) await collectBlobGarbage(spec, raw);
  } catch (e) {
    console.warn(`[storage] Wartung ${key} übersprungen:`, (e as Error)?.message);
  }
}

let maintenancePromise: Promise<void> | null = null;

/**
 * Einmal pro App-Start: Caches aus AsyncStorage in den Datei-Cache
 * verschieben, alte dataCache-Dateien löschen, Karten-Snapshots aus
 * flight_sessions/logbook auslagern. Nutzerdaten werden nie entfernt.
 */
export function runStorageMaintenance(): Promise<void> {
  if (maintenancePromise) return maintenancePromise;
  maintenancePromise = (async () => {
    try {
      const r = await migrateCachesToFiles(AsyncStorage, fileCacheStorage);
      if (r.moved.length || r.dropped.length) {
        console.log(`[storage] Caches aus AsyncStorage: ${r.moved.length} verschoben, ${r.dropped.length} verworfen.`);
      }
    } catch {
      // best-effort
    }
    await pruneFileCache(DATA_CACHE_PREFIX, 2 * DATA_CACHE_MAX_AGE_MS).catch(() => 0);
    await compactBlobList(FLIGHT_SESSIONS_KEY, SESSION_BLOB_SPEC);
    await compactBlobList(LOGBOOK_KEY, LOGBOOK_BLOB_SPEC);
  })();
  return maintenancePromise;
}
