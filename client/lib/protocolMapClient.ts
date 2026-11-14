/**
 * Clientseitige Protokoll-Karte für den PDF-Export (Ersatz für den früheren
 * Server-Endpunkt `/api/proxy/protocol-map`, server/staticMap.ts).
 *
 * Lädt eine kleine Anzahl OSM-Kacheln direkt, bettet sie als Data-URLs in ein
 * SVG ein und zeichnet Radius-Kreis bzw. Flugroute als Vektor darüber. Das
 * Ergebnis ist eine `data:image/svg+xml`-URL, die direkt als <img src> im
 * PDF-HTML verwendet werden kann. Offline oder bei Fehlern wird `null`
 * geliefert – der PDF-Export fällt dann auf Snapshot/Schema zurück.
 */
import { bytesToBase64 } from "./base64";

export interface LatLon {
  lat: number;
  lon: number;
}

interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const TILE_SIZE = 256;
const TILE_BUDGET = 12; // max. nx*ny Basiskacheln
const HARD_MAX_ZOOM = 18;
const MIN_ZOOM = 3;
const TILE_TIMEOUT_MS = 8000;
const OSM_TILE_URL = "https://tile.openstreetmap.org";
const USER_AGENT = "COpterPilot-RC/1.0";

function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function lonLatToTileFrac(lon: number, lat: number, z: number): { fx: number; fy: number } {
  const n = Math.pow(2, z);
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { fx, fy };
}

