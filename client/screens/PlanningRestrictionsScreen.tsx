import { openLink } from "@/lib/webBrowser";
import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView, Linking, Alert, Platform } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
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
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { queryGeozonesInArea, GeozoneFeatureInfo, separateTempRestrictions, getCountryGeozoneConfig, getCountriesInRadius, DipulTempRestriction, DipulTempRestrictionsResult, fetchNearbyTempRestrictionsRaw } from "@/lib/geozones";
import { findMilLowFlightAreasContaining, findMilLowFlightAreasIntersectingRadius, MIL_LOW_FLIGHT_LABEL, MIL_LOW_FLIGHT_SOURCE_URL, MIL_LOW_FLIGHT_ACTIVATION_TEXT, MIL_LOW_FLIGHT_DATA_STAND, classifyMilLowFlightHits, getStatusLabel as getMilStatusLabel, getStatusColor as getMilStatusColor } from "@/lib/milLowFlight";
import { getPilotProfile, savePilotProfile, PilotProfile, AV_GEOZONE_TYPES, getDrone, DroneProfile, BUNDESLAND_AV_INFO, Bundesland, GENERAL_UAS_RESOURCES } from "@/lib/storage";
import { checkCountryCompliance, ComplianceResult, ComplianceItem } from "@/lib/countryCompliance";
import { detectBundeslandFromCoordinates } from "@/lib/countryMaps";
import { findNearbyCtrAirports, CtrAirport, getCtrCategoryLabel, getCtrCategoryColor, CTR_ZONE_RULES, DFS_PORTAL_URL, getAvConditionsText } from "@/lib/ctrData";
import { checkEdr146Proximity, Edr146ProximityResult, findNearbyEdrZones, EdrZone, getEdrSeverityColor, getEdrCategoryLabel, EDR_LEGAL_WARNING, BAF_CONTACT, POLIZEI_BERLIN, EDR_146_NFL, EDR_ENERGIE_NFL, EDR_AV_CONDITIONS, EDR_AV_EXCLUSIONS } from "@/lib/edrData";
import {
  findAreasContainingPoint,
  findRouteIntersections,
  isMilLowFlightLikelyActive,
  MIL_LOW_FLIGHT_ACTIVATION,
  type MilLowFlightArea,
  type RouteIntersection,
} from "@/lib/milLowFlight";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningRestrictions">;
type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningRestrictions">;

