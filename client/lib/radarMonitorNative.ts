/**
 * Android-Verdrahtung der Hintergrund-Überwachung (Kern: radarMonitor.ts).
 *
 *  - Vordergrunddienst: react-native-background-actions 4.1.0 (kleiner
 *    HeadlessJsTaskService, keine Google Play Services; hält die JS-Laufzeit
 *    und ihre Timer im Hintergrund aktiv). Diensttyp „location“ (GPS wird
 *    fortgeschrieben; Android 14: FOREGROUND_SERVICE_LOCATION + erteilte
 *    Standort-Berechtigung, Start nur aus dem Vordergrund), ohne GPS-
 *    Verfolgung „dataSync“. Manifest: plugins/withRadarForegroundService.js.
 *  - Warnungen: Alarmton aus proximityAlarm.ts/alarmSound.ts (WAV über
 *    expo-audio, ohne Google-TTS) wie im Vordergrund, dazu die Einblendung
 *    über anderen Apps (lib/alertOverlay.ts, plugins/withAlertOverlay.js) mit
 *    „Quittieren“. Das Mitteilungscenter bleibt frei: nur ohne Einblendungs-
 *    Berechtigung EINE Verkehrs-Benachrichtigung mit fester ID (Kanal
 *    „radar-traffic“, still – der Ton kommt vom Alarm), bei Entwarnung
 *    entfernt. Geozonen/NOTAM werden im Hintergrund nicht gemeldet.
 *  - Daueranzeige (Pflicht für den Vordergrunddienst): eigener stiller Kanal
 *    „radar-monitor-silent“ (IMPORTANCE_MIN, ohne Abzeichen), umgehängt vom
 *    nativen Modul. Beim Start werden alte gestapelte Radar-Meldungen früherer
 *    Versionen (Kanal „radar-alerts“) entfernt.
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
import * as Notifications from "expo-notifications";
import * as Location from "@/lib/location";
import { fetchNearbyAircraft } from "@/lib/opensky";
import { DEFAULT_PROXIMITY_ALARM, getSettings } from "@/lib/storage";
import {
  preloadAlarmSounds,
  stopAlarmSound,
  triggerCriticalAlarm,
  triggerWarningAlarm,
  updateAlarmAltitude,
} from "@/lib/proximityAlarm";
import { ensureNotificationPermissions } from "@/lib/notifications";
import { foregroundServiceHost } from "@/lib/foregroundServiceHostNative";
import {
  addOverlayDismissListener,
  canDrawOverlays,
  consumeOverlayDismissed,
  hideAlertOverlay,
  isAlertOverlaySupported,
  openOverlaySettings,
  restyleServiceNotification,
  showAlertOverlay,
  updateAlertOverlay,
} from "@/lib/alertOverlay";
import {
  createRadarMonitor,
  radarNotificationId,
  RADAR_MONITOR_STOP_URL,
  type RadarMonitor,
  type RadarMonitorDeps,
  type RadarNotification,
} from "@/lib/radarMonitor";
import { refreshQnh } from "./traffic/altitude";

export const RADAR_BACKGROUND_KEY = "@copterpilot/radar_background_monitor_v1";
/** Rückfall-Kanal (nur ohne Einblendung): Vorschau oben, aber still – Ton kommt vom Alarm */
export const RADAR_ALERT_CHANNEL_ID = "radar-traffic";
/** Kanal früherer Versionen (laut, stapelte Geozonen/NOTAM/Verkehr) – wird beim Start gelöscht */
export const LEGACY_RADAR_ALERT_CHANNEL_ID = "radar-alerts";
/** Einmaliger Hinweis „Warnung über anderen Apps einblenden“ beim Start der Überwachung */
export const OVERLAY_HINT_KEY = "@copterpilot/radar_overlay_hint_v1";

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
      name: "Verkehrswarnung (ohne Einblendung)",
      description: "Nur wenn „Über anderen Apps einblenden“ nicht erlaubt ist: eine Meldung je Verkehrswarnung, der Ton kommt vom Alarm",
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: false,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (e) {
    channelReady = false;
    console.warn("[radarMonitor] channel:", e);
  }
}

/**
 * Rückfall-Benachrichtigung mit fester ID (radarNotificationId): eine
 * vorhandene wird ersetzt, nie gestapelt.
 */
async function postNotification(n: RadarNotification): Promise<void> {
  await ensureAlertChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: radarNotificationId(n.kind),
    content: {
      title: n.title,
      body: n.body,
      sound: false,
      priority: Notifications.AndroidNotificationPriority.HIGH,
      data: { type: "radar_alert", kind: n.kind },
    },
    trigger: Platform.OS === "android" ? { channelId: RADAR_ALERT_CHANNEL_ID } : null,
  });
}

async function cancelNotification(id: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(id);
  } catch {
    /* nicht (mehr) angezeigt */
  }
}

/**
 * Alte gestapelte Radar-Meldungen früherer Versionen entfernen: Kanal
 * „radar-alerts“ löschen (entfernt auch seine Meldungen) und angezeigte
 * Radar-Meldungen schließen. Erinnerungen (Pre-Flight, Ablaufwarnungen) und
 * die Daueranzeige bleiben.
 */
