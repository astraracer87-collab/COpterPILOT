import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiJson } from "./api-client";
import {
  isValidSetupGuideStatus,
  setupGuideKey,
  type SetupGuideStatus,
} from "./setupGuideKey";

export type { SetupGuideStatus } from "./setupGuideKey";
export { shouldOfferSetupGuide, isValidSetupGuideStatus } from "./setupGuideKey";

/**
 * Konto-gebundener Status + inhaltsbasierte Heuristik vom Server. Quelle der
 * Wahrheit für „schon erledigt/übersprungen" sowie „Konto hat bereits Daten".
 */
export interface ServerSetupGuideState {
  status: SetupGuideStatus | null;
  hasContent: boolean;
}

/**
 * Liest den konto-gebundenen Status (geräteunabhängig) plus die Heuristik, ob
 * das Konto bereits relevante Daten hat. Nur für angemeldete Nutzer sinnvoll.
 */
export async function fetchSetupGuideState(): Promise<ServerSetupGuideState> {
  const data = await apiJson<{ status?: unknown; hasContent?: unknown }>(
    "/api/setup-guide/state",
  );
  return {
    status: isValidSetupGuideStatus(data?.status) ? data.status : null,
    hasContent: data?.hasContent === true,
  };
}

/**
 * Persistiert den Status konto-gebunden auf dem Server. Best-effort: Fehler
 * werden geloggt, aber nicht eskaliert (der lokale Status greift als Fallback).
 */
export async function persistServerSetupGuideStatus(
  status: SetupGuideStatus,
): Promise<void> {
  try {
    await apiJson("/api/setup-guide/status", { method: "POST", body: { status } });
  } catch (e) {
    console.warn("[setupGuide] Server-Status konnte nicht gespeichert werden:", e);
  }
}

export async function getSetupGuideStatus(
  userId?: string | null,
): Promise<SetupGuideStatus | null> {
  try {
    const value = await AsyncStorage.getItem(setupGuideKey(userId));
    return isValidSetupGuideStatus(value) ? value : null;
  } catch {
    return null;
  }
}

export async function setSetupGuideStatus(
  status: SetupGuideStatus,
  userId?: string | null,
): Promise<void> {
  try {
    await AsyncStorage.setItem(setupGuideKey(userId), status);
  } catch {
    // Persistenz des Onboarding-Status ist best-effort — Fehler nicht eskalieren.
  }
}

/**
 * Kleiner Event-Bus, damit der Einrichtungs-Assistent aus den Einstellungen
 * heraus erneut gestartet werden kann, ohne dass die Settings-Screen direkt
 * an den Overlay-State gekoppelt ist.
 */
type Listener = () => void;
let listeners: Listener[] = [];

export const setupGuideController = {
  launch() {
    listeners.forEach((l) => {
      try {
        l();
      } catch {
        // Listener-Fehler dürfen andere Listener nicht blockieren.
      }
    });
  },
  subscribe(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  },
};
