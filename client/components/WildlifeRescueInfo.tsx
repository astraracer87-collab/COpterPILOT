import { openLink } from "@/lib/webBrowser";
import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  Linking,
} from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import {
  WILDLIFE_RESCUE_MODE_TITLE,
  WILDLIFE_RESCUE_INFO_INTRO,
  WILDLIFE_RESCUE_DISCLAIMER,
  WILDLIFE_RESCUE_ORDINANCES,
} from "../../shared/wildlifeRescue";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WildlifeRescueInfoModal({ visible, onClose }: Props) {
  const { theme } = useTheme();

  const openUrl = (url: string) => {
    openLink(url).catch(() => {});
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <View style={styles.header}>
            <ThemedText
              type="h3"
              style={styles.headerTitle}
              testID="text-wildlife-info-title"
            >
              {WILDLIFE_RESCUE_MODE_TITLE}
            </ThemedText>
          </View>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <ThemedText
              style={[styles.intro, { color: theme.textSecondary }]}
            >
              {WILDLIFE_RESCUE_INFO_INTRO}
            </ThemedText>

            {WILDLIFE_RESCUE_ORDINANCES.map((ord) => (
              <View
                key={ord.id}
                style={[
                  styles.card,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderColor: theme.border,
                  },
                ]}
                testID={`card-wildlife-ordinance-${ord.id}`}
              >
                <ThemedText
                  style={[styles.authority, { color: theme.primary }]}
                >
                  {ord.authority}
                </ThemedText>
                <ThemedText style={styles.ordTitle}>{ord.title}</ThemedText>
                <ThemedText
                  style={[styles.label, { color: theme.textSecondary }]}
                >
                  Geltungsbereich
                </ThemedText>
                <ThemedText
                  style={[styles.body, { color: theme.textSecondary }]}
                >
                  {ord.scope}
                </ThemedText>
                <ThemedText
                  style={[styles.label, { color: theme.textSecondary }]}
                >
                  Wichtige Auflagen
                </ThemedText>
                {ord.conditions.map((c, i) => (
                  <View key={i} style={styles.bulletRow}>
                    <ThemedText
                      style={[styles.bullet, { color: theme.textSecondary }]}
                    >
                      {"\u2022"}
                    </ThemedText>
                    <ThemedText
                      style={[
                        styles.bulletText,
                        { color: theme.textSecondary },
                      ]}
                    >
                      {c}
                    </ThemedText>
                  </View>
                ))}
                <Pressable
                  onPress={() => openUrl(ord.sourceUrl)}
                  style={styles.sourceRow}
                  testID={`link-wildlife-source-${ord.id}`}
                >
                  <ThemedText style={[styles.source, { color: theme.primary }]}>
                    Quelle: {ord.sourceLabel}
                  </ThemedText>
                </Pressable>
              </View>
            ))}

            <ThemedText
              style={[styles.disclaimer, { color: theme.textTertiary }]}
            >
              {WILDLIFE_RESCUE_DISCLAIMER}
            </ThemedText>
          </ScrollView>
          <View style={styles.footer}>
            <Button
              title="Schließen"
              onPress={onClose}
              testID="button-wildlife-info-close"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.lg,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    textAlign: "center",
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  authority: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: Spacing.xs,
  },
  ordTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: Spacing.xs,
  },
  bullet: {
    fontSize: 14,
    lineHeight: 20,
    marginRight: Spacing.sm,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  sourceRow: {
    marginTop: Spacing.sm,
  },
  source: {
    fontSize: 14,
    fontWeight: "600",
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: "italic",
    marginTop: Spacing.sm,
  },
  footer: {
    padding: Spacing.lg,
  },
});
