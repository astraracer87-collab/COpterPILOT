// Geräte-Cache der ED-269-Vektor-Geozonen (Registry: offline "ed269-store"/"import") – ersetzt den früheren
// serverseitigen Datensatz-Cache (server/datasetCache.ts + Tagesabgleich).
//
// - Pro Land eine JSON-Datei im Dokumentenverzeichnis (expo-file-system/legacy),
//   damit die Zonen nach dem ersten Laden auch OFFLINE verfügbar sind.
// - In-Memory-Cache für schnelle Folgeabfragen (Karte fragt bei jedem Pan ab).
// - Aktualisierung nach REFRESH_AFTER_MS im Hintergrund (stale-while-revalidate):
//   ein vorhandener, älterer Bestand wird sofort geliefert und parallel erneuert.
//   Schlägt die Aktualisierung fehl, bleibt der alte Bestand unverändert.
// - Gleichzeitige Downloads desselben Landes werden zusammengeführt.
//
// expo-file-system wird LAZY per require geladen, damit dieses Modul (und
// geozoneCoverage.ts) unter tsx/Node ohne nativen Modulgraphen testbar bleibt –
// dort läuft der Cache dann rein im Speicher.
import {
  ED269_BUNDLED_FALLBACKS,
  fetchEd269CountryFeatures,
  isEd269DirectCountry,
  roundFeatureCoords,
  type GeoFeature,
} from "./ed269Sources";
import { finalizeDirectFeatures } from "./directFetchUtil";
import { GEOZONE_IMPORT_ONLY_ISOS } from "../../../shared/geozoneImport";
import {
  ED269_STORE_REFRESH_MS,
  geozoneRefreshPolicy,
  getGeozoneSourceMeta,
  resolveGeozoneSourceIso,
} from "../../../shared/geozoneSourceMeta";
import { setCountryAccessAvailable } from "../../../shared/countryDetection";
import { awaitCountryUsage, isGeozoneSourceEnabled } from "../countryUsage";
import { trackDownload } from "../downloadActivity";

// Upstream-Daten ändern sich selten; der Server hat täglich synchronisiert.

// Datei-Import (Einstellungen → Offline-Karten → „Geozonen-Datei importieren“):
// - importEd269Dataset() legt den Bestand genauso ab wie einen Download (Karte,
//   Zonencheck und Offline-Nutzung funktionieren identisch), mit `imported`.
// - Eine fehlgeschlagene automatische Aktualisierung lässt den Import stehen;
//   eine ERFOLGREICHE Online-Aktualisierung ersetzt ihn (aktuellere amtliche Daten).
// - Länder ohne erreichbaren Feed (GEOZONE_IMPORT_ONLY_ISOS: MT, GR) werden
//   nie aus dem Netz geladen; sie gelten erst mit Import als „eigene Daten“
//   (setCountryAccessAvailable → hasOwnMap).
function isImportOnly(iso: string): boolean {
  return GEOZONE_IMPORT_ONLY_ISOS.includes(String(iso || "").toUpperCase());
}

function isStoreCountry(iso: string): boolean {
  return isEd269DirectCountry(iso) || isImportOnly(iso);
}

// Aliase aus der Registry (Liechtenstein steckt im Schweizer BAZL-Datensatz).
function cacheKey(iso: string | null | undefined): string {
  return resolveGeozoneSourceIso(iso).toLowerCase();
}

type DownloadHook = (iso: string, features: GeoFeature[]) => unknown;
const downloadHooks = new Set<DownloadHook>();
/** Wird nach jedem erfolgreichen Länder-Download aufgerufen. */
export function onEd269Downloaded(hook: DownloadHook): () => void {
  downloadHooks.add(hook);
  return () => downloadHooks.delete(hook);
}

// Aktualisierungsintervall laut Registry-Policy (maxAgeMs, je Land; Standard 6 h, Teil A).
export const ED269_REFRESH_AFTER_MS = ED269_STORE_REFRESH_MS;
// Nach einem fehlgeschlagenen Download nicht bei jedem Karten-Pan erneut
// versuchen (offline!), sondern frühestens nach dieser Pause.
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
// Bei Änderungen der Normalisierung erhöhen -> gespeicherte Dateien werden
// beim nächsten Online-Zugriff neu aufgebaut (bis dahin weiter genutzt).
const STORE_FORMAT_VERSION = 1;

