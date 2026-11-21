/**
 * Luftfahrthindernisse aus OpenStreetMap (weltweit):
 * Freileitungen nach Spannung, Windräder, Masten, Türme, Schornsteine,
 * Strommasten mit Höhe und Bahnstrecken.
 *
 * Darstellung wie im KMZ-Tool (Farben/Symbole). Bewusst nur das Nötigste:
 * Art und Höhe – keine Betreiber, Netzbetreiber oder Anlagendetails.
 *
 * Daten kommen über die Overpass-API in Kacheln (Zoomstufe 10, ca. 25–40 km)
 * und werden auf dem Gerät gespeichert. Für Offline-Länder werden alle Kacheln
 * eines Landes vorab geladen (siehe offlineMaps.ts).
 */
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FT_M } from "../../shared/heights";
import { obstacleTileInActiveCountry } from "./obstacleCountryFilter";
import { trackDownload } from "./downloadActivity";
import { awaitCountryUsage } from "./countryUsage";
import { loadLastKnownPosition } from "./mapFallbackCenter";
import { parseJsonYielding, responseJsonYielding, shouldYield, stringifyYielding, yieldToUi } from "../../shared/yieldingWork";
import {
  createObstacleTileCache,
  OBSTACLE_TILE_ZOOM,
  tileBounds,
  tileKeyOf,
  type ObstacleBoundsOptions,
  type ObstacleTileData,
} from "./obstacleTileCache";

export { OBSTACLE_TILE_ZOOM } from "./obstacleTileCache";
const CACHE_DIR = `${FileSystem.documentDirectory}obstacles/`;
/** Online-Daten gelten 30 Tage, danach wird bei Internet neu geladen. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const SETTINGS_KEY = "@copterpilot/obstacles_enabled";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export type ObstacleKind = "wind" | "pmast" | "chimney" | "tower" | "tower_fernmelde" | "mast";

type TileData = ObstacleTileData;

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

let enabledCache: boolean | null = null;
const enabledListeners = new Set<(v: boolean) => void>();

export async function getObstaclesEnabled(): Promise<boolean> {
  if (enabledCache != null) return enabledCache;
  try {
    const v = await AsyncStorage.getItem(SETTINGS_KEY);
    enabledCache = v !== "0";
  } catch {
    enabledCache = true;
  }
  return enabledCache;
}

export async function setObstaclesEnabled(v: boolean): Promise<void> {
  enabledCache = v;
  enabledListeners.forEach((l) => l(v));
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, v ? "1" : "0");
  } catch {}
}

export function onObstaclesEnabledChange(l: (v: boolean) => void): () => void {
  enabledListeners.add(l);
  return () => enabledListeners.delete(l);
}

// ---------------------------------------------------------------------------
// Kachel-Mathematik
// ---------------------------------------------------------------------------

export { lonToTileX, latToTileY, tileBounds, tilesForBounds, tilesAround } from "./obstacleTileCache";

const tileKey = (x: number, y: number) => tileKeyOf(x, y);

// ---------------------------------------------------------------------------
// OSM → GeoJSON
// ---------------------------------------------------------------------------

function parseHeight(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).replace(",", ".").match(/[\d.]+/);
  if (!m) return null;
  let h = parseFloat(m[0]);
  if (!isFinite(h) || h <= 0) return null;
  if (/ft|'/.test(String(v))) h *= FT_M;
  return h > 1000 ? null : Math.round(h);
}

function maxVoltageKv(v: unknown): number {
  if (v == null) return 0;
  const kvs = String(v)
    .split(/[;,]/)
    .map((s) => parseFloat(s))
    .filter((n) => isFinite(n) && n > 0)
    .map((n) => (n >= 1000 ? n / 1000 : n));
  return kvs.length ? Math.max(...kvs) : 0;
}

/** Leitungsklasse wie im KMZ-Tool (lineClass) */
function lineClass(kv: number, power: string): string {
  if (kv >= 220) return "hoes";
  if (kv >= 60) return "hs";
  if (kv >= 6) return "ms";
  if (kv > 0) return "ns";
  return power === "line" ? "unk_line" : "unk_minor";
}

