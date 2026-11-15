// Abhängigkeitsfreier AIXM-5.1-Leser für Luftraum-Datensätze (z. B. NATS
// „UK UAS Flight Restrictions“, siehe docs/uk-geozones-integration.md §7).
//
// React Native hat keinen DOMParser. Deshalb:
//  - `AixmMemberSplitter` zerlegt den XML-Text STÜCKWEISE in die einzelnen
//    `<message:hasMember>`-Blöcke (Text kann in beliebigen Stücken kommen –
//    direkt aus dem Entpacker), ohne die ganze Datei als Baum aufzubauen;
//  - jeder Block (≈ 10 KB) wird mit dem kleinen XML-Tokenizer aus kml.ts
//    (`parseXml`) gelesen und sofort in ein schlankes Objekt übersetzt;
//  - `parseAixmZip` entpackt (fflate, streamend), prüft SHA-256 gegen die
//    mitgelieferte `.sha256`-Datei und gibt dem JS-Thread alle N Blöcke eine
//    Pause (`yieldEvery`), damit die App bei ≈ 12 MB XML nicht einfriert.
//
// Geometrie (GML 3.2 in AIXM):
//  - EPSG:4326 in Achsfolge „lat lon“ → hier immer [lon, lat] (GeoJSON).
//  - Ring = Folge von curveMember/Curve/segments, nacheinander verkettet:
//    GeodesicString (Großkreis; lange Kanten werden verdichtet),
//    LineStringSegment (direkt), ArcByCenterPoint, CircleByCenterPoint.
//  - ⚠️ Winkel: NATS kodiert startAngle/endAngle als **Peilung (ab Nord, im
//    Uhrzeigersinn)** – NICHT mathematisch ab Ost, wie die Doku zunächst
//    vermutete. Geprüft an den echten Daten: der Bogen beginnt/endet genau an
//    den Nachbarpunkten des Rings, und die Fläche stimmt mit dem amtlichen
//    NATS-KML überein. Richtung = Vorzeichen von (endAngle − startAngle):
//    größer → im Uhrzeigersinn, kleiner → gegen den Uhrzeigersinn (negative
//    Winkel kommen vor). Siehe `AIXM_ARC_ANGLES`.
//  - Bögen/Kreise in `stepDeg`-Schritten (Standard 3°) verdichtet.
//  - Radius-Einheiten: [nmi_i]/NM = 1852 m, [ft_i]/FT, m/M, km/KM, [mi_i].
//  - curveMember mit xlink:href → Verweis auf eine GeoBorder (Küstenlinie,
//    erst am Dateiende); wird nach dem Lesen aufgelöst: der Abschnitt der
//    Grenzlinie zwischen dem letzten Punkt davor und dem ersten danach.
//  - Ringe werden geschlossen; gml:interior → Löcher.
//
// Höhen über shared/heights.ts `parseHeight` (uom FT/M/FL, Bezug SFC → AGL,
// MSL → MSL, STD → Druckhöhe) – ein fehlender Bezug bleibt UNKNOWN, nie AGL.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { DecodeUTF8, Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from "fflate";
import { parseXml, childElement, childElements, childText, descendants, type XmlElement } from "./kml";
import { parseHeight, type Height } from "../heights";
import { Sha256, parseSha256File } from "../sha256";

export type LonLat = [number, number];

/** Erdradius (Mittel, IUGG) für die Kugelrechnung der Bögen. */
export const AIXM_EARTH_RADIUS_M = 6_371_008.8;
/** Standard-Schrittweite beim Verdichten von Bögen/Kreisen (Grad). */
export const AIXM_ARC_STEP_DEG = 3;
/** Großkreis-Kanten länger als das werden zusätzlich verdichtet (m). */
export const AIXM_GEODESIC_MAX_SEGMENT_M = 10_000;

/**
 * Winkelkonvention der Bögen. "bearing" = ab Nord im Uhrzeigersinn (NATS,
 * an den echten Daten verifiziert); "math" = ab Ost gegen den Uhrzeigersinn
 * (GML-Lehrbuch). Nur für Tests/Vergleiche umschaltbar.
 */
export type AixmAngleConvention = "bearing" | "math";
export const AIXM_ARC_ANGLES: AixmAngleConvention = "bearing";

// ---------------------------------------------------------------------------
// Datentypen
// ---------------------------------------------------------------------------

export interface AixmLimit {
  /** Rohwert, z. B. "2000", "UNL", "GND" */
  value: string;
  uom?: string;
  /** SFC / MSL / STD / W84 … (roh) */
  reference?: string;
  /** Normierte Höhe (shared/heights.ts) */
  height: Height | null;
}

export interface AixmNote {
  purpose?: string;
  propertyName?: string;
  lang?: string;
  text: string;
}

