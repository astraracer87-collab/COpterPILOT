import type { DipulTempRestriction, DipulTempRestrictionsResult } from "@/lib/geozones";
import { pointInPolygon } from "@/lib/geozones";
import { calculateSolarTimes } from "@/lib/solar";
import { computeFlightWindow, flightWindowSampleTimes } from "../../shared/flightWindow";
import lfaGeoJson from "@/data/lfa-de.json";

/**
 * Official German military daytime low-flight areas
 * ("Tieffluege mit militaerischen Luftfahrzeugen am Tage ueber Land").
 *
 * Polygon outlines are derived from the official dipul.de UAS-Geozonen data
 * (DFS / BMV). They replace the previous coarse hand-drawn approximations.
 *
 * Source references:
 *   Info page:  https://www.dipul.de/homepage/de/informationen/geografische-gebiete/
 *   Map tool:   https://maptool-dipul.dfs.de/?language=de
 *   WMS layer:  https://uas-betrieb.de/geoservices/dipul/wms
 *               (layer "temporaere_betriebseinschraenkungen")
 *
 * To refresh the bundled outlines:
 *   1. Open the dipul MapTool and enable "Temporaere Betriebseinschraenkungen".
 *   2. Export the affected polygons via the official KML/SHAPE-ZIP download
 *      from the dipul WMS service.
 *   3. Convert to GeoJSON and replace the `ringLatLon` arrays below, then
 *      bump MIL_LOW_FLIGHT_DATA_STAND to the dipul "Stand" date.
 *
 * Real-time activation is derived from live DIPUL temporary restrictions /
 * NOTAMs in deriveMilLowFlightStatuses() — the bundled polygons describe the
 * geometry, not the activation window.
 */

export const MIL_LOW_FLIGHT_LABEL = "Militärisches Tieffluggebiet (Tag)";
export const MIL_LOW_FLIGHT_SOURCE_URL =
  "https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/tieffluege-mit-militaerischen-luftfahrzeugen-am-tage-ueber-land/";
/**
 * Effective date ("Stand") of the bundled dipul outlines. Surface this in the
 * UI alongside the source attribution so pilots can judge data freshness.
 */
export const MIL_LOW_FLIGHT_DATA_STAND = "2026-04-18";
export const MIL_LOW_FLIGHT_ACTIVATION_TEXT =
  "täglich von Sonnenaufgang bis Sonnenuntergang";

/** Human-readable label of the data source for footnotes / info banners. */
export const MIL_LOW_FLIGHT_SOURCE_LABEL = "dipul.de – UAS-Geozonen (DFS / BMV)";
/** General dipul info page on UAS geographical zones. */
export const MIL_LOW_FLIGHT_INFO_URL =
  "https://www.dipul.de/homepage/de/informationen/geografische-gebiete/";
/** Public dipul MapTool URL (interactive viewer). */
export const MIL_LOW_FLIGHT_MAP_TOOL_URL =
  "https://maptool-dipul.dfs.de/?language=de";
/** Public dipul WMS endpoint that backs the MapTool overlay. */
export const MIL_LOW_FLIGHT_WMS_URL =
  "https://uas-betrieb.de/geoservices/dipul/wms";
/** WMS layer name carrying the temporary operational restrictions. */
export const MIL_LOW_FLIGHT_WMS_LAYER = "temporaere_betriebseinschraenkungen";

export const MIL_LOW_FLIGHT_COLOR = "#7B8B3A";
export const MIL_LOW_FLIGHT_FILL = "rgba(123,139,58,0.18)";
export const MIL_LOW_FLIGHT_STROKE = "rgba(123,139,58,0.85)";

export interface MilLowFlightArea {
  id: string;
  name: string;
  shortName: string;
  region: string;
  description: string;
  ringLatLon: [number, number][];
  matchTokens?: string[];
}

export interface MilLowFlightActivation {
  /** Erläuterungstext für die Aktivierungsregel (UI). */
  note: string;
}

/**
 * Aktivierungsregel für militärische Tieffluggebiete:
 * Alle LFAs gelten täglich von Sonnenaufgang bis Sonnenuntergang als aktiv.
 * Wochentage und feste Uhrzeiten werden bewusst nicht mehr verwendet — die
 * Tageslichtzeit wird für die jeweilige Position (oder einen sinnvollen Default)
 * mittels calculateSolarTimes() berechnet.
 */
