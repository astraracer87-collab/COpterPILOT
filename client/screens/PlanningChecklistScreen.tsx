import React, { useState, useEffect, useMemo } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, Modal } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import Checkbox from "@/components/Checkbox";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors } from "@/constants/theme";
import { deleteFlightSession, updateFlightSession, getFlightSession } from "@/lib/storage";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningChecklist">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningChecklist">;

interface CheckItem {
  id: string;
  label: string;
  required: boolean;
  /** If true, the item may stay unchecked when saving the planning and be ticked off later. */
  deferrable?: boolean;
  tip: string;
}

interface CheckSection {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: CheckItem[];
}

const PLANNING_CHECKLIST: CheckSection[] = [
  {
    title: "Flugplanung",
    icon: "map",
    items: [
      { 
        id: "route", 
        label: "Flugroute / -gebiet geplant", 
        required: true,
        tip: "Definiere Start, Route und Landeplatz. Berücksichtige Hindernisse und Ausweichoptionen."
      },
      { 
        id: "airspace", 
        label: "Luftraum und Hindernisse ok", 
        required: true,
        tip: "Prüfe dipul, AIP, NOTAMs für Sperrgebiete, CTRs und temporäre Einschränkungen."
      },
      { 
        id: "notams", 
        label: "NOTAMs geprüft", 
        required: true,
        tip: "Aktuelle NOTAMs auf ICAO AIS oder beim DFS prüfen."
      },
      { 
        id: "weather", 
        label: "Wetter geprüft", 
        required: true,
        tip: "Wettervorhersage für den geplanten Zeitraum prüfen."
      },
    ],
  },
  {
    title: "Vorbereitung",
    icon: "package",
    items: [
      { 
        id: "drone_ready", 
        label: "Drohne ist flugfähig / gewartet", 
        required: true,
        deferrable: true,
        tip: "Letzte Wartung, bekannte Probleme, allgemeiner Zustand."
      },
      { 
        id: "firmware", 
        label: "Software und Firmware aktualisiert", 
        required: true,
        deferrable: true,
        tip: "WICHTIG: Alle Akkus nacheinander einlegen, um die Firmware auf jedem Akku zu prüfen! Updates vor Ort vermeiden - zu Hause mit stabilem WLAN durchführen."
      },
      { 
        id: "batteries", 
        label: "Batterien aufgeladen", 
        required: true,
        deferrable: true,
        tip: "Alle Akkus (Drohne + Controller) vollständig laden, Ersatzakkus einplanen."
      },
      { 
        id: "controller", 
        label: "Fernbedienung / Bodenstation geladen", 
        required: true,
        deferrable: true,
        tip: "Controller-Akku prüfen, ggf. Smartphone-Akku für App."
      },
      { 
        id: "equipment", 
        label: "Ausrüstung vorbereitet / gepackt", 
        required: false,
        deferrable: true,
        tip: "Packliste: Drohne, Akkus, Controller, Ladegerät, Werkzeug, Sonnenschutz."
      },
      { 
        id: "sdcard", 
        label: "Speicherkarten vorbereitet", 
        required: false,
        deferrable: true,
        tip: "SD-Karten formatiert und genug Speicherplatz vorhanden."
      },
    ],
  },
];

