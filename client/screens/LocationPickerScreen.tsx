import React, { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import NativeMapPicker from "@/components/NativeMapPicker";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Shadows, Typography } from "@/constants/theme";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import {
  detectCountryFromCoordinates,
  getCountryMapConfig,
} from "@/lib/countryMaps";
import { fetchElevation } from "@/lib/elevation";

type RouteParams = RouteProp<FlightCheckParamList, "LocationPicker">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "LocationPicker">;

function WebFallback({
  latitude,
  longitude,
  detectedCountry,
  onConfirm,
  headerHeight,
}: {
  latitude: number;
  longitude: number;
  detectedCountry: string;
  onConfirm: () => void;
  headerHeight: number;
}) {
  const { theme } = useTheme();
  
  return (
    <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
      <View style={styles.webFallback}>
        <ThemedText style={styles.webFallbackTitle}>Standort wählen</ThemedText>
        <ThemedText style={[styles.webFallbackText, { color: theme.textSecondary }]}>
          Die Kartenauswahl ist in Expo Go auf dem Gerät verfügbar.
        </ThemedText>
        <ThemedText style={[styles.coordsText, { color: theme.primary }]}>
          {detectedCountry}
        </ThemedText>
        <ThemedText style={[styles.webFallbackText, { color: theme.textSecondary }]}>
          Standort: {latitude.toFixed(4)}, {longitude.toFixed(4)}
        </ThemedText>
        <Button
          title="Weiter mit aktuellem Standort"
          onPress={onConfirm}
          style={{ marginTop: Spacing.xl }}
        />
      </View>
    </ThemedView>
  );
}

export default function LocationPickerScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const { latitude: initialLat, longitude: initialLon, droneId, sessionId, countryIso: routeCountryIso } = route.params;

  const [markerCoords, setMarkerCoords] = useState({
    latitude: initialLat,
    longitude: initialLon,
  });
  const [detectedCountry, setDetectedCountry] = useState<string>("");
  const [detectedCountryIso, setDetectedCountryIso] = useState<string>(routeCountryIso || "");
  const [pilotElevation, setPilotElevation] = useState<number | null>(null);

  useEffect(() => {
    if (routeCountryIso) {
      const config = getCountryMapConfig(routeCountryIso);
      if (config) {
        setDetectedCountry(config.nameDE);
        setDetectedCountryIso(routeCountryIso);
      }
    }
  }, [routeCountryIso]);

  const updateCountryDetection = useCallback(async (lat: number, lon: number) => {
    const offlineIso = detectCountryFromCoordinates(lat, lon);
    if (offlineIso) {
      const config = getCountryMapConfig(offlineIso);
      setDetectedCountry(config?.nameDE || offlineIso);
      setDetectedCountryIso(offlineIso);
    }
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=3&addressdetails=1`,
        { headers: { "User-Agent": "DronePreflightApp/1.0" } }
      );
      if (response.ok) {
        const data = await response.json();
        const rawCode = data.address?.country_code?.toUpperCase();
        // Nominatim liefert "gb"; "UK"/"EL" (EU-Schreibweisen) auf ISO normalisieren.
        const countryCode = rawCode === "UK" ? "GB" : rawCode === "EL" ? "GR" : rawCode;
        if (countryCode) {
          setDetectedCountryIso(countryCode);
          const config = getCountryMapConfig(countryCode);
          if (config) {
            setDetectedCountry(config.nameDE);
          } else {
            setDetectedCountry(data.address?.country || "Unbekanntes Land");
          }
        }
      }
    } catch (error) {
      if (!offlineIso) {
        setDetectedCountry("Unbekanntes Land");
        setDetectedCountryIso("");
      }
    }
  }, []);

  useEffect(() => {
    updateCountryDetection(initialLat, initialLon);
  }, [initialLat, initialLon, updateCountryDetection]);

  const updateElevation = useCallback(async (lat: number, lon: number) => {
    setPilotElevation(null);
    try {
      const elev = await fetchElevation(lat, lon);
      setPilotElevation(elev);
    } catch {
      setPilotElevation(null);
    }
  }, []);

  useEffect(() => {
    updateElevation(initialLat, initialLon);
  }, [initialLat, initialLon, updateElevation]);

  const handleMarkerDragEnd = (lat: number, lon: number) => {
    setMarkerCoords({ latitude: lat, longitude: lon });
    updateCountryDetection(lat, lon);
    updateElevation(lat, lon);
  };

  const handleMapPress = (lat: number, lon: number) => {
    setMarkerCoords({ latitude: lat, longitude: lon });
    updateCountryDetection(lat, lon);
    updateElevation(lat, lon);
  };

  const handleConfirm = () => {
    navigation.navigate("Map", {
      latitude: markerCoords.latitude,
      longitude: markerCoords.longitude,
      droneId,
      sessionId,
      countryIso: routeCountryIso || detectedCountryIso || "DE",
      ...(pilotElevation != null ? { pilotElevation } : {}),
    });
  };

  if (Platform.OS === "web") {
    return (
      <WebFallback
        latitude={markerCoords.latitude}
        longitude={markerCoords.longitude}
        detectedCountry={detectedCountry}
        onConfirm={handleConfirm}
        headerHeight={headerHeight}
      />
    );
  }

  return (
    <ThemedView style={styles.container}>
      <NativeMapPicker
        initialLatitude={initialLat}
        initialLongitude={initialLon}
        markerLatitude={markerCoords.latitude}
        markerLongitude={markerCoords.longitude}
        onMarkerDragEnd={handleMarkerDragEnd}
        onMapPress={handleMapPress}
        marginTop={headerHeight}
      />

      <View style={[styles.infoPanel, { backgroundColor: theme.backgroundDefault, top: headerHeight + Spacing.md }]}>
        <ThemedText style={[styles.countryLabel, { color: theme.textSecondary }]}>
          Erkanntes Land:
        </ThemedText>
        <ThemedText style={[styles.countryName, { color: theme.primary }]}>
          {detectedCountry || "Wird ermittelt..."}
        </ThemedText>
        <ThemedText style={[styles.coordsSmall, { color: theme.textSecondary }]}>
          {markerCoords.latitude.toFixed(5)}, {markerCoords.longitude.toFixed(5)}
        </ThemedText>
        {pilotElevation != null ? (
          <ThemedText style={[styles.coordsSmall, { color: theme.primary, marginTop: Spacing.xs }]}>
            ▲ Geländehöhe: {Math.round(pilotElevation)} m MSL
          </ThemedText>
        ) : null}
      </View>

      <View style={[styles.fabContainer, { bottom: insets.bottom + Spacing.xl }]}>
        <Button
          title="Standort bestätigen"
          onPress={handleConfirm}
          style={[styles.confirmButton, Shadows.fab]}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoPanel: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    padding: Spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  countryLabel: {
    ...Typography.small,
  },
  countryName: {
    ...Typography.h3,
    marginTop: Spacing.xs,
  },
  coordsSmall: {
    ...Typography.small,
    marginTop: Spacing.xs,
  },
  fabContainer: {
    position: "absolute",
    left: Spacing.xl,
    right: Spacing.xl,
  },
  confirmButton: {
    width: "100%",
  },
  webFallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  webFallbackTitle: {
    fontSize: 24,
    fontWeight: "600",
    marginBottom: Spacing.md,
  },
  webFallbackText: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  coordsText: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
});