export type Ed269Dataset = {
  iso: string; // lowercase
  fetchedAt: number;
  version: number;
  features: GeoFeature[];
  /** Gesetzt, wenn der Bestand aus einem Datei-Import stammt. */
  imported?: Ed269ImportMeta;
};

export type Ed269ImportMeta = { source: string; importedAt: number; fileName: string };

type FsModule = {
  documentDirectory: string | null;
  getInfoAsync(path: string): Promise<{ exists: boolean }>;
  makeDirectoryAsync(path: string, opts?: { intermediates?: boolean }): Promise<void>;
  readAsStringAsync(path: string): Promise<string>;
  writeAsStringAsync(path: string, data: string): Promise<void>;
  moveAsync(opts: { from: string; to: string }): Promise<void>;
  deleteAsync(path: string, opts?: { idempotent?: boolean }): Promise<void>;
  readDirectoryAsync?(path: string): Promise<string[]>;
};

let fsCache: FsModule | null | undefined;
let fsOverride: FsModule | null | undefined;
function getFs(): FsModule | null {
  if (fsOverride !== undefined) return fsOverride;
  if (fsCache !== undefined) return fsCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-file-system/legacy") as FsModule;
    fsCache = mod && mod.documentDirectory ? mod : null;
  } catch {
    fsCache = null;
  }
  return fsCache;
}

function dirPath(fs: FsModule): string {
  return `${fs.documentDirectory}geozones-direct/`;
}

function filePath(fs: FsModule, iso: string): string {
  return `${dirPath(fs)}ed269-${iso}.json`;
}

const memory = new Map<string, Ed269Dataset>();

// Speicherschutz für die Fernsteuerung: Landesbestände sind teils groß
// (NL ≈ 23 MB JSON). Im Arbeitsspeicher bleiben höchstens so viele Länder, wie
// eine Kartenansicht gleichzeitig zeigt (getViewportCountries: max. 4) plus
// eines Reserve; das am längsten unbenutzte fliegt raus und wird bei Bedarf
// wieder von der Datei gelesen.
const MEMORY_MAX_COUNTRIES = 5;

function remember(iso: string, ds: Ed269Dataset): void {
  memory.delete(iso);
  memory.set(iso, ds);
  while (memory.size > MEMORY_MAX_COUNTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
    // beim nächsten Zugriff wieder von der Datei lesen
    diskChecked.delete(oldest);
  }
}

function recall(iso: string): Ed269Dataset | undefined {
  const ds = memory.get(iso);
  if (ds) {
    // als zuletzt benutzt markieren
    memory.delete(iso);
    remember(iso, ds);
  }
  return ds;
}
const inFlight = new Map<string, Promise<Ed269Dataset | null>>();
const lastFailureAt = new Map<string, number>();
const diskChecked = new Set<string>();

async function readFromDisk(iso: string): Promise<Ed269Dataset | null> {
  const fs = getFs();
  if (!fs) return null;
  try {
    const path = filePath(fs, iso);
    const info = await fs.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await fs.readAsStringAsync(path)) as Ed269Dataset;
    if (!parsed || !Array.isArray(parsed.features) || typeof parsed.fetchedAt !== "number") return null;
    return { ...parsed, iso };
  } catch (e) {
    console.warn(`[geozoneDirect] ${iso}: Gerätecache unlesbar:`, (e as Error)?.message || e);
    return null;
  }
}

async function writeToDisk(ds: Ed269Dataset): Promise<void> {
  const fs = getFs();
  if (!fs) return;
  try {
    const dir = dirPath(fs);
    const info = await fs.getInfoAsync(dir);
    if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
    // Erst in eine Temp-Datei schreiben und dann verschieben, damit ein
    // Abbruch mitten im Schreiben keinen kaputten Bestand hinterlässt.
    const target = filePath(fs, ds.iso);
    const tmp = `${target}.tmp`;
    await fs.writeAsStringAsync(tmp, JSON.stringify(ds));
    await fs.deleteAsync(target, { idempotent: true });
    await fs.moveAsync({ from: tmp, to: target });
  } catch (e) {
    console.warn(`[geozoneDirect] ${ds.iso}: Gerätecache nicht schreibbar:`, (e as Error)?.message || e);
  }
}

