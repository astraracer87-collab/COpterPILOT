// Spanische Geozonen (ENAIRE, „AIS Data Service for UAS Geographical Zones“) –
// Normalisierung in die ED-269-nahe Feature-Form, die client/lib/ed269.ts
// (parseEd269ToGeozoneInfo) liest: restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, applicability, zoneAuthority …
//
// Grundlage: docs/enaire-es-api-integration.md (ENAIRE-Spec v3.1, §4/§6;
// insignias-MapServer §3.1/§8). Abruf und Speicherung: Kachelspeicher
// (client/lib/geozoneTiles/, Teile base/infra/enp) bzw. live je Ausschnitt
// (geozoneTiles/esLive.ts) – Layer-Katalog ES_INSIGNIAS_LAYERS unten.
// Rechtsgrundlage/Default je ED-318-Layer:
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
// die App übersetzt separat. Pflicht-Attribution: „© ENAIRE – AIS“ (Doku).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { normalizeEd269Restriction } from "./ed269Restriction";
import { isoDurationText } from "./swedishGeozones";
import { parseHeight } from "./geozoneKit/heights";
import { cleanText as kitCleanText, round1 } from "./geozoneKit/text";
import { arcgisPage, ensureLonLat } from "./geozoneKit";
import { esNotamFixCircleGeometry, esNotamKey, normalizeEsNotamFeature } from "./spanishNotams";

export const ES_GEOZONE_SOURCE_LABEL = "ENAIRE (ED-318)";
export const ES_GEOZONE_ATTRIBUTION = "© ENAIRE – AIS";

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

/** UNKNOWN nur aus dem ED-318-Pfad (Quelle ohne Bezug; shared/heights.ts). */
export type EsAltitudeReference = "AGL" | "MSL" | "UNKNOWN";

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
  return kitCleanText(s, { br: true });
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
  return esRestrictionKnown(type) ?? ES_LAYER_DEFAULT_RESTRICTION[layer];
}

/** ENAIRE-`Type` → App-Restriction; null = leer/unbekannt (Aufrufer wählt den Default). */
export function esRestrictionKnown(type: unknown): string | null {
  const raw = stripAccents(str(type)).toUpperCase().replace(/[\s-]+/g, "_");
  if (raw) {
    if (/^(PROHIBID[OA]|ZONA_PROHIBIDA|PROHIBICION)$/.test(raw)) return "PROHIBITED";
    if (/^(REQUIERE_)?AUTORIZACION(_PREVIA)?$|^REQ_AUTORIZACION$/.test(raw)) return "REQ_AUTHORISATION";
    if (/^(CONDICIONAD[OA]|CONDICIONAL|CONDICIONES)$/.test(raw)) return "CONDITIONAL";
    if (/^(SIN_RESTRICCION(ES)?|INFORMATIV[OA]|INFORMACION)$/.test(raw)) return "NO_RESTRICTION";
    const n = normalizeEd269Restriction(raw);
    if (["PROHIBITED", "REQ_AUTHORISATION", "CONDITIONAL", "NO_RESTRICTION", "RESTRICTED"].includes(n)) return n;
  }
  return null;
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
  if (fl) return { meters: round1(parseHeight(s)?.m ?? 0), reference: "MSL", text: `FL ${Number(fl[1])}` };
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const refU = str(refRaw).toUpperCase();
  let uom = str(uomRaw).toUpperCase();
  if (uom === "F" || uom === "FEET") uom = "FT";
  if (uom === "METERS" || uom === "METRES" || uom === "") uom = refU === "STD" ? "FL" : "M";
  // Fehlender Bezug → UNKNOWN (Product Owner: nie still AGL; nie ausgeblendet).
  // Untergrenze 0 ohne Bezug bleibt „GND“ (0 ist in jedem Bezug der Boden bzw. darunter).
  const reference = esReference(refRaw, "UNKNOWN");
  if (n === 0 && reference !== "MSL") return { meters: 0, reference: "AGL", text: "GND" };
  // Umrechnung über den gemeinsamen Parser (unbekannte Einheit → Meter).
  const meters = parseHeight(n, uom === "FT" || uom === "FL" ? uom : "M")?.m ?? n;
  if (uom === "FL") return { meters: round1(meters), reference: "MSL", text: `FL ${n}` };
  const refText = refU === "WGS84" || refU === "MSL" ? "AMSL" : refU || "(Bezug unbekannt)";
  return { meters: round1(meters), reference, text: `${n} ${uom === "FT" ? "ft" : "m"} ${refText}` };
}

