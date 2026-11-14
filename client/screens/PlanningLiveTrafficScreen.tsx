import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { View, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, Platform, Modal, Text, Dimensions, AppState, Linking, Alert } from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import TrafficMapView, { TrafficMarker, AircraftTrail, WindData } from "@/components/TrafficMapView";
import { fetchDipulWind } from "@/lib/weather";
import { fetchElevation, enrichAircraftWithElevation } from "@/lib/elevation";
import ProximityAlarmBanner from "@/components/ProximityAlarmBanner";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useProximityAlarm } from "@/hooks/useProximityAlarm";
import { useAircraftTrails } from "@/hooks/useAircraftTrails";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { GEOZONE_REGULATORY_INFO, GeozoneContact, getContactsForZone, loadGeozoneSettings, saveGeozoneSettings, getActiveLayerNames, MAP_STYLES, MapStyleOption, loadMapStyle, saveMapStyle, loadRadarSettings, saveRadarSettings, getCountryGeozoneLayers, getCountryGeozoneConfig } from "@/lib/geozones";
import { getMarkerPinColor } from "@/lib/markerColors";
import * as WebBrowser from "@/lib/webBrowser";
import {
  fetchNearbyAircraft,
  AircraftState,
  getAltitudeDisplay,
  getAltitudeDualDisplay,
  formatAltitudeDual,
  getSpeedDisplay,
  getHeadingDisplay,
  getVerticalRateDisplay,
  getCategoryLabel,
  getSourceLabels,
  DataSource,
  getRelativeAltitude,
} from "@/lib/opensky";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningLiveTraffic">;

function openGeozoneContact(c: GeozoneContact) {
  if (c.type === "web") {
    WebBrowser.openBrowserAsync(c.value).catch(() => {
      Alert.alert("Fehler", "Die Webseite konnte nicht geöffnet werden.");
    });
    return;
  }
  const url = c.type === "email" ? `mailto:${c.value}` : `tel:${c.value}`;
  Linking.canOpenURL(url).then((supported) => {
    if (supported) {
      Linking.openURL(url).catch(() => {
        Alert.alert("Fehler", c.type === "email" ? "E-Mail konnte nicht geöffnet werden." : "Anruf konnte nicht gestartet werden.");
      });
    } else {
      Alert.alert(
        c.type === "email" ? "E-Mail" : "Anruf",
        c.type === "email" ? `E-Mail an: ${c.value}` : `Telefonnummer: ${c.value.replace(/^\+49/, "+49 ")}`,
        [{ text: "OK" }]
      );
    }
  }).catch(() => {});
}

