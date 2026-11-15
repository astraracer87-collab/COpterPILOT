// Direkte Abfrage der öffentlichen Verkehrsquellen vom Gerät aus (kein
// eigener Server mehr). React Native unterliegt keinen CORS-Beschränkungen,
// daher können die HTTPS-APIs direkt angesprochen werden.
//
// Portiert aus dem früheren server/aggregator.ts + server/ogn.ts. Unterschied
// bei OGN: Der Server hielt eine TCP-APRS-Verbindung (aprs.glidernet.org:10152).
// Rohes TCP gibt es in React Native hier nicht → stattdessen der öffentliche
// HTTPS-Feed von live.glidernet.org (lxml.php), der pro Bounding-Box die
// aktuellen OGN/FLARM-Positionen inkl. Kennzeichen/Wettbewerbskennung liefert.
import type { AircraftCategory, DataSource, SourceStatus } from "../opensky";
import { parseAdsbCategory } from "./classify";
import type { RawState, SourceResult, Tile } from "./types";
import { FT_M } from "../../../shared/heights";

const USER_AGENT = "COpterPilot/1.0 (drone preflight app)";

export const ADSBFI_URL = "https://opendata.adsb.fi/api/v2";
export const ADSBONE_URL = "https://api.adsb.one/v2";
export const AIRPLANESLIVE_URL = "https://api.airplanes.live/v2";
export const ADSBLOL_URL = "https://api.adsb.lol/v2";
export const OGN_LIVE_URL = "https://live.glidernet.org/lxml.php";

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

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal, headers: { "User-Agent": USER_AGENT } });
  } finally {
    clearTimeout(t);
  }
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
      baroAltitude: altM != null ? Math.round(altM) : null,
      geoAltitude: altM != null ? Math.round(altM) : null,
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

// ---- Dispatcher --------------------------------------------------------------

export async function fetchSource(src: DataSource, tiles: Tile[]): Promise<SourceResult> {
  if (tiles.length === 0) return { states: [], status: "ok" };
  switch (src) {
    case "adsbfi": return fetchAdsbAllTiles(ADSBFI_URL, "adsbfi", "lat-lon-dist", tiles);
    case "adsbone": return fetchAdsbAllTiles(ADSBONE_URL, "adsbone", "point", tiles);
    case "airplaneslive": return fetchAdsbAllTiles(AIRPLANESLIVE_URL, "airplaneslive", "point", tiles);
    case "adsblol": return fetchAdsbAllTiles(ADSBLOL_URL, "adsblol", "point", tiles);
    case "ogn": return fetchOgn(tiles);
    // OpenSky (anonym stark limitiert, auf dem Server bereits deaktiviert) und
    // FR24 (inoffizieller Feed, nur mit Browser-User-Agent) werden clientseitig
    // nicht abgefragt.
    case "opensky":
    case "fr24":
      return { states: [], status: "error" };
  }
}
