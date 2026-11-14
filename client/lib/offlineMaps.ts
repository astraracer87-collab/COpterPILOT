/**
 * Offline-Länder: Karten, Luftbilder, Geozonen und Hindernisse eines ganzen
 * Landes auf dem Gerät speichern.
 *
 * Karten/Luftbilder/Geozonen laufen über MapLibre-Offline-Pakete (die Karte
 * findet die Kacheln dann automatisch über ihre Adresse). Hindernisse werden
 * als Kacheln aus OpenStreetMap geladen (obstacles.ts).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { OfflineManager, type OfflinePack } from "@maplibre/maplibre-react-native";
import { COUNTRY_MAP_PROVIDERS, GLYPHS_URL, LABEL_FONT, getMapProvider, type LngLatBox, type RasterDef } from "@/lib/mapSources";
import {
  buildCombinedWmsTileUrl,
  getActiveLayerNames,
  getAllDefaultEnabledLayerNames,
  getAllLayerNames,
  COUNTRY_GEOZONE_CONFIGS,
  loadGeozoneSettings,
} from "@/lib/geozones";
import { OBSTACLE_TILE_ZOOM, deleteObstacleTiles, hasObstacleTile, loadObstacleTile, tilesForBounds } from "@/lib/obstacles";

export type DetailLevel = 11 | 12 | 13 | 14 | 15;

export interface CountryOfflineConfig {
  iso: string;
  map: boolean;
  mapMaxZoom: DetailLevel;
  satellite: boolean;
  satMaxZoom: DetailLevel;
  geozones: boolean;
  geoMaxZoom: DetailLevel;
  obstacles: boolean;
}

export const DETAIL_LABELS: Record<DetailLevel, string> = {
  11: "Übersicht (ca. 75 m/Pixel)",
  12: "Grob (ca. 40 m/Pixel)",
  13: "Mittel (ca. 20 m/Pixel)",
  14: "Fein (ca. 10 m/Pixel)",
  15: "Sehr fein (ca. 5 m/Pixel)",
};

const CONFIG_KEY = "@copterpilot/offline_countries";
const GEOZONE_MIN_ZOOM = 11;
const MAP_MIN_ZOOM = 5;
const SAT_MIN_ZOOM = 8;
const GEO_KB_PER_TILE = 6;
const OBSTACLE_KB_PER_TILE = 120;

/** Länder, die offline gespeichert werden können */
export function offlineCountries(): { iso: string; label: string; bounds: LngLatBox; hasMap: boolean; hasSatellite: boolean; hasGeozones: boolean }[] {
  return COUNTRY_MAP_PROVIDERS.map((p) => ({
    iso: p.iso,
    label: p.label,
    bounds: p.bounds,
    hasMap: !!p.map,
    hasSatellite: !!p.satellite?.length,
    hasGeozones: !!COUNTRY_GEOZONE_CONFIGS[p.iso],
  }));
}

export function defaultConfig(iso: string): CountryOfflineConfig {
  const p = getMapProvider(iso);
  return {
    iso,
    map: !!p?.map,
    mapMaxZoom: 12,
    satellite: false,
    satMaxZoom: 13,
    geozones: !!COUNTRY_GEOZONE_CONFIGS[iso],
    geoMaxZoom: 12,
    obstacles: true,
  };
}

export async function loadOfflineConfigs(): Promise<CountryOfflineConfig[]> {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveOfflineConfigs(list: CountryOfflineConfig[]): Promise<void> {
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(list));
}

// ---------------------------------------------------------------------------
// Größen-Abschätzung
// ---------------------------------------------------------------------------

function lonToX(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tileCount(b: LngLatBox, minZ: number, maxZ: number): number {
  let n = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const dx = lonToX(b[2], z) - lonToX(b[0], z) + 1;
    const dy = latToY(b[1], z) - latToY(b[3], z) + 1;
    n += dx * dy;
  }
  return n;
}

/** Ländergrenzen sind keine Rechtecke: grob 65 % des Rechtecks liegen im Land */
const LAND_SHARE = 0.65;

export interface SizeEstimate {
  mapMB: number;
  satMB: number;
  geoMB: number;
  obstaclesMB: number;
  totalMB: number;
}

export function estimateSize(c: CountryOfflineConfig): SizeEstimate {
  const p = getMapProvider(c.iso);
  const mb = (tiles: number, kb: number) => (tiles * LAND_SHARE * kb) / 1024;
  let mapMB = 0;
  let satMB = 0;
  let geoMB = 0;
  let obstaclesMB = 0;
  if (c.map && p?.map) mapMB = mb(tileCount(p.map.bounds, MAP_MIN_ZOOM, c.mapMaxZoom), p.map.kbPerTile);
  if (c.satellite && p?.satellite) {
    for (const s of p.satellite) {
      satMB += mb(tileCount(s.bounds, Math.max(SAT_MIN_ZOOM, s.minzoom ?? 0), Math.min(c.satMaxZoom, s.maxzoom)), s.kbPerTile);
    }
  }
  if (c.geozones && p) geoMB = mb(tileCount(p.bounds, GEOZONE_MIN_ZOOM, c.geoMaxZoom), GEO_KB_PER_TILE) * 2;
  if (c.obstacles && p) obstaclesMB = (tilesForBounds(...p.bounds).length * LAND_SHARE * OBSTACLE_KB_PER_TILE) / 1024;
  return { mapMB, satMB, geoMB, obstaclesMB, totalMB: mapMB + satMB + geoMB + obstaclesMB };
}

