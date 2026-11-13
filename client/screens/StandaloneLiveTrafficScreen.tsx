import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { View, StyleSheet, FlatList, Pressable, ActivityIndicator, ScrollView, Platform, Text, Modal, Animated, Dimensions, AppState, Linking, Alert } from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { captureRef } from "react-native-view-shot";
import TrafficMapView, { TrafficMarker, AircraftTrail, WindData } from "@/components/TrafficMapView";
import { fetchDipulWind, fetchWeather, ForecastData } from "@/lib/weather";
import { fetchNotams, NotamData, getNotamSeverity, getNotamCountryLabel, getCountryLabel } from "@/lib/notams";
import { fetchKpIndex, KpIndexData, fetchKpTimeline, getKpForHour, KpTimeEntry } from "@/lib/kpindex";
import { fetchElevation, enrichAircraftWithElevation } from "@/lib/elevation";
import { calculateSolarTimes, isTimeDuringDaylight, isTimeDuringCivilTwilight } from "@/lib/solar";

import ProximityAlarmBanner, { ProximityAlarmGlow, AlarmPulseProvider, bearingTo } from "@/components/ProximityAlarmBanner";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { useProximityAlarm } from "@/hooks/useProximityAlarm";
import { useAircraftTrails } from "@/hooks/useAircraftTrails";
import { isRecording, setMapSnapshot } from "@/lib/trafficRecorder";
import Slider from "@react-native-community/slider";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { GEOZONE_LAYERS, GEOZONE_REGULATORY_INFO, GeozoneRegulatoryInfo, GeozoneContact, getContactsForZone, loadGeozoneSettings, saveGeozoneSettings, getActiveLayerNames, MAP_STYLES, MapStyleOption, loadMapStyle, saveMapStyle, loadRadarSettings, saveRadarSettings, queryGeozonesInArea, GeozoneFeatureInfo, separateTempRestrictions, TEMP_RESTRICTION_LAYER_LABEL, buildDipulLink, fetchNearbyTempRestrictions, DipulTempRestriction, getCountryGeozoneLayers, getCountryGeozoneConfig, fetchLuTsaAsNotams } from "@/lib/geozones";
import { detectCountryFromCoordinates, getCountryDefaultCenter } from "@/lib/countryMaps";
import { useFocusEffect } from "@react-navigation/native";
import { getSettings } from "@/lib/storage";
import { getCached, setCache, makeCacheKey } from "@/lib/dataCache";
import { findNearbyCtrAirports, CtrAirport, getCtrCategoryLabel, getCtrProviderName } from "@/lib/ctrData";
import * as WebBrowser from "expo-web-browser";
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
import { getMarkerPinColor } from "@/lib/markerColors";

