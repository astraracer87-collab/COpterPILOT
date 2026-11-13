import { DroneProfile, DroneClass, OpenCategory } from "@/lib/storage";

export interface CategoryAdvice {
  category: string;
  subcategory: string;
  label: string;
  description: string;
  requirements: string[];
  technicalRequirements: string[];
  safetyDistances: string[];
  color: "green" | "yellow" | "red";
}

export interface UasClassInfo {
  classMark: string;
  label: string;
  maxMtomG: number;
  maxSpeedMs: number | null;
  subcategories: string[];
  heightLimiter: boolean;
  altimeter: boolean;
  remoteId: boolean;
  geoSensibilisierung: boolean;
  description: string;
}

export const UAS_CLASS_INFO: Record<string, UasClassInfo> = {
  C0: {
    classMark: "C0",
    label: "Klasse C0",
    maxMtomG: 250,
    maxSpeedMs: 19,
    subcategories: ["A1"],
    heightLimiter: true,
    altimeter: false,
    remoteId: false,
    geoSensibilisierung: false,
    description: "Kleinstes UAS. Darf \u00fcber unbeteiligte Personen fliegen (nicht \u00fcber Menschenansammlungen). Maximale Abflugmasse unter 250 g. H\u00f6henbegrenzung auf 120 m \u00fcber Startpunkt automatisch.",
  },
  C1: {
    classMark: "C1",
    label: "Klasse C1",
    maxMtomG: 900,
    maxSpeedMs: 19,
    subcategories: ["A1"],
    heightLimiter: true,
    altimeter: true,
    remoteId: true,
    geoSensibilisierung: true,
    description: "Leichtes UAS unter 900 g. Darf in der N\u00e4he von Personen fliegen, aber nicht gezielt \u00fcber unbeteiligte Personen. Lagebeurteilung vor Flugbeginn erforderlich. Fernidentifizierung (Remote-ID) und Geo-Sensibilisierung vorgeschrieben.",
  },
  C2: {
    classMark: "C2",
    label: "Klasse C2",
    maxMtomG: 4000,
    maxSpeedMs: null,
    subcategories: ["A2", "A3"],
    heightLimiter: true,
    altimeter: true,
    remoteId: true,
    geoSensibilisierung: true,
    description: "Mittleres UAS unter 4 kg. In A2 mit Mindestabstand 30 m (5 m im Langsamflugmodus \u2264 3 m/s). H\u00f6henmesser und Fernidentifizierung vorgeschrieben.",
  },
  C3: {
    classMark: "C3",
    label: "Klasse C3",
    maxMtomG: 25000,
    maxSpeedMs: null,
    subcategories: ["A3"],
    heightLimiter: true,
    altimeter: true,
    remoteId: true,
    geoSensibilisierung: true,
    description: "Gro\u00dfes UAS unter 25 kg. Nur in sicherem Abstand (150 m) zu Wohn-, Gewerbe- und Erholungsgebieten. Fernidentifizierung und Geo-Sensibilisierung vorgeschrieben.",
  },
  C4: {
    classMark: "C4",
    label: "Klasse C4",
    maxMtomG: 25000,
    maxSpeedMs: null,
    subcategories: ["A3"],
    heightLimiter: false,
    altimeter: false,
    remoteId: false,
    geoSensibilisierung: false,
    description: "Einfaches UAS unter 25 kg ohne automatische Systeme. Keine Fernidentifizierung, kein Geo-Sensibilisierung. Nur fernab von Menschen und besiedelten Gebieten.",
  },
  C5: {
    classMark: "C5",
    label: "Klasse C5",
    maxMtomG: 25000,
    maxSpeedMs: null,
    subcategories: ["STS-01"],
    heightLimiter: true,
    altimeter: true,
    remoteId: true,
    geoSensibilisierung: true,
    description: "Spezielle Kategorie (STS-01). Betrieb nur mit Betriebsgenehmigung.",
  },
  C6: {
    classMark: "C6",
    label: "Klasse C6",
    maxMtomG: 25000,
    maxSpeedMs: null,
    subcategories: ["STS-02"],
    heightLimiter: true,
    altimeter: true,
    remoteId: true,
    geoSensibilisierung: true,
    description: "Spezielle Kategorie (STS-02). Betrieb nur mit Betriebsgenehmigung.",
  },
};

