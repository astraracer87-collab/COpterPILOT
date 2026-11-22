/**
 * Ob der Nutzer das eingebundene Ladegerät (ISDT MA331) besitzt. Aus →
 * Akkus-Reiter in der unteren Leiste ausgeblendet, keine Verbindung/kein
 * Hintergrund-Loggen. Standard: an.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "feature:chargerEnabled";
let current: boolean | null = null;
const listeners = new Set<(on: boolean) => void>();

export async function loadChargerFeatureEnabled(): Promise<boolean> {
  if (current != null) return current;
  try {
    const v = await AsyncStorage.getItem(KEY);
    current = v !== "0";
  } catch {
    current = true;
  }
  return current;
}

export function peekChargerFeatureEnabled(): boolean {
  return current ?? true;
}

export async function setChargerFeatureEnabled(on: boolean): Promise<void> {
  current = on;
  listeners.forEach((fn) => fn(on));
  try {
    await AsyncStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Anzeige bleibt; beim nächsten Start gilt wieder der gespeicherte Wert
  }
}

export function subscribeChargerFeature(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
