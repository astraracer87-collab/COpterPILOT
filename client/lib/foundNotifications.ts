import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isLoggedInSync } from "./auth";
import { apiGetAllFoundReports } from "./api";

/**
 * Lost & Found push-notification poller.
 *
 * Pollt periodisch alle Found-Reports des Users und feuert eine lokale
 * Notification für jeden Report, den der Client bisher noch nicht gesehen
 * hat. Die "seen"-Menge liegt in AsyncStorage und wird auch von der
 * DroneFoundLinkScreen aktualisiert, sobald der Pilot die Liste öffnet.
 */

const SEEN_KEY = "@found/seen_report_ids";
const ANDROID_CHANNEL_ID = "lost-and-found";
const POLL_INTERVAL_MS = 90 * 1000;
const MAX_SEEN_KEEP = 500;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let androidChannelConfigured = false;

function isSupported(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android" || androidChannelConfigured) return;
  androidChannelConfigured = true;
  try {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Lost & Found",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch (e) {
    console.warn("[found] android channel failed", e);
  }
}

async function getSeen(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function setSeen(set: Set<string>): Promise<void> {
  const arr = Array.from(set);
  const trimmed = arr.length > MAX_SEEN_KEEP ? arr.slice(arr.length - MAX_SEEN_KEEP) : arr;
  try {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch {}
}

export async function markFoundReportsSeen(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const seen = await getSeen();
  for (const id of ids) seen.add(id);
  await setSeen(seen);
}

async function fireLocal(title: string, body: string, data: Record<string, unknown>) {
  if (!isSupported()) return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        ...(Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.warn("[found] notification failed", e);
  }
}

export async function pollFoundReports(): Promise<void> {
  if (!isLoggedInSync()) return;
  try {
    const reports = await apiGetAllFoundReports({ limit: 50 });
    if (!reports || reports.length === 0) return;
    const seen = await getSeen();
    const fresh = reports.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) return;

    await ensureAndroidChannel();

    // Group by drone to avoid spamming.
    if (fresh.length === 1) {
      const r = fresh[0];
      const who = r.finderName?.trim() || "Jemand";
      const msg = (r.message || "").slice(0, 120);
      await fireLocal(
        "Drohne gefunden",
        msg ? `${who}: ${msg}` : `${who} hat eine Meldung hinterlassen.`,
        { type: "found_report", droneId: r.droneId, reportId: r.id },
      );
    } else {
      await fireLocal(
        "Lost & Found",
        `${fresh.length} neue Meldungen zu Ihren Drohnen.`,
        { type: "found_report_batch" },
      );
    }

    for (const r of fresh) seen.add(r.id);
    await setSeen(seen);
  } catch (e) {
    // network errors are quiet
  }
}

export function startFoundReportPolling(): () => void {
  if (!isSupported()) return () => {};
  // Initial fire after short delay so it doesn't race with the auth bootstrap.
  const initial = setTimeout(() => {
    pollFoundReports().catch(() => {});
  }, 5000);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    pollFoundReports().catch(() => {});
  }, POLL_INTERVAL_MS);
  return () => {
    clearTimeout(initial);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };
}
