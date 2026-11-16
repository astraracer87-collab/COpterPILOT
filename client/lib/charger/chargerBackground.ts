/**
 * Entscheidungslogik „Ladegerät im Hintergrund loggen“ (rein, testbar).
 *
 * Einstellung (Nutzer-Entscheidung):
 *   - „Immer fragen“ (Standard): Verlässt man den Ladegerät-Bildschirm
 *     (oder die App per Zurück), während ein Ladevorgang läuft, kommt die
 *     Frage „Ladevorgang läuft – im Hintergrund weiter loggen?“ mit
 *     „Im Hintergrund loggen“ / „Beenden“ und „Auswahl merken“.
 *     Geht die App per Home-Taste in den Hintergrund, kann kein Dialog
 *     erscheinen: dann wird zur Sicherheit des Protokolls weiter geloggt.
 *   - „Immer im Hintergrund“: ohne Frage weiter loggen.
 *   - „Nie“: beim Verlassen bzw. im Hintergrund beenden.
 * Ohne laufenden Ladevorgang wird nie im Hintergrund geloggt.
 */
import { IsdtSlotState } from "./ma331Protocol";

export type ChargerBackgroundMode = "ask" | "always" | "never";
export const DEFAULT_CHARGER_BACKGROUND_MODE: ChargerBackgroundMode = "ask";

export const CHARGER_BACKGROUND_SETTING_TITLE =
  "Ladegerät im Hintergrund loggen";
export const CHARGER_BACKGROUND_MODE_LABELS: Record<
  ChargerBackgroundMode,
  string
> = {
  ask: "Immer fragen",
  always: "Immer im Hintergrund",
  never: "Nie",
};
export const CHARGER_BACKGROUND_HELP =
  "Läuft ein Ladevorgang, kann COpter Pilot das Ladegerät im Hintergrund weiter loggen (stille Daueranzeige „Ladegerät wird geloggt“). " +
  "„Immer fragen“: Beim Verlassen des Ladegerät-Bildschirms kommt eine Rückfrage. Wechselst du mit der Home-Taste in eine andere App, " +
  "kann keine Rückfrage erscheinen – dann wird zur Sicherheit weiter geloggt. Das Loggen endet automatisch, wenn 10 Minuten lang kein Akku lädt " +
  "oder die Verbindung dauerhaft verloren ist.";

export const LEAVE_DIALOG_TITLE =
  "Ladevorgang läuft – im Hintergrund weiter loggen?";
export const LEAVE_DIALOG_CONTINUE = "Im Hintergrund loggen";
export const LEAVE_DIALOG_STOP = "Beenden";
export const LEAVE_DIALOG_REMEMBER = "Auswahl merken";
export const CHARGER_SERVICE_TITLE = "Ladegerät wird geloggt";

export type LeaveDecision = "continue" | "stop" | "ask";

export function parseBackgroundMode(
  raw: string | null | undefined,
): ChargerBackgroundMode {
  return raw === "always" || raw === "never" || raw === "ask"
    ? raw
    : DEFAULT_CHARGER_BACKGROUND_MODE;
}

/** Ladegerät-Bildschirm verlassen / App per Zurück verlassen */
export function decideOnLeave(
  mode: ChargerBackgroundMode,
  sessionActive: boolean,
): LeaveDecision {
  if (!sessionActive) return "stop";
  if (mode === "always") return "continue";
  if (mode === "never") return "stop";
  return "ask";
}

/** App geht (Home-Taste o. Ä.) in den Hintergrund – kein Dialog möglich */
export function decideOnAppBackground(
  mode: ChargerBackgroundMode,
  sessionActive: boolean,
): "continue" | "stop" {
  if (!sessionActive) return "stop";
  return mode === "never" ? "stop" : "continue";
}

/** Antwort im Dialog; mit „Auswahl merken“ wird die Einstellung gesetzt */
export function resolveLeaveDialog(
  choice: "continue" | "stop",
  remember: boolean,
): { action: "continue" | "stop"; newMode: ChargerBackgroundMode | null } {
  return {
    action: choice,
    newMode: remember ? (choice === "continue" ? "always" : "never") : null,
  };
}

export const IDLE_AUTO_STOP_MS = 10 * 60_000;

/** Schacht ohne Arbeit: leer, bereit, voll oder Fehler */
export function isSlotIdle(state: number): boolean {
  return (
    state === IsdtSlotState.Empty ||
    state === IsdtSlotState.Standby ||
    state === IsdtSlotState.Full ||
    state === IsdtSlotState.Error
  );
}

export type AutoStopReason = "idle" | "connection-lost";

/**
 * Hintergrund-Loggen automatisch beenden?
 *  - alle Schächte seit ≥ 10 min ohne Arbeit (idleSince = seit wann alle frei)
 *  - Verbindung seit ≥ maxDisconnectedMs weg bzw. Fehlversuche ≥ maxFailures
 */
export function shouldAutoStop(p: {
  now: number;
  idleSince: number | null;
  activeSessions: number;
  disconnectedSince: number | null;
  failures: number;
  maxFailures?: number;
  maxDisconnectedMs?: number;
}): AutoStopReason | null {
  const maxFailures = p.maxFailures ?? 8;
  const maxDisc = p.maxDisconnectedMs ?? 5 * 60_000;
  if (
    p.disconnectedSince != null &&
    (p.failures >= maxFailures || p.now - p.disconnectedSince >= maxDisc)
  )
    return "connection-lost";
  if (
    p.activeSessions === 0 &&
    p.idleSince != null &&
    p.now - p.idleSince >= IDLE_AUTO_STOP_MS
  )
    return "idle";
  return null;
}
