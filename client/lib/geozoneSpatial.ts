// Pure geographic hit testing for zone polygons and the planning-radius circle.
// Kept free of React Native imports so the geometry rules can be unit-tested.
export type LatLonPoint = [number, number];
export type LatLonRing = LatLonPoint[];
export type LatLonPolygonGroup = LatLonRing[];

function pointToSegmentMeters(
  lat: number,
  lon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const px = (lon - aLon) * mPerDegLon;
  const py = (lat - aLat) * mPerDegLat;
  const bx = (bLon - aLon) * mPerDegLon;
  const by = (bLat - aLat) * mPerDegLat;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointInRing(lat: number, lon: number, ring: LatLonRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1];
    const yj = ring[j][0], xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function ringBoundaryWithinCircle(
  ring: LatLonRing,
  lat: number,
  lon: number,
  radiusM: number,
): boolean {
  if (ring.length < 2) return false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    if (pointToSegmentMeters(lat, lon, latI, lonI, latJ, lonJ) <= radiusM) return true;
  }
  return false;
}

// A zone intersects the circle if an edge touches it, or its center is inside
// the filled polygon. Holes are subtracted: a circle wholly inside a hole is
// not a hit, but touching a hole edge is.
export function polygonGroupsIntersectCircle(
  groups: LatLonPolygonGroup[],
  lat: number,
  lon: number,
  radiusM: number,
): boolean {
  return groups.some((group) => {
    if (group.length === 0) return false;
    if (group.some((ring) => ringBoundaryWithinCircle(ring, lat, lon, radiusM))) return true;
    const [outer, ...holes] = group;
    if (!pointInRing(lat, lon, outer)) return false;
    return !holes.some((hole) => pointInRing(lat, lon, hole));
  });
}

// Compatibility path for feeds that provide a flat ring list without explicit
// outer/inner grouping. New GeoJSON parsers should pass polygon groups instead.
export function polygonRingsIntersectCircle(
  rings: LatLonRing[],
  lat: number,
  lon: number,
  radiusM: number,
): boolean {
  if (rings.some((ring) => ringBoundaryWithinCircle(ring, lat, lon, radiusM))) return true;
  return pointInRing(lat, lon, rings[0] || []);
}
