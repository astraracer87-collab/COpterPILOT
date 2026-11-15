// Offline-Kachelspeicher für Vektor-Geozonen großer Länder (DE/FR/CZ) – reine
// Logik ohne React-Native-/Expo-Importe (unter tsx/Node testbar).
//
// Warum kein „eine Datei pro Kachel mit allen Zonen darin“?
// Gemessen (Nov. 2026): Viele Zonen sind sehr groß (Bundesautobahn A2 ≈ 1,5 MB,
// 5,7° breit; FFH-Gebiete, Bundesstraßen, Wohngrundstücke ganzer Städte). Bei
// 0,25°-Kacheln läge jede solche Zone in Dutzenden Kacheln – der Speicher
// wüchse für DE um den Faktor ≈ 7. Daher:
//
//  - Jede Zone wird GENAU EINMAL gespeichert, unverändert (dipul CC BY-ND 4.0:
//    keine Vereinfachung/Änderung der Geometrie), als verlustfrei komprimierter
//    Datensatz (raw DEFLATE des Feature-JSON) in einer Append-Datei `data.bin`.
//  - Ein räumlicher Index (`index.json`) führt pro Zone Offset, Länge,
//    Bounding-Box und ID. Beim Laden wird daraus ein 0,25°-Kachelraster
//    gebaut (Kachel -> Zonen, deren BBox sie schneidet). Abfragen lesen nur die
//    Datensätze der Kacheln, die Punkt bzw. Kartenausschnitt schneiden; eine
//    über mehrere Kacheln reichende Zone wird beim Lesen per ID dedupliziert.
//
// Das Parsen in das App-Modell (GeozoneFeatureInfo) passiert erst beim Lesen
// (tileZones.ts).
import { deflateSync, inflateSync, strFromU8, strToU8, unzipSync } from "fflate";

/** Kantenlänge der Indexkacheln in Grad */
export const TILE_CELL_DEG = 0.25;
export const TILE_STORE_VERSION = 1;
/** Neu laden, wenn der Bestand älter ist (AIRAC-Zyklus) */
export const TILE_STORE_REFRESH_MS = 28 * 24 * 60 * 60 * 1000;

export type LngLatBBox = [number, number, number, number]; // w, s, e, n

export type TileStoreIso = "DE" | "FR" | "CZ";
export type TileStorePart = "base" | "wohn";
export const TILE_STORE_ISOS: TileStoreIso[] = ["DE", "FR", "CZ"];

export function isTileStoreIso(iso: string | null | undefined): iso is TileStoreIso {
  return (TILE_STORE_ISOS as string[]).includes(String(iso || "").toUpperCase());
}

/** Ein Download-Auftrag (eine WFS-Seite bzw. eine CZ-Kacheldatei). */
export interface TileJob {
  id: string;
  layer?: string;
  start?: number;
  count?: number;
  /** CZ: Dateiname im ZIP */
  entry?: string;
}

/** Inhalt von index.json eines Teilbestands. */
export interface TileIndexFile {
  v: number;
  iso: TileStoreIso;
  part: TileStorePart;
  cell: number;
  /** Zeitpunkt, an dem der Bestand vollständig war (ms) */
  createdAt: number;
  complete: boolean;
  /** Herkunft (z. B. CZ-Veröffentlichungsordner) */
  source?: Record<string, string | number>;
  /** flach: [offset, länge, w, s, e, n] je Zone */
  entries: number[];
  ids: string[];
  jobs: TileJob[];
  done: string[];
  /** komprimierte Größe von data.bin (referenzierter Teil) */
  dataBytes: number;
  /** übertragene Bytes (unkomprimiert, wie geliefert) */
  rawBytes: number;
}

export function emptyIndex(iso: TileStoreIso, part: TileStorePart): TileIndexFile {
  return {
    v: TILE_STORE_VERSION,
    iso,
    part,
    cell: TILE_CELL_DEG,
    createdAt: 0,
    complete: false,
    entries: [],
    ids: [],
    jobs: [],
    done: [],
    dataBytes: 0,
    rawBytes: 0,
  };
}

