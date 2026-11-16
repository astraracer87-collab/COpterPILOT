/**
 * Ein Ladevorgang: Kennzahlen, Endzellen und Verläufe (Ladestand,
 * Temperatur, Strom) aus der gespeicherten Zeitreihe.
 */
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { TrendChart } from "@/components/charger/TrendChart";
import { getChargeSession } from "@/lib/chargerStore";
import type { ChargeSession } from "@/lib/charger/chargeSession";
import { END_REASON_LABEL } from "@/lib/charger/batteryStats";
import type { ChargerStackParamList } from "@/navigation/ChargerStackNavigator";
import { formatDateTime } from "./ChargerBatteriesScreen";

export default function ChargerSessionDetailScreen() {
  const route =
    useRoute<RouteProp<ChargerStackParamList, "ChargerSessionDetail">>();
  const { theme } = useTheme();
  const [s, setS] = useState<ChargeSession | null>(null);

  useEffect(() => {
    void getChargeSession(route.params.sessionId)
      .then(setS)
      .catch(() => setS(null));
  }, [route.params.sessionId]);

  if (!s) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={{ padding: Spacing.lg, color: theme.textSecondary }}>
          Ladevorgang nicht gefunden.
        </ThemedText>
      </ThemedView>
    );
  }
  const t0 = s.startedAt;
  const min = (t: number) => (t - t0) / 60000;
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.title}>
          {formatDateTime(s.startedAt)} · Schacht {s.slot + 1} ·{" "}
          {s.battery?.label ?? "Akku nicht zugeordnet"}
        </ThemedText>
        <ThemedText style={[styles.sub, { color: theme.textSecondary }]}>
          {s.status === "active"
            ? "läuft"
            : (END_REASON_LABEL[s.endReason ?? ""] ?? s.endReason)}{" "}
          · {s.startPercent} → {s.endPercent} % · +{s.chargedMah} mAh · max{" "}
          {s.maxTempC} °C · max {s.maxCurrentA} A / {s.maxPowerW} W · Zyklen{" "}
          {s.cyclesStart}→{s.cyclesEnd} · Produktion {s.productionDate ?? "?"}
          {s.startedMidway ? " · Start nicht beobachtet" : ""}
          {s.gaps ? ` · ${s.gaps} Verbindungslücke(n)` : ""}
          {s.warnings.length ? ` · Warnungen: ${s.warnings.join(", ")}` : ""}
        </ThemedText>
        <ThemedText style={[styles.sub, { color: theme.textSecondary }]}>
          Endzellen:{" "}
          {s.endCellsMv.map((c) => `${(c / 1000).toFixed(3)} V`).join(" / ")} ·
          Δ {s.endCellDeltaMv ?? "–"} mV
        </ThemedText>
        <View style={styles.charts}>
          <TrendChart
            title="Ladestand"
            unit="%"
            points={s.series.map((p) => ({ x: min(p.t), y: p.soc }))}
          />
          <TrendChart
            title="Temperatur"
            unit="°C"
            points={s.series.map((p) => ({ x: min(p.t), y: p.temp }))}
            color={theme.statusNoGo}
          />
          <TrendChart
            title="Strom"
            unit="A"
            points={s.series.map((p) => ({ x: min(p.t), y: p.a }))}
            color={theme.statusCaution}
          />
          <TrendChart
            title="Zell-Spreizung"
            unit="mV"
            points={s.series
              .filter((p) => p.cells.some((c) => c > 0))
              .map((p) => ({
                x: min(p.t),
                y:
                  Math.max(...p.cells) -
                  Math.min(...p.cells.filter((c) => c > 0)),
              }))}
            color={theme.statusGo}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.sm, gap: Spacing.sm },
  title: { fontSize: 16, fontWeight: "700" },
  sub: { fontSize: 12 },
  charts: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
});
