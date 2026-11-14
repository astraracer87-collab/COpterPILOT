import { isWithinDwdCoverage } from "../../shared/countryDetection";

// Mögliche Wetterquellen. "openmeteo" deckt das Ausland ab (Open-Meteo wählt
// dort automatisch lokale Modelle wie AROME in Frankreich); "dipul" (DFS,
// ICON-D2) und "brightsky" (DWD) sind die DWD-Quellen für Deutschland + Umland.
export type WeatherSource = "dipul" | "brightsky" | "openmeteo";

// ISA standard atmosphere lapse rate: -6.5°C per 1000m.
// The dipul API only provides temperature at 2m AGL; we fill missing
// altitude entries so the forecast table shows plausible values.
const ISA_LAPSE_RATE = 0.0065; // °C per metre
const ALL_TEMP_HEIGHTS = [2, 50, 100, 150, 200, 250];

function fillTempLapseRate(arr: ValueAtAltitude[]): ValueAtAltitude[] {
  const base = arr.find((t) => t.height === 2) ?? arr[0];
  if (!base) return arr;
  const result = [...arr];
  for (const h of ALL_TEMP_HEIGHTS) {
    if (!result.find((t) => t.height === h)) {
      result.push({ height: h, value: base.value - ISA_LAPSE_RATE * (h - base.height), estimated: true });
    }
  }
  return result.sort((a, b) => a.height - b.height);
}

export interface WindAtAltitude {
  height: number;
  speed: number;
  gust?: number;
  direction: number;
}

export interface ValueAtAltitude {
  height: number;
  value: number;
  estimated?: boolean;
}

export interface ForecastData {
  timestamp: string;
  temperature: number;
  windSpeed: number;
  windGust?: number;
  windDirection: number;
  windAtAltitude: WindAtAltitude[];
  temperatureAtAltitude: ValueAtAltitude[];
  humidityAtAltitude: ValueAtAltitude[];
  cloudCoverAtAltitude: ValueAtAltitude[];
  rain: number;
  snow: number;
  cloudCover: number;
  cloudCeiling?: number;
  visibility?: number;
  humidity: number;
  pressure: number;
}

export interface WeatherData {
  latitude: number;
  longitude: number;
  calculationTime: string;
  forecasts: ForecastData[];
}

// DFS-dipul-Wetter (ICON-D2) wird direkt abgefragt – der frühere Server-Proxy
// entfällt. Schlägt der Abruf fehl (z. B. offline oder SSL-Probleme auf dem
// Gerät), greifen die vorhandenen Fallbacks (Open-Meteo / Bright Sky).
const DFS_WEATHER_URL = "https://utm-service.dfs.de/api/weather/v1/weather";

function getWeatherProxyUrl(): string {
  return DFS_WEATHER_URL;
}

function getNext24HourTimestamps(): string[] {
  const now = new Date();
  const timestamps: string[] = [now.toISOString()];

  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  for (let i = 0; i < 23; i++) {
    const time = new Date(nextHour.getTime() + i * 60 * 60 * 1000);
    timestamps.push(time.toISOString());
  }

  return timestamps;
}

function getTimestampsForWindow(durationMinutes: number): string[] {
  const now = new Date();
  const hours = Math.ceil(durationMinutes / 60);
  const count = Math.min(Math.max(hours + 1, 2), 48);
  const timestamps: string[] = [now.toISOString()];

  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);

  for (let i = 0; i < count - 1; i++) {
    const time = new Date(nextHour.getTime() + i * 60 * 60 * 1000);
    timestamps.push(time.toISOString());
  }

  return timestamps;
}

function calculateWindSpeed(u: number, v: number): number {
  return Math.sqrt(u * u + v * v);
}

function calculateWindDirection(u: number, v: number): number {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

export class WeatherFetchError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "WeatherFetchError";
  }
}

