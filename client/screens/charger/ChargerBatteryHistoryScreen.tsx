/**
 * Ladehistorie eines Akkus: Trend-Diagramme (Zyklen, Zell-Spreizung am Ende,
 * Höchsttemperatur, geladene mAh) und Liste der Ladevorgänge.
 */
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { TrendChart } from "@/components/charger/TrendChart";
import { listChargeSessions, type SessionIndexEntry } from "@/lib/chargerStore";
import {
  computeBatteryStats,
  END_REASON_LABEL,
  HEALTH_LABEL,
  trendSeries,
} from "@/lib/charger/batteryStats";
import type { ChargerStackParamList } from "@/navigation/ChargerStackNavigator";
import { formatDateTime, UNASSIGNED_KEY } from "./ChargerBatteriesScreen";

type Nav = NativeStackNavigationProp<
  ChargerStackParamList,
  "ChargerBatteryHistory"
>;

export default function ChargerBatteryHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const route =
    useRoute<RouteProp<ChargerStackParamList, "ChargerBatteryHistory">>();
  const { theme } = useTheme();
  const { batteryKey, label } = route.params;
  const [entries, setEntries] = useState<SessionIndexEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listChargeSessions()
        .then((all) => {
          if (!cancelled)
            setEntries(
              all.filter((e) =>
                batteryKey === UNASSIGNED_KEY
                  ? !e.batteryKey
                  : e.batteryKey === batteryKey,
              ),
            );
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [batteryKey]),
  );

  const stats = computeBatteryStats(entries);
  const trend = trendSeries(entries);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.title}>{label ?? "Akku"}</ThemedText>
        <ThemedText style={[styles.sub, { color: theme.textSecondary }]}>
          {stats.sessions} Ladevorgänge · Zyklen {stats.cycles ?? "–"} · Zustand{" "}
          {HEALTH_LABEL[stats.health]}
          {stats.capacityRatio != null
            ? ` · Kapazität ${Math.round(stats.capacityRatio * 100)} % vom Bestwert`
            : ""}
        </ThemedText>
        <View style={styles.charts}>
          <TrendChart
            title="Zyklen"
            unit=""
            points={trend.cycles}
            testID="trend-cycles"
          />
          <TrendChart
            title="Zell-Spreizung am Ende"
            unit="mV"
            points={trend.imbalance}
            color={theme.statusCaution}
            testID="trend-imbalance"
          />
          <TrendChart
            title="Höchsttemperatur"
            unit="°C"
            points={trend.maxTemp}
            color={theme.statusNoGo}
            testID="trend-temp"
          />
          <TrendChart
            title="Geladen"
            unit="mAh"
            points={trend.chargedMah}
            color={theme.statusGo}
            testID="trend-mah"
          />
        </View>
        {entries.length === 0 ? (
          <ThemedText style={{ color: theme.textSecondary }}>
            Noch keine Ladevorgänge mit diesem Akku.
          </ThemedText>
        ) : null}
        {entries.map((e) => (
          <Pressable
            key={e.id}
            testID={`charge-session-${e.id}`}
            onPress={() =>
              navigation.navigate("ChargerSessionDetail", { sessionId: e.id })
            }
            style={({ pressed }) => [
              styles.row,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundDefault,
              },
              pressed && { opacity: 0.75 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.rowTitle}>
                {formatDateTime(e.startedAt)} · Schacht {e.slot + 1} ·{" "}
                {e.startPercent} → {e.endPercent} %
              </ThemedText>
              <ThemedText style={[styles.sub, { color: theme.textSecondary }]}>
                {e.status === "active"
                  ? "läuft"
                  : (END_REASON_LABEL[e.endReason ?? ""] ?? e.endReason)}
                {e.endedAt
                  ? ` · ${Math.round((e.endedAt - e.startedAt) / 60000)} min`
                  : ""}{" "}
                · +{e.chargedMah} mAh · max {e.maxTempC} °C · {e.maxPowerW} W
                {e.endCellDeltaMv != null ? ` · Δ ${e.endCellDeltaMv} mV` : ""}{" "}
                · Zyklen {e.cyclesStart}→{e.cyclesEnd}
              </ThemedText>
            </View>
            <Feather
              name="chevron-right"
              size={18}
              color={theme.textSecondary}
            />
          </Pressable>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.sm, gap: Spacing.sm },
  title: { fontSize: 18, fontWeight: "700" },
  sub: { fontSize: 12 },
  charts: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
  },
  rowTitle: { fontSize: 14, fontWeight: "600" },
});
