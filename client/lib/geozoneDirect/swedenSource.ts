// Direkter Abruf der schwedischen Geozonen (LFV Drönarkartan / Transportstyrelsen).
//
//  - ED-318-Datei mit den nationalen geografischen UAS-Zonen (Pflichtquelle:
//    ohne sie wird geworfen, damit ein gespeicherter Datensatz erhalten bleibt).
//  - LFV-WFS (daim.lfv.se/geoserver/wfs) mit CTR/TIZ/ATZ, RWY5K, HKP1K, R-/D-
//    Gebieten, AIP SUP und NOTAM (optional – einzelne Layer dürfen fehlen).
//
// Lizenz CC BY 4.0, siehe docs/geozonen-weitere-laender.md §2.5.
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import {
  SE_GEOZONE_SOURCE_LABEL,
  SE_WFS_LAYERS,
  normalizeEd318Collection,
  normalizeSwedishWfsFeatures,
  type SeLayer,
} from "../../../shared/swedishGeozones";
import { computeBbox, roundFeatureCoords, type GeoFeature } from "./ed269Sources";
import { responseJsonYielding } from "../../../shared/yieldingWork";

export { SE_GEOZONE_SOURCE_LABEL };

export const SE_ED318_URL = "https://dronechart.lfv.se/data/uas_zones_ED318.json";
/** Zweite Adresse derselben Datei (live 2026-11-15 identisch, gleiches `issued`). */
export const SE_ED318_FALLBACK_URL = "https://daim.lfv.se/echarts/dronechart/data/uas_zones_ED318.json";
export const SE_WFS_URL = "https://daim.lfv.se/geoserver/wfs";

const FETCH_TIMEOUT_MS = 60_000;
// Der LFV-WFS liefert alle Layer vollständig (kein Count-Limit, Stand
// 2026-11-15). Paging nur als Absicherung, falls der Server künftig begrenzt.
const WFS_PAGE_SIZE = 2000;
const WFS_MAX_PAGES = 10;

// Serverseitiger Vorfilter für NOTAM (Drönarkartan-Regel: nur Q-Code R…/W…,
// keine Trigger-NOTAM). Clientseitig wird zusätzlich gefiltert.
const NOTAM_CQL = "(CODE23 LIKE 'R%' OR CODE23 LIKE 'W%') AND CODE45 <> 'TT'";

async function fetchJson(url: string, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await responseJsonYielding(res);
  } finally {
    clearTimeout(timeout);
  }
}

/** GetFeature-URL (WFS 1.1.0, GeoJSON, EPSG:4326 → Lon/Lat). */
export function swedenWfsUrl(typeName: string, opts: { startIndex?: number; count?: number; cql?: string } = {}): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typename: typeName,
    outputFormat: "application/json",
    srsname: "EPSG:4326",
  });
  if (opts.count != null) params.set("maxFeatures", String(opts.count));
  if (opts.startIndex != null && opts.startIndex > 0) params.set("startIndex", String(opts.startIndex));
  if (opts.cql) params.set("cql_filter", opts.cql);
  return `${SE_WFS_URL}?${params.toString()}`;
}

async function fetchWfsLayer(typeName: string, cql?: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < WFS_MAX_PAGES; page++) {
    const body = await fetchJson(swedenWfsUrl(typeName, { startIndex: page * WFS_PAGE_SIZE, count: WFS_PAGE_SIZE, cql }));
    const feats = Array.isArray(body?.features) ? body.features : [];
    all.push(...feats);
    const total = Number(body?.totalFeatures ?? body?.numberMatched);
    if (feats.length < WFS_PAGE_SIZE) break;
    if (Number.isFinite(total) && all.length >= total) break;
  }
  return all;
}

// bbox ergänzen + Land taggen (wie finalize() in ed269Sources.ts).
function finalizeSe(features: { type: "Feature"; geometry: any; properties: Record<string, any> }[]): GeoFeature[] {
  const out: GeoFeature[] = [];
  for (const f of features) {
    if (!f || !f.geometry) continue;
    const g = f as GeoFeature;
    const bb = computeBbox(g.geometry);
    if (bb) g.bbox = bb;
    g.properties = { ...(g.properties || {}), _country: "se" };
    out.push(g);
  }
  return out;
}

async function loadWfsLayer(layer: SeLayer, typeName: string, now: Date): Promise<GeoFeature[]> {
  let raw: any[];
  if (layer === "NOTAM") {
    try {
      raw = await fetchWfsLayer(typeName, NOTAM_CQL);
    } catch (e) {
      // Falls der Server den CQL-Filter ablehnt: ungefiltert laden.
      console.warn("[geozoneDirect] SE: NOTAM-CQL-Filter fehlgeschlagen, lade ungefiltert:", (e as Error)?.message || e);
      raw = await fetchWfsLayer(typeName);
    }
  } else {
    raw = await fetchWfsLayer(typeName);
  }
  return finalizeSe(normalizeSwedishWfsFeatures(layer, raw, now));
}

/**
 * Lädt alle schwedischen Geozonen (ED-318 + WFS), normalisiert, mit bbox,
 * `_country: "se"` und gekürzter Koordinatenpräzision. Wirft, wenn die
 * nationalen UAS-Zonen (ED-318) nicht geladen werden können.
 */
/** ED-318-Datei laden: dronechart.lfv.se, Rückfall daim.lfv.se. */
export async function fetchSwedenEd318(fetchJsonFn: (url: string) => Promise<any> = (u) => fetchJson(u)): Promise<any> {
  try {
    const body = await fetchJsonFn(SE_ED318_URL);
    if (!Array.isArray(body?.features) || body.features.length === 0) throw new Error("ED-318 ohne Zonen");
    return body;
  } catch (e) {
    console.warn("[geozoneDirect] SE: ED-318 über dronechart.lfv.se fehlgeschlagen, nutze daim.lfv.se:", (e as Error)?.message || e);
    return await fetchJsonFn(SE_ED318_FALLBACK_URL);
  }
}

export async function fetchSweden(now: Date = new Date()): Promise<GeoFeature[]> {
  const ed318Body = await fetchSwedenEd318();
  const uasZones = finalizeSe(normalizeEd318Collection(ed318Body, now));
  if (uasZones.length === 0) throw new Error("Transportstyrelsen (ED-318) lieferte keine UAS-Zonen");

  const results = await Promise.allSettled(SE_WFS_LAYERS.map(({ layer, typeName }) => loadWfsLayer(layer, typeName, now)));
  const features: GeoFeature[] = [...uasZones];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") features.push(...r.value);
    else console.warn(`[geozoneDirect] SE: WFS-Layer ${SE_WFS_LAYERS[i].typeName} nicht erreichbar:`, (r.reason as Error)?.message || r.reason);
  });
  return roundFeatureCoords(features);
}
