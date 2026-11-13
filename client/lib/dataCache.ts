import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIX = "dc_";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  ts: number;
  key: string;
}

export async function getCached<T>(cacheKey: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > MAX_AGE_MS) {
      AsyncStorage.removeItem(CACHE_PREFIX + cacheKey).catch(() => {});
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function setCache<T>(cacheKey: string, data: T, locationKey?: string): Promise<void> {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now(), key: locationKey || cacheKey };
    await AsyncStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(entry));
  } catch {}
}

export function makeCacheKey(prefix: string, lat?: number | null, lon?: number | null): string {
  if (lat == null || lon == null) return prefix;
  const rLat = Math.round(lat * 10) / 10;
  const rLon = Math.round(lon * 10) / 10;
  return `${prefix}_${rLat}_${rLon}`;
}

export async function getAllCachedForPrefix<T>(prefix: string): Promise<CacheEntry<T>[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const matchingKeys = keys.filter((k) => k.startsWith(CACHE_PREFIX + prefix));
    if (matchingKeys.length === 0) return [];
    const pairs = await AsyncStorage.multiGet(matchingKeys);
    const now = Date.now();
    const results: CacheEntry<T>[] = [];
    for (const [, raw] of pairs) {
      if (!raw) continue;
      try {
        const entry: CacheEntry<T> = JSON.parse(raw);
        if (now - entry.ts <= MAX_AGE_MS) results.push(entry);
      } catch {}
    }
    return results;
  } catch {
    return [];
  }
}
