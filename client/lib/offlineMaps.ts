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
import { loadStoredEd269Dataset, refreshEd269Dataset, storedEd269Bytes } from "@/lib/geozoneDirect/ed269Store";
import { getGeozoneSourceMeta, resolveGeozoneSourceIso } from "../../shared/geozoneSourceMeta";
import { getGeozoneSource } from "@/lib/geozoneSources/registry";
import { deleteTileStore, downloadTileStore, getTilePartMeta, loadTileStoreMeta } from "@/lib/geozoneTiles/tileStore";
import { isTileStoreIso, type TileStorePart } from "@/lib/geozoneTiles/tileStoreCore";
import { OBSTACLE_TILE_ZOOM, deleteObstacleTiles, hasObstacleTile, loadObstacleTile, tilesForBounds } from "@/lib/obstacles";
import { revalidateGeozoneSources } from "@/lib/geozoneSources/revalidate";
import type { OfflineSyncCountryResult, OfflineSyncProgress } from "@/lib/countryUsageData";
import { USAGE_ALIASES, USAGE_LABEL_OVERRIDES, usageIsoOf } from "@/lib/countryUsage";
import { beginDownload, endDownload, progressDownload } from "@/lib/downloadActivity";
import { shouldYield, yieldToUi } from "../../shared/yieldingWork";

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
  /** ES: Infrastruktur-Zonen (ENAIRE Infra, sehr groß) mitspeichern */
  esInfra?: boolean;
  /** ES: Naturschutzgebiete (ENAIRE ENP, sehr groß) mitspeichern */
  esEnp?: boolean;
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
/**
 * Typische Größen der ED-269-Landesdateien (Gerätecache, unkomprimiertes
 * JSON), soweit deutlich über dem Standardwert – Stand 15.11.2026 laut
 * Quellen-Kommentaren in geozoneDirect/: CH BAZL ≈ 18 MB (deckt LI ab),
 * NL GoDrone ≈ 23 MB, LV ≈ 13 MB, HR ≈ 3,7 MB, PL PANSA-JSON /v1/zones ≈ 7,6 MB
 * Rohdaten (+ deutsche Meldungen, geschätzt ≈ 10 MB), MT iDronect ≈ 0,4 MB.
 * Alle übrigen ED-269-Länder liegen bei ≤ 3 MB (FI ≈ 1,7 MB, GB-KML ≈ 2 MB, …)
 * → VECTOR_GEO_MB.
 */
export const VECTOR_GEO_MB_BY_ISO: Record<string, number> = { CH: 18, LI: 18, NL: 23, LV: 13, HR: 4, PL: 10, MT: 1 };
/**
 * Gekachelter Vektor-Speicher (geozoneTiles/): gemessene Gerätegrößen
 * (komprimierte Datensätze + Index), Stand 15.11.2026:
 *   DE dipul-WFS: 72 672 Zonen, 226 MB + 5 MB Index (Download ≈ 204 MB gzip)
 *   DE Wohngrundstücke: 10 791 Zonen, 166 MB + 1 MB (Download ≈ 160 MB gzip)
 *   FR Géoplateforme-WFS: 89 736 Zonen, 103 MB + 7 MB (Download ≈ 79 MB gzip)
 *   CZ ŘLP ED-318: 136 547 Zonen, 73 MB + 9 MB (Download 35 MB ZIP)
 * Aufgerundet für die Speicherplatz-Prüfung.
 *
 * ES (ENAIRE insignias, GeoJSON ungekürzt, Stand 15.11.2026 laut Abruf von
 * DE-IP) – SCHÄTZUNG, auf dem Gerät nicht gemessen; komprimiert ≈ 40 %:
 *   Luftfahrt + Urbano (Aero 1,2,3,4,6,10 + Urbano 11): ≈ 2 600 Zonen, ≈ 22 MB JSON
 *   Infrastruktur (Infra 11): 14 163 Zonen, ≈ 177 MB JSON
 *   Naturschutz (ENP 0 + 1): 1 814 + 1 321 Zonen, ≈ 221 MB + ≈ 160 MB (Layer 1 geschätzt)
 */