export function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace(".", ",")} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1).replace(".", ",")} MB`;
}

export async function freeDiskMB(): Promise<number | null> {
  try {
    return (await FileSystem.getFreeDiskStorageAsync()) / 1024 / 1024;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offline-Pakete (MapLibre)
// ---------------------------------------------------------------------------

type PackKind = "map" | "sat" | "geo";

interface PackPlan {
  key: string;
  kind: PackKind;
  bounds: LngLatBox;
  minZoom: number;
  maxZoom: number;
  sources: { id: string; tiles: string; tileSize: number; maxzoom?: number }[];
}

let initDone = false;
async function initOffline() {
  if (initDone) return;
  initDone = true;
  OfflineManager.setTileCountLimit(10_000_000);
  OfflineManager.setProgressEventThrottle(1000);
}

async function geozoneTemplates(iso: string): Promise<string[]> {
  const settings = await loadGeozoneSettings(iso);
  const combos = [getActiveLayerNames(settings, iso), getAllDefaultEnabledLayerNames(iso), getAllLayerNames(iso)];
  const urls = new Set<string>();
  for (const layers of combos) {
    if (!layers.length) continue;
    // dieselbe Umwandlung wie WMSTile in components/maps
    urls.add(
      buildCombinedWmsTileUrl(layers, iso)
        .replace("{minX},{minY},{maxX},{maxY}", "{bbox-epsg-3857}")
        .replace(/\{width\}/g, "256")
        .replace(/\{height\}/g, "256"),
    );
  }
  return [...urls];
}

async function plansFor(c: CountryOfflineConfig): Promise<PackPlan[]> {
  const p = getMapProvider(c.iso);
  if (!p) return [];
  const plans: PackPlan[] = [];
  const src = (d: RasterDef) => ({ id: d.id, tiles: d.tiles, tileSize: d.tileSize, maxzoom: d.maxzoom });
  if (c.map && p.map) {
    plans.push({ key: `${c.iso}:map`, kind: "map", bounds: p.map.bounds, minZoom: MAP_MIN_ZOOM, maxZoom: c.mapMaxZoom, sources: [src(p.map)] });
  }
  if (c.satellite && p.satellite) {
    for (const s of p.satellite) {
      plans.push({
        key: `${c.iso}:sat:${s.id}`,
        kind: "sat",
        bounds: s.bounds,
        minZoom: Math.max(SAT_MIN_ZOOM, s.minzoom ?? 0),
        maxZoom: Math.min(c.satMaxZoom, s.maxzoom),
        sources: [src(s)],
      });
    }
  }
  if (c.geozones && COUNTRY_GEOZONE_CONFIGS[c.iso]) {
    const tpls = await geozoneTemplates(c.iso);
    plans.push({
      key: `${c.iso}:geo`,
      kind: "geo",
      bounds: p.bounds,
      minZoom: GEOZONE_MIN_ZOOM,
      maxZoom: c.geoMaxZoom,
      sources: tpls.map((t, i) => ({ id: `geo${i}`, tiles: t, tileSize: 256 })),
    });
  }
  return plans;
}

/** Stil-Datei für ein Paket (MapLibre braucht eine Stil-Adresse) */
async function writePackStyle(plan: PackPlan): Promise<string> {
  const dir = `${FileSystem.documentDirectory}offline-styles/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const sources: Record<string, any> = {};
  const layers: any[] = [];
  for (const s of plan.sources) {
    sources[s.id] = { type: "raster", tiles: [s.tiles], tileSize: s.tileSize, maxzoom: s.maxzoom ?? 22 };
    layers.push({ id: `${s.id}-l`, type: "raster", source: s.id });
  }
  const style: any = { version: 8, sources, layers };
  if (plan.kind === "geo") {
    // Schrift für die Höhenangaben an Hindernissen mit speichern
    style.glyphs = GLYPHS_URL;
    style.sources.empty = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    style.layers.push({ id: "font", type: "symbol", source: "empty", layout: { "text-field": "0", "text-font": LABEL_FONT } });
  }
  const path = `${dir}${plan.key.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(style));
  return path;
}

export interface PackProgress {
  key: string;
  kind: PackKind;
  percentage: number;
  bytes: number;
  state: "inactive" | "active" | "complete" | "error";
  error?: string;
}

async function findPacks(iso: string): Promise<OfflinePack[]> {
  await initOffline();
  const packs = await OfflineManager.getPacks();
  return packs.filter((p) => typeof p.metadata?.key === "string" && String(p.metadata.key).startsWith(`${iso}:`));
}

export async function packStatuses(iso: string): Promise<PackProgress[]> {
  const packs = await findPacks(iso);
  const out: PackProgress[] = [];
  for (const p of packs) {
    try {
      const s = await p.status();
      out.push({
        key: String(p.metadata.key),
        kind: String(p.metadata.kind) as PackKind,
        percentage: s.percentage,
        bytes: s.completedResourceSize,
        state: s.state,
      });
    } catch {}
  }
  return out;
}

/** Startet bzw. setzt die Downloads für ein Land fort. */
export async function startCountryDownload(
  c: CountryOfflineConfig,
  onPack: (p: PackProgress) => void,
  onObstacles: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<void> {
  await initOffline();
  const list = (await loadOfflineConfigs()).filter((x) => x.iso !== c.iso);
  await saveOfflineConfigs([...list, c]);

  const existing = await findPacks(c.iso);
  const plans = await plansFor(c);
  const wanted = new Set(plans.map((p) => p.key));

  // nicht mehr gewünschte Pakete entfernen (z. B. Satellit abgewählt)
  for (const p of existing) {
    if (!wanted.has(String(p.metadata.key))) await OfflineManager.deletePack(p.id).catch(() => {});
  }

  const progress = (plan: PackPlan) => (_pack: OfflinePack, s: any) =>
    onPack({ key: plan.key, kind: plan.kind, percentage: s.percentage, bytes: s.completedResourceSize, state: s.state });
  const error = (plan: PackPlan) => (_pack: OfflinePack, e: any) =>
    onPack({ key: plan.key, kind: plan.kind, percentage: 0, bytes: 0, state: "error", error: e?.message });

  for (const plan of plans) {
    const have = existing.find((p) => p.metadata.key === plan.key && p.metadata.maxZoom === plan.maxZoom);
    if (have) {
      await OfflineManager.addListener(have.id, progress(plan), error(plan));
      await have.resume().catch(() => {});
      continue;
    }
    const old = existing.find((p) => p.metadata.key === plan.key);
    if (old) await OfflineManager.deletePack(old.id).catch(() => {});
    const stylePath = await writePackStyle(plan);
    await OfflineManager.createPack(
      {
        mapStyle: stylePath.startsWith("file://") ? stylePath : `file://${stylePath}`,
        bounds: plan.bounds,
        minZoom: plan.minZoom,
        maxZoom: plan.maxZoom,
        metadata: { key: plan.key, kind: plan.kind, maxZoom: plan.maxZoom },
      },
      progress(plan),
      error(plan),
    );
  }

  // Hindernisse: Kachel für Kachel, schonend für die OSM-Server
  if (c.obstacles) {
    const p = getMapProvider(c.iso);
    if (p) {
      const tiles = tilesForBounds(...p.bounds, OBSTACLE_TILE_ZOOM);
      let done = 0;
      onObstacles(0, tiles.length);
      for (const t of tiles) {
        if (shouldStop()) break;
        if (!(await hasObstacleTile(t.x, t.y))) {
          await loadObstacleTile(t.x, t.y, { force: true });
          await new Promise((r) => setTimeout(r, 1200));
        }
        done++;
        onObstacles(done, tiles.length);
      }
    }
  }
}

