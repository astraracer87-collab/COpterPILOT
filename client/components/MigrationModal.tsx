import React from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { MigrationResult } from "@/lib/storage";

interface MigrationModalProps {
  visible: boolean;
  migrating: boolean;
  /** True, solange geprüft wird, ob lokale Daten vorliegen. */
  checking?: boolean;
  result: MigrationResult | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function MigrationModal({ visible, migrating, checking = false, result, onConfirm, onDismiss }: MigrationModalProps) {
  const { theme } = useTheme();
  const showResult = result != null;
  const transferred = result
    ? result.dronesSync +
      result.sessionsSync +
      result.logbookSync +
      result.historySync +
      (result.profileSync ? 1 : 0) +
      (result.settingsSync ? 1 : 0)
    : 0;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { backgroundColor: theme.backgroundDefault }]}>
          {checking ? (
            <>
              <View style={styles.modalIconRow}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
              <ThemedText style={styles.modalTitle}>Lokale Daten werden geprüft …</ThemedText>
            </>
          ) : showResult ? (
            <>
              <View style={styles.modalIconRow}>
                <Feather
                  name={result!.success ? "check-circle" : "alert-triangle"}
                  size={40}
                  color={result!.success ? theme.statusGo : theme.statusNoGo}
                />
              </View>
              <ThemedText style={styles.modalTitle}>
                {result!.success
                  ? result!.hadAnyLocalData
                    ? "Synchronisation abgeschlossen"
                    : "Bereits synchronisiert"
                  : "Synchronisation fehlgeschlagen"}
              </ThemedText>
              {result!.success && !result!.hadAnyLocalData ? (
                <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                  Es lagen keine lokalen Daten auf diesem Gerät vor. Dein Account ist bereits auf dem
                  aktuellen Stand.
                </ThemedText>
              ) : (
                <>
                  <View style={styles.summaryList}>
                    <SummaryRow label="Drohnen" value={result!.dronesSync} />
                    <SummaryRow label="Flüge (Sessions)" value={result!.sessionsSync} />
                    <SummaryRow label="Logbuch-Einträge" value={result!.logbookSync} />
                    <SummaryRow label="Drohnen-Historie" value={result!.historySync} />
                    <SummaryRow label="Pilotenprofil" value={result!.profileSync ? "übernommen" : "übersprungen"} />
                    <SummaryRow label="Einstellungen" value={result!.settingsSync ? "übernommen" : "übersprungen"} />
                  </View>
                  {result!.success ? (
                    <ThemedText style={[styles.transferredText, { color: theme.statusGo }]}>
                      {transferred} {transferred === 1 ? "Eintrag" : "Einträge"} übertragen
                    </ThemedText>
                  ) : null}
                </>
              )}
              {!result!.success && result!.error ? (
                <ThemedText style={[styles.modalBody, { color: theme.statusNoGo }]}>{result!.error}</ThemedText>
              ) : null}
              <Pressable onPress={onDismiss} style={[styles.primaryBtn, { backgroundColor: theme.primary }]}>
                <ThemedText style={styles.primaryBtnText}>Fertig</ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.modalIconRow}>
                <Feather name="upload-cloud" size={40} color={theme.primary} />
              </View>
              <ThemedText style={styles.modalTitle}>Lokale Daten übernehmen?</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Auf diesem Gerät liegen Daten, die noch nicht zum Account gehören. Sollen Drohnen, Flüge und das
                Logbuch jetzt in deinen Account hochgeladen werden? Erfolgreich übertragene Einträge werden
                anschließend lokal entfernt, damit sie nicht doppelt erscheinen.
              </ThemedText>
              <View style={styles.modalRow}>
                <Pressable
                  onPress={onDismiss}
                  disabled={migrating}
                  style={[styles.secondaryBtn, { borderColor: theme.border }]}
                >
                  <ThemedText style={styles.secondaryBtnText}>Später</ThemedText>
                </Pressable>
                <Pressable
                  onPress={onConfirm}
                  disabled={migrating}
                  style={[
                    styles.primaryBtn,
                    styles.primaryBtnFlex,
                    { backgroundColor: theme.primary, opacity: migrating ? 0.6 : 1 },
                  ]}
                >
                  {migrating ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <ThemedText style={styles.primaryBtnText}>Jetzt hochladen</ThemedText>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SummaryRow({ label, value }: { label: string; value: number | string }) {
  const { theme } = useTheme();
  return (
    <View style={styles.summaryRow}>
      <ThemedText style={[styles.summaryLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
      <ThemedText style={styles.summaryValue}>{String(value)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  modalIconRow: { alignItems: "center" },
  modalTitle: { ...Typography.h2, fontWeight: "700", textAlign: "center" },
  modalBody: { ...Typography.body, lineHeight: 22, textAlign: "center" },
  modalRow: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.sm },
  summaryList: { gap: 6, marginVertical: Spacing.sm },
  transferredText: { ...Typography.body, fontWeight: "700", textAlign: "center" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { ...Typography.small },
  summaryValue: { ...Typography.body, fontWeight: "600" },
  primaryBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryBtnFlex: { flex: 1 },
  primaryBtnText: { ...Typography.body, fontWeight: "700", color: "#FFFFFF" },
  secondaryBtn: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryBtnText: { ...Typography.body, fontWeight: "600" },
});
