/**
 * Gemeinsame Typen und wiederverwendbare Bausteine für die rechtlichen
 * Dokumente der App (AGB, Impressum, Widerrufsbelehrung). Diese Datei ist
 * RN-frei und wird von Mobile (Expo) und Web identisch genutzt, damit die
 * Inhalte offline aus `shared/` lesbar sind.
 *
 * Der gesamte Inhalt ist auf Deutsch und ohne Emojis (Projektvorgaben). Alle
 * konkret vom Betreiber auszufüllenden Stellen sind als Platzhalter markiert
 * (`isPlaceholder` / `placeholderFields`) und werden in der UI deutlich
 * hervorgehoben.
 */

/** Ein Label/Wert-Paar für klar erkennbare Platzhalter-Felder. */
export interface LegalLabeledValue {
  label: string;
  value: string;
}

/** Ein Abschnitt eines rechtlichen Dokuments. */
export interface LegalSection {
  /** Stabile ID (für Anker / Test-IDs). */
  id: string;
  /** Überschrift des Abschnitts. */
  title: string;
  /** Fließtext-Absätze. */
  paragraphs?: string[];
  /** Optionale Aufzählungspunkte. */
  bullets?: string[];
  /**
   * Markiert den Abschnitt als auszufüllenden Platzhalter, damit die UI ihn
   * deutlich hervorhebt (z. B. verantwortliche Stelle, Registereintrag).
   */
  isPlaceholder?: boolean;
  /** Optionale Platzhalter-Felder (Label/Wert), im Abschnitt hervorgehoben. */
  placeholderFields?: LegalLabeledValue[];
  /** Optionaler vorformatierter Block (z. B. Muster-Widerrufsformular). */
  preformatted?: string;
}

/** Ein vollständiges rechtliches Dokument. */
export interface LegalDocument {
  id: string;
  title: string;
  intro: string;
  lastUpdated: string;
  sections: LegalSection[];
}

/** Einheitlicher Hinweistext über jedem Platzhalter-Block. */
export const LEGAL_PLACEHOLDER_NOTICE = "Vom Betreiber auszufüllen";

/** Einheitliches „Stand“-Datum (vom Betreiber zu pflegen). */
export const LEGAL_LAST_UPDATED = "Stand: bitte vom Betreiber ergänzen";

/**
 * Gemeinsamer Abschnitt zur Online-Streitbeilegung (ODR) und zur
 * Verbraucherstreitbeilegung (VSBG). Wird identisch in Impressum UND AGB
 * eingebunden, damit beide Stellen nie auseinanderlaufen.
 */
export const ODR_VSBG_SECTION: LegalSection = {
  id: "streitbeilegung",
  title: "Online-Streitbeilegung und Verbraucherstreitbeilegung",
  isPlaceholder: true,
  paragraphs: [
    "Die Europäische Kommission stellt eine Plattform zur " +
      "Online-Streitbeilegung (OS) bereit, die unter " +
      "https://ec.europa.eu/consumers/odr erreichbar ist. Unsere " +
      "E-Mail-Adresse findest du im Impressum.",
    "Wir sind nicht verpflichtet und grundsätzlich nicht bereit, an einem " +
      "Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle im " +
      "Sinne des Verbraucherstreitbeilegungsgesetzes (VSBG) teilzunehmen. " +
      "Diese Angabe ist vom Betreiber zu prüfen und gegebenenfalls anzupassen.",
  ],
};
