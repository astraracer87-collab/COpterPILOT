export type EdrSeverity = "rot" | "gelb";
export type EdrCategory = "berlin" | "energie" | "forschung" | "wartburg" | "militaer" | "kerntechnisch";

export interface EdrZone {
  id: string;
  name: string;
  category: EdrCategory;
  severity: EdrSeverity;
  lat: number;
  lon: number;
  radiusKm?: number;
  avCovered: boolean;
  avReference?: string;
  operatorName?: string;
  note?: string;
}

export const EDR_146_CENTER = { lat: 52.5186, lon: 13.3761 };
export const EDR_146_RADIUS_KM = 5.556;
export const EDR_146_INNER_RADIUS_NM = 1;
export const EDR_146_INNER_RADIUS_KM = 1.852;

export const BAF_CONTACT = {
  name: "Bundesaufsichtsamt für Flugsicherung (BAF)",
  referat: "Luftraum, Flugverfahren und Recht (LFR)",
  address: "Robert-Bosch-Straße 28, 63225 Langen",
  emailGeneral: "drohne@baf.bund.de",
  emailEdr146: "ed-r@baf.bund.de",
  phone: "+496103707290",
  web: "https://www.baf.bund.de",
  edrInfoUrl: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/Flugbeschraenkungsgebiete_UAS_node.html",
  edr146Url: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/ED-R146_Berlin/ED-R146_Berlin_node.html",
  avEnergieUrl: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/AV_ED-R_Energie-Forschung-Wartburg/AV_ED-R_Energie-Forschung-Wartburg_node.html",
  antragsformularUrl: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/Antraege_Durchflug/Antraege_Durchflug_node.html",
};

export const POLIZEI_BERLIN = {
  name: "Lagezentrum Polizei Berlin (Dauerdienst)",
  phone: "+49304664707110",
  phoneDisplay: "(030) 4664-707110",
  vorlaufStunden: 2,
};

export const EDR_146_NFL = {
  verwaltungsverfahren: "NfL 2024-1-3128",
  verwaltungsverfahrenPdf: "https://www.baf.bund.de/SharedDocs/Downloads/DE/Publikationen_BAF/NfL/NfL_2024-1-3128_EDRBerlin.pdf?__blob=publicationFile&v=2",
  avUas: "NfL 2024-1-3127",
  avUasPdf: "https://www.baf.bund.de/SharedDocs/Downloads/DE/Publikationen_BAF/NfL/NfL_2024-1-3127_EDRBerlin_UAS.pdf?__blob=publicationFile&v=2",
  avUasDipul: "https://dipul.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ed-r-146-berlin-zur-erteilung-von-durchfluggenehmigungen-nfl-2024-1-3127.pdf?cid=3be",
  lubbUrl: "http://www.lbv.brandenburg.de/3348.htm",
};

export const EDR_ENERGIE_NFL = {
  reference: "NfL 2025-1-3652",
  pdf: "https://www.baf.bund.de/SharedDocs/Downloads/DE/Publikationen_BAF/NfL/NfL_1_2025-3652.pdf?__blob=publicationFile&v=5",
  dipul: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugbeschraenkungsgebiete-ed-r/allgemeinverfuegung-uas-in-verschiedenen-ed-r-zum-schutz-von-energie-rueckbau-und-forschungsanlagen-sowie-der-wartburg-nfl-2025-1-3652.pdf?cid=5ay",
};

export const EDR_AV_CONDITIONS = [
  { id: "open_cat", label: "Betrieb nur in der offenen Kategorie (EU 2019/947)" },
  { id: "daylight", label: "Betrieb nur bei Tageslicht und Sichtflugbedingungen (VMC)" },
  { id: "max_alt", label: "Maximale Flughöhe 50 m über Grund (AGL)" },
  { id: "distance", label: "Mindestabstand zur Anlage: 200 m horizontal" },
  { id: "info", label: "Fernpilot hat sich über die genaue Lage der Anlage informiert" },
  { id: "remote_id", label: "Drohne sendet aktive Fernidentifizierung (Remote-ID)" },
];

export const EDR_AV_EXCLUSIONS = [
  "Flüge zu Hobby-/Freizeitzwecken",
  "Flüge höher als 50 m AGL",
  "Flüge mit Drohnen über 25 kg",
  "Betreiber der Anlage hat nicht zugestimmt",
];

