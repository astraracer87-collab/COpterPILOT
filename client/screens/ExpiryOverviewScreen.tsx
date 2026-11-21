import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  collectDocuments,
  rescheduleExpiryWarnings,
  DocEntry,
  DocCategory,
  DOC_CATEGORY_LABEL,
  DOC_CATEGORY_ORDER,
  ExpiryStatus,
} from "@/lib/expiryWarnings";
import { viewDocument } from "@/lib/documents";

const STATUS_COLOR: Record<ExpiryStatus, string> = {
  expired: "#FF3B30",
  critical: "#FF453A",
  warn: "#FF9F0A",
  info: "#FFD60A",
  missing: "#8E8E93",
  ok: "#30D158",
};

const STATUS_LABEL: Record<ExpiryStatus, string> = {
  expired: "Abgelaufen",
  critical: "Letzter Monat",
  warn: "Vorletzter Monat",
  info: "Drei Monate",
  missing: "Kein Datum",
  ok: "Gültig",
};

function iconForCategory(cat: DocCategory): keyof typeof Feather.glyphMap {
  switch (cat) {
    case "licenses": return "award";
    case "drones": return "cpu";
    case "insurance": return "shield";
    case "permits": return "map-pin";
  }
}

const EXPIRING_ORDER: Record<ExpiryStatus, number> = {
  expired: 0, critical: 1, warn: 2, info: 3, missing: 4, ok: 5,
};

export default function ExpiryOverviewScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const headerHeight = useHeaderHeight();
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await collectDocuments();
    setDocs(list);
  }, []);

  useEffect(() => {
    load();
    rescheduleExpiryWarnings().catch(() => {});
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
      await rescheduleExpiryWarnings();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handlePress = useCallback(
    async (entry: DocEntry) => {
      if (entry.doc) {
        try {
          await viewDocument(entry.doc);
          return;
        } catch (e) {
          Alert.alert(
            "Dokument",
            e instanceof Error ? e.message : "Dokument konnte nicht geöffnet werden.",
          );
          return;
        }
      }
      if (entry.nav) navigation.navigate(entry.nav.screen, entry.nav.params);
    },
    [navigation],
  );

  if (!docs) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const expiring = docs
    .filter((d) => d.canExpire && d.status && d.status !== "ok")
    .sort((a, b) => {
      const o = EXPIRING_ORDER[a.status!] - EXPIRING_ORDER[b.status!];
      if (o !== 0) return o;
      const ad = a.expiresAt ? a.expiresAt.getTime() : Infinity;
      const bd = b.expiresAt ? b.expiresAt.getTime() : Infinity;
      return ad - bd;
    });

  const byCategory = DOC_CATEGORY_ORDER.map((cat) => ({
    cat,
    items: docs.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + Spacing.lg, paddingBottom: Spacing["3xl"] }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
    >
      <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
        Alle deine Dokumente an einem Ort – nach Kategorie sortiert. Tippe ein Dokument an, um die
        hinterlegte Datei zu öffnen, oder um es zu ergänzen. Für ablaufende Dokumente wirst du
        automatisch erinnert (3 Monate vorher monatlich, im vorletzten Monat wöchentlich, im letzten
        Monat täglich).
      </ThemedText>

      {docs.length === 0 ? (
        <Card style={styles.card}>
          <ThemedText style={{ color: theme.textSecondary }}>
            Noch keine Dokumente hinterlegt. Trage deine Lizenzen, die Versicherung, die
            AlphaTango-/D-Flight-Registrierung deiner Drohnen oder eine Allgemeinverfügung ein.
          </ThemedText>
        </Card>
      ) : null}

      {expiring.length > 0 ? (
        <>
          <View style={styles.expiringHeader}>
            <Feather name="alert-triangle" size={14} color={STATUS_COLOR.critical} />
            <ThemedText style={[styles.sectionTitle, { color: STATUS_COLOR.critical, marginBottom: 0 }]}>
              LÄUFT BALD AB · ZU PRÜFEN
            </ThemedText>
          </View>
          {expiring.map((item) => (
            <ItemCard key={`exp-${item.id}`} item={item} theme={theme} onPress={() => handlePress(item)} />
          ))}
        </>
      ) : null}

      {byCategory.map(({ cat, items }) => (
        <View key={cat}>
          <View style={styles.catHeader}>
            <Feather name={iconForCategory(cat)} size={14} color={theme.textSecondary} />
            <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginBottom: 0 }]}>
              {DOC_CATEGORY_LABEL[cat].toUpperCase()}
            </ThemedText>
          </View>
          {items.map((item) => (
            <ItemCard key={item.id} item={item} theme={theme} onPress={() => handlePress(item)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function ItemCard({ item, theme, onPress }: { item: DocEntry; theme: any; onPress: () => void }) {
  const color = item.canExpire && item.status ? STATUS_COLOR[item.status] : theme.border;
  return (
    <Pressable onPress={onPress}>
      <Card style={[styles.card, { borderLeftColor: color, borderLeftWidth: 4 }]}>
        <View style={styles.row}>
          <Feather name={iconForCategory(item.category)} size={22} color={theme.textSecondary} style={{ marginRight: Spacing.md }} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.label}>{item.label}</ThemedText>
            {item.subtitle ? (
              <ThemedText style={[styles.subtitle, { color: theme.textTertiary }]}>{item.subtitle}</ThemedText>
            ) : null}
            <View style={styles.metaRow}>
              {item.canExpire && item.status ? (
                <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] + "22" }]}>
                  <ThemedText style={[styles.badgeText, { color: STATUS_COLOR[item.status] }]}>
                    {STATUS_LABEL[item.status]}
                  </ThemedText>
                </View>
              ) : null}
              {item.doc ? (
                <View style={styles.fileTag}>
                  <Feather name="paperclip" size={11} color={theme.textSecondary} />
                  <ThemedText style={[styles.fileText, { color: theme.textSecondary }]}>Datei öffnen</ThemedText>
                </View>
              ) : (
                <ThemedText style={[styles.meta, { color: theme.textTertiary }]}>Keine Datei hinterlegt</ThemedText>
              )}
            </View>
            {item.rawDate ? (
              <ThemedText style={[styles.date, { color: theme.textTertiary }]}>Gültig bis {item.rawDate}</ThemedText>
            ) : null}
          </View>
          <Feather name={item.doc ? "external-link" : "chevron-right"} size={20} color={theme.textTertiary} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  intro: { fontSize: 13, lineHeight: 19, marginBottom: Spacing.lg },
  sectionTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  expiringHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  catHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: Spacing.sm, marginTop: Spacing.lg },
  card: { marginBottom: Spacing.sm, padding: Spacing.md },
  row: { flexDirection: "row", alignItems: "center" },
  label: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: Spacing.xs, gap: Spacing.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  fileTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  fileText: { fontSize: 12, fontWeight: "600" },
  meta: { fontSize: 12 },
  date: { fontSize: 11, marginTop: 2 },
});
