// Direkter Abruf der britischen Geozonen (UK AIP ENR 5.1 inkl. Flugplatz-FRZ).
// Siehe docs/uk-geozones-integration.md und shared/ukGeozones.ts.
//
// PRIMÄR: offizieller NATS-Digitaldatensatz „UK UAS Flight Restrictions“
// (AIXM 5.1, §7 der Doku):
//  1. Datei des laufenden AIRAC-Zyklus wählen (Effective Date ≤ heute; der
//     nächste Zyklus liegt oft schon online, gilt aber erst ab seinem Datum):
//     …/UAS_AREA_1/EG_UAS_FR_DS_AREA1_FULL_<YYYYMMDD>_XML.zip (≈ 0,5 MB,
//     entpackt ≈ 12 MB). Fehlt sie (404), der Vorgänger-Zyklus.
//  2. Bedingter Abruf: der Server (Apache) kennt Last-Modified/If-Modified-Since
//     (kein ETag). Liegt derselbe AIRAC-Stand schon auf dem Gerät, wird nur mit
//     If-Modified-Since nachgefragt – 304 → gespeicherte Zonen bleiben (kein
//     Download, kein Parsen). Neuer Zyklus → voller Download.
//  3. Streamend entpacken (fflate), SHA-256 der XML gegen die `.sha256` im ZIP
//     prüfen (Pflicht), AIXM stückweise mit Pausen parsen
//     (shared/geozoneKit/aixm.ts), normalisieren (shared/ukGeozones.ts).
// RÜCKFALL: Google-My-Maps-KML der NATS-Karte (Bögen vereinfacht, Attribute
// nur als HTML), wenn der AIXM-Weg scheitert (Netz, 404, Prüfsumme, Parser).
//
// Wirft, wenn beides scheitert (damit ein gespeicherter Datensatz erhalten
// bleibt). Bewusst frei von statischen React-Native-/Expo-Importen.
import type { GeoFeature } from "./ed269Sources";
import { directFetchText, finalizeDirectFeatures } from "./directFetchUtil";
import {
  GB_GEOZONE_SOURCE_LABEL,
  UK_AIP_KML_URL,
  normalizeUkAixmWithStats,
  normalizeUkKml,
  ukAixmCandidateDates,
  ukAixmZipUrl,
  ukAiracIsoDate,
} from "../../../shared/ukGeozones";
import { parseAixmZip, type AixmZipOptions } from "../../../shared/geozoneKit/aixm";

export { GB_GEOZONE_SOURCE_LABEL, UK_AIP_KML_URL };

/** Großzügiger Timeout: ~2 MB unkomprimiertes KML bzw. 0,5 MB ZIP. */
export const UK_FETCH_TIMEOUT_MS = 120_000;

/** KML-Text → finalisierte App-Features (testbar ohne Netz). */
export function unitedKingdomFeaturesFromKml(kml: string): GeoFeature[] {
  const features = normalizeUkKml(kml) as unknown as GeoFeature[];
  return finalizeDirectFeatures(features, "gb");
}

/** AIXM-ZIP → finalisierte App-Features (SHA-256 Pflicht). Wirft bei Fehlern. */
export async function unitedKingdomFeaturesFromAixmZip(
  zip: Uint8Array,
  opts: AixmZipOptions = {},
): Promise<{ features: GeoFeature[]; airac?: string; dropped: number; groups: number }> {
  const ds = await parseAixmZip(zip, { requireSha256: true, ...opts });
  if (ds.airspaces.length === 0) throw new Error("NATS-AIXM ohne Lufträume");
  const r = normalizeUkAixmWithStats(ds);
  const features = finalizeDirectFeatures(r.features as unknown as GeoFeature[], "gb");
  if (features.length === 0) throw new Error("NATS-AIXM lieferte keine Zonen");
  return { features, airac: r.airac, dropped: r.dropped.length, groups: r.groups };
}

// ---------------------------------------------------------------------------
// Abruf (Netz/Speicher austauschbar für Tests)
// ---------------------------------------------------------------------------

export interface UkHttpResponse {
  status: number;
  bytes?: Uint8Array;
  lastModified?: string;
}

export interface UkStoredDataset {
  fetchedAt: number;
  features: GeoFeature[];
  imported?: unknown;
}

export interface UkFetchEnv {
  now(): number;
  /** GET mit optionalem If-Modified-Since; 200/304/404 … als Status (wirft nur bei Netzfehlern). */
  getBytes(url: string, ifModifiedSince?: string): Promise<UkHttpResponse>;
  getText(url: string): Promise<string>;
  /** Auf dem Gerät gespeicherter GB-Bestand (ohne Netz) */
  stored(): Promise<UkStoredDataset | null>;
  log(msg: string): void;
}

