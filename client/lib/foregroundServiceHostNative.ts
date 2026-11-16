/**
 * Android-Backend des gemeinsamen Vordergrunddienstes
 * (react-native-background-actions, siehe foregroundServiceHost.ts).
 *
 * Die Daueranzeige wird nach jedem Start/Update auf den stillen Kanal
 * (IMPORTANCE_MIN, ohne Abzeichen) umgehängt – keine Benachrichtigungs-Flut.
 */
import type BackgroundServiceType from "react-native-background-actions";
import { restyleServiceNotification } from "@/lib/alertOverlay";
import {
  createForegroundServiceHost,
  type ForegroundServiceHost,
} from "@/lib/foregroundServiceHost";

// Erst bei Bedarf laden: das Modul erzeugt beim Import einen NativeEventEmitter
let bgService: typeof BackgroundServiceType | null = null;
function backgroundService(): typeof BackgroundServiceType {
  if (!bgService) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-background-actions");
    bgService = (mod.default ?? mod) as typeof BackgroundServiceType;
  }
  return bgService;
}

const TASK_NAME = "CopterPilotRadarMonitor";

export const foregroundServiceHost: ForegroundServiceHost =
  createForegroundServiceHost(
    {
      async start(task, opts) {
        await backgroundService().start(task, {
          taskName: TASK_NAME,
          taskTitle: opts.title,
          taskDesc: opts.description,
          taskIcon: { name: "ic_launcher", type: "mipmap" },
          color: "#0E2132",
          linkingURI: opts.linkingURI,
          foregroundServiceType: opts.types,
        });
        restyleServiceNotification();
      },
      async stop() {
        const svc = backgroundService();
        if (svc.isRunning()) await svc.stop();
      },
      async update(opts) {
        const svc = backgroundService();
        if (!svc.isRunning() || typeof svc.updateNotification !== "function")
          return;
        await svc.updateNotification({
          taskTitle: opts.title,
          taskDesc: opts.description,
          linkingURI: opts.linkingURI,
        });
        restyleServiceNotification();
      },
    },
    (m) => console.warn(m),
  );
