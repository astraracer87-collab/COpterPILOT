// Datei-basierter Schlüssel/Wert-Speicher für re-fetchbare CACHES (dipul-WFS-
// Layer, dataCache „dc_*“, Offline-Ergebnisse „odc1:*“ …). Ein Eintrag = eine
// Datei unter documentDirectory/kv-cache/, atomar geschrieben (tmp → move).
//
// Warum nicht AsyncStorage: auf Android ist das eine SQLite-DB mit Größen-
// grenze. Läuft sie mit Caches voll, scheitert JEDES setItem – auch das
// Speichern von Flug-Sessions („Session konnte nicht erstellt werden“).
//
// Nutzerdaten gehören NICHT hierher: dieser Speicher darf jederzeit geleert
// werden (purgeFileCache), etwa wenn der Speicher knapp wird.
//
// Ohne Dateisystem (Web) dient eine In-Memory-Map als Rückfall.

import {
  decodeFileKey,
  encodeFileKey,
  getSimpleFs,
  writeTextAtomic,
  type SimpleFs,
} from "./fileStoreFs";

export const FILE_CACHE_DIR_NAME = "kv-cache";
const EXT = ".json";

const memoryFallback = new Map<string, string>();
// Schreib-/Löschvorgänge je Schlüssel der Reihe nach (kein Überholen).
const chains = new Map<string, Promise<unknown>>();

function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  const tail = p.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return p;
}

function dir(fs: SimpleFs): string {
  return `${fs.root}${FILE_CACHE_DIR_NAME}/`;
}

function pathFor(fs: SimpleFs, key: string): string {
  return `${dir(fs)}${encodeFileKey(key)}${EXT}`;
}

function activeFs(): SimpleFs | null {
  const fs = getSimpleFs();
  return fs && fs.root ? fs : null;
}

export async function fileCacheGet(key: string): Promise<string | null> {
  const fs = activeFs();
  if (!fs) return memoryFallback.get(key) ?? null;
  // Auf laufende Schreibvorgänge desselben Schlüssels warten.
  const pending = chains.get(key);
  if (pending) await pending;
  try {
    return await fs.readText(pathFor(fs, key));
  } catch {
    return null;
  }
}

export function fileCacheSet(key: string, value: string): Promise<void> {
  return serial(key, async () => {
    const fs = activeFs();
    if (!fs) {
      memoryFallback.set(key, value);
      return;
    }
    await writeTextAtomic(fs, pathFor(fs, key), value);
  });
}

export function fileCacheRemove(key: string): Promise<void> {
  return serial(key, async () => {
    const fs = activeFs();
    if (!fs) {
      memoryFallback.delete(key);
      return;
    }
    await fs.remove(pathFor(fs, key)).catch(() => {});
  });
}

/** Alle Schlüssel (optional nur mit Präfix). */
export async function fileCacheKeys(prefix = ""): Promise<string[]> {
  const fs = activeFs();
  const all = fs
    ? (await fs.list(dir(fs)).catch(() => [] as string[]))
        .filter((n) => n.endsWith(EXT))
        .map((n) => decodeFileKey(n.slice(0, -EXT.length)))
    : [...memoryFallback.keys()];
  return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
}

/** Gesamten Datei-Cache löschen (z. B. bei Speichermangel). Wirft nie. */
export async function purgeFileCache(): Promise<void> {
  memoryFallback.clear();
  const fs = activeFs();
  if (!fs) return;
  await fs.remove(dir(fs)).catch(() => {});
}

/**
 * Einträge mit Präfix entfernen, deren Datei älter als maxAgeMs ist (nach
 * Änderungszeit; ohne bekannte Zeit bleibt der Eintrag). Liefert die Anzahl.
 */
export async function pruneFileCache(
  prefix: string,
  maxAgeMs: number,
  now = Date.now(),
): Promise<number> {
  const fs = activeFs();
  if (!fs) return 0;
  let n = 0;
  for (const key of await fileCacheKeys(prefix)) {
    try {
      const info = await fs.info(pathFor(fs, key));
      if (
        info.exists &&
        typeof info.mtimeMs === "number" &&
        now - info.mtimeMs > maxAgeMs
      ) {
        await fileCacheRemove(key);
        n++;
      }
    } catch {
      // einzelner Eintrag – egal
    }
  }
  return n;
}

/**
 * AsyncStorage-förmige Sicht auf den Datei-Cache, damit bestehender Code
 * (getItem/setItem/removeItem/getAllKeys) nur den Speicher tauschen muss.
 */
export const fileCacheStorage = {
  getItem: fileCacheGet,
  setItem: fileCacheSet,
  removeItem: fileCacheRemove,
  getAllKeys: () => fileCacheKeys(),
};

/** Nur für Tests: In-Memory-Rückfall und Warteschlangen leeren. */
export function __resetFileCacheForTests(): void {
  memoryFallback.clear();
  chains.clear();
}
