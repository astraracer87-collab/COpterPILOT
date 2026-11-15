import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, TextInput, Pressable } from "react-native";
import Slider from "@react-native-community/slider";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import Checkbox from "@/components/Checkbox";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { DroneBattery, BatteryUsage } from "@/lib/storage";

export type BatteryBlockMode = "pre" | "post";

interface BatteryRowState {
  selected: boolean;
  percent: number;
}

interface Props {
  batteries: DroneBattery[];
  mode: BatteryBlockMode;
  /** Vorab ausgewählte Akkus + Werte (z. B. aus dem Pre-Check beim Debriefing). */
  initial?: BatteryUsage[];
  onChange: (usage: BatteryUsage[]) => void;
}

export default function BatterySelectionBlock({ batteries, mode, initial, onChange }: Props) {
  const { theme } = useTheme();

  const [state, setState] = useState<Record<string, BatteryRowState>>(() => {
    const next: Record<string, BatteryRowState> = {};
    for (const b of batteries) {
      const prev = initial?.find((u) => u.batteryId === b.id);
      const wasSelected = !!prev;
      const prevPct = mode === "pre" ? prev?.percentBefore : prev?.percentAfter;
      next[b.id] = {
        selected: wasSelected,
        percent: typeof prevPct === "number" ? prevPct : mode === "pre" ? 100 : 0,
      };
    }
    return next;
  });

  const toUsage = useMemo(
    () => (s: Record<string, BatteryRowState>): BatteryUsage[] => {
      return batteries
        .filter((b) => s[b.id]?.selected)
        .map((b) => ({
          batteryId: b.id,
          name: b.name,
          serialNumber: b.serialNumber,
          ...(mode === "pre"
            ? { percentBefore: s[b.id].percent }
            : { percentAfter: s[b.id].percent }),
        }));
    },
    [batteries, mode],
  );

  useEffect(() => {
    onChange(toUsage(state));
    // intentionally only re-run when state changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (batteries.length === 0) return null;

  const title = mode === "pre" ? "Eingesetzte Akkus (Pre-Check)" : "Akkus nach Landung";
  const hint =
    mode === "pre"
      ? "Wähle die Akkus aus, die du in diesem Flug einsetzt, und gib den Startwert an."
      : "Wähle die verwendeten Akkus aus und gib den jeweiligen Endwert an.";

  return (
    <View style={styles.wrapper} testID={`battery-block-${mode}`}>
      <View style={styles.headerRow}>
        <Feather name="battery" size={18} color={theme.primary} />
        <ThemedText style={styles.title}>{title}</ThemedText>
      </View>
      <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>{hint}</ThemedText>

      <Card style={styles.card}>
        {batteries.map((b, idx) => {
          const row = state[b.id] || { selected: false, percent: mode === "pre" ? 100 : 0 };
          const selected = row.selected;
          return (
            <View
              key={b.id}
              style={[
                styles.row,
                idx < batteries.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                },
              ]}
            >
              <Pressable
                onPress={() =>
                  setState((prev) => ({
                    ...prev,
                    [b.id]: { ...row, selected: !selected },
                  }))
                }
                style={styles.rowTop}
                testID={`battery-toggle-${b.id}`}
              >
                <Checkbox
                  checked={selected}
                  onPress={() =>
                    setState((prev) => ({
                      ...prev,
                      [b.id]: { ...row, selected: !selected },
                    }))
                  }
                />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.name}>{b.name}</ThemedText>
                  <ThemedText style={[styles.serial, { color: theme.textSecondary }]}>
                    SN: {b.serialNumber || "—"}
                  </ThemedText>
                </View>
              </Pressable>

              {selected ? (
                <View style={styles.controlRow}>
                  <Slider
                    testID={`battery-slider-${b.id}`}
                    style={styles.slider}
                    minimumValue={0}
                    maximumValue={100}
                    step={1}
                    value={row.percent}
                    onValueChange={(v) => {
                      const next = Math.round(v);
                      setState((prev) => ({
                        ...prev,
                        [b.id]: { ...row, percent: next },
                      }));
                    }}
                    minimumTrackTintColor={theme.primary}
                    maximumTrackTintColor={theme.border}
                  />
                  <View style={[styles.percentBox, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
                    <TextInput disableFullscreenUI
                      testID={`battery-input-${b.id}`}
                      style={[styles.percentInput, { color: theme.text }]}
                      keyboardType="numeric"
                      value={String(row.percent)}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, "");
                        const num = cleaned === "" ? 0 : Math.min(100, parseInt(cleaned, 10));
                        setState((prev) => ({
                          ...prev,
                          [b.id]: { ...row, percent: Number.isFinite(num) ? num : 0 },
                        }));
                      }}
                      maxLength={3}
                    />
                    <ThemedText style={[styles.percentSuffix, { color: theme.textSecondary }]}>%</ThemedText>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.xl },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: 4, marginLeft: Spacing.xs },
  title: { ...Typography.h4 },
  hint: { ...Typography.caption, marginBottom: Spacing.sm, marginLeft: Spacing.xs },
  card: { overflow: "hidden" },
  row: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, gap: Spacing.md },
  rowTop: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  name: { ...Typography.body, fontWeight: "600" },
  serial: { ...Typography.caption },
  controlRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  slider: { flex: 1, height: 36 },
  percentBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    minWidth: 70,
  },
  percentInput: {
    ...Typography.body,
    paddingVertical: Spacing.sm,
    minWidth: 38,
    textAlign: "center",
  },
  percentSuffix: { ...Typography.body, fontWeight: "600" },
});