/** Untergrenze für Drohnen erreichbar (bzw. unbekannt) → Zone behalten. */
export function esLowerIsRelevant(lower: EsAltitude | null): boolean {
  if (!lower || lower.meters == null) return !lower?.unlimited;
  if (lower.reference === "UNKNOWN") return true; // unbekannter Bezug: behalten
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

/** Spanien (Kanaren bis Pyrenäen): Lon −20…+6, Lat 26…45 – überschneidungsfrei. */
const ES_LONLAT_BOUNDS = { minLon: -20, maxLon: 6, minLat: 26, maxLat: 45 };

/**
 * Spanien liegt bei Lon −19…+5, Lat 27…44 (Kanaren bis Pyrenäen) – die Bereiche
 * überschneiden sich nicht. WFS 2.0 mit EPSG:4326 kann Lat/Lon liefern; das
 * wird hier erkannt und nach GeoJSON-Lon/Lat gedreht (shared/geozoneKit/wfs.ts).
 */
export function esEnsureLonLat<T extends { type: string; coordinates: any }>(geometry: T): T {
  return ensureLonLat(geometry, ES_LONLAT_BOUNDS);
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

/**
 * Seite einer ArcGIS-`f=geojson`-Antwort lesen. `exceededTransferLimit` steht
 * je nach Server-Version auf oberster Ebene oder unter `properties`. Ein
 * ArcGIS-Fehlerobjekt (HTTP 200 + {error}) wird als Fehler geworfen.
 */
export function esArcgisPage(body: any): { features: any[]; exceeded: boolean } {
  return arcgisPage(body);
}

// Die früheren Abrufwege (AIP-ZIP-Downloads aip.enaire.es/…/ZGUAS/ mit
// normalizeSpanishEd318 sowie der veraltete FeatureServer „insigniads/…/
// SRV_UAS_ZG_data_V2“ mit WFS-Rückfall) sind 2026-11 entfernt: Spanien ist
// jetzt ein Kachelspeicher-Land auf Basis der insignias-MapServer (unten). Der
// Normalisierer normalizeSpanishFeatures (ED-318-Attribute) bleibt die Basis.

// ---------------------------------------------------------------------------
// PRIMÄRQUELLE seit 2026-11: ENAIRE „insignias“-MapServer (live verifiziert
// von DE-IP, 2026-11-15; docs/enaire-es-api-integration.md §3.1/§8,
// docs/geozonen-daten-abruf-DE-2026-11-15.md):
//   https://servais.enaire.es/insignias/rest/services/<Service>/MapServer/<Layer>/query
//   (ohne Auth, f=geojson, outSR=4326, maxRecordCount 2000)
// Spanien ist damit ein KACHELSPEICHER-Land (wie DE/FR/CZ): Infra (≈ 177 MB)
// und ENP (≈ 221 MB + Layer 1) sind zu groß für den ED-269-Gerätecache. Teile:
//   base  („Luftfahrt“, Pflicht): Aero_V3 1,2,3,4,6,10 + Urbano_V0/11
//   infra („Infrastruktur“, abwählbar): Infra_V0/11
//   enp   („Naturschutz“, abwählbar): ENP_APP_Local_V4/0,1
//   temp  (live, kurzer Cache): NOTAM_UAS_APP_V3/1
// Aero-Layer 0 (AERODROMOS) enthält nur Flugplatz-BEZUGSPUNKTE (Point, siehe
// Fixture enaire_aero_layer0_sample.geojson) – keine Zonen; die Flugplatz-
// zonen liefert Layer 6 (ZG_Aeródromos). Layer 0 wird daher nicht gespeichert.
//
// ⚠️ Feldnamen: Nur Layer 0 liegt als echte Fixture vor (OBJECTID, GFID,
// IDENT_TXT, NAME_TXT, REMARKS_TXT, TYPE_CODE, TIPO, CONTACTO …). Die
// Zonen-Layer werden tolerant gelesen: ED-318-Namen (Identifier, Type, Lower,
// Upper, UOM, LowerReference, StartDateTime …) ODER die insignias-Varianten
// (RESTRICCION_LOWER/RESTRICCION_UPPER, NAME_TXT, REMARKS_TXT …). Ein
// fehlender Höhenbezug ist UNKNOWN (Product Owner, Stand Länder-Nutzung:
// nie still AGL; die Zone wird nie wegen der Höhe ausgeblendet).
// ---------------------------------------------------------------------------

export const ENAIRE_INSIGNIAS_BASE = "https://servais.enaire.es/insignias/rest/services";

export type EsTilePart = "base" | "infra" | "enp" | "temp";

export interface EsInsigniasLayer {
  /** Schlüssel (Feature-ID-Präfix im Kachelspeicher) */
  key: string;
  /** Service-Pfad unter ENAIRE_INSIGNIAS_BASE */
  service: string;
  layerId: number;
  part: EsTilePart;
  /** Ebenen-Bezeichnung (deutsch) */
  labelDe: string;
  /** Bisheriger ED-318-Layer (Rechtsgrundlage, Default) */
  legacyLayer: EsLayer;
  /** Beschränkung, wenn die Zone keinen lesbaren Typ trägt */
  defaultRestriction: string;
  /** Seitengröße beim Download (Antwort meist < ~3 MB) */
  pageSize: number;
  /**
   * Titel der Ebene in der Web Map von drones.enaire.es (stabil, anders als
   * die versionierten Dienstpfade); Vergleich ohne Akzente/Groß-/Kleinschreibung.
   */
  titles: string[];
  /** Naturschutz-Art (ENP bzw. Vogelschutz ZEPA) – gleiche Regeln. */
  nature?: "enp" | "zepa";
  /**
   * Aktuelle Layer-URL (`…/MapServer/<id>`) aus der Web-Map-Definition;
   * fehlt sie, gilt der feste Pfad service/layerId (nur Rückfall).
   */
  url?: string;
}

/**
 * Alle Zonen-Layer. Seitengrößen nach den gemessenen Größen (§8): Infra
 * ≈ 12,5 KB/Zone, ENP ≈ 122 KB/Zone, Aero ≈ 8 KB/Zone.
 * Defaults (ohne lesbaren Typ): Luftfahrt und Infrastruktur Genehmigung,
 * Urbano Bedingungen (RD 517/2024 Art. 40: Vorab-Mitteilung), AVISOS/
 * Modellflug Bedingungen (Hinweis-/Aktivitätsgebiete), ENP Naturschutz,
 * NOTAM Beschränkungsgebiet (Freigabe nötig).
 */
export const ES_INSIGNIAS_LAYERS: readonly EsInsigniasLayer[] = [
  { key: "es_eac_fiz", service: "NSF/Drones_ZG_Aero_V3", layerId: 1, part: "base", labelDe: "Kontrollierter Luftraum / FIZ", legacyLayer: "ZGUAS_Aero", defaultRestriction: "REQ_AUTHORISATION", pageSize: 300, titles: ["ZG_EAC_FIZ", "EAC_FIZ"] },
  { key: "es_avisos", service: "NSF/Drones_ZG_Aero_V3", layerId: 2, part: "base", labelDe: "Hinweise (AVISOS)", legacyLayer: "ZGUAS_Aero", defaultRestriction: "CONDITIONAL", pageSize: 100, titles: ["AVISOS", "ZG_AVISOS"] },
  { key: "es_rvf", service: "NSF/Drones_ZG_Aero_V3", layerId: 3, part: "base", labelDe: "Fotoflug-Beschränkung (RVF)", legacyLayer: "ZGUAS_Aero", defaultRestriction: "REQ_AUTHORISATION", pageSize: 300, titles: ["ZG_RVF", "RVF"] },
  { key: "es_aeromodelismo", service: "NSF/Drones_ZG_Aero_V3", layerId: 4, part: "base", labelDe: "Modellflug", legacyLayer: "ZGUAS_Aero", defaultRestriction: "CONDITIONAL", pageSize: 500, titles: ["AEROMODELISMO", "ZG_AEROMODELISMO"] },
  // „ZG_Aeródromos“ (Zonen) – NICHT „AERODROMOS“ (Layer 0, nur Bezugspunkte)
  { key: "es_aerodromos", service: "NSF/Drones_ZG_Aero_V3", layerId: 6, part: "base", labelDe: "Flugplätze", legacyLayer: "ZGUAS_Aero", defaultRestriction: "REQ_AUTHORISATION", pageSize: 300, titles: ["ZG_Aeródromos"] },
  { key: "es_restringidas", service: "NSF/Drones_ZG_Aero_V3", layerId: 10, part: "base", labelDe: "Sperr-/Beschränkungsgebiete", legacyLayer: "ZGUAS_Aero", defaultRestriction: "REQ_AUTHORISATION", pageSize: 200, titles: ["ZG_Restringidas", "RESTRINGIDAS"] },
  { key: "es_urbano", service: "NSF/Drones_ZG_Urbano_V0", layerId: 11, part: "base", labelDe: "Urbane Zonen", legacyLayer: "ZGUAS_Urbano", defaultRestriction: "CONDITIONAL", pageSize: 200, titles: ["ZG_Urbano", "URBANO"] },
  { key: "es_infra", service: "NSF/Drones_ZG_Infra_V0", layerId: 11, part: "infra", labelDe: "Infrastruktur", legacyLayer: "ZGUAS_Infraestructuras", defaultRestriction: "REQ_AUTHORISATION", pageSize: 200, titles: ["ZG_Infraestructuras", "INFRAESTRUCTURAS", "ZG_Infra"] },
  { key: "es_enp0", service: "ENP/ENP_APP_Local_V4", layerId: 0, part: "enp", labelDe: "Naturschutz (ENP)", legacyLayer: "ZGUAS_Infraestructuras", defaultRestriction: "NATURE", pageSize: 20, titles: ["ENP", "Espacios Naturales Protegidos"], nature: "enp" },
  // ZEPA (Vogelschutzgebiete) – eigene Web-Map-Ebene, drohnenrelevant laut Doku (Anhang ES), gleiche Regeln wie ENP
  { key: "es_enp1", service: "ENP/ENP_APP_Local_V4", layerId: 1, part: "enp", labelDe: "Vogelschutzgebiet (ZEPA)", legacyLayer: "ZGUAS_Infraestructuras", defaultRestriction: "NATURE", pageSize: 20, titles: ["ZEPA", "Zonas de Especial Protección para las Aves"], nature: "zepa" },
  // NOTAM: ≈ 730 Features, maxRecordCount 3000 → ein Abruf (Doku NOTAM §2)
  { key: "es_notam", service: "NOTAM/NOTAM_UAS_APP_V3", layerId: 1, part: "temp", labelDe: "NOTAM (temporär)", legacyLayer: "ZGUAS_Aero", defaultRestriction: "RESTRICTED", pageSize: 3000, titles: ["NOTAM", "NOTAM UAS"] },
];

const ES_LAYER_BY_KEY = new Map(ES_INSIGNIAS_LAYERS.map((l) => [l.key, l]));

export function esInsigniasLayer(key: string | null | undefined): EsInsigniasLayer | null {
  return ES_LAYER_BY_KEY.get(String(key ?? "")) ?? null;
}

/** Layer eines Teils. */
export function esInsigniasLayersOf(part: EsTilePart): EsInsigniasLayer[] {
  return ES_INSIGNIAS_LAYERS.filter((l) => l.part === part);
}

/** Fester Rückfall-Pfad (`…/<Service>/MapServer/<id>`), Stand Doku 2026-11. */
export function esInsigniasDefaultUrl(l: EsInsigniasLayer): string {
  return `${ENAIRE_INSIGNIAS_BASE}/${l.service}/MapServer/${l.layerId}`;
}

/** Layer-URL: aus der Web Map aufgelöst, sonst der feste Rückfall-Pfad. */
export function esInsigniasLayerUrl(l: EsInsigniasLayer): string {
  return l.url || esInsigniasDefaultUrl(l);
}

/**
 * Seiten-Abfrage (GeoJSON, WGS84, alle Felder, VOLLE Präzision – bewusst
 * ohne maxAllowableOffset/geometryPrecision: keine Vereinfachung), stabile
 * Reihenfolge über OBJECTID.
 */
export function esInsigniasPageUrl(l: EsInsigniasLayer, offset: number, count: number): string {
  const p = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "OBJECTID ASC",
    resultOffset: String(offset),
    resultRecordCount: String(count),
    f: "geojson",
  });
  return `${esInsigniasLayerUrl(l)}/query?${p.toString()}`;
}

