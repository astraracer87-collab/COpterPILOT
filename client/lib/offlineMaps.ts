/**
 * Offline-Länder: Karten, Luftbilder, Geozonen und Hindernisse eines ganzen
 * Landes auf dem Gerät speichern.
 *
 * Kacheln liegen als Dateien unter documentDirectory/tiles/<hash>/<z>/<x>/<y>,
 * wobei <hash> aus der Kachel-Adresse der Quelle gebildet wird (gleiche
 * Funktion wie in leafletRc.ts). Die Leaflet-Karten schauen dort zuerst nach.
 * Hindernisse werden als Kacheln aus OpenStreetMap geladen (obstacles.ts).
 *
 * Wählbar sind alle Länder der App (OFFLINE_APP_COUNTRIES). Karte/Luftbild nur,
 * wo mapSources.ts eine frei speicherbare amtliche Quelle kennt; Geozonen als
 * Kacheln (WMS/XYZ, z. B. CH/HU), als Vektordatei (ED-269-Gerätecache, z. B.
 * AT/NO/ES; LI über den Schweizer BAZL-Datensatz) oder – für große Länder –
 * als gekachelter Vektor-Speicher (geozoneTiles/: DE dipul-WFS, FR IGN-WFS,
 * CZ ŘLP ED-318); Hindernisse überall.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  OFFLINE_APP_COUNTRIES,
  countryOfflineBounds,
  getMapProvider,
  noOfflineBasemapNote,
  type LngLatBox,
  type RasterDef,
} from "@/lib/mapSources";
import { COUNTRY_GEOZONE_CONFIGS, buildGeozoneTileUrls, getAllDefaultEnabledLayerNames, getAllLayerNames } from "@/lib/geozones";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";
import { detectBundeslandFromCoordinates } from "@/lib/countryMaps";
import { isEd269DirectCountry } from "@/lib/geozoneDirect/ed269Sources";
import { refreshEd269Dataset } from "@/lib/geozoneDirect/ed269Store";
import { GEOZONE_IMPORT_ONLY_ISOS } from "../../shared/geozoneImport";
import { deleteTileStore, downloadTileStore, getTilePartMeta, loadTileStoreMeta } from "@/lib/geozoneTiles/tileStore";
import { TILE_STORE_ATTRIBUTION, isTileStoreIso, type TileStorePart } from "@/lib/geozoneTiles/tileStoreCore";
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
  /** DE: Wohngrundstücke (dipul) im Geozonen-Speicher mitspeichern */
  wohngebiete?: boolean;
}

export const DETAIL_LABELS: Record<DetailLevel, string> = {
  11: "Übersicht (ca. 75 m/Pixel)",
  12: "Grob (ca. 40 m/Pixel)",
  13: "Mittel (ca. 20 m/Pixel)",
  14: "Fein (ca. 10 m/Pixel)",
  15: "Sehr fein (ca. 5 m/Pixel)",
};

const CONFIG_KEY = "@copterpilot/offline_countries";
const LEVELS_KEY = "@copterpilot/offline_tile_levels";
const PROGRESS_KEY = "@copterpilot/offline_progress";
const TILE_ROOT = `${FileSystem.documentDirectory}tiles/`;
const GRID_ZOOM = 10;
const GEOZONE_MIN_ZOOM = 11;
const MAP_MIN_ZOOM = 5;
const SAT_MIN_ZOOM = 8;
const GEO_KB_PER_TILE = 6;
const OBSTACLE_KB_PER_TILE = 120;
/** Vektor-Geozonen (ED-269-Datei eines Landes) – grobe Größe */
const VECTOR_GEO_MB = 3;
/** BAZL-Datei (CH, deckt LI mit ab) ist deutlich größer (~18 MB) */
const VECTOR_GEO_MB_BY_ISO: Record<string, number> = { CH: 18, LI: 18 };
/**
 * Gekachelter Vektor-Speicher (geozoneTiles/): gemessene Gerätegrößen
 * (komprimierte Datensätze + Index), Stand 15.11.2026:
 *   DE dipul-WFS: 72 672 Zonen, 226 MB + 5 MB Index (Download ≈ 204 MB gzip)
 *   DE Wohngrundstücke: 10 791 Zonen, 166 MB + 1 MB (Download ≈ 160 MB gzip)
 *   FR Géoplateforme-WFS: 89 736 Zonen, 103 MB + 7 MB (Download ≈ 79 MB gzip)
 *   CZ ŘLP ED-318: 136 547 Zonen, 73 MB + 9 MB (Download 35 MB ZIP)
 * Aufgerundet für die Speicherplatz-Prüfung.
 */
