import React, { useState, useEffect, useCallback, useMemo } from "react";
import { beaufortLevel, droneWindVerdict, droneWindVerdictText, warnThresholdMs, WIND_WARN_FRACTION } from "@/lib/beaufort";
import { View, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import KpLocalSignalCheckModal from "@/components/KpLocalSignalCheckModal";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useShowDataSources } from "@/lib/dataSource";
import { Spacing, Typography, Colors } from "@/constants/theme";
import {
  fetchWeather,
  WeatherData,
  WeatherFetchError,
  ForecastData,
  fetchHourlyForecasts,
  HourlyForecastSlot,
  peekCachedWeather,
  peekCachedHourly,
  todayHourlyWindow,
} from "@/lib/weather";
import { DataStandLines } from "@/components/DataStandLines";
import { isOfflineNow } from "@/lib/network";
import { bringOnlineHint } from "../../shared/offlineDataPolicy";
import HourlyForecastTable from "@/components/HourlyForecastTable";
import {
  fetchKpIndex,
  fetchKpTimeline,
  getKpAssessment,
  getKpForHour,
  getKpLabel,
  getKpRiskLabel,
  KpIndexData,
} from "@/lib/kpindex";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { calculateSolarTimes, formatSolarTime, getDaylightPhase, isTimeDuringDaylight, isTimeDuringCivilTwilight, SolarTimes } from "@/lib/solar";
import SunArcChart from "@/components/SunArcChart";
import { getSettings, Settings, getDrone, DroneProfile, WeatherLimits, DEFAULT_LIMITS, getFlightSession } from "@/lib/storage";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";

type RouteParams = RouteProp<FlightCheckParamList, "Weather">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "Weather">;

