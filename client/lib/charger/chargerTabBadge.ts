/**
 * Badge des „Akkus“-Tabs (reine Logik, wie radarTabBadge).
 *
 * Das Symbol ist immer der gleiche Akku (Feather „battery“). Der Zustand steht
 * in einem kleinen runden Badge oben rechts (gleiche Größe/Position wie die
 * Zähl-Badges von NOTAM/Radar):
 *   nicht verbunden → kein Badge
 *   verbindet       → gelb #FFD60A, pulsiert, leer
 *   verbunden       → grün, leer
 *   lädt            → grün mit Blitz (Feather „zap“, weiß)
 *   Warnung         → rot mit „!“ (Übertemperatur, zu kalt, Fehler), pulsiert wie RA
 * Vorrang: Warnung > lädt > verbunden > verbindet.
 */
import { IsdtSlotState } from "./ma331Protocol";

export const BADGE_YELLOW = "#FFD60A";
export const BADGE_GREEN = "#34C759";
export const BADGE_RED = "#FF3B30";

export type ChargerBadgeKind =
  | "none"
  | "connecting"
  | "connected"
  | "charging"
  | "warning";

export interface ChargerTabBadge {
  kind: ChargerBadgeKind;
  visible: boolean;
  color: string | null;
  /** Inhalt: Feather-Symbol oder Text */
  icon: "zap" | null;
  text: string;
  /** Halbe Pulsperiode in ms (null = ruhig) */
  pulseMs: number | null;
}

export interface ChargerBadgeInput {
  connected: boolean;
  connecting: boolean;
  slotStates: number[];
}

export function chargerTabBadge(i: ChargerBadgeInput): ChargerTabBadge {
  if (i.connected) {
    const warn = i.slotStates.some(
      (s) =>
        s === IsdtSlotState.Error ||
        s === IsdtSlotState.OverTemp ||
        s === IsdtSlotState.UnderTemp,
    );
    if (warn)
      return {
        kind: "warning",
        visible: true,
        color: BADGE_RED,
        icon: null,
        text: "!",
        pulseMs: 280,
      };
    if (i.slotStates.some((s) => s === IsdtSlotState.Charging))
      return {
        kind: "charging",
        visible: true,
        color: BADGE_GREEN,
        icon: "zap",
        text: "",
        pulseMs: null,
      };
    return {
      kind: "connected",
      visible: true,
      color: BADGE_GREEN,
      icon: null,
      text: "",
      pulseMs: null,
    };
  }
  if (i.connecting)
    return {
      kind: "connecting",
      visible: true,
      color: BADGE_YELLOW,
      icon: null,
      text: "",
      pulseMs: 700,
    };
  return {
    kind: "none",
    visible: false,
    color: null,
    icon: null,
    text: "",
    pulseMs: null,
  };
}
