import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Dimensions,
  useColorScheme,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useRoute, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Location from "@/lib/location";
import * as WebBrowser from "@/lib/webBrowser";
import MapView, { Circle, Marker, Polygon, WMSTile } from "@/components/maps";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { NotamsStackParamList } from "@/navigation/NotamsStackNavigator";
import {
  fetchAllTempRestrictions,
  DipulTempRestriction,
  DipulTempRestrictionsResult,
  buildDipulLink,
} from "@/lib/geozones";
import { MIL_LOW_FLIGHT_SOURCE_URL, MIL_LOW_FLIGHT_ACTIVATION_TEXT } from "@/lib/milLowFlight";
import {
  buildWmsTileUrl,
  buildCombinedWmsTileUrl,
  getCountriesInRadius,
  pointInPolygon,
  queryGeozoneFeatureInfo,
  GeozoneFeatureInfo,
  fetchAllLuZonesAsNotams,
  getCountryGeozoneConfig,
  LU_TEMP_ZONE_LABEL,
  separateTempRestrictions,
} from "@/lib/geozones";
import {
  deriveMilLowFlightStatuses,
  formatActivationWindow,
  getStatusColor,
  getStatusLabel,
  getStatusFillColor,
  getStatusStrokeColor,
  buildMilLowFlightStatusMap,
  MilLowFlightAreaStatus,
  isMilLowFlightLikelyActive,
} from "@/lib/milLowFlight";
import { detectCountryFromCoordinates, getCountryMapConfig, getCountryDefaultCenter } from "@/lib/countryMaps";
import { getCached, setCache } from "@/lib/dataCache";
import { getSettings } from "@/lib/storage";
import { setActiveNotamCount } from "@/lib/notamAlertStore";

type RouteParams = RouteProp<NotamsStackParamList, "Notams">;

function altWithMeters(value: number, unit: string): string {
  const u = (unit || "").toLowerCase();
  if (u === "ft") {
    const m = Math.round(value * 0.3048);
    return `${Math.round(value)} ft (≈ ${m} m)`;
  }
  if (u === "m") {
    const ft = Math.round(value * 3.28084);
    return `${Math.round(value)} m (≈ ${ft} ft)`;
  }
  return `${Math.round(value)} ${unit}`;
}

function formatAltitude(r: DipulTempRestriction): string {
  const lower = r.lowerAlt === 0 && r.lowerAltRef === "AGL" ? "GND" : `${altWithMeters(r.lowerAlt, r.lowerAltUnit)} ${r.lowerAltRef}`;
  let upper: string;
  if (r.upperAltRef === "MSL") {
    const ft = Math.round(r.upperAlt * 3.28084);
    upper = ft >= 10000 ? `FL${Math.round(ft / 100)}` : `${altWithMeters(r.upperAlt, r.upperAltUnit)} MSL`;
  } else {
    upper = `${altWithMeters(r.upperAlt, r.upperAltUnit)} AGL`;
  }
  return `${lower} — ${upper}`;
}

