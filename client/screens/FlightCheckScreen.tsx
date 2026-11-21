import { openLink } from "@/lib/webBrowser";
import React, { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, Dimensions, Linking, AppState } from "react-native";
import { useNavigation, useRoute, useIsFocused } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import * as Location from "@/lib/location";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import TrafficMapView, { TrafficMarker, AircraftTrail, WindData } from "@/components/TrafficMapView";
import ProximityAlarmBanner, { ProximityAlarmGlow, AlarmPulseProvider, bearingTo } from "@/components/ProximityAlarmBanner";
import SourceHealthIndicator from "@/components/SourceHealthIndicator";
import { useTheme } from "@/hooks/useTheme";
import { useProximityAlarm } from "@/hooks/useProximityAlarm";
import { useAircraftTrails } from "@/hooks/useAircraftTrails";
import { Spacing, Typography, Colors, BorderRadius } from "@/constants/theme";
import { updateFlightSession, getFlightSession, getSettings, DEFAULT_PROXIMITY_ALARM } from "@/lib/storage";
import { findNearbyCtrAirports, CtrAirport, getCtrCategoryLabel, getCtrProviderName } from "@/lib/ctrData";
import { fetchNearbyAircraft, AircraftState, getAltitudeDisplay, getAltitudeDualDisplay, formatAltitudeDual, getSpeedDisplay, DataSource, getRelativeAltitude } from "@/lib/opensky";
import { fetchDipulWind } from "@/lib/weather";
import { fetchElevation } from "@/lib/elevation";
import { getMarkerPinColor } from "@/lib/markerColors";
import { loadGeozoneSettings, getActiveLayerNames, loadMapStyle, saveMapStyle, type MapStyleOption, queryGeozonesInArea, fetchNearbyTempRestrictions, loadRadarSettings } from "@/lib/geozones";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import { InfoDialog } from "@/components/InfoDialog";
import { ChecklistRow } from "@/components/ChecklistRow";
import { useChecklistState, checklistHaptic } from "@/hooks/useChecklistState";

interface CheckItem {
  id: string;
  label: string;
  required: boolean;
  tip: string;
}

interface CheckSection {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: CheckItem[];
}

const FLIGHT_CHECK_SECTIONS: CheckSection[] = [
  {
    title: "Nach dem Start (5m Hover)",
    icon: "navigation",
    items: [
      {
        id: "hover_stable",
        label: "Drohne schwebt stabil",
        required: true,
        tip: "Die Drohne sollte ruhig auf Position bleiben ohne zu driften. Leichtes Pendeln ist bei Wind normal.",
      },
      {
        id: "controls_responsive",
        label: "Steuerung reagiert korrekt",
        required: true,
        tip: "Teste alle Achsen kurz an: Pitch, Roll, Yaw, Throttle. Die Drohne sollte prompt und präzise reagieren.",
      },
      {
        id: "gps_stable",
        label: "GPS-Position stabil",
        required: true,
        tip: "Die Satellitenanzahl sollte nicht stark schwanken. Bei instabilem GPS: Abbruch erwägen.",
      },
      {
        id: "camera_working",
        label: "Kamera/Gimbal funktioniert",
        required: false,
        tip: "Prüfe das Livebild. Gimbal sollte sich bewegen lassen und den Horizont halten.",
      },
      {
        id: "battery_ok",
        label: "Akkustand plausibel",
        required: true,
        tip: "Der Akku sollte nur minimal gefallen sein. Starker Abfall deutet auf kalte Akkus oder defekte Zellen hin.",
      },
    ],
  },
  {
    title: "Flugbereitschaft",
    icon: "check-circle",
    items: [
      {
        id: "rth_confirmed",
        label: "RTH-Punkt korrekt gesetzt",
        required: true,
        tip: "Prüfe, ob der Return-to-Home Punkt auf deine aktuelle Position gesetzt ist.",
      },
      {
        id: "airspace_clear",
        label: "Luftraum frei",
        required: true,
        tip: "Schaue dich um. Sind andere Luftfahrzeuge in Sicht? Hörst du Hubschrauber oder Flugzeuge?",
      },
      {
        id: "ready_for_mission",
        label: "Bereit für den Flug",
        required: true,
        tip: "Wenn alle Checks bestanden sind und der Flug abgeschlossen ist, kannst du ihn beenden.",
      },
    ],
  },
];

interface FlightCheckParams {
  sessionId: string;
}

