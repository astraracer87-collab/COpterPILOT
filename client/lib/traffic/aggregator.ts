// Clientseitiger Live-Verkehrs-Aggregator.
//
// Ersetzt den früheren Server-Aggregator (server/aggregator.ts, Endpunkte
// /api/traffic/v2/nearby und /status). Die App fragt die öffentlichen Quellen
// jetzt direkt ab, führt sie zusammen (ICAO-Hex, Registrierung, Fuzzy-PIA) und
// hält einen kleinen In-Memory-Store mit Trails (10 min).
//
// Polling: Es gibt KEINEN eigenen Hintergrund-Timer. Jede Quelle wird nur dann
// abgefragt, wenn ein Aufrufer (Radar/Flight-Check, alle 2 s) Daten anfordert
// UND das quelleneigene Intervall abgelaufen ist. Damit respektiert der
// Aggregator die Kadenz der Aufrufer, pollt nie schneller als der Server es tat,
// und verursacht keinen Datenverkehr, solange kein Radar offen ist.
//
// Geländehöhe/AGL: getNearbyAircraft reichert die Ziele im Radius gedrosselt
// (enrichAircraftWithElevation, max. ein Open-Meteo-Sammelabruf je 15 s,
// Cache nach gerundeter Position) mit groundElevation/aglAltitude an. Damit
// greifen Boden-Filter (rollende Flugzeuge) und AGL-Labels wieder. Offline /
// Fehler → bleiben null (Verhalten wie vorher).
import { enrichAircraftWithElevation, getElevationFromCache } from "../elevation";
import type { AircraftState, DataSource, SourceStatus } from "../opensky";
import { refineCategoryByType } from "./classify";
import { angleDiff, bearingDeg, bearingFromTo, haversineKm, quickDistanceM } from "./geo";
import { mergeByIcao } from "./merge";
import { fetchSource } from "./sources";
import type { RawState, SourceResult, Tile } from "./types";

export interface TrailPoint { lat: number; lon: number; t: number; }
export interface AircraftTrail { id: string; points: TrailPoint[]; }

interface StoredAircraft extends AircraftState {
  lastSeen: number;
  aglAltitude: number | null;
  groundElevation: number | null;
  trail: TrailPoint[];
}

export const ALL_DATA_SOURCES: DataSource[] = [
  "opensky", "adsbfi", "adsbone", "airplaneslive", "adsblol", "ogn", "fr24",
];

// Aktive Quellen. Basis ist die Server-Auswahl (OGN, airplanes.live, adsb.lol).
// adsb.fi kommt als Ersatz dazu: der Server las fälschlich das Feld "ac",
// adsb.fi liefert aber "aircraft" — deshalb lieferte es dort "0 Flugzeuge".
// FR24 (inoffizieller Web-Feed, Nutzung mit Zustimmung von Flightradar24, siehe
// docs/air-traffic-quellen.md) ist Zusatzquelle: Merge/Dedupe per ICAO-Hex bzw.
// Registrierung, Fallback über sourceStatus; zur Laufzeit abschaltbar über
// setTrafficSourceEnabled("fr24", false).
// Muss synchron zu ENABLED_SOURCES in lib/trafficStatus.ts bleiben.
export const DEFAULT_ENABLED_DATA_SOURCES: readonly DataSource[] = [
  "ogn", "airplaneslive", "adsblol", "adsbfi", "fr24",
];
const enabledSources = new Set<DataSource>(DEFAULT_ENABLED_DATA_SOURCES);
/** Aktuell aktive Quellen (Live-Ansicht; Änderung über setTrafficSourceEnabled). */
export const ENABLED_DATA_SOURCES: ReadonlySet<DataSource> = enabledSources;

// Pro-Quelle Mindestabstand zwischen zwei Abfragen. Der Server fragte die
// ADS-B-Aggregatoren alle 2 s ab (für ALLE Nutzer zusammen). Ein einzelnes
// Gerät nimmt bewusst etwas mehr Abstand, um die freien APIs zu schonen.
const SOURCE_INTERVALS: Record<DataSource, number> = {
  adsbfi: 4000,
  adsblol: 3000,
  airplaneslive: 3000,
  adsbone: 4000,
  opensky: 10_000,
  ogn: 5000,
  // FR24 nennt keine Rate-Limits → defensiv wie die Webseite (~5–8 s je
  // Ausschnitt), Bounding-Box auf FR24_MAX_DIST_NM gekappt (sources.ts).
  fr24: 8000,
};
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