export interface SubcategoryInfo {
  id: string;
  label: string;
  description: string;
  safetyDistancePerson: string;
  safetyDistanceSettlement: string;
  requiredLicense: string;
  allowedClasses: string[];
}

export const SUBCATEGORY_INFO: Record<string, SubcategoryInfo> = {
  A1: {
    id: "A1",
    label: "Unterkategorie A1",
    description: "Am wenigsten restriktiv. Betrieb in dicht besiedelten Gebieten und \u00fcber vereinzelten Personen m\u00f6glich (nicht \u00fcber Menschenansammlungen). Nur sehr leichte UAS (C0 < 250 g, C1 < 900 g).",
    safetyDistancePerson: "C0: \u00dcberflug unbeteiligter Personen mit \u00e4u\u00dferster Vorsicht erlaubt. C1: Kein gezielter \u00dcberflug unbeteiligter Personen.",
    safetyDistanceSettlement: "Keine besondere Abstandsregel zu Siedlungen.",
    requiredLicense: "C0 (< 250 g): Keine Fernpilotenlizenz (Betreiberregistrierung bei Kamera/Sensor). C1 (< 900 g): EU-Kompetenznachweis A1/A3 (Online-Training + Online-Pr\u00fcfung).",
    allowedClasses: ["C0", "C1"],
  },
  A2: {
    id: "A2",
    label: "Unterkategorie A2",
    description: "Strengste Anforderungen. Schwere UAS (bis 4 kg) in der N\u00e4he von Menschen. Mindestabstand 30 m (5 m im Langsamflugmodus \u2264 3 m/s / 10 km/h). Gr\u00f6\u00dferer Abstand bei ung\u00fcnstigen Bedingungen (Wind, niedriger Akku).",
    safetyDistancePerson: "30 m horizontal (5 m im Langsamflugmodus \u2264 3 m/s).",
    safetyDistanceSettlement: "Keine zus\u00e4tzliche Abstandsregel zu Siedlungen.",
    requiredLicense: "EU-Kompetenznachweis A1/A3 + Praktische Selbstschulung + EU-Fernpilotenzeugnis A2 (Theoriepr\u00fcfung vor Ort).",
    allowedClasses: ["C2"],
  },
  A3: {
    id: "A3",
    label: "Unterkategorie A3",
    description: "Gr\u00f6\u00dfte und schwerste UAS (bis 25 kg). Betrieb nur fernab von Menschen und besiedelten Gebieten. Mindestabstand 150 m zu Wohn-, Gewerbe-, Industrie- und Erholungsgebieten.",
    safetyDistancePerson: "Sicherer Abstand: >30 m, mindestens 1:1-Regel (1 m Abstand pro 1 m Flugh\u00f6he), mindestens der in 2 Sekunden zur\u00fcckgelegte Weg (Reaktionszeit).",
    safetyDistanceSettlement: "150 m zu Wohn-, Gewerbe-, Industrie- und Erholungsgebieten.",
    requiredLicense: "EU-Kompetenznachweis A1/A3 (Online-Training + Online-Pr\u00fcfung).",
    allowedClasses: ["C2", "C3", "C4"],
  },
};