export const TILE_STORE_MB: Record<string, number> = { DE: 240, FR: 115, CZ: 85 };
export const TILE_STORE_WOHN_MB = 175;
export const TILE_STORE_DOWNLOAD_MB: Record<string, number> = { DE: 205, FR: 80, CZ: 36, DE_WOHN: 160 };
const PARALLEL = 6;

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** FNV-1a, identisch mit hash() in leafletRc.ts */
export function tileSourceHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

function lonToX(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function latToY(lat: number, z: number) {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}
function xToLon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
function yToLat(y: number, z: number) {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}
function bbox3857(x: number, y: number, z: number): string {
  const R = 20037508.342789244;
  const size = (2 * R) / 2 ** z;
  const minx = -R + x * size;
  const maxy = R - y * size;
  return [minx, maxy - size, minx + size, maxy].join(",");
}
function fillTemplate(t: string, x: number, y: number, z: number): string {
  const sub = ["a", "b", "c"][Math.abs(x + y) % 3];
  return t
    .replace(/\{bbox-epsg-3857\}/g, bbox3857(x, y, z))
    .replace(/\{bbox\}/g, bbox3857(x, y, z))
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y))
    .replace(/\{s\}/g, sub)
    .replace(/\{r\}/g, "")
    .replace(/\{width\}/g, "256")
    .replace(/\{height\}/g, "256");
}

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------

// "import": kein Online-Feed erreichbar (RO) – nur per Datei-Import in den ED-269-Gerätecache
export type GeozoneOfflineKind = "tiles" | "vector" | "tilestore" | "import" | "none";

export interface OfflineCountryInfo {
  iso: string;
  label: string;
  bounds: LngLatBox;
  hasMap: boolean;
  hasSatellite: boolean;
  hasGeozones: boolean;
  /** Geozonen als Kacheln (WMS/XYZ), Vektordatei (ED-269-Gerätecache) oder gekachelter Vektor-Speicher */
  geozoneKind: GeozoneOfflineKind;
  /** Quellen-/Lizenzhinweis der Geozonen (Pflicht-Attribution) */
  geozoneAttribution?: { label: string; url?: string };
  /** Hinweis, wenn es keine frei speicherbare Grundkarte gibt */
  note?: string;
}

/** Wie werden die Geozonen eines Landes offline gespeichert? */
export function geozoneOfflineKind(iso: string): GeozoneOfflineKind {
  if (isTileStoreIso(iso)) return "tilestore";
  if (geozoneTemplates(iso).length > 0) return "tiles";
  // Liechtenstein steckt im Schweizer BAZL-Datensatz (ed269Store: li -> ch)
  if (isEd269DirectCountry(iso) || String(iso).toUpperCase() === "LI") return "vector";
  if (GEOZONE_IMPORT_ONLY_ISOS.includes(String(iso).toUpperCase())) return "import";
  return "none";
}

/** Alle Länder der App – jedes ist wählbar (mindestens Hindernisse). */
export function offlineCountries(): OfflineCountryInfo[] {
  const out: OfflineCountryInfo[] = [];
  for (const c of OFFLINE_APP_COUNTRIES) {
    const bounds = countryOfflineBounds(c.iso);
    if (!bounds) continue;
    const p = getMapProvider(c.iso);
    const geozoneKind = geozoneOfflineKind(c.iso);
    const hasMap = !!p?.map;
    out.push({
      iso: c.iso,
      label: c.label,
      bounds,
      hasMap,
      hasSatellite: !!p?.satellite?.length,
      hasGeozones: geozoneKind !== "none",
      geozoneKind,
      geozoneAttribution: isTileStoreIso(c.iso) ? TILE_STORE_ATTRIBUTION[c.iso] : undefined,
      note: hasMap ? undefined : noOfflineBasemapNote(c.label, geozoneKind !== "none"),
    });
  }
  return out;
}

