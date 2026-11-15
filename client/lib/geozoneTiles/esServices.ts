// Spanien: ENAIRE-Dienstpfade zur Laufzeit aus der Web Map von
// drones.enaire.es (docs/enaire-es-api-integration.md „Anhang ES (2)“).
//
//  - Beim Sync (Paket-Download: `fresh`) wird die Web-Map-Definition
//    …/insigniap/sharing/rest/content/items/b0449bba…/data?f=json gelesen und
//    die Layer-URLs über den stabilen Titel zugeordnet
//    (resolveEsLayersFromWebmap). Live-/NOTAM-Abfragen nutzen den gemerkten
//    Stand (≤ 6 h).
//  - Web Map nicht lesbar → feste Pfade (ES_INSIGNIAS_LAYERS) als Rückfall,
//    nach 10 min erneut versuchen.
//  - 404 einer Layer-URL (HTTP 404 bzw. ArcGIS-Fehler 404) → Item-Definition
//    EINMAL neu lesen und mit der neuen URL wiederholen (withEsLayer).
//
// Bewusst frei von React-Native-Importen (unter tsx testbar; Netz injiziert).
import {
  ES_INSIGNIAS_LAYERS,
  ES_WEBMAP_DATA_URL,
  esInsigniasLayerUrl,
  resolveEsLayersFromWebmap,
  type EsInsigniasLayer,
} from "../../../shared/spanishGeozones";

export type EsFetchJson = (url: string, timeoutMs?: number) => Promise<any>;

/** Gemerkte Web-Map-Auflösung für Live-/NOTAM-Abfragen. */
export const ES_WEBMAP_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Nach einem Fehlschlag (Rückfall-Pfade) erneut versuchen nach … */
export const ES_WEBMAP_RETRY_MS = 10 * 60 * 1000;
const WEBMAP_TIMEOUT_MS = 30_000;

export interface EsServiceResolution {
  layers: EsInsigniasLayer[];
  /** true = URLs (mindestens teilweise) aus der Web Map */
  fromWebmap: boolean;
  /** Zeitpunkt der Auflösung (ms) */
  at: number;
}

let cache: EsServiceResolution | null = null;
let validUntil = 0;
let inFlight: Promise<EsServiceResolution> | null = null;

/** Nur für Tests. */
export function __resetEsServicesForTests(): void {
  cache = null;
  validUntil = 0;
  inFlight = null;
}

async function readWebmap(fetchJson: EsFetchJson, now: number): Promise<EsServiceResolution> {
  try {
    const r = resolveEsLayersFromWebmap(await fetchJson(ES_WEBMAP_DATA_URL, WEBMAP_TIMEOUT_MS));
    if (r.fromWebmap.length === 0) throw new Error("keine bekannte Ebene in der Web Map");
    if (r.fallback.length > 0) console.warn("[geozoneTiles] ES: Ebenen nicht in der Web Map (feste Pfade):", r.fallback.join(", "));
    cache = { layers: r.layers, fromWebmap: true, at: now };
    validUntil = now + ES_WEBMAP_MAX_AGE_MS;
  } catch (e) {
    console.warn("[geozoneTiles] ES: Web Map nicht lesbar, nutze feste Dienstpfade:", (e as Error)?.message || e);
    // Bisherige Auflösung behalten (falls vorhanden), sonst Rückfall
    cache = cache ? { ...cache, at: now } : { layers: ES_INSIGNIAS_LAYERS.map((l) => ({ ...l })), fromWebmap: false, at: now };
    validUntil = now + ES_WEBMAP_RETRY_MS;
  }
  return cache;
}

/**
 * Layer-Katalog mit aktuellen URLs. `fresh`: Web Map jetzt neu lesen (Sync);
 * sonst gemerkter Stand, solange gültig.
 */
export async function resolveEsLayers(fetchJson: EsFetchJson, opts: { fresh?: boolean; now?: number } = {}): Promise<EsServiceResolution> {
  const now = opts.now ?? Date.now();
  if (!opts.fresh && cache && now < validUntil) return cache;
  if (!inFlight) inFlight = readWebmap(fetchJson, now).finally(() => (inFlight = null));
  return inFlight;
}

/** Ein Layer (mit aktueller URL) nach Schlüssel. */
export async function resolveEsLayer(key: string, fetchJson: EsFetchJson, opts: { fresh?: boolean } = {}): Promise<EsInsigniasLayer | null> {
  const r = await resolveEsLayers(fetchJson, opts);
  return r.layers.find((l) => l.key === key) ?? null;
}

/** HTTP 404 bzw. ArcGIS-Fehlerobjekt mit Code 404 („Service not found“)? */
export function isEsNotFoundError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /\bHTTP 404\b|ArcGIS-Fehler 404\b/.test(msg);
}

/**
 * `run` mit dem aktuellen Layer ausführen; bei 404 die Web Map EINMAL neu
 * lesen und – falls sich die URL geändert hat – mit der neuen URL wiederholen.
 */
export async function withEsLayer<T>(
  key: string,
  fetchJson: EsFetchJson,
  run: (layer: EsInsigniasLayer) => Promise<T>,
  opts: { fresh?: boolean } = {},
): Promise<T> {
  const startedAt = Date.now();
  const layer = await resolveEsLayer(key, fetchJson, opts);
  if (!layer) throw new Error(`Unbekannter ENAIRE-Layer ${key}`);
  try {
    return await run(layer);
  } catch (e) {
    if (!isEsNotFoundError(e)) throw e;
    // Wurde die Web Map inzwischen (von einer parallelen Abfrage) neu gelesen, diesen Stand nehmen.
    const fresh = cache && cache.at > startedAt ? cache : await resolveEsLayers(fetchJson, { fresh: true });
    const next = fresh.layers.find((l) => l.key === key);
    if (!next || esInsigniasLayerUrl(next) === esInsigniasLayerUrl(layer)) throw e;
    return run(next);
  }
}
