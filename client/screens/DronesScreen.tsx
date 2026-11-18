import React, { useCallback, useState } from "react";
import { View, StyleSheet, FlatList, Pressable, Alert, ActivityIndicator } from "react-native";
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
  getArchivedDrones,
  unarchiveDrone,
  deleteDrone,
  getSelectedDroneId,
  setSelectedDroneId,
  getActiveSessions,
  getFlightCountsForDrones,
  getPilotProfile,
  DroneProfile,
  PilotProfile,
} from "@/lib/storage";
import * as Haptics from "@/lib/noHaptics";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import { DocumentPreviewModal } from "@/components/DocumentPreviewModal";
import { DroneCard } from "@/components/DroneCard";
import type { DocumentRef } from "@/lib/documents";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

export default function DronesScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [archivedDrones, setArchivedDrones] = useState<DroneProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeDroneIds, setActiveDroneIds] = useState<Set<string>>(new Set());
  const [flightCounts, setFlightCounts] = useState<Record<string, number>>({});
  const [pilot, setPilot] = useState<PilotProfile | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{ doc: DocumentRef; label: string } | null>(null);

  const loadDrones = useCallback(async () => {
    try {
      const [dronesList, archivedList, selected, activeSessions, pilotProfile] = await Promise.all([
        getDrones(),
        getArchivedDrones(),
        getSelectedDroneId(),
        getActiveSessions(),
        getPilotProfile(),
      ]);
      setDrones(dronesList);
      setArchivedDrones(archivedList);
      setSelectedId(selected);
      setPilot(pilotProfile);
      const activeIds = new Set(activeSessions.map(s => s.droneId));
      setActiveDroneIds(activeIds);
      const allIds = [...dronesList, ...archivedList].map(d => d.id);
      const counts = await getFlightCountsForDrones(allIds);
      setFlightCounts(counts);
    } finally {
      setLoading(false);
    }
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

  const handleUnarchive = async (drone: DroneProfile) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await unarchiveDrone(drone.id);
    await loadDrones();
  };

  const handleDeletePermanent = (drone: DroneProfile) => {
    Alert.alert(
      "Endgültig löschen",
      `"${drone.name}" wird unwiderruflich gelöscht. Das Logbuch behält die historischen Einträge, aber die Drohne selbst kann nicht wiederhergestellt werden.\n\nFortfahren?`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Endgültig löschen",
          style: "destructive",
          onPress: async () => {
            await deleteDrone(drone.id);
            await loadDrones();
          },
        },
      ]
    );
  };

  const renderDrone = ({ item }: { item: DroneProfile }) => (
    <DroneCard
      drone={item}
      pilot={pilot}
      isSelected={item.id === selectedId}
      hasActiveBriefing={activeDroneIds.has(item.id)}
      flightCount={flightCounts[item.id] || 0}
      navigation={navigation}
      onSelect={() => handleSelect(item)}
      onChanged={loadDrones}
      onPreviewDoc={(doc, label) => setPreviewDoc({ doc, label })}
    />
  );

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.emptyContainer} testID="loading-drones">
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.emptyText, { color: theme.textSecondary, marginTop: Spacing.md }]}>
            Drohnen werden geladen …
          </ThemedText>
        </View>
      );
    }
    return (
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
  };

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
        ListFooterComponent={
          archivedDrones.length > 0 ? (
            <View style={styles.archivedSection}>
              <Pressable
                onPress={() => setShowArchived((v) => !v)}
                style={({ pressed }) => [
                  styles.archivedToggle,
                  pressed && styles.pressed,
                ]}
                testID="button-toggle-archived"
              >
                <Feather name="archive" size={16} color={theme.textSecondary} />
                <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginLeft: Spacing.sm }]}>
                  ARCHIVIERTE DROHNEN ({archivedDrones.length})
                </ThemedText>
                <View style={{ flex: 1 }} />
                <Feather
                  name={showArchived ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={theme.textSecondary}
                />
              </Pressable>
              {showArchived
                ? archivedDrones.map((item) => (
                    <Card key={item.id} style={[styles.droneCard, styles.archivedCard]}>
                      <View style={styles.droneHeader}>
                        <View style={[styles.droneIconContainer, { backgroundColor: theme.backgroundSecondary }]}>
                          <MaterialCommunityIcons name="quadcopter" size={24} color={theme.textTertiary} />
                        </View>
                        <View style={styles.droneInfo}>
                          <ThemedText style={[styles.droneName, { color: theme.textSecondary }]}>{item.name}</ThemedText>
                          <ThemedText style={[styles.droneDetails, { color: theme.textTertiary }]}>
                            {item.classMark} | {item.mtomGrams}g | {flightCounts[item.id] || 0} {(flightCounts[item.id] || 0) === 1 ? "Flug" : "Flüge"}
                          </ThemedText>
                          {item.archivedAt ? (
                            <ThemedText style={[styles.droneModel, { color: theme.textTertiary }]}>
                              Archiviert am {new Date(item.archivedAt).toLocaleDateString("de-DE")}
                            </ThemedText>
                          ) : null}
                        </View>
                        <View style={styles.droneActions}>
                          <Pressable
                            onPress={() => handleUnarchive(item)}
                            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                            testID={`button-unarchive-${item.id}`}
                          >
                            <Feather name="rotate-ccw" size={18} color={theme.primary} />
                          </Pressable>
                          <Pressable
                            onPress={() => handleDeletePermanent(item)}
                            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                            testID={`button-delete-${item.id}`}
                          >
                            <Feather name="trash-2" size={18} color={Colors.light.statusNoGo} />
                          </Pressable>
                        </View>
                      </View>
                    </Card>
                  ))
                : null}
            </View>
          ) : null
        }
      />
      <DocumentPreviewModal
        visible={previewDoc !== null}
        onClose={() => setPreviewDoc(null)}
        document={previewDoc?.doc ?? null}
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
  archivedSection: {
    marginTop: Spacing.xl,
  },
  archivedToggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  archivedCard: {
    opacity: 0.75,
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
  droneName: {
    ...Typography.h4,
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
