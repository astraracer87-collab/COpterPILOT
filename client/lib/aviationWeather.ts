import {
  parseMetar,
  CloudQuantity,
  Descriptive,
  Phenomenon,
  type IMetar,
  type ICloud,
  type Visibility,
} from "metar-taf-parser";

// Reine Dekodier-Logik liegt in aviationWeatherDecode.ts (ohne query-client/
// expo-constants), damit das Web-Bundle sie ohne React-Native-Pakete nutzen kann.
// Hier nur re-exportiert, damit bestehende Importe (@/lib/aviationWeather) gültig bleiben.
export {
  decodeMetar,
  decodeTaf,
  formatObservedTime,
  type KlartextRow,
  type TafKlartext,
  type TafTrendKlartext,
} from "./aviationWeatherDecode";
import { describeWeather } from "./aviationWeatherDecode";
import { fetchWithOfflineCache, getOfflineResult, putOfflineResult } from "./offlineResultCache";
import {
  assessOfflineData,
  OFFLINE_DATA_MAX_AGE_MS,
  offlineLocationKey,
  tafValidUntil,
  type OfflineOrigin,
} from "../../shared/offlineDataPolicy";

export interface AirportWeather {
  icao: string;
  metarRaw: string | null;
  tafRaw: string | null;
  observedAt: string | null;
  issuedAt: string | null;
  /** Teil A: aus dem Offline-Speicher (Gerät offline bzw. Dienst nicht erreichbar). */
  offline?: OfflineOrigin;
  /** Teil A: METAR älter als 2 h – nur grau anzeigen, nicht bewerten. */
  metarGrey?: boolean;
}

/** Alter einer METAR: Beobachtungszeit, sonst Abrufzeit. */
function metarAgeBase(observedAt: string | null | undefined, fetchedAt: number): number {
  const t = observedAt ? new Date(observedAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.min(t, fetchedAt) : fetchedAt;
}

interface AwcMetar {
  icaoId?: string;
  rawOb?: string;
  reportTime?: string;
}
interface AwcTaf {
  icaoId?: string;
  rawTAF?: string;
  issueTime?: string;
}

/**
 * Fetch mit Timeout (AbortController), damit das Wetter-Fenster nie unbegrenzt im
 * Ladezustand hängt. Standard 10 s – etwas über dem Server-Timeout (8 s), damit
 * der Server seinen Stale-Cache-Fallback noch ausliefern kann.
 */
async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: AWC_HEADERS });
  } finally {
    clearTimeout(timer);
  }
}

// aviationweather.gov (NOAA/AWC) wird direkt abgefragt – frei, ohne Schlüssel.
const AWC_BASE = "https://aviationweather.gov/api/data";
const AWC_HEADERS = { Accept: "application/json", "User-Agent": "COpterPilot-RC/1.0" } as const;

async function fetchAwcJson(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetchWithTimeout(`${AWC_BASE}${path}`);
  // AWC liefert bei "keine Daten" teils 204/leeren Body.
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

// Kleiner In-Memory-Cache (ersetzt den Server-Cache): frische Werte 10 min,
// bei AWC-Ausfall werden auch abgelaufene Werte ausgeliefert.
const AWC_TTL_MS = 10 * 60 * 1000;
const awcCache = new Map<string, { ts: number; data: unknown }>();

/**
 * Teil A: METAR/TAF mit Offline-Speicher. Online wie bisher (10-min-Cache im
 * Speicher); jeder erfolgreiche Abruf wird gespeichert. Offline bzw. bei
 * Ausfall: letzter Stand (< 24 h) – METAR älter als 2 h nur grau
 * (`metarGrey`), TAF nur bis zum Ende ihrer Gültigkeit.
 */
export async function fetchAirportWeather(icao: string): Promise<AirportWeather> {
  const code = icao.trim().toUpperCase();
  let offline = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    offline = !!require("./network").isOfflineNow();
  } catch {}
  if (!offline) {
    try {
      const live = await fetchAirportWeatherLive(code);
      putOfflineResult("airport", code, live).catch(() => {});
      return live;
    } catch (e) {
      const stored = await storedAirportWeather(code);
      if (stored) return stored;
      throw e;
    }
  }
  const stored = await storedAirportWeather(code);
  if (stored) return stored;
  throw new Error("Gerät offline – keine gespeicherte METAR/TAF (< 24 h)");
}

