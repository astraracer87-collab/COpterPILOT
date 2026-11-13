export interface LuZoneFeature {
  identifier: string;
  name: string;
  type: string;
  restriction: LuRestrictionType;
  reason: string[];
  applicability: LuApplicability[];
  zoneAuthority: LuAuthority[];
  geometry: LuGeometry[];
  message?: string;
}

export type LuRestrictionType = "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL" | "NO_RESTRICTION";

export interface LuApplicability {
  startDateTime: string;
  endDateTime: string;
  permanent: "YES" | "NO";
}

export interface LuAuthority {
  name: string;
  email: string;
  phone: string;
  purpose: "AUTHORIZATION" | "NOTIFICATION" | "INFORMATION";
}

export interface LuGeometry {
  upperLimit: number;
  lowerLimit: number;
  uomDimensions: string;
  upperVerticalReference: string;
  lowerVerticalReference: string;
  horizontalProjection: {
    type: string;
    coordinates: number[][][];
  };
}

export const LU_DAC_CONTACT = {
  name: "Direction de l'Aviation Civile (DAC)",
  nameDE: "Direktion der Zivilluftfahrt (DAC)",
  emailGeneral: "uas@av.etat.lu",
  emailTraining: "uas.training@av.etat.lu",
  emailZones: "uas.zones@av.etat.lu",
  emailAdmin: "civilair@av.etat.lu",
  phone: "+352247824 80",
  web: "https://dac.gouvernement.lu/en/drones.html",
  geozonesWeb: "https://dac.gouvernement.lu/en/drones/geozones.html",
  geozonesMap: "https://g-o.lu/uas",
  geoportail: "https://map.geoportail.lu/theme/drones",
  jsonFeed: "https://drones.geoportail.lu/zones",
  quickGuideDe: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-de.pdf",
  quickGuideEn: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-eng.pdf",
  openData: "https://data.public.lu/en/datasets/uas-geographical-zones-grand-duchy-of-luxembourg-zones-geographiques-uas-grand-duche-de-luxembourg/",
  registrationPortal: "https://guichet.public.lu",
};

export const LU_LEGAL_FRAMEWORK = {
  euRegulation: "EU 2019/947 & EU 2019/945",
  nationalLaw: "Loi du 20 décembre 2024",
  ministerialRegulation: "Règlement ministériel du 16 décembre 2020",
  article: "Article 15 EU 2019/947",
  maxPenalty: "Bis zu 1 Jahr Freiheitsstrafe und 5.000 € Geldstrafe",
  insuranceMandatory: true,
};

export const LU_ZONE_COLORS: Record<string, { label: string; description: string; color: string }> = {
  red: {
    label: "Rot — Aktiv",
    description: "Zone ist aktiv. UAS-Flug verboten bzw. nur mit Genehmigung.",
    color: "#FF3B30",
  },
  yellow: {
    label: "Gelb — Demnächst aktiv",
    description: "Zone ist noch inaktiv, wird aber in Kürze aktiviert.",
    color: "#FF9500",
  },
  grey: {
    label: "Grau — Inaktiv",
    description: "Zone existiert, ist aber derzeit nicht aktiv. Bei Aktivierung gelten die Beschränkungen.",
    color: "#8E8E93",
  },
};

export const LU_RESTRICTION_LABELS: Record<LuRestrictionType, { label: string; description: string; severity: "rot" | "gelb" | "grau" }> = {
  PROHIBITED: {
    label: "Verboten",
    description: "Jeglicher UAS-Betrieb ist in dieser Zone untersagt.",
    severity: "rot",
  },
  REQ_AUTHORISATION: {
    label: "Genehmigungspflichtig",
    description: "UAS-Betrieb nur mit vorheriger Genehmigung der zuständigen Behörde.",
    severity: "rot",
  },
  CONDITIONAL: {
    label: "Unter Auflagen / Meldepflichtig",
    description: "UAS-Betrieb unter bestimmten Bedingungen oder nach vorheriger Meldung möglich.",
    severity: "gelb",
  },
  NO_RESTRICTION: {
    label: "Keine Einschränkung",
    description: "Keine besonderen Einschränkungen in dieser Zone.",
    severity: "grau",
  },
};

