export type CtrCategory = "dfs" | "das" | "austro_control" | "triac" | "regional" | "military";

export interface CtrAvInfo {
  nflReference: string;
  provider: string;
  pdfUrl: string;
  minDistanceM: number;
  maxHeightM: number;
  minVisibilityKm: number;
  minCeilingFt: number;
  exclusionZone: "circle_1500m" | "rectangle_4km_2_5km";
  maxMtomKgModel: number;
  maxMtomKgUas: number;
}

export interface CtrAirport {
  icao: string;
  name: string;
  category: CtrCategory;
  towerPhone: string;
  towerFrequency?: string;
  note?: string;
  hasAllgemeinverfuegung: boolean;
  avReference?: string;
  avInfo?: CtrAvInfo;
  lat: number;
  lon: number;
}

export const AV_DFS: CtrAvInfo = {
  nflReference: "NfL 2023-1-2705",
  provider: "DFS Deutsche Flugsicherung GmbH",
  pdfUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-dfs-deutsche-flugsicherung-gmbh-nfl-2023-1-2705.pdf?cid=3b5",
  minDistanceM: 1500,
  maxHeightM: 50,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
  exclusionZone: "circle_1500m",
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
};

export const AV_DAS: CtrAvInfo = {
  nflReference: "NfL 2022-1-2670",
  provider: "DFS Aviation Services GmbH (DAS)",
  pdfUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-dfs-aviation-services-gmbh-nfl-2022-1-2670.pdf?cid=3b2",
  minDistanceM: 1500,
  maxHeightM: 50,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
  exclusionZone: "circle_1500m",
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
};

export const AV_AUSTRO_CONTROL: CtrAvInfo = {
  nflReference: "NfL 2024-1-3081",
  provider: "Austro Control GmbH",
  pdfUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-austro-control-gmbh-nfl-2024-1-3081.pdf?cid=3b6",
  minDistanceM: 1500,
  maxHeightM: 50,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
  exclusionZone: "rectangle_4km_2_5km",
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
};

export const AV_TRIAC: CtrAvInfo = {
  nflReference: "NfL 2024-1-3082",
  provider: "TRIAC",
  pdfUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-triac-oberpfaffenhofen-nfl-2024-1-3082.pdf?cid=3k3",
  minDistanceM: 1500,
  maxHeightM: 50,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
  exclusionZone: "rectangle_4km_2_5km",
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
};

export const BOS_NFL_REFERENCE = "NfL 2025-1-3658";
export const BOS_PDF_URL = "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/einsatz-von-unbemannten-luftfahrzeugsystemen-durch-bos-in-kontrollzonen-nfl-2025-1-3658.pdf?cid=5b7";

export const DFS_AV_REFERENCE = AV_DFS.nflReference;
export const DFS_PORTAL_URL = "https://uas-betrieb.dfs.de";