/** Zähl-Abfrage (`returnCountOnly`, f=json → { count }). */
export function esInsigniasCountUrl(l: EsInsigniasLayer): string {
  const p = new URLSearchParams({ where: "1=1", returnCountOnly: "true", f: "json" });
  return `${esInsigniasLayerUrl(l)}/query?${p.toString()}`;
}

/** Ausschnitts-Abfrage (Envelope w,s,e,n in WGS84, Intersects). */
export function esInsigniasBboxUrl(l: EsInsigniasLayer, bbox: [number, number, number, number], offset = 0, count = 1000): string {
  const p = new URLSearchParams({
    where: "1=1",
    geometry: bbox.map((v) => String(Math.round(v * 1e6) / 1e6)).join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "OBJECTID ASC",
    resultOffset: String(offset),
    resultRecordCount: String(count),
    f: "geojson",
  });
  return `${esInsigniasLayerUrl(l)}/query?${p.toString()}`;
}

/** count aus einer returnCountOnly-Antwort; null = unlesbar. ArcGIS-Fehler → Error. */
export function esInsigniasCount(body: any): number | null {
  if (body && typeof body === "object" && body.error) {
    throw new Error(`ArcGIS-Fehler ${body.error.code ?? ""}: ${body.error.message ?? "unbekannt"}`.trim());
  }
  const n = Number(body?.count);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Rohfeature eines Layers für den Speicher markieren: ID `<key>.<OBJECTID>`
 * (OBJECTID ist nur je Layer eindeutig) und `_esLayer`. Nur Polygone –
 * Punkte (Layer 0 / Bezugspunkte) und Linien sind keine Zonen.
 */
export function tagEsInsigniasFeature(f: any, key: string): any | null {
  const t = f?.geometry?.type;
  if (t !== "Polygon" && t !== "MultiPolygon") return null;
  const p = f.properties || {};
  if (esInsigniasLayer(key)?.part === "temp") {
    // NOTAM: Schlüssel notamId (OBJECTID wird bei jedem Neubefüllen neu
    // vergeben, GFID ist die Quell-NOTAM-Nummer); nie über die Geometrie
    // deduplizieren. Grobe 37-Punkt-Kreise fein neu erzeugen bzw. puffern.
    const nid = esNotamKey(p);
    const oid = nid ?? p.OBJECTID ?? p.objectid ?? f.id;
    if (oid == null || oid === "") return null;
    const fix = esNotamFixCircleGeometry(f.geometry, [p.itemE, p.itemQ, p.ITEME, p.ITEMQ].map((x) => (x == null ? "" : String(x))));
    const props: Record<string, any> = { ...p, _esLayer: key };
    if (fix.circle) props._esCircle = fix.circle;
    return { type: "Feature", id: `${key}.${oid}`, geometry: fix.geometry, properties: props };
  }
  const oid = p.OBJECTID ?? p.objectid ?? p.FID ?? f.id;
  if (oid == null || oid === "") return null;
  return { type: "Feature", id: `${key}.${oid}`, geometry: f.geometry, properties: { ...p, _esLayer: key } };
}

// Feldnamen-Varianten der insignias-Layer → ED-318-Namen des bestehenden Normalisierers.
const INSIGNIAS_ALIASES: Record<string, string[]> = {
  Identifier: ["IDENTIFIER", "IDENTIFICADOR", "IDENT_TXT", "GFID", "ID_ZONA", "CODIGO", "CODE", "NOTAM_ID", "NOTAMID", "ID_NOTAM", "SERIE", "SITECODE", "SITE_CODE"],
  Name: ["NAME_TXT", "NOMBRE", "NOMBRE_ZONA", "DENOMINACION", "SITE_NAME", "NOMBRE_ENP", "NAME"],
  Type: ["TIPO_RESTRICCION", "RESTRICCION", "RESTRICTION", "TYPE_RESTRICTION", "UASZONE_TYPE"],
  Message: ["MESSAGE", "MENSAJE", "REMARKS_TXT", "OBSERVACIONES", "OBSERVACION", "DESCRIPCION", "ITEME", "ITEM_E", "TEXTO"],
  RestrictionConditions: ["CONDICIONES", "RESTRICCIONES", "CONDITIONS"],
  Lower: ["RESTRICCION_LOWER", "LOWER_VAL", "LOWERLIMIT", "LOWER_LIMIT", "ALT_INF", "LIM_INF", "ALTURA_MIN", "ITEMF"],
  Upper: ["RESTRICCION_UPPER", "UPPER_VAL", "UPPERLIMIT", "UPPER_LIMIT", "ALT_SUP", "LIM_SUP", "ALTURA_MAX", "ITEMG"],
  UOM: ["RESTRICCION_UOM", "UOM_VAL", "UNIDAD", "UNIT", "UOM_DIMENSIONS"],
  LowerReference: ["RESTRICCION_LOWER_REF", "LOWER_REF", "LOWERREF", "LOWER_DATUM", "REF_INF"],
  UpperReference: ["RESTRICCION_UPPER_REF", "UPPER_REF", "UPPERREF", "UPPER_DATUM", "REF_SUP"],
  StartDateTime: ["FECHA_INICIO", "F_INICIO", "VALID_FROM", "VALIDFROM", "DATE_FROM", "START_DATE", "ITEMB", "ITEM_B"],
  EndDateTime: ["FECHA_FIN", "F_FIN", "VALID_TO", "VALIDTO", "DATE_TO", "END_DATE", "ITEMC", "ITEM_C"],
  Email: ["EMAIL", "CORREO", "E_MAIL"],
  Phone: ["TELEFONO", "PHONE", "TLF"],
  SiteURL: ["URL", "WEB", "ENLACE"],
};

/** NOTAM-Zeitangabe „yyMMddHHmm“ (B/C-Feld) → ISO; sonst null. */
export function esNotamDateIso(v: unknown): string | null {
  const s = str(v);
  const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59) return null;
  return new Date(Date.UTC(2000 + y, mo - 1, d, h, mi)).toISOString();
}