export async function cleanupLegacyRadarNotifications(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const shown = (await Notifications.getPresentedNotificationsAsync?.()) ?? [];
    for (const n of shown) {
      const data = n?.request?.content?.data as { type?: string } | undefined;
      if (data?.type === "radar_alert") await cancelNotification(n.request.identifier);
    }
  } catch {
    /* nicht unterstützt */
  }
  try {
    await Notifications.deleteNotificationChannelAsync?.(LEGACY_RADAR_ALERT_CHANNEL_ID);
  } catch {
    /* Kanal gibt es nicht */
  }
}

/**
 * Einmaliger Hinweis beim Start der Überwachung, wenn die Einblendung
 * möglich wäre, aber die Berechtigung fehlt. Ohne natives Modul: nichts.
 */
export async function maybeShowOverlayPermissionHint(): Promise<boolean> {
  if (Platform.OS !== "android" || !isAlertOverlaySupported()) return false;
  if (await canDrawOverlays()) return false;
  try {
    if ((await AsyncStorage.getItem(OVERLAY_HINT_KEY)) === "1") return false;
    await AsyncStorage.setItem(OVERLAY_HINT_KEY, "1");
  } catch {
    return false;
  }
  Alert.alert(
    "Warnung über anderen Apps einblenden",
    "Damit TCAS-Warnungen auch über DJI Fly erscheinen (mit Knopf „Quittieren“), bitte „Über anderen Apps einblenden“ für COpter Pilot erlauben. Ohne Erlaubnis: nur Alarmton und eine Benachrichtigung.",
    [
      { text: "Später", style: "cancel" },
      { text: "Einstellungen öffnen", onPress: () => void openOverlaySettings() },
    ],
  );
  return true;
}

// „Quittieren“ auf der Einblendung → Überwachung (sofort, solange der JS-Kontext lebt)
let dismissListenerInstalled = false;
function installOverlayDismissListener(): void {
  if (dismissListenerInstalled) return;
  dismissListenerInstalled = true;
  addOverlayDismissListener((e) => {
    if (!e.test) radarMonitor.acknowledge();
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const radarMonitorDeps: RadarMonitorDeps = {
  now: () => Date.now(),
  sleep,
  isAppActive: () => AppState.currentState === "active",
  loadBackgroundEnabled: async () => Platform.OS === "android" && (await getRadarBackgroundEnabled()),
  hasLocationPermission: async () => (await Location.getForegroundPermissionsAsync().catch(() => ({ granted: false }))).granted,
  loadAlarmSettings: async () => (await getSettings().catch(() => null))?.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM,
  fetchAircraft: async (lat, lon, radiusKm) => {
    void refreshQnh(lat, lon);
    // Cinematic-Vorschau im Takt des Vordergrunddiensts (selbst auf stündlich gedrosselt)
    try {
      // lazy: hält die Radar-Verdrahtung frei von der Vorschau-Logik
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      void (require("./cinematicNotify") as typeof import("./cinematicNotify")).runCinematicCheck();
    } catch {}
    return (await fetchNearbyAircraft(lat, lon, radiusKm, 60)).states;
  },
  notify: (n) => postNotification(n).catch((e) => console.warn("[radarMonitor] notify:", e)),
  cancelNotification,
  overlay: {
    // Nicht über der eigenen App: dort zeigt der Radar-Screen sein Banner
    canShow: async () => AppState.currentState !== "active" && (await canDrawOverlays()),
    show: showAlertOverlay,
    update: updateAlertOverlay,
    hide: hideAlertOverlay,
    takeDismissed: consumeOverlayDismissed,
  },
  triggerSound: (level, settings, alt, approaching) =>
    level === "critical" ? triggerCriticalAlarm(settings, alt) : triggerWarningAlarm(settings, alt, approaching),
  updateSound: (alt, approaching) => updateAlarmAltitude(alt, approaching),
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
      await cleanupLegacyRadarNotifications();
      await ensureAlertChannel();
      installOverlayDismissListener();
      // Alarmtöne laden und Audio-Modus „im Hintergrund spielen“ setzen,
      // solange die App noch im Vordergrund ist
      preloadAlarmSounds();
      // Gemeinsamer Vordergrunddienst (auch für das Ladegerät-Loggen):
      // react-native-background-actions kann nur EINEN Dienst/EINE Aufgabe
      await foregroundServiceHost.acquire(
        "radar",
        task,
        {
          title: opts.title,
          description: opts.description,
          shortLabel: "Luftraumüberwachung aktiv",
          linkingURI: opts.linkingURI,
          foregroundServiceType: opts.foregroundServiceType,
        },
        10,
      );
      // Daueranzeige auf den stillen Kanal umhängen (natives Modul wartet auf startForeground)
      restyleServiceNotification();
      void maybeShowOverlayPermissionHint().catch(() => false);
    },
    stop: async () => {
      await foregroundServiceHost.release("radar");
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
