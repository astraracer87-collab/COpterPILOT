// Spanische Geozonen (ENAIRE, „AIS Data Service for UAS Geographical Zones“) –
// Normalisierung in die ED-269-nahe Feature-Form, die client/lib/ed269.ts
// (parseEd269ToGeozoneInfo) liest: restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, applicability, zoneAuthority …
//
// Grundlage: docs/enaire-es-api-integration.md (ENAIRE-Spec v3.1, §4/§6).
// Drei Layer (ArcGIS-FeatureServer bzw. WFS-typeNames):
//   ZGUAS_Aero              – Zonen aeronautischen Ursprungs (AIP)
//   ZGUAS_Urbano            – öffentliche Sicherheit im urbanen Raum
//   ZGUAS_Infraestructuras  – Schutz von Anlagen/Infrastruktur (inkl. CIDETRA)
//
// Die Attribute sind FLACH (ArcGIS-/WFS-Attributtabelle), d. h. ED-318-Listen
// (DailyPeriod, Authority) kommen als mehrere Zeilen mit gleichem `Identifier`.
// Diese Zeilen werden hier zu einer Zone zusammengeführt (Dedupe über
// `Identifier`, auch layerübergreifend).
//
// ⚠️ Nicht live verifiziert (ENAIRE-WAF blockt Nicht-EU-IPs): Feldnamen werden
// daher tolerant gelesen (Groß-/Kleinschreibung, Unterstriche, Namespace-
// Präfixe egal), Datumswerte als Epoch-ms (ArcGIS) ODER ISO-String (WFS).
//
// Spanische Behördentexte (Message, RestrictionConditions) bleiben im Original;
// die App übersetzt separat. Pflicht-Attribution: „© ENAIRE“.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { normalizeEd269Restriction } from "./ed269Restriction";
import { isoDurationText } from "./swedishGeozones";

export const ES_GEOZONE_SOURCE_LABEL = "ENAIRE (ED-318)";
export const ES_GEOZONE_ATTRIBUTION = "© ENAIRE";

export type EsLayer = "ZGUAS_Aero" | "ZGUAS_Urbano" | "ZGUAS_Infraestructuras";
export const ES_LAYERS: EsLayer[] = ["ZGUAS_Aero", "ZGUAS_Urbano", "ZGUAS_Infraestructuras"];

/** Rechtsgrundlage je Layer (RD 517/2024, laut Doku §2). */
export const ES_LAYER_LEGAL_BASIS: Record<EsLayer, string> = {
  ZGUAS_Aero: "Real Decreto 517/2024, Art. 37, 41, 42",
  ZGUAS_Urbano: "Real Decreto 517/2024, Art. 40",
  ZGUAS_Infraestructuras: "Real Decreto 517/2024, Art. 39",
};

/**
 * Rückfall-Beschränkung je Layer, wenn `Type` fehlt oder unbekannt ist.
 * Annahme (nicht live verifiziert): Urbane Zonen verlangen nach RD 517/2024
 * Art. 40 i. d. R. eine Vorab-Mitteilung an das Innenministerium → CONDITIONAL;
 * Aero- und Infrastrukturzonen verlangen eine Genehmigung/Koordination.
 */
export const ES_LAYER_DEFAULT_RESTRICTION: Record<EsLayer, string> = {
  ZGUAS_Aero: "REQ_AUTHORISATION",
  ZGUAS_Urbano: "CONDITIONAL",
  ZGUAS_Infraestructuras: "REQ_AUTHORISATION",
};

/** Untergrenzen darüber sind für Drohnen nicht erreichbar → Zone verwerfen. */
export const ES_MAX_RELEVANT_LOWER_AGL_M = 152.4; // 500 ft
export const ES_MAX_RELEVANT_LOWER_MSL_M = 3800; // > Teide (3718 m)

const FT = 0.3048;

export type EsAltitudeReference = "AGL" | "MSL";

export type EsAltitude = {
  /** Meter; undefined = unbegrenzt bzw. nicht lesbar. */
  meters: number | undefined;
  reference: EsAltitudeReference;
  unlimited?: boolean;
  /** Anzeige-Text (Original-Einheit/-Bezug). */
  text: string;
};

export type EsFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
};

// ---------------------------------------------------------------------------
// Attribut-Zugriff (tolerant gegenüber Schreibweise)
// ---------------------------------------------------------------------------

