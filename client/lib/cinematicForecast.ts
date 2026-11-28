// Cinematic-Vorschau: Abruf (EINE Open-Meteo-Abfrage für alle Punkte),
// Zwischenspeicher (~60 min, übersteht Neustarts, offline als „Stand …“),
// Rückzug bei HTTP 429, Einstellungen und die (reine) Auswahl der
// Benachrichtigungen. RN-frei: AsyncStorage wird lazy geladen, Speicher/fetch/
// Uhr sind für Tests ersetzbar.

import { fetchWithTimeout } from "./fetchWithTimeout";
import {
  applyDwdCrossCheck,
  buildDwdStationUrl,
  dwdHourAt,
  parseDwdStationOverview,
  type DwdStationForecast,
  buildCinematicForecastUrl,
  compactPoint,
  expandPoint,
  type CompactPointForecast,
  findBestWindow,
  formatWindow,
  parseOpenMeteoMulti,
  scoreSpotHours,
  type HourScore,
  type PointForecast,
  type ScoreWindow,
} from "./cinematicFog";
import {
  DEFAULT_CINEMATIC_CENTER,
  DEFAULT_SPOT_RADIUS_KM,
  MAX_SPOTS_PER_REQUEST,
  selectSpots,
  type SpotWithDistance,
} from "./cinematicSpots";
import { loadLastKnownPosition } from "./mapFallbackCenter";

export const CINEMATIC_CACHE_KEY = "@copterpilot/cinematic_cache_v1";
export const CINEMATIC_BACKOFF_KEY = "@copterpilot/cinematic_backoff_v1";
export const CINEMATIC_SETTINGS_KEY = "@copterpilot/cinematic_settings_v1";
export const CINEMATIC_NOTIFY_STATE_KEY = "@copterpilot/cinematic_notify_state_v1";
export const CINEMATIC_DWD_KEY = "@copterpilot/cinematic_dwd_v1";

/** Daten gelten 60 min als frisch */
export const CINEMATIC_FRESH_MS = 60 * 60 * 1000;
/** Manuelles Aktualisieren frühestens nach 5 min erneut abrufen */
export const CINEMATIC_FORCE_MIN_AGE_MS = 5 * 60 * 1000;
/** Gespeicherte Punkte älter als 36 h verwerfen */
const CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 60;
/** Schwelle für das „beste Fenster“ in der Liste */
export const LIST_WINDOW_THRESHOLD = 50;

// ───────────────────────────── Abhängigkeiten ──────────────────────────────

type KvStorage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };
type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let storageOverride: KvStorage | null | undefined;
let fetchOverride: FetchFn | undefined;
let nowOverride: (() => number) | undefined;

function storage(): KvStorage | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    return (mod?.default ?? mod) as KvStorage;
  } catch {
    return null;
  }
}
const now = () => (nowOverride ? nowOverride() : Date.now());
const doFetch: FetchFn = (url) => (fetchOverride ? fetchOverride(url) : fetchWithTimeout(url, {}, 20000));

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
async function writeJson(key: string, v: unknown): Promise<void> {
  try {
    await storage()?.setItem(key, JSON.stringify(v));
  } catch {}
}

/** Nur für Tests */
export function __setCinematicDepsForTests(d: { storage?: KvStorage | null; fetch?: FetchFn; now?: () => number } | null): void {
  storageOverride = d ? d.storage : undefined;
  fetchOverride = d?.fetch;
  nowOverride = d?.now;
  inflight = null;
  dwdRetryAt = 0;
}

// ───────────────────────────── Einstellungen ───────────────────────────────

export interface CinematicSettings {
  /** Benachrichtigen bei gutem Score (Standard aus) */
  notifyEnabled: boolean;
  /** Score-Schwelle für Benachrichtigungen */
  threshold: number;
  /** Umkreis (km) für Liste und Benachrichtigungen */
  maxDistanceKm: number;
}

