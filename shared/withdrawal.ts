/**
 * Zentrale Inhaltsquelle für die Widerrufsbelehrung (§§ 312g, 355 BGB) inkl.
 * Muster-Widerrufsformular (Anlage 2 zu Artikel 246a § 1 Abs. 2 EGBGB).
 *
 * EINZIGE Quelle der Wahrheit, gemeinsam von Mobile und Web genutzt. Inhalt auf
 * Deutsch, ohne Emojis. Hinweis: Dies sind Platzhalter-Inhalte; die konkreten
 * Betreiberangaben (Anschrift / Kontakt für den Widerruf) sind zu ergänzen und
 * anwaltlich prüfen zu lassen.
 *
 * Der besondere Hinweis zu § 356 Abs. 5 BGB (vorzeitiges Erlöschen des
 * Widerrufsrechts bei digitalen Inhalten/Dienstleistungen) ist hier dokumentiert
 * und wird zusätzlich aktiv im Checkout bestätigt.
 */

import type { LegalDocument } from "./legal";
import { LEGAL_LAST_UPDATED } from "./legal";

export const WITHDRAWAL: LegalDocument = {
  id: "widerruf",
  title: "Widerrufsbelehrung",
  lastUpdated: LEGAL_LAST_UPDATED,
  intro:
    "Verbraucher haben bei Fernabsatzverträgen ein gesetzliches " +
    "Widerrufsrecht. Die nachstehende Belehrung informiert über die " +
    "Voraussetzungen, Fristen und Folgen des Widerrufs. Es handelt sich um " +
    "Platzhalter-Inhalte, die vom Betreiber zu vervollständigen sind.",
  sections: [
    {
      id: "widerrufsrecht",
      title: "1. Widerrufsrecht",
      paragraphs: [
        "Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen " +
          "diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn " +
          "Tage ab dem Tag des Vertragsabschlusses.",
      ],
    },
    {
      id: "ausuebung",
      title: "2. Ausübung des Widerrufs",
      isPlaceholder: true,
      placeholderFields: [
        {
          label: "Widerrufsadressat",
          value: "[Platzhalter – Name, Anschrift, E-Mail des Betreibers]",
        },
      ],
      paragraphs: [
        "Um dein Widerrufsrecht auszuüben, musst du uns (Angaben siehe " +
          "Platzhalter) mittels einer eindeutigen Erklärung (z. B. ein mit der " +
          "Post versandter Brief oder eine E-Mail) über deinen Entschluss, " +
          "diesen Vertrag zu widerrufen, informieren. Du kannst dafür das " +
          "beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht " +
          "vorgeschrieben ist.",
        "Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung " +
          "über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist " +
          "absendest.",
      ],
    },
    {
      id: "folgen",
      title: "3. Folgen des Widerrufs",
      paragraphs: [
        "Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die " +
          "wir von dir erhalten haben, unverzüglich und spätestens binnen " +
          "vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über " +
          "deinen Widerruf dieses Vertrags bei uns eingegangen ist.",
        "Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das du " +
          "bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit " +
          "dir wurde ausdrücklich etwas anderes vereinbart; in keinem Fall " +
          "werden dir wegen dieser Rückzahlung Entgelte berechnet.",
      ],
    },
    {
      id: "erloeschen",
      title: "4. Vorzeitiges Erlöschen des Widerrufsrechts (§ 356 Abs. 5 BGB)",
      paragraphs: [
        "Bei einem Vertrag über die Bereitstellung von digitalen Inhalten, die " +
          "nicht auf einem körperlichen Datenträger geliefert werden, sowie bei " +
          "digitalen Dienstleistungen erlischt das Widerrufsrecht vorzeitig, " +
          "wenn wir mit der Ausführung des Vertrags begonnen haben, nachdem du",
      ],
      bullets: [
        "ausdrücklich zugestimmt hast, dass wir mit der Ausführung des Vertrags " +
          "vor Ablauf der Widerrufsfrist beginnen, und",
        "deine Kenntnis davon bestätigt hast, dass du durch deine Zustimmung mit " +
          "Beginn der Ausführung des Vertrags dein Widerrufsrecht verlierst.",
      ],
    },
    {
      id: "muster",
      title: "5. Muster-Widerrufsformular",
      paragraphs: [
        "Wenn du den Vertrag widerrufen möchtest, kannst du dieses Formular " +
          "ausfüllen und zurücksenden. Die Verwendung ist nicht vorgeschrieben.",
      ],
      preformatted:
        "An [Platzhalter – Name und Anschrift des Betreibers, E-Mail]:\n\n" +
        "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen " +
        "Vertrag über die Bereitstellung der folgenden digitalen " +
        "Inhalte/Dienstleistung (*):\n\n" +
        "_______________________________________________\n\n" +
        "Bestellt am (*) / erhalten am (*): ____________________\n\n" +
        "Name des/der Verbraucher(s): __________________________\n\n" +
        "Anschrift des/der Verbraucher(s): _____________________\n\n" +
        "Datum: ________________________________________________\n\n" +
        "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)\n\n" +
        "(*) Unzutreffendes streichen.",
    },
  ],
};
