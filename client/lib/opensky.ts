export type AircraftCategory =
  | "airplane"
  | "light"
  | "helicopter"
  | "glider"
  | "balloon"
  | "ultralight"
  | "drone"
  | "ground"
  | "unknown";

export type DataSource = "opensky" | "adsbfi" | "adsbone" | "airplaneslive" | "adsblol" | "ogn";

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
  lastSeen?: number;
  isStale?: boolean;
  aglAltitude?: number | null;
  groundElevation?: number | null;
}

export interface MultiSourceResponse {
  time: number;
  states: AircraftState[];
  sourceStatus: Record<DataSource, "ok" | "error" | "timeout">;
}

const ULTRALIGHT_TYPES = new Set([
  "C42", "CT2K", "CTLS", "CTSW", "CTSS", "DYNA", "EV97", "FK9", "FK14",
  "JABI", "P92", "P2002", "P2008", "RALL", "RANS", "SAVG", "SKRG",
  "WT9", "BREE", "GALL", "IKRS", "PULS", "ROTO", "TAND", "TRIS",
  "CORN", "CZAW", "B22J", "AERO", "ALPI", "AQUI",
  "VIRUS", "VIRS", "SW80", "SW90", "ALTO", "MCR",
]);

const HELI_TYPES = new Set([
  "EC35", "EC45", "EC55", "EC65", "EC30", "EC20", "EC25",
  "R22", "R44", "R66", "R300",
  "B06", "B105", "B206", "B222", "B230", "B407", "B412", "B429", "B430", "B505",
  "A109", "A119", "A139", "A149", "A169", "A189",
  "AS50", "AS55", "AS32", "AS65", "AS30", "AS31", "AS35", "AS36",
  "S55", "S58", "S61", "S64", "S65", "S70", "S76", "S92",
  "H500", "H269", "H47", "H53", "H60", "H64",
  "MD52", "MD60", "MD90", "EXPL", "LAMA", "ALLI",
  "BK17", "K32", "KA26", "KA32", "MI2", "MI8", "MI17", "MI24", "MI26", "MI28",
  "NH90", "PUMA", "LYNX", "CHIN", "COUG", "DAUP", "GAZE",
  "UH1", "UH60", "AH1", "AH64", "CH47", "CH53", "V22",
  "A3ST", "SA31", "SA32", "SA33", "SA34", "SA36", "SA34",
  "CABR", "COLT", "DJIN", "FALC", "WASP",
  "SW4", "W3", "AW09", "AW10", "AW13", "AW16", "AW18", "AW19",
  "H125", "H130", "H135", "H145", "H155", "H160", "H175", "H215", "H225",
  "S300", "S333", "S434",
  "G2CA",
]);

function parseAdsbCategory(cat: string | number | undefined | null, typeCode?: string | null, desc?: string | null, callsign?: string | null): AircraftCategory {
  if (cat != null && cat !== "") {
    if (typeof cat === "number") {
      const numResult = parseOpenSkyCategory(cat);
      if (numResult !== "unknown") return numResult;
    } else {
      const c = cat.toUpperCase();
      if (c === "A7") return "helicopter";
      if (c === "A0" || c === "A1") return "light";
      if (c === "B1") return "glider";
      if (c === "B2") return "balloon";
      if (c === "B4") return "ultralight";
      if (c === "B6") return "drone";
      if (c === "C1" || c === "C2" || c === "C3") return "ground";
      if (c.startsWith("A")) return "airplane";
    }
  }

  if (typeCode) {
    const tc = typeCode.toUpperCase();
    if (HELI_TYPES.has(tc)) return "helicopter";
    if (ULTRALIGHT_TYPES.has(tc)) return "ultralight";
  }
  if (desc) {
    const d = desc.toUpperCase().trim();
    if (/^H\d/.test(d)) return "helicopter";
    if (/^G\d/.test(d)) return "glider";
    if (d.includes("ULTRALIGHT") || d.includes("MICROLIGHT") || d.includes("ULM") || d.includes("ULTRA LIGHT")) return "ultralight";
  }

  if (callsign) {
    const cs = callsign.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (/^DM[A-Z]/.test(cs)) return "ultralight";
    if (/^D[0-9]{4}$/.test(cs)) return "glider";
  }

  return "unknown";
}

