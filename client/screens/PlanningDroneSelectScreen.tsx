import React, { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "@/lib/noHaptics";
import * as Location from "@/lib/location";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { getDrones, DroneProfile, getComplianceStatus, getPilotProfile, PilotProfile } from "@/lib/storage";
import { getCountryMapConfig, detectCountryFromCoordinates, reverseGeocodeCountry } from "@/lib/countryMaps";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

const ISO_ALIASES: Record<string, string> = {
  UK: "GB",
  EL: "GR",
};

function normalizeCountryCode(code: string | undefined | null): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  return ISO_ALIASES[normalized] || normalized;
}

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningDroneSelect">;

export default function PlanningDroneSelectScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [pilotProfile, setPilotProfile] = useState<PilotProfile | null>(null);
  const [detectingCountry, setDetectingCountry] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getDrones().then(setDrones);
      getPilotProfile().then(setPilotProfile);
    }, [])
  );

  const handleSelectDrone = async (drone: DroneProfile) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetectingCountry(true);
    
    let detectedCountryIso: string | null = null;
    let latitude = 52.52;
    let longitude = 13.405;
    
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }
    } catch (error) {
    }
    
    detectedCountryIso = await reverseGeocodeCountry(latitude, longitude);
    
    if (!detectedCountryIso) {
      detectedCountryIso = detectCountryFromCoordinates(latitude, longitude);
    }
    
    setDetectingCountry(false);
    
    const countryConfig = detectedCountryIso ? getCountryMapConfig(detectedCountryIso) : null;
    
    if (countryConfig) {
      navigation.navigate("PlanningLocation", { droneId: drone.id, countryIso: detectedCountryIso! });
    } else {
      navigation.navigate("PlanningCountrySelect", { droneId: drone.id });
    }
  };

  const getStatusColor = (status: "green" | "yellow" | "red") => {
    switch (status) {
      case "green": return theme.statusGo;
      case "yellow": return theme.statusCaution;
      case "red": return theme.statusNoGo;
    }
  };

  const renderItem = useCallback(
    ({ item, index }: { item: DroneProfile; index: number }) => {
      const status = getComplianceStatus(item, pilotProfile || undefined);
      return (
        <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
          <Pressable
            onPress={() => handleSelectDrone(item)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card style={styles.card}>
              <View style={[styles.droneIconContainer, { backgroundColor: theme.backgroundSecondary }]}>
                <MaterialCommunityIcons name="quadcopter" size={24} color={theme.primary} />
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
              </View>
              <View style={styles.droneInfo}>
                <ThemedText style={styles.droneName}>{item.name}</ThemedText>
                <View style={styles.droneDetails}>
                  <View style={[styles.classBadge, { backgroundColor: theme.backgroundSecondary }]}>
                    <ThemedText style={[styles.classText, { color: theme.primary }]}>
                      {item.classMark}
                    </ThemedText>
                  </View>
                  {item.manufacturer && item.model ? (
                    <ThemedText style={[styles.modelText, { color: theme.textSecondary }]}>
                      {item.manufacturer} {item.model}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
              <View style={styles.rightContent}>
                <Feather name="chevron-right" size={20} color={theme.textTertiary} />
              </View>
            </Card>
          </Pressable>
        </Animated.View>
      );
    },
    [navigation, theme]
  );

  if (detectingCountry) {
    return (
      <ThemedView style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <ThemedText style={[styles.loadingText, { color: theme.textSecondary }]}>
          Land wird ermittelt...
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
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText style={styles.title}>Drohne auswählen</ThemedText>
            <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
              Wähle die Drohne für deinen geplanten Flug
            </ThemedText>
          </View>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.body,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  header: {
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.h2,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.body,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
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
  droneInfo: {
    flex: 1,
  },
  droneName: {
    ...Typography.body,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  droneDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  classBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  classText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  modelText: {
    ...Typography.small,
  },
  rightContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
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
  pressed: {
    opacity: 0.7,
  },
});
