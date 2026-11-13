export type WeatherLimits = {
  maxWind: number;
  maxGusts: number;
  maxRain: number;
  minTemp: number;
  minCloudCeiling: number;
  minVisibility: number;
};

export const DEFAULT_LIMITS: WeatherLimits = {
  maxWind: 10,
  maxGusts: 12,
  maxRain: 0.1,
  minTemp: 0,
  minCloudCeiling: 100,
  minVisibility: 5000,
};

export type AssessmentLevel = "go" | "caution" | "nogo";

export function classifyValue(
  value: number | undefined,
  limit: number,
  mode: "max" | "min",
  cautionMargin = 0.15
): AssessmentLevel {
  if (value == null || isNaN(value)) return "caution";
  if (mode === "max") {
    if (value > limit) return "nogo";
    if (value > limit * (1 - cautionMargin)) return "caution";
    return "go";
  }
  if (value < limit) return "nogo";
  if (value < limit * (1 + cautionMargin)) return "caution";
  return "go";
}

export type BrightSkyHour = {
  timestamp: string;
  temperature: number | null;
  dew_point: number | null;
  wind_speed: number | null;
  wind_gust_speed: number | null;
  precipitation: number | null;
  cloud_cover: number | null;
  visibility: number | null;
  condition: string | null;
  icon: string | null;
};

/** Estimate cloud base in metres from temperature and dew point (Espy formula). */
export function estimateCloudCeiling(temp: number | null | undefined, dewPoint: number | null | undefined): number | null {
  if (temp == null || dewPoint == null || isNaN(temp) || isNaN(dewPoint)) return null;
  const ceiling = (temp - dewPoint) * 125;
  return ceiling > 0 ? ceiling : 0;
}

export type BrightSkyResponse = { weather: BrightSkyHour[] };

export async function fetchBrightSky(lat: number, lon: number, date?: string): Promise<BrightSkyResponse> {
  const d = date || new Date().toISOString().slice(0, 10);
  const r = await fetch(`/api/proxy/brightsky?lat=${lat}&lon=${lon}&date=${d}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("Wetterdaten konnten nicht geladen werden");
  return r.json();
}

export type DipulWindAtHeight = {
  height: { value: number; reference?: string; unit?: string };
  value?: number;
  windSpeedGust?: number;
  uComponent?: number;
  vComponent?: number;
};
export type DipulForecast = {
  timestamp: string;
  wind?: DipulWindAtHeight[];
};
export type DipulPosition = {
  forecasts: DipulForecast[];
};

export type DipulResponse = { positions: DipulPosition[] };

export async function fetchDipulWeather(lat: number, lon: number): Promise<DipulResponse> {
  const r = await fetch(`/api/proxy/dipul-weather?lat=${lat}&lon=${lon}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("Dipul-Höhenwind konnte nicht geladen werden");
  return r.json();
}

export type KpResponse = (string | number)[][];

export async function fetchKpIndex(): Promise<{ current: number | null; rows: KpResponse }> {
  const r = await fetch("/api/proxy/kpindex", { credentials: "include" });
  if (!r.ok) throw new Error("KP-Index nicht verfügbar");
  const rows = (await r.json()) as KpResponse;
  let current: number | null = null;
  if (Array.isArray(rows) && rows.length > 1) {
    const last = rows[rows.length - 1];
    const v = parseFloat(String(last[1]));
    if (!isNaN(v)) current = v;
  }
  return { current, rows };
}

export type NotamRow = {
  ItemA?: string;
  ItemE?: string;
  ItemQ?: string;
  StartValidity?: number;
  EndValidity?: number;
  series?: string;
  number?: string;
  year?: string;
  lat?: number;
  lon?: number;
  radius?: number;
  upper?: number;
  lower?: number;
  /** Optional polygon geometry as [lat, lon] pairs (autorouter sometimes returns this). */
  points?: [number, number][];
};
export type NotamResponse = { rows: NotamRow[]; total: number; queriedCodes?: string[] };

export async function fetchNotams(lat: number, lon: number): Promise<NotamResponse> {
  // Bevorzugt: serverseitig zwischengespeicherte NOTAMs (täglich aktualisiert).
  try {
    const c = await fetch(`/api/cached/notams?lat=${lat}&lon=${lon}&radius=120`, {
      credentials: "include",
    });
    if (c.ok) {
      const j = (await c.json()) as { rows?: NotamRow[]; updatedAt?: string };
      if (Array.isArray(j.rows)) {
        return { rows: j.rows, total: j.rows.length };
      }
    }
  } catch {
    // fallthrough zur Live-Quelle
  }
  const r = await fetch(`/api/proxy/notams?lat=${lat}&lon=${lon}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("NOTAMs konnten nicht geladen werden");
  return r.json();
}

export type GeocodeResult = {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
};

export async function geocodeSearch(q: string): Promise<GeocodeResult[]> {
  const r = await fetch(`/api/proxy/geocode/search?q=${encodeURIComponent(q)}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("Suche fehlgeschlagen");
  return r.json();
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ display_name?: string }> {
  const r = await fetch(`/api/proxy/geocode/reverse?lat=${lat}&lon=${lon}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("Reverse Geocoding fehlgeschlagen");
  return r.json();
}
