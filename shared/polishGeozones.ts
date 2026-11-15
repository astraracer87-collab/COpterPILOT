// Polen (PANSA / PAŻP DroneMap) – Normalisierung der KML-Antwort auf das
// App-Format (GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo
// in client/lib/ed269.ts liest). Siehe docs/pansa-pl-api-integration.md.
//
// Verifiziert (DE-IP, 2026-11-15, Doku §8, Fixture docs/fixtures/pansa_kml_sample.kml):
// jedes Placemark trägt Typ und Höhen im Freitext der <description>
//   "Restriction: N/A, Type: DRAP, Min: 0 ft, Max: 600 ft"
// → Typ über PL_TYPE_TABLE (34 Typen aus /v1/zones/types), Höhen ft → m,
// Höhenbezug NICHT angegeben (bleibt leer = UNKNOWN; der Höhenfilter blendet
// solche Zonen nie aus). Ältere/abweichende KML-Formen werden weiter tolerant
// gelesen (Rückfall, Reihenfolge):
//
// Zonentyp (erster Treffer gewinnt):
//   0. PANSA-Beschreibung „Type: …“
//   1. ExtendedData-Felder  type | typ | zoneType | zone_type | kind | rodzaj |
//      class | airspaceType | layer | category (wenn dort ein Code steht)
//   2. Placemark-<name>
//   3. umschließende Folder-Namen
//   4. <styleUrl> (z. B. "#DRA-P", "#style_DRAR")
//   Beschränkung je Code laut PL_TYPE_TABLE (z. B. DRAP → PROHIBITED, DRAR/CTR/
//   ATZ6KM → REQ_AUTHORISATION, DRAI/RMZ → NO_RESTRICTION). Reine Info-
//   Lufträume (RMZ, ADIZ, …) nur mit includeAirspace; Verbots-/Genehmigungs-
//   typen werden nie verworfen.
//
// Höhen ohne PANSA-Beschreibung (Meter; ft → m, FL → ft·100 → m):
//   - getrennte Felder: lowerLimit | lower | minAltitude | minAlt | altMin |
//     altFrom | min | bottom | floor | minHeight | hMin | dolnaGranica | dolna
//     bzw. upperLimit | upper | maxAltitude | maxAlt | altMax | altTo | max | top |
//     ceiling | maxHeight | hMax | gornaGranica | gorna
//     (+ optional uom | unit | units | jednostka und lowerReference /
//     upperReference / reference / altitudeReference)
//   - kombiniertes Feld: altitude | height | wysokosc | limits | verticalLimits
//     ("GND - 120 m AGL", "0-150m n.p.t.")
//   - Quellen: ExtendedData → HTML-Tabelle bzw. "Schlüssel: Wert"-Zeilen in
//     <description> → einheitliche Polygon-Höhe (z-Koordinate) bei altitudeMode
//     relativeToGround/absolute als Obergrenze.
//   - Kategorie G1–G4: Feld category | kategoria | geozoneCategory | group
//     (Bedeutung laut Doku offen → nur angezeigt, nicht interpretiert).
//
// Meldung: deutsche Zeilen (Typ, Beschränkung, Höhe, Quelle) + Originaltext
// der Behörde (PANSA-Beschreibung bzw. polnischer Text) unter
// „Originaltext der Behörde:“; localizedMessages de zuerst.
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import {
  htmlToText,
  kmlDescriptionTable,
  kmlPlacemarkToGeoJsonGeometry,
  parseKmlPlacemarks,
  type KmlPlacemark,
} from "./geozoneKit/kml";
import { flToM, parseHeight } from "./geozoneKit/heights";
import { round1 } from "./geozoneKit/text";
import { localizedExtendedProperties, messageWithOriginal, sourceLineDe } from "./geozoneKit/messages";

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
 * `max` der KML-Abfrage = HÖHENGRENZE in Metern (nicht die Zonenanzahl; live
 * verifiziert von DE-IP, 2026-11-15, Doku §2). Die Doku/die offizielle Karte
 * nutzen für Drohnen `max=500`: Werte ≥ 500 m deaktivieren den Höhenfilter
 * praktisch – es kommen ALLE Zonen (auch solche mit hoher Untergrenze). Wir
 * fragen bewusst ungefiltert ab (lieber eine Zone zu viel; der Höhenfilter der
 * App entscheidet), statt mit 120 m Zonen serverseitig zu verlieren.
 */
export const PANSA_KML_MAX_M = 500;
/** @deprecated früherer Wire-Wert des QGIS-Plugins (3000) – nicht mehr verwendet. */
export const PANSA_MAX_NO_FILTER = PANSA_KML_MAX_M;

