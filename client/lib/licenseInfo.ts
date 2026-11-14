export type LicenseInfoKey = "A1A3" | "A2" | "STS";

export interface LicenseInfoLink {
  label: string;
  url: string;
}

export interface LicenseInfo {
  key: LicenseInfoKey;
  flag: string;
  title: string;
  whatIsIt: string;
  howToGet: string;
  links: LicenseInfoLink[];
}

export const LICENSE_INFO: Record<LicenseInfoKey, LicenseInfo> = {
  A1A3: {
    key: "A1A3",
    flag: "🇪🇺",
    title: "EU-Kompetenznachweis A1/A3",
    whatIsIt:
      "Der EU-Kompetenznachweis A1/A3 ist die Basis-Lizenz für die offene Kategorie (Open). Er gilt EU-weit und ist Pflicht für fast alle Drohnen ab 250 g. A1 erlaubt Flüge nahe an unbeteiligten Personen (mit Drohnen <250 g bzw. C0/C1), A3 nur fern von Menschen und Bebauung (≥150 m Abstand zu Wohn-, Gewerbe-, Industrie- und Erholungsgebieten). Mindestalter in Deutschland: 16 Jahre. Die Bescheinigung ist 5 Jahre gültig.",
    howToGet:
      "Kostenloser Online-Lehrgang + Online-Test direkt beim LBA über das digitale Servicebüro (OpenUAV). Der Test besteht aus 40 Multiple-Choice-Fragen, ist beliebig oft wiederholbar und sofort auswertbar. Voraussetzung ist eine vorherige Registrierung als UAS-Betreiber (e-ID). Die Bescheinigung kannst du danach als PDF herunterladen und mitführen (digital reicht).",
    links: [
      { label: "LBA OpenUAV (Test & Bescheinigung)", url: "https://lba-openuav.de" },
      { label: "LBA: Kompetenznachweise (Übersicht)", url: "https://www.lba.de/DE/Drohnen/Kompetenznachweise/Kompetenznachweise_node.html" },
      { label: "EU-Verordnung 2019/947", url: "https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32019R0947" },
    ],
  },
  A2: {
    key: "A2",
    flag: "🇪🇺",
    title: "EU-Fernpiloten-Zeugnis A2",
    whatIsIt:
      "Das Fernpiloten-Zeugnis A2 erlaubt Flüge in der Unterkategorie A2 der offenen Kategorie — also näher an unbeteiligten Personen (bis 30 m bzw. 5 m im Langsamflug ≤3 m/s mit Drohnen der Klasse C2 bis 4 kg). Es baut auf dem A1/A3-Nachweis auf und ist 5 Jahre gültig. Mindestalter in Deutschland: 16 Jahre. Voraussetzung: A1/A3 + ein eigenständiges, dokumentiertes Praxis-Selbststudium.",
    howToGet:
      "Theorieprüfung bei einer vom LBA anerkannten Prüfstelle (in Deutschland u. a. TÜV, DEKRA, DMFV, Drone Class oder Online-Anbieter wie copter-profi). Die Prüfung umfasst 30 Multiple-Choice-Fragen (mind. 75 % korrekt). Kosten je nach Anbieter ca. 30–80 €. Vor der Prüfung musst du ein praktisches Selbststudium (Dokumentation der Flüge in A3-Umgebung) absolviert haben — wird im Anmeldeprozess bestätigt.",
    links: [
      { label: "LBA: Anerkannte Prüfstellen A2", url: "https://www.lba.de/DE/Drohnen/Kompetenznachweise/A2/A2_node.html" },
      { label: "LBA OpenUAV", url: "https://lba-openuav.de" },
      { label: "DMFV A2-Prüfung", url: "https://www.dmfv.aero/eu-kompetenznachweis/" },
    ],
  },
  STS: {
    key: "STS",
    flag: "🇪🇺",
    title: "STS-Betriebsgenehmigung (Spezielle Kategorie)",
    whatIsIt:
      "STS (Standard Scenario) ist eine Betriebsgenehmigung in der speziellen Kategorie (Specific) der EU. Du brauchst sie für Flüge, die über die offene Kategorie hinausgehen — z. B. BVLOS, höher als 120 m oder über Menschenansammlungen unter genau definierten Bedingungen. Es gibt zwei europäische Standardszenarien: STS-01 (VLOS über kontrolliertem Bodenbereich in besiedeltem Gebiet) und STS-02 (BVLOS mit Luftraumbeobachtern, dünn besiedelt). Voraussetzung sind eine C5- bzw. C6-Drohne, ein eigenes Betriebshandbuch und eine schriftliche Erklärung beim LBA.",
    howToGet:
      "Du brauchst zusätzlich zum A1/A3-Nachweis ein STS-Fernpilotenzeugnis: Theorieprüfung (40 Fragen) beim LBA + praktische Ausbildung bei einer anerkannten Stelle (Anerkannte Ausbildungseinrichtung, ATO oder Hersteller). Danach reichst du eine STS-Erklärung beim LBA ein (Online über OpenUAV, kostenfrei). Das LBA bestätigt den Eingang — keine echte Genehmigung, aber ohne Bestätigung darfst du nicht starten. Praxistraining kostet typischerweise 500–2.000 € je nach Anbieter.",
    links: [
      { label: "LBA: STS & Spezielle Kategorie", url: "https://www.lba.de/DE/Drohnen/Betrieb/Spezielle_Kategorie/Spezielle_Kategorie_node.html" },
      { label: "LBA OpenUAV (STS-Erklärung)", url: "https://lba-openuav.de" },
      { label: "EASA: Standard Scenarios", url: "https://www.easa.europa.eu/en/domains/civil-drones/specific-category-civil-drones/standard-scenarios" },
    ],
  },
};
