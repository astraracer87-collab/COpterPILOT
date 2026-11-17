import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** System-Benachrichtigungen für den Annäherungsalarm im Hintergrund (Ton, keine Vibration). */
const CHANNEL = "traffic-proximity";
let channelReady = false;

export async function ensureTrafficChannel(): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Annäherungsalarm (Verkehr)",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      enableVibrate: false,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    channelReady = true;
  } catch {
    /* ignore */
  }
}

export async function notifyProximity(title: string, body: string): Promise<void> {
  try {
    await ensureTrafficChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.MAX,
        ...(Platform.OS === "android" ? { channelId: CHANNEL } : {}),
      } as Notifications.NotificationContentInput,
      trigger: null,
    });
  } catch {
    /* ignore */
  }
}
