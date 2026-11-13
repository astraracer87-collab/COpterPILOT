import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, TextInput } from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import { getDrone, getFlightSession, WeatherSnapshot, DroneProfile, WeatherLimits, createFlightSession, updateFlightSession } from "@/lib/storage";
import { fetchWeatherForecastWithSource, fetchHourlyForecasts, WeatherData, HourlyForecastSlot } from "@/lib/weather";
import { assessWeather, AssessmentWarning } from "@/lib/assessment";
import { fetchKpIndex, KpIndexData, getKpLabel } from "@/lib/kpindex";
import { calculateSolarTimes, isTimeDuringDaylight, isTimeDuringCivilTwilight } from "@/lib/solar";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningDetails">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningDetails">;

export default function PlanningDetailsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  
  const { droneId, latitude, longitude, locationName, countryIso, mapUrl, sessionId: initialSessionId, radiusKm, routeWaypoints } = route.params;
  
  const plannedDate = route.params.plannedDate || (() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  })();
  const plannedTime = route.params.plannedTime || "12:00";
  const endTime = route.params.endTime || "13:00";
  const [loading, setLoading] = useState(false);
  const [forecastWeather, setForecastWeather] = useState<WeatherSnapshot | null>(null);
  const [weatherWarnings, setWeatherWarnings] = useState<AssessmentWarning[]>([]);
  const [hourlySlots, setHourlySlots] = useState<HourlyForecastSlot[]>([]);
  const [hourlySource, setHourlySource] = useState<"dipul" | "brightsky" | null>(null);
  const [isFpvFlight, setIsFpvFlight] = useState(false);
  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(initialSessionId || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [weatherSource, setWeatherSource] = useState<"dipul" | "brightsky" | null>(null);
  const [weatherTooFarAhead, setWeatherTooFarAhead] = useState(false);
  const [maxAltitude, setMaxAltitude] = useState(120);
  const [kpData, setKpData] = useState<KpIndexData | null>(null);

  const dateObj = useMemo(() => {
    const d = new Date(plannedDate + "T00:00:00");
    return isNaN(d.getTime()) ? new Date() : d;
  }, [plannedDate]);

  const flightDurationLabel = useMemo(() => {
    const [sh, sm] = plannedTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff <= 0) diff += 1440;
    const dh = Math.floor(diff / 60);
    const dm = diff % 60;
    return `${dh}h${dm > 0 ? ` ${dm}min` : ""}`;
  }, [plannedTime, endTime]);

  const isFpvOnlyDrone = drone?.droneType === "fpv_only";

  useFocusEffect(
    useCallback(() => {
      const loadDroneAndSession = async () => {
        const d = await getDrone(droneId);
        setDrone(d);
        
        if (d?.droneType === "fpv_only") {
          setIsFpvFlight(true);
        }
        if (initialSessionId) {
          const session = await getFlightSession(initialSessionId);
          if (session?.planning?.isFpvFlight) {
            setIsFpvFlight(true);
          }
          if (session?.planning?.maxAltitude != null && session.planning.maxAltitude > 0) {
            setMaxAltitude(session.planning.maxAltitude);
          }
        }
      };
      loadDroneAndSession();
    }, [droneId, initialSessionId])
  );

  useEffect(() => {
    if (!initialLoadDone && drone) {
      setInitialLoadDone(true);
      handleFetchForecast();
    }
  }, [drone, initialLoadDone]);

  useEffect(() => {
    if (!initialLoadDone || !drone) return;
    
    const debounceTimer = setTimeout(() => {
      if (isValidDateTime()) {
        updateWeatherSilently();
      }
    }, 500);
    
    return () => clearTimeout(debounceTimer);
  }, [plannedDate, plannedTime, endTime]);

  useEffect(() => {
    if (!forecastWeather || !drone) return;
    const emptyAlt = [{ height: 2, value: 0 }];
    const emptyWind: { height: number; speed: number; gust?: number; direction: number }[] = [];
    const emptyCloud: { height: number; value: number }[] = [];
    const allForecasts = hourlySlots.length > 0
      ? hourlySlots.map((s) => ({
          timestamp: s.timestamp,
          temperature: s.temperature,
          humidity: s.humidity || 50,
          windSpeed: s.windSpeed,
          windGust: s.windGust,
          windDirection: 0,
          windAtAltitude: s.windAtAltitude ?? emptyWind,
          temperatureAtAltitude: s.temperatureAtAltitude ?? emptyAlt,
          humidityAtAltitude: s.humidityAtAltitude ?? emptyAlt,
          cloudCoverAtAltitude: emptyCloud,
          rain: s.rain,
          snow: s.snow ?? 0,
          cloudCover: s.cloudCover,
          pressure: s.pressure ?? 1013,
        }))
      : [{
          timestamp: new Date().toISOString(),
          temperature: forecastWeather.temperature,
          humidity: forecastWeather.humidity || 50,
          windSpeed: forecastWeather.windSpeed,
          windGust: forecastWeather.windGust,
          windDirection: 0,
          windAtAltitude: emptyWind,
          temperatureAtAltitude: emptyAlt,
          humidityAtAltitude: emptyAlt,
          cloudCoverAtAltitude: emptyCloud,
          rain: forecastWeather.rain,
          snow: 0,
          cloudCover: forecastWeather.cloudCover,
          pressure: 1013,
        }];
    const weatherData: WeatherData = {
      latitude,
      longitude,
      calculationTime: new Date().toISOString(),
      forecasts: allForecasts,
    };
    const assessment = assessWeather(weatherData, drone.limits, false, undefined, kpData?.value, maxAltitude);
    setWeatherWarnings(assessment.warnings);
  }, [maxAltitude]);

  const isValidDateTime = () => {
    const planned = new Date(`${plannedDate}T${plannedTime}`);
    return !isNaN(planned.getTime());
  };

  const updateWeatherSilently = async () => {
    if (!isValidDateTime()) return;
    
    setIsRefreshing(true);
    try {
      const startIso = `${plannedDate}T${plannedTime}`;
      const endIso = `${plannedDate}T${endTime}`;
      const [result, hourlyResult, kpResult] = await Promise.all([
        fetchWeatherForecastWithSource(latitude, longitude, startIso),
        fetchHourlyForecasts(latitude, longitude, startIso, endIso).catch(() => ({ slots: [] as HourlyForecastSlot[], source: "dipul" as const })),
        fetchKpIndex().catch(() => null),
      ]);
      setForecastWeather(result.weather);
      setWeatherSource(result.source);
      setWeatherTooFarAhead(!!result.tooFarAhead);
      if (kpResult) setKpData(kpResult);
      if (result.weather) {
        setHourlySlots(hourlyResult.slots);
        setHourlySource(hourlyResult.source);
      } else {
        setHourlySlots([]);
        setHourlySource(null);
      }
      
      if (drone && result.weather) {
        const emptyAlt = [{ height: 2, value: 0 }];
        const emptyWind: { height: number; speed: number; gust?: number; direction: number }[] = [];
        const emptyCloud: { height: number; value: number }[] = [];
        const allForecasts = hourlyResult.slots.length > 0
          ? hourlyResult.slots.map((s) => ({
              timestamp: s.timestamp,
              temperature: s.temperature,
              humidity: s.humidity || 50,
              windSpeed: s.windSpeed,
              windGust: s.windGust,
              windDirection: 0,
              windAtAltitude: s.windAtAltitude ?? emptyWind,
              temperatureAtAltitude: s.temperatureAtAltitude ?? emptyAlt,
              humidityAtAltitude: s.humidityAtAltitude ?? emptyAlt,
              cloudCoverAtAltitude: emptyCloud,
              rain: s.rain,
              snow: s.snow ?? 0,
              cloudCover: s.cloudCover,
              pressure: s.pressure ?? 1013,
            }))
          : [{
              timestamp: new Date().toISOString(),
              temperature: result.weather.temperature,
              humidity: result.weather.humidity || 50,
              windSpeed: result.weather.windSpeed,
              windGust: result.weather.windGust,
              windDirection: 0,
              windAtAltitude: emptyWind,
              temperatureAtAltitude: emptyAlt,
              humidityAtAltitude: emptyAlt,
              cloudCoverAtAltitude: emptyCloud,
              rain: result.weather.rain,
              snow: 0,
              cloudCover: result.weather.cloudCover,
              pressure: 1013,
            }];
        const weatherData: WeatherData = {
          latitude,
          longitude,
          calculationTime: new Date().toISOString(),
          forecasts: allForecasts,
        };
        const assessment = assessWeather(weatherData, drone.limits, false, undefined, kpResult?.value ?? kpData?.value, maxAltitude);
        setWeatherWarnings(assessment.warnings);
      }
    } catch (error) {
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFetchForecast = async () => {
    if (!isValidDateTime()) {
      Alert.alert("Ungültiges Datum", "Bitte gib ein gültiges Datum und eine gültige Uhrzeit ein.");
      return;
    }
    
    setLoading(true);
    try {
      const startIso = `${plannedDate}T${plannedTime}`;
      const endIso = `${plannedDate}T${endTime}`;
      const [result, hourlyResult, kpResult] = await Promise.all([
        fetchWeatherForecastWithSource(latitude, longitude, startIso),
        fetchHourlyForecasts(latitude, longitude, startIso, endIso).catch(() => ({ slots: [] as HourlyForecastSlot[], source: "dipul" as const })),
        fetchKpIndex().catch(() => null),
      ]);
      setForecastWeather(result.weather);
      setWeatherSource(result.source);
      setWeatherTooFarAhead(!!result.tooFarAhead);
      setKpData(kpResult);
      if (result.weather) {
        setHourlySlots(hourlyResult.slots);
        setHourlySource(hourlyResult.source);
      } else {
        setHourlySlots([]);
        setHourlySource(null);
      }
      
      if (drone && result.weather) {
        const emptyAlt = [{ height: 2, value: 0 }];
        const emptyWind: { height: number; speed: number; gust?: number; direction: number }[] = [];
        const emptyCloud: { height: number; value: number }[] = [];
        const allForecasts = hourlyResult.slots.length > 0
          ? hourlyResult.slots.map((s) => ({
              timestamp: s.timestamp,
              temperature: s.temperature,
              humidity: s.humidity || 50,
              windSpeed: s.windSpeed,
              windGust: s.windGust,
              windDirection: 0,
              windAtAltitude: s.windAtAltitude ?? emptyWind,
              temperatureAtAltitude: s.temperatureAtAltitude ?? emptyAlt,
              humidityAtAltitude: s.humidityAtAltitude ?? emptyAlt,
              cloudCoverAtAltitude: emptyCloud,
              rain: s.rain,
              snow: s.snow ?? 0,
              cloudCover: s.cloudCover,
              pressure: s.pressure ?? 1013,
            }))
          : [{
              timestamp: new Date().toISOString(),
              temperature: result.weather.temperature,
              humidity: result.weather.humidity || 50,
              windSpeed: result.weather.windSpeed,
              windGust: result.weather.windGust,
              windDirection: 0,
              windAtAltitude: emptyWind,
              temperatureAtAltitude: emptyAlt,
              humidityAtAltitude: emptyAlt,
              cloudCoverAtAltitude: emptyCloud,
              rain: result.weather.rain,
              snow: 0,
              cloudCover: result.weather.cloudCover,
              pressure: 1013,
            }];
        const weatherData: WeatherData = {
          latitude,
          longitude,
          calculationTime: new Date().toISOString(),
          forecasts: allForecasts,
        };
        const assessment = assessWeather(weatherData, drone.limits, false, undefined, kpResult?.value, maxAltitude);
        setWeatherWarnings(assessment.warnings);
      }
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Fehler", "Wetterdaten konnten nicht abgerufen werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!isValidDateTime()) {
      Alert.alert("Ungültiges Datum", "Bitte gib ein gültiges Datum und eine gültige Uhrzeit ein.");
      return;
    }
    
    const droneData = await getDrone(droneId);
    if (!droneData) {
      Alert.alert("Fehler", "Drohne nicht gefunden.");
      return;
    }
    
    try {
      let sessionId = createdSessionId;
      
      if (sessionId) {
        const existingSession = await getFlightSession(sessionId);
        const existingPlanning = existingSession?.planning;
        
        await updateFlightSession(sessionId, {
          planning: {
            plannedDate,
            plannedTime,
            forecastWeather: forecastWeather || undefined,
            checklistCompleted: existingPlanning?.checklistCompleted || [],
            flightPurpose: existingPlanning?.flightPurpose,
            maxAltitude,
            maxDistance: existingPlanning?.maxDistance,
            radiusKm: radiusKm || existingPlanning?.radiusKm,
            estimatedDuration: existingPlanning?.estimatedDuration,
            routeDescription: existingPlanning?.routeDescription,
            isFpvFlight,
          },
        });
      } else {
        const session = await createFlightSession({
          droneId,
          currentPhase: "planning",
          latitude,
          longitude,
          locationName,
          countryIso,
          mapUrl,
          hasRestrictions: false,
          status: "caution",
          planning: {
            plannedDate,
            plannedTime,
            radiusKm,
            maxAltitude,
            forecastWeather: forecastWeather || undefined,
            checklistCompleted: [],
            isFpvFlight,
          },
        });
        sessionId = session.id;
        setCreatedSessionId(sessionId);
      }
      
      if (droneData.droneType === "hybrid_fpv") {
        navigation.navigate("PlanningFpvSelect", {
          droneId,
          latitude,
          longitude,
          locationName,
          countryIso,
          mapUrl,
          plannedDate,
          plannedTime,
          forecastWeather: forecastWeather || undefined,
          limits: droneData.limits,
          maxAltitude,
          sessionId,
        });
      } else {
        navigation.navigate("PlanningChecklist", {
          droneId,
          latitude,
          longitude,
          locationName,
          countryIso,
          mapUrl,
          plannedDate,
          plannedTime,
          forecastWeather: forecastWeather || undefined,
          limits: droneData.limits,
          maxAltitude,
          isFpvFlight,
          sessionId,
        });
      }
    } catch (error) {
      Alert.alert("Fehler", "Session konnte nicht erstellt werden.");
    }
  };

  const renderHourlyRowValues = (values: string[], levels: ("ok"|"warn"|"crit")[]) => (
    <View style={styles.hourlyDataRow}>
      {values.map((v, i) => {
        const lvl = levels[i];
        const cellStyle = lvl === "crit"
          ? { color: theme.statusNoGo, fontWeight: "800" as const, backgroundColor: theme.statusNoGoBackground }
          : lvl === "warn"
          ? { color: theme.statusCaution, fontWeight: "700" as const, backgroundColor: theme.statusCautionBackground }
          : undefined;
        return (
          <ThemedText key={i} style={[styles.hourlyCell, styles.hourlyValCol, cellStyle]}>{v}</ThemedText>
        );
      })}
    </View>
  );

  const hourlySolarIcons = useMemo(() => {
    if (hourlySlots.length === 0) return [];
    return hourlySlots.map(s => {
      const t = new Date(s.timestamp);
      const solar = calculateSolarTimes(latitude, longitude, t);
      const day = isTimeDuringDaylight(t, solar);
      const twi = isTimeDuringCivilTwilight(t, solar);
      const morningTwi = twi && solar.sunrise && t < solar.sunrise;
      return { icon: day ? "sun" : twi ? (morningTwi ? "sunrise" : "sunset") : "moon", color: day ? "#FFB820" : twi ? "#FF8C00" : "#6B7FA0", bg: day ? "rgba(255,184,32,0.12)" : twi ? "rgba(255,140,0,0.12)" : "rgba(107,127,160,0.08)" } as const;
    });
  }, [hourlySlots, latitude, longitude]);

  const hourlyRowConfigs = useMemo(() => {
    if (hourlySlots.length === 0) return [];
    const hasAltWind = hourlySlots.some(s => s.windAtAltitude && s.windAtAltitude.length > 0);
    const hasPressure = hourlySlots.some(s => s.pressure);
    const rows: { label: string; values: string[]; levels: ("ok"|"warn"|"crit")[] }[] = [
      { label: "Temp", values: hourlySlots.map(s => `${s.temperature.toFixed(0)}\u00B0`), levels: hourlySlots.map(s => s.temperature < -5 ? "crit" : s.temperature < 0 ? "warn" : "ok") },
      { label: "Feuchte", values: hourlySlots.map(s => `${s.humidity.toFixed(0)}%`), levels: hourlySlots.map(s => s.humidity > 90 ? "warn" : "ok") },
      { label: "Wind 10m", values: hourlySlots.map(s => s.windSpeed.toFixed(1)), levels: hourlySlots.map(s => s.windSpeed > 10 ? "crit" : s.windSpeed > 7 ? "warn" : "ok") },
      { label: "B\u00F6en 10m", values: hourlySlots.map(s => s.windGust != null ? s.windGust.toFixed(1) : "-"), levels: hourlySlots.map(s => (s.windGust ?? 0) > 12 ? "crit" : (s.windGust ?? 0) > 9 ? "warn" : "ok") },
    ];
    const relevantAltHeights = [50, 100, 150, 200, 250].filter(h => h <= maxAltitude + 50);
    if (hasAltWind && relevantAltHeights.length > 0) {
      relevantAltHeights.forEach(h => {
        const isFlightLevel = h <= maxAltitude && h >= maxAltitude - 50;
        rows.push({
          label: isFlightLevel ? `Wind ${h}m \u2708` : `Wind ${h}m`,
          values: hourlySlots.map(s => { const w = s.windAtAltitude?.find(a => a.height === h); return w ? w.speed.toFixed(1) : "-"; }),
          levels: hourlySlots.map(s => { const w = s.windAtAltitude?.find(a => a.height === h); if (!w) return "ok"; return w.speed > 12 ? "crit" : w.speed > 8 ? "warn" : "ok"; }),
        });
      });
    }
    const hasAltTemp = hourlySlots.some(s => s.temperatureAtAltitude && s.temperatureAtAltitude.length > 1);
    if (hasAltTemp && relevantAltHeights.length > 0) {
      relevantAltHeights.forEach(h => {
        const isFlightLevel = h <= maxAltitude && h >= maxAltitude - 50;
        rows.push({
          label: isFlightLevel ? `Temp ${h}m \u2708` : `Temp ${h}m`,
          values: hourlySlots.map(s => { const t = s.temperatureAtAltitude?.find(a => a.height === h); return t ? `${t.value.toFixed(0)}\u00B0` : "-"; }),
          levels: hourlySlots.map(s => { const t = s.temperatureAtAltitude?.find(a => a.height === h); if (!t) return "ok"; return t.value < -5 ? "crit" : t.value < 0 ? "warn" : "ok"; }),
        });
      });
    }
    rows.push(
      { label: "Regen", values: hourlySlots.map(s => s.rain.toFixed(1)), levels: hourlySlots.map(s => s.rain > 0.5 ? "crit" : s.rain > 0 ? "warn" : "ok") },
      { label: "Wolken", values: hourlySlots.map(s => `${Math.round(s.cloudCover)}%`), levels: hourlySlots.map(s => s.cloudCover > 80 ? "warn" : "ok") },
    );
    if (hasPressure) {
      rows.push({ label: "QNH hPa", values: hourlySlots.map(s => s.pressure ? `${s.pressure}` : "-"), levels: hourlySlots.map(() => "ok") });
    }
    return rows;
  }, [hourlySlots, maxAltitude]);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + 100,
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={styles.title}>Wetterprüfung</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Wetterdaten für deinen geplanten Flug
          </ThemedText>
        </View>

        <Card style={styles.locationInfo}>
          <Feather name="map-pin" size={18} color={theme.primary} />
          <ThemedText style={[styles.locationText, { color: theme.textSecondary }]}>
            {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
          </ThemedText>
        </Card>

        {drone ? (
          <Card style={styles.droneInfoCard}>
            <View style={styles.droneInfoRow}>
              <Feather name="send" size={18} color={theme.primary} />
              <ThemedText style={styles.droneInfoName}>{drone.name}</ThemedText>
              <View style={[styles.droneClassBadge, { backgroundColor: theme.backgroundSecondary }]}>
                <ThemedText style={[styles.droneClassText, { color: theme.primary }]}>{drone.classMark}</ThemedText>
              </View>
              {drone.droneType === "fpv_only" ? (
                <View style={[styles.droneTypeBadge, { backgroundColor: theme.statusCautionBackground }]}>
                  <ThemedText style={[styles.droneTypeText, { color: theme.statusCaution }]}>FPV</ThemedText>
                </View>
              ) : drone.droneType === "hybrid_fpv" ? (
                <View style={[styles.droneTypeBadge, { backgroundColor: theme.primary + "20" }]}>
                  <ThemedText style={[styles.droneTypeText, { color: theme.primary }]}>Hybrid</ThemedText>
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        <Card style={styles.inputCard}>
          <View style={styles.flightTimeSummary}>
            <View style={styles.flightTimeSummaryRow}>
              <Feather name="calendar" size={16} color={theme.primary} />
              <ThemedText style={styles.flightTimeSummaryText}>
                {dateObj.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
              </ThemedText>
            </View>
            <View style={styles.flightTimeSummaryRow}>
              <Feather name="clock" size={16} color={theme.primary} />
              <ThemedText style={styles.flightTimeSummaryText}>
                {plannedTime} - {endTime} ({flightDurationLabel})
              </ThemedText>
            </View>
          </View>
        </Card>

        <Card style={styles.altitudeCard}>
          <View style={styles.altitudeHeader}>
            <View style={styles.altitudeIconRow}>
              <Feather name="arrow-up" size={18} color={theme.primary} />
              <ThemedText style={styles.altitudeTitle}>Geplante Flughöhe (AGL)</ThemedText>
            </View>
            {maxAltitude > 120 ? (
              <View style={[styles.altitudeBadge, { backgroundColor: theme.statusCautionBackground }]}>
                <ThemedText style={[styles.altitudeBadgeText, { color: theme.statusCaution }]}>Über 120m</ThemedText>
              </View>
            ) : null}
          </View>
          <View style={styles.altitudeInputRow}>
            {[30, 50, 80, 100, 120, 150].map(h => (
              <Pressable
                key={h}
                style={[
                  styles.altitudeChip,
                  { borderColor: maxAltitude === h ? theme.primary : theme.border },
                  maxAltitude === h ? { backgroundColor: theme.primary + "20" } : undefined,
                ]}
                onPress={() => setMaxAltitude(h)}
              >
                <ThemedText style={[styles.altitudeChipText, maxAltitude === h ? { color: theme.primary, fontWeight: "700" } : { color: theme.textSecondary }]}>{h}m</ThemedText>
              </Pressable>
            ))}
          </View>
          <View style={styles.altitudeCustomRow}>
            <ThemedText style={[styles.altitudeCustomLabel, { color: theme.textSecondary }]}>Eigene Höhe:</ThemedText>
            <TextInput
              style={[styles.altitudeInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
              value={String(maxAltitude)}
              onChangeText={t => {
                const n = parseInt(t, 10);
                if (!isNaN(n) && n >= 0 && n <= 500) setMaxAltitude(n);
                else if (t === "") setMaxAltitude(0);
              }}
              keyboardType="number-pad"
              maxLength={3}
            />
            <ThemedText style={[styles.altitudeUnit, { color: theme.textSecondary }]}>m AGL</ThemedText>
          </View>
          {maxAltitude > 120 ? (
            <View style={[styles.altitudeWarningBanner, { backgroundColor: theme.statusCautionBackground }]}>
              <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
              <ThemedText style={[styles.altitudeWarningText, { color: theme.statusCaution }]}>
                Über 120m AGL nur mit Genehmigung nach SERA.3145 oder in zugelassenen Gebieten erlaubt.
              </ThemedText>
            </View>
          ) : null}
        </Card>

        <Card style={styles.weatherCard}>
          <View style={styles.weatherHeader}>
            <View>
              <ThemedText style={styles.weatherTitle}>Wetter für Flughöhe {maxAltitude}m</ThemedText>
              {weatherSource ? (
                <ThemedText style={[styles.weatherSourceLabel, { color: theme.textTertiary }]}>
                  {weatherSource === "dipul" ? "Quelle: DFS dipul (ICON-D2)" : "Quelle: DWD BrightSky"}
                </ThemedText>
              ) : null}
            </View>
            {isRefreshing ? (
              <Feather name="refresh-cw" size={14} color={theme.textTertiary} />
            ) : null}
          </View>
          {loading && !forecastWeather ? (
            <View style={styles.weatherLoadingContainer}>
              <Feather name="cloud" size={24} color={theme.primary} />
              <ThemedText style={[styles.weatherLoadingText, { color: theme.textSecondary }]}>
                Lade Wettervorhersage...
              </ThemedText>
            </View>
          ) : weatherTooFarAhead && !forecastWeather ? (
            <View style={styles.weatherTooFarContainer}>
              <Feather name="clock" size={28} color={theme.statusCaution} />
              <ThemedText style={[styles.weatherTooFarTitle, { color: theme.text }]}>
                Keine Wetterdaten verfügbar
              </ThemedText>
              <ThemedText style={[styles.weatherTooFarText, { color: theme.textSecondary }]}>
                Der geplante Flug liegt zu weit in der Zukunft, um das Wetter zuverlässig vorherzusagen.
              </ThemedText>
              <View style={[styles.weatherTooFarBanner, { backgroundColor: theme.statusCautionBackground }]}>
                <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
                <ThemedText style={[styles.weatherTooFarBannerText, { color: theme.statusCaution }]}>
                  Bitte führe einen Tag vor dem geplanten Flug einen erneuten Wetter-Check durch.
                </ThemedText>
              </View>
            </View>
          ) : forecastWeather ? (
            <>
              {weatherTooFarAhead ? (
                <View style={[styles.weatherTooFarBanner, { backgroundColor: theme.statusCautionBackground, marginBottom: Spacing.md }]}>
                  <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
                  <ThemedText style={[styles.weatherTooFarBannerText, { color: theme.statusCaution }]}>
                    Vorläufige Prognose. Bitte einen Tag vor dem Flug erneut prüfen.
                  </ThemedText>
                </View>
              ) : null}
              {(() => {
                const altHeightsW = [10, 50, 100, 150, 200, 250];
                const nearestHW = altHeightsW.reduce((best, h) =>
                  Math.abs(h - maxAltitude) < Math.abs(best - maxAltitude) ? h : best
                , altHeightsW[0]);
                const slot0 = hourlySlots.length > 0 ? hourlySlots[0] : null;
                const altWindSource = slot0?.windAtAltitude ?? forecastWeather.windAtAltitude;
                const altTempSource = slot0?.temperatureAtAltitude ?? forecastWeather.temperatureAtAltitude;
                const windAtH = nearestHW && altWindSource ? altWindSource.find(w => w.height === nearestHW) : null;
                const tempAtH = nearestHW && altTempSource ? altTempSource.find(t => t.height === nearestHW) : null;
                const displayWind = windAtH ? windAtH.speed : (forecastWeather.windSpeed ?? 0);
                const displayWindLabel = windAtH ? `Wind ${nearestHW}m` : "Wind 10m";
                const displayTemp = tempAtH ? tempAtH.value : (forecastWeather.temperature ?? 0);
                const displayTempLabel = tempAtH ? `Temp ${nearestHW}m` : "Temperatur";
                const windLimit = drone?.limits?.maxWind ?? 12;
                const windColor = displayWind > windLimit ? theme.statusNoGo : displayWind > windLimit * 0.75 ? theme.statusCaution : theme.textSecondary;

                return (
                  <View style={styles.weatherGrid}>
                    <View style={styles.weatherItem}>
                      <Feather name="thermometer" size={18} color={theme.textSecondary} />
                      <ThemedText style={styles.weatherValue}>
                        {displayTemp.toFixed(1)}°C
                      </ThemedText>
                      <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                        {displayTempLabel}
                      </ThemedText>
                    </View>
                    <View style={styles.weatherItem}>
                      <Feather name="wind" size={18} color={windColor} />
                      <ThemedText style={[styles.weatherValue, displayWind > windLimit ? { color: theme.statusNoGo } : displayWind > windLimit * 0.75 ? { color: theme.statusCaution } : undefined]}>
                        {displayWind.toFixed(1)} m/s
                      </ThemedText>
                      <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                        {displayWindLabel}
                      </ThemedText>
                      {windAtH ? (
                        <ThemedText style={[styles.weatherLabelSub, { color: theme.textTertiary }]}>
                          Boden: {(forecastWeather.windSpeed ?? 0).toFixed(1)} m/s
                        </ThemedText>
                      ) : null}
                    </View>
                    <View style={styles.weatherItem}>
                      <Feather name="cloud-rain" size={18} color={theme.textSecondary} />
                      <ThemedText style={styles.weatherValue}>
                        {forecastWeather.rain?.toFixed(1)} mm
                      </ThemedText>
                      <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                        Regen
                      </ThemedText>
                    </View>
                    <View style={styles.weatherItem}>
                      <Feather name="cloud" size={18} color={theme.textSecondary} />
                      <ThemedText style={styles.weatherValue}>
                        {forecastWeather.cloudCover?.toFixed(0)}%
                      </ThemedText>
                      <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                        Wolken
                      </ThemedText>
                    </View>
                    <View style={styles.weatherItem}>
                      <Feather name="droplet" size={18} color={theme.textSecondary} />
                      <ThemedText style={styles.weatherValue}>
                        {forecastWeather.humidity?.toFixed(0)}%
                      </ThemedText>
                      <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                        Feuchte
                      </ThemedText>
                    </View>
                    {forecastWeather.windGust != null && forecastWeather.windGust > 0 ? (
                      <View style={styles.weatherItem}>
                        <Feather name="zap" size={18} color={forecastWeather.windGust > (drone?.limits?.maxGusts ?? 15) ? theme.statusNoGo : theme.textSecondary} />
                        <ThemedText style={[styles.weatherValue, forecastWeather.windGust > (drone?.limits?.maxGusts ?? 15) ? { color: theme.statusNoGo } : undefined]}>
                          {forecastWeather.windGust.toFixed(1)} m/s
                        </ThemedText>
                        <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                          Böen
                        </ThemedText>
                      </View>
                    ) : null}
                  </View>
                );
              })()}
            </>
          ) : (
            <View style={styles.weatherLoadingContainer}>
              <Feather name="cloud" size={24} color={theme.textTertiary} />
              <ThemedText style={[styles.weatherLoadingText, { color: theme.textTertiary }]}>
                Wetter wird geladen...
              </ThemedText>
            </View>
          )}
        </Card>

        {kpData ? (
          <Card style={styles.kpCard}>
            <View style={styles.kpRow}>
              <View style={styles.kpLeft}>
                <Feather name="activity" size={22} color={kpData.color} />
                <View style={styles.kpValueContainer}>
                  <ThemedText style={[styles.kpValue, { color: kpData.color }]}>
                    Kp {kpData.value.toFixed(1)}
                  </ThemedText>
                  <ThemedText style={[styles.kpLevel, { color: theme.textSecondary }]}>
                    {getKpLabel(kpData.value)}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.kpRight}>
                <ThemedText style={[styles.kpDescription, { color: theme.textSecondary }]}>
                  {kpData.description}
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : null}

        {hourlySlots.length > 0 ? (
          <Card style={styles.hourlyCard}>
            <View style={styles.weatherHeader}>
              <View>
                <ThemedText style={styles.weatherTitle}>Stundenweise Prognose</ThemedText>
                <ThemedText style={[styles.weatherSourceLabel, { color: theme.textTertiary }]}>
                  {plannedTime} - {endTime} Uhr
                  {hourlySource ? ` | ${hourlySource === "dipul" ? "DFS dipul" : "DWD BrightSky"}` : ""}
                </ThemedText>
              </View>
            </View>

            <View style={styles.hourlyTableContainer}>
              <View style={styles.hourlyLabelsCol}>
                <View style={[styles.hourlyHeaderRow, { borderBottomColor: theme.border }]}>
                  <ThemedText style={[styles.hourlyHeaderCell, styles.hourlyLabelCol, { color: theme.textTertiary }]}>{""}</ThemedText>
                </View>
                {hourlySolarIcons.length > 0 ? (() => {
                  const nowSolar = calculateSolarTimes(latitude, longitude, new Date());
                  const fmt = (d: Date | null) => d ? d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0") : "--:--";
                  return (
                    <View style={[styles.hourlyLabelRow, { borderBottomWidth: 1, borderBottomColor: theme.border, paddingVertical: 3 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 4, gap: 3 }}>
                        <Feather name="sun" size={11} color="#FFB820" />
                        <ThemedText style={[styles.hourlyCell, styles.hourlyLabelCol, { color: theme.textSecondary, fontWeight: "600" }]}>Tag/Nacht</ThemedText>
                      </View>
                      <ThemedText style={{ fontSize: 9, color: theme.textTertiary, paddingLeft: 18 }} numberOfLines={1}>
                        {"\u2197"}{fmt(nowSolar.sunrise)} {"\u2198"}{fmt(nowSolar.sunset)}
                      </ThemedText>
                    </View>
                  );
                })() : null}
                {hourlyRowConfigs.map((row) => (
                  <View key={row.label} style={styles.hourlyLabelRow}>
                    <ThemedText style={[styles.hourlyCell, styles.hourlyLabelCol, { color: theme.textSecondary, fontWeight: "600" }]}>{row.label}</ThemedText>
                  </View>
                ))}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourlyScrollView}>
                <View>
                  <View style={[styles.hourlyHeaderRow, { borderBottomColor: theme.border }]}>
                    {hourlySlots.map((slot) => (
                      <ThemedText key={slot.hour} style={[styles.hourlyHeaderCell, styles.hourlyValCol, { color: theme.text, fontWeight: "700" }]}>{slot.hour}</ThemedText>
                    ))}
                  </View>
                  {hourlySolarIcons.length > 0 ? (
                    <View style={[styles.hourlyDataRow, { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                      {hourlySolarIcons.map((s, i) => (
                        <View key={i} style={[styles.hourlyValCol, { height: 34, justifyContent: "center", alignItems: "center", backgroundColor: s.bg }]}>
                          <Feather name={s.icon} size={14} color={s.color} />
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {hourlyRowConfigs.map((row) => (
                    <React.Fragment key={row.label}>
                      {renderHourlyRowValues(row.values, row.levels)}
                    </React.Fragment>
                  ))}
                </View>
              </ScrollView>
            </View>

            <View style={[styles.hourlyLegend, { borderTopColor: theme.border }]}>
              <ThemedText style={[styles.hourlyLegendText, { color: theme.textTertiary }]}>
                Wind in m/s | Regen in mm/h | QNH in hPa
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {isFpvOnlyDrone ? (
          <Card style={styles.fpvCard}>
            <View style={styles.fpvRow}>
              <View style={styles.fpvInfo}>
                <View style={styles.fpvHeader}>
                  <Feather name="eye" size={20} color={theme.primary} />
                  <ThemedText style={styles.fpvTitle}>FPV-Flug</ThemedText>
                </View>
                <ThemedText style={[styles.fpvSubtitle, { color: theme.textSecondary }]}>
                  Diese Drohne erfordert immer FPV
                </ThemedText>
              </View>
              <View style={[styles.fpvToggle, { backgroundColor: theme.primary }]}>
                <View style={[styles.fpvToggleKnob, styles.fpvToggleKnobActive]} />
              </View>
            </View>
            <View style={[styles.fpvWarning, { backgroundColor: theme.statusCautionBackground }]}>
              <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
              <ThemedText style={[styles.fpvWarningText, { color: theme.statusCaution }]}>
                Bei FPV-Flügen ist ein Spotter erforderlich!
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {weatherWarnings.length > 0 ? (
          <Card style={[styles.warningsCard, { borderColor: weatherWarnings.some(w => w.severity === "warning") ? theme.statusNoGo : theme.statusCaution }]}>
            <View style={styles.warningsHeader}>
              <Feather 
                name="alert-triangle" 
                size={20} 
                color={weatherWarnings.some(w => w.severity === "warning") ? theme.statusNoGo : theme.statusCaution} 
              />
              <ThemedText style={[styles.warningsTitle, { 
                color: weatherWarnings.some(w => w.severity === "warning") ? theme.statusNoGo : theme.statusCaution 
              }]}>
                {weatherWarnings.some(w => w.severity === "warning") ? "Wetterwarnung" : "Hinweise"}
              </ThemedText>
            </View>
            {weatherWarnings.map((warning, index) => (
              <View 
                key={index} 
                style={[
                  styles.warningItem, 
                  { backgroundColor: warning.severity === "warning" ? theme.statusNoGoBackground : theme.statusCautionBackground }
                ]}
              >
                <ThemedText style={[styles.warningText, { 
                  color: warning.severity === "warning" ? theme.statusNoGo : theme.statusCaution 
                }]}>
                  {warning.message}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        <View style={styles.quickActionsRow}>
          <Pressable
            onPress={() => navigation.navigate("PlanningNotams", { latitude, longitude, locationName, plannedDate, plannedTime, radiusKm, routeWaypoints })}
            style={({ pressed }) => [styles.quickActionBtn, { backgroundColor: theme.backgroundSecondary, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: theme.statusCautionBackground }]}>
              <Feather name="alert-circle" size={20} color={theme.statusCaution} />
            </View>
            <ThemedText style={styles.quickActionTitle}>NOTAMs</ThemedText>
            <ThemedText style={[styles.quickActionSub, { color: theme.textTertiary }]}>Standortbezogen</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("PlanningLiveTraffic", { latitude, longitude, locationName, countryIso })}
            style={({ pressed }) => [styles.quickActionBtn, { backgroundColor: theme.backgroundSecondary, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.quickActionIcon, { backgroundColor: theme.primary + "20" }]}>
              <Feather name="navigation" size={20} color={theme.primary} />
            </View>
            <ThemedText style={styles.quickActionTitle}>Flugverkehr</ThemedText>
            <ThemedText style={[styles.quickActionSub, { color: theme.textTertiary }]}>Live-Daten</ThemedText>
          </Pressable>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Weiter zur Checkliste"
          onPress={handleContinue}
          disabled={!isValidDateTime()}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.xl,
  },
  title: {
    ...Typography.h2,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.body,
  },
  locationInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  locationText: {
    ...Typography.body,
  },
  droneInfoCard: {
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  droneInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  droneInfoName: {
    ...Typography.body,
    fontWeight: "600",
    flex: 1,
  },
  droneClassBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  droneClassText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  droneTypeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  droneTypeText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  inputCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  altitudeCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  altitudeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  altitudeIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  altitudeTitle: {
    ...Typography.callout,
    fontWeight: "700",
  },
  altitudeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  altitudeBadgeText: {
    ...Typography.caption,
    fontWeight: "700",
  },
  altitudeInputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  altitudeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
  },
  altitudeChipText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  altitudeCustomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  altitudeCustomLabel: {
    ...Typography.caption,
  },
  altitudeInput: {
    ...Typography.body,
    fontWeight: "600",
    width: 64,
    textAlign: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
  },
  altitudeUnit: {
    ...Typography.caption,
  },
  altitudeWarningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
  },
  altitudeWarningText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
    lineHeight: 18,
  },
  flightTimeSummary: {
    gap: Spacing.sm,
  },
  flightTimeSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  flightTimeSummaryText: {
    ...Typography.body,
    fontWeight: "500",
  },
  forecastCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderWidth: 2,
    marginBottom: Spacing.lg,
  },
  forecastIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  forecastContent: {
    flex: 1,
  },
  forecastTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  forecastSubtitle: {
    ...Typography.small,
    marginTop: 2,
  },
  weatherTooFarContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  weatherTooFarTitle: {
    ...Typography.callout,
    fontWeight: "700",
    marginTop: Spacing.xs,
  },
  weatherTooFarText: {
    ...Typography.body,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: Spacing.md,
  },
  weatherTooFarBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
  },
  weatherTooFarBannerText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
    lineHeight: 18,
  },
  weatherCard: {
    padding: Spacing.lg,
  },
  kpCard: {
    padding: Spacing.lg,
  },
  kpRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kpLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  kpValueContainer: {
    gap: 2,
  },
  kpValue: {
    ...Typography.h4,
    fontWeight: "700",
  },
  kpLevel: {
    ...Typography.caption,
    fontWeight: "500",
  },
  kpRight: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  kpDescription: {
    ...Typography.caption,
    textAlign: "right",
  },
  weatherHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  weatherTitle: {
    ...Typography.h4,
  },
  weatherSourceLabel: {
    ...Typography.caption,
    fontSize: 10,
    marginTop: 2,
  },
  weatherLoadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
    minHeight: 120,
  },
  weatherLoadingText: {
    ...Typography.body,
  },
  weatherGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
  },
  weatherItem: {
    width: "45%",
    alignItems: "center",
    padding: Spacing.md,
  },
  weatherValue: {
    ...Typography.h3,
    marginTop: Spacing.xs,
  },
  weatherLabel: {
    ...Typography.caption,
  },
  weatherLabelSub: {
    fontSize: 10,
    marginTop: 2,
  },
  fpvCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  fpvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fpvInfo: {
    flex: 1,
  },
  fpvHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  fpvTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  fpvSubtitle: {
    ...Typography.small,
  },
  fpvToggle: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#DDD",
    padding: 2,
    justifyContent: "center",
  },
  fpvToggleKnob: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FFF",
  },
  fpvToggleKnobActive: {
    alignSelf: "flex-end",
  },
  fpvWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: 6,
  },
  fpvWarningText: {
    ...Typography.caption,
    fontWeight: "500",
    flex: 1,
  },
  warningsCard: {
    padding: Spacing.lg,
    marginTop: Spacing.lg,
    borderWidth: 2,
  },
  warningsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  warningsTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  warningItem: {
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.xs,
  },
  warningText: {
    ...Typography.small,
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  quickActionBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  quickActionTitle: {
    ...Typography.small,
    fontWeight: "600",
  },
  quickActionSub: {
    ...Typography.caption,
    fontSize: 10,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  hourlyCard: {
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  hourlyTableContainer: {
    flexDirection: "row",
    marginTop: Spacing.sm,
  },
  hourlyLabelsCol: {
    zIndex: 1,
  },
  hourlyLabelRow: {
    paddingVertical: 5,
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  hourlyScrollView: {
    flex: 1,
  },
  hourlyHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingBottom: Spacing.xs,
    marginBottom: 2,
  },
  hourlyHeaderCell: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  hourlyLabelCol: {
    width: 86,
    textAlign: "left",
    paddingLeft: 4,
  },
  hourlyValCol: {
    width: 52,
    textAlign: "center",
  },
  hourlyDataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  hourlyCell: {
    fontSize: 12,
    textAlign: "center",
  },
  hourlyLegend: {
    borderTopWidth: 1,
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  hourlyLegendText: {
    fontSize: 9,
    textAlign: "center",
  },
});
