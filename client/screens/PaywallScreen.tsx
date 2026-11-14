import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";

import { useAuth } from "@/lib/auth";
import {
  buildCheckoutHandoffUrl,
  fetchAvailablePackages,
  fetchHandoffToken,
  formatPrice,
  getSubscribeUrl,
  startTrial,
  type AvailablePackage,
  type BookableCountry,
  type FeatureDefinition,
} from "@/lib/subscription";

/** Formatiert ein ISO-Datum als deutsches Datum (TT.MM.JJJJ). */
function formatPeriodDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Globale Paywall. Wird angezeigt, wenn ein eingeloggter Nutzer (noch) kein
 * aktives Entitlement hat. Zeigt die buchbaren Pakete inkl. enthaltener
 * Features und leitet zum Abschluss in den Browser (Web-Checkout) weiter.
 * Bezahlung findet ausschließlich im Web statt — keine In-App-Käufe.
 *
 * Erreichbar bleiben nur dieser Bildschirm und Konto-Funktionen (Logout).
 */
export default function PaywallScreen() {
  const insets = useSafeAreaInsets();
  const {
    user,
    logout,
    entitlement,
    trial,
    trialDurationHours,
    deletion,
    featureCatalog: catalogFromStatus,
    subscriptionStatus,
    refreshSubscription,
  } = useAuth();

  const [packages, setPackages] = useState<AvailablePackage[]>([]);
  const [catalog, setCatalog] = useState<FeatureDefinition[]>(catalogFromStatus);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Basis-Land (Task #522): genau ein Land ist im Abo enthalten. Die Auswahl
  // wird an den Web-Checkout weitergereicht (?land=ISO), wo die Bezahlung läuft.
  const [countryCatalog, setCountryCatalog] = useState<BookableCountry[]>([]);
  const [baseCountry, setBaseCountry] = useState<string>("");
  // Schritt-für-Schritt-Kauf: genau ein Paket wird oben ausgewählt (markiert),
  // darunter Land + Widerrufs-Haken; erst dann wird der zentrale Kauf-Button aktiv.
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  // Läuft gerade ein Checkout-Start? Zeigt beim zentralen Kauf-Button einen
  // Ladezustand.
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // Test-Paket (einmaliger Komplett-Test).
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialError, setTrialError] = useState<string | null>(null);

  const loadPackages = useCallback(async () => {
    try {
      const data = await fetchAvailablePackages();
      const pkgs = data.packages ?? [];
      setPackages(pkgs);
      // Vorauswahl pflegen: bei genau einem Paket dieses markieren; eine bereits
      // getroffene Auswahl verwerfen, falls sie nach dem Neuladen nicht mehr existiert.
      setSelectedPackageId((prev) => {
        if (prev && pkgs.some((p) => p.id === prev)) return prev;
        return pkgs.length === 1 ? pkgs[0].id : null;
      });
      if (data.featureCatalog && data.featureCatalog.length > 0) {
        setCatalog(data.featureCatalog);
      }
      const cc = data.countryCatalog ?? [];
      setCountryCatalog(cc);
      setBaseCountry((prev) =>
        prev || data.defaultBaseCountry || cc[0]?.iso || "DE",
      );
    } catch {
      // Pakete sind optional — bei Fehler bleibt die Feature-Katalog-Ansicht.
      setPackages([]);
    } finally {
      setPackagesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  useEffect(() => {
    if (catalogFromStatus.length > 0) setCatalog(catalogFromStatus);
  }, [catalogFromStatus]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshSubscription(), loadPackages()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshSubscription, loadPackages]);

  // Das aktuell markierte Paket (oben in der Liste angetippt).
  const selectedPackage =
    packages.find((p) => p.id === selectedPackageId) ?? null;

  // Welcher Schritt fehlt noch, bevor gekauft werden kann? null = alles bereit.
  const missingStep: string | null = !selectedPackage
    ? "Bitte zuerst ein Paket w\u00E4hlen."
    : !baseCountry
      ? "Bitte ein enthaltenes Land w\u00E4hlen."
      : !consentChecked
        ? "Bitte den Widerrufs-Hinweis best\u00E4tigen."
        : null;
  const canCheckout = missingStep === null && !checkoutBusy;

  // Startet den Checkout für das AUSGEWÄHLTE Paket. Holt zuerst einen
  // Login-Handoff-Token, damit der Browser bereits angemeldet und direkt auf der
  // Stripe-Bezahlseite (mit gewähltem Land) ankommt. Die § 356-Zustimmung wurde
  // bereits über den Widerrufs-Haken erteilt. Schlägt die Token-Erstellung fehl,
  // wird auf die normale (anzumeldende) Paketseite zurückgefallen.
  const startCheckout = useCallback(async () => {
    if (!selectedPackage || !baseCountry || !consentChecked) return;
    const priceId = selectedPackage.prices?.[0]?.id ?? null;
    setHandoffError(null);
    setCheckoutBusy(true);
    let url: string;
    try {
      const token = await fetchHandoffToken();
      url = buildCheckoutHandoffUrl({
        token,
        land: baseCountry,
        paket: selectedPackage.id,
        priceId,
        consent: true,
      });
    } catch {
      // Kein Handoff möglich -> Fallback auf die normale Paketseite. Der Nutzer
      // muss sich dort ggf. erneut anmelden, kann das Abo aber abschließen.
      url = getSubscribeUrl();
      const extra: string[] = [];
      if (baseCountry) extra.push(`land=${encodeURIComponent(baseCountry)}`);
      extra.push(`paket=${encodeURIComponent(selectedPackage.id)}`);
      url += (url.includes("?") ? "&" : "?") + extra.join("&");
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setHandoffError(
        "Die Bezahlseite konnte nicht ge\u00F6ffnet werden. Bitte versuche es erneut.",
      );
    } finally {
      setCheckoutBusy(false);
    }
  }, [selectedPackage, baseCountry, consentChecked]);

  const onLogout = useCallback(() => {
    logout().catch(() => undefined);
  }, [logout]);

  // Startet den einmaligen Komplett-Test und lädt danach den Abo-Status neu,
  // sodass die App freigeschaltet wird.
  const onStartTrial = useCallback(() => {
    setTrialBusy(true);
    setTrialError(null);
    void (async () => {
      try {
        await startTrial();
        await refreshSubscription();
      } catch {
        setTrialError(
          "Der Test konnte nicht gestartet werden. Bitte versuche es erneut.",
        );
      } finally {
        setTrialBusy(false);
      }
    })();
  }, [refreshSubscription]);

  const featureName = useCallback(
    (key: string): string => {
      const def = catalog.find((f) => f.key === key);
      return def?.name ?? key;
    },
    [catalog],
  );

  // Hinweistext oben je nach Lage: Test abgelaufen vs. noch nie ein Abo.
  const trialUsedExpired = trial?.used && !trial.active;
  const headline = trialUsedExpired
    ? "Dein kostenloser Test ist abgelaufen"
    : "Zugang freischalten";
  const subline = trialUsedExpired
    ? "Um die Pre-Flight-Check-App weiter zu nutzen, wähle bitte ein Paket."
    : "Wähle ein Paket, um alle Funktionen der Pre-Flight-Check-App zu nutzen.";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="screen-paywall">
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7FB2E5"
          />
        }
      >
        <View style={styles.header}>
          <View style={styles.lockBadge}>
            <Feather name="lock" size={28} color="#7FB2E5" />
          </View>
          <Text style={styles.title} testID="text-paywall-title">
            {headline}
          </Text>
          <Text style={styles.subtitle}>{subline}</Text>
        </View>

        {subscriptionStatus === "error" ? (
          <View style={styles.errorBox}>
            <Feather name="wifi-off" size={18} color="#FCA5A5" />
            <Text style={styles.errorText}>
              Abo-Status konnte nicht geladen werden. Bitte Verbindung pr{"\u00FC"}fen
              und erneut versuchen.
            </Text>
          </View>
        ) : null}

        {packagesLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#7FB2E5" />
            <Text style={styles.loadingText}>Pakete werden geladen...</Text>
          </View>
        ) : packages.length > 0 ? (
          <>
            <View style={styles.stepHeaderRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <Text style={styles.stepTitle}>Paket w{"\u00E4"}hlen</Text>
            </View>
            <View style={styles.packageList}>
              {packages.map((pkg) => (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  featureName={featureName}
                  selected={pkg.id === selectedPackageId}
                  onSelect={() => setSelectedPackageId(pkg.id)}
                  disabled={checkoutBusy}
                />
              ))}
            </View>

            {countryCatalog.length > 0 ? (
              <>
                <View style={styles.stepHeaderRow}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>2</Text>
                  </View>
                  <Text style={styles.stepTitle}>Enthaltenes Land</Text>
                </View>
                <View style={styles.card} testID="card-base-country">
                  <Text style={styles.cardDescription}>
                    Jedes Abo enth{"\u00E4"}lt genau ein Land. Weitere L{"\u00E4"}nder
                    kannst du sp{"\u00E4"}ter einzeln dazubuchen.
                  </Text>
                  <View style={styles.countryChips}>
                    {countryCatalog.map((c) => {
                      const selected = c.iso === baseCountry;
                      return (
                        <Pressable
                          key={c.iso}
                          onPress={() => setBaseCountry(c.iso)}
                          disabled={checkoutBusy}
                          style={({ pressed }) => [
                            styles.countryChip,
                            selected && styles.countryChipOn,
                            pressed && styles.btnPressed,
                          ]}
                          testID={`chip-base-country-${c.iso}`}
                        >
                          <Text
                            style={[
                              styles.countryChipText,
                              selected && styles.countryChipTextOn,
                            ]}
                          >
                            {c.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </>
            ) : null}

            <View style={styles.stepHeaderRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>
                  {countryCatalog.length > 0 ? "3" : "2"}
                </Text>
              </View>
              <Text style={styles.stepTitle}>Widerruf best{"\u00E4"}tigen</Text>
            </View>
            <Pressable
              onPress={() => setConsentChecked((v) => !v)}
              disabled={checkoutBusy}
              style={({ pressed }) => [
                styles.consentRow,
                consentChecked && styles.consentRowOn,
                pressed && styles.btnPressed,
              ]}
              testID="checkbox-withdrawal-consent"
            >
              <View
                style={[
                  styles.consentBox,
                  consentChecked && styles.consentBoxOn,
                ]}
              >
                {consentChecked ? (
                  <Feather name="check" size={16} color="#FFFFFF" />
                ) : null}
              </View>
              <Text style={styles.consentText}>
                Ich verlange ausdr{"\u00FC"}cklich, dass mit der Ausf{"\u00FC"}hrung
                der digitalen Dienstleistung sofort begonnen wird, und best{"\u00E4"}tige
                meine Kenntnis, dass mein Widerrufsrecht mit Beginn der
                Ausf{"\u00FC"}hrung erlischt ({"\u00A7"} 356 Abs. 5 BGB).
              </Text>
            </Pressable>

            <Pressable
              onPress={() => void startCheckout()}
              disabled={!canCheckout}
              style={({ pressed }) => [
                styles.primaryBtn,
                !canCheckout && styles.primaryBtnDisabled,
                pressed && canCheckout && styles.btnPressed,
              ]}
              testID="button-subscribe"
            >
              {checkoutBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Feather name="check-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Jetzt abonnieren</Text>
                </>
              )}
            </Pressable>
            {missingStep ? (
              <Text style={styles.missingStep} testID="text-missing-step">
                {missingStep}
              </Text>
            ) : null}
            {handoffError ? (
              <Text style={styles.withdrawalError} testID="text-handoff-error">
                {handoffError}
              </Text>
            ) : null}
            <Text style={styles.hint}>
              Die Bezahlung wird sicher abgeschlossen. Nach R{"\u00FC"}ckkehr tippe
              auf „Status aktualisieren".
            </Text>
          </>
        ) : (
          <FeatureCatalogCard catalog={catalog} />
        )}

        {trial && (trial.available || trial.used) ? (
          <View style={styles.trialCard} testID="card-package-trial">
            <View style={styles.trialHeader}>
              <Feather name="gift" size={20} color="#7FB2E5" />
              <Text style={styles.trialTitle}>Test-Paket</Text>
            </View>
            <Text style={styles.trialDescription}>
              {`Teste alle Funktionen ${Math.round(
                trialDurationHours / 24,
              )} Tage lang kostenlos und unverbindlich. Einmal pro Konto.`}
            </Text>
            {trial.available ? (
              <Pressable
                onPress={onStartTrial}
                disabled={trialBusy}
                style={({ pressed }) => [
                  styles.trialBtn,
                  trialBusy && styles.primaryBtnDisabled,
                  pressed && styles.btnPressed,
                ]}
                testID="button-trial"
              >
                {trialBusy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="play" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryBtnText}>Test starten</Text>
                  </>
                )}
              </Pressable>
            ) : (
              <View style={styles.trialUsedRow} testID="text-trial-used">
                <Feather name="check-circle" size={16} color="#7FB2E5" />
                <Text style={styles.trialUsedText}>Test bereits genutzt</Text>
              </View>
            )}
            {trialError ? (
              <Text style={styles.withdrawalError} testID="text-trial-error">
                {trialError}
              </Text>
            ) : null}
          </View>
        ) : null}

        {deletion && !deletion.active && deletion.daysRemaining != null ? (
          <View style={styles.deletionNotice} testID="notice-deletion-countdown">
            <Feather name="alert-triangle" size={16} color="#FCD34D" />
            <View style={{ flex: 1 }}>
              <Text style={styles.deletionTitle}>
                {deletion.daysRemaining <= 0
                  ? "Dein Konto wird in Kürze gelöscht."
                  : `Dein Konto wird in ${deletion.daysRemaining} ${
                      deletion.daysRemaining === 1 ? "Tag" : "Tagen"
                    } automatisch gelöscht.`}
              </Text>
              <Text style={styles.deletionBody}>
                Ohne aktives Abo oder laufenden Test entfernen wir dein Konto und
                alle serverseitig gespeicherten Daten aus Datenschutzgründen
                {deletion.scheduledAt
                  ? ` am ${formatPeriodDate(deletion.scheduledAt)}`
                  : ""}
                . Buche ein Paket oder starte einen Test, um die Löschung zu
                stoppen.
              </Text>
            </View>
          </View>
        ) : null}

        <Pressable
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.secondaryBtn,
            pressed && styles.btnPressed,
          ]}
          disabled={refreshing}
          testID="button-refresh-status"
        >
          {refreshing ? (
            <ActivityIndicator color="#7FB2E5" />
          ) : (
            <>
              <Feather name="refresh-cw" size={16} color="#7FB2E5" />
              <Text style={styles.secondaryBtnText}>Status aktualisieren</Text>
            </>
          )}
        </Pressable>

        <View style={styles.accountBox}>
          {user?.email ? (
            <Text style={styles.accountEmail} testID="text-account-email">
              Angemeldet als {user.email}
            </Text>
          ) : null}
          {entitlement?.source === "stripe" && entitlement.status ? (
            <Text style={styles.accountMeta}>
              Abo-Status: {entitlement.status}
            </Text>
          ) : null}
          {entitlement?.source === "stripe" && entitlement.currentPeriodEnd ? (
            <Text style={styles.accountMeta} testID="text-period-end">
              {entitlement.cancelAtPeriodEnd ? "Läuft ab am" : "Verlängert sich am"}:{" "}
              {formatPeriodDate(entitlement.currentPeriodEnd)}
            </Text>
          ) : null}
          <Pressable
            onPress={onLogout}
            style={({ pressed }) => [
              styles.logoutBtn,
              pressed && styles.btnPressed,
            ]}
            testID="button-logout"
          >
            <Feather name="log-out" size={16} color="#FCA5A5" />
            <Text style={styles.logoutText}>Abmelden</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function PackageCard({
  pkg,
  featureName,
  selected,
  onSelect,
  disabled,
}: {
  pkg: AvailablePackage;
  featureName: (key: string) => string;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const price = pkg.prices[0]
    ? formatPrice(pkg.prices[0].amount, pkg.prices[0].currency, pkg.prices[0].interval)
    : null;
  return (
    <Pressable
      onPress={onSelect}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        styles.cardSelectable,
        selected && styles.cardSelected,
        pressed && styles.cardPressed,
        disabled && !selected && styles.cardDisabled,
      ]}
      testID={`button-select-${pkg.id}`}
    >
      <View style={styles.cardHeader} testID={`card-package-${pkg.id}`}>
        <View style={styles.cardTitleRow}>
          <View
            style={[styles.radio, selected && styles.radioOn]}
            testID={`radio-package-${pkg.id}`}
          >
            {selected ? (
              <Feather name="check" size={14} color="#FFFFFF" />
            ) : null}
          </View>
          <Text style={styles.cardTitle}>{pkg.name}</Text>
        </View>
        {price ? <Text style={styles.cardPrice}>{price}</Text> : null}
      </View>
      {pkg.description ? (
        <Text style={styles.cardDescription}>{pkg.description}</Text>
      ) : null}
      {pkg.features.length > 0 ? (
        <View style={styles.featureList}>
          {pkg.features.map((key) => (
            <View key={key} style={styles.featureRow}>
              <Feather name="check" size={15} color="#4ADE80" />
              <Text style={styles.featureText}>{featureName(key)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

function FeatureCatalogCard({ catalog }: { catalog: FeatureDefinition[] }) {
  return (
    <View style={styles.card} testID="card-feature-catalog">
      <Text style={styles.cardTitle}>Enthaltene Funktionen</Text>
      <Text style={styles.cardDescription}>
        Diese Funktionen stehen mit einem aktiven Abo zur Verf{"\u00FC"}gung.
      </Text>
      <View style={styles.featureList}>
        {catalog.map((f) => (
          <View key={f.key} style={styles.featureRow}>
            <Feather name="check" size={15} color="#4ADE80" />
            <Text style={styles.featureText}>{f.name}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0E1A",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
  },
  lockBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(127, 178, 229, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(200, 210, 230, 0.85)",
    textAlign: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(248, 113, 113, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(248, 113, 113, 0.35)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: "#FCA5A5",
  },
  loadingBox: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "rgba(200, 210, 230, 0.7)",
  },
  packageList: {
    gap: 14,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.18)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  cardSelectable: {
    borderColor: "rgba(127, 178, 229, 0.4)",
  },
  cardSelected: {
    borderColor: "#7FB2E5",
    borderWidth: 2,
    backgroundColor: "rgba(127, 178, 229, 0.12)",
  },
  cardPressed: {
    opacity: 0.75,
    backgroundColor: "rgba(127, 178, 229, 0.1)",
  },
  cardDisabled: {
    opacity: 0.5,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(127, 178, 229, 0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: {
    backgroundColor: "#0A4D8C",
    borderColor: "#7FB2E5",
  },
  stepHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
    marginBottom: 10,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#0A4D8C",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.18)",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  consentRowOn: {
    borderColor: "rgba(127, 178, 229, 0.5)",
    backgroundColor: "rgba(127, 178, 229, 0.1)",
  },
  consentBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(127, 178, 229, 0.6)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  consentBoxOn: {
    backgroundColor: "#0A4D8C",
    borderColor: "#7FB2E5",
  },
  consentText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(220, 228, 240, 0.9)",
  },
  missingStep: {
    fontSize: 13,
    color: "rgba(252, 211, 77, 0.95)",
    textAlign: "center",
    marginTop: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
    flexShrink: 1,
  },
  cardPrice: {
    fontSize: 16,
    fontWeight: "700",
    color: "#7FB2E5",
    marginLeft: 12,
  },
  cardDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(200, 210, 230, 0.8)",
    marginBottom: 12,
  },
  featureList: {
    gap: 8,
  },
  countryChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  countryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.4)",
    backgroundColor: "rgba(127, 178, 229, 0.08)",
  },
  countryChipOn: {
    backgroundColor: "#0A4D8C",
    borderColor: "#0A4D8C",
  },
  countryChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(220, 228, 240, 0.85)",
  },
  countryChipTextOn: {
    color: "#FFFFFF",
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  featureText: {
    fontSize: 14,
    color: "rgba(220, 228, 240, 0.92)",
    flexShrink: 1,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0A4D8C",
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  trialCard: {
    backgroundColor: "rgba(127, 178, 229, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.4)",
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  trialHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  trialTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  trialDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(200, 210, 230, 0.8)",
    marginBottom: 14,
  },
  trialBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0A4D8C",
    paddingVertical: 14,
    borderRadius: 14,
  },
  trialUsedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trialUsedText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#7FB2E5",
  },
  withdrawalError: {
    fontSize: 13,
    color: "#FF8A80",
    marginTop: 8,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(200, 210, 230, 0.6)",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(127, 178, 229, 0.4)",
    marginTop: 12,
    minHeight: 50,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#7FB2E5",
  },
  btnPressed: {
    opacity: 0.7,
  },
  deletionNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(252, 211, 77, 0.4)",
    backgroundColor: "rgba(252, 211, 77, 0.12)",
  },
  deletionTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: "#FDE68A",
  },
  deletionBody: {
    fontSize: 12.5,
    color: "rgba(253, 230, 138, 0.85)",
    marginTop: 4,
    lineHeight: 17,
  },
  accountBox: {
    alignItems: "center",
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255, 255, 255, 0.12)",
    gap: 6,
  },
  accountEmail: {
    fontSize: 13,
    color: "rgba(200, 210, 230, 0.7)",
  },
  accountMeta: {
    fontSize: 12,
    color: "rgba(200, 210, 230, 0.55)",
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FCA5A5",
  },
});
