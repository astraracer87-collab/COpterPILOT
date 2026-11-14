import React, { useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, Text } from "react-native";
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
import { getPilotProfile } from "@/lib/storage";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";

type RouteProps = RouteProp<FlightCheckParamList, "FpvSelect">;
type NavigationProps = NativeStackNavigationProp<FlightCheckParamList, "FpvSelect">;

export default function FpvSelectScreen() {
  const navigation = useNavigation<NavigationProps>();
  const route = useRoute<RouteProps>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [hasVerbandsregel, setHasVerbandsregel] = useState(false);

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, weatherData, droneId, limits, sessionId, kpIndex } = route.params;

  useEffect(() => {
    getPilotProfile().then((p) => setHasVerbandsregel(p.insuranceVerbandsregelDE === true));
  }, []);

  const handleSelect = (isFpv: boolean, fpvMode?: "spotter" | "verband30m") => {
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
      fpvMode: isFpv ? (fpvMode ?? "spotter") : undefined,
      kpIndex,
    });
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
        ]}
      >
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
              <ThemedText style={styles.optionTitle}>FPV mit Spotter</ThemedText>
            </View>
            <ThemedText style={styles.optionDescription}>
              Standard-FPV nach EU-Open-Kategorie: Videobrille + zweiter Luftraum­beobachter (Spotter) Pflicht. Bis 120 m AGL erlaubt.
            </ThemedText>
            <Button
              title="FPV mit Spotter"
              onPress={() => handleSelect(true, "spotter")}
              style={styles.optionButton}
              testID="button-fpv-spotter"
            />
          </Card>

          {hasVerbandsregel ? (
            <Card style={styles.optionCard}>
              <View style={styles.optionHeader}>
                <View style={[styles.optionIcon, { backgroundColor: Colors.light.primary + "20" }]}>
                  <Feather name="shield" size={28} color={Colors.light.primary} />
                </View>
                <ThemedText style={styles.optionTitle}>FPV nach Verbandsregel</ThemedText>
              </View>
              <ThemedText style={styles.optionDescription}>
                DMFV-/DMO-Verbandsbetriebserlaubnis (Art. 16 EU-VO 2019/947):
                FPV-Flug ohne Spotter zulässig, aber Höhe MUSS auf max. 30 m AGL begrenzt sein.
              </ThemedText>
              <Button
                title="FPV ohne Spotter (max. 30 m)"
                onPress={() => handleSelect(true, "verband30m")}
                style={styles.optionButton}
                testID="button-fpv-verband30m"
              />
            </Card>
          ) : null}

          <Card style={styles.optionCard}>
            <View style={styles.optionHeader}>
              <View style={[styles.optionIcon, { backgroundColor: Colors.light.statusGo + "20" }]}>
                <Feather name="eye" size={28} color={Colors.light.statusGo} />
              </View>
              <ThemedText style={styles.optionTitle}>Normal (VLOS)</ThemedText>
            </View>
            <ThemedText style={styles.optionDescription}>
              Line of Sight Flug mit direkter Sicht auf die Drohne. Kein Spotter erforderlich.
            </ThemedText>
            <Button
              title="Normal"
              onPress={() => handleSelect(false)}
              variant="secondary"
              style={styles.optionButton}
              testID="button-fpv-normal"
            />
          </Card>
        </View>

        <View style={styles.infoRow}>
          <Feather name="info" size={16} color={Colors.light.textSecondary} />
          <Text style={styles.infoText}>
            {hasVerbandsregel
              ? "Bei „FPV nach Verbandsregel“ wird in der Checkliste die 30-m-Höhenbegrenzung als Pflicht-Punkt eingeblendet."
              : "Bei FPV-Flügen werden zusätzliche Spotter-Checkpunkte angezeigt."}
          </Text>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
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
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    justifyContent: "center",
    marginTop: Spacing.xl,
  },
  infoText: {
    ...Typography.small,
    color: Colors.light.textSecondary,
    flex: 1,
  },
});
