/**
 * Ladevorgänge aus dem Status-Strom des Ladegeräts bilden (reine Logik).
 *
 * Start: ein Schacht wechselt auf „Lädt“ (Status 2).
 * Ende:  „Voll“ (3) → full, „Leer“ (0) → removed, „Fehler“ (6) → error,
 *        anderer Akku im Schacht (Datum anders oder Zyklen kleiner) → removed,
 *        länger als STOP_GRACE_MS in „Bereit“/„Entlädt“/unbekannt → stopped.
 *        „Zu heiß“/„Zu kalt“ (7/8) pausieren nur (Warnung im Vorgang).
 * Unterbrechung: Verbindung weg → der Vorgang bleibt offen. Kommt die
 *        Verbindung innerhalb von RESUME_WINDOW_MS zurück, läuft er weiter
 *        (Lücke gezählt); sonst endet er als „disconnected“ zum letzten
 *        bekannten Zeitpunkt. `finalizeAll` schließt alles (z. B. Beenden).
 *
 * Zeitreihe: höchstens ein Messpunkt je SAMPLE_INTERVAL_MS (10 s), dazu
 * immer der erste und der letzte.
 */
import {
  cellDeltaMv,
  IsdtSlotState,
  productionDateKey,
  type IsdtSlot,
  type IsdtStatus,
} from "./ma331Protocol";

export const SAMPLE_INTERVAL_MS = 10_000;
export const STOP_GRACE_MS = 30_000;
export const RESUME_WINDOW_MS = 10 * 60_000;

export type SessionEndReason =
  | "full"
  | "removed"
  | "error"
  | "stopped"
  | "interrupted"
  | "disconnected";

export interface ChargeSample {
  t: number;
  soc: number;
  mah: number;
  a: number;
  w: number;
  temp: number;
  cells: number[];
}

export interface BatteryRef {
  droneId?: string;
  batteryId: string;
  label: string;
}

export interface ChargeSession {
  id: string;
  chargerId: string;
  slot: number;
  status: "active" | "done";
  endReason?: SessionEndReason;
  startedAt: number;
  endedAt?: number;
  /** Erster Messpunkt war schon „Lädt“ (Start nicht beobachtet) */
  startedMidway: boolean;
  startPercent: number;
  endPercent: number;
  startMah: number;
  endMah: number;
  /** Zuwachs der Restkapazität (≥ 0) */
  chargedMah: number;
  maxTempC: number;
  maxCurrentA: number;
  maxPowerW: number;
  endCellsMv: number[];
  endCellDeltaMv: number | null;
  cyclesStart: number;
  cyclesEnd: number;
  /** JJJJ-MM-TT oder null, wenn unplausibel */
  productionDate: string | null;
  battery?: BatteryRef;
  warnings: string[];
  gaps: number;
  lastSeenAt: number;
  series: ChargeSample[];
}

export type SessionEvent =
  | { type: "started"; session: ChargeSession }
  | { type: "ended"; session: ChargeSession };

export interface SessionTrackerOptions {
  chargerId: string;
  newId(): string;
  sampleIntervalMs?: number;
  stopGraceMs?: number;
  resumeWindowMs?: number;
}

export interface SessionTracker {
  update(status: IsdtStatus, now: number): SessionEvent[];
  connectionLost(now: number): void;
  finalizeAll(reason: SessionEndReason, now: number): ChargeSession[];
  active(): ChargeSession[];
  activeForSlot(slot: number): ChargeSession | null;
  /** Gespeicherte offene Vorgänge wieder aufnehmen (nach Neustart des Dienstes) */
  restore(sessions: ChargeSession[]): void;
  setBattery(
    sessionId: string,
    ref: BatteryRef | undefined,
  ): ChargeSession | null;
}

function toSample(s: IsdtSlot, t: number): ChargeSample {
  return {
    t,
    soc: s.socPercent,
    mah: s.remainingMah,
    a: s.currentA,
    w: s.powerW,
    temp: s.temperatureC,
    cells: s.cellMillivolts.slice(),
  };
}