// Lädt den Bestand frisch von den Upstream-Quellen und speichert ihn.
// Liefert null bei Fehlschlag (alter Bestand bleibt dann erhalten).
function download(iso: string): Promise<Ed269Dataset | null> {
  const running = inFlight.get(iso);
  if (running) return running;
  const p = (async () => {
    try {
      // Download-Anzeige (app-weit): „Lädt: Österreich – Geozonen …“
      const features = await trackDownload(
        { id: `ed269:${iso}`, iso: iso.toUpperCase(), labelDe: "Geozonen", kind: "geozones" },
        () => fetchEd269CountryFeatures(iso),
      );
      const ds: Ed269Dataset = { iso, fetchedAt: Date.now(), version: STORE_FORMAT_VERSION, features };
      remember(iso, ds);
      lastFailureAt.delete(iso);
      await writeToDisk(ds);
      // z. B. fehlende Übersetzungen nachladen (zoneTranslationStore.ts)
      for (const hook of downloadHooks) {
        try {
          void Promise.resolve(hook(iso, features)).catch(() => {});
        } catch {}
      }
      return ds;
    } catch (e) {
      lastFailureAt.set(iso, Date.now());
      console.warn(`[geozoneDirect] ${iso}: Download fehlgeschlagen:`, (e as Error)?.message || e);
      return null;
    } finally {
      inFlight.delete(iso);
    }
  })();
  inFlight.set(iso, p);
  return p;
}

function isFresh(ds: Ed269Dataset, now: number): boolean {
  const maxAgeMs = geozoneRefreshPolicy(ds.iso)?.maxAgeMs ?? ED269_REFRESH_AFTER_MS;
  return ds.version === STORE_FORMAT_VERSION && now - ds.fetchedAt < maxAgeMs;
}

function mayRetry(iso: string, now: number): boolean {
  const failed = lastFailureAt.get(iso);
  return failed == null || now - failed > RETRY_AFTER_FAILURE_MS;
}

/**
 * Liefert den Geozonen-Bestand eines Vektor-Landes (AT/BE/DK) vom Gerät bzw.
 * lädt ihn bei Bedarf. Nicht unterstützte Länder -> null.
 *
 * - `forceRefresh`: Download erzwingen und abwarten (z. B. Offline-Paket);
 *   bei Fehlschlag wird der vorhandene Bestand geliefert.
 */
export async function getEd269Dataset(
  rawIso: string,
  opts?: { forceRefresh?: boolean },
): Promise<Ed269Dataset | null> {
  const iso = cacheKey(rawIso);
  if (!isStoreCountry(iso)) return null;
  // Länder-Nutzung „aus“: weder Abruf noch Nutzung gespeicherter Daten (ein
  // Datei-Import bleibt auf dem Gerät und gilt wieder, sobald das Land aktiv ist).
  await awaitCountryUsage();
  if (!isGeozoneSourceEnabled(rawIso)) return null;
  const now = Date.now();

  let ds = recall(iso) ?? null;
  if (!ds && !diskChecked.has(iso)) {
    diskChecked.add(iso);
    ds = await readFromDisk(iso);
    if (ds) {
      // Ein zwischenzeitlich abgeschlossener Download hat Vorrang.
      const newer = memory.get(iso);
      if (!newer || newer.fetchedAt < ds.fetchedAt) remember(iso, ds);
      else ds = newer;
    }
  }

  // Nur-Import-Länder: nie aus dem Netz laden.
  if (isImportOnly(iso)) return ds;

  if (opts?.forceRefresh) {
    const fresh = await download(iso);
    return fresh ?? ds ?? fallbackDataset(iso);
  }

  if (ds) {
    if (!isFresh(ds, now) && mayRetry(iso, now)) {
      // Hintergrund-Aktualisierung; Fehler werden in download() geschluckt.
      void download(iso);
    }
    return ds;
  }

  // Gebündelte Basisdaten (BE) sofort liefern, Download im Hintergrund.
  if (getGeozoneSourceMeta(iso)?.bundledFallback) {
    const bundled = fallbackDataset(iso);
    if (bundled) {
      if (mayRetry(iso, now)) void download(iso);
      return bundled;
    }
  }

  // Noch gar kein Bestand: Download abwarten (erstmaliger Start).
  const fresh = mayRetry(iso, now) ? await download(iso) : null;
  return fresh ?? fallbackDataset(iso);
}

