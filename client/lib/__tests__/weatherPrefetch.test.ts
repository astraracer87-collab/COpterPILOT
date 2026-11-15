// Wetter vorab laden + Cache: frische gespeicherte Daten ohne Netzabruf,
// zusammengelegte gleichzeitige Abrufe, Zuschnitt je Aufrufer, Sofortanzeige
// (peek) mit 24-h-Grenze, DFS→Open-Meteo-Hedge, Vorab-Lade-Logik (Start,
// Intervall, Ortswechsel, offline) und Scroll-Sync des Sonnenstand-Diagramms.
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { __setOfflineCacheStorageForTests, putOfflineResult, type OfflineCacheStorage } from "../offlineResultCache";
import {
  __resetWeatherInflightForTests,
  fetchWeather,
  peekCachedWeather,
  raceWithHedge,
  sliceWeatherForRequest,
  weatherForecastCount,
  WEATHER_FRESH_MS,
  type WeatherData,
} from "../weather";
import { offlineLocationKey, OFFLINE_DATA_MAX_AGE_MS } from "../../../shared/offlineDataPolicy";
import { createWeatherPrefetcher, distanceKm, PREFETCH_INTERVAL_MS, type LatLon, type WeatherPrefetchDeps } from "../weatherPrefetch";
import { buildSunMarkerTrack, localDayStart, normalizeSlotTimes, timeAtScrollOffset } from "../sunArcScrollSync";

const H = 3_600_000;
// Madrid: außerhalb der DWD-Abdeckung → direkt Open-Meteo (ein Abruf)
const LAT = 40.4;
const LON = -3.7;

function memoryStorage(): OfflineCacheStorage {
  const map = new Map<string, string>();
  return {
    async getItem(k) { return map.has(k) ? map.get(k)! : null; },
    async setItem(k, v) { map.set(k, v); },
    async removeItem(k) { map.delete(k); },
  };
}

function openMeteoResponse(hours: number) {
  const base = Math.floor(Date.now() / H) * H;
  const time: string[] = [];
  const t2: number[] = [];
  for (let i = 0; i < hours; i++) {
    time.push(new Date(base + i * H).toISOString().slice(0, 16));
    t2.push(10 + i);
  }
  return { hourly: { time, temperature_2m: t2, wind_speed_10m: t2.map(() => 3), wind_direction_10m: t2.map(() => 180) } };
}

const realFetch = globalThis.fetch;
let fetchCount = 0;