export const TILE_STORE_MB: Record<string, number> = { DE: 240, FR: 115, CZ: 85, ES: 10 };
export const TILE_STORE_WOHN_MB = 175;
/** ES-Zusatzteile (geschätzte Gerätegröße) */
export const TILE_STORE_ES_PART_MB: Record<"infra" | "enp", number> = { infra: 75, enp: 160 };
export const TILE_STORE_DOWNLOAD_MB: Record<string, number> = {
  DE: 205, FR: 80, CZ: 36, DE_WOHN: 160, ES: 23, ES_INFRA: 177, ES_ENP: 380,
};
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

// "import": kein Online-Feed erreichbar (GR) – nur per Datei-Import in den ED-269-Gerätecache
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

/**
 * Wie werden die Geozonen eines Landes offline gespeichert? Offline-Strategie
 * aus der Quellen-Registry (Aliase wie LI → CH-Datensatz aufgelöst); Länder
 * mit WMS-/XYZ-Kacheln speichern zusätzlich bzw. stattdessen die Kacheln.
 */
export function geozoneOfflineKind(iso: string): GeozoneOfflineKind {
  const offline = getGeozoneSourceMeta(iso)?.offline;
  if (offline === "tile-store") return "tilestore";
  // Import-Länder (GR): nur Datei-Import. GR-Bildkacheln sind zeitgefiltert
  // (heute..morgen) und werden bewusst nicht offline gespeichert.
  if (offline === "import") return "import";
  if (geozoneTemplates(iso).length > 0) return "tiles";
  if (offline === "ed269-store") return "vector";
  return "none";
}

/**
 * Alle Länder der Einstellung – jedes ist wählbar (mindestens Hindernisse).
 * Liechtenstein hat keinen eigenen Eintrag: es steckt in „Schweiz /
 * Liechtenstein“ (gleiche Daten; die CH-Pakete decken LI mit ab).
 */
export function offlineCountries(): OfflineCountryInfo[] {
  const out: OfflineCountryInfo[] = [];
  for (const raw of OFFLINE_APP_COUNTRIES) {
    if (USAGE_ALIASES[raw.iso]) continue;
    const c = { iso: raw.iso, label: USAGE_LABEL_OVERRIDES[raw.iso] ?? raw.label };
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
      geozoneAttribution: getGeozoneSource(c.iso)?.tileAttribution,
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
    // ES: beide Zusatzteile standardmäßig an (sonst offline nicht geprüft), abwählbar
    ...(iso === "ES" ? { esInfra: true, esEnp: true } : {}),
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
  /** ES: Infrastruktur- bzw. Naturschutz-Teil */
  esInfraMB: number;
  esEnpMB: number;
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
  let esInfraMB = 0;
  let esEnpMB = 0;
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
      if (c.iso === "ES") {
        if (c.esInfra !== false) esInfraMB = TILE_STORE_ES_PART_MB.infra;
        if (c.esEnp !== false) esEnpMB = TILE_STORE_ES_PART_MB.enp;
        geoMB += esInfraMB + esEnpMB;
      }
    }
  }
  if (c.obstacles && bounds) obstaclesMB = (tilesForBounds(...bounds).length * LAND_SHARE * OBSTACLE_KB_PER_TILE) / 1024;
  return { mapMB, satMB, geoMB, wohnMB, esInfraMB, esEnpMB, obstaclesMB, totalMB: mapMB + satMB + geoMB + obstaclesMB };
}

/**
 * Basis-Geozonen eines Landes (= was „Online“ lädt und hält): ED-269-
 * Landesdatei bzw. Teil „base“ des Kachelspeichers. 0 bei Ländern ohne
 * speicherbaren Bestand (nur Bildkacheln/live oder nur Datei-Import).
 */
