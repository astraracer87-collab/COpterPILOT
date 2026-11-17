// Direkte Abfrage der öffentlichen Verkehrsquellen vom Gerät aus (kein
// eigener Server mehr). React Native unterliegt keinen CORS-Beschränkungen,
// daher können die HTTPS-APIs direkt angesprochen werden.
//
// Portiert aus dem früheren server/aggregator.ts + server/ogn.ts. Unterschied
// bei OGN: Der Server hielt eine TCP-APRS-Verbindung (aprs.glidernet.org:10152).
// Rohes TCP gibt es in React Native hier nicht → stattdessen der öffentliche
// HTTPS-Feed von live.glidernet.org (lxml.php), der pro Bounding-Box die
// aktuellen OGN/FLARM-Positionen inkl. Kennzeichen/Wettbewerbskennung liefert.
//
// FR24: inoffizieller Web-Feed (data-cloud.flightradar24.com/zones/fcgi/feed.js),
// Nutzung mit Zustimmung von Flightradar24 für diese kostenlose App – siehe
// docs/air-traffic-quellen.md §3/§4. Zusatzquelle, die ADS-B-/OGN-Feeds bleiben
// die Basis.
import type { AircraftCategory, DataSource, SourceStatus } from "../opensky";
import { parseAdsbCategory, refineCategoryByType } from "./classify";
import { fetchWithTimeout as fetchWithTimeoutShared } from "../fetchWithTimeout";
import type { RawState, SourceResult, Tile } from "./types";
import { FT_M } from "../../../shared/heights";

const USER_AGENT = "COpterPilot/1.0 (drone preflight app)";

export const ADSBFI_URL = "https://opendata.adsb.fi/api/v2";
export const ADSBONE_URL = "https://api.adsb.one/v2";
export const AIRPLANESLIVE_URL = "https://api.airplanes.live/v2";
export const ADSBLOL_URL = "https://api.adsb.lol/v2";
export const OGN_LIVE_URL = "https://live.glidernet.org/lxml.php";
export const FR24_FEED_URL = "https://data-cloud.flightradar24.com/zones/fcgi/feed.js";

/**
 * FR24 erwartet einen normalen Browser-User-Agent (der Feed-Endpunkt ist laut
 * Live-Prüfung nicht Cloudflare-geschützt, ein Mobile-UA genügt). origin/referer
 * wie die Webseite.
 */
const FR24_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const FR24_HEADERS: Record<string, string> = {
  "User-Agent": FR24_USER_AGENT,
  Accept: "application/json",
  Origin: "https://www.flightradar24.com",
  Referer: "https://www.flightradar24.com/",
};
/**
 * Bounding-Box für FR24 klein halten (Doku §5: keine offiziellen Rate-Limits,
 * defensiv abfragen). 60 NM ≈ 111 km Halbkante deckt den maximalen Radar-Radius
 * (100 km) ab; größere Kacheln (bis 250 NM für die ADS-B-Point-APIs) werden für
 * FR24 auf diesen Wert gekappt.
 */
export const FR24_MAX_DIST_NM = 60;
/** FR24-Positionen älter als das gelten als nicht mehr live (Feldindex 10 = Zeit). */
export const FR24_MAX_AGE_SEC = 120;
const FR24_TIMEOUT_MS = 8000;

/** OGN-Meldungen älter als das gelten als nicht mehr live. */
export const OGN_MAX_AGE_SEC = 120;

// ---- Hilfsfunktionen --------------------------------------------------------

function feetToMeters(ft: number | null | undefined): number | null {
  if (ft == null) return null;
  return Math.round(ft * FT_M);
}
const MAX_PLAUSIBLE_VELOCITY_MS = 400;
function sanitizeVelocity(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < 0) return null;
  if (v > MAX_PLAUSIBLE_VELOCITY_MS) return null;
  return v;
}
function knotsToMs(kts: number | null | undefined): number | null {
  if (kts == null) return null;
  return sanitizeVelocity(kts * 0.514444);
}
function fpmToMs(fpm: number | null | undefined): number | null {
  if (fpm == null) return null;
  return fpm * 0.00508;
}

function isAbortError(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
}

function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = { "User-Agent": USER_AGENT },
): Promise<Response> {
  return fetchWithTimeoutShared(url, { headers }, timeoutMs);
}

