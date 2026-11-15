// Abruf Island (Samgöngustofa / ISAVIA) – GeoServer-WFS auf gis.is bzw.
// gis.natt.is, GeoJSON, ohne Authentifizierung. Zonen aus BEIDEN Layern:
// dronemap_ice_geom (Webseite, bevorzugt) + dronemap_isl_geom (ergänzend). Siehe docs/iceland-samgongustofa-api-integration.md
// und shared/icelandicGeozones.ts (Einstufung, Höhen, Texte).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  IS_CLOSURES_LAYER,
  IS_WFS_FALLBACK_URL,
  IS_WFS_PAGE_SIZE,
  IS_WEBSITE_WFS_URL,
  IS_WEBSITE_ZONES_LAYER,
  IS_WFS_URL,
  IS_ZONES_LAYER,
  mergeIcelandicZoneLayers,
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

/** Layer der Webseite: zuerst gis.natt.is (Webseite), dann gis.is. */
async function fetchWebsiteLayer(): Promise<any[]> {
  try {
    return await fetchLayerFrom(IS_WEBSITE_WFS_URL, IS_WEBSITE_ZONES_LAYER);
  } catch (e) {
    console.warn("[geozoneDirect] IS: dronemap_ice_geom über gis.natt.is fehlgeschlagen, nutze gis.is:", (e as Error)?.message || e);
    return await fetchLayerFrom(IS_WFS_URL, IS_WEBSITE_ZONES_LAYER);
  }
}

/**
 * Beide Zonen-Layer laden (Webseite bevorzugt, älterer Layer ergänzt ohne
 * Doppelungen). Fällt einer aus, gilt der andere allein; beide aus → Fehler.
 */
export async function loadIcelandZones(
  fetchWebsite: () => Promise<any[]> = fetchWebsiteLayer,
  fetchLegacy: () => Promise<any[]> = () => fetchLayer(IS_ZONES_LAYER),
): Promise<ReturnType<typeof normalizeIcelandicZones>> {
  const [web, legacy] = await Promise.allSettled([fetchWebsite(), fetchLegacy()]);
  if (web.status === "rejected") console.warn("[geozoneDirect] IS: dronemap_ice_geom nicht abrufbar:", (web.reason as Error)?.message || web.reason);
  if (legacy.status === "rejected") console.warn("[geozoneDirect] IS: dronemap_isl_geom nicht abrufbar:", (legacy.reason as Error)?.message || legacy.reason);
  const webZones = web.status === "fulfilled" ? normalizeIcelandicZones(web.value) : [];
  const legacyZones = legacy.status === "fulfilled" ? normalizeIcelandicZones(legacy.value) : [];
  return mergeIcelandicZoneLayers(webZones, legacyZones);
}

export async function fetchIceland(): Promise<GeoFeature[]> {
  const zones = await loadIcelandZones();
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
