// Kleiner, abhängigkeitsfreier KML-Parser (React Native hat keinen DOMParser).
//
// Ziel: Placemarks aus KML-Antworten (z. B. PANSA DroneMap, siehe
// docs/pansa-pl-api-integration.md) lesen – Name, Beschreibung, ExtendedData,
// Folder-Pfad, styleUrl, TimeSpan und Polygon-Geometrien (outerBoundaryIs /
// innerBoundaryIs, auch verschachtelt in MultiGeometry).
//
// Bewusst tolerant: Namespace-Präfixe (kml:Placemark) werden ignoriert,
// Kommentare/CDATA/Processing-Instructions/DOCTYPE übersprungen, nicht
// geschlossene Elemente am Dateiende automatisch geschlossen, unbekannte
// Elemente einfach mitgeführt. Kein Validator – nur so viel XML, wie KML braucht.
// Frei von React-Native-Importen (unter tsx/Node testbar).

// ---------------------------------------------------------------------------
// Minimaler XML-Baum
// ---------------------------------------------------------------------------

export interface XmlElement {
  /** Lokaler Name ohne Namespace-Präfix (z. B. "Placemark"). */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Zusammengefügter direkter Textinhalt (Entities dekodiert, CDATA roh). */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** XML-Entities dekodieren (&amp; &#261; &#x105; …); Unbekanntes bleibt stehen. */
export function decodeXmlEntities(s: string): string {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const v = NAMED_ENTITIES[body];
    return v !== undefined ? v : m;
  });
}

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    attrs[localName(m[1])] = decodeXmlEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return attrs;
}