export const DEFAULT_CINEMATIC_SETTINGS: CinematicSettings = {
  notifyEnabled: false,
  threshold: 80,
  maxDistanceKm: DEFAULT_SPOT_RADIUS_KM,
};
export const THRESHOLD_CHOICES = [70, 80, 90] as const;
export const DISTANCE_CHOICES = [50, 100, 150, 250] as const;

export async function loadCinematicSettings(): Promise<CinematicSettings> {
  const s = await readJson<Partial<CinematicSettings>>(CINEMATIC_SETTINGS_KEY);
  return {
    notifyEnabled: s?.notifyEnabled === true,
    threshold: typeof s?.threshold === "number" ? s.threshold : DEFAULT_CINEMATIC_SETTINGS.threshold,
    maxDistanceKm: typeof s?.maxDistanceKm === "number" ? s.maxDistanceKm : DEFAULT_CINEMATIC_SETTINGS.maxDistanceKm,
  };
}

export async function saveCinematicSettings(s: CinematicSettings): Promise<void> {
  await writeJson(CINEMATIC_SETTINGS_KEY, s);
}

// ───────────────────────────── Zwischenspeicher ────────────────────────────

interface CachedPoint {
  fetchedAt: number;
  data: CompactPointForecast;
}
type CacheMap = Record<string, CachedPoint>;

interface Backoff {
  until: number;
  step: number;
}

export function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/** Rückzug nach HTTP 429: 15 → 30 → 60 … min, höchstens 6 h. */
export function nextBackoff(prev: Backoff | null, at: number): Backoff {
  const step = Math.min((prev?.step ?? 0) + 1, 6);
  const mins = Math.min(15 * 2 ** (step - 1), 360);
  return { until: at + mins * 60_000, step };
}

async function readCache(): Promise<CacheMap> {
  const raw = await readJson<CacheMap>(CINEMATIC_CACHE_KEY);
  const out: CacheMap = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.fetchedAt === "number" && v.data && Array.isArray(v.data.h)) out[k] = v;
    }
  }
  return out;
}

function pruneCache(cache: CacheMap, at: number): CacheMap {
  const entries = Object.entries(cache)
    .filter(([, v]) => v && at - v.fetchedAt < CACHE_MAX_AGE_MS)
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, CACHE_MAX_ENTRIES);
  return Object.fromEntries(entries);
}

// ───────────────────────────── Ergebnis ────────────────────────────────────

export interface SpotForecast {
  spot: SpotWithDistance;
  hours: HourScore[];
  /** Bestes Fenster (Score ≥ LIST_WINDOW_THRESHOLD) */
  best: ScoreWindow | null;
  /** Beste Einzelstunde */
  peak: HourScore | null;
  /** Abrufzeit der verwendeten Daten (ältere von Tal/Gipfel) */
  fetchedAt: number | null;
}

export interface CinematicResult {
  center: { latitude: number; longitude: number };
  centerSource: "last" | "default";
  /** Kein Spot im Umkreis – die nächsten werden gezeigt */
  outsideRadius: boolean;
  spots: SpotForecast[];
  /** Ältester Datenstand der gezeigten Spots */
  fetchedAt: number | null;
  /** Daten älter als CINEMATIC_FRESH_MS (z. B. offline) */
  stale: boolean;
  /** Fehlermeldung des letzten Abrufs (Daten ggf. aus dem Speicher) */
  error?: string;
  /** Rückzug wegen Ratenbegrenzung bis … */
  rateLimitedUntil?: number;
  /** Stand der DWD-Stationsvorhersage (Gegenprobe), falls genutzt */
  dwdFetchedAt?: number | null;
}

export const CINEMATIC_SOURCE_TEXT = "DWD ICON-D2 (via Open-Meteo) + DWD-Stationsvorhersage";

