// Polen (PANSA / PAŻP DroneMap) – Normalisierung der KML-Antwort auf das
// App-Format (GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo
// in client/lib/ed269.ts liest). Siehe docs/pansa-pl-api-integration.md.
//
// ⚠️ Die KML-Struktur ist NICHT aus einem Live-Abruf verifiziert (api.dronemap.
// pansa.pl ist nur von EU-/PL-IPs erreichbar). Der Normalisierer ist deshalb
// bewusst tolerant und liest Typ und Höhen aus mehreren möglichen Stellen:
//
// Zonentyp (erster Treffer gewinnt):
//   1. ExtendedData-Felder  type | typ | zoneType | zone_type | kind | rodzaj |
//      class | airspaceType | layer | category (wenn dort ein Code steht)
//   2. Placemark-<name>
//   3. umschließende Folder-Namen
//   4. <styleUrl> (z. B. "#DRA-P", "#style_DRAR")
//   Codes: DRAP/DRA-P/ATZ1KM/ATZ6KM/CTR1KM/CTR6KM/MCTR2KM → PROHIBITED,
//          DRAR/DRA-R → REQ_AUTHORISATION, DRAI/DRA-I → CONDITIONAL,
//          Luftraumstrukturen (CTR, TMA, ATZ, …) → NO_RESTRICTION (Info, nur mit
//          includeAirspace).
//
// Höhen (Meter; ft → m, FL → ft·100 → m, MSL-Bezug):
//   - getrennte Felder: lowerLimit | lower | minAltitude | minAlt | altMin |
//     altFrom | min | bottom | floor | minHeight | hMin | dolnaGranica | dolna
//     bzw. upperLimit | upper | maxAltitude | maxAlt | altMax | altTo | max | top |
//     ceiling | maxHeight | hMax | gornaGranica | gorna
//     (+ optional uom | unit | units | jednostka und lowerReference /
//     upperReference / reference / altitudeReference)
//   - kombiniertes Feld: altitude | height | wysokosc | limits | verticalLimits
//     ("GND - 120 m AGL", "0-150m n.p.t.")
//   - Werte dürfen Einheit/Bezug enthalten: "120 m AGL", "500 ft AMSL", "FL95",
//     "GND", "SFC", "UNL", "120 m n.p.t." (AGL), "300 m n.p.m." (AMSL).
//   - Quellen in dieser Reihenfolge: ExtendedData → HTML-Tabelle bzw.
//     "Schlüssel: Wert"-Zeilen in <description> → einheitliche Polygon-Höhe
//     (z-Koordinate) bei altitudeMode relativeToGround/absolute als Obergrenze.
//   - Kategorie G1–G4: Feld category | kategoria | geozoneCategory | group
//     (Bedeutung laut Doku offen → nur angezeigt, nicht interpretiert).
//
// Polnische Texte bleiben unverändert (die App übersetzt separat).
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import {
  htmlToText,
  kmlDescriptionTable,
  kmlPlacemarkToGeoJsonGeometry,
  parseKmlPlacemarks,
  type KmlPlacemark,
} from "./kmlParse";

export const PL_GEOZONE_SOURCE_LABEL = "PANSA DroneMap";
export const PL_ATTRIBUTION = "© Polska Agencja Żeglugi Powietrznej (PAŻP)";

export const PANSA_API_BASE = "https://api.dronemap.pansa.pl";
export const PANSA_LOGIN_URL = `${PANSA_API_BASE}/v1/front/login`;
export const PANSA_KML_URL = `${PANSA_API_BASE}/v1/kml/filtered`;
export const PANSA_WEB_ORIGIN = "https://dronemap.pansa.pl";
/** Öffentlicher Standard-Key aus dem offiziellen QGIS-Plugin (siehe Doku §1). */
export const PANSA_DEFAULT_API_KEY = "4b705300-8dfa-11ee-b9d1-0242ac120002";
/** AUP/UUP (heute aktive Luftraum-Aktivierungen) – nur als Link, siehe Doku §4. */
export const PANSA_AUP_URL = "https://airspace.pansa.pl/aup/current";