export async function pauseCountryDownload(iso: string): Promise<void> {
  for (const p of await findPacks(iso)) await p.pause().catch(() => {});
}

export async function deleteCountry(iso: string): Promise<void> {
  for (const p of await findPacks(iso)) {
    OfflineManager.removeListener(p.id);
    await OfflineManager.deletePack(p.id).catch(() => {});
  }
  const list = (await loadOfflineConfigs()).filter((x) => x.iso !== iso);
  const prov = getMapProvider(iso);
  if (prov) {
    // Hindernis-Kacheln, die auch zu einem anderen Offline-Land gehören, behalten
    const keep = new Set<string>();
    for (const other of list) {
      const op = getMapProvider(other.iso);
      if (op && other.obstacles) for (const t of tilesForBounds(...op.bounds, OBSTACLE_TILE_ZOOM)) keep.add(`${t.x}_${t.y}`);
    }
    await deleteObstacleTiles(tilesForBounds(...prov.bounds, OBSTACLE_TILE_ZOOM).filter((t) => !keep.has(`${t.x}_${t.y}`)));
  }
  await saveOfflineConfigs(list);
}

export async function obstacleTilesStored(iso: string): Promise<{ done: number; total: number }> {
  const p = getMapProvider(iso);
  if (!p) return { done: 0, total: 0 };
  const tiles = tilesForBounds(...p.bounds, OBSTACLE_TILE_ZOOM);
  let done = 0;
  for (const t of tiles) if (await hasObstacleTile(t.x, t.y)) done++;
  return { done, total: tiles.length };
}