export const EDR_ZONES: EdrZone[] = [
  { id: "146", name: "ED-R 146 Berlin (Regierungsviertel)", category: "berlin", severity: "rot", lat: 52.5186, lon: 13.3761, radiusKm: 5.556, avCovered: false, note: "Strengste Überwachung. Innerer Kreis (1 NM): Einzelgenehmigung nur bei zwingendem Erfordernis. Äußerer Kreis (2./3. NM): AV NfL 2024-1-3127 unter Auflagen möglich." },
  { id: "1", name: "ED-R 1 Garching (Forschungsreaktor)", category: "forschung", severity: "gelb", lat: 48.2490, lon: 11.6710, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "TU München (FRM II)" },
  { id: "3", name: "ED-R 3 Geesthacht/Krümmel", category: "kerntechnisch", severity: "gelb", lat: 53.4103, lon: 10.4090, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "Vattenfall" },
  { id: "4", name: "ED-R 4 Wannsee", category: "forschung", severity: "rot", lat: 52.4128, lon: 13.1267, avCovered: false, note: "Nicht von AV NfL 2025-1-3652 erfasst — Einzelgenehmigung BAF erforderlich" },
  { id: "5", name: "ED-R 5 Biblis (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 49.7114, lon: 8.4114, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "RWE" },
  { id: "6", name: "ED-R 6 Brokdorf (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 53.8500, lon: 9.3450, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra" },
  { id: "7", name: "ED-R 7 Brunsbüttel (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 53.8914, lon: 9.1990, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "Vattenfall" },
  { id: "8", name: "ED-R 8 Emsland (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 52.4733, lon: 7.3183, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra/RWE" },
  { id: "23", name: "ED-R 23 Grafenrheinfeld (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 49.9833, lon: 10.1850, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra" },
  { id: "24", name: "ED-R 24 Grohnde (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 52.0350, lon: 9.4117, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra" },
  { id: "25", name: "ED-R 25 Gundremmingen (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 48.5150, lon: 10.4017, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra" },
  { id: "27", name: "ED-R 27 Isar (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 48.6064, lon: 12.2914, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra" },
  { id: "38", name: "ED-R 38 Neckarwestheim (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 49.0417, lon: 9.1750, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "EnBW" },
  { id: "39", name: "ED-R 39 Obrigheim (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 49.3650, lon: 9.0750, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "EnBW" },
  { id: "40", name: "ED-R 40 Philippsburg (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 49.2517, lon: 8.4350, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "EnBW" },
  { id: "41", name: "ED-R 41 Unterweser (Kernkraftwerk)", category: "kerntechnisch", severity: "gelb", lat: 53.4300, lon: 8.4767, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "PreussenElektra" },
  { id: "90", name: "ED-R 90 Wartburg (Kulturdenkmal)", category: "wartburg", severity: "gelb", lat: 50.9667, lon: 10.3050, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "Stiftung Wartburg" },
  { id: "111", name: "ED-R 111 Jülich (Forschungszentrum)", category: "forschung", severity: "gelb", lat: 50.9067, lon: 6.3617, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "Forschungszentrum Jülich" },
  { id: "133", name: "ED-R 133 Karlsruhe (Forschungszentrum)", category: "forschung", severity: "gelb", lat: 49.0950, lon: 8.4317, avCovered: true, avReference: EDR_ENERGIE_NFL.reference, operatorName: "KIT" },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface Edr146ProximityResult {
  isInside: boolean;
  isInnerCircle: boolean;
  distanceKm: number;
}

export function checkEdr146Proximity(lat: number, lon: number): Edr146ProximityResult {
  const dist = haversineKm(lat, lon, EDR_146_CENTER.lat, EDR_146_CENTER.lon);
  return {
    isInside: dist <= EDR_146_RADIUS_KM,
    isInnerCircle: dist <= EDR_146_INNER_RADIUS_KM,
    distanceKm: dist,
  };
}

export function findNearbyEdrZones(lat: number, lon: number, radiusKm: number): EdrZone[] {
  return EDR_ZONES.filter((z) => {
    const dist = haversineKm(lat, lon, z.lat, z.lon);
    const zoneRadius = z.radiusKm || 5;
    return dist <= radiusKm + zoneRadius;
  });
}

export function getEdrSeverityLabel(s: EdrSeverity): string {
  return s === "rot" ? "Einzelgenehmigung erforderlich" : "Allgemeinverfügung möglich";
}

export function getEdrSeverityColor(s: EdrSeverity): string {
  return s === "rot" ? "#FF3B30" : "#FF9500";
}

export function getEdrCategoryLabel(c: EdrCategory): string {
  switch (c) {
    case "berlin": return "Regierungsviertel";
    case "energie": return "Energieanlage";
    case "forschung": return "Forschungsanlage";
    case "wartburg": return "Kulturdenkmal";
    case "militaer": return "Militärisch";
    case "kerntechnisch": return "Kerntechnische Anlage";
  }
}

export const EDR_LEGAL_WARNING = {
  paragraph: "§ 62 LuftVG",
  shortText: "Einflug ohne Genehmigung ist eine Straftat",
  longText: "Ein Einflug in ein Flugbeschränkungsgebiet (ED-R) ohne die erforderliche Durchfluggenehmigung stellt nach § 62 LuftVG einen Straftatbestand dar. Die Ermittlungen werden durch die zuständige Staatsanwaltschaft durchgeführt.",
};
