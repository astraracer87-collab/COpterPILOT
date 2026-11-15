// Direkter Abruf der slowakischen Geozonen – siehe docs/slovakia-lps-api-integration.md
// und die Quellenbeschreibung in shared/slovakGeozones.ts.
//
//  1. Drohnenspezifisch (bevorzugt): Dopravný úrad, Seite „Zemepisné oblasti
//     UAS“ → verlinktes ZIP (Dateiname wechselt mit dem Stand) → KML.
//  2. Ergänzend: LPS SR, öffentlicher ArcGIS-MapServer
//     VFRM/VFRM_popup/MapServer/5 „Airspace“ (`f=geojson`, WGS84, volle
//     Präzision, paginiert über resultOffset/resultRecordCount +
//     exceededTransferLimit; maxRecordCount 1000).
//  3. LPS SR, Live-Reservierungen Hosted/Reservation_(Public)2 (Rückfall
//     Reservation_(Public)) mit dem Filter der Webseite + Health-Check
//     Hosted/Status_(Public): R/TRA/TSA nur in Reservierungsfenstern aktiv
//     (eigene, befristete Zonen mit den Höhen der Reservierung). Ohne
//     Reservierungsdaten bleiben sie wie bisher dauerhaft aktiv.
//  Alle Quellen werden parallel geladen; fällt DÚ oder LPS aus, wird die
//  andere allein verwendet (Warnung). Liefern beide nichts, wird geworfen.
// Pflicht-Attribution: „VFR Manual, LPS SR, š. p.“ bzw. „© Dopravný úrad SR“.
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, directFetchText, finalizeDirectFeatures } from "./directFetchUtil";
import {
  SK_DU_UAS_ZONES_PAGE_URL,
  SK_GEOZONE_ATTRIBUTION,
  SK_GEOZONE_SOURCE_LABEL,
  decodeSkDuArchive,
  findSkDuZipUrl,
  SK_RESERVATION_LAYER_FALLBACK_URL,
  SK_RESERVATION_LAYER_URL,
  normalizeSlovakiaWithStats,
  skLpsQueryUrl,
  skReservationHealth,
  skReservationQueryUrl,
  skStatusQueryUrl,
  type SkReservationHealth,
} from "../../../shared/slovakGeozones";
import { fetchArcgisPaged } from "../../../shared/geozoneKit/arcgis";

export { SK_GEOZONE_SOURCE_LABEL, SK_GEOZONE_ATTRIBUTION };

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 90_000;
const DU_TIMEOUT_MS = 90_000;

type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;
type FetchText = (url: string, timeoutMs?: number) => Promise<string>;
type FetchBytes = (url: string, timeoutMs?: number) => Promise<Uint8Array>;

export interface SlovakiaFetchers {
  json?: FetchJson;
  text?: FetchText;
  bytes?: FetchBytes;
  now?: number;
}

