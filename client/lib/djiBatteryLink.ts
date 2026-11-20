/**
 * Verknüpfung DJI-Flugprotokoll ↔ Drohne ↔ Akku und Akku-Statistik.
 *
 * - Drohne: über die Seriennummer des Fluggeräts im Log (aircraftSn ↔
 *   DroneProfile.serialNumber); sonst – nur wenn eindeutig – über den Modellnamen.
 * - Akku: über die Seriennummer im Log (batterySn ↔ DroneBattery.serialNumber).
 *   Unbekannte Akkus einer erkannten Drohne werden automatisch angelegt
 *   (source "dji-log"), Ladezyklen aus dem Log übernommen.
 * - Statistik je Akku: Flüge, letzte Nutzung, Zyklen, Verlauf von minimaler
 *   Zellspannung und maximaler Temperatur.
 *
 * Rein (keine Speicherzugriffe), unter Node testbar; storage.ts/djiLog.ts
 * schreiben die Ergebnisse.
 */
import type { DjiLogMeta } from "./djiLogCore";
import { dronesCompatible, normalizeDroneName } from "./djiLogCore";

/** Minimal benötigte Formen (strukturell kompatibel zu storage.ts). */
export interface LinkBattery {
  id: string;
  name: string;
  serialNumber: string;
  createdAt: string;
  cycleCount?: number;
  lastSeenAt?: string;
  source?: "manual" | "dji-log";
}

export interface LinkDrone {
  id: string;
  name: string;
  model?: string;
  manufacturer?: string;
  serialNumber?: string;
  batteries?: LinkBattery[];
  archivedAt?: string | null;
}

export interface LinkEntry {
  id: string;
  droneId: string;
  flightDate: string;
  takeoffTime?: string;
  djiLogs?: DjiLogMeta[];
  djiLog?: DjiLogMeta;
  preflight?: { batteryUsage?: { batteryId: string }[] };
  debriefing?: { batteryUsage?: { batteryId: string }[] };
}

export function normalizeSerial(s?: string | null): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function serialsMatch(a?: string | null, b?: string | null): boolean {
  const na = normalizeSerial(a);
  const nb = normalizeSerial(b);
  return na.length >= 4 && na === nb;
}

/** Levenshtein-Abstand (kleine Strings, früher Abbruch über maxDist) */
function editDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Fast gleiche Seriennummer (ein Tippfehler: ein Zeichen fehlt/zu viel/falsch),
 * z. B. von Hand eingetragen „89PN5LDA002J9“ statt „894PN5LDA002J9“.
 */
export function serialsNearlyMatch(a?: string | null, b?: string | null): boolean {
  const na = normalizeSerial(a);
  const nb = normalizeSerial(b);
  if (na.length < 8 || nb.length < 8) return false;
  return na === nb || editDistance(na, nb, 1) <= 1;
}

