import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, Alert, Modal, Pressable } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { createFlightSession, updateFlightSession, FlightSession, getFlightSession, getSettings } from "@/lib/storage";
import { startRecording as startTrafficRecording } from "@/lib/trafficRecorder";
import { assessWeather, AssessmentResult, AssessmentWarning, ExpertTip } from "@/lib/assessment";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type RouteParams = RouteProp<FlightCheckParamList, "Results">;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ResultsScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [assessment, setAssessment] = useState<AssessmentResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [selectedTip, setSelectedTip] = useState<ExpertTip | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, weatherData, droneId, limits, sessionId, checklistCompleted, checklistPresented, isFpvFlight, kpIndex } = route.params;

  const runAssessment = useCallback(async () => {
    const result = assessWeather(weatherData, limits, hasRestrictions, restrictionStatus, kpIndex);
    setAssessment(result);

    if (result.status === "go") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [weatherData, limits, hasRestrictions, restrictionStatus]);

  useEffect(() => {
    runAssessment();
  }, [runAssessment]);

  const handleSave = async () => {
    if (!assessment) return;
    
    if (assessment.requiresConfirmation && !confirmed) {
      setShowConfirmation(true);
      return;
    }
    
    setSaving(true);
    try {
      const weatherSnapshot = {
        temperature: weatherData.forecasts[0].temperature,
        windSpeed: weatherData.forecasts[0].windSpeed,
        windGust: weatherData.forecasts[0].windGust,
        rain: weatherData.forecasts[0].rain,
        cloudCover: weatherData.forecasts[0].cloudCover,
        humidity: weatherData.forecasts[0].humidity,
        kpIndex: kpIndex,
      };
      
      if (sessionId) {
        const existingSession = await getFlightSession(sessionId);
        await updateFlightSession(sessionId, {
          currentPhase: "hover",
          status: assessment.status,
          reasons: assessment.reasons,
          planning: {
            ...existingSession?.planning,
            plannedDate: existingSession?.planning?.plannedDate || new Date().toISOString().split("T")[0],
            plannedTime: existingSession?.planning?.plannedTime || new Date().toTimeString().slice(0, 5),
            checklistCompleted: existingSession?.planning?.checklistCompleted || [],
            isFpvFlight: isFpvFlight ?? existingSession?.planning?.isFpvFlight ?? false,
          },
          preflight: {
            actualWeather: weatherSnapshot,
            checklistCompleted: checklistCompleted || [],
            checklistPresented: checklistPresented || [],
            completedAt: new Date().toISOString(),
          },
        });
      } else {
        await createFlightSession({
          droneId,
          currentPhase: "hover",
          latitude,
          longitude,
          hasRestrictions,
          restrictionNotes,
          status: assessment.status,
          reasons: assessment.reasons,
          planning: {
            plannedDate: new Date().toISOString().split("T")[0],
            plannedTime: new Date().toTimeString().slice(0, 5),
            checklistCompleted: [],
            isFpvFlight: isFpvFlight ?? false,
          },
          preflight: {
            actualWeather: weatherSnapshot,
            checklistCompleted: checklistCompleted || [],
            checklistPresented: checklistPresented || [],
            completedAt: new Date().toISOString(),
          },
        });
      }
      
      try {
        const settings = await getSettings();
        const approachRadiusM = settings.proximityAlarm?.approachRadiusM ?? 1000;
        startTrafficRecording(latitude, longitude, approachRadiusM, approachRadiusM * 3);
      } catch {}

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.getParent()?.goBack();
    } catch (error) {
      Alert.alert("Fehler", "Briefing konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmProceed = () => {
    setConfirmed(true);
    setShowConfirmation(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const getStatusConfig = () => {
    if (!assessment) return null;
    if (assessment.status === "go") {
      return {
        icon: "check-circle" as const,
        title: "GO",
        subtitle: "Flug empfohlen",
        color: theme.statusGo,
        background: theme.statusGoBackground,
      };
    }
    if (assessment.requiresConfirmation && !confirmed) {
      return {
        icon: "alert-triangle" as const,
        title: "WARNUNG",
        subtitle: "Flug nicht empfohlen",
        color: theme.statusNoGo,
        background: theme.statusNoGoBackground,
      };
    }
    return {
      icon: "alert-triangle" as const,
      title: "CAUTION",
      subtitle: "Mit Vorsicht fliegen",
      color: theme.statusCaution,
      background: theme.statusCautionBackground,
    };
  };

  const config = getStatusConfig();

  const severeWarnings = assessment?.warnings.filter(w => w.severity === "warning") || [];
  const cautionWarnings = assessment?.warnings.filter(w => w.severity === "caution") || [];

  if (!assessment || !config) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ThemedText style={{ color: theme.textSecondary }}>Bewertung läuft...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + 100,
          },
        ]}
      >
        <Animated.View entering={ZoomIn.duration(400)} style={styles.statusContainer}>
          <View style={[styles.statusCard, { backgroundColor: config.background }]}>
            <Feather name={config.icon} size={64} color={config.color} />
            <ThemedText style={[styles.statusTitle, { color: config.color }]}>
              {config.title}
            </ThemedText>
            <ThemedText style={[styles.statusSubtitle, { color: theme.textSecondary }]}>
              {config.subtitle}
            </ThemedText>
          </View>
        </Animated.View>

        {severeWarnings.length > 0 ? (
          <Animated.View entering={FadeIn.delay(200).duration(300)}>
            <ThemedText style={[styles.sectionTitle, { color: theme.statusNoGo }]}>
              WARNUNGEN
            </ThemedText>
            {severeWarnings.map((warning, index) => (
              <Card key={index} style={[styles.warningCard, { borderLeftColor: theme.statusNoGo }]}>
                <View style={styles.warningHeader}>
                  <Feather name="alert-octagon" size={18} color={theme.statusNoGo} />
                  <ThemedText style={[styles.warningText, { flex: 1 }]}>{warning.message}</ThemedText>
                </View>
                {warning.expertTip ? (
                  <Pressable
                    style={[styles.tipButton, { backgroundColor: theme.backgroundSecondary }]}
                    onPress={() => setSelectedTip(warning.expertTip!)}
                  >
                    <Feather name="help-circle" size={14} color={theme.primary} />
                    <ThemedText style={[styles.tipButtonText, { color: theme.primary }]}>
                      Experten-Tipps anzeigen
                    </ThemedText>
                  </Pressable>
                ) : null}
              </Card>
            ))}
          </Animated.View>
        ) : null}

        {cautionWarnings.length > 0 ? (
          <Animated.View entering={FadeIn.delay(300).duration(300)}>
            <ThemedText style={[styles.sectionTitle, { color: theme.statusCaution }]}>
              HINWEISE
            </ThemedText>
            {cautionWarnings.map((warning, index) => (
              <Card key={index} style={[styles.cautionCard, { borderLeftColor: theme.statusCaution }]}>
                <View style={styles.warningHeader}>
                  <Feather name="alert-triangle" size={16} color={theme.statusCaution} />
                  <ThemedText style={[styles.warningText, { flex: 1 }]}>{warning.message}</ThemedText>
                </View>
              </Card>
            ))}
          </Animated.View>
        ) : null}

        {assessment.status === "go" ? (
          <Animated.View entering={FadeIn.delay(300).duration(300)}>
            <Card style={[styles.successCard, { borderLeftColor: theme.statusGo }]}>
              <View style={styles.warningHeader}>
                <Feather name="check" size={18} color={theme.statusGo} />
                <ThemedText style={styles.warningText}>
                  Alle Wetterbedingungen innerhalb der Limits
                </ThemedText>
              </View>
            </Card>
          </Animated.View>
        ) : null}

        <Animated.View entering={FadeIn.delay(500).duration(300)}>
          <Card style={[styles.noteCard, { borderLeftColor: theme.primary }]}>
            <View style={styles.noteHeader}>
              <Feather name="info" size={16} color={theme.primary} />
              <ThemedText style={[styles.noteTitle, { color: theme.primary }]}>Hinweis</ThemedText>
            </View>
            <ThemedText style={[styles.noteText, { color: theme.textSecondary }]}>
              Diese Bewertung basiert auf Wetterdaten. Geozonen und Regeln bleiben maßgeblich.
              Die endgültige Entscheidung liegt beim Piloten.
            </ThemedText>
          </Card>
        </Animated.View>

        <View style={styles.buttonRow}>
          {assessment.requiresConfirmation && !confirmed ? (
            <>
              <Button
                title="Flug abbrechen"
                onPress={() => navigation.navigate("Main")}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                title="Trotzdem fortfahren"
                onPress={() => setShowConfirmation(true)}
                style={{ flex: 1, backgroundColor: theme.statusCaution }}
              />
            </>
          ) : (
            <Button
              title="Briefing speichern"
              onPress={handleSave}
              loading={saving}
            />
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showConfirmation}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmation(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={[styles.modalHeader, { backgroundColor: theme.statusNoGoBackground }]}>
              <Feather name="alert-triangle" size={32} color={theme.statusNoGo} />
              <ThemedText style={[styles.modalTitle, { color: theme.statusNoGo }]}>
                Flug nicht empfohlen
              </ThemedText>
            </View>
            
            <View style={styles.modalBody}>
              <ThemedText style={[styles.modalText, { color: theme.textSecondary }]}>
                Die aktuellen Bedingungen übersteigen die empfohlenen Grenzwerte. 
                Ein Flug birgt erhöhte Risiken.
              </ThemedText>
              
              <ThemedText style={[styles.modalQuestion, { color: theme.text }]}>
                Möchtest du trotzdem fortfahren?
              </ThemedText>
              
              {severeWarnings.some(w => w.expertTip) ? (
                <ThemedText style={[styles.modalHint, { color: theme.textTertiary }]}>
                  Tipp: Schau dir die Experten-Tipps an, um zu wissen worauf du achten musst.
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.modalButtons}>
              <Button
                title="Abbrechen"
                onPress={() => setShowConfirmation(false)}
                variant="secondary"
                style={{ flex: 1 }}
              />
              <Button
                title="Ja, fortfahren"
                onPress={handleConfirmProceed}
                style={{ flex: 1, backgroundColor: theme.statusNoGo }}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={selectedTip !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedTip(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.tipModalContent, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.tipModalHeader}>
              <Feather name="book-open" size={24} color={theme.primary} />
              <ThemedText style={[styles.tipModalTitle, { color: theme.primary }]}>
                {selectedTip?.title || "Experten-Tipp"}
              </ThemedText>
              <Pressable onPress={() => setSelectedTip(null)} style={styles.closeButton}>
                <Feather name="x" size={24} color={theme.textSecondary} />
              </Pressable>
            </View>
            
            <ScrollView style={styles.tipModalBody}>
              <ThemedText style={styles.tipDescription}>
                {selectedTip?.description}
              </ThemedText>
              
              {selectedTip?.practiceCheck ? (
                <View style={styles.practiceCheckBox}>
                  <View style={styles.practiceCheckHeader}>
                    <Feather name="eye" size={16} color={theme.statusCaution} />
                    <ThemedText style={[styles.practiceCheckTitle, { color: theme.statusCaution }]}>
                      Praxis-Check
                    </ThemedText>
                  </View>
                  <ThemedText style={[styles.practiceCheckText, { color: theme.textSecondary }]}>
                    {selectedTip.practiceCheck}
                  </ThemedText>
                </View>
              ) : null}
            </ScrollView>
            
            <View style={styles.tipModalFooter}>
              <Button
                title="Verstanden"
                onPress={() => setSelectedTip(null)}
              />
            </View>
          </View>
        </View>
      </Modal>
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  statusContainer: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  statusCard: {
    width: "100%",
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.lg,
  },
  statusTitle: {
    fontSize: 36,
    fontWeight: "800",
    marginTop: Spacing.lg,
    letterSpacing: 2,
  },
  statusSubtitle: {
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  warningCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 4,
  },
  cautionCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
  },
  successCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    borderLeftWidth: 3,
  },
  warningHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  warningText: {
    ...Typography.body,
  },
  tipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignSelf: "flex-start",
  },
  tipButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  noteCard: {
    padding: Spacing.lg,
    borderLeftWidth: 3,
    marginTop: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  noteTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  noteText: {
    ...Typography.small,
  },
  buttonRow: {
    gap: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalContent: {
    width: "100%",
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  modalHeader: {
    alignItems: "center",
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  modalTitle: {
    ...Typography.h2,
    fontWeight: "700",
  },
  modalBody: {
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  modalText: {
    ...Typography.body,
    textAlign: "center",
  },
  modalQuestion: {
    ...Typography.body,
    fontWeight: "600",
    textAlign: "center",
  },
  modalHint: {
    ...Typography.small,
    textAlign: "center",
    fontStyle: "italic",
  },
  modalButtons: {
    flexDirection: "row",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  tipModalContent: {
    width: "100%",
    maxHeight: "80%",
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  tipModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  tipModalTitle: {
    ...Typography.h3,
    fontWeight: "700",
    flex: 1,
  },
  closeButton: {
    padding: Spacing.sm,
  },
  tipModalBody: {
    padding: Spacing.xl,
  },
  tipDescription: {
    ...Typography.body,
    lineHeight: 24,
    marginBottom: Spacing.xl,
  },
  practiceCheckBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  practiceCheckHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  practiceCheckTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  practiceCheckText: {
    ...Typography.body,
    lineHeight: 22,
  },
  tipModalFooter: {
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
});
