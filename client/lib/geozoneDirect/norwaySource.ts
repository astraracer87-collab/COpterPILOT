// Norwegen (Luftfartstilsynet / dronesoner.no) – direkter Abruf der ED-269-
// Tagesdatei. Der Dateiname trägt das Build-Datum; alte Dateien werden
// gelöscht. Darum zuerst index.html lesen, nur im Notfall heute/gestern raten
// (docs/geozonen-weitere-laender.md §3). React-Native-frei (tsx-testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, directFetchText, finalizeDirectFeatures } from "./directFetchUtil";
import {
  NO_DRONESONER_BASE_URL,
  normalizeNorwegianZones,
  norwayEd269UrlFromHtml,
  norwayFallbackUrls,
} from "../../../shared/norwegianGeozones";

export { NO_GEOZONE_SOURCE_LABEL, NO_GEOZONE_ATTRIBUTION } from "../../../shared/norwegianGeozones";

/** Normalisiert ein bereits geladenes dronesoner.no-Array (für Tests/Offline). */
export function norwayFeaturesFromBody(body: unknown): GeoFeature[] {
  return finalizeDirectFeatures(normalizeNorwegianZones(body) as unknown as GeoFeature[], "no");
}

/** Kandidaten-URLs in Abrufreihenfolge (index.html-Treffer zuerst). */
export async function norwayCandidateUrls(now: Date = new Date()): Promise<string[]> {
  const urls: string[] = [];
  try {
    const html = await directFetchText(NO_DRONESONER_BASE_URL, 20_000);
    const u = norwayEd269UrlFromHtml(html);
    if (u) urls.push(u);
  } catch (e) {
    console.warn("[geozoneDirect] NO: index.html nicht lesbar:", (e as Error)?.message || e);
  }
  for (const u of norwayFallbackUrls(now)) if (!urls.includes(u)) urls.push(u);
  return urls;
}

/** Lädt alle norwegischen Geozonen. Wirft, wenn keine Tagesdatei erreichbar ist. */
export async function fetchNorway(): Promise<GeoFeature[]> {
  let lastError: unknown = null;
  for (const url of await norwayCandidateUrls()) {
    try {
      const body = await directFetchJson(url);
      if (!Array.isArray(body)) throw new Error("unerwartetes Format (kein Array)");
      const features = norwayFeaturesFromBody(body);
      if (features.length > 0) return features;
      lastError = new Error("leere Datei");
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`dronesoner.no nicht erreichbar: ${(lastError as Error)?.message || lastError}`);
}
