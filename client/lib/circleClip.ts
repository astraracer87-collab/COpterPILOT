// Polygon (Ringe als [lat, lon]) auf einen Kreis zuschneiden – für die
// Hervorhebung betroffener Geozonen auf der Radar-Karte: Die starke Markierung
// endet am Prüfkreis (eine Autobahn-Zone soll nicht über die ganze Karte rot
// sein). Sutherland-Hodgman gegen ein konvexes n-Eck in lokalen Metern.
// RN-frei (unter tsx testbar).

type LatLon = [number, number];

const M_PER_DEG = 111320;

function toXY(p: LatLon, c: LatLon, cosLat: number): [number, number] {
  return [(p[1] - c[1]) * M_PER_DEG * cosLat, (p[0] - c[0]) * M_PER_DEG];
}

function toLatLon(q: [number, number], c: LatLon, cosLat: number): LatLon {
  return [c[0] + q[1] / M_PER_DEG, c[1] + q[0] / (M_PER_DEG * cosLat)];
}

/** Kreis als konvexes n-Eck (gegen den Uhrzeigersinn, lokale Meter). */
function circleXY(radiusM: number, segments: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    out.push([radiusM * Math.cos(a), radiusM * Math.sin(a)]);
  }
  return out;
}

function clipRingXY(subject: [number, number][], clip: [number, number][]): [number, number][] {
  let output = subject;
  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: [number, number]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    const intersect = (p: [number, number], q: [number, number]): [number, number] => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
      const x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-12) return q;
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur));
      }
    }
  }
  return output;
}

/**
 * Schneidet eine Polygon-Gruppe ([Außenring, …Löcher], [lat, lon]) auf den
 * Kreis um `center` mit `radiusM` zu. Liegt nichts im Kreis → []. Löcher
 * werden ebenfalls zugeschnitten (fallen sie heraus, entfallen sie).
 */
export function clipRingGroupToCircle(group: LatLon[][], center: LatLon, radiusM: number, segments = 64): LatLon[][] {
  if (!group.length || !(radiusM > 0)) return [];
  const cosLat = Math.max(0.01, Math.cos((center[0] * Math.PI) / 180));
  const clip = circleXY(radiusM, segments);
  const out: LatLon[][] = [];
  for (let r = 0; r < group.length; r++) {
    const ring = group[r];
    if (!ring || ring.length < 3) {
      if (r === 0) return [];
      continue;
    }
    const xy = ring.map((p) => toXY(p, center, cosLat));
    // geschlossener Ring: doppelten Endpunkt entfernen
    const last = xy[xy.length - 1];
    if (xy.length > 3 && last[0] === xy[0][0] && last[1] === xy[0][1]) xy.pop();
    const clipped = clipRingXY(xy, clip);
    if (clipped.length < 3) {
      if (r === 0) return [];
      continue;
    }
    out.push(clipped.map((q) => toLatLon(q, center, cosLat)));
  }
  return out;
}