export const OPERATION_CATEGORIES = {
  open: {
    label: "Offene Kategorie (OPEN)",
    description: "Geringes Risiko. Keine vorherige Genehmigung erforderlich.",
    conditions: [
      "UAS wiegt weniger als 25 kg",
      "Nicht \u00fcber Menschenansammlungen",
      "Max. 120 m Flugh\u00f6he AGL",
      "Nur in direkter Sichtverbindung (VLOS)",
      "Kein Gefahrgut- oder Personentransport",
    ],
  },
  specific: {
    label: "Spezielle Kategorie (SPECIFIC)",
    description: "Mittleres Risiko. Betriebsgenehmigung oder Erkl\u00e4rung erforderlich.",
    conditions: [
      "UAS \u00fcber 25 kg",
      "Betrieb oberhalb 120 m AGL",
      "Betrieb au\u00dferhalb VLOS (BVLOS)",
      "Betrieb in speziellen Luftr\u00e4umen",
    ],
  },
  certified: {
    label: "Zulassungspflichtige Kategorie (CERTIFIED)",
    description: "Hohes Risiko. Vollst\u00e4ndige Zulassung erforderlich.",
    conditions: [
      "Betrieb \u00fcber Menschenansammlungen",
      "Transport von risikoreichem Gefahrgut",
      "Transport von Personen",
    ],
  },
};

export const MENSCHENANSAMMLUNG_DEFINITION = "Eine Vielzahl von Menschen, die so dicht gedr\u00e4ngt stehen, dass es einer einzelnen Person nahezu unm\u00f6glich ist, sich aus dieser Menge zu entfernen (z.B. Konzerte, Sportveranstaltungen, Demonstrationen).";

export const LEGACY_TRANSITION_INFO = {
  expired: true,
  article: "Artikel 22 DVO (EU) 2019/947",
  description: "\u00dcbergangsregelungen f\u00fcr Bestandsdrohnen ohne Klassenkennzeichnung sind seit 2024 ausgelaufen. Drohnen \u00fcber 250 g ohne C-Klasse d\u00fcrfen nur noch in der Unterkategorie A3 (fernab von Personen, 150 m Abstand) betrieben werden.",
  implication: "Drohnen > 250 g ohne Klassenkennzeichnung: Nur A3 (offene Kategorie) oder Spezielle Kategorie mit Genehmigung.",
};

export const LBA_CONTACT = {
  name: "Luftfahrt-Bundesamt (LBA)",
  referat: "Referat B 5",
  address: "38144 Braunschweig",
  email: "uas@lba.de",
  web: "https://www.lba.de/UAS",
  onlineCourse: "https://lba-openuav.de",
  classificationPage: "https://lba-openuav.de/onlinekurs/lehrmaterial/luftrecht-und-sicherheit/uas-klassifizierungen/",
};

export const EU_REGULATIONS = {
  basicRegulation: { label: "Basic Regulation", url: "https://www.easa.europa.eu/document-library/regulations/regulation-eu-20181139" },
  delegatedRegulation: { label: "Delegierte Verordnung \u00fcber UAS (EU 2019/945)", url: "https://www.easa.europa.eu/document-library/regulations/commission-delegated-regulation-eu-2019945" },
  implementingRegulation: { label: "UAS-Durchf\u00fchrungsverordnung (EU 2019/947)", url: "https://www.easa.europa.eu/document-library/regulations/commission-implementing-regulation-eu-2019947" },
  shortcut: { label: "Zusammenfassung Modul 1 \u2013 Luftrecht (PDF)", url: "https://lba-openuav.de/wp-content/uploads/UAS-99-1-ALW-Shortcut-20-4.pdf" },
};

