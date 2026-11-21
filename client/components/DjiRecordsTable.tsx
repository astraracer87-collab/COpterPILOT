import React, { useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { DjiLogRecord } from "@/lib/storage";

interface Column {
  key: string;
  label: string;
  width: number;
  fmt: (r: DjiLogRecord) => string;
}

const COLUMNS: Column[] = [
  { key: "t", label: "Zeit", width: 64, fmt: (r) => formatTime(r.t) },
  { key: "mode", label: "Modus", width: 92, fmt: (r) => r.mode ?? "—" },
  { key: "sats", label: "Sats", width: 46, fmt: (r) => numStr(r.sats, 0) },
  { key: "heightM", label: "Höhe m", width: 64, fmt: (r) => numStr(r.heightM, 1) },
  { key: "vpsM", label: "VPS m", width: 60, fmt: (r) => numStr(r.vpsM, 1) },
  { key: "altM", label: "MSL m", width: 64, fmt: (r) => numStr(r.altM, 1) },
  { key: "hSpeedMs", label: "H m/s", width: 56, fmt: (r) => numStr(r.hSpeedMs, 1) },
  { key: "vSpeedMs", label: "V m/s", width: 56, fmt: (r) => numStr(r.vSpeedMs, 1) },
  { key: "distM", label: "Dist m", width: 64, fmt: (r) => numStr(r.distM, 0) },
  { key: "battPct", label: "Akku %", width: 58, fmt: (r) => numStr(r.battPct, 0) },
  { key: "battV", label: "Volt", width: 56, fmt: (r) => numStr(r.battV, 2) },
  { key: "throttle", label: "Gas %", width: 56, fmt: (r) => stickStr(r.throttle) },
  { key: "rudder", label: "Gier %", width: 56, fmt: (r) => stickStr(r.rudder) },
  { key: "elevator", label: "Nick %", width: 56, fmt: (r) => stickStr(r.elevator) },
  { key: "aileron", label: "Roll %", width: 56, fmt: (r) => stickStr(r.aileron) },
  {
    key: "cells",
    label: "Zellen V",
    width: 130,
    fmt: (r) => (r.cells && r.cells.length ? r.cells.map((c) => c.toFixed(2)).join(" ") : "—"),
  },
];

function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function numStr(v: number | undefined, decimals: number): string {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return v.toFixed(decimals);
}

function stickStr(v: number | undefined): string {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return Math.round(v * 100).toString();
}

export const COLLAPSED_ROWS = 12;
/** Pro Tipp zusätzlich gerenderte Zeilen (bis ~900 × 16 Zellen auf einmal sprengen die RC). */
export const ROWS_PER_PAGE = 100;

const RecordRow = React.memo(function RecordRow({
  r,
  odd,
  borderColor,
  stripeColor,
}: {
  r: DjiLogRecord;
  odd: boolean;
  borderColor: string;
  stripeColor: string;
}) {
  return (
    <View
      style={[
        styles.dataRow,
        { borderColor, backgroundColor: odd ? stripeColor : "transparent" },
      ]}
    >
      {COLUMNS.map((c) => (
        <ThemedText key={c.key} style={[styles.dataCell, { width: c.width }]} numberOfLines={1}>
          {c.fmt(r)}
        </ThemedText>
      ))}
    </View>
  );
});

/**
 * Tabellarische Detailauswertung eines DJI-Logs (à la phantomhelp.com).
 * Horizontal scrollbar; standardmäßig auf wenige Zeilen reduziert, per Tipp
 * seitenweise (ROWS_PER_PAGE) erweiterbar.
 */
export function DjiRecordsTable({ records }: { records: DjiLogRecord[] }) {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(COLLAPSED_ROWS);

  const rows = useMemo(() => (records ?? []).slice(0, visible), [records, visible]);
  const total = records?.length ?? 0;
  const remaining = Math.max(0, total - visible);

  if (!records || records.length === 0) {
    return (
      <ThemedText style={[styles.empty, { color: theme.textSecondary }]}>
        Keine Detaildaten verfügbar.
      </ThemedText>
    );
  }

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.headerRow, { borderColor: theme.border }]}>
            {COLUMNS.map((c) => (
              <ThemedText
                key={c.key}
                style={[styles.headerCell, { width: c.width, color: theme.textSecondary }]}
                numberOfLines={1}
              >
                {c.label}
              </ThemedText>
            ))}
          </View>
          {rows.map((r, i) => (
            <RecordRow
              key={`${r.t}-${i}`}
              r={r}
              odd={i % 2 === 1}
              borderColor={theme.border}
              stripeColor={theme.backgroundSecondary}
            />
          ))}
        </View>
      </ScrollView>
      {total > COLLAPSED_ROWS ? (
        <View style={styles.toggleRow}>
          {remaining > 0 ? (
            <Pressable
              testID="button-dji-table-toggle"
              onPress={() => setVisible((v) => Math.min(total, v + ROWS_PER_PAGE))}
              style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
            >
              <ThemedText style={[styles.toggleText, { color: theme.primary }]}>
                {`${Math.min(ROWS_PER_PAGE, remaining)} weitere anzeigen (${rows.length} von ${total})`}
              </ThemedText>
            </Pressable>
          ) : null}
          {visible > COLLAPSED_ROWS ? (
            <Pressable
              testID="button-dji-table-collapse"
              onPress={() => setVisible(COLLAPSED_ROWS)}
              style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
            >
              <ThemedText style={[styles.toggleText, { color: theme.primary }]}>Weniger anzeigen</ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingBottom: Spacing.xs,
    marginBottom: 2,
  },
  headerCell: {
    ...Typography.caption,
    fontWeight: "700",
    paddingHorizontal: 4,
  },
  dataRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
    borderRadius: 2,
  },
  dataCell: {
    ...Typography.caption,
    paddingHorizontal: 4,
  },
  toggleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: Spacing.lg,
  },
  toggle: {
    paddingVertical: Spacing.sm,
    alignItems: "center",
    marginTop: Spacing.xs,
  },
  toggleText: {
    ...Typography.small,
    fontWeight: "600",
  },
});
