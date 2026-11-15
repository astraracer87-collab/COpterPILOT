// Rumänien (ROMATSA) – Normalisierung der beiden öffentlichen Quellen auf das
// App-Format (GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo
// in client/lib/ed269.ts liest). Siehe docs/greece-romania-geozones-notes.md
// („Rumänien“ und „Anhang RO“) – live verifiziert von DE-IP (2026-11-15),
// Fixtures docs/fixtures/ro_zones_sample.geojson und ro_notam_sample.geojson.
//
// 1. Statischer Zonensatz (dauerhafte Zonen, 1.272 Features)
//    GET https://flightplan.romatsa.ro/init/static/zone_restrictionate_uav.json
//    Properties: zone_id ("RZ 1001"), lower_lim ("GND", "120M AGL"),
//    upper_lim ("120M AGL", "2500FT AMSL", "FL065"), contact (Telefon/E-Mail,
//    teils mit angehängtem englischem Hinweis), status ("RESTRICTED").
// 2. GeoServer-WFS NOTAM-UAV (temporäre Zonen, 226 Features)
//    carto:restrictii_notam_pt_uav – serie ("R5607/2026"), dfrom/dto (ISO),
//    mesaj (voller NOTAM-Text, Zeilen mit \r), tip ("R").
//
// Zuordnung (Doku-Tabelle, „weitere Werte prüfen“):
//   status RESTRICTED → REQ_AUTHORISATION (Kontakt zur Flugsicherung/TWR nötig)
//   status PROHIBITED/INTERZIS → PROHIBITED; leer/unbekannt → REQ_AUTHORISATION
//   (vorsichtig, mit Hinweis)
//   NOTAM tip P → PROHIBITED, R → RESTRICTED (Freigabe nötig), D → CONDITIONAL
//   (Gefahrengebiet), sonst RESTRICTED. Höhen aus F)/G) des NOTAM-Texts
//   (sonst Q-Zeile), Zeitplan „D) DAILY hhmm-hhmm“ → applicability.schedule.
//
// Meldungen: deutsche Zeilen + Originaltext der Behörde (englisch/rumänisch)
// unter „Originaltext der Behörde:“; localizedMessages de zuerst.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { parseHeight, type Height } from "./geozoneKit/heights";
import { cleanText, round1 } from "./geozoneKit/text";
import {
  localizedExtendedProperties,
  messageWithOriginal,
  sourceLineDe,
  heightLineDe,
} from "./geozoneKit/messages";

export const RO_GEOZONE_SOURCE_LABEL = "ROMATSA";
export const RO_GEOZONE_ATTRIBUTION = "© ROMATSA (Romanian Air Traffic Services Administration)";
export const RO_ROMATSA_DRONES_URL = "https://flightplan.romatsa.ro/init/drones";
export const RO_STATIC_ZONES_URL = "https://flightplan.romatsa.ro/init/static/zone_restrictionate_uav.json";
export const RO_WFS_URL = "https://flightplan.romatsa.ro/init/geoserver/ows";
export const RO_NOTAM_TYPENAME = "carto:restrictii_notam_pt_uav";

/** WFS-1.0.0-GetFeature der NOTAM-UAV-Ebene (GeoJSON, alle Features). */
export function roNotamWfsUrl(maxFeatures = 5000): string {
  const p = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: RO_NOTAM_TYPENAME,
    maxFeatures: String(maxFeatures),
    outputFormat: "application/json",
  });
  return `${RO_WFS_URL}?${p.toString()}`;
}

export type RoRestriction = "PROHIBITED" | "RESTRICTED" | "REQ_AUTHORISATION" | "CONDITIONAL";

export type RoFeature = { type: "Feature"; id?: string; geometry: any; properties: Record<string, any> };

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** status → Beschränkung; `assumed` = unbekannter Wert (vorsichtig). */
export function roStatusRestriction(status: unknown): { restriction: RoRestriction; assumed: boolean } {
  const s = str(status).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/^(PROHIBITED|INTERZIS[AĂ]?|FORBIDDEN|NO.?FLY)$/.test(s)) return { restriction: "PROHIBITED", assumed: false };
  if (/^(RESTRICTED|RESTRICTIONAT[AĂ]?|RESTRICTIONATA)$/.test(s)) return { restriction: "REQ_AUTHORISATION", assumed: false };
  if (/^(CONDITIONAL|CONDITIONAT[AĂ]?)$/.test(s)) return { restriction: "CONDITIONAL", assumed: false };
  return { restriction: "REQ_AUTHORISATION", assumed: true };
}

