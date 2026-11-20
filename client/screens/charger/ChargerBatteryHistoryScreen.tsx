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
import { backfillCellData, getBatteryLinks, listChargeSessions, type SessionIndexEntry } from "@/lib/chargerStore";
import type { BatteryLink } from "@/lib/charger/batteryFingerprint";
import { getDrone, type DroneBattery } from "@/lib/storage";
import {
  cellHistory,
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
  const [link, setLink] = useState<BatteryLink | null>(null);
  const [droneName, setDroneName] = useState<string | null>(null);
  const [appBattery, setAppBattery] = useState<DroneBattery | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const l = (await getBatteryLinks().catch(() => [])).find((x) => x.key === batteryKey) ?? null;
        const drone = l?.droneId ? await getDrone(l.droneId).catch(() => null) : null;
        if (cancelled) return;
        setLink(l);
        setDroneName(drone?.name ?? null);
        setAppBattery(drone?.batteries?.find((b) => b.id === l?.batteryId) ?? null);
      })();
      return () => {
        cancelled = true;
      };
    }, [batteryKey]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listChargeSessions()
        .then(async (all) => {
          const mine = all.filter((e) =>
            batteryKey === UNASSIGNED_KEY ? !e.batteryKey : e.batteryKey === batteryKey,
          );
          if (cancelled) return;
          setEntries(mine);
          // Ältere Ladevorgänge: Zellwerte einmalig aus den gespeicherten Daten ergänzen
          const missing = mine.filter((e) => !("maxCellDeltaMv" in e)).map((e) => e.id);
          if (missing.length === 0) return;
          const filled = await backfillCellData(missing);
          if (cancelled) return;
          const byId = new Map(filled.map((e) => [e.id, e]));
          setEntries(mine.map((e) => byId.get(e.id) ?? e));
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [batteryKey]),
  );

  const stats = computeBatteryStats(entries);
  const trend = trendSeries(entries);
  const cells = cellHistory(entries);

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
        {batteryKey !== UNASSIGNED_KEY ? (
          <View style={[styles.dataCard, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]} testID="battery-data-card">
            <ThemedText style={styles.rowTitle}>Akku-Daten</ThemedText>
            {[
              ["Drohne", droneName],
              ["Produktionsdatum", link?.productionDate ? formatDay(link.productionDate) : null],
              ["Ladezyklen (Akku)", link ? String(Math.max(link.lastCycles, stats.cycles ?? 0)) : stats.cycles != null ? String(stats.cycles) : null],
              ["Seriennummer", link?.djiSerial || appBattery?.serialNumber || null],
              ["Zuletzt im Ladegerät", link?.lastSeenAt ? formatDateTime(link.lastSeenAt) : null],
              ["Angelegt", appBattery?.createdAt ? formatDay(appBattery.createdAt) : null],
              ["Kapazität bei 100 %", stats.lastFullMah != null ? `${Math.round(stats.lastFullMah)} mAh${stats.bestFullMah != null && stats.bestFullMah !== stats.lastFullMah ? ` (Bestwert ${Math.round(stats.bestFullMah)} mAh)` : ""}` : null],
              ["Zell-Spreizung (letztes Volladen)", stats.lastFullDeltaMv != null ? `${stats.lastFullDeltaMv} mV` : null],
              ["Höchsttemperatur", stats.maxTempC != null ? `${stats.maxTempC} °C` : null],
            ].map(([k, v]) => (
              <View key={k as string} style={styles.dataRow}>
                <ThemedText style={[styles.sub, { color: theme.textSecondary, flex: 1 }]}>{k}</ThemedText>
                <ThemedText style={styles.dataValue}>{(v as string | null) ?? "–"}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}
        {cells.cells > 0 ? (
          <View style={[styles.dataCard, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]} testID="battery-cells-card">
            <ThemedText style={styles.rowTitle}>Zellen ({cells.cells}) – {cells.sessions} Ladevorgänge mit Zellwerten</ThemedText>
            <View style={styles.dataRow}>
              <ThemedText style={[styles.sub, styles.cellCol, { color: theme.textSecondary }]}>Zelle</ThemedText>
              <ThemedText style={[styles.sub, styles.cellCol, { color: theme.textSecondary }]}>Zuletzt (Ende)</ThemedText>
              <ThemedText style={[styles.sub, styles.cellCol, { color: theme.textSecondary }]}>Abw. vom Mittel</ThemedText>
              <ThemedText style={[styles.sub, styles.cellCol, { color: theme.textSecondary }]}>Schwächste</ThemedText>
            </View>
            {Array.from({ length: cells.cells }, (_, i) => {
              const dev = cells.deviationMv[i][cells.deviationMv[i].length - 1]?.y ?? null;
              const weakest = cells.lowestCount[i] > 0 && cells.lowestCount[i] === Math.max(...cells.lowestCount);
              return (
                <View key={i} style={styles.dataRow} testID={`battery-cell-row-${i + 1}`}>
                  <ThemedText style={[styles.dataValue, styles.cellCol]}>Z{i + 1}</ThemedText>
                  <ThemedText style={[styles.dataValue, styles.cellCol]}>
                    {cells.lastMv[i] != null ? `${(cells.lastMv[i]! / 1000).toFixed(3).replace(".", ",")} V` : "–"}
                  </ThemedText>
                  <ThemedText style={[styles.dataValue, styles.cellCol]}>{dev != null ? `${dev > 0 ? "+" : ""}${dev} mV` : "–"}</ThemedText>
                  <ThemedText style={[styles.dataValue, styles.cellCol, weakest ? { color: theme.statusCaution } : null]}>
                    {cells.lowestCount[i]}×
                  </ThemedText>
                </View>
              );
            })}
            <ThemedText style={[styles.sub, { color: theme.textTertiary }]}>
              Verlauf je Zelle: Abweichung vom Mittel aller Zellen am Ladeende. Driftet eine Zelle dauerhaft nach unten, altert sie schneller.
            </ThemedText>
            <View style={styles.charts}>
              {cells.deviationMv.map((pts, i) => (
                <TrendChart key={i} title={`Z${i + 1} – Abweichung`} unit="mV" points={pts} testID={`trend-cell-${i + 1}`} />
              ))}
              <TrendChart
                title="Größte Spreizung beim Laden"
                unit="mV"
                points={cells.maxDuringCharge}
                color={theme.statusCaution}
                testID="trend-max-spread"
              />
            </View>
          </View>
        ) : null}
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
  dataCard: { borderWidth: 1, borderRadius: BorderRadius.sm, padding: Spacing.sm, gap: 4 },
  dataRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  dataValue: { fontSize: 13, fontWeight: "600" },
  cellCol: { flex: 1 },
});

function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}
