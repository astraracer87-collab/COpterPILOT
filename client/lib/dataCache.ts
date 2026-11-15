// Re-fetchbare Abrufergebnisse (dipul-Listen, Radar-Warnungen, LU-Zonen …).
// Liegen im Datei-Cache (fileCache.ts), NICHT in AsyncStorage: dort füllten
// sie die SQLite-DB, bis Nutzerdaten nicht mehr gespeichert werden konnten.
import { fileCacheStorage as store } from "./fileCache";

export const DATA_CACHE_PREFIX = "dc_";
const CACHE_PREFIX = DATA_CACHE_PREFIX;
export const DATA_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  ts: number;
  key: string;
}

export async function getCached<T>(
  cacheKey: string,
): Promise<CacheEntry<T> | null> {
  try {
    const raw = await store.getItem(CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > DATA_CACHE_MAX_AGE_MS) {
      store.removeItem(CACHE_PREFIX + cacheKey).catch(() => {});
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function setCache<T>(
  cacheKey: string,
  data: T,
  locationKey?: string,
): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      data,
      ts: Date.now(),
      key: locationKey || cacheKey,
    };
    await store.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(entry));
  } catch {}
}

export function makeCacheKey(
  prefix: string,
  lat?: number | null,
  lon?: number | null,
): string {
  if (lat == null || lon == null) return prefix;
  const rLat = Math.round(lat * 10) / 10;
  const rLon = Math.round(lon * 10) / 10;
  return `${prefix}_${rLat}_${rLon}`;
}

export async function getAllCachedForPrefix<T>(
  prefix: string,
): Promise<CacheEntry<T>[]> {
  try {
    const keys = await store.getAllKeys();
    const matchingKeys = keys.filter((k) =>
      k.startsWith(CACHE_PREFIX + prefix),
    );
    if (matchingKeys.length === 0) return [];
    const now = Date.now();
    const results: CacheEntry<T>[] = [];
    for (const k of matchingKeys) {
      try {
        const raw = await store.getItem(k);
        if (!raw) continue;
        const entry: CacheEntry<T> = JSON.parse(raw);
        if (now - entry.ts <= DATA_CACHE_MAX_AGE_MS) results.push(entry);
      } catch {}
    }
    return results;
  } catch {
    return [];
  }
}
