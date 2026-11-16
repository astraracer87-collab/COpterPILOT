/**
 * Gemeinsamer Verkehrs-Warnzustand für die Anzeige (Radar-Tab: Zähl-Badge und
 * Ring). RN-frei. Zwei Quellen melden hier ihre aktuelle Lage:
 *  - "foreground": Radar-Screen (useProximityAlarm) bei jeder Auswertung
 *  - "background": Hintergrund-Überwachung (radarMonitor) bei jedem Durchlauf
 * Sichtbar ist das Maximum beider (beide sehen denselben Luftraum; eine Quelle,
 * die nicht mehr auswertet, meldet „leer“ – Screen verlassen, Überwachung
 * gestoppt oder App wieder im Vordergrund).
 *
 * Gezählt werden Luftfahrzeuge in TA oder RA – auch quittierte, solange sie in
 * der Zone sind (`acknowledged` = davon quittiert, Badge wird dann gedimmt).
 * Reiner Anflug (noch kein TA/RA) zählt nicht.
 */
import type { AircraftState } from "./opensky";
import type { AlertAckState, AlertLevel, ProximityLevel } from "./radarAlertLogic";

export interface TrafficAlertState {
  /** Stärkste aktuelle Warnung */
  level: ProximityLevel;
  /** Luftfahrzeuge in TA oder RA */
  count: number;
  /** davon quittiert (Einblendung „Quittieren“ bzw. Banner weggedrückt) */
  acknowledged: number;
}

export type TrafficAlertSource = "foreground" | "background";

export const EMPTY_TRAFFIC_ALERT_STATE: TrafficAlertState = { level: "none", count: 0, acknowledged: 0 };

const RANK: Record<ProximityLevel, number> = { none: 0, warning: 1, critical: 2 };

/**
 * Zusammenfassung der UNGEFILTERTEN Treffer (checkProximityAlerts): Anzahl je
 * Luftfahrzeug, stärkste Stufe, wie viele davon quittiert sind.
 */
export function summarizeTrafficAlerts(
  rawAlerts: readonly { aircraft: Pick<AircraftState, "icao24">; level: AlertLevel }[],
  acks?: AlertAckState | null,
): TrafficAlertState {
  const best = new Map<string, ProximityLevel>();
  for (const a of rawAlerts) {
    if (a.level !== "warning" && a.level !== "critical") continue;
    const prev = best.get(a.aircraft.icao24) ?? "none";
    if (RANK[a.level] > RANK[prev]) best.set(a.aircraft.icao24, a.level);
  }
  let level: ProximityLevel = "none";
  let acknowledged = 0;
  for (const [key, l] of best) {
    if (RANK[l] > RANK[level]) level = l;
    if (acks?.acked.has(key)) acknowledged++;
  }
  return { level, count: best.size, acknowledged };
}

/** Maximum zweier Lagen (Anzeige) */
export function mergeTrafficAlertStates(a: TrafficAlertState, b: TrafficAlertState): TrafficAlertState {
  if (a.count === 0 && a.level === "none") return b;
  if (b.count === 0 && b.level === "none") return a;
  const main = a.count >= b.count ? a : b;
  return {
    level: RANK[a.level] >= RANK[b.level] ? a.level : b.level,
    count: main.count,
    acknowledged: main.acknowledged,
  };
}

const sources: Record<TrafficAlertSource, TrafficAlertState> = {
  foreground: EMPTY_TRAFFIC_ALERT_STATE,
  background: EMPTY_TRAFFIC_ALERT_STATE,
};
let current: TrafficAlertState = EMPTY_TRAFFIC_ALERT_STATE;
const listeners = new Set<(s: TrafficAlertState) => void>();

function same(a: TrafficAlertState, b: TrafficAlertState): boolean {
  return a.level === b.level && a.count === b.count && a.acknowledged === b.acknowledged;
}

export function publishTrafficAlerts(source: TrafficAlertSource, state: TrafficAlertState): void {
  sources[source] = state;
  const next = mergeTrafficAlertStates(sources.foreground, sources.background);
  if (same(next, current)) return;
  current = next;
  for (const l of listeners) {
    try {
      l(current);
    } catch {
      /* Listener-Fehler ignorieren */
    }
  }
}

export function clearTrafficAlerts(source: TrafficAlertSource): void {
  publishTrafficAlerts(source, EMPTY_TRAFFIC_ALERT_STATE);
}

export function getTrafficAlertState(): TrafficAlertState {
  return current;
}

/** Meldet sofort den aktuellen Stand, danach jede Änderung */
export function subscribeTrafficAlertState(l: (s: TrafficAlertState) => void): () => void {
  listeners.add(l);
  l(current);
  return () => {
    listeners.delete(l);
  };
}

// ---------------------------------------------------------------------------
// Darstellung im Radar-Tab (rein, testbar)
// ---------------------------------------------------------------------------

export const TA_COLOR = "#FF9500";
export const RA_COLOR = "#E0001B";

export interface RadarTabBadge {
  visible: boolean;
  /** Zahl im Badge („1“, „2“, … „99+“) */
  text: string;
  /** Badge- und Ringfarbe: orange TA, rot RA */
  color: string | null;
  /** Alle gezählten Luftfahrzeuge quittiert → gedimmt */
  dimmed: boolean;
  /** Halbe Periode des Pulses (ms): RA schnelles Blinken, TA langsam */
  pulseMs: number | null;
}

export function radarTabBadge(s: TrafficAlertState): RadarTabBadge {
  if (s.count <= 0 || s.level === "none") {
    return { visible: false, text: "", color: null, dimmed: false, pulseMs: null };
  }
  const critical = s.level === "critical";
  const dimmed = s.acknowledged >= s.count;
  return {
    visible: true,
    text: s.count > 99 ? "99+" : String(s.count),
    color: critical ? RA_COLOR : TA_COLOR,
    dimmed,
    // Quittiert: ruhig (kein Blinken), Ring bleibt sichtbar
    pulseMs: dimmed ? null : critical ? 280 : 1100,
  };
}

export function __resetTrafficAlertStoreForTests(): void {
  sources.foreground = EMPTY_TRAFFIC_ALERT_STATE;
  sources.background = EMPTY_TRAFFIC_ALERT_STATE;
  current = EMPTY_TRAFFIC_ALERT_STATE;
  listeners.clear();
}