async function fetchOpenMeteoForecast(
  latitude: number,
  longitude: number,
  hours: number,
): Promise<WeatherData> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation",
      "snowfall",
      "cloud_cover",
      "visibility",
      "wind_speed_10m",
      "wind_speed_80m",
      "wind_speed_120m",
      "wind_speed_180m",
      "wind_direction_10m",
      "wind_direction_80m",
      "wind_direction_120m",
      "wind_direction_180m",
      "wind_gusts_10m",
      "surface_pressure",
    ].join(","),
    wind_speed_unit: "ms",
    forecast_hours: String(Math.max(1, Math.min(168, hours))),
    timezone: "UTC",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!res.ok) throw new WeatherFetchError("Open-Meteo nicht erreichbar");
  const data = await res.json();
  const h = data?.hourly;
  if (!h?.time?.length) throw new WeatherFetchError("Open-Meteo lieferte keine Stunden");
  const len: number = h.time.length;
  const get = (k: string, i: number): number => {
    const v = h[k]?.[i];
    return typeof v === "number" ? v : 0;
  };
  const WIND_HEIGHTS = [10, 50, 100, 150, 200, 250];
  const heightToOM: Record<number, { sp: string; dir: string }> = {
    10: { sp: "wind_speed_10m", dir: "wind_direction_10m" },
    50: { sp: "wind_speed_80m", dir: "wind_direction_80m" },
    100: { sp: "wind_speed_120m", dir: "wind_direction_120m" },
    150: { sp: "wind_speed_120m", dir: "wind_direction_120m" },
    200: { sp: "wind_speed_180m", dir: "wind_direction_180m" },
    250: { sp: "wind_speed_180m", dir: "wind_direction_180m" },
  };
  const forecasts: ForecastData[] = [];
  for (let i = 0; i < len; i++) {
    const ts = new Date(`${h.time[i]}Z`).toISOString();
    const temp = get("temperature_2m", i);
    const humidity = get("relative_humidity_2m", i);
    const wind10 = get("wind_speed_10m", i);
    const dir10 = get("wind_direction_10m", i);
    const gust10 = get("wind_gusts_10m", i);
    const windAtAltitude: WindAtAltitude[] = WIND_HEIGHTS.map((hgt) => {
      const m = heightToOM[hgt];
      return {
        height: hgt,
        speed: get(m.sp, i),
        direction: get(m.dir, i),
        gust: hgt === 10 ? gust10 : undefined,
      };
    });
    const temperatureAtAltitude: ValueAtAltitude[] = fillTempLapseRate([{ height: 2, value: temp }]);
    const humidityAtAltitude: ValueAtAltitude[] = [{ height: 2, value: humidity }];
    forecasts.push({
      timestamp: ts,
      temperature: temp,
      windSpeed: wind10,
      windGust: gust10 || undefined,
      windDirection: dir10,
      windAtAltitude,
      temperatureAtAltitude,
      humidityAtAltitude,
      cloudCoverAtAltitude: [],
      rain: get("precipitation", i),
      snow: get("snowfall", i),
      cloudCover: get("cloud_cover", i),
      visibility: h.visibility?.[i] != null ? h.visibility[i] : undefined,
      humidity,
      pressure: get("surface_pressure", i),
    });
  }
  return {
    latitude,
    longitude,
    calculationTime: new Date().toISOString(),
    forecasts,
  };
}

