// Direkter Abruf der britischen Geozonen (UK AIP der CAA als Google-My-Maps-KML).
// Siehe docs/uk-geozones-integration.md und shared/ukGeozones.ts.
//
//  1. GET https://www.google.com/maps/d/kml?mid=…&forcekml=1 → KML (~2 MB, ohne Anmeldung)
//  2. KML parsen (shared/kmlParse.ts) → normalisieren (shared/ukGeozones.ts)
//
// Live geprüft am 2026-11-15 (1069 Placemarks). Keine Versionsinfo in der
// Quelle → bei jedem Aktualisieren vollständig neu laden.
// Wirft, wenn nichts geladen werden kann (damit ein gespeicherter Datensatz
// erhalten bleibt). Bewusst frei von React-Native-/Expo-Importen.
import type { GeoFeature } from "./ed269Sources";
import { directFetchText, finalizeDirectFeatures } from "./directFetchUtil";
import { GB_GEOZONE_SOURCE_LABEL, UK_AIP_KML_URL, normalizeUkKml } from "../../../shared/ukGeozones";

export { GB_GEOZONE_SOURCE_LABEL, UK_AIP_KML_URL };

/** Großzügiger Timeout: ~2 MB unkomprimiertes KML. */
export const UK_FETCH_TIMEOUT_MS = 120_000;

/** KML-Text → finalisierte App-Features (testbar ohne Netz). */
export function unitedKingdomFeaturesFromKml(kml: string): GeoFeature[] {
  const features = normalizeUkKml(kml) as unknown as GeoFeature[];
  return finalizeDirectFeatures(features, "gb");
}

export async function fetchUnitedKingdom(): Promise<GeoFeature[]> {
  const kml = await directFetchText(UK_AIP_KML_URL, UK_FETCH_TIMEOUT_MS);
  if (!/<(\w+:)?kml[\s>]|<(\w+:)?Placemark[\s>]/.test(kml)) {
    throw new Error("UK AIP lieferte kein KML");
  }
  const features = unitedKingdomFeaturesFromKml(kml);
  if (features.length === 0) throw new Error("UK AIP lieferte keine Zonen");
  return features;
}