export interface CinematicQuery {
  /** Manuell aktualisieren (Cache < 5 min wird trotzdem genutzt) */
  force?: boolean;
  radiusKm?: number;
  maxGustMs?: number;
  /** Nur Speicher, nie abrufen */
  cacheOnly?: boolean;
  center?: { latitude: number; longitude: number };
}

let inflight: Promise<void> | null = null;
let dwdRetryAt = 0;

interface DwdCache {
  fetchedAt: number;
  data: Record<string, DwdStationForecast>;
}

/** DWD-Stationsvorhersage für alle Stationen in EINER Abfrage; Fehler sind nicht schlimm. */
async function loadDwdStations(ids: string[], opts: { force?: boolean; cacheOnly?: boolean }): Promise<DwdCache | null> {
  if (ids.length === 0) return null;
  const cached = await readJson<DwdCache>(CINEMATIC_DWD_KEY);
  const valid = cached && typeof cached.fetchedAt === "number" && cached.data && typeof cached.data === "object" ? cached : null;
  const covered = valid && ids.every((id) => valid.data[id]);
  const age = valid ? now() - valid.fetchedAt : Infinity;
  const maxAge = opts.force ? CINEMATIC_FORCE_MIN_AGE_MS : CINEMATIC_FRESH_MS;
  if ((covered && age < maxAge) || opts.cacheOnly || now() < dwdRetryAt) return valid;
  try {
    const res = await doFetch(buildDwdStationUrl(ids));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseDwdStationOverview(await res.json());
    if (Object.keys(data).length === 0) throw new Error("leer");
    const next: DwdCache = { fetchedAt: now(), data: { ...(valid?.data ?? {}), ...data } };
    await writeJson(CINEMATIC_DWD_KEY, next);
    return next;
  } catch {
    dwdRetryAt = now() + 15 * 60_000;
    return valid;
  }
}

// Ein Tal-Punkt wird von mehreren Spots genutzt → einmal entpacken
const expandMemo = new WeakMap<CompactPointForecast, PointForecast>();
function expand(c: CompactPointForecast): PointForecast {
  let p = expandMemo.get(c);
  if (!p) {
    p = expandPoint(c);
    expandMemo.set(c, p);
  }
  return p;
}

async function fetchPoints(points: { key: string; latitude: number; longitude: number }[], cache: CacheMap): Promise<{ error?: string; rateLimitedUntil?: number }> {
  const at = now();
  const backoff = await readJson<Backoff>(CINEMATIC_BACKOFF_KEY);
  if (backoff && backoff.until > at) return { error: "Open-Meteo: zu viele Abfragen – später erneut", rateLimitedUntil: backoff.until };
  let res: Awaited<ReturnType<FetchFn>>;
  try {
    res = await doFetch(buildCinematicForecastUrl(points));
  } catch (e) {
    return { error: `Abruf fehlgeschlagen${(e as Error)?.name === "AbortError" ? " (Zeitüberschreitung)" : ""}` };
  }
  if (res.status === 429) {
    const b = nextBackoff(backoff, at);
    await writeJson(CINEMATIC_BACKOFF_KEY, b);
    return { error: "Open-Meteo: zu viele Abfragen – später erneut", rateLimitedUntil: b.until };
  }
  if (!res.ok) return { error: `Open-Meteo antwortet mit HTTP ${res.status}` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { error: "Ungültige Antwort von Open-Meteo" };
  }
  const parsed = parseOpenMeteoMulti(json);
  if (parsed.length !== points.length) return { error: "Unvollständige Antwort von Open-Meteo" };
  parsed.forEach((p, i) => {
    if (p) cache[points[i].key] = { fetchedAt: at, data: compactPoint(p) };
  });
  if (backoff) await writeJson(CINEMATIC_BACKOFF_KEY, { until: 0, step: 0 });
  return {};
}

/**
 * Vorschau für die Spots um die letzte bekannte Position. Fehlende/veraltete
 * Punkte werden in EINER Abfrage geholt; schlägt sie fehl, zählen die
 * gespeicherten Daten („Stand …“).
 */