export async function fetchWeather(latitude: number, longitude: number, durationMinutes?: number): Promise<WeatherData> {
  const forecasts = durationMinutes != null && durationMinutes > 0
    ? getTimestampsForWindow(durationMinutes)
    : getNext24HourTimestamps();

  // Im Ausland (außerhalb der zuverlässigen DWD/ICON-D2-Abdeckung) zuerst
  // Open-Meteo abfragen; es wählt dort automatisch lokale Modelle (z. B. AROME
  // an der französischen Atlantikküste). DWD bleibt nur Notfall-Fallback.
  if (!isWithinDwdCoverage(latitude, longitude)) {
    try {
      const openMeteo = await fetchOpenMeteoForecast(latitude, longitude, forecasts.length);
      if (openMeteo.forecasts.length > 0) return openMeteo;
    } catch (e) {
      console.warn("[fetchWeather] Open-Meteo (Ausland) fehlgeschlagen, Fallback auf DWD:", e);
    }
  }

  const TEMP_HEIGHTS = [2, 50, 100, 150, 200, 250];
  const HUMIDITY_HEIGHTS = [2, 50, 100, 150, 200, 250];
  const CLOUD_HEIGHTS = [50, 100, 150, 200, 250];

  const requestBody = {
    positions: [
      {
        latitude,
        longitude,
        forecasts,
        qnh: { unit: "Pa" },
        temperature: {
          unit: "C",
          heights: TEMP_HEIGHTS.map((v) => ({ reference: "AGL", unit: "m", value: v })),
        },
        wind: {
          unit: "m/s",
          heights: [
            { reference: "AGL", unit: "m", value: 10 },
            { reference: "AGL", unit: "m", value: 50 },
            { reference: "AGL", unit: "m", value: 100 },
            { reference: "AGL", unit: "m", value: 150 },
            { reference: "AGL", unit: "m", value: 200 },
            { reference: "AGL", unit: "m", value: 250 },
          ],
        },
        rainPrecipitation: { unit: "mm" },
        snowPrecipitation: { unit: "mm" },
        totalCloudCover: { unit: "%" },
        cloudCover: {
          unit: "%",
          heights: CLOUD_HEIGHTS.map((v) => ({ reference: "AGL", unit: "m", value: v })),
        },
        airHumidity: {
          unit: "%",
          heights: HUMIDITY_HEIGHTS.map((v) => ({ reference: "AGL", unit: "m", value: v })),
        },
      },
    ],
  };

  let response: Response | null = null;
  let proxyUrl = "";
  try {
    proxyUrl = getWeatherProxyUrl();
  } catch (e) {
    console.warn("[fetchWeather] getWeatherProxyUrl threw:", e);
    return fetchOpenMeteoForecast(latitude, longitude, forecasts.length);
  }
  try {
    response = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    console.warn("[fetchWeather] proxy fetch failed →", proxyUrl, e);
    return fetchOpenMeteoForecast(latitude, longitude, forecasts.length);
  }

  if (!response.ok) {
    console.warn("[fetchWeather] proxy returned", response.status, "→ OpenMeteo");
    return fetchOpenMeteoForecast(latitude, longitude, forecasts.length);
  }

  const data = await response.json();

  if (!data.positions || data.positions.length === 0) {
    console.warn("[fetchWeather] proxy returned empty positions → OpenMeteo");
    return fetchOpenMeteoForecast(latitude, longitude, forecasts.length);
  }

  const position = data.positions[0];

  if (position.status?.message) {
    console.warn("Weather API warning:", position.status.message);
  }

  const WIND_HEIGHTS = [10, 50, 100, 150, 200, 250];

  const forecastData: ForecastData[] = (position.forecasts || []).map((f: any) => {
    const windArray = f.wind || [];
    const wind0 = windArray[0];
    const windU = wind0?.uComponent ?? 0;
    const windV = wind0?.vComponent ?? 0;
    const windGust = wind0?.windSpeedGust;

    const windAtAltitude: WindAtAltitude[] = WIND_HEIGHTS.map((h) => {
      const w = windArray.find((entry: any) => (entry.height?.value ?? 0) === h) ?? windArray[WIND_HEIGHTS.indexOf(h)];
      if (!w) return { height: h, speed: 0, direction: 0 };
      const u = w.uComponent ?? 0;
      const v = w.vComponent ?? 0;
      return {
        height: h,
        speed: calculateWindSpeed(u, v),
        gust: w.windSpeedGust,
        direction: calculateWindDirection(u, v),
      };
    });

    const temperatureAtAltitude: ValueAtAltitude[] = fillTempLapseRate(
      (f.temperature || []).map((t: any) => ({ height: t.height?.value ?? 0, value: t.value ?? 0 }))
    );

    const humidityAtAltitude: ValueAtAltitude[] = (f.airHumidity || []).map((h: any) => ({
      height: h.height?.value ?? 0,
      value: h.value ?? 0,
    }));

    const cloudCoverAtAltitude: ValueAtAltitude[] = (f.cloudCover || []).map((c: any) => ({
      height: c.height?.value ?? 0,
      value: c.value ?? 0,
    }));

    return {
      timestamp: f.timestamp,
      temperature: f.temperature?.[0]?.value ?? 0,
      windSpeed: calculateWindSpeed(windU, windV),
      windGust: windGust,
      windDirection: calculateWindDirection(windU, windV),
      windAtAltitude,
      temperatureAtAltitude,
      humidityAtAltitude,
      cloudCoverAtAltitude,
      rain: f.rainPrecipitation?.value ?? 0,
      snow: f.snowPrecipitation?.value ?? 0,
      cloudCover: f.totalCloudCover?.value ?? 0,
      humidity: f.airHumidity?.[0]?.value ?? 0,
      pressure: f.qnh?.value ?? 0,
    };
  });

  if (forecastData.length === 0) {
    return fetchOpenMeteoForecast(latitude, longitude, forecasts.length);
  }

  return {
    latitude,
    longitude,
    calculationTime: data.calculationTime,
    forecasts: forecastData,
  };
}

