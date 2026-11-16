/**
 * Luftfahrt-Punkte aus OpenStreetMap (Hubschrauberlandeplätze inkl.
 * Luftrettung/Klinik, Flugplätze, Segelflug-/UL-Gelände, Modellflugplätze)
 * für die „Hinweise in der Nähe“ der Gebietsübersicht.
 *
 * Gleicher Weg wie die Hindernisse (obstacles.ts): Overpass-Kacheln auf
 * Zoomstufe 10, Speicher → Gerät → Internet, 30 Tage gültig, gemeinsamer
 * Overpass-Zugang (max. 2 parallele Abfragen). Abfrage/Parser sind RN-frei
 * in areaOverview.ts.
 */
import * as FileSystem from "expo-file-system/legacy";
import { createFileTileStorage, overpassRequest } from "./obstacles";
import { createObstacleTileCache, OBSTACLE_TILE_ZOOM, tileBounds, tilesForBounds } from "./obstacleTileCache";
import { obstacleTileInActiveCountry } from "./obstacleCountryFilter";
import { awaitCountryUsage } from "./countryUsage";
import { buildAviationPoiQuery, parseAviationPoisOverpass, poisFromFeatureCollection, type AviationPoi } from "./areaOverview";

const CACHE_DIR = `${FileSystem.documentDirectory}aviation_pois/`;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

const cache = createObstacleTileCache({
  storage: createFileTileStorage(CACHE_DIR),
  maxAgeMs: MAX_AGE_MS,
  memoryLimit: 16,
  isAllowed: async (x, y) => {
    await awaitCountryUsage();
    return obstacleTileInActiveCountry(tileBounds(x, y, OBSTACLE_TILE_ZOOM));
  },
  fetchTile: async (x, y) => parseAviationPoisOverpass(await overpassRequest(buildAviationPoiQuery(tileBounds(x, y, OBSTACLE_TILE_ZOOM)))),
});

export interface AviationPoiResult {
  pois: AviationPoi[];
  /** alle Kacheln des Bereichs lagen vor (gespeichert oder geladen) */
  complete: boolean;
  /** keine einzige Kachel verfügbar (offline ohne Speicher bzw. Fehler) */
  unavailable: boolean;
}

/** Luftfahrt-Punkte im Quadrat ±`extentKm` um eine Position. */
export async function loadAviationPoisAround(
  lat: number,
  lon: number,
  extentKm: number,
  opts: { allowNetwork?: boolean } = {},
): Promise<AviationPoiResult> {
  const dLat = extentKm / 110.54;
  const dLon = extentKm / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const w = lon - dLon, e = lon + dLon, s = lat - dLat, n = lat + dLat;
  const tiles = tilesForBounds(w, s, e, n);
  const delivered = new Set<string>();
  const fc = await cache.loadForBounds(w, s, e, n, {
    allowNetwork: opts.allowNetwork,
    maxTiles: 12,
    onTile: (key) => delivered.add(key),
  });
  return {
    pois: poisFromFeatureCollection(fc),
    complete: delivered.size >= tiles.length,
    unavailable: delivered.size === 0,
  };
}