export function suggestCategory(
  drone: DroneProfile,
  options?: {
    isFpvFlight?: boolean;
    hasRestrictions?: boolean;
    nearPeople?: boolean;
  }
): CategoryAdvice {
  const { classMark, mtomGrams, openCategory } = drone;
  const isFpv = options?.isFpvFlight ?? false;
  const hasRestrictions = options?.hasRestrictions ?? false;

  const base = {
    technicalRequirements: [] as string[],
    safetyDistances: [] as string[],
  };

  if (hasRestrictions) {
    return {
      ...base,
      category: "STS / Specific",
      subcategory: "Specific",
      label: "Genehmigungspflichtig",
      description:
        "Aufgrund von Einschr\u00e4nkungen im Fluggebiet ist m\u00f6glicherweise eine spezielle Genehmigung erforderlich (z.B. STS-01 oder STS-02).",
      requirements: [
        "Betriebsgenehmigung bei LBA beantragen",
        "SORA-Risikobewertung ggf. erforderlich",
        "Betriebshandbuch erstellen",
      ],
      color: "red",
    };
  }

  if (classMark === "C0") {
    return {
      ...base,
      category: "Open A1",
      subcategory: "A1",
      label: "Offene Kategorie A1",
      description:
        "C0-UAS (unter 250 g MTOM). Darf mit \u00e4u\u00dferster Vorsicht \u00fcber unbeteiligte Personen fliegen (nicht \u00fcber Menschenansammlungen). H\u00f6henbegrenzung 120 m automatisch.",
      requirements: [
        "Keine Fernpilotenlizenz erforderlich",
        "Registrierung als Betreiber (wenn Kamera/Sensor vorhanden)",
        "Grundlegende Regeln beachten",
        "Max. 120 m Flugh\u00f6he AGL",
        "Max. Geschwindigkeit 19 m/s",
      ],
      technicalRequirements: [
        "Automatische H\u00f6henbegrenzung auf 120 m \u00fcber Startpunkt",
        "CE-Kennzeichnung + C0-Klassen-ID",
      ],
      safetyDistances: [
        "\u00dcberflug unbeteiligter Personen: Mit \u00e4u\u00dferster Vorsicht erlaubt",
        "Nicht \u00fcber Menschenansammlungen",
      ],
      color: "green",
    };
  }

  if (classMark === "C1") {
    return {
      ...base,
      category: "Open A1",
      subcategory: "A1",
      label: "Offene Kategorie A1",
      description:
        "C1-UAS (unter 900 g). Darf in der N\u00e4he von Personen fliegen, aber nicht gezielt \u00fcber unbeteiligte Personen. Lagebeurteilung vor Flugbeginn erforderlich.",
      requirements: [
        "EU-Kompetenznachweis A1/A3 (Online-Training + Online-Pr\u00fcfung)",
        "Registrierung als Betreiber",
        "eID-Label + Remote-ID aktiv",
        "Lagebeurteilung vor Flugbeginn",
        "Max. 120 m Flugh\u00f6he AGL",
      ],
      technicalRequirements: [
        "CE-Kennzeichnung + C1-Klassen-ID",
        "Fernidentifizierung (Remote-ID) vorgeschrieben",
        "Geo-Sensibilisierungssystem vorgeschrieben",
        "H\u00f6henmesser vorgeschrieben",
        "Max. Geschwindigkeit 19 m/s",
      ],
      safetyDistances: [
        "Kein gezielter \u00dcberflug unbeteiligter Personen",
        "Bei versehentlichem \u00dcberflug: Dauer minimieren",
        "Nicht \u00fcber Menschenansammlungen",
      ],
      color: "green",
    };
  }

  if (classMark === "C2") {
    if (openCategory === "A2") {
      return {
        ...base,
        category: "Open A2",
        subcategory: "A2",
        label: "Offene Kategorie A2",
        description:
          "C2-UAS (unter 4 kg). Strengste Anforderungen in der offenen Kategorie. Mindestabstand 30 m zu unbeteiligten Personen (5 m im Langsamflugmodus \u2264 3 m/s).",
        requirements: [
          "EU-Kompetenznachweis A1/A3",
          "Praktische Selbstschulung absolviert",
          "EU-Fernpilotenzeugnis A2 (Theoriepr\u00fcfung vor Ort)",
          "Registrierung als Betreiber",
          "eID-Label + Remote-ID aktiv",
          "Max. 120 m Flugh\u00f6he AGL",
        ],
        technicalRequirements: [
          "CE-Kennzeichnung + C2-Klassen-ID",
          "Fernidentifizierung (Remote-ID) vorgeschrieben",
          "Geo-Sensibilisierungssystem vorgeschrieben",
          "H\u00f6henmesser vorgeschrieben",
          "Langsamflugmodus (\u2264 3 m/s) verf\u00fcgbar",
        ],
        safetyDistances: [
          "30 m horizontaler Mindestabstand zu unbeteiligten Personen",
          "5 m im Langsamflugmodus (\u2264 3 m/s / 10 km/h)",
          "Gr\u00f6\u00dferer Abstand bei ung\u00fcnstigen Bedingungen (Wind, niedriger Akku, Hindernisse)",
          "Nicht \u00fcber Menschenansammlungen",
        ],
        color: "yellow",
      };
    }
    return {
      ...base,
      category: "Open A3",
      subcategory: "A3",
      label: "Offene Kategorie A3",
      description:
        "C2-UAS ohne A2-Zeugnis. Fliegen nur fernab von Menschen und besiedelten Gebieten (150 m Abstand).",
      requirements: [
        "EU-Kompetenznachweis A1/A3",
        "Registrierung als Betreiber",
        "eID-Label + Remote-ID aktiv",
        "150 m Abstand zu Wohn-/Gewerbe-/Erholungsgebieten",
        "Max. 120 m Flugh\u00f6he AGL",
      ],
      technicalRequirements: [
        "CE-Kennzeichnung + C2-Klassen-ID",
        "Fernidentifizierung (Remote-ID) vorgeschrieben",
        "Geo-Sensibilisierungssystem vorgeschrieben",
        "H\u00f6henmesser vorgeschrieben",
      ],
      safetyDistances: [
        "150 m zu Wohn-, Gewerbe-, Industrie- und Erholungsgebieten",
        "Sicherer Abstand zu Personen: >30 m",
        "1:1-Regel: 1 m Abstand pro 1 m Flugh\u00f6he",
        "Mindestens der in 2 Sekunden zur\u00fcckgelegte Weg",
        "Bei Auftauchen unbeteiligter Personen: Sofort landen",
      ],
      color: "yellow",
    };
  }

  if (classMark === "C3" || classMark === "C4") {
    const hasRemoteId = classMark === "C3";
    const hasGeoSens = classMark === "C3";
    return {
      ...base,
      category: "Open A3",
      subcategory: "A3",
      label: "Offene Kategorie A3",
      description:
        `${classMark}-UAS (unter 25 kg). Nur fernab von Menschen und besiedelten Gebieten (150 m Abstand). ${!hasRemoteId ? "Keine automatische Fernidentifizierung." : ""}`,
      requirements: [
        "EU-Kompetenznachweis A1/A3",
        "Registrierung als Betreiber",
        "eID-Label auf der Drohne",
        hasRemoteId ? "Remote-ID aktiv" : "Kein automatischer Remote-ID",
        "150 m Abstand zu Wohngebieten",
        "Max. 120 m Flugh\u00f6he AGL",
      ],
      technicalRequirements: [
        `CE-Kennzeichnung + ${classMark}-Klassen-ID`,
        hasRemoteId ? "Fernidentifizierung (Remote-ID) vorgeschrieben" : "Keine Fernidentifizierung vorgeschrieben",
        hasGeoSens ? "Geo-Sensibilisierungssystem vorgeschrieben" : "Kein Geo-Sensibilisierungssystem vorgeschrieben",
        hasRemoteId ? "H\u00f6henmesser vorgeschrieben" : "Kein H\u00f6henmesser vorgeschrieben",
      ],
      safetyDistances: [
        "150 m zu Wohn-, Gewerbe-, Industrie- und Erholungsgebieten",
        "Sicherer Abstand zu Personen: >30 m",
        "1:1-Regel: 1 m Abstand pro 1 m Flugh\u00f6he",
        "Mindestens der in 2 Sekunden zur\u00fcckgelegte Weg",
        "Bei Auftauchen unbeteiligter Personen: Sofort landen",
      ],
      color: "yellow",
    };
  }

  if (classMark === "C5" || classMark === "C6") {
    const stsType = classMark === "C5" ? "STS-01" : "STS-02";
    return {
      ...base,
      category: "STS / Specific",
      subcategory: "Specific",
      label: "Spezielle Kategorie",
      description:
        `${classMark}-UAS. Betrieb nur mit Betriebsgenehmigung (${stsType}) m\u00f6glich. Erweiterte Pilotenausbildung und Betriebshandbuch erforderlich.`,
      requirements: [
        `Betriebsgenehmigung ${stsType}`,
        "Betriebshandbuch erstellen",
        "Erweiterte Pilotenausbildung",
        "Registrierung als Betreiber",
      ],
      technicalRequirements: [
        `CE-Kennzeichnung + ${classMark}-Klassen-ID`,
        "Fernidentifizierung (Remote-ID) vorgeschrieben",
        "Geo-Sensibilisierungssystem vorgeschrieben",
        "H\u00f6henmesser vorgeschrieben",
      ],
      safetyDistances: [
        `Gem\u00e4\u00df ${stsType}-Betriebshandbuch`,
      ],
      color: "red",
    };
  }

  if (classMark === "legacy") {
    if (mtomGrams < 250) {
      return {
        ...base,
        category: "Open A1 (Legacy)",
        subcategory: "A1",
        label: "Offene Kategorie A1 (Bestandsdrohne)",
        description:
          "Bestandsdrohne unter 250 g ohne Klassenkennzeichnung. Betrieb wie C0 m\u00f6glich.",
        requirements: [
          "EU-Kompetenznachweis A1/A3 empfohlen",
          "Registrierung als Betreiber (wenn Kamera/Sensor vorhanden)",
          "Max. 120 m Flugh\u00f6he AGL",
          "Nicht \u00fcber Menschenansammlungen",
        ],
        technicalRequirements: [
          "Kein CE-/Klassen-Kennzeichen vorhanden",
        ],
        safetyDistances: [
          "\u00dcberflug unbeteiligter Personen: Mit \u00e4u\u00dferster Vorsicht",
          "Nicht \u00fcber Menschenansammlungen",
        ],
        color: "green",
      };
    }
    return {
      ...base,
      category: "Open A3 (Legacy)",
      subcategory: "A3",
      label: "Offene Kategorie A3 (Bestandsdrohne)",
      description:
        `Bestandsdrohne ${mtomGrams > 2000 ? "\u00fcber 2 kg" : (mtomGrams > 500 ? "500 g\u20132 kg" : "250\u2013500 g")} ohne Klassenkennzeichnung. \u00dcbergangsregelungen (Art. 22 EU 2019/947) sind seit 2024 ausgelaufen. Betrieb nur noch in A3 (150 m Abstand) oder in der Speziellen Kategorie.`,
      requirements: [
        "EU-Kompetenznachweis A1/A3",
        "Registrierung als Betreiber",
        "150 m Abstand zu Wohn-/Gewerbe-/Erholungsgebieten",
        "Max. 120 m Flugh\u00f6he AGL",
        mtomGrams > 2000 ? "Ggf. Spezielle Kategorie mit Genehmigung pr\u00fcfen" : "",
      ].filter(Boolean),
      technicalRequirements: [
        "Kein CE-/Klassen-Kennzeichen vorhanden",
        "Keine Fernidentifizierung (Remote-ID)",
        "Kein Geo-Sensibilisierungssystem",
        "\u00dcbergangsregelung Art. 22 ausgelaufen (2024)",
      ],
      safetyDistances: [
        "150 m zu Wohn-, Gewerbe-, Industrie- und Erholungsgebieten",
        "Sicherer Abstand zu Personen: >30 m",
        "1:1-Regel: 1 m Abstand pro 1 m Flugh\u00f6he",
        "Bei Auftauchen unbeteiligter Personen: Sofort landen",
      ],
      color: mtomGrams > 2000 ? "red" : "yellow",
    };
  }

  return {
    ...base,
    category: "Nicht bestimmt",
    subcategory: "A3",
    label: "Kategorie nicht ermittelt",
    description: "Bitte pr\u00fcfen Sie die EU-Drohnenverordnung (EU) 2019/947.",
    requirements: ["Kontaktieren Sie Ihre Luftfahrtbeh\u00f6rde f\u00fcr Details"],
    color: "yellow",
  };
}