import type { WeatherSnapshot } from "@/lib/storage";
import { fetchBrightSkyWeather } from "@/lib/brightsky";

export interface ForecastResult {
  weather: WeatherSnapshot | null;
  source: WeatherSource | null;
  tooFarAhead?: boolean;
}

async function fetchDipulForecast(
  latitude: number,
  longitude: number,
  targetTime: string
): Promise<WeatherSnapshot> {
  const targetDate = new Date(targetTime);
  const timestamps = [targetDate.toISOString()];

  const DIPUL_WIND_HEIGHTS = [10, 50, 100, 150, 200, 250];
  const DIPUL_TEMP_HEIGHTS = [2, 50, 100, 150, 200, 250];

  const requestBody = {
    positions: [
      {
        latitude,
        longitude,
        forecasts: timestamps,
        qnh: { unit: "Pa" },
        temperature: {
          unit: "C",
          heights: DIPUL_TEMP_HEIGHTS.map((v) => ({ reference: "AGL", unit: "m", value: v })),
        },
        wind: {
          unit: "m/s",
          heights: DIPUL_WIND_HEIGHTS.map((v) => ({ reference: "AGL", unit: "m", value: v })),
        },
        rainPrecipitation: { unit: "mm" },
        snowPrecipitation: { unit: "mm" },
        totalCloudCover: { unit: "%" },
        airHumidity: {
          unit: "%",
          heights: [{ reference: "AGL", unit: "m", value: 2 }],
        },
      },
    ],
  };

  const response = await fetch(getWeatherProxyUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new WeatherFetchError(
      `Wetter-API Fehler: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const data = await response.json();

  if (!data.positions || data.positions.length === 0) {
    throw new WeatherFetchError("Keine Wetterdaten für diesen Standort verfügbar.");
  }

  const position = data.positions[0];
  const forecast = position.forecasts?.[0];

  if (!forecast) {
    throw new WeatherFetchError("Keine Vorhersagedaten für den gewählten Zeitpunkt.");
  }

  const windArray = forecast.wind || [];
  const wind10 = windArray.find((entry: any) => (entry.height?.value ?? 0) === 10) ?? windArray[0];
  const windU = wind10?.uComponent ?? 0;
  const windV = wind10?.vComponent ?? 0;

  const windAtAltitude = DIPUL_WIND_HEIGHTS.map((h) => {
    const w = windArray.find((entry: any) => (entry.height?.value ?? 0) === h) ?? windArray[DIPUL_WIND_HEIGHTS.indexOf(h)];
    if (!w) return { height: h, speed: 0, direction: 0 };
    const u = w.uComponent ?? 0;
    const v = w.vComponent ?? 0;
    return {
      height: h,
      speed: calculateWindSpeed(u, v),
      gust: w.windSpeedGust,
      direction: calculateWindDirection(u, v),
    };
  });

  const temperatureAtAltitude = fillTempLapseRate(
    (forecast.temperature || []).map((t: any) => ({ height: t.height?.value ?? 0, value: t.value ?? 0 }))
  );

  return {
    temperature: forecast.temperature?.[0]?.value ?? 0,
    windSpeed: calculateWindSpeed(windU, windV),
    windGust: wind10?.windSpeedGust,
    rain: forecast.rainPrecipitation?.value ?? 0,
    cloudCover: forecast.totalCloudCover?.value ?? 0,
    humidity: forecast.airHumidity?.[0]?.value ?? 0,
    windAtAltitude,
    temperatureAtAltitude,
  };
}

async function fetchBrightSkyForecastSnapshot(
  latitude: number,
  longitude: number,
  targetTime: string
): Promise<WeatherSnapshot> {
  const targetDate = targetTime.split("T")[0];
  const targetHour = parseInt(targetTime.split("T")[1]?.split(":")[0] || "12", 10);

  const bsData = await fetchBrightSkyWeather(latitude, longitude, targetDate);

  const closest = bsData.hourly.reduce((best, h) => {
    const hHour = new Date(h.timestamp).getHours();
    const bestHour = new Date(best.timestamp).getHours();
    return Math.abs(hHour - targetHour) < Math.abs(bestHour - targetHour) ? h : best;
  }, bsData.hourly[0]);

  return {
    temperature: closest.temperature ?? 0,
    windSpeed: closest.wind_speed ? closest.wind_speed / 3.6 : 0,
    windGust: closest.wind_gust_speed ? closest.wind_gust_speed / 3.6 : undefined,
    rain: closest.precipitation ?? 0,
    cloudCover: closest.cloud_cover ?? 0,
    humidity: closest.relative_humidity ?? 0,
  };
}

// Einzel-Snapshot aus Open-Meteo für den Zielzeitpunkt (Ausland-Wetterquelle).
// Höhenprofile sind über fetchOpenMeteoForecast bereits per ISA-Lapse-Rate gefüllt.
async function fetchOpenMeteoSnapshot(
  latitude: number,
  longitude: number,
  targetTime: string
): Promise<WeatherSnapshot> {
  const target = new Date(targetTime).getTime();
  const hoursAhead = Math.ceil((target - Date.now()) / 3600000) + 2;
  const data = await fetchOpenMeteoForecast(latitude, longitude, Math.max(1, hoursAhead));
  if (!data.forecasts.length) {
    throw new WeatherFetchError("Open-Meteo lieferte keine Vorhersagedaten.");
  }
  const closest = data.forecasts.reduce((best, f) =>
    Math.abs(new Date(f.timestamp).getTime() - target) <
    Math.abs(new Date(best.timestamp).getTime() - target)
      ? f
      : best
  );
  return {
    temperature: closest.temperature,
    windSpeed: closest.windSpeed,
    windGust: closest.windGust,
    rain: closest.rain ?? 0,
    cloudCover: closest.cloudCover ?? 0,
    humidity: closest.humidity ?? 0,
    windAtAltitude: closest.windAtAltitude,
    temperatureAtAltitude: closest.temperatureAtAltitude,
  };
}

export async function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  targetTime: string
): Promise<WeatherSnapshot> {
  const result = await fetchWeatherForecastWithSource(latitude, longitude, targetTime);
  if (!result.weather) {
    throw new Error("No weather data available");
  }
  return result.weather;
}

export interface HourlyForecastSlot {
  hour: string;
  timestamp: string;
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
  visibility?: number;
  snow?: number;
  windAtAltitude?: WindAtAltitude[];
  temperatureAtAltitude?: ValueAtAltitude[];
  humidityAtAltitude?: ValueAtAltitude[];
  pressure?: number;
}

// Open-Meteo-Stundenwerte für ein Zeitfenster, geclippt auf [startMs, endMs].
// Füllt Höhenprofile (windAtAltitude/temperatureAtAltitude) wie fetchOpenMeteoForecast.
async function buildOpenMeteoHourlySlots(
  latitude: number,
  longitude: number,
  startMs: number,
  endMs: number,
): Promise<HourlyForecastSlot[]> {
  const omHours = Math.max(1, Math.ceil((endMs - Date.now()) / 3600000) + 2);
  const omData = await fetchOpenMeteoForecast(latitude, longitude, omHours);
  const omSlots: HourlyForecastSlot[] = [];
  const omSeen = new Set<string>();
  for (const fc of omData.forecasts) {
    const tms = new Date(fc.timestamp).getTime();
    if (tms < startMs || tms > endMs) continue;
    if (omSeen.has(fc.timestamp)) continue;
    omSeen.add(fc.timestamp);
    const ts = new Date(fc.timestamp);
    omSlots.push({
      hour: `${ts.getHours().toString().padStart(2, "0")}:00`,
      timestamp: fc.timestamp,
      temperature: fc.temperature,
      windSpeed: fc.windSpeed,
      windGust: fc.windGust,
      rain: fc.rain ?? 0,
      cloudCover: fc.cloudCover ?? 0,
      humidity: fc.humidity ?? 0,
      snow: fc.snow,
      windAtAltitude: fc.windAtAltitude,
      temperatureAtAltitude: fc.temperatureAtAltitude,
      humidityAtAltitude: fc.humidityAtAltitude,
      visibility: fc.visibility,
      pressure: fc.pressure ? Math.round(fc.pressure) : undefined,
    });
  }
  return omSlots;
}

export async function fetchHourlyForecasts(
  latitude: number,
  longitude: number,
  startTime: string,
  endTime: string
): Promise<{ slots: HourlyForecastSlot[]; source: WeatherSource }> {
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);
  if (endDate <= startDate) return { slots: [], source: "dipul" };

  const durationMs = endDate.getTime() - startDate.getTime();
  const durationMin = Math.ceil(durationMs / 60000);
  const hours = Math.ceil(durationMin / 60);
  const timestamps: string[] = [];
  for (let i = 0; i <= hours; i++) {
    const t = new Date(startDate.getTime() + i * 3600000);
    if (t <= endDate) timestamps.push(t.toISOString());
  }
  if (timestamps.length === 0) timestamps.push(startDate.toISOString());

  const now = new Date();
  const hoursAhead = (startDate.getTime() - now.getTime()) / 3600000;
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const abroad = !isWithinDwdCoverage(latitude, longitude);

  // Im Ausland zuerst Open-Meteo (lokale Modelle wie AROME); DWD nur Notfall.
  if (abroad) {
    try {
      const omSlots = await buildOpenMeteoHourlySlots(latitude, longitude, startMs, endMs);
      if (omSlots.length > 0) return { slots: omSlots, source: "openmeteo" };
    } catch {
    }
  }

  if (hoursAhead <= 24) {
    try {
      const HOURLY_WIND_HEIGHTS = [10, 50, 100, 150, 200, 250];
      const HOURLY_TEMP_HEIGHTS = [2, 50, 100, 150, 200, 250];
      const HOURLY_HUMIDITY_HEIGHTS = [2, 50, 100, 150, 200, 250];
      const requestBody = {
        positions: [{
          latitude,
          longitude,
          forecasts: timestamps,
          qnh: { unit: "Pa" },
          temperature: { unit: "C", heights: HOURLY_TEMP_HEIGHTS.map(v => ({ reference: "AGL", unit: "m", value: v })) },
          wind: { unit: "m/s", heights: HOURLY_WIND_HEIGHTS.map(v => ({ reference: "AGL", unit: "m", value: v })) },
          rainPrecipitation: { unit: "mm" },
          snowPrecipitation: { unit: "mm" },
          totalCloudCover: { unit: "%" },
          airHumidity: { unit: "%", heights: HOURLY_HUMIDITY_HEIGHTS.map(v => ({ reference: "AGL", unit: "m", value: v })) },
        }],
      };
      const response = await fetch(getWeatherProxyUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) throw new Error("dipul failed");
      const data = await response.json();
      const position = data.positions?.[0];
      if (!position?.forecasts?.length) throw new Error("no data");

      const slots: HourlyForecastSlot[] = position.forecasts.map((fc: any) => {
        const windArray = fc.wind || [];
        const ts = new Date(fc.timestamp);
        const windAtAlt: WindAtAltitude[] = HOURLY_WIND_HEIGHTS.map((h) => {
          const w = windArray.find((entry: any) => (entry.height?.value ?? 0) === h) ?? windArray[HOURLY_WIND_HEIGHTS.indexOf(h)];
          if (!w) return { height: h, speed: 0, direction: 0 };
          const u = w.uComponent ?? 0;
          const v = w.vComponent ?? 0;
          return { height: h, speed: calculateWindSpeed(u, v), gust: w.windSpeedGust, direction: calculateWindDirection(u, v) };
        });
        const wind10 = windAtAlt.find(w => w.height === 10);
        const tempAtAlt: ValueAtAltitude[] = fillTempLapseRate(
          (fc.temperature || []).map((t: any) => ({ height: t.height?.value ?? 0, value: t.value ?? 0 }))
        );
        const humAtAlt: ValueAtAltitude[] = (fc.airHumidity || []).map((h: any) => ({
          height: h.height?.value ?? 0,
          value: h.value ?? 0,
        }));
        return {
          hour: `${ts.getHours().toString().padStart(2, "0")}:00`,
          timestamp: fc.timestamp,
          temperature: fc.temperature?.[0]?.value ?? 0,
          windSpeed: wind10?.speed ?? 0,
          windGust: wind10?.gust,
          rain: fc.rainPrecipitation?.value ?? 0,
          cloudCover: fc.totalCloudCover?.value ?? 0,
          humidity: fc.airHumidity?.[0]?.value ?? 0,
          snow: fc.snowPrecipitation?.value,
          windAtAltitude: windAtAlt,
          temperatureAtAltitude: tempAtAlt,
          humidityAtAltitude: humAtAlt,
          pressure: fc.qnh?.value ? Math.round(fc.qnh.value / 100) : undefined,
        };
      });
      return { slots, source: "dipul" };
    } catch {
    }
  }

  const toLocalDateStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  const dateStart = toLocalDateStr(startDate);
  const dateEnd = toLocalDateStr(endDate);
  const datesToFetch = dateStart === dateEnd ? [dateStart] : [dateStart, dateEnd];
  const bsResults = await Promise.all(
    datesToFetch.map((d) => fetchBrightSkyWeather(latitude, longitude, d).catch(() => null)),
  );
  const combined = bsResults.flatMap((r) => (r ? r.hourly : []));
  const seenTs = new Set<string>();
  const filtered = combined.filter((h) => {
    if (seenTs.has(h.timestamp)) return false;
    seenTs.add(h.timestamp);
    const tms = new Date(h.timestamp).getTime();
    return tms >= startMs && tms <= endMs;
  });
  const slots: HourlyForecastSlot[] = filtered.map((h) => {
    const ts = new Date(h.timestamp);
    return {
      hour: `${ts.getHours().toString().padStart(2, "0")}:00`,
      timestamp: h.timestamp,
      temperature: h.temperature ?? 0,
      windSpeed: h.wind_speed ? h.wind_speed / 3.6 : 0,
      windGust: h.wind_gust_speed ? h.wind_gust_speed / 3.6 : undefined,
      rain: h.precipitation ?? 0,
      cloudCover: h.cloud_cover ?? 0,
      humidity: h.relative_humidity ?? 0,
      visibility: h.visibility ?? undefined,
    };
  });
  if (slots.length > 0) return { slots, source: "brightsky" };

  // Open-Meteo als letzter Fallback (z. B. DE-Inland ohne dipul/BrightSky-Daten
  // oder wenn der Ausland-Open-Meteo-Versuch oben leer war). Korrekt als
  // "openmeteo" gekennzeichnet, damit die angezeigte Quelle stimmt.
  try {
    const omSlots = await buildOpenMeteoHourlySlots(latitude, longitude, startMs, endMs);
    if (omSlots.length > 0) return { slots: omSlots, source: "openmeteo" };
  } catch {
  }

  return { slots, source: abroad ? "openmeteo" : "brightsky" };
}

export async function fetchWeatherForecastWithSource(
  latitude: number,
  longitude: number,
  targetTime: string
): Promise<ForecastResult> {
  const targetDate = new Date(targetTime);
  const now = new Date();
  const hoursAhead = (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  const tooFar = hoursAhead > 24;
  const abroad = !isWithinDwdCoverage(latitude, longitude);

  const tryOpenMeteo = async (): Promise<ForecastResult | null> => {
    try {
      const weather = await fetchOpenMeteoSnapshot(latitude, longitude, targetTime);
      return { weather, source: "openmeteo", tooFarAhead: tooFar ? true : undefined };
    } catch {
      return null;
    }
  };

  // Im Ausland zuerst Open-Meteo (lokale Modelle wie AROME); DWD nur Notfall.
  if (abroad) {
    const om = await tryOpenMeteo();
    if (om) return om;
  }

  if (!tooFar) {
    try {
      const weather = await fetchDipulForecast(latitude, longitude, targetTime);
      return { weather, source: "dipul" };
    } catch {
    }
  }

  try {
    const weather = await fetchBrightSkyForecastSnapshot(latitude, longitude, targetTime);
    return { weather, source: "brightsky", tooFarAhead: tooFar ? true : undefined };
  } catch {
  }

  // Open-Meteo als letzter Fallback (DE-Inland ohne dipul/BrightSky-Daten oder
  // wenn der Ausland-Versuch oben fehlschlug).
  const omFallback = await tryOpenMeteo();
  if (omFallback) return omFallback;

  return { weather: null, source: null, tooFarAhead: true };
}

const WIND_DIR_LABELS_16 = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function windDirectionLabel(deg: number): string {
  return WIND_DIR_LABELS_16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export interface DipulWind {
  direction: number;
  speed: number;
  gustSpeed: number;
  directionLabel: string;
}

export async function fetchDipulWind(lat: number, lon: number): Promise<DipulWind | null> {
  try {
    const weatherData = await fetchWeather(lat, lon, 30);
    const f = weatherData.forecasts[0];
    if (!f) return null;
    return {
      direction: Math.round(f.windDirection),
      speed: Math.round(f.windSpeed * 10) / 10,
      gustSpeed: f.windGust != null ? Math.round(f.windGust * 10) / 10 : 0,
      directionLabel: windDirectionLabel(f.windDirection),
    };
  } catch {
    return null;
  }
}