export const LU_REASON_LABELS: Record<string, string> = {
  AIR_TRAFFIC: "Flugverkehr",
  SENSITIVE: "Sensibles Gebiet",
  POPULATION: "Bevölkerungsschutz",
  NATURE: "Naturschutz",
  MILITARY: "Militärisch",
  PRIVACY: "Privatsphäre",
  AERO: "Flugplatz",
  OTHER: "Sonstige",
};

export const LU_OPEN_CATEGORY_RULES = [
  { id: "max_alt", label: "Maximale Flughöhe: 120 m AGL" },
  { id: "vlos", label: "VLOS: Drohne muss jederzeit in Sichtweite sein" },
  { id: "max_dist", label: "Maximale Entfernung: 500 m zum Piloten" },
  { id: "registration", label: "Registrierung als Betreiber bei MyGuichet.lu" },
  { id: "cert_a1a3", label: "EU-Kompetenznachweis A1/A3 (online)" },
  { id: "insurance", label: "Haftpflichtversicherung obligatorisch (seit Gesetz 20.12.2024)" },
  { id: "no_crowds", label: "Überflug von Menschenansammlungen verboten (Offene Kategorie)" },
  { id: "geo_awareness", label: "Geo-Awareness-Datei vor jedem Flug aktualisieren (C1/C2/C3)" },
];

export const LU_DISTANCES = {
  airport: { name: "Luxembourg International Airport (ELLX)", distanceKm: 5, description: "5 km Abstand zum Flughafen Findel" },
  heliports: { distanceKm: 2, description: "2 km Abstand zu Hubschrauberlandeplätzen" },
  airfields: { distanceKm: 2, description: "2 km Abstand zu Flugplätzen" },
};

export const LU_PERMANENT_ZONES = [
  { id: "EL-UAS-S1", name: "Findel Airport (ELLX) — 0-50m", restriction: "PROHIBITED" as const, type: "Flughafen" },
  { id: "EL-UAS-S2", name: "Findel Airport (ELLX) — 50-120m", restriction: "REQ_AUTHORISATION" as const, type: "Flughafen" },
  { id: "EL-UAS-S3", name: "Palais Grand-Ducal Luxembourg", restriction: "PROHIBITED" as const, type: "Sensibel" },
  { id: "EL-UAS-S4", name: "Château de Berg (Residenz)", restriction: "PROHIBITED" as const, type: "Sensibel" },
  { id: "EL-UAS-S5", name: "Château de Fischbach (Residenz)", restriction: "PROHIBITED" as const, type: "Sensibel" },
  { id: "EL-UAS-S12", name: "Centre Pénitentiaire Uerschterhaff", restriction: "PROHIBITED" as const, type: "Sensibel/Bevölkerungsschutz" },
  { id: "EL-UAS-S16", name: "Militärgelände (Armée Luxembourgeoise)", restriction: "REQ_AUTHORISATION" as const, type: "Militärisch" },
  { id: "EL-UAS-S18", name: "Permanente Beschränkungszone (neu)", restriction: "PROHIBITED" as const, type: "Sensibel" },
];

export const LU_JSON_FEED_URL = "https://drones.geoportail.lu/zones";

export interface LuZonesFeed {
  title: string;
  description: string;
  features: LuZoneFeature[];
}