/**
 * XML-Text in einen schlanken Elementbaum zerlegen. Gibt ein künstliches
 * Wurzelelement "#document" zurück, dessen Kinder die Top-Level-Elemente sind.
 */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  const src = String(xml ?? "").replace(/^\uFEFF/, "");
  let i = 0;
  const n = src.length;
  const top = () => stack[stack.length - 1];

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      top().text += decodeXmlEntities(src.slice(i));
      break;
    }
    if (lt > i) top().text += decodeXmlEntities(src.slice(i, lt));

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      top().text += src.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      // DOCTYPE (ggf. mit internem Subset [...])
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }

    // Tag-Ende unter Berücksichtigung von Anführungszeichen in Attributen finden.
    let j = lt + 1;
    let quote: string | null = null;
    while (j < n) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith("/")) {
      const name = localName(inner.slice(1).trim());
      // Bis zum passenden offenen Element schließen (tolerant bei Fehlverschachtelung).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const m = body.match(/^\s*([^\s/>]+)/);
    if (!m) continue;
    const el: XmlElement = {
      name: localName(m[1]),
      attrs: parseAttrs(body.slice(m[0].length)),
      children: [],
      text: "",
    };
    top().children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

export function childElements(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

export function childElement(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

export function childText(el: XmlElement | undefined, name: string): string | undefined {
  const c = childElement(el, name);
  return c ? c.text.trim() : undefined;
}

/** Alle Nachfahren mit diesem Namen (Tiefensuche, Dokumentreihenfolge). */
export function descendants(el: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (e: XmlElement) => {
    for (const c of e.children) {
      if (c.name === name) out.push(c);
      visit(c);
    }
  };
  visit(el);
  return out;
}

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

/** Koordinate [lon, lat] oder [lon, lat, alt]. */
export type KmlCoord = number[];
/** Polygon: [Außenring, Loch1, …]; Ringe geschlossen, je ≥ 4 Punkte. */
export type KmlPolygon = KmlCoord[][];

export interface KmlPolygonGeometry {
  rings: KmlPolygon;
  altitudeMode?: string;
  extrude?: boolean;
}

export interface KmlPlacemark {
  /** id-Attribut des Placemark (falls vorhanden). */
  id?: string;
  name?: string;
  /** Beschreibung roh (kann HTML enthalten). */
  description?: string;
  styleUrl?: string;
  /** Namen der umschließenden Folder/Document-Elemente, außen → innen. */
  folders: string[];
  /** ExtendedData: <Data name><value> und <SchemaData><SimpleData name>. */
  data: Record<string, string>;
  polygons: KmlPolygonGeometry[];
  /**
   * LineString-Koordinaten (auch aus MultiGeometry), roh. Ob eine geschlossene
   * Linie als Fläche gilt, entscheidet der jeweilige Normalisierer
   * (siehe kmlClosedLineRing). Zählen zusätzlich in otherGeometryCount.
   */
  lineStrings?: KmlCoord[][];
  /** Anzahl sonstiger Geometrien (Point/LineString/…) – nur zur Diagnose. */
  otherGeometryCount: number;
  timeSpan?: { begin?: string; end?: string };
}

/** "lon,lat[,alt] lon,lat[,alt] …" → Koordinatenliste (Ungültiges wird verworfen). */
export function parseKmlCoordinates(text: string | undefined): KmlCoord[] {
  if (!text) return [];
  // Leerzeichen um Kommas tolerieren ("19.1, 50.2").
  const cleaned = text.replace(/\s*,\s*/g, ",").trim();
  if (!cleaned) return [];
  const out: KmlCoord[] = [];
  for (const tuple of cleaned.split(/\s+/)) {
    const parts = tuple.split(",").filter((p) => p !== "");
    if (parts.length < 2) continue;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
    const alt = parts.length >= 3 ? Number(parts[2]) : NaN;
    out.push(Number.isFinite(alt) ? [lon, lat, alt] : [lon, lat]);
  }
  return out;
}

function closeRing(ring: KmlCoord[]): KmlCoord[] | null {
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  const closed = a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a.slice()];
  // Mindestens 3 verschiedene Punkte + Schlusspunkt.
  return closed.length >= 4 ? closed : null;
}

function ringFromBoundary(boundary: XmlElement): KmlCoord[] | null {
  const lr = childElement(boundary, "LinearRing") ?? descendants(boundary, "LinearRing")[0];
  const coordsEl = lr ? childElement(lr, "coordinates") : childElement(boundary, "coordinates");
  return closeRing(parseKmlCoordinates(coordsEl?.text));
}

function parsePolygon(el: XmlElement): KmlPolygonGeometry | null {
  const outerEl = childElement(el, "outerBoundaryIs");
  if (!outerEl) return null;
  const outer = ringFromBoundary(outerEl);
  if (!outer) return null;
  const rings: KmlPolygon = [outer];
  for (const inner of childElements(el, "innerBoundaryIs")) {
    // Manche Erzeuger packen mehrere LinearRings in EIN innerBoundaryIs.
    const lrs = childElements(inner, "LinearRing");
    if (lrs.length > 1) {
      for (const lr of lrs) {
        const r = closeRing(parseKmlCoordinates(childText(lr, "coordinates")));
        if (r) rings.push(r);
      }
    } else {
      const r = ringFromBoundary(inner);
      if (r) rings.push(r);
    }
  }
  // gx:altitudeMode landet dank Präfix-Entfernung ebenfalls unter "altitudeMode".
  const altitudeMode = childText(el, "altitudeMode");
  const extrudeTxt = childText(el, "extrude");
  return {
    rings,
    altitudeMode: altitudeMode || undefined,
    extrude: extrudeTxt != null ? extrudeTxt === "1" || extrudeTxt.toLowerCase() === "true" : undefined,
  };
}

const GEOMETRY_NAMES = new Set(["Point", "LineString", "LinearRing", "Model", "Track", "MultiTrack"]);

function collectGeometry(el: XmlElement, pm: KmlPlacemark): void {
  for (const c of el.children) {
    if (c.name === "Polygon") {
      const p = parsePolygon(c);
      if (p) pm.polygons.push(p);
    } else if (c.name === "MultiGeometry") {
      collectGeometry(c, pm);
    } else if (GEOMETRY_NAMES.has(c.name)) {
      pm.otherGeometryCount++;
      if (c.name === "LineString") {
        const coords = parseKmlCoordinates(childText(c, "coordinates"));
        if (coords.length >= 2) {
          if (!pm.lineStrings) pm.lineStrings = [];
          pm.lineStrings.push(coords);
        }
      }
    }
  }
}

function parseExtendedData(el: XmlElement | undefined, out: Record<string, string>): void {
  if (!el) return;
  for (const d of childElements(el, "Data")) {
    const key = d.attrs.name;
    if (!key) continue;
    const v = childText(d, "value") ?? d.text.trim();
    out[key] = v;
    const dn = childText(d, "displayName");
    if (dn && !(`${key}__displayName` in out)) out[`${key}__displayName`] = dn;
  }
  for (const sd of childElements(el, "SchemaData")) {
    for (const s of childElements(sd, "SimpleData")) {
      if (s.attrs.name) out[s.attrs.name] = s.text.trim();
    }
  }
}

function parsePlacemark(el: XmlElement, folders: string[]): KmlPlacemark {
  const pm: KmlPlacemark = {
    id: el.attrs.id || undefined,
    name: childText(el, "name") || undefined,
    description: childText(el, "description") || undefined,
    styleUrl: childText(el, "styleUrl") || undefined,
    folders,
    data: {},
    polygons: [],
    otherGeometryCount: 0,
  };
  parseExtendedData(childElement(el, "ExtendedData"), pm.data);
  const ts = childElement(el, "TimeSpan");
  if (ts) {
    const begin = childText(ts, "begin");
    const end = childText(ts, "end");
    if (begin || end) pm.timeSpan = { begin: begin || undefined, end: end || undefined };
  }
  collectGeometry(el, pm);
  return pm;
}

/** Alle Placemarks eines KML-Dokuments (inkl. Folder-Pfad) lesen. */
export function parseKmlPlacemarks(kml: string): KmlPlacemark[] {
  const root = parseXml(kml);
  const out: KmlPlacemark[] = [];
  const walk = (el: XmlElement, folders: string[]) => {
    for (const c of el.children) {
      if (c.name === "Placemark") {
        out.push(parsePlacemark(c, folders));
      } else if (c.name === "Folder" || c.name === "Document") {
        const nm = childText(c, "name");
        walk(c, nm ? [...folders, nm] : folders);
      } else if (c.name === "kml" || c.name === "#document") {
        walk(c, folders);
      } else if (c.children.length > 0 && c.name !== "Style" && c.name !== "StyleMap" && c.name !== "Schema") {
        // Unbekannte Container (z. B. NetworkLinkControl-Varianten) trotzdem durchsuchen.
        walk(c, folders);
      }
    }
  };
  walk(root, []);
  return out;
}

/**
 * Geschlossene LineString (erster == letzter Punkt) mit mindestens drei
 * verschiedenen Punkten → Ring; sonst null. Offene Linien und entartete
 * „Hin-und-zurück“-Linien (A→B→A, z. B. 3D-Wandsegmente aus Google My Maps)
 * sind keine Fläche.
 */
export function kmlClosedLineRing(coords: KmlCoord[]): KmlCoord[] | null {
  if (coords.length < 4) return null;
  const a = coords[0];
  const b = coords[coords.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) return null;
  const distinct = new Set(coords.map((c) => `${c[0]},${c[1]}`));
  return distinct.size >= 3 ? coords : null;
}

/** Placemark-Polygone → GeoJSON-Geometrie (2D, Lon/Lat) oder null. */
export function kmlPlacemarkToGeoJsonGeometry(
  pm: KmlPlacemark,
  opts: { decimals?: number } = {},
): { type: "Polygon" | "MultiPolygon"; coordinates: any } | null {
  if (pm.polygons.length === 0) return null;
  const f = Math.pow(10, opts.decimals ?? 6);
  const round = (v: number) => Math.round(v * f) / f;
  const polys = pm.polygons.map((p) => p.rings.map((r) => r.map((c) => [round(c[0]), round(c[1])])));
  return polys.length === 1
    ? { type: "Polygon", coordinates: polys[0] }
    : { type: "MultiPolygon", coordinates: polys };
}

/**
 * Einfache HTML-Tabelle aus einer Beschreibung (<tr><td>Key</td><td>Wert</td></tr>
 * bzw. <th>/<td>) als Schlüssel/Wert lesen. Viele KML-Exporte (GeoServer, QGIS,
 * ArcGIS) legen Attribute so in <description> ab.
 */
export function kmlDescriptionTable(html: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!html || !/<t[dh][\s>]/i.test(html)) return out;
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cells.length !== 2) continue;
    const [k, v] = cells.map((c) => htmlToText(c));
    if (k) out[k.replace(/:\s*$/, "")] = v;
  }
  return out;
}

/** HTML → Klartext (Zeilenumbrüche für <br>/<p>/<tr>, Tags entfernt, Entities dekodiert). */
export function htmlToText(html: string | undefined): string {
  if (!html) return "";
  const s = html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(s)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
