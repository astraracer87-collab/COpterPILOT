/**
 * Kleines Liniendiagramm (react-native-svg, wie SunArcChart): Verlauf eines
 * Werts über die Zeit, mit Min/Max-Beschriftung und letztem Wert.
 */
import React, { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { downsampleSeries } from "@/lib/charger/chargeSession";

export interface TrendPoint {
  x: number;
  y: number;
}

/** Punkte in Pixel umrechnen (rein, testbar). Leere Spannen werden aufgeweitet. */
export function scalePoints(
  points: TrendPoint[],
  w: number,
  h: number,
  pad = 4,
): { px: number; py: number }[] {
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (x1 === x0) {
    x0 -= 1;
    x1 += 1;
  }
  if (y1 === y0) {
    y0 -= 1;
    y1 += 1;
  }
  return points.map((p) => ({
    px: pad + ((p.x - x0) / (x1 - x0)) * (w - 2 * pad),
    py: pad + (1 - (p.y - y0) / (y1 - y0)) * (h - 2 * pad),
  }));
}

export function TrendChart({
  title,
  unit,
  points,
  color,
  height = 64,
  maxPoints = 120,
  testID,
}: {
  title: string;
  unit: string;
  points: TrendPoint[];
  color?: string;
  height?: number;
  maxPoints?: number;
  testID?: string;
}) {
  const { theme } = useTheme();
  const [w, setW] = useState(0);
  const c = color ?? theme.primary;
  const pts = downsampleSeries(points, maxPoints);
  const scaled = w > 0 ? scalePoints(pts, w, height) : [];
  const last = pts[pts.length - 1];
  const ys = pts.map((p) => p.y);
  const fmt = (v: number) =>
    Math.abs(v) >= 100
      ? Math.round(v).toString()
      : (Math.round(v * 10) / 10).toLocaleString("de-DE");
  return (
    <View
      style={[
        styles.box,
        { borderColor: theme.border, backgroundColor: theme.backgroundDefault },
      ]}
      testID={testID}
    >
      <View style={styles.head}>
        <ThemedText
          style={[styles.title, { color: theme.textSecondary }]}
          numberOfLines={1}
        >
          {title}
        </ThemedText>
        <ThemedText style={styles.value}>
          {last ? `${fmt(last.y)} ${unit}` : "–"}
        </ThemedText>
      </View>
      <View
        style={{ height }}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      >
        {w > 0 && scaled.length > 0 ? (
          <Svg width={w} height={height}>
            <Line
              x1={0}
              y1={height - 1}
              x2={w}
              y2={height - 1}
              stroke={theme.border}
              strokeWidth={1}
            />
            {scaled.length > 1 ? (
              <Polyline
                points={scaled.map((p) => `${p.px},${p.py}`).join(" ")}
                fill="none"
                stroke={c}
                strokeWidth={2}
              />
            ) : null}
            {scaled.length <= 30
              ? scaled.map((p, i) => (
                  <Circle key={i} cx={p.px} cy={p.py} r={2.5} fill={c} />
                ))
              : null}
          </Svg>
        ) : (
          <ThemedText style={[styles.empty, { color: theme.textTertiary }]}>
            {pts.length === 0 ? "Noch keine Daten" : ""}
          </ThemedText>
        )}
      </View>
      {ys.length > 1 ? (
        <ThemedText style={[styles.range, { color: theme.textTertiary }]}>
          {fmt(Math.min(...ys))} – {fmt(Math.max(...ys))} {unit}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    gap: 4,
    minWidth: 180,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 4,
  },
  title: { fontSize: 12, fontWeight: "600", flex: 1 },
  value: { fontSize: 13, fontWeight: "700" },
  empty: { fontSize: 12, textAlign: "center", marginTop: 20 },
  range: { fontSize: 10 },
});