async function storedAirportWeather(code: string, now = Date.now()): Promise<AirportWeather | null> {
  const st = await getOfflineResult<AirportWeather>("airport", code).catch(() => null);
  if (!st || now - st.fetchedAt >= OFFLINE_DATA_MAX_AGE_MS) return null;
  const w = st.data;
  const metarState = w.metarRaw ? assessOfflineData("metar", metarAgeBase(w.observedAt, st.fetchedAt), now) : null;
  const tafEnd = tafValidUntil(w.tafRaw, w.issuedAt ?? st.fetchedAt);
  const tafState = w.tafRaw ? assessOfflineData("taf", st.fetchedAt, now, { validUntil: tafEnd }) : null;
  const metarRaw = metarState && metarState.show ? w.metarRaw : null;
  const tafRaw = tafState && tafState.show ? w.tafRaw : null;
  if (!metarRaw && !tafRaw) return null;
  return {
    ...w,
    metarRaw,
    observedAt: metarRaw ? w.observedAt : null,
    tafRaw,
    issuedAt: tafRaw ? w.issuedAt : null,
    offline: { fetchedAt: st.fetchedAt, cached: true },
    ...(metarState?.state === "grey" ? { metarGrey: true } : {}),
  };
}

async function fetchAirportWeatherLive(code: string): Promise<AirportWeather> {
  const cacheKey = `icao:${code}`;
  const cached = awcCache.get(cacheKey);
  let data: { metars?: AwcMetar[]; tafs?: AwcTaf[] };
  if (cached && Date.now() - cached.ts < AWC_TTL_MS) {
    data = cached.data as typeof data;
  } else {
    try {
      const id = encodeURIComponent(code);
      const [metarRes, tafRes] = await Promise.all([
        fetchAwcJson(`/metar?ids=${id}&format=json`),
        fetchAwcJson(`/taf?ids=${id}&format=json`),
      ]);
      if (!metarRes.ok && !tafRes.ok) {
        if (cached) {
          data = cached.data as typeof data;
        } else {
          throw new Error(`Wetterdienst nicht erreichbar (${metarRes.status})`);
        }
      } else {
        data = {
          metars: Array.isArray(metarRes.data) ? (metarRes.data as AwcMetar[]) : [],
          tafs: Array.isArray(tafRes.data) ? (tafRes.data as AwcTaf[]) : [],
        };
        awcCache.set(cacheKey, { ts: Date.now(), data });
      }
    } catch (e) {
      if (cached) {
        data = cached.data as typeof data;
      } else if (e instanceof Error && e.message.startsWith("Wetterdienst")) {
        throw e;
      } else {
        throw new Error("Wetterdienst antwortet nicht");
      }
    }
  }
  const metars = Array.isArray(data.metars) ? data.metars : [];
  const tafs = Array.isArray(data.tafs) ? data.tafs : [];
  const metar = metars.find((m) => (m.icaoId || "").toUpperCase() === code) || metars[0];
  const taf = tafs.find((t) => (t.icaoId || "").toUpperCase() === code) || tafs[0];
  return {
    icao: code,
    metarRaw: metar?.rawOb?.trim() || null,
    tafRaw: taf?.rawTAF?.trim() || null,
    observedAt: metar?.reportTime || null,
    issuedAt: taf?.issueTime || null,
  };
}

/** Eine einzelne meldende METAR-Station im Kartenausschnitt (für Marker). */
export interface AirportStation {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  raw: string | null;
  observedAt: string | null;
}

interface AwcAreaRow {
  icaoId?: string;
  name?: string;
  lat?: number;
  lon?: number;
  rawOb?: string | null;
  reportTime?: string | null;
}

const floor2 = (n: number) => Math.floor(n * 2) / 2;
const ceil2 = (n: number) => Math.ceil(n * 2) / 2;

/**
 * Holt ALLE aktuell meldenden METAR-Stationen in einer Bounding Box (europaweit).
 * bbox: [minLat, minLon, maxLat, maxLon]. Wird für die dynamischen Flughafen-
 * Wetter-Marker bei höherem Zoom verwendet. Liefert bei Fehlern eine leere Liste.
 */
