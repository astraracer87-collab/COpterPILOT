// Direkter Abruf der spanischen Geozonen (ENAIRE, AIS Data Service for UAS
// Geographical Zones, ED-318) – siehe docs/enaire-es-api-integration.md.
//
//  - Bevorzugt ArcGIS REST FeatureServer, je Layer `query?…&f=geojson`,
//    paginiert über resultOffset/resultRecordCount + exceededTransferLimit.
//  - Layer-IDs werden über `FeatureServer?f=json` ermittelt; schlägt das fehl,
//    gelten die dokumentierten Rückfall-IDs (0/1/2, ⚠️ live zu verifizieren).
//  - Rückfall je Layer: OGC WFS 2.0 GetFeature mit outputFormat=GEOJSON.
//
// Keine Authentifizierung. ⚠️ servais.enaire.es blockt Nicht-EU-/Datacenter-
// IPs per WAF (403) – aus der App (EU-Geräte) erreichbar.
// Pflicht-Attribution: „© ENAIRE“ (ES_GEOZONE_ATTRIBUTION).
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  ES_GEOZONE_ATTRIBUTION,
  ES_GEOZONE_SOURCE_LABEL,
  ES_LAYERS,
  esArcgisPage,
  esLayerIdsFromService,
  normalizeSpanishFeatures,
  type EsLayer,
  type EsRawFeature,
} from "../../../shared/spanishGeozones";

export { ES_GEOZONE_SOURCE_LABEL, ES_GEOZONE_ATTRIBUTION };

export const ES_ENAIRE_FS =
  "https://servais.enaire.es/insigniads/rest/services/NSF_SRV/SRV_UAS_ZG_data_V2/FeatureServer";
export const ES_ENAIRE_WFS =
  "https://servais.enaire.es/insigniads/services/NSF_SRV/SRV_UAS_ZG_data_V2/MapServer/WFSServer";

/** Rückfall-Layer-IDs, falls die Layer-Liste nicht lesbar ist (Annahme: Reihenfolge wie Doku §2). */
export const ES_FALLBACK_LAYER_IDS: Record<EsLayer, number> = {
  ZGUAS_Aero: 0,
  ZGUAS_Urbano: 1,
  ZGUAS_Infraestructuras: 2,
};

// ArcGIS-Default-maxRecordCount ist 1000/2000; der Server darf weniger liefern
// (dann exceededTransferLimit=true) – der Offset rückt um die tatsächliche Zahl vor.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const PAGE_TIMEOUT_MS = 90_000;

/** ArcGIS-Query-URL (GeoJSON, WGS84, alle Felder, eine Seite). */
export function spainQueryUrl(layerId: number, offset = 0, count = PAGE_SIZE): string {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    outSR: "4326",
    returnGeometry: "true",
    geometryPrecision: "6",
    resultOffset: String(offset),
    resultRecordCount: String(count),
    f: "geojson",
  });
  return `${ES_ENAIRE_FS}/${layerId}/query?${params.toString()}`;
}

/** WFS-2.0-GetFeature-URL (GeoJSON erzwungen, eine Seite). */
export function spainWfsUrl(typeName: string, startIndex = 0, count = PAGE_SIZE): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName,
    outputFormat: "GEOJSON",
    count: String(count),
  });
  if (startIndex > 0) params.set("startIndex", String(startIndex));
  return `${ES_ENAIRE_WFS}?${params.toString()}`;
}

/** Layer-IDs ermitteln; fehlende Layer (oder Fehler) → dokumentierte Rückfall-IDs. */
export async function discoverSpainLayerIds(): Promise<Record<EsLayer, number>> {
  let found: Partial<Record<EsLayer, number>> = {};
  try {
    found = esLayerIdsFromService(await directFetchJson(`${ES_ENAIRE_FS}?f=json`));
  } catch (e) {
    console.warn("[geozoneDirect] ES: Layer-Liste nicht lesbar, nutze Rückfall-IDs:", (e as Error)?.message || e);
  }
  const out = { ...ES_FALLBACK_LAYER_IDS };
  for (const layer of ES_LAYERS) if (found[layer] != null) out[layer] = found[layer]!;
  return out;
}

async function fetchArcgisLayer(layerId: number): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { features, exceeded } = esArcgisPage(await directFetchJson(spainQueryUrl(layerId, all.length), PAGE_TIMEOUT_MS));
    all.push(...features);
    if (features.length === 0) break;
    if (!exceeded && features.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchWfsLayer(typeName: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await directFetchJson(spainWfsUrl(typeName, all.length), PAGE_TIMEOUT_MS);
    const feats = Array.isArray(body?.features) ? body.features : [];
    all.push(...feats);
    const total = Number(body?.numberMatched ?? body?.totalFeatures);
    if (feats.length < PAGE_SIZE) break;
    if (Number.isFinite(total) && all.length >= total) break;
  }
  return all;
}

async function loadLayer(layer: EsLayer, layerId: number): Promise<EsRawFeature[]> {
  try {
    const feats = await fetchArcgisLayer(layerId);
    if (feats.length > 0) return feats.map((feature) => ({ layer, feature }));
    console.warn(`[geozoneDirect] ES: ${layer} (FeatureServer/${layerId}) leer, versuche WFS`);
  } catch (e) {
    console.warn(`[geozoneDirect] ES: ${layer} über FeatureServer fehlgeschlagen, versuche WFS:`, (e as Error)?.message || e);
  }
  const feats = await fetchWfsLayer(layer);
  return feats.map((feature) => ({ layer, feature }));
}

/**
 * Lädt alle drei ENAIRE-Layer, normalisiert (Dedupe über `Identifier`,
 * auch layerübergreifend), mit bbox und `_country: "es"`. Einzelne Layer
 * dürfen fehlen; wirft, wenn KEIN Layer Daten liefert.
 */
export async function loadSpain(now: Date = new Date()): Promise<GeoFeature[]> {
  const ids = await discoverSpainLayerIds();
  const results = await Promise.allSettled(ES_LAYERS.map((layer) => loadLayer(layer, ids[layer])));
  const raw: EsRawFeature[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") raw.push(...r.value);
    else console.warn(`[geozoneDirect] ES: Layer ${ES_LAYERS[i]} nicht erreichbar:`, (r.reason as Error)?.message || r.reason);
  });
  if (raw.length === 0) throw new Error("ENAIRE lieferte keine Zonen");
  const features = normalizeSpanishFeatures(raw, now) as unknown as GeoFeature[];
  if (features.length === 0) throw new Error("ENAIRE lieferte keine gültigen Zonen");
  return finalizeDirectFeatures(features, "es");
}

export async function fetchSpain(): Promise<GeoFeature[]> {
  return loadSpain(new Date());
}