export const CTR_AIRPORTS: CtrAirport[] = [
  { icao: "EDDB", name: "Berlin Brandenburg (BER)", category: "dfs", towerPhone: "+49 30 6091 58610", towerFrequency: "118.800", note: "Sehr gro\u00dfe CTR; Stadtgebiet Berlin betroffen.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 52.3667, lon: 13.5033 },
  { icao: "EDDW", name: "Bremen", category: "dfs", towerPhone: "+49 421 53720", towerFrequency: "121.050", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 53.0475, lon: 8.7867 },
  { icao: "EDDC", name: "Dresden", category: "dfs", towerPhone: "+49 351 88250", towerFrequency: "130.100", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 51.1328, lon: 13.7672 },
  { icao: "EDDL", name: "D\u00fcsseldorf", category: "dfs", towerPhone: "+49 211 41540", towerFrequency: "118.300", note: "Enge Abstimmung mit DUS-Airport n\u00f6tig.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 51.2895, lon: 6.7668 },
  { icao: "EDDE", name: "Erfurt-Weimar", category: "dfs", towerPhone: "+49 341 46670", towerFrequency: "118.200", note: "Remote Tower Control via Leipzig.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 50.9798, lon: 10.9581 },
  { icao: "EDDF", name: "Frankfurt/Main", category: "dfs", towerPhone: "+49 69 69623000", towerFrequency: "119.900", note: "Strikte \u00dcberwachung; keine Toleranz bei >50m.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 50.0379, lon: 8.5622 },
  { icao: "EDDH", name: "Hamburg", category: "dfs", towerPhone: "+49 40 507117100", towerFrequency: "118.600", note: "Gro\u00dfe Teile der City sind CTR.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 53.6304, lon: 9.9882 },
  { icao: "EDDV", name: "Hannover", category: "dfs", towerPhone: "+49 511 7797101", towerFrequency: "123.000", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 52.4611, lon: 9.6850 },
  { icao: "EDDK", name: "K\u00f6ln/Bonn", category: "dfs", towerPhone: "+49 2203 5707111", towerFrequency: "124.975", note: "Nachtflugbetrieb beachten!", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 50.8659, lon: 7.1427 },
  { icao: "EDDP", name: "Leipzig/Halle", category: "dfs", towerPhone: "+49 341 46670", towerFrequency: "120.500", note: "Hohes Frachtaufkommen nachts. RTC-Zentrum f\u00fcr Erfurt & Saarbr\u00fccken.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 51.4324, lon: 12.2416 },
  { icao: "EDDM", name: "M\u00fcnchen", category: "dfs", towerPhone: "+49 89 9780371", towerFrequency: "121.725", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 48.3538, lon: 11.7861 },
  { icao: "EDDG", name: "M\u00fcnster/Osnabr\u00fcck", category: "dfs", towerPhone: "+49 2571 93950", towerFrequency: "118.425", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 52.1346, lon: 7.6848 },
  { icao: "EDDN", name: "N\u00fcrnberg", category: "dfs", towerPhone: "+49 911 360590", towerFrequency: "118.350", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 49.4987, lon: 11.0669 },
  { icao: "EDDR", name: "Saarbr\u00fccken", category: "dfs", towerPhone: "+49 341 46670", towerFrequency: "125.250", note: "Remote Tower Control via Leipzig.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 49.2146, lon: 7.1095 },
  { icao: "EDDS", name: "Stuttgart", category: "dfs", towerPhone: "+49 711 72257101", towerFrequency: "118.800", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 48.6899, lon: 9.2220 },

  { icao: "EDLW", name: "Dortmund", category: "das", towerPhone: "+49 231 9213 140", towerFrequency: "121.800", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 51.5183, lon: 7.6122 },
  { icao: "EDSB", name: "Karlsruhe/Baden-Baden", category: "das", towerPhone: "+49 7229 66 2345", towerFrequency: "118.300", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 48.7793, lon: 8.0805 },
  { icao: "EDJA", name: "Memmingen", category: "das", towerPhone: "+49 8331 98451 0", towerFrequency: "120.800", note: "\u00c4hnlich DFS (50m Regel).", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 47.9888, lon: 10.2395 },
  { icao: "EDLN", name: "M\u00f6nchengladbach", category: "das", towerPhone: "+49 2161 69060", towerFrequency: "129.050", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 51.2306, lon: 6.5044 },
  { icao: "EDLV", name: "Niederrhein (Weeze)", category: "das", towerPhone: "+49 2837 66 1210", towerFrequency: "120.300", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 51.6024, lon: 6.1422 },
  { icao: "EDLP", name: "Paderborn/Lippstadt", category: "das", towerPhone: "+49 2955 77 0", towerFrequency: "120.850", note: "Flugleitung kontaktieren.", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 51.6141, lon: 8.6163 },
  { icao: "EDNY", name: "Friedrichshafen", category: "das", towerPhone: "+49 7541 284 120", towerFrequency: "120.425", note: "Bodensee-Sonderregelungen.", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 47.6713, lon: 9.5115 },
  { icao: "EDVE", name: "Braunschweig", category: "das", towerPhone: "+49 531 35440 0", towerFrequency: "120.550", note: "Forschungsflughafen (oft NOTAMs).", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 52.3192, lon: 10.5561 },

  { icao: "EDMA", name: "Augsburg", category: "austro_control", towerPhone: "+49 821 270 1611", towerFrequency: "128.400", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, lat: 48.4253, lon: 10.9317 },
  { icao: "EDAH", name: "Heringsdorf (Usedom)", category: "austro_control", towerPhone: "+49 38376 2900", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, note: "Saisonaler Flugbetrieb.", lat: 53.8787, lon: 14.1523 },
  { icao: "EDHL", name: "L\u00fcbeck", category: "austro_control", towerPhone: "+49 451 5830 200", towerFrequency: "119.600", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, lat: 53.8054, lon: 10.7192 },
  { icao: "EDQM", name: "Hof/Plauen", category: "austro_control", towerPhone: "+49 9288 96070", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, lat: 50.2886, lon: 11.8564 },
  { icao: "EDVK", name: "Kassel-Calden", category: "austro_control", towerPhone: "+49 5674 9299 0", towerFrequency: "119.250", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, lat: 51.4083, lon: 9.3777 },
  { icao: "EDXW", name: "Sylt (Westerland)", category: "austro_control", towerPhone: "+49 4651 920 100", towerFrequency: "118.100", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, lat: 54.9132, lon: 8.3414 },
  { icao: "EDFH", name: "Frankfurt-Hahn", category: "austro_control", towerPhone: "+49 6543 50 9222", towerFrequency: "119.850", hasAllgemeinverfuegung: true, avReference: AV_AUSTRO_CONTROL.nflReference, avInfo: AV_AUSTRO_CONTROL, lat: 49.9487, lon: 7.2639 },

  { icao: "EDMO", name: "Oberpfaffenhofen", category: "triac", towerPhone: "+49 8153 28 2505", towerFrequency: "120.075", note: "Werksflughafen DLR/Airbus.", hasAllgemeinverfuegung: true, avReference: AV_TRIAC.nflReference, avInfo: AV_TRIAC, lat: 48.0814, lon: 11.2831 },

  { icao: "ETNW", name: "Wunstorf", category: "military", towerPhone: "+49 5031 41 2422", note: "A400M Basis; sehr aktiv.", hasAllgemeinverfuegung: false, lat: 52.4572, lon: 9.4272 },
  { icao: "ETSI", name: "Ingolstadt/Manching", category: "military", towerPhone: "+49 8459 81 4541", note: "Testflughafen Airbus.", hasAllgemeinverfuegung: false, lat: 48.7156, lon: 11.5340 },
  { icao: "ETNH", name: "Hohn", category: "military", towerPhone: "+49 4331 951 2210", hasAllgemeinverfuegung: false, lat: 54.3122, lon: 9.5382 },
  { icao: "ETNL", name: "Laage", category: "military", towerPhone: "+49 38454 31 160", note: "Eurofighter-Basis.", hasAllgemeinverfuegung: false, lat: 53.9182, lon: 12.2703 },
  { icao: "ETSN", name: "Neuburg a.d. Donau", category: "military", towerPhone: "+49 8431 64 2400", note: "Alarmrotte-Standort.", hasAllgemeinverfuegung: false, lat: 48.7110, lon: 11.2115 },
  { icao: "ETWM", name: "Wittmundhafen", category: "military", towerPhone: "+49 4462 919 2501", hasAllgemeinverfuegung: false, lat: 53.5478, lon: 7.6673 },
  { icao: "ETGK", name: "Geilenkirchen", category: "military", towerPhone: "+49 2451 63 2340", note: "NATO AWACS (Strikte Sperre).", hasAllgemeinverfuegung: false, lat: 50.9608, lon: 6.0424 },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearbyCtrAirports(
  lat: number,
  lon: number,
  radiusKm: number = 20,
): CtrAirport[] {
  const seen = new Set<string>();
  return CTR_AIRPORTS.filter((a) => {
    if (seen.has(a.icao)) return false;
    const inRange = haversineKm(lat, lon, a.lat, a.lon) <= radiusKm;
    if (inRange) seen.add(a.icao);
    return inRange;
  }).sort((a, b) => haversineKm(lat, lon, a.lat, a.lon) - haversineKm(lat, lon, b.lat, b.lon));
}

export function getCtrDistanceKm(lat: number, lon: number, airport: CtrAirport): number {
  return haversineKm(lat, lon, airport.lat, airport.lon);
}

export function getCtrCategoryLabel(cat: CtrCategory): string {
  switch (cat) {
    case "dfs":
      return "DFS-Kontrollzone";
    case "das":
      return "DAS-Kontrollzone";
    case "austro_control":
      return "Austro Control-Kontrollzone";
    case "triac":
      return "TRIAC-Kontrollzone";
    case "regional":
      return "Regionale Kontrollzone";
    case "military":
      return "Milit\u00e4rische Kontrollzone";
  }
}

export function getCtrCategoryColor(cat: CtrCategory): string {
  switch (cat) {
    case "dfs":
      return "#FF9500";
    case "das":
      return "#FF9500";
    case "austro_control":
      return "#FF9500";
    case "triac":
      return "#FF9500";
    case "regional":
      return "#FF9500";
    case "military":
      return "#FF3B30";
  }
}

export function getCtrProviderName(cat: CtrCategory): string {
  switch (cat) {
    case "dfs":
      return "DFS Deutsche Flugsicherung GmbH";
    case "das":
      return "DFS Aviation Services GmbH";
    case "austro_control":
      return "Austro Control GmbH";
    case "triac":
      return "TRIAC";
    case "regional":
      return "Regionale Flugsicherung";
    case "military":
      return "Milit\u00e4rische Flugsicherung";
  }
}

export function getAvConditionsText(avInfo: CtrAvInfo): string[] {
  const zoneDesc = avInfo.exclusionZone === "circle_1500m"
    ? `Mindestabstand ${avInfo.minDistanceM / 1000} km zur Flugplatzgrenze`
    : "Sperrzone: Rechteck 4 km ab Pistenende, 2,5 km seitlich zur Pistenmittellinie";
  return [
    `Max. Flugh\u00f6he: ${avInfo.maxHeightM} m AGL`,
    `Bodensicht: mind. ${avInfo.minVisibilityKm} km`,
    `Wolkenuntergrenze: mind. ${avInfo.minCeilingFt} ft AGL`,
    zoneDesc,
    `Max. MTOM Flugmodell: ${avInfo.maxMtomKgModel} kg`,
    `Max. MTOM UAS: ${avInfo.maxMtomKgUas} kg`,
    "Kein Formationsflug",
    "Kein vollautonomer Betrieb",
    "VLOS (Sichtverbindung) jederzeit",
    "Bei au\u00dfer Kontrolle geratenem UAS: Sofort Tower melden",
  ];
}

export const CTR_ZONE_RULES = {
  zoneA: {
    label: "Zone A (Sperrbereich)",
    range: "0 \u2013 1.500 m ab Flughafenzaun",
    status: "Einzelgenehmigung via DFS-Portal oder Tower zwingend n\u00f6tig",
  },
  zoneB: {
    label: "Zone B (Freigabebereich)",
    range: "1.500 m bis CTR-Grenze",
    status: "Erlaubt bis 50 m H\u00f6he, au\u00dferhalb der An-/Abflugsektoren",
  },
  zoneC: {
    label: "Zone C (H\u00f6hen\u00fcberschreitung)",
    range: "> 50 m H\u00f6he in der gesamten CTR",
    status: "Telefonische Freigabe oder Online-Antrag (DFS-Portal) erforderlich",
  },
};
