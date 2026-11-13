import { getNearbyOgn, getOgnStatus } from "./ogn";

export type DataSource = "opensky" | "adsbfi" | "adsbone" | "airplaneslive" | "adsblol" | "ogn";
export type SourceStatus = "ok" | "error" | "timeout";

export type AircraftCategory =
  | "airplane" | "light" | "helicopter" | "glider"
  | "balloon" | "ultralight" | "drone" | "ground" | "unknown";

export interface AircraftState {
  icao24: string;
  callsign: string;
  originCountry: string;
  longitude: number;
  latitude: number;
  baroAltitude: number | null;
  geoAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  category: AircraftCategory;
  sources: DataSource[];
}

const OPENSKY_URL = "https://opensky-network.org/api/states/all";
const ADSBFI_URL = "https://opendata.adsb.fi/api/v2";
const ADSBONE_URL = "https://api.adsb.one/v2";
const AIRPLANESLIVE_URL = "https://api.airplanes.live/v2";
const ADSBLOL_URL = "https://api.adsb.lol/v2";

function feetToMeters(ft: number | null | undefined): number | null {
  if (ft == null) return null;
  return Math.round(ft * 0.3048);
}
function knotsToMs(kts: number | null | undefined): number | null {
  if (kts == null) return null;
  return kts * 0.514444;
}
function fpmToMs(fpm: number | null | undefined): number | null {
  if (fpm == null) return null;
  return fpm * 0.00508;
}
function kmToNm(km: number): number {
  return km * 0.539957;
}

interface OpenSkyResponse {
  time?: number;
  states?: unknown[][] | null;
}

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
}

interface AdsbResponse {
  ac?: AdsbAircraft[];
}

function isErrorWithName(e: unknown, name: string): boolean {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === name;
}

function parseAdsbCategory(cat: string | number | undefined | null): AircraftCategory {
  if (cat == null || cat === "") return "unknown";
  if (typeof cat === "number") {
    if (cat === 7) return "helicopter";
    if (cat === 9) return "glider";
    if (cat === 10) return "balloon";
    if (cat === 14) return "drone";
    if (cat === 1 || cat === 2) return "light";
    if (cat >= 3 && cat <= 6) return "airplane";
    return "unknown";
  }
  const c = String(cat).toUpperCase();
  if (c === "A7") return "helicopter";
  if (c === "A0" || c === "A1") return "light";
  if (c === "B1") return "glider";
  if (c === "B2") return "balloon";
  if (c === "B4") return "ultralight";
  if (c === "B6") return "drone";
  if (c === "C1" || c === "C2" || c === "C3") return "ground";
  if (c.startsWith("A")) return "airplane";
  return "unknown";
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "COpterPilot/1.0 (drone preflight)" },
    });
  } finally {
    clearTimeout(t);
  }
}

async function fetchOpenSky(lat: number, lon: number, radiusKm: number): Promise<{ states: AircraftState[]; status: SourceStatus }> {
  try {
    const degPerKm = 1 / 111.32;
    const dLat = radiusKm * degPerKm;
    const dLon = (radiusKm * degPerKm) / Math.cos((lat * Math.PI) / 180);
    const url = `${OPENSKY_URL}?lamin=${(lat - dLat).toFixed(4)}&lamax=${(lat + dLat).toFixed(4)}&lomin=${(lon - dLon).toFixed(4)}&lomax=${(lon + dLon).toFixed(4)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { states: [], status: "error" };
    const data = (await res.json()) as OpenSkyResponse;
    if (!data.states) return { states: [], status: "ok" };
    const states: AircraftState[] = data.states
      .filter((s) => s[5] != null && s[6] != null)
      .map((s) => ({
        icao24: (typeof s[0] === "string" ? s[0] : "").toLowerCase(),
        callsign: (typeof s[1] === "string" ? s[1] : "").trim(),
        originCountry: typeof s[2] === "string" ? s[2] : "",
        longitude: s[5] as number,
        latitude: s[6] as number,
        baroAltitude: (s[7] as number | null) ?? null,
        geoAltitude: (s[13] as number | null) ?? null,
        onGround: Boolean(s[8]),
        velocity: (s[9] as number | null) ?? null,
        trueTrack: (s[10] as number | null) ?? null,
        verticalRate: (s[11] as number | null) ?? null,
        category: parseAdsbCategory(s[17] as string | number | null | undefined),
        sources: ["opensky" as DataSource],
      }));
    return { states, status: "ok" };
  } catch (e: unknown) {
    return { states: [], status: isErrorWithName(e, "AbortError") ? "timeout" : "error" };
  }
}

async function fetchAdsbSource(
  baseUrl: string,
  source: DataSource,
  lat: number,
  lon: number,
  radiusKm: number,
  pathPattern: "lat-lon-dist" | "point",
): Promise<{ states: AircraftState[]; status: SourceStatus }> {
  try {
    const dist = Math.ceil(kmToNm(radiusKm));
    const url =
      pathPattern === "lat-lon-dist"
        ? `${baseUrl}/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${dist}`
        : `${baseUrl}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${dist}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { states: [], status: "error" };
    const data = (await res.json()) as AdsbResponse;
    const list: AdsbAircraft[] = data.ac ?? [];
    const states: AircraftState[] = list
      .filter((ac) => ac.lat != null && ac.lon != null)
      .map((ac) => ({
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
        sources: [source],
      }));
    return { states, status: "ok" };
  } catch (e: unknown) {
    return { states: [], status: isErrorWithName(e, "AbortError") ? "timeout" : "error" };
  }
}

