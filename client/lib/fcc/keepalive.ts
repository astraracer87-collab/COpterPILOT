import BackgroundService from "react-native-background-actions";
import { Engine } from "@/lib/fcc/engine";
import { PROFILES } from "@/lib/fcc/profiles";
import { FccLog } from "@/lib/fcc/log";

/**
 * Hält den FCC-Modus über einen Android-Vordergrunddienst: einmal das volle Profil,
 * danach alle 2 s die kurze Keepalive-Folge. Läuft auch im Hintergrund weiter, während
 * DJI Fly im Vordergrund ist. Nach dem Ausschalten des Fluggeräts ist FCC ohnehin weg.
 */
const INTERVAL_MS = 2000;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const task = async () => {
  FccLog.step("FCC halten gestartet (erneuert alle 2 s)");
  let appliedFull = false;
  let count = 0;
  while (BackgroundService.isRunning()) {
    try {
      const port = await Engine.port(true);
      if (port != null) {
        if (!appliedFull) {
          const o = await Engine.runProfile(port, PROFILES.fcc);
          Engine.lastMode = "FCC";
          FccLog.ok(`FCC gesetzt (${o.sent}/${o.total} Befehle). Kontrolle: DJI Fly → Übertragung.`);
          appliedFull = true;
        } else {
          await Engine.runProfile(port, PROFILES.keepalive);
          if (++count % 30 === 0) FccLog.detail(`FCC halten läuft (${count} Zyklen)`);
        }
      }
      await sleep(port == null ? 10000 : INTERVAL_MS);
    } catch (e) {
      FccLog.warn(`FCC halten: ${String(e)}`);
      await sleep(5000);
    }
  }
  FccLog.step("FCC halten gestoppt");
};

const OPTIONS = {
  taskName: "FccKeepalive",
  taskTitle: "FCC-Modus aktiv",
  taskDesc: "Wird im Hintergrund alle 2 Sekunden erneuert",
  taskIcon: { name: "ic_launcher", type: "mipmap" },
  color: "#0A4D8C",
  linkingURI: "copterpilot://fcc",
};

export const Keepalive = {
  isRunning: () => BackgroundService.isRunning(),
  async start() {
    if (BackgroundService.isRunning()) return;
    await BackgroundService.start(task, OPTIONS);
  },
  async stop() {
    if (BackgroundService.isRunning()) await BackgroundService.stop();
  },
};