// ---------------------------------------------------------------------------
// Kachel-Mathematik
// ---------------------------------------------------------------------------

export function cellOf(lon: number, lat: number, cell = TILE_CELL_DEG): [number, number] {
  return [Math.floor(lon / cell), Math.floor(lat / cell)];
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Alle Kacheln, die eine BBox schneidet (inklusive Rand). */
export function cellsForBBox(b: LngLatBBox, cell = TILE_CELL_DEG): [number, number][] {
  const [x0, y0] = cellOf(b[0], b[1], cell);
  const [x1, y1] = cellOf(b[2], b[3], cell);
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

/** BBox einer Kachel */
export function cellBBox(x: number, y: number, cell = TILE_CELL_DEG): LngLatBBox {
  return [x * cell, y * cell, (x + 1) * cell, (y + 1) * cell];
}

export function bboxIntersects(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** BBox um einen Punkt mit Radius in km */
export function bboxAround(lat: number, lon: number, radiusKm: number): LngLatBBox {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

const ROUND = 1e5;
/**
 * BBox einer GeoJSON-Geometrie (lon/lat), nach außen auf 1e-5° gerundet (nur
 * für den Index – die gespeicherte Geometrie bleibt unverändert). null ohne
 * Koordinaten.
 */
export function geometryBBox(geometry: any): LngLatBBox | null {
  if (!geometry || !geometry.coordinates) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const walk = (c: any): void => {
    if (!Array.isArray(c) || c.length === 0) return;
    if (typeof c[0] === "number") {
      const x = c[0];
      const y = c[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
      return;
    }
    for (const sub of c) walk(sub);
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(w)) return null;
  return [Math.floor(w * ROUND) / ROUND, Math.floor(s * ROUND) / ROUND, Math.ceil(e * ROUND) / ROUND, Math.ceil(n * ROUND) / ROUND];
}

// ---------------------------------------------------------------------------
// Index laden + abfragen
// ---------------------------------------------------------------------------

export interface LoadedTileIndex {
  file: TileIndexFile;
  /** Kachel -> Zonen-Indizes */
  grid: Map<string, number[]>;
}

export function buildGrid(file: TileIndexFile): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  const e = file.entries;
  const cell = file.cell || TILE_CELL_DEG;
  for (let i = 0, k = 0; k + 5 < e.length; i++, k += 6) {
    const b: LngLatBBox = [e[k + 2], e[k + 3], e[k + 4], e[k + 5]];
    for (const [x, y] of cellsForBBox(b, cell)) {
      const key = cellKey(x, y);
      let list = grid.get(key);
      if (!list) {
        list = [];
        grid.set(key, list);
      }
      list.push(i);
    }
  }
  return grid;
}

export function loadIndex(file: TileIndexFile): LoadedTileIndex {
  return { file, grid: buildGrid(file) };
}

export function entryBBox(file: TileIndexFile, i: number): LngLatBBox {
  const k = i * 6;
  return [file.entries[k + 2], file.entries[k + 3], file.entries[k + 4], file.entries[k + 5]];
}

export function entryRange(file: TileIndexFile, i: number): [number, number] {
  return [file.entries[i * 6], file.entries[i * 6 + 1]];
}

export interface IndexQuery {
  /** nur Zonen-IDs, für die filter true liefert (z. B. DE-Ebenen) */
  filter?: (id: string) => boolean;
  /** höchstens so viele, die der BBox-Mitte nächsten zuerst */
  limit?: number;
}

/**
 * Zonen-Indizes, deren BBox die Abfrage-BBox schneidet. Liest nur die
 * Kacheln, die die Abfrage schneidet; Zonen über mehrere Kacheln kommen
 * einmal heraus (dedupliziert). Ergebnis nach Datei-Offset sortiert.
 */
export function queryIndex(idx: LoadedTileIndex, q: LngLatBBox, opts: IndexQuery = {}): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  const f = idx.file;
  for (const [x, y] of cellsForBBox(q, f.cell || TILE_CELL_DEG)) {
    const list = idx.grid.get(cellKey(x, y));
    if (!list) continue;
    for (const i of list) {
      if (seen.has(i)) continue;
      seen.add(i);
      const k = i * 6;
      if (f.entries[k + 2] > q[2] || f.entries[k + 4] < q[0] || f.entries[k + 3] > q[3] || f.entries[k + 5] < q[1]) continue;
      if (opts.filter && !opts.filter(f.ids[i] ?? "")) continue;
      out.push(i);
    }
  }
  let res = out;
  if (opts.limit && opts.limit > 0 && res.length > opts.limit) {
    const cx = (q[0] + q[2]) / 2;
    const cy = (q[1] + q[3]) / 2;
    const d2 = (i: number) => {
      const k = i * 6;
      const dx = (f.entries[k + 2] + f.entries[k + 4]) / 2 - cx;
      const dy = (f.entries[k + 3] + f.entries[k + 5]) / 2 - cy;
      return dx * dx + dy * dy;
    };
    res = [...res].sort((a, b) => d2(a) - d2(b)).slice(0, opts.limit);
  }
  return res.sort((a, b) => f.entries[a * 6] - f.entries[b * 6]);
}

// ---------------------------------------------------------------------------
// Datensätze (verlustfrei komprimiertes Feature-JSON)
// ---------------------------------------------------------------------------

export function encodeRecord(feature: unknown): Uint8Array {
  return deflateSync(strToU8(JSON.stringify(feature)), { level: 6 });
}

export function decodeRecord(bytes: Uint8Array): any {
  return JSON.parse(strFromU8(inflateSync(bytes)));
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** FNV-1a über einen String (kurzer Schlüssel für CZ-Dubletten). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/**
 * Speicher-Schlüssel eines Features (Dedupe beim Schreiben, z. B. nach einem
 * fortgesetzten Download). DE/FR: WFS-Feature-ID (`kontrollzonen.12`). CZ:
 * ED-318-`identifier` ist NICHT eindeutig (z. B. „PIS005 zone I/III“) und
 * an Kachelgrenzen geschnittene Zonen tragen dieselbe ID mit anderer
 * Geometrie – daher ID + Hash(Name + Geometrie). Exakte Kopien aus der
 * 2,3-km-Überlappung benachbarter Kacheln fallen so weg.
 */
export function featureStoreKey(iso: TileStoreIso, f: any): string | null {
  if (!f || typeof f !== "object") return null;
  if (iso === "CZ") {
    const p = f.properties || {};
    const id = String(p.identifier ?? "");
    return `${id}#${fnv1a(JSON.stringify(p.name ?? "") + JSON.stringify(f.geometry ?? null))}`;
  }
  return f.id != null ? String(f.id) : null;
}

export interface AppendResult {
  bytes: Uint8Array;
  added: number;
}

/**
 * Hängt neue Features an den Index an (Offsets ab `dataSize`) und liefert die
 * zu schreibenden Bytes. Bereits bekannte Schlüssel (`seen`) und Features ohne
 * Geometrie werden übersprungen.
 */
export function appendFeatures(
  idx: TileIndexFile,
  seen: Set<string>,
  features: any[],
  dataSize: number,
): AppendResult {
  const chunks: Uint8Array[] = [];
  let off = dataSize;
  let added = 0;
  for (const f of features) {
    const key = featureStoreKey(idx.iso, f);
    if (!key || seen.has(key)) continue;
    const bb = geometryBBox(f?.geometry);
    if (!bb) continue;
    const rec = encodeRecord(f);
    chunks.push(rec);
    idx.entries.push(off, rec.length, bb[0], bb[1], bb[2], bb[3]);
    idx.ids.push(key);
    seen.add(key);
    off += rec.length;
    added++;
  }
  const bytes = concatBytes(chunks);
  idx.dataBytes += bytes.length;
  return { bytes, added };
}

// ---------------------------------------------------------------------------
// Quellen: DE (dipul-WFS), FR (Géoplateforme-WFS), CZ (ŘLP ED-318)
// ---------------------------------------------------------------------------

export const DIPUL_WFS_BASE = "https://uas-betrieb.de/geoservices/dipul/ows";
export const FR_WFS_BASE = "https://data.geopf.fr/wfs/ows";
export const FR_WFS_LAYER = "TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf";
export const CZ_INDEX_URL = "https://aim.rlp.cz/?lang=en&p=uas-gz";
export const CZ_BASE_URL = "https://aim.rlp.cz";

/** Permanente dipul-WFS-Ebenen (ohne Wohngrundstücke und temporäre). */
export const DIPUL_STORE_LAYERS = [
  "flughaefen",
  "flugplaetze",
  "kontrollzonen",
  "flugbeschraenkungsgebiete",
  "militaerische_anlagen",
  "behoerden",
  "diplomatische_vertretungen",
  "internationale_organisationen",
  "justizvollzugsanstalten",
  "polizei",
  "sicherheitsbehoerden",
  "krankenhaeuser",
  "labore",
  "kraftwerke",
  "umspannwerke",
  "stromleitungen",
  "windkraftanlagen",
  "industrieanlagen",
  "bundesautobahnen",
  "bundesstrassen",
  "bahnanlagen",
  "binnenwasserstrassen",
  "seewasserstrassen",
  "schifffahrtsanlagen",
  "naturschutzgebiete",
  "nationalparks",
  "vogelschutzgebiete",
  "ffh-gebiete",
  "freibaeder",
] as const;
export const DIPUL_WOHN_LAYER = "wohngrundstuecke";
export const DIPUL_TEMP_LAYER = "temporaere_betriebseinschraenkungen";

/**
 * Seitengröße je Ebene, so gewählt, dass eine Antwort meist < ~6 MB bleibt
 * (gemessen: Autobahnen ≈ 155 KB/Zone in den ersten Seiten, Bundesstraßen
 * ≈ 100 KB, FFH ≈ 32 KB, Wohngrundstücke ≈ 45 KB, Industrie ≈ 2,3 KB).
 */
export const DIPUL_PAGE_SIZE: Record<string, number> = {
  bundesautobahnen: 25,
  bundesstrassen: 50,
  binnenwasserstrassen: 100,
  seewasserstrassen: 4,
  nationalparks: 8,
  vogelschutzgebiete: 100,
  "ffh-gebiete": 200,
  naturschutzgebiete: 500,
  bahnanlagen: 500,
  stromleitungen: 300,
  wohngrundstuecke: 100,
};
export const DIPUL_DEFAULT_PAGE = 1000;
export const FR_PAGE_SIZE = 2000;

export function dipulPageUrl(layer: string, start: number, count: number): string {
  const p = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: `dipul:${layer}`,
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
    COUNT: String(count),
    STARTINDEX: String(start),
  });
  return `${DIPUL_WFS_BASE}?${p}`;
}

export function frPageUrl(start: number, count: number): string {
  const p = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: FR_WFS_LAYER,
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:4326",
    COUNT: String(count),
    STARTINDEX: String(start),
  });
  return `${FR_WFS_BASE}?${p}`;
}

