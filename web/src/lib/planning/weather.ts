import type { WeatherSnapshot } from "./types";

export type ForecastHour = {
  time: string;
  temperature: number;
  windSpeed: number;
  windGust: number;
  rain: number;
  cloudCover: number;
  humidity: number;
};

export type ForecastResult = {
  current: WeatherSnapshot;
  hours: ForecastHour[];
  cloudCeilingMeters?: number;
  visibilityMeters?: number;
};

// Open-Meteo is free, requires no API key, and is CORS-enabled — well suited for
// the browser. Wind values arrive in km/h; we convert to m/s to match the rest
// of the COpter Pilot codebase.
export async function fetchForecast(
  latitude: number,
  longitude: number,
  targetIso: string,
): Promise<ForecastResult> {
  const target = new Date(targetIso);
  const startDate = target.toISOString().slice(0, 10);
  const endDate = new Date(target.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly:
      "temperature_2m,relative_humidity_2m,precipitation,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m",
    wind_speed_unit: "ms",
    timezone: "auto",
    start_date: startDate,
    end_date: endDate,
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    throw new Error(`Wetterabruf fehlgeschlagen (${res.status})`);
  }
  const data = await res.json();
  const h = data.hourly;
  if (!h?.time?.length) throw new Error("Keine Wetterdaten verfügbar");

  // Pick the hour closest to the requested time
  const targetMs = target.getTime();
  let bestIdx = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < h.time.length; i++) {
    const t = new Date(h.time[i]).getTime();
    const delta = Math.abs(t - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }

  const hours: ForecastHour[] = h.time.map((t: string, i: number) => ({
    time: t,
    temperature: h.temperature_2m[i] ?? 0,
    windSpeed: h.wind_speed_10m[i] ?? 0,
    windGust: h.wind_gusts_10m[i] ?? 0,
    rain: h.precipitation[i] ?? 0,
    cloudCover: h.cloud_cover[i] ?? 0,
    humidity: h.relative_humidity_2m[i] ?? 0,
  }));

  const current: WeatherSnapshot = {
    temperature: hours[bestIdx].temperature,
    windSpeed: hours[bestIdx].windSpeed,
    windGust: hours[bestIdx].windGust,
    rain: hours[bestIdx].rain,
    cloudCover: hours[bestIdx].cloudCover,
    humidity: hours[bestIdx].humidity,
  };

  return {
    current,
    hours: hours.slice(Math.max(0, bestIdx - 1), bestIdx + 12),
    visibilityMeters: h.visibility?.[bestIdx],
  };
}

export function describeWind(ms: number): string {
  if (ms < 1.6) return "Stille / leichte Brise";
  if (ms < 3.4) return "Leichter Wind";
  if (ms < 5.5) return "Mäßiger Wind";
  if (ms < 8) return "Frischer Wind";
  if (ms < 10.8) return "Starker Wind";
  return "Sturm";
}
