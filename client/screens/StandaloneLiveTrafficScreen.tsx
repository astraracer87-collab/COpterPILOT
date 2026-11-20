import { openLink } from "@/lib/webBrowser";
import React, { useState, useEffect, useCallback, useRef, useMemo, useContext } from "react";
import { View, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, Platform, Text, Modal, Animated, Dimensions, AppState, Linking, Alert, useWindowDimensions } from "react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import QRCode from "react-native-qrcode-svg";
import * as Location from "@/lib/location";
import { loadLastKnownPosition, mapCenterHint, peekLastKnownPosition, resolveMapCenter, type StoredPosition } from "@/lib/mapFallbackCenter";
import { countriesWithUsage, onCountryUsageChange, USAGE_COUNTRIES } from "@/lib/countryUsage";
import { prefetchObstaclesAround } from "@/lib/obstacles";
import { captureRef } from "react-native-view-shot";
import TrafficMapView, { TrafficMarker, AircraftTrail, WindData } from "@/components/TrafficMapView";
import type { ViewportBbox } from "@/lib/opensky";
import { fetchDipulWind, fetchWeather, ForecastData } from "@/lib/weather";
import { fetchNotams, NotamData, getNotamSeverity, getNotamCountryLabel, getCountryLabel, notamCountOrUnknown, NOTAM_STATUS_UNKNOWN_TEXT } from "@/lib/notams";
import { fetchKpIndex, KpIndexData, fetchKpTimeline, getKpForHour, KpTimeEntry, getKpAssessment } from "@/lib/kpindex";
import { fetchElevation } from "@/lib/elevation";
import SunArcChart from "@/components/SunArcChart";

import ProximityAlarmBanner, { ProximityAlarmGlow, AlarmPulseProvider, bearingTo } from "@/components/ProximityAlarmBanner";
import SourceHealthIndicator from "@/components/SourceHealthIndicator";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { FeatureLockCard, useFeatureAccess } from "@/components/FeatureGate";
import { useShowDataSources } from "@/lib/dataSource";
import { ED269_SOURCE_LABELS } from "@/lib/ed269";
import { geozoneBadgeLabel, filterGeozoneDetailLines, adminSourceSuffix } from "@/lib/sourceAttribution";
import { useProximityAlarm } from "@/hooks/useProximityAlarm";
import { useAircraftTrails } from "@/hooks/useAircraftTrails";
import { isRecording, setMapSnapshot } from "@/lib/trafficRecorder";
import Slider from "@react-native-community/slider";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { useGermanEnergyInfrastructure } from "@/lib/useGermanEnergyInfrastructure";
import { windFacilitiesAsGeozones, supplementalLinesAsGeozones, supplementalInfrastructureAsGeozones } from "@/lib/energyInfrastructureZones";
import {
  getEnergyInfrastructureCenterForViewport,
  getGermanWindFacility100mPoints,
  getRadarEnergyInfrastructureItems,
  distanceMetersBetween,
  getEnergyInfrastructureCountry,
} from "../../shared/germanEnergyInfrastructure";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";
import { GEOZONE_LAYERS, GEOZONE_REGULATORY_INFO, GeozoneRegulatoryInfo, GeozoneContact, getContactsForZone, loadGeozoneSettings, saveGeozoneSettings, getActiveLayerNames, MAP_STYLES, MapStyleOption, loadMapStyle, saveMapStyle, loadRadarSettings, saveRadarSettings, queryGeozonesInArea, GeozoneFeatureInfo, separateTempRestrictions, TEMP_RESTRICTION_LAYER_LABEL, buildDipulLink, fetchNearbyTempRestrictionsRaw, DipulTempRestriction, getCountryGeozoneLayers, fetchLuTsaAsNotams } from "@/lib/geozones";
import { GEOZONE_CATEGORIES, COMBINED_COUNTRY_TOGGLES } from "../../shared/geozoneCategories";
import { getActiveOrUpcomingNearbyMilLowFlight } from "@/lib/milLowFlight";
import { useFocusEffect } from "@react-navigation/native";
import { getSettings, saveSettings, getSelectedDrone, getDroneMaxAltitudeM, getPilotProfile, PilotProfile, de21hRule, isDe21hZoneAvEligible, isErlaubnisExpired, Bundesland } from "@/lib/storage";
import { detectBundeslandFromCoordinates } from "@/lib/countryMaps";
import { computeGeozoneTabSeverity, GeozoneTabSeverity, assessGeozoneForRadar, isGeozoneActiveForRadar } from "@/lib/geozoneSeverity";
import { RESTRICTION_POLICY, zoneRestriction } from "../../shared/restrictionPolicy";
import { Geozone21hRules } from "@/components/Geozone21hRules";
import { InfrastructureFlightGuidance } from "@/components/InfrastructureFlightGuidance";
import { getCached, setCache, makeCacheKey } from "@/lib/dataCache";
import { useGeozoneRevalidation } from "@/lib/geozoneSources/useGeozoneRevalidation";
import { formatSourceStand, type StandTone } from "../../shared/offlineDataPolicy";

/** GPS-Koordinate für die Länderbestimmung (Teil A); null solange unbekannt. */
function finiteCoordOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
import { findNearbyCtrAirports, CtrAirport, getCtrCategoryLabel, getCtrProviderName } from "@/lib/ctrData";
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
  getRelativeAltitude,
  DataSource,
} from "@/lib/opensky";
import { aircraftMslM, currentQnhHpa, refreshQnh } from "@/lib/traffic/altitude";
import { getMarkerPinColor } from "@/lib/markerColors";
import { fetchRadarAreaData } from "@/lib/radarAreaCheck";
import { useRadarBackgroundMonitor } from "@/hooks/useRadarBackgroundMonitor";
import { getAgencyTag, agencyTagColor } from "@/lib/agencyTag";
import { InfoDialog } from "@/components/InfoDialog";
import { SideTabRail, type SideTab } from "@/components/SideTabRail";

type StandaloneRouteParams = {
  latitude?: number;
  longitude?: number;
  locationName?: string;
  countryIso?: string;
};

