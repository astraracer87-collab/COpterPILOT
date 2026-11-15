/**
 * Android-Verdrahtung der Hintergrund-Überwachung (Kern: radarMonitor.ts).
 *
 *  - Vordergrunddienst: react-native-background-actions 4.1.0 (kleiner
 *    HeadlessJsTaskService, keine Google Play Services; hält die JS-Laufzeit
 *    und ihre Timer im Hintergrund aktiv). Diensttyp „location“ (GPS wird
 *    fortgeschrieben; Android 14: FOREGROUND_SERVICE_LOCATION + erteilte
 *    Standort-Berechtigung, Start nur aus dem Vordergrund), ohne GPS-
 *    Verfolgung „dataSync“. Manifest: plugins/withRadarForegroundService.js.
 *  - Warnungen: lokale Benachrichtigungen über expo-notifications (ohne FCM –
 *    nur Push-Tokens brauchen Firebase), Kanal „radar-alerts“ mit Ton und
 *    Vibration, dazu der Sprachalarm aus proximityAlarm.ts wie im Vordergrund.
 *  - Position: @react-native-community/geolocation (LocationManager) über
 *    lib/location.ts. Mit Dienst-Typ „location“ genügt die Vordergrund-
 *    Berechtigung (ACCESS_FINE/COARSE_LOCATION); ACCESS_BACKGROUND_LOCATION
 *    ist NICHT nötig (Android 10+: ein Vordergrunddienst vom Typ „location“,
 *    der gestartet wird, während die App sichtbar ist, darf weiter orten).
 *  - Stopp: Tippen auf die Daueranzeige öffnet die App (Deep Link
 *    copterpilot://radar-monitor/stop) mit der Rückfrage „Überwachung
 *    beenden?“. Eigene Aktions-Knöpfe kann die Bibliothek nicht anzeigen.
 */
import { Alert, AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type BackgroundServiceType from "react-native-background-actions";
import * as Notifications from "expo-notifications";
import * as Location from "@/lib/location";
import { fetchNearbyAircraft } from "@/lib/opensky";
import { DEFAULT_PROXIMITY_ALARM, getSettings } from "@/lib/storage";
import { stopAlarmSound, triggerCriticalAlarm, triggerWarningAlarm } from "@/lib/proximityAlarm";
import { ensureNotificationPermissions } from "@/lib/notifications";
import { fetchRadarAreaData, radarAreaSnapshot } from "@/lib/radarAreaCheck";
import {
  createRadarMonitor,
  RADAR_MONITOR_STOP_URL,
  type RadarMonitor,
  type RadarMonitorDeps,
  type RadarNotification,
} from "@/lib/radarMonitor";

export const RADAR_BACKGROUND_KEY = "@copterpilot/radar_background_monitor_v1";
export const RADAR_ALERT_CHANNEL_ID = "radar-alerts";

/** „Im Hintergrund weiter überwachen“ – Standard an */
export async function getRadarBackgroundEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(RADAR_BACKGROUND_KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
}

export async function setRadarBackgroundEnabled(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(RADAR_BACKGROUND_KEY, on ? "1" : "0");
  } catch {
    /* Speicherfehler: Standard bleibt */
  }
  if (!on) await radarMonitor.stop("disabled");
}

let channelReady = false;
async function ensureAlertChannel(): Promise<void> {
  if (channelReady || Platform.OS !== "android") return;
  channelReady = true;
  try {
    await Notifications.setNotificationChannelAsync(RADAR_ALERT_CHANNEL_ID, {
      name: "Radar-Warnungen",
      description: "Verkehr, Geozonen und NOTAM, während das Radar im Hintergrund überwacht",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 400, 200, 400, 200, 400],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (e) {
    channelReady = false;
    console.warn("[radarMonitor] channel:", e);
  }
}

async function postNotification(n: RadarNotification): Promise<void> {
  await ensureAlertChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.body,
      sound: "default",
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 400, 200, 400, 200, 400],
      data: { type: "radar_alert", kind: n.kind },
    },
    trigger: Platform.OS === "android" ? { channelId: RADAR_ALERT_CHANNEL_ID } : null,
  });
}

// Erst bei Bedarf laden: das Modul erzeugt beim Import einen NativeEventEmitter
// (in Tests/ohne natives Modul nicht vorhanden).
let bgService: typeof BackgroundServiceType | null = null;
function backgroundService(): typeof BackgroundServiceType {
  if (!bgService) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-background-actions");
    bgService = (mod.default ?? mod) as typeof BackgroundServiceType;
  }
  return bgService;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const radarMonitorDeps: RadarMonitorDeps = {
  now: () => Date.now(),
  sleep,
  isAppActive: () => AppState.currentState === "active",
  loadBackgroundEnabled: async () => Platform.OS === "android" && (await getRadarBackgroundEnabled()),
  hasLocationPermission: async () => (await Location.getForegroundPermissionsAsync().catch(() => ({ granted: false }))).granted,
  loadAlarmSettings: async () => (await getSettings().catch(() => null))?.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM,
  fetchAircraft: async (lat, lon, radiusKm) => (await fetchNearbyAircraft(lat, lon, radiusKm, 60)).states,
  fetchArea: async (lat, lon, ra, iso) => radarAreaSnapshot(await fetchRadarAreaData(lat, lon, ra, iso)),
  notify: (n) => postNotification(n).catch((e) => console.warn("[radarMonitor] notify:", e)),
  triggerSound: (level, settings, alt) => (level === "critical" ? triggerCriticalAlarm(settings, alt) : triggerWarningAlarm(settings, alt)),
  stopSound: () => stopAlarmSound(),
  watchPosition: async (cb) => {
    const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 5 }, (loc) =>
      cb(loc.coords.latitude, loc.coords.longitude),
    );
    return () => sub.remove();
  },
  service: {
    start: async (task, opts) => {
      // Android 13+: Laufzeit-Berechtigung für Benachrichtigungen (POST_NOTIFICATIONS)
      await ensureNotificationPermissions().catch(() => false);
      await ensureAlertChannel();
      await backgroundService().start(task, {
        taskName: "CopterPilotRadarMonitor",
        taskTitle: opts.title,
        taskDesc: opts.description,
        taskIcon: { name: "ic_launcher", type: "mipmap" },
        color: "#0E2132",
        linkingURI: opts.linkingURI,
        foregroundServiceType: [opts.foregroundServiceType],
      });
    },
    stop: async () => {
      const svc = backgroundService();
      if (svc.isRunning()) await svc.stop();
    },
  },
  log: (m) => console.warn(m),
};

export const radarMonitor: RadarMonitor = createRadarMonitor(radarMonitorDeps);

// Tippen auf die Daueranzeige → Rückfrage „Beenden?“
let linkingInstalled = false;
export function installRadarMonitorLinking(): void {
  if (linkingInstalled) return;
  linkingInstalled = true;
  Linking.addEventListener("url", ({ url }) => {
    if (!url || !url.startsWith(RADAR_MONITOR_STOP_URL)) return;
    if (!radarMonitor.status().running) return;
    Alert.alert("Luftraumüberwachung", "Überwachung im Hintergrund beenden? Das Radar prüft weiter, solange es geöffnet ist.", [
      { text: "Weiter überwachen", style: "cancel" },
      { text: "Beenden", style: "destructive", onPress: () => void radarMonitor.stop("user") },
    ]);
  });
}
