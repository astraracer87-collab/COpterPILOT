// Geräte-Cache der ED-269-Vektor-Geozonen (AT/BE/DK) – ersetzt den früheren
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
  fetchEd269CountryFeatures,
  getBelgianBundledFeatures,
  isEd269DirectCountry,
  type GeoFeature,
} from "./ed269Sources";

// Upstream-Daten ändern sich selten; der Server hat täglich synchronisiert.

// Liechtenstein steckt im Schweizer BAZL-Datensatz.
function cacheKey(iso: string | null | undefined): string {
  const c = String(iso || "").toLowerCase();
  return c === "li" ? "ch" : c;
}

type DownloadHook = (iso: string, features: GeoFeature[]) => unknown;
const downloadHooks = new Set<DownloadHook>();
/** Wird nach jedem erfolgreichen Länder-Download aufgerufen. */
export function onEd269Downloaded(hook: DownloadHook): () => void {
  downloadHooks.add(hook);
  return () => downloadHooks.delete(hook);
}

export const ED269_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
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
};

type FsModule = {
  documentDirectory: string | null;
  getInfoAsync(path: string): Promise<{ exists: boolean }>;
  makeDirectoryAsync(path: string, opts?: { intermediates?: boolean }): Promise<void>;
  readAsStringAsync(path: string): Promise<string>;
  writeAsStringAsync(path: string, data: string): Promise<void>;
  moveAsync(opts: { from: string; to: string }): Promise<void>;
  deleteAsync(path: string, opts?: { idempotent?: boolean }): Promise<void>;
};

let fsCache: FsModule | null | undefined;
function getFs(): FsModule | null {
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
      const features = await fetchEd269CountryFeatures(iso);
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
  return ds.version === STORE_FORMAT_VERSION && now - ds.fetchedAt < ED269_REFRESH_AFTER_MS;
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
  if (!isEd269DirectCountry(iso)) return null;
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

  // Belgien: gebündelte Basisdaten sofort liefern, Download im Hintergrund.
  if (iso === "be") {
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

// Rückfall ohne Netz und ohne Gerätebestand: für Belgien die gebündelten
// Basisdaten (wird nicht gespeichert, damit ein späterer Download greift).
function fallbackDataset(iso: string): Ed269Dataset | null {
  if (iso !== "be") return null;
  const features = getBelgianBundledFeatures();
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
  return (await download(c)) != null;
}

/** Stand des Gerätecaches (für Status-/Debug-Anzeigen). */
export function getEd269DatasetStatus(iso: string): { fetchedAt: number | null; count: number } {
  const ds = recall(cacheKey(iso));
  return { fetchedAt: ds && ds.fetchedAt > 0 ? ds.fetchedAt : null, count: ds?.features.length ?? 0 };
}

/** Nur für Tests: Speicher-Cache leeren. */
export function __resetEd269StoreForTests(): void {
  memory.clear();
  inFlight.clear();
  lastFailureAt.clear();
  diskChecked.clear();
}
