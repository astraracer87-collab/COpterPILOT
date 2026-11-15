// Länder-Nutzung: Daten zur Einstellung (countryUsage.ts) aufräumen und
// Offline-Länder automatisch aktuell halten.
//
// - applyCountryUsage(iso, usage): Einstellung setzen und die Daten anpassen:
//   * off:     alle herunterladbaren Daten des Landes löschen (Karten-/Luftbild-
//              und Geozonen-Kacheln, Kachelspeicher, ED-269-Bestand, altes
//              Offline-Paket, Hindernis-Kacheln, zwischengespeicherte Live-
//              Ergebnisse). Datei-IMPORTE bleiben erhalten (nicht erneut
//              herunterladbar) und werden nur durch „Import entfernen“ gelöscht.
//              Mit einem anderen aktiven Land geteilte Daten bleiben (LI/CH:
//              BAZL-Datensatz und swisstopo-Kacheln; Hindernis-Kacheln anderer
//              Offline-Länder).
//   * online:  Offline-Pakete (Karten, Luftbild, Kachelspeicher, Hindernisse)
//              löschen; der kleine ED-269-Landesbestand bleibt als
//              Zwischenspeicher höchstens 24 h (sweepOnlineCaches).
//   * offline: Pakete laden (automatische Synchronisation, große Pakete nur im
//              WLAN bzw. mit Erlaubnis für mobile Daten).
// - cleanupDisabledCountries(): „Alle deaktivierten Länder bereinigen“.
// - syncOfflineCountries(): beim App-Start und regelmäßig (6 h) alle Offline-
//   Länder prüfen und aktualisieren (Teil-A-Regeln), Fortschritt für die
//   Einstellungen (onOfflineSyncChange).
//
// RN-frei: die echten Speicher-Funktionen werden lazy geladen; Tests ersetzen
// die Umgebung (__setCountryDataEnvForTests).

import {
  countriesOfSource,
  countriesWithUsage,
  getCountryUsage,
  isGeozoneSourceEnabled,
  isGeozoneSourceOffline,
  loadCountryUsage,
  ONLINE_CACHE_MAX_AGE_MS,
  setCountryUsage,
  USAGE_COUNTRIES,
  type CountryUsage,
} from "./countryUsage";
import { getGeozoneSourceMeta, resolveGeozoneSourceIso } from "../../shared/geozoneSourceMeta";

export interface OfflineSyncProgress {
  key: string;
  label?: string;
  percentage: number;
  state: "inactive" | "active" | "complete" | "error";
  error?: string;
}

export interface OfflineSyncCountryResult {
  iso: string;
  /** "updated" = geladen/aktualisiert, "current" = aktuell, "pending-wifi" = wartet auf WLAN */
  status: "updated" | "current" | "pending-wifi" | "failed" | "skipped";
  message?: string;
}

export interface CountryDataEnv {
  /** Offline-Pakete eines Landes löschen (Kacheln, Kachelspeicher, Hindernisse, Konfiguration; geteilte Daten bleiben). */
  deletePacks(iso: string): Promise<void>;
  /** Altes Offline-Paket (offlineStore: Zonen + NOTAMs) löschen. */
  deleteLegacyPack(iso: string): Promise<void>;
  /** Heruntergeladenen ED-269-Bestand löschen, Import behalten. */
  deleteDownloadedDataset(sourceIso: string): Promise<{ keptImport: boolean }>;
  /** Kachelspeicher (DE/FR/CZ/ES) löschen. */
  deleteTileStore(iso: string): Promise<void>;
  /** Zwischengespeicherte Live-Ergebnisse des Landes löschen. */
  deleteLiveResults(iso: string): Promise<void>;
  /** Stand des ED-269-Bestands (ohne Netz, ohne die Datei zu lesen; imported null = unbekannt) */
  datasetInfo(sourceIso: string): Promise<{ fetchedAt: number; imported: boolean | null } | null>;
  /** Länder mit gespeicherten Daten (Migration) */
  storedDataIsos(): Promise<string[]>;
  now(): number;
  isOffline(): boolean;
  isWifi(): Promise<boolean>;
  largePacksOnMobile(): Promise<boolean>;
  /** Ein Offline-Land prüfen/aktualisieren (offlineMaps.autoSyncCountry). */
  syncCountry(iso: string, allowLarge: boolean, onProgress: (p: OfflineSyncProgress) => void): Promise<OfflineSyncCountryResult>;
}