const MAX_AIRCRAFT = 3000;
const MAX_TRAIL_POINTS = 120;
const TRAIL_MAX_AGE_MS = 10 * 60_000;
const STALE_AIRCRAFT_MS = 2 * 60_000;
const MIN_TRAIL_DIST_M = 150;
const MIN_TRAIL_TIME_MS = 10_000;
const MAX_TRAIL_TURN_DEG = 90;

const MAX_NEARBY_AIRCRAFT = 80;
const MAX_NEARBY_TRAILS = 30;

// --- Regionen / Kacheln -------------------------------------------------------
// Wie auf dem Server: abgefragt wird dort, wo das Radar tatsächlich offen ist.
// Auf einem Gerät sind das höchstens ein bis zwei Standorte gleichzeitig
// (z. B. Flight-Check + Live-Radar).
interface ClientRegion { lat: number; lon: number; radiusKm: number; lastAt: number; }
const clientRegions = new Map<string, ClientRegion>();
const REGION_GRID_DEG = 0.25;            // ~28 km Gitterzellen
const REGION_TTL_MS = 60_000;            // Aufrufer pollen alle 2 s
const MAX_DYNAMIC_TILES = 2;
const TILE_MIN_DIST_NM = 20;
const TILE_MAX_DIST_NM = 250;            // Hard-Limit der ADS-B-Point-APIs
const TILE_MARGIN_NM = 15;               // Kontext für Trails über den Radius hinaus
// Wie lange auf die erste Antwort für eine neue Region gewartet wird, bevor
// (ggf. leere) Daten zurückgegeben werden.
const FIRST_FETCH_WAIT_MS = 9000;

function regionKey(lat: number, lon: number): string {
  return `${Math.round(lat / REGION_GRID_DEG)},${Math.round(lon / REGION_GRID_DEG)}`;
}

function evictStaleRegions(now: number): void {
  for (const [k, r] of clientRegions) {
    if (now - r.lastAt > REGION_TTL_MS) clientRegions.delete(k);
  }
}

