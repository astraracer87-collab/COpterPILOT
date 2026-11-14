import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  fetchPublicPackages,
  formatPrice,
  type AvailablePackage,
  type FeatureDefinition,
} from "@/lib/subscription";

/**
 * Rein darstellende Paket-Werbeansicht für den Anmelde-/Registrieren-Screen.
 * Zeigt den echten Paket-Katalog (Name, Preis, wichtigste Leistungen) aus
 * `/api/public/packages` — ohne Login, ohne Checkout. Gekauft wird wie bisher
 * erst nach der Anmeldung (Paywall -> Web-Checkout). Rendert nichts, solange
 * geladen wird, ein Fehler auftrat oder (noch) keine Pakete buchbar sind, damit
 * der Anmelde-Flow voll nutzbar bleibt.
 */
export default function PackagesPromo() {
  const { theme } = useTheme();
  const [packages, setPackages] = useState<AvailablePackage[]>([]);
  const [catalog, setCatalog] = useState<FeatureDefinition[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchPublicPackages()
      .then((data) => {
        if (cancelled) return;
        setPackages(data.packages ?? []);
        setCatalog(data.featureCatalog ?? []);
      })
      .catch(() => {
        // Werbung ist optional — bei Fehler bleibt der Bereich leer.
        if (!cancelled) setPackages([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const featureName = useMemo(() => {
    const map = new Map<string, string>();
    catalog.forEach((f) => map.set(f.key, f.name));
    return (key: string) => map.get(key) ?? key;
  }, [catalog]);

  if (packages.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <View style={styles.heading}>
        <ThemedText style={styles.headingTitle}>Unsere Pakete</ThemedText>
        <ThemedText style={[styles.headingSub, { color: theme.textSecondary }]}>
          Alle Pre-Flight-Check-Funktionen freischalten. Jederzeit kündbar.
        </ThemedText>
      </View>

      {packages.map((pkg) => {
        const price = pkg.prices[0]
          ? formatPrice(pkg.prices[0].amount, pkg.prices[0].currency, pkg.prices[0].interval)
          : null;
        return (
          <Card key={pkg.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <ThemedText style={styles.cardTitle}>{pkg.name}</ThemedText>
              {price ? (
                <ThemedText style={[styles.cardPrice, { color: theme.primary }]}>
                  {price}
                </ThemedText>
              ) : null}
            </View>
            {pkg.description ? (
              <ThemedText style={[styles.cardDesc, { color: theme.textSecondary }]}>
                {pkg.description}
              </ThemedText>
            ) : null}
            {pkg.features.length > 0 ? (
              <View style={styles.featureList}>
                {pkg.features.map((key) => (
                  <View key={key} style={styles.featureRow}>
                    <Feather name="check" size={15} color={theme.statusGo} />
                    <ThemedText style={[styles.featureText, { color: theme.text }]}>
                      {featureName(key)}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}

      <ThemedText style={[styles.footnote, { color: theme.textTertiary }]}>
        Buchbar nach der Anmeldung.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginTop: Spacing.lg, gap: Spacing.md },
  heading: { alignItems: "center", gap: 4 },
  headingTitle: { ...Typography.h3, fontWeight: "700" },
  headingSub: { ...Typography.small, textAlign: "center", lineHeight: 18 },
  card: { padding: Spacing.lg, gap: Spacing.sm },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  cardTitle: { ...Typography.body, fontWeight: "700", flexShrink: 1 },
  cardPrice: { ...Typography.body, fontWeight: "700" },
  cardDesc: { ...Typography.small, lineHeight: 18 },
  featureList: { gap: 6, marginTop: 2 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { ...Typography.small, flexShrink: 1 },
  footnote: { ...Typography.small, textAlign: "center" },
});