type NavigationProp = NativeStackNavigationProp<FlightCheckParamList>;

const FLIGHT_CHECK_REQUIRED_ITEMS = FLIGHT_CHECK_SECTIONS.flatMap(s => s.items.filter(i => i.required));

export default function FlightCheckScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<{ params: FlightCheckParams }, "params">>();
  const { theme, isDark } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // Lokal + optimistisch: der Haken erscheint im selben Frame (kein Speicherzugriff).
  const { checked, toggle: toggleItem } = useChecklistState(undefined, { onCheck: checklistHaptic });
  const [saving, setSaving] = useState(false);
  const [tipModal, setTipModal] = useState<{ visible: boolean; title: string; tip: string }>({
    visible: false,
    title: "",
    tip: "",
  });

  const { sessionId } = route.params || {};

  const allRequiredChecked = FLIGHT_CHECK_REQUIRED_ITEMS.every(item => checked.has(item.id));

  const [sessionLat, setSessionLat] = useState<number | null>(null);
  const [sessionLon, setSessionLon] = useState<number | null>(null);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLon, setGpsLon] = useState<number | null>(null);
  const [useGps, setUseGps] = useState(false);
  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [wind, setWind] = useState<WindData | null>(null);
  const [geozoneLayers, setGeozoneLayers] = useState<string[]>([]);
  const [sessionCountryIso, setSessionCountryIso] = useState<string | undefined>(undefined);
  const [mapStyle, setMapStyle] = useState<MapStyleOption>("grayscale");
  const [sourceStatus, setSourceStatus] = useState<Record<DataSource, "ok" | "error" | "timeout">>({
    opensky: "ok", adsbfi: "ok", adsbone: "ok", airplaneslive: "ok", adsblol: "ok", ogn: "ok", fr24: "ok",
  });
  const [trailsState, setTrailsState] = useState<AircraftTrail[]>([]);
  const [planningMaxAlt, setPlanningMaxAlt] = useState<number | undefined>(undefined);
  const [planningRadiusKm, setPlanningRadiusKm] = useState<number | undefined>(undefined);
  const [nearbyCtr, setNearbyCtr] = useState<CtrAirport[]>([]);
  const [showCtrContacts, setShowCtrContacts] = useState(false);
  const fetchInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const windInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const radarLat = useGps && gpsLat != null ? gpsLat : sessionLat;
  const radarLon = useGps && gpsLon != null ? gpsLon : sessionLon;
  const [deviceHeadingFC, setDeviceHeadingFC] = useState<number | null>(null);
  const handleHeadingChangeFC = useCallback((h: number | null) => { setDeviceHeadingFC(h); }, []);

  const [pilotElevation, setPilotElevation] = useState<number | null>(null);

  useEffect(() => {
    if (radarLat == null || radarLon == null) {
      setPilotElevation(null);
      return;
    }
    setPilotElevation(null);
    fetchElevation(radarLat, radarLon).then((elev) => setPilotElevation(elev));
  }, [radarLat, radarLon]);

  // RA-Alarmradius an den Planungs-Umkreis koppeln (Drohne fliegt nur dort).
  // Vorwarn-Aura: +0.3 km, damit "Descend, Descend" greift bevor der Verkehr
  // tatsächlich in den Flugbereich einfliegt.
  const PLANNING_RA_AURA_KM = 0.3;
  const raOverrideKm = planningRadiusKm != null && planningRadiusKm > 0
    ? planningRadiusKm + PLANNING_RA_AURA_KM
    : undefined;

  const { activeAlerts, approachingAircraft, alarmActive, alarmLevel, clearOfConflict, dismissAlarm, alarmSettings } =
    useProximityAlarm(aircraft, radarLat, radarLon, planningMaxAlt, pilotElevation, raOverrideKm);
  const { updateTrails } = useAircraftTrails();

  useEffect(() => {
    if (!sessionId) return;
    getFlightSession(sessionId).then((session) => {
      if (session) {
        setSessionLat(session.latitude);
        setSessionLon(session.longitude);
        if (session.countryIso) setSessionCountryIso(session.countryIso);
        if (session.planning?.maxAltitude != null && session.planning.maxAltitude > 0) {
          setPlanningMaxAlt(session.planning.maxAltitude);
        } else {
          setPlanningMaxAlt(undefined);
        }
        if (session.planning?.radiusKm != null && session.planning.radiusKm > 0) {
          setPlanningRadiusKm(session.planning.radiusKm);
        } else {
          setPlanningRadiusKm(undefined);
        }
      }
    });
  }, [sessionId]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGpsLat(loc.coords.latitude);
        setGpsLon(loc.coords.longitude);
        if (sessionLat == null) {
          setSessionLat(loc.coords.latitude);
          setSessionLon(loc.coords.longitude);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (sessionCountryIso === "DE" && radarLat != null && radarLon != null) {
      setNearbyCtr(findNearbyCtrAirports(radarLat, radarLon, 15));
    }
  }, [sessionCountryIso, radarLat, radarLon]);

  useEffect(() => {
    loadGeozoneSettings(sessionCountryIso).then((s) => {
      const names = getActiveLayerNames(s, sessionCountryIso);
      setGeozoneLayers(names);
      if (sessionId && names.length > 0) {
        updateFlightSession(sessionId, { detectedGeozones: names });
      }
    });
    loadMapStyle().then((saved) => {
      setMapStyle(saved);
    });
  }, [sessionId, sessionCountryIso]);

  useEffect(() => {
    if (!sessionId || radarLat == null || radarLon == null) return;
    const fetchSessionGeozoneData = async () => {
      try {
        const radarSettings = await loadRadarSettings();
        const rKm = radarSettings.radiusKm;
        const [zones, dipulResult] = await Promise.all([
          queryGeozonesInArea(radarLat, radarLon, rKm, sessionCountryIso).catch(() => []),
          fetchNearbyTempRestrictions(radarLat, radarLon, rKm).catch(() => ({ active: [], upcoming: [] })),
        ]);
        const savedFeatures = zones.map((z: any) => ({ layerLabel: z.layerLabel, name: z.name, details: z.details }));
        const allDipul = [...dipulResult.active, ...dipulResult.upcoming];
        const savedRestrictions = allDipul.map((dr: any) => ({
          id: dr.id, name: dr.name, names: dr.names || [],
          category: dr.category, legalRef: dr.legalRef, legalExplanation: dr.legalExplanation,
          lowerAlt: dr.lowerAlt, lowerAltRef: dr.lowerAltRef,
          upperAlt: dr.upperAlt, upperAltRef: dr.upperAltRef,
          status: dr.status, startTs: dr.startTs, endTs: dr.endTs, endTsIndefinite: dr.endTsIndefinite,
        }));
        updateFlightSession(sessionId, {
          savedGeozoneFeatures: savedFeatures.length > 0 ? savedFeatures : undefined,
          savedDipulRestrictions: savedRestrictions.length > 0 ? savedRestrictions : undefined,
        });
      } catch {}
    };
    fetchSessionGeozoneData();
  }, [sessionId, radarLat, radarLon]);

  const isFocused = useIsFocused();
  useEffect(() => {
    // Nur solange der Screen fokussiert und die App im Vordergrund ist pollen.
    if (!isFocused || !allRequiredChecked || radarLat == null || radarLon == null) return;

    let cancelled = false;
    let inFlight = false;
    const doFetch = async () => {
      // In-flight-Guard: langsame Antworten (RC-Netz) nicht stapeln.
      if (inFlight || cancelled) return;
      if (AppState.currentState != null && AppState.currentState !== "active") return;
      inFlight = true;
      try {
        const radarSettings = await loadRadarSettings();
        const radiusKm = radarSettings.radiusKm;
        const result = await fetchNearbyAircraft(radarLat, radarLon, radiusKm);
        if (cancelled) return;
        const { trails } = updateTrails(result.states, result.trails, radarLat, radarLon, radiusKm);
        // Stale-but-recently-seen Aircraft sind bereits im Server-Response
        // enthalten (maxAgeSec) und mit isStale=true markiert.
        setAircraft(result.states);
        setSourceStatus(result.sourceStatus);
        setTrailsState(trails);
      } catch {} finally {
        inFlight = false;
      }
    };

    doFetch();
    fetchInterval.current = setInterval(doFetch, 2000);
    return () => {
      cancelled = true;
      if (fetchInterval.current) clearInterval(fetchInterval.current);
      fetchInterval.current = null;
    };
  }, [allRequiredChecked, radarLat, radarLon, isFocused]);

  useEffect(() => {
    if (!allRequiredChecked || radarLat == null || radarLon == null) return;

    const loadWind = async () => {
      try {
        const w = await fetchDipulWind(radarLat, radarLon);
        if (w) setWind({ direction: w.direction, speed: w.speed, directionLabel: w.directionLabel });
      } catch {}
    };
    loadWind();
    windInterval.current = setInterval(loadWind, 120000);
    return () => {
      if (windInterval.current) clearInterval(windInterval.current);
    };
  }, [allRequiredChecked, radarLat, radarLon]);

  const criticalIcaos = useMemo(() => new Set(activeAlerts.filter((a) => a.level === "critical").map((a) => a.aircraft.icao24)), [activeAlerts]);
  const warningIcaos = useMemo(() => new Set(activeAlerts.filter((a) => a.level === "warning").map((a) => a.aircraft.icao24)), [activeAlerts]);
  const approachIcaos = useMemo(() => new Set(approachingAircraft.map((a) => a.aircraft.icao24)), [approachingAircraft]);

  const MAX_MAP_MARKERS = 50;
  const mapMarkers: TrafficMarker[] = useMemo(() => {
    const sorted = [...aircraft].sort((a, b) => {
      const aPri = criticalIcaos.has(a.icao24) ? 0 : warningIcaos.has(a.icao24) || approachIcaos.has(a.icao24) ? 1 : 2;
      const bPri = criticalIcaos.has(b.icao24) ? 0 : warningIcaos.has(b.icao24) || approachIcaos.has(b.icao24) ? 1 : 2;
      return aPri - bPri;
    });
    return sorted.slice(0, MAX_MAP_MARKERS).map((ac) => ({
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
  }, [aircraft, criticalIcaos, warningIcaos, approachIcaos, pilotElevation]);

  const coloredTrails: AircraftTrail[] = useMemo(() => {
    return trailsState.map((trail) => {
      if (criticalIcaos.has(trail.id)) return { ...trail, color: "#FF3B30", isAlert: true };
      if (warningIcaos.has(trail.id) || approachIcaos.has(trail.id)) return { ...trail, color: "#FF9500", isAlert: true };
      return trail;
    });
  }, [trailsState, criticalIcaos, warningIcaos, approachIcaos]);

  const taRadiusM = (alarmSettings?.ta?.radiusKm ?? 3) * 1000;
  const raRadiusM = (alarmSettings?.ra?.radiusKm ?? 1) * 1000;

  const showTip = useCallback((title: string, tip: string) => {
    checklistHaptic();
    setTipModal({ visible: true, title, tip });
  }, []);

  const recenterToGps = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGpsLat(loc.coords.latitude);
      setGpsLon(loc.coords.longitude);
      setUseGps(true);
    } catch {}
  }, []);

  const handleComplete = async () => {
    if (!sessionId) {
      Alert.alert("Fehler", "Keine Session gefunden.");
      return;
    }

    setSaving(true);
    try {
      await updateFlightSession(sessionId, {
        currentPhase: "postlanding",
        hoverCheck: {
          checklistCompleted: Array.from(checked),
          controlsOk: checked.has("controls_responsive"),
          signalOk: checked.has("gps_stable"),
          hoverStable: checked.has("hover_stable"),
          takeoffTime: new Date().toISOString(),
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.getParent()?.goBack();
    } catch (error) {
      Alert.alert("Fehler", "Flight-Check konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      "Flight-Check abbrechen",
      "Möchtest du den Flight-Check wirklich abbrechen?",
      [
        { text: "Nein", style: "cancel" },
        { 
          text: "Ja, abbrechen", 
          style: "destructive", 
          onPress: () => {
            navigation.getParent()?.goBack();
          } 
        },
      ]
    );
  };

  const screenWidth = Dimensions.get("window").width;
  const mapHeight = Math.min(screenWidth * 0.85, 400);

  const liveRadarMode = allRequiredChecked && radarLat != null && radarLon != null;
  // Im Flug: Kopfzeile ausblenden, damit die Karte den Platz bekommt (Querformat).
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !liveRadarMode } as any);
  }, [navigation, liveRadarMode]);
  const radarTop = liveRadarMode ? insets.top : headerHeight;

  if (allRequiredChecked && radarLat != null && radarLon != null) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.fullRadar, { paddingTop: radarTop }]}>
          <TrafficMapView
            latitude={radarLat}
            longitude={radarLon}
            latDelta={0.08}
            lonDelta={0.08}
            markers={mapMarkers}
            trails={coloredTrails}
            alarmRadiusM={raRadiusM}
            taRadiusM={taRadiusM}
            scanRadiusM={planningRadiusKm != null ? planningRadiusKm * 1000 : 0}
            wind={wind}
            sourceStatus={sourceStatus}
            geozoneLayers={geozoneLayers}
            countryIso={sessionCountryIso}
            mapStyle={mapStyle}
            onMapStyleChange={(s) => { setMapStyle(s); saveMapStyle(s); }}
            onHeadingChange={handleHeadingChangeFC}
            fullScreen
            lockPan
          />
          <AlarmPulseProvider alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict}>
            <ProximityAlarmGlow
              alarmActive={alarmActive}
              alarmLevel={alarmLevel}
              clearOfConflict={clearOfConflict}
              bearingToThreat={activeAlerts.length > 0 && radarLat != null && radarLon != null ? ((bearingTo(radarLat, radarLon, activeAlerts[0].aircraft.latitude, activeAlerts[0].aircraft.longitude) - (deviceHeadingFC ?? 0) + 360) % 360) : undefined}
            />
            <ProximityAlarmBanner
              alerts={activeAlerts}
              alarmActive={alarmActive}
              alarmLevel={alarmLevel}
              clearOfConflict={clearOfConflict}
              maxAltitudeM={alarmSettings?.maxAltitudeM}
              onDismiss={dismissAlarm}
            />
          </AlarmPulseProvider>
          <View pointerEvents="box-none" style={[styles.fullRadarTopBar, { top: radarTop + Spacing.xs }]}>
            <View style={[styles.fullRadarBadge, { backgroundColor: theme.backgroundDefault + "EE" }]}>
              <View style={[styles.radarIconBg, { backgroundColor: theme.primary + "20" }]}>
                <Feather name="radio" size={16} color={theme.primary} />
              </View>
              <ThemedText style={[styles.radarSectionSub, { color: theme.text, flexShrink: 1, marginTop: 0 }]} numberOfLines={1}>
                <ThemedText style={[styles.radarSectionSub, { color: theme.primary, fontWeight: "700" }]}>Im Flug · Live-Radar</ThemedText>
                {`  ${aircraft.length} Flugobjekte${planningMaxAlt != null ? ` · Max ${planningMaxAlt} m` : ""}${planningRadiusKm != null ? ` · Radius ${planningRadiusKm < 1 ? `${Math.round(planningRadiusKm * 1000)} m` : `${planningRadiusKm} km`}` : ""}`}
              </ThemedText>
              <Pressable
                onPress={recenterToGps}
                style={[styles.recenterBtn, { backgroundColor: theme.backgroundSecondary }]}
                hitSlop={8}
                testID="button-recenter-gps"
              >
                <Feather name="crosshair" size={18} color={theme.primary} />
              </Pressable>
            </View>
            <View style={{ alignSelf: "center", marginTop: Spacing.xs }}>
              <SourceHealthIndicator isDark={isDark} testID="flight-check-source-health" />
            </View>
          </View>
        </View>

        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
          <Button
            title="Abbrechen"
            onPress={handleCancel}
            variant="secondary"
            style={{ flex: 1 }}
          />
          <Button
            title="Flug beenden"
            onPress={handleComplete}
            disabled={!allRequiredChecked}
            loading={saving}
            style={{ flex: 1 }}
          />
        </View>

        <InfoDialog
          visible={tipModal.visible}
          onClose={() => setTipModal({ ...tipModal, visible: false })}
          title={tipModal.title}
          text={tipModal.tip}
          okLabel="Verstanden"
          testID="tip-info-dialog"
        />
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
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={styles.title}>Flight-Check</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Prüfung nach dem Start (5m Hover)
          </ThemedText>
        </View>

        {nearbyCtr.length > 0 ? (
          <Card style={[styles.ctrEmergencyCard, { borderColor: "#FF3B30" }]}>
            <Pressable
              onPress={() => { setShowCtrContacts(!showCtrContacts); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={styles.ctrEmergencyHeader}
            >
              <Feather name="navigation" size={18} color="#FF3B30" />
              <View style={styles.ctrEmergencyTitleBlock}>
                <ThemedText style={styles.ctrEmergencyTitle}>
                  Kontrollzone — Tower-Kontakt
                </ThemedText>
                <ThemedText style={[styles.ctrEmergencySubtitle, { color: theme.textSecondary }]}>
                  {nearbyCtr.length > 1 ? `${nearbyCtr.length} Flughäfen` : nearbyCtr[0].name} ({nearbyCtr[0].icao})
                </ThemedText>
              </View>
              <Feather name={showCtrContacts ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />
            </Pressable>
            {showCtrContacts ? (
              <View style={styles.ctrContactsList}>
                {nearbyCtr.map((ctr) => (
                  <View key={ctr.icao} style={[styles.ctrContactItem, { borderTopColor: theme.border }]}>
                    <View style={styles.ctrContactInfo}>
                      <ThemedText style={styles.ctrContactName}>{ctr.name}</ThemedText>
                      <ThemedText style={[styles.ctrContactMeta, { color: theme.textTertiary }]}>
                        {ctr.icao} – {getCtrCategoryLabel(ctr.category)}
                      </ThemedText>
                      {ctr.avInfo ? (
                        <ThemedText style={[styles.ctrContactMeta, { color: theme.textTertiary, fontSize: 10 }]}>
                          {ctr.avInfo.provider} – {ctr.avInfo.nflReference}
                        </ThemedText>
                      ) : null}
                      {ctr.towerFrequency ? (
                        <ThemedText style={[styles.ctrContactMeta, { color: "#007AFF", fontSize: 10 }]}>
                          TWR: {ctr.towerFrequency} MHz
                        </ThemedText>
                      ) : null}
                      {ctr.note ? (
                        <ThemedText style={[styles.ctrContactNote, { color: theme.textSecondary }]}>{ctr.note}</ThemedText>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => { openLink(`tel:${ctr.towerPhone.replace(/\s/g, "")}`).catch(() => {}); }}
                      style={styles.ctrCallBtn}
                      testID={`flight-ctr-call-${ctr.icao}`}
                    >
                      <Feather name="phone" size={20} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Pressable
                onPress={() => { openLink(`tel:${nearbyCtr[0].towerPhone.replace(/\s/g, "")}`).catch(() => {}); }}
                style={styles.ctrQuickCall}
                testID="flight-ctr-quick-call"
              >
                <Feather name="phone" size={16} color="#34C759" />
                <ThemedText style={[styles.ctrQuickCallText, { color: "#34C759" }]}>
                  {nearbyCtr[0].towerPhone}
                </ThemedText>
              </Pressable>
            )}
          </Card>
        ) : null}

        {FLIGHT_CHECK_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon} size={18} color={theme.primary} />
              <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
            </View>
            <Card style={styles.sectionCard}>
              {section.items.map((item, itemIndex) => (
                <ChecklistRow
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  required={item.required}
                  tip={item.tip}
                  checked={checked.has(item.id)}
                  onToggle={toggleItem}
                  onShowTip={showTip}
                  showDivider={itemIndex < section.items.length - 1}
                  variant="asterisk"
                />
              ))}
            </Card>
          </View>
        ))}

        {allRequiredChecked && radarLat != null && radarLon != null ? (
          <View style={styles.radarSection}>
            <View style={styles.radarSectionHeader}>
              <View style={[styles.radarIconBg, { backgroundColor: theme.primary + "20" }]}>
                <Feather name="radio" size={18} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.radarSectionTitle, { color: theme.primary }]}>Live Radar</ThemedText>
                <ThemedText style={[styles.radarSectionSub, { color: theme.textSecondary }]}>
                  {aircraft.length} Flugobjekte{planningMaxAlt != null ? ` | Max ${planningMaxAlt}m` : ""}{planningRadiusKm != null ? ` | Radius ${planningRadiusKm < 1 ? `${Math.round(planningRadiusKm * 1000)}m` : `${planningRadiusKm}km`}` : ""}
                </ThemedText>
              </View>
              <Pressable
                onPress={recenterToGps}
                style={[styles.recenterBtn, { backgroundColor: theme.backgroundSecondary }]}
                hitSlop={8}
                testID="button-recenter-gps"
              >
                <Feather name="crosshair" size={18} color={theme.primary} />
              </Pressable>
            </View>

            <View style={[styles.mapContainer, { height: mapHeight }]}>
              <TrafficMapView
                latitude={radarLat}
                longitude={radarLon}
                latDelta={0.08}
                lonDelta={0.08}
                markers={mapMarkers}
                trails={coloredTrails}
                alarmRadiusM={raRadiusM}
                taRadiusM={taRadiusM}
                scanRadiusM={planningRadiusKm != null ? planningRadiusKm * 1000 : 0}
                wind={wind}
                sourceStatus={sourceStatus}
                geozoneLayers={geozoneLayers}
                countryIso={sessionCountryIso}
                mapStyle={mapStyle}
                onMapStyleChange={(s) => { setMapStyle(s); saveMapStyle(s); }}
                onHeadingChange={handleHeadingChangeFC}
              />
              <AlarmPulseProvider alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict}>
                <ProximityAlarmGlow alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict} bearingToThreat={activeAlerts.length > 0 && radarLat != null && radarLon != null ? ((bearingTo(radarLat, radarLon, activeAlerts[0].aircraft.latitude, activeAlerts[0].aircraft.longitude) - (deviceHeadingFC ?? 0) + 360) % 360) : undefined} />
                <ProximityAlarmBanner
                  alerts={activeAlerts}
                  alarmActive={alarmActive}
                  alarmLevel={alarmLevel}
                  clearOfConflict={clearOfConflict}
                  maxAltitudeM={alarmSettings?.maxAltitudeM}
                  onDismiss={dismissAlarm}
                />
              </AlarmPulseProvider>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              navigation.navigate("LiveRadar");
            }}
            style={[styles.radarButton, { backgroundColor: theme.primary + "12" }]}
          >
            <View style={[styles.radarIcon, { backgroundColor: theme.primary + "20" }]}>
              <Feather name="radio" size={20} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.radarTitle, { color: theme.primary }]}>Live Radar</ThemedText>
              <ThemedText style={[styles.radarSub, { color: theme.textSecondary }]}>Flugzeuge in der Nähe anzeigen</ThemedText>
            </View>
            <Feather name="chevron-right" size={18} color={theme.primary} />
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Abbrechen"
          onPress={handleCancel}
          variant="secondary"
          style={{ flex: 1 }}
        />
        <Button
          title="Flug beenden"
          onPress={handleComplete}
          disabled={!allRequiredChecked}
          loading={saving}
          style={{ flex: 1 }}
        />
      </View>

      <InfoDialog
        visible={tipModal.visible}
        onClose={() => setTipModal({ ...tipModal, visible: false })}
        title={tipModal.title}
        text={tipModal.tip}
        okLabel="Verstanden"
        testID="tip-info-dialog"
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
    marginBottom: Spacing.xl,
  },
  title: {
    ...Typography.h2,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.body,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h4,
  },
  sectionCard: {
    padding: 0,
    overflow: "hidden",
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  checkItemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  checkItemText: {
    flex: 1,
  },
  checkItemLabel: {
    ...Typography.body,
  },
  tipButton: {
    padding: Spacing.xs,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
  },
  radarButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: 12,
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  radarIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  radarTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  radarSub: {
    ...Typography.caption,
    marginTop: 2,
  },
  radarSection: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  radarSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  radarIconBg: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  radarSectionTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  radarSectionSub: {
    ...Typography.caption,
    marginTop: 2,
  },
  recenterBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  mapContainer: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  fullRadar: {
    flex: 1,
    position: "relative",
  },
  // Schmale Leiste oben mittig (lässt links Kompass/Wind und rechts Legende/Reiter frei)
  fullRadarTopBar: {
    position: "absolute",
    left: "25%",
    right: "25%",
    alignItems: "center",
  },
  fullRadarBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingLeft: Spacing.md,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 999,
    maxWidth: "100%",
  },
  ctrEmergencyCard: {
    borderWidth: 1,
    marginBottom: Spacing.lg,
    overflow: "hidden",
  },
  ctrEmergencyHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  ctrEmergencyTitleBlock: {
    flex: 1,
  },
  ctrEmergencyTitle: {
    ...Typography.body,
    fontWeight: "700",
    fontSize: 14,
  },
  ctrEmergencySubtitle: {
    ...Typography.caption,
    marginTop: 2,
  },
  ctrContactsList: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  ctrContactItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  ctrContactInfo: {
    flex: 1,
  },
  ctrContactName: {
    ...Typography.body,
    fontWeight: "600",
    fontSize: 14,
  },
  ctrContactMeta: {
    ...Typography.caption,
    marginTop: 1,
  },
  ctrContactNote: {
    ...Typography.caption,
    fontStyle: "italic",
    marginTop: 2,
  },
  ctrCallBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#34C759",
    alignItems: "center",
    justifyContent: "center",
  },
  ctrQuickCall: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  ctrQuickCallText: {
    ...Typography.body,
    fontWeight: "600",
    fontSize: 15,
  },
});