export default function StandaloneLiveTrafficScreen() {
  const { theme, isDark } = useTheme();
  const hasLiveTraffic = useFeatureAccess("live_traffic");
  const isAdmin = useShowDataSources();
  // Safe tab-bar height: falls back to 0 outside of a bottom-tabs context (e.g. Briefing stack)
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const safeTop = insets.top;

  // Optional route params let the briefing flow re-use this screen with a planned location.
  const route = useRoute<RouteProp<{ params?: StandaloneRouteParams }, "params">>();
  const overrideLat = route.params?.latitude;
  const overrideLon = route.params?.longitude;
  const overrideName = route.params?.locationName;
  const overrideCountry = route.params?.countryIso;
  const hasOverrideLocation = overrideLat != null && overrideLon != null;

  const [gpsLatitude, setGpsLatitude] = useState<number | null>(null);
  const [gpsLongitude, setGpsLongitude] = useState<number | null>(null);
  const [customLat, setCustomLat] = useState<number | null>(hasOverrideLocation ? overrideLat! : null);
  const [customLon, setCustomLon] = useState<number | null>(hasOverrideLocation ? overrideLon! : null);
  const [locationName, setLocationName] = useState<string>(overrideName || "");
  const [isCustomLocation, setIsCustomLocation] = useState(hasOverrideLocation);
  const [locationLoading, setLocationLoading] = useState(!hasOverrideLocation);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [permission, requestPermission] = Location.useForegroundPermissions();

  const latitude = isCustomLocation ? customLat : gpsLatitude;
  const longitude = isCustomLocation ? customLon : gpsLongitude;
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const handleHeadingChange = useCallback((h: number | null) => { setDeviceHeading(h); }, []);

  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [pilotElevation, setPilotElevation] = useState<number | null>(null);
  const { activeAlerts, approachingAircraft, alarmActive, alarmLevel, alarmSettings, clearOfConflict, dismissAlarm } = useProximityAlarm(aircraft, latitude, longitude, undefined, pilotElevation);
  const raRadiusKm = alarmSettings.ra?.radiusKm ?? 1;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [viewMode, setViewMode] = useState<"map" | "list">(Platform.OS === "web" ? "list" : "map");
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLoadingAircraft = useRef(false);
  const appActiveRef = useRef(true);
  const [trails, setTrails] = useState<AircraftTrail[]>([]);
  const [sourceStatus, setSourceStatus] = useState<Record<DataSource, "ok" | "error" | "timeout">>({ opensky: "ok", adsbfi: "ok", adsbone: "ok", airplaneslive: "ok", adsblol: "ok", ogn: "ok", fr24: "ok" });
  const [wind, setWind] = useState<WindData | null>(null);
  const mapContainerRef = useRef<View>(null);
  const [geozoneSettings, setGeozoneSettings] = useState<Record<string, boolean>>({});
  const [showGeozoneModal, setShowGeozoneModal] = useState(false);
  const [showMapConfig, setShowMapConfig] = useState(false);
  const [showRadar, setShowRadar] = useState(true);
  const [showTraffic, setShowTraffic] = useState(true);
  const [showWindsock, setShowWindsock] = useState(true);
  const [showGeozones, setShowGeozones] = useState(true);
  const [showEnergyInfrastructure, setShowEnergyInfrastructure] = useState(true);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  // Höhen-Filter für Vektor-Geozonen: erreichbare Höhe = max. Flughöhe der
  // gewählten Drohne (Standard 120 m); showAllGeozones hebt den Filter auf.
  const [showAllGeozones, setShowAllGeozones] = useState(false);
  const [maxReachableAltitudeM, setMaxReachableAltitudeM] = useState(120);
  const [detectedCountryIso, setDetectedCountryIso] = useState<string | undefined>(overrideCountry);
  // Hintergrund-Überwachung: Verkehr, Geozonen, NOTAM laufen weiter, wenn
  // die App in den Hintergrund geht (z. B. DJI Fly im Vordergrund).
  useRadarBackgroundMonitor({
    enabled: hasLiveTraffic && Platform.OS === "android",
    latitude,
    longitude,
    followGps: !isCustomLocation,
    radiusKm,
    raRadiusKm,
    countryIso: detectedCountryIso,
    pilotElevationMSL: pilotElevation,
  });
  // Teil A: Geozonen-Bestände bei Länderwechsel laut GPS (inkl. Nachbarn im
  // Umkreis) im Hintergrund prüfen; neue Daten → Hinweise neu laden.
  const geozoneReval = useGeozoneRevalidation({
    latitude: finiteCoordOrNull(latitude),
    longitude: finiteCoordOrNull(longitude),
    radiusKm: Math.max(raRadiusKm, 5),
    countryIso: detectedCountryIso,
    purpose: "map",
  });
  const [energyMapCenter, setEnergyMapCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const energyQueryLatitude = energyMapCenter?.latitude ?? latitude ?? 0;
  const energyQueryLongitude = energyMapCenter?.longitude ?? longitude ?? 0;
  const energyCountryIso = energyMapCenter
    ? detectCountryFromCoordinates(energyQueryLatitude, energyQueryLongitude) ?? undefined
    : detectedCountryIso;
  const energyCountry = getEnergyInfrastructureCountry(energyCountryIso);
  const energyInfrastructureQuery = useGermanEnergyInfrastructure(
    energyQueryLatitude,
    energyQueryLongitude,
    5,
    energyCountryIso ?? "",
    (showEnergyInfrastructure || (showGeozones && energyCountry?.iso === "DE")) &&
      (energyMapCenter != null || (latitude != null && longitude != null)) &&
      !!energyCountry?.hasComparableOfficialAssetLayers,
  );
  const windFacility100mPoints = getGermanWindFacility100mPoints(
    energyCountry?.iso,
    energyInfrastructureQuery.data?.features,
  );
  const nearbyWindFacilityWarnings = useMemo(() => {
    if (latitude == null || longitude == null) return [];
    return windFacility100mPoints
      .map((point) => ({
        ...point,
        distanceMeters: distanceMetersBetween(latitude, longitude, point.latitude, point.longitude),
      }))
      .filter((point) => point.distanceMeters <= raRadiusKm * 1000 + 100)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [latitude, longitude, raRadiusKm, windFacility100mPoints]);
  const radarEnergyInfrastructure = getRadarEnergyInfrastructureItems(
    showEnergyInfrastructure,
    energyInfrastructureQuery.data?.features,
    energyInfrastructureQuery.data?.sources,
    energyCountry?.assetComparisonStatusKeyByKind,
  );
  const requiredComparisonStatusKeys = [
    ...new Set(Object.values(energyCountry?.assetComparisonStatusKeyByKind ?? {})),
  ];
  const officialComparisonReady =
    requiredComparisonStatusKeys.length > 0 &&
    requiredComparisonStatusKeys.every((key) =>
      energyInfrastructureQuery.data?.sources[key].status === "available",
    );
  const energyInfrastructureStatus = !showEnergyInfrastructure
    ? "Ebene ausgeschaltet."
    : !energyCountry?.hasComparableOfficialAssetLayers
      ? "Kein vergleichbarer amtlicher Anlagenlayer; OSM bleibt zur Vermeidung von Duplikaten ausgeblendet."
      : energyInfrastructureQuery.isLoading
        ? "Amtlicher Anlagenabgleich wird geladen …"
        : energyInfrastructureQuery.isError && !energyInfrastructureQuery.data
          ? "Abgleich nicht erreichbar; es werden keine unbestätigten Treffer gezeichnet."
          : !officialComparisonReady
            ? `Amtlicher Abgleich unvollständig; ${radarEnergyInfrastructure.length} bestätigte Lücken angezeigt, übrige Treffer verborgen.${energyCountry?.iso === "FR" ? " Nur Leitungen über 50 kV sind vergleichbar." : ""}`
            : `${radarEnergyInfrastructure.length} Treffer, die im amtlichen Anlagenlayer nicht gefunden wurden.${energyCountry?.iso === "FR" ? " Windanlagen, Masten und Leitungen bis 50 kV oder ohne Spannungsangabe bleiben ausgeblendet." : ""}`;
  const activeGeozoneLayers = useMemo(() => getActiveLayerNames(geozoneSettings, detectedCountryIso), [geozoneSettings, detectedCountryIso]);
  const [mapStyle, setMapStyle] = useState<MapStyleOption>("grayscale");
  const [sidePanel, setSidePanel] = useState<"geozone" | "notam" | "wetter" | "radar" | null>(null);
  const [sidePanelGeozones, setSidePanelGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const supplementalWindZones = useMemo(() => [
    ...windFacilitiesAsGeozones(nearbyWindFacilityWarnings, energyInfrastructureQuery.data?.features),
    ...(energyCountry?.iso === "DE" ? supplementalLinesAsGeozones(radarEnergyInfrastructure.filter((item) => item.distanceMeters <= raRadiusKm * 1000 + 100)) : []),
    ...(energyCountry?.iso !== "DE" ? supplementalInfrastructureAsGeozones(energyCountry?.iso,
      radarEnergyInfrastructure.filter((item) => item.distanceMeters <= raRadiusKm * 1000)) : []),
  ], [nearbyWindFacilityWarnings, energyInfrastructureQuery.data?.features, energyCountry?.iso, radarEnergyInfrastructure, raRadiusKm]);
  const displayedGeozones = useMemo(() => [...sidePanelGeozones, ...supplementalWindZones],
    [sidePanelGeozones, supplementalWindZones]);
  const [geozoneDataStatus, setGeozoneDataStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [sidePanelTempRestrictions, setSidePanelTempRestrictions] = useState<GeozoneFeatureInfo[]>([]);
  const [sidePanelDipulRestrictions, setSidePanelDipulRestrictions] = useState<DipulTempRestriction[]>([]);
  const [sidePanelNotams, setSidePanelNotams] = useState<NotamData[]>([]);
  // NOTAM-Abfrage fehlgeschlagen (z. B. HTTP 401) -> Status unbekannt, nicht "keine".
  const [sidePanelNotamUnknown, setSidePanelNotamUnknown] = useState(false);
  const [sidePanelWeather, setSidePanelWeather] = useState<ForecastData | null>(null);
  const [sidePanelForecasts, setSidePanelForecasts] = useState<ForecastData[]>([]);
  const [sidePanelKp, setSidePanelKp] = useState<KpIndexData | null>(null);
  // Teil A: Stand je Quelle (Wetter/NOTAMs aus dem Offline-Speicher)
  const [sidePanelWeatherOrigin, setSidePanelWeatherOrigin] = useState<{ fetchedAt: number; cached: boolean } | null>(null);
  const [sidePanelNotamOrigin, setSidePanelNotamOrigin] = useState<{ fetchedAt: number; cached: boolean } | null>(null);
  const [sidePanelKpTimeline, setSidePanelKpTimeline] = useState<KpTimeEntry[]>([]);
  const [sidePanelLoading, setSidePanelLoading] = useState(false);
  const [alertFlags, setAlertFlags] = useState<{ wetter: boolean; notam: boolean; geozone: boolean }>({ wetter: false, notam: false, geozone: false });
  const [weatherStatus, setWeatherStatus] = useState<"unknown" | "ok" | "caution" | "critical">("unknown");
  const [nearbyCtr, setNearbyCtr] = useState<CtrAirport[]>([]);
  const [showCtrEmergency, setShowCtrEmergency] = useState(false);
  // Tower-Nummern: Die RC Pro 2 hat keine Telefon-App – tel:-Links schlagen
  // still fehl. Deshalb immer die Nummer groß zeigen plus QR-Code fürs Handy, „Anrufen“ nur
  // wenn das Gerät tel: öffnen kann.
  const [canCallPhone, setCanCallPhone] = useState(false);
  useEffect(() => {
    if (!showCtrEmergency) return;
    let alive = true;
    const probe = nearbyCtr[0]?.towerPhone?.replace(/\s/g, "");
    if (!probe) { setCanCallPhone(false); return; }
    Linking.canOpenURL(`tel:${probe}`).then((ok) => { if (alive) setCanCallPhone(!!ok); }).catch(() => { if (alive) setCanCallPhone(false); });
    return () => { alive = false; };
  }, [showCtrEmergency, nearbyCtr]);
  // Pilotenprofil für die AV-/§21h-Abdeckungsprüfung des Geozonen-Reiters.
  const [pilotProfile, setPilotProfile] = useState<PilotProfile | null>(null);
  useEffect(() => {
    getPilotProfile().then(setPilotProfile).catch(() => {});
  }, []);
  const geozonePrefetchLatitude = latitude == null ? null : Math.round(latitude * 200) / 200;
  const geozonePrefetchLongitude = longitude == null ? null : Math.round(longitude * 200) / 200;
  useEffect(() => {
    if (geozonePrefetchLatitude == null || geozonePrefetchLongitude == null || !detectedCountryIso) return;
    let cancelled = false;
    setGeozoneDataStatus("loading");
    setSidePanelGeozones([]);
    setSidePanelTempRestrictions([]);
    queryGeozonesInArea(
      geozonePrefetchLatitude,
      geozonePrefetchLongitude,
      raRadiusKm + 0.5,
      detectedCountryIso,
    ).then((zones) => {
      if (cancelled) return;
      const { geozones: permanentZones, tempRestrictions } = separateTempRestrictions(zones);
      setSidePanelGeozones(permanentZones);
      setSidePanelTempRestrictions(tempRestrictions);
      setGeozoneDataStatus("loaded");
    }).catch((error) => {
      if (cancelled) return;
      console.warn("[radar] geozone prefetch failed:", error?.message || error);
      setGeozoneDataStatus("error");
    });
    return () => { cancelled = true; };
  }, [geozonePrefetchLatitude, geozonePrefetchLongitude, detectedCountryIso, raRadiusKm]);

  // Schweregrad des Geozonen-Reiters: rot (aktives Flugverbot ohne passende AV),
  // orange (Höhenbeschränkung oder AV-gedecktes Verbot), blau (Zone vorhanden,
  // nicht aktiv), grün (geprüft und keine Zone), neutral (noch ungeprüft/Quelle
  // nicht verfügbar). Die AV-Abdeckung nutzt dieselbe Logik wie
  // der PreCheckOverviewScreen (§21h-Regel + gültige Bundesland-Allgemeinverfügung).
  const geozoneSeverity = useMemo<GeozoneTabSeverity>(() => {
    const windCoverageNotConfirmed =
      showGeozones &&
      energyCountry?.iso === "DE" &&
      (!energyInfrastructureQuery.data ||
        energyInfrastructureQuery.data.sources.officialWind.status !== "available");
    if (geozoneDataStatus !== "loaded" || windCoverageNotConfirmed) {
      return nearbyWindFacilityWarnings.length > 0 ? "orange" : "unknown";
    }
    const erlaubnisse = pilotProfile?.allgemeinverfuegung || [];
    const hasA2 = pilotProfile?.licenseA2 || false;
    const detectedBundesland =
      latitude != null && longitude != null
        ? detectBundeslandFromCoordinates(latitude, longitude)
        : null;
    const erlaubnisForBundesland = detectedBundesland
      ? erlaubnisse.find((e) => e.bundesland === (detectedBundesland as Bundesland))
      : undefined;
    const hasValidBundeslandErlaubnis =
      hasA2 && !!erlaubnisForBundesland && !isErlaubnisExpired(erlaubnisForBundesland);
    // Einstufung + Farbe kommen aus der Policy-Tabelle (shared/restrictionPolicy):
    // DE-Zonen tragen ihre aus dem Layer abgeleitete Einstufung (z. B.
    // Wohngrundstücke/Bahn REQ_AUTHORISATION, ED-R RESTRICTED, Flugplätze
    // CONDITIONAL). Eine genehmigungspflichtige Zone ist genau dann gedeckt,
    // wenn der Pilot eine gültige A2- + Bundesland-AV hat UND die Kategorie
    // AV-fähig ist (Wohngrundstücke, Bundesfern-/Wasserstraßen, Bahn).
    const severity = computeGeozoneTabSeverity(displayedGeozones, {
      isCoveredByAV: (z) => hasValidBundeslandErlaubnis && isDe21hZoneAvEligible(z),
    });
    return nearbyWindFacilityWarnings.length > 0 && (severity === "green" || severity === "blue")
      ? "orange"
      : severity;
  }, [displayedGeozones, pilotProfile, latitude, longitude, nearbyWindFacilityWarnings, geozoneDataStatus, showGeozones, energyCountry?.iso, energyInfrastructureQuery.data]);
  // Pro-Zone-Prädikat: aktive Flugverbots-/Sperrzone, die NICHT durch eine
  // gültige AV/§21h-Abdeckung des Piloten gedeckt ist. Nutzt exakt dieselbe
  // Abdeckungslogik wie der Reiter-Schweregrad oben, damit Karten-Hervorhebung
  // und Tab-Farbe konsistent bleiben.
  const isZoneSeriousProhibition = useMemo(() => {
    const erlaubnisse = pilotProfile?.allgemeinverfuegung || [];
    const hasA2 = pilotProfile?.licenseA2 || false;
    const detectedBundesland =
      latitude != null && longitude != null
        ? detectBundeslandFromCoordinates(latitude, longitude)
        : null;
    const erlaubnisForBundesland = detectedBundesland
      ? erlaubnisse.find((e) => e.bundesland === (detectedBundesland as Bundesland))
      : undefined;
    const hasValidBundeslandErlaubnis =
      hasA2 && !!erlaubnisForBundesland && !isErlaubnisExpired(erlaubnisForBundesland);
    // Gleiche Policy-Bewertung wie der Reiter oben (assessGeozoneForRadar):
    // hervorgehoben wird, was den Reiter rot färbt.
    return (z: GeozoneFeatureInfo): boolean =>
      assessGeozoneForRadar(z, {
        isCoveredByAV: (zone) => hasValidBundeslandErlaubnis && isDe21hZoneAvEligible(zone),
      }).tab === "red";
  }, [pilotProfile, latitude, longitude]);
  useEffect(() => {
    (async () => {
      const cached = await getCached<{ notams: NotamData[]; tempRestrictions: GeozoneFeatureInfo[]; dipul: DipulTempRestriction[]; geozones: GeozoneFeatureInfo[] }>(makeCacheKey("radar_alerts_v3", latitude, longitude));
      if (cached) {
        setSidePanelNotams(cached.data.notams || []);
        setSidePanelTempRestrictions(cached.data.tempRestrictions || []);
        setSidePanelDipulRestrictions(cached.data.dipul || []);
        setSidePanelGeozones(cached.data.geozones || []);
        const hasHighNotam = (cached.data.notams || []).some((n: NotamData) => getNotamSeverity(n) === "high") || (cached.data.tempRestrictions || []).length > 0 || (cached.data.dipul || []).some((d: DipulTempRestriction) => d.status === "active");
        const hasGeozones = (cached.data.geozones || []).length > 0;
        setAlertFlags((prev) => ({ ...prev, notam: hasHighNotam, geozone: hasGeozones }));
      }
    })();
  }, []);

  // Land kommt jetzt aus den Einstellungen (preferredCountryIso) statt
  // aus der GPS-Position. So bestimmt der Pilot in den Einstellungen,
  // welches Land Karten/Geozonen/NOTAMs filtert.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const s = await getSettings();
          const iso = (s.preferredCountryIso || "DE").toUpperCase();
          if (active && iso !== detectedCountryIso) {
            setDetectedCountryIso(iso);
            setSidePanelGeozones([]);
            setSidePanelTempRestrictions([]);
          }
        } catch {
          if (active && detectedCountryIso !== "DE") setDetectedCountryIso("DE");
        }
      })();
      return () => { active = false; };
    }, [detectedCountryIso])
  );

  useEffect(() => {
    if (latitude != null && longitude != null) {
      const nearby = findNearbyCtrAirports(latitude, longitude, 15);
      setNearbyCtr(nearby);
    } else {
      setNearbyCtr([]);
    }
  }, [latitude, longitude]);

  useEffect(() => {
    loadGeozoneSettings(detectedCountryIso).then(setGeozoneSettings);
    getSelectedDrone().then((d) => setMaxReachableAltitudeM(getDroneMaxAltitudeM(d))).catch(() => {});
  }, [detectedCountryIso]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([loadMapStyle(), loadRadarSettings()]).then(([saved, rs]) => {
        if (!active) return;
        setMapStyle(saved);
        setRadiusKm(Math.max(3, Math.min(30, rs.radiusKm)));
        setShowRadar(rs.showRadar);
        setShowTraffic(rs.showTraffic);
        setShowWindsock(rs.showWindsock);
        setShowGeozones(rs.showGeozones);
        setShowEnergyInfrastructure(rs.showEnergyInfrastructure);
        setShowWeatherOverlay(rs.showWeatherOverlay);
        setShowAllGeozones(rs.showAllGeozones);
      }).catch(() => {});
      return () => { active = false; };
    }, []),
  );

  useEffect(() => {
    if (latitude == null || longitude == null) {
      setPilotElevation(null);
      return;
    }
    setPilotElevation(null);
    void refreshQnh(latitude, longitude);
    fetchElevation(latitude, longitude).then((elev) => {
      setPilotElevation(elev);
    });
  }, [latitude, longitude]);

  const activeAlertsRef = useRef(activeAlerts);
  activeAlertsRef.current = activeAlerts;
  const approachingRef = useRef(approachingAircraft);
  approachingRef.current = approachingAircraft;
  const { updateTrails, clearTrails } = useAircraftTrails();
  const inAirCount = useMemo(() => aircraft.filter((a) => !a.onGround).length, [aircraft]);
  const getEffectiveAlt = useCallback((a: AircraftState) => {
    return a.aglAltitude ?? getRelativeAltitude(a, pilotElevation);
  }, [pilotElevation]);

  const lowAltitudeCount = useMemo(() => aircraft.filter((a) => {
    const alt = getEffectiveAlt(a);
    return alt != null && alt < 500;
  }).length, [aircraft, getEffectiveAlt]);



  useEffect(() => {
    if (!isRecording() || Platform.OS === "web") return;
    const captureMap = async () => {
      try {
        if (mapContainerRef.current && viewMode === "map") {
          const base64 = await captureRef(mapContainerRef, {
            format: "jpg",
            quality: 0.4,
            result: "base64",
          });
          setMapSnapshot(base64);
        }
      } catch {}
    };
    const interval = setInterval(captureMap, 60000);
    captureMap();
    return () => clearInterval(interval);
  }, [viewMode]);

  useEffect(() => {
    if (latitude == null || longitude == null) return;
    let cancelled = false;
    const loadWind = async () => {
      if (!appActiveRef.current) return;
      const w = await fetchDipulWind(latitude, longitude);
      if (!cancelled && w && Number.isFinite(w.speed) && Number.isFinite(w.direction)) {
        setWind({ direction: w.direction, speed: w.speed, directionLabel: w.directionLabel });
      }
    };
    loadWind();
    const iv = setInterval(loadWind, 300000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [latitude, longitude]);

  // Ersatz-Mittelpunkt ohne Standort (letzte Position → erstes aktives Land → DE).
  const [lastKnownPos, setLastKnownPos] = useState<StoredPosition | null>(() => peekLastKnownPosition());
  const [usageTick, setUsageTick] = useState(0);
  useEffect(() => {
    let alive = true;
    loadLastKnownPosition().then((p) => { if (alive && p) setLastKnownPos(p); }).catch(() => {});
    const off = onCountryUsageChange(() => setUsageTick((t) => t + 1));
    return () => { alive = false; off(); };
  }, []);
  const mapCenter = useMemo(() => {
    const enabled = new Set([...countriesWithUsage("offline"), ...countriesWithUsage("online")]);
    const activeCountries = USAGE_COUNTRIES.map((c) => c.iso).filter((iso) => enabled.has(iso));
    return resolveMapCenter({
      gps: gpsLatitude != null && gpsLongitude != null ? { latitude: gpsLatitude, longitude: gpsLongitude } : null,
      lastKnown: lastKnownPos,
      activeCountries,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsLatitude, gpsLongitude, lastKnownPos, usageTick]);

  const applyGpsFix = useCallback(async (loc: Location.LocationObject) => {
    setGpsLatitude(loc.coords.latitude);
    setGpsLongitude(loc.coords.longitude);
    setLocationError(null);
    setLocationLoading(false);
    try {
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      if (geo) {
        const parts = [geo.city || geo.district, geo.region].filter(Boolean);
        setLocationName(parts.join(", ") || `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`);
      }
    } catch {
      setLocationName(`${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`);
    }
  }, []);

  useEffect(() => {
    // Skip GPS entirely when a planned location was passed via route params.
    if (hasOverrideLocation) return;
    if (!permission) return;
    if (!permission.granted) { setLocationLoading(false); return; }

    // Die Karte erscheint sofort (Ersatz-Mittelpunkt); der Standort kommt dazu:
    // 1. frische Position, die Android schon kennt (< 2 min) → sofort
    // 2. Einzelabfrage (GPS, dann Netzwerk; begrenzte Wartezeit)
    // 3. parallel ein Watch: liefert den ersten Fix, sobald GPS ihn hat
    //    (Kaltstart ohne Play Services kann Minuten dauern) → Karte zentriert
    //    sich dann neu; danach wird der Watch beendet.
    let cancelled = false;
    let gotFix = false;
    let watch: Location.LocationSubscription | null = null;
    const onFix = (loc: Location.LocationObject) => {
      if (cancelled || gotFix) return;
      gotFix = true;
      watch?.remove();
      watch = null;
      applyGpsFix(loc);
    };
    (async () => {
      try {
        const recent = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
        if (recent && !cancelled) onFix(recent);
      } catch {}
      if (gotFix || cancelled) return;
      Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 }, onFix)
        .then((sub) => {
          if (cancelled || gotFix) sub.remove();
          else watch = sub;
        })
        .catch(() => {});
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        onFix(loc);
      } catch (err: any) {
        if (cancelled || gotFix) return;
        setLocationError(err?.message || "GPS-Standort konnte nicht ermittelt werden");
        setLocationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      watch?.remove();
    };
  }, [permission, hasOverrideLocation, applyGpsFix]);

  // Hindernisse um den Standort (bzw. Ersatz-Mittelpunkt) vorab laden, damit
  // die Karte beim Verschieben sofort aus dem Speicher zeichnet.
  useEffect(() => {
    const lat = latitude ?? (mapCenter.source !== "default" && mapCenter.source !== "country" ? mapCenter.latitude : null);
    const lon = longitude ?? (mapCenter.source !== "default" && mapCenter.source !== "country" ? mapCenter.longitude : null);
    if (lat == null || lon == null) return;
    const t = setTimeout(() => { prefetchObstaclesAround(lat, lon).catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, [latitude != null ? latitude.toFixed(2) : null, longitude != null ? longitude.toFixed(2) : null, mapCenter.source]);

  const viewportBboxRef = useRef<ViewportBbox | null>(null);
  useEffect(() => {
    if (latitude != null && longitude != null) {
      setEnergyMapCenter({ latitude, longitude });
    }
  }, [latitude, longitude]);

  const handleViewportChange = useCallback((bbox: ViewportBbox) => {
    viewportBboxRef.current = bbox;
    setEnergyMapCenter((current) => getEnergyInfrastructureCenterForViewport(current, bbox));
  }, []);
  // Ohne GPS-Fix: Verkehr schon für die letzte bekannte Position laden (wie der
  // Hintergrundwächter) – sonst warnt dieser, während die Karte leer bleibt.
  const trafficLat = latitude ?? (mapCenter.source === "last" ? mapCenter.latitude : null);
  const trafficLon = longitude ?? (mapCenter.source === "last" ? mapCenter.longitude : null);
  const loadAircraft = useCallback(async () => {
    const latitude = trafficLat;
    const longitude = trafficLon;
    if (latitude == null || longitude == null) return;
    if (isLoadingAircraft.current) return;
    if (!appActiveRef.current) return;
    isLoadingAircraft.current = true;
    try {
      setError(null);
      // Bewusst KEINE Viewport-Bbox mitschicken: der Radar-Radius ist die
      // verbindliche Grenze. Beim Rauszoomen sollen keine Flieger außerhalb
      // des Radius auftauchen. Server-Bbox-Support bleibt für künftige
      // Use-Cases erhalten.
      const result = await fetchNearbyAircraft(latitude, longitude, radiusKm, 60);

      const allAcForTrails: AircraftState[] = [...result.states];
      const stateIds = new Set(result.states.map((a) => a.icao24));
      for (const al of activeAlertsRef.current) {
        if (!stateIds.has(al.aircraft.icao24)) allAcForTrails.push(al.aircraft);
      }
      for (const ap of approachingRef.current) {
        if (!stateIds.has(ap.aircraft.icao24) && !allAcForTrails.some((a) => a.icao24 === ap.aircraft.icao24)) allAcForTrails.push(ap.aircraft);
      }
      // Keine Flugspuren auf dem Radar (nur die Flugzeuge selbst)
      void allAcForTrails;
      setAircraft(result.states);
      setSourceStatus(result.sourceStatus);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden der Flugdaten");
      setLoading(false);
    } finally {
      isLoadingAircraft.current = false;
    }
  }, [trafficLat, trafficLon, radiusKm, updateTrails]);

  useEffect(() => {
    if (trafficLat == null || trafficLon == null) return;
    loadAircraft();
    refreshInterval.current = setInterval(loadAircraft, 2000);
    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [loadAircraft, trafficLat, trafficLon]);

  const loadAircraftRef = useRef(loadAircraft);
  loadAircraftRef.current = loadAircraft;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      appActiveRef.current = next === "active";
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

  const stableAlertLat = latitude != null ? Math.round(latitude * 1000) / 1000 : null;
  const stableAlertLon = longitude != null ? Math.round(longitude * 1000) / 1000 : null;

  useEffect(() => {
    if (latitude == null || longitude == null) return;
    const qLat = latitude;
    const qLon = longitude;
    let cancelled = false;
    const checkAlerts = async () => {
      if (!appActiveRef.current) return;
      try {
        // Gemeinsame Gebietsprüfung (auch für die Hintergrund-Überwachung)
        const area = await fetchRadarAreaData(qLat, qLon, raRadiusKm, detectedCountryIso);
        if (cancelled) return;
        const { weatherData, kp, kpTimeline: kpTl, notamResult, combinedNotams, tempRestrictions, allDipul, permZones, notamUnknown, flags } = area;
        const f = weatherData?.forecasts?.[0];
        setWeatherStatus(flags.weatherStatus);
        setSidePanelNotamUnknown(notamUnknown);
        setAlertFlags({ wetter: flags.wetter, notam: flags.notam, geozone: flags.geozone });
        if (f) setSidePanelWeather(f);
        if (weatherData?.forecasts) setSidePanelForecasts(weatherData.forecasts);
        setSidePanelKp(kp);
        setSidePanelWeatherOrigin(weatherData?.offline ?? (weatherData ? { fetchedAt: Date.now(), cached: false } : null));
        setSidePanelNotamOrigin((notamResult as { offline?: { fetchedAt: number; cached: boolean } }).offline ?? null);
        if (kpTl.length > 0) setSidePanelKpTimeline(kpTl);
        setSidePanelNotams(combinedNotams);
        setSidePanelTempRestrictions(tempRestrictions);
        setSidePanelDipulRestrictions(allDipul);
        setSidePanelGeozones(permZones);
        const ck = makeCacheKey("radar_alerts_v3", qLat, qLon);
        setCache(ck, { notams: combinedNotams, tempRestrictions, dipul: allDipul, geozones: permZones }).catch(() => {});
      } catch (e: any) {
        console.warn("[checkAlerts] error:", e?.message || e);
      }
    };
    checkAlerts();
    const iv = setInterval(checkAlerts, 120000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [stableAlertLat, stableAlertLon, raRadiusKm, detectedCountryIso, geozoneReval.dataVersion]);

  const openSidePanel = useCallback(async (panel: "geozone" | "notam" | "wetter" | "radar") => {
    if (sidePanel === panel) { setSidePanel(null); return; }
    setSidePanel(panel);
    if (panel !== "radar") setAlertFlags((prev) => ({ ...prev, [panel]: false }));
    if (panel === "radar") return;
    if (latitude == null || longitude == null) return;
    if ((panel === "geozone" && sidePanelGeozones.length > 0) ||
        (panel === "notam" && (sidePanelNotams.length > 0 || sidePanelTempRestrictions.length > 0 || sidePanelDipulRestrictions.length > 0))) {
      return;
    }
    // Wetter liegt schon vor (Gebietsprüfung/Vorab-Laden): sofort zeigen und nur
    // still im Hintergrund aktualisieren (fetchWeather liefert < 10 min alte Daten ohne Netz).
    const weatherShownFromCache = panel === "wetter" && sidePanelForecasts.length > 0;
    if (!weatherShownFromCache) setSidePanelLoading(true);
    try {
      if (panel === "geozone") {
        let geozonesLoaded = true;
        const zones = await queryGeozonesInArea(latitude, longitude, raRadiusKm, detectedCountryIso).catch((e) => {
          geozonesLoaded = false;
          setGeozoneDataStatus("error");
          console.warn("[openSidePanel] geozone query failed:", e?.message || e);
          return [] as GeozoneFeatureInfo[];
        });
        const { geozones: permZones, tempRestrictions } = separateTempRestrictions(zones);
        setSidePanelGeozones(permZones);
        setSidePanelTempRestrictions(tempRestrictions);
        setGeozoneDataStatus(geozonesLoaded ? "loaded" : "error");
      } else if (panel === "notam") {
        const [result, zones, dipulResult, luTsaNotams] = await Promise.all([
          fetchNotams(latitude, longitude).catch(() => ({ notams: [] as NotamData[], total: 0, queriedCodes: [] as string[], failed: true })),
          queryGeozonesInArea(latitude, longitude, raRadiusKm, detectedCountryIso).catch(() => [] as GeozoneFeatureInfo[]),
          fetchNearbyTempRestrictionsRaw(latitude, longitude, raRadiusKm).catch(() => ({ active: [] as DipulTempRestriction[], upcoming: [] as DipulTempRestriction[] })),
          detectedCountryIso === "LU" ? fetchLuTsaAsNotams(latitude, longitude, raRadiusKm).catch(() => []) : Promise.resolve([]),
        ]);
        const { tempRestrictions } = separateTempRestrictions(zones);
        const combinedNotams = [...result.notams, ...luTsaNotams as unknown as NotamData[]];
        const milNearby = getActiveOrUpcomingNearbyMilLowFlight(dipulResult, latitude, longitude, raRadiusKm);
        setSidePanelNotamUnknown(notamCountOrUnknown(result) === null);
        setSidePanelNotams(combinedNotams);
        setSidePanelTempRestrictions(tempRestrictions);
        setSidePanelDipulRestrictions([
          ...dipulResult.active,
          ...milNearby.active,
          ...dipulResult.upcoming,
          ...milNearby.upcoming,
        ]);
      } else if (panel === "wetter") {
        const [data, kpTl] = await Promise.all([
          fetchWeather(latitude, longitude, 1440),
          fetchKpTimeline().catch(() => [] as KpTimeEntry[]),
        ]);
        if (data.forecasts.length > 0) setSidePanelWeather(data.forecasts[0]);
        setSidePanelForecasts(data.forecasts);
        const currentKpVal = kpTl.length > 0 ? getKpForHour(kpTl, new Date()) : null;
        setSidePanelKp(currentKpVal != null ? { value: currentKpVal, timestamp: new Date().toISOString(), ...getKpAssessment(currentKpVal) } : null);
      }
    } catch {}
    setSidePanelLoading(false);
  }, [sidePanel, latitude, longitude, raRadiusKm, detectedCountryIso, sidePanelGeozones.length, sidePanelNotams.length, sidePanelTempRestrictions.length, sidePanelDipulRestrictions.length, sidePanelForecasts.length]);

  const handleMapLongPress = useCallback(async (lat: number, lon: number) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setAircraft([]);
      setTrails([]);
      setSidePanelGeozones([]);
      setSidePanelTempRestrictions([]);
      setSidePanelDipulRestrictions([]);
      setSidePanelNotams([]);
      setLocationName(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      setCustomLat(lat);
      setCustomLon(lon);
      setIsCustomLocation(true);
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (geo) {
          const parts = [geo.city || geo.district, geo.region].filter(Boolean);
          setLocationName(parts.join(", ") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        }
      } catch {}
    } catch (e) {
    }
  }, []);

  const handleResetLocation = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let lat = gpsLatitude;
    let lon = gpsLongitude;
    if (lat == null || lon == null) {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = loc.coords.latitude;
        lon = loc.coords.longitude;
        setGpsLatitude(lat);
        setGpsLongitude(lon);
      } catch {
        return;
      }
    }
    setAircraft([]);
    setTrails([]);
    setSidePanelGeozones([]);
    setSidePanelTempRestrictions([]);
    setSidePanelDipulRestrictions([]);
    setSidePanelNotams([]);
    setIsCustomLocation(false);
    try {
      const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
      if (geo) {
        const parts = [geo.city || geo.district, geo.region].filter(Boolean);
        setLocationName(parts.join(", ") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      } else {
        setLocationName(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      }
    } catch {
      setLocationName(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    }
  }, [gpsLatitude, gpsLongitude]);

  const handleCenterOnGps = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude;
      const lon = loc.coords.longitude;
      setGpsLatitude(lat);
      setGpsLongitude(lon);
      setLocationError(null);
      if (isCustomLocation) {
        setIsCustomLocation(false);
        setAircraft([]);
        setTrails([]);
      }
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        if (geo) {
          const parts = [geo.city || geo.district, geo.region].filter(Boolean);
          setLocationName(parts.join(", ") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        } else {
          setLocationName(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
        }
      } catch {
        setLocationName(`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      }
    } catch (err: any) {
      setLocationError(err?.message || "GPS-Standort konnte nicht ermittelt werden");
    }
  }, [isCustomLocation]);

  const sortedAircraft = useMemo(() => {
    const sorted = [...aircraft].sort((a, b) => {
      const altA = a.aglAltitude ?? aircraftMslM(a) ?? 99999;
      const altB = b.aglAltitude ?? aircraftMslM(b) ?? 99999;
      return altA - altB;
    });
    return sorted;
  }, [aircraft]);

  const criticalIcaos = useMemo(() => new Set(activeAlerts.filter((a) => a.level === "critical").map((a) => a.aircraft.icao24)), [activeAlerts]);
  const warningIcaos = useMemo(() => new Set(activeAlerts.filter((a) => a.level === "warning").map((a) => a.aircraft.icao24)), [activeAlerts]);
  const approachIcaos = useMemo(() => new Set(approachingAircraft.map((a) => a.aircraft.icao24)), [approachingAircraft]);

  const MAX_MAP_MARKERS = 35;

  const mapMarkers: TrafficMarker[] = useMemo(() => {
    const knownIcaos = new Set(sortedAircraft.map((ac) => ac.icao24));
    const alertAc: AircraftState[] = [];
    for (const a of activeAlerts) {
      if (!knownIcaos.has(a.aircraft.icao24)) {
        alertAc.push(a.aircraft);
        knownIcaos.add(a.aircraft.icao24);
      }
    }
    for (const a of approachingAircraft) {
      if (!knownIcaos.has(a.aircraft.icao24)) {
        alertAc.push(a.aircraft);
        knownIcaos.add(a.aircraft.icao24);
      }
    }
    const combined = [...alertAc, ...sortedAircraft];
    const alertFirst = combined.slice().sort((a, b) => {
      const aPri = criticalIcaos.has(a.icao24) ? 0 : warningIcaos.has(a.icao24) || approachIcaos.has(a.icao24) ? 1 : 2;
      const bPri = criticalIcaos.has(b.icao24) ? 0 : warningIcaos.has(b.icao24) || approachIcaos.has(b.icao24) ? 1 : 2;
      return aPri - bPri;
    });
    return alertFirst.slice(0, MAX_MAP_MARKERS).map((ac) => {
      const agencyTag = getAgencyTag(ac);
      return {
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
        registration: ac.registration,
        aircraftType: ac.aircraftType,
        aircraftDesc: ac.aircraftDesc,
        operator: ac.operator,
        cn: ac.cn,
        originIata: ac.originIata,
        destIata: ac.destIata,
        flightNumber: ac.flightNumber,
        agencyTag,
      };
    });
  }, [sortedAircraft, activeAlerts, approachingAircraft, criticalIcaos, warningIcaos, approachIcaos, pilotElevation]);

  const coloredTrails = useMemo(() => trails.map((trail) => {
    if (criticalIcaos.has(trail.id)) return { ...trail, color: "#FF3B30", isAlert: true };
    if (warningIcaos.has(trail.id) || approachIcaos.has(trail.id)) return { ...trail, color: "#FF9500", isAlert: true };
    return trail;
  }), [trails, criticalIcaos, warningIcaos, approachIcaos]);

  const mapWeatherAlerts = useMemo(() => {
    const alerts: { label: string; value: string; color: string }[] = [];
    const f = sidePanelWeather;
    if (!f) return alerts;
    const orange = "#FF9500";
    const red = "#FF3B30";
    if (f.windSpeed > 10) alerts.push({ label: "Wind", value: f.windSpeed.toFixed(1) + " m/s", color: red });
    else if (f.windSpeed > 7) alerts.push({ label: "Wind", value: f.windSpeed.toFixed(1) + " m/s", color: orange });
    if (f.windGust != null && f.windGust > 12) alerts.push({ label: "Böen", value: f.windGust.toFixed(1) + " m/s", color: red });
    else if (f.windGust != null && f.windGust > 9) alerts.push({ label: "Böen", value: f.windGust.toFixed(1) + " m/s", color: orange });
    if (f.windAtAltitude) {
      for (const w of f.windAtAltitude) {
        if (w.height <= 10) continue;
        if (w.speed > 12) alerts.push({ label: `Wind ${w.height}m`, value: w.speed.toFixed(1) + " m/s", color: red });
        else if (w.speed > 8) alerts.push({ label: `Wind ${w.height}m`, value: w.speed.toFixed(1) + " m/s", color: orange });
      }
    }
    if (f.temperature < -5) alerts.push({ label: "Temp", value: f.temperature.toFixed(1) + "°", color: red });
    else if (f.temperature < 0) alerts.push({ label: "Temp", value: f.temperature.toFixed(1) + "°", color: orange });
    if (f.rain > 0.5) alerts.push({ label: "Regen", value: f.rain.toFixed(1) + " mm", color: red });
    else if (f.rain > 0.1) alerts.push({ label: "Regen", value: f.rain.toFixed(1) + " mm", color: orange });
    // Vereisungs-Kombi: kalte Temperatur + hohe Feuchte
    if (f.temperature != null && f.humidity != null) {
      if (f.temperature < 0 && f.humidity >= 80) {
        alerts.push({ label: "Vereisung", value: `${f.temperature.toFixed(0)}°/${Math.round(f.humidity)}%`, color: red });
      } else if (f.temperature <= 5 && f.humidity >= 90) {
        alerts.push({ label: "Beschlag", value: `${f.temperature.toFixed(0)}°/${Math.round(f.humidity)}%`, color: orange });
      }
    }
    if (f.visibility != null && f.visibility < 500) alerts.push({ label: "Sicht", value: Math.round(f.visibility) + "m", color: red });
    else if (f.visibility != null && f.visibility < 1000) alerts.push({ label: "Sicht", value: Math.round(f.visibility) + "m", color: orange });
    const kpVal = sidePanelKpTimeline.length > 0 ? getKpForHour(sidePanelKpTimeline, new Date()) : sidePanelKp?.value ?? null;
    if (kpVal != null && kpVal >= 3) {
      alerts.push({ label: "KP", value: kpVal.toFixed(1), color: getKpAssessment(kpVal).color });
    }
    return alerts;
  }, [sidePanelWeather, sidePanelKp, sidePanelKpTimeline]);

  const getAltitudeColor = (alt: number | null) => {
    if (alt == null) return theme.textTertiary;
    if (alt < 150) return theme.statusNoGo;
    if (alt < 500) return theme.statusCaution;
    return theme.statusGo;
  };

  // Bei Override-Location aus dem Briefing wird die Geräte-Permission nicht benötigt — alle Permission-Gates überspringen.
  // Karte immer zeigen (Product Owner): ohne Standort mit Ersatz-Mittelpunkt
  // und kleinem Hinweis statt Vollbild „Standort wird ermittelt…/nicht verfügbar“.
  const showLoading = false;
  const showPermRequest = false;
  const showLocLoading = false;
  const showLocError = false;
  const hasRealPosition = latitude != null && longitude != null;
  const mapLatitude = hasRealPosition ? latitude! : mapCenter.latitude;
  const mapLongitude = hasRealPosition ? longitude! : mapCenter.longitude;
  const needsLocationPermission = !hasOverrideLocation && !!permission && !permission.granted;
  const noPositionHint = hasRealPosition
    ? null
    : needsLocationPermission
      ? "Kein Standort – Standort-Berechtigung fehlt"
      : locationLoading && !locationError
        ? `Standort wird ermittelt … ${mapCenter.source === "last" ? "Karte zeigt letzte bekannte Position" : ""}`.trim()
        : mapCenterHint(mapCenter.source);

  const renderAircraft = ({ item }: { item: AircraftState }) => {
    const alt = getEffectiveAlt(item);
    const altColor = getAltitudeColor(alt);
    const isLow = alt != null && alt < 500;
    const dual = getAltitudeDualDisplay(item);

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
              AGL {dual.agl} | MSL {dual.msl}
            </ThemedText>
          </View>
        </View>
        <View style={styles.categorySourceRow}>
          <View style={[styles.categoryBadge, { backgroundColor: theme.primary + "15" }]}>
            <ThemedText style={[styles.categoryText, { color: theme.primary }]}>{getCategoryLabel(item.category)}</ThemedText>
          </View>
          {(() => {
            const agencyTag = getAgencyTag(item);
            return agencyTag ? (
              <View style={[styles.agencyBadge, { backgroundColor: agencyTagColor(agencyTag) }]} testID={`badge-agency-${item.icao24}`}>
                <ThemedText style={styles.agencyBadgeText}>{agencyTag}</ThemedText>
              </View>
            ) : null;
          })()}
          {isAdmin ? (
            <View style={styles.sourceIndicators}>
              {item.sources.map((s) => (
                <View key={s} style={[styles.sourceChip, { backgroundColor: theme.backgroundSecondary }]}>
                  <View style={[styles.sourceChipDot, { backgroundColor: s === "opensky" ? "#4CAF50" : s === "adsbfi" ? "#2196F3" : s === "airplaneslive" ? "#9C27B0" : s === "adsblol" ? "#E91E63" : s === "ogn" ? "#FF5722" : "#FF9800" }]} />
                  <ThemedText style={[styles.sourceChipText, { color: theme.textTertiary }]}>
                    {s === "opensky" ? "OpenSky" : s === "adsbfi" ? "adsb.fi" : s === "airplaneslive" ? "apl" : s === "adsblol" ? "lol" : s === "ogn" ? "OGN" : "adsb.one"}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}
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

  const degPerKm = 1 / 111.32;
  const latDelta = radiusKm * degPerKm * 2.2;
  const lonDelta = (radiusKm * degPerKm / Math.cos(((latitude ?? 0) * Math.PI) / 180)) * 2.2;
  // Ohne Standort: Ausdehnung der Ersatz-Ansicht (Landesübersicht bzw. ~20 km).
  const mapLatDelta = hasRealPosition ? latDelta : Math.max(latDelta, mapCenter.latitudeDelta);
  const mapLonDelta = hasRealPosition ? lonDelta : mapLatDelta / Math.max(0.2, Math.cos((mapCenter.latitude * Math.PI) / 180));

  const sourceStatusDot = (status: "ok" | "error" | "timeout") => {
    if (status === "ok") return "#34C759";
    if (status === "timeout") return "#FF9500";
    return "#FF3B30";
  };

  const listHeaderContent = (
    <View style={styles.headerSection}>
      <ProximityAlarmBanner alerts={activeAlerts} alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict} maxAltitudeM={alarmSettings.maxAltitudeM} onDismiss={dismissAlarm} />
      <View style={{ alignItems: "center", marginTop: Spacing.sm }}>
        <SourceHealthIndicator isDark={isDark} testID="radar-source-health-list" />
      </View>
    </View>
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

  const toggleGeozoneSetting = (key: string) => {
    const updated = { ...geozoneSettings, [key]: !geozoneSettings[key] };
    setGeozoneSettings(updated);
    saveGeozoneSettings(updated);
  };

  const allGeozoneToggleKeys = useMemo(
    () => [...GEOZONE_CATEGORIES.map((c) => c.id), ...COMBINED_COUNTRY_TOGGLES.map((t) => t.id)],
    [],
  );

  const [layerInfoId, setLayerInfoId] = useState<string | null>(null);
  const layerInfoData = layerInfoId ? GEOZONE_REGULATORY_INFO[layerInfoId] : null;

  const renderGeozoneToggleRow = (key: string, label: string, infoId?: string) => (
    <View key={key} style={[styles.geozoneLayerRow, { borderBottomColor: theme.border }]}>
      <Pressable onPress={() => toggleGeozoneSetting(key)} style={{ flexDirection: "row", alignItems: "center", gap: Spacing.md, flex: 1 }}>
        <View style={[styles.geozoneCheck, { backgroundColor: geozoneSettings[key] ? theme.primary : theme.backgroundSecondary, borderColor: geozoneSettings[key] ? theme.primary : theme.textTertiary }]}>
          {geozoneSettings[key] ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
        </View>
        <ThemedText style={styles.geozoneLayerLabel}>{label}</ThemedText>
      </Pressable>
      {infoId && GEOZONE_REGULATORY_INFO[infoId] ? (
        <Pressable
          onPress={() => { setLayerInfoId(infoId); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
          hitSlop={10}
          style={[styles.geozoneLayerInfoBtn, { borderColor: theme.primary }]}
        >
          <Feather name="info" size={12} color={theme.primary} />
        </Pressable>
      ) : null}
    </View>
  );

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
        <View style={styles.geozoneToggleAllRow}>
          <Pressable
            onPress={() => {
              const allOn = allGeozoneToggleKeys.every((k) => geozoneSettings[k]);
              const next = { ...geozoneSettings };
              allGeozoneToggleKeys.forEach((k) => { next[k] = !allOn; });
              setGeozoneSettings(next);
              saveGeozoneSettings(next);
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch (_e) {}
            }}
            style={[styles.geozoneToggleAllBtn, { backgroundColor: theme.primary + "18" }]}
          >
            <Feather
              name={allGeozoneToggleKeys.every((k) => geozoneSettings[k]) ? "x-square" : "check-square"}
              size={16}
              color={theme.primary}
            />
            <Text style={[styles.geozoneToggleAllText, { color: theme.primary }]}>
              {allGeozoneToggleKeys.every((k) => geozoneSettings[k]) ? "Alle ausschalten" : "Alle einschalten"}
            </Text>
          </Pressable>
        </View>
        <ScrollView style={styles.geozoneModalList}>
          <Text style={{ fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: Spacing.sm, marginBottom: Spacing.xs, color: theme.textTertiary }}>
            Kategorien (länderübergreifend)
          </Text>
          {GEOZONE_CATEGORIES.map((cat) => renderGeozoneToggleRow(cat.id, cat.label, cat.infoId))}
          <Text style={{ fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: Spacing.lg, marginBottom: Spacing.xs, color: theme.textTertiary }}>
            Länder-Gesamtanzeige
          </Text>
          {COMBINED_COUNTRY_TOGGLES.map((t) => renderGeozoneToggleRow(t.id, t.label, t.infoId))}
        </ScrollView>
      </View>
      <InfoDialog
        visible={layerInfoData != null}
        onClose={() => setLayerInfoId(null)}
        title={layerInfoData?.title ?? ""}
        textColor={isDark ? "#C8D6E8" : "#333"}
        backgroundColor={isDark ? "rgba(12, 18, 42, 0.98)" : "rgba(255,255,255,0.99)"}
        columns={2}
        sections={layerInfoData ? [
          { title: "Referenz", body: layerInfoData.referenz },
          { title: "Definition", body: layerInfoData.definition },
          { title: "Abstandsregel", body: layerInfoData.abstandsregel },
          { title: "Betriebsvoraussetzung", body: layerInfoData.betriebsvoraussetzung },
        ] : []}
        testID="layer-info-dialog"
      >
        {layerInfoData ? (
          <>
            {layerInfoData.hinweis ? (
              <View style={[styles.layerInfoHinweisBox, { backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.4)" }]}>
                <Text style={[styles.layerInfoText, { color: isDark ? "#F5D080" : "#92400E" }]}>{layerInfoData.hinweis}</Text>
              </View>
            ) : null}

            {layerInfoData.links && layerInfoData.links.length > 0 ? (
              <View style={{ marginTop: 14 }}>
                {layerInfoData.links.map((link, li) => (
                  <Pressable
                    key={li}
                    onPress={() => { WebBrowser.openBrowserAsync(link.url).catch(() => {}); }}
                    style={styles.layerInfoLink}
                  >
                    <Feather name="external-link" size={12} color={theme.primary} />
                    <Text style={[styles.layerInfoLinkText, { color: theme.primary }]}>{link.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {(() => {
              const modalContacts = layerInfoId ? getContactsForZone(layerInfoId, undefined, detectedCountryIso) : (layerInfoData.contacts || []);
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
          </>
        ) : null}
      </InfoDialog>
    </Modal>
  );

  if (!hasLiveTraffic) {
    return (
      <ThemedView style={styles.container}>
        <View style={{ paddingTop: safeTop + Spacing.xl }}>
          <FeatureLockCard featureKey="live_traffic" />
        </View>
      </ThemedView>
    );
  }

  if (showLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerState, { paddingTop: insets.top + Spacing.xl }]}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  if (showPermRequest) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerState, { paddingTop: safeTop + Spacing.xl }]}>
          <View style={[styles.permIcon, { backgroundColor: theme.primary + "15" }]}>
            <Feather name="map-pin" size={48} color={theme.primary} />
          </View>
          <ThemedText style={styles.permTitle}>Standort erforderlich</ThemedText>
          <ThemedText style={[styles.permText, { color: theme.textSecondary }]}>
            Um Flugzeuge in deiner Nähe anzuzeigen, wird der GPS-Standort benötigt.
          </ThemedText>
          <Pressable
            onPress={requestPermission}
            style={[styles.permButton, { backgroundColor: theme.primary }]}
          >
            <ThemedText style={styles.permButtonText}>Standort freigeben</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  if (showLocLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerState, { paddingTop: safeTop + Spacing.xl }]}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.permTitle, { marginTop: Spacing.lg }]}>Standort wird ermittelt...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (showLocError) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerState, { paddingTop: safeTop + Spacing.xl }]}>
          <Feather name="map-pin" size={48} color={theme.statusNoGo} />
          <ThemedText style={[styles.permTitle, { marginTop: Spacing.lg }]}>Standort nicht verfügbar</ThemedText>
          <ThemedText style={[styles.permText, { color: theme.textSecondary }]}>
            {locationError || "GPS-Standort konnte nicht ermittelt werden"}
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (viewMode === "map") {
    return (
      <ThemedView style={styles.container}>
        <View style={{ flex: 1, marginBottom: tabBarHeight }}>
          <View ref={mapContainerRef} collapsable={false} style={{ flex: 1 }}>
            <TrafficMapView
              latitude={mapLatitude}
              longitude={mapLongitude}
              latDelta={mapLatDelta}
              lonDelta={mapLonDelta}
              hideUserPosition={!hasRealPosition}
              locationName={locationName}
              markers={showTraffic ? mapMarkers : []}
              trails={[]}
              fullScreen
              alarmRadiusM={(alarmSettings.ra?.radiusKm ?? 1) * 1000}
              taRadiusM={(alarmSettings.ta?.radiusKm ?? 3) * 1000}
              scanRadiusM={showRadar ? radiusKm * 1000 : 0}
              onLongPress={handleMapLongPress}
              wind={showWindsock ? wind : null}
              sourceStatus={sourceStatus}
              geozoneLayers={showGeozones ? activeGeozoneLayers : []}
              countryIso={detectedCountryIso}
              highlightedZones={showGeozones ? sidePanelGeozones : []}
              additionalGeozones={showGeozones ? supplementalWindZones : []}
              energyInfrastructure={radarEnergyInfrastructure}
              windRestrictionPoints={windFacility100mPoints}
              energyTilesEnabled={showEnergyInfrastructure || (showGeozones && energyCountry?.iso === "DE")}
              energyTilesShowSupplemental={showEnergyInfrastructure}
              maxReachableAltitudeM={maxReachableAltitudeM}
              showAllGeozones={showAllGeozones}
              mapStyle={mapStyle}
              onCenterGps={handleCenterOnGps}
              onSettingsPress={() => { setShowMapConfig(!showMapConfig); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              settingsActive={showMapConfig}
              bottomPadding={showWeatherOverlay && sidePanelForecasts.length > 0 ? 290 : 0}
              infoBubbleBottomInset={(activeAlerts.length > 0 || clearOfConflict) ? 96 : 0}
              topInset={safeTop}
              weatherAlerts={mapWeatherAlerts}
              onHeadingChange={handleHeadingChange}
              onViewportChange={handleViewportChange}
              disableGeozoneQuery
            />
          </View>
          <View pointerEvents="box-none" style={{
            position: "absolute",
            top: safeTop + 8,
            alignSelf: "center",
            left: 0, right: 0,
            alignItems: "center",
            zIndex: 110,
          }}>
            <SourceHealthIndicator isDark={isDark} testID="radar-source-health" />
          </View>
          {noPositionHint ? (
            <View pointerEvents="box-none" style={{ position: "absolute", top: safeTop + 40, left: 0, right: 0, alignItems: "center", zIndex: 109 }}>
              <Pressable
                testID="radar-no-position-hint"
                onPress={needsLocationPermission ? requestPermission : handleCenterOnGps}
                accessibilityRole="button"
                accessibilityLabel={`${noPositionHint}. ${needsLocationPermission ? "Antippen gibt den Standort frei." : "Antippen versucht es erneut."}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: isDark ? "rgba(20,24,31,0.78)" : "rgba(255,255,255,0.88)" }}
              >
                <Feather name={needsLocationPermission ? "lock" : "map-pin"} size={11} color={theme.textSecondary} />
                <Text style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>
                  {noPositionHint}{needsLocationPermission ? " · Freigeben" : ""}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {nearbyCtr.length > 0 ? (
            <View style={{ position: "absolute", bottom: tabBarHeight + 16, right: 64 /* links neben den Reitern rechts */, zIndex: 105, alignItems: "flex-end" }}>
              <View style={{
                marginBottom: 6,
                backgroundColor: isDark ? "rgba(30,10,10,0.92)" : "rgba(255,240,240,0.96)",
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
                borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,59,48,0.5)",
              }}>
                <Text style={{ fontSize: 9, fontWeight: "700", color: "#FF3B30", textAlign: "center" }}>
                  TOWER {nearbyCtr[0].icao}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  // Immer die Nummer sichtbar zeigen (kein stilles Scheitern ohne Telefon-App)
                  setShowCtrEmergency(true);
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  setShowCtrEmergency(true);
                }}
                style={{
                  width: 56, height: 56, borderRadius: 28,
                  backgroundColor: "#FF3B30",
                  alignItems: "center", justifyContent: "center",
                  shadowColor: "#FF3B30", shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
                  elevation: 8,
                }}
                testID="radar-ctr-emergency-btn"
              >
                <Feather name="phone" size={24} color="#fff" />
              </Pressable>
            </View>
          ) : null}
          {showCtrEmergency ? (
            <Modal transparent animationType="slide" visible={showCtrEmergency} onRequestClose={() => setShowCtrEmergency(false)}>
              <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} onPress={() => setShowCtrEmergency(false)}>
                <Pressable onPress={() => {}} style={{
                  backgroundColor: isDark ? "#1a1a2e" : "#fff",
                  borderTopLeftRadius: 20, borderTopRightRadius: 20,
                  paddingTop: 16, paddingHorizontal: 16, paddingBottom: insets.bottom + 20,
                  maxHeight: "70%",
                }}>
                  <View style={{ alignItems: "center", marginBottom: 12 }}>
                    <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)" }} />
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "#FF3B30", alignItems: "center", justifyContent: "center" }}>
                      <Feather name="navigation" size={18} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 17, fontWeight: "700", color: isDark ? "#fff" : "#000" }}>Kontrollzone – Tower-Notfallkontakt</Text>
                      <Text style={{ fontSize: 12, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", marginTop: 2 }}>
                        Außer Kontrolle geratenes UAS sofort melden!
                      </Text>
                    </View>
                  </View>
                  <ScrollView style={{ maxHeight: 400 }}>
                    {nearbyCtr.map((ctr) => (
                      <View key={ctr.icao} style={{
                        flexDirection: "row", alignItems: "center",
                        paddingVertical: 14, paddingHorizontal: 12,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                      }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: "600", color: isDark ? "#fff" : "#000" }}>{ctr.name}</Text>
                          <Text style={{ fontSize: 12, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", marginTop: 2 }}>
                            {ctr.icao} – {getCtrCategoryLabel(ctr.category)}
                          </Text>
                          {ctr.avInfo ? (
                            <Text style={{ fontSize: 11, color: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)", marginTop: 2 }}>
                              AV: {ctr.avInfo.nflReference} ({ctr.avInfo.provider})
                            </Text>
                          ) : null}
                          {ctr.towerFrequency ? (
                            <Text style={{ fontSize: 11, color: isDark ? "rgba(130,200,255,0.7)" : "#007AFF", marginTop: 2 }}>
                              TWR: {ctr.towerFrequency} MHz
                            </Text>
                          ) : null}
                          {ctr.note ? (
                            <Text style={{ fontSize: 11, color: isDark ? "rgba(255,180,100,0.7)" : "#FF9500", marginTop: 2 }}>{ctr.note}</Text>
                          ) : null}
                          <Text selectable testID={`radar-ctr-phone-${ctr.icao}`} style={{ fontSize: 22, fontWeight: "800", letterSpacing: 0.5, color: isDark ? "#fff" : "#000", marginTop: 6 }}>
                            {ctr.towerPhone}
                          </Text>
                        </View>
                        {/* QR-Code zum Anrufen mit dem eigenen Handy (die Fernsteuerung kann nicht telefonieren) */}
                        <View testID={`radar-ctr-qr-${ctr.icao}`} style={{ alignItems: "center", marginLeft: 12, padding: 8, backgroundColor: "#fff", borderRadius: 10 }}>
                          <QRCode value={`tel:${ctr.towerPhone.replace(/[^\d+]/g, "")}`} size={132} backgroundColor="#fff" color="#000" />
                          <Text style={{ fontSize: 10, color: "#333", marginTop: 4 }}>Mit dem Handy scannen</Text>
                        </View>
                        {canCallPhone ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Anrufen ${ctr.towerPhone}`}
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            openLink(`tel:${ctr.towerPhone.replace(/\s/g, "")}`).catch(() => {
                              Alert.alert(`Tower ${ctr.icao}`, `Anruf nicht möglich. Nummer: ${ctr.towerPhone}`);
                            });
                          }}
                          style={{
                            width: 52, height: 52, borderRadius: 26,
                            backgroundColor: "#FF3B30",
                            alignItems: "center", justifyContent: "center",
                            shadowColor: "#FF3B30", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
                          }}
                          testID={`radar-ctr-call-${ctr.icao}`}
                        >
                          <Feather name="phone" size={22} color="#fff" />
                        </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </ScrollView>
                  <Pressable
                    onPress={() => setShowCtrEmergency(false)}
                    style={{
                      marginTop: 12, paddingVertical: 14,
                      backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
                      borderRadius: 12, alignItems: "center",
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: "600", color: isDark ? "#fff" : "#000" }}>Schließen</Text>
                  </Pressable>
                </Pressable>
              </Pressable>
            </Modal>
          ) : null}
          {showWeatherOverlay ? (
            sidePanelForecasts.length > 0 ? (
              <BottomWeatherOverlay
                forecasts={sidePanelForecasts}
                kpIndex={sidePanelKp}
                isDark={isDark}
                latitude={latitude}
                longitude={longitude}
                onForecastsUpdate={(fc, kp) => {
                  setSidePanelForecasts(fc);
                  if (fc[0]) setSidePanelWeather(fc[0]);
                  setSidePanelKp(kp);
                }}
              />
            ) : (
              <View style={{
                position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 90,
                backgroundColor: isDark ? "rgba(10, 16, 32, 0.92)" : "rgba(240, 245, 252, 0.95)",
                borderTopWidth: 1, borderTopColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
                padding: 12, alignItems: "center",
              }}>
                <Text style={{ fontSize: 11, color: isDark ? "rgba(160,180,210,0.7)" : "rgba(80,80,100,0.6)" }}>Lade Wetterdaten...</Text>
              </View>
            )
          ) : null}
          <AlarmPulseProvider alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict}>
            <ProximityAlarmGlow alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict} bearingToThreat={activeAlerts.length > 0 && latitude != null && longitude != null ? ((bearingTo(latitude, longitude, activeAlerts[0].aircraft.latitude, activeAlerts[0].aircraft.longitude) - (deviceHeading ?? 0) + 360) % 360) : undefined} />
            <ProximityAlarmBanner alerts={activeAlerts} alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict} maxAltitudeM={alarmSettings.maxAltitudeM} onDismiss={dismissAlarm} />
          </AlarmPulseProvider>
          <SideTabs activePanel={sidePanel} onPress={openSidePanel} isDark={isDark} safeTop={safeTop} alertFlags={alertFlags} weatherStatus={weatherStatus} hideWetter={showWeatherOverlay} geozoneSeverity={geozoneSeverity} hasNotams={sidePanelNotams.length > 0 || sidePanelTempRestrictions.length > 0 || sidePanelDipulRestrictions.length > 0} radarAlarmLevel={alarmLevel} hasLowAltTraffic={lowAltitudeCount > 0} hideRadar={!showRadar} />
          {sidePanel ? (
            <SidePanelView
              panel={sidePanel}
              loading={sidePanel === "radar" ? false : sidePanelLoading}
              geozones={displayedGeozones}
              geozoneDataStatus={geozoneDataStatus}
              isZoneSerious={isZoneSeriousProhibition}
              tempRestrictions={sidePanelTempRestrictions}
              dipulRestrictions={sidePanelDipulRestrictions}
              notams={sidePanelNotams}
              notamStatusUnknown={sidePanelNotamUnknown}
              standLines={[
                ...(sidePanel === "wetter"
                  ? [formatSourceStand("weather", sidePanelWeatherOrigin), formatSourceStand("kp", sidePanelKp?.offline ?? null)]
                  : sidePanel === "notam"
                    ? [formatSourceStand("notam", sidePanelNotamOrigin)]
                    : []),
                ...(sidePanel === "geozone"
                  ? geozoneReval.pendingWifi.map((iso) => ({ text: `${iso}: Neue Geozonen-Fassung verfügbar – wird im WLAN geladen`, tone: "offline" as const }))
                  : []),
              ].filter((x): x is { text: string; tone: StandTone } => !!x)}
              onRefreshStand={sidePanel === "geozone" ? () => { geozoneReval.refreshNow().catch(() => {}); } : undefined}
              refreshingStand={geozoneReval.refreshing}
              weather={sidePanelWeather}
              forecasts={sidePanelForecasts}
              kpIndex={sidePanelKp}
              kpTimeline={sidePanelKpTimeline}
              wind={wind}
              isDark={isDark}
              safeTop={safeTop}
              onClose={() => setSidePanel(null)}
              weatherStatus={weatherStatus}
              latitude={latitude}
              longitude={longitude}
              countryIso={detectedCountryIso}
              radarData={{
                locationName: locationName,
                isCustomLocation: isCustomLocation,
                radiusKm: radiusKm,
                aircraftCount: aircraft.length,
                lowAltCount: lowAltitudeCount,
                inAirCount: inAirCount,
                lastUpdate: lastUpdate,
                sourceStatus: sourceStatus,
                pilotElevation: pilotElevation,
                onRadiusChange: (r: number) => { setRadiusKm(r); saveRadarSettings({ radiusKm: r }); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} },
                onRefresh: handleManualRefresh,
                onResetLocation: handleResetLocation,
              }}
            />
          ) : null}
          {showMapConfig ? (
            <Pressable
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 115 }}
              onPress={() => setShowMapConfig(false)}
            />
          ) : null}
          {showMapConfig ? (
            <MapConfigPopup
              mapStyle={mapStyle}
              showRadar={showRadar}
              showWindsock={showWindsock}
              showGeozones={showGeozones}
              showTraffic={showTraffic}
              showEnergyInfrastructure={showEnergyInfrastructure}
              energyComparisonAvailable={!!energyCountry?.hasComparableOfficialAssetLayers}
              energyInfrastructureStatus={energyInfrastructureStatus}
              onToggleRadar={() => setShowRadar((v) => { const n = !v; saveRadarSettings({ showRadar: n }); return n; })}
              onToggleWindsock={() => setShowWindsock((v) => { const n = !v; saveRadarSettings({ showWindsock: n }); return n; })}
              onToggleGeozones={() => setShowGeozones((v) => { const n = !v; saveRadarSettings({ showGeozones: n }); return n; })}
              onToggleTraffic={() => setShowTraffic((v) => { const n = !v; saveRadarSettings({ showTraffic: n }); return n; })}
              onToggleEnergyInfrastructure={() => setShowEnergyInfrastructure((v) => { const n = !v; saveRadarSettings({ showEnergyInfrastructure: n }); return n; })}
              showWeatherOverlay={showWeatherOverlay}
              onToggleWeatherOverlay={() => setShowWeatherOverlay((v) => { const n = !v; saveRadarSettings({ showWeatherOverlay: n }); return n; })}
              showAllGeozones={showAllGeozones}
              onToggleShowAllGeozones={() => setShowAllGeozones((v) => { const n = !v; saveRadarSettings({ showAllGeozones: n }); return n; })}
              onOpenGeozoneDetail={() => { setShowGeozoneModal(true); setShowMapConfig(false); }}
              onMapStyleChange={(s) => { setMapStyle(s); saveMapStyle(s); }}
              weatherOverlayVisible={showWeatherOverlay && sidePanelForecasts.length > 0}
            />
          ) : null}
        </View>
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
          paddingTop: safeTop + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.lg,
        }}
        ListHeaderComponent={listHeaderContent}
        ListEmptyComponent={emptyListContent}
      />
      {geozoneModal}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.xl },
  permIcon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginBottom: Spacing.lg },
  permTitle: { ...Typography.h3, textAlign: "center" },
  permText: { ...Typography.body, textAlign: "center", marginTop: Spacing.sm, marginBottom: Spacing.xl, paddingHorizontal: Spacing.lg },
  permButton: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: BorderRadius.md },
  permButtonText: { ...Typography.body, fontWeight: "600", color: "#FFFFFF" },
  headerSection: { marginBottom: Spacing.lg },
  locationCard: { padding: Spacing.lg, marginBottom: Spacing.md },
  locationRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  locationTitle: { ...Typography.callout, fontWeight: "600" },
  locationSub: { ...Typography.caption, marginTop: 2 },
  locationHint: { ...Typography.caption, fontSize: 9, marginTop: Spacing.xs, textAlign: "center" },
  refreshBtn: { padding: Spacing.sm },
  toggleRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  toggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  toggleBtnText: { ...Typography.small, fontWeight: "600" },
  radiusRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginBottom: Spacing.md },
  radiusChip: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: BorderRadius.sm },
  radiusChipText: { ...Typography.caption, fontWeight: "700", fontSize: 12 },
  radiusUnit: { ...Typography.caption, fontSize: 10, marginLeft: 2 },
  statsRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.md },
  statCard: { flex: 1, alignItems: "center", paddingVertical: Spacing.md, borderRadius: BorderRadius.md },
  statValue: { ...Typography.h3, fontWeight: "700" },
  statLabel: { ...Typography.caption, fontSize: 10, marginTop: 2 },
  updateText: { ...Typography.caption, textAlign: "center", marginBottom: Spacing.sm },
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
  agencyBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  agencyBadgeText: { ...Typography.caption, fontSize: 10, fontWeight: "700", color: "#FFFFFF" },
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
  geozoneModalFull: { flex: 1, paddingTop: 60, paddingHorizontal: Spacing.lg },
  geozoneModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg, marginBottom: Spacing.xs },
  geozoneModalTitle: { ...Typography.h3, fontWeight: "700" },
  geozoneModalSubtitle: { ...Typography.caption, paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  geozoneToggleAllRow: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  geozoneToggleAllBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, alignSelf: "flex-start" },
  geozoneToggleAllText: { fontSize: 14, fontWeight: "600" },
  geozoneModalList: { paddingHorizontal: Spacing.lg },
  geozoneLayerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  geozoneCheck: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  geozoneLayerLabel: { ...Typography.body, flex: 1 },
  geozoneLayerInfoBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  layerInfoSectionLabel: { fontSize: 13, fontWeight: "700", marginTop: 12, marginBottom: 4 },
  layerInfoText: { fontSize: 13, lineHeight: 20 },
  layerInfoHinweisBox: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1 },
  layerInfoLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  layerInfoLinkText: { fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
  layerInfoContactRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 7, paddingHorizontal: 4, borderRadius: 8, marginBottom: 2 },
  layerInfoContactLabel: { fontSize: 12, fontWeight: "500", lineHeight: 16 },
  layerInfoContactValue: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
});

const panelStyles = StyleSheet.create({
  overlayContainer: {
    position: "absolute",
    left: 8,
    right: 8,
    zIndex: 100,
  },
  compactBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  compactBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  compactBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  compactLocationText: {
    ...Typography.caption,
    fontWeight: "600",
    maxWidth: 140,
  },
  compactRadiusText: {
    ...Typography.caption,
    fontSize: 10,
  },
  compactStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  compactStatText: {
    ...Typography.caption,
    fontSize: 11,
    fontWeight: "700",
  },
  compactIconBtn: {
    padding: 4,
    borderRadius: 8,
  },
  expandedPanel: {
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  expandedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  expandedLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  expandedLocationText: {
    ...Typography.callout,
    fontWeight: "600",
    flexShrink: 1,
  },
  expandedLocationSub: {
    ...Typography.caption,
    fontSize: 10,
    marginTop: 1,
    marginLeft: 20,
  },
  hintText: {
    ...Typography.caption,
    fontSize: 10,
    textAlign: "center",
  },
  mapFabColumn: {
    position: "absolute",
    right: 12,
    gap: 8,
    zIndex: 110,
    alignItems: "center",
  },
  mapFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: { elevation: 6 },
    }),
  },
  configPopup: {
    position: "absolute",
    left: 12,
    zIndex: 120,
    backgroundColor: "rgba(20, 28, 48, 0.95)",
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 2,
    minWidth: 200,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
      },
      android: { elevation: 10 },
    }),
  },
  configRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  configCheck: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "rgba(120, 140, 180, 0.4)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  configCheckActive: {
    backgroundColor: "#F59E0B",
    borderColor: "#F59E0B",
  },
  configLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(180, 200, 230, 0.9)",
    letterSpacing: 0.2,
  },
  mapSegmented: {
    flexDirection: "row",
    borderRadius: 10,
    marginHorizontal: 10,
    marginBottom: 4,
    padding: 3,
    gap: 3,
  },
  mapSegBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
  },
  mapSegBtnActive: {
    backgroundColor: "#4A90D9",
    ...Platform.select({
      ios: {
        shadowColor: "#4A90D9",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
    }),
  },
  mapSegLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  configSectionTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  configDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
    marginVertical: 6,
  },
  geozoneRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
});

function windDirectionArrow(deg: number): string {
  const arrows = ["\u2193", "\u2199", "\u2190", "\u2196", "\u2191", "\u2197", "\u2192", "\u2198"];
  return arrows[Math.round(deg / 45) % 8] || "\u2193";
}

function SideTabs({ activePanel, onPress, isDark, safeTop, alertFlags, weatherStatus, hideWetter, geozoneSeverity, hasNotams, radarAlarmLevel, hasLowAltTraffic, hideRadar }: {
  activePanel: "geozone" | "notam" | "wetter" | "radar" | null;
  onPress: (p: "geozone" | "notam" | "wetter" | "radar") => void;
  isDark: boolean;
  safeTop: number;
  alertFlags: { wetter: boolean; notam: boolean; geozone: boolean };
  weatherStatus: "unknown" | "ok" | "caution" | "critical";
  hideWetter?: boolean;
  geozoneSeverity?: GeozoneTabSeverity;
  hasNotams?: boolean;
  radarAlarmLevel?: "none" | "warning" | "critical";
  hasLowAltTraffic?: boolean;
  hideRadar?: boolean;
}) {
  const tabs: { id: "geozone" | "notam" | "wetter" | "radar"; label: string }[] = [
    { id: "geozone", label: "Geozone" },
    { id: "notam", label: "NOTAM" },
    { id: "wetter", label: "Wetter" },
    { id: "radar", label: "Radar" },
  ];
  const hasOpenPanel = activePanel != null;

  function getTabStatus(id: string): { bg: string; shouldPulse: boolean; pulseColor?: string; textWhite: boolean } {
    const greenColor = "#22C55E";
    const orangeColor = "#FF9500";
    const redColor = "#FF3B30";
    const defaultBg = isDark ? "rgba(20, 30, 55, 0.88)" : "rgba(255, 255, 255, 0.92)";

    if (id === "geozone") {
      // Schweregrad: rot (Flugverbot ohne AV) > orange (Höhenlimit / AV-gedeckt)
      // > blau (Zone vorhanden, nicht aktiv) > grün (keine Zone).
      if (geozoneSeverity === "red") return { bg: redColor, shouldPulse: false, textWhite: true };
      if (geozoneSeverity === "orange") return { bg: orangeColor, shouldPulse: false, textWhite: true };
      if (geozoneSeverity === "blue") return { bg: "#4A90D9", shouldPulse: false, textWhite: true };
      if (geozoneSeverity === "unknown") return { bg: defaultBg, shouldPulse: false, textWhite: false };
      return { bg: greenColor, shouldPulse: false, textWhite: true };
    }
    if (id === "notam") {
      if (hasNotams) return { bg: orangeColor, shouldPulse: false, textWhite: true };
      return { bg: greenColor, shouldPulse: false, textWhite: true };
    }
    if (id === "wetter") {
      if (weatherStatus === "critical") return { bg: redColor, shouldPulse: false, textWhite: true };
      if (weatherStatus === "caution") return { bg: orangeColor, shouldPulse: false, textWhite: true };
      if (weatherStatus === "ok") return { bg: greenColor, shouldPulse: false, textWhite: true };
      return { bg: defaultBg, shouldPulse: false, textWhite: false };
    }
    if (id === "radar") {
      if (radarAlarmLevel === "critical") return { bg: redColor, shouldPulse: true, pulseColor: redColor, textWhite: true };
      if (radarAlarmLevel === "warning") return { bg: orangeColor, shouldPulse: true, pulseColor: orangeColor, textWhite: true };
      if (hasLowAltTraffic) return { bg: orangeColor, shouldPulse: false, textWhite: true };
      return { bg: defaultBg, shouldPulse: false, textWhite: false };
    }
    return { bg: defaultBg, shouldPulse: false, textWhite: false };
  }

  // Darstellung über die gemeinsame Reiter-Leiste (auch Gebietsübersicht der Flugplanung).
  const railTabs: SideTab<"geozone" | "notam" | "wetter" | "radar">[] = tabs.map((t) => {
    const status = getTabStatus(t.id);
    const pulsing = t.id === "radar" && status.shouldPulse;
    return {
      id: t.id,
      label: t.label,
      bg: pulsing ? "transparent" : status.bg,
      textWhite: status.textWhite,
      background: status.shouldPulse ? <PulsingTabBg color={status.pulseColor!} /> : undefined,
      hidden: (t.id === "wetter" && hideWetter) || (t.id === "radar" && hideRadar),
    };
  });
  return (
    <SideTabRail
      tabs={railTabs}
      activeId={hasOpenPanel ? activePanel : null}
      isDark={isDark}
      top={safeTop + 8}
      onPress={(id) => { onPress(id); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}
    />
  );
}

function PulsingTabBg({ color }: { color: string }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: false }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: pulseAnim, borderTopLeftRadius: 8, borderBottomLeftRadius: 8 }]} />;
}

const PANEL_INFO: Record<string, { title: string; text: string; sourceText?: string }> = {
  geozone: {
    title: "Geozonen und Lufträume",
    text: "Geozonen sind geografische Gebiete, in denen Vorschriften und Einschränkungen für den Betrieb von Drohnen gelten.\n\nIn dieser Ansicht werden Geozonen angezeigt, die Ihren Flugbereich (RA-Radius) berühren.\n\nBitte informieren Sie sich über die geltenden Rechtsvorschriften und holen Sie gegebenenfalls erforderliche Genehmigungen ein, wenn Sie innerhalb einer Geozone oder eines beschränkten Luftraums fliegen möchten.\n\nWeitere Informationen unter dipul.de",
    sourceText: "Die Daten stammen vom dipul WMS-Dienst des DFS.",
  },
  notam: {
    title: "NOTAMs & Temporäre Einschränkungen",
    text: "NOTAMs (Notice to Airmen) sind offizielle Mitteilungen über besondere Änderungen, Einschränkungen oder Gefahren im Luftraum.\n\nAls Luftverkehrsteilnehmer sind Sie verpflichtet, sich vor jedem Flug über die für Ihr Gebiet relevanten NOTAMs zu informieren.\n\nZusätzlich werden temporäre Betriebseinschränkungen angezeigt (z.B. bei Großveranstaltungen, Staatsbesuchen oder besonderen Sicherheitslagen).\n\nWichtig: Zeitangaben in NOTAMs basieren auf der koordinierten Weltzeit (UTC).\n\nHäufige Begriffe:\n- AGL: Above Ground Level — Höhe über Grund\n- AMSL: Above Mean Sea Level — Höhe über dem mittleren Meeresspiegel\n- SFC: Surface — Ab der Erdoberfläche\n- FL: Flight Level — Standardisierte Höhenangabe (1013,25 hPa)",
    sourceText: "Die NOTAM-Daten stammen von autorouter.aero (Eurocontrol EAD). Temporäre Betriebseinschränkungen stammen vom dipul WMS-Dienst des DFS.",
  },
  wetter: {
    title: "Wetterdaten",
    text: "Angezeigt werden Temperatur in 6 Höhen (2/50/100/150/200/250m AGL), Wind in 6 Höhen (10/50/100/150/200/250m AGL), Böen, Windrichtung, Wolkenbedeckung, Niederschlag, Luftfeuchtigkeit, QNH und Sichtweite.\n\nDer Kp-Index zeigt die geomagnetische Aktivität: 0–2 grün, 3–4 gelb, 5 orange, ab 6 rot. Ab Kp 5 können GNSS- und Kompassstörungen auftreten, müssen am Standort aber nicht. Der globale Index sagt nicht sicher voraus, wie sich die Signale am einzelnen Gerät auswirken.\n\nRot/Orange markierte Wetterwerte überschreiten Grenzwerte oder bilden gefährliche Kombinationen:\n- Bodenwind > 10 m/s (rot) / > 7 m/s (orange)\n- Böen > 12 m/s (rot) / > 9 m/s (orange)\n- Höhenwind > 12 m/s (rot) / > 8 m/s (orange)\n- Regen > 0.5 mm/h (rot) / > 0.1 mm/h (orange)\n- Temperatur < -5°C (rot) / < 0°C (orange)\n- Vereisungs-Kombi: T<0°C + rF>=80% (rot) / T<=5°C + rF>=90% (orange)\n- Sicht < 500m (rot) / < 1000m (orange)\n\nBewölkung & Feuchte allein werden nicht mehr highlightet — nur in der Vereisungs-/Beschlagskombination mit der Temperatur.",
    sourceText: "Die Wetterdaten stammen vom DFS dipul Weather Service (ICON-D2 Modell, 2km Raster). Der KP-Index stammt von NOAA SWPC.",
  },
  radar: {
    title: "Live Radar",
    text: "Der Live Radar zeigt Flugzeuge in Ihrer Nähe in Echtzeit an.\n\nTiefflüge (< 500m) werden orange hervorgehoben.\n\nLange auf die Karte drücken, um den Radar-Standort manuell zu setzen.",
    sourceText: "Die Daten werden aus 6 Quellen zusammengeführt:\n- OpenSky Network\n- adsb.fi\n- adsb.one\n- airplanes.live\n- adsb.lol\n- OGN (Open Glider Network)\n\nOGN liefert Positionen von Segelflugzeugen, Ultraleichtflugzeugen, Ballonen und anderen Luftfahrzeugen mit FLARM-Transponder.\n\nDie Farbpunkte zeigen den Status jeder Quelle (grün = aktiv).",
  },
};

function getRegInfoForLayer(layerLabel: string): GeozoneRegulatoryInfo | null {
  const allLayers = [...GEOZONE_LAYERS, ...getCountryGeozoneLayers("CH"), ...getCountryGeozoneLayers("LU"), ...getCountryGeozoneLayers("NL"), ...getCountryGeozoneLayers("FR")];
  const layer = allLayers.find((l) => l.label === layerLabel);
  if (layer && GEOZONE_REGULATORY_INFO[layer.id]) return GEOZONE_REGULATORY_INFO[layer.id];
  return null;
}

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
      openLink(url).catch(() => {
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

function SidePanelView({ panel, loading, geozones, windFacilityWarnings = [], geozoneDataStatus = "loading", isZoneSerious, tempRestrictions, dipulRestrictions, notams, notamStatusUnknown = false, standLines = [], onRefreshStand, refreshingStand = false, weather, forecasts, kpIndex, kpTimeline = [], wind, isDark, safeTop, onClose, radarData, weatherStatus = "unknown", latitude: propLat, longitude: propLon, countryIso }: {
  panel: "geozone" | "notam" | "wetter" | "radar";
  loading: boolean;
  geozones: GeozoneFeatureInfo[];
  windFacilityWarnings?: Array<{ id: string; name: string; distanceMeters: number }>;
  geozoneDataStatus?: "loading" | "loaded" | "error";
  isZoneSerious?: (z: GeozoneFeatureInfo) => boolean;
  tempRestrictions: GeozoneFeatureInfo[];
  dipulRestrictions: DipulTempRestriction[];
  notams: NotamData[];
  /** NOTAM-Abfrage fehlgeschlagen: Status unbekannt statt "keine NOTAMs". */
  notamStatusUnknown?: boolean;
  /** Teil A: „Stand“-Zeilen je Quelle (Offline-Daten mit Alter). */
  standLines?: { text: string; tone: StandTone }[];
  /** Teil A: „Jetzt aktualisieren“ (Geozonen-Bestände). */
  onRefreshStand?: () => void;
  refreshingStand?: boolean;
  weather: ForecastData | null;
  forecasts: ForecastData[];
  kpIndex: KpIndexData | null;
  kpTimeline?: KpTimeEntry[];
  wind: WindData | null;
  isDark: boolean;
  safeTop: number;
  onClose: () => void;
  weatherStatus?: "unknown" | "ok" | "caution" | "critical";
  latitude?: number | null;
  longitude?: number | null;
  countryIso?: string;
  radarData?: {
    locationName: string | null;
    isCustomLocation: boolean;
    radiusKm: number;
    aircraftCount: number;
    lowAltCount: number;
    inAirCount: number;
    lastUpdate: Date | null;
    sourceStatus: { opensky: string; adsbfi: string; adsbone: string; airplaneslive: string; adsblol: string; ogn: string };
    pilotElevation: number | null;
    onRadiusChange: (r: number) => void;
    onRefresh: () => void;
    onResetLocation: () => void;
  };
}) {
  const isAdmin = useShowDataSources();
  const [showInfo, setShowInfo] = useState(false);
  const [expandedRegInfo, setExpandedRegInfo] = useState<number | null>(null);
  // Scroll-Offset der Wetter-Tabelle: nativ getrieben (kein setState pro
  // Scroll-Ereignis); das Sonnenstand-Diagramm folgt per Interpolation.
  const wetterScrollX = useRef(new Animated.Value(0)).current;
  const onWetterScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { x: wetterScrollX } } }], { useNativeDriver: true }),
    [wetterScrollX],
  );
  const panelBg = isDark ? "rgba(12, 18, 38, 0.94)" : "rgba(255, 255, 255, 0.96)";
  const textColor = isDark ? "#D0DDF0" : "#1A1A2E";
  const mutedColor = isDark ? "rgba(160,180,210,0.7)" : "rgba(80,80,100,0.6)";
  const divColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const wetterAccent = weatherStatus === "critical" ? "#FF3B30" : weatherStatus === "caution" ? "#FF9500" : "#22C55E";
  const accentColor = panel === "geozone" ? "#4A90D9" : panel === "notam" ? "#F59E0B" : panel === "radar" ? "#AF52DE" : wetterAccent;
  const info = PANEL_INFO[panel];
  // Verfügbare Höhe der Panel-Liste dynamisch berechnen: vom Panel-Oberrand
  // (safeTop + 8) bis knapp über die untere Tab-Leiste. Ersetzt den festen
  // maxHeight 500, durch den die Wetter-Tabelle (Sonnenstand-Diagramm + 19
  // Zeilen) zuvor abgeschnitten wurde und gescrollt werden musste.
  const windowH = Dimensions.get("window").height;
  const scrollMaxHeight = Math.max(320, windowH - (safeTop + 8) - 56 - 110);

  return (
    <View style={[sidePanelStyles.container, { top: safeTop + 8, backgroundColor: panelBg }]}>
      <View style={sidePanelStyles.header}>
        <Text style={[sidePanelStyles.title, { color: accentColor }]}>
          {panel === "geozone" ? "Geozonen" : panel === "notam" ? "NOTAMs / Temporär" : panel === "radar" ? "Radar" : "Wetter"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable onPress={() => setShowInfo(true)} hitSlop={8} style={[sidePanelStyles.infoBtn, { borderColor: accentColor }]}>
            <Feather name="info" size={12} color={accentColor} />
          </Pressable>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="x" size={20} color={mutedColor} />
          </Pressable>
        </View>
      </View>
      <InfoDialog
        visible={showInfo}
        onClose={() => setShowInfo(false)}
        title={info.title}
        text={info.text + adminSourceSuffix(info.sourceText, isAdmin)}
        accentColor={accentColor}
        textColor={textColor}
        backgroundColor={isDark ? "rgba(15, 22, 45, 0.97)" : "rgba(255,255,255,0.98)"}
        testID="panel-info-dialog"
      />
      <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
      {loading ? (
        <View style={sidePanelStyles.loadingWrap}>
          <ActivityIndicator size="small" color={accentColor} />
        </View>
      ) : (
        <ScrollView style={[sidePanelStyles.scrollArea, { maxHeight: scrollMaxHeight }]} showsVerticalScrollIndicator={false}>
          {standLines.length > 0 || onRefreshStand ? (
            <View style={{ marginBottom: 6, gap: 2 }} testID="radar-data-stand">
              {standLines.map((l, i) => (
                <Text
                  key={`stand-${i}`}
                  style={{ fontSize: 11, color: l.tone === "warning" ? "#FF3B30" : l.tone === "offline" ? "#FF9500" : mutedColor }}
                >
                  {l.text}
                </Text>
              ))}
              {onRefreshStand ? (
                <Pressable onPress={onRefreshStand} disabled={refreshingStand} hitSlop={6} testID="radar-refresh-now" style={{ flexDirection: "row", alignItems: "center", gap: 4, opacity: refreshingStand ? 0.6 : 1 }}>
                  <Feather name="refresh-cw" size={11} color={accentColor} />
                  <Text style={{ fontSize: 11, fontWeight: "600", color: accentColor }}>Jetzt aktualisieren</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {panel === "geozone" ? (
            geozones.length > 0 ? (
              <View style={{ gap: 6 }}>
                {windFacilityWarnings.map((facility) => (
                  <View key={`wind-buffer-${facility.id}`} style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.12)", borderLeftColor: "#FF9500" }]}>
                    <Feather name="alert-triangle" size={14} color={isDark ? "#FFCC80" : "#CC7A00"} />
                    <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFCC80" : "#CC7A00" }]}>
                      {facility.name}: {Math.round(facility.distanceMeters)} m entfernt. Der 100-m-Prüfkreis liegt im Radarbereich. Innerhalb dieses Abstands ist, sofern § 21h Abs. 3 Nr. 3 LuftVO gilt, ausdrückliche Zustimmung erforderlich.
                    </Text>
                  </View>
                ))}
                {(() => {
                  // Radar: Zeitbezug JETZT (eine Aktivitätsprüfung, zoneActivityAt).
                  const nowDate = new Date();
                  const isZoneInactiveNow = (z: GeozoneFeatureInfo) => !isGeozoneActiveForRadar(z, nowDate);
                  const activeZones = geozones.filter((z) => !z.informationalOnly && !isZoneInactiveNow(z));
                  const futureZones = geozones.filter((z) => isZoneInactiveNow(z));
                  return (
                    <>
                      {activeZones.length > 0 ? (
                        <View style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,59,48,0.15)" : "rgba(255,59,48,0.12)" }]}>
                          <Feather name="alert-circle" size={14} color={isDark ? "#FFFFFF" : "#CC2D25"} />
                          <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFFFFF" : "#CC2D25" }]}>
                            {activeZones.length} Geozone{activeZones.length !== 1 ? "n" : ""} im Flugbereich — Regeln beachten
                          </Text>
                        </View>
                      ) : null}
                      {futureZones.length > 0 ? (
                        <View style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(74,144,217,0.15)" : "rgba(74,144,217,0.1)" }]}>
                          <Feather name="info" size={14} color={isDark ? "#8AB4F8" : "#4A90D9"} />
                          <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#8AB4F8" : "#4A90D9" }]}>
                            {futureZones.length} geplante/zeitgesteuerte Zone{futureZones.length !== 1 ? "n" : ""} — derzeit nicht aktiv
                          </Text>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
                {(() => {
                  // Schwerwiegende (aktive, nicht AV-gedeckte) Flugverbots-/
                  // Sperrzonen nach oben sortieren. Partitionierung statt sort()
                  // erhält die relative Reihenfolge beider Gruppen (stabil).
                  const sortedGeozones = isZoneSerious
                    ? [
                        ...geozones.filter((z) => isZoneSerious(z)),
                        ...geozones.filter((z) => !isZoneSerious(z)),
                      ]
                    : geozones;
                  const detectedBl =
                    propLat != null && propLon != null
                      ? detectBundeslandFromCoordinates(propLat, propLon)
                      : null;
                  return sortedGeozones.map((z, i) => {
                  const details = filterGeozoneDetailLines(z.details, isAdmin || z.featureId?.startsWith("energy-zone:") === true);
                  const badgeLabel = geozoneBadgeLabel(z.layerLabel, isAdmin, Object.values(ED269_SOURCE_LABELS));
                  const regInfo = z.informationalOnly ? null : getRegInfoForLayer(z.layerLabel);
                  const isExpanded = expandedRegInfo === i;
                  // Radar: jetzt inaktive (geplante/zeitgesteuerte) Zone –
                  // dieselbe Prüfung wie Reiter-Farbe und Karte.
                  const zIsFuture = !isGeozoneActiveForRadar(z);
                  // Rote Hervorhebung = Reiterfarbe rot (Policy: ungedeckte Zone mit
                  // Schwere ≥ 3). Geplante/inaktive Zonen sind nie schwerwiegend.
                  const zIsSerious = !zIsFuture && (isZoneSerious?.(z) ?? false);
                  // Farbe/Label kommen aus der Policy-Tabelle – dieselbe Farbe wie
                  // Karte und Planungsliste.
                  const zRestriction = zoneRestriction(z);
                  const zPolicy = RESTRICTION_POLICY[zRestriction];
                  const zShowPolicyBadge = !zIsFuture && !z.informationalOnly;
                  // Aktive genehmigungspflichtige § 21h-Zone, die NICHT rot ist ->
                  // durch eine gültige Allgemeinverfügung des Piloten gedeckt.
                  const z21hRule = !z.informationalOnly ? de21hRule(z) : null;
                  const zAvCovered =
                    !zIsFuture && !zIsSerious && zRestriction === "REQ_AUTHORISATION" && z21hRule?.avEligible === true;
                  const policyColor = zPolicy.color;
                  const cardBorderColor = zIsFuture
                    ? (isDark ? "rgba(142,142,147,0.3)" : "rgba(142,142,147,0.25)")
                    : z.informationalOnly
                    ? (isDark ? "rgba(74,144,217,0.4)" : "rgba(74,144,217,0.3)")
                    : `${policyColor}${zIsSerious ? "D9" : "99"}`;
                  const badgeColor = zIsFuture ? "#8E8E93" : z.informationalOnly ? "#4A90D9" : policyColor;
                  const cardBg = zIsSerious ? `${policyColor}14` : undefined;
                  return (
                    <View key={`${z.layerLabel}-${z.name}-${i}`} style={[sidePanelStyles.geozoneCard, { borderColor: cardBorderColor, borderWidth: zIsSerious ? 1.5 : StyleSheet.hairlineWidth, backgroundColor: cardBg, opacity: zIsFuture ? 0.75 : 1 }]}>
                      <View style={sidePanelStyles.geozoneHeader}>
                        <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: badgeColor }]}>
                          <Text style={sidePanelStyles.geozoneBadgeText}>{badgeLabel}</Text>
                        </View>
                        {z.informationalOnly ? (
                          <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: badgeColor, marginLeft: 4 }]}>
                            <Text style={sidePanelStyles.geozoneBadgeText}>Infrastrukturhinweis</Text>
                          </View>
                        ) : null}
                        {zShowPolicyBadge ? (
                          <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: policyColor, marginLeft: 4, flexDirection: "row", alignItems: "center", gap: 3 }]}>
                            <Feather name={zRestriction === "PROHIBITED" ? "slash" : zPolicy.verdict === "info" ? "info" : "alert-triangle"} size={9} color="#FFFFFF" />
                            <Text style={sidePanelStyles.geozoneBadgeText}>{zPolicy.labelDe}</Text>
                          </View>
                        ) : null}
                        {zAvCovered ? (
                          <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: isDark ? "#30D158" : "#34C759", marginLeft: 4, flexDirection: "row", alignItems: "center", gap: 3 }]}>
                            <Feather name="check" size={9} color="#FFFFFF" />
                            <Text style={sidePanelStyles.geozoneBadgeText}>AV-gedeckt</Text>
                          </View>
                        ) : null}
                        {zIsFuture ? (
                          <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: isDark ? "rgba(142,142,147,0.25)" : "rgba(142,142,147,0.15)", marginLeft: 4 }]}>
                            <Text style={[sidePanelStyles.geozoneBadgeText, { color: isDark ? "#AEAEB2" : "#8E8E93" }]}>inaktiv</Text>
                          </View>
                        ) : null}
                        {regInfo ? (
                          <Pressable
                            onPress={() => setExpandedRegInfo(isExpanded ? null : i)}
                            hitSlop={8}
                            style={[sidePanelStyles.geozoneCardInfoBtn, { borderColor: "#4A90D9" }]}
                          >
                            <Feather name={isExpanded ? "chevron-up" : "info"} size={13} color="#4A90D9" />
                          </Pressable>
                        ) : null}
                      </View>
                      <Text style={[sidePanelStyles.geozoneTitle, { color: textColor }]}>{z.name}</Text>
                      {details.length > 0 ? details.map((line, li) => {
                        const separatorIndex = line.indexOf(":");
                        const key = separatorIndex > 0 ? line.slice(0, separatorIndex).trim() : "";
                        // Some source descriptions contain colons inside a long
                        // legal text. Treat only compact prefixes as field labels;
                        // otherwise keep the whole description full-width.
                        const hasKey = separatorIndex > 0 && key.length <= 40;
                        const value = hasKey ? line.slice(separatorIndex + 1).trim() : line;
                        const urlMatch = value.match(/https?:\/\/[^\s)]+/);
                        const url = urlMatch ? urlMatch[0] : null;
                        const onPress = url ? () => { WebBrowser.openBrowserAsync(url).catch(() => { openLink(url).catch(() => {}); }); } : undefined;
                        const valStyle = [sidePanelStyles.geozoneDetailVal, { color: url ? "#4A90D9" : (hasKey ? textColor : mutedColor) }, url ? { textDecorationLine: "underline" as const } : null];
                        if (hasKey) {
                          return (
                            <View key={li} style={sidePanelStyles.geozoneDetailRow}>
                              <Text style={[sidePanelStyles.geozoneDetailKey, { color: mutedColor }]}>{key}</Text>
                              {url ? (
                                <Pressable onPress={onPress} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 4 }} hitSlop={6}>
                                  <Feather name="external-link" size={10} color="#4A90D9" />
                                  <Text style={valStyle} numberOfLines={2}>{value}</Text>
                                </Pressable>
                              ) : (
                                <Text style={valStyle}>{value}</Text>
                              )}
                            </View>
                          );
                        }
                        return url ? (
                          <Pressable key={li} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }} hitSlop={6}>
                            <Feather name="external-link" size={10} color="#4A90D9" />
                            <Text style={valStyle} numberOfLines={2}>{value}</Text>
                          </Pressable>
                        ) : (
                          <Text key={li} style={valStyle}>{line}</Text>
                        );
                      }) : null}
                      <InfrastructureFlightGuidance zone={z} textColor={textColor} linkColor="#4A90D9" />
                      {z21hRule ? (
                        <Geozone21hRules
                          layerLabel={z.layerLabel}
                          isDark={isDark}
                          covered={zAvCovered}
                          bundesland={detectedBl}
                        />
                      ) : null}
                      {isExpanded && regInfo ? (
                        <View style={[sidePanelStyles.regInfoExpanded, { borderTopColor: divColor }]}>
                          <Text style={[sidePanelStyles.regInfoLabel, { color: "#4A90D9" }]}>Referenz</Text>
                          <Text style={[sidePanelStyles.regInfoVal, { color: textColor }]}>{regInfo.referenz}</Text>
                          <Text style={[sidePanelStyles.regInfoLabel, { color: "#4A90D9" }]}>Definition</Text>
                          <Text style={[sidePanelStyles.regInfoVal, { color: textColor }]}>{regInfo.definition}</Text>
                          <Text style={[sidePanelStyles.regInfoLabel, { color: "#4A90D9" }]}>Abstandsregel</Text>
                          <Text style={[sidePanelStyles.regInfoVal, { color: textColor }]}>{regInfo.abstandsregel}</Text>
                          <Text style={[sidePanelStyles.regInfoLabel, { color: "#4A90D9" }]}>Betriebsvoraussetzung</Text>
                          <Text style={[sidePanelStyles.regInfoVal, { color: textColor }]}>{regInfo.betriebsvoraussetzung}</Text>
                          {regInfo.hinweis ? (
                            <View style={[sidePanelStyles.regInfoHinweis, { backgroundColor: isDark ? "rgba(245,158,11,0.1)" : "rgba(245,158,11,0.06)" }]}>
                              <Text style={[sidePanelStyles.regInfoVal, { color: isDark ? "#F5D080" : "#92400E" }]}>{regInfo.hinweis}</Text>
                            </View>
                          ) : null}
                          {regInfo.links && regInfo.links.length > 0 ? (
                            <View style={{ marginTop: 6 }}>
                              {regInfo.links.map((link, li) => (
                                <Pressable key={li} onPress={() => { WebBrowser.openBrowserAsync(link.url).catch(() => {}); }} style={sidePanelStyles.regInfoLink}>
                                  <Feather name="external-link" size={10} color="#4A90D9" />
                                  <Text style={sidePanelStyles.regInfoLinkText}>{link.label}</Text>
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                          {(() => {
                            const zoneContacts = getContactsForZone(z.layerLabel, z.name, countryIso);
                            return zoneContacts.length > 0 ? (
                            <View style={{ marginTop: 8 }}>
                              <Text style={[sidePanelStyles.regInfoLabel, { color: "#4A90D9", marginBottom: 4 }]}>Kontakte</Text>
                              {zoneContacts.map((c, ci) => (
                                <Pressable
                                  key={ci}
                                  onPress={() => openGeozoneContact(c)}
                                  style={sidePanelStyles.regInfoContactRow}
                                >
                                  <Feather name={c.type === "email" ? "mail" : c.type === "phone" ? "phone" : "globe"} size={11} color={c.type === "email" ? "#4A90D9" : c.type === "phone" ? "#34C759" : "#4A90D9"} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={[sidePanelStyles.regInfoContactLabel, { color: textColor }]}>{c.label}</Text>
                                    <Text style={[sidePanelStyles.regInfoContactValue, { color: c.type === "email" ? "#4A90D9" : c.type === "phone" ? "#34C759" : "#4A90D9" }]}>{c.type === "phone" ? c.value.replace(/^\+49/, "+49 ") : c.value}</Text>
                                  </View>
                                </Pressable>
                              ))}
                            </View>
                          ) : null;
                          })()}
                        </View>
                      ) : null}
                    </View>
                  );
                  });
                })()}
              </View>
            ) : (
              <View style={{ gap: 6 }}>
                {(() => {
                  // Das grüne "frei"-Banner darf nur erscheinen, wenn weder
                  // dauerhafte Geozonen NOCH befristete Sperrungen (NOTAM-Gebiete /
                  // aktivierbare UAS-Zonen / aktive dipul-Beschränkungen) im
                  // Flugbereich liegen. Andernfalls verweisen wir auf den NOTAM-Tab,
                  // damit kein "alles frei" über einer Verbotszone steht.
                  const activeDipulCount = dipulRestrictions.filter((d) => d.status === "active").length;
                  const restrictionCount = tempRestrictions.length + activeDipulCount;
                  if (geozoneDataStatus !== "loaded") {
                    return (
                      <View style={{ gap: 6 }}>
                        {windFacilityWarnings.map((facility) => (
                          <View key={`wind-buffer-unverified-${facility.id}`} style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.12)", borderLeftColor: "#FF9500" }]}>
                            <Feather name="alert-triangle" size={14} color={isDark ? "#FFCC80" : "#CC7A00"} />
                            <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFCC80" : "#CC7A00" }]}>
                              {facility.name}: {Math.round(facility.distanceMeters)} m entfernt. Der 100-m-Prüfkreis liegt im Radarbereich; innerhalb dieses Abstands ist, sofern § 21h Abs. 3 Nr. 3 LuftVO gilt, ausdrückliche Zustimmung erforderlich.
                            </Text>
                          </View>
                        ))}
                        <View style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.12)", borderLeftColor: "#FF9500" }]}>
                          <Feather name="alert-triangle" size={14} color={isDark ? "#FFCC80" : "#CC7A00"} />
                          <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFCC80" : "#CC7A00" }]}>
                            {geozoneDataStatus === "error" ? "Geozonen konnten nicht geprüft werden. Grün bedeutet hier nicht „frei“." : "Geozonen werden noch geprüft. Grün bedeutet hier nicht „frei“."}
                          </Text>
                        </View>
                      </View>
                    );
                  }
                  if (windFacilityWarnings.length > 0) {
                    return (
                      <View style={{ gap: 6 }}>
                        {windFacilityWarnings.map((facility) => (
                          <View key={`wind-buffer-empty-${facility.id}`} style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.12)", borderLeftColor: "#FF9500" }]}>
                            <Feather name="alert-triangle" size={14} color={isDark ? "#FFCC80" : "#CC7A00"} />
                            <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFCC80" : "#CC7A00" }]}>
                              {facility.name}: {Math.round(facility.distanceMeters)} m entfernt. Der 100-m-Prüfkreis liegt im Radarbereich. Innerhalb dieses Abstands ist, sofern § 21h Abs. 3 Nr. 3 LuftVO gilt, ausdrückliche Zustimmung erforderlich.
                            </Text>
                          </View>
                        ))}
                        {restrictionCount > 0 ? (
                          <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFCC80" : "#CC7A00" }]}>
                            Zusätzlich liegen {restrictionCount} temporäre Sperrung{restrictionCount !== 1 ? "en" : ""} im Flugbereich — Details im Tab „NOTAMs / Temporär“.
                          </Text>
                        ) : null}
                      </View>
                    );
                  }
                  if (restrictionCount > 0) {
                    return (
                      <View style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.12)", borderLeftColor: "#FF9500" }]}>
                        <Feather name="alert-triangle" size={14} color={isDark ? "#FFCC80" : "#CC7A00"} />
                        <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFCC80" : "#CC7A00" }]}>
                          Keine dauerhaften Geozonen, aber {restrictionCount} temporäre Sperrung{restrictionCount !== 1 ? "en" : ""} (NOTAM-Gebiet{restrictionCount !== 1 ? "e" : ""}) im Flugbereich — Details im Tab „NOTAMs / Temporär"
                        </Text>
                      </View>
                    );
                  }
                  return (
                    <View style={[sidePanelStyles.infoBoxOk, { backgroundColor: isDark ? "rgba(52,199,89,0.15)" : "rgba(52,199,89,0.12)" }]}>
                      <Feather name="check-circle" size={14} color={isDark ? "#FFFFFF" : "#248A3D"} />
                      <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFFFFF" : "#248A3D" }]}>Keine Geozonen oder Sperrungen im Flugbereich</Text>
                    </View>
                  );
                })()}
              </View>
            )
          ) : null}
          {panel === "notam" ? (
            <View style={{ gap: 6 }}>
              {dipulRestrictions.length > 0 ? (
                (() => {
                  const now = new Date();
                  const todayLocal = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
                  const toLocalDate = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
                  const activeCount = dipulRestrictions.filter((d) => d.status === "active").length;
                  const upcomingTodayCount = dipulRestrictions.filter((d) => d.status === "upcoming" && d.startTs && toLocalDate(d.startTs) === todayLocal).length;
                  return (
                <>
                  {activeCount > 0 ? (
                    <View style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,59,48,0.15)" : "rgba(255,59,48,0.12)" }]}>
                      <Feather name="alert-circle" size={14} color={isDark ? "#FFFFFF" : "#CC2D25"} />
                      <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFFFFF" : "#CC2D25" }]}>
                        {activeCount} Aktive Einschränkung{activeCount !== 1 ? "en" : ""} (dipul)
                      </Text>
                    </View>
                  ) : null}
                  {upcomingTodayCount > 0 ? (
                    <View style={[sidePanelStyles.infoBox, { backgroundColor: isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.12)", borderLeftColor: "#FF9500" }]}>
                      <Feather name="clock" size={14} color={isDark ? "#FFFFFF" : "#CC7A00"} />
                      <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFFFFF" : "#CC7A00" }]}>
                        {upcomingTodayCount} Bevorstehende Einschränkung{upcomingTodayCount !== 1 ? "en" : ""} heute
                      </Text>
                    </View>
                  ) : null}
                  {dipulRestrictions.map((dr, i) => {
                    const dipulUrl = buildDipulLink(dr.name);
                    const isUpcoming = dr.status === "upcoming";
                    const isUpcomingToday = isUpcoming && dr.startTs && toLocalDate(dr.startTs) === todayLocal;
                    const borderColor = isUpcoming ? (isUpcomingToday ? "#FF9500" : "#5856D6") : "#FF3B30";
                    const statusLabel = isUpcoming ? (isUpcomingToday ? "Heute" : "Zukünftig") : "Aktiv";
                    const dateOpts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" };
                    const timeOpts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" };
                    const startStr = dr.startTs ? new Date(dr.startTs).toLocaleDateString("de-DE", dateOpts) : null;
                    const endStr = dr.endTs && !dr.endTsIndefinite ? new Date(dr.endTs).toLocaleDateString("de-DE", dateOpts) : null;
                    const lower = dr.lowerAlt === 0 && dr.lowerAltRef === "AGL" ? "GND" : `${Math.round(dr.lowerAlt)} ${dr.lowerAltUnit} ${dr.lowerAltRef}`;
                    const upper = dr.upperAltRef === "MSL" && dr.upperAlt * 3.28084 >= 10000
                      ? `FL${Math.round(dr.upperAlt * 3.28084 / 100)}`
                      : `${Math.round(dr.upperAlt)} ${dr.upperAltUnit} ${dr.upperAltRef}`;
                    const recurLabel = dr.recurRules && dr.recurRules.length > 0
                      ? dr.recurRules[0].includes("FREQ=DAILY") ? "Täglich" : dr.recurRules[0].includes("FREQ=WEEKLY") ? "Wöchentlich" : "Wiederkehrend"
                      : null;
                    const startTimeStr = dr.startTs ? new Date(dr.startTs).toLocaleString("de-DE", { ...timeOpts, day: undefined, month: undefined, year: undefined }) : null;
                    const endTimeStr = dr.endTs && !dr.endTsIndefinite ? new Date(dr.endTs).toLocaleString("de-DE", { ...timeOpts, day: undefined, month: undefined, year: undefined }) : null;
                    return (
                      <View key={`dipul-${dr.id}-${i}`} style={[sidePanelStyles.itemCard, { borderLeftColor: borderColor }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <Text style={[sidePanelStyles.itemTitle, { color: textColor, flex: 1 }]} numberOfLines={2}>{dr.name}</Text>
                          <View style={[sidePanelStyles.sevBadge, { backgroundColor: borderColor }]}>
                            <Text style={sidePanelStyles.sevBadgeText}>{statusLabel}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 5, backgroundColor: borderColor + "18", paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 }}>
                          <Feather name={dr.category === "military" ? "shield" : dr.category === "nature" ? "feather" : "alert-triangle"} size={12} color={borderColor} />
                          <Text style={{ color: borderColor, fontSize: 12, fontWeight: "700" }}>{dr.legalExplanation}</Text>
                        </View>
                        <View style={{ flexDirection: "row", marginBottom: 3 }}>
                          <Text style={{ color: mutedColor, fontSize: 11, width: 90 }}>Untere Grenze</Text>
                          <Text style={{ color: mutedColor, fontSize: 11, width: 90 }}>Obere Grenze</Text>
                        </View>
                        <View style={{ flexDirection: "row", marginBottom: 5 }}>
                          <Text style={{ color: textColor, fontSize: 12, fontWeight: "700", width: 90 }}>{lower}</Text>
                          <Text style={{ color: textColor, fontSize: 12, fontWeight: "700", width: 90 }}>{upper}</Text>
                        </View>
                        <View style={{ flexDirection: "row", marginBottom: 3 }}>
                          <Text style={{ color: mutedColor, fontSize: 11, width: 90 }}>Startzeit</Text>
                          <Text style={{ color: mutedColor, fontSize: 11, flex: 1 }}>Endzeit</Text>
                        </View>
                        <View style={{ flexDirection: "row", marginBottom: 5 }}>
                          <Text style={{ color: textColor, fontSize: 12, fontWeight: "600", width: 90 }}>
                            {startStr ? `${startStr}${startTimeStr ? `, ${startTimeStr}` : ""}` : "—"}
                          </Text>
                          <Text style={{ color: textColor, fontSize: 12, fontWeight: "600", flex: 1 }}>
                            {dr.endTsIndefinite ? "Unbefristet" : endStr ? `${endStr}${endTimeStr ? `, ${endTimeStr}` : ""}` : "—"}
                          </Text>
                        </View>
                        <Text style={{ color: mutedColor, fontSize: 11, marginBottom: 2 }}>Rechtshinweis</Text>
                        <Text style={{ color: textColor, fontSize: 12, fontWeight: "600", marginBottom: 2 }}>{dr.legalRef || "—"}</Text>
                        {recurLabel ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                            <Feather name="repeat" size={11} color={mutedColor} />
                            <Text style={{ color: textColor, fontSize: 11 }}>{recurLabel}</Text>
                          </View>
                        ) : null}
                        <Text style={{ color: mutedColor, fontSize: 10, marginTop: 3 }}>Identifikation</Text>
                        <Text style={{ color: mutedColor, fontSize: 10 }}>{dr.extRef}</Text>
                        <Pressable
                          onPress={() => { WebBrowser.openBrowserAsync(dipulUrl || "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/").catch(() => {}); }}
                          style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5, paddingVertical: 2 }}
                        >
                          <Feather name="external-link" size={12} color={borderColor} />
                          <Text style={{ color: borderColor, fontSize: 12, fontWeight: "600" }}>{isAdmin ? (dipulUrl ? "Details auf dipul.de" : "Alle Einschränkungen auf dipul.de") : (dipulUrl ? "Details ansehen" : "Alle Einschränkungen ansehen")}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                  {notams.length > 0 ? (
                    <View style={[sidePanelStyles.divider, { backgroundColor: divColor, marginVertical: 6 }]} />
                  ) : null}
                </>
                  );
                })()
              ) : null}
              {tempRestrictions.length > 0 ? (
                <View>
                  {(dipulRestrictions.length > 0) ? (
                    <View style={[sidePanelStyles.divider, { backgroundColor: divColor, marginVertical: 6 }]} />
                  ) : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, paddingHorizontal: 2 }}>
                    <Feather name="alert-triangle" size={12} color="#FF9500" />
                    <Text style={{ color: "#FF9500", fontSize: 12, fontWeight: "700", letterSpacing: 0.3 }}>
                      Aktivierbare UAS-Zonen ({tempRestrictions.length})
                    </Text>
                  </View>
                  {tempRestrictions.map((tr, i) => (
                    <View key={`tempr-${tr.featureId || i}`} style={[sidePanelStyles.itemCard, { borderLeftColor: "#FF9500" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <Text style={[sidePanelStyles.itemTitle, { color: textColor, flex: 1 }]} numberOfLines={2}>{tr.name}</Text>
                        <View style={[sidePanelStyles.sevBadge, { backgroundColor: "#FF9500" }]}>
                          <Text style={sidePanelStyles.sevBadgeText}>{tr.layerLabel === "LU Aktivierbare UAS-Zonen" ? "LU" : "TMP"}</Text>
                        </View>
                      </View>
                      {tr.details ? (
                        <Text style={[sidePanelStyles.itemDetail, { color: mutedColor }]}>{tr.details}</Text>
                      ) : null}
                    </View>
                  ))}
                  {notams.length > 0 ? (
                    <View style={[sidePanelStyles.divider, { backgroundColor: divColor, marginVertical: 6 }]} />
                  ) : null}
                </View>
              ) : null}
              {notams.length > 0 ? (() => {
                const grouped: Record<string, NotamData[]> = {};
                for (const n of notams) {
                  const country = getNotamCountryLabel(n);
                  if (!grouped[country]) grouped[country] = [];
                  grouped[country].push(n);
                }
                const countryOrder = ["DE", "CH", "LU", "NL"];
                const sortedKeys = Object.keys(grouped).sort((a, b) => {
                  const ia = countryOrder.indexOf(a);
                  const ib = countryOrder.indexOf(b);
                  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
                });
                return sortedKeys.map((countryIso) => (
                  <View key={`notam-group-${countryIso}`}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, marginBottom: 4, paddingHorizontal: 2 }}>
                      <Feather name="map-pin" size={12} color={accentColor} />
                      <Text style={{ color: accentColor, fontSize: 12, fontWeight: "700", letterSpacing: 0.3 }}>
                        {getCountryLabel(countryIso)} ({grouped[countryIso].length})
                      </Text>
                    </View>
                    {grouped[countryIso].map((n, i) => {
                      const sev = getNotamSeverity(n);
                      const sevColor = sev === "high" ? "#FF3B30" : sev === "medium" ? "#FF9500" : "#8E8E93";
                      return (
                        <View key={`notam-${n.id}-${i}`} style={[sidePanelStyles.itemCard, { borderLeftColor: sevColor }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={[sidePanelStyles.itemTitle, { color: textColor, flex: 1 }]}>
                              {n.series}{n.number}{n.year ? `/${n.year}` : ""}
                            </Text>
                            <View style={[sidePanelStyles.sevBadge, { backgroundColor: sevColor }]}>
                              <Text style={sidePanelStyles.sevBadgeText}>{sev === "high" ? "HOCH" : sev === "medium" ? "MITTEL" : "INFO"}</Text>
                            </View>
                          </View>
                          <Text style={[sidePanelStyles.itemDetail, { color: mutedColor }]}>{n.iteme}</Text>
                        </View>
                      );
                    })}
                  </View>
                ));
              })() : null}
              {notamStatusUnknown ? (
                <Text testID="radar-notam-unknown" style={[sidePanelStyles.emptyText, { color: "#FF9500" }]}>{NOTAM_STATUS_UNKNOWN_TEXT}</Text>
              ) : null}
              {!notamStatusUnknown && notams.length === 0 && dipulRestrictions.length === 0 && tempRestrictions.length === 0 ? (
                <Text style={[sidePanelStyles.emptyText, { color: mutedColor }]}>Keine NOTAMs oder temporären Einschränkungen</Text>
              ) : null}
            </View>
          ) : null}
          {panel === "wetter" ? (
            forecasts.length > 0 ? (
              (() => {
                const P_ROW_H = 19;
                const P_HEADER_H = 24;
                const P_LABEL_W = 86;
                const P_COL_W = 64;
                const wBorderColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
                const wLabelBg = isDark ? "rgba(15,22,42,0.95)" : "rgba(245,245,250,0.95)";
                const wOkColor = "#34C759";
                const wCautionColor = "#FF9500";
                const wWarnColor = "#FF3B30";
                const wCautionBg = isDark ? "rgba(255,149,0,0.2)" : "rgba(255,149,0,0.15)";
                const wWarnBg = isDark ? "rgba(255,59,48,0.2)" : "rgba(255,59,48,0.15)";

                type PRowKey = "temp" | "temp50" | "temp100" | "temp150" | "temp200" | "temp250" | "wind" | "gust" | "dir" | "wind50" | "wind100" | "wind150" | "wind200" | "wind250" | "cloud" | "rain" | "humidity" | "qnh" | "kp";
                const pRows: { key: PRowKey; label: string; icon: string; iconColor: string }[] = [
                  { key: "temp", label: "Temp 2m", icon: "thermometer", iconColor: "#FF6B6B" },
                  { key: "temp50", label: "Temp 50m", icon: "thermometer", iconColor: "#FF8080" },
                  { key: "temp100", label: "Temp 100m", icon: "thermometer", iconColor: "#FF9595" },
                  { key: "temp150", label: "Temp 150m", icon: "thermometer", iconColor: "#FFAAAA" },
                  { key: "temp200", label: "Temp 200m", icon: "thermometer", iconColor: "#FFBFBF" },
                  { key: "temp250", label: "Temp 250m", icon: "thermometer", iconColor: "#FFD4D4" },
                  { key: "wind", label: "Wind 10m", icon: "wind", iconColor: "#4A90D9" },
                  { key: "wind50", label: "Wind 50m", icon: "wind", iconColor: "#5B9FE6" },
                  { key: "wind100", label: "Wind 100m", icon: "wind", iconColor: "#7BB3F0" },
                  { key: "wind150", label: "Wind 150m", icon: "wind", iconColor: "#9BC7FA" },
                  { key: "wind200", label: "Wind 200m", icon: "wind", iconColor: "#ADCFFC" },
                  { key: "wind250", label: "Wind 250m", icon: "wind", iconColor: "#BFD9FD" },
                  { key: "gust", label: "Böen", icon: "alert-triangle", iconColor: "#FF9500" },
                  { key: "dir", label: "Richtung", icon: "navigation", iconColor: "#4A90D9" },
                  { key: "cloud", label: "Wolken", icon: "cloud", iconColor: "#8E8E93" },
                  { key: "rain", label: "Regen", icon: "cloud-rain", iconColor: "#5AC8FA" },
                  { key: "humidity", label: "Feuchte", icon: "droplet", iconColor: "#64D2FF" },
                  { key: "qnh", label: "QNH", icon: "activity", iconColor: "#A78BFA" },
                  { key: "kp", label: "KP", icon: "zap", iconColor: "#8E8E93" },
                ];

                const pSlots: ForecastData[] = [];
                const usedH = new Set<string>();
                for (let i = 0; i < forecasts.length && pSlots.length < 48; i++) {
                  const d = new Date(forecasts[i].timestamp);
                  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
                  if (!usedH.has(key)) { usedH.add(key); pSlots.push(forecasts[i]); }
                }

                function getKpForFc(fc: ForecastData): number | null {
                  if (kpTimeline.length > 0) return getKpForHour(kpTimeline, new Date(fc.timestamp));
                  return kpIndex?.value ?? null;
                }

                function getWindAtHeight(fc: ForecastData, height: number): { speed: number; gust?: number; direction: number } | null {
                  const w = fc.windAtAltitude?.find((a) => a.height === height);
                  return w ? { speed: w.speed, gust: w.gust, direction: w.direction } : null;
                }

                function getTempAtHeight(fc: ForecastData, height: number): { value: number; estimated: boolean } | null {
                  const t = fc.temperatureAtAltitude?.find((a) => a.height === height);
                  return t ? { value: t.value, estimated: t.estimated === true } : null;
                }

                function pCellIsEstimated(fc: ForecastData, key: PRowKey): boolean {
                  const heights: Partial<Record<PRowKey, number>> = { temp50: 50, temp100: 100, temp150: 150, temp200: 200, temp250: 250 };
                  const h = heights[key];
                  if (h == null) return false;
                  const t = fc.temperatureAtAltitude?.find((a) => a.height === h);
                  return t?.estimated === true;
                }

                function pCellVal(fc: ForecastData, key: PRowKey): string {
                  switch (key) {
                    case "temp": return fc.temperature != null ? fc.temperature.toFixed(1) + "°" : "-";
                    case "temp50": { const t = getTempAtHeight(fc, 50); return t != null ? (t.estimated ? "~" : "") + t.value.toFixed(1) + "°" : "-"; }
                    case "temp100": { const t = getTempAtHeight(fc, 100); return t != null ? (t.estimated ? "~" : "") + t.value.toFixed(1) + "°" : "-"; }
                    case "temp150": { const t = getTempAtHeight(fc, 150); return t != null ? (t.estimated ? "~" : "") + t.value.toFixed(1) + "°" : "-"; }
                    case "temp200": { const t = getTempAtHeight(fc, 200); return t != null ? (t.estimated ? "~" : "") + t.value.toFixed(1) + "°" : "-"; }
                    case "temp250": { const t = getTempAtHeight(fc, 250); return t != null ? (t.estimated ? "~" : "") + t.value.toFixed(1) + "°" : "-"; }
                    case "wind": return fc.windSpeed != null ? fc.windSpeed.toFixed(1) : "-";
                    case "gust": return (fc.windGust ?? 0) > 0 ? (fc.windGust!).toFixed(1) : "-";
                    case "dir": { const dirs=["N","NO","O","SO","S","SW","W","NW"]; const wd = fc.windDirection ?? 0; return Math.round(wd)+"°"+(dirs[Math.round(wd/45)%8]||""); }
                    case "wind50": { const w = getWindAtHeight(fc, 50); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind100": { const w = getWindAtHeight(fc, 100); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind150": { const w = getWindAtHeight(fc, 150); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind200": { const w = getWindAtHeight(fc, 200); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind250": { const w = getWindAtHeight(fc, 250); return w ? w.speed.toFixed(1) : "-"; }
                    case "cloud": return Math.round(fc.cloudCover ?? 0)+"%";
                    case "rain": return fc.rain != null ? fc.rain.toFixed(1) : "-";
                    case "humidity": return Math.round(fc.humidity ?? 0)+"%";
                    case "qnh": return (fc.pressure ?? 0) > 0 ? (fc.pressure!/100).toFixed(1) : "-";
                    case "kp": { const v = getKpForFc(fc); return v != null ? v.toFixed(1) : "-"; }
                    default: return "-";
                  }
                }

                // Vereisungs-Kombination: kalte Temperatur + hohe Feuchte.
                // < 0 deg C + >= 80% rF -> kritisch (Klareis/Raueis moeglich).
                // <= 5 deg C + >= 90% rF -> caution (Beschlag/Kondensation).
                function icingStatus(fc: ForecastData): "critical"|"caution"|"ok" {
                  const t = fc.temperature;
                  const h = fc.humidity;
                  if (t == null || h == null) return "ok";
                  if (t < 0 && h >= 80) return "critical";
                  if (t <= 5 && h >= 90) return "caution";
                  return "ok";
                }
                function pCellStatus(fc: ForecastData, key: PRowKey): "critical"|"caution"|"ok" {
                  switch (key) {
                    case "wind": return fc.windSpeed > 10 ? "critical" : fc.windSpeed > 7 ? "caution" : "ok";
                    case "gust": { const g=fc.windGust??0; return g>12?"critical":g>9?"caution":"ok"; }
                    case "temp": {
                      if (fc.temperature < -5) return "critical";
                      if (fc.temperature < 0) return "caution";
                      // Bei Plustemperaturen nur bei Vereisungs-Kombi mit Feuchte highlighten
                      return icingStatus(fc);
                    }
                    case "temp50":
                    case "temp100":
                    case "temp150":
                    case "temp200":
                    case "temp250": {
                      const hMap: Record<string, number> = { temp50: 50, temp100: 100, temp150: 150, temp200: 200, temp250: 250 };
                      const v = getTempAtHeight(fc, hMap[key]);
                      if (v == null) return "ok";
                      return v.value < -5 ? "critical" : v.value < 0 ? "caution" : "ok";
                    }
                    case "wind50":
                    case "wind100":
                    case "wind150":
                    case "wind200":
                    case "wind250": {
                      const hMap: Record<string, number> = { wind50: 50, wind100: 100, wind150: 150, wind200: 200, wind250: 250 };
                      const w = getWindAtHeight(fc, hMap[key]);
                      if (!w) return "ok";
                      return w.speed > 12 ? "critical" : w.speed > 8 ? "caution" : "ok";
                    }
                    // Wolken & Feuchte solo nicht mehr highlighten - nur in Kombi
                    case "cloud": return "ok";
                    case "rain": return fc.rain > 0.5 ? "critical" : fc.rain > 0.1 ? "caution" : "ok";
                    case "humidity": return icingStatus(fc);
                    case "kp": { const v=getKpForFc(fc); return v == null ? "ok" : v>=6?"critical":v>=3?"caution":"ok"; }
                    default: return "ok";
                  }
                }

                function pColStatus(fc: ForecastData): "critical"|"caution"|"ok" {
                  let caution = false;
                  for (const r of pRows) { const s=pCellStatus(fc,r.key); if(s==="critical") return "critical"; if(s==="caution") caution=true; }
                  return caution ? "caution" : "ok";
                }

                const wSlotTimes = pSlots.map((fc) => new Date(fc.timestamp).getTime());

                return (
                  <View style={{ flex: 1 }}>
                    {propLat != null && propLon != null ? (
                      <View style={{
                        backgroundColor: isDark ? "rgba(20,20,30,0.6)" : "rgba(245,245,250,0.6)",
                        borderRadius: 12,
                        paddingHorizontal: 10,
                        paddingTop: 4,
                        paddingBottom: 4,
                        marginBottom: 6,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: wBorderColor,
                      }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                          <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 0.6, color: mutedColor }}>
                            TAGESGANG SONNENSTAND
                          </Text>
                        </View>
                        <SunArcChart
                          lat={propLat}
                          lon={propLon}
                          height={115}
                          scrollSync={{ scrollX: wetterScrollX, colWidth: P_COL_W, slotTimes: wSlotTimes }}
                        />
                      </View>
                    ) : null}
                    <View style={{ flex: 1, flexDirection: "row" }}>
                    <View style={{ width: P_LABEL_W, backgroundColor: wLabelBg, borderRightWidth: 1, borderRightColor: wBorderColor }}>
                      <View style={{ height: P_HEADER_H, justifyContent: "center", paddingLeft: 6, borderBottomWidth: 1, borderBottomColor: wBorderColor }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: mutedColor }}>Uhrzeit</Text>
                      </View>
                      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces={false} scrollEnabled={false}>
                        {pRows.map((r) => (
                          <View key={r.key} style={{ height: P_ROW_H, flexDirection: "row", alignItems: "center", paddingLeft: 5, gap: 4, borderBottomWidth: 0.5, borderBottomColor: wBorderColor }}>
                            <Feather name={r.icon as any} size={11} color={r.iconColor} />
                            <Text style={{ fontSize: 11, fontWeight: "700", color: mutedColor }} numberOfLines={1}>{r.label}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                    <Animated.ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingRight: 8 }}
                      style={{ flex: 1 }}
                      bounces={true}
                      scrollEventThrottle={16}
                      onScroll={onWetterScroll}
                    >
                      <View>
                        <View style={{ flexDirection: "row", height: P_HEADER_H, borderBottomWidth: 1, borderBottomColor: wBorderColor }}>
                          {pSlots.map((fc, idx) => {
                            const t = new Date(fc.timestamp);
                            const hStr = t.getHours().toString().padStart(2,"0")+":00";
                            const colSt = pColStatus(fc);
                            const topBar = colSt==="critical" ? wWarnColor : colSt==="caution" ? wCautionColor : wOkColor;
                            return (
                              <View key={idx} style={{ width: P_COL_W, borderRightWidth: 0.5, borderRightColor: wBorderColor }}>
                                <View style={{ height: 3, backgroundColor: topBar }} />
                                <View style={{ height: P_HEADER_H - 3, justifyContent: "center", alignItems: "center" }}>
                                  <Text style={{ fontSize: 12, fontWeight: "800", color: textColor }}>{idx===0?"Jetzt":hStr}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                        <View>
                          {pRows.map((r) => (
                            <View key={r.key} style={{ flexDirection: "row" }}>
                              {pSlots.map((fc, idx) => {
                                const cs = pCellStatus(fc, r.key);
                                const est = cs === "ok" && pCellIsEstimated(fc, r.key);
                                const kpValue = r.key === "kp" ? getKpForFc(fc) : null;
                                const kpColor = kpValue == null ? null : getKpAssessment(kpValue).color;
                                const bg = kpColor ? `${kpColor}26` : cs==="critical" ? wWarnBg : cs==="caution" ? wCautionBg : "transparent";
                                const cl = kpColor ?? (cs==="critical" ? wWarnColor : cs==="caution" ? wCautionColor : est ? mutedColor : textColor);
                                return (
                                  <View key={idx} style={{ width: P_COL_W, height: P_ROW_H, justifyContent: "center", alignItems: "center", backgroundColor: bg, borderBottomWidth: 0.5, borderBottomColor: wBorderColor, borderRightWidth: 0.5, borderRightColor: wBorderColor, paddingHorizontal: 2 }}>
                                    <Text style={{ fontSize: 12, fontWeight: cs!=="ok"?"800":"600", color: cl, fontStyle: est ? "italic" : "normal" }} numberOfLines={1}>{pCellVal(fc, r.key)}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      </View>
                    </Animated.ScrollView>
                    </View>
                  </View>
                );
              })()
            ) : (
              <Text style={[sidePanelStyles.emptyText, { color: mutedColor }]}>Keine Wetterdaten</Text>
            )
          ) : null}
          {panel === "radar" && radarData ? (
            <View style={{ gap: 8 }}>
              <View style={sidePanelStyles.radarLocationRow}>
                <Feather name={radarData.isCustomLocation ? "crosshair" : "map-pin"} size={13} color={radarData.isCustomLocation ? "#FF9500" : "#4A90D9"} />
                <Text style={[sidePanelStyles.radarLocationText, { color: textColor }]} numberOfLines={1}>
                  {radarData.locationName || "Standort..."}
                </Text>
              </View>
              <Text style={[{ fontSize: 12, color: mutedColor }]}>
                {radarData.isCustomLocation ? "Manueller Standort" : "GPS-Standort"}
              </Text>
              {radarData.pilotElevation != null ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <Feather name="triangle" size={12} color="#22C55E" />
                  <Text style={[{ fontSize: 13, fontWeight: "600", color: "#22C55E" }]}>
                    {Math.round(radarData.pilotElevation)} m MSL
                  </Text>
                  <Text style={[{ fontSize: 11, color: mutedColor }]}>{"Standorthöhe"}</Text>
                </View>
              ) : null}
              {(() => {
                const q = currentQnhHpa();
                return (
                  <Text style={[{ fontSize: 11, color: mutedColor, marginTop: 2 }]} testID="text-radar-qnh">
                    {q != null ? `QNH ${Math.round(q)} hPa · Flughöhen korrigiert` : "QNH unbekannt · Druckhöhen unkorrigiert"}
                  </Text>
                );
              })()}
              <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
              <RadarRadiusSlider
                radiusKm={radarData.radiusKm}
                onCommit={radarData.onRadiusChange}
                mutedColor={mutedColor}
                isDark={isDark}
              />
              <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
              <View style={sidePanelStyles.radarStatsRow}>
                <View style={sidePanelStyles.radarStatCard}>
                  <Text style={[sidePanelStyles.radarStatValue, { color: textColor }]}>{radarData.aircraftCount}</Text>
                  <Text style={[sidePanelStyles.radarStatLabel, { color: mutedColor }]}>Flugzeuge</Text>
                </View>
                <View style={[sidePanelStyles.radarStatCard, radarData.lowAltCount > 0 ? { backgroundColor: "rgba(255,149,0,0.12)" } : undefined]}>
                  <Text style={[sidePanelStyles.radarStatValue, { color: radarData.lowAltCount > 0 ? "#FF9500" : textColor }]}>{radarData.lowAltCount}</Text>
                  <Text style={[sidePanelStyles.radarStatLabel, { color: radarData.lowAltCount > 0 ? "#FF9500" : mutedColor }]}>Tiefflug</Text>
                </View>
                <View style={sidePanelStyles.radarStatCard}>
                  <Text style={[sidePanelStyles.radarStatValue, { color: textColor }]}>{radarData.inAirCount}</Text>
                  <Text style={[sidePanelStyles.radarStatLabel, { color: mutedColor }]}>In Luft</Text>
                </View>
              </View>
              {radarData.lastUpdate ? (
                <Text style={[{ fontSize: 11, color: mutedColor, textAlign: "center" }]}>
                  Aktualisiert: {radarData.lastUpdate.toLocaleTimeString("de-DE")} (alle 3s)
                </Text>
              ) : null}
              {isAdmin ? (
                <>
                  <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
                  <Text style={[{ fontSize: 12, fontWeight: "600", color: mutedColor }]}>Quellen</Text>
                  <View style={sidePanelStyles.radarSourceRow}>
                    {[
                      { label: "OGN", status: radarData.sourceStatus.ogn },
                      { label: "apl", status: radarData.sourceStatus.airplaneslive },
                      { label: "lol", status: radarData.sourceStatus.adsblol },
                    ].map((s) => (
                      <View key={s.label} style={sidePanelStyles.radarSourceItem}>
                        <View style={[sidePanelStyles.radarSourceDot, { backgroundColor: s.status === "ok" ? "#34C759" : s.status === "error" ? "#FF3B30" : "#8E8E93" }]} />
                        <Text style={[{ fontSize: 11, color: mutedColor }]}>{s.label}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              {radarData.isCustomLocation ? (
                <Pressable onPress={radarData.onResetLocation} style={[sidePanelStyles.radarActionBtn, { backgroundColor: "rgba(255,149,0,0.15)", marginTop: 4 }]}>
                  <Feather name="navigation" size={14} color="#FF9500" />
                  <Text style={[{ fontSize: 12, fontWeight: "600", color: "#FF9500" }]}>GPS</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={{ height: 12 }} />
        </ScrollView>
      )}
    </View>
  );
}

const sidePanelStyles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 125,
    // Bewusst KEIN festes height — der Container soll sich auf seine
    // Inhaltsgröße zusammenziehen (Header + Divider + ScrollView). Sonst
    // entsteht auf großen iPads ein riesiger blauer Block, weil die innere
    // ScrollView nur bis maxHeight 500 wächst und der Rest leer bleibt.
    maxHeight: "96%",
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: -4, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
      },
      android: { elevation: 16 },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
    flex: 1,
  },
  infoBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
  scrollArea: {
    paddingHorizontal: 14,
    paddingTop: 8,
    // maxHeight wird zur Laufzeit dynamisch gesetzt (scrollMaxHeight), damit die
    // Wetter-Tabelle ohne Scrollen passt; siehe Render der ScrollView.
  },
  loadingWrap: {
    padding: 24,
    alignItems: "center",
  },
  itemCard: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  itemLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  itemDetail: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 20,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#FF3B30",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginBottom: 2,
  },
  infoBoxOk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#34C759",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    marginBottom: 2,
  },
  infoBoxText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    flex: 1,
  },
  geozoneCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    backgroundColor: "rgba(74, 144, 217, 0.08)",
  },
  geozoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  geozoneBadge: {
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flex: 1,
    marginRight: 8,
  },
  geozoneBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  geozoneCardInfoBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  geozoneTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 5,
  },
  geozoneDetailRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 2,
  },
  geozoneDetailKey: {
    fontSize: 12,
    fontWeight: "600",
    minWidth: 75,
    maxWidth: "38%",
    flexShrink: 1,
  },
  geozoneDetailVal: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
    minWidth: 0,
  },
  regInfoExpanded: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  regInfoLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    marginBottom: 3,
  },
  regInfoVal: {
    fontSize: 12,
    lineHeight: 17,
  },
  regInfoHinweis: {
    marginTop: 6,
    padding: 8,
    borderRadius: 6,
  },
  regInfoLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 3,
  },
  regInfoLinkText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4A90D9",
    textDecorationLine: "underline",
  },
  regInfoContactRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  regInfoContactLabel: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
  },
  regInfoContactValue: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  sevBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sevBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  weatherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  weatherLabel: {
    fontSize: 13,
    flex: 1,
  },
  weatherValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  radarLocationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  radarLocationText: {
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  radarRadiusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  radarRadiusChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  radarRadiusText: {
    fontSize: 13,
    fontWeight: "700",
  },
  radarStatsRow: {
    flexDirection: "row",
    gap: 6,
  },
  radarStatCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  radarStatValue: {
    fontSize: 18,
    fontWeight: "800",
  },
  radarStatLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  radarSourceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  radarSourceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  radarSourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  radarActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});

function BottomWeatherOverlay({ forecasts, kpIndex, isDark, latitude, longitude, onForecastsUpdate }: {
  forecasts: ForecastData[];
  kpIndex: KpIndexData | null;
  isDark: boolean;
  latitude: number | null;
  longitude: number | null;
  onForecastsUpdate: (forecasts: ForecastData[], kp: KpIndexData | null) => void;
}) {
  const bgColor = isDark ? "rgba(10, 16, 32, 0.97)" : "rgba(240, 245, 252, 0.97)";
  const textColor = isDark ? "#E0E8F0" : "#1A1A2E";
  const mutedColor = isDark ? "rgba(160, 180, 210, 0.7)" : "rgba(80, 80, 100, 0.6)";
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const warnColor = "#FF3B30";
  const cautionColor = "#FF9500";
  const okColor = "#34C759";
  const warnBg = isDark ? "rgba(255, 59, 48, 0.18)" : "rgba(255, 59, 48, 0.12)";
  const cautionBg = isDark ? "rgba(255, 149, 0, 0.18)" : "rgba(255, 149, 0, 0.12)";
  const labelBg = bgColor;

  const [kpTimeline, setKpTimeline] = useState<KpTimeEntry[]>([]);

  useEffect(() => {
    if (latitude == null || longitude == null) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [wd, kp, kpTl] = await Promise.all([
          fetchWeather(latitude, longitude, 2880).catch(() => null),
          fetchKpIndex().catch(() => null),
          fetchKpTimeline().catch(() => [] as KpTimeEntry[]),
        ]);
        if (cancelled) return;
        if (wd?.forecasts) onForecastsUpdate(wd.forecasts, kp);
        if (kpTl.length > 0) setKpTimeline(kpTl);
      } catch {}
    };
    refresh();
    const iv = setInterval(refresh, 3600000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [latitude, longitude]);

  const slots = useMemo(() => {
    const result: ForecastData[] = [];
    const usedHours = new Set<string>();
    for (let i = 0; i < forecasts.length && result.length < 48; i++) {
      const d = new Date(forecasts[i].timestamp);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
      if (!usedHours.has(key)) {
        usedHours.add(key);
        result.push(forecasts[i]);
      }
    }
    return result;
  }, [forecasts]);

  const ROW_H = 22;
  const HEADER_H = 26;
  const LABEL_W = 86;
  const COL_W = 64;
  const MAX_TABLE_H = 320;

  type RowKey = "wind" | "gust" | "temp" | "cloud" | "rain" | "humidity" | "vis" | "qnh" | "dir" | "wind50" | "wind100" | "wind150" | "kp";
  const rows: { key: RowKey; label: string; icon: string; iconColor: string }[] = [
    { key: "temp", label: "Temp", icon: "thermometer", iconColor: "#FF6B6B" },
    { key: "wind", label: "Wind 10m", icon: "wind", iconColor: "#4A90D9" },
    { key: "wind50", label: "Wind 50m", icon: "wind", iconColor: "#5B9FE6" },
    { key: "wind100", label: "Wind 100m", icon: "wind", iconColor: "#7BB3F0" },
    { key: "wind150", label: "Wind 150m", icon: "wind", iconColor: "#9BC7FA" },
    { key: "gust", label: "Böen", icon: "alert-triangle", iconColor: "#FF9500" },
    { key: "dir", label: "Richtung", icon: "navigation", iconColor: "#4A90D9" },
    { key: "cloud", label: "Wolken", icon: "cloud", iconColor: "#8E8E93" },
    { key: "rain", label: "Regen", icon: "cloud-rain", iconColor: "#5AC8FA" },
    { key: "humidity", label: "Feuchte", icon: "droplet", iconColor: "#64D2FF" },
    { key: "qnh", label: "QNH", icon: "activity", iconColor: "#A78BFA" },
    { key: "kp", label: "KP", icon: "zap", iconColor: "#8E8E93" },
  ];

  function getKpForForecast(fc: ForecastData): number | null {
    if (kpTimeline.length === 0) return kpIndex?.value ?? null;
    return getKpForHour(kpTimeline, new Date(fc.timestamp));
  }

  function getWindAtHeight(fc: ForecastData, height: number): { speed: number; gust?: number; direction: number } | null {
    const w = fc.windAtAltitude?.find((a) => a.height === height);
    return w ? { speed: w.speed, gust: w.gust, direction: w.direction } : null;
  }

  function getCellValue(fc: ForecastData, key: RowKey): string {
    switch (key) {
      case "wind": return fc.windSpeed != null ? fc.windSpeed.toFixed(1) : "-";
      case "gust": return (fc.windGust ?? 0) > 0 ? (fc.windGust!).toFixed(1) : "-";
      case "temp": return fc.temperature != null ? fc.temperature.toFixed(1) + "°" : "-";
      case "cloud": return Math.round(fc.cloudCover ?? 0) + "%";
      case "rain": return fc.rain != null ? fc.rain.toFixed(1) : "-";
      case "humidity": return Math.round(fc.humidity ?? 0) + "%";
      case "vis": return fc.visibility != null ? (fc.visibility < 1000 ? Math.round(fc.visibility) + "m" : (fc.visibility / 1000).toFixed(1) + "k") : "n/a";
      case "qnh": return (fc.pressure ?? 0) > 0 ? (fc.pressure! / 100).toFixed(1) : "-";
      case "dir": {
        const dirs = ["N","NO","O","SO","S","SW","W","NW"];
        const wd = fc.windDirection ?? 0;
        const dirIdx = Math.round(wd / 45) % 8;
        return Math.round(wd) + "°" + (dirs[dirIdx] || "");
      }
      case "wind50": { const w = getWindAtHeight(fc, 50); return w ? w.speed.toFixed(1) : "-"; }
      case "wind100": { const w = getWindAtHeight(fc, 100); return w ? w.speed.toFixed(1) : "-"; }
      case "wind150": { const w = getWindAtHeight(fc, 150); return w ? w.speed.toFixed(1) : "-"; }
      case "kp": {
        const v = getKpForForecast(fc);
        return v != null ? v.toFixed(1) : "-";
      }
      default: return "-";
    }
  }

  function getCellStatus(fc: ForecastData, key: RowKey): "critical" | "caution" | "ok" {
    switch (key) {
      case "wind":
        if (fc.windSpeed > 10) return "critical";
        if (fc.windSpeed > 7) return "caution";
        return "ok";
      case "gust": {
        const g = fc.windGust ?? 0;
        if (g > 12) return "critical";
        if (g > 9) return "caution";
        return "ok";
      }
      case "temp":
        if (fc.temperature < -5) return "critical";
        if (fc.temperature < 0) return "caution";
        return "ok";
      case "wind50":
      case "wind100":
      case "wind150": {
        const h = key === "wind50" ? 50 : key === "wind100" ? 100 : 150;
        const w = getWindAtHeight(fc, h);
        if (!w) return "ok";
        return w.speed > 12 ? "critical" : w.speed > 8 ? "caution" : "ok";
      }
      case "cloud":
        if (fc.cloudCover > 90) return "caution";
        if (fc.cloudCover > 80) return "caution";
        return "ok";
      case "rain":
        if (fc.rain > 0.5) return "critical";
        if (fc.rain > 0.1) return "caution";
        return "ok";
      case "humidity":
        if (fc.humidity > 95) return "caution";
        return "ok";
      case "vis":
        if (fc.visibility != null && fc.visibility < 1000) return "critical";
        if (fc.visibility != null && fc.visibility < 3000) return "caution";
        return "ok";
      case "dir": return "ok";
      case "qnh": return "ok";
      case "kp": {
        const v = getKpForForecast(fc);
        if (v != null && v >= 6) return "critical";
        if (v != null && v >= 3) return "caution";
        return "ok";
      }
      default: return "ok";
    }
  }

  function getColumnStatus(fc: ForecastData): "critical" | "caution" | "ok" {
    let hasCaution = false;
    for (const r of rows) {
      const s = getCellStatus(fc, r.key);
      if (s === "critical") return "critical";
      if (s === "caution") hasCaution = true;
    }
    return hasCaution ? "caution" : "ok";
  }

  return (
    <View style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 90,
      backgroundColor: bgColor,
      borderTopWidth: 1,
      borderTopColor: borderColor,
    }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{
          width: LABEL_W,
          backgroundColor: labelBg,
          zIndex: 2,
          borderRightWidth: 1,
          borderRightColor: borderColor,
        }}>
          <View style={{ height: HEADER_H, justifyContent: "center", paddingLeft: 6, borderBottomWidth: 1, borderBottomColor: borderColor }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: mutedColor }}>Uhrzeit</Text>
          </View>
          {rows.map((r) => (
            <View key={r.key} style={{ height: ROW_H, flexDirection: "row", alignItems: "center", paddingLeft: 5, gap: 4, borderBottomWidth: 0.5, borderBottomColor: borderColor }}>
              <Feather name={r.icon as any} size={11} color={r.iconColor} />
              <Text style={{ fontSize: 11, fontWeight: "700", color: mutedColor }} numberOfLines={1}>{r.label}</Text>
            </View>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 8 }}
          style={{ flex: 1 }}
        >
          {slots.map((fc, idx) => {
            const t = new Date(fc.timestamp);
            const hStr = t.getHours().toString().padStart(2, "0") + ":00";
            const colStatus = getColumnStatus(fc);
            const topBarColor = colStatus === "critical" ? warnColor : colStatus === "caution" ? cautionColor : okColor;

            return (
              <View key={idx} style={{ width: COL_W, borderRightWidth: 0.5, borderRightColor: borderColor }}>
                <View style={{ height: 3, backgroundColor: topBarColor }} />
                <View style={{ height: HEADER_H - 3, justifyContent: "center", alignItems: "center", borderBottomWidth: 1, borderBottomColor: borderColor }}>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: textColor }}>
                    {idx === 0 ? "Jetzt" : hStr}
                  </Text>
                </View>
                {rows.map((r) => {
                  const cellStatus = getCellStatus(fc, r.key);
                  const kpValue = r.key === "kp" ? getKpForForecast(fc) : null;
                  const kpColor = kpValue == null ? null : getKpAssessment(kpValue).color;
                  const cellBg = kpColor ? `${kpColor}26` : cellStatus === "critical" ? warnBg : cellStatus === "caution" ? cautionBg : "transparent";
                  const cellColor = kpColor ?? (cellStatus === "critical" ? warnColor : cellStatus === "caution" ? cautionColor : textColor);
                  const cellWeight: "800" | "600" = cellStatus !== "ok" ? "800" : "600";
                  return (
                    <View key={r.key} style={{ height: ROW_H, justifyContent: "center", alignItems: "center", backgroundColor: cellBg, borderBottomWidth: 0.5, borderBottomColor: borderColor, paddingHorizontal: 2 }}>
                      <Text style={{ fontSize: 12, fontWeight: cellWeight, color: cellColor }} numberOfLines={1}>
                        {getCellValue(fc, r.key)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

interface MapConfigPopupProps {
  mapStyle: MapStyleOption;
  showRadar: boolean;
  showWindsock: boolean;
  showGeozones: boolean;
  showTraffic: boolean;
  showEnergyInfrastructure: boolean;
  energyComparisonAvailable: boolean;
  energyInfrastructureStatus: string;
  showWeatherOverlay: boolean;
  showAllGeozones: boolean;
  onToggleRadar: () => void;
  onToggleWindsock: () => void;
  onToggleGeozones: () => void;
  onToggleTraffic: () => void;
  onToggleEnergyInfrastructure: () => void;
  onToggleWeatherOverlay: () => void;
  onToggleShowAllGeozones: () => void;
  onOpenGeozoneDetail: () => void;
}

function MapConfigToggle({ label, active, onPress, labelColor, checkBorder }: { label: string; active: boolean; onPress: () => void; labelColor?: string; checkBorder?: string }) {
  const handlePress = useCallback(() => {
    try { onPress(); } catch (_e) { /* safe */ }
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) { /* safe */ }
  }, [onPress]);
  return (
    <Pressable onPress={handlePress} style={panelStyles.configRow}>
      <View style={[panelStyles.configCheck, active ? panelStyles.configCheckActive : undefined, !active && checkBorder ? { borderColor: checkBorder } : undefined]}>
        {active ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
      </View>
      <Text style={[panelStyles.configLabel, labelColor ? { color: labelColor } : undefined]}>{label}</Text>
    </Pressable>
  );
}

function MapConfigPopup({
  mapStyle, showRadar, showWindsock, showGeozones, showTraffic, showEnergyInfrastructure, energyComparisonAvailable, energyInfrastructureStatus, showWeatherOverlay, showAllGeozones,
  onToggleRadar, onToggleWindsock,
  onToggleGeozones, onToggleTraffic, onToggleEnergyInfrastructure, onToggleWeatherOverlay, onToggleShowAllGeozones, onOpenGeozoneDetail, onMapStyleChange,
  weatherOverlayVisible,
}: MapConfigPopupProps & { onMapStyleChange: (s: MapStyleOption) => void; weatherOverlayVisible?: boolean }) {
  const { theme, isDark } = useTheme();
  const popupBg = isDark ? "rgba(16, 22, 40, 0.96)" : "rgba(255, 255, 255, 0.97)";
  const labelColor = isDark ? "rgba(200, 215, 240, 0.95)" : "#333333";
  const checkBorder = isDark ? "rgba(120, 140, 180, 0.4)" : "rgba(100, 100, 120, 0.3)";
  const segTrackBg = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
  const segInactiveText = isDark ? "rgba(160, 180, 210, 0.65)" : "rgba(80, 80, 100, 0.65)";
  const dividerColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const sectionColor = isDark ? "rgba(130,155,200,0.55)" : "rgba(100,100,130,0.55)";
  // Fernsteuerung im Querformat: oben ansetzen und bis über die Tab-Leiste
  // begrenzen; der Inhalt scrollt, damit alle Haken erreichbar sind
  const { height: winH } = useWindowDimensions();
  const popupTop = winH < 600 ? 60 : 240;
  const popupMaxH = Math.max(200, winH - popupTop - 110);
  return (
    <View style={[panelStyles.configPopup, { top: popupTop, maxHeight: popupMaxH, backgroundColor: popupBg }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: 4 }}>
      <Text style={[panelStyles.configSectionTitle, { color: sectionColor }]}>KARTE</Text>
      <View style={[panelStyles.mapSegmented, { backgroundColor: segTrackBg }]}>
        {([
          { id: "standard" as MapStyleOption, label: "Normal" },
          { id: "satellite" as MapStyleOption, label: "Satellit" },
          { id: "osm" as MapStyleOption, label: "OSM" },
          { id: "grayscale" as MapStyleOption, label: "Graustufen" },
        ]).map((opt) => {
          const isActive = mapStyle === opt.id;
          return (
            <Pressable
              key={opt.id}
              style={[panelStyles.mapSegBtn, isActive ? panelStyles.mapSegBtnActive : undefined]}
              onPress={() => { onMapStyleChange(opt.id); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
            >
              <Text style={[panelStyles.mapSegLabel, { color: isActive ? "#FFFFFF" : segInactiveText }]}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[panelStyles.configDivider, { backgroundColor: dividerColor }]} />
      <Text style={[panelStyles.configSectionTitle, { color: sectionColor }]}>EBENEN</Text>
      <MapConfigToggle label="Radar" active={showRadar} onPress={onToggleRadar} labelColor={labelColor} checkBorder={checkBorder} />
      <MapConfigToggle label="Windsack" active={showWindsock} onPress={onToggleWindsock} labelColor={labelColor} checkBorder={checkBorder} />
      <MapConfigToggle label="Verkehr" active={showTraffic} onPress={onToggleTraffic} labelColor={labelColor} checkBorder={checkBorder} />
      <MapConfigToggle label="Ergänzende Anlagen" active={showEnergyInfrastructure} onPress={onToggleEnergyInfrastructure} labelColor={labelColor} checkBorder={checkBorder} />
      <Text style={[panelStyles.configLabel, { color: sectionColor, fontSize: 10, marginLeft: 30 }]}>
        {energyComparisonAvailable ? "Nur amtlich nicht gefundene Anlagen." : energyInfrastructureStatus}
      </Text>
      {energyComparisonAvailable && showEnergyInfrastructure ? (
        <Text style={[panelStyles.configLabel, { color: sectionColor, fontSize: 10, marginLeft: 30 }]}>
          {energyInfrastructureStatus}
        </Text>
      ) : null}
      <MapConfigToggle label="Wetter-Tabelle" active={showWeatherOverlay} onPress={onToggleWeatherOverlay} labelColor={labelColor} checkBorder={checkBorder} />
      <View style={panelStyles.geozoneRow}>
        <Pressable
          onPress={() => { try { onToggleGeozones(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
          hitSlop={6}
        >
          <View style={[panelStyles.configCheck, showGeozones ? panelStyles.configCheckActive : undefined, !showGeozones ? { borderColor: checkBorder } : undefined]}>
            {showGeozones ? <Feather name="check" size={13} color="#FFFFFF" /> : null}
          </View>
        </Pressable>
        <Text style={[panelStyles.configLabel, { color: labelColor, flex: 1 }]}>Geozonen</Text>
        <Pressable
          onPress={() => { try { onOpenGeozoneDetail(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
          hitSlop={8}
        >
          <Feather name="chevron-right" size={18} color={isDark ? "#8CB4E0" : "#4A90D9"} />
        </Pressable>
      </View>
      <MapConfigToggle
        label="Alle Geozonen anzeigen"
        active={showAllGeozones}
        onPress={onToggleShowAllGeozones}
        labelColor={labelColor}
        checkBorder={checkBorder}
      />
      </ScrollView>
    </View>
  );
}

/**
 * Radius-Regler: beim Ziehen nur die Zahl lokal aktualisieren; Karte,
 * Abfrage und Speichern erst beim Loslassen (sonst ruckelt der Regler,
 * weil bei jedem Schritt der ganze Radar-Bildschirm neu rendert).
 */
function RadarRadiusSlider({
  radiusKm,
  onCommit,
  mutedColor,
  isDark,
}: {
  radiusKm: number;
  onCommit: (r: number) => void;
  mutedColor: string;
  isDark: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? radiusKm;
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={[{ fontSize: 12, fontWeight: "600", color: mutedColor }]}>Radius</Text>
        <Text style={[{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }]}>{shown} km</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={[{ fontSize: 10, color: mutedColor }]}>3km</Text>
        <Slider
          testID="radar-radius-slider"
          style={{ flex: 1, height: 30 }}
          minimumValue={3}
          maximumValue={30}
          step={1}
          value={radiusKm}
          onValueChange={(val) => {
            const r = Math.round(val);
            setDraft((d) => (d === r ? d : r));
          }}
          onSlidingComplete={(val) => {
            setDraft(null);
            const r = Math.round(val);
            if (r !== radiusKm) onCommit(r);
          }}
          minimumTrackTintColor="#AF52DE"
          maximumTrackTintColor={isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}
          thumbTintColor="#AF52DE"
        />
        <Text style={[{ fontSize: 10, color: mutedColor }]}>30km</Text>
      </View>
    </>
  );
}
