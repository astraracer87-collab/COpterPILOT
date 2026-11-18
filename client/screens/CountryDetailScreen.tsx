import { openLink } from "@/lib/webBrowser";
import React, { useLayoutEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getCountryInfo } from "@/lib/countryInfo";
import { getCountryDroneRule } from "../../shared/countryDroneRules";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type RouteT = RouteProp<SettingsStackParamList, "CountryDetail">;
type NavT = NativeStackNavigationProp<SettingsStackParamList, "CountryDetail">;

export default function CountryDetailScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteT>();
  const navigation = useNavigation<NavT>();
  const country = getCountryInfo(route.params.iso);
  const rule = getCountryDroneRule(route.params.iso);
  const displayName = country?.name ?? rule?.name ?? "Land";

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: displayName });
  }, [navigation, displayName]);

  if (!country && !rule) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={{ padding: Spacing.lg, color: theme.textSecondary }}>
          Land nicht gefunden.
        </ThemedText>
      </ThemedView>
    );
  }

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
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={[styles.flagBadge, { backgroundColor: theme.primary + "18" }]}>
              <ThemedText style={[styles.flagText, { color: theme.primary }]}>
                {country?.iso ?? rule?.code ?? route.params.iso}
              </ThemedText>
            </View>
            <ThemedText style={styles.title}>{displayName}</ThemedText>
          </View>
          {country?.summary ? (
            <ThemedText style={[styles.summary, { color: theme.textSecondary }]}>
              {country.summary}
            </ThemedText>
          ) : null}
        </Card>

        {country ? (
        <>
        <SectionTitle theme={theme}>RULES &amp; REGULATIONS</SectionTitle>
        <Card style={styles.card}>
          <Row icon="users" label="Mindestalter" value={country.minAge} theme={theme} />
          <Row icon="shield" label="Versicherung" value={country.insurance} theme={theme} />
          <Row icon="moon" label="Nachtflug" value={country.nightFlight} theme={theme} />
          <Row icon="trending-up" label="Max. Flughöhe" value={country.maxAltitudeM} theme={theme} />
          <Row icon="user-check" label="Registrierung" value={country.registration} theme={theme} />
        </Card>

        <SectionTitle theme={theme}>BESONDERHEITEN</SectionTitle>
        <Card style={styles.card}>
          {country.specialNotes.map((n, i) => (
            <View key={i} style={[styles.bulletRow, i > 0 && { marginTop: Spacing.sm }]}>
              <ThemedText style={[styles.bulletDot, { color: theme.primary }]}>•</ThemedText>
              <ThemedText style={[styles.bulletText, { color: theme.text }]}>{n}</ThemedText>
            </View>
          ))}
        </Card>

        {country.iso === "IT" ? (
          <>
            <SectionTitle theme={theme}>D-FLIGHT REGISTRIERUNG</SectionTitle>
            <Pressable
              onPress={() => navigation.navigate("DflightItalyGuide")}
              testID="link-dflight-it-guide"
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Card style={styles.card}>
                <View style={styles.guideRow}>
                  <View style={[styles.guideBadge, { backgroundColor: theme.primary + "18" }]}>
                    <Feather name="grid" size={18} color={theme.primary} />
                  </View>
                  <View style={{ flex: 1, marginLeft: Spacing.md }}>
                    <ThemedText style={[styles.guideTitle, { color: theme.text }]}>
                      Anleitung: D-Flight QR-Code
                    </ThemedText>
                    <ThemedText
                      style={[styles.bulletText, { color: theme.textSecondary }]}
                      numberOfLines={2}
                    >
                      Schritt für Schritt zur Registrierung und zum QR-Code für Flüge in Italien.
                    </ThemedText>
                  </View>
                  <Feather name="chevron-right" size={20} color={theme.textTertiary} />
                </View>
              </Card>
            </Pressable>
          </>
        ) : null}

        <SectionTitle theme={theme}>VOR DEM START</SectionTitle>
        <Card style={styles.card}>
          {country.checklist.map((n, i) => (
            <View key={i} style={[styles.bulletRow, i > 0 && { marginTop: Spacing.sm }]}>
              <Feather
                name="check"
                size={15}
                color={theme.primary}
                style={{ marginTop: 3 }}
              />
              <ThemedText style={[styles.bulletText, { color: theme.text, marginLeft: 8 }]}>
                {n}
              </ThemedText>
            </View>
          ))}
        </Card>

        <SectionTitle theme={theme}>OFFIZIELLE KARTE / APP</SectionTitle>
        <Card style={styles.card}>
          <LinkRow icon="map" label={country.noFlyApp.name} url={country.noFlyApp.url} theme={theme} />
        </Card>

        <SectionTitle theme={theme}>BEHÖRDE</SectionTitle>
        <Card style={styles.card}>
          {country.authority.url ? (
            <LinkRow
              icon="external-link"
              label={country.authority.name}
              url={country.authority.url}
              theme={theme}
            />
          ) : (
            <ThemedText style={[styles.bulletText, { color: theme.text }]}>
              {country.authority.name}
            </ThemedText>
          )}
          {country.authority.email ? (
            <LinkRow
              icon="mail"
              label={country.authority.email}
              url={`mailto:${country.authority.email}`}
              theme={theme}
            />
          ) : null}
        </Card>

        </>
        ) : null}

        {rule ? (
          <>
            <SectionTitle theme={theme}>LÄNDERHINWEISE (REISE-CHECK)</SectionTitle>
            <Card style={styles.card}>
              {rule.maxAltitude != null ? (
                <Row
                  icon="trending-up"
                  label="Max. Flughöhe"
                  value={`${rule.maxAltitude} m über Grund`}
                  theme={theme}
                />
              ) : null}
              <Row
                icon="user-check"
                label="Registrierung"
                value={rule.registrationRequired ? "erforderlich" : "nicht erforderlich"}
                theme={theme}
              />
              <Row
                icon="shield"
                label="Versicherung"
                value={rule.insuranceRequired ? "Pflicht" : "keine Pflicht"}
                theme={theme}
              />
            </Card>
            {rule.rules.length > 0 ? (
              <Card style={styles.card}>
                {rule.rules.map((n, i) => (
                  <View key={i} style={[styles.bulletRow, i > 0 && { marginTop: Spacing.sm }]}>
                    <ThemedText style={[styles.bulletDot, { color: theme.primary }]}>•</ThemedText>
                    <ThemedText style={[styles.bulletText, { color: theme.text }]}>{n}</ThemedText>
                  </View>
                ))}
              </Card>
            ) : null}
            {rule.sourceUrl ? (
              <Card style={styles.card}>
                <LinkRow icon="external-link" label="Offizielle Quelle" url={rule.sourceUrl} theme={theme} />
              </Card>
            ) : null}
          </>
        ) : null}

        <ThemedText style={[styles.disclaimer, { color: theme.textTertiary }]}>
          Stand: 2026. Angaben ohne Gewähr.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

