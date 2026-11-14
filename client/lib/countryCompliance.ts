import type { DroneProfile, PilotProfile } from "@/lib/storage";

export type ComplianceLevel = "ok" | "warning" | "error";

export interface ComplianceItem {
  id: string;
  category: "pilot" | "drone" | "country";
  level: ComplianceLevel;
  title: string;
  description: string;
  actionUrl?: string;
  actionLabel?: string;
  pilotField?: string;
  /** Wenn true, soll die actionUrl in einem In-App-WebView statt im externen
   *  Browser geöffnet werden. Wird vom Planungs-Flow ausgewertet. */
  openInApp?: boolean;
  /** Verweis auf eine hinterlegte In-App-Anleitung. Der Planungs-Flow zeigt
   *  dann einen zusätzlichen Button, der den Anleitungs-Screen öffnet. */
  guide?: "dflight-it";
}

export interface ComplianceResult {
  country: string;
  countryLabel: string;
  overallStatus: ComplianceLevel;
  items: ComplianceItem[];
}

interface CountryRuleSet {
  iso: string;
  label: string;
  mapUrl?: string;
  mapLabel?: string;
  rules: ((drone: DroneProfile, pilot: PilotProfile) => ComplianceItem | null)[];
  fixedHints: ComplianceItem[];
}

/**
 * R52123 (DGAC / service-public.gouv.fr): Eine Drohne muss in Frankreich auf
 * AlphaTango registriert werden, wenn sie >= 800 g wiegt ODER mit einem
 * elektronischen Signalgerät (Remote-ID / Balise) ausgestattet ist. Das gilt
 * sowohl für integrierte Remote-ID (hasRemoteId) als auch für ein extern
 * konfiguriertes Modul (compliance.remoteIdConfigured).
 */
export function needsAlphaTangoRegistration(drone: DroneProfile): boolean {
  return drone.mtomGrams >= 800 || drone.hasRemoteId || drone.compliance.remoteIdConfigured;
}

export type AlphaTangoFrStatus = "not-required" | "required-open" | "required-done";

/**
 * Status der AlphaTango-Registrierung (FR) für die Drohnenliste:
 * - "not-required": keine Registrierung nötig.
 * - "required-open": Registrierung nötig, aber keine Bestätigung hinterlegt.
 * - "required-done": Registrierung nötig und Bestätigung hinterlegt.
 *
 * Die "done"-Bedingung (hinterlegtes alphaTangoDocument) ist absichtlich
 * identisch mit der fr_alphatango-Regel, damit Liste und Planungs-Flow nie
 * widersprüchlich sind.
 */
export function getAlphaTangoFrStatus(drone: DroneProfile): AlphaTangoFrStatus {
  if (!needsAlphaTangoRegistration(drone)) return "not-required";
  return drone.alphaTangoDocument ? "required-done" : "required-open";
}

const EU_BASE_RULES: ((drone: DroneProfile, pilot: PilotProfile) => ComplianceItem | null)[] = [
  (_drone, pilot) => {
    if (!pilot.operatorId && !pilot.operatorRegistered) {
      return {
        id: "eu_eid",
        category: "pilot",
        level: "error",
        title: "EU Betreiber-ID (e-ID) fehlt",
        description: "Du brauchst eine Registrierung als UAS-Betreiber im Heimatland. Die e-ID muss an der Drohne angebracht sein.",
        pilotField: "operatorId",
      };
    }
    return null;
  },
  (drone, pilot) => {
    if (drone.mtomGrams > 250 && !pilot.licenseA1A3) {
      return {
        id: "eu_a1a3",
        category: "pilot",
        level: "error",
        title: "A1/A3 Kompetenznachweis fehlt",
        description: "Drohnen über 250 g erfordern mindestens den EU-Kompetenznachweis (A1/A3).",
        pilotField: "licenseA1A3",
      };
    }
    return null;
  },
  (drone, pilot) => {
    if (drone.classMark === "C2" && !pilot.licenseA2) {
      return {
        id: "eu_a2",
        category: "pilot",
        level: "warning",
        title: "A2 Fernpilotenzeugnis empfohlen",
        description: "Deine C2-Drohne kann in Kategorie A2 fliegen (nah an Personen), dafür brauchst du den A2-Schein. Ohne A2 gilt Kategorie A3 (150 m Abstand).",
        pilotField: "licenseA2",
      };
    }
    return null;
  },
  (drone, pilot) => {
    if (!pilot.licenseA1A3 && drone.mtomGrams <= 250 && drone.classMark !== "legacy") {
      return null;
    }
    if (drone.classMark === "legacy" && drone.mtomGrams > 250) {
      return {
        id: "eu_legacy_a3",
        category: "drone",
        level: "warning",
        title: "Bestandsdrohne ohne C-Klasse",
        description: `Deine ${drone.name} hat kein EU-Klassenlabel. Du darfst nur in Kategorie A3 fliegen (mindestens 150 m Abstand zu Wohn- und Gewerbegebieten).`,
      };
    }
    return null;
  },
  (drone) => {
    if (!drone.hasRemoteId && !drone.compliance.remoteIdConfigured) {
      return {
        id: "eu_remote_id",
        category: "drone",
        level: "warning",
        title: "Keine EU Remote-ID",
        description: "Deine Drohne hat keine integrierte EU Remote-ID. In vielen Ländern ist dies Pflicht. Ein externes Modul (z. B. Dronetag) kann nachgerüstet werden.",
      };
    }
    return null;
  },
  (_drone, pilot) => {
    if (!pilot.insuranceActive) {
      return {
        id: "eu_insurance",
        category: "pilot",
        level: "error",
        title: "Drohnen-Haftpflichtversicherung fehlt",
        description: "Eine Haftpflichtversicherung ist in der EU Pflicht für alle Drohnenflüge.",
      };
    }
    return null;
  },
];

