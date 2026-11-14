import React, { useState, useLayoutEffect, useMemo, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
  Platform,
} from "react-native";
import MapView, { Circle, Marker, Callout, Polygon, Polyline, WMSTile } from "@/components/maps";
import { useRoute, useNavigation, RouteProp } from "@react-navigation/native";
import { HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import {
  buildDipulLink,
  buildWmsTileUrl,
  pointInZone,
  ringGroupsForZone,
} from "@/lib/geozones";
import { smoothRingGroup } from "@/lib/ringSimplify";
import { nativeMapBasemapProps } from "@/lib/mapBasemap";
import {
  MIL_LOW_FLIGHT_ACTIVATION_TEXT,
  MIL_LOW_FLIGHT_SOURCE_URL,
  MIL_LOW_FLIGHT_COLOR,
  buildMilLowFlightStatusMap,
  formatActivationWindow,
  getStatusColor as getMilStatusColor,
  getStatusFillColor as getMilStatusFillColor,
  getStatusStrokeColor as getMilStatusStrokeColor,
  getStatusLabel as getMilStatusLabel,
  findRouteIntersections,
  findAreasContainingPoint,
} from "@/lib/milLowFlight";
import type { DipulTempRestriction } from "@/lib/geozones";
import { formatBelgianNotamValidityRange } from "@/lib/ed269Notams";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningNotamMap">;

const ACTIVE_COLOR = "#FF3B30";
const UPCOMING_COLOR = "#5856D6";
const PILOT_COLOR = "#007AFF";

function formatDateRange(r: DipulTempRestriction): string {
  const belgianRange = formatBelgianNotamValidityRange(r);
  if (belgianRange != null) return belgianRange;
  if (r.validityUnknown) return "Gültigkeit im Quelldatensatz nicht angegeben";
  if (!r.startTs) return "";
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
  const startStr = new Date(r.startTs).toLocaleDateString("de-DE", opts);
  if (!r.endTs || r.endTsIndefinite) return `${startStr} — unbefristet`;
  const endStr = new Date(r.endTs).toLocaleDateString("de-DE", opts);
  if (startStr === endStr) return startStr;
  return `${startStr} — ${endStr}`;
}

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

export default function PlanningNotamMapScreen() {
  const [mapStyle] = useMapBasemapStyle();
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { theme } = useTheme();

  const { latitude, longitude, restrictions = [], routeWaypoints, milStatuses = [] } = route.params || { latitude: 51.1657, longitude: 10.4515, restrictions: [], milStatuses: [] };

  const routePoints = useMemo(() => {
    if (routeWaypoints && routeWaypoints.length >= 2) return routeWaypoints;
    return null;
  }, [routeWaypoints]);

  const milIntersections = useMemo(() => {
    const points = routePoints ?? [{ latitude, longitude }];
    return findRouteIntersections(points);
  }, [routePoints, latitude, longitude]);

  const intersectingAreaIds = useMemo(() => {
    const ids = new Set<string>();
    milIntersections.forEach((it) => ids.add(it.area.id));
    findAreasContainingPoint(latitude, longitude).forEach((a) => ids.add(a.id));
    return ids;
  }, [milIntersections, latitude, longitude]);

  const intersectingSegmentIndices = useMemo(() => {
    const idx = new Set<number>();
    milIntersections.forEach((it) => idx.add(it.segmentIndex));
    return idx;
  }, [milIntersections]);

  const [selectedRestriction, setSelectedRestriction] = useState<DipulTempRestriction | null>(null);

  const milStatusMap = useMemo(
    () => buildMilLowFlightStatusMap(milStatuses),
    [milStatuses]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: "NOTAM-Karte",
      headerRight: () => (
        <HeaderButton onPress={() => navigation.goBack()}>
          <Feather name="x" size={22} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme.text]);

  const typedRestrictions = restrictions as DipulTempRestriction[];

  const milLowFlightRestrictions = useMemo(() => typedRestrictions.filter((r) => r.kind === "mil_low_flight_day"), [typedRestrictions]);
  const activeRestrictions = useMemo(() => typedRestrictions.filter((r) => r.status === "active" && r.kind !== "mil_low_flight_day"), [typedRestrictions]);
  const upcomingRestrictions = useMemo(() => typedRestrictions.filter((r) => r.status === "upcoming"), [typedRestrictions]);

  const unmappedCount = useMemo(() => typedRestrictions.filter((r) => r.centerLat == null || r.centerLon == null).length, [typedRestrictions]);

  const handleMarkerPress = useCallback((r: DipulTempRestriction) => {
    setSelectedRestriction((prev) => (prev?.id === r.id ? null : r));
  }, []);

  const handleMapPress = useCallback((e: any) => {
    const { latitude: tapLat, longitude: tapLon } = e.nativeEvent.coordinate;
    const toRad = (d: number) => d * Math.PI / 180;
    const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    let best: DipulTempRestriction | null = null;
    let bestDist = Infinity;
    for (const r of typedRestrictions) {
      if (r.centerLat == null || r.centerLon == null) continue;
      const dist = haversineM(tapLat, tapLon, r.centerLat, r.centerLon);
      if ((r.polygonRings && r.polygonRings.length > 0) || (r.polygonGroups && r.polygonGroups.length > 0)) {
        if (pointInZone(tapLat, tapLon, r) && dist < bestDist) {
          best = r;
          bestDist = dist;
        }
      } else {
        const radius = r.radiusM ?? 5000;
        if (dist <= radius * 1.2 && dist < bestDist) {
          best = r;
          bestDist = dist;
        }
      }
    }
    setSelectedRestriction(best);
  }, [typedRestrictions]);

  const initialRegion = {
    latitude,
    longitude,
    latitudeDelta: 1.0,
    longitudeDelta: 1.0,
  };

  return (
    <ThemedView style={styles.container}>
      <MapView
        style={styles.map}
        {...nativeMapBasemapProps(mapStyle, Platform.OS)}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        showsScale
        onPress={handleMapPress}
      >
        <WMSTile
          urlTemplate={buildWmsTileUrl("temporaere_betriebseinschraenkungen")}
          zIndex={-1}
          opacity={0.8}
          tileSize={256}
        />
        <Marker
          coordinate={{ latitude, longitude }}
          pinColor={PILOT_COLOR}
          title="Flugstandort"
          zIndex={1000}
        />

        {milLowFlightRestrictions.map((r) => {
          if (!r.polygonRings || r.polygonRings.length === 0) return null;
          const areaId = r.id.replace(/^mil-low-flight-/, "");
          const highlight = intersectingAreaIds.has(areaId);
          const milStatus = milStatusMap[r.id]?.status ?? "inactive";
          const fill = getMilStatusFillColor(milStatus);
          const stroke = getMilStatusStrokeColor(milStatus);
          const pinColor = getMilStatusColor(milStatus);
          return (
            <React.Fragment key={`milLow-${r.id}`}>
              {ringGroupsForZone(r).map((group, ri) => {
                const [outer, ...holes] = smoothRingGroup(group);
                if (!outer || outer.length < 3) return null;
                return (
                  <Polygon
                    key={`milLow-${r.id}-poly-${ri}`}
                    coordinates={outer.map(([la, lo]) => ({ latitude: la, longitude: lo }))}
                    holes={holes.map((h) => h.map(([la, lo]) => ({ latitude: la, longitude: lo })))}
                    fillColor={fill}
                    strokeColor={stroke}
                    strokeWidth={highlight ? 3 : 2}
                    zIndex={highlight ? 8 : 3}
                    tappable
                    onPress={() => handleMarkerPress(r)}
                  />
                );
              })}
              {r.centerLat != null && r.centerLon != null ? (
                <Marker
                  coordinate={{ latitude: r.centerLat, longitude: r.centerLon }}
                  onPress={() => handleMarkerPress(r)}
                  anchor={{ x: 0.5, y: 1 }}
                  zIndex={80}
                  tracksViewChanges={false}
                >
                  <View style={[styles.pinLabel, { backgroundColor: pinColor }]}>
                    <ThemedText style={styles.pinLabelText} numberOfLines={1}>{r.name}</ThemedText>
                  </View>
                </Marker>
              ) : null}
            </React.Fragment>
          );
        })}

        {routePoints
          ? routePoints.slice(0, -1).map((p, i) => {
              const next = routePoints[i + 1];
              const isHit = intersectingSegmentIndices.has(i);
              return (
                <Polyline
                  key={`route-seg-${i}`}
                  coordinates={[
                    { latitude: p.latitude, longitude: p.longitude },
                    { latitude: next.latitude, longitude: next.longitude },
                  ]}
                  strokeColor={isHit ? MIL_LOW_FLIGHT_COLOR : PILOT_COLOR}
                  strokeWidth={isHit ? 5 : 3}
                  zIndex={isHit ? 50 : 20}
                />
              );
            })
          : null}

        {routePoints
          ? routePoints.map((p, i) => (
              <Marker
                key={`route-wp-${i}`}
                coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={500}
                tracksViewChanges={false}
              >
                <View style={[styles.waypointDot, { backgroundColor: PILOT_COLOR }]}>
                  <ThemedText style={styles.waypointText}>{i + 1}</ThemedText>
                </View>
              </Marker>
            ))
          : null}


        {activeRestrictions.map((r) => {
          if (r.centerLat == null || r.centerLon == null) return null;
          const lat = r.centerLat;
          const lon = r.centerLon;
          const hasPolygon = r.polygonRings && r.polygonRings.length > 0;
          return (
            <React.Fragment key={`active-${r.id}`}>
              {hasPolygon ? (
                ringGroupsForZone(r).map((group, ri) => {
                  const [outer, ...holes] = smoothRingGroup(group);
                  if (!outer || outer.length < 3) return null;
                  return (
                    <Polygon
                      key={`active-${r.id}-poly-${ri}`}
                      coordinates={outer.map(([la, lo]) => ({ latitude: la, longitude: lo }))}
                      holes={holes.map((h) => h.map(([la, lo]) => ({ latitude: la, longitude: lo })))}
                      fillColor="rgba(255,59,48,0.45)"
                      strokeColor={ACTIVE_COLOR}
                      strokeWidth={2}
                      zIndex={10}
                    />
                  );
                })
              ) : r.radiusM != null ? (
                <Circle
                  center={{ latitude: lat, longitude: lon }}
                  radius={r.radiusM}
                  fillColor="rgba(255,59,48,0.45)"
                  strokeColor={ACTIVE_COLOR}
                  strokeWidth={2}
                  zIndex={10}
                />
              ) : null}
              <Marker
                coordinate={{ latitude: lat, longitude: lon }}
                onPress={() => handleMarkerPress(r)}
                anchor={{ x: 0.5, y: 1 }}
                zIndex={100}
                tracksViewChanges={false}
              >
                <View style={[styles.pinLabel, { backgroundColor: r.name.startsWith("ED-R") ? ACTIVE_COLOR : "#FF9500" }]}>
                  <ThemedText style={styles.pinLabelText} numberOfLines={1}>{r.name}</ThemedText>
                </View>
              </Marker>
            </React.Fragment>
          );
        })}

        {upcomingRestrictions.map((r) => {
          if (r.centerLat == null || r.centerLon == null) return null;
          const lat = r.centerLat;
          const lon = r.centerLon;
          const hasPolygon = r.polygonRings && r.polygonRings.length > 0;
          return (
            <React.Fragment key={`upcoming-${r.id}`}>
              {hasPolygon ? (
                ringGroupsForZone(r).map((group, ri) => {
                  const [outer, ...holes] = smoothRingGroup(group);
                  if (!outer || outer.length < 3) return null;
                  return (
                    <Polygon
                      key={`upcoming-${r.id}-poly-${ri}`}
                      coordinates={outer.map(([la, lo]) => ({ latitude: la, longitude: lo }))}
                      holes={holes.map((h) => h.map(([la, lo]) => ({ latitude: la, longitude: lo })))}
                      fillColor="rgba(88,86,214,0.12)"
                      strokeColor={UPCOMING_COLOR}
                      strokeWidth={2}
                      zIndex={5}
                    />
                  );
                })
              ) : r.radiusM != null ? (
                <Circle
                  center={{ latitude: lat, longitude: lon }}
                  radius={r.radiusM}
                  fillColor="rgba(88,86,214,0.12)"
                  strokeColor={UPCOMING_COLOR}
                  strokeWidth={2}
                  zIndex={5}
                />
              ) : null}
              <Marker
                coordinate={{ latitude: lat, longitude: lon }}
                onPress={() => handleMarkerPress(r)}
                anchor={{ x: 0.5, y: 1 }}
                zIndex={90}
                tracksViewChanges={false}
              >
                <View style={[styles.pinLabel, { backgroundColor: UPCOMING_COLOR }]}>
                  <ThemedText style={styles.pinLabelText} numberOfLines={1}>{r.name}</ThemedText>
                </View>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapView>

      <View style={[styles.legend, { backgroundColor: theme.backgroundSecondary }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: ACTIVE_COLOR }]} />
          <ThemedText style={styles.legendText}>Aktiv ({activeRestrictions.length})</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: UPCOMING_COLOR }]} />
          <ThemedText style={styles.legendText}>Geplant ({upcomingRestrictions.length})</ThemedText>
        </View>
        {milLowFlightRestrictions.length > 0 ? (() => {
          const counts = { active: 0, upcoming: 0, inactive: 0 } as Record<"active"|"upcoming"|"inactive", number>;
          for (const r of milLowFlightRestrictions) {
            const s = milStatusMap[r.id]?.status ?? "inactive";
            counts[s] += 1;
          }
          const items: { label: string; color: string; count: number }[] = [
            { label: "Mil. Tiefflug aktiv", color: getMilStatusColor("active"), count: counts.active },
            { label: "Mil. Tiefflug demnächst", color: getMilStatusColor("upcoming"), count: counts.upcoming },
            { label: "Mil. Tiefflug inaktiv", color: getMilStatusColor("inactive"), count: counts.inactive },
          ].filter((it) => it.count > 0);
          return (
            <>
              {items.map((it) => (
                <View key={`mil-leg-${it.label}`} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: it.color }]} />
                  <ThemedText style={styles.legendText}>{it.label} ({it.count})</ThemedText>
                </View>
              ))}
            </>
          );
        })() : null}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: PILOT_COLOR }]} />
          <ThemedText style={styles.legendText}>Standort</ThemedText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: MIL_LOW_FLIGHT_COLOR }]} />
          <ThemedText style={styles.legendText}>Mil. Tiefflug{intersectingAreaIds.size > 0 ? ` (${intersectingAreaIds.size})` : ""}</ThemedText>
        </View>
      </View>

      {unmappedCount > 0 ? (
        <View style={[styles.unmappedBanner, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="info" size={12} color={theme.textTertiary} />
          <ThemedText style={[styles.unmappedText, { color: theme.textTertiary }]}>
            {unmappedCount} {unmappedCount === 1 ? "Beschränkung ohne Kartenposition" : "Beschränkungen ohne Kartenposition"}
          </ThemedText>
        </View>
      ) : null}

      {selectedRestriction ? (
        <View style={[styles.detailPanel, { backgroundColor: theme.background }]}>
          <Pressable onPress={() => setSelectedRestriction(null)} style={styles.detailClose}>
            <Feather name="x" size={18} color={theme.textSecondary} />
          </Pressable>
          <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
            {(() => {
              const milSel = selectedRestriction.kind === "mil_low_flight_day" ? milStatusMap[selectedRestriction.id] : null;
              const dotColor = milSel
                ? getMilStatusColor(milSel.status)
                : selectedRestriction.status === "active" ? ACTIVE_COLOR : UPCOMING_COLOR;
              const badgeLabel = milSel
                ? `Mil. Tiefflug — ${getMilStatusLabel(milSel.status)}`
                : selectedRestriction.status === "active" ? "Aktiv" : "Geplant";
              return (
                <>
                  <View style={styles.detailHeader}>
                    <View style={[styles.detailStatusDot, { backgroundColor: dotColor }]} />
                    <ThemedText style={[styles.detailName, { color: theme.text }]} numberOfLines={2}>
                      {selectedRestriction.name}
                    </ThemedText>
                  </View>
                  <View style={[styles.detailBadge, { backgroundColor: dotColor + "18" }]}>
                    <ThemedText style={[styles.detailBadgeText, { color: dotColor }]}>
                      {badgeLabel}
                    </ThemedText>
                  </View>
                </>
              );
            })()}
            {selectedRestriction.kind === "mil_low_flight_day" && milStatusMap[selectedRestriction.id] ? (() => {
              const milSel = milStatusMap[selectedRestriction.id]!;
              const color = getMilStatusColor(milSel.status);
              const window = formatActivationWindow(milSel);
              return (
                <>
                  <View style={styles.detailRow}>
                    <Feather name="map-pin" size={13} color={theme.textTertiary} />
                    <ThemedText style={[styles.detailValue, { color: theme.textSecondary }]}>{milSel.area.region}</ThemedText>
                  </View>
                  <View style={styles.detailRow}>
                    <Feather name="activity" size={13} color={color} />
                    <ThemedText style={[styles.detailValue, { color, fontWeight: "600" }]}>
                      {getMilStatusLabel(milSel.status)}{window ? ` · ${window}` : ""}
                    </ThemedText>
                  </View>
                </>
              );
            })() : null}

            <View style={styles.detailRow}>
              <Feather name="tag" size={13} color={theme.textTertiary} />
              <ThemedText style={[styles.detailValue, { color: theme.textSecondary }]}>{selectedRestriction.type}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <Feather name="calendar" size={13} color={theme.textTertiary} />
              <ThemedText style={[styles.detailValue, { color: theme.textSecondary }]}>{formatDateRange(selectedRestriction)}</ThemedText>
            </View>
            <View style={styles.detailRow}>
              <Feather name="arrow-up" size={13} color={theme.textTertiary} />
              <ThemedText style={[styles.detailValue, { color: theme.textSecondary }]}>{formatAltitude(selectedRestriction)}</ThemedText>
            </View>
            {selectedRestriction.legalExplanation ? (
              <View style={styles.detailRow}>
                <Feather name="info" size={13} color={theme.primary} />
                <ThemedText style={[styles.detailValue, { color: theme.primary, fontWeight: "600" }]}>{selectedRestriction.legalExplanation}</ThemedText>
              </View>
            ) : null}
            {selectedRestriction.legalRef ? (
              <View style={styles.detailRow}>
                <Feather name="book" size={13} color={theme.textTertiary} />
                <ThemedText style={[styles.detailValue, { color: theme.textSecondary }]}>{selectedRestriction.legalRef}</ThemedText>
              </View>
            ) : null}
            {selectedRestriction.kind === "mil_low_flight_day" ? (() => {
              const milSel = milStatusMap[selectedRestriction.id];
              const status = milSel?.status ?? "inactive";
              const color = getMilStatusColor(status);
              const intro =
                status === "active"
                  ? `Derzeit aktiv ${MIL_LOW_FLIGHT_ACTIVATION_TEXT}.`
                  : status === "upcoming"
                    ? `Demnächst aktiv ${MIL_LOW_FLIGHT_ACTIVATION_TEXT}.`
                    : `Derzeit nicht aktiv (${MIL_LOW_FLIGHT_ACTIVATION_TEXT}).`;
              return (
                <View style={[styles.detailRow, { backgroundColor: color + "18", padding: 8, borderRadius: 6, alignItems: "flex-start" }]}>
                  <Feather name="alert-triangle" size={13} color={color} style={{ marginTop: 2 }} />
                  <ThemedText style={[styles.detailValue, { color, fontWeight: "600", flex: 1 }]}>
                    {intro} Höhenband GND — 250 ft AGL. Vor Start NOTAMs prüfen.
                  </ThemedText>
                </View>
              );
            })() : null}
            {(() => {
              const isMil = selectedRestriction.kind === "mil_low_flight_day";
              const dipulUrl = isMil ? MIL_LOW_FLIGHT_SOURCE_URL : buildDipulLink(selectedRestriction.name);
              const linkColor = isMil ? "#7B8B3A" : selectedRestriction.status === "active" ? ACTIVE_COLOR : UPCOMING_COLOR;
              return (
                <Pressable
                  onPress={() => { WebBrowser.openBrowserAsync(dipulUrl || "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/").catch(() => {}); }}
                  style={styles.dipulLink}
                >
                  <Feather name="external-link" size={13} color={linkColor} />
                  <ThemedText style={[styles.dipulLinkText, { color: linkColor }]}>
                    {isMil ? "Karte und Details auf dipul.de" : dipulUrl ? "Details auf dipul.de" : "Alle Einschränkungen auf dipul.de"}
                  </ThemedText>
                </Pressable>
              );
            })()}
          </ScrollView>
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  waypointDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  waypointText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  pinLabel: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 40,
    alignItems: "center",
  },
  pinLabelText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  legend: {
    position: "absolute",
    top: 110,
    right: 12,
    flexDirection: "column",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 4 },
    }),
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    fontWeight: "600",
  },
  unmappedBanner: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 2 },
    }),
  },
  unmappedText: {
    fontSize: 11,
    fontWeight: "500",
    flex: 1,
  },
  detailPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: Dimensions.get("window").height * 0.35,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } },
      android: { elevation: 8 },
    }),
  },
  detailClose: {
    position: "absolute",
    top: 12,
    right: 16,
    zIndex: 10,
    padding: 4,
  },
  detailScroll: {
    flex: 1,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    paddingRight: 30,
  },
  detailStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  detailName: {
    ...Typography.callout,
    fontWeight: "700",
    flex: 1,
  },
  detailBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: Spacing.sm,
  },
  detailBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 6,
  },
  detailValue: {
    ...Typography.caption,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
  dipulLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    paddingVertical: 4,
  },
  dipulLinkText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
