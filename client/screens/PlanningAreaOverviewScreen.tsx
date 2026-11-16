/**
 * Flugplanung – Gebietsübersicht („Umgebung prüfen“), direkt nach
 * „Standort bestätigen“: Karte mit Umkreis, allen Geozonen (inkl. dipul-
 * Farben), temporären Beschränkungen/NOTAM-Gebieten und Hindernissen; rechts
 * Reiter wie im Radar (Geozonen, NOTAMs, Hinweise) mit den Einträgen, die den
 * gewählten Umkreis berühren. Hinweise in der Nähe (Hubschrauberlandeplätze,
 * Flugplätze) sind rein informativ und blockieren nicht.
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, Text, useWindowDimensions, ActivityIndicator } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import MapPicker, { type MapPickerRef } from "@/components/MapPicker";
import type { MapPickerPoi, MapPickerShape } from "@/components/MapPicker/MapPicker.native";
import { SideTabRail, SidePanelShell, sideTabPalette, type SideTab } from "@/components/SideTabRail";
import { InfoDialog } from "@/components/InfoDialog";
import { useTheme } from "@/hooks/useTheme";
import { useAreaOverview, type LoadState } from "@/hooks/useAreaOverview";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import type { DipulTempRestriction, GeozoneFeatureInfo } from "@/lib/geozones";
import { formatAltitude, formatNotamDate, getNotamId, getNotamTypeLabel, type NotamData } from "@/lib/notams";
import { useShowDataSources } from "@/lib/dataSource";
import { ED269_SOURCE_LABELS } from "@/lib/ed269";
import { filterGeozoneDetailLines, geozoneBadgeLabel } from "@/lib/sourceAttribution";
import {
  circleRegion,
  circleToRing,
  hintsSummaryDe,
  isHeliKind,
  NM_M,
  NOTAM_WIDE_RADIUS_NM,
  obstacleSummaryTextDe,
  formatDistanceDe,
  zoneRegion,
  type NearbyHint,
} from "@/lib/areaOverview";
import { formatHeightRangeDe, FT_M } from "../../shared/heights";
import { isZoneActiveInContext } from "../../shared/ed269Restriction";
import { zonePolicy, maxRestrictionVerdict } from "../../shared/restrictionPolicy";
import { zoneMapColors } from "../../shared/dipulLayerStyles";
import { translateTextDe } from "../../shared/zoneTranslate";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningAreaOverview">;
type Nav = NativeStackNavigationProp<FlightPlanningParamList, "PlanningAreaOverview">;
type PanelId = "zones" | "notams" | "hints";

const UNAVAILABLE_OFFLINE = "nicht verfügbar (offline)";

function stateNote(state: LoadState | "disabled", offline: boolean, what: string): string | null {
  if (state === "unavailable") return offline ? `${what}: ${UNAVAILABLE_OFFLINE}` : `${what}: derzeit nicht verfügbar`;
  if (state === "partial") return offline ? `${what}: nur teilweise gespeichert (offline)` : `${what}: nur teilweise geprüft`;
  if (state === "disabled") return `${what}: in den Einstellungen ausgeblendet`;
  return null;
}

function zoneHeightText(z: GeozoneFeatureInfo): string | null {
  if (z.altitudeLabel && z.altitudeLabel.trim()) return z.altitudeLabel;
  if (z.lower || z.upper) return formatHeightRangeDe(z.lower, z.upper);
  if (typeof z.lowerMeters === "number" || typeof z.upperMeters === "number") {
    const lo = typeof z.lowerMeters === "number" ? (z.lowerMeters === 0 ? "GND" : `${Math.round(z.lowerMeters)} m`) : "GND";
    const up = typeof z.upperMeters === "number" ? `${Math.round(z.upperMeters)} m` : "unbegrenzt";
    return `${lo} – ${up}`;
  }
  return null;
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const fmtTs = (ts: number | string | null | undefined) => (ts == null ? null : new Date(ts).toLocaleString("de-DE", DATE_OPTS));

function zoneActivityLines(z: GeozoneFeatureInfo, now: Date): { active: boolean; lines: string[] } {
  const active = isZoneActiveInContext(z, { kind: "now", now });
  const lines: string[] = [];
  if (z.validStartTs != null || z.validEndTs != null) {
    lines.push(`Gültig: ${fmtTs(z.validStartTs) ?? "offen"} – ${fmtTs(z.validEndTs) ?? "offen"}`);
  }
  for (const t of z.scheduleText ?? []) lines.push(t);
  return { active, lines };
}

function dipulHeight(d: DipulTempRestriction): string {
  const lower = d.lowerAlt === 0 && d.lowerAltRef === "AGL" ? "GND" : `${Math.round(d.lowerAlt)} ${d.lowerAltUnit} ${d.lowerAltRef}`;
  const upper = d.upperAltRef === "MSL" && d.upperAlt / FT_M >= 10000
    ? `FL${Math.round(d.upperAlt / FT_M / 100)}`
    : `${Math.round(d.upperAlt)} ${d.upperAltUnit} ${d.upperAltRef}`;
  return `${lower} – ${upper}`;
}

function notamHeight(n: NotamData): string | null {
  const lo = formatAltitude(n.itemf);
  const up = formatAltitude(n.itemg);
  if (lo || up) return `${lo ?? "?"} – ${up ?? "?"}`;
  if (n.lower != null || n.upper != null) return `FL${String(n.lower ?? 0).padStart(3, "0")} – FL${String(n.upper ?? 999).padStart(3, "0")}`;
  return null;
}

function pseudoZone(name: string, rings: [number, number][][], restriction: GeozoneFeatureInfo["restriction"], color?: string): GeozoneFeatureInfo {
  return { layerLabel: "", name, details: "", polygonRings: rings, restriction, strokeColor: color, fillColor: color };
}

const HINT_CAUTION = "#FF9500";
const HINT_INFO = "#4A90D9";

export default function PlanningAreaOverviewScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<Nav>();
  const { isDark } = useTheme();
  const pal = sideTabPalette(isDark);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const isAdmin = useShowDataSources();
  const mapRef = useRef<MapPickerRef>(null);

  const { next = "datetime", ...baseParams } = route.params;
  const { latitude, longitude, radiusKm, countryIso, locationName } = baseParams;
  const center = useMemo(() => ({ lat: latitude, lon: longitude }), [latitude, longitude]);
  const radiusM = radiusKm * 1000;
  const data = useAreaOverview(latitude, longitude, radiusKm, countryIso);

  const [panel, setPanel] = useState<PanelId | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [highlight, setHighlight] = useState<{ key: string; zone: GeozoneFeatureInfo | null } | null>(null);

  // Karte zeigt den Umkreis plus Umgebung (mind. 2 km um den Standort).
  const initialRegion = useMemo(() => circleRegion(center, Math.max(radiusM, 1000), 2.4), [center, radiusM]);

  const now = useMemo(() => new Date(), []);
  const activeZones = useMemo(() => data.zones.filter((z) => isZoneActiveInContext(z, { kind: "now", now })), [data.zones, now]);
  const sortedZones = useMemo(() => {
    const order = { nogo: 0, caution: 1, info: 2 } as const;
    return [...data.zones].sort((a, b) => {
      const aa = activeZones.includes(a) ? 0 : 1;
      const bb = activeZones.includes(b) ? 0 : 1;
      return aa - bb || order[zonePolicy(a).verdict] - order[zonePolicy(b).verdict];
    });
  }, [data.zones, activeZones]);

  const notamCount = data.notamsLocal.length + data.dipul.length + data.tempZones.length;
  const cautionHints = data.hints.filter((h) => h.level === "caution");

  // ---- Reiter (Farben wie im Radar) ----
  const tabs: SideTab<PanelId>[] = useMemo(() => {
    const zoneVerdict = activeZones.length ? maxRestrictionVerdict(activeZones.map((z) => zonePolicy(z).verdict)) : null;
    const zoneBg = data.zonesState === "loading" || data.zonesState === "unavailable"
      ? pal.neutral
      : zoneVerdict === "nogo" ? pal.red : zoneVerdict === "caution" ? pal.orange : data.zones.length ? pal.blue : pal.green;
    const notamBg = data.notamState === "loading" ? pal.neutral
      : notamCount > 0 ? pal.orange
      : data.notamState === "unavailable" ? pal.neutral : pal.green;
    const hintBg = cautionHints.length ? pal.orange : data.hints.length ? pal.blue : data.poiState === "loading" ? pal.neutral : pal.green;
    return [
      { id: "zones", label: "Geozonen", bg: zoneBg, textWhite: zoneBg !== pal.neutral, badge: data.zonesState === "loading" ? undefined : data.zones.length, testID: "area-tab-zones" },
      { id: "notams", label: "NOTAMs", bg: notamBg, textWhite: notamBg !== pal.neutral, badge: data.notamState === "loading" ? undefined : notamCount, testID: "area-tab-notams" },
      { id: "hints", label: "Hinweise", bg: hintBg, textWhite: hintBg !== pal.neutral, badge: data.hints.length || undefined, testID: "area-tab-hints" },
    ];
  }, [activeZones, data.zonesState, data.zones.length, data.notamState, data.hints.length, data.poiState, notamCount, cautionHints.length, pal]);

  // ---- Karte: Zusatzflächen, Symbole, Hervorhebung ----
  const extraShapes = useMemo<MapPickerShape[]>(() => {
    const out: MapPickerShape[] = [];
    for (const z of data.tempZones) {
      const rings = (z.polygonGroups?.map((g) => g[0]) ?? z.polygonRings ?? []).filter((r) => r && r.length >= 3);
      if (rings.length) out.push({ id: `tz:${z.featureId ?? z.name}`, rings, color: zoneMapColors(z).stroke, dashed: true });
    }
    for (const d of data.dipul) {
      const color = d.status === "active" ? "#FF9500" : "#5856D6";
      if (d.polygonRings && d.polygonRings.length) out.push({ id: `dp:${d.id}`, rings: d.polygonRings, color, dashed: d.status !== "active" });
      else if (d.centerLat != null && d.centerLon != null) out.push({ id: `dp:${d.id}`, circle: { latitude: d.centerLat, longitude: d.centerLon, radiusM: d.radiusM ?? 1000 }, color, dashed: d.status !== "active" });
    }
    for (const n of data.notamsLocal) {
      if (n.lat == null || n.lon == null || !n.radius || n.radius >= NOTAM_WIDE_RADIUS_NM) continue;
      out.push({ id: `nt:${n.id}`, circle: { latitude: n.lat, longitude: n.lon, radiusM: n.radius * NM_M }, color: "#F59E0B", dashed: true });
    }
    return out;
  }, [data.tempZones, data.dipul, data.notamsLocal]);

  const poiMarkers = useMemo<MapPickerPoi[]>(() => data.hints.map((h) => {
    const heli = isHeliKind(h.poi.kind);
    return {
      id: h.id,
      latitude: h.poi.lat,
      longitude: h.poi.lon,
      glyph: heli ? "H" : h.poi.kind === "model" ? "M" : "✈",
      color: heli ? (h.poi.rescue || h.poi.hospital ? "#D7263D" : "#8E44AD") : h.poi.kind === "model" ? "#2E8B57" : "#1E6FD9",
      label: `${h.title} – ${h.distanceText}`,
      caution: h.level === "caution",
    };
  }), [data.hints]);

  const focus = useCallback((key: string, zone: GeozoneFeatureInfo | null, fallback?: { lat: number; lon: number }) => {
    if (highlight?.key === key) {
      setHighlight(null);
      mapRef.current?.animateToRegion(initialRegion);
      return;
    }
    setHighlight({ key, zone });
    const region = (zone && zoneRegion(zone)) || (fallback ? circleRegion(fallback, 400, 3) : null);
    if (region) mapRef.current?.animateToRegion(region);
  }, [highlight?.key, initialRegion]);

  const onPoiPress = useCallback((id: string) => {
    setPanel("hints");
    const h = data.hints.find((x) => x.id === id);
    if (h) focus(`hint:${id}`, null, h.poi);
  }, [data.hints, focus]);

  const goNext = () => {
    if (next === "crosscheck") navigation.navigate("PlanningCrossCheck", baseParams);
    else navigation.navigate("PlanningDateTime", baseParams);
  };

  // ---- Panel-Inhalte ----
  const textColor = pal.text;
  const muted = pal.muted;

  const renderNotes = (notes: (string | null)[]) => notes.filter(Boolean).map((n) => (
    <View key={n!} style={[styles.noteBox, { borderLeftColor: HINT_CAUTION }]}>
      <Feather name={data.offline ? "wifi-off" : "alert-circle"} size={13} color={HINT_CAUTION} />
      <Text style={[styles.noteText, { color: textColor }]}>{n}</Text>
    </View>
  ));

  const renderLoading = () => (
    <View style={styles.loading}><ActivityIndicator size="small" color={muted} /><Text style={[styles.empty, { color: muted }]}>Wird geladen …</Text></View>
  );

  const renderZone = (z: GeozoneFeatureInfo, i: number) => {
    const key = `zone:${z.featureId ?? z.name}:${i}`;
    const pol = zonePolicy(z);
    const colors = zoneMapColors(z);
    const act = zoneActivityLines(z, now);
    const height = zoneHeightText(z);
    const details = filterGeozoneDetailLines(z.details, isAdmin);
    const selected = highlight?.key === key;
    return (
      <Pressable key={key} onPress={() => focus(key, z)} testID={`area-zone-${i}`}
        style={[styles.card, { borderColor: selected ? colors.stroke : pal.divider, borderLeftColor: colors.stroke, backgroundColor: selected ? `${colors.stroke}1F` : "transparent", opacity: act.active ? 1 : 0.75 }]}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: act.active ? pol.color : "#8E8E93" }]}>
            <Text style={styles.badgeText}>{pol.labelDe}</Text>
          </View>
          {z.layerLabel ? <Text style={[styles.badgeMuted, { color: muted }]} numberOfLines={1}>{geozoneBadgeLabel(z.layerLabel, isAdmin, Object.values(ED269_SOURCE_LABELS))}</Text> : null}
          <Feather name={selected ? "eye-off" : "crosshair"} size={13} color={muted} />
        </View>
        <Text style={[styles.cardTitle, { color: textColor }]}>{z.name}</Text>
        {height ? <Text style={[styles.cardLine, { color: textColor }]}>Höhe: {height}</Text> : null}
        <Text style={[styles.cardLine, { color: act.active ? textColor : muted }]}>{act.active ? "Derzeit aktiv" : "Derzeit nicht aktiv"}</Text>
        {act.lines.map((l, li) => <Text key={`a${li}`} style={[styles.cardLine, { color: muted }]}>{l}</Text>)}
        {details.map((l, li) => <Text key={`d${li}`} style={[styles.cardDetail, { color: l.includes(":") ? textColor : muted }]}>{l}</Text>)}
      </Pressable>
    );
  };

  const renderZonesPanel = () => (
    <>
      {renderNotes([stateNote(data.zonesState === "loading" ? "ok" : data.zonesState, data.offline, "Geozonen")])}
      {data.zonesState === "loading" ? renderLoading() : sortedZones.length === 0 ? (
        data.zonesState === "unavailable" ? null : <Text style={[styles.empty, { color: muted }]}>Keine dauerhaften Geozonen im Umkreis von {formatDistanceDe(radiusM)}.</Text>
      ) : (
        <>
          <Text style={[styles.summary, { color: textColor }]}>
            {sortedZones.length} Geozone{sortedZones.length === 1 ? "" : "n"} im Umkreis ({activeZones.length} derzeit aktiv). Tippen zeigt die Zone auf der Karte.
          </Text>
          {sortedZones.map(renderZone)}
        </>
      )}
    </>
  );

  const renderDipul = (d: DipulTempRestriction, i: number) => {
    const key = `dipul:${d.id}`;
    const color = d.status === "active" ? "#FF9500" : "#5856D6";
    const rings = d.polygonRings && d.polygonRings.length ? d.polygonRings
      : d.centerLat != null && d.centerLon != null ? [circleToRing({ lat: d.centerLat, lon: d.centerLon }, d.radiusM ?? 1000)] : [];
    const selected = highlight?.key === key;
    const legal = d.legalExplanation ? translateTextDe(d.legalExplanation).text : "";
    return (
      <Pressable key={`${key}:${i}`} onPress={() => focus(key, rings.length ? pseudoZone(d.name, rings, "RESTRICTED", color) : null)} testID={`area-dipul-${i}`}
        style={[styles.card, { borderColor: selected ? color : pal.divider, borderLeftColor: color, backgroundColor: selected ? `${color}1F` : "transparent" }]}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: color }]}><Text style={styles.badgeText}>{d.status === "active" ? "Aktiv" : "Anstehend"}</Text></View>
          <Text style={[styles.badgeMuted, { color: muted }]} numberOfLines={1}>{d.type || "Temporäre Beschränkung"}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: textColor }]}>{d.name}</Text>
        <Text style={[styles.cardLine, { color: textColor }]}>Höhe: {dipulHeight(d)}</Text>
        <Text style={[styles.cardLine, { color: textColor }]}>
          Zeitraum: {fmtTs(d.startTs) ?? "offen"} – {d.endTsIndefinite ? "unbefristet" : fmtTs(d.endTs) ?? "offen"}
        </Text>
        {(d.scheduleText ?? []).map((t, ti) => <Text key={ti} style={[styles.cardLine, { color: muted }]}>{t}</Text>)}
        {d.legalRef ? <Text style={[styles.cardDetail, { color: muted }]}>Rechtsgrundlage: {d.legalRef}</Text> : null}
        {legal ? <Text style={[styles.cardDetail, { color: muted }]}>{legal}</Text> : null}
      </Pressable>
    );
  };

  const renderNotam = (n: NotamData, i: number, wide: boolean) => {
    const key = `notam:${n.id}`;
    const hasCircle = !wide && n.lat != null && n.lon != null && !!n.radius;
    const selected = highlight?.key === key;
    const height = notamHeight(n);
    const text = translateTextDe(n.iteme || "").text;
    return (
      <Pressable key={`${key}:${i}`} disabled={!hasCircle}
        onPress={() => focus(key, hasCircle ? pseudoZone(getNotamId(n), [circleToRing({ lat: n.lat!, lon: n.lon! }, n.radius! * NM_M)], "RESTRICTED", "#F59E0B") : null)}
        testID={`area-notam-${wide ? "wide-" : ""}${i}`}
        style={[styles.card, { borderColor: selected ? "#F59E0B" : pal.divider, borderLeftColor: "#F59E0B", backgroundColor: selected ? "#F59E0B1F" : "transparent" }]}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: "#F59E0B" }]}><Text style={styles.badgeText}>{getNotamId(n)}</Text></View>
          <Text style={[styles.badgeMuted, { color: muted }]} numberOfLines={1}>{getNotamTypeLabel(n)}</Text>
        </View>
        {height ? <Text style={[styles.cardLine, { color: textColor }]}>Höhe: {height}</Text> : null}
        <Text style={[styles.cardLine, { color: textColor }]}>Gültig: {formatNotamDate(n.startvalidity)} – {formatNotamDate(n.endvalidity)}</Text>
        {n.itemd ? <Text style={[styles.cardLine, { color: muted }]}>Zeiten: {n.itemd}</Text> : null}
        {hasCircle ? <Text style={[styles.cardLine, { color: muted }]}>Radius {n.radius} NM ({formatDistanceDe(n.radius! * NM_M)})</Text> : null}
        <Text style={[styles.cardDetail, { color: textColor }]}>{text}</Text>
      </Pressable>
    );
  };

  const renderNotamsPanel = () => (
    <>
      {renderNotes([
        stateNote(data.notamState === "loading" ? "ok" : data.notamState, data.offline, "NOTAMs"),
        stateNote(data.dipulState === "loading" ? "ok" : data.dipulState, data.offline, "Temporäre Beschränkungen (dipul)"),
      ])}
      {data.notamState === "loading" && data.dipulState === "loading" ? renderLoading() : (
        <>
          {notamCount === 0 && data.notamState !== "unavailable" ? (
            <Text style={[styles.empty, { color: muted }]}>Keine örtlichen NOTAMs oder temporären Beschränkungen im Umkreis.</Text>
          ) : null}
          {data.dipul.length > 0 ? <Text style={[styles.section, { color: muted }]}>Temporäre Betriebseinschränkungen ({data.dipul.length})</Text> : null}
          {data.dipul.map(renderDipul)}
          {data.tempZones.length > 0 ? <Text style={[styles.section, { color: muted }]}>Temporäre Zonen ({data.tempZones.length})</Text> : null}
          {data.tempZones.map((z, i) => renderZone(z, 1000 + i))}
          {data.notamsLocal.length > 0 ? <Text style={[styles.section, { color: muted }]}>NOTAMs im Umkreis ({data.notamsLocal.length})</Text> : null}
          {data.notamsLocal.map((n, i) => renderNotam(n, i, false))}
          {data.notamsWide.length > 0 ? (
            <>
              <Text style={[styles.section, { color: muted }]}>Großräumige NOTAMs (FIR-weit, {data.notamsWide.length})</Text>
              {data.notamsWide.slice(0, 15).map((n, i) => renderNotam(n, i, true))}
              {data.notamsWide.length > 15 ? <Text style={[styles.cardLine, { color: muted }]}>… weitere im NOTAM-Schritt.</Text> : null}
            </>
          ) : null}
          <Text style={[styles.footnote, { color: muted }]}>Zeitangaben in NOTAMs: UTC.</Text>
        </>
      )}
    </>
  );

  const renderHint = (h: NearbyHint) => {
    const key = `hint:${h.id}`;
    const color = h.level === "caution" ? HINT_CAUTION : HINT_INFO;
    const selected = highlight?.key === key;
    return (
      <Pressable key={key} onPress={() => focus(key, null, h.poi)} testID={`area-hint-${h.id}`}
        style={[styles.card, { borderColor: selected ? color : pal.divider, borderLeftColor: color, backgroundColor: h.level === "caution" ? `${color}18` : "transparent" }]}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: color, flexDirection: "row", alignItems: "center", gap: 3 }]}>
            <Feather name={h.level === "caution" ? "alert-triangle" : "info"} size={10} color="#FFFFFF" />
            <Text style={styles.badgeText}>{h.level === "caution" ? "Vorsicht" : "Info"}</Text>
          </View>
          <Text style={[styles.badgeMuted, { color: textColor, fontWeight: "700" }]}>{h.distanceText}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: textColor }]}>{h.title}</Text>
        <Text style={[styles.cardDetail, { color: muted }]}>{h.text}</Text>
      </Pressable>
    );
  };

  const renderHintsPanel = () => (
    <>
      {renderNotes([
        data.poiState === "unavailable"
          ? (data.offline ? `Hubschrauberlandeplätze/Flugplätze (OSM): ${UNAVAILABLE_OFFLINE} – nur die gespeicherte Flughafenliste wird geprüft.` : "Hubschrauberlandeplätze/Flugplätze (OSM): derzeit nicht verfügbar – nur die gespeicherte Flughafenliste wird geprüft.")
          : data.poiState === "partial" ? "Hubschrauberlandeplätze/Flugplätze: nur teilweise geladen." : null,
      ])}
      {data.poiState === "loading" && data.hints.length === 0 ? renderLoading() : null}
      {data.hints.length === 0 && data.poiState !== "loading" ? (
        <Text style={[styles.empty, { color: muted }]}>Keine Hubschrauberlandeplätze oder Flugplätze in der Nähe erfasst.</Text>
      ) : null}
      {data.hints.map(renderHint)}
      <Text style={[styles.section, { color: muted }]}>Hindernisse im Umkreis</Text>
      {data.obstaclesState === "loading" && !data.obstacles ? renderLoading() : data.obstaclesState === "disabled" || (data.obstaclesState === "unavailable" && !data.obstacles?.total) ? (
        renderNotes([stateNote(data.obstaclesState, data.offline, "Hindernisse")])
      ) : (
        <View style={[styles.card, { borderColor: pal.divider, borderLeftColor: "#7B2CBF" }]}>
          <Text style={[styles.cardDetail, { color: textColor }]}>{data.obstacles ? obstacleSummaryTextDe(data.obstacles) : "–"}</Text>
          {data.obstacles?.tallest ? (
            <Text style={[styles.cardLine, { color: muted }]}>
              Höchstes: {data.obstacles.tallest.label} {Math.round(data.obstacles.tallest.heightM)} m – {formatDistanceDe(data.obstacles.tallest.distanceM)} {data.obstacles.tallest.direction}
            </Text>
          ) : null}
          <Text style={[styles.footnote, { color: muted }]}>Quelle: OpenStreetMap, unvollständig – vor Ort prüfen.</Text>
        </View>
      )}
      <Text style={[styles.footnote, { color: muted }]}>Hinweise sind reine Information und blockieren die Planung nicht.</Text>
    </>
  );

  const panelTitle = panel === "zones" ? "Geozonen im Umkreis" : panel === "notams" ? "NOTAMs / Temporär" : "Hinweise in der Nähe";
  const panelAccent = panel === "zones" ? "#4A90D9" : panel === "notams" ? "#F59E0B" : cautionHints.length ? HINT_CAUTION : HINT_INFO;
  const panelWidth = Math.min(410, Math.max(300, width * 0.44));
  const bottomBar = insets.bottom + 72;

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.body, { paddingTop: headerHeight }]} testID="planning-area-overview">
        <MapPicker
          ref={mapRef}
          initialRegion={initialRegion}
          selectedLocation={{ latitude, longitude }}
          locationName={locationName}
          radiusMeters={radiusM}
          allCountriesGeozones
          showCtrBands
          mapStyleSwitcherVariant="compact"
          highlightZones={highlight?.zone ? [highlight.zone] : undefined}
          extraShapes={extraShapes}
          poiMarkers={poiMarkers}
          onPoiPress={onPoiPress}
          legendRightInset={48}
        />

        {/* Zusammenfassung oben links */}
        <View style={[styles.chips, { left: Math.max(insets.left, 10), right: panel ? panelWidth + 12 : 56 }]} pointerEvents="box-none">
          <View style={[styles.chip, { backgroundColor: "rgba(20,30,48,0.85)" }]}>
            <Feather name="crosshair" size={12} color="#FFFFFF" />
            <Text style={styles.chipText} numberOfLines={1}>{locationName ? `${locationName} · ` : ""}Umkreis {formatDistanceDe(radiusM)}</Text>
          </View>
          {data.hints.length > 0 ? (
            <Pressable onPress={() => setPanel("hints")} testID="area-hints-chip"
              style={[styles.chip, { backgroundColor: cautionHints.length ? HINT_CAUTION : HINT_INFO }]}>
              <Feather name={cautionHints.length ? "alert-triangle" : "info"} size={12} color="#FFFFFF" />
              <Text style={styles.chipText}>{hintsSummaryDe(data.hints)}</Text>
            </Pressable>
          ) : null}
          {data.offline ? (
            <View style={[styles.chip, { backgroundColor: "#8E8E93" }]}>
              <Feather name="wifi-off" size={12} color="#FFFFFF" />
              <Text style={styles.chipText}>Offline – gespeicherte Daten</Text>
            </View>
          ) : null}
        </View>

        <SideTabRail tabs={tabs} activeId={panel} isDark={isDark} top={headerHeight + 8}
          onPress={(id) => setPanel((p) => (p === id ? null : id))} />

        {panel ? (
          <SidePanelShell
            title={panelTitle}
            accentColor={panelAccent}
            isDark={isDark}
            onClose={() => setPanel(null)}
            onInfo={() => setInfoOpen(true)}
            style={{ top: headerHeight + 8, bottom: bottomBar, width: panelWidth }}
            testID={`area-panel-${panel}`}
          >
            {panel === "zones" ? renderZonesPanel() : panel === "notams" ? renderNotamsPanel() : renderHintsPanel()}
          </SidePanelShell>
        ) : null}

        <View style={[styles.footer, { bottom: insets.bottom + 12, right: Math.max(insets.right, 12) }]}>
          <Pressable onPress={goNext} style={styles.nextButton} testID="button-area-continue" accessibilityRole="button">
            <Text style={styles.nextText}>{next === "crosscheck" ? "Weiter zur Gegenprüfung" : "Weiter zu Datum & Zeit"}</Text>
            <Feather name="chevron-right" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      <InfoDialog
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="Umgebung prüfen"
        icon="info"
        accentColor={panelAccent}
        sections={[
          { title: "Geozonen", body: "Alle Geozonen, die den gewählten Umkreis berühren – mit Einstufung, Höhen, Aktivzeiten und dem (übersetzten) Behördentext. Tippen hebt die Zone auf der Karte hervor." },
          { title: "NOTAMs / Temporär", body: "Örtliche NOTAMs, temporäre Betriebseinschränkungen (dipul) und temporäre Zonen im Umkreis. Großräumige (FIR-weite) NOTAMs stehen gesondert. Zeitangaben in NOTAMs sind UTC." },
          { title: "Hinweise in der Nähe", body: "Hubschrauberlandeplätze (insbesondere Luftrettung/Kliniken) im Umkreis oder bis 1,5 km sind als Vorsicht markiert, Flugplätze bis 5 km als reine Info. Datenquelle: OpenStreetMap und die Flughafenliste der App – nicht vollständig." },
        ]}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  chips: { position: "absolute", top: 0, flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10, zIndex: 20 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, maxWidth: 360 },
  chipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  footer: { position: "absolute", zIndex: 140 },
  nextButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#007AFF", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, elevation: 6 },
  nextText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderRadius: 8, padding: 10, gap: 2 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  badge: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  badgeMuted: { flex: 1, fontSize: 11 },
  cardTitle: { fontSize: 14, fontWeight: "700" },
  cardLine: { fontSize: 12, lineHeight: 17 },
  cardDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  summary: { fontSize: 12, fontWeight: "600" },
  section: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 6 },
  empty: { fontSize: 13, textAlign: "center", paddingVertical: 14 },
  footnote: { fontSize: 11, fontStyle: "italic", marginTop: 4 },
  loading: { alignItems: "center", paddingVertical: 12, gap: 4 },
  noteBox: { flexDirection: "row", alignItems: "center", gap: 6, borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: "rgba(255,149,0,0.12)" },
  noteText: { flex: 1, fontSize: 12, fontWeight: "600" },
});