export function buildPansaKmlUrl(
  types: readonly string[] = PL_DRONE_ZONE_TYPES,
  maxMeters: number = PANSA_KML_MAX_M,
): string {
  const max = !Number.isFinite(maxMeters) ? PANSA_KML_MAX_M : Math.max(0, Math.round(maxMeters));
  // Kommas bewusst unkodiert lassen (wie Plugin/curl in der Doku).
  return `${PANSA_KML_URL}?extrude=false&types=${types.map(encodeURIComponent).join(",")}&max=${max}`;
}

/**
 * Bearer-Token aus der Login-Antwort lesen. Verifiziert (DE-IP, 2026-11-15):
 * `{ "access_token": "<bearer>", … }`. Ältere Varianten (token/accessToken)
 * bleiben tolerant lesbar.
 */
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
  for (const k of ["access_token", "accessToken", "token", "jwt", "bearer"]) {
    if (typeof b[k] === "string" && b[k].trim()) return b[k].trim();
  }
  if (b.data && typeof b.data === "object") return parsePansaLoginToken(b.data);
  return null;
}

// ---------------------------------------------------------------------------
// Zonentypen (`zones/types`, 34 Typen – Tabelle laut Doku §8, verifiziert)
// ---------------------------------------------------------------------------

export type PlZoneClass = "DRAP" | "DRAR" | "DRAI" | "AIRSPACE";
export type PlRestriction = "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL" | "NO_RESTRICTION";

export interface PlZoneType {
  /** Gefundener Code in kanonischer Schreibweise, z. B. "DRA-P", "ATZ6KM", "CTR". */
  code: string;
  cls: PlZoneClass;
  restriction: PlRestriction;
  /** Deutsche Bezeichnung des Typs */
  labelDe?: string;
}

/**
 * PANSA-Typ → Beschränkung und deutsche Bezeichnung. Die Zuordnung stammt aus
 * den 34 Zonentyp-Definitionen des Endpoints `/v1/zones/types`
 * (pansa_zones_types.json; Präfix DRA-P/DRA-R/DRA-I je Typ, Doku §8):
 * PROHIBITED 7 · REQ_AUTHORISATION 18 · NO_RESTRICTION/Info 9. Die Datei selbst
 * liegt nicht im Repo – die Tabelle hier ist die kodierte Fassung.
 */
