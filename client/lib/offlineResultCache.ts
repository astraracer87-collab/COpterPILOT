// Teil A: Speicher der letzten erfolgreichen Abrufe (Wetter, Kp, METAR/TAF,
// NOTAMs, Live-Geozonen ohne Offline-Bestand) je Standort mit Abrufzeit.
//
// - Schlüssel: Art + Standort (gerundet auf 0,05°, offlineLocationKey) bzw.
//   fester Schlüssel (Kp ist global).
// - Größenbegrenzt und LRU: je Art höchstens `maxEntries` Einträge und
//   `maxBytes` Zeichen JSON; der am längsten nicht benutzte fliegt zuerst.
// - Bewertet wird NICHT hier, sondern in shared/offlineDataPolicy.ts
//   (assessOfflineData): der Speicher liefert jeden Eintrag mit fetchedAt.
//
// RN-frei: liegt im Datei-Cache (fileCache.ts); Tests ersetzen den Speicher.

import { fileCacheStorage } from "./fileCache";
import { OFFLINE_DATA_MAX_AGE_MS, type OfflineOrigin } from "../../shared/offlineDataPolicy";

export type OfflineCacheKind =
  | "weather"
  | "forecast"
  | "hourly"
  | "kp"
  | "kp-timeline"
  | "notams"
  | "metar"
  | "airport"
  | "geozones-live";

interface Limits {
  maxEntries: number;
  maxBytes: number;
}

const LIMITS: Record<OfflineCacheKind, Limits> = {
  weather: { maxEntries: 20, maxBytes: 600_000 },
  forecast: { maxEntries: 30, maxBytes: 200_000 },
  hourly: { maxEntries: 20, maxBytes: 400_000 },
  kp: { maxEntries: 1, maxBytes: 10_000 },
  "kp-timeline": { maxEntries: 1, maxBytes: 50_000 },
  notams: { maxEntries: 20, maxBytes: 800_000 },
  metar: { maxEntries: 20, maxBytes: 100_000 },
  airport: { maxEntries: 30, maxBytes: 150_000 },
  "geozones-live": { maxEntries: 10, maxBytes: 1_500_000 },
};

export interface OfflineCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const OFFLINE_RESULT_PREFIX = "odc1:";
export const OFFLINE_RESULT_INDEX_KEY = "odc1_index";
const PREFIX = OFFLINE_RESULT_PREFIX;
const INDEX_KEY = OFFLINE_RESULT_INDEX_KEY;

interface IndexEntry {
  kind: OfflineCacheKind;
  bytes: number;
  lastUsed: number;
  fetchedAt: number;
}

interface StoredEntry<T> {
  data: T;
  fetchedAt: number;
}

let storageOverride: OfflineCacheStorage | null | undefined;
let lazyStorage: OfflineCacheStorage | null | undefined;

function getStorage(): OfflineCacheStorage | null {
  if (storageOverride !== undefined) return storageOverride;
  if (lazyStorage !== undefined) return lazyStorage;
  // Datei-Cache statt AsyncStorage: bis zu einige MB an Wetter/NOTAM/Geozonen-
  // Ständen haben die SQLite-DB von AsyncStorage gefüllt (siehe fileCache.ts).
  lazyStorage = fileCacheStorage;
  return lazyStorage;
}

// Speicher-Spiegel (schnelle Folgezugriffe, ohne Storage nutzbar)
const memory = new Map<string, StoredEntry<unknown>>();
let index: Record<string, IndexEntry> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

async function loadIndex(): Promise<Record<string, IndexEntry>> {
  if (index) return index;
  const st = getStorage();
  try {
    const raw = st ? await st.getItem(INDEX_KEY) : null;
    index = raw ? (JSON.parse(raw) as Record<string, IndexEntry>) : {};
  } catch {
    index = {};
  }
  return index;
}

