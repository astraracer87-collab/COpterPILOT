import React, { useCallback, useState } from "react";
import { StyleSheet, ScrollView, View, Pressable, Alert, Platform, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  getBriefings,
  getDrones,
  getFlightSessions,
  getLogbook,
  getPilotProfile,
} from "@/lib/storage";
import { countLocalCollection } from "@/lib/localCollections";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

interface SummaryGroup {
  key: string;
  title: string;
  count: number;
  details: string[];
}

const GROUP_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  pilotenprofil: "award",
  drohnen: "send",
  fluege: "map-pin",
  sessions: "clock",
  briefings: "clipboard",
  "glossar-links": "book-open",
  dokumente: "file-text",
  speicher: "database",
};

// Lokal abgelegte Dateien, die zu den Nutzerdaten gehören (siehe objectStorage.ts
// bzw. offlineStore.ts). Beim Löschen werden diese Verzeichnisse mit entfernt.
const LOCAL_DOCS_DIR = `${FileSystem.documentDirectory ?? ""}documents/`;
const LOCAL_OFFLINE_DIR = `${FileSystem.documentDirectory ?? ""}offline/`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function listLocalDocumentFiles(): Promise<string[]> {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) return [];
  try {
    const info = await FileSystem.getInfoAsync(LOCAL_DOCS_DIR);
    if (!info.exists) return [];
    return await FileSystem.readDirectoryAsync(LOCAL_DOCS_DIR);
  } catch {
    return [];
  }
}

/** Zählt die lokal gespeicherten Daten (ersetzt /api/account/summary). */
async function loadLocalSummary(): Promise<SummaryGroup[]> {
  const [profile, drones, logbook, sessions, briefings, glossary, links, docFiles, keys] =
    await Promise.all([
      getPilotProfile().catch(() => null),
      getDrones({ includeArchived: true }).catch(() => []),
      getLogbook().catch(() => []),
      getFlightSessions().catch(() => []),
      getBriefings().catch(() => []),
      countLocalCollection("/api/user-glossary"),
      countLocalCollection("/api/user-resources"),
      listLocalDocumentFiles(),
      AsyncStorage.getAllKeys().catch(() => [] as readonly string[]),
    ]);

  let storageBytes = 0;
  try {
    const pairs = await AsyncStorage.multiGet(keys as string[]);
    for (const [, v] of pairs) storageBytes += v ? v.length : 0;
  } catch {
    storageBytes = 0;
  }

  const profileFilled =
    !!profile &&
    ([profile.name, profile.pilotId, profile.operatorId].some((v) => typeof v === "string" && v.trim().length > 0) ||
      profile.licenseA1A3 ||
      profile.licenseA2 ||
      profile.licenseSTS ||
      profile.insuranceActive);
  const archivedDrones = drones.filter((d) => (d as { archived?: boolean }).archived).length;

  return [
    {
      key: "pilotenprofil",
      title: "Pilotenprofil",
      count: profileFilled ? 1 : 0,
      details: profileFilled && profile?.name ? [profile.name] : [],
    },
    {
      key: "drohnen",
      title: "Drohnen",
      count: drones.length,
      details: archivedDrones > 0 ? [`davon ${archivedDrones} archiviert`] : [],
    },
    { key: "fluege", title: "Logbuch-Einträge", count: logbook.length, details: [] },
    { key: "sessions", title: "Flug-Sessions", count: sessions.length, details: [] },
    { key: "briefings", title: "Briefings", count: briefings.length, details: [] },
    {
      key: "glossar-links",
      title: "Eigenes Glossar & Links",
      count: glossary + links,
      details: [`${glossary} Glossar-Einträge`, `${links} Links`],
    },
    {
      key: "dokumente",
      title: "Große Dokumente (Dateien)",
      count: docFiles.length,
      details: ["Kleinere Dokumente sind direkt in den Datensätzen gespeichert."],
    },
    {
      key: "speicher",
      title: "App-Speicher (Einträge)",
      count: keys.length,
      details: [`ca. ${formatBytes(storageBytes)}`],
    },
  ];
}

/** Exportiert alle lokalen Daten als JSON (ersetzt /api/account/export). */
async function buildLocalExport(): Promise<string> {
  const keys = (await AsyncStorage.getAllKeys()) as string[];
  const pairs = await AsyncStorage.multiGet(keys);
  const data: Record<string, unknown> = {};
  for (const [k, v] of pairs) {
    if (v == null) continue;
    try {
      data[k] = JSON.parse(v);
    } catch {
      data[k] = v;
    }
  }
  const documents: Record<string, string> = {};
  for (const name of await listLocalDocumentFiles()) {
    try {
      documents[name] = await FileSystem.readAsStringAsync(`${LOCAL_DOCS_DIR}${name}`, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      // einzelne Datei nicht lesbar → überspringen
    }
  }
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      format: "copterpilot-rc-local-export",
      version: 1,
      storage: data,
      documentFilesBase64: documents,
    },
    null,
    2,
  );
}

