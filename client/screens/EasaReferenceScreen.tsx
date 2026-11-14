import { openLink } from "@/lib/webBrowser";
import React, { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Platform,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";
import Animated, { FadeInDown } from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  EASA_GEO_ZONE_LEGEND,
  EASA_OPEN_CATEGORY_TABLE,
  EASA_SPECIFIC_CATEGORY,
  EASA_INSURANCE,
  EASA_TRAVELLING,
  EASA_FPV,
  EasaTopicSection,
} from "@/lib/categoryAdvice";

const ZONE_COLORS: Record<string, string> = {
  red: "#C53030",
  yellow: "#D97706",
  green: "#2D8659",
  blue: "#0A4D8C",
};

type SectionKey =
  | "geozones"
  | "open"
  | "specific"
  | "insurance"
  | "travelling"
  | "fpv";

const SECTION_ORDER: { key: SectionKey; title: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "geozones", title: "Geo-Zonen — Farblegende", icon: "map-pin" },
  { key: "open", title: "Offene Kategorie (Stand 1.1.2024)", icon: "grid" },
  { key: "specific", title: "Spezielle Kategorie", icon: "file-text" },
  { key: "insurance", title: EASA_INSURANCE.title, icon: "shield" },
  { key: "travelling", title: EASA_TRAVELLING.title, icon: "navigation" },
  { key: "fpv", title: EASA_FPV.title, icon: "eye" },
];

