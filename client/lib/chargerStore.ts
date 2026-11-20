/**
 * Speicher des Ladegerät-Loggers (ISDT MA331) – eigenes Modul, unabhängig
 * von storage.ts.
 *
 * Dateien unter documentDirectory/charger/ (Zeitreihen können groß werden,
 * deshalb nicht in AsyncStorage):
 *   index.json              Kurzfassung aller Ladevorgänge (für Listen)
 *   sessions/<id>.json      vollständiger Vorgang mit Zeitreihe
 *   links.json              Akku-Verknüpfungen (Fingerabdruck → App-Akku)
 * Kleine Schlüssel in AsyncStorage:
 *   @copterpilot/charger_pairing_v1:<MAC>   Kopplung (zufällige App-ID je Gerät)
 *   @copterpilot/charger_last_device_v1     zuletzt verbundenes Ladegerät
 *   @copterpilot/charger_background_mode_v1 „Ladegerät im Hintergrund loggen“
 *
 * Alle Schreibzugriffe laufen nacheinander (Warteschlange), Dateien werden
 * atomar geschrieben (writeTextAtomic). Lesefehler liefern leere Werte.
 * RN-frei: AsyncStorage und expo-file-system werden erst bei Bedarf geladen;
 * Tests setzen eigene Adapter.
 */
import { getSimpleFs, writeTextAtomic, type SimpleFs } from "./fileStoreFs";
import type { ChargeSession, SessionEndReason } from "./charger/chargeSession";
import { batteryKey, type BatteryLink } from "./charger/batteryFingerprint";
import type { PairingRecord, PairingStore } from "./charger/bleTransport";
import {
  parseBackgroundMode,
  type ChargerBackgroundMode,
} from "./charger/chargerBackground";

export interface KvStore {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}

export const PAIRING_KEY_PREFIX = "@copterpilot/charger_pairing_v1:";
export const LAST_DEVICE_KEY = "@copterpilot/charger_last_device_v1";
export const BACKGROUND_MODE_KEY = "@copterpilot/charger_background_mode_v1";

export interface SessionIndexEntry {
  id: string;
  chargerId: string;
  slot: number;
  status: "active" | "done";
  endReason?: SessionEndReason;
  startedAt: number;
  endedAt?: number;
  startPercent: number;
  endPercent: number;
  chargedMah: number;
  startMah: number;
  endMah: number;
  maxTempC: number;
  maxCurrentA: number;
  maxPowerW: number;
  endCellDeltaMv: number | null;
  /** Zellspannungen am Ende (mV), falls vom Akku gemeldet */
  endCellsMv?: number[];
  /** Größte Zell-Spreizung während des Ladens (mV) */
  maxCellDeltaMv?: number | null;
  cyclesStart: number;
  cyclesEnd: number;
  productionDate: string | null;
  batteryKey?: string;
  batteryLabel?: string;
  samples: number;
}

// ── Adapter ────────────────────────────────────────────────────────────────
let kvOverride: KvStore | null | undefined;
let fsOverride: SimpleFs | null | undefined;
const memKv = new Map<string, string>();
const memFiles = new Map<string, string>();

function kv(): KvStore {
  if (kvOverride) return kvOverride;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    return (mod.default ?? mod) as KvStore;
  } catch {
    return {
      getItem: async (k) => memKv.get(k) ?? null,
      setItem: async (k, v) => void memKv.set(k, v),
      removeItem: async (k) => void memKv.delete(k),
    };
  }
}

/** Ohne Dateisystem (Web): flüchtig im Speicher */
const memFs: SimpleFs = {
  root: "mem://",
  readText: async (p) => memFiles.get(p) ?? null,
  writeText: async (p, t) => void memFiles.set(p, t),
  move: async (a, b) => {
    const t = memFiles.get(a);
    if (t != null) memFiles.set(b, t);
    memFiles.delete(a);
  },
  remove: async (p) => {
    for (const k of [...memFiles.keys()])
      if (k === p || k.startsWith(p.endsWith("/") ? p : `${p}/`))
        memFiles.delete(k);
  },
  list: async (dir) =>
    [...memFiles.keys()]
      .filter((k) => k.startsWith(dir))
      .map((k) => k.slice(dir.length))
      .filter((n) => !n.includes("/")),
  mkdirp: async () => {},
  info: async (p) => ({ exists: memFiles.has(p) }),
};

function fs(): SimpleFs {
  if (fsOverride) return fsOverride;
  return getSimpleFs() ?? memFs;
}

/** Nur für Tests */
export function __setChargerStoreAdaptersForTests(a: {
  kv?: KvStore | null;
  fs?: SimpleFs | null;
}): void {
  if ("kv" in a) kvOverride = a.kv ?? undefined;
  if ("fs" in a) fsOverride = a.fs ?? undefined;
  memKv.clear();
  memFiles.clear();
}

