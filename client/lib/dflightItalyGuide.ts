export interface GuideStep {
  title: string;
  details: string[];
}

export interface DflightGuide {
  title: string;
  subtitle: string;
  intro: string;
  steps: GuideStep[];
  notes: string[];
  portalUrl: string;
  portalLabel: string;
  sourceNote: string;
}

/**
 * Schritt-für-Schritt-Anleitung zur D-Flight-/ENAC-Registrierung für Flüge in
 * Italien. Inhaltlich übernommen aus der frei verfügbaren Anleitung von
 * drohnen-camp.de (2020-09 Anleitung Italien D-Flight) und an den aktuellen
 * Stand des D-Flight-Portals angepasst. Bewusst als eigener In-App-Text
 * hinterlegt, nicht nur als externer Link.
 */
export const DFLIGHT_ITALY_GUIDE: DflightGuide = {
  title: "D-Flight Registrierung Italien",
  subtitle: "Schritt für Schritt zum QR-Code für Flüge in Italien",
  intro:
    "Wer in Italien fliegt, braucht einen kostenpflichtigen QR-Code von D-Flight " +
    "und eine Registrierung als UAS-Betreiber bei der Luftfahrtbehörde ENAC. Eine " +
    "bereits im Heimatland vergebene EU-Betreiber-ID (e-ID) wird anerkannt — eine " +
    "Doppel-Registrierung ist nicht nötig. Der QR-Code muss pro Drohne erworben und " +
    "sichtbar an der Drohne angebracht werden. Die folgende Anleitung führt durch den " +
    "gesamten Ablauf.",
  steps: [
    {
      title: "Konto auf dem D-Flight-Portal anlegen",
      details: [
        "Das D-Flight-Portal (d-flight.it) öffnen und oben die Registrierung (\"Registrati\") wählen.",
        "Als ausländischer Pilot ohne italienisches SPID die Registrierung per E-Mail wählen und die persönlichen Daten eingeben.",
        "Die Bestätigungs-E-Mail abwarten und das Konto über den Link aktivieren, danach einloggen.",
        "Tipp: Das Portal ist auf Italienisch/Englisch; die automatische Browser-Übersetzung hilft beim Ausfüllen.",
      ],
    },
    {
      title: "Als UAS-Betreiber registrieren und EU-Betreiber-ID hinterlegen",
      details: [
        "Im Konto das Betreiber-Profil (\"Operatore\") vervollständigen.",
        "Die im Heimatland vergebene EU-Betreiber-ID (e-ID, z. B. vom LBA) im Profil eintragen — sie wird in Italien anerkannt.",
        "Wer noch keine e-ID hat, registriert sich zuerst im Heimatland als UAS-Betreiber. Eine zweite ENAC-Registrierung ist dann nicht erforderlich.",
      ],
    },
    {
      title: "Drohne im Portal anlegen",
      details: [
        "Im Bereich für die Geräte (\"Mezzi\"/UAS) die Drohne neu anlegen.",
        "Hersteller, Modell, Startgewicht (MTOM) und — falls vorhanden — die EU-Klassen-Kennzeichnung (C0–C4) eintragen.",
        "Jede Drohne, die in Italien geflogen wird, muss einzeln angelegt werden.",
      ],
    },
    {
      title: "QR-Code kaufen",
      details: [
        "Im QR-Code-Bereich des Portals einen QR-Code erwerben (kostenpflichtig, ca. 6 EUR pro Drohne).",
        "Die Bezahlung erfolgt online, in der Regel per Kreditkarte.",
        "Pro Drohne wird ein eigener QR-Code benötigt.",
      ],
    },
    {
      title: "QR-Code der Drohne zuordnen",
      details: [
        "Den gekauften QR-Code im Portal mit der zuvor angelegten Drohne verknüpfen.",
        "Erst durch diese Zuordnung wird der QR-Code für die jeweilige Drohne gültig.",
      ],
    },
    {
      title: "QR-Code erstellen und an der Drohne anbringen",
      details: [
        "Den fertigen QR-Code aus dem Portal herunterladen bzw. ausdrucken.",
        "Den QR-Code wetterfest (z. B. laminiert) und gut sichtbar an der Drohne anbringen.",
        "Zusätzlich die Betreiber-Nummer (e-ID) an der Drohne anbringen, wie EU-weit vorgeschrieben.",
      ],
    },
  ],
  notes: [
    "Kosten: Der QR-Code kostet ca. 6 EUR pro Drohne; je nach Portal-Stand können weitere Gebühren anfallen.",
    "Der QR-Code muss bei jedem Flug sichtbar an der Drohne angebracht sein.",
    "Eine EU-Betreiber-ID (e-ID) aus dem Heimatland wird in Italien anerkannt — keine Doppel-Registrierung.",
    "EU-Kompetenznachweis (A1/A3) bzw. A2-Fernpilotenzeugnis je nach Drohnenklasse mitführen.",
    "Den Vorgang rechtzeitig vor der Reise erledigen, da die Aktivierung etwas Zeit in Anspruch nehmen kann.",
  ],
  portalUrl: "https://www.d-flight.it/new_portal",
  portalLabel: "D-Flight Portal öffnen",
  sourceNote:
    "Inhaltlich übernommen aus der Anleitung von drohnen-camp.de. Stand: 2026. Angaben ohne Gewähr.",
};