export interface AixmTimesheet {
  timeReference?: string;
  day?: string;
  dayTil?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  startEvent?: string;
  endEvent?: string;
  /** excluded = YES: Zeitraum, in dem das Gebiet NICHT aktiv ist */
  excluded?: boolean;
}

export interface AixmActivation {
  /** ACTIVE / AVBL_FOR_ACTIVATION / OTHER … */
  status?: string;
  activity?: string;
  timesheets: AixmTimesheet[];
  notes: AixmNote[];
}

/** Ringteil vor dem Auflösen der GeoBorder-Verweise. */
export type AixmRingPart = { kind: "points"; coords: LonLat[] } | { kind: "border"; href: string };

export interface AixmPolygonSpec {
  exterior: AixmRingPart[];
  interiors: AixmRingPart[][];
}

export interface AixmVolume {
  operation?: string;
  operationSequence?: number;
  upper: AixmLimit | null;
  lower: AixmLimit | null;
  /** Rohe Ringteile (für die GeoBorder-Auflösung) */
  polygonSpecs: AixmPolygonSpec[];
  /** Fertige Polygone [Außenring, Löcher…] in [lon, lat]; erst nach resolveAixmGeometry vollständig */
  polygons: LonLat[][][];
}

export interface AixmAirspace {
  /** gml:identifier (UUID, zyklusstabil) */
  uuid?: string;
  /** gml:timePosition des Snapshots (= AIRAC-Datum) */
  validTime?: string;
  type?: string;
  designator?: string;
  localType?: string;
  name?: string;
  volumes: AixmVolume[];
  activations: AixmActivation[];
  /** aixm:annotation direkt am TimeSlice (Hinweise, Kontakte) */
  notes: AixmNote[];
  /** Ungelöste GeoBorder-Verweise nach resolveAixmGeometry */
  unresolvedBorders?: string[];
}

export interface AixmGeoBorder {
  uuid: string;
  name?: string;
  type?: string;
  coords: LonLat[];
}

export type AixmMember = { kind: "airspace"; airspace: AixmAirspace } | { kind: "border"; border: AixmGeoBorder } | { kind: "other"; name: string };

// ---------------------------------------------------------------------------
// Kugelgeometrie
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// WGS84-Ellipsoid
const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

/**
 * Zielpunkt von `from` in `distM` Metern unter Peilung `bearingDeg` auf dem
 * WGS84-Ellipsoid (Vincenty direkt). Bogen-/Kreisradien sind geodätische
 * Distanzen; die Kugel weicht in UK-Breiten um ≈ 0,3 % ab (an den NATS-Daten
 * sichtbar: Kreisflächen ≈ 0,6 % zu groß).
 */
export function destinationPoint(from: LonLat, distM: number, bearingDeg: number): LonLat {
  const alpha1 = bearingDeg * RAD;
  const sinA1 = Math.sin(alpha1);
  const cosA1 = Math.cos(alpha1);
  const tanU1 = (1 - WGS84_F) * Math.tan(from[1] * RAD);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosA1);
  const sinAlpha = cosU1 * sinA1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  let sigma = distM / (WGS84_B * A);
  let cos2SigmaM = 0, sinSigma = 0, cosSigma = 0;
  for (let iter = 0; iter < 100; iter++) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const dSigma =
      B * sinSigma * (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const next = distM / (WGS84_B * A) + dSigma;
    if (Math.abs(next - sigma) < 1e-12) {
      sigma = next;
      break;
    }
    sigma = next;
  }
  cos2SigmaM = Math.cos(2 * sigma1 + sigma);
  sinSigma = Math.sin(sigma);
  cosSigma = Math.cos(sigma);
  const x = sinU1 * sinSigma - cosU1 * cosSigma * cosA1;
  const lat2 = Math.atan2(sinU1 * cosSigma + cosU1 * sinSigma * cosA1, (1 - WGS84_F) * Math.sqrt(sinAlpha * sinAlpha + x * x));
  const lambda = Math.atan2(sinSigma * sinA1, cosU1 * cosSigma - sinU1 * sinSigma * cosA1);
  const C = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
  const L = lambda - (1 - C) * WGS84_F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  const lon2 = from[0] + L * DEG;
  return [((lon2 + 540) % 360) - 180, lat2 * DEG];
}

/** Zielpunkt auf der Kugel (nur zum Vergleich/Testen). */
export function destinationPointSpherical(from: LonLat, distM: number, bearingDeg: number): LonLat {
  const d = distM / AIXM_EARTH_RADIUS_M;
  const b = bearingDeg * RAD;
  const lat1 = from[1] * RAD;
  const lon1 = from[0] * RAD;
  const sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * sinLat2);
  return [((lon2 * DEG + 540) % 360) - 180, lat2 * DEG];
}

