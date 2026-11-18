import React, { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { View, StyleSheet, LayoutChangeEvent, PanResponder, GestureResponderEvent, Animated } from "react-native";
import Svg, { Path, Line, Circle, Text as SvgText, Rect, Defs, LinearGradient, Stop, ClipPath, G } from "react-native-svg";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { hourlySunArc, SunArcSample, formatSolarTime, computeSunElevation, calculateSolarTimes } from "@/lib/solar";
import { buildSunMarkerTrack, localDayStart, normalizeSlotTimes, timeAtScrollOffset } from "@/lib/sunArcScrollSync";
import { formatDurationMinutes, formatFlightWindowRange } from "@/lib/planningDateTime";

/**
 * Kopplung an eine horizontal scrollende Stundentabelle: die Markierung folgt
 * dem Scroll-Offset über Animated.interpolate (nativer Treiber) – kein
 * setState/Re-Render pro Scroll-Ereignis. Der Tag (Bogen) wechselt nur, wenn
 * die betrachtete Zeit über Mitternacht läuft.
 */
export interface SunArcScrollSync {
  /** Horizontaler Scroll-Offset der Tabelle (Animated.event mit useNativeDriver: true). */
  scrollX: Animated.Value;
  /** Spaltenbreite (px): Offset i*colWidth ↔ slotTimes[i]. */
  colWidth: number;
  /** Zeit (ms) je Spalte; Spalte 0 („Jetzt“) wird auf die aktuelle Zeit gesetzt. */
  slotTimes: number[];
}

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
  /** Range-Modus: zwei verschiebbare Vertikale (Start/Ende) mit schattiertem Bereich.
   *  Die Zeitachse reicht im Range-Modus über Mitternacht bis zum Ende des
   *  Folgetags: `rangeEnd` darf am Folgetag liegen (Über-Mitternacht-Flug),
   *  `rangeStart` liegt immer am Tag `date`. */
  rangeStart?: Date;
  rangeEnd?: Date;
  /** Callback bei Drag (snapped auf snapMinutes). */
  onRangeChange?: (start: Date, end: Date) => void;
  /** Frühester erlaubter Start (z.B. "jetzt" wenn isToday). */
  minStart?: Date;
  snapMinutes?: number;
  /** Startlinie fixieren (Pre-Flight: "sofortiger Start ab jetzt") — nur Ende verschiebbar. */
  lockStart?: boolean;
  /** Markierung scroll-synchron zu einer Stundentabelle (ersetzt highlightTime/date/sunrise/sunset). */
  scrollSync?: SunArcScrollSync;
}

const PADDING = { left: 32, right: 36, top: 22, bottom: 30 };
const HANDLE_TOUCH_W = 36;