export default function PlanningChecklistScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tipModal, setTipModal] = useState<{ visible: boolean; title: string; tip: string }>({
    visible: false,
    title: "",
    tip: "",
  });

  const { droneId, latitude, longitude, locationName, countryIso, mapUrl, plannedDate, plannedTime, forecastWeather, limits, maxAltitude, isFpvFlight, fpvMode, sessionId, editMode, existingChecked } = route.params;
  const effectiveFpvMode: "spotter" | "verband30m" = fpvMode ?? "spotter";

  useEffect(() => {
    if (editMode && Array.isArray(existingChecked)) {
      setChecked(new Set(existingChecked));
      return;
    }
    // Wer hier landet, hat den Wetter-Screen + Standort/Restriktionen/NOTAM-Flow
    // bereits durchlaufen — also alle vier Vorab-Items vorhaken.
    const autoCheckItems = ["route", "airspace", "notams", "weather"];
    setChecked(prev => new Set([...prev, ...autoCheckItems]));
  }, [editMode, existingChecked]);

  const fpvSection: CheckSection = effectiveFpvMode === "verband30m"
    ? {
        title: "FPV nach Verbandsregel (DMFV/DMO)",
        icon: "shield",
        items: [
          {
            id: "verband_height_planning_30m",
            label: "Flughöhe in der Planung auf max. 30 m AGL festgelegt",
            required: true,
            tip: "LBA-Verbandsbetriebserlaubnis nach Art. 16 EU-VO 2019/947: FPV ohne Spotter ist nur bis 30 m über Grund zulässig. Höhenlimit muss vor dem Flug in der Hersteller-App/Drohne gesetzt sein.",
          },
          {
            id: "verband_member_card_planned",
            label: "Verbandsausweis (DMFV/DMO) wird mitgeführt",
            required: true,
            tip: "Mitgliedschaft/Versicherungsbestätigung digital oder ausgedruckt mitnehmen — wird bei Polizeikontrolle verlangt.",
          },
        ],
      }
    : {
        title: "FPV-Flug",
        icon: "eye",
        items: [
          {
            id: "spotter_confirmed",
            label: "Spotter organisiert und bestätigt",
            required: true,
            tip: "Bei FPV-Flügen ist ein Spotter gesetzlich vorgeschrieben. Der Spotter muss die Drohne jederzeit im Blick haben und per Funk/Sprache erreichbar sein.",
          },
          {
            id: "spotter_briefed",
            label: "Spotter über Fluggebiet und Notfallprozeduren informiert",
            required: true,
            tip: "Besprich mit dem Spotter: Flugroute, Notfall-Signale, Übernahme bei Problemen, Hindernisse in der Umgebung.",
          },
        ],
      };

  const activeChecklist = isFpvFlight 
    ? [...PLANNING_CHECKLIST, fpvSection] 
    : PLANNING_CHECKLIST;

  const blockingRequiredItems = activeChecklist.flatMap(s =>
    s.items.filter(i => i.required && !i.deferrable),
  );
  const allRequiredChecked = blockingRequiredItems.every(item => checked.has(item.id));
  const hasDeferrableItems = activeChecklist.some(s => s.items.some(i => i.deferrable));

  const toggleItem = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        
      }
      return next;
    });
  };

  const showTip = (title: string, tip: string) => {
    
    setTipModal({ visible: true, title, tip });
  };

  const handleContinue = async () => {
    const presentedItemIds = activeChecklist.flatMap(s => s.items.map(i => i.id));
    if (editMode) {
      try {
        const existing = await getFlightSession(sessionId);
        await updateFlightSession(sessionId, {
          planning: {
            ...(existing?.planning ?? {}),
            plannedDate,
            plannedTime,
            forecastWeather,
            maxAltitude,
            checklistCompleted: Array.from(checked),
            checklistPresented: presentedItemIds,
            isFpvFlight: isFpvFlight || false,
          } as any,
        });
        
        navigation.getParent()?.goBack();
      } catch (e) {
        Alert.alert("Fehler", "Änderungen konnten nicht gespeichert werden.");
      }
      return;
    }
    navigation.navigate("PlanningResult", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      mapUrl,
      plannedDate,
      plannedTime,
      forecastWeather,
      limits,
      maxAltitude,
      checklistCompleted: Array.from(checked),
      checklistPresented: presentedItemIds,
      isFpvFlight,
      fpvMode: isFpvFlight ? effectiveFpvMode : undefined,
      sessionId,
    });
  };

  const handleCancel = () => {
    Alert.alert(
      "Planung abbrechen",
      "Möchtest du die Flugplanung wirklich abbrechen?",
      [
        { text: "Nein", style: "cancel" },
        { 
          text: "Ja", 
          style: "destructive", 
          onPress: async () => {
            try {
              if (sessionId) {
                await deleteFlightSession(sessionId);
              }
              navigation.getParent()?.goBack();
            } catch (error) {
              console.error("Failed to delete session:", error);
              Alert.alert("Fehler", "Session konnte nicht gelöscht werden.");
            }
          }
        },
      ]
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText style={styles.title}>Vorab-Checkliste</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            Prüfe diese Punkte vor dem Flugtag
          </ThemedText>
        </View>

        {activeChecklist.map((section) => {
          const sectionDeferrable = section.items.every(i => i.deferrable);
          return (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon} size={18} color={theme.primary} />
              <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
            </View>
            {sectionDeferrable ? (
              <ThemedText style={[styles.sectionHint, { color: theme.textTertiary }]}>
                Diese Punkte können auch später (vor dem Flug) erledigt und abgehakt werden.
              </ThemedText>
            ) : null}
            <Card style={styles.sectionCard}>
              {section.items.map((item, itemIndex) => (
                <View
                  key={item.id}
                  style={[
                    styles.checkItem,
                    itemIndex < section.items.length - 1 && {
                      borderBottomWidth: 1,
                      borderBottomColor: theme.border,
                    },
                  ]}
                >
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
                </View>
              ))}
            </Card>
          </View>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Abbrechen"
          onPress={handleCancel}
          variant="secondary"
          style={{ flex: 1 }}
        />
        <Button
          title={editMode ? "Änderungen speichern" : "Planung speichern"}
          onPress={handleContinue}
          disabled={!allRequiredChecked}
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
  sectionHint: {
    ...Typography.caption,
    marginLeft: Spacing.xs,
    marginBottom: Spacing.sm,
    fontStyle: "italic",
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
});
