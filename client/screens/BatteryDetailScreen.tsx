import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  getDrone,
  getBatteryFlightHistory,
  DroneProfile,
  DroneBattery,
  LogbookEntry,
} from "@/lib/storage";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type Nav = NativeStackNavigationProp<SettingsStackParamList, "BatteryDetail">;

export default function BatteryDetailScreen() {
  const route = useRoute<RouteProp<SettingsStackParamList, "BatteryDetail">>();
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { droneId, batteryId } = route.params;

  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [history, setHistory] = useState<LogbookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, h] = await Promise.all([
          getDrone(droneId),
          getBatteryFlightHistory(droneId, batteryId),
        ]);
        if (cancelled) return;
        setDrone(d);
        setHistory(h);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [droneId, batteryId]);

  const battery: DroneBattery | undefined = useMemo(
    () => drone?.batteries?.find((b) => b.id === batteryId),
    [drone, batteryId],
  );

  const cycles = history.length;
  const totalDischarge = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const e of history) {
      const pre = e.preflight?.batteryUsage?.find((u) => u.batteryId === batteryId);
      const post = e.debriefing?.batteryUsage?.find((u) => u.batteryId === batteryId);
      if (typeof pre?.percentBefore === "number" && typeof post?.percentAfter === "number") {
        const diff = pre.percentBefore - post.percentAfter;
        if (Number.isFinite(diff) && diff >= 0) {
          sum += diff;
          count += 1;
        }
      }
    }
    return { avg: count > 0 ? Math.round(sum / count) : null, count };
  }, [history, batteryId]);

  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.header}>
          <View style={[styles.iconBadge, { backgroundColor: theme.primary + "20" }]}>
            <Feather name="battery" size={28} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.title}>
              {battery?.name ?? "Akku"}
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
              {drone?.name ? `${drone.name} · ` : ""}SN: {battery?.serialNumber || "—"}
            </ThemedText>
          </View>
        </View>

        <Card style={styles.statsCard}>
          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Flüge</ThemedText>
              <ThemedText style={styles.statValue}>{cycles}</ThemedText>
            </View>
            <View style={[styles.statBox, { borderLeftWidth: 1, borderLeftColor: theme.border }]}>
              <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Ø Verbrauch</ThemedText>
              <ThemedText style={styles.statValue}>
                {totalDischarge.avg !== null ? `${totalDischarge.avg}%` : "—"}
              </ThemedText>
            </View>
          </View>
          {!battery ? (
            <ThemedText style={[styles.note, { color: theme.statusCaution }]}>
              Dieser Akku ist nicht mehr in den Drohnen-Einstellungen vorhanden.
              Bestehende Logbuch-Einträge bleiben verlinkt.
            </ThemedText>
          ) : null}
        </Card>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Flughistorie</ThemedText>
        </View>

        {loading ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: Spacing.lg }} />
        ) : history.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="inbox" size={24} color={theme.textTertiary} />
            <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
              Noch keine Flüge mit diesem Akku im Logbuch.
            </ThemedText>
          </Card>
        ) : (
          history.map((entry) => {
            const pre = entry.preflight?.batteryUsage?.find((u) => u.batteryId === batteryId);
            const post = entry.debriefing?.batteryUsage?.find((u) => u.batteryId === batteryId);
            return (
              <Pressable
                key={entry.id}
                testID={`battery-history-${entry.id}`}
                onPress={() =>
                  navigation.navigate("LogbookEntryDetail", { logbookEntryId: entry.id })
                }
                style={({ pressed }) => [
                  styles.historyCard,
                  { borderColor: theme.border, backgroundColor: theme.backgroundSecondary },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.historyTitle}>
                    {formatDate(entry.flightDate)}
                  </ThemedText>
                  <ThemedText style={[styles.historyMeta, { color: theme.textSecondary }]}>
                    {entry.locationName || "Ohne Ort"}
                  </ThemedText>
                  <View style={styles.percentRow}>
                    {typeof pre?.percentBefore === "number" ? (
                      <View style={[styles.pill, { backgroundColor: theme.statusGoBackground }]}>
                        <ThemedText style={[styles.pillText, { color: theme.statusGo }]}>
                          Start {pre.percentBefore}%
                        </ThemedText>
                      </View>
                    ) : null}
                    {typeof post?.percentAfter === "number" ? (
                      <View style={[styles.pill, { backgroundColor: theme.statusCautionBackground }]}>
                        <ThemedText style={[styles.pillText, { color: theme.statusCaution }]}>
                          Ende {post.percentAfter}%
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Feather name="chevron-right" size={20} color={theme.textSecondary} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginBottom: Spacing.sm },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  title: { ...Typography.h2 },
  subtitle: { ...Typography.caption, marginTop: 2 },
  statsCard: { padding: Spacing.lg, gap: Spacing.md },
  statRow: { flexDirection: "row" },
  statBox: { flex: 1, paddingHorizontal: Spacing.md, alignItems: "center" },
  statLabel: { ...Typography.caption, fontWeight: "600" },
  statValue: { ...Typography.h2, marginTop: 4 },
  note: { ...Typography.caption, fontStyle: "italic" },
  section: { marginTop: Spacing.lg },
  sectionTitle: { ...Typography.h4 },
  emptyCard: { padding: Spacing.xl, alignItems: "center", gap: Spacing.sm },
  emptyText: { ...Typography.body, textAlign: "center" },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  historyTitle: { ...Typography.body, fontWeight: "600" },
  historyMeta: { ...Typography.caption, marginTop: 2 },
  percentRow: { flexDirection: "row", gap: Spacing.xs, marginTop: 6, flexWrap: "wrap" },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { ...Typography.small, fontWeight: "600" },
});
