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
    title: "EASA Drohnenregeln",
    url: "https://www.easa.europa.eu/en/domains/civil-drones",
    description: "EU-weite Drohnenverordnung und Klassifizierungen (Open, Specific, Certified)",
    category: "Drohnenrecht",
    icon: "globe",
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