/** NOTAM-tip → Beschränkung. */
export function roNotamRestriction(tip: unknown): RoRestriction {
  const t = str(tip).toUpperCase();
  if (t === "P") return "PROHIBITED";
  if (t === "D") return "CONDITIONAL";
  return "RESTRICTED";
}

const RESTRICTION_LINE_DE: Record<RoRestriction, string> = {
  PROHIBITED: "Flugverbot für Drohnen.",
  RESTRICTED: "Beschränkungsgebiet – Einflug nur mit Freigabe der Flugsicherung.",
  REQ_AUTHORISATION: "Flug nur nach Genehmigung/Koordination mit der zuständigen Stelle (siehe Kontakt).",
  CONDITIONAL: "Gefahrengebiet – Flug nur unter Auflagen; NOTAM beachten.",
};

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

/** ROMATSA-Höhe („GND“, „120M AGL“, „2500FT AMSL“, „FL065“, „UNL“) → Height. */
export function parseRoHeight(raw: unknown): Height | null {
  const s = str(raw).toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  // „FL 065“ / „FL065“ / „120 M AGL“ – parseHeight versteht alle Formen.
  return parseHeight(s.replace(/^FL\s+/, "FL"));
}

function heightText(h: Height | null, side: "lower" | "upper"): string {
  if (!h) return side === "lower" ? "GND" : "keine Angabe";
  if (h.m == null) return h.text === "GND" ? "GND" : "unbegrenzt";
  if (h.unit === "FL") return `${h.text} (≈ ${Math.round(h.m)} m)`;
  if (h.unit === "ft") return `${h.text} (${Math.round(h.m)} m)`;
  return h.text;
}

function applyHeights(props: Record<string, any>, lower: Height | null, upper: Height | null): void {
  if (lower && lower.m != null) {
    props.lowerMeters = round1(lower.m);
    props.lowerReference = lower.ref === "UNKNOWN" ? undefined : lower.ref;
  } else {
    props.lowerMeters = 0;
    props.lowerReference = "AGL";
  }
  if (upper) {
    if (upper.m != null) props.upperMeters = round1(upper.m);
    if (upper.ref !== "UNKNOWN") props.upperReference = upper.ref;
  }
  props.altitudeText = `${lower?.text || "GND"} – ${upper?.text || "UNL"}`;
}

// ---------------------------------------------------------------------------
// Kontakt (statische Zonen)
// ---------------------------------------------------------------------------

/** Wiederkehrende englische Hinweise im Feld `contact` → Deutsch. */
const CONTACT_NOTES_DE: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^For flights up to (\d+)\s*m(?:eters)? AGL in this zone,? drone pilots shall contact (TWR|APP|ATC|the TWR)(?: at the above-?mentioned phone(?: number)?)?\.?$/i,
    (m) => `Für Flüge bis ${m[1]} m AGL in dieser Zone müssen Drohnenpiloten den Tower (${m[2].replace(/^the /i, "").toUpperCase()}) unter der oben genannten Telefonnummer kontaktieren.`,
  ],
  [
    /^Drone pilots shall contact (TWR|APP|ATC)(?: at the above-?mentioned phone(?: number)?)?(?: before (?:the )?flight)?\.?$/i,
    (m) => `Drohnenpiloten müssen vor dem Flug ${m[1].toUpperCase()} unter der oben genannten Telefonnummer kontaktieren.`,
  ],
];

export interface RoContact {
  phones: string[];
  emails: string[];
  /** Freitext nach Telefon/E-Mail (Original) */
  note: string;
  /** deutscher Hinweis (wenn bekannt), sonst "" */
  noteDe: string;
  /** Stelle („ROMATSA“) */
  org: string;
}

/**
 * Kontaktfeld zerlegen: „ROMATSA +40257 255 706 +40734 222 926
 * twr.arad@romatsa.roFor flights up to 120m AGL …“ – der Hinweis klebt ohne
 * Leerzeichen an der E-Mail-Adresse (.ro + Großbuchstabe).
 */
