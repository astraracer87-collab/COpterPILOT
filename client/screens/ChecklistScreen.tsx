import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useNavigation, useRoute, CommonActions } from "@react-navigation/native";
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
import { getDrone, DroneProfile, BatteryUsage } from "@/lib/storage";
import BatterySelectionBlock from "@/components/BatterySelectionBlock";
import type { FlightCheckParamList } from "@/navigation/FlightCheckNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { InfoDialog } from "@/components/InfoDialog";
import { ChecklistRow } from "@/components/ChecklistRow";
import { useChecklistState, checklistHaptic } from "@/hooks/useChecklistState";

type NavigationProp = NativeStackNavigationProp<FlightCheckParamList, "Checklist">;
type RootNavProp = NativeStackNavigationProp<RootStackParamList>;
type RouteParams = RouteProp<FlightCheckParamList, "Checklist">;

interface CheckItem {
  id: string;
  label: string;
  required: boolean;
  tip: string;
  excludeForClasses?: string[];
}

interface CheckSection {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: CheckItem[];
}

const CHECKLIST_SECTIONS: CheckSection[] = [
  {
    title: "Mission / Plan",
    icon: "map",
    items: [
      { 
        id: "location", 
        label: "Start-/Landeplatz bestätigt", 
        required: true,
        tip: "Überprüfe den gewählten Platz vor Ort: eben, hindernisfrei, mindestens 3m Radius. Achte auf Bodenbeschaffenheit und gute Sicht zum Fluggebiet."
      },
      { 
        id: "rth", 
        label: "RTH-Höhe korrekt gesetzt", 
        required: true,
        tip: "Return-to-Home Höhe sollte höher als alle Hindernisse im Fluggebiet sein. Typisch 30-50m über dem höchsten Hindernis."
      },
      { 
        id: "failsafe", 
        label: "Failsafe in App geprüft", 
        required: true,
        tip: "Prüfe das Verhalten bei Signalverlust: RTH, Hovern oder Landen? Bei starkem Wind ist RTH oft besser als Hovern."
      },
    ],
  },
  {
    title: "Drohne / Technik",
    icon: "cpu",
    items: [
      { 
        id: "props", 
        label: "Propeller fest und unbeschädigt", 
        required: true,
        tip: "Prüfe alle Propeller auf Risse, Kerben und Verbiegungen. Auch kleine Schäden beeinträchtigen Flugeigenschaften."
      },
      { 
        id: "gps", 
        label: "GNSS-Fix stabil (10+ Sats)", 
        required: true,
        tip: "Warte auf mindestens 10+ Satelliten für stabilen Fix. Ohne GPS kein RTH und eingeschränkte Stabilisierung."
      },
      { 
        id: "gimbal", 
        label: "Gimbal / Kamera geprüft", 
        required: false,
        tip: "Entferne Gimbalschutz vor dem Start. Prüfe ob sich Gimbal frei bewegt. Reinige Linse von Fingerabdrücken."
      },
      { 
        id: "motors", 
        label: "Motoren auf Fremdkörper prüfen", 
        required: true,
        tip: "Prüfe visuell auf Gras, Haare oder Schmutz in den Motorgehäusen. Drehe die Propeller manuell - sie sollten sich frei drehen."
      },
    ],
  },
  {
    title: "Umgebung / Safety",
    icon: "shield",
    items: [
      { 
        id: "weather_now", 
        label: "Aktuelle Wetterbedingungen ok", 
        required: true,
        tip: "Vergleiche die Vorhersage mit den aktuellen Bedingungen vor Ort. Fühlt es windiger an als erwartet?"
      },
      { 
        id: "people", 
        label: "Keine unbeteiligten Personen im Fluggebiet", 
        required: true,
        tip: "Halte in Open Category Abstand zu Unbeteiligten. Plane Ausweichmanöver. Bei unerwarteten Personen: Höhe gewinnen oder Flug abbrechen.",
        excludeForClasses: ["C0"],
      },
      { 
        id: "obstacles", 
        label: "Hindernisse vor Ort identifiziert", 
        required: true,
        tip: "Achte auf: Stromleitungen, Bäume, Masten, Kräne, Vögel. Bei Gegenlicht sind Drähte fast unsichtbar."
      },
      { 
        id: "light", 
        label: "Sichtbedingungen geeignet", 
        required: false,
        tip: "Für VLOS brauchst du die Drohne klar sehen. Bei Gegenlicht Positionslichter nutzen."
      },
    ],
  },
];

const hapticLight = checklistHaptic;