export async function getCinematicForecast(q: CinematicQuery = {}): Promise<CinematicResult> {
  const last = q.center ? null : await loadLastKnownPosition();
  const center = q.center ?? (last ? { latitude: last.latitude, longitude: last.longitude } : DEFAULT_CINEMATIC_CENTER);
  const centerSource: CinematicResult["centerSource"] = q.center || last ? "last" : "default";
  const { spots, outsideRadius } = selectSpots(center, q.radiusKm ?? DEFAULT_SPOT_RADIUS_KM, MAX_SPOTS_PER_REQUEST);

  // Benötigte Punkte (Tal-Referenzen werden geteilt)
  const needed = new Map<string, { key: string; latitude: number; longitude: number }>();
  for (const s of spots) {
    for (const p of [s, s.valley]) {
      const key = pointKey(p.latitude, p.longitude);
      if (!needed.has(key)) needed.set(key, { key, latitude: p.latitude, longitude: p.longitude });
    }
  }

  let cache = await readCache();
  let error: string | undefined;
  let rateLimitedUntil: number | undefined;
  const maxAge = q.force ? CINEMATIC_FORCE_MIN_AGE_MS : CINEMATIC_FRESH_MS;
  const missing = [...needed.values()].filter((p) => {
    const c = cache[p.key];
    return !c || now() - c.fetchedAt >= maxAge;
  });
  if (missing.length > 0 && !q.cacheOnly) {
    // Gleichzeitige Aufrufe (Screen + Hintergrundprüfung) teilen sich den Abruf
    if (inflight) {
      await inflight.catch(() => {});
      cache = await readCache();
    } else {
      // Beim Abruf alle Punkte mitnehmen, damit die Stände einheitlich bleiben
      const all = [...needed.values()];
      inflight = (async () => {
        const r = await fetchPoints(all, cache);
        error = r.error;
        rateLimitedUntil = r.rateLimitedUntil;
        if (!r.error) await writeJson(CINEMATIC_CACHE_KEY, pruneCache(cache, now()));
      })();
      try {
        await inflight;
      } finally {
        inflight = null;
      }
    }
  }

  const stationIds = [...new Set(spots.flatMap((sp) => [sp.dwdSummitStation, sp.dwdValleyStation]).filter((x): x is string => !!x))];
  const dwd = await loadDwdStations(stationIds, q);
  // Stationsvorhersage älter als 6 h nicht mehr gegenprüfen
  const dwdData = dwd && now() - dwd.fetchedAt < 6 * 3600_000 ? dwd.data : null;

  const t = now();
  const results: SpotForecast[] = spots.map((spot) => {
    const v = cache[pointKey(spot.valley.latitude, spot.valley.longitude)];
    const s = cache[pointKey(spot.latitude, spot.longitude)];
    if (!v) return { spot, hours: [], best: null, peak: null, fetchedAt: null };
    let hours = scoreSpotHours(spot, expand(v.data), s ? expand(s.data) : null, { fromMs: t, hours: 24, maxGustMs: q.maxGustMs });
    if (dwdData && (spot.dwdSummitStation || spot.dwdValleyStation)) {
      const sf = spot.dwdSummitStation ? dwdData[spot.dwdSummitStation] : undefined;
      const vf = spot.dwdValleyStation ? dwdData[spot.dwdValleyStation] : undefined;
      hours = hours.map((h) => applyDwdCrossCheck(h, dwdHourAt(sf, h.t), dwdHourAt(vf, h.t)));
    }
    const peak = hours.reduce<HourScore | null>((b, h) => (!b || h.score > b.score ? h : b), null);
    return {
      spot,
      hours,
      best: findBestWindow(hours, LIST_WINDOW_THRESHOLD),
      peak,
      fetchedAt: s ? Math.min(v.fetchedAt, s.fetchedAt) : v.fetchedAt,
    };
  });
  results.sort((a, b) => (b.peak?.score ?? -1) - (a.peak?.score ?? -1) || a.spot.distanceKm - b.spot.distanceKm);
  const stamps = results.map((r) => r.fetchedAt).filter((x): x is number => x != null);
  const fetchedAt = stamps.length ? Math.min(...stamps) : null;
  return {
    center,
    centerSource,
    outsideRadius,
    spots: results,
    fetchedAt,
    stale: fetchedAt == null || t - fetchedAt >= CINEMATIC_FRESH_MS,
    error,
    rateLimitedUntil,
    dwdFetchedAt: dwdData ? dwd!.fetchedAt : null,
  };
}

