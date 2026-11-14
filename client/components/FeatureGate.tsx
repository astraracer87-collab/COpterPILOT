import { openLink } from "@/lib/webBrowser";
import React from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { entitlementHasFeature, getSubscribeUrl } from "@/lib/subscription";
import { featureLockName, featureLockDescription } from "@/lib/featureLockText";

/**
 * Feinkörniges Feature-Gating für die App (Pendant zur Server-Prüfung
 * `requireFeature`). Statt leerer Bildschirme oder stiller Fehler zeigt die App
 * einen deutlichen Upgrade-Hinweis mit Weg in den Browser-Checkout.
 *
 * - `useFeatureAccess(key)`  -> boolean (entitlement-basiert).
 * - `FeatureLockCard`        -> Karte mit Upgrade-Hinweis + Button.
 * - `FeatureGate`            -> rendert Kinder nur bei Zugriff, sonst die Karte.
 * - `promptFeatureUpgrade()` -> Alert für aktionsgebundene Sperren (Buttons,
 *   Exporte) — gibt true zurück, wenn der Zugriff besteht.
 */

/** Öffnet den Browser-Checkout (Bezahlung läuft im Web). */
export function openUpgrade(): void {
  const url = getSubscribeUrl();
  openLink(url).catch(() => {
    Alert.alert(
      "Upgrade im Browser",
      "Bitte öffne die Web-App, um dein Paket zu ändern.",
    );
  });
}

/** Hook: hat der eingeloggte Nutzer Zugriff auf das Feature? */
export function useFeatureAccess(featureKey: string): boolean {
  const { entitlement } = useAuth();
  return entitlementHasFeature(entitlement, featureKey);
}

function featureName(featureKey: string): string {
  return featureLockName(featureKey);
}

/**
 * Aktionsgebundene Sperre: bei fehlendem Zugriff erscheint ein Alert mit
 * Upgrade-Option und es wird `false` zurückgegeben (Aufrufer bricht ab).
 * Bei Zugriff wird `true` zurückgegeben (Aktion läuft weiter).
 */
export function promptFeatureUpgrade(
  entitlement: Parameters<typeof entitlementHasFeature>[0],
  featureKey: string,
): boolean {
  if (entitlementHasFeature(entitlement, featureKey)) return true;
  const name = featureName(featureKey);
  Alert.alert(
    `${name} nicht im Tarif enthalten`,
    `${name} ist in deinem aktuellen Paket nicht enthalten. Mit einem Upgrade schaltest du diese Funktion frei.`,
    [
      { text: "Abbrechen", style: "cancel" },
      { text: "Upgrade ansehen", onPress: openUpgrade },
    ],
  );
  return false;
}

export interface FeatureLockCardProps {
  featureKey: string;
  /** Optionaler Titel-Override (Standard: Feature-Name). */
  title?: string;
  /** Optionale zusätzliche Beschreibung (Standard: Katalog-Beschreibung). */
  description?: string;
  /** true = kompakte Inline-Variante (kein großes zentriertes Layout). */
  compact?: boolean;
  testID?: string;
}

/** Karte mit Schloss-Icon, deutschem Upgrade-Hinweis und Button. */
export function FeatureLockCard({
  featureKey,
  title,
  description,
  compact,
  testID,
}: FeatureLockCardProps) {
  const { theme } = useTheme();
  const heading = title ?? featureLockName(featureKey);
  const body = description ?? featureLockDescription(featureKey);

  return (
    <View
      style={[
        styles.card,
        compact ? styles.cardCompact : styles.cardFull,
        { backgroundColor: theme.backgroundDefault, borderColor: theme.border },
      ]}
      testID={testID ?? `feature-lock-${featureKey}`}
    >
      <View
        style={[styles.iconCircle, { backgroundColor: theme.statusCautionBackground }]}
      >
        <Feather name="lock" size={compact ? 20 : 28} color={theme.statusCaution} />
      </View>
      <ThemedText type={compact ? "h4" : "h3"} style={styles.heading}>
        {heading}
      </ThemedText>
      <ThemedText type="small" style={[styles.body, { color: theme.textSecondary }]}>
        {body}
      </ThemedText>
      <ThemedText type="small" style={[styles.hint, { color: theme.textTertiary }]}>
        Mit einem Upgrade deines Pakets schaltest du diese Funktion frei.
      </ThemedText>
      <Pressable
        onPress={openUpgrade}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
        ]}
        testID={`button-upgrade-${featureKey}`}
        accessibilityRole="button"
      >
        <Feather name="arrow-up-circle" size={18} color="#FFFFFF" />
        <ThemedText style={styles.buttonText}>Upgrade ansehen</ThemedText>
      </Pressable>
    </View>
  );
}

export interface FeatureGateProps {
  featureKey: string;
  children: React.ReactNode;
  /** Inhalt während der Abo-Status noch lädt (Standard: nichts). */
  fallbackWhileLoading?: React.ReactNode;
  compact?: boolean;
  title?: string;
  description?: string;
}

/** Rendert Kinder nur bei Feature-Zugriff, sonst die Upgrade-Karte. */
export function FeatureGate({
  featureKey,
  children,
  fallbackWhileLoading = null,
  compact,
  title,
  description,
}: FeatureGateProps) {
  const { entitlement, status } = useAuth();
  if (status === "loading") return <>{fallbackWhileLoading}</>;
  if (entitlementHasFeature(entitlement, featureKey)) return <>{children}</>;
  return (
    <FeatureLockCard
      featureKey={featureKey}
      compact={compact}
      title={title}
      description={description}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  cardFull: {
    padding: Spacing.xl,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.lg,
  },
  cardCompact: {
    padding: Spacing.lg,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  heading: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  body: {
    textAlign: "center",
    lineHeight: 20,
  },
  hint: {
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.lg,
  },
  buttonText: {
    ...Typography.callout,
    color: "#FFFFFF",
    fontWeight: "700",
  },
});
