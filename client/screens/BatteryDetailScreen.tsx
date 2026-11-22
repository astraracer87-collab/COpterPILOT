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
  updateDrone,
  getDrone,
  getBatteryFlightHistory,
  getEntryDjiLogs,
  DroneProfile,
  DroneBattery,
  LogbookEntry,
} from "@/lib/storage";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import {
  computeBatteryStats,
  formatTrend,
  batteryDisplayName,
  batteryNumberOf,
  plausibleTs,
  BATTERY_NUMBER_MAX,
} from "@/lib/djiBatteryLink";
import Svg, { Polyline, Circle } from "react-native-svg";
import { batteryKey } from "@/lib/charger/batteryFingerprint";

type Nav = NativeStackNavigationProp<SettingsStackParamList, "BatteryDetail">;

function entrySortTs(e: LogbookEntry): number {
  const log = getEntryDjiLogs(e)[0];
  const t = plausibleTs(log?.startTs) ?? plausibleTs(e.takeoffTime ? Date.parse(e.takeoffTime) : NaN);
  if (t != null) return t;
  const d = Date.parse(e.flightDate);
  return Number.isFinite(d) ? d : 0;
}

/** Treppenkurve der Ladezyklen über die Zeit. */
function CycleChart({ points, color }: { points: { ts: number; cycles: number }[]; color: string }) {
  const width = 160;
  const height = 48;
  if (points.length < 2) return null;
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const c0 = Math.min(...points.map((p) => p.cycles));
  const c1 = Math.max(...points.map((p) => p.cycles));
  const x = (t: number) => 4 + ((t - t0) / (t1 - t0 || 1)) * (width - 8);
  const y = (c: number) => 4 + (1 - (c - c0) / (c1 - c0 || 1)) * (height - 8);
  const pts: string[] = [];
  points.forEach((p, i) => {
    if (i > 0) pts.push(`${x(p.ts)},${y(points[i - 1].cycles)}`);
    pts.push(`${x(p.ts)},${y(p.cycles)}`);
  });
  const last = points[points.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={x(last.ts)} cy={y(last.cycles)} r={3} fill={color} />
    </Svg>
  );
}

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
        const d = await getDrone(droneId);
        const serial = d?.batteries?.find((b) => b.id === batteryId)?.serialNumber;
        const h = await getBatteryFlightHistory(droneId, batteryId, serial);
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
  const batteryNumber = battery ? batteryNumberOf(battery) : undefined;
  const takenNumbers = useMemo(
    () =>
      new Set(
        (drone?.batteries ?? [])
          .filter((b) => b.id !== batteryId)
          .map((b) => batteryNumberOf(b))
          .filter((n): n is number => n != null),
      ),
    [drone, batteryId],
  );
  const setBatteryNumber = async (n: number | null) => {
    if (!drone || !battery) return;
    const nextBatteries = (drone.batteries ?? []).map((b) =>
      b.id === batteryId
        ? { ...b, number: n ?? undefined, name: batteryDisplayName({ number: n ?? undefined, serialNumber: b.serialNumber }) }
        : b,
    );
    setDrone({ ...drone, batteries: nextBatteries });
    try {
      await updateDrone(drone.id, { batteries: nextBatteries });
    } catch {
      // Anzeige bleibt; beim nächsten Öffnen wird der gespeicherte Stand geladen
    }
  };
  // Werte aus den DJI-Flugprotokollen dieses Akkus (chronologisch)
  const logStats = useMemo(() => {
    if (!battery) return null;
    return computeBatteryStats([{ ...(drone as DroneProfile), batteries: [battery] }], history).find(
      (s) => s.batteryId === battery.id,
    ) ?? null;
  }, [drone, battery, history]);
  const cycleHistory = useMemo(() => {
    const pts = (logStats?.trend ?? [])
      .filter((p) => typeof p.cycleCount === "number" && p.ts > 0)
      .map((p) => ({ ts: p.ts, cycles: p.cycleCount as number }));
    return pts;
  }, [logStats]);
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
            paddingTop: headerHeight + Spacing.sm,
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
              {battery ? batteryDisplayName(battery) : "Akku"}
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
            {logStats?.cycleCount != null ? (
              <View style={[styles.statBox, { borderLeftWidth: 1, borderLeftColor: theme.border }]}>
                <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>Zyklen (DJI)</ThemedText>
                <ThemedText style={styles.statValue}>{logStats.cycleCount}</ThemedText>
              </View>
            ) : null}
          </View>
          {logStats && logStats.trend.length > 0 ? (
            <View style={{ gap: 2 }}>
              <ThemedText style={[styles.note, { color: theme.textSecondary }]}>
                Min. Zellspannung: {formatTrend(logStats.trend.map((p) => p.minCellV), 2, "V")}
              </ThemedText>
              <ThemedText style={[styles.note, { color: theme.textSecondary }]}>
                Max. Temperatur: {formatTrend(logStats.trend.map((p) => p.maxTempC), 0, "°C")}
              </ThemedText>
            </View>
          ) : null}
          {!battery ? (
            <ThemedText style={[styles.note, { color: theme.statusCaution }]}>
              Dieser Akku ist nicht mehr in den Drohnen-Einstellungen vorhanden.
              Bestehende Logbuch-Einträge bleiben verlinkt.
            </ThemedText>
          ) : null}
        </Card>

        {battery ? (
          <Card style={styles.statsCard}>
            <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>
              AKKU-NUMMER (WIE AM AKKU BESCHRIFTET)
            </ThemedText>
            <View style={styles.numberRow}>
              {Array.from({ length: BATTERY_NUMBER_MAX }, (_, i) => i + 1).map((n) => {
                const active = batteryNumber === n;
                const taken = takenNumbers.has(n);
                return (
                  <Pressable
                    key={n}
                    testID={`battery-detail-number-${n}`}
                    disabled={taken}
                    onPress={() => setBatteryNumber(active ? null : n)}
                    style={[
                      styles.numberChip,
                      {
                        borderColor: active ? theme.primary : theme.border,
                        backgroundColor: active ? theme.primary + "25" : theme.backgroundSecondary,
                      },
                      taken && { opacity: 0.3 },
                    ]}
                  >
                    <ThemedText style={{ ...Typography.body, fontWeight: active ? "700" : "500", color: active ? theme.primary : theme.text }}>
                      {n}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        {cycleHistory.length > 0 ? (
          <Card style={styles.statsCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.sectionTitle}>Ladezyklen-Verlauf</ThemedText>
                <ThemedText style={[styles.historyMeta, { color: theme.textSecondary }]}>
                  Aus den DJI-Flugprotokollen: {cycleHistory[0].cycles} Zyklen am {formatDate(new Date(cycleHistory[0].ts).toISOString())}
                  {cycleHistory.length > 1
                    ? ` → ${cycleHistory[cycleHistory.length - 1].cycles} am ${formatDate(new Date(cycleHistory[cycleHistory.length - 1].ts).toISOString())}`
                    : ""}
                </ThemedText>
              </View>
              <CycleChart points={cycleHistory} color={theme.primary} />
            </View>
          </Card>
        ) : null}

        <Pressable
          testID="battery-open-charge-history"
          onPress={() =>
            (navigation as unknown as { navigate(r: string, p: unknown): void }).navigate("ChargerTab", {
              screen: "ChargerBatteryHistory",
              params: { batteryKey: batteryKey({ droneId, batteryId }), label: battery?.name ?? "Akku" },
              initial: false,
            })
          }
          style={({ pressed }) => [
            styles.historyCard,
            { borderColor: theme.border, backgroundColor: theme.backgroundSecondary },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Feather name="battery-charging" size={20} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.historyTitle}>Ladehistorie (ISDT MA331)</ThemedText>
            <ThemedText style={[styles.historyMeta, { color: theme.textSecondary }]}>
              Ladevorgänge, Zyklen, Zell-Spreizung, Temperatur
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textSecondary} />
        </Pressable>

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
          [...history]
            .sort((a, b) => entrySortTs(b) - entrySortTs(a))
            .map((entry) => {
            const djiLog = getEntryDjiLogs(entry).find(
              (l) => l.batteryId === batteryId || (!!battery?.serialNumber && l.batterySn === battery.serialNumber),
            );
            const pre =
              entry.preflight?.batteryUsage?.find((u) => u.batteryId === batteryId) ??
              (djiLog?.batteryStartPercent != null ? { percentBefore: djiLog.batteryStartPercent } : undefined);
            const post =
              entry.debriefing?.batteryUsage?.find((u) => u.batteryId === batteryId) ??
              (djiLog?.batteryEndPercent != null ? { percentAfter: djiLog.batteryEndPercent } : undefined);
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
                    {[
                      entry.locationName || "Ohne Ort",
                      typeof djiLog?.batteryCycleCount === "number" && djiLog.batteryCycleCount > 0 ? `${djiLog.batteryCycleCount} Zyklen` : null,
                      typeof djiLog?.minCellV === "number" && !djiLog.minCellEstimated ? `min. ${djiLog.minCellV.toFixed(2).replace(".", ",")} V` : null,
                      typeof djiLog?.maxBatteryTempC === "number" ? `max. ${Math.round(djiLog.maxBatteryTempC)} °C` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
  numberRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  numberChip: {
    minWidth: 44,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
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