function nodeKind(tags: Record<string, string>): ObstacleKind | null {
  if (tags.power === "generator" && tags["generator:source"] === "wind") return "wind";
  if (tags.power === "tower" || tags.power === "portal" || tags.power === "pole") return "pmast";
  const mm = tags.man_made;
  if (mm === "chimney") return "chimney";
  if (mm === "communications_tower") return "tower_fernmelde";
  if (mm === "tower") {
    if (tags["tower:type"] === "communication") return "mast";
    return "tower";
  }
  if (mm === "mast") return "mast";
  return null;
}

function obstacleHeight(kind: ObstacleKind, tags: Record<string, string>): number | null {
  if (kind === "wind") {
    const total = parseHeight(tags.height);
    if (total) return total;
    const hub = parseHeight(tags["height:hub"] ?? tags["generator:height"]);
    const rotor = parseHeight(tags["rotor:diameter"]);
    if (hub) return Math.round(hub + (rotor ?? 0) / 2);
    return null;
  }
  return parseHeight(tags.height ?? tags["building:height"]);
}

function overpassQuery(b: { s: number; w: number; n: number; e: number }): string {
  const bb = `${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)}`;
  return `[out:json][timeout:90];(
way["power"~"^(line|minor_line)$"](${bb});
nwr["power"="generator"]["generator:source"="wind"](${bb});
node["power"~"^(tower|portal)$"]["height"](${bb});
node["power"="pole"]["height"](${bb});
nwr["man_made"~"^(mast|tower|chimney|communications_tower)$"](${bb});
way["railway"="rail"]["service"!~"."](${bb});
);out tags geom qt;`;
}

export function toFeatureCollection(json: any): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const el of json?.elements ?? []) {
    const tags: Record<string, string> = el.tags ?? {};
    if (el.type === "way" && Array.isArray(el.geometry) && (tags.power === "line" || tags.power === "minor_line")) {
      const coords = el.geometry.map((p: any) => [p.lon, p.lat]);
      if (coords.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { k: "line", c: lineClass(maxVoltageKv(tags.voltage), tags.power) },
        geometry: { type: "LineString", coordinates: coords },
      });
      continue;
    }
    if (el.type === "way" && Array.isArray(el.geometry) && tags.railway === "rail") {
      const coords = el.geometry.map((p: any) => [p.lon, p.lat]);
      if (coords.length < 2) continue;
      features.push({ type: "Feature", properties: { k: "rail" }, geometry: { type: "LineString", coordinates: coords } });
      continue;
    }
    const kind = nodeKind(tags);
    if (!kind) continue;
    let lat: number | undefined;
    let lon: number | undefined;
    if (el.type === "node") {
      lat = el.lat;
      lon = el.lon;
    } else if (el.bounds) {
      lat = (el.bounds.minlat + el.bounds.maxlat) / 2;
      lon = (el.bounds.minlon + el.bounds.maxlon) / 2;
    } else if (Array.isArray(el.geometry) && el.geometry.length) {
      lat = el.geometry.reduce((a: number, p: any) => a + p.lat, 0) / el.geometry.length;
      lon = el.geometry.reduce((a: number, p: any) => a + p.lon, 0) / el.geometry.length;
    }
    if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) continue;
    const h = obstacleHeight(kind, tags);
    if (kind === "pmast" && !h) continue;
    features.push({
      type: "Feature",
      properties: { k: kind, h: h ?? 0, label: h ? `${h} m` : "" },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }
  return { type: "FeatureCollection", features };
}

