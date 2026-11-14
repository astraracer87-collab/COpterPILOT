import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  collectExpiryItems,
  rescheduleExpiryWarnings,
  describeStatus,
  ExpiryItem,
  ExpiryStatus,
} from "@/lib/expiryWarnings";

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

function iconForCategory(cat: ExpiryItem["category"]): keyof typeof Feather.glyphMap {
  switch (cat) {
    case "alphaTango": return "flag";
    case "license": return "award";
    case "allgemeinerlaubnis": return "map-pin";
  }
}

export default function ExpiryOverviewScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const headerHeight = useHeaderHeight();
  const [items, setItems] = useState<ExpiryItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await collectExpiryItems();
    setItems(list);
  }, []);

  useEffect(() => {
    load();
    // Beim Öffnen gleich auch die Notifications neu planen (z.B. wenn
    // der User gerade ein Ablaufdatum eingetragen hat).
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

  const handleItemPress = (item: ExpiryItem) => {
    if (item.category === "alphaTango") {
      const droneId = item.id.split(":")[1];
      navigation.navigate("DroneSetup", { droneId });
    } else {
      navigation.navigate("PilotProfile");
    }
  };

  if (!items) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const hasAny = items.length > 0;
  const upcoming = items.filter((i) => i.status !== "ok");
  const ok = items.filter((i) => i.status === "ok");

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.background }]}
      contentContainerStyle={[styles.content, { paddingTop: headerHeight + Spacing.lg, paddingBottom: Spacing["3xl"] }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
    >
      <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
        Übersicht aller ablaufenden Dokumente. Du wirst automatisch erinnert:
        {"\n"}• 3 Monate vor Ablauf monatlich
        {"\n"}• im vorletzten Monat wöchentlich
        {"\n"}• im letzten Monat täglich
      </ThemedText>

      {!hasAny ? (
        <Card style={styles.card}>
          <ThemedText style={{ color: theme.textSecondary }}>
            Keine Dokumente mit Ablaufdatum hinterlegt. Trage ein Datum bei deinen Lizenzen, der Versicherung
            oder der AlphaTango-Registrierung deiner Drohnen ein.
          </ThemedText>
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>AKTUELL ZU PRÜFEN</ThemedText>
          {upcoming.map((item) => (
            <ItemCard key={item.id} item={item} theme={theme} onPress={() => handleItemPress(item)} />
          ))}
        </>
      ) : null}

      {ok.length > 0 ? (
        <>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing.lg }]}>GÜLTIG</ThemedText>
          {ok.map((item) => (
            <ItemCard key={item.id} item={item} theme={theme} onPress={() => handleItemPress(item)} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function ItemCard({ item, theme, onPress }: { item: ExpiryItem; theme: any; onPress: () => void }) {
  const color = STATUS_COLOR[item.status];
  return (
    <Pressable onPress={onPress}>
      <Card style={[styles.card, { borderLeftColor: color, borderLeftWidth: 4 }]}>
        <View style={styles.row}>
          <Feather name={iconForCategory(item.category)} size={22} color={color} style={{ marginRight: Spacing.md }} />
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.label}>{item.label}</ThemedText>
            {item.subtitle ? (
              <ThemedText style={[styles.subtitle, { color: theme.textTertiary }]}>{item.subtitle}</ThemedText>
            ) : null}
            <View style={styles.metaRow}>
              <View style={[styles.badge, { backgroundColor: color + "22" }]}>
                <ThemedText style={[styles.badgeText, { color }]}>{STATUS_LABEL[item.status]}</ThemedText>
              </View>
              <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
                {describeStatus(item)}
              </ThemedText>
            </View>
            {item.rawDate ? (
              <ThemedText style={[styles.date, { color: theme.textTertiary }]}>Gültig bis {item.rawDate}</ThemedText>
            ) : null}
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
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
  card: { marginBottom: Spacing.sm, padding: Spacing.md },
  row: { flexDirection: "row", alignItems: "center" },
  label: { fontSize: 15, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: Spacing.xs, gap: Spacing.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 12 },
  date: { fontSize: 11, marginTop: 2 },
});
