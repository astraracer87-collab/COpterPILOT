export interface CountryInfo {
  iso: string;
  name: string;
  summary: string;
  minAge: string;
  insurance: string;
  nightFlight: string;
  maxAltitudeM: string;
  registration: string;
  authority: { name: string; url?: string; email?: string };
  noFlyApp: { name: string; url: string };
  specialNotes: string[];
  checklist: string[];
}

export const COUNTRY_INFO: CountryInfo[] = [
  {
    iso: "DE",
    name: "Deutschland",
    summary:
      "Heimatland dieser App. Vollständige Integration: dipul-Karte, Geozonen, NOTAMs, BfN-Naturschutz, ED-R, AV-Abdeckung. EU-Drohnenverordnung (2019/947) wird durch LuftVO und LBA umgesetzt.",
    minAge: "16 Jahre (Open A1/A3). Jünger nur unter Aufsicht einer registrierten Person ≥16 Jahre.",
    insurance: "Haftpflichtversicherung mit Drohnen-Deckung ist Pflicht (LuftVG §43). Police muss UAS einschließen und beim Flug verfügbar sein.",
    nightFlight:
      "In der Open-Kategorie erlaubt, wenn die Drohne grün blinkende Positionslichter trägt. Bei A2/A3 zusätzliche Sichtbarkeitspflicht.",
    maxAltitudeM: "120 m AGL (Open). Höher nur in der Specific Category mit Genehmigung des LBA.",
    registration:
      "Pflicht ab Drohnen ≥250 g oder mit Kamera/Sensor. Registrierung im LBA-OpenUAV-Portal → e-ID muss physisch auf der Drohne sein.",
    authority: { name: "Luftfahrt-Bundesamt (LBA), Referat B5", url: "https://lba-openuav.de", email: "uas@lba.de" },
    noFlyApp: { name: "dipul / Map Tool", url: "https://maptool-dipul.dfs.de" },
    specialNotes: [
      "Bundesländer dürfen eigene Allgemeinverfügungen (AV) erlassen — App prüft AV-Abdeckung pro Geozone.",
      "ED-R 146 Berlin: 3 NM um Reichstag = Strafbarkeit nach §62 LuftVG.",
      "Naturschutzgebiete, Nationalparks und FFH-Gebiete: Aufstieg ist meist nach BNatSchG §44 verboten — Karte: BfN.",
      "Geozonen-WMS-Layer können live in der Radar-Karte eingeblendet werden.",
    ],
    checklist: [
      "e-ID auf Drohne aufgebracht",
      "EU-Kompetenznachweis A1/A3 (oder A2) bei sich",
      "Haftpflicht mit Drohnen-Deckung gültig",
      "dipul + NOTAMs für den Flugort geprüft",
      "AV des Bundeslandes geprüft (Pilotenprofil)",
    ],
  },
  {
    iso: "NL",
    name: "Niederlande",
    summary:
      "EU-Drohnenregeln gelten vollständig — deutsche e-ID + A1/A3 sind anerkannt. Sehr dichter Luftraum (Schiphol, Rotterdam, Eindhoven) und viele Natura-2000-Gebiete.",
    minAge: "16 Jahre. Ausnahme: Drohnen <250 g (z. B. Mini-Serie) und zertifizierte Spielzeugdrohnen → kein Mindestalter. Jüngere Piloten nur unter Aufsicht ≥16 J.",
    insurance:
      "Pflicht ab 20 kg MTOM oder bei gewerblicher Nutzung. Privat <20 kg dringend empfohlen — viele deutsche Haftpflichten decken UAS im EU-Ausland ab; vorher Police prüfen.",
    nightFlight: "In der Open-Kategorie streng verboten. Flüge nur während der gesetzlichen Tageszeit.",
    maxAltitudeM: "120 m AGL (Open).",
    registration: "Deutsche LBA-Registrierung (e-ID) ist vollständig anerkannt — nicht erneut registrieren.",
    authority: { name: "Inspectie Leefomgeving en Transport (ILT)", url: "https://www.ilent.nl" },
    noFlyApp: { name: "GoDrone (offizielle ILT-Karte/App)", url: "https://map.godrone.nl" },
    specialNotes: [
      "Natura-2000-Gebiete sind oft komplett gesperrt — GoDrone zeigt die Zonen.",
      "Überfliegen von Menschenansammlungen, Industrie, Häfen, Autobahnen und Bahntrassen verboten.",
      "Sehr viele Kontrollzonen (CTR) — Schiphol-CTR ist besonders ausgedehnt.",
      "FPV nur mit Spotter erlaubt.",
    ],
    checklist: [
      "Deutsche e-ID auf Drohne",
      "A1/A3-Nachweis digital oder gedruckt (ab 250 g)",
      "Versicherungsbestätigung auf EN/NL im Gepäck",
      "GoDrone-App installiert + Standort vor jedem Start geprüft",
    ],
  },
  {
    iso: "AT",
    name: "Österreich",
    summary:
      "EU-Recht gilt — Austro Control (ACG) ist die zuständige Behörde. Wer eine LBA-e-ID hat, registriert sich nicht erneut, muss aber bei AT-Wohnsitz dort registriert sein.",
    minAge: "16 Jahre (Open A1/A3). Jünger nur unter Aufsicht.",
    insurance: "Haftpflicht mit Drohnen-Deckung ist Pflicht. Mindestdeckung 750.000 SZR (ca. 900.000 €) gemäß VO (EG) 785/2004.",
    nightFlight: "Erlaubt in Open mit grünem Blinklicht (wie EU-Standard).",
    maxAltitudeM: "120 m AGL.",
    registration: "Austro Control eID-Portal. Bei vorhandener LBA-e-ID gilt diese im AT-Luftraum.",
    authority: { name: "Austro Control GmbH (ACG)", url: "https://dronespace.at", email: "drohnen@austrocontrol.at" },
    noFlyApp: { name: "dronespace.at (offizielle ACG-Karte)", url: "https://www.dronespace.at" },
    specialNotes: [
      "Nationalparks (Hohe Tauern, Donau-Auen u. a.) sind grundsätzlich Sperrgebiete für UAS.",
      "Schi- und Bergregionen: viele Heliports + Tiefflugzonen — vor Flug ACG-Karte prüfen.",
      "Wien hat großräumige CTR-Beschränkungen (Schwechat + City).",
      "Austro Control gibt CTR-Freigaben für Anflugkontrolle an mehrere CTR (siehe ACG-NfL).",
    ],
    checklist: [
      "e-ID am Quadrocopter",
      "A1/A3 oder A2-Kompetenznachweis",
      "Versicherung ≥750.000 SZR Deckung",
      "dronespace.at-App geprüft",
    ],
  },
  {
    iso: "CH",
    name: "Schweiz",
    summary:
      "EU-Drohnenrecht gilt seit 1.1.2023 vollständig (BAZL-Übernahme). Deutsche e-ID + EU-Nachweis sind anerkannt. Eigenheiten: höhere Versicherungssumme, sehr strenge Natur- und Wildschutzgebiete.",
    minAge: "12 Jahre für A1/A3. Jünger nur unter Aufsicht einer registrierten erwachsenen Person.",
    insurance: "Haftpflicht-Pflicht ab 250 g: Mindestdeckung 1 Mio. CHF. Deutsche Police muss CH explizit einschließen.",
    nightFlight: "Erlaubt in Open mit grünem Blinklicht (EU-Standard).",
    maxAltitudeM: "120 m AGL (Open). In Bergregionen relativer Boden — Vorsicht an Hängen!",
    registration: "BAZL UAS.gate-Portal. LBA-e-ID wird als gültig anerkannt.",
    authority: { name: "Bundesamt für Zivilluftfahrt (BAZL)", url: "https://www.uas.gate.bazl.admin.ch" },
    noFlyApp: { name: "map.geo.admin.ch (Drohnenkarte) + Air Navigation Pro", url: "https://map.geo.admin.ch/?topic=bazl" },
    specialNotes: [
      "Eidg. Jagdbanngebiete und Wasser-/Zugvogelreservate sind ganzjährig gesperrt (1 km Pufferzone, 150 m AGL).",
      "Naturschutzgebiete oft kantonal geregelt — zusätzliche Sperren möglich.",
      "5-km-Sperrzone um Flugplätze (auch Sport-/Segelflug). Heliports zusätzlich beachten.",
      "Über AKWs und militärischen Anlagen absolutes Flugverbot.",
    ],
    checklist: [
      "Versicherung mit 1 Mio. CHF Deckung + CH-Geltungsbereich",
      "e-ID auf Drohne sichtbar",
      "Drohnenkarte map.geo.admin.ch vor Start",
      "Wildruhezonen (Dez-Apr) beachten",
    ],
  },
  {
    iso: "FR",
    name: "Frankreich",
    summary:
      "EU-Recht gilt — DGAC ergänzt nationale Regeln: AlphaTango-Registrierung zusätzlich nötig, ab 800 g elektronische Balise (Remote-ID) Pflicht.",
    minAge: "14 Jahre für A1/A3.",
    insurance: "Empfohlen; bei gewerblicher Nutzung Pflicht. Deutsche Haftpflicht im EU-Ausland meist gültig — vorher prüfen.",
    nightFlight: "In Open verboten ohne Sonderfreigabe (Préfecture).",
    maxAltitudeM: "120 m AGL (Open).",
    registration:
      "Zusätzlich zur EU-e-ID Pflicht-Registrierung im AlphaTango-Portal (DGAC). Erforderlich ab 800 g oder mit Kamera.",
    authority: { name: "Direction Générale de l'Aviation Civile (DGAC)", url: "https://alphatango.aviation-civile.gouv.fr" },
    noFlyApp: { name: "Géoportail Drones", url: "https://www.geoportail.gouv.fr/donnees/restrictions-pour-drones-de-loisir" },
    specialNotes: [
      "Balise électronique (Remote-ID) Pflicht ab 800 g — entspricht EU-Remote-ID, muss aktiv sein.",
      "Nationalparks (Mercantour, Écrins, Vanoise…) und Naturreservate komplett gesperrt.",
      "Paris + ganz Île-de-France: weitläufige Sperrzonen.",
      "Strände und Küsten in der Hochsaison oft per Préfectoral-Dekret gesperrt.",
    ],
    checklist: [
      "AlphaTango-Registrierung absolviert",
      "Remote-ID/Balise aktiv (>800 g)",
      "EU-Kompetenznachweis A1/A3 dabei",
      "Géoportail vor Start geprüft",
    ],
  },
  {
    iso: "IT",
    name: "Italien",
    summary:
      "EU-Recht gilt — ENAC ist zuständig. Zusätzliche Pflicht: D-Flight-Registrierung mit QR-Code-Aufkleber an der Drohne.",
    minAge: "16 Jahre für A1/A3.",
    insurance: "Pflicht für alle Drohnen unabhängig vom Gewicht — auch privat. Deckung muss D-Flight-konform sein.",
    nightFlight: "In Open erlaubt mit grünem Blinklicht (EU-Standard).",
    maxAltitudeM: "120 m AGL.",
    registration:
      "D-Flight-Portal (ENAC) — generiert einen QR-Code-Aufkleber, der gut sichtbar auf der Drohne kleben muss. EU-e-ID allein reicht in IT nicht.",
    authority: { name: "Ente Nazionale per l'Aviazione Civile (ENAC)", url: "https://www.d-flight.it" },
    noFlyApp: { name: "D-Flight Geoportal", url: "https://www.d-flight.it/new_portal/geoportal/" },
    specialNotes: [
      "QR-Code-Aufkleber ist obligatorisch — ohne droht Bußgeld.",
      "Über kulturellem Erbe (UNESCO, Centro Storico Rom/Venedig/Florenz) Flugverbot bzw. Genehmigung des Soprintendenza nötig.",
      "Vesuv, Ätna, Stromboli: Sondergenehmigung.",
      "Strände in der Hauptsaison oft gesperrt (Comune-Verordnungen).",
    ],
    checklist: [
      "D-Flight-Registrierung + QR-Aufkleber",
      "Haftpflicht IT-konform",
      "EU-Kompetenznachweis dabei",
      "Geoportal vor Start geprüft",
    ],
  },
  {
    iso: "ES",
    name: "Spanien",
    summary:
      "EU-Recht gilt — AESA ist zuständig. Open-Kategorie ohne extra Registrierung (EU-e-ID reicht); Specific erfordert AESA-Declaración.",
    minAge: "16 Jahre für A1/A3.",
    insurance: "Pflicht für alle Drohnen, auch <250 g, sobald Kamera oder gewerbliche Nutzung. Mindestdeckung gem. EU 785/2004.",
    nightFlight: "In Open erlaubt mit grünem Blinklicht (EU-Standard).",
    maxAltitudeM: "120 m AGL.",
    registration: "EU-e-ID anerkannt. Bei Wohnsitz ES Registrierung im AESA-Portal.",
    authority: { name: "Agencia Estatal de Seguridad Aérea (AESA)", url: "https://www.seguridadaerea.gob.es" },
    noFlyApp: { name: "ENAIRE Drones", url: "https://drones.enaire.es" },
    specialNotes: [
      "Nationalparks (Teide, Picos de Europa, Doñana…) komplett gesperrt.",
      "Über Stränden in der Sommersaison oft Lokalverbote — Ayuntamiento prüfen.",
      "Madrid + Barcelona haben großräumige CTRs.",
      "Kanaren: zusätzliche Vorgaben durch Vulkan- und Vogelschutz.",
    ],
    checklist: [
      "Haftpflicht ES-gültig",
      "ENAIRE Drones-App geprüft",
      "EU-e-ID auf Drohne",
      "A1/A3-Nachweis bei sich",
    ],
  },
  {
    iso: "LU",
    name: "Luxemburg",
    summary:
      "EU-Recht gilt — DAC (Direction de l'Aviation Civile) ist zuständig. Seit 20.12.2024 verbindliche Geozonen-Karte g-o.lu/uas.",
    minAge: "16 Jahre für A1/A3.",
    insurance: "Pflicht seit 2024 für alle Drohnen unabhängig vom Gewicht.",
    nightFlight: "In Open erlaubt mit grünem Blinklicht (EU-Standard).",
    maxAltitudeM: "120 m AGL.",
    registration: "MyGuichet.lu-Portal. EU-e-ID anerkannt.",
    authority: { name: "Direction de l'Aviation Civile (DAC)", url: "https://aviation.public.lu", email: "uas@av.etat.lu" },
    noFlyApp: { name: "g-o.lu/uas (offizielle Geo-Awareness-Karte)", url: "https://g-o.lu/uas" },
    specialNotes: [
      "Nur g-o.lu/uas ist rechtsverbindlich — Hersteller-Geofence (z. B. DJI) reicht nicht!",
      "Findel, Palais Grand-Ducal, Berg, Fischbach, Uerschterhaff: Sperrzonen.",
      "5 km Pufferzone um Flughäfen, 2 km um Heliports.",
      "Live-JSON-Feed (ED-269) wird alle 5 Min. aktualisiert — App nutzt diesen direkt.",
    ],
    checklist: [
      "Versicherung gültig (Pflicht seit 2024)",
      "g-o.lu/uas direkt vor Start geprüft",
      "EU-e-ID dabei",
      "DAC-Kontakt für Sonderfälle: uas@av.etat.lu",
    ],
  },
  {
    iso: "UK",
    name: "Vereinigtes Königreich",
    summary:
      "Achtung: Nicht mehr in der EU! Eigenes CAA-Regelwerk (CAP 722, ähnlich EU, aber separat). Deutsche EU-e-ID und EU-Kompetenznachweise sind NICHT gültig.",
    minAge: "Kein Mindestalter für Flyer-ID (Pilot). Operator-ID erfordert Volljährigkeit (18 J.).",
    insurance: "Privat empfohlen; bei gewerblicher Nutzung Pflicht (EC 785/2004 sinngemäß übernommen).",
    nightFlight: "In Open erlaubt — keine Blinklicht-Pflicht wie in EU.",
    maxAltitudeM: "120 m AGL (400 ft).",
    registration:
      "Pflicht ab 250 g oder mit Kamera. Operator-ID (Eigentümer, am Drohnen-Body sichtbar) + Flyer-ID (Pilot, nach Online-Test).",
    authority: { name: "Civil Aviation Authority (CAA)", url: "https://register-drones.caa.co.uk" },
    noFlyApp: { name: "Drone Assist (NATS)", url: "https://dronesafe.uk/drone-assist/" },
    specialNotes: [
      "EU-Dokumente NICHT anerkannt — vor UK-Reise CAA-Registrierung + Online-Test (£12,06/Jahr).",
      "Royal Parks, Schlösser und sämtliche Flugplatz-FRZ (Flight Restriction Zone): Sperre 2 NM × 5 km.",
      "London hat besonders viele Restricted Areas.",
      "Drohnen über 250 g brauchen zusätzlich Class-Marking (UK1-UK5, eigenes System).",
    ],
    checklist: [
      "CAA Operator-ID auf Drohne",
      "CAA Flyer-ID-Pass dabei",
      "Drone Assist-App installiert",
      "Versicherung UK-gültig (bei Bedarf)",
    ],
  },
];