/**
 * Zähl-Abfrage (numberMatched). dipul beantwortet COUNT=0 korrekt, die
 * Géoplateforme liefert bei COUNT=0 aber 0 – dort COUNT=1 ohne Geometrie.
 */
export function wfsCountUrl(iso: "DE" | "FR", layer: string): string {
  if (iso === "DE") return dipulPageUrl(layer, 0, 0);
  return `${frPageUrl(0, 1)}&PROPERTYNAME=limite`;
}

/** Seiten-Aufträge einer Ebene aus der Gesamtzahl (numberMatched). */
export function pageJobs(layer: string, total: number, pageSize: number): TileJob[] {
  const out: TileJob[] = [];
  const size = Math.max(1, Math.floor(pageSize));
  for (let s = 0; s < total; s += size) out.push({ id: `${layer}@${s}`, layer, start: s, count: size });
  return out;
}

/** numberMatched/totalFeatures einer WFS-JSON-Antwort, sonst null. */
export function wfsMatched(data: any): number | null {
  const n = Number(data?.numberMatched ?? data?.totalFeatures);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface CzPublication {
  /** Veröffentlichungsordner, z. B. „2026_11_12“ */
  folder: string;
  url: string;
  md5?: string;
}

/**
 * Liest aus der ŘLP-Seite „UAS geographical zones“ den Link auf die AKTUELLE
 * ED-318-Kacheldatei (`/data/uas/<Ordner>/actual/ed_318_a1_a2_tiles.zip`) samt
 * MD5. Künftige Ausgaben (`/<Ordner>/<Datum>/…`) werden ignoriert.
 */
export function parseCzUasIndex(html: string): CzPublication | null {
  if (!html) return null;
  const m = html.match(/href="((?:https?:\/\/aim\.rlp\.cz)?\/data\/uas\/([^"/]+)\/actual\/ed_318_a1_a2_tiles\.zip)"/);
  if (!m) return null;
  const href = m[1];
  const url = href.startsWith("http") ? href : `${CZ_BASE_URL}${href}`;
  const rest = html.slice((m.index ?? 0) + m[0].length);
  const rowEnd = rest.indexOf("</tr>");
  const row = rowEnd >= 0 ? rest.slice(0, rowEnd) : rest.slice(0, 600);
  const md5 = row.match(/\b([0-9a-f]{32})\b/i)?.[1]?.toLowerCase();
  return { folder: m[2], url, ...(md5 ? { md5 } : {}) };
}

