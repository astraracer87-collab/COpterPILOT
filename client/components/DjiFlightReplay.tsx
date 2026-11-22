import React, { useEffect, useMemo, useRef, useState } from "react";
import { DjiLiveSticks, hasStickData } from "@/components/DjiStickVisualizer";
import { View, StyleSheet, Pressable, Platform } from "react-native";
import Slider from "@react-native-community/slider";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import DjiTracksMap from "@/components/DjiTracksMap";
import { DjiAttitudeIndicator } from "@/components/DjiAttitudeIndicator";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { DjiLogRecord } from "@/lib/storage";

const TRACK_COLOR = "#007AFF";
const SPEEDS = [1, 2, 4] as const;
const TICK_MS = 200;

/** True, wenn genug verortete Datensätze für eine Wiedergabe vorliegen. */
export function hasReplayData(records?: DjiLogRecord[]): boolean {
  if (!records) return false;
  let n = 0;
  for (const r of records) {
    if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      n++;
      if (n >= 2) return true;
    }
  }
  return false;
}

function fmt(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return "0:00";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function bearing(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (d: number) => (d * 180) / Math.PI;
  const dLon = toRad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function StatCell({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.cell}>
      <ThemedText style={[styles.cellValue, { color: theme.text }]}>{value}</ThemedText>
      <ThemedText style={[styles.cellLabel, { color: theme.textTertiary }]}>{label}</ThemedText>
    </View>
  );
}

/**
 * Flugwiedergabe ("Daumenkino"): ein bewegter Drohnen-Pfeil läuft den GPS-Pfad
 * nach, während künstlicher Horizont und Telemetrie synchron mitlaufen. Eine
 * Timeline (Play/Pause, Geschwindigkeit, Slider) steuert alles gemeinsam.
 */
export function DjiFlightReplay({ records }: { records: DjiLogRecord[] }) {
  const { theme, isDark } = useTheme();

  const frames = useMemo(
    () => records.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)),
    [records],
  );
  const len = frames.length;
  const withSticks = useMemo(() => hasStickData(records), [records]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const speed = SPEEDS[speedIdx];

  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (!playing || len < 2) return;
    const id = setInterval(() => {
      setIdx((i) => {
        const next = i + speed;
        return next >= len - 1 ? len - 1 : next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, len]);

  useEffect(() => {
    if (playing && idx >= len - 1) setPlaying(false);
  }, [idx, len, playing]);

  const clamped = Math.min(Math.max(0, idx), Math.max(0, len - 1));
  const cur = frames[clamped];
  const prev = frames[Math.max(0, clamped - 1)];

  const heading = useMemo(() => {
    if (!cur) return 0;
    if (Number.isFinite(cur.yaw)) return ((cur.yaw! % 360) + 360) % 360;
    if (prev && prev !== cur) {
      return bearing(prev.lat!, prev.lon!, cur.lat!, cur.lon!);
    }
    return 0;
  }, [cur, prev]);

  const allCoords = useMemo(
    () => frames.map((f) => ({ latitude: f.lat!, longitude: f.lon! })),
    [frames],
  );
  // Ganze Route blass, der geflogene Teil baut sich beim Abspielen kräftig auf
  const mapTracks = useMemo(() => [{ coords: allCoords, color: TRACK_COLOR + "40" }], [allCoords]);
  const progressCoords = useMemo(() => {
    const end = Math.min(Math.max(0, idx), allCoords.length - 1) + 1;
    // für flüssiges Zeichnen höchstens ~600 Punkte
    const part = allCoords.slice(0, end);
    if (part.length <= 600) return part;
    const step = part.length / 600;
    const out = [];
    for (let i = 0; i < 600; i++) out.push(part[Math.floor(i * step)]);
    out.push(part[part.length - 1]);
    return out;
  }, [allCoords, idx]);

  if (len < 2 || !cur) return null;

  const togglePlay = () => {
    if (idx >= len - 1) {
      setIdx(0);
      setPlaying(true);
    } else {
      setPlaying((v) => !v);
    }
  };

  const speedMs = cur.hSpeedMs;

  return (
    <View>
      <View>
        <DjiTracksMap
          tracks={mapTracks}
          progressCoords={progressCoords}
          progressColor={TRACK_COLOR}
          marker={{ latitude: cur.lat!, longitude: cur.lon!, heading, color: TRACK_COLOR }}
        />
        {/* Instrumente direkt in der Karte (unten), damit man nicht scrollen muss */}
        <View pointerEvents="none" style={styles.overlayWrap}>
          <View
            style={[
              styles.overlay,
              { backgroundColor: isDark ? "rgba(12,18,32,0.72)" : "rgba(255,255,255,0.8)" },
            ]}
          >
            <DjiAttitudeIndicator pitch={cur.pitch} roll={cur.roll} yaw={cur.yaw} size={96} />
            {withSticks ? <DjiLiveSticks records={records} t={cur.t ?? 0} size={72} /> : null}
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.stats}>
          <StatCell label="Zeit" value={fmt(cur.t)} />
          <StatCell label="Höhe" value={cur.heightM != null ? `${Math.round(cur.heightM)} m` : "–"} />
          <StatCell
            label="Speed"
            value={speedMs != null ? `${Math.round(speedMs * 3.6)} km/h` : "–"}
          />
          <StatCell label="Distanz" value={cur.distM != null ? `${Math.round(cur.distM)} m` : "–"} />
          <StatCell label="Akku" value={cur.battPct != null ? `${cur.battPct} %` : "–"} />
          <StatCell label="Sat" value={cur.sats != null ? `${cur.sats}` : "–"} />
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          testID="button-replay-play"
          onPress={togglePlay}
          style={({ pressed }) => [
            styles.playBtn,
            { backgroundColor: theme.primary },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Feather name={playing ? "pause" : "play"} size={18} color="#fff" />
        </Pressable>

        <Slider
          testID="slider-replay"
          style={styles.slider}
          minimumValue={0}
          maximumValue={len - 1}
          step={1}
          value={clamped}
          onSlidingStart={() => setPlaying(false)}
          onValueChange={(v) => setIdx(Math.round(v))}
          minimumTrackTintColor={theme.primary}
          maximumTrackTintColor={theme.border}
          thumbTintColor={Platform.OS === "android" ? theme.primary : undefined}
        />

        <Pressable
          testID="button-replay-speed"
          onPress={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          style={({ pressed }) => [
            styles.speedBtn,
            { borderColor: theme.border, backgroundColor: theme.background },
            pressed && { opacity: 0.7 },
          ]}
        >
          <ThemedText style={[styles.speedText, { color: theme.primary }]}>{`${speed}×`}</ThemedText>
        </Pressable>
      </View>

      <ThemedText style={[styles.timeLabel, { color: theme.textTertiary }]}>
        {`${fmt(cur.t)} / ${fmt(frames[len - 1].t)}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 8,
    alignItems: "center",
  },
  overlay: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: 14,
  },
  body: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.lg,
    marginTop: Spacing.md,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    flexShrink: 1,
    justifyContent: "center",
  },
  cell: {
    minWidth: 72,
    alignItems: "center",
  },
  cellValue: {
    ...Typography.body,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  cellLabel: {
    ...Typography.caption,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  slider: {
    flex: 1,
    height: 40,
  },
  speedBtn: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  speedText: {
    ...Typography.small,
    fontWeight: "700",
  },
  timeLabel: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.xs,
    fontVariant: ["tabular-nums"],
  },
});
