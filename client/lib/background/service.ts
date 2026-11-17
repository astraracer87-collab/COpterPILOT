import BackgroundService from "react-native-background-actions";
import { Engine } from "@/lib/fcc/engine";
import { PROFILES } from "@/lib/fcc/profiles";
import { FccLog } from "@/lib/fcc/log";
import { runTrafficCheck } from "@/lib/background/traffic";

/**
 * Gemeinsamer Android-Vordergrunddienst für alle Hintergrund-Aufgaben.
 * react-native-background-actions erlaubt nur EINEN Hintergrund-Task – deshalb
 * laufen FCC-Halten und Verkehrsüberwachung in derselben Schleife, je nach Schalter.
 */
const INTERVAL_MS = 2000;

let fccHold = false;
let traffic = false;
let keepAwakeCount = 0;
let fccAppliedFull = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function statusText(): string {
  const parts: string[] = [];
  if (fccHold) parts.push("FCC halten");
  if (traffic) parts.push("Verkehr überwachen");
  if (keepAwakeCount > 0) parts.push("Download läuft");
  return parts.join(" · ") || "aktiv";
}

const task = async () => {
  let count = 0;
  while (BackgroundService.isRunning()) {
    let desc = statusText();
    try {
      if (fccHold) {
        const port = await Engine.port(true);
        if (port != null) {
          if (!fccAppliedFull) {
            const o = await Engine.runProfile(port, PROFILES.fcc);
            Engine.lastMode = "FCC";
            FccLog.ok(`FCC gesetzt (${o.sent}/${o.total} Befehle).`);
            fccAppliedFull = true;
          } else {
            await Engine.runProfile(port, PROFILES.keepalive);
          }
        }
      }
      if (traffic) {
        desc = await runTrafficCheck();
      }
      await BackgroundService.updateNotification({ taskDesc: desc });
    } catch {
      /* Schleife robust halten */
    }
    count++;
    await sleep(INTERVAL_MS);
  }
};

const OPTIONS = {
  taskName: "CopterBackground",
  taskTitle: "COpterPilot läuft im Hintergrund",
  taskDesc: "aktiv",
  taskIcon: { name: "ic_launcher", type: "mipmap" },
  color: "#0A4D8C",
  linkingURI: "copterpilot://",
};

async function sync(): Promise<void> {
  const anyOn = fccHold || traffic || keepAwakeCount > 0;
  if (anyOn && !BackgroundService.isRunning()) {
    await BackgroundService.start(task, OPTIONS);
  } else if (!anyOn && BackgroundService.isRunning()) {
    await BackgroundService.stop();
  } else if (BackgroundService.isRunning()) {
    try {
      await BackgroundService.updateNotification({ taskDesc: statusText() });
    } catch {
      /* ignore */
    }
  }
}

export const BackgroundJobs = {
  isRunning: () => BackgroundService.isRunning(),
  isFccHold: () => fccHold,
  isTraffic: () => traffic,
  async setFccHold(on: boolean) {
    fccHold = on;
    if (on) fccAppliedFull = false;
    await sync();
  },
  async setTraffic(on: boolean) {
    traffic = on;
    await sync();
  },
  /**
   * Hält den Prozess wach, solange z. B. ein Länder-Download läuft, damit er im
   * Hintergrund nicht einfriert. Als Zähler, falls mehrere Downloads parallel laufen.
   */
  async acquireKeepAwake() {
    keepAwakeCount++;
    await sync();
  },
  async releaseKeepAwake() {
    keepAwakeCount = Math.max(0, keepAwakeCount - 1);
    await sync();
  },
};