function SunArcChart({
  lat, lon, date: dateProp, highlightTime, width: widthProp, height = 200,
  tempSeries, sunrise: sunriseProp, sunset: sunsetProp, dayLengthMinutes: dayLengthProp,
  rangeStart, rangeEnd, onRangeChange, minStart, snapMinutes = 15, lockStart = false,
  scrollSync,
}: Props) {
  const sync = scrollSync && scrollSync.slotTimes.length > 0 ? scrollSync : null;
  const syncScrollX = sync?.scrollX ?? null;
  const syncColW = sync?.colWidth ?? 0;
  const slotKey = sync ? sync.slotTimes.join(",") : "";
  // „Jetzt“-Spalte minütlich nachführen (nur im Scroll-Modus)
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!sync) return;
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [!!sync]);
  const syncTimes = useMemo(
    () => (sync ? normalizeSlotTimes(sync.slotTimes, nowTick) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotKey, nowTick],
  );
  // Tag des Bogens: wechselt nur beim Scrollen über Mitternacht (seltenes setState)
  const [syncDay, setSyncDay] = useState<number>(() => localDayStart(Date.now()));
  useEffect(() => {
    if (!syncScrollX || syncTimes.length === 0) return;
    const dayAt = (v: number) => localDayStart(timeAtScrollOffset(v, syncTimes, syncColW));
    const cur = (syncScrollX as unknown as { __getValue?: () => number }).__getValue?.() ?? 0;
    setSyncDay(dayAt(cur));
    const id = syncScrollX.addListener(({ value }) => {
      const d = dayAt(value);
      setSyncDay((prev) => (prev === d ? prev : d));
    });
    return () => syncScrollX.removeListener(id);
  }, [syncScrollX, syncTimes, syncColW]);
  const syncDate = useMemo(() => new Date(syncDay + 12 * 3600_000), [syncDay]);
  const syncSolar = useMemo(() => (sync ? calculateSolarTimes(lat, lon, syncDate) : null), [!!sync, lat, lon, syncDate]);
  const date = sync ? syncDate : dateProp;
  const sunrise = sync ? syncSolar?.sunrise ?? null : sunriseProp;
  const sunset = sync ? syncSolar?.sunset ?? null : sunsetProp;
  const dayLengthMinutes = sync ? syncSolar?.dayLengthMinutes ?? null : dayLengthProp;

  const [measured, setMeasured] = useState<number>(0);
  const width = widthProp ?? (measured > 0 ? measured : 320);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - measured) > 1) setMeasured(w);
  };
  const { theme } = useTheme();
  const highlight = highlightTime ?? new Date();
  const isRangeMode = !!(rangeStart && rangeEnd && onRangeChange);

  // Folgetag (12:00 lokal, DST-sicher) – im Range-Modus Teil der Achse.
  const nextDayDate = useMemo(() => {
    const b = date ?? new Date();
    return new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1, 12, 0, 0, 0);
  }, [date]);
  const samples: SunArcSample[] = useMemo(() => {
    const first = hourlySunArc(lat, lon, date, 15);
    if (!isRangeMode) return first;
    // Range-Modus: Tag + Folgetag, damit Flüge über Mitternacht darstellbar sind.
    return [...first, ...hourlySunArc(lat, lon, nextDayDate, 15).slice(1)];
  }, [lat, lon, date, nextDayDate, isRangeMode]);
  const nextSolar = useMemo(
    () => (isRangeMode ? calculateSolarTimes(lat, lon, nextDayDate) : null),
    [isRangeMode, lat, lon, nextDayDate],
  );

  const dayStart = samples[0].time.getTime();
  // Mitternacht zum Folgetag (lokal) – Grenze für den Start und Trennlinie.
  const nextMidnight = new Date(nextDayDate.getFullYear(), nextDayDate.getMonth(), nextDayDate.getDate(), 0, 0, 0, 0).getTime();
  // Ende der Achse: Tagesende bzw. (Range-Modus) Ende des Folgetags.
  const dayEnd = samples[samples.length - 1].time.getTime();

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
    // In die Achsgrenzen schieben (Sun-Samples: Tag bzw. Tag + Folgetag).
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

  // Scroll-Modus: Markierung über native Interpolation des Scroll-Offsets
  const marker = useMemo(() => {
    if (!syncScrollX || syncTimes.length === 0) return null;
    const plotL = PADDING.left;
    const plotR = width - PADDING.right;
    const track = buildSunMarkerTrack(syncTimes, syncColW, (t) => {
      const elev = computeSunElevation(lat, lon, new Date(t));
      const x = Math.max(plotL, Math.min(plotR, xFor(t)));
      return { x, y: yFor(elev), elevationDeg: elev };
    });
    const ip = (out: number[]) => syncScrollX.interpolate({ inputRange: track.inputRange, outputRange: out, extrapolate: "clamp" });
    return {
      tx: ip(track.x),
      ty: ip(track.y),
      day: ip(track.dayOpacity),
      twilight: ip(track.twilightOpacity),
      night: ip(track.nightOpacity),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncScrollX, syncTimes, syncColW, lat, lon, viewStart, viewRange, minElev, elevRange, width, height]);

  const sunColor = "#FFB820";
  const twilightColor = "#FF8C00";
  const nightColor = "#3B4F74";
  const tempColor = "#FF453A";
  const sunAxisColor = "#C98A00";

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

  // Auf-/Untergänge im sichtbaren Fenster (Range-Modus inkl. Folgetag).
  const sunMarks = (list: (Date | null | undefined)[]) =>
    list
      .filter((d): d is Date => d instanceof Date && Number.isFinite(d.getTime()))
      .map((d) => ({ d, x: xFor(d.getTime()) }))
      .filter((m) => inPlot(m.x));
  const riseMarks = sunMarks([sunrise, nextSolar?.sunrise]);
  const setMarks = sunMarks([sunset, nextSolar?.sunset]);
  const sunMarkXs = [...riseMarks, ...setMarks].map((m) => m.x);
  const nextDayLabel = nextDayDate.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });

  // Sonnenhöhen-Beschriftung: Maximum, Horizont 0°, bürgerliche Dämmerung −6°
  // und Minimum – nur Werte mit genug Abstand (keine überlappenden Labels).
  const elevLabels = (() => {
    const cands = [Math.round(maxElev), 0, -6, Math.round(minElev)];
    const out: { v: number; y: number }[] = [];
    for (const v of cands) {
      if (v > maxElev + 0.5 || v < minElev - 0.5) continue;
      const y = yFor(v);
      if (out.some((o) => o.v === v || Math.abs(o.y - y) < 11)) continue;
      out.push({ v, y });
    }
    return out;
  })();

  // Stundenraster passend zum sichtbaren Fenster (statt fix 0/6/12/18/24).
  const hourTicks = useMemo(() => {
    if (!isRangeMode) return [0, 6, 12, 18, 24].map((h) => dayStart + h * 3600000);
    const stepH = viewRange / 3600000 > 8 ? 2 : 1;
    const ticks: number[] = [];
    const base = new Date(dayStart);
    for (let h = 0; h <= 48; h += stepH) {
      // Lokale Stunde (Date normalisiert h >= 24 auf den Folgetag, DST-sicher).
      const t = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0, 0, 0).getTime();
      if (t > dayEnd + 1) break;
      if (t >= viewStart - 1 && t <= viewEnd + 1) ticks.push(t);
    }
    return ticks;
  }, [isRangeMode, dayStart, dayEnd, viewStart, viewEnd, viewRange]);

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
      // Start bleibt am Planungstag (spätestens 23:45) und vor dem Ende.
      const ns = Math.max(minStartRef.current, Math.min(t, valuesRef.current.rangeEndT - snapMs, nextMidnight - snapMs));
      if (ns !== valuesRef.current.rangeStartT) {
        if (ns !== lastSnapRef.current) {
          lastSnapRef.current = ns;
          Haptics.selectionAsync().catch(() => {});
        }
        cb(new Date(ns), new Date(valuesRef.current.rangeEndT));
      }
    } else {
      // Ende darf über Mitternacht in den Folgetag (max. knapp 24 h Fenster).
      const maxEnd = Math.min(dayEnd, valuesRef.current.rangeStartT + 24 * 60 * 60 * 1000 - snapMs);
      const ne = Math.max(valuesRef.current.rangeStartT + snapMs, Math.min(t, maxEnd));
      if (ne !== valuesRef.current.rangeEndT) {
        if (ne !== lastSnapRef.current) {
          lastSnapRef.current = ne;
          Haptics.selectionAsync().catch(() => {});
        }
        cb(new Date(valuesRef.current.rangeStartT), new Date(ne));
      }
    }
  }, [xToTime, dayEnd, nextMidnight, snapMs]);

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

  // Ende am Folgetag (Über-Mitternacht-Flug) → "+1"-Hinweis.
  const endOnNextDay = isRangeMode && rangeEndT >= nextMidnight;
  const rangeDurationMin = Math.max(0, Math.round((rangeEndT - rangeStartT) / 60000));
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
        {riseMarks.map(({ x, d }) => (
          <G key={`rise-${d.getTime()}`}>
            <Path
              d={`M${x - 5},${yHorizon} A5,5 0 0 1 ${x + 5},${yHorizon} Z`}
              fill={sunColor}
            />
            <Line x1={x - 7} y1={yHorizon} x2={x + 7} y2={yHorizon} stroke={twilightColor} strokeWidth={1.2} />
            {[-8, -5, -2].map((dy, i) => (
              <Line key={`sr-r-${i}`} x1={x - 8 - i} y1={yHorizon - 3 + dy} x2={x - 6 - i} y2={yHorizon - 3 + dy} stroke={sunColor} strokeWidth={1} />
            ))}
            <Path d={`M${x - 3},${yHorizon + 11} L${x},${yHorizon + 7} L${x + 3},${yHorizon + 11}`}
              stroke={twilightColor} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <SvgText x={x} y={yHorizon + 22} fontSize={9} fontWeight="700" fill={twilightColor} textAnchor="middle">
              {fmtHM(d)}
            </SvgText>
          </G>
        ))}
        {/* Sonnenuntergang Marker: halbe Sonne sinkt + Pfeil runter */}
        {setMarks.map(({ x, d }) => (
          <G key={`set-${d.getTime()}`}>
            <Path
              d={`M${x - 5},${yHorizon} A5,5 0 0 1 ${x + 5},${yHorizon} Z`}
              fill={twilightColor}
              opacity={0.85}
            />
            <Line x1={x - 7} y1={yHorizon} x2={x + 7} y2={yHorizon} stroke={twilightColor} strokeWidth={1.2} />
            <Path d={`M${x - 3},${yHorizon + 7} L${x},${yHorizon + 11} L${x + 3},${yHorizon + 7}`}
              stroke={twilightColor} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <SvgText x={x} y={yHorizon + 22} fontSize={9} fontWeight="700" fill={twilightColor} textAnchor="middle">
              {fmtHM(d)}
            </SvgText>
          </G>
        ))}

        {/* Mitternacht: Trennlinie zum Folgetag mit Datums-Hinweis */}
        {isRangeMode && inPlot(xFor(nextMidnight)) ? (
          <>
            <Line x1={xFor(nextMidnight)} y1={PADDING.top} x2={xFor(nextMidnight)} y2={height - PADDING.bottom}
              stroke={theme.textSecondary} strokeWidth={1} strokeDasharray="2,3" opacity={0.7} />
            <SvgText x={xFor(nextMidnight) + 3} y={PADDING.top + 12} fontSize={9} fontWeight="700"
              fill={theme.textSecondary} textAnchor="start">
              {`+1 Tag · ${nextDayLabel}`}
            </SvgText>
          </>
        ) : null}

        {/* Stundenraster (passt sich dem sichtbaren Fenster an) */}
        {hourTicks.map((t) => {
          const x = xFor(t);
          if (!inPlot(x)) return null;
          if (sunMarkXs.some((sx) => Math.abs(x - sx) < 22)) return null;
          const hh = new Date(t).getHours();
          return (
            <SvgText key={t} x={x} y={height - 8} fontSize={9} fill={theme.textTertiary} textAnchor="middle">
              {`${hh.toString().padStart(2, "0")}:00`}
            </SvgText>
          );
        })}

        {/* Y-Achsen: links Sonnenhöhe (Grad über/unter Horizont), rechts
            Temperatur (°C) – Einheiten und Farben trennen die beiden Skalen. */}
        <SvgText x={2} y={10} fontSize={8} fill={sunAxisColor} textAnchor="start">Sonne</SvgText>
        {elevLabels.map(({ v, y }) => (
          <SvgText key={`elev-${v}`} x={PADDING.left - 4} y={y + 3} fontSize={9} fill={sunAxisColor} textAnchor="end">
            {`${v < 0 ? "−" : ""}${Math.abs(v)}°`}
          </SvgText>
        ))}
        {tempBounds ? (
          <>
            <SvgText x={width - 2} y={10} fontSize={8} fill={tempColor} textAnchor="end">Temp.</SvgText>
            <SvgText x={width - PADDING.right + 4} y={yForTemp(tempBounds.max) + 3} fontSize={9} fill={tempColor} textAnchor="start">
              {`${tempBounds.max}°C`}
            </SvgText>
            <SvgText x={width - PADDING.right + 4} y={yForTemp(tempBounds.min) + 3} fontSize={9} fill={tempColor} textAnchor="start">
              {`${tempBounds.min}°C`}
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
              {`${fmtHM(rangeEnd!)}${endOnNextDay ? " +1" : ""} ◀`}
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
        ) : marker ? null : (
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

      {marker ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={{
              position: "absolute",
              left: -0.5,
              top: PADDING.top,
              width: 1,
              height: innerH,
              backgroundColor: theme.primary,
              opacity: 0.4,
              transform: [{ translateX: marker.tx }],
            }}
          />
          {([
            [marker.day, sunColor],
            [marker.twilight, twilightColor],
            [marker.night, nightColor],
          ] as const).map(([op, color]) => (
            <Animated.View
              key={color}
              style={{
                position: "absolute",
                left: -6,
                top: -6,
                width: 12,
                height: 12,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: theme.backgroundDefault,
                backgroundColor: color,
                opacity: op,
                transform: [{ translateX: marker.tx }, { translateY: marker.ty }],
              }}
            />
          ))}
        </View>
      ) : null}

      {/* Drag-Overlay (nur Range-Modus) */}
      {isRangeMode ? (
        <View
          style={[StyleSheet.absoluteFill, { top: PADDING.top - 8, bottom: PADDING.bottom - 4 }]}
          {...panResponder.panHandlers}
        />
      ) : null}

      {sync && syncScrollX ? (
        <ScrollSyncCaption
          lat={lat}
          lon={lon}
          scrollX={syncScrollX}
          times={syncTimes}
          colWidth={syncColW}
          dayLengthMinutes={dayLengthMinutes ?? null}
          color={theme.textTertiary}
        />
      ) : (
      <ThemedText style={[styles.caption, { color: theme.textTertiary }]}>
        {isRangeMode
          ? `Flugzeit ${formatFlightWindowRange(fmtHM(rangeStart!), fmtHM(rangeEnd!))} · ${formatDurationMinutes(rangeDurationMin)}`
          : `${formatSolarTime(highlight)} · Sonne ${hElev >= 0 ? `${hElev.toFixed(1)}° über` : `${Math.abs(hElev).toFixed(1)}° unter`} Horizont${
              highlightTempC != null ? ` · ${highlightTempC.toFixed(1)}°C` : ""
            }${dayLengthMinutes != null ? ` · ${Math.floor(dayLengthMinutes / 60)}h ${dayLengthMinutes % 60}min Tageslicht` : ""}`
        }
      </ThemedText>
      )}
    </View>
  );
}