export function estimateBaseGeozonesMB(iso: string): number {
  const offline = getGeozoneSourceMeta(iso)?.offline;
  const src = resolveGeozoneSourceIso(iso);
  if (offline === "tile-store") return TILE_STORE_MB[src] ?? TILE_STORE_MB[iso] ?? 0;
  if (offline === "ed269-store") return VECTOR_GEO_MB_BY_ISO[iso] ?? VECTOR_GEO_MB_BY_ISO[src] ?? VECTOR_GEO_MB;
  return 0;
}

export interface UsageSizeEstimate {
  /** „Online“: nur Basis-Geozonen */
  onlineMB: number;
  /** „Offline“: Basis + Karte/Luftbild/Geozonen-Bildkacheln/Hindernisse/Zusatzteile laut Konfiguration */
  offlineMB: number;
}

/**
 * Geschätzter Speicherbedarf je Nutzungsstufe, bevor sie gewählt wird.
 * `c` = aktuelle Paket-Optionen des Landes (bzw. defaultConfig, solange
 * keine gewählt sind). Die Basis zählt bei „Offline“ immer (sie wird für
 * jedes aktive Land gehalten), auch wenn „Geozonen“ abgewählt ist.
 */
export function estimateUsageSizes(c: CountryOfflineConfig): UsageSizeEstimate {
  const base = estimateBaseGeozonesMB(c.iso);
  const est = estimateSize(c);
  const kind = geozoneOfflineKind(c.iso);
  // Geozonen-Anteil über die Basis hinaus: Bildkacheln (WMS/XYZ) bzw. Zusatzteile des Kachelspeichers
  const geoExtras = kind === "tiles" ? est.geoMB : kind === "tilestore" ? est.wohnMB + est.esInfraMB + est.esEnpMB : 0;
  return { onlineMB: base, offlineMB: base + est.mapMB + est.satMB + est.obstaclesMB + geoExtras };
}

