import React, { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Alert, Platform, Linking, ActivityIndicator } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getDrones, DroneProfile, setSelectedDroneId, getComplianceStatus, getSettings, getPilotProfile, PilotProfile, Settings } from "@/lib/storage";
import { getCountryMapConfig, detectCountryFromCoordinates, reverseGeocodeCountry } from "@/lib/countryMaps";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const ISO_ALIASES: Record<string, string> = {
  UK: "GB",
  EL: "GR",
};

function normalizeCountryCode(code: string | undefined | null): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  return ISO_ALIASES[normalized] || normalized;
}

type NavigationProp = NativeStackNavigationProp<FlightCheckParamList>;

export default function DroneSelectScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pilot, setPilot] = useState<PilotProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDrones = useCallback(async () => {
    try {
      const [data, loadedSettings, pilotProfile] = await Promise.all([getDrones(), getSettings(), getPilotProfile()]);
      setDrones(data);
      setSettings(loadedSettings);
      setPilot(pilotProfile);
    } catch (error) {
      console.error("Failed to load drones:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDrones();
    }, [loadDrones])
  );

  const [gettingLocation, setGettingLocation] = useState(false);

  const handleSelectDrone = async (drone: DroneProfile) => {
    const status = getComplianceStatus(drone, pilot || undefined);
    if (status === "red") {
      Alert.alert(
        "Compliance unvollständig",
        "Diese Drohne erfüllt nicht die kritischen EU-Anforderungen (Registrierung, Kennzeichnung, Versicherung). Bitte zuerst vervollständigen.",
        [{ text: "OK" }]
      );
      return;
    }
    
    await setSelectedDroneId(drone.id);
    
    setGettingLocation(true);
    
    // Default location (Berlin) as fallback
    let latitude = 52.52;
    let longitude = 13.405;
    
    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus === "granted") {
        try {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          latitude = location.coords.latitude;
          longitude = location.coords.longitude;
        } catch (locError) {
        }
      }
    } catch (error) {
    }
    
    let detectedCountryIso = await reverseGeocodeCountry(latitude, longitude);
    
    if (!detectedCountryIso) {
      detectedCountryIso = detectCountryFromCoordinates(latitude, longitude);
    }
    
    setGettingLocation(false);
    
    const countryConfig = detectedCountryIso ? getCountryMapConfig(detectedCountryIso) : null;
    
    if (countryConfig) {
      navigation.navigate("Map", {
        latitude,
        longitude,
        droneId: drone.id,
        countryIso: detectedCountryIso!,
      });
    } else {
      navigation.navigate("CountrySelect", {
        droneId: drone.id,
        latitude,
        longitude,
      });
    }
  };

  const getStatusColor = (status: "green" | "yellow" | "red") => {
    switch (status) {
      case "green": return theme.statusGo;
      case "yellow": return theme.statusCaution;
      case "red": return theme.statusNoGo;
    }
  };

  const getClassLabel = (classMark: string) => {
    if (classMark === "legacy") return "Ohne Klasse";
    return `Klasse ${classMark}`;
  };

  const renderItem = ({ item, index }: { item: DroneProfile; index: number }) => {
    const status = getComplianceStatus(item, pilot || undefined);
    const statusColor = getStatusColor(status);
    
    return (
      <Animated.View entering={FadeInDown.delay(index * 50)}>
        <Card style={styles.droneCard} onPress={() => handleSelectDrone(item)}>
          <View style={styles.droneHeader}>
            <View style={[styles.droneIconContainer, { backgroundColor: theme.backgroundSecondary }]}>
              <MaterialCommunityIcons name="quadcopter" size={24} color={theme.primary} />
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            </View>
            <View style={styles.droneInfo}>
              <ThemedText style={styles.droneName}>{item.name}</ThemedText>
              {item.manufacturer && item.model ? (
                <ThemedText style={[styles.droneModel, { color: theme.textSecondary }]}>
                  {item.manufacturer} {item.model}
                </ThemedText>
              ) : null}
            </View>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </View>
          <View style={styles.droneDetails}>
            <View style={[styles.tag, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={[styles.tagText, { color: theme.primary }]}>
                {getClassLabel(item.classMark)}
              </ThemedText>
            </View>
            <View style={[styles.tag, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={[styles.tagText, { color: theme.textSecondary }]}>
                {item.mtomGrams}g MTOM
              </ThemedText>
            </View>
            <View style={[styles.tag, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={[styles.tagText, { color: theme.textSecondary }]}>
                Max {settings?.windUnit === "km/h" 
                  ? `${(item.limits.maxWind * 3.6).toFixed(1)} km/h`
                  : `${item.limits.maxWind} m/s`}
              </ThemedText>
            </View>
          </View>
          {status === "yellow" ? (
            <View style={[styles.warningBanner, { backgroundColor: theme.statusCautionBackground }]}>
              <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
              <ThemedText style={[styles.warningText, { color: theme.statusCaution }]}>
                Einige Compliance-Punkte offen
              </ThemedText>
            </View>
          ) : null}
        </Card>
      </Animated.View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <MaterialCommunityIcons name="quadcopter" size={64} color={theme.textTertiary} />
      <ThemedText style={[styles.emptyTitle, { marginTop: Spacing.xl }]}>
        Keine Drohnen
      </ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Lege zuerst eine Drohne an, um einen Pre-Flight Check zu starten.
      </ThemedText>
    </View>
  );

  if (loading || gettingLocation) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
          {gettingLocation ? "Standort wird ermittelt..." : "Laden..."}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={drones}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
          },
          drones.length === 0 && styles.emptyList,
        ]}
        ListEmptyComponent={renderEmpty}
        ListHeaderComponent={
          drones.length > 0 ? (
            <ThemedText style={[styles.headerText, { color: theme.textSecondary }]}>
              Wähle die Drohne für diesen Flug:
            </ThemedText>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
  },
  headerText: {
    ...Typography.body,
    marginBottom: Spacing.sm,
  },
  droneCard: {
    padding: Spacing.lg,
  },
  droneHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  droneIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
    position: "relative",
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    position: "absolute",
    bottom: -2,
    right: -2,
    borderWidth: 2,
    borderColor: "#1A1A2E",
  },
  droneInfo: {
    flex: 1,
  },
  droneName: {
    ...Typography.body,
    fontWeight: "600",
  },
  droneModel: {
    ...Typography.small,
    marginTop: 2,
  },
  droneDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    marginLeft: Spacing.lg + Spacing.md,
  },
  tag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  tagText: {
    ...Typography.caption,
    fontWeight: "500",
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    marginLeft: Spacing.lg + Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    alignSelf: "flex-start",
  },
  warningText: {
    ...Typography.caption,
    fontWeight: "500",
  },
  emptyContainer: {
    alignItems: "center",
    padding: Spacing["3xl"],
  },
  emptyTitle: {
    ...Typography.h3,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    ...Typography.body,
    marginTop: Spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
});
