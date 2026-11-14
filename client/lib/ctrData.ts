import {
  DFS_CTR_HEIGHT_STEPS,
  DFS_ZONEN_HEIGHT_STEPS,
  DFS_ZONEN_EFFECTIVE_DATE_ISO,
  DFS_ZONEN_EFFECTIVE_NOTE,
  isDfsZonenEffective,
  isDfsAipGeometryComplete,
  LEGACY_50M_HEIGHT_STEPS,
  DFS_CTR_MAX_HEIGHT_AGL_M,
  describeHeightSteps,
  getCtrClearance,
  getCtrInnerRadiusKm,
  type CtrClearanceResult,
  type CtrHeightStep,
} from "./ctrAltitude";

export type CtrCategory = "dfs" | "das" | "austro_control" | "triac" | "regional" | "military";

/**
 * Welches Regelmodell für die Allgemeinverfügung gilt.
 * - "dfs2026zonen": 4-Zonen-Modell (NfL 2026-1-3960, gültig ab 06.08.2026) an
 *   den 15 Flughäfen mit DFS-Flugplatzkontrolle.
 * - "dfs2026": flaches Außen-/Innenbereich-Modell (NfL 2026-1-3884).
 * - "legacy50m": bisherige 50-m-Allgemeinverfügung.
 */
export type CtrModel = "dfs2026zonen" | "dfs2026" | "legacy50m";

/**
 * Konditionen der pauschalen Flugverkehrskontrollfreigabe in einer CTR.
 *
 * NEUES DFS-MODELL (`model: "dfs2026"`, NfL 2026-1-3884 / 2026-1-3885, BMV, in
 * Kraft seit 24.04.2026): Die CTR ist in Außen-/Innenbereich geteilt; im
 * Außenbereich gilt einheitlich max. 100 m AGL mit pauschaler Freigabe, im
 * Innenbereich (und über 100 m) ist eine Einzelfreigabe nötig. Es gibt KEINE
 * distanzabhängige Höhenstaffel; die exakte Innen-/Außen-Geometrie je CTR steht
 * im AIP GERMANY (schrittweise Umstellung bis Herbst 2026).
 *
 * LEGACY-MODELL (`model: "legacy50m"`): bisherige 50-m-Allgemeinverfügung,
 * solange eine CTR noch nicht auf das neue BMV-Modell umgestellt ist.
 *
 * Die distanzbasierte Logik liegt RN-frei in ./ctrAltitude.ts.
 */
export interface CtrAvInfo {
  model: CtrModel;
  nflReference: string;
  provider: string;
  pdfUrl: string;
  /** Distanz→Höhe-Staffelung; ein Band mit 0 m = Innenbereich. */
  heightSteps: CtrHeightStep[];
  /**
   * True für das neue DFS-Modell: die exakte Innen-/Außen-Geometrie je CTR wird
   * im AIP GERMANY bekanntgegeben (Umstellung bis Herbst 2026), die
   * distanzbasierte Grenze ist daher eine Näherung. Steuert den AIP-Hinweis in
   * der UI. Die Rahmenbedingungen (NfL 2026-1-3884) selbst sind offiziell.
   */
  geometryPerAip: boolean;
  /**
   * True, solange die distanzbasierten Höhenbänder eine Näherung sind, weil die
   * exakte Innen-/Außen-Geometrie je CTR noch nicht im AIP GERMANY veröffentlicht
   * ist (neues DFS-Modell, Umstellung bis Herbst 2026). Steuert die
   * "vorläufig"-Kennzeichnung der CTR-Bänder in den Karten. Für das Legacy-Modell
   * (feste 50-m-AV) sind die Werte endgültig, daher false.
   */
  provisional: boolean;
  minVisibilityKm: number;
  /** Nur Legacy-Modell – das neue Modell kennt keine Wolkenuntergrenze-Pflicht. */
  minCeilingFt?: number;
  /** Legacy- und 4-Zonen-Modell (NfL 2026-1-3960: 5 kg Flugmodelle / 25 kg UAS). */
  maxMtomKgModel?: number;
  maxMtomKgUas?: number;
  /** ISO-Datum, ab dem die Regelung gilt (nur wenn in der Zukunft relevant). */
  effectiveFromIso?: string;
  /** Anzeige-Hinweis zum Stichtag (z. B. „gültig ab 6.8.2026“). */
  effectiveNote?: string;
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
  /**
   * Flugplatzhöhe (Aerodrome Elevation) in m MSL – Bezugswert der Zonenhöhen
   * im 4-Zonen-Modell (NfL 2026-1-3960, „über Flugplatzhöhe“).
   */
  elevationM?: number;
}

