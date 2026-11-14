import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert, Platform, Image, Modal } from "react-native";
import { ScrollView } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { hasLocalUserData, migrateLocalDataToServer, type MigrationResult } from "@/lib/storage";
import { ApiError, apiJson } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";
import * as WebBrowser from "@/lib/webBrowser";
import {
  fetchAvailablePackages,
  entitlementHasCountry,
  type CountryAddon,
} from "@/lib/subscription";
import { MigrationModal } from "@/components/MigrationModal";
import PackagesPromo from "@/components/PackagesPromo";
import LegalDocumentView from "@/components/LegalDocumentView";
import PrivacyPolicyView from "@/components/PrivacyPolicyView";
import { IMPRINT } from "../../shared/imprint";
import appIcon from "../../assets/images/icon.png";

type LegalView = "imprint" | "privacy";

function addonPrice(addon: CountryAddon) {
  return addon.prices.find((p) => p.interval === "month") ?? addon.prices[0] ?? null;
}

function formatAccountDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function euroAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  try {
    return (amount / 100).toLocaleString("de-DE", {
      style: "currency",
      currency: (currency ?? "eur").toUpperCase(),
    });
  } catch {
    return `${(amount / 100).toFixed(2)} ${(currency ?? "eur").toUpperCase()}`;
  }
}

function intervalSuffix(interval: string | null): string {
  if (interval === "month") return "/ Monat";
  if (interval === "year") return "/ Jahr";
  return "";
}

/**
 * Länder-Add-ons (Task #522): weitere Länder einzeln dazubuchen. Sichtbar für
 * eingeloggte Nutzer mit aktivem Abo. Der Checkout läuft über
 * /api/subscription/checkout/country (Auth-Cookie wird mitgesendet) und öffnet
 * die zurückgelieferte Stripe-URL im Browser.
 */
