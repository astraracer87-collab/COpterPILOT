// Kleiner, abhängigkeitsfreier WKT-Parser (Well-Known Text → GeoJSON-Geometrie).
//
// Unterstützt (Groß-/Kleinschreibung egal, beliebige Leerzeichen):
//  - POINT, MULTIPOINT (beide Schreibweisen „(1 2, 3 4)“ und „((1 2), (3 4))“)
//  - LINESTRING, MULTILINESTRING
//  - POLYGON (inkl. Löcher), MULTIPOLYGON (inkl. Löcher)
//  - GEOMETRYCOLLECTION (rekursiv)
//  - Nicht-Standard „CIRCLE (lon lat, radius_m)“ bzw. „CIRCLE (lon lat radius_m)“
//    (manche AMC-/Luftraum-Systeme nutzen das) → Polygon-Annäherung.
//  - Optionale Präfixe „SRID=4326;“ sowie Dimensionskennungen Z/M/ZM
//    (zusätzliche Ordinaten werden verworfen) und „EMPTY“.
//
// Koordinaten werden in voller Präzision übernommen (kein Runden). Offene Ringe
// werden geschlossen (erster Punkt am Ende wiederholt); Ringe mit < 3
// verschiedenen Punkten verworfen. Achsreihenfolge bleibt wie im WKT (bei
// EPSG:4326-WKT der AMC: „lon lat“ = GeoJSON-Reihenfolge).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

export type WktPosition = [number, number];

export type WktGeometry =
  | { type: "Point"; coordinates: WktPosition }
  | { type: "MultiPoint"; coordinates: WktPosition[] }
  | { type: "LineString"; coordinates: WktPosition[] }
  | { type: "MultiLineString"; coordinates: WktPosition[][] }
  | { type: "Polygon"; coordinates: WktPosition[][] }
  | { type: "MultiPolygon"; coordinates: WktPosition[][][] }
  | { type: "GeometryCollection"; geometries: WktGeometry[] };

/** Fehler beim Parsen (Position im Eingabetext zur Diagnose). */
export class WktParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`${message} (Position ${position})`);
    this.name = "WktParseError";
  }
}

/** Segmentzahl für die Kreis-Annäherung (CIRCLE). */
export const WKT_CIRCLE_SEGMENTS = 64;

const EARTH_RADIUS_M = 6_371_008.8;

/** Kreis (Mittelpunkt lon/lat, Radius in Metern) → geschlossener Ring. */
export function wktCircleRing(lon: number, lat: number, radiusM: number, segments: number = WKT_CIRCLE_SEGMENTS): WktPosition[] {
  const ring: WktPosition[] = [];
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const d = radiusM / EARTH_RADIUS_M;
  for (let i = 0; i < segments; i++) {
    const brg = (2 * Math.PI * i) / segments;
    const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(brg));
    const lon2 = lonR + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(lat2));
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

// ---------------------------------------------------------------------------
// Tokenizer / rekursiver Abstieg
// ---------------------------------------------------------------------------

class Reader {
  pos = 0;
  constructor(public readonly s: string) {}

  skipWs(): void {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
  }

  peek(): string {
    this.skipWs();
    return this.s[this.pos] ?? "";
  }

  expect(ch: string): void {
    this.skipWs();
    if (this.s[this.pos] !== ch) throw new WktParseError(`„${ch}“ erwartet, „${this.s[this.pos] ?? "Ende"}“ gefunden`, this.pos);
    this.pos++;
  }

  tryConsume(ch: string): boolean {
    this.skipWs();
    if (this.s[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  word(): string {
    this.skipWs();
    const m = /^[A-Za-z_]+/.exec(this.s.slice(this.pos));
    if (!m) return "";
    this.pos += m[0].length;
    return m[0].toUpperCase();
  }

  number(): number | null {
    this.skipWs();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.pos));
    if (!m) return null;
    this.pos += m[0].length;
    return Number(m[0]);
  }
}

/** Eine Position („x y [z [m]]“); weitere Ordinaten werden verworfen. */
function readPosition(r: Reader): WktPosition {
  const x = r.number();
  const y = r.number();
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new WktParseError("Koordinatenpaar erwartet", r.pos);
  }
  // Optionale Z/M-Werte überspringen.
  while (r.number() != null) {
    /* ignorieren */
  }
  return [x, y];
}

/** „(x y, x y, …)“ */
function readPositionList(r: Reader): WktPosition[] {
  r.expect("(");
  const out: WktPosition[] = [readPosition(r)];
  while (r.tryConsume(",")) out.push(readPosition(r));
  r.expect(")");
  return out;
}

/** MULTIPOINT: „(1 2, 3 4)“ oder „((1 2), (3 4))“. */
function readMultiPointList(r: Reader): WktPosition[] {
  r.expect("(");
  const out: WktPosition[] = [];
  do {
    if (r.peek() === "(") {
      r.expect("(");
      out.push(readPosition(r));
      r.expect(")");
    } else out.push(readPosition(r));
  } while (r.tryConsume(","));
  r.expect(")");
  return out;
}

