// Italien (d-flight S.p.A., ENAV) – ED-269-Gesamtdownload mit Nutzer-Login.
// Ohne eingetragenen d-flight-Zugang wird nichts geladen (Fehler
// „Kein d-flight-Zugang eingetragen“). Siehe docs/dflight-it-api-integration.md.
import type { GeoFeature } from "./ed269Sources";
import { finalizeDirectFeatures } from "./directFetchUtil";
import {
  DFLIGHT_NO_CREDENTIALS_MESSAGE,
  DflightAuthError,
  dflightAuthorizedGet,
  getDflightCredentials,
  getDflightRuntimeConfig,
} from "./dflightAuth";
import { IT_DFLIGHT_ED269_URL, decodeItalianDownload, normalizeItalianZones } from "../../../shared/italianGeozones";

export {
  IT_DFLIGHT_ED269_URL,
  IT_GEOZONE_SOURCE_LABEL,
  IT_GEOZONE_ATTRIBUTION,
} from "../../../shared/italianGeozones";

const IT_DOWNLOAD_TIMEOUT_MS = 120_000;

/** Normalisiert eine bereits geladene d-flight-Antwort (für Tests/Offline). */
export function italyFeaturesFromBody(body: unknown, now: Date = new Date()): GeoFeature[] {
  return finalizeDirectFeatures(normalizeItalianZones(body, now) as unknown as GeoFeature[], "it");
}

/** Lädt alle italienischen Geozonen. Wirft ohne Zugang oder bei leerer Antwort. */
export async function fetchItaly(): Promise<GeoFeature[]> {
  const creds = await getDflightCredentials();
  if (!creds) throw new Error(DFLIGHT_NO_CREDENTIALS_MESSAGE);

  // Download-URL bevorzugt aus der Laufzeitkonfiguration (geoawareness.baseUrl).
  let url = IT_DFLIGHT_ED269_URL;
  try {
    url = (await getDflightRuntimeConfig()).ed269Url || IT_DFLIGHT_ED269_URL;
  } catch {
    // Konfiguration wird beim Header-Bau ohnehin erneut versucht und meldet dort den Fehler.
  }

  const res = await dflightAuthorizedGet(url, IT_DOWNLOAD_TIMEOUT_MS);
  if (res.status === 401 || res.status === 403) {
    throw new DflightAuthError("d-flight: Zugriff verweigert – bitte Zugang in den Einstellungen prüfen", "credentials", res.status);
  }
  if (!res.ok) throw new Error(`d-flight: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const features = italyFeaturesFromBody(decodeItalianDownload(bytes));
  if (features.length === 0) throw new Error("d-flight lieferte keine Zonen");
  return features;
}
