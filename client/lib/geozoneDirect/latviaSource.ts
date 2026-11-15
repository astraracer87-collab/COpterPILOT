// Abruf Lettland (LGS / AIS Latvia) – offizieller ED-269-Export von drz.lv,
// ohne Anmeldung. Normalisierung siehe shared/latvianGeozones.ts.
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import { LV_ED269_URL, normalizeLatvianZones } from "../../../shared/latvianGeozones";

// ~13 MB Download – großzügiger Timeout für langsame Mobilverbindungen.
const LV_FETCH_TIMEOUT_MS = 180_000;

export async function fetchLatvia(): Promise<GeoFeature[]> {
  // Server antwortet mit „application/data“; der Inhalt ist JSON.
  const body = await directFetchJson(LV_ED269_URL, LV_FETCH_TIMEOUT_MS);
  const features = normalizeLatvianZones(body) as unknown as GeoFeature[];
  if (features.length === 0) throw new Error("LGS / drz.lv lieferte keine Zonen");
  return finalizeDirectFeatures(features, "lv");
}
