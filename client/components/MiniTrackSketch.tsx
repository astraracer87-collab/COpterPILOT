import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Polyline, Circle, Rect } from "react-native-svg";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import type { DjiMapTrack } from "@/components/DjiTracksMap";

/**
 * Leichte Routen-Skizze für Listen (z. B. die Massen-Import-Übersicht): zeichnet
 * die Flugspur als SVG-Linie in einem kleinen Kästchen. Kein natives Kartenobjekt,
 * damit auch bei vielen Logs kein Speicher-/Scroll-Problem entsteht.
 */
export default function MiniTrackSketch({
  tracks,
  height = 130,
}: {
  tracks: DjiMapTrack[];
  height?: number;
}) {
  const { theme } = useTheme();

  const paths = useMemo(() => {
    const pts: { lat: number; lon: number }[][] = tracks
      .map((t) => t.coords.map((c) => ({ lat: c.latitude, lon: c.longitude })))
      .filter((a) => a.length >= 2);
    if (pts.length === 0) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const seg of pts)
      for (const p of seg) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }
    const spanLat = Math.max(1e-6, maxLat - minLat);
    const spanLon = Math.max(1e-6, maxLon - minLon);
    // In ein 100×100-Feld einpassen, Längengrad nach Breite stauchen, Y gespiegelt
    const latMid = (minLat + maxLat) / 2;
    const cos = Math.max(0.2, Math.cos((latMid * Math.PI) / 180));
    const spanLonM = spanLon * cos;
    const span = Math.max(spanLat, spanLonM);
    const pad = 8;
    const scale = (100 - 2 * pad) / span;
    const project = (p: { lat: number; lon: number }) => ({
      x: pad + ((p.lon - minLon) * cos - (spanLonM - span) / 2) * scale,
      y: pad + (span - (p.lat - minLat) - (span - spanLat) / 2) * scale,
    });
    const segs = pts.map((seg, i) => ({
      color: tracks[i]?.color ?? theme.primary,
      points: seg.map(project).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "),
    }));
    const first = project(pts[0][0]);
    const lastSeg = pts[pts.length - 1];
    const last = project(lastSeg[lastSeg.length - 1]);
    return { segs, first, last };
  }, [tracks, theme.primary]);

  return (
    <View
      style={{
        height,
        borderRadius: 10,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.backgroundSecondary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {paths ? (
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          <Rect x={0} y={0} width={100} height={100} fill="transparent" />
          {paths.segs.map((s, i) => (
            <Polyline
              key={i}
              points={s.points}
              fill="none"
              stroke={s.color}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          <Circle cx={paths.first.x} cy={paths.first.y} r={2.4} fill="#34C759" />
          <Circle cx={paths.last.x} cy={paths.last.y} r={2.4} fill="#FF3B30" />
        </Svg>
      ) : (
        <ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>
          Kein GPS-Track
        </ThemedText>
      )}
    </View>
  );
}
