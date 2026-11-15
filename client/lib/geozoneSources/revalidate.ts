// Teil A: Geozonen zweigleisig aktualisieren (stale-while-revalidate).
//
// - Dauerhafte Zonen: Antwort sofort aus dem lokalen Bestand (ED-269-
//   Gerätecache bzw. Kachelspeicher); online wird im Hintergrund nachgezogen,
//   ausgelöst, wenn die Zonen gebraucht werden (Planung/Einschränkungen,
//   Pre-Check, Radar/Karte im Land) und beim Länderwechsel laut GPS (inkl.
//   Nachbarn im Umkreis) – siehe useGeozoneRevalidation.
// - Kleine ED-269-Länder: neu laden, wenn älter als maxAgeMs (6 h) – günstig.
//   Für Prüfungen (Planung/Pre-Check) gilt der kurze Cache der temporären
//   Zonen (≤ 10 min), da sie im selben Bestand stecken.
// - Große Bestände (Kachelspeicher DE/FR/CZ, NL-Feed): erst günstig auf eine
//   neue Fassung prüfen (tileStoreVersionCheck: AIRAC-Stichtag, FR-Trefferzahl,
//   CZ-Veröffentlichungsordner); laden nur im WLAN, außer der Nutzer erlaubt
//   mobile Daten. Sonst „Neue Fassung verfügbar – wird im WLAN geladen“.
// - DE: temporäre Betriebseinschränkungen online immer frisch (≤ 10 min).
// - Ereignis `onGeozoneDataChanged`: neue Daten eines Landes (ED-269-Download,
//   Kachelspeicher geändert, temporäre DE-Zonen geändert). Planung und
//   Pre-Check werten neu aus und zeigen bei geändertem Urteil einen Hinweis.
//
// RN-frei (unter tsx testbar); Netz/Speicher über eine austauschbare Umgebung.

import {
  geozoneRefreshPolicy,
  getGeozoneSourceMeta,
  isLargeGeozoneDataset,
  resolveGeozoneSourceIso,
  temporarySourceOf,
} from "../../../shared/geozoneSourceMeta";
import {
  getEd269DatasetStatus,
  loadStoredEd269Dataset,
  onEd269Downloaded,
  refreshEd269Dataset,
} from "../geozoneDirect/ed269Store";
import {
  downloadTileStore,
  getDeTempFeatures,
  getTilePartMeta,
  hasTiledGeozones,
  isOnWifi,
  onDeTempChange,
  onTileStoreChange,
  tileStoreVersionCheck,
  type TileStoreVersionCheck,
} from "../geozoneTiles/tileStore";
import { loadLargePacksOnMobile, mayDownloadLargePack } from "./largePackSetting";

export type RevalidatePurpose = "check" | "map" | "manual";

export type RevalidateAction =
  | "offline"
  | "fresh"
  | "refreshed"
  | "refresh-failed"
  | "throttled"
  | "pending-wifi"
  | "pack-current"
  | "pack-updated"
  | "no-store"
  | "import-only"
  | "unsupported";

export interface RevalidateResult {
  iso: string;
  action: RevalidateAction;
  reason?: string;
}

export interface GeozoneDataChange {
  /** Land (Datensatz-ISO); null = Kachelspeicher allgemein (DE/FR/CZ) */
  iso: string | null;
  kind: "ed269" | "tiles" | "de-temp";
}

export interface RevalidateEnv {
  now(): number;
  isOffline(): boolean;
  isWifi(): Promise<boolean>;
  largePacksOnMobile(): Promise<boolean>;
  ed269StoredAt(iso: string): Promise<number | null>;
  ed269Refresh(iso: string): Promise<boolean>;
  tilesHas(iso: string): boolean;
  tilesVersionCheck(iso: string): Promise<TileStoreVersionCheck>;
  tilesDownload(iso: string): Promise<boolean>;
  deTempRefresh(force: boolean): Promise<void>;
}

function defaultOffline(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return !!require("../network").isOfflineNow();
  } catch {
    return false;
  }
}

