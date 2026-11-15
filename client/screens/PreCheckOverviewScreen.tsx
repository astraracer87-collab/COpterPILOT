import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import MapView, { Circle, Marker, Polygon, UrlTile, WMSTile } from "@/components/maps";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "@/lib/webBrowser";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useMapBasemapStyle } from "@/hooks/useMapBasemapStyle";
import { GRAYSCALE_BASEMAP_TILE_URL, nativeMapBasemapProps } from "@/lib/mapBasemap";
import { useShowDataSources } from "@/lib/dataSource";
import { attributionLabel } from "@/lib/sourceAttribution";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import { uncoveredGeozoneSources, sourceCoverageWarning, type GeozoneSourceCoverage } from "@/lib/geozoneCoverage";
import { zonePolicy, RESTRICTION_POLICY } from "../../shared/restrictionPolicy";
import { evaluateZones } from "@/lib/flightChecks";
import { aggregate, coverageChecks, formatCoverageDataAges, formatCoverageTruncation, notamChecks, replaceCheckCategories } from "../../shared/checks";
import { useGeozoneRevalidation, useVerdictChangeWatch } from "@/lib/geozoneSources/useGeozoneRevalidation";
import { GeozoneDataChangedBanner } from "@/components/GeozoneDataChangedBanner";
import { DataStandLines } from "@/components/DataStandLines";
import { EnableCountryButtons } from "@/components/EnableCountryButtons";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";
import {
  queryGeozonesInAreaWithCoverage,
  GeozoneFeatureInfo,
  separateTempRestrictions,
  fetchNearbyTempRestrictions,
  DipulTempRestriction,
  DipulTempRestrictionsResult,
  buildCombinedWmsTileUrl,
  loadGeozoneSettings,
  getActiveLayerNames,
  getCountriesInRadius,
  getCountryGeozoneConfig,
  ringGroupsForZone,
} from "@/lib/geozones";
import { GEOZONE_VECTOR_MAX_FEATURES } from "@/lib/geozoneZoom";
import { findMilLowFlightAreasContaining, findMilLowFlightAreasIntersectingRadius, findMilLowFlightAreasOnRoute, MIL_LOW_FLIGHT_LABEL, MIL_LOW_FLIGHT_ACTIVATION_TEXT, MIL_LOW_FLIGHT_DATA_STAND, MIL_LOW_FLIGHT_SOURCE_URL } from "@/lib/milLowFlight";
import { smoothRingGroup } from "@/lib/ringSimplify";
import { isZoneActiveInContext, ed269InactiveInfoText, type ZoneTimeContext } from "@/lib/ed269";
import {
  getPilotProfile,
  PilotProfile,
  isDe21hZoneAvEligible,
  isErlaubnisExpired,
  Bundesland,
  updateFlightSession,
  getFlightSession,
  getDrone,
  getSettings,
  DEFAULT_LIMITS,
  WeatherLimits,
  DroneProfile,
} from "@/lib/storage";
import { WildlifeRescueInfoModal } from "@/components/WildlifeRescueInfo";
import { WILDLIFE_RESCUE_MODE_TITLE, WILDLIFE_RESCUE_PLANNING_HINT } from "../../shared/wildlifeRescue";
import { detectBundeslandFromCoordinates } from "@/lib/countryMaps";
import { fetchHourlyForecasts, type HourlyForecastSlot } from "@/lib/weather";
import HourlyForecastTable from "@/components/HourlyForecastTable";
import { useAuth } from "@/lib/auth";
import { splitCountriesByAccess, countryName } from "../../shared/countryEntitlements";

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

function formatRecurRule(rules: string[]): string | null {
  if (!rules || rules.length === 0) return null;
  const rule = rules[0];
  if (rule.includes("FREQ=DAILY")) return "Täglich aktiv";
  if (rule.includes("FREQ=WEEKLY")) return "Wöchentlich aktiv";
  if (rule.includes("FREQ=MONTHLY")) return "Monatlich aktiv";
  return "Wiederkehrend";
}

