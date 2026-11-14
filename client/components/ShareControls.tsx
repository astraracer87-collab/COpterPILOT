import React, { useCallback, useState } from "react";
import { StyleSheet, Pressable, Alert, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { LogbookEntry } from "@/lib/storage";
import { exportFlightProtocolPdf, sendFlightProtocolByEmail } from "@/lib/pdfExport";

/**
 * Teilen-Steuerung für einen Logbuch-/Flugprotokoll-Eintrag.
 *
 * In der RC-Version gibt es keinen Server mehr – öffentliche Freigabe-Links
 * (inkl. SMS-Versand des Links) entfallen. Geteilt wird ausschließlich lokal:
 * PDF per E-Mail-Anhang oder über den System-Teilen-Dialog.
 */
export function ShareControls({
  entry,
  style,
}: {
  entry: LogbookEntry;
  /** Wird nicht mehr benötigt (früher: Freigabe-Status vom Server). */
  onEntryChange?: (entry: LogbookEntry) => void;
  style?: any;
}) {
  const { theme } = useTheme();
  const [emailBusy, setEmailBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const handleSendEmail = useCallback(async () => {
    setEmailBusy(true);
    try {
      const res = await sendFlightProtocolByEmail(entry);
      if (res.status === "unavailable") {
        Alert.alert(
          "Kein E-Mail-Konto",
          "Auf diesem Gerät ist kein E-Mail-Konto eingerichtet. Bitte nutze „PDF teilen“.",
        );
      }
    } catch {
      Alert.alert("Fehler", "Die E-Mail konnte nicht vorbereitet werden.");
    } finally {
      setEmailBusy(false);
    }
  }, [entry]);

  const handleSharePdf = useCallback(async () => {
    setPdfBusy(true);
    try {
      await exportFlightProtocolPdf(entry);
    } catch {
      Alert.alert("Fehler", "Das PDF konnte nicht erstellt werden.");
    } finally {
      setPdfBusy(false);
    }
  }, [entry]);

  return (
    <Card style={[styles.section, style]}>
      <View style={styles.headerRow}>
        <Feather name="share-2" size={18} color={theme.primary} />
        <ThemedText style={styles.headerText}>Teilen</ThemedText>
      </View>

      <Pressable
        onPress={handleSendEmail}
        disabled={emailBusy}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.primary + "15" },
          (pressed || emailBusy) && { opacity: 0.6 },
        ]}
      >
        <Feather name="mail" size={16} color={theme.primary} />
        <ThemedText style={[styles.primaryButtonText, { color: theme.primary }]}>
          {emailBusy ? "Wird vorbereitet …" : "Per E-Mail senden (PDF-Anhang)"}
        </ThemedText>
      </Pressable>

      <Pressable
        onPress={handleSharePdf}
        disabled={pdfBusy}
        style={({ pressed }) => [
          styles.primaryButton,
          { backgroundColor: theme.primary + "15", marginTop: Spacing.sm },
          (pressed || pdfBusy) && { opacity: 0.6 },
        ]}
      >
        <Feather name="share" size={16} color={theme.primary} />
        <ThemedText style={[styles.primaryButtonText, { color: theme.primary }]}>
          {pdfBusy ? "PDF wird erstellt …" : "PDF teilen / speichern"}
        </ThemedText>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { padding: Spacing.lg, marginBottom: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md },
  headerText: { ...Typography.body, fontWeight: "600" },
  primaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, padding: Spacing.md, borderRadius: 10 },
  primaryButtonText: { ...Typography.body, fontWeight: "600" },
});
