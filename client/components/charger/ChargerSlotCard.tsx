/**
 * Ein Schacht des MA331 (Live-Ansicht): Status, Ladestand, Kapazität, Zeit,
 * Strom, Leistung, Temperatur, Zyklen, Produktionsdatum, 4 Zellen mit
 * Spreizung und Packspannung. Fehler, Übertemperatur und Kälte sind farbig
 * hervorgehoben.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  cellDeltaMv,
  formatProductionDate,
  IsdtSlotState,
  slotSeverity,
  slotStateLabel,
  type IsdtSlot,
} from "@/lib/charger/ma331Protocol";

export const CELL_DELTA_WARN_MV = 30;
export const CELL_DELTA_BAD_MV = 60;
export const COLD_COLOR = "#22B8CF";

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")} h`;
}

const n1 = (x: number) =>
  x.toLocaleString("de-DE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
const n2 = (x: number) =>
  x.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

interface Props {
  index: number;
  slot: IsdtSlot | null;
  batteryLabel: string | null;
  sessionActive: boolean;
  onPressBattery?: () => void;
}

export function ChargerSlotCard({
  index,
  slot,
  batteryLabel,
  sessionActive,
  onPressBattery,
}: Props) {
  const { theme } = useTheme();
  const sev = slot ? slotSeverity(slot.state) : "normal";
  const accent =
    sev === "error" || sev === "hot"
      ? theme.statusNoGo
      : sev === "cold"
        ? COLD_COLOR
        : sev === "warn"
          ? theme.statusCaution
          : slot?.state === IsdtSlotState.Charging
            ? theme.statusCaution
            : sev === "ok"
              ? theme.statusGo
              : theme.textTertiary;
  const alarm = sev === "error" || sev === "hot" || sev === "cold";
  const cells = slot?.hasData ? slot.cellMillivolts : [];
  const delta = cellDeltaMv(cells);
  const deltaColor =
    delta == null
      ? theme.textSecondary
      : delta.delta >= CELL_DELTA_BAD_MV
        ? theme.statusNoGo
        : delta.delta >= CELL_DELTA_WARN_MV
          ? theme.statusCaution
          : theme.statusGo;

  return (
    <View
      testID={`charger-slot-${index}`}
      style={[
        styles.card,
        {
          backgroundColor: alarm
            ? sev === "cold"
              ? "rgba(34,184,207,0.12)"
              : theme.statusNoGoBackground
            : theme.backgroundDefault,
          borderColor: alarm ? accent : theme.border,
          borderWidth: alarm ? 2 : 1,
        },
      ]}
    >
      <View style={styles.head}>
        <ThemedText style={styles.slotTitle}>Schacht {index + 1}</ThemedText>
        <View
          style={[styles.pill, { backgroundColor: accent }]}
          testID={`charger-slot-${index}-state`}
        >
          {sev === "hot" ? (
            <Feather name="thermometer" size={12} color="#fff" />
          ) : sev === "cold" ? (
            <Feather name="cloud-snow" size={12} color="#fff" />
          ) : sev === "error" ? (
            <Feather name="alert-triangle" size={12} color="#fff" />
          ) : null}
          <ThemedText style={styles.pillText}>
            {slot ? slotStateLabel(slot.state) : "–"}
          </ThemedText>
        </View>
      </View>

      {slot?.hasData ? (
        <>
          <Pressable
            onPress={onPressBattery}
            disabled={!onPressBattery}
            style={styles.batteryRow}
            testID={`charger-slot-${index}-battery`}
          >
            <Feather name="battery" size={13} color={theme.textSecondary} />
            <ThemedText
              style={[
                styles.small,
                {
                  color: batteryLabel ? theme.text : theme.textSecondary,
                  flex: 1,
                },
              ]}
              numberOfLines={1}
            >
              {batteryLabel ?? "Akku nicht zugeordnet"}
            </ThemedText>
            {sessionActive ? (
              <Feather name="disc" size={12} color={theme.statusCaution} />
            ) : null}
          </Pressable>
          <View style={styles.socRow}>
            <ThemedText style={styles.soc}>{slot.socPercent} %</ThemedText>
            <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
              {slot.remainingMah} mAh
            </ThemedText>
          </View>
          <View
            style={[styles.bar, { backgroundColor: theme.backgroundTertiary }]}
          >
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(0, Math.min(100, slot.socPercent))}%`,
                  backgroundColor: accent,
                },
              ]}
            />
          </View>
          <View style={styles.grid}>
            <Cell label="Zeit" value={formatMinutes(slot.timeMinutes)} />
            <Cell label="Strom" value={`${n1(slot.currentA)} A`} />
            <Cell label="Leistung" value={`${n1(slot.powerW)} W`} />
            <Cell
              label="Temp."
              value={`${slot.temperatureC} °C`}
              color={
                sev === "hot"
                  ? theme.statusNoGo
                  : sev === "cold"
                    ? COLD_COLOR
                    : undefined
              }
            />
            <Cell label="Zyklen" value={String(slot.cycleCount)} />
            <Cell
              label="Prod."
              value={formatProductionDate(slot.productionDate)}
            />
          </View>
          <View style={[styles.cells, { borderTopColor: theme.border }]}>
            {cells.map((mv, i) => (
              <View key={i} style={styles.cellBox}>
                <ThemedText
                  style={[styles.tiny, { color: theme.textSecondary }]}
                >
                  Z{i + 1}
                </ThemedText>
                <ThemedText
                  style={[
                    styles.cellValue,
                    delta && delta.delta > 0 && mv === delta.min
                      ? { color: theme.primary }
                      : null,
                    delta && delta.delta > 0 && mv === delta.max
                      ? { color: theme.statusCaution }
                      : null,
                  ]}
                >
                  {n2(mv / 1000)}
                </ThemedText>
              </View>
            ))}
          </View>
          <View style={styles.footer}>
            <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
              Pack {n2(slot.packVoltageV)} V
            </ThemedText>
            <ThemedText
              style={[styles.small, { color: deltaColor, fontWeight: "700" }]}
              testID={`charger-slot-${index}-delta`}
            >
              Δ {delta ? delta.delta : "–"} mV
            </ThemedText>
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          <Feather
            name={
              slot?.state === IsdtSlotState.Error ? "alert-triangle" : "battery"
            }
            size={28}
            color={
              slot?.state === IsdtSlotState.Error
                ? theme.statusNoGo
                : theme.textTertiary
            }
          />
          <ThemedText
            style={[
              styles.small,
              { color: theme.textSecondary, textAlign: "center" },
            ]}
          >
            {slot?.state === IsdtSlotState.Error
              ? "Akku nicht lesbar / Fehler"
              : slot
                ? "Kein Akku"
                : "Keine Daten"}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function Cell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const { theme } = useTheme();
  return (
    <View style={styles.gridCell}>
      <ThemedText style={[styles.tiny, { color: theme.textSecondary }]}>
        {label}
      </ThemedText>
      <ThemedText
        style={[styles.value, color ? { color, fontWeight: "700" } : null]}
        numberOfLines={1}
      >
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: BorderRadius.md, padding: Spacing.sm, gap: 6 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.xs,
  },
  slotTitle: { fontSize: 14, fontWeight: "700" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pillText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  batteryRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  socRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  soc: { fontSize: 26, fontWeight: "700", lineHeight: 30 },
  bar: { height: 6, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  gridCell: { width: "33.33%", paddingVertical: 2 },
  value: { fontSize: 13, fontWeight: "600" },
  cells: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
  cellBox: { flex: 1, alignItems: "center" },
  cellValue: { fontSize: 13, fontWeight: "600" },
  footer: { flexDirection: "row", justifyContent: "space-between" },
  small: { fontSize: 12 },
  tiny: { fontSize: 10 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    minHeight: 120,
  },
});
