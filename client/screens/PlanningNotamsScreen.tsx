import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { MIL_LOW_FLIGHT_ACTIVATION_TEXT, MIL_LOW_FLIGHT_SOURCE_URL, MIL_LOW_FLIGHT_DATA_STAND } from "@/lib/milLowFlight";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import {
  fetchNearbyTempRestrictions,
  DipulTempRestriction,
  DipulTempRestrictionsResult,
} from "@/lib/geozones";
import {
  deriveNearbyMilLowFlightStatuses,
  formatActivationWindow,
  getStatusColor,
  getStatusLabel,
  MilLowFlightAreaStatus,
} from "@/lib/milLowFlight";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningNotams">;
type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningNotams">;

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

function RestrictionCard({ restriction, theme }: { restriction: DipulTempRestriction; theme: any }) {
  const [expanded, setExpanded] = useState(false);
  const isMilLowFlight = restriction.kind === "mil_low_flight_day";
  const isEDR = restriction.name.startsWith("ED-R");
  const isUpcoming = restriction.status === "upcoming";
  const borderColor = isMilLowFlight ? "#7B8B3A" : isUpcoming ? "#5856D6" : isEDR ? "#FF3B30" : "#FF9500";
  const statusColor = isMilLowFlight ? "#7B8B3A" : isUpcoming ? "#5856D6" : "#34C759";
  const statusLabel = isMilLowFlight ? "Mil. Tiefflug Tag" : isUpcoming ? "Zukünftig" : "Aktiv";
  const statusIcon = isMilLowFlight ? "shield" : isUpcoming ? "clock" : "zap";
  const dateRange = formatDateRange(restriction);
  const remaining = isUpcoming ? daysUntilStart(restriction) : daysRemaining(restriction);
  const categoryIcon = restriction.category === "military" ? "shield" : restriction.category === "nature" ? "feather" : restriction.category === "notam" ? "file-text" : "alert-circle";

  return (
    <Pressable onPress={() => setExpanded(!expanded)} testID={`restriction-card-${restriction.id}`}>
      <Card style={[styles.card, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.severityDot, { backgroundColor: borderColor }]} />
            <ThemedText style={styles.cardName} numberOfLines={2}>{restriction.name}</ThemedText>
            <View style={[styles.typeBadge, { backgroundColor: borderColor + "20" }]}>
              <ThemedText style={[styles.typeBadgeText, { color: borderColor }]}>{restriction.type}</ThemedText>
            </View>
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
        </View>

        {dateRange ? (
          <View style={styles.dateRow}>
            <Feather name="calendar" size={11} color={theme.textSecondary} />
            <ThemedText style={[styles.dateText, { color: theme.textSecondary }]}>{dateRange}</ThemedText>
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
            <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>{formatAltitude(restriction)}</ThemedText>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + "18" }]}>
            <Feather name={statusIcon as any} size={9} color={statusColor} />
            <ThemedText style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</ThemedText>
          </View>
        </View>

        {isMilLowFlight ? (
          <View style={[styles.detailRow, { marginTop: 4 }]}>
            <Feather name="alert-triangle" size={11} color="#7B8B3A" />
            <ThemedText style={[styles.detailText, { color: "#7B8B3A", fontWeight: "600", flex: 1 }]} numberOfLines={3}>
              Aktiv {MIL_LOW_FLIGHT_ACTIVATION_TEXT}. Höhenband GND — 250 ft AGL. Vor Start NOTAMs prüfen.
            </ThemedText>
          </View>
        ) : null}

        {expanded ? (
          <View style={styles.cardDetails}>
            <View style={styles.detailRow}>
              <Feather name={categoryIcon as any} size={12} color={theme.primary} />
              <ThemedText style={[styles.detailText, { color: theme.primary, fontWeight: "600" }]}>{restriction.legalExplanation}</ThemedText>
            </View>
            {isMilLowFlight ? (
              <Pressable
                onPress={() => { WebBrowser.openBrowserAsync(MIL_LOW_FLIGHT_SOURCE_URL).catch(() => {}); }}
                style={styles.detailRow}
              >
                <Feather name="external-link" size={12} color="#7B8B3A" />
                <ThemedText style={[styles.detailText, { color: "#7B8B3A", fontWeight: "600" }]}>
                  Karte und Details auf dipul.de (Stand {MIL_LOW_FLIGHT_DATA_STAND})
                </ThemedText>
              </Pressable>
            ) : null}
            {restriction.legalRef ? (
              <View style={styles.detailRow}>
                <Feather name="book" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>{restriction.legalRef}</ThemedText>
              </View>
            ) : null}
            <View style={styles.detailRow}>
              <Feather name="arrow-down" size={12} color={theme.textTertiary} />
              <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                Untergrenze: {restriction.lowerAlt === 0 && restriction.lowerAltRef === "AGL" ? "GND (Boden)" : `${Math.round(restriction.lowerAlt)} ${restriction.lowerAltUnit} ${restriction.lowerAltRef}`}
              </ThemedText>
            </View>
            <View style={styles.detailRow}>
              <Feather name="arrow-up" size={12} color={theme.textTertiary} />
              <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                Obergrenze: {Math.round(restriction.upperAlt)} {restriction.upperAltUnit} {restriction.upperAltRef}
                {restriction.upperAltRef === "MSL" ? ` (${Math.round(restriction.upperAlt * 3.28084)} ft)` : ""}
              </ThemedText>
            </View>
            {restriction.startTs ? (
              <View style={styles.detailRow}>
                <Feather name="play" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Beginn: {new Date(restriction.startTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                </ThemedText>
              </View>
            ) : null}
            {restriction.endTs ? (
              <View style={styles.detailRow}>
                <Feather name="square" size={12} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Ende: {restriction.endTsIndefinite ? "Unbefristet (Dauerhaft aktiv)" : `${new Date(restriction.endTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`}
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
              <ThemedText style={[styles.detailText, { color: theme.textTertiary }]} numberOfLines={1}>{restriction.extRef || restriction.id}</ThemedText>
            </View>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

function MilLowFlightCard({ status, theme }: { status: MilLowFlightAreaStatus; theme: any }) {
  const color = getStatusColor(status.status);
  const label = getStatusLabel(status.status);
  const window = formatActivationWindow(status);
  return (
    <Card style={[styles.card, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <View style={styles.cardHeader} testID={`milflight-card-${status.area.id}`}>
        <View style={styles.cardHeaderLeft}>
          <Feather name="shield" size={14} color={color} />
          <ThemedText style={styles.cardName} numberOfLines={2}>{status.area.shortName}</ThemedText>
          <View style={[styles.typeBadge, { backgroundColor: color + "20" }]}>
            <ThemedText style={[styles.typeBadgeText, { color }]}>{label}</ThemedText>
          </View>
        </View>
      </View>
      <View style={styles.cardMeta}>
        <View style={styles.metaRow}>
          <Feather name="map-pin" size={11} color={theme.textTertiary} />
          <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>{status.area.region}</ThemedText>
        </View>
      </View>
      {window ? (
        <View style={[styles.dateRow, { marginTop: 4 }]}>
          <Feather name="clock" size={11} color={theme.textSecondary} />
          <ThemedText style={[styles.dateText, { color: theme.textSecondary }]}>{window}</ThemedText>
        </View>
      ) : status.status === "inactive" ? (
        <View style={[styles.dateRow, { marginTop: 4 }]}>
          <Feather name="info" size={11} color={theme.textTertiary} />
          <ThemedText style={[styles.dateText, { color: theme.textTertiary }]}>
            Keine aktive AUP/UUP- oder NOTAM-Aktivierung gefunden — nur informativ.
          </ThemedText>
        </View>
      ) : null}
    </Card>
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

export default function PlanningNotamsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();

  const { latitude, longitude, locationName, radiusKm, routeWaypoints } = route.params;

  const [result, setResult] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const loadRestrictions = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await fetchNearbyTempRestrictions(latitude, longitude, radiusKm || 50);
      setResult(data);
    } catch {
      setError("Fehler beim Laden der temporären Beschränkungen");
    } finally {
      setLoading(false);
    }
  }, [latitude, longitude, radiusKm]);

  useEffect(() => {
    loadRestrictions();
  }, [loadRestrictions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRestrictions();
    setRefreshing(false);
  }, [loadRestrictions]);

  const handleOpenNotamMap = () => {
    navigation.navigate("PlanningNotamMap", { latitude, longitude, restrictions: [...result.active, ...result.upcoming], milStatuses: milLowFlightStatuses, routeWaypoints });
  };

  const totalCount = result.active.length + result.upcoming.length;
  const edrCount = [...result.active, ...result.upcoming].filter((r) => r.name.startsWith("ED-R")).length;
  const milLowFlightStatuses = React.useMemo(
    () => deriveNearbyMilLowFlightStatuses(result, latitude, longitude, radiusKm || 50),
    [result, latitude, longitude, radiusKm]
  );
  const milActiveCount = milLowFlightStatuses.filter((s) => s.status === "active").length;
  const milUpcomingCount = milLowFlightStatuses.filter((s) => s.status === "upcoming").length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.lg,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        <Card style={[styles.locationCard, { borderLeftColor: theme.primary }]}>
          <Feather name="map-pin" size={16} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.locationName}>
              {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
            </ThemedText>
            <ThemedText style={[styles.locationCoords, { color: theme.textTertiary }]}>
              {latitude.toFixed(4)}, {longitude.toFixed(4)}
            </ThemedText>
          </View>
        </Card>

        <Pressable onPress={handleOpenNotamMap} style={[styles.mapBtn, { backgroundColor: theme.primary }]} testID="button-planning-notam-map">
          <Feather name="map" size={16} color="#FFFFFF" />
          <ThemedText style={styles.mapBtnText}>NOTAM-Karte öffnen</ThemedText>
        </Pressable>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>Beschränkungen werden geladen...</ThemedText>
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
              {edrCount > 0 ? (
                <View style={[styles.statBadge, { backgroundColor: "rgba(255,59,48,0.1)" }]}>
                  <ThemedText style={[styles.statValue, { color: "#FF3B30" }]}>{edrCount}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: "#FF3B30" }]}>ED-R</ThemedText>
                </View>
              ) : null}
              {result.upcoming.length > 0 ? (
                <View style={[styles.statBadge, { backgroundColor: "rgba(88,86,214,0.1)" }]}>
                  <ThemedText style={[styles.statValue, { color: "#5856D6" }]}>{result.upcoming.length}</ThemedText>
                  <ThemedText style={[styles.statLabel, { color: "#5856D6" }]}>Geplant</ThemedText>
                </View>
              ) : null}
            </View>

            <View style={[styles.scopeBanner, { backgroundColor: "rgba(0,122,255,0.08)" }]}>
              <Feather name="map-pin" size={14} color={theme.primary} />
              <ThemedText style={[styles.scopeBannerText, { color: theme.primary }]}>Standortbezogen ({radiusKm ? (radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm.toFixed(1)} km`) : "50 km"} Radius) — dipul Geoapi v4</ThemedText>
            </View>

            {totalCount === 0 ? (
              <Card style={styles.emptyCard}>
                <Feather name="check-circle" size={32} color="#34C759" />
                <ThemedText style={[styles.emptyTitle, { color: theme.text }]}>Keine Beschränkungen im Umkreis</ThemedText>
                <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
                  Im Umkreis von 50 km um deinen Flugstandort sind keine temporären Betriebseinschränkungen aktiv oder geplant.
                </ThemedText>
              </Card>
            ) : null}

            {result.active.filter((r) => r.kind === "mil_low_flight_day").length > 0 ? (
              <>
                <SectionHeader
                  title="Mil. Tieffluggebiete (Tag)"
                  count={result.active.filter((r) => r.kind === "mil_low_flight_day").length}
                  color="#7B8B3A"
                  icon="shield"
                  theme={theme}
                />
                {result.active.filter((r) => r.kind === "mil_low_flight_day").map((r) => (
                  <RestrictionCard key={r.id} restriction={r} theme={theme} />
                ))}
              </>
            ) : null}

            {result.active.filter((r) => r.kind !== "mil_low_flight_day").length > 0 ? (
              <>
                <SectionHeader title="Aktuell aktiv" count={result.active.filter((r) => r.kind !== "mil_low_flight_day").length} color="#34C759" icon="zap" theme={theme} />
                {result.active.filter((r) => r.kind !== "mil_low_flight_day").map((r) => (
                  <RestrictionCard key={r.id} restriction={r} theme={theme} />
                ))}
              </>
            ) : null}

            {result.upcoming.length > 0 ? (
              <>
                <SectionHeader title="Zukünftig geplant" count={result.upcoming.length} color="#5856D6" icon="clock" theme={theme} />
                {result.upcoming.map((r) => (
                  <RestrictionCard key={r.id} restriction={r} theme={theme} />
                ))}
              </>
            ) : null}

            {totalCount > 0 ? (
              <ThemedText style={[styles.sourceInfo, { color: theme.textTertiary }]}>
                Quelle: dipul Geoapi v4 — DFS / UAS-Betrieb
              </ThemedText>
            ) : null}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderLeftWidth: 3,
  },
  locationName: { ...Typography.callout, fontWeight: "600" },
  locationCoords: { ...Typography.caption, marginTop: 2 },
  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  mapBtnText: { ...Typography.callout, fontWeight: "700", color: "#FFFFFF" },
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
  dateRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, marginBottom: 2 },
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
  sourceInfo: { ...Typography.caption, textAlign: "center", marginTop: Spacing.md, fontSize: 10 },
});
