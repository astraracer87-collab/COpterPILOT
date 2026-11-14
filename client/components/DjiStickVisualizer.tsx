import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Rect, Line, Polyline, Circle } from "react-native-svg";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import type { DjiLogRecord } from "@/lib/storage";

const PAD_SIZE = 132;
const MARGIN = 8;

/** Liefert true, wenn mindestens ein Record Steuerknüppel-Daten enthält. */
export function hasStickData(records?: DjiLogRecord[]): boolean {
  if (!records || records.length === 0) return false;
  return records.some(
    (r) =>
      r.rudder !== undefined ||
      r.throttle !== undefined ||
      r.aileron !== undefined ||
      r.elevator !== undefined,
  );
}

interface PadProps {
  xs: number[];
  ys: number[];
  title: string;
  caption: string;
}

function StickPad({ xs, ys, title, caption }: PadProps) {
  const { theme } = useTheme();
  const size = PAD_SIZE;
  const half = size / 2;
  const reach = half - MARGIN;

  const points = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < xs.length; i++) {
      const px = half + xs[i] * reach;
      const py = half - ys[i] * reach;
      out.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return out.join(" ");
  }, [xs, ys, half, reach]);

  const lastX = xs.length ? half + xs[xs.length - 1] * reach : half;
  const lastY = ys.length ? half - ys[ys.length - 1] * reach : half;

  return (
    <View style={styles.pad}>
      <ThemedText style={[styles.padTitle, { color: theme.text }]}>{title}</ThemedText>
      <Svg width={size} height={size}>
        <Rect
          x={1}
          y={1}
          width={size - 2}
          height={size - 2}
          rx={12}
          stroke={theme.border}
          strokeWidth={1}
          fill={theme.backgroundSecondary}
        />
        <Line x1={half} y1={MARGIN} x2={half} y2={size - MARGIN} stroke={theme.border} strokeWidth={1} />
        <Line x1={MARGIN} y1={half} x2={size - MARGIN} y2={half} stroke={theme.border} strokeWidth={1} />
        {points ? (
          <Polyline
            points={points}
            fill="none"
            stroke={theme.primary}
            strokeWidth={1.2}
            strokeOpacity={0.45}
          />
        ) : null}
        <Circle cx={lastX} cy={lastY} r={4.5} fill={theme.primary} />
      </Svg>
      <ThemedText style={[styles.padCaption, { color: theme.textSecondary }]}>{caption}</ThemedText>
    </View>
  );
}

function maxAbsPct(arr: number[]): number {
  let m = 0;
  for (const v of arr) m = Math.max(m, Math.abs(v));
  return Math.round(m * 100);
}

/**
 * Grafische Darstellung der RC-Steuerknüppel-Eingaben eines DJI-Logs.
 * Linker Stick: Gas (vertikal) + Gier (horizontal).
 * Rechter Stick: Nick (vertikal) + Roll (horizontal).
 * Zeigt die Bewegungsspur über den gesamten Flug plus die letzte Position.
 */
export function DjiStickVisualizer({ records }: { records: DjiLogRecord[] }) {
  const { theme } = useTheme();

  const data = useMemo(() => {
    const lx: number[] = [];
    const ly: number[] = [];
    const rx: number[] = [];
    const ry: number[] = [];
    for (const r of records) {
      if (r.rudder !== undefined || r.throttle !== undefined) {
        lx.push(r.rudder ?? 0);
        ly.push(r.throttle ?? 0);
      }
      if (r.aileron !== undefined || r.elevator !== undefined) {
        rx.push(r.aileron ?? 0);
        ry.push(r.elevator ?? 0);
      }
    }
    return { lx, ly, rx, ry };
  }, [records]);

  if (data.lx.length === 0 && data.rx.length === 0) return null;

  return (
    <View>
      <View style={styles.row}>
        <StickPad xs={data.lx} ys={data.ly} title="Linker Stick" caption="Gas / Gier" />
        <StickPad xs={data.rx} ys={data.ry} title="Rechter Stick" caption="Nick / Roll" />
      </View>
      <ThemedText style={[styles.summary, { color: theme.textSecondary }]}>
        {`Max. Ausschlag: Gas ${maxAbsPct(data.ly)}% · Gier ${maxAbsPct(data.lx)}% · Nick ${maxAbsPct(data.ry)}% · Roll ${maxAbsPct(data.rx)}%`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.lg,
  },
  pad: {
    alignItems: "center",
  },
  padTitle: {
    ...Typography.small,
    fontWeight: "600",
    marginBottom: 4,
  },
  padCaption: {
    ...Typography.caption,
    marginTop: 4,
  },
  summary: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
});
