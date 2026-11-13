import React, { useState, useEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, Modal, TextInput } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import Checkbox from "@/components/Checkbox";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors, BorderRadius } from "@/constants/theme";
import { updateFlightSession, FlightSession, completeSessionWithLogEntry, getFlightSession, TrafficLogData } from "@/lib/storage";
import { stopRecording as stopTrafficRecording, isRecording as isTrafficRecording } from "@/lib/trafficRecorder";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

interface CheckItem {
  id: string;
  label: string;
  required: boolean;
  tip: string;
  type?: "checkbox" | "text" | "number";
  placeholder?: string;
  suffix?: string;
}

interface CheckSection {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: CheckItem[];
}

const DEBRIEFING_SECTIONS: CheckSection[] = [
  {
    title: "Nach der Landung",
    icon: "arrow-down-circle",
    items: [
      {
        id: "props_check",
        label: "Propeller auf Beschädigung prüfen",
        required: true,
        tip: "Suche nach Rissen, Kerben oder Verbiegungen, die während des Fluges entstanden sein könnten.",
        type: "checkbox",
      },
      {
        id: "motors_temp",
        label: "Motortemperatur fühlen",
        required: false,
        tip: "Motoren dürfen warm sein, aber nicht heiß. Übermäßige Hitze deutet auf Probleme hin.",
        type: "checkbox",
      },
      {
        id: "battery_final",
        label: "Endlicher Akkustand",
        required: true,
        tip: "Notiere den finalen Akkustand für spätere Referenz und Flugzeitplanung.",
        type: "number",
        placeholder: "z.B. 15",
        suffix: "%",
      },
      {
        id: "landing_clean",
        label: "Saubere Landung erfolgt",
        required: true,
        tip: "War die Landung kontrolliert? Probleme bei der Landung sollten dokumentiert werden.",
        type: "checkbox",
      },
    ],
  },
  {
    title: "Dokumentation",
    icon: "file-text",
    items: [
      {
        id: "issues_noted",
        label: "Probleme / Auffälligkeiten",
        required: false,
        tip: "Auch kleine Auffälligkeiten können auf größere Probleme hindeuten. Leer lassen wenn alles OK.",
        type: "text",
        placeholder: "Leer = alles OK",
      },
      {
        id: "footage_backup",
        label: "Aufnahmen gesichert / geprüft",
        required: false,
        tip: "Sichere wichtige Aufnahmen sofort. Prüfe stichprobenartig die Qualität.",
        type: "checkbox",
      },
    ],
  },
  {
    title: "Ausrüstung",
    icon: "box",
    items: [
      {
        id: "equipment_packed",
        label: "Ausrüstung verstaut",
        required: true,
        tip: "Gimbalschutz anbringen, Props schützen, alles sicher verpacken.",
        type: "checkbox",
      },
      {
        id: "battery_storage",
        label: "Akkus zur Lagerung vorbereitet",
        required: false,
        tip: "Bei längerer Lagerung: Akkus auf Lagerstand (ca. 50-60%) entladen oder laden lassen.",
        type: "checkbox",
      },
    ],
  },
];

interface DebriefingChecklistParams {
  sessionId: string;
}

type NavigationProp = NativeStackNavigationProp<FlightCheckParamList>;

