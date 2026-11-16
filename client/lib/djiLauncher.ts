// DJI-App (DJI Fly bzw. DJI Pilot 2) aus unserer App heraus öffnen.
// Android 11+: Die Pakete müssen im Manifest unter <queries> stehen (plugins/withDjiAppQueries.js).
import { Platform } from "react-native";

/** Reihenfolge = Priorität: DJI Fly zuerst, sonst DJI Pilot 2. */
export const DJI_APP_PACKAGES = [
  { pkg: "dji.go.v5", label: "DJI Fly" },
  { pkg: "dji.pilot2", label: "DJI Pilot 2" },
] as const;

export interface InstalledDjiApp {
  pkg: string;
  label: string;
  /** App-Symbol des installierten Pakets als data-URI (oder null). */
  iconUri: string | null;
}

type Launcher = {
  openApplication: (pkg: string) => void;
  getApplicationIconAsync: (pkg: string) => Promise<string>;
};

function loadLauncher(): Launcher | null {
  if (Platform.OS !== "android") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-intent-launcher") as Launcher;
  } catch {
    return null;
  }
}

/** Sucht die erste installierte DJI-App. getApplicationIconAsync wirft, wenn das Paket fehlt. */
export async function findInstalledDjiApp(launcher: Launcher | null = loadLauncher()): Promise<InstalledDjiApp | null> {
  if (!launcher) return null;
  for (const app of DJI_APP_PACKAGES) {
    try {
      const icon = await launcher.getApplicationIconAsync(app.pkg);
      return { pkg: app.pkg, label: app.label, iconUri: icon ? (icon.startsWith("data:") ? icon : `data:image/png;base64,${icon}`) : null };
    } catch {
      // nicht installiert → nächstes Paket
    }
  }
  return null;
}

/** Öffnet die DJI-App. Gibt false zurück, wenn das nicht möglich war. */
export function launchDjiApp(pkg: string, launcher: Launcher | null = loadLauncher()): boolean {
  if (!launcher) return false;
  try {
    launcher.openApplication(pkg);
    return true;
  } catch {
    return false;
  }
}