export async function fetchAirportStationsInArea(
  bbox: [number, number, number, number],
): Promise<AirportStation[]> {
  let [minLat, minLon, maxLat, maxLon] = bbox;
  if (![minLat, minLon, maxLat, maxLon].every(Number.isFinite)) return [];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  if (minLon > maxLon) [minLon, maxLon] = [maxLon, minLon];
  // Bbox auf 0.5°-Raster erweitern (Obermenge der Anfrage) → bessere Cache-Treffer.
  const bucket = `${floor2(minLat)},${floor2(minLon)},${ceil2(maxLat)},${ceil2(maxLon)}`;
  const cacheKey = `area:${bucket}`;
  const cached = awcCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < AWC_TTL_MS) return cached.data as AirportStation[];
  try {
    const r = await fetchAwcJson(`/metar?bbox=${encodeURIComponent(bucket)}&format=json`);
    if (!r.ok) return cached ? (cached.data as AirportStation[]) : [];
    const rows = Array.isArray(r.data) ? (r.data as AwcAreaRow[]) : [];
    const stations: AirportStation[] = rows
      .filter((s) => s && s.icaoId && s.lat != null && s.lon != null)
      .map((s) => ({
        icao: String(s.icaoId).toUpperCase(),
        name: s.name || String(s.icaoId),
        lat: Number(s.lat),
        lon: Number(s.lon),
        raw: typeof s.rawOb === "string" ? s.rawOb.trim() : null,
        observedAt: s.reportTime ?? null,
      }))
      .slice(0, 600);
    awcCache.set(cacheKey, { ts: Date.now(), data: stations });
    return stations;
  } catch {
    return cached ? (cached.data as AirportStation[]) : [];
  }
}

// ---- METAR -> strukturierte Werte für die Go/No-Go-Bewertung ----

const KT_TO_MS = 0.514444;

/**
 * Strukturierte, für die Flugbewertung relevante Werte einer Flugplatz-METAR
 * (nächstgelegener Verkehrsflughafen). Windangaben in m/s (METAR liefert kt),
 * Sicht in Metern, Hauptwolkenuntergrenze in Fuß.
 */
export interface AirportMetarObservation {
  icao: string;
  name: string;
  distanceKm: number;
  observedAt: string | null;
  raw: string;
  windSpeedMs: number | null;
  windGustMs: number | null;
  visibilityM: number | null;
  ceilingFt: number | null;
  hasThunderstorm: boolean;
  hasFreezing: boolean;
  /** Deutsche Klartext-Beschreibung der gemeldeten Wettererscheinungen. */
  phenomenaText: string | null;
  /** Teil A: aus dem Offline-Speicher. */
  offline?: OfflineOrigin;
  /** Teil A: METAR älter als 2 h – nur graue Information, nicht im Urteil. */
  greyOnly?: boolean;
}

function visibilityToMeters(vis?: Visibility, cavok?: boolean): number | null {
  if (cavok) return 9999;
  if (!vis || vis.value == null) return null;
  if (vis.unit === "SM") return Math.round(vis.value * 1609.34);
  // metar-taf-parser liefert die Bodensicht standardmäßig in Metern.
  return vis.value;
}

function lowestCeilingFt(clouds: ICloud[]): number | null {
  const ceil = clouds
    .filter((c) => (c.quantity === CloudQuantity.BKN || c.quantity === CloudQuantity.OVC) && c.height != null)
    .sort((a, b) => (a.height || 0) - (b.height || 0))[0];
  return ceil?.height ?? null;
}

/** Wandelt eine rohe METAR in die für die Bewertung relevanten Werte um. */
export function extractMetarObservation(raw: string): Omit<AirportMetarObservation, "icao" | "name" | "distanceKm" | "observedAt"> {
  const m: IMetar = parseMetar(raw);
  const windSpeedMs = m.wind?.speed != null ? m.wind.speed * KT_TO_MS : null;
  const windGustMs = m.wind?.gust != null ? m.wind.gust * KT_TO_MS : null;
  const conditions = m.weatherConditions || [];
  const hasThunderstorm = conditions.some(
    (c) =>
      c.descriptive === Descriptive.THUNDERSTORM ||
      c.phenomenons?.includes(Phenomenon.THUNDERSTORM),
  );
  const hasFreezing = conditions.some((c) => c.descriptive === Descriptive.FREEZING);
  return {
    raw,
    windSpeedMs,
    windGustMs,
    visibilityM: visibilityToMeters(m.visibility, m.cavok),
    ceilingFt: lowestCeilingFt(m.clouds || []),
    hasThunderstorm,
    hasFreezing,
    phenomenaText: describeWeather(conditions),
  };
}

