// Cinematic-Vorschau: lokale Benachrichtigung bei gutem Wolkenmeer-Score.
//
// Ohne Google-Dienste und ohne Hintergrund-Tasks: geprüft wird beim App-Start,
// bei Rückkehr in die App, stündlich während die App läuft (useCinematicWatch)
// und – höchstens stündlich – im Takt der Radar-Hintergrundüberwachung, solange
// deren Vordergrunddienst läuft. Jede Prüfung nutzt den 60-min-Zwischenspeicher,
// erzeugt also höchstens eine Open-Meteo-Abfrage pro Stunde.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { getDrones } from "./storage";
import {
  getCinematicForecast,
  loadCinematicSettings,
  loadNotifyState,
  pickCinematicNotification,
  saveNotifyState,
} from "./cinematicForecast";

const ANDROID_CHANNEL_ID = "cinematic-forecast";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_GUST_MS = 10;

let channelReady = false;
let lastCheckAt = 0;
let running: Promise<void> | null = null;

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  channelReady = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Cinematic-Vorschau (Wolkenmeer)",
      description: "Hinweis, wenn an einem Gipfel in der Nähe ein Wolkenmeer wahrscheinlich ist",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (e) {
    channelReady = false;
    console.warn("[cinematic] channel:", e);
  }
}

/**
 * Böengrenze für den Score: höchste „max. Böen“ der aktiven Drohnen (die
 * Vorschau ist ein Filter – die Prüfung der konkreten Drohne folgt in der
 * Flugplanung). Ohne Drohne 10 m/s.
 */
export async function resolveMaxGustMs(): Promise<number> {
  try {
    const drones = await getDrones();
    const vals = drones.map((d) => d.limits?.maxGusts).filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length ? Math.max(...vals) : DEFAULT_MAX_GUST_MS;
  } catch {
    return DEFAULT_MAX_GUST_MS;
  }
}

/** Beim Einschalten in der Vorschau: Berechtigung erfragen (Kanal anlegen). */
export async function requestCinematicNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return false;
  await ensureChannel();
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!cur.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return req.granted;
}

/**
 * Eine Prüfung (gedrosselt auf höchstens stündlich, außer `force`). Fragt im
 * Hintergrund nie nach Berechtigungen – ohne Erlaubnis passiert nichts.
 */
export function runCinematicCheck(opts: { force?: boolean } = {}): Promise<void> {
  if (running) return running;
  const now = Date.now();
  if (!opts.force && now - lastCheckAt < CHECK_INTERVAL_MS) return Promise.resolve();
  running = (async () => {
    try {
      const settings = await loadCinematicSettings();
      if (!settings.notifyEnabled) return;
      lastCheckAt = now;
      if (Platform.OS !== "android" && Platform.OS !== "ios") return;
      const perm = await Notifications.getPermissionsAsync().catch(() => null);
      if (!perm?.granted) return;
      const result = await getCinematicForecast({ radiusKm: settings.maxDistanceKm, maxGustMs: await resolveMaxGustMs() });
      // Veraltete Daten (offline) nicht melden
      if (result.stale) return;
      const state = await loadNotifyState();
      const { notification, state: next } = pickCinematicNotification(result.spots, settings, state, Date.now());
      await saveNotifyState(next);
      if (!notification) return;
      await ensureChannel();
      await Notifications.scheduleNotificationAsync({
        identifier: `cinematic-${notification.spotId}`,
        content: {
          title: notification.title,
          body: notification.body,
          data: { type: "cinematic_forecast", spotId: notification.spotId },
        },
        trigger: Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : null,
      });
    } catch (e) {
      console.warn("[cinematic] check:", e);
    } finally {
      running = null;
    }
  })();
  return running;
}
