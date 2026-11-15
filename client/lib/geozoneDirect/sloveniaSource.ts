// Direkter Abruf der slowenischen UAS-Geozonen (CAA Slovenia) – siehe
// docs/slovenia-caa-api-integration.md und shared/slovenianGeozones.ts.
//
//  - Öffentliche ArcGIS-Online-FeatureServer (services6.arcgis.com/
//    1F2lR3M9nMUYDj5l), keine Authentifizierung.
//  - Verwendet werden die operativen Zonen-Layer der aktuellen offiziellen
//    Drohnenkarte „UAS GEO ZONES - May 2026“ (WebMap 14c35a6c…), NICHT die
//    veraltete GAT-Karte von 2021 (siehe Kopfkommentar in shared/).
//  - `query?…&f=geojson`, WGS84, volle Koordinatenpräzision (kein
//    geometryPrecision, keine Vereinfachung), paginiert über
//    resultOffset/resultRecordCount + exceededTransferLimit
//    (maxRecordCount der Layer: 2000; live höchstens 32 Features je Layer).
//  - Ebenen werden zur Laufzeit aus der Web Map gelesen
//    (…/items/14c35a6c…/data?f=json → operationalLayers[].url), weil die CAA
//    bei Updates ganze Dienste austauscht (ELES_2023 → ELES_2025 …). SI_LAYERS
//    ist nur noch Feldzuordnung (Titel/Dienst-Präfix) und Rückfall, wenn die
//    Web Map nicht lesbar ist. FIR/Pozidano bleiben ausgelassen.
//  - Fehlerverhalten: jeder Layer wird bei Fehlschlag einmal wiederholt;
//    scheitert ein Layer endgültig, während andere Zonen liefern, wird der
//    Rest gespeichert – mit Abdeckung „partial“ und deutschem Hinweis
//    (withFetchCoverage); die Zonen der fehlenden Ebene übernimmt ed269Store
//    aus dem letzten Stand. Liefert keine Ebene etwas, wird geworfen (der
//    Aufrufer behält dann den letzten Stand).
// Pflicht-Attribution: „© Javna agencija za civilno letalstvo RS (CAA Slovenia)“.
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures, withFetchCoverage } from "./directFetchUtil";
import {
  SI_GEOZONE_ATTRIBUTION,
  SI_GEOZONE_SOURCE_LABEL,
  SI_LAYERS,
  SI_WEBMAP_DATA_URL,
  resolveSloveniaLayersFromWebmap,
  type SiLayerDef,
  normalizeSloveniaLayersWithStats,
  sloveniaQueryUrl,
} from "../../../shared/slovenianGeozones";
import { fetchArcgisPaged } from "../../../shared/geozoneKit/arcgis";

export { SI_GEOZONE_SOURCE_LABEL, SI_GEOZONE_ATTRIBUTION };

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 60_000;

type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;

/** Alle Rohfeatures eines Layers seitenweise laden. */
export async function fetchSloveniaLayerRaw(layer: SiLayerDef, fetchJson: FetchJson = directFetchJson): Promise<any[]> {
  return fetchArcgisPaged({
    pageUrl: (offset, count) => sloveniaQueryUrl(layer, offset, count),
    fetchJson,
    pageSize: PAGE_SIZE,
    maxPages: MAX_PAGES,
    timeoutMs: PAGE_TIMEOUT_MS,
  });
}

async function fetchLayerWithRetry(layer: SiLayerDef, fetchJson: FetchJson): Promise<any[]> {
  try {
    return await fetchSloveniaLayerRaw(layer, fetchJson);
  } catch {
    return await fetchSloveniaLayerRaw(layer, fetchJson);
  }
}

const WEBMAP_TIMEOUT_MS = 30_000;

/**
 * Zu ladende Ebenen aus der Web Map; bei Fehler oder ohne erkannte Ebene der
 * feste Rückfall SI_LAYERS (`fromWebmap: false`).
 */
export async function resolveSloveniaLayers(
  fetchJson: FetchJson = directFetchJson,
): Promise<{ layers: SiLayerDef[]; fromWebmap: boolean; generic: string[] }> {
  try {
    const webmap = await fetchJson(SI_WEBMAP_DATA_URL, WEBMAP_TIMEOUT_MS);
    const r = resolveSloveniaLayersFromWebmap(webmap);
    if (r.layers.length === 0) throw new Error("keine Zonen-Ebene in der Web Map");
    if (r.generic.length > 0) {
      console.warn("[geozoneDirect] SI: Ebenen ohne bekannte Feldzuordnung (generisch gelesen):", r.generic.join(", "));
    }
    return { layers: r.layers, fromWebmap: true, generic: r.generic };
  } catch (e) {
    console.warn("[geozoneDirect] SI: Web Map nicht lesbar, nutze feste Ebenenliste:", (e as Error)?.message || e);
    return { layers: SI_LAYERS, fromWebmap: false, generic: [] };
  }
}

/** Deutscher Abdeckungs-Hinweis, wenn einzelne Ebenen fehlen. */
export function sloveniaPartialNote(failedTitles: string[], total: number): string {
  return `CAA Slovenia: ${failedTitles.length} von ${total} Ebenen nicht abrufbar (${failedTitles.join(", ")}) – deren Zonen fehlen bzw. stammen aus dem letzten Stand`;
}

/**
 * Laden + normalisieren (testbar mit eigenem fetchJson / eigener Layerliste).
 * Ohne `layers` werden die Ebenen aus der Web Map gelesen.
 */
export async function loadSlovenia(fetchJson: FetchJson = directFetchJson, layers?: SiLayerDef[]): Promise<GeoFeature[]> {
  const list = layers ?? (await resolveSloveniaLayers(fetchJson)).layers;
  const results = await Promise.allSettled(list.map((layer) => fetchLayerWithRetry(layer, fetchJson)));
  const failed: SiLayerDef[] = [];
  const failedText: string[] = [];
  const byLayer: { layer: SiLayerDef; features: any[] }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") byLayer.push({ layer: list[i], features: r.value });
    else {
      failed.push(list[i]);
      failedText.push(`${list[i].title} (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`);
    }
  });
  if (failed.length > 0) console.warn(`[geozoneDirect] SI: ${failed.length} Ebene(n) nicht abrufbar:`, failedText.join(", "));
  const rawCount = byLayer.reduce((n, l) => n + l.features.length, 0);
  if (rawCount === 0) {
    throw new Error(
      failed.length > 0
        ? `CAA Slovenia: ${failed.length} Ebene(n) nicht abrufbar: ${failedText.join(", ")}`
        : "CAA Slovenia lieferte keine Zonen",
    );
  }
  const { features, dropped } = normalizeSloveniaLayersWithStats(byLayer);
  if (dropped.length > 0) {
    console.warn(
      `[geozoneDirect] SI: ${dropped.length} Zone(n) verworfen:`,
      dropped.map((d) => `${d.layer}/${d.name} (${d.reason})`).join(", "),
    );
  }
  if (features.length === 0) throw new Error("CAA Slovenia lieferte keine gültigen Zonen");
  const out = finalizeDirectFeatures(features as unknown as GeoFeature[], "si");
  if (failed.length === 0) return out;
  const failedKeys = new Set(failed.map((l) => l.key));
  return withFetchCoverage(out, {
    partialNote: sloveniaPartialNote(failed.map((l) => l.title), list.length),
    keepPrevious: (p) => failedKeys.has(String(p.siLayer ?? "")),
  });
}

export async function fetchSlovenia(): Promise<GeoFeature[]> {
  return loadSlovenia(directFetchJson);
}