/**
 * Holt die METAR des nächstgelegenen Verkehrsflughafens (innerhalb radiusKm) und
 * liefert die strukturierten Bewertungswerte. Gibt null zurück, wenn kein
 * Flughafen in Reichweite ist oder keine METAR verfügbar/abrufbar ist
 * (graceful fallback – die Bewertung läuft dann ohne Flugplatzdaten).
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Holt die METAR eines bestimmten Flughafens (per ICAO) und liefert die
 * strukturierten Bewertungswerte – für den CTR-Wetternachweis, bei dem gezielt
 * die METAR des zuständigen CTR-Flughafens (nicht der nächstgelegenen Station)
 * benötigt wird. Gibt null zurück, wenn keine METAR verfügbar/abrufbar ist.
 */
export async function fetchCtrAirportMetar(
  icao: string,
  name: string,
  distanceKm: number,
): Promise<AirportMetarObservation | null> {
  try {
    const weather = await fetchAirportWeather(icao);
    if (!weather.metarRaw) return null;
    const obs = extractMetarObservation(weather.metarRaw);
    return {
      ...obs,
      icao: icao.trim().toUpperCase(),
      name,
      distanceKm: Math.round(distanceKm * 10) / 10,
      observedAt: weather.observedAt,
      ...(weather.offline ? { offline: weather.offline } : {}),
      ...(weather.metarGrey ? { greyOnly: true } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Teil A: nächstgelegene METAR mit Offline-Speicher (Standort 0,05° + Radius).
 * Offline: letzter Stand (< 24 h); älter als 2 h → `greyOnly` (nicht im Urteil).
 */
export async function fetchNearestAirportMetar(
  lat: number,
  lon: number,
  radiusKm: number = 30,
): Promise<AirportMetarObservation | null> {
  try {
    const r = await fetchWithOfflineCache(
      "metar",
      `${offlineLocationKey(lat, lon)}_${Math.round(radiusKm)}`,
      async () => {
        const live = await fetchNearestAirportMetarLive(lat, lon, radiusKm);
        if (!live) throw new Error("keine METAR");
        return live;
      },
    );
    if (!r.cached) return r.data;
    const st = assessOfflineData("metar", metarAgeBase(r.data.observedAt, r.fetchedAt));
    if (!st.show) return null;
    return { ...r.data, offline: { fetchedAt: r.fetchedAt, cached: true }, ...(st.state === "grey" ? { greyOnly: true } : {}) };
  } catch {
    return null;
  }
}

async function fetchNearestAirportMetarLive(
  lat: number,
  lon: number,
  radiusKm: number = 30,
): Promise<AirportMetarObservation | null> {
  // Europaweit: Bbox um die Position abfragen (AWC liefert alle meldenden
  // Stationen mit Position) und die NÄCHSTE Station mit auswertbarer METAR wählen.
  // So funktioniert die Go/No-Go-Bewertung auch außerhalb Deutschlands.
  // ~1° Breite ≈ 111 km; Box etwas größer als radiusKm, damit Grenzfälle reinfallen.
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const bbox: [number, number, number, number] = [
    lat - dLat,
    lon - dLon,
    lat + dLat,
    lon + dLon,
  ];
  try {
    const stations = await fetchAirportStationsInArea(bbox);
    const withRaw = stations
      .filter((s) => !!s.raw)
      .map((s) => ({ s, dist: haversineKm(lat, lon, s.lat, s.lon) }))
      .filter((x) => x.dist <= radiusKm)
      .sort((a, b) => a.dist - b.dist);
    if (withRaw.length === 0) return null;
    const { s, dist } = withRaw[0];
    const obs = extractMetarObservation(s.raw!);
    return {
      ...obs,
      icao: s.icao,
      name: s.name,
      distanceKm: Math.round(dist * 10) / 10,
      observedAt: s.observedAt,
    };
  } catch {
    return null;
  }
}
