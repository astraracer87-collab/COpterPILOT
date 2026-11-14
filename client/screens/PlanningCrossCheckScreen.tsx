import React, { useMemo, useState } from "react";
import { View, StyleSheet, TextInput, TouchableOpacity } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getMapConfigOrFallback, buildMapUrl } from "@/lib/countryMaps";
import { buildCrossCheckParams } from "@/lib/manualRestrictionFlow";
import { countryName } from "../../shared/countryEntitlements";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningCrossCheck">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningCrossCheck">;

export default function PlanningCrossCheckScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const {
    droneId,
    latitude,
    longitude,
    locationName,
    countryIso,
    radiusKm,
    maxAltitude,
    recommendedVlosM,
    vlosExceeded,
    vlosCharDimensionM,
    vlosAltitudeCorrection,
    vlosHorizontalLimitM,
    restrictionStatus,
    restrictionNotes,
  } = route.params;

  const mapConfig = useMemo(() => getMapConfigOrFallback(countryIso), [countryIso]);

  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [note, setNote] = useState("");

  const handleOpenMap = () => {
    const url = buildMapUrl(mapConfig, latitude, longitude);
    navigation.navigate("PlanningExternalMap", {
      url,
      title: `Offizielle Karte – ${mapConfig.nameDE}`,
      latitude,
      longitude,
    });
  };

  const handleContinue = () => {
    const cc =
      blocking === null
        ? null
        : { blocking, note: note.trim() };
    navigation.navigate("PlanningDateTime", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      radiusKm,
      maxAltitude,
      recommendedVlosM,
      vlosExceeded,
      vlosCharDimensionM,
      vlosAltitudeCorrection,
      vlosHorizontalLimitM,
      restrictionStatus,
      restrictionNotes,
      ...buildCrossCheckParams(cc),
    });
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing["2xl"],
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <ThemedText style={styles.title}>Offizielle Karte gegenprüfen</ThemedText>
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          {`Zur Sicherheit kannst du die Geozonen-Erkennung der App gegen die offizielle Staatskarte von ${countryName(countryIso) || mapConfig.nameDE} abgleichen. Dieser Schritt ändert die automatische Geozonen-Erkennung nicht – er ergänzt sie nur um deine eigene Sichtprüfung.`}
        </ThemedText>

        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Feather name="map" size={16} color={theme.primary} />
            <ThemedText style={[styles.cardTitle, { color: theme.text }]}>
              Schritt 1 – Karte ansehen
            </ThemedText>
          </View>
          <ThemedText style={[styles.cardHint, { color: theme.textSecondary }]}>
            {`Öffne die offizielle Karte von ${mapConfig.nameDE}${mapConfig.supportsCoordinates ? " (zentriert auf deinen Standort)" : ""} und prüfe, ob am Standort Geozonen liegen, die einen Start verhindern würden.`}
          </ThemedText>
          <TouchableOpacity
            style={[styles.mapButton, { backgroundColor: theme.primary }]}
            onPress={handleOpenMap}
            activeOpacity={0.7}
            testID="button-open-crosscheck-map"
          >
            <Feather name="external-link" size={16} color="#FFFFFF" />
            <ThemedText style={styles.mapButtonText}>Offizielle Karte öffnen</ThemedText>
          </TouchableOpacity>
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Feather name="help-circle" size={16} color={theme.primary} />
            <ThemedText style={[styles.cardTitle, { color: theme.text }]}>
              Schritt 2 – Ergebnis festhalten
            </ThemedText>
          </View>
          <ThemedText style={[styles.cardHint, { color: theme.textSecondary }]}>
            Gibt es dort Geozonen, die einen Start verhindern würden?
          </ThemedText>

          <View style={styles.answerRow}>
            <TouchableOpacity
              style={[
                styles.answerButton,
                {
                  borderColor: blocking === false ? theme.statusGo : theme.border,
                  backgroundColor: blocking === false ? theme.statusGoBackground : theme.backgroundSecondary,
                },
              ]}
              onPress={() => setBlocking(false)}
              activeOpacity={0.7}
              testID="button-crosscheck-no"
            >
              <Feather
                name="check-circle"
                size={16}
                color={blocking === false ? theme.statusGo : theme.textSecondary}
              />
              <ThemedText
                style={[
                  styles.answerButtonText,
                  { color: blocking === false ? theme.statusGo : theme.text },
                ]}
              >
                Nein
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.answerButton,
                {
                  borderColor: blocking === true ? theme.statusCaution : theme.border,
                  backgroundColor: blocking === true ? theme.statusCautionBackground : theme.backgroundSecondary,
                },
              ]}
              onPress={() => setBlocking(true)}
              activeOpacity={0.7}
              testID="button-crosscheck-yes"
            >
              <Feather
                name="alert-triangle"
                size={16}
                color={blocking === true ? theme.statusCaution : theme.textSecondary}
              />
              <ThemedText
                style={[
                  styles.answerButtonText,
                  { color: blocking === true ? theme.statusCaution : theme.text },
                ]}
              >
                Ja
              </ThemedText>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[
              styles.noteInput,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary },
            ]}
            value={note}
            onChangeText={setNote}
            placeholder="Notiz (optional)"
            placeholderTextColor={theme.textTertiary}
            multiline
            testID="input-crosscheck-note"
          />
        </Card>

        <ThemedText style={[styles.skipHint, { color: theme.textTertiary }]}>
          Dieser Schritt ist optional – du kannst auch ohne Angabe fortfahren.
        </ThemedText>

        <Button
          title="Weiter zu Datum & Zeit"
          onPress={handleContinue}
          style={styles.continueButton}
          testID="button-crosscheck-continue"
        />
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    ...Typography.h2,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.small,
    marginBottom: Spacing.lg,
  },
  card: {
    marginBottom: Spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    ...Typography.h4,
  },
  cardHint: {
    ...Typography.small,
    marginBottom: Spacing.md,
  },
  mapButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  mapButtonText: {
    color: "#FFFFFF",
    ...Typography.h4,
  },
  answerRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  answerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  answerButtonText: {
    ...Typography.h4,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    minHeight: 64,
    textAlignVertical: "top",
    ...Typography.body,
  },
  skipHint: {
    ...Typography.caption,
    marginBottom: Spacing.lg,
  },
  continueButton: {
    marginTop: Spacing.sm,
  },
});