/** HTML-Reste (<font>, <a>) aus Kontakt-/Linkfeldern entfernen. */
function plain(v: unknown): string {
  return str(v).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** insignias-Properties → ED-318-Namen (vorhandene ED-318-Felder haben Vorrang). */
export function esInsigniasToEd318Props(props: Record<string, any>): Record<string, any> {
  const get = esAttributeReader(props);
  const out: Record<string, any> = { ...props };
  for (const [canon, aliases] of Object.entries(INSIGNIAS_ALIASES)) {
    if (get(canon) != null) continue;
    for (const a of aliases) {
      const v = get(a);
      if (v == null) continue;
      let val: any = v;
      if (canon === "StartDateTime" || canon === "EndDateTime") val = esNotamDateIso(v) ?? v;
      if (canon === "Email" || canon === "Phone" || canon === "SiteURL") val = plain(v);
      if (canon === "Lower" || canon === "Upper") {
        // NOTAM-F/G-Felder („GND“, „FL065“, „1000FT AMSL“) und Zahlen
        const t = str(v).toUpperCase();
        if (/^(GND|SFC)$/.test(t)) val = "GND";
      }
      out[canon] = val;
      break;
    }
  }
  return out;
}

/**
 * Ein gespeichertes bzw. live geladenes insignias-Feature → App-Feature
 * (gleiche Form wie normalizeSpanishFeatures; zusätzlich `esLayerKey`,
 * `layerLabel`-Hinweis, NOTAM-/Naturschutz-Kennzeichen). null = keine Zone
 * (keine Fläche, abgelaufen, Untergrenze unerreichbar).
 */
export function normalizeEnaireInsigniasFeature(f: any, now: Date = new Date()): EsFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const key = str(f.properties?._esLayer) || str(f.id).split(".")[0];
  const layer = esInsigniasLayer(key);
  if (!layer) return null;
  if (layer.part === "temp") {
    const g = f.geometry;
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
    return normalizeEsNotamFeature(
      { ...f, geometry: esEnsureLonLat({ type: g.type, coordinates: g.coordinates }) },
      { now, sourceLabel: ES_GEOZONE_SOURCE_LABEL, attribution: ES_GEOZONE_ATTRIBUTION, layerKey: layer.key },
    ) as EsFeature | null;
  }
  const ed318 = esInsigniasToEd318Props(f.properties || {});
  const get = esAttributeReader(ed318);
  const known = esRestrictionKnown(get("Type"));
  const [base] = normalizeSpanishFeatures([{ layer: layer.legacyLayer, feature: { ...f, properties: ed318 } }], now);
  if (!base) return null;
  const p = base.properties;
  let restriction = known ?? layer.defaultRestriction;
  const lines: string[] = [`ENAIRE-Ebene: ${layer.labelDe}`];
  if (!known && layer.defaultRestriction === "NATURE") {
    lines.push(
      layer.nature === "zepa"
        ? "Vogelschutzgebiet (ZEPA, Zona de Especial Protección para las Aves) – Schutzvorschriften beachten; Drohnenflug kann verboten oder genehmigungspflichtig sein."
        : "Naturschutzgebiet (Espacio Natural Protegido) – Schutzvorschriften beachten; Drohnenflug kann verboten oder genehmigungspflichtig sein.",
    );
  } else if (!known && restriction !== p.restriction) {
    // Layer-Default dieses Layers weicht vom ED-318-Layer-Default ab
    lines.push(restriction === "CONDITIONAL" ? "Flug unter Auflagen zulässig – Bedingungen im Originaltext beachten." : "Flug nur mit Genehmigung.");
  }
  if (!known) restriction = restriction || p.restriction;
  const tail = !known && restriction !== p.restriction ? String(p.message ?? "").replace(/^(Flugverbot für UAS\.|Flug nur mit Genehmigung\.|Flug unter Auflagen zulässig – Bedingungen im Originaltext beachten\.)\s*/, "") : String(p.message ?? "");
  p.message = [lines.join("\n"), tail].filter((x) => x.trim()).join("\n\n");
  p.restriction = restriction;
  if (!known) p.restrictionAssumed = true;
  p.esLayerKey = layer.key;
  p.esLayerLabel = layer.labelDe;
  p.sourceLayer = layer.key;
  p.legalBasis =
    layer.nature === "zepa"
      ? "Red Natura 2000 – Zona de Especial Protección para las Aves (ZEPA)"
      : layer.part === "enp"
        ? "Normativa de Espacios Naturales Protegidos"
        : ES_LAYER_LEGAL_BASIS[layer.legacyLayer];
  // Je gespeicherter Zeile eindeutig (ED-318-Listen wie DailyPeriod kommen als
  // mehrere Zeilen mit gleichem Identifier – nicht zusammenführen, sonst ginge
  // beim Dedupe ein Zeitfenster verloren; Doppelanzeige ist die sichere Seite).
  p.zoneId = f.id != null && str(f.id) ? `ES-${str(f.id)}` : `ES-${layer.key}-${str(p.identifier)}`;
  return base;
}

