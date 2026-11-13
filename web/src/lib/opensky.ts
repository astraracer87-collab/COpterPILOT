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
  distanceKm?: number;
  bearingDeg?: number;
}

export interface MultiSourceResponse {
  states: AircraftState[];
  sourceStatus: Record<DataSource, SourceStatus>;
  fetchedAt: number;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLon);
  const b = (Math.atan2(y, x) * 180) / Math.PI;
  return (b + 360) % 360;
}

export function compassDir(deg: number): string {
  const dirs = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];
  return dirs[Math.round(deg / 45) % 8];
}

export function categoryLabel(c: AircraftCategory): string {
  switch (c) {
    case "airplane": return "Flugzeug";
    case "light": return "Leichtflugzeug";
    case "helicopter": return "Hubschrauber";
    case "glider": return "Segelflugzeug";
    case "balloon": return "Ballon";
    case "ultralight": return "Ultraleicht";
    case "drone": return "Drohne";
    case "ground": return "Bodenfahrzeug";
    default: return "Unbekannt";
  }
}

export function altitudeDisplay(ac: AircraftState): string {
  const m = ac.geoAltitude ?? ac.baroAltitude;
  if (m == null) return "–";
  return `${Math.round(m)} m`;
}

export function speedDisplay(ac: AircraftState): string {
  if (ac.velocity == null) return "–";
  return `${Math.round(ac.velocity * 3.6)} km/h`;
}

export function headingDisplay(deg: number | null): string {
  if (deg == null) return "–";
  return `${Math.round(deg)}°`;
}

export async function fetchNearbyAircraft(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<MultiSourceResponse> {
  const url = `/api/traffic/nearby?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=${radiusKm}`;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) {
      return {
        states: [],
        sourceStatus: {
          opensky: "error", adsbfi: "error", adsbone: "error",
          airplaneslive: "error", adsblol: "error", ogn: "error",
        },
        fetchedAt: Date.now(),
      };
    }
    const data = (await res.json()) as { fetchedAt?: number; states?: AircraftState[]; sourceStatus: Record<DataSource, SourceStatus> };
    const states = (data.states || []).map((ac) => ({
      ...ac,
      distanceKm: haversineKm(lat, lon, ac.latitude, ac.longitude),
      bearingDeg: bearingDeg(lat, lon, ac.latitude, ac.longitude),
    }));
    states.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    return {
      states,
      sourceStatus: data.sourceStatus,
      fetchedAt: data.fetchedAt ?? Date.now(),
    };
  } catch (e: unknown) {
    const isAbort = typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";
    const status: SourceStatus = isAbort ? "timeout" : "error";
    return {
      states: [],
      sourceStatus: {
        opensky: status, adsbfi: status, adsbone: status,
        airplaneslive: status, adsblol: status, ogn: status,
      },
      fetchedAt: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