function enforceMinSpan(b: BBox, minKm: number): BBox {
  const midLat = (b.minLat + b.maxLat) / 2;
  const minLatDeg = minKm / 111;
  const minLonDeg = minKm / (111 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  let { minLon, minLat, maxLon, maxLat } = b;
  if (maxLat - minLat < minLatDeg) {
    const mid = (minLat + maxLat) / 2;
    minLat = mid - minLatDeg / 2;
    maxLat = mid + minLatDeg / 2;
  }
  if (maxLon - minLon < minLonDeg) {
    const mid = (minLon + maxLon) / 2;
    minLon = mid - minLonDeg / 2;
    maxLon = mid + minLonDeg / 2;
  }
  return { minLon, minLat: clampLat(minLat), maxLon, maxLat: clampLat(maxLat) };
}

function expandBBox(b: BBox, frac: number): BBox {
  const dLat = (b.maxLat - b.minLat) * frac;
  const dLon = (b.maxLon - b.minLon) * frac;
  return {
    minLon: b.minLon - dLon,
    minLat: clampLat(b.minLat - dLat),
    maxLon: b.maxLon + dLon,
    maxLat: clampLat(b.maxLat + dLat),
  };
}

function bboxFromPoints(points: LatLon[]): BBox | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function bboxFromCircle(center: LatLon, radiusKm: number): BBox {
  const latDeg = radiusKm / 111;
  const lonDeg = radiusKm / (111 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
  return {
    minLon: center.lon - lonDeg,
    minLat: clampLat(center.lat - latDeg),
    maxLon: center.lon + lonDeg,
    maxLat: clampLat(center.lat + latDeg),
  };
}

interface TileRange {
  z: number;
  xMin: number;
  yMin: number;
  nx: number;
  ny: number;
}

function tileRange(b: BBox, z: number): TileRange {
  const tl = lonLatToTileFrac(b.minLon, b.maxLat, z);
  const br = lonLatToTileFrac(b.maxLon, b.minLat, z);
  const max = Math.pow(2, z) - 1;
  const xMin = Math.max(0, Math.min(max, Math.floor(tl.fx)));
  const xMax = Math.max(0, Math.min(max, Math.floor(br.fx)));
  const yMin = Math.max(0, Math.min(max, Math.floor(tl.fy)));
  const yMax = Math.max(0, Math.min(max, Math.floor(br.fy)));
  return { z, xMin, yMin, nx: xMax - xMin + 1, ny: yMax - yMin + 1 };
}

function pickZoom(b: BBox): TileRange {
  for (let z = HARD_MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const r = tileRange(b, z);
    if (r.nx * r.ny <= TILE_BUDGET) return r;
  }
  return tileRange(b, MIN_ZOOM);
}

async function fetchTileDataUrl(z: number, x: number, y: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TILE_TIMEOUT_MS);
  try {
    const res = await fetch(`${OSM_TILE_URL}/${z}/${x}/${y}.png`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "image/png" },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) return null;
    return `data:image/png;base64,${bytesToBase64(new Uint8Array(buf))}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type MapRequest =
  | { kind: "planned"; center: LatLon; radiusKm?: number }
  | { kind: "route"; center: LatLon; route: LatLon[] };

/**
 * Rendert eine Protokoll-Karte als SVG-Data-URL. Liefert null, wenn keine
 * einzige Kachel geladen werden konnte (z. B. offline).
 */
export async function renderProtocolMap(req: MapRequest): Promise<string | null> {
  const center = req.center;
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null;

  let bbox: BBox | null;
  if (req.kind === "route") {
    bbox = bboxFromPoints(req.route);
    if (!bbox) return null;
    bbox = expandBBox(enforceMinSpan(bbox, 0.3), 0.15);
  } else {
    const r = typeof req.radiusKm === "number" && req.radiusKm > 0 ? req.radiusKm : 0.5;
    bbox = expandBBox(enforceMinSpan(bboxFromCircle(center, r), 0.3), 0.15);
  }

  const range = pickZoom(bbox);
  const { z, xMin, yMin, nx, ny } = range;

  const jobs: Promise<{ x: number; y: number; url: string | null }>[] = [];
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x = xMin + tx;
      const y = yMin + ty;
      jobs.push(fetchTileDataUrl(z, x, y).then((url) => ({ x: tx, y: ty, url })));
    }
  }
  const tiles = await Promise.all(jobs);
  if (!tiles.some((t) => t.url)) return null;

  // Pixelausschnitt auf die Bbox zuschneiden (viewBox).
  const tl = lonLatToTileFrac(bbox.minLon, bbox.maxLat, z);
  const br = lonLatToTileFrac(bbox.maxLon, bbox.minLat, z);
  const toPx = (p: LatLon) => {
    const f = lonLatToTileFrac(p.lon, p.lat, z);
    return { x: (f.fx - xMin) * TILE_SIZE, y: (f.fy - yMin) * TILE_SIZE };
  };
  const vx = Math.max(0, (tl.fx - xMin) * TILE_SIZE);
  const vy = Math.max(0, (tl.fy - yMin) * TILE_SIZE);
  const vw = Math.min(nx * TILE_SIZE, (br.fx - xMin) * TILE_SIZE) - vx;
  const vh = Math.min(ny * TILE_SIZE, (br.fy - yMin) * TILE_SIZE) - vy;
  if (!(vw > 0 && vh > 0)) return null;

  const parts: string[] = [];
  for (const t of tiles) {
    if (!t.url) continue;
    parts.push(
      `<image x="${t.x * TILE_SIZE}" y="${t.y * TILE_SIZE}" width="${TILE_SIZE}" height="${TILE_SIZE}" href="${t.url}" xlink:href="${t.url}"/>`,
    );
  }

  const scale = Math.max(vw, vh) / 700; // Strichstärken relativ zur Ausgabegröße
  const c = toPx(center);
  if (req.kind === "planned") {
    if (typeof req.radiusKm === "number" && req.radiusKm > 0) {
      const edge = toPx({
        lat: center.lat,
        lon: center.lon + req.radiusKm / (111.32 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180))),
      });
      const rPx = Math.abs(edge.x - c.x);
      parts.push(
        `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${rPx.toFixed(1)}" fill="#0A4D8C" fill-opacity="0.12" stroke="#0A4D8C" stroke-width="${(3 * scale).toFixed(2)}" stroke-dasharray="${(10 * scale).toFixed(1)},${(6 * scale).toFixed(1)}"/>`,
      );
    }
    parts.push(
      `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(8 * scale).toFixed(1)}" fill="#FFFFFF"/>`,
      `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${(5.5 * scale).toFixed(1)}" fill="#0A4D8C"/>`,
    );
  } else {
    const pts = req.route
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(toPx);
    // Punktreduktion für lange Tracks (PDF-Größe begrenzen).
    const step = Math.max(1, Math.floor(pts.length / 1500));
    const reduced = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    const d = reduced.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    parts.push(
      `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${(6 * scale).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`,
      `<path d="${d}" fill="none" stroke="#DC2626" stroke-width="${(3.5 * scale).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    const start = reduced[0];
    const end = reduced[reduced.length - 1];
    if (start) {
      parts.push(
        `<circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="${(8 * scale).toFixed(1)}" fill="#FFFFFF"/>`,
        `<circle cx="${start.x.toFixed(1)}" cy="${start.y.toFixed(1)}" r="${(5.5 * scale).toFixed(1)}" fill="#16A34A"/>`,
      );
    }
    if (end && end !== start) {
      parts.push(
        `<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="${(8 * scale).toFixed(1)}" fill="#FFFFFF"/>`,
        `<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="${(5.5 * scale).toFixed(1)}" fill="#DC2626"/>`,
      );
    }
  }

  // OSM-Attribution (Lizenzpflicht).
  const fs = (11 * scale).toFixed(1);
  parts.push(
    `<rect x="${(vx + vw - 170 * scale).toFixed(1)}" y="${(vy + vh - 18 * scale).toFixed(1)}" width="${(170 * scale).toFixed(1)}" height="${(18 * scale).toFixed(1)}" fill="#FFFFFF" fill-opacity="0.8"/>`,
    `<text x="${(vx + vw - 6 * scale).toFixed(1)}" y="${(vy + vh - 5 * scale).toFixed(1)}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="${fs}" fill="#374151">© OpenStreetMap-Mitwirkende</text>`,
  );

  const outW = 700;
  const outH = Math.round((outW * vh) / vw);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${outW}" height="${outH}" ` +
    `viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" preserveAspectRatio="xMidYMid slice">` +
    parts.join("") +
    `</svg>`;
  return `data:image/svg+xml;base64,${bytesToBase64(utf8Encode(svg))}`;
}

function utf8Encode(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      code = 0x10000 + ((code - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
  }
  return new Uint8Array(out);
}
