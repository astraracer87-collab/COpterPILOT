import { getApiUrl } from "./query-client";

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

export type DataSource = "opensky" | "adsbfi" | "adsbone" | "airplaneslive" | "adsblol" | "ogn" | "fr24";
export type SourceStatus = "ok" | "error" | "timeout";

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
  ageSec?: number;
  distanceKm?: number;
  bearingDeg?: number;
  aglAltitude?: number | null;
  groundElevation?: number | null;
  registration?: string;
  aircraftType?: string;
  aircraftDesc?: string;
  operator?: string;
  cn?: string;
  military?: boolean;
  interesting?: boolean;
  pia?: boolean;
  ladd?: boolean;
  originIata?: string;
  destIata?: string;
  flightNumber?: string;
}

export interface ServerTrailPoint { lat: number; lon: number; t: number; }
export interface ServerAircraftTrail { id: string; points: ServerTrailPoint[]; }

export interface MultiSourceResponse {
  time: number;
  latestSnapshotAt?: number;
  latestSnapshotAgeSec?: number;
  states: AircraftState[];
  sourceStatus: Record<DataSource, SourceStatus>;
  trails: ServerAircraftTrail[];
}

const EMPTY_STATUS: Record<DataSource, SourceStatus> = {
  opensky: "error", adsbfi: "error", adsbone: "error",
  airplaneslive: "error", adsblol: "error", ogn: "error", fr24: "error",
};

export interface ViewportBbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export async function fetchNearbyAircraft(
  lat: number,
  lon: number,
  radiusKm: number = 25,
  maxAgeSec: number = 60,
  bbox?: ViewportBbox,
): Promise<MultiSourceResponse> {
  const baseUrl = getApiUrl();
  let url = `${baseUrl}/api/traffic/v2/nearby?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=${radiusKm}&maxAgeSec=${maxAgeSec}`;
  if (bbox && isFinite(bbox.latMin) && isFinite(bbox.latMax) && isFinite(bbox.lonMin) && isFinite(bbox.lonMax)) {
    url += `&bbox=${bbox.lonMin.toFixed(4)},${bbox.latMin.toFixed(4)},${bbox.lonMax.toFixed(4)},${bbox.latMax.toFixed(4)}`;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) {
      return { time: Date.now() / 1000, states: [], sourceStatus: { ...EMPTY_STATUS }, trails: [] };
    }
    const data = (await res.json()) as {
      fetchedAt?: number;
      latestSnapshotAt?: number;
      latestSnapshotAgeSec?: number;
      aircraft?: AircraftState[];
      trails?: ServerAircraftTrail[];
      sourceStatus?: Record<DataSource, SourceStatus>;
    };
    return {
      time: (data.fetchedAt ?? Date.now()) / 1000,
      latestSnapshotAt: data.latestSnapshotAt,
      latestSnapshotAgeSec: data.latestSnapshotAgeSec,
      states: (data.aircraft || []).filter((ac) => !ac.onGround && ac.category !== "ground"),
      sourceStatus: data.sourceStatus ?? { ...EMPTY_STATUS },
      trails: data.trails ?? [],
    };
  } catch (e: unknown) {
    const isAbort = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
    const status: SourceStatus = isAbort ? "timeout" : "error";
    const sourceStatus: Record<DataSource, SourceStatus> = {
      opensky: status, adsbfi: status, adsbone: status,
      airplaneslive: status, adsblol: status, ogn: status, fr24: status,
    };
    return { time: Date.now() / 1000, states: [], sourceStatus, trails: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * MSL-Höhe in Metern. Priorität: baro_altitude vor geo_altitude.
 *
 * baro_altitude (Druckhöhe, ICAO-Standard 1013,25 hPa) ist die in der Luftfahrt
 * übliche Referenz und wird auch von FlightAware/Flightradar24 angezeigt.
 * geo_altitude ist die GNSS/WGS84-Ellipsoid-Höhe und liegt in Mitteleuropa
 * ~45 m über MSL (Geoid-Undulation) → führt sonst zu zu hohen Werten.
 */
function preferredMslMeters(aircraft: AircraftState): number | null {
  return aircraft.baroAltitude ?? aircraft.geoAltitude ?? null;
}

export function getAltitudeDisplay(aircraft: AircraftState): string {
  if (aircraft.aglAltitude != null) {
    return `${Math.round(aircraft.aglAltitude)} m AGL`;
  }
  const msl = preferredMslMeters(aircraft);
  if (msl != null) return `${Math.round(msl)} m`;
  return "-";
}

export function getAltitudeDualDisplay(aircraft: AircraftState): { agl: string; msl: string } {
  const mslAlt = preferredMslMeters(aircraft);
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
  return aircraft.aglAltitude ?? preferredMslMeters(aircraft);
}

export function getRelativeAltitude(aircraft: AircraftState, pilotElevationMSL: number | null): number | null {
  const msl = preferredMslMeters(aircraft);
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
