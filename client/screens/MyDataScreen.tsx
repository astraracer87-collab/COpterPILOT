import React, { useCallback, useState } from "react";
import { StyleSheet, ScrollView, View, Pressable, Alert, Platform, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { apiFetch, apiJson, ApiError } from "@/lib/api-client";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

interface SummaryGroup {
  key: string;
  title: string;
  count: number;
  details: string[];
}

interface AccountSummary {
  account: {
    email: string;
    name: string | null;
    isAdmin: boolean;
    registeredAt: string | null;
  };
  groups: SummaryGroup[];
}

const GROUP_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  konto: "user",
  pilotenprofil: "award",
  drohnen: "send",
  fluege: "map-pin",
  historie: "tool",
  "glossar-links": "book-open",
  einstellungen: "sliders",
  abonnement: "credit-card",
  dokumente: "file-text",
};

export default function MyDataScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user, logout } = useAuth();
  const queryClient = useQueryClient();

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useQuery<AccountSummary>({
    queryKey: ["/api/account/summary"],
    queryFn: () => apiJson<AccountSummary>("/api/account/summary", { timeoutMs: 20000 }),
    enabled: isAuthenticated,
  });

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await apiFetch("/api/account/export", { timeoutMs: 30000 });
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } catch {
          /* noop */
        }
        throw new Error(msg);
      }
      const json = await res.text();
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `meine-daten-${stamp}.json`;

      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(fileUri, json, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/json",
          dialogTitle: "Meine Daten exportieren",
          UTI: "public.json",
        });
      } else {
        Alert.alert("Export erstellt", `Die Datei wurde gespeichert: ${fileName}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      Alert.alert("Export fehlgeschlagen", msg);
    } finally {
      setExporting(false);
    }
  }, [exporting]);

  const performDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await apiFetch("/api/account", { method: "DELETE", timeoutMs: 30000 });
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const j = await res.json();
          if (j?.error) msg = String(j.error);
        } catch {
          /* noop */
        }
        throw new ApiError(res.status, msg);
      }
      await logout();
      queryClient.clear();
      if (Platform.OS === "web") {
        window.alert("Dein Konto und alle zugehörigen Daten wurden gelöscht.");
      } else {
        Alert.alert("Konto gelöscht", "Dein Konto und alle zugehörigen Daten wurden gelöscht.");
      }
      navigation.navigate("Settings");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      Alert.alert("Löschung fehlgeschlagen", msg);
    } finally {
      setDeleting(false);
    }
  }, [logout, queryClient, navigation]);

  const handleDelete = useCallback(() => {
    if (deleting) return;
    if (Platform.OS === "web") {
      const ok = window.confirm(
        "Konto unwiderruflich löschen? Alle serverseitig gespeicherten Daten und Dokumente werden dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden.",
      );
      if (ok) performDelete();
      return;
    }
    Alert.alert(
      "Konto unwiderruflich löschen?",
      "Alle serverseitig gespeicherten Daten und Dokumente werden dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Endgültig löschen", style: "destructive", onPress: performDelete },
      ],
    );
  }, [deleting, performDelete]);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
          Hier siehst du, welche Daten wir über dich speichern. Du kannst deine
          Daten als maschinenlesbare JSON-Datei exportieren oder dein Konto
          unwiderruflich löschen.
        </ThemedText>

        {!isAuthenticated ? (
          <Card style={[styles.notice, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="info" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.noticeText}>
                Du bist nicht angemeldet. Export und Löschung beziehen sich auf
                serverseitig gespeicherte Daten und stehen nur im angemeldeten
                Zustand zur Verfügung.
              </ThemedText>
              <Pressable onPress={() => navigation.navigate("Account")} hitSlop={8}>
                <ThemedText style={[styles.link, { color: theme.primary }]}>
                  Zur Anmeldung
                </ThemedText>
              </Pressable>
            </View>
          </Card>
        ) : (
          <Card style={[styles.notice, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="user-check" size={20} color={theme.statusGo} />
            <ThemedText style={[styles.noticeText, { flex: 1 }]}>
              Angemeldet als {user?.email}
            </ThemedText>
          </Card>
        )}

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          GESPEICHERTE DATEN
        </ThemedText>

        {!isAuthenticated ? (
          <Card style={styles.groupCard}>
            <ThemedText style={[styles.groupDesc, { color: theme.textSecondary }]}>
              Melde dich an, um die tatsächlich über dich gespeicherten Daten zu
              sehen.
            </ThemedText>
          </Card>
        ) : summaryLoading ? (
          <Card style={[styles.groupCard, styles.centeredCard]}>
            <ActivityIndicator size="small" color={theme.primary} />
          </Card>
        ) : summaryError || !summary ? (
          <Card style={styles.groupCard}>
            <ThemedText style={[styles.groupDesc, { color: theme.statusNoGo }]}>
              Die Datenübersicht konnte nicht geladen werden. Bitte versuche es
              später erneut.
            </ThemedText>
          </Card>
        ) : (
          summary.groups.map((g) => (
            <Card key={g.key} style={styles.groupCard} testID={`group-${g.key}`}>
              <View style={styles.groupRow}>
                <Feather
                  name={GROUP_ICONS[g.key] ?? "database"}
                  size={20}
                  color={theme.primary}
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.groupHeaderRow}>
                    <ThemedText style={styles.groupTitle}>{g.title}</ThemedText>
                    <View style={[styles.countBadge, { backgroundColor: theme.backgroundSecondary }]}>
                      <ThemedText
                        style={[styles.countBadgeText, { color: theme.primary }]}
                        testID={`count-${g.key}`}
                      >
                        {g.count}
                      </ThemedText>
                    </View>
                  </View>
                  {g.details.map((d, i) => (
                    <ThemedText
                      key={i}
                      style={[styles.groupDetail, { color: theme.textSecondary }]}
                    >
                      {d}
                    </ThemedText>
                  ))}
                </View>
              </View>
            </Card>
          ))
        )}

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          MEINE RECHTE
        </ThemedText>
        <Pressable
          onPress={handleExport}
          disabled={!isAuthenticated || exporting}
          style={({ pressed }) => pressed && styles.pressed}
          testID="button-export-data"
        >
          <Card style={[styles.actionCard, (!isAuthenticated || exporting) && styles.disabled]}>
            <View style={styles.groupRow}>
              {exporting ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Feather name="download" size={20} color={theme.primary} />
              )}
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.groupTitle}>Daten exportieren (JSON)</ThemedText>
                <ThemedText style={[styles.groupDesc, { color: theme.textSecondary }]}>
                  Lädt alle über dich gespeicherten Daten als maschinenlesbare
                  Datei inkl. Dokument-Verweisen herunter.
                </ThemedText>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </Card>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate("PrivacyPolicy")}
          style={({ pressed }) => pressed && styles.pressed}
          testID="button-open-privacy"
        >
          <Card style={styles.actionCard}>
            <View style={styles.groupRow}>
              <Feather name="shield" size={20} color={theme.primary} />
              <ThemedText style={styles.groupTitle}>Datenschutzerklärung</ThemedText>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </Card>
        </Pressable>

        <Pressable
          onPress={handleDelete}
          disabled={!isAuthenticated || deleting}
          style={({ pressed }) => pressed && styles.pressed}
          testID="button-delete-account"
        >
          <Card style={[styles.actionCard, styles.dangerCard, { borderColor: theme.statusNoGo }, (!isAuthenticated || deleting) && styles.disabled]}>
            <View style={styles.groupRow}>
              {deleting ? (
                <ActivityIndicator size="small" color={theme.statusNoGo} />
              ) : (
                <Feather name="trash-2" size={20} color={theme.statusNoGo} />
              )}
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.groupTitle, { color: theme.statusNoGo }]}>
                  Konto unwiderruflich löschen
                </ThemedText>
                <ThemedText style={[styles.groupDesc, { color: theme.textSecondary }]}>
                  Entfernt alle serverseitigen Daten und Dokumente dauerhaft und
                  kündigt den Stripe-Kundenbezug.
                </ThemedText>
              </View>
            </View>
          </Card>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  intro: { ...Typography.body, lineHeight: 22, marginBottom: Spacing.lg },
  notice: {
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.md,
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  noticeText: { ...Typography.small, lineHeight: 19 },
  link: { ...Typography.small, fontWeight: "700", marginTop: Spacing.xs },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  groupCard: { marginBottom: Spacing.sm, padding: Spacing.md },
  centeredCard: { alignItems: "center", justifyContent: "center" },
  groupRow: { flexDirection: "row", gap: Spacing.md, alignItems: "flex-start", flex: 1 },
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  groupTitle: { ...Typography.body, fontWeight: "600", flexShrink: 1 },
  groupDesc: { ...Typography.small, lineHeight: 18, marginTop: 2 },
  groupDetail: { ...Typography.small, lineHeight: 18, marginTop: 2 },
  countBadge: {
    minWidth: 28,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 12,
    alignItems: "center",
  },
  countBadgeText: { ...Typography.small, fontWeight: "700" },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  dangerCard: { borderWidth: 1, marginTop: Spacing.sm },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