beforeEach(() => {
  __setOfflineCacheStorageForTests(memoryStorage());
  __resetWeatherInflightForTests();
  fetchCount = 0;
  globalThis.fetch = (async (url: string) => {
    fetchCount += 1;
    assert.ok(String(url).includes("open-meteo.com"), `unerwartete URL ${url}`);
    await new Promise((r) => setImmediate(r));
    return { ok: true, status: 200, json: async () => openMeteoResponse(48) } as any;
  }) as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function sampleWeather(n: number, startMs: number): WeatherData {
  return {
    latitude: LAT,
    longitude: LON,
    calculationTime: new Date(startMs).toISOString(),
    forecasts: Array.from({ length: n }, (_, i) => ({
      timestamp: new Date(startMs + i * H).toISOString(),
      temperature: i,
      windSpeed: 1,
      windDirection: 0,
      windAtAltitude: [],
      temperatureAtAltitude: [],
      humidityAtAltitude: [],
      cloudCoverAtAltitude: [],
      rain: 0,
      snow: 0,
      cloudCover: 0,
      humidity: 50,
      pressure: 101300,
    })),
  };
}

describe("fetchWeather: Cache und Zusammenlegen", () => {
  it("zweiter Abruf innerhalb von WEATHER_FRESH_MS kommt ohne Netz aus dem Speicher", async () => {
    const a = await fetchWeather(LAT, LON, 1440);
    assert.equal(fetchCount, 1);
    assert.equal(a.forecasts.length, 25);
    assert.equal(a.offline, undefined, "Live-Abruf ohne offline-Markierung");
    const b = await fetchWeather(LAT, LON, 2880);
    assert.equal(fetchCount, 1, "kein zweiter Netzabruf");
    assert.equal(b.forecasts.length, 48);
    assert.equal(b.offline?.cached, false, "frischer Speicherstand gilt als live");
  });

  it("schneidet auf die frühere Länge je Aufrufer zu (30 min → 2, ohne Angabe → 24)", async () => {
    await fetchWeather(LAT, LON, 2880);
    assert.equal((await fetchWeather(LAT, LON, 30)).forecasts.length, 2);
    assert.equal((await fetchWeather(LAT, LON)).forecasts.length, 24);
    assert.equal(fetchCount, 1);
  });

  it("maxAgeMs: 0 ruft immer live ab", async () => {
    await fetchWeather(LAT, LON, 1440);
    await fetchWeather(LAT, LON, 1440, { maxAgeMs: 0 });
    assert.equal(fetchCount, 2);
  });

  it("gleichzeitige Abrufe desselben Standorts teilen sich einen Netzabruf", async () => {
    const [a, b, c] = await Promise.all([
      fetchWeather(LAT, LON, 1440),
      fetchWeather(LAT, LON, 2880),
      fetchWeather(LAT + 0.001, LON, 30),
    ]);
    assert.equal(fetchCount, 1);
    assert.equal(a.forecasts.length, 25);
    assert.equal(b.forecasts.length, 48);
    assert.equal(c.forecasts.length, 2);
  });

  it("ein weiter entfernter Punkt in derselben Rasterzelle nutzt den frischen Stand nicht", async () => {
    await fetchWeather(40.401, -3.71, 1440);
    // gleiche 0,05°-Zelle, aber > 0,02° entfernt → neu abrufen
    assert.equal(offlineLocationKey(40.401, -3.71), offlineLocationKey(40.424, -3.71));
    await fetchWeather(40.424, -3.71, 1440);
    assert.equal(fetchCount, 2);
  });
});

describe("peekCachedWeather: Sofortanzeige", () => {
  it("liefert nichts ohne Speicherstand", async () => {
    assert.equal(await peekCachedWeather(LAT, LON), null);
  });

  it("frisch → cached:false, älter als WEATHER_FRESH_MS → cached:true, älter als 24 h → null", async () => {
    const now = Date.now();
    const key = offlineLocationKey(LAT, LON);
    await putOfflineResult("weather", key, sampleWeather(48, Math.floor(now / H) * H), now - 60_000);
    const fresh = await peekCachedWeather(LAT, LON, 1440);
    assert.equal(fresh?.offline?.cached, false);
    assert.equal(fresh?.forecasts.length, 25);

    await putOfflineResult("weather", key, sampleWeather(48, Math.floor(now / H) * H), now - WEATHER_FRESH_MS - 1000);
    assert.equal((await peekCachedWeather(LAT, LON))?.offline?.cached, true);

    await putOfflineResult("weather", key, sampleWeather(48, Math.floor(now / H) * H), now - OFFLINE_DATA_MAX_AGE_MS - 1000);
    assert.equal(await peekCachedWeather(LAT, LON), null, "älter als 24 h wird nicht gezeigt");
  });

  it("vergangene Stunden werden verworfen", () => {
    const now = Date.now();
    const data = sampleWeather(10, now - 5 * H);
    const s = sliceWeatherForRequest(data, undefined, now)!;
    assert.ok(new Date(s.forecasts[0].timestamp).getTime() >= now - H);
    assert.equal(s.forecasts.length, 6);
    assert.equal(sliceWeatherForRequest(sampleWeather(2, now - 10 * H), undefined, now), null);
    assert.equal(weatherForecastCount(60), 2);
    assert.equal(weatherForecastCount(1440), 25);
  });
});

describe("raceWithHedge (DFS → Open-Meteo)", () => {
  it("schnelle erste Quelle gewinnt, die zweite startet nicht", async () => {
    let second = 0;
    const r = await raceWithHedge(async () => "dfs", async () => { second += 1; return "om"; }, 50);
    assert.equal(r, "dfs");
    await new Promise((res) => setTimeout(res, 80));
    assert.equal(second, 0);
  });

  it("Fehler der ersten Quelle startet die zweite sofort", async () => {
    const t0 = Date.now();
    const r = await raceWithHedge(async () => { throw new Error("dfs down"); }, async () => "om", 10_000);
    assert.equal(r, "om");
    assert.ok(Date.now() - t0 < 1000);
  });

  it("hängende erste Quelle: zweite startet nach hedgeMs und gewinnt", async () => {
    const r = await raceWithHedge(() => new Promise<string>(() => {}), async () => "om", 20);
    assert.equal(r, "om");
  });

  it("beide fehlgeschlagen → Fehler der zweiten Quelle", async () => {
    await assert.rejects(
      raceWithHedge(async () => { throw new Error("a"); }, async () => { throw new Error("b"); }, 10),
      /b/,
    );
  });
});

describe("Vorab-Laden (createWeatherPrefetcher)", () => {
  function setup(over: Partial<WeatherPrefetchDeps> = {}) {
    let now = 1_000_000;
    const calls: LatLon[] = [];
    let saved: LatLon | null = null;
    let device: LatLon | null = null;
    let offline = false;
    const deps: WeatherPrefetchDeps = {
      now: () => now,
      isOffline: () => offline,
      isAppActive: () => true,
      getDevicePosition: async () => device,
      loadStoredPosition: async () => ({ lat: 48.1, lon: 11.5 }),
      saveStoredPosition: async (p) => { saved = p; },
      prefetchWeather: async (lat, lon) => { calls.push({ lat, lon }); },
      prefetchHourly: async () => {},
      ...over,
    };
    const p = createWeatherPrefetcher(deps);
    return {
      p,
      calls,
      advance: (ms: number) => { now += ms; },
      setDevice: (d: LatLon | null) => { device = d; },
      setOffline: (o: boolean) => { offline = o; },
      saved: () => saved,
    };
  }

  it("Start: lädt sofort für die gespeicherte Position, danach nicht doppelt", async () => {
    const s = setup();
    assert.equal(await s.p.tick("start"), true);
    assert.deepEqual(s.calls, [{ lat: 48.1, lon: 11.5 }]);
    assert.equal(await s.p.tick("periodic"), false);
    assert.equal(s.calls.length, 1);
  });

  it("Start mit Geräteposition weit weg: lädt zusätzlich für die aktuelle Position und speichert sie", async () => {
    const s = setup();
    s.setDevice({ lat: 52.5, lon: 13.4 });
    await s.p.tick("start");
    assert.deepEqual(s.calls, [{ lat: 48.1, lon: 11.5 }, { lat: 52.5, lon: 13.4 }]);
    assert.deepEqual(s.saved(), { lat: 52.5, lon: 13.4 });
  });

  it("lädt nach PREFETCH_INTERVAL_MS erneut und bei Ortswechsel > 3 km", async () => {
    const s = setup();
    await s.p.tick("start");
    s.advance(PREFETCH_INTERVAL_MS - 60_000);
    s.setDevice({ lat: 48.105, lon: 11.5 }); // ~0,6 km
    assert.equal(await s.p.tick("periodic"), false);
    s.setDevice({ lat: 48.2, lon: 11.5 }); // ~11 km
    assert.equal(await s.p.tick("periodic"), true);
    s.advance(PREFETCH_INTERVAL_MS);
    assert.equal(await s.p.tick("periodic"), true);
    assert.equal(s.calls.length, 3);
  });

  it("offline: kein Abruf", async () => {
    const s = setup();
    s.setOffline(true);
    assert.equal(await s.p.tick("start"), false);
    assert.equal(s.calls.length, 0);
  });

  it("fehlgeschlagener Abruf wird beim nächsten Tick wiederholt", async () => {
    let fail = true;
    const calls: number[] = [];
    const s = setup({ prefetchWeather: async () => { calls.push(1); if (fail) throw new Error("x"); } });
    assert.equal(await s.p.tick("start"), false);
    fail = false;
    assert.equal(await s.p.tick("periodic"), true);
    assert.equal(calls.length, 2);
  });

  it("notePosition merkt die Position der Ansichten ohne zu laden", async () => {
    const s = setup({ loadStoredPosition: async () => null });
    s.p.notePosition(50, 8);
    assert.equal(s.calls.length, 0);
    assert.deepEqual(s.saved(), { lat: 50, lon: 8 });
    await s.p.tick("periodic");
    assert.deepEqual(s.calls, [{ lat: 50, lon: 8 }]);
  });

  it("distanceKm", () => {
    assert.ok(Math.abs(distanceKm({ lat: 48, lon: 11 }, { lat: 49, lon: 11 }) - 111.2) < 0.5);
  });
});

describe("Sonnenstand-Diagramm: Scroll-Sync", () => {
  const T0 = Date.UTC(2026, 10, 15, 10, 37);
  const slots = [Date.UTC(2026, 10, 15, 10), Date.UTC(2026, 10, 15, 11), Date.UTC(2026, 10, 15, 12)];

  it("Spalte 0 = jetzt, streng steigend", () => {
    const t = normalizeSlotTimes(slots, T0);
    assert.deepEqual(t, [T0, slots[1], slots[2]]);
    const t2 = normalizeSlotTimes([0, T0 - H, T0 + H], T0);
    assert.ok(t2[1] > t2[0]);
  });

  it("Offset ↔ Zeit linear zwischen den Spalten, begrenzt", () => {
    const t = normalizeSlotTimes(slots, T0);
    assert.equal(timeAtScrollOffset(0, t, 64), T0);
    assert.equal(timeAtScrollOffset(64, t, 64), slots[1]);
    assert.equal(timeAtScrollOffset(96, t, 64), slots[1] + H / 2);
    assert.equal(timeAtScrollOffset(-50, t, 64), T0);
    assert.equal(timeAtScrollOffset(10_000, t, 64), slots[2]);
  });

  it("Stützpunkte: streng steigend, höchstens 15 min Abstand, Phasen exklusiv", () => {
    const t = normalizeSlotTimes(slots, T0);
    const track = buildSunMarkerTrack(t, 64, (time) => ({ x: (time - T0) / 60_000, y: 0, elevationDeg: time < slots[1] ? 5 : -3 }));
    for (let i = 1; i < track.inputRange.length; i++) assert.ok(track.inputRange[i] > track.inputRange[i - 1]);
    assert.equal(track.inputRange[0], 0);
    assert.equal(track.inputRange[track.inputRange.length - 1], 128);
    assert.equal(track.inputRange.length, 2 + 4 + 1); // 10:37→11:00: ceil(23/15)=2, 11→12: 4, Endpunkt
    for (let i = 0; i < track.x.length; i++) {
      assert.equal(track.dayOpacity[i] + track.twilightOpacity[i] + track.nightOpacity[i], 1);
    }
  });

  it("eine Spalte → zwei Stützpunkte", () => {
    const track = buildSunMarkerTrack([T0], 64, () => ({ x: 1, y: 2, elevationDeg: 10 }));
    assert.equal(track.inputRange.length, 2);
  });

  it("localDayStart", () => {
    const d = new Date(localDayStart(T0));
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });
});
