// Direkter Abruf der bulgarischen Geozonen (ГД ГВА / CAA Bulgaria, uas.caa.bg) –
// siehe docs/bulgaria-caa-api-integration.md und shared/bulgarianGeozones.ts
// (Einstufung, Höhen, Übersetzung, Gültigkeit).
//
//  - Öffentlicher GeoServer-WFS, keine Authentifizierung, GeoJSON, WFS-Paging
//    über count/startIndex (numberMatched).
//  - Hauptlayer caa-uas:VGeoCAAZonesPublic (Pflicht; leer → Fehler).
//  - Optional: caa-uas:VGeoBULATSAZonesPublic (Luftraumgebiete der
//    Flugsicherung) sowie VGeoAirspaceZonesPublic/VGeoFlightZonesPublic
//    (live leer). Fehler dort kosten die Hauptzonen nicht.
//  - Volle Geometrie-Präzision: Die GeoJSON-Ausgabe ist serverseitig auf
//    4 Nachkommastellen gerundet; zusätzlich wird je Layer das CSV (FID + WKT
//    in voller Präzision) geladen und die Geometrie ersetzt. Schlägt das CSV
//    fehl, bleibt die GeoJSON-Geometrie (bzw. buffer_wkt) – kein Abbruch.
// Pflicht-Attribution: „© ГД ГВА (CAA Bulgaria)“.
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, directFetchText, finalizeDirectFeatures } from "./directFetchUtil";
import {
  BG_AIRSPACE_ZONES_LAYER,
  BG_BULATSA_ZONES_LAYER,
  BG_CAA_ZONES_LAYER,
  BG_FLIGHT_ZONES_LAYER,
  BG_GEOZONE_ATTRIBUTION,
  BG_GEOZONE_SOURCE_LABEL,
  BG_WFS_PAGE_SIZE,
  bulgariaWfsCsvUrl,
  bulgariaWfsHasMore,
  bulgariaWfsUrl,
  mergeBulgarianFeatures,
  normalizeBulgarianBulatsaZonesWithStats,
  normalizeBulgarianZonesWithStats,
  parseBulgariaWfsCsv,
  type BgFeature,
  type BgNormalizeResult,
} from "../../../shared/bulgarianGeozones";
import { fetchWfsPaged } from "../../../shared/geozoneKit/wfs";

export { BG_GEOZONE_SOURCE_LABEL, BG_GEOZONE_ATTRIBUTION };

const MAX_PAGES = 50;
const PAGE_TIMEOUT_MS = 90_000;

type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;
type FetchText = (url: string, timeoutMs?: number) => Promise<string>;

export interface BulgariaFetchers {
  json: FetchJson;
  text: FetchText;
}

const DEFAULT_FETCHERS: BulgariaFetchers = { json: directFetchJson, text: directFetchText };

/** Alle GeoJSON-Features eines Layers (WFS-Paging). */
export async function fetchBulgariaLayer(layer: string, fetchJson: FetchJson = directFetchJson): Promise<any[]> {
  return fetchWfsPaged({
    pageUrl: (startIndex, count) => bulgariaWfsUrl(layer, { count, startIndex }),
    fetchJson,
    pageSize: BG_WFS_PAGE_SIZE,
    maxPages: MAX_PAGES,
    timeoutMs: PAGE_TIMEOUT_MS,
    hasMore: bulgariaWfsHasMore,
  });
}

/** FID → WKT in voller Präzision (CSV-Ausgabe, paginiert); bei Fehler leer. */
export async function fetchBulgariaPreciseWkt(
  layer: string,
  expected: number,
  fetchText: FetchText = directFetchText,
): Promise<Map<string, string>> {
  const all = new Map<string, string>();
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const text = await fetchText(bulgariaWfsCsvUrl(layer, { count: BG_WFS_PAGE_SIZE, startIndex: page * BG_WFS_PAGE_SIZE }), PAGE_TIMEOUT_MS);
      const rows = parseBulgariaWfsCsv(text);
      rows.forEach((wkt, fid) => all.set(fid, wkt));
      if (rows.size < BG_WFS_PAGE_SIZE || all.size >= expected) break;
    }
  } catch (e) {
    console.warn(`[geozoneDirect] BG: präzise Geometrie (${layer}) nicht abrufbar, nutze GeoJSON:`, (e as Error)?.message || e);
  }
  return all;
}

function warnDropped(layer: string, r: BgNormalizeResult): void {
  // Gelöschte (is_deleted) Einträge sind normal und werden nicht gemeldet.
  const relevant = r.dropped.filter((d) => d.reason !== "deleted");
  if (relevant.length > 0) {
    console.warn(
      `[geozoneDirect] BG: ${relevant.length} Zone(n) aus ${layer} verworfen:`,
      relevant.map((d) => `${d.name} (${d.reason})`).join(", "),
    );
  }
}

async function loadLayer(
  layer: string,
  kind: "caa" | "bulatsa",
  f: BulgariaFetchers,
  now: Date,
  idPrefix?: string,
): Promise<{ raw: number; features: BgFeature[] }> {
  const raw = await fetchBulgariaLayer(layer, f.json);
  if (raw.length === 0) return { raw: 0, features: [] };
  const preciseWkt = await fetchBulgariaPreciseWkt(layer, raw.length, f.text);
  const opts = { now, preciseWkt, idPrefix };
  const r = kind === "caa" ? normalizeBulgarianZonesWithStats(raw, opts) : normalizeBulgarianBulatsaZonesWithStats(raw, opts);
  warnDropped(layer, r);
  return { raw: raw.length, features: r.features };
}

async function optionalLayer(
  layer: string,
  kind: "caa" | "bulatsa",
  f: BulgariaFetchers,
  now: Date,
  idPrefix: string,
): Promise<BgFeature[]> {
  try {
    return (await loadLayer(layer, kind, f, now, idPrefix)).features;
  } catch (e) {
    console.warn(`[geozoneDirect] BG: ${layer} nicht abrufbar:`, (e as Error)?.message || e);
    return [];
  }
}

/** Laden + normalisieren (testbar mit eigenen Fetch-Funktionen). */
export async function loadBulgaria(
  fetchers: Partial<BulgariaFetchers> = {},
  now: Date = new Date(),
): Promise<GeoFeature[]> {
  const f: BulgariaFetchers = { ...DEFAULT_FETCHERS, ...fetchers };
  const main = await loadLayer(BG_CAA_ZONES_LAYER, "caa", f, now);
  if (main.raw === 0) throw new Error("ГД ГВА (CAA Bulgaria) lieferte keine Zonen");
  if (main.features.length === 0) throw new Error("ГД ГВА (CAA Bulgaria) lieferte keine gültigen Zonen");

  const [bulatsa, airspace, flight] = await Promise.all([
    optionalLayer(BG_BULATSA_ZONES_LAYER, "bulatsa", f, now, "BG-ATS"),
    optionalLayer(BG_AIRSPACE_ZONES_LAYER, "caa", f, now, "BG-AS"),
    optionalLayer(BG_FLIGHT_ZONES_LAYER, "caa", f, now, "BG-FZ"),
  ]);
  const merged = mergeBulgarianFeatures(main.features, bulatsa, airspace, flight);
  return finalizeDirectFeatures(merged as unknown as GeoFeature[], "bg");
}

export async function fetchBulgaria(): Promise<GeoFeature[]> {
  return loadBulgaria();
}