/**
 * Beschriftung im Scroll-Modus: eigener kleiner Baustein mit eigenem Zustand,
 * aktualisiert nur bei Wechsel der 5-Minuten-Stufe – das SVG rendert dabei nicht neu.
 */
function ScrollSyncCaption({ lat, lon, scrollX, times, colWidth, dayLengthMinutes, color }: {
  lat: number;
  lon: number;
  scrollX: Animated.Value;
  times: number[];
  colWidth: number;
  dayLengthMinutes: number | null;
  color: string;
}) {
  const STEP = 5 * 60_000;
  const quant = useCallback((v: number) => Math.round(timeAtScrollOffset(v, times, colWidth) / STEP) * STEP, [times, colWidth]);
  const [t, setT] = useState<number>(() => quant((scrollX as unknown as { __getValue?: () => number }).__getValue?.() ?? 0));
  useEffect(() => {
    setT(quant((scrollX as unknown as { __getValue?: () => number }).__getValue?.() ?? 0));
    const id = scrollX.addListener(({ value }) => {
      const q = quant(value);
      setT((prev) => (prev === q ? prev : q));
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, quant]);
  const d = new Date(t);
  const elev = computeSunElevation(lat, lon, d);
  return (
    <ThemedText style={[styles.caption, { color }]}>
      {`${formatSolarTime(d)} · Sonne ${elev >= 0 ? `${elev.toFixed(1)}° über` : `${Math.abs(elev).toFixed(1)}° unter`} Horizont${
        dayLengthMinutes != null ? ` · ${Math.floor(dayLengthMinutes / 60)}h ${dayLengthMinutes % 60}min Tageslicht` : ""
      }`}
    </ThemedText>
  );
}

function sameScrollSync(a?: SunArcScrollSync, b?: SunArcScrollSync): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.scrollX !== b.scrollX || a.colWidth !== b.colWidth || a.slotTimes.length !== b.slotTimes.length) return false;
  for (let i = 0; i < a.slotTimes.length; i++) if (a.slotTimes[i] !== b.slotTimes[i]) return false;
  return true;
}

function sameDate(a?: Date | null, b?: Date | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.getTime() === b.getTime();
}

/**
 * Memo: Eltern (z. B. die Radar-Seitenleiste) rendern oft neu; das SVG nur
 * neu zeichnen, wenn sich die Darstellung wirklich ändert.
 */
export default React.memo(SunArcChart, (prev, next) => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof Props>;
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (k === "scrollSync") {
      if (!sameScrollSync(a as SunArcScrollSync | undefined, b as SunArcScrollSync | undefined)) return false;
    } else if (a instanceof Date || b instanceof Date) {
      if (!sameDate(a as Date | undefined, b as Date | undefined)) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
});

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