function altitudeExplanation(r: DipulTempRestriction): string {
  if (r.upperAltRef === "AGL") {
    const unit = r.upperAltUnit || "m";
    return `Max. ${Math.round(r.upperAlt)} ${unit} über Grund — die Drohne darf nicht höher als ${Math.round(r.upperAlt)} ${unit} über den Boden am Startpunkt fliegen.`;
  }
  if (r.upperAltRef === "MSL") {
    return `Max. ${Math.round(r.upperAlt)} m über Meeresspiegel (NN) — absolute Höhenbegrenzung unabhängig von der Geländehöhe. In hügeliger Umgebung kann die erlaubte Flughöhe über Grund geringer sein.`;
  }
  return "";
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

function formatRecurRule(rules: string[]): string | null {
  if (!rules || rules.length === 0) return null;
  const rule = rules[0];
  if (rule.includes("FREQ=DAILY")) return "Täglich aktiv";
  if (rule.includes("FREQ=WEEKLY")) return "Wöchentlich aktiv";
  if (rule.includes("FREQ=MONTHLY")) return "Monatlich aktiv";
  return "Wiederkehrend";
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

function RestrictionCard({ restriction, theme, onShowOnMap }: { restriction: DipulTempRestriction; theme: any; onShowOnMap?: (lat: number, lon: number, id?: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isMilLowFlight = restriction.kind === "mil_low_flight_day";
  const isEDR = restriction.name.startsWith("ED-R");
  const isUpcoming = restriction.status === "upcoming";
  const milLikelyActive = isMilLowFlight ? isMilLowFlightLikelyActive() : false;
  const borderColor = isMilLowFlight
    ? milLikelyActive ? "#7B8B3A" : "#8E8E93"
    : isUpcoming ? "#5856D6" : isEDR ? "#FF3B30" : "#FF9500";
  const statusColor = borderColor;
  const statusLabel = isMilLowFlight
    ? milLikelyActive ? "Mil. Tiefflug Tag (aktiv)" : "Mil. Tiefflug Tag (jetzt nicht aktiv)"
    : isUpcoming ? "Zukünftig" : "Aktiv";
  const statusIcon = isMilLowFlight ? "shield" : isUpcoming ? "clock" : "zap";
  const dipulUrl = isMilLowFlight ? MIL_LOW_FLIGHT_SOURCE_URL : buildDipulLink(restriction.name);
  const dateRange = formatDateRange(restriction);
  const remaining = isUpcoming ? daysUntilStart(restriction) : daysRemaining(restriction);

  const categoryIcon = restriction.category === "military" ? "shield" : restriction.category === "nature" ? "feather" : restriction.category === "notam" ? "file-text" : "alert-circle";

  const hasCoords = restriction.centerLat != null && restriction.centerLon != null;

  return (
    <Pressable onPress={() => setExpanded(!expanded)} testID={`restriction-card-${restriction.id}`}>
      <Card style={[styles.card, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.severityDot, { backgroundColor: borderColor }]} />
            <ThemedText style={styles.cardName} numberOfLines={2}>{restriction.name}</ThemedText>
            <View style={[styles.typeBadge, { backgroundColor: borderColor + "20" }]}>
              <ThemedText style={[styles.typeBadgeText, { color: borderColor }]}>
                {restriction.type}
              </ThemedText>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {hasCoords && onShowOnMap ? (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); onShowOnMap(restriction.centerLat!, restriction.centerLon!, restriction.id); }}
                hitSlop={8}
                style={[styles.mapIconBtn, { backgroundColor: borderColor + "15" }]}
              >
                <Feather name="map" size={14} color={borderColor} />
              </Pressable>
            ) : null}
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
          </View>
        </View>

        {dateRange ? (
          <View style={styles.dateRow}>
            <Feather name="calendar" size={11} color={theme.textSecondary} />
            <ThemedText style={[styles.dateText, { color: theme.textSecondary }]}>
              {dateRange}
            </ThemedText>
            {remaining ? (
              <View style={[styles.remainingBadge, { backgroundColor: isUpcoming ? "#5856D620" : remaining === "Heute" || remaining === "Morgen" ? "#FF3B3020" : "#34C75920" }]}>
                <ThemedText style={[styles.remainingText, { color: isUpcoming ? "#5856D6" : remaining === "Heute" || remaining === "Morgen" ? "#FF3B30" : "#34C759" }]}>
                  {remaining}
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.cardMeta}>
          <View style={styles.metaRow}>
            <Feather name="arrow-up" size={11} color={theme.textTertiary} />
            <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>
              {formatAltitude(restriction)}
            </ThemedText>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
            <Feather name={statusIcon as any} size={9} color={statusColor} />
            <ThemedText style={[styles.statusBadgeText, { color: statusColor }]}>
              {statusLabel}
            </ThemedText>
          </View>
        </View>

        {isMilLowFlight ? (
          <View style={[styles.altExplainBox, { backgroundColor: "#7B8B3A" + "12", marginTop: 6 }]}>
            <Feather name="alert-triangle" size={11} color="#7B8B3A" />
            <ThemedText style={[styles.altExplainText, { color: "#7B8B3A", fontWeight: "600" }]}>
              Aktiv {MIL_LOW_FLIGHT_ACTIVATION_TEXT}. Höhenband GND — 250 ft AGL. Vor Start NOTAMs prüfen.
            </ThemedText>
          </View>
        ) : null}

        {expanded ? (
          <View style={styles.cardDetails}>
            <View style={styles.detailRow}>
              <Feather name={categoryIcon as any} size={12} color={theme.primary} />
              <ThemedText style={[styles.detailText, { color: theme.primary, fontWeight: "600" }]}>
                {restriction.legalExplanation}
              </ThemedText>
            </View>
            {restriction.legalRef ? (
              <View style={styles.detailRow}>
                <Feather name="book" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  {restriction.legalRef}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Feather name="arrow-down" size={12} color={theme.textTertiary} />
              <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                Untergrenze: {restriction.lowerAlt === 0 && restriction.lowerAltRef === "AGL" ? "GND (Boden)" : `${altWithMeters(restriction.lowerAlt, restriction.lowerAltUnit)} ${restriction.lowerAltRef}`}
              </ThemedText>
            </View>
            <View style={styles.detailRow}>
              <Feather name="arrow-up" size={12} color={theme.textTertiary} />
              <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                Obergrenze: {altWithMeters(restriction.upperAlt, restriction.upperAltUnit)} {restriction.upperAltRef}
              </ThemedText>
            </View>
            {altitudeExplanation(restriction) ? (
              <View style={[styles.altExplainBox, { backgroundColor: theme.backgroundSecondary || "#F2F2F7" }]}>
                <Feather name="info" size={11} color={theme.textTertiary} />
                <ThemedText style={[styles.altExplainText, { color: theme.textTertiary }]}>
                  {altitudeExplanation(restriction)}
                </ThemedText>
              </View>
            ) : null}
            {restriction.startTs ? (
              <View style={styles.detailRow}>
                <Feather name="play" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Beginn: {new Date(restriction.startTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr
                </ThemedText>
              </View>
            ) : null}
            {restriction.endTs ? (
              <View style={styles.detailRow}>
                <Feather name="square" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Ende: {restriction.endTsIndefinite ? "Unbefristet (Dauerhaft aktiv)" : `${new Date(restriction.endTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr`}
                </ThemedText>
              </View>
            ) : null}
            {restriction.recurRules ? (
              <View style={styles.detailRow}>
                <Feather name="repeat" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  {formatRecurRule(restriction.recurRules)}
                </ThemedText>
              </View>
            ) : null}
            {restriction.genNames && restriction.genNames.length > 0 && restriction.genNames[0] !== restriction.name ? (
              <View style={styles.detailRow}>
                <Feather name="tag" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textTertiary }]}>
                  {restriction.genNames.join(", ")}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Feather name="hash" size={12} color={theme.textTertiary} />
              <ThemedText style={[styles.detailText, { color: theme.textTertiary }]} numberOfLines={1}>
                {restriction.extRef || restriction.id}
              </ThemedText>
            </View>
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); WebBrowser.openBrowserAsync(dipulUrl || "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/").catch(() => {}); }}
              style={styles.dipulLink}
            >
              <Feather name="external-link" size={12} color={borderColor} />
              <ThemedText style={[styles.dipulLinkText, { color: borderColor }]}>
                {isMilLowFlight ? "Karte und Details auf dipul.de" : dipulUrl ? "Details auf dipul.de" : "Alle Einschränkungen auf dipul.de"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

function SectionHeader({ title, count, color, icon, theme }: { title: string; count: number; color: string; icon: string; theme: any }) {
  return (
    <View style={[styles.sectionHeader, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <Feather name={icon as any} size={14} color={color} />
      <ThemedText style={[styles.sectionTitle, { color: theme.text }]}>{title}</ThemedText>
      <View style={[styles.sectionCount, { backgroundColor: color + "20" }]}>
        <ThemedText style={[styles.sectionCountText, { color }]}>{count}</ThemedText>
      </View>
    </View>
  );
}

function NotamMapView({ restrictions, milStatusMap, centerLat, centerLon, focusLat, focusLon, focusId }: {
  restrictions: DipulTempRestriction[];
  milStatusMap: Record<string, MilLowFlightAreaStatus>;
  centerLat: number;
  centerLon: number;
  focusLat?: number;
  focusLon?: number;
  focusId?: string;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark
    ? { bg: "#1C1C1E", text: "#FFFFFF", textSec: "#AEAEB2", border: "#38383A", primary: "#0A84FF" }
    : { bg: "#FFFFFF", text: "#000000", textSec: "#6C6C70", border: "#E5E5EA", primary: "#007AFF" };
  const mapRef = React.useRef<MapView>(null);
  const [selectedRestriction, setSelectedRestriction] = useState<DipulTempRestriction | null>(null);
  const [isProximityMatch, setIsProximityMatch] = useState(false);
  const [wmsZones, setWmsZones] = useState<GeozoneFeatureInfo[]>([]);
  const [wmsLoading, setWmsLoading] = useState(false);
  const [pinCoord, setPinCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapType, setMapType] = useState<"standard" | "satellite">("standard");

  const defaultCenter = { latitude: centerLat, longitude: centerLon };
  const defaultDelta = { latitudeDelta: 2.0, longitudeDelta: 2.0 };

  const mappedRestrictions = restrictions.filter((r) => r.centerLat != null && r.centerLon != null);

  useEffect(() => {
    if (focusLat != null && focusLon != null && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: focusLat,
        longitude: focusLon,
        latitudeDelta: 0.15,
        longitudeDelta: 0.15,
      }, 500);
    }
  }, [focusLat, focusLon]);

  const [currentRegion, setCurrentRegion] = useState({
    latitude: centerLat, longitude: centerLon, latitudeDelta: 2.0, longitudeDelta: 2.0,
  });

  const NOTAM_ONLY_LAYERS: Record<string, string[]> = useMemo(() => ({
    DE: ["temporaere_betriebseinschraenkungen"],
    LU: ["1927", "1928"],
  }), []);

  const wmsUrlsPerCountry = useMemo(() => {
    const viewRadiusKm = Math.max(
      (currentRegion.latitudeDelta || 0) * 111.32 / 2,
      (currentRegion.longitudeDelta || 0) * 111.32 * Math.cos((currentRegion.latitude * Math.PI) / 180) / 2,
      80
    );
    const countries = getCountriesInRadius(currentRegion.latitude, currentRegion.longitude, viewRadiusKm);
    return countries
      .filter((iso) => NOTAM_ONLY_LAYERS[iso] && NOTAM_ONLY_LAYERS[iso].length > 0)
      .map((iso) => ({ iso, url: buildCombinedWmsTileUrl(NOTAM_ONLY_LAYERS[iso], iso) }));
  }, [currentRegion.latitude, currentRegion.longitude, currentRegion.latitudeDelta, currentRegion.longitudeDelta, NOTAM_ONLY_LAYERS]);

  const toRad = (d: number) => d * Math.PI / 180;
  const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const findRestrictionAt = useCallback((latitude: number, longitude: number): { restriction: DipulTempRestriction | null; isProximity: boolean } => {
    let best: DipulTempRestriction | null = null;
    let bestDist = Infinity;
    let nearestFallback: DipulTempRestriction | null = null;
    let nearestFallbackDist = Infinity;
    const MAX_PROXIMITY_M = 15000;
    for (const r of restrictions) {
      if (r.centerLat == null || r.centerLon == null) continue;
      const dist = haversineM(latitude, longitude, r.centerLat, r.centerLon);
      if (r.polygonRings && r.polygonRings.length > 0) {
        if (pointInPolygon(latitude, longitude, r.polygonRings) && dist < bestDist) {
          best = r;
          bestDist = dist;
        }
      } else {
        const radius = r.radiusM ?? 5000;
        if (dist <= radius * 1.5 && dist < bestDist) {
          best = r;
          bestDist = dist;
        }
      }
      if (!best && dist < nearestFallbackDist && dist <= MAX_PROXIMITY_M) {
        nearestFallback = r;
        nearestFallbackDist = dist;
      }
    }
    if (best) return { restriction: best, isProximity: false };
    if (nearestFallback) return { restriction: nearestFallback, isProximity: true };
    return { restriction: null, isProximity: false };
  }, [restrictions]);

  const matchDipulRestriction = useCallback((zone: GeozoneFeatureInfo): DipulTempRestriction | null => {
    for (const r of restrictions) {
      if (r.name === zone.name) return r;
      if (r.extRef && zone.details.includes(r.extRef)) return r;
      if (zone.featureId && r.id === zone.featureId) return r;
      for (const n of r.names) {
        if (n === zone.name) return r;
      }
    }
    return null;
  }, [restrictions]);

  const queryWmsAtPoint = useCallback(async (latitude: number, longitude: number) => {
    setWmsLoading(true);
    setWmsZones([]);
    try {
      const tapCountry = detectCountryFromCoordinates(latitude, longitude) ?? undefined;
      const config = getCountryGeozoneConfig(tapCountry);
      const allLayers = config.layers.map(l => l.wmsLayer);
      const mapSize = 512;
      const latDelta = 0.01;
      const lonDelta = 0.01;
      const results = await queryGeozoneFeatureInfo(
        allLayers.length > 0 ? allLayers : ["temporaere_betriebseinschraenkungen"],
        latitude, longitude, mapSize, mapSize, latDelta, lonDelta, tapCountry
      );
      const { tempRestrictions, geozones } = separateTempRestrictions(results);
      setWmsZones(tempRestrictions.length > 0 ? tempRestrictions : geozones.length > 0 ? geozones : results);
    } catch {
      setWmsZones([]);
    } finally {
      setWmsLoading(false);
    }
  }, []);

  const handleMapPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPinCoord({ latitude, longitude });
    const { restriction, isProximity } = findRestrictionAt(latitude, longitude);
    setSelectedRestriction(restriction);
    setIsProximityMatch(isProximity);
    queryWmsAtPoint(latitude, longitude);
  }, [findRestrictionAt, queryWmsAtPoint]);

  const handleMapLongPress = useCallback((e: any) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPinCoord({ latitude, longitude });
    const { restriction, isProximity } = findRestrictionAt(latitude, longitude);
    setSelectedRestriction(restriction);
    setIsProximityMatch(isProximity);
    queryWmsAtPoint(latitude, longitude);
  }, [findRestrictionAt, queryWmsAtPoint]);

  const iosMapType = mapType === "satellite" ? "hybridFlyover" : (Platform.OS === "ios" ? "mutedStandard" : "standard");

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        mapType={iosMapType as any}
        initialRegion={{
          latitude: focusLat ?? defaultCenter.latitude,
          longitude: focusLon ?? defaultCenter.longitude,
          latitudeDelta: focusLat != null ? 0.15 : defaultDelta.latitudeDelta,
          longitudeDelta: focusLon != null ? 0.15 : defaultDelta.longitudeDelta,
        }}
        showsUserLocation
        showsMyLocationButton
        onPress={handleMapPress}
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={(region) => setCurrentRegion(region)}
      >
        {wmsUrlsPerCountry.map(({ iso, url }) => url ? (
          <WMSTile
            key={`wms-notam-${iso}`}
            urlTemplate={url}
            zIndex={-1}
            opacity={isDark ? 0.5 : 0.65}
            tileSize={256}
          />
        ) : null)}
        {mappedRestrictions.map((r) => {
          const isActive = r.status === "active";
          const isEDR = r.name.startsWith("ED-R");
          const isMilLowFlight = r.kind === "mil_low_flight_day";
          const milStatus = isMilLowFlight ? milStatusMap[r.id]?.status ?? "inactive" : null;
          const isFocused = focusId === r.id;
          const dimmed = focusId != null && !isFocused;
          const fillColor = dimmed
            ? "rgba(128,128,128,0.04)"
            : isMilLowFlight && milStatus
              ? getStatusFillColor(milStatus)
              : isActive
                ? (isEDR ? "rgba(255,59,48,0.45)" : "rgba(255,149,0,0.15)")
                : "rgba(88,86,214,0.12)";
          const strokeColor = dimmed
            ? "rgba(128,128,128,0.15)"
            : isMilLowFlight && milStatus
              ? getStatusStrokeColor(milStatus)
              : isActive
                ? (isEDR ? "rgba(255,59,48,1)" : "rgba(255,149,0,0.7)")
                : "rgba(88,86,214,0.5)";
          const hasPolygon = r.polygonRings && r.polygonRings.length > 0;
          return (
            <React.Fragment key={r.id}>
              {hasPolygon ? (
                r.polygonRings!.map((ring, ri) => (
                  <Polygon
                    key={`${r.id}-poly-${ri}`}
                    coordinates={ring.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                    fillColor={fillColor}
                    strokeColor={strokeColor}
                    strokeWidth={isFocused ? 3 : dimmed ? 1 : 2}
                  />
                ))
              ) : (
                <Circle
                  center={{ latitude: r.centerLat!, longitude: r.centerLon! }}
                  radius={r.radiusM ?? 5000}
                  fillColor={fillColor}
                  strokeColor={strokeColor}
                  strokeWidth={isFocused ? 3 : dimmed ? 1 : 2}
                />
              )}
            </React.Fragment>
          );
        })}
        {pinCoord ? (
          <Marker
            coordinate={pinCoord}
            pinColor="#007AFF"
            zIndex={300}
          />
        ) : null}
      </MapView>

      <View style={mapStyles.mapTypeSelector}>
        <Pressable
          onPress={() => setMapType("standard")}
          style={[mapStyles.mapTypeBtn, mapType === "standard" ? { backgroundColor: theme.primary } : { backgroundColor: theme.bg + "E8" }]}
        >
          <Feather name="map" size={14} color={mapType === "standard" ? "#FFFFFF" : theme.text} />
          <ThemedText style={[mapStyles.mapTypeBtnText, { color: mapType === "standard" ? "#FFFFFF" : theme.text }]}>Normal</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setMapType("satellite")}
          style={[mapStyles.mapTypeBtn, mapType === "satellite" ? { backgroundColor: theme.primary } : { backgroundColor: theme.bg + "E8" }]}
        >
          <Feather name="globe" size={14} color={mapType === "satellite" ? "#FFFFFF" : theme.text} />
          <ThemedText style={[mapStyles.mapTypeBtnText, { color: mapType === "satellite" ? "#FFFFFF" : theme.text }]}>Satellit</ThemedText>
        </Pressable>
      </View>

      {pinCoord && !selectedRestriction && !wmsLoading && wmsZones.length > 0 ? (
        <ScrollView
          style={[mapStyles.infoPanel, { backgroundColor: theme.bg, borderColor: theme.border, maxHeight: 300 }]}
          contentContainerStyle={{ paddingBottom: 4 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={mapStyles.infoPanelHeader}>
            <View style={{ flex: 1 }}>
              <ThemedText style={[mapStyles.infoPanelTitle, { color: "#FF9500" }]}>
                {wmsZones.length} Beschränkung{wmsZones.length !== 1 ? "en" : ""}
              </ThemedText>
            </View>
            <Pressable onPress={() => { setPinCoord(null); setSelectedRestriction(null); setWmsZones([]); }} hitSlop={12}>
              <Feather name="x" size={20} color={theme.textSec} />
            </Pressable>
          </View>
          {wmsZones.map((z, i) => {
            const dipulMatch = matchDipulRestriction(z);
            const statusColor = dipulMatch ? (dipulMatch.status === "active" ? "#FF9500" : "#5856D6") : "#4A90D9";
            const statusLabel = dipulMatch ? (dipulMatch.status === "active" ? "Aktiv" : "Zukünftig") : null;
            return (
              <View key={`wms-${i}`} style={{ marginTop: i === 0 ? 8 : 12, paddingTop: i === 0 ? 0 : 10, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  <View style={[mapStyles.infoPanelBadge, { backgroundColor: statusColor + "18" }]}>
                    <ThemedText style={[mapStyles.infoPanelBadgeText, { color: statusColor }]}>{z.layerLabel}</ThemedText>
                  </View>
                  {statusLabel ? (
                    <View style={[mapStyles.infoPanelBadge, { backgroundColor: statusColor + "18" }]}>
                      <ThemedText style={[mapStyles.infoPanelBadgeText, { color: statusColor }]}>{statusLabel}</ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText style={[mapStyles.infoPanelTitle, { color: theme.text, fontSize: 14 }]} numberOfLines={2}>{z.name}</ThemedText>
                {dipulMatch ? (
                  (() => {
                    const catIcon = dipulMatch.category === "military" ? "shield" : dipulMatch.category === "nature" ? "feather" : dipulMatch.category === "notam" ? "file-text" : "alert-circle";
                    const dateRange = formatDateRange(dipulMatch);
                    const remaining = dipulMatch.status === "upcoming" ? daysUntilStart(dipulMatch) : daysRemaining(dipulMatch);
                    const isMilLowFlightMatch = dipulMatch.kind === "mil_low_flight_day";
                    const dipulUrl = isMilLowFlightMatch ? MIL_LOW_FLIGHT_SOURCE_URL : buildDipulLink(dipulMatch.name);
                    return (
                      <View style={{ marginTop: 6, gap: 5 }}>
                        {dipulMatch.type ? (
                          <View style={[mapStyles.infoPanelBadge, { backgroundColor: statusColor + "18", alignSelf: "flex-start" }]}>
                            <ThemedText style={[mapStyles.infoPanelBadgeText, { color: statusColor }]}>{dipulMatch.type}</ThemedText>
                          </View>
                        ) : null}
                        {isMilLowFlightMatch ? (
                          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5, backgroundColor: "#7B8B3A18", padding: 6, borderRadius: 6 }}>
                            <Feather name="alert-triangle" size={11} color="#7B8B3A" style={{ marginTop: 2 }} />
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: "#7B8B3A", fontWeight: "600", flex: 1 }]}>
                              Aktiv {MIL_LOW_FLIGHT_ACTIVATION_TEXT}. Höhenband GND — 250 ft AGL. Vor Start NOTAMs prüfen.
                            </ThemedText>
                          </View>
                        ) : null}
                        {dipulMatch.legalExplanation ? (
                          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 5 }}>
                            <Feather name={catIcon as any} size={12} color={theme.primary} style={{ marginTop: 2 }} />
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.primary, fontWeight: "600", flex: 1 }]} numberOfLines={2}>{dipulMatch.legalExplanation}</ThemedText>
                          </View>
                        ) : null}
                        {dipulMatch.legalRef ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                            <Feather name="book" size={11} color={theme.textSec} />
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>{dipulMatch.legalRef}</ThemedText>
                          </View>
                        ) : null}
                        <View style={mapStyles.infoPanelAltRow}>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>Untere Grenze</ThemedText>
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text, fontWeight: "600" }]}>
                              {dipulMatch.lowerAlt === 0 && dipulMatch.lowerAltRef === "AGL" ? "GND (Boden)" : `${Math.round(dipulMatch.lowerAlt)} ${dipulMatch.lowerAltUnit} ${dipulMatch.lowerAltRef}`}
                            </ThemedText>
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>Obere Grenze</ThemedText>
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text, fontWeight: "600" }]}>
                              {Math.round(dipulMatch.upperAlt)} {dipulMatch.upperAltUnit} {dipulMatch.upperAltRef}
                              {dipulMatch.upperAltRef === "MSL" ? ` (${Math.round(dipulMatch.upperAlt * 3.28084)} ft)` : ""}
                            </ThemedText>
                          </View>
                        </View>
                        {dipulMatch.startTs ? (
                          <View style={{ gap: 3 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <Feather name="play" size={11} color={theme.textSec} />
                              <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>
                                Beginn: {new Date(dipulMatch.startTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr
                              </ThemedText>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <Feather name="square" size={11} color={theme.textSec} />
                              <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>
                                Ende: {dipulMatch.endTsIndefinite ? "Unbefristet (Dauerhaft aktiv)" : dipulMatch.endTs ? `${new Date(dipulMatch.endTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr` : "—"}
                              </ThemedText>
                            </View>
                          </View>
                        ) : null}
                        {dateRange ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <Feather name="calendar" size={11} color={theme.textSec} />
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>{dateRange}</ThemedText>
                            {remaining ? (
                              <View style={[mapStyles.infoPanelBadge, { backgroundColor: dipulMatch.status === "upcoming" ? "#5856D620" : remaining === "Heute" || remaining === "Morgen" ? "#FF3B3020" : "#34C75920" }]}>
                                <ThemedText style={[mapStyles.infoPanelBadgeText, { color: dipulMatch.status === "upcoming" ? "#5856D6" : remaining === "Heute" || remaining === "Morgen" ? "#FF3B30" : "#34C759" }]}>{remaining}</ThemedText>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                        {dipulMatch.recurRules ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                            <Feather name="repeat" size={11} color={theme.textSec} />
                            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>{formatRecurRule(dipulMatch.recurRules)}</ThemedText>
                          </View>
                        ) : null}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <Feather name="hash" size={11} color={theme.textSec} />
                          <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, fontSize: 10 }]} numberOfLines={1}>{dipulMatch.extRef || dipulMatch.id}</ThemedText>
                        </View>
                        <Pressable
                          onPress={() => { WebBrowser.openBrowserAsync(dipulUrl || "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/").catch(() => {}); }}
                          style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}
                        >
                          <Feather name="external-link" size={11} color={statusColor} />
                          <ThemedText style={[mapStyles.infoPanelDetails, { color: statusColor, fontWeight: "600" }]}>
                            {isMilLowFlightMatch ? "Karte und Details auf dipul.de" : dipulUrl ? "Details auf dipul.de" : "Alle Einschränkungen auf dipul.de"}
                          </ThemedText>
                        </Pressable>
                      </View>
                    );
                  })()
                ) : (
                  (() => {
                    const details = z.details.split("\n").filter((d: string) => d.trim().length > 0);
                    return details.length > 0 ? details.slice(0, 5).map((line: string, li: number) => {
                      const parts = line.split(":");
                      return parts.length >= 2 ? (
                        <View key={li} style={{ flexDirection: "row", gap: 6, marginTop: 3 }}>
                          <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, fontWeight: "600", minWidth: 60 }]}>{parts[0].trim()}</ThemedText>
                          <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text, flex: 1 }]} numberOfLines={2}>{parts.slice(1).join(":").trim()}</ThemedText>
                        </View>
                      ) : (
                        <ThemedText key={li} style={[mapStyles.infoPanelDetails, { color: theme.textSec, marginTop: 2 }]} numberOfLines={2}>{line}</ThemedText>
                      );
                    }) : null;
                  })()
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {pinCoord && !selectedRestriction && !wmsLoading && wmsZones.length === 0 ? (
        <View style={[mapStyles.infoPanel, { backgroundColor: theme.bg, borderColor: theme.border }]}>
          <View style={mapStyles.infoPanelHeader}>
            <View style={{ flex: 1 }}>
              <ThemedText style={[mapStyles.infoPanelTitle, { color: "#34C759" }]}>Keine Einschränkung erkannt</ThemedText>
              <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, marginTop: 4 }]}>
                An dieser Position wurde keine zuordenbare Beschränkung gefunden. Prüfe ggf. die Listenansicht oder dipul.de für aktuelle Einschränkungen.
              </ThemedText>
            </View>
            <Pressable onPress={() => { setPinCoord(null); setSelectedRestriction(null); setWmsZones([]); }} hitSlop={12}>
              <Feather name="x" size={20} color={theme.textSec} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {pinCoord && !selectedRestriction && wmsLoading ? (
        <View style={[mapStyles.infoPanel, { backgroundColor: theme.bg, borderColor: theme.border }]}>
          <View style={mapStyles.infoPanelHeader}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator size="small" color={theme.primary} />
              <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>Beschränkungen werden geprüft…</ThemedText>
            </View>
            <Pressable onPress={() => { setPinCoord(null); setSelectedRestriction(null); setWmsZones([]); setWmsLoading(false); }} hitSlop={12}>
              <Feather name="x" size={20} color={theme.textSec} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {selectedRestriction ? (
        <ScrollView
          style={[mapStyles.infoPanel, { backgroundColor: theme.bg, borderColor: theme.border, maxHeight: 280 }]}
          contentContainerStyle={{ paddingBottom: 4 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={mapStyles.infoPanelHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ThemedText style={[mapStyles.infoPanelTitle, { color: theme.text, flex: 1 }]} numberOfLines={2}>
                  {selectedRestriction.name}
                </ThemedText>
                {(() => {
                  const milSel = selectedRestriction.kind === "mil_low_flight_day"
                    ? milStatusMap[selectedRestriction.id]
                    : null;
                  const badgeColor = milSel
                    ? getStatusColor(milSel.status)
                    : selectedRestriction.status === "active" ? "#FF9500" : "#5856D6";
                  const badgeLabel = milSel
                    ? `Mil. Tiefflug — ${getStatusLabel(milSel.status)}`
                    : selectedRestriction.status === "active" ? "Aktiv" : "Zukünftig";
                  return (
                    <View style={[mapStyles.infoPanelBadge, { backgroundColor: badgeColor + "18" }]}>
                      <ThemedText style={[mapStyles.infoPanelBadgeText, { color: badgeColor }]}>
                        {badgeLabel}
                      </ThemedText>
                    </View>
                  );
                })()}
              </View>
              {isProximityMatch ? (
                <ThemedText style={[mapStyles.infoPanelDetails, { color: "#FF9500", fontSize: 11, marginTop: 2 }]}>
                  Nächstgelegene Einschränkung (nicht punktgenau)
                </ThemedText>
              ) : null}
              {selectedRestriction.type ? (
                <ThemedText style={[mapStyles.infoPanelLayer, { color: theme.textSec }]}>
                  {selectedRestriction.type}
                </ThemedText>
              ) : null}
            </View>
            <Pressable onPress={() => { setSelectedRestriction(null); setPinCoord(null); setWmsZones([]); }} hitSlop={12}>
              <Feather name="x" size={20} color={theme.textSec} />
            </Pressable>
          </View>
          <View style={{ marginTop: 8, gap: 6 }}>
            {selectedRestriction.legalExplanation ? (
              <View style={mapStyles.infoPanelRow}>
                <Feather name={selectedRestriction.category === "military" ? "shield" : selectedRestriction.category === "nature" ? "feather" : "alert-circle"} size={13} color={theme.primary} />
                <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text, fontWeight: "600", flex: 1 }]}>
                  {selectedRestriction.legalExplanation}
                </ThemedText>
              </View>
            ) : null}
            {selectedRestriction.kind === "mil_low_flight_day" ? (() => {
              const milSel = milStatusMap[selectedRestriction.id];
              if (!milSel) return null;
              const color = getStatusColor(milSel.status);
              const window = formatActivationWindow(milSel);
              return (
                <View style={{ gap: 4 }}>
                  <View style={mapStyles.infoPanelRow}>
                    <Feather name="map-pin" size={13} color={theme.textSec} />
                    <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, flex: 1 }]}>
                      {milSel.area.region}
                    </ThemedText>
                  </View>
                  <View style={mapStyles.infoPanelRow}>
                    <Feather name="activity" size={13} color={color} />
                    <ThemedText style={[mapStyles.infoPanelDetails, { color, fontWeight: "600", flex: 1 }]}>
                      {getStatusLabel(milSel.status)}{window ? ` · ${window}` : ""}
                    </ThemedText>
                  </View>
                  {milSel.status === "inactive" ? (
                    <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, fontSize: 11 }]}>
                      Keine aktive AUP/UUP- oder NOTAM-Aktivierung gefunden — vor Start aktuelle NOTAMs prüfen.
                    </ThemedText>
                  ) : null}
                </View>
              );
            })() : null}
            <View style={mapStyles.infoPanelAltRow}>
              <View style={{ flex: 1 }}>
                <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>Untere Grenze</ThemedText>
                <ThemedText style={[mapStyles.infoPanelAltValue, { color: theme.text }]}>
                  {selectedRestriction.lowerAlt === 0 && selectedRestriction.lowerAltRef === "AGL" ? "GND" : `${altWithMeters(selectedRestriction.lowerAlt, selectedRestriction.lowerAltUnit)} ${selectedRestriction.lowerAltRef}`}
                </ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>Obere Grenze</ThemedText>
                <ThemedText style={[mapStyles.infoPanelAltValue, { color: theme.text }]}>
                  {(() => {
                    const r = selectedRestriction;
                    if (r.upperAltRef === "MSL") {
                      const ft = Math.round(r.upperAlt * 3.28084);
                      return ft >= 10000 ? `FL${Math.round(ft / 100)}` : `${altWithMeters(r.upperAlt, r.upperAltUnit)} MSL`;
                    }
                    return `${altWithMeters(r.upperAlt, r.upperAltUnit)} ${r.upperAltRef}`;
                  })()}
                </ThemedText>
              </View>
            </View>
            {selectedRestriction.startTs ? (
              <View style={mapStyles.infoPanelAltRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>Startzeit</ThemedText>
                  <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text }]}>
                    {new Date(selectedRestriction.startTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>Endzeit</ThemedText>
                  <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text }]}>
                    {selectedRestriction.endTsIndefinite ? "Unbefristet" : selectedRestriction.endTs ? new Date(selectedRestriction.endTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </ThemedText>
                </View>
              </View>
            ) : null}
            {selectedRestriction.legalRef ? (
              <View style={mapStyles.infoPanelRow}>
                <Feather name="book" size={12} color={theme.textSec} />
                <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec }]}>
                  {selectedRestriction.legalRef}
                </ThemedText>
              </View>
            ) : null}
            <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, opacity: 0.5, fontSize: 10 }]}>
              Identifikation{"\n"}{selectedRestriction.id}
            </ThemedText>
          </View>
          <Pressable
            onPress={() => {
              const link = selectedRestriction.kind === "mil_low_flight_day" ? MIL_LOW_FLIGHT_SOURCE_URL : buildDipulLink(selectedRestriction.name);
              if (link) WebBrowser.openBrowserAsync(link);
            }}
            style={[mapStyles.dipulLink, { borderColor: theme.border }]}
          >
            <Feather name="external-link" size={12} color={theme.primary} />
            <ThemedText style={[mapStyles.dipulLinkText, { color: theme.primary }]}>{selectedRestriction.kind === "mil_low_flight_day" ? "Karte und Details auf dipul.de" : "Details auf dipul.de"}</ThemedText>
          </Pressable>
          {wmsZones.length > 0 ? (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
              <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec, marginBottom: 6 }]}>Weitere Geozonen an dieser Position</ThemedText>
              {wmsZones.map((z, i) => {
                const details = z.details.split("\n").filter((d: string) => d.trim().length > 0);
                return (
                  <View key={`wms-sel-${i}`} style={{ marginTop: i === 0 ? 0 : 10, paddingTop: i === 0 ? 0 : 8, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                    <View style={[mapStyles.infoPanelBadge, { backgroundColor: "#4A90D920", alignSelf: "flex-start", marginBottom: 4 }]}>
                      <ThemedText style={[mapStyles.infoPanelBadgeText, { color: "#4A90D9" }]}>{z.layerLabel}</ThemedText>
                    </View>
                    <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text, fontWeight: "600" }]} numberOfLines={2}>{z.name}</ThemedText>
                    {details.slice(0, 3).map((line: string, li: number) => (
                      <ThemedText key={li} style={[mapStyles.infoPanelDetails, { color: theme.textSec, marginTop: 2, fontSize: 10 }]} numberOfLines={1}>{line}</ThemedText>
                    ))}
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

const mapStyles = StyleSheet.create({
  mapTypeSelector: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    gap: 6,
  },
  mapTypeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  mapTypeBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  infoPanel: {
    position: "absolute",
    bottom: 16,
    left: 12,
    right: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  infoPanelHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  infoPanelTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  infoPanelLayer: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  infoPanelBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  infoPanelBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  infoPanelText: {
    fontSize: 13,
    marginLeft: 8,
  },
  infoPanelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoPanelAltRow: {
    flexDirection: "row",
    gap: 12,
  },
  infoPanelLabel: {
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  infoPanelAltValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  infoPanelDetails: {
    fontSize: 12,
    lineHeight: 18,
  },
  infoPanelMore: {
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 8,
  },
  dipulLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dipulLinkText: {
    fontSize: 12,
    fontWeight: "600",
  },
});

export default function NotamsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const route = useRoute<RouteParams>();

  const locationLat = route.params?.latitude;
  const locationLon = route.params?.longitude;
  const locationName = route.params?.locationName;

  const [currentLat, setCurrentLat] = useState<number | undefined>(locationLat);
  const [currentLon, setCurrentLon] = useState<number | undefined>(locationLon);
  // Land kommt jetzt ausschließlich aus den Einstellungen (preferredCountryIso).
  // null = Settings noch nicht geladen → keine Daten anzeigen.
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const s = await getSettings();
          if (active) setDetectedCountry((s.preferredCountryIso || "DE").toUpperCase());
        } catch {
          if (active) setDetectedCountry("DE");
        }
      })();
      return () => { active = false; };
    }, [])
  );
  const [result, setResult] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [luTsaZones, setLuTsaZones] = useState<{ nomZone: string; description: string; status: string; nature: string; dateRange: string; altitude: string; remarks: string; durPrev: string; resp: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<"liste" | "karte">("karte");
  const [mapFocusLat, setMapFocusLat] = useState<number | undefined>();
  const [mapFocusLon, setMapFocusLon] = useState<number | undefined>();
  const [mapFocusId, setMapFocusId] = useState<string | undefined>();

  useEffect(() => {
    if (currentLat != null && currentLon != null) return;
    if (!detectedCountry) return; // warte bis preferredCountryIso geladen ist
    const c = getCountryDefaultCenter(detectedCountry);
    const fallbackLat = c.lat;
    const fallbackLon = c.lon;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setCurrentLat(loc.coords.latitude);
          setCurrentLon(loc.coords.longitude);
        } else {
          setCurrentLat(fallbackLat);
          setCurrentLon(fallbackLon);
        }
      } catch {
        setCurrentLat(fallbackLat);
        setCurrentLon(fallbackLon);
      }
    })();
  }, [detectedCountry]);

  const parseLuRaw = useCallback((raw: any[]) => raw.map((r: any) => {
    const lines = (r.iteme || "").split("\n");
    const get = (prefix: string) => lines.find((l: string) => l.startsWith(prefix))?.replace(prefix, "").trim() || "";
    return {
      nomZone: (r.itema?.[0]) || "",
      description: lines[0] || "",
      status: get("Status: "),
      nature: get("Art: "),
      dateRange: [get("Von: "), get("Bis: ")].filter(Boolean).join(" — "),
      altitude: get("Höhe: "),
      remarks: get("Hinweis: "),
      durPrev: get("Vorankündigung: "),
      resp: get("Zuständigkeit: "),
    };
  }), []);

  const loadRestrictions = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await fetchAllTempRestrictions();
      setResult(data);
      setCache("dipul_restrictions", data).catch(() => {});
    } catch {
      setError("Fehler beim Laden der temporären Beschränkungen");
    } finally {
      setLoading(false);
    }
    (async () => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000));
        const raw = await Promise.race([fetchAllLuZonesAsNotams(), timeoutPromise]);
        const parsed = parseLuRaw(raw);
        setLuTsaZones(parsed);
        setCache("lu_tsa_zones", raw).catch(() => {});
      } catch {
        setLuTsaZones([]);
      }
    })();
  }, [parseLuRaw]);

  useEffect(() => {
    (async () => {
      const [cachedDipul, cachedLu] = await Promise.all([
        getCached<DipulTempRestrictionsResult>("dipul_restrictions"),
        getCached<any[]>("lu_tsa_zones"),
      ]);
      if (cachedDipul) setResult(cachedDipul.data);
      if (cachedLu) setLuTsaZones(parseLuRaw(cachedLu.data));
      if (cachedDipul || cachedLu) setLoading(false);
      loadRestrictions();
    })();
  }, [loadRestrictions, parseLuRaw]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRestrictions();
    setRefreshing(false);
  }, [loadRestrictions]);

  const showDe = detectedCountry === "DE" || detectedCountry == null;
  const showLu = detectedCountry === "LU" || detectedCountry == null;
  const filteredActive = showDe ? result.active : [];
  const filteredUpcoming = showDe ? result.upcoming : [];
  const milLowFlightStatuses = useMemo(
    () => (showDe ? deriveMilLowFlightStatuses(result) : []),
    [showDe, result]
  );
  const milActiveCount = milLowFlightStatuses.filter((s) => s.status === "active").length;
  const milUpcomingCount = milLowFlightStatuses.filter((s) => s.status === "upcoming").length;
  const filteredLuTsa = showLu ? luTsaZones : [];

  const allRestrictions = useMemo(() => (showDe ? [...result.active, ...result.upcoming] : []), [result, showDe]);
  const milStatusMap = useMemo(() => buildMilLowFlightStatusMap(milLowFlightStatuses), [milLowFlightStatuses]);

  const handleShowOnMap = useCallback((lat: number, lon: number, id?: string) => {
    setMapFocusLat(lat);
    setMapFocusLon(lon);
    setMapFocusId(id);
    setViewMode("karte");
  }, []);

  const totalCount = filteredActive.length + filteredUpcoming.length + filteredLuTsa.length;
  const activeCount = filteredActive.length + filteredLuTsa.filter((z) => z.status === "Aktiv").length;
  const upcomingCount = filteredUpcoming.length;
  const luCount = filteredLuTsa.length;

  // Aktive NOTAM-Anzahl in den globalen Store schreiben, damit der NOTAM-Tab
  // im Bottom-Navigator rot pulsieren kann, wenn aktive Beschränkungen
  // vorliegen.
  useEffect(() => {
    setActiveNotamCount(activeCount);
  }, [activeCount]);

  const tabBg = theme.backgroundSecondary;
  const activeTabBg = theme.primary;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.tabBar, { paddingTop: headerHeight + Spacing.sm, backgroundColor: theme.background }]}>
        <View style={[styles.tabRow, { backgroundColor: tabBg }]}>
          <Pressable
            onPress={() => { setViewMode("karte"); setMapFocusLat(undefined); setMapFocusLon(undefined); setMapFocusId(undefined); }}
            style={[styles.tab, viewMode === "karte" ? { backgroundColor: activeTabBg } : undefined]}
          >
            <Feather name="map" size={14} color={viewMode === "karte" ? "#FFFFFF" : theme.textSecondary} />
            <ThemedText style={[styles.tabText, { color: viewMode === "karte" ? "#FFFFFF" : theme.textSecondary }]}>
              Karte
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setViewMode("liste")}
            style={[styles.tab, viewMode === "liste" ? { backgroundColor: activeTabBg } : undefined]}
          >
            <Feather name="list" size={14} color={viewMode === "liste" ? "#FFFFFF" : theme.textSecondary} />
            <ThemedText style={[styles.tabText, { color: viewMode === "liste" ? "#FFFFFF" : theme.textSecondary }]}>
              Liste
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {viewMode === "liste" ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={{
            paddingTop: Spacing.sm,
            paddingBottom: tabBarHeight + Spacing.xl,
            paddingHorizontal: Spacing.lg,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
        >
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.primary} />
              <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
                Beschränkungen werden geladen...
              </ThemedText>
            </View>
          ) : error ? (
            <Card style={styles.errorCard}>
              <Feather name="alert-triangle" size={24} color="#FF9500" />
              <ThemedText style={[styles.errorTitle, { color: theme.text }]}>Abfrage fehlgeschlagen</ThemedText>
              <ThemedText style={[styles.errorText, { color: theme.textSecondary }]}>{error}</ThemedText>
              <Pressable onPress={loadRestrictions} style={[styles.retryBtn, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.retryBtnText}>Erneut versuchen</ThemedText>
              </Pressable>
            </Card>
          ) : (
            <>
              <View style={styles.statsRow}>
                <View style={[styles.statBadge, { backgroundColor: theme.backgroundSecondary }]}>
                  <ThemedText style={[styles.statValue, { color: theme.text }]}>{totalCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Gesamt</ThemedText>
                </View>
                {activeCount > 0 ? (
                  <View style={[styles.statBadge, { backgroundColor: "rgba(255,149,0,0.1)" }]}>
                    <ThemedText style={[styles.statValue, { color: "#FF9500" }]}>{activeCount}</ThemedText>
                    <ThemedText style={[styles.statLabel, { color: "#FF9500" }]}>Aktiv</ThemedText>
                  </View>
                ) : null}
                {upcomingCount > 0 ? (
                  <View style={[styles.statBadge, { backgroundColor: "rgba(88,86,214,0.1)" }]}>
                    <ThemedText style={[styles.statValue, { color: "#5856D6" }]}>{upcomingCount}</ThemedText>
                    <ThemedText style={[styles.statLabel, { color: "#5856D6" }]}>Zukünftig</ThemedText>
                  </View>
                ) : null}
              </View>

              <View style={[styles.scopeBanner, { backgroundColor: "rgba(0,122,255,0.08)" }]}>
                <Feather name="globe" size={14} color={theme.primary} />
                <ThemedText style={[styles.scopeBannerText, { color: theme.primary }]}>
                  {detectedCountry === "LU" ? "Luxemburg — UAS-Beschränkungen" : detectedCountry === "CH" ? "Schweiz — Drohnenbeschränkungen" : detectedCountry === "NL" ? "Niederlande — Drohnenbeschränkungen" : "Deutschland — dipul (temp. Beschränkungen)"}
                </ThemedText>
              </View>

              {totalCount === 0 ? (
                !showDe && !showLu ? (
                  <Card style={styles.emptyCard}>
                    <Feather name="info" size={32} color="#FF9500" />
                    <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>Keine NOTAM-Quelle für {detectedCountry}</ThemedText>
                    <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                      Für das gewählte Land stehen aktuell keine NOTAM- oder Geozonen-Daten zur Verfügung. Bitte konsultieren Sie die offiziellen Luftraum-Informationen Ihres Landes (z. B. AIP, eAIP, nationale Luftfahrtbehörde).
                    </ThemedText>
                  </Card>
                ) : (
                  <Card style={styles.emptyCard}>
                    <Feather name="check-circle" size={32} color="#34C759" />
                    <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>Keine temporären Beschränkungen</ThemedText>
                    <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                      Derzeit sind keine temporären Betriebseinschränkungen aktiv oder geplant.
                    </ThemedText>
                  </Card>
                )
              ) : null}

              {filteredActive.filter((r) => r.kind === "mil_low_flight_day").length > 0 ? (
                <>
                  <SectionHeader
                    title="Mil. Tieffluggebiete (Tag)"
                    count={filteredActive.filter((r) => r.kind === "mil_low_flight_day").length}
                    color="#7B8B3A"
                    icon="shield"
                    theme={theme}
                  />
                  {filteredActive.filter((r) => r.kind === "mil_low_flight_day").map((r) => (
                    <RestrictionCard key={r.id} restriction={r} theme={theme} onShowOnMap={handleShowOnMap} />
                  ))}
                </>
              ) : null}

              {filteredActive.filter((r) => r.kind !== "mil_low_flight_day").length > 0 ? (
                <>
                  <SectionHeader title="Aktuell aktiv" count={filteredActive.filter((r) => r.kind !== "mil_low_flight_day").length} color="#FF3B30" icon="zap" theme={theme} />
                  {filteredActive.filter((r) => r.kind !== "mil_low_flight_day").map((r) => (
                    <RestrictionCard key={r.id} restriction={r} theme={theme} onShowOnMap={handleShowOnMap} />
                  ))}
                </>
              ) : null}

              {filteredUpcoming.length > 0 ? (
                <>
                  <SectionHeader title="Zukünftig geplant" count={filteredUpcoming.length} color="#5856D6" icon="clock" theme={theme} />
                  {filteredUpcoming.map((r) => (
                    <RestrictionCard key={r.id} restriction={r} theme={theme} onShowOnMap={handleShowOnMap} />
                  ))}
                </>
              ) : null}

              {filteredLuTsa.length > 0 ? (
                <>
                  {showDe && showLu ? (
                    <View style={[styles.scopeBanner, { backgroundColor: "rgba(88,86,214,0.08)", marginTop: Spacing.lg }]}>
                      <Feather name="globe" size={14} color="#5856D6" />
                      <ThemedText style={[styles.scopeBannerText, { color: "#5856D6" }]}>
                        Luxemburg — UAS-Beschränkungen (TSA/Geozonen)
                      </ThemedText>
                    </View>
                  ) : null}
                  <SectionHeader title="UAS-Beschränkungen" count={filteredLuTsa.length} color="#5856D6" icon="shield" theme={theme} />
                  {filteredLuTsa.map((z, i) => {
                    const isActive = z.status === "Aktiv";
                    const statusColor = isActive ? "#FF9500" : "#8E8E93";
                    return (
                      <Card key={`lu-tsa-${i}`} style={[styles.restrictionCard, { borderLeftColor: statusColor, borderLeftWidth: 4 }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <Feather name="shield" size={14} color={statusColor} />
                          <ThemedText style={[styles.restrictionName, { color: theme.text, flex: 1 }]}>{z.nomZone}</ThemedText>
                          <View style={[styles.typeBadge, { backgroundColor: isActive ? "rgba(255,149,0,0.12)" : "rgba(142,142,147,0.12)" }]}>
                            <ThemedText style={[styles.typeBadgeText, { color: statusColor }]}>{z.status || "TSA"}</ThemedText>
                          </View>
                        </View>
                        <ThemedText style={[styles.restrictionDetail, { color: theme.textSecondary }]}>{z.description}</ThemedText>
                        {z.nature ? (
                          <View style={styles.restrictionRow}>
                            <Feather name="info" size={12} color={theme.textTertiary} />
                            <ThemedText style={[styles.restrictionRowText, { color: theme.textSecondary }]}>{z.nature}</ThemedText>
                          </View>
                        ) : null}
                        {z.dateRange ? (
                          <View style={styles.restrictionRow}>
                            <Feather name="calendar" size={12} color={theme.textTertiary} />
                            <ThemedText style={[styles.restrictionRowText, { color: theme.textSecondary }]}>{z.dateRange}</ThemedText>
                          </View>
                        ) : null}
                        {z.altitude ? (
                          <View style={styles.restrictionRow}>
                            <Feather name="arrow-up" size={12} color={theme.textTertiary} />
                            <ThemedText style={[styles.restrictionRowText, { color: theme.textSecondary }]}>{z.altitude}</ThemedText>
                          </View>
                        ) : null}
                        {z.resp ? (
                          <View style={styles.restrictionRow}>
                            <Feather name="user" size={12} color={theme.textTertiary} />
                            <ThemedText style={[styles.restrictionRowText, { color: theme.textSecondary }]}>{z.resp}</ThemedText>
                          </View>
                        ) : null}
                        {z.durPrev ? (
                          <View style={styles.restrictionRow}>
                            <Feather name="clock" size={12} color={theme.textTertiary} />
                            <ThemedText style={[styles.restrictionRowText, { color: theme.textSecondary }]}>Vorankündigung: {z.durPrev}</ThemedText>
                          </View>
                        ) : null}
                        {z.remarks ? (
                          <ThemedText style={[styles.restrictionDetail, { color: theme.textTertiary, marginTop: 4, fontSize: 12 }]}>{z.remarks}</ThemedText>
                        ) : null}
                      </Card>
                    );
                  })}
                  <ThemedText style={[styles.sourceInfo, { color: theme.textTertiary }]}>
                    Quelle: Geoportail.lu WMS — ANA Luxemburg
                  </ThemedText>
                </>
              ) : null}

              {result.active.length + result.upcoming.length > 0 ? (
                <ThemedText style={[styles.sourceInfo, { color: theme.textTertiary }]}>
                  Quelle: dipul Geoapi v4 — DFS / UAS-Betrieb
                </ThemedText>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, marginBottom: tabBarHeight }}>
          {loading ? (
            <View style={[styles.loadingContainer, { flex: 1, justifyContent: "center" }]}>
              <ActivityIndicator size="large" color={theme.primary} />
              <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>Karte wird geladen...</ThemedText>
            </View>
          ) : (
            <NotamMapView
              restrictions={allRestrictions}
              milStatusMap={milStatusMap}
              centerLat={currentLat ?? getCountryDefaultCenter(detectedCountry || "DE").lat}
              centerLon={currentLon ?? getCountryDefaultCenter(detectedCountry || "DE").lon}
              focusLat={mapFocusLat}
              focusLon={mapFocusLon}
              focusId={mapFocusId}
            />
          )}
          {mapFocusId ? (
            <View style={[styles.mapFocusBanner, { backgroundColor: theme.background + "F0" }]}>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.mapFocusName, { color: theme.text }]} numberOfLines={1}>
                  {allRestrictions.find((r) => r.id === mapFocusId)?.name || "Beschränkung"}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => { setMapFocusId(undefined); setMapFocusLat(undefined); setMapFocusLon(undefined); }}
                style={[styles.mapFocusBtn, { backgroundColor: theme.primary }]}
              >
                <Feather name="layers" size={12} color="#FFFFFF" />
                <ThemedText style={styles.mapFocusBtnText}>Alle anzeigen</ThemedText>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  tabBar: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  tabRow: {
    flexDirection: "row",
    borderRadius: BorderRadius.md,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "700",
  },
  loadingContainer: { alignItems: "center", paddingTop: Spacing["2xl"], gap: Spacing.md },
  loadingText: { ...Typography.body },
  errorCard: { padding: Spacing.xl, alignItems: "center", gap: Spacing.md },
  errorTitle: { ...Typography.callout, fontWeight: "700" },
  errorText: { ...Typography.body, textAlign: "center" },
  retryBtn: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.sm },
  retryBtnText: { ...Typography.callout, fontWeight: "700", color: "#FFFFFF" },
  statsRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  statBadge: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, alignItems: "center" },
  statValue: { ...Typography.h3, fontWeight: "700" },
  statLabel: { ...Typography.caption, fontSize: 10 },
  scopeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  scopeBannerText: { ...Typography.caption, fontWeight: "600", fontSize: 12 },
  emptyCard: { padding: Spacing.xl, alignItems: "center", gap: Spacing.md },
  emptyTitle: { ...Typography.callout, fontWeight: "700" },
  emptyText: { ...Typography.body, textAlign: "center", lineHeight: 22 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  sectionTitle: { ...Typography.callout, fontWeight: "700", flex: 1 },
  sectionCount: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  sectionCountText: { ...Typography.caption, fontWeight: "700", fontSize: 12 },
  card: { padding: Spacing.md, marginBottom: Spacing.sm },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  cardName: { ...Typography.caption, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  typeBadgeText: { ...Typography.caption, fontSize: 10, fontWeight: "600" },
  mapIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    marginBottom: 2,
  },
  dateText: { ...Typography.caption, fontSize: 11, fontWeight: "500" },
  remainingBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginLeft: 4 },
  remainingText: { fontSize: 9, fontWeight: "700" },
  cardMeta: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { ...Typography.caption, fontSize: 11 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: { fontSize: 9, fontWeight: "700" },
  cardDetails: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128,128,128,0.3)",
    gap: 6,
  },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  detailText: { ...Typography.caption, fontSize: 11, flex: 1 },
  dipulLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingVertical: 4,
  },
  dipulLinkText: {
    fontSize: 12,
    fontWeight: "600",
  },
  restrictionCard: { padding: Spacing.md, marginBottom: Spacing.sm },
  restrictionName: { ...Typography.caption, fontWeight: "700", fontSize: 13 },
  restrictionDetail: { ...Typography.caption, fontSize: 12, lineHeight: 16 },
  restrictionRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, marginTop: 3 },
  restrictionRowText: { ...Typography.caption, fontSize: 11, flex: 1 },
  sourceInfo: { ...Typography.caption, textAlign: "center", marginTop: Spacing.md, fontSize: 10 },
  mapFocusBanner: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.md,
  },
  mapFocusName: {
    fontSize: 14,
    fontWeight: "700",
  },
  mapFocusBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.sm,
  },
  mapFocusBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  altExplainBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  altExplainText: {
    fontSize: 11,
    lineHeight: 15,
    flex: 1,
  },
});