// NfL-Referenzen des neuen DFS-Modells (BMV, in Kraft seit 24.04.2026, gilt ab
// sofort in allen CTR deutscher Flugplätze). Die exakte Innen-/Außen-Geometrie
// je CTR wird im AIP GERMANY schrittweise bis Herbst 2026 bekanntgegeben.
export const DFS_NFL_2026_DFS = "NfL 2026-1-3884";
export const DFS_NFL_2026_DAS = "NfL 2026-1-3885";

// Finale, offiziell veröffentlichte NfL-PDFs auf dipul (Stand Juni 2026).
const DFS_NFL_3884_PDF_URL =
  "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/nfl-2026-1-3884.pdf?cid=6cw";
const DFS_NFL_3885_PDF_URL =
  "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/nfl-2026-1-3885.pdf?cid=6cz";

// NfL 2026-1-3960: 4-Zonen-Modell an den 15 Flughäfen mit DFS-Flugplatz-
// kontrolle, gültig ab 06.08.2026; hebt die NfL 2023-1-2705 auf.
export const DFS_NFL_2026_ZONEN = "NfL 2026-1-3960";
const DFS_ZONEN_INFO_URL =
  "https://www.dfs.de/homepage/de/drohnenflug/antraege-und-genehmigungen/";

export const AV_DFS: CtrAvInfo = {
  model: "dfs2026zonen",
  nflReference: DFS_NFL_2026_ZONEN,
  provider: "DFS Deutsche Flugsicherung GmbH",
  pdfUrl: DFS_ZONEN_INFO_URL,
  heightSteps: DFS_ZONEN_HEIGHT_STEPS,
  geometryPerAip: true,
  provisional: true,
  minVisibilityKm: 0.8,
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
  effectiveFromIso: DFS_ZONEN_EFFECTIVE_DATE_ISO,
  effectiveNote: DFS_ZONEN_EFFECTIVE_NOTE,
};

export const AV_DAS: CtrAvInfo = {
  model: "dfs2026",
  // Der UAS-Betrieb der DAS-kontrollierten CTR folgt denselben BMV-Grundsätzen
  // (NfL 2026-1-3884); 2026-1-3885 regelt ergänzend den BOS-Betrieb.
  nflReference: DFS_NFL_2026_DFS,
  provider: "DFS Aviation Services GmbH (DAS)",
  pdfUrl: DFS_NFL_3884_PDF_URL,
  heightSteps: DFS_CTR_HEIGHT_STEPS,
  geometryPerAip: true,
  provisional: true,
  minVisibilityKm: 0.8,
};

export const AV_AUSTRO_CONTROL: CtrAvInfo = {
  model: "legacy50m",
  nflReference: "NfL 2024-1-3081",
  provider: "Austro Control GmbH",
  pdfUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-austro-control-gmbh-nfl-2024-1-3081.pdf?cid=3b6",
  // Austro Control hat das neue BMV-Modell (noch) nicht übernommen; bis zur
  // Umstellung gilt weiterhin die bestehende 50-m-Allgemeinverfügung.
  heightSteps: LEGACY_50M_HEIGHT_STEPS,
  geometryPerAip: false,
  provisional: false,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
};

export const AV_TRIAC: CtrAvInfo = {
  model: "legacy50m",
  nflReference: "NfL 2024-1-3082",
  provider: "TRIAC",
  pdfUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-triac-oberpfaffenhofen-nfl-2024-1-3082.pdf?cid=3k3",
  // Noch nicht auf das neue BMV-Modell umgestellt; bisherige 50-m-AV gilt weiter.
  heightSteps: LEGACY_50M_HEIGHT_STEPS,
  geometryPerAip: false,
  provisional: false,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
  maxMtomKgModel: 5,
  maxMtomKgUas: 25,
};

// BOS-Einsatz (Polizei/Rettung) in CTR – NfL 2026-1-3885 hebt 2025-1-3658 auf.
export const BOS_NFL_REFERENCE = "NfL 2026-1-3885";
export const BOS_PDF_URL = DFS_NFL_3885_PDF_URL;

