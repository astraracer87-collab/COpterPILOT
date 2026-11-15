import { openLink } from "@/lib/webBrowser";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { InfrastructureFlightGuidance } from "@/components/InfrastructureFlightGuidance";
import { View, StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView, Linking, Alert, Platform } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useShowDataSources } from "@/lib/dataSource";
import { attributionLabel } from "@/lib/sourceAttribution";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { isZoneActiveInContext, ed269InactiveInfoText, type ZoneTimeContext } from "@/lib/ed269";
import { uncoveredGeozoneSources, geozoneCoverageWarning, sourceCoverageWarning, type GeozoneSourceCoverage } from "@/lib/geozoneCoverage";
import { countryName } from "../../shared/countryEntitlements";
import { queryGeozonesInAreaWithCoverage, GeozoneFeatureInfo, DipulGeozoneSourceStatus, separateTempRestrictions, getCountryGeozoneConfig, getCountriesInRadius, DipulTempRestriction, DipulTempRestrictionsResult, fetchNearbyTempRestrictionsRaw, loadRadarSettings, saveRadarSettings } from "@/lib/geozones";
import { GEOZONE_VECTOR_MAX_FEATURES } from "@/lib/geozoneZoom";
import { getTilePartMeta } from "@/lib/geozoneTiles/tileStore";
import { TILE_STORE_ATTRIBUTION } from "@/lib/geozoneTiles/tileStoreCore";
import { fetchTerrainEstimate } from "@/lib/elevation";
import type { TerrainEstimate } from "../../shared/geozoneAltitudeFilter";
import { partitionByReachability, DEFAULT_REACHABLE_ALTITUDE_M, assessGeozoneAltitudeConflict } from "../../shared/geozoneAltitudeFilter";
import { findMilLowFlightAreasContaining, findMilLowFlightAreasIntersectingRadius, MIL_LOW_FLIGHT_LABEL, MIL_LOW_FLIGHT_SOURCE_URL, MIL_LOW_FLIGHT_ACTIVATION_TEXT, MIL_LOW_FLIGHT_DATA_STAND, classifyMilLowFlightHits, getStatusLabel as getMilStatusLabel, getStatusColor as getMilStatusColor } from "@/lib/milLowFlight";
import { getPilotProfile, savePilotProfile, PilotProfile, de21hRule, isDe21hZoneAvEligible, isErlaubnisExpired, getDrone, DroneProfile, BUNDESLAND_AV_INFO, Bundesland, GENERAL_UAS_RESOURCES, AdditionalDoc, getFlightSession, getSettings, updateFlightSession } from "@/lib/storage";
import { WildlifeRescueInfoModal } from "@/components/WildlifeRescueInfo";
import { windFacilitiesAsGeozones, supplementalLinesAsGeozones, supplementalInfrastructureAsGeozones } from "@/lib/energyInfrastructureZones";
import { getGermanWindFacility100mPoints, getRadarEnergyInfrastructureItems, getEnergyInfrastructureCountry } from "../../shared/germanEnergyInfrastructure";
import { useGermanEnergyInfrastructure } from "@/lib/useGermanEnergyInfrastructure";
import { WILDLIFE_RESCUE_MODE_TITLE, WILDLIFE_RESCUE_PLANNING_HINT } from "../../shared/wildlifeRescue";
import {
  checkCountryCompliance,
  ComplianceResult,
  ComplianceItem,
  isAlphaTangoMissing,
  alphaTangoRequirementReason,
} from "@/lib/countryCompliance";
import { getNightFlightRule } from "@/lib/countryInfo";
import { nightFlightCountry } from "@/lib/assessment";
import { aggregate, geozoneChecks, coverageChecks, complianceChecks, formatCoverageDataAges, formatCoverageTruncation, replaceCheckCategories, type CheckResult, type CheckOverride } from "../../shared/checks";
import { useGeozoneRevalidation, useVerdictChangeWatch } from "@/lib/geozoneSources/useGeozoneRevalidation";
import { GeozoneDataChangedBanner } from "@/components/GeozoneDataChangedBanner";
import { DataStandLines } from "@/components/DataStandLines";
import { isFlightWindowDuringNight } from "@/lib/solar";
import { detectBundeslandFromCoordinates } from "@/lib/countryMaps";
import { hasOwnMap } from "../../shared/countryDetection";
import { isEd269VectorIso } from "../../shared/geozoneSourceMeta";
import { getGeozoneSource } from "@/lib/geozoneSources/registry";
import { classifyPlanningZones, buildProhibitedOverrideNote, hasOverrideReason } from "@/lib/restrictionPlanning";
import { maxRestrictionVerdict, zonePolicy, type RestrictionPolicyEntry } from "../../shared/restrictionPolicy";
import { initialRestrictionChoice, initialRestrictionNotes, isManualRestrictionAnswered, deriveDetailsRestrictionStatus, deriveAlphaTangoRestrictionStatus, buildExemptionNote, composeRestrictionNotes, forwardCrossCheckParams, decidePlanningAbortAction } from "@/lib/manualRestrictionFlow";
import { findNearbyCtrAirports, CtrAirport, getCtrCategoryLabel, getCtrCategoryColor, CTR_AREA_RULES, DFS_PORTAL_URL, getAvConditionsText, getCtrEffectiveNote, getCtrGeometryHint, getCtrDistanceKm, getCtrClearanceForAirport } from "@/lib/ctrData";
import { checkEdr146Proximity, Edr146ProximityResult, findNearbyEdrZones, EdrZone, getEdrSeverityColor, getEdrCategoryLabel, EDR_LEGAL_WARNING, BAF_CONTACT, POLIZEI_BERLIN, EDR_146_NFL, EDR_ENERGIE_NFL, EDR_AV_CONDITIONS, EDR_AV_EXCLUSIONS } from "@/lib/edrData";
import {
  findAreasContainingPoint,
  findRouteIntersections,
  isMilLowFlightLikelyActive,
  MIL_LOW_FLIGHT_ACTIVATION,
  type MilLowFlightArea,
  type RouteIntersection,
} from "@/lib/milLowFlight";

type RouteParams = RouteProp<FlightPlanningParamList, "PlanningRestrictions">;
type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningRestrictions">;

