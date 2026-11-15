/**
 * Einstellungen → Datenquellen & Lizenzen
 * Alle externen Datenquellen der App, gruppiert, mit Anbieter, Verwendung,
 * Lizenz, Pflicht-Namensnennung und Hinweis auf schriftliche Genehmigungen.
 * Die Daten stammen aus client/lib/dataSources.ts (aus dem Code gebaut).
 */
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { openLink } from "@/lib/webBrowser";
import {
  WRITTEN_PERMISSION_TEXT,
  countryName,
  getDataSourceGroups,
  type DataSourceEntry,
} from "@/lib/dataSources";

function useSafeTabBarHeight(): number {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useBottomTabBarHeight();
  } catch {
    return 0;
  }
}

function SourceCard({ entry }: { entry: DataSourceEntry }) {
  const { theme } = useTheme();
  const countries = entry.countries?.length
    ? entry.countries.map(countryName).join(", ")
    : null;
  return (
    <Card
      style={[styles.card, { marginTop: Spacing.sm }]}
      testID={`data-source-${entry.id}`}
    >
      <ThemedText style={styles.provider}>{entry.provider}</ThemedText>
      {countries ? (
        <ThemedText
          style={[styles.small, { color: theme.textSecondary, marginTop: 2 }]}
        >
          {countries}
        </ThemedText>
      ) : null}

      <View style={styles.field}>
        <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
          Verwendung
        </ThemedText>
        <ThemedText style={styles.small}>{entry.usage}</ThemedText>
      </View>

      {entry.license ? (
        <View style={styles.field}>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            Lizenz
          </ThemedText>
          {entry.licenseUrl ? (
            <Pressable
              onPress={() => openLink(entry.licenseUrl!, entry.license)}
              hitSlop={6}
              style={styles.linkRow}
            >
              <ThemedText
                style={[styles.small, { color: theme.primary, flexShrink: 1 }]}
              >
                {entry.license}
              </ThemedText>
              <Feather name="external-link" size={13} color={theme.primary} />
            </Pressable>
          ) : (
            <ThemedText style={styles.small}>{entry.license}</ThemedText>
          )}
        </View>
      ) : null}

      {entry.attributions?.length ? (
        <View style={styles.field}>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
            Namensnennung
          </ThemedText>
          <View
            style={[
              styles.attrBox,
              { backgroundColor: theme.backgroundSecondary },
            ]}
          >
            {entry.attributions.map((a) => (
              <ThemedText key={a} selectable style={styles.small}>
                {a}
              </ThemedText>
            ))}
          </View>
        </View>
      ) : null}

      {entry.writtenPermission ? (
        <View style={[styles.linkRow, { marginTop: Spacing.sm }]}>
          <Feather name="check-circle" size={14} color="#1B8A2A" />
          <ThemedText
            style={[styles.small, { color: "#1B8A2A", fontWeight: "600" }]}
          >
            {WRITTEN_PERMISSION_TEXT}
          </ThemedText>
        </View>
      ) : null}

      {entry.note ? (
        <ThemedText
          style={[
            styles.small,
            { color: theme.textSecondary, marginTop: Spacing.sm },
          ]}
        >
          {entry.note}
        </ThemedText>
      ) : null}

      {entry.url ? (
        <Pressable
          onPress={() => openLink(entry.url!, entry.provider)}
          hitSlop={6}
          style={[styles.linkRow, { marginTop: Spacing.sm }]}
        >
          <Feather name="globe" size={13} color={theme.primary} />
          <ThemedText
            style={[styles.small, { color: theme.primary, flexShrink: 1 }]}
            numberOfLines={1}
          >
            {entry.url.replace(/^https:\/\//, "").replace(/\/$/, "")}
          </ThemedText>
        </Pressable>
      ) : null}
    </Card>
  );
}

export default function DataSourcesScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useSafeTabBarHeight();
  const groups = useMemo(() => getDataSourceGroups(), []);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        testID="data-sources-scroll"
      >
        <ThemedText
          style={[styles.small, styles.intro, { color: theme.textSecondary }]}
        >
          COpter Pilot nutzt Daten der folgenden Behörden, Vermessungsämter und
          Dienste. Für jede Quelle sind Verwendungszweck, Lizenz und die
          geforderte Namensnennung angegeben. Alle Angaben ohne Gewähr –
          maßgeblich sind die amtlichen Quellen.
        </ThemedText>

        {groups.map((g, i) => (
          <View
            key={g.id}
            style={{ marginTop: i === 0 ? Spacing.md : Spacing["2xl"] }}
          >
            <ThemedText
              style={[styles.sectionTitle, { color: theme.textSecondary }]}
            >
              {g.title.toUpperCase()}
            </ThemedText>
            {g.intro ? (
              <ThemedText
                style={[
                  styles.small,
                  styles.intro,
                  { color: theme.textSecondary },
                ]}
              >
                {g.intro}
              </ThemedText>
            ) : null}
            {g.entries.map((e) => (
              <SourceCard key={e.id} entry={e} />
            ))}
          </View>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  intro: { marginHorizontal: Spacing.xs, marginBottom: Spacing.sm },
  card: { padding: Spacing.lg },
  provider: { ...Typography.body, fontWeight: "600" },
  small: { ...Typography.small },
  label: { ...Typography.caption, fontWeight: "600", marginBottom: 2 },
  field: { marginTop: Spacing.sm },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  attrBox: { padding: Spacing.sm, borderRadius: 8, gap: 2 },
});
