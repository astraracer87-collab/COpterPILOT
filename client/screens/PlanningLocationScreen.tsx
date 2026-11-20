import { openLink } from "@/lib/webBrowser";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { View, StyleSheet, TextInput, TouchableOpacity, Alert, Platform, Keyboard, ActivityIndicator, ScrollView, Pressable, FlatList, Modal, Linking, useWindowDimensions } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Location from "@/lib/location";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import MapPicker, { MapPickerRef } from "@/components/MapPicker";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { getCountryCenter, getCountryMapConfig, reverseGeocodeCountry, detectCountryFromCoordinates, hasOwnMap, getMapConfigOrFallback, buildMapUrl } from "@/lib/countryMaps";
import { buildManualRestrictionParams, decideLocationContinueTarget } from "@/lib/manualRestrictionFlow";
import { getFlightPlanningMode } from "@/lib/flightPlanningMode";
import { getDrone, getSettings } from "@/lib/storage";
import { useAuth } from "@/lib/auth";
import { entitlementHasCountry } from "@/lib/subscription";
import { countryName } from "../../shared/countryEntitlements";
import { findPresetForDrone } from "@/lib/dronePresets";
import {
  getEnergyInfrastructureCenterForViewport,
  getEnergyInfrastructureCountry,
  getGermanWindFacility100mPoints,
  getRadarEnergyInfrastructureItems,
} from "../../shared/germanEnergyInfrastructure";
import { entitlementGrantsCountry } from "../../shared/countryEntitlements";
import { useGermanEnergyInfrastructure } from "@/lib/useGermanEnergyInfrastructure";
import {
  computeVlosM,
  computeHorizontalVlosLimitM,
  VLOS_OVERRIDE_MAX_FACTOR,
  alosKindForDroneType,
  snapMeters,
  formatMeters,
} from "@/lib/vlos";
import { queryGeozonesInArea, type GeozoneFeatureInfo, TEMP_RESTRICTION_LAYER_LABEL } from "@/lib/geozones";
import { assessGeozoneAltitudeConflict, DEFAULT_REACHABLE_ALTITUDE_M } from "../../shared/geozoneAltitudeFilter";
import { maxRestrictionVerdict, zonePolicy } from "../../shared/restrictionPolicy";
import { isZoneActiveInContext } from "../../shared/ed269Restriction";
import { filterGeozoneDetailLines } from "@/lib/sourceAttribution";
import { InfoDialog } from "@/components/InfoDialog";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningLocation">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningLocation">;

interface PoiResult {
  id: string;
  name: string;
  detail: string;
  latitude: number;
  longitude: number;
  category?: string;
}

const POI_CATEGORY_ICON: Record<string, keyof typeof Feather.glyphMap> = {
  aeroway: "navigation",
  airport: "navigation",
  hospital: "plus-square",
  amenity: "map-pin",
  building: "home",
  highway: "git-merge",
  natural: "sun",
  leisure: "sun",
  tourism: "camera",
  city: "map",
  town: "map",
  village: "map",
  place: "map",
  shop: "shopping-bag",
};

function pickCategoryIcon(category?: string, type?: string): keyof typeof Feather.glyphMap {
  if (type && POI_CATEGORY_ICON[type]) return POI_CATEGORY_ICON[type];
  if (category && POI_CATEGORY_ICON[category]) return POI_CATEGORY_ICON[category];
  return "map-pin";
}

interface ZoneContact {
  type: "phone" | "email";
  value: string;
}

// Zerlegt die mehrzeiligen Geozonen-Details in anklickbare Kontakte (Telefon/
// E-Mail) und übrige Detailzeilen (inkl. Quelle/Attribution für den Piloten).
function parseGeozoneDetail(
  details: string,
): { contacts: ZoneContact[]; otherLines: string[] } {
  // Quelle/Attribution wird in dieser Detail-Ansicht bewusst auch Piloten
  // gezeigt (Task-Anforderung) -> isAdmin=true, damit "Quelle:"-Zeilen erhalten
  // bleiben. Nur leere Zeilen werden entfernt.
  const lines = filterGeozoneDetailLines(details || "", true);
  const contacts: ZoneContact[] = [];
  const otherLines: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const phoneM = line.match(/^\s*Telefon\s*:\s*(.+)$/i);
    const emailM = line.match(/^\s*E-?Mail\s*:\s*(.+)$/i);
    if (phoneM) {
      phoneM[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean).forEach((value) => {
        const key = `phone|${value}`;
        if (!seen.has(key)) { seen.add(key); contacts.push({ type: "phone", value }); }
      });
    } else if (emailM) {
      emailM[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean).forEach((value) => {
        const key = `email|${value}`;
        if (!seen.has(key)) { seen.add(key); contacts.push({ type: "email", value }); }
      });
    } else {
      otherLines.push(line);
    }
  }
  return { contacts, otherLines };
}