/** Kachel (Mittelpunkt + Radius in NM) → Bounding-Box in Grad. */
export function tileToBbox(tile: Tile): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const distKm = tile.distNm * 1.852;
  const dLat = distKm / 111;
  const dLon = distKm / (111 * Math.max(0.2, Math.cos((tile.lat * Math.PI) / 180)));
  return {
    latMin: Math.max(-90, tile.lat - dLat),
    latMax: Math.min(90, tile.lat + dLat),
    lonMin: Math.max(-180, tile.lon - dLon),
    lonMax: Math.min(180, tile.lon + dLon),
  };
}

// ---- ADS-B-Aggregatoren (readsb-JSON: adsb.lol, airplanes.live, adsb.fi, adsb.one)

interface AdsbAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  category?: string;
  t?: string;
  desc?: string;
  r?: string;
  ownOp?: string;
  dbFlags?: number;
}
// adsb.lol/airplanes.live liefern "ac", adsb.fi (opendata) liefert "aircraft".
interface AdsbResponse { ac?: AdsbAircraft[]; aircraft?: AdsbAircraft[]; }

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function parseAdsbResponse(data: AdsbResponse, src: DataSource): RawState[] {
  const list: AdsbAircraft[] = data.ac ?? data.aircraft ?? [];
  return list
    .filter((ac) => typeof ac.lat === "number" && typeof ac.lon === "number")
    .map((ac) => {
      const dbf = typeof ac.dbFlags === "number" ? ac.dbFlags : 0;
      return {
        icao24: (ac.hex || "").toLowerCase(),
        callsign: (ac.flight || "").trim(),
        originCountry: "",
        longitude: ac.lon as number,
        latitude: ac.lat as number,
        baroAltitude: ac.alt_baro === "ground" ? 0 : feetToMeters(typeof ac.alt_baro === "number" ? ac.alt_baro : null),
        geoAltitude: feetToMeters(ac.alt_geom ?? null),
        onGround: ac.alt_baro === "ground",
        velocity: knotsToMs(ac.gs ?? null),
        trueTrack: ac.track ?? null,
        verticalRate: ac.baro_rate != null ? fpmToMs(ac.baro_rate) : null,
        category: parseAdsbCategory(ac.category),
        sources: [src],
        registration: str(ac.r),
        aircraftType: str(ac.t),
        aircraftDesc: str(ac.desc),
        operator: str(ac.ownOp),
        military: (dbf & 1) !== 0 || undefined,
        interesting: (dbf & 2) !== 0 || undefined,
        pia: (dbf & 4) !== 0 || undefined,
        ladd: (dbf & 8) !== 0 || undefined,
      };
    });
}

async function fetchAdsbTile(
  baseUrl: string,
  src: DataSource,
  tile: Tile,
  pathPattern: "lat-lon-dist" | "point",
): Promise<SourceResult> {
  try {
    const url =
      pathPattern === "lat-lon-dist"
        ? `${baseUrl}/lat/${tile.lat.toFixed(4)}/lon/${tile.lon.toFixed(4)}/dist/${tile.distNm}`
        : `${baseUrl}/point/${tile.lat.toFixed(4)}/${tile.lon.toFixed(4)}/${tile.distNm}`;
    const res = await fetchWithTimeout(url, 8000);
    if (res.status === 429 || res.status === 403) return { states: [], status: "error", rateLimited: true };
    if (!res.ok) return { states: [], status: "error" };
    const data = (await res.json()) as AdsbResponse;
    return { states: parseAdsbResponse(data, src), status: "ok" };
  } catch (e) {
    return { states: [], status: isAbortError(e) ? "timeout" : "error" };
  }
}

async function fetchAdsbAllTiles(
  baseUrl: string,
  src: DataSource,
  pathPattern: "lat-lon-dist" | "point",
  tiles: Tile[],
): Promise<SourceResult> {
  const results = await Promise.all(tiles.map((t) => fetchAdsbTile(baseUrl, src, t, pathPattern)));
  const anyOk = results.some((r) => r.status === "ok");
  const status: SourceStatus = anyOk ? "ok" : (results[0]?.status ?? "error");
  const rateLimited = results.some((r) => r.rateLimited);
  const dedup = new Map<string, RawState>();
  for (const r of results) {
    for (const s of r.states) {
      if (!s.icao24 || s.icao24.length < 3) continue;
      if (!dedup.has(s.icao24)) dedup.set(s.icao24, s);
    }
  }
  return { states: Array.from(dedup.values()), status, rateLimited };
}

