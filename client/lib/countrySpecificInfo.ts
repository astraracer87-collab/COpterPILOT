export type CountrySpecificKey =
  | "insuranceCH1Mio"
  | "insuranceATSzr"
  | "alphaTangoFR"
  | "dFlightIT"
  | "caaUK";

export interface CountrySpecificLink {
  label: string;
  url: string;
}

export interface CountrySpecificInfo {
  key: CountrySpecificKey;
  flag: string;
  title: string;
  whatIsIt: string;
  howToGet: string;
  links: CountrySpecificLink[];
}

export const COUNTRY_SPECIFIC_INFO: Record<CountrySpecificKey, CountrySpecificInfo> = {
  insuranceCH1Mio: {
    key: "insuranceCH1Mio",
    flag: "🇨🇭",
    title: "CH: Versicherung 1 Mio. CHF",
    whatIsIt:
      "In der Schweiz brauchst du für Drohnen ab 250 g eine Haftpflichtversicherung mit einer Mindestdeckung von 1 Mio. CHF. Eine normale private Haftpflicht reicht in den allermeisten Fällen NICHT, weil sie UAS ausschließt oder nicht hoch genug deckt. Den Nachweis musst du beim Flug mit dabei haben — digital auf dem Handy oder ausgedruckt.",
    howToGet:
      "Drohnen-Haftpflicht direkt bei einem deutschen UAS-Versicherer abschließen. Bewährt haben sich u. a. der DMFV (Deutscher Modellflieger-Verband), die DMO (Deutsche Modellsport Organisation) sowie spezialisierte Anbieter wie Helden.de oder Versichertedrohne.de. Achte darauf, dass die Police die Schweiz ausdrücklich einschließt und die Deckungssumme ≥ 1 Mio. CHF (bzw. ≥ 1 Mio. EUR + CH-Geltungsbereich) beträgt.",
    links: [
      { label: "DMFV Versicherung", url: "https://www.dmfv.aero/versicherung/" },
      { label: "Helden.de Drohnen-Haftpflicht", url: "https://www.helden.de/drohnen-haftpflichtversicherung" },
      { label: "Versichertedrohne.de", url: "https://www.versichertedrohne.de" },
    ],
  },
  insuranceATSzr: {
    key: "insuranceATSzr",
    flag: "🇦🇹",
    title: "AT: Versicherung 750.000 SZR",
    whatIsIt:
      "Österreich verlangt nach § 164 Luftfahrtgesetz (LFG) für ALLE Drohnen eine Halterhaftpflicht mit mindestens 750.000 SZR (Sonderziehungsrechte, ca. 900.000 €) Deckung. Wichtig: Eine normale private Haftpflicht reicht hier in der Regel NICHT — du brauchst eine explizite Bestätigung nach § 164 LFG. Die Austro Control kontrolliert das streng.",
    howToGet:
      "Bei einem deutschen UAS-Versicherer (z. B. Helden.de, Versichertedrohne.de, DMFV, DMO) eine Drohnen-Haftpflicht abschließen und ausdrücklich die Bestätigung nach § 164 LFG für Österreich anfordern. Diese Bescheinigung musst du beim Flug mitführen.",
    links: [
      { label: "Helden.de (mit § 164 LFG)", url: "https://www.helden.de/drohnen-haftpflichtversicherung" },
      { label: "Versichertedrohne.de", url: "https://www.versichertedrohne.de" },
      { label: "DMFV Versicherung", url: "https://www.dmfv.aero/versicherung/" },
      { label: "Austro Control Dronespace", url: "https://www.dronespace.at" },
    ],
  },
  alphaTangoFR: {
    key: "alphaTangoFR",
    flag: "🇫🇷",
    title: "FR: AlphaTango-Registrierung",
    whatIsIt:
      "Frankreich verlangt zusätzlich zur EU-Betreiber-ID (e-ID) eine eigene Registrierung für Drohnen ab 800 g auf dem Portal AlphaTango der DGAC. Dazu gehört auch ein kostenloses Online-Training mit kurzem Test. Die erhaltene Registrierungsnummer muss sichtbar an der Drohne angebracht werden.",
    howToGet:
      "Account auf alphaTango.aviation-civile.gouv.fr anlegen, Drohne registrieren, Online-Training inkl. Test absolvieren und die Registrierungsnummer auf einem Aufkleber an der Drohne anbringen. Komplett kostenlos.",
    links: [
      { label: "AlphaTango Portal (DGAC)", url: "https://alphatango.aviation-civile.gouv.fr" },
      {
        label: "DJI: Remote-ID für Frankreich einrichten (Anleitung)",
        url: "https://enterprise-insights.dji.com/blog/how-to-make-your-dji-drone-compliant-with-french-remote-id",
      },
    ],
  },
  dFlightIT: {
    key: "dFlightIT",
    flag: "🇮🇹",
    title: "IT: D-Flight QR-Code",
    whatIsIt:
      "Italien verlangt einen kostenpflichtigen QR-Code von D-Flight (ENAC), der physisch auf der Drohne kleben muss — sonst drohen empfindliche Bußgelder. D-Flight ist gleichzeitig die einzige offizielle No-Fly-Karte für Italien; Hersteller-Geofences sind nicht rechtsverbindlich.",
    howToGet:
      "Account auf d-flight.it anlegen, als Base User registrieren (ca. 6 € pro Jahr), Drohne hinzufügen und den generierten QR-Code ausdrucken bzw. als wetterfesten Aufkleber an der Drohne anbringen.",
    links: [
      { label: "D-Flight Portal", url: "https://d-flight.it" },
      { label: "D-Flight Geoportal (No-Fly-Karte)", url: "https://www.d-flight.it/new_portal/geoportal/" },
    ],
  },
  caaUK: {
    key: "caaUK",
    flag: "🇬🇧",
    title: "UK: CAA Registrierung",
    whatIsIt:
      "Achtung: Im Vereinigten Königreich gelten EU-Dokumente NICHT — weder die deutsche e-ID noch der EU-Kompetenznachweis A1/A3 sind gültig. Du brauchst ein eigenes UK-System der Civil Aviation Authority: eine Operator ID (£11,13/Jahr, für den Drohnen-Eigentümer, muss an der Drohne sichtbar sein) UND eine Flyer ID (kostenlos, für den Piloten, nach einem Online-Test).",
    howToGet:
      "Auf register-drones.caa.co.uk registrieren: Operator ID kostenpflichtig anlegen und auf einem Aufkleber an der Drohne anbringen; Flyer ID per Online-Test (40 Fragen, beliebig oft wiederholbar) erwerben und den Pass digital oder gedruckt mitführen.",
    links: [
      { label: "CAA Drone Register", url: "https://register-drones.caa.co.uk" },
      { label: "Drone Assist (NATS Karte)", url: "https://dronesafe.uk/drone-assist/" },
    ],
  },
};
