import React, { useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { getBlockingWork, subscribeBlockingWork } from "../../shared/yieldingWork";
import { usageCountryLabel } from "@/lib/countryUsage";

/**
 * Vollbild-Overlay „Bitte warten – Daten werden verarbeitet“ (Product Owner):
 * nur für Arbeit, die sich nicht in Zeitscheiben teilen lässt und auf dem
 * Gerät länger als ~300 ms blockieren würde (runBlocking() in
 * shared/yieldingWork.ts). Fängt ALLE Berührungen ab – die App ist nie „halb
 * eingefroren“ (sichtbar, aber ohne Reaktion). Einmal in App.tsx eingehängt.
 */
export function BlockingWorkOverlay() {
  const state = useSyncExternalStore(subscribeBlockingWork, getBlockingWork, getBlockingWork);
  if (!state) return null;
  const country = state.iso ? usageCountryLabel(state.iso) : null;
  const pct = state.fraction != null ? `${Math.round(Math.max(0, Math.min(1, state.fraction)) * 100)} %` : null;
  return (
    <View
      style={styles.backdrop}
      // alle Berührungen abfangen (Responder übernehmen, nichts durchlassen)
      pointerEvents="auto"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
      testID="blocking-work-overlay"
    >
      <View style={styles.card}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.title}>Bitte warten – Daten werden verarbeitet</Text>
        <Text style={styles.detail} testID="blocking-work-detail">
          {[country, state.label, state.step, pct].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(5, 8, 16, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    elevation: 10000,
  },
  card: {
    minWidth: 280,
    maxWidth: 520,
    paddingVertical: 24,
    paddingHorizontal: 28,
    borderRadius: 16,
    backgroundColor: "#121826",
    alignItems: "center",
    gap: 12,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
  },
  detail: {
    color: "rgba(200, 210, 230, 0.9)",
    fontSize: 14,
    textAlign: "center",
  },
});
