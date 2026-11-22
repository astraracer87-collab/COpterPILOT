import React, { useState, useCallback } from "react";
import { DroneImage } from "@/components/DroneImage";
import { View, StyleSheet, FlatList, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
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
import { withTimeout } from "@/lib/fetchWithTimeout";
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
  const { width } = useWindowDimensions();
  // Große Kacheln: 3 nebeneinander im Querformat, 2 auf schmalen Geräten
  const numColumns = width >= 720 ? 3 : 2;
  const tileWidth = (width - Spacing.lg * 2 - Spacing.md * (numColumns - 1)) / numColumns;
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
        // GPS-Kaltstart kann lange dauern → max. 8 s warten, dann letzte
        // bekannte Position (max. 3 s) bzw. Standard (Berlin).
        const location =
          (await withTimeout(
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
            8000,
            null,
          )) ??
          (await withTimeout(Location.getLastKnownPositionAsync().catch(() => null), 3000, null));
        if (location) {
          latitude = location.coords.latitude;
          longitude = location.coords.longitude;
        }
      }
    } catch (error) {
    }
    
    // Offline-first: lokale Ländererkennung sofort; Netz (mit Timeout) nur,
    // wenn sie nichts liefert.
    detectedCountryIso = detectCountryFromCoordinates(latitude, longitude);
    if (!detectedCountryIso) {
      detectedCountryIso = await reverseGeocodeCountry(latitude, longitude);
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
        <Animated.View entering={FadeInDown.delay(Math.min(index, 4) * 25).duration(180)} style={{ width: tileWidth }}>
          <Pressable
            onPress={() => handleSelectDrone(item)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Card style={styles.tile}>
              <View style={[styles.tileImageWrap, { backgroundColor: theme.backgroundSecondary }]}>
                <DroneImage manufacturer={item.manufacturer} model={item.model} size={Math.min(165, tileWidth - 24)} iconColor={theme.primary} iconSize={56} />
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
              </View>
              <ThemedText style={styles.tileName} numberOfLines={2}>{item.name}</ThemedText>
              <View style={[styles.classBadge, { backgroundColor: theme.backgroundSecondary, marginTop: Spacing.xs }]}>
                <ThemedText style={[styles.classText, { color: theme.primary }]}>{item.classMark}</ThemedText>
              </View>
            </Card>
          </Pressable>
        </Animated.View>
      );
    },
    [navigation, theme, pilotProfile, tileWidth]
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
        key={`cols-${numColumns}`}
        numColumns={numColumns}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        columnWrapperStyle={{ gap: Spacing.md }}
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
  // Kachel-Statuspunkt sitzt oben rechts im Bild

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
  tile: {
    alignItems: "center",
    padding: Spacing.md,
  },
  tileImageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    marginBottom: Spacing.sm,
  },
  tileName: {
    ...Typography.body,
    fontWeight: "700",
    textAlign: "center",
  },
  droneIconContainer: {
    width: 56,
    height: 56,
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
    width: 16,
    height: 16,
    borderRadius: 8,
    position: "absolute",
    top: 8,
    right: 8,
    borderWidth: 2,
    borderColor: "#1A1A2E",
  },
  pressed: {
    opacity: 0.7,
  },
});