/** Großkreisentfernung in Metern. */
export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * AIXM_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Peilung von a nach b (Grad, 0 = Nord, im Uhrzeigersinn). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const lat1 = a[1] * RAD;
  const lat2 = b[1] * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** Zwischenpunkt auf dem Großkreis (f = 0 … 1). */
function interpolateGreatCircle(a: LonLat, b: LonLat, f: number): LonLat {
  const lat1 = a[1] * RAD, lon1 = a[0] * RAD, lat2 = b[1] * RAD, lon2 = b[0] * RAD;
  const d = distanceM(a, b) / AIXM_EARTH_RADIUS_M;
  if (d === 0) return [a[0], a[1]];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [Math.atan2(y, x) * DEG, Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG];
}

/** Großkreis-Linie: lange Kanten in ≤ maxSegM-Stücke teilen (Endpunkte bleiben exakt). */
export function densifyGeodesic(points: LonLat[], maxSegM = AIXM_GEODESIC_MAX_SEGMENT_M): LonLat[] {
  if (points.length < 2) return points.slice();
  const out: LonLat[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = distanceM(a, b);
    const n = Math.ceil(d / maxSegM);
    for (let k = 1; k < n; k++) out.push(interpolateGreatCircle(a, b, k / n));
    out.push(b);
  }
  return out;
}

/** AIXM-Winkel → Peilung (ab Nord im Uhrzeigersinn). */
function toBearing(angle: number, conv: AixmAngleConvention): number {
  return conv === "bearing" ? angle : 90 - angle;
}

/**
 * Bogen um `center` mit Radius `radiusM` von startAngle bis endAngle. Richtung
 * = Vorzeichen der Differenz (in der Peilungs-Konvention: endAngle > startAngle
 * → im Uhrzeigersinn). Start- und Endpunkt sind enthalten; Schrittweite ≤ stepDeg.
 */
export function densifyArc(
  center: LonLat,
  radiusM: number,
  startAngle: number,
  endAngle: number,
  opts: { stepDeg?: number; angles?: AixmAngleConvention } = {},
): LonLat[] {
  const conv = opts.angles ?? AIXM_ARC_ANGLES;
  const step = Math.max(0.1, opts.stepDeg ?? AIXM_ARC_STEP_DEG);
  const b0 = toBearing(startAngle, conv);
  let sweep = toBearing(endAngle, conv) - b0;
  if (Math.abs(sweep) > 360) sweep = Math.sign(sweep) * 360;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const out: LonLat[] = [];
  for (let k = 0; k <= n; k++) out.push(destinationPoint(center, radiusM, b0 + (sweep * k) / n));
  return out;
}

/** Vollkreis (geschlossen, im Uhrzeigersinn ab Nord). */
export function densifyCircle(center: LonLat, radiusM: number, stepDeg = AIXM_ARC_STEP_DEG): LonLat[] {
  const n = Math.max(8, Math.ceil(360 / Math.max(0.1, stepDeg)));
  const out: LonLat[] = [];
  for (let k = 0; k < n; k++) out.push(destinationPoint(center, radiusM, (360 * k) / n));
  out.push([out[0][0], out[0][1]]);
  return out;
}

/** Länge in Metern aus Wert + uom ([nmi_i], NM, [ft_i], FT, m, km, [mi_i]). null bei unbekannter Einheit. */
export function aixmLengthToMeters(value: number, uom: string | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  const u = String(uom ?? "").trim().toLowerCase();
  if (u === "[nmi_i]" || u === "nm" || u === "nmi") return value * 1852;
  if (u === "[ft_i]" || u === "ft") return value * 0.3048;
  if (u === "m" || u === "") return value;
  if (u === "km") return value * 1000;
  if (u === "[mi_i]" || u === "mi") return value * 1609.344;
  return null;
}

// ---------------------------------------------------------------------------
// XML-Hilfen
// ---------------------------------------------------------------------------

function isNil(el: XmlElement | undefined): boolean {
  return !el || el.attrs.nil === "true";
}

function textOf(el: XmlElement | undefined): string | undefined {
  if (isNil(el)) return undefined;
  const t = el!.text.trim();
  return t || undefined;
}

function childValue(el: XmlElement | undefined, name: string): string | undefined {
  return textOf(childElement(el, name));
}