/** Drohnen-Geozonen (Kern) – reicht für Geo-Awareness (Doku §3). */
export const PL_DRONE_ZONE_TYPES = ["DRAP", "DRAR", "DRAI"] as const;
/** Optionale Luftraumstrukturen (Doku §3). */
export const PL_AIRSPACE_TYPES = [
  "CTR", "TMA", "ATZ", "MCTR", "MTMA", "MATZ", "RMZ", "ADIZ",
  "TRA", "TSA", "MRT", "TFR", "RPA", "P", "R", "D",
] as const;

/**
 * Höhenfilter: Werte ≥ 500 m deaktivieren den Filter serverseitig; das QGIS-
 * Plugin sendet dann max=3000. Wir übernehmen genau diesen Wire-Wert.
 */
export const PANSA_MAX_NO_FILTER = 3000;

export function buildPansaKmlUrl(
  types: readonly string[] = PL_DRONE_ZONE_TYPES,
  maxMeters: number = PANSA_MAX_NO_FILTER,
): string {
  const max = !Number.isFinite(maxMeters) || maxMeters >= 500 ? PANSA_MAX_NO_FILTER : Math.max(0, Math.round(maxMeters));
  // Kommas bewusst unkodiert lassen (wie Plugin/curl in der Doku).
  return `${PANSA_KML_URL}?extrude=false&types=${types.map(encodeURIComponent).join(",")}&max=${max}`;
}

/** Bearer-Token aus der Login-Antwort lesen ({ token } laut Plugin; Varianten tolerant). */
export function parsePansaLoginToken(body: unknown): string | null {
  if (typeof body === "string") {
    const t = body.trim();
    if (!t) return null;
    if (t.startsWith("{")) {
      try {
        return parsePansaLoginToken(JSON.parse(t));
      } catch {
        return null;
      }
    }
    return /^[A-Za-z0-9._~+/=-]{16,}$/.test(t) ? t : null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  for (const k of ["token", "accessToken", "access_token", "jwt", "bearer"]) {
    if (typeof b[k] === "string" && b[k].trim()) return b[k].trim();
  }
  if (b.data && typeof b.data === "object") return parsePansaLoginToken(b.data);
  return null;
}

// ---------------------------------------------------------------------------
// Typ-Erkennung
// ---------------------------------------------------------------------------

export type PlZoneClass = "DRAP" | "DRAR" | "DRAI" | "AIRSPACE";

export interface PlZoneType {
  /** Gefundener Code in kanonischer Schreibweise, z. B. "DRA-P", "ATZ6KM", "CTR". */
  code: string;
  cls: PlZoneClass;
  restriction: "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL" | "NO_RESTRICTION";
}

const DRAP_RING_CODES = ["ATZ1KM", "ATZ6KM", "CTR1KM", "CTR6KM", "MCTR2KM"];

function canon(s: string): string {
  let v = s;
  try {
    // NFD kann in JS-Engines ohne Intl fehlen → dann ohne Diakritika-Entfernung.
    v = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    /* unverändert */
  }
  return v.replace(/[łŁ]/g, "l").toUpperCase();
}

function droneType(code: string): PlZoneType | null {
  const c = code.replace(/[\s_-]+/g, "");
  if (c === "DRAP") return { code: "DRA-P", cls: "DRAP", restriction: "PROHIBITED" };
  if (c === "DRAR") return { code: "DRA-R", cls: "DRAR", restriction: "REQ_AUTHORISATION" };
  if (c === "DRAI") return { code: "DRA-I", cls: "DRAI", restriction: "CONDITIONAL" };
  if (DRAP_RING_CODES.includes(c)) return { code: c, cls: "DRAP", restriction: "PROHIBITED" };
  return null;
}

const DRONE_CODE_RE = /(?:^|[^A-Z0-9])(DRA[\s_-]?[PRI]|ATZ[16][\s_-]?KM|CTR[16][\s_-]?KM|MCTR[\s_-]?2[\s_-]?KM)(?=$|[^A-Z0-9])/;
// Mehrbuchstabige Luftraumcodes im Freitext; P/R/D nur aus expliziten Typfeldern.
const AIRSPACE_CODE_RE = /(?:^|[^A-Z0-9])(MCTR|MTMA|MATZ|CTR|TMA|ATZ|RMZ|ADIZ|TRA|TSA|MRT|TFR|RPA)(?=$|[^A-Z0-9])/;

/** Code aus einem expliziten Typfeld (exakter Wert) bestimmen. */
export function classifyPolishTypeValue(raw: string | undefined): PlZoneType | null {
  if (!raw) return null;
  const v = canon(raw).trim();
  if (!v) return null;
  const d = droneType(v);
  if (d) return d;
  const compact = v.replace(/[\s_-]+/g, "");
  if ((PL_AIRSPACE_TYPES as readonly string[]).includes(compact)) {
    return { code: compact, cls: "AIRSPACE", restriction: "NO_RESTRICTION" };
  }
  return classifyPolishTypeText(raw);
}

/** Code in Freitext (Name, Folder, styleUrl) suchen. Drohnen-Codes haben Vorrang. */
export function classifyPolishTypeText(raw: string | undefined): PlZoneType | null {
  if (!raw) return null;
  const v = canon(raw);
  const m = v.match(DRONE_CODE_RE);
  if (m) return droneType(m[1]);
  const a = v.match(AIRSPACE_CODE_RE);
  if (a) return { code: a[1], cls: "AIRSPACE", restriction: "NO_RESTRICTION" };
  return null;
}

// ---------------------------------------------------------------------------
// Attribut-Lookup (Schlüssel case-/trennzeichen-/diakritika-unabhängig)
// ---------------------------------------------------------------------------

function normKey(k: string): string {
  return canon(k).toLowerCase().replace(/[^a-z0-9]/g, "");
}

type Attrs = Map<string, { key: string; value: string }>;

function addAttrs(target: Attrs, src: Record<string, string>): void {
  for (const [k, v] of Object.entries(src)) {
    if (k.endsWith("__displayName")) continue;
    const nk = normKey(k);
    if (!nk || target.has(nk)) continue;
    const val = String(v ?? "").trim();
    if (val) target.set(nk, { key: k, value: val });
  }
}

function pick(attrs: Attrs, keys: string[]): string | undefined {
  for (const k of keys) {
    const hit = attrs.get(k);
    if (hit) return hit.value;
  }
  return undefined;
}

/** "Schlüssel: Wert"-Zeilen aus einem Klartext. */
function keyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([^:\n]{1,40}?)\s*:\s*(.+?)\s*$/);
    if (m && !/^https?$/i.test(m[1])) out[m[1]] = m[2];
  }
  return out;
}

