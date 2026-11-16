/**
 * Gebietsübersicht der Flugplanung (Schritt nach „Standort bestätigen“):
 * reine, React-Native-freie Logik – unter tsx testbar
 * (client/lib/__tests__/areaOverview.test.ts).
 *
 *  - Filter „liegt im gewählten Umkreis“ für Geozonen, dipul-Beschränkungen
 *    und NOTAMs (Geometrie gegen Kreis).
 *  - Hinweise in der Nähe (Hubschrauberlandeplätze, Flugplätze, Modellflug)
 *    mit Entfernung und Himmelsrichtung, Schwellen: Helipad im Umkreis bzw.
 *    ≤ 1,5 km = Vorsicht; Flugplätze ≥ 1,5 km = reine Info (bis 5 km).
 *  - Overpass-Abfrage und -Parser für Luftfahrt-Punkte (OSM aeroway=…).
 *  - Hindernis-Zusammenfassung im Umkreis.
 *  - Kartenausschnitt der Vorschaukarten (Umkreis füllt ~55 % der Höhe).
 */
import type { GeozoneFeatureInfo } from "../../shared/geozoneFeatureInfo";

export type LatLon = { lat: number; lon: number };

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

const R_EARTH_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Anfangskurs von a nach b (0 = Nord, im Uhrzeigersinn, 0–360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS_DE = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"] as const;
export type CompassDe = (typeof COMPASS_DE)[number];

/** Achtelkompass auf Deutsch (N, NO, O, SO, S, SW, W, NW). */
export function compassDe(bearing: number): CompassDe {
  const b = ((bearing % 360) + 360) % 360;
  return COMPASS_DE[Math.round(b / 45) % 8];
}

/** „850 m“ (unter 1 km, auf 10 m) bzw. „2,4 km“. */
export function formatDistanceDe(m: number): string {
  if (!Number.isFinite(m)) return "–";
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${(km < 10 ? km.toFixed(1) : Math.round(km).toString()).replace(".", ",")} km`;
}

/** Lokale ebene Projektion (Meter) um einen Bezugspunkt – genügt für ≤ 50 km. */
function projector(c: LatLon) {
  const kx = 111_320 * Math.cos(toRad(c.lat));
  const ky = 110_540;
  return (lat: number, lon: number): [number, number] => [(lon - c.lon) * kx, (lat - c.lat) * ky];
}

function pointInRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Berührt der Ring ([lat, lon]-Punkte) den Kreis um `center`?
 * Treffer, wenn der Mittelpunkt im Ring liegt oder eine Kante näher als der
 * Radius verläuft.
 */
export function ringIntersectsCircle(ring: [number, number][], center: LatLon, radiusM: number): boolean {
  if (!ring || ring.length < 2) return false;
  const proj = projector(center);
  const pts = ring.map(([la, lo]) => proj(la, lo));
  if (pts.length >= 3 && pointInRing(0, 0, pts)) return true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (segDist(0, 0, a[0], a[1], b[0], b[1]) <= radiusM) return true;
  }
  return false;
}

function zoneRings(z: Pick<GeozoneFeatureInfo, "polygonGroups" | "polygonRings">): [number, number][][] {
  if (z.polygonGroups && z.polygonGroups.length > 0) return z.polygonGroups.map((g) => g[0]).filter(Boolean);
  return z.polygonRings ?? [];
}

/** true/false nach Geometrie; null = Zone ohne Geometrie (reine WMS-/Textquelle). */
export function zoneIntersectsRadius(
  z: Pick<GeozoneFeatureInfo, "polygonGroups" | "polygonRings">,
  center: LatLon,
  radiusM: number,
): boolean | null {
  const rings = zoneRings(z).filter((r) => r && r.length >= 3);
  if (rings.length === 0) return null;
  return rings.some((r) => ringIntersectsCircle(r, center, radiusM));
}

/**
 * Nur Zonen, die den Umkreis berühren. Zonen ohne Geometrie bleiben drin:
 * die Abfrage (queryGeozonesInArea) hat sie bereits für diesen Umkreis
 * geliefert – ohne Geometrie lässt sich das nicht genauer prüfen.
 */
export function filterZonesInRadius<T extends Pick<GeozoneFeatureInfo, "polygonGroups" | "polygonRings">>(
  zones: readonly T[],
  center: LatLon,
  radiusKm: number,
): T[] {
  const r = radiusKm * 1000;
  return zones.filter((z) => zoneIntersectsRadius(z, center, r) !== false);
}

export interface CircleOrPolygonLike {
  centerLat?: number | null;
  centerLon?: number | null;
  radiusM?: number | null;
  polygonRings?: [number, number][][] | null;
}

/** dipul-Beschränkung (Polygon oder Kreis) im Umkreis? Ohne Geometrie: true. */
export function restrictionInRadius(r: CircleOrPolygonLike, center: LatLon, radiusM: number): boolean {
  if (r.polygonRings && r.polygonRings.some((ring) => ring && ring.length >= 3)) {
    return r.polygonRings.some((ring) => ring.length >= 3 && ringIntersectsCircle(ring, center, radiusM));
  }
  if (r.centerLat != null && r.centerLon != null && Number.isFinite(r.centerLat) && Number.isFinite(r.centerLon)) {
    const d = haversineM(center, { lat: r.centerLat, lon: r.centerLon });
    return d - Math.max(0, r.radiusM ?? 0) <= radiusM;
  }
  return true;
}

export const NM_M = 1852;
/** NOTAMs mit Q-Zeilen-Radius ab hier gelten als großräumig (FIR-weit o. ä.). */
export const NOTAM_WIDE_RADIUS_NM = 50;

export interface NotamGeoLike {
  lat?: number;
  lon?: number;
  /** Q-Zeilen-Radius in NM */
  radius?: number;
}

export interface NotamAreaSplit<T> {
  /** örtliche NOTAMs, deren Kreis den Umkreis berührt */
  local: T[];
  /** großräumige NOTAMs (Radius ≥ 50 NM) bzw. ohne Koordinaten */
  wide: T[];
}

/** NOTAMs nach Lage zum Umkreis aufteilen; NOTAMs außerhalb fallen weg. */
export function splitNotamsForArea<T extends NotamGeoLike>(notams: readonly T[], center: LatLon, radiusM: number): NotamAreaSplit<T> {
  const local: T[] = [];
  const wide: T[] = [];
  for (const n of notams) {
    const hasPos = typeof n.lat === "number" && typeof n.lon === "number" && Number.isFinite(n.lat) && Number.isFinite(n.lon);
    const rNm = typeof n.radius === "number" && Number.isFinite(n.radius) ? n.radius : null;
    if (!hasPos || (rNm != null && rNm >= NOTAM_WIDE_RADIUS_NM)) {
      wide.push(n);
      continue;
    }
    const d = haversineM(center, { lat: n.lat!, lon: n.lon! });
    if (d - (rNm ?? 0) * NM_M <= radiusM) local.push(n);
  }
  return { local, wide };
}

/** Kartenausschnitt (Region) um eine Zone bzw. Ringliste, mit Rand. */
export function boundsRegion(rings: [number, number][][], padFactor = 1.3): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const ring of rings) for (const [la, lo] of ring) {
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo);
  }
  if (!Number.isFinite(s)) return null;
  return {
    latitude: (s + n) / 2,
    longitude: (w + e) / 2,
    latitudeDelta: Math.max(0.004, (n - s) * padFactor),
    longitudeDelta: Math.max(0.004, (e - w) * padFactor),
  };
}

export function zoneRegion(z: Pick<GeozoneFeatureInfo, "polygonGroups" | "polygonRings">) {
  return boundsRegion(zoneRings(z));
}

/** Kreis als [lat, lon]-Ring (für Hervorhebung/Zoom von Kreis-Gebieten). */
export function circleToRing(center: LatLon, radiusM: number, steps = 48): [number, number][] {
  const d = Math.max(1, radiusM) / R_EARTH_M;
  const φ1 = toRad(center.lat);
  const λ1 = toRad(center.lon);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI]);
  }
  return ring;
}

/** Kreis-Region (Mittelpunkt + Radius in m). */
export function circleRegion(center: LatLon, radiusM: number, padFactor = 2.6) {
  const span = Math.max(300, radiusM) * padFactor;
  return {
    latitude: center.lat,
    longitude: center.lon,
    latitudeDelta: span / 110_540,
    longitudeDelta: span / (111_320 * Math.max(0.2, Math.cos(toRad(center.lat)))),
  };
}

/**
 * Ausschnitt der kleinen Vorschaukarten (Pre-Check, Querformat-Karte): der
 * Umkreis soll rund `share` (Standard 55 %) der Kartenhöhe füllen. In breiten
 * Karten bestimmt die Höhe den Zoom, deshalb ist die Längen-Spanne so gewählt,
 * dass sie nicht stärker begrenzt.
 */
export function previewRegion(lat: number, lon: number, radiusKm: number, share = 0.55) {
  const diameterM = Math.max(0.05, radiusKm) * 2000;
  const spanM = diameterM / Math.min(0.9, Math.max(0.2, share));
  const latitudeDelta = Math.max(0.002, spanM / 110_540);
  const longitudeDelta = Math.max(0.002, spanM / (111_320 * Math.max(0.2, Math.cos(toRad(lat)))));
  return { latitude: lat, longitude: lon, latitudeDelta, longitudeDelta };
}

/** Kräftige Standard-Basiskarte der Vorschaukarten (wie die Radarkarte „Standard/OSM“). */
export const PREVIEW_BASEMAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

// ---------------------------------------------------------------------------
// Luftfahrt-Punkte (OSM / Flughafenlisten)
// ---------------------------------------------------------------------------

export type AviationPoiKind = "heliport" | "helipad" | "airport" | "airfield" | "glider" | "ultralight" | "model" | "military";

export interface AviationPoi {
  id: string;
  kind: AviationPoiKind;
  name?: string;
  lat: number;
  lon: number;
  icao?: string;
  /** Luftrettung (Rettungshubschrauber-Station / HEMS) */
  rescue?: boolean;
  /** Krankenhaus-Landeplatz */
  hospital?: boolean;
  source: "osm" | "airportdb";
}

export const AVIATION_POI_LABEL_DE: Record<AviationPoiKind, string> = {
  heliport: "Hubschrauberlandeplatz",
  helipad: "Hubschrauberlandeplatz",
  airport: "Flughafen",
  airfield: "Flugplatz",
  glider: "Segelfluggelände",
  ultralight: "UL-Gelände",
  model: "Modellflugplatz",
  military: "Militärflugplatz",
};

export function isHeliKind(k: AviationPoiKind): boolean {
  return k === "heliport" || k === "helipad";
}

export function poiLabelDe(p: Pick<AviationPoi, "kind" | "rescue" | "hospital">): string {
  if (isHeliKind(p.kind)) {
    if (p.rescue) return "Rettungshubschrauber-Landeplatz";
    if (p.hospital) return "Krankenhaus-Hubschrauberlandeplatz";
  }
  return AVIATION_POI_LABEL_DE[p.kind];
}

/** Overpass-Abfrage: Hubschrauberlandeplätze, Luftrettung, Flugplätze, Modellflug. */
export function buildAviationPoiQuery(b: { s: number; w: number; n: number; e: number }): string {
  const bb = `${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)}`;
  return `[out:json][timeout:60];(
nwr["aeroway"~"^(helipad|heliport)$"](${bb});
nwr["emergency"="air_rescue_service"](${bb});
nwr["aeroway"="aerodrome"](${bb});
nwr["sport"="model_aerodrome"](${bb});
);out tags center qt;`;
}

const RESCUE_RE = /\b(christoph|luftrettung|rettungshubschrauber|rth\b|itw\b|drf\b|adac|hems|air rescue|rega)\b/i;
const HOSPITAL_RE = /(klinik|krankenhaus|hospital|spital|uniklinik|medizin|kh\b)/i;

function aviationKind(tags: Record<string, string>): AviationPoiKind | null {
  const aeroway = tags.aeroway;
  if (aeroway === "heliport") return "heliport";
  if (aeroway === "helipad") return "helipad";
  if (tags.emergency === "air_rescue_service") return "heliport";
  if (tags.sport === "model_aerodrome" || /model/i.test(tags["aerodrome:type"] ?? "")) return "model";
  if (aeroway !== "aerodrome") return null;
  const type = `${tags["aerodrome:type"] ?? ""} ${tags.aerodrome ?? ""}`.toLowerCase();
  const name = (tags.name ?? "").toLowerCase();
  if (tags.military === "airfield" || /military/.test(type) || tags.landuse === "military") return "military";
  if (/glid|segelflug/.test(type) || /segelflug/.test(name)) return "glider";
  if (/ultralight|ultraleicht/.test(type) || /ultraleicht|\bul[- ]/.test(name)) return "ultralight";
  if (/model/.test(type) || /modellflug/.test(name)) return "model";
  if (/international|regional|public|airport/.test(type) || tags.iata) return "airport";
  return "airfield";
}

/**
 * Overpass-Antwort → GeoJSON-Punkte (gespeichert im Kachel-Speicher wie die
 * Hindernisse). Eigenschaften knapp: k (Art), n (Name), i (ICAO), r/h (Flags).
 */
export function parseAviationPoisOverpass(json: any): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const seen = new Set<string>();
  for (const el of json?.elements ?? []) {
    const tags: Record<string, string> = el?.tags ?? {};
    const kind = aviationKind(tags);
    if (!kind) continue;
    const lat = typeof el.lat === "number" ? el.lat : el.center?.lat;
    const lon = typeof el.lon === "number" ? el.lon : el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `${el.type ?? "n"}${el.id ?? `${lat},${lon}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const text = `${tags.name ?? ""} ${tags.operator ?? ""} ${tags.description ?? ""}`;
    const rescue = tags.emergency === "air_rescue_service" || tags["heliport:type"] === "emergency" || RESCUE_RE.test(text);
    const hospital = tags.amenity === "hospital" || !!tags.healthcare || HOSPITAL_RE.test(text);
    const props: Record<string, unknown> = { k: kind, id };
    if (tags.name) props.n = tags.name;
    if (tags.icao) props.i = tags.icao;
    if (isHeliKind(kind) && rescue) props.r = 1;
    if (isHeliKind(kind) && hospital) props.h = 1;
    features.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } });
  }
  return { type: "FeatureCollection", features };
}

const KINDS = new Set<AviationPoiKind>(["heliport", "helipad", "airport", "airfield", "glider", "ultralight", "model", "military"]);

export function poisFromFeatureCollection(fc: GeoJSON.FeatureCollection | null | undefined): AviationPoi[] {
  const out: AviationPoi[] = [];
  for (const f of fc?.features ?? []) {
    const p = (f.properties ?? {}) as Record<string, any>;
    if (f.geometry?.type !== "Point" || !KINDS.has(p.k)) continue;
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    out.push({
      id: `osm:${p.id ?? `${lat},${lon}`}`,
      kind: p.k,
      name: p.n || undefined,
      icao: p.i || undefined,
      rescue: p.r ? true : undefined,
      hospital: p.h ? true : undefined,
      lat,
      lon,
      source: "osm",
    });
  }
  return out;
}

/** Flughafenlisten der App (CTR-Flughäfen, große EU-Flughäfen) als Punkte. */
export function airportPoisFromList(list: readonly { icao: string; name: string; lat: number; lon: number; military?: boolean }[]): AviationPoi[] {
  return list.map((a) => ({
    id: `db:${a.icao}`,
    kind: a.military ? "military" : "airport",
    name: a.name,
    icao: a.icao,
    lat: a.lat,
    lon: a.lon,
    source: "airportdb",
  }));
}

/**
 * Doppelte Punkte zusammenführen (gleiche ICAO oder gleiche Gruppe – Heli vs.
 * Flugplatz – näher als `mergeM`). OSM-Einträge mit Namen haben Vorrang,
 * Rettungs-/Klinik-Merkmale bleiben erhalten.
 */
export function dedupePois(pois: readonly AviationPoi[], mergeM = 600): AviationPoi[] {
  const out: AviationPoi[] = [];
  const rank = (p: AviationPoi) => (p.source === "osm" ? 2 : 0) + (p.name ? 1 : 0);
  const sorted = [...pois].sort((a, b) => rank(b) - rank(a));
  for (const p of sorted) {
    const dup = out.find((q) =>
      (p.icao && q.icao && p.icao === q.icao) ||
      (isHeliKind(p.kind) === isHeliKind(q.kind) && haversineM(p, q) <= mergeM),
    );
    if (!dup) { out.push({ ...p }); continue; }
    dup.icao = dup.icao ?? p.icao;
    dup.name = dup.name ?? p.name;
    dup.rescue = dup.rescue || p.rescue || undefined;
    dup.hospital = dup.hospital || p.hospital || undefined;
    // Militär/Flughafen-Einstufung der Liste schlägt generisches „Flugplatz“
    if (dup.kind === "airfield" && (p.kind === "airport" || p.kind === "military")) dup.kind = p.kind;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hinweise in der Nähe
// ---------------------------------------------------------------------------

export const HINT_THRESHOLDS = {
  /** Helipad näher als das (oder im Umkreis): Vorsicht */
  helipadCautionM: 1500,
  /** Helipads bis hierhin als Info */
  helipadInfoM: 3000,
  /** Flugplatz näher als das: Vorsicht (liegt i. d. R. in der Flugplatz-Geozone) */
  aerodromeCautionM: 1500,
  /** Flugplätze bis hierhin als Info */
  aerodromeInfoM: 5000,
  /** Modellflugplätze bis hierhin als Info */
  modelInfoM: 3000,
} as const;

export type HintLevel = "caution" | "info";

export interface NearbyHint {
  id: string;
  level: HintLevel;
  poi: AviationPoi;
  distanceM: number;
  bearing: number;
  direction: CompassDe;
  insideRadius: boolean;
  /** „Rettungshubschrauber-Landeplatz Klinikum X“ */
  title: string;
  /** „1,2 km NO“ */
  distanceText: string;
  text: string;
}

function hintText(p: AviationPoi, level: HintLevel, inside: boolean): string {
  if (isHeliKind(p.kind)) {
    const who = p.rescue || p.hospital ? "Rettungshubschrauber" : "Hubschrauber";
    return level === "caution"
      ? `${inside ? "Im Flugbereich" : "Nahe am Flugbereich"}: Mit tief anfliegenden ${who}n rechnen. Bemannter Luftfahrt immer ausweichen – bei Annäherung sofort sinken bzw. landen.`
      : `${who} können hier an- und abfliegen. Luftraum beobachten.`;
  }
  if (p.kind === "model") return "Modellflugbetrieb möglich – Frequenzen und Flugbetrieb vor Ort abstimmen.";
  if (level === "caution") {
    return `${inside ? "Im Flugbereich" : "Sehr nah"}: Platzrunde sowie An- und Abflugverkehr. Flugplatz-Geozone und ggf. Zustimmung der Flugleitung beachten.`;
  }
  return "Reine Info: An- und Abflugverkehr bzw. Platzrunde in der Umgebung möglich.";
}

/**
 * Hinweise aus Luftfahrt-Punkten. Vorsicht:
 *  - Hubschrauberlandeplatz im Umkreis oder ≤ 1,5 km,
 *  - Flugplatz ≤ 1,5 km.
 * Info: Helipads bis 3 km, Flugplätze bis 5 km, Modellflug bis 3 km.
 * Sortierung: Vorsicht zuerst, dann nach Entfernung.
 */
export function buildNearbyHints(
  center: LatLon,
  radiusKm: number,
  pois: readonly AviationPoi[],
  t: { [K in keyof typeof HINT_THRESHOLDS]: number } = HINT_THRESHOLDS,
): NearbyHint[] {
  const radiusM = Math.max(0, radiusKm * 1000);
  const hints: NearbyHint[] = [];
  for (const p of dedupePois(pois)) {
    const d = haversineM(center, p);
    const inside = d <= radiusM;
    let level: HintLevel | null = null;
    if (isHeliKind(p.kind)) {
      if (inside || d <= t.helipadCautionM) level = "caution";
      else if (d <= Math.max(t.helipadInfoM, radiusM + t.helipadCautionM)) level = "info";
    } else if (p.kind === "model") {
      if (d <= Math.max(t.modelInfoM, radiusM)) level = "info";
    } else {
      if (d <= t.aerodromeCautionM) level = "caution";
      else if (d <= Math.max(t.aerodromeInfoM, radiusM)) level = "info";
    }
    if (!level) continue;
    const bearing = bearingDeg(center, p);
    const direction = compassDe(bearing);
    const label = poiLabelDe(p);
    const nm = p.name && p.name.trim() ? p.name.trim() : null;
    const title = nm ? (nm.toLowerCase().includes(label.toLowerCase()) ? nm : `${label} ${nm}`) : label;
    hints.push({
      id: p.id,
      level,
      poi: p,
      distanceM: d,
      bearing,
      direction,
      insideRadius: inside,
      title: p.icao && !title.includes(p.icao) ? `${title} (${p.icao})` : title,
      distanceText: d < 50 ? "am Standort" : `${formatDistanceDe(d)} ${direction}`,
      text: hintText(p, level, inside),
    });
  }
  return hints.sort((a, b) => (a.level === b.level ? a.distanceM - b.distanceM : a.level === "caution" ? -1 : 1));
}

/** Kurztext für den Hinweis-Chip, z. B. „2 Hinweise in der Nähe“. */
export function hintsSummaryDe(hints: readonly { level: HintLevel }[]): string {
  const n = hints.length;
  if (n === 0) return "Keine Hinweise in der Nähe";
  return `${n} Hinweis${n === 1 ? "" : "e"} in der Nähe`;
}

// ---------------------------------------------------------------------------
// Hindernisse im Umkreis
// ---------------------------------------------------------------------------

export const OBSTACLE_LABEL_DE: Record<string, [string, string]> = {
  wind: ["Windkraftanlage", "Windkraftanlagen"],
  pmast: ["Strommast", "Strommasten"],
  chimney: ["Schornstein", "Schornsteine"],
  tower: ["Turm", "Türme"],
  tower_fernmelde: ["Fernmeldeturm", "Fernmeldetürme"],
  mast: ["Mast", "Masten"],
};

export interface ObstacleSummary {
  total: number;
  byKind: { kind: string; label: string; count: number; maxHeightM: number }[];
  powerLines: number;
  tallest: { kind: string; label: string; heightM: number; distanceM: number; direction: CompassDe } | null;
}

/** Punkt-Hindernisse im Umkreis zählen (Art, größte Höhe) + Freileitungen, die ihn kreuzen. */
export function summarizeObstaclesInRadius(fc: GeoJSON.FeatureCollection | null | undefined, center: LatLon, radiusM: number): ObstacleSummary {
  const kinds = new Map<string, { count: number; maxHeightM: number }>();
  let powerLines = 0;
  let tallest: ObstacleSummary["tallest"] = null;
  let total = 0;
  for (const f of fc?.features ?? []) {
    const p = (f.properties ?? {}) as Record<string, any>;
    if (f.geometry?.type === "Point") {
      const label = OBSTACLE_LABEL_DE[p.k];
      if (!label) continue;
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
      const d = haversineM(center, { lat, lon });
      if (d > radiusM) continue;
      total++;
      const h = Number(p.h) || 0;
      const k = kinds.get(p.k) ?? { count: 0, maxHeightM: 0 };
      k.count++;
      k.maxHeightM = Math.max(k.maxHeightM, h);
      kinds.set(p.k, k);
      if (h > 0 && (!tallest || h > tallest.heightM)) {
        tallest = { kind: p.k, label: label[0], heightM: h, distanceM: d, direction: compassDe(bearingDeg(center, { lat, lon })) };
      }
    } else if (f.geometry?.type === "LineString" && p.k === "line") {
      const coords = (f.geometry as GeoJSON.LineString).coordinates.map(([lo, la]) => [la, lo] as [number, number]);
      // offene Linie: Kanten prüfen (ohne Schließen über ringIntersectsCircle)
      const proj = projector(center);
      const pts = coords.map(([la, lo]) => proj(la, lo));
      for (let i = 0; i + 1 < pts.length; i++) {
        if (segDist(0, 0, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= radiusM) { powerLines++; break; }
      }
    }
  }
  const byKind = [...kinds.entries()]
    .map(([kind, v]) => ({ kind, label: OBSTACLE_LABEL_DE[kind][v.count === 1 ? 0 : 1], count: v.count, maxHeightM: v.maxHeightM }))
    .sort((a, b) => b.maxHeightM - a.maxHeightM || b.count - a.count);
  return { total, byKind, powerLines, tallest };
}

/** „3 Windkraftanlagen (bis 230 m), 1 Mast · 2 Freileitungen“ */
export function obstacleSummaryTextDe(s: ObstacleSummary): string {
  const parts = s.byKind.map((k) => `${k.count} ${k.label}${k.maxHeightM > 0 ? ` (bis ${Math.round(k.maxHeightM)} m)` : ""}`);
  if (s.powerLines > 0) parts.push(`${s.powerLines} Freileitung${s.powerLines === 1 ? "" : "en"}`);
  return parts.length ? parts.join(", ") : "Keine erfassten Hindernisse im Umkreis";
}
