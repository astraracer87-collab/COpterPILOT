import React, { useState, useRef, useMemo, useCallback } from "react";
import { View, StyleSheet, TextInput, TouchableOpacity, Alert, Platform, Keyboard, ActivityIndicator, ScrollView, Pressable } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import MapPicker, { MapPickerRef } from "@/components/MapPicker";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";
import { getCountryCenter, getCountryMapConfig, reverseGeocodeCountry, detectCountryFromCoordinates } from "@/lib/countryMaps";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningLocation">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningLocation">;

interface WaypointEditorProps {
  theme: any;
  waypoints: { latitude: number; longitude: number }[];
  routeMode: boolean;
  hideRouteToggle?: boolean;
  onToggleRouteMode: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  waypointLat: string;
  waypointLng: string;
  onWaypointLatChange: (v: string) => void;
  onWaypointLngChange: (v: string) => void;
  onAddManualWaypoint: () => void;
  onClearRoute: () => void;
}

function WaypointEditor({
  theme,
  waypoints,
  routeMode,
  hideRouteToggle,
  onToggleRouteMode,
  onRemove,
  onMove,
  waypointLat,
  waypointLng,
  onWaypointLatChange,
  onWaypointLngChange,
  onAddManualWaypoint,
  onClearRoute,
}: WaypointEditorProps) {
  const hasRoute = waypoints.length >= 2;
  return (
    <View style={waypointStyles.container} testID="waypoint-editor">
      <View style={waypointStyles.headerRow}>
        <Feather name="git-branch" size={14} color={theme.textSecondary} />
        <ThemedText style={[waypointStyles.headerLabel, { color: theme.textSecondary }]}>
          Wegpunkte ({waypoints.length})
        </ThemedText>
        {hasRoute ? (
          <TouchableOpacity onPress={onClearRoute} testID="button-clear-route">
            <ThemedText style={[waypointStyles.linkText, { color: theme.statusDanger ?? "#FF3B30" }]}>
              Route löschen
            </ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>

      {!hideRouteToggle ? (
        <TouchableOpacity
          onPress={onToggleRouteMode}
          activeOpacity={0.7}
          style={[
            waypointStyles.modeButton,
            {
              backgroundColor: routeMode ? theme.primary : theme.backgroundSecondary,
              borderColor: theme.primary,
            },
          ]}
          testID="button-toggle-route-mode"
        >
          <Feather
            name={routeMode ? "check" : "plus"}
            size={16}
            color={routeMode ? "#FFFFFF" : theme.primary}
          />
          <ThemedText
            style={[
              waypointStyles.modeButtonText,
              { color: routeMode ? "#FFFFFF" : theme.primary },
            ]}
          >
            {routeMode ? "Langer Druck auf die Karte fügt Wegpunkt hinzu" : "Wegpunkt per langem Druck hinzufügen"}
          </ThemedText>
        </TouchableOpacity>
      ) : null}

      {waypoints.map((wp, idx) => {
        const isStart = idx === 0;
        const isEnd = idx === waypoints.length - 1 && waypoints.length > 1;
        const label = isStart ? "Start" : isEnd ? "Ziel" : `Punkt ${idx + 1}`;
        const dotColor = isStart
          ? "#34C759"
          : isEnd
          ? "#FF3B30"
          : theme.primary;
        return (
          <View
            key={`wp-row-${idx}-${wp.latitude}-${wp.longitude}`}
            style={[waypointStyles.row, { backgroundColor: theme.backgroundSecondary }]}
            testID={`waypoint-row-${idx}`}
          >
            <View style={[waypointStyles.dot, { backgroundColor: dotColor }]} />
            <View style={waypointStyles.rowText}>
              <ThemedText style={waypointStyles.rowLabel}>{label}</ThemedText>
              <ThemedText style={[waypointStyles.rowCoords, { color: theme.textSecondary }]}>
                {wp.latitude.toFixed(5)}, {wp.longitude.toFixed(5)}
              </ThemedText>
            </View>
            <View style={waypointStyles.rowActions}>
              <TouchableOpacity
                onPress={() => onMove(idx, -1)}
                disabled={idx === 0}
                style={waypointStyles.iconBtn}
                testID={`button-move-up-${idx}`}
              >
                <Feather
                  name="chevron-up"
                  size={18}
                  color={idx === 0 ? theme.textTertiary : theme.text}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onMove(idx, 1)}
                disabled={idx === waypoints.length - 1}
                style={waypointStyles.iconBtn}
                testID={`button-move-down-${idx}`}
              >
                <Feather
                  name="chevron-down"
                  size={18}
                  color={idx === waypoints.length - 1 ? theme.textTertiary : theme.text}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onRemove(idx)}
                style={waypointStyles.iconBtn}
                testID={`button-remove-waypoint-${idx}`}
              >
                <Feather name="trash-2" size={16} color={theme.statusDanger ?? "#FF3B30"} />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      <View style={waypointStyles.manualRow}>
        <TextInput
          style={[
            waypointStyles.manualInput,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={waypointLat}
          onChangeText={onWaypointLatChange}
          placeholder="Lat"
          placeholderTextColor={theme.textTertiary}
          keyboardType="numeric"
          testID="input-waypoint-lat"
        />
        <TextInput
          style={[
            waypointStyles.manualInput,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={waypointLng}
          onChangeText={onWaypointLngChange}
          placeholder="Lng"
          placeholderTextColor={theme.textTertiary}
          keyboardType="numeric"
          testID="input-waypoint-lng"
        />
        <TouchableOpacity
          onPress={onAddManualWaypoint}
          style={[waypointStyles.addBtn, { backgroundColor: theme.primary }]}
          testID="button-add-waypoint"
        >
          <Feather name="plus" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {waypoints.length < 2 ? (
        <ThemedText style={[waypointStyles.hintText, { color: theme.textTertiary }]}>
          Halte einen Punkt auf der Karte gedrückt oder gib Koordinaten ein, um weitere Wegpunkte hinzuzufügen. Eine Strecke wird ab 2 Punkten geprüft.
        </ThemedText>
      ) : null}
    </View>
  );
}

const waypointStyles = StyleSheet.create({
  container: {
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerLabel: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  linkText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  modeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  modeButtonText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  rowCoords: {
    ...Typography.caption,
    fontSize: 11,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  iconBtn: {
    padding: 6,
  },
  manualRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  manualInput: {
    flex: 1,
    height: 40,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    ...Typography.caption,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  hintText: {
    ...Typography.caption,
    fontSize: 11,
  },
});

export default function PlanningLocationScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const mapRef = useRef<MapPickerRef>(null);
  
  const [selectedLocation, setSelectedLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [locationName, setLocationName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [radiusM, setRadiusM] = useState(1000);
  const radiusKm = radiusM / 1000;
  const sliderRef = useRef<View>(null);
  const [extraWaypoints, setExtraWaypoints] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeMode, setRouteMode] = useState(false);
  const [waypointLat, setWaypointLat] = useState("");
  const [waypointLng, setWaypointLng] = useState("");

  const allWaypoints = useMemo(() => {
    if (!selectedLocation) return [];
    return [selectedLocation, ...extraWaypoints];
  }, [selectedLocation, extraWaypoints]);

  const hasRoute = allWaypoints.length >= 2;

  const { droneId, countryIso } = route.params;

  const countryCenter = useMemo(() => {
    return getCountryCenter(countryIso || "DE");
  }, [countryIso]);

  const countryName = useMemo(() => {
    const config = getCountryMapConfig(countryIso || "DE");
    return config?.nameDE || "Deutschland";
  }, [countryIso]);

  const radiusToDelta = (rKm: number) => {
    const delta = (rKm / 111.32) * 2.5;
    return Math.max(delta, 0.005);
  };

  const animateToLocation = (latitude: number, longitude: number) => {
    const delta = radiusToDelta(radiusKm);
    mapRef.current?.animateToRegion({
      latitude,
      longitude,
      latitudeDelta: delta,
      longitudeDelta: delta,
    }, 500);
  };

  const handleRadiusChange = (meters: number) => {
    const rKm = meters / 1000;
    setRadiusM(meters);
    if (selectedLocation) {
      const delta = radiusToDelta(rKm);
      mapRef.current?.animateToRegion({
        latitude: selectedLocation.latitude,
        longitude: selectedLocation.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      }, 400);
    }
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

  const handleMapPress = (latitude: number, longitude: number) => {
    if (routeMode && selectedLocation) {
      return;
    }
    setSelectedLocation({ latitude, longitude });
    reverseGeocode(latitude, longitude);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    animateToLocation(latitude, longitude);
  };

  const handleMapLongPress = (latitude: number, longitude: number) => {
    if (routeMode && selectedLocation) {
      setExtraWaypoints((prev) => [...prev, { latitude, longitude }]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      animateToLocation(latitude, longitude);
      return;
    }
    if (!selectedLocation) {
      setSelectedLocation({ latitude, longitude });
      reverseGeocode(latitude, longitude);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      animateToLocation(latitude, longitude);
    }
  };

  const handleAddWaypointFromInput = () => {
    const lat = parseFloat(waypointLat);
    const lng = parseFloat(waypointLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert("Fehler", "Bitte gib gültige Koordinaten für den Wegpunkt ein.");
      return;
    }
    if (!selectedLocation) {
      Alert.alert("Hinweis", "Bitte wähle zuerst einen Startpunkt.");
      return;
    }
    setExtraWaypoints((prev) => [...prev, { latitude: lat, longitude: lng }]);
    setWaypointLat("");
    setWaypointLng("");
    animateToLocation(lat, lng);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRemoveWaypoint = (index: number) => {
    if (index === 0) {
      if (extraWaypoints.length === 0) {
        setSelectedLocation(null);
        setLocationName("");
        return;
      }
      const [next, ...rest] = extraWaypoints;
      setSelectedLocation(next);
      setExtraWaypoints(rest);
      reverseGeocode(next.latitude, next.longitude);
      return;
    }
    setExtraWaypoints((prev) => prev.filter((_, i) => i !== index - 1));
  };

  const handleMoveWaypoint = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (index < 0 || target < 0 || target >= allWaypoints.length) return;
    const next = [...allWaypoints];
    [next[index], next[target]] = [next[target], next[index]];
    const [first, ...rest] = next;
    setSelectedLocation(first);
    setExtraWaypoints(rest);
    reverseGeocode(first.latitude, first.longitude);
  };

  const handleWaypointDragEnd = (index: number, latitude: number, longitude: number) => {
    if (index === 0) {
      setSelectedLocation({ latitude, longitude });
      reverseGeocode(latitude, longitude);
    } else {
      setExtraWaypoints((prev) =>
        prev.map((wp, i) => (i === index - 1 ? { latitude, longitude } : wp))
      );
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleClearRoute = () => {
    setExtraWaypoints([]);
    setRouteMode(false);
  };


  const handleGetCurrentLocation = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Standort", "Bitte erlaube den Zugriff auf deinen Standort in den Einstellungen.");
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = location.coords;
      setSelectedLocation({ latitude, longitude });
      animateToLocation(latitude, longitude);
      await reverseGeocode(latitude, longitude);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert("Fehler", "Standort konnte nicht ermittelt werden.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    Keyboard.dismiss();
    setSearchLoading(true);
    
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length > 0) {
        const { latitude, longitude } = results[0];
        setSelectedLocation({ latitude, longitude });
        setLocationName(searchQuery);
        animateToLocation(latitude, longitude);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Nicht gefunden", "Der Ort konnte nicht gefunden werden. Bitte versuche es mit einer anderen Suche.");
      }
    } catch (error) {
      Alert.alert("Fehler", "Die Suche konnte nicht durchgeführt werden.");
    } finally {
      setSearchLoading(false);
    }
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

  const handleContinue = async () => {
    if (!selectedLocation) {
      Alert.alert("Fehler", "Bitte wähle einen Standort aus.");
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
    
    navigation.navigate("PlanningDateTime", {
      droneId,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
      locationName: locationName || undefined,
      countryIso: finalCountryIso,
      radiusKm,
      routeWaypoints: hasRoute ? allWaypoints : undefined,
    });
  };

  if (Platform.OS === "web") {
    return (
      <ThemedView style={styles.container}>
        <ScrollView 
          style={styles.webScrollView}
          contentContainerStyle={[styles.webContent, { paddingTop: headerHeight + Spacing.lg, paddingBottom: 120 }]}
        >
          <View style={styles.header}>
            <ThemedText style={styles.title}>Wo möchtest du fliegen?</ThemedText>
            <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
              Gib den geplanten Flugort an
            </ThemedText>
          </View>

          <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="search" size={20} color={theme.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Ort oder Adresse suchen..."
              placeholderTextColor={theme.textTertiary}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {searchLoading ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : searchQuery.length > 0 ? (
              <TouchableOpacity onPress={handleSearch} activeOpacity={0.7}>
                <Feather name="arrow-right" size={20} color={theme.primary} />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity onPress={handleGetCurrentLocation} disabled={loading} activeOpacity={0.7}>
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
                <TextInput
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
                <TextInput
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
            </Card>
          ) : null}

          {selectedLocation ? (
            <Card style={styles.selectedCard}>
              <WaypointEditor
                theme={theme}
                waypoints={allWaypoints}
                routeMode={false}
                onToggleRouteMode={() => {}}
                hideRouteToggle
                onRemove={handleRemoveWaypoint}
                onMove={handleMoveWaypoint}
                waypointLat={waypointLat}
                waypointLng={waypointLng}
                onWaypointLatChange={setWaypointLat}
                onWaypointLngChange={setWaypointLng}
                onAddManualWaypoint={handleAddWaypointFromInput}
                onClearRoute={handleClearRoute}
              />
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
          />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.mapContainer, { marginTop: headerHeight }]}>
        <MapPicker
          ref={mapRef}
          initialRegion={countryCenter}
          selectedLocation={selectedLocation}
          locationName={locationName}
          onMapPress={handleMapPress}
          onMapLongPress={handleMapLongPress}
          radiusMeters={selectedLocation && !hasRoute ? radiusKm * 1000 : undefined}
          routeWaypoints={hasRoute ? allWaypoints : undefined}
          onWaypointDragEnd={handleWaypointDragEnd}
        />

        <View style={[styles.searchContainer, { top: Spacing.lg }]}>
          <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="search" size={20} color={theme.textTertiary} />
            <TextInput
              style={[styles.searchInput, { color: theme.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Ort oder Adresse suchen..."
              placeholderTextColor={theme.textTertiary}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {searchLoading ? (
              <ActivityIndicator size="small" color={theme.primary} />
            ) : searchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setSearchQuery("")} activeOpacity={0.7}>
                <Feather name="x" size={20} color={theme.textTertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.myLocationButton, { backgroundColor: theme.backgroundDefault }]}
          onPress={handleGetCurrentLocation}
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

      <View style={[styles.bottomSheet, { backgroundColor: theme.backgroundDefault, paddingBottom: insets.bottom + Spacing.lg }]}>
        <ScrollView style={styles.bottomSheetScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
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
            <WaypointEditor
              theme={theme}
              waypoints={allWaypoints}
              routeMode={routeMode}
              onToggleRouteMode={() => setRouteMode((v) => !v)}
              onRemove={handleRemoveWaypoint}
              onMove={handleMoveWaypoint}
              waypointLat={waypointLat}
              waypointLng={waypointLng}
              onWaypointLatChange={setWaypointLat}
              onWaypointLngChange={setWaypointLng}
              onAddManualWaypoint={handleAddWaypointFromInput}
              onClearRoute={handleClearRoute}
            />
          ) : null}

          {selectedLocation && !hasRoute ? (
            <View style={styles.radiusSection}>
              <View style={styles.radiusHeader}>
                <Feather name="circle" size={14} color={theme.textSecondary} />
                <ThemedText style={[styles.radiusLabel, { color: theme.textSecondary }]}>Umkreis</ThemedText>
                <ThemedText style={[styles.radiusValue, { color: theme.primary }]}>
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
                    const meters = Math.round(pos * 3000 / 100) * 100;
                    handleRadiusChange(Math.max(100, meters));
                  });
                }}
                onResponderMove={(e) => {
                  sliderRef.current?.measure((_fx, _fy, width, _h, pageX) => {
                    const pos = Math.max(0, Math.min(1, (e.nativeEvent.pageX - pageX) / width));
                    const meters = Math.round(pos * 3000 / 100) * 100;
                    handleRadiusChange(Math.max(100, meters));
                  });
                }}
              >
                <View style={[styles.sliderTrackBg, { backgroundColor: theme.backgroundSecondary }]} />
                <View style={[styles.sliderFill, { width: `${(radiusM / 3000) * 100}%`, backgroundColor: theme.primary }]} />
                <View style={[styles.sliderThumb, { left: `${(radiusM / 3000) * 100}%`, backgroundColor: theme.primary, borderColor: theme.backgroundDefault }]} />
              </View>
              <View style={styles.sliderLabels}>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>0</ThemedText>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>500m</ThemedText>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>1km</ThemedText>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>1.5</ThemedText>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>2km</ThemedText>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>2.5</ThemedText>
                <ThemedText style={[styles.sliderLabelText, { color: theme.textSecondary }]}>3km</ThemedText>
              </View>
            </View>
          ) : null}

          {selectedLocation ? (
            <View style={[styles.geozoneHint, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="layers" size={14} color={theme.primary} />
              <ThemedText style={[styles.geozoneHintText, { color: theme.textSecondary }]}>
                Geozonen werden auf der Karte angezeigt. Passe Standort und Umkreis an, um Einschränkungen zu sehen.
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>
        
        <Button
          title={detectingCountry ? "Land wird erkannt..." : "Standort bestätigen"}
          onPress={handleContinue}
          disabled={!selectedLocation || detectingCountry}
          loading={detectingCountry}
        />
      </View>
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
    zIndex: 1,
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