export function parseRoContact(raw: unknown): RoContact {
  let s = str(raw).replace(/\s+/g, " ");
  const emails: string[] = [];
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+?\.(?:ro|com|eu|org|net)(?=[A-Z\s,;]|$)/g, (e) => {
    emails.push(e);
    return " ";
  });
  const phones: string[] = [];
  s = s.replace(/\+?\d[\d ()/-]{6,}\d/g, (p) => {
    phones.push(p.trim());
    return " ";
  });
  s = s.replace(/\s+/g, " ").trim();
  const orgMatch = s.match(/^(ROMATSA|AACR|TWR [A-Z]+|[A-Z]{3,}(?: [A-Z]{3,})?)\b\s*/);
  const org = orgMatch ? orgMatch[1] : "";
  const note = orgMatch ? s.slice(orgMatch[0].length).trim() : s;
  let noteDe = "";
  for (const [re, fn] of CONTACT_NOTES_DE) {
    const m = note.match(re);
    if (m) {
      noteDe = fn(m);
      break;
    }
  }
  return { phones, emails, note, noteDe, org };
}

// ---------------------------------------------------------------------------
// Quelle 1 – statische Zonen
// ---------------------------------------------------------------------------

export function normalizeRomanianZone(f: any): RoFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  const p = f.properties || {};
  const zoneId = str(p.zone_id) || str(f.id);
  const { restriction, assumed } = roStatusRestriction(p.status);
  const lower = parseRoHeight(p.lower_lim);
  const upper = parseRoHeight(p.upper_lim);
  const contact = parseRoContact(p.contact);

  const lines: string[] = [`ROMATSA-Drohnenzone ${zoneId || "(ohne Kennung)"}${str(p.status) ? ` · Status ${str(p.status)}` : ""}`];
  lines.push(RESTRICTION_LINE_DE[restriction]);
  if (assumed) lines.push("Status in den ROMATSA-Daten unbekannt – vorsichtshalber als genehmigungspflichtig eingestuft.");
  lines.push(`${heightLineDe(heightText(lower, "lower"), heightText(upper, "upper"), "ROMATSA")}.`);
  if (lower && lower.m != null && lower.m > 0) {
    lines.push("Hinweis: Die Zone beginnt erst oberhalb des Bodens – darunter gelten die allgemeinen Regeln bzw. die Nachbarzone.");
  }
  const contactParts = [contact.org, ...contact.phones, ...contact.emails].filter(Boolean);
  if (contactParts.length > 0) lines.push(`Kontakt/Freigabe: ${contactParts.join(" · ")}`);
  if (contact.noteDe) lines.push(contact.noteDe);
  lines.push(sourceLineDe("ROMATSA – Zone restricționate UAV", RO_GEOZONE_ATTRIBUTION));
  const original = str(p.contact);
  const message = messageWithOriginal(lines, original);

  const props: Record<string, any> = {
    identifier: zoneId || undefined,
    zoneId: zoneId ? `RO-${zoneId}` : undefined,
    name: zoneId ? `Zona UAS ${zoneId}` : "Zona UAS",
    restriction,
    originalType: str(p.status) || null,
    restrictionAssumed: assumed || undefined,
    message,
    extendedProperties: localizedExtendedProperties(message, original || null, "en"),
    country: "ROU",
    source: RO_GEOZONE_SOURCE_LABEL,
    attribution: RO_GEOZONE_ATTRIBUTION,
    roLayer: "static",
    roContactPhones: contact.phones.length ? contact.phones : undefined,
    contactEmail: contact.emails[0],
  };
  applyHeights(props, lower, upper);
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: zoneId ? `RO-${zoneId}` : undefined, geometry: { type: g.type, coordinates: g.coordinates }, properties: props };
}

// ---------------------------------------------------------------------------
// Quelle 2 – NOTAM-UAV (temporär)
// ---------------------------------------------------------------------------

export interface RoNotamParts {
  q?: string;
  a?: string;
  b?: string;
  c?: string;
  d?: string;
  e?: string;
  f?: string;
  g?: string;
}

