import React, { useState, useMemo, useEffect, useRef } from "react";
import { View, StyleSheet, Platform, Pressable, ScrollView } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import SunArcChart from "@/components/SunArcChart";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { calculateSolarTimes, isTimeDuringDaylight, isTimeDuringCivilTwilight, type SolarTimes } from "@/lib/solar";
import { fetchHourlyForecasts, type HourlyForecastSlot } from "@/lib/weather";
import { forwardManualRestrictionParams, forwardCrossCheckParams } from "@/lib/manualRestrictionFlow";
import HourlyForecastTable from "@/components/HourlyForecastTable";
import { getDrone, DEFAULT_LIMITS, type DroneProfile, type WeatherLimits } from "@/lib/storage";
import { getFlightPlanningMode } from "@/lib/flightPlanningMode";
import { getNightFlightRule } from "@/lib/countryInfo";
import { dateForLocalTime, formatLocalDateKey, getDeviceTimeZone, parseLocalDateKey } from "@/lib/planningDateTime";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningDateTime">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningDateTime">;
const DEVICE_TIME_ZONE = getDeviceTimeZone();

function parseTime(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = ((min % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface HourCardData {
  ts: Date;
  hour: number;
  inFlight: boolean;
  isBuffer: boolean;
  slot: HourlyForecastSlot | null;
  daylight: "day" | "twilight" | "night";
}

export default function PlanningDateTimeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const { droneId, latitude, longitude, locationName, countryIso, radiusKm, maxAltitude, recommendedVlosM, vlosExceeded, vlosCharDimensionM, vlosAltitudeCorrection, vlosHorizontalLimitM, routeWaypoints, sessionId, restrictionStatus, restrictionNotes, officialMapCrossCheck } = route.params;
  const isPreflightMode = useRef(getFlightPlanningMode() === "preflight").current;

  const [plannedDate, setPlannedDate] = useState<string>(() => {
    return formatLocalDateKey(new Date());
  });
  const [plannedTime, setPlannedTime] = useState<string>(() => {
    const now = new Date();
    if (isPreflightMode) {
      now.setMinutes(Math.round(now.getMinutes() / 15) * 15, 0, 0);
      return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    }
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    start.setMinutes(Math.round(start.getMinutes() / 15) * 15, 0, 0);
    return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  });
  const [endTime, setEndTime] = useState<string>(() => {
    const now = new Date();
    const baseOffset = isPreflightMode ? 60 : 2 * 60;
    const end = new Date(now.getTime() + baseOffset * 60 * 1000);
    end.setMinutes(Math.round(end.getMinutes() / 15) * 15, 0, 0);
    return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const [hourlySlots, setHourlySlots] = useState<HourlyForecastSlot[]>([]);
  const [hourlySource, setHourlySource] = useState<"dipul" | "brightsky" | "openmeteo" | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [drone, setDrone] = useState<DroneProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!droneId) {
      setDrone(null);
      return;
    }
    getDrone(droneId)
      .then((d) => {
        if (!cancelled) setDrone(d);
      })
      .catch(() => {
        if (!cancelled) setDrone(null);
      });
    return () => {
      cancelled = true;
    };
  }, [droneId]);

  const limits: WeatherLimits = drone?.limits ?? DEFAULT_LIMITS;
  const fetchSeqRef = useRef(0);
  const hourScrollRef = useRef<ScrollView>(null);
  const [hourViewportW, setHourViewportW] = useState(0);

  const dateObj = useMemo(() => {
    return parseLocalDateKey(plannedDate) ?? new Date();
  }, [plannedDate]);

  const startTimeObj = useMemo(() => {
    return dateForLocalTime(plannedDate, plannedTime);
  }, [plannedDate, plannedTime]);

  const endTimeObj = useMemo(() => {
    // Auch im Zeitmodus braucht der native Picker einen vollständigen Date-
    // Wert. Er muss auf demselben lokalen Kalendertag wie die Planung liegen,
    // sonst springt der Picker nach der Auswahl von morgen wieder auf heute.
    return dateForLocalTime(plannedDate, endTime);
  }, [plannedDate, endTime]);

  const startMin = useMemo(() => parseTime(plannedTime), [plannedTime]);
  const endMin = useMemo(() => parseTime(endTime), [endTime]);

  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const todayStr = useMemo(() => {
    return formatLocalDateKey(new Date());
  }, [nowTick]);
  const isToday = plannedDate === todayStr;
  // Slider/Modell laeuft auf 24h-Raster (0..1425, SNAP=15). Spaetestens
  // erlaubter Start ist 1410, damit Ende=1425 (>=Start+15) gueltig bleibt.
  const MAX_START_MIN = 1410;
  const minStartMin = useMemo(() => {
    if (!isToday) return 0;
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    return Math.min(MAX_START_MIN, Math.ceil(m / 15) * 15);
  }, [isToday, nowTick]);

  useEffect(() => {
    if (!isToday) return;
    if (startMin < minStartMin) {
      const duration = endMin > startMin ? endMin - startMin : 60;
      const newStart = Math.min(minStartMin, MAX_START_MIN);
      const newEnd = Math.min(1425, Math.max(newStart + 15, newStart + duration));
      setPlannedTime(fmtTime(newStart));
      setEndTime(fmtTime(newEnd));
    }
  }, [isToday, minStartMin, startMin, endMin]);

  const solarTimes: SolarTimes = useMemo(
    () => calculateSolarTimes(latitude, longitude, dateObj),
    [latitude, longitude, dateObj],
  );

  const dayLengthMin = useMemo(() => {
    if (!solarTimes?.sunrise || !solarTimes?.sunset) return null;
    return Math.max(0, Math.round((solarTimes.sunset.getTime() - solarTimes.sunrise.getTime()) / 60000));
  }, [solarTimes]);

  const rangeStartDate = useMemo(() => {
    const d = new Date(dateObj);
    d.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    return d;
  }, [dateObj, startMin]);

  const rangeEndDate = useMemo(() => {
    const d = new Date(dateObj);
    const eMin = endMin <= startMin ? Math.min(1425, startMin + 15) : endMin;
    d.setHours(Math.floor(eMin / 60), eMin % 60, 0, 0);
    return d;
  }, [dateObj, endMin, startMin]);

  const minStartDate = useMemo(() => {
    if (!isToday) return undefined;
    const d = new Date(dateObj);
    d.setHours(Math.floor(minStartMin / 60), minStartMin % 60, 0, 0);
    return d;
  }, [isToday, minStartMin, dateObj]);

  const tempSeries = useMemo(
    () => hourlySlots.map((s) => ({ time: new Date(s.timestamp), tempC: s.temperature })),
    [hourlySlots],
  );

  const handleRangeChange = (s: Date, e: Date) => {
    const sMin = s.getHours() * 60 + s.getMinutes();
    const eMin = e.getHours() * 60 + e.getMinutes();
    handleSliderChange(sMin, eMin);
  };

  const flightDurationLabel = useMemo(() => {
    let diff = endMin - startMin;
    if (diff <= 0) diff += 1440;
    const dh = Math.floor(diff / 60);
    const dm = diff % 60;
    return `${dh}h${dm > 0 ? ` ${dm}min` : ""}`;
  }, [startMin, endMin]);

  const setDurationMinutes = (mins: number) => {
    const [sh, sm] = plannedTime.split(":").map(Number);
    const startDate = new Date();
    startDate.setHours(sh, sm, 0, 0);
    const endDate = new Date(startDate.getTime() + mins * 60 * 1000);
    setEndTime(`${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Wetter-Hourly nachladen — mit 1h-Puffer vor Start und nach Ende.
  // Debounced, damit Slider-Drag nicht jede Bewegung als Request rausfeuert.
  // Bei Über-Mitternacht-Flügen (endMin <= startMin) wird das Ende auf den
  // Folgetag verschoben.
  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    const handle = setTimeout(async () => {
      setWeatherLoading(true);
      setWeatherError(null);
      try {
      const baseDate = parseLocalDateKey(plannedDate) ?? new Date();
        const dayOffsetForEnd = endMin <= startMin ? 1440 : 0;
        // Fetch full day (0:00 to 23:00) plus any overnight extension so the
        // hourly forecast table can show the whole day; hourCards bounds
        // itself to startMin-60..endMin+60 so widening here is safe.
        const fetchStartMin = Math.min(0, startMin - 60);
        const fetchEndMin = Math.max(1380, endMin + dayOffsetForEnd + 60);
        const fetchStart = new Date(baseDate.getTime() + fetchStartMin * 60000);
        const fetchEnd = new Date(baseDate.getTime() + fetchEndMin * 60000);
        const result = await fetchHourlyForecasts(
          latitude,
          longitude,
          fetchStart.toISOString(),
          fetchEnd.toISOString(),
        );
        if (fetchSeqRef.current !== seq) return;
        setHourlySlots(result.slots);
        setHourlySource(result.source);
      } catch (e: any) {
        if (fetchSeqRef.current !== seq) return;
        setWeatherError(e?.message || "Wetterdaten konnten nicht geladen werden.");
        setHourlySlots([]);
        setHourlySource(null);
      } finally {
        if (fetchSeqRef.current === seq) setWeatherLoading(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [plannedDate, startMin, endMin, latitude, longitude]);

  const computeWeatherSummary = (cards: HourCardData[]) => {
      const inFlightAll = cards.filter((c) => c.inFlight);
      const fc = inFlightAll.filter((c) => c.slot);
      let hasNight = false;
      let hasTwilight = false;
      for (const c of inFlightAll) {
        if (c.daylight === "night") hasNight = true;
        if (c.daylight === "twilight") hasTwilight = true;
      }
      if (fc.length === 0) {
        const criticalsNoData: { type: "danger" | "warn" | "info"; icon: string; text: string }[] = [];
        if (hasNight) {
          const nightRule = getNightFlightRule(countryIso);
          criticalsNoData.push({ type: nightRule.severity, icon: "moon", text: nightRule.shortText });
        } else if (hasTwilight) {
          criticalsNoData.push({ type: "info", icon: "sunset", text: "Dämmerungsflug" });
        }
        return { avgTemp: null, minTemp: null, maxWind: null, maxGust: null, totalRain: 0, totalSnow: 0, maxCloud: null, hasNight, hasTwilight, criticals: criticalsNoData, hasData: false };
      }
      let tempSum = 0;
      let minTemp = Infinity;
      let maxWind = 0;
      let maxGust = 0;
      let totalRain = 0;
      let maxRainRate = 0;
      let totalSnow = 0;
      let maxCloud = 0;
      for (const c of fc) {
        const s = c.slot!;
        tempSum += s.temperature;
        if (s.temperature < minTemp) minTemp = s.temperature;
        const w = s.windSpeed * 3.6;
        const g = (s.windGust ?? 0) * 3.6;
        if (w > maxWind) maxWind = w;
        if (g > maxGust) maxGust = g;
        const rr = s.rain ?? 0;
        totalRain += rr;
        if (rr > maxRainRate) maxRainRate = rr;
        totalSnow += s.snow ?? 0;
        if (s.cloudCover > maxCloud) maxCloud = s.cloudCover;
      }
      // Schwellen folgen dem Drohnen-Limit (m/s -> km/h), Fallback = DEFAULT_LIMITS.
      const windLimitKmh = limits.maxWind * 3.6;
      const gustLimitKmh = limits.maxGusts * 3.6;
      const rainLimit = limits.maxRain;
      const criticals: { type: "danger" | "warn" | "info"; icon: string; text: string }[] = [];
      if (maxGust > gustLimitKmh) criticals.push({ type: "danger", icon: "wind", text: `Böen bis ${Math.round(maxGust)} km/h — über Limit, Flug nicht empfohlen` });
      else if (maxGust > gustLimitKmh * 0.75) criticals.push({ type: "warn", icon: "wind", text: `Böen bis ${Math.round(maxGust)} km/h — nahe am Limit` });
      else if (maxWind > windLimitKmh) criticals.push({ type: "danger", icon: "wind", text: `Wind bis ${Math.round(maxWind)} km/h — über Limit, Flug nicht empfohlen` });
      else if (maxWind > windLimitKmh * 0.75) criticals.push({ type: "warn", icon: "wind", text: `Wind bis ${Math.round(maxWind)} km/h — nahe am Limit` });
      if (totalSnow > 0.1) criticals.push({ type: "danger", icon: "cloud-snow", text: `Schneefall ${totalSnow.toFixed(1)} mm — kein Flug` });
      if (maxRainRate > rainLimit) criticals.push({ type: "danger", icon: "cloud-rain", text: `Regen bis ${maxRainRate.toFixed(1).replace(".", ",")} mm/h — über Limit, kein Flug` });
      else if (maxRainRate > 0.1) criticals.push({ type: "warn", icon: "cloud-drizzle", text: `Leichter Regen bis ${maxRainRate.toFixed(1).replace(".", ",")} mm/h` });
      if (minTemp <= 0) criticals.push({ type: "warn", icon: "thermometer", text: `Frost (min ${Math.round(minTemp)}°C) — Akkuleistung reduziert` });
      else if (minTemp <= 5) criticals.push({ type: "info", icon: "thermometer", text: `Kühl (min ${Math.round(minTemp)}°C)` });
      if (hasNight) {
        const nightRule = getNightFlightRule(countryIso);
        criticals.push({ type: nightRule.severity, icon: "moon", text: nightRule.shortText });
      }
      else if (hasTwilight) criticals.push({ type: "info", icon: "sunset", text: "Dämmerungsflug" });
      if (maxCloud >= 90) criticals.push({ type: "info", icon: "cloud", text: `Bedeckt (${Math.round(maxCloud)}%)` });
      return {
        avgTemp: tempSum / fc.length,
        minTemp,
        maxWind,
        maxGust,
        totalRain,
        totalSnow,
        maxCloud,
        hasNight,
        hasTwilight,
        criticals,
        hasData: true,
      };
  };

  const hourCards: HourCardData[] = useMemo(() => {
    const baseDate = parseLocalDateKey(plannedDate) ?? new Date();
    const dayOffsetForEnd = endMin <= startMin ? 1440 : 0;
    // Voller Tagesgang: 00:00 bis 23:00 des gewählten Tages (bzw. bis zum
    // Ende des Flugfensters bei Über-Mitternacht-Flügen). Der Nutzer
    // erwartet die gleiche "schöne" Tageskurve wie auf der Radar-Wetterkarte
    // — eingeschränkt auf ±1 h Puffer wäre der Tagesverlauf nicht sichtbar.
    const startTs = new Date(baseDate.getTime());
    const endTs = new Date(baseDate.getTime() + Math.max(23 * 60, endMin + dayOffsetForEnd) * 60000);
    startTs.setMinutes(0, 0, 0);
    endTs.setMinutes(0, 0, 0);
    const cards: HourCardData[] = [];
    const flightStart = new Date(baseDate.getTime() + startMin * 60000);
    const flightEnd = new Date(baseDate.getTime() + (endMin + dayOffsetForEnd) * 60000);
    const flightStartHourTs = new Date(flightStart.getFullYear(), flightStart.getMonth(), flightStart.getDate(), flightStart.getHours()).getTime();
    for (let t = startTs.getTime(); t <= endTs.getTime(); t += 3600000) {
      const ts = new Date(t);
      // Slot-Match: gleicher Stunden-Slot
      const slot = hourlySlots.find((s) => {
        const sd = new Date(s.timestamp);
        return sd.getFullYear() === ts.getFullYear()
          && sd.getMonth() === ts.getMonth()
          && sd.getDate() === ts.getDate()
          && sd.getHours() === ts.getHours();
      }) || null;
      const inFlight = ts.getTime() >= flightStartHourTs && ts.getTime() <= flightEnd.getTime();
      const buffer = !inFlight;
      const daySolar = calculateSolarTimes(latitude, longitude, ts);
      const day = isTimeDuringDaylight(ts, daySolar);
      const twi = !day && isTimeDuringCivilTwilight(ts, daySolar);
      cards.push({
        ts,
        hour: ts.getHours(),
        inFlight,
        isBuffer: buffer,
        slot,
        daylight: day ? "day" : twi ? "twilight" : "night",
      });
    }
    return cards;
  }, [hourlySlots, plannedDate, startMin, endMin, latitude, longitude]);

  const summary = useMemo(() => computeWeatherSummary(hourCards), [hourCards, limits]);

  // Score each hour for flying suitability. Lower score = better.
  // Skip cards with no slot data, no daylight, or past hours (today only).
  const bestHour = useMemo(() => {
    const now = new Date();
    const isToday = plannedDate === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const minHour = isToday ? now.getHours() + 1 : 0;
    let best: { hour: number; score: number; reason: string } | null = null;
    for (const c of hourCards) {
      if (!c.slot) continue;
      if (c.daylight === "night") continue;
      if (c.hour < minHour) continue;
      const s = c.slot;
      const windKmh = s.windSpeed * 3.6;
      const gustKmh = (s.windGust ?? s.windSpeed) * 3.6;
      const rain = s.rain ?? 0;
      const snow = s.snow ?? 0;
      const cloud = s.cloudCover ?? 0;
      const temp = s.temperature;
      let score = 0;
      score += windKmh * 1.0;
      score += Math.max(0, gustKmh - windKmh) * 1.5;
      score += rain * 100;
      score += snow * 200;
      score += cloud * 0.05;
      if (temp <= 0) score += 30;
      else if (temp <= 5) score += 10;
      if (c.daylight === "twilight") score += 15;
      if (!best || score < best.score) {
        const parts: string[] = [];
        parts.push(`${Math.round(windKmh)} km/h Wind`);
        if (gustKmh > windKmh + 2) parts.push(`Böen ${Math.round(gustKmh)}`);
        if (rain > 0.1) parts.push(`${rain.toFixed(1)} mm Regen`);
        else parts.push("trocken");
        parts.push(`${Math.round(cloud)}% Wolken`);
        best = { hour: c.hour, score, reason: parts.join(" · ") };
      }
    }
    return best;
  }, [hourCards, plannedDate]);

  // Flugfenster horizontal zentrieren, sobald sich Stunden/Auswahl/Breite ändern.
  useEffect(() => {
    if (hourViewportW <= 0 || hourCards.length === 0) return;
    const CARD_W = 76;
    const STEP = CARD_W + 8; // gap aus hourScrollContent
    const firstIdx = hourCards.findIndex((c) => c.inFlight);
    if (firstIdx < 0) return;
    const contentW = Spacing.sm * 2 + hourCards.length * CARD_W + (hourCards.length - 1) * 8;
    const maxOffset = Math.max(0, contentW - hourViewportW);
    // Startuhrzeit nach links holen, mit einer Stunde Vorlauf als Kontext.
    const leadIdx = Math.max(0, firstIdx - 1);
    const startX = Spacing.sm + leadIdx * STEP;
    const x = Math.min(Math.max(0, startX), maxOffset);
    const t = setTimeout(() => {
      hourScrollRef.current?.scrollTo({ x, animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [hourCards, plannedTime, hourViewportW]);

  const handleBestSlot = () => {
    if (!bestHour) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    setPlannedTime(`${String(bestHour.hour).padStart(2, "0")}:00`);
  };

  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (date) {
      setPlannedDate(formatLocalDateKey(date));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleStartTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowStartPicker(false);
    if (date) {
      let mins = date.getHours() * 60 + date.getMinutes();
      if (isToday && mins < minStartMin) mins = minStartMin;
      mins = Math.min(mins, MAX_START_MIN);
      const clamped = new Date(date);
      clamped.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      const newStart = `${String(clamped.getHours()).padStart(2, "0")}:${String(clamped.getMinutes()).padStart(2, "0")}`;
      setPlannedTime(newStart);
      const endMins = Math.min(1425, mins + 60);
      const endDate = new Date(clamped);
      endDate.setHours(Math.floor(endMins / 60), endMins % 60, 0, 0);
      setEndTime(`${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleEndTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowEndPicker(false);
    if (date) {
      setEndTime(`${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleSliderChange = (s: number, e: number) => {
    const newStart = fmtTime(s);
    const newEnd = fmtTime(e);
    if (newStart !== plannedTime) setPlannedTime(newStart);
    if (newEnd !== endTime) setEndTime(newEnd);
  };

  const handleContinue = () => {
    navigation.navigate("PlanningRestrictions", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      radiusKm,
      maxAltitude,
      recommendedVlosM,
      vlosExceeded,
      vlosCharDimensionM,
      vlosAltitudeCorrection,
      vlosHorizontalLimitM,
      plannedDate,
      plannedTime,
      endTime,
      routeWaypoints,
      sessionId,
      ...forwardManualRestrictionParams({ restrictionStatus, restrictionNotes }),
      ...forwardCrossCheckParams({ officialMapCrossCheck }),
    });
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepIndicator}>
          <View style={[styles.stepBadge, { backgroundColor: theme.primary }]}>
            <ThemedText style={styles.stepBadgeText}>Schritt 2</ThemedText>
          </View>
          <ThemedText style={[styles.stepSubtitle, { color: theme.textSecondary }]}>
            Wann möchtest du fliegen?
          </ThemedText>
        </View>

        <View style={[styles.locationSummary, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
          <Feather name="map-pin" size={16} color={theme.primary} />
          <View style={styles.locationSummaryText}>
            <ThemedText style={[styles.locationSummaryName, { color: theme.text }]} numberOfLines={1}>
              {locationName || "Standort"}
            </ThemedText>
            <ThemedText style={[styles.locationSummaryCoords, { color: theme.textSecondary }]}>
              {latitude.toFixed(4)}, {longitude.toFixed(4)} | {(radiusKm * 1000) >= 1000 ? `${radiusKm.toFixed(1)} km` : `${Math.round(radiusKm * 1000)} m`} Radius
            </ThemedText>
          </View>
        </View>

        {!isPreflightMode ? (
        <Card style={styles.dateTimeCard}>
          <View style={styles.dateTimeHeader}>
            <Feather name="calendar" size={18} color={theme.primary} />
            <ThemedText style={styles.dateTimeTitle}>Datum</ThemedText>
          </View>

          <Pressable
            testID="planning-date-button"
            onPress={() => { setShowDatePicker(!showDatePicker); setShowStartPicker(false); setShowEndPicker(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[styles.dateButton, { backgroundColor: theme.backgroundSecondary }]}
          >
            <Feather name="calendar" size={16} color={theme.primary} />
            <ThemedText style={[styles.dateButtonText, { color: theme.text }]}>
              {dateObj.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
            </ThemedText>
            <Feather name={showDatePicker ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
          </Pressable>
          {showDatePicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={dateObj}
                mode="date"
                testID="planning-date-picker"
                display={Platform.OS === "ios" ? "inline" : "calendar"}
                onChange={handleDateChange}
                locale="de-DE"
                minimumDate={new Date()}
                maximumDate={(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; })()}
                themeVariant={isDark ? "dark" : "light"}
                accentColor={theme.primary}
              />
            </View>
          ) : null}
        </Card>
        ) : null}

        <Card style={styles.dateTimeCard}>
          <View style={styles.dateTimeHeader}>
            <Feather name="clock" size={18} color={theme.primary} />
            <ThemedText style={styles.dateTimeTitle}>{isPreflightMode ? "Flugdauer" : "Flugzeitraum"}</ThemedText>
            <View style={{ flex: 1 }} />
            <View style={[styles.durationPill, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="watch" size={11} color={theme.textSecondary} />
              <ThemedText style={[styles.durationPillText, { color: theme.textSecondary }]}>{flightDurationLabel}</ThemedText>
            </View>
          </View>

          {isPreflightMode ? (
            <View style={{ marginBottom: Spacing.md }}>
              <ThemedText style={[styles.weatherSubLabel, { color: theme.textSecondary }]}>
                Startzeit & Flugdauer (innerhalb der nächsten 24 h)
              </ThemedText>
              <View style={styles.durationPresetsRow}>
                {[30, 60, 90, 120, 180].map((m) => {
                  let diff = endMin - startMin;
                  if (diff <= 0) diff += 1440;
                  const active = diff === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setDurationMinutes(m)}
                      style={[
                        styles.durationPresetBtn,
                        {
                          backgroundColor: active ? theme.primary : theme.backgroundSecondary,
                          borderColor: active ? theme.primary : theme.border,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.durationPresetText,
                          { color: active ? "#FFFFFF" : theme.textSecondary },
                        ]}
                      >
                        {m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)}h ${m % 60}min`}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={styles.sliderContainer}>
            <SunArcChart
              lat={latitude}
              lon={longitude}
              date={dateObj}
              height={200}
              tempSeries={tempSeries}
              sunrise={solarTimes?.sunrise ?? null}
              sunset={solarTimes?.sunset ?? null}
              dayLengthMinutes={dayLengthMin}
              rangeStart={rangeStartDate}
              rangeEnd={rangeEndDate}
              onRangeChange={handleRangeChange}
              minStart={minStartDate}
              snapMinutes={15}
              lockStart={isPreflightMode}
            />
            <ThemedText style={[styles.sliderHint, { color: theme.textTertiary }]}>
              {isPreflightMode
                ? "Endlinie ziehen, um die Flugdauer anzupassen (Start ab jetzt)"
                : "Linien ziehen, um Start und Ende der Flugzeit anzupassen"}
            </ThemedText>
          </View>

          <View style={styles.timeRow}>
            <View style={styles.timeGroup}>
              <ThemedText style={[styles.dtLabel, { color: theme.textSecondary }]}>Startzeit</ThemedText>
              {isPreflightMode ? (
                <View style={[styles.timeButton, { backgroundColor: theme.backgroundSecondary }]}>
                  <Feather name="play" size={14} color={theme.statusGo} />
                  <ThemedText style={[styles.timeButtonText, { color: theme.text }]}>Jetzt ({plannedTime})</ThemedText>
                </View>
              ) : (
                <Pressable
                  testID="planning-start-time-button"
                  onPress={() => { setShowStartPicker(!showStartPicker); setShowEndPicker(false); setShowDatePicker(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={[styles.timeButton, { backgroundColor: theme.backgroundSecondary }]}
                >
                  <Feather name="clock" size={14} color={theme.primary} />
                  <ThemedText style={[styles.timeButtonText, { color: theme.text }]}>{plannedTime}</ThemedText>
                  <Feather name={showStartPicker ? "chevron-up" : "chevron-down"} size={14} color={theme.textTertiary} />
                </Pressable>
              )}
            </View>

            <View style={styles.timeGroup}>
              <ThemedText style={[styles.dtLabel, { color: theme.textSecondary }]}>Endzeit</ThemedText>
              <Pressable
                testID="planning-end-time-button"
                onPress={() => { setShowEndPicker(!showEndPicker); setShowStartPicker(false); setShowDatePicker(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.timeButton, { backgroundColor: theme.backgroundSecondary }]}
              >
                <Feather name="clock" size={14} color={theme.primary} />
                <ThemedText style={[styles.timeButtonText, { color: theme.text }]}>{endTime}</ThemedText>
                <Feather name={showEndPicker ? "chevron-up" : "chevron-down"} size={14} color={theme.textTertiary} />
              </Pressable>
            </View>
          </View>

          {showStartPicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                key={`start-time-${plannedDate}`}
                testID="planning-start-time-picker"
                value={startTimeObj}
                mode="time"
                display="spinner"
                onChange={handleStartTimeChange}
                locale="de-DE"
                minuteInterval={15}
                is24Hour={true}
                timeZoneName={DEVICE_TIME_ZONE}
                themeVariant={isDark ? "dark" : "light"}
                accentColor={theme.primary}
              />
            </View>
          ) : null}

          {showEndPicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                key={`end-time-${plannedDate}`}
                testID="planning-end-time-picker"
                value={endTimeObj}
                mode="time"
                display="spinner"
                onChange={handleEndTimeChange}
                locale="de-DE"
                minuteInterval={15}
                is24Hour={true}
                timeZoneName={DEVICE_TIME_ZONE}
                themeVariant={isDark ? "dark" : "light"}
                accentColor={theme.primary}
              />
            </View>
          ) : null}
        </Card>

        <Card style={styles.dateTimeCard}>
          <View style={styles.dateTimeHeader}>
            <Feather name="cloud" size={18} color={theme.primary} />
            <ThemedText style={styles.dateTimeTitle}>Wetter-Vorschau</ThemedText>
            <View style={{ flex: 1 }} />
            {weatherLoading ? (
              <ThemedText style={[styles.weatherStatusText, { color: theme.textTertiary }]}>Lade…</ThemedText>
            ) : null}
          </View>

          <ThemedText style={[styles.weatherSubLabel, { color: theme.textSecondary }]}>
            Live-Vorschau für deine Flugzeit (mit 1 h Puffer vor und nach dem Flug)
          </ThemedText>

          {weatherError ? (
            <View style={[styles.weatherErrorBox, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
              <ThemedText style={[styles.weatherErrorText, { color: theme.textSecondary }]}>
                {weatherError}
              </ThemedText>
            </View>
          ) : null}

          {bestHour && !isPreflightMode ? (
            <Pressable
              onPress={handleBestSlot}
              style={({ pressed }) => [
                styles.bestSlotBtn,
                {
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="zap" size={16} color="#fff" />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.bestSlotBtnTitle}>
                  Bester Zeitslot: {String(bestHour.hour).padStart(2, "0")}:00
                </ThemedText>
                <ThemedText style={styles.bestSlotBtnSub}>{bestHour.reason}</ThemedText>
              </View>
              <Feather name="chevron-right" size={18} color="#fff" />
            </Pressable>
          ) : null}

          {hourCards.length > 0 ? (
            <ScrollView
              ref={hourScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hourScrollContent}
              style={styles.hourScroll}
              onLayout={(e) => setHourViewportW(e.nativeEvent.layout.width)}
            >
              {hourCards.map((c) => {
                const inside = c.inFlight;
                const slot = c.slot;
                const dayBg = c.daylight === "day"
                  ? (isDark ? "rgba(255,184,32,0.10)" : "rgba(255,184,32,0.18)")
                  : c.daylight === "twilight"
                  ? (isDark ? "rgba(255,140,0,0.12)" : "rgba(255,140,0,0.18)")
                  : (isDark ? "rgba(40,52,84,0.45)" : "rgba(59,79,116,0.18)");
                const borderCol = inside ? theme.primary : "transparent";
                const dayIcon = c.daylight === "day" ? "sun" : c.daylight === "twilight" ? "sunset" : "moon";
                const dayIconColor = c.daylight === "day" ? "#FFB820" : c.daylight === "twilight" ? "#FF8C00" : "#6B7FA0";
                const tempStr = slot ? `${Math.round(slot.temperature)}°` : "—";
                const windKmh = slot ? Math.round(slot.windSpeed * 3.6) : null;
                const gustKmh = slot?.windGust != null ? Math.round(slot.windGust * 3.6) : null;
                const rain = slot?.rain ?? 0;
                const snow = slot?.snow ?? 0;
                const cloud = slot ? Math.round(slot.cloudCover) : null;
                let weatherIcon: string;
                let weatherIconColor: string;
                let triggerValue: string | null = null;
                if (!slot) {
                  weatherIcon = dayIcon;
                  weatherIconColor = dayIconColor;
                } else if (snow > 0.1) {
                  weatherIcon = "cloud-snow";
                  weatherIconColor = "#60A5FA";
                  triggerValue = `${snow.toFixed(1)} mm`;
                } else if (rain > 0.1) {
                  weatherIcon = "cloud-rain";
                  weatherIconColor = "#3B82F6";
                  triggerValue = `${rain.toFixed(1)} mm`;
                } else if (cloud != null && cloud > 70) {
                  weatherIcon = "cloud";
                  weatherIconColor = isDark ? "#A0AEC0" : "#718096";
                  triggerValue = `${cloud}%`;
                } else if (cloud != null && cloud > 30) {
                  weatherIcon = "cloud-drizzle";
                  weatherIconColor = dayIconColor;
                  triggerValue = `${cloud}%`;
                } else {
                  weatherIcon = dayIcon;
                  weatherIconColor = dayIconColor;
                }
                return (
                  <Pressable
                    key={c.ts.getTime()}
                    onPress={() => {
                      if (isPreflightMode) return;
                      if (Platform.OS !== "web") {
                        Haptics.selectionAsync().catch(() => {});
                      }
                      setPlannedTime(`${String(c.hour).padStart(2, "0")}:00`);
                    }}
                    style={({ pressed }) => [
                      styles.hourCard,
                      {
                        backgroundColor: dayBg,
                        borderColor: borderCol,
                        borderWidth: inside ? 2 : 1,
                        opacity: pressed ? 0.6 : inside ? 1 : 0.85,
                      },
                    ]}
                  >
                    <ThemedText style={[styles.hourCardTime, { color: inside ? theme.text : theme.textSecondary }]}>
                      {String(c.hour).padStart(2, "0")}:00
                    </ThemedText>
                    {inside ? (
                      <View style={[styles.hourCardBadge, { backgroundColor: theme.primary }]}>
                        <ThemedText style={styles.hourCardBadgeText}>FLUG</ThemedText>
                      </View>
                    ) : (
                      <View style={[styles.hourCardBadge, { backgroundColor: theme.backgroundTertiary || theme.backgroundSecondary }]}>
                        <ThemedText style={[styles.hourCardBadgeText, { color: theme.textSecondary }]}>±1 h</ThemedText>
                      </View>
                    )}
                    <Feather name={weatherIcon as any} size={22} color={weatherIconColor} style={{ marginTop: 4 }} />
                    {triggerValue ? (
                      <ThemedText style={[styles.hourCardTrigger, { color: weatherIconColor }]}>
                        {triggerValue}
                      </ThemedText>
                    ) : null}
                    <ThemedText style={[styles.hourCardTemp, { color: theme.text }]}>{tempStr}</ThemedText>
                    <View style={styles.hourCardMetric}>
                      <Feather name="wind" size={10} color={theme.textSecondary} />
                      <ThemedText style={[styles.hourCardMetricText, { color: theme.textSecondary }]}>
                        {windKmh != null ? `${windKmh}` : "—"}
                        {gustKmh != null && gustKmh > (windKmh ?? 0) ? `/${gustKmh}` : ""}
                      </ThemedText>
                    </View>
                    <View style={styles.hourCardMetric}>
                      <Feather name="droplet" size={10} color={theme.textSecondary} />
                      <ThemedText style={[styles.hourCardMetricText, { color: theme.textSecondary }]}>
                        {rain > 0 ? `${rain.toFixed(1)}` : "0"}
                      </ThemedText>
                    </View>
                    {cloud != null ? (
                      <View style={styles.hourCardMetric}>
                        <Feather name="cloud" size={10} color={theme.textSecondary} />
                        <ThemedText style={[styles.hourCardMetricText, { color: theme.textSecondary }]}>
                          {cloud}%
                        </ThemedText>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            !weatherLoading && !weatherError ? (
              <View style={[styles.weatherErrorBox, { backgroundColor: theme.backgroundSecondary }]}>
                <Feather name="cloud-off" size={14} color={theme.textTertiary} />
                <ThemedText style={[styles.weatherErrorText, { color: theme.textSecondary }]}>
                  Keine Wetterdaten für diesen Zeitraum verfügbar.
                </ThemedText>
              </View>
            ) : null
          )}

          <View style={styles.hourLegendRow}>
            <View style={styles.hourLegendItem}>
              <View style={[styles.hourLegendSwatch, { backgroundColor: theme.primary }]} />
              <ThemedText style={[styles.hourLegendText, { color: theme.textSecondary }]}>Flugzeit</ThemedText>
            </View>
            <View style={styles.hourLegendItem}>
              <View style={[styles.hourLegendSwatch, { backgroundColor: theme.backgroundTertiary || theme.backgroundSecondary }]} />
              <ThemedText style={[styles.hourLegendText, { color: theme.textSecondary }]}>±1 h Puffer</ThemedText>
            </View>
            {!isPreflightMode ? (
              <View style={styles.hourLegendItem}>
                <Feather name="mouse-pointer" size={12} color={theme.textSecondary} />
                <ThemedText style={[styles.hourLegendText, { color: theme.textSecondary }]}>Stunde tippen, um Start zu setzen</ThemedText>
              </View>
            ) : null}
          </View>

          {!summary.hasData && summary.criticals.length > 0 ? (
            <View style={[styles.summaryBox, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
              <View style={styles.criticalList}>
                {summary.criticals.map((c, i) => {
                  const color = c.type === "danger"
                    ? theme.statusNoGo
                    : c.type === "warn"
                    ? theme.statusCaution
                    : theme.textSecondary;
                  const bg = c.type === "danger"
                    ? theme.statusNoGoBackground
                    : c.type === "warn"
                    ? theme.statusCautionBackground
                    : theme.backgroundDefault;
                  return (
                    <View key={i} style={[styles.criticalRow, { backgroundColor: bg }]}>
                      <Feather name={c.icon as any} size={12} color={color} />
                      <ThemedText style={[styles.criticalText, { color }]}>{c.text}</ThemedText>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {summary.hasData ? (
            <View style={[styles.summaryBox, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
              <View style={styles.summaryHeader}>
                <Feather name="activity" size={14} color={theme.primary} />
                <ThemedText style={[styles.summaryTitle, { color: theme.text }]}>
                  Zusammenfassung Flugzeit
                </ThemedText>
              </View>
              <View style={styles.summaryStatsRow}>
                {summary.avgTemp != null ? (
                  <View style={styles.summaryStat}>
                    <Feather name="thermometer" size={11} color={theme.textSecondary} />
                    <ThemedText style={[styles.summaryStatText, { color: theme.textSecondary }]}>
                      Ø {Math.round(summary.avgTemp)}° (min {Math.round(summary.minTemp ?? 0)}°)
                    </ThemedText>
                  </View>
                ) : null}
                {summary.maxWind != null ? (
                  <View style={styles.summaryStat}>
                    <Feather name="wind" size={11} color={theme.textSecondary} />
                    <ThemedText style={[styles.summaryStatText, { color: theme.textSecondary }]}>
                      max {Math.round(summary.maxWind)} km/h
                      {summary.maxGust && summary.maxGust > summary.maxWind ? ` (Böen ${Math.round(summary.maxGust)})` : ""}
                    </ThemedText>
                  </View>
                ) : null}
                <View style={styles.summaryStat}>
                  <Feather name="droplet" size={11} color={theme.textSecondary} />
                  <ThemedText style={[styles.summaryStatText, { color: theme.textSecondary }]}>
                    {summary.totalRain.toFixed(1)} mm
                  </ThemedText>
                </View>
                {summary.maxCloud != null ? (
                  <View style={styles.summaryStat}>
                    <Feather name="cloud" size={11} color={theme.textSecondary} />
                    <ThemedText style={[styles.summaryStatText, { color: theme.textSecondary }]}>
                      bis {Math.round(summary.maxCloud)}%
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              {summary.criticals.length > 0 ? (
                <View style={styles.criticalList}>
                  {summary.criticals.map((c, i) => {
                    const color = c.type === "danger"
                      ? theme.statusNoGo
                      : c.type === "warn"
                      ? theme.statusCaution
                      : theme.textSecondary;
                    const bg = c.type === "danger"
                      ? theme.statusNoGoBackground
                      : c.type === "warn"
                      ? theme.statusCautionBackground
                      : theme.backgroundDefault;
                    return (
                      <View key={i} style={[styles.criticalRow, { backgroundColor: bg }]}>
                        <Feather name={c.icon as any} size={12} color={color} />
                        <ThemedText style={[styles.criticalText, { color }]}>{c.text}</ThemedText>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.criticalRow, { backgroundColor: theme.statusGoBackground }]}>
                  <Feather name="check-circle" size={12} color={theme.statusGo} />
                  <ThemedText style={[styles.criticalText, { color: theme.statusGo }]}>
                    Keine kritischen Wetterpunkte erkannt.
                  </ThemedText>
                </View>
              )}
            </View>
          ) : null}
        </Card>

        <HourlyForecastTable
          hourlySlots={hourlySlots}
          hourlySource={hourlySource}
          latitude={latitude}
          longitude={longitude}
          maxAltitude={maxAltitude ?? 120}
          drone={drone}
          subtitle={`Flugzeit ${plannedTime} - ${endTime} Uhr`}
          highlightStart={rangeStartDate}
          highlightEnd={rangeEndDate}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          testID="planning-continue-button"
          title="Weiter zu Einschränkungen"
          onPress={handleContinue}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  stepIndicator: {
    marginBottom: Spacing.xl,
  },
  stepBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  stepBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  stepSubtitle: {
    ...Typography.h3,
  },
  locationSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  locationSummaryText: {
    flex: 1,
  },
  locationSummaryName: {
    ...Typography.body,
    fontWeight: "600",
  },
  locationSummaryCoords: {
    ...Typography.caption,
    marginTop: 2,
  },
  dateTimeCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  dateTimeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dateTimeTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  dtLabel: {
    ...Typography.caption,
    marginBottom: 4,
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  dateButtonText: {
    ...Typography.body,
    flex: 1,
  },
  pickerContainer: {
    marginTop: Spacing.xs,
    alignItems: "center",
  },
  sliderHint: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
    fontStyle: "italic",
  },
  sliderContainer: {
    marginBottom: Spacing.md,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.md,
  },
  timeGroup: {
    flex: 1,
  },
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: 6,
  },
  timeButtonText: {
    ...Typography.body,
    flex: 1,
  },
  durationPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  durationPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  weatherSubLabel: {
    ...Typography.caption,
    marginBottom: Spacing.sm,
  },
  weatherStatusText: {
    fontSize: 11,
    fontWeight: "500",
  },
  weatherErrorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  weatherErrorText: {
    ...Typography.caption,
    flex: 1,
  },
  bestSlotBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  bestSlotBtnTitle: {
    ...Typography.body,
    color: "#fff",
    fontWeight: "700",
  },
  bestSlotBtnSub: {
    ...Typography.caption,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  hourScroll: {
    marginHorizontal: -Spacing.sm,
  },
  hourScrollContent: {
    paddingHorizontal: Spacing.sm,
    gap: 8,
    paddingVertical: 4,
  },
  hourCard: {
    width: 76,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: BorderRadius.sm,
    borderWidth: 2,
    alignItems: "center",
    gap: 3,
  },
  hourCardTime: {
    fontSize: 13,
    fontWeight: "700",
  },
  hourCardBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  hourCardBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  hourCardTemp: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 2,
  },
  hourCardTrigger: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
  },
  summaryBox: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: 8,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  summaryStatsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    rowGap: 4,
  },
  summaryStat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  summaryStatText: {
    fontSize: 11,
    fontWeight: "500",
  },
  criticalList: {
    gap: 4,
  },
  criticalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  criticalText: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  durationPresetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: Spacing.sm,
  },
  durationPresetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  durationPresetText: {
    fontSize: 12,
    fontWeight: "600",
  },
  hourCardMetric: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  hourCardMetricText: {
    fontSize: 11,
    fontWeight: "500",
  },
  hourLegendRow: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginTop: Spacing.sm,
    justifyContent: "center",
  },
  hourLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  hourLegendSwatch: {
    width: 14,
    height: 8,
    borderRadius: 2,
  },
  hourLegendText: {
    fontSize: 11,
    fontWeight: "500",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
});
