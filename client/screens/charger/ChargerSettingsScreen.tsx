/**
 * Ladegerät-Einstellungen: „Ladegerät im Hintergrund loggen“ (Immer fragen /
 * Immer im Hintergrund / Nie), gekoppeltes Gerät: Einstellungen am Gerät und
 * vergessen, Hinweise zum Gerät.
 */
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  CHARGER_BACKGROUND_HELP,
  CHARGER_BACKGROUND_MODE_LABELS,
  CHARGER_BACKGROUND_SETTING_TITLE,
  type ChargerBackgroundMode,
} from "@/lib/charger/chargerBackground";
import {
  chargerPairingStore,
  forgetCharger,
  getChargerBackgroundMode,
  setChargerBackgroundMode,
} from "@/lib/chargerStore";
import { chargerController } from "@/lib/charger/chargerControllerNative";
import { ChargerDeviceSettings } from "@/components/charger/ChargerDeviceSettings";

const MODES: ChargerBackgroundMode[] = ["ask", "always", "never"];

export default function ChargerSettingsScreen() {
  const { theme } = useTheme();
  const [mode, setMode] = useState<ChargerBackgroundMode>("ask");
  const [device, setDevice] = useState<string | null>(null);

  useEffect(() => {
    void getChargerBackgroundMode().then(setMode);
    void chargerPairingStore.getLastDevice().then(setDevice);
  }, []);

  const choose = (m: ChargerBackgroundMode) => {
    setMode(m);
    void setChargerBackgroundMode(m);
  };

  const forget = () => {
    if (!device) return;
    Alert.alert(
      "Ladegerät vergessen",
      "Kopplung löschen? Beim nächsten Verbinden muss die Kopplung am Ladegerät erneut bestätigt werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Vergessen",
          style: "destructive",
          onPress: async () => {
            await chargerController.disconnect("interrupted");
            await forgetCharger(device);
            setDevice(null);
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Einstellungen am Ladegerät zuerst; Hintergrund-Loggen und Kopplung darunter */}
        {device ? (
          <View
            style={[
              styles.card,
              { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
            ]}
          >
            <ThemedText style={styles.title}>Einstellungen am Ladegerät</ThemedText>
            <ChargerDeviceSettings />
          </View>
        ) : null}

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText style={styles.title}>
            {CHARGER_BACKGROUND_SETTING_TITLE}
          </ThemedText>
          <View style={styles.options}>
            {MODES.map((m) => (
              <Pressable
                key={m}
                testID={`charger-bg-mode-${m}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === m }}
                onPress={() => choose(m)}
                style={[
                  styles.option,
                  {
                    borderColor: mode === m ? theme.primary : theme.border,
                    backgroundColor:
                      mode === m
                        ? theme.primary + "22"
                        : theme.backgroundSecondary,
                  },
                ]}
              >
                <Feather
                  name={mode === m ? "check-circle" : "circle"}
                  size={16}
                  color={mode === m ? theme.primary : theme.textTertiary}
                />
                <ThemedText style={styles.optionText}>
                  {CHARGER_BACKGROUND_MODE_LABELS[m]}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText
            style={[styles.help, { color: theme.textSecondary }]}
            testID="charger-bg-help"
          >
            {CHARGER_BACKGROUND_HELP}
          </ThemedText>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText style={styles.title}>Gekoppeltes Ladegerät</ThemedText>
          <ThemedText style={[styles.help, { color: theme.textSecondary }]}>
            {device
              ? `ISDT MA331 · ${device}`
              : "Noch kein Ladegerät gekoppelt."}
          </ThemedText>
          {device ? (
            <Pressable
              onPress={forget}
              style={[
                styles.option,
                { borderColor: theme.statusNoGo, alignSelf: "flex-start" },
              ]}
              testID="charger-forget"
            >
              <Feather name="trash-2" size={16} color={theme.statusNoGo} />
              <ThemedText
                style={[styles.optionText, { color: theme.statusNoGo }]}
              >
                Ladegerät vergessen
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText style={styles.title}>Hinweise</ThemedText>
          <ThemedText style={[styles.help, { color: theme.textSecondary }]}>
            • Ladeziel, Modus, Ton, Lampe und Display lassen sich oben
            ändern – die Änderung geht sofort ans Ladegerät und wird danach
            neu gelesen. Umbenennen geht nur in der Polying-App.
            {"\n"}• Das Ladegerät erlaubt nur eine Bluetooth-Verbindung: die
            Polying-App schließen.{"\n"}• Android 11 (DJI RC Pro 2):
            Standort-Berechtigung erlauben und Standort einschalten – sonst
            findet Android keine Bluetooth-Geräte.{"\n"}• Das MA331 überträgt
            keine Akku-Seriennummer. Akkus werden über Produktionsdatum und
            Zyklen erkannt; beim ersten Mal fragt die App „Welcher Akku ist
            das?“.
          </ThemedText>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.sm, gap: Spacing.sm },
  card: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  title: { fontSize: 16, fontWeight: "700" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  optionText: { fontSize: 14, fontWeight: "600" },
  help: { fontSize: 13 },
});