async function searchNominatim(query: string, signal?: AbortSignal): Promise<PoiResult[]> {
  // Nominatim direkt (kein Server-Proxy mehr); Nominatim verlangt einen User-Agent.
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1&accept-language=de&q=" +
    encodeURIComponent(query);
  const r = await fetch(url, {
    signal,
    headers: { "User-Agent": "COpterPilot-RC/1.0", Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = await r.json();
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row: any) => {
      const lat = parseFloat(row?.lat);
      const lon = parseFloat(row?.lon);
      if (!isFinite(lat) || !isFinite(lon)) return null;
      const display: string = String(row?.display_name || "");
      const parts = display.split(",").map((s) => s.trim());
      const name = String(row?.name || parts[0] || display);
      const detail = parts.slice(1).join(", ");
      return {
        id: String(row?.place_id ?? `${lat},${lon}`),
        name,
        detail,
        latitude: lat,
        longitude: lon,
        category: row?.class || row?.category,
      } as PoiResult;
    })
    .filter((x: PoiResult | null): x is PoiResult => x !== null);
}

export default function PlanningLocationScreen() {
  const keyboardInset = useKeyboardInset();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  // Querformat (z. B. DJI RC Pro 2, 1920x1080): Karte in voller Höhe links,
  // kompaktes Seiten-Panel rechts statt der halbhohen Bottom-Card.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const mapRef = useRef<MapPickerRef>(null);

  const [detailZone, setDetailZone] = useState<GeozoneFeatureInfo | null>(null);

  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationName, setLocationName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<PoiResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [radiusM, setRadiusM] = useState(1000);
  const radiusKm = radiusM / 1000;
  // Geplante Flughöhe (AGL) – ab Schritt 1 gewählt und durch den Flow geführt,
  // damit Höhen-Limit-Zonen bereits hier höhenbewusst bewertet werden.
  const [maxAltitude, setMaxAltitude] = useState(DEFAULT_REACHABLE_ALTITUDE_M);
  const [vlosAltitudeCorrection, setVlosAltitudeCorrection] = useState(false);
  const [vlosInfo, setVlosInfo] = useState<{
    vlosM: number;
    charDimensionM: number;
    limitedBy: "alos" | "dlos";
  } | null>(null);
  const vlosInitializedRef = useRef(false);
  const radiusManuallyAdjustedRef = useRef(false);
  const sliderRef = useRef<View>(null);
  const suppressNextSearchRef = useRef(false);
  const searchTokenRef = useRef(0);

  const { droneId, countryIso } = route.params;
  const { entitlement } = useAuth();
  const [energyMapCenter, setEnergyMapCenter] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const isPreflightMode = useRef(getFlightPlanningMode() === "preflight").current;
  const planningCountryIso = selectedLocation
    ? detectCountryFromCoordinates(selectedLocation.latitude, selectedLocation.longitude) ?? countryIso
    : countryIso;
  const energyQueryLatitude = energyMapCenter?.latitude ?? selectedLocation?.latitude ?? 0;
  const energyQueryLongitude = energyMapCenter?.longitude ?? selectedLocation?.longitude ?? 0;
  const energyQueryCountryIso = energyMapCenter
    ? detectCountryFromCoordinates(energyQueryLatitude, energyQueryLongitude) ?? ""
    : planningCountryIso ?? "";
  const hasPlanningGermanEnergyAccess =
    energyQueryCountryIso.toUpperCase() === "DE" &&
    entitlementGrantsCountry(entitlement, "DE");
  const planningEnergyQuery = useGermanEnergyInfrastructure(
    energyQueryLatitude,
    energyQueryLongitude,
    5,
    energyQueryCountryIso,
    !!selectedLocation &&
      hasPlanningGermanEnergyAccess,
  );
  const planningWindFacilityPoints = useMemo(
    () => hasPlanningGermanEnergyAccess
      ? getGermanWindFacility100mPoints("DE", planningEnergyQuery.data?.features)
      : [],
    [hasPlanningGermanEnergyAccess, planningEnergyQuery.data?.features],
  );
  const planningEnergyInfrastructureItems = useMemo(() => {
    const response = planningEnergyQuery.data;
    const country = getEnergyInfrastructureCountry("DE");
    return getRadarEnergyInfrastructureItems(
      hasPlanningGermanEnergyAccess,
      response?.features,
      response?.sources,
      country?.assetComparisonStatusKeyByKind,
    );
  }, [hasPlanningGermanEnergyAccess, planningEnergyQuery.data]);
  const onEnergyMapRegionChange = useCallback((region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }) => {
    const bounds = {
      latMin: region.latitude - region.latitudeDelta / 2,
      latMax: region.latitude + region.latitudeDelta / 2,
      lonMin: region.longitude - region.longitudeDelta / 2,
      lonMax: region.longitude + region.longitudeDelta / 2,
    };
    setEnergyMapCenter((current) => getEnergyInfrastructureCenterForViewport(current, bounds));
  }, []);

  // Manuelle Einschränkungs-Bewertung für Länder OHNE eigene Geozonen-Daten:
  // Der Pilot prüft die offizielle Karte selbst und gibt danach an, ob am
  // Standort Einschränkungen bestehen. Das Ergebnis wird durch die Planungs-
  // Kette gereicht, damit die Einschränkungs-Stufe nicht erneut fragt.
  const [manualRestriction, setManualRestriction] = useState<{
    status: "approved" | "limited";
    note: string;
  } | null>(null);
  const [restrictionModalVisible, setRestrictionModalVisible] = useState(false);
  const [restrictionNoteDraft, setRestrictionNoteDraft] = useState("");
  const awaitingRestrictionRef = useRef(false);

  // Gegenprüfung der offiziellen Staatskarte für Länder MIT eigenen Geozonen-
  // Daten ist ein EIGENER Planungs-Schritt (PlanningCrossCheck) zwischen Standort
  // und Datum/Zeit. Per Einstellung steuerbar (officialMapCrossCheck, Default an).
  // Einstellung "Offizielle Karte gegenprüfen" (Default an). Steuert, ob für
  // Länder MIT eigenen Daten nach der Standortbestätigung der eigene
  // Gegenprüfungs-Schritt dazwischengeschaltet wird.
  const [crossCheckEnabled, setCrossCheckEnabled] = useState(true);

  useEffect(() => {
    getSettings()
      .then((s) => setCrossCheckEnabled(s.officialMapCrossCheck !== false))
      .catch(() => {});
  }, []);

  const countryCenter = useMemo(() => {
    return getCountryCenter(countryIso || "DE");
  }, [countryIso]);

  const radiusToDelta = (rKm: number) => {
    const delta = (rKm / 111.32) * 2.5;
    return Math.max(delta, 0.005);
  };

  const animateToLocation = useCallback((latitude: number, longitude: number) => {
    const delta = radiusToDelta(radiusM / 1000);
    mapRef.current?.animateToRegion({
      latitude,
      longitude,
      latitudeDelta: delta,
      longitudeDelta: delta,
    }, 500);
  }, [radiusM]);

  // Snappt den Slider auf den empfohlenen VLOS-Wert, sobald die Berührung
  // innerhalb der halben Schrittweite liegt — sonst kann der Pilot z.B. 118 m
  // (exakte VLOS) gar nicht treffen, weil der Slider nur in 25/50-m-Schritten
  // rastet.
  const snapToVlos = (rawMeters: number): number => {
    const step = rawMeters < 50 ? 5 : sliderMaxM <= 600 ? 25 : 50;
    const stepped = Math.round(rawMeters / step) * step;
    if (vlosPlanningLimitM != null) {
      const vlosRounded = vlosPlanningLimitM;
      if (Math.abs(rawMeters - vlosRounded) <= step / 2) {
        return vlosRounded;
      }
    }
    return stepped;
  };

  const handleRadiusChange = (meters: number) => {
    radiusManuallyAdjustedRef.current = true;
    const cap = vlosPlanningLimitM != null
      ? Math.max(300, Math.round(vlosPlanningLimitM * VLOS_OVERRIDE_MAX_FACTOR))
      : 3000;
    const clamped = Math.max(10, Math.min(cap, meters));
    const rKm = clamped / 1000;
    setRadiusM(clamped);
    if (selectedLocation) {
      const delta = radiusToDelta(rKm);
      mapRef.current?.animateToRegion({
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      }, 400);
    }
    return clamped;
  };

  const reverseGeocode = async (latitude: number, longitude: number) => {
    try {
      const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (address) {
        const parts = [address.street, address.city, address.region].filter(Boolean);
        if (parts.length > 0) {
          setLocationName(parts.slice(0, 2).join(", "));
        }
      }
    } catch {}
  };

  const selectLocation = useCallback((latitude: number, longitude: number, name?: string) => {
    setSelectedLocation({ latitude, longitude });
    if (name) {
      setLocationName(name);
    } else {
      reverseGeocode(latitude, longitude);
    }
    animateToLocation(latitude, longitude);
  }, [animateToLocation]);

  const handleMapPress = (latitude: number, longitude: number) => {
    selectLocation(latitude, longitude);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleMapLongPress = (latitude: number, longitude: number) => {
    selectLocation(latitude, longitude);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleGetCurrentLocation = async (silent: boolean = false) => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        if (!silent) {
          Alert.alert("Standort", "Bitte erlaube den Zugriff auf deinen Standort in den Einstellungen.");
        }
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = location.coords;
      setSelectedLocation({ latitude, longitude });
      animateToLocation(latitude, longitude);
      await reverseGeocode(latitude, longitude);
      if (!silent) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (!silent) Alert.alert("Fehler", "Standort konnte nicht ermittelt werden.");
    } finally {
      setLoading(false);
    }
  };

  // VLOS-Radius aus CD der gewählten Drohne berechnen und als Default setzen
  useEffect(() => {
    if (vlosInitializedRef.current) return;
    (async () => {
      try {
        const drone = await getDrone(droneId);
        if (!drone) return;
        let cd = typeof drone.charDimensionM === "number" && drone.charDimensionM > 0
          ? drone.charDimensionM
          : undefined;
        if (cd == null) {
          const preset = findPresetForDrone(drone.name, drone.manufacturer, drone.model);
          if (preset?.charDimensionM) cd = preset.charDimensionM;
        }
        if (cd == null || cd <= 0) return;
        const result = computeVlosM(cd, { kind: alosKindForDroneType(drone.droneType) });
        if (result.vlosM <= 0) return;
        vlosInitializedRef.current = true;
        setVlosInfo({ vlosM: result.vlosM, charDimensionM: cd, limitedBy: result.limitedBy });
        // Default-Radius = exakt die empfohlene VLOS aus CD der Drohne — NICHT
        // auf 25/50-m-Slider-Schritte snappen, sonst landet VLOS 118m bei 125m
        // und ist außerhalb VLOS. Der Slider erlaubt Feinjustierung; die
        // snapToVlos-Logik rastet beim manuellen Schieben am VLOS-Wert ein.
        setRadiusM(Math.max(10, Math.round(result.vlosM)));
      } catch {}
    })();
  }, [droneId]);

  const vlosPlanningLimitM = useMemo(() => {
    if (!vlosInfo) return null;
    return vlosAltitudeCorrection
      ? computeHorizontalVlosLimitM(vlosInfo.vlosM, maxAltitude)
      : Math.round(vlosInfo.vlosM);
  }, [vlosInfo, vlosAltitudeCorrection, maxAltitude]);

  useEffect(() => {
    if (!vlosInfo || vlosPlanningLimitM == null || radiusManuallyAdjustedRef.current) return;
    setRadiusM(Math.max(10, vlosPlanningLimitM));
  }, [vlosInfo, vlosPlanningLimitM]);

  const sliderMaxM = useMemo(() => {
    if (vlosPlanningLimitM == null) return 3000;
    return Math.max(300, Math.round(vlosPlanningLimitM * VLOS_OVERRIDE_MAX_FACTOR));
  }, [vlosPlanningLimitM]);
  const beyondVlos = vlosPlanningLimitM != null && radiusM > vlosPlanningLimitM;

  // Land der aktuell gewählten Position. Hat das Land KEINE eigenen Geozonen-
  // Daten, zeigen wir statt unserer (leeren) Karte einen Button zur offiziellen
  // Staatskarte bzw. zum EASA-Fallback, zentriert auf den Standort.
  const selectedCountryIso = useMemo(() => {
    if (!selectedLocation) return null;
    return detectCountryFromCoordinates(selectedLocation.latitude, selectedLocation.longitude);
  }, [selectedLocation?.latitude, selectedLocation?.longitude]);
  // Länder-Berechtigung (Task #561): Die offizielle Länderkarte ist ein
  // Pflichtschritt. Ist das geplante Land nicht freigeschaltet, zeigen wir statt
  // Karte/Gegenprüfung einen gesperrten Zustand und blockieren das Weitergehen.
  const countryLocked =
    selectedLocation != null && !entitlementHasCountry(entitlement, selectedCountryIso);
  const showOfficialMap =
    selectedLocation != null && !countryLocked && !hasOwnMap(selectedCountryIso);
  const officialMapConfig = showOfficialMap ? getMapConfigOrFallback(selectedCountryIso) : null;

  const handleOpenOfficialMap = useCallback(() => {
    if (!selectedLocation || !officialMapConfig) return;
    const url = buildMapUrl(officialMapConfig, selectedLocation.latitude, selectedLocation.longitude);
    // Nach Rückkehr aus der offiziellen Karte fragen wir, ob Einschränkungen
    // bestehen (siehe Focus-Listener unten).
    awaitingRestrictionRef.current = true;
    navigation.navigate("PlanningExternalMap", {
      url,
      title: officialMapConfig.iso === "EASA" ? "EASA Drohnen-Portal" : `Offizielle Karte – ${officialMapConfig.nameDE}`,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    });
  }, [selectedLocation?.latitude, selectedLocation?.longitude, officialMapConfig, navigation]);

  // Beim Zurückkehren aus der offiziellen Karte den Ja/Nein-Dialog öffnen.
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      if (awaitingRestrictionRef.current && showOfficialMap) {
        awaitingRestrictionRef.current = false;
        setRestrictionNoteDraft(manualRestriction?.note ?? "");
        setRestrictionModalVisible(true);
      } else {
        awaitingRestrictionRef.current = false;
      }
    });
    return unsub;
  }, [navigation, showOfficialMap, manualRestriction?.note]);

  // Standortwechsel / Wechsel zu einem Land MIT eigenen Daten verwirft eine
  // zuvor erfasste manuelle Bewertung, damit keine veraltete Angabe mitläuft.
  useEffect(() => {
    if (!showOfficialMap) {
      setManualRestriction(null);
    }
  }, [showOfficialMap, selectedCountryIso, selectedLocation?.latitude, selectedLocation?.longitude]);

  const handleRestrictionAnswer = useCallback((status: "approved" | "limited") => {
    setManualRestriction({ status, note: restrictionNoteDraft.trim() });
    setRestrictionModalVisible(false);
  }, [restrictionNoteDraft]);

  const openZoneDetail = useCallback((zone: GeozoneFeatureInfo) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setDetailZone(zone);
  }, []);

  const detailParsed = useMemo(
    () => (detailZone ? parseGeozoneDetail(detailZone.details) : null),
    [detailZone],
  );
  const detailHasContent = useMemo(() => {
    if (!detailZone || !detailParsed) return false;
    return (
      detailParsed.otherLines.length > 0 ||
      detailParsed.contacts.length > 0 ||
      (detailZone.links?.length ?? 0) > 0 ||
      !!detailZone.applicationText
    );
  }, [detailZone, detailParsed]);

  useEffect(() => {
    if (isPreflightMode && !selectedLocation) {
      handleGetCurrentLocation(true);
      return;
    }
    // Im Planungs-Modus: kein Pin setzen, aber Karte einmal auf die GPS-
    // Position des Piloten zentrieren, damit das viewport-basierte WMS-
    // Overlay das passende Land lädt (statt immer die DE-Mitte zu zeigen).
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getLastKnownPositionAsync({})
          .catch(() => null);
        const coords = loc?.coords
          ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null))?.coords;
        if (!coords) return;
        const delta = radiusToDelta(radiusM / 1000);
        mapRef.current?.animateToRegion({
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: delta,
          longitudeDelta: delta,
        }, 400);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      setSearchLoading(false);
      return;
    }
    const q = searchQuery.trim();
    if (q.length < 3) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const ctrl = new AbortController();
    const token = ++searchTokenRef.current;
    const timer = setTimeout(async () => {
      try {
        const results = await searchNominatim(q, ctrl.signal);
        if (token === searchTokenRef.current) {
          setSearchResults(results);
          setSearchLoading(false);
        }
      } catch (e) {
        if ((e as any)?.name !== "AbortError" && token === searchTokenRef.current) {
          setSearchResults([]);
          setSearchLoading(false);
        }
      }
    }, 400);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleSelectResult = (poi: PoiResult) => {
    Keyboard.dismiss();
    suppressNextSearchRef.current = true;
    searchTokenRef.current++;
    setShowResults(false);
    setSearchResults([]);
    setSearchLoading(false);
    setSearchQuery(poi.name);
    selectLocation(poi.latitude, poi.longitude, poi.detail ? `${poi.name}, ${poi.detail.split(",")[0]}` : poi.name);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleManualCoords = () => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);

    if (isNaN(lat) || isNaN(lng)) {
      Alert.alert("Fehler", "Bitte gib gültige Koordinaten ein.");
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert("Fehler", "Die Koordinaten liegen außerhalb des gültigen Bereichs.");
      return;
    }

    setSelectedLocation({ latitude: lat, longitude: lng });
    animateToLocation(lat, lng);
    reverseGeocode(lat, lng);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const [detectingCountry, setDetectingCountry] = useState(false);

  // --- Geozonen-Vorschau am gewählten Standort ---
  // Zeigt dem Piloten direkt im Standort-Screen, welche Geozonen vom aktuellen
  // Umkreis berührt werden — damit kann er sofort entscheiden, ob er den
  // Startpunkt verlegt, statt erst nach "Standort bestätigen" zu sehen, dass
  // er mitten in einem Schutzgebiet startet.
  const [touchedGeozones, setTouchedGeozones] = useState<GeozoneFeatureInfo[]>([]);
  const [touchedLoading, setTouchedLoading] = useState(false);
  const touchedTokenRef = useRef(0);

  useEffect(() => {
    if (!selectedLocation) {
      setTouchedGeozones([]);
      return;
    }
    const token = ++touchedTokenRef.current;
    setTouchedLoading(true);
    const timer = setTimeout(async () => {
      try {
        const iso = (countryIso || "DE").toUpperCase();
        const results = await queryGeozonesInArea(
          selectedLocation.latitude,
          selectedLocation.longitude,
          Math.max(radiusM / 1000, 0.05),
          iso,
        );
        // Token-Guard: ignoriert Antworten alter Anfragen (debounce / unmount).
        // queryGeozonesInArea akzeptiert (noch) keinen AbortSignal — wir
        // verwerfen das Ergebnis daher hier statt den Request abzubrechen.
        if (token === touchedTokenRef.current) {
          const permanent = (results || []).filter(
            (g) => g.layerLabel !== TEMP_RESTRICTION_LAYER_LABEL,
          );
          setTouchedGeozones(permanent);
          setTouchedLoading(false);
        }
      } catch {
        if (token === touchedTokenRef.current) {
          setTouchedGeozones([]);
          setTouchedLoading(false);
        }
      }
    }, 350);
    return () => {
      // Token invalidieren → späte fetches setzen keinen State mehr (auch
      // bei Unmount). Timer abbrechen, falls Debounce noch nicht gefeuert hat.
      touchedTokenRef.current++;
      clearTimeout(timer);
    };
  }, [selectedLocation?.latitude, selectedLocation?.longitude, radiusM, countryIso]);

  // Höhenbewusste Bewertung der Geozonen im Umkreis: Zonen, deren Höhen-Limit
  // über/gleich der geplanten Flughöhe liegt, sind unkritisch; Flugverbote und
  // Limits unter der geplanten Höhe bleiben Konflikt.
  // Zeitbezug: Kontext "planned" von zoneActivityAt. Eine geplante Flugzeit
  // gibt es in diesem Schritt noch nicht (sie wird erst später gewählt) -> jetzt.
  // Zeitgesteuerte/temporäre Zonen, die dann inaktiv sind, zählen nicht als
  // Konflikt, werden aber als Hinweis gezählt.
  const touchedAssessment = useMemo(() => {
    const planningContext = { kind: "planned" as const, planned: null };
    const activeZones = touchedGeozones.filter((g) => isZoneActiveInContext(g, planningContext));
    // Policy: reine Info-Zonen (NO_RESTRICTION) sind nie ein Konflikt.
    const restrictive = activeZones.filter((g) => zonePolicy(g).verdict !== "info");
    const assessed = restrictive.map((g) => ({
      g,
      a: assessGeozoneAltitudeConflict(g, maxAltitude),
      pol: zonePolicy(g),
    }));
    const conflicts = assessed.filter((x) => !x.a.clearedByAltitude);
    return {
      conflicts,
      cleared: assessed.filter((x) => x.a.clearedByAltitude),
      info: activeZones.filter((g) => zonePolicy(g).verdict === "info"),
      inactive: touchedGeozones.filter((g) => !activeZones.includes(g)),
      // Höchstes Policy-Urteil der Konfliktzonen (Vorschau-Farbe).
      verdict: maxRestrictionVerdict(conflicts.map((x) => x.pol.verdict)),
    };
  }, [touchedGeozones, maxAltitude]);

  const handleContinue = async () => {
    if (!selectedLocation) {
      Alert.alert("Fehler", "Bitte wähle einen Standort aus.");
      return;
    }

    if (countryLocked) {
      Alert.alert(
        "Land nicht freigeschaltet",
        `${countryName(selectedCountryIso)} ist nicht freigeschaltet. Bitte schalte das Land frei, um die Flugplanung für diesen Standort fortzusetzen.`,
      );
      return;
    }

    setDetectingCountry(true);

    let detectedCountryIso = await reverseGeocodeCountry(
      selectedLocation.latitude,
      selectedLocation.longitude
    );

    if (!detectedCountryIso) {
      detectedCountryIso = detectCountryFromCoordinates(
        selectedLocation.latitude,
        selectedLocation.longitude
      );
    }

    const finalCountryIso = detectedCountryIso || countryIso || "DE";

    setDetectingCountry(false);

    const vlosParams = vlosInfo
      ? {
          recommendedVlosM: vlosInfo.vlosM,
          vlosExceeded: beyondVlos,
          vlosCharDimensionM: vlosInfo.charDimensionM,
          vlosAltitudeCorrection,
          vlosHorizontalLimitM: vlosPlanningLimitM ?? undefined,
        }
      : {};

    const baseParams = {
      droneId,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
      locationName: locationName || undefined,
      countryIso: finalCountryIso,
      radiusKm,
      maxAltitude,
      ...vlosParams,
      ...buildManualRestrictionParams(manualRestriction),
    };

    // Länder MIT eigenen Geozonen-Daten und aktivierter Einstellung bekommen
    // die offizielle Karten-Gegenprüfung als EIGENEN Zwischenschritt
    // (PlanningCrossCheck). Sonst geht es direkt zu Datum & Zeit. Die
    // automatische Geozonen-/§21h-Erkennung bleibt davon unberührt.
    const target = decideLocationContinueTarget({
      countryLocked,
      hasOwnMapData: hasOwnMap(finalCountryIso),
      crossCheckEnabled,
    });

    // Zuerst die Gebietsübersicht (Geozonen/NOTAMs/Hindernisse/Hinweise im
    // Umkreis); deren „Weiter“ führt zum hier bestimmten Ziel.
    navigation.navigate("PlanningAreaOverview", { ...baseParams, next: target });
  };

  const renderSearchDropdown = () => {
    if (!showResults) return null;
    if (searchQuery.trim().length < 3) return null;
    if (searchResults.length === 0 && !searchLoading) return null;
    return (
      <View style={[styles.searchDropdown, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        {searchLoading ? (
          <View style={styles.searchLoadingRow}>
            <ActivityIndicator size="small" color={theme.primary} />
            <ThemedText style={[styles.searchLoadingText, { color: theme.textSecondary }]}>Suche läuft...</ThemedText>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={[styles.resultSeparator, { backgroundColor: theme.border }]} />}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelectResult(item)}
                style={({ pressed }) => [
                  styles.resultRow,
                  { backgroundColor: pressed ? theme.backgroundSecondary : "transparent" },
                ]}
                testID={`poi-result-${item.id}`}
              >
                <View style={[styles.resultIcon, { backgroundColor: theme.backgroundSecondary }]}>
                  <Feather
                    name={pickCategoryIcon(item.category)}
                    size={16}
                    color={theme.primary}
                  />
                </View>
                <View style={styles.resultText}>
                  <ThemedText style={styles.resultName} numberOfLines={1}>{item.name}</ThemedText>
                  {item.detail ? (
                    <ThemedText
                      style={[styles.resultDetail, { color: theme.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.detail}
                    </ThemedText>
                  ) : null}
                </View>
              </Pressable>
            )}
            style={{ maxHeight: isLandscape ? Math.max(140, Math.min(240, windowHeight - headerHeight - 120)) : 280 }}
          />
        )}
      </View>
    );
  };

  if (Platform.OS === "web") {
    return (
      <ThemedView style={styles.container}>
        <ScrollView
          style={styles.webScrollView}
          contentContainerStyle={[styles.webContent, { paddingTop: headerHeight + Spacing.lg, paddingBottom: 120 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <ThemedText style={styles.title}>Wo möchtest du fliegen?</ThemedText>
            <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
              Gib den geplanten Flugort an
            </ThemedText>
          </View>

          <View>
            <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="search" size={20} color={theme.textTertiary} />
              <TextInput disableFullscreenUI
                style={[styles.searchInput, { color: theme.text }]}
                value={searchQuery}
                onChangeText={(t) => { setSearchQuery(t); setShowResults(true); }}
                onFocus={() => setShowResults(true)}
                placeholder="Ort, Adresse oder POI suchen..."
                placeholderTextColor={theme.textTertiary}
                returnKeyType="search"
                testID="input-poi-search"
              />
              {searchLoading ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : searchQuery.length > 0 ? (
                <TouchableOpacity onPress={() => { setSearchQuery(""); setSearchResults([]); }} activeOpacity={0.7}>
                  <Feather name="x" size={20} color={theme.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
            {renderSearchDropdown()}
          </View>

          <TouchableOpacity onPress={() => handleGetCurrentLocation(false)} disabled={loading} activeOpacity={0.7}>
            <Card style={[styles.locationCard, { borderColor: theme.primary }]}>
              <View style={[styles.locationIcon, { backgroundColor: theme.primary }]}>
                <Feather name="navigation" size={24} color="#FFFFFF" />
              </View>
              <View style={styles.locationCardContent}>
                <ThemedText style={styles.locationCardTitle}>
                  {loading ? "Suche Standort..." : "Aktuellen Standort verwenden"}
                </ThemedText>
                <ThemedText style={[styles.locationCardSubtitle, { color: theme.textSecondary }]}>
                  GPS-Position automatisch ermitteln
                </ThemedText>
              </View>
            </Card>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            <ThemedText style={[styles.dividerText, { color: theme.textTertiary }]}>oder</ThemedText>
            <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          </View>

          <Card style={styles.inputCard}>
            <ThemedText style={styles.inputLabel}>Koordinaten manuell eingeben</ThemedText>
            <View style={styles.inputRow}>
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputHint, { color: theme.textTertiary }]}>Breitengrad</ThemedText>
                <TextInput disableFullscreenUI
                  style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={manualLat}
                  onChangeText={setManualLat}
                  placeholder="z.B. 50.1109"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.inputGroup}>
                <ThemedText style={[styles.inputHint, { color: theme.textTertiary }]}>Längengrad</ThemedText>
                <TextInput disableFullscreenUI
                  style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                  value={manualLng}
                  onChangeText={setManualLng}
                  placeholder="z.B. 8.6821"
                  placeholderTextColor={theme.textTertiary}
                  keyboardType="numeric"
                />
              </View>
            </View>
            {manualLat && manualLng ? (
              <TouchableOpacity
                style={[styles.applyButton, { backgroundColor: theme.primary }]}
                onPress={handleManualCoords}
                activeOpacity={0.7}
                testID="button-apply-coords"
              >
                <ThemedText style={styles.applyButtonText}>Übernehmen</ThemedText>
              </TouchableOpacity>
            ) : null}
          </Card>

          {selectedLocation ? (
            <Card style={styles.selectedCard}>
              <View style={styles.selectedHeader}>
                <Feather name="map-pin" size={18} color={theme.primary} />
                <ThemedText style={styles.selectedTitle}>
                  {locationName || "Standort ausgewählt"}
                </ThemedText>
              </View>
              <ThemedText style={[styles.selectedCoords, { color: theme.textSecondary }]}>
                {selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}
              </ThemedText>
              <View style={styles.selectedRadiusRow}>
                <Feather name="circle" size={14} color={theme.textSecondary} />
                <ThemedText style={[styles.selectedRadiusLabel, { color: theme.textSecondary }]}>
                  Umkreis
                </ThemedText>
                <ThemedText style={[styles.selectedRadiusValue, { color: theme.primary }]}>
                  {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(1)} km` : `${radiusM} m`}
                </ThemedText>
              </View>
              <View style={styles.radiusPresetRow}>
                {[250, 500, 1000, 2000, 3000].map((m) => {
                  const active = radiusM === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => handleRadiusChange(m)}
                      style={[
                        styles.radiusPresetBtn,
                        {
                          backgroundColor: active ? theme.primary : theme.backgroundSecondary,
                          borderColor: active ? theme.primary : theme.border,
                        },
                      ]}
                      testID={`radius-preset-${m}`}
                    >
                      <ThemedText
                        style={[
                          styles.radiusPresetLabel,
                          { color: active ? "#FFFFFF" : theme.textSecondary },
                        ]}
                      >
                        {m >= 1000 ? `${m / 1000} km` : `${m} m`}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          ) : null}

          {selectedLocation && countryLocked ? (
            <Card style={[styles.selectedCard, { borderColor: theme.statusCaution, borderWidth: 1 }]} testID="planning-country-locked">
              <View style={styles.selectedHeader}>
                <Feather name="lock" size={18} color={theme.statusCaution} />
                <ThemedText style={styles.selectedTitle}>
                  {`${countryName(selectedCountryIso)} nicht freigeschaltet`}
                </ThemedText>
              </View>
              <ThemedText style={[styles.selectedCoords, { color: theme.textSecondary }]}>
                {`Die offizielle Länderkarte und die Geozonen-Prüfung sind nur für freigeschaltete Länder verfügbar. Schalte ${countryName(selectedCountryIso)} frei, um die Flugplanung für diesen Standort fortzusetzen.`}
              </ThemedText>
            </Card>
          ) : null}

          {showOfficialMap && officialMapConfig ? (
            <Card style={[styles.selectedCard, { borderColor: theme.statusCaution, borderWidth: 1 }]}>
              <View style={styles.selectedHeader}>
                <Feather name="map" size={18} color={theme.statusCaution} />
                <ThemedText style={styles.selectedTitle}>Keine eigenen Geozonen-Daten</ThemedText>
              </View>
              <ThemedText style={[styles.selectedCoords, { color: theme.textSecondary }]}>
                {officialMapConfig.iso === "EASA"
                  ? "Für dieses Land haben wir keine eigene Karte. Nutze das EASA-Drohnenportal, um die zuständige Behörde und deren offizielle Karte zu finden."
                  : `Für ${officialMapConfig.nameDE} haben wir keine eigenen Geozonen-Daten. Öffne die offizielle Staatskarte${officialMapConfig.supportsCoordinates ? ", zentriert auf deinen Standort" : ""}.`}
              </ThemedText>
              <TouchableOpacity
                style={[styles.officialMapButton, { backgroundColor: theme.primary }]}
                onPress={() => {
                  if (!selectedLocation || !officialMapConfig) return;
                  const url = buildMapUrl(officialMapConfig, selectedLocation.latitude, selectedLocation.longitude);
                  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
                }}
                activeOpacity={0.7}
                testID="button-official-map-web"
              >
                <Feather name="external-link" size={16} color="#FFFFFF" />
                <ThemedText style={styles.officialMapButtonText}>
                  {officialMapConfig.iso === "EASA" ? "EASA-Portal öffnen" : "Offizielle Karte öffnen"}
                </ThemedText>
              </TouchableOpacity>
            </Card>
          ) : null}

          <View style={[styles.webHint, { backgroundColor: theme.statusCautionBackground }]}>
            <Feather name="info" size={16} color={theme.statusCaution} />
            <ThemedText style={[styles.webHintText, { color: theme.statusCaution }]}>
              Nutze Expo Go auf deinem Gerät für die vollständige Kartenansicht
            </ThemedText>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
          <Button
            title={detectingCountry ? "Land wird erkannt..." : "Standort bestätigen"}
            onPress={handleContinue}
            disabled={!selectedLocation || detectingCountry}
            loading={detectingCountry}
            testID="button-confirm-location"
          />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View
        style={isLandscape ? [styles.landscapeBody, { paddingTop: headerHeight }] : styles.portraitBody}
        testID={isLandscape ? "planning-location-landscape" : "planning-location-portrait"}
      >
      <View
        style={[styles.mapContainer, isLandscape ? undefined : { marginTop: headerHeight }]}
        testID="planning-location-map"
      >
        {/* Auch für Länder ohne eigene Geozonen-Daten zeigen wir UNSERE
            interaktive Karte (Pin + Umkreis). Das Geozonen-Overlay bleibt dort
            leer; die offizielle Staatskarte ist separat per Button erreichbar. */}
        <MapPicker
          ref={mapRef}
          initialRegion={countryCenter}
          selectedLocation={selectedLocation}
          locationName={locationName}
          onMapPress={handleMapPress}
          onMapLongPress={handleMapLongPress}
          radiusMeters={selectedLocation ? radiusKm * 1000 : undefined}
          radiusStrokeColor={beyondVlos ? "rgba(217, 119, 6, 0.9)" : undefined}
          radiusFillColor={beyondVlos ? "rgba(217, 119, 6, 0.18)" : undefined}
          allCountriesGeozones
          showCtrBands
          mapStyleSwitcherVariant={isLandscape ? "compact" : "segmented"}
          windFacilityPoints={planningWindFacilityPoints}
          energyInfrastructureItems={planningEnergyInfrastructureItems}
          onRegionChangeComplete={onEnergyMapRegionChange}
        />

        <View style={[styles.searchContainer, { top: Spacing.lg }, isLandscape ? styles.searchContainerLandscape : undefined]}>
          <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="search" size={20} color={theme.textTertiary} />
            <TextInput disableFullscreenUI
              style={[styles.searchInput, { color: theme.text }]}
              value={searchQuery}
              onChangeText={(t) => { setSearchQuery(t); setShowResults(true); }}
              onFocus={() => setShowResults(true)}
              placeholder="Ort, Adresse oder POI suchen..."
              placeholderTextColor={theme.textTertiary}
              returnKeyType="search"
              testID="input-poi-search"
            />
            {searchLoading ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => { setSearchQuery(""); setSearchResults([]); setShowResults(false); }} activeOpacity={0.7}>
                <Feather name="x" size={20} color={theme.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {renderSearchDropdown()}
        </View>

        <TouchableOpacity
          style={[styles.myLocationButton, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => handleGetCurrentLocation(false)}
          disabled={loading}
          activeOpacity={0.7}
        >
          {loading ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Feather name="navigation" size={22} color={theme.primary} />
          )}
        </TouchableOpacity>
      </View>

      <View
        style={
          isLandscape
            ? [styles.sidePanel, { backgroundColor: theme.backgroundDefault, borderLeftColor: theme.border, paddingBottom: insets.bottom + Spacing.md, paddingRight: Math.max(insets.right, Spacing.lg) }]
            : [styles.bottomSheet, { backgroundColor: theme.backgroundDefault, paddingBottom: insets.bottom + Spacing.lg }]
        }
        testID={isLandscape ? "planning-location-side-panel" : "planning-location-bottom-sheet"}
      >
        <KeyboardAwareScrollViewCompat bottomOffset={24}
          style={isLandscape ? styles.sidePanelScroll : styles.bottomSheetScroll}
          contentContainerStyle={isLandscape ? styles.sidePanelScrollContent : undefined}
          showsVerticalScrollIndicator={isLandscape}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {isLandscape && !selectedLocation ? (
            <View style={[styles.geozoneHint, { backgroundColor: theme.backgroundSecondary }]} testID="planning-location-empty-hint">
              <Feather name="map-pin" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.geozoneHintText, { color: theme.textSecondary }]}>
                Tippe auf die Karte oder suche einen Ort, um den Standort zu wählen.
              </ThemedText>
            </View>
          ) : null}
          {selectedLocation ? (
            <View style={styles.locationInfo}>
              <View style={styles.locationHeader}>
                <Feather name="map-pin" size={18} color={theme.primary} />
                <ThemedText style={styles.locationTitle}>
                  {locationName || "Standort ausgewählt"}
                </ThemedText>
              </View>
              <ThemedText style={[styles.coordinates, { color: theme.textSecondary }]}>
                {selectedLocation.latitude.toFixed(6)}, {selectedLocation.longitude.toFixed(6)}
              </ThemedText>
            </View>
          ) : null}

          {selectedLocation ? (
            <View style={styles.radiusSection}>
              <View style={styles.radiusHeader}>
                <Feather name="circle" size={14} color={theme.textSecondary} />
                <ThemedText style={[styles.radiusLabel, { color: theme.textSecondary }]}>Umkreis</ThemedText>
                <ThemedText style={[styles.radiusValue, { color: beyondVlos ? "#D97706" : theme.primary }]}>
                  {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(1)} km` : `${radiusM} m`}
                </ThemedText>
              </View>
              <View
                ref={sliderRef}
                style={styles.sliderTrack}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => {
                  sliderRef.current?.measure((_fx, _fy, width, _h, pageX) => {
                    const pos = Math.max(0, Math.min(1, (e.nativeEvent.pageX - pageX) / width));
                    handleRadiusChange(snapToVlos(pos * sliderMaxM));
                  });
                }}
                onResponderMove={(e) => {
                  sliderRef.current?.measure((_fx, _fy, width, _h, pageX) => {
                    const pos = Math.max(0, Math.min(1, (e.nativeEvent.pageX - pageX) / width));
                    handleRadiusChange(snapToVlos(pos * sliderMaxM));
                  });
                }}
              >
                <View style={[styles.sliderTrackBg, { backgroundColor: theme.backgroundSecondary }]} />
                {vlosPlanningLimitM != null ? (
                  <View style={[styles.sliderVlosMark, { left: `${(vlosPlanningLimitM / sliderMaxM) * 100}%`, backgroundColor: theme.primary }]} />
                ) : null}
                <View style={[styles.sliderFill, { width: `${(radiusM / sliderMaxM) * 100}%`, backgroundColor: beyondVlos ? "#D97706" : theme.primary }]} />
                <View style={[styles.sliderThumb, { left: `${(radiusM / sliderMaxM) * 100}%`, backgroundColor: beyondVlos ? "#D97706" : theme.primary, borderColor: theme.backgroundDefault }]} />
              </View>
              <View style={styles.sliderLabels}>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>0</ThemedText>
                {vlosPlanningLimitM != null ? (
                  <Pressable
                    onPress={() => handleRadiusChange(vlosPlanningLimitM)}
                    hitSlop={8}
                    testID="button-snap-vlos"
                  >
                    <ThemedText style={[styles.sliderLabelText, { color: theme.primary, fontWeight: "600", textDecorationLine: "underline" }]}>
                      VLOS {formatMeters(vlosPlanningLimitM)}
                    </ThemedText>
                  </Pressable>
                ) : (
                  <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>1.5km</ThemedText>
                )}
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>{formatMeters(sliderMaxM)}</ThemedText>
              </View>
              {vlosInfo ? (
                <View style={[styles.vlosInfoBox, { backgroundColor: beyondVlos ? "rgba(217, 119, 6, 0.12)" : theme.backgroundSecondary, borderColor: beyondVlos ? "#D97706" : "transparent", borderWidth: beyondVlos ? 1 : 0 }]}>
                  <Feather name={beyondVlos ? "alert-triangle" : "eye"} size={14} color={beyondVlos ? "#D97706" : theme.primary} />
                  <View style={{ flex: 1 }}>
                    {beyondVlos ? (
                      <>
                        <ThemedText style={[styles.vlosInfoTitle, { color: "#D97706" }]}>
                          {vlosAltitudeCorrection
                            ? `Über dem horizontalen VLOS-Richtwert – ${formatMeters(radiusM)} > ${formatMeters(vlosPlanningLimitM ?? 0)}`
                            : `Außerhalb VLOS – ${formatMeters(radiusM)} > ${formatMeters(vlosPlanningLimitM ?? 0)}`}
                        </ThemedText>
                        <ThemedText style={[styles.vlosInfoText, { color: theme.textSecondary }]}>
                          {vlosAltitudeCorrection
                            ? `Der Planungsradius überschreitet den bei ${maxAltitude} m AGL berechneten horizontalen Richtwert. Die Höhenkorrektur ist eine geometrische Näherung.`
                            : "In der Offenen Kategorie nicht zulässig (EU 2019/947, Art. 4): VLOS muss vom Fernpiloten selbst gehalten werden. Externe Luftraumbeobachter ersetzen VLOS nicht – BVLOS erfordert eine Betriebsgenehmigung in der Speziellen Kategorie (STS / PDRA / SORA). Wird im Protokoll vermerkt."}
                        </ThemedText>
                      </>
                    ) : (
                      <>
                        <ThemedText style={[styles.vlosInfoTitle, { color: theme.text }]}>
                          {vlosAltitudeCorrection
                            ? `Horizontaler Richtwert: ${formatMeters(vlosPlanningLimitM ?? 0)}`
                            : `Empfohlen: ${formatMeters(vlosPlanningLimitM ?? vlosInfo.vlosM)} (VLOS)`}
                        </ThemedText>
                        <ThemedText style={[styles.vlosInfoText, { color: theme.textSecondary }]}>
                          {vlosAltitudeCorrection
                            ? `Bei ${maxAltitude} m AGL geometrisch aus der direkten VLOS-Grenze abgeleitet. Ohne Höhenkorrektur: ${formatMeters(vlosInfo.vlosM)}.`
                            : `Der Umkreis kann bei Bedarf bis ${formatMeters(sliderMaxM)} erweitert werden; eine Überschreitung wird kenntlich gemacht.`}
                        </ThemedText>
                      </>
                    )}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {selectedLocation ? (
            <View style={styles.altitudeSection}>
              <View style={styles.radiusHeader}>
                <Feather name="arrow-up" size={14} color={theme.textSecondary} />
                <ThemedText style={[styles.radiusLabel, { color: theme.textSecondary }]}>Geplante Flughöhe (AGL)</ThemedText>
                <ThemedText style={[styles.radiusValue, { color: maxAltitude > 120 ? "#D97706" : theme.primary }]}>
                  {maxAltitude} m
                </ThemedText>
              </View>
              <View style={styles.altitudeChipRow}>
                {[30, 50, 80, 100, 120, 150].map((h) => (
                  <Pressable
                    key={h}
                    style={[
                      styles.altitudeChip,
                      { borderColor: maxAltitude === h ? theme.primary : theme.border },
                      maxAltitude === h ? { backgroundColor: theme.primary + "20" } : undefined,
                    ]}
                    onPress={() => setMaxAltitude(h)}
                    testID={`button-altitude-${h}`}
                  >
                    <ThemedText style={[styles.altitudeChipText, maxAltitude === h ? { color: theme.primary, fontWeight: "700" } : { color: theme.textSecondary }]}>
                      {h}m
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              <View style={styles.altitudeCustomRow}>
                <ThemedText style={[styles.altitudeCustomLabel, { color: theme.textSecondary }]}>Eigene Höhe:</ThemedText>
                <TextInput disableFullscreenUI
                  style={[styles.altitudeInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
                  value={String(maxAltitude)}
                  onChangeText={(t) => {
                    const n = parseInt(t, 10);
                    if (!isNaN(n) && n >= 0 && n <= 500) setMaxAltitude(n);
                    else if (t === "") setMaxAltitude(0);
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                  testID="input-altitude"
                />
                <ThemedText style={[styles.altitudeUnit, { color: theme.textSecondary }]}>m AGL</ThemedText>
              </View>
              {vlosInfo ? (
                <Pressable
                  style={[styles.vlosCorrectionToggle, { backgroundColor: theme.backgroundSecondary }]}
                  onPress={() => setVlosAltitudeCorrection((enabled) => !enabled)}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: vlosAltitudeCorrection }}
                  testID="toggle-vlos-altitude-correction"
                >
                  <Feather
                    name={vlosAltitudeCorrection ? "check-square" : "square"}
                    size={18}
                    color={vlosAltitudeCorrection ? theme.primary : theme.textSecondary}
                  />
                  <View style={styles.vlosCorrectionText}>
                    <ThemedText style={[styles.vlosCorrectionTitle, { color: theme.text }]}>
                      Flughöhe bei VLOS berücksichtigen
                    </ThemedText>
                    <ThemedText style={[styles.vlosCorrectionDescription, { color: theme.textSecondary }]}>
                      Verkürzt den horizontalen Planungsradius geometrisch. Die VLOS-Grenze bleibt unverändert. Näherung mit AGL-Höhe als Höhenunterschied.
                    </ThemedText>
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {selectedLocation && countryLocked ? (
            <View style={[styles.touchedBox, { backgroundColor: theme.statusCautionBackground, borderColor: theme.statusCaution }]} testID="planning-country-locked">
              <View style={styles.touchedHeader}>
                <Feather name="lock" size={14} color={theme.statusCaution} />
                <ThemedText style={[styles.touchedTitle, { color: theme.statusCaution }]}>
                  {`${countryName(selectedCountryIso)} nicht freigeschaltet`}
                </ThemedText>
              </View>
              <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                {`Die offizielle Länderkarte und die Geozonen-Prüfung sind nur für freigeschaltete Länder verfügbar. Schalte ${countryName(selectedCountryIso)} frei, um die Flugplanung für diesen Standort fortzusetzen.`}
              </ThemedText>
            </View>
          ) : null}

          {showOfficialMap && officialMapConfig ? (
            <View style={[styles.touchedBox, { backgroundColor: theme.statusCautionBackground, borderColor: theme.statusCaution }]}>
              <View style={styles.touchedHeader}>
                <Feather name="map" size={14} color={theme.statusCaution} />
                <ThemedText style={[styles.touchedTitle, { color: theme.statusCaution }]}>
                  Geozonen nicht anzeigbar
                </ThemedText>
              </View>
              <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                {officialMapConfig.iso === "EASA"
                  ? "Geozonen können für dieses Land nicht angezeigt werden – bitte prüfe die offizielle Karte selbst. Nutze das EASA-Drohnenportal, um die zuständige Behörde und deren Karte zu finden."
                  : `Geozonen können für ${officialMapConfig.nameDE} nicht angezeigt werden – bitte prüfe die offizielle Karte selbst${officialMapConfig.supportsCoordinates ? " (zentriert auf deinen Standort)" : ""}.`}
              </ThemedText>
              <TouchableOpacity
                style={[styles.officialMapButton, { backgroundColor: theme.primary }]}
                onPress={handleOpenOfficialMap}
                activeOpacity={0.7}
                testID="button-official-map"
              >
                <Feather name="external-link" size={16} color="#FFFFFF" />
                <ThemedText style={styles.officialMapButtonText}>
                  Offizielle Karte ansehen
                </ThemedText>
              </TouchableOpacity>

              {manualRestriction ? (
                <View
                  style={[
                    styles.manualAnswerBox,
                    {
                      backgroundColor: theme.backgroundDefault,
                      borderColor: manualRestriction.status === "limited" ? theme.statusCaution : theme.statusGo,
                    },
                  ]}
                  testID="manual-restriction-summary"
                >
                  <View style={styles.touchedHeader}>
                    <Feather
                      name={manualRestriction.status === "limited" ? "alert-circle" : "check-circle"}
                      size={14}
                      color={manualRestriction.status === "limited" ? theme.statusCaution : theme.statusGo}
                    />
                    <ThemedText
                      style={[
                        styles.touchedTitle,
                        { color: manualRestriction.status === "limited" ? theme.statusCaution : theme.statusGo },
                      ]}
                    >
                      {manualRestriction.status === "limited"
                        ? "Einschränkungen am Standort"
                        : "Keine Einschränkungen am Standort"}
                    </ThemedText>
                  </View>
                  {manualRestriction.note ? (
                    <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                      Notiz: {manualRestriction.note}
                    </ThemedText>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      setRestrictionNoteDraft(manualRestriction.note);
                      setRestrictionModalVisible(true);
                    }}
                    activeOpacity={0.7}
                    style={styles.manualAnswerEdit}
                    testID="button-edit-restriction-answer"
                  >
                    <Feather name="edit-2" size={13} color={theme.primary} />
                    <ThemedText style={[styles.manualAnswerEditText, { color: theme.primary }]}>
                      Angabe ändern
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : selectedLocation ? (
            touchedLoading && touchedGeozones.length === 0 ? (
              <View style={[styles.geozoneHint, { backgroundColor: theme.backgroundSecondary }]}>
                <ActivityIndicator size="small" color={theme.primary} />
                <ThemedText style={[styles.geozoneHintText, { color: theme.textSecondary }]}>
                  Prüfe Geozonen im Umkreis…
                </ThemedText>
              </View>
            ) : touchedGeozones.length === 0 ? (
              <View style={[styles.geozoneHint, { backgroundColor: theme.statusGoBackground }]}>
                <Feather name="check-circle" size={14} color={theme.statusGo} />
                <ThemedText style={[styles.geozoneHintText, { color: theme.statusGo }]}>
                  Keine permanenten Geozonen im Umkreis erkannt.
                </ThemedText>
              </View>
            ) : touchedAssessment.conflicts.length > 0 ? (
              <View style={[styles.touchedBox, touchedAssessment.verdict === "nogo"
                ? { backgroundColor: theme.statusNoGoBackground, borderColor: theme.statusNoGo }
                : { backgroundColor: theme.statusCautionBackground, borderColor: theme.statusCaution }]}>
                <View style={styles.touchedHeader}>
                  <Feather name={touchedAssessment.verdict === "nogo" ? "alert-octagon" : "alert-triangle"} size={14} color={touchedAssessment.verdict === "nogo" ? theme.statusNoGo : theme.statusCaution} />
                  <ThemedText style={[styles.touchedTitle, { color: touchedAssessment.verdict === "nogo" ? theme.statusNoGo : theme.statusCaution }]}>
                    {touchedAssessment.conflicts.length} Geozone{touchedAssessment.conflicts.length === 1 ? "" : "n"} im Umkreis
                    {touchedAssessment.verdict === "nogo" ? " – darunter Flugverbot" : ""}
                  </ThemedText>
                </View>
                {touchedAssessment.conflicts.slice(0, 6).map(({ g, a, pol }, idx) => (
                  <Pressable
                    key={`${g.layerLabel}-${g.name}-${idx}`}
                    style={styles.touchedRow}
                    onPress={() => openZoneDetail(g)}
                    testID={`button-geozone-detail-conflict-${idx}`}
                  >
                    <View style={[styles.touchedDot, { backgroundColor: pol.color }]} />
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[styles.touchedRowName, { color: theme.text }]} numberOfLines={2}>
                        {g.name}
                      </ThemedText>
                      <ThemedText style={[styles.touchedRowLayer, { color: theme.textSecondary }]} numberOfLines={1}>
                        {g.layerLabel} · {pol.labelDe}{a.label && a.label !== pol.labelDe ? ` · ${a.label}` : ""}{g.ed269Applicability?.length ? " · zeitweise aktiv" : ""}
                      </ThemedText>
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.textTertiary} style={styles.touchedChevron} />
                  </Pressable>
                ))}
                {touchedAssessment.conflicts.length > 6 ? (
                  <ThemedText style={[styles.touchedMore, { color: theme.textSecondary }]}>
                    +{touchedAssessment.conflicts.length - 6} weitere — Details im nächsten Schritt
                  </ThemedText>
                ) : null}
                {touchedAssessment.cleared.length > 0 ? (
                  <>
                    <ThemedText style={[styles.touchedSubhead, { color: theme.textSecondary }]}>
                      {touchedAssessment.cleared.length} Höhen-Limit-Zone{touchedAssessment.cleared.length === 1 ? "" : "n"} über deiner Höhe ({maxAltitude} m) – unkritisch:
                    </ThemedText>
                    {touchedAssessment.cleared.slice(0, 6).map(({ g, a }, idx) => (
                      <Pressable
                        key={`cleared-${g.layerLabel}-${g.name}-${idx}`}
                        style={styles.touchedRow}
                        onPress={() => openZoneDetail(g)}
                        testID={`button-geozone-detail-cleared-${idx}`}
                      >
                        <View style={[styles.touchedDot, { backgroundColor: theme.statusGo }]} />
                        <View style={{ flex: 1 }}>
                          <ThemedText style={[styles.touchedRowName, { color: theme.text }]} numberOfLines={2}>
                            {g.name}
                          </ThemedText>
                          <ThemedText style={[styles.touchedRowLayer, { color: theme.textSecondary }]} numberOfLines={1}>
                            {g.layerLabel}{a.label ? ` · ${a.label}` : ""}{g.ed269Applicability?.length ? " · zeitweise aktiv" : ""}
                          </ThemedText>
                        </View>
                        <Feather name="chevron-right" size={16} color={theme.textTertiary} style={styles.touchedChevron} />
                      </Pressable>
                    ))}
                    {touchedAssessment.cleared.length > 6 ? (
                      <ThemedText style={[styles.touchedMore, { color: theme.textSecondary }]}>
                        +{touchedAssessment.cleared.length - 6} weitere höhen-unkritische Zone{touchedAssessment.cleared.length - 6 === 1 ? "" : "n"}
                      </ThemedText>
                    ) : null}
                  </>
                ) : null}
                {touchedAssessment.inactive.length > 0 ? (
                  <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                    {touchedAssessment.inactive.length} zeitgesteuerte Zone{touchedAssessment.inactive.length === 1 ? "" : "n"} im Umkreis derzeit inaktiv – Details im nächsten Schritt.
                  </ThemedText>
                ) : null}
                <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                  Tipp: Standort verschieben, Umkreis verringern oder geplante Flughöhe anpassen, um Konflikte zu vermeiden.
                </ThemedText>
              </View>
            ) : touchedAssessment.cleared.length > 0 ? (
              <View style={[styles.touchedBox, { backgroundColor: theme.statusGoBackground, borderColor: theme.statusGo }]}>
                <View style={styles.touchedHeader}>
                  <Feather name="check-circle" size={14} color={theme.statusGo} />
                  <ThemedText style={[styles.touchedTitle, { color: theme.statusGo }]}>
                    {touchedAssessment.cleared.length} Höhen-Limit-Zone{touchedAssessment.cleared.length === 1 ? "" : "n"} – unter {maxAltitude} m unkritisch
                  </ThemedText>
                </View>
                {touchedAssessment.cleared.slice(0, 6).map(({ g, a }, idx) => (
                  <Pressable
                    key={`${g.layerLabel}-${g.name}-${idx}`}
                    style={styles.touchedRow}
                    onPress={() => openZoneDetail(g)}
                    testID={`button-geozone-detail-cleared-${idx}`}
                  >
                    <View style={[styles.touchedDot, { backgroundColor: theme.statusGo }]} />
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[styles.touchedRowName, { color: theme.text }]} numberOfLines={2}>
                        {g.name}
                      </ThemedText>
                      <ThemedText style={[styles.touchedRowLayer, { color: theme.textSecondary }]} numberOfLines={1}>
                        {g.layerLabel}{a.label ? ` · ${a.label}` : ""}{g.ed269Applicability?.length ? " · zeitweise aktiv" : ""}
                      </ThemedText>
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.textTertiary} style={styles.touchedChevron} />
                  </Pressable>
                ))}
                <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                  Diese Zonen begrenzen die Flughöhe auf einen Wert über deiner geplanten Höhe ({maxAltitude} m) – kein Konflikt.
                </ThemedText>
                {touchedAssessment.inactive.length > 0 ? (
                  <ThemedText style={[styles.touchedHint, { color: theme.textSecondary }]}>
                    {touchedAssessment.inactive.length} zeitgesteuerte Zone{touchedAssessment.inactive.length === 1 ? "" : "n"} im Umkreis derzeit inaktiv – Details im nächsten Schritt.
                  </ThemedText>
                ) : null}
              </View>
            ) : touchedAssessment.inactive.length === 0 ? (
              <View style={[styles.geozoneHint, { backgroundColor: theme.backgroundSecondary }]} testID="geozone-info-only-hint">
                <Feather name="info" size={14} color={theme.statusGo} />
                <ThemedText style={[styles.geozoneHintText, { color: theme.textSecondary }]}>
                  {touchedAssessment.info.length} Info-Zone{touchedAssessment.info.length === 1 ? "" : "n"} im Umkreis – keine Beschränkung.
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.geozoneHint, { backgroundColor: theme.backgroundSecondary }]}>
                <Feather name="clock" size={14} color={theme.textSecondary} />
                <ThemedText style={[styles.geozoneHintText, { color: theme.textSecondary }]}>
                  {touchedAssessment.inactive.length} zeitgesteuerte Zone{touchedAssessment.inactive.length === 1 ? "" : "n"} im Umkreis – derzeit inaktiv. Details im nächsten Schritt.
                </ThemedText>
              </View>
            )
          ) : null}
        </KeyboardAwareScrollViewCompat>

        <Button
          title={detectingCountry ? "Land wird erkannt..." : "Standort bestätigen"}
          onPress={handleContinue}
          disabled={!selectedLocation || detectingCountry}
          loading={detectingCountry}
          testID="button-confirm-location"
        />
      </View>
      </View>

      <Modal
        visible={restrictionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRestrictionModalVisible(false)}
      >
        <View style={[styles.modalOverlay, keyboardInset > 0 && { justifyContent: "flex-end", paddingBottom: keyboardInset + 8 }]}>
          <View style={[styles.modalCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={styles.modalTitle}>Einschränkungen am Standort?</ThemedText>
            <ThemedText style={[styles.modalText, { color: theme.textSecondary }]}>
              Bestehen laut offizieller Karte Einschränkungen oder Geozonen an deinem
              geplanten Standort?
            </ThemedText>

            <TextInput disableFullscreenUI
              style={[
                styles.modalInput,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary },
              ]}
              value={restrictionNoteDraft}
              onChangeText={setRestrictionNoteDraft}
              placeholder="Notiz (optional)"
              placeholderTextColor={theme.textTertiary}
              multiline
              testID="input-restriction-note"
            />

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.statusGo }]}
                onPress={() => handleRestrictionAnswer("approved")}
                activeOpacity={0.7}
                testID="button-restriction-no"
              >
                <Feather name="check" size={16} color="#FFFFFF" />
                <ThemedText style={styles.modalButtonText}>Nein</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.statusCaution }]}
                onPress={() => handleRestrictionAnswer("limited")}
                activeOpacity={0.7}
                testID="button-restriction-yes"
              >
                <Feather name="alert-triangle" size={16} color="#FFFFFF" />
                <ThemedText style={styles.modalButtonText}>Ja</ThemedText>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setRestrictionModalVisible(false)}
              activeOpacity={0.7}
              style={styles.modalCancel}
              testID="button-restriction-cancel"
            >
              <ThemedText style={[styles.modalCancelText, { color: theme.textSecondary }]}>
                Später entscheiden
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <InfoDialog
        visible={detailZone !== null}
        onClose={() => setDetailZone(null)}
        title={detailZone?.name ?? ""}
        okLabel="Schließen"
        okTestID="button-zone-detail-close"
        testID="zone-detail-dialog"
        sections={detailZone && detailHasContent ? [
          ...(detailParsed && detailParsed.otherLines.length > 0 ? [{
            weight: detailParsed.otherLines.join("\n").length,
            body: (
              <ThemedText style={[styles.geozoneDetailBody, { color: theme.textSecondary }]} testID="text-zone-detail-info">
                {detailParsed.otherLines.join("\n")}
              </ThemedText>
            ),
          }] : []),
          ...(detailZone.applicationText || (detailParsed && detailParsed.contacts.length > 0) || (detailZone.links && detailZone.links.length > 0) ? [{
            weight: (detailZone.applicationText?.length ?? 0) + 120,
            body: (
              <>
                {detailZone.applicationText ? (
                  <View style={[styles.zoneDetailNote, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
                    <ThemedText style={[styles.zoneDetailNoteText, { color: theme.textSecondary }]}>
                      {detailZone.applicationText}
                    </ThemedText>
                  </View>
                ) : null}
                {detailParsed && detailParsed.contacts.length > 0 ? (
                  <View style={styles.zoneDetailContacts}>
                    {detailParsed.contacts.map((c, ci) => (
                      <TouchableOpacity
                        key={`${c.type}-${c.value}-${ci}`}
                        style={[styles.zoneDetailContactRow, { borderColor: theme.border }]}
                        activeOpacity={0.7}
                        onPress={() => {
                          const url = c.type === "phone" ? `tel:${c.value.replace(/\s/g, "")}` : `mailto:${c.value}`;
                          openLink(url).catch(() => {});
                        }}
                        testID={`button-zone-contact-${ci}`}
                      >
                        <Feather name={c.type === "phone" ? "phone" : "mail"} size={15} color={theme.primary} />
                        <ThemedText style={[styles.zoneDetailContactText, { color: theme.primary }]} numberOfLines={1}>
                          {c.value}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                {detailZone.links && detailZone.links.length > 0 ? (
                  <View style={styles.zoneDetailContacts}>
                    {detailZone.links.map((l, li) => {
                      const isMail = l.url.startsWith("mailto:");
                      const isTel = l.url.startsWith("tel:");
                      return (
                        <TouchableOpacity
                          key={`${l.url}-${li}`}
                          style={[styles.zoneDetailContactRow, { borderColor: theme.border }]}
                          activeOpacity={0.7}
                          onPress={() => { openLink(l.url).catch(() => {}); }}
                          testID={`button-zone-link-${li}`}
                        >
                          <Feather name={isMail ? "mail" : isTel ? "phone" : "external-link"} size={15} color={theme.primary} />
                          <ThemedText style={[styles.zoneDetailContactText, { color: theme.primary }]} numberOfLines={1}>
                            {l.label}
                          </ThemedText>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ),
          }] : []),
        ] : []}
        intro={detailZone ? (
          <View style={[styles.touchedHeader, { marginBottom: Spacing.sm }]}>
            <Feather name="map-pin" size={16} color={theme.primary} />
            <View style={[styles.zoneDetailBadge, { backgroundColor: theme.primary }]}>
              <ThemedText style={styles.zoneDetailBadgeText} numberOfLines={1}>
                {detailZone.layerLabel}
              </ThemedText>
            </View>
          </View>
        ) : null}
      >
        {detailZone && !detailHasContent ? (
          <View style={styles.zoneDetailEmpty} testID="text-zone-detail-empty">
            <Feather name="info" size={18} color={theme.textTertiary} />
            <ThemedText style={[styles.zoneDetailEmptyText, { color: theme.textSecondary }]}>
              Für diese Zone sind keine weiteren Details hinterlegt. Prüfe die offizielle Karte im nächsten Schritt.
            </ThemedText>
          </View>
        ) : null}
      </InfoDialog>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  searchContainer: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 5,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    height: 48,
    borderRadius: BorderRadius.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...Typography.body,
    paddingVertical: 0,
  },
  searchDropdown: {
    marginTop: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  searchLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  searchLoadingText: {
    ...Typography.caption,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  resultText: {
    flex: 1,
  },
  resultName: {
    ...Typography.body,
    fontWeight: "600",
  },
  resultDetail: {
    ...Typography.caption,
    marginTop: 1,
  },
  resultSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: Spacing.md + 32 + Spacing.sm,
  },
  myLocationButton: {
    position: "absolute",
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  bottomSheet: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    maxHeight: "45%",
  },
  bottomSheetScroll: {
    flexGrow: 0,
    marginBottom: Spacing.md,
  },
  portraitBody: {
    flex: 1,
  },
  landscapeBody: {
    flex: 1,
    flexDirection: "row",
  },
  // Querformat: Suche links oben über der Karte, schmaler, damit rechts oben
  // die CTR-Legende frei bleibt.
  searchContainerLandscape: {
    right: undefined,
    width: "55%",
    maxWidth: 440,
  },
  // Querformat: rechtes Seiten-Panel (~1/3 Breite). Inhalt scrollt, der
  // Bestätigen-Button bleibt unten angeheftet. Feste Breite + flex-Spalte,
  // damit das Panel beim Einblenden der Tastatur (resize) nicht springt,
  // sondern nur der Scrollbereich kürzer wird.
  sidePanel: {
    width: "34%",
    minWidth: 280,
    maxWidth: 440,
    paddingLeft: Spacing.lg,
    paddingTop: Spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  sidePanelScroll: {
    flex: 1,
    marginBottom: Spacing.sm,
  },
  sidePanelScrollContent: {
    paddingBottom: Spacing.sm,
  },
  locationInfo: {
    marginBottom: Spacing.md,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  locationTitle: {
    ...Typography.body,
    fontWeight: "600",
    flex: 1,
  },
  coordinates: {
    ...Typography.small,
    marginLeft: 26,
  },
  radiusSection: {
    marginBottom: Spacing.md,
  },
  radiusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: Spacing.sm,
  },
  radiusLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  radiusValue: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 13,
    marginLeft: "auto",
  },
  sliderTrack: {
    height: 32,
    borderRadius: 3,
    backgroundColor: "transparent",
    position: "relative",
    justifyContent: "center",
  },
  sliderTrackBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(128,128,128,0.25)",
    top: 13,
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    height: 6,
    top: 13,
    borderRadius: 3,
  },
  sliderThumb: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    marginLeft: -11,
    top: 5,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  sliderLabelText: {
    ...Typography.caption,
    fontSize: 10,
  },
  sliderVlosMark: {
    position: "absolute",
    width: 2,
    height: 16,
    top: -2,
    marginLeft: -1,
    opacity: 0.55,
  },
  vlosInfoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  vlosInfoTitle: {
    ...Typography.small,
    fontWeight: "600",
    marginBottom: 2,
  },
  vlosInfoText: {
    ...Typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },
  geozoneHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  geozoneHintText: {
    ...Typography.small,
    flex: 1,
  },
  touchedBox: {
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: 6,
  },
  altitudeSection: {
    marginBottom: Spacing.md,
  },
  vlosCorrectionToggle: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
  },
  vlosCorrectionText: {
    flex: 1,
    gap: 2,
  },
  vlosCorrectionTitle: {
    ...Typography.small,
    fontWeight: "600",
  },
  vlosCorrectionDescription: {
    ...Typography.caption,
    fontSize: 11,
    lineHeight: 15,
  },
  altitudeChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  altitudeChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  altitudeChipText: {
    ...Typography.small,
  },
  altitudeCustomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  altitudeCustomLabel: {
    ...Typography.small,
  },
  altitudeInput: {
    width: 64,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    ...Typography.small,
    textAlign: "center",
  },
  altitudeUnit: {
    ...Typography.small,
  },
  touchedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 4,
  },
  touchedTitle: {
    ...Typography.caption,
    fontWeight: "700",
  },
  touchedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    paddingVertical: 4,
  },
  touchedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
  },
  touchedRowName: {
    ...Typography.small,
    fontWeight: "600",
  },
  touchedRowLayer: {
    ...Typography.small,
    fontSize: 11,
  },
  touchedMore: {
    ...Typography.small,
    fontStyle: "italic",
    marginTop: 4,
  },
  touchedHint: {
    ...Typography.small,
    fontStyle: "italic",
    marginTop: 6,
  },
  touchedChevron: {
    marginTop: 2,
  },
  touchedSubhead: {
    ...Typography.small,
    fontWeight: "600",
    marginTop: Spacing.sm,
    marginBottom: 2,
  },
  zoneDetailBadge: {
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 1,
  },
  zoneDetailBadgeText: {
    ...Typography.small,
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  geozoneDetailBody: {
    ...Typography.small,
    lineHeight: 19,
  },
  zoneDetailNote: {
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    padding: Spacing.md,
  },
  zoneDetailNoteText: {
    ...Typography.small,
    lineHeight: 18,
  },
  zoneDetailContacts: {
    gap: Spacing.sm,
  },
  zoneDetailContactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  zoneDetailContactText: {
    ...Typography.small,
    fontWeight: "600",
    flex: 1,
  },
  zoneDetailEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  zoneDetailEmptyText: {
    ...Typography.small,
    flex: 1,
    lineHeight: 18,
  },
  officialMapButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: BorderRadius.md,
  },
  officialMapButtonText: {
    ...Typography.body,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  manualAnswerBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: 6,
  },
  manualAnswerEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  manualAnswerEditText: {
    ...Typography.small,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  modalTitle: {
    ...Typography.h3,
    fontWeight: "700",
  },
  modalText: {
    ...Typography.body,
  },
  modalInput: {
    ...Typography.body,
    minHeight: 64,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    textAlignVertical: "top",
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  modalButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
  },
  modalButtonText: {
    ...Typography.body,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  modalCancel: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  modalCancelText: {
    ...Typography.small,
    fontWeight: "600",
  },
  webScrollView: {
    flex: 1,
  },
  webContent: {
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
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderWidth: 2,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  locationIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.lg,
  },
  locationCardContent: {
    flex: 1,
  },
  locationCardTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  locationCardSubtitle: {
    ...Typography.small,
    marginTop: 2,
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: Spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    ...Typography.small,
    marginHorizontal: Spacing.lg,
  },
  inputCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    ...Typography.body,
    fontWeight: "600",
    marginBottom: Spacing.lg,
  },
  inputRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  inputGroup: {
    flex: 1,
    marginBottom: Spacing.md,
  },
  inputHint: {
    ...Typography.caption,
    marginBottom: Spacing.xs,
  },
  input: {
    height: 48,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    ...Typography.body,
  },
  applyButton: {
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.sm,
  },
  applyButtonText: {
    ...Typography.body,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  selectedCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  selectedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  selectedTitle: {
    ...Typography.body,
    fontWeight: "600",
    flex: 1,
  },
  selectedCoords: {
    ...Typography.small,
    marginLeft: 26,
  },
  selectedRadiusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.md,
    marginLeft: 26,
  },
  selectedRadiusLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  selectedRadiusValue: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 13,
    marginLeft: "auto",
  },
  radiusPresetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginLeft: 26,
  },
  radiusPresetBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minWidth: 56,
    alignItems: "center",
  },
  radiusPresetLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  webHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  webHintText: {
    ...Typography.small,
    flex: 1,
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
});
