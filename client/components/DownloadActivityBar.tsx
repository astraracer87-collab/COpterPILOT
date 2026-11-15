import React, { useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  downloadFraction,
  formatDownloadActivity,
  getDownloadActivityVersion,
  getVisibleDownloads,
  subscribeDownloadActivity,
} from "@/lib/downloadActivity";
import { navigationRef } from "@/navigation/navigationRef";

/** Einstellungen → Länder & Offline-Daten öffnen. */
function openOfflineSettings(): void {
  try {
    if (!navigationRef.isReady?.()) return;
    (navigationRef.navigate as any)("Main", { screen: "SettingsTab", params: { screen: "RcOfflineMaps" } });
  } catch {}
}

/**
 * App-weite Download-Anzeige (einmal in App.tsx über der Navigation): kleine
 * Pille oben rechts (Querformat der Fernsteuerung, Safe-Area beachtet), z. B.
 * „Lädt: Deutschland – Geozonen 45 %“ bzw. „Lädt 3 Aufgaben …“. Tippen öffnet
 * Einstellungen → Länder & Offline-Daten. Aufgaben unter 1 s erscheinen nicht.
 */
export function DownloadActivityBar({ onPress = openOfflineSettings }: { onPress?: () => void }) {
  useSyncExternalStore(subscribeDownloadActivity, getDownloadActivityVersion, getDownloadActivityVersion);
  const insets = useSafeAreaInsets();
  const visible = getVisibleDownloads();
  const text = formatDownloadActivity(visible);
  if (!text) return null;
  const single = visible.length === 1 ? downloadFraction(visible[0]) : null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 6, right: Math.max(insets.right, 0) + 12 }]}
      testID="download-activity-bar"
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${text}. Antippen öffnet Länder und Offline-Daten.`}
        style={styles.pill}
        hitSlop={6}
        testID="download-activity-pill"
      >
        <ActivityIndicator size="small" color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={1} testID="download-activity-text">
          {text}
        </Text>
        {single != null ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(single * 100)}%` }]} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    zIndex: 9998,
    elevation: 11,
    maxWidth: "60%",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(20,24,31,0.86)",
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    flexShrink: 1,
  },
  track: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  fill: {
    height: 4,
    backgroundColor: "#4FC3F7",
  },
});