export const PL_TYPE_TABLE: Readonly<Record<string, { restriction: PlRestriction; labelDe: string }>> = {
  // PROHIBITED (7)
  DRAP: { restriction: "PROHIBITED", labelDe: "Drohnen-Flugverbotszone (DRA-P)" },
  MRT: { restriction: "PROHIBITED", labelDe: "Militärische Tiefflugstrecke (MRT)" },
  TF: { restriction: "PROHIBITED", labelDe: "Temporäres Flugverbot (TF)" },
  TFR: { restriction: "PROHIBITED", labelDe: "Temporäres Flugbeschränkungsgebiet (TFR)" },
  TMA: { restriction: "PROHIBITED", labelDe: "Nahverkehrsbereich (TMA) – für Drohnen gesperrt" },
  TS: { restriction: "PROHIBITED", labelDe: "Temporär abgetrennter Luftraum (TS)" },
  TSA: { restriction: "PROHIBITED", labelDe: "Temporär abgetrenntes Gebiet (TSA)" },
  // REQ_AUTHORISATION (18)
  ATZ: { restriction: "REQ_AUTHORISATION", labelDe: "Flugplatzverkehrszone (ATZ)" },
  ATZ1KM: { restriction: "REQ_AUTHORISATION", labelDe: "ATZ – 1-km-Bereich um den Flugplatz" },
  ATZ6KM: { restriction: "REQ_AUTHORISATION", labelDe: "ATZ – 6-km-Bereich um den Flugplatz" },
  CTR: { restriction: "REQ_AUTHORISATION", labelDe: "Kontrollzone (CTR)" },
  CTR1KM: { restriction: "REQ_AUTHORISATION", labelDe: "CTR – 1-km-Bereich um den Flughafen" },
  CTR6KM: { restriction: "REQ_AUTHORISATION", labelDe: "CTR – 6-km-Bereich um den Flughafen" },
  D: { restriction: "REQ_AUTHORISATION", labelDe: "Gefahrengebiet (D)" },
  DRAR: { restriction: "REQ_AUTHORISATION", labelDe: "Drohnen-Beschränkungszone (DRA-R)" },
  EPD: { restriction: "REQ_AUTHORISATION", labelDe: "Gefahrengebiet (EP D)" },
  EPP: { restriction: "REQ_AUTHORISATION", labelDe: "Sperrgebiet (EP P)" },
  EPR: { restriction: "REQ_AUTHORISATION", labelDe: "Flugbeschränkungsgebiet (EP R)" },
  MCTR: { restriction: "REQ_AUTHORISATION", labelDe: "Militärische Kontrollzone (MCTR)" },
  MCTR2KM: { restriction: "REQ_AUTHORISATION", labelDe: "MCTR – 2-km-Bereich" },
  P: { restriction: "REQ_AUTHORISATION", labelDe: "Sperrgebiet (P)" },
  R: { restriction: "REQ_AUTHORISATION", labelDe: "Flugbeschränkungsgebiet (R)" },
  RPA: { restriction: "REQ_AUTHORISATION", labelDe: "Gebiet für unbemannte Luftfahrzeuge (RPA)" },
  TR: { restriction: "REQ_AUTHORISATION", labelDe: "Temporär reservierter Luftraum (TR)" },
  TRA: { restriction: "REQ_AUTHORISATION", labelDe: "Temporär reserviertes Gebiet (TRA)" },
  // NO_RESTRICTION / Info (9)
  AAA: { restriction: "NO_RESTRICTION", labelDe: "Gebiet mit Flugaktivität (AAA) – Information" },
  ADIZ: { restriction: "NO_RESTRICTION", labelDe: "Luftverteidigungs-Identifizierungszone (ADIZ) – Information" },
  AREA: { restriction: "NO_RESTRICTION", labelDe: "Informationsgebiet (AREA)" },
  DRAI: { restriction: "NO_RESTRICTION", labelDe: "Drohnen-Informationszone (DRA-I)" },
  EA: { restriction: "NO_RESTRICTION", labelDe: "Übungsgebiet (EA) – Information" },
  FIS: { restriction: "NO_RESTRICTION", labelDe: "Fluginformationsbereich (FIS) – Information" },
  NW: { restriction: "NO_RESTRICTION", labelDe: "Navigationswarnung (NW) – Information" },
  RMZ: { restriction: "NO_RESTRICTION", labelDe: "Funkkommunikationspflicht-Zone (RMZ) – Information" },
  ROL: { restriction: "NO_RESTRICTION", labelDe: "Gebiet mit Flugbeschränkung laut NOTAM (ROL) – Information" },
};

/** Drohnen-Codes (Klasse DRAP/DRAR/DRAI; Ringe um Flugplätze gehören zu DRA-P laut Plugin). */
const DRONE_CLASS: Record<string, PlZoneClass> = {
  DRAP: "DRAP", ATZ1KM: "DRAP", ATZ6KM: "DRAP", CTR1KM: "DRAP", CTR6KM: "DRAP", MCTR2KM: "DRAP",
  DRAR: "DRAR",
  DRAI: "DRAI",
};

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

/** Kompakter Typ-Code („DRA-P“ → „DRAP“, „EP D“ → „EPD“) → Typ laut Tabelle; null = unbekannt. */
export function polishTypeFromCode(raw: string | undefined): PlZoneType | null {
  if (!raw) return null;
  const c = canon(raw).replace(/[\s_-]+/g, "");
  const t = PL_TYPE_TABLE[c];
  if (!t) return null;
  const code = c === "DRAP" ? "DRA-P" : c === "DRAR" ? "DRA-R" : c === "DRAI" ? "DRA-I" : c;
  return { code, cls: DRONE_CLASS[c] ?? "AIRSPACE", restriction: t.restriction, labelDe: t.labelDe };
}

const DRONE_CODE_RE = /(?:^|[^A-Z0-9])(DRA[\s_-]?[PRI]|ATZ[16][\s_-]?KM|CTR[16][\s_-]?KM|MCTR[\s_-]?2[\s_-]?KM)(?=$|[^A-Z0-9])/;
// Mehrbuchstabige Luftraumcodes im Freitext; P/R/D nur aus expliziten Typfeldern.
const AIRSPACE_CODE_RE = /(?:^|[^A-Z0-9])(MCTR|MTMA|MATZ|CTR|TMA|ATZ|RMZ|ADIZ|TRA|TSA|MRT|TFR|RPA)(?=$|[^A-Z0-9])/;

