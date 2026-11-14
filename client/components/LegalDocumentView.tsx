import React from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import type { LegalDocument } from "../../shared/legal";
import { LEGAL_PLACEHOLDER_NOTICE } from "../../shared/legal";

/**
 * Generischer Renderer für ein rechtliches Dokument (AGB, Impressum,
 * Widerrufsbelehrung). Spiegelt das Layout des Datenschutz-Screens, damit alle
 * rechtlichen Texte auf Mobile einheitlich aussehen. Platzhalter-Abschnitte und
 * vorformatierte Blöcke (z. B. Muster-Widerrufsformular) werden deutlich
 * hervorgehoben.
 */
export default function LegalDocumentView({
  document,
}: {
  document: LegalDocument;
}) {
  const { theme } = useTheme();

  return (
    <View>
      <ThemedText style={styles.title} testID={`text-${document.id}-title`}>
        {document.title}
      </ThemedText>
      <ThemedText style={[styles.lastUpdated, { color: theme.textTertiary }]}>
        {document.lastUpdated}
      </ThemedText>
      <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
        {document.intro}
      </ThemedText>

      {document.sections.map((section) => (
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

          {section.bullets?.map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <ThemedText style={[styles.bulletDot, { color: theme.primary }]}>•</ThemedText>
              <ThemedText style={[styles.bulletText, { color: theme.textSecondary }]}>
                {b}
              </ThemedText>
            </View>
          ))}

          {section.preformatted ? (
            <Card style={[styles.preformattedCard, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={[styles.preformatted, { color: theme.textSecondary }]}>
                {section.preformatted}
              </ThemedText>
            </Card>
          ) : null}

          {section.isPlaceholder ? (
            <Card
              style={[
                styles.placeholderCard,
                { borderColor: theme.statusCaution, backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <ThemedText style={[styles.placeholderHint, { color: theme.statusCaution }]}>
                {LEGAL_PLACEHOLDER_NOTICE}
              </ThemedText>
              {section.placeholderFields?.map((row) => (
                <View key={row.label} style={styles.placeholderRow}>
                  <ThemedText style={[styles.placeholderLabel, { color: theme.textTertiary }]}>
                    {row.label}
                  </ThemedText>
                  <ThemedText style={styles.placeholderValue}>{row.value}</ThemedText>
                </View>
              ))}
            </Card>
          ) : null}
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
  preformattedCard: {
    padding: Spacing.md,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  preformatted: {
    ...Typography.small,
    fontFamily: "monospace",
    lineHeight: 20,
  },
  bulletRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: Spacing.xs },
  bulletDot: { ...Typography.body, fontWeight: "700" },
  bulletText: { ...Typography.body, flex: 1, lineHeight: 22 },
});
