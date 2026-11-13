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
        id: "de_hint_night",
        category: "country",
        level: "ok",
        title: "Nachtflug moglich",
        description: "In Deutschland ist Nachtflug fur Hobbypiloten erlaubt, sofern die Drohne Positionslichter hat und Sichtbedingungen eingehalten werden.",
      },
    ],
  },
  {
    iso: "FR",
    label: "Frankreich",
    mapUrl: "https://www.geoportail.gouv.fr/donnees/restrictions-uas-categorie-ouverte-et-aeromodelisme",
    mapLabel: "Geoportail Drones",
    rules: [
      (drone, pilot) => {
        if (drone.mtomGrams >= 800 && !pilot.countrySpecific.alphaTangoFR) {
          return {
            id: "fr_alphatango",
            category: "pilot",
            level: "error",
            title: "AlphaTango-Registrierung fehlt",
            description: `Deine Drohne wiegt ${drone.mtomGrams} g (>= 800 g). In Frankreich ist eine zusatzliche Registrierung auf AlphaTango zwingend erforderlich. Die FRA-Nummer muss an der Drohne angebracht werden.`,
            actionUrl: "https://alphatango.aviation-civile.gouv.fr",
            actionLabel: "AlphaTango offnen",
            pilotField: "countrySpecific.alphaTangoFR",
          };
        }
        return null;
      },
      (drone) => {
        if (drone.mtomGrams >= 800 && !drone.hasRemoteId) {
          return {
            id: "fr_balise",
            category: "drone",
            level: "error",
            title: "Signalmodul (Balise) erforderlich",
            description: "In Frankreich mussen Drohnen >= 800 g eine elektronische Fernidentifizierung haben. Deine Drohne hat keine integrierte Remote-ID. Ein externes franzosisches Signalmodul (Balise) ist Pflicht.",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "fr_hint_night",
        category: "country",
        level: "warning",
        title: "Absolutes Nachtflugverbot",
        description: "Nachtflug fur Freizeitpiloten ist in Frankreich generell verboten.",
      },
      {
        id: "fr_hint_cities",
        category: "country",
        level: "warning",
        title: "Uberflugverbot in Stadten",
        description: "Das Uberfliegen von Stadten, Strassen und Menschenansammlungen ist in Frankreich streng verboten.",
      },
    ],
  },
  {
    iso: "IT",
    label: "Italien",
    mapUrl: "https://www.d-flight.it/new_portal",
    mapLabel: "D-Flight Portal",
    rules: [
      (_drone, pilot) => {
        if (!pilot.countrySpecific.dFlightIT) {
          return {
            id: "it_dflight",
            category: "pilot",
            level: "error",
            title: "D-Flight QR-Code fehlt",
            description: "In Italien ist ein kostenpflichtiger QR-Code von D-Flight erforderlich (ca. 6 EUR), der sichtbar an der Drohne angebracht werden muss.",
            actionUrl: "https://www.d-flight.it/new_portal",
            actionLabel: "D-Flight offnen",
            pilotField: "countrySpecific.dFlightIT",
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
        title: "Strandflug eingeschrankt",
        description: "Fliegen uber Stranden im Sommer (Juni-September) ist in Italien streng reglementiert.",
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
            description: "Die Schweiz verlangt fur Drohnen uber 250 g eine Haftpflichtversicherung mit mindestens 1 Mio. CHF Deckungssumme. Bitte prufe deine Deckung.",
            pilotField: "countrySpecific.insuranceCH1Mio",
          };
        }
        return null;
      },
    ],
    fixedHints: [
      {
        id: "ch_hint_registration",
        category: "country",
        level: "warning",
        title: "UAS.gate Registrierung",
        description: "Eine Registrierung im UAS.gate (BAZL) ist in der Schweiz zwingend erforderlich.",
        actionUrl: "https://uas.gate.easa.europa.eu",
        actionLabel: "UAS.gate offnen",
      },
      {
        id: "ch_hint_distance",
        category: "country",
        level: "ok",
        title: "Flugplatz-Abstand 5 km",
        description: "Abstand zu Flugplatzen ohne Bewilligung: 5 km. Karten-Check auf Skyguide empfohlen.",
      },
    ],
  },
  {
    iso: "AT",
    label: "Osterreich",
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
            description: "In Osterreich ist ein Versicherungsnachweis uber 750.000 SZR (Sonderziehungsrechte) erforderlich.",
            actionUrl: "https://www.dronespace.at",
            actionLabel: "Dronespace offnen",
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
            title: "Bestandsdrohne in Osterreich",
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
        description: "In Osterreich wird der A1/A3 Kompetenznachweis bei Drohnen uber 250 g streng kontrolliert.",
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
            title: "Flugerklarung ggf. erforderlich",
            description: "Prufe auf ENAIRE Drones, ob fur deine geplante Flugzone eine vorherige Flugerklarung (Declaracion responsable) bei der AESA notig ist.",
            actionUrl: "https://drones.enaire.es",
            actionLabel: "ENAIRE offnen",
          };
        }
        return null;
      },
    ],
    fixedHints: [],
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
    ],
  },
  {
    iso: "NL",
    label: "Niederlande",
    mapUrl: "https://godrone.nl",
    mapLabel: "GoDrone",
    rules: [],
    fixedHints: [
      {
        id: "nl_hint_godrone",
        category: "country",
        level: "ok",
        title: "GoDrone Karte prufen",
        description: "Vor dem Flug die GoDrone-App oder -Karte der Niederlande prufen.",
        actionUrl: "https://godrone.nl",
        actionLabel: "GoDrone offnen",
      },
    ],
  },
  {
    iso: "UK",
    label: "Vereinigtes Konigreich",
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
            description: "EU-Dokumente (e-ID, A1/A3) sind im Vereinigten Konigreich nicht gultig. Du brauchst eine eigene Operator ID und Flyer ID bei der CAA UK.",
            actionUrl: "https://register-drones.caa.co.uk",
            actionLabel: "CAA Register offnen",
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
        title: "EU-Standard ungultig",
        description: "Im Vereinigten Konigreich gelten eigene Regelungen. EU-Registrierungen, Kompetenz-nachweise und Versicherungen werden nicht anerkannt.",
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

export function checkCountryCompliance(
  drone: DroneProfile,
  pilot: PilotProfile,
  countryIso: string,
): ComplianceResult {
  const upper = normalizeCountryIso(countryIso);
  const ruleSet = COUNTRY_RULES.find((r) => r.iso === upper);
  const items: ComplianceItem[] = [];

  if (upper !== "UK") {
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