export default function StandaloneLiveTrafficScreen() {
  const { theme, isDark } = useTheme();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const safeTop = insets.top;

  const [gpsLatitude, setGpsLatitude] = useState<number | null>(null);
  const [gpsLongitude, setGpsLongitude] = useState<number | null>(null);
  const [customLat, setCustomLat] = useState<number | null>(null);
  const [customLon, setCustomLon] = useState<number | null>(null);
  const [locationName, setLocationName] = useState<string>("");
  const [isCustomLocation, setIsCustomLocation] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [permission, requestPermission] = Location.useForegroundPermissions();

  const latitude = isCustomLocation ? customLat : gpsLatitude;
  const longitude = isCustomLocation ? customLon : gpsLongitude;
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  const handleHeadingChange = useCallback((h: number | null) => { setDeviceHeading(h); }, []);

  const [aircraft, setAircraft] = useState<AircraftState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [viewMode, setViewMode] = useState<"map" | "list">(Platform.OS === "web" ? "list" : "map");
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLoadingAircraft = useRef(false);
  const appActiveRef = useRef(true);
  const [trails, setTrails] = useState<AircraftTrail[]>([]);
  const [sourceStatus, setSourceStatus] = useState<Record<DataSource, "ok" | "error" | "timeout">>({ opensky: "ok", adsbfi: "ok", adsbone: "ok", airplaneslive: "ok", adsblol: "ok", ogn: "ok" });
  const [wind, setWind] = useState<WindData | null>(null);
  const mapContainerRef = useRef<View>(null);
  const [geozoneSettings, setGeozoneSettings] = useState<Record<string, boolean>>({});
  const [showGeozoneModal, setShowGeozoneModal] = useState(false);
  const [showMapConfig, setShowMapConfig] = useState(false);
  const [showRadar, setShowRadar] = useState(true);
  const [showTraffic, setShowTraffic] = useState(true);
  const [showWindsock, setShowWindsock] = useState(true);
  const [showGeozones, setShowGeozones] = useState(true);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [detectedCountryIso, setDetectedCountryIso] = useState<string | undefined>(undefined);
  const activeGeozoneLayers = useMemo(() => getActiveLayerNames(geozoneSettings, detectedCountryIso), [geozoneSettings, detectedCountryIso]);
  const [mapStyle, setMapStyle] = useState<MapStyleOption>("standard");
  const [sidePanel, setSidePanel] = useState<"geozone" | "notam" | "wetter" | "radar" | null>(null);
  const [sidePanelGeozones, setSidePanelGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const [sidePanelTempRestrictions, setSidePanelTempRestrictions] = useState<GeozoneFeatureInfo[]>([]);
  const [sidePanelDipulRestrictions, setSidePanelDipulRestrictions] = useState<DipulTempRestriction[]>([]);
  const [sidePanelNotams, setSidePanelNotams] = useState<NotamData[]>([]);
  const [sidePanelWeather, setSidePanelWeather] = useState<ForecastData | null>(null);
  const [sidePanelForecasts, setSidePanelForecasts] = useState<ForecastData[]>([]);
  const [sidePanelKp, setSidePanelKp] = useState<KpIndexData | null>(null);
  const [sidePanelKpTimeline, setSidePanelKpTimeline] = useState<KpTimeEntry[]>([]);
  const [sidePanelLoading, setSidePanelLoading] = useState(false);
  const [alertFlags, setAlertFlags] = useState<{ wetter: boolean; notam: boolean; geozone: boolean }>({ wetter: false, notam: false, geozone: false });
  const [weatherStatus, setWeatherStatus] = useState<"unknown" | "ok" | "caution" | "critical">("unknown");
  const [pilotElevation, setPilotElevation] = useState<number | null>(null);
  const [nearbyCtr, setNearbyCtr] = useState<CtrAirport[]>([]);
  const [showCtrEmergency, setShowCtrEmergency] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = await getCached<{ notams: NotamData[]; tempRestrictions: GeozoneFeatureInfo[]; dipul: DipulTempRestriction[]; geozones: GeozoneFeatureInfo[] }>(makeCacheKey("radar_alerts", latitude, longitude));
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
    loadMapStyle().then((saved) => {
      setMapStyle(saved);
    });
    loadRadarSettings().then((rs) => {
      setRadiusKm(Math.max(3, Math.min(30, rs.radiusKm)));
      setShowRadar(rs.showRadar);
      setShowTraffic(rs.showTraffic);
      setShowWindsock(rs.showWindsock);
      setShowGeozones(rs.showGeozones);
      setShowWeatherOverlay(rs.showWeatherOverlay);
    });
  }, [detectedCountryIso]);

  useEffect(() => {
    if (latitude == null || longitude == null) {
      setPilotElevation(null);
      return;
    }
    setPilotElevation(null);
    fetchElevation(latitude, longitude).then((elev) => {
      setPilotElevation(elev);
    });
  }, [latitude, longitude]);

  const { activeAlerts, approachingAircraft, alarmActive, alarmLevel, alarmSettings, clearOfConflict, dismissAlarm } = useProximityAlarm(aircraft, latitude, longitude, undefined, pilotElevation);
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
      if (!cancelled && w) setWind({ direction: w.direction, speed: w.speed, directionLabel: w.directionLabel });
    };
    loadWind();
    const iv = setInterval(loadWind, 300000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [latitude, longitude]);

  useEffect(() => {
    if (!permission) return;

    const fallbackToCountryCenter = () => {
      const iso = (detectedCountryIso || "DE").toUpperCase();
      const c = getCountryDefaultCenter(iso);
      setGpsLatitude(c.lat);
      setGpsLongitude(c.lon);
      setLocationName(`${iso} (Standardposition)`);
      setLocationLoading(false);
    };

    if (!permission.granted) {
      fallbackToCountryCenter();
      return;
    }

    (async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setGpsLatitude(loc.coords.latitude);
        setGpsLongitude(loc.coords.longitude);

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

        setLocationLoading(false);
      } catch (err: any) {
        fallbackToCountryCenter();
      }
    })();
  }, [permission, detectedCountryIso]);

  const loadAircraft = useCallback(async () => {
    if (latitude == null || longitude == null) return;
    if (isLoadingAircraft.current) return;
    if (!appActiveRef.current) return;
    isLoadingAircraft.current = true;
    try {
      setError(null);
      const result = await fetchNearbyAircraft(latitude, longitude, radiusKm);
      const enriched = await enrichAircraftWithElevation(result.states);

      const allAcForTrails: AircraftState[] = [...(enriched as AircraftState[])];
      const enrichedIds = new Set(enriched.map((a) => a.icao24));
      for (const al of activeAlertsRef.current) {
        if (!enrichedIds.has(al.aircraft.icao24)) allAcForTrails.push(al.aircraft);
      }
      for (const ap of approachingRef.current) {
        if (!enrichedIds.has(ap.aircraft.icao24) && !allAcForTrails.some((a) => a.icao24 === ap.aircraft.icao24)) allAcForTrails.push(ap.aircraft);
      }
      const trailResult = updateTrails(allAcForTrails, latitude, longitude, radiusKm, alarmSettings.maxAltitudeM ?? 500);
      setTrails(trailResult.trails);
      const buffered = trailResult.bufferedAircraft;
      const mergedIds = new Set(enriched.map((a) => a.icao24));
      const merged: AircraftState[] = [...(enriched as AircraftState[])];
      for (const bac of buffered) {
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
    if (latitude == null || longitude == null) return;
    loadAircraft();
    refreshInterval.current = setInterval(loadAircraft, 5000);
    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [loadAircraft, latitude, longitude]);

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

  const raRadiusKm = alarmSettings.ra?.radiusKm ?? 1;

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
        const [weatherData, kp, kpTl, notamResult, zones, dipulResult, luTsaNotams] = await Promise.all([
          fetchWeather(qLat, qLon, 1440).catch(() => null),
          fetchKpIndex().catch(() => null),
          fetchKpTimeline().catch(() => [] as KpTimeEntry[]),
          fetchNotams(qLat, qLon).catch(() => ({ notams: [] as NotamData[], total: 0, queriedCodes: [] as string[] })),
          queryGeozonesInArea(qLat, qLon, raRadiusKm, detectedCountryIso).catch((e) => { console.warn("[checkAlerts] geozone query failed:", e?.message || e); return [] as GeozoneFeatureInfo[]; }),
          fetchNearbyTempRestrictions(qLat, qLon, raRadiusKm).catch(() => ({ active: [] as DipulTempRestriction[], upcoming: [] as DipulTempRestriction[] })),
          detectedCountryIso === "LU" ? fetchLuTsaAsNotams(qLat, qLon, raRadiusKm).catch(() => []) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const combinedNotams = [...notamResult.notams, ...luTsaNotams as unknown as NotamData[]];
        const { geozones: permZones, tempRestrictions } = separateTempRestrictions(zones);
        const allDipul = [...dipulResult.active, ...dipulResult.upcoming];
        const f = weatherData?.forecasts?.[0];
        const currentKpValue = kpTl.length > 0 ? getKpForHour(kpTl, new Date()) : kp?.value ?? null;
        const isCritical = !!(f && (
          f.windSpeed > 10 ||
          (f.windGust != null && f.windGust > 12) ||
          f.rain > 0.5 ||
          f.snow > 0.5 ||
          f.temperature < -5 ||
          (f.visibility != null && f.visibility < 500)
        )) || !!(currentKpValue != null && currentKpValue >= 6);
        const isCaution = !isCritical && !!(f && (
          f.windSpeed > 7 ||
          (f.windGust != null && f.windGust > 9) ||
          f.rain > 0.1 ||
          f.snow > 0.1 ||
          f.temperature < 0 ||
          f.cloudCover > 80 ||
          (f.visibility != null && f.visibility < 1000)
        )) || (!isCritical && !!(currentKpValue != null && currentKpValue >= 4));
        const wStatus: "ok" | "caution" | "critical" | "unknown" = !f ? "unknown" : isCritical ? "critical" : isCaution ? "caution" : "ok";
        setWeatherStatus(wStatus);
        const weatherCritical = isCritical;
        const notamCritical = combinedNotams.some((n) => getNotamSeverity(n) === "high") || tempRestrictions.length > 0 || allDipul.some((d) => d.status === "active");
        const geozoneCritical = permZones.length > 0;
        setAlertFlags({ wetter: weatherCritical, notam: notamCritical, geozone: geozoneCritical });
        if (f) setSidePanelWeather(f);
        if (weatherData?.forecasts) setSidePanelForecasts(weatherData.forecasts);
        setSidePanelKp(kp);
        if (kpTl.length > 0) setSidePanelKpTimeline(kpTl);
        setSidePanelNotams(combinedNotams);
        setSidePanelTempRestrictions(tempRestrictions);
        setSidePanelDipulRestrictions(allDipul);
        setSidePanelGeozones(permZones);
        const ck = makeCacheKey("radar_alerts", qLat, qLon);
        setCache(ck, { notams: combinedNotams, tempRestrictions, dipul: allDipul, geozones: permZones }).catch(() => {});
      } catch (e: any) {
        console.warn("[checkAlerts] error:", e?.message || e);
      }
    };
    checkAlerts();
    const iv = setInterval(checkAlerts, 120000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [stableAlertLat, stableAlertLon, raRadiusKm, detectedCountryIso]);

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
    setSidePanelLoading(true);
    try {
      if (panel === "geozone") {
        const zones = await queryGeozonesInArea(latitude, longitude, raRadiusKm, detectedCountryIso).catch((e) => { console.warn("[openSidePanel] geozone query failed:", e?.message || e); return [] as GeozoneFeatureInfo[]; });
        const { geozones: permZones, tempRestrictions } = separateTempRestrictions(zones);
        setSidePanelGeozones(permZones);
        setSidePanelTempRestrictions(tempRestrictions);
      } else if (panel === "notam") {
        const [result, zones, dipulResult, luTsaNotams] = await Promise.all([
          fetchNotams(latitude, longitude),
          queryGeozonesInArea(latitude, longitude, raRadiusKm, detectedCountryIso).catch(() => [] as GeozoneFeatureInfo[]),
          fetchNearbyTempRestrictions(latitude, longitude, raRadiusKm).catch(() => ({ active: [] as DipulTempRestriction[], upcoming: [] as DipulTempRestriction[] })),
          detectedCountryIso === "LU" ? fetchLuTsaAsNotams(latitude, longitude, raRadiusKm).catch(() => []) : Promise.resolve([]),
        ]);
        const { tempRestrictions } = separateTempRestrictions(zones);
        const combinedNotams = [...result.notams, ...luTsaNotams as unknown as NotamData[]];
        setSidePanelNotams(combinedNotams);
        setSidePanelTempRestrictions(tempRestrictions);
        setSidePanelDipulRestrictions([...dipulResult.active, ...dipulResult.upcoming]);
      } else if (panel === "wetter") {
        const [data, kpTl] = await Promise.all([
          fetchWeather(latitude, longitude, 1440),
          fetchKpTimeline().catch(() => [] as KpTimeEntry[]),
        ]);
        if (data.forecasts.length > 0) setSidePanelWeather(data.forecasts[0]);
        setSidePanelForecasts(data.forecasts);
        const currentKpVal = kpTl.length > 0 ? getKpForHour(kpTl, new Date()) : null;
        setSidePanelKp(currentKpVal != null ? { value: currentKpVal, timestamp: new Date().toISOString(), level: currentKpVal >= 6 ? "Sturm" : currentKpVal >= 4 ? "unruhig" : "ruhig", color: currentKpVal >= 6 ? "#FF3B30" : currentKpVal >= 4 ? "#FF9500" : "#34C759", description: currentKpVal >= 6 ? "Geomagnetischer Sturm" : currentKpVal >= 4 ? "Erhöhte Aktivität" : "Ruhig" } : null);
      }
    } catch {}
    setSidePanelLoading(false);
  }, [sidePanel, latitude, longitude, raRadiusKm, detectedCountryIso, sidePanelGeozones.length, sidePanelNotams.length, sidePanelTempRestrictions.length, sidePanelDipulRestrictions.length]);

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
    } catch {}
  }, [isCustomLocation]);

  const sortedAircraft = useMemo(() => {
    const sorted = [...aircraft].sort((a, b) => {
      const altA = a.aglAltitude ?? a.geoAltitude ?? a.baroAltitude ?? 99999;
      const altB = b.aglAltitude ?? b.geoAltitude ?? b.baroAltitude ?? 99999;
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
    if (f.cloudCover > 90) alerts.push({ label: "Wolken", value: Math.round(f.cloudCover) + "%", color: orange });
    if (f.visibility != null && f.visibility < 500) alerts.push({ label: "Sicht", value: Math.round(f.visibility) + "m", color: red });
    else if (f.visibility != null && f.visibility < 1000) alerts.push({ label: "Sicht", value: Math.round(f.visibility) + "m", color: orange });
    if (f.humidity > 95) alerts.push({ label: "Feuchte", value: Math.round(f.humidity) + "%", color: orange });
    const kpVal = sidePanelKpTimeline.length > 0 ? getKpForHour(sidePanelKpTimeline, new Date()) : sidePanelKp?.value ?? null;
    if (kpVal != null && kpVal >= 6) alerts.push({ label: "KP", value: kpVal.toFixed(1), color: red });
    else if (kpVal != null && kpVal >= 4) alerts.push({ label: "KP", value: kpVal.toFixed(1), color: orange });
    return alerts;
  }, [sidePanelWeather, sidePanelKp, sidePanelKpTimeline]);

  const getAltitudeColor = (alt: number | null) => {
    if (alt == null) return theme.textTertiary;
    if (alt < 150) return theme.statusNoGo;
    if (alt < 500) return theme.statusCaution;
    return theme.statusGo;
  };

  const showLoading = !permission;
  const showPermRequest = !!permission && !permission.granted;
  const showLocLoading = !!permission && permission.granted && locationLoading;
  const showLocError = !!permission && permission.granted && !locationLoading && (!!locationError || latitude == null || longitude == null);

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

  const sourceStatusDot = (status: "ok" | "error" | "timeout") => {
    if (status === "ok") return "#34C759";
    if (status === "timeout") return "#FF9500";
    return "#FF3B30";
  };

  const listHeaderContent = (
    <View style={styles.headerSection}>
      <ProximityAlarmBanner alerts={activeAlerts} alarmActive={alarmActive} alarmLevel={alarmLevel} clearOfConflict={clearOfConflict} maxAltitudeM={alarmSettings.maxAltitudeM} onDismiss={dismissAlarm} />
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

  const countryLayers = useMemo(() => getCountryGeozoneLayers(detectedCountryIso), [detectedCountryIso]);

  const toggleGeozoneLayer = (layerId: string) => {
    const config = getCountryGeozoneConfig(detectedCountryIso);
    if (config.forceEnabledLayerIds.includes(layerId) && geozoneSettings[layerId]) return;
    const updated = { ...geozoneSettings, [layerId]: !geozoneSettings[layerId] };
    setGeozoneSettings(updated);
    saveGeozoneSettings(updated, detectedCountryIso);
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
        <View style={styles.geozoneToggleAllRow}>
          <Pressable
            onPress={() => {
              const config = getCountryGeozoneConfig(detectedCountryIso);
              const allOn = countryLayers.every((l) => geozoneSettings[l.id]);
              const next: Record<string, boolean> = {};
              countryLayers.forEach((l) => {
                const forced = config.forceEnabledLayerIds.includes(l.id);
                next[l.id] = forced ? true : !allOn;
              });
              setGeozoneSettings(next);
              saveGeozoneSettings(next, detectedCountryIso);
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch (_e) {}
            }}
            style={[styles.geozoneToggleAllBtn, { backgroundColor: theme.primary + "18" }]}
          >
            <Feather
              name={countryLayers.every((l) => geozoneSettings[l.id]) ? "x-square" : "check-square"}
              size={16}
              color={theme.primary}
            />
            <Text style={[styles.geozoneToggleAllText, { color: theme.primary }]}>
              {countryLayers.every((l) => geozoneSettings[l.id]) ? "Alle ausschalten" : "Alle einschalten"}
            </Text>
          </Pressable>
        </View>
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
                  <>
                    <View style={[styles.layerInfoHinweisBox, { backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.4)" }]}>
                      <Text style={[styles.layerInfoText, { color: isDark ? "#F5D080" : "#92400E" }]}>{layerInfoData.hinweis}</Text>
                    </View>
                  </>
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

  if (showLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centerState, { paddingTop: insets.top + Spacing.xl }]}>
          <ActivityIndicator size="large" color={theme.primary} />
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
              latitude={latitude!}
              longitude={longitude!}
              latDelta={latDelta}
              lonDelta={lonDelta}
              locationName={locationName}
              markers={showTraffic ? mapMarkers : []}
              trails={showTraffic ? coloredTrails : []}
              fullScreen
              alarmRadiusM={(alarmSettings.ra?.radiusKm ?? 1) * 1000}
              taRadiusM={(alarmSettings.ta?.radiusKm ?? 3) * 1000}
              scanRadiusM={showRadar ? radiusKm * 1000 : 0}
              onLongPress={handleMapLongPress}
              wind={showWindsock ? wind : null}
              sourceStatus={sourceStatus}
              geozoneLayers={showGeozones ? activeGeozoneLayers : []}
              countryIso={detectedCountryIso}
              mapStyle={mapStyle}
              onCenterGps={handleCenterOnGps}
              onSettingsPress={() => { setShowMapConfig(!showMapConfig); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              settingsActive={showMapConfig}
              bottomPadding={showWeatherOverlay && sidePanelForecasts.length > 0 ? 290 : 0}
              topInset={safeTop}
              weatherAlerts={mapWeatherAlerts}
              onHeadingChange={handleHeadingChange}
              disableGeozoneQuery
            />
          </View>
          {nearbyCtr.length > 0 ? (
            <View style={{ position: "absolute", top: safeTop + 60, right: 12, zIndex: 105 }}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (nearbyCtr.length === 1) {
                    Linking.openURL(`tel:${nearbyCtr[0].towerPhone.replace(/\s/g, "")}`).catch(() => {});
                  } else {
                    setShowCtrEmergency(true);
                  }
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  setShowCtrEmergency(true);
                }}
                style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: "#FF3B30",
                  alignItems: "center", justifyContent: "center",
                  shadowColor: "#FF3B30", shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
                  elevation: 6,
                }}
                testID="radar-ctr-emergency-btn"
              >
                <Feather name="phone" size={22} color="#fff" />
              </Pressable>
              <View style={{
                marginTop: 4, alignItems: "center",
                backgroundColor: isDark ? "rgba(30,10,10,0.85)" : "rgba(255,240,240,0.95)",
                paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
              }}>
                <Text style={{ fontSize: 8, fontWeight: "700", color: "#FF3B30", textAlign: "center" }}>TOWER</Text>
                <Text style={{ fontSize: 7, color: isDark ? "rgba(255,180,180,0.9)" : "#FF3B30", textAlign: "center" }}>{nearbyCtr[0].icao}</Text>
              </View>
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
                      <Text style={{ fontSize: 17, fontWeight: "700", color: isDark ? "#fff" : "#000" }}>Kontrollzone \u2014 Tower-Notfallkontakt</Text>
                      <Text style={{ fontSize: 12, color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)", marginTop: 2 }}>
                        Au\u00dfer Kontrolle geratenes UAS sofort melden!
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
                            {ctr.icao} \u2014 {getCtrCategoryLabel(ctr.category)}
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
                        </View>
                        <Pressable
                          onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            Linking.openURL(`tel:${ctr.towerPhone.replace(/\s/g, "")}`).catch(() => {});
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
                    <Text style={{ fontSize: 15, fontWeight: "600", color: isDark ? "#fff" : "#000" }}>Schlie\u00dfen</Text>
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
          <SideTabs activePanel={sidePanel} onPress={openSidePanel} isDark={isDark} safeTop={safeTop} alertFlags={alertFlags} weatherStatus={weatherStatus} hideWetter={showWeatherOverlay} hasGeozones={sidePanelGeozones.length > 0} hasActiveGeozones={sidePanelGeozones.some((z) => { const lines = z.details.split("\n"); const st = lines.find((l) => l.startsWith("Status:")); if (!st || !/Inaktiv/i.test(st)) return true; const vl = lines.find((l) => l.startsWith("Von:")); if (!vl) return true; const vm = vl.replace("Von:", "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{2}):(\d{2})/); if (!vm) return true; return new Date(parseInt(vm[3]), parseInt(vm[2]) - 1, parseInt(vm[1]), parseInt(vm[4]), parseInt(vm[5])).getTime() <= Date.now(); })} hasNotams={sidePanelNotams.length > 0 || sidePanelTempRestrictions.length > 0 || sidePanelDipulRestrictions.length > 0} radarAlarmLevel={alarmLevel} hasLowAltTraffic={lowAltitudeCount > 0} hideRadar={!showRadar} />
          {sidePanel ? (
            <SidePanelView
              panel={sidePanel}
              loading={sidePanel === "radar" ? false : sidePanelLoading}
              geozones={sidePanelGeozones}
              tempRestrictions={sidePanelTempRestrictions}
              dipulRestrictions={sidePanelDipulRestrictions}
              notams={sidePanelNotams}
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
              onToggleRadar={() => setShowRadar((v) => { const n = !v; saveRadarSettings({ showRadar: n }); return n; })}
              onToggleWindsock={() => setShowWindsock((v) => { const n = !v; saveRadarSettings({ showWindsock: n }); return n; })}
              onToggleGeozones={() => setShowGeozones((v) => { const n = !v; saveRadarSettings({ showGeozones: n }); return n; })}
              onToggleTraffic={() => setShowTraffic((v) => { const n = !v; saveRadarSettings({ showTraffic: n }); return n; })}
              showWeatherOverlay={showWeatherOverlay}
              onToggleWeatherOverlay={() => setShowWeatherOverlay((v) => { const n = !v; saveRadarSettings({ showWeatherOverlay: n }); return n; })}
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

function SideTabs({ activePanel, onPress, isDark, safeTop, alertFlags, weatherStatus, hideWetter, hasGeozones, hasActiveGeozones, hasNotams, radarAlarmLevel, hasLowAltTraffic, hideRadar }: {
  activePanel: "geozone" | "notam" | "wetter" | "radar" | null;
  onPress: (p: "geozone" | "notam" | "wetter" | "radar") => void;
  isDark: boolean;
  safeTop: number;
  alertFlags: { wetter: boolean; notam: boolean; geozone: boolean };
  weatherStatus: "unknown" | "ok" | "caution" | "critical";
  hideWetter?: boolean;
  hasGeozones?: boolean;
  hasActiveGeozones?: boolean;
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
  const panelBg = isDark ? "rgba(12, 18, 38, 0.94)" : "rgba(255, 255, 255, 0.96)";
  const hasOpenPanel = activePanel != null;

  function getTabStatus(id: string): { bg: string; shouldPulse: boolean; pulseColor?: string; textWhite: boolean } {
    const greenColor = "#22C55E";
    const orangeColor = "#FF9500";
    const redColor = "#FF3B30";
    const defaultBg = isDark ? "rgba(20, 30, 55, 0.88)" : "rgba(255, 255, 255, 0.92)";

    if (id === "geozone") {
      if (hasActiveGeozones) return { bg: orangeColor, shouldPulse: false, textWhite: true };
      if (hasGeozones) return { bg: "#4A90D9", shouldPulse: false, textWhite: true };
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

  return (
    <View style={[sideTabStyles.container, { top: safeTop + 8 }]}>
      {tabs.map((t) => {
        const isActive = activePanel === t.id;
        if (hasOpenPanel) return null;
        if (t.id === "wetter" && hideWetter) return null;
        if (t.id === "radar" && hideRadar) return null;
        const status = getTabStatus(t.id);
        const solidBg = isActive ? panelBg : (t.id === "radar" && status.shouldPulse ? "transparent" : status.bg);
        return (
          <Pressable
            key={t.id}
            onPress={() => { onPress(t.id); try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {} }}
            style={[
              sideTabStyles.tab,
              { backgroundColor: solidBg },
            ]}
          >
            {status.shouldPulse && !isActive ? (
              <PulsingTabBg color={status.pulseColor!} />
            ) : null}
            <View style={sideTabStyles.tabRotateWrap}>
              <Text style={[sideTabStyles.tabLabel, {
                color: isActive ? (isDark ? "rgba(180,200,230,0.85)" : "#444444") : status.textWhite ? "#FFFFFF" : isDark ? "rgba(180,200,230,0.85)" : "#444444",
                fontWeight: "800",
              }]}>{t.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
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

const PANEL_INFO: Record<string, { title: string; text: string }> = {
  geozone: {
    title: "Geozonen und Lufträume",
    text: "Geozonen sind geografische Gebiete, in denen Vorschriften und Einschränkungen für den Betrieb von Drohnen gelten.\n\nIn dieser Ansicht werden Geozonen angezeigt, die Ihren Flugbereich (RA-Radius) berühren. Die Daten stammen vom dipul WMS-Dienst des DFS.\n\nBitte informieren Sie sich über die geltenden Rechtsvorschriften und holen Sie gegebenenfalls erforderliche Genehmigungen ein, wenn Sie innerhalb einer Geozone oder eines beschränkten Luftraums fliegen möchten.\n\nWeitere Informationen unter dipul.de",
  },
  notam: {
    title: "NOTAMs & Temporäre Einschränkungen",
    text: "NOTAMs (Notice to Airmen) sind offizielle Mitteilungen über besondere Änderungen, Einschränkungen oder Gefahren im Luftraum.\n\nAls Luftverkehrsteilnehmer sind Sie verpflichtet, sich vor jedem Flug über die für Ihr Gebiet relevanten NOTAMs zu informieren.\n\nDie Daten stammen von autorouter.aero (Eurocontrol EAD).\n\nZusätzlich werden temporäre Betriebseinschränkungen vom dipul WMS-Dienst des DFS angezeigt (z.B. bei Großveranstaltungen, Staatsbesuchen oder besonderen Sicherheitslagen). Diese werden mit dem Badge \"dipul\" gekennzeichnet.\n\nWichtig: Zeitangaben in NOTAMs basieren auf der koordinierten Weltzeit (UTC).\n\nHäufige Begriffe:\n- AGL: Above Ground Level — Höhe über Grund\n- AMSL: Above Mean Sea Level — Höhe über dem mittleren Meeresspiegel\n- SFC: Surface — Ab der Erdoberfläche\n- FL: Flight Level — Standardisierte Höhenangabe (1013,25 hPa)",
  },
  wetter: {
    title: "Wetterdaten",
    text: "Die Wetterdaten stammen vom DFS dipul Weather Service (ICON-D2 Modell, 2km Raster).\n\nAngezeigt werden Temperatur in 6 Höhen (2/50/100/150/200/250m AGL), Wind in 6 Höhen (10/50/100/150/200/250m AGL), Böen, Windrichtung, Wolkenbedeckung, Niederschlag, Luftfeuchtigkeit, QNH und Sichtweite.\n\nDer KP-Index zeigt die geomagnetische Aktivität (NOAA SWPC). Bei KP >= 5 können GPS-Störungen auftreten, die den Drohnenflug beeinträchtigen.\n\nRot markierte Werte überschreiten die Grenzwerte für sicheres Fliegen:\n- Bodenwind > 10 m/s\n- Böen > 12 m/s\n- Höhenwind > 12 m/s\n- Regen > 0.5 mm/h\n- Temperatur < -5°C\n- Sicht < 1000m\n- KP-Index >= 5",
  },
  radar: {
    title: "Live Radar",
    text: "Der Live Radar zeigt Flugzeuge in Ihrer Nähe in Echtzeit an.\n\nDie Daten werden aus 6 Quellen zusammengeführt:\n- OpenSky Network\n- adsb.fi\n- adsb.one\n- airplanes.live\n- adsb.lol\n- OGN (Open Glider Network)\n\nOGN liefert Positionen von Segelflugzeugen, Ultraleichtflugzeugen, Ballonen und anderen Luftfahrzeugen mit FLARM-Transponder.\n\nDie Farbpunkte zeigen den Status jeder Quelle (grün = aktiv).\n\nTiefflüge (< 500m) werden orange hervorgehoben.\n\nLange auf die Karte drücken, um den Radar-Standort manuell zu setzen.",
  },
};

function getRegInfoForLayer(layerLabel: string): GeozoneRegulatoryInfo | null {
  const allLayers = [...GEOZONE_LAYERS, ...getCountryGeozoneLayers("CH"), ...getCountryGeozoneLayers("LU"), ...getCountryGeozoneLayers("NL")];
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

function SidePanelView({ panel, loading, geozones, tempRestrictions, dipulRestrictions, notams, weather, forecasts, kpIndex, kpTimeline = [], wind, isDark, safeTop, onClose, radarData, weatherStatus = "unknown", latitude: propLat, longitude: propLon }: {
  panel: "geozone" | "notam" | "wetter" | "radar";
  loading: boolean;
  geozones: GeozoneFeatureInfo[];
  tempRestrictions: GeozoneFeatureInfo[];
  dipulRestrictions: DipulTempRestriction[];
  notams: NotamData[];
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
  const [showInfo, setShowInfo] = useState(false);
  const [expandedRegInfo, setExpandedRegInfo] = useState<number | null>(null);
  const panelBg = isDark ? "rgba(12, 18, 38, 0.94)" : "rgba(255, 255, 255, 0.96)";
  const textColor = isDark ? "#D0DDF0" : "#1A1A2E";
  const mutedColor = isDark ? "rgba(160,180,210,0.7)" : "rgba(80,80,100,0.6)";
  const divColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const wetterAccent = weatherStatus === "critical" ? "#FF3B30" : weatherStatus === "caution" ? "#FF9500" : "#22C55E";
  const accentColor = panel === "geozone" ? "#4A90D9" : panel === "notam" ? "#F59E0B" : panel === "radar" ? "#AF52DE" : wetterAccent;
  const info = PANEL_INFO[panel];

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
      <Modal visible={showInfo} transparent animationType="fade" onRequestClose={() => setShowInfo(false)}>
        <Pressable style={sidePanelStyles.infoOverlay} onPress={() => setShowInfo(false)}>
          <View style={[sidePanelStyles.infoModal, { backgroundColor: isDark ? "rgba(15, 22, 45, 0.97)" : "rgba(255,255,255,0.98)" }]}>
            <Text style={[sidePanelStyles.infoModalTitle, { color: accentColor }]}>{info.title}</Text>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              <Text style={[sidePanelStyles.infoModalText, { color: textColor }]}>{info.text}</Text>
            </ScrollView>
            <Pressable onPress={() => setShowInfo(false)} style={[sidePanelStyles.infoModalOk, { backgroundColor: accentColor }]}>
              <Text style={sidePanelStyles.infoModalOkText}>OK</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
      {loading ? (
        <View style={sidePanelStyles.loadingWrap}>
          <ActivityIndicator size="small" color={accentColor} />
        </View>
      ) : (
        <ScrollView style={sidePanelStyles.scrollArea} showsVerticalScrollIndicator={false}>
          {panel === "geozone" ? (
            geozones.length > 0 ? (
              <View style={{ gap: 6 }}>
                {(() => {
                  const isZoneFutureOnly = (z: GeozoneFeatureInfo) => {
                    const lines = z.details.split("\n");
                    const statusLine = lines.find((l) => l.startsWith("Status:"));
                    const isInactive = statusLine ? /Inaktiv/i.test(statusLine) : false;
                    if (!isInactive) return false;
                    const vonLine = lines.find((l) => l.startsWith("Von:"));
                    if (!vonLine) return false;
                    const vonVal = vonLine.replace("Von:", "").trim();
                    const m = vonVal.match(/^(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{2}):(\d{2})/);
                    if (!m) return false;
                    const vonDate = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]), parseInt(m[4]), parseInt(m[5]));
                    return vonDate.getTime() > Date.now();
                  };
                  const activeZones = geozones.filter((z) => !isZoneFutureOnly(z));
                  const futureZones = geozones.filter((z) => isZoneFutureOnly(z));
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
                            {futureZones.length} geplante Zone{futureZones.length !== 1 ? "n" : ""} — derzeit nicht aktiv
                          </Text>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
                {geozones.map((z, i) => {
                  const details = z.details.split("\n").filter((d) => d.trim().length > 0);
                  const regInfo = getRegInfoForLayer(z.layerLabel);
                  const isExpanded = expandedRegInfo === i;
                  const zoneLines = z.details.split("\n");
                  const zStatusLine = zoneLines.find((l) => l.startsWith("Status:"));
                  const zIsInactive = zStatusLine ? /Inaktiv/i.test(zStatusLine) : false;
                  const zVonLine = zoneLines.find((l) => l.startsWith("Von:"));
                  const zIsFuture = (() => {
                    if (!zIsInactive || !zVonLine) return false;
                    const vm = zVonLine.replace("Von:", "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4}),?\s*(\d{2}):(\d{2})/);
                    if (!vm) return false;
                    return new Date(parseInt(vm[3]), parseInt(vm[2]) - 1, parseInt(vm[1]), parseInt(vm[4]), parseInt(vm[5])).getTime() > Date.now();
                  })();
                  const cardBorderColor = zIsFuture
                    ? (isDark ? "rgba(142,142,147,0.3)" : "rgba(142,142,147,0.25)")
                    : (isDark ? "rgba(74,144,217,0.4)" : "rgba(74,144,217,0.3)");
                  const badgeColor = zIsFuture ? (isDark ? "#8E8E93" : "#8E8E93") : "#4A90D9";
                  return (
                    <View key={`${z.layerLabel}-${z.name}-${i}`} style={[sidePanelStyles.geozoneCard, { borderColor: cardBorderColor, opacity: zIsFuture ? 0.75 : 1 }]}>
                      <View style={sidePanelStyles.geozoneHeader}>
                        <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: badgeColor }]}>
                          <Text style={sidePanelStyles.geozoneBadgeText}>{z.layerLabel}</Text>
                        </View>
                        {zIsFuture ? (
                          <View style={[sidePanelStyles.geozoneBadge, { backgroundColor: isDark ? "rgba(142,142,147,0.25)" : "rgba(142,142,147,0.15)", marginLeft: 4 }]}>
                            <Text style={[sidePanelStyles.geozoneBadgeText, { color: isDark ? "#AEAEB2" : "#8E8E93" }]}>geplant</Text>
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
                        const parts = line.split(":");
                        return parts.length >= 2 ? (
                          <View key={li} style={sidePanelStyles.geozoneDetailRow}>
                            <Text style={[sidePanelStyles.geozoneDetailKey, { color: mutedColor }]}>{parts[0].trim()}</Text>
                            <Text style={[sidePanelStyles.geozoneDetailVal, { color: textColor }]}>{parts.slice(1).join(":").trim()}</Text>
                          </View>
                        ) : (
                          <Text key={li} style={[sidePanelStyles.geozoneDetailVal, { color: mutedColor }]}>{line}</Text>
                        );
                      }) : null}
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
                            const zoneContacts = getContactsForZone(z.layerLabel, z.name);
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
                })}
              </View>
            ) : (
              <View style={{ gap: 6 }}>
                <View style={[sidePanelStyles.infoBoxOk, { backgroundColor: isDark ? "rgba(52,199,89,0.15)" : "rgba(52,199,89,0.12)" }]}>
                  <Feather name="check-circle" size={14} color={isDark ? "#FFFFFF" : "#248A3D"} />
                  <Text style={[sidePanelStyles.infoBoxText, { color: isDark ? "#FFFFFF" : "#248A3D" }]}>Keine Geozonen im Flugbereich</Text>
                </View>
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
                          <Text style={{ color: borderColor, fontSize: 12, fontWeight: "600" }}>{dipulUrl ? "Details auf dipul.de" : "Alle Einschränkungen auf dipul.de"}</Text>
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
              {notams.length === 0 && dipulRestrictions.length === 0 && tempRestrictions.length === 0 ? (
                <Text style={[sidePanelStyles.emptyText, { color: mutedColor }]}>Keine NOTAMs oder temporären Einschränkungen</Text>
              ) : null}
            </View>
          ) : null}
          {panel === "wetter" ? (
            forecasts.length > 0 ? (
              (() => {
                const P_ROW_H = 22;
                const P_HEADER_H = 26;
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
                  { key: "kp", label: "KP", icon: "zap", iconColor: "#FFD60A" },
                ];

                const pSlots: ForecastData[] = [];
                const usedH = new Set<number>();
                for (let i = 0; i < forecasts.length && pSlots.length < 24; i++) {
                  const h = new Date(forecasts[i].timestamp).getHours();
                  if (!usedH.has(h)) { usedH.add(h); pSlots.push(forecasts[i]); }
                }

                function getKpForFc(fc: ForecastData): number | null {
                  if (kpTimeline.length > 0) return getKpForHour(kpTimeline, new Date(fc.timestamp));
                  return kpIndex?.value ?? null;
                }

                function getWindAtHeight(fc: ForecastData, height: number): { speed: number; gust?: number; direction: number } | null {
                  const w = fc.windAtAltitude?.find((a) => a.height === height);
                  return w ? { speed: w.speed, gust: w.gust, direction: w.direction } : null;
                }

                function getTempAtHeight(fc: ForecastData, height: number): number | null {
                  const t = fc.temperatureAtAltitude?.find((a) => a.height === height);
                  return t ? t.value : null;
                }

                function pCellVal(fc: ForecastData, key: PRowKey): string {
                  switch (key) {
                    case "temp": return fc.temperature.toFixed(1) + "°";
                    case "temp50": { const v = getTempAtHeight(fc, 50); return v != null ? v.toFixed(1) + "°" : "-"; }
                    case "temp100": { const v = getTempAtHeight(fc, 100); return v != null ? v.toFixed(1) + "°" : "-"; }
                    case "temp150": { const v = getTempAtHeight(fc, 150); return v != null ? v.toFixed(1) + "°" : "-"; }
                    case "temp200": { const v = getTempAtHeight(fc, 200); return v != null ? v.toFixed(1) + "°" : "-"; }
                    case "temp250": { const v = getTempAtHeight(fc, 250); return v != null ? v.toFixed(1) + "°" : "-"; }
                    case "wind": return fc.windSpeed.toFixed(1);
                    case "gust": return (fc.windGust ?? 0) > 0 ? (fc.windGust!).toFixed(1) : "-";
                    case "dir": { const dirs=["N","NO","O","SO","S","SW","W","NW"]; return Math.round(fc.windDirection)+"°"+(dirs[Math.round(fc.windDirection/45)%8]||""); }
                    case "wind50": { const w = getWindAtHeight(fc, 50); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind100": { const w = getWindAtHeight(fc, 100); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind150": { const w = getWindAtHeight(fc, 150); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind200": { const w = getWindAtHeight(fc, 200); return w ? w.speed.toFixed(1) : "-"; }
                    case "wind250": { const w = getWindAtHeight(fc, 250); return w ? w.speed.toFixed(1) : "-"; }
                    case "cloud": return Math.round(fc.cloudCover)+"%";
                    case "rain": return fc.rain.toFixed(1);
                    case "humidity": return Math.round(fc.humidity)+"%";
                    case "qnh": return fc.pressure > 0 ? (fc.pressure/100).toFixed(1) : "-";
                    case "kp": { const v = getKpForFc(fc); return v != null ? v.toFixed(1) : "-"; }
                    default: return "-";
                  }
                }

                function pCellStatus(fc: ForecastData, key: PRowKey): "critical"|"caution"|"ok" {
                  switch (key) {
                    case "wind": return fc.windSpeed > 10 ? "critical" : fc.windSpeed > 7 ? "caution" : "ok";
                    case "gust": { const g=fc.windGust??0; return g>12?"critical":g>9?"caution":"ok"; }
                    case "temp": return fc.temperature < -5 ? "critical" : fc.temperature < 0 ? "caution" : "ok";
                    case "temp50":
                    case "temp100":
                    case "temp150":
                    case "temp200":
                    case "temp250": {
                      const hMap: Record<string, number> = { temp50: 50, temp100: 100, temp150: 150, temp200: 200, temp250: 250 };
                      const v = getTempAtHeight(fc, hMap[key]);
                      if (v == null) return "ok";
                      return v < -5 ? "critical" : v < 0 ? "caution" : "ok";
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
                    case "cloud": return fc.cloudCover > 90 ? "caution" : "ok";
                    case "rain": return fc.rain > 0.5 ? "critical" : fc.rain > 0.1 ? "caution" : "ok";
                    case "humidity": return fc.humidity > 95 ? "caution" : "ok";
                    case "kp": { const v=getKpForFc(fc)??0; return v>=6?"critical":v>=4?"caution":"ok"; }
                    default: return "ok";
                  }
                }

                function pColStatus(fc: ForecastData): "critical"|"caution"|"ok" {
                  let caution = false;
                  for (const r of pRows) { const s=pCellStatus(fc,r.key); if(s==="critical") return "critical"; if(s==="caution") caution=true; }
                  return caution ? "caution" : "ok";
                }

                const allRows = [
                  { key: "__header__", label: "Uhrzeit", icon: "", iconColor: "" },
                  ...pRows,
                ];

                const SOLAR_ROW_H = 48;
                const fmtSolarTime = (d: Date | null) => d ? d.getHours().toString().padStart(2,"0") + ":" + d.getMinutes().toString().padStart(2,"0") : "--:--";

                return (
                  <View style={{ flex: 1, flexDirection: "row" }}>
                    <View style={{ width: P_LABEL_W, backgroundColor: wLabelBg, borderRightWidth: 1, borderRightColor: wBorderColor }}>
                      <View style={{ height: P_HEADER_H, justifyContent: "center", paddingLeft: 6, borderBottomWidth: 1, borderBottomColor: wBorderColor }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: mutedColor }}>Uhrzeit</Text>
                      </View>
                      {(propLat != null && propLon != null) ? (() => {
                        const nowSolar = calculateSolarTimes(propLat, propLon, new Date());
                        return (
                          <View style={{ height: SOLAR_ROW_H, justifyContent: "center", paddingLeft: 5, gap: 2, borderBottomWidth: 1, borderBottomColor: wBorderColor }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                              <Feather name="sun" size={10} color="#FFB820" />
                              <Text style={{ fontSize: 10, fontWeight: "700", color: mutedColor }} numberOfLines={1}>Sonnenverlauf</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 1 }}>
                              <Feather name="sunrise" size={9} color="#FF8C00" />
                              <Text style={{ fontSize: 9, fontWeight: "600", color: mutedColor }}>{fmtSolarTime(nowSolar.sunrise)}</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingLeft: 1 }}>
                              <Feather name="sunset" size={9} color="#FF8C00" />
                              <Text style={{ fontSize: 9, fontWeight: "600", color: mutedColor }}>{fmtSolarTime(nowSolar.sunset)}</Text>
                            </View>
                          </View>
                        );
                      })() : null}
                      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces={false} scrollEnabled={false}>
                        {pRows.map((r) => (
                          <View key={r.key} style={{ height: P_ROW_H, flexDirection: "row", alignItems: "center", paddingLeft: 5, gap: 4, borderBottomWidth: 0.5, borderBottomColor: wBorderColor }}>
                            <Feather name={r.icon as any} size={11} color={r.iconColor} />
                            <Text style={{ fontSize: 11, fontWeight: "700", color: mutedColor }} numberOfLines={1}>{r.label}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }} style={{ flex: 1 }} bounces={true}>
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
                        {(propLat != null && propLon != null) ? (
                          <View style={{ flexDirection: "row", height: SOLAR_ROW_H, borderBottomWidth: 1, borderBottomColor: wBorderColor }}>
                            {pSlots.map((fc, idx) => {
                              const fcTime = new Date(fc.timestamp);
                              const solar = calculateSolarTimes(propLat, propLon, fcTime);
                              const isDay = isTimeDuringDaylight(fcTime, solar);
                              const isTwi = isTimeDuringCivilTwilight(fcTime, solar);
                              const isMorningTwi = isTwi && solar.sunrise && fcTime < solar.sunrise;

                              const hourStart = fcTime.getTime();
                              const hourEnd = hourStart + 3600000;
                              const hasSunrise = solar.sunrise && solar.sunrise.getTime() >= hourStart && solar.sunrise.getTime() < hourEnd;
                              const hasSunset = solar.sunset && solar.sunset.getTime() >= hourStart && solar.sunset.getTime() < hourEnd;

                              const stripDay = "#FFB820";
                              const stripTwi = "#FF8C00";
                              const stripNight = isDark ? "#2A3A5C" : "#8E9AB0";

                              const bgDay = "rgba(255,184,32,0.12)";
                              const bgTwi = "rgba(255,140,0,0.12)";
                              const bgNight = "rgba(107,127,160,0.08)";
                              const bg = isDay ? bgDay : isTwi ? bgTwi : bgNight;

                              const stripColor = isDay ? stripDay : isTwi ? stripTwi : stripNight;

                              const icon = hasSunset ? "sunset" : hasSunrise ? "sunrise" : isDay ? "sun" : isTwi ? (isMorningTwi ? "sunrise" : "sunset") : "moon";
                              const iconColor = (hasSunset || hasSunrise) ? "#FF8C00" : isDay ? "#FFB820" : isTwi ? "#FF8C00" : "#6B7FA0";
                              const iconSize = (hasSunset || hasSunrise) ? 16 : 13;

                              const sunsetFrac = hasSunset ? solar.sunset!.getMinutes() / 60 : 0;
                              const sunriseFrac = hasSunrise ? solar.sunrise!.getMinutes() / 60 : 0;

                              return (
                                <View key={idx} style={{ width: P_COL_W, height: SOLAR_ROW_H, borderRightWidth: 0.5, borderRightColor: wBorderColor, overflow: "hidden" }}>
                                  <View style={{ height: 5, flexDirection: "row" }}>
                                    {hasSunset ? (
                                      <>
                                        <View style={{ width: sunsetFrac * P_COL_W, height: 5, backgroundColor: stripDay }} />
                                        <View style={{ flex: 1, height: 5, backgroundColor: stripTwi }} />
                                      </>
                                    ) : hasSunrise ? (
                                      <>
                                        <View style={{ width: sunriseFrac * P_COL_W, height: 5, backgroundColor: stripNight }} />
                                        <View style={{ flex: 1, height: 5, backgroundColor: stripDay }} />
                                      </>
                                    ) : (
                                      <View style={{ flex: 1, height: 5, backgroundColor: stripColor }} />
                                    )}
                                  </View>
                                  <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: bg }}>
                                    <Feather name={icon as any} size={iconSize} color={iconColor} />
                                    {(hasSunset || hasSunrise) ? (
                                      <Text style={{ fontSize: 9, fontWeight: "800", color: iconColor, marginTop: 1 }}>
                                        {hasSunset ? fmtSolarTime(solar.sunset!) : fmtSolarTime(solar.sunrise!)}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        ) : null}
                        <View>
                          {pRows.map((r) => (
                            <View key={r.key} style={{ flexDirection: "row" }}>
                              {pSlots.map((fc, idx) => {
                                const cs = pCellStatus(fc, r.key);
                                const bg = cs==="critical" ? wWarnBg : cs==="caution" ? wCautionBg : "transparent";
                                const cl = cs==="critical" ? wWarnColor : cs==="caution" ? wCautionColor : textColor;
                                return (
                                  <View key={idx} style={{ width: P_COL_W, height: P_ROW_H, justifyContent: "center", alignItems: "center", backgroundColor: bg, borderBottomWidth: 0.5, borderBottomColor: wBorderColor, borderRightWidth: 0.5, borderRightColor: wBorderColor, paddingHorizontal: 2 }}>
                                    <Text style={{ fontSize: 12, fontWeight: cs!=="ok"?"800":"600", color: cl }} numberOfLines={1}>{pCellVal(fc, r.key)}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      </View>
                    </ScrollView>
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
              <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[{ fontSize: 12, fontWeight: "600", color: mutedColor }]}>Radius</Text>
                <Text style={[{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }]}>{radarData.radiusKm} km</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={[{ fontSize: 10, color: mutedColor }]}>3km</Text>
                <Slider
                  style={{ flex: 1, height: 30 }}
                  minimumValue={3}
                  maximumValue={30}
                  step={1}
                  value={radarData.radiusKm}
                  onSlidingComplete={(val) => {
                    radarData.onRadiusChange(Math.round(val));
                  }}
                  onValueChange={(val) => {
                    radarData.onRadiusChange(Math.round(val));
                  }}
                  minimumTrackTintColor="#AF52DE"
                  maximumTrackTintColor={isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}
                  thumbTintColor="#AF52DE"
                />
                <Text style={[{ fontSize: 10, color: mutedColor }]}>30km</Text>
              </View>
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
              <View style={[sidePanelStyles.divider, { backgroundColor: divColor }]} />
              <Text style={[{ fontSize: 12, fontWeight: "600", color: mutedColor }]}>Quellen</Text>
              <View style={sidePanelStyles.radarSourceRow}>
                {[
                  { label: "OpenSky", status: radarData.sourceStatus.opensky },
                  { label: "adsb.fi", status: radarData.sourceStatus.adsbfi },
                  { label: "adsb.one", status: radarData.sourceStatus.adsbone },
                  { label: "apl", status: radarData.sourceStatus.airplaneslive },
                  { label: "lol", status: radarData.sourceStatus.adsblol },
                  { label: "OGN", status: radarData.sourceStatus.ogn },
                ].map((s) => (
                  <View key={s.label} style={sidePanelStyles.radarSourceItem}>
                    <View style={[sidePanelStyles.radarSourceDot, { backgroundColor: s.status === "ok" ? "#34C759" : s.status === "error" ? "#FF3B30" : "#8E8E93" }]} />
                    <Text style={[{ fontSize: 11, color: mutedColor }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
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

const sideTabStyles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 0,
    zIndex: 130,
    gap: 4,
  },
  tab: {
    width: 38,
    height: 90,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: -3, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
    }),
  },
  tabRotateWrap: {
    width: 86,
    transform: [{ rotate: "90deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  activeStripe: {
    position: "absolute",
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 2,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
});

const sidePanelStyles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 125,
    height: "65%",
    maxHeight: "65%",
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
  infoOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  infoModal: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 14,
    padding: 20,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 16 },
      android: { elevation: 20 },
    }),
  },
  infoModalTitle: {
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 14,
  },
  infoModalText: {
    fontSize: 13,
    lineHeight: 20,
  },
  infoModalOk: {
    alignSelf: "flex-end",
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 8,
    marginTop: 16,
  },
  infoModalOkText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
  scrollArea: {
    paddingHorizontal: 14,
    paddingTop: 8,
    maxHeight: 500,
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
  },
  geozoneDetailVal: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
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
          fetchWeather(latitude, longitude, 1440).catch(() => null),
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
    const usedHours = new Set<number>();
    for (let i = 0; i < forecasts.length && result.length < 24; i++) {
      const h = new Date(forecasts[i].timestamp).getHours();
      if (!usedHours.has(h)) {
        usedHours.add(h);
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
    { key: "kp", label: "KP", icon: "zap", iconColor: "#FFD60A" },
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
      case "wind": return fc.windSpeed.toFixed(1);
      case "gust": return (fc.windGust ?? 0) > 0 ? (fc.windGust!).toFixed(1) : "-";
      case "temp": return fc.temperature.toFixed(1) + "°";
      case "cloud": return Math.round(fc.cloudCover) + "%";
      case "rain": return fc.rain.toFixed(1);
      case "humidity": return Math.round(fc.humidity) + "%";
      case "vis": return fc.visibility != null ? (fc.visibility < 1000 ? Math.round(fc.visibility) + "m" : (fc.visibility / 1000).toFixed(1) + "k") : "n/a";
      case "qnh": return fc.pressure > 0 ? (fc.pressure / 100).toFixed(1) : "-";
      case "dir": {
        const dirs = ["N","NO","O","SO","S","SW","W","NW"];
        const dirIdx = Math.round(fc.windDirection / 45) % 8;
        return Math.round(fc.windDirection) + "°" + (dirs[dirIdx] || "");
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
        if (v != null && v >= 4) return "caution";
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
                  const cellBg = cellStatus === "critical" ? warnBg : cellStatus === "caution" ? cautionBg : "transparent";
                  const cellColor = cellStatus === "critical" ? warnColor : cellStatus === "caution" ? cautionColor : textColor;
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
  showWeatherOverlay: boolean;
  onToggleRadar: () => void;
  onToggleWindsock: () => void;
  onToggleGeozones: () => void;
  onToggleTraffic: () => void;
  onToggleWeatherOverlay: () => void;
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
  mapStyle, showRadar, showWindsock, showGeozones, showTraffic, showWeatherOverlay,
  onToggleRadar, onToggleWindsock,
  onToggleGeozones, onToggleTraffic, onToggleWeatherOverlay, onOpenGeozoneDetail, onMapStyleChange,
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
  return (
    <View style={[panelStyles.configPopup, { top: 240, backgroundColor: popupBg }]}>
      <Text style={[panelStyles.configSectionTitle, { color: sectionColor }]}>KARTE</Text>
      <View style={[panelStyles.mapSegmented, { backgroundColor: segTrackBg }]}>
        {([
          { id: "standard" as MapStyleOption, label: "Normal" },
          { id: "satellite" as MapStyleOption, label: "Satellit" },
          { id: "osm" as MapStyleOption, label: "OSM" },
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
    </View>
  );
}