const defaultEnv: RevalidateEnv = {
  now: () => Date.now(),
  isOffline: defaultOffline,
  isWifi: () => isOnWifi(),
  largePacksOnMobile: () => loadLargePacksOnMobile(),
  async ed269StoredAt(iso) {
    const mem = getEd269DatasetStatus(iso).fetchedAt;
    if (mem != null) return mem;
    const ds = await loadStoredEd269Dataset(iso);
    return ds && ds.fetchedAt > 0 ? ds.fetchedAt : null;
  },
  ed269Refresh: (iso) => refreshEd269Dataset(iso),
  tilesHas: (iso) => hasTiledGeozones(iso),
  tilesVersionCheck: (iso) => tileStoreVersionCheck(iso),
  async tilesDownload(iso) {
    const res = await downloadTileStore(iso, { wohn: !!getTilePartMeta(iso, "wohn"), force: true });
    return res.length > 0 && res.every((r) => r.state === "complete");
  },
  async deTempRefresh(force) {
    await getDeTempFeatures({ force });
  },
};

let env: RevalidateEnv = defaultEnv;

/** Nur für Tests: Umgebung ersetzen (null = Standard) und Zustand leeren. */
export function __setRevalidateEnvForTests(e: Partial<RevalidateEnv> | null): void {
  env = e ? { ...defaultEnv, ...e } : defaultEnv;
  lastFailureAt.clear();
  lastVersionCheckAt.clear();
  pendingWifi.clear();
  running.clear();
}

// Nach einem Fehlschlag nicht bei jedem Auslöser erneut laden.
export const REVALIDATE_RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000;
// Versionsprüfung großer Pakete höchstens alle 30 min (außer „Jetzt aktualisieren“).
export const VERSION_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const lastFailureAt = new Map<string, number>();
const lastVersionCheckAt = new Map<string, number>();
const pendingWifi = new Set<string>();
const running = new Map<string, Promise<RevalidateResult>>();

/** Länder, deren neue Fassung auf WLAN (bzw. die Erlaubnis für mobile Daten) wartet. */
export function getPendingWifiUpdates(): string[] {
  return [...pendingWifi];
}

/**
 * Ab welchem Alter wird ein ED-269-Bestand für diesen Zweck neu geladen?
 * manual → immer; check → kurzer Cache der temporären Zonen (falls die Quelle
 * sie im Bestand führt und der Bestand nicht groß ist); sonst maxAgeMs (6 h).
 */
export function ed269RefreshThresholdMs(iso: string, purpose: RevalidatePurpose): number {
  if (purpose === "manual") return 0;
  const policy = geozoneRefreshPolicy(iso);
  const permanent = policy?.maxAgeMs ?? Number.POSITIVE_INFINITY;
  if (purpose === "check" && temporarySourceOf(iso) === "dataset" && !isLargeGeozoneDataset(iso) && policy?.temporaryMaxAgeMs != null) {
    return Math.min(permanent, policy.temporaryMaxAgeMs);
  }
  return permanent;
}

async function revalidateEd269(iso: string, purpose: RevalidatePurpose): Promise<RevalidateResult> {
  const meta = getGeozoneSourceMeta(iso);
  if (meta?.kind === "import-only") return { iso, action: "import-only" };
  const now = env.now();
  const storedAt = await env.ed269StoredAt(iso);
  const threshold = ed269RefreshThresholdMs(iso, purpose);
  if (storedAt != null && now - storedAt < threshold) return { iso, action: "fresh" };
  const failed = lastFailureAt.get(iso);
  if (purpose !== "manual" && failed != null && now - failed < REVALIDATE_RETRY_AFTER_FAILURE_MS) {
    return { iso, action: "throttled" };
  }
  // Großer Feed (NL): vorhandenen Bestand nur im WLAN erneuern. Ohne Bestand
  // wird wie bisher geladen (sonst gar keine Daten).
  if (storedAt != null && isLargeGeozoneDataset(iso)) {
    if (!mayDownloadLargePack(await env.isWifi(), await env.largePacksOnMobile())) {
      pendingWifi.add(iso);
      return { iso, action: "pending-wifi" };
    }
  }
  const ok = await env.ed269Refresh(iso).catch(() => false);
  if (ok) {
    lastFailureAt.delete(iso);
    pendingWifi.delete(iso);
    return { iso, action: "refreshed" };
  }
  lastFailureAt.set(iso, env.now());
  return { iso, action: "refresh-failed" };
}

