// Finnland (Traficom) – direkter Abruf der ED-269-Geozonen.
// Ein Request, ohne Registrierung, ~1,7 MB ohne gzip, täglicher Abruf reicht
// (docs/geozonen-weitere-laender.md §5). React-Native-frei (tsx-testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import { FI_GEOZONES_URL, normalizeFinnishZones } from "../../../shared/finnishGeozones";

export { FI_GEOZONES_URL, FI_GEOZONE_SOURCE_LABEL, FI_GEOZONE_ATTRIBUTION } from "../../../shared/finnishGeozones";

/** Normalisiert eine bereits geladene Traficom-Antwort (für Tests/Offline). */
export function finlandFeaturesFromBody(body: unknown, now: Date = new Date()): GeoFeature[] {
  return finalizeDirectFeatures(normalizeFinnishZones(body, now) as unknown as GeoFeature[], "fi");
}

/** Lädt alle finnischen Geozonen. Wirft, wenn nichts Brauchbares kommt. */
export async function fetchFinland(): Promise<GeoFeature[]> {
  const body = await directFetchJson(FI_GEOZONES_URL);
  const features = finlandFeaturesFromBody(body);
  if (features.length === 0) throw new Error("Traficom lieferte keine Zonen");
  return features;
}