export default function PreCheckOverviewScreen() {
  const [mapStyle] = useMapBasemapStyle();
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const isAdmin = useShowDataSources();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { sessionId, latitude, longitude, locationName, droneId } = route.params;

  const [allGeozones, setGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const [plannedFlightDate, setPlannedFlightDate] = useState<Date | null>(null);
  const [tempRestrictions, setTempRestrictions] = useState<GeozoneFeatureInfo[]>([]);
  const [notams, setNotams] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [geozoneLoading, setGeozoneLoading] = useState(true);
  // Länder ohne verwertbare Geozonen-Daten (Review-Fix 4).
  const [coverageGaps, setCoverageGaps] = useState<GeozoneSourceCoverage[]>([]);
  // Alle Quellen (auch ok/veraltet) für die Abdeckungs-Befunde der Prüfkette.
  const [coverageSources, setCoverageSources] = useState<GeozoneSourceCoverage[]>([]);
  const [notamLoading, setNotamLoading] = useState(true);
  // Teil A: Stundenwerte aus dem Offline-Speicher („Offline-Vorhersage von HH:MM“)
  const [hourlyOffline, setHourlyOffline] = useState<{ fetchedAt: number; cached: boolean } | null>(null);
  const [geozoneError, setGeozoneError] = useState(false);
  const [notamError, setNotamError] = useState(false);
  const [pilotProfile, setPilotProfile] = useState<PilotProfile | null>(null);
  const [limits, setLimits] = useState<WeatherLimits>(DEFAULT_LIMITS);
  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [hourlySlots, setHourlySlots] = useState<HourlyForecastSlot[]>([]);
  const [hourlySource, setHourlySource] = useState<"dipul" | "brightsky" | "openmeteo" | null>(null);
  const [hourlyHighlight, setHourlyHighlight] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date();
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    return { start, end };
  });
  const [expandedNotams, setExpandedNotams] = useState<Set<string>>(new Set());
  const [geozoneChecked, setGeozoneChecked] = useState(false);
  const [notamChecked, setNotamChecked] = useState(false);
  const [planningRadiusKm, setPlanningRadiusKm] = useState<number | null>(null);
  const [planningMaxAltitude, setPlanningMaxAltitude] = useState<number | null>(null);
  const [hasMapSnapshot, setHasMapSnapshot] = useState(false);
  const [wmsTileUrls, setWmsTileUrls] = useState<{ iso: string; url: string }[]>([]);
  const [wmsLoaded, setWmsLoaded] = useState(false);
  // Gesperrte Nachbarländer (Task #522): kein Geozonen-Overlay, dafür Hinweis.
  const [lockedCountryNames, setLockedCountryNames] = useState<string[]>([]);
  const { entitlement } = useAuth();
  const [mapReady, setMapReady] = useState(false);
  const [wildlifeRescueMode, setWildlifeRescueMode] = useState(false);
  const [wildlifeInfoOpen, setWildlifeInfoOpen] = useState(false);
  const mapRef = useRef<MapView>(null);
  const snapshotTakenRef = useRef(false);

  useEffect(() => {
    getPilotProfile().then(setPilotProfile);
    getSettings().then((s) => setWildlifeRescueMode(s?.wildlifeRescueMode ?? false));
    if (droneId) {
      getDrone(droneId).then((d) => { if (d) { setLimits(d.limits); setDrone(d); } });
    }
    if (sessionId) {
      getFlightSession(sessionId).then((s) => {
        setPlanningRadiusKm(s?.planning?.radiusKm ?? 1);
        if (s?.planning?.plannedDate) {
          const t = s.planning.plannedTime && /^\d{1,2}:\d{2}/.test(s.planning.plannedTime) ? s.planning.plannedTime.padStart(5, "0") : "12:00";
          const d = new Date(`${s.planning.plannedDate}T${t}`);
          if (!isNaN(d.getTime())) setPlannedFlightDate(d);
        }
        if (s?.planning?.maxAltitude != null) setPlanningMaxAltitude(s.planning.maxAltitude);
        if (s?.mapSnapshotBase64) {
          // Snapshot wurde bereits in einer vorigen Pre-Check-Session erfasst — erneutes Capturen vermeiden.
          snapshotTakenRef.current = true;
          setHasMapSnapshot(true);
        }
      });
    } else {
      setPlanningRadiusKm(1);
    }
  }, [droneId, sessionId]);

  // WMS-Overlay-URLs für die gezeigten Geozonen-Ebenen pro Land aufbauen
  // (CTR, ED-R, Krankenhäuser, Autobahnen, Schwimmbäder usw. — je nach Pilot-Einstellung).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = planningRadiusKm ?? 1;
      const allCountries = getCountriesInRadius(latitude, longitude, Math.max(r, 5));
      const { unlocked, locked } = splitCountriesByAccess(allCountries, entitlement);
      if (!cancelled) setLockedCountryNames(locked.map((iso) => countryName(iso)));
      const countries = unlocked;
      const urls: { iso: string; url: string }[] = [];
      for (const iso of countries) {
        try {
          const settings = await loadGeozoneSettings(iso);
          const enabledLayers = getActiveLayerNames(settings, iso)
            .filter((name): name is string => typeof name === "string" && name.length > 0);
          if (enabledLayers.length > 0) {
            for (const url of buildCombinedWmsTileUrl(enabledLayers, iso)) {
              urls.push({ iso, url });
            }
          }
        } catch {
          // Land hat keine WMS-Konfiguration — ignorieren.
        }
      }
      if (!cancelled) {
        setWmsTileUrls(urls);
        setWmsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [latitude, longitude, planningRadiusKm, entitlement]);

  const captureMapSnapshot = useCallback(async () => {
    if (snapshotTakenRef.current) return;
    if (!mapRef.current) return;
    if (Platform.OS === "web") return;
    if (!sessionId) return;
    snapshotTakenRef.current = true;
    try {
      // Längere Verzögerung, damit WMS-Tiles und Overlay-Polygone ausgemalt sind, bevor das Bild aufgezeichnet wird.
      await new Promise((r) => setTimeout(r, 2200));
      const base64 = await mapRef.current.takeSnapshot({
        width: 800,
        height: 480,
        format: "png",
        quality: 0.9,
        result: "base64",
      } as any);
      if (typeof base64 === "string" && base64.length > 0) {
        await updateFlightSession(sessionId, { mapSnapshotBase64: base64 });
        setHasMapSnapshot(true);
      }
    } catch (err) {
      // Snapshot ist nice-to-have; Fehler stillschweigend hinnehmen, damit der Pre-Check trotzdem genutzt werden kann.
      snapshotTakenRef.current = false;
    }
  }, [sessionId]);

  // Snapshot erst aufnehmen, wenn Karte bereit ist UND WMS-/NOTAM-/Geozonen-Daten geladen sind,
  // damit Overlays im persistierten Bild enthalten sind.
  useEffect(() => {
    if (!mapReady) return;
    if (!wmsLoaded) return;
    if (notamLoading) return;
    if (geozoneLoading) return;
    if (snapshotTakenRef.current) return;
    captureMapSnapshot();
  }, [mapReady, wmsLoaded, notamLoading, geozoneLoading, captureMapSnapshot]);

  const searchRadiusKm = planningRadiusKm ?? 1;
  // Teil A: lokaler Bestand sofort, online im Hintergrund nachziehen; neue
  // Daten → neu laden (dataVersion), geändertes Urteil → Hinweis.
  const revalidation = useGeozoneRevalidation({ latitude, longitude, radiusKm: searchRadiusKm, purpose: "check", enabled: planningRadiusKm != null });
  const [loadedVersion, setLoadedVersion] = useState(0);
  const dataVersion = revalidation.dataVersion;

  const loadGeozones = useCallback(async () => {
    const version = dataVersion;
    setGeozoneLoading(true);
    setGeozoneError(false);
    setCoverageGaps([]);
    setCoverageSources([]);
    try {
      const area = await queryGeozonesInAreaWithCoverage(latitude, longitude, searchRadiusKm);
      setCoverageGaps(uncoveredGeozoneSources(area.sources));
      setCoverageSources(area.sources);
      const separated = separateTempRestrictions(area.zones);
      setGeozones(separated.geozones);
      setTempRestrictions(separated.tempRestrictions);
    } catch {
      setGeozoneError(true);
    } finally {
      setLoadedVersion(version);
      setGeozoneLoading(false);
    }
  }, [latitude, longitude, searchRadiusKm, dataVersion]);

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

  // Stündliche Wettervorhersage für den verbleibenden Tag laden (ab voller Stunde vor jetzt
  // bis Mitternacht), damit der Pilot vor dem Start die Wetterentwicklung der nächsten
  // Stunden sieht. Reagiert auf Standort-/Drohnenwechsel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const start = new Date(now);
        start.setMinutes(0, 0, 0);
        start.setHours(start.getHours() - 1);
        const end = new Date(now);
        end.setHours(23, 0, 0, 0);
        if (end <= start) end.setTime(start.getTime() + 6 * 3600000);
        const result = await fetchHourlyForecasts(
          latitude,
          longitude,
          start.toISOString(),
          end.toISOString(),
        );
        if (cancelled) return;
        setHourlySlots(result.slots);
        setHourlySource(result.source);
        setHourlyOffline(result.offline ?? null);
      } catch {
        if (cancelled) return;
        setHourlySlots([]);
        setHourlySource(null);
      }
    })();
    return () => { cancelled = true; };
  }, [latitude, longitude, droneId]);

  // Aktuelle Stunde alle 60s nachziehen, damit der hervorgehobene Slot stimmt.
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const s = new Date(now);
      s.setMinutes(0, 0, 0);
      const e = new Date(s.getTime() + 3600000);
      setHourlyHighlight((prev) => (prev.start.getTime() === s.getTime() ? prev : { start: s, end: e }));
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  const milLowFlightContaining = findMilLowFlightAreasContaining(latitude, longitude);
  const milLowFlightNearby = findMilLowFlightAreasIntersectingRadius(latitude, longitude, planningRadiusKm ?? 1);
  const sampledRoutePoints = React.useMemo(() => {
    const r = planningRadiusKm ?? 1;
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

  const detectedBundesland = detectBundeslandFromCoordinates(latitude, longitude);
  const erlaubnisse = pilotProfile?.allgemeinverfuegung || [];
  const hasA2 = pilotProfile?.licenseA2 || false;
  const erlaubnisForBundesland = detectedBundesland
    ? erlaubnisse.find((e) => e.bundesland === (detectedBundesland as Bundesland))
    : undefined;
  const hasValidBundeslandErlaubnis =
    hasA2 && !!erlaubnisForBundesland && !isErlaubnisExpired(erlaubnisForBundesland);

  const isGeozoneCoveredByAV = (gz: GeozoneFeatureInfo): boolean => {
    if (!hasValidBundeslandErlaubnis) return false;
    // Policy: nur abdeckbare Einstufungen (REQ_AUTHORISATION).
    if (!zonePolicy(gz).coverableByAuthorisation) return false;
    // Nur AV-fähige § 21h-Kategorien; Luftsicherheits-/zustimmungspflichtige
    // Zonen (Flugplätze/HEMS, CTR, Industrie/Energie, Behörden) sind nie gedeckt.
    // Nur DEUTSCHE Zonen — eine Landes-AV deckt keine ausländischen Zonen.
    return isDe21hZoneAvEligible(gz);
  };

  // Zeitgesteuerte Zonen (z. B. MTMA Mo–Do, temporäre Zonen): Beim Pre-Check
  // zählt eine Zone, wenn sie JETZT oder zur geplanten Flugzeit aktiv ist
  // (Kontext "precheck" von zoneActivityAt – der Start kann vor oder nach der
  // geplanten Zeit liegen). Nur wenn sie zu beiden Zeitpunkten inaktiv ist,
  // wird sie als reiner Hinweis geführt. Die Pre-Check-Karte nutzt denselben
  // Kontext, damit Liste und Karte übereinstimmen.
  const preCheckTimeContext: ZoneTimeContext = { kind: "precheck", planned: plannedFlightDate };
  const isZoneRelevantInTime = (gz: GeozoneFeatureInfo): boolean => isZoneActiveInContext(gz, preCheckTimeContext);
  const totalNotams = notams.active.length + notams.upcoming.length;
  // Abdeckungslücke (Review-Fix 4): kein Datensatz / Abruffehler / Land ohne
  // automatische Prüfung. Ein kompletter Ladefehler zählt ebenso — der Status
  // ist unbekannt und darf nicht als "keine Zonen" (GO) durchgehen.
  const hasCoverageGap = !geozoneLoading && (geozoneError || coverageGaps.length > 0);
  // Datenstand je Land (Quellen-Registry, B5): „Stand: vor X h“
  const geozoneDataAges = formatCoverageDataAges(coverageSources, (iso) => countryName(iso) || iso);
  // B7/S7: gekürzte Zonenliste sichtbar machen (statt stiller Kürzung).
  const geozoneTruncation = formatCoverageTruncation(coverageSources, (iso) => countryName(iso) || iso, GEOZONE_VECTOR_MAX_FEATURES);
  const coverageGapWarnings = geozoneError
    ? []
    : coverageGaps.map((g) => sourceCoverageWarning(g, countryName(g.iso) || g.iso));
  // Prüfkette (B4): dieselbe Zonen-Auswahl/Einstufung wie die Planung
  // (evaluateZones), Zeitbezug "precheck" (jetzt ODER geplant). Einstufung über
  // die Policy-Tabelle: Info-Zonen (NO_RESTRICTION) brauchen keine Bestätigung,
  // Flugverbot → NO-GO im Urteil.
  const zoneEval = evaluateZones({
    context: "precheck",
    timeContext: preCheckTimeContext,
    zones: allGeozones,
    tempZones: tempRestrictions,
    isCoveredByAV: isGeozoneCoveredByAV,
    // Aktive DIPUL-Temporärbeschränkungen (NOTAM-Liste) zählen wie bisher als
    // Einschränkung.
    extraRestrictions: notams.active.length > 0,
    // Bei Abdeckungslücke kein "approved" (auch wenn alle GEFUNDENEN Zonen
    // AV-gedeckt sind) — Status ungeklärt -> mindestens CAUTION.
    deriveStatus: ({ zoneClass: zc, hasZoneRestrictions }) => {
      if (!(hasZoneRestrictions || hasCoverageGap) || hasCoverageGap) return undefined;
      const anyGeozones = zc.coveredZones.length > 0 || zc.uncoveredZones.length > 0 || tempRestrictions.length > 0;
      return anyGeozones && zc.uncoveredZones.length === 0 && tempRestrictions.length === 0 ? "approved" : "limited";
    },
  });
  const geozones = zoneEval.activeZones;
  const timeInactiveGeozones = zoneEval.inactiveZones;
  const zoneClass = zoneEval.zoneClass;
  const restrictionVerdict = zoneEval.restrictionVerdict;
  const infoGeozones = zoneClass.infoZones;
  const coveredGeozones = zoneClass.coveredZones;
  const uncoveredGeozones = zoneClass.uncoveredZones;
  const hasAnyGeozones = coveredGeozones.length > 0 || uncoveredGeozones.length > 0 || tempRestrictions.length > 0;
  const hasAnyRestrictions = hasAnyGeozones || notams.active.length > 0 || hasCoverageGap;

  const loading = geozoneLoading || notamLoading;

  // Teil A: Urteil aus Zonen, Abdeckung und NOTAMs – für den Hinweis bei
  // geänderten Daten (nie stilles Kippen nach einer Hintergrund-Aktualisierung).
  const buildPreCheckChecks = () => [
    ...zoneEval.checks,
    ...coverageChecks({
      context: "precheck",
      sources: coverageSources,
      queryFailed: geozoneError,
      primaryIso: detectCountryFromCoordinates(latitude, longitude),
      countryLabel: (iso) => countryName(iso) || iso,
    }),
    ...notamChecks({
      context: "precheck",
      failed: notamError,
      count: notamError ? null : notams.active.length,
      source: "DIPUL temporäre Beschränkungen",
      offlineFetchedAt: notams.offline?.cached ? notams.offline.fetchedAt : null,
    }),
  ];
  const livePreCheckVerdict = loading ? null : aggregate(buildPreCheckChecks()).verdict;
  const verdictWatch = useVerdictChangeWatch(livePreCheckVerdict, loadedVersion, dataVersion);

  // Ack nur fordern wenn tatsächlich Daten vorliegen.
  // Bei Lade-/Fetch-Fehlern bzw. Abdeckungslücken bleibt der Status unbekannt —
  // dann muss der Pilot manuell bestätigen, damit kein stiller Bypass entsteht.
  const requiresGeozoneAck = hasAnyGeozones || geozoneError || hasCoverageGap;
  const requiresNotamAck = totalNotams > 0 || notamError;
  const canContinue = (geozoneChecked || !requiresGeozoneAck) && (notamChecked || !requiresNotamAck);


  const handleContinue = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Status aus evaluateZones (deriveStatus): bei Abdeckungslücke kein
    // "approved" — Status ungeklärt -> mindestens CAUTION.
    const restrictionStatus = zoneEval.restrictionStatus;
    const restrictionNotes = hasCoverageGap
      ? (coverageGapWarnings.length > 0
          ? coverageGapWarnings
          : ["Geozonen-Status unbekannt (Abfrage fehlgeschlagen) – manuell geprüft."]
        ).join(" — ")
      : undefined;

    // Prüfkette (B4): Geozonen-, Abdeckungs- und NOTAM-Befunde des Pre-Checks
    // in der Session (Kontext "precheck"); ResultsScreen ergänzt Wetter/Nacht.
    const preCheckChecks = buildPreCheckChecks();

    if (sessionId) {
      const existing = await getFlightSession(sessionId);
      await updateFlightSession(sessionId, {
        hasRestrictions: hasAnyRestrictions,
        restrictionVerdict,
        detectedGeozones: geozones.map((g) => g.name),
        checkResults: replaceCheckCategories(
          existing?.checkResults,
          preCheckChecks,
          ["geozone", "coverage", "notam", "compliance"],
          "precheck",
        ),
      });
    }

    navigation.navigate("Weather", {
      latitude,
      longitude,
      hasRestrictions: hasAnyRestrictions,
      restrictionStatus,
      restrictionNotes,
      restrictionVerdict,
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
    const statusIcon = isMilLowFlight ? "shield" : isUpcoming ? "clock" : "zap";
    const dateRange = formatDateRange(r);
    const remaining = isUpcoming ? daysUntilStart(r) : daysRemaining(r);
    const expanded = expandedNotams.has(r.id);
    const categoryIcon = r.category === "military" ? "shield" : r.category === "nature" ? "feather" : r.category === "notam" ? "file-text" : "alert-circle";

    return (
      <Pressable key={r.id} onPress={() => toggleNotam(r.id)} testID={`restriction-card-${r.id}`}>
        <Card style={[styles.notamCard, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}>
          <View style={styles.notamHeader}>
            <View style={styles.notamHeaderLeft}>
              <View style={[styles.severityDot, { backgroundColor: borderColor }]} />
              <ThemedText style={styles.notamName} numberOfLines={expanded ? undefined : 2}>{r.name}</ThemedText>
              {r.type ? (
                <View style={[styles.typeBadge, { backgroundColor: borderColor + "20" }]}>
                  <ThemedText style={[styles.typeBadgeText, { color: borderColor }]} numberOfLines={1}>{r.type}</ThemedText>
                </View>
              ) : null}
            </View>
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={theme.textTertiary} />
          </View>

          <View style={styles.notamMeta}>
            {dateRange ? (
              <View style={styles.notamDateRow}>
                <Feather name="calendar" size={10} color={theme.textSecondary} />
                <ThemedText style={[styles.notamDateText, { color: theme.textSecondary }]}>{dateRange}</ThemedText>
                {remaining ? (
                  <View style={[styles.remainingBadge, { backgroundColor: isUpcoming ? "#5856D620" : remaining === "Heute" || remaining === "Morgen" ? "#FF3B3020" : "#34C75920" }]}>
                    <ThemedText style={[styles.remainingText, { color: isUpcoming ? "#5856D6" : remaining === "Heute" || remaining === "Morgen" ? "#FF3B30" : "#34C759" }]}>{remaining}</ThemedText>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.notamDateRow}>
              <Feather name="arrow-up" size={10} color={theme.textTertiary} />
              <ThemedText style={[styles.notamDateText, { color: theme.textTertiary }]}>{formatAltitude(r)}</ThemedText>
              <View style={[styles.statusBadge, { backgroundColor: statusColor + "18", flexDirection: "row", alignItems: "center", gap: 3 }]}>
                <Feather name={statusIcon as any} size={9} color={statusColor} />
                <ThemedText style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</ThemedText>
              </View>
            </View>
          </View>

          {isMilLowFlight ? (
            <View style={[styles.detailRow, { marginTop: 4 }]}>
              <Feather name="alert-triangle" size={11} color="#7B8B3A" />
              <ThemedText style={[styles.detailText, { color: "#7B8B3A", fontWeight: "600" }]} numberOfLines={3}>
                Aktiv {MIL_LOW_FLIGHT_ACTIVATION_TEXT}. Höhenband GND — 250 ft AGL. Vor Start NOTAMs prüfen.
              </ThemedText>
            </View>
          ) : null}

          {expanded ? (
            <View style={styles.notamDetails}>
              <View style={styles.detailRow}>
                <Feather name={categoryIcon as any} size={11} color={theme.primary} />
                <ThemedText style={[styles.detailText, { color: theme.primary, fontWeight: "600" }]}>{r.legalExplanation}</ThemedText>
              </View>
              {isMilLowFlight ? (
                <Pressable
                  onPress={() => { WebBrowser.openBrowserAsync(MIL_LOW_FLIGHT_SOURCE_URL).catch(() => {}); }}
                  style={styles.detailRow}
                >
                  <Feather name="external-link" size={11} color="#7B8B3A" />
                  <ThemedText style={[styles.detailText, { color: "#7B8B3A", fontWeight: "600" }]}>
                    {attributionLabel(isAdmin, `Karte und Details auf dipul.de (Stand ${MIL_LOW_FLIGHT_DATA_STAND})`, "Karte und Details ansehen")}
                  </ThemedText>
                </Pressable>
              ) : null}
              {r.legalRef ? (
                <View style={styles.detailRow}>
                  <Feather name="book" size={11} color={theme.textTertiary} />
                  <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>{r.legalRef}</ThemedText>
                </View>
              ) : null}
              <View style={styles.detailRow}>
                <Feather name="arrow-down" size={11} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Untergrenze: {r.lowerAlt === 0 && r.lowerAltRef === "AGL" ? "GND (Boden)" : `${Math.round(r.lowerAlt)} ${r.lowerAltUnit} ${r.lowerAltRef}`}
                </ThemedText>
              </View>
              <View style={styles.detailRow}>
                <Feather name="arrow-up" size={11} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                  Obergrenze: {Math.round(r.upperAlt)} {r.upperAltUnit} {r.upperAltRef}
                  {r.upperAltRef === "MSL" ? ` (${Math.round(r.upperAlt * 3.28084)} ft)` : ""}
                </ThemedText>
              </View>
              {r.startTs ? (
                <View style={styles.detailRow}>
                  <Feather name="play" size={11} color={theme.textTertiary} />
                  <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                    Beginn: {new Date(r.startTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                  </ThemedText>
                </View>
              ) : null}
              {r.endTs ? (
                <View style={styles.detailRow}>
                  <Feather name="square" size={11} color={theme.textTertiary} />
                  <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                    Ende: {r.endTsIndefinite ? "Unbefristet (Dauerhaft aktiv)" : `${new Date(r.endTs).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`}
                  </ThemedText>
                </View>
              ) : null}
              {r.recurRules && formatRecurRule(r.recurRules) ? (
                <View style={styles.detailRow}>
                  <Feather name="repeat" size={11} color={theme.textTertiary} />
                  <ThemedText style={[styles.detailText, { color: theme.textSecondary }]}>
                    {formatRecurRule(r.recurRules)}
                  </ThemedText>
                </View>
              ) : null}
              {r.genNames && r.genNames.length > 0 && r.genNames[0] !== r.name ? (
                <View style={styles.detailRow}>
                  <Feather name="tag" size={11} color={theme.textTertiary} />
                  <ThemedText style={[styles.detailText, { color: theme.textTertiary }]}>
                    {r.genNames.join(", ")}
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.detailRow}>
                <Feather name="hash" size={11} color={theme.textTertiary} />
                <ThemedText style={[styles.detailText, { color: theme.textTertiary }]} numberOfLines={1}>{r.extRef || r.id}</ThemedText>
              </View>
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
        <GeozoneDataChangedBanner change={verdictWatch.change} onDismiss={verdictWatch.dismiss} />
        {wildlifeRescueMode ? (
          <Card
            style={[styles.wildlifeHint, { backgroundColor: theme.statusCautionBackground, borderColor: theme.statusCaution }]}
            onPress={() => setWildlifeInfoOpen(true)}
            testID="hint-wildlife-rescue"
          >
            <View style={styles.wildlifeHintHeader}>
              <MaterialCommunityIcons name="paw" size={16} color={theme.statusCaution} />
              <ThemedText style={[styles.wildlifeHintTitle, { color: theme.statusCaution }]}>
                {WILDLIFE_RESCUE_MODE_TITLE}
              </ThemedText>
            </View>
            <ThemedText style={[styles.wildlifeHintBody, { color: theme.text }]}>
              {WILDLIFE_RESCUE_PLANNING_HINT}
            </ThemedText>
            <ThemedText style={[styles.wildlifeHintLink, { color: theme.primary }]}>
              Mehr Infos zu den Allgemeinverfügungen
            </ThemedText>
          </Card>
        ) : null}
        {Platform.OS !== "web" ? (
          <View style={[styles.mapPreviewWrapper, { borderColor: theme.border }]}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              initialRegion={{
                latitude,
                longitude,
                latitudeDelta: Math.max(0.012, (searchRadiusKm * 2.4) / 111),
                longitudeDelta: Math.max(0.012, (searchRadiusKm * 2.4) / 111),
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              showsUserLocation={false}
              showsMyLocationButton={false}
              showsCompass={false}
              toolbarEnabled={false}
              {...nativeMapBasemapProps(mapStyle, Platform.OS)}
              onMapReady={() => setMapReady(true)}
            >
              <UrlTile
                urlTemplate={mapStyle === "grayscale" ? GRAYSCALE_BASEMAP_TILE_URL : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
                maximumZ={19}
                tileSize={256}
                shouldReplaceMapContent={mapStyle === "grayscale"}
              />
              {wmsTileUrls.map(({ iso, url }, i) => url ? (
                <WMSTile
                  key={`wms-${iso}-${i}-${url}`}
                  urlTemplate={url}
                  maximumNativeZ={getCountryGeozoneConfig(iso).wmsMaxNativeZoom}
                  opacity={0.6}
                  tileSize={256}
                />
              ) : null)}
              {[...notams.active, ...notams.upcoming].map((r) => {
                const isActive = r.status === "active";
                const isEDR = r.name.startsWith("ED-R");
                const fillColor = isActive
                  ? (isEDR ? "rgba(255,59,48,0.45)" : "rgba(255,149,0,0.20)")
                  : "rgba(88,86,214,0.15)";
                const strokeColor = isActive
                  ? (isEDR ? "rgba(255,59,48,1)" : "rgba(255,149,0,0.9)")
                  : "rgba(88,86,214,0.6)";
                if ((r.polygonRings && r.polygonRings.length > 0) || (r.polygonGroups && r.polygonGroups.length > 0)) {
                  return ringGroupsForZone(r).map((group, ri) => {
                    const [outer, ...holes] = smoothRingGroup(group);
                    if (!outer || outer.length < 3) return null;
                    return (
                      <Polygon
                        key={`${r.id}-poly-${ri}`}
                        coordinates={outer.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                        holes={holes.map((h) => h.map(([lat, lon]) => ({ latitude: lat, longitude: lon })))}
                        fillColor={fillColor}
                        strokeColor={strokeColor}
                        strokeWidth={2}
                      />
                    );
                  }).filter(Boolean);
                }
                if (r.centerLat != null && r.centerLon != null) {
                  return (
                    <Circle
                      key={`${r.id}-circle`}
                      center={{ latitude: r.centerLat, longitude: r.centerLon }}
                      radius={r.radiusM ?? 5000}
                      fillColor={fillColor}
                      strokeColor={strokeColor}
                      strokeWidth={2}
                    />
                  );
                }
                return null;
              })}
              {allGeozones.flatMap((gz, gi) => {
                const groups = ringGroupsForZone(gz);
                if (groups.length === 0) return [];
                // Zeitgesteuerte Zonen, die jetzt UND zur geplanten Zeit inaktiv
                // sind, abgeschwächt zeichnen (gleicher Kontext wie die Liste).
                const inactiveInTime = !isZoneRelevantInTime(gz);
                const fill = inactiveInTime ? "rgba(142,142,147,0.06)" : (gz.fillColor ?? zonePolicy(gz).fill);
                const stroke = inactiveInTime ? "rgba(142,142,147,0.6)" : (gz.strokeColor ?? zonePolicy(gz).stroke);
                return groups.map((group, ri) => {
                  const [outer, ...holes] = smoothRingGroup(group);
                  if (!outer || outer.length < 3) return null;
                  return (
                    <Polygon
                      key={`gz-${gz.featureId ?? gz.name}-${gi}-${ri}`}
                      coordinates={outer.map(([lat, lon]) => ({ latitude: lat, longitude: lon }))}
                      holes={holes.map((h) => h.map(([lat, lon]) => ({ latitude: lat, longitude: lon })))}
                      fillColor={fill}
                      strokeColor={stroke}
                      strokeWidth={2}
                    />
                  );
                }).filter(Boolean);
              })}
              <Circle
                center={{ latitude, longitude }}
                radius={searchRadiusKm * 1000}
                strokeColor="rgba(0, 122, 255, 0.85)"
                fillColor="rgba(0, 122, 255, 0.10)"
                strokeWidth={2}
              />
              <Marker coordinate={{ latitude, longitude }} />
            </MapView>
            <View style={styles.mapPreviewBadge} pointerEvents="none">
              <Feather name="map" size={11} color="#fff" />
              <ThemedText style={styles.mapPreviewBadgeText}>
                {searchRadiusKm >= 1 ? `${searchRadiusKm.toFixed(1)} km` : `${Math.round(searchRadiusKm * 1000)} m`}
              </ThemedText>
            </View>
            {lockedCountryNames.length > 0 ? (
              <View style={styles.lockedBadge} pointerEvents="none" testID="hint-locked-countries">
                <Feather name="lock" size={11} color="#fff" />
                <ThemedText style={styles.lockedBadgeText}>
                  {lockedCountryNames.length === 1
                    ? `${lockedCountryNames[0]}: Land freischalten`
                    : `Land freischalten: ${lockedCountryNames.join(", ")}`}
                </ThemedText>
              </View>
            ) : null}
          </View>
        ) : null}

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
                {isAdmin ? (
                  <ThemedText style={[styles.locationCoords, { color: theme.textTertiary, fontSize: 10, marginTop: 4 }]}>
                    Quelle: dipul.de (Approximation, Stand {MIL_LOW_FLIGHT_DATA_STAND})
                  </ThemedText>
                ) : null}
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
          ) : null}

          {!geozoneLoading && !geozoneError && coverageGapWarnings.length > 0 ? (
            <Card testID="precheck-coverage-gap" style={[styles.errorCard, { borderLeftColor: "#FF9500", borderLeftWidth: 3 }]}>
              <Feather name="alert-triangle" size={16} color="#FF9500" />
              <View style={{ flex: 1 }}>
                {coverageGapWarnings.map((w, i) => (
                  <ThemedText key={`gap-${i}`} style={[styles.errorText, { color: theme.textSecondary }]}>
                    {w}
                  </ThemedText>
                ))}
                {/* Länder-Nutzung „Aus“: mit einem Tipp online aktivieren */}
                <EnableCountryButtons
                  isos={coverageGaps.filter((g) => g.status === "disabled").map((g) => g.iso)}
                  color={theme.primary}
                  onEnabled={() => { void loadGeozones(); }}
                />
              </View>
            </Card>
          ) : null}

          {!geozoneLoading && !geozoneError && geozoneDataAges ? (
            <ThemedText
              testID="precheck-geozone-data-age"
              style={[styles.geozoneDetails, { color: coverageSources.some((s) => s.status === "stale" || s.status === "partial") ? "#FF9500" : theme.textTertiary }]}
            >
              {`Geozonen-Daten – ${geozoneDataAges}`}
            </ThemedText>
          ) : null}
          {!geozoneLoading ? (
            <DataStandLines
              testID="precheck-data-stand"
              entries={[
                { kind: "notam", origin: notams.offline },
                { kind: "weather", origin: hourlyOffline },
              ]}
              extraLines={revalidation.pendingWifi.map((iso) => ({
                text: `${countryName(iso) || iso}: Neue Fassung verfügbar – wird im WLAN geladen`,
                tone: "offline" as const,
              }))}
              onRefresh={() => {
                revalidation.refreshNow().catch(() => {});
                loadNotams();
              }}
              refreshing={revalidation.refreshing}
            />
          ) : null}
          {!geozoneLoading && !geozoneError && geozoneTruncation ? (
            <ThemedText testID="precheck-geozone-truncated" style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
              {geozoneTruncation}
            </ThemedText>
          ) : null}

          {geozoneLoading ? null : geozoneError ? (
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
            <>
            {!hasCoverageGap ? (
            <Card style={[styles.statusCard, { borderLeftColor: "#34C759", borderLeftWidth: 3 }]}>
              <Feather name="check-circle" size={18} color="#34C759" />
              <ThemedText style={[styles.statusText, { color: "#34C759" }]}>
                Keine Geozonen-Einschränkungen
              </ThemedText>
            </Card>
            ) : null}
            {infoGeozones.length > 0 ? (
              <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} testID="precheck-info-zones-hint">
                {`Nur Info (keine Beschränkung): ${infoGeozones.map((gz) => gz.name).join(", ")}`}
              </ThemedText>
            ) : null}
            {timeInactiveGeozones.length > 0 ? (
              <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} testID="precheck-time-inactive-hint">
                {timeInactiveGeozones.map((gz) => `${gz.name}: ${ed269InactiveInfoText(gz, plannedFlightDate ? "planned" : "now")}`).join("\n")}
              </ThemedText>
            ) : null}
            </>
          ) : (
            <View style={styles.geozoneList}>
              {coveredGeozones.length > 0 ? (
                <View>
                  <View style={styles.subSectionHeader}>
                    <Feather name="shield" size={12} color="#34C759" />
                    <ThemedText style={[styles.subSectionTitle, { color: "#34C759" }]}>
                      Durch Allgemeinerlaubnis abgedeckt ({coveredGeozones.length})
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
                  {uncoveredGeozones.map((gz, i) => {
                    const pol = zoneClass.assessment(gz).policy;
                    return (
                    <Card key={`uncov-${i}`} style={[styles.geozoneCard, { borderLeftColor: pol.color, borderLeftWidth: 2 }]}>
                      <View style={[styles.geozoneBadge, { backgroundColor: `${pol.color}20` }]}>
                        <ThemedText style={[styles.geozoneBadgeText, { color: pol.color }]}>{gz.layerLabel} · {pol.labelDe}</ThemedText>
                      </View>
                      <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                      {gz.details ? (
                        <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={2}>{gz.details}</ThemedText>
                      ) : null}
                    </Card>
                    );
                  })}
                </View>
              ) : null}

              {infoGeozones.length > 0 ? (
                <View testID="precheck-info-zones">
                  <View style={styles.subSectionHeader}>
                    <Feather name="info" size={12} color={RESTRICTION_POLICY.NO_RESTRICTION.color} />
                    <ThemedText style={[styles.subSectionTitle, { color: RESTRICTION_POLICY.NO_RESTRICTION.color }]}>
                      Nur Info, keine Beschränkung ({infoGeozones.length})
                    </ThemedText>
                  </View>
                  {infoGeozones.map((gz, i) => (
                    <Card key={`info-${i}`} style={[styles.geozoneCard, { borderLeftColor: RESTRICTION_POLICY.NO_RESTRICTION.color, borderLeftWidth: 2 }]}>
                      <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                    </Card>
                  ))}
                </View>
              ) : null}

              {timeInactiveGeozones.length > 0 ? (
                <View testID="precheck-time-inactive">
                  <View style={styles.subSectionHeader}>
                    <Feather name="clock" size={12} color={theme.textSecondary} />
                    <ThemedText style={[styles.subSectionTitle, { color: theme.textSecondary }]}>
                      Zeitgesteuert, derzeit inaktiv ({timeInactiveGeozones.length})
                    </ThemedText>
                  </View>
                  {timeInactiveGeozones.map((gz, i) => (
                    <Card key={`inactive-${i}`} style={[styles.geozoneCard, { borderLeftColor: theme.textSecondary, borderLeftWidth: 2 }]}>
                      <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                      <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={2}>
                        {ed269InactiveInfoText(gz, plannedFlightDate ? "planned" : "now")}
                      </ThemedText>
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
                    <Card key={`temp-${i}`} style={[styles.geozoneCard, { borderLeftColor: zonePolicy(tr).color, borderLeftWidth: 2 }]}>
                      <View style={[styles.geozoneBadge, { backgroundColor: `${zonePolicy(tr).color}20` }]}>
                        <ThemedText style={[styles.geozoneBadgeText, { color: zonePolicy(tr).color }]}>Temporär · {zonePolicy(tr).labelDe}</ThemedText>
                      </View>
                      <ThemedText style={styles.geozoneName}>{tr.name}</ThemedText>
                    </Card>
                  ))}
                </View>
              ) : null}
            </View>
          )}

          {!geozoneLoading && requiresGeozoneAck ? (
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
              <ThemedText style={styles.checkText}>
                {geozoneError
                  ? "Geozonen-Status unbekannt — manuell geprüft"
                  : hasCoverageGap
                    ? "Zonen ohne Daten manuell geprüft und zur Kenntnis genommen"
                    : "Geozonen geprüft und zur Kenntnis genommen"}
              </ThemedText>
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

          {!notamLoading && requiresNotamAck ? (
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
              <ThemedText style={styles.checkText}>
                {notamError ? "NOTAM-Status unbekannt — manuell geprüft" : "NOTAMs geprüft und zur Kenntnis genommen"}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {hourlySlots.length > 0 ? (
          <HourlyForecastTable
            hourlySlots={hourlySlots}
            hourlySource={hourlySource}
            latitude={latitude}
            longitude={longitude}
            maxAltitude={planningMaxAltitude ?? 120}
            drone={drone}
            subtitle="Wetter heute (Pre-Check)"
            highlightStart={hourlyHighlight.start}
            highlightEnd={hourlyHighlight.end}
          />
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Weiter zum Wetter-Check"
          onPress={handleContinue}
          disabled={!canContinue || loading}
        />
      </View>
      <WildlifeRescueInfoModal
        visible={wildlifeInfoOpen}
        onClose={() => setWildlifeInfoOpen(false)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  wildlifeHint: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderRadius: BorderRadius.lg,
  },
  wildlifeHintHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  wildlifeHintTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  wildlifeHintBody: {
    ...Typography.small,
    lineHeight: 18,
  },
  wildlifeHintLink: {
    ...Typography.small,
    fontWeight: "600",
    marginTop: Spacing.sm,
  },
  mapPreviewWrapper: {
    height: 220,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.md,
    position: "relative",
    backgroundColor: "#E5E7EB",
  },
  mapPreviewBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  mapPreviewBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  lockedBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    maxWidth: "70%",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(120, 53, 15, 0.9)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(251, 191, 36, 0.5)",
  },
  lockedBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
    flexShrink: 1,
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
    flexWrap: "wrap",
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    ...Typography.caption,
    fontSize: 10,
    fontWeight: "600",
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
