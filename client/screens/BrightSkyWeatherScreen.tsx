import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform } from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import { fetchBrightSkyWeather, BrightSkyData } from "@/lib/brightsky";

type RouteParams = {
  BrightSkyWeather: {
    latitude: number;
    longitude: number;
    locationName?: string;
  };
};

export default function BrightSkyWeatherScreen() {
  const route = useRoute<RouteProp<RouteParams, "BrightSkyWeather">>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<BrightSkyData | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);

  const { latitude, longitude, locationName } = route.params;

  const loadWeather = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBrightSkyWeather(latitude, longitude, selectedDate);
      setWeather(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wetterdaten konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude, selectedDate]);

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "good":
        return theme.statusGo;
      case "caution":
        return theme.statusCaution;
      case "bad":
        return theme.statusNoGo;
      default:
        return theme.textTertiary;
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case "good":
        return theme.statusGoBackground;
      case "caution":
        return theme.statusCautionBackground;
      case "bad":
        return theme.statusNoGoBackground;
      default:
        return theme.backgroundSecondary;
    }
  };

  const getStatusIcon = (status: string): keyof typeof Feather.glyphMap => {
    switch (status) {
      case "good":
        return "check-circle";
      case "caution":
        return "alert-triangle";
      case "bad":
        return "x-circle";
      default:
        return "info";
    }
  };

  const dateOptions = React.useMemo(() => {
    const dates: { label: string; value: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const value = d.toISOString().split("T")[0];
      const label =
        i === 0 ? "Heute" : i === 1 ? "Morgen" : d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric" });
      dates.push({ label, value });
    }
    return dates;
  }, []);

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerContent, { paddingTop: headerHeight }]}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
            DWD-Daten werden geladen...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error || !weather) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerContent, { paddingTop: headerHeight }]}>
          <Feather name="cloud-off" size={48} color={theme.textTertiary} />
          <ThemedText style={styles.errorTitle}>Fehler</ThemedText>
          <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
            {error || "Wetterdaten nicht verfügbar"}
          </ThemedText>
          <Button title="Erneut versuchen" onPress={loadWeather} style={{ marginTop: Spacing.xl }} />
        </View>
      </ThemedView>
    );
  }

  const hourlyFiltered = weather.hourly.filter((_, i) => i % 3 === 0).slice(0, 8);
  const maxWind = Math.max(...hourlyFiltered.map((h) => h.wind_speed || 0), 1);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: insets.bottom + Spacing["3xl"],
          paddingHorizontal: Spacing.lg,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dateRow}
          contentContainerStyle={styles.dateRowContent}
        >
          {dateOptions.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setSelectedDate(opt.value)}
              style={[
                styles.dateChip,
                {
                  backgroundColor:
                    selectedDate === opt.value ? theme.primary : theme.backgroundSecondary,
                },
              ]}
            >
              <ThemedText
                style={[
                  styles.dateChipText,
                  {
                    color: selectedDate === opt.value ? "#FFFFFF" : theme.textSecondary,
                  },
                ]}
              >
                {opt.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {locationName ? (
          <View style={styles.locationRow}>
            <Feather name="map-pin" size={14} color={theme.primary} />
            <ThemedText style={[styles.locationText, { color: theme.primary }]}>
              {locationName}
            </ThemedText>
          </View>
        ) : null}

        <Card style={[styles.statusCard, { borderColor: getStatusColor(weather.flyStatus) + "40" }]}>
          <View style={[styles.statusInner, { backgroundColor: getStatusBg(weather.flyStatus) }]}>
            <Feather
              name={getStatusIcon(weather.flyStatus)}
              size={24}
              color={getStatusColor(weather.flyStatus)}
            />
            <View style={styles.statusText}>
              <ThemedText style={[styles.statusTitle, { color: getStatusColor(weather.flyStatus) }]}>
                {weather.flyText}
              </ThemedText>
              <ThemedText style={[styles.statusSub, { color: theme.textSecondary }]}>
                {weather.flySub}
              </ThemedText>
            </View>
          </View>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          WETTERDATEN ({weather.dateLabel})
        </ThemedText>

        <View style={styles.weatherGrid}>
          <Card style={styles.weatherCard}>
            <Feather name="wind" size={20} color={theme.primary} />
            <ThemedText style={styles.weatherValue}>
              {Math.round(weather.windSpeed)}
              <ThemedText style={[styles.weatherUnit, { color: theme.textTertiary }]}> km/h</ThemedText>
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>
              Wind ({weather.windDirectionLabel})
            </ThemedText>
          </Card>

          <Card style={styles.weatherCard}>
            <Feather name="zap" size={20} color={theme.primary} />
            <ThemedText style={styles.weatherValue}>
              {Math.round(weather.gustSpeed)}
              <ThemedText style={[styles.weatherUnit, { color: theme.textTertiary }]}> km/h</ThemedText>
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>
              Böen
            </ThemedText>
          </Card>

          <Card style={styles.weatherCard}>
            <Feather name="thermometer" size={20} color={theme.primary} />
            <ThemedText style={styles.weatherValue}>
              {weather.temperature.toFixed(1)}
              <ThemedText style={[styles.weatherUnit, { color: theme.textTertiary }]}>°C</ThemedText>
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>
              Temperatur
            </ThemedText>
          </Card>

          <Card style={styles.weatherCard}>
            <Feather name="eye" size={20} color={theme.primary} />
            <ThemedText style={styles.weatherValue}>
              {weather.visibility}
              <ThemedText style={[styles.weatherUnit, { color: theme.textTertiary }]}> km</ThemedText>
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>
              Sicht
            </ThemedText>
          </Card>

          <Card style={styles.weatherCard}>
            <Feather name="cloud" size={20} color={theme.primary} />
            <ThemedText style={styles.weatherValue}>
              {Math.round(weather.cloudCover)}
              <ThemedText style={[styles.weatherUnit, { color: theme.textTertiary }]}>%</ThemedText>
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>
              Bewölkung
            </ThemedText>
          </Card>

          <Card style={styles.weatherCard}>
            <Feather name="cloud-rain" size={20} color={theme.primary} />
            <ThemedText style={styles.weatherValue}>
              {weather.precipitation.toFixed(1)}
              <ThemedText style={[styles.weatherUnit, { color: theme.textTertiary }]}> mm</ThemedText>
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>
              Niederschlag
            </ThemedText>
          </Card>
        </View>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing.xl }]}>
          STUNDENVERLAUF WIND
        </ThemedText>

        <Card style={styles.chartCard}>
          <View style={styles.chartContainer}>
            {hourlyFiltered.map((h, i) => {
              const ws = h.wind_speed || 0;
              const pct = (ws / maxWind) * 100;
              const time = h.timestamp.slice(11, 16);
              const barColor =
                ws > 12 ? theme.statusNoGo : ws > 8 ? theme.statusCaution : theme.primary;

              return (
                <View key={i} style={styles.chartBar}>
                  <ThemedText
                    style={[
                      styles.chartBarValue,
                      {
                        color: barColor,
                        fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
                      },
                    ]}
                  >
                    {Math.round(ws)}
                  </ThemedText>
                  <View style={styles.chartBarTrack}>
                    <View
                      style={[
                        styles.chartBarFill,
                        {
                          height: `${Math.max(pct, 5)}%`,
                          backgroundColor: barColor,
                          opacity: 0.7,
                        },
                      ]}
                    />
                  </View>
                  <ThemedText style={[styles.chartBarTime, { color: theme.textTertiary }]}>
                    {time}
                  </ThemedText>
                </View>
              );
            })}
          </View>
          <ThemedText style={[styles.chartUnit, { color: theme.textTertiary }]}>
            Wind in km/h
          </ThemedText>
        </Card>

        <ThemedText style={[styles.sourceText, { color: theme.textTertiary }]}>
          Quelle: Deutscher Wetterdienst (DWD) via BrightSky API
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  loadingText: {
    ...Typography.body,
    marginTop: Spacing.md,
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
  dateRow: {
    marginHorizontal: -Spacing.lg,
    marginBottom: Spacing.lg,
  },
  dateRowContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  dateChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
  },
  dateChipText: {
    ...Typography.small,
    fontWeight: "600",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  locationText: {
    ...Typography.small,
    fontWeight: "600",
  },
  statusCard: {
    marginBottom: Spacing.xl,
    borderWidth: 1,
  },
  statusInner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  statusText: {
    flex: 1,
  },
  statusTitle: {
    ...Typography.h4,
  },
  statusSub: {
    ...Typography.small,
    marginTop: 2,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
    marginLeft: Spacing.xs,
  },
  weatherGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  weatherCard: {
    width: "48%",
    flexGrow: 1,
    flexBasis: "47%",
    padding: Spacing.md,
    alignItems: "center",
  },
  weatherValue: {
    ...Typography.h3,
    marginTop: Spacing.xs,
  },
  weatherUnit: {
    ...Typography.small,
  },
  weatherLabel: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  chartCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  chartContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 120,
    gap: Spacing.xs,
  },
  chartBar: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    height: "100%",
    justifyContent: "flex-end",
  },
  chartBarValue: {
    fontSize: 10,
    fontWeight: "700",
  },
  chartBarTrack: {
    flex: 1,
    width: "100%",
    justifyContent: "flex-end",
  },
  chartBarFill: {
    width: "100%",
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    minHeight: 4,
  },
  chartBarTime: {
    fontSize: 9,
  },
  chartUnit: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  sourceText: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.lg,
  },
});
