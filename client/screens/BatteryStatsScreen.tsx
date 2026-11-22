import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Svg, { Polyline, Circle } from "react-native-svg";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getDrones, getLogbookLite } from "@/lib/storage";
import {
  computeBatteryStats,
  compareBatteries,
  formatTrend,
  type BatteryStat,
} from "@/lib/djiBatteryLink";
import { DroneImage } from "@/components/DroneImage";
import type { DroneProfile } from "@/lib/storage";
import type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";

type Nav = NativeStackNavigationProp<HistoryStackParamList>;

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Kleiner Verlauf (alt → neu) als Linie. */
function Sparkline({
  values,
  color,
  width = 120,
  height = 28,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = 3 + (i / (values.length - 1)) * (width - 6);
    const y = 3 + (1 - (v - min) / span) * (height - 6);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
      />
      <Circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </Svg>
  );
}

/**
 * Akku-Statistik: alle Akkus (aus den Drohnen und aus DJI-Flugprotokollen)
 * mit Anzahl Flügen, letzter Nutzung, Ladezyklen und dem Verlauf von
 * minimaler Zellspannung und maximaler Temperatur.
 */
export default function BatteryStatsScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<Nav>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<BatteryStat[] | null>(null);
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [droneFilter, setDroneFilter] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [drones, entries] = await Promise.all([
            getDrones({ includeArchived: true }),
            getLogbookLite(),
          ]);
          if (!cancelled) {
            setDrones(drones);
            setStats(computeBatteryStats(drones, entries));
          }
        } catch {
          if (!cancelled) setStats([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Je Drohne gruppiert (alphabetisch), innerhalb nach Akku-Nummer
  const groups = useMemo(() => {
    if (!stats) return [];
    const byDrone = new Map<string, { key: string; drone?: DroneProfile; title: string; items: BatteryStat[] }>();
    for (const st of stats) {
      const d = st.droneId ? drones.find((x) => x.id === st.droneId) : undefined;
      const key = d ? d.id : `name:${st.droneName ?? ""}`;
      let g = byDrone.get(key);
      if (!g) {
        g = { key, drone: d, title: d?.name ?? st.droneName ?? "Ohne Drohne", items: [] };
        byDrone.set(key, g);
      }
      g.items.push(st);
    }
    const list = [...byDrone.values()];
    for (const g of list) g.items.sort(compareBatteries);
    return list.sort((a, b) => {
      if (!a.drone !== !b.drone) return a.drone ? -1 : 1;
      return a.title.localeCompare(b.title, "de", { numeric: true, sensitivity: "base" });
    });
  }, [stats, drones]);
  const visibleGroups = droneFilter ? groups.filter((g) => g.key === droneFilter) : groups;

  const renderStat = (s: BatteryStat) => {
    const cells = s.trend
      .map((p) => p.minCellV)
      .filter((v): v is number => typeof v === "number");
    const temps = s.trend
      .map((p) => p.maxTempC)
      .filter((v): v is number => typeof v === "number");
    const lowCell = s.lowestCellV !== undefined && s.lowestCellV < 3.3;
    const hot = s.highestTempC !== undefined && s.highestTempC >= 60;
    const content = (
      <>
        <View style={styles.titleRow}>
          <Feather name="battery" size={18} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.title} numberOfLines={1}>
              {s.name}
            </ThemedText>
            <ThemedText
              style={[styles.sub, { color: theme.textSecondary }]}
              numberOfLines={1}
            >
              {s.serialNumber ? `S/N ${s.serialNumber}` : "—"}
            </ThemedText>
          </View>
          {s.batteryId && s.droneId ? (
            <Feather
              name="chevron-right"
              size={18}
              color={theme.textTertiary}
            />
          ) : null}
        </View>
        <View style={styles.kpiRow}>
          <Kpi label="Flüge" value={String(s.flightCount)} />
          <Kpi
            label="Zyklen"
            value={s.cycleCount != null ? String(s.cycleCount) : "—"}
          />
          <Kpi label="Zuletzt" value={fmtDate(s.lastUsedAt)} />
        </View>
        <View style={styles.trendRow}>
          <View style={{ flex: 1 }}>
            <ThemedText
              style={[styles.trendLabel, { color: theme.textSecondary }]}
            >
              Min. Zellspannung
            </ThemedText>
            <ThemedText
              style={[
                styles.trendValue,
                lowCell && { color: theme.statusCaution },
              ]}
              numberOfLines={1}
            >
              {formatTrend(cells, 2, "V")}
            </ThemedText>
          </View>
          <Sparkline
            values={cells.slice(-12)}
            color={lowCell ? theme.statusCaution : theme.primary}
          />
        </View>
        <View style={styles.trendRow}>
          <View style={{ flex: 1 }}>
            <ThemedText
              style={[styles.trendLabel, { color: theme.textSecondary }]}
            >
              Max. Temperatur
            </ThemedText>
            <ThemedText
              style={[styles.trendValue, hot && { color: theme.statusCaution }]}
              numberOfLines={1}
            >
              {formatTrend(temps, 0, "°C")}
            </ThemedText>
          </View>
          <Sparkline
            values={temps.slice(-12)}
            color={hot ? theme.statusCaution : theme.primary}
          />
        </View>
      </>
    );
    if (s.batteryId && s.droneId) {
      return (
        <Pressable
          key={s.key}
          testID={`battery-stat-${s.key}`}
          onPress={() =>
            navigation.navigate("BatteryDetail", {
              droneId: s.droneId!,
              batteryId: s.batteryId!,
            })
          }
          style={({ pressed }) => [pressed && { opacity: 0.75 }]}
        >
          <Card style={styles.card}>{content}</Card>
        </Pressable>
      );
    }
    return (
      <Card key={s.key} style={styles.card} testID={`battery-stat-${s.key}`}>
        {content}
      </Card>
    );
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
        {groups.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {[{ key: null as string | null, title: "Alle" }, ...groups.map((g) => ({ key: g.key as string | null, title: g.title }))].map((f) => {
              const active = droneFilter === f.key;
              return (
                <Pressable
                  key={f.key ?? "all"}
                  onPress={() => setDroneFilter(f.key)}
                  style={[styles.filterChip, { borderColor: active ? theme.primary : theme.border, backgroundColor: active ? theme.primary + "22" : "transparent" }]}
                >
                  <ThemedText style={[styles.filterText, { color: active ? theme.primary : theme.textSecondary, fontWeight: active ? "700" : "500" }]}>
                    {f.title}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
        {stats === null ? (
          <ActivityIndicator
            color={theme.primary}
            style={{ marginTop: Spacing.lg }}
          />
        ) : stats.length === 0 ? (
          <Card style={styles.card}>
            <ThemedText style={{ color: theme.textSecondary }}>
              Noch keine Akkus bekannt. Werte DJI-Flugprotokolle aus und ordne
              sie Flügen zu, oder lege Akkus in den Drohnen-Einstellungen an.
            </ThemedText>
          </Card>
        ) : (
          visibleGroups.map((g) => (
            <View key={g.key} style={{ gap: Spacing.sm }}>
              <View style={styles.groupHeader}>
                {g.drone ? (
                  <DroneImage manufacturer={g.drone.manufacturer} model={g.drone.model} size={44} iconColor={theme.primary} iconSize={22} />
                ) : (
                  <Feather name="help-circle" size={22} color={theme.textSecondary} />
                )}
                <ThemedText style={styles.groupTitle}>{g.title}</ThemedText>
                <ThemedText style={[styles.groupCount, { color: theme.textSecondary }]}>
                  {g.items.length} {g.items.length === 1 ? "Akku" : "Akkus"}
                </ThemedText>
              </View>
              {g.items.map(renderStat)}
            </View>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.kpi, { backgroundColor: theme.backgroundSecondary }]}>
      <ThemedText style={styles.kpiValue} numberOfLines={1}>
        {value}
      </ThemedText>
      <ThemedText style={[styles.kpiLabel, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  filterRow: { gap: Spacing.xs, paddingVertical: 2 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  filterText: { ...Typography.small },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.sm },
  groupTitle: { ...Typography.h4, flex: 1 },
  groupCount: { ...Typography.caption },
  card: { padding: Spacing.lg, gap: Spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  title: { ...Typography.body, fontWeight: "700" },
  sub: { ...Typography.caption },
  kpiRow: { flexDirection: "row", gap: Spacing.sm },
  kpi: {
    flex: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    alignItems: "center",
  },
  kpiValue: { ...Typography.body, fontWeight: "700" },
  kpiLabel: { ...Typography.caption },
  trendRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  trendLabel: { ...Typography.caption },
  trendValue: { ...Typography.small, fontWeight: "600" },
});
