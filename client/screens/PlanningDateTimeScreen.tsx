import React, { useState, useMemo } from "react";
import { View, StyleSheet, Platform, Pressable, ScrollView } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { FlightPlanningParamList } from "@/navigation/FlightPlanningNavigator";

type NavigationProp = NativeStackNavigationProp<FlightPlanningParamList, "PlanningDateTime">;
type RouteParams = RouteProp<FlightPlanningParamList, "PlanningDateTime">;

export default function PlanningDateTimeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteParams>();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const { droneId, latitude, longitude, locationName, countryIso, radiusKm, routeWaypoints } = route.params;

  const [plannedDate, setPlannedDate] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });
  const [plannedTime, setPlannedTime] = useState<string>(() => {
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    return `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  });
  const [endTime, setEndTime] = useState<string>(() => {
    const now = new Date();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const dateObj = useMemo(() => {
    const d = new Date(plannedDate + "T00:00:00");
    return isNaN(d.getTime()) ? new Date() : d;
  }, [plannedDate]);

  const startTimeObj = useMemo(() => {
    const [h, m] = plannedTime.split(":").map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d;
  }, [plannedTime]);

  const endTimeObj = useMemo(() => {
    const [h, m] = endTime.split(":").map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d;
  }, [endTime]);

  const flightDurationLabel = useMemo(() => {
    const [sh, sm] = plannedTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff <= 0) diff += 1440;
    const dh = Math.floor(diff / 60);
    const dm = diff % 60;
    return `${dh}h${dm > 0 ? ` ${dm}min` : ""}`;
  }, [plannedTime, endTime]);

  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (date) {
      setPlannedDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleStartTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowStartPicker(false);
    if (date) {
      setPlannedTime(`${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleEndTimeChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowEndPicker(false);
    if (date) {
      setEndTime(`${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleContinue = () => {
    navigation.navigate("PlanningRestrictions", {
      droneId,
      latitude,
      longitude,
      locationName,
      countryIso,
      radiusKm,
      plannedDate,
      plannedTime,
      endTime,
      routeWaypoints,
    });
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepIndicator}>
          <View style={[styles.stepBadge, { backgroundColor: theme.primary }]}>
            <ThemedText style={styles.stepBadgeText}>Schritt 2</ThemedText>
          </View>
          <ThemedText style={[styles.stepSubtitle, { color: theme.textSecondary }]}>
            Wann möchtest du fliegen?
          </ThemedText>
        </View>

        <View style={[styles.locationSummary, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
          <Feather name="map-pin" size={16} color={theme.primary} />
          <View style={styles.locationSummaryText}>
            <ThemedText style={[styles.locationSummaryName, { color: theme.text }]} numberOfLines={1}>
              {locationName || "Standort"}
            </ThemedText>
            <ThemedText style={[styles.locationSummaryCoords, { color: theme.textSecondary }]}>
              {latitude.toFixed(4)}, {longitude.toFixed(4)} | {(radiusKm * 1000) >= 1000 ? `${radiusKm.toFixed(1)} km` : `${Math.round(radiusKm * 1000)} m`} Radius
            </ThemedText>
          </View>
        </View>

        <Card style={styles.dateTimeCard}>
          <View style={styles.dateTimeHeader}>
            <Feather name="calendar" size={18} color={theme.primary} />
            <ThemedText style={styles.dateTimeTitle}>Datum</ThemedText>
          </View>

          <Pressable
            onPress={() => { setShowDatePicker(!showDatePicker); setShowStartPicker(false); setShowEndPicker(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[styles.dateButton, { backgroundColor: theme.backgroundSecondary }]}
          >
            <Feather name="calendar" size={16} color={theme.primary} />
            <ThemedText style={[styles.dateButtonText, { color: theme.text }]}>
              {dateObj.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
            </ThemedText>
            <Feather name={showDatePicker ? "chevron-up" : "chevron-down"} size={16} color={theme.textTertiary} />
          </Pressable>
          {showDatePicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={dateObj}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "calendar"}
                onChange={handleDateChange}
                locale="de-DE"
                minimumDate={new Date()}
                themeVariant="dark"
                accentColor={theme.primary}
              />
            </View>
          ) : null}
        </Card>

        <Card style={styles.dateTimeCard}>
          <View style={styles.dateTimeHeader}>
            <Feather name="clock" size={18} color={theme.primary} />
            <ThemedText style={styles.dateTimeTitle}>Flugzeitraum</ThemedText>
          </View>

          <View style={styles.timeRow}>
            <View style={styles.timeGroup}>
              <ThemedText style={[styles.dtLabel, { color: theme.textSecondary }]}>Startzeit</ThemedText>
              <Pressable
                onPress={() => { setShowStartPicker(!showStartPicker); setShowEndPicker(false); setShowDatePicker(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.timeButton, { backgroundColor: theme.backgroundSecondary }]}
              >
                <Feather name="clock" size={14} color={theme.primary} />
                <ThemedText style={[styles.timeButtonText, { color: theme.text }]}>{plannedTime}</ThemedText>
                <Feather name={showStartPicker ? "chevron-up" : "chevron-down"} size={14} color={theme.textTertiary} />
              </Pressable>
            </View>

            <View style={styles.durationBadge}>
              <Feather name="arrow-right" size={12} color={theme.textTertiary} />
              <ThemedText style={[styles.durationText, { color: theme.textSecondary }]}>{flightDurationLabel}</ThemedText>
            </View>

            <View style={styles.timeGroup}>
              <ThemedText style={[styles.dtLabel, { color: theme.textSecondary }]}>Endzeit</ThemedText>
              <Pressable
                onPress={() => { setShowEndPicker(!showEndPicker); setShowStartPicker(false); setShowDatePicker(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                style={[styles.timeButton, { backgroundColor: theme.backgroundSecondary }]}
              >
                <Feather name="clock" size={14} color={theme.primary} />
                <ThemedText style={[styles.timeButtonText, { color: theme.text }]}>{endTime}</ThemedText>
                <Feather name={showEndPicker ? "chevron-up" : "chevron-down"} size={14} color={theme.textTertiary} />
              </Pressable>
            </View>
          </View>

          {showStartPicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={startTimeObj}
                mode="time"
                display="spinner"
                onChange={handleStartTimeChange}
                locale="de-DE"
                minuteInterval={15}
                is24Hour={true}
                themeVariant="dark"
                accentColor={theme.primary}
              />
            </View>
          ) : null}

          {showEndPicker ? (
            <View style={styles.pickerContainer}>
              <DateTimePicker
                value={endTimeObj}
                mode="time"
                display="spinner"
                onChange={handleEndTimeChange}
                locale="de-DE"
                minuteInterval={15}
                is24Hour={true}
                themeVariant="dark"
                accentColor={theme.primary}
              />
            </View>
          ) : null}
        </Card>

        <View style={[styles.durationSummary, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="info" size={16} color={theme.primary} />
          <ThemedText style={[styles.durationSummaryText, { color: theme.textSecondary }]}>
            Geplante Flugdauer: {flightDurationLabel}
          </ThemedText>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: theme.backgroundDefault }]}>
        <Button
          title="Weiter zu Einschränkungen"
          onPress={handleContinue}
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  stepIndicator: {
    marginBottom: Spacing.xl,
  },
  stepBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  stepBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  stepSubtitle: {
    ...Typography.h3,
  },
  locationSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  locationSummaryText: {
    flex: 1,
  },
  locationSummaryName: {
    ...Typography.body,
    fontWeight: "600",
  },
  locationSummaryCoords: {
    ...Typography.caption,
    marginTop: 2,
  },
  dateTimeCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  dateTimeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dateTimeTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  dtLabel: {
    ...Typography.caption,
    marginBottom: 4,
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  dateButtonText: {
    ...Typography.body,
    flex: 1,
  },
  pickerContainer: {
    marginTop: Spacing.xs,
    alignItems: "center",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
  },
  timeGroup: {
    flex: 1,
  },
  timeButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: 6,
  },
  timeButtonText: {
    ...Typography.body,
    flex: 1,
  },
  durationBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingBottom: Spacing.sm,
  },
  durationText: {
    ...Typography.small,
  },
  durationSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
  },
  durationSummaryText: {
    ...Typography.small,
    flex: 1,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
});
