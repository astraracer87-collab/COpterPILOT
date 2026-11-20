/**
 * Kennzahlen je Akku aus den gespeicherten Ladevorgängen (rein, testbar):
 * letzter Ladevorgang, Zyklen, Zustand (aus Zell-Spreizung bei „voll“ und
 * Kapazität bei 100 % im Vergleich zum Bestwert) und Trend-Reihen.
 *
 * Hinweis: Das MA331 liefert keinen Gesundheitswert (SoH) und keinen
 * Innenwiderstand. Der Zustand hier ist eine grobe eigene Einschätzung.
 */
import type { SessionIndexEntry } from "../chargerStore";
type TrendPoint = { x: number; y: number };

export type HealthLevel = "good" | "watch" | "bad" | "unknown";

/**
 * Richtwerte Zell-Spreizung DJI-Akkus (Ruhe/nach dem Laden): < 50 mV gesund,
 * ab 100 mV gealterte/beschädigte Zelle, ab ~300 mV verweigert das BMS das Laden.
 */
export const CELL_SPREAD_WATCH_MV = 50;
export const CELL_SPREAD_BAD_MV = 100;
export const CELL_SPREAD_CRITICAL_MV = 300;

export type SpreadLevel = "ok" | "watch" | "bad" | "critical";
export function spreadLevel(mv: number | null | undefined): SpreadLevel | null {
  if (mv == null || !Number.isFinite(mv)) return null;
  if (mv >= CELL_SPREAD_CRITICAL_MV) return "critical";
  if (mv >= CELL_SPREAD_BAD_MV) return "bad";
  if (mv >= CELL_SPREAD_WATCH_MV) return "watch";
  return "ok";
}

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
      (delta != null && delta >= CELL_SPREAD_BAD_MV) || (ratio != null && ratio < 0.8);
    const watch =
      (delta != null && delta >= CELL_SPREAD_WATCH_MV) || (ratio != null && ratio < 0.9);
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

// ── Zellen einzeln über die Zeit ───────────────────────────────────────────
export interface CellHistory {
  /** Anzahl Zellen (aus dem jüngsten Ladevorgang mit Zellwerten) */
  cells: number;
  /** Je Zelle: Spannung am Ladeende (mV) über die Ladevorgänge */
  endMv: TrendPoint[][];
  /** Je Zelle: Abweichung vom Mittel aller Zellen am Ladeende (mV) */
  deviationMv: TrendPoint[][];
  /** Je Zelle: wie oft sie am Ladeende die niedrigste war */
  lowestCount: number[];
  /** Je Zelle: letzte Spannung am Ladeende (mV) */
  lastMv: (number | null)[];
  /** Größte Spreizung während des Ladens (mV) je Ladevorgang */
  maxDuringCharge: TrendPoint[];
  sessions: number;
  /** Je Zelle: Abstand zur stärksten Zelle am Ladeende (mV) über die Ladevorgänge */
  lagMv: TrendPoint[][];
  /** Je Zelle: niedrigste/höchste Endspannung über alle Ladevorgänge (mV) */
  minMv: (number | null)[];
  maxMv: (number | null)[];
  /** Je Zelle: größter Abstand zur stärksten Zelle bisher (mV) */
  maxLagMv: (number | null)[];
  /** Spreizung am Ende des jüngsten Ladevorgangs (mV) */
  lastSpreadMv: number | null;
}

export function cellHistory(entries: SessionIndexEntry[]): CellHistory {
  const done = [...entries]
    .filter((e) => e.status === "done")
    .sort((a, b) => a.startedAt - b.startedAt);
  const withCells = done.filter((e) => Array.isArray(e.endCellsMv) && e.endCellsMv.length >= 2);
  const n = withCells.length ? withCells[withCells.length - 1].endCellsMv!.length : 0;
  const endMv: TrendPoint[][] = Array.from({ length: n }, () => []);
  const deviationMv: TrendPoint[][] = Array.from({ length: n }, () => []);
  const lowestCount = new Array(n).fill(0);
  const lastMv: (number | null)[] = new Array(n).fill(null);
  const lagMv: TrendPoint[][] = Array.from({ length: n }, () => []);
  const minMv: (number | null)[] = new Array(n).fill(null);
  const maxMv: (number | null)[] = new Array(n).fill(null);
  const maxLagMv: (number | null)[] = new Array(n).fill(null);
  let lastSpreadMv: number | null = null;
  for (const e of withCells) {
    const cells = e.endCellsMv!;
    if (cells.length !== n) continue;
    const mean = cells.reduce((a, b) => a + b, 0) / n;
    const min = Math.min(...cells);
    const max = Math.max(...cells);
    lastSpreadMv = max - min;
    cells.forEach((mv, i) => {
      endMv[i].push({ x: e.startedAt, y: mv });
      deviationMv[i].push({ x: e.startedAt, y: Math.round(mv - mean) });
      lagMv[i].push({ x: e.startedAt, y: max - mv });
      lastMv[i] = mv;
      minMv[i] = minMv[i] == null ? mv : Math.min(minMv[i]!, mv);
      maxMv[i] = maxMv[i] == null ? mv : Math.max(maxMv[i]!, mv);
      maxLagMv[i] = maxLagMv[i] == null ? max - mv : Math.max(maxLagMv[i]!, max - mv);
    });
    // Gleichstand zählt für keine Zelle (sonst wäre bei 0 mV Spreizung jede „schwach“)
    const lows = cells.map((v, i) => (v === min ? i : -1)).filter((i) => i >= 0);
    if (lows.length === 1) lowestCount[lows[0]]++;
  }
  return {
    cells: n,
    endMv,
    deviationMv,
    lowestCount,
    lastMv,
    maxDuringCharge: done
      .filter((e) => e.maxCellDeltaMv != null)
      .map((e) => ({ x: e.startedAt, y: e.maxCellDeltaMv as number })),
    sessions: withCells.length,
    lagMv,
    minMv,
    maxMv,
    maxLagMv,
    lastSpreadMv,
  };
}
