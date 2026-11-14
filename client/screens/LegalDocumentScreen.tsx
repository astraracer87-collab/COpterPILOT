import React from "react";
import { StyleSheet, ScrollView } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedView } from "@/components/ThemedView";
import { Spacing } from "@/constants/theme";
import LegalDocumentView from "@/components/LegalDocumentView";
import type { LegalDocument } from "../../shared/legal";
import { TERMS } from "../../shared/terms";
import { IMPRINT } from "../../shared/imprint";
import { WITHDRAWAL } from "../../shared/withdrawal";

export type LegalDocKey = "terms" | "imprint" | "withdrawal";

const DOCS: Record<LegalDocKey, LegalDocument> = {
  terms: TERMS,
  imprint: IMPRINT,
  withdrawal: WITHDRAWAL,
};

/**
 * Generischer Screen für die rechtlichen Dokumente AGB / Impressum /
 * Widerrufsbelehrung. Welches Dokument angezeigt wird, steuert der
 * Navigations-Parameter `doc`.
 */
export default function LegalDocumentScreen({
  route,
}: {
  route: { params?: { doc?: LegalDocKey } };
}) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const doc = DOCS[route.params?.doc ?? "terms"] ?? TERMS;

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
        <LegalDocumentView document={doc} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
});