async function defaultGetBytes(url: string, ifModifiedSince?: string): Promise<UkHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UK_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/zip,*/*" };
    if (ifModifiedSince) headers["If-Modified-Since"] = ifModifiedSince;
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers });
    const lastModified = res.headers?.get?.("last-modified") ?? undefined;
    if (res.status !== 200) return { status: res.status, lastModified };
    return { status: 200, bytes: new Uint8Array(await res.arrayBuffer()), lastModified };
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultStored(): Promise<UkStoredDataset | null> {
  try {
    // Lazy: ed269Store → ed269Sources → ukSource (kein statischer Zyklus).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const store = require("./ed269Store");
    return (await store.loadStoredEd269Dataset("GB")) ?? null;
  } catch {
    return null;
  }
}

const defaultEnv: UkFetchEnv = {
  now: () => Date.now(),
  getBytes: defaultGetBytes,
  getText: (url) => directFetchText(url, UK_FETCH_TIMEOUT_MS),
  stored: defaultStored,
  log: (m) => console.warn(`[geozoneDirect] GB: ${m}`),
};

/** Ergebnis des letzten Abrufs (Diagnose/Tests). */
export interface UkFetchReport {
  source: "aixm" | "aixm-not-modified" | "kml";
  airac?: string;
  url: string;
  aixmError?: string;
  features: number;
}

let lastReport: UkFetchReport | null = null;
export function getLastUkFetchReport(): UkFetchReport | null {
  return lastReport;
}

/** Datum für If-Modified-Since (RFC 7231). */
function httpDate(ms: number): string {
  return new Date(ms).toUTCString();
}

/** Ist der gespeicherte Bestand der NATS-AIXM-Stand dieses AIRAC-Datums? */
function storedAiracOf(ds: UkStoredDataset | null): string | undefined {
  if (!ds || ds.imported || !Array.isArray(ds.features) || ds.features.length === 0) return undefined;
  const p = (ds.features[0]?.properties ?? {}) as Record<string, any>;
  return p.ukDataset === "NATS-AIXM" ? ukAiracIsoDate(p.ukAirac) : undefined;
}

/** Nur AIXM (ohne KML-Rückfall); wirft bei Fehlschlag. */
export async function fetchUnitedKingdomAixm(env: UkFetchEnv = defaultEnv, opts: AixmZipOptions = {}): Promise<{ features: GeoFeature[]; report: UkFetchReport }> {
  const errors: string[] = [];
  for (const date of ukAixmCandidateDates(env.now(), 1)) {
    const url = ukAixmZipUrl(date);
    const airac = ukAiracIsoDate(date);
    const stored = await env.stored().catch(() => null);
    const sameStand = stored && storedAiracOf(stored) === airac && stored.fetchedAt > 0;
    const res = await env.getBytes(url, sameStand ? httpDate(stored!.fetchedAt) : undefined);
    if (res.status === 304 && sameStand) {
      return {
        features: stored!.features,
        report: { source: "aixm-not-modified", airac, url, features: stored!.features.length },
      };
    }
    if (res.status === 404 || res.status === 410) {
      errors.push(`${date}: HTTP ${res.status}`);
      continue;
    }
    if (res.status !== 200 || !res.bytes) throw new Error(`NATS-AIXM ${date}: HTTP ${res.status}`);
    const r = await unitedKingdomFeaturesFromAixmZip(res.bytes, opts);
    return { features: r.features, report: { source: "aixm", airac: r.airac ?? airac, url, features: r.features.length } };
  }
  throw new Error(`NATS-AIXM nicht gefunden (${errors.join(", ")})`);
}

/** Nur KML (Rückfall). */
export async function fetchUnitedKingdomKml(env: UkFetchEnv = defaultEnv): Promise<GeoFeature[]> {
  const kml = await env.getText(UK_AIP_KML_URL);
  if (!/<(\w+:)?kml[\s>]|<(\w+:)?Placemark[\s>]/.test(kml)) {
    throw new Error("UK AIP lieferte kein KML");
  }
  const features = unitedKingdomFeaturesFromKml(kml);
  if (features.length === 0) throw new Error("UK AIP lieferte keine Zonen");
  return features;
}

/** AIXM zuerst, bei jedem Fehler die KML. Testbar mit eigener Umgebung. */
export async function loadUnitedKingdom(env: UkFetchEnv = defaultEnv, opts: AixmZipOptions = {}): Promise<GeoFeature[]> {
  let aixmError: string | undefined;
  try {
    const { features, report } = await fetchUnitedKingdomAixm(env, opts);
    lastReport = report;
    return features;
  } catch (e) {
    aixmError = String((e as Error)?.message || e);
    env.log(`AIXM-Datensatz nicht nutzbar (${aixmError}) – Rückfall auf die NATS-Karte (KML)`);
  }
  const features = await fetchUnitedKingdomKml(env);
  lastReport = { source: "kml", url: UK_AIP_KML_URL, aixmError, features: features.length };
  return features;
}

export async function fetchUnitedKingdom(): Promise<GeoFeature[]> {
  return loadUnitedKingdom(defaultEnv);
}