/** true = Region war noch nicht aktiv (Sofort-Poll nötig). */
function noteClientRegion(lat: number, lon: number, radiusKm: number, now: number): boolean {
  evictStaleRegions(now);
  const key = regionKey(lat, lon);
  const prev = clientRegions.get(key);
  // Größerer Radius als bisher abgedeckt → ebenfalls wie neue Region behandeln.
  const isNew = !prev || radiusKm > prev.radiusKm * 1.2;
  clientRegions.set(key, { lat, lon, radiusKm, lastAt: now });
  if (clientRegions.size > MAX_DYNAMIC_TILES * 4) {
    const oldest = [...clientRegions.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
    for (let i = 0; i < oldest.length - MAX_DYNAMIC_TILES * 4; i++) clientRegions.delete(oldest[i][0]);
  }
  return isNew;
}

function getActiveTiles(): Tile[] {
  evictStaleRegions(Date.now());
  return [...clientRegions.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, MAX_DYNAMIC_TILES)
    .map((r) => ({
      lat: r.lat,
      lon: r.lon,
      distNm: Math.max(
        TILE_MIN_DIST_NM,
        Math.min(TILE_MAX_DIST_NM, Math.ceil(r.radiusKm / 1.852) + TILE_MARGIN_NM),
      ),
    }));
}

// --- Zustand ------------------------------------------------------------------

interface SourceSchedule {
  intervalMs: number;
  nextDueAt: number;
  inFlight: Promise<void> | null;
  backoffStreak: number;
  backoffUntilAt: number;
}

function makeRecord<T>(fn: (src: DataSource) => T): Record<DataSource, T> {
  const out = {} as Record<DataSource, T>;
  for (const s of ALL_DATA_SOURCES) out[s] = fn(s);
  return out;
}

const store = new Map<string, StoredAircraft>();
// Startwert wie auf dem Server: aktive Quellen "ok" (noch kein Fehler
// beobachtet), deaktivierte "error".
const sourceStatus: Record<DataSource, SourceStatus> = makeRecord((s) => (ENABLED_DATA_SOURCES.has(s) ? "ok" : "error"));
const sourceLastOk: Record<DataSource, number> = makeRecord(() => 0);
const lastSourceStates: Record<DataSource, RawState[]> = makeRecord(() => []);
const sourceSchedules: Record<DataSource, SourceSchedule> = makeRecord((s) => ({
  intervalMs: SOURCE_INTERVALS[s],
  nextDueAt: 0,
  inFlight: null,
  backoffStreak: 0,
  backoffUntilAt: 0,
}));

let started = false;
let pollCycle = 0;
let lastPollAt = 0;
let lastSnapshotAt = 0;
let lastCycleDurationMs = 0;
const cycleDurations: number[] = [];
const CYCLE_DURATION_WINDOW = 20;

/** Ist die Quelle aktuell zum Abfragen freigegeben? */
export function isTrafficSourceEnabled(src: DataSource): boolean {
  return enabledSources.has(src);
}

/**
 * Quelle zur Laufzeit an-/abschalten (z. B. FR24). Abschalten verwirft den
 * letzten Snapshot der Quelle sofort (keine Phantom-Ziele) und setzt den
 * Status auf "error" (= nicht aktiv, wie bei deaktivierten Quellen üblich).
 * Anschalten macht die Quelle sofort fällig.
 */
export function setTrafficSourceEnabled(src: DataSource, enabled: boolean): void {
  if (!ALL_DATA_SOURCES.includes(src)) return;
  const sched = sourceSchedules[src];
  if (enabled) {
    if (enabledSources.has(src)) return;
    enabledSources.add(src);
    sourceStatus[src] = "ok";
    sched.nextDueAt = 0;
    sched.backoffStreak = 0;
    sched.backoffUntilAt = 0;
  } else {
    if (!enabledSources.has(src)) return;
    enabledSources.delete(src);
    sourceStatus[src] = "error";
    lastSourceStates[src] = [];
  }
}

function noteSourceSuccess(src: DataSource): void {
  const s = sourceSchedules[src];
  s.backoffStreak = 0;
  s.backoffUntilAt = 0;
}

function noteSourceFailure(src: DataSource, isRateLimit: boolean): void {
  const s = sourceSchedules[src];
  if (!isRateLimit) return; // nur 429/403 löst exponentielles Backoff aus
  s.backoffStreak = Math.min(s.backoffStreak + 1, 8);
  const backoff = Math.min(BACKOFF_MIN_MS * 2 ** (s.backoffStreak - 1), BACKOFF_MAX_MS);
  s.backoffUntilAt = Date.now() + backoff;
}

// --- Store / Trails -----------------------------------------------------------

function appendTrailPoint(stored: StoredAircraft, lat: number, lon: number, t: number): void {
  const trail = stored.trail;
  while (trail.length > 0 && t - trail[0].t > TRAIL_MAX_AGE_MS) trail.shift();
  const last = trail.length > 0 ? trail[trail.length - 1] : null;
  if (!last) {
    trail.push({ lat, lon, t });
    return;
  }
  const distM = quickDistanceM(last.lat, last.lon, lat, lon);
  const dt = t - last.t;
  if (distM < MIN_TRAIL_DIST_M && dt < MIN_TRAIL_TIME_MS) return;
  if (trail.length >= 2 && distM < 2000) {
    const prev = trail[trail.length - 2];
    const prevB = bearingDeg(prev.lat, prev.lon, last.lat, last.lon);
    const newB = bearingDeg(last.lat, last.lon, lat, lon);
    if (angleDiff(prevB, newB) > MAX_TRAIL_TURN_DEG && distM < 500) return;
  }
  trail.push({ lat, lon, t });
  if (trail.length > MAX_TRAIL_POINTS) trail.splice(0, trail.length - MAX_TRAIL_POINTS);
}

function applyToStore(merged: RawState[], now: number): void {
  for (const fresh of merged) {
    // OGN liefert das Alter je Position mit → lastSeen entsprechend zurückdatieren,
    // damit maxAgeSec der Aufrufer auch für OGN-Meldungen greift.
    const seenAt = now - Math.max(0, fresh.reportAgeMs ?? 0);
    const existing = store.get(fresh.icao24);
    if (existing) {
      // Ältere Meldung als bereits gespeichert → ignorieren (kein Rücksprung).
      if (seenAt < existing.lastSeen) continue;
      existing.callsign = fresh.callsign || existing.callsign;
      existing.originCountry = fresh.originCountry || existing.originCountry;
      existing.longitude = fresh.longitude;
      existing.latitude = fresh.latitude;
      if (fresh.baroAltitude != null) existing.baroAltitude = fresh.baroAltitude;
      if (fresh.geoAltitude != null) existing.geoAltitude = fresh.geoAltitude;
      existing.onGround = fresh.onGround;
      if (fresh.velocity != null) existing.velocity = fresh.velocity;
      if (fresh.trueTrack != null) existing.trueTrack = fresh.trueTrack;
      if (fresh.verticalRate != null) existing.verticalRate = fresh.verticalRate;
      if (fresh.category !== "unknown") existing.category = fresh.category;
      existing.category = refineCategoryByType(
        existing.category,
        fresh.aircraftType || existing.aircraftType,
        fresh.registration || existing.registration,
        fresh.aircraftDesc || existing.aircraftDesc,
      );
      existing.sources = fresh.sources;
      existing.lastSeen = seenAt;
      existing.isStale = false;
      if (fresh.registration) existing.registration = fresh.registration;
      if (fresh.aircraftType) existing.aircraftType = fresh.aircraftType;
      if (fresh.aircraftDesc) existing.aircraftDesc = fresh.aircraftDesc;
      if (fresh.operator) existing.operator = fresh.operator;
      if (fresh.cn) existing.cn = fresh.cn;
      if (fresh.military) existing.military = true;
      if (fresh.interesting) existing.interesting = true;
      if (fresh.pia) existing.pia = true;
      if (fresh.ladd) existing.ladd = true;
      if (fresh.originIata) existing.originIata = fresh.originIata;
      if (fresh.destIata) existing.destIata = fresh.destIata;
      if (fresh.flightNumber) existing.flightNumber = fresh.flightNumber;
      if (fresh.onGround) {
        if (existing.trail.length > 0) existing.trail = [];
      } else {
        appendTrailPoint(existing, fresh.latitude, fresh.longitude, seenAt);
      }
    } else {
      const { reportAgeMs: _age, ...rest } = fresh;
      const ac: StoredAircraft = {
        ...rest,
        category: refineCategoryByType(fresh.category, fresh.aircraftType, fresh.registration, fresh.aircraftDesc),
        lastSeen: seenAt,
        aglAltitude: null,
        groundElevation: null,
        trail: [],
      };
      if (!ac.onGround) appendTrailPoint(ac, ac.latitude, ac.longitude, seenAt);
      store.set(ac.icao24, ac);
    }
  }
}

function evictStale(now: number): void {
  for (const [id, ac] of store) {
    if (now - ac.lastSeen > STALE_AIRCRAFT_MS) store.delete(id);
  }
  if (store.size > MAX_AIRCRAFT) {
    const entries = Array.from(store.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    const toRemove = store.size - MAX_AIRCRAFT;
    for (let i = 0; i < toRemove; i++) store.delete(entries[i][0]);
  }
}

// --- Polling ------------------------------------------------------------------

function ingest(src: DataSource, result: SourceResult): void {
  // Während des Abrufs abgeschaltet → Ergebnis verwerfen.
  if (!enabledSources.has(src)) return;
  const now = Date.now();
  sourceStatus[src] = result.status;
  const isRateLimited = Boolean(result.rateLimited);
  if (result.status === "ok") {
    sourceLastOk[src] = now;
    lastSourceStates[src] = result.states;
    if (isRateLimited) noteSourceFailure(src, true);
    else noteSourceSuccess(src);
  } else {
    // Veralteten Snapshot dieser Quelle verwerfen, damit keine
    // Phantom-Flugzeuge am Leben gehalten werden.
    lastSourceStates[src] = [];
    noteSourceFailure(src, isRateLimited);
  }
  // Nur Snapshots einbeziehen, die noch frisch sind — sonst würden nach einer
  // Polling-Pause (Radar geschlossen) alte Positionen mit lastSeen=jetzt
  // wiederbelebt.
  const { merged, droppedIds } = mergeByIcao(ALL_DATA_SOURCES.map((s) => {
    const freshWindow = Math.max(15_000, sourceSchedules[s].intervalMs * 3);
    return { states: now - sourceLastOk[s] <= freshWindow ? lastSourceStates[s] : [] };
  }));
  // Geister entfernen (z. B. ogn_flr* nach Merge zum echten ICAO-Hex).
  for (const id of droppedIds) store.delete(id);
  applyToStore(merged, now);
  evictStale(now);
  lastSnapshotAt = now;
  lastPollAt = now;
}

function pollSource(src: DataSource, tiles: Tile[]): Promise<void> {
  const sched = sourceSchedules[src];
  if (sched.inFlight) return sched.inFlight;
  const startedAt = Date.now();
  sched.inFlight = (async () => {
    try {
      const result = await fetchSource(src, tiles);
      ingest(src, result);
    } catch {
      sourceStatus[src] = "error";
    } finally {
      const dur = Date.now() - startedAt;
      lastCycleDurationMs = dur;
      cycleDurations.push(dur);
      if (cycleDurations.length > CYCLE_DURATION_WINDOW) cycleDurations.shift();
      sched.nextDueAt = Date.now() + sched.intervalMs;
      sched.inFlight = null;
    }
  })();
  return sched.inFlight;
}

/** Startet alle fälligen Quellen-Abfragen; liefert deren Promises. */
function triggerDuePolls(force: boolean): Promise<void>[] {
  const tiles = getActiveTiles();
  if (tiles.length === 0) return [];
  const now = Date.now();
  pollCycle++;
  started = true;
  const pending: Promise<void>[] = [];
  for (const src of ALL_DATA_SOURCES) {
    if (!ENABLED_DATA_SOURCES.has(src)) continue;
    const sched = sourceSchedules[src];
    if (sched.inFlight) { pending.push(sched.inFlight); continue; }
    if (now < sched.backoffUntilAt) continue;
    if (!force && now < sched.nextDueAt) continue;
    pending.push(pollSource(src, tiles));
  }
  return pending;
}

// --- Geländehöhe / AGL ------------------------------------------------------------

// Max. Ziele je Anreicherung (= ein Open-Meteo-Sammelabruf, MAX_BATCH 100).
const ELEVATION_MAX_BATCH = 100;
// Zwischen zwei Abrufen bewegt sich ein Ziel aus der 110-m-Cache-Zelle. Die
// zuletzt ermittelte Geländehöhe wird weiterverwendet, solange es nicht weiter
// als das vom Messpunkt entfernt ist (Boden-Filter betrifft langsame Ziele).
const ELEVATION_REUSE_MAX_DIST_M = 1000;
const groundSamples = new Map<string, { lat: number; lon: number; elev: number }>();
let elevationInFlight: Promise<void> | null = null;

function applyGroundElevation(ac: StoredAircraft): void {
  let ground = getElevationFromCache(ac.latitude, ac.longitude);
  if (ground != null) {
    groundSamples.set(ac.icao24, { lat: ac.latitude, lon: ac.longitude, elev: ground });
  } else {
    const s = groundSamples.get(ac.icao24);
    if (s && quickDistanceM(s.lat, s.lon, ac.latitude, ac.longitude) <= ELEVATION_REUSE_MAX_DIST_M) ground = s.elev;
  }
  ac.groundElevation = ground;
  const msl = ac.geoAltitude ?? ac.baroAltitude;
  ac.aglAltitude = ground != null && msl != null ? Math.max(0, msl - ground) : null;
}

/**
 * Startet (nicht blockierend) die gedrosselte Anreicherung für die nächsten
 * Ziele. Die Drossel (15 s) und der Positions-Cache liegen in
 * enrichAircraftWithElevation; hier nur: kein paralleler Lauf, Batch-Limit.
 * Ergebnisse landen beim nächsten Aufruf (Aufrufer pollen alle 2 s).
 */
function triggerElevationEnrichment(candidates: StoredAircraft[]): Promise<void> | null {
  if (elevationInFlight || candidates.length === 0) return null;
  const batch = candidates.slice(0, ELEVATION_MAX_BATCH);
  elevationInFlight = enrichAircraftWithElevation(
    batch.map((a) => ({ latitude: a.latitude, longitude: a.longitude, geoAltitude: a.geoAltitude, baroAltitude: a.baroAltitude })),
  )
    .then(() => {
      for (const a of batch) {
        const live = store.get(a.icao24);
        if (live) applyGroundElevation(live);
      }
    })
    .catch(() => { /* offline/Fehler → AGL bleibt null */ })
    .finally(() => { elevationInFlight = null; });
  return elevationInFlight;
}

/** Nur für Tests: auf eine laufende Gelände-Anreicherung warten. */
export async function __awaitElevationEnrichmentForTests(): Promise<void> {
  if (elevationInFlight) await elevationInFlight;
}

// --- Öffentliche API ----------------------------------------------------------

export interface NearbyAircraftResult {
  fetchedAt: number;
  latestSnapshotAt: number;
  latestSnapshotAgeSec: number;
  aircraft: AircraftState[];
  trails: AircraftTrail[];
  sourceStatus: Record<DataSource, SourceStatus>;
}

export interface Bbox { latMin: number; latMax: number; lonMin: number; lonMax: number; }

export async function getNearbyAircraft(
  lat: number,
  lon: number,
  radiusKm: number,
  maxAgeSec: number,
  bbox?: Bbox,
): Promise<NearbyAircraftResult> {
  const radius = Math.max(1, Math.min(100, Number.isFinite(radiusKm) ? radiusKm : 25));
  const maxAge = Math.max(1, Math.min(600, Number.isFinite(maxAgeSec) ? maxAgeSec : 60));
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  if (valid) {
    let coverageKm = radius;
    if (bbox) {
      const half = haversineKm(bbox.latMin, bbox.lonMin, bbox.latMax, bbox.lonMax) / 2;
      if (half > coverageKm) coverageKm = Math.min(half, TILE_MAX_DIST_NM * 1.852);
    }
    const isNew = noteClientRegion(lat, lon, coverageKm, Date.now());
    const pending = triggerDuePolls(isNew);
    // Neue Region (oder noch nie Daten): auf die erste Antwortrunde warten,
    // damit das Radar nicht sekundenlang leer bleibt. Sonst sofort den
    // aktuellen Store liefern — die laufenden Abfragen landen beim nächsten
    // Aufruf (Aufrufer pollen alle 2 s).
    if ((isNew || lastSnapshotAt === 0) && pending.length > 0) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        Promise.all(pending),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, FIRST_FETCH_WAIT_MS); }),
      ]);
      if (timer) clearTimeout(timer);
    }
  }

  const now = Date.now();
  const maxAgeMs = maxAge * 1000;
  const aircraft: (AircraftState & { distanceKm: number })[] = [];
  const trails: AircraftTrail[] = [];
  const elevationCandidates: { ac: StoredAircraft; distKm: number }[] = [];
  if (valid) {
    for (const ac of store.values()) {
      const age = now - ac.lastSeen;
      if (age > maxAgeMs) continue;
      if (ac.onGround) continue;
      const distKm = haversineKm(lat, lon, ac.latitude, ac.longitude);
      const inRadius = distKm <= radius;
      const inBbox = bbox != null
        && ac.latitude >= bbox.latMin && ac.latitude <= bbox.latMax
        && ac.longitude >= bbox.lonMin && ac.longitude <= bbox.lonMax;
      if (inRadius || inBbox) {
        // Geländehöhe aus dem Cache (synchron) → AGL für Boden-Filter/Labels.
        applyGroundElevation(ac);
        elevationCandidates.push({ ac, distKm });
      }
      // Rollende Flugzeuge ohne onGround-Flag (AGL < 30 m, < 15 m/s) ausblenden.
      if (
        ac.category !== "helicopter" &&
        ac.category !== "balloon" &&
        ac.category !== "drone" &&
        ac.aglAltitude != null && ac.aglAltitude < 30 &&
        ac.velocity != null && ac.velocity < 15
      ) {
        if (ac.trail.length > 0) ac.trail = [];
        continue;
      }
      // Segelflugzeuge können nicht schweben: < 10 m/s → gelandet.
      if (ac.category === "glider" && ac.velocity != null && ac.velocity < 10) {
        if (ac.trail.length > 0) ac.trail = [];
        continue;
      }
      if (inRadius || inBbox) {
        const { trail: _trail, ...rest } = ac;
        aircraft.push({
          ...rest,
          sources: ac.sources.slice(),
          isStale: age > 30_000,
          distanceKm: distKm,
          bearingDeg: bearingFromTo(lat, lon, ac.latitude, ac.longitude),
          ageSec: Math.round(age / 1000),
        });
      }
      if (inRadius && ac.trail.length >= 2) {
        trails.push({ id: ac.icao24, points: ac.trail.slice() });
      }
    }
  }
  aircraft.sort((a, b) => a.distanceKm - b.distanceKm);
  if (elevationCandidates.length > 0) {
    elevationCandidates.sort((a, b) => a.distKm - b.distKm);
    triggerElevationEnrichment(elevationCandidates.map((c) => c.ac));
  }
  // Harte Obergrenzen gegen Speicherdruck in der Karten-Darstellung.
  const limitedAircraft = aircraft.slice(0, MAX_NEARBY_AIRCRAFT);
  const distById = new Map<string, number>();
  for (const a of limitedAircraft) distById.set(a.icao24, a.distanceKm);
  const limitedTrails = trails
    .filter((t) => distById.has(t.id))
    .sort((a, b) => (distById.get(a.id) ?? Infinity) - (distById.get(b.id) ?? Infinity))
    .slice(0, MAX_NEARBY_TRAILS);

  return {
    fetchedAt: now,
    latestSnapshotAt: lastSnapshotAt,
    latestSnapshotAgeSec: lastSnapshotAt > 0 ? Math.max(0, Math.round((now - lastSnapshotAt) / 1000)) : 0,
    aircraft: limitedAircraft,
    trails: limitedTrails,
    sourceStatus: { ...sourceStatus },
  };
}