export default function DebriefingChecklistScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<{ params: DebriefingChecklistParams }, "params">>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tipModal, setTipModal] = useState<{ visible: boolean; title: string; tip: string }>({
    visible: false,
    title: "",
    tip: "",
  });

  const { sessionId } = route.params || {};

  // Load saved debriefing data when resuming
  useEffect(() => {
    const loadSavedDebriefing = async () => {
      if (!sessionId) return;
      
      const session = await getFlightSession(sessionId);
      if (session?.debriefing) {
        const debriefing = session.debriefing;
        
        // Restore checkbox state
        if (debriefing.checklistCompleted && Array.isArray(debriefing.checklistCompleted)) {
          setChecked(new Set(debriefing.checklistCompleted));
        }
        
        // Restore text input values
        const savedTexts: Record<string, string> = {};
        if (debriefing.batteryUsedPercent !== undefined) {
          savedTexts["battery_final"] = String(debriefing.batteryUsedPercent);
        }
        if (debriefing.generalNotes && debriefing.generalNotes !== "Keine Probleme") {
          savedTexts["issues_noted"] = debriefing.generalNotes;
        }
        if (Object.keys(savedTexts).length > 0) {
          setTextValues(savedTexts);
        }
      }
    };
    
    loadSavedDebriefing();
  }, [sessionId]);

  const allRequiredCheckboxes = DEBRIEFING_SECTIONS.flatMap(s => 
    s.items.filter(i => i.required && (i.type === "checkbox" || !i.type))
  );
  const allRequiredTextInputs = DEBRIEFING_SECTIONS.flatMap(s =>
    s.items.filter(i => i.required && (i.type === "text" || i.type === "number"))
  );
  
  const allRequiredCheckboxesChecked = allRequiredCheckboxes.every(item => checked.has(item.id));
  const allRequiredTextInputsFilled = allRequiredTextInputs.every(item => 
    textValues[item.id] && textValues[item.id].trim().length > 0
  );
  const allRequiredCompleted = allRequiredCheckboxesChecked && allRequiredTextInputsFilled;

  const toggleItem = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      return next;
    });
  };

  const showTip = (title: string, tip: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTipModal({ visible: true, title, tip });
  };

  const dismissModal = () => {
    navigation.getParent()?.goBack();
  };

  const handleComplete = async () => {
    if (!sessionId) {
      Alert.alert("Fehler", "Keine Session gefunden.");
      return;
    }

    setSaving(true);
    try {
      const issuesText = textValues["issues_noted"]?.trim() || "";
      const batteryPercent = textValues["battery_final"]?.trim() || "";
      
      const debriefingData = {
        incidentOccurred: issuesText.length > 0,
        maintenanceRequired: false,
        generalNotes: issuesText.length > 0 ? issuesText : "Keine Probleme",
        batteryUsedPercent: batteryPercent ? parseInt(batteryPercent, 10) : undefined,
        checklistCompleted: Array.from(checked),
        landingTime: new Date().toISOString(),
      };
      
      let trafficLog: TrafficLogData | undefined;
      if (isTrafficRecording()) {
        const recording = stopTrafficRecording();
        if (recording) {
          trafficLog = recording as TrafficLogData;
        }
      }

      await updateFlightSession(sessionId, { 
        debriefing: debriefingData,
        currentPhase: "completed",
        ...(trafficLog ? { trafficLog } : {}),
      });
      
      await completeSessionWithLogEntry(sessionId, debriefingData);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dismissModal();
    } catch (error) {
      Alert.alert("Fehler", "Debriefing konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const handlePostpone = () => {
    Alert.alert(
      "Debriefing verschieben",
      "Das Debriefing wird gespeichert und kann später fortgesetzt werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        { 
          text: "Verschieben", 
          onPress: async () => {
            if (sessionId) {
              const issuesText = textValues["issues_noted"]?.trim() || "";
              const batteryPercent = textValues["battery_final"]?.trim() || "";
              
              await updateFlightSession(sessionId, { 
                debriefing: {
                  incidentOccurred: issuesText.length > 0,
                  maintenanceRequired: false,
                  generalNotes: issuesText.length > 0 ? issuesText : undefined,
                  batteryUsedPercent: batteryPercent ? parseInt(batteryPercent, 10) : undefined,
                  checklistCompleted: Array.from(checked),
                }
              });
            }
            dismissModal();
          } 
        },
      ]
    );
  };

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
        <View style={styles.header}>
          <ThemedText style={styles.title}>Debriefing</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Prüfe diese Punkte nach dem Flug
          </ThemedText>
        </View>

        {DEBRIEFING_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon} size={18} color={theme.primary} />
              <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
            </View>
            <Card style={styles.sectionCard}>
              {section.items.map((item, itemIndex) => {
                const itemType = item.type || "checkbox";
                const isTextInput = itemType === "text" || itemType === "number";
                
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.checkItem,
                      isTextInput && styles.checkItemTextInput,
                      itemIndex < section.items.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: theme.border,
                      },
                    ]}
                  >
                    {isTextInput ? (
                      <View style={styles.textInputContainer}>
                        <View style={styles.textInputHeader}>
                          <ThemedText style={styles.checkLabel}>{item.label}</ThemedText>
                          <View style={styles.itemActions}>
                            {item.required ? (
                              <View style={[styles.requiredBadge, { backgroundColor: theme.statusCautionBackground }]}>
                                <ThemedText style={[styles.requiredText, { color: theme.statusCaution }]}>
                                  Pflicht
                                </ThemedText>
                              </View>
                            ) : null}
                            <Pressable
                              onPress={() => showTip(item.label, item.tip)}
                              style={({ pressed }) => [
                                styles.tipButton,
                                { backgroundColor: theme.backgroundSecondary },
                                pressed && { opacity: 0.7 },
                              ]}
                              hitSlop={8}
                            >
                              <Feather name="help-circle" size={18} color={theme.primary} />
                            </Pressable>
                          </View>
                        </View>
                        <View style={styles.textInputRow}>
                          <TextInput
                            style={[
                              styles.textInput,
                              { 
                                backgroundColor: theme.backgroundSecondary,
                                color: theme.text,
                                borderColor: theme.border,
                              },
                              itemType === "number" && styles.numberInput,
                            ]}
                            placeholder={item.placeholder}
                            placeholderTextColor={theme.textTertiary}
                            value={textValues[item.id] || ""}
                            onChangeText={(text) => setTextValues(prev => ({ ...prev, [item.id]: text }))}
                            keyboardType={itemType === "number" ? "numeric" : "default"}
                            multiline={itemType === "text"}
                            numberOfLines={itemType === "text" ? 3 : 1}
                          />
                          {item.suffix ? (
                            <ThemedText style={[styles.inputSuffix, { color: theme.textSecondary }]}>
                              {item.suffix}
                            </ThemedText>
                          ) : null}
                        </View>
                      </View>
                    ) : (
                      <>
                        <Pressable
                          onPress={() => toggleItem(item.id)}
                          style={styles.checkRow}
                        >
                          <Checkbox checked={checked.has(item.id)} onPress={() => toggleItem(item.id)} />
                          <ThemedText style={styles.checkLabel}>{item.label}</ThemedText>
                        </Pressable>
                        <View style={styles.itemActions}>
                          {item.required ? (
                            <View style={[styles.requiredBadge, { backgroundColor: theme.statusCautionBackground }]}>
                              <ThemedText style={[styles.requiredText, { color: theme.statusCaution }]}>
                                Pflicht
                              </ThemedText>
                            </View>
                          ) : null}
                          <Pressable
                            onPress={() => showTip(item.label, item.tip)}
                            style={({ pressed }) => [
                              styles.tipButton,
                              { backgroundColor: theme.backgroundSecondary },
                              pressed && { opacity: 0.7 },
                            ]}
                            hitSlop={8}
                          >
                            <Feather name="help-circle" size={18} color={theme.primary} />
                          </Pressable>
                        </View>
                      </>
                    )}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Später"
          onPress={handlePostpone}
          variant="secondary"
          style={{ flex: 1 }}
        />
        <Button
          title="Abschließen"
          onPress={handleComplete}
          disabled={!allRequiredCompleted}
          loading={saving}
          style={{ flex: 1 }}
        />
      </View>

      <Modal
        visible={tipModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setTipModal(prev => ({ ...prev, visible: false }))}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTipModal(prev => ({ ...prev, visible: false }))}
        >
          <Pressable style={[styles.modalContent, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.modalHeader}>
              <Feather name="info" size={24} color={theme.primary} />
              <ThemedText style={styles.modalTitle}>{tipModal.title}</ThemedText>
            </View>
            <ThemedText style={[styles.modalText, { color: theme.textSecondary }]}>
              {tipModal.tip}
            </ThemedText>
            <Button
              title="Verstanden"
              onPress={() => setTipModal(prev => ({ ...prev, visible: false }))}
              style={styles.modalButton}
            />
          </Pressable>
        </Pressable>
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
  header: {
    marginBottom: Spacing.xl,
  },
  title: {
    ...Typography.h2,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    ...Typography.body,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.h4,
  },
  sectionCard: {
    overflow: "hidden",
  },
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
  },
  checkLabel: {
    ...Typography.body,
    flex: 1,
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  requiredBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 4,
  },
  requiredText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  tipButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    borderRadius: 16,
    padding: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.h4,
    flex: 1,
  },
  modalText: {
    ...Typography.body,
    lineHeight: 24,
    marginBottom: Spacing.xl,
  },
  modalButton: {
    alignSelf: "stretch",
  },
  checkItemTextInput: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  textInputContainer: {
    flex: 1,
    gap: Spacing.sm,
  },
  textInputHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body,
    minHeight: 44,
    textAlignVertical: "top",
  },
  numberInput: {
    flex: 0,
    width: 80,
    textAlign: "center",
  },
  inputSuffix: {
    ...Typography.body,
    fontWeight: "600",
  },
});