// ---------------------------------------------------------------------------
// Dienstnamen dynamisch aus der Web Map (Doku „Anhang ES (2)“): Die
// Versionssuffixe (Drones_ZG_Aero_V3, Drones_ZG_Infra_V0, NOTAM_UAS_APP_V3,
// ENP_APP_Local_V4) wechseln mit neuen ENAIRE-Versionen. Beim Sync wird die
// Web-Map-Definition gelesen und die Layer-URL über den stabilen TITEL
// zugeordnet; die festen Pfade oben sind nur Rückfall.
// ---------------------------------------------------------------------------

export const ES_WEBMAP_ITEM_ID = "b0449bba555240e9b93207cd8c190f21";
export const ES_WEBMAP_DATA_URL = `https://servais.enaire.es/insigniap/sharing/rest/content/items/${ES_WEBMAP_ITEM_ID}/data?f=json`;

/** Titel vergleichbar machen: ohne Akzente, klein, nur a–z/0–9 („ZG_Aeródromos“ → „zgaerodromos“). */
export function esTitleKey(title: unknown): string {
  return stripAccents(str(title)).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Katalog-Layer zu einem Web-Map-Titel; null = unbekannt. */
export function esLayerForTitle(title: unknown, layers: readonly EsInsigniasLayer[] = ES_INSIGNIAS_LAYERS): EsInsigniasLayer | null {
  const t = esTitleKey(title);
  if (!t) return null;
  return layers.find((l) => l.titles.some((x) => esTitleKey(x) === t)) ?? null;
}

const ES_SERVICE_URL_RE = /^https?:\/\/servais\.enaire\.es\/[^?#]*\/rest\/services\/[^?#]+\/(?:MapServer|FeatureServer)(?:\/(\d+))?\/?$/i;

/**
 * Nur ENAIRE-ArcGIS-Dienste unter servais.enaire.es (kein Webseiten-Proxy,
 * keine Fremd-Hosts); http → https. Rückgabe ohne abschließenden „/“.
 */
export function esServiceUrl(url: unknown): { url: string; layerId: number | null } | null {
  const u = str(url).replace(/\/+$/, "");
  const m = u.match(ES_SERVICE_URL_RE);
  if (!m) return null;
  return { url: u.replace(/^http:\/\//i, "https://"), layerId: m[1] != null ? Number(m[1]) : null };
}

type WebmapEntry = { title: string; url: string; layerId: number | null; parentTitle?: string; siblings?: number };

function walkEsWebmap(list: unknown, out: WebmapEntry[]): void {
  if (!Array.isArray(list)) return;
  for (const l of list) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, any>;
    const title = str(o.title ?? o.name);
    const svc = esServiceUrl(o.url);
    if (svc && svc.layerId != null) {
      out.push({ title, url: svc.url, layerId: svc.layerId });
      continue;
    }
    if (svc) {
      // Kartendienst (…/MapServer) mit Unterebenen [{ id, title|name, url? }]
      const subs = Array.isArray(o.layers) ? o.layers : [];
      const withId = subs.filter((x: any) => x && typeof x === "object" && (x.url || Number.isInteger(Number(x.id))));
      if (withId.length === 0) {
        out.push({ title, url: svc.url, layerId: null });
        continue;
      }
      for (const sub of withId) {
        const subSvc = esServiceUrl(sub.url);
        if (subSvc && subSvc.layerId != null) out.push({ title: str(sub.title ?? sub.name), url: subSvc.url, layerId: subSvc.layerId, parentTitle: title, siblings: withId.length });
        else if (!sub.url) {
          const id = Number(sub.id);
          out.push({ title: str(sub.title ?? sub.name), url: `${svc.url}/${id}`, layerId: id, parentTitle: title, siblings: withId.length });
        }
      }
      continue;
    }
    // Gruppenebene ohne Dienst → rekursiv
    if (Array.isArray(o.layers)) walkEsWebmap(o.layers, out);
  }
}

export interface EsResolvedLayers {
  /** Gesamter Katalog; `url` gesetzt, wo die Web Map die Ebene liefert. */
  layers: EsInsigniasLayer[];
  /** Schlüssel, deren URL aus der Web Map stammt. */
  fromWebmap: string[];
  /** Schlüssel ohne Treffer in der Web Map (fester Rückfall-Pfad). */
  fallback: string[];
  /** Web-Map-Ebenen ohne bekannte Zuordnung (nur fürs Log). */
  unknown: string[];
}

/**
 * Web-Map-Definition (`…/items/b0449bba…/data?f=json` → operationalLayers[]
 * inkl. geschachtelter layers[] mit title/url) → Layer-URLs je Katalog-Layer,
 * Zuordnung über den Titel (tolerant gegenüber Akzenten/Schreibweise).
 * Kartendienst ohne Unterebenen-Angabe → Titel des Dienstes + bekannte
 * Layer-Nummer; unbekannte Unterebene eines Dienstes mit passendem Titel
 * (z. B. NOTAM → „Áreas“) nur bei gleicher Layer-Nummer bzw. einziger Unterebene.
 */
export function resolveEsLayersFromWebmap(webmap: any, catalog: readonly EsInsigniasLayer[] = ES_INSIGNIAS_LAYERS): EsResolvedLayers {
  const entries: WebmapEntry[] = [];
  walkEsWebmap(webmap?.operationalLayers, entries);
  const urls = new Map<string, string>();
  const unknown: string[] = [];
  for (const e of entries) {
    let def = esLayerForTitle(e.title, catalog);
    if (!def && e.parentTitle) {
      const parent = esLayerForTitle(e.parentTitle, catalog);
      if (parent && (e.layerId === parent.layerId || e.siblings === 1)) def = parent;
    }
    if (!def) {
      unknown.push(e.title || e.url);
      continue;
    }
    if (urls.has(def.key)) continue;
    urls.set(def.key, e.layerId != null ? e.url : `${e.url}/${def.layerId}`);
  }
  const layers = catalog.map((l) => (urls.has(l.key) ? { ...l, url: urls.get(l.key) } : { ...l }));
  return {
    layers,
    fromWebmap: catalog.filter((l) => urls.has(l.key)).map((l) => l.key),
    fallback: catalog.filter((l) => !urls.has(l.key)).map((l) => l.key),
    unknown,
  };
}