function readListOf<T>(r: Reader, item: (r: Reader) => T): T[] {
  r.expect("(");
  const out: T[] = [item(r)];
  while (r.tryConsume(",")) out.push(item(r));
  r.expect(")");
  return out;
}

/** Ring schließen, aufeinanderfolgende identische Punkte bleiben erhalten. */
function closeRing(ring: WktPosition[]): WktPosition[] | null {
  if (ring.length === 0) return null;
  const distinct = new Set(ring.map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, [first[0], first[1]]];
  return ring;
}

function readPolygonRings(r: Reader): WktPosition[][] {
  const rings = readListOf(r, readPositionList);
  const out: WktPosition[][] = [];
  for (let i = 0; i < rings.length; i++) {
    const closed = closeRing(rings[i]);
    if (closed) out.push(closed);
    else if (i === 0) return []; // ohne gültigen Außenring ist das Polygon leer
  }
  return out;
}

function readDimensionTag(r: Reader): void {
  // Optional „Z“, „M“, „ZM“ vor der Klammer bzw. vor EMPTY.
  const save = r.pos;
  const w = r.word();
  if (w === "Z" || w === "M" || w === "ZM") return;
  r.pos = save;
}

function readIsEmpty(r: Reader): boolean {
  const save = r.pos;
  if (r.word() === "EMPTY") return true;
  r.pos = save;
  return false;
}

function readGeometry(r: Reader): WktGeometry | null {
  const start = r.pos;
  const type = r.word();
  if (!type) throw new WktParseError("Geometrietyp erwartet", start);
  readDimensionTag(r);
  if (readIsEmpty(r)) return null;
  switch (type) {
    case "POINT": {
      r.expect("(");
      const p = readPosition(r);
      r.expect(")");
      return { type: "Point", coordinates: p };
    }
    case "MULTIPOINT":
      return { type: "MultiPoint", coordinates: readMultiPointList(r) };
    case "LINESTRING":
      return { type: "LineString", coordinates: readPositionList(r) };
    case "MULTILINESTRING":
      return { type: "MultiLineString", coordinates: readListOf(r, readPositionList) };
    case "POLYGON": {
      const rings = readPolygonRings(r);
      return rings.length > 0 ? { type: "Polygon", coordinates: rings } : null;
    }
    case "MULTIPOLYGON": {
      const polys = readListOf(r, readPolygonRings).filter((p) => p.length > 0);
      if (polys.length === 0) return null;
      return { type: "MultiPolygon", coordinates: polys };
    }
    case "CIRCLE": {
      // Nicht-Standard: CIRCLE(lon lat, radius) oder CIRCLE(lon lat radius).
      r.expect("(");
      const x = r.number();
      const y = r.number();
      r.tryConsume(",");
      const rad = r.number();
      r.expect(")");
      if (x == null || y == null || rad == null || !(rad > 0)) throw new WktParseError("CIRCLE(lon lat, radius) erwartet", start);
      return { type: "Polygon", coordinates: [wktCircleRing(x, y, rad)] };
    }
    case "GEOMETRYCOLLECTION": {
      const geoms = readListOf(r, readGeometry).filter((g): g is WktGeometry => g != null);
      return { type: "GeometryCollection", geometries: geoms };
    }
    default:
      throw new WktParseError(`Unbekannter WKT-Typ „${type}“`, start);
  }
}

/**
 * Parst einen WKT-String. Wirft `WktParseError` bei Syntaxfehlern; liefert
 * null für leere Geometrien (EMPTY, Polygon ohne gültigen Außenring).
 */
export function parseWkt(input: string): WktGeometry | null {
  let s = String(input ?? "").trim();
  const srid = /^SRID=\d+;/i.exec(s);
  if (srid) s = s.slice(srid[0].length);
  if (!s) return null;
  const r = new Reader(s);
  const g = readGeometry(r);
  r.skipWs();
  if (r.pos < s.length) throw new WktParseError("Unerwarteter Text nach der Geometrie", r.pos);
  return g;
}

/** Wie parseWkt, aber ohne Ausnahme (null bei Fehler). */
export function tryParseWkt(input: unknown): WktGeometry | null {
  if (typeof input !== "string") return null;
  try {
    return parseWkt(input);
  } catch {
    return null;
  }
}

/**
 * Nur flächenhafte Anteile (Polygon/MultiPolygon, auch aus einer
 * GeometryCollection) als Polygon bzw. MultiPolygon; sonst null.
 */
export function wktToAreaGeometry(
  input: unknown,
): { type: "Polygon"; coordinates: WktPosition[][] } | { type: "MultiPolygon"; coordinates: WktPosition[][][] } | null {
  const g = tryParseWkt(input);
  if (!g) return null;
  const polys: WktPosition[][][] = [];
  const visit = (x: WktGeometry) => {
    if (x.type === "Polygon") polys.push(x.coordinates);
    else if (x.type === "MultiPolygon") polys.push(...x.coordinates);
    else if (x.type === "GeometryCollection") x.geometries.forEach(visit);
  };
  visit(g);
  if (polys.length === 0) return null;
  if (polys.length === 1) return { type: "Polygon", coordinates: polys[0] };
  return { type: "MultiPolygon", coordinates: polys };
}
