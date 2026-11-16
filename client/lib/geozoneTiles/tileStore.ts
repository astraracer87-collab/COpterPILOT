// Offline-Kachelspeicher der Vektor-Geozonen für DE (dipul-WFS), FR (IGN/
// Géoplateforme-WFS), CZ (ŘLP ED-318-Kacheln) und ES (ENAIRE insignias-
// MapServer, ArcGIS-Paging): Download mit Fortschritt, Pause/Fortsetzen und
// Wiederholungen, Lesen nach Punkt/Ausschnitt.
//
// Ablage (siehe tileStoreCore.ts):
//   documentDirectory/geozone-tiles/<iso>/<part>/{data.bin,index.json,meta.json}
//   documentDirectory/geozone-tiles/<iso>/<part>.staging/…   (laufender Download)
//   documentDirectory/geozone-tiles/de/temp.json                (temporäre dipul-Zonen)
//   documentDirectory/geozone-tiles/es/temp.json                (ES-NOTAM für UAS)
// part = "base" (alle Zonen bzw. ES „Luftfahrt“), "wohn" (DE: Wohngrundstücke),
// "infra"/"enp" (ES: Infrastruktur/Naturschutz) – Zusatzteile abwählbar.
//
// Ein laufender (Neu-)Download baut den Bestand im staging-Ordner auf; erst
// wenn er vollständig ist, ersetzt er den alten Bestand. Bis dahin (und bei
// Abbruch/Fehler) bleibt der alte Bestand lesbar.
//
// Dateizugriff über ein austauschbares Adapter-Objekt (TileFs): auf dem Gerät
// expo-file-system (lazy geladen, expoTileFs.ts), in Tests Node-fs.
import type { GeozoneFeatureInfo } from "../geozones";
import {
  CZ_INDEX_URL,
  DIPUL_DEFAULT_PAGE,
  DIPUL_PAGE_SIZE,
  DIPUL_STORE_LAYERS,
  DIPUL_TEMP_LAYER,
  DIPUL_WOHN_LAYER,
  FR_PAGE_SIZE,
  appendFeaturesYielding,
  bboxAround,
  bboxIntersects,
  decodeRecord,
  decodeRecordYielding,
  dipulPageUrl,
  emptyIndex,
  entryRange,
  frPageUrl,
  geometryBBox,
  isBeforeCurrentAirac,
  isIndexStale,
  isTileStoreIso,
  TILE_STORE_ISOS,
  listCzZipEntries,
  loadIndexYielding,
  pageJobs,
  parseCzUasIndex,
  queryIndexYielding,
  readCzZipEntry,
  wfsCountUrl,
  wfsMatched,
  type CzPublication,
  type LngLatBBox,
  type LoadedTileIndex,
  type TileIndexFile,
  type TileJob,
  type TileStoreIso,
  type TileStorePart,
  TILE_STORE_OPTIONAL_PARTS,
  tileStorePartsOf,
} from "./tileStoreCore";
import {
  esInsigniasCount,
  esInsigniasCountUrl,
  esInsigniasLayer,
  esInsigniasLayersOf,
  esInsigniasPageUrl,
  normalizeEnaireInsigniasFeature,
  tagEsInsigniasFeature,
  type EsInsigniasLayer,
} from "../../../shared/spanishGeozones";
import { esNotamStaticActivations, esNotamValidity, type EsNotamFeature } from "../../../shared/spanishNotams";
import { __resetEsServicesForTests, resolveEsLayers, withEsLayer, type EsFetchJson } from "./esServices";
import { arcgisPage } from "../../../shared/geozoneKit/arcgis";
import { dedupeZones, dipulLayerOfId, zoneFromStored } from "./tileZones";
import { setCountryAccessAvailable } from "../../../shared/countryDetection";
import { zoneEndedLongAgo } from "../../../shared/ed269Restriction";
import { TEMPORARY_ZONES_MAX_AGE_MS } from "../../../shared/geozoneSourceMeta";
import { loadLargePacksOnMobile, mayDownloadLargePack } from "../geozoneSources/largePackSetting";
import { awaitCountryUsage, isGeozoneSourceEnabled } from "../countryUsage";
import { beginDownload, endDownload, progressDownload } from "../downloadActivity";
import {
  parseJsonYielding,
  responseJsonYielding,
  runForegroundWork,
  runInBackground,
  shouldYield,
  stringifyYielding,
  waitForIdle,
  yieldToUi,
} from "../../../shared/yieldingWork";
import { runAfterStartup } from "../backgroundWork";

// ---------------------------------------------------------------------------
// Umgebung (Dateisystem, Netz)
// ---------------------------------------------------------------------------

export interface TileFs {
  /** Wurzelordner mit abschließendem „/“ */
  root(): string;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string | null>;
  /** atomar (temp + verschieben) */
  writeText(path: string, text: string): Promise<void>;
  appendBytes(path: string, bytes: Uint8Array): Promise<void>;
  size(path: string): Promise<number>;
  readRanges(path: string, ranges: [number, number][]): Promise<Uint8Array[]>;
  readBytes(path: string): Promise<Uint8Array>;
  /** lädt eine Datei herunter, wirft bei HTTP-Fehler; liefert Bytes */
  download(url: string, path: string): Promise<number>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  /** freier Speicher in Bytes (optional) */
  freeBytes?(): Promise<number | null>;
}

interface TileEnv {
  fs: TileFs | null;
  isOffline: () => boolean;
  isWifi: () => Promise<boolean>;
  fetch: typeof fetch;
  /** Wartezeiten zwischen Wiederholungen */
  retryDelaysMs: number[];
  /** Uhr für Ablauf-Filter (Tests: feste Zeit) */
  now: () => number;
}

let envOverride: Partial<TileEnv> | null = null;
let lazyFs: TileFs | null | undefined;

function getEnv(): TileEnv {
  if (lazyFs === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      lazyFs = require("./expoTileFs").createExpoTileFs() as TileFs | null;
    } catch {
      lazyFs = null;
    }
  }
  const defaultOffline = () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return !!require("../network").isOfflineNow();
    } catch {
      return false;
    }
  };
  const defaultWifi = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NetInfo = require("@react-native-community/netinfo").default;
      const st = await NetInfo.fetch();
      return st?.type === "wifi" || st?.type === "ethernet";
    } catch {
      return false;
    }
  };
  return {
    fs: envOverride?.fs !== undefined ? envOverride.fs : lazyFs,
    isOffline: envOverride?.isOffline ?? defaultOffline,
    isWifi: envOverride?.isWifi ?? defaultWifi,
    fetch: envOverride?.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a)),
    retryDelaysMs: envOverride?.retryDelaysMs ?? [2000, 5000, 10000],
    now: envOverride?.now ?? (() => Date.now()),
  };
}

/** Verbindung über WLAN/Ethernet? (NetInfo; Tests: Umgebung) */
export function isOnWifi(): Promise<boolean> {
  return getEnv().isWifi();
}

