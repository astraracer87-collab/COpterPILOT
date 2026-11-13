import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Alert } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
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
import StatusBadge from "@/components/StatusBadge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors } from "@/constants/theme";
import { updateFlightSession, getDrone, DroneProfile } from "@/lib/storage";
import { assessWeather } from "@/lib/assessment";
import { suggestCategory, CategoryAdvice } from "@/lib/categoryAdvice";
import { calculateSolarTimes, formatSolarTime, getDaylightPhase, SolarTimes } from "@/lib/solar";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningResult">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningResult">;

export default function PlanningResultScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [droneName, setDroneName] = useState<string>("");
  const [categoryAdvice, setCategoryAdvice] = useState<CategoryAdvice | null>(null);
  const [solarTimes, setSolarTimes] = useState<SolarTimes | null>(null);

  const { 
    droneId, 
    latitude, 
    longitude, 
    locationName, 
    plannedDate, 
    plannedTime, 
    forecastWeather, 
    limits,
    maxAltitude,
    checklistCompleted,
    checklistPresented,
    sessionId,
    isFpvFlight,
  } = route.params;

  const assessment = forecastWeather 
    ? (() => {
        const emptyAlt = [{ height: 2, value: 0 }];
        const weatherData = {
          latitude,
          longitude,
          calculationTime: new Date().toISOString(),
          forecasts: [{
            timestamp: new Date().toISOString(),
            temperature: forecastWeather.temperature,
            humidity: forecastWeather.humidity || 50,
            windSpeed: forecastWeather.windSpeed,
            windGust: forecastWeather.windGust,
            windDirection: 0,
            windAtAltitude: (forecastWeather.windAtAltitude || []) as { height: number; speed: number; gust?: number; direction: number }[],
            temperatureAtAltitude: forecastWeather.temperatureAtAltitude ? forecastWeather.temperatureAtAltitude.map(t => ({ height: t.height, value: t.value })) : emptyAlt,
            humidityAtAltitude: emptyAlt,
            cloudCoverAtAltitude: [] as { height: number; value: number }[],
            rain: forecastWeather.rain,
            snow: 0,
            cloudCover: forecastWeather.cloudCover,
            pressure: 1013,
          }],
        };
        return assessWeather(weatherData, limits, false, undefined, undefined, maxAltitude);
      })()
    : { status: "caution" as const, warnings: [], expertTips: [] };

  useEffect(() => {
    getDrone(droneId).then(drone => {
      if (drone) {
        setDroneName(drone.name);
        const advice = suggestCategory(drone, {
          isFpvFlight: isFpvFlight,
        });
        setCategoryAdvice(advice);
      }
    });
    const planDate = plannedDate ? new Date(plannedDate) : new Date();
    setSolarTimes(calculateSolarTimes(latitude, longitude, planDate));
  }, [droneId, isFpvFlight, latitude, longitude, plannedDate]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFlightSession(sessionId, {
        status: assessment.status,
        reasons: assessment.warnings.map(w => ({
          type: w.severity === "warning" ? "caution" : "go",
          message: w.message,
        })),
        planning: {
          plannedDate,
          plannedTime,
          forecastWeather,
          maxAltitude,
          checklistCompleted,
          checklistPresented: checklistPresented || [],
          isFpvFlight: isFpvFlight || false,
        },
      });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(true);
    } catch (error) {
      Alert.alert("Fehler", "Die Planung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const handleDone = () => {
    navigation.getParent()?.goBack();
  };

  const formatDateTime = () => {
    const date = new Date(`${plannedDate}T${plannedTime}`);
    return date.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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
          <View style={[styles.successIcon, { backgroundColor: theme.statusGoBackground }]}>
            <Feather name="check-circle" size={48} color={theme.statusGo} />
          </View>
          <ThemedText style={styles.title}>Flugplanung abgeschlossen</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Dein Flug wurde erfolgreich geplant
          </ThemedText>
        </View>

        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Feather name="send" size={18} color={theme.textSecondary} />
            <View style={styles.summaryContent}>
              <ThemedText style={[styles.summaryLabel, { color: theme.textTertiary }]}>Drohne</ThemedText>
              <ThemedText style={styles.summaryValue}>{droneName}</ThemedText>
            </View>
          </View>
          
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          
          <View style={styles.summaryRow}>
            <Feather name="map-pin" size={18} color={theme.textSecondary} />
            <View style={styles.summaryContent}>
              <ThemedText style={[styles.summaryLabel, { color: theme.textTertiary }]}>Standort</ThemedText>
              <ThemedText style={styles.summaryValue}>
                {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
              </ThemedText>
            </View>
          </View>
          
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          
          <View style={styles.summaryRow}>
            <Feather name="calendar" size={18} color={theme.textSecondary} />
            <View style={styles.summaryContent}>
              <ThemedText style={[styles.summaryLabel, { color: theme.textTertiary }]}>Geplanter Zeitpunkt</ThemedText>
              <ThemedText style={styles.summaryValue}>{formatDateTime()}</ThemedText>
            </View>
          </View>
        </Card>

        {forecastWeather ? (
          <Card style={styles.weatherCard}>
            <View style={styles.weatherHeader}>
              <ThemedText style={styles.weatherTitle}>Wettervorhersage</ThemedText>
              <StatusBadge status={assessment.status} />
            </View>
            <View style={styles.weatherGrid}>
              <View style={styles.weatherItem}>
                <Feather name="thermometer" size={16} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>{forecastWeather.temperature?.toFixed(1)}°C</ThemedText>
              </View>
              <View style={styles.weatherItem}>
                <Feather name="wind" size={16} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>{forecastWeather.windSpeed?.toFixed(1)} m/s</ThemedText>
              </View>
              <View style={styles.weatherItem}>
                <Feather name="cloud-rain" size={16} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>{forecastWeather.rain?.toFixed(1)} mm</ThemedText>
              </View>
              <View style={styles.weatherItem}>
                <Feather name="cloud" size={16} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>{forecastWeather.cloudCover?.toFixed(0)}%</ThemedText>
              </View>
            </View>
            {forecastWeather.windAtAltitude && forecastWeather.windAtAltitude.length > 0 ? (() => {
              const altWinds = forecastWeather.windAtAltitude!.filter(w => w.height >= 50);
              if (altWinds.length === 0) return null;
              const maxWind = altWinds.reduce((max, w) => w.speed > max.speed ? w : max, altWinds[0]);
              return (
                <View style={[styles.altWindSummary, { borderTopColor: theme.border }]}>
                  <View style={styles.altWindSummaryRow}>
                    <Feather name="layers" size={14} color={theme.textTertiary} />
                    <ThemedText style={[styles.altWindSummaryLabel, { color: theme.textSecondary }]}>
                      Max. Höhenwind
                    </ThemedText>
                    <ThemedText style={[styles.altWindSummaryValue, { color: maxWind.speed > 10 ? theme.statusNoGo : maxWind.speed > 7 ? theme.statusCaution : theme.text }]}>
                      {maxWind.speed.toFixed(1)} m/s ({maxWind.height}m)
                    </ThemedText>
                  </View>
                  <View style={styles.altWindBarRow}>
                    {altWinds.map((w) => (
                      <View key={w.height} style={styles.altWindBarItem}>
                        <ThemedText style={[styles.altWindBarLabel, { color: theme.textTertiary }]}>{w.height}m</ThemedText>
                        <ThemedText style={[styles.altWindBarValue, { color: w.speed > 10 ? theme.statusNoGo : w.speed > 7 ? theme.statusCaution : theme.textSecondary }]}>
                          {w.speed.toFixed(1)}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })() : null}
            {assessment.warnings.length > 0 ? (
              <View style={styles.warningsSection}>
                {assessment.warnings.map((warning, index) => (
                  <View key={index} style={styles.warningRow}>
                    <View style={[styles.warningDot, { backgroundColor: theme.statusCaution }]} />
                    <ThemedText style={[styles.warningText, { color: theme.textSecondary }]}>
                      {warning.message}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
            {solarTimes ? (
              <View style={[styles.solarRow, { borderTopColor: theme.border }]}>
                <View style={styles.solarItem}>
                  <Feather name="sunrise" size={14} color="#FF8C00" />
                  <ThemedText style={[styles.solarLabel, { color: theme.textSecondary }]}>
                    {formatSolarTime(solarTimes.civilDawnStart)}
                  </ThemedText>
                </View>
                <View style={styles.solarItem}>
                  <Feather name="sun" size={14} color="#FFB820" />
                  <ThemedText style={[styles.solarLabel, { color: theme.textSecondary }]}>
                    {formatSolarTime(solarTimes.sunrise)} – {formatSolarTime(solarTimes.sunset)}
                  </ThemedText>
                </View>
                <View style={styles.solarItem}>
                  <Feather name="moon" size={14} color="#6B7FA0" />
                  <ThemedText style={[styles.solarLabel, { color: theme.textSecondary }]}>
                    {formatSolarTime(solarTimes.civilDuskEnd)}
                  </ThemedText>
                </View>
              </View>
            ) : null}
          </Card>
        ) : null}

        {categoryAdvice ? (
          <Card style={[styles.categoryCard, { borderLeftColor: categoryAdvice.color === "green" ? theme.statusGo : categoryAdvice.color === "yellow" ? theme.statusCaution : theme.statusNoGo }]}>
            <View style={styles.categoryHeader}>
              <Feather
                name={categoryAdvice.color === "green" ? "shield" : categoryAdvice.color === "yellow" ? "alert-triangle" : "alert-octagon"}
                size={22}
                color={categoryAdvice.color === "green" ? theme.statusGo : categoryAdvice.color === "yellow" ? theme.statusCaution : theme.statusNoGo}
              />
              <View style={styles.categoryTitleWrap}>
                <ThemedText style={styles.categoryTitle}>Betriebskategorie</ThemedText>
                <View style={[styles.categoryBadge, { backgroundColor: (categoryAdvice.color === "green" ? theme.statusGoBackground : categoryAdvice.color === "yellow" ? theme.statusCautionBackground : theme.statusNoGoBackground) }]}>
                  <ThemedText style={[styles.categoryBadgeText, { color: categoryAdvice.color === "green" ? theme.statusGo : categoryAdvice.color === "yellow" ? theme.statusCaution : theme.statusNoGo }]}>
                    {categoryAdvice.category}
                  </ThemedText>
                </View>
              </View>
            </View>
            <ThemedText style={[styles.categoryDesc, { color: theme.text }]}>
              {categoryAdvice.description}
            </ThemedText>
            <View style={styles.categoryReqs}>
              {categoryAdvice.requirements.map((req, i) => (
                <View key={i} style={styles.categoryReqRow}>
                  <Feather name="check" size={12} color={theme.statusGo} />
                  <ThemedText style={[styles.categoryReqText, { color: theme.text }]}>{req}</ThemedText>
                </View>
              ))}
            </View>
            {categoryAdvice.safetyDistances.length > 0 ? (
              <View style={styles.categorySubSection}>
                <ThemedText style={[styles.categorySubTitle, { color: theme.text }]}>Sicherheitsabstände</ThemedText>
                {categoryAdvice.safetyDistances.map((dist, i) => (
                  <View key={i} style={styles.categoryReqRow}>
                    <Feather name="arrow-right" size={12} color={theme.statusCaution} />
                    <ThemedText style={[styles.categoryReqText, { color: theme.text }]}>{dist}</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
            {categoryAdvice.technicalRequirements.length > 0 ? (
              <View style={styles.categorySubSection}>
                <ThemedText style={[styles.categorySubTitle, { color: theme.text }]}>Technische Anforderungen</ThemedText>
                {categoryAdvice.technicalRequirements.map((tech, i) => (
                  <View key={i} style={styles.categoryReqRow}>
                    <Feather name="cpu" size={12} color={theme.primary} />
                    <ThemedText style={[styles.categoryReqText, { color: theme.text }]}>{tech}</ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card style={[styles.infoCard, { borderLeftColor: theme.primary }]}>
          <Feather name="info" size={20} color={theme.primary} />
          <ThemedText style={[styles.infoText, { color: theme.textSecondary }]}>
            Am Flugtag kannst du den Pre-Flight Check direkt vor Ort durchführen. 
            Die Planung erscheint in deiner Briefing-Liste.
          </ThemedText>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        {saved ? (
          <Button
            title="Fertig"
            onPress={handleDone}
          />
        ) : (
          <Button
            title={saving ? "Speichern..." : "Planung speichern"}
            onPress={handleSave}
            disabled={saving}
          />
        )}
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
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.h2,
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.body,
    textAlign: "center",
  },
  summaryCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  summaryContent: {
    flex: 1,
  },
  summaryLabel: {
    ...Typography.caption,
    marginBottom: 2,
  },
  summaryValue: {
    ...Typography.body,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    marginVertical: Spacing.md,
  },
  weatherCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
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
  weatherGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  weatherItem: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  weatherValue: {
    ...Typography.body,
    fontWeight: "600",
  },
  altWindSummary: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  altWindSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  altWindSummaryLabel: {
    ...Typography.small,
    flex: 1,
  },
  altWindSummaryValue: {
    ...Typography.body,
    fontWeight: "700",
  },
  altWindBarRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  altWindBarItem: {
    alignItems: "center",
    gap: 2,
  },
  altWindBarLabel: {
    ...Typography.caption,
    fontSize: 10,
  },
  altWindBarValue: {
    ...Typography.caption,
    fontWeight: "600",
  },
  warningsSection: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  warningText: {
    ...Typography.small,
    flex: 1,
  },
  solarRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  solarItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  solarLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  categoryCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderLeftWidth: 3,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  categoryTitleWrap: {
    flex: 1,
  },
  categoryTitle: {
    ...Typography.h4,
    marginBottom: 4,
  },
  categoryBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryBadgeText: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 11,
  },
  categoryDesc: {
    ...Typography.small,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  categoryReqs: {
    gap: 4,
  },
  categoryReqRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  categoryReqText: {
    ...Typography.caption,
    flex: 1,
  },
  categorySubSection: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.2)",
    gap: 4,
  },
  categorySubTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: 2,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderLeftWidth: 3,
  },
  infoText: {
    ...Typography.small,
    flex: 1,
    lineHeight: 20,
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
