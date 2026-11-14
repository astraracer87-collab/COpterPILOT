import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_NOTIF_MAP_KEY = "@reminders/session_notif_map";
const REMINDER_LEAD_MS = 60 * 60 * 1000;
const ANDROID_CHANNEL_ID = "preflight-reminders";

type NotifMap = Record<string, string>;

let handlerConfigured = false;
let androidChannelConfigured = false;

function isSupported(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

function configureHandler() {
  if (handlerConfigured || !isSupported()) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowAlert: true,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || androidChannelConfigured) return;
  androidChannelConfigured = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Pre-Flight Reminders",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (error) {
    console.warn("ensureAndroidChannel failed", error);
  }
}

async function getMap(): Promise<NotifMap> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_NOTIF_MAP_KEY);
    return raw ? (JSON.parse(raw) as NotifMap) : {};
  } catch {
    return {};
  }
}

async function setMap(map: NotifMap): Promise<void> {
  await AsyncStorage.setItem(SESSION_NOTIF_MAP_KEY, JSON.stringify(map));
}

// Per-session Mutex: alle schedule/cancel-Aufrufe für eine Session werden
// nacheinander ausgeführt. Verhindert Race Conditions zwischen rasch
// aufeinanderfolgenden create/update/delete-Operationen, die sonst zu
// doppelten oder verwaisten Reminders führen könnten.
const sessionLocks = new Map<string, Promise<unknown>>();

function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  sessionLocks.set(
    sessionId,
    next.finally(() => {
      if (sessionLocks.get(sessionId) === next) {
        sessionLocks.delete(sessionId);
      }
    }),
  );
  return next;
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  if (!isSupported()) return false;
  configureHandler();
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return req.granted;
}

export interface ReminderInput {
  sessionId: string;
  plannedDate?: string;
  plannedTime?: string;
  locationName?: string;
  droneName?: string;
}

function parseTriggerDate(date?: string, time?: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}:00`);
  if (isNaN(d.getTime())) return null;
  const trigger = new Date(d.getTime() - REMINDER_LEAD_MS);
  if (trigger.getTime() <= Date.now() + 5000) return null;
  return trigger;
}

async function cancelInternal(sessionId: string): Promise<void> {
  const map = await getMap();
  const id = map[sessionId];
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {}
  delete map[sessionId];
  await setMap(map);
}

export function cancelPreflightReminder(sessionId: string): Promise<void> {
  if (!isSupported()) return Promise.resolve();
  return withSessionLock(sessionId, () => cancelInternal(sessionId));
}

export function schedulePreflightReminder(input: ReminderInput): Promise<string | null> {
  if (!isSupported()) return Promise.resolve(null);
  return withSessionLock(input.sessionId, async () => {
    // Bestehende Erinnerung für diese Session immer entfernen, bevor neu
    // geplant wird (z.B. wenn Datum/Uhrzeit geändert wurde).
    await cancelInternal(input.sessionId);

    const trigger = parseTriggerDate(input.plannedDate, input.plannedTime);
    if (!trigger) return null;

    const granted = await ensureNotificationPermissions();
    if (!granted) return null;

    const locationPart = input.locationName ? ` in ${input.locationName}` : "";
    const dronePart = input.droneName ? ` (${input.droneName})` : "";
    const body = `Dein Flug${dronePart} startet in einer Stunde${locationPart}. Pre-Check jetzt durchführen.`;

    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "Pre-Flight Reminder",
          body,
          data: { sessionId: input.sessionId, type: "preflight_reminder" },
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: trigger,
          ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
        },
      });
      const map = await getMap();
      map[input.sessionId] = id;
      await setMap(map);
      return id;
    } catch (error) {
      console.warn("schedulePreflightReminder failed", error);
      return null;
    }
  });
}
