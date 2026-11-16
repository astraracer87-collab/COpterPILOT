/**
 * Kennzahlen je Akku aus den gespeicherten Ladevorgängen (rein, testbar):
 * letzter Ladevorgang, Zyklen, Zustand (aus Zell-Spreizung bei „voll“ und
 * Kapazität bei 100 % im Vergleich zum Bestwert) und Trend-Reihen.
 *
 * Hinweis: Das MA331 liefert keinen Gesundheitswert (SoH) und keinen
 * Innenwiderstand. Der Zustand hier ist eine grobe eigene Einschätzung.
 */
import type { SessionIndexEntry } from "../chargerStore";

export type HealthLevel = "good" | "watch" | "bad" | "unknown";

export const HEALTH_LABEL: Record<HealthLevel, string> = {
  good: "gut",
  watch: "beobachten",
  bad: "auffällig",
  unknown: "–",
};

export interface BatteryStats {
  sessions: number;
  lastSession: SessionIndexEntry | null;
  cycles: number | null;
  /** Spreizung der Zellen am Ende des letzten Vollladens (mV) */
  lastFullDeltaMv: number | null;
  /** Restkapazität bei 100 % (letzter Vollladevorgang) */
  lastFullMah: number | null;
  bestFullMah: number | null;
  /** lastFullMah / bestFullMah */
  capacityRatio: number | null;
  maxTempC: number | null;
  health: HealthLevel;
}

export function computeBatteryStats(
  entries: SessionIndexEntry[],
): BatteryStats {
  const sorted = [...entries].sort((a, b) => a.startedAt - b.startedAt);
  const last = sorted[sorted.length - 1] ?? null;
  const fulls = sorted.filter(
    (e) => e.endReason === "full" && e.endPercent >= 99,
  );
  const lastFull = fulls[fulls.length - 1] ?? null;
  const fullMahs = fulls
    .map((e) => e.endMah)
    .filter((x) => typeof x === "number" && x > 0);
  const best = fullMahs.length ? Math.max(...fullMahs) : null;
  const lastMah = lastFull && lastFull.endMah > 0 ? lastFull.endMah : null;
  const ratio = best && lastMah ? lastMah / best : null;
  const delta = lastFull?.endCellDeltaMv ?? null;
  const cycles = sorted.length
    ? Math.max(...sorted.map((e) => e.cyclesEnd))
    : null;
  const temps = sorted.map((e) => e.maxTempC).filter((x) => Number.isFinite(x));
  let health: HealthLevel = "unknown";
  if (delta != null || ratio != null) {
    const bad =
      (delta != null && delta >= 60) || (ratio != null && ratio < 0.8);
    const watch =
      (delta != null && delta >= 30) || (ratio != null && ratio < 0.9);
    health = bad ? "bad" : watch ? "watch" : "good";
  }
  return {
    sessions: sorted.length,
    lastSession: last,
    cycles,
    lastFullDeltaMv: delta,
    lastFullMah: lastMah,
    bestFullMah: best,
    capacityRatio: ratio,
    maxTempC: temps.length ? Math.max(...temps) : null,
    health,
  };
}

export interface TrendSeries {
  cycles: { x: number; y: number }[];
  imbalance: { x: number; y: number }[];
  maxTemp: { x: number; y: number }[];
  chargedMah: { x: number; y: number }[];
}

export function trendSeries(entries: SessionIndexEntry[]): TrendSeries {
  const done = [...entries]
    .filter((e) => e.status === "done")
    .sort((a, b) => a.startedAt - b.startedAt);
  return {
    cycles: done.map((e) => ({ x: e.startedAt, y: e.cyclesEnd })),
    imbalance: done
      .filter((e) => e.endCellDeltaMv != null)
      .map((e) => ({ x: e.startedAt, y: e.endCellDeltaMv as number })),
    maxTemp: done.map((e) => ({ x: e.startedAt, y: e.maxTempC })),
    chargedMah: done.map((e) => ({ x: e.startedAt, y: e.chargedMah })),
  };
}

export const END_REASON_LABEL: Record<string, string> = {
  full: "voll",
  removed: "entnommen",
  error: "Fehler",
  stopped: "gestoppt",
  interrupted: "abgebrochen",
  disconnected: "Verbindung weg",
};