export const DFS_AV_REFERENCE = AV_DFS.nflReference;
export const DFS_PORTAL_URL = "https://uas-betrieb.dfs.de";

export const CTR_AIRPORTS: CtrAirport[] = [
  { icao: "EDDB", name: "Berlin Brandenburg (BER)", elevationM: 47, category: "dfs", towerPhone: "+49 30 6091 58610", towerFrequency: "118.800", note: "Sehr gro\u00dfe CTR; Stadtgebiet Berlin betroffen.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 52.3667, lon: 13.5033 },
  { icao: "EDDW", name: "Bremen", elevationM: 4, category: "dfs", towerPhone: "+49 421 53720", towerFrequency: "121.050", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 53.0475, lon: 8.7867 },
  { icao: "EDDC", name: "Dresden", elevationM: 230, category: "dfs", towerPhone: "+49 351 88250", towerFrequency: "130.100", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 51.1328, lon: 13.7672 },
  { icao: "EDDL", name: "D\u00fcsseldorf", elevationM: 45, category: "dfs", towerPhone: "+49 211 41540", towerFrequency: "118.300", note: "Enge Abstimmung mit DUS-Airport n\u00f6tig.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 51.2895, lon: 6.7668 },
  { icao: "EDDE", name: "Erfurt-Weimar", elevationM: 316, category: "dfs", towerPhone: "+49 341 46670", towerFrequency: "118.200", note: "Remote Tower Control via Leipzig.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 50.9798, lon: 10.9581 },
  { icao: "EDDF", name: "Frankfurt/Main", elevationM: 111, category: "dfs", towerPhone: "+49 69 69623000", towerFrequency: "119.900", note: "Strikte \u00dcberwachung; Innen-/Au\u00dfenbereich je CTR im AIP GERMANY beachten.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 50.0379, lon: 8.5622 },
  { icao: "EDDH", name: "Hamburg", elevationM: 16, category: "dfs", towerPhone: "+49 40 507117100", towerFrequency: "118.600", note: "Gro\u00dfe Teile der City sind CTR.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 53.6304, lon: 9.9882 },
  { icao: "EDDV", name: "Hannover", elevationM: 55, category: "dfs", towerPhone: "+49 511 7797101", towerFrequency: "123.000", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 52.4611, lon: 9.6850 },
  { icao: "EDDK", name: "K\u00f6ln/Bonn", elevationM: 92, category: "dfs", towerPhone: "+49 2203 5707111", towerFrequency: "124.975", note: "Nachtflugbetrieb beachten!", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 50.8659, lon: 7.1427 },
  { icao: "EDDP", name: "Leipzig/Halle", elevationM: 142, category: "dfs", towerPhone: "+49 341 46670", towerFrequency: "120.500", note: "Hohes Frachtaufkommen nachts. RTC-Zentrum f\u00fcr Erfurt & Saarbr\u00fccken.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 51.4324, lon: 12.2416 },
  { icao: "EDDM", name: "M\u00fcnchen", elevationM: 448, category: "dfs", towerPhone: "+49 89 9780371", towerFrequency: "121.725", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 48.3538, lon: 11.7861 },
  { icao: "EDDG", name: "M\u00fcnster/Osnabr\u00fcck", elevationM: 48, category: "dfs", towerPhone: "+49 2571 93950", towerFrequency: "118.425", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 52.1346, lon: 7.6848 },
  { icao: "EDDN", name: "N\u00fcrnberg", elevationM: 318, category: "dfs", towerPhone: "+49 911 360590", towerFrequency: "118.350", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 49.4987, lon: 11.0669 },
  { icao: "EDDR", name: "Saarbr\u00fccken", elevationM: 322, category: "dfs", towerPhone: "+49 341 46670", towerFrequency: "125.250", note: "Remote Tower Control via Leipzig.", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 49.2146, lon: 7.1095 },
  { icao: "EDDS", name: "Stuttgart", elevationM: 389, category: "dfs", towerPhone: "+49 711 72257101", towerFrequency: "118.800", hasAllgemeinverfuegung: true, avReference: AV_DFS.nflReference, avInfo: AV_DFS, lat: 48.6899, lon: 9.2220 },

  { icao: "EDLW", name: "Dortmund", category: "das", towerPhone: "+49 231 9213 140", towerFrequency: "121.800", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 51.5183, lon: 7.6122 },
  { icao: "EDSB", name: "Karlsruhe/Baden-Baden", category: "das", towerPhone: "+49 7229 66 2345", towerFrequency: "118.300", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 48.7793, lon: 8.0805 },
  { icao: "EDJA", name: "Memmingen", category: "das", towerPhone: "+49 8331 98451 0", towerFrequency: "120.800", note: "Neues DFS-Modell (Au\u00dfen-/Innenbereich) analog DFS.", hasAllgemeinverfuegung: true, avReference: AV_DAS.nflReference, avInfo: AV_DAS, lat: 47.9888, lon: 10.2395 },
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

/**
 * Näherungsweiser lateraler Radius einer CTR. Die exakte CTR-Geometrie je
 * Flugplatz steht im AIP GERMANY; bis zur vollständigen Umstellung (Herbst 2026)
 * nutzen wir einen konservativen Einheitsradius, um zu bestimmen, ob ein
 * Flugstandort innerhalb einer Kontrollzone liegt (für den CTR-Wetternachweis).
 */
export const CTR_LATERAL_RADIUS_KM = 15;

/**
 * Bestimmt den für einen Flugstandort zuständigen CTR-Flughafen, sofern der
 * Standort innerhalb einer Kontrollzone (Näherung über CTR_LATERAL_RADIUS_KM)
 * liegt. Es werden nur CTR mit hinterlegter Allgemeinverfügung (avInfo)
 * berücksichtigt, da der Wetternachweis deren VMC-Bedingungen prüft. Gibt den
 * nächstgelegenen passenden Flughafen zurück oder null (kein CTR-Flug).
 */
export function findCtrForLocation(
  lat: number,
  lon: number,
  radiusKm: number = CTR_LATERAL_RADIUS_KM,
): CtrAirport | null {
  const nearby = findNearbyCtrAirports(lat, lon, radiusKm).filter((a) => !!a.avInfo);
  return nearby.length > 0 ? nearby[0] : null;
}

/**
 * Ergebnis der VMC-Prüfung der CTR-Flughafen-METAR gegen die in der
 * Allgemeinverfügung festgelegten Mindestbedingungen (Sicht + ggf.
 * Wolkenuntergrenze im Legacy-Modell).
 */
export interface CtrVmcResult {
  /** true = erfüllt, false = nicht erfüllt, null = nicht verifizierbar (Daten fehlen). */
  compliant: boolean | null;
  /** Geforderte Mindestsicht in Metern. */
  minVisibilityM: number;
  /** Geforderte Mindest-Wolkenuntergrenze in Fuß (nur Legacy-Modell), sonst null. */
  minCeilingFt: number | null;
  /** Gemeldete Sicht/Wolkenuntergrenze aus der METAR. */
  actualVisibilityM: number | null;
  actualCeilingFt: number | null;
  /** Klartext-Begründungen, warum die Bedingungen (nicht) erfüllt sind. */
  reasons: string[];
}

function formatVisMeters(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    return `${Number.isInteger(km) ? String(km) : km.toFixed(1).replace(".", ",")} km`;
  }
  return `${Math.round(m)} m`;
}

/**
 * Prüft die gemeldeten METAR-Werte des CTR-Flughafens gegen die VMC-Bedingungen
 * der Allgemeinverfügung. Reine Logik (React-Native-frei, testbar).
 */
export function assessCtrVmc(
  actual: { visibilityM: number | null; ceilingFt: number | null },
  avInfo: CtrAvInfo,
): CtrVmcResult {
  const minVisibilityM = Math.round(avInfo.minVisibilityKm * 1000);
  const minCeilingFt = avInfo.model === "legacy50m" ? avInfo.minCeilingFt ?? null : null;
  const reasons: string[] = [];

  let visOk: boolean | null = null;
  if (actual.visibilityM != null) {
    visOk = actual.visibilityM >= minVisibilityM;
    if (visOk) {
      reasons.push(
        `Sicht ${formatVisMeters(actual.visibilityM)} erfüllt Mindestsicht ${formatVisibility(avInfo.minVisibilityKm)}`,
      );
    } else {
      reasons.push(
        `Sicht ${formatVisMeters(actual.visibilityM)} unter Mindestsicht ${formatVisibility(avInfo.minVisibilityKm)}`,
      );
    }
  } else {
    reasons.push("Keine Sichtangabe in der METAR – Mindestsicht nicht verifizierbar");
  }

  let ceilOk: boolean | null = null;
  if (minCeilingFt != null) {
    if (actual.ceilingFt != null) {
      ceilOk = actual.ceilingFt >= minCeilingFt;
      if (ceilOk) {
        reasons.push(`Wolkenuntergrenze ${actual.ceilingFt} ft erfüllt Minimum ${minCeilingFt} ft`);
      } else {
        reasons.push(`Wolkenuntergrenze ${actual.ceilingFt} ft unter Minimum ${minCeilingFt} ft`);
      }
    } else {
      // Keine geschlossene/durchbrochene Wolkendecke (BKN/OVC) gemeldet -> keine
      // einschränkende Untergrenze.
      ceilOk = true;
      reasons.push(`Keine begrenzende Wolkenuntergrenze gemeldet (Minimum ${minCeilingFt} ft)`);
    }
  }

  let compliant: boolean | null;
  if (visOk === false || ceilOk === false) {
    compliant = false;
  } else if (visOk === true && (minCeilingFt == null || ceilOk === true)) {
    compliant = true;
  } else {
    compliant = null;
  }

  return {
    compliant,
    minVisibilityM,
    minCeilingFt,
    actualVisibilityM: actual.visibilityM,
    actualCeilingFt: actual.ceilingFt,
    reasons,
  };
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

/**
 * Liefert die Innen-/Außenbereich-Freigabe für eine konkrete Distanz (km) zur
 * Flughafen-Referenz auf Basis der je AV hinterlegten Höhenstaffelung.
 */
export function getCtrClearanceForAirport(
  distanceKm: number,
  avInfo: CtrAvInfo,
): CtrClearanceResult {
  return getCtrClearance(distanceKm, avInfo.heightSteps, avInfo.geometryPerAip);
}

/**
 * Liefert die Auflagen/Bedingungen einer Allgemeinverfügung als Textzeilen.
 * Verzweigt nach Modell: das neue BMV-Modell (dfs2026) nach NfL 2026-1-3884,
 * das Legacy-50-m-Modell für noch nicht umgestellte CTR.
 */
export function getAvConditionsText(avInfo: CtrAvInfo): string[] {
  if (avInfo.model === "dfs2026zonen") {
    // Offizielle Bedingungen nach NfL 2026-1-3960 (gültig ab 06.08.2026, nur
    // an den 15 Flughäfen mit DFS-Flugplatzkontrolle; hebt NfL 2023-1-2705 auf).
    return [
      // Stichtags-Zeile nur VOR dem 6.8.2026 anzeigen (danach überflüssig).
      ...(isDfsZonenEffective()
        ? []
        : ["G\u00fcltig ab 6.8.2026 \u2013 bis 5.8.2026 gilt die bisherige Regelung"]),
      "Zone 1 (Flughafenbereich + 1-km/5-km-Bereich): IMMER individuelle FVK-Freigabe der DFS (Vorlauf i. d. R. 14 Tage); f\u00fcr offene Kategorie zus\u00e4tzlich Genehmigung der Landesluftfahrtbeh\u00f6rde (\u00a7 21i LuftVO)",
      "Zone 2 (bis 4 km um den Flugplatzbezugspunkt): max. 25 m \u00fcber Grund oder \u00fcber Flugplatzh\u00f6he \u2013 der niedrigere Wert z\u00e4hlt",
      "Zone 3 (bis 6 km): max. 45 m \u00fcber Grund oder \u00fcber Flugplatzh\u00f6he \u2013 der niedrigere Wert z\u00e4hlt",
      "Zone 4 (restliche CTR): 100 m \u00fcber Flugplatzh\u00f6he oder 50 m \u00fcber Grund \u2013 der h\u00f6here Wert z\u00e4hlt (EU-Grenze 120 m bleibt)",
      `Bodensicht: mind. ${formatVisibility(avInfo.minVisibilityKm)} laut offizieller Flugplatzwettermeldung (nicht gesch\u00e4tzt)`,
      `Max. Startmasse: ${avInfo.maxMtomKgModel ?? 5} kg Flugmodelle / ${avInfo.maxMtomKgUas ?? 25} kg UAS`,
      "Hindernisnahe Fl\u00fcge: max. 30 m seitlich und 15 m \u00fcber dem Hindernis auch \u00fcber den Zonenh\u00f6hen zul\u00e4ssig",
      "BVLOS- und Schwarmfl\u00fcge im CTR-Au\u00dfenbereich von der allgemeinen Freigabe umfasst (Betriebsgenehmigungen bleiben erforderlich)",
      "Vollautonome Fl\u00fcge nicht zul\u00e4ssig (Fernpilot muss eingreifen k\u00f6nnen)",
      "Zonen-Geometrie je Flughafen: Erg\u00e4nzungen zur AIP GERMANY und dipul",
      "\u00a7 21h LuftVO, NOTAMs und alle weiteren EU-Drohnenregeln gelten zus\u00e4tzlich",
    ];
  }
  if (avInfo.model === "dfs2026") {
    // Offizielle Bedingungen nach NfL 2026-1-3884 (BMV, 24.04.2026).
    return [
      `Au\u00dfenbereich (bis ${DFS_CTR_MAX_HEIGHT_AGL_M} m AGL): pauschale Flugverkehrskontrollfreigabe per Allgemeinverf\u00fcgung m\u00f6glich`,
      "Innenbereich und \u00fcber 100 m AGL: individuelle Flugverkehrskontrollfreigabe erforderlich",
      "Max. H\u00f6he: 100 m \u00fcber Flugplatzh\u00f6he/Grund (der niedrigere Wert gilt)",
      `Mindestsichtweite: ${formatVisibility(avInfo.minVisibilityKm)} (au\u00dfer nahe Hindernissen und bei individueller Freigabe)`,
      "Fl\u00fcge bis 30 m lateral und 15 m vertikal an einem Hindernis grunds\u00e4tzlich zul\u00e4ssig",
      "BVLOS zul\u00e4ssig, sofern die Position des UA jederzeit bekannt ist",
      "Schwarmfl\u00fcge zul\u00e4ssig (Kollisionsvermeidung durch den Betreiber)",
      "Vollautonome Fl\u00fcge nicht zul\u00e4ssig",
      "Keine Staffelung und keine Verkehrsinformation durch die Flugsicherung",
      ...(isDfsAipGeometryComplete()
        ? []
        : ["Innen-/Au\u00dfenbereich je CTR: siehe AIP GERMANY (Umstellung bis Herbst 2026)"]),
    ];
  }
  // Legacy-50-m-Allgemeinverfügung (noch nicht umgestellte CTR).
  return [
    "Au\u00dfenbereich (> 1,5 km): pauschale Freigabe bis 50 m AGL ohne Einzelantrag",
    "Innenbereich (< 1,5 km) oder \u00fcber 50 m: Einzelfreigabe (DFS-Portal/Tower) erforderlich",
    `Bodensicht: mind. ${avInfo.minVisibilityKm} km`,
    `Wolkenuntergrenze: mind. ${avInfo.minCeilingFt ?? 1500} ft AGL`,
    `Max. MTOM Flugmodell: ${avInfo.maxMtomKgModel ?? 5} kg`,
    `Max. MTOM UAS: ${avInfo.maxMtomKgUas ?? 25} kg`,
    "Kein Formationsflug",
    "Kein vollautonomer Betrieb",
    "VLOS (Sichtverbindung) jederzeit",
    "Bei au\u00dfer Kontrolle geratenem UAS: Sofort Tower melden",
  ];
}

function formatVisibility(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  const v = Number.isInteger(km) ? String(km) : String(km).replace(".", ",");
  return `${v} km`;
}

/** Detail-Zeilen zur Höhenstaffelung einer AV (für aufklappbare UI-Bereiche). */
export function getCtrHeightStepLines(avInfo: CtrAvInfo): string[] {
  return describeHeightSteps(avInfo.heightSteps);
}

export { getCtrInnerRadiusKm, DFS_CTR_MAX_HEIGHT_AGL_M };
export type { CtrClearanceResult, CtrHeightStep };

// Neues 4-Zonen-Modell (NfL 2026-1-3960, gültig ab 06.08.2026): gilt nur in den
// CTR der 15 Flughäfen mit DFS-Flugplatzkontrolle. Die frühere Außen-/Innen-
// bereich-Darstellung (NfL 2026-1-3884) wird dort abgelöst.
export const CTR_AREA_RULES = {
  zone1: {
    label: "Zone 1",
    range: "Flughafenbereich + 1-km-/5-km-Bereich (\u00a7 21h Abs. 3 Nr. 2 LuftVO)",
    status:
      "Immer individuelle FVK-Freigabe der DFS (Vorlauf i. d. R. 14 Tage); offene Kategorie zus\u00e4tzlich Genehmigung der Landesluftfahrtbeh\u00f6rde (\u00a7 21i)",
  },
  zone2: {
    label: "Zone 2",
    range: "Bis 4 km um den Flugplatzbezugspunkt",
    status: "Max. 25 m \u00fcber Grund oder \u00fcber Flugplatzh\u00f6he \u2013 der niedrigere Wert z\u00e4hlt",
  },
  zone3: {
    label: "Zone 3",
    range: "Bis 6 km um den Flugplatzbezugspunkt",
    status: "Max. 45 m \u00fcber Grund oder \u00fcber Flugplatzh\u00f6he \u2013 der niedrigere Wert z\u00e4hlt",
  },
  zone4: {
    label: "Zone 4",
    range: "Restliche Kontrollzone",
    status:
      "100 m \u00fcber Flugplatzh\u00f6he oder 50 m \u00fcber Grund \u2013 der h\u00f6here Wert z\u00e4hlt (EU-Grenze 120 m bleibt)",
  },
  andere: {
    label: "Andere Flugpl\u00e4tze",
    range: "CTR ohne DFS-Flugplatzkontrolle (z. B. DAS-Regionalflugh\u00e4fen)",
    status:
      "Es gelten die Regelungen/Allgemeinverf\u00fcgungen der jeweils zust\u00e4ndigen Flugsicherung (siehe AV-Angabe der CTR)",
  },
};

/**
 * Modellabh\u00e4ngiger Geometrie-/G\u00fcltigkeitshinweis f\u00fcr CTR-Karten und
 * Info-Cards (Mobile + Web nutzen denselben Text, damit nichts driftet).
 */
/**
 * Datumsgesteuerter Stichtags-Hinweis einer AV: liefert effectiveNote nur,
 * solange der Stichtag (effectiveFromIso) noch nicht erreicht ist. Ab dem
 * Stichtag null – der "gültig ab"-Hinweis entfällt automatisch.
 */
export function getCtrEffectiveNote(
  avInfo?: CtrAvInfo,
  now: Date = new Date(),
): string | null {
  if (!avInfo?.effectiveNote) return null;
  if (avInfo.effectiveFromIso) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    if (`${y}-${m}-${d}` >= avInfo.effectiveFromIso) return null;
  }
  return avInfo.effectiveNote;
}

export function getCtrGeometryHint(avInfo?: CtrAvInfo): string | null {
  if (!avInfo) return null;
  if (avInfo.model === "dfs2026zonen") {
    return isDfsZonenEffective()
      ? "Zonen-Geometrie je Flughafen: Erg\u00e4nzungen zur AIP GERMANY und dipul (NfL 2026-1-3960). Kreise in der App sind eine N\u00e4herung."
      : "Zonen-Geometrie je Flughafen: Erg\u00e4nzungen zur AIP GERMANY und dipul \u2014 NfL 2026-1-3960 g\u00fcltig ab 6.8.2026 (bis dahin bisherige Regelung). Kreise in der App sind eine N\u00e4herung.";
  }
  if (avInfo.model === "dfs2026" && avInfo.geometryPerAip) {
    return isDfsAipGeometryComplete()
      ? "Innen-/Au\u00dfenbereich-Geometrie je CTR: siehe AIP GERMANY."
      : "Innen-/Au\u00dfenbereich-Geometrie vorl\u00e4ufig \u2014 siehe AIP GERMANY (Umstellung bis Herbst 2026).";
  }
  return null;
}

/**
 * @deprecated Altes 50-m-AV-Modell (Zone A/B/C). Bleibt als Alias auf
 * CTR_AREA_RULES erhalten, damit bestehende Aufrufer nicht brechen. Neue UI
 * soll CTR_AREA_RULES verwenden.
 */
export const CTR_ZONE_RULES = CTR_AREA_RULES;
