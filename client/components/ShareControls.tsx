import React, { useCallback, useState } from "react";
import { View, StyleSheet, Pressable, Alert, Platform, Share } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { LogbookEntry } from "@/lib/storage";
import {
  sendFlightProtocolByEmail,
  shareProtocolViaSms,
} from "@/lib/pdfExport";
import {
  apiEnableLogbookShare,
  apiDisableLogbookShare,
  apiRegenerateLogbookShare,
  type ShareState,
} from "@/lib/api";
import { getApiUrl } from "@/lib/query-client";
import { isLoggedInSync } from "@/lib/auth";

/**
 * Wiederverwendbare Teilen-Steuerung für einen Logbuch-/Flugprotokoll-Eintrag.
 * Bietet E-Mail-Versand (PDF-Anhang), öffentlichen Freigabe-Schalter sowie
 * — bei aktiver Freigabe — Link kopieren, Link teilen (System-Dialog), SMS und
 * neuen Link erzeugen. Ist die Freigabe aus, führt SMS den Nutzer durch die
 * Aktivierung. Auf Web bzw. ohne Mail-/SMS-Konto: saubere Fallbacks.
 */
export function ShareControls({
  entry,
  onEntryChange,
  style,
}: {
  entry: LogbookEntry;
  onEntryChange: (entry: LogbookEntry) => void;
  style?: any;
}) {
  const { theme } = useTheme();
  const [shareBusy, setShareBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  const buildShareUrl = useCallback((token: string) => {
    const base = getApiUrl().replace(/\/$/, "");
    return `${base}/p/${token}`;
  }, []);

  const requireLogin = useCallback(() => {
    if (isLoggedInSync()) return true;
    Alert.alert(
      "Anmeldung erforderlich",
      "Bitte melde dich an, um ein Protokoll öffentlich freizugeben.",
    );
    return false;
  }, []);

  const enableShare = useCallback(async (): Promise<ShareState | null> => {
    if (!requireLogin()) return null;
    setShareBusy(true);
    try {
      const state = await apiEnableLogbookShare(entry.id);
      onEntryChange({ ...entry, shareEnabled: state.shareEnabled, shareToken: state.shareToken });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return state;
    } catch {
      Alert.alert("Fehler", "Die Freigabe konnte nicht aktiviert werden.");
      return null;
    } finally {
      setShareBusy(false);
    }
  }, [entry, onEntryChange, requireLogin]);

  const handleToggleShare = useCallback(async () => {
    if (!entry.shareEnabled) {
      await enableShare();
      return;
    }
    if (!requireLogin()) return;
    setShareBusy(true);
    try {
      const state = await apiDisableLogbookShare(entry.id);
      onEntryChange({ ...entry, shareEnabled: state.shareEnabled, shareToken: state.shareToken });
    } catch {
      Alert.alert("Fehler", "Die Freigabe konnte nicht deaktiviert werden.");
    } finally {
      setShareBusy(false);
    }
  }, [entry, onEntryChange, enableShare, requireLogin]);

  const handleRegenerate = useCallback(async () => {
    if (!requireLogin()) return;
    setShareBusy(true);
    try {
      const state = await apiRegenerateLogbookShare(entry.id);
      onEntryChange({ ...entry, shareEnabled: state.shareEnabled, shareToken: state.shareToken });
      Alert.alert("Neuer Link", "Ein neuer Freigabe-Link wurde erstellt. Der alte Link ist nicht mehr gültig.");
    } catch {
      Alert.alert("Fehler", "Der Link konnte nicht neu erstellt werden.");
    } finally {
      setShareBusy(false);
    }
  }, [entry, onEntryChange, requireLogin]);

  const handleSendEmail = useCallback(async () => {
    setEmailBusy(true);
    try {
      const shareUrl = entry.shareEnabled && entry.shareToken ? buildShareUrl(entry.shareToken) : null;
      const res = await sendFlightProtocolByEmail(entry, { shareUrl });
      if (res.status === "unavailable") {
        Alert.alert(
          "Kein E-Mail-Konto",
          "Auf diesem Gerät ist kein E-Mail-Konto eingerichtet. Bitte richte ein Konto ein oder nutze „Link teilen“.",
        );
      }
    } catch {
      Alert.alert("Fehler", "Die E-Mail konnte nicht vorbereitet werden.");
    } finally {
      setEmailBusy(false);
    }
  }, [entry, buildShareUrl]);

  const handleCopyLink = useCallback(async () => {
    if (!entry.shareToken) return;
    await Clipboard.setStringAsync(buildShareUrl(entry.shareToken));
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Kopiert", "Der Freigabe-Link wurde in die Zwischenablage kopiert.");
  }, [entry, buildShareUrl]);

  const handleNativeShare = useCallback(async () => {
    if (!entry.shareToken) return;
    const url = buildShareUrl(entry.shareToken);
    try {
      const message = `Flugprotokoll ${entry.droneName || "Drohne"} vom ${entry.flightDate || ""}: ${url}`.trim();
      await Share.share(Platform.OS === "ios" ? { url, message } : { message });
    } catch {
      // Nutzer hat den System-Dialog abgebrochen — kein Fehler.
    }
  }, [entry, buildShareUrl]);

  const doSendSms = useCallback(
    async (token: string) => {
      try {
        const res = await shareProtocolViaSms(entry, buildShareUrl(token));
        if (res.status === "unavailable") {
          Alert.alert("SMS nicht verfügbar", "Auf diesem Gerät ist kein SMS-Versand möglich.");
        } else if (res.status === "web") {
          Alert.alert("Nicht verfügbar", "SMS-Versand ist nur in der mobilen App möglich.");
        }
      } catch {
        Alert.alert("Fehler", "Die SMS konnte nicht vorbereitet werden.");
      }
    },
    [entry, buildShareUrl],
  );

  const handleSendSms = useCallback(async () => {
    if (entry.shareEnabled && entry.shareToken) {
      await doSendSms(entry.shareToken);
      return;
    }
    // Freigabe ist aus: Nutzer durch die Aktivierung führen, dann senden.
    Alert.alert(
      "Freigabe erforderlich",
      "Für den SMS-Versand muss der öffentliche Freigabe-Link aktiv sein. Jetzt aktivieren und SMS senden?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Aktivieren & senden",
          onPress: async () => {
            const state = await enableShare();
            if (state?.shareToken) await doSendSms(state.shareToken);
          },
        },
      ],
    );
  }, [entry, doSendSms, enableShare]);

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

      <View style={[styles.toggleRow, { borderTopColor: theme.border }]}>
        <View style={{ flex: 1, paddingRight: Spacing.md }}>
          <ThemedText style={styles.toggleTitle}>Öffentlicher Freigabe-Link</ThemedText>
          <ThemedText style={[styles.toggleHint, { color: theme.textSecondary }]}>
            {entry.shareEnabled
              ? "Aktiv — jeder mit dem Link kann das Protokoll ansehen."
              : "Aus — das Protokoll ist privat."}
          </ThemedText>
        </View>
        <Pressable
          onPress={handleToggleShare}
          disabled={shareBusy}
          style={({ pressed }) => [
            styles.togglePill,
            {
              backgroundColor: entry.shareEnabled ? theme.primary : theme.backgroundSecondary,
              borderColor: entry.shareEnabled ? theme.primary : theme.border,
            },
            (pressed || shareBusy) && { opacity: 0.6 },
          ]}
        >
          <ThemedText
            style={[styles.togglePillText, { color: entry.shareEnabled ? "#fff" : theme.textSecondary }]}
          >
            {entry.shareEnabled ? "An" : "Aus"}
          </ThemedText>
        </Pressable>
      </View>

      {entry.shareEnabled && entry.shareToken ? (
        <View style={styles.activeBox}>
          <ThemedText
            style={[styles.linkText, { color: theme.textSecondary }]}
            numberOfLines={2}
            selectable
          >
            {buildShareUrl(entry.shareToken)}
          </ThemedText>
          <View style={styles.actionsRow}>
            <Pressable
              onPress={handleCopyLink}
              style={({ pressed }) => [styles.smallAction, { borderColor: theme.border }, pressed && { opacity: 0.6 }]}
            >
              <Feather name="copy" size={14} color={theme.primary} />
              <ThemedText style={[styles.smallActionText, { color: theme.primary }]}>Kopieren</ThemedText>
            </Pressable>
            <Pressable
              onPress={handleNativeShare}
              style={({ pressed }) => [styles.smallAction, { borderColor: theme.border }, pressed && { opacity: 0.6 }]}
            >
              <Feather name="share" size={14} color={theme.primary} />
              <ThemedText style={[styles.smallActionText, { color: theme.primary }]}>Link teilen</ThemedText>
            </Pressable>
            {Platform.OS !== "web" ? (
              <Pressable
                onPress={handleSendSms}
                style={({ pressed }) => [styles.smallAction, { borderColor: theme.border }, pressed && { opacity: 0.6 }]}
              >
                <Feather name="message-square" size={14} color={theme.primary} />
                <ThemedText style={[styles.smallActionText, { color: theme.primary }]}>Per SMS</ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              onPress={handleRegenerate}
              disabled={shareBusy}
              style={({ pressed }) => [styles.smallAction, { borderColor: theme.border }, (pressed || shareBusy) && { opacity: 0.6 }]}
            >
              <Feather name="refresh-cw" size={14} color={theme.primary} />
              <ThemedText style={[styles.smallActionText, { color: theme.primary }]}>Neuer Link</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : Platform.OS !== "web" ? (
        <Pressable
          onPress={handleSendSms}
          disabled={shareBusy}
          style={({ pressed }) => [styles.smsRow, { borderTopColor: theme.border }, (pressed || shareBusy) && { opacity: 0.6 }]}
        >
          <Feather name="message-square" size={14} color={theme.primary} />
          <ThemedText style={[styles.smallActionText, { color: theme.primary }]}>
            Per SMS senden (aktiviert die Freigabe)
          </ThemedText>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { padding: Spacing.lg, marginBottom: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.md },
  headerText: { ...Typography.body, fontWeight: "600" },
  primaryButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, padding: Spacing.md, borderRadius: 10 },
  primaryButtonText: { ...Typography.body, fontWeight: "600" },
  toggleRow: { flexDirection: "row", alignItems: "center", marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  toggleTitle: { ...Typography.body, fontWeight: "600" },
  toggleHint: { ...Typography.caption, marginTop: 2 },
  togglePill: { minWidth: 56, alignItems: "center", paddingVertical: 6, paddingHorizontal: Spacing.md, borderRadius: 20, borderWidth: 1 },
  togglePillText: { ...Typography.caption, fontWeight: "700" },
  activeBox: { marginTop: Spacing.md },
  linkText: { ...Typography.caption, marginBottom: Spacing.sm },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  smallAction: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: Spacing.md, borderRadius: 8, borderWidth: 1 },
  smallActionText: { ...Typography.caption, fontWeight: "600" },
  smsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
