import React, { useCallback, useState } from "react";
import { View, StyleSheet, TextInput, Alert } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getSettings, saveSettings, Settings, DEFAULT_LIMITS, WeatherLimits } from "@/lib/storage";
import * as Haptics from "expo-haptics";

export default function WeatherLimitsScreen() {
  const navigation = useNavigation();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [limits, setLimits] = useState<WeatherLimits>(DEFAULT_LIMITS);

  const loadSettings = useCallback(async () => {
    const data = await getSettings();
    setSettings(data);
    setLimits(data.limits);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings])
  );

  const updateLimit = (key: keyof WeatherLimits, value: string) => {
    const numValue = parseFloat(value) || 0;
    setLimits(prev => ({ ...prev, [key]: numValue }));
  };

  const handleSave = async () => {
    if (!settings) return;
    try {
      await saveSettings({ ...settings, limits });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (error) {
      Alert.alert("Fehler", "Einstellungen konnten nicht gespeichert werden.");
    }
  };

  const handleReset = () => {
    Alert.alert(
      "Zurücksetzen",
      "Alle Grenzwerte auf Standardwerte zurücksetzen?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Zurücksetzen",
          style: "destructive",
          onPress: () => setLimits(DEFAULT_LIMITS),
        },
      ]
    );
  };

  const renderLimitInput = (
    label: string,
    key: keyof WeatherLimits,
    unit: string,
    description?: string
  ) => (
    <Card style={styles.limitCard}>
      <View style={styles.limitHeader}>
        <ThemedText style={styles.limitLabel}>{label}</ThemedText>
        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.backgroundSecondary, color: theme.text },
            ]}
            value={limits[key] !== undefined ? String(limits[key]) : ""}
            onChangeText={(value) => updateLimit(key, value)}
            keyboardType="numeric"
            selectTextOnFocus
          />
          <ThemedText style={[styles.unitText, { color: theme.textSecondary }]}>
            {unit}
          </ThemedText>
        </View>
      </View>
      {description ? (
        <ThemedText style={[styles.description, { color: theme.textTertiary }]}>
          {description}
        </ThemedText>
      ) : null}
    </Card>
  );

  if (!settings) {
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
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + 100,
          },
        ]}
      >
        <ThemedText style={[styles.infoText, { color: theme.textSecondary }]}>
          Wind- und Böengrenzen werden automatisch von der ausgewählten Drohne übernommen.
        </ThemedText>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing.xl }]}>
          TEMPERATUR
        </ThemedText>
        {renderLimitInput(
          "Min. Temperatur",
          "minTemp",
          settings.tempUnit === "F" ? "°F" : "°C",
          "Warnung bei niedriger Temperatur (Akku-Leistung)"
        )}

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          NIEDERSCHLAG
        </ThemedText>
        {renderLimitInput(
          "Max. Niederschlag",
          "maxRain",
          "mm/h",
          "Warnung bei zu starkem Regen"
        )}

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          SICHT & WOLKEN
        </ThemedText>
        {renderLimitInput(
          "Min. Wolkenuntergrenze",
          "minCloudCeiling",
          "m",
          "Warnung wenn Wolken zu tief für VLOS"
        )}
        {renderLimitInput(
          "Min. Sichtweite",
          "minVisibility",
          "m",
          "Warnung bei eingeschränkter Sicht"
        )}

        <View style={styles.buttonRow}>
          <Button
            title="Zurücksetzen"
            onPress={handleReset}
            variant="secondary"
            style={{ flex: 1 }}
          />
          <Button
            title="Speichern"
            onPress={handleSave}
            style={{ flex: 1 }}
          />
        </View>
      </KeyboardAwareScrollViewCompat>
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
  infoText: {
    ...Typography.small,
    textAlign: "center",
    paddingHorizontal: Spacing.md,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  limitCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  limitHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  limitLabel: {
    ...Typography.body,
    flex: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  input: {
    width: 80,
    height: 40,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    textAlign: "center",
    ...Typography.body,
  },
  unitText: {
    ...Typography.body,
    width: 40,
  },
  description: {
    ...Typography.caption,
    marginTop: Spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing["2xl"],
  },
});