// Rückfall ohne Netz und ohne Gerätebestand: gebündelte Basisdaten (Registry-
// Flag bundledFallback, BE; wird nicht gespeichert, damit ein späterer Download greift).
function fallbackDataset(iso: string): Ed269Dataset | null {
  const bundled = getGeozoneSourceMeta(iso)?.bundledFallback ? ED269_BUNDLED_FALLBACKS[resolveGeozoneSourceIso(iso)] : undefined;
  if (!bundled) return null;
  const features = bundled();
  if (features.length === 0) return null;
  const ds: Ed269Dataset = { iso, fetchedAt: 0, version: STORE_FORMAT_VERSION, features };
  // Im Speicher halten (fetchedAt 0 => gilt als veraltet, Refresh folgt).
  remember(iso, ds);
  return ds;
}

/** Erzwingt eine Aktualisierung (wartet darauf). true = erfolgreich geladen. */
export async function refreshEd269Dataset(iso: string): Promise<boolean> {
  const c = cacheKey(iso);
  if (!isEd269DirectCountry(c)) return false;
  await awaitCountryUsage();
  if (!isGeozoneSourceEnabled(iso)) return false;
  return (await download(c)) != null;
}

/** Stand des Gerätecaches (für Status-/Debug-Anzeigen). */
export function getEd269DatasetStatus(iso: string): { fetchedAt: number | null; count: number; imported?: Ed269ImportMeta } {
  const ds = recall(cacheKey(iso));
  return {
    fetchedAt: ds && ds.fetchedAt > 0 ? ds.fetchedAt : null,
    count: ds?.features.length ?? 0,
    ...(ds?.imported ? { imported: ds.imported } : {}),
  };
}

/** Kann für dieses Land eine Geozonen-Datei importiert werden? */
export function canImportEd269Dataset(iso: string): boolean {
  return isStoreCountry(cacheKey(iso));
}

/** Gespeicherten Bestand lesen (Speicher/Datei), OHNE Netzzugriff. */
export async function loadStoredEd269Dataset(rawIso: string): Promise<Ed269Dataset | null> {
  const iso = cacheKey(rawIso);
  if (!isStoreCountry(iso)) return null;
  const mem = recall(iso);
  if (mem) return mem;
  const ds = await readFromDisk(iso);
  diskChecked.add(iso);
  if (ds) remember(iso, ds);
  return ds;
}

/**
 * Importierte Geozonen (bereits in App-Feature-Form, siehe
 * shared/geozoneImport.ts) als Landesbestand speichern – ersetzt einen
 * vorhandenen Bestand. bbox, Koordinaten-Rundung und `_country` wie beim
 * Download.
 */
export async function importEd269Dataset(
  rawIso: string,
  features: GeoFeature[],
  meta: Ed269ImportMeta,
): Promise<Ed269Dataset> {
  const iso = cacheKey(rawIso);
  if (!isStoreCountry(iso)) throw new Error(`Für ${String(rawIso).toUpperCase()} ist kein Geozonen-Import vorgesehen.`);
  const finalized = roundFeatureCoords(finalizeDirectFeatures(features, iso));
  if (finalized.length === 0) throw new Error("Keine Geozonen zum Speichern.");
  const ds: Ed269Dataset = { iso, fetchedAt: meta.importedAt, version: STORE_FORMAT_VERSION, features: finalized, imported: meta };
  remember(iso, ds);
  diskChecked.add(iso);
  lastFailureAt.delete(iso);
  await writeToDisk(ds);
  if (isImportOnly(iso)) setCountryAccessAvailable(iso, true);
  for (const hook of downloadHooks) {
    try {
      void Promise.resolve(hook(iso, finalized)).catch(() => {});
    } catch {}
  }
  return ds;
}

