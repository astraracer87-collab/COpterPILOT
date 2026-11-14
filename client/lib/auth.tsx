/**
 * RC-Version ohne Server: kein Login, kein Abo. Der Kontext meldet einen
 * lokalen Nutzer mit voller Freischaltung, damit alle Funktionen verfügbar
 * sind. Daten bleiben ausschließlich auf dem Gerät (isLoggedInSync() = false,
 * dadurch speichert storage.ts nur lokal).
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { FEATURE_CATALOG } from "../../shared/featureCatalog";
import type { DeletionInfo, Entitlement, FeatureDefinition, TrialState } from "./subscription";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin?: boolean;
  legalConsentVersion?: string | null;
  legalConsentAt?: string | null;
  setupGuideStatus?: string | null;
};

// Antwort des "Code anfordern"-Schritts. "already_registered" -> UI leitet zur
// Anmeldung; "mail_not_configured" -> klare Meldung statt stillem Fehlschlag;
// "code_sent" -> weiter zum Code-Schritt.
export type RequestCodeStatus = "code_sent" | "already_registered" | "mail_not_configured";

type LoginResponse = { user: AuthUser; sessionCookie?: string | null };
type AuthStatus = "loading" | "authenticated" | "anonymous";

/**
 * Status des Abo-Ladevorgangs:
 *  - "idle":    noch nicht geladen (kein eingeloggter Nutzer)
 *  - "loading": Abruf läuft
 *  - "ready":   Entitlement liegt vor
 *  - "error":   Abruf fehlgeschlagen (App bleibt gesperrt, Retry möglich)
 */
type SubscriptionStatus = "idle" | "loading" | "ready" | "error";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  requestRegistrationCode: (email: string) => Promise<RequestCodeStatus>;
  verifyRegistrationCode: (email: string, code: string) => Promise<void>;
  completeRegistration: (input: {
    email: string;
    code: string;
    password: string;
    name?: string;
  }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Aktive Zustimmung zu AGB + Datenschutz (Version) serverseitig speichern. */
  recordConsent: (version: string) => Promise<void>;
  // Abo / Berechtigungen
  entitlement: Entitlement | null;
  trial: TrialState | null;
  /** Dauer des einmaligen Komplett-Tests in Stunden (vom Server). */
  trialDurationHours: number;
  featureCatalog: FeatureDefinition[];
  /** Countdown bis zur automatischen Konto-Löschung (null = aktiver Zugang). */
  deletion: DeletionInfo | null;
  subscriptionStatus: SubscriptionStatus;
  /** true, sobald ein aktives Entitlement vorliegt (App freigeschaltet). */
  hasActiveEntitlement: boolean;
  refreshSubscription: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Für storage.ts: false = alles lokal speichern, nie an einen Server. */
export function isLoggedInSync(): boolean {
  return false;
}

export function waitForAuthReady(_timeoutMs = 4000): Promise<void> {
  return Promise.resolve();
}

const LOCAL_USER: AuthUser = {
  id: "local",
  email: "",
  name: null,
  legalConsentVersion: null,
  setupGuideStatus: "done",
};

const LOCAL_ENTITLEMENT: Entitlement = {
  active: true,
  source: "manual",
  allFeatures: true,
  features: [],
  plan: null,
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  manualPlanUntil: null,
  allCountries: true,
  countries: [],
};

const notAvailable = async (): Promise<never> => {
  throw new Error("In der RC-Version gibt es kein Benutzerkonto.");
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      user: LOCAL_USER,
      status: "authenticated",
      isAuthenticated: true,
      login: notAvailable,
      requestRegistrationCode: notAvailable,
      verifyRegistrationCode: notAvailable,
      completeRegistration: notAvailable,
      logout: async () => {},
      refresh: async () => {},
      recordConsent: async () => {},
      entitlement: LOCAL_ENTITLEMENT,
      trial: null,
      trialDurationHours: 0,
      featureCatalog: FEATURE_CATALOG as unknown as FeatureDefinition[],
      deletion: null as DeletionInfo | null,
      subscriptionStatus: "ready",
      hasActiveEntitlement: true,
      refreshSubscription: async () => {},
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
