export interface ResourceLink {
  title: string;
  url: string;
  description: string;
  category: ResourceCategory;
  icon: string;
}

export type ResourceCategory =
  | "Luftraum & NOTAMs"
  | "Naturschutz"
  | "Wetter"
  | "Karten"
  | "Drohnenrecht";

export const resourceLinks: ResourceLink[] = [
  {
    title: "NOTAM Info Deutschland",
    url: "https://notaminfo.com/germanymap",
    description: "Interaktive NOTAM-Karte für Deutschland mit aktuellen Luftraumeinschränkungen",
    category: "Luftraum & NOTAMs",
    icon: "alert-circle",
  },
  {
    title: "DIPUL Mil. Tieffluggebiete (Tag)",
    url: "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/tieffluege-mit-militaerischen-luftfahrzeugen-am-tage-ueber-land/",
    description: "Übersicht und Karte der militärischen Tieffluggebiete am Tage über Land (Bundeswehr, GND – 250 ft AGL)",
    category: "Luftraum & NOTAMs",
    icon: "shield",
  },
  {
    title: "AIP DFS",
    url: "https://aip.dfs.de",
    description: "Amtliche Luftfahrtinformationen der Deutschen Flugsicherung",
    category: "Luftraum & NOTAMs",
    icon: "book-open",
  },
  {
    title: "Airspace XContest",
    url: "https://airspace.xcontest.org",
    description: "Luftraumvisualisierung mit detaillierten Zonen und Höheninformationen",
    category: "Luftraum & NOTAMs",
    icon: "layers",
  },
  {
    title: "Live Glider Network",
    url: "https://live.glidernet.org",
    description: "Echtzeit-Tracking von Segelflugzeugen und anderen Luftfahrzeugen",
    category: "Luftraum & NOTAMs",
    icon: "radio",
  },
  {
    title: "BfN Schutzgebiete",
    url: "https://geodienste.bfn.de/schutzgebiete",
    description: "Karte aller Naturschutzgebiete, Nationalparks und FFH-Gebiete in Deutschland",
    category: "Naturschutz",
    icon: "shield",
  },
  {
    title: "Kachelmann Wetter",
    url: "https://kachelmannwetter.com",
    description: "Detaillierte Wettervorhersagen, Regenradar und Windkarten",
    category: "Wetter",
    icon: "cloud",
  },
  {
    title: "Topographic Map",
    url: "https://topographic-map.com",
    description: "Topografische Karten mit Höhenlinien für die Flugplanung",
    category: "Karten",
    icon: "map",
  },
  {
    title: "DIPUL Geo-Gebiete Europa",
    url: "https://www.dipul.de/homepage/de/informationen/geografische-gebiete/geografische-gebiete-in-europa/",
    description: "Offizielle UAS-Geozonen aller EU-Länder mit Links zu nationalen Karten",
    category: "Karten",
    icon: "globe",
  },
  {
    title: "EMF Bundesnetzagentur",
    url: "https://emf3.bundesnetzagentur.de",
    description: "Standorte von Sendeanlagen – relevant für Funkstörungen beim Drohnenflug",
    category: "Karten",
    icon: "wifi",
  },
  {
    title: "LBA Drohnen",
    url: "https://www.lba.de/DE/Drohnen/drohnen_node.html",
    description: "Offizielle Informationen des Luftfahrt-Bundesamtes zu Drohnenregulierung",
    category: "Drohnenrecht",
    icon: "file-text",
  },
  {
    title: "LBA-Leitfaden FG/CV/GRB (PDF)",
    url: "https://www.lba.de/SharedDocs/Downloads/DE/B/B5_UAS/Leitfaden_FG_CV_GRB.pdf?__blob=publicationFile",
    description: "Leitfaden zu Flight Geography, Contingency Volume, Ground Risk Buffer und VLOS/BVLOS-Grenzen (ALOS = 327·CD+20 / 490·CD+30, DLOS = 0,3·GV, GVmax 5 km)",
    category: "Drohnenrecht",
    icon: "file-text",
  },
  {
    title: "EASA Drohnenregeln",
    url: "https://www.easa.europa.eu/en/domains/civil-drones",
    description: "EU-weite Drohnenverordnung und Klassifizierungen (Open, Specific, Certified)",
    category: "Drohnenrecht",
    icon: "globe",
  },
  {
    title: "EASA Drone Rule Navigator",
    url: "https://www.easa.europa.eu/en/drone-rule-navigator",
    description: "Interaktives EASA-Tool, das anhand weniger Fragen die passenden EU-Regeln für deinen Drohnenflug ermittelt",
    category: "Drohnenrecht",
    icon: "compass",
  },
  {
    title: "EASA Geo-Zonen — Where to fly",
    url: "https://www.easa.europa.eu/light/topics/geo-zones-know-where-fly-your-drone",
    description: "Erklärung der UAS-Geozonen und Farblegende (Rot/Gelb/Grün/Blau) der EASA",
    category: "Drohnenrecht",
    icon: "map-pin",
  },
  {
    title: "EASA Offene Kategorie",
    url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/open-category-low-risk-civil-drones",
    description: "Tabelle der offenen Kategorie (Stand 1.1.2024) mit Klassen C0–C4, Unterkategorien A1/A2/A3",
    category: "Drohnenrecht",
    icon: "file-text",
  },
  {
    title: "EASA Spezielle Kategorie",
    url: "https://www.easa.europa.eu/domains/drones-air-mobility/operating-drone/specific-category-civil-drones",
    description: "Wann sie greift, die vier Wege (STS, PDRA, SORA, LUC), Betriebshandbuch und Registrierung",
    category: "Drohnenrecht",
    icon: "file-text",
  },
  {
    title: "EASA Drohnen-Versicherung",
    url: "https://www.easa.europa.eu/light/topics/drone-insurance",
    description: "EU-Vorgaben und nationale Hinweise zur Haftpflichtversicherung für Drohnen",
    category: "Drohnenrecht",
    icon: "shield",
  },
  {
    title: "EASA Reisen mit Drohnen",
    url: "https://www.easa.europa.eu/light/topics/travelling-drones",
    description: "Anerkennung von Registrierung & Kompetenznachweis in EASA-Staaten, nationale Zusatzregeln",
    category: "Drohnenrecht",
    icon: "navigation",
  },
  {
    title: "EASA FPV & Drohnenrennen",
    url: "https://www.easa.europa.eu/light/topics/drone-racing-and-flying-drone-goggles-first-person-view-fpv",
    description: "Regeln für den Flug mit FPV-Brille (Spotter-Pflicht) und Drohnenrennen",
    category: "Drohnenrecht",
    icon: "eye",
  },
  {
    title: "EASA Liste zugelassener Drohnen",
    url: "https://www.easa.europa.eu/en/domains/drones-air-mobility/drones-evtol-designs/approved-drones-eu-operations",
    description: "Drohnen mit C-Klassenkennzeichnung (C0–C6) für den EU-Betrieb",
    category: "Drohnenrecht",
    icon: "check-square",
  },
  {
    title: "EASA Drohnen-FAQ",
    url: "https://www.easa.europa.eu/the-agency/faqs/drones-uas",
    description: "Häufige Fragen zu Kategorien, Registrierung, Kompetenznachweisen und Geo-Zonen",
    category: "Drohnenrecht",
    icon: "help-circle",
  },
];

export const resourceCategories: ResourceCategory[] = [
  "Luftraum & NOTAMs",
  "Naturschutz",
  "Wetter",
  "Karten",
  "Drohnenrecht",
];

export function getLinksByCategory(category: ResourceCategory): ResourceLink[] {
  return resourceLinks.filter((link) => link.category === category);
}