function CountryAddonSection() {
  const { theme } = useTheme();
  const { entitlement } = useAuth();
  const [addons, setAddons] = useState<CountryAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchAvailablePackages();
        if (!cancelled) setAddons(res.countryAddons ?? []);
      } catch {
        if (!cancelled) setAddons([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (addon: CountryAddon) => {
    const price = addonPrice(addon);
    if (!price) return;
    setError(null);
    setBusyId(addon.id);
    try {
      const res = await apiJson<{ url: string }>(
        "/api/subscription/checkout/country",
        { method: "POST", body: { priceId: price.id } },
      );
      if (res.url) {
        await WebBrowser.openBrowserAsync(res.url);
      } else {
        setError("Checkout konnte nicht gestartet werden.");
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Checkout konnte nicht gestartet werden.";
      setError(msg);
    } finally {
      setBusyId(null);
    }
  }, []);

  if (loading || addons.length === 0) return null;
  if (entitlement?.allCountries) return null;

  return (
    <Card style={[addonStyles.card, { marginTop: Spacing.lg }]}>
      <ThemedText style={addonStyles.title}>Weitere Länder freischalten</ThemedText>
      <ThemedText style={[addonStyles.subtitle, { color: theme.textSecondary }]}>
        Dein Abo enthält ein Land. Zusätzliche Länder kannst du hier einzeln dazubuchen.
      </ThemedText>

      {error ? (
        <View style={[addonStyles.errorBox, { backgroundColor: theme.statusNoGoBackground }]}>
          <Feather name="alert-circle" size={15} color={theme.statusNoGo} />
          <ThemedText style={[addonStyles.errorText, { color: theme.statusNoGo }]}>{error}</ThemedText>
        </View>
      ) : null}

      {addons.map((addon) => {
        const owned = entitlementHasCountry(entitlement, addon.country);
        const price = addonPrice(addon);
        return (
          <View
            key={addon.id}
            style={[addonStyles.row, { borderColor: theme.border }]}
            testID={`row-country-addon-${addon.country}`}
          >
            <View style={addonStyles.rowInfo}>
              <ThemedText style={addonStyles.rowName}>{addon.name}</ThemedText>
              {price ? (
                <ThemedText style={[addonStyles.rowPrice, { color: theme.textSecondary }]}>
                  {euroAmount(price.amount, price.currency)} {intervalSuffix(price.interval)}
                </ThemedText>
              ) : null}
            </View>
            {owned ? (
              <View
                style={[addonStyles.ownedPill, { backgroundColor: theme.statusGoBackground }]}
                testID={`badge-owned-${addon.country}`}
              >
                <Feather name="check" size={13} color={theme.statusGo} />
                <ThemedText style={[addonStyles.ownedText, { color: theme.statusGo }]}>
                  Freigeschaltet
                </ThemedText>
              </View>
            ) : (
              <Pressable
                style={[addonStyles.unlockBtn, { backgroundColor: theme.primary }]}
                onPress={() => unlock(addon)}
                disabled={busyId === addon.id || !price}
                testID={`button-unlock-${addon.country}`}
              >
                <Feather name="lock" size={13} color="#FFFFFF" />
                <ThemedText style={addonStyles.unlockText}>
                  {busyId === addon.id ? "Wird geöffnet …" : "Freischalten"}
                </ThemedText>
              </Pressable>
            )}
          </View>
        );
      })}
    </Card>
  );
}

// Dunkle "COpter Pilot"-Auth-Palette für den Standalone-Login-Gate. Spiegelt die
// Web-Tokens aus web/src/index.css (.auth-shell): Navy-Verlauf + Orange, damit App
// und Webseite beim ersten Kontakt identisch aussehen.
const AUTH = {
  bg: "#0c1d2d",
  text: "#f1f5f9",
  textSecondary: "#aebfce",
  textTertiary: "#708aa0",
  border: "rgba(255,255,255,0.16)",
  elevated: "rgba(255,255,255,0.06)",
  primary: "#f59e0b",
  cardBg: "rgba(255,255,255,0.05)",
  cardBorder: "rgba(255,255,255,0.10)",
  tabTrack: "rgba(255,255,255,0.06)",
  tabActive: "rgba(255,255,255,0.16)",
  errorBg: "rgba(239,68,68,0.14)",
  errorText: "#fca5a5",
};

type Mode = "login" | "register";

interface AccountScreenProps {
  /** Wenn true: rendert ohne Navigations-Header (für den Login-Gate vor App-Start). */
  standalone?: boolean;
}

export default function AccountScreen({ standalone = false }: AccountScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  let headerHeight = 0;
  try {
    headerHeight = useHeaderHeight();
  } catch {
    headerHeight = 0;
  }
  let tabBarHeight = 0;
  try {
    tabBarHeight = useBottomTabBarHeight();
  } catch {
    tabBarHeight = 0;
  }
  const topPadding = standalone ? insets.top + Spacing.lg : headerHeight + Spacing.xl;
  const bottomPadding = standalone ? insets.bottom + Spacing.xl : tabBarHeight + Spacing.xl;
  const {
    user,
    status,
    isAuthenticated,
    login,
    requestRegistrationCode,
    verifyRegistrationCode,
    completeRegistration,
    logout,
    entitlement,
    deletion,
  } = useAuth();
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("login");
  // "E-Mail zuerst"-Registrierung in drei Schritten:
  //   1 = E-Mail -> Code anfordern (noch kein Konto)
  //   2 = Bestätigungscode eingeben
  //   3 = Passwort (+ optional Name) -> Konto + direkter Login
  const [registerStep, setRegisterStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  // Hinweis nach dem Code-Versand (z. B. "Code an … gesendet").
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Rechtslinks (Impressum / Datenschutz) im Standalone-Login-Gate, das außerhalb
  // des Navigators läuft -> Anzeige als Modal statt Navigation.
  const [legalView, setLegalView] = useState<LegalView | null>(null);

  const [migratePromptOpen, setMigratePromptOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  const resetForm = useCallback(() => {
    setEmail("");
    setCode("");
    setPassword("");
    setName("");
    setErrorMsg(null);
    setInfoMsg(null);
  }, []);

  const triggerMigrationCheck = useCallback(async () => {
    // Sofortiges visuelles Feedback: Modal mit Ladekreis öffnen, während wir
    // prüfen, ob überhaupt lokale Daten vorliegen.
    setMigrationResult(null);
    setMigratePromptOpen(true);
    setCheckingLocal(true);
    try {
      const has = await hasLocalUserData();
      if (!has) {
        // Nichts zu übertragen → direkt eine "fertig"-Meldung zeigen.
        setMigrationResult({
          success: true,
          dronesSync: 0,
          sessionsSync: 0,
          logbookSync: 0,
          settingsSync: false,
          profileSync: false,
          historySync: 0,
          hadAnyLocalData: false,
        });
      }
    } catch (err) {
      setMigrationResult({
        success: false,
        dronesSync: 0,
        sessionsSync: 0,
        logbookSync: 0,
        settingsSync: false,
        profileSync: false,
        historySync: 0,
        hadAnyLocalData: false,
        error: "Lokale Daten konnten nicht geprüft werden.",
      });
    } finally {
      setCheckingLocal(false);
    }
  }, []);

  const onLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMsg("E-Mail und Passwort sind Pflichtfelder.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await login(email.trim(), password);
      resetForm();
      queryClient.invalidateQueries();
      // Migrations-Check läuft zentral im AuthGate, sobald `status` auf
      // "authenticated" wechselt. Wir triggern hier bewusst nichts mehr,
      // da dieser Screen im Standalone-Modus sofort danach unmounted.
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Login fehlgeschlagen.";
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  }, [email, password, login, resetForm]);

  // Schritt 1: E-Mail validieren und Bestätigungscode anfordern. Es wird noch
  // KEIN Konto angelegt. Bereits registrierte Adresse -> zur Anmeldung wechseln.
  const onRequestCode = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMsg("Bitte gib deine E-Mail-Adresse ein.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErrorMsg("Bitte gib eine gültige E-Mail-Adresse ein.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const result = await requestRegistrationCode(trimmed);
      if (result === "already_registered") {
        // Konto existiert bereits -> zur Anmeldung. E-Mail bleibt vorausgefüllt.
        setMode("login");
        setRegisterStep(1);
        setPassword("");
        setCode("");
        setErrorMsg("Für diese E-Mail existiert bereits ein Konto. Bitte melde dich an.");
        return;
      }
      if (result === "mail_not_configured") {
        setErrorMsg(
          "Der E-Mail-Versand ist derzeit nicht konfiguriert. Bitte versuche es später erneut oder wende dich an den Support.",
        );
        return;
      }
      setCode("");
      const sentMessage = `Wir haben einen Bestätigungscode an ${trimmed} gesendet. Der Code ist 15 Minuten gültig.`;
      if (__DEV__) {
        try {
          const testResponse = await apiJson<{ code?: string }>(
            `/api/auth/register/_test/last-code?email=${encodeURIComponent(trimmed.toLowerCase())}`,
          );
          if (typeof testResponse.code === "string" && testResponse.code) {
            setInfoMsg(
              `Lokaler Testcode (nur Entwicklung): ${testResponse.code}. Kein E-Mail-Versand; 15 Minuten gültig.`,
            );
          } else {
            setInfoMsg("Der lokale Testcode konnte nicht geladen werden.");
          }
        } catch {
          setInfoMsg(
            "Der lokale Testcode ist nicht verfügbar. Prüfe die Backend-Verbindung und den Entwicklungs-Testmodus.",
          );
        }
      } else {
        setInfoMsg(sentMessage);
      }
      setRegisterStep(2);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Anfrage fehlgeschlagen.";
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  }, [email, requestRegistrationCode]);

  // Hilfe: Server-Fehlercode aus einer ApiError lesen.
  const codeFromError = useCallback((err: unknown): string | undefined => {
    return err instanceof ApiError && err.payload && typeof err.payload === "object" && "code" in err.payload
      ? String((err.payload as { code?: unknown }).code)
      : undefined;
  }, []);

  // Schritt 2: Code vorab prüfen. Abgelaufen/aufgebraucht -> zurück zu Schritt 1.
  const onVerifyCode = useCallback(async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setErrorMsg("Bitte gib den Bestätigungscode ein.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await verifyRegistrationCode(email.trim(), trimmedCode);
      setRegisterStep(3);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Der Code konnte nicht bestätigt werden.";
      setErrorMsg(msg);
      const c = codeFromError(err);
      if (c === "expired" || c === "too_many_attempts" || c === "no_pending") {
        setRegisterStep(1);
      }
    } finally {
      setBusy(false);
    }
  }, [code, email, verifyRegistrationCode, codeFromError]);

  // Code erneut anfordern (aus Schritt 2).
  const onResendCode = useCallback(async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const result = await requestRegistrationCode(email.trim());
      if (result === "already_registered") {
        setMode("login");
        setRegisterStep(1);
        setErrorMsg("Für diese E-Mail existiert bereits ein Konto. Bitte melde dich an.");
        return;
      }
      if (result === "mail_not_configured") {
        setErrorMsg("Der E-Mail-Versand ist derzeit nicht konfiguriert.");
        return;
      }
      setInfoMsg("Wir haben dir einen neuen Code gesendet.");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Anfrage fehlgeschlagen.";
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  }, [email, requestRegistrationCode]);

  // Schritt 3: Konto anlegen (emailVerified=true) + direkter Login.
  const onCompleteRegister = useCallback(async () => {
    if (!password.trim()) {
      setErrorMsg("Passwort ist ein Pflichtfeld.");
      return;
    }
    if (password.length < 8) {
      setErrorMsg("Das Passwort muss mindestens 8 Zeichen haben.");
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      await completeRegistration({
        email: email.trim(),
        code: code.trim(),
        password,
        name: name.trim() || undefined,
      });
      // Direkt eingeloggt -> Formular leeren; AuthGate übernimmt die Migration.
      resetForm();
      setRegisterStep(1);
      queryClient.invalidateQueries();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Registrierung fehlgeschlagen.";
      setErrorMsg(msg);
      const c = codeFromError(err);
      if (c === "expired" || c === "too_many_attempts" || c === "no_pending") {
        setRegisterStep(1);
      } else if (c === "mismatch") {
        setRegisterStep(2);
      } else if (c === "already_registered") {
        setMode("login");
        setRegisterStep(1);
      }
    } finally {
      setBusy(false);
    }
  }, [email, code, password, name, completeRegistration, resetForm, codeFromError]);

  const onManageSubscription = useCallback(async () => {
    setPortalError(null);
    setPortalBusy(true);
    try {
      const res = await apiJson<{ url: string }>("/api/subscription/portal", {
        method: "POST",
      });
      if (res.url) {
        await WebBrowser.openBrowserAsync(res.url);
      } else {
        setPortalError("Das Abo-Portal konnte nicht geöffnet werden.");
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Das Abo-Portal konnte nicht geöffnet werden.";
      setPortalError(msg);
    } finally {
      setPortalBusy(false);
    }
  }, []);

  const onLogout = useCallback(() => {
    Alert.alert(
      "Abmelden?",
      "Lokale Daten bleiben auf diesem Gerät erhalten. Server-Daten kannst du nach erneutem Login wieder abrufen.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Abmelden",
          style: "destructive",
          onPress: async () => {
            await logout();
            queryClient.invalidateQueries();
          },
        },
      ],
    );
  }, [logout]);

  const runMigration = useCallback(async () => {
    setMigrating(true);
    try {
      const result = await migrateLocalDataToServer();
      setMigrationResult(result);
      queryClient.invalidateQueries();
    } finally {
      setMigrating(false);
    }
  }, []);

  const dismissMigrationPrompt = useCallback(() => {
    setMigratePromptOpen(false);
    setMigrationResult(null);
    setCheckingLocal(false);
  }, []);

  const formStyle = useMemo(
    () => ({ paddingTop: topPadding, paddingBottom: bottomPadding }),
    [topPadding, bottomPadding],
  );

  if (status === "loading") {
    if (standalone) {
      return (
        <View style={[styles.center, { paddingTop: topPadding, backgroundColor: AUTH.bg }]}>
          <ActivityIndicator color={AUTH.primary} />
        </View>
      );
    }
    return (
      <ThemedView style={[styles.center, { paddingTop: topPadding }]}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  if (isAuthenticated && user) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={[styles.content, formStyle]}>
          <Card style={styles.profileCard}>
            <View style={[styles.avatarCircle, { backgroundColor: theme.primary + "22" }]}>
              <Feather name="user" size={36} color={theme.primary} />
            </View>
            <ThemedText style={styles.profileName}>{user.name || "Pilot"}</ThemedText>
            <ThemedText style={[styles.profileEmail, { color: theme.textSecondary }]}>{user.email}</ThemedText>
            <View style={[styles.statusPill, { backgroundColor: theme.statusGoBackground }]}>
              <Feather name="cloud" size={14} color={theme.statusGo} />
              <ThemedText style={[styles.statusPillText, { color: theme.statusGo }]}>
                Mit Server synchronisiert
              </ThemedText>
            </View>
          </Card>

          <Card style={[styles.actionCard, { marginTop: Spacing.lg }]} onPress={triggerMigrationCheck}>
            <View style={styles.actionRow}>
              <Feather name="upload-cloud" size={20} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.actionTitle}>Lokale Daten hochladen</ThemedText>
                <ThemedText style={[styles.actionSubtitle, { color: theme.textSecondary }]}>
                  Drohnen, Flüge und Logbuch dieses Geräts in den Account übertragen.
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={20} color={theme.textTertiary} />
            </View>
          </Card>

          <CountryAddonSection />

          {entitlement?.source === "stripe" ? (
            <Card style={[styles.actionCard, { marginTop: Spacing.lg }]} onPress={portalBusy ? undefined : onManageSubscription}>
              <View style={styles.actionRow}>
                <Feather name="credit-card" size={20} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.actionTitle}>Abo verwalten oder kündigen</ThemedText>
                  <ThemedText style={[styles.actionSubtitle, { color: theme.textSecondary }]}>
                    {entitlement.cancelAtPeriodEnd
                      ? "Dein Abo wurde gekündigt und endet zum Periodenende."
                      : "Abo im sicheren Stripe-Portal ändern oder kündigen."}
                  </ThemedText>
                </View>
                {portalBusy ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <Feather name="external-link" size={20} color={theme.textTertiary} />
                )}
              </View>
            </Card>
          ) : null}

          {portalError ? (
            <ThemedText style={[styles.actionSubtitle, { color: theme.statusNoGo, marginTop: Spacing.sm }]}>
              {portalError}
            </ThemedText>
          ) : null}

          {deletion && !deletion.active && deletion.daysRemaining != null ? (
            <Card style={[styles.deletionCard, { marginTop: Spacing.lg }]}>
              <View style={styles.actionRow}>
                <Feather name="alert-triangle" size={20} color={theme.statusCaution} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.actionTitle, { color: theme.statusCaution }]}>
                    {deletion.daysRemaining <= 0
                      ? "Dein Konto wird in Kürze gelöscht."
                      : `Konto-Löschung in ${deletion.daysRemaining} ${
                          deletion.daysRemaining === 1 ? "Tag" : "Tagen"
                        }`}
                  </ThemedText>
                  <ThemedText style={[styles.actionSubtitle, { color: theme.textSecondary }]}>
                    Ohne aktives Abo oder laufenden Test entfernen wir dein Konto und
                    alle serverseitig gespeicherten Daten aus Datenschutzgründen
                    {deletion.scheduledAt ? ` am ${formatAccountDate(deletion.scheduledAt)}` : ""}.
                    Buche ein Paket, um die Löschung zu stoppen.
                  </ThemedText>
                </View>
              </View>
            </Card>
          ) : null}

          <Pressable
            onPress={onLogout}
            style={[styles.logoutBtn, { borderColor: theme.statusNoGo, marginTop: Spacing["2xl"] }]}
          >
            <Feather name="log-out" size={18} color={theme.statusNoGo} />
            <ThemedText style={[styles.logoutText, { color: theme.statusNoGo }]}>Abmelden</ThemedText>
          </Pressable>
        </ScrollView>

        <MigrationModal
          visible={migratePromptOpen}
          migrating={migrating}
          checking={checkingLocal}
          result={migrationResult}
          onConfirm={runMigration}
          onDismiss={dismissMigrationPrompt}
        />
      </ThemedView>
    );
  }

  // Im Standalone-Login-Gate spiegeln wir den dunklen "COpter Pilot"-Web-Look,
  // im eingebetteten Konto-Tab bleibt das normale (helle) App-Theme.
  const c = standalone
    ? {
        text: AUTH.text,
        textSecondary: AUTH.textSecondary,
        textTertiary: AUTH.textTertiary,
        border: AUTH.border,
        primary: AUTH.primary,
        backgroundSecondary: AUTH.elevated,
      }
    : {
        text: theme.text,
        textSecondary: theme.textSecondary,
        textTertiary: theme.textTertiary,
        border: theme.border,
        primary: theme.primary,
        backgroundSecondary: theme.backgroundSecondary,
      };
  const onTabColor = "#FFFFFF";
  const primaryBtnTextColor = standalone ? "#0E2132" : "#FFFFFF";

  const formBody = (
    <ScrollView contentContainerStyle={[styles.content, formStyle]} keyboardShouldPersistTaps="handled">
        {standalone ? (
          <View style={styles.brandHeader}>
            <View style={styles.brandLogo}>
              <Image source={appIcon} style={styles.brandLogoImg} resizeMode="contain" />
            </View>
            <ThemedText style={[styles.brandTitle, { color: c.text }]}>COpter Pilot</ThemedText>
            <ThemedText style={[styles.brandSubtitle, { color: c.textSecondary }]}>
              {mode === "login" ? "Melde dich an, um fortzufahren." : "Erstelle einen Account, um zu starten."}
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.tabRow, { backgroundColor: standalone ? AUTH.tabTrack : theme.backgroundSecondary }]}>
          <Pressable
            onPress={() => {
              setMode("login");
              setRegisterStep(1);
              setCode("");
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            style={[
              styles.tabBtn,
              mode === "login" && { backgroundColor: standalone ? AUTH.tabActive : theme.primary },
            ]}
            testID="tab-login"
            accessibilityRole="tab"
            aria-selected={mode === "login"}
          >
            <ThemedText style={[styles.tabText, { color: c.textSecondary }, mode === "login" && { color: onTabColor }]}>
              Anmelden
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => {
              setMode("register");
              setRegisterStep(1);
              setCode("");
              setErrorMsg(null);
              setInfoMsg(null);
            }}
            style={[
              styles.tabBtn,
              mode === "register" && { backgroundColor: standalone ? AUTH.tabActive : theme.primary },
            ]}
            testID="tab-register"
            accessibilityRole="tab"
            aria-selected={mode === "register"}
          >
            <ThemedText style={[styles.tabText, { color: c.textSecondary }, mode === "register" && { color: onTabColor }]}>
              Registrieren
            </ThemedText>
          </Pressable>
        </View>

        {standalone ? null : (
          <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
            Mit deinem Account werden Drohnen, Logbuch und Einstellungen automatisch zwischen App und
            Web-Oberfläche synchronisiert. Du bleibst auf diesem Gerät angemeldet, bis du dich aktiv abmeldest.
          </ThemedText>
        )}

        <Card style={[styles.formCard, standalone ? { backgroundColor: AUTH.cardBg, borderWidth: 1, borderColor: AUTH.cardBorder } : null]}>
          {mode === "register" && registerStep === 3 ? (
            <View style={styles.field}>
              <ThemedText style={[styles.fieldLabel, { color: c.textSecondary }]}>Name (optional)</ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Max Mustermann"
                placeholderTextColor={c.textTertiary}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: standalone ? AUTH.elevated : "transparent" }]}
                autoCapitalize="words"
                testID="input-name"
              />
            </View>
          ) : null}

          {mode === "login" || (mode === "register" && registerStep === 1) ? (
            <View style={styles.field}>
              <ThemedText style={[styles.fieldLabel, { color: c.textSecondary }]}>E-Mail</ThemedText>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="pilot@example.com"
                placeholderTextColor={c.textTertiary}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: standalone ? AUTH.elevated : "transparent" }]}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                testID="input-email"
              />
            </View>
          ) : null}

          {mode === "register" && (registerStep === 2 || registerStep === 3) ? (
            <View style={[styles.emailRecap, { backgroundColor: c.backgroundSecondary }]}>
              <Feather name="mail" size={16} color={c.textSecondary} />
              <ThemedText style={[styles.emailRecapText, { color: c.textSecondary }]} numberOfLines={1}>
                {email.trim()}
              </ThemedText>
            </View>
          ) : null}

          {mode === "register" && registerStep === 2 ? (
            <View style={styles.field}>
              <ThemedText style={[styles.fieldLabel, { color: theme.textSecondary }]}>Bestätigungscode</ThemedText>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ""))}
                placeholder="123456"
                placeholderTextColor={theme.textTertiary}
                style={[styles.input, styles.codeInput, { color: theme.text, borderColor: theme.border }]}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={8}
                testID="input-code"
              />
              <ThemedText style={[styles.fieldHint, { color: theme.textTertiary }]}>
                Der Code ist 15 Minuten gültig.
              </ThemedText>
            </View>
          ) : null}

          {mode === "login" || (mode === "register" && registerStep === 3) ? (
            <View style={styles.field}>
              <ThemedText style={[styles.fieldLabel, { color: c.textSecondary }]}>Passwort</ThemedText>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={mode === "register" ? "Mindestens 8 Zeichen" : "Passwort"}
                placeholderTextColor={c.textTertiary}
                style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: standalone ? AUTH.elevated : "transparent" }]}
                secureTextEntry
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                testID="input-password"
              />
            </View>
          ) : null}

          {infoMsg ? (
            <View style={[styles.noticeBox, { backgroundColor: theme.statusCautionBackground }]}>
              <Feather name="mail" size={16} color={theme.statusCaution} />
              <View style={styles.noticeContent}>
                <ThemedText style={[styles.noticeSub, { color: theme.textSecondary }]} testID="text-code-info">
                  {infoMsg}
                </ThemedText>
              </View>
            </View>
          ) : null}

          {errorMsg ? (
            <View style={[styles.errorBox, { backgroundColor: standalone ? AUTH.errorBg : theme.statusNoGoBackground }]}>
              <Feather name="alert-circle" size={16} color={standalone ? AUTH.errorText : theme.statusNoGo} />
              <ThemedText style={[styles.errorText, { color: standalone ? AUTH.errorText : theme.statusNoGo }]}>{errorMsg}</ThemedText>
            </View>
          ) : null}

          <Pressable
            onPress={
              mode === "login"
                ? onLogin
                : registerStep === 1
                  ? onRequestCode
                  : registerStep === 2
                    ? onVerifyCode
                    : onCompleteRegister
            }
            disabled={busy}
            style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}
            testID={
              mode === "login"
                ? "button-login"
                : registerStep === 1
                  ? "button-register-next"
                  : registerStep === 2
                    ? "button-verify-code"
                    : "button-register"
            }
          >
            {busy ? (
              <ActivityIndicator color={primaryBtnTextColor} />
            ) : (
              <ThemedText style={[styles.primaryBtnText, { color: primaryBtnTextColor }]}>
                {mode === "login"
                  ? "Anmelden"
                  : registerStep === 1
                    ? "Code anfordern"
                    : registerStep === 2
                      ? "Code bestätigen"
                      : "Konto erstellen"}
              </ThemedText>
            )}
          </Pressable>

          {mode === "register" && registerStep === 2 ? (
            <Pressable
              onPress={onResendCode}
              disabled={busy}
              style={styles.resendBtn}
              testID="button-resend-code"
            >
              <ThemedText style={[styles.resendText, { color: busy ? theme.textSecondary : theme.primary }]}>
                Code erneut senden
              </ThemedText>
            </Pressable>
          ) : null}

          {mode === "register" && (registerStep === 2 || registerStep === 3) ? (
            <Pressable
              onPress={() => {
                setRegisterStep(registerStep === 3 ? 2 : 1);
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              style={styles.backLink}
              testID="button-register-back"
            >
              <Feather name="chevron-left" size={16} color={c.textSecondary} />
              <ThemedText style={[styles.backLinkText, { color: c.textSecondary }]}>Zurück</ThemedText>
            </Pressable>
          ) : null}

        </Card>

        <PackagesPromo />

        {standalone ? (
          <View style={styles.legalLinksRow}>
            <Pressable onPress={() => setLegalView("imprint")} testID="link-imprint" hitSlop={8}>
              <ThemedText style={[styles.legalLinkText, { color: c.textSecondary }]}>Impressum</ThemedText>
            </Pressable>
            <ThemedText style={[styles.legalLinkSeparator, { color: c.textTertiary }]}>·</ThemedText>
            <Pressable onPress={() => setLegalView("privacy")} testID="link-privacy" hitSlop={8}>
              <ThemedText style={[styles.legalLinkText, { color: c.textSecondary }]}>Datenschutzerklärung</ThemedText>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
  );

  const legalModal = (
    <Modal
      visible={legalView !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setLegalView(null)}
    >
      <ThemedView style={styles.container}>
        <View style={[styles.legalModalHeader, { borderBottomColor: theme.border, paddingTop: insets.top + Spacing.sm }]}>
          <ThemedText style={styles.legalModalTitle} numberOfLines={1}>
            {legalView === "imprint" ? "Impressum" : "Datenschutz"}
          </ThemedText>
          <Pressable onPress={() => setLegalView(null)} testID="button-close-legal" hitSlop={8} style={styles.legalModalClose}>
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={[styles.legalModalContent, { paddingBottom: insets.bottom + Spacing["2xl"] }]}
          scrollIndicatorInsets={{ bottom: insets.bottom }}
        >
          {legalView === "imprint" ? <LegalDocumentView document={IMPRINT} /> : null}
          {legalView === "privacy" ? <PrivacyPolicyView /> : null}
        </ScrollView>
      </ThemedView>
    </Modal>
  );

  if (standalone) {
    return (
      <View style={[styles.container, { backgroundColor: AUTH.bg }]}>
        {formBody}
        {legalModal}
      </View>
    );
  }
  return <ThemedView style={styles.container}>{formBody}</ThemedView>;
}


const addonStyles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
  },
  title: {
    fontSize: Typography.body.fontSize,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 4,
    fontSize: Typography.caption.fontSize,
    lineHeight: 18,
  },
  errorBox: {
    marginTop: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    fontSize: Typography.caption.fontSize,
  },
  row: {
    marginTop: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: Typography.body.fontSize,
    fontWeight: "600",
  },
  rowPrice: {
    marginTop: 2,
    fontSize: Typography.caption.fontSize,
  },
  ownedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  ownedText: {
    fontSize: Typography.caption.fontSize,
    fontWeight: "600",
  },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  unlockText: {
    color: "#FFFFFF",
    fontSize: Typography.caption.fontSize,
    fontWeight: "600",
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  legalLinksRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  legalLinkText: { ...Typography.small, textDecorationLine: "underline" },
  legalLinkSeparator: { ...Typography.small },
  legalModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legalModalTitle: { ...Typography.h3, flex: 1 },
  legalModalClose: { padding: Spacing.xs },
  legalModalContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  intro: { ...Typography.small, marginVertical: Spacing.md, lineHeight: 20 },
  tabRow: {
    flexDirection: "row",
    borderRadius: BorderRadius.lg,
    padding: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: "center",
    borderRadius: BorderRadius.md,
  },
  tabText: { ...Typography.body, fontWeight: "600" },
  formCard: { padding: Spacing.lg, gap: Spacing.md },
  field: { gap: 6 },
  fieldLabel: { ...Typography.small, fontWeight: "600" },
  fieldHint: { ...Typography.small },
  codeInput: { letterSpacing: 6, textAlign: "center", fontSize: 20, fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? Spacing.md : Spacing.sm,
    fontSize: 16,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  errorText: { ...Typography.small, flex: 1 },
  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  noticeContent: { flex: 1, gap: 4 },
  noticeSub: { ...Typography.small },
  emailRecap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  emailRecapText: { ...Typography.small, flex: 1, fontWeight: "600" },
  backLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: Spacing.sm },
  backLinkText: { ...Typography.small, fontWeight: "600" },
  resendBtn: { paddingVertical: Spacing.xs, alignSelf: "flex-start" },
  resendText: { ...Typography.small, fontWeight: "700" },
  primaryBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  primaryBtnFlex: { flex: 1 },
  primaryBtnText: { ...Typography.body, fontWeight: "700", color: "#FFFFFF" },
  secondaryBtn: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  secondaryBtnText: { ...Typography.body, fontWeight: "600" },
  profileCard: { alignItems: "center", padding: Spacing.xl, gap: Spacing.sm },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  profileName: { ...Typography.h2, fontWeight: "700" },
  profileEmail: { ...Typography.body },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.sm,
  },
  statusPillText: { ...Typography.small, fontWeight: "600" },
  actionCard: { padding: Spacing.lg },
  deletionCard: { padding: Spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(217, 119, 6, 0.4)" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  actionTitle: { ...Typography.body, fontWeight: "600" },
  actionSubtitle: { ...Typography.small, marginTop: 2 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  logoutText: { ...Typography.body, fontWeight: "700" },
  brandHeader: {
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  brandLogo: {
    width: 84,
    height: 84,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
  },
  brandLogoImg: {
    width: "100%",
    height: "100%",
  },
  brandTitle: { ...Typography.h1, fontWeight: "800", textAlign: "center" },
  brandSubtitle: { ...Typography.body, textAlign: "center" },
});
