// Teil A: Urteil darf durch nachgeladene Geozonen-Daten nie still kippen.
//
// Planung und Pre-Check antworten sofort aus dem lokalen Bestand; lädt die
// Hintergrund-Aktualisierung neue Daten (z. B. eine neue temporäre Zone),
// wird neu ausgewertet. Ändert sich dabei das Urteil (in JEDE Richtung – auch
// zu GO), erscheint ein deutlicher Hinweis.
//
// Ablauf (Reducer, unabhängig von React):
//  - "evaluated": aktuelles Urteil samt Datenstand-Version, auf der es beruht
//  - "data-changed": neue Daten eingetroffen (Version erhöht) – das bisher
//    gültige Urteil wird gemerkt
//  - sobald ein Urteil zur neuen (oder neueren) Version vorliegt: Vergleich;
//    bei Abweichung Hinweis { from, to }
//
// Reines Modul (kein React Native).

import type { FlightVerdict } from "./types";

export const GEOZONE_DATA_CHANGED_TEXT = "Neue Geozonen-Daten – Prüfergebnis hat sich geändert";

const VERDICT_LABEL: Record<FlightVerdict, string> = { go: "GO", caution: "CAUTION", nogo: "NO-GO" };

export interface VerdictChange {
  from: FlightVerdict;
  to: FlightVerdict;
}

export interface VerdictWatchState {
  settled: { verdict: FlightVerdict; version: number } | null;
  pending: { verdict: FlightVerdict; version: number } | null;
  change: VerdictChange | null;
}

export type VerdictWatchAction =
  | { type: "evaluated"; verdict: FlightVerdict; version: number }
  | { type: "data-changed"; version: number }
  | { type: "dismiss" };

export const INITIAL_VERDICT_WATCH: VerdictWatchState = { settled: null, pending: null, change: null };

export function verdictWatchReducer(state: VerdictWatchState, action: VerdictWatchAction): VerdictWatchState {
  switch (action.type) {
    case "data-changed":
      if (!state.settled) return state;
      // Mehrere Änderungen hintereinander: Vergleich gegen das zuletzt GEZEIGTE Urteil.
      return { ...state, pending: { verdict: state.pending?.verdict ?? state.settled.verdict, version: action.version } };
    case "evaluated": {
      const settled = { verdict: action.verdict, version: action.version };
      if (state.pending && action.version >= state.pending.version) {
        const change = action.verdict !== state.pending.verdict ? { from: state.pending.verdict, to: action.verdict } : state.change;
        return { settled, pending: null, change };
      }
      if (state.settled && state.settled.verdict === action.verdict && state.settled.version === action.version) return state;
      return { ...state, settled };
    }
    case "dismiss":
      return { ...state, change: null };
    default:
      return state;
  }
}

/** Deutscher Hinweistext, z. B. „… (vorher CAUTION, jetzt NO-GO). Bitte Ergebnis erneut prüfen.“ */
export function verdictChangeMessage(change: VerdictChange): string {
  const toGo = change.to === "go" ? " Das bessere Ergebnis gilt erst nach erneuter Prüfung der Zonen." : "";
  return `${GEOZONE_DATA_CHANGED_TEXT} (vorher ${VERDICT_LABEL[change.from]}, jetzt ${VERDICT_LABEL[change.to]}).${toGo} Bitte Ergebnis erneut prüfen.`;
}