/** Nur für Tests: Dateisystem/Netz ersetzen und Zustand leeren. */
export function __setTileStoreEnvForTests(env: Partial<TileEnv> | null): void {
  envOverride = env;
  metaCache.clear();
  indexCache.clear();
  zoneCache.clear();
  zoneCacheBytes.clear();
  zoneCacheTotal = 0;
  tempCache = null;
  tempFetchedAt = null;
  tempSignature = "";
  esTempCache = null;
  esTempFetchedAt = null;
  esTempSignature = "";
  metaLoaded = null;
  __resetEsServicesForTests();
}

// ---------------------------------------------------------------------------
// Pfade + Metadaten
// ---------------------------------------------------------------------------

export interface TilePartMeta {
  iso: TileStoreIso;
  part: TileStorePart;
  complete: boolean;
  createdAt: number;
  count: number;
  dataBytes: number;
  rawBytes: number;
  source?: Record<string, string | number>;
}

const partDir = (fs: TileFs, iso: string, part: string) => `${fs.root()}${iso.toLowerCase()}/${part}/`;
const stagingDir = (fs: TileFs, iso: string, part: string) => `${fs.root()}${iso.toLowerCase()}/${part}.staging/`;
const tempPath = (fs: TileFs) => `${fs.root()}de/temp.json`;
const esTempPath = (fs: TileFs) => `${fs.root()}es/temp.json`;

const metaCache = new Map<string, TilePartMeta>(); // `${iso}/${part}`
const indexCache = new Map<string, Promise<LoadedTileIndex | null>>();
const listeners = new Set<() => void>();
let metaLoaded: Promise<void> | null = null;

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

/** Benachrichtigung, wenn sich ein Bestand ändert (Download fertig, gelöscht). */
export function onTileStoreChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function metaOf(file: TileIndexFile): TilePartMeta {
  return {
    iso: file.iso,
    part: file.part,
    complete: file.complete,
    createdAt: file.createdAt,
    count: file.ids.length,
    dataBytes: file.dataBytes,
    rawBytes: file.rawBytes,
    source: file.source,
  };
}

/** Liest die Metadaten aller gespeicherten Bestände (einmalig, beim Start). */
export function loadTileStoreMeta(force = false): Promise<void> {
  if (metaLoaded && !force) return metaLoaded;
  metaLoaded = (async () => {
    const fs = getEnv().fs;
    if (!fs) return;
    for (const iso of TILE_STORE_ISOS) {
      for (const part of tileStorePartsOf(iso)) {
        try {
          const raw = await fs.readText(`${partDir(fs, iso, part)}meta.json`);
          const m = raw ? (JSON.parse(raw) as TilePartMeta) : null;
          if (m && m.complete) metaCache.set(`${iso}/${part}`, m);
          else metaCache.delete(`${iso}/${part}`);
        } catch {
          metaCache.delete(`${iso}/${part}`);
        }
      }
    }
    notify();
  })();
  return metaLoaded;
}

export function getTilePartMeta(iso: string, part: TileStorePart = "base"): TilePartMeta | null {
  return metaCache.get(`${String(iso).toUpperCase()}/${part}`) ?? null;
}

/** Synchron: liegt ein vollständiger Offline-Bestand für das Land vor? */
export function hasTiledGeozones(iso: string | null | undefined): boolean {
  const up = String(iso || "").toUpperCase();
  return isTileStoreIso(up) && !!metaCache.get(`${up}/base`)?.complete;
}

/** Länder mit vollständigem Bestand */
export function tiledGeozoneIsos(): TileStoreIso[] {
  return TILE_STORE_ISOS.filter((i) => hasTiledGeozones(i));
}

async function readIndexFile(fs: TileFs, dir: string): Promise<TileIndexFile | null> {
  try {
    const raw = await fs.readText(`${dir}index.json`);
    if (!raw) return null;
    // DE: index.json ≈ 6 MB – in Zeitscheiben parsen (Reaktionsfähigkeit)
    const f = (await parseJsonYielding(raw)) as TileIndexFile;
    return f && Array.isArray(f.entries) && Array.isArray(f.ids) ? f : null;
  } catch {
    return null;
  }
}

