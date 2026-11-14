/**
 * EINZIGE zentrale Quelle für die "verantwortliche Stelle" / Anbieterangaben.
 *
 * Diese Kontaktangaben werden sowohl vom Impressum (§ 5 DDG) als auch von der
 * Datenschutzerklärung (verantwortliche Stelle nach DSGVO) genutzt, damit beide
 * Dokumente garantiert dieselben Betreiberdaten zeigen. Der Betreiber muss die
 * Platzhalterwerte vor Veröffentlichung durch seine echten Angaben ersetzen.
 */

import type { LegalLabeledValue } from "./legal";

/**
 * Kern-Kontaktangaben der verantwortlichen Stelle (Name, Anschrift, Kontakt).
 * Gemeinsame Basis für Impressum + Datenschutzerklärung.
 */
export const RESPONSIBLE_ENTITY_FIELDS: LegalLabeledValue[] = [
  { label: "Name / Firma", value: "[Platzhalter – bitte ergänzen]" },
  { label: "Anschrift", value: "[Platzhalter – Straße, Hausnummer, PLZ, Ort]" },
  { label: "E-Mail", value: "[Platzhalter – kontakt@example.com]" },
  { label: "Telefon (optional)", value: "[Platzhalter – optional]" },
];