export default function ChecklistScreen() {
  const navigation = useNavigation<NavigationProp>();
  const rootNav = useNavigation<RootNavProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // Lokal + optimistisch: der Haken erscheint im selben Frame (kein Speicherzugriff).
  const { checked, toggle: toggleItem } = useChecklistState(undefined, { onCheck: hapticLight });
  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [batteryUsage, setBatteryUsage] = useState<BatteryUsage[]>([]);
  const [tipModal, setTipModal] = useState<{ visible: boolean; title: string; tip: string }>({
    visible: false,
    title: "",
    tip: "",
  });

  const { latitude, longitude, hasRestrictions, restrictionStatus, restrictionNotes, restrictionVerdict, weatherData, droneId, limits, sessionId, isFpvFlight, fpvMode, kpIndex, kpOfflineFetchedAt } = route.params;
  const effectiveFpvMode: "spotter" | "verband30m" = fpvMode ?? "spotter";

  useEffect(() => {
    if (droneId) {
      getDrone(droneId).then(d => setDrone(d));
    }
  }, [droneId]);

  const fpvSection: CheckSection = useMemo(() => effectiveFpvMode === "verband30m"
    ? {
        title: "FPV nach Verbandsregel (DMFV/DMO)",
        icon: "shield",
        items: [
          {
            id: "verband_height_limited_30m",
            label: "Flughöhe in App/Drohne auf max. 30 m AGL begrenzt",
            required: true,
            tip: "Pflicht laut LBA-Verbandsbetriebserlaubnis (Art. 16 EU-VO 2019/947): Bei FPV ohne Spotter darf die Drohne 30 m über Grund nicht überschreiten. Stelle das Höhenlimit jetzt in der Hersteller-App (DJI Fly etc.) oder direkt am Sender ein.",
          },
          {
            id: "verband_member_card_ready",
            label: "Verbandsausweis (DMFV/DMO) griffbereit",
            required: true,
            tip: "Bei Kontrolle muss die gültige Mitgliedschaft/Versicherungsbestätigung digital oder ausgedruckt vorgezeigt werden.",
          },
          {
            id: "goggles_ready",
            label: "FPV-Brille/Bildschirm betriebsbereit",
            required: true,
            tip: "Akku geladen, Bild klar, keine Interferenzen. Video-Link stabil.",
          },
        ],
      }
    : {
        title: "FPV-Flug",
        icon: "eye",
        items: [
          {
            id: "spotter_present",
            label: "Spotter ist vor Ort und bereit",
            required: true,
            tip: "Der Spotter muss die Drohne jederzeit sehen können und in Kommunikationsreichweite sein.",
          },
          {
            id: "spotter_communication",
            label: "Kommunikation mit Spotter getestet",
            required: true,
            tip: "Testet Funk, Handzeichen oder Zurufmöglichkeit. Vereinbart klare Signale für Notfälle.",
          },
          {
            id: "goggles_ready",
            label: "FPV-Brille/Bildschirm betriebsbereit",
            required: true,
            tip: "Akku geladen, Bild klar, keine Interferenzen. Video-Link stabil.",
          },
        ],
      }, [effectiveFpvMode]);

  const filteredSections = useMemo(() => {
    const droneClass = drone?.classMark || "";
    const baseSections = CHECKLIST_SECTIONS.map(section => ({
      ...section,
      items: section.items.filter(item => {
        if (item.excludeForClasses && item.excludeForClasses.includes(droneClass)) {
          return false;
        }
        return true;
      }),
    })).filter(section => section.items.length > 0);
    
    if (isFpvFlight) {
      return [...baseSections, fpvSection];
    }
    return baseSections;
  }, [drone?.classMark, isFpvFlight, fpvSection]);

  const allRequiredItems = useMemo(
    () => filteredSections.flatMap(s => s.items.filter(i => i.required)),
    [filteredSections],
  );
  const allRequiredChecked = allRequiredItems.every(item => checked.has(item.id));

  const showTip = useCallback((title: string, tip: string) => {
    hapticLight();
    setTipModal({ visible: true, title, tip });
  }, []);
  const toggleConfirm = useCallback(() => toggleItem("confirm"), [toggleItem]);

  const handleContinue = () => {
    const presentedItemIds = filteredSections.flatMap(s => s.items.map(i => i.id));
    navigation.navigate("Results", {
      latitude,
      longitude,
      hasRestrictions,
      restrictionStatus,
      restrictionNotes,
      restrictionVerdict,
      weatherData,
      droneId,
      limits,
      sessionId,
      checklistCompleted: Array.from(checked),
      checklistPresented: presentedItemIds,
      batteryUsage: batteryUsage.length > 0 ? batteryUsage : undefined,
      isFpvFlight,
      fpvMode: isFpvFlight ? effectiveFpvMode : undefined,
      kpIndex,
      kpOfflineFetchedAt,
    });
  };

  const handleCancel = () => {
    Alert.alert(
      "Check abbrechen",
      "Möchten Sie den Pre-Flight Check wirklich abbrechen?",
      [
        { text: "Nein", style: "cancel" },
        { 
          text: "Ja", 
          style: "destructive", 
          onPress: () => {
            // Use CommonActions to dispatch goBack on parent navigator
            const parent = navigation.getParent();
            if (parent) {
              parent.goBack();
            } else {
              // Fallback: navigate to Main
              rootNav.navigate("Main");
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
        {filteredSections.map((section, sectionIndex) => (
          <View key={section.title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Feather name={section.icon} size={18} color={theme.primary} />
              <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
            </View>
            <Card style={styles.sectionCard}>
              {section.items.map((item, itemIndex) => (
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
              ))}
            </Card>
          </View>
        ))}

        {drone?.batteries && drone.batteries.length > 0 ? (
          <BatterySelectionBlock
            batteries={drone.batteries}
            mode="pre"
            onChange={setBatteryUsage}
          />
        ) : null}

        <Card style={[styles.confirmCard, { borderColor: theme.primary }]}>
          <Pressable
            onPress={toggleConfirm}
            style={styles.confirmRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checked.has("confirm") }}
            testID="checklist-row-confirm"
          >
            <View pointerEvents="none">
              <Checkbox checked={checked.has("confirm")} onPress={toggleConfirm} />
            </View>
            <ThemedText style={styles.confirmText}>
              Ich habe die Regeln geprüft und fliege nur, wenn zulässig.
            </ThemedText>
          </Pressable>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Abbrechen"
          onPress={handleCancel}
          variant="secondary"
          style={{ flex: 1 }}
        />
        <Button
          title="Weiter"
          onPress={handleContinue}
          disabled={!allRequiredChecked || !checked.has("confirm")}
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
  confirmCard: {
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  confirmText: {
    ...Typography.body,
    flex: 1,
    fontWeight: "500",
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
});