function getLoadedIndex(iso: TileStoreIso, part: TileStorePart): Promise<LoadedTileIndex | null> {
  const meta = metaCache.get(`${iso}/${part}`);
  if (!meta?.complete) return Promise.resolve(null);
  const key = `${iso}/${part}/${meta.createdAt}`;
  let p = indexCache.get(key);
  if (!p) {
    p = (async () => {
      const fs = getEnv().fs;
      if (!fs) return null;
      const f = await readIndexFile(fs, partDir(fs, iso, part));
      return f && f.complete ? loadIndexYielding(f) : null;
    })();
    for (const k of [...indexCache.keys()]) if (k.startsWith(`${iso}/${part}/`)) indexCache.delete(k);
    indexCache.set(key, p);
    p.then((r) => {
      if (!r) indexCache.delete(key);
    });
  }
  return p;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

const ZONE_CACHE_MAX = 4000;
// Zusätzlich nach Größe begrenzen: einzelne Zonen sind riesig (z. B. Wohn-
// grundstücke „Stadt München“ ≈ 1,9 MB). Geschätzt über die entpackte
// Datensatzgröße; Obergrenze ≈ 60 MB, damit die Fernsteuerung nicht vollläuft.
const ZONE_CACHE_MAX_BYTES = 60 * 1024 * 1024;
const zoneCache = new Map<string, GeozoneFeatureInfo | null>();
const zoneCacheBytes = new Map<string, number>();
let zoneCacheTotal = 0;

function dropZone(k: string) {
  zoneCache.delete(k);
  zoneCacheTotal -= zoneCacheBytes.get(k) ?? 0;
  zoneCacheBytes.delete(k);
}

function cacheZone(key: string, z: GeozoneFeatureInfo | null, bytes = 0) {
  if (zoneCache.has(key)) dropZone(key);
  if (zoneCache.size >= ZONE_CACHE_MAX || zoneCacheTotal + bytes > ZONE_CACHE_MAX_BYTES) {
    // älteste Einträge verwerfen (Map hält Einfügereihenfolge), bis Platz ist
    let drop = Math.ceil(ZONE_CACHE_MAX / 10);
    for (const k of zoneCache.keys()) {
      if (drop <= 0 && zoneCacheTotal + bytes <= ZONE_CACHE_MAX_BYTES) break;
      dropZone(k);
      drop--;
    }
  }
  zoneCache.set(key, z);
  zoneCacheBytes.set(key, bytes);
  zoneCacheTotal += bytes;
}

async function readZones(
  iso: TileStoreIso,
  part: TileStorePart,
  idx: LoadedTileIndex,
  entries: number[],
): Promise<GeozoneFeatureInfo[]> {
  const fs = getEnv().fs;
  if (!fs || entries.length === 0) return [];
  const prefix = `${iso}/${part}/${idx.file.createdAt}/`;
  const missing = entries.filter((i) => !zoneCache.has(prefix + i));
  if (missing.length > 0) {
    const bytes = await fs.readRanges(
      `${partDir(fs, iso, part)}data.bin`,
      missing.map((i) => entryRange(idx.file, i)),
    );
    // in Zeitscheiben entpacken/umwandeln (große Ausschnitte: Hunderte Zonen)
    for (let n = 0; n < missing.length; n++) {
      const i = missing[n];
      let z: GeozoneFeatureInfo | null = null;
      try {
        z = zoneFromStored(iso, await decodeRecordYielding(bytes[n]));
      } catch {
        z = null;
      }
      cacheZone(prefix + i, z, (bytes[n]?.length ?? 0) * 4);
      if (shouldYield()) await yieldToUi("tile-read");
    }
  }
  const out: GeozoneFeatureInfo[] = [];
  for (const i of entries) {
    const z = zoneCache.get(prefix + i);
    if (z) out.push(z);
  }
  return out;
}

export interface TiledQueryOptions {
  /** DE: nur diese dipul-Ebenen (wmsLayer-Namen); leer/undefined = alle */
  layers?: string[];
  /** höchstens so viele Zonen (die der Mitte nächsten) */
  limit?: number;
  /** wird gesetzt, wenn `limit` Treffer abgeschnitten hat */
  stats?: { truncated?: boolean; total?: number };
  /** DE: temporäre Beschränkungen mitliefern (Standard: ja) */
  includeTemp?: boolean;
}

/**
 * Zonen eines Landes im Ausschnitt aus dem Offline-Bestand. null, wenn kein
 * vollständiger Bestand vorliegt (Aufrufer nutzt dann den Online-Pfad).
 */
export function queryTiledGeozones(
  rawIso: string,
  bbox: LngLatBBox,
  opts: TiledQueryOptions = {},
): Promise<GeozoneFeatureInfo[] | null> {
  // Vordergrund: laufende Hintergrund-Jobs (Downloads) pausieren solange
  return runForegroundWork(() => queryTiledGeozonesInner(rawIso, bbox, opts));
}

async function queryTiledGeozonesInner(
  rawIso: string,
  bbox: LngLatBBox,
  opts: TiledQueryOptions,
): Promise<GeozoneFeatureInfo[] | null> {
  const iso = String(rawIso || "").toUpperCase();
  if (!isTileStoreIso(iso)) return null;
  await loadTileStoreMeta();
  const base = await getLoadedIndex(iso, "base");
  if (!base) return null;
  const layerSet = iso === "DE" && opts.layers && opts.layers.length > 0 ? new Set(opts.layers) : null;
  const filter = layerSet ? (id: string) => layerSet.has(dipulLayerOfId(id)) : undefined;
  const zones: GeozoneFeatureInfo[] = [];
  zones.push(...(await readZones(iso, "base", base, await queryIndexYielding(base, bbox, { filter, limit: opts.limit, stats: opts.stats }))));
  if (iso === "DE" && (!layerSet || layerSet.has(DIPUL_WOHN_LAYER))) {
    const wohn = await getLoadedIndex(iso, "wohn");
    if (wohn) zones.push(...(await readZones(iso, "wohn", wohn, await queryIndexYielding(wohn, bbox, { limit: opts.limit, stats: opts.stats }))));
  }
  if (iso === "DE" && opts.includeTemp !== false && (!layerSet || layerSet.has(DIPUL_TEMP_LAYER))) {
    zones.push(...(await getDeTempZones(bbox)));
  }
  if (iso === "ES") {
    // abwählbare Teile (Infrastruktur, Naturschutz), sofern gespeichert
    for (const part of TILE_STORE_OPTIONAL_PARTS.ES) {
      const idx = await getLoadedIndex(iso, part);
      if (idx) zones.push(...(await readZones(iso, part, idx, await queryIndexYielding(idx, bbox, { limit: opts.limit, stats: opts.stats }))));
    }
    // NOTAM für UAS: online live (≤ 10 min), offline letzter Stand; statische
    // Aktivierungen an den festen Sperrgebieten anzeigen
    if (opts.includeTemp !== false) {
      zones.push(...(await getEsTempZones(bbox)));
      return dedupeZones(annotateEsStaticActivations(zones, esTempCache?.features ?? [], new Date(getEnv().now())));
    }
  }
  return dedupeZones(zones);
}

/** Punkt-in-Polygon für Zonen im App-Format ([lat, lon]-Ringe, Löcher). */
export function zoneContainsPoint(z: GeozoneFeatureInfo, lat: number, lon: number): boolean {
  const inRing = (ring: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
    }
    return inside;
  };
  const groups = z.polygonGroups?.length ? z.polygonGroups : (z.polygonRings ?? []).map((r) => [r]);
  return groups.some((g) => g.length > 0 && inRing(g[0]) && !g.slice(1).some(inRing));
}

/** Zonen, die einen Punkt enthalten (Tipp-Info, Zonencheck). */
export async function queryTiledGeozonesAtPoint(
  iso: string,
  lat: number,
  lon: number,
  opts: TiledQueryOptions = {},
): Promise<GeozoneFeatureInfo[] | null> {
  const zones = await queryTiledGeozones(iso, bboxAround(lat, lon, 0.01), { ...opts, limit: undefined });
  return zones ? zones.filter((z) => zoneContainsPoint(z, lat, lon)) : null;
}

// ---------------------------------------------------------------------------
// DE: temporäre Betriebseinschränkungen – online immer live (kurzer Cache),
// offline der zuletzt gespeicherte Stand.
// ---------------------------------------------------------------------------

export const DE_TEMP_CACHE_MS = TEMPORARY_ZONES_MAX_AGE_MS;
let tempCache: { at: number; features: any[] } | null = null;
let tempInFlight: Promise<any[]> | null = null;
// Teil A: tatsächlicher Stand der temporären Zonen (Live-Abruf bzw. temp.json);
// null = nie geladen. Getrennt von tempCache.at (Cache-Steuerung).
let tempFetchedAt: number | null = null;
let tempSignature = "";
const tempListeners = new Set<() => void>();

/** Benachrichtigung, wenn sich die temporären DE-Zonen inhaltlich ändern (Teil A). */
export function onDeTempChange(l: () => void): () => void {
  tempListeners.add(l);
  return () => tempListeners.delete(l);
}

function tempSignatureOf(features: any[]): string {
  return features
    .map((f) => `${f?.id ?? ""}|${f?.properties?.start_time ?? ""}|${f?.properties?.end_time ?? ""}`)
    .sort()
    .join(";");
}

function setTempFeatures(features: any[], fetchedAt: number, cacheAt: number): void {
  tempCache = { at: cacheAt, features };
  tempFetchedAt = fetchedAt;
  const sig = tempSignatureOf(features);
  const changed = tempSignature !== "" && sig !== tempSignature;
  tempSignature = sig;
  if (changed) {
    for (const l of tempListeners) {
      try {
        l();
      } catch {}
    }
  }
}

/** Stand der temporären DE-Zonen (Teil A): Zeitpunkt des letzten erfolgreichen Abrufs. */
export function getDeTempStatus(): { fetchedAt: number | null } {
  return { fetchedAt: tempFetchedAt };
}

/**
 * Temporäre DE-Zonen: online höchstens DE_TEMP_CACHE_MS alt (`force`: sofort
 * neu laden), offline bzw. bei Fehler der zuletzt gespeicherte Stand (temp.json).
 */