const TYPE_KEYS = ["type", "typ", "zonetype", "kind", "rodzaj", "class", "airspacetype", "layer", "category"];
const LOWER_KEYS = [
  "lowerlimit", "lower", "lowermeters", "minaltitude", "minalt", "altmin", "altfrom", "min", "bottom",
  "floor", "minheight", "hmin", "dolnagranica", "dolna",
];
const UPPER_KEYS = [
  "upperlimit", "upper", "uppermeters", "maxaltitude", "maxalt", "altmax", "altto", "max", "top",
  "ceiling", "maxheight", "hmax", "gornagranica", "gorna",
];
const RANGE_KEYS = ["altitude", "height", "wysokosc", "limits", "verticallimits", "altitudes"];
const UNIT_KEYS = ["uom", "unit", "units", "uomdimensions", "jednostka"];
const REF_KEYS = ["reference", "altitudereference", "verticalreference", "ref"];
const CATEGORY_KEYS = ["category", "kategoria", "geozonecategory", "group", "grupa"];
const ID_KEYS = ["id", "identifier", "zoneid", "designator", "code", "kod", "oznaczenie"];
const NAME_KEYS = ["name", "nazwa", "zonename"];
const REMARK_KEYS = ["remarks", "remark", "uwagi", "message", "info", "opis", "comment", "notes"];
const START_KEYS = ["validfrom", "startdate", "datefrom", "effectivefrom", "activefrom", "od", "begin", "start"];
const END_KEYS = ["validto", "validuntil", "enddate", "dateto", "effectiveto", "activeto", "do", "end"];

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

const FT = 0.3048;