const OPENSKY_URL = "https://opensky-network.org/api/states/all";
const ADSBFI_URL = "https://opendata.adsb.fi/api/v2";
const ADSBONE_URL = "https://api.adsb.one/v2";
const AIRPLANESLIVE_URL = "https://api.airplanes.live/v2";
const ADSBLOL_URL = "https://api.adsb.lol/v2";

async function fetchWithRetry(url: string, retries = 1, timeoutMs = 10000): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok || attempt === retries) return res;
      await new Promise((r) => setTimeout(r, 500));
    } catch (err: any) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

type UrlBuilder = (baseUrl: string, lat: number, lon: number, distNm: number) => string;

const adsbfiUrlBuilder: UrlBuilder = (base, lat, lon, dist) =>
  `${base}/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${dist}`;

const adsboneUrlBuilder: UrlBuilder = (base, lat, lon, dist) =>
  `${base}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${dist}`;

const airplanesliveUrlBuilder: UrlBuilder = (base, lat, lon, dist) =>
  `${base}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${dist}`;

const adsblolUrlBuilder: UrlBuilder = (base, lat, lon, dist) =>
  `${base}/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${dist}`;

async function fetchOpenSky(
  lat: number,
  lon: number,
  radiusKm: number
): Promise<{ states: AircraftState[]; status: "ok" | "error" | "timeout" }> {
  try {
    const degPerKm = 1 / 111.32;
    const latDelta = radiusKm * degPerKm;
    const lonDelta = radiusKm * degPerKm / Math.cos((lat * Math.PI) / 180);

    const url = `${OPENSKY_URL}?lamin=${(lat - latDelta).toFixed(4)}&lamax=${(lat + latDelta).toFixed(4)}&lomin=${(lon - lonDelta).toFixed(4)}&lomax=${(lon + lonDelta).toFixed(4)}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) return { states: [], status: "error" };

    const data = await response.json();
    if (!data.states || data.states.length === 0) return { states: [], status: "ok" };

    const states: AircraftState[] = data.states
      .filter((s: any[]) => s[5] != null && s[6] != null)
      .map((s: any[]) => ({
        icao24: (s[0] || "").toLowerCase(),
        callsign: (s[1] || "").trim(),
        originCountry: s[2] || "",
        longitude: s[5],
        latitude: s[6],
        baroAltitude: s[7],
        geoAltitude: s[13],
        onGround: s[8] || false,
        velocity: s[9],
        trueTrack: s[10],
        verticalRate: s[11],
        category: parseAdsbCategory(s[17] != null ? s[17] : undefined, null, null, s[1]),
        sources: ["opensky" as DataSource],
      }));

    return { states, status: "ok" };
  } catch (err: any) {
    if (err.name === "AbortError") return { states: [], status: "timeout" };
    return { states: [], status: "error" };
  }
}

function parseOpenSkyCategory(cat: number): AircraftCategory {
  if (cat === 7) return "helicopter";
  if (cat === 9) return "glider";
  if (cat === 10) return "balloon";
  if (cat === 14) return "drone";
  if (cat === 1 || cat === 2) return "light";
  if (cat >= 3 && cat <= 6) return "airplane";
  return "unknown";
}

function kmToNm(km: number): number {
  return km * 0.539957;
}

async function fetchAdsbSource(
  baseUrl: string,
  sourceName: DataSource,
  lat: number,
  lon: number,
  radiusKm: number,
  buildUrl: UrlBuilder
): Promise<{ states: AircraftState[]; status: "ok" | "error" | "timeout" }> {
  try {
    const dist = Math.ceil(kmToNm(radiusKm));
    const url = buildUrl(baseUrl, lat, lon, dist);

    const response = await fetchWithRetry(url);

    if (!response.ok) return { states: [], status: "error" };

    const data = await response.json();
    const acList = data.ac || [];

    const states: AircraftState[] = acList
      .filter((ac: any) => ac.lat != null && ac.lon != null)
      .map((ac: any) => ({
        icao24: (ac.hex || "").toLowerCase(),
        callsign: (ac.flight || "").trim(),
        originCountry: "",
        longitude: ac.lon,
        latitude: ac.lat,
        baroAltitude: ac.alt_baro === "ground" ? 0 : feetToMeters(ac.alt_baro),
        geoAltitude: feetToMeters(ac.alt_geom),
        onGround: ac.alt_baro === "ground",
        velocity: knotsToMs(ac.gs),
        trueTrack: ac.track ?? null,
        verticalRate: ac.baro_rate != null ? fpmToMs(ac.baro_rate) : null,
        category: parseAdsbCategory(ac.category, ac.t, ac.desc, ac.flight || ac.r),
        sources: [sourceName],
      }));

    return { states, status: "ok" };
  } catch (err: any) {
    if (err.name === "AbortError") return { states: [], status: "timeout" };
    return { states: [], status: "error" };
  }
}

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

const prevPositions = new Map<string, { lat: number; lon: number; ts: number }>();

function distKmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function mergeAircraft(allSources: { states: AircraftState[] }[]): AircraftState[] {
  const byIcao = new Map<string, AircraftState[]>();
  const ognFlarmToIcao = new Map<string, string>();

  for (const source of allSources) {
    for (const ac of source.states) {
      if (!ac.icao24 || ac.icao24.length < 3) continue;
      if (ac.icao24.startsWith("ogn_flr") || ac.icao24.startsWith("ogn_ica")) {
        const hex = ac.icao24.substring(7);
        if (hex.length === 6) ognFlarmToIcao.set(ac.icao24, hex);
      }
      const list = byIcao.get(ac.icao24) || [];
      list.push(ac);
      byIcao.set(ac.icao24, list);
    }
  }

  for (const [ognKey, hex] of ognFlarmToIcao) {
    const adsbReports = byIcao.get(hex);
    if (adsbReports && byIcao.has(ognKey)) {
      const ognReports = byIcao.get(ognKey)!;
      const combined = [...ognReports, ...adsbReports];
      byIcao.set(hex, combined);
      byIcao.delete(ognKey);
    }
  }

  const now = Date.now();
  const merged = new Map<string, AircraftState>();

  for (const [icao, reports] of byIcao) {
    if (reports.length === 1) {
      merged.set(icao, { ...reports[0] });
    } else {
      const base = { ...reports[0] };
      base.sources = [...new Set(reports.flatMap((r) => r.sources))];

      if (reports.length >= 3) {
        const positions = reports.map((r) => ({ lat: r.latitude, lon: r.longitude, src: r.sources[0] }));
        const avgLat = positions.reduce((s, p) => s + p.lat, 0) / positions.length;
        const avgLon = positions.reduce((s, p) => s + p.lon, 0) / positions.length;
        const distances = positions.map((p) => ({
          ...p,
          dist: distKmBetween(p.lat, p.lon, avgLat, avgLon),
        }));
        const maxDist = Math.max(...distances.map((d) => d.dist));
        if (maxDist > 0.5) {
          const sorted = distances.sort((a, b) => a.dist - b.dist);
          const consensus = sorted.slice(0, Math.max(2, Math.ceil(sorted.length * 0.66)));
          base.latitude = consensus.reduce((s, p) => s + p.lat, 0) / consensus.length;
          base.longitude = consensus.reduce((s, p) => s + p.lon, 0) / consensus.length;
        }
      }

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

      const prev = prevPositions.get(icao);
      if (prev && base.velocity != null && base.velocity > 0) {
        const dt = (now - prev.ts) / 1000;
        const maxMoveKm = (base.velocity / 1000) * dt * 1.5;
        const actualMoveKm = distKmBetween(prev.lat, prev.lon, base.latitude, base.longitude);
        if (actualMoveKm > maxMoveKm && maxMoveKm > 0.01) {
          base.latitude = prev.lat + (base.latitude - prev.lat) * (maxMoveKm / actualMoveKm);
          base.longitude = prev.lon + (base.longitude - prev.lon) * (maxMoveKm / actualMoveKm);
        }
      }

      merged.set(icao, base);
    }

    const final = merged.get(icao)!;
    prevPositions.set(icao, { lat: final.latitude, lon: final.longitude, ts: now });
  }

  for (const [icao, pos] of prevPositions) {
    if (now - pos.ts > 60000) prevPositions.delete(icao);
  }

  return Array.from(merged.values());
}

import { getApiUrl } from "./query-client";

async function fetchOGN(
  lat: number,
  lon: number,
  radiusKm: number
): Promise<{ states: AircraftState[]; status: "ok" | "error" | "timeout" }> {
  try {
    const baseUrl = getApiUrl();
    const url = `${baseUrl}/api/ogn/nearby?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=${radiusKm}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) return { states: [], status: "error" };
      const data = await resp.json();
      if (data.status && !data.status.connected) {
        return { states: [], status: "error" };
      }
      const aircraft: AircraftState[] = (data.aircraft || []).map((ac: any) => {
        const altM = ac.altFt != null ? Math.round(ac.altFt * 0.3048) : null;
        let category: AircraftCategory = "unknown";
        const ognAcType: number = ac.acType ?? 0;
        if (ognAcType === 1) category = "glider";
        else if (ognAcType === 2) category = "airplane";
        else if (ognAcType === 3) category = "helicopter";
        else if (ognAcType === 4 || ognAcType === 5) category = "airplane";
        else if (ognAcType === 6) category = "glider";
        else if (ognAcType === 7) category = "balloon";
        else if (ognAcType === 8) category = "airplane";
        else if (ognAcType === 9) category = "airplane";
        else if (ognAcType === 11) category = "balloon";
        else if (ognAcType === 12) category = "balloon";
        else if (ognAcType === 13) category = "drone";
        else if (ognAcType === 14 || ognAcType === 15) category = "ground";
        else if (ac.type === "flarm") category = "glider";
        else if (ac.type === "ogn") category = "glider";
        else if (ac.type === "fanet") category = "ultralight";
        else if (ac.type === "icao") category = "airplane";

        let icao24: string;
        const rawId = ac.id || "";
        if (ac.type === "icao" && rawId.length > 3) {
          icao24 = rawId.substring(3).toLowerCase();
        } else {
          icao24 = `ogn_${rawId.toLowerCase()}`;
        }

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
          trueTrack: ac.course != null ? ac.course : null,
          verticalRate: ac.vsFpm != null ? ac.vsFpm * 0.00508 : null,
          category,
          sources: ["ogn" as DataSource],
        };
      });
      return { states: aircraft, status: "ok" };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") return { states: [], status: "timeout" };
      return { states: [], status: "error" };
    }
  } catch {
    return { states: [], status: "error" };
  }
}

