import React, { useState } from "react";
import { View, StyleSheet, TextInput, Pressable } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";

type RouteParams = RouteProp<FlightCheckParamList, "Restrictions">;
type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "Restrictions">;

type RestrictionStatus = "approved" | "limited" | "nofly";

export default function RestrictionsScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [hasRestrictions, setHasRestrictions] = useState<boolean | null>(null);
  const [restrictionStatus, setRestrictionStatus] = useState<RestrictionStatus | null>(null);
  const [notes, setNotes] = useState("");

  const { latitude, longitude, droneId, sessionId } = route.params;

  const handleNoRestrictions = () => {
    setHasRestrictions(false);
    setRestrictionStatus(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleHasRestrictions = () => {
    setHasRestrictions(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSelectStatus = (status: RestrictionStatus) => {
    setRestrictionStatus(status);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleContinue = () => {
    const restrictionNotes = hasRestrictions && notes.trim() ? notes.trim() : undefined;
    navigation.navigate("Weather", {
      latitude,
      longitude,
      hasRestrictions: hasRestrictions === true,
      restrictionStatus: restrictionStatus === "nofly" ? undefined : (restrictionStatus ?? undefined),
      restrictionNotes,
      droneId,
      sessionId,
    });
  };

  const handleAbort = () => {
    navigation.getParent()?.goBack();
  };

  const canContinue = hasRestrictions === false || (hasRestrictions === true && restrictionStatus !== null && restrictionStatus !== "nofly");

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
        ]}
      >
        <ThemedText style={styles.title}>Gab es Einschränkungen?</ThemedText>
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          Wurden in der dipul Karte Geozonen oder Einschränkungen für Ihren Standort angezeigt?
        </ThemedText>

        <View style={styles.optionRow}>
          <Pressable
            onPress={handleNoRestrictions}
            style={[
              styles.optionButton,
              { borderColor: hasRestrictions === false ? theme.statusGo : theme.border },
              hasRestrictions === false && { backgroundColor: theme.statusGoBackground },
            ]}
          >
            <Feather
              name="check-circle"
              size={32}
              color={hasRestrictions === false ? theme.statusGo : theme.textTertiary}
            />
            <ThemedText
              style={[
                styles.optionText,
                hasRestrictions === false && { color: theme.statusGo, fontWeight: "600" },
              ]}
            >
              Nein
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={handleHasRestrictions}
            style={[
              styles.optionButton,
              { borderColor: hasRestrictions === true ? theme.statusCaution : theme.border },
              hasRestrictions === true && { backgroundColor: theme.statusCautionBackground },
            ]}
          >
            <Feather
              name="alert-triangle"
              size={32}
              color={hasRestrictions === true ? theme.statusCaution : theme.textTertiary}
            />
            <ThemedText
              style={[
                styles.optionText,
                hasRestrictions === true && { color: theme.statusCaution, fontWeight: "600" },
              ]}
            >
              Ja
            </ThemedText>
          </Pressable>
        </View>

        {hasRestrictions === true ? (
          <View style={styles.detailsSection}>
            <ThemedText style={[styles.detailsLabel, { color: theme.textSecondary }]}>
              Wie gehen Sie mit der Einschränkung um?
            </ThemedText>

            <Pressable
              onPress={() => handleSelectStatus("approved")}
              style={[
                styles.statusOption,
                { borderColor: restrictionStatus === "approved" ? theme.statusGo : theme.border },
                restrictionStatus === "approved" && { backgroundColor: theme.statusGoBackground },
              ]}
            >
              <Feather
                name="shield"
                size={24}
                color={restrictionStatus === "approved" ? theme.statusGo : theme.textTertiary}
              />
              <View style={styles.statusTextContainer}>
                <ThemedText
                  style={[
                    styles.statusTitle,
                    restrictionStatus === "approved" && { color: theme.statusGo, fontWeight: "700" },
                  ]}
                >
                  Genehmigung vorhanden
                </ThemedText>
                <ThemedText style={[styles.statusDescription, { color: theme.textSecondary }]}>
                  Ich habe eine gültige Genehmigung für dieses Gebiet
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => handleSelectStatus("limited")}
              style={[
                styles.statusOption,
                { borderColor: restrictionStatus === "limited" ? theme.statusCaution : theme.border },
                restrictionStatus === "limited" && { backgroundColor: theme.statusCautionBackground },
              ]}
            >
              <Feather
                name="alert-circle"
                size={24}
                color={restrictionStatus === "limited" ? theme.statusCaution : theme.textTertiary}
              />
              <View style={styles.statusTextContainer}>
                <ThemedText
                  style={[
                    styles.statusTitle,
                    restrictionStatus === "limited" && { color: theme.statusCaution, fontWeight: "700" },
                  ]}
                >
                  Flug mit Auflagen möglich
                </ThemedText>
                <ThemedText style={[styles.statusDescription, { color: theme.textSecondary }]}>
                  Flug ist erlaubt, aber mit Einschränkungen (z.B. Höhenlimit)
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              onPress={() => handleSelectStatus("nofly")}
              style={[
                styles.statusOption,
                { borderColor: restrictionStatus === "nofly" ? theme.statusNoGo : theme.border },
                restrictionStatus === "nofly" && { backgroundColor: theme.statusNoGoBackground },
              ]}
            >
              <Feather
                name="x-circle"
                size={24}
                color={restrictionStatus === "nofly" ? theme.statusNoGo : theme.textTertiary}
              />
              <View style={styles.statusTextContainer}>
                <ThemedText
                  style={[
                    styles.statusTitle,
                    restrictionStatus === "nofly" && { color: theme.statusNoGo, fontWeight: "700" },
                  ]}
                >
                  Flug nicht möglich
                </ThemedText>
                <ThemedText style={[styles.statusDescription, { color: theme.textSecondary }]}>
                  Flugverbot - keine Genehmigung vorhanden
                </ThemedText>
              </View>
            </Pressable>

            {restrictionStatus !== null && restrictionStatus !== "nofly" ? (
              <View style={styles.notesSection}>
                <ThemedText style={[styles.detailsLabel, { color: theme.textSecondary }]}>
                  Notizen (optional)
                </ThemedText>
                <TextInput disableFullscreenUI
                  style={[
                    styles.notesInput,
                    { backgroundColor: theme.backgroundSecondary, color: theme.text },
                  ]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Weitere Details zur Genehmigung oder Auflage..."
                  placeholderTextColor={theme.textTertiary}
                  multiline
                  numberOfLines={3}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        {restrictionStatus === "nofly" ? (
          <Button
            title="Flug abbrechen"
            onPress={handleAbort}
            variant="secondary"
            style={{ backgroundColor: theme.statusNoGoBackground }}
          />
        ) : (
          <Button
            title="Weiter zur Wetterprüfung"
            onPress={handleContinue}
            disabled={!canContinue}
          />
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  title: {
    ...Typography.h2,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  optionRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  optionButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    gap: Spacing.md,
  },
  optionText: {
    ...Typography.h4,
  },
  detailsSection: {
    marginTop: Spacing["2xl"],
    gap: Spacing.md,
  },
  detailsLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    gap: Spacing.md,
  },
  statusTextContainer: {
    flex: 1,
  },
  statusTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  statusDescription: {
    ...Typography.caption,
    marginTop: 2,
  },
  notesSection: {
    marginTop: Spacing.md,
  },
  notesInput: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    minHeight: 80,
    textAlignVertical: "top",
    ...Typography.body,
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