const dir = () => `${fs().root}charger/`;
const indexPath = () => `${dir()}index.json`;
const linksPath = () => `${dir()}links.json`;
const sessionPath = (id: string) =>
  `${dir()}sessions/${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const t = await fs().readText(path);
    if (t == null) return fallback;
    return JSON.parse(t) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(fs(), path, JSON.stringify(value));
}

function validCells(cells: number[] | undefined): cells is number[] {
  return Array.isArray(cells) && cells.length >= 2 && cells.every((v) => Number.isFinite(v) && v > 1000);
}

/** Größte Spreizung (max − min) über alle Messpunkte mit gültigen Zellwerten */
export function maxCellDelta(series: { cells: number[] }[]): number | null {
  let best: number | null = null;
  for (const p of series) {
    if (!validCells(p.cells)) continue;
    const d = Math.max(...p.cells) - Math.min(...p.cells);
    if (best == null || d > best) best = d;
  }
  return best;
}

export function toIndexEntry(s: ChargeSession): SessionIndexEntry {
  return {
    id: s.id,
    chargerId: s.chargerId,
    slot: s.slot,
    status: s.status,
    endReason: s.endReason,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    startPercent: s.startPercent,
    endPercent: s.endPercent,
    chargedMah: s.chargedMah,
    startMah: s.startMah,
    endMah: s.endMah,
    maxTempC: s.maxTempC,
    maxCurrentA: s.maxCurrentA,
    maxPowerW: s.maxPowerW,
    endCellDeltaMv: s.endCellDeltaMv,
    endCellsMv: validCells(s.endCellsMv) ? [...s.endCellsMv] : undefined,
    maxCellDeltaMv: maxCellDelta(s.series),
    cyclesStart: s.cyclesStart,
    cyclesEnd: s.cyclesEnd,
    productionDate: s.productionDate,
    batteryKey: s.battery ? batteryKey(s.battery) : undefined,
    batteryLabel: s.battery?.label,
    samples: s.series.length,
  };
}

// ── Ladevorgänge ───────────────────────────────────────────────────────────
export function saveChargeSession(s: ChargeSession): Promise<void> {
  return serial(async () => {
    await writeJson(sessionPath(s.id), s);
    const idx = await readJson<SessionIndexEntry[]>(indexPath(), []);
    const entry = toIndexEntry(s);
    const i = idx.findIndex((e) => e.id === s.id);
    if (i >= 0) idx[i] = entry;
    else idx.push(entry);
    idx.sort((a, b) => b.startedAt - a.startedAt);
    await writeJson(indexPath(), idx);
  });
}

export async function listChargeSessions(filter?: {
  batteryKey?: string;
  status?: "active" | "done";
}): Promise<SessionIndexEntry[]> {
  await queue.catch(() => {});
  const idx = await readJson<SessionIndexEntry[]>(indexPath(), []);
  return (Array.isArray(idx) ? idx : []).filter(
    (e) =>
      (!filter?.batteryKey || e.batteryKey === filter.batteryKey) &&
      (!filter?.status || e.status === filter.status),
  );
}

export async function getChargeSession(
  id: string,
): Promise<ChargeSession | null> {
  await queue.catch(() => {});
  return readJson<ChargeSession | null>(sessionPath(id), null);
}

/**
 * Ältere Index-Einträge ohne Zellwerte einmalig aus den gespeicherten
 * Ladevorgängen ergänzen (Zellspannungen am Ende, größte Spreizung).
 */
export function backfillCellData(ids: string[]): Promise<SessionIndexEntry[]> {
  return serial(async () => {
    const idx = await readJson<SessionIndexEntry[]>(indexPath(), []);
    const want = new Set(ids);
    let changed = false;
    for (let i = 0; i < idx.length; i++) {
      const e = idx[i];
      if (!want.has(e.id) || "maxCellDeltaMv" in e) continue;
      const full = await readJson<ChargeSession | null>(sessionPath(e.id), null);
      if (!full) continue;
      idx[i] = { ...e, endCellsMv: toIndexEntry(full).endCellsMv, maxCellDeltaMv: maxCellDelta(full.series ?? []) };
      changed = true;
    }
    if (changed) await writeJson(indexPath(), idx);
    return idx.filter((e) => want.has(e.id));
  });
}

export function deleteChargeSession(id: string): Promise<void> {
  return serial(async () => {
    await fs()
      .remove(sessionPath(id))
      .catch(() => {});
    const idx = await readJson<SessionIndexEntry[]>(indexPath(), []);
    await writeJson(
      indexPath(),
      idx.filter((e) => e.id !== id),
    );
  });
}

/**
 * Abgeschlossene Ladevorgänge ohne Akku-Zuordnung löschen (lassen sich
 * nachträglich nicht zuordnen). Laufende bleiben – dort kann der Akku noch
 * gewählt werden. Rückgabe: Anzahl gelöschter Vorgänge.
 */
export async function deleteUnassignedSessions(): Promise<number> {
  const all = await listChargeSessions().catch(() => [] as SessionIndexEntry[]);
  const drop = all.filter((e) => !e.batteryKey && e.status !== "active");
  for (const e of drop) await deleteChargeSession(e.id);
  return drop.length;
}

/** Offene (unterbrochene) Vorgänge eines Ladegeräts – zum Fortsetzen */
export async function loadActiveSessions(
  chargerId?: string,
): Promise<ChargeSession[]> {
  const entries = await listChargeSessions({ status: "active" });
  const out: ChargeSession[] = [];
  for (const e of entries) {
    if (chargerId && e.chargerId !== chargerId) continue;
    const s = await getChargeSession(e.id);
    if (s && s.status === "active") out.push(s);
  }
  return out;
}

// ── Akku-Verknüpfungen ─────────────────────────────────────────────────────
export async function getBatteryLinks(): Promise<BatteryLink[]> {
  await queue.catch(() => {});
  const l = await readJson<BatteryLink[]>(linksPath(), []);
  return Array.isArray(l) ? l : [];
}

export function saveBatteryLinks(links: BatteryLink[]): Promise<void> {
  return serial(() => writeJson(linksPath(), links));
}

/** Vorgänge nachträglich einem Akku zuordnen (z. B. nach „Welcher Akku ist das?“) */
export function assignSessionsToBattery(
  sessionIds: string[],
  ref: { droneId?: string; batteryId: string; label: string } | undefined,
): Promise<void> {
  return serial(async () => {
    const idx = await readJson<SessionIndexEntry[]>(indexPath(), []);
    for (const id of sessionIds) {
      const s = await readJson<ChargeSession | null>(sessionPath(id), null);
      if (!s) continue;
      s.battery = ref
        ? { droneId: ref.droneId, batteryId: ref.batteryId, label: ref.label }
        : undefined;
      await writeJson(sessionPath(id), s);
      const i = idx.findIndex((e) => e.id === id);
      if (i >= 0) idx[i] = toIndexEntry(s);
    }
    await writeJson(indexPath(), idx);
  });
}

// ── Gemeinsame Akku-Identität (für die DJI-Fluglog-Auswertung) ────────────
/** Verknüpfung des Ladegeräts zu einem App-Akku (Produktionsdatum, Zyklen, DJI-SN) */
export async function getChargerLinkForBattery(
  droneId: string | undefined,
  batteryId: string,
): Promise<BatteryLink | null> {
  const key = batteryKey({ droneId, batteryId });
  return (await getBatteryLinks()).find((l) => l.key === key) ?? null;
}

/** Ladegerät-Verknüpfung über die DJI-Akku-Seriennummer (aus einem Fluglog) finden */
export async function findChargerLinkByDjiSerial(
  serial: string,
): Promise<BatteryLink | null> {
  const s = serial.trim().toUpperCase();
  if (!s) return null;
  return (
    (await getBatteryLinks()).find(
      (l) => (l.djiSerial ?? "").toUpperCase() === s,
    ) ?? null
  );
}

/**
 * DJI-Seriennummer an die Ladegerät-Verknüpfung eines App-Akkus hängen.
 * false, wenn der Akku (noch) nicht mit dem Ladegerät verknüpft ist.
 */
export async function setDjiSerialForBattery(
  droneId: string | undefined,
  batteryId: string,
  serial: string,
): Promise<boolean> {
  const key = batteryKey({ droneId, batteryId });
  const links = await getBatteryLinks();
  const i = links.findIndex((l) => l.key === key);
  if (i < 0) return false;
  links[i] = { ...links[i], djiSerial: serial.trim() };
  await saveBatteryLinks(links);
  return true;
}

// ── Kopplung ───────────────────────────────────────────────────────────────
export const chargerPairingStore: PairingStore = {
  async get(mac) {
    try {
      const raw = await kv().getItem(PAIRING_KEY_PREFIX + mac.toUpperCase());
      if (!raw) return null;
      const r = JSON.parse(raw) as PairingRecord;
      return r && typeof r.appId === "string" ? r : null;
    } catch {
      return null;
    }
  },
  async set(rec) {
    await kv().setItem(
      PAIRING_KEY_PREFIX + rec.mac.toUpperCase(),
      JSON.stringify(rec),
    );
  },
  async getLastDevice() {
    try {
      return await kv().getItem(LAST_DEVICE_KEY);
    } catch {
      return null;
    }
  },
  async setLastDevice(mac) {
    await kv().setItem(LAST_DEVICE_KEY, mac);
  },
};

/** Bekanntes Ladegerät vergessen (neu koppeln) */
export async function forgetCharger(mac: string): Promise<void> {
  await kv()
    .removeItem(PAIRING_KEY_PREFIX + mac.toUpperCase())
    .catch(() => {});
  if ((await chargerPairingStore.getLastDevice()) === mac)
    await kv()
      .removeItem(LAST_DEVICE_KEY)
      .catch(() => {});
}

// ── Einstellung ────────────────────────────────────────────────────────────
export async function getChargerBackgroundMode(): Promise<ChargerBackgroundMode> {
  try {
    return parseBackgroundMode(await kv().getItem(BACKGROUND_MODE_KEY));
  } catch {
    return parseBackgroundMode(null);
  }
}

export async function setChargerBackgroundMode(
  mode: ChargerBackgroundMode,
): Promise<void> {
  try {
    await kv().setItem(BACKGROUND_MODE_KEY, mode);
  } catch {
    /* Standard bleibt */
  }
}
