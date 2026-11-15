// Abruf Island (Samgöngustofa / ISAVIA) – GeoServer-WFS auf gis.is, GeoJSON,
// ohne Authentifizierung. Siehe docs/iceland-samgongustofa-api-integration.md
// und shared/icelandicGeozones.ts (Einstufung, Höhen, Texte).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  IS_CLOSURES_LAYER,
  IS_WFS_FALLBACK_URL,
  IS_WFS_PAGE_SIZE,
  IS_WFS_URL,
  IS_ZONES_LAYER,
  icelandWfsHasMore,
  icelandWfsUrl,
  mergeIcelandicFeatures,
  normalizeIcelandicClosures,
  normalizeIcelandicZones,
} from "../../../shared/icelandicGeozones";
import { fetchWfsPaged } from "../../../shared/geozoneKit/wfs";

const IS_MAX_PAGES = 50;

/** Alle Features eines Layers per WFS-Paging (count/startIndex) von einem Host. */
async function fetchLayerFrom(base: string, layer: string): Promise<any[]> {
  return fetchWfsPaged({
    pageUrl: (startIndex, count) => icelandWfsUrl(layer, { base, count, startIndex }),
    fetchJson: directFetchJson,
    pageSize: IS_WFS_PAGE_SIZE,
    maxPages: IS_MAX_PAGES,
    timeoutMs: 90_000,
    hasMore: icelandWfsHasMore,
  });
}

/** Primär gis.is, bei Fehler gis.natt.is (gleicher WFS). */
async function fetchLayer(layer: string): Promise<any[]> {
  try {
    return await fetchLayerFrom(IS_WFS_URL, layer);
  } catch (e) {
    console.warn(`[geozoneDirect] IS: ${layer} über gis.is fehlgeschlagen, nutze gis.natt.is:`, (e as Error)?.message || e);
    return await fetchLayerFrom(IS_WFS_FALLBACK_URL, layer);
  }
}

export async function fetchIceland(): Promise<GeoFeature[]> {
  const zones = normalizeIcelandicZones(await fetchLayer(IS_ZONES_LAYER));
  if (zones.length === 0) throw new Error("Samgöngustofa lieferte keine Zonen");

  // Temporäre Sperrungen sind optional – ein Fehler hier darf die Zonen nicht kosten.
  let closures: ReturnType<typeof normalizeIcelandicClosures> = [];
  try {
    closures = normalizeIcelandicClosures(await fetchLayer(IS_CLOSURES_LAYER));
  } catch (e) {
    console.warn("[geozoneDirect] IS: temporäre Sperrungen nicht abrufbar:", (e as Error)?.message || e);
  }

  return finalizeDirectFeatures(mergeIcelandicFeatures(zones, closures) as unknown as GeoFeature[], "is");
}
