/**
 * Zentrale Inhaltsquelle für das Impressum (Anbieterkennzeichnung nach § 5 DDG).
 *
 * EINZIGE Quelle der Wahrheit für den Impressums-Text, gemeinsam von Mobile und
 * Web genutzt. Die verantwortliche Stelle stammt aus `responsibleEntity.ts`
 * (gemeinsam mit der Datenschutzerklärung). Alle weiteren betreiberspezifischen
 * Angaben sind als Platzhalter markiert. Inhalt auf Deutsch, ohne Emojis.
 *
 * Hinweis: Dies sind Platzhalter-Inhalte. Die konkrete rechtliche Ausgestaltung
 * (z. B. Registereintrag, USt-IdNr., Aufsichtsbehörde) ist vom Betreiber zu
 * ergänzen bzw. anwaltlich prüfen zu lassen.
 */

import type { LegalDocument } from "./legal";
import { LEGAL_LAST_UPDATED, ODR_VSBG_SECTION } from "./legal";
import { RESPONSIBLE_ENTITY_FIELDS } from "./responsibleEntity";

export const IMPRINT: LegalDocument = {
  id: "impressum",
  title: "Impressum",
  lastUpdated: LEGAL_LAST_UPDATED,
  intro:
    "Anbieterkennzeichnung gemäß § 5 Digitale-Dienste-Gesetz (DDG) sowie " +
    "Angaben nach § 18 Abs. 2 Medienstaatsvertrag (MStV). Die nachstehenden " +
    "Angaben sind vom Betreiber der App vor Veröffentlichung zu vervollständigen.",
  sections: [
    {
      id: "anbieter",
      title: "1. Diensteanbieter",
      isPlaceholder: true,
      placeholderFields: RESPONSIBLE_ENTITY_FIELDS,
      paragraphs: [
        "Verantwortlich für dieses Angebot im Sinne des § 5 DDG ist die " +
          "nachfolgend genannte Stelle. Die konkreten Angaben sind vom " +
          "Betreiber noch auszufüllen.",
      ],
    },
    {
      id: "vertretung",
      title: "2. Vertretungsberechtigte Person",
      isPlaceholder: true,
      placeholderFields: [
        {
          label: "Vertreten durch",
          value: "[Platzhalter – z. B. Geschäftsführer/in, Inhaber/in]",
        },
      ],
      paragraphs: [
        "Soweit es sich beim Anbieter um eine juristische Person handelt, ist " +
          "hier die vertretungsberechtigte Person anzugeben.",
      ],
    },
    {
      id: "register",
      title: "3. Registereintrag",
      isPlaceholder: true,
      placeholderFields: [
        { label: "Registergericht", value: "[Platzhalter – falls vorhanden]" },
        { label: "Registernummer", value: "[Platzhalter – z. B. HRB 12345]" },
      ],
      paragraphs: [
        "Sofern eine Eintragung in ein Handels-, Vereins-, Partnerschafts- " +
          "oder Genossenschaftsregister besteht, ist diese hier anzugeben.",
      ],
    },
    {
      id: "umsatzsteuer",
      title: "4. Umsatzsteuer-Identifikationsnummer",
      isPlaceholder: true,
      placeholderFields: [
        {
          label: "USt-IdNr. (§ 27a UStG)",
          value: "[Platzhalter – falls vorhanden]",
        },
      ],
      paragraphs: [
        "Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz, " +
          "sofern vorhanden.",
      ],
    },
    {
      id: "verantwortlich-inhalt",
      title: "5. Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV",
      isPlaceholder: true,
      placeholderFields: [
        {
          label: "Inhaltlich verantwortlich",
          value: "[Platzhalter – Name und Anschrift]",
        },
      ],
      paragraphs: [
        "Für journalistisch-redaktionell gestaltete Inhalte ist die hier " +
          "genannte Person verantwortlich.",
      ],
    },
    {
      id: "haftung-inhalte",
      title: "6. Haftung für Inhalte",
      paragraphs: [
        "Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte " +
          "auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach " +
          "den §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht " +
          "verpflichtet, übermittelte oder gespeicherte fremde Informationen zu " +
          "überwachen oder nach Umständen zu forschen, die auf eine " +
          "rechtswidrige Tätigkeit hinweisen.",
        "Verpflichtungen zur Entfernung oder Sperrung der Nutzung von " +
          "Informationen nach den allgemeinen Gesetzen bleiben hiervon " +
          "unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem " +
          "Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei " +
          "Bekanntwerden entsprechender Rechtsverletzungen werden wir diese " +
          "Inhalte umgehend entfernen.",
      ],
    },
    {
      id: "haftung-links",
      title: "7. Haftung für Links",
      paragraphs: [
        "Unser Angebot enthält Links zu externen Websites Dritter, auf deren " +
          "Inhalte wir keinen Einfluss haben. Deshalb können wir für diese " +
          "fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der " +
          "verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber " +
          "der Seiten verantwortlich.",
        "Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist ohne " +
          "konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei " +
          "Bekanntwerden von Rechtsverletzungen werden wir derartige Links " +
          "umgehend entfernen.",
      ],
    },
    {
      id: "urheberrecht",
      title: "8. Urheberrecht",
      paragraphs: [
        "Die durch den Betreiber erstellten Inhalte und Werke auf diesen " +
          "Seiten unterliegen dem deutschen Urheberrecht. Beiträge Dritter sind " +
          "als solche gekennzeichnet. Die Vervielfältigung, Bearbeitung, " +
          "Verbreitung und jede Art der Verwertung außerhalb der Grenzen des " +
          "Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen " +
          "Autors bzw. Erstellers.",
      ],
    },
    ODR_VSBG_SECTION,
  ],
};
