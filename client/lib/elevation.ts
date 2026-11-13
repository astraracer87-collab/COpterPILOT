const OPEN_METEO_ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

const MAX_CACHE_SIZE = 2000;
const elevationCache = new Map<string, number>();

function pruneCache() {
  if (elevationCache.size <= MAX_CACHE_SIZE) return;
  const excess = elevationCache.size - Math.floor(MAX_CACHE_SIZE * 0.75);
  const iter = elevationCache.keys();
  for (let i = 0; i < excess; i++) {
    const next = iter.next();
    if (next.done) break;
    elevationCache.delete(next.value);
  }
}

function coordKey(lat: number, lon: number): string {
  return `${(Math.round(lat * 1000) / 1000).toFixed(3)},${(Math.round(lon * 1000) / 1000).toFixed(3)}`;
}

export async function fetchElevation(lat: number, lon: number): Promise<number | null> {
  const key = coordKey(lat, lon);
  const cached = elevationCache.get(key);
  if (cached != null) return cached;

  try {
    const response = await fetch(
      `${OPEN_METEO_ELEVATION_URL}?latitude=${lat}&longitude=${lon}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    const elev = data?.elevation?.[0];
    if (elev != null && typeof elev === "number") {
      elevationCache.set(key, elev);
      pruneCache();
      return elev;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchBatchElevations(
  coords: { lat: number; lon: number }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (coords.length === 0) return result;

  const uniqueCoords: { lat: number; lon: number; key: string }[] = [];
  const needFetch: { lat: number; lon: number; key: string }[] = [];

  for (const c of coords) {
    const key = coordKey(c.lat, c.lon);
    const cached = elevationCache.get(key);
    if (cached != null) {
      result.set(key, cached);
    } else if (!uniqueCoords.some((u) => u.key === key)) {
      uniqueCoords.push({ ...c, key });
      needFetch.push({ ...c, key });
    }
  }

  if (needFetch.length === 0) return result;

  const MAX_BATCH = 100;
  for (let i = 0; i < needFetch.length; i += MAX_BATCH) {
    const batch = needFetch.slice(i, i + MAX_BATCH);
    const lats = batch.map((c) => c.lat.toFixed(4)).join(",");
    const lons = batch.map((c) => c.lon.toFixed(4)).join(",");

    try {
      const response = await fetch(
        `${OPEN_METEO_ELEVATION_URL}?latitude=${lats}&longitude=${lons}`
      );
      if (!response.ok) continue;
      const data = await response.json();
      const elevations: number[] = data?.elevation ?? [];

      for (let j = 0; j < batch.length && j < elevations.length; j++) {
        const elev = elevations[j];
        if (elev != null && typeof elev === "number") {
          elevationCache.set(batch[j].key, elev);
          result.set(batch[j].key, elev);
        }
      }
      pruneCache();
    } catch {
      // continue silently
    }
  }

  return result;
}

export function getElevationFromCache(lat: number, lon: number): number | null {
  const key = coordKey(lat, lon);
  return elevationCache.get(key) ?? null;
}

export function getCachedElevationKey(lat: number, lon: number): string {
  return coordKey(lat, lon);
}

export function clearElevationCache(): void {
  elevationCache.clear();
}

let lastFullEnrichTime = 0;
const FULL_ENRICH_INTERVAL_MS = 15000;

export async function enrichAircraftWithElevation<T extends { latitude: number; longitude: number; geoAltitude: number | null; baroAltitude: number | null }>(
  aircraft: T[]
): Promise<(T & { aglAltitude: number | null; groundElevation: number | null })[]> {
  const now = Date.now();
  const useFullFetch = now - lastFullEnrichTime >= FULL_ENRICH_INTERVAL_MS;

  if (useFullFetch) {
    const coords = aircraft.map((ac) => ({ lat: ac.latitude, lon: ac.longitude }));
    try {
      await fetchBatchElevations(coords);
      lastFullEnrichTime = now;
    } catch {}
  }

  return aircraft.map((ac) => {
    const groundElev = getElevationFromCache(ac.latitude, ac.longitude);
    const mslAlt = ac.geoAltitude ?? ac.baroAltitude;
    const agl = groundElev != null && mslAlt != null ? Math.max(0, mslAlt - groundElev) : null;
    return { ...ac, groundElevation: groundElev, aglAltitude: agl };
  });
}