function isPointInPolygon(lat: number, lon: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    const intersect = ((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function polygonCenter(coords: number[][]): [number, number] {
  let latSum = 0, lonSum = 0;
  for (const c of coords) { lonSum += c[0]; latSum += c[1]; }
  return [latSum / coords.length, lonSum / coords.length];
}

function pointToSegmentDistKm(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  if (dx === 0 && dy === 0) return haversineKm(pLat, pLon, aLat, aLon);
  let t = ((pLon - aLon) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  const projLat = aLat + t * dy;
  const projLon = aLon + t * dx;
  return haversineKm(pLat, pLon, projLat, projLon);
}

function pointToPolygonEdgeDistKm(lat: number, lon: number, coords: number[][]): number {
  let minDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = pointToSegmentDistKm(lat, lon, coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export async function fetchLuZonesFeed(): Promise<LuZonesFeed | null> {
  try {
    const resp = await fetch(LU_JSON_FEED_URL, { headers: { Accept: "application/json" } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export interface LuNearbyZone {
  identifier: string;
  name: string;
  restriction: LuRestrictionType;
  restrictionLabel: string;
  reasons: string[];
  reasonLabels: string[];
  authority: LuAuthority | null;
  heightRange: string;
  isActive: boolean;
  isPermanent: boolean;
  startDate?: string;
  endDate?: string;
  distanceKm: number;
  isInside: boolean;
  message?: string;
}

function isZoneActiveNow(applicability: LuApplicability[]): boolean {
  const now = Date.now();
  for (const a of applicability) {
    const start = new Date(a.startDateTime).getTime();
    const end = new Date(a.endDateTime).getTime();
    if (now >= start && now <= end) return true;
  }
  return false;
}

export function findNearbyLuZones(
  lat: number,
  lon: number,
  radiusKm: number,
  feed: LuZonesFeed,
): LuNearbyZone[] {
  const results: LuNearbyZone[] = [];
  const seen = new Set<string>();

  for (const feat of feed.features) {
    if (seen.has(feat.identifier)) continue;

    for (const geo of feat.geometry) {
      const coords = geo.horizontalProjection?.coordinates?.[0];
      if (!coords || coords.length === 0) continue;

      const isInside = isPointInPolygon(lat, lon, coords);
      const edgeDist = isInside ? 0 : pointToPolygonEdgeDistKm(lat, lon, coords);
      const isNearby = isInside || edgeDist <= radiusKm;

      if (!isNearby) continue;

      seen.add(feat.identifier);

      const restrictionInfo = LU_RESTRICTION_LABELS[feat.restriction] || LU_RESTRICTION_LABELS.NO_RESTRICTION;
      const active = isZoneActiveNow(feat.applicability);
      const perm = feat.applicability.some(a => a.permanent === "YES");
      const authority = feat.zoneAuthority.length > 0 ? feat.zoneAuthority[0] : null;

      results.push({
        identifier: feat.identifier,
        name: feat.name,
        restriction: feat.restriction,
        restrictionLabel: restrictionInfo.label,
        reasons: feat.reason,
        reasonLabels: feat.reason.map(r => LU_REASON_LABELS[r] || r),
        authority,
        heightRange: `${geo.lowerLimit}–${geo.upperLimit} m ${geo.upperVerticalReference}`,
        isActive: active,
        isPermanent: perm,
        startDate: feat.applicability[0]?.startDateTime,
        endDate: feat.applicability[0]?.endDateTime,
        distanceKm: edgeDist,
        isInside,
        message: feat.message,
      });
      break;
    }
  }

  results.sort((a, b) => {
    const severityOrder: Record<LuRestrictionType, number> = { PROHIBITED: 0, REQ_AUTHORISATION: 1, CONDITIONAL: 2, NO_RESTRICTION: 3 };
    const sa = severityOrder[a.restriction] ?? 99;
    const sb = severityOrder[b.restriction] ?? 99;
    if (sa !== sb) return sa - sb;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.distanceKm - b.distanceKm;
  });

  return results;
}

export function getLuRestrictionColor(restriction: LuRestrictionType, isActive: boolean): string {
  if (!isActive) return LU_ZONE_COLORS.grey.color;
  switch (restriction) {
    case "PROHIBITED": return LU_ZONE_COLORS.red.color;
    case "REQ_AUTHORISATION": return LU_ZONE_COLORS.red.color;
    case "CONDITIONAL": return LU_ZONE_COLORS.yellow.color;
    default: return LU_ZONE_COLORS.grey.color;
  }
}

export const LU_IMPORTANT_WARNING = "Die Geozonen-Daten des Drohnenherstellers auf der Fernsteuerung decken NICHT unbedingt alle Beschränkungsgebiete Luxemburgs ab. Nur die Zonen auf g-o.lu/uas sind rechtlich verbindlich.";