const sourceFailCounts: Record<DataSource, number> = {
  opensky: 0,
  adsbfi: 0,
  adsbone: 0,
  airplaneslive: 0,
  adsblol: 0,
  ogn: 0,
};
const sourceLastOk: Record<DataSource, "ok" | "error" | "timeout"> = {
  opensky: "ok",
  adsbfi: "ok",
  adsbone: "ok",
  airplaneslive: "ok",
  adsblol: "ok",
  ogn: "ok",
};

function tolerantStatus(
  source: DataSource,
  rawStatus: "ok" | "error" | "timeout"
): "ok" | "error" | "timeout" {
  if (rawStatus === "ok") {
    sourceFailCounts[source] = 0;
    sourceLastOk[source] = "ok";
    return "ok";
  }
  sourceFailCounts[source]++;
  if (sourceFailCounts[source] <= 3) {
    return sourceLastOk[source];
  }
  sourceLastOk[source] = rawStatus;
  return rawStatus;
}

let fetchCycleCount = 0;
let lastOpenskyKey = "";
const AIRCRAFT_BUFFER_MS = 90000;

type SourceResult = { states: AircraftState[]; status: "ok" | "error" | "timeout" };
const sourceCache: Record<DataSource, SourceResult> = {
  opensky: { states: [], status: "ok" },
  adsbfi: { states: [], status: "ok" },
  adsbone: { states: [], status: "ok" },
  airplaneslive: { states: [], status: "ok" },
  adsblol: { states: [], status: "ok" },
  ogn: { states: [], status: "ok" },
};

