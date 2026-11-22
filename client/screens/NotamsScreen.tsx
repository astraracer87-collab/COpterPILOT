import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useRoute, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Location from "@/lib/location";
import * as WebBrowser from "@/lib/webBrowser";
import NotamRestrictionMap, { type NotamMapOverlay } from "@/components/NotamRestrictionMap";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { useShowDataSources } from "@/lib/dataSource";
import { ED269_SOURCE_LABELS } from "@/lib/ed269";
import { NOTAM_LIST_SOURCE_ISOS } from "../../shared/geozoneSourceMeta";
import { geozoneBadgeLabel, filterGeozoneDetailLines } from "@/lib/sourceAttribution";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { NotamsStackParamList } from "@/navigation/NotamsStackNavigator";
import {
  fetchAllTempRestrictions,
  reenrichDipulTempRestrictions,
  DipulTempRestriction,
  DipulTempRestrictionsResult,
  buildDipulLink,
  ringGroupsForZone,
} from "@/lib/geozones";
import { MIL_LOW_FLIGHT_SOURCE_URL, MIL_LOW_FLIGHT_ACTIVATION_TEXT } from "@/lib/milLowFlight";
import { smoothRingGroup } from "@/lib/ringSimplify";
import {
  buildWmsTileUrl,
  pointInZone,
  queryGeozoneFeatureInfo,
  GeozoneFeatureInfo,
  fetchAllLuZonesAsNotams,
  getCountryGeozoneConfig,
  LU_TEMP_ZONE_LABEL,
  TEMP_RESTRICTION_LAYER_LABEL,
  separateTempRestrictions,
  getAllDefaultEnabledLayerNames,
  queryEd269CachedFeatures,
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
import { detectCountryFromCoordinates, getCountryMapConfig, getCountryDefaultCenter, getCountryFlag, isPointInCountry } from "@/lib/countryMaps";
import { getCached, setCache } from "@/lib/dataCache";
import { getSettings, saveSettings } from "@/lib/storage";
import { setActiveNotamCount } from "@/lib/notamAlertStore";
import CountryPickerModal from "@/components/CountryPickerModal";
import {
  ed269ZonesToNotamRestrictions,
  formatBelgianNotamValidityRange,
} from "@/lib/ed269Notams";
import { splitBrusselsFirNotams } from "@/lib/brusselsFirNotams";
import { FT_M } from "../../shared/heights";

type RouteParams = RouteProp<NotamsStackParamList, "Notams">;

function altWithMeters(value: number, unit: string): string {
  const u = (unit || "").toLowerCase();
  if (u === "ft") {
    const m = Math.round(value * FT_M);
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

function daysRemaining(r: DipulTempRestriction): string | null {
  if (r.validityUnknown) return "Gültigkeit prüfen";
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
  const isAdmin = useShowDataSources();
  const [expanded, setExpanded] = useState(false);
  const isMilLowFlight = restriction.kind === "mil_low_flight_day";
  const isEDR = restriction.name.startsWith("ED-R");
  const isUpcoming = restriction.status === "upcoming";
  const hasRecurringSchedule = !!restriction.scheduleText?.length;
  const milLikelyActive = isMilLowFlight ? isMilLowFlightLikelyActive() : false;
  const borderColor = isMilLowFlight
    ? milLikelyActive ? "#7B8B3A" : "#8E8E93"
    : isUpcoming ? "#5856D6" : isEDR ? "#FF3B30" : "#FF9500";
  const statusColor = hasRecurringSchedule ? "#5856D6" : borderColor;
  const statusLabel = isMilLowFlight
    ? milLikelyActive ? "Mil. Tiefflug Tag (aktiv)" : "Mil. Tiefflug Tag (jetzt nicht aktiv)"
    : hasRecurringSchedule
      ? isUpcoming
        ? "Zeitplan · zukünftig"
        : "Zeitplan"
      : isUpcoming
        ? "Zukünftig"
        : "Aktiv";
  const statusIcon = isMilLowFlight ? "shield" : hasRecurringSchedule ? "repeat" : isUpcoming ? "clock" : "zap";
  // dipul ist die deutsche Quelle. Für ausländische ED-269-Zonen (BE/AT/DK,
  // id-Präfix "ed269-") wird weder der dipul-Link noch der Quellhinweis gezeigt.
  const isGermanZone = !restriction.id.startsWith("ed269-");
  const dipulUrl = isMilLowFlight ? MIL_LOW_FLIGHT_SOURCE_URL : buildDipulLink(restriction.name);
  const dateRange = formatDateRange(restriction);
  const remaining = hasRecurringSchedule && !isUpcoming
    ? null
    : isUpcoming ? daysUntilStart(restriction) : daysRemaining(restriction);

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
            {restriction.scheduleText?.map((schedule, index) => (
              <View key={`schedule-${index}`} style={styles.detailRow}>
                <Feather name="repeat" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Aktivzeit (wiederkehrend): {schedule}
                </ThemedText>
              </View>
            ))}
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
            {isGermanZone ? (
              <Pressable
                onPress={(e) => { e.stopPropagation?.(); WebBrowser.openBrowserAsync(dipulUrl || "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/").catch(() => {}); }}
                style={styles.dipulLink}
              >
                <Feather name="external-link" size={12} color={borderColor} />
                <ThemedText style={[styles.dipulLinkText, { color: borderColor }]}>
                  {isMilLowFlight ? (isAdmin ? "Karte und Details auf dipul.de" : "Karte und Details ansehen") : dipulUrl ? (isAdmin ? "Details auf dipul.de" : "Details ansehen") : (isAdmin ? "Alle Einschränkungen auf dipul.de" : "Alle Einschränkungen ansehen")}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

const NOTAM_SCOPE_KEY = "notams:countryScope";
/** Kartenmitte für „Alle Länder“ (Mitteleuropa) */
const ALL_CENTER = { lat: 50.3, lon: 8.5 };

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

function NotamMapView({ restrictions, milStatusMap, centerLat, centerLon, focusLat, focusLon, focusId, countryIso }: {
  restrictions: DipulTempRestriction[];
  milStatusMap: Record<string, MilLowFlightAreaStatus>;
  centerLat: number;
  centerLon: number;
  focusLat?: number;
  focusLon?: number;
  focusId?: string;
  countryIso?: string | null;
}) {
  const isAdmin = useShowDataSources();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const theme = isDark
    ? { bg: "#1C1C1E", text: "#FFFFFF", textSec: "#AEAEB2", border: "#38383A", primary: "#0A84FF" }
    : { bg: "#FFFFFF", text: "#000000", textSec: "#6C6C70", border: "#E5E5EA", primary: "#007AFF" };
  const [selectedRestriction, setSelectedRestriction] = useState<DipulTempRestriction | null>(null);
  const [otherRestrictions, setOtherRestrictions] = useState<DipulTempRestriction[]>([]);
  const [isProximityMatch, setIsProximityMatch] = useState(false);
  const [wmsZones, setWmsZones] = useState<GeozoneFeatureInfo[]>([]);
  const [wmsLoading, setWmsLoading] = useState(false);
  const [pinCoord, setPinCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapType, setMapType] = useMapBasemapStyle();

  // Delta aus dem Länder-Profil ableiten, damit beim Wechsel z. B. nach
  // Deutschland nicht nur ein 2°-Ausschnitt um Mittelpunkt zu sehen ist,
  // sondern das ganze Land aufs Display passt.
  const countryDefaults = countryIso ? getCountryDefaultCenter(countryIso) : { ...ALL_CENTER, latDelta: 9, lonDelta: 12 };
  const defaultDelta = { latitudeDelta: countryDefaults.latDelta, longitudeDelta: countryDefaults.lonDelta };

  const validMapPoint = (lat: number, lon: number) =>
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  const hasRenderableRing = (ring: [number, number][]) =>
    ring.filter(([lat, lon]) => validMapPoint(lat, lon)).length >= 3;
  // Polygongeometrien auch ohne berechneten Mittelpunkt zeichnen. Der Mittelpunkt
  // wird nur zum Fokussieren/Kreis-Overlay benötigt, nicht zum Rendern eines Polygons.
  const canRenderRestriction = (r: DipulTempRestriction) =>
    (r.centerLat != null && r.centerLon != null && validMapPoint(r.centerLat, r.centerLon)) ||
    (r.polygonRings?.some(hasRenderableRing) ?? false) ||
    (r.polygonGroups?.some((group) => group.some(hasRenderableRing)) ?? false);
  const mappedRestrictions = restrictions.filter(canRenderRestriction);
  const unmappedRestrictions = restrictions.filter((r) => !canRenderRestriction(r));

  // Beschränkungs-Overlays (Polygone/Kreise) mit Einfärbung nach mil-Low-Flight-
  // Status, ED-R (rot), aktiv (orange) bzw. zukünftig (violett); bei gesetztem
  // Fokus werden Nicht-Treffer abgeblendet. Das generische Format wird sowohl
  // von der nativen Leaflet-Karte als auch der Web-Karte gezeichnet.
  const overlays = useMemo<NotamMapOverlay[]>(() => {
    return mappedRestrictions.map((r) => {
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
      const strokeWidth = isFocused ? 3 : dimmed ? 1 : 2;
      const polygonGroups = ringGroupsForZone(r)
        .map((group) => group
          .map((ring) => ring.filter(([lat, lon]) => validMapPoint(lat, lon)))
          .filter((ring) => ring.length >= 3))
        .filter((group) => group[0]?.length >= 3)
        .map((group) => smoothRingGroup(group));
      const hasPolygon = polygonGroups.length > 0;
      return {
        id: r.id,
        groups: hasPolygon ? polygonGroups : undefined,
        center: hasPolygon ? undefined : [r.centerLat as number, r.centerLon as number],
        radiusM: hasPolygon ? undefined : (r.radiusM ?? 5000),
        fillColor,
        strokeColor,
        strokeWidth,
      };
    });
  }, [mappedRestrictions, milStatusMap, focusId]);

  const toRad = (d: number) => d * Math.PI / 180;
  const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const findRestrictionAt = useCallback((latitude: number, longitude: number): { primary: DipulTempRestriction | null; others: DipulTempRestriction[]; isProximity: boolean } => {
    // Sammelt ALLE Restriktionen, die den getippten Punkt enthalten —
    // sortiert nach Nähe zum Zentrum, sodass die naheste oben steht.
    // Die übrigen werden im Bottom-Sheet als "Weitere Zonen an dieser
    // Position" gerendert, damit überlappende Zonen nicht verborgen sind.
    const containing: { r: DipulTempRestriction; dist: number }[] = [];
    let nearestFallback: DipulTempRestriction | null = null;
    let nearestFallbackDist = Infinity;
    const MAX_PROXIMITY_M = 15000;
    for (const r of restrictions) {
      if (r.centerLat == null || r.centerLon == null) continue;
      const dist = haversineM(latitude, longitude, r.centerLat, r.centerLon);
      const hasPolygon = (r.polygonRings && r.polygonRings.length > 0) || (r.polygonGroups && r.polygonGroups.length > 0);
      const inside = hasPolygon
        ? pointInZone(latitude, longitude, r)
        : dist <= (r.radiusM ?? 5000) * 1.5;
      if (inside) {
        containing.push({ r, dist });
      }
      if (dist < nearestFallbackDist && dist <= MAX_PROXIMITY_M) {
        nearestFallback = r;
        nearestFallbackDist = dist;
      }
    }
    containing.sort((a, b) => a.dist - b.dist);
    if (containing.length > 0) {
      return {
        primary: containing[0].r,
        others: containing.slice(1).map((c) => c.r),
        isProximity: false,
      };
    }
    if (nearestFallback) return { primary: nearestFallback, others: [], isProximity: true };
    return { primary: null, others: [], isProximity: false };
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
      // Alle Default-Geozone-Layer abfragen (NOTAMs UND CTR/ED-R/Naturschutz/...)
      // damit der Pilot sieht, was alles an dieser Position übereinander liegt
      // — nicht nur die oberste Zone.
      const layers = getAllDefaultEnabledLayerNames(tapCountry);
      const mapSize = 512;
      const latDelta = 0.01;
      const lonDelta = 0.01;
      const results = await queryGeozoneFeatureInfo(
        layers,
        latitude, longitude, mapSize, mapSize, latDelta, lonDelta, tapCountry
      );
      const { tempRestrictions, geozones } = separateTempRestrictions(results);
      // Reihenfolge: temporäre Beschränkungen zuerst, dann statische Geozonen.
      setWmsZones([...tempRestrictions, ...geozones]);
    } catch {
      setWmsZones([]);
    } finally {
      setWmsLoading(false);
    }
  }, []);

  const handleMapPress = useCallback((latitude: number, longitude: number) => {
    setPinCoord({ latitude, longitude });
    const { primary, others, isProximity } = findRestrictionAt(latitude, longitude);
    setSelectedRestriction(primary);
    setOtherRestrictions(others);
    setIsProximityMatch(isProximity);
    // Die native NOTAM-Karte zeigt absichtlich nur die Polygone der NOTAM-Liste.
    // Zusätzliche WMS-Geozonen-Abfragen bleiben auf der Web-Karte verfügbar.
    if (Platform.OS === "web") queryWmsAtPoint(latitude, longitude);
    else {
      setWmsZones([]);
      setWmsLoading(false);
    }
  }, [findRestrictionAt, queryWmsAtPoint]);

  const handleMapLongPress = useCallback((latitude: number, longitude: number) => {
    setPinCoord({ latitude, longitude });
    const { primary, others, isProximity } = findRestrictionAt(latitude, longitude);
    setSelectedRestriction(primary);
    setOtherRestrictions(others);
    setIsProximityMatch(isProximity);
    if (Platform.OS === "web") queryWmsAtPoint(latitude, longitude);
    else {
      setWmsZones([]);
      setWmsLoading(false);
    }
  }, [findRestrictionAt, queryWmsAtPoint]);

  return (
    <View collapsable={false} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <NotamRestrictionMap
        centerLat={centerLat}
        centerLon={centerLon}
        latDelta={defaultDelta.latitudeDelta}
        lonDelta={defaultDelta.longitudeDelta}
        focusLat={focusLat}
        focusLon={focusLon}
        focusId={focusId}
        countryIso={countryIso}
        mapType={mapType}
        overlays={overlays}
        pin={pinCoord}
        onMapPress={handleMapPress}
        onLongPress={handleMapLongPress}
      />

      <View style={mapStyles.mapTypeSelector}>
        <Pressable
          onPress={() => setMapType("standard")}
          style={[mapStyles.mapTypeBtn, mapType === "standard" || mapType === "osm" ? { backgroundColor: theme.primary } : { backgroundColor: theme.bg + "E8" }]}
        >
          <Feather name="map" size={14} color={mapType === "standard" || mapType === "osm" ? "#FFFFFF" : theme.text} />
          <ThemedText style={[mapStyles.mapTypeBtnText, { color: mapType === "standard" || mapType === "osm" ? "#FFFFFF" : theme.text }]}>Normal</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setMapType("satellite")}
          style={[mapStyles.mapTypeBtn, mapType === "satellite" ? { backgroundColor: theme.primary } : { backgroundColor: theme.bg + "E8" }]}
        >
          <Feather name="globe" size={14} color={mapType === "satellite" ? "#FFFFFF" : theme.text} />
          <ThemedText style={[mapStyles.mapTypeBtnText, { color: mapType === "satellite" ? "#FFFFFF" : theme.text }]}>Satellit</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => setMapType("grayscale")}
          style={[mapStyles.mapTypeBtn, mapType === "grayscale" ? { backgroundColor: theme.primary } : { backgroundColor: theme.bg + "E8" }]}
        >
          <Feather name="sliders" size={14} color={mapType === "grayscale" ? "#FFFFFF" : theme.text} />
          <ThemedText style={[mapStyles.mapTypeBtnText, { color: mapType === "grayscale" ? "#FFFFFF" : theme.text }]}>Graustufen</ThemedText>
        </Pressable>
      </View>

      {unmappedRestrictions.length > 0 ? (
        <View
          testID="notam-map-unmapped"
          style={{
            position: "absolute",
            top: 56,
            left: 12,
            right: 12,
            maxHeight: 180,
            padding: 10,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.border,
            backgroundColor: theme.bg + "F2",
            zIndex: 20,
          }}
        >
          <ThemedText style={{ color: "#FF9500", fontWeight: "700", marginBottom: 4 }}>
            {unmappedRestrictions.length} Eintrag{unmappedRestrictions.length === 1 ? "" : "e"} ohne darstellbare Geometrie
          </ThemedText>
          <ThemedText style={{ color: theme.textSec, fontSize: 12, marginBottom: 6 }}>
            Für diese Einträge liegt keine Kartenfläche vor. Sie gelten trotzdem – Lage bitte in der Liste bzw. im NOTAM-Text prüfen.
          </ThemedText>
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
            {unmappedRestrictions.map((restriction) => (
              <View key={restriction.id} style={{ paddingVertical: 2 }}>
                <ThemedText style={{ color: theme.text, fontSize: 12 }} numberOfLines={2}>
                  {restriction.name}
                </ThemedText>
                {restriction.geometryNote ? (
                  <ThemedText style={{ color: theme.textSec, fontSize: 11 }} numberOfLines={3}>
                    {restriction.geometryNote}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

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
            <Pressable onPress={() => { setPinCoord(null); setSelectedRestriction(null); setOtherRestrictions([]); setWmsZones([]); }} hitSlop={12}>
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
                    <ThemedText style={[mapStyles.infoPanelBadgeText, { color: statusColor }]}>{geozoneBadgeLabel(z.layerLabel, isAdmin, Object.values(ED269_SOURCE_LABELS))}</ThemedText>
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
                            {isMilLowFlightMatch ? (isAdmin ? "Karte und Details auf dipul.de" : "Karte und Details ansehen") : dipulUrl ? (isAdmin ? "Details auf dipul.de" : "Details ansehen") : (isAdmin ? "Alle Einschränkungen auf dipul.de" : "Alle Einschränkungen ansehen")}
                          </ThemedText>
                        </Pressable>
                      </View>
                    );
                  })()
                ) : (
                  (() => {
                    const details = filterGeozoneDetailLines(z.details, isAdmin);
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
                An dieser Position wurde keine zuordenbare Beschränkung gefunden. Prüfe ggf. die Listenansicht{isAdmin ? " oder dipul.de" : ""} für aktuelle Einschränkungen.
              </ThemedText>
            </View>
            <Pressable onPress={() => { setPinCoord(null); setSelectedRestriction(null); setOtherRestrictions([]); setWmsZones([]); }} hitSlop={12}>
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
            <Pressable onPress={() => { setPinCoord(null); setSelectedRestriction(null); setOtherRestrictions([]); setWmsZones([]); setWmsLoading(false); }} hitSlop={12}>
              <Feather name="x" size={20} color={theme.textSec} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {selectedRestriction ? (() => {
        // Vorab berechnen: Wieviele zusätzliche Zonen liegen an der Tap-Position?
        // Wird sowohl als prominentes Banner direkt unter dem Titel
        // angezeigt (damit es nie unter den Scroll-Cutoff fällt) als auch
        // unten als ausklappbare Liste.
        const usedIds = new Set<string>([selectedRestriction.id, ...otherRestrictions.map((r) => r.id)]);
        const extraWmsZones = wmsZones.filter((z) => {
          const m = matchDipulRestriction(z);
          return !(m && usedIds.has(m.id));
        });
        const totalAdditional = otherRestrictions.length + extraWmsZones.length;
        const hasNotamAmongAdditional =
          otherRestrictions.some((r) => r.category === "notam") ||
          extraWmsZones.some((z) => z.layerLabel === TEMP_RESTRICTION_LAYER_LABEL || z.layerLabel === LU_TEMP_ZONE_LABEL);
        const screenH = Dimensions.get("window").height;
        return (
        <ScrollView
          style={[mapStyles.infoPanel, { backgroundColor: theme.bg, borderColor: theme.border, maxHeight: Math.min(520, Math.round(screenH * 0.5)) }]}
          contentContainerStyle={{ paddingBottom: 4 }}
          showsVerticalScrollIndicator={true}
          // Kopf mit Titel und X bleibt beim Scrollen stehen
          stickyHeaderIndices={[0]}
        >
          <View style={[mapStyles.infoPanelHeader, { backgroundColor: theme.bg, zIndex: 2 }]}>
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
            <Pressable onPress={() => { setSelectedRestriction(null); setOtherRestrictions([]); setPinCoord(null); setWmsZones([]); }} hitSlop={12}>
              <Feather name="x" size={20} color={theme.textSec} />
            </Pressable>
          </View>
          {totalAdditional > 0 ? (
            <View style={{
              marginTop: 8,
              padding: 8,
              borderRadius: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: hasNotamAmongAdditional ? "#FF950018" : (theme.border + "55"),
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: hasNotamAmongAdditional ? "#FF950055" : theme.border,
            }}>
              <Feather name={hasNotamAmongAdditional ? "alert-triangle" : "layers"} size={13} color={hasNotamAmongAdditional ? "#FF9500" : theme.primary} />
              <ThemedText style={[mapStyles.infoPanelDetails, { color: hasNotamAmongAdditional ? "#FF9500" : theme.text, fontWeight: "700", flex: 1 }]}>
                {hasNotamAmongAdditional
                  ? `+${totalAdditional} weitere Zone${totalAdditional !== 1 ? "n" : ""} an dieser Position — inkl. NOTAM`
                  : `+${totalAdditional} weitere Zone${totalAdditional !== 1 ? "n" : ""} an dieser Position`}
              </ThemedText>
              <Feather name="chevron-down" size={14} color={hasNotamAmongAdditional ? "#FF9500" : theme.textSec} />
            </View>
          ) : null}
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
          {(() => {
            // ED-269-NOTAMs anderer Länder haben keinen dipul-Eintrag:
            // BE/LU → Droneguide-Karte, sonst kein Link.
            const ed269Iso = selectedRestriction.id.startsWith("ed269-") ? selectedRestriction.id.split("-")[1] : null;
            const link = selectedRestriction.kind === "mil_low_flight_day"
              ? MIL_LOW_FLIGHT_SOURCE_URL
              : ed269Iso
                ? (ed269Iso === "BE" || ed269Iso === "LU" ? "https://map.droneguide.be/" : null)
                : buildDipulLink(selectedRestriction.name);
            if (!link) return null;
            const label = selectedRestriction.kind === "mil_low_flight_day"
              ? "Karte und Details ansehen"
              : ed269Iso ? "Karte auf droneguide.be öffnen" : "Details ansehen";
            return (
              <Pressable
                onPress={() => { WebBrowser.openBrowserAsync(link); }}
                style={[mapStyles.dipulLink, { borderColor: theme.border, paddingVertical: 10 }]}
              >
                <Feather name="external-link" size={14} color={theme.primary} />
                <ThemedText style={[mapStyles.dipulLinkText, { color: theme.primary, fontSize: 14, fontWeight: "600" }]}>{label}</ThemedText>
              </Pressable>
            );
          })()}
          {totalAdditional > 0 ? (
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Feather name="layers" size={12} color={theme.textSec} />
                  <ThemedText style={[mapStyles.infoPanelLabel, { color: theme.textSec }]}>
                    Weitere Zonen an dieser Position ({totalAdditional})
                  </ThemedText>
                </View>
                {otherRestrictions.map((r, i) => {
                  const isMil = r.kind === "mil_low_flight_day";
                  const milS = isMil ? milStatusMap[r.id] : null;
                  const badgeColor = milS
                    ? getStatusColor(milS.status)
                    : r.status === "active" ? "#FF9500" : "#5856D6";
                  const badgeLabel = milS
                    ? `Mil. Tiefflug — ${getStatusLabel(milS.status)}`
                    : r.status === "active" ? "Aktiv" : "Zukünftig";
                  return (
                    <Pressable
                      key={`other-${r.id}`}
                      onPress={() => { setSelectedRestriction(r); setOtherRestrictions(otherRestrictions.filter((x) => x.id !== r.id).concat(selectedRestriction!)); }}
                      style={{ marginTop: i === 0 ? 0 : 10, paddingTop: i === 0 ? 0 : 8, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.border }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <View style={[mapStyles.infoPanelBadge, { backgroundColor: badgeColor + "18" }]}>
                          <ThemedText style={[mapStyles.infoPanelBadgeText, { color: badgeColor }]}>{badgeLabel}</ThemedText>
                        </View>
                        {r.type ? (
                          <View style={[mapStyles.infoPanelBadge, { backgroundColor: theme.border + "60" }]}>
                            <ThemedText style={[mapStyles.infoPanelBadgeText, { color: theme.textSec }]}>{r.type}</ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.text, fontWeight: "600", flex: 1 }]} numberOfLines={2}>{r.name}</ThemedText>
                        <Feather name="chevron-right" size={14} color={theme.textSec} />
                      </View>
                      <ThemedText style={[mapStyles.infoPanelDetails, { color: theme.textSec, marginTop: 2, fontSize: 10 }]} numberOfLines={1}>
                        {r.lowerAlt === 0 && r.lowerAltRef === "AGL" ? "GND" : `${Math.round(r.lowerAlt)} ${r.lowerAltUnit} ${r.lowerAltRef}`}
                        {" — "}
                        {Math.round(r.upperAlt)} {r.upperAltUnit} {r.upperAltRef}
                      </ThemedText>
                    </Pressable>
                  );
                })}
                {extraWmsZones.map((z, i) => {
                  const idx = otherRestrictions.length + i;
                  const details = filterGeozoneDetailLines(z.details, isAdmin);
                  const wmsBadgeLabel = geozoneBadgeLabel(z.layerLabel, isAdmin, Object.values(ED269_SOURCE_LABELS));
                  return (
                    <View key={`wms-sel-${i}`} style={{ marginTop: idx === 0 ? 0 : 10, paddingTop: idx === 0 ? 0 : 8, borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: theme.border }}>
                      <View style={[mapStyles.infoPanelBadge, { backgroundColor: "#4A90D920", alignSelf: "flex-start", marginBottom: 4 }]}>
                        <ThemedText style={[mapStyles.infoPanelBadgeText, { color: "#4A90D9" }]}>{wmsBadgeLabel}</ThemedText>
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
        );
      })() : null}
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
  const isAdmin = useShowDataSources();
  // eigene kompakte Kopfzeile statt Stack-Header (siehe NotamsStackNavigator)
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const route = useRoute<RouteParams>();

  const locationLat = route.params?.latitude;
  const locationLon = route.params?.longitude;
  const locationName = route.params?.locationName;

  const [currentLat, setCurrentLat] = useState<number | undefined>(locationLat);
  const [currentLon, setCurrentLon] = useState<number | undefined>(locationLon);
  // Land kommt jetzt ausschließlich aus den Einstellungen (preferredCountryIso).
  // null = Settings noch nicht geladen → keine Daten anzeigen.
  // null = alle unterstützten Länder (Standard), sonst ISO des gewählten Landes
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [scopeLoaded, setScopeLoaded] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const v = await AsyncStorage.getItem(NOTAM_SCOPE_KEY);
          if (active) setDetectedCountry(v && v !== "ALL" ? v.toUpperCase() : null);
        } catch {
          if (active) setDetectedCountry(null);
        } finally {
          if (active) setScopeLoaded(true);
        }
      })();
      return () => { active = false; };
    }, [])
  );
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());
  const toggleCountry = useCallback((iso: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }, []);
  const [result, setResult] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [luTsaZones, setLuTsaZones] = useState<{ id: string; nomZone: string; description: string; status: string; nature: string; dateRange: string; altitude: string; remarks: string; durPrev: string; resp: string; polygonRings?: [number, number][][]; centerLat?: number; centerLon?: number }[]>([]);
  const [ed269ByIso, setEd269ByIso] = useState<Record<string, DipulTempRestriction[]>>({});
  const ed269Notams = useMemo(() => Object.values(ed269ByIso).flat(), [ed269ByIso]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Offline-first: liegt bereits eine (gespeicherte) Liste vor, wird im
  // Hintergrund aktualisiert – ohne Vollbild-Spinner und ohne die Liste bei
  // einem Fehler durch eine Fehlermeldung zu ersetzen.
  const hasDipulDataRef = useRef(false);
  const [viewMode, setViewMode] = useState<"liste" | "karte">("karte");
  const [mapFocusLat, setMapFocusLat] = useState<number | undefined>();
  const [mapFocusLon, setMapFocusLon] = useState<number | undefined>();
  const [mapFocusId, setMapFocusId] = useState<string | undefined>();
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  const handleSelectCountry = useCallback(async (iso: string) => {
    setCountryPickerOpen(false);
    AsyncStorage.setItem(NOTAM_SCOPE_KEY, iso.toUpperCase()).catch(() => {});
    setDetectedCountry(iso === "ALL" ? null : iso.toUpperCase());
    setMapFocusLat(undefined);
    setMapFocusLon(undefined);
    setMapFocusId(undefined);
    if (iso === "ALL") {
      setCurrentLat(ALL_CENTER.lat);
      setCurrentLon(ALL_CENTER.lon);
      return;
    }
    // Standort & Fokus zurücksetzen, damit Karte aufs neue Land zentriert
    const c = getCountryDefaultCenter(iso);
    setCurrentLat(c.lat);
    setCurrentLon(c.lon);
    setMapFocusLat(undefined);
    setMapFocusLon(undefined);
    setMapFocusId(undefined);
  }, []);

  useEffect(() => {
    if (!scopeLoaded) return;
    if (!detectedCountry) {
      if (currentLat == null || currentLon == null) {
        setCurrentLat(ALL_CENTER.lat);
        setCurrentLon(ALL_CENTER.lon);
      }
      return;
    }
    const c = getCountryDefaultCenter(detectedCountry);
    const fallbackLat = c.lat;
    const fallbackLon = c.lon;

    // Wenn bereits Koordinaten vorhanden sind, nur überschreiben, falls
    // sie außerhalb des aktuell gewählten Landes liegen (User hat Land gewechselt).
    if (currentLat != null && currentLon != null) {
      if (!isPointInCountry(currentLat, currentLon, detectedCountry)) {
        setCurrentLat(fallbackLat);
        setCurrentLon(fallbackLon);
      }
      return;
    }

    let active = true;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!active) return;
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (!active) return;
          // GPS nur übernehmen, wenn sie im gewählten Land liegt — sonst Land-Center.
          if (isPointInCountry(loc.coords.latitude, loc.coords.longitude, detectedCountry)) {
            setCurrentLat(loc.coords.latitude);
            setCurrentLon(loc.coords.longitude);
          } else {
            setCurrentLat(fallbackLat);
            setCurrentLon(fallbackLon);
          }
        } else {
          setCurrentLat(fallbackLat);
          setCurrentLon(fallbackLon);
        }
      } catch {
        if (!active) return;
        setCurrentLat(fallbackLat);
        setCurrentLon(fallbackLon);
      }
    })();
    return () => { active = false; };
  }, [detectedCountry, scopeLoaded]);

  const parseLuRaw = useCallback((raw: any[]) => raw.map((r: any) => {
    const lines = (r.iteme || "").split("\n");
    const get = (prefix: string) => lines.find((l: string) => l.startsWith(prefix))?.replace(prefix, "").trim() || "";
    return {
      id: r.nom_zone || (r.itema?.[0]) || "",
      nomZone: (r.itema?.[0]) || "",
      description: lines[0] || "",
      status: get("Status: "),
      nature: get("Art: "),
      dateRange: [get("Von: "), get("Bis: ")].filter(Boolean).join(" — "),
      altitude: get("Höhe: "),
      remarks: get("Hinweis: "),
      durPrev: get("Vorankündigung: "),
      resp: get("Zuständigkeit: "),
      polygonRings: r.polygonRings,
      centerLat: r.centerLat,
      centerLon: r.centerLon,
    };
  }), []);

  const loadRestrictions = useCallback(async () => {
    if (!hasDipulDataRef.current) setLoading(true);
    setError(undefined);
    try {
      const data = await fetchAllTempRestrictions();
      hasDipulDataRef.current = true;
      setResult(data);
      setCache("dipul_restrictions", data).catch(() => {});
    } catch {
      if (!hasDipulDataRef.current) setError("Fehler beim Laden der temporären Beschränkungen");
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
        // Offline/Zeitüberschreitung: zuletzt angezeigte (gespeicherte) LU-Liste behalten
      }
    })();
  }, [parseLuRaw]);

  useEffect(() => {
    (async () => {
      const [cachedDipul, cachedLu] = await Promise.all([
        getCached<DipulTempRestrictionsResult>("dipul_restrictions"),
        getCached<any[]>("lu_tsa_zones"),
      ]);
      if (cachedDipul) {
        const cachedData = cachedDipul.data;
        hasDipulDataRef.current = true;
        setResult(cachedData);
        // Gespeicherte Liste (ggf. aus älterer App-Version ohne Flächen) nachrüsten –
        // nur übernehmen, solange noch keine frische Liste angekommen ist. Ohne
        // Netzabruf (gespeicherte WFS-Layer); die Live-Liste folgt im Hintergrund.
        reenrichDipulTempRestrictions(cachedData, { skipNetwork: true })
          .then((enriched) => {
            if (enriched !== cachedData) setResult((prev) => (prev === cachedData ? enriched : prev));
          })
          .catch(() => {});
      }
      if (cachedLu) setLuTsaZones(parseLuRaw(cachedLu.data));
      if (cachedDipul || cachedLu) setLoading(false);
      loadRestrictions();
    })();
  }, [loadRestrictions, parseLuRaw]);

  // Temporäre ED-269-Zonen (BE/AT/DK) mit Gültigkeit < 30 Tagen zusätzlich als
  // NOTAM listen. DE (dipul) und LU (TSA) führen ihre temporären Zonen bereits
  // vollständig über die regulären Listen — daher hier ausgeschlossen. Der
  // Server filtert nach maxValidityDays, sodass die Übertragung klein bleibt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Länder laut Quellen-Registry (notamListOrder)
      // LU liegt in der Brussels FIR: LU-NOTAMs stecken im belgischen Bestand
      // (skeyes) und werden unten nach Geometrie LU zugeordnet.
      const isos =
        detectedCountry == null
          ? NOTAM_LIST_SOURCE_ISOS
          : detectedCountry === "LU"
            ? ["BE"]
            : NOTAM_LIST_SOURCE_ISOS.includes(detectedCountry)
              ? [detectedCountry]
              : [];
      if (!scopeLoaded) return;
      if (isos.length === 0) {
        setEd269ByIso({});
        return;
      }
      const next: Record<string, DipulTempRestriction[]> = {};
      for (const iso of isos) {
        try {
          const feats = await queryEd269CachedFeatures(0, 0, 1, iso, undefined, true, 30);
          next[iso] = ed269ZonesToNotamRestrictions(feats as GeozoneFeatureInfo[]);
        } catch {
          next[iso] = [];
        }
      }
      // Brussels FIR: NOTAMs über Luxemburg unter LU statt BE (nicht doppelt).
      if (next.BE) {
        const split = splitBrusselsFirNotams(next.BE);
        next.BE = split.BE;
        next.LU = split.LU;
        if (detectedCountry === "LU") delete next.BE;
        else if (detectedCountry === "BE") delete next.LU;
      }
      if (!cancelled) setEd269ByIso(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [detectedCountry, scopeLoaded]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRestrictions();
    setRefreshing(false);
  }, [loadRestrictions]);

  const showDe = detectedCountry === "DE" || detectedCountry == null;
  const showLu = detectedCountry === "LU" || detectedCountry == null;
  const showEd269 = detectedCountry == null || detectedCountry === "LU" || NOTAM_LIST_SOURCE_ISOS.includes(detectedCountry);
  const filteredEd269 = showEd269 ? ed269Notams : [];
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

  // LU-Zonen aus der Liste als Karten-Restriktionen (mit reprojizierter Geometrie).
  // Dadurch zeichnet die Karte genau die gelisteten Zonen — das vollflächige
  // WMS-Overlay für LU entfällt (siehe NOTAM_ONLY_LAYERS).
  const luMapRestrictions = useMemo<DipulTempRestriction[]>(() => {
    return filteredLuTsa
      .filter((z) => (z.polygonRings && z.polygonRings.length > 0) || (z.centerLat != null && z.centerLon != null))
      .map((z) => ({
        id: `lu-${z.id}`,
        extRef: z.id,
        name: z.nomZone || z.description || "UAS-Zone",
        names: [z.nomZone].filter(Boolean) as string[],
        genNames: [],
        type: "N",
        legalRef: "",
        legalExplanation: "",
        category: "notam",
        lowerAlt: 0,
        lowerAltRef: "",
        lowerAltUnit: "m",
        upperAlt: 0,
        upperAltRef: "",
        upperAltUnit: "m",
        status: z.status === "Aktiv" ? "active" : "upcoming",
        startTs: null,
        endTs: null,
        endTsIndefinite: false,
        recurRules: null,
        centerLat: z.centerLat ?? null,
        centerLon: z.centerLon ?? null,
        radiusM: null,
        polygonRings: z.polygonRings ?? null,
      }));
  }, [filteredLuTsa]);

  const mapRestrictions = useMemo(
    () => [...allRestrictions, ...luMapRestrictions, ...filteredEd269],
    [allRestrictions, luMapRestrictions, filteredEd269]
  );

  const milStatusMap = useMemo(() => buildMilLowFlightStatusMap(milLowFlightStatuses), [milLowFlightStatuses]);

  const handleShowOnMap = useCallback((lat: number, lon: number, id?: string) => {
    setMapFocusLat(lat);
    setMapFocusLon(lon);
    setMapFocusId(id);
    setViewMode("karte");
  }, []);

  const totalCount = filteredActive.length + filteredUpcoming.length + filteredLuTsa.length + filteredEd269.length;
  const activeCount =
    filteredActive.length +
    filteredLuTsa.filter((z) => z.status === "Aktiv").length +
    filteredEd269.filter((r) => r.status === "active").length;
  const upcomingCount = filteredUpcoming.length + filteredEd269.filter((r) => r.status === "upcoming").length;
  const luCount = filteredLuTsa.length;

  // Aktive NOTAM-Anzahl in den globalen Store schreiben, damit der NOTAM-Tab
  // im Bottom-Navigator rot pulsieren kann, wenn aktive Beschränkungen
  // vorliegen.
  useEffect(() => {
    setActiveNotamCount(activeCount);
  }, [activeCount]);

  // Länderblöcke der Liste (einzeln oder gruppiert nach Land)
  const renderDe = () => (
    <>
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

    </>
  );
  const renderLu = () => (
    <>
              {filteredLuTsa.length > 0 ? (
                <>
                  {false ? (
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
                  {isAdmin ? (
                    <ThemedText style={[styles.sourceInfo, { color: theme.textTertiary }]}>
                      Quelle: Geoportail.lu WMS — ANA Luxemburg
                    </ThemedText>
                  ) : null}
                </>
              ) : null}

    </>
  );
  const renderEd269 = (list: DipulTempRestriction[]) => (
    <>
              {list.length > 0 ? (
                <>
                  <View style={[styles.scopeBanner, { backgroundColor: "rgba(255,149,0,0.08)", marginTop: Spacing.lg }]}>
                    <Feather name="clock" size={14} color="#FF9500" />
                    <ThemedText style={[styles.scopeBannerText, { color: "#FF9500" }]}>
                      Temporäre Geozonen (Gültigkeit unter 30 Tagen)
                    </ThemedText>
                  </View>
                  {list.filter((r) => r.status === "active").length > 0 ? (
                    <>
                      <SectionHeader title="Aktuell aktiv" count={list.filter((r) => r.status === "active").length} color="#FF9500" icon="zap" theme={theme} />
                      {list.filter((r) => r.status === "active").map((r) => (
                        <RestrictionCard key={r.id} restriction={r} theme={theme} onShowOnMap={handleShowOnMap} />
                      ))}
                    </>
                  ) : null}
                  {list.filter((r) => r.status === "upcoming").length > 0 ? (
                    <>
                      <SectionHeader title="Zukünftig geplant" count={list.filter((r) => r.status === "upcoming").length} color="#5856D6" icon="clock" theme={theme} />
                      {list.filter((r) => r.status === "upcoming").map((r) => (
                        <RestrictionCard key={r.id} restriction={r} theme={theme} onShowOnMap={handleShowOnMap} />
                      ))}
                    </>
                  ) : null}
                </>
              ) : null}

    </>
  );
  const countryGroups = useMemo(() => {
    const groups: { iso: string; count: number; active: number }[] = [];
    if (showDe) groups.push({ iso: "DE", count: filteredActive.length + filteredUpcoming.length, active: filteredActive.length });
    if (showLu) {
      const luFir = ed269ByIso.LU ?? [];
      groups.push({
        iso: "LU",
        count: filteredLuTsa.length + luFir.length,
        active: filteredLuTsa.filter((z) => z.status === "Aktiv").length + luFir.filter((r) => r.status === "active").length,
      });
    }
    for (const iso of NOTAM_LIST_SOURCE_ISOS) {
      if (iso === "DE" || iso === "LU") continue;
      const list = ed269ByIso[iso] ?? [];
      groups.push({ iso, count: list.length, active: list.filter((r) => r.status === "active").length });
    }
    // Länder mit Einträgen zuerst, sonst alphabetisch
    return groups.sort((x, y) =>
      (y.count > 0 ? 1 : 0) - (x.count > 0 ? 1 : 0) ||
      (getCountryMapConfig(x.iso)?.nameDE || x.iso).localeCompare(getCountryMapConfig(y.iso)?.nameDE || y.iso, "de"),
    );
  }, [showDe, showLu, filteredActive, filteredUpcoming, filteredLuTsa, ed269ByIso]);

  const tabBg = theme.backgroundSecondary;
  const activeTabBg = theme.primary;

  return (
    <ThemedView style={styles.container}>
      {/* Kompakte Kopfzeile (Querformat der Fernsteuerung): kein großer
          Stack-Titel mehr – Titel, Karte/Liste und Land in EINER flachen Zeile,
          die Karte bekommt den restlichen Platz. */}
      <View
        testID="notam-header-row"
        style={[styles.tabBar, { paddingTop: insets.top + Spacing.xs, backgroundColor: theme.backgroundRoot }]}
      >
        <ThemedText style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
          NOTAMs
        </ThemedText>
        <View style={[styles.tabRow, { backgroundColor: tabBg }]}>
          <Pressable
            testID="button-notam-view-karte"
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === "karte" }}
            onPress={() => { setViewMode("karte"); setMapFocusLat(undefined); setMapFocusLon(undefined); setMapFocusId(undefined); }}
            style={[styles.tab, viewMode === "karte" ? { backgroundColor: activeTabBg } : undefined]}
          >
            <Feather name="map" size={14} color={viewMode === "karte" ? "#FFFFFF" : theme.textSecondary} />
            <ThemedText style={[styles.tabText, { color: viewMode === "karte" ? "#FFFFFF" : theme.textSecondary }]}>
              Karte
            </ThemedText>
          </Pressable>
          <Pressable
            testID="button-notam-view-liste"
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === "liste" }}
            onPress={() => setViewMode("liste")}
            style={[styles.tab, viewMode === "liste" ? { backgroundColor: activeTabBg } : undefined]}
          >
            <Feather name="list" size={14} color={viewMode === "liste" ? "#FFFFFF" : theme.textSecondary} />
            <ThemedText style={[styles.tabText, { color: viewMode === "liste" ? "#FFFFFF" : theme.textSecondary }]}>
              Liste
            </ThemedText>
          </Pressable>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => handleSelectCountry("ALL")}
          hitSlop={8}
          testID="button-notam-all-countries"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: Spacing.md,
            paddingVertical: 6,
            borderRadius: 999,
            marginRight: Spacing.xs,
            backgroundColor: detectedCountry == null ? theme.primary : theme.backgroundSecondary,
            gap: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="globe" size={13} color={detectedCountry == null ? "#FFFFFF" : theme.textSecondary} />
          <ThemedText style={{ ...Typography.small, color: detectedCountry == null ? "#FFFFFF" : theme.textSecondary, fontWeight: "600" }}>
            Alle Länder
          </ThemedText>
        </Pressable>
        {true ? (
          <Pressable
            onPress={() => setCountryPickerOpen(true)}
            hitSlop={8}
            testID="button-notam-country-picker"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: Spacing.md,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: theme.backgroundSecondary,
              gap: 6,
              flexShrink: 1,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {detectedCountry ? <ThemedText style={{ fontSize: 14 }}>{getCountryFlag(detectedCountry)}</ThemedText> : null}
            <ThemedText style={{ ...Typography.small, color: theme.textSecondary, fontWeight: "600" }} numberOfLines={1}>
              {detectedCountry ? getCountryMapConfig(detectedCountry)?.nameDE || detectedCountry : "Land wählen"}
            </ThemedText>
            <Feather name="chevron-down" size={12} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      <CountryPickerModal
        visible={countryPickerOpen}
        currentIso={detectedCountry}
        onClose={() => setCountryPickerOpen(false)}
        onSelect={(iso) => handleSelectCountry(iso)}
        testIDPrefix="notam-country"
      />

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
                  {detectedCountry == null ? "Alle unterstützten Länder – nach Land gruppiert" : detectedCountry === "LU" ? "Luxemburg — UAS-Beschränkungen" : detectedCountry === "CH" ? "Schweiz — Drohnenbeschränkungen" : detectedCountry === "NL" ? "Niederlande — Drohnenbeschränkungen" : detectedCountry === "BE" ? "Belgien — temporäre Geozonen" : detectedCountry === "AT" ? "Österreich — temporäre Geozonen" : detectedCountry === "DK" ? "Dänemark — temporäre Geozonen" : "Deutschland — dipul (temp. Beschränkungen)"}
                </ThemedText>
              </View>

              {totalCount === 0 ? (
                !showDe && !showLu && !showEd269 ? (
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

              {detectedCountry == null ? (
                countryGroups.map((g) => (
                  <View key={g.iso} style={{ marginTop: Spacing.sm }}>
                    <Pressable
                      onPress={() => toggleCountry(g.iso)}
                      testID={`notam-country-group-${g.iso}`}
                      style={({ pressed }) => [
                        styles.countryGroupHeader,
                        { backgroundColor: theme.backgroundSecondary, opacity: pressed ? 0.75 : 1 },
                      ]}
                    >
                      <ThemedText style={{ fontSize: 18 }}>{getCountryFlag(g.iso)}</ThemedText>
                      <ThemedText style={[styles.countryGroupTitle, { color: theme.text }]}>
                        {getCountryMapConfig(g.iso)?.nameDE || g.iso}
                      </ThemedText>
                      {g.active > 0 ? (
                        <View style={[styles.sectionCount, { backgroundColor: "rgba(255,149,0,0.15)" }]}>
                          <ThemedText style={{ fontSize: 12, fontWeight: "700", color: "#FF9500" }}>{g.active} aktiv</ThemedText>
                        </View>
                      ) : null}
                      <ThemedText style={{ ...Typography.small, color: theme.textSecondary }}>
                        {g.count === 0 ? "keine" : `${g.count} gesamt`}
                      </ThemedText>
                      <Feather name={expandedCountries.has(g.iso) ? "chevron-up" : "chevron-down"} size={18} color={theme.textSecondary} />
                    </Pressable>
                    {expandedCountries.has(g.iso) ? (
                      g.count === 0 ? (
                        <ThemedText style={{ ...Typography.small, color: theme.textSecondary, padding: Spacing.md }}>
                          Derzeit keine temporären Beschränkungen.
                        </ThemedText>
                      ) : g.iso === "DE" ? (
                        <>{renderDe()}</>
                      ) : g.iso === "LU" ? (
                        <>{renderLu()}{renderEd269(ed269ByIso.LU ?? [])}</>
                      ) : (
                        <>{renderEd269(ed269ByIso[g.iso] ?? [])}</>
                      )
                    ) : null}
                  </View>
                ))
              ) : (
                <>
                  {renderDe()}
                  {renderLu()}
                  {renderEd269(filteredEd269)}
                </>
              )}

              {filteredActive.length + filteredUpcoming.length > 0 && isAdmin ? (
                <ThemedText style={[styles.sourceInfo, { color: theme.textTertiary }]}>
                  Quelle: dipul Geoapi v4 — DFS / UAS-Betrieb
                </ThemedText>
              ) : null}
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, marginBottom: tabBarHeight }}>
          <NotamMapView
              restrictions={mapRestrictions}
              milStatusMap={milStatusMap}
              centerLat={currentLat ?? (detectedCountry ? getCountryDefaultCenter(detectedCountry).lat : ALL_CENTER.lat)}
              centerLon={currentLon ?? (detectedCountry ? getCountryDefaultCenter(detectedCountry).lon : ALL_CENTER.lon)}
              focusLat={mapFocusLat}
              focusLon={mapFocusLon}
              focusId={mapFocusId}
              countryIso={detectedCountry}
          />
          {mapFocusId ? (
            <View style={[styles.mapFocusBanner, { backgroundColor: theme.background + "F0" }]}>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.mapFocusName, { color: theme.text }]} numberOfLines={1}>
                  {mapRestrictions.find((r) => r.id === mapFocusId)?.name || "Beschränkung"}
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
  countryGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: 12,
  },
  countryGroupTitle: { ...Typography.body, fontWeight: "700", flex: 1 },
  container: { flex: 1 },
  scrollView: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  tabRow: {
    flexDirection: "row",
    borderRadius: BorderRadius.md,
    padding: 3,
    width: 220,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
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