export interface PlAltitude {
  /** Meter; undefined bei unbegrenzt. */
  meters?: number;
  unlimited?: boolean;
  reference?: "AGL" | "AMSL";
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function refFrom(s: string): "AGL" | "AMSL" | undefined {
  const v = canon(s).replace(/\./g, "").replace(/\s+/g, " ");
  if (/\b(AMSL|MSL|NPM|STD)\b/.test(v)) return "AMSL";
  if (/\b(AGL|GND|SFC|NPT)\b/.test(v)) return "AGL";
  return undefined;
}

/** Einzelnen Höhenwert ("120 m AGL", "FL95", "GND", "UNL", "500") lesen. */
export function parsePolishAltitude(raw: string | undefined, unitHint?: string, refHint?: string): PlAltitude | null {
  if (raw == null) return null;
  const s = canon(String(raw)).trim();
  if (!s) return null;
  if (/^(GND|SFC|0)$/.test(s)) return { meters: 0, reference: "AGL" };
  if (/^(UNL|UNLIMITED|BRAK|NONE|-)$/.test(s)) return { unlimited: true };
  const fl = s.match(/\bFL\s*(\d{1,3})\b/);
  if (fl) return { meters: round1(Number(fl[1]) * 100 * FT), reference: "AMSL" };
  const m = s.match(/(-?\d+(?:[.,]\d+)?)\s*(FT|FEET|F|M|METERS|METRES|METROW|M\.)?/);
  if (!m) {
    if (/\b(GND|SFC)\b/.test(s)) return { meters: 0, reference: "AGL" };
    if (/\bUNL\b/.test(s)) return { unlimited: true };
    return null;
  }
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? canon(unitHint ?? "")).replace(/\./g, "").trim();
  const isFt = unit === "FT" || unit === "FEET" || unit === "F";
  const reference = refFrom(s) ?? (refHint ? refFrom(refHint) : undefined);
  return { meters: round1(isFt ? n * FT : n), reference };
}

/** Bereich "GND - 120 m AGL" / "0-150m n.p.t." → [unten, oben]. */
export function parsePolishAltitudeRange(raw: string | undefined, unitHint?: string, refHint?: string): [PlAltitude | null, PlAltitude | null] {
  if (!raw) return [null, null];
  // Ohne Lookbehind (Hermes-kompatibel): Untergrenze ist GND/SFC oder eine Zahl
  // mit optionaler Einheit/Bezug, danach ein Trennstrich/Schrägstrich.
  const m = String(raw).match(
    /^\s*(GND|SFC|\d+(?:[.,]\d+)?\s*(?:m|ft)?\.?(?:\s*(?:AGL|AMSL|MSL|n\.?p\.?[tm]\.?))?)\s*(?:-|–|—|\/)\s*(.+?)\s*$/i,
  );
  if (!m) return [null, parsePolishAltitude(raw, unitHint, refHint)];
  const parts = [m[1], m[2]];
  // Einheit/Bezug, die nur am Ende steht ("0-120 m AGL"), auf beide Werte anwenden.
  const tail = parts[parts.length - 1];
  const tailUnit = /(\d|\b)\s*ft\b/i.test(tail) ? "FT" : unitHint;
  const tailRef = refFrom(tail) ? tail : refHint;
  return [parsePolishAltitude(parts[0], tailUnit, tailRef), parsePolishAltitude(tail, unitHint, refHint)];
}

function altitudesFromAttrs(attrs: Attrs): { lower: PlAltitude | null; upper: PlAltitude | null } {
  const unit = pick(attrs, UNIT_KEYS);
  const ref = pick(attrs, REF_KEYS);
  let lower = parsePolishAltitude(pick(attrs, LOWER_KEYS), unit, pick(attrs, ["lowerreference", "lowerref"]) ?? ref);
  let upper = parsePolishAltitude(pick(attrs, UPPER_KEYS), unit, pick(attrs, ["upperreference", "upperref"]) ?? ref);
  if (!lower && !upper) {
    const [lo, up] = parsePolishAltitudeRange(pick(attrs, RANGE_KEYS), unit, ref);
    lower = lo;
    upper = up;
  }
  return { lower, upper };
}