/** Code aus einem expliziten Typfeld (exakter Wert) bestimmen. */
export function classifyPolishTypeValue(raw: string | undefined): PlZoneType | null {
  if (!raw) return null;
  const v = canon(raw).trim();
  if (!v) return null;
  const direct = polishTypeFromCode(v);
  if (direct) return direct;
  const compact = v.replace(/[\s_-]+/g, "");
  // Luftraumcodes ohne eigene Tabellenzeile (MTMA, MATZ): Information.
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
  if (m) return polishTypeFromCode(m[1]);
  const a = v.match(AIRSPACE_CODE_RE);
  if (a) return polishTypeFromCode(a[1]) ?? { code: a[1], cls: "AIRSPACE", restriction: "NO_RESTRICTION" };
  return null;
}

// ---------------------------------------------------------------------------
// Verifiziertes KML-Format (DE-IP, 2026-11-15): Typ und Höhen stehen im
// Freitext der <description>:
//   "Restriction: N/A, Type: DRAP, Min: 0 ft, Max: 600 ft"
// ---------------------------------------------------------------------------

export interface PansaDescription {
  /** Rohwert „Restriction:“ (meist „N/A“) */
  restriction?: string;
  type: string;
  minFt: number;
  maxFt: number;
}

const PANSA_DESC_RE = /Type:\s*([\w-]+)\s*,\s*Min:\s*(-?\d+(?:[.,]\d+)?)\s*ft\s*,\s*Max:\s*(-?\d+(?:[.,]\d+)?)\s*ft/i;