// Lazy-Module (statische require-Pfade für Metro; unter tsx ohne RN-Graph).
/* eslint-disable @typescript-eslint/no-require-imports */
function tryReq<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}
const offlineMapsMod = () => tryReq(() => require("./offlineMaps") as typeof import("./offlineMaps"));
const offlineStoreMod = () => tryReq(() => require("./offlineStore") as typeof import("./offlineStore"));
const ed269StoreMod = () => tryReq(() => require("./geozoneDirect/ed269Store") as typeof import("./geozoneDirect/ed269Store"));
const tileStoreMod = () => tryReq(() => require("./geozoneTiles/tileStore") as typeof import("./geozoneTiles/tileStore"));
const resultCacheMod = () => tryReq(() => require("./offlineResultCache") as typeof import("./offlineResultCache"));
const detectionMod = () => tryReq(() => require("../../shared/countryDetection") as typeof import("../../shared/countryDetection"));
const largePackMod = () => tryReq(() => require("./geozoneSources/largePackSetting") as typeof import("./geozoneSources/largePackSetting"));
const networkMod = () => tryReq(() => require("./network") as { isOfflineNow(): boolean });
/* eslint-enable @typescript-eslint/no-require-imports */

/** Live-Ergebnis-Schlüssel eines Landes: „ES_…“/„DE_…“, ältere DE-Schlüssel ohne Präfix (Koordinaten). */
export function liveResultKeyBelongsTo(key: string, iso: string, detect: (lat: number, lon: number) => string | null): boolean {
  const up = iso.toUpperCase();
  if (key.startsWith(`${up}_`)) return true;
  const m = /^(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_\d+$/.exec(key);
  if (!m) return false;
  try {
    return (detect(Number(m[1]), Number(m[2])) || "").toUpperCase() === up;
  } catch {
    return false;
  }
}

const defaultEnv: CountryDataEnv = {
  async deletePacks(iso) {
    await offlineMapsMod()?.deleteCountry(iso);
  },
  async deleteLegacyPack(iso) {
    await offlineStoreMod()?.deleteOfflinePack(iso);
  },
  async deleteDownloadedDataset(sourceIso) {
    const mod = ed269StoreMod();
    return mod ? mod.deleteDownloadedEd269Dataset(sourceIso) : { keptImport: false };
  },
  async deleteTileStore(iso) {
    await tileStoreMod()?.deleteTileStore(iso);
  },
  async deleteLiveResults(iso) {
    const cache = resultCacheMod();
    const det = detectionMod();
    if (!cache) return;
    await cache.removeOfflineResults("geozones-live", (k) =>
      liveResultKeyBelongsTo(k, iso, (lat, lon) => det?.detectCountryFromCoordinates(lat, lon) ?? null),
    );
  },
  async datasetInfo(sourceIso) {
    return (await ed269StoreMod()?.storedEd269Info(sourceIso).catch(() => null)) ?? null;
  },
  async storedDataIsos() {
    const out = new Set<string>();
    const maps = offlineMapsMod();
    for (const c of (await maps?.loadOfflineConfigs().catch(() => [])) ?? []) out.add(c.iso);
    const ed = ed269StoreMod();
    for (const iso of (await ed?.listStoredEd269Isos().catch(() => [])) ?? []) out.add(iso);
    const ts = tileStoreMod();
    if (ts) {
      await ts.loadTileStoreMeta().catch(() => {});
      for (const iso of ts.tiledGeozoneIsos()) out.add(iso);
    }
    const store = offlineStoreMod();
    for (const p of (await store?.listOfflinePacks().catch(() => [])) ?? []) out.add(p.iso);
    return [...out];
  },
  now: () => Date.now(),
  isOffline() {
    try {
      return !!networkMod()?.isOfflineNow();
    } catch {
      return false;
    }
  },
  async isWifi() {
    return (await tileStoreMod()?.isOnWifi().catch(() => false)) ?? false;
  },
  async largePacksOnMobile() {
    return (await largePackMod()?.loadLargePacksOnMobile()) ?? false;
  },
  async syncCountry(iso, allowLarge, onProgress) {
    const maps = offlineMapsMod();
    if (!maps) return { iso, status: "skipped" };
    return maps.autoSyncCountry(iso, allowLarge, onProgress);
  },
};

let env: CountryDataEnv = defaultEnv;

/** Nur für Tests: Umgebung ersetzen (null = Standard) und Sync-Zustand leeren. */
export function __setCountryDataEnvForTests(e: Partial<CountryDataEnv> | null): void {
  env = e ? { ...defaultEnv, ...e } : defaultEnv;
  syncState = {};
  syncRunning = null;
  lastSyncAt = 0;
  knownImports.clear();
}

/** Migration: Länder mit gespeicherten Daten (Datensatz-ISOs → App-Länder). */
export async function probeStoredDataIsos(): Promise<string[]> {
  const raw = await env.storedDataIsos().catch(() => [] as string[]);
  const out = new Set<string>();
  const appIsos = new Set(USAGE_COUNTRIES.map((c) => c.iso));
  for (const iso of raw) {
    const up = String(iso).toUpperCase();
    // Ein gemeinsamer Datensatz (CH-BAZL) zählt für das Hauptland; LI nur mit eigener Konfiguration.
    if (appIsos.has(up)) out.add(up);
  }
  return [...out];
}

export interface PurgeResult {
  iso: string;
  /** Datei-Import blieb erhalten */
  keptImport: boolean;
  /** Mit einem anderen aktiven Land geteilter Datensatz blieb erhalten */
  keptShared: boolean;
}

/**
 * Daten eines Landes löschen. "off": alles Herunterladbare (Import bleibt);
 * "online": nur Offline-Pakete (ED-269-Zwischenspeicher bleibt ≤ 24 h).
 */
export async function purgeCountryData(iso: string, mode: "off" | "online"): Promise<PurgeResult> {
  const up = String(iso || "").toUpperCase();
  const source = resolveGeozoneSourceIso(up);
  const result: PurgeResult = { iso: up, keptImport: false, keptShared: false };
  await env.deletePacks(up).catch(() => {});
  await env.deleteLegacyPack(up).catch(() => {});
  if (mode === "online") return result;
  // Gemeinsamer Datensatz (LI im CH-BAZL-Bestand): nur löschen, wenn kein Land
  // der Quelle mehr aktiv ist.
  if (isGeozoneSourceEnabled(source) && countriesOfSource(source).some((c) => c !== up)) {
    result.keptShared = true;
  } else {
    const meta = getGeozoneSourceMeta(source);
    if (meta?.offline === "ed269-store" || meta?.offline === "import") {
      const r = await env.deleteDownloadedDataset(source).catch(() => ({ keptImport: false }));
      result.keptImport = r.keptImport;
    }
    if (meta?.offline === "tile-store") await env.deleteTileStore(source).catch(() => {});
  }
  await env.deleteLiveResults(up).catch(() => {});
  return result;
}

/**
 * Nutzung setzen und Daten anpassen. Rückgabe: Ergebnis der Bereinigung (off/
 * online) bzw. null. Bestätigungen fragt die Oberfläche vorher ab.
 */
export async function applyCountryUsage(iso: string, usage: CountryUsage): Promise<PurgeResult | null> {
  await loadCountryUsage();
  const prev = getCountryUsage(iso);
  await setCountryUsage(iso, usage);
  if (usage === "off") return purgeCountryData(iso, "off");
  if (usage === "online" && prev === "offline") return purgeCountryData(iso, "online");
  if (usage === "offline" && prev !== "offline") void syncOfflineCountries("enabled", [iso]).catch(() => {});
  return null;
}

/** „Alle deaktivierten Länder bereinigen“. */
export async function cleanupDisabledCountries(): Promise<PurgeResult[]> {
  await loadCountryUsage();
  const out: PurgeResult[] = [];
  for (const iso of countriesWithUsage("off")) out.push(await purgeCountryData(iso, "off"));
  return out;
}

/**
 * „Online“-Länder: ED-269-Bestand älter als 24 h vom Gerät löschen (Import
 * bleibt). Datensätze, die ein Offline-Land mitnutzt (CH für LI), bleiben.
 */
const knownImports = new Set<string>();
export async function sweepOnlineCaches(): Promise<string[]> {
  await loadCountryUsage();
  const removed: string[] = [];
  const now = env.now();
  const sources = new Set(countriesWithUsage("online").map((i) => resolveGeozoneSourceIso(i)));
  for (const source of sources) {
    const meta = getGeozoneSourceMeta(source);
    if (meta?.offline !== "ed269-store") continue;
    if (isGeozoneSourceOffline(source)) continue;
    if (knownImports.has(source)) continue;
    const info = await env.datasetInfo(source).catch(() => null);
    if (!info || info.imported) continue;
    if (now - info.fetchedAt < ONLINE_CACHE_MAX_AGE_MS) continue;
    const r = await env.deleteDownloadedDataset(source).catch(() => ({ keptImport: false }));
    if (r.keptImport) knownImports.add(source);
    else removed.push(source);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Automatische Synchronisation der Offline-Länder
// ---------------------------------------------------------------------------

export interface OfflineSyncCountryState {
  running: boolean;
  packs: Record<string, OfflineSyncProgress>;
  result?: OfflineSyncCountryResult;
  at?: number;
}

export type OfflineSyncReason = "start" | "periodic" | "enabled" | "manual";

/** Abstand der regelmäßigen Prüfung (App geöffnet). */
export const OFFLINE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

let syncState: Record<string, OfflineSyncCountryState> = {};
let syncRunning: Promise<OfflineSyncCountryResult[]> | null = null;
let lastSyncAt = 0;
const syncListeners = new Set<() => void>();

function emitSync(): void {
  for (const l of syncListeners) {
    try {
      l();
    } catch {}
  }
}

export function getOfflineSyncState(): Record<string, OfflineSyncCountryState> {
  return syncState;
}

export function onOfflineSyncChange(l: () => void): () => void {
  syncListeners.add(l);
  return () => {
    syncListeners.delete(l);
  };
}

function patchSync(iso: string, fn: (s: OfflineSyncCountryState) => OfflineSyncCountryState): void {
  syncState = { ...syncState, [iso]: fn(syncState[iso] ?? { running: false, packs: {} }) };
  emitSync();
}

/**
 * Alle (bzw. die genannten) Offline-Länder prüfen und aktualisieren. Offline
 * passiert nichts; große Pakete nur im WLAN bzw. mit Erlaubnis.
 */
export async function syncOfflineCountries(reason: OfflineSyncReason, only?: string[]): Promise<OfflineSyncCountryResult[]> {
  if (syncRunning) {
    await syncRunning.catch(() => {});
    if (!only) return [];
  }
  const run = (async () => {
    await loadCountryUsage();
    const offline = countriesWithUsage("offline");
    const isos = only ? only.map((i) => i.toUpperCase()).filter((i) => offline.includes(i)) : offline;
    if (env.isOffline()) return isos.map((iso) => ({ iso, status: "skipped" as const, message: "Gerät offline" }));
    const allowLarge = (await env.isWifi().catch(() => false)) || (await env.largePacksOnMobile().catch(() => false));
    const results: OfflineSyncCountryResult[] = [];
    for (const iso of isos) {
      if (getCountryUsage(iso) !== "offline") continue;
      patchSync(iso, (s) => ({ ...s, running: true }));
      let r: OfflineSyncCountryResult;
      try {
        r = await env.syncCountry(iso, allowLarge, (p) =>
          patchSync(iso, (s) => ({ ...s, packs: { ...s.packs, [p.key]: p } })),
        );
      } catch (e: any) {
        r = { iso, status: "failed", message: String(e?.message || e) };
      }
      results.push(r);
      patchSync(iso, (s) => ({ ...s, running: false, result: r, at: env.now() }));
    }
    if (!only || reason === "start" || reason === "periodic") lastSyncAt = env.now();
    return results;
  })();
  syncRunning = run;
  try {
    return await run;
  } finally {
    if (syncRunning === run) syncRunning = null;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Beim App-Start: Einstellung laden (Migration), „online“-Zwischenspeicher
 * aufräumen, Offline-Länder prüfen und danach alle 6 h erneut.
 */
export function startCountryUsage(startDelayMs = 20_000): void {
  void loadCountryUsage().catch(() => {});
  setTimeout(() => {
    void (async () => {
      await sweepOnlineCaches().catch(() => []);
      await syncOfflineCountries("start").catch(() => []);
    })();
  }, startDelayMs);
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    // „Online“-Zwischenspeicher alle 15 min prüfen (höchstens 24 h auf dem Gerät)
    void sweepOnlineCaches().catch(() => []);
    if (env.now() - lastSyncAt < OFFLINE_SYNC_INTERVAL_MS - 60_000) return;
    void syncOfflineCountries("periodic").catch(() => []);
  }, 15 * 60 * 1000);
}

/** Regelmäßige Prüfung beenden (Tests). */
export function stopCountryUsage(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
