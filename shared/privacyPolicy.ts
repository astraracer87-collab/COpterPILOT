/**
 * Zentrale Inhaltsquelle für die Datenschutzerklärung (DSGVO).
 *
 * Diese Datei ist die EINZIGE Quelle der Wahrheit für den Text der
 * Datenschutzerklärung und wird von Mobile (Expo) und Web gemeinsam genutzt.
 * Der Inhalt ist auf Deutsch und ohne Emojis (gemäß Projektvorgaben).
 *
 * Punkt 1 (verantwortliche Stelle) ist bewusst als klar erkennbarer
 * Platzhalter ausgeführt: Name, Anschrift, E-Mail und optional Telefon müssen
 * vom Betreiber vor Veröffentlichung ergänzt werden.
 */

export interface PrivacyPolicySection {
  /** Stabile ID (z. B. für Anker / Test-IDs). */
  id: string;
  /** Überschrift des Abschnitts. */
  title: string;
  /** Fließtext-Absätze. */
  paragraphs?: string[];
  /** Optionale Aufzählungspunkte. */
  bullets?: string[];
  /**
   * Markiert einen Abschnitt als auszufüllenden Platzhalter, damit die UI ihn
   * deutlich hervorheben kann (Punkt 1: verantwortliche Stelle).
   */
  isPlaceholder?: boolean;
}

/** Letzte Aktualisierung dieser Datenschutzerklärung (vom Betreiber zu pflegen). */
export const PRIVACY_POLICY_LAST_UPDATED = "Stand: bitte vom Betreiber ergänzen";

/**
 * Platzhalter für die verantwortliche Stelle (Punkt 1). Bezieht die Werte aus
 * der zentralen Quelle `responsibleEntity.ts`, damit Impressum und
 * Datenschutzerklärung garantiert dieselben Betreiberangaben zeigen. Der Name
 * bleibt als Re-Export erhalten, damit bestehende Screens unverändert
 * funktionieren.
 */
export { RESPONSIBLE_ENTITY_FIELDS as PRIVACY_CONTROLLER_PLACEHOLDER } from "./responsibleEntity";

import { RESPONSIBLE_ENTITY_FIELDS } from "./responsibleEntity";
import type { LegalDocument } from "./legal";
import { LEGAL_LAST_UPDATED } from "./legal";

export const PRIVACY_POLICY_TITLE = "Datenschutzerklärung";

export const PRIVACY_POLICY_INTRO =
  "Der Schutz deiner personenbezogenen Daten ist uns wichtig. Diese " +
  "Datenschutzerklärung informiert dich darüber, welche Daten beim Einsatz " +
  "dieser Pre-Flight-Check-App verarbeitet werden, zu welchem Zweck und auf " +
  "welcher Rechtsgrundlage. Sie informiert dich außerdem über deine Rechte als " +
  "betroffene Person.";

