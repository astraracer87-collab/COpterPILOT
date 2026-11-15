// Norwegen (Luftfartstilsynet / dronesoner.no) – direkter Abruf der ED-269-
// Tagesdatei. Der Dateiname trägt das Build-Datum; alte Dateien werden
// gelöscht. Darum zuerst index.html lesen, nur im Notfall heute/gestern raten
// (docs/geozonen-weitere-laender.md §3). React-Native-frei (tsx-testbar).
//
// Zusätzlich die in ED-269 fehlenden Ebenen aus /data/ (NO_DATA_LAYERS in
// shared/norwegianGeozones.ts): NOTAM-basierte Dateien nur neu, wenn sich
// notam_status.json (oppdatert_iso) ändert; feste Dateien höchstens täglich.
// Fehlt eine Datei, bleibt der Rest (Abdeckung „partial“, Zonen dieser Datei
// aus dem letzten Stand); meldet notam_status.json fehlgeschlagene
// NOTAM-Quellen, ebenfalls „partial“. Die ED-269-Datei bleibt Pflicht.
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, directFetchText, finalizeDirectFeatures, withFetchCoverage, type DirectFetchCoverage } from "./directFetchUtil";
import {
  NO_DATA_LAYERS,
  NO_NOTAM_STATUS_URL,
  mergeNorwayDataLayers,
  noDataFileUrl,
  type NoDataFile,
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

/** Lädt die ED-269-Tagesdatei. Wirft, wenn keine erreichbar ist. */
export async function fetchNorwayEd269(): Promise<GeoFeature[]> {
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

type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;

/** Feste /data/-Dateien höchstens so oft neu laden. */
export const NO_STATIC_DATA_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface NoDataMemo {
  statusIso?: string;
  byFile: Partial<Record<NoDataFile, { at: number; statusIso?: string; features: any[] }>>;
}
let noDataMemo: NoDataMemo = { byFile: {} };

/** Nur für Tests: Zwischenspeicher der /data/-Dateien leeren. */
export function __resetNorwayDataMemoForTests(): void {
  noDataMemo = { byFile: {} };
}

export interface NorwayDataResult {
  byFile: Partial<Record<NoDataFile, any[]>>;
  failed: NoDataFile[];
  statusIso?: string;
  /** Hinweis aus notam_status.json (kilder_feilet / antall_feilet) */
  statusNote?: string;
  /** Dateien, die tatsächlich geladen wurden (nicht aus dem Zwischenspeicher) */
  downloaded: NoDataFile[];
}

/**
 * /data/-Ebenen laden: NOTAM-basierte Dateien nur, wenn sich oppdatert_iso
 * geändert hat (sonst Zwischenspeicher), feste Dateien höchstens täglich.
 */
export async function fetchNorwayDataLayers(fetchJson: FetchJson = directFetchJson, now: number = Date.now()): Promise<NorwayDataResult> {
  let statusIso: string | undefined;
  let statusNote: string | undefined;
  try {
    const st = await fetchJson(`${NO_NOTAM_STATUS_URL}?v=${now}`, 20_000);
    statusIso = typeof st?.oppdatert_iso === "string" ? st.oppdatert_iso : undefined;
    const failedSources = Array.isArray(st?.kilder_feilet) ? st.kilder_feilet.map(String).filter(Boolean) : [];
    const failedCount = Number(st?.antall_feilet) || 0;
    if (failedSources.length > 0 || failedCount > 0) {
      statusNote = `dronesoner.no: NOTAM-Quellen teilweise fehlgeschlagen${failedSources.length ? ` (${failedSources.join(", ")})` : ""} – NOTAM-Zonen evtl. unvollständig`;
    }
  } catch (e) {
    console.warn("[geozoneDirect] NO: notam_status.json nicht lesbar:", (e as Error)?.message || e);
  }
  const byFile: Partial<Record<NoDataFile, any[]>> = {};
  const failed: NoDataFile[] = [];
  const downloaded: NoDataFile[] = [];
  await Promise.all(
    NO_DATA_LAYERS.map(async (def) => {
      const memo = noDataMemo.byFile[def.file];
      const fresh = memo
        ? def.dynamic
          ? statusIso != null && memo.statusIso === statusIso
          : now - memo.at < NO_STATIC_DATA_MAX_AGE_MS
        : false;
      if (memo && fresh) {
        byFile[def.file] = memo.features;
        return;
      }
      try {
        const body = await fetchJson(`${noDataFileUrl(def.file)}?v=${def.dynamic ? statusIso ?? now : Math.floor(now / NO_STATIC_DATA_MAX_AGE_MS)}`, 60_000);
        const features = Array.isArray(body?.features) ? body.features : [];
        byFile[def.file] = features;
        downloaded.push(def.file);
        noDataMemo.byFile[def.file] = { at: now, statusIso, features };
      } catch (e) {
        failed.push(def.file);
        console.warn(`[geozoneDirect] NO: ${def.file} nicht abrufbar:`, (e as Error)?.message || e);
      }
    }),
  );
  noDataMemo.statusIso = statusIso;
  return { byFile, failed, statusIso, statusNote, downloaded };
}

/** ED-269 + fehlende /data/-Ebenen (testbar mit eigenem fetchJson). */
export async function loadNorway(
  fetchEd269: () => Promise<GeoFeature[]> = fetchNorwayEd269,
  fetchJson: FetchJson = directFetchJson,
  now: number = Date.now(),
): Promise<GeoFeature[]> {
  const ed269 = await fetchEd269();
  let data: NorwayDataResult;
  try {
    data = await fetchNorwayDataLayers(fetchJson, now);
  } catch {
    data = { byFile: {}, failed: NO_DATA_LAYERS.map((d) => d.file), downloaded: [] };
  }
  const { features: extra, duplicates } = mergeNorwayDataLayers(ed269, data.byFile, { now, statusIso: data.statusIso });
  if (Object.keys(duplicates).length > 0) console.log("[geozoneDirect] NO: /data/-Zonen schon in ED-269:", duplicates);
  const out = [...ed269, ...finalizeDirectFeatures(extra as unknown as GeoFeature[], "no")];
  const notes: string[] = [];
  let coverage: DirectFetchCoverage | undefined;
  if (data.failed.length > 0) notes.push(`dronesoner.no: ${data.failed.join(", ")} nicht abrufbar – deren Zonen fehlen bzw. stammen aus dem letzten Stand`);
  if (data.statusNote) notes.push(data.statusNote);
  if (notes.length > 0) {
    const failedSet = new Set<string>(data.failed);
    coverage = {
      partialNote: notes.join(" · "),
      keepPrevious: data.failed.length ? (p) => failedSet.has(String(p.noLayer ?? "")) : undefined,
    };
  }
  return withFetchCoverage(out, coverage);
}

/** Lädt alle norwegischen Geozonen. Wirft, wenn keine Tagesdatei erreichbar ist. */
export async function fetchNorway(): Promise<GeoFeature[]> {
  return loadNorway();
}
