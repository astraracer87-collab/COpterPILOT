import * as Location from "expo-location";
import { BackgroundJobs } from "@/lib/background/service";
import { ensureTrafficChannel } from "@/lib/background/notifications";

/**
 * Öffentliche Steuerung der Verkehrsüberwachung im Hintergrund (Annäherungsalarm,
 * während z. B. DJI Fly im Vordergrund ist). Nutzt den gemeinsamen Vordergrunddienst
 * und braucht Hintergrund-Standort.
 */
export interface EnableResult {
  ok: boolean;
  message?: string;
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
  return { ok: true };
}

export async function disableBackgroundTraffic(): Promise<void> {
  await BackgroundJobs.setTraffic(false);
}

export function isBackgroundTrafficOn(): boolean {
  return BackgroundJobs.isTraffic();
}
