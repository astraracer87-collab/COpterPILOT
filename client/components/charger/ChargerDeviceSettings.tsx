/**
 * Einstellungen direkt am ISDT MA331 (Ladeziel, Modus, Ton, Lampe …).
 * Jede Änderung wird sofort einzeln geschrieben (`12 C4`) und danach
 * vom Ladegerät neu gelesen – angezeigt wird immer der gelesene Stand.
 */
import React, { useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useChargerSnapshot } from "@/hooks/useCharger";
import { chargerController } from "@/lib/charger/chargerControllerNative";
import { chargeTargetLabel, hubModeLabel, IsdtHubMode, type IsdtSettings } from "@/lib/charger/ma331Protocol";
import type { SettingsWriteResult } from "@/lib/charger/bleTransport";

const TARGETS = [0, 1, 2, 3];
const MODES = [IsdtHubMode.Charge, IsdtHubMode.Output, IsdtHubMode.Gather, IsdtHubMode.Balance];
const TOGGLES: { key: keyof IsdtSettings; label: string }[] = [
  { key: "dischargeToZero", label: "Vor dem Laden auf 0 % entladen" },
  { key: "alarm", label: "Alarmton" },
  { key: "lamp", label: "Lampe" },
  { key: "mute", label: "Stumm" },
  { key: "screenAutoOff", label: "Display automatisch aus" },
];

const RESULT_TEXT: Record<Exclude<SettingsWriteResult, "ok">, string> = {
  rejected: "Das Ladegerät hat die Änderung abgelehnt. Es gilt weiter der alte Wert.",
  timeout: "Keine Bestätigung vom Ladegerät. Bitte den angezeigten Wert prüfen – er wird gerade neu gelesen.",
  "not-connected": "Das Ladegerät ist nicht verbunden.",
  invalid: "Diese Kombination ist nicht zulässig.",
};

export function ChargerDeviceSettings() {
  const { theme } = useTheme();
  const snap = useChargerSnapshot();
  const [busy, setBusy] = useState(false);
  const t = snap.transport;
  const settings = t?.state === "connected" ? t.settings : null;

  // Direkt schreiben (keine Rückfrage); nur Fehler werden gemeldet
  const apply = async (patch: Partial<IsdtSettings>) => {
    setBusy(true);
    try {
      const r = await chargerController.writeSettings(patch);
      if (r !== "ok") Alert.alert("Nicht geändert", RESULT_TEXT[r]);
    } finally {
      setBusy(false);
    }
  };

  if (t?.state !== "connected") {
    return (
      <ThemedText style={[styles.help, { color: theme.textSecondary }]} testID="charger-device-settings-offline">
        Einstellungen am Ladegerät (Ladeziel, Modus, Ton …) lassen sich ändern, sobald es verbunden ist.
      </ThemedText>
    );
  }
  if (!settings) {
    return (
      <ThemedText style={[styles.help, { color: theme.textSecondary }]}>
        Einstellungen werden vom Ladegerät gelesen …
      </ThemedText>
    );
  }

  const chip = (selected: boolean, label: string, onPress: () => void, testID: string) => (
    <Pressable
      key={testID}
      testID={testID}
      disabled={busy || selected}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.primary + "22" : theme.backgroundSecondary,
          opacity: busy && !selected ? 0.5 : 1,
        },
      ]}
    >
      <ThemedText style={[styles.chipText, selected && { color: theme.primary }]}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <View style={styles.wrap} testID="charger-device-settings">
      <ThemedText style={styles.label}>Ladeziel</ThemedText>
      <View style={styles.row}>
        {TARGETS.map((v) =>
          chip(settings.chargeTarget === v, chargeTargetLabel(v), () => void apply({ chargeTarget: v }), `charger-target-${v}`),
        )}
      </View>

      <ThemedText style={styles.label}>Betriebsmodus</ThemedText>
      <View style={styles.row}>
        {MODES.map((v) =>
          chip(settings.mode === v, hubModeLabel(v), () => void apply({ mode: v }), `charger-mode-${v}`),
        )}
      </View>
      {!MODES.includes(settings.mode) ? (
        <ThemedText style={[styles.help, { color: theme.textSecondary }]}>
          Aktuell: {hubModeLabel(settings.mode)} – dieser Modus ist der App nicht bekannt und bleibt unverändert, solange du keinen anderen wählst.
        </ThemedText>
      ) : null}

      <View style={{ gap: 4 }}>
        {TOGGLES.map(({ key, label }) => {
          const on = Boolean(settings[key]);
          return (
            <View key={key} style={[styles.toggle, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
              <Switch
                testID={`charger-toggle-${key}`}
                value={on}
                disabled={busy}
                onValueChange={(v) => void apply({ [key]: v } as Partial<IsdtSettings>)}
                trackColor={{ true: theme.primary }}
              />
            </View>
          );
        })}
      </View>
      <ThemedText style={[styles.help, { color: theme.textTertiary }]}>
        „Stumm“ und „Display automatisch aus“ schließen sich am Gerät gegenseitig aus. Umbenennen des Ladegeräts ist nicht möglich.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  label: { fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: "600" },
  toggle: { flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.sm },
  help: { fontSize: 13 },
});