export const MIL_LOW_FLIGHT_ACTIVATION: MilLowFlightActivation = {
  note: "Militärische Tieffluggebiete sind täglich von Sonnenaufgang bis Sonnenuntergang aktiv.",
};

// Region/Beschreibungs-Metadaten je LFA-ID (ergänzen die generischen Felder
// aus der Bundeswehr-KML). matchTokens werden gegen DIPUL-Restriction-Texte
// geprüft, um Live-Aktivierungen pro LFA zuordnen zu können.
const LFA_META: Record<string, { region: string; description: string; matchTokens: string[] }> = {
  "1": {
    region: "Niedersachsen / Emsland",
    description: "Tieffluggebiet LFA 1 (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 1", "lfa1", "lfa-1"],
  },
  "2": {
    region: "Niederrhein",
    description: "Tieffluggebiet LFA 2 (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 2", "lfa2", "lfa-2"],
  },
  "3": {
    region: "Sauerland / Nordhessen",
    description: "Tieffluggebiet LFA 3 (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 3", "lfa3", "lfa-3"],
  },
  "5": {
    region: "Nordheide",
    description: "Tieffluggebiet LFA 5 (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 5", "lfa5", "lfa-5"],
  },
  "6": {
    region: "Schleswig-Holstein",
    description: "Tieffluggebiet LFA 6 (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 6", "lfa6", "lfa-6"],
  },
  "7": {
    region: "Bayern (Hohenfels-Umfeld)",
    description: "Tieffluggebiet LFA 7 (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 7", "lfa7", "lfa-7"],
  },
  "8a": {
    region: "Mecklenburg-Vorpommern – Sektor a",
    description: "Tieffluggebiet LFA 8a (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 8a", "lfa8a", "lfa-8a"],
  },
  "8b": {
    region: "Mecklenburg-Vorpommern – Sektor b",
    description: "Tieffluggebiet LFA 8b (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 8b", "lfa8b", "lfa-8b"],
  },
  "8c": {
    region: "Mecklenburg-Vorpommern – Sektor c",
    description: "Tieffluggebiet LFA 8c (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 8c", "lfa8c", "lfa-8c"],
  },
  "8d": {
    region: "Mecklenburg-Vorpommern – Sektor d",
    description: "Tieffluggebiet LFA 8d (250 ft AGL) — Bundeswehr-Tiefflug am Tage über Land.",
    matchTokens: ["lfa 8d", "lfa8d", "lfa-8d"],
  },
};

interface LfaFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: { id: string; lfa: string; name: string };
}

// Aus der gebündelten Bundeswehr/Luftwaffe-KML (server/data/lfa-de.kml,
// gespiegelt nach client/data/lfa-de.json über `node scripts/build-lfa.mjs`).
// Die ringLatLon-Reihenfolge ist [Breitengrad, Längengrad] — die KML liefert
// jedoch [Längengrad, Breitengrad], also wird hier umsortiert.
export const MIL_LOW_FLIGHT_AREAS: MilLowFlightArea[] = (lfaGeoJson as { features: LfaFeature[] })
  .features
  .map((f) => {
    const lfa = f.properties.lfa;
    const meta = LFA_META[lfa];
    const ringLatLon = f.geometry.coordinates[0].map(
      ([lon, lat]) => [lat, lon] as [number, number]
    );
    return {
      id: `lfa-${lfa}`,
      name: f.properties.name,
      shortName: `LFA ${lfa.toUpperCase()}`,
      region: meta?.region ?? "Deutschland",
      description: meta?.description ?? f.properties.name,
      matchTokens: meta?.matchTokens ?? [`lfa ${lfa}`],
      ringLatLon,
    } satisfies MilLowFlightArea;
  });

