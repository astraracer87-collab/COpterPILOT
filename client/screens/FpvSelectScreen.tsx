import React from "react";
import { View, StyleSheet, Text } from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Colors, Spacing, Typography } from "@/constants/theme";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";

type RouteProps = RouteProp<FlightCheckParamList, "FpvSelect">;
type NavigationProps = NativeStackNavigationProp<FlightCheckParamList, "FpvSelect">;

export default function FpvSelectScreen() {
  const navigation = useNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, weatherData, droneId, limits, sessionId, kpIndex } = route.params;

  const handleSelect = (isFpv: boolean) => {
    navigation.navigate("Checklist", {
      latitude,
      longitude,
      hasRestrictions,
      restrictionStatus,
      restrictionNotes,
      weatherData,
      droneId,
      limits,
      sessionId,
      isFpvFlight: isFpv,
      kpIndex,
    });
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.content, { paddingTop: headerHeight + Spacing.xl }]}>
        <View style={styles.iconContainer}>
          <View style={styles.iconCircle}>
            <Feather name="eye" size={48} color={Colors.light.primary} />
          </View>
        </View>

        <ThemedText style={styles.title}>Flugmodus wählen</ThemedText>
        <ThemedText style={styles.subtitle}>
          Wie wirst du diese Drohne heute fliegen?
        </ThemedText>

        <View style={styles.optionsContainer}>
          <Card style={styles.optionCard}>
            <View style={styles.optionHeader}>
              <View style={[styles.optionIcon, { backgroundColor: Colors.light.statusCaution + "20" }]}>
                <Feather name="eye-off" size={28} color={Colors.light.statusCaution} />
              </View>
              <ThemedText style={styles.optionTitle}>FPV-Flug</ThemedText>
            </View>
            <ThemedText style={styles.optionDescription}>
              First Person View mit Videobrille. Ein Spotter wird für die Sichtprüfung benötigt.
            </ThemedText>
            <Button
              title="FPV"
              onPress={() => handleSelect(true)}
              style={styles.optionButton}
            />
          </Card>

          <Card style={styles.optionCard}>
            <View style={styles.optionHeader}>
              <View style={[styles.optionIcon, { backgroundColor: Colors.light.statusGo + "20" }]}>
                <Feather name="eye" size={28} color={Colors.light.statusGo} />
              </View>
              <ThemedText style={styles.optionTitle}>Normal</ThemedText>
            </View>
            <ThemedText style={styles.optionDescription}>
              Line of Sight Flug mit direkter Sicht auf die Drohne. Kein Spotter erforderlich.
            </ThemedText>
            <Button
              title="Normal"
              onPress={() => handleSelect(false)}
              variant="secondary"
              style={styles.optionButton}
            />
          </Card>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.infoRow}>
          <Feather name="info" size={16} color={Colors.light.textSecondary} />
          <Text style={styles.infoText}>
            Bei FPV-Flügen werden zusätzliche Spotter-Checkpunkte angezeigt
          </Text>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.light.primary + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...Typography.h2,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  optionsContainer: {
    gap: Spacing.lg,
  },
  optionCard: {
    padding: Spacing.lg,
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  optionTitle: {
    ...Typography.h4,
  },
  optionDescription: {
    ...Typography.body,
    color: Colors.light.textSecondary,
    marginBottom: Spacing.lg,
  },
  optionButton: {
    marginTop: Spacing.xs,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    justifyContent: "center",
  },
  infoText: {
    ...Typography.small,
    color: Colors.light.textSecondary,
    flex: 1,
  },
});