export default function MyDataScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const {
    data: groups,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch,
  } = useQuery<SummaryGroup[]>({
    queryKey: ["local/my-data-summary"],
    queryFn: loadLocalSummary,
    staleTime: 0,
  });

  const handleExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const json = await buildLocalExport();
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
        Alert.alert("Export erstellt", `Die Datei wurde gespeichert: ${fileUri}`);
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
      await AsyncStorage.clear();
      if (Platform.OS !== "web" && FileSystem.documentDirectory) {
        await FileSystem.deleteAsync(LOCAL_DOCS_DIR, { idempotent: true }).catch(() => {});
        await FileSystem.deleteAsync(LOCAL_OFFLINE_DIR, { idempotent: true }).catch(() => {});
      }
      queryClient.clear();
      await refetch();
      const msg =
        "Alle lokal gespeicherten Daten wurden gelöscht. Bitte starte die App neu, damit alle Ansichten zurückgesetzt werden.";
      if (Platform.OS === "web") {
        window.alert(msg);
      } else {
        Alert.alert("Daten gelöscht", msg);
      }
      navigation.navigate("Settings");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      Alert.alert("Löschung fehlgeschlagen", msg);
    } finally {
      setDeleting(false);
    }
  }, [queryClient, navigation, refetch]);

  const handleDelete = useCallback(() => {
    if (deleting) return;
    const text =
      "Alle auf diesem Gerät gespeicherten Daten (Profil, Drohnen, Logbuch, Dokumente, Einstellungen, Offline-Pakete) werden dauerhaft entfernt. Diese Aktion kann nicht rückgängig gemacht werden. Tipp: Vorher exportieren.";
    if (Platform.OS === "web") {
      if (window.confirm(`Alle lokalen Daten löschen? ${text}`)) performDelete();
      return;
    }
    Alert.alert("Alle lokalen Daten löschen?", text, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Endgültig löschen", style: "destructive", onPress: performDelete },
    ]);
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
          Alle Daten werden ausschließlich lokal auf diesem Gerät gespeichert –
          es gibt kein Konto und keinen Server. Du kannst deine Daten als
          maschinenlesbare JSON-Datei exportieren oder vollständig löschen.
        </ThemedText>

        <Card style={[styles.notice, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="smartphone" size={20} color={theme.primary} />
          <ThemedText style={[styles.noticeText, { flex: 1 }]}>
            Lokaler Modus: Beim Deinstallieren der App gehen die Daten verloren.
            Exportiere sie regelmäßig als Sicherung.
          </ThemedText>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          GESPEICHERTE DATEN
        </ThemedText>

        {summaryLoading ? (
          <Card style={[styles.groupCard, styles.centeredCard]}>
            <ActivityIndicator size="small" color={theme.primary} />
          </Card>
        ) : summaryError || !groups ? (
          <Card style={styles.groupCard}>
            <ThemedText style={[styles.groupDesc, { color: theme.statusNoGo }]}>
              Die Datenübersicht konnte nicht geladen werden.
            </ThemedText>
          </Card>
        ) : (
          groups.map((g) => (
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
          disabled={exporting}
          style={({ pressed }) => pressed && styles.pressed}
          testID="button-export-data"
        >
          <Card style={[styles.actionCard, exporting && styles.disabled]}>
            <View style={styles.groupRow}>
              {exporting ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Feather name="download" size={20} color={theme.primary} />
              )}
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.groupTitle}>Daten exportieren (JSON)</ThemedText>
                <ThemedText style={[styles.groupDesc, { color: theme.textSecondary }]}>
                  Speichert bzw. teilt alle lokal gespeicherten Daten inkl.
                  Dokumenten als maschinenlesbare Datei.
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
          disabled={deleting}
          style={({ pressed }) => pressed && styles.pressed}
          testID="button-delete-account"
        >
          <Card style={[styles.actionCard, styles.dangerCard, { borderColor: theme.statusNoGo }, deleting && styles.disabled]}>
            <View style={styles.groupRow}>
              {deleting ? (
                <ActivityIndicator size="small" color={theme.statusNoGo} />
              ) : (
                <Feather name="trash-2" size={20} color={theme.statusNoGo} />
              )}
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.groupTitle, { color: theme.statusNoGo }]}>
                  Alle lokalen Daten löschen
                </ThemedText>
                <ThemedText style={[styles.groupDesc, { color: theme.textSecondary }]}>
                  Entfernt Profil, Drohnen, Logbuch, Dokumente, Einstellungen und
                  Offline-Pakete unwiderruflich von diesem Gerät.
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
