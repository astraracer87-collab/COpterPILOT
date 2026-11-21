import { fetchWithTimeout } from "./fetchWithTimeout";

// BrightSky (DWD) darf nie unbegrenzt hängen – sonst kommt der Open-Meteo-
// Rückfall bzw. die Fehlermeldung im Screen nie zum Zug.
export const BRIGHTSKY_TIMEOUT_MS = 10000;

export interface BrightSkyHourly {
  timestamp: string;
  temperature: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  wind_gust_speed: number | null;
  visibility: number | null;
  cloud_cover: number | null;
  precipitation: number | null;
  relative_humidity: number | null;
}

export interface BrightSkyData {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  windDirectionLabel: string;
  gustSpeed: number;
  visibility: number;
  cloudCover: number;
  precipitation: number;
  flyStatus: "good" | "caution" | "bad";
  flyText: string;
  flySub: string;
  hourly: BrightSkyHourly[];
  dateLabel: string;
}

const DIR_LABELS_16 = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export interface CurrentWind {
  direction: number;
  speed: number;
  gustSpeed: number;
  directionLabel: string;
}

export async function fetchCurrentWind(lat: number, lon: number): Promise<CurrentWind | null> {
  try {
    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const currentHour = now.getHours();
    const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${date}T00:00:00&tz=Europe/Berlin`;
    const res = await fetchWithTimeout(url, {}, BRIGHTSKY_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    const w: BrightSkyHourly[] = data.weather;
    if (!w || w.length === 0) return null;
    const current = w.find((h) => {
      const hDate = new Date(h.timestamp);
      return hDate.getHours() === currentHour;
    }) || w[w.length - 1];
    const speed = (current.wind_speed ?? 0) / 3.6;
    const dir = current.wind_direction ?? 0;
    return {
      direction: dir,
      speed: Math.round(speed * 10) / 10,
      gustSpeed: Math.round(((current.wind_gust_speed ?? 0) / 3.6) * 10) / 10,
      directionLabel: getDirectionLabel(dir),
    };
  } catch {
    return null;
  }
}

function getDirectionLabel(degrees: number): string {
  return DIR_LABELS_16[Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16];
}

export async function fetchBrightSkyWeather(
  lat: number,
  lon: number,
  date?: string
): Promise<BrightSkyData> {
  const today = new Date().toISOString().split("T")[0];
  const targetDate = date || today;
  const url = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${targetDate}T00:00:00&tz=Europe/Berlin`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {}, BRIGHTSKY_TIMEOUT_MS);
  } catch (e) {
    if ((e as any)?.name === "AbortError") {
      throw new Error("BrightSky antwortet nicht (Zeitüberschreitung)");
    }
    throw new Error("BrightSky API nicht erreichbar (offline?)");
  }
  if (!res.ok) {
    throw new Error("BrightSky API nicht erreichbar");
  }

  const data = await res.json();
  const w: BrightSkyHourly[] = data.weather;

  if (!w || w.length === 0) {
    throw new Error("Keine Wetterdaten verfügbar");
  }

  const noon =
    w.find((h) => h.timestamp.includes("T12")) || w[Math.floor(w.length / 2)];

  const temp = noon.temperature ?? 0;
  const wind = noon.wind_speed ?? 0;
  const windDir = noon.wind_direction ?? 0;
  const gusts = noon.wind_gust_speed ?? 0;
  const vis = noon.visibility ? Math.round(noon.visibility / 1000) : 0;
  const cloud = noon.cloud_cover ?? 0;
  const rain = noon.precipitation ?? 0;

  let flyStatus: "good" | "caution" | "bad" = "good";
  let flyText = "Fliegen möglich";
  let flySub = "Bedingungen sind gut";

  if (wind > 12 || rain > 2 || vis < 3) {
    flyStatus = "bad";
    flyText = "Nicht empfohlen";
    flySub = "Windgeschwindigkeit oder Regen zu hoch";
  } else if (wind > 8 || cloud > 75 || vis < 8) {
    flyStatus = "caution";
    flyText = "Mit Vorsicht";
    flySub = "Eingeschraenkte Sicht oder Wind beachten";
  }

  const dateObj = new Date(targetDate);
  const dateLabel = dateObj.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return {
    temperature: temp,
    windSpeed: wind,
    windDirection: windDir,
    windDirectionLabel: getDirectionLabel(windDir),
    gustSpeed: gusts,
    visibility: vis,
    cloudCover: cloud,
    precipitation: rain,
    flyStatus,
    flyText,
    flySub,
    hourly: w,
    dateLabel,
  };
}