/** „Online ≈ 205 MB · Offline ≈ 1,1 GB“ (Länder ohne Basis: „Online: kein Download“) */
export function formatUsageSizes(s: UsageSizeEstimate): string {
  const online = s.onlineMB > 0 ? `Online ≈ ${formatMB(s.onlineMB)}` : "Online: kein Download";
  return `${online} · Offline ≈ ${formatMB(s.offlineMB)}`;
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
/** Gekachelter Vektor-Speicher: `${iso}:geo:store` bzw. `DE:geo:wohn`, `ES:geo:infra`, `ES:geo:enp` */
const storeGeoKey = (iso: string, part: TileStorePart) => `${iso}:geo:${part === "base" ? "store" : part}`;

/** Gewählte Teile des Vektor-Speichers ("base" + Zusatzteile laut Konfiguration). */
export function storePartsFor(c: CountryOfflineConfig): TileStorePart[] {
  if (c.iso === "DE") return c.wohngebiete !== false ? ["base", "wohn"] : ["base"];
  if (c.iso === "ES") {
    const parts: TileStorePart[] = ["base"];
    if (c.esInfra !== false) parts.push("infra");
    if (c.esEnp !== false) parts.push("enp");
    return parts;
  }
  return ["base"];
}
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
  // CH-Pakete decken Liechtenstein mit ab (LI folgt CH)
  const inCountry = (iso: string) => usageIsoOf(iso) === usageIsoOf(c.iso);
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
        cellFilter: (iso, region) => inCountry(iso) && (!s.region || region === s.region),
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

/** Kachelzahl eines Plans – bei großen Ländern Hunderttausende: in Zeitscheiben zählen. */
async function planTileCount(plan: PackPlan): Promise<number> {
  let n = 0;
  for (const _ of planTiles(plan)) {
    n++;
    if ((n & 1023) === 0 && shouldYield()) await yieldToUi("offline-plan");
  }
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

export interface CountryDownloadOptions {
  /**
   * Automatische Synchronisation (Länder-Nutzung „offline“): ED-269-Bestand
   * nur bei Bedarf (Teil-A-Regeln) statt erzwungen, Kachelspeicher nur
   * fehlende Teile bzw. Versionsprüfung, große Pakete (Kacheln, Hindernisse,
   * Kachelspeicher) nur mit `allowLarge` (WLAN bzw. Erlaubnis mobile Daten).
   */
  auto?: boolean;
  allowLarge?: boolean;
  /**
   * Länder-Nutzung „online“: nur die Basis-Geozonen (ED-269-Landesdatei bzw.
   * Kachelspeicher „base“) laden; keine Konfiguration speichern, nichts
   * anderes löschen.
   */
  baseOnly?: boolean;
}

export interface CountryDownloadSummary {
  /** Etwas Großes wartet auf WLAN */
  pendingWifi: boolean;
  failed: boolean;
  /** Neue Daten geladen */
  updated: boolean;
}

/** Länder mit laufendem Download (Einstellungen oder automatische Synchronisation). */
const activeDownloads = new Set<string>();
export function isCountryDownloadRunning(iso: string): boolean {
  return activeDownloads.has(iso.toUpperCase());
}

/** Startet bzw. setzt die Downloads für ein Land fort. */
export async function startCountryDownload(
  c: CountryOfflineConfig,
  onPack: (p: PackProgress) => void,
  onObstacles: (done: number, total: number) => void,
  shouldStop: () => boolean,
  opts: CountryDownloadOptions = {},
): Promise<CountryDownloadSummary> {
  const iso = c.iso.toUpperCase();
  activeDownloads.add(iso);
  try {
    return await runCountryDownload(c, onPack, onObstacles, shouldStop, opts);
  } finally {
    activeDownloads.delete(iso);
  }
}

async function runCountryDownload(
  c: CountryOfflineConfig,
  onPack: (p: PackProgress) => void,
  onObstacles: (done: number, total: number) => void,
  shouldStop: () => boolean,
  opts: CountryDownloadOptions,
): Promise<CountryDownloadSummary> {
  const summary: CountryDownloadSummary = { pendingWifi: false, failed: false, updated: false };
  const auto = opts.auto === true;
  const allowLarge = !auto || opts.allowLarge === true;
  const baseOnly = opts.baseOnly === true;
  if (!baseOnly) {
    const list = (await loadOfflineConfigs()).filter((x) => x.iso !== c.iso);
    await saveOfflineConfigs([...list, c]);
  }

  const plans = baseOnly ? [] : plansFor(c);
  // ED-269-Landesdatei auch bei Ländern, die zusätzlich Geozonen-Bildkacheln
  // speichern (CH inkl. LI, NL …): sie ist die Basis der automatischen Prüfung.
  const vectorGeo = c.geozones && getGeozoneSourceMeta(c.iso)?.offline === "ed269-store";
  const storeGeo = c.geozones && geozoneOfflineKind(c.iso) === "tilestore";
  const storeParts: TileStorePart[] = storeGeo ? (baseOnly ? ["base"] : storePartsFor(c)) : [];
  const wanted = new Set(plans.map((p) => p.key));
  if (vectorGeo) wanted.add(vectorGeoKey(c.iso));
  for (const part of storeParts) wanted.add(storeGeoKey(c.iso, part));
  const progress = await loadProgress();
  const levels = await loadLevels();

  // abgewählte Teile entfernen (nicht im Basis-Modus: dort wird nur ergänzt)
  if (!baseOnly) {
    for (const key of Object.keys(progress)) {
      if (key.startsWith(`${c.iso}:`) && !wanted.has(key)) await dropPack(progress, levels, key);
    }
    await saveProgress(progress);
    await saveLevels(levels);
  }

  // Vektor-Geozonen (ED-269): ganze Landesdatei in den Gerätecache laden
  if (vectorGeo && !shouldStop()) {
    const key = vectorGeoKey(c.iso);
    onPack({ key, kind: "geo", percentage: progress[key] ? 100 : 0, bytes: 0, state: "active" });
    let ok: boolean;
    let pending = false;
    if (auto) {
      // Teil-A-Regeln: nur laden, wenn älter als maxAgeMs bzw. fehlend; großer Feed (NL) nur im WLAN
      const [r] = await revalidateGeozoneSources([c.iso], "map").catch(() => [{ iso: c.iso, action: "refresh-failed" as const }]);
      const action = r?.action;
      ok = action === "fresh" || action === "refreshed" || action === "import-only";
      pending = action === "pending-wifi";
      if (action === "refreshed") summary.updated = true;
      if (pending) summary.pendingWifi = true;
    } else {
      ok = await refreshEd269Dataset(c.iso).catch(() => false);
      if (ok) summary.updated = true;
    }
    if (ok || (pending && progress[key])) {
      progress[key] = { done: 1, total: 1, bytes: 0, maxZoom: 0, template: VECTOR_TEMPLATE_PREFIX + c.iso };
      await saveProgress(progress);
      onPack({ key, kind: "geo", percentage: 100, bytes: 0, state: "complete" });
    } else if (pending) {
      onPack({ key, kind: "geo", percentage: 0, bytes: 0, state: "inactive", error: "wartet auf WLAN" });
    } else {
      summary.failed = true;
      onPack({
        key,
        kind: "geo",
        percentage: progress[key] ? 100 : 0,
        bytes: 0,
        state: "error",
        error: getGeozoneSourceMeta(c.iso)?.accessGate === "login"
          ? getGeozoneSourceMeta(c.iso)?.accessHint ?? "Zugang fehlt oder Anmeldung fehlgeschlagen"
          : "Geozonen konnten nicht geladen werden",
      });
    }
  }

  // Gekachelter Vektor-Speicher (DE/FR/CZ/ES): alle Zonen des Landes
  if (storeParts.length > 0 && !shouldStop()) {
    await loadTileStoreMeta().catch(() => {});
    const missing = storeParts.filter((p) => getTilePartMeta(c.iso, p)?.complete !== true);
    if (auto && missing.length === 0) {
      // vorhandener Bestand: günstige Versionsprüfung, Download nur im WLAN bzw. mit Erlaubnis
      const [r] = await revalidateGeozoneSources([c.iso], "map").catch(() => []);
      if (r?.action === "pack-updated") summary.updated = true;
      if (r?.action === "pending-wifi") summary.pendingWifi = true;
      if (r?.action === "refresh-failed") summary.failed = true;
      for (const part of storeParts) {
        const meta = getTilePartMeta(c.iso, part);
        if (meta?.complete) onPack({ key: storeGeoKey(c.iso, part), kind: "geo", percentage: 100, bytes: meta.dataBytes, state: "complete" });
      }
    } else if (!allowLarge) {
      summary.pendingWifi = true;
      for (const part of missing) {
        onPack({ key: storeGeoKey(c.iso, part), kind: "geo", percentage: 0, bytes: 0, state: "inactive", error: "wartet auf WLAN" });
      }
    } else {
      const failed = await downloadStorePacks(c, storeParts, progress, onPack, shouldStop);
      if (failed) {
        summary.failed = true;
        return summary;
      }
      if (missing.length > 0) summary.updated = true;
    }
  }

  for (const plan of plans) {
    if (shouldStop()) break;
    const hash = tileSourceHash(plan.template);
    let st = progress[plan.key];
    if (!st || st.maxZoom !== plan.maxZoom || st.template !== plan.template) {
      st = { done: 0, total: await planTileCount(plan), bytes: st?.bytes ?? 0, maxZoom: plan.maxZoom, template: plan.template };
      progress[plan.key] = st;
    }
    if (st.total && st.done >= st.total) {
      onPack({ key: plan.key, kind: plan.kind, percentage: 100, bytes: st.bytes, state: "complete" });
      continue;
    }
    if (!allowLarge) {
      summary.pendingWifi = true;
      continue;
    }
    // Karte darf die Kacheln ab sofort vom Gerät lesen
    levels[hash] = Math.max(levels[hash] ?? 0, plan.maxZoom);
    await saveLevels(levels);

    // Download-Anzeige (app-weit)
    const activityId = beginDownload({
      id: `pack:${plan.key}`,
      iso: c.iso,
      labelDe: plan.kind === "map" ? "Karte" : plan.kind === "sat" ? "Luftbild" : "Geozonen-Kacheln",
      kind: plan.kind === "map" ? "map" : plan.kind === "sat" ? "satellite" : "geozones",
      totalItems: st.total,
    });
    const report = (state: PackProgress["state"], error?: string) => {
      progressDownload(activityId, { doneItems: st.done, totalItems: st.total });
      onPack({ key: plan.key, kind: plan.kind, percentage: st.total ? (st.done / st.total) * 100 : 100, bytes: st.bytes, state, error });
    };
    report("active");

    const it = planTiles(plan);
    // bereits erledigte Kacheln überspringen
    for (let i = 0; i < st.done; i++) {
      if (it.next().done) break;
      if ((i & 1023) === 0 && shouldYield()) await yieldToUi("offline-skip");
    }

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
      summary.updated = true;
    } catch (e: any) {
      await saveProgress(progress);
      report("error", e?.message);
      summary.failed = true;
      return summary;
    } finally {
      endDownload(activityId);
    }
  }

  // Hindernisse: Kachel für Kachel, schonend für die OSM-Server
  if (c.obstacles && !baseOnly && !shouldStop()) {
    const bounds = countryOfflineBounds(c.iso);
    if (bounds) {
      const tiles = tilesForBounds(...bounds, OBSTACLE_TILE_ZOOM);
      let done = 0;
      onObstacles(0, tiles.length);
      let activityId: string | null = null;
      try {
        for (const t of tiles) {
          if (shouldStop()) break;
          if (!(await hasObstacleTile(t.x, t.y))) {
            if (!allowLarge) {
              summary.pendingWifi = true;
              break;
            }
            // Anzeige erst, wenn wirklich geladen wird
            if (!activityId) {
              activityId = beginDownload({ id: `obstacles:${c.iso}`, iso: c.iso, labelDe: "Hindernisse", kind: "obstacles", totalItems: tiles.length });
              // Fortsetzen: schon vorhandene Kacheln sofort mitzählen (sonst „0 %“ wie ein Neustart)
              progressDownload(activityId, { doneItems: done });
            }
            await loadObstacleTile(t.x, t.y, { force: true, track: false });
            summary.updated = true;
            await new Promise((r) => setTimeout(r, 1200));
          }
          done++;
          if (activityId) progressDownload(activityId, { doneItems: done });
          onObstacles(done, tiles.length);
        }
      } finally {
        if (activityId) endDownload(activityId);
      }
    }
  }
  return summary;
}

const SYNC_KEY_LABELS: Record<string, string> = { map: "Karte", sat: "Satellit", geo: "Geozonen" };

/**
 * Länder-Nutzung „offline“: ein Land automatisch prüfen und aktualisieren
 * (App-Start, alle 6 h, beim Umschalten auf „Offline“). Gespeicherte
 * Paket-Optionen gelten; ohne Konfiguration die Standard-Teile.
 */
export async function autoSyncCountry(
  rawIso: string,
  allowLarge: boolean,
  onProgress: (p: OfflineSyncProgress) => void,
  mode: "full" | "base" = "full",
): Promise<OfflineSyncCountryResult> {
  const iso = rawIso.toUpperCase();
  if (activeDownloads.has(iso)) return { iso, status: "skipped", message: "Download läuft bereits" };
  const c = mode === "base" ? baseConfig(iso) : (await loadOfflineConfigs()).find((x) => x.iso === iso) ?? defaultConfig(iso);
  if (mode === "base" && !c.geozones) return { iso, status: "current" };
  // Speicherplatz grob prüfen (wie beim Laden aus den Einstellungen)
  if (allowLarge) {
    const free = await freeDiskMB();
    const stored = free != null ? (await storedCountrySizes([iso]).catch(() => null))?.byIso[iso]?.totalBytes ?? 0 : 0;
    if (free != null && estimateSize(c).totalMB - stored / 1024 / 1024 > free * 0.9) {
      return { iso, status: "failed", message: "Zu wenig Speicher – Paket-Optionen in den Einstellungen verkleinern" };
    }
  }
  const r = await startCountryDownload(
    c,
    (p) =>
      onProgress({
        key: p.key,
        label: SYNC_KEY_LABELS[p.kind] ?? p.kind,
        percentage: p.percentage,
        state: p.state,
        ...(p.error ? { error: p.error } : {}),
      }),
    (done, total) =>
      onProgress({ key: `${iso}:obstacles`, label: "Hindernisse", percentage: total ? (done / total) * 100 : 100, state: done >= total ? "complete" : "active" }),
    () => false,
    { auto: true, allowLarge, baseOnly: mode === "base" },
  );
  if (r.failed) return { iso, status: "failed", message: "Aktualisierung fehlgeschlagen – erneut versuchen" };
  if (r.pendingWifi) return { iso, status: "pending-wifi", message: "Große Daten werden im WLAN geladen" };
  return { iso, status: r.updated ? "updated" : "current" };
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
    parts: parts.filter((p) => p !== "base"),
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

/**
 * Länder-Nutzung „online“: nur die Basis-Geozonen (ED-269-Landesdatei bzw.
 * Kachelspeicher „base“) – keine Karte, kein Luftbild, keine Hindernisse,
 * keine großen Zusatzteile. Geozonen-Bildkacheln (WMS/XYZ) zählen nicht dazu.
 */
export function baseConfig(iso: string): CountryOfflineConfig {
  const offline = getGeozoneSourceMeta(iso)?.offline;
  return {
    ...defaultConfig(iso),
    map: false,
    satellite: false,
    obstacles: false,
    geozones: offline === "ed269-store" || offline === "tile-store",
    wohngebiete: false,
    esInfra: false,
    esEnp: false,
  };
}

/**
 * Offline → online: nur die Offline-Zusätze löschen (Karte, Luftbild,
 * Geozonen-Bildkacheln, Hindernisse, große Zusatzteile, Konfiguration). Die
 * Basis-Geozonen (ED-269-Landesdatei, Kachelspeicher „base“) bleiben.
 */
export async function deleteCountryExtras(iso: string): Promise<void> {
  const progress = await loadProgress();
  const levels = await loadLevels();
  const keep = new Set([vectorGeoKey(iso), storeGeoKey(iso, "base")]);
  for (const key of Object.keys(progress)) {
    if (key.startsWith(`${iso}:`) && !keep.has(key)) await dropPack(progress, levels, key);
  }
  await saveProgress(progress);
  await saveLevels(levels);
  if (isTileStoreIso(iso)) {
    for (const part of ["wohn", "infra", "enp"] as TileStorePart[]) {
      if (getTilePartMeta(iso, part)) await deleteTileStore(iso, part).catch(() => {});
    }
  }
  await deleteCountryObstacles(iso, (await loadOfflineConfigs()).filter((x) => x.iso !== iso));
  await saveOfflineConfigs((await loadOfflineConfigs()).filter((x) => x.iso !== iso));
}

/** Hindernis-Kacheln im Länder-Rechteck löschen – außer sie gehören zu einem anderen Offline-Land. */
async function deleteCountryObstacles(iso: string, others: CountryOfflineConfig[]): Promise<void> {
  const bounds = countryOfflineBounds(iso);
  if (!bounds) return;
  const keep = new Set<string>();
  for (const other of others) {
    const ob = countryOfflineBounds(other.iso);
    if (ob && other.obstacles) for (const t of tilesForBounds(...ob, OBSTACLE_TILE_ZOOM)) keep.add(`${t.x}_${t.y}`);
  }
  await deleteObstacleTiles(tilesForBounds(...bounds, OBSTACLE_TILE_ZOOM).filter((t) => !keep.has(`${t.x}_${t.y}`)));
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
  // Hindernis-Kacheln, die auch zu einem anderen Offline-Land gehören, behalten
  await deleteCountryObstacles(iso, list);
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

// ---------------------------------------------------------------------------
// Gespeicherte Größe je Land (Einstellungen „Länder & Offline-Daten“)
// ---------------------------------------------------------------------------

export interface CountryStoredSize {
  iso: string;
  /** Karten-, Luftbild- und Geozonen-Kacheln sowie Kachelspeicher */
  packBytes: number;
  /** ED-269-Bestand (heruntergeladen) */
  datasetBytes: number;
  /** Datei-Import (bleibt auch bei „Aus“ erhalten) */
  importBytes: number;
  /** Hindernis-Kacheln (geschätzt aus der Anzahl) */
  obstacleBytes: number;
  totalBytes: number;
}

/**
 * Gespeicherte Daten je Land. Gemeinsame Kacheln (LI/CH) erscheinen bei beiden
 * Ländern, zählen in `totalBytes` der Summe aber nur einmal.
 */
export async function storedCountrySizes(isos: string[]): Promise<{ byIso: Record<string, CountryStoredSize>; totalBytes: number }> {
  const progress = await loadProgress();
  await loadTileStoreMeta().catch(() => {});
  // Hindernis-Kacheln nur für Länder mit gespeicherter Konfiguration prüfen (viele Dateiabfragen)
  const withObstacles = new Set((await loadOfflineConfigs()).filter((c) => c.obstacles).map((c) => c.iso));
  const byIso: Record<string, CountryStoredSize> = {};
  const countedTemplates = new Set<string>();
  const countedSources = new Set<string>();
  let total = 0;
  for (const raw of isos) {
    const iso = raw.toUpperCase();
    const out: CountryStoredSize = { iso, packBytes: 0, datasetBytes: 0, importBytes: 0, obstacleBytes: 0, totalBytes: 0 };
    for (const [k, v] of Object.entries(progress)) {
      if (!k.startsWith(`${iso}:`) || v.template.startsWith(VECTOR_TEMPLATE_PREFIX) || v.template.startsWith(STORE_TEMPLATE_PREFIX)) continue;
      out.packBytes += v.bytes || 0;
      if (!countedTemplates.has(v.template)) {
        countedTemplates.add(v.template);
        total += v.bytes || 0;
      }
    }
    if (isTileStoreIso(iso)) {
      for (const part of ["base", "wohn", "infra", "enp"] as TileStorePart[]) {
        const meta = getTilePartMeta(iso, part);
        if (meta) {
          out.packBytes += meta.dataBytes;
          total += meta.dataBytes;
        }
      }
    }
    // ED-269-Bestand nur beim Land des Datensatzes zählen (LI steckt im CH-Bestand)
    const source = resolveGeozoneSourceIso(iso);
    if (source === iso && !countedSources.has(source)) {
      countedSources.add(source);
      const bytes = await storedEd269Bytes(source).catch(() => 0);
      if (bytes > 0) {
        const ds = await loadStoredEd269Dataset(source).catch(() => null);
        if (ds?.imported) out.importBytes = bytes;
        else out.datasetBytes = bytes;
        total += bytes;
      }
    }
    const obs = withObstacles.has(iso) ? await obstacleTilesStored(iso).catch(() => ({ done: 0, total: 0 })) : { done: 0, total: 0 };
    out.obstacleBytes = obs.done * LAND_SHARE * OBSTACLE_KB_PER_TILE * 1024;
    out.totalBytes = out.packBytes + out.datasetBytes + out.importBytes + out.obstacleBytes;
    byIso[iso] = out;
  }
  // Hindernis-Kacheln überlappender Länder-Rechtecke: grob, ohne Abgleich
  total += Object.values(byIso).reduce((n, c) => n + c.obstacleBytes, 0);
  return { byIso, totalBytes: total };
}