export default function WeatherScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const isAdmin = useShowDataSources();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedDrone, setSelectedDrone] = useState<DroneProfile | null>(null);
  const [limits, setLimits] = useState<WeatherLimits>(DEFAULT_LIMITS);
  const [isFpvFlight, setIsFpvFlight] = useState(false);
  const [altitudeExpanded, setAltitudeExpanded] = useState(true);
  const [kpData, setKpData] = useState<KpIndexData | null>(null);
  const [kpForecastForFlight, setKpForecastForFlight] = useState<number | null>(null);
  const [kpLocalSignalCheckVisible, setKpLocalSignalCheckVisible] = useState(false);
  const [solarTimes, setSolarTimes] = useState<SolarTimes | null>(null);
  const [maxAltitude, setMaxAltitude] = useState<number | null>(null);
  const [hourlySlots, setHourlySlots] = useState<HourlyForecastSlot[]>([]);
  const [hourlySource, setHourlySource] = useState<"dipul" | "brightsky" | "openmeteo" | null>(null);
  const [hourlyHighlight, setHourlyHighlight] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    return { start, end: new Date(start.getTime() + 3600000) };
  });

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, restrictionVerdict, droneId, sessionId } = route.params;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { start, end } = todayHourlyWindow();
      // Gespeicherten Stand (Vorab-Laden beim App-Start) sofort zeigen …
      const cached = await peekCachedHourly(latitude, longitude, start, end).catch(() => null);
      if (cancelled) return;
      if (cached && cached.slots.length > 0) {
        setHourlySlots(cached.slots);
        setHourlySource(cached.source);
      }
      // … und im Hintergrund aktualisieren (frisch < 10 min: ohne Netzabruf)
      try {
        const result = await fetchHourlyForecasts(latitude, longitude, start, end);
        if (cancelled) return;
        if (result.slots.length > 0 || !cached) {
          setHourlySlots(result.slots);
          setHourlySource(result.source);
        }
      } catch {
        if (cancelled || cached) return;
        setHourlySlots([]);
        setHourlySource(null);
      }
    })();
    return () => { cancelled = true; };
  }, [latitude, longitude, droneId]);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const s = new Date(now);
      s.setMinutes(0, 0, 0);
      setHourlyHighlight((prev) => (prev.start.getTime() === s.getTime() ? prev : { start: s, end: new Date(s.getTime() + 3600000) }));
    };
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  const altHeights = useMemo(() => {
    if (!weather) return [];
    const c = weather.forecasts[0];
    const windH = (c.windAtAltitude || []).map((w) => w.height);
    const tempH = (c.temperatureAtAltitude || []).map((t) => t.height);
    const humH = (c.humidityAtAltitude || []).map((h) => h.height);
    const cloudH = (c.cloudCoverAtAltitude || []).map((cl) => cl.height);
    const all = Array.from(new Set([...windH, ...tempH, ...humH, ...cloudH])).sort((a, b) => a - b);
    if (maxAltitude == null || maxAltitude <= 0) {
      return all.slice().sort((a, b) => b - a);
    }
    const ceiling = all.find((h) => h >= maxAltitude) ?? all[all.length - 1];
    return all.filter((h) => h <= ceiling).sort((a, b) => b - a);
  }, [weather, maxAltitude]);

  const weatherRef = React.useRef<WeatherData | null>(null);
  weatherRef.current = weather;

  const loadData = useCallback(async (force: boolean = false) => {
    setError(null);
    setKpForecastForFlight(null);
    if (!weatherRef.current) setLoading(true);
    let shown = !!weatherRef.current;
    try {
      // Lokale Daten parallel (schnell, kein Netz)
      const [session, settingsData, drone] = await Promise.all([
        sessionId ? getFlightSession(sessionId) : Promise.resolve(null),
        getSettings(),
        droneId ? getDrone(droneId) : Promise.resolve(null),
      ]);
      const flightDuration = session?.planning?.estimatedDuration;

      setSettings(settingsData);
      setSelectedDrone(drone);
      setSolarTimes(calculateSolarTimes(latitude, longitude));
      if (session?.planning?.maxAltitude != null && session.planning.maxAltitude > 0) {
        setMaxAltitude(session.planning.maxAltitude);
      }
      if (session?.planning?.isFpvFlight) {
        setIsFpvFlight(true);
      } else if (drone?.droneType === "fpv_only") {
        setIsFpvFlight(true);
      }
      setLimits(drone ? drone.limits : settingsData.limits);

      // Kp unabhängig vom Wetter nachladen (blockiert die Anzeige nicht)
      const plannedDateTime = session?.planning?.plannedDate && session?.planning?.plannedTime
        ? new Date(`${session.planning.plannedDate}T${session.planning.plannedTime}`)
        : new Date();
      void Promise.all([fetchKpIndex().catch(() => null), fetchKpTimeline().catch(() => [])]).then(([kpResult, kpTimeline]) => {
        setKpForecastForFlight(getKpForHour(kpTimeline, plannedDateTime, 3 * 60 * 60 * 1000));
        if (kpResult) setKpData(kpResult);
      });

      // Gespeicherten Stand (≤ 24 h, z. B. vom Vorab-Laden) sofort zeigen
      if (!shown && !force) {
        const cached = await peekCachedWeather(latitude, longitude, flightDuration).catch(() => null);
        if (cached) {
          setWeather(cached);
          setLoading(false);
          shown = true;
        }
      }

      // Aktualisieren (frischer Stand < 10 min wird ohne Netzabruf geliefert)
      const weatherData = await fetchWeather(latitude, longitude, flightDuration, force ? { maxAgeMs: 0 } : undefined);
      setWeather(weatherData);
    } catch (err) {
      console.error("Weather fetch error:", err);
      if (shown) {
        // gespeicherter Stand bleibt sichtbar (Stand-Zeile zeigt das Alter)
      } else if (isOfflineNow()) {
        // Teil A: kein gespeicherter Stand < 24 h
        setError(`${bringOnlineHint("weather")} – keine gespeicherte Vorhersage jünger als 24 h.`);
      } else if (err instanceof WeatherFetchError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(`Verbindungsfehler: ${err.message}`);
      } else {
        setError("Wetterdaten konnten nicht geladen werden. Bitte prüfen Sie Ihre Internetverbindung.");
      }
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude, droneId, sessionId]);

  useEffect(() => {
    loadData();
    // Solange die Ansicht offen ist, regelmäßig im Hintergrund aktualisieren
    const id = setInterval(() => { loadData(); }, 15 * 60_000);
    return () => clearInterval(id);
  }, [loadData]);

  const handleOpenNdFilter = () => {
    if (!weather) return;
    const current = weather.forecasts[0];
    const rootNav = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
    if (!rootNav) return;
    rootNav.navigate("Main", {
      screen: "NdFilterTab",
      params: {
        screen: "NdFilterFinder",
        params: {
          latitude,
          longitude,
          cloudCoverPercent: current.cloudCover,
          rainMmPerH: current.rain,
          droneId: droneId,
        },
      },
    } as any);
  };

  const handleContinue = () => {
    if (!weather) return;
    
    if (selectedDrone?.droneType === "hybrid_fpv") {
      navigation.navigate("FpvSelect", {
        latitude,
        longitude,
        hasRestrictions,
        restrictionStatus,
        restrictionNotes,
        restrictionVerdict,
        weatherData: weather,
        droneId: droneId,
        limits: limits,
        sessionId,
        kpIndex: kpData?.value,
        kpOfflineFetchedAt: kpData?.offline?.fetchedAt,
      });
    } else {
      navigation.navigate("Checklist", {
        latitude,
        longitude,
        hasRestrictions,
        restrictionStatus,
        restrictionNotes,
        restrictionVerdict,
        weatherData: weather,
        droneId: droneId,
        limits: limits,
        sessionId,
        isFpvFlight,
        kpIndex: kpData?.value,
        kpOfflineFetchedAt: kpData?.offline?.fetchedAt,
      });
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };

  const getWindUnit = () => settings?.windUnit || "m/s";
  const getTempUnit = () => (settings?.tempUnit === "F" ? "°F" : "°C");

  const convertWind = (value: number) => {
    if (settings?.windUnit === "km/h") {
      return (value * 3.6).toFixed(1);
    }
    return value.toFixed(1);
  };

  const convertTemp = (value: number) => {
    if (settings?.tempUnit === "F") {
      return ((value * 9) / 5 + 32).toFixed(1);
    }
    return value.toFixed(1);
  };

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            Lade Wetterdaten...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !weather) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.errorContainer, { paddingTop: headerHeight }]}>
          <Feather name="cloud-off" size={48} color={theme.textTertiary} />
          <ThemedText style={styles.errorTitle}>Fehler</ThemedText>
          <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
            {error || "Wetterdaten nicht verfügbar."}
          </ThemedText>
          <Button title="Erneut versuchen" onPress={() => { loadData(true); }} style={{ marginTop: Spacing.xl }} />
        </View>
      </ThemedView>
    );
  }

  const timeToPercent = (date: Date): number => {
    const h = date.getHours() + date.getMinutes() / 60;
    return Math.max(0, Math.min(100, (h / 24) * 100));
  };

  const current = weather.forecasts[0];

  const getValAtHeight = (items: { height: number; value: number }[], h: number) => {
    const found = items.find((i) => i.height === h);
    return found ? found.value : null;
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
        ]}
      >
        <DataStandLines
          testID="weather-data-stand"
          entries={[
            { kind: "weather", origin: weather.offline ?? null },
            { kind: "kp", origin: kpData?.offline ?? null },
          ]}
          onRefresh={weather.offline || kpData?.offline ? () => { loadData(true); } : undefined}
        />
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          AKTUELL (BODEN)
        </ThemedText>
        <Card style={styles.currentCard}>
          <View style={styles.currentGrid}>
            <View style={styles.currentItem}>
              <Feather name="cloud-rain" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.rain.toFixed(1)} mm
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Regen
              </ThemedText>
            </View>
            <View style={styles.currentItem}>
              <Feather name="cloud-snow" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.snow.toFixed(1)} mm
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Schnee
              </ThemedText>
            </View>
            <View style={styles.currentItem}>
              <Feather name="bar-chart-2" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.pressure > 0 ? (current.pressure / 100).toFixed(0) : "-"} hPa
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                QNH
              </ThemedText>
            </View>
          </View>
          {(() => {
            const sorted = altHeights.slice().sort((a, b) => a - b);
            const h = maxAltitude != null && maxAltitude > 0
              ? sorted.find((x) => x >= maxAltitude) ?? sorted[sorted.length - 1]
              : sorted[0];
            const w = current.windAtAltitude.find((x) => x.height === h);
            if (!w) return null;
            const level = beaufortLevel(w.speed);
            const verdict = droneWindVerdict(w.speed, limits.maxWind);
            const color = verdict === "over" ? theme.statusNoGo : verdict === "caution" ? theme.statusCaution : theme.statusGo;
            return (
              <View style={[styles.beaufortStrip, { borderColor: color, backgroundColor: color + "14" }]} testID="weather-beaufort">
                <View style={[styles.beaufortBadge, { backgroundColor: color }]}>
                  <ThemedText style={styles.beaufortBadgeText}>Bft {level.bft}</ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.beaufortTitle}>
                    {level.name} in {h} m: {convertWind(w.speed)} {getWindUnit()} – {droneWindVerdictText(verdict)}
                  </ThemedText>
                  <ThemedText style={[styles.beaufortSign, { color: theme.textSecondary }]}>
                    {level.sign}. Warnung ab {convertWind(warnThresholdMs(limits.maxWind))} {getWindUnit()} ({Math.round(WIND_WARN_FRACTION * 100)} % von {convertWind(limits.maxWind)}).
                  </ThemedText>
                </View>
              </View>
            );
          })()}
          <ThemedText style={[styles.currentHint, { color: theme.textTertiary }]}>
            Wind, Temperatur, Böen und Wolken siehe Höhenprofil unten.
          </ThemedText>
        </Card>

        {solarTimes ? (
          <>
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
              TAG / NACHT
            </ThemedText>
            <Card style={styles.solarCard}>
              <View style={styles.solarPhaseRow}>
                <View style={[styles.solarPhaseBadge, {
                  backgroundColor: solarTimes.isDayNow ? "#FFB82020" : solarTimes.isCivilTwilightNow ? "#FF8C0020" : "#3B4F7420",
                }]}>
                  <Feather
                    name={solarTimes.isDayNow ? "sun" : solarTimes.isCivilTwilightNow ? "sunset" : "moon"}
                    size={16}
                    color={solarTimes.isDayNow ? "#FFB820" : solarTimes.isCivilTwilightNow ? "#FF8C00" : "#6B7FA0"}
                  />
                  <ThemedText style={[styles.solarPhaseText, {
                    color: solarTimes.isDayNow ? "#FFB820" : solarTimes.isCivilTwilightNow ? "#FF8C00" : "#6B7FA0",
                  }]}>
                    {getDaylightPhase(solarTimes).label}
                  </ThemedText>
                </View>
                {solarTimes.dayLengthMinutes != null ? (
                  <ThemedText style={[styles.solarDayLength, { color: theme.textSecondary }]}>
                    {Math.floor(solarTimes.dayLengthMinutes / 60)}h {solarTimes.dayLengthMinutes % 60}min Tageslicht
                  </ThemedText>
                ) : null}
              </View>

              <View style={styles.solarArcWrap}>
                <ThemedText style={[styles.solarArcTitle, { color: theme.textSecondary }]}>
                  TAGESGANG SONNENSTAND
                </ThemedText>
                <SunArcChart lat={latitude} lon={longitude} height={220} />
              </View>

              <View style={styles.solarTimesGrid}>
                <View style={styles.solarTimeItem}>
                  <Feather name="sunrise" size={18} color="#FF8C00" />
                  <View>
                    <ThemedText style={[styles.solarTimeLabel, { color: theme.textSecondary }]}>Dämmerung</ThemedText>
                    <ThemedText style={styles.solarTimeValue}>{formatSolarTime(solarTimes.civilDawnStart)}</ThemedText>
                  </View>
                </View>
                <View style={styles.solarTimeItem}>
                  <Feather name="sun" size={18} color="#FFB820" />
                  <View>
                    <ThemedText style={[styles.solarTimeLabel, { color: theme.textSecondary }]}>Sonnenaufgang</ThemedText>
                    <ThemedText style={styles.solarTimeValue}>{formatSolarTime(solarTimes.sunrise)}</ThemedText>
                  </View>
                </View>
                <View style={styles.solarTimeItem}>
                  <Feather name="sunset" size={18} color="#FF8C00" />
                  <View>
                    <ThemedText style={[styles.solarTimeLabel, { color: theme.textSecondary }]}>Sonnenuntergang</ThemedText>
                    <ThemedText style={styles.solarTimeValue}>{formatSolarTime(solarTimes.sunset)}</ThemedText>
                  </View>
                </View>
                <View style={styles.solarTimeItem}>
                  <Feather name="moon" size={18} color="#6B7FA0" />
                  <View>
                    <ThemedText style={[styles.solarTimeLabel, { color: theme.textSecondary }]}>Nacht ab</ThemedText>
                    <ThemedText style={styles.solarTimeValue}>{formatSolarTime(solarTimes.civilDuskEnd)}</ThemedText>
                  </View>
                </View>
              </View>

              <View style={[styles.solarHint, { backgroundColor: theme.backgroundSecondary }]}>
                <Feather name="info" size={13} color={theme.textTertiary} />
                <ThemedText style={[styles.solarHintText, { color: theme.textTertiary }]}>
                  OPEN-Kategorie: Flugbetrieb nur bei ausreichenden Sichtverhältnissen. Bürgerliche Dämmerung mit Beleuchtung möglich.
                </ThemedText>
              </View>
            </Card>
          </>
        ) : null}

        {kpData ? (
          <>
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
              GEOMAGNETISCHE AKTIVITÄT
            </ThemedText>
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
                <View style={[styles.kpBadge, { backgroundColor: kpData.color + "20" }]}>
                  <View style={[styles.kpDot, { backgroundColor: kpData.color }]} />
                  <ThemedText style={[styles.kpBadgeText, { color: kpData.color }]}>
                    {getKpRiskLabel(kpData.value)}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={[styles.kpDescription, { color: theme.textSecondary }]}>
                {kpData.description}
              </ThemedText>
            </Card>
          </>
        ) : null}

        {kpForecastForFlight != null && kpForecastForFlight >= 5 ? (
          <Card
            style={[
              styles.kpCard,
              {
                marginTop: Spacing.md,
                borderWidth: 1,
                borderColor: getKpAssessment(kpForecastForFlight).color,
              },
            ]}
          >
            <View style={styles.kpLeft}>
              <Feather
                name="activity"
                size={20}
                color={getKpAssessment(kpForecastForFlight).color}
              />
              <View style={styles.kpValueContainer}>
                <ThemedText style={[styles.kpValue, { color: getKpAssessment(kpForecastForFlight).color }]}>
                  Kp {kpForecastForFlight.toFixed(1)} vorhergesagt
                </ThemedText>
                <ThemedText style={[styles.kpLevel, { color: theme.textSecondary }]}>
                  Für den geplanten Flugzeitpunkt
                </ThemedText>
              </View>
            </View>
            <ThemedText style={[styles.kpDescription, { color: theme.textSecondary }]}>
              GNSS- und Kompassstörungen können auftreten, müssen am Startplatz aber nicht.
              Prüfe auf Wunsch die aktuellen Messwerte deines Smartphones.
            </ThemedText>
            <Pressable
              onPress={() => setKpLocalSignalCheckVisible(true)}
              accessibilityRole="button"
              testID="button-kp-local-signal-check"
              style={[
                styles.kpCheckButton,
                { backgroundColor: getKpAssessment(kpForecastForFlight).color },
              ]}
            >
              <Feather name="crosshair" size={17} color={theme.buttonText} />
              <ThemedText style={[styles.kpCheckButtonText, { color: theme.buttonText }]}>
                Vor-Ort-Signalcheck öffnen
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        <Pressable
          onPress={() => setAltitudeExpanded(!altitudeExpanded)}
          testID="toggle-altitude-profile"
        >
          <View style={[styles.sectionHeader, { marginTop: Spacing["2xl"] }]}>
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginBottom: 0 }]}>
              HÖHENPROFIL (AGL)
            </ThemedText>
            <Feather
              name={altitudeExpanded ? "chevron-up" : "chevron-down"}
              size={18}
              color={theme.textSecondary}
            />
          </View>
        </Pressable>

        {altitudeExpanded ? (
          <Card style={styles.altitudeCard}>
            <View style={styles.altHeaderRow}>
              <View style={styles.altHeightCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textTertiary }]}>AGL</ThemedText>
              </View>
              <View style={styles.altDataCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textSecondary }]}>Wind</ThemedText>
              </View>
              <View style={styles.altDataCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textSecondary }]}>Böen</ThemedText>
              </View>
              <View style={styles.altDataCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textSecondary }]}>Temp.</ThemedText>
              </View>
              <View style={styles.altDataCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textSecondary }]}>Feucht.</ThemedText>
              </View>
              <View style={styles.altDataCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textSecondary }]}>Wolken</ThemedText>
              </View>
              <View style={styles.altDataCol}>
                <ThemedText style={[styles.altColHeader, { color: theme.textSecondary }]}>Richt.</ThemedText>
              </View>
            </View>
            {(() => {
              const plannedRow = maxAltitude != null && maxAltitude > 0
                ? altHeights.slice().sort((a, b) => a - b).find((x) => x >= maxAltitude) ?? null
                : null;
              return altHeights.map((h, idx) => {
              const wind = current.windAtAltitude.find((w) => w.height === h);
              const temp = getValAtHeight(current.temperatureAtAltitude, h);
              const hum = getValAtHeight(current.humidityAtAltitude, h);
              const cloud = getValAtHeight(current.cloudCoverAtAltitude, h);
              const highlight = plannedRow != null && h === plannedRow;
              return (
                <View key={h} style={[styles.altDataRow, idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : undefined, highlight ? { backgroundColor: theme.primary + "12" } : undefined]}>
                  <View style={styles.altHeightCol}>
                    <ThemedText style={[styles.altHeightLabel, { color: theme.primary, fontWeight: highlight ? "800" : "600" }]}>{h}m{highlight ? " ✈" : ""}</ThemedText>
                  </View>
                  <View style={styles.altDataCol}>
                    <ThemedText style={styles.altVal}>{wind ? `${convertWind(wind.speed)}` : "-"}</ThemedText>
                  </View>
                  <View style={styles.altDataCol}>
                    <ThemedText style={styles.altVal}>{wind?.gust != null ? convertWind(wind.gust) : "-"}</ThemedText>
                  </View>
                  <View style={styles.altDataCol}>
                    <ThemedText style={styles.altVal}>{temp != null ? `${convertTemp(temp)}°` : "-"}</ThemedText>
                  </View>
                  <View style={styles.altDataCol}>
                    <ThemedText style={styles.altVal}>{hum != null ? `${hum.toFixed(0)}%` : "-"}</ThemedText>
                  </View>
                  <View style={styles.altDataCol}>
                    <ThemedText style={styles.altVal}>{cloud != null ? `${cloud.toFixed(0)}%` : "-"}</ThemedText>
                  </View>
                  <View style={styles.altDataCol}>
                    <ThemedText style={styles.altVal}>{wind ? `${wind.direction.toFixed(0)}°` : "-"}</ThemedText>
                  </View>
                </View>
              );
            });
            })()}
          </Card>
        ) : null}

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          24-STUNDEN-VORHERSAGE
        </ThemedText>
        <Card style={styles.forecastTableCard}>
          <View style={styles.forecastTable}>
            <View style={styles.forecastLabelCol}>
              <View style={styles.forecastLabelCell}>
                <ThemedText style={[styles.forecastLabelText, { color: theme.textSecondary }]}> </ThemedText>
              </View>
              {[
                { icon: "thermometer" as const, label: "Temp." },
                { icon: "wind" as const, label: "Wind" },
                { icon: "zap" as const, label: "Böen" },
                { icon: "cloud-rain" as const, label: "Regen" },
                { icon: "cloud" as const, label: "Wolken" },
              ].map((row) => (
                <View key={row.label} style={[styles.forecastLabelCell, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                  <Feather name={row.icon} size={13} color={theme.textTertiary} />
                  <ThemedText style={[styles.forecastLabelText, { color: theme.textSecondary }]}>{row.label}</ThemedText>
                </View>
              ))}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.forecastScrollArea}
            >
              {weather.forecasts.slice(1).map((forecast, index) => {
                const fTime = new Date(forecast.timestamp);
                const isDay = solarTimes ? isTimeDuringDaylight(fTime, solarTimes) : true;
                const isTwilight = solarTimes ? isTimeDuringCivilTwilight(fTime, solarTimes) : false;
                const colBg = isDay ? undefined : isTwilight ? "#FF8C0008" : "#3B4F7410";
                return (
                <View key={index} style={[styles.forecastDataCol, colBg ? { backgroundColor: colBg } : undefined]}>
                  <View style={styles.forecastDataCell}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      {!isDay ? (
                        <Feather
                          name={isTwilight ? "sunset" : "moon"}
                          size={9}
                          color={isTwilight ? "#FF8C00" : "#6B7FA0"}
                        />
                      ) : null}
                      <ThemedText style={[styles.forecastTimeLabel, { color: isDay ? theme.textSecondary : isTwilight ? "#FF8C00" : "#6B7FA0" }]}>
                        {formatTime(forecast.timestamp)}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={[styles.forecastDataCell, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <ThemedText style={styles.forecastDataValue}>{convertTemp(forecast.temperature)}°</ThemedText>
                  </View>
                  <View style={[styles.forecastDataCell, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <ThemedText style={styles.forecastDataValue}>{convertWind(forecast.windSpeed)}</ThemedText>
                  </View>
                  <View style={[styles.forecastDataCell, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <ThemedText style={styles.forecastDataValue}>{forecast.windGust ? convertWind(forecast.windGust) : "-"}</ThemedText>
                  </View>
                  <View style={[styles.forecastDataCell, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <ThemedText style={styles.forecastDataValue}>{forecast.rain.toFixed(1)}</ThemedText>
                  </View>
                  <View style={[styles.forecastDataCell, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
                    <ThemedText style={styles.forecastDataValue}>{forecast.cloudCover.toFixed(0)}%</ThemedText>
                  </View>
                </View>
                );
              })}
            </ScrollView>
          </View>
        </Card>

        {isAdmin ? (
          <ThemedText style={[styles.sourceText, { color: theme.textTertiary }]}>
            Datenquelle: DFS dipul Weather Service (DWD ICON-D2, 2km Raster)
          </ThemedText>
        ) : null}
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          WERKZEUGE
        </ThemedText>
        <Card style={styles.ndFilterCard}>
          <View style={styles.ndFilterRow}>
            <Feather name="aperture" size={22} color={theme.primary} />
            <View style={styles.ndFilterTextCol}>
              <ThemedText style={styles.ndFilterTitle}>ND-Filter berechnen</ThemedText>
              <ThemedText style={[styles.ndFilterSubtitle, { color: theme.textSecondary }]}>
                Bewölkung {current.cloudCover.toFixed(0)}%, Regen {current.rain.toFixed(1)} mm/h werden übernommen
              </ThemedText>
            </View>
          </View>
          <Button
            title="ND-Filter Finder öffnen"
            variant="secondary"
            onPress={handleOpenNdFilter}
            style={{ marginTop: Spacing.md }}
          />
        </Card>

        {hourlySlots.length > 0 ? (
          <HourlyForecastTable
            hourlySlots={hourlySlots}
            hourlySource={hourlySource}
            latitude={latitude}
            longitude={longitude}
            maxAltitude={maxAltitude ?? 120}
            drone={selectedDrone}
            subtitle="Wetter heute (Pre-Check)"
            highlightStart={hourlyHighlight.start}
            highlightEnd={hourlyHighlight.end}
          />
        ) : null}
      </ScrollView>

      <KpLocalSignalCheckModal
        visible={kpLocalSignalCheckVisible}
        forecastKp={kpForecastForFlight ?? 5}
        onClose={() => setKpLocalSignalCheckVisible(false)}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Gegen Limits prüfen"
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
  content: {
    paddingHorizontal: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: Spacing.md,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  errorTitle: {
    ...Typography.h3,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  errorText: {
    ...Typography.body,
    textAlign: "center",
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  currentCard: {
    padding: Spacing.lg,
  },
  currentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  currentItem: {
    width: "33.33%",
    alignItems: "center",
    paddingVertical: Spacing.md,
  },
  currentValue: {
    ...Typography.h4,
    marginTop: Spacing.xs,
  },
  currentLabel: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  beaufortStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
  },
  beaufortBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  beaufortBadgeText: {
    color: "#FFF",
    fontWeight: "800",
    fontSize: 13,
  },
  beaufortTitle: {
    ...Typography.small,
    fontWeight: "600",
  },
  beaufortSign: {
    fontSize: 11,
    marginTop: 2,
  },
  currentHint: {
    ...Typography.caption,
    marginTop: Spacing.sm,
    textAlign: "center",
    fontStyle: "italic",
  },
  ndFilterCard: {
    padding: Spacing.lg,
  },
  ndFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  ndFilterTextCol: {
    flex: 1,
  },
  ndFilterTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  ndFilterSubtitle: {
    ...Typography.caption,
    marginTop: 2,
  },
  forecastTableCard: {
    padding: 0,
    overflow: "hidden",
  },
  forecastTable: {
    flexDirection: "row",
  },
  forecastLabelCol: {
    width: 72,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: Colors.light.border,
  },
  forecastLabelCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: 8,
  },
  forecastLabelText: {
    fontSize: 11,
    fontWeight: "600",
  },
  forecastScrollArea: {
    flex: 1,
  },
  forecastDataCol: {
    minWidth: 56,
    alignItems: "center",
  },
  forecastDataCell: {
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  forecastTimeLabel: {
    fontSize: 11,
    fontWeight: "700",
  },
  forecastDataValue: {
    fontSize: 11,
    fontWeight: "500",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    marginRight: Spacing.xs,
  },
  altitudeCard: {
    padding: Spacing.sm,
  },
  altHeaderRow: {
    flexDirection: "row",
    paddingBottom: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  altDataRow: {
    flexDirection: "row",
    paddingVertical: 6,
  },
  altHeightCol: {
    width: 42,
    justifyContent: "center",
  },
  altHeightLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  altDataCol: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  altColHeader: {
    fontSize: 10,
    fontWeight: "600",
  },
  altVal: {
    fontSize: 12,
    fontWeight: "500",
  },
  kpCard: {
    padding: Spacing.lg,
  },
  kpCheckButton: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 14,
    marginTop: Spacing.md,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
  },
  kpCheckButtonText: {
    fontSize: 14,
    fontWeight: "700",
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
  },
  kpBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  kpDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  kpBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  kpDescription: {
    ...Typography.caption,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  solarCard: {
    padding: Spacing.lg,
  },
  solarPhaseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  solarPhaseBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
  },
  solarPhaseText: {
    fontSize: 13,
    fontWeight: "700",
  },
  solarDayLength: {
    fontSize: 12,
    fontWeight: "500",
  },
  solarArcWrap: {
    alignSelf: "stretch",
    marginBottom: Spacing.lg,
  },
  solarArcTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: Spacing.xs,
  },
  solarTimesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  solarTimeItem: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  solarTimeLabel: {
    fontSize: 10,
    fontWeight: "500",
  },
  solarTimeValue: {
    fontSize: 15,
    fontWeight: "700",
  },
  solarHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    padding: Spacing.sm,
    borderRadius: 8,
    marginTop: Spacing.sm,
  },
  solarHintText: {
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
  },
  sourceText: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing["2xl"],
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
});
