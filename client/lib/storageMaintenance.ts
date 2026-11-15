// AsyncStorage-Pflege: Caches raus, Nutzerdaten sicher schreiben.
//
// Hintergrund (Gerätefehler „Session konnte nicht erstellt werden.“):
// AsyncStorage ist auf Android SQLite mit Größenlimit. Große, re-fetchbare
// Caches (ganze dipul-WFS-Layer, dataCache, Offline-Ergebnisse) haben die DB
// gefüllt – danach scheitert jedes setItem, auch für Flug-Sessions.
//
// - migrateCachesToFiles: verschiebt die bekannten Cache-Schlüssel einmalig
//   (idempotent, läuft bei jedem Start) in den Datei-Cache. Ist ein Wert nicht
//   lesbar (zu groß fürs CursorWindow), wird er nur entfernt – es ist ein Cache.
// - setItemResilient: Nutzerdaten schreiben; scheitert das wegen vollem
//   Speicher, werden die Cache-Schlüssel geleert und EINMAL erneut versucht.
//
// NUTZERDATEN-SCHLÜSSEL WERDEN HIER NIE ENTFERNT (isUserDataKey schützt sie
// zusätzlich zur Präfix-Liste).
//
// RN-frei: Speicher und Datei-Cache werden übergeben (unter tsx testbar).