const COUNTRY_RULES: CountryRuleSet[] = [
  {
    iso: "DE",
    label: "Deutschland",
    mapUrl: "https://uas-betrieb.de",
    mapLabel: "dipul Karte",
    rules: [],
    fixedHints: [
      {
        id: "de_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Deutschland ist eine Registrierung als UAS-Betreiber beim Luftfahrt-Bundesamt (LBA) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Die LBA-Registrierung gilt EU-weit — keine Doppel-Registrierung im Ausland nötig.",
      },
      {
        id: "de_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "de_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrt-Bundesamt (LBA)",
        description: "Drohnen-Infos und Betreiber-Registrierung des Luftfahrt-Bundesamtes.",
        actionUrl: "https://www.lba.de/DE/Drohnen/Drohnen_node.html",
        actionLabel: "LBA öffnen",
      },
      {
        id: "de_hint_night",
        category: "country",
        level: "ok",
        title: "Nachtflug möglich",
        description: "In Deutschland ist Nachtflug für Hobbypiloten erlaubt, sofern die Drohne Positionslichter hat und Sichtbedingungen eingehalten werden.",
      },
    ],
  },
  {
    iso: "FR",
    label: "Frankreich",
    mapUrl: "https://www.geoportail.gouv.fr/donnees/restrictions-uas-categorie-ouverte-et-aeromodelisme",
    mapLabel: "Geoportail Drones",
    rules: [
      (drone) => {
        if (needsAlphaTangoRegistration(drone) && !drone.alphaTangoDocument) {
          const reason =
            drone.mtomGrams >= 800
              ? `Deine Drohne wiegt ${drone.mtomGrams} g (>= 800 g).`
              : "Deine Drohne ist mit einem elektronischen Signalgerät (Remote-ID) ausgestattet.";
          return {
            id: "fr_alphatango",
            category: "drone",
            level: "error",
            title: "AlphaTango-Registrierung fehlt",
            description: `${reason} In Frankreich ist eine Registrierung der Drohne auf AlphaTango zwingend erforderlich (Pflicht ab 800 g oder mit elektronischem Signalgerät). Die FRA-Nummer muss an der Drohne angebracht und die Bestätigung pro Drohne hinterlegt werden.`,
            actionUrl: "https://alphatango.aviation-civile.gouv.fr",
            actionLabel: "AlphaTango öffnen",
          };
        }
        return null;
      },
      (drone) => {
        if (drone.mtomGrams >= 800 && !drone.hasRemoteId && !drone.compliance.remoteIdConfigured) {
          return {
            id: "fr_balise",
            category: "drone",
            level: "error",
            title: "Signalmodul (Balise) erforderlich",
            description: "In Frankreich müssen Drohnen >= 800 g eine elektronische Fernidentifizierung haben. Deine Drohne hat weder eine integrierte Remote-ID noch ein konfiguriertes Modul. Ein externes französisches Signalmodul (Balise) ist Pflicht.",
            actionUrl: "https://enterprise-insights.dji.com/blog/how-to-make-your-dji-drone-compliant-with-french-remote-id",
            actionLabel: "DJI: Remote-ID einrichten (Anleitung)",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "fr_hint_no_reregister",
        category: "pilot",
        level: "ok",
        title: "Keine Doppel-Registrierung in AlphaTango",
        description:
          "Mit einer deutschen LBA-e-ID musst du dich NICHT erneut in AlphaTango als Betreiber registrieren. Es genügt, das deutsche Registrierungs-Zertifikat bei Flügen in Frankreich mitzuführen. Eine AlphaTango-Eintragung ist nur nötig, wenn du einen STS-01/STS-02-Flug mit Flugmeldung in Frankreich planst (Quelle: DGAC AlphaTango, 01.07.2024).",
      },
      {
        id: "fr_hint_map",
        category: "country",
        level: "ok",
        title: "Geoportail Drones (offizielle Karte)",
        description: "Offizielle UAS-Restriktionskarte für Frankreich (Kategorie Open + Aeromodellisme).",
        actionUrl: "https://www.geoportail.gouv.fr/donnees/restrictions-uas-categorie-ouverte-et-aeromodelisme",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "fr_hint_night",
        category: "country",
        level: "warning",
        title: "Absolutes Nachtflugverbot",
        description: "Nachtflug für Freizeitpiloten ist in Frankreich generell verboten.",
      },
      {
        id: "fr_hint_cities",
        category: "country",
        level: "warning",
        title: "Überflugverbot in Städten",
        description: "Das Überfliegen von Städten, Straßen und Menschenansammlungen ist in Frankreich streng verboten.",
      },
      {
        id: "fr_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Frankreich ist eine Registrierung als UAS-Betreiber Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Eine deutsche LBA-e-ID wird anerkannt — keine erneute Betreiber-Registrierung in AlphaTango nötig (nur die Drohne selbst muss in AlphaTango eingetragen werden, siehe oben).",
      },
      {
        id: "fr_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "fr_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Frankreich (DGAC)",
        description: "Offizielle Drohnen-Infos der Direction générale de l'Aviation civile.",
        actionUrl: "https://www.ecologie.gouv.fr/politiques-publiques/exploitation-drones-categorie-ouverte",
        actionLabel: "DGAC öffnen",
      },
    ],
  },
  {
    iso: "IT",
    label: "Italien",
    mapUrl: "https://www.d-flight.it/new_portal",
    mapLabel: "D-Flight Portal",
    rules: [
      (drone) => {
        if (!drone.dflightDocument) {
          return {
            id: "it_dflight",
            category: "drone",
            level: "error",
            title: "D-Flight QR-Code fehlt",
            description: "In Italien ist ein kostenpflichtiger QR-Code von D-Flight erforderlich (ca. 6 EUR), der sichtbar an der Drohne angebracht und pro Drohne hier hinterlegt werden muss.",
            actionUrl: "https://www.d-flight.it/new_portal",
            actionLabel: "D-Flight öffnen",
            guide: "dflight-it",
          };
        }
        return null;
      },
      (drone) => {
        if (drone.classMark === "legacy") {
          return {
            id: "it_legacy",
            category: "drone",
            level: "warning",
            title: "Bestandsdrohne in Italien",
            description: "Ohne EU-Klassenlabel gelten strikte Abstande zu Personen (Kategorie A3).",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "it_hint_beach",
        category: "country",
        level: "warning",
        title: "Strandflug eingeschränkt",
        description: "Fliegen über Stränden im Sommer (Juni-September) ist in Italien streng reglementiert.",
      },
      {
        id: "it_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Italien ist eine Registrierung als UAS-Betreiber bei der ENAC (über das D-Flight-Portal) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
        guide: "dflight-it",
      },
      {
        id: "it_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "it_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Italien (ENAC)",
        description: "Offizielle Drohnen-Infos der Ente Nazionale per l'Aviazione Civile.",
        actionUrl: "https://www.enac.gov.it/sicurezza-aerea/droni",
        actionLabel: "ENAC öffnen",
      },
    ],
  },
  {
    iso: "CH",
    label: "Schweiz",
    mapUrl: "https://map.geo.admin.ch/?topic=aviation&lang=de",
    mapLabel: "Skyguide Karte",
    rules: [
      (drone, pilot) => {
        if (drone.mtomGrams > 250 && !pilot.countrySpecific.insuranceCH1Mio) {
          return {
            id: "ch_insurance",
            category: "pilot",
            level: "error",
            title: "CH-Versicherung unzureichend",
            description: "Die Schweiz verlangt für Drohnen über 250 g eine Haftpflichtversicherung mit mindestens 1 Mio. CHF Deckungssumme. Bitte prüfe deine Deckung.",
            pilotField: "countrySpecific.insuranceCH1Mio",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "ch_hint_map",
        category: "country",
        level: "ok",
        title: "Skyguide / geo.admin Karte",
        description: "Offizielle BAZL-Karte mit Luftraumstruktur und Drohnen-Beschränkungen.",
        actionUrl: "https://map.geo.admin.ch/?topic=aviation&lang=de",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "ch_hint_registration",
        category: "country",
        level: "warning",
        title: "UAS.gate Registrierung",
        description: "Eine Registrierung im UAS.gate (BAZL) ist in der Schweiz zwingend erforderlich.",
        actionUrl: "https://uas.gate.easa.europa.eu",
        actionLabel: "UAS.gate öffnen",
        openInApp: true,
      },
      {
        id: "ch_hint_distance",
        category: "country",
        level: "ok",
        title: "Flugplatz-Abstand 5 km",
        description: "Abstand zu Flugplätzen ohne Bewilligung: 5 km. Karten-Check auf Skyguide empfohlen.",
      },
      {
        id: "ch_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "ch_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Schweiz (BAZL)",
        description: "Offizielle Drohnen-Infos des Bundesamts für Zivilluftfahrt.",
        actionUrl: "https://www.bazl.admin.ch/de/drohnen",
        actionLabel: "BAZL öffnen",
      },
    ],
  },
  {
    iso: "AT",
    label: "Österreich",
    mapUrl: "https://www.dronespace.at",
    mapLabel: "Dronespace.at",
    rules: [
      (_drone, pilot) => {
        if (!pilot.countrySpecific.insuranceATSzr) {
          return {
            id: "at_szr",
            category: "pilot",
            level: "error",
            title: "SZR-Versicherungsnachweis fehlt",
            description: "In Österreich ist ein Versicherungsnachweis über 750.000 SZR (Sonderziehungsrechte) erforderlich.",
            actionUrl: "https://www.dronespace.at",
            actionLabel: "Dronespace öffnen",
            pilotField: "countrySpecific.insuranceATSzr",
          };
        }
        return null;
      },
      (drone) => {
        if (drone.classMark === "legacy") {
          return {
            id: "at_legacy",
            category: "drone",
            level: "warning",
            title: "Bestandsdrohne in Österreich",
            description: "Kein C-Label vorhanden: Du darfst nur in Kategorie A3 fliegen (150 m Abstand zu Wohn- und Gewerbegebieten).",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "at_hint_control",
        category: "country",
        level: "warning",
        title: "Strenge Kontrollen",
        description: "In Österreich wird der A1/A3 Kompetenznachweis bei Drohnen über 250 g streng kontrolliert.",
      },
      {
        id: "at_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Österreich ist eine Registrierung als UAS-Betreiber bei Austro Control (über dronespace.at) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "at_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "at_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Österreich (Austro Control)",
        description: "Offizielle Drohnen-Infos und Registrierung von Austro Control.",
        actionUrl: "https://www.austrocontrol.at/drohnen",
        actionLabel: "Austro Control öffnen",
      },
    ],
  },
  {
    iso: "ES",
    label: "Spanien",
    mapUrl: "https://drones.enaire.es",
    mapLabel: "ENAIRE Drones",
    rules: [
      (drone) => {
        if (drone.mtomGrams > 250) {
          return {
            id: "es_declaration",
            category: "country",
            level: "warning",
            title: "Flugerklärung ggf. erforderlich",
            description: "Prüfe auf ENAIRE Drones, ob für deine geplante Flugzone eine vorherige Flugerklärung (Declaración responsable) bei der AESA nötig ist.",
            actionUrl: "https://drones.enaire.es",
            actionLabel: "ENAIRE öffnen",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "es_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Spanien ist eine Registrierung als UAS-Betreiber bei der AESA Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "es_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "es_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Spanien (AESA)",
        description: "Offizielle Drohnen-Infos der Agencia Estatal de Seguridad Aérea.",
        actionUrl: "https://www.seguridadaerea.gob.es/es/ambitos/drones-uas",
        actionLabel: "AESA öffnen",
      },
    ],
  },
  {
    iso: "LU",
    label: "Luxemburg",
    mapUrl: "https://g-o.lu/uas",
    mapLabel: "Offizielle UAS-Zonenkarte",
    rules: [
      (_drone, pilot) => {
        if (pilot.insuranceActive) return null;
        return {
          id: "lu_insurance",
          category: "pilot" as const,
          level: "warning" as const,
          title: "Versicherungspflicht",
          description: "Seit Loi du 20 décembre 2024 ist eine Haftpflichtversicherung für alle UAS-Betreiber in Luxemburg obligatorisch. Strafe: Bis zu 1 Jahr Haft und 5.000 € Geldstrafe.",
          actionUrl: "https://dac.gouvernement.lu/en/drones.html",
          actionLabel: "DAC Infos",
          pilotField: "insuranceActive",
        };
      },
      (_drone, _pilot) => ({
        id: "lu_geo_awareness",
        category: "drone" as const,
        level: "ok" as const,
        title: "Geo-Awareness aktualisieren (optional)",
        description: "JSON-Zonendatei von drones.geoportail.lu/zones kann ins UAS geladen werden. Empfohlen für C1/C2/C3-Drohnen — Hersteller-Geozonen decken nicht alle LU-Beschränkungen ab.",
        actionUrl: "https://drones.geoportail.lu/zones",
        actionLabel: "JSON-Feed",
      }),
    ],
    fixedHints: [
      {
        id: "lu_hint_dac",
        category: "country",
        level: "ok",
        title: "DAC Luxemburg — Drohnenportal",
        description: "Offizielle Informationen zu Drohnenregelungen, Geozonen und Genehmigungen der Direction de l'Aviation Civile.",
        actionUrl: "https://dac.gouvernement.lu/en/drones/geozones.html",
        actionLabel: "DAC Geozonen",
      },
      {
        id: "lu_hint_map",
        category: "country",
        level: "ok",
        title: "UAS-Zonenkarte (g-o.lu/uas)",
        description: "Einzige rechtlich verbindliche Zonenkarte für Luxemburg. Wird alle 5 Minuten aktualisiert. Rot = aktiv/verboten, Gelb = demnächst aktiv, Grau = inaktiv.",
        actionUrl: "https://g-o.lu/uas",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "lu_hint_guide",
        category: "country",
        level: "ok",
        title: "Benutzerhandbuch Géoportail (DE)",
        description: "Schnellanleitung zur Nutzung der offiziellen UAS-Zonenkarte (Version 1.1, Dez. 2024).",
        actionUrl: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-de.pdf",
        actionLabel: "PDF öffnen",
      },
      {
        id: "lu_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Luxemburg ist eine Registrierung als UAS-Betreiber bei der DAC Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "lu_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "lu_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Luxemburg (DAC)",
        description: "Offizielle Drohnen-Infos der Direction de l'Aviation Civile.",
        actionUrl: "https://dac.gouvernement.lu/en/drones.html",
        actionLabel: "DAC öffnen",
      },
    ],
  },
  {
    iso: "NL",
    label: "Niederlande",
    mapUrl: "https://map.godrone.nl",
    mapLabel: "GoDrone",
    rules: [],
    fixedHints: [
      {
        id: "nl_hint_godrone",
        category: "country",
        level: "ok",
        title: "GoDrone Karte prüfen",
        description: "Vor dem Flug die GoDrone-App oder -Karte der Niederlande prüfen.",
        actionUrl: "https://map.godrone.nl",
        actionLabel: "GoDrone öffnen",
      },
      {
        id: "nl_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In den Niederlanden ist eine Registrierung als UAS-Betreiber beim RDW Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "nl_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "nl_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Niederlande (ILT)",
        description: "Offizielle Drohnen-Infos der Inspectie Leefomgeving en Transport.",
        actionUrl: "https://www.ilent.nl/onderwerpen/luchtvaart/drones-en-modelvliegtuigen",
        actionLabel: "ILT öffnen",
      },
    ],
  },
  {
    iso: "BE",
    label: "Belgien",
    mapUrl: "https://map.droneguide.be/",
    mapLabel: "DroneGuide Karte",
    rules: [],
    fixedHints: [
      {
        id: "be_hint_map",
        category: "country",
        level: "ok",
        title: "DroneGuide UAS-Zonenkarte",
        description: "Offizielle Karte der geografischen UAS-Zonen für Belgien. Vor dem Flug prüfen.",
        actionUrl: "https://map.droneguide.be/",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "be_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Belgien ist eine Registrierung als UAS-Betreiber bei der Luftfahrtbehörde DGLV Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "be_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "be_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Belgien (DGLV)",
        description: "Drohnen-Infos und Registrierung beim FOD Mobiliteit (DGLV). Kontakt: bcaa.registration@mobilit.fgov.be.",
        actionUrl: "https://mobilit.belgium.be/nl/luchtvaart/vliegen-met/drones-uas",
        actionLabel: "DGLV öffnen",
      },
      {
        id: "be_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherungspflicht",
        description: "In Belgien ist eine Haftpflichtversicherung für private und gewerbliche Flüge vorgeschrieben. Mindestalter Fernpilot: 14 Jahre.",
      },
    ],
  },
  {
    iso: "BG",
    label: "Bulgarien",
    mapUrl: "https://www.caa.bg/en/node/7062",
    mapLabel: "CAA Verbotszonen",
    rules: [],
    fixedHints: [
      {
        id: "bg_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Bulgarien (CAA)",
        description: "Karten mit Verbotszonen und Drohnen-Regeln der bulgarischen CAA. Registrierung über das Online-Portal x-tesla.caa.bg. Kontakt: caa@caa.bg, Tel. +359 2 937 1047.",
        actionUrl: "https://www.caa.bg/en/node/7062",
        actionLabel: "CAA öffnen",
        openInApp: true,
      },
      {
        id: "bg_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Bulgarien ist eine Registrierung als UAS-Betreiber bei der bulgarischen CAA (Portal x-tesla.caa.bg) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "bg_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "bg_hint_portal",
        category: "pilot",
        level: "ok",
        title: "Registrierungs-Portal (x-tesla)",
        description: "Online-Portal der CAA für Betreiber-Registrierung und Anträge.",
        actionUrl: "https://x-tesla.caa.bg/home",
        actionLabel: "Portal öffnen",
      },
      {
        id: "bg_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Keine gesetzliche Versicherungspflicht",
        description: "In Bulgarien ist eine Drohnen-Versicherung nicht vorgeschrieben, wird aber dringend empfohlen. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "HR",
    label: "Kroatien",
    mapUrl: "https://amc.crocontrol.hr/Current-situation-anonymous-users",
    mapLabel: "Crocontrol Luftraum",
    rules: [],
    fixedHints: [
      {
        id: "hr_hint_map",
        category: "country",
        level: "ok",
        title: "Luftraum-Karte (Crocontrol)",
        description: "Aktuelle Luftraumsituation und UAS-Zonen für Kroatien.",
        actionUrl: "https://amc.crocontrol.hr/Current-situation-anonymous-users",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "hr_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Kroatien ist eine Registrierung als UAS-Betreiber bei der CCAA Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "hr_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "hr_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Kroatien (CCAA)",
        description: "Regeln für den Betrieb unbemannter Luftfahrzeuge der CCAA. Kontakt: ccaa@ccaa.hr, Tel. +385 1 2369 300.",
        actionUrl: "https://www.ccaa.hr/letacke-operacije-sustavima-bespilotnih-zrakoplova-18055",
        actionLabel: "CCAA öffnen",
      },
      {
        id: "hr_hint_aerial",
        category: "country",
        level: "warning",
        title: "Genehmigung für Luftaufnahmen",
        description: "Für Foto-/Videoaufnahmen aus der Luft ist zusätzlich eine Genehmigung der State Geodetic Administration (SGA, info@dgu.hr) nötig. Versicherung ist Pflicht (privat und gewerblich).",
      },
    ],
  },
  {
    iso: "CY",
    label: "Zypern",
    mapUrl: "https://drones.gov.cy/",
    mapLabel: "drones.gov.cy",
    rules: [],
    fixedHints: [
      {
        id: "cy_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Zypern (DCA)",
        description: "Offizielle Drohnen-Infos des Department of Civil Aviation. Registrierung über uas.drones.gov.cy. Kontakt: uav@dca.mcw.gov.cy, Tel. +357 22404121.",
        actionUrl: "https://drones.gov.cy/",
        actionLabel: "drones.gov.cy öffnen",
        openInApp: true,
      },
      {
        id: "cy_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Zypern ist eine Registrierung als UAS-Betreiber beim Department of Civil Aviation (DCA, über uas.drones.gov.cy) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "cy_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "cy_hint_map",
        category: "country",
        level: "ok",
        title: "Karte mit Verbotszonen",
        description: "Übersichtskarte der Flugverbotszonen auf Zypern.",
        actionUrl: "https://www.google.com/maps/d/viewer?mid=1ad8tWU60h-QEz0ZSerTdxdItJhF-Ruqe",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "cy_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherung (gewerblich)",
        description: "Für gewerbliche Flüge ist eine Haftpflichtversicherung Pflicht; für private Flüge empfohlen. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "CZ",
    label: "Tschechien",
    mapUrl: "https://dronview.rlp.cz/",
    mapLabel: "DronView Karte",
    rules: [],
    fixedHints: [
      {
        id: "cz_hint_map",
        category: "country",
        level: "ok",
        title: "DronView Karte (No-Fly-Zones)",
        description: "Offizielle Karte mit Flugverbotszonen für Tschechien.",
        actionUrl: "https://dronview.rlp.cz/",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "cz_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Tschechien ist eine Registrierung als UAS-Betreiber bei der tschechischen CAA Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "cz_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "cz_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Tschechien (CAA)",
        description: "Drohnen-Regeln der tschechischen CAA. Info-Kampagne: czechdronerules.cz, App MAIA für Freigaben. Kontakt: podatelna@caa.cz, Tel. +420 225 421 111.",
        actionUrl: "https://www.caa.cz/en/flight-operations/unmanned-aircraft/",
        actionLabel: "CAA öffnen",
      },
      {
        id: "cz_hint_parks",
        category: "country",
        level: "warning",
        title: "Nationalparks gesperrt",
        description: "Über Nationalparks gelten Flugverbotszonen bis 300 m über Grund. Versicherung ist nicht Pflicht, aber empfohlen. Mindestalter: 16 Jahre.",
      },
    ],
  },
  {
    iso: "DK",
    label: "Dänemark",
    mapUrl: "https://www.droneregler.dk/dronezoner",
    mapLabel: "Dronezoner Karte",
    rules: [],
    fixedHints: [
      {
        id: "dk_hint_map",
        category: "country",
        level: "ok",
        title: "Dronezoner / Luftraumkarte",
        description: "Offizielle dänische Drohnen-Zonenkarte (Trafikstyrelsen).",
        actionUrl: "https://www.droneregler.dk/dronezoner",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "dk_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Dänemark ist eine Registrierung als UAS-Betreiber bei der Trafikstyrelsen über droneregler.dk Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
        actionUrl: "https://www.droneregler.dk",
        actionLabel: "droneregler.dk öffnen",
      },
      {
        id: "dk_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich. Über Personen in dicht besiedelten Gebieten ist der Flug grundsätzlich verboten.",
      },
      {
        id: "dk_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherungspflicht",
        description: "Versicherung ist Pflicht, außer für C0-Drohnen und Drohnen unter 250 g mit unter 19 m/s. Mindestalter Fernpilot: 15 Jahre.",
      },
      {
        id: "dk_hint_distances",
        category: "country",
        level: "warning",
        title: "Besondere Mindestabstände",
        description: "150 m zu Königshaus, Schloss Christiansborg, Botschaften, Polizei und Gefängnissen; 15 m zu Bahnanlagen, 5 m zu Freileitungen, 2,5 m zu Wohngebäuden.",
      },
      {
        id: "dk_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Dänemark (Trafikstyrelsen)",
        description: "Zuständige Behörde für Drohnenregeln, Registrierung und Genehmigungen ist die Trafikstyrelsen (Danish Civil Aviation and Railway Authority). Kontakt: info@trafikstyrelsen.dk, Tel. +45 7221 8800.",
        actionUrl: "https://www.trafikstyrelsen.dk/da/luftfart/Droner",
        actionLabel: "Trafikstyrelsen öffnen",
      },
    ],
  },
  {
    iso: "EE",
    label: "Estland",
    mapUrl: "https://utm.eans.ee/avm/",
    mapLabel: "EANS Drohnenkarte",
    rules: [],
    fixedHints: [
      {
        id: "ee_hint_map",
        category: "country",
        level: "ok",
        title: "Karte mit Flugverbotszonen",
        description: "Estnische UAS-Karte (EANS) mit Flugverbotszonen.",
        actionUrl: "https://utm.eans.ee/avm/",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "ee_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Estland ist eine Registrierung als UAS-Betreiber bei der Transpordiamet (ECAA) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "ee_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "ee_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Estland (ECAA)",
        description: "Drohnen-Infos der Transpordiamet / ECAA. Kontakt: ecaa@ecaa.ee, Tel. +372 620 1200.",
        actionUrl: "https://www.transpordiamet.ee/droonid",
        actionLabel: "ECAA öffnen",
      },
      {
        id: "ee_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Keine gesetzliche Versicherungspflicht",
        description: "Eine Versicherung ist in Estland nicht vorgeschrieben, wird aber empfohlen. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "FI",
    label: "Finnland",
    mapUrl: "https://www.droneinfo.fi/",
    mapLabel: "Droneinfo.fi",
    rules: [],
    fixedHints: [
      {
        id: "fi_hint_authority",
        category: "country",
        level: "ok",
        title: "Droneinfo (Traficom)",
        description: "Informationsportal der finnischen Luftfahrtbehörde mit Karten der UAS-Zonen. Kontakt: kirjaamo@traficom.fi, Tel. +358 29 534 5000.",
        actionUrl: "https://www.droneinfo.fi/",
        actionLabel: "Droneinfo öffnen",
        openInApp: true,
      },
      {
        id: "fi_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Finnland ist eine Registrierung als UAS-Betreiber bei Traficom (über droneinfo.fi) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "fi_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "fi_hint_defence",
        category: "country",
        level: "warning",
        title: "Militärische Gebiete beachten",
        description: "Für Luftaufnahmen über bestimmten Anlagen gelten Vorgaben des finnischen Verteidigungskommandos. Versicherung empfohlen, nicht Pflicht (<20 kg). Mindestalter: 16 Jahre.",
      },
    ],
  },
  {
    iso: "GR",
    label: "Griechenland",
    mapUrl: "https://dagr.hcaa.gr/#map_page",
    mapLabel: "DAGR Karte",
    rules: [],
    fixedHints: [
      {
        id: "gr_hint_map",
        category: "country",
        level: "ok",
        title: "DAGR Zonenkarte (HCAA)",
        description: "Offizielle griechische UAS-Karte (Drone Aware GR). Vor dem Flug Zonen prüfen.",
        actionUrl: "https://dagr.hcaa.gr/#map_page",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "gr_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Griechenland ist eine Registrierung als UAS-Betreiber bei der HCAA Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "gr_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "gr_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Griechenland (HCAA)",
        description: "Offizielle Drohnen-Infos der Hellenic Civil Aviation Authority.",
        actionUrl: "https://hcaa.gov.gr/",
        actionLabel: "HCAA öffnen",
      },
      {
        id: "gr_hint_request",
        category: "country",
        level: "warning",
        title: "Flugantrag ggf. erforderlich",
        description: "Für bestimmte Zonen ist ein UAS-Flugantrag bei der HCAA nötig (Antragsformular auf ypa.gr). Über DRONE AWARE GR (dagr.hasp.gov.gr) anmelden.",
      },
      {
        id: "gr_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherung",
        description: "Pflicht für private Flüge ab 4 kg und für alle gewerblichen Flüge. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "HU",
    label: "Ungarn",
    mapUrl: "https://app.mydronespace.hu/",
    mapLabel: "MyDroneSpace",
    rules: [],
    fixedHints: [
      {
        id: "hu_hint_map",
        category: "country",
        level: "warning",
        title: "MyDroneSpace App (Pflicht)",
        description: "Geozonen-Anzeige und Flugfreigabe laufen in Ungarn über die App MyDroneSpace. Vor jedem Flug Freigabe einholen.",
        actionUrl: "https://app.mydronespace.hu/",
        actionLabel: "MyDroneSpace öffnen",
        openInApp: true,
      },
      {
        id: "hu_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Ungarn ist eine Registrierung als UAS-Betreiber bei der ungarischen Luftfahrtbehörde Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "hu_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "hu_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Ungarn (HungaroControl)",
        description: "Drohnen-Infos und Flugfreigaben über HungaroControl (Betreiber von MyDroneSpace).",
        actionUrl: "https://www.hungarocontrol.hu/",
        actionLabel: "HungaroControl öffnen",
      },
      {
        id: "hu_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherungspflicht",
        description: "Pflicht für private Drohnen ab 250 g und für alle gewerblichen Flüge (gestaffelte Mindestdeckung nach Gewicht). Mindestalter Fernpilot: 16 Jahre.",
      },
      {
        id: "hu_hint_military",
        category: "country",
        level: "ok",
        title: "Militärische Luftfahrtbehörde",
        description: "Zuständig u. a. die militärische Luftfahrtbehörde (klh@hm.gov.hu). AIP über HungaroControl.",
      },
    ],
  },
  {
    iso: "IE",
    label: "Irland",
    mapUrl: "https://www.iaa.ie/general-aviation/drones/uas-geographic-zones",
    mapLabel: "IAA Geozonen",
    rules: [],
    fixedHints: [
      {
        id: "ie_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Irland (IAA)",
        description: "Regeln, Formulare und UAS-Geozonen der Irish Aviation Authority. Kontakt: drones@iaa.ie, Tel. +353 1 671 8655.",
        actionUrl: "https://www.iaa.ie/general-aviation/drones",
        actionLabel: "IAA öffnen",
        openInApp: true,
      },
      {
        id: "ie_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Irland ist eine Registrierung als UAS-Betreiber bei der Irish Aviation Authority (IAA) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "ie_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "ie_hint_zones",
        category: "country",
        level: "ok",
        title: "UAS-Geozonen",
        description: "Karte und Liste der geografischen UAS-Zonen für Irland.",
        actionUrl: "https://www.iaa.ie/general-aviation/drones/uas-geographic-zones",
        actionLabel: "Geozonen öffnen",
      },
      {
        id: "ie_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherung",
        description: "Pflicht für gewerbliche Flüge und Drohnen über 20 kg; sonst empfohlen. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "LV",
    label: "Lettland",
    mapUrl: "https://www.airspace.lv/drones",
    mapLabel: "Airspace.lv",
    rules: [],
    fixedHints: [
      {
        id: "lv_hint_map",
        category: "country",
        level: "ok",
        title: "Karte der UAS-Gebiete (airspace.lv)",
        description: "Offizielle lettische Karte der geografischen UAS-Gebiete.",
        actionUrl: "https://www.airspace.lv/drones",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "lv_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Lettland ist eine Registrierung als UAS-Betreiber bei der lettischen CAA Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "lv_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "lv_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Lettland (CAA)",
        description: "Offizielle Drohnen-Infos der Civil Aviation Agency of Latvia.",
        actionUrl: "https://www.caa.gov.lv/",
        actionLabel: "CAA öffnen",
      },
      {
        id: "lv_hint_portal",
        category: "pilot",
        level: "ok",
        title: "CAA-Portal (e.caa.gov.lv)",
        description: "Registrierung und Anträge bei der lettischen CAA. Kontakt: caa@caa.gov.lv.",
        actionUrl: "https://e.caa.gov.lv/",
        actionLabel: "Portal öffnen",
      },
      {
        id: "lv_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherungspflicht",
        description: "Pflicht für private und gewerbliche Flüge (C1/C2-A2: Mindestdeckung 50.000 EUR). Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "LT",
    label: "Litauen",
    mapUrl: "https://oran.lt/",
    mapLabel: "oran.lt Karte",
    rules: [],
    fixedHints: [
      {
        id: "lt_hint_map",
        category: "country",
        level: "ok",
        title: "Karte mit Flugverbotszonen (oran.lt)",
        description: "Offizielle litauische Karte der Flugverbots- und UAS-Zonen.",
        actionUrl: "https://oran.lt/",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "lt_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Litauen ist eine Registrierung als UAS-Betreiber bei der Transport-Kompetenzbehörde (TKA) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "lt_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "lt_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Litauen (TKA)",
        description: "Drohnen-Infos der litauischen Transport-Kompetenzbehörde. Kontakt: uas@tka.lt, Tel. +370 700 35045.",
        actionUrl: "https://tka.lt/oro-transportas/kategorija/bepilociai-orlaiviai/",
        actionLabel: "TKA öffnen",
      },
      {
        id: "lt_hint_border",
        category: "country",
        level: "warning",
        title: "Grenzzone gesperrt",
        description: "Entlang der Grenze zu Belarus und Russland gilt ein Drohnen-Flugverbot bis ca. 7,4 km (4 NM) ins Landesinnere. Versicherung ist Pflicht. Mindestalter: 16 Jahre.",
      },
    ],
  },
  {
    iso: "MT",
    label: "Malta",
    mapUrl: "https://www.transport.gov.mt/aviation/drones-4444",
    mapLabel: "Transport Malta",
    rules: [],
    fixedHints: [
      {
        id: "mt_hint_authority",
        category: "country",
        level: "ok",
        title: "Transport Malta (CAD)",
        description: "Offizielle Drohnen-Infos und Registrierung von Transport Malta. Kontakt: civil.aviation@transport.gov.mt, Tel. +356 2555 5606.",
        actionUrl: "https://www.transport.gov.mt/aviation/drones-4444",
        actionLabel: "Transport Malta öffnen",
        openInApp: true,
      },
      {
        id: "mt_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Malta ist eine Registrierung als UAS-Betreiber bei Transport Malta (CAD) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "mt_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "mt_hint_request",
        category: "country",
        level: "warning",
        title: "Fluganfrage (iDronect)",
        description: "Flugfreigaben werden über das Portal tmcad.idronect.com beantragt. Malta ist klein und stark luftraumreguliert.",
        actionUrl: "https://tmcad.idronect.com/",
        actionLabel: "Portal öffnen",
      },
      {
        id: "mt_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherungspflicht",
        description: "Eine Haftpflichtversicherung ist für private und gewerbliche Flüge Pflicht. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "PL",
    label: "Polen",
    mapUrl: "https://dronemap.pansa.pl/",
    mapLabel: "DroneMap PANSA",
    rules: [],
    fixedHints: [
      {
        id: "pl_hint_map",
        category: "country",
        level: "ok",
        title: "DroneMap (PANSA)",
        description: "Offizielle Karte der geografischen UAS-Gebiete in Polen. Check-in oft über DroneRadar-App.",
        actionUrl: "https://dronemap.pansa.pl/",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "pl_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Polen ist eine Registrierung als UAS-Betreiber bei der polnischen ULC Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "pl_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "pl_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftaufsichtsbehörde (ULC)",
        description: "Drohnen-Infos und Registrierung bei der polnischen ULC. Kontakt: drony@ulc.gov.pl, Tel. +48 22 520 72 00.",
        actionUrl: "https://ulc.gov.pl/pl/drony/",
        actionLabel: "ULC öffnen",
      },
      {
        id: "pl_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherung (gewerblich)",
        description: "Für gewerbliche Flüge Pflicht; für private Flüge empfohlen. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "PT",
    label: "Portugal",
    mapUrl: "https://www.anac.pt/vPT/Generico/drones/zona_proibidas_condicionadas/Paginas/Zonasproibidasoucondicionadas.aspx",
    mapLabel: "ANAC UAS-Karte",
    rules: [],
    fixedHints: [
      {
        id: "pt_hint_map",
        category: "country",
        level: "ok",
        title: "ANAC UAS-Karte",
        description: "Offizielle Karte der geografischen UAS-Gebiete in Portugal (ANAC).",
        actionUrl: "https://www.anac.pt/vPT/Generico/drones/zona_proibidas_condicionadas/Paginas/Zonasproibidasoucondicionadas.aspx",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "pt_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Portugal ist eine Registrierung als UAS-Betreiber bei der ANAC Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "pt_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "pt_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Portugal (ANAC)",
        description: "Offizielle Drohnen-Infos der Autoridade Nacional da Aviação Civil.",
        actionUrl: "https://www.anac.pt/vPT/Generico/drones/registo_uas/Paginas/OperadoresdeUAS.aspx",
        actionLabel: "ANAC öffnen",
      },
      {
        id: "pt_hint_aerial",
        category: "country",
        level: "warning",
        title: "Luftaufnahmen-Freigabe (AAN)",
        description: "Foto-/Videoaufnahmen aus der Luft müssen über die Autoridade Aeronáutica Nacional (AAN, imagens.aereas@aan.pt) genehmigt werden.",
      },
      {
        id: "pt_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherung ab 900 g",
        description: "Eine Haftpflichtversicherung ist für alle Drohnen ab 900 g Pflicht. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "RO",
    label: "Rumänien",
    mapUrl: "https://flightplan.romatsa.ro/init/drones",
    mapLabel: "ROMATSA Karte",
    rules: [],
    fixedHints: [
      {
        id: "ro_hint_map",
        category: "country",
        level: "ok",
        title: "Karte mit Verbotszonen (ROMATSA)",
        description: "Offizielle rumänische Karte der Flugverbots- und UAS-Zonen.",
        actionUrl: "https://flightplan.romatsa.ro/init/drones",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "ro_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Rumänien ist eine Registrierung als UAS-Betreiber bei der AACR Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "ro_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "ro_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Rumänien (AACR)",
        description: "Drohnen-Infos der AACR. Kontakt: drone@caa.ro, Tel. +40 21 208 1508.",
        actionUrl: "https://www.caa.ro/ro/pages/drone",
        actionLabel: "AACR öffnen",
      },
      {
        id: "ro_hint_aerial",
        category: "country",
        level: "warning",
        title: "Luftaufnahmen-Genehmigung",
        description: "Für Foto-/Videoaufnahmen aus der Luft ist eine Genehmigung des Verteidigungsministeriums erforderlich. Versicherung Pflicht ab 20 kg. Mindestalter: 16 Jahre.",
      },
    ],
  },
  {
    iso: "SK",
    label: "Slowakei",
    mapUrl: "https://gis.lps.sk/vfrm/index.html",
    mapLabel: "Luftraumkarte LPS",
    rules: [],
    fixedHints: [
      {
        id: "sk_hint_map",
        category: "country",
        level: "ok",
        title: "Interaktive Luftraumkarte (LPS)",
        description: "Offizielle slowakische Luftraum- und UAS-Zonenkarte.",
        actionUrl: "https://gis.lps.sk/vfrm/index.html",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "sk_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In der Slowakei ist eine Registrierung als UAS-Betreiber bei der NSAT (Dopravný úrad) Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "sk_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "sk_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Slowakei (NSAT)",
        description: "Regeln für den Betrieb unbemannter Luftfahrzeuge der NSAT. Kontakt: uav@nsat.sk.",
        actionUrl: "https://letectvo.nsat.sk/en/unmanned-aviation/",
        actionLabel: "NSAT öffnen",
      },
      {
        id: "sk_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Versicherungspflicht",
        description: "Eine Haftpflichtversicherung ist für private und gewerbliche Flüge Pflicht. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "SI",
    label: "Slowenien",
    mapUrl: "https://caa-slovenia.maps.arcgis.com/apps/webappviewer/index.html?id=25ba69037c264c5faa5381174f76f861",
    mapLabel: "CAA Slowenien Karte",
    rules: [],
    fixedHints: [
      {
        id: "si_hint_map",
        category: "country",
        level: "ok",
        title: "UAS-Zonenkarte (CAA Slowenien)",
        description: "Offizielle slowenische Karte der UAS-Zonen.",
        actionUrl: "https://caa-slovenia.maps.arcgis.com/apps/webappviewer/index.html?id=25ba69037c264c5faa5381174f76f861",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "si_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Slowenien ist eine Registrierung als UAS-Betreiber bei der CAA Slowenien Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "si_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "si_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Slowenien (CAA)",
        description: "Offizielle Drohnen-Infos der Civil Aviation Agency of Slovenia.",
        actionUrl: "https://www.caa.si/",
        actionLabel: "CAA öffnen",
      },
      {
        id: "si_hint_buildings",
        category: "country",
        level: "warning",
        title: "Alle Gebäude sind UAS-Gebiete",
        description: "In Slowenien gelten sämtliche Gebäude und Infrastrukturen mit Personen (z. B. Straßen) als geografische UAS-Gebiete. Um Flughäfen gilt ein 5-km-Flugverbot.",
      },
      {
        id: "si_hint_insurance",
        category: "pilot",
        level: "ok",
        title: "Keine gesetzliche Versicherungspflicht",
        description: "Eine Versicherung ist nicht vorgeschrieben, wird aber empfohlen. Mindestalter Fernpilot: 16 Jahre.",
      },
    ],
  },
  {
    iso: "SE",
    label: "Schweden",
    mapUrl: "https://daim.lfv.se/echarts/dronechart/",
    mapLabel: "LFV Dronechart",
    rules: [],
    fixedHints: [
      {
        id: "se_hint_map",
        category: "country",
        level: "ok",
        title: "Dronechart (LFV)",
        description: "Offizielle schwedische Karte mit Drohnen-Verbotszonen.",
        actionUrl: "https://daim.lfv.se/echarts/dronechart/",
        actionLabel: "Karte öffnen",
        openInApp: true,
      },
      {
        id: "se_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description: "In Schweden ist eine Registrierung als UAS-Betreiber bei der Transportstyrelsen Pflicht (Drohnen über 250 g oder mit Kamera/Sensor). Die Betreiber-Nummer (e-ID) muss an der Drohne angebracht werden. Eine EU-Betreiber-ID aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig.",
      },
      {
        id: "se_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description: "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "se_hint_authority",
        category: "country",
        level: "ok",
        title: "Transportstyrelsen",
        description: "Drohnen-Infos und Registrierung der schwedischen Transportbehörde. Kontakt: luftfart@transportstyrelsen.se, Tel. +46 771 503 503.",
        actionUrl: "https://transportstyrelsen.se/dronare",
        actionLabel: "Transportstyrelsen öffnen",
      },
      {
        id: "se_hint_spread",
        category: "country",
        level: "warning",
        title: "Verbreitungsgenehmigung für Luftbilder",
        description: "Das Veröffentlichen von Luftaufnahmen kann eine Verbreitungsgenehmigung (spridningstillstånd, Lantmäteriet) erfordern. Versicherung gewerblich Pflicht. Mindestalter: 15 Jahre.",
      },
    ],
  },
  {
    iso: "AL",
    label: "Albanien",
    mapUrl: "https://www.aac.gov.al/",
    mapLabel: "Luftfahrtbehörde Albanien (AAC)",
    rules: [],
    fixedHints: [
      {
        id: "al_hint_easa",
        category: "country",
        level: "ok",
        title: "EASA-Regeln gelten",
        description:
          "Albanien hat 2022 die EU-/EASA-Drohnenregeln übernommen. Deine Registrierung (e-ID) und Kompetenznachweise aus der EU werden anerkannt. Max. 120 m in der offenen Kategorie.",
      },
      {
        id: "al_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description:
          "Da die EU-/EASA-Regeln gelten, wird eine EU-Betreiber-ID (e-ID) aus dem Heimatland anerkannt — keine Doppel-Registrierung nötig. Ohne EU-Registrierung erfolgt sie bei der albanischen Luftfahrtbehörde (AAC).",
      },
      {
        id: "al_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description:
          "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "al_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Albanien (AAC)",
        description:
          "Offizielle Drohnen-Infos der Autoriteti i Aviacionit Civil.",
        actionUrl: "https://www.aac.gov.al/",
        actionLabel: "AAC öffnen",
      },
      {
        id: "al_hint_insurance",
        category: "country",
        level: "warning",
        title: "Versicherung empfohlen",
        description:
          "Eine Drohnen-Haftpflicht ist in Albanien nicht zwingend vorgeschrieben, wird aber dringend empfohlen.",
      },
    ],
  },
  {
    iso: "IS",
    label: "Island",
    mapUrl: "https://kort.gis.is/mapview/?app=dronar",
    mapLabel: "Drohnenkarte Island (offiziell)",
    rules: [],
    fixedHints: [
      {
        id: "is_hint_easa",
        category: "country",
        level: "ok",
        title: "EASA-Regeln gelten",
        description:
          "In Island gelten die EU-/EASA-Drohnenregeln. e-ID und Kompetenznachweis aus der EU werden anerkannt. Max. 120 m über Grund.",
      },
      {
        id: "is_hint_registration",
        category: "pilot",
        level: "ok",
        title: "Registrierung als Drohnenbetreiber",
        description:
          "Eine EU-Betreiber-ID (e-ID) aus dem Heimatland wird anerkannt — keine Doppel-Registrierung nötig. Die nationale Registrierung erfolgt bei der isländischen Verkehrsbehörde (Samgöngustofa) über flydrone.is.",
        actionUrl: "https://flydrone.is",
        actionLabel: "flydrone.is öffnen",
      },
      {
        id: "is_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description:
          "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "is_hint_authority",
        category: "country",
        level: "ok",
        title: "Verkehrsbehörde Island (Samgöngustofa)",
        description:
          "Offizielle Drohnen-Infos der isländischen Verkehrsbehörde (ICETRA).",
        actionUrl: "https://www.icetra.is/aviation/drones",
        actionLabel: "Samgöngustofa öffnen",
      },
      {
        id: "is_hint_age",
        category: "pilot",
        level: "warning",
        title: "Mindestalter 16 Jahre",
        description: "Fernpiloten müssen in Island mindestens 16 Jahre alt sein.",
      },
      {
        id: "is_hint_insurance",
        category: "country",
        level: "warning",
        title: "Versicherung (gewerblich) Pflicht",
        description:
          "Für gewerbliche Flüge ist eine Haftpflicht Pflicht; die isländische Verkehrsbehörde empfiehlt sie für alle Drohnen.",
      },
    ],
  },
  {
    iso: "NO",
    label: "Norwegen",
    mapUrl: "https://www.avinor.no/en/practical-info/drone/dronekart/",
    mapLabel: "Avinor Drohnenkarte (offiziell)",
    rules: [],
    fixedHints: [
      {
        id: "no_hint_easa",
        category: "country",
        level: "ok",
        title: "EASA-Regeln gelten",
        description:
          "Norwegen hat die EU-Drohnenverordnung übernommen. e-ID und EU-Drohnenführerschein werden anerkannt. Max. 120 m in der offenen Kategorie.",
      },
      {
        id: "no_hint_registration",
        category: "country",
        level: "warning",
        title: "Registrierung bei Bedarf",
        description:
          "Du musst dich nur in einem EWR-Land registrieren. Eine norwegische Registrierung ist über flydrone.no/register möglich.",
        actionUrl: "https://flydrone.no/register",
        actionLabel: "flydrone.no öffnen",
      },
      {
        id: "no_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description:
          "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "no_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Norwegen (Luftfartstilsynet)",
        description:
          "Offizielle Drohnen-Infos der norwegischen Zivilluftfahrtbehörde.",
        actionUrl: "https://luftfartstilsynet.no/droner/",
        actionLabel: "Luftfartstilsynet öffnen",
      },
      {
        id: "no_hint_insurance",
        category: "country",
        level: "warning",
        title: "Versicherung (gewerblich) Pflicht",
        description: "Für gewerbliche Flüge ist eine Haftpflichtversicherung erforderlich.",
      },
    ],
  },
  {
    iso: "MK",
    label: "Nordmazedonien",
    mapUrl: "https://drone.gov.mk/",
    mapLabel: "drone.gov.mk (offiziell)",
    rules: [],
    fixedHints: [
      {
        id: "mk_hint_easa",
        category: "country",
        level: "ok",
        title: "EASA-Regeln weitgehend übernommen",
        description:
          "Nordmazedonien hat die EASA-Drohnenregeln weitgehend übernommen; der EU-Kompetenznachweis wird anerkannt.",
      },
      {
        id: "mk_hint_registration",
        category: "country",
        level: "error",
        title: "Lokale UAS-Registrierung Pflicht",
        description:
          "Da kein EU-Mitglied, musst du dich zusätzlich lokal als UAS-Betreiber über drone.gov.mk registrieren.",
        actionUrl: "https://drone.gov.mk/",
        actionLabel: "drone.gov.mk öffnen",
      },
      {
        id: "mk_hint_height",
        category: "country",
        level: "ok",
        title: "Maximale Flughöhe 120 m",
        description:
          "Die maximale Flughöhe beträgt in der offenen Kategorie 120 m über Grund (AGL). In Kontrollzonen (CTR) und in der Nähe von Flugplätzen gelten reduzierte Höhen oder es ist eine Freigabe erforderlich.",
      },
      {
        id: "mk_hint_authority",
        category: "country",
        level: "ok",
        title: "Luftfahrtbehörde Nordmazedonien (CAA)",
        description:
          "Offizielle Drohnen-Infos und Registrierung der mazedonischen Zivilluftfahrtagentur.",
        actionUrl: "https://drone.gov.mk/",
        actionLabel: "CAA öffnen",
      },
      {
        id: "mk_hint_insurance",
        category: "country",
        level: "warning",
        title: "Versicherung ab 500 g",
        description:
          "Drohnen ab 500 g müssen versichert sein. Zur Landesgrenze sind 3 km Abstand einzuhalten; private Drohnen max. 4 kg; Naturschutzgebiete erfordern eine Zustimmung.",
      },
    ],
  },
  {
    iso: "LI",
    label: "Liechtenstein",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-liechtenstein/",
    mapLabel: "Drohnenregeln Liechtenstein",
    rules: [],
    fixedHints: [
      {
        id: "li_hint_liberal",
        category: "country",
        level: "ok",
        title: "Liberale Regelung",
        description:
          "Drohnenflüge sind grundsätzlich ohne Registrierung und Kennzeichnung erlaubt. Die EU-Drohnenverordnung ist noch nicht umgesetzt.",
      },
      {
        id: "li_hint_permit",
        category: "country",
        level: "warning",
        title: "Genehmigung in Sonderfällen",
        description:
          "Eine Genehmigung ist nötig bei: über 30 kg, im Umkreis von 100 m um Menschenansammlungen (mehr als 24 Personen) oder innerhalb von 5 km um einen Flugplatz.",
      },
      {
        id: "li_hint_insurance",
        category: "country",
        level: "error",
        title: "Haftpflicht Pflicht",
        description:
          "Für private und gewerbliche Drohnenflüge ist eine Haftpflichtversicherung vorgeschrieben.",
      },
    ],
  },
  {
    iso: "BA",
    label: "Bosnien und Herzegowina",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-bosnien-herzegowina/",
    mapLabel: "Drohnenregeln Bosnien-Herzegowina",
    rules: [],
    fixedHints: [
      {
        id: "ba_hint_register",
        category: "country",
        level: "error",
        title: "Registrierung Pflicht",
        description:
          "Drohnen müssen in Bosnien-Herzegowina in jedem Fall registriert und gekennzeichnet werden. EU-Registrierungen werden nicht anerkannt.",
      },
      {
        id: "ba_hint_height",
        category: "country",
        level: "warning",
        title: "Max. 30 m Flughöhe",
        description:
          "Im unkontrollierten Luftraum ist die Flughöhe auf 30 m begrenzt. Gewichtsklassen: A1 0,25-1 kg, A2 1-2 kg, A3 2-5 kg.",
      },
      {
        id: "ba_hint_insurance",
        category: "country",
        level: "error",
        title: "Versicherung Pflicht",
        description: "Eine Drohnen-Haftpflicht ist für private und gewerbliche Flüge erforderlich.",
      },
    ],
  },
  {
    iso: "XK",
    label: "Kosovo",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-kosovo/",
    mapLabel: "Drohnenregeln Kosovo",
    rules: [],
    fixedHints: [
      {
        id: "xk_hint_micro",
        category: "country",
        level: "ok",
        title: "Kleine Drohnen genehmigungsfrei",
        description:
          "Unter 500 g, max. 15 m Entfernung und 30 m Höhe ist keine Erlaubnis nötig - mit Abständen: 1 km zur Staatsgrenze, 2 km zum Flughafen Pristina, 1 km zum NATO-Camp Film City.",
      },
      {
        id: "xk_hint_register",
        category: "country",
        level: "error",
        title: "Registrierung bei der CAA",
        description:
          "Alle größeren Drohnen müssen bei der Civil Aviation Authority registriert werden (4 Klassen). Du erhältst eine ID-Nummer als QR-Code-Plakette.",
      },
    ],
  },
  {
    iso: "MC",
    label: "Monaco",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-monaco/",
    mapLabel: "Drohnenregeln Monaco",
    rules: [],
    fixedHints: [
      {
        id: "mc_hint_permit",
        category: "country",
        level: "error",
        title: "Genehmigung pro Flug",
        description:
          "Ab 100 g brauchst du eine Genehmigung der Civil Aviation Authority - zusätzlich für jeden einzelnen Flug. Ohne Genehmigung sind nur Drohnen bis 100 g erlaubt.",
      },
      {
        id: "mc_hint_insurance",
        category: "country",
        level: "error",
        title: "Versicherung + Registrierung",
        description:
          "Eine Haftpflicht ist Pflicht und dem CAA-Antrag beizulegen. Drohnen müssen gekennzeichnet und registriert werden. Flüge nur in Sichtweite.",
      },
    ],
  },
  {
    iso: "ME",
    label: "Montenegro",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-montenegro/",
    mapLabel: "Drohnenregeln Montenegro",
    rules: [],
    fixedHints: [
      {
        id: "me_hint_import",
        category: "country",
        level: "error",
        title: "Einfuhr- + Registrierungspflicht",
        description:
          "Du brauchst eine Importgenehmigung des Wirtschaftsministeriums und eine Registrierung bei der Luftfahrtbehörde (CAA). Ohne Papiere wird die Drohne bei der Einreise meist konfisziert.",
      },
      {
        id: "me_hint_docs",
        category: "pilot",
        level: "warning",
        title: "Nachweise erforderlich",
        description:
          "Kompetenznachweis A1/A3 ab 250 g sowie Nachweis der UAS-Registrierung im Heimatland müssen hochgeladen werden. Gebühr ca. 135 EUR, Einfuhrgenehmigung 1 Jahr gültig.",
      },
    ],
  },
  {
    iso: "RS",
    label: "Serbien",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-serbien/",
    mapLabel: "Drohnenregeln Serbien",
    rules: [],
    fixedHints: [
      {
        id: "rs_hint_permit",
        category: "country",
        level: "error",
        title: "Einfuhr + Nutzung nur mit Genehmigung",
        description:
          "Drohnen dürfen in Serbien nur mit vorheriger Genehmigung der zuständigen Behörden eingeführt und genutzt werden. Max. 100 m im unkontrollierten Luftraum.",
      },
      {
        id: "rs_hint_insurance",
        category: "country",
        level: "error",
        title: "Versicherung Pflicht",
        description:
          "Eine Haftpflicht ist für private und gewerbliche Flüge erforderlich. Drohnen unter 250 g und unter 19 m/s sind ausgenommen. Lokale Registrierung nur für serbische Staatsbürger.",
      },
    ],
  },
  {
    iso: "RU",
    label: "Russland",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-russland/",
    mapLabel: "Drohnenregeln Russland",
    rules: [],
    fixedHints: [
      {
        id: "ru_hint_banned",
        category: "country",
        level: "error",
        title: "Derzeit nicht möglich",
        description:
          "Aufgrund der politischen Lage sind Drohnenflüge in Russland aktuell faktisch nicht erlaubt. Von einer Einreise mit Drohne wird dringend abgeraten.",
      },
      {
        id: "ru_hint_permit",
        category: "country",
        level: "error",
        title: "Aufwändige Genehmigungen",
        description:
          "Vor 2022 galt: Für jeden Flug ist eine Luftraumfreigabe der Behörde FAVT nötig, dazu eine Haftpflicht. Mind. 15 km Abstand zu Flughäfen, 5 km zu Flugplätzen.",
      },
    ],
  },
  {
    iso: "UA",
    label: "Ukraine",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-ukraine/",
    mapLabel: "Drohnenregeln Ukraine",
    rules: [],
    fixedHints: [
      {
        id: "ua_hint_banned",
        category: "country",
        level: "error",
        title: "Derzeit nicht erlaubt",
        description:
          "Aufgrund des Krieges ist der Einsatz ziviler Drohnen in der Ukraine derzeit nicht erlaubt.",
      },
      {
        id: "ua_hint_peace",
        category: "country",
        level: "warning",
        title: "Regeln außerhalb Kriegszeiten",
        description:
          "In Friedenszeiten galt: Drohnen unter 20 kg ohne Anmeldung bei 5 km Abstand zu Flughäfen, 3 km zu Flugplätzen, 500 m zu Flugzeugen und max. 120 m im unkontrollierten Luftraum.",
      },
    ],
  },
  {
    iso: "BY",
    label: "Weißrussland",
    mapUrl: "https://drohnen-camp.de/drohnen-gesetze-in-weissrussland/",
    mapLabel: "Drohnenregeln Weißrussland",
    rules: [],
    fixedHints: [
      {
        id: "by_hint_banned",
        category: "country",
        level: "error",
        title: "Privatbetrieb verboten",
        description:
          "Seit 2023 (Dekret 297) ist der private Drohnenbesitz und -betrieb in Weißrussland verboten. Von einer Einreise mit Drohne wird abgeraten.",
      },
      {
        id: "by_hint_import",
        category: "country",
        level: "error",
        title: "Import + Registrierung",
        description:
          "Gewerblich nur mit Importgenehmigung des Verkehrsministeriums und Registrierung binnen 5 Tagen nach Einreise. Ab 500 g Kennzeichnung mit Name und Adresse. Max. 100 m.",
      },
    ],
  },
  {
    iso: "UK",
    label: "Vereinigtes Königreich",
    mapUrl: "https://dronesafe.uk/drone-code",
    mapLabel: "NATS Drone Assist",
    rules: [
      (_drone, pilot) => {
        if (!pilot.countrySpecific.caaUK) {
          return {
            id: "uk_registration",
            category: "pilot",
            level: "error",
            title: "UK-Registrierung erforderlich",
            description: "EU-Dokumente (e-ID, A1/A3) sind im Vereinigten Königreich nicht gültig. Du brauchst eine eigene Operator ID und Flyer ID bei der CAA UK.",
            actionUrl: "https://register-drones.caa.co.uk",
            actionLabel: "CAA Register öffnen",
            pilotField: "countrySpecific.caaUK",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "uk_hint_eu_invalid",
        category: "country",
        level: "error",
        title: "EU-Standard ungültig",
        description: "Im Vereinigten Königreich gelten eigene Regelungen. EU-Registrierungen, Kompetenz-nachweise und Versicherungen werden nicht anerkannt.",
      },
    ],
  },
];

export function getCountryRuleSet(countryIso: string): CountryRuleSet | null {
  return COUNTRY_RULES.find((r) => r.iso === normalizeCountryIso(countryIso)) || null;
}

export function getSupportedCountries(): { iso: string; label: string }[] {
  return COUNTRY_RULES.map((r) => ({ iso: r.iso, label: r.label }));
}

function normalizeCountryIso(iso: string): string {
  const upper = iso.toUpperCase();
  if (upper === "GB") return "UK";
  return upper;
}

// Länder mit eigenem nationalem Drohnen-System (KEINE EASA-/EU-Anerkennung).
// Für diese gelten die EU_BASE_RULES nicht.
export const NATIONAL_SYSTEM_COUNTRIES = new Set([
  "UK",
  "LI",
  "BA",
  "XK",
  "MC",
  "ME",
  "RS",
  "RU",
  "UA",
  "BY",
]);

export function checkCountryCompliance(
  drone: DroneProfile,
  pilot: PilotProfile,
  countryIso: string,
): ComplianceResult {
  const upper = normalizeCountryIso(countryIso);
  const ruleSet = COUNTRY_RULES.find((r) => r.iso === upper);
  const items: ComplianceItem[] = [];

  if (!NATIONAL_SYSTEM_COUNTRIES.has(upper)) {
    for (const rule of EU_BASE_RULES) {
      const item = rule(drone, pilot);
      if (item) items.push(item);
    }
  }

  if (ruleSet) {
    for (const rule of ruleSet.rules) {
      const item = rule(drone, pilot);
      if (item) items.push(item);
    }
    for (const hint of ruleSet.fixedHints) {
      items.push(hint);
    }
  }

  const hasError = items.some((i) => i.level === "error");
  const hasWarning = items.some((i) => i.level === "warning");
  const overallStatus: ComplianceLevel = hasError ? "error" : hasWarning ? "warning" : "ok";

  return {
    country: upper,
    countryLabel: ruleSet?.label || upper,
    overallStatus,
    items,
  };
}

export function getCountryMapUrl(countryIso: string): { url: string; label: string } | null {
  const ruleSet = COUNTRY_RULES.find((r) => r.iso === normalizeCountryIso(countryIso));
  if (!ruleSet?.mapUrl) return null;
  return { url: ruleSet.mapUrl, label: ruleSet.mapLabel || "Karte" };
}
