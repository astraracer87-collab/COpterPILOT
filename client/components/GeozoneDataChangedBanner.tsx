import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { verdictChangeMessage, type VerdictChange } from "../../shared/checks";

// Teil A: deutlicher Hinweis, wenn nachgeladene Geozonen-Daten das Urteil einer
// offenen Planung bzw. eines Pre-Checks geändert haben (nie stilles Kippen).
export function GeozoneDataChangedBanner({ change, onDismiss }: { change: VerdictChange | null; onDismiss: () => void }) {
  if (!change) return null;
  return (
    <View style={styles.container} testID="banner-geozone-data-changed" accessibilityRole="alert">
      <Feather name="alert-octagon" size={20} color="#FFFFFF" />
      <ThemedText style={styles.text}>{verdictChangeMessage(change)}</ThemedText>
      <Pressable onPress={onDismiss} hitSlop={10} testID="banner-geozone-data-changed-dismiss" accessibilityLabel="Hinweis schließen">
        <Feather name="x" size={18} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "#C53030",
    borderRadius: BorderRadius.md ?? 8,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  text: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