async function saveIndex(): Promise<void> {
  const st = getStorage();
  if (!st || !index) return;
  try {
    await st.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {}
}

function storageKey(kind: OfflineCacheKind, key: string): string {
  return `${PREFIX}${kind}:${key}`;
}

async function evict(kind: OfflineCacheKind): Promise<void> {
  const idx = await loadIndex();
  const lim = LIMITS[kind];
  const own = Object.entries(idx)
    .filter(([, e]) => e.kind === kind)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  let total = own.reduce((s, [, e]) => s + e.bytes, 0);
  let count = own.length;
  const st = getStorage();
  for (const [k, e] of own) {
    if (count <= lim.maxEntries && total <= lim.maxBytes) break;
    delete idx[k];
    memory.delete(k);
    count -= 1;
    total -= e.bytes;
    await st?.removeItem(k).catch(() => {});
  }
}

/** Letztes erfolgreiches Ergebnis speichern. */
export function putOfflineResult<T>(kind: OfflineCacheKind, key: string, data: T, fetchedAt: number = Date.now()): Promise<void> {
  return serialize(async () => {
    const sk = storageKey(kind, key);
    const entry: StoredEntry<T> = { data, fetchedAt };
    let json: string;
    try {
      json = JSON.stringify(entry);
    } catch {
      return;
    }
    // Einzelner Eintrag größer als das Limit der Art: nicht speichern.
    if (json.length > LIMITS[kind].maxBytes) return;
    memory.set(sk, entry);
    const idx = await loadIndex();
    idx[sk] = { kind, bytes: json.length, lastUsed: Date.now(), fetchedAt };
    await getStorage()?.setItem(sk, json).catch(() => {});
    await evict(kind);
    await saveIndex();
  });
}

/** Gespeichertes Ergebnis (ohne Altersprüfung) oder null. */
export function getOfflineResult<T>(kind: OfflineCacheKind, key: string): Promise<StoredEntry<T> | null> {
  return serialize(async () => {
    const sk = storageKey(kind, key);
    let entry = (memory.get(sk) as StoredEntry<T> | undefined) ?? null;
    if (!entry) {
      try {
        const raw = await getStorage()?.getItem(sk);
        entry = raw ? (JSON.parse(raw) as StoredEntry<T>) : null;
      } catch {
        entry = null;
      }
      if (entry && (typeof entry.fetchedAt !== "number" || !("data" in entry))) entry = null;
      if (entry) memory.set(sk, entry);
    }
    if (!entry) return null;
    const idx = await loadIndex();
    if (idx[sk]) {
      idx[sk].lastUsed = Date.now();
      await saveIndex();
    }
    return entry;
  });
}

/**
 * Gespeicherte Ergebnisse einer Art entfernen, deren Schlüssel `match` erfüllt
 * (Länder-Nutzung „aus“: Live-Geozonen eines Landes). Liefert die Anzahl.
 */
export function removeOfflineResults(kind: OfflineCacheKind, match: (key: string) => boolean): Promise<number> {
  return serialize(async () => {
    const idx = await loadIndex();
    const prefix = storageKey(kind, "");
    const st = getStorage();
    let n = 0;
    for (const [sk, e] of Object.entries(idx)) {
      if (e.kind !== kind || !sk.startsWith(prefix) || !match(sk.slice(prefix.length))) continue;
      delete idx[sk];
      memory.delete(sk);
      await st?.removeItem(sk).catch(() => {});
      n += 1;
    }
    for (const sk of [...memory.keys()]) {
      if (sk.startsWith(prefix) && match(sk.slice(prefix.length))) memory.delete(sk);
    }
    if (n > 0) await saveIndex();
    return n;
  });
}

/** Schlüssel aller gespeicherten Ergebnisse einer Art. */
export function listOfflineResultKeys(kind: OfflineCacheKind): Promise<string[]> {
  return serialize(async () => {
    const idx = await loadIndex();
    const prefix = storageKey(kind, "");
    return Object.entries(idx)
      .filter(([sk, e]) => e.kind === kind && sk.startsWith(prefix))
      .map(([sk]) => sk.slice(prefix.length));
  });
}

function defaultOffline(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return !!require("./network").isOfflineNow();
  } catch {
    return false;
  }
}

export interface CachedFetchResult<T> extends OfflineOrigin {
  data: T;
}

