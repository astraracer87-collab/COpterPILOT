import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import {
  PRIVACY_POLICY_TITLE,
  PRIVACY_POLICY_INTRO,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_CONTROLLER_PLACEHOLDER,
} from "../../shared/privacyPolicy";

/**
 * Renderer für den Datenschutz-Text. Aus dem PrivacyPolicyScreen extrahiert,
 * damit derselbe Inhalt sowohl im Navigations-Screen als auch im Login-Gate
 * (außerhalb des Navigators, ohne useHeaderHeight) wiederverwendbar ist.
 */
export default function PrivacyPolicyView() {
  const { theme } = useTheme();

  return (
    <View>
      <ThemedText style={styles.title} testID="text-privacy-title">
        {PRIVACY_POLICY_TITLE}
      </ThemedText>
      <ThemedText style={[styles.lastUpdated, { color: theme.textTertiary }]}>
        {PRIVACY_POLICY_LAST_UPDATED}
      </ThemedText>
      <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
        {PRIVACY_POLICY_INTRO}
      </ThemedText>

      {PRIVACY_POLICY_SECTIONS.map((section) => (
        <View key={section.id} style={styles.section} testID={`section-${section.id}`}>
          <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>

          {section.paragraphs?.map((p, i) => (
            <ThemedText
              key={i}
              style={[styles.paragraph, { color: theme.textSecondary }]}
            >
              {p}
            </ThemedText>
          ))}

          {section.isPlaceholder ? (
            <Card
              style={[
                styles.placeholderCard,
                { borderColor: theme.statusCaution, backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <ThemedText style={[styles.placeholderHint, { color: theme.statusCaution }]}>
                Vom Betreiber auszufüllen
              </ThemedText>
              {PRIVACY_CONTROLLER_PLACEHOLDER.map((row) => (
                <View key={row.label} style={styles.placeholderRow}>
                  <ThemedText style={[styles.placeholderLabel, { color: theme.textTertiary }]}>
                    {row.label}
                  </ThemedText>
                  <ThemedText style={styles.placeholderValue}>{row.value}</ThemedText>
                </View>
              ))}
            </Card>
          ) : null}

          {section.bullets?.map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <ThemedText style={[styles.bulletDot, { color: theme.primary }]}>•</ThemedText>
              <ThemedText style={[styles.bulletText, { color: theme.textSecondary }]}>
                {b}
              </ThemedText>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.h2, marginBottom: Spacing.xs },
  lastUpdated: { ...Typography.small, marginBottom: Spacing.lg },
  intro: { ...Typography.body, marginBottom: Spacing.xl, lineHeight: 22 },
  section: { marginBottom: Spacing.xl },
  sectionTitle: { ...Typography.h3, marginBottom: Spacing.sm },
  paragraph: { ...Typography.body, lineHeight: 22, marginBottom: Spacing.sm },
  placeholderCard: {
    borderWidth: 1,
    padding: Spacing.md,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  placeholderHint: {
    ...Typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  placeholderRow: { gap: 2 },
  placeholderLabel: { ...Typography.small },
  placeholderValue: { ...Typography.body, fontWeight: "600" },
  bulletRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.xs },
  bulletDot: { ...Typography.body, fontWeight: "700" },
  bulletText: { ...Typography.body, flex: 1, lineHeight: 22 },
});
