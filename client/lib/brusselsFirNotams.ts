// NOTAMs der Brussels FIR (EBBU) nach Land aufteilen.
//
// Luxemburg liegt in der Brussels FIR. NOTAMs über Luxemburg (z. B. G2219/26
// „Tour de Luxembourg“) veröffentlicht deshalb skeyes mit – sie stecken im
// belgischen ED-269-Bestand (skeyes-Live-API mit applicability/Gültigkeit).
// Damit sie in der NOTAM-Liste unter Luxemburg statt Belgien erscheinen (und
// nicht doppelt), wird jeder Eintrag anhand seiner Geometrie einem Land
// zugeordnet: Flächenschwerpunkt → detectCountryFromCoordinates. Nur Einträge
// mit Schwerpunkt in LU UND belegter Gültigkeit wandern nach LU; alles andere
// bleibt unverändert bei BE (die BE-Liste verliert nichts außer LU-NOTAMs).
//
// Reines Modul (kein React Native) – unter tsx testbar.
import type { DipulTempRestriction } from "@/lib/geozones";
import { detectCountryFromCoordinates } from "../../shared/countryDetection";

type LatLon = [number, number];

/** Äußere Ringe ([lat, lon]) einer Restriktion. */
function outerRings(r: Pick<DipulTempRestriction, "polygonGroups" | "polygonRings">): LatLon[][] {
  if (r.polygonGroups && r.polygonGroups.length > 0) {
    return r.polygonGroups.map((g) => g?.[0]).filter((ring): ring is LatLon[] => Array.isArray(ring) && ring.length >= 3);
  }
  return (r.polygonRings ?? []).filter((ring) => Array.isArray(ring) && ring.length >= 3);
}

/** Flächenschwerpunkt eines Rings ([lat, lon]); Rückfall Eckpunktmittel. */
function ringCentroid(ring: LatLon[]): { lat: number; lon: number; area: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [y0, x0] = ring[i];
    const [y1, x1] = ring[(i + 1) % n];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sLat = 0;
    let sLon = 0;
    for (const [la, lo] of ring) {
      sLat += la;
      sLon += lo;
    }
    return { lat: sLat / n, lon: sLon / n, area: 0 };
  }
  return { lat: cy / (3 * a), lon: cx / (3 * a), area: Math.abs(a / 2) };
}

/** Repräsentativer Punkt: Schwerpunkt des größten Teilpolygons, sonst centerLat/Lon. */
export function notamRepresentativePoint(
  r: Pick<DipulTempRestriction, "polygonGroups" | "polygonRings" | "centerLat" | "centerLon">,
): { lat: number; lon: number } | null {
  let best: { lat: number; lon: number; area: number } | null = null;
  for (const ring of outerRings(r)) {
    const c = ringCentroid(ring);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    if (!best || c.area > best.area) best = c;
  }
  if (best) return { lat: best.lat, lon: best.lon };
  if (r.centerLat != null && r.centerLon != null) return { lat: r.centerLat, lon: r.centerLon };
  return null;
}

/** Land eines NOTAM-Eintrags nach Geometrie (null = unbestimmt, z. B. über See). */
export function notamCountryByGeometry(
  r: Pick<DipulTempRestriction, "polygonGroups" | "polygonRings" | "centerLat" | "centerLon">,
): string | null {
  const p = notamRepresentativePoint(r);
  return p ? detectCountryFromCoordinates(p.lat, p.lon) : null;
}

/** Brussels-FIR-Eintrag, der unter Luxemburg gehört (Schwerpunkt in LU, Gültigkeit belegt). */
export function isLuxembourgBrusselsFirNotam(r: DipulTempRestriction): boolean {
  if (r.validityUnknown) return false;
  if (!r.endTs) return false;
  return notamCountryByGeometry(r) === "LU";
}

/**
 * Teilt die belgischen ED-269-NOTAM-Einträge in BE und LU auf. Nicht-LU-
 * Einträge (auch unbestimmte) bleiben in BE – unverändert wie bisher.
 */
export function splitBrusselsFirNotams(be: DipulTempRestriction[]): { BE: DipulTempRestriction[]; LU: DipulTempRestriction[] } {
  const out = { BE: [] as DipulTempRestriction[], LU: [] as DipulTempRestriction[] };
  for (const r of be) (isLuxembourgBrusselsFirNotam(r) ? out.LU : out.BE).push(r);
  return out;
}

/** Abgelaufene Einträge (Ende in der Vergangenheit) – doppelte Absicherung. */
export function isNotamExpired(r: Pick<DipulTempRestriction, "endTs">, nowMs: number = Date.now()): boolean {
  if (!r.endTs) return false;
  const end = Date.parse(r.endTs);
  return Number.isFinite(end) && end < nowMs;
}

function pointInRing(lat: number, lon: number, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Abstand Punkt → Ringkante in km (lokale äquirektanguläre Projektion). */
function distanceToRingKm(lat: number, lon: number, ring: LatLon[]): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.574;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [la0, lo0] = ring[i];
    const [la1, lo1] = ring[(i + 1) % ring.length];
    const ax = (lo0 - lon) * kx;
    const ay = (la0 - lat) * ky;
    const bx = (lo1 - lon) * kx;
    const by = (la1 - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

/** Liegt die Zone im Umkreis (Punkt innen oder Rand ≤ radiusKm)? */
export function notamWithinRadius(r: DipulTempRestriction, lat: number, lon: number, radiusKm: number): boolean {
  const rings = outerRings(r);
  if (rings.length === 0) {
    if (r.centerLat == null || r.centerLon == null) return false;
    return distanceToRingKm(lat, lon, [[r.centerLat, r.centerLon]]) <= radiusKm;
  }
  return rings.some((ring) => pointInRing(lat, lon, ring) || distanceToRingKm(lat, lon, ring) <= radiusKm);
}

/**
 * LU-NOTAMs der Brussels FIR im Umkreis eines Punkts (Radar-/Gebietsprüfung).
 * `beNotams` = ed269ZonesToNotamRestrictions des belgischen Bestands.
 */
export function luBrusselsFirNotamsNear(
  beNotams: DipulTempRestriction[],
  lat: number,
  lon: number,
  radiusKm: number,
  nowMs: number = Date.now(),
): DipulTempRestriction[] {
  return splitBrusselsFirNotams(beNotams).LU.filter(
    (r) => !isNotamExpired(r, nowMs) && notamWithinRadius(r, lat, lon, radiusKm),
  );
}