// ---- OGN (live.glidernet.org, HTTPS) ----------------------------------------
//
// Format je Zeile:
//   <m a="lat,lon,cn,reg,alt_m,zeit_utc,alter_s,kurs,speed_kmh,vario_ms,acType,empfänger,deviceId,uniqueId"/>
// - deviceId: 6-stelliger Hex der FLARM-/ICAO-Adresse ("0" bei anonymisierten
//   Geräten). Bei ICAO-adressierten Geräten identisch mit dem ADS-B-Hex.
// - cn beginnt mit "_" und reg == uniqueId bei Geräten ohne DDB-Eintrag /
//   mit Privatsphäre-Flag → dann keine Registrierung/CN übernehmen.
// - acType = OGN-Luftfahrzeugtyp (1=Segler, 2=Schlepp, 3=Heli, 4=Fallschirm,
//   5=Absetzflugzeug, 6=Hängegleiter, 7=Gleitschirm, 8=Motorflugzeug, 9=Jet,
//   10=UFO, 11=Ballon, 12=Luftschiff, 13=UAV, 14=reserviert, 15=statisch).

function ognCategory(acType: number): AircraftCategory {
  switch (acType) {
    case 1: return "glider";
    case 2: return "light";
    case 3: return "helicopter";
    case 4: return "ultralight";
    case 5: return "light";
    case 6: return "glider";
    case 7: return "ultralight";
    case 8: return "light";
    case 9: return "airplane";
    case 11:
    case 12: return "balloon";
    case 13: return "drone";
    case 14:
    case 15: return "ground";
    default: return "unknown";
  }
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Zerlegt die lxml-Antwort von live.glidernet.org. Exportiert für Tests. */
export function parseOgnLxml(xml: string, maxAgeSec: number = OGN_MAX_AGE_SEC): RawState[] {
  const out: RawState[] = [];
  const seen = new Set<string>();
  const re = /<m\s+a="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const f = m[1].split(",");
    if (f.length < 14) continue;
    const lat = num(f[0]);
    const lon = num(f[1]);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const ageSec = num(f[6]);
    if (ageSec == null || ageSec > maxAgeSec || ageSec < 0) continue;

    const rawCn = (f[2] || "").trim();
    const rawReg = (f[3] || "").trim();
    const altM = num(f[4]);
    const track = num(f[7]);
    const speedKmh = num(f[8]);
    const vario = num(f[9]);
    const acType = num(f[10]) ?? 0;
    const devId = (f[12] || "").trim().toLowerCase();
    const uniqueId = (f[13] || "").trim().toLowerCase();

    const anonymous = rawCn.startsWith("_") || (rawReg !== "" && rawReg.toLowerCase() === uniqueId);
    const registration = !anonymous && rawReg ? rawReg : undefined;
    const cn = !anonymous && rawCn ? rawCn : undefined;

    // ID-Schema wie zuvor auf dem Server: "ogn_flr<hex>" erlaubt mergeByIcao,
    // ein ICAO-adressiertes FLARM-Gerät mit dem ADS-B-Eintrag gleichen Hex zu
    // verschmelzen. Ohne Device-ID → stabile Synthetik-ID aus der uniqueId.
    const hasHex = /^[0-9a-f]{6}$/.test(devId) && devId !== "000000";
    const icao24 = hasHex ? `ogn_flr${devId}` : `ogn_${uniqueId || `${lat.toFixed(3)}_${lon.toFixed(3)}`}`;
    if (seen.has(icao24)) continue;
    seen.add(icao24);

    const velocity = speedKmh != null ? sanitizeVelocity(speedKmh / 3.6) : null;
    out.push({
      icao24,
      callsign: cn || registration || (hasHex ? devId.toUpperCase() : rawCn.replace(/^_/, "") || "OGN"),
      originCountry: "",
      longitude: lon,
      latitude: lat,
      baroAltitude: null,
      geoAltitude: null,
      mslAltitude: altM != null ? Math.round(altM) : null,
      // Wie zuvor auf dem Server: nur praktisch auf Meereshöhe stehend gilt als
      // "am Boden" — gelandete Segler filtert getNearby über die Geschwindigkeit.
      onGround: altM != null && altM < 15 && (speedKmh ?? 0) < 9,
      velocity,
      trueTrack: track,
      verticalRate: vario,
      category: ognCategory(acType),
      sources: ["ogn"],
      registration,
      cn,
      reportAgeMs: Math.round(ageSec * 1000),
    });
  }
  return out;
}

