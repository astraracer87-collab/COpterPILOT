import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, ScrollView, Alert, Modal, Pressable } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { createFlightSession, updateFlightSession, FlightSession, getFlightSession, getSettings, getDrones, DroneProfile, SavedGeozoneFeature, SavedDipulRestriction, CtrWeatherSnapshot } from "@/lib/storage";
import { startRecording as startTrafficRecording } from "@/lib/trafficRecorder";
import type { ExpertTip } from "@/lib/assessment";
import { evaluateFlight, storedChecksFor, type FlightEvaluation } from "@/lib/flightChecks";
import { ALL_CHECK_CATEGORIES, effectiveSeverity, replaceCheckCategories, sessionReasonsFromChecks } from "../../shared/checks";
import { recommendDroneForExceedance } from "@/lib/droneRecommendation";
import { fetchNearestAirportMetar, fetchCtrAirportMetar } from "@/lib/aviationWeather";
import { findCtrForLocation, getCtrDistanceKm, assessCtrVmc } from "@/lib/ctrData";
import { computeVlosM, alosKindForDroneType, formatMeters } from "@/lib/vlos";
import { findPresetForDrone } from "@/lib/dronePresets";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type RouteParams = RouteProp<FlightCheckParamList, "Results">;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ResultsScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // Prüfkette (B4): Ergebnis von evaluateFlight (Kontext "precheck").
  const [assessment, setAssessment] = useState<FlightEvaluation | null>(null);
  const [saving, setSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [selectedTip, setSelectedTip] = useState<ExpertTip | null>(null);
  const [allDrones, setAllDrones] = useState<DroneProfile[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [sessionGeozones, setSessionGeozones] = useState<SavedGeozoneFeature[]>([]);
  const [sessionDipul, setSessionDipul] = useState<SavedDipulRestriction[]>([]);
  const [ctrWeather, setCtrWeather] = useState<CtrWeatherSnapshot | null>(null);
  const [ctrLoading, setCtrLoading] = useState(false);

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, restrictionVerdict, weatherData, droneId, limits, sessionId, checklistCompleted, checklistPresented, batteryUsage, isFpvFlight, fpvMode, kpIndex, kpOfflineFetchedAt } = route.params;

  // VLOS-Distanz aus der charakteristischen Dimension (CD) der geprüften Drohne.
  // CD kommt bevorzugt vom Drohnen-Profil, sonst aus dem passenden Preset.
  const vlos = useMemo(() => {
    const drone = allDrones.find((d) => d.id === droneId);
    if (!drone) return null;
    let cd = typeof drone.charDimensionM === "number" && drone.charDimensionM > 0
      ? drone.charDimensionM
      : undefined;
    if (cd == null) {
      const preset = findPresetForDrone(drone.name, drone.manufacturer, drone.model);
      if (preset?.charDimensionM) cd = preset.charDimensionM;
    }
    if (cd == null || cd <= 0) return null;
    return computeVlosM(cd, { kind: alosKindForDroneType(drone.droneType) });
  }, [allDrones, droneId]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getFlightSession(sessionId);
        if (cancelled || !s) return;
        setSessionGeozones(s.savedGeozoneFeatures || []);
        setSessionDipul(s.savedDipulRestrictions || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    getDrones()
      .then((d) => { if (!cancelled) setAllDrones(d); })
      .catch(() => { if (!cancelled) setAllDrones([]); });
    return () => { cancelled = true; };
  }, []);

  // CTR-Wetternachweis: Liegt der Flugstandort in einer Kontrollzone, wird die
  // METAR des zuständigen CTR-Flughafens geholt und gegen die VMC-Bedingungen der
  // Allgemeinverfügung geprüft. Nicht-CTR-Flüge bleiben unverändert (kein Abruf).
  useEffect(() => {
    let cancelled = false;
    const ctr = findCtrForLocation(latitude, longitude);
    if (!ctr || !ctr.avInfo) {
      setCtrWeather(null);
      return;
    }
    const avInfo = ctr.avInfo;
    const distanceKm = getCtrDistanceKm(latitude, longitude, ctr);
    setCtrLoading(true);
    (async () => {
      let metar = null;
      try {
        metar = await fetchCtrAirportMetar(ctr.icao, ctr.name, distanceKm);
      } catch {}
      if (cancelled) return;
      const vmc = metar
        ? assessCtrVmc({ visibilityM: metar.visibilityM, ceilingFt: metar.ceilingFt }, avInfo)
        : null;
      setCtrWeather({
        icao: ctr.icao,
        airportName: ctr.name,
        ctrName: ctr.name,
        distanceKm: Math.round(distanceKm * 10) / 10,
        observedAt: metar?.observedAt ?? null,
        raw: metar?.raw ?? "",
        visibilityM: metar?.visibilityM ?? null,
        ceilingFt: metar?.ceilingFt ?? null,
        phenomenaText: metar?.phenomenaText ?? null,
        model: avInfo.model,
        minVisibilityKm: avInfo.minVisibilityKm,
        minCeilingFt: avInfo.model === "legacy50m" ? avInfo.minCeilingFt ?? null : null,
        vmcCompliant: vmc ? vmc.compliant : null,
        vmcReasons: vmc ? vmc.reasons : [],
        avReference: ctr.avReference,
        avProvider: avInfo.provider,
        metarAvailable: !!metar,
      });
      setCtrLoading(false);
    })();
    return () => { cancelled = true; };
  }, [latitude, longitude]);

  const runAssessment = useCallback(async () => {
    // Gespeicherte Pre-Check-Befunde (PreCheckOverview: Geozonen, Abdeckung,
    // NOTAM). Ohne Session/Befunde Rückfall auf die Route-Params.
    let session: FlightSession | null = null;
    if (sessionId) {
      try {
        session = await getFlightSession(sessionId);
      } catch {}
    }
    // Flugplatz-METAR (nächster Verkehrsflughafen) für die Bewertung holen.
    // Schlägt der Abruf fehl oder ist kein Flughafen in der Nähe, läuft die
    // Bewertung ohne Flugplatzdaten weiter (graceful fallback).
    let airportMetar = null;
    try {
      airportMetar = await fetchNearestAirportMetar(latitude, longitude);
    } catch {}

    // EINE Bewertung (wie Planung). Zeitbezug Pre-Check: Nacht JETZT (Start
    // vor Ort), Zonenaktivität jetzt ODER geplant (PreCheckOverview).
    const result = evaluateFlight({
      context: "precheck",
      at: new Date(),
      latitude,
      longitude,
      countryIso: session?.countryIso,
      weather: weatherData,
      limits,
      kpIndex,
      kpOfflineFetchedAt,
      airportMetar,
      stored: storedChecksFor(
        { checkResults: session?.checkResults, hasRestrictions, restrictionStatus, restrictionVerdict },
        "precheck",
      ),
      officialMapCrossCheck: session?.planning?.officialMapCrossCheck,
    });
    setAssessment(result);

    if (result.verdict === "go") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [weatherData, limits, hasRestrictions, restrictionStatus, restrictionVerdict, kpIndex, kpOfflineFetchedAt, latitude, longitude, sessionId]);

  useEffect(() => {
    runAssessment();
  }, [runAssessment]);

  const handleSave = async () => {
    if (!assessment) return;
    
    if (assessment.requiresConfirmation && !confirmed) {
      setShowConfirmation(true);
      return;
    }
    
    setSaving(true);
    try {
      const weatherSnapshot = {
        temperature: weatherData.forecasts[0].temperature,
        windSpeed: weatherData.forecasts[0].windSpeed,
        windGust: weatherData.forecasts[0].windGust,
        rain: weatherData.forecasts[0].rain,
        cloudCover: weatherData.forecasts[0].cloudCover,
        humidity: weatherData.forecasts[0].humidity,
        kpIndex: kpIndex,
      };
      
      if (sessionId) {
        const existingSession = await getFlightSession(sessionId);
        await updateFlightSession(sessionId, {
          currentPhase: "hover",
          status: assessment.verdict,
          verdict: assessment.verdict,
          reasons: sessionReasonsFromChecks(assessment.results),
          checkResults: replaceCheckCategories(existingSession?.checkResults, assessment.results, ALL_CHECK_CATEGORIES, "precheck"),
          planning: {
            ...existingSession?.planning,
            plannedDate: existingSession?.planning?.plannedDate || new Date().toISOString().split("T")[0],
            plannedTime: existingSession?.planning?.plannedTime || new Date().toTimeString().slice(0, 5),
            checklistCompleted: existingSession?.planning?.checklistCompleted || [],
            isFpvFlight: isFpvFlight ?? existingSession?.planning?.isFpvFlight ?? false,
            fpvMode: (isFpvFlight ?? existingSession?.planning?.isFpvFlight)
              ? (fpvMode ?? existingSession?.planning?.fpvMode ?? "spotter")
              : undefined,
          },
          preflight: {
            actualWeather: weatherSnapshot,
            checklistCompleted: checklistCompleted || [],
            checklistPresented: checklistPresented || [],
            completedAt: new Date().toISOString(),
            batteryUsage: batteryUsage && batteryUsage.length > 0 ? batteryUsage : undefined,
            ctrWeather: ctrWeather ?? undefined,
          },
        });
      } else {
        await createFlightSession({
          droneId,
          currentPhase: "hover",
          latitude,
          longitude,
          hasRestrictions,
          restrictionNotes,
          restrictionStatus,
          restrictionVerdict,
          status: assessment.verdict,
          verdict: assessment.verdict,
          reasons: sessionReasonsFromChecks(assessment.results),
          checkResults: assessment.results,
          planning: {
            plannedDate: new Date().toISOString().split("T")[0],
            plannedTime: new Date().toTimeString().slice(0, 5),
            checklistCompleted: [],
            isFpvFlight: isFpvFlight ?? false,
          },
          preflight: {
            actualWeather: weatherSnapshot,
            checklistCompleted: checklistCompleted || [],
            checklistPresented: checklistPresented || [],
            completedAt: new Date().toISOString(),
            batteryUsage: batteryUsage && batteryUsage.length > 0 ? batteryUsage : undefined,
            ctrWeather: ctrWeather ?? undefined,
          },
        });
      }
      
      try {
        const settings = await getSettings();
        const approachRadiusM = settings.proximityAlarm?.approachRadiusM ?? 1000;
        startTrafficRecording(latitude, longitude, approachRadiusM, approachRadiusM * 3);
      } catch {}

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.getParent()?.goBack();
    } catch (error) {
      Alert.alert("Fehler", "Briefing konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmProceed = () => {
    setConfirmed(true);
    setShowConfirmation(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const getStatusConfig = () => {
    if (!assessment) return null;
    if (assessment.verdict === "go") {
      return {
        icon: "check-circle" as const,
        title: "GO",
        subtitle: "Flug empfohlen",
        color: theme.statusGo,
        background: theme.statusGoBackground,
      };
    }
    if (assessment.requiresConfirmation && !confirmed) {
      return {
        icon: "alert-triangle" as const,
        title: "WARNUNG",
        subtitle: "Flug nicht empfohlen",
        color: theme.statusNoGo,
        background: theme.statusNoGoBackground,
      };
    }
    return {
      icon: "alert-triangle" as const,
      title: "CAUTION",
      subtitle: "Mit Vorsicht fliegen",
      color: theme.statusCaution,
      background: theme.statusCautionBackground,
    };
  };

  const config = getStatusConfig();

  // Gründe aus der Prüfkette: erhebliche (rot: NO-GO bzw. Warnung) und Hinweise.
  const isSevere = (r: FlightEvaluation["reasons"][number]) =>
    effectiveSeverity(r) === "nogo" || r.emphasis === "warning";
  const severeWarnings = (assessment?.reasons ?? []).filter(isSevere);
  const cautionWarnings = (assessment?.reasons ?? []).filter((r) => !isSevere(r));

  if (!assessment || !config) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ThemedText style={{ color: theme.textSecondary }}>Bewertung läuft...</ThemedText>
        </View>
      </ThemedView>
    );
  }

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
        <Animated.View entering={ZoomIn.duration(400)} style={styles.statusContainer}>
          <View style={[styles.statusCard, { backgroundColor: config.background }]}>
            <Feather name={config.icon} size={64} color={config.color} />
            <ThemedText style={[styles.statusTitle, { color: config.color }]}>
              {config.title}
            </ThemedText>
            <ThemedText style={[styles.statusSubtitle, { color: theme.textSecondary }]}>
              {config.subtitle}
            </ThemedText>
          </View>
        </Animated.View>

        {severeWarnings.length > 0 ? (
          <Animated.View entering={FadeIn.delay(200).duration(300)}>
            <ThemedText style={[styles.sectionTitle, { color: theme.statusNoGo }]}>
              WARNUNGEN
            </ThemedText>
            {severeWarnings.map((warning, index) => {
              const rec = warning.exceedance
                ? recommendDroneForExceedance(warning.exceedance, allDrones, droneId)
                : null;
              return (
                <Card key={index} style={[styles.warningCard, { borderLeftColor: theme.statusNoGo }]}>
                  <View style={styles.warningHeader}>
                    <Feather name="alert-octagon" size={18} color={theme.statusNoGo} />
                    <ThemedText style={[styles.warningText, { flex: 1 }]}>{warning.overriddenBy ? `${warning.title} (Begründung: ${warning.overriddenBy.reason})` : warning.title}</ThemedText>
                  </View>
                  {rec ? (
                    <View style={styles.recRow}>
                      <Feather
                        name={rec.hasMatch ? "check-circle" : "shopping-bag"}
                        size={14}
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
                  {warning.tip ? (
                    <Pressable
                      style={[styles.tipButton, { backgroundColor: theme.backgroundSecondary }]}
                      onPress={() => setSelectedTip(warning.tip!)}
                    >
                      <Feather name="help-circle" size={14} color={theme.primary} />
                      <ThemedText style={[styles.tipButtonText, { color: theme.primary }]}>
                        Experten-Tipps anzeigen
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </Card>
              );
            })}
          </Animated.View>
        ) : null}

        {cautionWarnings.length > 0 ? (
          <Animated.View entering={FadeIn.delay(300).duration(300)}>
            <ThemedText style={[styles.sectionTitle, { color: theme.statusCaution }]}>
              HINWEISE
            </ThemedText>
            {cautionWarnings.map((warning, index) => {
              const isRestrictionWarning = warning.id === "geozone:status";
              return (
                <Card key={index} style={[styles.cautionCard, { borderLeftColor: theme.statusCaution }]}>
                  <View style={styles.warningHeader}>
                    <Feather name="alert-triangle" size={16} color={theme.statusCaution} />
                    <ThemedText style={[styles.warningText, { flex: 1 }]}>{warning.overriddenBy ? `${warning.title} (Begründung: ${warning.overriddenBy.reason})` : warning.title}</ThemedText>
                  </View>
                  {isRestrictionWarning ? (
                    <View style={[styles.restrictionDetails, { borderTopColor: theme.border }]}>
                      <ThemedText style={[styles.restrictionLabel, { color: theme.textSecondary }]}>
                        {restrictionStatus === "approved" ? "Status: Mit Einschränkungen genehmigt" : "Status: Flug mit Auflagen"}
                      </ThemedText>
                      {sessionGeozones.length > 0 || sessionDipul.length > 0 ? (
                        <View style={styles.zonesList}>
                          <ThemedText style={[styles.zonesHeader, { color: theme.text }]}>
                            Geozonen im Flugbereich ({sessionGeozones.length + sessionDipul.length}):
                          </ThemedText>
                          {sessionDipul.map((dr, i) => (
                            <View key={`dipul-${i}`} style={styles.zoneRow}>
                              <Feather name="shield" size={12} color={theme.statusCaution} style={styles.zoneIcon} />
                              <ThemedText style={[styles.zoneText, { color: theme.text }]}>
                                {dr.name}
                                {dr.legalRef ? <ThemedText style={[styles.zoneMeta, { color: theme.textSecondary }]}> · {dr.legalRef}</ThemedText> : null}
                              </ThemedText>
                            </View>
                          ))}
                          {sessionGeozones.map((gz, i) => (
                            <View key={`gz-${i}`} style={styles.zoneRow}>
                              <Feather name="map-pin" size={12} color={theme.statusCaution} style={styles.zoneIcon} />
                              <ThemedText style={[styles.zoneText, { color: theme.text }]}>
                                {gz.name}
                                <ThemedText style={[styles.zoneMeta, { color: theme.textSecondary }]}> · {gz.layerLabel}</ThemedText>
                              </ThemedText>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {restrictionNotes && restrictionNotes.trim() ? (
                        <ThemedText style={[styles.restrictionNotes, { color: theme.text }]}>
                          {restrictionNotes.trim()}
                        </ThemedText>
                      ) : sessionGeozones.length === 0 && sessionDipul.length === 0 ? (
                        <ThemedText style={[styles.restrictionNotesEmpty, { color: theme.textTertiary }]}>
                          Keine Notizen hinterlegt — im Schritt „Einschränkungen" konkrete Auflagen oder Genehmigungs-Aktenzeichen vermerken, damit später nachvollziehbar ist, warum dieser Flug als CAUTION eingestuft wurde.
                        </ThemedText>
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </Animated.View>
        ) : null}

        {assessment.verdict === "go" ? (
          <Animated.View entering={FadeIn.delay(300).duration(300)}>
            <Card style={[styles.successCard, { borderLeftColor: theme.statusGo }]}>
              <View style={styles.warningHeader}>
                <Feather name="check" size={18} color={theme.statusGo} />
                <ThemedText style={styles.warningText}>
                  Alle Wetterbedingungen innerhalb der Limits
                </ThemedText>
              </View>
            </Card>
          </Animated.View>
        ) : null}

        {ctrWeather ? (() => {
          const vmcColor = ctrWeather.vmcCompliant === true
            ? theme.statusGo
            : ctrWeather.vmcCompliant === false
              ? theme.statusNoGo
              : theme.statusCaution;
          const vmcLabel = ctrWeather.vmcCompliant === true
            ? "VMC-Bedingungen erfüllt"
            : ctrWeather.vmcCompliant === false
              ? "VMC-Bedingungen nicht erfüllt"
              : "VMC nicht verifizierbar";
          const vmcIcon = ctrWeather.vmcCompliant === true
            ? "check-circle" as const
            : ctrWeather.vmcCompliant === false
              ? "alert-octagon" as const
              : "help-circle" as const;
          return (
            <Animated.View entering={FadeIn.delay(400).duration(300)}>
              <Card style={[styles.ctrWeatherCard, { borderLeftColor: vmcColor }]}>
                <View style={styles.ctrWeatherHeader}>
                  <Feather name="navigation" size={16} color="#FF9500" />
                  <ThemedText style={[styles.ctrWeatherTitle, { color: theme.text }]}>
                    CTR-Wetternachweis
                  </ThemedText>
                </View>
                <ThemedText style={[styles.ctrWeatherAirport, { color: theme.textSecondary }]} testID="text-ctr-airport">
                  {ctrWeather.airportName} ({ctrWeather.icao}) · {ctrWeather.distanceKm.toFixed(1)} km
                </ThemedText>
                {ctrLoading ? (
                  <ThemedText style={[styles.ctrWeatherNote, { color: theme.textTertiary }]}>
                    METAR wird geladen…
                  </ThemedText>
                ) : ctrWeather.metarAvailable ? (
                  <>
                    <View style={[styles.ctrVmcBadge, { backgroundColor: vmcColor + "1A", borderColor: vmcColor + "40" }]}>
                      <Feather name={vmcIcon} size={14} color={vmcColor} />
                      <ThemedText style={[styles.ctrVmcText, { color: vmcColor }]} testID="status-ctr-vmc">
                        {vmcLabel}
                      </ThemedText>
                    </View>
                    <View style={styles.ctrWeatherRow}>
                      <ThemedText style={[styles.ctrWeatherLabel, { color: theme.textSecondary }]}>Mindestsicht (AV)</ThemedText>
                      <ThemedText style={[styles.ctrWeatherValue, { color: theme.text }]}>
                        {ctrWeather.minVisibilityKm < 1 ? `${Math.round(ctrWeather.minVisibilityKm * 1000)} m` : `${ctrWeather.minVisibilityKm} km`}
                      </ThemedText>
                    </View>
                    <View style={styles.ctrWeatherRow}>
                      <ThemedText style={[styles.ctrWeatherLabel, { color: theme.textSecondary }]}>Gemeldete Sicht</ThemedText>
                      <ThemedText style={[styles.ctrWeatherValue, { color: theme.text }]}>
                        {ctrWeather.visibilityM != null ? (ctrWeather.visibilityM >= 1000 ? `${(ctrWeather.visibilityM / 1000).toFixed(1)} km` : `${ctrWeather.visibilityM} m`) : "—"}
                      </ThemedText>
                    </View>
                    {ctrWeather.minCeilingFt != null ? (
                      <>
                        <View style={styles.ctrWeatherRow}>
                          <ThemedText style={[styles.ctrWeatherLabel, { color: theme.textSecondary }]}>Mind. Wolkenuntergrenze</ThemedText>
                          <ThemedText style={[styles.ctrWeatherValue, { color: theme.text }]}>{ctrWeather.minCeilingFt} ft</ThemedText>
                        </View>
                        <View style={styles.ctrWeatherRow}>
                          <ThemedText style={[styles.ctrWeatherLabel, { color: theme.textSecondary }]}>Gemeldete Untergrenze</ThemedText>
                          <ThemedText style={[styles.ctrWeatherValue, { color: theme.text }]}>
                            {ctrWeather.ceilingFt != null ? `${ctrWeather.ceilingFt} ft` : "keine (BKN/OVC) gemeldet"}
                          </ThemedText>
                        </View>
                      </>
                    ) : null}
                    {ctrWeather.phenomenaText ? (
                      <View style={styles.ctrWeatherRow}>
                        <ThemedText style={[styles.ctrWeatherLabel, { color: theme.textSecondary }]}>Wetter</ThemedText>
                        <ThemedText style={[styles.ctrWeatherValue, { color: theme.text, flex: 1, textAlign: "right" }]}>{ctrWeather.phenomenaText}</ThemedText>
                      </View>
                    ) : null}
                    {ctrWeather.vmcReasons && ctrWeather.vmcReasons.length > 0 ? (
                      <View style={styles.ctrReasons}>
                        {ctrWeather.vmcReasons.map((r, i) => (
                          <View key={i} style={styles.ctrReasonRow}>
                            <ThemedText style={{ color: theme.textTertiary, fontSize: 11, lineHeight: 16 }}>{"\u2022"}</ThemedText>
                            <ThemedText style={{ color: theme.textTertiary, fontSize: 11, lineHeight: 16, flex: 1 }}>{r}</ThemedText>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {ctrWeather.raw ? (
                      <ThemedText style={[styles.ctrMetarRaw, { color: theme.textTertiary, backgroundColor: theme.backgroundSecondary }]} testID="text-ctr-metar">
                        {ctrWeather.raw}
                      </ThemedText>
                    ) : null}
                    {ctrWeather.avReference ? (
                      <ThemedText style={[styles.ctrWeatherNote, { color: theme.textTertiary }]}>
                        VMC-Bedingungen nach {ctrWeather.avReference}
                      </ThemedText>
                    ) : null}
                  </>
                ) : (
                  <ThemedText style={[styles.ctrWeatherNote, { color: theme.statusCaution }]}>
                    Keine METAR für {ctrWeather.icao} verfügbar — Sicht/Wolken vor dem Flug manuell beim Tower prüfen.
                  </ThemedText>
                )}
              </Card>
            </Animated.View>
          );
        })() : null}

        {vlos ? (
          <Animated.View entering={FadeIn.delay(450).duration(300)}>
            <Card style={[styles.vlosCard, { borderLeftColor: theme.statusGo }]}>
              <View style={styles.vlosHeader}>
                <Feather name="eye" size={16} color={theme.statusGo} />
                <ThemedText style={[styles.vlosTitle, { color: theme.text }]}>
                  VLOS-Sichtweite
                </ThemedText>
              </View>
              <View style={[styles.vlosMainBox, { backgroundColor: theme.statusGo + "14" }]}>
                <ThemedText style={[styles.vlosMainLabel, { color: theme.textSecondary }]}>
                  Max. Entfernung (VLOS-Grenze)
                </ThemedText>
                <ThemedText style={[styles.vlosMainValue, { color: theme.statusGo }]} testID="text-vlos-distance">
                  {formatMeters(vlos.vlosM)}
                </ThemedText>
              </View>
              <View style={styles.vlosRow}>
                <View style={styles.vlosCell}>
                  <ThemedText style={[styles.vlosCellLabel, { color: theme.textSecondary }]}>ALOS</ThemedText>
                  <ThemedText
                    style={[styles.vlosCellValue, { color: vlos.limitedBy === "alos" ? theme.primary : theme.text }]}
                    testID="text-vlos-alos"
                  >
                    {formatMeters(vlos.alosM)}
                  </ThemedText>
                </View>
                <View style={[styles.vlosCell, styles.vlosCellRight, { borderLeftColor: theme.border }]}>
                  <ThemedText style={[styles.vlosCellLabel, { color: theme.textSecondary }]}>DLOS</ThemedText>
                  <ThemedText
                    style={[styles.vlosCellValue, { color: vlos.limitedBy === "dlos" ? theme.primary : theme.text }]}
                    testID="text-vlos-dlos"
                  >
                    {formatMeters(vlos.dlosM)}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={[styles.vlosNote, { color: theme.textTertiary }]}>
                Die Drohne muss jederzeit ohne Hilfsmittel sichtbar bleiben.
              </ThemedText>
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeIn.delay(500).duration(300)}>
          <Card style={[styles.noteCard, { borderLeftColor: theme.primary }]}>
            <View style={styles.noteHeader}>
              <Feather name="info" size={16} color={theme.primary} />
              <ThemedText style={[styles.noteTitle, { color: theme.primary }]}>Hinweis</ThemedText>
            </View>
            <ThemedText style={[styles.noteText, { color: theme.textSecondary }]}>
              Diese Bewertung basiert auf Wetterdaten. Geozonen und Regeln bleiben maßgeblich.
              Die endgültige Entscheidung liegt beim Piloten.
            </ThemedText>
          </Card>
        </Animated.View>

        <View style={styles.buttonRow}>
          {assessment.requiresConfirmation && !confirmed ? (
            <>
              <Button
                title="Flug abbrechen"
                onPress={() => navigation.navigate("Main")}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                title="Trotzdem fortfahren"
                onPress={() => setShowConfirmation(true)}
                style={{ flex: 1, backgroundColor: theme.statusCaution }}
              />
            </>
          ) : (
            <Button
              title="Briefing speichern"
              onPress={handleSave}
              loading={saving}
            />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showConfirmation}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmation(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={[styles.modalHeader, { backgroundColor: theme.statusNoGoBackground }]}>
              <Feather name="alert-triangle" size={32} color={theme.statusNoGo} />
              <ThemedText style={[styles.modalTitle, { color: theme.statusNoGo }]}>
                Flug nicht empfohlen
              </ThemedText>
            </View>
            
            <View style={styles.modalBody}>
              <ThemedText style={[styles.modalText, { color: theme.textSecondary }]}>
                Die aktuellen Bedingungen übersteigen die empfohlenen Grenzwerte. 
                Ein Flug birgt erhöhte Risiken.
              </ThemedText>
              
              <ThemedText style={[styles.modalQuestion, { color: theme.text }]}>
                Möchtest du trotzdem fortfahren?
              </ThemedText>
              
              {severeWarnings.some(w => w.tip) ? (
                <ThemedText style={[styles.modalHint, { color: theme.textTertiary }]}>
                  Tipp: Schau dir die Experten-Tipps an, um zu wissen worauf du achten musst.
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.modalButtons}>
              <Button
                title="Abbrechen"
                onPress={() => setShowConfirmation(false)}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                title="Ja, fortfahren"
                onPress={handleConfirmProceed}
                style={{ flex: 1, backgroundColor: theme.statusNoGo }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={selectedTip !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedTip(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.tipModalContent, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.tipModalHeader}>
              <Feather name="book-open" size={24} color={theme.primary} />
              <ThemedText style={[styles.tipModalTitle, { color: theme.primary }]}>
                {selectedTip?.title || "Experten-Tipp"}
              </ThemedText>
              <Pressable onPress={() => setSelectedTip(null)} style={styles.closeButton}>
                <Feather name="x" size={24} color={theme.textSecondary} />
              </Pressable>
            </View>
            
            <ScrollView style={styles.tipModalBody}>
              <ThemedText style={styles.tipDescription}>
                {selectedTip?.description}
              </ThemedText>
              
              {selectedTip?.practiceCheck ? (
                <View style={styles.practiceCheckBox}>
                  <View style={styles.practiceCheckHeader}>
                    <Feather name="eye" size={16} color={theme.statusCaution} />
                    <ThemedText style={[styles.practiceCheckTitle, { color: theme.statusCaution }]}>
                      Praxis-Check
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.practiceCheckText, { color: theme.textSecondary }]}>
                    {selectedTip.practiceCheck}
                  </ThemedText>
                </View>
              ) : null}
            </ScrollView>
            
            <View style={styles.tipModalFooter}>
              <Button
                title="Verstanden"
                onPress={() => setSelectedTip(null)}
              />
            </View>
          </View>
        </View>
      </Modal>
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
  statusContainer: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  statusCard: {
    width: "100%",
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.lg,
  },
  statusTitle: {
    fontSize: 36,
    fontWeight: "800",
    marginTop: Spacing.lg,
    letterSpacing: 2,
  },
  statusSubtitle: {
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  warningCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 4,
  },
  cautionCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
  },
  restrictionDetails: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  restrictionLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  restrictionNotes: {
    ...Typography.body,
    lineHeight: 20,
  },
  restrictionNotesEmpty: {
    ...Typography.small,
    fontStyle: "italic",
    lineHeight: 18,
  },
  zonesList: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  zonesHeader: {
    ...Typography.small,
    fontWeight: "600",
    marginBottom: 2,
  },
  zoneRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  zoneIcon: {
    marginTop: 3,
  },
  zoneText: {
    ...Typography.small,
    flex: 1,
    lineHeight: 18,
  },
  zoneMeta: {
    ...Typography.small,
    fontSize: 11,
  },
  successCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
  },
  warningHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  warningText: {
    ...Typography.body,
  },
  recRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  recIcon: {
    marginTop: 2,
  },
  recText: {
    ...Typography.small,
    flex: 1,
    fontWeight: "600",
  },
  tipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignSelf: "flex-start",
  },
  tipButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  ctrWeatherCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
  },
  ctrWeatherHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  ctrWeatherTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  ctrWeatherAirport: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  ctrVmcBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  ctrVmcText: {
    ...Typography.small,
    fontWeight: "700",
  },
  ctrWeatherRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
    gap: Spacing.md,
  },
  ctrWeatherLabel: {
    ...Typography.small,
  },
  ctrWeatherValue: {
    ...Typography.small,
    fontWeight: "600",
  },
  ctrReasons: {
    marginTop: Spacing.sm,
    gap: 2,
  },
  ctrReasonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
  },
  ctrMetarRaw: {
    fontFamily: "Courier",
    fontSize: 11,
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  ctrWeatherNote: {
    ...Typography.small,
    marginTop: Spacing.sm,
  },
  vlosCard: {
    padding: Spacing.lg,
    borderLeftWidth: 3,
    marginTop: Spacing.lg,
  },
  vlosHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  vlosTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  vlosMainBox: {
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  vlosMainLabel: {
    ...Typography.small,
    marginBottom: 2,
  },
  vlosMainValue: {
    fontSize: 30,
    fontWeight: "800",
  },
  vlosRow: {
    flexDirection: "row",
    marginBottom: Spacing.sm,
  },
  vlosCell: {
    flex: 1,
    alignItems: "center",
  },
  vlosCellRight: {
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  vlosCellLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  vlosCellValue: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 3,
  },
  vlosNote: {
    ...Typography.small,
    lineHeight: 17,
  },
  noteCard: {
    padding: Spacing.lg,
    borderLeftWidth: 3,
    marginTop: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  noteTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  noteText: {
    ...Typography.small,
  },
  buttonRow: {
    gap: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalContent: {
    width: "100%",
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  modalHeader: {
    alignItems: "center",
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  modalTitle: {
    ...Typography.h2,
    fontWeight: "700",
  },
  modalBody: {
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  modalText: {
    ...Typography.body,
    textAlign: "center",
  },
  modalQuestion: {
    ...Typography.body,
    fontWeight: "600",
    textAlign: "center",
  },
  modalHint: {
    ...Typography.small,
    textAlign: "center",
    fontStyle: "italic",
  },
  modalButtons: {
    flexDirection: "row",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  tipModalContent: {
    width: "100%",
    maxHeight: "80%",
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  tipModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  tipModalTitle: {
    ...Typography.h3,
    fontWeight: "700",
    flex: 1,
  },
  closeButton: {
    padding: Spacing.sm,
  },
  tipModalBody: {
    padding: Spacing.xl,
  },
  tipDescription: {
    ...Typography.body,
    lineHeight: 24,
    marginBottom: Spacing.xl,
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
  tipModalFooter: {
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
});