/** "lat lon" bzw. Liste "lat lon lat lon …" → [lon, lat][] */
export function aixmPosList(text: string, swap = true): LonLat[] {
  const nums = text.trim().split(/\s+/).map(Number);
  const out: LonLat[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const a = nums[i];
    const b = nums[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    out.push(swap ? [b, a] : [a, b]);
  }
  return out;
}

/** Achsfolge eines srsName: EPSG:4326/urn → lat lon (tauschen); CRS84 → lon lat. */
function srsIsLatLon(srs: string | undefined): boolean {
  return !srs || !/CRS84/i.test(srs);
}

/** Alle Positionen eines Elements in Dokumentreihenfolge (gml:pos, gml:posList). */
function positionsOf(el: XmlElement, swap: boolean): LonLat[] {
  const out: LonLat[] = [];
  const visit = (e: XmlElement) => {
    for (const c of e.children) {
      if (c.name === "pos" || c.name === "posList") {
        const s = c.attrs.srsName ? srsIsLatLon(c.attrs.srsName) : swap;
        out.push(...aixmPosList(c.text, s));
      } else if (c.name !== "annotation") visit(c);
    }
  };
  visit(el);
  return out;
}

function numberOf(el: XmlElement | undefined): number | null {
  const t = textOf(el);
  if (t == null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface AixmGeometryOptions {
  /** Schrittweite Bögen/Kreise (Grad, Standard 3) */
  stepDeg?: number;
  angles?: AixmAngleConvention;
  /** Großkreiskanten verdichten ab (m); 0 = aus */
  geodesicMaxSegmentM?: number;
}

/** Ein Kurvensegment → Punkte [lon, lat]. null bei unbrauchbarem Segment. */
export function aixmSegmentCoords(seg: XmlElement, swap: boolean, opts: AixmGeometryOptions = {}): LonLat[] | null {
  const name = seg.name;
  if (name === "ArcByCenterPoint" || name === "CircleByCenterPoint") {
    const center = positionsOf(seg, swap)[0];
    const rEl = childElement(seg, "radius");
    const r = numberOf(rEl);
    const radiusM = r == null ? null : aixmLengthToMeters(r, rEl?.attrs.uom);
    if (!center || radiusM == null || radiusM <= 0) return null;
    if (name === "CircleByCenterPoint") return densifyCircle(center, radiusM, opts.stepDeg);
    const s = numberOf(childElement(seg, "startAngle"));
    const e = numberOf(childElement(seg, "endAngle"));
    if (s == null || e == null) return null;
    return densifyArc(center, radiusM, s, e, { stepDeg: opts.stepDeg, angles: opts.angles });
  }
  const pts = positionsOf(seg, swap);
  if (pts.length === 0) return null;
  const maxSeg = opts.geodesicMaxSegmentM ?? AIXM_GEODESIC_MAX_SEGMENT_M;
  if (name === "GeodesicString" || name === "Geodesic") return maxSeg > 0 ? densifyGeodesic(pts, maxSeg) : pts;
  // LineStringSegment, LineString, Arc (3 Punkte – nicht im NATS-Datensatz) …: Punkte direkt
  return pts;
}

/** Ring (gml:Ring / gml:LinearRing) → Ringteile (Punkte bzw. GeoBorder-Verweise). */
export function aixmRingParts(ring: XmlElement, swap: boolean, opts: AixmGeometryOptions = {}): AixmRingPart[] {
  const parts: AixmRingPart[] = [];
  const pushPts = (coords: LonLat[] | null) => {
    if (!coords || coords.length === 0) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === "points") last.coords.push(...coords);
    else parts.push({ kind: "points", coords: coords.slice() });
  };
  if (ring.name === "LinearRing") {
    pushPts(positionsOf(ring, swap));
    return parts;
  }
  for (const member of childElements(ring, "curveMember")) {
    const href = member.attrs.href;
    if (href && member.children.length === 0) {
      parts.push({ kind: "border", href: href.replace(/^urn:uuid:/i, "").replace(/^#/, "") });
      continue;
    }
    for (const curve of member.children) {
      if (curve.name === "Curve" || curve.name === "OrientableCurve" || curve.name === "CompositeCurve") {
        const segs = descendants(curve, "segments");
        const segList = segs.length > 0 ? segs.flatMap((s) => s.children) : [];
        for (const seg of segList) pushPts(aixmSegmentCoords(seg, swap, opts));
      } else if (curve.name === "LineString") {
        pushPts(positionsOf(curve, swap));
      }
    }
  }
  return parts;
}

function limitOf(vol: XmlElement, side: "upper" | "lower"): AixmLimit | null {
  const el = childElement(vol, `${side}Limit`);
  const value = textOf(el);
  if (value == null) return null;
  const uom = el?.attrs.uom;
  const reference = childValue(vol, `${side}LimitReference`);
  return { value, uom, reference, height: parseHeight(value, uom, reference) };
}

function notesOf(parent: XmlElement | undefined): AixmNote[] {
  const out: AixmNote[] = [];
  for (const ann of childElements(parent, "annotation")) {
    if (isNil(ann)) continue;
    for (const note of childElements(ann, "Note")) {
      const purpose = childValue(note, "purpose");
      const propertyName = childValue(note, "propertyName");
      for (const tn of childElements(note, "translatedNote")) {
        for (const ln of childElements(tn, "LinguisticNote")) {
          const n = childElement(ln, "note");
          const text = textOf(n);
          if (!text) continue;
          out.push({
            text,
            ...(purpose ? { purpose } : {}),
            ...(propertyName ? { propertyName } : {}),
            ...(n?.attrs.lang ? { lang: n.attrs.lang } : {}),
          });
        }
      }
    }
  }
  return out;
}

function timesheetOf(ts: XmlElement): AixmTimesheet {
  const v = (n: string) => childValue(ts, n);
  const excluded = v("excluded");
  const out: AixmTimesheet = {
    timeReference: v("timeReference"),
    day: v("day"),
    dayTil: v("dayTil"),
    startDate: v("startDate"),
    endDate: v("endDate"),
    startTime: v("startTime"),
    endTime: v("endTime"),
    startEvent: v("startEvent"),
    endEvent: v("endEvent"),
    excluded: excluded ? /^(YES|TRUE)$/i.test(excluded) : undefined,
  };
  for (const k of Object.keys(out) as (keyof AixmTimesheet)[]) if (out[k] === undefined) delete out[k];
  return out;
}

function polygonSpecsOf(vol: XmlElement, swap: boolean, opts: AixmGeometryOptions): AixmPolygonSpec[] {
  const out: AixmPolygonSpec[] = [];
  const hp = childElement(vol, "horizontalProjection");
  if (isNil(hp)) return out;
  for (const patch of [...descendants(hp!, "PolygonPatch"), ...descendants(hp!, "Polygon")]) {
    const ext = childElement(patch, "exterior");
    const extRing = ext?.children.find((c) => c.name === "Ring" || c.name === "LinearRing");
    if (!extRing) continue;
    const interiors: AixmRingPart[][] = [];
    for (const int of childElements(patch, "interior")) {
      const r = int.children.find((c) => c.name === "Ring" || c.name === "LinearRing");
      if (r) interiors.push(aixmRingParts(r, swap, opts));
    }
    out.push({ exterior: aixmRingParts(extRing, swap, opts), interiors });
  }
  return out;
}

/** Ein `<aixm:Airspace>`-Element → AixmAirspace (Geometrie noch mit offenen GeoBorder-Verweisen). */
export function aixmAirspaceFromElement(el: XmlElement, opts: AixmGeometryOptions = {}): AixmAirspace {
  const ts = descendants(el, "AirspaceTimeSlice")[0];
  const swapDefault = true;
  const a: AixmAirspace = {
    uuid: childValue(el, "identifier"),
    validTime: ts ? textOf(descendants(childElement(ts, "validTime") ?? ts, "timePosition")[0]) : undefined,
    type: childValue(ts, "type"),
    designator: childValue(ts, "designator"),
    localType: childValue(ts, "localType"),
    name: childValue(ts, "name"),
    volumes: [],
    activations: [],
    notes: notesOf(ts),
  };
  for (const gc of childElements(ts, "geometryComponent")) {
    for (const agc of childElements(gc, "AirspaceGeometryComponent")) {
      const seq = numberOf(childElement(agc, "operationSequence"));
      for (const tav of childElements(agc, "theAirspaceVolume")) {
        for (const vol of childElements(tav, "AirspaceVolume")) {
          a.volumes.push({
            operation: childValue(agc, "operation"),
            ...(seq != null ? { operationSequence: seq } : {}),
            upper: limitOf(vol, "upper"),
            lower: limitOf(vol, "lower"),
            polygonSpecs: polygonSpecsOf(vol, swapDefault, opts),
            polygons: [],
          });
        }
      }
    }
  }
  for (const act of childElements(ts, "activation")) {
    for (const aa of childElements(act, "AirspaceActivation")) {
      const timesheets: AixmTimesheet[] = [];
      for (const ti of childElements(aa, "timeInterval")) for (const t of childElements(ti, "Timesheet")) timesheets.push(timesheetOf(t));
      a.activations.push({
        status: childValue(aa, "status"),
        activity: childValue(aa, "activity"),
        timesheets,
        notes: notesOf(aa),
      });
    }
  }
  for (const k of ["uuid", "validTime", "type", "designator", "localType", "name"] as const) if (a[k] === undefined) delete a[k];
  return a;
}

/** `<aixm:GeoBorder>` → Grenzlinie [lon, lat]. */
export function aixmGeoBorderFromElement(el: XmlElement, opts: AixmGeometryOptions = {}): AixmGeoBorder | null {
  const uuid = childValue(el, "identifier");
  if (!uuid) return null;
  const ts = descendants(el, "GeoBorderTimeSlice")[0];
  const coords: LonLat[] = [];
  for (const b of childElements(ts, "border")) {
    for (const seg of descendants(b, "segments").flatMap((s) => s.children)) {
      const pts = aixmSegmentCoords(seg, true, { ...opts, geodesicMaxSegmentM: 0 });
      if (pts) coords.push(...pts);
    }
  }
  return { uuid, name: childValue(ts, "name"), type: childValue(ts, "type"), coords };
}

/** Einen `hasMember`-Block (XML-Text) lesen. */
export function parseAixmMember(xml: string, opts: AixmGeometryOptions = {}): AixmMember | null {
  const doc = parseXml(xml);
  const member = doc.children[0];
  if (!member) return null;
  const feat = member.name === "hasMember" ? member.children[0] : member;
  if (!feat) return null;
  if (feat.name === "Airspace") return { kind: "airspace", airspace: aixmAirspaceFromElement(feat, opts) };
  if (feat.name === "GeoBorder") {
    const border = aixmGeoBorderFromElement(feat, opts);
    return border ? { kind: "border", border } : null;
  }
  return { kind: "other", name: feat.name };
}

// ---------------------------------------------------------------------------
// GeoBorder-Auflösung und Ringe
// ---------------------------------------------------------------------------

function nearestIndex(line: LonLat[], p: LonLat): number {
  let best = -1;
  let bestD = Infinity;
  const cos = Math.cos(p[1] * RAD);
  for (let i = 0; i < line.length; i++) {
    const dx = (line[i][0] - p[0]) * cos;
    const dy = line[i][1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function samePt(a: LonLat, b: LonLat): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/**
 * Ringteile zu einem geschlossenen Ring verketten. Ein GeoBorder-Verweis wird
 * durch den Abschnitt der Grenzlinie zwischen dem letzten Punkt davor und dem
 * ersten Punkt danach ersetzt (Richtung aus der Lage der beiden Punkte).
 * Fehlende Grenzen → `missing` (Ring dann ohne den Abschnitt).
 */
export function assembleAixmRing(
  parts: AixmRingPart[],
  borders: ReadonlyMap<string, AixmGeoBorder>,
  missing?: string[],
): LonLat[] {
  const ring: LonLat[] = [];
  const push = (pts: LonLat[]) => {
    for (const p of pts) if (ring.length === 0 || !samePt(ring[ring.length - 1], p)) ring.push(p);
  };
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === "points") {
      push(part.coords);
      continue;
    }
    const border = borders.get(part.href);
    if (!border || border.coords.length < 2) {
      missing?.push(part.href);
      continue;
    }
    const prev = ring[ring.length - 1];
    // erster Punkt danach (bzw. Ringanfang, wenn der Verweis der letzte Teil ist)
    let next: LonLat | undefined;
    for (let k = i + 1; k < parts.length && !next; k++) {
      const q = parts[k];
      if (q.kind === "points" && q.coords.length) next = q.coords[0];
    }
    if (!next) {
      for (const q of parts) if (q.kind === "points" && q.coords.length) { next = q.coords[0]; break; }
    }
    if (!prev || !next) {
      push(border.coords);
      continue;
    }
    const a = nearestIndex(border.coords, prev);
    const b = nearestIndex(border.coords, next);
    const slice = a <= b ? border.coords.slice(a, b + 1) : border.coords.slice(b, a + 1).reverse();
    push(slice);
  }
  if (ring.length > 0 && !samePt(ring[0], ring[ring.length - 1])) ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/** Polygone aller Volumen eines Luftraums aufbauen (nach dem Lesen aller GeoBorder). */
export function resolveAixmGeometry(a: AixmAirspace, borders: ReadonlyMap<string, AixmGeoBorder>): AixmAirspace {
  const missing: string[] = [];
  for (const v of a.volumes) {
    v.polygons = [];
    for (const spec of v.polygonSpecs) {
      const ext = assembleAixmRing(spec.exterior, borders, missing);
      if (ext.length < 4) continue;
      const holes = spec.interiors.map((r) => assembleAixmRing(r, borders, missing)).filter((r) => r.length >= 4);
      v.polygons.push([ext, ...holes]);
    }
  }
  if (missing.length) a.unresolvedBorders = [...new Set(missing)];
  else delete a.unresolvedBorders;
  return a;
}

export function aixmHasBorderRefs(a: AixmAirspace): boolean {
  return a.volumes.some((v) => v.polygonSpecs.some((s) => [s.exterior, ...s.interiors].some((r) => r.some((p) => p.kind === "border"))));
}

/** Fläche eines Rings in m² (sphärische Näherung, Betrag). */
export function ringAreaM2(ring: LonLat[]): number {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    s += (x2 - x1) * RAD * (2 + Math.sin(y1 * RAD) + Math.sin(y2 * RAD));
  }
  return Math.abs((s * AIXM_EARTH_RADIUS_M * AIXM_EARTH_RADIUS_M) / 2);
}

// ---------------------------------------------------------------------------
// Stückweises Zerlegen in hasMember-Blöcke
// ---------------------------------------------------------------------------

const OPEN_RE = /<(?:[A-Za-z_][\w.-]*:)?hasMember[\s>/]/g;
const CLOSE_RE = /<\/(?:[A-Za-z_][\w.-]*:)?hasMember\s*>/g;

/**
 * Text stückweise annehmen und vollständige `<…:hasMember>…</…:hasMember>`-
 * Blöcke liefern. Hält nur den unvollständigen Rest im Speicher.
 */
export class AixmMemberSplitter {
  private buf = "";

  /** Weiteres Textstück; liefert die darin abgeschlossenen Blöcke. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let pos = 0;
    for (;;) {
      OPEN_RE.lastIndex = pos;
      const o = OPEN_RE.exec(this.buf);
      if (!o) {
        // Kein Anfang mehr: nur ein mögliches angeschnittenes "<…hasMember" behalten.
        const keep = Math.max(pos, this.buf.length - 64);
        this.buf = this.buf.slice(keep);
        return out;
      }
      CLOSE_RE.lastIndex = o.index;
      const c = CLOSE_RE.exec(this.buf);
      if (!c) {
        this.buf = this.buf.slice(o.index);
        return out;
      }
      out.push(this.buf.slice(o.index, c.index + c[0].length));
      pos = c.index + c[0].length;
    }
  }

  /** Rest (unvollständiger Block) – nach dem letzten Stück normalerweise leer. */
  rest(): string {
    return this.buf;
  }
}

// ---------------------------------------------------------------------------
// Datensatz lesen (Text bzw. ZIP), mit Pausen für den JS-Thread
// ---------------------------------------------------------------------------

export interface AixmParseOptions extends AixmGeometryOptions {
  /** Nach so vielen Blöcken dem JS-Thread eine Pause geben (Standard 10). */
  yieldEvery?: number;
  /** Pause-Funktion (Standard: setTimeout 0). */
  yieldFn?: () => Promise<void>;
  /** Fortschritt (gelesene Blöcke) */
  onProgress?: (members: number) => void;
}

export interface AixmDataset {
  airspaces: AixmAirspace[];
  borders: AixmGeoBorder[];
  /** Anzahl gelesener hasMember-Blöcke */
  members: number;
  /** Snapshot-Datum (aus dem ersten Luftraum) */
  validTime?: string;
}

const defaultYield = () => new Promise<void>((r) => setTimeout(r, 0));

/** Sammelt Blöcke, löst am Ende die GeoBorder-Verweise auf. */
export class AixmCollector {
  readonly airspaces: AixmAirspace[] = [];
  readonly borders = new Map<string, AixmGeoBorder>();
  members = 0;
  constructor(private readonly opts: AixmGeometryOptions = {}) {}

  add(memberXml: string): void {
    this.members++;
    const m = parseAixmMember(memberXml, this.opts);
    if (!m) return;
    if (m.kind === "airspace") {
      // Ohne Verweise sofort fertig bauen (Rohteile freigeben); mit Verweisen am Ende.
      if (!aixmHasBorderRefs(m.airspace)) {
        resolveAixmGeometry(m.airspace, this.borders);
        for (const v of m.airspace.volumes) v.polygonSpecs = [];
      }
      this.airspaces.push(m.airspace);
    } else if (m.kind === "border") this.borders.set(m.border.uuid, m.border);
  }

  finish(): AixmDataset {
    for (const a of this.airspaces) {
      if (a.volumes.some((v) => v.polygonSpecs.length > 0)) {
        resolveAixmGeometry(a, this.borders);
        for (const v of a.volumes) v.polygonSpecs = [];
      }
    }
    return {
      airspaces: this.airspaces,
      borders: [...this.borders.values()],
      members: this.members,
      validTime: this.airspaces.find((a) => a.validTime)?.validTime,
    };
  }
}

/** Ganzen AIXM-Text synchron lesen (Tests, kleine Dateien). */
export function parseAixmDatasetSync(xml: string, opts: AixmGeometryOptions = {}): AixmDataset {
  const col = new AixmCollector(opts);
  const sp = new AixmMemberSplitter();
  for (const m of sp.push(xml)) col.add(m);
  return col.finish();
}

/** AIXM-Text lesen, stückweise mit Pausen (große Dateien im JS-Thread). */
export async function parseAixmDataset(xml: string, opts: AixmParseOptions = {}): Promise<AixmDataset> {
  const col = new AixmCollector(opts);
  const sp = new AixmMemberSplitter();
  const every = Math.max(1, opts.yieldEvery ?? 10);
  const yieldFn = opts.yieldFn ?? defaultYield;
  const CHUNK = 256 * 1024;
  for (let i = 0; i < xml.length; i += CHUNK) {
    for (const m of sp.push(xml.slice(i, i + CHUNK))) {
      col.add(m);
      if (col.members % every === 0) {
        opts.onProgress?.(col.members);
        await yieldFn();
      }
    }
  }
  return col.finish();
}

export interface AixmZipResult extends AixmDataset {
  /** Name der gelesenen XML-Datei im ZIP */
  xmlName: string;
  xmlBytes: number;
  sha256: { expected: string | null; actual: string; ok: boolean | null };
}

export interface AixmZipOptions extends AixmParseOptions {
  /** true: fehlende `.sha256`-Datei ist ein Fehler (Standard false = nur prüfen, wenn vorhanden) */
  requireSha256?: boolean;
  /** Komprimierte Bytes je Schritt (Standard 16 KB) */
  zipChunkBytes?: number;
}

/** Fehler der Integritätsprüfung (Datei verworfen). */
export class AixmIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AixmIntegrityError";
  }
}

/**
 * NATS-Datensatz-ZIP (…_XML.zip mit `<name>.xml`, `<name>.sha256`,
 * `export-filter.xml`) streamend entpacken, SHA-256 der XML-Datei gegen die
 * `.sha256`-Datei prüfen und dabei die Blöcke lesen. Wirft
 * AixmIntegrityError bei Hash-Abweichung (bzw. fehlendem Hash mit
 * requireSha256) – dann wird nichts übernommen.
 */
export async function parseAixmZip(zip: Uint8Array, opts: AixmZipOptions = {}): Promise<AixmZipResult> {
  const col = new AixmCollector(opts);
  const sp = new AixmMemberSplitter();
  const hasher = new Sha256();
  const every = Math.max(1, opts.yieldEvery ?? 10);
  const yieldFn = opts.yieldFn ?? defaultYield;
  let xmlName = "";
  let xmlBytes = 0;
  let shaText = "";
  let pending: string[] = [];
  let error: unknown = null;
  let lastYieldAt = 0;

  const decoder = new DecodeUTF8((text) => {
    if (text) pending.push(...sp.push(text));
  });
  const shaDecoder = { chunks: [] as Uint8Array[] };

  const unzip = new Unzip((file: UnzipFile) => {
    const lower = file.name.toLowerCase();
    const isMainXml = lower.endsWith(".xml") && !/(^|\/)export-filter\.xml$/.test(lower) && !/_metadata\.xml$/.test(lower);
    if (isMainXml && !xmlName) {
      xmlName = file.name;
      file.ondata = (err, data, final) => {
        if (err) {
          error = err;
          return;
        }
        xmlBytes += data.length;
        hasher.update(data);
        decoder.push(data, final);
      };
      file.start();
    } else if (lower.endsWith(".sha256")) {
      file.ondata = (err, data) => {
        if (err) error = err;
        else shaDecoder.chunks.push(data);
      };
      file.start();
    }
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  const step = Math.max(4096, opts.zipChunkBytes ?? 16 * 1024);
  for (let i = 0; i < zip.length; i += step) {
    const end = Math.min(zip.length, i + step);
    unzip.push(zip.subarray(i, end), end >= zip.length);
    if (error) throw error instanceof Error ? error : new Error(String(error));
    const blocks = pending;
    pending = [];
    for (const m of blocks) {
      col.add(m);
      if (col.members - lastYieldAt >= every) {
        lastYieldAt = col.members;
        opts.onProgress?.(col.members);
        await yieldFn();
      }
    }
    if (blocks.length === 0) await yieldFn();
  }
  if (zip.length === 0) throw new Error("AIXM-ZIP leer");
  if (!xmlName) throw new Error("AIXM-ZIP enthält keine XML-Datei");
  for (const m of pending) col.add(m);

  for (const c of shaDecoder.chunks) for (let k = 0; k < c.length; k++) shaText += String.fromCharCode(c[k]);
  const actual = hasher.digestHex();
  const parsed = parseSha256File(shaText);
  const expected = parsed?.hash ?? null;
  if (expected && expected !== actual) {
    throw new AixmIntegrityError(`SHA-256 von ${xmlName} stimmt nicht (erwartet ${expected.slice(0, 12)}…, erhalten ${actual.slice(0, 12)}…)`);
  }
  if (!expected && opts.requireSha256) throw new AixmIntegrityError(`Keine SHA-256-Prüfsumme für ${xmlName} im ZIP`);
  const ds = col.finish();
  return { ...ds, xmlName, xmlBytes, sha256: { expected, actual, ok: expected ? true : null } };
}