async function fetchBytesWithTimeout(url: string, timeoutMs: number = DU_TIMEOUT_MS): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { Accept: "*/*" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

/** Alle Rohfeatures des LPS-Airspace-Layers seitenweise laden. */
export async function fetchSlovakiaLpsRaw(fetchJson: FetchJson = directFetchJson): Promise<any[]> {
  return fetchArcgisPaged({ pageUrl: skLpsQueryUrl, fetchJson, pageSize: PAGE_SIZE, maxPages: MAX_PAGES, timeoutMs: PAGE_TIMEOUT_MS });
}

/** DÚ-Seite lesen, ZIP-Link finden, Archiv laden und KML-Text liefern. */
export async function fetchSlovakiaDuKml(
  fetchText: FetchText = directFetchText,
  fetchBytes: FetchBytes = fetchBytesWithTimeout,
): Promise<string> {
  const html = await fetchText(SK_DU_UAS_ZONES_PAGE_URL, DU_TIMEOUT_MS);
  const url = findSkDuZipUrl(html);
  if (!url) throw new Error("Dopravný úrad: kein KML/ZIP-Link auf der Geozonen-Seite gefunden");
  const kml = decodeSkDuArchive(await fetchBytes(url, DU_TIMEOUT_MS));
  if (!/<Placemark[\s>]/i.test(kml)) throw new Error("Dopravný úrad: KML ohne Zonen");
  return kml;
}

const RES_TIMEOUT_MS = 30_000;

/** Live-Reservierungen (Reservation_(Public)2, Rückfall Reservation_(Public)). */
export async function fetchSlovakiaReservationsRaw(fetchJson: FetchJson = directFetchJson): Promise<any[]> {
  let lastError: unknown;
  for (const layerUrl of [SK_RESERVATION_LAYER_URL, SK_RESERVATION_LAYER_FALLBACK_URL]) {
    try {
      return await fetchArcgisPaged({
        pageUrl: (offset, count) => skReservationQueryUrl(layerUrl, offset, count),
        fetchJson,
        pageSize: PAGE_SIZE,
        maxPages: 5,
        timeoutMs: RES_TIMEOUT_MS,
      });
    } catch (e) {
      lastError = e;
      console.warn("[geozoneDirect] SK: Reservierungen nicht abrufbar:", layerUrl, (e as Error)?.message || e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Health-Check des AUP/UUP-Imports; Fehler beim Abruf → unzuverlässig. */
export async function fetchSlovakiaReservationHealth(fetchJson: FetchJson = directFetchJson, now = Date.now()): Promise<SkReservationHealth> {
  try {
    return skReservationHealth(await fetchJson(skStatusQueryUrl(), RES_TIMEOUT_MS), now);
  } catch (e) {
    return { ok: false, note: `Aktivierungsdaten (AUP/UUP) evtl. nicht aktuell (Status nicht abrufbar: ${(e as Error)?.message || e})` };
  }
}

/** Laden + normalisieren (testbar mit eigenen Fetchern). */
export async function loadSlovakia(f: SlovakiaFetchers = {}): Promise<GeoFeature[]> {
  const json = f.json ?? directFetchJson;
  const now = f.now ?? Date.now();
  const [du, lps, res, health] = await Promise.allSettled([
    fetchSlovakiaDuKml(f.text ?? directFetchText, f.bytes ?? fetchBytesWithTimeout),
    fetchSlovakiaLpsRaw(json),
    fetchSlovakiaReservationsRaw(json),
    fetchSlovakiaReservationHealth(json, now),
  ]);
  if (res.status === "rejected") console.warn("[geozoneDirect] SK: ohne Reservierungsdaten – R/TRA/TSA bleiben dauerhaft aktiv");
  if (du.status === "rejected") console.warn("[geozoneDirect] SK: DÚ-Geozonen nicht verfügbar:", du.reason);
  if (lps.status === "rejected") console.warn("[geozoneDirect] SK: LPS-Lufträume nicht verfügbar:", lps.reason);
  const duKml = du.status === "fulfilled" ? du.value : undefined;
  const lpsRaw = lps.status === "fulfilled" ? lps.value : [];
  if (!duKml && lpsRaw.length === 0) {
    const reason = lps.status === "rejected" ? lps.reason : du.status === "rejected" ? du.reason : undefined;
    throw new Error(`LPS SR / Dopravný úrad lieferten keine Zonen${reason ? `: ${String((reason as any)?.message ?? reason)}` : ""}`);
  }
  const { features, dropped, activation } = normalizeSlovakiaWithStats({
    duKml,
    lps: lpsRaw,
    now,
    reservations: res.status === "fulfilled" ? res.value : undefined,
    reservationHealth: health.status === "fulfilled" ? health.value : undefined,
  });
  if (activation.loaded && !activation.reliable) console.warn("[geozoneDirect] SK:", activation.healthNote);
  const summary: Record<string, number> = {};
  for (const d of dropped) summary[d.reason] = (summary[d.reason] ?? 0) + 1;
  if (dropped.length > 0) console.log(`[geozoneDirect] SK: ${dropped.length} Zone(n) nicht übernommen:`, summary);
  if (features.length === 0) throw new Error("LPS SR / Dopravný úrad lieferten keine gültigen Zonen");
  return finalizeDirectFeatures(features as unknown as GeoFeature[], "sk");
}

export async function fetchSlovakia(): Promise<GeoFeature[]> {
  return loadSlovakia();
}
