import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BackgroundJobs } from "@/lib/background/service";
import { ensureTrafficChannel } from "@/lib/background/notifications";

/**
 * Öffentliche Steuerung der Verkehrsüberwachung im Hintergrund (Annäherungsalarm,
 * während z. B. DJI Fly im Vordergrund ist). Nutzt den gemeinsamen Vordergrunddienst
 * und braucht Hintergrund-Standort.
 *
 * Die Einstellung wird dauerhaft gespeichert und beim App-Start automatisch wieder
 * aktiviert (resumeBackgroundTrafficIfEnabled), damit man sie nicht jedes Mal
 * von Hand einschalten muss.
 */
const STORAGE_KEY = "bgTrafficEnabled";

export interface EnableResult {
  ok: boolean;
  message?: string;
}

async function persist(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export async function getBackgroundTrafficPreference(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function enableBackgroundTraffic(): Promise<EnableResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, message: "Ohne Standort-Berechtigung nicht möglich." };

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) {
    return {
      ok: false,
      message:
        "Für den Hintergrundbetrieb muss der Standort auf „Immer zulassen“ stehen (Android-Einstellungen → Berechtigungen → Standort).",
    };
  }

  await ensureTrafficChannel();
  await BackgroundJobs.setTraffic(true);
  await persist(true);
  return { ok: true };
}

export async function disableBackgroundTraffic(): Promise<void> {
  await BackgroundJobs.setTraffic(false);
  await persist(false);
}

/** Beim App-Start: war die Überwachung aktiv und ist die Berechtigung noch da, wieder starten. */
export async function resumeBackgroundTrafficIfEnabled(): Promise<void> {
  try {
    if (!(await getBackgroundTrafficPreference())) return;
    if (BackgroundJobs.isTraffic()) return;
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!fg.granted || !bg.granted) return; // Berechtigung entzogen → nicht starten
    await ensureTrafficChannel();
    await BackgroundJobs.setTraffic(true);
  } catch {
    /* ignore */
  }
}

export function isBackgroundTrafficOn(): boolean {
  return BackgroundJobs.isTraffic();
}