function ringCenter(ring: [number, number][]): { lat: number; lon: number } {
  let sLat = 0;
  let sLon = 0;
  for (const [la, lo] of ring) {
    sLat += la;
    sLon += lo;
  }
  return { lat: sLat / ring.length, lon: sLon / ring.length };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ringMaxRadiusKm(ring: [number, number][], center: { lat: number; lon: number }): number {
  let max = 0;
  for (const [la, lo] of ring) {
    const d = distanceKm(center.lat, center.lon, la, lo);
    if (d > max) max = d;
  }
  return max;
}

export function buildMilLowFlightRestriction(area: MilLowFlightArea): DipulTempRestriction {
  const center = ringCenter(area.ringLatLon);
  return {
    id: `mil-low-flight-${area.id}`,
    extRef: `MIL-TFG-${area.id.toUpperCase()}`,
    name: area.name,
    names: [area.name],
    genNames: [area.region],
    type: "MIL_LOW_FLIGHT_DAY",
    legalRef: "Militärische Tieffluege am Tage über Land (dipul.de)",
    legalExplanation: MIL_LOW_FLIGHT_LABEL,
    category: "military",
    lowerAlt: 0,
    lowerAltRef: "AGL",
    lowerAltUnit: "m",
    upperAlt: 250,
    upperAltRef: "AGL",
    upperAltUnit: "ft",
    status: "active",
    startTs: null,
    endTs: null,
    endTsIndefinite: true,
    recurRules: null,
    centerLat: center.lat,
    centerLon: center.lon,
    radiusM: null,
    polygonRings: [area.ringLatLon],
    kind: "mil_low_flight_day",
  };
}

export function getAllMilLowFlightRestrictions(): DipulTempRestriction[] {
  return MIL_LOW_FLIGHT_AREAS.map(buildMilLowFlightRestriction);
}

export function getNearbyMilLowFlightRestrictions(
  lat: number,
  lon: number,
  radiusKm: number
): DipulTempRestriction[] {
  const result: DipulTempRestriction[] = [];
  for (const area of MIL_LOW_FLIGHT_AREAS) {
    const center = ringCenter(area.ringLatLon);
    const maxR = ringMaxRadiusKm(area.ringLatLon, center);
    if (distanceKm(lat, lon, center.lat, center.lon) <= maxR + radiusKm) {
      result.push(buildMilLowFlightRestriction(area));
    }
  }
  return result;
}

export function findMilLowFlightAreasContaining(
  lat: number,
  lon: number
): DipulTempRestriction[] {
  const result: DipulTempRestriction[] = [];
  for (const area of MIL_LOW_FLIGHT_AREAS) {
    if (pointInPolygon(lat, lon, [area.ringLatLon])) {
      result.push(buildMilLowFlightRestriction(area));
    }
  }
  return result;
}

export function findAreasContainingPoint(
  lat: number,
  lon: number
): MilLowFlightArea[] {
  return MIL_LOW_FLIGHT_AREAS.filter((a) => pointInPolygon(lat, lon, [a.ringLatLon]));
}

function distancePointToSegmentKm(
  lat: number,
  lon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dx = bLon - aLon;
  const dy = bLat - aLat;
  if (dx === 0 && dy === 0) return distanceKm(lat, lon, aLat, aLon);
  const t = Math.max(0, Math.min(1, ((lon - aLon) * dx + (lat - aLat) * dy) / (dx * dx + dy * dy)));
  const projLat = aLat + t * dy;
  const projLon = aLon + t * dx;
  return distanceKm(lat, lon, projLat, projLon);
}

function circleIntersectsRing(
  lat: number,
  lon: number,
  radiusKm: number,
  ring: [number, number][]
): boolean {
  if (pointInPolygon(lat, lon, [ring])) return true;
  for (let i = 0; i < ring.length - 1; i++) {
    const [aLat, aLon] = ring[i];
    const [bLat, bLon] = ring[i + 1];
    if (distancePointToSegmentKm(lat, lon, aLat, aLon, bLat, bLon) <= radiusKm) return true;
  }
  return false;
}

/**
 * Returns mil low-flight areas that the search circle (lat/lon ± radiusKm)
 * intersects. Used for pre-flight briefings where the planned operating radius
 * around a take-off point should trigger a warning even if the take-off pin
 * itself sits just outside the polygon.
 */
export function findMilLowFlightAreasIntersectingRadius(
  lat: number,
  lon: number,
  radiusKm: number
): DipulTempRestriction[] {
  const result: DipulTempRestriction[] = [];
  for (const area of MIL_LOW_FLIGHT_AREAS) {
    if (circleIntersectsRing(lat, lon, radiusKm, area.ringLatLon)) {
      result.push(buildMilLowFlightRestriction(area));
    }
  }
  return result;
}

/**
 * Pre-flight check across a list of route points (e.g. take-off, planned
 * waypoints, return-to-home). Returns every mil low-flight area that contains
 * at least one of the given points. De-duplicated by area id.
 */
export function findMilLowFlightAreasOnRoute(
  points: Array<{ lat: number; lon: number }>
): DipulTempRestriction[] {
  const seen = new Set<string>();
  const result: DipulTempRestriction[] = [];
  for (const p of points) {
    for (const area of MIL_LOW_FLIGHT_AREAS) {
      if (seen.has(area.id)) continue;
      if (pointInPolygon(p.lat, p.lon, [area.ringLatLon])) {
        seen.add(area.id);
        result.push(buildMilLowFlightRestriction(area));
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Real-time activation status (Task #36)
// ---------------------------------------------------------------------------

export type MilLowFlightStatus = "active" | "upcoming" | "inactive";

export interface MilLowFlightAreaStatus {
  area: MilLowFlightArea;
  status: MilLowFlightStatus;
  source: "dipul" | "none";
  match?: DipulTempRestriction;
  startTs?: string | null;
  endTs?: string | null;
  endTsIndefinite?: boolean;
}

function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

function matchAreaAgainstRestriction(area: MilLowFlightArea, r: DipulTempRestriction): boolean {
  if (r.category !== "military") return false;
  const tokens = area.matchTokens || [];
  if (tokens.length > 0) {
    const haystack = normalizeText(
      [r.name, ...(r.names || []), ...(r.genNames || []), r.legalRef].join(" ")
    );
    for (const tok of tokens) {
      if (haystack.includes(normalizeText(tok))) return true;
    }
  }
  // Strikte Polygon-Übereinstimmung: nur wenn das Zentrum der DIPUL-Beschränkung
  // tatsächlich innerhalb des LFA-Polygons liegt, gilt das als Treffer. Der
  // frühere Center-Radius-Fallback war zu großzügig und hat z. B. ED-R Rostock
  // (außerhalb LFA 8a) fälschlich als Aktivierung gezählt.
  if (r.centerLat != null && r.centerLon != null) {
    if (pointInPolygon(r.centerLat, r.centerLon, [area.ringLatLon])) return true;
  }
  return false;
}

export function deriveMilLowFlightStatuses(
  restrictions: DipulTempRestrictionsResult
): MilLowFlightAreaStatus[] {
  return MIL_LOW_FLIGHT_AREAS.map((area) => {
    const activeMatch = restrictions.active.find((r) => matchAreaAgainstRestriction(area, r));
    if (activeMatch) {
      return {
        area,
        status: "active",
        source: "dipul",
        match: activeMatch,
        startTs: activeMatch.startTs,
        endTs: activeMatch.endTs,
        endTsIndefinite: activeMatch.endTsIndefinite,
      };
    }
    const upcomingMatch = restrictions.upcoming.find((r) => matchAreaAgainstRestriction(area, r));
    if (upcomingMatch) {
      return {
        area,
        status: "upcoming",
        source: "dipul",
        match: upcomingMatch,
        startTs: upcomingMatch.startTs,
        endTs: upcomingMatch.endTs,
        endTsIndefinite: upcomingMatch.endTsIndefinite,
      };
    }
    return { area, status: "inactive", source: "none" };
  });
}

export function deriveNearbyMilLowFlightStatuses(
  restrictions: DipulTempRestrictionsResult,
  lat: number,
  lon: number,
  radiusKm: number
): MilLowFlightAreaStatus[] {
  return deriveMilLowFlightStatuses(restrictions).filter((s) => {
    const center = ringCenter(s.area.ringLatLon);
    const maxR = ringMaxRadiusKm(s.area.ringLatLon, center);
    return distanceKm(center.lat, center.lon, lat, lon) <= maxR + radiusKm;
  });
}

/**
 * Classify a list of geographically detected mil low-flight hits (e.g. from
 * findMilLowFlightAreasContaining / ...IntersectingRadius / ...OnRoute) into
 * active/upcoming/inactive buckets using live DIPUL/AUP restrictions.
 *
 * Pre-flight warnings should be raised only for `active` and `upcoming` hits;
 * `inactive` hits are purely informational (geographic overlap with a TFG that
 * has no current/upcoming activation per AUP/UUP/NOTAMs).
 */
export interface ClassifiedMilLowFlightHits {
  active: DipulTempRestriction[];
  upcoming: DipulTempRestriction[];
  inactive: DipulTempRestriction[];
  hot: DipulTempRestriction[];
  statusByAreaId: Record<string, MilLowFlightStatus>;
}

export function classifyMilLowFlightHits(
  hits: DipulTempRestriction[],
  restrictions: DipulTempRestrictionsResult
): ClassifiedMilLowFlightHits {
  const statuses = deriveMilLowFlightStatuses(restrictions);
  const statusByAreaId: Record<string, MilLowFlightStatus> = {};
  for (const s of statuses) statusByAreaId[s.area.id] = s.status;

  const active: DipulTempRestriction[] = [];
  const upcoming: DipulTempRestriction[] = [];
  const inactive: DipulTempRestriction[] = [];

  for (const hit of hits) {
    const areaId = hit.id.startsWith("mil-low-flight-") ? hit.id.slice("mil-low-flight-".length) : hit.id;
    const status = statusByAreaId[areaId] ?? "inactive";
    if (status === "active") active.push(hit);
    else if (status === "upcoming") upcoming.push(hit);
    else inactive.push(hit);
  }

  return { active, upcoming, inactive, hot: [...active, ...upcoming], statusByAreaId };
}

export function getStatusLabel(status: MilLowFlightStatus): string {
  switch (status) {
    case "active":
      return "Aktiv (live)";
    case "upcoming":
      return "Demnächst aktiv";
    case "inactive":
      return "Derzeit nicht aktiv";
  }
}

export function getStatusColor(status: MilLowFlightStatus): string {
  switch (status) {
    case "active":
      return "#FF9500";
    case "upcoming":
      return "#5856D6";
    case "inactive":
      return "#8E8E93";
  }
}

export function getStatusFillColor(status: MilLowFlightStatus): string {
  switch (status) {
    case "active":
      return "rgba(255,149,0,0.20)";
    case "upcoming":
      return "rgba(88,86,214,0.18)";
    case "inactive":
      return "rgba(142,142,147,0.14)";
  }
}

export function getStatusStrokeColor(status: MilLowFlightStatus): string {
  switch (status) {
    case "active":
      return "rgba(255,149,0,0.85)";
    case "upcoming":
      return "rgba(88,86,214,0.80)";
    case "inactive":
      return "rgba(142,142,147,0.65)";
  }
}

/**
 * Returns LFA polygons within `radiusKm` of (lat,lon) AS DipulTempRestriction
 * entries, filtered to those whose REAL activation status (per dipul AUP/UUP
 * matches in `restrictions`) is "active" or "upcoming". The synthetic
 * "always active" entries from `getNearbyMilLowFlightRestrictions` are
 * intentionally NOT used here. This keeps the radar's NOTAM list consistent
 * with the NOTAM map (NotamsScreen).
 */
export function getActiveOrUpcomingNearbyMilLowFlight(
  restrictions: DipulTempRestrictionsResult,
  lat: number,
  lon: number,
  radiusKm: number
): { active: DipulTempRestriction[]; upcoming: DipulTempRestriction[] } {
  const statuses = deriveNearbyMilLowFlightStatuses(restrictions, lat, lon, radiusKm);
  const active: DipulTempRestriction[] = [];
  const upcoming: DipulTempRestriction[] = [];
  for (const s of statuses) {
    if (s.status !== "active" && s.status !== "upcoming") continue;
    const base = buildMilLowFlightRestriction(s.area);
    const entry: DipulTempRestriction = {
      ...base,
      status: s.status,
      startTs: s.startTs ?? base.startTs,
      endTs: s.endTs ?? base.endTs,
      endTsIndefinite: s.endTsIndefinite ?? base.endTsIndefinite,
    };
    if (s.status === "active") active.push(entry);
    else upcoming.push(entry);
  }
  return { active, upcoming };
}

export function buildMilLowFlightStatusMap(
  statuses: MilLowFlightAreaStatus[]
): Record<string, MilLowFlightAreaStatus> {
  const map: Record<string, MilLowFlightAreaStatus> = {};
  for (const s of statuses) {
    map[`mil-low-flight-${s.area.id}`] = s;
  }
  return map;
}

export function formatActivationWindow(s: MilLowFlightAreaStatus): string | null {
  if (s.source !== "dipul" || !s.startTs) return null;
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  };
  const start = new Date(s.startTs).toLocaleString("de-DE", opts);
  if (!s.endTs || s.endTsIndefinite) return `ab ${start} UTC`;
  const end = new Date(s.endTs).toLocaleString("de-DE", opts);
  return `${start} – ${end} UTC`;
}

/**
 * Convenience helper for the UI: a single line describing data provenance
 * suitable for footnotes / info banners.
 *
 * Example:
 *   "Quelle: dipul.de – UAS-Geozonen (DFS / BMV), Stand 2026-04-18"
 */
export function getMilLowFlightAttribution(): string {
  return `Quelle: ${MIL_LOW_FLIGHT_SOURCE_LABEL}, Stand ${MIL_LOW_FLIGHT_DATA_STAND}`;
}

export interface LatLon {
  latitude: number;
  longitude: number;
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return false;
  const s = ((cx - ax) * d2y - (cy - ay) * d2x) / denom;
  const t = ((cx - ax) * d1y - (cy - ay) * d1x) / denom;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}

export function segmentIntersectsRing(
  p1: LatLon,
  p2: LatLon,
  ring: [number, number][],
): boolean {
  if (pointInPolygon(p1.latitude, p1.longitude, [ring])) return true;
  if (pointInPolygon(p2.latitude, p2.longitude, [ring])) return true;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ay, ax] = ring[j];
    const [by, bx] = ring[i];
    if (
      segmentsIntersect(
        p1.longitude,
        p1.latitude,
        p2.longitude,
        p2.latitude,
        ax,
        ay,
        bx,
        by,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function segmentIntersectsLowFlightArea(
  p1: LatLon,
  p2: LatLon,
  area: MilLowFlightArea,
): boolean {
  return segmentIntersectsRing(p1, p2, area.ringLatLon);
}

export interface RouteIntersection {
  segmentIndex: number;
  from: LatLon;
  to: LatLon;
  area: MilLowFlightArea;
}

export function findRouteIntersections(
  waypoints: LatLon[],
): RouteIntersection[] {
  const result: RouteIntersection[] = [];
  if (waypoints.length < 2) return result;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    for (const area of MIL_LOW_FLIGHT_AREAS) {
      if (segmentIntersectsLowFlightArea(a, b, area)) {
        result.push({ segmentIndex: i, from: a, to: b, area });
      }
    }
  }
  return result;
}

/**
 * Standard-Position für Sonnenauf-/-untergangs-Berechnung, wenn der Aufrufer
 * keine Koordinaten kennt. Bewusst Mitte Deutschlands, da alle LFAs in DE liegen.
 */
const DEFAULT_LFA_LAT = 51.0;
const DEFAULT_LFA_LON = 10.0;

export function isMilLowFlightActiveAt(
  date: Date,
  lat: number = DEFAULT_LFA_LAT,
  lon: number = DEFAULT_LFA_LON,
): boolean {
  const solar = calculateSolarTimes(lat, lon, date);
  if (!solar.sunrise || !solar.sunset) return false;
  return date >= solar.sunrise && date <= solar.sunset;
}

export function isMilLowFlightLikelyActive(
  plannedDate?: string,
  plannedTime?: string,
  lat?: number,
  lon?: number,
): boolean {
  // Ohne geplantes Datum: aktuelle Tageslichtphase prüfen.
  if (!plannedDate) return isMilLowFlightActiveAt(new Date(), lat, lon);
  const iso = plannedTime ? `${plannedDate}T${plannedTime}` : `${plannedDate}T12:00`;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return true;
  return isMilLowFlightActiveAt(d, lat, lon);
}

/**
 * Wie isMilLowFlightLikelyActive, prüft aber das GANZE Flugfenster
 * (Start bis Ende, Ende <= Start = Folgetag): aktiv, sobald irgendein
 * Zeitpunkt des Fensters in die Tageslichtphase fällt.
 */
export function isMilLowFlightLikelyActiveInWindow(
  plannedDate?: string,
  plannedTime?: string,
  endTime?: string,
  lat?: number,
  lon?: number,
): boolean {
  if (!plannedDate || !plannedTime || !endTime) {
    return isMilLowFlightLikelyActive(plannedDate, plannedTime, lat, lon);
  }
  const w = computeFlightWindow(plannedDate, plannedTime, endTime);
  if (!w) return isMilLowFlightLikelyActive(plannedDate, plannedTime, lat, lon);
  return flightWindowSampleTimes(w.start, w.end, 15).some((d) => isMilLowFlightActiveAt(d, lat, lon));
}