async function fetchOgnTile(tile: Tile): Promise<SourceResult> {
  try {
    const b = tileToBbox(tile);
    const url =
      `${OGN_LIVE_URL}?a=0&b=${b.latMax.toFixed(4)}&c=${b.latMin.toFixed(4)}` +
      `&d=${b.lonMax.toFixed(4)}&e=${b.lonMin.toFixed(4)}&z=9`;
    const res = await fetchWithTimeout(url, 8000);
    if (res.status === 429 || res.status === 403) return { states: [], status: "error", rateLimited: true };
    if (!res.ok) return { states: [], status: "error" };
    const text = await res.text();
    if (!text.includes("<markers")) return { states: [], status: "error" };
    return { states: parseOgnLxml(text), status: "ok" };
  } catch (e) {
    return { states: [], status: isAbortError(e) ? "timeout" : "error" };
  }
}

async function fetchOgn(tiles: Tile[]): Promise<SourceResult> {
  const results = await Promise.all(tiles.map((t) => fetchOgnTile(t)));
  const anyOk = results.some((r) => r.status === "ok");
  const status: SourceStatus = anyOk ? "ok" : (results[0]?.status ?? "error");
  const rateLimited = results.some((r) => r.rateLimited);
  const dedup = new Map<string, RawState>();
  for (const r of results) {
    for (const s of r.states) {
      if (!dedup.has(s.icao24)) dedup.set(s.icao24, s);
    }
  }
  return { states: Array.from(dedup.values()), status, rateLimited };
}

// ---- FlightRadar24 (feed.js, inoffizieller Web-Feed, mit Zustimmung von FR24)
//
// Antwort: JSON-Objekt; nicht-numerische Schlüssel (full_count, version, stats)
// werden übersprungen, jeder mit einer Ziffer beginnende Schlüssel ist ein Flug
// (Schlüssel = FR24-flight_id) mit Positions-Array, Feldindizes siehe Doku §3.4.

const FR24 = {
  HEX: 0, LAT: 1, LON: 2, TRACK: 3, ALT_FT: 4, GSPD_KT: 5, SQUAWK: 6,
  RADAR: 7, TYPE: 8, REG: 9, TIME: 10, ORIG: 11, DEST: 12, FLIGHT: 13,
  ON_GROUND: 14, VSPD_FPM: 15, CALLSIGN: 16, AIRLINE_ICAO: 18,
} as const;

export interface ParseFr24Options {
  /** Abrufzeitpunkt (ms). Gesetzt → reportAgeMs aus Feld 10 + Alter-Filter. */
  nowMs?: number;
  /** Maximales Positionsalter in s (nur mit nowMs wirksam). */
  maxAgeSec?: number;
}

function fr24Num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parst eine FR24-feed.js-Antwort in RawState[] (nicht-numerische Keys werden übersprungen). */
export function parseFr24Feed(data: Record<string, unknown>, opts: ParseFr24Options = {}): RawState[] {
  const out: RawState[] = [];
  if (!data || typeof data !== "object") return out;
  const maxAgeSec = opts.maxAgeSec ?? FR24_MAX_AGE_SEC;
  const seen = new Set<string>();
  for (const [id, raw] of Object.entries(data)) {
    if (!/^[0-9]/.test(id)) continue; // full_count/version/stats überspringen
    if (!Array.isArray(raw) || raw.length < 17) continue;
    const a = raw as unknown[];
    const lat = fr24Num(a[FR24.LAT]);
    const lon = fr24Num(a[FR24.LON]);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    let reportAgeMs: number | undefined;
    const time = fr24Num(a[FR24.TIME]);
    if (opts.nowMs != null && time != null && time > 0) {
      const ageSec = opts.nowMs / 1000 - time;
      if (ageSec > maxAgeSec) continue;
      // Uhrabweichung Gerät↔FR24: negative Alter als "jetzt" werten.
      reportAgeMs = Math.max(0, Math.round(ageSec * 1000));
    }

    const hexRaw = typeof a[FR24.HEX] === "string" ? (a[FR24.HEX] as string) : "";
    const hex = hexRaw.toLowerCase().trim();
    // Synthetische Radar-/Schätz-Targets ohne Hex → fr24-<flight_id>; merge.ts
    // sortiert fr24-* bei Registrierungs-Dubletten ans Ende.
    const icao24 = /^[0-9a-f]{3,}$/.test(hex) ? hex : `fr24-${id}`;
    if (seen.has(icao24)) continue;
    seen.add(icao24);

    const type = str(a[FR24.TYPE]);
    const registration = str(a[FR24.REG]);
    const onGround = a[FR24.ON_GROUND] === 1 || a[FR24.ON_GROUND] === "1";
    const altFt = fr24Num(a[FR24.ALT_FT]);
    const gsKt = fr24Num(a[FR24.GSPD_KT]);
    const track = fr24Num(a[FR24.TRACK]);
    const vsFpm = fr24Num(a[FR24.VSPD_FPM]);
    const typeUpper = type?.toUpperCase();
    // FR24 kennt Bodenfahrzeuge (vehicles=1, Typ "GRND"/"GND") → Kategorie Boden.
    // Sonst ab "unbekannt" über das Typkürzel einstufen (classify.ts deckt die
    // FR24-aircraft_codes ab; plausible, unbekannte Kürzel → "Flugzeug").
    const isGroundVehicle = typeUpper === "GRND" || typeUpper === "GND";

    out.push({
      icao24,
      callsign: str(a[FR24.CALLSIGN]) ?? "",
      originCountry: "",
      longitude: lon,
      latitude: lat,
      baroAltitude: onGround ? 0 : feetToMeters(altFt),
      geoAltitude: null,
      onGround,
      velocity: knotsToMs(gsKt),
      trueTrack: track,
      verticalRate: vsFpm != null ? fpmToMs(vsFpm) : null,
      category: isGroundVehicle ? "ground" : refineCategoryByType("unknown", type, registration),
      sources: ["fr24"],
      registration,
      aircraftType: type,
      operator: str(a[FR24.AIRLINE_ICAO]),
      originIata: str(a[FR24.ORIG]),
      destIata: str(a[FR24.DEST]),
      flightNumber: str(a[FR24.FLIGHT]),
      ...(reportAgeMs != null ? { reportAgeMs } : {}),
    });
  }
  return out;
}