export async function getDeTempFeatures(opts: { force?: boolean } = {}): Promise<any[]> {
  const env = getEnv();
  const now = Date.now();
  if (!opts.force && tempCache && now - tempCache.at < DE_TEMP_CACHE_MS) return tempCache.features;
  if (!env.isOffline()) {
    if (!tempInFlight) {
      tempInFlight = (async () => {
        try {
          const data = await fetchJson(dipulPageUrl(DIPUL_TEMP_LAYER, 0, 1000), 20000, 1);
          const features = Array.isArray(data?.features) ? data.features : null;
          if (features) {
            const at = Date.now();
            setTempFeatures(features, at, at);
            const fs = env.fs;
            if (fs) {
              await fs.mkdirp(`${fs.root()}de/`).catch(() => {});
              await fs.writeText(tempPath(fs), JSON.stringify({ fetchedAt: at, features })).catch(() => {});
            }
            return features;
          }
        } catch {}
        return [];
      })().finally(() => {
        tempInFlight = null;
      });
    }
    const live = await tempInFlight;
    if (live.length > 0 || (tempCache && tempFetchedAt != null && tempFetchedAt >= now)) return tempCache?.features ?? live;
  }
  const fs = env.fs;
  if (!fs) return tempCache?.features ?? [];
  try {
    const raw = await fs.readText(tempPath(fs));
    const parsed = raw ? JSON.parse(raw) : null;
    const features = Array.isArray(parsed?.features) ? parsed.features : [];
    const fetchedAt = typeof parsed?.fetchedAt === "number" ? parsed.fetchedAt : null;
    // offline: nicht dauerhaft cachen, damit online sofort wieder live geladen wird
    if (fetchedAt != null) setTempFeatures(features, fetchedAt, now - DE_TEMP_CACHE_MS + 60_000);
    else tempCache = { at: now - DE_TEMP_CACHE_MS + 60_000, features };
    return features;
  } catch {
    return tempCache?.features ?? [];
  }
}

