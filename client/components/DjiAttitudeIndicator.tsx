import React from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Defs, ClipPath, Circle, G, Rect, Line, Polygon } from "react-native-svg";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import type { DjiLogRecord } from "@/lib/storage";

const SKY = "#3FA9F5";
const GROUND = "#7A5230";
const ACCENT = "#FFCC00";

/** Liefert true, wenn mindestens ein Record echte Fluglage-Daten enthält. */
export function hasAttitudeData(records?: DjiLogRecord[]): boolean {
  if (!records || records.length === 0) return false;
  return records.some((r) => Number.isFinite(r.pitch) || Number.isFinite(r.roll));
}

interface Props {
  pitch?: number; // Grad, + = Nase hoch
  roll?: number; // Grad, + = rechts
  yaw?: number; // Grad, 0–360
  size?: number;
  showReadout?: boolean;
}

/**
 * Künstlicher Horizont (Attitude Indicator) aus der tatsächlichen Fluglage des
 * DJI-Logs. Die Kugel kippt um den Roll-Winkel und verschiebt sich mit dem
 * Nick-Winkel; das feste gelbe Flugzeugsymbol bleibt zentriert.
 */
export function DjiAttitudeIndicator({
  pitch = 0,
  roll = 0,
  yaw,
  size = 180,
  showReadout = true,
}: Props) {
  const { theme } = useTheme();
  const p = Number.isFinite(pitch) ? pitch : 0;
  const r = Number.isFinite(roll) ? roll : 0;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 2;
  const pxPerDeg = radius / 45; // 45° Nick füllt den Radius
  const pitchOffset = p * pxPerDeg;
  const W = size * 3;
  const H = size * 3;
  const ladder = [10, 20, 30];

  const headingText =
    yaw !== undefined && Number.isFinite(yaw)
      ? `${Math.round(((yaw % 360) + 360) % 360)}°`
      : "–";

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <Defs>
          <ClipPath id="attClip">
            <Circle cx={cx} cy={cy} r={radius} />
          </ClipPath>
        </Defs>
        <G clipPath="url(#attClip)">
          <G rotation={-r} originX={cx} originY={cy}>
            <G translateY={pitchOffset}>
              <Rect x={cx - W / 2} y={cy - H} width={W} height={H} fill={SKY} />
              <Rect x={cx - W / 2} y={cy} width={W} height={H} fill={GROUND} />
              <Line
                x1={cx - W / 2}
                y1={cy}
                x2={cx + W / 2}
                y2={cy}
                stroke="#FFFFFF"
                strokeWidth={2}
              />
              {ladder.map((d) => {
                const up = cy - d * pxPerDeg;
                const down = cy + d * pxPerDeg;
                const len = d === 30 ? 18 : d === 20 ? 26 : 34;
                return (
                  <G key={`lad-${d}`}>
                    <Line
                      x1={cx - len}
                      y1={up}
                      x2={cx + len}
                      y2={up}
                      stroke="#FFFFFF"
                      strokeWidth={1}
                      strokeOpacity={0.75}
                    />
                    <Line
                      x1={cx - len}
                      y1={down}
                      x2={cx + len}
                      y2={down}
                      stroke="#FFFFFF"
                      strokeWidth={1}
                      strokeOpacity={0.75}
                    />
                  </G>
                );
              })}
            </G>
          </G>
        </G>

        {/* Roll-Zeiger (fest, oben) */}
        <Polygon
          points={`${cx - 7},${cy - radius + 2} ${cx + 7},${cy - radius + 2} ${cx},${cy - radius + 14}`}
          fill={ACCENT}
        />

        {/* Festes Flugzeugsymbol */}
        <Line x1={cx - 40} y1={cy} x2={cx - 14} y2={cy} stroke={ACCENT} strokeWidth={3} />
        <Line x1={cx + 14} y1={cy} x2={cx + 40} y2={cy} stroke={ACCENT} strokeWidth={3} />
        <Circle cx={cx} cy={cy} r={3} fill={ACCENT} />

        {/* Instrumentenring */}
        <Circle cx={cx} cy={cy} r={radius} stroke={theme.border} strokeWidth={2} fill="none" />
      </Svg>

      {showReadout ? (
        <ThemedText style={[styles.readout, { color: theme.textSecondary }]}>
          {`Nick ${p >= 0 ? "+" : ""}${Math.round(p)}°  ·  Roll ${r >= 0 ? "+" : ""}${Math.round(r)}°  ·  Kurs ${headingText}`}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  readout: {
    ...Typography.caption,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
});