export interface AggregatorStatus {
  started: boolean;
  pollIntervalMs: number;
  lastPollAt: number;
  lastSnapshotAt: number;
  latestSnapshotAgeSec: number;
  pollCycle: number;
  lastCycleDurationMs: number;
  avgCycleDurationMs: number;
  storedAircraft: number;
  sourceStatus: Record<DataSource, SourceStatus>;
  sourceLastOk: Record<DataSource, number>;
  ogn: { connected: boolean; total: number };
  /** Aktuell aktive (abgefragte) Quellen, siehe setTrafficSourceEnabled. */
  enabledSources: DataSource[];
  /** Mindestabstand je Quelle zwischen zwei Abfragen (ms). */
  sourceIntervalsMs: Record<DataSource, number>;
}

export function getAggregatorStatus(): AggregatorStatus {
  const now = Date.now();
  const avg = cycleDurations.length > 0
    ? Math.round(cycleDurations.reduce((s, v) => s + v, 0) / cycleDurations.length)
    : 0;
  let ognTotal = 0;
  for (const ac of store.values()) if (ac.sources.includes("ogn")) ognTotal++;
  return {
    started,
    pollIntervalMs: SOURCE_INTERVALS.adsblol,
    lastPollAt,
    lastSnapshotAt,
    latestSnapshotAgeSec: lastSnapshotAt > 0 ? Math.max(0, Math.round((now - lastSnapshotAt) / 1000)) : 0,
    pollCycle,
    lastCycleDurationMs,
    avgCycleDurationMs: avg,
    storedAircraft: store.size,
    sourceStatus: { ...sourceStatus },
    sourceLastOk: { ...sourceLastOk },
    // Kein Dauer-Stream mehr: "connected" = letzte OGN-Abfrage erfolgreich.
    ogn: { connected: sourceStatus.ogn === "ok" && sourceLastOk.ogn > 0, total: ognTotal },
    enabledSources: ALL_DATA_SOURCES.filter((s) => enabledSources.has(s)),
    sourceIntervalsMs: { ...SOURCE_INTERVALS },
  };
}

/** Nur für Tests: gesamten Zustand zurücksetzen. */
export function __resetTrafficAggregatorForTests(): void {
  store.clear();
  clientRegions.clear();
  groundSamples.clear();
  elevationInFlight = null;
  enabledSources.clear();
  for (const s of DEFAULT_ENABLED_DATA_SOURCES) enabledSources.add(s);
  for (const s of ALL_DATA_SOURCES) {
    sourceStatus[s] = ENABLED_DATA_SOURCES.has(s) ? "ok" : "error";
    sourceLastOk[s] = 0;
    lastSourceStates[s] = [];
    const sched = sourceSchedules[s];
    sched.intervalMs = SOURCE_INTERVALS[s];
    sched.nextDueAt = 0;
    sched.inFlight = null;
    sched.backoffStreak = 0;
    sched.backoffUntilAt = 0;
  }
  started = false;
  pollCycle = 0;
  lastPollAt = 0;
  lastSnapshotAt = 0;
  lastCycleDurationMs = 0;
  cycleDurations.length = 0;
}