export default function PlanningRestrictionsScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { droneId, latitude, longitude, locationName, countryIso, mapUrl, radiusKm: initialRadiusKm, plannedDate, plannedTime, endTime, routeWaypoints } = route.params;
  const localRadiusKm = initialRadiusKm || 1;

  const [geozones, setGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const [tempRestrictions, setTempRestrictions] = useState<GeozoneFeatureInfo[]>([]);
  const [dipulTempRestrictions, setDipulTempRestrictions] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pilotProfile, setPilotProfile] = useState<PilotProfile | null>(null);
  const [droneProfile, setDroneProfile] = useState<DroneProfile | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
  const [avAcknowledged, setAvAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");
  const [restrictionChoice, setRestrictionChoice] = useState<"approved" | "limited" | "nofly" | null>(null);
  const [detectedBundesland, setDetectedBundesland] = useState<string | null>(null);
  const [nearbyCtr, setNearbyCtr] = useState<CtrAirport[]>([]);
  const [edr146Result, setEdr146Result] = useState<Edr146ProximityResult | null>(null);
  const [nearbyEdr, setNearbyEdr] = useState<EdrZone[]>([]);
  const [edrAvChecked, setEdrAvChecked] = useState<Set<string>>(new Set());
  const [edr146Acknowledged, setEdr146Acknowledged] = useState(false);
  const [edrRotAcknowledged, setEdrRotAcknowledged] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const loadProfiles = async () => {
        const [pilot, drone] = await Promise.all([
          getPilotProfile(),
          droneId ? getDrone(droneId) : Promise.resolve(null),
        ]);
        setPilotProfile(pilot);
        if (drone) setDroneProfile(drone);
        if (pilot && drone && countryIso) {
          setComplianceResult(checkCountryCompliance(drone, pilot, countryIso));
        }
      };
      loadProfiles();
    }, [droneId, countryIso])
  );

  useEffect(() => {
    let cancelled = false;
    const fetchGeozones = async () => {
      setLoading(true);
      setError(false);
      try {
        const results = await queryGeozonesInArea(latitude, longitude, localRadiusKm || 1, countryIso);
        if (cancelled) return;
        const separated = separateTempRestrictions(results);
        setGeozones(separated.geozones);
        setTempRestrictions(separated.tempRestrictions);
        if (countryIso === "DE") {
          const bl = detectBundeslandFromCoordinates(latitude, longitude);
          setDetectedBundesland(bl);
          const ctrResults = findNearbyCtrAirports(latitude, longitude, localRadiusKm ? Math.max(localRadiusKm, 10) : 10);
          setNearbyCtr(ctrResults);
          setEdr146Result(checkEdr146Proximity(latitude, longitude));
          setNearbyEdr(findNearbyEdrZones(latitude, longitude, localRadiusKm || 1));
          // Live AUP/UUP/NOTAM activation status for mil low-flight areas.
          // We need a wider radius than the planning radius so activations of
          // any nearby TFG (which are large) are still picked up.
          try {
            const dipul = await fetchNearbyTempRestrictionsRaw(latitude, longitude, Math.max(localRadiusKm || 1, 50));
            if (!cancelled) setDipulTempRestrictions(dipul);
          } catch {
            if (!cancelled) setDipulTempRestrictions({ active: [], upcoming: [] });
          }
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timer = setTimeout(() => { fetchGeozones(); }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [latitude, longitude, localRadiusKm, countryIso]);

  const avEnabled = pilotProfile?.allgemeinverfuegung?.enabled || false;
  const avGeozoneTypes = pilotProfile?.allgemeinverfuegung?.geozoneTypes || [];

  const isGeozoneCoveredByAV = (gz: GeozoneFeatureInfo): boolean => {
    if (!avEnabled) return false;
    const label = gz.layerLabel?.toLowerCase() || "";
    return avGeozoneTypes.some((avType) => {
      const avLabel = AV_GEOZONE_TYPES.find((t) => t.id === avType)?.label?.toLowerCase() || "";
      return label.includes(avLabel) || label.includes(avType);
    });
  };

  const coveredGeozones = geozones.filter(isGeozoneCoveredByAV);
  const uncoveredGeozones = geozones.filter((gz) => !isGeozoneCoveredByAV(gz));
  const milLowFlightInside: DipulTempRestriction[] = countryIso === "DE" ? findMilLowFlightAreasContaining(latitude, longitude) : [];
  const milLowFlightWithinRadius: DipulTempRestriction[] = countryIso === "DE" ? findMilLowFlightAreasIntersectingRadius(latitude, longitude, Math.max(localRadiusKm || 1, 1)) : [];
  const milLowFlightHits: DipulTempRestriction[] = milLowFlightInside.length > 0 ? milLowFlightInside : milLowFlightWithinRadius;
  // Classify geographic hits using live DIPUL/AUP activation status — only
  // active/upcoming areas are "hot" and contribute to pre-flight warnings.
  // Inactive overlaps remain visible but are purely informational.
  const milLowFlightClassified = React.useMemo(
    () => classifyMilLowFlightHits(milLowFlightHits, dipulTempRestrictions),
    [milLowFlightHits, dipulTempRestrictions]
  );
  const milLowFlightHotHits = milLowFlightClassified.hot;
  const milLowFlightInactiveHits = milLowFlightClassified.inactive;
  const hasAnyRestrictions = geozones.length > 0 || tempRestrictions.length > 0 || milLowFlightHotHits.length > 0;
  const hasUncoveredRestrictions = uncoveredGeozones.length > 0 || tempRestrictions.length > 0 || milLowFlightHotHits.length > 0;
  const allCoveredByAV = hasAnyRestrictions && !hasUncoveredRestrictions;

  const pilotAvBundeslaender = pilotProfile?.allgemeinverfuegung?.bundeslaender || [];
  const hasBundeslandAv = detectedBundesland
    ? pilotAvBundeslaender.includes(detectedBundesland as Bundesland)
    : false;
  const missingBundeslandAv =
    countryIso === "DE" &&
    detectedBundesland !== null &&
    avEnabled &&
    geozones.length > 0 &&
    !hasBundeslandAv;
  const bundeslandAvInfo = detectedBundesland
    ? BUNDESLAND_AV_INFO[detectedBundesland]
    : undefined;

  const hasEdr146Block = edr146Result?.isInside === true && edr146Result.isInnerCircle && !edr146Acknowledged;
  const hasEdr146OuterBlock = edr146Result?.isInside === true && !edr146Result.isInnerCircle && !edr146Acknowledged;
  const hasEdrRotBlock = nearbyEdr.some(z => z.severity === "rot" && z.id !== "146") && !edrRotAcknowledged;

  const milTakeoffAreas: MilLowFlightArea[] = countryIso === "DE" ? findAreasContainingPoint(latitude, longitude) : [];
  const milRouteWaypoints = routeWaypoints && routeWaypoints.length >= 2
    ? routeWaypoints
    : [{ latitude, longitude }];
  const milRouteIntersections: RouteIntersection[] = countryIso === "DE"
    ? findRouteIntersections(milRouteWaypoints)
    : [];
  const milRouteAreaIds = new Set<string>();
  milRouteIntersections.forEach((it) => milRouteAreaIds.add(it.area.id));
  milTakeoffAreas.forEach((a) => milRouteAreaIds.add(a.id));
  const milActive = isMilLowFlightLikelyActive(plannedDate, plannedTime);
  const hasMilLowFlightWarning =
    milRouteAreaIds.size > 0 && (milActive || milLowFlightHotHits.length > 0);

  const canContinue = !loading;

  const hasWarnings = hasAnyRestrictions || hasEdr146Block || hasEdr146OuterBlock || hasEdrRotBlock || hasMilLowFlightWarning;

  const navigateToDetails = () => {
    const restrictionNotes = notes.trim() || undefined;
    navigation.navigate("PlanningDetails", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      mapUrl,
      hasRestrictions: hasAnyRestrictions,
      restrictionStatus: restrictionChoice === "nofly" ? undefined : (restrictionChoice ?? (allCoveredByAV ? "approved" : undefined)),
      restrictionNotes,
      radiusKm: localRadiusKm,
      plannedDate,
      plannedTime,
      endTime,
      routeWaypoints,
    });
  };

  const handleContinue = () => {
    if (hasWarnings && !avAcknowledged && restrictionChoice !== "approved" && restrictionChoice !== "limited") {
      const warnings: string[] = [];
      if (hasEdr146Block || hasEdr146OuterBlock) warnings.push("ED-R 146 Flugbeschränkungsgebiet");
      if (hasEdrRotBlock) warnings.push("Rote ED-R Zone(n) im Umkreis");
      if (tempRestrictions.length > 0) warnings.push(`${tempRestrictions.length} temporäre Beschränkung(en)`);
      if (uncoveredGeozones.length > 0) warnings.push(`${uncoveredGeozones.length} Geozone(n) ohne AV`);
      if (hasMilLowFlightWarning) {
        const names = Array.from(milRouteAreaIds)
          .map((id) => milRouteIntersections.find((it) => it.area.id === id)?.area.name
            ?? milTakeoffAreas.find((a) => a.id === id)?.name
            ?? id)
          .join(", ");
        const segCount = milRouteIntersections.length;
        const detail = segCount > 0
          ? `${segCount} Routensegment(e) kreuzen militärische Tieffluggebiete (${names})`
          : `Standort liegt in militärischem Tieffluggebiet (${names})`;
        const liveActive = milLowFlightHotHits.length > 0;
        const activeHint = liveActive
          ? "live aktiv/demnächst"
          : (milActive ? "wahrscheinlich aktiv" : "");
        warnings.push(activeHint ? `${detail} – ${activeHint}` : detail);
      } else if (milLowFlightHotHits.length > 0) {
        warnings.push(`Militärisches Tieffluggebiet (Tag) aktiv/demnächst: ${milLowFlightHotHits.map((m) => m.name).join(", ")}`);
      }

      Alert.alert(
        "Einschränkungen erkannt",
        `Im Umkreis deines Standorts gibt es Einschränkungen:\n\n${warnings.map(w => `• ${w}`).join("\n")}\n\nEin Flug in diesen Bereichen kann gegen Vorschriften verstoßen. Möchtest du trotzdem fortfahren?`,
        [
          { text: "Abbrechen", style: "cancel" },
          {
            text: "Trotzdem fortfahren",
            style: "destructive",
            onPress: navigateToDetails,
          },
        ]
      );
    } else {
      navigateToDetails();
    }
  };

  const handleAbort = () => {
    navigation.getParent()?.goBack();
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
        <ThemedText style={styles.title}>Einschränkungen prüfen</ThemedText>
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          Automatische Prüfung der Geozonen für deinen Standort
        </ThemedText>

        {plannedDate ? (
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Feather name="map-pin" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.summaryText, { color: theme.textSecondary }]}>
                {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
              </ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <Feather name="clock" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.summaryText, { color: theme.textSecondary }]}>
                {new Date(plannedDate + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} {plannedTime} - {endTime}
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
              Geozonen werden geprüft...
            </ThemedText>
          </View>
        ) : null}

        {!loading && error ? (
          <Card style={[styles.statusCard, { borderLeftColor: theme.statusCaution || "#FF9500" }]}>
            <Feather name="alert-triangle" size={20} color={theme.statusCaution || "#FF9500"} />
            <ThemedText style={[styles.statusText, { color: theme.statusCaution || "#FF9500" }]}>
              Geozonen konnten nicht geladen werden. Bitte prüfe manuell auf dipul.de
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && !hasAnyRestrictions ? (
          <Card style={[styles.statusCard, { borderLeftColor: theme.statusGo || "#34C759" }]}>
            <Feather name="check-circle" size={20} color={theme.statusGo || "#34C759"} />
            <View style={styles.statusTextContainer}>
              <ThemedText style={[styles.statusTitle, { color: theme.statusGo || "#34C759" }]}>
                Keine Einschränkungen
              </ThemedText>
              <ThemedText style={[styles.statusDesc, { color: theme.textSecondary }]}>
                Keine Geozonen oder temporären Beschränkungen im Umkreis gefunden
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {!loading && !error && edr146Result?.isInside ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-octagon" size={16} color="#FF3B30" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF3B30" }]}>
                ED-R 146 Berlin — Strafgefahr
              </ThemedText>
            </View>
            <Card style={[styles.edrCriticalCard, { borderLeftColor: "#FF3B30" }]}>
              <View style={[styles.edrLegalBanner, { backgroundColor: "#FF3B3015" }]}>
                <Feather name="alert-triangle" size={18} color="#FF3B30" />
                <View style={styles.edrLegalBannerText}>
                  <ThemedText style={[styles.edrLegalTitle, { color: "#FF3B30" }]}>
                    {EDR_LEGAL_WARNING.paragraph} — {EDR_LEGAL_WARNING.shortText}
                  </ThemedText>
                  <ThemedText style={[styles.edrLegalBody, { color: theme.text }]}>
                    {EDR_LEGAL_WARNING.longText}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.edrInfoBlock}>
                <ThemedText style={[styles.edrInfoLabel, { color: theme.textSecondary }]}>Gebiet</ThemedText>
                <ThemedText style={[styles.edrInfoValue, { color: theme.text }]}>
                  ED-R 146 (Berlin) — Regierungsviertel
                </ThemedText>
                <ThemedText style={[styles.edrInfoDetail, { color: theme.textTertiary }]}>
                  3 NM (5,556 km) um den Reichstag. Höhe: Boden bis 2.500 ft (762 m).
                </ThemedText>
              </View>

              {edr146Result.isInnerCircle ? (
                <View style={[styles.edrZoneBadge, { backgroundColor: "#FF3B3015", borderColor: "#FF3B30" }]}>
                  <Feather name="x-circle" size={16} color="#FF3B30" />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.edrZoneBadgeTitle, { color: "#FF3B30" }]}>
                      Innerer Kreis (1 NM) — Extrem eingeschränkt
                    </ThemedText>
                    <ThemedText style={[styles.edrZoneBadgeDesc, { color: theme.textSecondary }]}>
                      Genehmigung nur bei zwingendem Erfordernis durch oberste Bundes-/Landesbehörde. Hobby-/Marketingflüge sind grundsätzlich nicht genehmigungsfähig.
                    </ThemedText>
                  </View>
                </View>
              ) : (
                <View style={[styles.edrZoneBadge, { backgroundColor: "#FF950015", borderColor: "#FF9500" }]}>
                  <Feather name="alert-circle" size={16} color="#FF9500" />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.edrZoneBadgeTitle, { color: "#FF9500" }]}>
                      2./3. Nautische Meile — AV möglich
                    </ThemedText>
                    <ThemedText style={[styles.edrZoneBadgeDesc, { color: theme.textSecondary }]}>
                      Flug unter Bedingungen der {EDR_146_NFL.avUas} ohne Einzelgenehmigung möglich. Polizei Berlin muss mindestens {POLIZEI_BERLIN.vorlaufStunden} Stunden vorher informiert werden.
                    </ThemedText>
                  </View>
                </View>
              )}

              <View style={styles.edrInfoBlock}>
                <ThemedText style={[styles.edrInfoLabel, { color: theme.textSecondary }]}>Vorlaufzeit Antrag</ThemedText>
                <ThemedText style={[styles.edrInfoValue, { color: theme.text }]}>
                  Mindestens 4 bis 6 Wochen (Sicherheitsüberprüfung)
                </ThemedText>
              </View>

              <Pressable
                onPress={() => { openLink(`tel:${POLIZEI_BERLIN.phone}`).catch(() => {}); }}
                style={[styles.ctrCallButton, { backgroundColor: "#007AFF" }]}
                testID="edr146-call-polizei"
              >
                <Feather name="phone" size={18} color="#fff" />
                <View style={styles.ctrCallTextBlock}>
                  <ThemedText style={styles.ctrCallLabel}>{POLIZEI_BERLIN.name}</ThemedText>
                  <ThemedText style={styles.ctrCallNumber}>{POLIZEI_BERLIN.phoneDisplay}</ThemedText>
                </View>
              </Pressable>

              <View style={styles.edrLinksBlock}>
                <Pressable
                  onPress={() => { openLink(BAF_CONTACT.edr146Url).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="external-link" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>BAF — ED-R 146 Informationen</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { openLink(BAF_CONTACT.antragsformularUrl).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="file-text" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>Antrag Durchfluggenehmigung</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { openLink(EDR_146_NFL.avUasPdf).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="download" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{EDR_146_NFL.avUas} (AV UAS ED-R 146)</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { openLink(`mailto:${BAF_CONTACT.emailEdr146}`).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="mail" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{BAF_CONTACT.emailEdr146}</ThemedText>
                </Pressable>
              </View>

              <Pressable
                onPress={() => setEdr146Acknowledged(!edr146Acknowledged)}
                style={[styles.edrAcknowledgeRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
                testID="edr146-acknowledge"
              >
                <View style={[
                  styles.edrCheckbox,
                  { borderColor: edr146Acknowledged ? "#FF3B30" : theme.textTertiary },
                  edr146Acknowledged ? { backgroundColor: "#FF3B30" } : undefined,
                ]}>
                  {edr146Acknowledged ? <Feather name="check" size={14} color="#fff" /> : null}
                </View>
                <ThemedText style={[styles.edrAcknowledgeText, { color: theme.text }]}>
                  {edr146Result?.isInnerCircle
                    ? "Ich bestätige, dass ich die Einschränkungen des inneren Kreises (1 NM) zur Kenntnis genommen habe und eine Einzelgenehmigung beantragt habe."
                    : "Ich bestätige, dass ich die Auflagen der AV sowie die Meldepflicht bei der Polizei Berlin zur Kenntnis genommen habe."
                  }
                </ThemedText>
              </Pressable>
            </Card>
          </View>
        ) : null}

        {!loading && !error && nearbyEdr.filter(z => z.id !== "146").length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="shield-off" size={16} color="#FF9500" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF9500" }]}>
                Flugbeschränkungsgebiete (ED-R)
              </ThemedText>
            </View>

            <View style={[styles.edrLegalBannerCompact, { backgroundColor: "#FF3B3010" }]}>
              <Feather name="alert-triangle" size={14} color="#FF3B30" />
              <ThemedText style={[styles.edrLegalCompactText, { color: "#FF3B30" }]}>
                {EDR_LEGAL_WARNING.paragraph}: {EDR_LEGAL_WARNING.shortText}
              </ThemedText>
            </View>

            {nearbyEdr.filter(z => z.id !== "146").map((zone) => {
              const sevColor = getEdrSeverityColor(zone.severity);
              return (
                <Card key={zone.id} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: sevColor }]}>
                  <View style={styles.geozoneCardHeader}>
                    <View style={[styles.badge, { backgroundColor: sevColor }]}>
                      <ThemedText style={styles.badgeText}>{getEdrCategoryLabel(zone.category)}</ThemedText>
                    </View>
                    <View style={[styles.badge, { backgroundColor: zone.severity === "rot" ? "#FF3B3020" : "#FF950020" }]}>
                      <ThemedText style={[styles.badgeText, { color: sevColor }]}>
                        {zone.severity === "rot" ? "ROT" : "GELB"}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.geozoneName}>{zone.name}</ThemedText>
                  {zone.operatorName ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      Betreiber: {zone.operatorName}
                    </ThemedText>
                  ) : null}
                  {zone.note ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      {zone.note}
                    </ThemedText>
                  ) : null}
                  {zone.avCovered ? (
                    <View style={styles.ctrAvRow}>
                      <Feather name="check-circle" size={12} color={theme.statusGo || "#34C759"} />
                      <ThemedText style={[styles.ctrAvText, { color: theme.statusGo || "#34C759" }]}>
                        AV vorhanden: {zone.avReference}
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={styles.ctrAvRow}>
                      <Feather name="x-circle" size={12} color="#FF3B30" />
                      <ThemedText style={[styles.ctrAvText, { color: "#FF3B30" }]}>
                        Einzelgenehmigung beim BAF erforderlich
                      </ThemedText>
                    </View>
                  )}
                </Card>
              );
            })}

            {nearbyEdr.some(z => z.id !== "146" && z.avCovered) ? (
              <Card style={[styles.edrAvConditionsCard, { borderLeftWidth: 3, borderLeftColor: "#FF9500" }]}>
                <View style={styles.ctrRulesHeader}>
                  <Feather name="clipboard" size={16} color="#FF9500" />
                  <ThemedText style={[styles.ctrRulesTitle, { color: "#FF9500" }]}>
                    AV-Bedingungen ({EDR_ENERGIE_NFL.reference})
                  </ThemedText>
                </View>
                <ThemedText style={[styles.edrAvConditionsIntro, { color: theme.textSecondary }]}>
                  Flug ohne Einzelantrag beim BAF möglich, wenn alle Bedingungen erfüllt sind:
                </ThemedText>
                {EDR_AV_CONDITIONS.map((cond) => (
                  <Pressable
                    key={cond.id}
                    onPress={() => {
                      const next = new Set(edrAvChecked);
                      if (next.has(cond.id)) { next.delete(cond.id); } else { next.add(cond.id); }
                      setEdrAvChecked(next);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={styles.edrAvCondRow}
                  >
                    <View style={[
                      styles.checkbox,
                      { borderColor: edrAvChecked.has(cond.id) ? (theme.statusGo || "#34C759") : theme.textTertiary },
                      edrAvChecked.has(cond.id) ? { backgroundColor: theme.statusGo || "#34C759" } : undefined,
                    ]}>
                      {edrAvChecked.has(cond.id) ? (
                        <Feather name="check" size={14} color="#fff" />
                      ) : null}
                    </View>
                    <ThemedText style={[styles.edrAvCondText, { color: theme.text }]}>{cond.label}</ThemedText>
                  </Pressable>
                ))}

                <View style={[styles.edrExclusionBlock, { backgroundColor: "#FF3B3008" }]}>
                  <ThemedText style={[styles.edrExclusionTitle, { color: "#FF3B30" }]}>
                    AV gilt NICHT bei:
                  </ThemedText>
                  {EDR_AV_EXCLUSIONS.map((ex, i) => (
                    <View key={i} style={styles.edrExclusionRow}>
                      <Feather name="x" size={12} color="#FF3B30" />
                      <ThemedText style={[styles.edrExclusionText, { color: theme.textSecondary }]}>{ex}</ThemedText>
                    </View>
                  ))}
                </View>

                <View style={styles.edrLinksBlock}>
                  <Pressable
                    onPress={() => { openLink(EDR_ENERGIE_NFL.pdf).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="download" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{EDR_ENERGIE_NFL.reference} (PDF)</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => { openLink(BAF_CONTACT.avEnergieUrl).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="external-link" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>BAF — AV Energie/Forschung/Wartburg</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => { openLink(BAF_CONTACT.antragsformularUrl).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="file-text" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>Einzelantrag beim BAF stellen</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => { openLink(`mailto:${BAF_CONTACT.emailGeneral}`).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="mail" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{BAF_CONTACT.emailGeneral}</ThemedText>
                  </Pressable>
                </View>
              </Card>
            ) : null}

            {nearbyEdr.some(z => z.id !== "146" && z.severity === "rot") ? (
              <Pressable
                onPress={() => setEdrRotAcknowledged(!edrRotAcknowledged)}
                style={[styles.edrAcknowledgeRow, { backgroundColor: "#FF3B3008", borderRadius: BorderRadius.md, marginTop: Spacing.sm }]}
                testID="edr-rot-acknowledge"
              >
                <View style={[
                  styles.edrCheckbox,
                  { borderColor: edrRotAcknowledged ? "#FF3B30" : theme.textTertiary },
                  edrRotAcknowledged ? { backgroundColor: "#FF3B30" } : undefined,
                ]}>
                  {edrRotAcknowledged ? <Feather name="check" size={14} color="#fff" /> : null}
                </View>
                <ThemedText style={[styles.edrAcknowledgeText, { color: theme.text }]}>
                  Ich bestätige, dass ich eine Einzelgenehmigung beim BAF beantragt habe oder der Flug nicht in das ED-R-Gebiet führt.
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!loading && !error && milLowFlightHits.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="shield" size={16} color={milLowFlightHotHits.length > 0 ? "#7B8B3A" : "#8E8E93"} />
              <ThemedText style={[styles.sectionTitle, { color: milLowFlightHotHits.length > 0 ? "#7B8B3A" : "#8E8E93" }]}>
                Mil. Tieffluggebiet (Tag) ({milLowFlightHits.length})
              </ThemedText>
            </View>
            {milLowFlightHotHits.length === 0 && milLowFlightInactiveHits.length > 0 ? (
              <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, marginBottom: Spacing.sm }]}>
                Derzeit keine aktive AUP/UUP- oder NOTAM-Aktivierung — nur informativ.
              </ThemedText>
            ) : null}
            {milLowFlightHits.map((mr) => {
              const areaId = mr.id.startsWith("mil-low-flight-") ? mr.id.slice("mil-low-flight-".length) : mr.id;
              const status = milLowFlightClassified.statusByAreaId[areaId] ?? "inactive";
              const statusColor = getMilStatusColor(status);
              const statusLabel = getMilStatusLabel(status);
              const isHot = status === "active" || status === "upcoming";
              return (
                <Card key={mr.id} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: statusColor }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <View style={[styles.badge, { backgroundColor: "#7B8B3A" }]}>
                      <ThemedText style={styles.badgeText}>{MIL_LOW_FLIGHT_LABEL}</ThemedText>
                    </View>
                    <View style={[styles.badge, { backgroundColor: statusColor }]}>
                      <ThemedText style={styles.badgeText} testID={`mil-status-${areaId}`}>{statusLabel}</ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.geozoneName}>{mr.name}</ThemedText>
                  <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary }]}>
                    {milLowFlightInside.length > 0
                      ? "Standort liegt im militärischen Tieffluggebiet (Tag)."
                      : "Geplanter Flugradius reicht in das militärische Tieffluggebiet (Tag)."}{" "}
                    {isHot
                      ? `Status laut DIPUL/AUP: ${statusLabel}. Höhenband GND — 250 ft AGL. NOTAM-Pflichtprüfung vor Start erforderlich.`
                      : `Status laut DIPUL/AUP: ${statusLabel} — derzeit keine bekannte Aktivierung, daher nur informativ. Vor Start dennoch NOTAMs prüfen.`}
                  </ThemedText>
                  <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, fontSize: 11, marginTop: 4 }]}>
                    Quelle: dipul.de (Approximation, Stand {MIL_LOW_FLIGHT_DATA_STAND})
                  </ThemedText>
                  <Pressable
                    onPress={() => { openLink(MIL_LOW_FLIGHT_SOURCE_URL).catch(() => {}); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}
                  >
                    <Feather name="external-link" size={11} color="#7B8B3A" />
                    <ThemedText style={{ color: "#7B8B3A", fontSize: 12, fontWeight: "600" }}>Details auf dipul.de</ThemedText>
                  </Pressable>
                </Card>
              );
            })}
          </View>
        ) : null}

        {!loading && !error && tempRestrictions.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-triangle" size={16} color="#FF3B30" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF3B30" }]}>
                Temporäre Beschränkungen ({tempRestrictions.length})
              </ThemedText>
            </View>
            {tempRestrictions.map((tr, idx) => (
              <Card key={`temp-${idx}`} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: "#FF3B30" }]}>
                <View style={[styles.badge, { backgroundColor: "#FF3B30" }]}>
                  <ThemedText style={styles.badgeText}>Temporär (dipul)</ThemedText>
                </View>
                <ThemedText style={styles.geozoneName}>{tr.name}</ThemedText>
                {tr.details ? (
                  <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={3}>
                    {tr.details}
                  </ThemedText>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        {!loading && !error && nearbyCtr.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="navigation" size={16} color="#FF3B30" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF3B30" }]}>
                Kontrollzone ({nearbyCtr.length > 1 ? `${nearbyCtr.length} Flughäfen` : "1 Flughafen"})
              </ThemedText>
            </View>
            {nearbyCtr.map((ctr) => {
              const catColor = getCtrCategoryColor(ctr.category);
              return (
                <Card key={ctr.icao} style={[styles.ctrCard, { borderLeftWidth: 3, borderLeftColor: catColor }]}>
                  <View style={styles.ctrCardHeader}>
                    <View style={[styles.badge, { backgroundColor: catColor }]}>
                      <ThemedText style={styles.badgeText}>{getCtrCategoryLabel(ctr.category)}</ThemedText>
                    </View>
                    <ThemedText style={[styles.ctrIcao, { color: theme.textTertiary }]}>{ctr.icao}</ThemedText>
                  </View>
                  <ThemedText style={styles.geozoneName}>{ctr.name}</ThemedText>
                  {ctr.note ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      {ctr.note}
                    </ThemedText>
                  ) : null}
                  {ctr.hasAllgemeinverfuegung && ctr.avReference ? (
                    <View>
                      <View style={styles.ctrAvRow}>
                        <Feather name="check-circle" size={12} color={theme.statusGo || "#34C759"} />
                        <ThemedText style={[styles.ctrAvText, { color: theme.statusGo || "#34C759" }]}>
                          AV vorhanden: {ctr.avReference}
                        </ThemedText>
                      </View>
                      {ctr.avInfo ? (
                        <View style={{ marginLeft: 20, marginTop: 4 }}>
                          <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, fontSize: 11 }]}>
                            {ctr.avInfo.provider}
                          </ThemedText>
                          {getAvConditionsText(ctr.avInfo).slice(0, 4).map((cond, ci) => (
                            <View key={ci} style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 }}>
                              <ThemedText style={{ color: theme.textTertiary, fontSize: 10, lineHeight: 14 }}>{"\u2022"}</ThemedText>
                              <ThemedText style={{ color: theme.textTertiary, fontSize: 10, lineHeight: 14, flex: 1 }}>{cond}</ThemedText>
                            </View>
                          ))}
                          {ctr.avInfo.pdfUrl ? (
                            <Pressable
                              onPress={() => { openLink(ctr.avInfo!.pdfUrl).catch(() => {}); }}
                              style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}
                            >
                              <Feather name="file-text" size={10} color={theme.primary} />
                              <ThemedText style={{ color: theme.primary, fontSize: 10 }}>AV-PDF anzeigen</ThemedText>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {ctr.category === "military" ? (
                    <View style={styles.ctrAvRow}>
                      <Feather name="alert-triangle" size={12} color="#FF3B30" />
                      <ThemedText style={[styles.ctrAvText, { color: "#FF3B30" }]}>
                        Keine AV — Einzelkoordination mit Bundeswehr erforderlich
                      </ThemedText>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => { openLink(`tel:${ctr.towerPhone.replace(/\s/g, "")}`).catch(() => {}); }}
                    style={[styles.ctrCallButton, { backgroundColor: "#34C759" }]}
                    testID={`ctr-call-${ctr.icao}`}
                  >
                    <Feather name="phone" size={18} color="#fff" />
                    <View style={styles.ctrCallTextBlock}>
                      <ThemedText style={styles.ctrCallLabel}>Tower anrufen</ThemedText>
                      <ThemedText style={styles.ctrCallNumber}>{ctr.towerPhone}</ThemedText>
                    </View>
                  </Pressable>
                </Card>
              );
            })}
            <Card style={[styles.ctrRulesCard, { borderLeftWidth: 3, borderLeftColor: theme.primary }]}>
              <View style={styles.ctrRulesHeader}>
                <Feather name="info" size={16} color={theme.primary} />
                <ThemedText style={[styles.ctrRulesTitle, { color: theme.primary }]}>CTR-Zonenregeln</ThemedText>
              </View>
              {Object.values(CTR_ZONE_RULES).map((rule) => (
                <View key={rule.label} style={styles.ctrRuleRow}>
                  <ThemedText style={[styles.ctrRuleLabel, { color: theme.text }]}>{rule.label}</ThemedText>
                  <ThemedText style={[styles.ctrRuleRange, { color: theme.textSecondary }]}>{rule.range}</ThemedText>
                  <ThemedText style={[styles.ctrRuleStatus, { color: theme.textTertiary }]}>{rule.status}</ThemedText>
                </View>
              ))}
              {nearbyCtr.some((c) => c.category === "dfs" || c.category === "das") ? (
                <Pressable
                  onPress={() => { openLink(DFS_PORTAL_URL).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15", marginTop: Spacing.sm }]}
                >
                  <Feather name="external-link" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                    DFS-Portal (Einzelgenehmigung)
                  </ThemedText>
                </Pressable>
              ) : null}
              <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, fontSize: 10, marginTop: Spacing.sm }]}>
                Hinweis: Diese Zonenregeln gelten allgemein. Die konkreten Auflagen richten sich nach dem jeweiligen ATC-Dienstleister (siehe oben pro Flughafen).
              </ThemedText>
            </Card>
          </View>
        ) : null}

        {!loading && !error && coveredGeozones.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="shield" size={16} color={theme.statusGo || "#34C759"} />
              <ThemedText style={[styles.sectionTitle, { color: theme.statusGo || "#34C759" }]}>
                Durch Allgemeinverfügung abgedeckt ({coveredGeozones.length})
              </ThemedText>
            </View>
            {coveredGeozones.map((gz, idx) => (
              <Card key={`cov-${idx}`} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: theme.statusGo || "#34C759" }]}>
                <View style={styles.geozoneCardHeader}>
                  <View style={[styles.badge, { backgroundColor: theme.statusGo || "#34C759" }]}>
                    <ThemedText style={styles.badgeText}>{gz.layerLabel}</ThemedText>
                  </View>
                  <Feather name="shield" size={14} color={theme.statusGo || "#34C759"} />
                </View>
                <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                {gz.details ? (
                  <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={2}>
                    {gz.details}
                  </ThemedText>
                ) : null}
              </Card>
            ))}

            <Pressable
              onPress={() => { setAvAcknowledged(!avAcknowledged); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.acknowledgeRow,
                { borderColor: avAcknowledged ? (theme.statusGo || "#34C759") : theme.border },
                avAcknowledged ? { backgroundColor: (theme.statusGoBackground || "rgba(52, 199, 89, 0.1)") } : undefined,
              ]}
            >
              <View style={[
                styles.checkbox,
                { borderColor: avAcknowledged ? (theme.statusGo || "#34C759") : theme.textTertiary },
                avAcknowledged ? { backgroundColor: theme.statusGo || "#34C759" } : undefined,
              ]}>
                {avAcknowledged ? (
                  <Feather name="check" size={14} color="#fff" />
                ) : null}
              </View>
              <ThemedText style={styles.acknowledgeText}>
                Ich bestätige, dass ich mich in den oben genannten Geozonen bewege und mich an die Bedingungen meiner Allgemeinverfügung halte.
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && hasMilLowFlightWarning ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: "#6B8E23" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="shield" size={20} color="#6B8E23" />
              <ThemedText style={[styles.avWarningTitle, { color: "#6B8E23" }]}>
                Militärisches Tieffluggebiet
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.text }]}>
              {milRouteIntersections.length > 0
                ? `Deine geplante Route kreuzt ${milRouteIntersections.length} militärische(s) Tieffluggebiet(e):`
                : `Dein Flugstandort liegt in einem militärischen Tieffluggebiet:`}
            </ThemedText>
            <View style={{ marginTop: Spacing.sm, gap: 4 }}>
              {Array.from(milRouteAreaIds).map((id) => {
                const area = milRouteIntersections.find((it) => it.area.id === id)?.area
                  ?? milTakeoffAreas.find((a) => a.id === id);
                if (!area) return null;
                return (
                  <View key={`mil-${id}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                    <Feather name="alert-triangle" size={12} color="#6B8E23" style={{ marginTop: 3 }} />
                    <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary, flex: 1 }]}>
                      {area.name} — {area.description}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary, marginTop: Spacing.sm, fontStyle: "italic" }]}>
              {milActive
                ? `Voraussichtlich aktiv zur geplanten Zeit. ${MIL_LOW_FLIGHT_ACTIVATION.note}`
                : MIL_LOW_FLIGHT_ACTIVATION.note}
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && missingBundeslandAv && detectedBundesland ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: "#FF9500" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="alert-triangle" size={20} color="#FF9500" />
              <ThemedText style={[styles.avWarningTitle, { color: "#FF9500" }]}>
                Allgemeinverfügung fehlt
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.text }]}>
              Du hast keine Allgemeinverfügung für{" "}
              <ThemedText style={{ fontWeight: "700" }}>{detectedBundesland}</ThemedText>
              {" "}hinterlegt. Für den Einflug in geografische Gebiete wird eine Allgemeinerlaubnis des zuständigen Bundeslandes benötigt.
            </ThemedText>
            {bundeslandAvInfo ? (
              <View style={styles.avInfoBlock}>
                <ThemedText style={[styles.avInfoLabel, { color: theme.textSecondary }]}>
                  Zuständige Behörde
                </ThemedText>
                <ThemedText style={[styles.avInfoValue, { color: theme.text }]}>
                  {bundeslandAvInfo.behorde}
                </ThemedText>
                <View style={styles.avLinkRow}>
                  <Pressable
                    onPress={() => { openLink(bundeslandAvInfo.antragUrl).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="file-text" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                      Antrag stellen (dipul.de)
                    </ThemedText>
                  </Pressable>
                  {bundeslandAvInfo.pdfUrl ? (
                    <Pressable
                      onPress={() => { openLink(bundeslandAvInfo.pdfUrl!).catch(() => {}); }}
                      style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name="download" size={14} color={theme.primary} />
                      <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                        Allgemeinerlaubnis PDF
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {bundeslandAvInfo.infoUrl ? (
                    <Pressable
                      onPress={() => { openLink(bundeslandAvInfo.infoUrl!).catch(() => {}); }}
                      style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name="info" size={14} color={theme.primary} />
                      <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                        Weitere Infos ({detectedBundesland})
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {bundeslandAvInfo.additionalDocs?.map((doc, i) => (
                    <Pressable
                      key={`addoc-${i}`}
                      onPress={() => { openLink(doc.url).catch(() => {}); }}
                      style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name={doc.icon as any} size={14} color={theme.primary} />
                      <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                        {doc.title}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            <Pressable
              onPress={() => {
                navigation.getParent()?.navigate("Main", { screen: "SettingsTab", params: { screen: "PilotProfile" } } as any);
              }}
              style={[styles.avSettingsLink, { borderColor: theme.border }]}
            >
              <Feather name="settings" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.avSettingsText, { color: theme.textSecondary }]}>
                Bundesland in Pilotenprofil hinzufügen
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        {!loading && !error && countryIso === "DE" && geozones.length > 0 && detectedBundesland === null ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.statusCaution || "#FF9500" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="map-pin" size={20} color={theme.statusCaution || "#FF9500"} />
              <ThemedText style={[styles.avWarningTitle, { color: theme.statusCaution || "#FF9500" }]}>
                Bundesland nicht erkannt
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary }]}>
              Das Bundesland konnte anhand der Koordinaten nicht automatisch bestimmt werden. Bitte
              prüfe manuell, ob du eine gültige Allgemeinverfügung für dieses Gebiet besitzt.
            </ThemedText>
            <Pressable
              onPress={() => { openLink("https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/").catch(() => {}); }}
              style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
            >
              <Feather name="external-link" size={14} color={theme.primary} />
              <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                dipul.de - Anträge & Informationen
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        {!loading && !error && countryIso === "DE" && geozones.length > 0 && !avEnabled ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: "#FF9500" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="alert-triangle" size={20} color="#FF9500" />
              <ThemedText style={[styles.avWarningTitle, { color: "#FF9500" }]}>
                Keine Allgemeinverfügung hinterlegt
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.text }]}>
              In deinem Pilotenprofil ist keine Allgemeinverfügung aktiviert.
              Für den Einflug in geografische Gebiete in Deutschland wird in der Regel eine
              Allgemeinerlaubnis des zuständigen Bundeslandes benötigt.
            </ThemedText>
            <View style={styles.avLinkRow}>
              <Pressable
                onPress={() => { openLink("https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/").catch(() => {}); }}
                style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
              >
                <Feather name="file-text" size={14} color={theme.primary} />
                <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                  Antrag stellen (dipul.de)
                </ThemedText>
              </Pressable>
            </View>
            <Pressable
              onPress={() => {
                navigation.getParent()?.navigate("Main", { screen: "SettingsTab", params: { screen: "PilotProfile" } } as any);
              }}
              style={[styles.avSettingsLink, { borderColor: theme.border }]}
            >
              <Feather name="settings" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.avSettingsText, { color: theme.textSecondary }]}>
                Allgemeinverfügung im Pilotenprofil aktivieren
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        {!loading && !error && hasBundeslandAv && detectedBundesland && coveredGeozones.length > 0 ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.statusGo || "#34C759" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="check-circle" size={20} color={theme.statusGo || "#34C759"} />
              <ThemedText style={[styles.avWarningTitle, { color: theme.statusGo || "#34C759" }]}>
                Allgemeinverfügung {detectedBundesland}
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary }]}>
              Du hast eine gültige Allgemeinverfügung für {detectedBundesland} hinterlegt. Die oben
              markierten Geozonen werden durch deine Allgemeinverfügung abgedeckt.
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && uncoveredGeozones.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-circle" size={16} color={theme.statusCaution || "#FF9500"} />
              <ThemedText style={[styles.sectionTitle, { color: theme.statusCaution || "#FF9500" }]}>
                Weitere Geozonen ({uncoveredGeozones.length})
              </ThemedText>
            </View>
            {uncoveredGeozones.map((gz, idx) => (
              <Card key={`uncov-${idx}`} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: theme.statusCaution || "#FF9500" }]}>
                <View style={[styles.badge, { backgroundColor: theme.statusCaution || "#FF9500" }]}>
                  <ThemedText style={styles.badgeText}>{gz.layerLabel}</ThemedText>
                </View>
                <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                {gz.details ? (
                  <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={2}>
                    {gz.details}
                  </ThemedText>
                ) : null}
              </Card>
            ))}

            <ThemedText style={[styles.detailsLabel, { color: theme.textSecondary }]}>
              Wie gehst du mit diesen Einschränkungen um?
            </ThemedText>

            <Pressable
              onPress={() => { setRestrictionChoice("approved"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.choiceOption,
                { borderColor: restrictionChoice === "approved" ? (theme.statusGo || "#34C759") : theme.border },
                restrictionChoice === "approved" ? { backgroundColor: theme.statusGoBackground } : undefined,
              ]}
            >
              <Feather name="shield" size={20} color={restrictionChoice === "approved" ? (theme.statusGo || "#34C759") : theme.textTertiary} />
              <View style={styles.choiceTextContainer}>
                <ThemedText style={[styles.choiceTitle, restrictionChoice === "approved" ? { color: theme.statusGo, fontWeight: "700" } : undefined]}>
                  Genehmigung vorhanden
                </ThemedText>
                <ThemedText style={[styles.choiceDesc, { color: theme.textSecondary }]}>
                  Ich habe eine gültige Genehmigung für diese Gebiete
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => { setRestrictionChoice("limited"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.choiceOption,
                { borderColor: restrictionChoice === "limited" ? (theme.statusCaution || "#FF9500") : theme.border },
                restrictionChoice === "limited" ? { backgroundColor: theme.statusCautionBackground } : undefined,
              ]}
            >
              <Feather name="alert-circle" size={20} color={restrictionChoice === "limited" ? (theme.statusCaution || "#FF9500") : theme.textTertiary} />
              <View style={styles.choiceTextContainer}>
                <ThemedText style={[styles.choiceTitle, restrictionChoice === "limited" ? { color: theme.statusCaution, fontWeight: "700" } : undefined]}>
                  Flug mit Auflagen möglich
                </ThemedText>
                <ThemedText style={[styles.choiceDesc, { color: theme.textSecondary }]}>
                  Flug ist erlaubt, aber mit Einschränkungen
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => { setRestrictionChoice("nofly"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.choiceOption,
                { borderColor: restrictionChoice === "nofly" ? (theme.statusNoGo || "#FF3B30") : theme.border },
                restrictionChoice === "nofly" ? { backgroundColor: theme.statusNoGoBackground } : undefined,
              ]}
            >
              <Feather name="x-circle" size={20} color={restrictionChoice === "nofly" ? (theme.statusNoGo || "#FF3B30") : theme.textTertiary} />
              <View style={styles.choiceTextContainer}>
                <ThemedText style={[styles.choiceTitle, restrictionChoice === "nofly" ? { color: theme.statusNoGo, fontWeight: "700" } : undefined]}>
                  Flug nicht möglich
                </ThemedText>
                <ThemedText style={[styles.choiceDesc, { color: theme.textSecondary }]}>
                  Keine Genehmigung vorhanden
                </ThemedText>
              </View>
            </Pressable>

            {restrictionChoice !== null && restrictionChoice !== "nofly" ? (
              <View style={styles.notesSection}>
                <ThemedText style={[styles.detailsLabel, { color: theme.textSecondary }]}>
                  Notizen (optional)
                </ThemedText>
                <TextInput
                  style={[styles.notesInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Weitere Details zur Genehmigung..."
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  numberOfLines={3}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {!loading && !error && countryIso === "DE" && hasAnyRestrictions ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="book-open" size={16} color={theme.textSecondary} />
              <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                Nützliche Dokumente
              </ThemedText>
            </View>
            <Card style={styles.resourcesCard}>
              {GENERAL_UAS_RESOURCES.map((res, idx) => (
                <Pressable
                  key={`res-${idx}`}
                  onPress={() => { openLink(res.url).catch(() => {}); }}
                  style={[styles.resourceRow, idx < GENERAL_UAS_RESOURCES.length - 1 ? { borderBottomWidth: 1, borderBottomColor: theme.border } : undefined]}
                >
                  <Feather name={res.icon as any} size={16} color={theme.primary} />
                  <ThemedText style={[styles.resourceText, { color: theme.primary }]} numberOfLines={2}>
                    {res.title}
                  </ThemedText>
                  <Feather name="external-link" size={12} color={theme.textTertiary} />
                </Pressable>
              ))}
              {bundeslandAvInfo?.additionalDocs?.map((doc, idx) => (
                <Pressable
                  key={`bldoc-${idx}`}
                  onPress={() => { openLink(doc.url).catch(() => {}); }}
                  style={[styles.resourceRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
                >
                  <Feather name={doc.icon as any} size={16} color={theme.primary} />
                  <ThemedText style={[styles.resourceText, { color: theme.primary }]} numberOfLines={2}>
                    {doc.title}
                  </ThemedText>
                  <Feather name="external-link" size={12} color={theme.textTertiary} />
                </Pressable>
              ))}
            </Card>
          </View>
        ) : null}

        {complianceResult && complianceResult.items.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather
                name={complianceResult.overallStatus === "error" ? "alert-circle" : complianceResult.overallStatus === "warning" ? "alert-triangle" : "check-circle"}
                size={16}
                color={complianceResult.overallStatus === "error" ? "#FF3B30" : complianceResult.overallStatus === "warning" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759")}
              />
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: complianceResult.overallStatus === "error" ? "#FF3B30" : complianceResult.overallStatus === "warning" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759") },
                ]}
              >
                Compliance: {complianceResult.countryLabel}
              </ThemedText>
            </View>
            {complianceResult.items
              .sort((a, b) => {
                const order = { error: 0, warning: 1, ok: 2 };
                return order[a.level] - order[b.level];
              })
              .map((item) => {
                const itemColor = item.level === "error" ? "#FF3B30" : item.level === "warning" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759");
                const iconName = item.level === "error" ? "x-circle" : item.level === "warning" ? "alert-triangle" : "check-circle";
                return (
                  <Card key={item.id} style={[styles.complianceCard, { borderLeftWidth: 3, borderLeftColor: itemColor }]}>
                    <View style={styles.complianceCardHeader}>
                      <Feather name={iconName as any} size={16} color={itemColor} />
                      <View style={styles.complianceCardBadge}>
                        <View style={[styles.badge, { backgroundColor: itemColor }]}>
                          <ThemedText style={styles.badgeText}>
                            {item.category === "pilot" ? "Pilot" : item.category === "drone" ? "Drohne" : "Land"}
                          </ThemedText>
                        </View>
                      </View>
                    </View>
                    <ThemedText style={[styles.geozoneName, { marginTop: 4 }]}>{item.title}</ThemedText>
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, marginTop: 4 }]}>
                      {item.description}
                    </ThemedText>
                    {item.actionUrl ? (
                      <Pressable
                        onPress={() => { openLink(item.actionUrl!).catch(() => {}); }}
                        style={styles.complianceAction}
                      >
                        <Feather name="external-link" size={12} color={theme.primary} />
                        <ThemedText style={[styles.complianceActionText, { color: theme.primary }]}>
                          {item.actionLabel || "Mehr erfahren"}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.pilotField && pilotProfile ? (
                      <Pressable
                        onPress={async () => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const updated = { ...pilotProfile };
                          if (item.pilotField === "insuranceActive") {
                            updated.insuranceActive = true;
                          } else if (item.pilotField === "operatorId" && !updated.operatorId) {
                            return;
                          }
                          await savePilotProfile(updated);
                          setPilotProfile(updated);
                          if (droneProfile && countryIso) {
                            setComplianceResult(checkCountryCompliance(droneProfile, updated, countryIso));
                          }
                        }}
                        style={[styles.complianceAction, { marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.primary + "15", borderRadius: 6, alignSelf: "flex-start" }]}
                      >
                        <Feather name="check-circle" size={12} color={theme.primary} />
                        <ThemedText style={[styles.complianceActionText, { color: theme.primary, fontWeight: "600" }]}>
                          {item.pilotField === "insuranceActive" ? "Versicherung vorhanden" : item.pilotField === "operatorId" ? "Im Pilotenprofil nachtragen" : "Bestätigen"}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </Card>
                );
              })}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Weiter zu den Flugdetails"
          onPress={handleContinue}
          disabled={!canContinue}
          loading={loading}
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
  title: {
    ...Typography.h2,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  summaryText: {
    ...Typography.small,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: Spacing["2xl"],
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    gap: Spacing.md,
    borderLeftWidth: 3,
    marginBottom: Spacing.md,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  statusDesc: {
    ...Typography.caption,
    marginTop: 2,
  },
  statusText: {
    ...Typography.body,
    flex: 1,
  },
  geozoneSection: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  geozoneCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  geozoneCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  geozoneName: {
    ...Typography.body,
    fontWeight: "500",
  },
  geozoneDetails: {
    ...Typography.caption,
    marginTop: 4,
  },
  acknowledgeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  acknowledgeText: {
    ...Typography.caption,
    flex: 1,
    lineHeight: 18,
  },
  detailsLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  choiceOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  choiceTextContainer: {
    flex: 1,
  },
  choiceTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  choiceDesc: {
    ...Typography.caption,
    marginTop: 2,
  },
  notesSection: {
    marginTop: Spacing.md,
  },
  notesInput: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    minHeight: 80,
    textAlignVertical: "top",
    ...Typography.body,
  },
  complianceCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  complianceCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  complianceCardBadge: {
    flex: 1,
    alignItems: "flex-end",
  },
  complianceAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.sm,
    paddingVertical: 4,
  },
  complianceActionText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  ctrCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  ctrCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctrIcao: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  ctrAvRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  ctrAvText: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  ctrCallButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  ctrCallTextBlock: {
    flex: 1,
  },
  ctrCallLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  ctrCallNumber: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "monospace",
  },
  ctrRulesCard: {
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  ctrRulesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  ctrRulesTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  ctrRuleRow: {
    marginBottom: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  ctrRuleLabel: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  ctrRuleRange: {
    fontSize: 12,
    marginBottom: 2,
  },
  ctrRuleStatus: {
    fontSize: 12,
  },
  avWarningCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderLeftWidth: 3,
  },
  avWarningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  avWarningTitle: {
    ...Typography.body,
    fontWeight: "700",
    flex: 1,
  },
  avWarningBody: {
    ...Typography.caption,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  avInfoBlock: {
    marginBottom: Spacing.md,
  },
  avInfoLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: 2,
  },
  avInfoValue: {
    ...Typography.body,
    fontWeight: "500",
    marginBottom: Spacing.sm,
  },
  avLinkRow: {
    gap: Spacing.sm,
  },
  avLinkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  avLinkText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  resourcesCard: {
    padding: 0,
    overflow: "hidden",
  },
  resourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  resourceText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  avSettingsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  avSettingsText: {
    ...Typography.caption,
    fontWeight: "500",
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
  edrCriticalCard: {
    padding: 0,
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  edrLegalBanner: {
    flexDirection: "row",
    padding: Spacing.md,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  edrLegalBannerText: {
    flex: 1,
  },
  edrLegalTitle: {
    ...Typography.body,
    fontWeight: "700",
    fontSize: 14,
  },
  edrLegalBody: {
    ...Typography.caption,
    marginTop: 4,
    lineHeight: 18,
  },
  edrLegalBannerCompact: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  edrLegalCompactText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  edrInfoBlock: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  edrInfoLabel: {
    ...Typography.caption,
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    fontSize: 10,
    marginBottom: 2,
  },
  edrInfoValue: {
    ...Typography.body,
    fontWeight: "600",
    fontSize: 14,
  },
  edrInfoDetail: {
    ...Typography.caption,
    marginTop: 2,
  },
  edrZoneBadge: {
    flexDirection: "row",
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  edrZoneBadgeTitle: {
    ...Typography.body,
    fontWeight: "700",
    fontSize: 13,
  },
  edrZoneBadgeDesc: {
    ...Typography.caption,
    marginTop: 4,
    lineHeight: 17,
  },
  edrLinksBlock: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  edrAvConditionsCard: {
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  edrAvConditionsIntro: {
    ...Typography.caption,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  edrAvCondRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: 6,
  },
  edrAvCondText: {
    ...Typography.caption,
    flex: 1,
    lineHeight: 18,
  },
  edrExclusionBlock: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  edrExclusionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    marginBottom: Spacing.sm,
  },
  edrExclusionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 3,
  },
  edrExclusionText: {
    ...Typography.caption,
    flex: 1,
  },
  edrAcknowledgeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.md,
  },
  edrCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  edrAcknowledgeText: {
    ...Typography.caption,
    flex: 1,
    lineHeight: 18,
    fontWeight: "500",
  },
});