/** Drohne zu einem Log finden: Seriennummer, sonst eindeutiger Modellname. */
export function findDroneForLog<D extends LinkDrone>(
  drones: readonly D[],
  meta: Pick<DjiLogMeta, "aircraftSn" | "droneName" | "aircraftName">,
): D | null {
  if (meta.aircraftSn) {
    const bySn = drones.find((d) =>
      serialsMatch(d.serialNumber, meta.aircraftSn),
    );
    if (bySn) return bySn;
  }
  const active = drones.filter((d) => !d.archivedAt);
  const candidates = active.filter((d) => {
    // Drohnen mit anderer hinterlegter Seriennummer sind sicher nicht gemeint
    if (
      meta.aircraftSn &&
      normalizeSerial(d.serialNumber) &&
      !serialsMatch(d.serialNumber, meta.aircraftSn)
    )
      return false;
    const names = [d.model, d.name].filter(Boolean) as string[];
    return names.some(
      (nm) =>
        !!normalizeDroneName(nm) &&
        ((!!meta.droneName && dronesCompatible(nm, meta.droneName)) ||
          (!!meta.aircraftName && dronesCompatible(nm, meta.aircraftName))),
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function shortSerial(sn: string): string {
  const n = normalizeSerial(sn);
  return n.length > 4 ? n.slice(-4) : n;
}

export interface BatteryLinkResult<D extends LinkDrone> {
  /** geänderte Drohne (neuer Akku / Zyklen / Seriennummer), sonst null */
  updatedDrone: D | null;
  batteryId?: string;
  batteryLabel?: string;
  createdBattery: boolean;
}

/**
 * Akku des Logs an der Drohne finden oder anlegen; Zyklen aktualisieren.
 * Füllt außerdem eine leere Drohnen-Seriennummer aus dem Log.
 */
export function linkBatteryForLog<D extends LinkDrone>(
  drone: D,
  meta: Pick<
    DjiLogMeta,
    "batterySn" | "batteryCycleCount" | "aircraftSn" | "startTs" | "parsedAt"
  >,
  opts: { now?: string; newId?: () => string } = {},
): BatteryLinkResult<D> {
  const now = opts.now ?? new Date().toISOString();
  const seenAt =
    meta.startTs != null && Number.isFinite(meta.startTs)
      ? new Date(meta.startTs).toISOString()
      : (meta.parsedAt ?? now);
  let changed = false;
  let next: D = drone;
  if (!normalizeSerial(drone.serialNumber) && meta.aircraftSn) {
    next = { ...next, serialNumber: meta.aircraftSn };
    changed = true;
  }
  if (!meta.batterySn || normalizeSerial(meta.batterySn).length < 4) {
    return { updatedDrone: changed ? next : null, createdBattery: false };
  }
  const batteries = [...(next.batteries ?? [])];
  let idx = batteries.findIndex((b) =>
    serialsMatch(b.serialNumber, meta.batterySn),
  );
  let created = false;
  if (idx < 0) {
    // Tippfehler in der von Hand eingetragenen Seriennummer: eindeutigen,
    // fast gleichen Akku nehmen und die Nummer aus dem Log übernehmen
    const near = batteries
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => serialsNearlyMatch(b.serialNumber, meta.batterySn));
    if (near.length === 1) {
      idx = near[0].i;
      batteries[idx] = { ...batteries[idx], serialNumber: meta.batterySn };
      changed = true;
    }
  }
  if (idx < 0) {
    const id = opts.newId
      ? opts.newId()
      : `bat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    batteries.push({
      id,
      name: `Akku …${shortSerial(meta.batterySn)}`,
      serialNumber: meta.batterySn,
      createdAt: now,
      source: "dji-log",
    });
    idx = batteries.length - 1;
    created = true;
    changed = true;
  }
  const bat = { ...batteries[idx] };
  if (
    typeof meta.batteryCycleCount === "number" &&
    meta.batteryCycleCount > 0
  ) {
    // Zyklen nur erhöhen (ältere Logs dürfen den Stand nicht zurücksetzen)
    if (
      !(
        typeof bat.cycleCount === "number" &&
        bat.cycleCount >= meta.batteryCycleCount
      )
    ) {
      bat.cycleCount = meta.batteryCycleCount;
      changed = true;
    }
  }
  if (!bat.lastSeenAt || Date.parse(seenAt) > Date.parse(bat.lastSeenAt)) {
    bat.lastSeenAt = seenAt;
    changed = true;
  }
  batteries[idx] = bat;
  if (changed) next = { ...next, batteries };
  return {
    updatedDrone: changed ? next : null,
    batteryId: bat.id,
    batteryLabel: bat.name || `Akku …${shortSerial(bat.serialNumber)}`,
    createdBattery: created,
  };
}

// ---------------------------------------------------------------------------
// Akku-Statistik
// ---------------------------------------------------------------------------

export interface BatteryTrendPoint {
  /** ms seit Epoch */
  ts: number;
  entryId: string;
  minCellV?: number;
  maxTempC?: number;
  startPercent?: number;
  endPercent?: number;
}

export interface BatteryStat {
  key: string;
  batteryId?: string;
  droneId?: string;
  droneName?: string;
  name: string;
  serialNumber?: string;
  /** Anzahl Flüge (Logbuch-Einträge) mit diesem Akku */
  flightCount: number;
  lastUsedAt?: string;
  /** Ladezyklen: höchster Wert aus Logs bzw. Akku-Stammdaten */
  cycleCount?: number;
  /** chronologisch (alt → neu) */
  trend: BatteryTrendPoint[];
  lowestCellV?: number;
  highestTempC?: number;
}

function entryLogs(e: LinkEntry): DjiLogMeta[] {
  if (e.djiLogs && e.djiLogs.length > 0) return e.djiLogs;
  return e.djiLog ? [e.djiLog] : [];
}

function entryTs(e: LinkEntry, log?: DjiLogMeta): number {
  if (log?.startTs != null && Number.isFinite(log.startTs)) return log.startTs;
  const t = log?.track?.find((p) => typeof p.ts === "number")?.ts;
  if (typeof t === "number") return t;
  const a = e.takeoffTime ? Date.parse(e.takeoffTime) : NaN;
  if (Number.isFinite(a)) return a;
  const b = Date.parse(e.flightDate);
  return Number.isFinite(b) ? b : 0;
}

/**
 * Statistik je Akku über alle Drohnen und Logbuch-Einträge. Berücksichtigt
 * DJI-Logs (batteryId/batterySn) und die manuelle Akku-Auswahl im
 * Pre-Check/Debriefing. Akkus aus Logs ohne passende Drohne erscheinen mit
 * ihrer Seriennummer.
 */
export function computeBatteryStats(
  drones: readonly LinkDrone[],
  entries: readonly LinkEntry[],
): BatteryStat[] {
  const stats = new Map<string, BatteryStat>();
  const bySerial = new Map<string, string>();
  const byId = new Map<string, string>();
  const flightsSeen = new Map<string, Set<string>>();

  for (const d of drones) {
    for (const b of d.batteries ?? []) {
      const key = `bat:${b.id}`;
      stats.set(key, {
        key,
        batteryId: b.id,
        droneId: d.id,
        droneName: d.name,
        name: b.name || "Akku",
        serialNumber: b.serialNumber || undefined,
        flightCount: 0,
        cycleCount:
          typeof b.cycleCount === "number" && b.cycleCount > 0
            ? b.cycleCount
            : undefined,
        trend: [],
      });
      byId.set(b.id, key);
      const ns = normalizeSerial(b.serialNumber);
      if (ns.length >= 4) bySerial.set(ns, key);
    }
  }

  const touch = (key: string, e: LinkEntry, ts: number) => {
    const st = stats.get(key)!;
    let seen = flightsSeen.get(key);
    if (!seen) flightsSeen.set(key, (seen = new Set()));
    if (!seen.has(e.id)) {
      seen.add(e.id);
      st.flightCount++;
    }
    const iso = ts > 0 ? new Date(ts).toISOString() : e.flightDate;
    if (!st.lastUsedAt || Date.parse(iso) > Date.parse(st.lastUsedAt))
      st.lastUsedAt = iso;
  };

  for (const e of entries) {
    for (const log of entryLogs(e)) {
      let key = log.batteryId ? byId.get(log.batteryId) : undefined;
      const ns = normalizeSerial(log.batterySn);
      if (!key && ns.length >= 4) key = bySerial.get(ns);
      if (!key && ns.length >= 4) {
        key = `sn:${ns}`;
        if (!stats.has(key)) {
          stats.set(key, {
            key,
            name: `Akku …${ns.slice(-4)}`,
            serialNumber: log.batterySn,
            droneName: log.droneName,
            flightCount: 0,
            trend: [],
          });
          bySerial.set(ns, key);
        }
      }
      if (!key) continue;
      const ts = entryTs(e, log);
      touch(key, e, ts);
      const st = stats.get(key)!;
      if (
        typeof log.batteryCycleCount === "number" &&
        log.batteryCycleCount > (st.cycleCount ?? 0)
      ) {
        st.cycleCount = log.batteryCycleCount;
      }
      const pt: BatteryTrendPoint = { ts, entryId: e.id };
      if (typeof log.minCellV === "number" && !log.minCellEstimated)
        pt.minCellV = log.minCellV;
      if (typeof log.maxBatteryTempC === "number")
        pt.maxTempC = log.maxBatteryTempC;
      if (typeof log.batteryStartPercent === "number")
        pt.startPercent = log.batteryStartPercent;
      if (typeof log.batteryEndPercent === "number")
        pt.endPercent = log.batteryEndPercent;
      if (
        pt.minCellV !== undefined ||
        pt.maxTempC !== undefined ||
        pt.startPercent !== undefined ||
        pt.endPercent !== undefined
      ) {
        st.trend.push(pt);
      }
    }
    // manuelle Auswahl im Pre-Check / Debriefing
    const manual = [
      ...(e.preflight?.batteryUsage ?? []),
      ...(e.debriefing?.batteryUsage ?? []),
    ];
    for (const u of manual) {
      const key = byId.get(u.batteryId);
      if (key) touch(key, e, entryTs(e));
    }
  }

  for (const st of stats.values()) {
    st.trend.sort((a, b) => a.ts - b.ts);
    for (const p of st.trend) {
      if (
        p.minCellV !== undefined &&
        (st.lowestCellV === undefined || p.minCellV < st.lowestCellV)
      )
        st.lowestCellV = p.minCellV;
      if (
        p.maxTempC !== undefined &&
        (st.highestTempC === undefined || p.maxTempC > st.highestTempC)
      )
        st.highestTempC = p.maxTempC;
    }
  }

  return [...stats.values()].sort((a, b) => {
    const la = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const lb = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    if (lb !== la) return lb - la;
    return a.name.localeCompare(b.name, "de");
  });
}

/** Einträge, in denen ein Akku verwendet wurde (DJI-Log oder manuelle Auswahl). */
export function entryUsesBattery(
  e: LinkEntry,
  battery: { id: string; serialNumber?: string },
): boolean {
  if ((e.preflight?.batteryUsage ?? []).some((u) => u.batteryId === battery.id))
    return true;
  if (
    (e.debriefing?.batteryUsage ?? []).some((u) => u.batteryId === battery.id)
  )
    return true;
  return entryLogs(e).some(
    (l) =>
      l.batteryId === battery.id ||
      (!!battery.serialNumber &&
        serialsMatch(l.batterySn, battery.serialNumber)),
  );
}

/** Kurzer Text für einen Verlauf, z. B. "3,61 → 3,55 → 3,48 V". */
export function formatTrend(
  values: (number | undefined)[],
  decimals: number,
  unit: string,
  max = 5,
): string {
  const v = values
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .slice(-max);
  if (v.length === 0) return "—";
  return `${v.map((x) => x.toFixed(decimals).replace(".", ",")).join(" → ")} ${unit}`;
}
