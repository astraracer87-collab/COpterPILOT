/**
 * Länder-Berechtigungen ("Country Access") — die zweite Entitlement-Dimension
 * neben den Features (shared/featureCatalog.ts).
 *
 * Modell:
 *  - Pro Abo ist GENAU EIN Land inklusive ("Basis-Land"). Der Nutzer wählt es
 *    beim Kauf; es wird in den Stripe-Subscription-Metadaten unter `base_country`
 *    gespeichert.
 *  - Weitere Länder sind einzeln dazubuchbar ("Add-on"). Ein Add-on ist ein
 *    eigenes Stripe-Produkt mit `metadata.kind = "country_addon"` und
 *    `metadata.country = "<ISO>"`. Das jeweilige Add-on-Abo schaltet genau dieses
 *    Land frei.
 *  - Admin / Trial / unbegrenzter manueller Override schalten ALLE Länder frei
 *    (`allCountries`).
 *
 * Diese Datei ist bewusst frei von Server-/RN-Imports, damit Server, Web und
 * Mobile dieselbe (reine) Logik nutzen und sie unter dem tsx-Testrunner geprüft
 * werden kann.
 */
import { COUNTRY_MAPS } from "./countryMaps";

export interface BookableCountry {
  /** ISO-3166-1-Alpha-2-Code (Großbuchstaben), z. B. "DE". */
  iso: string;
  /** Deutscher Anzeigename, z. B. "Deutschland". */
  name: string;
}

/**
 * Stammdaten der buchbaren Länder — abgeleitet aus der zentralen Länder-
 * Stammliste (COUNTRY_MAPS). Welche dieser Länder TATSÄCHLICH verkauft werden,
 * entscheidet der Admin, indem er pro Land ein Add-on-Produkt mit Preis anlegt.
 */
export const BOOKABLE_COUNTRIES: BookableCountry[] = COUNTRY_MAPS.map((c) => ({
  iso: c.iso.toUpperCase(),
  name: c.nameDE,
}));

const BOOKABLE_ISO_SET = new Set<string>(BOOKABLE_COUNTRIES.map((c) => c.iso));

/**
 * Standard-Basis-Land für Abos, deren `base_country` (noch) nicht gesetzt ist
 * (z. B. Bestands-Abos aus der Zeit vor der Länder-Auswahl). Verhindert, dass
 * Bestandskunden versehentlich ohne jedes Land dastehen.
 */
export const DEFAULT_BASE_COUNTRY = "DE";

/** Normalisiert einen ISO-Code auf Großbuchstaben (oder null bei leer). */
export function normalizeCountryIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const up = String(iso).trim().toUpperCase();
  return up.length > 0 ? up : null;
}

/** Ist `iso` ein bekanntes, grundsätzlich buchbares Land? */
export function isBookableCountry(iso: string | null | undefined): boolean {
  const up = normalizeCountryIso(iso);
  return up != null && BOOKABLE_ISO_SET.has(up);
}

/** Liefert den deutschen Anzeigenamen zu einem ISO-Code (oder den ISO-Code). */
export function countryName(iso: string | null | undefined): string {
  const up = normalizeCountryIso(iso);
  if (!up) return "";
  return BOOKABLE_COUNTRIES.find((c) => c.iso === up)?.name ?? up;
}

/** Anzeigename der Schweiz in Geozonen-/Länder-Hinweisen: LI folgt immer CH (gleiche Daten). */
export const CH_LI_GEOZONE_LABEL = "Schweiz / Liechtenstein";

/**
 * Ländername für Geozonen-Hinweise (Abdeckung, Datenstand, „deaktiviert“):
 * Schweiz und Liechtenstein erscheinen gemeinsam als „Schweiz / Liechtenstein“.
 */
export function geozoneCountryName(iso: string | null | undefined): string {
  const up = normalizeCountryIso(iso);
  if (up === "CH" || up === "LI") return CH_LI_GEOZONE_LABEL;
  return countryName(iso);
}

