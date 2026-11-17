import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Alert, Pressable } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { getBriefing, deleteBriefing, Briefing } from "@/lib/storage";
import type { BriefingsStackParamList } from "@/navigation/BriefingsStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type RouteParams = RouteProp<BriefingsStackParamList, "BriefingDetail">;
type NavProp = NativeStackNavigationProp<BriefingsStackParamList, "BriefingDetail">;

export default function BriefingDetailScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const [briefing, setBriefing] = useState<Briefing | null>(null);

  const loadBriefing = useCallback(async () => {
    const data = await getBriefing(route.params.briefingId);
    setBriefing(data);
  }, [route.params.briefingId]);

  useFocusEffect(
    useCallback(() => {
      loadBriefing();
    }, [loadBriefing])
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleDelete = () => {
    Alert.alert(
      "Briefing löschen",
      "Möchten Sie dieses Briefing wirklich löschen?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            await deleteBriefing(route.params.briefingId);
            
            navigation.goBack();
          },
        },
      ]
    );
  };

  if (!briefing) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ThemedText style={{ color: theme.textSecondary }}>Laden...</ThemedText>
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
            paddingBottom: tabBarHeight + Spacing.xl + 40,
          },
        ]}
      >
        <View style={styles.statusRow}>
          <StatusBadge status={briefing.status} size="large" />
          <ThemedText style={[styles.dateText, { color: theme.textSecondary }]}>
            {formatDate(briefing.createdAt)}
          </ThemedText>
        </View>

        <Card style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Standort</ThemedText>
          <View style={styles.locationRow}>
            <Feather name="map-pin" size={16} color={theme.primary} />
            <ThemedText style={[styles.locationText, { color: theme.textSecondary }]}>
              {briefing.locationName || `${briefing.latitude.toFixed(4)}, ${briefing.longitude.toFixed(4)}`}
            </ThemedText>
          </View>
        </Card>

        {briefing.hasRestrictions ? (
          <Card style={[styles.section, { borderLeftWidth: 3, borderLeftColor: theme.statusCaution }]}>
            <View style={styles.restrictionHeader}>
              <Feather name="alert-triangle" size={18} color={theme.statusCaution} />
              <ThemedText style={styles.sectionTitle}>Einschränkungen</ThemedText>
            </View>
            <ThemedText style={{ color: theme.textSecondary }}>
              {briefing.restrictionNotes || "Einschränkungen wurden festgestellt"}
            </ThemedText>
          </Card>
        ) : null}

        {briefing.weatherData ? (
          <Card style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Wetterdaten</ThemedText>
            <View style={styles.weatherGrid}>
              <View style={styles.weatherItem}>
                <Feather name="thermometer" size={18} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>
                  {briefing.weatherData.temperature?.toFixed(1) ?? "-"}°C
                </ThemedText>
                <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                  Temperatur
                </ThemedText>
              </View>
              <View style={styles.weatherItem}>
                <Feather name="wind" size={18} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>
                  {briefing.weatherData.windSpeed?.toFixed(1) ?? "-"} m/s
                </ThemedText>
                <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                  Wind
                </ThemedText>
              </View>
              <View style={styles.weatherItem}>
                <Feather name="cloud-rain" size={18} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>
                  {briefing.weatherData.rain?.toFixed(1) ?? "0"} mm
                </ThemedText>
                <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                  Regen
                </ThemedText>
              </View>
              <View style={styles.weatherItem}>
                <Feather name="cloud" size={18} color={theme.textSecondary} />
                <ThemedText style={styles.weatherValue}>
                  {briefing.weatherData.cloudCover?.toFixed(0) ?? "-"}%
                </ThemedText>
                <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>
                  Wolken
                </ThemedText>
              </View>
            </View>
          </Card>
        ) : null}

        {briefing.reasons && briefing.reasons.length > 0 ? (
          <Card style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Bewertungsgründe</ThemedText>
            {briefing.reasons.map((reason, index) => (
              <View key={index} style={styles.reasonRow}>
                <View
                  style={[
                    styles.reasonDot,
                    {
                      backgroundColor:
                        reason.type === "nogo"
                          ? theme.statusNoGo
                          : reason.type === "caution"
                          ? theme.statusCaution
                          : theme.statusGo,
                    },
                  ]}
                />
                <ThemedText style={[styles.reasonText, { color: theme.textSecondary }]}>
                  {reason.message}
                </ThemedText>
              </View>
            ))}
          </Card>
        ) : null}

        <Pressable
          onPress={() =>
            navigation.navigate("BrightSkyWeather", {
              latitude: briefing.latitude,
              longitude: briefing.longitude,
              locationName: briefing.locationName,
            })
          }
          style={({ pressed }) => [
            styles.weatherLink,
            { backgroundColor: theme.primary + "15" },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="cloud" size={18} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText style={[styles.weatherLinkTitle, { color: theme.primary }]}>
              DWD Wetter (BrightSky)
            </ThemedText>
            <ThemedText style={[styles.weatherLinkSub, { color: theme.textSecondary }]}>
              Stundenverlauf und Flugbewertung
            </ThemedText>
          </View>
          <Feather name="chevron-right" size={18} color={theme.primary} />
        </Pressable>

        <Button
          title="Briefing löschen"
          onPress={handleDelete}
          variant="secondary"
          style={styles.deleteButton}
        />
      </ScrollView>
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
  statusRow: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  dateText: {
    ...Typography.body,
    marginTop: Spacing.sm,
  },
  section: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h4,
    marginBottom: Spacing.md,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  locationText: {
    ...Typography.body,
  },
  restrictionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  weatherGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.lg,
  },
  weatherItem: {
    width: "45%",
    alignItems: "center",
    padding: Spacing.md,
  },
  weatherValue: {
    ...Typography.h3,
    marginTop: Spacing.xs,
  },
  weatherLabel: {
    ...Typography.caption,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  reasonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  reasonText: {
    ...Typography.body,
    flex: 1,
  },
  weatherLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: 12,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  weatherLinkTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  weatherLinkSub: {
    ...Typography.caption,
    marginTop: 2,
  },
  deleteButton: {
    marginTop: Spacing.xl,
  },
});