export function getCountryInfo(iso: string): CountryInfo | undefined {
  return COUNTRY_INFO.find((c) => c.iso === iso.toUpperCase());
}

export type NightFlightStatus = "forbidden" | "permit_required" | "allowed_with_lights" | "allowed";

export interface NightFlightRule {
  status: NightFlightStatus;
  severity: "danger" | "warn" | "info";
  shortText: string;
  detail: string;
}

const NIGHT_FLIGHT_RULES: Record<string, NightFlightRule> = {
  DE: { status: "allowed_with_lights", severity: "warn", shortText: "Nachtflug — grünes Blinklicht Pflicht", detail: "Open-Kategorie: erlaubt mit grün blinkenden Positionslichtern." },
  NL: { status: "forbidden", severity: "danger", shortText: "Nachtflug in NL verboten", detail: "Open-Kategorie: Nachtflug streng verboten. Nur während gesetzlicher Tageszeit." },
  AT: { status: "allowed_with_lights", severity: "warn", shortText: "Nachtflug — grünes Blinklicht Pflicht", detail: "Open-Kategorie: erlaubt mit grün blinkenden Positionslichtern (EU-Standard)." },
  CH: { status: "allowed_with_lights", severity: "warn", shortText: "Nachtflug — grünes Blinklicht Pflicht", detail: "Open-Kategorie: erlaubt mit grün blinkenden Positionslichtern (EU-Standard)." },
  FR: { status: "permit_required", severity: "danger", shortText: "Nachtflug in FR verboten ohne Préfecture-Freigabe", detail: "Open: Nachtflug nur mit Sonderfreigabe der Préfecture." },
  IT: { status: "allowed_with_lights", severity: "warn", shortText: "Nachtflug — grünes Blinklicht Pflicht", detail: "Open-Kategorie: erlaubt mit grün blinkenden Positionslichtern (EU-Standard)." },
  ES: { status: "allowed_with_lights", severity: "warn", shortText: "Nachtflug — grünes Blinklicht Pflicht", detail: "Open-Kategorie: erlaubt mit grün blinkenden Positionslichtern (EU-Standard)." },
  LU: { status: "allowed_with_lights", severity: "warn", shortText: "Nachtflug — grünes Blinklicht Pflicht", detail: "Open-Kategorie: erlaubt mit grün blinkenden Positionslichtern (EU-Standard)." },
  UK: { status: "allowed", severity: "info", shortText: "Nachtflug — Beleuchtung empfohlen", detail: "Open: keine EU-Blinklicht-Pflicht, Beleuchtung dennoch dringend empfohlen." },
};

const NIGHT_FLIGHT_DEFAULT: NightFlightRule = {
  status: "allowed_with_lights",
  severity: "warn",
  shortText: "Nachtflug — Beleuchtung erforderlich",
  detail: "Vor dem Start die nationalen Regeln für Nachtflug prüfen.",
};

export function getNightFlightRule(iso?: string | null): NightFlightRule {
  if (!iso) return NIGHT_FLIGHT_DEFAULT;
  const key = iso.toUpperCase() === "GB" ? "UK" : iso.toUpperCase();
  return NIGHT_FLIGHT_RULES[key] ?? NIGHT_FLIGHT_DEFAULT;
}
