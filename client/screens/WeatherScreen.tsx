import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors } from "@/constants/theme";
import { fetchWeather, WeatherData, WeatherFetchError, ForecastData } from "@/lib/weather";
import { fetchKpIndex, KpIndexData, getKpLabel } from "@/lib/kpindex";
import { calculateSolarTimes, formatSolarTime, getDaylightPhase, isTimeDuringDaylight, isTimeDuringCivilTwilight, SolarTimes } from "@/lib/solar";
import { getSettings, Settings, getDrone, DroneProfile, WeatherLimits, DEFAULT_LIMITS, getFlightSession } from "@/lib/storage";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";

type RouteParams = RouteProp<FlightCheckParamList, "Weather">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "Weather">;

export default function WeatherScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedDrone, setSelectedDrone] = useState<DroneProfile | null>(null);
  const [limits, setLimits] = useState<WeatherLimits>(DEFAULT_LIMITS);
  const [isFpvFlight, setIsFpvFlight] = useState(false);
  const [altitudeExpanded, setAltitudeExpanded] = useState(false);
  const [kpData, setKpData] = useState<KpIndexData | null>(null);
  const [solarTimes, setSolarTimes] = useState<SolarTimes | null>(null);

  const altHeights = useMemo(() => {
    if (!weather) return [];
    const c = weather.forecasts[0];
    const windH = (c.windAtAltitude || []).map((w) => w.height);
    const tempH = (c.temperatureAtAltitude || []).map((t) => t.height);
    const humH = (c.humidityAtAltitude || []).map((h) => h.height);
    const cloudH = (c.cloudCoverAtAltitude || []).map((cl) => cl.height);
    const all = new Set([...windH, ...tempH, ...humH, ...cloudH]);
    return Array.from(all).sort((a, b) => b - a);
  }, [weather]);

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, droneId, sessionId } = route.params;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = sessionId ? await getFlightSession(sessionId) : null;
      const flightDuration = session?.planning?.estimatedDuration;

      const [weatherData, settingsData, kpResult] = await Promise.all([
        fetchWeather(latitude, longitude, flightDuration),
        getSettings(),
        fetchKpIndex().catch(() => null),
      ]);
      
      const drone = droneId ? await getDrone(droneId) : null;
      
      setWeather(weatherData);
      setSettings(settingsData);
      setSelectedDrone(drone);
      if (kpResult) setKpData(kpResult);
      setSolarTimes(calculateSolarTimes(latitude, longitude));
      
      if (session?.planning?.isFpvFlight) {
        setIsFpvFlight(true);
      } else if (drone?.droneType === "fpv_only") {
        setIsFpvFlight(true);
      }
      
      if (drone) {
        setLimits(drone.limits);
      } else {
        setLimits(settingsData.limits);
      }
    } catch (err) {
      console.error("Weather fetch error:", err);
      if (err instanceof WeatherFetchError) {
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
  }, [loadData]);

  const handleContinue = () => {
    if (!weather) return;
    
    if (selectedDrone?.droneType === "hybrid_fpv") {
      navigation.navigate("FpvSelect", {
        latitude,
        longitude,
        hasRestrictions,
        restrictionStatus,
        restrictionNotes,
        weatherData: weather,
        droneId: droneId,
        limits: limits,
        sessionId,
        kpIndex: kpData?.value,
      });
    } else {
      navigation.navigate("Checklist", {
        latitude,
        longitude,
        hasRestrictions,
        restrictionStatus,
        restrictionNotes,
        weatherData: weather,
        droneId: droneId,
        limits: limits,
        sessionId,
        isFpvFlight,
        kpIndex: kpData?.value,
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
          <Button title="Erneut versuchen" onPress={loadData} style={{ marginTop: Spacing.xl }} />
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
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          AKTUELL
        </ThemedText>
        <Card style={styles.currentCard}>
          <View style={styles.currentGrid}>
            <View style={styles.currentItem}>
              <Feather name="thermometer" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {convertTemp(current.temperature)}{getTempUnit()}
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Temperatur
              </ThemedText>
            </View>
            <View style={styles.currentItem}>
              <Feather name="wind" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {convertWind(current.windSpeed)} {getWindUnit()}
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Wind
              </ThemedText>
            </View>
            <View style={styles.currentItem}>
              <Feather name="zap" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.windGust ? convertWind(current.windGust) : "-"} {getWindUnit()}
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Böen
              </ThemedText>
            </View>
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
              <Feather name="cloud" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.cloudCover.toFixed(0)}%
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Wolken
              </ThemedText>
            </View>
            <View style={styles.currentItem}>
              <Feather name="droplet" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.humidity.toFixed(0)}%
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Luftfeuchte
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
            <View style={styles.currentItem}>
              <Feather name="cloud-snow" size={24} color={theme.primary} />
              <ThemedText style={styles.currentValue}>
                {current.snow.toFixed(1)} mm
              </ThemedText>
              <ThemedText style={[styles.currentLabel, { color: theme.textSecondary }]}>
                Schnee
              </ThemedText>
            </View>
          </View>
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

              <View style={styles.solarTimeline}>
                <View style={[styles.solarTimelineTrack, { backgroundColor: theme.backgroundSecondary }]}>
                  {solarTimes.civilDawnStart && solarTimes.civilDuskEnd ? (
                    <View style={[styles.solarTwilightBar, {
                      left: `${timeToPercent(solarTimes.civilDawnStart)}%`,
                      right: `${100 - timeToPercent(solarTimes.civilDuskEnd)}%`,
                      backgroundColor: "#FF8C0030",
                    }]} />
                  ) : null}
                  {solarTimes.sunrise && solarTimes.sunset ? (
                    <View style={[styles.solarDayBar, {
                      left: `${timeToPercent(solarTimes.sunrise)}%`,
                      right: `${100 - timeToPercent(solarTimes.sunset)}%`,
                      backgroundColor: "#FFB82060",
                    }]} />
                  ) : null}
                  <View style={[styles.solarNowMarker, {
                    left: `${timeToPercent(new Date())}%`,
                    backgroundColor: theme.primary,
                  }]} />
                </View>
                <View style={styles.solarTimelineLabels}>
                  <ThemedText style={[styles.solarTimelineEdge, { color: theme.textTertiary }]}>00:00</ThemedText>
                  <ThemedText style={[styles.solarTimelineEdge, { color: theme.textTertiary }]}>12:00</ThemedText>
                  <ThemedText style={[styles.solarTimelineEdge, { color: theme.textTertiary }]}>24:00</ThemedText>
                </View>
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
                    {kpData.value < 4 ? "GPS OK" : kpData.value < 6 ? "GPS Einschränkung" : "GPS Warnung"}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={[styles.kpDescription, { color: theme.textSecondary }]}>
                {kpData.description}
              </ThemedText>
            </Card>
          </>
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
            {altHeights.map((h, idx) => {
              const wind = current.windAtAltitude.find((w) => w.height === h);
              const temp = getValAtHeight(current.temperatureAtAltitude, h);
              const hum = getValAtHeight(current.humidityAtAltitude, h);
              const cloud = getValAtHeight(current.cloudCoverAtAltitude, h);
              return (
                <View key={h} style={[styles.altDataRow, idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : undefined]}>
                  <View style={styles.altHeightCol}>
                    <ThemedText style={[styles.altHeightLabel, { color: theme.primary }]}>{h}m</ThemedText>
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
            })}
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

        <ThemedText style={[styles.sourceText, { color: theme.textTertiary }]}>
          Datenquelle: DFS dipul Weather Service (DWD ICON-D2, 2km Raster)
        </ThemedText>
      </ScrollView>

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
  solarTimeline: {
    marginBottom: Spacing.lg,
  },
  solarTimelineTrack: {
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
    position: "relative",
  },
  solarTwilightBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 6,
  },
  solarDayBar: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 6,
  },
  solarNowMarker: {
    position: "absolute",
    top: -2,
    width: 3,
    height: 16,
    borderRadius: 1.5,
    marginLeft: -1.5,
  },
  solarTimelineLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  solarTimelineEdge: {
    fontSize: 9,
    fontWeight: "500",
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
