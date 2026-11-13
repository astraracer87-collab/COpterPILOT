import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
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
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import {
  queryGeozonesInArea,
  GeozoneFeatureInfo,
  separateTempRestrictions,
  fetchNearbyTempRestrictions,
  DipulTempRestriction,
  DipulTempRestrictionsResult,
} from "@/lib/geozones";
import { findMilLowFlightAreasContaining, findMilLowFlightAreasIntersectingRadius, findMilLowFlightAreasOnRoute, MIL_LOW_FLIGHT_LABEL, MIL_LOW_FLIGHT_ACTIVATION_TEXT, MIL_LOW_FLIGHT_DATA_STAND, MIL_LOW_FLIGHT_SOURCE_URL } from "@/lib/milLowFlight";
import {
  getPilotProfile,
  PilotProfile,
  AV_GEOZONE_TYPES,
  updateFlightSession,
  getFlightSession,
  getDrone,
  DEFAULT_LIMITS,
  WeatherLimits,
} from "@/lib/storage";

type RouteParams = RouteProp<FlightCheckParamList, "PreCheckOverview">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "PreCheckOverview">;

function formatAltitude(r: DipulTempRestriction): string {
  const lower = r.lowerAlt === 0 && r.lowerAltRef === "AGL" ? "GND" : `${Math.round(r.lowerAlt)} ${r.lowerAltUnit} ${r.lowerAltRef}`;
  let upper: string;
  if (r.upperAltRef === "MSL") {
    const ft = Math.round(r.upperAlt * 3.28084);
    upper = ft >= 10000 ? `FL${Math.round(ft / 100)}` : `${Math.round(r.upperAlt)} ${r.upperAltUnit} MSL`;
  } else {
    upper = `${Math.round(r.upperAlt)} ${r.upperAltUnit} AGL`;
  }
  return `${lower} — ${upper}`;
}

function formatDateRange(r: DipulTempRestriction): string {
  if (!r.startTs) return "";
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
  const startStr = new Date(r.startTs).toLocaleDateString("de-DE", opts);
  if (!r.endTs || r.endTsIndefinite) return `${startStr} — unbefristet`;
  const endStr = new Date(r.endTs).toLocaleDateString("de-DE", opts);
  if (startStr === endStr) return startStr;
  return `${startStr} — ${endStr}`;
}