/** toFeatureCollection in Zeitscheiben (je Element unabhängig – Ergebnis identisch). */
export async function toFeatureCollectionYielding(json: any): Promise<GeoJSON.FeatureCollection> {
  const els: any[] = Array.isArray(json?.elements) ? json.elements : [];
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < els.length; i += 500) {
    for (const f of toFeatureCollection({ elements: els.slice(i, i + 500) }).features) features.push(f);
    if (shouldYield()) await yieldToUi("obstacles");
  }
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Laden & Zwischenspeichern
// ---------------------------------------------------------------------------

let endpointIdx = 0;

/**
 * Gerätespeicher für Overpass-Kacheln (ein Verzeichnis unter
 * documentDirectory); Lesen/Schreiben in Zeitscheiben. Auch für die
 * Luftfahrt-Punkte (aviationPois.ts) genutzt.
 */
export function createFileTileStorage(dir: string) {
  let dirReady: Promise<void> | null = null;
  const ensureDir = (): Promise<void> => {
    if (!dirReady) dirReady = FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    return dirReady;
  };
  return {
    async read(key: string): Promise<TileData | null> {
      try {
        const path = `${dir}${key}.json`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) return null;
        return (await parseJsonYielding(await FileSystem.readAsStringAsync(path))) as TileData;
      } catch {
        return null;
      }
    },
    async write(key: string, data: TileData): Promise<void> {
      await ensureDir();
      try {
        await FileSystem.writeAsStringAsync(`${dir}${key}.json`, await stringifyYieldingTile(data));
      } catch {}
    },
  };
}

const fileStorage = createFileTileStorage(CACHE_DIR);

/** wie JSON.stringify(data), Feature-Liste in Zeitscheiben */
async function stringifyYieldingTile(data: TileData): Promise<string> {
  const fc = await stringifyYielding(data.fc);
  return `{"t":${JSON.stringify(data.t)},"fc":${fc}}`;
}

const cache = createObstacleTileCache({
  storage: fileStorage,
  maxAgeMs: MAX_AGE_MS,
  isAllowed: async (x, y) => {
    await awaitCountryUsage();
    return obstacleTileInActiveCountry(tileBounds(x, y, OBSTACLE_TILE_ZOOM));
  },
  fetchTile: async (x, y, ctx) => {
    const query = overpassQuery(tileBounds(x, y, OBSTACLE_TILE_ZOOM));
    // Keine app-weite Download-Anzeige für Kartenausschnitte (sonst dauernd
    // „Lädt: Hindernisse …“); die Karte zeigt einen kleinen Hinweis.
    const json = ctx.track
      ? await trackDownload({ id: "obstacles-live", labelDe: "Hindernisse", kind: "obstacles" }, () => overpass(query))
      : await overpass(query);
    return toFeatureCollectionYielding(json);
  },
});

// Overpass erlaubt pro Gerät nur wenige gleichzeitige Abfragen
const MAX_PARALLEL = 2;
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// Je Anfrage/Endpunkt. Vorher 45–60 s × 3 Endpunkte × Warteschlange (2 parallel):
// an einem hängenden Link (RC Pro 2) blockierte eine Kachel minutenlang.
export const OVERPASS_REQUEST_TIMEOUT_MS = 20000;

function offlineNow(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return !!require("./network").isOfflineNow();
  } catch {
    return false;
  }
}

class OverpassOfflineError extends Error {
  constructor() {
    super("Gerät offline – Overpass nicht abgefragt");
    this.name = "OverpassOfflineError";
  }
}

function overpass(query: string, timeoutMs = OVERPASS_REQUEST_TIMEOUT_MS): Promise<any> {
  // Offline gar nicht erst anstellen (gespeicherte Kacheln liefert der Cache)
  if (offlineNow()) return Promise.reject(new OverpassOfflineError());
  return slot(() => (offlineNow() ? Promise.reject(new OverpassOfflineError()) : overpassDirect(query, timeoutMs)));
}

/** Gemeinsamer Overpass-Zugang (Endpunkt-Wechsel, max. 2 parallel) für andere OSM-Abfragen. */
export function overpassRequest(query: string, timeoutMs = OVERPASS_REQUEST_TIMEOUT_MS): Promise<any> {
  return overpass(query, timeoutMs);
}

