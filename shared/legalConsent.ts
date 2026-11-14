/**
 * Zentrale Versionierung der aktiv einzuholenden Einwilligung in AGB und
 * Datenschutzerklärung.
 *
 * Wird die Version erhöht (z. B. nach inhaltlicher Änderung der AGB oder der
 * Datenschutzerklärung), wird die Zustimmung beim nächsten Start erneut
 * abgefragt. Die akzeptierte Version wird sowohl lokal (AsyncStorage /
 * localStorage) als auch serverseitig am Nutzerkonto gespeichert.
 *
 * Format bewusst als Datum-String, damit der nächste Bearbeiter sofort sieht,
 * wann zuletzt eine erneute Zustimmung erforderlich wurde.
 */
export const LEGAL_CONSENT_VERSION = "2026-06-27";

/** Ein Dokument, dem im Consent-Schritt aktiv zugestimmt werden muss. */
export interface LegalConsentDoc {
  id: string;
  /** Anzeigename (z. B. für den Checkbox-Text). */
  label: string;
  /** Web-Route zum Volltext (auch ohne Login erreichbar). */
  webRoute: string;
}

/**
 * Dokumente, deren aktive Zustimmung erforderlich ist. Bewusst nur AGB und
 * Datenschutz (nicht Impressum/Widerruf — die sind reine Informationspflichten
 * ohne Zustimmungsbedarf).
 */
export const LEGAL_CONSENT_DOCS: LegalConsentDoc[] = [
  { id: "agb", label: "Allgemeine Geschäftsbedingungen (AGB)", webRoute: "/agb" },
  { id: "datenschutz", label: "Datenschutzerklärung", webRoute: "/datenschutz" },
];

/**
 * Liefert true, wenn (erneut) eine Zustimmung eingeholt werden muss, weil die
 * gespeicherte akzeptierte Version nicht der aktuellen entspricht (oder fehlt).
 */
export function needsLegalConsent(
  acceptedVersion: string | null | undefined,
): boolean {
  return acceptedVersion !== LEGAL_CONSENT_VERSION;
}
