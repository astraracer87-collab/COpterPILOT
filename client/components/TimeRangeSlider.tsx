import React, { useRef, useState, useCallback, useMemo } from "react";
import { View, Text, StyleSheet, PanResponder, GestureResponderEvent } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { SolarTimes } from "@/lib/solar";

const TOTAL_MINUTES = 24 * 60;
const SNAP_MIN = 15;
// Maximaler End-Wert. 1440 würde beim Serialisieren zu "00:00" kollabieren
// (Math.floor(1440/60)%24 = 0) und Start>Ende-Zustände verursachen.
const MAX_END_MIN = TOTAL_MINUTES - SNAP_MIN;
const TRACK_HEIGHT = 32;
const THUMB_SIZE = 26;

function fmt(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = ((min % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dateToMin(d: Date | null | undefined): number | null {
  if (!d) return null;
  return d.getHours() * 60 + d.getMinutes();
}

interface Props {
  startMin: number;
  endMin: number;
  onChange: (start: number, end: number) => void;
  solarTimes: SolarTimes | null;
  isDark: boolean;
  primaryColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  minStartMin?: number;
}

export default function TimeRangeSlider({
  startMin,
  endMin,
  onChange,
  solarTimes,
  isDark,
  primaryColor,
  textColor,
  mutedColor,
  borderColor,
  minStartMin = 0,
}: Props) {
  const minStartRef = useRef(minStartMin);
  minStartRef.current = minStartMin;
  const [width, setWidth] = useState(0);
  const draggingRef = useRef<"start" | "end" | null>(null);
  const lastSnapRef = useRef<number>(-1);
  const valuesRef = useRef({ startMin, endMin });
  valuesRef.current = { startMin, endMin };

  const widthRef = useRef(0);
  widthRef.current = width;

  const xToMin = useCallback((x: number) => {
    const w = widthRef.current;
    if (w <= 0) return 0;
    const clamped = Math.max(0, Math.min(w, x));
    const raw = (clamped / w) * TOTAL_MINUTES;
    return Math.round(raw / SNAP_MIN) * SNAP_MIN;
  }, []);

  const minToPct = useCallback((m: number) => Math.max(0, Math.min(100, (m / TOTAL_MINUTES) * 100)), []);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleStart = useCallback((evt: GestureResponderEvent) => {
    const x = evt.nativeEvent.locationX;
    const w = widthRef.current;
    if (w <= 0) return;
    const startX = (valuesRef.current.startMin / TOTAL_MINUTES) * w;
    const endX = (valuesRef.current.endMin / TOTAL_MINUTES) * w;
    const distStart = Math.abs(x - startX);
    const distEnd = Math.abs(x - endX);
    draggingRef.current = distStart <= distEnd ? "start" : "end";
    lastSnapRef.current = -1;

    const newMin = xToMin(x);
    if (draggingRef.current === "start") {
      const ns = Math.max(minStartRef.current, Math.min(newMin, valuesRef.current.endMin - SNAP_MIN));
      if (ns !== valuesRef.current.startMin) {
        lastSnapRef.current = ns;
        
        onChangeRef.current(ns, valuesRef.current.endMin);
      }
    } else {
      const ne = Math.min(MAX_END_MIN, Math.max(newMin, valuesRef.current.startMin + SNAP_MIN));
      if (ne !== valuesRef.current.endMin) {
        lastSnapRef.current = ne;
        
        onChangeRef.current(valuesRef.current.startMin, ne);
      }
    }
  }, [xToMin]);

  const handleMove = useCallback((evt: GestureResponderEvent) => {
    const x = evt.nativeEvent.locationX;
    const newMin = xToMin(x);
    if (draggingRef.current === "start") {
      const ns = Math.max(minStartRef.current, Math.min(newMin, valuesRef.current.endMin - SNAP_MIN));
      if (ns !== valuesRef.current.startMin) {
        if (ns !== lastSnapRef.current) {
          lastSnapRef.current = ns;
          
        }
        onChangeRef.current(ns, valuesRef.current.endMin);
      }
    } else if (draggingRef.current === "end") {
      const ne = Math.min(MAX_END_MIN, Math.max(newMin, valuesRef.current.startMin + SNAP_MIN));
      if (ne !== valuesRef.current.endMin) {
        if (ne !== lastSnapRef.current) {
          lastSnapRef.current = ne;
          
        }
        onChangeRef.current(valuesRef.current.startMin, ne);
      }
    }
  }, [xToMin]);

  const handleEnd = useCallback(() => {
    draggingRef.current = null;
    lastSnapRef.current = -1;
  }, []);

  const handlersRef = useRef({ handleStart, handleMove, handleEnd });
  handlersRef.current = { handleStart, handleMove, handleEnd };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => handlersRef.current.handleStart(e),
      onPanResponderMove: (e) => handlersRef.current.handleMove(e),
      onPanResponderRelease: () => handlersRef.current.handleEnd(),
      onPanResponderTerminate: () => handlersRef.current.handleEnd(),
    }),
  ).current;

  const phases = useMemo(() => {
    const dawn = dateToMin(solarTimes?.civilDawnStart) ?? 360;
    const sunrise = dateToMin(solarTimes?.sunrise) ?? 420;
    const sunset = dateToMin(solarTimes?.sunset) ?? 1200;
    const dusk = dateToMin(solarTimes?.civilDuskEnd) ?? 1260;
    return { dawn, sunrise, sunset, dusk };
  }, [solarTimes]);

  const colorNight = isDark ? "#1F2A45" : "#3B4F74";
  const colorTwilight = "#FF8C00";
  const colorDay = "#FFB820";
  const selectionColor = primaryColor;

  const startPct = minToPct(startMin);
  const endPct = minToPct(endMin);
  const dawnPct = minToPct(phases.dawn);
  const sunrisePct = minToPct(phases.sunrise);
  const sunsetPct = minToPct(phases.sunset);
  const duskPct = minToPct(phases.dusk);

  const hourTicks = [0, 6, 12, 18, 24];

  return (
    <View style={styles.root}>
      <View style={styles.solarLabels}>
        {solarTimes?.sunrise ? (
          <View style={[styles.solarLabel, { left: `${sunrisePct}%` }]}>
            <Feather name="sunrise" size={11} color="#FF8C00" />
            <Text style={[styles.solarLabelText, { color: mutedColor }]}>{fmt(phases.sunrise)}</Text>
          </View>
        ) : null}
        {solarTimes?.sunset ? (
          <View style={[styles.solarLabel, { left: `${sunsetPct}%` }]}>
            <Feather name="sunset" size={11} color="#FF8C00" />
            <Text style={[styles.solarLabelText, { color: mutedColor }]}>{fmt(phases.sunset)}</Text>
          </View>
        ) : null}
      </View>

      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.trackArea, { backgroundColor: isDark ? "rgba(20,20,30,0.4)" : "rgba(245,247,252,0.6)", borderColor }]}
        {...panResponder.panHandlers}
      >
        <View style={[StyleSheet.absoluteFill, { borderRadius: TRACK_HEIGHT / 2, overflow: "hidden" }]}>
          <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colorNight, opacity: 0.55 }} />
          {solarTimes?.civilDawnStart && solarTimes?.civilDuskEnd ? (
            <View style={{
              position: "absolute", top: 0, bottom: 0,
              left: `${dawnPct}%`,
              right: `${100 - duskPct}%`,
              backgroundColor: colorTwilight,
              opacity: 0.45,
            }} />
          ) : null}
          {solarTimes?.sunrise && solarTimes?.sunset ? (
            <View style={{
              position: "absolute", top: 0, bottom: 0,
              left: `${sunrisePct}%`,
              right: `${100 - sunsetPct}%`,
              backgroundColor: colorDay,
              opacity: 0.7,
            }} />
          ) : null}
        </View>

        <View style={{
          position: "absolute",
          top: 4, bottom: 4,
          left: `${startPct}%`,
          right: `${100 - endPct}%`,
          backgroundColor: selectionColor + "55",
          borderTopWidth: 2,
          borderBottomWidth: 2,
          borderColor: selectionColor,
        }} />

        <View style={[styles.thumb, { left: `${startPct}%`, backgroundColor: selectionColor, borderColor: isDark ? "#FFFFFF" : "#FFFFFF" }]} pointerEvents="none">
          <Feather name="chevron-left" size={14} color="#FFFFFF" />
        </View>
        <View style={[styles.thumb, { left: `${endPct}%`, backgroundColor: selectionColor, borderColor: isDark ? "#FFFFFF" : "#FFFFFF" }]} pointerEvents="none">
          <Feather name="chevron-right" size={14} color="#FFFFFF" />
        </View>
      </View>

      <View style={styles.hourTicksRow}>
        {hourTicks.map((h) => (
          <Text key={h} style={[styles.hourTickText, { color: mutedColor, left: `${(h / 24) * 100}%` }]}>
            {String(h).padStart(2, "0")}
          </Text>
        ))}
      </View>

      <View style={styles.valueRow}>
        <View style={styles.valueChip}>
          <Feather name="play" size={11} color={primaryColor} />
          <Text style={[styles.valueText, { color: textColor }]}>Start {fmt(startMin)}</Text>
        </View>
        <View style={styles.valueChip}>
          <Feather name="square" size={11} color={primaryColor} />
          <Text style={[styles.valueText, { color: textColor }]}>Ende {fmt(endMin)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    paddingTop: 4,
  },
  solarLabels: {
    height: 18,
    position: "relative",
    marginBottom: 4,
  },
  solarLabel: {
    position: "absolute",
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    transform: [{ translateX: -20 }],
  },
  solarLabelText: {
    fontSize: 10,
    fontWeight: "600",
  },
  trackArea: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    position: "relative",
    justifyContent: "center",
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
    marginLeft: -(THUMB_SIZE / 2),
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  hourTicksRow: {
    height: 16,
    position: "relative",
    marginTop: 4,
  },
  hourTickText: {
    position: "absolute",
    top: 0,
    fontSize: 10,
    fontWeight: "600",
    transform: [{ translateX: -8 }],
  },
  valueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  valueChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  valueText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
