import { computeVlosM, alosKindForDroneType } from "@/lib/vlos";
import React, { useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Alert, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import StatusBadge from "@/components/StatusBadge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors, BorderRadius } from "@/constants/theme";
import { updateFlightSession, getFlightSession, getDrone, getDrones, DroneProfile } from "@/lib/storage";
import { computeFlightWindow } from "@/lib/planningDateTime";
import type { ExpertTip } from "@/lib/assessment";
import { evaluateFlight, storedChecksFor } from "@/lib/flightChecks";
import { ALL_CHECK_CATEGORIES, effectiveSeverity, replaceCheckCategories, sessionReasonsFromChecks, sortChecks, type CheckResult } from "../../shared/checks";
import { recommendDroneForExceedance, DroneRecommendation } from "@/lib/droneRecommendation";
import { suggestCategory, CategoryAdvice } from "@/lib/categoryAdvice";
import { calculateSolarTimes, formatSolarTime, getDaylightPhase, SolarTimes, computeSunElevation } from "@/lib/solar";
import { findPresetForDrone, DronePreset } from "@/lib/dronePresets";
import { estimateEv, shutterDenomFromEv, snapShutterDenom, recommendNd, NdRecommendation } from "@/lib/ndFilter";
import SunArcChart from "@/components/SunArcChart";
import { DataStandLines } from "@/components/DataStandLines";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { InfoDialog } from "@/components/InfoDialog";

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
  const [allDrones, setAllDrones] = useState<DroneProfile[]>([]);
  const [selectedInfo, setSelectedInfo] = useState<{ tip: ExpertTip; recommendation: DroneRecommendation | null } | null>(null);
  const [categoryAdvice, setCategoryAdvice] = useState<CategoryAdvice | null>(null);
  const [solarTimes, setSolarTimes] = useState<SolarTimes | null>(null);
  const [dronePreset, setDronePreset] = useState<DronePreset | null>(null);
  const [droneOwnedNdFilters, setDroneOwnedNdFilters] = useState<string[] | null>(null);
  const [droneVlosM, setDroneVlosM] = useState<number | null>(null);
  const [noGoOverride, setNoGoOverride] = useState<{ acknowledgedAt: string; reasons: string[]; originalStatus: "go" | "caution" | "nogo" } | null>(null);
  // Gegenprüfung der offiziellen Staatskarte (aus der Session geladen). "blocking"
  // hebt den Status auf mindestens "caution" an, ersetzt aber NICHT die
  // automatische Geozonen-/§21h-Erkennung.
  const [crossCheck, setCrossCheck] = useState<{ blocking: boolean; note?: string } | null>(null);
  // Prüfkette (B4): gespeicherte Befunde der Planung (Geozonen, Abdeckung,
  // NOTAM, Compliance) aus der Session; ohne gespeicherte Befunde Rückfall auf
  // hasRestrictions/restrictionStatus/restrictionVerdict/notamStatusUnknown.
  const [storedChecks, setStoredChecks] = useState<CheckResult[]>(() => storedChecksFor(null, "planning"));
  // Speichern erst, wenn die Session (inkl. Einschränkungs-Ergebnis) geladen ist.
  const [sessionLoaded, setSessionLoaded] = useState(false);
  // Geplante Endzeit aus der Session (Ende <= Start = Folgetag) – die
  // Nachtprüfung berücksichtigt damit das ganze Fenster.
  const [plannedEndTime, setPlannedEndTime] = useState<string | undefined>(undefined);

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
    fpvMode,
  } = route.params;

  const plannedDateTime = (() => {
    if (!plannedDate) return undefined;
    const d = new Date(plannedDate);
    if (plannedTime && /^\d{1,2}:\d{2}/.test(plannedTime)) {
      const [h, m] = plannedTime.split(":").map((x) => parseInt(x, 10));
      d.setHours(h, m, 0, 0);
    }
    return d;
  })();

  // Wetterdaten der Planung (Snapshot) für die Prüfkette.
  const weatherData = forecastWeather
    ? (() => {
        const emptyAlt = [{ height: 2, value: 0 }];
        return {
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
          // Teil A: Offline-Vorhersage zählt höchstens als CAUTION
          ...(forecastWeather.offline?.cached ? { offline: forecastWeather.offline } : {}),
        };
      })()
    : null;

  // EINE Bewertung (wie Pre-Check), Zeitbezug: geplanter Zeitpunkt.
  const evaluation = evaluateFlight({
    context: "planning",
    at: plannedDateTime,
    until: plannedDate && plannedTime && plannedEndTime
      ? computeFlightWindow(plannedDate, plannedTime.padStart(5, "0"), plannedEndTime)?.end ?? null
      : null,
    latitude,
    longitude,
    countryIso: route.params.countryIso,
    weather: weatherData,
    limits,
    maxAltitude,
    stored: storedChecks,
    officialMapCrossCheck: crossCheck,
    vlosM: droneVlosM,
  });
  // Darstellung: wirksame Befunde zuerst, dann Info-Befunde.
  const displayedChecks = sortChecks(evaluation.results);

  useEffect(() => {
    getDrone(droneId).then(drone => {
      if (drone) {
        setDroneName(drone.name);
        const advice = suggestCategory(drone, {
          isFpvFlight: isFpvFlight,
        });
        setCategoryAdvice(advice);
        const preset = findPresetForDrone(drone.name, drone.manufacturer, drone.model);
        setDronePreset(preset);
        setDroneOwnedNdFilters(drone.ownedNdFilters ?? null);
        const cd = typeof drone.charDimensionM === "number" && drone.charDimensionM > 0 ? drone.charDimensionM : preset?.charDimensionM;
        setDroneVlosM(cd && cd > 0 ? computeVlosM(cd, { kind: alosKindForDroneType(drone.droneType) }).vlosM : null);
      }
    });
    getDrones().then(setAllDrones).catch(() => setAllDrones([]));
    const planDate = plannedDate ? new Date(plannedDate) : new Date();
    setSolarTimes(calculateSolarTimes(latitude, longitude, planDate));
  }, [droneId, isFpvFlight, latitude, longitude, plannedDate]);

  useEffect(() => {
    getFlightSession(sessionId)
      .then((session) => {
        setCrossCheck(session?.planning?.officialMapCrossCheck ?? null);
        setPlannedEndTime(session?.planning?.plannedEndTime);
        setStoredChecks(
          storedChecksFor(
            session ? { ...session, notamStatusUnknown: session.planning?.notamStatusUnknown === true } : null,
            "planning",
          ),
        );
      })
      .catch(() => {})
      .finally(() => setSessionLoaded(true));
  }, [sessionId]);

  // Gesamturteil aus aggregate(): Flugverbot ohne Begründung, Nacht-Verbot,
  // Gewitter → NO-GO; Gegenprüfung "startverhindernd", NOTAM-/Geozonen-Status
  // unbekannt, Auflagen, Wetterhinweise → CAUTION.
  const effectiveStatus = evaluation.verdict;

  const handleSave = async () => {
    setSaving(true);
    try {
      // Bestehende Session laden, damit Felder wie radiusKm, flightPurpose, routeDescription etc.
      // aus früheren Schritten (PlanningDetailsScreen) erhalten bleiben.
      const existing = await getFlightSession(sessionId);
      await updateFlightSession(sessionId, {
        status: effectiveStatus,
        verdict: evaluation.verdict,
        checkResults: replaceCheckCategories(existing?.checkResults, evaluation.results, ALL_CHECK_CATEGORIES, "planning"),
        // Jeder wirksame Befund ist ein Grund (nogo bzw. caution) im Protokoll.
        reasons: sessionReasonsFromChecks(evaluation.results),
        planning: {
          ...(existing?.planning ?? {}),
          plannedDate,
          plannedTime,
          forecastWeather,
          maxAltitude,
          checklistCompleted,
          checklistPresented: checklistPresented || [],
          isFpvFlight: isFpvFlight || false,
          fpvMode: isFpvFlight ? (fpvMode ?? "spotter") : undefined,
          noGoOverride: noGoOverride ?? undefined,
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

  const handleReplan = () => {
    Haptics.selectionAsync();
    const nav = navigation as any;
    if (typeof nav.popTo === "function") {
      try {
        nav.popTo("PlanningDateTime");
        return;
      } catch {
        // Fallback weiter unten
      }
    }
    if (navigation.canGoBack()) navigation.goBack();
  };

  const handleOverride = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Trotz No-Go fliegen?",
      "Du übernimmst hiermit die volle Verantwortung. Diese Freigabe wird mit Zeitstempel und Gründen in deinem Flugprotokoll dokumentiert und ist im Logbuch sichtbar.\n\nWirklich fortfahren?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Ja, ich übernehme die Verantwortung",
          style: "destructive",
          onPress: () => {
            const reasons = evaluation.reasons
              .filter((r) => effectiveSeverity(r) === "nogo" || r.emphasis === "warning")
              .map((r) => r.title);
            setNoGoOverride({
              acknowledgedAt: new Date().toISOString(),
              reasons: reasons.length > 0 ? reasons : ["NO-GO bewusst übersteuert"],
              originalStatus: evaluation.verdict,
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
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
              <StatusBadge status={effectiveStatus} />
            </View>
            <DataStandLines testID="planning-result-data-stand" entries={[{ kind: "weather", origin: forecastWeather.offline ?? null }]} />
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

        {/* Prüfkette (B4): alle Befunde (Geozonen, Abdeckung, NOTAM, Nacht,
            Wetter, Gegenprüfung) mit Info-Dialog; Urteil aus aggregate(). */}
        <Card style={styles.weatherCard} testID="card-check-results">
          <View style={styles.weatherHeader}>
            <ThemedText style={styles.weatherTitle}>Prüfergebnis</ThemedText>
            <StatusBadge status={effectiveStatus} />
          </View>
          <View>
            {displayedChecks.map((check, index) => {
              const rec = check.exceedance
                ? recommendDroneForExceedance(check.exceedance, allDrones, droneId)
                : null;
              const tip: ExpertTip = check.tip ?? {
                title: "Erläuterung",
                description: check.detail || check.title,
              };
              const sev = effectiveSeverity(check);
              const dotColor = sev === "nogo" || check.emphasis === "warning"
                ? theme.statusNoGo
                : sev === "info"
                  ? theme.textTertiary
                  : theme.statusCaution;
              return (
                <View key={`${check.id}-${index}`} style={styles.warningItem} testID={`check-result-${check.id}`}>
                  <View style={styles.warningRow}>
                    <View style={[styles.warningDot, { backgroundColor: dotColor }]} />
                    <ThemedText style={[styles.warningText, { color: theme.textSecondary }]}>
                      {check.overriddenBy
                        ? `${check.title} (Begründung: ${check.overriddenBy.reason})`
                        : check.title}
                    </ThemedText>
                    <Pressable
                      onPress={() => setSelectedInfo({ tip, recommendation: rec })}
                      hitSlop={8}
                      style={styles.infoButton}
                      testID={`button-warning-info-${index}`}
                    >
                      <Feather name="info" size={18} color={theme.primary} />
                    </Pressable>
                  </View>
                  {rec ? (
                    <View style={styles.recRow}>
                      <Feather
                        name={rec.hasMatch ? "check-circle" : "shopping-bag"}
                        size={13}
                        color={rec.hasMatch ? theme.statusGo : theme.textTertiary}
                        style={styles.recIcon}
                      />
                      <ThemedText
                        style={[styles.recText, { color: rec.hasMatch ? theme.statusGo : theme.textTertiary }]}
                        testID={`text-warning-recommendation-${index}`}
                      >
                        {rec.message}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </Card>

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

        {plannedDateTime ? (() => {
          const sunElev = computeSunElevation(latitude, longitude, plannedDateTime);
          const isTwilight = sunElev < 0 && sunElev >= -6;
          const isNight = sunElev < -6;
          const aperture = dronePreset?.apertureValue ?? 2.8;
          const cloud = forecastWeather?.cloudCover ?? 30;
          const rain = forecastWeather?.rain ?? 0;
          const fps = 25;
          let nd: NdRecommendation | null = null;
          if (!isNight && !isTwilight) {
            const ev = estimateEv(cloud, rain, sunElev);
            const measuredDenom = snapShutterDenom(shutterDenomFromEv(ev, aperture));
            const ecosystem = (droneOwnedNdFilters && droneOwnedNdFilters.length > 0)
              ? droneOwnedNdFilters
              : (dronePreset?.filterEcosystem ?? null);
            nd = recommendNd({ fps, measuredShutterDenom: measuredDenom, filterEcosystem: ecosystem });
          }
          const pickLabel = nd?.ecosystemMismatch && nd.ecosystemPick
            ? `ND${nd.ecosystemPick}`
            : nd?.ndValue
              ? `ND${nd.ndValue}`
              : "Kein Filter";
          return (
            <Card style={[styles.ndCard, { borderLeftColor: theme.primary }]}>
              <View style={styles.ndHeader}>
                <Feather name="aperture" size={22} color={theme.primary} />
                <View style={styles.ndTitleWrap}>
                  <ThemedText style={styles.ndTitle}>ND-Filter Empfehlung</ThemedText>
                  <ThemedText style={[styles.ndSubtitle, { color: theme.textSecondary }]}>
                    Sonne {sunElev >= 0 ? `${sunElev.toFixed(0)}° über` : `${Math.abs(sunElev).toFixed(0)}° unter`} Horizont · {fps} fps · ƒ/{aperture.toFixed(1)}
                  </ThemedText>
                </View>
                {!isNight && !isTwilight ? (
                  <View style={[styles.ndPickBadge, { backgroundColor: theme.statusGoBackground }]}>
                    <ThemedText style={[styles.ndPickText, { color: theme.statusGo }]}>{pickLabel}</ThemedText>
                  </View>
                ) : null}
              </View>

              <View style={styles.solarArcRow}>
                <SunArcChart lat={latitude} lon={longitude} date={plannedDateTime} highlightTime={plannedDateTime} width={300} height={140} />
              </View>

              {isNight ? (
                <ThemedText style={[styles.ndReasoning, { color: theme.textSecondary }]}>
                  Sonne {Math.abs(sunElev).toFixed(0)}° unter dem Horizont — Nachtflug, kein ND-Filter sinnvoll. Bei Open-Kategorie zusätzlich Beleuchtung beachten.
                </ThemedText>
              ) : isTwilight ? (
                <ThemedText style={[styles.ndReasoning, { color: theme.textSecondary }]}>
                  Bürgerliche Dämmerung — Licht ändert sich schnell. ND-Filter meist nicht nötig; bei klarem Himmel max. ND4 zur Feinregelung.
                </ThemedText>
              ) : (
                <>
                  <ThemedText style={[styles.ndReasoning, { color: theme.text }]}>
                    {nd?.reasoning}
                  </ThemedText>
                  {nd?.ecosystemMismatch && nd.ecosystemPick && nd.ndValue !== nd.ecosystemPick ? (
                    <ThemedText style={[styles.ndHint, { color: theme.textTertiary }]}>
                      Ideal wäre ND{nd.ndValue}, mit deinem Filter-Set verfügbar ist ND{nd.ecosystemPick}.
                    </ThemedText>
                  ) : null}
                  <ThemedText style={[styles.ndHint, { color: theme.textTertiary }]}>
                    Schätzung nach Sunny-16 (Wolken {cloud.toFixed(0)}%, Regen {rain.toFixed(1)} mm/h). Vor Ort prüfen und ggf. anpassen.
                  </ThemedText>
                </>
              )}
            </Card>
          );
        })() : null}

        <Card style={[styles.infoCard, { borderLeftColor: theme.primary }]}>
          <Feather name="info" size={20} color={theme.primary} />
          <ThemedText style={[styles.infoText, { color: theme.textSecondary }]}>
            Am Flugtag kannst du den Pre-Flight Check direkt vor Ort durchführen. 
            Die Planung erscheint in deiner Briefing-Liste.
          </ThemedText>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        {evaluation.verdict === "nogo" && !noGoOverride && !saved ? (
          <View>
            <View style={[styles.nogoBanner, { backgroundColor: theme.statusNoGoBackground, borderColor: theme.statusNoGo }]}>
              <Feather name="alert-octagon" size={20} color={theme.statusNoGo} />
              <ThemedText style={[styles.nogoBannerText, { color: theme.statusNoGo }]}>
                NO-GO: Speichern erst nach Anpassung oder bewusster Übersteuerung möglich.
              </ThemedText>
            </View>
            <View style={styles.nogoActionsRow}>
              <View style={styles.nogoActionItem}>
                <Button title="Neu planen" onPress={handleReplan} variant="secondary" />
              </View>
              <View style={styles.nogoActionItem}>
                <Button title="Trotzdem durchführen" onPress={handleOverride} />
              </View>
            </View>
          </View>
        ) : saved ? (
          <Button title="Fertig" onPress={handleDone} />
        ) : (
          <>
            {noGoOverride ? (
              <View style={[styles.overrideNote, { backgroundColor: theme.statusCautionBackground, borderColor: theme.statusCaution }]}>
                <Feather name="alert-triangle" size={16} color={theme.statusCaution} />
                <ThemedText style={[styles.overrideNoteText, { color: theme.statusCaution }]}>
                  NO-GO übersteuert — Freigabe wird im Protokoll dokumentiert.
                </ThemedText>
              </View>
            ) : null}
            <Button
              title={saving ? "Speichern..." : "Planung speichern"}
              onPress={handleSave}
              disabled={saving || !sessionLoaded}
            />
          </>
        )}
      </View>

      <InfoDialog
        visible={selectedInfo !== null}
        onClose={() => setSelectedInfo(null)}
        title={selectedInfo?.tip.title || "Erläuterung"}
        icon="book-open"
        okLabel="Verstanden"
        testID="tip-info-dialog"
        sections={selectedInfo ? [
          { body: selectedInfo.tip.description ?? "" },
          ...(selectedInfo.tip.practiceCheck ? [{
            weight: selectedInfo.tip.practiceCheck.length,
            body: (
              <View style={styles.practiceCheckBox}>
                <View style={styles.practiceCheckHeader}>
                  <Feather name="eye" size={16} color={theme.statusCaution} />
                  <ThemedText style={[styles.practiceCheckTitle, { color: theme.statusCaution }]}>
                    Praxis-Check
                  </ThemedText>
                </View>
                <ThemedText style={[styles.practiceCheckText, { color: theme.textSecondary }]}>
                  {selectedInfo.tip.practiceCheck}
                </ThemedText>
              </View>
            ),
          }] : []),
          ...(selectedInfo.recommendation ? [{
            weight: selectedInfo.recommendation.message.length,
            body: (
              <View
                style={[
                  styles.recommendBox,
                  {
                    backgroundColor: selectedInfo.recommendation.hasMatch
                      ? theme.statusGoBackground
                      : theme.backgroundDefault,
                  },
                ]}
              >
                <View style={styles.practiceCheckHeader}>
                  <Feather
                    name={selectedInfo.recommendation.hasMatch ? "check-circle" : "shopping-bag"}
                    size={16}
                    color={selectedInfo.recommendation.hasMatch ? theme.statusGo : theme.textSecondary}
                  />
                  <ThemedText
                    style={[
                      styles.practiceCheckTitle,
                      { color: selectedInfo.recommendation.hasMatch ? theme.statusGo : theme.textSecondary },
                    ]}
                  >
                    {selectedInfo.recommendation.hasMatch ? "Passende Drohne" : "Empfehlung"}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.practiceCheckText, { color: theme.textSecondary }]}>
                  {selectedInfo.recommendation.message}
                </ThemedText>
              </View>
            ),
          }] : []),
        ] : []}
      />
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
  nogoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  nogoBannerText: {
    ...Typography.caption,
    flex: 1,
    fontWeight: "600",
  },
  nogoActionsRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  nogoActionItem: {
    flex: 1,
  },
  overrideNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  overrideNoteText: {
    ...Typography.caption,
    flex: 1,
    fontWeight: "500",
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
  warningItem: {
    marginBottom: Spacing.sm,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
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
  infoButton: {
    paddingHorizontal: 2,
    marginTop: -1,
  },
  recRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    marginTop: 4,
    marginLeft: 8 + Spacing.sm,
  },
  recIcon: {
    marginTop: 2,
  },
  recText: {
    ...Typography.caption,
    flex: 1,
    fontWeight: "600",
  },
  practiceCheckBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  practiceCheckHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  practiceCheckTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  practiceCheckText: {
    ...Typography.body,
    lineHeight: 22,
  },
  recommendBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
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
  ndCard: {
    padding: Spacing.lg,
    borderLeftWidth: 3,
    marginBottom: Spacing.lg,
  },
  ndHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  ndTitleWrap: {
    flex: 1,
  },
  ndTitle: {
    ...Typography.h4,
    fontWeight: "700",
  },
  ndSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  ndPickBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  ndPickText: {
    fontSize: 14,
    fontWeight: "800",
  },
  solarArcRow: {
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  ndReasoning: {
    ...Typography.small,
    lineHeight: 20,
  },
  ndHint: {
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
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
