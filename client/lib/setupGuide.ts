import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isValidSetupGuideStatus,
  setupGuideKey,
  type SetupGuideStatus,
} from "./setupGuideKey";

export type { SetupGuideStatus } from "./setupGuideKey";
export { shouldOfferSetupGuide, isValidSetupGuideStatus } from "./setupGuideKey";

/**
 * Gerätegebundener Status + inhaltsbasierte Heuristik. Früher kam beides vom
 * Server (konto-gebunden); ohne Backend liegt der Status lokal in AsyncStorage.
 */
export interface ServerSetupGuideState {
  status: SetupGuideStatus | null;
  hasContent: boolean;
}

const LOCAL_STATE_KEY = "@setupGuide/state_local";

/**
 * Liest den lokal gespeicherten Status plus die Heuristik, ob bereits
 * relevante Daten (Drohnen, Profil, Flüge …) auf dem Gerät vorhanden sind.
 */
export async function fetchSetupGuideState(): Promise<ServerSetupGuideState> {
  let status: SetupGuideStatus | null = null;
  try {
    const value = await AsyncStorage.getItem(LOCAL_STATE_KEY);
    status = isValidSetupGuideStatus(value) ? value : null;
  } catch {
    status = null;
  }
  let hasContent = false;
  try {
    // Lazy import, um Zyklen mit storage.ts zu vermeiden.
    const { hasLocalUserData } = await import("./storage");
    hasContent = await hasLocalUserData();
  } catch {
    hasContent = false;
  }
  return { status, hasContent };
}

/**
 * Persistiert den Status lokal (Ersatz für den früheren Server-Endpunkt).
 * Best-effort: Fehler werden geloggt, aber nicht eskaliert.
 */
export async function persistServerSetupGuideStatus(
  status: SetupGuideStatus,
): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_STATE_KEY, status);
  } catch (e) {
    console.warn("[setupGuide] Status konnte nicht lokal gespeichert werden:", e);
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