/** Kacheldateien im ED-318-ZIP (ed_318_<n>.json) in stabiler Reihenfolge. */
export function listCzZipEntries(zip: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(zip, {
    filter: (f) => {
      if (/\.json$/i.test(f.name)) names.push(f.name);
      return false;
    },
  });
  return names.sort();
}

/** Features einer Kacheldatei aus dem ZIP (BOM/CRLF-tolerant). */
export function readCzZipEntry(zip: Uint8Array, name: string): any[] {
  const out = unzipSync(zip, { filter: (f) => f.name === name });
  const bytes = out[name];
  if (!bytes) return [];
  let text = strFromU8(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const data = JSON.parse(text);
  return Array.isArray(data?.features) ? data.features : [];
}

/** Quellen-/Lizenzhinweise je Land (Pflicht-Attribution). */
export const TILE_STORE_ATTRIBUTION: Record<TileStoreIso, { label: string; license?: string; url?: string }> = {
  DE: {
    label: "dipul, CC-BY-ND 4.0",
    license: "CC BY-ND 4.0",
    url: "https://creativecommons.org/licenses/by-nd/4.0/legalcode.de",
  },
  FR: { label: "IGN / DGAC (Géoplateforme)", url: "https://data.geopf.fr" },
  CZ: { label: "ŘLP ČR (ED-318)", url: "https://aim.rlp.cz/?lang=en&p=uas-gz" },
};

/** Bestand älter als der AIRAC-Zyklus? */
export function isIndexStale(file: Pick<TileIndexFile, "createdAt" | "complete"> | null | undefined, now = Date.now()): boolean {
  if (!file || !file.complete || !file.createdAt) return true;
  return now - file.createdAt > TILE_STORE_REFRESH_MS;
}
