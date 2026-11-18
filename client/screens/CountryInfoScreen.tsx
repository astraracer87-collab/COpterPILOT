import React from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { COUNTRY_INFO } from "@/lib/countryInfo";
import { COUNTRY_DRONE_RULES } from "../../shared/countryDroneRules";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type Nav = NativeStackNavigationProp<SettingsStackParamList, "CountryInfo">;

export default function CountryInfoScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();

  // Union aus den ausführlich gepflegten Ländern (COUNTRY_INFO) und den
  // weltweiten Reise-Check-Ländern (COUNTRY_DRONE_RULES), dedupliziert nach ISO.
  const countries = React.useMemo(() => {
    const byIso = new Map<string, { iso: string; name: string; detailed: boolean }>();
    for (const r of COUNTRY_DRONE_RULES) byIso.set(r.code, { iso: r.code, name: r.name, detailed: false });
    for (const c of COUNTRY_INFO) byIso.set(c.iso, { iso: c.iso, name: c.name, detailed: true });
    return [...byIso.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, []);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing["2xl"],
          paddingHorizontal: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
          Wähle ein Land, um Rules &amp; Regulations für Drohnenflüge zu sehen:
          EU-Basics, nationale Besonderheiten, Pflichten und offizielle Karten.
        </ThemedText>

        {countries.map((c) => (
          <Pressable
            key={c.iso}
            onPress={() => navigation.navigate("CountryDetail", { iso: c.iso })}
            testID={`country-${c.iso}`}
          >
            <Card style={styles.row}>
              <View style={[styles.flagBadge, { backgroundColor: theme.primary + "18" }]}>
                <ThemedText style={[styles.flagText, { color: theme.primary }]}>{c.iso}</ThemedText>
              </View>
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <ThemedText style={styles.title}>{c.name}</ThemedText>
                <ThemedText
                  style={[styles.subtitle, { color: theme.textSecondary }]}
                  numberOfLines={2}
                >
                  {c.detailed ? "Rules & Regulations · ausführlich" : "Rules & Regulations"}
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={20} color={theme.textTertiary} />
            </Card>
          </Pressable>
        ))}

        <ThemedText style={[styles.disclaimer, { color: theme.textTertiary }]}>
          Stand: 2026. Angaben ohne Gewähr — vor Reisen die offizielle Behörden-
          Seite des Ziellandes prüfen.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  intro: { ...Typography.body, marginBottom: Spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  flagBadge: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  flagText: { fontWeight: "800", letterSpacing: 0.5, fontSize: 15 },
  title: { ...Typography.h4 },
  subtitle: { ...Typography.caption, marginTop: 2 },
  disclaimer: {
    fontSize: 11,
    fontStyle: "italic",
    marginTop: Spacing.lg,
    textAlign: "center",
  },
});
