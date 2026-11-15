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

/** ED-269-Feed höchstens so oft prüfen (live seit Wochen HTTP 422). */
export const LU_ED269_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let luEd269LastCheckAt = 0;
let luEd269LastResult: { at: number; ok: boolean; count?: number; error?: string } | null = null;

/** Ergebnis der letzten ED-269-Prüfung (Diagnose). */
export function luxembourgEd269CheckStatus(): typeof luEd269LastResult {
  return luEd269LastResult;
}

/** Nur für Tests. */
export function __resetLuxembourgForTests(): void {
  luEd269LastCheckAt = 0;
  luEd269LastResult = null;
}

async function tryLuxembourgEd269(fetchJson: (url: string) => Promise<any>, now: number): Promise<GeoFeature[]> {
  luEd269LastCheckAt = now;
  try {
    const body = await fetchJson(LU_ED269_URL);
    const features = ed269ZonesToFeatures(body, { source: "DAC / Geoportail Luxembourg (CC0)" }) as unknown as GeoFeature[];
    luEd269LastResult = { at: now, ok: features.length > 0, count: features.length };
    return features;
  } catch (e) {
    luEd269LastResult = { at: now, ok: false, error: (e as Error)?.message || String(e) };
    console.warn("[geozoneDirect] LU: ED-269-Prüfung fehlgeschlagen:", luEd269LastResult.error);
    return [];
  }
}

/**
 * Luxemburg: OGC-Features (1927 + 1928) ZUERST; der ED-269-Feed (seit
 * Wochen HTTP 422) nur noch höchstens einmal täglich als Prüfung bzw. als
 * Rückfall, wenn OGC ausfällt. Beide Höhenschichten müssen laden – sonst kein
 * halber Bestand (der alte, vollständige Cache bleibt).
 */
export async function loadLuxembourg(
  fetchJson: (url: string) => Promise<any> = (u) => directFetchJson(u),
  now: number = Date.now(),
): Promise<GeoFeature[]> {
  let ogcError: unknown = null;
  let ogc: GeoFeature[] = [];
  try {
    const bodies = await Promise.all(LU_OGC_URLS.map((u) => fetchJson(u)));
    ogc = mergeLuxembourgOgc(bodies) as unknown as GeoFeature[];
    if (ogc.length === 0) ogcError = new Error("Geoportail lieferte keine Zonen");
  } catch (e) {
    ogcError = e;
    console.warn("[geozoneDirect] LU: OGC-Features nicht verfügbar, versuche ED-269:", (e as Error)?.message || e);
  }
  if (ogc.length > 0) {
    if (now - luEd269LastCheckAt >= LU_ED269_CHECK_INTERVAL_MS) {
      const check = await tryLuxembourgEd269(fetchJson, now);
      if (check.length > 0) console.log(`[geozoneDirect] LU: ED-269-Feed wieder verfügbar (${check.length} Zonen) – OGC bleibt Hauptquelle`);
    }
    return finalizeDirectFeatures(ogc, "lu");
  }
  const ed269 = await tryLuxembourgEd269(fetchJson, now);
  if (ed269.length > 0) return finalizeDirectFeatures(ed269, "lu");
  throw ogcError instanceof Error ? ogcError : new Error("Geoportail lieferte keine Zonen");
}

export async function fetchLuxembourg(): Promise<GeoFeature[]> {
  return loadLuxembourg();
}
