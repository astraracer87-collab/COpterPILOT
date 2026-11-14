import { openLink } from "@/lib/webBrowser";
import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList, Pressable, Alert, Linking, Platform } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors } from "@/constants/theme";
import {
  getDrones,
  deleteDrone,
  getSelectedDroneId,
  setSelectedDroneId,
  getComplianceStatus,
  getActiveSessions,
  getFlightCountsForDrones,
  getPilotProfile,
  DroneProfile,
  PilotProfile,
} from "@/lib/storage";
import { findPresetForDrone, DronePreset, DRONE_TYPE_INFO, LICENSE_LEVEL_LABELS, CONSTRAINT_LABELS } from "@/lib/dronePresets";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "@/lib/webBrowser";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

const COMPLIANCE_COLORS = {
  green: Colors.light.statusGo,
  yellow: Colors.light.statusCaution,
  red: Colors.light.statusNoGo,
};

export default function DronesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeDroneIds, setActiveDroneIds] = useState<Set<string>>(new Set());
  const [flightCounts, setFlightCounts] = useState<Record<string, number>>({});
  const [pilot, setPilot] = useState<PilotProfile | null>(null);
  const [expandedSpecsId, setExpandedSpecsId] = useState<string | null>(null);

  const openManualUrl = async (url: string) => {
    if (Platform.OS === "web") {
      openLink(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  const loadDrones = useCallback(async () => {
    const [dronesList, selected, activeSessions, pilotProfile] = await Promise.all([
      getDrones(),
      getSelectedDroneId(),
      getActiveSessions(),
      getPilotProfile(),
    ]);
    setDrones(dronesList);
    setSelectedId(selected);
    setPilot(pilotProfile);
    const activeIds = new Set(activeSessions.map(s => s.droneId));
    setActiveDroneIds(activeIds);
    const counts = await getFlightCountsForDrones(dronesList.map(d => d.id));
    setFlightCounts(counts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDrones();
    }, [loadDrones])
  );

  const handleSelect = async (drone: DroneProfile) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setSelectedDroneId(drone.id);
    setSelectedId(drone.id);
  };

  const handleDelete = (drone: DroneProfile) => {
    Alert.alert(
      "Drohne löschen",
      `Möchten Sie "${drone.name}" wirklich löschen?`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            await deleteDrone(drone.id);
            await loadDrones();
          },
        },
      ]
    );
  };

  const renderDrone = ({ item }: { item: DroneProfile }) => {
    const isSelected = item.id === selectedId;
    const hasActiveBriefing = activeDroneIds.has(item.id);
    const complianceStatus = getComplianceStatus(item, pilot || undefined);
    const complianceColor = COMPLIANCE_COLORS[complianceStatus];
    const preset = findPresetForDrone(item.name, item.manufacturer, item.model);
    const isSpecsExpanded = expandedSpecsId === item.id;

    const toggleSpecs = () => {
      setExpandedSpecsId(isSpecsExpanded ? null : item.id);
    };

    return (
      <Card
        style={[
          styles.droneCard,
          isSelected && { borderColor: theme.primary, borderWidth: 2 },
        ]}
        onPress={() => handleSelect(item)}
      >
        <View style={styles.droneHeader}>
          <View style={[styles.droneIconContainer, { backgroundColor: theme.backgroundSecondary }]}>
            <MaterialCommunityIcons name="quadcopter" size={24} color={theme.primary} />
          </View>
          <View style={styles.droneInfo}>
            <View style={styles.nameRow}>
              <ThemedText style={styles.droneName}>{item.name}</ThemedText>
              {hasActiveBriefing ? (
                <View style={[styles.selectedBadge, { backgroundColor: theme.statusCaution }]}>
                  <ThemedText style={styles.selectedText}>Aktiv</ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText style={[styles.droneDetails, { color: theme.textSecondary }]}>
              {item.classMark} | {item.mtomGrams}g | {item.openCategory} | {flightCounts[item.id] || 0} {(flightCounts[item.id] || 0) === 1 ? "Flug" : "Flüge"}
            </ThemedText>
            {item.manufacturer || item.model ? (
              <ThemedText style={[styles.droneModel, { color: theme.textTertiary }]}>
                {[item.manufacturer, item.model].filter(Boolean).join(" ")}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.droneActions}>
            <View
              style={[styles.complianceDot, { backgroundColor: complianceColor }]}
            />
            {preset ? (
              <Pressable
                onPress={toggleSpecs}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}
                testID={`button-specs-${item.id}`}
              >
                <Feather name={isSpecsExpanded ? "chevron-up" : "info"} size={18} color={theme.primary} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => navigation.navigate("DroneHistory", { droneId: item.id })}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="file-text" size={18} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate("DroneSetup", { droneId: item.id })}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="edit-2" size={18} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => handleDelete(item)}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.pressed,
              ]}
            >
              <Feather name="trash-2" size={18} color={Colors.light.statusNoGo} />
            </Pressable>
          </View>
        </View>
        {isSpecsExpanded && preset ? (
          <View style={[styles.specsPanel, { borderTopColor: theme.border }]}>
            <ThemedText style={[styles.specsSectionTitle, { color: theme.primary }]}>
              Technische Daten
            </ThemedText>
            <View style={styles.specsGrid}>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>MTOM</ThemedText>
                <ThemedText style={styles.specValue}>{preset.mtomGrams} g</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>EU-Klasse</ThemedText>
                <ThemedText style={styles.specValue}>{preset.classMark === "legacy" ? "Bestandsdrohne" : preset.classMark}</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Max. Wind</ThemedText>
                <ThemedText style={styles.specValue}>{preset.maxWindMs} m/s</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Min. Temp.</ThemedText>
                <ThemedText style={styles.specValue}>{preset.minTemp} °C</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Typ</ThemedText>
                <ThemedText style={styles.specValue}>{DRONE_TYPE_INFO[preset.droneType]?.label || preset.droneType}</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Remote ID</ThemedText>
                <ThemedText style={[styles.specValue, { color: preset.hasRemoteId ? theme.statusGo : Colors.light.statusNoGo }]}>
                  {preset.hasRemoteId ? "Ja" : "Nein"}
                </ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Lidar</ThemedText>
                <ThemedText style={styles.specValue}>{preset.hasLidar ? "Ja" : "Nein"}</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>120m-Sperre</ThemedText>
                <ThemedText style={styles.specValue}>{preset.altitudeLocked120m ? "Ja" : "Nein"}</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Baujahr</ThemedText>
                <ThemedText style={styles.specValue}>{preset.year}</ThemedText>
              </View>
              <View style={styles.specRow}>
                <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Min. Lizenz</ThemedText>
                <ThemedText style={styles.specValue}>{LICENSE_LEVEL_LABELS[preset.minLicenseLevel]}</ThemedText>
              </View>
              {preset.notes ? (
                <View style={styles.specRow}>
                  <ThemedText style={[styles.specLabel, { color: theme.textSecondary }]}>Hinweis</ThemedText>
                  <ThemedText style={styles.specValue}>{preset.notes}</ThemedText>
                </View>
              ) : null}
            </View>
            <View style={[styles.constraintBox, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="alert-circle" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.constraintText, { color: theme.textSecondary }]}>
                {CONSTRAINT_LABELS[preset.constraintId]}
              </ThemedText>
            </View>
            {preset.manualUrl ? (
              <Pressable
                onPress={() => openManualUrl(preset.manualUrl!)}
                style={({ pressed }) => [
                  styles.manualButton,
                  { backgroundColor: theme.backgroundSecondary },
                  pressed && styles.pressed,
                ]}
                testID={`button-manual-${item.id}`}
              >
                <Feather name="external-link" size={16} color={theme.primary} />
                <ThemedText style={[styles.manualButtonText, { color: theme.primary }]}>
                  Handbuch & Downloads
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Card>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="airplay" size={48} color={theme.textTertiary} />
      <ThemedText style={[styles.emptyTitle, { marginTop: Spacing.lg }]}>
        Keine Drohnen
      </ThemedText>
      <ThemedText style={[styles.emptyText, { color: theme.textSecondary }]}>
        Fügen Sie Ihre erste Drohne hinzu, um drohnenspezifische Wettergrenzen und Compliance-Checks zu aktivieren.
      </ThemedText>
      <Button
        title="Drohne hinzufügen"
        onPress={() => navigation.navigate("DroneSetup", {})}
        style={{ marginTop: Spacing.xl }}
      />
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={drones}
        keyExtractor={(item) => item.id}
        renderItem={renderDrone}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        ListEmptyComponent={renderEmpty}
        ListHeaderComponent={
          drones.length > 0 ? (
            <View style={styles.header}>
              <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                MEINE DROHNEN
              </ThemedText>
              <Pressable
                onPress={() => navigation.navigate("DroneSetup", {})}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View style={[styles.addButton, { backgroundColor: theme.primary }]}>
                  <Feather name="plus" size={20} color="#FFF" />
                </View>
              </Pressable>
            </View>
          ) : null
        }
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
    flexGrow: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginLeft: Spacing.xs,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  droneCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  droneHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  droneIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
  },
  droneInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  droneName: {
    ...Typography.h4,
  },
  selectedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  selectedText: {
    ...Typography.caption,
    color: "#FFF",
    fontWeight: "600",
  },
  droneDetails: {
    ...Typography.body,
    marginTop: Spacing.xs,
  },
  droneModel: {
    ...Typography.small,
    marginTop: 2,
  },
  droneActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  complianceDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  actionButton: {
    padding: Spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["3xl"],
  },
  emptyTitle: {
    ...Typography.h3,
    textAlign: "center",
  },
  emptyText: {
    ...Typography.body,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  specsPanel: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  specsSectionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    marginBottom: Spacing.sm,
    letterSpacing: 0.5,
  },
  specsGrid: {
    gap: Spacing.xs,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
  },
  specLabel: {
    ...Typography.small,
    flex: 1,
  },
  specValue: {
    ...Typography.small,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
  },
  manualButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
  },
  manualButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  constraintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
  },
  constraintText: {
    ...Typography.small,
    flex: 1,
    lineHeight: 18,
  },
});
