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
      // In der Statusleiste mittig (zwischen Uhr und Akku), damit nichts in der App verdeckt wird.
      // Ohne Statusleiste: schmal unten links, Berührungen gehen durch.
      style={
        insets.top >= 18
          ? [styles.wrap, styles.inStatusBar, { height: insets.top }]
          : [styles.wrap, styles.bottomLeft, { left: insets.left + 8 }]
      }
      testID="download-activity-bar"
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${text}. Antippen öffnet Länder und Offline-Daten.`}
        style={[styles.pill, insets.top >= 18 ? { maxHeight: insets.top - 2 } : null]}
        disabled={insets.top < 18}
        hitSlop={2}
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
  },
  inStatusBar: {
    top: 0,
    left: "25%",
    right: "25%",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomLeft: {
    bottom: 8,
    left: 8,
    maxWidth: "45%",
    opacity: 0.85,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: "rgba(20,24,31,0.86)",
  },
  text: {
    color: "#FFFFFF",
    fontSize: 11,
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
