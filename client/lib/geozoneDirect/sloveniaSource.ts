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
//  - Fehlerverhalten: jeder Layer wird bei Fehlschlag einmal wiederholt;
//    scheitert ein Layer endgültig, wirft fetchSlovenia() (kein Teilbestand,
//    damit z. B. eine fehlende CTR nicht still aus dem Cache verschwindet –
//    der Aufrufer behält dann den letzten vollständigen Stand).
// Pflicht-Attribution: „© Javna agencija za civilno letalstvo RS (CAA Slovenia)“.
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  SI_GEOZONE_ATTRIBUTION,
  SI_GEOZONE_SOURCE_LABEL,
  SI_LAYERS,
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

/** Laden + normalisieren (testbar mit eigenem fetchJson / eigener Layerliste). */
export async function loadSlovenia(
  fetchJson: FetchJson = directFetchJson,
  layers: SiLayerDef[] = SI_LAYERS,
): Promise<GeoFeature[]> {
  const results = await Promise.allSettled(layers.map((layer) => fetchLayerWithRetry(layer, fetchJson)));
  const failed: string[] = [];
  const byLayer: { layer: SiLayerDef; features: any[] }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") byLayer.push({ layer: layers[i], features: r.value });
    else failed.push(`${layers[i].title} (${r.reason instanceof Error ? r.reason.message : String(r.reason)})`);
  });
  if (failed.length > 0) {
    throw new Error(`CAA Slovenia: ${failed.length} Ebene(n) nicht abrufbar: ${failed.join(", ")}`);
  }
  const rawCount = byLayer.reduce((n, l) => n + l.features.length, 0);
  if (rawCount === 0) throw new Error("CAA Slovenia lieferte keine Zonen");
  const { features, dropped } = normalizeSloveniaLayersWithStats(byLayer);
  if (dropped.length > 0) {
    console.warn(
      `[geozoneDirect] SI: ${dropped.length} Zone(n) verworfen:`,
      dropped.map((d) => `${d.layer}/${d.name} (${d.reason})`).join(", "),
    );
  }
  if (features.length === 0) throw new Error("CAA Slovenia lieferte keine gültigen Zonen");
  return finalizeDirectFeatures(features as unknown as GeoFeature[], "si");
}

export async function fetchSlovenia(): Promise<GeoFeature[]> {
  return loadSlovenia(directFetchJson);
}