/** FR24-Feed-URL für eine Kachel (bounds = Nord,Süd,West,Ost; Kachel gekappt). */
export function buildFr24FeedUrl(tile: Tile): string {
  const b = tileToBbox({ ...tile, distNm: Math.min(tile.distNm, FR24_MAX_DIST_NM) });
  const bounds = `${b.latMax.toFixed(3)},${b.latMin.toFixed(3)},${b.lonMin.toFixed(3)},${b.lonMax.toFixed(3)}`;
  const params = new URLSearchParams({
    bounds, faa: "1", satellite: "1", mlat: "1", flarm: "1", adsb: "1",
    gnd: "1", air: "1", vehicles: "1", estimated: "1", gliders: "1",
    maxage: "14400", stats: "0", limit: "5000",
  });
  return `${FR24_FEED_URL}?${params.toString()}`;
}

async function fetchFr24Tile(tile: Tile): Promise<SourceResult> {
  try {
    const res = await fetchWithTimeout(buildFr24FeedUrl(tile), FR24_TIMEOUT_MS, FR24_HEADERS);
    if (res.status === 429 || res.status === 403) return { states: [], status: "error", rateLimited: true };
    if (!res.ok) return { states: [], status: "error" };
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return { states: [], status: "error" };
    return { states: parseFr24Feed(data as Record<string, unknown>, { nowMs: Date.now() }), status: "ok" };
  } catch (e) {
    return { states: [], status: isAbortError(e) ? "timeout" : "error" };
  }
}

async function fetchFr24(tiles: Tile[]): Promise<SourceResult> {
  const results = await Promise.all(tiles.map((t) => fetchFr24Tile(t)));
  const anyOk = results.some((r) => r.status === "ok");
  const status: SourceStatus = anyOk ? "ok" : (results[0]?.status ?? "error");
  const rateLimited = results.some((r) => r.rateLimited);
  const dedup = new Map<string, RawState>();
  for (const r of results) {
    for (const s of r.states) {
      if (!s.icao24) continue;
      if (!dedup.has(s.icao24)) dedup.set(s.icao24, s);
    }
  }
  return { states: Array.from(dedup.values()), status, rateLimited };
}

// ---- Dispatcher --------------------------------------------------------------

export async function fetchSource(src: DataSource, tiles: Tile[]): Promise<SourceResult> {
  if (tiles.length === 0) return { states: [], status: "ok" };
  switch (src) {
    case "adsbfi": return fetchAdsbAllTiles(ADSBFI_URL, "adsbfi", "lat-lon-dist", tiles);
    case "adsbone": return fetchAdsbAllTiles(ADSBONE_URL, "adsbone", "point", tiles);
    case "airplaneslive": return fetchAdsbAllTiles(AIRPLANESLIVE_URL, "airplaneslive", "point", tiles);
    case "adsblol": return fetchAdsbAllTiles(ADSBLOL_URL, "adsblol", "point", tiles);
    case "ogn": return fetchOgn(tiles);
    case "fr24": return fetchFr24(tiles);
    // OpenSky (anonym stark limitiert, auf dem Server bereits deaktiviert) wird
    // clientseitig nicht abgefragt.
    case "opensky":
      return { states: [], status: "error" };
  }
}
