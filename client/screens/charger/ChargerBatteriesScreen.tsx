/**
 * Akku-Übersicht: alle Akkus (aller Drohnen und ohne Drohne) mit letztem
 * Ladevorgang, Zyklen und Zustand; Tippen öffnet die Ladehistorie.
 * Funktioniert ohne Verbindung zum Ladegerät.
 */
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  listAllBatteries,
  type AppBattery,
} from "@/lib/charger/batteryAccounts";
import { listChargeSessions, type SessionIndexEntry } from "@/lib/chargerStore";
import {
  computeBatteryStats,
  HEALTH_LABEL,
  type BatteryStats,
} from "@/lib/charger/batteryStats";
import type { ChargerStackParamList } from "@/navigation/ChargerStackNavigator";

type Nav = NativeStackNavigationProp<ChargerStackParamList, "ChargerBatteries">;

export const UNASSIGNED_KEY = "unassigned";

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChargerBatteriesScreen() {
  const navigation = useNavigation<Nav>();
  const { theme } = useTheme();
  const [rows, setRows] = useState<
    { battery: AppBattery; stats: BatteryStats }[]
  >([]);
  const [unassigned, setUnassigned] = useState<SessionIndexEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const [bats, entries] = await Promise.all([
          listAllBatteries().catch(() => []),
          listChargeSessions().catch(() => []),
        ]);
        if (cancelled) return;
        setRows(
          bats.map((b) => ({
            battery: b,
            stats: computeBatteryStats(
              entries.filter((e) => e.batteryKey === b.key),
            ),
          })),
        );
        setUnassigned(entries.filter((e) => !e.batteryKey));
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const healthColor = (h: BatteryStats["health"]) =>
    h === "good"
      ? theme.statusGo
      : h === "watch"
        ? theme.statusCaution
        : h === "bad"
          ? theme.statusNoGo
          : theme.textTertiary;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {loaded && rows.length === 0 ? (
          <ThemedText style={{ color: theme.textSecondary }}>
            Noch keine Akkus. Akkus legst du bei der Drohne an – oder beim
            ersten Laden über „Welcher Akku ist das?“ → „Neuer Akku“.
          </ThemedText>
        ) : null}
        <View style={styles.grid}>
          {rows.map(({ battery: b, stats: s }) => (
            <Pressable
              key={b.key}
              testID={`charger-battery-${b.key}`}
              onPress={() =>
                navigation.navigate("ChargerBatteryHistory", {
                  batteryKey: b.key,
                  label: b.label,
                })
              }
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: theme.backgroundDefault,
                  borderColor: theme.border,
                },
                pressed && { opacity: 0.75 },
              ]}
            >
              <View style={styles.cardHead}>
                <Feather name="battery" size={18} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.title} numberOfLines={1}>
                    {b.label}
                  </ThemedText>
                  <ThemedText
                    style={[styles.sub, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {b.droneName ?? "ohne Drohne"}
                    {b.serialNumber ? ` · SN ${b.serialNumber}` : ""}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.health,
                    { borderColor: healthColor(s.health) },
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.healthText,
                      { color: healthColor(s.health) },
                    ]}
                  >
                    {HEALTH_LABEL[s.health]}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.stats}>
                <Stat
                  label="Zyklen"
                  value={
                    s.cycles != null
                      ? String(s.cycles)
                      : b.link
                        ? String(b.link.lastCycles)
                        : "–"
                  }
                />
                <Stat
                  label="Zuletzt geladen"
                  value={
                    s.lastSession
                      ? formatDateTime(s.lastSession.startedAt)
                      : "–"
                  }
                />
                <Stat
                  label="Δ Zellen (voll)"
                  value={
                    s.lastFullDeltaMv != null ? `${s.lastFullDeltaMv} mV` : "–"
                  }
                />
                <Stat
                  label="Kap. bei 100 %"
                  value={s.lastFullMah != null ? `${s.lastFullMah} mAh` : "–"}
                />
              </View>
              <ThemedText style={[styles.sub, { color: theme.textTertiary }]}>
                {s.sessions} Ladevorgänge
                {b.link ? "" : " · noch nicht am Ladegerät erkannt"}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        {unassigned.length > 0 ? (
          <Pressable
            onPress={() =>
              navigation.navigate("ChargerBatteryHistory", {
                batteryKey: UNASSIGNED_KEY,
                label: "Nicht zugeordnet",
              })
            }
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundDefault,
                borderColor: theme.border,
              },
            ]}
            testID="charger-battery-unassigned"
          >
            <ThemedText style={styles.title}>
              Nicht zugeordnete Ladevorgänge ({unassigned.length})
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.stat}>
      <ThemedText style={[styles.statLabel, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
      <ThemedText style={styles.statValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.sm, gap: Spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  card: {
    flexGrow: 1,
    flexBasis: 300,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    gap: 6,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  title: { fontSize: 15, fontWeight: "700" },
  sub: { fontSize: 12 },
  health: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  healthText: { fontSize: 12, fontWeight: "700" },
  stats: { flexDirection: "row" },
  stat: { flex: 1 },
  statLabel: { fontSize: 10 },
  statValue: { fontSize: 13, fontWeight: "600" },
});
