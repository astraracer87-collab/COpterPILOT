import { apiJson } from "./api-client";
import { getApiUrl } from "./query-client";

/**
 * Mobile-Abo-Schicht.
 *
 * Liest den Abo-/Berechtigungsstatus (`GET /api/subscription/me`) und die
 * buchbaren Pakete (`GET /api/subscription/packages`). Die Bezahlung selbst
 * findet ausschließlich im Web statt — die App leitet dafür per
 * `getSubscribeUrl()` in den Browser weiter.
 *
 * Die Typen spiegeln bewusst die Server-Strukturen aus `server/entitlements.ts`
 * und `shared/featureCatalog.ts` wider (Quelle der Wahrheit ist der Server).
 */

export type EntitlementSource = "admin" | "manual" | "stripe" | "trial" | "none";

export interface EntitlementPlan {
  productId: string | null;
  productName: string | null;
  priceId: string | null;
  interval: string | null;
  amount: number | null;
  currency: string | null;
}

export interface Entitlement {
  /** true = App ist freigeschaltet. */
  active: boolean;
  source: EntitlementSource;
  /** true = alle Features (Admin, Trial, unbegrenzter manueller Plan). */
  allFeatures: boolean;
  /** Freigeschaltete Feature-Keys (leer wenn allFeatures). */
  features: string[];
  plan: EntitlementPlan | null;
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  manualPlanUntil: string | null;
  /** true = Zugriff auf ALLE Länder (Admin, Trial, unbegrenzter Override). */
  allCountries: boolean;
  /** Freigeschaltete Länder als Uppercase-ISO (leer wenn allCountries). */
  countries: string[];
}

export interface TrialState {
  /** Kann der Nutzer den Test (noch) starten? (Nie genutzt) */
  available: boolean;
  active: boolean;
  used: boolean;
  startedAt: string | null;
  expiresAt: string | null;
}

export interface FeatureDefinition {
  key: string;
  name: string;
  description: string;
}

/** Ein buchbares Land (Task #522). */
export interface BookableCountry {
  iso: string;
  name: string;
}

/** Ein buchbares Länder-Add-on inkl. Preisen. */
export interface CountryAddon {
  id: string;
  country: string;
  name: string;
  description: string | null;
  prices: AvailablePackagePrice[];
}

/** Countdown bis zur automatischen Konto-Löschung (60-Tage-Frist ohne Abo). */
export interface DeletionInfo {
  /** Geplanter Löschzeitpunkt (ISO) oder null bei aktivem Zugang. */
  scheduledAt: string | null;
  /** Verbleibende Tage (0..60) oder null bei aktivem Zugang. */
  daysRemaining: number | null;
  /** Ist der Zugang aktiv (kein Countdown)? */
  active: boolean;
}

export interface SubscriptionStatus {
  entitlement: Entitlement;
  trial: TrialState;
  trialDurationHours: number;
  featureCatalog: FeatureDefinition[];
  countryCatalog?: BookableCountry[];
  defaultBaseCountry?: string;
  deletion?: DeletionInfo;
}

export interface AvailablePackagePrice {
  id: string;
  amount: number | null;
  currency: string | null;
  interval: string | null;
}

export interface AvailablePackage {
  id: string;
  name: string;
  description: string | null;
  features: string[];
  prices: AvailablePackagePrice[];
  order: number | null;
}

export interface PackagesResponse {
  packages: AvailablePackage[];
  countryAddons?: CountryAddon[];
  countryCatalog?: BookableCountry[];
  defaultBaseCountry?: string;
  featureCatalog: FeatureDefinition[];
}

/** Lädt den aktuellen Abo-/Berechtigungsstatus des eingeloggten Nutzers. */
export async function fetchSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiJson<SubscriptionStatus>("/api/subscription/me");
}

/** Lädt die buchbaren Pakete inkl. Feature-Katalog. */
export async function fetchAvailablePackages(): Promise<PackagesResponse> {
  return apiJson<PackagesResponse>("/api/subscription/packages");
}

/**
 * Startet den einmaligen Komplett-Test (Test-Paket). Nur einmal pro Konto
 * möglich; ein bereits genutzter Test führt serverseitig zu einem Fehler
 * (HTTP 409), der hier durchgereicht wird. Nach Erfolg sollte der Aufrufer den
 * Abo-Status neu laden (refreshSubscription).
 */
export async function startTrial(): Promise<void> {
  await apiJson("/api/subscription/trial/start", { method: "POST" });
}

/**
 * Lädt den öffentlichen Paket-Katalog (OHNE Login) für die Werbe-Ansicht auf
 * dem Anmelde-/Registrieren-Screen. Liefert dieselben allgemeinen Katalog-Daten
 * wie {@link fetchAvailablePackages}, aber ohne nutzerspezifische Felder.
 */