/** Messpunkt anhängen, wenn seit dem letzten mindestens `intervalMs` vergangen sind (oder `force`). */
export function appendSample(
  series: ChargeSample[],
  sample: ChargeSample,
  intervalMs: number,
  force = false,
): boolean {
  const last = series[series.length - 1];
  if (!last || force || sample.t - last.t >= intervalMs) {
    if (last && last.t === sample.t) series[series.length - 1] = sample;
    else series.push(sample);
    return true;
  }
  return false;
}

/** Für Diagramme auf höchstens `maxPoints` ausdünnen (gleichmäßig, erster und letzter bleiben). */
export function downsampleSeries<T>(points: T[], maxPoints: number): T[] {
  if (maxPoints < 2 || points.length <= maxPoints) return points.slice();
  const out: T[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  let prev = -1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    if (idx !== prev) out.push(points[idx]);
    prev = idx;
  }
  return out;
}

export function isChargingState(state: number): boolean {
  return state === IsdtSlotState.Charging;
}

export function createSessionTracker(
  opts: SessionTrackerOptions,
): SessionTracker {
  const sampleMs = opts.sampleIntervalMs ?? SAMPLE_INTERVAL_MS;
  const graceMs = opts.stopGraceMs ?? STOP_GRACE_MS;
  const resumeMs = opts.resumeWindowMs ?? RESUME_WINDOW_MS;
  const activeBySlot = new Map<number, ChargeSession>();
  const nonChargingSince = new Map<number, number>();
  const seen = new Set<number>();
  let lostAt: number | null = null;

  function end(
    slot: number,
    reason: SessionEndReason,
    at: number,
  ): ChargeSession | null {
    const s = activeBySlot.get(slot);
    if (!s) return null;
    activeBySlot.delete(slot);
    nonChargingSince.delete(slot);
    s.status = "done";
    s.endReason = reason;
    s.endedAt = Math.max(at, s.startedAt);
    return s;
  }

  function absorb(
    s: ChargeSession,
    slot: IsdtSlot,
    now: number,
    force = false,
  ) {
    s.lastSeenAt = now;
    s.endPercent = slot.socPercent;
    s.endMah = slot.remainingMah;
    s.chargedMah = Math.max(0, s.endMah - s.startMah);
    s.maxTempC = Math.max(s.maxTempC, slot.temperatureC);
    s.maxCurrentA = Math.max(s.maxCurrentA, slot.currentA);
    s.maxPowerW = Math.max(s.maxPowerW, slot.powerW);
    if (slot.cellMillivolts.some((c) => c > 0)) {
      s.endCellsMv = slot.cellMillivolts.slice();
      s.endCellDeltaMv = cellDeltaMv(slot.cellMillivolts)?.delta ?? null;
    }
    s.cyclesEnd = Math.max(s.cyclesEnd, slot.cycleCount);
    appendSample(s.series, toSample(slot, now), sampleMs, force);
  }

  function start(slot: IsdtSlot, now: number, midway: boolean): ChargeSession {
    const s: ChargeSession = {
      id: opts.newId(),
      chargerId: opts.chargerId,
      slot: slot.index,
      status: "active",
      startedAt: now,
      startedMidway: midway,
      startPercent: slot.socPercent,
      endPercent: slot.socPercent,
      startMah: slot.remainingMah,
      endMah: slot.remainingMah,
      chargedMah: 0,
      maxTempC: slot.temperatureC,
      maxCurrentA: slot.currentA,
      maxPowerW: slot.powerW,
      endCellsMv: slot.cellMillivolts.slice(),
      endCellDeltaMv: cellDeltaMv(slot.cellMillivolts)?.delta ?? null,
      cyclesStart: slot.cycleCount,
      cyclesEnd: slot.cycleCount,
      productionDate: productionDateKey(slot.productionDate),
      warnings: [],
      gaps: 0,
      lastSeenAt: now,
      series: [toSample(slot, now)],
    };
    activeBySlot.set(slot.index, s);
    nonChargingSince.delete(slot.index);
    return s;
  }

  function isOtherBattery(s: ChargeSession, slot: IsdtSlot): boolean {
    if (!slot.hasData) return false;
    const key = productionDateKey(slot.productionDate);
    if (s.productionDate && key && key !== s.productionDate) return true;
    return slot.cycleCount < s.cyclesEnd;
  }

  return {
    update(status, now) {
      const events: SessionEvent[] = [];
      // Rückkehr nach Unterbrechung
      if (lostAt != null) {
        const gapFrom = lostAt;
        lostAt = null;
        for (const [slotIdx, s] of [...activeBySlot]) {
          if (now - s.lastSeenAt > resumeMs) {
            const e = end(slotIdx, "disconnected", s.lastSeenAt);
            if (e) events.push({ type: "ended", session: e });
          } else if (now > gapFrom) s.gaps++;
        }
      }
      for (const slot of status.slots) {
        const idx = slot.index;
        const firstSight = !seen.has(idx);
        seen.add(idx);
        let s = activeBySlot.get(idx) ?? null;
        if (s) {
          if (slot.state === IsdtSlotState.Empty) {
            const e = end(idx, "removed", now);
            if (e) events.push({ type: "ended", session: e });
            s = null;
          } else if (isOtherBattery(s, slot)) {
            const e = end(idx, "removed", s.lastSeenAt);
            if (e) events.push({ type: "ended", session: e });
            s = null;
          } else if (slot.state === IsdtSlotState.Full) {
            absorb(s, slot, now, true);
            const e = end(idx, "full", now);
            if (e) events.push({ type: "ended", session: e });
            continue;
          } else if (slot.state === IsdtSlotState.Error) {
            const e = end(idx, "error", now);
            if (e) {
              if (!e.warnings.includes("error")) e.warnings.push("error");
              events.push({ type: "ended", session: e });
            }
            continue;
          } else if (slot.state === IsdtSlotState.Charging) {
            nonChargingSince.delete(idx);
            absorb(s, slot, now);
            continue;
          } else if (
            slot.state === IsdtSlotState.OverTemp ||
            slot.state === IsdtSlotState.UnderTemp
          ) {
            const w =
              slot.state === IsdtSlotState.OverTemp ? "overtemp" : "undertemp";
            if (!s.warnings.includes(w)) s.warnings.push(w);
            absorb(s, slot, now);
            continue;
          } else {
            const since = nonChargingSince.get(idx) ?? now;
            nonChargingSince.set(idx, since);
            if (slot.hasData) absorb(s, slot, now);
            if (now - since >= graceMs) {
              const e = end(idx, "stopped", now);
              if (e) events.push({ type: "ended", session: e });
            }
            continue;
          }
        }
        if (!s && isChargingState(slot.state) && slot.hasData) {
          events.push({
            type: "started",
            session: start(slot, now, firstSight),
          });
        }
      }
      return events;
    },
    connectionLost(now) {
      if (lostAt == null) lostAt = now;
    },
    finalizeAll(reason, now) {
      const out: ChargeSession[] = [];
      for (const [slot, s] of [...activeBySlot]) {
        // Ende = letzter Messpunkt (danach wissen wir nichts mehr)
        const e = end(slot, reason, Math.min(now, s.lastSeenAt));
        if (e) out.push(e);
      }
      return out;
    },
    active: () => [...activeBySlot.values()],
    activeForSlot: (slot) => activeBySlot.get(slot) ?? null,
    restore(sessions) {
      for (const s of sessions) {
        if (s.status !== "active" || activeBySlot.has(s.slot)) continue;
        activeBySlot.set(s.slot, {
          ...s,
          series: s.series.slice(),
          warnings: s.warnings.slice(),
        });
        seen.add(s.slot);
      }
      if (sessions.length)
        lostAt = lostAt ?? Math.max(...sessions.map((s) => s.lastSeenAt));
    },
    setBattery(sessionId, ref) {
      for (const s of activeBySlot.values()) {
        if (s.id === sessionId) {
          s.battery = ref;
          return s;
        }
      }
      return null;
    },
  };
}
