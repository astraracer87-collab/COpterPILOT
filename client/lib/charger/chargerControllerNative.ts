/**
 * App-weite Instanz des Ladegerät-Loggers (Android-Verdrahtung).
 *
 *  - BLE: react-native-ble-manager (bleManagerAdapter.ts)
 *  - Speicher: chargerStore.ts (Dateien unter documentDirectory/charger/)
 *  - Hintergrund: gemeinsamer Vordergrunddienst (foregroundServiceHostNative,
 *    derselbe wie für das Radar), Typ „dataSync“, stille Daueranzeige
 *    „Ladegerät wird geloggt“.
 */
import { Alert, Linking } from "react-native";
import * as Crypto from "expo-crypto";
import { createChargerTransport } from "./bleTransport";
import { createBleManagerAdapter } from "./bleManagerAdapter";
import {
  createChargerController,
  type ChargerController,
} from "./chargerController";
import { CHARGER_SERVICE_TITLE } from "./chargerBackground";
import { foregroundServiceHost } from "@/lib/foregroundServiceHostNative";
import { ensureNotificationPermissions } from "@/lib/notifications";
import {
  chargerPairingStore,
  getBatteryLinks,
  loadActiveSessions,
  saveBatteryLinks,
  saveChargeSession,
} from "@/lib/chargerStore";

export const CHARGER_STOP_URL = "copterpilot://charger-monitor/stop";

function randomBytes(n: number): number[] {
  try {
    return Array.from(Crypto.getRandomBytes(n));
  } catch {
    return Array.from({ length: n }, () => Math.floor(Math.random() * 256));
  }
}

let idCounter = 0;
function newId(): string {
  idCounter = (idCounter + 1) % 100000;
  try {
    return Crypto.randomUUID();
  } catch {
    return `cs-${Date.now().toString(36)}-${idCounter}`;
  }
}

export const chargerController: ChargerController = createChargerController({
  createTransport: () => {
    const ble = createBleManagerAdapter();
    if (!ble) return null;
    return createChargerTransport({
      ble,
      pairing: chargerPairingStore,
      randomBytes,
      now: () => Date.now(),
      log: (m) => console.warn(m),
    });
  },
  store: {
    saveSession: saveChargeSession,
    loadActiveSessions,
    getLinks: getBatteryLinks,
    saveLinks: saveBatteryLinks,
  },
  background: {
    async start(task) {
      await ensureNotificationPermissions().catch(() => false);
      await foregroundServiceHost.acquire(
        "charger",
        task,
        {
          title: CHARGER_SERVICE_TITLE,
          description:
            "ISDT MA331 – Ladevorgang wird aufgezeichnet. Tippen zum Öffnen oder Beenden.",
          shortLabel: CHARGER_SERVICE_TITLE,
          linkingURI: CHARGER_STOP_URL,
          foregroundServiceType: "dataSync",
        },
        0,
      );
      return true;
    },
    async stop() {
      await foregroundServiceHost.release("charger");
    },
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  newId,
  log: (m) => console.warn(m),
});

// Tippen auf die Daueranzeige → Rückfrage „Loggen beenden?“
let linkingInstalled = false;
export function installChargerMonitorLinking(): void {
  if (linkingInstalled) return;
  linkingInstalled = true;
  Linking.addEventListener("url", ({ url }) => {
    if (!url || !url.startsWith(CHARGER_STOP_URL)) return;
    if (!chargerController.snapshot().backgroundActive) return;
    Alert.alert(
      "Ladegerät",
      "Loggen im Hintergrund beenden? Laufende Ladevorgänge werden bis jetzt gespeichert.",
      [
        { text: "Weiter loggen", style: "cancel" },
        {
          text: "Beenden",
          style: "destructive",
          onPress: () => void chargerController.disconnect("interrupted"),
        },
      ],
    );
  });
}
