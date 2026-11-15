import React from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { formatSourceStand, type OfflineDataKind, type StandTone } from "../../shared/offlineDataPolicy";

// Teil A: einheitliche „Stand“-Zeilen je Quelle (Wetter, Kp, METAR, NOTAMs,
// Geozonen) in Planung, Pre-Check und Radar – optional mit „Jetzt aktualisieren“.

export interface StandEntry {
  kind: OfflineDataKind;
  origin: { fetchedAt: number; cached?: boolean } | null | undefined;
}

export interface DataStandLinesProps {
  entries?: StandEntry[];
  /** Zusätzliche, bereits formatierte Zeilen (z. B. Geozonen-Datenstand B5) */
  extraLines?: { text: string; tone?: StandTone; testID?: string }[];
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
}

export function DataStandLines({ entries = [], extraLines = [], onRefresh, refreshing, testID }: DataStandLinesProps) {
  const { theme } = useTheme();
  const now = Date.now();
  const lines = [
    ...entries
      .map((e) => {
        const f = formatSourceStand(e.kind, e.origin, now);
        return f ? { ...f, testID: `stand-${e.kind}` } : null;
      })
      .filter((x): x is { text: string; tone: StandTone; testID: string } => !!x),
    ...extraLines.map((l) => ({ text: l.text, tone: l.tone ?? ("normal" as StandTone), testID: l.testID })),
  ];
  if (lines.length === 0 && !onRefresh) return null;
  const colorOf = (tone: StandTone) =>
    tone === "warning"
      ? theme.statusNoGo || "#FF3B30"
      : tone === "offline"
        ? theme.statusCaution || "#FF9500"
        : theme.textTertiary;
  return (
    <View style={styles.container} testID={testID}>
      {lines.map((l, i) => (
        <ThemedText key={`${l.text}-${i}`} testID={l.testID} style={[styles.line, { color: colorOf(l.tone) }]}>
          {l.text}
        </ThemedText>
      ))}
      {onRefresh ? (
        <Pressable
          testID="button-refresh-now"
          onPress={onRefresh}
          disabled={refreshing}
          style={({ pressed }) => [styles.refresh, { opacity: pressed || refreshing ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Jetzt aktualisieren"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Feather name="refresh-cw" size={14} color={theme.primary} />
          )}
          <ThemedText style={[styles.refreshText, { color: theme.primary }]}>Jetzt aktualisieren</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 2, marginBottom: Spacing.sm },
  line: { fontSize: 12, lineHeight: 16 },
  refresh: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: Spacing.xs, alignSelf: "flex-start" },
  refreshText: { fontSize: 13, fontWeight: "600" },
});
