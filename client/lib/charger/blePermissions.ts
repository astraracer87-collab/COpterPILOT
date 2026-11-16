/**
 * Bluetooth-Berechtigungen für das Ladegerät (Android).
 *
 * Android 11 (API 30, DJI RC Pro 2): BLUETOOTH + BLUETOOTH_ADMIN sind
 * Installations-Berechtigungen; Scannen braucht ZUR LAUFZEIT
 * ACCESS_FINE_LOCATION und eingeschaltete Standortdienste (sonst liefert der
 * Scan nichts). Android 12+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT zur Laufzeit.
 */
import { PermissionsAndroid, Platform, type Permission } from "react-native";

export type BlePermissionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "denied" | "blocked" | "unsupported";
      message: string;
    };

const P = PermissionsAndroid.PERMISSIONS;

export async function hasBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const needed = requiredPermissions();
    for (const p of needed)
      if (!(await PermissionsAndroid.check(p))) return false;
    return true;
  } catch {
    return false;
  }
}

function requiredPermissions(): Permission[] {
  const v =
    typeof Platform.Version === "number"
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
  if (v >= 31)
    return [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT].filter(
      Boolean,
    ) as Permission[];
  return [P.ACCESS_FINE_LOCATION];
}

export async function requestBlePermissions(): Promise<BlePermissionResult> {
  if (Platform.OS !== "android")
    return {
      ok: false,
      reason: "unsupported",
      message: "Das Ladegerät wird nur auf Android unterstützt.",
    };
  const v =
    typeof Platform.Version === "number"
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
  try {
    if (v >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        P.BLUETOOTH_SCAN,
        P.BLUETOOTH_CONNECT,
      ] as Permission[]);
      const vals = Object.values(res);
      if (vals.every((r) => r === PermissionsAndroid.RESULTS.GRANTED))
        return { ok: true };
      const blocked = vals.some(
        (r) => r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
      );
      return {
        ok: false,
        reason: blocked ? "blocked" : "denied",
        message: blocked
          ? "„Geräte in der Nähe“ ist für COpter Pilot gesperrt. Bitte in den App-Einstellungen erlauben."
          : "Ohne „Geräte in der Nähe“ kann COpter Pilot das Ladegerät nicht finden.",
      };
    }
    const r = await PermissionsAndroid.request(P.ACCESS_FINE_LOCATION, {
      title: "Standort für Bluetooth",
      message:
        "Android 11 erlaubt die Suche nach Bluetooth-Geräten nur mit Standort-Berechtigung. COpter Pilot nutzt sie hier nur, um das ISDT-Ladegerät zu finden.",
      buttonPositive: "Erlauben",
      buttonNegative: "Nicht jetzt",
    });
    if (r === PermissionsAndroid.RESULTS.GRANTED) return { ok: true };
    return {
      ok: false,
      reason:
        r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? "blocked" : "denied",
      message:
        r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ? "Standort ist für COpter Pilot gesperrt. Bitte in den App-Einstellungen erlauben – ohne Standort findet Android 11 keine Bluetooth-Geräte."
          : "Ohne Standort-Berechtigung findet Android 11 keine Bluetooth-Geräte.",
    };
  } catch (e) {
    return {
      ok: false,
      reason: "denied",
      message: `Berechtigung: ${(e as Error)?.message ?? e}`,
    };
  }
}

/** Standortdienste an? (Android ≤ 11: ohne sie liefert der BLE-Scan nichts) */
export async function isLocationServiceOn(): Promise<boolean | null> {
  if (Platform.OS !== "android") return null;
  const v =
    typeof Platform.Version === "number"
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
  if (v >= 31) return null; // ab Android 12 nicht nötig (BLUETOOTH_SCAN)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoLocation = require("expo-location");
    return (await ExpoLocation.hasServicesEnabledAsync()) === true;
  } catch {
    return null;
  }
}

export const LOCATION_OFF_HINT =
  "Standort ist ausgeschaltet. Android 11 findet Bluetooth-Geräte nur mit eingeschaltetem Standort (Schnelleinstellungen → Standort).";
