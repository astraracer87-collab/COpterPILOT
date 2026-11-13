export interface WindAtAltitude {
  height: number;
  speed: number;
  gust?: number;
  direction: number;
}

export interface ValueAtAltitude {
  height: number;
  value: number;
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

const WEATHER_API_URL = "https://utm-service.dfs.de/api/weather/v1/weather";

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
  const count = Math.min(Math.max(hours + 1, 2), 24);
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

export async function fetchWeather(latitude: number, longitude: number, durationMinutes?: number): Promise<WeatherData> {
  const forecasts = durationMinutes != null && durationMinutes > 0
    ? getTimestampsForWindow(durationMinutes)
    : getNext24HourTimestamps();

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

  const response = await fetch(WEATHER_API_URL, {
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

    const temperatureAtAltitude: ValueAtAltitude[] = (f.temperature || []).map((t: any) => ({
      height: t.height?.value ?? 0,
      value: t.value ?? 0,
    }));

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
    throw new WeatherFetchError("Keine Vorhersagedaten vom Wetterdienst erhalten.");
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
  source: "dipul" | "brightsky" | null;
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

  const response = await fetch(WEATHER_API_URL, {
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

  const temperatureAtAltitude = (forecast.temperature || []).map((t: any) => ({
    height: t.height?.value ?? 0,
    value: t.value ?? 0,
  }));

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

export async function fetchHourlyForecasts(
  latitude: number,
  longitude: number,
  startTime: string,
  endTime: string
): Promise<{ slots: HourlyForecastSlot[]; source: "dipul" | "brightsky" }> {
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
      const response = await fetch(WEATHER_API_URL, {
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
        const tempAtAlt: ValueAtAltitude[] = (fc.temperature || []).map((t: any) => ({
          height: t.height?.value ?? 0,
          value: t.value ?? 0,
        }));
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

  const dateStr = startTime.split("T")[0];
  const bsData = await fetchBrightSkyWeather(latitude, longitude, dateStr);
  const startH = startDate.getHours();
  const endH = endDate.getHours();
  const filtered = bsData.hourly.filter((h) => {
    const hh = new Date(h.timestamp).getHours();
    return hh >= startH && hh <= endH;
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
  return { slots, source: "brightsky" };
}

export async function fetchWeatherForecastWithSource(
  latitude: number,
  longitude: number,
  targetTime: string
): Promise<ForecastResult> {
  const targetDate = new Date(targetTime);
  const now = new Date();
  const hoursAhead = (targetDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursAhead <= 24) {
    try {
      const weather = await fetchDipulForecast(latitude, longitude, targetTime);
      return { weather, source: "dipul" };
    } catch {
      try {
        const weather = await fetchBrightSkyForecastSnapshot(latitude, longitude, targetTime);
        return { weather, source: "brightsky" };
      } catch {
        return { weather: null, source: null, tooFarAhead: true };
      }
    }
  }

  try {
    const weather = await fetchBrightSkyForecastSnapshot(latitude, longitude, targetTime);
    return { weather, source: "brightsky", tooFarAhead: true };
  } catch {
    return { weather: null, source: null, tooFarAhead: true };
  }
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
