import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, TextInput } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors, BorderRadius } from "@/constants/theme";
import { updateFlightSession, FlightSession, completeSessionWithLogEntry, getFlightSession, TrafficLogData, addDroneHistoryEntry, getDrone, DroneProfile, BatteryUsage } from "@/lib/storage";
import BatterySelectionBlock from "@/components/BatterySelectionBlock";
import { stopRecording as stopTrafficRecording, isRecording as isTrafficRecording } from "@/lib/trafficRecorder";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { InfoDialog } from "@/components/InfoDialog";
import { ChecklistRow } from "@/components/ChecklistRow";
import { useChecklistState, checklistHaptic } from "@/hooks/useChecklistState";

interface CheckItem {
  id: string;
  label: string;
  required: boolean;
  tip: string;
  type?: "checkbox" | "text" | "number" | "choice";
  placeholder?: string;
  suffix?: string;
  options?: { value: string; label: string }[];
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
        label: "Endlicher Akkustand (optional)",
        required: false,
        tip: "Freiwillig. Notiere den finalen Akkustand für spätere Referenz und Flugzeitplanung — oder übernimm ihn später aus dem angehängten Fluglog.",
        type: "number",
        placeholder: "z.B. 15",
        suffix: "%",
      },
      {
        id: "landing_quality",
        label: "Landung dokumentieren",
        required: true,
        tip: "Wähle den Landungstyp nach Luftfahrt-Standard. Smooth Landing = unauffällig. Hard Landing = Wartungs-Inspektion erforderlich (Airframe, Motoren, Akku). Crash Landing = Vorfall, Drohne nicht mehr fliegen, dokumentations- und ggf. meldepflichtig.",
        type: "choice",
        options: [
          { value: "smooth_landing", label: "Smooth Landing" },
          { value: "hard_landing", label: "Hard Landing" },
          { value: "crash_landing", label: "Crash Landing" },
        ],
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
  // Lokal + optimistisch: der Haken erscheint im selben Frame (kein Speicherzugriff).
  const { checked, toggle: toggleItem, replace: replaceChecked } =
    useChecklistState(undefined, { onCheck: checklistHaptic });
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [batteryUsage, setBatteryUsage] = useState<BatteryUsage[]>([]);
  const [batteryInitial, setBatteryInitial] = useState<BatteryUsage[] | undefined>(undefined);
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
      if (session?.droneId) {
        const d = await getDrone(session.droneId);
        setDrone(d);
        // Vorbelegung aus Pre-Check: gleiche Akku-Auswahl, Endwerte aber leer
        const preUsage = session.preflight?.batteryUsage;
        if (preUsage && preUsage.length > 0) {
          setBatteryInitial(
            preUsage.map((u) => ({
              batteryId: u.batteryId,
              name: u.name,
              serialNumber: u.serialNumber,
            })),
          );
        }
      }
      if (session?.debriefing) {
        const debriefing = session.debriefing;
        if (debriefing.batteryUsage && debriefing.batteryUsage.length > 0) {
          setBatteryInitial(debriefing.batteryUsage);
        }
        
        // Restore checkbox state
        if (debriefing.checklistCompleted && Array.isArray(debriefing.checklistCompleted)) {
          replaceChecked(debriefing.checklistCompleted);
        }
        
        // Restore text input values + choice values
        const savedTexts: Record<string, string> = {};
        if (debriefing.batteryUsedPercent !== undefined) {
          savedTexts["battery_final"] = String(debriefing.batteryUsedPercent);
        }
        if (debriefing.generalNotes && debriefing.generalNotes !== "Keine Probleme") {
          savedTexts["issues_noted"] = debriefing.generalNotes;
        }
        // Restore landing quality from checklist (incl. legacy values for backward compat)
        const completedList = debriefing.checklistCompleted || [];
        if (completedList.includes("crash_landing")) {
          savedTexts["landing_quality"] = "crash_landing";
        } else if (completedList.includes("hard_landing")) {
          savedTexts["landing_quality"] = "hard_landing";
        } else if (completedList.includes("smooth_landing")) {
          savedTexts["landing_quality"] = "smooth_landing";
        } else if (completedList.includes("firm_landing")) {
          savedTexts["landing_quality"] = "smooth_landing";
        } else if (completedList.includes("landing_hard")) {
          savedTexts["landing_quality"] = "hard_landing";
        } else if (completedList.includes("landing_soft") || completedList.includes("landing_clean")) {
          savedTexts["landing_quality"] = "smooth_landing";
        }
        if (Object.keys(savedTexts).length > 0) {
          setTextValues(savedTexts);
        }
      }
    };
    
    loadSavedDebriefing();
  }, [sessionId, replaceChecked]);

  const hasDroneBatteries = !!(drone?.batteries && drone.batteries.length > 0);
  const effectiveSections: CheckSection[] = useMemo(
    () =>
      hasDroneBatteries
        ? DEBRIEFING_SECTIONS.map((s) => ({
            ...s,
            items: s.items.filter((i) => i.id !== "battery_final"),
          }))
        : DEBRIEFING_SECTIONS,
    [hasDroneBatteries],
  );

  const allRequiredCheckboxes = effectiveSections.flatMap(s => 
    s.items.filter(i => i.required && (i.type === "checkbox" || !i.type))
  );
  const allRequiredTextInputs = effectiveSections.flatMap(s =>
    s.items.filter(i => i.required && (i.type === "text" || i.type === "number"))
  );
  const allRequiredChoices = effectiveSections.flatMap(s =>
    s.items.filter(i => i.required && i.type === "choice")
  );

  const allRequiredCheckboxesChecked = allRequiredCheckboxes.every(item => checked.has(item.id));
  const allRequiredTextInputsFilled = allRequiredTextInputs.every(item => 
    textValues[item.id] && textValues[item.id].trim().length > 0
  );
  const allRequiredChoicesPicked = allRequiredChoices.every(item => {
    const v = textValues[item.id];
    return v != null && (item.options?.some(o => o.value === v) ?? false);
  });
  const allRequiredCompleted = allRequiredCheckboxesChecked && allRequiredTextInputsFilled && allRequiredChoicesPicked;

  const showTip = useCallback((title: string, tip: string) => {
    checklistHaptic();
    setTipModal({ visible: true, title, tip });
  }, []);

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
      const batteryPercent = hasDroneBatteries ? "" : (textValues["battery_final"]?.trim() || "");
      
      // Choice values (e.g. smooth_landing / hard_landing) are stored alongside checkbox IDs
      // so HistoryScreen and PDF export render them automatically.
      const choiceValues = effectiveSections
        .flatMap(s => s.items)
        .filter(i => i.type === "choice")
        .map(i => textValues[i.id])
        .filter((v): v is string => !!v);
      const checklistCompleted = Array.from(new Set([...Array.from(checked), ...choiceValues]));
      const isCrash = choiceValues.includes("crash_landing");
      const isHardLanding = choiceValues.includes("hard_landing");
      const requiresMaintenance = isCrash || isHardLanding;
      const landingNote = isCrash
        ? "Crash Landing — Drohne aus dem Flugbetrieb nehmen, vollständige Inspektion (Zelle, Motoren, Akku, Sensorik), Vorfall ggf. meldepflichtig"
        : isHardLanding
          ? "Hard Landing — Wartungs-Inspektion erforderlich (Airframe, Motoren, Akku)"
          : null;

      const debriefingData = {
        incidentOccurred: issuesText.length > 0 || isCrash,
        maintenanceRequired: requiresMaintenance,
        generalNotes: issuesText.length > 0 ? issuesText : (landingNote ?? "Keine Probleme"),
        batteryUsedPercent: batteryPercent ? parseInt(batteryPercent, 10) : undefined,
        batteryUsage: batteryUsage.length > 0 ? batteryUsage : undefined,
        checklistCompleted,
        landingTime: new Date().toISOString(),
      };
      
      let trafficLog: TrafficLogData | undefined;
      if (isTrafficRecording()) {
        const recording = stopTrafficRecording();
        if (recording) {
          trafficLog = recording as TrafficLogData;
        }
      }

      // Hard/Crash Landing automatisch in Drohnen-Historie eintragen
      if (isHardLanding || isCrash) {
        try {
          const session = await getFlightSession(sessionId);
          if (session?.droneId) {
            const description = isCrash
              ? "Drohne aus dem Flugbetrieb nehmen. Vollständige Inspektion (Zelle, Motoren, Akku, Sensorik) erforderlich, Vorfall ggf. meldepflichtig."
              : "Wartungs-Inspektion erforderlich (Airframe, Motoren, Akku).";
            await addDroneHistoryEntry(session.droneId, {
              eventType: isCrash ? "crash_landing" : "hard_landing",
              description,
              date: new Date().toISOString(),
              sessionId,
              locationName: session.locationName ?? null,
            });
          }
        } catch (e) {
          // Drohnen-Historie ist sekundär — Debriefing trotzdem speichern
          console.warn("Konnte Landungs-Eintrag in Drohnen-Historie nicht anlegen:", e);
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
              const batteryPercent = hasDroneBatteries ? "" : (textValues["battery_final"]?.trim() || "");
              
              const choiceValues = effectiveSections
                .flatMap(s => s.items)
                .filter(i => i.type === "choice")
                .map(i => textValues[i.id])
                .filter((v): v is string => !!v);
              const checklistCompleted = Array.from(new Set([...Array.from(checked), ...choiceValues]));
              const isCrashP = choiceValues.includes("crash_landing");
              const isHardP = choiceValues.includes("hard_landing");
              const landingNoteP = isCrashP
                ? "Crash Landing — Drohne aus dem Flugbetrieb nehmen, vollständige Inspektion (Zelle, Motoren, Akku, Sensorik), Vorfall ggf. meldepflichtig"
                : isHardP
                  ? "Hard Landing — Wartungs-Inspektion erforderlich (Airframe, Motoren, Akku)"
                  : undefined;

              await updateFlightSession(sessionId, { 
                debriefing: {
                  incidentOccurred: issuesText.length > 0 || isCrashP,
                  maintenanceRequired: isCrashP || isHardP,
                  generalNotes: issuesText.length > 0 ? issuesText : landingNoteP,
                  batteryUsedPercent: batteryPercent ? parseInt(batteryPercent, 10) : undefined,
                  batteryUsage: batteryUsage.length > 0 ? batteryUsage : undefined,
                  checklistCompleted,
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

        {effectiveSections.map((section) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon} size={18} color={theme.primary} />
              <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
            </View>
            <Card style={styles.sectionCard}>
              {section.items.map((item, itemIndex) => {
                const itemType = item.type || "checkbox";
                const isTextInput = itemType === "text" || itemType === "number";
                const isChoice = itemType === "choice";

                if (!isTextInput && !isChoice) {
                  // Memoisierte Zeile: Abhaken rendert nur diese Zeile neu.
                  return (
                    <ChecklistRow
                      key={item.id}
                      id={item.id}
                      label={item.label}
                      required={item.required}
                      tip={item.tip}
                      checked={checked.has(item.id)}
                      onToggle={toggleItem}
                      onShowTip={showTip}
                      showDivider={itemIndex < section.items.length - 1}
                    />
                  );
                }

                return (
                  <View
                    key={item.id}
                    style={[
                      styles.checkItem,
                      (isTextInput || isChoice) && styles.checkItemTextInput,
                      itemIndex < section.items.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: theme.border,
                      },
                    ]}
                  >
                    {isChoice ? (
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
                        <View style={styles.choiceRow}>
                          {(item.options || []).map((opt) => {
                            const selected = textValues[item.id] === opt.value;
                            const isCrash = opt.value === "crash_landing";
                            const isHard = opt.value === "hard_landing";
                            const activeBg = isCrash
                              ? theme.statusNoGoBackground
                              : isHard
                                ? theme.statusCautionBackground
                                : theme.statusGoBackground;
                            const activeColor = isCrash
                              ? theme.statusNoGo
                              : isHard
                                ? theme.statusCaution
                                : theme.statusGo;
                            return (
                              <Pressable
                                key={opt.value}
                                testID={`choice-${item.id}-${opt.value}`}
                                onPress={() => {
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                  setTextValues(prev => ({ ...prev, [item.id]: opt.value }));
                                }}
                                style={({ pressed }) => [
                                  styles.choiceButton,
                                  {
                                    backgroundColor: selected ? activeBg : theme.backgroundSecondary,
                                    borderColor: selected ? activeColor : theme.border,
                                  },
                                  pressed && { opacity: 0.7 },
                                ]}
                              >
                                <Feather
                                  name={selected ? (isCrash ? "alert-octagon" : isHard ? "alert-triangle" : "check-circle") : "circle"}
                                  size={16}
                                  color={selected ? activeColor : theme.textSecondary}
                                />
                                <ThemedText
                                  style={[
                                    styles.choiceLabel,
                                    { color: selected ? activeColor : theme.text },
                                  ]}
                                >
                                  {opt.label}
                                </ThemedText>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>
                    ) : isTextInput ? (
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
                          <TextInput disableFullscreenUI
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
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}

        {drone?.batteries && drone.batteries.length > 0 ? (
          <BatterySelectionBlock
            batteries={drone.batteries}
            mode="post"
            initial={batteryInitial}
            onChange={setBatteryUsage}
          />
        ) : null}
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

      <InfoDialog
        visible={tipModal.visible}
        onClose={() => setTipModal(prev => ({ ...prev, visible: false }))}
        title={tipModal.title}
        icon="info"
        text={tipModal.tip}
        okLabel="Verstanden"
        testID="tip-info-dialog"
      />
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
  choiceRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    flexWrap: "wrap",
  },
  choiceButton: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
  },
  choiceLabel: {
    ...Typography.body,
    fontWeight: "600",
    textAlign: "center",
  },
});
