import React from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useNetwork } from "@/lib/network";
import { Spacing } from "@/constants/theme";

// App-weiter Offline-Hinweis. Liegt als absolutes Top-Bar über dem gesamten
// Inhalt (eigenes Safe-Area-Padding), damit keine doppelten Header-Insets
// entstehen. Sichtbar nur, solange keine Internetverbindung besteht.
export function OfflineBanner() {
  const { isOffline } = useNetwork();
  const insets = useSafeAreaInsets();

  if (!isOffline) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { paddingTop: insets.top + Spacing.xs }]}
      testID="banner-offline"
    >
      <View style={styles.row}>
        <Feather name="wifi-off" size={16} color="#FFFFFF" />
        <ThemedText style={styles.text} numberOfLines={2}>
          Offline — Radar, Live-Verkehr und Karten-Hintergrund sind nicht verfügbar. Gespeicherte
          Länder bleiben nutzbar.
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 12,
    backgroundColor: "#C53030",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  text: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
