import React, { useState, useCallback } from "react";
import { DroneImage } from "@/components/DroneImage";
import { View, StyleSheet, FlatList, Pressable, useWindowDimensions } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { getDrones, DroneProfile, getComplianceStatus, getPilotProfile, PilotProfile } from "@/lib/storage";
import { loadLastKnownPosition, peekLastKnownPosition } from "@/lib/mapFallbackCenter";
import { getCountryMapConfig, detectCountryFromCoordinates } from "@/lib/countryMaps";
import { withTimeout } from "@/lib/fetchWithTimeout";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

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

  useFocusEffect(
    useCallback(() => {
      getDrones().then(setDrones);
      getPilotProfile().then(setPilotProfile);
    }, [])
  );

  const handleSelectDrone = async (drone: DroneProfile) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Kein Warten auf GPS/Netz mehr: Das maßgebliche Land ergibt sich aus dem
    // Ort, den der Pilot im nächsten Schritt wählt (Suche oder Karte). Hier nur
    // ein schneller Startpunkt für die Karte aus der zuletzt bekannten Position.
    let countryIso: string | null = null;
    try {
      const last = peekLastKnownPosition() ?? (await withTimeout(loadLastKnownPosition(), 1000, null));
      if (last) countryIso = detectCountryFromCoordinates(last.latitude, last.longitude);
    } catch {
      // egal – die Karte startet dann in Deutschland
    }
    navigation.navigate("PlanningLocation", {
      droneId: drone.id,
      ...(countryIso && getCountryMapConfig(countryIso) ? { countryIso } : {}),
    });
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
            paddingTop: headerHeight + Spacing.sm,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText style={styles.title}>Drohne auswählen</ThemedText>
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
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.h2,
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
