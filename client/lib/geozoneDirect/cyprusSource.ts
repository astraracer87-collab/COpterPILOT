// Direkter Abruf der zyprischen Geozonen (DCA Cyprus / AMC, drones.gov.cy) –
// siehe docs/cyprus-dca-api-integration.md.
//
//  - Öffentlicher ArcGIS-Online-FeatureServer, keine Authentifizierung.
//  - Einziger Geozonen-Layer der offiziellen WebMap: FeatureServer/12
//    („Polygons“, live 141 Zonen). Die übrigen Sublayer (204 NOTAM-Tabelle
//    „PIB_XML“, 2/3 Stadion-Punkt/-Puffer) sind keine Geozonen und entfallen.
//  - `query?…&f=geojson`, WGS84, volle Koordinatenpräzision (kein
//    geometryPrecision, keine Vereinfachung), paginiert über
//    resultOffset/resultRecordCount + exceededTransferLimit
//    (maxRecordCount des Layers: 2000).
// Pflicht-Attribution: „© Department of Civil Aviation, Cyprus“.
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  CY_GEOZONE_ATTRIBUTION,
  CY_GEOZONE_SOURCE_LABEL,
  cyprusArcgisPage,
  cyprusQueryUrl,
  normalizeCyprusZonesWithStats,
} from "../../../shared/cypriotGeozones";

export { CY_GEOZONE_SOURCE_LABEL, CY_GEOZONE_ATTRIBUTION };

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 90_000;

type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;

/** Alle Rohfeatures des Zonen-Layers seitenweise laden. */
export async function fetchCyprusRaw(fetchJson: FetchJson = directFetchJson): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { features, exceeded } = cyprusArcgisPage(await fetchJson(cyprusQueryUrl(all.length, PAGE_SIZE), PAGE_TIMEOUT_MS));
    all.push(...features);
    if (features.length === 0) break;
    if (!exceeded && features.length < PAGE_SIZE) break;
  }
  return all;
}

/** Laden + normalisieren (testbar mit eigenem fetchJson). */
export async function loadCyprus(fetchJson: FetchJson = directFetchJson): Promise<GeoFeature[]> {
  const raw = await fetchCyprusRaw(fetchJson);
  if (raw.length === 0) throw new Error("DCA Cyprus lieferte keine Zonen");
  const { features, dropped } = normalizeCyprusZonesWithStats(raw);
  if (dropped.length > 0) {
    console.warn(`[geozoneDirect] CY: ${dropped.length} Zone(n) verworfen:`, dropped.map((d) => `${d.name} (${d.reason})`).join(", "));
  }
  if (features.length === 0) throw new Error("DCA Cyprus lieferte keine gültigen Zonen");
  return finalizeDirectFeatures(features as unknown as GeoFeature[], "cy");
}

export async function fetchCyprus(): Promise<GeoFeature[]> {
  return loadCyprus(directFetchJson);
}