export const PRIVACY_POLICY_SECTIONS: PrivacyPolicySection[] = [
  {
    id: "verantwortliche-stelle",
    title: "1. Verantwortliche Stelle",
    isPlaceholder: true,
    paragraphs: [
      "Verantwortlich für die Datenverarbeitung im Sinne der " +
        "Datenschutz-Grundverordnung (DSGVO) ist die nachfolgend genannte " +
        "Stelle. Die konkreten Angaben sind vom Betreiber der App noch " +
        "auszufüllen.",
    ],
  },
  {
    id: "allgemeines",
    title: "2. Allgemeines zur Datenverarbeitung",
    paragraphs: [
      "Wir verarbeiten personenbezogene Daten unserer Nutzer grundsätzlich nur, " +
        "soweit dies zur Bereitstellung einer funktionsfähigen App sowie unserer " +
        "Inhalte und Leistungen erforderlich ist.",
      "Rechtsgrundlage ist je nach Verarbeitung die Erfüllung des " +
        "Nutzungsvertrags (Art. 6 Abs. 1 lit. b DSGVO), eine von dir erteilte " +
        "Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), eine rechtliche " +
        "Verpflichtung (Art. 6 Abs. 1 lit. c DSGVO) oder unser berechtigtes " +
        "Interesse am sicheren und stabilen Betrieb (Art. 6 Abs. 1 lit. f DSGVO).",
      "Personenbezogene Daten werden gelöscht, sobald der Zweck der Speicherung " +
        "entfällt oder du die Löschung verlangst, sofern keine gesetzlichen " +
        "Aufbewahrungspflichten entgegenstehen.",
    ],
  },
  {
    id: "lokale-nutzung",
    title: "3. Nutzung ohne Konto (lokale Speicherung)",
    paragraphs: [
      "Die App kann ohne Registrierung genutzt werden. In diesem Fall werden " +
        "deine Eingaben (z. B. Drohnen, Flugplanung, Logbuch, Einstellungen) " +
        "ausschließlich lokal auf deinem Gerät gespeichert und nicht an unseren " +
        "Server übertragen.",
      "Diese lokalen Daten liegen in deiner Verantwortung und werden beim " +
        "Löschen der App von deinem Gerät entfernt.",
    ],
  },
  {
    id: "konto",
    title: "4. Registrierung und Nutzerkonto",
    paragraphs: [
      "Wenn du ein Konto anlegst, verarbeiten wir die dabei angegebenen Daten, " +
        "um dich zu authentifizieren und deine Daten zwischen App und " +
        "Web-Oberfläche zu synchronisieren.",
    ],
    bullets: [
      "E-Mail-Adresse",
      "Name (optional)",
      "Passwort (ausschließlich als kryptografischer Hash gespeichert)",
      "Zeitpunkt der Registrierung und Aktualisierungen",
      "technische Token zur Bestätigung der E-Mail-Adresse",
    ],
  },
  {
    id: "pilotenprofil",
    title: "5. Pilotenprofil und hochgeladene Dokumente",
    paragraphs: [
      "Zur Erfüllung luftrechtlicher Nachweispflichten kannst du ein " +
        "Pilotenprofil anlegen. Die hier eingegebenen Daten und hochgeladenen " +
        "Dokumente dienen ausschließlich deiner eigenen Dokumentation und " +
        "werden nicht ohne dein Zutun an Dritte weitergegeben.",
    ],
    bullets: [
      "Name, e-ID / Pilotennummer, Betreibernummer",
      "Lizenzangaben (A1/A3, A2, STS) inkl. Gültigkeitsdaten",
      "Versicherungsstatus und ggf. hochgeladenes Versicherungsdokument",
      "Profilfoto (optional)",
      "Allgemeinverfügungen / Genehmigungen inkl. zugehöriger Dokumente",
    ],
  },
  {
    id: "drohnen",
    title: "6. Drohnenverwaltung",
    paragraphs: [
      "Für die von dir verwalteten Drohnen verarbeiten wir die zur Flugplanung " +
        "und Compliance-Prüfung erforderlichen Angaben.",
    ],
    bullets: [
      "Bezeichnung, Hersteller, Modell und technische Eigenschaften",
      "Seriennummer und Remote-ID-Angaben",
      "EU-Klassifizierung und Compliance-Daten",
      "ggf. hochgeladene Nachweisdokumente (z. B. AlphaTango, dFlight)",
      "Wartungs- und Verlaufsdaten",
    ],
  },
  {
    id: "flug-logbuch",
    title: "7. Flugplanung, Flugsessions und Logbuch",
    paragraphs: [
      "Bei der Planung und Durchführung von Flügen verarbeiten wir " +
        "Standort- und Flugdaten, um Geozonen, Wetter und Beschränkungen zu " +
        "prüfen und deine Flüge zu dokumentieren.",
    ],
    bullets: [
      "Standortdaten / Koordinaten des geplanten und durchgeführten Flugs",
      "Datum, Uhrzeit und Dauer der Flüge",
      "GPS-Flugspuren und Telemetrie",
      "importierte Fluglog-Dateien (z. B. DJI-Controller-Logs)",
      "aufgezeichnete Daten zum Luftverkehr während aktiver Sessions",
      "Logbucheinträge inkl. Anmerkungen",
    ],
  },
  {
    id: "externe-dienste",
    title: "8. Karten-, Wetter-, NOTAM- und Verkehrsdaten",
    paragraphs: [
      "Zur Anzeige von Karten, Geozonen, Wetter, NOTAMs und Live-Luftverkehr " +
        "ruft die App Daten externer Fachdienste ab. Dabei kann technisch " +
        "bedingt deine IP-Adresse an den jeweiligen Anbieter übermittelt werden, " +
        "damit die angefragten Inhalte ausgeliefert werden können.",
      "Zu diesen Diensten zählen unter anderem amtliche Geozonen- und " +
        "Kartendienste, Wetterdienste, NOTAM-Quellen sowie Quellen für " +
        "Live-Flugverkehr. Auf die Datenverarbeitung durch diese Drittanbieter " +
        "haben wir nur begrenzten Einfluss; es gelten deren " +
        "Datenschutzbestimmungen.",
    ],
  },
  {
    id: "zahlungen",
    title: "9. Abonnement und Zahlungsabwicklung",
    paragraphs: [
      "Für kostenpflichtige Funktionen nutzen wir den Zahlungsdienstleister " +
        "Stripe. Bei Abschluss eines Abonnements wird ein Kundenbezug bei " +
        "Stripe hergestellt; die eigentliche Zahlungsabwicklung erfolgt direkt " +
        "über Stripe.",
      "In unserem System speichern wir lediglich eine Referenz auf deinen " +
        "Stripe-Kundeneintrag sowie deinen Abo-/Berechtigungsstatus. " +
        "Vollständige Zahlungsdaten (z. B. Kartendaten) verarbeiten wir nicht; " +
        "diese liegen bei Stripe.",
    ],
  },
  {
    id: "hosting-storage",
    title: "10. Hosting und Object Storage",
    paragraphs: [
      "Die serverseitigen Daten werden in einer Datenbank gespeichert; " +
        "hochgeladene Dokumente (z. B. Lizenz-/Versicherungs-PDFs, Profilfoto) " +
        "werden in einem Object Storage abgelegt. Der Zugriff auf deine " +
        "Dokumente ist auf dein angemeldetes Konto beschränkt.",
    ],
  },
  {
    id: "rechte",
    title: "11. Deine Rechte als betroffene Person",
    paragraphs: [
      "Dir stehen nach der DSGVO insbesondere folgende Rechte zu:",
    ],
    bullets: [
      "Auskunft über die zu deiner Person gespeicherten Daten (Art. 15 DSGVO)",
      "Berichtigung unrichtiger Daten (Art. 16 DSGVO)",
      "Löschung deiner Daten (Art. 17 DSGVO)",
      "Einschränkung der Verarbeitung (Art. 18 DSGVO)",
      "Datenübertragbarkeit in einem maschinenlesbaren Format (Art. 20 DSGVO)",
      "Widerspruch gegen bestimmte Verarbeitungen (Art. 21 DSGVO)",
      "Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft",
      "Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO)",
    ],
  },
  {
    id: "selfservice",
    title: "12. Auskunft, Export und Löschung direkt in der App",
    paragraphs: [
      "Du kannst deine Rechte teilweise direkt in der App ausüben. Unter " +
        "\u201EMeine Daten\u201C findest du eine Übersicht der über dich " +
        "gespeicherten Daten.",
      "Über die Export-Funktion kannst du deine Daten in einem gängigen, " +
        "maschinenlesbaren Format (JSON) herunterladen bzw. teilen; verknüpfte " +
        "Dokumente sind enthalten oder als Download-Verweis aufgeführt.",
      "Über die Funktion \u201EKonto löschen\u201C kannst du deinen gesamten " +
        "Account inkl. aller serverseitig gespeicherten Daten und Dokumente " +
        "unwiderruflich löschen. Der Kundenbezug bei Stripe wird dabei " +
        "gekündigt bzw. entkoppelt.",
    ],
  },
  {
    id: "datensicherheit",
    title: "13. Datensicherheit",
    paragraphs: [
      "Wir treffen angemessene technische und organisatorische Maßnahmen, um " +
        "deine Daten gegen unbefugten Zugriff, Verlust oder Manipulation zu " +
        "schützen. Die Übertragung erfolgt verschlüsselt; Passwörter werden " +
        "ausschließlich als Hash gespeichert.",
    ],
  },
  {
    id: "aenderungen",
    title: "14. Aktualität und Änderung dieser Datenschutzerklärung",
    paragraphs: [
      "Diese Datenschutzerklärung ist aktuell gültig. Durch die " +
        "Weiterentwicklung der App oder geänderte rechtliche Vorgaben kann es " +
        "erforderlich werden, sie anzupassen. Die jeweils aktuelle Fassung kann " +
        "jederzeit in der App eingesehen werden.",
    ],
  },
];

/**
 * Datenschutzerklärung als generisches `LegalDocument` (gleiche Struktur wie
 * AGB/Impressum/Widerruf), damit sie im Consent-Gate und in jedem generischen
 * Renderer wiederverwendet werden kann. Die Felder der verantwortlichen Stelle
 * werden aus der zentralen Quelle in den Platzhalter-Abschnitt gespiegelt.
 */
export const PRIVACY_POLICY: LegalDocument = {
  id: "datenschutz",
  title: PRIVACY_POLICY_TITLE,
  intro: PRIVACY_POLICY_INTRO,
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: PRIVACY_POLICY_SECTIONS.map((s) =>
    s.id === "verantwortliche-stelle"
      ? { ...s, placeholderFields: RESPONSIBLE_ENTITY_FIELDS }
      : s,
  ),
};