export interface CachedFetchOptions<T> {
  isOffline?: () => boolean;
  now?: () => number;
  /** Ergebnis speichern? (z. B. nur nicht-leere Vorhersagen) */
  accept?: (data: T) => boolean;
  /** Gespeicherte Daten älter als das nicht liefern (Standard 24 h). */
  maxAgeMs?: number;
  /**
   * Höchstens so lange (ms) auf den Live-Abruf warten, wenn ein gespeicherter
   * Stand vorliegt; danach wird dieser geliefert (cached: true), der Live-Abruf
   * läuft im Hintergrund weiter und aktualisiert den Speicher. Ohne
   * gespeicherten Stand wird weiter auf den Live-Abruf gewartet.
   * Standard OFFLINE_LIVE_CAP_MS; 0 = ohne Deckel.
   */
  liveCapMs?: number;
}

/**
 * Hängender Link (RC Pro 2, Funkloch mit „verbunden“-Status): nach dieser Zeit
 * lieber den gespeicherten Stand zeigen als weiter auf das Netz zu warten.
 */
export const OFFLINE_LIVE_CAP_MS = 15000;

/**
 * Online: abrufen und das Ergebnis speichern. Offline bzw. bei Fehler: den
 * gespeicherten Stand liefern (cached: true), sofern jünger als maxAgeMs;
 * sonst den ursprünglichen Fehler werfen (bzw. „offline“).
 */
export async function fetchWithOfflineCache<T>(
  kind: OfflineCacheKind,
  key: string,
  fetcher: () => Promise<T>,
  opts: CachedFetchOptions<T> = {},
): Promise<CachedFetchResult<T>> {
  const now = opts.now ?? (() => Date.now());
  const offline = (opts.isOffline ?? defaultOffline)();
  let error: unknown = new Error("Gerät offline");
  const maxAge = opts.maxAgeMs ?? OFFLINE_DATA_MAX_AGE_MS;
  const readStored = async (): Promise<CachedFetchResult<T> | null> => {
    const stored = await getOfflineResult<T>(kind, key);
    if (stored && now() - stored.fetchedAt < maxAge) {
      return { data: stored.data, fetchedAt: stored.fetchedAt, cached: true };
    }
    return null;
  };
  if (!offline) {
    const live = (async (): Promise<CachedFetchResult<T>> => {
      const data = await fetcher();
      const at = now();
      if (!opts.accept || opts.accept(data)) await putOfflineResult(kind, key, data, at).catch(() => {});
      return { data, fetchedAt: at, cached: false };
    })();
    const cap = opts.liveCapMs ?? OFFLINE_LIVE_CAP_MS;
    try {
      return cap > 0 && Number.isFinite(cap) ? await raceLiveWithStored(live, cap, readStored) : await live;
    } catch (e) {
      error = e;
    }
  }
  const stored = await readStored();
  if (stored) return stored;
  throw error;
}

/**
 * Wartet auf `live`; ist es nach `capMs` noch offen und liefert `readStored`
 * einen Stand, gewinnt dieser. Sonst wird weiter auf `live` gewartet.
 */
function raceLiveWithStored<T>(
  live: Promise<CachedFetchResult<T>>,
  capMs: number,
  readStored: () => Promise<CachedFetchResult<T> | null>,
): Promise<CachedFetchResult<T>> {
  return new Promise<CachedFetchResult<T>>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      readStored().then(
        (stored) => {
          if (done || !stored) return;
          done = true;
          // Späte Live-Ablehnung nicht als „unhandled rejection“ melden.
          live.catch(() => {});
          resolve(stored);
        },
        () => undefined,
      );
    }, capMs);
    live.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Nur für Tests: Speicher ersetzen (null = keiner, undefined = Standard) und leeren. */
export function __setOfflineCacheStorageForTests(st: OfflineCacheStorage | null | undefined): void {
  storageOverride = st;
  memory.clear();
  index = null;
  chain = Promise.resolve();
}

/** Nur für Tests: Anzahl Einträge je Art im Index. */
export async function __offlineCacheCountForTests(kind: OfflineCacheKind): Promise<number> {
  const idx = await loadIndex();
  return Object.values(idx).filter((e) => e.kind === kind).length;
}
