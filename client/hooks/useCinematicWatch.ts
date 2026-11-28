/**
 * Cinematic-Vorschau: Wolkenmeer-Prüfung an der App-Wurzel – kurz nach dem
 * Start, bei Rückkehr in die App und stündlich, solange die App läuft.
 * runCinematicCheck drosselt selbst (höchstens stündlich) und tut nichts,
 * solange die Benachrichtigung ausgeschaltet ist.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { runCinematicCheck } from "@/lib/cinematicNotify";

const START_DELAY_MS = 20_000;
const INTERVAL_MS = 60 * 60 * 1000;

export function useCinematicWatch(): void {
  useEffect(() => {
    const start = setTimeout(() => void runCinematicCheck(), START_DELAY_MS);
    const timer = setInterval(() => void runCinematicCheck(), INTERVAL_MS);
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "active") void runCinematicCheck();
    });
    return () => {
      clearTimeout(start);
      clearInterval(timer);
      sub.remove();
    };
  }, []);
}