function normKey(k: string): string {
  const bare = k.includes(":") ? k.slice(k.lastIndexOf(":") + 1) : k;
  return bare.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Liefert eine Lesefunktion für Attribute unabhängig von Schreibweise/Präfix. */
export function esAttributeReader(props: Record<string, any> | null | undefined): (name: string) => any {
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(props || {})) {
    const nk = normKey(k);
    if (!map.has(nk) || map.get(nk) == null || map.get(nk) === "") map.set(nk, v);
  }
  return (name: string) => {
    const v = map.get(normKey(name));
    if (v == null) return undefined;
    if (typeof v === "string") {
      const t = v.trim();
      return t === "" || t.toUpperCase() === "NULL" ? undefined : t;
    }
    return v;
  };
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function cleanText(s: unknown): string {
  return String(s ?? "")
    .replace(/\r/g, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Epoch-ms (ArcGIS) oder ISO-String (WFS) → ISO-String; sonst null. */
export function esDateIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  let ts: number;
  if (typeof value === "number") ts = value;
  else if (/^-?\d{10,}$/.test(String(value).trim())) ts = Number(String(value).trim());
  else ts = new Date(String(value)).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Beschränkung
// ---------------------------------------------------------------------------

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * ENAIRE-`Type` (ED-318 UASZoneVersion.type) → App-Restriction.
 * ED-318-Werte: PROHIBITED, REQ_AUTHORIZATION, CONDITIONAL, NO_RESTRICTION.
 * Spanische Klartexte werden zusätzlich verstanden. Unbekannt/leer → Layer-Default.
 */
export function esRestriction(type: unknown, layer: EsLayer): string {
  const raw = stripAccents(str(type)).toUpperCase().replace(/[\s-]+/g, "_");
  if (raw) {
    if (/^(PROHIBID[OA]|ZONA_PROHIBIDA|PROHIBICION)$/.test(raw)) return "PROHIBITED";
    if (/^(REQUIERE_)?AUTORIZACION(_PREVIA)?$|^REQ_AUTORIZACION$/.test(raw)) return "REQ_AUTHORISATION";
    if (/^(CONDICIONAD[OA]|CONDICIONAL|CONDICIONES)$/.test(raw)) return "CONDITIONAL";
    if (/^(SIN_RESTRICCION(ES)?|INFORMATIV[OA]|INFORMACION)$/.test(raw)) return "NO_RESTRICTION";
    const n = normalizeEd269Restriction(raw);
    if (["PROHIBITED", "REQ_AUTHORISATION", "CONDITIONAL", "NO_RESTRICTION", "RESTRICTED"].includes(n)) return n;
  }
  return ES_LAYER_DEFAULT_RESTRICTION[layer];
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

function esReference(refRaw: unknown, fallback: EsAltitudeReference): EsAltitudeReference {
  const r = str(refRaw).toUpperCase();
  if (!r) return fallback;
  if (r === "AGL" || r === "SFC" || r === "GND" || r === "AGND") return "AGL";
  return "MSL"; // AMSL, MSL, WGS84, STD (FL) → MSL (App kennt nur AGL/MSL)
}

/**
 * Ein ED-318-Höhenwert (Lower/Upper) + UOM (M/FT/FL) + Reference
 * (AGL/AMSL/WGS84/STD/SFC) → Meter. GND/SFC → 0 AGL, UNL → unbegrenzt.
 */
export function parseEsAltitude(value: unknown, uomRaw: unknown, refRaw: unknown): EsAltitude | null {
  if (value == null || value === "") return null;
  const s = str(value).toUpperCase();
  if (s === "GND" || s === "SFC") return { meters: 0, reference: "AGL", text: "GND" };
  if (s === "UNL" || s === "UNLTD" || s === "UNLIMITED") return { meters: undefined, reference: "MSL", unlimited: true, text: "UNL" };
  const fl = s.match(/^FL ?(\d{1,3})$/);
  if (fl) return { meters: round1(Number(fl[1]) * 100 * FT), reference: "MSL", text: `FL ${Number(fl[1])}` };
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const refU = str(refRaw).toUpperCase();
  let uom = str(uomRaw).toUpperCase();
  if (uom === "F" || uom === "FEET") uom = "FT";
  if (uom === "METERS" || uom === "METRES" || uom === "") uom = refU === "STD" ? "FL" : "M";
  const reference = esReference(refRaw, "AGL");
  if (n === 0 && reference === "AGL") return { meters: 0, reference, text: "GND" };
  if (uom === "FL") return { meters: round1(n * 100 * FT), reference: "MSL", text: `FL ${n}` };
  const meters = uom === "FT" ? n * FT : n;
  const refText = refU === "WGS84" || refU === "MSL" ? "AMSL" : refU || "AGL";
  return { meters: round1(meters), reference, text: `${n} ${uom === "FT" ? "ft" : "m"} ${refText}` };
}

/** Untergrenze für Drohnen erreichbar (bzw. unbekannt) → Zone behalten. */
export function esLowerIsRelevant(lower: EsAltitude | null): boolean {
  if (!lower || lower.meters == null) return !lower?.unlimited;
  if (lower.reference === "AGL") return lower.meters <= ES_MAX_RELEVANT_LOWER_AGL_M + 0.5;
  return lower.meters <= ES_MAX_RELEVANT_LOWER_MSL_M;
}

function applyAltitudes(out: Record<string, any>, lower: EsAltitude | null, upper: EsAltitude | null): void {
  if (lower) {
    if (typeof lower.meters === "number") out.lowerMeters = lower.meters;
    out.lowerReference = lower.reference;
  } else {
    out.lowerMeters = 0;
    out.lowerReference = "AGL";
  }
  if (upper) {
    if (typeof upper.meters === "number") out.upperMeters = upper.meters;
    out.upperReference = upper.reference;
  }
  out.altitudeText = `${lower?.text || "GND"} – ${upper?.text || "UNL"}`;
}

// ---------------------------------------------------------------------------
// Zeiten (TimePeriod + DailyPeriod)
// ---------------------------------------------------------------------------

const DAY_CODES: Record<string, string> = {
  MON: "MON", MO: "MON", MONDAY: "MON", LUN: "MON", LUNES: "MON", L: "MON",
  TUE: "TUE", TU: "TUE", TUESDAY: "TUE", MAR: "TUE", MARTES: "TUE", M: "TUE",
  WED: "WED", WE: "WED", WEDNESDAY: "WED", MIE: "WED", MIERCOLES: "WED", X: "WED",
  THU: "THU", TH: "THU", THURSDAY: "THU", JUE: "THU", JUEVES: "THU", J: "THU",
  FRI: "FRI", FR: "FRI", FRIDAY: "FRI", VIE: "FRI", VIERNES: "FRI", V: "FRI",
  SAT: "SAT", SA: "SAT", SATURDAY: "SAT", SAB: "SAT", SABADO: "SAT", S: "SAT",
  SUN: "SUN", SU: "SUN", SUNDAY: "SUN", DOM: "SUN", DOMINGO: "SUN", D: "SUN",
  ANY: "ANY", DAILY: "ANY", ALL: "ANY", TODOS: "ANY",
};

/** „MON“, „MON,TUE“, „LUN“ … → ED-269-Tagescodes (unbekannte bleiben roh). */
export function esDays(value: unknown): string[] {
  const parts = str(value)
    .split(/[,;\s/]+/)
    .map((d) => stripAccents(d).toUpperCase())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const code = DAY_CODES[p] ?? p;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

const EVENT_TEXT: Record<string, string> = {
  SR: "Sonnenaufgang",
  SS: "Sonnenuntergang",
  BMCT: "Beginn bürgerl. Dämmerung",
  EECT: "Ende bürgerl. Dämmerung",
};

/** „08:00“, „0800“, „08:00:00“, „8:00Z“ → „08:00Z“ (ED-318-Zeiten sind UTC). */
export function esTimeUtc(value: unknown): string | null {
  const s = str(value).toUpperCase().replace(/\s*(Z|UTC)$/, "");
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!m) m = s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}Z`;
}

/** DailyPeriod-Attribute einer Zeile → ED-269-Schedule-Eintrag (oder null). */
function dailyPeriodEntry(get: (n: string) => any): Record<string, any> | null {
  const days = esDays(get("Day"));
  const startTime = esTimeUtc(get("StartTime"));
  const endTime = esTimeUtc(get("EndTime"));
  const startEvent = str(get("StartEvent")).toUpperCase();
  const endEvent = str(get("EndEvent")).toUpperCase();
  if (days.length === 0 && !startTime && !endTime && !startEvent && !endEvent) return null;
  // Ganztägig an jedem Tag → kein Zeitplan nötig.
  if ((days.length === 0 || days.includes("ANY")) && !startEvent && !endEvent &&
      (!startTime || startTime === "00:00Z") && (!endTime || endTime === "24:00Z" || endTime === "00:00Z")) {
    return null;
  }
  const entry: Record<string, any> = { day: days.length > 0 ? days : ["ANY"] };
  // Ereignis ohne Uhrzeit (SR/SS…): Klartext; die Aktivitätsprüfung behandelt
  // unlesbare Zeiten konservativ als ganztägig.
  if (startTime) entry.startTime = startTime;
  else if (startEvent) entry.startTime = EVENT_TEXT[startEvent] ?? startEvent;
  if (endTime) entry.endTime = endTime;
  else if (endEvent) entry.endTime = EVENT_TEXT[endEvent] ?? endEvent;
  if (startEvent) entry.startEvent = startEvent;
  if (endEvent) entry.endEvent = endEvent;
  return entry;
}

type EsWindow = { start: string | null; end: string | null; schedule: Record<string, any>[] };

function addWindow(windows: EsWindow[], start: string | null, end: string | null, entry: Record<string, any> | null): void {
  let w = windows.find((x) => x.start === start && x.end === end);
  if (!w) {
    w = { start, end, schedule: [] };
    windows.push(w);
  }
  if (entry) {
    // Einträge mit gleicher Uhrzeit zu einem Eintrag mit mehreren Tagen zusammenfassen.
    const { day, ...rest } = entry;
    const key = JSON.stringify(rest);
    const hit = w.schedule.find(({ day: _d, ...other }) => JSON.stringify(other) === key);
    if (hit) {
      for (const d of day as string[]) if (!hit.day.includes(d)) hit.day.push(d);
    } else w.schedule.push({ ...entry, day: [...(day as string[])] });
  }
}

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN", "ANY"];

/**
 * Gesammelte Fenster → ED-269-applicability. Abgelaufene Fenster entfallen;
 * Fenster ohne Ende/Zeitplan mit vergangenem Start = dauerhaft (undefined).
 * Rückgabe null = Zone komplett abgelaufen.
 */
function windowsToApplicability(windows: EsWindow[], now: Date): any[] | undefined | null {
  if (windows.length === 0) return undefined;
  const nowTs = now.getTime();
  const out: any[] = [];
  let permanent = false;
  for (const w of windows) {
    if (w.end && new Date(w.end).getTime() < nowTs) continue;
    if (!w.end && w.schedule.length === 0 && (!w.start || new Date(w.start).getTime() <= nowTs)) {
      permanent = true;
      continue;
    }
    const entry: Record<string, any> = { permanent: "NO" };
    if (w.start) entry.startDateTime = w.start;
    if (w.end) entry.endDateTime = w.end;
    if (w.schedule.length > 0) {
      entry.schedule = w.schedule.map((s) => ({
        ...s,
        day: [...s.day].sort((a: string, b: string) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b)),
      }));
    }
    out.push(entry);
  }
  if (permanent) return undefined;
  return out.length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Gründe & Behörden
// ---------------------------------------------------------------------------

const REASON_DE: Record<string, string> = {
  AIR_TRAFFIC: "Luftverkehr",
  SENSITIVE: "Sensibles Objekt",
  PRIVACY: "Privatsphäre",
  POPULATION: "Bevölkerung",
  NATURE: "Naturschutz",
  NOISE: "Lärmschutz",
  FOREIGN_TERRITORY: "Fremdes Hoheitsgebiet",
  EMERGENCY: "Notfall",
  OTHER: "Sonstiges",
};

/** `Reasons` (Codes, komma-/semikolongetrennt) → deutscher Text; Freitext bleibt. */
export function esReasonText(value: unknown): string {
  const raw = Array.isArray(value) ? value.map(str) : str(value).split(/[,;]+/);
  const out: string[] = [];
  for (const r of raw.map((x) => x.trim()).filter(Boolean)) {
    const key = r.toUpperCase().replace(/[\s-]+/g, "_");
    const t = REASON_DE[key] ?? r;
    if (!out.includes(t)) out.push(t);
  }
  return out.join(", ");
}

export type EsAuthority = {
  name: string;
  purpose?: string;
  service?: string;
  contactName?: string;
  intervalBefore?: string;
  siteURL?: string;
  phone?: string;
  email?: string;
};

function authorityFromRow(get: (n: string) => any): EsAuthority | null {
  const name = str(get("Name_Authority")) || str(get("Service")) || str(get("ContactName"));
  if (!name) return null;
  const a: EsAuthority = { name };
  const purpose = str(get("Purpose")).toUpperCase();
  if (purpose) a.purpose = purpose;
  const service = str(get("Service"));
  if (service && service !== name) a.service = service;
  const contact = str(get("ContactName"));
  if (contact && contact !== name) a.contactName = contact;
  const interval = str(get("IntervalBefore"));
  if (interval) a.intervalBefore = interval;
  let site = str(get("SiteURL"));
  if (site && /^www\./i.test(site)) site = `https://${site}`;
  if (/^https?:\/\//i.test(site)) a.siteURL = site;
  const phone = str(get("Phone"));
  if (phone) a.phone = phone;
  const email = str(get("Email")).replace(/^mailto:/i, "");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) a.email = email;
  return a;
}

function intervalText(raw: string | undefined): string {
  if (!raw) return "";
  return isoDurationText(raw) || raw;
}

const PURPOSE_DE: Record<string, string> = {
  AUTHORIZATION: "Genehmigung",
  AUTHORISATION: "Genehmigung",
  NOTIFICATION: "Vorab-Mitteilung",
  INFORMATION: "Information",
};

/** Kontaktzeile je Behörde (für die Popup-Nachricht). */
function authorityLine(a: EsAuthority): string {
  const head = a.purpose && PURPOSE_DE[a.purpose] ? `${PURPOSE_DE[a.purpose]}: ` : "Zuständige Stelle: ";
  const parts: string[] = [a.name];
  if (a.service) parts.push(a.service);
  if (a.contactName) parts.push(`Kontakt: ${a.contactName}`);
  if (a.phone) parts.push(`Tel.: ${a.phone}`);
  if (a.email) parts.push(`E-Mail: ${a.email}`);
  if (a.siteURL) parts.push(`Web: ${a.siteURL}`);
  const lead = intervalText(a.intervalBefore);
  if (lead) parts.push(`Vorlauf: ${lead}`);
  return head + parts.join(" · ");
}

/** Deutsche Kurzfassung der Auflagen aus Restriction und Behörden. */
function germanSummary(restriction: string, authorities: EsAuthority[]): string {
  const lines: string[] = [];
  if (restriction === "PROHIBITED") lines.push("Flugverbot für UAS.");
  else if (restriction === "REQ_AUTHORISATION") lines.push("Flug nur mit Genehmigung.");
  else if (restriction === "CONDITIONAL") lines.push("Flug unter Auflagen zulässig – Bedingungen im Originaltext beachten.");
  for (const a of authorities.filter((x) => x.purpose === "AUTHORIZATION" || x.purpose === "AUTHORISATION")) {
    const lead = intervalText(a.intervalBefore);
    lines.push(`Genehmigung bei ${a.name}${lead ? ` (mind. ${lead} vorher beantragen)` : ""}.`);
  }
  for (const a of authorities.filter((x) => x.purpose === "NOTIFICATION")) {
    const lead = intervalText(a.intervalBefore);
    lines.push(`Vorab-Mitteilung an ${a.name}${lead ? ` (mind. ${lead} vorher)` : ""}.`);
  }
  return lines.join(" ");
}

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

function firstPosition(c: any): [number, number] | null {
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [c[0], c[1]] : null;
}

function swapDeep(c: any): any {
  if (!Array.isArray(c)) return c;
  if (typeof c[0] === "number") return [c[1], c[0], ...c.slice(2)];
  return c.map(swapDeep);
}

/**
 * Spanien liegt bei Lon −19…+5, Lat 27…44 (Kanaren bis Pyrenäen) – die Bereiche
 * überschneiden sich nicht. WFS 2.0 mit EPSG:4326 kann Lat/Lon liefern; das
 * wird hier erkannt und nach GeoJSON-Lon/Lat gedreht.
 */
export function esEnsureLonLat<T extends { type: string; coordinates: any }>(geometry: T): T {
  const p = firstPosition(geometry?.coordinates);
  if (!p) return geometry;
  const [x, y] = p;
  const looksLatLon = x >= 26 && x <= 45 && y >= -20 && y <= 6;
  return looksLatLon ? { ...geometry, coordinates: swapDeep(geometry.coordinates) } : geometry;
}

function polygonsOf(g: { type: string; coordinates: any }): any[] {
  if (g.type === "Polygon") return [g.coordinates];
  if (g.type === "MultiPolygon") return g.coordinates;
  return [];
}

function mergeGeometries(a: { type: string; coordinates: any }, b: { type: string; coordinates: any }) {
  const sa = JSON.stringify(a.coordinates);
  const polys = polygonsOf(a);
  for (const p of polygonsOf(b)) {
    const sp = JSON.stringify(p);
    if (sp !== sa && !polys.some((q) => JSON.stringify(q) === sp)) polys.push(p);
  }
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

type Group = {
  key: string;
  layer: EsLayer;
  rows: Record<string, any>[];
  geometry: { type: string; coordinates: any };
  get: (n: string) => any; // erste Zeile
  windows: EsWindow[];
  authorities: EsAuthority[];
};

/** Ein rohes Feature (ArcGIS-GeoJSON oder WFS-GeoJSON) mit Layer-Kennung. */
export type EsRawFeature = { layer: EsLayer; feature: any };

function groupKey(get: (n: string) => any, fallbackId: string): { key: string; identifier: string } {
  const identifier = str(get("Identifier"));
  const lower = parseEsAltitude(get("Lower"), get("UOM"), get("LowerReference"));
  const upper = parseEsAltitude(get("Upper"), get("UOM"), get("UpperReference"));
  // Gleiche Kennung mit anderem Höhenband = eigene Zone (ED-318: mehrere VerticalLayer).
  const vert = `${lower?.meters ?? "-"}${lower?.reference ?? ""}/${upper?.meters ?? "-"}${upper?.reference ?? ""}`;
  return { key: `${identifier || fallbackId}|${vert}`, identifier };
}

/**
 * Rohe ENAIRE-Features (alle drei Layer) → App-Features. Zeilen mit gleichem
 * `Identifier` (und gleichem Höhenband) werden zusammengeführt: DailyPeriods
 * zum Zeitplan, Behörden zur Kontaktliste, abweichende Geometrien zu einem
 * MultiPolygon. Abgelaufene Zonen und solche mit unerreichbarer Untergrenze
 * entfallen.
 */
export function normalizeSpanishFeatures(raw: EsRawFeature[], now: Date = new Date()): EsFeature[] {
  const groups = new Map<string, Group>();
  const order: string[] = [];
  raw.forEach(({ layer, feature }, idx) => {
    if (!feature || typeof feature !== "object" || !feature.geometry) return;
    const g0 = feature.geometry;
    if (g0.type !== "Polygon" && g0.type !== "MultiPolygon") return;
    const geometry = esEnsureLonLat({ type: g0.type, coordinates: g0.coordinates });
    const props = feature.properties || {};
    const get = esAttributeReader(props);
    const fallbackId = `${layer}-${str(get("OBJECTID")) || str(feature.id) || idx}`;
    const { key } = groupKey(get, fallbackId);
    let grp = groups.get(key);
    if (!grp) {
      grp = { key, layer, rows: [], geometry, get, windows: [], authorities: [] };
      groups.set(key, grp);
      order.push(key);
    } else if (JSON.stringify(grp.geometry.coordinates) !== JSON.stringify(geometry.coordinates)) {
      grp.geometry = mergeGeometries(grp.geometry, geometry);
    }
    grp.rows.push(props);
    addWindow(grp.windows, esDateIso(get("StartDateTime")), esDateIso(get("EndDateTime")), dailyPeriodEntry(get));
    const a = authorityFromRow(get);
    if (a && !grp.authorities.some((x) => JSON.stringify(x) === JSON.stringify(a))) grp.authorities.push(a);
  });

  const out: EsFeature[] = [];
  for (const key of order) {
    const f = buildFeature(groups.get(key)!, now);
    if (f) out.push(f);
  }
  return out;
}

function buildFeature(grp: Group, now: Date): EsFeature | null {
  const { get, layer, authorities } = grp;
  const lower = parseEsAltitude(get("Lower"), get("UOM"), get("LowerReference"));
  const upper = parseEsAltitude(get("Upper"), get("UOM"), get("UpperReference"));
  if (!esLowerIsRelevant(lower)) return null;

  const applicability = windowsToApplicability(grp.windows, now);
  if (applicability === null) return null;

  const restriction = esRestriction(get("Type"), layer);
  const identifier = str(get("Identifier"));
  const name = cleanText(get("Name")) || identifier || "Zona geográfica UAS";
  const msgEs = cleanText(get("Message"));
  const conditions = cleanText(get("RestrictionConditions"));
  const message = [
    germanSummary(restriction, authorities),
    msgEs,
    conditions && conditions !== msgEs && !msgEs.includes(conditions) ? conditions : "",
    authorities.map(authorityLine).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  const out: Record<string, any> = {
    identifier: identifier || undefined,
    zoneId: identifier ? `ES-${identifier}` : `ES-${grp.key.split("|")[0]}`,
    name,
    restriction,
    originalType: get("Type") ?? null,
    message,
    reason: esReasonText(get("Reasons")) || undefined,
    restrictionConditions: conditions || undefined,
    regulationExemption: str(get("RegulationExemption")) || undefined,
    country: str(get("Country")) || "ESP",
    legalBasis: ES_LAYER_LEGAL_BASIS[layer],
    source: ES_GEOZONE_SOURCE_LABEL,
    attribution: ES_GEOZONE_ATTRIBUTION,
    sourceLayer: layer,
    datasetIssued: esDateIso(get("Issued")) ?? undefined,
    datasetValidFrom: esDateIso(get("ValidFrom")) ?? undefined,
    datasetValidTo: esDateIso(get("ValidTo")) ?? undefined,
    datasetProvider: str(get("Provider")) || undefined,
    updated: esDateIso(get("UpdateDateTime")) ?? esDateIso(get("CreationDateTime")) ?? undefined,
  };
  if (applicability) out.applicability = applicability;
  applyAltitudes(out, lower, upper);

  if (authorities.length > 0) {
    // ed269SourceInfo liest name/siteURL; die E-Mail kommt separat als
    // mailto-Link (contactEmail), damit kein nackter E-Mail-„Link“ entsteht.
    out.zoneAuthority = authorities.map(({ email: _e, ...rest }) => rest);
    const mail =
      (authorities.find((a) => (a.purpose === "AUTHORIZATION" || a.purpose === "AUTHORISATION") && a.email) ??
        authorities.find((a) => a.email))?.email;
    if (mail) out.contactEmail = mail;
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { type: "Feature", geometry: grp.geometry, properties: out };
}

// ---------------------------------------------------------------------------
// ArcGIS-Hilfen (rein, testbar)
// ---------------------------------------------------------------------------

function layerNameKey(s: unknown): string {
  return stripAccents(str(s)).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * FeatureServer?f=json → Layer-IDs der drei ZGUAS-Layer. Exakter Name zuerst,
 * sonst Teilstring (aero / urban / infraestr). Nicht gefundene Layer fehlen.
 */
export function esLayerIdsFromService(body: any): Partial<Record<EsLayer, number>> {
  const layers: any[] = [
    ...(Array.isArray(body?.layers) ? body.layers : []),
    ...(Array.isArray(body?.tables) ? body.tables : []),
  ];
  const out: Partial<Record<EsLayer, number>> = {};
  const hints: Record<EsLayer, RegExp> = {
    ZGUAS_Aero: /aero/,
    ZGUAS_Urbano: /urban/,
    ZGUAS_Infraestructuras: /infra/,
  };
  for (const layer of ES_LAYERS) {
    const exact = layers.find((l) => layerNameKey(l?.name) === layerNameKey(layer));
    const loose = exact ?? layers.find((l) => hints[layer].test(layerNameKey(l?.name)));
    const id = Number(loose?.id);
    if (loose && Number.isInteger(id) && id >= 0) out[layer] = id;
  }
  return out;
}

/**
 * Seite einer ArcGIS-`f=geojson`-Antwort lesen. `exceededTransferLimit` steht
 * je nach Server-Version auf oberster Ebene oder unter `properties`. Ein
 * ArcGIS-Fehlerobjekt (HTTP 200 + {error}) wird als Fehler geworfen.
 */
export function esArcgisPage(body: any): { features: any[]; exceeded: boolean } {
  if (body && typeof body === "object" && body.error) {
    const e = body.error;
    throw new Error(`ArcGIS-Fehler ${e.code ?? ""}: ${e.message ?? "unbekannt"}`.trim());
  }
  const features = Array.isArray(body?.features) ? body.features : [];
  const exceeded = body?.exceededTransferLimit === true || body?.properties?.exceededTransferLimit === true;
  return { features, exceeded };
}
