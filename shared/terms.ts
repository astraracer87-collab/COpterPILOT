/**
 * Zentrale Inhaltsquelle für die Allgemeinen Geschäftsbedingungen (AGB) /
 * Nutzungsbedingungen.
 *
 * EINZIGE Quelle der Wahrheit, gemeinsam von Mobile und Web genutzt. Inhalt auf
 * Deutsch, ohne Emojis. Hinweis: Dies sind Platzhalter-Inhalte. Die konkrete
 * rechtliche Ausgestaltung ist vom Betreiber zu ergänzen bzw. anwaltlich prüfen
 * zu lassen. Betreiberspezifische Stellen (z. B. Gerichtsstand) sind als
 * Platzhalter markiert.
 */

import type { LegalDocument } from "./legal";
import { LEGAL_LAST_UPDATED, ODR_VSBG_SECTION } from "./legal";

export const TERMS: LegalDocument = {
  id: "agb",
  title: "Allgemeine Geschäftsbedingungen (AGB)",
  lastUpdated: LEGAL_LAST_UPDATED,
  intro:
    "Diese Allgemeinen Geschäftsbedingungen regeln die Nutzung der " +
    "Pre-Flight-Check-App (nachfolgend „App“) und der dazugehörigen " +
    "Web-Oberfläche. Es handelt sich um Platzhalter-Inhalte, die vor " +
    "Veröffentlichung vom Betreiber zu vervollständigen sind.",
  sections: [
    {
      id: "geltungsbereich",
      title: "1. Geltungsbereich",
      paragraphs: [
        "Diese AGB gelten für die Nutzung der App und der Web-Oberfläche des " +
          "Betreibers durch Verbraucher und Unternehmer. Maßgeblich ist die zum " +
          "Zeitpunkt der Nutzung jeweils gültige Fassung.",
        "Abweichenden Bedingungen des Nutzers wird widersprochen, soweit nicht " +
          "ausdrücklich etwas anderes vereinbart wurde.",
      ],
    },
    {
      id: "anbieter",
      title: "2. Anbieter und Vertragspartner",
      paragraphs: [
        "Vertragspartner ist der im Impressum genannte Diensteanbieter. Die " +
          "vollständigen Anbieterangaben sind dem Impressum zu entnehmen.",
      ],
    },
    {
      id: "leistung",
      title: "3. Leistungsbeschreibung",
      paragraphs: [
        "Die App unterstützt Drohnenpiloten bei der Flugvorbereitung, der " +
          "Durchführung von Pre-Flight-Checks sowie bei der Dokumentation von " +
          "Flügen (u. a. Karten, Geozonen, Wetter, NOTAMs, Logbuch).",
        "Die bereitgestellten Informationen dienen ausschließlich der " +
          "Unterstützung. Sie stellen keine behördliche Freigabe dar und " +
          "ersetzen nicht die eigenverantwortliche Prüfung durch den Piloten. " +
          "Für die Vollständigkeit, Aktualität und Richtigkeit der von Dritten " +
          "bezogenen Daten (z. B. Geozonen, Wetter, NOTAMs, Luftverkehr) wird " +
          "keine Gewähr übernommen.",
      ],
    },
    {
      id: "vertragsschluss",
      title: "4. Registrierung und Vertragsschluss",
      paragraphs: [
        "Die Nutzung in Grundfunktionen ist ohne Konto möglich. Für die " +
          "Synchronisierung zwischen App und Web sowie für kostenpflichtige " +
          "Funktionen ist ein Nutzerkonto erforderlich.",
        "Ein kostenpflichtiger Vertrag kommt zustande, indem der Nutzer ein " +
          "Paket auswählt, den Bestellvorgang über den Zahlungsdienstleister " +
          "abschließt und die Zahlungsbestätigung erfolgt.",
      ],
    },
    {
      id: "preise-zahlung",
      title: "5. Preise und Zahlung",
      paragraphs: [
        "Die jeweils gültigen Preise ergeben sich aus der Paketauswahl in der " +
          "App bzw. Web-Oberfläche. Alle Preise verstehen sich inklusive der " +
          "gesetzlichen Umsatzsteuer, soweit nicht anders angegeben.",
        "Die Zahlungsabwicklung erfolgt über den Zahlungsdienstleister Stripe. " +
          "Es gelten ergänzend dessen Bedingungen für die Zahlungsabwicklung.",
      ],
    },
    {
      id: "laufzeit",
      title: "6. Laufzeit, Verlängerung und Kündigung",
      isPlaceholder: true,
      placeholderFields: [
        {
          label: "Laufzeit / Verlängerung",
          value: "[Platzhalter – konkrete Laufzeit- und Kündigungsfristen ergänzen]",
        },
      ],
      paragraphs: [
        "Abonnements verlängern sich entsprechend der bei Buchung angegebenen " +
          "Laufzeit, sofern sie nicht fristgerecht gekündigt werden. Die " +
          "Kündigung ist über die Konto-Funktionen bzw. den " +
          "Zahlungsdienstleister möglich. Die konkreten Fristen sind vom " +
          "Betreiber zu ergänzen.",
      ],
    },
    {
      id: "widerruf",
      title: "7. Widerrufsrecht für Verbraucher",
      paragraphs: [
        "Verbrauchern steht bei Fernabsatzverträgen ein gesetzliches " +
          "Widerrufsrecht zu. Die Einzelheiten ergeben sich aus der gesonderten " +
          "Widerrufsbelehrung, die auch ein Muster-Widerrufsformular enthält.",
        "Bei digitalen Inhalten und digitalen Dienstleistungen kann das " +
          "Widerrufsrecht vorzeitig erlöschen, wenn der Nutzer ausdrücklich " +
          "zustimmt, dass mit der Ausführung vor Ablauf der Widerrufsfrist " +
          "begonnen wird, und seine Kenntnis vom Erlöschen des Widerrufsrechts " +
          "bestätigt (§ 356 Abs. 5 BGB).",
      ],
    },
    {
      id: "pflichten",
      title: "8. Pflichten und Verantwortung des Nutzers",
      paragraphs: [
        "Der Nutzer trägt die alleinige Verantwortung für die Einhaltung aller " +
          "luftrechtlichen Vorgaben (u. a. EU-Drohnenverordnung, nationale " +
          "Regelungen, behördliche Auflagen). Die App entbindet nicht von " +
          "dieser Verantwortung.",
      ],
      bullets: [
        "eigenverantwortliche Prüfung von Geozonen, Beschränkungen und Wetter",
        "Sicherstellung erforderlicher Genehmigungen und Versicherungen",
        "Einhaltung der direkten Sichtverbindung zum Fluggerät",
        "wahrheitsgemäße Angaben bei Registrierung und im Pilotenprofil",
      ],
    },
    {
      id: "haftung",
      title: "9. Haftungsbeschränkung",
      paragraphs: [
        "Der Betreiber haftet unbeschränkt für Schäden aus der Verletzung des " +
          "Lebens, des Körpers oder der Gesundheit sowie für Schäden, die auf " +
          "Vorsatz oder grober Fahrlässigkeit beruhen.",
        "Für leichte Fahrlässigkeit haftet der Betreiber nur bei Verletzung " +
          "einer wesentlichen Vertragspflicht (Kardinalpflicht) und begrenzt " +
          "auf den vorhersehbaren, vertragstypischen Schaden. Eine weitergehende " +
          "Haftung ist ausgeschlossen. Die Haftung nach dem " +
          "Produkthaftungsgesetz bleibt unberührt.",
      ],
    },
    {
      id: "verfuegbarkeit",
      title: "10. Verfügbarkeit und Änderungen der App",
      paragraphs: [
        "Der Betreiber ist bemüht, die App möglichst unterbrechungsfrei " +
          "bereitzustellen. Ein Anspruch auf ständige Verfügbarkeit besteht " +
          "nicht; Wartungsarbeiten, Störungen externer Dienste oder höhere " +
          "Gewalt können zu Einschränkungen führen.",
      ],
    },
    {
      id: "aenderung-agb",
      title: "11. Änderungen dieser AGB",
      paragraphs: [
        "Der Betreiber kann diese AGB mit Wirkung für die Zukunft anpassen, " +
          "soweit dies aus sachlichem Grund (z. B. geänderte Rechtslage, neue " +
          "Funktionen) erforderlich ist. Über Änderungen wird in geeigneter " +
          "Weise informiert; gegebenenfalls wird eine erneute Zustimmung " +
          "eingeholt.",
      ],
    },
    ODR_VSBG_SECTION,
    {
      id: "schluss",
      title: "13. Schlussbestimmungen",
      isPlaceholder: true,
      placeholderFields: [
        {
          label: "Anwendbares Recht / Gerichtsstand",
          value: "[Platzhalter – vom Betreiber prüfen und ergänzen]",
        },
      ],
      paragraphs: [
        "Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des " +
          "UN-Kaufrechts; bei Verbrauchern bleiben zwingende Schutzvorschriften " +
          "des Staates ihres gewöhnlichen Aufenthalts unberührt. Sollte eine " +
          "Bestimmung dieser AGB unwirksam sein, bleibt die Wirksamkeit der " +
          "übrigen Bestimmungen unberührt.",
      ],
    },
  ],
};
