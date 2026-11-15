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

export const OBSTACLE_TILE_ZOOM = 10;
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

type TileData = { t: number; fc: GeoJSON.FeatureCollection };

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

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tileBounds(x: number, y: number, z: number): { s: number; w: number; n: number; e: number } {
  const n2 = 2 ** z;
  const lon = (xx: number) => (xx / n2) * 360 - 180;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n2))) * 180) / Math.PI;
  return { w: lon(x), e: lon(x + 1), n: lat(y), s: lat(y + 1) };
}

export function tilesForBounds(
  w: number,
  s: number,
  e: number,
  n: number,
  z = OBSTACLE_TILE_ZOOM,
): { x: number; y: number }[] {
  const x0 = lonToTileX(w, z);
  const x1 = lonToTileX(e, z);
  const y0 = latToTileY(n, z);
  const y1 = latToTileY(s, z);
  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
}

const tileKey = (x: number, y: number) => `${OBSTACLE_TILE_ZOOM}_${x}_${y}`;

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

// ---------------------------------------------------------------------------
// Laden & Zwischenspeichern
// ---------------------------------------------------------------------------

const memory = new Map<string, TileData>();
const inflight = new Map<string, Promise<TileData | null>>();
const failed = new Map<string, number>();
let dirReady: Promise<void> | null = null;
let endpointIdx = 0;

function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true }).catch(() => {});
  }
  return dirReady;
}

async function readTile(key: string): Promise<TileData | null> {
  const mem = memory.get(key);
  if (mem) return mem;
  try {
    const path = `${CACHE_DIR}${key}.json`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const data = JSON.parse(await FileSystem.readAsStringAsync(path)) as TileData;
    memory.set(key, data);
    return data;
  } catch {
    return null;
  }
}

async function writeTile(key: string, data: TileData): Promise<void> {
  memory.set(key, data);
  await ensureDir();
  try {
    await FileSystem.writeAsStringAsync(`${CACHE_DIR}${key}.json`, JSON.stringify(data));
  } catch {}
}

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

function overpass(query: string, timeoutMs = 100000): Promise<any> {
  return slot(() => overpassDirect(query, timeoutMs));
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
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Overpass nicht erreichbar");
}

/**
 * Lädt eine Kachel (Gerät → sonst Internet). force = immer neu laden.
 * Kacheln in deaktivierten Ländern (Nutzung „Aus“) werden weder geladen noch
 * geliefert (obstacleTileInActiveCountry). `track: false` = keine eigene
 * Download-Anzeige (der Aufrufer zeigt den Gesamtfortschritt).
 */
export async function loadObstacleTile(
  x: number,
  y: number,
  opts: { force?: boolean; allowNetwork?: boolean; track?: boolean } = {},
): Promise<TileData | null> {
  await awaitCountryUsage();
  if (!obstacleTileInActiveCountry(tileBounds(x, y, OBSTACLE_TILE_ZOOM))) return null;
  const key = tileKey(x, y);
  const cached = await readTile(key);
  const fresh = cached && Date.now() - cached.t < MAX_AGE_MS;
  if (cached && (fresh || opts.allowNetwork === false) && !opts.force) return cached;
  if (opts.allowNetwork === false) return cached;
  const running = inflight.get(key);
  if (running) return running;
  // nach einem Fehlschlag nicht sofort erneut fragen (Server schonen)
  const failedAt = failed.get(key);
  if (!opts.force && failedAt && Date.now() - failedAt < 120000) return cached;
  const p = (async () => {
    try {
      const query = overpassQuery(tileBounds(x, y, OBSTACLE_TILE_ZOOM));
      const json =
        opts.track === false
          ? await overpass(query)
          : await trackDownload({ id: "obstacles-live", labelDe: "Hindernisse für den Kartenausschnitt", kind: "obstacles" }, () => overpass(query));
      const data: TileData = { t: Date.now(), fc: toFeatureCollection(json) };
      await writeTile(key, data);
      return data;
    } catch {
      failed.set(key, Date.now());
      return cached; // offline oder Server überlastet: alte Daten weiter nutzen
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export async function hasObstacleTile(x: number, y: number): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(`${CACHE_DIR}${tileKey(x, y)}.json`).catch(() => ({ exists: false }));
  return info.exists;
}

/** Alle Hindernisse für einen Kartenausschnitt (zusammengeführt). */
export async function loadObstaclesForBounds(
  w: number,
  s: number,
  e: number,
  n: number,
  onPartial?: (fc: GeoJSON.FeatureCollection) => void,
): Promise<GeoJSON.FeatureCollection> {
  const tiles = tilesForBounds(w, s, e, n);
  if (tiles.length > 30) return { type: "FeatureCollection", features: [] };
  const parts: (TileData | null)[] = tiles.map(() => null);
  const merge = (): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: parts.flatMap((p) => (p ? p.fc.features : [])),
  });
  await Promise.all(
    tiles.map((t, i) =>
      loadObstacleTile(t.x, t.y).then((r) => {
        parts[i] = r;
        if (r && onPartial) onPartial(merge());
      }),
    ),
  );
  return merge();
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
    memory.delete(key);
    await FileSystem.deleteAsync(`${CACHE_DIR}${key}.json`, { idempotent: true }).catch(() => {});
  }
}