async function revalidateTiles(iso: string, purpose: RevalidatePurpose): Promise<RevalidateResult> {
  // DE: temporäre Betriebseinschränkungen online immer frisch (≤ 10 min).
  if (iso === "DE" && env.tilesHas("DE") && purpose !== "map") {
    await env.deTempRefresh(purpose === "manual").catch(() => {});
  }
  if (!env.tilesHas(iso)) return { iso, action: "no-store" };
  const now = env.now();
  const last = lastVersionCheckAt.get(iso);
  if (purpose !== "manual" && last != null && now - last < VERSION_CHECK_INTERVAL_MS && !pendingWifi.has(iso)) {
    return { iso, action: "pack-current" };
  }
  lastVersionCheckAt.set(iso, now);
  const check = await env.tilesVersionCheck(iso).catch((): TileStoreVersionCheck => ({ due: false, reason: null }));
  if (!check.due) {
    pendingWifi.delete(iso);
    return { iso, action: "pack-current" };
  }
  if (!mayDownloadLargePack(await env.isWifi(), await env.largePacksOnMobile())) {
    pendingWifi.add(iso);
    return { iso, action: "pending-wifi", reason: check.reason ?? undefined };
  }
  const ok = await env.tilesDownload(iso).catch(() => false);
  if (ok) {
    pendingWifi.delete(iso);
    return { iso, action: "pack-updated", reason: check.reason ?? undefined };
  }
  lastFailureAt.set(iso, env.now());
  return { iso, action: "refresh-failed", reason: check.reason ?? undefined };
}

async function revalidateOne(iso: string, purpose: RevalidatePurpose): Promise<RevalidateResult> {
  const meta = getGeozoneSourceMeta(iso);
  if (!meta || !meta.refresh) return { iso, action: "unsupported" };
  if (env.isOffline()) return { iso, action: "offline" };
  if (meta.offline === "tile-store") return revalidateTiles(meta.iso, purpose);
  if (meta.offline === "ed269-store" || meta.offline === "import") return revalidateEd269(meta.iso, purpose);
  return { iso, action: "unsupported" };
}

/**
 * Bestände der Länder online im Hintergrund prüfen bzw. erneuern. Wirft nie;
 * gleichzeitige Aufrufe je Land werden zusammengeführt.
 */
export async function revalidateGeozoneSources(
  isos: readonly string[],
  purpose: RevalidatePurpose,
): Promise<RevalidateResult[]> {
  const unique = [...new Set(isos.map((i) => resolveGeozoneSourceIso(i)).filter(Boolean))];
  return Promise.all(
    unique.map((iso) => {
      const key = `${iso}:${purpose === "manual" ? "manual" : "auto"}`;
      const existing = running.get(key);
      if (existing) return existing;
      const p = revalidateOne(iso, purpose)
        .catch((e): RevalidateResult => ({ iso, action: "refresh-failed", reason: String(e?.message || e) }))
        .finally(() => running.delete(key));
      running.set(key, p);
      return p;
    }),
  );
}

/** Wie revalidateGeozoneSources, ohne zu warten (Auslöser in Screens). */
export function triggerGeozoneRevalidation(isos: readonly string[], purpose: RevalidatePurpose): void {
  void revalidateGeozoneSources(isos, purpose).catch(() => {});
}

// ---------------------------------------------------------------------------
// Ereignis: neue Geozonen-Daten
// ---------------------------------------------------------------------------

const changeListeners = new Set<(e: GeozoneDataChange) => void>();
let wired = false;

/** Für Tests und interne Quellen: Änderung melden. */
export function emitGeozoneDataChanged(e: GeozoneDataChange): void {
  for (const l of changeListeners) {
    try {
      l(e);
    } catch {}
  }
}

function wire(): void {
  if (wired) return;
  wired = true;
  onEd269Downloaded((iso) => emitGeozoneDataChanged({ iso: resolveGeozoneSourceIso(iso), kind: "ed269" }));
  onTileStoreChange(() => emitGeozoneDataChanged({ iso: null, kind: "tiles" }));
  onDeTempChange(() => emitGeozoneDataChanged({ iso: "DE", kind: "de-temp" }));
}

/** Benachrichtigung bei neuen Geozonen-Daten (ED-269-Download, Kachelspeicher, temporäre DE-Zonen). */
export function onGeozoneDataChanged(l: (e: GeozoneDataChange) => void): () => void {
  wire();
  changeListeners.add(l);
  return () => {
    changeListeners.delete(l);
  };
}

/** Betrifft eine Änderung eines der Länder? (Kachelspeicher allgemein → jedes Kachel-Land) */
export function isRelevantGeozoneChange(e: GeozoneDataChange, isos: readonly string[]): boolean {
  const set = new Set(isos.map((i) => resolveGeozoneSourceIso(i)));
  if (e.iso == null) return [...set].some((i) => getGeozoneSourceMeta(i)?.offline === "tile-store");
  return set.has(resolveGeozoneSourceIso(e.iso));
}
