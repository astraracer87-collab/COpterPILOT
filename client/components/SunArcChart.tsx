import React, { useMemo, useState, useRef, useCallback } from "react";
import { View, StyleSheet, LayoutChangeEvent, PanResponder, GestureResponderEvent } from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText, Rect, Defs, LinearGradient, Stop, ClipPath, G } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { hourlySunArc, SunArcSample, formatSolarTime, computeSunElevation } from "@/lib/solar";

export interface TempSample {
  time: Date;
  tempC: number;
}

interface Props {
  lat: number;
  lon: number;
  date?: Date;
  /** Optionaler Highlight-Zeitpunkt (z.B. geplante Flugzeit). Default: jetzt. */
  highlightTime?: Date;
  width?: number;
  height?: number;
  /** Optionale Temperaturkurve (2m) für denselben Tag — wird auf rechter Achse als Linie eingeblendet. */
  tempSeries?: TempSample[];
  sunrise?: Date | null;
  sunset?: Date | null;
  dayLengthMinutes?: number | null;
  /** Range-Modus: zwei verschiebbare Vertikale (Start/Ende) mit schattiertem Bereich. */
  rangeStart?: Date;
  rangeEnd?: Date;
  /** Callback bei Drag (snapped auf snapMinutes). */
  onRangeChange?: (start: Date, end: Date) => void;
  /** Frühester erlaubter Start (z.B. "jetzt" wenn isToday). */
  minStart?: Date;
  snapMinutes?: number;
  /** Startlinie fixieren (Pre-Flight: "sofortiger Start ab jetzt") — nur Ende verschiebbar. */
  lockStart?: boolean;
}

const PADDING = { left: 32, right: 36, top: 22, bottom: 30 };
const HANDLE_TOUCH_W = 36;