export async function fetchPublicPackages(): Promise<PackagesResponse> {
  return apiJson<PackagesResponse>("/api/public/packages");
}

/**
 * Fordert einen kurzlebigen Login-Handoff-Token an (`POST
 * /api/subscription/handoff`). Mit ihm öffnet der Browser den Web-Checkout
 * BEREITS angemeldet — ohne erneute E-Mail/Passwort-Eingabe. Der Token ist
 * einmalig und nur wenige Minuten gültig.
 */
export async function fetchHandoffToken(): Promise<string> {
  const res = await apiJson<{ token: string }>(
    "/api/subscription/handoff",
    { method: "POST" },
  );
  if (!res?.token) throw new Error("Kein Handoff-Token erhalten");
  return res.token;
}

/**
 * Baut die Browser-Einlöse-URL für den Login-Handoff. Der Browser landet über
 * `/checkout-handoff` angemeldet — bei gewähltem Preis (`priceId`) UND erteilter
 * § 356-Zustimmung (`consent`) DIREKT auf der Stripe-Bezahlseite, sonst (nur
 * `paket`/`land`) auf der Web-Paketauswahl mit vorgewähltem Paket.
 * Niemals eine Domain hart kodieren — Basis kommt aus `getApiUrl()`.
 */
export function buildCheckoutHandoffUrl(opts: {
  token: string;
  land?: string | null;
  paket?: string | null;
  priceId?: string | null;
  consent?: boolean;
}): string {
  const base = getApiUrl();
  const apply = (set: (k: string, v: string) => void) => {
    set("token", opts.token);
    if (opts.land) set("land", opts.land);
    if (opts.paket) set("paket", opts.paket);
    if (opts.priceId) set("priceId", opts.priceId);
    if (opts.consent) set("consent", "1");
  };
  try {
    const url = new URL("/checkout-handoff", base);
    apply((k, v) => url.searchParams.set(k, v));
    return url.toString();
  } catch {
    // Fallback: manuell zusammenbauen, falls URL() scheitert.
    const params = new URLSearchParams();
    apply((k, v) => params.set(k, v));
    const trimmed = base.replace(/\/+$/, "");
    return `${trimmed}/checkout-handoff?${params.toString()}`;
  }
}

/**
 * Ziel-URL für „Im Browser abonnieren" OHNE Handoff (Fallback, wenn kein Token
 * erstellt werden konnte). Führt direkt zur Paketauswahl der Web-App.
 * Konfigurierbar über `EXPO_PUBLIC_SUBSCRIBE_URL`. Niemals eine Domain hart
 * kodieren — Basis kommt aus `getApiUrl()`.
 */
export function getSubscribeUrl(): string {
  const override = process.env.EXPO_PUBLIC_SUBSCRIBE_URL?.trim();
  if (override) return override;
  try {
    return new URL("/pakete", getApiUrl()).toString();
  } catch {
    return getApiUrl();
  }
}

/** Prüft, ob ein Entitlement Zugriff auf ein bestimmtes Feature gewährt. */
export function entitlementHasFeature(
  entitlement: Entitlement | null,
  featureKey: string,
): boolean {
  if (!entitlement || !entitlement.active) return false;
  if (entitlement.allFeatures) return true;
  return entitlement.features.includes(featureKey);
}

/**
 * Prüft, ob ein Entitlement ein bestimmtes Land freischaltet (Task #522).
 * Quelle der Wahrheit bleibt die Server-Prüfung (countryGate); diese Funktion
 * steuert nur das UI (Ausgrauen gesperrter Nachbarn + „Land freischalten").
 */
export function entitlementHasCountry(
  entitlement: Entitlement | null | undefined,
  iso: string | null | undefined,
): boolean {
  if (!entitlement || !entitlement.active) return false;
  if (entitlement.allCountries) return true;
  const norm = (iso ?? "").trim().toUpperCase();
  if (!norm) return false;
  return entitlement.countries.includes(norm);
}

/** Formatiert einen Stripe-Betrag (kleinste Einheit) als deutschen Preis. */
export function formatPrice(
  amount: number | null,
  currency: string | null,
  interval: string | null,
): string | null {
  if (amount == null) return null;
  const value = amount / 100;
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: (currency || "EUR").toUpperCase(),
    }).format(value);
  } catch {
    formatted = `${value.toFixed(2)} ${(currency || "EUR").toUpperCase()}`;
  }
  const intervalLabel =
    interval === "month"
      ? " / Monat"
      : interval === "year"
        ? " / Jahr"
        : interval === "week"
          ? " / Woche"
          : interval === "day"
            ? " / Tag"
            : "";
  return `${formatted}${intervalLabel}`;
}