function altitudeFromGeometry(pm: KmlPlacemark): PlAltitude | null {
  let alt: number | null = null;
  let mode: string | undefined;
  for (const p of pm.polygons) {
    mode = mode ?? p.altitudeMode;
    for (const r of p.rings) {
      for (const c of r) {
        if (c.length < 3) return null;
        if (alt === null) alt = c[2];
        else if (Math.abs(c[2] - alt) > 0.5) return null;
      }
    }
  }
  if (alt === null || !(alt > 0)) return null;
  const m = (mode ?? "").toLowerCase();
  if (m === "relativetoground") return { meters: round1(alt), reference: "AGL" };
  if (m === "absolute") return { meters: round1(alt), reference: "AMSL" };
  return null; // clampToGround (Default): z-Wert wird ignoriert
}

// ---------------------------------------------------------------------------
// Gültigkeit
// ---------------------------------------------------------------------------

/** ISO-Datum oder polnisch "DD.MM.YYYY[ HH:MM]" (als UTC) → ms. */
export function parsePolishDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  const pl = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (pl) {
    const t = Date.UTC(Number(pl[3]), Number(pl[2]) - 1, Number(pl[1]), Number(pl[4] ?? 0), Number(pl[5] ?? 0));
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

export type PlFeature = { type: "Feature"; id?: string; geometry: any; properties: Record<string, any> };

export interface PlNormalizeOptions {
  /** Luftraumstrukturen (CTR/TMA/…) als Info-Zonen übernehmen. Default false. */
  includeAirspace?: boolean;
  /**
   * Placemarks ohne erkennbaren Typ: vorsorglich als genehmigungspflichtig
   * darstellen (Default) oder verwerfen. Angefragt werden nur DRAP/DRAR/DRAI –
   * ein unbekannter Typ ist also sicher eine Drohnenzone.
   */
  unknownAs?: "REQ_AUTHORISATION" | "skip";
}

function placemarkType(pm: KmlPlacemark, attrs: Attrs): PlZoneType | null {
  for (const k of TYPE_KEYS) {
    const hit = attrs.get(k);
    const t = hit ? classifyPolishTypeValue(hit.value) : null;
    if (t) return t;
  }
  const fromText =
    classifyPolishTypeText(pm.name) ??
    [...pm.folders].reverse().map(classifyPolishTypeText).find((t) => !!t) ??
    classifyPolishTypeText(pm.styleUrl?.replace(/^.*#/, ""));
  return fromText ?? null;
}

function geozoneCategory(attrs: Attrs, pm: KmlPlacemark): string | undefined {
  const v = pick(attrs, CATEGORY_KEYS);
  const m = (v ? canon(v) : "").match(/\bG\s?([1-4])\b/);
  if (m) return `G${m[1]}`;
  const s = canon(pm.styleUrl ?? "").match(/(?:^|[^A-Z0-9])G([1-4])(?=$|[^A-Z0-9])/);
  return s ? `G${s[1]}` : undefined;
}

export function normalizePolishPlacemark(pm: KmlPlacemark, opts: PlNormalizeOptions = {}): PlFeature | null {
  const geometry = kmlPlacemarkToGeoJsonGeometry(pm);
  if (!geometry) return null;

  // Attribute: ExtendedData hat Vorrang vor Beschreibungs-Tabelle/-Zeilen.
  const attrs: Attrs = new Map();
  addAttrs(attrs, pm.data);
  const table = kmlDescriptionTable(pm.description);
  const descText = htmlToText(pm.description);
  const descAttrs = Object.keys(table).length > 0 ? table : keyValueLines(descText);
  const dataAttrCount = attrs.size;
  addAttrs(attrs, descAttrs);

  let type = placemarkType(pm, attrs);
  let typeUnknown = false;
  if (!type) {
    if (opts.unknownAs === "skip") return null;
    type = { code: "DRA", cls: "DRAR", restriction: "REQ_AUTHORISATION" };
    typeUnknown = true;
  }
  if (type.cls === "AIRSPACE" && !opts.includeAirspace) return null;

  // Höhen
  const dataOnly: Attrs = new Map([...attrs].slice(0, dataAttrCount));
  let { lower, upper } = altitudesFromAttrs(dataOnly);
  let altitudeSource: "extendedData" | "description" | "geometry" | "none" = lower || upper ? "extendedData" : "none";
  if (!lower && !upper) {
    ({ lower, upper } = altitudesFromAttrs(attrs));
    if (lower || upper) altitudeSource = "description";
  }
  if (!upper) {
    const g = altitudeFromGeometry(pm);
    if (g) {
      upper = g;
      if (altitudeSource === "none") altitudeSource = "geometry";
    }
  }
  const lowerMeters = lower?.meters ?? 0;
  const lowerReference = lower?.reference ?? (lowerMeters === 0 ? "AGL" : upper?.reference ?? "AGL");
  const upperReference = upper?.reference ?? lower?.reference ?? "AGL";

  const name = pm.name ?? pick(attrs, NAME_KEYS) ?? pick(attrs, ID_KEYS) ?? type.code;
  const identifier = pm.id ?? pick(attrs, ID_KEYS) ?? `${type.code}:${name}`;
  const category = geozoneCategory(attrs, pm);

  // Beschreibung (Polnisch, unverändert) + kurze Kontextzeilen.
  const lines: string[] = [];
  if (Object.keys(table).length > 0) {
    for (const [k, v] of Object.entries(table)) if (v) lines.push(`${k}: ${v}`);
  } else if (descText) {
    lines.push(descText);
  }
  const remark = pick(attrs, REMARK_KEYS);
  if (remark && !lines.some((l) => l.includes(remark))) lines.push(remark);
  lines.push(`PANSA-Zonentyp: ${typeUnknown ? "unbekannt" : type.code}${category ? ` · Kategorie ${category}` : ""}`);
  if (typeUnknown) lines.push("Zonentyp in den PANSA-Daten nicht erkannt – vorsorglich als genehmigungspflichtig dargestellt.");
  if (type.cls === "AIRSPACE") lines.push("Luftraumstruktur – nur zur Information; maßgeblich sind die DRA-Zonen.");
  lines.push(`${PL_ATTRIBUTION} – nur zur Information, nicht zur Navigation. Tagesaktuelle Luftraum-Aktivierungen (AUP/UUP) und NOTAMs zusätzlich prüfen.`);

  const props: Record<string, any> = {
    identifier,
    name,
    restriction: type.restriction,
    lowerMeters,
    lowerReference,
    upperReference,
    message: lines.join("\n"),
    country: "POL",
    source: PL_GEOZONE_SOURCE_LABEL,
    plZoneType: typeUnknown ? undefined : type.code,
    plZoneClass: type.cls,
    plAltitudeSource: altitudeSource,
    notamsUrl: PANSA_AUP_URL,
    notamsUrlLabel: "PANSA AUP/UUP (heute aktive Lufträume)",
  };
  if (upper?.meters != null) props.upperMeters = upper.meters;
  if (category) props.plGeozoneCategory = category;
  if (typeUnknown) props.plTypeUnknown = true;
  if (type.cls === "AIRSPACE") props.plAirspace = true;

  const start = parsePolishDate(pm.timeSpan?.begin ?? pick(attrs, START_KEYS));
  const end = parsePolishDate(pm.timeSpan?.end ?? pick(attrs, END_KEYS));
  if (start != null) props.validStartTs = start;
  if (end != null) props.validEndTs = end;

  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: String(identifier), geometry, properties: props };
}

function geometrySignature(g: { coordinates: any }): string {
  const flat: number[] = [];
  const visit = (c: any) => {
    if (typeof c?.[0] === "number") flat.push(c[0], c[1]);
    else if (Array.isArray(c)) c.forEach(visit);
  };
  visit(g.coordinates);
  return `${flat.length}:${flat.slice(0, 4).join(",")}`;
}

/** Placemark-Liste → normalisierte, deduplizierte Features. */
export function normalizePolishPlacemarks(pms: KmlPlacemark[], opts: PlNormalizeOptions = {}): PlFeature[] {
  const seen = new Set<string>();
  const out: PlFeature[] = [];
  for (const pm of pms) {
    const f = normalizePolishPlacemark(pm, opts);
    if (!f) continue;
    const key = `${f.properties.identifier}|${f.properties.restriction}|${geometrySignature(f.geometry)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** KML-Text der PANSA-API → normalisierte Features. */
export function normalizePolishKml(kml: string, opts: PlNormalizeOptions = {}): PlFeature[] {
  return normalizePolishPlacemarks(parseKmlPlacemarks(kml), opts);
}
