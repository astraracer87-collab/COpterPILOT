// Offline-Kachelspeicher der Vektor-Geozonen für DE (dipul-WFS), FR (IGN/
// Géoplateforme-WFS) und CZ (ŘLP ED-318-Kacheln): Download mit Fortschritt,
// Pause/Fortsetzen und Wiederholungen, Lesen nach Punkt/Ausschnitt.
//
// Ablage (siehe tileStoreCore.ts):
//   documentDirectory/geozone-tiles/<iso>/<part>/{data.bin,index.json,meta.json}
//   documentDirectory/geozone-tiles/<iso>/<part>.staging/…   (laufender Download)
//   documentDirectory/geozone-tiles/de/temp.json                (temporäre dipul-Zonen)
// part = "base" (alle Zonen) bzw. "wohn" (DE: Wohngrundstücke, abwählbar).
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
  appendFeatures,
  bboxAround,
  bboxIntersects,
  decodeRecord,
  dipulPageUrl,
  emptyIndex,
  entryRange,
  frPageUrl,
  geometryBBox,
  isIndexStale,
  isTileStoreIso,
  listCzZipEntries,
  loadIndex,
  pageJobs,
  parseCzUasIndex,
  queryIndex,
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
} from "./tileStoreCore";
import { dedupeZones, dipulLayerOfId, zoneFromStored } from "./tileZones";
import { setCountryAccessAvailable } from "../../../shared/countryDetection";

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
  };
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
  metaLoaded = null;
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
    for (const iso of ["DE", "FR", "CZ"] as TileStoreIso[]) {
      for (const part of ["base", "wohn"] as TileStorePart[]) {
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
  return (["DE", "FR", "CZ"] as TileStoreIso[]).filter((i) => hasTiledGeozones(i));
}

async function readIndexFile(fs: TileFs, dir: string): Promise<TileIndexFile | null> {
  try {
    const raw = await fs.readText(`${dir}index.json`);
    if (!raw) return null;
    const f = JSON.parse(raw) as TileIndexFile;
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
      return f && f.complete ? loadIndex(f) : null;
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
    missing.forEach((i, n) => {
      let z: GeozoneFeatureInfo | null = null;
      try {
        z = zoneFromStored(iso, decodeRecord(bytes[n]));
      } catch {
        z = null;
      }
      cacheZone(prefix + i, z, (bytes[n]?.length ?? 0) * 4);
    });
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
  /** DE: temporäre Beschränkungen mitliefern (Standard: ja) */
  includeTemp?: boolean;
}

/**
 * Zonen eines Landes im Ausschnitt aus dem Offline-Bestand. null, wenn kein
 * vollständiger Bestand vorliegt (Aufrufer nutzt dann den Online-Pfad).
 */
export async function queryTiledGeozones(
  rawIso: string,
  bbox: LngLatBBox,
  opts: TiledQueryOptions = {},
): Promise<GeozoneFeatureInfo[] | null> {
  const iso = String(rawIso || "").toUpperCase();
  if (!isTileStoreIso(iso)) return null;
  await loadTileStoreMeta();
  const base = await getLoadedIndex(iso, "base");
  if (!base) return null;
  const layerSet = iso === "DE" && opts.layers && opts.layers.length > 0 ? new Set(opts.layers) : null;
  const filter = layerSet ? (id: string) => layerSet.has(dipulLayerOfId(id)) : undefined;
  const zones: GeozoneFeatureInfo[] = [];
  zones.push(...(await readZones(iso, "base", base, queryIndex(base, bbox, { filter, limit: opts.limit }))));
  if (iso === "DE" && (!layerSet || layerSet.has(DIPUL_WOHN_LAYER))) {
    const wohn = await getLoadedIndex(iso, "wohn");
    if (wohn) zones.push(...(await readZones(iso, "wohn", wohn, queryIndex(wohn, bbox, { limit: opts.limit }))));
  }
  if (iso === "DE" && opts.includeTemp !== false && (!layerSet || layerSet.has(DIPUL_TEMP_LAYER))) {
    zones.push(...(await getDeTempZones(bbox)));
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

export const DE_TEMP_CACHE_MS = 10 * 60 * 1000;
let tempCache: { at: number; features: any[] } | null = null;
let tempInFlight: Promise<any[]> | null = null;

export async function getDeTempFeatures(): Promise<any[]> {
  const env = getEnv();
  const now = Date.now();
  if (tempCache && now - tempCache.at < DE_TEMP_CACHE_MS) return tempCache.features;
  if (!env.isOffline()) {
    if (!tempInFlight) {
      tempInFlight = (async () => {
        try {
          const data = await fetchJson(dipulPageUrl(DIPUL_TEMP_LAYER, 0, 1000), 20000, 1);
          const features = Array.isArray(data?.features) ? data.features : null;
          if (features) {
            tempCache = { at: Date.now(), features };
            const fs = env.fs;
            if (fs) {
              await fs.mkdirp(`${fs.root()}de/`).catch(() => {});
              await fs.writeText(tempPath(fs), JSON.stringify({ fetchedAt: Date.now(), features })).catch(() => {});
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
    if (live.length > 0 || tempCache) return tempCache?.features ?? live;
  }
  const fs = env.fs;
  if (!fs) return tempCache?.features ?? [];
  try {
    const raw = await fs.readText(tempPath(fs));
    const parsed = raw ? JSON.parse(raw) : null;
    const features = Array.isArray(parsed?.features) ? parsed.features : [];
    // offline: nicht dauerhaft cachen, damit online sofort wieder live geladen wird
    tempCache = { at: now - DE_TEMP_CACHE_MS + 60_000, features };
    return features;
  } catch {
    return [];
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
    if (z.validEndTs != null && z.validEndTs < now) continue;
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
      return await res.json();
    } catch (e) {
      lastErr = e;
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
      }
      return { jobs, source: { service: iso === "FR" ? "geopf-wfs" : "dipul-wfs" } };
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

/** Aktuelle ŘLP-Veröffentlichung (Index-Seite) oder null. */
export async function fetchCzPublication(): Promise<CzPublication | null> {
  try {
    return parseCzUasIndex(await fetchText(CZ_INDEX_URL));
  } catch {
    return null;
  }
}

const running = new Map<string, Promise<TilePartProgress>>();

async function downloadPart(
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
    await fs.writeText(`${dir}index.json`, JSON.stringify(idx));
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
      writeChain = writeChain.then(async () => {
        const { bytes } = appendFeatures(file, seen, res.features, dataSize);
        if (bytes.length > 0) {
          await fs.appendBytes(dataPath, bytes);
          dataSize += bytes.length;
        }
        file.rawBytes += res.rawBytes;
        file.done.push(job.id);
        doneSet.add(job.id);
        if (Date.now() - lastSave > 15_000) {
          lastSave = Date.now();
          await fs.writeText(`${dir}index.json`, JSON.stringify(file));
        }
        progress("active");
      });
      await writeChain;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, src.concurrency) }, worker));
  await writeChain;
  await fs.writeText(`${dir}index.json`, JSON.stringify(file));
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
  await fs.writeText(`${dir}index.json`, JSON.stringify(file));
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
  /** auch einen aktuellen, vollständigen Bestand neu laden */
  force?: boolean;
  onProgress?: (p: TilePartProgress) => void;
  shouldStop?: () => boolean;
}

/**
 * Lädt bzw. setzt den Offline-Bestand eines Landes fort (alle Teile). DE ohne
 * `wohn` löscht einen vorhandenen Wohngrundstücke-Bestand.
 */
export async function downloadTileStore(rawIso: string, opts: TileStoreDownloadOptions = {}): Promise<TilePartProgress[]> {
  const iso = String(rawIso || "").toUpperCase();
  if (!isTileStoreIso(iso)) return [];
  await loadTileStoreMeta();
  const parts: TileStorePart[] = iso === "DE" && opts.wohn ? ["base", "wohn"] : ["base"];
  if (iso === "DE" && !opts.wohn) await deleteTileStore("DE", "wohn");
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
      const src = iso === "CZ" ? czSource() : wfsSource(iso, part);
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
  const parts: TileStorePart[] = part ? [part] : ["base", "wohn"];
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
  const iso = String(rawIso || "").toUpperCase();
  await loadTileStoreMeta();
  const meta = getTilePartMeta(iso, "base");
  if (!meta) return false; // nichts gespeichert -> nichts zu erneuern
  if (isIndexStale(meta, now)) return true;
  if (iso === "CZ" && !getEnv().isOffline()) {
    const pub = await fetchCzPublication();
    if (pub && meta.source?.folder && pub.folder !== meta.source.folder) return true;
  }
  return false;
}

/**
 * Hintergrund-Aktualisierung beim App-Start: nur online und im WLAN, nur für
 * Länder mit vorhandenem Bestand, wenn fällig. Fehler bleiben folgenlos (der
 * alte Bestand bleibt erhalten).
 */
export async function refreshDueTileStores(): Promise<void> {
  const env = getEnv();
  if (!env.fs || env.isOffline()) return;
  await loadTileStoreMeta();
  for (const iso of tiledGeozoneIsos()) {
    try {
      if (!(await tileStoreRefreshDue(iso))) continue;
      if (!(await env.isWifi())) return;
      // Während der Aktualisierung liegen alter und neuer Bestand nebeneinander
      const need = ((getTilePartMeta(iso, "base")?.dataBytes ?? 0) + (getTilePartMeta(iso, "wohn")?.dataBytes ?? 0)) * 1.3;
      const free = await env.fs.freeBytes?.().catch(() => null);
      if (free != null && free < need) continue;
      await downloadTileStore(iso, { wohn: !!getTilePartMeta(iso, "wohn"), force: true });
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
  setTimeout(() => {
    refreshDueTileStores().catch(() => {});
  }, refreshDelayMs);
}