// ───────────────────────────── Benachrichtigungen (rein) ───────────────────

export interface NotifyState {
  /** Gemeldete Fenster je Spot */
  sent: { spotId: string; startMs: number; endMs: number; at: number }[];
}

export const MAX_NOTIFICATIONS_PER_DAY = 2;

export interface CinematicNotification {
  spotId: string;
  title: string;
  body: string;
  window: ScoreWindow;
}

/**
 * Höchstens EINE Meldung pro Prüfung: bester Spot mit Fenster ≥ Schwelle im
 * Umkreis, noch nicht gemeldet (gleicher Spot, überlappendes Fenster ±3 h)
 * und höchstens 2 Meldungen in 24 h.
 */
export function pickCinematicNotification(
  spots: SpotForecast[],
  settings: CinematicSettings,
  state: NotifyState,
  at: number,
): { notification: CinematicNotification | null; state: NotifyState } {
  const sent = state.sent.filter((s) => at - s.at < 48 * 3600_000 && s.endMs > at - 24 * 3600_000);
  const next: NotifyState = { sent };
  if (!settings.notifyEnabled) return { notification: null, state: next };
  const recent = sent.filter((s) => at - s.at < 24 * 3600_000).length;
  if (recent >= MAX_NOTIFICATIONS_PER_DAY) return { notification: null, state: next };
  const candidates = spots
    .filter((s) => s.spot.distanceKm <= settings.maxDistanceKm)
    .map((s) => ({ s, w: findBestWindow(s.hours, settings.threshold) }))
    .filter((c): c is { s: SpotForecast; w: ScoreWindow } => !!c.w && c.w.endMs > at && c.w.startMs - at <= 24 * 3600_000)
    .filter(
      ({ s, w }) =>
        !sent.some((x) => x.spotId === s.spot.id && x.startMs - 3 * 3600_000 < w.endMs && w.startMs < x.endMs + 3 * 3600_000),
    )
    .sort((a, b) => b.w.peakScore - a.w.peakScore || a.s.spot.distanceKm - b.s.spot.distanceKm);
  const top = candidates[0];
  if (!top) return { notification: null, state: next };
  const others = candidates.length - 1;
  const notification: CinematicNotification = {
    spotId: top.s.spot.id,
    title: "Cinematic-Vorschau: Wolkenmeer",
    body:
      `Wolkenmeer wahrscheinlich: ${top.s.spot.name} (${top.s.spot.elevationM} m) – ${formatWindow(top.w)} (Score ${top.w.peakScore})` +
      (others > 0 ? ` · +${others} weitere Spots` : ""),
    window: top.w,
  };
  next.sent = [...sent, { spotId: top.s.spot.id, startMs: top.w.startMs, endMs: top.w.endMs, at }];
  return { notification, state: next };
}

export async function loadNotifyState(): Promise<NotifyState> {
  const s = await readJson<NotifyState>(CINEMATIC_NOTIFY_STATE_KEY);
  return { sent: Array.isArray(s?.sent) ? s!.sent : [] };
}

export async function saveNotifyState(s: NotifyState): Promise<void> {
  await writeJson(CINEMATIC_NOTIFY_STATE_KEY, s);
}
