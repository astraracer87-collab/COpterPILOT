import React, { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable, TextInput, Modal, RefreshControl, Alert } from "react-native";
import { useRoute, RouteProp, useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { getDroneHistory, addDroneHistoryEntry, deleteDroneHistoryEntry, getDrone, getFlightCountForDrone, DroneHistoryEntry } from "@/lib/storage";

type EventType = "repair" | "inspection" | "cleaning" | "rotor_change" | "damage" | "replacement" | "other";

const EVENT_TYPES: { type: EventType; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { type: "repair", label: "Reparatur", icon: "tool" },
  { type: "inspection", label: "Inspektion", icon: "search" },
  { type: "cleaning", label: "Reinigung", icon: "droplet" },
  { type: "rotor_change", label: "Rotorwechsel", icon: "refresh-cw" },
  { type: "damage", label: "Beschädigung", icon: "alert-triangle" },
  { type: "replacement", label: "Austausch", icon: "repeat" },
  { type: "other", label: "Sonstiges", icon: "edit-3" },
];

interface DroneHistoryParams {
  droneId: string;
}

export default function DroneHistoryScreen() {
  const route = useRoute<RouteProp<{ params: DroneHistoryParams }, "params">>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DroneHistoryEntry[]>([]);
  const [droneName, setDroneName] = useState("");
  const [flightCount, setFlightCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<EventType>("repair");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const { droneId } = route.params;

  const loadData = useCallback(async () => {
    try {
      const [history, drone, count] = await Promise.all([
        getDroneHistory(droneId),
        getDrone(droneId),
        getFlightCountForDrone(droneId),
      ]);
      setEntries(history);
      setDroneName(drone?.name || "Drohne");
      setFlightCount(count);
    } catch (error) {
      console.error("Failed to load drone history:", error);
    } finally {
      setLoading(false);
    }
  }, [droneId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleAddEntry = async () => {
    if (!description.trim()) {
      Alert.alert("Fehler", "Bitte gib eine Beschreibung ein.");
      return;
    }

    setSaving(true);
    try {
      await addDroneHistoryEntry(droneId, {
        eventType: selectedType,
        description: description.trim(),
        date: new Date().toISOString(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      setDescription("");
      setSelectedType("repair");
      await loadData();
    } catch (error) {
      Alert.alert("Fehler", "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = (entryId: string) => {
    Alert.alert(
      "Eintrag löschen",
      "Möchtest du diesen Eintrag wirklich löschen?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            await deleteDroneHistoryEntry(droneId, entryId);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await loadData();
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const getEventConfig = (type: EventType) => {
    return EVENT_TYPES.find(e => e.type === type) || EVENT_TYPES[6];
  };

  const renderItem = useCallback(
    ({ item, index }: { item: DroneHistoryEntry; index: number }) => {
      const config = getEventConfig(item.eventType as EventType);
      
      return (
        <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
          <Card style={styles.entryCard}>
            <View style={styles.entryHeader}>
              <View style={[styles.iconContainer, { backgroundColor: theme.primary + "15" }]}>
                <Feather name={config.icon} size={18} color={theme.primary} />
              </View>
              <View style={styles.entryInfo}>
                <ThemedText style={styles.entryType}>{config.label}</ThemedText>
                <ThemedText style={[styles.entryDate, { color: theme.textSecondary }]}>
                  {formatDate(item.date)}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => handleDeleteEntry(item.id)}
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                <Feather name="trash-2" size={18} color={theme.textTertiary} />
              </Pressable>
            </View>
            <ThemedText style={[styles.entryDescription, { color: theme.textSecondary }]}>
              {item.description}
            </ThemedText>
          </Card>
        </Animated.View>
      );
    },
    [theme]
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: theme.primary + "15" }]}>
        <Feather name="file-text" size={48} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>Keine Einträge</ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Dokumentiere Wartungen und Ereignisse für {droneName}
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
          entries.length === 0 && styles.emptyList,
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <Card style={styles.flightCountCard}>
            <View style={styles.flightCountRow}>
              <Feather name="navigation" size={18} color={theme.primary} />
              <ThemedText style={styles.flightCountText}>
                {flightCount} {flightCount === 1 ? "Flug" : "Flüge"} absolviert
              </ThemedText>
            </View>
          </Card>
        }
        ListEmptyComponent={renderEmpty}
      />

      <View style={[styles.fabContainer, { bottom: insets.bottom + 80 }]}>
        <Pressable
          onPress={() => setModalVisible(true)}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: theme.primary },
            pressed && { opacity: 0.9 },
          ]}
        >
          <Feather name="plus" size={24} color="#fff" />
        </Pressable>
      </View>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <ThemedView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>Neuer Eintrag</ThemedText>
            <Pressable onPress={() => setModalVisible(false)}>
              <Feather name="x" size={24} color={theme.text} />
            </Pressable>
          </View>

          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            Ereignistyp
          </ThemedText>
          <View style={styles.typeGrid}>
            {EVENT_TYPES.map((eventType) => (
              <Pressable
                key={eventType.type}
                onPress={() => {
                  setSelectedType(eventType.type);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={[
                  styles.typeButton,
                  {
                    backgroundColor: selectedType === eventType.type 
                      ? theme.primary 
                      : theme.backgroundSecondary,
                  },
                ]}
              >
                <Feather
                  name={eventType.icon}
                  size={18}
                  color={selectedType === eventType.type ? "#fff" : theme.text}
                />
                <ThemedText
                  style={[
                    styles.typeLabel,
                    { color: selectedType === eventType.type ? "#fff" : theme.text },
                  ]}
                >
                  {eventType.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <ThemedText style={[styles.label, { color: theme.textSecondary, marginTop: Spacing.xl }]}>
            Beschreibung
          </ThemedText>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Was wurde gemacht?"
            placeholderTextColor={theme.textTertiary}
            multiline
            numberOfLines={4}
            style={[
              styles.textInput,
              {
                backgroundColor: theme.backgroundSecondary,
                color: theme.text,
                borderColor: theme.border,
              },
            ]}
          />

          <View style={styles.modalActions}>
            <Button
              title="Abbrechen"
              onPress={() => setModalVisible(false)}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              title="Speichern"
              onPress={handleAddEntry}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
  },
  entryCard: {
    padding: Spacing.lg,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  entryInfo: {
    flex: 1,
  },
  entryType: {
    ...Typography.body,
    fontWeight: "600",
  },
  entryDate: {
    ...Typography.caption,
  },
  entryDescription: {
    ...Typography.body,
    marginLeft: 52,
  },
  emptyContainer: {
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    ...Typography.h3,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    textAlign: "center",
  },
  fabContainer: {
    position: "absolute",
    right: Spacing.lg,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalContainer: {
    flex: 1,
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xl,
  },
  modalTitle: {
    ...Typography.h2,
  },
  label: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  typeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
  },
  typeLabel: {
    ...Typography.caption,
    fontWeight: "600",
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: "top",
  },
  modalActions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: "auto",
    paddingTop: Spacing.xl,
  },
  flightCountCard: {
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  flightCountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  flightCountText: {
    ...Typography.body,
    fontWeight: "600",
  },
});