/**
 * Parst die einem (Produkt- oder Subscription-)Metadaten-Objekt zugeordneten
 * Länder. Berücksichtigt drei Schlüssel:
 *  - `countries`    : JSON-Array (`["DE","AT"]`) oder kommagetrennt (`DE, AT`).
 *  - `base_country` : einzelnes inklusives Basis-Land.
 *  - `country`      : einzelnes Land (Add-on-Produkt).
 * Unbekannte / nicht buchbare ISO-Codes werden herausgefiltert. Das Ergebnis
 * ist dedupliziert und in Großbuchstaben.
 */
export function parseCountriesFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  if (!metadata) return [];
  const out = new Set<string>();

  const addCandidate = (raw: unknown) => {
    const up = normalizeCountryIso(typeof raw === "string" ? raw : String(raw ?? ""));
    if (up && BOOKABLE_ISO_SET.has(up)) out.add(up);
  };

  const listRaw = metadata["countries"];
  if (Array.isArray(listRaw)) {
    for (const v of listRaw) addCandidate(v);
  } else if (typeof listRaw === "string") {
    const trimmed = listRaw.trim();
    let candidates: string[] = [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) candidates = parsed.map((v) => String(v));
      } catch {
        candidates = trimmed.split(",");
      }
    } else if (trimmed) {
      candidates = trimmed.split(",");
    }
    for (const c of candidates) addCandidate(c);
  }

  addCandidate(metadata["base_country"]);
  addCandidate(metadata["country"]);

  return [...out];
}

/** Ist das Produkt (laut Metadaten) ein Länder-Add-on? */
export function isCountryAddonProduct(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata) return false;
  const kind = normalizeCountryIso(
    typeof metadata["kind"] === "string" ? (metadata["kind"] as string) : "",
  );
  if (kind === "COUNTRY_ADDON") return true;
  // Fallback: ein Produkt mit gesetztem `country`-Feld gilt ebenfalls als Add-on.
  return normalizeCountryIso(metadata["country"] as string | undefined) != null;
}

/** Das von einem Add-on-Produkt freigeschaltete Land (oder null). */
export function countryAddonIso(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const iso = normalizeCountryIso(metadata["country"] as string | undefined);
  return iso && BOOKABLE_ISO_SET.has(iso) ? iso : null;
}

/** Minimal-Form eines aufgelösten Entitlements für die Länder-Entscheidung. */
export interface CountryEntitlementView {
  active: boolean;
  allCountries: boolean;
  countries: string[];
}

/**
 * Reine Entscheidungsfunktion: Gewährt ein (aufgelöstes) Entitlement Zugriff auf
 * die Geozonen/NOTAMs/Karten eines bestimmten Landes? Admin/Trial/unbegrenzte
 * Overrides (`allCountries`) bestehen immer; sonst zählt die explizite
 * Länder-Liste. Inaktive Entitlements gewähren nichts.
 */
export function entitlementGrantsCountry(
  entitlement: CountryEntitlementView | null | undefined,
  iso: string | null | undefined,
): boolean {
  if (!entitlement || !entitlement.active) return false;
  if (entitlement.allCountries) return true;
  const up = normalizeCountryIso(iso);
  if (!up) return false;
  return entitlement.countries.some((c) => c.toUpperCase() === up);
}

/**
 * Teilt eine Liste von Länder-ISO-Codes in freigeschaltete und gesperrte auf.
 * Genutzt von der Karte (Web + Mobile), um gesperrte Nachbarländer ausgegraut
 * statt mit Zonen darzustellen. Reihenfolge bleibt erhalten.
 */
export function splitCountriesByAccess(
  isos: string[],
  entitlement: CountryEntitlementView | null | undefined,
): { unlocked: string[]; locked: string[] } {
  const unlocked: string[] = [];
  const locked: string[] = [];
  for (const iso of isos) {
    if (entitlementGrantsCountry(entitlement, iso)) unlocked.push(iso);
    else locked.push(iso);
  }
  return { unlocked, locked };
}