export default function EasaReferenceScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [expanded, setExpanded] = useState<Set<SectionKey>>(
    new Set<SectionKey>(["geozones"]),
  );

  const toggle = (key: SectionKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openLink = async (url: string) => {
    try {
      if (Platform.OS === "web") {
        openLink(url);
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch {
      openLink(url);
    }
  };

  const renderLinkButton = (link?: { label: string; url: string }) => {
    if (!link) return null;
    return (
      <Pressable
        onPress={() => openLink(link.url)}
        style={[styles.linkButton, { borderColor: theme.border }]}
        testID={`easa-link-${link.url}`}
      >
        <Feather name="external-link" size={14} color={theme.primary} />
        <ThemedText style={[styles.linkButtonText, { color: theme.primary }]}>
          {link.label}
        </ThemedText>
      </Pressable>
    );
  };

  const renderTopicSection = (section: EasaTopicSection) => (
    <View style={styles.sectionBody}>
      {section.paragraphs.map((p, i) => (
        <ThemedText
          key={i}
          style={[styles.paragraph, { color: theme.textSecondary }]}
        >
          {p}
        </ThemedText>
      ))}
      {renderLinkButton(section.link)}
    </View>
  );

  const renderGeoZones = () => (
    <View style={styles.sectionBody}>
      <ThemedText style={[styles.paragraph, { color: theme.textSecondary }]}>
        Mitgliedstaaten können geografische UAS-Gebiete (Geo-Zonen) festlegen. Die EASA verwendet zur Darstellung eine einheitliche Farbcodierung:
      </ThemedText>
      {EASA_GEO_ZONE_LEGEND.map((item) => (
        <View
          key={item.color}
          style={[styles.zoneRow, { borderColor: theme.border }]}
        >
          <View
            style={[
              styles.zoneSwatch,
              { backgroundColor: ZONE_COLORS[item.color] },
            ]}
          />
          <View style={styles.zoneContent}>
            <ThemedText style={styles.zoneTitle}>{item.title}</ThemedText>
            <ThemedText style={[styles.zoneEnglish, { color: theme.textTertiary }]}>
              {item.englishTerm}
            </ThemedText>
            <ThemedText style={[styles.zoneDesc, { color: theme.textSecondary }]}>
              {item.description}
            </ThemedText>
          </View>
        </View>
      ))}
      <ThemedText style={[styles.note, { color: theme.textTertiary }]}>
        Hinweis: Es liegt in der Verantwortung des Fernpiloten, vor jedem Flug die aktuellen Geo-Zonen über die nationale Luftfahrtbehörde zu prüfen.
      </ThemedText>
      {renderLinkButton({
        label: "EASA — Geo-Zonen",
        url: "https://www.easa.europa.eu/light/topics/geo-zones-know-where-fly-your-drone",
      })}
    </View>
  );

  const renderOpenCategory = () => (
    <View style={styles.sectionBody}>
      <ThemedText style={[styles.paragraph, { color: theme.textSecondary }]}>
        Die offene Kategorie umfasst risikoarme Flüge ohne vorherige Genehmigung. Gemeinsame Regeln: max. 120 m über Grund, stets in Sichtweite (VLOS), nicht über Menschenansammlungen, Geo-Zonen beachten.
      </ThemedText>
      {EASA_OPEN_CATEGORY_TABLE.map((row, idx) => (
        <View
          key={idx}
          style={[styles.openCard, { backgroundColor: theme.backgroundSecondary }]}
        >
          <View style={styles.openHeaderRow}>
            <ThemedText style={styles.openClass}>{row.classLabel}</ThemedText>
            <View style={[styles.subBadge, { backgroundColor: theme.primary + "1A" }]}>
              <ThemedText style={[styles.subBadgeText, { color: theme.primary }]}>
                {row.subcategory}
              </ThemedText>
            </View>
          </View>
          {renderOpenField("Betriebsgrenzen", row.operationalLimits)}
          {renderOpenField("Betreiber-Registrierung", row.operatorRegistration)}
          {renderOpenField("Pilotenkompetenz", row.pilotCompetency)}
          {renderOpenField("Mindestalter", row.minAge)}
        </View>
      ))}
      {renderLinkButton({
        label: "EASA — Offene Kategorie",
        url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/open-category-low-risk-civil-drones",
      })}
    </View>
  );

  const renderOpenField = (label: string, value: string) => (
    <View style={styles.openField}>
      <ThemedText style={[styles.openFieldLabel, { color: theme.textTertiary }]}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.openFieldValue, { color: theme.textSecondary }]}>
        {value}
      </ThemedText>
    </View>
  );

  const renderSpecific = () => (
    <View style={styles.sectionBody}>
      <ThemedText style={[styles.paragraph, { color: theme.textSecondary }]}>
        {EASA_SPECIFIC_CATEGORY.intro}
      </ThemedText>
      <ThemedText style={styles.subHeading}>Wann sie gilt</ThemedText>
      {EASA_SPECIFIC_CATEGORY.whenApplies.map((w, i) => (
        <View key={i} style={styles.bulletRow}>
          <Feather name="chevron-right" size={14} color={theme.primary} />
          <ThemedText style={[styles.bulletText, { color: theme.textSecondary }]}>
            {w}
          </ThemedText>
        </View>
      ))}
      <ThemedText style={styles.subHeading}>Die vier Wege zur Zulassung</ThemedText>
      {EASA_SPECIFIC_CATEGORY.routes.map((route) => (
        <View
          key={route.key}
          style={[styles.routeCard, { backgroundColor: theme.backgroundSecondary }]}
        >
          <ThemedText style={styles.routeTitle}>{route.title}</ThemedText>
          <ThemedText style={[styles.routeDesc, { color: theme.textSecondary }]}>
            {route.description}
          </ThemedText>
        </View>
      ))}
      <ThemedText style={styles.subHeading}>Betriebshandbuch</ThemedText>
      <ThemedText style={[styles.paragraph, { color: theme.textSecondary }]}>
        {EASA_SPECIFIC_CATEGORY.operationsManual}
      </ThemedText>
      <ThemedText style={styles.subHeading}>Registrierung</ThemedText>
      <ThemedText style={[styles.paragraph, { color: theme.textSecondary }]}>
        {EASA_SPECIFIC_CATEGORY.registration}
      </ThemedText>
      {renderLinkButton({
        label: "EASA — Spezielle Kategorie",
        url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/specific-category-civil-drones",
      })}
    </View>
  );

  const renderSectionBody = (key: SectionKey) => {
    switch (key) {
      case "geozones":
        return renderGeoZones();
      case "open":
        return renderOpenCategory();
      case "specific":
        return renderSpecific();
      case "insurance":
        return renderTopicSection(EASA_INSURANCE);
      case "travelling":
        return renderTopicSection(EASA_TRAVELLING);
      case "fpv":
        return renderTopicSection(EASA_FPV);
      default:
        return null;
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing["3xl"],
          paddingHorizontal: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <Animated.View entering={FadeInDown.duration(300)}>
          <ThemedText style={[styles.headerNote, { color: theme.textSecondary }]}>
            Übersicht der EU-weiten Drohnenregeln nach EASA (EU 2019/947 & 2019/945). Zusammenfassung der frei abrufbaren EASA-Inhalte — keine Rechtsberatung.
          </ThemedText>
        </Animated.View>

        {SECTION_ORDER.map((section, idx) => {
          const isExpanded = expanded.has(section.key);
          return (
            <Animated.View
              key={section.key}
              entering={FadeInDown.delay(idx * 50).duration(300)}
            >
              <Card style={styles.sectionCard}>
                <Pressable
                  onPress={() => toggle(section.key)}
                  style={styles.sectionHeader}
                  testID={`easa-section-${section.key}`}
                >
                  <Feather name={section.icon} size={20} color={theme.primary} />
                  <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={theme.textTertiary}
                  />
                </Pressable>
                {isExpanded ? renderSectionBody(section.key) : null}
              </Card>
            </Animated.View>
          );
        })}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerNote: {
    ...Typography.small,
    textAlign: "center",
    marginBottom: Spacing.xl,
    lineHeight: 20,
  },
  sectionCard: { marginBottom: Spacing.md, overflow: "hidden" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  sectionTitle: { ...Typography.callout, fontWeight: "700", flex: 1 },
  sectionBody: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  paragraph: { ...Typography.small, lineHeight: 20 },
  note: { ...Typography.caption, lineHeight: 18, fontStyle: "italic", marginTop: Spacing.xs },
  subHeading: {
    ...Typography.callout,
    fontWeight: "700",
    marginTop: Spacing.sm,
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  linkButtonText: { ...Typography.caption, fontWeight: "600" },
  zoneRow: {
    flexDirection: "row",
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.md,
  },
  zoneSwatch: { width: 18, height: 18, borderRadius: 5, marginTop: 2 },
  zoneContent: { flex: 1, gap: 2 },
  zoneTitle: { ...Typography.callout, fontWeight: "700" },
  zoneEnglish: { ...Typography.caption, fontStyle: "italic" },
  zoneDesc: { ...Typography.small, lineHeight: 19, marginTop: 2 },
  openCard: { borderRadius: 12, padding: Spacing.md, gap: Spacing.sm },
  openHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  openClass: { ...Typography.callout, fontWeight: "700", flex: 1 },
  subBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  subBadgeText: { ...Typography.caption, fontWeight: "700" },
  openField: { gap: 2 },
  openFieldLabel: { ...Typography.caption, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  openFieldValue: { ...Typography.small, lineHeight: 19 },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  bulletText: { ...Typography.small, lineHeight: 20, flex: 1 },
  routeCard: { borderRadius: 12, padding: Spacing.md, gap: 4 },
  routeTitle: { ...Typography.callout, fontWeight: "700" },
  routeDesc: { ...Typography.small, lineHeight: 20 },
});
