/**
 * Länder-Nutzung: beim ersten Start einmalig das Land der GPS-Position
 * vorschlagen („Land erkannt“). Fragt keine Standort-Berechtigung an – erst
 * wenn sie (z. B. über die Planung) erteilt ist, wird geprüft (bis 30 min).
 * Ist das Land schon aktiv (z. B. Deutschland), gibt es keinen Dialog.
 */
import { useEffect } from "react";
import { Alert } from "react-native";
import * as Location from "@/lib/location";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";
import {
  getCountryUsage,
  loadCountryUsage,
  markCountryPromptDone,
  needsCountryPrompt,
  usageCountryLabel,
} from "@/lib/countryUsage";
import { applyCountryUsage } from "@/lib/countryUsageData";

const RETRY_MS = 60_000;
const GIVE_UP_AFTER_MS = 30 * 60_000;

export function CountryUsagePrompt(): null {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const attempt = async () => {
      if (cancelled) return;
      await loadCountryUsage().catch(() => {});
      if (!needsCountryPrompt()) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = (await Location.getLastKnownPositionAsync().catch(() => null)) ?? (await Location.getCurrentPositionAsync({}).catch(() => null));
          if (pos && !cancelled) {
            const raw = detectCountryFromCoordinates(pos.coords.latitude, pos.coords.longitude);
            const usage = getCountryUsage(raw);
            await markCountryPromptDone();
            if (raw && usage === "off") {
              const label = usageCountryLabel(raw);
              Alert.alert(
                "Land erkannt",
                `Du bist in ${label}. Geozonen für ${label} sind derzeit deaktiviert.\n\n` +
                  "Online: Zonen werden bei Bedarf für den betrachteten Bereich abgefragt.\n" +
                  "Offline: alle Daten des Landes werden gespeichert und automatisch aktualisiert (große Pakete im WLAN).\n\n" +
                  "Später änderbar unter Einstellungen → Länder & Offline-Daten.",
                [
                  { text: "Nicht jetzt", style: "cancel" },
                  { text: "Online", onPress: () => void applyCountryUsage(raw, "online").catch(() => {}) },
                  { text: "Offline", onPress: () => void applyCountryUsage(raw, "offline").catch(() => {}) },
                ],
              );
            }
            return;
          }
        }
      } catch {}
      if (Date.now() - started < GIVE_UP_AFTER_MS) timer = setTimeout(attempt, RETRY_MS);
    };
    timer = setTimeout(attempt, 3000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
