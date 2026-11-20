import React, { useState, useCallback } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { View, StyleSheet, FlatList, Pressable, TextInput, Modal, RefreshControl, Alert } from "react-native";
import { useRoute, RouteProp, useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { getDroneHistory, addDroneHistoryEntry, deleteDroneHistoryEntry, getDrone, getFlightCountForDrone, getLogbook, DroneHistoryEntry, LogbookEntry } from "@/lib/storage";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavProp = NativeStackNavigationProp<SettingsStackParamList>;

type EventType = "repair" | "inspection" | "cleaning" | "rotor_change" | "damage" | "replacement" | "hard_landing" | "crash_landing" | "other";

const EVENT_TYPES: { type: EventType; label: string; icon: keyof typeof Feather.glyphMap; auto?: boolean }[] = [
  { type: "repair", label: "Reparatur", icon: "tool" },
  { type: "inspection", label: "Inspektion", icon: "search" },
  { type: "cleaning", label: "Reinigung", icon: "droplet" },
  { type: "rotor_change", label: "Rotorwechsel", icon: "refresh-cw" },
  { type: "damage", label: "Beschädigung", icon: "alert-triangle" },
  { type: "replacement", label: "Austausch", icon: "repeat" },
  { type: "hard_landing", label: "Hard Landing", icon: "alert-triangle", auto: true },
  { type: "crash_landing", label: "Crash Landing", icon: "alert-octagon", auto: true },
  { type: "other", label: "Sonstiges", icon: "edit-3" },
];

// Manuelle Auswahl im "Neuer Eintrag"-Modal — Hard/Crash Landing werden
// automatisch beim Debriefing eingetragen und sollen nicht manuell wählbar sein.
const MANUAL_EVENT_TYPES = EVENT_TYPES.filter((t) => !t.auto);

interface DroneHistoryParams {
  droneId: string;
}

type TimelineItem =
  | { kind: "event"; date: string; entry: DroneHistoryEntry }
  | { kind: "flight"; date: string; flight: LogbookEntry };

export default function DroneHistoryScreen() {
  const keyboardInset = useKeyboardInset();
  const route = useRoute<RouteProp<{ params: DroneHistoryParams }, "params">>();
  const navigation = useNavigation<NavProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<DroneHistoryEntry[]>([]);
  const [flights, setFlights] = useState<LogbookEntry[]>([]);
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
      const [history, drone, count, allLogbook] = await Promise.all([
        getDroneHistory(droneId),
        getDrone(droneId),
        getFlightCountForDrone(droneId),
        getLogbook(),
      ]);
      setEntries(history);
      setFlights(allLogbook.filter((e) => e.droneId === droneId));
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

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isLandingEvent = (type: EventType) => type === "hard_landing" || type === "crash_landing";

  const getEventConfig = (type: EventType) => {
    return EVENT_TYPES.find(e => e.type === type) || EVENT_TYPES[EVENT_TYPES.length - 1];
  };

  const getEventColor = (type: EventType): string => {
    if (type === "crash_landing") return theme.statusNoGo;
    if (type === "hard_landing" || type === "damage") return theme.statusCaution;
    return theme.primary;
  };

  const handleOpenProtocol = (item: DroneHistoryEntry) => {
    if (!item.sessionId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("LogbookEntryDetail", { sessionId: item.sessionId });
  };

  const handleOpenFlight = (entry: LogbookEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("LogbookEntryDetail", { logbookEntryId: entry.id });
  };

  const timeline: TimelineItem[] = React.useMemo(() => {
    const items: TimelineItem[] = [
      ...flights.map<TimelineItem>((f) => ({ kind: "flight", date: f.flightDate || f.createdAt, flight: f })),
      ...entries.map<TimelineItem>((e) => ({ kind: "event", date: e.date, entry: e })),
    ];
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [flights, entries]);

  const renderFlightItem = (flight: LogbookEntry, index: number) => {
    const flightStatusColor =
      flight.status === "nogo" ? theme.statusNoGo : flight.status === "caution" ? theme.statusCaution : theme.statusGo;
    const incident = flight.incidentOccurred;
    const accent = incident ? theme.statusCaution : flightStatusColor;
    const duration = flight.flightDurationMinutes;
    const tt = flight.takeoffTime;
    const lt = flight.landingTime;

    return (
      <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
        <Card style={styles.entryCard} onPress={() => handleOpenFlight(flight)}>
          <View style={styles.entryHeader}>
            <View style={[styles.iconContainer, { backgroundColor: accent + "15" }]}>
              <Feather name={incident ? "alert-triangle" : "navigation"} size={18} color={accent} />
            </View>
            <View style={styles.entryInfo}>
              <ThemedText style={[styles.entryType, { color: accent }]}>
                Flug{flight.status ? ` · ${flight.status === "nogo" ? "NO-GO" : flight.status === "caution" ? "CAUTION" : "GO"}` : ""}
              </ThemedText>
              <View style={styles.metaRow}>
                <Feather name="calendar" size={11} color={theme.textTertiary} />
                <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>
                  {formatDate(flight.flightDate || flight.createdAt)}
                </ThemedText>
                {tt ? (
                  <>
                    <Feather name="clock" size={11} color={theme.textTertiary} style={{ marginLeft: 4 }} />
                    <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>
                      {tt}{lt ? `–${lt}` : ""}{duration ? ` (${duration}min)` : ""}
                    </ThemedText>
                  </>
                ) : null}
              </View>
            </View>
            <Feather name="chevron-right" size={18} color={theme.textTertiary} />
          </View>

          {flight.locationName ? (
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={12} color={theme.textSecondary} />
              <ThemedText style={[styles.locationText, { color: theme.textSecondary }]} numberOfLines={1}>
                {flight.locationName}
              </ThemedText>
            </View>
          ) : null}

          {incident && flight.incidentDescription ? (
            <ThemedText style={[styles.entryDescription, { color: theme.statusCaution }]} numberOfLines={2}>
              Vorfall: {flight.incidentDescription}
            </ThemedText>
          ) : null}
        </Card>
      </Animated.View>
    );
  };

  const renderEventItem = ({ item, index }: { item: DroneHistoryEntry; index: number }) => {
      const eventType = item.eventType as EventType;
      const config = getEventConfig(eventType);
      const accent = getEventColor(eventType);
      const tappable = isLandingEvent(eventType) && !!item.sessionId;

      const inner = (
        <>
          <View style={styles.entryHeader}>
            <View style={[styles.iconContainer, { backgroundColor: accent + "15" }]}>
              <Feather name={config.icon} size={18} color={accent} />
            </View>
            <View style={styles.entryInfo}>
              <ThemedText style={[styles.entryType, { color: accent }]}>{config.label}</ThemedText>
              <View style={styles.metaRow}>
                <Feather name="calendar" size={11} color={theme.textTertiary} />
                <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>
                  {formatDate(item.date)}
                </ThemedText>
                <Feather name="clock" size={11} color={theme.textTertiary} style={{ marginLeft: 4 }} />
                <ThemedText style={[styles.metaText, { color: theme.textTertiary }]}>
                  {formatTime(item.date)}
                </ThemedText>
              </View>
            </View>
            <Pressable
              onPress={() => handleDeleteEntry(item.id)}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.7 }}
            >
              <Feather name="trash-2" size={18} color={theme.textTertiary} />
            </Pressable>
          </View>

          {item.locationName ? (
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={12} color={theme.textSecondary} />
              <ThemedText style={[styles.locationText, { color: theme.textSecondary }]} numberOfLines={1}>
                {item.locationName}
              </ThemedText>
            </View>
          ) : null}

          {item.description ? (
            <ThemedText style={[styles.entryDescription, { color: theme.textSecondary }]}>
              {item.description}
            </ThemedText>
          ) : null}

          {tappable ? (
            <View style={[styles.protocolHint, { borderTopColor: theme.border }]}>
              <Feather name="file-text" size={13} color={theme.primary} />
              <ThemedText style={[styles.protocolHintText, { color: theme.primary }]}>
                Vollständiges Flugprotokoll öffnen
              </ThemedText>
              <Feather name="chevron-right" size={16} color={theme.primary} />
            </View>
          ) : null}
        </>
      );

      return (
        <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
          {tappable ? (
            <Card style={styles.entryCard} onPress={() => handleOpenProtocol(item)}>
              {inner}
            </Card>
          ) : (
            <Card style={styles.entryCard}>{inner}</Card>
          )}
        </Animated.View>
      );
  };

  const renderTimelineItem = ({ item, index }: { item: TimelineItem; index: number }) => {
    if (item.kind === "flight") return renderFlightItem(item.flight, index);
    return renderEventItem({ item: item.entry, index });
  };

  const timelineKey = (item: TimelineItem) =>
    item.kind === "flight" ? `f-${item.flight.id}` : `e-${item.entry.id}`;

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: theme.primary + "15" }]}>
        <Feather name="file-text" size={48} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>Keine Einträge</ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Noch keine Flüge oder Wartungen für {droneName} dokumentiert.
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={timeline}
        keyExtractor={timelineKey}
        renderItem={renderTimelineItem}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
          timeline.length === 0 && styles.emptyList,
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <Card style={styles.flightCountCard}>
            <View style={styles.flightCountRow}>
              <Feather name="navigation" size={18} color={theme.primary} />
              <ThemedText style={styles.flightCountText}>
                {flightCount} {flightCount === 1 ? "Flug" : "Flüge"} · {entries.length} {entries.length === 1 ? "Wartung" : "Wartungen"}
              </ThemedText>
            </View>
          </Card>
        }
        ListEmptyComponent={renderEmpty}
      />

      <View style={[styles.fabContainer, { bottom: insets.bottom + Spacing.lg }]}>
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
        <ThemedView style={[styles.modalContainer, { paddingBottom: keyboardInset }]}>
          <KeyboardAwareScrollViewCompat bottomOffset={24} contentContainerStyle={{ flexGrow: 1 }}>
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
            {MANUAL_EVENT_TYPES.map((eventType) => (
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
          <TextInput disableFullscreenUI
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
          </KeyboardAwareScrollViewCompat>
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
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  metaText: {
    ...Typography.caption,
    fontSize: 11,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 52,
    marginTop: -4,
    marginBottom: Spacing.xs,
  },
  locationText: {
    ...Typography.caption,
    flex: 1,
  },
  entryDescription: {
    ...Typography.body,
    marginLeft: 52,
    lineHeight: 20,
  },
  protocolHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
  },
  protocolHintText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
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