/** PANSA-Beschreibung lesen; null, wenn sie nicht dem verifizierten Muster folgt. */
export function parsePansaDescription(text: string | undefined): PansaDescription | null {
  if (!text) return null;
  const m = text.match(PANSA_DESC_RE);
  if (!m) return null;
  const r = text.match(/Restriction:\s*([^,]*)/i);
  const minFt = Number(m[2].replace(",", "."));
  const maxFt = Number(m[3].replace(",", "."));
  if (!Number.isFinite(minFt) || !Number.isFinite(maxFt)) return null;
  const restriction = r ? r[1].trim() : undefined;
  return { type: m[1].toUpperCase(), minFt, maxFt, ...(restriction ? { restriction } : {}) };
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

export interface PlAltitude {
  /** Meter; undefined bei unbegrenzt. */
  meters?: number;
  unlimited?: boolean;
  reference?: "AGL" | "AMSL";
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
  if (fl) return { meters: round1(flToM(Number(fl[1]))), reference: "AMSL" };
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
  // Umrechnung über den gemeinsamen Parser; der Bezug bleibt optional (kein AGL-Rückfall).
  return { meters: round1(parseHeight(n, isFt ? "ft" : "m")?.m ?? n), reference };
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

const RESTRICTION_DE: Record<PlRestriction, string> = {
  PROHIBITED: "Flugverbot für Drohnen.",
  REQ_AUTHORISATION: "Flug nur mit Genehmigung/Zustimmung der zuständigen Stelle (PAŻP/Flugsicherung bzw. Betreiber).",
  CONDITIONAL: "Flug unter Auflagen zulässig.",
  NO_RESTRICTION: "Informationszone – keine Beschränkung, Hinweise beachten.",
};

function ftText(ft: number): string {
  return `${ft} ft (${Math.round(ft * 0.3048)} m)`;
}

export function normalizePolishPlacemark(pm: KmlPlacemark, opts: PlNormalizeOptions = {}): PlFeature | null {
  const geometry = kmlPlacemarkToGeoJsonGeometry(pm);
  if (!geometry) return null;

  // Attribute: ExtendedData hat Vorrang vor Beschreibungs-Tabelle/-Zeilen.
  const attrs: Attrs = new Map();
  addAttrs(attrs, pm.data);
  const table = kmlDescriptionTable(pm.description);
  const descText = htmlToText(pm.description);
  // Verifiziertes PANSA-Format („Restriction: N/A, Type: DRAP, Min: 0 ft, Max: 600 ft“)
  const pansa = Object.keys(table).length === 0 ? parsePansaDescription(descText) : null;
  const descAttrs = pansa ? {} : Object.keys(table).length > 0 ? table : keyValueLines(descText);
  const dataAttrCount = attrs.size;
  addAttrs(attrs, descAttrs);

  let type: PlZoneType | null = null;
  if (pansa) type = classifyPolishTypeValue(pansa.type);
  if (!type) type = placemarkType(pm, attrs);
  let typeUnknown = false;
  if (!type) {
    if (opts.unknownAs === "skip") return null;
    type = { code: pansa?.type || "DRA", cls: "DRAR", restriction: "REQ_AUTHORISATION" };
    typeUnknown = true;
  }
  // Reine Info-Lufträume nur auf Wunsch; Verbots-/Genehmigungstypen nie verwerfen.
  if (type.cls === "AIRSPACE" && type.restriction === "NO_RESTRICTION" && !opts.includeAirspace) return null;

  // Höhen
  let lower: PlAltitude | null = null;
  let upper: PlAltitude | null = null;
  let altitudeSource: "pansa" | "extendedData" | "description" | "geometry" | "none" = "none";
  if (pansa) {
    // Einheit ft laut PANSA-Text; der Höhenbezug wird NICHT angegeben → leer
    // lassen (UNKNOWN, der Höhenfilter blendet nie aus). 0 ft = Boden.
    lower = pansa.minFt <= 0 ? { meters: 0, reference: "AGL" } : { meters: round1(parseHeight(pansa.minFt, "ft")?.m ?? 0) };
    upper = { meters: round1(parseHeight(pansa.maxFt, "ft")?.m ?? 0) };
    altitudeSource = "pansa";
  } else {
    const dataOnly: Attrs = new Map([...attrs].slice(0, dataAttrCount));
    ({ lower, upper } = altitudesFromAttrs(dataOnly));
    if (lower || upper) altitudeSource = "extendedData";
    else {
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
  }
  const lowerMeters = lower?.meters ?? 0;
  const lowerReference = lower?.reference ?? (lowerMeters === 0 ? "AGL" : pansa ? undefined : upper?.reference ?? "AGL");
  const upperReference = pansa ? undefined : upper?.reference ?? lower?.reference ?? "AGL";

  const name = pm.name ?? pick(attrs, NAME_KEYS) ?? pick(attrs, ID_KEYS) ?? type.code;
  const identifier = pm.id ?? pick(attrs, ID_KEYS) ?? `${type.code}:${name}`;
  const category = geozoneCategory(attrs, pm);

  // Deutsche Meldung + Originaltext der Behörde (PANSA-Beschreibung bzw. polnischer Text).
  const original: string[] = [];
  if (Object.keys(table).length > 0) {
    for (const [k, v] of Object.entries(table)) if (v) original.push(`${k}: ${v}`);
  } else if (descText) {
    original.push(descText);
  }
  const remark = pick(attrs, REMARK_KEYS);
  if (remark && !original.some((l) => l.includes(remark))) original.push(remark);

  const lines: string[] = [];
  lines.push(`PANSA-Zonentyp: ${typeUnknown ? `unbekannt${pansa ? ` (${pansa.type})` : ""}` : `${type.code}${type.labelDe ? ` – ${type.labelDe}` : ""}`}${category ? ` · Kategorie ${category}` : ""}`);
  lines.push(RESTRICTION_DE[type.restriction]);
  if (pansa) {
    lines.push(`Höhe laut PANSA: ${pansa.minFt <= 0 ? "GND" : ftText(pansa.minFt)} bis ${ftText(pansa.maxFt)} (Höhenbezug nicht angegeben).`);
  }
  if (typeUnknown) lines.push("Zonentyp in den PANSA-Daten nicht erkannt – vorsorglich als genehmigungspflichtig dargestellt.");
  if (type.cls === "AIRSPACE" && type.restriction === "NO_RESTRICTION") lines.push("Luftraumstruktur – nur zur Information; maßgeblich sind die DRA-Zonen.");
  lines.push(sourceLineDe("PANSA DroneMap", PL_ATTRIBUTION, "Tagesaktuelle Luftraum-Aktivierungen (AUP/UUP) und NOTAMs"));
  const originalText = original.join("\n");
  const message = messageWithOriginal(lines, originalText);

  const props: Record<string, any> = {
    identifier,
    name,
    restriction: type.restriction,
    lowerMeters,
    lowerReference,
    upperReference,
    message,
    extendedProperties: localizedExtendedProperties(message, originalText || null, pansa ? "en" : "pl"),
    country: "POL",
    source: PL_GEOZONE_SOURCE_LABEL,
    plZoneType: typeUnknown ? undefined : type.code,
    plZoneClass: type.cls,
    plAltitudeSource: altitudeSource,
    notamsUrl: PANSA_AUP_URL,
    notamsUrlLabel: "PANSA AUP/UUP (heute aktive Lufträume)",
  };
  if (pansa) props.altitudeText = `${pansa.minFt <= 0 ? "GND" : `${pansa.minFt} ft`} – ${pansa.maxFt} ft`;
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
