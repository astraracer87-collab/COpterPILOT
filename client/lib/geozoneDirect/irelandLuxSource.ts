// Abruf Irland (IAA) und Luxemburg (DAC / Geoportail) – siehe docs/.
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, directFetchText, finalizeDirectFeatures } from "./directFetchUtil";
import {
  irishGeojsonUrlFromHtml,
  normalizeIrishZones,
  mergeLuxembourgOgc,
} from "../../../shared/irishLuxGeozones";
import { ed269ZonesToFeatures } from "../../../shared/ed269Pure";
import { PT_ED269_URL, normalizePortugueseZones } from "../../../shared/portugueseGeozones";

export async function fetchPortugal(): Promise<GeoFeature[]> {
  const features = normalizePortugueseZones(await directFetchJson(PT_ED269_URL)) as unknown as GeoFeature[];
  if (features.length === 0) throw new Error("ANAC lieferte keine Zonen");
  return finalizeDirectFeatures(features, "pt");
}

export const IE_ZONES_PAGE_URL = "https://www.iaa.ie/general-aviation/drones/uas-geographic-zones";
export const IE_LAST_KNOWN_URL =
  "https://www.iaa.ie/docs/default-source/default-document-library/uas/20261106_uas_zones_ireland_v1.geojson?download=true";
export const LU_ED269_URL = "https://drones.geoportail.lu/zones";
// Das Geoportail teilt die Zonen nach Höhe auf: 1927 = 0–50 m, 1928 = 50–120 m.
// Zonen von 0 bis 120 m stehen in beiden; erst zusammen ist der Bestand
// vollständig (u. a. die unteren Flugplatz-/Heliport-Teilzonen „…-1“ nur in 1927).
export const LU_OGC_URLS = [
  "https://features.geoportail.lu/collections/1927/items?f=json&limit=2000",
  "https://features.geoportail.lu/collections/1928/items?f=json&limit=2000",
];
/** @deprecated nur noch für Abwärtskompatibilität; siehe LU_OGC_URLS */
export const LU_OGC_URL = LU_OGC_URLS[1];

export async function fetchIreland(): Promise<GeoFeature[]> {
  let url = IE_LAST_KNOWN_URL;
  try {
    url = irishGeojsonUrlFromHtml(await directFetchText(IE_ZONES_PAGE_URL)) ?? IE_LAST_KNOWN_URL;
  } catch (e) {
    console.warn("[geozoneDirect] IE: Seite nicht lesbar, nutze letzte bekannte Datei:", (e as Error)?.message || e);
  }
  const features = normalizeIrishZones(await directFetchJson(url, 120_000));
  if (features.length === 0) throw new Error("IAA lieferte keine Zonen");
  return finalizeDirectFeatures(features as unknown as GeoFeature[], "ie");
}

export async function fetchLuxembourg(): Promise<GeoFeature[]> {
  // Bevorzugt: ED-269 (CC0). Der Dienst ist zeitweise defekt (422) → OGC-Rückfall.
  try {
    const body = await directFetchJson(LU_ED269_URL);
    const features = ed269ZonesToFeatures(body, { source: "DAC / Geoportail Luxembourg (CC0)" }) as unknown as GeoFeature[];
    if (features.length > 0) return finalizeDirectFeatures(features, "lu");
  } catch (e) {
    console.warn("[geozoneDirect] LU: ED-269-Dienst nicht verfügbar, nutze OGC-Features:", (e as Error)?.message || e);
  }
  // Beide Höhenschichten laden; schlägt eine fehl, wird abgebrochen statt einen
  // halben Bestand zu speichern (der alte, vollständige Cache bleibt dann).
  const bodies = await Promise.all(LU_OGC_URLS.map((u) => directFetchJson(u)));
  const features = mergeLuxembourgOgc(bodies);
  if (features.length === 0) throw new Error("Geoportail lieferte keine Zonen");
  return finalizeDirectFeatures(features as unknown as GeoFeature[], "lu");
}