const aircraftBuffer = new Map<string, { state: AircraftState; lastFresh: number }>();

function bufferAircraft(freshStates: AircraftState[]): AircraftState[] {
  const now = Date.now();
  const freshIcaos = new Set<string>();

  for (const ac of freshStates) {
    freshIcaos.add(ac.icao24);
    aircraftBuffer.set(ac.icao24, { state: { ...ac, lastSeen: now, isStale: false }, lastFresh: now });
  }

  const result: AircraftState[] = [];
  for (const [icao, entry] of aircraftBuffer) {
    const age = now - entry.lastFresh;
    if (age > AIRCRAFT_BUFFER_MS) {
      aircraftBuffer.delete(icao);
      continue;
    }
    if (freshIcaos.has(icao)) {
      result.push(entry.state);
    } else {
      result.push({ ...entry.state, isStale: true, lastSeen: entry.lastFresh });
    }
  }

  return result;
}

export async function fetchNearbyAircraft(
  lat: number,
  lon: number,
  radiusKm: number = 25
): Promise<MultiSourceResponse> {
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}_${radiusKm}`;
  const keyChanged = cacheKey !== lastOpenskyKey;
  if (keyChanged) {
    lastOpenskyKey = cacheKey;
    fetchCycleCount = 0;
    aircraftBuffer.clear();
  }

  fetchCycleCount++;

  const fetchOrCache = async (
    source: DataSource,
    fetchFn: () => Promise<SourceResult>,
    shouldFetch: boolean
  ): Promise<SourceResult> => {
    if (!shouldFetch) return sourceCache[source];
    const result = await fetchFn();
    if (result.status === "ok") {
      sourceCache[source] = result;
    } else {
      result.states = sourceCache[source].states;
    }
    return result;
  };

  const shouldOpenSky = fetchCycleCount % 24 === 1 || keyChanged;
  const shouldAirplanesLive = fetchCycleCount % 2 === 0 || keyChanged;
  const shouldOgn = fetchCycleCount % 3 === 0 || keyChanged;

  const results = await Promise.allSettled([
    fetchOrCache("opensky", () => fetchOpenSky(lat, lon, radiusKm), shouldOpenSky),
    fetchOrCache("adsbfi", () => fetchAdsbSource(ADSBFI_URL, "adsbfi", lat, lon, radiusKm, adsbfiUrlBuilder), true),
    fetchOrCache("adsbone", () => fetchAdsbSource(ADSBONE_URL, "adsbone", lat, lon, radiusKm, adsboneUrlBuilder), true),
    fetchOrCache("airplaneslive", () => fetchAdsbSource(AIRPLANESLIVE_URL, "airplaneslive", lat, lon, radiusKm, airplanesliveUrlBuilder), shouldAirplanesLive),
    fetchOrCache("adsblol", () => fetchAdsbSource(ADSBLOL_URL, "adsblol", lat, lon, radiusKm, adsblolUrlBuilder), true),
    fetchOrCache("ogn", () => fetchOGN(lat, lon, radiusKm), shouldOgn),
  ]);

  const sourceResults = results.map((r) =>
    r.status === "fulfilled" ? r.value : { states: [], status: "error" as const }
  );

  const sourceStatus: Record<DataSource, "ok" | "error" | "timeout"> = {
    opensky: tolerantStatus("opensky", sourceResults[0].status),
    adsbfi: tolerantStatus("adsbfi", sourceResults[1].status),
    adsbone: tolerantStatus("adsbone", sourceResults[2].status),
    airplaneslive: tolerantStatus("airplaneslive", sourceResults[3].status),
    adsblol: tolerantStatus("adsblol", sourceResults[4].status),
    ogn: tolerantStatus("ogn", sourceResults[5].status),
  };

  const merged = mergeAircraft(sourceResults);
  const buffered = bufferAircraft(merged).filter((ac) => !ac.onGround && ac.category !== "ground");

  return {
    time: Date.now() / 1000,
    states: buffered,
    sourceStatus,
  };
}

export function getAltitudeDisplay(aircraft: AircraftState): string {
  if (aircraft.aglAltitude != null) {
    return `${Math.round(aircraft.aglAltitude)} m AGL`;
  }
  const geo = aircraft.geoAltitude;
  const baro = aircraft.baroAltitude;
  const msl = geo ?? baro;
  if (msl != null) return `${Math.round(msl)} m`;
  return "-";
}

export function getAltitudeDualDisplay(aircraft: AircraftState): { agl: string; msl: string } {
  const geo = aircraft.geoAltitude;
  const baro = aircraft.baroAltitude;
  const mslAlt = geo ?? baro;
  const agl = aircraft.aglAltitude != null ? `${Math.round(aircraft.aglAltitude)} m` : "";
  const mslLabel = mslAlt != null ? `${Math.round(mslAlt)} m` : "";
  return { agl, msl: mslLabel };
}

export function formatAltitudeDual(dual: { agl: string; msl: string }): string {
  const parts: string[] = [];
  if (dual.agl) parts.push(`AGL ${dual.agl}`);
  if (dual.msl) parts.push(`MSL ${dual.msl}`);
  return parts.join(" | ") || "-";
}

export function getEffectiveAltitude(aircraft: AircraftState): number | null {
  return aircraft.aglAltitude ?? aircraft.geoAltitude ?? aircraft.baroAltitude ?? null;
}

export function getRelativeAltitude(aircraft: AircraftState, pilotElevationMSL: number | null): number | null {
  const msl = aircraft.geoAltitude ?? aircraft.baroAltitude;
  if (msl == null) return null;
  if (pilotElevationMSL != null) return msl - pilotElevationMSL;
  return msl;
}

export function getSpeedDisplay(aircraft: AircraftState): string {
  if (aircraft.velocity == null) return "-";
  return `${Math.round(aircraft.velocity * 3.6)} km/h`;
}

export function getHeadingDisplay(track: number | null): string {
  if (track == null) return "-";
  const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return dirs[Math.round(track / 45) % 8];
}

export function getVerticalRateDisplay(rate: number | null): string {
  if (rate == null || Math.abs(rate) < 0.5) return "Level";
  if (rate > 0) return `+${rate.toFixed(1)} m/s`;
  return `${rate.toFixed(1)} m/s`;
}

export function getCategoryLabel(category: AircraftCategory): string {
  switch (category) {
    case "airplane": return "Flugzeug";
    case "light": return "Sportflugzeug";
    case "helicopter": return "Hubschrauber";
    case "glider": return "Segelflugzeug";
    case "balloon": return "Ballon";
    case "ultralight": return "Ultraleicht";
    case "drone": return "Drohne";
    case "ground": return "Bodenfahrzeug";
    default: return "Unbekannt";
  }
}

export function getSourceLabels(sources: DataSource[]): string {
  return sources.map((s) => {
    switch (s) {
      case "opensky": return "OpenSky";
      case "adsbfi": return "adsb.fi";
      case "adsbone": return "adsb.one";
      case "airplaneslive": return "airplanes.live";
      case "adsblol": return "adsb.lol";
      case "ogn": return "OGN";
    }
  }).join(", ");
}