/** Gespeicherten Bestand eines Landes entfernen (z. B. Import löschen). */
export async function deleteEd269Dataset(rawIso: string): Promise<void> {
  const iso = cacheKey(rawIso);
  memory.delete(iso);
  diskChecked.delete(iso);
  const fs = getFs();
  if (fs) await fs.deleteAsync(filePath(fs, iso), { idempotent: true }).catch(() => {});
  if (isImportOnly(iso)) setCountryAccessAvailable(iso, false);
}

/**
 * Länder-Nutzung: herunterladbaren Bestand löschen, einen Datei-Import aber
 * behalten (lässt sich nicht erneut herunterladen; nur „Import entfernen“
 * löscht ihn). Liefert, ob ein Import erhalten blieb.
 */
export async function deleteDownloadedEd269Dataset(rawIso: string): Promise<{ keptImport: boolean }> {
  const ds = await loadStoredEd269Dataset(rawIso).catch(() => null);
  if (ds?.imported) return { keptImport: true };
  await deleteEd269Dataset(rawIso);
  return { keptImport: false };
}

/** Datensatz-ISOs (Großbuchstaben) mit gespeicherter Datei – ohne sie zu lesen. */
export async function listStoredEd269Isos(): Promise<string[]> {
  const fs = getFs();
  const out = new Set<string>();
  for (const k of memory.keys()) {
    const ds = memory.get(k);
    if (ds && ds.fetchedAt > 0) out.add(k.toUpperCase());
  }
  if (fs?.readDirectoryAsync) {
    try {
      const names = await fs.readDirectoryAsync(dirPath(fs));
      for (const n of names) {
        const m = /^ed269-([a-z]{2})\.json$/.exec(n);
        if (m) out.add(m[1].toUpperCase());
      }
    } catch {}
  }
  return [...out];
}

/**
 * Stand eines gespeicherten Bestands OHNE die Datei zu lesen: aus dem Speicher
 * bzw. aus der Änderungszeit der Datei (imported dann null = unbekannt).
 */
export async function storedEd269Info(rawIso: string): Promise<{ fetchedAt: number; imported: boolean | null } | null> {
  const iso = cacheKey(rawIso);
  const mem = memory.get(iso);
  if (mem && mem.fetchedAt > 0) return { fetchedAt: mem.fetchedAt, imported: !!mem.imported };
  const fs = getFs();
  if (!fs) return null;
  try {
    const info = (await fs.getInfoAsync(filePath(fs, iso))) as { exists: boolean; modificationTime?: number };
    if (!info.exists) return null;
    return { fetchedAt: (info.modificationTime ?? 0) * 1000, imported: null };
  } catch {
    return null;
  }
}

/** Dateigröße des gespeicherten Bestands in Bytes (0 = keiner). */
export async function storedEd269Bytes(rawIso: string): Promise<number> {
  const fs = getFs();
  if (!fs) return 0;
  try {
    const info = (await fs.getInfoAsync(filePath(fs, cacheKey(rawIso)))) as { exists: boolean; size?: number };
    return info.exists ? info.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

/** Beim App-Start: Nur-Import-Länder mit gespeichertem Bestand als „eigene Daten“ markieren. */
export async function initEd269ImportFlags(): Promise<void> {
  for (const iso of GEOZONE_IMPORT_ONLY_ISOS) {
    try {
      setCountryAccessAvailable(iso, !!(await loadStoredEd269Dataset(iso)));
    } catch {
      setCountryAccessAvailable(iso, false);
    }
  }
}

/** Nur für Tests: Dateisystem ersetzen (undefined = Standard, null = keins). */
export function __setEd269FsForTests(fs: FsModule | null | undefined): void {
  fsOverride = fs;
}

/** Nur für Tests: Speicher-Cache leeren. */
export function __resetEd269StoreForTests(): void {
  memory.clear();
  inFlight.clear();
  lastFailureAt.clear();
  diskChecked.clear();
}