async function getDeTempZones(bbox: LngLatBBox): Promise<GeozoneFeatureInfo[]> {
  const feats = await getDeTempFeatures();
  const now = Date.now();
  const out: GeozoneFeatureInfo[] = [];
  for (const f of feats) {
    const bb = geometryBBox(f?.geometry);
    if (!bb || !bboxIntersects(bb, bbox)) continue;
    const z = zoneFromStored("DE", f);
    if (!z) continue;
    // Nur lange (> 1 Tag) abgelaufene Zonen verwerfen; aktiv/inaktiv
    // entscheidet zoneActivityAt für den jeweiligen Zeitpunkt.
    if (zoneEndedLongAgo(z, now)) continue;
    out.push(z);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ES: NOTAM für UAS (NOTAM_UAS_APP_V3/1) – temporäre Zonen, online live
// (kurzer Cache), offline der zuletzt gespeicherte Stand (es/temp.json).
// ---------------------------------------------------------------------------

let esTempCache: { at: number; features: any[] } | null = null;
let esTempInFlight: Promise<any[] | null> | null = null;
let esTempFetchedAt: number | null = null;
let esTempSignature = "";

/** Stand der ES-NOTAM-Zonen (Teil A): letzter erfolgreicher Abruf; null = nie. */
export function getEsTempStatus(): { fetchedAt: number | null } {
  return { fetchedAt: esTempFetchedAt };
}

/** Stand der temporären Zonen eines Kachelspeicher-Landes mit eigenem Abruf (DE, ES). */
export function getTileTempStatus(iso: string | null | undefined): { fetchedAt: number | null } {
  const up = String(iso || "").toUpperCase();
  if (up === "DE") return getDeTempStatus();
  if (up === "ES") return getEsTempStatus();
  return { fetchedAt: null };
}

function setEsTempFeatures(features: any[], fetchedAt: number, cacheAt: number): void {
  esTempCache = { at: cacheAt, features };
  esTempFetchedAt = fetchedAt;
  const sig = features.map((f) => String(f?.id ?? "")).sort().join(";");
  const changed = esTempSignature !== "" && sig !== esTempSignature;
  esTempSignature = sig;
  if (changed) {
    for (const l of tempListeners) {
      try {
        l();
      } catch {}
    }
  }
}

/** Netz für die ES-Dienstauflösung (Web Map, 404-Wiederholung). */
const esFetchJson: EsFetchJson = (url, timeoutMs) => fetchJson(url, timeoutMs ?? 30_000, 1);

/**
 * Alle NOTAM-Features (markiert, Schlüssel notamId). Der ganze Bestand
 * (≈ 730) passt in EINE Abfrage (resultRecordCount 3000); Weiterblättern nur
 * bei exceededTransferLimit (oben oder in properties). Bewusst OHNE
 * serverseitigen Zeitfilter (Doku NOTAM §2/§6: alles laden, Status in der App):
 * der Server entfernt Abgelaufene selbst, künftige bleiben (geplant). Hier
 * wird nur verworfen, was schon abgelaufen ist (itemC < jetzt). Der Bestand
 * ersetzt den alten vollständig (Stornierungen = Verschwinden).
 */
async function fetchEsNotamFeatures(): Promise<any[] | null> {
  return withEsLayer("es_notam", esFetchJson, async (layer) => {
    const byId = new Map<string, any>();
    let offset = 0;
    const now = getEnv().now();
    for (let page = 0; page < 5; page++) {
      const { features, exceeded } = arcgisPage(await fetchJson(esInsigniasPageUrl(layer, offset, layer.pageSize), 30_000, 1));
      offset += features.length;
      for (const f of features) {
        const end = esNotamValidity(f?.properties ?? {}).end;
        if (end != null && end < now) continue;
        const t = tagEsInsigniasFeature(f, layer.key);
        if (t) byId.set(String(t.id), t); // gleiche notamId zwischen Seiten → einmal
      }
      if (features.length === 0 || !exceeded) break;
    }
    return [...byId.values()];
  });
}

/**
 * ES-NOTAM-Features: online höchstens TEMPORARY_ZONES_MAX_AGE_MS alt (`force`:
 * sofort neu laden), offline bzw. bei Fehler der zuletzt gespeicherte Stand.
 */
export async function getEsTempFeatures(opts: { force?: boolean } = {}): Promise<any[]> {
  const env = getEnv();
  const now = Date.now();
  if (!opts.force && esTempCache && now - esTempCache.at < TEMPORARY_ZONES_MAX_AGE_MS) return esTempCache.features;
  if (!env.isOffline()) {
    if (!esTempInFlight) {
      esTempInFlight = (async () => {
        try {
          const features = await fetchEsNotamFeatures();
          if (features) {
            const at = Date.now();
            setEsTempFeatures(features, at, at);
            const fs = env.fs;
            if (fs) {
              await fs.mkdirp(`${fs.root()}es/`).catch(() => {});
              await fs.writeText(esTempPath(fs), JSON.stringify({ fetchedAt: at, features })).catch(() => {});
            }
            return features;
          }
        } catch {}
        return null;
      })().finally(() => {
        esTempInFlight = null;
      });
    }
    const live = await esTempInFlight;
    if (live) return live;
  }
  const fs = env.fs;
  if (!fs) return esTempCache?.features ?? [];
  try {
    const raw = await fs.readText(esTempPath(fs));
    const parsed = raw ? JSON.parse(raw) : null;
    const features = Array.isArray(parsed?.features) ? parsed.features : [];
    const fetchedAt = typeof parsed?.fetchedAt === "number" ? parsed.fetchedAt : null;
    if (fetchedAt != null) setEsTempFeatures(features, fetchedAt, now - TEMPORARY_ZONES_MAX_AGE_MS + 60_000);
    return features;
  } catch {
    return esTempCache?.features ?? [];
  }
}

/** ES-NOTAM-Zonen im Ausschnitt (live ≤ 10 min, offline letzter Stand) – auch ohne Paket. */
export function queryEsTempZones(bbox: LngLatBBox): Promise<GeozoneFeatureInfo[]> {
  return getEsTempZones(bbox);
}

/**
 * Statische NOTAM-Aktivierungen (AREA ESTATICA + ACTIVA) an die festen Zonen
 * der Ebene ZG_Restringidas hängen (affectedElement ↔ IDENT_TXT): „NOTAM …:
 * Zone LED90A ist jetzt aktiv (Höhe …, gültig …)“. Neue Objekte, der
 * Zonen-Cache bleibt unverändert.
 */
export function annotateEsStaticActivations(zones: GeozoneFeatureInfo[], notamFeatures: any[], now = new Date()): GeozoneFeatureInfo[] {
  const targets = zones.filter((z) => z.sourceIdent && String(z.featureId ?? "").startsWith("ES-es_restringidas."));
  if (targets.length === 0 || notamFeatures.length === 0) return zones;
  const normalized = notamFeatures
    .map((f) => {
      try {
        return normalizeEnaireInsigniasFeature(f, now) as EsNotamFeature | null;
      } catch {
        return null;
      }
    })
    .filter((f): f is EsNotamFeature => !!f);
  const map = esNotamStaticActivations(normalized);
  if (map.size === 0) return zones;
  return zones.map((z) => {
    const acts = z.sourceIdent && String(z.featureId ?? "").startsWith("ES-es_restringidas.") ? map.get(z.sourceIdent.toUpperCase()) : undefined;
    if (!acts || acts.length === 0) return z;
    return { ...z, details: `${acts.map((a) => a.line).join("\n")}\n${z.details}` };
  });
}

/** ES-Zonen (Live-Pfad ohne Paket) um statische NOTAM-Aktivierungen ergänzen. */
export async function withEsNotamActivations(zones: GeozoneFeatureInfo[]): Promise<GeozoneFeatureInfo[]> {
  const feats = await getEsTempFeatures().catch(() => [] as any[]);
  return annotateEsStaticActivations(zones, feats);
}

async function getEsTempZones(bbox: LngLatBBox): Promise<GeozoneFeatureInfo[]> {
  const feats = await getEsTempFeatures();
  const now = getEnv().now();
  const out: GeozoneFeatureInfo[] = [];
  for (const f of feats) {
    const bb = geometryBBox(f?.geometry);
    if (!bb || !bboxIntersects(bb, bbox)) continue;
    const z = zoneFromStored("ES", f, now);
    if (!z || zoneEndedLongAgo(z, now)) continue;
    out.push(z);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url: string, timeoutMs = 120_000, retries = 3): Promise<any> {
  const env = getEnv();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await env.fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // große WFS-/ArcGIS-Seiten (bis > 10 MB) in Zeitscheiben parsen
      return await responseJsonYielding(res);
    } catch (e) {
      lastErr = e;
      // 404 = Dienst/Ebene gibt es nicht (mehr) – Wiederholen hilft nicht (ES: Web Map neu lesen)
      if (e instanceof Error && /^HTTP 404$/.test(e.message)) break;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(env.retryDelaysMs[attempt] ?? env.retryDelaysMs[env.retryDelaysMs.length - 1] ?? 10000);
  }
  throw lastErr instanceof Error ? lastErr : new Error("Download fehlgeschlagen");
}

async function fetchText(url: string, timeoutMs = 30_000): Promise<string> {
  const env = getEnv();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await env.fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export interface TilePartProgress {
  iso: TileStoreIso;
  part: TileStorePart;
  done: number;
  total: number;
  /** komprimiert gespeicherte Bytes */
  bytes: number;
  state: "active" | "complete" | "inactive" | "error";
  error?: string;
}

interface PartSource {
  /** Auftragsliste ermitteln (einmalig, wird für Fortsetzen gespeichert) */
  listJobs(stagingDir: string): Promise<{ jobs: TileJob[]; source?: Record<string, string | number> }>;
  /** Features eines Auftrags + übertragene Bytes (Schätzung) */
  runJob(job: TileJob, stagingDir: string): Promise<{ features: any[]; rawBytes: number }>;
  /** nach erfolgreichem Abschluss (z. B. ZIP löschen) */
  finish?(stagingDir: string): Promise<void>;
  concurrency: number;
}

function wfsSource(iso: "DE" | "FR", part: TileStorePart): PartSource {
  const layers: string[] = iso === "FR" ? ["fr"] : part === "wohn" ? [DIPUL_WOHN_LAYER] : [...DIPUL_STORE_LAYERS];
  const url = (layer: string, start: number, count: number) =>
    iso === "FR" ? frPageUrl(start, count) : dipulPageUrl(layer, start, count);
  return {
    concurrency: 3,
    async listJobs() {
      const jobs: TileJob[] = [];
      let matched = 0;
      for (const layer of layers) {
        const data = await fetchJson(wfsCountUrl(iso, layer), 60_000);
        const total = wfsMatched(data);
        if (total == null) throw new Error("Anzahl der Zonen unbekannt");
        // Leere Ebene bei den Hauptebenen = Dienststörung, kein gültiger Bestand
        if (total === 0 && (iso === "FR" || layer === DIPUL_WOHN_LAYER || layer === "kontrollzonen")) {
          throw new Error("Geodienst liefert keine Zonen");
        }
        const size = iso === "FR" ? FR_PAGE_SIZE : DIPUL_PAGE_SIZE[layer] ?? DIPUL_DEFAULT_PAGE;
        jobs.push(...pageJobs(layer, total, size));
        matched += total;
      }
      // matched: Trefferzahl beim Download (Teil A: günstige Versionsprüfung FR)
      return { jobs, source: { service: iso === "FR" ? "geopf-wfs" : "dipul-wfs", matched } };
    },
    async runJob(job) {
      const data = await fetchJson(url(job.layer!, job.start!, job.count!));
      const features = Array.isArray(data?.features) ? data.features : null;
      if (!features) throw new Error("Ungültige Antwort des Geodienstes");
      return { features, rawBytes: 0 };
    },
  };
}

function czSource(): PartSource {
  let zip: Uint8Array | null = null;
  const zipPath = (dir: string) => `${dir}tiles.zip`;
  const ensureZip = async (dir: string) => {
    const fs = getEnv().fs!;
    if (!zip) zip = await fs.readBytes(zipPath(dir));
    return zip;
  };
  return {
    concurrency: 1,
    async listJobs(dir) {
      const pub = await fetchCzPublication();
      if (!pub) throw new Error("ŘLP-Veröffentlichung nicht gefunden");
      const fs = getEnv().fs!;
      await fs.download(pub.url, zipPath(dir));
      zip = null;
      const names = listCzZipEntries(await ensureZip(dir));
      if (names.length === 0) throw new Error("ED-318-Archiv ohne Kacheln");
      return {
        jobs: names.map((n) => ({ id: n, entry: n })),
        source: { folder: pub.folder, url: pub.url, ...(pub.md5 ? { md5: pub.md5 } : {}) },
      };
    },
    async runJob(job, dir) {
      const data = await ensureZip(dir);
      const features = readCzZipEntry(data, job.entry!);
      return { features, rawBytes: 0 };
    },
    async finish(dir) {
      zip = null;
      await getEnv().fs!.remove(zipPath(dir)).catch(() => {});
    },
  };
}

/**
 * ES (ENAIRE insignias-MapServer): ein Auftrag je Seite (resultOffset/
 * resultRecordCount, OBJECTID-Reihenfolge), volle Geometrie-Präzision. Liefert
 * der Server weniger als angefragt (exceededTransferLimit), wird innerhalb des
 * Auftrags weitergeblättert – sonst fehlten Zonen.
 *
 * Layer-URLs bei jedem Sync frisch aus der Web Map (esServices.ts, 404 →
 * einmal neu lesen). Ist ein Layer nicht abrufbar (Zählabfrage scheitert),
 * wird der Rest gespeichert („partial“, `source.failedLayers`); seine Zonen
 * werden – falls vorhanden – aus dem bisherigen Bestand übernommen
 * (Auftrag `carry:<key>`, `source.carriedLayers`). Scheitern alle Layer, schlägt
 * der Download fehl (der alte Bestand bleibt).
 */
function esSource(part: TileStorePart): PartSource {
  const layers = esInsigniasLayersOf(part === "infra" ? "infra" : part === "enp" ? "enp" : "base");
  return {
    concurrency: part === "enp" ? 2 : 3,
    async listJobs() {
      await resolveEsLayers(esFetchJson, { fresh: true });
      const jobs: TileJob[] = [];
      let matched = 0;
      const failed: string[] = [];
      let firstErr: unknown = null;
      for (const layer of layers) {
        try {
          const total = await withEsLayer(layer.key, esFetchJson, async (l) => esInsigniasCount(await fetchJson(esInsigniasCountUrl(l), 60_000)));
          if (total == null) throw new Error("Anzahl der Zonen unbekannt");
          jobs.push(...pageJobs(layer.key, total, layer.pageSize));
          matched += total;
        } catch (e) {
          failed.push(layer.key);
          firstErr = firstErr ?? e;
        }
      }
      if (failed.length === layers.length) throw firstErr instanceof Error ? firstErr : new Error("ENAIRE nicht erreichbar");
      const carried: string[] = [];
      if (failed.length > 0) {
        const prev = await previousPartIndex("ES", part);
        for (const key of failed) {
          if (prev && prev.ids.some((id) => id.startsWith(`${key}.`))) {
            jobs.push({ id: `carry:${key}`, layer: key, entry: "carry" });
            carried.push(key);
          }
        }
        console.warn(`[geozoneTiles] ES/${part}: Ebene(n) nicht abrufbar:`, failed.join(", "), carried.length ? `(aus letztem Stand: ${carried.join(", ")})` : "");
      }
      if (matched === 0 && carried.length === 0) throw new Error("Geodienst liefert keine Zonen");
      return {
        jobs,
        source: {
          service: "enaire-insignias",
          matched,
          ...(failed.length ? { failedLayers: failed.join(","), carriedLayers: carried.join(",") } : {}),
        },
      };
    },
    async runJob(job) {
      if (job.entry === "carry") return { features: await carryEsLayerFeatures(part, job.layer!), rawBytes: 0 };
      const known = esInsigniasLayer(job.layer) as EsInsigniasLayer | null;
      if (!known) throw new Error(`Unbekannter ENAIRE-Layer ${job.layer}`);
      return withEsLayer(known.key, esFetchJson, async (layer) => {
        const features: any[] = [];
        let got = 0;
        const want = job.count!;
        for (let guard = 0; guard < 50 && got < want; guard++) {
          const { features: page, exceeded } = arcgisPage(await fetchJson(esInsigniasPageUrl(layer, job.start! + got, want - got)));
          got += page.length;
          for (const f of page) {
            const t = tagEsInsigniasFeature(f, layer.key);
            if (t) features.push(t);
          }
          if (page.length === 0 || !exceeded) break;
        }
        return { features, rawBytes: 0 };
      });
    },
  };
}

/** Index des bisherigen (vollständigen) Bestands eines Teils; null ohne. */
async function previousPartIndex(iso: TileStoreIso, part: TileStorePart): Promise<TileIndexFile | null> {
  const fs = getEnv().fs;
  if (!fs) return null;
  const f = await readIndexFile(fs, partDir(fs, iso, part));
  return f && f.complete ? f : null;
}

/** Zonen eines Layers aus dem bisherigen ES-Bestand (nicht abrufbarer Layer). */
async function carryEsLayerFeatures(part: TileStorePart, key: string): Promise<any[]> {
  const fs = getEnv().fs;
  const prev = await previousPartIndex("ES", part);
  if (!fs || !prev) return [];
  const idx = prev.ids.map((id, i) => (id.startsWith(`${key}.`) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  const bytes = await fs.readRanges(`${partDir(fs, "ES", part)}data.bin`, idx.map((i) => entryRange(prev, i)));
  const out: any[] = [];
  for (const b of bytes) {
    try {
      const f = decodeRecord(b);
      if (f) out.push(f);
    } catch {}
  }
  return out;
}

/** ES: Ebenen, die beim letzten Download fehlten (je Teil); leer = vollständig. */
export function esFailedLayers(): { part: TileStorePart; failed: string[]; carried: string[] }[] {
  const out: { part: TileStorePart; failed: string[]; carried: string[] }[] = [];
  for (const part of tileStorePartsOf("ES")) {
    const src = getTilePartMeta("ES", part)?.source;
    const failed = String(src?.failedLayers ?? "").split(",").filter(Boolean);
    if (failed.length === 0) continue;
    out.push({ part, failed, carried: String(src?.carriedLayers ?? "").split(",").filter(Boolean) });
  }
  return out;
}

/** Deutscher Abdeckungs-Hinweis für einen ES-Teilbestand; null = vollständig. */
export function esPartialNote(): string | null {
  const parts = esFailedLayers();
  if (parts.length === 0) return null;
  const names = parts.flatMap((p) => p.failed.map((k) => esInsigniasLayer(k)?.labelDe ?? k));
  const carried = parts.reduce((n, p) => n + p.carried.length, 0);
  const total = parts.reduce((n, p) => n + p.failed.length, 0);
  const tail = carried === total ? "deren Zonen stammen aus dem letzten Stand" : carried > 0 ? "deren Zonen fehlen bzw. stammen aus dem letzten Stand" : "deren Zonen fehlen";
  return `ENAIRE: ${total} Ebene(n) beim letzten Abruf nicht erreichbar (${names.join(", ")}) – ${tail}`;
}

/** Aktuelle ŘLP-Veröffentlichung (Index-Seite) oder null. */
export async function fetchCzPublication(): Promise<CzPublication | null> {
  try {
    return parseCzUasIndex(await fetchText(CZ_INDEX_URL));
  } catch {
    return null;
  }
}

const running = new Map<string, Promise<TilePartProgress>>();

const PART_LABELS: Record<string, string> = {
  base: "Geozonen",
  wohn: "Geozonen – Wohngrundstücke",
  infra: "Geozonen – Infrastruktur",
  enp: "Geozonen – Naturschutz",
};

async function downloadPart(
  iso: TileStoreIso,
  part: TileStorePart,
  src: PartSource,
  onProgress: (p: TilePartProgress) => void,
  shouldStop: () => boolean,
): Promise<TilePartProgress> {
  // Download-Anzeige (app-weit), auch während die Auftragsliste bzw. das CZ-ZIP geladen wird
  const activityId = beginDownload({ id: `tiles:${iso}:${part}`, iso, labelDe: PART_LABELS[part] ?? "Geozonen", kind: "geozones" });
  try {
    return await downloadPartInner(iso, part, src, (p) => {
      if (p.total > 0) progressDownload(activityId, { doneItems: p.done, totalItems: p.total });
      onProgress(p);
    }, shouldStop);
  } finally {
    endDownload(activityId);
  }
}

async function downloadPartInner(
  iso: TileStoreIso,
  part: TileStorePart,
  src: PartSource,
  onProgress: (p: TilePartProgress) => void,
  shouldStop: () => boolean,
): Promise<TilePartProgress> {
  const fs = getEnv().fs;
  if (!fs) throw new Error("Dateisystem nicht verfügbar");
  const dir = stagingDir(fs, iso, part);
  await fs.mkdirp(dir);
  let idx = await readIndexFile(fs, dir);
  if (!idx || idx.iso !== iso || idx.part !== part || idx.jobs.length === 0) {
    idx = emptyIndex(iso, part);
    await fs.remove(`${dir}data.bin`).catch(() => {});
    const { jobs, source } = await src.listJobs(dir);
    idx.jobs = jobs;
    idx.source = source;
    await fs.writeText(`${dir}index.json`, await stringifyYielding(idx));
  }
  const file = idx;
  const seen = new Set(file.ids);
  const doneSet = new Set(file.done);
  const dataPath = `${dir}data.bin`;
  let dataSize = (await fs.exists(dataPath)) ? await fs.size(dataPath) : 0;
  const pending = file.jobs.filter((j) => !doneSet.has(j.id));
  const totalJobs = file.jobs.length;
  const progress = (state: TilePartProgress["state"], error?: string): TilePartProgress => {
    const p: TilePartProgress = { iso, part, done: doneSet.size, total: totalJobs, bytes: file.dataBytes, state, ...(error ? { error } : {}) };
    onProgress(p);
    return p;
  };
  progress("active");

  let lastSave = Date.now();
  let failed: Error | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  const worker = async () => {
    while (!failed && !shouldStop()) {
      const job = pending.shift();
      if (!job) return;
      let res: { features: any[]; rawBytes: number };
      try {
        res = await src.runJob(job, dir);
      } catch (e) {
        failed = e instanceof Error ? e : new Error(String(e));
        return;
      }
      // Anhängen strikt nacheinander (Offsets = Dateigröße)
      // CPU-Phase (Komprimieren, Index) als Hintergrund-Job: nacheinander mit
      // anderen schweren Phasen, in Zeitscheiben, pausiert bei Interaktion
      writeChain = writeChain.then(() => runInBackground(`tiles:${iso}:${part}:${job.id}`, async (ctx) => {
        const { bytes } = await appendFeaturesYielding(file, seen, res.features, dataSize, ctx);
        if (bytes.length > 0) {
          await fs.appendBytes(dataPath, bytes);
          dataSize += bytes.length;
        }
        file.rawBytes += res.rawBytes;
        file.done.push(job.id);
        doneSet.add(job.id);
        if (Date.now() - lastSave > 15_000) {
          lastSave = Date.now();
          await fs.writeText(`${dir}index.json`, await stringifyYielding(file, ctx));
        }
        progress("active");
      }));
      await writeChain;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, src.concurrency) }, worker));
  await writeChain.catch((e) => {
    failed = failed ?? (e instanceof Error ? e : new Error(String(e)));
  });
  await fs.writeText(`${dir}index.json`, await stringifyYielding(file));
  if (failed) return progress("error", (failed as Error).message || "Download fehlgeschlagen");
  if (doneSet.size < totalJobs) return progress("inactive");

  if (file.ids.length === 0) {
    await fs.remove(dir).catch(() => {});
    return progress("error", "Keine Zonen erhalten");
  }
  // vollständig -> alten Bestand ersetzen (Auftragsliste wird nicht mehr gebraucht)
  file.complete = true;
  file.createdAt = Date.now();
  file.jobs = [];
  file.done = [];
  await fs.writeText(`${dir}index.json`, await stringifyYielding(file));
  await fs.writeText(`${dir}meta.json`, JSON.stringify(metaOf(file)));
  await src.finish?.(dir);
  const target = partDir(fs, iso, part);
  await fs.remove(target).catch(() => {});
  await fs.move(dir, target);
  metaCache.set(`${iso}/${part}`, metaOf(file));
  notify();
  return progress("complete");
}

export interface TileStoreDownloadOptions {
  /** DE: Wohngrundstücke mitspeichern */
  wohn?: boolean;
  /** Abwählbare Zusatzteile (ES: "infra", "enp"; DE alternativ "wohn") */
  parts?: TileStorePart[];
  /** auch einen aktuellen, vollständigen Bestand neu laden */
  force?: boolean;
  onProgress?: (p: TilePartProgress) => void;
  shouldStop?: () => boolean;
}

/**
 * Lädt bzw. setzt den Offline-Bestand eines Landes fort (alle Teile). Nicht
 * gewählte Zusatzteile (DE ohne `wohn`, ES ohne "infra"/"enp") werden gelöscht.
 */
export async function downloadTileStore(rawIso: string, opts: TileStoreDownloadOptions = {}): Promise<TilePartProgress[]> {
  const iso = String(rawIso || "").toUpperCase();
  if (!isTileStoreIso(iso)) return [];
  await loadTileStoreMeta();
  const optional = TILE_STORE_OPTIONAL_PARTS[iso];
  const wanted = optional.filter((p) => (opts.parts ?? []).includes(p) || (p === "wohn" && !!opts.wohn));
  for (const p of optional) if (!wanted.includes(p)) await deleteTileStore(iso, p);
  const parts: TileStorePart[] = ["base", ...wanted];
  const out: TilePartProgress[] = [];
  for (const part of parts) {
    if (opts.shouldStop?.()) break;
    const key = `${iso}/${part}`;
    const meta = getTilePartMeta(iso, part);
    if (meta?.complete && !opts.force && !(await tileStoreRefreshDue(iso).catch(() => false))) {
      const r: TilePartProgress = { iso, part, done: 1, total: 1, bytes: meta.dataBytes, state: "complete" };
      opts.onProgress?.(r);
      out.push(r);
      continue;
    }
    let p = running.get(key);
    if (!p) {
      const src = iso === "CZ" ? czSource() : iso === "ES" ? esSource(part) : wfsSource(iso, part);
      p = downloadPart(iso, part, src, opts.onProgress ?? (() => {}), opts.shouldStop ?? (() => false))
        .catch((e) => {
          const r: TilePartProgress = { iso, part, done: 0, total: 0, bytes: 0, state: "error", error: e?.message || "Download fehlgeschlagen" };
          opts.onProgress?.(r);
          return r;
        })
        .finally(() => running.delete(key));
      running.set(key, p);
    }
    const r = await p;
    out.push(r);
    if (r.state !== "complete") break;
  }
  return out;
}

/** Löscht einen Bestand (ein Teil oder alles inkl. laufender Downloads). */
export async function deleteTileStore(rawIso: string, part?: TileStorePart): Promise<void> {
  const iso = String(rawIso || "").toUpperCase();
  const fs = getEnv().fs;
  if (!fs || !isTileStoreIso(iso)) return;
  const parts: TileStorePart[] = part ? [part] : tileStorePartsOf(iso);
  for (const p of parts) {
    await fs.remove(partDir(fs, iso, p)).catch(() => {});
    await fs.remove(stagingDir(fs, iso, p)).catch(() => {});
    metaCache.delete(`${iso}/${p}`);
    for (const k of [...indexCache.keys()]) if (k.startsWith(`${iso}/${p}/`)) indexCache.delete(k);
  }
  if (!part) await fs.remove(`${fs.root()}${iso.toLowerCase()}/`).catch(() => {});
  notify();
}

/** Fortschritt eines (laufenden/abgebrochenen) Downloads aus dem staging-Index. */
export async function stagedProgress(rawIso: string, part: TileStorePart): Promise<{ done: number; total: number; bytes: number } | null> {
  const fs = getEnv().fs;
  const iso = String(rawIso || "").toUpperCase();
  if (!fs || !isTileStoreIso(iso)) return null;
  const f = await readIndexFile(fs, stagingDir(fs, iso, part));
  return f ? { done: f.done.length, total: f.jobs.length, bytes: f.dataBytes } : null;
}

/**
 * Muss der Bestand neu geladen werden? Älter als 28 Tage (AIRAC) oder – CZ –
 * die ŘLP hat einen neuen Veröffentlichungsordner.
 */
export async function tileStoreRefreshDue(rawIso: string, now = Date.now()): Promise<boolean> {
  return (await tileStoreVersionCheck(rawIso, now)).due;
}

export type TileStoreDueReason = "age" | "airac" | "cz-folder" | "fr-count" | "es-partial";

/** ES: Teilbestand (Ebene fehlte) nach diesem Alter erneut laden (Doku: täglich). */
export const ES_PARTIAL_RETRY_MS = 24 * 60 * 60 * 1000;

export interface TileStoreVersionCheck {
  due: boolean;
  reason: TileStoreDueReason | null;
}

/**
 * Teil A: günstige Prüfung auf eine neue Fassung, OHNE das Paket zu laden.
 * - Alter > 28 Tage (AIRAC) → fällig
 * - DE (dipul) und FR: Paket vor Beginn des aktuellen AIRAC-Zyklus erstellt
 *   (dipul veröffentlicht zum AIRAC-Stichtag; WFS liefert weder ETag noch
 *   Last-Modified)
 * - FR zusätzlich (online): Trefferzahl des WFS (resultType=hits) weicht von
 *   der gespeicherten Zonenzahl ab
 * - CZ (online): neuer Veröffentlichungsordner auf der ŘLP-Indexseite
 */
export async function tileStoreVersionCheck(rawIso: string, now = Date.now()): Promise<TileStoreVersionCheck> {
  const iso = String(rawIso || "").toUpperCase();
  await loadTileStoreMeta();
  const meta = getTilePartMeta(iso, "base");
  if (!meta) return { due: false, reason: null }; // nichts gespeichert -> nichts zu erneuern
  if (isIndexStale(meta, now)) return { due: true, reason: "age" };
  // DE (dipul), FR und ES (ENAIRE aktualisiert an AIRAC-Donnerstagen): Paket vor Beginn des aktuellen Zyklus
  if ((iso === "DE" || iso === "FR" || iso === "ES") && isBeforeCurrentAirac(meta.createdAt, now)) return { due: true, reason: "airac" };
  // ES: beim letzten Download fehlte eine Ebene → nach einem Tag erneut versuchen
  if (iso === "ES") {
    for (const p of esFailedLayers()) {
      const m = getTilePartMeta("ES", p.part);
      if (m && now - m.createdAt > ES_PARTIAL_RETRY_MS) return { due: true, reason: "es-partial" };
    }
  }
  const env = getEnv();
  if (env.isOffline()) return { due: false, reason: null };
  if (iso === "CZ") {
    const pub = await fetchCzPublication();
    if (pub && meta.source?.folder && pub.folder !== meta.source.folder) return { due: true, reason: "cz-folder" };
  }
  if (iso === "FR") {
    try {
      const total = wfsMatched(await fetchJson(wfsCountUrl("FR", "fr"), 15_000, 0));
      const stored = Number(meta.source?.matched);
      if (total != null && total > 0 && Number.isFinite(stored) && stored > 0 && total !== stored) return { due: true, reason: "fr-count" };
    } catch {}
  }
  return { due: false, reason: null };
}

/**
 * Hintergrund-Aktualisierung beim App-Start: nur online und im WLAN (oder mit
 * Erlaubnis für mobile Daten), nur für
 * Länder mit vorhandenem Bestand, wenn fällig. Fehler bleiben folgenlos (der
 * alte Bestand bleibt erhalten).
 */
export async function refreshDueTileStores(): Promise<void> {
  const env = getEnv();
  if (!env.fs || env.isOffline()) return;
  await loadTileStoreMeta();
  await awaitCountryUsage();
  for (const iso of tiledGeozoneIsos()) {
    try {
      await waitForIdle();
      // Länder-Nutzung: aktive Länder (online/offline) halten ihr Paket aktuell
      if (!isGeozoneSourceEnabled(iso)) continue;
      if (!(await tileStoreRefreshDue(iso))) continue;
      // Teil A: große Pakete nur im WLAN, außer „auch über mobile Daten“ ist erlaubt
      if (!mayDownloadLargePack(await env.isWifi(), await loadLargePacksOnMobile())) return;
      // Während der Aktualisierung liegen alter und neuer Bestand nebeneinander
      const stored = tileStorePartsOf(iso).filter((p) => !!getTilePartMeta(iso, p));
      const need = stored.reduce((n, p) => n + (getTilePartMeta(iso, p)?.dataBytes ?? 0), 0) * 1.3;
      const free = await env.fs.freeBytes?.().catch(() => null);
      if (free != null && free < need) continue;
      await downloadTileStore(iso, { parts: stored.filter((p) => p !== "base"), force: true });
    } catch {}
  }
}

/**
 * Beim App-Start: Metadaten laden, CZ als „eigene Daten“ markieren, sobald ein
 * Bestand vorliegt (hasOwnMap), und fällige Aktualisierungen anstoßen.
 */
export function startGeozoneTileStore(refreshDelayMs = 60_000): void {
  const syncFlags = () => setCountryAccessAvailable("CZ", hasTiledGeozones("CZ"));
  onTileStoreChange(syncFlags);
  loadTileStoreMeta()
    .then(syncFlags)
    .catch(() => {});
  // nach dem Start-Bildschirm/Interaktionen; die Länder einzeln (refreshDueTileStores)
  runAfterStartup(() => {
    refreshDueTileStores().catch(() => {});
  }, refreshDelayMs);
}