export default function PlanningRestrictionsScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const isAdmin = useShowDataSources();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { droneId, latitude, longitude, locationName, countryIso, mapUrl, radiusKm: initialRadiusKm, maxAltitude, recommendedVlosM, vlosExceeded, vlosCharDimensionM, vlosAltitudeCorrection, vlosHorizontalLimitM, plannedDate, plannedTime, endTime, routeWaypoints, sessionId, restrictionStatus: manualRestrictionStatus, restrictionNotes: manualRestrictionNotes, officialMapCrossCheck } = route.params;
  const localRadiusKm = initialRadiusKm || 1;
  // Teil A: lokaler Bestand sofort, online im Hintergrund nachziehen; neue
  // Daten → neu auswerten (dataVersion), geändertes Urteil → Hinweis.
  const revalidation = useGeozoneRevalidation({ latitude, longitude, radiusKm: localRadiusKm, countryIso, purpose: "check" });
  const [loadedVersion, setLoadedVersion] = useState(0);
  const energyInfrastructureQuery = useGermanEnergyInfrastructure(
    latitude,
    longitude,
    localRadiusKm,
    countryIso ?? "DE",
    hasOwnMap(countryIso),
  );
  const energyInfrastructure = energyInfrastructureQuery.data;
  const additionalEnergyCount =
    (energyInfrastructure?.counts.windTurbines ?? 0) +
    (energyInfrastructure?.counts.powerLines ?? 0) +
    (energyInfrastructure?.counts.powerMasts ?? 0);
  const hasAdditionalEnergyInfrastructure = countryIso === "DE" && additionalEnergyCount > 0;
  // Länder ohne automatische Zonenprüfung (Registry: manualCheckOnly, z. B. HU-Bild-Overlay)
  const manualCheckSource = getGeozoneSource(countryIso);
  const manualCheckHint = manualCheckSource?.manualCheckOnly ? manualCheckSource.manualCheckHint : undefined;
  const energyInfrastructureNote = useMemo(() => {
    if (countryIso !== "DE") return null;
    const items = energyInfrastructure?.features ?? [];
    if (!items.length) return null;
    const details = items.slice(0, 8).map((item) => {
      const officialStatus =
        item.officialMatch === "not_found"
          ? "nicht in DIPUL bestätigt"
          : "amtlicher Abgleich offen";
      return `${item.name} (${item.source}, ${Math.round(item.distanceMeters)} m, ${officialStatus})`;
    });
    const omitted = Math.max(0, additionalEnergyCount - items.length);
    return `Zusätzliche Energieanlagen am Startort: ${details.join("; ")}${omitted ? `; weitere ${omitted} Treffer` : ""}. Quellen: MaStR/OpenStreetMap, mit DIPUL abgeglichen.`;
  }, [countryIso, energyInfrastructure, additionalEnergyCount]);
  // Länder ohne eigene Geozonen-Daten: Der Pilot hat die offizielle Karte im
  // Standort-Schritt selbst geprüft und dort bereits "Einschränkungen ja/nein"
  // beantwortet. Dieses Ergebnis wird übernommen — hier wird NICHT erneut gefragt.
  const hasManualRestriction = isManualRestrictionAnswered(manualRestrictionStatus);

  const [upstreamGeozones, setRawGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const rawGeozones = useMemo(() => {
    if (countryIso !== "DE") {
      const country = getEnergyInfrastructureCountry(countryIso);
      const items = getRadarEnergyInfrastructureItems(true, energyInfrastructure?.features,
        energyInfrastructure?.sources, country?.assetComparisonStatusKeyByKind);
      return [...upstreamGeozones, ...supplementalInfrastructureAsGeozones(countryIso, items)];
    }
    const points = getGermanWindFacility100mPoints("DE", energyInfrastructure?.features);
    const items = getRadarEnergyInfrastructureItems(true, energyInfrastructure?.features,
      energyInfrastructure?.sources, getEnergyInfrastructureCountry("DE")?.assetComparisonStatusKeyByKind);
    return [...upstreamGeozones, ...windFacilitiesAsGeozones(points, energyInfrastructure?.features),
      ...supplementalLinesAsGeozones(items)];
  }, [upstreamGeozones, countryIso, energyInfrastructure]);
  // Geländeschätzung (MSL) im Planungsradius für die MSL->AGL-Umrechnung von
  // Vektorzonen: Maximum für Untergrenzen, Minimum für Obergrenzen (B3).
  const [terrain, setTerrain] = useState<TerrainEstimate | null>(null);
  const [showAllGeozones, setShowAllGeozones] = useState(false);
  // Vom Nutzer geplante Flughöhe (AGL, m). In der linearen Planung wird die Höhe
  // erst im Details-Schritt gewählt -> hier Standard 120 m. Beim Fortsetzen/Bearbeiten
  // einer Session liefert planning.maxAltitude den bereits geplanten Wert.
  const [plannedAltitudeM, setPlannedAltitudeM] = useState(
    typeof maxAltitude === "number" && maxAltitude > 0 ? maxAltitude : DEFAULT_REACHABLE_ALTITUDE_M,
  );
  // Pro-Zone-Antwort auf "Planst du, hier über X m zu steigen?" für reine
  // Höhen-Limit-Zonen mit Decke < geplanter Höhe. "no" -> Zone wird unkritisch,
  // "yes" -> Zone bleibt im AV-Konflikt-Flow. Unbeantwortet = Konflikt (Default).
  const [climbAnswers, setClimbAnswers] = useState<Map<string, "yes" | "no">>(new Map());
  const [tempRestrictions, setTempRestrictions] = useState<GeozoneFeatureInfo[]>([]);
  const [dipulTempRestrictions, setDipulTempRestrictions] = useState<DipulTempRestrictionsResult>({ active: [], upcoming: [] });
  const [dipulSourceStatus, setDipulSourceStatus] = useState<DipulGeozoneSourceStatus | null>(null);
  // Abdeckungslücken der Geozonen-Abfrage (Länder ohne verwertbare Daten).
  const [coverageGaps, setCoverageGaps] = useState<GeozoneSourceCoverage[]>([]);
  // Alle Quellen (auch ok/veraltet) für die Abdeckungs-Befunde der Prüfkette.
  const [coverageSources, setCoverageSources] = useState<GeozoneSourceCoverage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pilotProfile, setPilotProfile] = useState<PilotProfile | null>(null);
  const [droneProfile, setDroneProfile] = useState<DroneProfile | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
  const [avAcknowledged, setAvAcknowledged] = useState(false);
  const [nightPermitConfirmed, setNightPermitConfirmed] = useState(false);
  const [notes, setNotes] = useState(initialRestrictionNotes(manualRestrictionNotes));
  const [restrictionChoice, setRestrictionChoice] = useState<"approved" | "limited" | "nofly" | null>(initialRestrictionChoice(manualRestrictionStatus));
  const [geozoneExemptions, setGeozoneExemptions] = useState<Set<string>>(new Set());
  // Flugverbot (PROHIBITED) bewusst übersteuern: Schlüssel → Begründung.
  // Nur mit nicht-leerer Begründung wird aus NO-GO ein CAUTION.
  const [prohibitedOverrides, setProhibitedOverrides] = useState<Map<string, string>>(new Map());
  // Zeitpunkt der Übersteuerung je Zone (für overriddenBy.at im CheckResult).
  const overrideTimes = useRef<Map<string, string>>(new Map());
  const [detectedBundesland, setDetectedBundesland] = useState<string | null>(null);
  const [nearbyCtr, setNearbyCtr] = useState<CtrAirport[]>([]);
  const [edr146Result, setEdr146Result] = useState<Edr146ProximityResult | null>(null);
  const [nearbyEdr, setNearbyEdr] = useState<EdrZone[]>([]);
  const [edrAvChecked, setEdrAvChecked] = useState<Set<string>>(new Set());
  const [edr146Acknowledged, setEdr146Acknowledged] = useState(false);
  const [edrRotAcknowledged, setEdrRotAcknowledged] = useState(false);
  const [wildlifeRescueMode, setWildlifeRescueMode] = useState(false);
  const [wildlifeInfoOpen, setWildlifeInfoOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const loadProfiles = async () => {
        const [pilot, drone, settings] = await Promise.all([
          getPilotProfile(),
          droneId ? getDrone(droneId) : Promise.resolve(null),
          getSettings(),
        ]);
        setPilotProfile(pilot);
        setWildlifeRescueMode(settings?.wildlifeRescueMode ?? false);
        if (drone) setDroneProfile(drone);
        if (pilot && drone && countryIso) {
          setComplianceResult(checkCountryCompliance(drone, pilot, countryIso));
        }
      };
      loadProfiles();
    }, [droneId, countryIso])
  );

  useEffect(() => {
    let cancelled = false;
    const version = revalidation.dataVersion;
    const fetchGeozones = async () => {
      setLoading(true);
      setError(false);
      setDipulSourceStatus(null);
      setCoverageGaps([]);
      setCoverageSources([]);
      // Neue Position: alte Geländeschätzung verwerfen (bis zur neuen Messung
      // bleiben MSL-Zonen sichtbar).
      setTerrain(null);
      try {
        const area = await queryGeozonesInAreaWithCoverage(
          latitude,
          longitude,
          localRadiusKm || 1,
          countryIso,
          (status) => { if (!cancelled) setDipulSourceStatus(status); },
        );
        if (cancelled) return;
        const results = area.zones;
        // Länder ohne verwertbare Daten (Fehler, fehlender Datensatz, keine
        // automatische Prüfung) — darf NICHT als "keine Zonen" gelten.
        setCoverageGaps(uncoveredGeozoneSources(area.sources));
        setCoverageSources(area.sources);
        const separated = separateTempRestrictions(results);
        setRawGeozones(separated.geozones);
        setTempRestrictions(separated.tempRestrictions);
        // Sicherheits-Schalter "Alle Geozonen anzeigen" (geteilt mit dem Radar).
        loadRadarSettings()
          .then((rs) => { if (!cancelled) setShowAllGeozones(rs.showAllGeozones); })
          .catch(() => {});
        // Geländehöhe nur laden, wenn MSL-bezogene Vektorzonen vorliegen.
        const needsTerrain = separated.geozones.some(
          (gz) => (gz.lowerReference === "MSL" || gz.upper?.ref === "MSL")
            && isEd269VectorIso(gz.country || countryIso, hasOwnMap),
        );
        if (needsTerrain) {
          fetchTerrainEstimate(latitude, longitude, (localRadiusKm || 1) * 1000)
            .then((t) => { if (!cancelled) setTerrain(t); })
            .catch(() => {});
        }
        if (countryIso === "DE") {
          const bl = detectBundeslandFromCoordinates(latitude, longitude);
          setDetectedBundesland(bl);
          const ctrResults = findNearbyCtrAirports(latitude, longitude, localRadiusKm ? Math.max(localRadiusKm, 10) : 10);
          setNearbyCtr(ctrResults);
          setEdr146Result(checkEdr146Proximity(latitude, longitude));
          setNearbyEdr(findNearbyEdrZones(latitude, longitude, localRadiusKm || 1));
          // Live AUP/UUP/NOTAM activation status for mil low-flight areas.
          // We need a wider radius than the planning radius so activations of
          // any nearby TFG (which are large) are still picked up.
          try {
            const dipul = await fetchNearbyTempRestrictionsRaw(latitude, longitude, Math.max(localRadiusKm || 1, 50));
            if (!cancelled) setDipulTempRestrictions(dipul);
          } catch {
            if (!cancelled) setDipulTempRestrictions({ active: [], upcoming: [] });
          }
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) {
          setLoadedVersion(version);
          setLoading(false);
        }
      }
    };
    const timer = setTimeout(() => { fetchGeozones(); }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [latitude, longitude, localRadiusKm, countryIso, revalidation.dataVersion]);

  // Höhen-Filter: vektorbasierte ED-269-Zonen (AT/BE/DK) mit Untergrenze über der
  // geplanten Höhe (Standard 120 m AGL) ausblenden. WMS-Länder bleiben unberührt.
  // Der Schalter "Alle Geozonen anzeigen" hebt den Filter auf.
  const { geozones, hiddenAboveGeozones } = useMemo(() => {
    // Vektor-Länder aus der Quellen-Registry (ED-269-Gerätecache inkl. LI);
    // Nur-Import-Länder (RO) zählen erst mit gespeichertem Bestand.
    const isFilterable = (gz: GeozoneFeatureInfo) => isEd269VectorIso(gz.country || countryIso, hasOwnMap);
    if (showAllGeozones) return { geozones: rawGeozones, hiddenAboveGeozones: [] as GeozoneFeatureInfo[] };
    const filterable = rawGeozones.filter(isFilterable);
    const nonFilterable = rawGeozones.filter((gz) => !isFilterable(gz));
    const part = partitionByReachability(filterable, {
      reachableAltitudeM: plannedAltitudeM,
      terrain,
    });
    return {
      geozones: [...nonFilterable, ...part.visible],
      hiddenAboveGeozones: part.hiddenAbove,
    };
  }, [rawGeozones, showAllGeozones, terrain, countryIso, plannedAltitudeM]);

  // Beim Fortsetzen/Bearbeiten einer Session: bereits geplante Flughöhe laden,
  // damit der Höhen-Filter den Nutzerwert statt des 120-m-Standards verwendet.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getFlightSession(sessionId)
      .then((session) => {
        const planned = session?.planning?.maxAltitude;
        if (!cancelled && typeof planned === "number" && planned > 0) {
          setPlannedAltitudeM(planned);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  const toggleShowAllGeozones = useCallback(() => {
    setShowAllGeozones((v) => { const n = !v; saveRadarSettings({ showAllGeozones: n }).catch(() => {}); return n; });
  }, []);

  const erlaubnisse = pilotProfile?.allgemeinverfuegung || [];
  const hasA2 = pilotProfile?.licenseA2 || false;
  // Abdeckung verlangt: A2-Lizenz UND eine gültige (nicht abgelaufene)
  // geografische Allgemeinerlaubnis für GENAU das erkannte Bundesland. Keine
  // gegenseitige Anerkennung zwischen Bundesländern.
  const erlaubnisForBundesland = detectedBundesland
    ? erlaubnisse.find((e) => e.bundesland === (detectedBundesland as Bundesland))
    : undefined;
  const erlaubnisExpired = erlaubnisForBundesland
    ? isErlaubnisExpired(erlaubnisForBundesland)
    : false;
  const hasValidBundeslandErlaubnis =
    hasA2 && !!erlaubnisForBundesland && !erlaubnisExpired;

  const isGeozoneCoveredByAV = (gz: GeozoneFeatureInfo): boolean => {
    if (!hasValidBundeslandErlaubnis) return false;
    // Policy: nur abdeckbare Einstufungen (REQ_AUTHORISATION) kann eine AV decken.
    if (!zonePolicy(gz).coverableByAuthorisation) return false;
    // Nur § 21h-Kategorien, die eine Landes-AV rechtlich abdecken kann
    // (Wohngrundstücke, Bundesfern-/Wasserstraßen, Bahn). Luftsicherheits-/
    // zustimmungspflichtige Zonen (Flugplätze/HEMS, CTR, Industrie/Energie,
    // Behörden) sind NIE AV-gedeckt. Nur DEUTSCHE Zonen (Landes-AV).
    return isDe21hZoneAvEligible(gz);
  };

  // Höhenbewusste Vorab-Klassifizierung: reine Höhen-Limit-Zonen mit Decke
  // >= geplanter Höhe sind unkritisch (cleared); Decke < geplant erzeugt die
  // Pro-Zone-Steig-Frage; mit "no" beantwortet wird die Zone ebenfalls
  // unkritisch. Flugverbote / Zonen ohne verwertbare Höhendaten bleiben Konflikt.
  const climbContentKey = (gz: GeozoneFeatureInfo): string =>
    `${gz.layerLabel || ""}|${gz.name || ""}|${gz.featureId || gz.details || ""}`;
  const assessZone = (gz: GeozoneFeatureInfo) => assessGeozoneAltitudeConflict(gz, plannedAltitudeM);
  const isZoneClearedByAltitude = (gz: GeozoneFeatureInfo): boolean => {
    const a = assessZone(gz);
    if (a.clearedByAltitude) return true;
    if (a.needsClimbQuestion && climbAnswers.get(climbContentKey(gz)) === "no") return true;
    return false;
  };
  // Zonen, die rein über die geplante Höhe unkritisch werden (silently/dismissed)
  // — getrennt aufgeführt, fließen aber NICHT in die Konflikt-Bewertung ein.
  // Zeitgesteuerte Zonen (z. B. MTMA Mo–Do 07:00–15:30Z, temporäre Zonen mit
  // Gültigkeitsfenster): Für die Planung zählt der GEPLANTE Flugzeitpunkt
  // (ohne Planung: jetzt) – Kontext "planned" von zoneActivityAt. Zonen, die
  // dann inaktiv sind, gelten nicht als Beschränkung, werden aber als Hinweis
  // aufgeführt.
  const plannedFlightDate = useMemo(() => {
    if (!plannedDate) return null;
    const d = new Date(`${plannedDate}T${plannedTime && /^\d{1,2}:\d{2}/.test(plannedTime) ? plannedTime.padStart(5, "0") : "12:00"}`);
    return isNaN(d.getTime()) ? null : d;
  }, [plannedDate, plannedTime]);
  const planningTimeContext: ZoneTimeContext = { kind: "planned", planned: plannedFlightDate };
  const timeInactiveGeozones = geozones.filter((gz) => !gz.informationalOnly && !isZoneActiveInContext(gz, planningTimeContext));
  const timeRelevantGeozones = geozones.filter((gz) => gz.informationalOnly || isZoneActiveInContext(gz, planningTimeContext));
  const altitudeClearedGeozones = timeRelevantGeozones.filter((gz) => !gz.informationalOnly && isZoneClearedByAltitude(gz));
  // Aktiv konfliktrelevante Zonen (heutiges Verhalten als sicherer Default).
  const activeGeozones = timeRelevantGeozones.filter((gz) => !gz.informationalOnly && !isZoneClearedByAltitude(gz));

  // Einstufung über die Policy-Tabelle (client/lib/restrictionPlanning.ts):
  // NO_RESTRICTION = nur Info, AV deckt nur REQ_AUTHORISATION, Flugverbot
  // (PROHIBITED) = NO-GO, außer mit dokumentierter Begründung übersteuert.
  // Schlüssel inhaltsbasiert (nicht Listenindex), damit Ausnahmen/Overrides
  // beim Umsortieren der Liste an der richtigen Zone bleiben.
  const getGeozoneKey = (gz: GeozoneFeatureInfo): string =>
    `${gz.layerLabel || ""}|${gz.name || ""}|${gz.featureId || gz.details || ""}`;
  const zoneClass = classifyPlanningZones(activeGeozones, {
    isCoveredByAV: isGeozoneCoveredByAV,
    isExempted: (gz) => geozoneExemptions.has(getGeozoneKey(gz)),
    overrideReason: (gz) => prohibitedOverrides.get(getGeozoneKey(gz)),
  });
  // Temporäre Beschränkungen (dipul-Temporär, ED-R, LU-Temp) zur geplanten
  // Zeit: gleiche Policy (DE-Temporär = Flugverbot, ED-R = Freigabe nötig).
  const activeTempRestrictions = tempRestrictions.filter((tr) => isZoneActiveInContext(tr, planningTimeContext));
  const tempClass = classifyPlanningZones(activeTempRestrictions, {
    isCoveredByAV: () => false,
    overrideReason: (tr) => prohibitedOverrides.get(getGeozoneKey(tr)),
  });
  const infoGeozones = zoneClass.infoZones;
  const restrictiveGeozones = activeGeozones.filter((gz) => zoneClass.assessment(gz).verdict !== "info");
  const coveredGeozones = zoneClass.coveredZones;
  const uncoveredGeozones = zoneClass.uncoveredZones;
  const exemptedUncoveredGeozones = zoneClass.exemptedZones;
  const nonExemptedUncoveredGeozones = zoneClass.unresolvedZones;
  const allUncoveredExempted =
    uncoveredGeozones.length > 0 && nonExemptedUncoveredGeozones.length === 0;
  const openProhibitedZones = [...zoneClass.openProhibitedZones, ...tempClass.openProhibitedZones];
  const overriddenProhibitedZones = [...zoneClass.overriddenZones, ...tempClass.overriddenZones];
  // Höchstes Policy-Urteil (in der Session gespeichert → PlanningResult).
  const restrictionVerdict = maxRestrictionVerdict([zoneClass.verdict, tempClass.verdict]);
  const milLowFlightInside: DipulTempRestriction[] = countryIso === "DE" ? findMilLowFlightAreasContaining(latitude, longitude) : [];
  const milLowFlightWithinRadius: DipulTempRestriction[] = countryIso === "DE" ? findMilLowFlightAreasIntersectingRadius(latitude, longitude, Math.max(localRadiusKm || 1, 1)) : [];
  const milLowFlightHits: DipulTempRestriction[] = milLowFlightInside.length > 0 ? milLowFlightInside : milLowFlightWithinRadius;
  // Classify geographic hits using live DIPUL/AUP activation status — only
  // active/upcoming areas are "hot" and contribute to pre-flight warnings.
  // Inactive overlaps remain visible but are purely informational.
  const milLowFlightClassified = React.useMemo(
    () => classifyMilLowFlightHits(milLowFlightHits, dipulTempRestrictions),
    [milLowFlightHits, dipulTempRestrictions]
  );
  const milLowFlightHotHits = milLowFlightClassified.hot;
  const milLowFlightInactiveHits = milLowFlightClassified.inactive;
  // Abdeckungslücken (Review-Fix 4): Für diese Länder liegen keine Geozonen-
  // Daten vor -> Zonen müssen manuell geprüft werden. Hat der Pilot die
  // offizielle Karte des Standortlandes bereits im Standort-Schritt geprüft
  // (manueller Flow, hasOwnMap === false), ist die Lücke dieses Landes erledigt.
  const unresolvedCoverageGaps = coverageGaps.filter(
    (g) => !(hasManualRestriction && g.iso === (countryIso || "").toUpperCase()),
  );
  // Ein kompletter Abfragefehler (error) ist ebenfalls eine Lücke für das
  // Standortland — vorher führte er ohne Zonen zu hasRestrictions=false (GO).
  const errorGap = error && !hasManualRestriction;
  const hasCoverageGap = !loading && (errorGap || unresolvedCoverageGaps.length > 0);
  // Datenstand je Land (Quellen-Registry, B5): „Stand: vor X h“
  const geozoneDataAges = formatCoverageDataAges(coverageSources, (iso) => countryName(iso) || iso);
  // B7/S7: gekürzte Zonenliste sichtbar machen (statt stiller Kürzung).
  const geozoneTruncation = formatCoverageTruncation(coverageSources, (iso) => countryName(iso) || iso, GEOZONE_VECTOR_MAX_FEATURES);
  const coverageGapWarnings = errorGap
    ? [geozoneCoverageWarning(countryName(countryIso) || countryIso || "den Standort")]
    : unresolvedCoverageGaps.map((g) => sourceCoverageWarning(g, countryName(g.iso) || g.iso));
  // Beschränkungen ohne Abdeckungslücke (die Lücke ist ein eigener
  // Abdeckungs-Befund der Prüfkette).
  const hasZoneRestrictions =
    restrictiveGeozones.length > 0 ||
    tempRestrictions.length > 0 ||
    milLowFlightHotHits.length > 0 ||
    hasAdditionalEnergyInfrastructure;
  const hasAnyRestrictions = hasZoneRestrictions || hasCoverageGap;
  const hasUncoveredRestrictions =
    nonExemptedUncoveredGeozones.length > 0 ||
    tempRestrictions.length > 0 ||
    milLowFlightHotHits.length > 0 ||
    hasAdditionalEnergyInfrastructure ||
    hasCoverageGap;
  const allCoveredByAV = hasAnyRestrictions && !hasUncoveredRestrictions;

  const hasBundeslandAv = hasValidBundeslandErlaubnis;
  // Hinweis-Karte: in DE, Bundesland erkannt, Geozonen vorhanden, aber keine
  // gültige Erlaubnis (fehlt, abgelaufen oder kein A2).
  const missingBundeslandAv =
    countryIso === "DE" &&
    detectedBundesland !== null &&
    (restrictiveGeozones.length > 0 || hasAdditionalEnergyInfrastructure) &&
    !hasValidBundeslandErlaubnis;
  const bundeslandAvInfo = detectedBundesland
    ? BUNDESLAND_AV_INFO[detectedBundesland]
    : undefined;

  // Nur kontextrelevante Dokumente anbieten: generische UAS-Infos, die
  // Allgemeinerlaubnis des erkannten Bundeslandes sowie bundeslandspezifische
  // Zusatzdokumente — CTR-Dokumente jedoch nur, wenn am Standort eine
  // Kontrollzone (CTR) betroffen ist.
  const hasCtr = nearbyCtr.length > 0;
  const relevantDocs: AdditionalDoc[] = [
    ...GENERAL_UAS_RESOURCES,
    ...(bundeslandAvInfo?.pdfUrl
      ? [{
          title: `Allgemeinerlaubnis ${detectedBundesland} (PDF)`,
          url: bundeslandAvInfo.pdfUrl,
          icon: "download" as const,
        }]
      : []),
    ...((bundeslandAvInfo?.additionalDocs ?? []).filter((doc) => !doc.requiresCtr || hasCtr)),
  ];

  const hasEdr146Block = edr146Result?.isInside === true && edr146Result.isInnerCircle && !edr146Acknowledged;
  const hasEdr146OuterBlock = edr146Result?.isInside === true && !edr146Result.isInnerCircle && !edr146Acknowledged;
  const hasEdrRotBlock = nearbyEdr.some(z => z.severity === "rot" && z.id !== "146") && !edrRotAcknowledged;

  const milTakeoffAreas: MilLowFlightArea[] = countryIso === "DE" ? findAreasContainingPoint(latitude, longitude) : [];
  const milRouteWaypoints = routeWaypoints && routeWaypoints.length >= 2
    ? routeWaypoints
    : [{ latitude, longitude }];
  const milRouteIntersections: RouteIntersection[] = countryIso === "DE"
    ? findRouteIntersections(milRouteWaypoints)
    : [];
  const milRouteAreaIds = new Set<string>();
  milRouteIntersections.forEach((it) => milRouteAreaIds.add(it.area.id));
  milTakeoffAreas.forEach((a) => milRouteAreaIds.add(a.id));
  const milActive = isMilLowFlightLikelyActive(plannedDate, plannedTime);
  const hasMilLowFlightWarning =
    milRouteAreaIds.size > 0 && (milActive || milLowFlightHotHits.length > 0);

  const canContinue = !loading;

  // Bestätigungsdialog nur für Zonen, deren Policy eine Bestätigung verlangt
  // (Verbot, Sperrgebiet, Genehmigungspflicht) bzw. für Temporär-/Militär-/
  // Energie-/Abdeckungs-Hinweise. Reine Auflagen-/Naturschutz-/Info-Zonen
  // fließen als CAUTION ins Urteil, ohne Pflichtdialog.
  const hasConfirmationRestrictions =
    zoneClass.confirmationZones.length > 0 ||
    openProhibitedZones.length > 0 ||
    tempRestrictions.length > 0 ||
    milLowFlightHotHits.length > 0 ||
    hasAdditionalEnergyInfrastructure ||
    hasCoverageGap;
  const hasWarnings = hasConfirmationRestrictions || coveredGeozones.length > 0 || hasEdr146Block || hasEdr146OuterBlock || hasEdrRotBlock || hasMilLowFlightWarning;

  // Nachtflug-Erkennung: liegt das geplante Flugfenster (Start-/Endzeit am
  // gewählten Datum/Standort) ganz oder teilweise in der gesetzlichen Nacht
  // (Sonne unter -6°)? Die länderspezifische Regel entscheidet, ob daraus nur
  // ein Hinweis (Blinklicht-Länder) oder ein "Weiter"-Blocker (Verbots-/
  // Freigabe-Länder) wird.
  const nightWindow = useMemo(() => {
    if (!plannedDate || !plannedTime || !endTime) return { anyNight: false, allNight: false };
    const d = new Date(plannedDate + "T00:00:00");
    if (isNaN(d.getTime())) return { anyNight: false, allNight: false };
    const [sh, sm] = plannedTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const startMin = (sh || 0) * 60 + (sm || 0);
    const endMin = (eh || 0) * 60 + (em || 0);
    return isFlightWindowDuringNight(latitude, longitude, d, startMin, endMin);
  }, [plannedDate, plannedTime, endTime, latitude, longitude]);
  // Land der Nachtflug-Regel aus dem Standort (wie im Gesamturteil, Review I6).
  const nightRule = useMemo(
    () => getNightFlightRule(nightFlightCountry(latitude, longitude, countryIso)),
    [latitude, longitude, countryIso],
  );
  const isNightPermitCountry =
    nightRule.status === "forbidden" || nightRule.status === "permit_required";
  // Harter Blocker nur in Verbots-/Freigabe-Ländern, solange keine Genehmigung
  // bestätigt wurde. In Blinklicht-Ländern (DE/AT/CH …) bleibt es ein Hinweis.
  const nightBlock = nightWindow.anyNight && isNightPermitCountry && !nightPermitConfirmed;

  // Notiz für das Flugprotokoll, wenn (teilweise) nachts geflogen wird.
  const buildNightNote = (confirmedOverride?: boolean): string => {
    if (!nightWindow.anyNight) return "";
    const confirmed = confirmedOverride ?? nightPermitConfirmed;
    const scope = nightWindow.allNight ? "Flug in der gesetzlichen Nacht" : "Flug teilweise in der gesetzlichen Nacht";
    if (isNightPermitCountry) {
      return confirmed
        ? `${scope}: Nachtflug-Genehmigung/Sonderfreigabe bestätigt vorhanden (${nightRule.shortText}).`
        : `${scope} ohne bestätigte Sonderfreigabe — Pilot hat trotz Hinweis dokumentiert fortgesetzt (${nightRule.shortText}).`;
    }
    return `${scope}: ${nightRule.shortText}.`;
  };

  const prohibitedOverrideNote = buildProhibitedOverrideNote(
    overriddenProhibitedZones,
    (gz) => prohibitedOverrides.get(getGeozoneKey(gz)),
  );

  // Prüfkette (B4): Geozonen-, Abdeckungs- und Compliance-Befunde dieser Stufe.
  // Werden in der Session gespeichert (bestehende Session sofort, neue Session
  // über PlanningDetails) und zusätzlich als Route-Param durchgereicht.
  const overrideOf = (gz: GeozoneFeatureInfo): CheckOverride | null => {
    const key = getGeozoneKey(gz);
    const reason = prohibitedOverrides.get(key);
    if (!hasOverrideReason(reason)) return null;
    return { reason: reason!.trim(), at: overrideTimes.current.get(key) ?? new Date().toISOString() };
  };
  const buildRestrictionChecks = (
    status: "approved" | "limited" | undefined,
    alphaTango: boolean,
  ): CheckResult[] => [
    ...geozoneChecks({
      context: "planning",
      classes: [zoneClass, tempClass],
      overrideOf,
      hasRestrictions: hasZoneRestrictions || alphaTango,
      restrictionStatus: status,
      source: "Einschränkungs-Stufe (Planung)",
    }),
    ...coverageChecks({
      context: "planning",
      sources: coverageSources,
      queryFailed: error,
      primaryIso: countryIso,
      resolvedIsos: hasManualRestriction && countryIso ? [countryIso] : [],
      countryLabel: (iso) => countryName(iso) || iso,
    }),
    ...complianceChecks({ alphaTangoMissingAcknowledged: alphaTango }, "planning"),
  ];
  // Teil A: Urteil der Geozonen-/Abdeckungsprüfung (ohne Pilotenwahl) für den
  // Hinweis bei geänderten Daten.
  const liveRestrictionVerdict = loading ? null : aggregate(buildRestrictionChecks(undefined, false)).verdict;
  const verdictWatch = useVerdictChangeWatch(liveRestrictionVerdict, loadedVersion, revalidation.dataVersion);
  const persistRestrictionChecks = (checks: CheckResult[]) => {
    if (!sessionId) return;
    getFlightSession(sessionId)
      .then((existing) => {
        if (!existing) return;
        return updateFlightSession(sessionId, {
          checkResults: replaceCheckCategories(existing.checkResults, checks, ["geozone", "coverage", "compliance"], "planning"),
        });
      })
      .catch(() => {});
  };

  const navigateToDetails = (nightConfirmedOverride?: boolean) => {
    const exemptionNote = buildExemptionNote(exemptedUncoveredGeozones);
    const nightNote = buildNightNote(nightConfirmedOverride);
    const userNotes = notes.trim();
    const restrictionNotes = composeRestrictionNotes([
      exemptionNote,
      prohibitedOverrideNote,
      nightNote,
      energyInfrastructureNote,
      ...(hasCoverageGap ? coverageGapWarnings : []),
      userNotes,
    ]);
    const restrictionStatus = deriveDetailsRestrictionStatus({
      restrictionChoice,
      allCoveredByAV,
      // Ausnahmen decken keine Abdeckungslücke: ohne Daten keine Auto-Freigabe.
      allUncoveredExempted: allUncoveredExempted && !hasCoverageGap,
    });
    const checkResults = buildRestrictionChecks(restrictionStatus, false);
    persistRestrictionChecks(checkResults);
    navigation.navigate("PlanningDetails", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      mapUrl,
      hasRestrictions: hasAnyRestrictions,
      restrictionVerdict,
      restrictionStatus,
      checkResults,
      restrictionNotes,
      ...forwardCrossCheckParams({ officialMapCrossCheck }),
      radiusKm: localRadiusKm,
      maxAltitude: plannedAltitudeM,
      recommendedVlosM,
      vlosExceeded,
      vlosCharDimensionM,
      vlosAltitudeCorrection,
      vlosHorizontalLimitM,
      plannedDate,
      plannedTime,
      endTime,
      routeWaypoints,
      sessionId,
    });
  };

  const navigateToDetailsWithAlphaTangoOverride = () => {
    // Eigener Navigations-Pfad, der zusätzlich das Override-Flag
    // weitergibt — wird nur im FR/AlphaTango-Fall verwendet.
    const exemptionNote = buildExemptionNote(exemptedUncoveredGeozones);
    const nightNote = buildNightNote();
    const userNotes = notes.trim();
    const alphaTangoNote =
      "FR-Flug ohne AlphaTango-Registrierung an der Drohne gestartet (Pilot hat trotz Hinweis fortgesetzt — Verstoß gegen DGAC-Pflicht ab MTOM 800 g bzw. mit Remote-ID).";
    const restrictionNotes = composeRestrictionNotes([
      exemptionNote,
      prohibitedOverrideNote,
      nightNote,
      energyInfrastructureNote,
      ...(hasCoverageGap ? coverageGapWarnings : []),
      userNotes,
      alphaTangoNote,
    ]);
    const restrictionStatus = deriveAlphaTangoRestrictionStatus(restrictionChoice);
    const checkResults = buildRestrictionChecks(restrictionStatus, true);
    persistRestrictionChecks(checkResults);
    navigation.navigate("PlanningDetails", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      mapUrl,
      hasRestrictions: true,
      restrictionVerdict,
      restrictionStatus,
      checkResults,
      restrictionNotes,
      ...forwardCrossCheckParams({ officialMapCrossCheck }),
      alphaTangoMissingAcknowledged: true,
      radiusKm: localRadiusKm,
      maxAltitude: plannedAltitudeM,
      recommendedVlosM,
      vlosExceeded,
      vlosCharDimensionM,
      vlosAltitudeCorrection,
      vlosHorizontalLimitM,
      plannedDate,
      plannedTime,
      endTime,
      routeWaypoints,
      sessionId,
    });
  };

  const handleContinue = () => {
    // FR + AlphaTango-Pflicht (≥ 800 g ODER Remote-ID) ohne hinterlegte
    // Bestätigung → harter Blocker mit "Flug abbrechen / Trotzdem fortfahren"
    // analog zu Geozonen-Blocker. Gleiche Regel wie die Compliance-Liste
    // (isAlphaTangoMissing, B7/I7). Bei "Trotzdem fortfahren" wird der
    // Verstoß im Flugprotokoll dokumentiert.
    if (countryIso === "FR" && droneProfile && isAlphaTangoMissing(droneProfile)) {
      Alert.alert(
        "AlphaTango-Registrierung fehlt",
        `${alphaTangoRequirementReason(droneProfile)} Für ${droneProfile.name} ist in Frankreich eine AlphaTango-Registrierung der Drohne zwingend vorgeschrieben. Die AlphaTango-Bestätigung ist nicht hinterlegt – ein Flug ist so nicht legal möglich.\n\nDu kannst die Planung abbrechen und die Bestätigung (FRA-Nummer + Nachweis) im Drohnen-Setup hinterlegen, oder trotzdem fortfahren. Bei "Trotzdem fortfahren" wird im Flugprotokoll vermerkt, dass die AlphaTango-Registrierung gefehlt hat.`,
        [
          { text: "Planung abbrechen", style: "cancel", onPress: handleAbort },
          {
            text: "Trotzdem fortfahren",
            style: "destructive",
            onPress: navigateToDetailsWithAlphaTangoOverride,
          },
        ],
        { cancelable: true },
      );
      return;
    }

    // Pilot hat explizit "Flug nicht möglich" gewählt → 3-Wege-Dialog:
    // trotzdem fortfahren (z. B. nur dokumentieren), Standort neu wählen
    // oder ganze Planung abbrechen.
    if (restrictionChoice === "nofly") {
      Alert.alert(
        "Flug nicht möglich",
        "Du hast angegeben, dass der Flug an diesem Standort nicht möglich ist. Wie möchtest du fortfahren?",
        [
          {
            text: "Trotzdem fortfahren",
            style: "destructive",
            onPress: () => navigateToDetails(),
          },
          {
            text: "Standort neu wählen",
            onPress: () => navigation.navigate("PlanningLocation", { droneId, countryIso }),
          },
          {
            text: "Planung abbrechen",
            style: "cancel",
            onPress: handleAbort,
          },
        ],
        { cancelable: true },
      );
      return;
    }

    // Nachtflug-Blocker (nur in Verbots-/Freigabe-Ländern wie FR/NL): das
    // geplante Flugfenster liegt ganz/teilweise in der gesetzlichen Nacht und es
    // wurde noch keine Sonderfreigabe bestätigt. Erklärt den Sachverhalt und
    // lässt den Piloten bestätigen, dass eine Genehmigung vorliegt, oder
    // dokumentiert fortfahren. Danach greifen weiterhin die Geozonen-Gates.
    if (nightBlock) {
      Alert.alert(
        "Nachtflug nicht ohne Weiteres möglich",
        `Dein Flugfenster liegt ${nightWindow.allNight ? "" : "teilweise "}in der gesetzlichen Nacht (Sonne unter -6°). ${nightRule.detail}\n\nLiegt eine Nachtflug-Genehmigung/Sonderfreigabe vor, bestätige das – andernfalls kannst du dokumentiert fortfahren.`,
        [
          { text: "Planung abbrechen", style: "cancel", onPress: handleAbort },
          {
            text: "Genehmigung vorhanden",
            onPress: () => {
              setNightPermitConfirmed(true);
              proceedFromRestrictions(true);
            },
          },
          {
            text: "Trotzdem fortfahren",
            style: "destructive",
            onPress: () => proceedFromRestrictions(false),
          },
        ],
        { cancelable: true },
      );
      return;
    }

    proceedFromRestrictions();
  };

  // Geozonen-/ED-R-/Tiefflug-Gate. Wird nach dem Nachtflug-Gate ausgeführt,
  // damit kein Dialog übersprungen wird. `nightConfirmedOverride` reicht die im
  // Nachtflug-Dialog getroffene Entscheidung an die Protokoll-Notiz weiter.
  const proceedFromRestrictions = (nightConfirmedOverride?: boolean) => {
    // Ein offenes Flugverbot (PROHIBITED ohne Begründung) wird IMMER angezeigt –
    // eine allgemeine Genehmigungs-Auswahl deckt kein Verbot.
    if (
      openProhibitedZones.length === 0 &&
      !(hasWarnings && !avAcknowledged && restrictionChoice !== "approved" && restrictionChoice !== "limited")
    ) {
      navigateToDetails(nightConfirmedOverride);
      return;
    }

    const warnings: string[] = [];
    if (hasEdr146Block || hasEdr146OuterBlock) warnings.push("ED-R 146 Flugbeschränkungsgebiet");
    if (hasEdrRotBlock) warnings.push("Rote ED-R Zone(n) im Umkreis");
    if (tempRestrictions.length > 0) warnings.push(`${tempRestrictions.length} temporäre Beschränkung(en)`);
    if (openProhibitedZones.length > 0) {
      warnings.push(`${openProhibitedZones.length} Flugverbotszone(n) ohne Begründung – Ergebnis NO-GO`);
    }
    if (zoneClass.confirmationZones.length > 0) {
      warnings.push(`${zoneClass.confirmationZones.length} Geozone(n) mit Freigabe-/Genehmigungspflicht ohne AV`);
    }
    if (hasCoverageGap) warnings.push(...coverageGapWarnings);
    if (hasMilLowFlightWarning) {
      const names = Array.from(milRouteAreaIds)
        .map((id) => milRouteIntersections.find((it) => it.area.id === id)?.area.name
          ?? milTakeoffAreas.find((a) => a.id === id)?.name
          ?? id)
        .join(", ");
      const segCount = milRouteIntersections.length;
      const detail = segCount > 0
        ? `${segCount} Routensegment(e) kreuzen militärische Tieffluggebiete (${names})`
        : `Standort liegt in militärischem Tieffluggebiet (${names})`;
      const liveActive = milLowFlightHotHits.length > 0;
      const activeHint = liveActive
        ? "live aktiv/demnächst"
        : (milActive ? "wahrscheinlich aktiv" : "");
      warnings.push(activeHint ? `${detail} – ${activeHint}` : detail);
    } else if (milLowFlightHotHits.length > 0) {
      warnings.push(`Militärisches Tieffluggebiet (Tag) aktiv/demnächst: ${milLowFlightHotHits.map((m) => m.name).join(", ")}`);
    }

    if (warnings.length === 0) {
      // Es bleiben keine offenen Warnungen. Wenn die einzigen erkannten Zonen
      // bereits durch Einzelgenehmigungen abgedeckt sind (keine §21h-AV-Zonen),
      // gibt es nichts mehr zu bestätigen → ohne widersprüchlichen
      // "Allgemeinverfügung"-Dialog direkt fortfahren. Nur bei tatsächlich per
      // §21h-Allgemeinverfügung abgedeckten Zonen an den Haken erinnern.
      if (coveredGeozones.length === 0) {
        navigateToDetails(nightConfirmedOverride);
        return;
      }
      Alert.alert(
        "Bestätigung ausstehend",
        "Die erkannten Geozonen sind durch deine Allgemeinverfügung abgedeckt. Bitte bestätige oben, dass du dich an die Bedingungen deiner Allgemeinverfügung hältst – oder fahre ohne Bestätigung fort.",
        [
          { text: "Abbrechen", style: "cancel" },
          {
            text: "Trotzdem fortfahren",
            onPress: () => navigateToDetails(nightConfirmedOverride),
          },
        ]
      );
      return;
    }

    Alert.alert(
      "Einschränkungen erkannt",
      `Im Umkreis deines Standorts gibt es Einschränkungen:\n\n${warnings.map(w => `• ${w}`).join("\n")}\n\nEin Flug in diesen Bereichen kann gegen Vorschriften verstoßen. Möchtest du trotzdem fortfahren?`,
      [
        { text: "Planung abbrechen", style: "cancel", onPress: handleAbort },
        {
          text: "Trotzdem fortfahren",
          style: "destructive",
          onPress: () => navigateToDetails(nightConfirmedOverride),
        },
      ]
    );
  };

  const handleAbort = () => {
    // "Planung abbrechen" muss den GESAMTEN Planungs-Flow verlassen, egal über
    // welchen Einstieg er gestartet wurde (Neu-Planung oder Fortsetzen/Bearbeiten
    // eines bestehenden Eintrags). Der FlightPlanning-Stack hängt als Modal am
    // RootStack -> Eltern-goBack schließt das ganze Modal. Defensiv wird auf den
    // eigenen Stack zurückgefallen, damit der Abbruch nie ein stiller No-Op ist.
    const parent = navigation.getParent();
    const action = decidePlanningAbortAction({
      hasParent: parent != null,
      parentCanGoBack: parent?.canGoBack() ?? false,
      selfCanGoBack: navigation.canGoBack(),
    });
    if (action === "parentGoBack") {
      parent!.goBack();
    } else if (action === "selfGoBack") {
      navigation.goBack();
    }
  };

  // Einstufungs-Badge (Label + Farbe aus der Policy-Tabelle).
  const renderPolicyBadge = (pol: RestrictionPolicyEntry, testID?: string) => (
    <View testID={testID} style={[styles.badge, styles.policyBadge, { borderColor: pol.color }]}>
      <ThemedText style={[styles.badgeText, { color: pol.color }]}>{pol.labelDe}</ThemedText>
    </View>
  );

  // Flugverbot (PROHIBITED) bewusst übersteuern – nur mit Begründung. Ohne
  // Begründung bleibt das Urteil NO-GO. Nutzt das Layout der Ausnahme-Zeile.
  const renderProhibitedOverride = (gz: GeozoneFeatureInfo, testSuffix: string) => {
    const key = getGeozoneKey(gz);
    const reason = prohibitedOverrides.get(key);
    const checked = reason !== undefined;
    const valid = hasOverrideReason(reason);
    const noGo = theme.statusNoGo || "#FF3B30";
    const caution = theme.statusCaution || "#FF9500";
    return (
      <View>
        <Pressable
          testID={`button-prohibited-override-${testSuffix}`}
          onPress={() => {
            setProhibitedOverrides((prev) => {
              const next = new Map(prev);
              if (next.has(key)) {
                next.delete(key);
                overrideTimes.current.delete(key);
              } else {
                next.set(key, "");
                overrideTimes.current.set(key, new Date().toISOString());
              }
              return next;
            });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={[
            styles.exemptionRow,
            { borderColor: valid ? caution : noGo, backgroundColor: valid ? theme.statusCautionBackground : "transparent" },
          ]}
        >
          <View style={[styles.exemptionCheckbox, { backgroundColor: checked ? (valid ? caution : noGo) : "transparent", borderColor: valid ? caution : noGo }]}>
            {checked ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
          </View>
          <View style={styles.exemptionTextContainer}>
            <ThemedText style={[styles.exemptionTitle, { color: valid ? caution : noGo, fontWeight: "700" }]}>
              {valid ? "Flugverbot übersteuert (wird protokolliert)" : "NO-GO: Flugverbot – nur mit Begründung übersteuerbar"}
            </ThemedText>
            <ThemedText style={[styles.exemptionDesc, { color: theme.textSecondary }]}>
              Nur mit Sondergenehmigung der zuständigen Behörde. Begründung und Aktenzeichen werden im Flugprotokoll dokumentiert.
            </ThemedText>
          </View>
        </Pressable>
        {checked ? (
          <TextInput
            testID={`input-prohibited-reason-${testSuffix}`}
            style={[styles.notesInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, marginTop: Spacing.xs }]}
            value={reason}
            onChangeText={(text) =>
              setProhibitedOverrides((prev) => {
                const next = new Map(prev);
                next.set(key, text);
                return next;
              })
            }
            placeholder="Begründung (Pflicht), z. B. Sondergenehmigung Az. …"
            placeholderTextColor={theme.textTertiary}
            multiline
          />
        ) : null}
      </View>
    );
  };

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
        <ThemedText style={styles.title}>Einschränkungen prüfen</ThemedText>
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          Automatische Prüfung der Geozonen für deinen Standort
        </ThemedText>
        <GeozoneDataChangedBanner change={verdictWatch.change} onDismiss={verdictWatch.dismiss} />
        {countryIso === "DE" ? (
          <View style={styles.dipulSourceInfo}>
            <ThemedText style={[styles.dipulSourceText, { color: theme.textSecondary }]}>
              {!dipulSourceStatus
                ? "DIPUL-Geozonen werden geprüft."
                : dipulSourceStatus.mode === "vector"
                  ? "Dauerhafte Geozonen werden geometrisch mit DIPUL-Vektordaten abgeglichen. Temporäre Beschränkungen werden separat geprüft."
                  : dipulSourceStatus.mode === "mixed"
                    ? "Dauerhafte Geozonen: Vektorprüfung; einzelne Gebiete nur näherungsweise. Temporäre Beschränkungen werden separat geprüft."
                    : "DIPUL-Vektordaten sind derzeit nicht erreichbar. Die Erkennung ist nur näherungsweise – bitte die offizielle Karte prüfen."}
            </ThemedText>
            <Pressable
              accessibilityRole="link"
              onPress={() => openLink("https://www.dipul.de/homepage/de/aktuelle-meldungen/vektordaten-der-geografischen-gebiete-verfuegbar/").catch(() => {})}
            >
              <ThemedText style={[styles.dipulSourceLink, { color: theme.primary }]}>
                Quelle: dipul
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => openLink(TILE_STORE_ATTRIBUTION.DE.url!, "CC BY-ND 4.0").catch(() => {})}
            >
              <ThemedText style={[styles.dipulSourceLink, { color: theme.primary }]}>
                {TILE_STORE_ATTRIBUTION.DE.label}
                {getTilePartMeta("DE")?.createdAt
                  ? ` · Offline-Daten vom ${new Date(getTilePartMeta("DE")!.createdAt).toLocaleDateString("de-DE")}`
                  : ""}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

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

        {plannedDate ? (
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Feather name="map-pin" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.summaryText, { color: theme.textSecondary }]}>
                {locationName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`}
              </ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <Feather name="clock" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.summaryText, { color: theme.textSecondary }]}>
                {new Date(plannedDate + "T00:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short" })} {plannedTime} - {endTime}
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {nightWindow.anyNight ? (
          <Card
            style={[
              styles.statusCard,
              {
                borderLeftColor: isNightPermitCountry
                  ? (theme.statusNoGo || "#FF3B30")
                  : (theme.statusCaution || "#FF9500"),
              },
            ]}
          >
            <Feather
              name="moon"
              size={20}
              color={isNightPermitCountry ? (theme.statusNoGo || "#FF3B30") : (theme.statusCaution || "#FF9500")}
            />
            <View style={styles.statusTextContainer}>
              <ThemedText
                style={[
                  styles.statusTitle,
                  { color: isNightPermitCountry ? (theme.statusNoGo || "#FF3B30") : (theme.statusCaution || "#FF9500") },
                ]}
              >
                {nightWindow.allNight ? "Nachtflug geplant" : "Flug teilweise in der Nacht"}
              </ThemedText>
              <ThemedText style={[styles.statusDesc, { color: theme.textSecondary }]}>
                Dein Flugfenster liegt {nightWindow.allNight ? "" : "teilweise "}in der gesetzlichen Nacht (Sonne unter -6°). {nightRule.detail}
              </ThemedText>
              {isNightPermitCountry ? (
                <Pressable
                  onPress={() => {
                    setNightPermitConfirmed((prev) => !prev);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  style={[
                    styles.exemptionRow,
                    {
                      borderColor: nightPermitConfirmed ? (theme.statusGo || "#34C759") : theme.border,
                      backgroundColor: nightPermitConfirmed ? theme.statusGoBackground : "transparent",
                    },
                  ]}
                  testID="checkbox-night-permit"
                >
                  <View
                    style={[
                      styles.exemptionCheckbox,
                      {
                        backgroundColor: nightPermitConfirmed ? (theme.statusGo || "#34C759") : "transparent",
                        borderColor: nightPermitConfirmed ? (theme.statusGo || "#34C759") : theme.border,
                      },
                    ]}
                  >
                    {nightPermitConfirmed ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                  </View>
                  <View style={styles.exemptionTextContainer}>
                    <ThemedText style={styles.exemptionTitle}>
                      Nachtflug-Genehmigung/Sonderfreigabe liegt vor
                    </ThemedText>
                    <ThemedText style={[styles.exemptionDesc, { color: theme.textSecondary }]}>
                      Bestätige, dass eine gültige Genehmigung für den Nachtflug vorliegt.
                    </ThemedText>
                  </View>
                </Pressable>
              ) : null}
            </View>
          </Card>
        ) : null}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
              Geozonen werden geprüft...
            </ThemedText>
          </View>
        ) : null}

        {!loading && error ? (
          <Card style={[styles.statusCard, { borderLeftColor: theme.statusCaution || "#FF9500" }]}>
            <Feather name="alert-triangle" size={20} color={theme.statusCaution || "#FF9500"} />
            <ThemedText style={[styles.statusText, { color: theme.statusCaution || "#FF9500" }]}>
              {attributionLabel(isAdmin, "Geozonen konnten nicht geladen werden. Bitte prüfe manuell auf dipul.de", "Geozonen konnten nicht geladen werden. Bitte später erneut versuchen.")}
            </ThemedText>
          </Card>
        ) : null}

        {hasCoverageGap ? (
          <Card testID="coverage-gap-warning" style={[styles.statusCard, { borderLeftColor: theme.statusCaution || "#FF9500" }]}>
            <Feather name="alert-triangle" size={20} color={theme.statusCaution || "#FF9500"} />
            <View style={styles.statusTextContainer}>
              <ThemedText style={[styles.statusTitle, { color: theme.statusCaution || "#FF9500" }]}>
                Geozonen nicht vollständig geprüft
              </ThemedText>
              {coverageGapWarnings.map((w, i) => (
                <ThemedText key={`gap-${i}`} style={[styles.statusDesc, { color: theme.textSecondary }]}>
                  {w}
                </ThemedText>
              ))}
              {/* Ohne eigene Zonen-Liste gibt es sonst keine Auswahl — die manuelle
                  Bestätigung ist Pflicht, ein "keine Zonen" darf nicht still GO ergeben. */}
              {errorGap || uncoveredGeozones.length === 0 || allUncoveredExempted ? (
                <View style={{ marginTop: Spacing.sm, gap: Spacing.xs }}>
                  {([
                    ["approved", "Manuell geprüft – Flug zulässig/genehmigt", theme.statusGo || "#34C759"],
                    ["limited", "Manuell geprüft – Flug mit Einschränkungen", theme.statusCaution || "#FF9500"],
                    ["nofly", "Flug nicht möglich", theme.statusNoGo || "#FF3B30"],
                  ] as const).map(([value, label, color]) => (
                    <Pressable
                      key={value}
                      testID={`coverage-choice-${value}`}
                      onPress={() => { setRestrictionChoice(value); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                      style={[styles.choiceOption, { borderColor: restrictionChoice === value ? color : theme.border }]}
                    >
                      <Feather name={restrictionChoice === value ? "check-circle" : "circle"} size={18} color={restrictionChoice === value ? color : theme.textTertiary} />
                      <View style={styles.choiceTextContainer}>
                        <ThemedText style={[styles.choiceTitle, restrictionChoice === value ? { color, fontWeight: "700" } : undefined]}>
                          {label}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          </Card>
        ) : null}

        {!loading && !error && geozoneDataAges ? (
          <ThemedText
            testID="planning-geozone-data-age"
            style={[styles.statusDesc, { color: coverageSources.some((s) => s.status === "stale" || s.status === "partial") ? (theme.statusCaution || "#FF9500") : theme.textSecondary, marginBottom: Spacing.sm }]}
          >
            {`Geozonen-Daten – ${geozoneDataAges}`}
          </ThemedText>
        ) : null}
        {!loading ? (
          <DataStandLines
            testID="planning-geozone-refresh"
            extraLines={revalidation.pendingWifi.map((iso) => ({
              text: `${countryName(iso) || iso}: Neue Fassung verfügbar – wird im WLAN geladen`,
              tone: "offline" as const,
            }))}
            onRefresh={revalidation.refreshNow}
            refreshing={revalidation.refreshing}
          />
        ) : null}
        {!loading && !error && geozoneTruncation ? (
          <ThemedText testID="planning-geozone-truncated" style={[styles.statusDesc, { color: theme.textSecondary, marginBottom: Spacing.sm }]}>
            {geozoneTruncation}
          </ThemedText>
        ) : null}

        {!loading && manualCheckHint ? (
          <Card style={[styles.statusCard, { borderLeftColor: theme.statusCaution || "#FF9500" }]}>
            <Feather name="info" size={20} color={theme.statusCaution || "#FF9500"} />
            <View style={styles.statusTextContainer}>
              <ThemedText style={[styles.statusDesc, { color: theme.textSecondary }]}>
                {manualCheckHint}
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {!loading && !error && !hasAnyRestrictions && hasManualRestriction ? (
          <Card style={[styles.statusCard, { borderLeftColor: manualRestrictionStatus === "limited" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759") }]}>
            <Feather
              name={manualRestrictionStatus === "limited" ? "alert-circle" : "check-circle"}
              size={20}
              color={manualRestrictionStatus === "limited" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759")}
            />
            <View style={styles.statusTextContainer}>
              <ThemedText style={[styles.statusTitle, { color: manualRestrictionStatus === "limited" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759") }]}>
                {manualRestrictionStatus === "limited" ? "Einschränkungen angegeben" : "Keine Einschränkungen angegeben"}
              </ThemedText>
              <ThemedText style={[styles.statusDesc, { color: theme.textSecondary }]}>
                {manualRestrictionStatus === "limited"
                  ? "Für dieses Land liegen keine eigenen Geozonen-Daten vor. Du hast die offizielle Karte selbst geprüft und angegeben, dass am Standort Einschränkungen bestehen."
                  : "Für dieses Land liegen keine eigenen Geozonen-Daten vor. Du hast die offizielle Karte selbst geprüft und angegeben, dass am Standort keine Einschränkungen bestehen."}
              </ThemedText>
              {manualRestrictionNotes ? (
                <ThemedText style={[styles.statusDesc, { color: theme.textSecondary, marginTop: 4, fontStyle: "italic" }]}>
                  Notiz: {manualRestrictionNotes}
                </ThemedText>
              ) : null}
            </View>
          </Card>
        ) : null}

        {!loading &&
        !error &&
        !hasAnyRestrictions &&
        !hasManualRestriction &&
        (countryIso !== "DE" || (!energyInfrastructureQuery.isLoading && !energyInfrastructureQuery.isError)) ? (
          <Card style={[styles.statusCard, { borderLeftColor: theme.statusGo || "#34C759" }]}>
            <Feather name="check-circle" size={20} color={theme.statusGo || "#34C759"} />
            <View style={styles.statusTextContainer}>
              <ThemedText style={[styles.statusTitle, { color: theme.statusGo || "#34C759" }]}>
                Keine Einschränkungen
              </ThemedText>
              <ThemedText style={[styles.statusDesc, { color: theme.textSecondary }]}>
                Keine Geozonen oder temporären Beschränkungen im Umkreis gefunden
              </ThemedText>
            </View>
          </Card>
        ) : null}

        {!loading && !error && edr146Result?.isInside ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-octagon" size={16} color="#FF3B30" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF3B30" }]}>
                ED-R 146 Berlin — Strafgefahr
              </ThemedText>
            </View>
            <Card style={[styles.edrCriticalCard, { borderLeftColor: "#FF3B30" }]}>
              <View style={[styles.edrLegalBanner, { backgroundColor: "#FF3B3015" }]}>
                <Feather name="alert-triangle" size={18} color="#FF3B30" />
                <View style={styles.edrLegalBannerText}>
                  <ThemedText style={[styles.edrLegalTitle, { color: "#FF3B30" }]}>
                    {EDR_LEGAL_WARNING.paragraph} — {EDR_LEGAL_WARNING.shortText}
                  </ThemedText>
                  <ThemedText style={[styles.edrLegalBody, { color: theme.text }]}>
                    {EDR_LEGAL_WARNING.longText}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.edrInfoBlock}>
                <ThemedText style={[styles.edrInfoLabel, { color: theme.textSecondary }]}>Gebiet</ThemedText>
                <ThemedText style={[styles.edrInfoValue, { color: theme.text }]}>
                  ED-R 146 (Berlin) — Regierungsviertel
                </ThemedText>
                <ThemedText style={[styles.edrInfoDetail, { color: theme.textTertiary }]}>
                  3 NM (5,556 km) um den Reichstag. Höhe: Boden bis 2.500 ft (762 m).
                </ThemedText>
              </View>

              {edr146Result.isInnerCircle ? (
                <View style={[styles.edrZoneBadge, { backgroundColor: "#FF3B3015", borderColor: "#FF3B30" }]}>
                  <Feather name="x-circle" size={16} color="#FF3B30" />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.edrZoneBadgeTitle, { color: "#FF3B30" }]}>
                      Innerer Kreis (1 NM) — Extrem eingeschränkt
                    </ThemedText>
                    <ThemedText style={[styles.edrZoneBadgeDesc, { color: theme.textSecondary }]}>
                      Genehmigung nur bei zwingendem Erfordernis durch oberste Bundes-/Landesbehörde. Hobby-/Marketingflüge sind grundsätzlich nicht genehmigungsfähig.
                    </ThemedText>
                  </View>
                </View>
              ) : (
                <View style={[styles.edrZoneBadge, { backgroundColor: "#FF950015", borderColor: "#FF9500" }]}>
                  <Feather name="alert-circle" size={16} color="#FF9500" />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={[styles.edrZoneBadgeTitle, { color: "#FF9500" }]}>
                      2./3. Nautische Meile — AV möglich
                    </ThemedText>
                    <ThemedText style={[styles.edrZoneBadgeDesc, { color: theme.textSecondary }]}>
                      Flug unter Bedingungen der {EDR_146_NFL.avUas} ohne Einzelgenehmigung möglich. Polizei Berlin muss mindestens {POLIZEI_BERLIN.vorlaufStunden} Stunden vorher informiert werden.
                    </ThemedText>
                  </View>
                </View>
              )}

              <View style={styles.edrInfoBlock}>
                <ThemedText style={[styles.edrInfoLabel, { color: theme.textSecondary }]}>Vorlaufzeit Antrag</ThemedText>
                <ThemedText style={[styles.edrInfoValue, { color: theme.text }]}>
                  Mindestens 4 bis 6 Wochen (Sicherheitsüberprüfung)
                </ThemedText>
              </View>

              <Pressable
                onPress={() => { openLink(`tel:${POLIZEI_BERLIN.phone}`).catch(() => {}); }}
                style={[styles.ctrCallButton, { backgroundColor: "#007AFF" }]}
                testID="edr146-call-polizei"
              >
                <Feather name="phone" size={18} color="#fff" />
                <View style={styles.ctrCallTextBlock}>
                  <ThemedText style={styles.ctrCallLabel}>{POLIZEI_BERLIN.name}</ThemedText>
                  <ThemedText style={styles.ctrCallNumber}>{POLIZEI_BERLIN.phoneDisplay}</ThemedText>
                </View>
              </Pressable>

              <View style={styles.edrLinksBlock}>
                <Pressable
                  onPress={() => { openLink(BAF_CONTACT.edr146Url).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="external-link" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>BAF — ED-R 146 Informationen</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { openLink(BAF_CONTACT.antragsformularUrl).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="file-text" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>Antrag Durchfluggenehmigung</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { openLink(EDR_146_NFL.avUasPdf).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="download" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{EDR_146_NFL.avUas} (AV UAS ED-R 146)</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => { openLink(`mailto:${BAF_CONTACT.emailEdr146}`).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                >
                  <Feather name="mail" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{BAF_CONTACT.emailEdr146}</ThemedText>
                </Pressable>
              </View>

              <Pressable
                onPress={() => setEdr146Acknowledged(!edr146Acknowledged)}
                style={[styles.edrAcknowledgeRow, { borderTopWidth: 1, borderTopColor: theme.border }]}
                testID="edr146-acknowledge"
              >
                <View style={[
                  styles.edrCheckbox,
                  { borderColor: edr146Acknowledged ? "#FF3B30" : theme.textTertiary },
                  edr146Acknowledged ? { backgroundColor: "#FF3B30" } : undefined,
                ]}>
                  {edr146Acknowledged ? <Feather name="check" size={14} color="#fff" /> : null}
                </View>
                <ThemedText style={[styles.edrAcknowledgeText, { color: theme.text }]}>
                  {edr146Result?.isInnerCircle
                    ? "Ich bestätige, dass ich die Einschränkungen des inneren Kreises (1 NM) zur Kenntnis genommen habe und eine Einzelgenehmigung beantragt habe."
                    : "Ich bestätige, dass ich die Auflagen der AV sowie die Meldepflicht bei der Polizei Berlin zur Kenntnis genommen habe."
                  }
                </ThemedText>
              </Pressable>
            </Card>
          </View>
        ) : null}

        {!loading && !error && nearbyEdr.filter(z => z.id !== "146").length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="shield-off" size={16} color="#FF9500" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF9500" }]}>
                Flugbeschränkungsgebiete (ED-R)
              </ThemedText>
            </View>

            <View style={[styles.edrLegalBannerCompact, { backgroundColor: "#FF3B3010" }]}>
              <Feather name="alert-triangle" size={14} color="#FF3B30" />
              <ThemedText style={[styles.edrLegalCompactText, { color: "#FF3B30" }]}>
                {EDR_LEGAL_WARNING.paragraph}: {EDR_LEGAL_WARNING.shortText}
              </ThemedText>
            </View>

            {nearbyEdr.filter(z => z.id !== "146").map((zone) => {
              const sevColor = getEdrSeverityColor(zone.severity);
              return (
                <Card key={zone.id} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: sevColor }]}>
                  <View style={styles.geozoneCardHeader}>
                    <View style={[styles.badge, { backgroundColor: sevColor }]}>
                      <ThemedText style={styles.badgeText}>{getEdrCategoryLabel(zone.category)}</ThemedText>
                    </View>
                    <View style={[styles.badge, { backgroundColor: zone.severity === "rot" ? "#FF3B3020" : "#FF950020" }]}>
                      <ThemedText style={[styles.badgeText, { color: sevColor }]}>
                        {zone.severity === "rot" ? "ROT" : "GELB"}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.geozoneName}>{zone.name}</ThemedText>
                  {zone.operatorName ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      Betreiber: {zone.operatorName}
                    </ThemedText>
                  ) : null}
                  {zone.note ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      {zone.note}
                    </ThemedText>
                  ) : null}
                  {zone.avCovered ? (
                    <View style={styles.ctrAvRow}>
                      <Feather name="check-circle" size={12} color={theme.statusGo || "#34C759"} />
                      <ThemedText style={[styles.ctrAvText, { color: theme.statusGo || "#34C759" }]}>
                        AV vorhanden: {zone.avReference}
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={styles.ctrAvRow}>
                      <Feather name="x-circle" size={12} color="#FF3B30" />
                      <ThemedText style={[styles.ctrAvText, { color: "#FF3B30" }]}>
                        Einzelgenehmigung beim BAF erforderlich
                      </ThemedText>
                    </View>
                  )}
                </Card>
              );
            })}

            {nearbyEdr.some(z => z.id !== "146" && z.avCovered) ? (
              <Card style={[styles.edrAvConditionsCard, { borderLeftWidth: 3, borderLeftColor: "#FF9500" }]}>
                <View style={styles.ctrRulesHeader}>
                  <Feather name="clipboard" size={16} color="#FF9500" />
                  <ThemedText style={[styles.ctrRulesTitle, { color: "#FF9500" }]}>
                    AV-Bedingungen ({EDR_ENERGIE_NFL.reference})
                  </ThemedText>
                </View>
                <ThemedText style={[styles.edrAvConditionsIntro, { color: theme.textSecondary }]}>
                  Flug ohne Einzelantrag beim BAF möglich, wenn alle Bedingungen erfüllt sind:
                </ThemedText>
                {EDR_AV_CONDITIONS.map((cond) => (
                  <Pressable
                    key={cond.id}
                    onPress={() => {
                      const next = new Set(edrAvChecked);
                      if (next.has(cond.id)) { next.delete(cond.id); } else { next.add(cond.id); }
                      setEdrAvChecked(next);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={styles.edrAvCondRow}
                  >
                    <View style={[
                      styles.checkbox,
                      { borderColor: edrAvChecked.has(cond.id) ? (theme.statusGo || "#34C759") : theme.textTertiary },
                      edrAvChecked.has(cond.id) ? { backgroundColor: theme.statusGo || "#34C759" } : undefined,
                    ]}>
                      {edrAvChecked.has(cond.id) ? (
                        <Feather name="check" size={14} color="#fff" />
                      ) : null}
                    </View>
                    <ThemedText style={[styles.edrAvCondText, { color: theme.text }]}>{cond.label}</ThemedText>
                  </Pressable>
                ))}

                <View style={[styles.edrExclusionBlock, { backgroundColor: "#FF3B3008" }]}>
                  <ThemedText style={[styles.edrExclusionTitle, { color: "#FF3B30" }]}>
                    AV gilt NICHT bei:
                  </ThemedText>
                  {EDR_AV_EXCLUSIONS.map((ex, i) => (
                    <View key={i} style={styles.edrExclusionRow}>
                      <Feather name="x" size={12} color="#FF3B30" />
                      <ThemedText style={[styles.edrExclusionText, { color: theme.textSecondary }]}>{ex}</ThemedText>
                    </View>
                  ))}
                </View>

                <View style={styles.edrLinksBlock}>
                  <Pressable
                    onPress={() => { openLink(EDR_ENERGIE_NFL.pdf).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="download" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{EDR_ENERGIE_NFL.reference} (PDF)</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => { openLink(BAF_CONTACT.avEnergieUrl).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="external-link" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>BAF — AV Energie/Forschung/Wartburg</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => { openLink(BAF_CONTACT.antragsformularUrl).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="file-text" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>Einzelantrag beim BAF stellen</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => { openLink(`mailto:${BAF_CONTACT.emailGeneral}`).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="mail" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>{BAF_CONTACT.emailGeneral}</ThemedText>
                  </Pressable>
                </View>
              </Card>
            ) : null}

            {nearbyEdr.some(z => z.id !== "146" && z.severity === "rot") ? (
              <Pressable
                onPress={() => setEdrRotAcknowledged(!edrRotAcknowledged)}
                style={[styles.edrAcknowledgeRow, { backgroundColor: "#FF3B3008", borderRadius: BorderRadius.md, marginTop: Spacing.sm }]}
                testID="edr-rot-acknowledge"
              >
                <View style={[
                  styles.edrCheckbox,
                  { borderColor: edrRotAcknowledged ? "#FF3B30" : theme.textTertiary },
                  edrRotAcknowledged ? { backgroundColor: "#FF3B30" } : undefined,
                ]}>
                  {edrRotAcknowledged ? <Feather name="check" size={14} color="#fff" /> : null}
                </View>
                <ThemedText style={[styles.edrAcknowledgeText, { color: theme.text }]}>
                  Ich bestätige, dass ich eine Einzelgenehmigung beim BAF beantragt habe oder der Flug nicht in das ED-R-Gebiet führt.
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {!loading && !error && milLowFlightHits.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="shield" size={16} color={milLowFlightHotHits.length > 0 ? "#7B8B3A" : "#8E8E93"} />
              <ThemedText style={[styles.sectionTitle, { color: milLowFlightHotHits.length > 0 ? "#7B8B3A" : "#8E8E93" }]}>
                Mil. Tieffluggebiet (Tag) ({milLowFlightHits.length})
              </ThemedText>
            </View>
            {milLowFlightHotHits.length === 0 && milLowFlightInactiveHits.length > 0 ? (
              <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, marginBottom: Spacing.sm }]}>
                Derzeit keine aktive AUP/UUP- oder NOTAM-Aktivierung — nur informativ.
              </ThemedText>
            ) : null}
            {milLowFlightHits.map((mr) => {
              const areaId = mr.id.startsWith("mil-low-flight-") ? mr.id.slice("mil-low-flight-".length) : mr.id;
              const status = milLowFlightClassified.statusByAreaId[areaId] ?? "inactive";
              const statusColor = getMilStatusColor(status);
              const statusLabel = getMilStatusLabel(status);
              const isHot = status === "active" || status === "upcoming";
              return (
                <Card key={mr.id} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: statusColor }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <View style={[styles.badge, { backgroundColor: "#7B8B3A" }]}>
                      <ThemedText style={styles.badgeText}>{MIL_LOW_FLIGHT_LABEL}</ThemedText>
                    </View>
                    <View style={[styles.badge, { backgroundColor: statusColor }]}>
                      <ThemedText style={styles.badgeText} testID={`mil-status-${areaId}`}>{statusLabel}</ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.geozoneName}>{mr.name}</ThemedText>
                  <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary }]}>
                    {milLowFlightInside.length > 0
                      ? "Standort liegt im militärischen Tieffluggebiet (Tag)."
                      : "Geplanter Flugradius reicht in das militärische Tieffluggebiet (Tag)."}{" "}
                    {isHot
                      ? `Status laut DIPUL/AUP: ${statusLabel}. Höhenband GND — 250 ft AGL. NOTAM-Pflichtprüfung vor Start erforderlich.`
                      : `Status laut DIPUL/AUP: ${statusLabel} — derzeit keine bekannte Aktivierung, daher nur informativ. Vor Start dennoch NOTAMs prüfen.`}
                  </ThemedText>
                  {isAdmin ? (
                    <>
                      <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, fontSize: 11, marginTop: 4 }]}>
                        Quelle: dipul.de (Approximation, Stand {MIL_LOW_FLIGHT_DATA_STAND})
                      </ThemedText>
                      <Pressable
                        onPress={() => { openLink(MIL_LOW_FLIGHT_SOURCE_URL).catch(() => {}); }}
                        style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}
                      >
                        <Feather name="external-link" size={11} color="#7B8B3A" />
                        <ThemedText style={{ color: "#7B8B3A", fontSize: 12, fontWeight: "600" }}>Details auf dipul.de</ThemedText>
                      </Pressable>
                    </>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ) : null}

        {!loading && !error && tempRestrictions.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-triangle" size={16} color="#FF3B30" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF3B30" }]}>
                Temporäre Beschränkungen ({tempRestrictions.length})
              </ThemedText>
            </View>
            {tempRestrictions.map((tr, idx) => {
              // Farbe nach Einstufung (Policy); "Temporär" bleibt als Badge.
              const trPol = zonePolicy(tr);
              const trActive = isZoneActiveInContext(tr, planningTimeContext);
              const trProhibited = trActive && trPol === zonePolicy({ restriction: "PROHIBITED" });
              return (
                <Card key={`temp-${idx}`} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: trPol.color }]}>
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { backgroundColor: trPol.color }]}>
                      <ThemedText style={styles.badgeText}>{attributionLabel(isAdmin, "Temporär (dipul)", "Temporär")}</ThemedText>
                    </View>
                    {renderPolicyBadge(trPol)}
                  </View>
                  <ThemedText style={styles.geozoneName}>{tr.name}</ThemedText>
                  {tr.details ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]} numberOfLines={3}>
                      {tr.details}
                    </ThemedText>
                  ) : null}
                  {trProhibited ? renderProhibitedOverride(tr, `temp-${idx}`) : null}
                </Card>
              );
            })}
          </View>
        ) : null}

        {!loading && !error && nearbyCtr.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="navigation" size={16} color="#FF3B30" />
              <ThemedText style={[styles.sectionTitle, { color: "#FF3B30" }]}>
                Kontrollzone ({nearbyCtr.length > 1 ? `${nearbyCtr.length} Flughäfen` : "1 Flughafen"})
              </ThemedText>
            </View>
            {nearbyCtr.map((ctr) => {
              const catColor = getCtrCategoryColor(ctr.category);
              const ctrDistanceKm = getCtrDistanceKm(latitude, longitude, ctr);
              const clearance = ctr.avInfo ? getCtrClearanceForAirport(ctrDistanceKm, ctr.avInfo) : null;
              const isInnen = clearance ? clearance.area === "innen" : false;
              const clearanceColor = isInnen ? "#FF9500" : (theme.statusGo || "#34C759");
              return (
                <Card key={ctr.icao} style={[styles.ctrCard, { borderLeftWidth: 3, borderLeftColor: catColor }]}>
                  <View style={styles.ctrCardHeader}>
                    <View style={[styles.badge, { backgroundColor: catColor }]}>
                      <ThemedText style={styles.badgeText}>{getCtrCategoryLabel(ctr.category)}</ThemedText>
                    </View>
                    <ThemedText style={[styles.ctrIcao, { color: theme.textTertiary }]}>{ctr.icao}</ThemedText>
                  </View>
                  <ThemedText style={styles.geozoneName}>{ctr.name}</ThemedText>
                  {ctr.note ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      {ctr.note}
                    </ThemedText>
                  ) : null}
                  {clearance ? (
                    <View style={[styles.ctrClearanceBox, { backgroundColor: clearanceColor + "15", borderColor: clearanceColor + "40" }]}>
                      <View style={styles.ctrAvRow}>
                        <Feather name={isInnen ? "alert-circle" : "check-circle"} size={13} color={clearanceColor} />
                        <ThemedText style={[styles.ctrAvText, { color: clearanceColor, fontWeight: "600" }]}>
                          {isInnen
                            ? `${clearance.zoneLabel ?? "Innenbereich"} (${ctrDistanceKm.toFixed(1)} km) \u2013 individuelle FVK-Freigabe n\u00f6tig`
                            : `${clearance.zoneLabel ?? "Au\u00dfenbereich"} (${ctrDistanceKm.toFixed(1)} km) \u2013 pauschale Freigabe m\u00f6glich`}
                        </ThemedText>
                      </View>
                      <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, fontSize: 11, marginTop: 2 }]}>
                        {isInnen
                          ? "Keine pauschale H\u00f6he \u2013 DFS-Portal/Tower kontaktieren (Vorlauf i. d. R. 14 Tage)"
                          : `Max. Flugh\u00f6he pauschal: ${clearance.heightText}`}
                      </ThemedText>
                      {getCtrEffectiveNote(ctr.avInfo) ? (
                        <ThemedText style={[styles.geozoneDetails, { color: "#FF9500", fontSize: 10, marginTop: 2, fontWeight: "600" }]}>
                          {getCtrEffectiveNote(ctr.avInfo)}
                        </ThemedText>
                      ) : null}
                      {getCtrGeometryHint(ctr.avInfo) ? (
                        <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, fontSize: 10, marginTop: 2, fontStyle: "italic" }]}>
                          {getCtrGeometryHint(ctr.avInfo)}
                        </ThemedText>
                      ) : null}
                    </View>
                  ) : null}
                  {ctr.hasAllgemeinverfuegung && ctr.avReference ? (
                    <View>
                      <View style={styles.ctrAvRow}>
                        <Feather name="check-circle" size={12} color={theme.statusGo || "#34C759"} />
                        <ThemedText style={[styles.ctrAvText, { color: theme.statusGo || "#34C759" }]}>
                          AV vorhanden: {ctr.avReference}
                        </ThemedText>
                      </View>
                      {ctr.avInfo ? (
                        <View style={{ marginLeft: 20, marginTop: 4 }}>
                          <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, fontSize: 11 }]}>
                            {ctr.avInfo.provider}
                          </ThemedText>
                          {getAvConditionsText(ctr.avInfo).slice(0, 4).map((cond, ci) => (
                            <View key={ci} style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 }}>
                              <ThemedText style={{ color: theme.textTertiary, fontSize: 10, lineHeight: 14 }}>{"\u2022"}</ThemedText>
                              <ThemedText style={{ color: theme.textTertiary, fontSize: 10, lineHeight: 14, flex: 1 }}>{cond}</ThemedText>
                            </View>
                          ))}
                          {ctr.avInfo.pdfUrl ? (
                            <Pressable
                              onPress={() => { openLink(ctr.avInfo!.pdfUrl).catch(() => {}); }}
                              style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}
                            >
                              <Feather name="file-text" size={10} color={theme.primary} />
                              <ThemedText style={{ color: theme.primary, fontSize: 10 }}>AV-PDF anzeigen</ThemedText>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {ctr.category === "military" ? (
                    <View style={styles.ctrAvRow}>
                      <Feather name="alert-triangle" size={12} color="#FF3B30" />
                      <ThemedText style={[styles.ctrAvText, { color: "#FF3B30" }]}>
                        Keine AV — Einzelkoordination mit Bundeswehr erforderlich
                      </ThemedText>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => { openLink(`tel:${ctr.towerPhone.replace(/\s/g, "")}`).catch(() => {}); }}
                    style={[styles.ctrCallButton, { backgroundColor: "#34C759" }]}
                    testID={`ctr-call-${ctr.icao}`}
                  >
                    <Feather name="phone" size={18} color="#fff" />
                    <View style={styles.ctrCallTextBlock}>
                      <ThemedText style={styles.ctrCallLabel}>Tower anrufen</ThemedText>
                      <ThemedText style={styles.ctrCallNumber}>{ctr.towerPhone}</ThemedText>
                    </View>
                  </Pressable>
                </Card>
              );
            })}
            <Card style={[styles.ctrRulesCard, { borderLeftWidth: 3, borderLeftColor: theme.primary }]}>
              <View style={styles.ctrRulesHeader}>
                <Feather name="info" size={16} color={theme.primary} />
                <ThemedText style={[styles.ctrRulesTitle, { color: theme.primary }]}>CTR-Bereichsregeln (neues DFS-Modell)</ThemedText>
              </View>
              {Object.values(CTR_AREA_RULES).map((rule) => (
                <View key={rule.label} style={styles.ctrRuleRow}>
                  <ThemedText style={[styles.ctrRuleLabel, { color: theme.text }]}>{rule.label}</ThemedText>
                  <ThemedText style={[styles.ctrRuleRange, { color: theme.textSecondary }]}>{rule.range}</ThemedText>
                  <ThemedText style={[styles.ctrRuleStatus, { color: theme.textTertiary }]}>{rule.status}</ThemedText>
                </View>
              ))}
              {nearbyCtr.some((c) => c.category === "dfs" || c.category === "das") ? (
                <Pressable
                  onPress={() => { openLink(DFS_PORTAL_URL).catch(() => {}); }}
                  style={[styles.avLinkButton, { backgroundColor: theme.primary + "15", marginTop: Spacing.sm }]}
                >
                  <Feather name="external-link" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                    DFS-Portal (Einzelgenehmigung)
                  </ThemedText>
                </Pressable>
              ) : null}
              <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, fontSize: 10, marginTop: Spacing.sm }]}>
                Hinweis: Diese Zonenregeln gelten allgemein. Die konkreten Auflagen richten sich nach dem jeweiligen ATC-Dienstleister (siehe oben pro Flughafen).
              </ThemedText>
            </Card>
          </View>
        ) : null}

        {!loading && geozones.some((zone) => zone.informationalOnly) ? (
          <View style={styles.geozoneSection}>
            {geozones.filter((zone) => zone.informationalOnly).map((gz) => (
              <Card key={gz.featureId} style={[styles.geozoneCard, {borderLeftWidth:3,borderLeftColor:theme.primary}]}>
                <View style={styles.geozoneCardHeader}>
                  <View style={[styles.badge,{backgroundColor:theme.primary}]}>
                    <ThemedText style={styles.badgeText}>{gz.layerLabel}</ThemedText>
                  </View>
                  <ThemedText style={{color:theme.primary,fontSize:12}}>Infrastrukturhinweis</ThemedText>
                </View>
                <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                <ThemedText style={[styles.geozoneDetails,{color:theme.textSecondary}]}>{gz.details}</ThemedText>
                <InfrastructureFlightGuidance zone={gz} textColor={theme.textSecondary} linkColor={theme.primary} />
                <Pressable onPress={() => navigation.navigate("PlanningZoneFocus", {zone:gz,latitude,longitude,radiusKm:localRadiusKm,countryIso})}
                  style={[styles.avLinkButton,{backgroundColor:theme.primary+"15"}]}>
                  <Feather name="map" size={14} color={theme.primary} />
                  <ThemedText style={[styles.avLinkText,{color:theme.primary}]}>Nur diese Zone anzeigen</ThemedText>
                </Pressable>
              </Card>
            ))}
          </View>
        ) : null}
        {!loading && !error && coveredGeozones.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="shield" size={16} color={theme.statusGo || "#34C759"} />
              <ThemedText style={[styles.sectionTitle, { color: theme.statusGo || "#34C759" }]}>
                Durch geografische Allgemeinerlaubnis abgedeckt ({coveredGeozones.length})
              </ThemedText>
            </View>
            {coveredGeozones.map((gz, idx) => {
              const rule = !gz.informationalOnly ? de21hRule(gz) : null;
              return (
                <Card key={`cov-${idx}`} style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: theme.statusGo || "#34C759" }]}>
                  <View style={styles.geozoneCardHeader}>
                    <View style={[styles.badge, { backgroundColor: theme.statusGo || "#34C759" }]}>
                      <ThemedText style={styles.badgeText}>{gz.layerLabel}</ThemedText>
                    </View>
                    <Feather name="shield" size={14} color={theme.statusGo || "#34C759"} />
                  </View>
                  <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                  {gz.details ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      {gz.details}
                    </ThemedText>
                  ) : null}
                  {rule ? (
                    <View style={[styles.avAuflagenBox, { backgroundColor: theme.background, borderColor: theme.border }]}>
                      <ThemedText style={[styles.avParagraphText, { color: theme.textTertiary }]}>
                        {rule.paragraph}
                      </ThemedText>
                      <ThemedText style={[styles.avTatbestandText, { color: theme.textTertiary }]}>
                        {rule.tatbestand}
                      </ThemedText>
                      <ThemedText style={[styles.avAuflagenLabel, { color: theme.statusGo || "#34C759" }]}>
                        Erlaubt mit dieser AV - Auflagen:
                      </ThemedText>
                      {rule.auflagen.map((auflage, ai) => (
                        <View key={ai} style={styles.avBulletRow}>
                          <ThemedText style={[styles.avAuflagenText, { color: theme.textSecondary }]}>{"\u2022"}</ThemedText>
                          <ThemedText style={[styles.avAuflagenText, { color: theme.textSecondary, flex: 1 }]}>
                            {auflage}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => navigation.navigate("PlanningZoneFocus", { zone: gz, latitude, longitude, radiusKm: localRadiusKm, countryIso })}
                    style={[styles.zoneMapButton, { borderColor: theme.border }]}
                    testID={`button-zone-map-cov-${idx}`}
                  >
                    <Feather name="map" size={14} color={theme.primary} />
                    <ThemedText style={[styles.zoneMapButtonText, { color: theme.primary }]}>Auf Karte anzeigen</ThemedText>
                  </Pressable>
                </Card>
              );
            })}

            <Pressable
              onPress={() => { setAvAcknowledged(!avAcknowledged); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.acknowledgeRow,
                { borderColor: avAcknowledged ? (theme.statusGo || "#34C759") : theme.border },
                avAcknowledged ? { backgroundColor: (theme.statusGoBackground || "rgba(52, 199, 89, 0.1)") } : undefined,
              ]}
            >
              <View style={[
                styles.checkbox,
                { borderColor: avAcknowledged ? (theme.statusGo || "#34C759") : theme.textTertiary },
                avAcknowledged ? { backgroundColor: theme.statusGo || "#34C759" } : undefined,
              ]}>
                {avAcknowledged ? (
                  <Feather name="check" size={14} color="#fff" />
                ) : null}
              </View>
              <ThemedText style={styles.acknowledgeText}>
                Ich bestätige, dass ich mich in den oben genannten Geozonen bewege und mich an die Bedingungen meiner Allgemeinverfügung halte.
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {!loading && !error && hasMilLowFlightWarning ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: "#6B8E23" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="shield" size={20} color="#6B8E23" />
              <ThemedText style={[styles.avWarningTitle, { color: "#6B8E23" }]}>
                Militärisches Tieffluggebiet
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.text }]}>
              {milRouteIntersections.length > 0
                ? `Deine geplante Route kreuzt ${milRouteIntersections.length} militärische(s) Tieffluggebiet(e):`
                : `Dein Flugstandort liegt in einem militärischen Tieffluggebiet:`}
            </ThemedText>
            <View style={{ marginTop: Spacing.sm, gap: 4 }}>
              {Array.from(milRouteAreaIds).map((id) => {
                const area = milRouteIntersections.find((it) => it.area.id === id)?.area
                  ?? milTakeoffAreas.find((a) => a.id === id);
                if (!area) return null;
                return (
                  <View key={`mil-${id}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                    <Feather name="alert-triangle" size={12} color="#6B8E23" style={{ marginTop: 3 }} />
                    <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary, flex: 1 }]}>
                      {area.name} — {area.description}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary, marginTop: Spacing.sm, fontStyle: "italic" }]}>
              {milActive
                ? `Voraussichtlich aktiv zur geplanten Zeit. ${MIL_LOW_FLIGHT_ACTIVATION.note}`
                : MIL_LOW_FLIGHT_ACTIVATION.note}
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && missingBundeslandAv && detectedBundesland ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: "#FF9500" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="alert-triangle" size={20} color="#FF9500" />
              <ThemedText style={[styles.avWarningTitle, { color: "#FF9500" }]}>
                {!hasA2
                  ? "A2-Lizenz erforderlich"
                  : erlaubnisExpired
                    ? "Allgemeinerlaubnis abgelaufen"
                    : "Allgemeinerlaubnis fehlt"}
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.text }]}>
              {!hasA2 ? (
                <>
                  Für die geografische Allgemeinerlaubnis in{" "}
                  <ThemedText style={{ fontWeight: "700" }}>{detectedBundesland}</ThemedText>
                  {" "}wird ein A2-Fernpilotenzeugnis benötigt. Hinterlege es zuerst in deinem Pilotenprofil.
                </>
              ) : erlaubnisExpired ? (
                <>
                  Deine geografische Allgemeinerlaubnis für{" "}
                  <ThemedText style={{ fontWeight: "700" }}>{detectedBundesland}</ThemedText>
                  {" "}ist abgelaufen{erlaubnisForBundesland?.expirationDate ? ` (${erlaubnisForBundesland.expirationDate})` : ""}. Für den Einflug in geografische Gebiete wird eine gültige Allgemeinerlaubnis des zuständigen Bundeslandes benötigt.
                </>
              ) : (
                <>
                  Du hast keine geografische Allgemeinerlaubnis für{" "}
                  <ThemedText style={{ fontWeight: "700" }}>{detectedBundesland}</ThemedText>
                  {" "}hinterlegt. Für den Einflug in geografische Gebiete wird eine Allgemeinerlaubnis des zuständigen Bundeslandes benötigt.
                </>
              )}
            </ThemedText>
            {bundeslandAvInfo ? (
              <View style={styles.avInfoBlock}>
                <ThemedText style={[styles.avInfoLabel, { color: theme.textSecondary }]}>
                  Zuständige Behörde
                </ThemedText>
                <ThemedText style={[styles.avInfoValue, { color: theme.text }]}>
                  {bundeslandAvInfo.behorde}
                </ThemedText>
                <View style={styles.avLinkRow}>
                  <Pressable
                    onPress={() => { openLink(bundeslandAvInfo.antragUrl).catch(() => {}); }}
                    style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                  >
                    <Feather name="file-text" size={14} color={theme.primary} />
                    <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                      Antrag stellen (dipul.de)
                    </ThemedText>
                  </Pressable>
                  {bundeslandAvInfo.pdfUrl ? (
                    <Pressable
                      onPress={() => { openLink(bundeslandAvInfo.pdfUrl!).catch(() => {}); }}
                      style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name="download" size={14} color={theme.primary} />
                      <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                        Allgemeinerlaubnis PDF
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {bundeslandAvInfo.infoUrl ? (
                    <Pressable
                      onPress={() => { openLink(bundeslandAvInfo.infoUrl!).catch(() => {}); }}
                      style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name="info" size={14} color={theme.primary} />
                      <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                        Weitere Infos ({detectedBundesland})
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  {bundeslandAvInfo.additionalDocs?.filter((doc) => !doc.requiresCtr || hasCtr).map((doc, i) => (
                    <Pressable
                      key={`addoc-${i}`}
                      onPress={() => { openLink(doc.url).catch(() => {}); }}
                      style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
                    >
                      <Feather name={doc.icon as any} size={14} color={theme.primary} />
                      <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                        {doc.title}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            <Pressable
              onPress={() => {
                navigation.getParent()?.navigate("Main", { screen: "SettingsTab", params: { screen: "PilotProfile" } } as any);
              }}
              style={[styles.avSettingsLink, { borderColor: theme.border }]}
            >
              <Feather name="settings" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.avSettingsText, { color: theme.textSecondary }]}>
                Bundesland in Pilotenprofil hinzufügen
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        {!loading && !error && countryIso === "DE" && geozones.length > 0 && detectedBundesland === null ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.statusCaution || "#FF9500" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="map-pin" size={20} color={theme.statusCaution || "#FF9500"} />
              <ThemedText style={[styles.avWarningTitle, { color: theme.statusCaution || "#FF9500" }]}>
                Bundesland nicht erkannt
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary }]}>
              Das Bundesland konnte anhand der Koordinaten nicht automatisch bestimmt werden. Bitte
              prüfe manuell, ob du eine gültige Allgemeinverfügung für dieses Gebiet besitzt.
            </ThemedText>
            <Pressable
              onPress={() => { openLink("https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/").catch(() => {}); }}
              style={[styles.avLinkButton, { backgroundColor: theme.primary + "15" }]}
            >
              <Feather name="external-link" size={14} color={theme.primary} />
              <ThemedText style={[styles.avLinkText, { color: theme.primary }]}>
                dipul.de - Anträge & Informationen
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        {!loading && !error && hasBundeslandAv && detectedBundesland && coveredGeozones.length > 0 ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.statusGo || "#34C759" }]}>
            <View style={styles.avWarningHeader}>
              <Feather name="check-circle" size={20} color={theme.statusGo || "#34C759"} />
              <ThemedText style={[styles.avWarningTitle, { color: theme.statusGo || "#34C759" }]}>
                Allgemeinerlaubnis {detectedBundesland}
              </ThemedText>
            </View>
            <ThemedText style={[styles.avWarningBody, { color: theme.textSecondary }]}>
              Du hast eine gültige geografische Allgemeinerlaubnis für {detectedBundesland} hinterlegt. Die oben
              markierten Geozonen werden davon abgedeckt.
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && hiddenAboveGeozones.length > 0 ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.primary }]}>
            <View style={styles.sectionHeader}>
              <Feather name="eye-off" size={16} color={theme.primary} />
              <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>
                {hiddenAboveGeozones.length} {hiddenAboveGeozones.length === 1 ? "Zone" : "Zonen"} oberhalb deiner geplanten Höhe
              </ThemedText>
            </View>
            <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, marginTop: Spacing.xs }]}>
              Diese Zonen beginnen über {plannedAltitudeM} m und sind für deinen Flug nicht relevant: {hiddenAboveGeozones.map((gz) => gz.name || gz.layerLabel || "Unbenannt").join(", ")}.
            </ThemedText>
            <Pressable
              testID="button-show-all-geozones"
              onPress={() => { try { toggleShowAllGeozones(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
              style={{ marginTop: Spacing.sm }}
            >
              <ThemedText style={{ color: theme.primary, fontWeight: "600" }}>
                Alle Geozonen anzeigen
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}

        {!loading && !error && showAllGeozones ? (
          <Pressable
            testID="button-hide-above-geozones"
            onPress={() => { try { toggleShowAllGeozones(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_e) {} }}
            style={{ marginBottom: Spacing.sm, alignSelf: "flex-start" }}
          >
            <ThemedText style={{ color: theme.primary, fontWeight: "600" }}>
              Zonen oberhalb der Höhe wieder ausblenden
            </ThemedText>
          </Pressable>
        ) : null}

        {!loading && !error && timeInactiveGeozones.length > 0 ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.textSecondary }]} testID="card-time-inactive">
            <View style={styles.sectionHeader}>
              <Feather name="clock" size={16} color={theme.textSecondary} />
              <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                {timeInactiveGeozones.length} {timeInactiveGeozones.length === 1 ? "zeitgesteuerte Zone" : "zeitgesteuerte Zonen"} zur geplanten Zeit inaktiv
              </ThemedText>
            </View>
            {timeInactiveGeozones.map((gz, idx) => (
              <ThemedText
                key={`${gz.featureId || gz.name}-${idx}`}
                style={[styles.geozoneDetails, { color: theme.textSecondary, marginTop: Spacing.xs }]}
              >
                {gz.name || gz.layerLabel || "Unbenannt"}: {ed269InactiveInfoText(gz, plannedFlightDate ? "planned" : "now")}
              </ThemedText>
            ))}
          </Card>
        ) : null}

        {!loading && !error && altitudeClearedGeozones.length > 0 ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: theme.statusGo || "#34C759" }]} testID="card-altitude-cleared">
            <View style={styles.sectionHeader}>
              <Feather name="check-circle" size={16} color={theme.statusGo || "#34C759"} />
              <ThemedText style={[styles.sectionTitle, { color: theme.statusGo || "#34C759" }]}>
                {altitudeClearedGeozones.length} {altitudeClearedGeozones.length === 1 ? "Höhen-Limit-Zone" : "Höhen-Limit-Zonen"} unkritisch
              </ThemedText>
            </View>
            <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, marginTop: Spacing.xs }]}>
              Diese Zonen begrenzen die Flughöhe auf einen Wert, der deine geplante Höhe ({plannedAltitudeM} m) nicht einschränkt: {altitudeClearedGeozones.map((gz) => gz.name || gz.layerLabel || "Unbenannt").join(", ")}.
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && infoGeozones.length > 0 ? (
          <Card style={[styles.avWarningCard, { borderLeftColor: zonePolicy({ restriction: "NO_RESTRICTION" }).color }]} testID="card-info-zones">
            <View style={styles.sectionHeader}>
              <Feather name="info" size={16} color={zonePolicy({ restriction: "NO_RESTRICTION" }).color} />
              <ThemedText style={[styles.sectionTitle, { color: zonePolicy({ restriction: "NO_RESTRICTION" }).color }]}>
                {infoGeozones.length} {infoGeozones.length === 1 ? "Info-Zone" : "Info-Zonen"} ohne Beschränkung
              </ThemedText>
            </View>
            <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, marginTop: Spacing.xs }]}>
              Nur zur Information – keine Genehmigung oder Bestätigung nötig: {infoGeozones.map((gz) => gz.name || gz.layerLabel || "Unbenannt").join(", ")}.
            </ThemedText>
          </Card>
        ) : null}

        {!loading && !error && uncoveredGeozones.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name={zoneClass.openProhibitedZones.length > 0 ? "alert-octagon" : "alert-circle"} size={16} color={zoneClass.openProhibitedZones.length > 0 ? (theme.statusNoGo || "#FF3B30") : (theme.statusCaution || "#FF9500")} />
              <ThemedText style={[styles.sectionTitle, { color: zoneClass.openProhibitedZones.length > 0 ? (theme.statusNoGo || "#FF3B30") : (theme.statusCaution || "#FF9500") }]}>
                Weitere Geozonen ({uncoveredGeozones.length})
                {zoneClass.openProhibitedZones.length > 0 ? ` · ${zoneClass.openProhibitedZones.length} Flugverbot (NO-GO)` : ""}
                {exemptedUncoveredGeozones.length > 0
                  ? ` · ${exemptedUncoveredGeozones.length} mit Ausnahmegenehmigung`
                  : ""}
              </ThemedText>
            </View>
            {uncoveredGeozones.map((gz, idx) => {
              const key = getGeozoneKey(gz);
              const zoneAssessment = zoneClass.assessment(gz);
              const zonePol = zoneAssessment.policy;
              const isProhibited = zoneAssessment.restriction === "PROHIBITED";
              const isExempted = !isProhibited && geozoneExemptions.has(key);
              const assess = assessZone(gz);
              const climbKey = climbContentKey(gz);
              const climbAnswer = climbAnswers.get(climbKey);
              return (
                <Card
                  key={`uncov-${idx}`}
                  testID={`uncovered-zone-${zoneAssessment.restriction}`}
                  style={[
                    styles.geozoneCard,
                    {
                      borderLeftWidth: 3,
                      // Farbe je Einstufung aus der Policy-Tabelle.
                      borderLeftColor: isExempted ? theme.statusGo || "#34C759" : zonePol.color,
                    },
                  ]}
                >
                  <View style={styles.badgeRow}>
                    <View style={[styles.badge, { backgroundColor: isExempted ? theme.statusGo || "#34C759" : zonePol.color }]}>
                      <ThemedText style={styles.badgeText}>{gz.layerLabel}</ThemedText>
                    </View>
                    {renderPolicyBadge(zonePol, `policy-badge-uncov-${idx}`)}
                  </View>
                  <ThemedText style={styles.geozoneName}>{gz.name}</ThemedText>
                  <ThemedText style={[styles.geozoneDetails, { color: zonePol.color, fontWeight: "600" }]}>
                    {zonePol.explanationDe}
                  </ThemedText>
                  {gz.details ? (
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary }]}>
                      {gz.details}
                    </ThemedText>
                  ) : null}
                  {assess.needsClimbQuestion && assess.ceilingM != null ? (
                    <View style={[styles.climbQuestionBox, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
                      <ThemedText style={[styles.climbQuestionTitle, { color: theme.text }]}>
                        Diese Zone erlaubt Flüge bis {assess.ceilingM} m. Planst du, hier über {assess.ceilingM} m zu steigen?
                      </ThemedText>
                      <View style={styles.climbQuestionRow}>
                        <Pressable
                          onPress={() => {
                            setClimbAnswers((prev) => { const n = new Map(prev); n.set(climbKey, "yes"); return n; });
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                          style={[
                            styles.climbAnswerBtn,
                            { borderColor: climbAnswer === "yes" ? theme.statusCaution : theme.border },
                            climbAnswer === "yes" ? { backgroundColor: theme.statusCautionBackground } : undefined,
                          ]}
                          testID={`button-climb-yes-${idx}`}
                        >
                          <ThemedText style={[styles.climbAnswerText, climbAnswer === "yes" ? { color: theme.statusCaution, fontWeight: "700" } : { color: theme.textSecondary }]}>
                            Ja
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setClimbAnswers((prev) => { const n = new Map(prev); n.set(climbKey, "no"); return n; });
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                          style={[
                            styles.climbAnswerBtn,
                            { borderColor: climbAnswer === "no" ? theme.statusGo : theme.border },
                            climbAnswer === "no" ? { backgroundColor: theme.statusGoBackground } : undefined,
                          ]}
                          testID={`button-climb-no-${idx}`}
                        >
                          <ThemedText style={[styles.climbAnswerText, climbAnswer === "no" ? { color: theme.statusGo, fontWeight: "700" } : { color: theme.textSecondary }]}>
                            Nein, ich bleibe darunter
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  {isProhibited ? renderProhibitedOverride(gz, `uncov-${idx}`) : (
                  <Pressable
                    onPress={() => {
                      setGeozoneExemptions((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    style={[
                      styles.exemptionRow,
                      {
                        borderColor: isExempted
                          ? theme.statusGo || "#34C759"
                          : theme.border,
                        backgroundColor: isExempted
                          ? theme.statusGoBackground
                          : "transparent",
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.exemptionCheckbox,
                        {
                          backgroundColor: isExempted
                            ? theme.statusGo || "#34C759"
                            : "transparent",
                          borderColor: isExempted
                            ? theme.statusGo || "#34C759"
                            : theme.border,
                        },
                      ]}
                    >
                      {isExempted ? (
                        <Feather name="check" size={14} color="#FFFFFF" />
                      ) : null}
                    </View>
                    <View style={styles.exemptionTextContainer}>
                      <ThemedText
                        style={[
                          styles.exemptionTitle,
                          isExempted
                            ? { color: theme.statusGo, fontWeight: "700" }
                            : undefined,
                        ]}
                      >
                        Ausnahmegenehmigung vorhanden
                      </ThemedText>
                      <ThemedText style={[styles.exemptionDesc, { color: theme.textSecondary }]}>
                        Ich habe eine gültige Einzelgenehmigung für diese Geozone
                      </ThemedText>
                    </View>
                  </Pressable>
                  )}
                  <Pressable
                    onPress={() => navigation.navigate("PlanningZoneFocus", { zone: gz, latitude, longitude, radiusKm: localRadiusKm, countryIso })}
                    style={[styles.zoneMapButton, { borderColor: theme.border }]}
                    testID={`button-zone-map-uncov-${idx}`}
                  >
                    <Feather name="map" size={14} color={theme.primary} />
                    <ThemedText style={[styles.zoneMapButtonText, { color: theme.primary }]}>Auf Karte anzeigen</ThemedText>
                  </Pressable>
                </Card>
              );
            })}

            {allUncoveredExempted ? (
              <Card style={[styles.geozoneCard, { borderLeftWidth: 3, borderLeftColor: theme.statusGo || "#34C759" }]}>
                <View style={styles.sectionHeader}>
                  <Feather name="shield" size={16} color={theme.statusGo || "#34C759"} />
                  <ThemedText style={[styles.sectionTitle, { color: theme.statusGo || "#34C759" }]}>
                    Alle Geozonen durch Einzelgenehmigung abgedeckt
                  </ThemedText>
                </View>
                <ThemedText style={[styles.geozoneDetails, { color: theme.textSecondary, marginTop: 4 }]}>
                  Du hast für jede betroffene Geozone eine Ausnahmegenehmigung bestätigt. Halte die
                  Genehmigungen während des Flugs griffbereit.
                </ThemedText>
              </Card>
            ) : null}

            {!allUncoveredExempted ? (
              <ThemedText style={[styles.detailsLabel, { color: theme.textSecondary }]}>
                Wie gehst du mit den verbleibenden Einschränkungen um?
              </ThemedText>
            ) : null}

            {!allUncoveredExempted ? (
            <>
            <Pressable
              onPress={() => { setRestrictionChoice("approved"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.choiceOption,
                { borderColor: restrictionChoice === "approved" ? (theme.statusGo || "#34C759") : theme.border },
                restrictionChoice === "approved" ? { backgroundColor: theme.statusGoBackground } : undefined,
              ]}
            >
              <Feather name="shield" size={20} color={restrictionChoice === "approved" ? (theme.statusGo || "#34C759") : theme.textTertiary} />
              <View style={styles.choiceTextContainer}>
                <ThemedText style={[styles.choiceTitle, restrictionChoice === "approved" ? { color: theme.statusGo, fontWeight: "700" } : undefined]}>
                  Genehmigung vorhanden
                </ThemedText>
                <ThemedText style={[styles.choiceDesc, { color: theme.textSecondary }]}>
                  Ich habe eine gültige Genehmigung für diese Gebiete
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => { setRestrictionChoice("limited"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.choiceOption,
                { borderColor: restrictionChoice === "limited" ? (theme.statusCaution || "#FF9500") : theme.border },
                restrictionChoice === "limited" ? { backgroundColor: theme.statusCautionBackground } : undefined,
              ]}
            >
              <Feather name="alert-circle" size={20} color={restrictionChoice === "limited" ? (theme.statusCaution || "#FF9500") : theme.textTertiary} />
              <View style={styles.choiceTextContainer}>
                <ThemedText style={[styles.choiceTitle, restrictionChoice === "limited" ? { color: theme.statusCaution, fontWeight: "700" } : undefined]}>
                  Flug mit Auflagen möglich
                </ThemedText>
                <ThemedText style={[styles.choiceDesc, { color: theme.textSecondary }]}>
                  Flug ist erlaubt, aber mit Einschränkungen
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => { setRestrictionChoice("nofly"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[
                styles.choiceOption,
                { borderColor: restrictionChoice === "nofly" ? (theme.statusNoGo || "#FF3B30") : theme.border },
                restrictionChoice === "nofly" ? { backgroundColor: theme.statusNoGoBackground } : undefined,
              ]}
            >
              <Feather name="x-circle" size={20} color={restrictionChoice === "nofly" ? (theme.statusNoGo || "#FF3B30") : theme.textTertiary} />
              <View style={styles.choiceTextContainer}>
                <ThemedText style={[styles.choiceTitle, restrictionChoice === "nofly" ? { color: theme.statusNoGo, fontWeight: "700" } : undefined]}>
                  Flug nicht möglich
                </ThemedText>
                <ThemedText style={[styles.choiceDesc, { color: theme.textSecondary }]}>
                  Keine Genehmigung vorhanden
                </ThemedText>
              </View>
            </Pressable>

            {restrictionChoice !== null && restrictionChoice !== "nofly" ? (
              <View style={styles.notesSection}>
                <ThemedText style={[styles.detailsLabel, { color: theme.textSecondary }]}>
                  Notizen (optional)
                </ThemedText>
                <TextInput
                  style={[styles.notesInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Weitere Details zur Genehmigung..."
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  numberOfLines={3}
                />
              </View>
            ) : null}
            </>
            ) : null}
          </View>
        ) : null}

        {!loading && !error && countryIso === "DE" && hasAnyRestrictions ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather name="book-open" size={16} color={theme.textSecondary} />
              <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                Nützliche Dokumente
              </ThemedText>
            </View>
            <Card style={styles.resourcesCard}>
              {relevantDocs.map((res, idx) => (
                <Pressable
                  key={`res-${idx}`}
                  onPress={() => { openLink(res.url).catch(() => {}); }}
                  style={[styles.resourceRow, idx < relevantDocs.length - 1 ? { borderBottomWidth: 1, borderBottomColor: theme.border } : undefined]}
                >
                  <Feather name={res.icon as any} size={16} color={theme.primary} />
                  <ThemedText style={[styles.resourceText, { color: theme.primary }]} numberOfLines={2}>
                    {res.title}
                  </ThemedText>
                  <Feather name="external-link" size={12} color={theme.textTertiary} />
                </Pressable>
              ))}
            </Card>
          </View>
        ) : null}

        {complianceResult && complianceResult.items.length > 0 ? (
          <View style={styles.geozoneSection}>
            <View style={styles.sectionHeader}>
              <Feather
                name={complianceResult.overallStatus === "error" ? "alert-circle" : complianceResult.overallStatus === "warning" ? "alert-triangle" : "check-circle"}
                size={16}
                color={complianceResult.overallStatus === "error" ? "#FF3B30" : complianceResult.overallStatus === "warning" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759")}
              />
              <ThemedText
                style={[
                  styles.sectionTitle,
                  { color: complianceResult.overallStatus === "error" ? "#FF3B30" : complianceResult.overallStatus === "warning" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759") },
                ]}
              >
                Compliance: {complianceResult.countryLabel}
              </ThemedText>
            </View>
            {complianceResult.items
              .sort((a, b) => {
                const order = { error: 0, warning: 1, ok: 2 };
                return order[a.level] - order[b.level];
              })
              .map((item) => {
                const itemColor = item.level === "error" ? "#FF3B30" : item.level === "warning" ? (theme.statusCaution || "#FF9500") : (theme.statusGo || "#34C759");
                const iconName = item.level === "error" ? "x-circle" : item.level === "warning" ? "alert-triangle" : "check-circle";
                return (
                  <Card key={item.id} style={[styles.complianceCard, { borderLeftWidth: 3, borderLeftColor: itemColor }]}>
                    <View style={styles.complianceCardHeader}>
                      <Feather name={iconName as any} size={16} color={itemColor} />
                      <View style={styles.complianceCardBadge}>
                        <View style={[styles.badge, { backgroundColor: itemColor }]}>
                          <ThemedText style={styles.badgeText}>
                            {item.category === "pilot" ? "Pilot" : item.category === "drone" ? "Drohne" : "Land"}
                          </ThemedText>
                        </View>
                      </View>
                    </View>
                    <ThemedText style={[styles.geozoneName, { marginTop: 4 }]}>{item.title}</ThemedText>
                    <ThemedText style={[styles.geozoneDetails, { color: theme.textTertiary, marginTop: 4 }]}>
                      {item.description}
                    </ThemedText>
                    {item.actionUrl ? (
                      <Pressable
                        onPress={() => {
                          if (item.id === "nl_hint_godrone") {
                            navigation.navigate("PlanningGoDrone", { latitude, longitude });
                            return;
                          }
                          if (item.openInApp && item.actionUrl) {
                            navigation.navigate("PlanningExternalMap", {
                              url: item.actionUrl,
                              title: item.title,
                              latitude,
                              longitude,
                            });
                            return;
                          }
                          openLink(item.actionUrl!).catch(() => {});
                        }}
                        style={styles.complianceAction}
                      >
                        <Feather name="external-link" size={12} color={theme.primary} />
                        <ThemedText style={[styles.complianceActionText, { color: theme.primary }]}>
                          {item.actionLabel || "Mehr erfahren"}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.guide === "dflight-it" ? (
                      <Pressable
                        onPress={() => navigation.navigate("PlanningDflightItalyGuide", droneProfile ? { droneId: droneProfile.id } : undefined)}
                        style={[styles.complianceAction, { marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.primary + "15", borderRadius: 6, alignSelf: "flex-start" }]}
                        testID="action-dflight-it-guide"
                      >
                        <Feather name="book-open" size={12} color={theme.primary} />
                        <ThemedText style={[styles.complianceActionText, { color: theme.primary, fontWeight: "600" }]}>
                          Anleitung anzeigen
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.pilotField && pilotProfile ? (
                      <Pressable
                        onPress={async () => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const updated = { ...pilotProfile };
                          if (item.pilotField === "insuranceActive") {
                            updated.insuranceActive = true;
                          } else if (item.pilotField === "operatorId" && !updated.operatorId) {
                            return;
                          }
                          await savePilotProfile(updated);
                          setPilotProfile(updated);
                          if (droneProfile && countryIso) {
                            setComplianceResult(checkCountryCompliance(droneProfile, updated, countryIso));
                          }
                        }}
                        style={[styles.complianceAction, { marginTop: 6, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: theme.primary + "15", borderRadius: 6, alignSelf: "flex-start" }]}
                      >
                        <Feather name="check-circle" size={12} color={theme.primary} />
                        <ThemedText style={[styles.complianceActionText, { color: theme.primary, fontWeight: "600" }]}>
                          {item.pilotField === "insuranceActive" ? "Versicherung vorhanden" : item.pilotField === "operatorId" ? "Im Pilotenprofil nachtragen" : "Bestätigen"}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </Card>
                );
              })}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Weiter zu den Flugdetails"
          onPress={handleContinue}
          disabled={!canContinue}
          loading={loading}
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
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  title: {
    ...Typography.h2,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  wildlifeHint: {
    padding: Spacing.md,
    marginBottom: Spacing.lg,
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
  summaryCard: {
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  summaryText: {
    ...Typography.small,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: Spacing["2xl"],
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
  },
  statusCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    gap: Spacing.md,
    borderLeftWidth: 3,
    marginBottom: Spacing.md,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  statusDesc: {
    ...Typography.caption,
    marginTop: 2,
  },
  statusText: {
    ...Typography.body,
    flex: 1,
  },
  geozoneSection: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  geozoneCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  geozoneCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  policyBadge: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  geozoneName: {
    ...Typography.body,
    fontWeight: "500",
  },
  zoneMapButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 8,
  },
  zoneMapButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  geozoneDetails: {
    ...Typography.caption,
    marginTop: 4,
  },
  avAuflagenBox: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  avParagraphText: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: 2,
  },
  avTatbestandText: {
    ...Typography.caption,
    fontStyle: "italic",
    lineHeight: 18,
    marginBottom: 5,
  },
  avAuflagenLabel: {
    ...Typography.caption,
    fontWeight: "700",
    marginBottom: 3,
  },
  avBulletRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 2,
  },
  avAuflagenText: {
    ...Typography.caption,
    lineHeight: 18,
  },
  acknowledgeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  acknowledgeText: {
    ...Typography.caption,
    flex: 1,
    lineHeight: 18,
  },
  detailsLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  choiceOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  choiceTextContainer: {
    flex: 1,
  },
  choiceTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  choiceDesc: {
    ...Typography.caption,
    marginTop: 2,
  },
  climbQuestionBox: {
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    padding: Spacing.md,
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  climbQuestionTitle: {
    ...Typography.caption,
    fontWeight: "600",
  },
  climbQuestionRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  climbAnswerBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
  },
  climbAnswerText: {
    ...Typography.small,
  },
  exemptionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  exemptionTextContainer: {
    flex: 1,
  },
  exemptionTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  exemptionDesc: {
    ...Typography.caption,
    marginTop: 2,
  },
  exemptionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  notesSection: {
    marginTop: Spacing.md,
  },
  notesInput: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    minHeight: 80,
    textAlignVertical: "top",
    ...Typography.body,
  },
  complianceCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  complianceCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  complianceCardBadge: {
    flex: 1,
    alignItems: "flex-end",
  },
  complianceAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.sm,
    paddingVertical: 4,
  },
  complianceActionText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  ctrCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  ctrCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctrIcao: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: "monospace",
  },
  ctrClearanceBox: {
    marginTop: 8,
    padding: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
  },
  ctrAvRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  ctrAvText: {
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  ctrCallButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  ctrCallTextBlock: {
    flex: 1,
  },
  ctrCallLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  ctrCallNumber: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "500",
    fontFamily: "monospace",
  },
  ctrRulesCard: {
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  ctrRulesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  ctrRulesTitle: {
    ...Typography.body,
    fontWeight: "700",
  },
  ctrRuleRow: {
    marginBottom: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  ctrRuleLabel: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  ctrRuleRange: {
    fontSize: 12,
    marginBottom: 2,
  },
  ctrRuleStatus: {
    fontSize: 12,
  },
  avWarningCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    borderLeftWidth: 3,
  },
  avWarningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  avWarningTitle: {
    ...Typography.body,
    fontWeight: "700",
    flex: 1,
  },
  avWarningBody: {
    ...Typography.caption,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  avInfoBlock: {
    marginBottom: Spacing.md,
  },
  avInfoLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: 2,
  },
  avInfoValue: {
    ...Typography.body,
    fontWeight: "500",
    marginBottom: Spacing.sm,
  },
  avLinkRow: {
    gap: Spacing.sm,
  },
  avLinkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  avLinkText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  resourcesCard: {
    padding: 0,
    overflow: "hidden",
  },
  resourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  resourceText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  avSettingsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  avSettingsText: {
    ...Typography.caption,
    fontWeight: "500",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  edrCriticalCard: {
    padding: 0,
    borderLeftWidth: 4,
    overflow: "hidden",
  },
  edrLegalBanner: {
    flexDirection: "row",
    padding: Spacing.md,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  edrLegalBannerText: {
    flex: 1,
  },
  edrLegalTitle: {
    ...Typography.body,
    fontWeight: "700",
    fontSize: 14,
  },
  edrLegalBody: {
    ...Typography.caption,
    marginTop: 4,
    lineHeight: 18,
  },
  edrLegalBannerCompact: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  edrLegalCompactText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  edrInfoBlock: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  edrInfoLabel: {
    ...Typography.caption,
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    fontSize: 10,
    marginBottom: 2,
  },
  edrInfoValue: {
    ...Typography.body,
    fontWeight: "600",
    fontSize: 14,
  },
  edrInfoDetail: {
    ...Typography.caption,
    marginTop: 2,
  },
  edrZoneBadge: {
    flexDirection: "row",
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  edrZoneBadgeTitle: {
    ...Typography.body,
    fontWeight: "700",
    fontSize: 13,
  },
  edrZoneBadgeDesc: {
    ...Typography.caption,
    marginTop: 4,
    lineHeight: 17,
  },
  edrLinksBlock: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.xs,
  },
  edrAvConditionsCard: {
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  edrAvConditionsIntro: {
    ...Typography.caption,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  edrAvCondRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: 6,
  },
  edrAvCondText: {
    ...Typography.caption,
    flex: 1,
    lineHeight: 18,
  },
  edrExclusionBlock: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  edrExclusionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    marginBottom: Spacing.sm,
  },
  edrExclusionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 3,
  },
  edrExclusionText: {
    ...Typography.caption,
    flex: 1,
  },
  edrAcknowledgeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    gap: Spacing.md,
  },
  edrCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  edrAcknowledgeText: {
    ...Typography.caption,
    flex: 1,
    lineHeight: 18,
    fontWeight: "500",
  },
  dipulSourceInfo: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  dipulSourceText: {
    ...Typography.caption,
    lineHeight: 17,
  },
  dipulSourceLink: {
    ...Typography.caption,
    textDecorationLine: "underline",
  },
});