function fetchOgn(lat: number, lon: number, radiusKm: number): { states: AircraftState[]; status: SourceStatus } {
  try {
    const status = getOgnStatus();
    if (!status.connected) return { states: [], status: "error" };
    const acs = getNearbyOgn(lat, lon, radiusKm);
    const states: AircraftState[] = acs.map((ac) => {
      const altM = ac.altFt != null ? Math.round(ac.altFt * 0.3048) : null;
      let category: AircraftCategory = "unknown";
      const t = ac.acType ?? 0;
      if (t === 1 || t === 6) category = "glider";
      else if (t === 3) category = "helicopter";
      else if (t === 7 || t === 11 || t === 12) category = "balloon";
      else if (t === 13) category = "drone";
      else if (t === 14 || t === 15) category = "ground";
      else if (t === 2 || t === 4 || t === 5 || t === 8 || t === 9) category = "airplane";
      else if (ac.type === "fanet") category = "ultralight";
      else if (ac.type === "icao") category = "airplane";
      else if (ac.type === "flarm" || ac.type === "ogn") category = "glider";

      const rawId = ac.id || "";
      const icao24 = ac.type === "icao" && rawId.length > 3 ? rawId.substring(3).toLowerCase() : `ogn_${rawId.toLowerCase()}`;
      return {
        icao24,
        callsign: rawId,
        originCountry: "",
        longitude: ac.lon,
        latitude: ac.lat,
        baroAltitude: altM,
        geoAltitude: altM,
        onGround: ac.altFt != null && ac.altFt < 50 && (ac.speedKts ?? 0) < 5,
        velocity: ac.speedKts != null ? ac.speedKts * 0.514444 : null,
        trueTrack: ac.course ?? null,
        verticalRate: ac.vsFpm != null ? ac.vsFpm * 0.00508 : null,
        category,
        sources: ["ogn" as DataSource],
      };
    });
    return { states, status: "ok" };
  } catch {
    return { states: [], status: "error" };
  }
}

function mergeAircraft(sources: { states: AircraftState[] }[]): AircraftState[] {
  const byIcao = new Map<string, AircraftState[]>();
  for (const s of sources) {
    for (const ac of s.states) {
      if (!ac.icao24 || ac.icao24.length < 3) continue;
      const list = byIcao.get(ac.icao24) || [];
      list.push(ac);
      byIcao.set(ac.icao24, list);
    }
  }
  const merged: AircraftState[] = [];
  for (const [, reports] of byIcao) {
    if (reports.length === 1) {
      merged.push({ ...reports[0] });
      continue;
    }
    const base = { ...reports[0] };
    base.sources = Array.from(new Set(reports.flatMap((r) => r.sources)));
    for (const r of reports.slice(1)) {
      if (!base.callsign && r.callsign) base.callsign = r.callsign;
      if (!base.originCountry && r.originCountry) base.originCountry = r.originCountry;
      if (base.category === "unknown" && r.category !== "unknown") base.category = r.category;
      if (base.baroAltitude == null && r.baroAltitude != null) base.baroAltitude = r.baroAltitude;
      if (base.geoAltitude == null && r.geoAltitude != null) base.geoAltitude = r.geoAltitude;
      if (base.velocity == null && r.velocity != null) base.velocity = r.velocity;
      if (base.trueTrack == null && r.trueTrack != null) base.trueTrack = r.trueTrack;
      if (base.verticalRate == null && r.verticalRate != null) base.verticalRate = r.verticalRate;
    }
    merged.push(base);
  }
  return merged;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface CacheEntry {
  ts: number;
  payload: TrafficResponse;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3000;

export interface TrafficResponse {
  fetchedAt: number;
  count: number;
  sourceStatus: Record<DataSource, SourceStatus>;
  states: AircraftState[];
}

export async function fetchNearbyTraffic(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<TrafficResponse> {
  const key = `${lat.toFixed(2)}|${lon.toFixed(2)}|${radiusKm}`;
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.payload;

  const [opensky, adsbfi, adsbone, airplaneslive, adsblol] = await Promise.all([
    fetchOpenSky(lat, lon, radiusKm),
    fetchAdsbSource(ADSBFI_URL, "adsbfi", lat, lon, radiusKm, "lat-lon-dist"),
    fetchAdsbSource(ADSBONE_URL, "adsbone", lat, lon, radiusKm, "point"),
    fetchAdsbSource(AIRPLANESLIVE_URL, "airplaneslive", lat, lon, radiusKm, "point"),
    fetchAdsbSource(ADSBLOL_URL, "adsblol", lat, lon, radiusKm, "point"),
  ]);
  const ogn = fetchOgn(lat, lon, radiusKm);

  const merged = mergeAircraft([opensky, adsbfi, adsbone, airplaneslive, adsblol, ogn]);
  const states = merged
    .filter((ac) => haversineKm(lat, lon, ac.latitude, ac.longitude) <= radiusKm)
    .sort((a, b) => haversineKm(lat, lon, a.latitude, a.longitude) - haversineKm(lat, lon, b.latitude, b.longitude));

  const payload: TrafficResponse = {
    fetchedAt: now,
    count: states.length,
    sourceStatus: {
      opensky: opensky.status,
      adsbfi: adsbfi.status,
      adsbone: adsbone.status,
      airplaneslive: airplaneslive.status,
      adsblol: adsblol.status,
      ogn: ogn.status,
    },
    states,
  };
  cache.set(key, { ts: now, payload });
  // prune cache
  if (cache.size > 50) {
    for (const [k, v] of cache) {
      if (now - v.ts > 60000) cache.delete(k);
    }
  }
  return payload;
}