export default function PlanningLiveTrafficScreen() {
  const route = useRoute<RouteParams>();
  const { theme, isDark } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { latitude, longitude, locationName, countryIso } = route.params;

  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [radiusKm, setRadiusKm] = useState(25);
  const [viewMode, setViewMode] = useState<"map" | "list">(Platform.OS === "web" ? "list" : "map");
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLoadingAircraft = useRef(false);
  const [trails, setTrails] = useState<AircraftTrail[]>([]);
  const [sourceStatus, setSourceStatus] = useState<Record<DataSource, "ok" | "error" | "timeout">>({ opensky: "ok", adsbfi: "ok", adsbone: "ok", airplaneslive: "ok", adsblol: "ok", ogn: "ok" });
  const [wind, setWind] = useState<WindData | null>(null);
  const [geozoneSettings, setGeozoneSettings] = useState<Record<string, boolean>>({});
  const [showGeozoneModal, setShowGeozoneModal] = useState(false);
  const activeGeozoneLayers = useMemo(() => getActiveLayerNames(geozoneSettings, countryIso), [geozoneSettings, countryIso]);
  const [mapStyle, setMapStyle] = useState<MapStyleOption>("standard");

  useEffect(() => {
    loadGeozoneSettings(countryIso).then(setGeozoneSettings);
    loadMapStyle().then((saved) => {
      setMapStyle(saved);
    });
    loadRadarSettings().then((rs) => setRadiusKm(rs.radiusKm));
  }, [countryIso]);

  const [pilotElevation, setPilotElevation] = useState<number | null>(null);

  useEffect(() => {
    fetchElevation(latitude, longitude).then((elev) => setPilotElevation(elev));
  }, [latitude, longitude]);

  const { activeAlerts, approachingAircraft, alarmActive, alarmLevel, alarmSettings, clearOfConflict, dismissAlarm } = useProximityAlarm(aircraft, latitude, longitude, undefined, pilotElevation);
  const { updateTrails, clearTrails } = useAircraftTrails();

  useEffect(() => {
    let cancelled = false;
    const loadWind = async () => {
      const w = await fetchDipulWind(latitude, longitude);
      if (!cancelled && w) setWind({ direction: w.direction, speed: w.speed, directionLabel: w.directionLabel });
    };
    loadWind();
    const iv = setInterval(loadWind, 300000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [latitude, longitude]);

  const loadAircraft = useCallback(async () => {
    if (isLoadingAircraft.current) return;
    isLoadingAircraft.current = true;
    try {
      setError(null);
      const result = await fetchNearbyAircraft(latitude, longitude, radiusKm);
      const enriched = await enrichAircraftWithElevation(result.states);
      const trailResult = updateTrails(enriched, latitude, longitude, radiusKm);
      setTrails(trailResult.trails);
      const mergedIds = new Set(enriched.map((a) => a.icao24));
      const merged: AircraftState[] = [...(enriched as AircraftState[])];
      for (const bac of trailResult.bufferedAircraft) {
        if (!mergedIds.has(bac.icao24)) {
          merged.push(bac);
          mergedIds.add(bac.icao24);
        }
      }
      setAircraft(merged);
      setSourceStatus(result.sourceStatus);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden der Flugdaten");
      setLoading(false);
    } finally {
      isLoadingAircraft.current = false;
    }
  }, [latitude, longitude, radiusKm, updateTrails]);

  useEffect(() => {
    loadAircraft();
    refreshInterval.current = setInterval(loadAircraft, 3000);
    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [loadAircraft]);

  const loadAircraftRef = useRef(loadAircraft);
  loadAircraftRef.current = loadAircraft;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        clearTrails();
        setAircraft([]);
        setTrails([]);
        loadAircraftRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  const handleManualRefresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    loadAircraft();
  };

  const getAltitudeColor = (alt: number | null) => {
    if (alt == null) return theme.textTertiary;
    if (alt < 150) return theme.statusNoGo;
    if (alt < 500) return theme.statusCaution;
    return theme.statusGo;
  };

  const sortedAircraft = useMemo(() => [...aircraft].sort((a, b) => {
    const altA = a.aglAltitude ?? a.geoAltitude ?? a.baroAltitude ?? 99999;
    const altB = b.aglAltitude ?? b.geoAltitude ?? b.baroAltitude ?? 99999;
    return altA - altB;
  }), [aircraft]);

  const lowAltitudeCount = useMemo(() => aircraft.filter((a) => {
    const alt = a.aglAltitude ?? getRelativeAltitude(a, pilotElevation);
    return alt != null && alt < 500;
  }).length, [aircraft, pilotElevation]);

  const renderAircraft = ({ item }: { item: AircraftState }) => {
    const alt = item.aglAltitude ?? getRelativeAltitude(item, pilotElevation);
    const altColor = getAltitudeColor(alt);
    const isLow = alt != null && alt < 500;

    return (
      <Card style={[styles.aircraftCard, isLow ? { borderLeftWidth: 3, borderLeftColor: theme.statusCaution } : undefined]}>
        <View style={styles.aircraftHeader}>
          <View style={styles.callsignRow}>
            <Feather name="navigation" size={16} color={theme.primary} style={{ transform: [{ rotate: `${(item.trueTrack ?? 0)}deg` }] }} />
            <ThemedText style={styles.callsign}>{item.callsign || item.icao24}</ThemedText>
            {item.callsign ? (
              <ThemedText style={[styles.icao24, { color: theme.textTertiary }]}>{item.icao24}</ThemedText>
            ) : null}
          </View>
          <View style={[styles.altBadge, { backgroundColor: altColor + "20" }]}>
            <ThemedText style={[styles.altBadgeText, { color: altColor }]}>{getAltitudeDisplay(item)}</ThemedText>
            <ThemedText style={[styles.altBadgeSub, { color: altColor }]}>
              AGL {getAltitudeDualDisplay(item).agl} | MSL {getAltitudeDualDisplay(item).msl}
            </ThemedText>
          </View>
        </View>
        <View style={styles.categorySourceRow}>
          <View style={[styles.categoryBadge, { backgroundColor: theme.primary + "15" }]}>
            <ThemedText style={[styles.categoryText, { color: theme.primary }]}>{getCategoryLabel(item.category)}</ThemedText>
          </View>
          <View style={styles.sourceIndicators}>
            {item.sources.map((s) => (
              <View key={s} style={[styles.sourceChip, { backgroundColor: theme.backgroundSecondary }]}>
                <View style={[styles.sourceChipDot, { backgroundColor: s === "opensky" ? "#4CAF50" : s === "adsbfi" ? "#2196F3" : s === "airplaneslive" ? "#9C27B0" : s === "adsblol" ? "#E91E63" : "#FF9800" }]} />
                <ThemedText style={[styles.sourceChipText, { color: theme.textTertiary }]}>
                  {s === "opensky" ? "OpenSky" : s === "adsbfi" ? "adsb.fi" : s === "airplaneslive" ? "apl" : s === "adsblol" ? "lol" : "adsb.one"}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.detailsGrid}>
          <View style={styles.detailItem}>
            <Feather name="activity" size={12} color={theme.textTertiary} />
            <ThemedText style={[styles.detailLabel, { color: theme.textTertiary }]}>Geschwindigkeit</ThemedText>
            <ThemedText style={styles.detailValue}>{getSpeedDisplay(item)}</ThemedText>
          </View>
          <View style={styles.detailItem}>
            <Feather name="compass" size={12} color={theme.textTertiary} />
            <ThemedText style={[styles.detailLabel, { color: theme.textTertiary }]}>Richtung</ThemedText>
            <ThemedText style={styles.detailValue}>{getHeadingDisplay(item.trueTrack)}</ThemedText>
          </View>
          <View style={styles.detailItem}>
            <Feather name="trending-up" size={12} color={theme.textTertiary} />
            <ThemedText style={[styles.detailLabel, { color: theme.textTertiary }]}>Steig/Sink</ThemedText>
            <ThemedText style={styles.detailValue}>{getVerticalRateDisplay(item.verticalRate)}</ThemedText>
          </View>
          <View style={styles.detailItem}>
            <Feather name="flag" size={12} color={theme.textTertiary} />
            <ThemedText style={[styles.detailLabel, { color: theme.textTertiary }]}>Herkunft</ThemedText>
            <ThemedText style={styles.detailValue} numberOfLines={1}>{item.originCountry || "-"}</ThemedText>
          </View>
        </View>
        {item.onGround ? (
          <View style={[styles.groundBadge, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="minus-circle" size={12} color={theme.textTertiary} />
            <ThemedText style={[styles.groundText, { color: theme.textTertiary }]}>Am Boden</ThemedText>
          </View>
        ) : null}
      </Card>
    );
  };

  const radiusOptions = [10, 25, 50];

  const degPerKm = 1 / 111.32;
  const latDelta = radiusKm * degPerKm * 2.2;
  const lonDelta = (radiusKm * degPerKm / Math.cos((latitude * Math.PI) / 180)) * 2.2;

  const headerContent = (
    <View style={styles.headerSection}>
      <ProximityAlarmBanner
        alerts={activeAlerts}
        alarmActive={alarmActive}
        alarmLevel={alarmLevel}
        clearOfConflict={clearOfConflict}
        maxAltitudeM={alarmSettings.maxAltitudeM}
        onDismiss={dismissAlarm}
      />
      <Card style={styles.locationCard}>
        <View style={styles.locationRow}>
          <Feather name="map-pin" size={16} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.locationTitle}>
              {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
            </ThemedText>
            <ThemedText style={[styles.locationSub, { color: theme.textTertiary }]}>Umkreis: {radiusKm} km</ThemedText>
          </View>
          <Pressable onPress={handleManualRefresh} style={styles.refreshBtn}>
            <Feather name="refresh-cw" size={18} color={theme.primary} />
          </Pressable>
        </View>
      </Card>

      <View style={styles.toggleRow}>
        <Pressable
          onPress={() => {
            if (Platform.OS === "web") return;
            setViewMode("map");
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={[
            styles.toggleBtn,
            {
              backgroundColor: viewMode === "map" ? theme.primary : theme.backgroundSecondary,
              opacity: Platform.OS === "web" ? 0.5 : 1,
            },
          ]}
        >
          <Feather name="map" size={14} color={viewMode === "map" ? "#FFFFFF" : theme.textSecondary} />
          <ThemedText style={[styles.toggleBtnText, { color: viewMode === "map" ? "#FFFFFF" : theme.textSecondary }]}>
            Karte
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => {
            setViewMode("list");
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={[
            styles.toggleBtn,
            { backgroundColor: viewMode === "list" ? theme.primary : theme.backgroundSecondary },
          ]}
        >
          <Feather name="list" size={14} color={viewMode === "list" ? "#FFFFFF" : theme.textSecondary} />
          <ThemedText style={[styles.toggleBtnText, { color: viewMode === "list" ? "#FFFFFF" : theme.textSecondary }]}>
            Liste
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.radiusRow}>
        {radiusOptions.map((r) => (
          <Pressable
            key={r}
            onPress={() => {
              setRadiusKm(r);
              saveRadarSettings({ radiusKm: r });
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={[styles.radiusChip, { backgroundColor: radiusKm === r ? theme.primary : theme.backgroundSecondary }]}
          >
            <ThemedText style={[styles.radiusChipText, { color: radiusKm === r ? "#FFFFFF" : theme.textSecondary }]}>
              {r} km
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.geozoneRow}>
        <Pressable
          onPress={() => { setShowGeozoneModal(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={[styles.geozoneBtn, { backgroundColor: activeGeozoneLayers.length > 0 ? theme.primary : theme.backgroundSecondary }]}
        >
          <Feather name="layers" size={14} color={activeGeozoneLayers.length > 0 ? "#FFFFFF" : theme.textSecondary} />
          <ThemedText style={[styles.geozoneBtnText, { color: activeGeozoneLayers.length > 0 ? "#FFFFFF" : theme.textSecondary }]}>
            Geozonen {activeGeozoneLayers.length > 0 ? `(${activeGeozoneLayers.length})` : ""}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => {
            const idx = MAP_STYLES.findIndex((s) => s.id === mapStyle);
            const next = MAP_STYLES[(idx + 1) % MAP_STYLES.length];
            setMapStyle(next.id);
            saveMapStyle(next.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={[styles.geozoneBtn, { backgroundColor: theme.backgroundSecondary }]}
        >
          <Feather name={MAP_STYLES.find((s) => s.id === mapStyle)?.icon as any || "map"} size={14} color={theme.textSecondary} />
          <ThemedText style={[styles.geozoneBtnText, { color: theme.textSecondary }]}>
            {MAP_STYLES.find((s) => s.id === mapStyle)?.label || "Karte"}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundSecondary }]}>
          <ThemedText style={styles.statValue}>{aircraft.length}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>Flugzeuge</ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: lowAltitudeCount > 0 ? theme.statusCautionBackground : theme.backgroundSecondary }]}>
          <ThemedText style={[styles.statValue, lowAltitudeCount > 0 ? { color: theme.statusCaution } : undefined]}>{lowAltitudeCount}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: lowAltitudeCount > 0 ? theme.statusCaution : theme.textTertiary }]}>Tiefflug (&lt;500m)</ThemedText>
        </View>
        <View style={[styles.statCard, { backgroundColor: theme.backgroundSecondary }]}>
          <ThemedText style={styles.statValue}>{aircraft.filter((a) => !a.onGround).length}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: theme.textTertiary }]}>In der Luft</ThemedText>
        </View>
      </View>

      {lastUpdate ? (
        <ThemedText style={[styles.updateText, { color: theme.textTertiary }]}>
          Letzte Aktualisierung: {lastUpdate.toLocaleTimeString("de-DE")} (alle 3 Sek.)
        </ThemedText>
      ) : null}
      <View style={styles.sourceStatusRow}>
        <View style={styles.sourceStatusItem}>
          <View style={[styles.sourceStatusDot, { backgroundColor: sourceStatus.opensky === "ok" ? "#34C759" : sourceStatus.opensky === "timeout" ? "#FF9500" : "#FF3B30" }]} />
          <ThemedText style={[styles.sourceStatusLabel, { color: theme.textTertiary }]}>OpenSky</ThemedText>
        </View>
        <View style={styles.sourceStatusItem}>
          <View style={[styles.sourceStatusDot, { backgroundColor: sourceStatus.adsbfi === "ok" ? "#34C759" : sourceStatus.adsbfi === "timeout" ? "#FF9500" : "#FF3B30" }]} />
          <ThemedText style={[styles.sourceStatusLabel, { color: theme.textTertiary }]}>adsb.fi</ThemedText>
        </View>
        <View style={styles.sourceStatusItem}>
          <View style={[styles.sourceStatusDot, { backgroundColor: sourceStatus.adsbone === "ok" ? "#34C759" : sourceStatus.adsbone === "timeout" ? "#FF9500" : "#FF3B30" }]} />
          <ThemedText style={[styles.sourceStatusLabel, { color: theme.textTertiary }]}>adsb.one</ThemedText>
        </View>
        <View style={styles.sourceStatusItem}>
          <View style={[styles.sourceStatusDot, { backgroundColor: sourceStatus.airplaneslive === "ok" ? "#34C759" : sourceStatus.airplaneslive === "timeout" ? "#FF9500" : "#FF3B30" }]} />
          <ThemedText style={[styles.sourceStatusLabel, { color: theme.textTertiary }]}>apl</ThemedText>
        </View>
        <View style={styles.sourceStatusItem}>
          <View style={[styles.sourceStatusDot, { backgroundColor: sourceStatus.adsblol === "ok" ? "#34C759" : sourceStatus.adsblol === "timeout" ? "#FF9500" : "#FF3B30" }]} />
          <ThemedText style={[styles.sourceStatusLabel, { color: theme.textTertiary }]}>lol</ThemedText>
        </View>
      </View>
    </View>
  );

  const criticalIcaos = useMemo(() => new Set(activeAlerts.filter((a) => a.level === "critical").map((a) => a.aircraft.icao24)), [activeAlerts]);
  const warningIcaos = useMemo(() => new Set(activeAlerts.filter((a) => a.level === "warning").map((a) => a.aircraft.icao24)), [activeAlerts]);
  const approachIcaos = useMemo(() => new Set(approachingAircraft.map((a) => a.aircraft.icao24)), [approachingAircraft]);

  const MAX_MAP_MARKERS = 50;

  const mapMarkers: TrafficMarker[] = useMemo(() => {
    const alertFirst = sortedAircraft.slice().sort((a, b) => {
      const aPri = criticalIcaos.has(a.icao24) ? 0 : warningIcaos.has(a.icao24) || approachIcaos.has(a.icao24) ? 1 : 2;
      const bPri = criticalIcaos.has(b.icao24) ? 0 : warningIcaos.has(b.icao24) || approachIcaos.has(b.icao24) ? 1 : 2;
      return aPri - bPri;
    });
    return alertFirst.slice(0, MAX_MAP_MARKERS).map((ac) => ({
      id: ac.icao24,
      latitude: ac.latitude,
      longitude: ac.longitude,
      pinColor: getMarkerPinColor(ac.aglAltitude ?? getRelativeAltitude(ac, pilotElevation)),
      title: ac.callsign || ac.icao24,
      description: formatAltitudeDual(getAltitudeDualDisplay(ac)),
      heading: ac.trueTrack ?? 0,
      altitude: getAltitudeDisplay(ac),
      altitudeDual: formatAltitudeDual(getAltitudeDualDisplay(ac)),
      speed: getSpeedDisplay(ac),
      category: ac.category,
      sources: ac.sources,
      isAlert: criticalIcaos.has(ac.icao24),
      isApproaching: warningIcaos.has(ac.icao24) || approachIcaos.has(ac.icao24),
      isStale: ac.isStale,
    }));
  }, [sortedAircraft, criticalIcaos, warningIcaos, approachIcaos, pilotElevation]);

  const renderMapView = () => (
    <TrafficMapView
      latitude={latitude}
      longitude={longitude}
      latDelta={latDelta}
      lonDelta={lonDelta}
      locationName={locationName}
      markers={mapMarkers}
      trails={trails}
      alarmRadiusM={alarmSettings.enabled ? (alarmSettings.ra?.radiusKm ?? 1) * 1000 : undefined}
      taRadiusM={alarmSettings.enabled ? (alarmSettings.ta?.radiusKm ?? 3) * 1000 : undefined}
      wind={wind}
      geozoneLayers={activeGeozoneLayers}
      countryIso={countryIso}
      mapStyle={mapStyle}
      onMapStyleChange={(s) => { setMapStyle(s); saveMapStyle(s); }}
    />
  );

  const emptyListContent = loading ? (
    <View style={styles.emptyState}>
      <ActivityIndicator size="large" color={theme.primary} />
      <ThemedText style={[styles.emptyTitle, { marginTop: Spacing.lg }]}>Lade Flugdaten...</ThemedText>
    </View>
  ) : error ? (
    <View style={styles.emptyState}>
      <Feather name="wifi-off" size={48} color={theme.statusNoGo} />
      <ThemedText style={[styles.emptyTitle, { marginTop: Spacing.lg }]}>Fehler</ThemedText>
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>{error}</ThemedText>
      <Pressable onPress={handleManualRefresh} style={[styles.retryBtn, { backgroundColor: theme.primary + "15" }]}>
        <ThemedText style={[styles.retryText, { color: theme.primary }]}>Erneut versuchen</ThemedText>
      </Pressable>
    </View>
  ) : (
    <View style={styles.emptyState}>
      <Feather name="check-circle" size={48} color={theme.statusGo} />
      <ThemedText style={[styles.emptyTitle, { marginTop: Spacing.lg }]}>Keine Flugzeuge</ThemedText>
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
        Im Umkreis von {radiusKm} km sind aktuell keine Flugzeuge erkennbar
      </ThemedText>
    </View>
  );

  const countryLayers = useMemo(() => getCountryGeozoneLayers(countryIso), [countryIso]);

  const toggleGeozoneLayer = (layerId: string) => {
    const config = getCountryGeozoneConfig(countryIso);
    if (config.forceEnabledLayerIds.includes(layerId) && geozoneSettings[layerId]) return;
    const updated = { ...geozoneSettings, [layerId]: !geozoneSettings[layerId] };
    setGeozoneSettings(updated);
    saveGeozoneSettings(updated, countryIso);
  };

  const [layerInfoId, setLayerInfoId] = useState<string | null>(null);
  const layerInfoData = layerInfoId ? GEOZONE_REGULATORY_INFO[layerInfoId] : null;

  const geozoneModal = (
    <Modal visible={showGeozoneModal} transparent={false} animationType="slide" onRequestClose={() => { setShowGeozoneModal(false); setLayerInfoId(null); }}>
      <View style={[styles.geozoneModalFull, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.geozoneModalHeader}>
          <ThemedText style={styles.geozoneModalTitle}>Geozonen-Layer</ThemedText>
          <Pressable onPress={() => { setShowGeozoneModal(false); setLayerInfoId(null); }} hitSlop={12}>
            <Feather name="x" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
        <ThemedText style={[styles.geozoneModalSubtitle, { color: theme.textTertiary }]}>
          Luftfahrt-Geozonen einblenden
        </ThemedText>
        <ScrollView style={styles.geozoneModalList}>
          {countryLayers.map((layer) => (
            <View key={layer.id} style={[styles.geozoneLayerRow, { borderBottomColor: theme.border }]}>
              <Pressable onPress={() => toggleGeozoneLayer(layer.id)} style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md, flex: 1 }}>
                <View style={[styles.geozoneCheck, { backgroundColor: geozoneSettings[layer.id] ? theme.primary : theme.backgroundSecondary, borderColor: geozoneSettings[layer.id] ? theme.primary : theme.textTertiary }]}>
                  {geozoneSettings[layer.id] ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                </View>
                <ThemedText style={styles.geozoneLayerLabel}>{layer.label}</ThemedText>
              </Pressable>
              {GEOZONE_REGULATORY_INFO[layer.id] ? (
                <Pressable
                  onPress={() => { setLayerInfoId(layer.id); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
                  hitSlop={10}
                  style={[styles.geozoneLayerInfoBtn, { borderColor: theme.primary }]}
                >
                  <Feather name="info" size={12} color={theme.primary} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
      <Modal visible={layerInfoData != null} transparent animationType="fade" onRequestClose={() => setLayerInfoId(null)}>
        <Pressable style={styles.layerInfoOverlay} onPress={() => setLayerInfoId(null)}>
          <Pressable style={[styles.layerInfoModal, { backgroundColor: isDark ? "rgba(12, 18, 42, 0.98)" : "rgba(255,255,255,0.99)" }]} onPress={(e) => e.stopPropagation()}>
            {layerInfoData ? (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: Dimensions.get("window").height * 0.75 }}>
                <Text style={[styles.layerInfoTitle, { color: isDark ? "#FFFFFF" : "#1A1A2E" }]}>{layerInfoData.title}</Text>
                <Text style={[styles.layerInfoSectionLabel, { color: theme.primary }]}>Referenz</Text>
                <Text style={[styles.layerInfoText, { color: isDark ? "#C8D6E8" : "#333" }]}>{layerInfoData.referenz}</Text>
                <Text style={[styles.layerInfoSectionLabel, { color: theme.primary }]}>Definition</Text>
                <Text style={[styles.layerInfoText, { color: isDark ? "#C8D6E8" : "#333" }]}>{layerInfoData.definition}</Text>
                <Text style={[styles.layerInfoSectionLabel, { color: theme.primary }]}>Abstandsregel</Text>
                <Text style={[styles.layerInfoText, { color: isDark ? "#C8D6E8" : "#333" }]}>{layerInfoData.abstandsregel}</Text>
                <Text style={[styles.layerInfoSectionLabel, { color: theme.primary }]}>Betriebsvoraussetzung</Text>
                <Text style={[styles.layerInfoText, { color: isDark ? "#C8D6E8" : "#333" }]}>{layerInfoData.betriebsvoraussetzung}</Text>
                {layerInfoData.hinweis ? (
                  <View style={[styles.layerInfoHinweisBox, { backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.4)" }]}>
                    <Text style={[styles.layerInfoText, { color: isDark ? "#F5D080" : "#92400E" }]}>{layerInfoData.hinweis}</Text>
                  </View>
                ) : null}
                {layerInfoData.links && layerInfoData.links.length > 0 ? (
                  <View style={{ marginTop: 14 }}>
                    {layerInfoData.links.map((link, li) => (
                      <Pressable key={li} onPress={() => { WebBrowser.openBrowserAsync(link.url).catch(() => {}); }} style={styles.layerInfoLink}>
                        <Feather name="external-link" size={12} color={theme.primary} />
                        <Text style={[styles.layerInfoLinkText, { color: theme.primary }]}>{link.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {(() => {
                  const modalContacts = layerInfoId ? getContactsForZone(layerInfoId) : (layerInfoData.contacts || []);
                  return modalContacts.length > 0 ? (
                  <View style={{ marginTop: 16 }}>
                    <Text style={[styles.layerInfoSectionLabel, { color: theme.primary }]}>Kontakte</Text>
                    {modalContacts.map((c, ci) => (
                      <Pressable
                        key={ci}
                        onPress={() => openGeozoneContact(c)}
                        style={styles.layerInfoContactRow}
                      >
                        <Feather name={c.type === "email" ? "mail" : c.type === "phone" ? "phone" : "globe"} size={13} color={c.type === "email" ? "#4A90D9" : c.type === "phone" ? "#34C759" : theme.primary} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.layerInfoContactLabel, { color: isDark ? "#C8D6E8" : "#333" }]}>{c.label}</Text>
                          <Text style={[styles.layerInfoContactValue, { color: c.type === "email" ? "#4A90D9" : c.type === "phone" ? "#34C759" : theme.primary }]}>{c.type === "phone" ? c.value.replace(/^\+49/, "+49 ") : c.value}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null;
                })()}
              </ScrollView>
            ) : null}
            <Pressable onPress={() => setLayerInfoId(null)} style={[styles.layerInfoOkBtn, { backgroundColor: theme.primary }]}>
              <Text style={styles.layerInfoOkText}>OK</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );

  if (viewMode === "map") {
    return (
      <ThemedView style={styles.container}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
            paddingHorizontal: Spacing.lg,
          }}
        >
          {headerContent}
          {renderMapView()}
        </ScrollView>
        {geozoneModal}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={sortedAircraft}
        renderItem={renderAircraft}
        keyExtractor={(item) => item.icao24}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.lg,
        }}
        ListHeaderComponent={headerContent}
        ListEmptyComponent={emptyListContent}
      />
      {geozoneModal}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerSection: { marginBottom: Spacing.lg },
  locationCard: { padding: Spacing.lg, marginBottom: Spacing.md },
  locationRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  locationTitle: { ...Typography.callout, fontWeight: "600" },
  locationSub: { ...Typography.caption, marginTop: 2 },
  refreshBtn: { padding: Spacing.sm },
  toggleRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  toggleBtnText: { ...Typography.small, fontWeight: "600" },
  radiusRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  radiusChip: { flex: 1, alignItems: "center", paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  radiusChipText: { ...Typography.small, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  statCard: { flex: 1, alignItems: "center", paddingVertical: Spacing.md, borderRadius: BorderRadius.md },
  statValue: { ...Typography.h3, fontWeight: "700" },
  statLabel: { ...Typography.caption, fontSize: 10, marginTop: 2 },
  updateText: { ...Typography.caption, textAlign: "center", marginBottom: Spacing.sm },
  mapView: { height: 350, borderRadius: BorderRadius.md, overflow: "hidden" },
  webFallback: { height: 350, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center", gap: Spacing.sm },
  webFallbackText: { ...Typography.body, textAlign: "center", paddingHorizontal: Spacing.xl },
  aircraftCard: { padding: Spacing.lg, marginBottom: Spacing.md },
  aircraftHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.md },
  callsignRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, flex: 1 },
  callsign: { ...Typography.callout, fontWeight: "700" },
  icao24: { ...Typography.caption, fontSize: 10 },
  altBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  altBadgeText: { ...Typography.caption, fontWeight: "700", fontSize: 11 },
  altBadgeSub: { fontSize: 8, opacity: 0.7, marginTop: 1 },
  detailsGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  detailItem: { width: "46%", gap: 2 },
  detailLabel: { ...Typography.caption, fontSize: 10 },
  detailValue: { ...Typography.small, fontWeight: "600" },
  groundBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.xs, marginTop: Spacing.sm },
  groundText: { ...Typography.caption, fontSize: 10 },
  categorySourceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.sm },
  categoryBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  categoryText: { ...Typography.caption, fontSize: 10, fontWeight: "600" },
  sourceIndicators: { flexDirection: "row", gap: 4 },
  sourceChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: BorderRadius.xs },
  sourceChipDot: { width: 5, height: 5, borderRadius: 2.5 },
  sourceChipText: { fontSize: 8, fontWeight: "500" },
  sourceStatusRow: { flexDirection: "row", justifyContent: "center", gap: Spacing.lg, marginBottom: Spacing.sm },
  sourceStatusItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  sourceStatusDot: { width: 6, height: 6, borderRadius: 3 },
  sourceStatusLabel: { ...Typography.caption, fontSize: 9 },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: Spacing["5xl"] },
  emptyTitle: { ...Typography.h3 },
  emptyText: { ...Typography.body, textAlign: "center", marginTop: Spacing.sm, paddingHorizontal: Spacing.xl },
  retryBtn: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.lg },
  retryText: { ...Typography.body, fontWeight: "600" },
  geozoneRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  geozoneBtn: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.md },
  geozoneBtnText: { ...Typography.caption, fontWeight: "600", fontSize: 12 },
  geozoneModalFull: { flex: 1, paddingTop: 60, paddingHorizontal: Spacing.lg },
  geozoneModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg, marginBottom: Spacing.xs },
  geozoneModalTitle: { ...Typography.h3, fontWeight: "700" },
  geozoneModalSubtitle: { ...Typography.caption, paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  geozoneModalList: { paddingHorizontal: Spacing.lg },
  geozoneLayerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  geozoneCheck: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  geozoneLayerLabel: { ...Typography.body, flex: 1 },
  geozoneLayerInfoBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  layerInfoOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: 24 },
  layerInfoModal: {
    width: "100%", maxWidth: 380, borderRadius: 16, padding: 22,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 20 },
      android: { elevation: 24 },
    }),
  },
  layerInfoTitle: { fontSize: 19, fontWeight: "800", marginBottom: 16 },
  layerInfoSectionLabel: { fontSize: 13, fontWeight: "700", marginTop: 12, marginBottom: 4 },
  layerInfoText: { fontSize: 13, lineHeight: 20 },
  layerInfoHinweisBox: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1 },
  layerInfoLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  layerInfoLinkText: { fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  layerInfoContactRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8, marginBottom: 2 },
  layerInfoContactLabel: { fontSize: 12, fontWeight: "500", lineHeight: 16 },
  layerInfoContactValue: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  layerInfoOkBtn: { alignSelf: "flex-end", borderRadius: 8, paddingHorizontal: 24, paddingVertical: 8, marginTop: 16 },
  layerInfoOkText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
