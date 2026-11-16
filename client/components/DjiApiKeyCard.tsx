import React, { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  clearDjiApiKey,
  getDjiApiKey,
  maskDjiApiKey,
  verifyAndSaveDjiApiKey,
} from "@/lib/djiApiKeyStore";
import { openLink } from "@/lib/webBrowser";

const STEPS = [
  "developer.dji.com öffnen und mit dem DJI-Konto anmelden.",
  "„Create App“ → App-Typ „Open API“ wählen (Name, Kategorie, Beschreibung beliebig).",
  "Die App über den Link in der Bestätigungs-E-Mail aktivieren.",
  "Auf der Entwicklerseite bei der App den Schlüssel („App Key“/„SDK Key“) kopieren und hier einfügen.",
];

/**
 * Einstellungen: DJI-API-Schlüssel für verschlüsselte Flugprotokolle (ab v13).
 * Gespeichert ausschließlich im SecureStore; Eingabe maskiert.
 */
export function DjiApiKeyCard() {
  const { theme } = useTheme();
  const [stored, setStored] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    text: string;
    kind: "ok" | "warn" | "error";
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    getDjiApiKey()
      .then(setStored)
      .catch(() => setStored(null));
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await verifyAndSaveDjiApiKey(input);
    setBusy(false);
    if (r.ok) {
      setStored(input.trim());
      setInput("");
      setMsg(
        r.verified
          ? {
              kind: "ok",
              text: "Schlüssel geprüft und gespeichert. Verschlüsselte Protokolle werden jetzt vollständig ausgewertet.",
            }
          : { kind: "warn", text: r.warning },
      );
    } else {
      setMsg({ kind: "error", text: r.error });
    }
  };

  const remove = async () => {
    await clearDjiApiKey();
    setStored(null);
    setMsg(null);
  };

  const msgColor =
    msg?.kind === "ok"
      ? theme.statusGo
      : msg?.kind === "warn"
        ? theme.statusCaution
        : theme.statusNoGo;

  return (
    <Card style={styles.card} testID="card-dji-api-key">
      <ThemedText style={styles.title}>
        DJI-Flugprotokolle – API-Schlüssel
      </ThemedText>
      <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
        Neuere DJI-Flugprotokolle (ab Version 13) sind verschlüsselt. Zum
        Auswerten holt die App die Schlüssel des jeweiligen Protokolls direkt
        bei DJI (dev.dji.com) – mit deinem eigenen, kostenlosen API-Schlüssel.
        Er wird nur verschlüsselt auf diesem Gerät gespeichert und nur an DJI
        gesendet. Einmal abgerufene Protokoll-Schlüssel werden gespeichert,
        damit die erneute Auswertung auch offline klappt.
      </ThemedText>

      {stored ? (
        <View style={[styles.row, { marginTop: Spacing.md }]}>
          <Feather name="check-circle" size={18} color="#1B8A2A" />
          <ThemedText
            style={[styles.rowLabel, { flex: 1 }]}
            numberOfLines={1}
            testID="text-dji-key-masked"
          >
            Gespeichert: {maskDjiApiKey(stored)}
          </ThemedText>
          <Pressable
            testID="button-dji-key-remove"
            onPress={remove}
            style={[styles.btn, { backgroundColor: "rgba(255,59,48,0.12)" }]}
          >
            <ThemedText style={[styles.btnText, { color: "#FF3B30" }]}>
              Entfernen
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
        <TextInput
          disableFullscreenUI
          testID="input-dji-api-key"
          value={input}
          onChangeText={setInput}
          placeholder={
            stored
              ? "Neuen Schlüssel einfügen (ersetzt den alten)"
              : "DJI-API-Schlüssel einfügen"
          }
          placeholderTextColor={theme.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          secureTextEntry
          style={[
            styles.input,
            {
              color: theme.text,
              borderColor: theme.border,
              backgroundColor: theme.backgroundSecondary,
            },
          ]}
        />
        <Pressable
          testID="button-dji-key-save"
          onPress={save}
          disabled={busy || !input.trim()}
          style={[
            styles.btn,
            {
              backgroundColor: theme.primary,
              alignSelf: "flex-start",
              opacity: busy || !input.trim() ? 0.5 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Feather name="shield" size={16} color="#FFFFFF" />
          )}
          <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>
            Prüfen & speichern
          </ThemedText>
        </Pressable>
      </View>
      {msg ? (
        <ThemedText
          style={[styles.small, { marginTop: Spacing.sm, color: msgColor }]}
          testID="text-dji-key-msg"
        >
          {msg.text}
        </ThemedText>
      ) : null}

      <Pressable
        onPress={() => setHelpOpen((v) => !v)}
        style={[styles.row, { marginTop: Spacing.md }]}
        testID="button-dji-key-help"
      >
        <Feather name="help-circle" size={16} color={theme.primary} />
        <ThemedText
          style={[
            styles.small,
            { color: theme.primary, flex: 1, fontWeight: "600" },
          ]}
        >
          So bekommst du den Schlüssel
        </ThemedText>
        <Feather
          name={helpOpen ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.textSecondary}
        />
      </Pressable>
      {helpOpen ? (
        <View style={{ marginTop: Spacing.sm, gap: 6 }}>
          {STEPS.map((step, i) => (
            <View key={i} style={styles.step}>
              <ThemedText
                style={[
                  styles.small,
                  { fontWeight: "700", color: theme.primary },
                ]}
              >
                {i + 1}.
              </ThemedText>
              <ThemedText style={[styles.small, { flex: 1 }]}>
                {step}
              </ThemedText>
            </View>
          ))}
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            DJI begrenzt die Zahl der Abrufe je Schlüssel. Jedes verschlüsselte
            Protokoll braucht einen Abruf; erneute Auswertungen nutzen den
            gespeicherten Protokoll-Schlüssel.
          </ThemedText>
          <Pressable
            onPress={() =>
              openLink("https://developer.dji.com/user", "DJI Developer").catch(
                () => {},
              )
            }
            style={[styles.row, { marginTop: 2 }]}
          >
            <Feather name="external-link" size={14} color={theme.primary} />
            <ThemedText style={[styles.small, { color: theme.primary }]}>
              developer.dji.com öffnen
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.lg },
  title: { ...Typography.body, fontWeight: "700", marginBottom: Spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowLabel: { ...Typography.body, fontWeight: "600" },
  small: { ...Typography.small },
  step: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
});