function Row({ icon, label, value, theme }: { icon: any; label: string; value: string; theme: any }) {
  return (
    <View style={styles.dataRow}>
      <Feather name={icon} size={16} color={theme.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, marginLeft: Spacing.sm }}>
        <ThemedText style={[styles.rowLabel, { color: theme.textTertiary }]}>{label}</ThemedText>
        <ThemedText style={[styles.rowValue, { color: theme.text }]}>{value}</ThemedText>
      </View>
    </View>
  );
}

function LinkRow({ icon, label, url, theme }: { icon: any; label: string; url: string; theme: any }) {
  return (
    <Pressable
      onPress={() => openLink(url)}
      style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.6 }]}
    >
      <Feather name={icon} size={16} color={theme.primary} />
      <ThemedText style={[styles.linkLabel, { color: theme.primary }]}>{label}</ThemedText>
    </Pressable>
  );
}

function SectionTitle({ children, theme }: { children: React.ReactNode; theme: any }) {
  return (
    <ThemedText
      style={[
        styles.sectionTitle,
        { color: theme.textSecondary, marginTop: Spacing.lg, marginBottom: Spacing.xs },
      ]}
    >
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerCard: { padding: Spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  flagBadge: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  flagText: { fontWeight: "800", letterSpacing: 0.5, fontSize: 15 },
  title: { ...Typography.h3 },
  summary: { ...Typography.body, lineHeight: 20, marginTop: Spacing.md },
  card: { padding: Spacing.lg },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "800",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.xs,
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: Spacing.sm,
  },
  rowLabel: {
    ...Typography.caption,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  rowValue: { ...Typography.body, lineHeight: 20 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start" },
  bulletDot: { fontWeight: "800", width: 14, lineHeight: 20 },
  bulletText: { ...Typography.body, flex: 1, lineHeight: 20 },
  guideRow: { flexDirection: "row", alignItems: "center" },
  guideBadge: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  guideTitle: { ...Typography.body, fontWeight: "700", marginBottom: 2 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: 6,
  },
  linkLabel: { ...Typography.body, fontWeight: "600", flex: 1 },
  disclaimer: {
    fontSize: 11,
    fontStyle: "italic",
    marginTop: Spacing.lg,
    textAlign: "center",
  },
});