export function defaultConfig(iso: string): CountryOfflineConfig {
  const p = getMapProvider(iso);
  return {
    iso,
    map: !!p?.map,
    mapMaxZoom: 12,
    satellite: false,
    satMaxZoom: 13,
    geozones: geozoneOfflineKind(iso) !== "none",
    geoMaxZoom: 12,
    obstacles: true,
    ...(iso === "DE" ? { wohngebiete: true } : {}),
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
// Für die Karten: welche Quellen liegen bis zu welcher Zoomstufe vor?
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
export function onOfflineTilesChange(l: () => void): () => void {
  listeners.add(l);
  l();
  return () => listeners.delete(l);
}
function notify() {
  listeners.forEach((l) => l());
}

async function loadLevels(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(LEVELS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
async function saveLevels(l: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(LEVELS_KEY, JSON.stringify(l));
  notify();
}

export async function getOfflineTileConfig(): Promise<{ root: string; levels: Record<string, number> }> {
  return { root: TILE_ROOT, levels: await loadLevels() };
}

// ---------------------------------------------------------------------------
// Geozonen-Kacheln (direkte WMS-Adressen, siehe geozoneTileUrl.ts)
// ---------------------------------------------------------------------------

/**
 * Adressen der Geozonen-Kacheln eines Landes (direkte WMS-Vorlagen mit {bbox}),
 * genau so, wie die Karten sie bauen: Standard-Ebenen und alle Ebenen.
 */
function geozoneTemplates(iso: string): string[] {
  const cfg = COUNTRY_GEOZONE_CONFIGS[iso];
  if (!cfg) return [];
  try {
    const urls = new Set<string>();
    const def = getAllDefaultEnabledLayerNames(iso);
    for (const layers of [def.length ? def : [cfg.layers[0]?.wmsLayer].filter(Boolean) as string[], getAllLayerNames(iso)]) {
      for (const u of buildGeozoneTileUrls(layers, iso)) if (/^https?:/.test(u)) urls.add(u);
    }
    return [...urls];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Größen-Abschätzung
// ---------------------------------------------------------------------------

export function tileCount(b: LngLatBox, minZ: number, maxZ: number): number {
  let n = 0;
  for (let z = minZ; z <= maxZ; z++) {
    n += (lonToX(b[2], z) - lonToX(b[0], z) + 1) * (latToY(b[1], z) - latToY(b[3], z) + 1);
  }
  return n;
}

/** Ländergrenzen sind keine Rechtecke: grob 65 % des Rechtecks liegen im Land */
const LAND_SHARE = 0.65;

export interface SizeEstimate {
  mapMB: number;
  satMB: number;
  /** Geozonen gesamt (DE inkl. Wohngebiete, falls gewählt) */
  geoMB: number;
  /** davon DE-Wohngrundstücke */
  wohnMB: number;
  obstaclesMB: number;
  totalMB: number;
}

export function estimateSize(c: CountryOfflineConfig): SizeEstimate {
  const p = getMapProvider(c.iso);
  const bounds = countryOfflineBounds(c.iso);
  const mb = (tiles: number, kb: number, share = LAND_SHARE) => (tiles * share * kb) / 1024;
  let mapMB = 0;
  let satMB = 0;
  let geoMB = 0;
  let wohnMB = 0;
  let obstaclesMB = 0;
  if (c.map && p?.map) {
    mapMB = mb(tileCount(p.map.bounds, Math.max(MAP_MIN_ZOOM, p.map.minzoom ?? 0), Math.min(c.mapMaxZoom, p.map.maxzoom)), p.map.kbPerTile);
  }
  if (c.satellite && p?.satellite) {
    for (const s of p.satellite) {
      satMB += mb(tileCount(s.bounds, Math.max(SAT_MIN_ZOOM, s.minzoom ?? 0), Math.min(c.satMaxZoom, s.maxzoom)), s.kbPerTile);
    }
  }
  if (c.geozones && bounds) {
    const kind = geozoneOfflineKind(c.iso);
    if (kind === "tiles") geoMB = mb(tileCount(bounds, GEOZONE_MIN_ZOOM, c.geoMaxZoom), GEO_KB_PER_TILE) * geozoneTemplates(c.iso).length;
    else if (kind === "vector") geoMB = VECTOR_GEO_MB_BY_ISO[c.iso] ?? VECTOR_GEO_MB;
    else if (kind === "tilestore") {
      geoMB = TILE_STORE_MB[c.iso] ?? 0;
      if (c.iso === "DE" && c.wohngebiete !== false) {
        wohnMB = TILE_STORE_WOHN_MB;
        geoMB += wohnMB;
      }
    }
  }
  if (c.obstacles && bounds) obstaclesMB = (tilesForBounds(...bounds).length * LAND_SHARE * OBSTACLE_KB_PER_TILE) / 1024;
  return { mapMB, satMB, geoMB, wohnMB, obstaclesMB, totalMB: mapMB + satMB + geoMB + obstaclesMB };
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
// Download-Planung
// ---------------------------------------------------------------------------

type PackKind = "map" | "sat" | "geo";

/** Fortschritts-Schlüssel der Vektor-Geozonen (keine Kacheln) */
const vectorGeoKey = (iso: string) => `${iso}:geo:vector`;
const VECTOR_TEMPLATE_PREFIX = "ed269:";
/** Gekachelter Vektor-Speicher: `${iso}:geo:store` bzw. `DE:geo:wohn` */
const storeGeoKey = (iso: string, part: TileStorePart) => `${iso}:geo:${part === "base" ? "store" : "wohn"}`;
const STORE_TEMPLATE_PREFIX = "tilestore:";

interface PackPlan {
  key: string;
  kind: PackKind;
  template: string;
  bounds: LngLatBox;
  minZoom: number;
  maxZoom: number;
  /** Zoom-10-Zelle gehört dazu? (Land bzw. Bundesland) */
  cellFilter: (iso: string, region: string) => boolean;
}

const cellCache = new Map<string, { iso: string; region: string; border: boolean }>();
function cellInfo(x: number, y: number) {
  const k = `${x}_${y}`;
  const hit = cellCache.get(k);
  if (hit) return hit;
  let iso = "";
  let region = "";
  let border = false;
  let first = true;
  for (const fx of [0.05, 0.5, 0.95]) {
    for (const fy of [0.05, 0.5, 0.95]) {
      const lat = yToLat(y + fy, GRID_ZOOM);
      const lon = xToLon(x + fx, GRID_ZOOM);
      const i = detectCountryFromCoordinates(lat, lon) ?? "";
      const r = i === "DE" ? detectBundeslandFromCoordinates(lat, lon) ?? "" : "";
      if (first) {
        iso = i;
        region = r;
        first = false;
      } else if (i !== iso || r !== region) {
        border = true;
      }
    }
  }
  const out = { iso, region, border };
  cellCache.set(k, out);
  return out;
}

function plansFor(c: CountryOfflineConfig): PackPlan[] {
  const p = getMapProvider(c.iso);
  const bounds = countryOfflineBounds(c.iso);
  if (!bounds) return [];
  const plans: PackPlan[] = [];
  const inCountry = (iso: string) => iso === c.iso;
  if (c.map && p?.map) {
    plans.push({
      key: `${c.iso}:map`,
      kind: "map",
      template: p.map.tiles,
      bounds: p.map.bounds,
      minZoom: Math.max(MAP_MIN_ZOOM, p.map.minzoom ?? 0),
      maxZoom: Math.min(c.mapMaxZoom, p.map.maxzoom),
      cellFilter: inCountry,
    });
  }
  if (c.satellite && p?.satellite) {
    for (const s of p.satellite as RasterDef[]) {
      plans.push({
        key: `${c.iso}:sat:${s.id}`,
        kind: "sat",
        template: s.tiles,
        bounds: s.bounds,
        minZoom: Math.max(SAT_MIN_ZOOM, s.minzoom ?? 0),
        maxZoom: Math.min(c.satMaxZoom, s.maxzoom),
        cellFilter: (iso, region) => iso === c.iso && (!s.region || region === s.region),
      });
    }
  }
  if (c.geozones && geozoneOfflineKind(c.iso) === "tiles") {
    geozoneTemplates(c.iso).forEach((t, i) => {
      plans.push({
        key: `${c.iso}:geo:${i}`,
        kind: "geo",
        template: t,
        bounds,
        minZoom: GEOZONE_MIN_ZOOM,
        maxZoom: c.geoMaxZoom,
        cellFilter: inCountry,
      });
    });
  }
  return plans;
}

/** Alle Kacheln eines Plans in fester Reihenfolge (für Fortsetzen) */
function* planTiles(plan: PackPlan): Generator<[number, number, number]> {
  const [w, s, e, n] = plan.bounds;
  for (let z = plan.minZoom; z <= plan.maxZoom; z++) {
    const x0 = lonToX(w, z);
    const x1 = lonToX(e, z);
    const y0 = latToY(n, z);
    const y1 = latToY(s, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (z >= GRID_ZOOM) {
          const d = 2 ** (z - GRID_ZOOM);
          const cell = cellInfo(Math.floor(x / d), Math.floor(y / d));
          if (!cell.border && !plan.cellFilter(cell.iso, cell.region)) continue;
        }
        yield [z, x, y];
      }
    }
  }
}

function planTileCount(plan: PackPlan): number {
  let n = 0;
  for (const _ of planTiles(plan)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Fortschritt
// ---------------------------------------------------------------------------

export interface PackProgress {
  key: string;
  kind: PackKind;
  percentage: number;
  bytes: number;
  state: "inactive" | "active" | "complete" | "error";
  error?: string;
}

type StoredProgress = Record<string, { done: number; total: number; bytes: number; maxZoom: number; template: string }>;

async function loadProgress(): Promise<StoredProgress> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
async function saveProgress(p: StoredProgress): Promise<void> {
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
}

export async function packStatuses(iso: string): Promise<PackProgress[]> {
  const prog = await loadProgress();
  if (isTileStoreIso(iso)) await loadTileStoreMeta().catch(() => {});
  return Object.entries(prog)
    .filter(([k]) => k.startsWith(`${iso}:`))
    .map(([k, v]) => {
      // Vektor-Speicher: maßgeblich ist der tatsächlich gespeicherte Bestand
      if (v.template.startsWith(STORE_TEMPLATE_PREFIX)) {
        const part = v.template.split(":")[2] as TileStorePart;
        const meta = getTilePartMeta(iso, part);
        if (meta?.complete) {
          return { key: k, kind: "geo" as PackKind, percentage: 100, bytes: meta.dataBytes, state: "complete" as const };
        }
        const pct = v.total ? Math.min(99, (v.done / v.total) * 100) : 0;
        return { key: k, kind: "geo" as PackKind, percentage: pct, bytes: v.bytes, state: "inactive" as const };
      }
      return {
        key: k,
        kind: k.split(":")[1] as PackKind,
        percentage: v.total ? Math.min(100, (v.done / v.total) * 100) : 0,
        bytes: v.bytes,
        state: v.total && v.done >= v.total ? ("complete" as const) : ("inactive" as const),
      };
    });
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

const madeDirs = new Set<string>();
async function ensureDir(dir: string) {
  if (madeDirs.has(dir)) return;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  madeDirs.add(dir);
}

async function downloadTile(template: string, hash: string, z: number, x: number, y: number): Promise<number> {
  const dir = `${TILE_ROOT}${hash}/${z}/${x}/`;
  const path = `${dir}${y}`;
  const info = await FileSystem.getInfoAsync(path);
  if (info.exists) return 0;
  await ensureDir(dir);
  const res = await FileSystem.downloadAsync(fillTemplate(template, x, y, z), path, {
    headers: { "User-Agent": "COpterPilot-RC/1.0" },
  });
  if (res.status !== 200) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    return 0;
  }
  const after = await FileSystem.getInfoAsync(path);
  return after.exists && "size" in after ? after.size ?? 0 : 0;
}

/** Startet bzw. setzt die Downloads für ein Land fort. */
/** Wird die Kachel-Adresse noch von einem anderen Paket benutzt (z. B. LI = CH)? */
function templateUsedElsewhere(progress: StoredProgress, ownKey: string, template: string): boolean {
  return Object.entries(progress).some(([k, v]) => k !== ownKey && v.template === template);
}

/** Kachel-Ordner eines Pakets löschen – außer andere Pakete teilen ihn. */
async function dropPack(progress: StoredProgress, levels: Record<string, number>, key: string): Promise<void> {
  const tpl = progress[key]?.template ?? "";
  if (tpl.startsWith(STORE_TEMPLATE_PREFIX)) {
    const [, iso, part] = tpl.split(":");
    await deleteTileStore(iso, part as TileStorePart).catch(() => {});
    delete progress[key];
    return;
  }
  if (tpl && !tpl.startsWith(VECTOR_TEMPLATE_PREFIX) && !templateUsedElsewhere(progress, key, tpl)) {
    const h = tileSourceHash(tpl);
    await FileSystem.deleteAsync(`${TILE_ROOT}${h}/`, { idempotent: true }).catch(() => {});
    delete levels[h];
  }
  delete progress[key];
}

export async function startCountryDownload(
  c: CountryOfflineConfig,
  onPack: (p: PackProgress) => void,
  onObstacles: (done: number, total: number) => void,
  shouldStop: () => boolean,
): Promise<void> {
  const list = (await loadOfflineConfigs()).filter((x) => x.iso !== c.iso);
  await saveOfflineConfigs([...list, c]);

  const plans = plansFor(c);
  const vectorGeo = c.geozones && geozoneOfflineKind(c.iso) === "vector";
  const storeGeo = c.geozones && geozoneOfflineKind(c.iso) === "tilestore";
  const storeParts: TileStorePart[] = storeGeo ? (c.iso === "DE" && c.wohngebiete !== false ? ["base", "wohn"] : ["base"]) : [];
  const wanted = new Set(plans.map((p) => p.key));
  if (vectorGeo) wanted.add(vectorGeoKey(c.iso));
  for (const part of storeParts) wanted.add(storeGeoKey(c.iso, part));
  const progress = await loadProgress();
  const levels = await loadLevels();

  // abgewählte Teile entfernen
  for (const key of Object.keys(progress)) {
    if (key.startsWith(`${c.iso}:`) && !wanted.has(key)) await dropPack(progress, levels, key);
  }
  await saveProgress(progress);
  await saveLevels(levels);

  // Vektor-Geozonen (ED-269): ganze Landesdatei in den Gerätecache laden
  if (vectorGeo && !shouldStop()) {
    const key = vectorGeoKey(c.iso);
    onPack({ key, kind: "geo", percentage: 0, bytes: 0, state: "active" });
    const ok = await refreshEd269Dataset(c.iso).catch(() => false);
    if (ok) {
      progress[key] = { done: 1, total: 1, bytes: 0, maxZoom: 0, template: VECTOR_TEMPLATE_PREFIX + c.iso };
      await saveProgress(progress);
      onPack({ key, kind: "geo", percentage: 100, bytes: 0, state: "complete" });
    } else {
      onPack({
        key,
        kind: "geo",
        percentage: progress[key] ? 100 : 0,
        bytes: 0,
        state: "error",
        error: c.iso === "IT" ? "d-flight-Zugang fehlt oder Anmeldung fehlgeschlagen" : "Geozonen konnten nicht geladen werden",
      });
    }
  }

  // Gekachelter Vektor-Speicher (DE/FR/CZ): alle Zonen des Landes
  if (storeParts.length > 0 && !shouldStop()) {
    const failed = await downloadStorePacks(c, storeParts, progress, onPack, shouldStop);
    if (failed) return;
  }

  for (const plan of plans) {
    if (shouldStop()) break;
    const hash = tileSourceHash(plan.template);
    let st = progress[plan.key];
    if (!st || st.maxZoom !== plan.maxZoom || st.template !== plan.template) {
      st = { done: 0, total: planTileCount(plan), bytes: st?.bytes ?? 0, maxZoom: plan.maxZoom, template: plan.template };
      progress[plan.key] = st;
    }
    // Karte darf die Kacheln ab sofort vom Gerät lesen
    levels[hash] = Math.max(levels[hash] ?? 0, plan.maxZoom);
    await saveLevels(levels);

    const report = (state: PackProgress["state"], error?: string) =>
      onPack({ key: plan.key, kind: plan.kind, percentage: st.total ? (st.done / st.total) * 100 : 100, bytes: st.bytes, state, error });
    report("active");

    const it = planTiles(plan);
    // bereits erledigte Kacheln überspringen
    for (let i = 0; i < st.done; i++) if (it.next().done) break;

    let lastSave = Date.now();
    let failures = 0;
    const worker = async () => {
      while (!shouldStop()) {
        const next = it.next();
        if (next.done) return;
        const [z, x, y] = next.value;
        try {
          st.bytes += await downloadTile(plan.template, hash, z, x, y);
          failures = 0;
        } catch {
          failures++;
          if (failures > 30) throw new Error("Zu viele Fehler – Internetverbindung prüfen");
        }
        st.done++;
        if (Date.now() - lastSave > 1500) {
          lastSave = Date.now();
          await saveProgress(progress);
          report("active");
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      await saveProgress(progress);
      report(st.done >= st.total ? "complete" : "inactive");
    } catch (e: any) {
      await saveProgress(progress);
      report("error", e?.message);
      return;
    }
  }

  // Hindernisse: Kachel für Kachel, schonend für die OSM-Server
  if (c.obstacles && !shouldStop()) {
    const bounds = countryOfflineBounds(c.iso);
    if (bounds) {
      const tiles = tilesForBounds(...bounds, OBSTACLE_TILE_ZOOM);
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

/** Lädt die Teile des Vektor-Speichers; true bei Fehler (Download abbrechen). */
async function downloadStorePacks(
  c: CountryOfflineConfig,
  parts: TileStorePart[],
  progress: StoredProgress,
  onPack: (p: PackProgress) => void,
  shouldStop: () => boolean,
): Promise<boolean> {
  const results = await downloadTileStore(c.iso, {
    wohn: parts.includes("wohn"),
    shouldStop,
    onProgress: (p) => {
      const key = storeGeoKey(c.iso, p.part);
      const total = Math.max(1, p.total);
      progress[key] = { done: p.state === "complete" ? total : p.done, total, bytes: p.bytes, maxZoom: 0, template: `${STORE_TEMPLATE_PREFIX}${c.iso}:${p.part}` };
      onPack({
        key,
        kind: "geo",
        percentage: p.state === "complete" ? 100 : (p.done / total) * 100,
        bytes: p.bytes,
        state: p.state,
        error: p.error,
      });
    },
  });
  await saveProgress(progress);
  return results.some((r) => r.state === "error");
}

export async function pauseCountryDownload(_iso: string): Promise<void> {
  // Der Download prüft shouldStop(); hier nichts weiter zu tun.
}

export async function deleteCountry(iso: string): Promise<void> {
  const progress = await loadProgress();
  const levels = await loadLevels();
  for (const key of Object.keys(progress)) {
    if (key.startsWith(`${iso}:`)) await dropPack(progress, levels, key);
  }
  await saveProgress(progress);
  await saveLevels(levels);
  if (isTileStoreIso(iso)) await deleteTileStore(iso).catch(() => {});

  const list = (await loadOfflineConfigs()).filter((x) => x.iso !== iso);
  const bounds = countryOfflineBounds(iso);
  if (bounds) {
    // Hindernis-Kacheln, die auch zu einem anderen Offline-Land gehören, behalten
    const keep = new Set<string>();
    for (const other of list) {
      const ob = countryOfflineBounds(other.iso);
      if (ob && other.obstacles) for (const t of tilesForBounds(...ob, OBSTACLE_TILE_ZOOM)) keep.add(`${t.x}_${t.y}`);
    }
    await deleteObstacleTiles(tilesForBounds(...bounds, OBSTACLE_TILE_ZOOM).filter((t) => !keep.has(`${t.x}_${t.y}`)));
  }
  await saveOfflineConfigs(list);
}

export async function obstacleTilesStored(iso: string): Promise<{ done: number; total: number }> {
  const bounds = countryOfflineBounds(iso);
  if (!bounds) return { done: 0, total: 0 };
  const tiles = tilesForBounds(...bounds, OBSTACLE_TILE_ZOOM);
  let done = 0;
  for (const t of tiles) if (await hasObstacleTile(t.x, t.y)) done++;
  return { done, total: tiles.length };
}