export interface KvStore {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CacheTarget {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Schlüssel(-präfixe) re-fetchbarer Caches, die in den Datei-Cache umziehen. */
export const MOVED_CACHE_PREFIXES: readonly string[] = [
  "dipul_wfs_layer_v1:", // ganze dipul-WFS-Layer (mehrere MB)
  "dc_", // dataCache: dipul_all, dipul_nearby_*, dipul_restrictions, lu_*, radar_alerts_v3_*
  "odc1:", // offlineResultCache: Wetter, Vorhersage, NOTAMs, METAR, Live-Geozonen
  "odc1_index",
];

/** Veraltete Caches früherer Versionen: nur entfernen. */
export const OBSOLETE_CACHE_KEYS: readonly string[] = [
  "@easa/rules_v1", // ~1,4 MB, Server-Zeit
];

/**
 * Spiegel von Server-Antworten (nur mit Konto genutzt; die App ist lokal,
 * isLoggedInSync() ist immer false). Werden NICHT migriert, aber bei vollem
 * Speicher geleert – sie sind per Definition vom Server wiederherstellbar.
 */
export const SERVER_SNAPSHOT_PREFIX = "@preflight/snap/";

/**
 * Nutzerdaten (dürfen NIE gelöscht werden). Exakte Schlüssel bzw. Präfixe.
 * Dient als zusätzliche Sicherung gegen eine zu breite Cache-Liste.
 */
export const USER_DATA_KEYS: readonly string[] = [
  "@preflight/flight_sessions",
  "@preflight/logbook",
  "@preflight/drones",
  "@preflight/selected_drone",
  "@preflight/pilot_profile",
  "@preflight/settings",
  "@preflight/briefings",
  "@preflight/drone_history",
  "@preflight/write_queue_v1",
  "@preflight/offline_packs_index",
  "@preflight/legal_consent_version",
  "@preflight/disclaimer_accepted",
  "@preflight/geozone_categories",
  "@preflight/map_style",
  "@preflight/radar_settings",
  "@preflight/radar_settings_version",
  "@copterpilot/offline_countries",
  "@copterpilot/offline_tile_levels",
  "@copterpilot/country_usage_v1",
  "@reminders/session_notif_map",
  "@expiry/scheduled_notif_ids",
];
/**
 * Ganze Namensräume, die Nutzerdaten/Einstellungen enthalten (alles außer den
 * Server-Spiegeln unter SERVER_SNAPSHOT_PREFIX). Neue Schlüssel in diesen
 * Namensräumen sind damit automatisch geschützt.
 */
export const USER_DATA_PREFIXES: readonly string[] = [
  "@preflight/", // Sessions, Logbuch, Drohnen, Profil, Settings, Glossar, Links …
  "@copterpilot/",
  "@reminders/",
  "@expiry/",
  "@setupGuide/",
  "@auth/",
];

export function isUserDataKey(key: string): boolean {
  if (USER_DATA_KEYS.includes(key)) return true;
  if (key.startsWith(SERVER_SNAPSHOT_PREFIX)) return false;
  return USER_DATA_PREFIXES.some((p) => key.startsWith(p));
}

export function isMovedCacheKey(key: string): boolean {
  if (isUserDataKey(key)) return false;
  return MOVED_CACHE_PREFIXES.some((p) => key === p || key.startsWith(p));
}

/** Darf bei Speichermangel aus AsyncStorage entfernt werden? */
export function isPurgeableCacheKey(key: string): boolean {
  if (isUserDataKey(key)) return false;
  return (
    isMovedCacheKey(key) ||
    OBSOLETE_CACHE_KEYS.includes(key) ||
    key.startsWith(SERVER_SNAPSHOT_PREFIX)
  );
}

export interface MigrationResult {
  moved: string[];
  dropped: string[];
}

/**
 * Cache-Schlüssel aus AsyncStorage in den Datei-Cache verschieben und aus
 * AsyncStorage entfernen. Ein schon vorhandener Datei-Eintrag (neuer) wird
 * nicht überschrieben. Wirft nie.
 */
export async function migrateCachesToFiles(
  kv: KvStore,
  files: CacheTarget,
): Promise<MigrationResult> {
  const result: MigrationResult = { moved: [], dropped: [] };
  let keys: readonly string[] = [];
  try {
    keys = await kv.getAllKeys();
  } catch {
    return result;
  }
  for (const key of keys) {
    if (isUserDataKey(key)) continue;
    if (OBSOLETE_CACHE_KEYS.includes(key)) {
      await kv.removeItem(key).catch(() => {});
      result.dropped.push(key);
      continue;
    }
    if (!isMovedCacheKey(key)) continue;
    let value: string | null = null;
    try {
      value = await kv.getItem(key);
    } catch {
      value = null; // zu groß fürs CursorWindow o. Ä. – Cache, also verwerfen
    }
    let moved = false;
    if (value != null) {
      try {
        const existing = await files.getItem(key).catch(() => null);
        if (existing == null) await files.setItem(key, value);
        moved = true;
      } catch {
        moved = false;
      }
    }
    try {
      await kv.removeItem(key);
    } catch {
      continue;
    }
    (moved ? result.moved : result.dropped).push(key);
  }
  return result;
}

/** Entfernt alle Cache-Schlüssel aus AsyncStorage (nie Nutzerdaten). Liefert die Anzahl. */
export async function purgeAsyncStorageCaches(kv: KvStore): Promise<number> {
  let keys: readonly string[] = [];
  try {
    keys = await kv.getAllKeys();
  } catch {
    return 0;
  }
  let n = 0;
  for (const key of keys) {
    if (!isPurgeableCacheKey(key)) continue;
    try {
      await kv.removeItem(key);
      n++;
    } catch {
      // weiter
    }
  }
  return n;
}

/** Fehler „Speicher/Datenbank voll“ (SQLite, Dateisystem, Web-Quota)? */
export function isStorageFullError(err: unknown): boolean {
  const msg = String(
    (err as { message?: unknown } | null)?.message ?? err ?? "",
  );
  return /SQLITE_FULL|database or disk is full|disk is full|database is full|code 13\b|no space left|ENOSPC|quota|storage.{0,20}full|full.{0,20}storage/i.test(
    msg,
  );
}

export class StorageFullError extends Error {
  constructor(key: string, cause: unknown) {
    super(
      `Gerätespeicher voll – „${key}“ konnte nicht gespeichert werden (${String(
        (cause as { message?: unknown } | null)?.message ?? cause,
      )}). Bitte Speicher freigeben (z. B. Offline-Karten unter „Meine Daten“).`,
    );
    this.name = "StorageFullError";
  }
}

/**
 * setItem für Nutzerdaten: bei „Speicher voll“ erst Caches leeren (purge),
 * dann genau einmal erneut versuchen. Andere Fehler werden unverändert
 * weitergegeben.
 */
export async function setItemResilient(
  kv: Pick<KvStore, "setItem">,
  key: string,
  value: string,
  purge: () => Promise<unknown>,
): Promise<void> {
  try {
    await kv.setItem(key, value);
    return;
  } catch (err) {
    if (!isStorageFullError(err)) throw err;
    console.warn(
      `[storage] Speicher voll beim Schreiben von ${key} – leere Caches und versuche erneut.`,
    );
    try {
      await purge();
    } catch {
      // Purge ist best-effort
    }
    try {
      await kv.setItem(key, value);
    } catch (err2) {
      throw new StorageFullError(key, err2);
    }
  }
}