export default function SunArcChart({
  lat, lon, date, highlightTime, width: widthProp, height = 200,
  tempSeries, sunrise, sunset, dayLengthMinutes,
  rangeStart, rangeEnd, onRangeChange, minStart, snapMinutes = 15, lockStart = false,
}: Props) {
  const [measured, setMeasured] = useState<number>(0);
  const width = widthProp ?? (measured > 0 ? measured : 320);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - measured) > 1) setMeasured(w);
  };
  const { theme } = useTheme();
  const samples: SunArcSample[] = useMemo(() => hourlySunArc(lat, lon, date, 15), [lat, lon, date]);

  const highlight = highlightTime ?? new Date();
  const isRangeMode = !!(rangeStart && rangeEnd && onRangeChange);

  const dayStart = samples[0].time.getTime();
  const dayEnd = samples[samples.length - 1].time.getTime();
  const dayRange = dayEnd - dayStart;

  const snapMs = snapMinutes * 60 * 1000;

  // Sichtbares Zeitfenster: im Range-Modus auf das Flugfenster (mit Rand) zoomen,
  // sonst der ganze Tag. Mindestbreite so gewählt, dass ein ~3h-Fenster komfortabel passt.
  const committedView = useMemo(() => {
    if (!isRangeMode || !rangeStart || !rangeEnd) return { start: dayStart, end: dayEnd };
    const s = rangeStart.getTime();
    const e = rangeEnd.getTime();
    const win = Math.max(snapMs, e - s);
    const margin = Math.max(45 * 60 * 1000, win * 0.35);
    let vs = s - margin;
    let ve = e + margin;
    const MIN_VIEW = 2 * 60 * 60 * 1000;
    if (ve - vs < MIN_VIEW) {
      const mid = (s + e) / 2;
      vs = mid - MIN_VIEW / 2;
      ve = mid + MIN_VIEW / 2;
    }
    // In die Tagesgrenzen schieben (Sun-Samples existieren nur 00:00–24:00).
    if (vs < dayStart) { ve += dayStart - vs; vs = dayStart; }
    if (ve > dayEnd) { vs -= ve - dayEnd; ve = dayEnd; }
    vs = Math.max(dayStart, vs);
    ve = Math.min(dayEnd, ve);
    return { start: vs, end: ve };
  }, [isRangeMode, rangeStart, rangeEnd, dayStart, dayEnd, snapMs]);

  const committedViewRef = useRef(committedView);
  committedViewRef.current = committedView;
  // Während eines Drags wird der Ausschnitt eingefroren, damit die Achse nicht
  // mitten in der Geste neu skaliert; nach dem Loslassen zoomt sie neu.
  const [frozenView, setFrozenView] = useState<{ start: number; end: number } | null>(null);
  const view = frozenView ?? committedView;
  const viewStart = view.start;
  const viewEnd = view.end;
  const viewRange = Math.max(1, viewEnd - viewStart);

  const maxElev = Math.max(15, ...samples.map((s) => s.elevationDeg));
  const minElev = Math.min(-18, ...samples.map((s) => s.elevationDeg));
  const elevRange = maxElev - minElev;

  const innerW = Math.max(1, width - PADDING.left - PADDING.right);
  const innerH = Math.max(1, height - PADDING.top - PADDING.bottom);

  const xFor = (t: number) => PADDING.left + ((t - viewStart) / viewRange) * innerW;
  const inPlot = (x: number | null | undefined) => x != null && x >= PADDING.left - 1 && x <= width - PADDING.right + 1;
  const yFor = (elev: number) => PADDING.top + innerH - ((elev - minElev) / elevRange) * innerH;
  const yHorizon = yFor(0);

  const pathD = useMemo(() => {
    return samples
      .map((s, i) => {
        const x = xFor(s.time.getTime());
        const y = yFor(s.elevationDeg);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [samples, viewStart, viewRange, minElev, elevRange, innerW, innerH, width, height]);

  const fillD = `${pathD} L${xFor(dayEnd).toFixed(1)},${yHorizon.toFixed(1)} L${xFor(dayStart).toFixed(1)},${yHorizon.toFixed(1)} Z`;

  const hx = xFor(highlight.getTime());
  const hElev = computeSunElevation(lat, lon, highlight);
  const hy = yFor(hElev);

  const sunColor = "#FFB820";
  const twilightColor = "#FF8C00";
  const nightColor = "#3B4F74";
  const tempColor = "#FF453A";

  const tempFiltered = useMemo(() => {
    if (!tempSeries || tempSeries.length === 0) return [];
    const lo = (isRangeMode ? viewStart : dayStart) - 60 * 60 * 1000;
    const hi = (isRangeMode ? viewEnd : dayEnd) + 60 * 60 * 1000;
    return tempSeries
      .map((s) => ({ t: s.time.getTime(), v: s.tempC }))
      .filter((s) => s.t >= lo && s.t <= hi)
      .sort((a, b) => a.t - b.t);
  }, [tempSeries, dayStart, dayEnd, isRangeMode, viewStart, viewEnd]);

  const tempBounds = useMemo(() => {
    if (tempFiltered.length === 0) return null;
    let lo = Infinity, hi = -Infinity;
    for (const s of tempFiltered) { if (s.v < lo) lo = s.v; if (s.v > hi) hi = s.v; }
    const padR = Math.max(1, (hi - lo) * 0.15);
    const min = Math.floor(lo - padR);
    const max = Math.ceil(hi + padR);
    return { min, max, range: Math.max(1, max - min) };
  }, [tempFiltered]);

  const yForTemp = (c: number) => {
    if (!tempBounds) return yHorizon;
    return PADDING.top + innerH - ((c - tempBounds.min) / tempBounds.range) * innerH;
  };

  const tempPathD = useMemo(() => {
    if (tempFiltered.length === 0 || !tempBounds) return "";
    return tempFiltered
      .map((s, i) => `${i === 0 ? "M" : "L"}${xFor(s.t).toFixed(1)},${yForTemp(s.v).toFixed(1)}`)
      .join(" ");
  }, [tempFiltered, tempBounds, viewStart, viewRange, innerW, innerH, width, height]);

  const highlightTempC: number | null = useMemo(() => {
    if (tempFiltered.length === 0) return null;
    const t = highlight.getTime();
    if (t <= tempFiltered[0].t) return tempFiltered[0].v;
    if (t >= tempFiltered[tempFiltered.length - 1].t) return tempFiltered[tempFiltered.length - 1].v;
    for (let i = 1; i < tempFiltered.length; i++) {
      const a = tempFiltered[i - 1], b = tempFiltered[i];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / Math.max(1, b.t - a.t);
        return a.v + (b.v - a.v) * f;
      }
    }
    return null;
  }, [tempFiltered, highlight]);

  const fmtHM = (d: Date | null | undefined) =>
    d ? `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}` : "--:--";

  const xSunrise = sunrise ? xFor(sunrise.getTime()) : null;
  const xSunset = sunset ? xFor(sunset.getTime()) : null;
  const showSunMarkers = inPlot(xSunrise) || inPlot(xSunset);

  // Stundenraster passend zum sichtbaren Fenster (statt fix 0/6/12/18/24).
  const hourTicks = useMemo(() => {
    if (!isRangeMode) return [0, 6, 12, 18, 24].map((h) => dayStart + h * 3600000);
    const stepH = viewRange / 3600000 > 8 ? 2 : 1;
    const ticks: number[] = [];
    for (let h = 0; h <= 24; h += stepH) {
      const t = dayStart + h * 3600000;
      if (t >= viewStart - 1 && t <= viewEnd + 1) ticks.push(t);
    }
    return ticks;
  }, [isRangeMode, dayStart, viewStart, viewEnd, viewRange]);

  // ====== RANGE MODE: drag handles ======
  const rangeStartT = rangeStart?.getTime() ?? dayStart;
  const rangeEndT = rangeEnd?.getTime() ?? dayEnd;
  const minStartT = minStart ? Math.max(dayStart, minStart.getTime()) : dayStart;

  const xToTime = useCallback((x: number): number => {
    const clamped = Math.max(PADDING.left, Math.min(width - PADDING.right, x));
    const frac = (clamped - PADDING.left) / innerW;
    const raw = viewStart + frac * viewRange;
    return Math.round(raw / snapMs) * snapMs;
  }, [width, innerW, viewStart, viewRange, snapMs]);

  const draggingRef = useRef<"start" | "end" | null>(null);
  const lastSnapRef = useRef<number>(-1);
  const valuesRef = useRef({ rangeStartT, rangeEndT });
  valuesRef.current = { rangeStartT, rangeEndT };
  const cbRef = useRef(onRangeChange);
  cbRef.current = onRangeChange;
  const minStartRef = useRef(minStartT);
  minStartRef.current = minStartT;

  const pickHandle = useCallback((x: number) => {
    if (lockStart) return "end";
    const xs = xFor(valuesRef.current.rangeStartT);
    const xe = xFor(valuesRef.current.rangeEndT);
    return Math.abs(x - xs) <= Math.abs(x - xe) ? "start" : "end";
  }, [xFor, lockStart]);

  const applyDrag = useCallback((which: "start" | "end", x: number) => {
    const t = xToTime(x);
    const cb = cbRef.current;
    if (!cb) return;
    if (which === "start") {
      const ns = Math.max(minStartRef.current, Math.min(t, valuesRef.current.rangeEndT - snapMs));
      if (ns !== valuesRef.current.rangeStartT) {
        if (ns !== lastSnapRef.current) {
          lastSnapRef.current = ns;
          Haptics.selectionAsync().catch(() => {});
        }
        cb(new Date(ns), new Date(valuesRef.current.rangeEndT));
      }
    } else {
      const ne = Math.min(dayEnd, Math.max(t, valuesRef.current.rangeStartT + snapMs));
      if (ne !== valuesRef.current.rangeEndT) {
        if (ne !== lastSnapRef.current) {
          lastSnapRef.current = ne;
          Haptics.selectionAsync().catch(() => {});
        }
        cb(new Date(valuesRef.current.rangeStartT), new Date(ne));
      }
    }
  }, [xToTime, dayEnd, snapMs]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => isRangeMode,
    onMoveShouldSetPanResponder: () => isRangeMode,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      setFrozenView(committedViewRef.current);
      const x = e.nativeEvent.locationX;
      draggingRef.current = pickHandle(x);
      lastSnapRef.current = -1;
      applyDrag(draggingRef.current, x);
    },
    onPanResponderMove: (e: GestureResponderEvent) => {
      if (!draggingRef.current) return;
      applyDrag(draggingRef.current, e.nativeEvent.locationX);
    },
    onPanResponderRelease: () => { draggingRef.current = null; lastSnapRef.current = -1; setFrozenView(null); },
    onPanResponderTerminate: () => { draggingRef.current = null; lastSnapRef.current = -1; setFrozenView(null); },
  }), [isRangeMode, pickHandle, applyDrag]);

  const xRangeStart = isRangeMode ? xFor(rangeStartT) : 0;
  const xRangeEnd = isRangeMode ? xFor(rangeEndT) : 0;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="sunFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={sunColor} stopOpacity="0.55" />
            <Stop offset="1" stopColor={sunColor} stopOpacity="0.05" />
          </LinearGradient>
          <ClipPath id="plotClip">
            <Rect x={PADDING.left} y={0} width={innerW} height={height} />
          </ClipPath>
        </Defs>

        {/* Horizont-Linie */}
        <Line x1={PADDING.left} y1={yHorizon} x2={width - PADDING.right} y2={yHorizon}
          stroke={theme.border} strokeWidth={1} strokeDasharray="3,3" />

        {/* Bürgerliche Dämmerung -6° */}
        {minElev < -6 ? (
          <Line x1={PADDING.left} y1={yFor(-6)} x2={width - PADDING.right} y2={yFor(-6)}
            stroke={twilightColor} strokeWidth={0.5} strokeDasharray="2,4" opacity={0.4} />
        ) : null}

        <G clipPath="url(#plotClip)">
          <Path d={fillD} fill="url(#sunFill)" />
          <Path d={pathD} stroke={sunColor} strokeWidth={2} fill="none" />

          {tempPathD ? (
            <Path d={tempPathD} stroke={tempColor} strokeWidth={1.6} fill="none" strokeDasharray="4,3" opacity={0.9} />
          ) : null}
        </G>

        {/* Sonnenaufgang Marker: halbe Sonne über Horizont + Pfeil hoch */}
        {xSunrise != null && inPlot(xSunrise) ? (
          <>
            <Path
              d={`M${xSunrise - 5},${yHorizon} A5,5 0 0 1 ${xSunrise + 5},${yHorizon} Z`}
              fill={sunColor}
            />
            <Line x1={xSunrise - 7} y1={yHorizon} x2={xSunrise + 7} y2={yHorizon} stroke={twilightColor} strokeWidth={1.2} />
            {[-8, -5, -2].map((dy, i) => (
              <Line key={`sr-r-${i}`} x1={xSunrise - 8 - i} y1={yHorizon - 3 + dy} x2={xSunrise - 6 - i} y2={yHorizon - 3 + dy} stroke={sunColor} strokeWidth={1} />
            ))}
            <Path d={`M${xSunrise - 3},${yHorizon + 11} L${xSunrise},${yHorizon + 7} L${xSunrise + 3},${yHorizon + 11}`}
              stroke={twilightColor} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <SvgText x={xSunrise} y={yHorizon + 22} fontSize={9} fontWeight="700" fill={twilightColor} textAnchor="middle">
              {fmtHM(sunrise)}
            </SvgText>
          </>
        ) : null}
        {/* Sonnenuntergang Marker: halbe Sonne sinkt + Pfeil runter */}
        {xSunset != null && inPlot(xSunset) ? (
          <>
            <Path
              d={`M${xSunset - 5},${yHorizon} A5,5 0 0 1 ${xSunset + 5},${yHorizon} Z`}
              fill={twilightColor}
              opacity={0.85}
            />
            <Line x1={xSunset - 7} y1={yHorizon} x2={xSunset + 7} y2={yHorizon} stroke={twilightColor} strokeWidth={1.2} />
            <Path d={`M${xSunset - 3},${yHorizon + 7} L${xSunset},${yHorizon + 11} L${xSunset + 3},${yHorizon + 7}`}
              stroke={twilightColor} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <SvgText x={xSunset} y={yHorizon + 22} fontSize={9} fontWeight="700" fill={twilightColor} textAnchor="middle">
              {fmtHM(sunset)}
            </SvgText>
          </>
        ) : null}

        {/* Stundenraster (passt sich dem sichtbaren Fenster an) */}
        {hourTicks.map((t) => {
          const x = xFor(t);
          if (!inPlot(x)) return null;
          if (showSunMarkers) {
            if (xSunrise != null && Math.abs(x - xSunrise) < 22) return null;
            if (xSunset != null && Math.abs(x - xSunset) < 22) return null;
          }
          const hh = new Date(t).getHours();
          return (
            <SvgText key={t} x={x} y={height - 8} fontSize={9} fill={theme.textTertiary} textAnchor="middle">
              {`${hh.toString().padStart(2, "0")}:00`}
            </SvgText>
          );
        })}

        {/* Y-Achsen-Labels */}
        <SvgText x={PADDING.left - 4} y={yHorizon + 3} fontSize={9} fill={theme.textTertiary} textAnchor="end">0°</SvgText>
        <SvgText x={PADDING.left - 4} y={yFor(maxElev) + 3} fontSize={9} fill={theme.textTertiary} textAnchor="end">
          {`${Math.round(maxElev)}°`}
        </SvgText>
        {tempBounds ? (
          <>
            <SvgText x={width - PADDING.right + 4} y={yForTemp(tempBounds.max) + 3} fontSize={9} fill={tempColor} textAnchor="start">
              {`${tempBounds.max}°`}
            </SvgText>
            <SvgText x={width - PADDING.right + 4} y={yForTemp(tempBounds.min) + 3} fontSize={9} fill={tempColor} textAnchor="start">
              {`${tempBounds.min}°`}
            </SvgText>
          </>
        ) : null}

        {isRangeMode ? (
          <>
            {/* Schattierter Flugzeitraum */}
            <Rect
              x={xRangeStart}
              y={PADDING.top}
              width={Math.max(0, xRangeEnd - xRangeStart)}
              height={innerH}
              fill={theme.primary}
              opacity={0.18}
            />
            {/* Start-Linie (im Lock-Modus gedämpft & gestrichelt: Start ist fix "jetzt") */}
            <Line x1={xRangeStart} y1={PADDING.top} x2={xRangeStart} y2={height - PADDING.bottom}
              stroke={lockStart ? theme.textTertiary : theme.primary} strokeWidth={2}
              strokeDasharray={lockStart ? "4 3" : undefined} />
            <SvgText x={xRangeStart} y={PADDING.top - 6} fontSize={10} fontWeight="800"
              fill={lockStart ? theme.textTertiary : theme.primary} textAnchor="middle">
              {lockStart ? `Jetzt ${fmtHM(rangeStart!)}` : `▶ ${fmtHM(rangeStart!)}`}
            </SvgText>
            {/* Ende-Linie */}
            <Line x1={xRangeEnd} y1={PADDING.top} x2={xRangeEnd} y2={height - PADDING.bottom}
              stroke={theme.primary} strokeWidth={2} />
            <SvgText x={xRangeEnd} y={PADDING.top - 6} fontSize={10} fontWeight="800"
              fill={theme.primary} textAnchor="middle">
              {`${fmtHM(rangeEnd!)} ◀`}
            </SvgText>
            {/* Handle-Kreise oben/unten */}
            <Circle cx={xRangeStart} cy={PADDING.top + 4} r={6} fill={lockStart ? theme.textTertiary : theme.primary}
              stroke={theme.backgroundDefault} strokeWidth={2} />
            <Circle cx={xRangeStart} cy={height - PADDING.bottom - 4} r={6} fill={lockStart ? theme.textTertiary : theme.primary}
              stroke={theme.backgroundDefault} strokeWidth={2} />
            <Circle cx={xRangeEnd} cy={PADDING.top + 4} r={6} fill={theme.primary}
              stroke={theme.backgroundDefault} strokeWidth={2} />
            <Circle cx={xRangeEnd} cy={height - PADDING.bottom - 4} r={6} fill={theme.primary}
              stroke={theme.backgroundDefault} strokeWidth={2} />
          </>
        ) : (
          <>
            <Line x1={hx} y1={PADDING.top} x2={hx} y2={height - PADDING.bottom}
              stroke={theme.primary} strokeWidth={1} opacity={0.4} />
            {highlightTempC != null ? (
              <Circle cx={hx} cy={yForTemp(highlightTempC)} r={3} fill={tempColor}
                stroke={theme.backgroundDefault} strokeWidth={1.5} />
            ) : null}
            <Circle cx={hx} cy={hy} r={5}
              fill={hElev >= 0 ? sunColor : hElev >= -6 ? twilightColor : nightColor}
              stroke={theme.backgroundDefault} strokeWidth={2} />
          </>
        )}
      </Svg>

      {/* Drag-Overlay (nur Range-Modus) */}
      {isRangeMode ? (
        <View
          style={[StyleSheet.absoluteFill, { top: PADDING.top - 8, bottom: PADDING.bottom - 4 }]}
          {...panResponder.panHandlers}
        />
      ) : null}

      <ThemedText style={[styles.caption, { color: theme.textTertiary }]}>
        {isRangeMode
          ? `Flugzeit ${fmtHM(rangeStart!)}–${fmtHM(rangeEnd!)}${
              dayLengthMinutes != null ? ` · ${Math.floor(dayLengthMinutes / 60)}h ${dayLengthMinutes % 60}min Tageslicht` : ""
            }`
          : `${formatSolarTime(highlight)} · Sonne ${hElev >= 0 ? `${hElev.toFixed(1)}° über` : `${Math.abs(hElev).toFixed(1)}° unter`} Horizont${
              highlightTempC != null ? ` · ${highlightTempC.toFixed(1)}°C` : ""
            }${dayLengthMinutes != null ? ` · ${Math.floor(dayLengthMinutes / 60)}h ${dayLengthMinutes % 60}min Tageslicht` : ""}`
        }
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
    alignItems: "stretch",
    marginBottom: 12,
    position: "relative",
  },
  caption: {
    fontSize: 11,
    marginTop: 4,
    textAlign: "center",
  },
});