/** NOTAM-Text („(R5607/26 NOTAMN\rQ) …\rA) … B) … C) …\rD) …\rE) …\rF) GND G) FL065)“) → Felder. */
export function parseRoNotamText(mesaj: unknown): RoNotamParts {
  const text = str(mesaj).replace(/\r\n?/g, "\n");
  const out: RoNotamParts = {};
  const re = /(?:^|\s)([QABCDEFG])\)\s/g;
  const marks: { key: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Nur Kennbuchstaben in NOTAM-Reihenfolge übernehmen (E-Text kann „A) “ enthalten).
    const key = m[1];
    const last = marks[marks.length - 1]?.key;
    if (last && "QABCDEFG".indexOf(key) <= "QABCDEFG".indexOf(last)) continue;
    marks.push({ key, start: m.index + m[0].length, end: m.index });
  }
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].end : text.length;
    let v = text.slice(mk.start, end).trim();
    if (mk.key === "G" || (mk.key === "E" && i === marks.length - 1)) v = v.replace(/\)\s*$/, "").trim();
    (out as any)[mk.key.toLowerCase()] = v.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
  });
  return out;
}

/** Q-Zeile „…/000/065/…“ → Unter-/Obergrenze (Flugflächen). */
function qLineHeights(q: string | undefined): { lower: Height | null; upper: Height | null } {
  const m = str(q).match(/\/(\d{3})\/(\d{3})\//);
  if (!m) return { lower: null, upper: null };
  const lo = Number(m[1]);
  return { lower: lo === 0 ? parseHeight("GND") : parseHeight(`FL${m[1]}`), upper: parseHeight(`FL${m[2]}`) };
}

/** „DAILY 1730-0530“ → Zeitplan; null = nicht maschinenlesbar. */
export function parseRoNotamSchedule(d: string | undefined): any[] | null {
  const s = str(d).toUpperCase();
  const m = s.match(/^(?:DAILY|DLY|H24 DAILY)\s+(\d{2})(\d{2})\s*-\s*(\d{2})(\d{2})$/);
  if (!m) return null;
  return [{ day: ["ANY"], startTime: `${m[1]}:${m[2]}Z`, endTime: `${m[3]}:${m[4]}Z` }];
}

/** Wiederkehrende NOTAM-E-Zeilen → Deutsch (Rest bleibt im Originaltext). */
const NOTAM_E_DE: [RegExp, string][] = [
  [/TEMPORARY RESTRICTED AREA FOR IFR,? VFR AND UNMANNED ACFT FLT/i, "Temporäres Beschränkungsgebiet für IFR-, VFR- und unbemannte Flüge (Drohnen)."],
  [/TEMPORARY RESTRICTED AREA FOR UNMANNED ACFT FLT/i, "Temporäres Beschränkungsgebiet für unbemannte Flüge (Drohnen)."],
  [/TEMPORARY SEGREGATED AREA/i, "Temporär abgetrenntes Gebiet (TSA)."],
  [/UNMANNED ACFT (?:FLT|FLIGHTS?) (?:ARE )?PROHIBITED/i, "Flüge unbemannter Luftfahrzeuge verboten."],
  [/EXCEPT STATE, SPECIAL, HUMANITARIAN, SAR, SMURD,? AND EMERG FLT/i, "Ausgenommen Staats-, Sonder-, humanitäre, SAR-, SMURD- und Notfallflüge."],
  [/EXPECT RADAR VECTORING/i, "Radarführung ist zu erwarten."],
];

export function normalizeRomanianNotam(f: any, now: Date = new Date()): RoFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  const p = f.properties || {};
  const serie = str(p.serie) || str(f.id);
  const startTs = Date.parse(str(p.dfrom));
  const endTs = Date.parse(str(p.dto));
  if (Number.isFinite(endTs) && endTs < now.getTime()) return null; // abgelaufen
  const parts = parseRoNotamText(p.mesaj);
  const q = qLineHeights(parts.q);
  const lower = parseRoHeight(parts.f) ?? q.lower;
  const upper = parseRoHeight(parts.g) ?? q.upper;
  const restriction = roNotamRestriction(p.tip);
  const schedule = parseRoNotamSchedule(parts.d);

  const fmt = (ts: number) => (Number.isFinite(ts) ? `${new Date(ts).toISOString().slice(0, 16).replace("T", " ")} UTC` : "?");
  const lines: string[] = [`NOTAM ${serie} (ROMATSA, Drohnen-relevant) · Typ ${str(p.tip) || "?"}`];
  lines.push(RESTRICTION_LINE_DE[restriction]);
  lines.push(`Gültig: ${fmt(startTs)} bis ${fmt(endTs)}`);
  if (parts.d) lines.push(schedule ? `Aktiv: täglich ${schedule[0].startTime.replace("Z", "")}–${schedule[0].endTime.replace("Z", "")} UTC` : `Aktivzeiten laut NOTAM: ${parts.d} (im ganzen Gültigkeitszeitraum als aktiv gewertet)`);
  lines.push(`${heightLineDe(heightText(lower, "lower"), heightText(upper, "upper"), "NOTAM")}.`);
  const eDe = NOTAM_E_DE.filter(([re]) => re.test(parts.e ?? "")).map(([, de]) => de);
  if (eDe.length > 0) lines.push(...eDe);
  lines.push(sourceLineDe("ROMATSA – NOTAM für UAS", RO_GEOZONE_ATTRIBUTION, "den vollständigen NOTAM-Text"));
  const original = cleanText(str(p.mesaj).replace(/\r\n?/g, "\n"));
  const message = messageWithOriginal(lines, original);

  const applicability: Record<string, any> = { permanent: "NO" };
  if (Number.isFinite(startTs)) applicability.startDateTime = new Date(startTs).toISOString();
  if (Number.isFinite(endTs)) applicability.endDateTime = new Date(endTs).toISOString();
  if (schedule) applicability.schedule = schedule;

  const props: Record<string, any> = {
    identifier: serie,
    zoneId: `RO-NOTAM-${serie}`,
    name: `NOTAM ${serie}`,
    restriction,
    originalType: str(p.tip) || null,
    message,
    extendedProperties: localizedExtendedProperties(message, original || null, "en"),
    country: "ROU",
    source: RO_GEOZONE_SOURCE_LABEL,
    attribution: RO_GEOZONE_ATTRIBUTION,
    roLayer: "notam",
    isNotam: true,
    _notamEligible: true,
    applicability: [applicability],
  };
  applyHeights(props, lower, upper);
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: `RO-NOTAM-${serie}`, geometry: { type: g.type, coordinates: g.coordinates }, properties: props };
}

