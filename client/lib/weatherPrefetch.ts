// Wetter vorab laden (Hintergrund), damit die Wetteransicht sofort Daten zeigt.
//
// - App-Start: nachdem der erste Bildschirm bedienbar ist (runAfterStartup),
//   für die zuletzt genutzte Position (gespeichert) und – falls die
//   Standort-Berechtigung schon erteilt ist – die aktuelle Geräteposition.
//   Es wird NIE nach der Berechtigung gefragt.
// - Danach alle PREFETCH_CHECK_MS prüfen: neu laden, wenn der letzte Abruf
//   älter als PREFETCH_INTERVAL_MS ist oder sich die Position um mehr als
//   PREFETCH_MOVE_KM bewegt hat; nur solange die App im Vordergrund und online ist.
// - Geladen wird über fetchWeather/fetchHourlyForecasts: die Ergebnisse
//   landen im Offline-Speicher (offlineResultCache), aus dem die Ansicht sofort
//   liest (peekCachedWeather) und den fetchWeather bis WEATHER_FRESH_MS ohne
//   Netzabruf liefert. Ältere Daten als 24 h zeigt die Ansicht weiterhin nicht
//   (shared/offlineDataPolicy.ts).
//
// RN-Module werden lazy geladen; die Logik (createWeatherPrefetcher) ist mit
// eingesetzten Abhängigkeiten unter tsx testbar.

import {
  fetchHourlyForecasts,
  fetchWeather,
  setWeatherPositionListener,
  todayHourlyWindow,
  WEATHER_FETCH_MINUTES,
} from "./weather";

export const PREFETCH_INTERVAL_MS = 20 * 60_000;
export const PREFETCH_CHECK_MS = 5 * 60_000;
export const PREFETCH_MOVE_KM = 3;
export const PREFETCH_START_DELAY_MS = 3000;
const POSITION_STORE_KEY = "@copterpilot/weather_prefetch_pos";
/** Gespeicherte Position nur bei echter Bewegung bzw. selten neu schreiben. */
const POSITION_STORE_MIN_KM = 0.5;
const POSITION_STORE_MIN_MS = 10 * 60_000;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface WeatherPrefetchDeps {
  now: () => number;
  isOffline: () => boolean;
  isAppActive: () => boolean;
  /** Geräteposition ohne Nachfrage (null = keine Berechtigung/kein Fix). */
  getDevicePosition: () => Promise<LatLon | null>;
  loadStoredPosition: () => Promise<LatLon | null>;
  saveStoredPosition: (p: LatLon) => Promise<void>;
  prefetchWeather: (lat: number, lon: number) => Promise<unknown>;
  prefetchHourly: (lat: number, lon: number) => Promise<unknown>;
}

export function distanceKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validPos(p: unknown): p is LatLon {
  const q = p as LatLon | null;
  return !!q && Number.isFinite(q.lat) && Number.isFinite(q.lon) && Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180 && !(q.lat === 0 && q.lon === 0);
}

export interface WeatherPrefetcher {
  /** Position merken (z. B. aus einem Wetterabruf einer Ansicht); lädt nichts. */
  notePosition(lat: number, lon: number): void;
  /** Prüfen und bei Bedarf vorab laden. Liefert true, wenn geladen wurde. */
  tick(reason: "start" | "periodic" | "resume"): Promise<boolean>;
  /** Zuletzt erfolgreich vorab geladen (Position + Zeit) – für Tests/Diagnose. */
  lastPrefetch(): { pos: LatLon; at: number } | null;
}