function daysRemaining(r: DipulTempRestriction): string | null {
  if (!r.endTs || r.endTsIndefinite) return "Dauerhaft";
  const now = new Date();
  const end = new Date(r.endTs);
  const diff = Math.ceil((end.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return null;
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  return `${diff} Tage`;
}

function daysUntilStart(r: DipulTempRestriction): string | null {
  if (!r.startTs) return null;
  const now = new Date();
  const start = new Date(r.startTs);
  const diff = Math.ceil((start.getTime() - now.getTime()) / 86400000);
  if (diff <= 0) return null;
  if (diff === 1) return "Ab morgen";
  return `In ${diff} Tagen`;
}

export default function PreCheckOverviewScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { sessionId, latitude, longitude, locationName, droneId } = route.params;

  const [geozones, setGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const [tempRestrictions, setTempRestrictions] = useState<GeozoneFeatureInfo[]>([]);
  const [notams, setNotams] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [geozoneLoading, setGeozoneLoading] = useState(true);
  const [notamLoading, setNotamLoading] = useState(true);
  const [geozoneError, setGeozoneError] = useState(false);
  const [notamError, setNotamError] = useState(false);
  const [pilotProfile, setPilotProfile] = useState<PilotProfile | null>(null);
  const [limits, setLimits] = useState<WeatherLimits>(DEFAULT_LIMITS);
  const [expandedNotams, setExpandedNotams] = useState<Set<string>>(new Set());
  const [geozoneChecked, setGeozoneChecked] = useState(false);
  const [notamChecked, setNotamChecked] = useState(false);
  const [planningRadiusKm, setPlanningRadiusKm] = useState<number | null>(null);
  const [planningMaxAltitude, setPlanningMaxAltitude] = useState<number | null>(null);

  useEffect(() => {
    getPilotProfile().then(setPilotProfile);
    if (droneId) {
      getDrone(droneId).then((d) => { if (d) setLimits(d.limits); });
    }
    if (sessionId) {
      getFlightSession(sessionId).then((s) => {
        setPlanningRadiusKm(s?.planning?.radiusKm ?? 1);
        if (s?.planning?.maxAltitude != null) setPlanningMaxAltitude(s.planning.maxAltitude);
      });
    } else {
      setPlanningRadiusKm(1);
    }
  }, [droneId, sessionId]);

  const searchRadiusKm = Math.max(planningRadiusKm ?? 1, 0.5);

  const loadGeozones = useCallback(async () => {
    setGeozoneLoading(true);
    setGeozoneError(false);
    try {
      const results = await queryGeozonesInArea(latitude, longitude, searchRadiusKm);
      const separated = separateTempRestrictions(results);
      setGeozones(separated.geozones);
      setTempRestrictions(separated.tempRestrictions);
    } catch {
      setGeozoneError(true);
    } finally {
      setGeozoneLoading(false);
    }
  }, [latitude, longitude, searchRadiusKm]);

  const loadNotams = useCallback(async () => {
    setNotamLoading(true);
    setNotamError(false);
    try {
      const data = await fetchNearbyTempRestrictions(latitude, longitude, searchRadiusKm);
      setNotams(data);
    } catch {
      setNotamError(true);
    } finally {
      setNotamLoading(false);
    }
  }, [latitude, longitude, searchRadiusKm]);

  useEffect(() => {
    if (planningRadiusKm != null) {
      loadGeozones();
      loadNotams();
    }
  }, [loadGeozones, loadNotams, planningRadiusKm]);

  const milLowFlightContaining = findMilLowFlightAreasContaining(latitude, longitude);
  const milLowFlightNearby = findMilLowFlightAreasIntersectingRadius(latitude, longitude, Math.max(planningRadiusKm ?? 1, 1));
  const sampledRoutePoints = React.useMemo(() => {
    const r = Math.max(planningRadiusKm ?? 1, 0.5);
    const points: Array<{ lat: number; lon: number }> = [{ lat: latitude, lon: longitude }];
    const latPerKm = 1 / 110.574;
    const lonPerKm = 1 / (111.32 * Math.cos((latitude * Math.PI) / 180));
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * 2 * Math.PI;
      points.push({
        lat: latitude + Math.sin(angle) * r * latPerKm,
        lon: longitude + Math.cos(angle) * r * lonPerKm,
      });
    }
    return points;
  }, [latitude, longitude, planningRadiusKm]);
  const milLowFlightOnRoute = findMilLowFlightAreasOnRoute(sampledRoutePoints);
  const mergedMilHitsMap = new Map<string, typeof milLowFlightContaining[number]>();
  for (const r of [...milLowFlightContaining, ...milLowFlightNearby, ...milLowFlightOnRoute]) {
    if (!mergedMilHitsMap.has(r.id)) mergedMilHitsMap.set(r.id, r);
  }
  const milLowFlightHits = Array.from(mergedMilHitsMap.values());
  const milLowFlightInside = milLowFlightContaining.length > 0;

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
  const hasAnyGeozones = geozones.length > 0 || tempRestrictions.length > 0;
  const totalNotams = notams.active.length + notams.upcoming.length;
  const hasAnyRestrictions = hasAnyGeozones || notams.active.length > 0;

  const loading = geozoneLoading || notamLoading;

  const canContinue = geozoneChecked && notamChecked;

  const allCoveredByAV = hasAnyGeozones && uncoveredGeozones.length === 0 && tempRestrictions.length === 0;

  const handleContinue = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const restrictionStatus: "approved" | "limited" | undefined =
      !hasAnyRestrictions
        ? undefined
        : allCoveredByAV
          ? "approved"
          : "limited";

    if (sessionId) {
      await updateFlightSession(sessionId, {
        hasRestrictions: hasAnyRestrictions,
        detectedGeozones: geozones.map((g) => g.name),
      });
    }

    navigation.navigate("Weather", {
      latitude,
      longitude,
      hasRestrictions: hasAnyRestrictions,
      restrictionStatus,
      droneId,
      sessionId,
    });
  };

  const toggleNotam = (id: string) => {
    setExpandedNotams((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNotamCard = (r: DipulTempRestriction) => {
    const isMilLowFlight = r.kind === "mil_low_flight_day";
    const isEDR = r.name.startsWith("ED-R");
    const isUpcoming = r.status === "upcoming";
    const borderColor = isMilLowFlight ? "#7B8B3A" : isUpcoming ? "#5856D6" : isEDR ? "#FF3B30" : "#FF9500";
    const statusColor = isMilLowFlight ? "#7B8B3A" : isUpcoming ? "#5856D6" : "#34C759";
    const statusLabel = isMilLowFlight ? "Mil. Tiefflug Tag" : isUpcoming ? "Zukünftig" : "Aktiv";
    const dateRange = formatDateRange(r);
    const remaining = isUpcoming ? daysUntilStart(r) : daysRemaining(r);
    const expanded = expandedNotams.has(r.id);

    return (
      <Pressable key={r.id} onPress={() => toggleNotam(r.id)}>
        <Card style={[styles.notamCard, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}>
          <View style={styles.notamHeader}>
            <View style={styles.notamHeaderLeft}>
              <View style={[styles.severityDot, { backgroundColor: borderColor }]} />
              <ThemedText style={styles.notamName} numberOfLines={expanded ? undefined : 1}>{r.name}</ThemedText>
            </View>
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.textTertiary} />
          </View>

          <View style={styles.notamMeta}>
            {dateRange ? (
              <View style={styles.notamDateRow}>
                <Feather name="calendar" size={10} color={theme.textSecondary} />
                <ThemedText style={[styles.notamDateText, { color: theme.textSecondary }]}>{dateRange}</ThemedText>
                {remaining ? (
                  <View style={[styles.remainingBadge, { backgroundColor: isUpcoming ? "#5856D620" : "#34C75920" }]}>
                    <ThemedText style={[styles.remainingText, { color: isUpcoming ? "#5856D6" : "#34C759" }]}>{remaining}</ThemedText>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.notamDateRow}>
              <Feather name="arrow-up" size={10} color={theme.textTertiary} />
              <ThemedText style={[styles.notamDateText, { color: theme.textTertiary }]}>{formatAltitude(r)}</ThemedText>
              <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
                <ThemedText style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</ThemedText>
              </View>
            </View>
          </View>

          {expanded ? (
            <View style={styles.notamDetails}>
              <View style={styles.detailRow}>
                <Feather name="info" size={11} color={theme.primary} />
                <ThemedText style={[styles.detailText, { color: theme.primary }]}>{r.legalExplanation}</ThemedText>
              </View>
              {r.legalRef ? (
                <View style={styles.detailRow}>
                  <Feather name="book" size={11} color={theme.textTertiary} />
                  <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>{r.legalRef}</ThemedText>
                </View>
              ) : null}
            </View>
          ) : null}
        </Card>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + 100,
          },
        ]}
      >
        <Card style={styles.locationCard}>
          <View style={styles.locationRow}>
            <Feather name="map-pin" size={16} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.locationName}>
                {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
              </ThemedText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md, marginTop: 2 }}>
                <ThemedText style={[styles.locationCoords, { color: theme.textTertiary }]}>
                  {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </ThemedText>
                {planningMaxAltitude != null ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Feather name="arrow-up" size={12} color={planningMaxAltitude > 120 ? theme.statusCaution : theme.primary} />
                    <ThemedText style={[styles.locationCoords, { color: planningMaxAltitude > 120 ? theme.statusCaution : theme.primary, fontWeight: "600" }]}>
                      {planningMaxAltitude}m AGL
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </Card>

        {milLowFlightHits.length > 0 ? (
          <Card style={[styles.locationCard, { borderLeftColor: "#7B8B3A", borderLeftWidth: 3, marginBottom: Spacing.lg }]}>
            <View style={styles.locationRow}>
              <Feather name="shield" size={18} color="#7B8B3A" />
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.locationName, { color: "#7B8B3A" }]}>
                  {MIL_LOW_FLIGHT_LABEL}
                </ThemedText>
                <ThemedText style={[styles.locationCoords, { color: theme.textSecondary, marginTop: 2 }]}>
                  {milLowFlightInside
                    ? `Standort innerhalb ${milLowFlightHits.map((m) => m.name).join(", ")}`
                    : `Geplanter Flugradius reicht in ${milLowFlightHits.map((m) => m.name).join(", ")}`}
                  {" "}— Aktivierung {MIL_LOW_FLIGHT_ACTIVATION_TEXT}. Vor Start aktuelle NOTAMs prüfen.
                </ThemedText>
                <ThemedText style={[styles.locationCoords, { color: theme.textTertiary, fontSize: 10, marginTop: 4 }]}>
                  Quelle: dipul.de (Approximation, Stand {MIL_LOW_FLIGHT_DATA_STAND})
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: "#4A90D9" + "20" }]}>
              <Feather name="layers" size={16} color="#4A90D9" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.sectionTitle}>Geozonen</ThemedText>
              <ThemedText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
                Einschränkungen im Fluggebiet ({searchRadiusKm >= 1 ? `${searchRadiusKm.toFixed(1)} km` : `${Math.round(searchRadiusKm * 1000)} m`})
              </ThemedText>
            </View>
            {!geozoneLoading ? (
              <View style={[
                styles.countBadge,
                { backgroundColor: hasAnyGeozones ? "#FF950020" : "#34C75920" },
              ]}>
                <ThemedText style={[
                  styles.countText,
                  { color: hasAnyGeozones ? "#FF9500" : "#34C759" },
                ]}>
                  {geozones.length + tempRestrictions.length}
                </ThemedText>
              </View>
            ) : null}
          </View>

          {geozoneLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>Geozonen werden geprüft...</ThemedText>
            </View>
          ) : geozoneError ? (
            <Card style={[styles.errorCard, { borderLeftColor: "#FF9500", borderLeftWidth: 3 }]}>
              <Feather name="alert-triangle" size={16} color="#FF9500" />
              <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
                Geozonen konnten nicht geladen werden
              </ThemedText>
              <Pressable onPress={loadGeozones}>
                <ThemedText style={{ color: theme.primary, fontWeight: "600", fontSize: 13 }}>Erneut versuchen</ThemedText>
              </Pressable>
            </Card>
          ) : !hasAnyGeozones ? (
            <Card style={[styles.statusCard, { borderLeftColor: "#34C759", borderLeftWidth: 3 }]}>
              <Feather name="check-circle" size={18} color="#34C759" />
              <ThemedText style={[styles.statusText, { color: "#34C759" }]}>
                Keine Geozonen-Einschränkungen
              </ThemedText>
            </Card>
          ) : (
            <View style={styles.geozoneList}>
              {coveredGeozones.length > 0 ? (
                <View>
                  <View style={styles.subSectionHeader}>
                    <Feather name="shield" size={12} color="#34C759" />
                    <ThemedText style={[styles.subSectionTitle, { color: "#34C759" }]}>
                      Durch AV abgedeckt ({coveredGeozones.length})
                    </ThemedText>
                  </View>
                  {coveredGeozones.map((gz, i) => (
                    <Card key={`cov-${i}`} style={[styles.geozoneCard, { borderLeftColor: "#34C759", borderLeftWidth: 2 }]}>
                      <View style={[styles.geozoneBadge, { backgroundColor: "#34C75920" }]}>
                        <ThemedText style={[styles.geozoneBadgeText, { color: "#34C759" }]}>{gz.layerLabel}</ThemedText>
                      </View>
                      <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                    </Card>
                  ))}
                </View>
              ) : null}

              {uncoveredGeozones.length > 0 ? (
                <View>
                  <View style={styles.subSectionHeader}>
                    <Feather name="alert-circle" size={12} color="#FF9500" />
                    <ThemedText style={[styles.subSectionTitle, { color: "#FF9500" }]}>
                      Weitere Geozonen ({uncoveredGeozones.length})
                    </ThemedText>
                  </View>
                  {uncoveredGeozones.map((gz, i) => (
                    <Card key={`uncov-${i}`} style={[styles.geozoneCard, { borderLeftColor: "#FF9500", borderLeftWidth: 2 }]}>
                      <View style={[styles.geozoneBadge, { backgroundColor: "#FF950020" }]}>
                        <ThemedText style={[styles.geozoneBadgeText, { color: "#FF9500" }]}>{gz.layerLabel}</ThemedText>
                      </View>
                      <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                      {gz.details ? (
                        <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={2}>{gz.details}</ThemedText>
                      ) : null}
                    </Card>
                  ))}
                </View>
              ) : null}

              {tempRestrictions.length > 0 ? (
                <View>
                  <View style={styles.subSectionHeader}>
                    <Feather name="alert-triangle" size={12} color="#FF3B30" />
                    <ThemedText style={[styles.subSectionTitle, { color: "#FF3B30" }]}>
                      Temporäre Beschränkungen ({tempRestrictions.length})
                    </ThemedText>
                  </View>
                  {tempRestrictions.map((tr, i) => (
                    <Card key={`temp-${i}`} style={[styles.geozoneCard, { borderLeftColor: "#FF3B30", borderLeftWidth: 2 }]}>
                      <View style={[styles.geozoneBadge, { backgroundColor: "#FF3B3020" }]}>
                        <ThemedText style={[styles.geozoneBadgeText, { color: "#FF3B30" }]}>Temporär</ThemedText>
                      </View>
                      <ThemedText style={styles.geozoneName}>{tr.name}</ThemedText>
                    </Card>
                  ))}
                </View>
              ) : null}
            </View>
          )}

          {!geozoneLoading ? (
            <Pressable
              onPress={() => { setGeozoneChecked(!geozoneChecked); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.checkRow,
                { borderColor: geozoneChecked ? "#34C759" : theme.border },
                geozoneChecked ? { backgroundColor: "#34C75910" } : undefined,
              ]}
            >
              <View style={[
                styles.checkbox,
                { borderColor: geozoneChecked ? "#34C759" : theme.textTertiary },
                geozoneChecked ? { backgroundColor: "#34C759" } : undefined,
              ]}>
                {geozoneChecked ? <Feather name="check" size={14} color="#fff" /> : null}
              </View>
              <ThemedText style={styles.checkText}>Geozonen geprüft und zur Kenntnis genommen</ThemedText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionIcon, { backgroundColor: "#F59E0B" + "20" }]}>
              <Feather name="file-text" size={16} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.sectionTitle}>NOTAMs / ED-R</ThemedText>
              <ThemedText style={[styles.sectionSubtitle, { color: theme.textSecondary }]}>
                Temporäre Flugbeschränkungen ({searchRadiusKm >= 1 ? `${searchRadiusKm.toFixed(1)} km` : `${Math.round(searchRadiusKm * 1000)} m`})
              </ThemedText>
            </View>
            {!notamLoading ? (
              <View style={[
                styles.countBadge,
                { backgroundColor: totalNotams > 0 ? "#FF950020" : "#34C75920" },
              ]}>
                <ThemedText style={[
                  styles.countText,
                  { color: totalNotams > 0 ? "#FF9500" : "#34C759" },
                ]}>
                  {totalNotams}
                </ThemedText>
              </View>
            ) : null}
          </View>

          {notamLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>NOTAMs werden geladen...</ThemedText>
            </View>
          ) : notamError ? (
            <Card style={[styles.errorCard, { borderLeftColor: "#FF9500", borderLeftWidth: 3 }]}>
              <Feather name="alert-triangle" size={16} color="#FF9500" />
              <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>
                NOTAMs konnten nicht geladen werden
              </ThemedText>
              <Pressable onPress={loadNotams}>
                <ThemedText style={{ color: theme.primary, fontWeight: "600", fontSize: 13 }}>Erneut versuchen</ThemedText>
              </Pressable>
            </Card>
          ) : totalNotams === 0 ? (
            <Card style={[styles.statusCard, { borderLeftColor: "#34C759", borderLeftWidth: 3 }]}>
              <Feather name="check-circle" size={18} color="#34C759" />
              <ThemedText style={[styles.statusText, { color: "#34C759" }]}>
                Keine aktiven NOTAMs im Umkreis
              </ThemedText>
            </Card>
          ) : (
            <View style={styles.notamList}>
              {notams.active.length > 0 ? (
                <View>
                  <View style={styles.subSectionHeader}>
                    <Feather name="zap" size={12} color="#FF9500" />
                    <ThemedText style={[styles.subSectionTitle, { color: "#FF9500" }]}>
                      Aktiv ({notams.active.length})
                    </ThemedText>
                  </View>
                  {notams.active.map(renderNotamCard)}
                </View>
              ) : null}
              {notams.upcoming.length > 0 ? (
                <View>
                  <View style={styles.subSectionHeader}>
                    <Feather name="clock" size={12} color="#5856D6" />
                    <ThemedText style={[styles.subSectionTitle, { color: "#5856D6" }]}>
                      Zukünftig ({notams.upcoming.length})
                    </ThemedText>
                  </View>
                  {notams.upcoming.map(renderNotamCard)}
                </View>
              ) : null}
            </View>
          )}

          {!notamLoading ? (
            <Pressable
              onPress={() => { setNotamChecked(!notamChecked); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.checkRow,
                { borderColor: notamChecked ? "#34C759" : theme.border },
                notamChecked ? { backgroundColor: "#34C75910" } : undefined,
              ]}
            >
              <View style={[
                styles.checkbox,
                { borderColor: notamChecked ? "#34C759" : theme.textTertiary },
                notamChecked ? { backgroundColor: "#34C759" } : undefined,
              ]}>
                {notamChecked ? <Feather name="check" size={14} color="#fff" /> : null}
              </View>
              <ThemedText style={styles.checkText}>NOTAMs geprüft und zur Kenntnis genommen</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Weiter zum Wetter-Check"
          onPress={handleContinue}
          disabled={!canContinue || loading}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  locationCard: {
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  locationName: {
    ...Typography.callout,
    fontWeight: "700",
  },
  locationCoords: {
    ...Typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: Spacing.md,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    ...Typography.callout,
    fontWeight: "700",
  },
  sectionSubtitle: {
    ...Typography.caption,
    fontSize: 11,
    marginTop: 1,
  },
  countBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  countText: {
    fontSize: 14,
    fontWeight: "800",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: Spacing.lg,
    justifyContent: "center",
  },
  loadingText: {
    ...Typography.body,
    fontSize: 14,
  },
  errorCard: {
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: {
    ...Typography.caption,
    flex: 1,
    fontSize: 13,
  },
  statusCard: {
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusText: {
    ...Typography.callout,
    fontWeight: "600",
  },
  geozoneList: {
    gap: Spacing.sm,
  },
  subSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 4,
  },
  subSectionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 12,
  },
  geozoneCard: {
    padding: Spacing.sm,
    marginBottom: 6,
  },
  geozoneBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  geozoneBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  geozoneName: {
    ...Typography.caption,
    fontWeight: "600",
    fontSize: 13,
  },
  geozoneDetails: {
    ...Typography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderWidth: 1.5,
    borderRadius: BorderRadius.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkText: {
    ...Typography.caption,
    fontWeight: "600",
    fontSize: 13,
    flex: 1,
  },
  notamList: {
    gap: Spacing.sm,
  },
  notamCard: {
    padding: Spacing.sm,
    marginBottom: 6,
  },
  notamHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  notamHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  notamName: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 13,
    flex: 1,
  },
  notamMeta: {
    marginTop: 4,
    gap: 3,
  },
  notamDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  notamDateText: {
    ...Typography.caption,
    fontSize: 11,
  },
  remainingBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: 4,
  },
  remainingText: {
    fontSize: 9,
    fontWeight: "700",
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    marginLeft: "auto",
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: "700",
  },
  notamDetails: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.3)",
    gap: 4,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  detailText: {
    ...Typography.caption,
    fontSize: 11,
    flex: 1,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.2)",
  },
});