/** Rohe FeatureCollection/Array → Feature-Liste. */
function featuresOf(body: any): any[] {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.features) ? body.features : [];
}

/**
 * Beide Quellen → App-Features. Statische Zonen dedupliziert über zone_id,
 * NOTAMs über serie (gleiche Kennung + andere Geometrie → MultiPolygon).
 */
export function normalizeRomanianGeozones(
  staticBody: unknown,
  notamBody: unknown,
  now: Date = new Date(),
): { features: RoFeature[]; staticCount: number; notamCount: number } {
  const out: RoFeature[] = [];
  const byKey = new Map<string, RoFeature>();
  const add = (f: RoFeature | null, key: string) => {
    if (!f) return false;
    const prev = byKey.get(key);
    if (prev) {
      const polys = (x: any) => (x.type === "Polygon" ? [x.coordinates] : x.coordinates);
      const sig = JSON.stringify(f.geometry.coordinates);
      if (JSON.stringify(prev.geometry.coordinates) !== sig) {
        prev.geometry = { type: "MultiPolygon", coordinates: [...polys(prev.geometry), ...polys(f.geometry)] };
      }
      return false;
    }
    byKey.set(key, f);
    out.push(f);
    return true;
  };
  let staticCount = 0;
  let notamCount = 0;
  featuresOf(staticBody).forEach((raw, i) => {
    const f = normalizeRomanianZone(raw);
    if (add(f, `S|${f?.properties.identifier ?? i}`)) staticCount++;
  });
  featuresOf(notamBody).forEach((raw, i) => {
    const f = normalizeRomanianNotam(raw, now);
    if (add(f, `N|${f?.properties.identifier ?? i}`)) notamCount++;
  });
  return { features: out, staticCount, notamCount };
}