async function overpassDirect(query: string, timeoutMs: number): Promise<any> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt++) {
    const url = OVERPASS_ENDPOINTS[(endpointIdx + attempt) % OVERPASS_ENDPOINTS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "COpterPilot-RC/1.0" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) throw new Error(`Overpass ${res.status}`);
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      endpointIdx = (endpointIdx + attempt) % OVERPASS_ENDPOINTS.length;
      // Overpass-Antworten (elements[]) in Zeitscheiben parsen
      return await responseJsonYielding(res);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      // Inzwischen offline: keine weiteren Endpunkte durchprobieren
      if (offlineNow()) break;
    }
  }
  throw lastErr ?? new Error("Overpass nicht erreichbar");
}

/**
 * Lädt eine Kachel (Speicher → Gerät → sonst Internet). force = immer neu laden.
 * Kacheln in deaktivierten Ländern (Nutzung „Aus“) werden weder geladen noch
 * geliefert (obstacleTileInActiveCountry). Gespeicherte, aber veraltete Daten
 * werden sofort geliefert und still im Hintergrund erneuert. `track: true` =
 * eigene Download-Anzeige (Standard: aus).
 */
export async function loadObstacleTile(
  x: number,
  y: number,
  opts: { force?: boolean; allowNetwork?: boolean; track?: boolean } = {},
): Promise<TileData | null> {
  return cache.get(x, y, opts);
}

export async function hasObstacleTile(x: number, y: number): Promise<boolean> {
  if (cache.peek(x, y)) return true;
  const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${tileKey(x, y)}.json`).catch(() => ({ exists: false }));
  return info.exists;
}

/**
 * Alle Hindernisse für einen Kartenausschnitt (zusammengeführt): zuerst sofort
 * alles Gespeicherte, danach nur die fehlenden Kacheln aus dem Internet.
 */
export async function loadObstaclesForBounds(
  w: number,
  s: number,
  e: number,
  n: number,
  onPartial?: (fc: GeoJSON.FeatureCollection) => void,
  opts: Omit<ObstacleBoundsOptions, "onPartial"> = {},
): Promise<GeoJSON.FeatureCollection> {
  return cache.loadForBounds(w, s, e, n, { ...opts, onPartial });
}

/** Umgebung einer Position (3×3 Kacheln, ca. 75–120 km) vorab laden – leise, nacheinander. */
export async function prefetchObstaclesAround(lat: number, lon: number, radiusTiles = 1): Promise<number> {
  if (!(await getObstaclesEnabled())) return 0;
  return cache.prefetchAround(lat, lon, radiusTiles);
}

/** Beim Start: Umgebung der zuletzt bekannten Position vorab laden. */
export async function prefetchObstaclesAroundLastKnown(): Promise<number> {
  const p = await loadLastKnownPosition().catch(() => null);
  return p ? prefetchObstaclesAround(p.latitude, p.longitude) : 0;
}

/** Laufende Internet-Abfragen (für einen kleinen Lade-Hinweis auf der Karte). */
export function subscribeObstacleLoading(l: (active: number) => void): () => void {
  return cache.subscribeLoading(l);
}

export async function obstacleCacheSize(): Promise<{ files: number; bytes: number }> {
  try {
    const names = await FileSystem.readDirectoryAsync(CACHE_DIR);
    let bytes = 0;
    for (const n of names) {
      const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${n}`);
      if (info.exists && "size" in info) bytes += info.size ?? 0;
    }
    return { files: names.length, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

export async function deleteObstacleTiles(tiles: { x: number; y: number }[]): Promise<void> {
  for (const t of tiles) {
    const key = tileKey(t.x, t.y);
    cache.forget(t.x, t.y);
    await FileSystem.deleteAsync(`${CACHE_DIR}${key}.json`, { idempotent: true }).catch(() => {});
  }
}