export function createWeatherPrefetcher(deps: WeatherPrefetchDeps): WeatherPrefetcher {
  let last: { pos: LatLon; at: number } | null = null;
  let known: LatLon | null = null;
  let stored: { pos: LatLon; at: number } | null = null;
  let running: Promise<boolean> | null = null;

  const needsPrefetch = (pos: LatLon, now: number): boolean => {
    if (!last) return true;
    if (now - last.at >= PREFETCH_INTERVAL_MS) return true;
    return distanceKm(last.pos, pos) >= PREFETCH_MOVE_KM;
  };

  const persist = (pos: LatLon): void => {
    const now = deps.now();
    if (stored && distanceKm(stored.pos, pos) < POSITION_STORE_MIN_KM && now - stored.at < POSITION_STORE_MIN_MS) return;
    stored = { pos, at: now };
    deps.saveStoredPosition(pos).catch(() => {});
  };

  const run = async (pos: LatLon): Promise<boolean> => {
    const results = await Promise.allSettled([
      deps.prefetchWeather(pos.lat, pos.lon),
      deps.prefetchHourly(pos.lat, pos.lon),
    ]);
    // Wetter ist maßgeblich; die Stundenwerte sind ein Zusatz
    if (results[0].status === "fulfilled") {
      last = { pos, at: deps.now() };
      return true;
    }
    return false;
  };

  const tick = async (reason: "start" | "periodic" | "resume"): Promise<boolean> => {
    if (running) return running;
    if (deps.isOffline() || !deps.isAppActive()) return false;
    running = (async () => {
      try {
        let didFetch = false;
        let tried: LatLon | null = null;
        if (reason === "start" && !known) {
          // Zuerst die zuletzt genutzte Position: sofort, ohne auf GPS zu warten
          const sp = await deps.loadStoredPosition().catch(() => null);
          if (validPos(sp)) {
            known = sp;
            stored = { pos: sp, at: deps.now() };
            tried = sp;
            didFetch = (await run(sp)) || didFetch;
          }
        }
        const dev = await deps.getDevicePosition().catch(() => null);
        if (validPos(dev)) {
          known = dev;
          persist(dev);
        }
        // (im selben Durchlauf nicht dieselbe Stelle nach einem Fehlschlag erneut)
        const sameAsTried = !!tried && !!known && distanceKm(tried, known) < PREFETCH_MOVE_KM;
        if (known && !sameAsTried && needsPrefetch(known, deps.now())) {
          didFetch = (await run(known)) || didFetch;
        }
        return didFetch;
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return {
    notePosition(lat: number, lon: number) {
      const p = { lat, lon };
      if (!validPos(p)) return;
      known = p;
      persist(p);
    },
    tick,
    lastPrefetch: () => last,
  };
}

// ─── App-Anbindung ─────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-require-imports */
function lazyStorage(): { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> } | null {
  try {
    const mod = require("@react-native-async-storage/async-storage");
    return (mod?.default ?? mod) ?? null;
  } catch {
    return null;
  }
}

let appActive = true;

function defaultDeps(): WeatherPrefetchDeps {
  return {
    now: () => Date.now(),
    isOffline: () => {
      try {
        return !!require("./network").isOfflineNow();
      } catch {
        return false;
      }
    },
    isAppActive: () => appActive,
    getDevicePosition: async () => {
      try {
        const Location = require("./location");
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm?.granted) return null;
        const lastKnown = await Location.getLastKnownPositionAsync().catch(() => null);
        const loc = lastKnown ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced }).catch(() => null));
        return loc ? { lat: loc.coords.latitude, lon: loc.coords.longitude } : null;
      } catch {
        return null;
      }
    },
    loadStoredPosition: async () => {
      const raw = await lazyStorage()?.getItem(POSITION_STORE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return validPos(p) ? { lat: p.lat, lon: p.lon } : null;
    },
    saveStoredPosition: async (p) => {
      await lazyStorage()?.setItem(POSITION_STORE_KEY, JSON.stringify({ lat: p.lat, lon: p.lon }));
    },
    prefetchWeather: (lat, lon) => fetchWeather(lat, lon, WEATHER_FETCH_MINUTES),
    prefetchHourly: (lat, lon) => {
      const w = todayHourlyWindow();
      return fetchHourlyForecasts(lat, lon, w.start, w.end);
    },
  };
}

let started = false;
let instance: WeatherPrefetcher | null = null;

/** Beim App-Start einmal aufrufen. */
export function startWeatherPrefetch(startDelayMs: number = PREFETCH_START_DELAY_MS): void {
  if (started) return;
  started = true;
  const p = createWeatherPrefetcher(defaultDeps());
  instance = p;
  // Jeder Wetterabruf einer Ansicht meldet seine Position (Radar, Planung, …)
  setWeatherPositionListener((lat, lon) => p.notePosition(lat, lon));
  try {
    const { runAfterStartup } = require("./backgroundWork");
    runAfterStartup(() => {
      void p.tick("start").catch(() => false);
    }, startDelayMs);
  } catch {
    setTimeout(() => void p.tick("start").catch(() => false), startDelayMs);
  }
  const iv = setInterval(() => {
    void p.tick("periodic").catch(() => false);
  }, PREFETCH_CHECK_MS);
  (iv as any)?.unref?.();
  try {
    const { AppState } = require("react-native");
    AppState?.addEventListener?.("change", (s: string) => {
      const wasActive = appActive;
      appActive = s === "active";
      if (appActive && !wasActive) void p.tick("resume").catch(() => false);
    });
  } catch {}
}

/** Für Ansichten: Prefetcher (null vor dem Start). */
export function getWeatherPrefetcher(): WeatherPrefetcher | null {
  return instance;
}
