// Schwedische Geozonen (LFV Drönarkartan / Transportstyrelsen) – Normalisierung
// in die ED-269-nahe Feature-Form, die client/lib/ed269.ts
// (parseEd269ToGeozoneInfo) liest: restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, applicability, zoneAuthority …
//
// Zwei Quellen (siehe docs/geozonen-weitere-laender.md §2):
//  1. ED-318-Datei mit den geografischen UAS-Zonen von Transportstyrelsen
//     (mehrsprachige Arrays, Höhe in geometry.layer, Kreise als Point+extent).
//  2. LFV-WFS (daim.lfv.se) mit Luftraum: CTR/TIZ/ATZ, 5-km-Bahnzonen (RWY5K),
//     1-km-Heliportzonen (HKP1K), R-/D-Gebiete, AIP SUP und NOTAM.
//
// Lizenz: CC BY 4.0 – Attribution „LFV Drönarkartan / Transportstyrelsen“.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { circlePolygon, simplifyGeometry } from "./dutchGeozones";
import { normalizeEd269Restriction } from "./ed269Restriction";

export const SE_GEOZONE_SOURCE_LABEL = "LFV / Transportstyrelsen (CC BY 4.0)";
export const SE_GEOZONE_ATTRIBUTION = "Quelle: LFV Drönarkartan / Transportstyrelsen, CC BY 4.0";

export type SeAltitudeReference = "AGL" | "MSL";

export type SeFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
};

/** Quell-Layer-Kürzel (wird als `sourceLayer` an jedes Feature gehängt). */
export type SeLayer = "ED318" | "CTR" | "TIZ" | "ATZ" | "RWY5K" | "HKP1K" | "RSTA" | "DNGA" | "SUP" | "NOTAM";

/** WFS-typeNames der Drönarkartan-Layer (GetCapabilities 2026-11-15; NOTAM ist
 * dort nicht gelistet, muss aber direkt adressiert werden – LFV-API-Seite). */
export const SE_WFS_LAYERS: { layer: Exclude<SeLayer, "ED318">; typeName: string }[] = [
  { layer: "CTR", typeName: "mais:CTR" },
  { layer: "TIZ", typeName: "mais:TIZ" },
  { layer: "ATZ", typeName: "mais:ATZ" },
  { layer: "RWY5K", typeName: "DAIM_TOPO:RWY5K" },
  { layer: "HKP1K", typeName: "DAIM_TOPO:HKP1K" },
  { layer: "RSTA", typeName: "mais:RSTA" },
  { layer: "DNGA", typeName: "mais:DNGA" },
  { layer: "SUP", typeName: "DAIM_TOPO:SUP" },
  { layer: "NOTAM", typeName: "dynais:NOTAM" },
];

// Die Drönarkartan zeigt nur Gebiete mit Untergrenze ≤ 500 ft (bzw. GND).
// Höher beginnende Gebiete sind für Drohnen (max. 120 m) irrelevant und werden
// verworfen – spart Speicher und vermeidet Fehlalarme.
export const SE_MAX_RELEVANT_LOWER_M = 500 * 0.3048;

const FT = 0.3048;

// ---------------------------------------------------------------------------
// Hilfsfunktionen: Text, Sprache, Zeit
// ---------------------------------------------------------------------------

/** ED-318-Sprach-Array [{text, lang}] → bevorzugt Englisch, dann Schwedisch. */
export function pickLangText(value: unknown, prefs: string[] = ["en", "sv"]): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) {
    const t = (value as any)?.text;
    return typeof t === "string" ? t.trim() : "";
  }
  for (const pref of prefs) {
    const hit = value.find((v: any) => String(v?.lang ?? "").toLowerCase().startsWith(pref));
    if (hit && typeof hit.text === "string" && hit.text.trim()) return hit.text.trim();
  }
  const first = value.find((v: any) => typeof v?.text === "string" && v.text.trim());
  return first ? String(first.text).trim() : "";
}

function cleanText(s: unknown): string {
  return String(s ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * LFV-Kommentare (COMMENT_2) enthalten erst den schwedischen, dann den
 * englischen Text, durch Leerzeilen getrennt. Bei gerader Absatzzahl wird die
 * zweite Hälfte als Englisch genommen, sonst der ganze Text (Annahme, an den
 * Live-Daten geprüft).
 */
export function englishPartOfSvEn(text: unknown): string {
  const t = cleanText(text);
  if (!t) return "";
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2 && paras.length % 2 === 0) return paras.slice(paras.length / 2).join("\n\n");
  return t;
}

/** „SE: … EN: …“ (ED-318 extendedProperties.text) → englischer Teil. */
function englishPartOfSeEnPrefixed(text: unknown): string {
  const t = cleanText(text);
  const m = t.match(/\bEN:\s*([\s\S]+)$/);
  return m ? m[1].trim() : t;
}

function isoOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const ts = new Date(String(value)).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

/** ISO-8601-Dauer „P14DT00H00M“ → deutscher Text („14 Tage“, „24 Std.“). */
export function isoDurationText(value: unknown): string {
  const m = String(value ?? "").match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
  if (!m) return "";
  const d = Number(m[1] || 0);
  const h = Number(m[2] || 0);
  const parts: string[] = [];
  if (d > 0) parts.push(d === 1 ? "1 Tag" : `${d} Tage`);
  if (h > 0) parts.push(`${h} Std.`);
  return parts.join(" ");
}

/** Text verbietet den Flug (Englisch/Schwedisch), aber nicht „not prohibited“. */
export function textSaysProhibited(text: unknown): boolean {
  const t = String(text ?? "").toUpperCase();
  if (/\bNOT\s+PROHIBITED\b|\bINTE\s+FÖRBJUD/.test(t)) return false;
  return /\bPROHIBITED\b|FÖRBJUDEN|FÖRBJUDET/.test(t);
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

export type SeAltitude = {
  /** Meter; undefined = unbegrenzt (UNL) bzw. nicht lesbar. */
  meters: number | undefined;
  reference: SeAltitudeReference;
  unlimited?: boolean;
  /** Originaltext für die Anzeige. */
  text: string;
};

/**
 * Wandelt die LFV-Höhenangaben (Strings) in Meter um.
 *
 * Annahmen (LFV-API-Seite „Drönarkartan“ bzw. ICAO-Konvention):
 *  - „GND“/„SFC“ → 0 m AGL.
 *  - „UNL“ → unbegrenzt (meters = undefined).
 *  - „FL 85“/„FL85“ → 8500 ft Druckhöhe; näherungsweise als MSL geführt
 *    (die App kennt nur AGL/MSL; FL wird dort ebenfalls als MSL behandelt).
 *  - Zahl ohne Einheit („2500“) → ft AMSL (laut LFV-Doku).
 *  - Einheit/Referenz kann im String („1200FT AMSL“, „260FT AGL“) oder separat
 *    stehen (SUP: LOW_UOM „ft SFC“ → AGL, UP_UOM „ft AMSL“).
 *  - Einheit „M“ wird unterstützt, Referenz „SFC“/„GND“/„AGL“ → AGL.
 */
export function parseSwedishAltitude(raw: unknown, uomHint?: unknown): SeAltitude | null {
  if (raw == null) return null;
  const hint = String(uomHint ?? "").trim();
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  // Anzeige-Text: Zahl ohne Einheit bekommt die angenommene Einheit „ft AMSL“.
  const text = /^\d/.test(s)
    ? hint
      ? `${String(raw).trim()} ${hint}`
      : /^\d+(?:[.,]\d+)?$/.test(s)
        ? `${String(raw).trim()} ft AMSL`
        : String(raw).trim()
    : String(raw).trim();
  if (s === "GND" || s === "SFC" || (s === "0" && !hint)) return { meters: 0, reference: "AGL", text };
  if (s === "UNL" || s === "UNLTD" || s === "UNLIMITED") {
    return { meters: undefined, reference: "MSL", unlimited: true, text };
  }
  const fl = s.match(/^FL ?(\d{1,3})$/);
  if (fl) return { meters: round1(Number(fl[1]) * 100 * FT), reference: "MSL", text };
  const m = s.match(/^(\d+(?:[.,]\d+)?) ?(FT|F|M)? ?(AMSL|MSL|AGL|SFC|GND)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const h = hint.toUpperCase();
  const unit = m[2] || (/\bM\b/.test(h) ? "M" : "FT");
  const refRaw = m[3] || (/\b(AGL|SFC|GND)\b/.test(h) ? "AGL" : "AMSL");
  const reference: SeAltitudeReference = refRaw === "AGL" || refRaw === "SFC" || refRaw === "GND" ? "AGL" : "MSL";
  const meters = unit === "M" ? n : n * FT;
  return { meters: round1(meters), reference, text };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** ED-318 geometry.layer → Unter-/Obergrenze (uom m/ft/FL; Referenz AGL/AMSL/WGS84/STD). */
export function ed318LayerAltitudes(layer: any): { lower: SeAltitude | null; upper: SeAltitude | null } {
  if (!layer || typeof layer !== "object") return { lower: null, upper: null };
  const uom = String(layer.uom ?? layer.uomDimensions ?? "m").toUpperCase();
  const conv = (value: unknown, refRaw: unknown): SeAltitude | null => {
    if (value == null || value === "") return null;
    const r = String(refRaw ?? "").toUpperCase();
    const reference: SeAltitudeReference = r === "AGL" || r === "SFC" ? "AGL" : r ? "MSL" : "AGL";
    if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value.trim())) {
      const parsed = parseSwedishAltitude(value);
      return parsed ? { ...parsed, reference: parsed.unlimited ? "MSL" : reference } : null;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n === 0 && reference === "AGL") return { meters: 0, reference, text: "GND" };
    const meters = uom === "FT" ? n * FT : uom === "FL" ? n * 100 * FT : n;
    const unitText = uom === "FL" ? `FL ${n}` : `${n} ${uom === "FT" ? "ft" : "m"}`;
    return {
      meters: round1(meters),
      reference,
      text: uom === "FL" ? unitText : `${unitText} ${r === "AMSL" || r === "WGS84" ? "AMSL" : r || "AGL"}`,
    };
  };
  return { lower: conv(layer.lower, layer.lowerReference), upper: conv(layer.upper, layer.upperReference) };
}

function applyAltitudes(out: Record<string, any>, lower: SeAltitude | null, upper: SeAltitude | null): void {
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
  const lt = lower?.text || "GND";
  const ut = upper?.text || "UNL";
  out.altitudeText = `${lt} – ${ut}`;
}

/** Untergrenze für Drohnen erreichbar (≤ 500 ft) bzw. unbekannt → behalten. */
export function seLowerIsRelevant(lower: SeAltitude | null): boolean {
  if (!lower || lower.meters == null) return lower?.unlimited ? false : true;
  return lower.meters <= SE_MAX_RELEVANT_LOWER_M + 0.5;
}

// ---------------------------------------------------------------------------
// ED-318 (geografische UAS-Zonen, Transportstyrelsen)
// ---------------------------------------------------------------------------

const ED318_REASON_DE: Record<string, string> = {
  AIR_TRAFFIC: "Luftverkehr",
  SENSITIVE: "Sensibles Objekt",
  PRIVACY: "Privatsphäre",
  POPULATION: "Bevölkerung",
  NATURE: "Naturschutz",
  NOISE: "Lärmschutz",
  FOREIGN_TERRITORY: "Fremdes Hoheitsgebiet",
  EMERGENCY: "Notfall",
};

const OTHER_REASON_DE: Record<string, string> = {
  SECURITY: "Sicherheit",
  "UAS OPERATIONS": "UAS-Betrieb",
  "TEST SITE": "Testgelände",
  "FLIGHT TESTING": "Flugerprobung",
  PRIVACY: "Privatsphäre",
};

function ed318ReasonText(p: Record<string, any>): string {
  const reasons: string[] = Array.isArray(p.reason) ? p.reason.map(String) : p.reason ? [String(p.reason)] : [];
  const other = pickLangText(p.otherReasonInfo);
  const out: string[] = [];
  for (const r of reasons) {
    const key = r.toUpperCase();
    if (key === "OTHER") {
      if (other) out.push(OTHER_REASON_DE[other.toUpperCase()] ?? other);
    } else out.push(ED318_REASON_DE[key] ?? r);
  }
  if (out.length === 0 && other) out.push(OTHER_REASON_DE[other.toUpperCase()] ?? other);
  return [...new Set(out)].join(", ");
}

type FlatAuthority = {
  name: string;
  purpose?: string;
  intervalBefore?: string;
  siteURL?: string;
  phone?: string;
  email?: string;
};

function flattenAuthorities(value: unknown): FlatAuthority[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const out: FlatAuthority[] = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const name = pickLangText((a as any).name) || pickLangText((a as any).contactName);
    if (!name) continue;
    const flat: FlatAuthority = { name };
    const purpose = String((a as any).purpose ?? "").toUpperCase();
    if (purpose) flat.purpose = purpose;
    if ((a as any).intervalBefore) flat.intervalBefore = String((a as any).intervalBefore);
    const site = pickLangText((a as any).siteURL);
    if (/^https?:\/\//i.test(site)) flat.siteURL = site;
    const phone = pickLangText((a as any).phone);
    if (phone) flat.phone = phone;
    const email = pickLangText((a as any).email);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) flat.email = email;
    out.push(flat);
  }
  return out;
}

/** Deutsche Kurzfassung der Auflagen aus Typ, Bedingungen und Behörden. */
function ed318GermanSummary(restriction: string, p: Record<string, any>, authorities: FlatAuthority[]): string {
  const lines: string[] = [];
  const authz = authorities.filter((a) => a.purpose === "AUTHORIZATION");
  const notif = authorities.filter((a) => a.purpose === "NOTIFICATION");
  if (restriction === "PROHIBITED") lines.push("Flugverbot für UAS.");
  else if (restriction === "REQ_AUTHORISATION") lines.push("Flug nur mit Genehmigung.");
  else if (restriction === "CONDITIONAL") lines.push("Flug unter Auflagen zulässig – Bedingungen im Originaltext beachten.");
  for (const a of authz) {
    const lead = isoDurationText(a.intervalBefore);
    lines.push(`Genehmigung bei ${a.name}${lead ? ` (mind. ${lead} vorher beantragen)` : ""}.`);
  }
  for (const a of notif) {
    const lead = isoDurationText(a.intervalBefore);
    lines.push(`Vorab-Meldung/Rücksprache mit ${a.name}${lead ? ` (${lead} vorher)` : ""}.`);
  }
  if (String(p.restrictionConditions ?? "").toUpperCase() === "NO_PHOTOGRAPH") {
    lines.push("Fotografieren/Filmen verboten.");
  }
  return lines.join(" ");
}

/**
 * Transportstyrelsen liefert je Wochentag einen eigenen Schedule-Eintrag
 * ({day:["MON"], startTime, endTime}). Einträge mit gleicher Uhrzeit werden zu
 * einem Eintrag mit mehreren Tagen zusammengefasst (Anzeige „Mo–Fr“), die
 * Aktivitätsprüfung bleibt gleich.
 */
function mergeScheduleDays(schedule: any[]): any[] {
  const out: any[] = [];
  const byTime = new Map<string, any>();
  for (const s of schedule) {
    if (!s || typeof s !== "object" || !Array.isArray(s.day)) {
      out.push(s);
      continue;
    }
    const { day, ...rest } = s;
    const key = JSON.stringify(rest);
    const hit = byTime.get(key);
    if (hit) {
      for (const d of day) if (!hit.day.includes(d)) hit.day.push(d);
    } else {
      const entry = { ...rest, day: [...day] };
      byTime.set(key, entry);
      out.push(entry);
    }
  }
  return out;
}

/**
 * ED-318 limitedApplicability → ED-269 applicability. Fenster, die vor `now`
 * enden, entfallen. Ein Fenster nur mit (vergangenem) Start und ohne Ende/
 * Zeitplan ist faktisch dauerhaft → keine applicability (dauerhaft aktiv).
 * Rückgabe null = Zone komplett abgelaufen.
 */
export function ed318Applicability(value: unknown, now: Date = new Date()): any[] | undefined | null {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  if (list.length === 0) return undefined;
  const nowTs = now.getTime();
  const out: any[] = [];
  let permanent = false;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const start = isoOrNull((e as any).startDateTime);
    const end = isoOrNull((e as any).endDateTime);
    const schedule = Array.isArray((e as any).schedule) ? (e as any).schedule : [];
    if (end && new Date(end).getTime() < nowTs) continue;
    if (!end && schedule.length === 0 && (!start || new Date(start).getTime() <= nowTs)) {
      permanent = true;
      continue;
    }
    const entry: Record<string, any> = { permanent: "NO" };
    if (start) entry.startDateTime = start;
    if (end) entry.endDateTime = end;
    if (schedule.length > 0) entry.schedule = mergeScheduleDays(schedule);
    out.push(entry);
  }
  if (permanent) return undefined;
  return out.length > 0 ? out : null;
}

/** Ein ED-318-Feature → App-Feature (oder null, wenn unbrauchbar/abgelaufen). */
export function normalizeEd318Feature(f: any, now: Date = new Date()): SeFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const p: Record<string, any> = f.properties || {};
  const g = f.geometry;

  let geometry: { type: string; coordinates: any } | null = null;
  if (g.type === "Point" && Array.isArray(g.coordinates)) {
    const radius = Number(g.extent?.radius ?? g.radius);
    const lon = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    if (Number.isFinite(radius) && radius > 0 && Number.isFinite(lon) && Number.isFinite(lat)) {
      // Feinere Unterteilung für große Kreise (≥ 1,5 km), sonst 48 Segmente.
      geometry = { type: "Polygon", coordinates: circlePolygon(lon, lat, radius, radius >= 1500 ? 64 : 48) };
    }
  } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
    geometry = { type: g.type, coordinates: g.coordinates };
  }
  if (!geometry) return null;

  const applicability = ed318Applicability(p.limitedApplicability, now);
  if (applicability === null) return null;

  const restriction = normalizeEd269Restriction(String(p.type ?? p.restriction ?? ""));
  const authorities = flattenAuthorities(p.zoneAuthority);
  const nameEn = pickLangText(p.name, ["en", "sv"]);
  const nameSv = pickLangText(p.name, ["sv", "en"]);
  const identifier = String(p.identifier ?? "").trim();

  const msgEn = cleanText(pickLangText(p.message, ["en", "sv"]));
  const ext = p.extendedProperties?.text ? englishPartOfSeEnPrefixed(p.extendedProperties.text) : "";
  const summary = ed318GermanSummary(restriction, p, authorities);
  const message = [summary, msgEn, ext].filter(Boolean).join("\n\n");

  const out: Record<string, any> = {
    identifier,
    zoneId: identifier ? `SE-${identifier}` : undefined,
    name: nameEn || identifier || "UAS-Zone",
    restriction,
    originalType: p.type ?? null,
    message,
    reason: ed318ReasonText(p) || undefined,
    source: SE_GEOZONE_SOURCE_LABEL,
    sourceLayer: "ED318" as SeLayer,
  };
  if (nameSv && nameSv !== out.name) out.nameLocal = nameSv;
  if (p.restrictionConditions) out.restrictionConditions = String(p.restrictionConditions);
  if (applicability) out.applicability = applicability;

  const { lower, upper } = ed318LayerAltitudes(g.layer);
  applyAltitudes(out, lower, upper);

  if (authorities.length > 0) {
    // ed269SourceInfo liest name/siteURL als String; E-Mail separat als
    // mailto-Link (contactEmail), damit kein nackter E-Mail-„Link“ entsteht.
    out.zoneAuthority = authorities.map(({ email: _e, ...rest }) => rest);
    const mail = (authorities.find((a) => a.purpose === "AUTHORIZATION" && a.email) ?? authorities.find((a) => a.email))?.email;
    if (mail) out.contactEmail = mail;
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { type: "Feature", geometry, properties: out };
}

/** ED-318-FeatureCollection → App-Features. */
export function normalizeEd318Collection(body: any, now: Date = new Date()): SeFeature[] {
  const raw = Array.isArray(body?.features) ? body.features : Array.isArray(body) ? body : [];
  const out: SeFeature[] = [];
  for (const f of raw) {
    const n = normalizeEd318Feature(f, now);
    if (n) out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// WFS-Layer (LFV Luftraum)
// ---------------------------------------------------------------------------

// Militärische Kontrollzonen laut LFV-API-Seite (nur dort dokumentiert, kein
// WFS-Attribut). „Sector a/b“ mit POSITIONINDICATOR ESSL gehören zur SAAB CTR;
// „Sector a/b“ mit „ES S“ gehören zu Sälen (zivil).
const MILITARY_CTR_NAMES = new Set([
  "SAAB CTR",
  "KARLSBORG CTR",
  "MALMEN CTR",
  "KALLAX CTR",
  "RONNEBY CTR",
  "VIDSEL CTR",
  "VISBY CTR",
]);

const CTR_SECTOR_PARENT: Record<string, string> = {
  ESSL: "SAAB CTR",
  "ES S": "SÄLEN CTR",
  ESSA: "ARLANDA CTR",
};

export function isSwedishMilitaryCtr(p: Record<string, any>): boolean {
  const name = String(p?.NAMEOFAREA ?? "").trim().toUpperCase();
  if (MILITARY_CTR_NAMES.has(name)) return true;
  return /^SECTOR\b/.test(name) && String(p?.POSITIONINDICATOR ?? "").trim().toUpperCase() === "ESSL";
}

function ctrDisplayName(p: Record<string, any>): string {
  const name = String(p.NAMEOFAREA ?? "").trim();
  if (/^sector\b/i.test(name)) {
    const parent = CTR_SECTOR_PARENT[String(p.POSITIONINDICATOR ?? "").trim().toUpperCase()];
    return parent ? `${parent} ${name}` : name;
  }
  return name || String(p.LOCATION ?? "").trim() || "Kontrollzone";
}

// Einstufung der Luftraum-Layer. Grundlage: Transportstyrelsen „Flyga drönare i
// luftrummet“ (abgerufen 2026-11-15):
//  - In der offenen Kategorie darf man ohne Freigabe fliegen, wenn die Drohne
//    langsam ist (< 25 m/s), mind. 5 km von der Bahn entfernt bleibt und
//    < 50 m AGL (militärische CTR: < 10 m AGL) bzw. < 50 m in FIZ/TIZ fliegt.
//    → CTR/TIZ/ATZ = CONDITIONAL (Höhengrenze), nicht pauschal Genehmigung.
//  - Innerhalb der 5-km-Bahnzone (RWY5K) gilt diese Ausnahme nicht → Freigabe
//    der Flugverkehrsleitung nötig → REQ_AUTHORISATION.
//  - 1 km um Heliports (HKP1K): „kontakta flygplatsen för samråd“ (Rücksprache,
//    keine formale Genehmigung) → CONDITIONAL. FACHLICH PRÜFEN.
//  - ATZ wie TIZ behandelt (auf der Seite nicht separat genannt). FACHLICH PRÜFEN.
export const SE_CTR_RESTRICTION = "CONDITIONAL";
export const SE_TIZ_RESTRICTION = "CONDITIONAL";
export const SE_RWY5K_RESTRICTION = "REQ_AUTHORISATION";
export const SE_HKP1K_RESTRICTION = "CONDITIONAL";

/** Restriction für ein WFS-Feature eines Layers (Properties im LFV-Schema). */
export function seWfsRestriction(layer: SeLayer, p: Record<string, any>): string {
  switch (layer) {
    case "CTR":
      return SE_CTR_RESTRICTION;
    case "TIZ":
    case "ATZ":
      return SE_TIZ_RESTRICTION;
    case "RWY5K":
      return SE_RWY5K_RESTRICTION;
    case "HKP1K":
      return SE_HKP1K_RESTRICTION;
    case "RSTA":
      // R-Gebiet: i. d. R. Sondergenehmigung von Transportstyrelsen; ausdrücklich
      // verbotene (Text „förbjuden“/„prohibited“) als PROHIBITED.
      return textSaysProhibited(p.COMMENT_2) ? "PROHIBITED" : "RESTRICTED";
    case "DNGA":
      return "CONDITIONAL";
    case "SUP": {
      // Temporäre Gebiete: ESR… = Restricted, ESD… = Danger (→ CONDITIONAL).
      const desig = String(p.DESIG ?? p.ID ?? "").toUpperCase();
      if (textSaysProhibited(`${p.COM_EN ?? ""} ${p.COM_SE ?? ""}`)) return "PROHIBITED";
      if (/^ESD/.test(desig)) return "CONDITIONAL";
      return "RESTRICTED";
    }
    case "NOTAM": {
      const code = String(p.CODE23 ?? "").toUpperCase();
      if (textSaysProhibited(p.ITEM_E)) return "PROHIBITED";
      // Gefahrengebiet (RD…) und Warnungen (W…) → Auflagen; sonst Genehmigung.
      if (/^RD/.test(code) || /^W/.test(code)) return "CONDITIONAL";
      return "REQ_AUTHORISATION";
    }
    default:
      return "CONDITIONAL";
  }
}

/** Drönarkartan-Filter für NOTAM: nur Q-Code R…/W…, keine Trigger (TT),
 * keine Aufhebungen (TYPE C, CODE45 AW = „completely withdrawn“). */
export function seNotamIsAirspaceRestriction(p: Record<string, any>): boolean {
  const c23 = String(p?.CODE23 ?? "").toUpperCase();
  const c45 = String(p?.CODE45 ?? "").toUpperCase();
  if (!/^[RW]/.test(c23)) return false;
  if (c45 === "TT" || c45 === "AW") return false;
  if (String(p?.TYPE ?? "").toUpperCase() === "C") return false;
  return true;
}

function notamQLineAltitude(value: unknown, isUpper: boolean): SeAltitude | null {
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return null;
  if (!isUpper && n === 0) return { meters: 0, reference: "AGL", text: "GND" };
  if (isUpper && n >= 999) return { meters: undefined, reference: "MSL", unlimited: true, text: "UNL" };
  return { meters: round1(n * 100 * FT), reference: "MSL", text: `FL ${n}` };
}

function wfsAltitudes(layer: SeLayer, p: Record<string, any>): { lower: SeAltitude | null; upper: SeAltitude | null } {
  if (layer === "SUP") {
    return { lower: parseSwedishAltitude(p.LOWER, p.LOW_UOM), upper: parseSwedishAltitude(p.UPPER, p.UP_UOM) };
  }
  if (layer === "NOTAM") {
    // ITEM_F/ITEM_G sind die genauen Grenzen; sonst Q-Zeile (Flugflächen).
    return {
      lower: parseSwedishAltitude(p.ITEM_F) ?? notamQLineAltitude(p.LOWER, false),
      upper: parseSwedishAltitude(p.ITEM_G) ?? notamQLineAltitude(p.UPPER, true),
    };
  }
  if (layer === "RWY5K" || layer === "HKP1K") {
    // Ohne Höhenattribut: vom Boden an, nach oben offen (gilt für die gesamte
    // Drohnen-Flughöhe).
    return { lower: { meters: 0, reference: "AGL", text: "GND" }, upper: null };
  }
  return { lower: parseSwedishAltitude(p.LOWER), upper: parseSwedishAltitude(p.UPPER) };
}

const LAYER_LABEL_DE: Record<SeLayer, string> = {
  ED318: "Geografische UAS-Zone",
  CTR: "Kontrollzone (CTR)",
  TIZ: "Verkehrsinformationszone (TIZ)",
  ATZ: "Flugplatzverkehrszone (ATZ)",
  RWY5K: "5-km-Zone um Start-/Landebahn",
  HKP1K: "1-km-Zone um Hubschrauberlandeplatz",
  RSTA: "Flugbeschränkungsgebiet (R)",
  DNGA: "Gefahrengebiet (D)",
  SUP: "Temporäres Gebiet (AIP SUP)",
  NOTAM: "NOTAM-Gebiet",
};

function layerGermanSummary(layer: SeLayer, p: Record<string, any>, restriction: string): string {
  switch (layer) {
    case "CTR": {
      const limit = isSwedishMilitaryCtr(p) ? 10 : 50;
      return `Offene Kategorie ohne Freigabe nur unter ${limit} m über Grund${limit === 10 ? " (militärische Kontrollzone)" : ""}, mit langsamer Drohne (< 25 m/s) und mindestens 5 km Abstand zur Start-/Landebahn. Sonst Freigabe der Flugverkehrskontrolle erforderlich.`;
    }
    case "TIZ":
    case "ATZ":
      return "Ohne Freigabe nur unter 50 m über Grund, mit langsamer Drohne (< 25 m/s) und mindestens 5 km Abstand zur Start-/Landebahn; Flugfunk für Drohnen nicht erforderlich.";
    case "RWY5K":
      return "Innerhalb von 5 km um die Start-/Landebahn ist der Drohnenflug nur mit Freigabe der Flugverkehrsleitung zulässig.";
    case "HKP1K":
      return "Häufig Risikobereich: vor einem Flug innerhalb von 1 km den Hubschrauberlandeplatz kontaktieren (Rücksprache). Telefonnummern: AIP GEN 3.3.";
    case "RSTA":
      return restriction === "PROHIBITED"
        ? "Drohnenflug verboten; Ausnahmen nur mit Sondergenehmigung von Transportstyrelsen."
        : "In der Regel Sondergenehmigung von Transportstyrelsen (oder der genannten Behörde) erforderlich.";
    case "DNGA":
      return "Gefahrengebiet: Risiko selbst bewerten, vorher Kontakt mit der zuständigen Stelle empfohlen.";
    case "SUP":
      return restriction === "CONDITIONAL"
        ? "Temporäres Gefahrengebiet laut AIP SUP: nur während der Aktivierungszeiten; Risiko selbst bewerten. Zeiten in UTC (Ortszeit in Klammern)."
        : "Temporäres Beschränkungsgebiet laut AIP SUP: während der Aktivierungszeiten nur mit Genehmigung. Zeiten in UTC (Ortszeit in Klammern).";
    case "NOTAM":
      return restriction === "PROHIBITED"
        ? "Laut NOTAM Flugverbot im Gebiet. Position oft nur indikativ – NOTAM-Text beachten."
        : restriction === "CONDITIONAL"
          ? "Warnung/Gefahrengebiet laut NOTAM – Position oft nur indikativ, NOTAM-Text beachten."
          : "Temporäre Luftraumbeschränkung laut NOTAM – Flug nur mit Genehmigung. Position oft nur indikativ, NOTAM-Text beachten.";
    default:
      return "";
  }
}

function wfsName(layer: SeLayer, p: Record<string, any>): string {
  switch (layer) {
    case "CTR":
      return ctrDisplayName(p);
    case "TIZ":
    case "ATZ":
      return String(p.NAMEOFAREA ?? p.LOCATION ?? layer).trim();
    case "RWY5K": {
      const ad = String(p.POSITIONIN ?? "").trim();
      const area = String(p.NAMEOFAREA ?? "").trim();
      return `5 km ${ad || area}${ad && area ? ` (${area})` : ""}`.trim();
    }
    case "HKP1K": {
      const loc = String(p.LOCATION ?? p.NAMEOFPOIN ?? "").trim();
      const ad = String(p.POSITIONIN ?? "").trim();
      return `Heliport 1 km ${loc || ad}${loc && ad ? ` (${ad})` : ""}`.trim();
    }
    case "RSTA":
    case "DNGA":
      return String(p.LOCATION || p.NAMEOFAREA || layer).trim();
    case "SUP": {
      const desig = String(p.DESIG ?? "").trim();
      const name = String(p.NAME ?? "").trim();
      return [desig, name].filter(Boolean).join(" ") || "AIP SUP";
    }
    case "NOTAM":
      return `NOTAM ${seNotamId(p)}`.trim();
    default:
      return layer;
  }
}

export function seNotamId(p: Record<string, any>): string {
  const series = String(p?.SERIES ?? "").trim();
  const no = p?.NO != null ? String(p.NO).padStart(4, "0") : "";
  const year = p?.YEAR != null ? String(p.YEAR).padStart(2, "0") : "";
  return no ? `${series}${no}/${year}` : String(p?.ID ?? "").trim();
}

// Stabile Zonen-ID: die GeoServer-Feature-IDs der DAIM_TOPO-Layer sind
// Zeilennummern (z. B. „SUP.1“) und daher nicht dauerhaft – dort fachliche
// Schlüssel verwenden.
function wfsZoneId(layer: SeLayer, p: Record<string, any>, fid: unknown, identifier: string): string {
  let key: string;
  if (layer === "SUP") key = String(p.ID ?? identifier);
  else if (layer === "NOTAM" || layer === "RWY5K" || layer === "HKP1K") key = identifier;
  else key = String(fid ?? identifier).replace(/^[A-Z0-9_]+\./i, "");
  return `SE-${layer}-${key || identifier}`;
}

function wfsIdentifier(layer: SeLayer, p: Record<string, any>, fid: unknown): string {
  switch (layer) {
    case "SUP":
      return String(p.DESIG ?? p.ID ?? fid ?? "").trim();
    case "NOTAM":
      return seNotamId(p);
    case "RWY5K":
    case "HKP1K":
      return String(p.POSITIONIN ?? fid ?? "").trim();
    default:
      return String(p.NAMEOFAREA ?? fid ?? "").trim();
  }
}

function wfsOriginalText(layer: SeLayer, p: Record<string, any>): string {
  switch (layer) {
    case "SUP":
      return cleanText(p.COM_EN || p.COM_SE);
    case "NOTAM":
      return cleanText(p.ITEM_E);
    case "HKP1K":
      return cleanText(p.COM_EN || p.COM_SE);
    default:
      return englishPartOfSvEn(p.COMMENT_2);
  }
}

/** Ein Aktivierungsfenster (SUP: FROM/TO, NOTAM: STARTVALIDITY/ENDVALIDITY). */
function wfsWindow(layer: SeLayer, p: Record<string, any>): Record<string, any> | null {
  let start: string | null = null;
  let end: string | null = null;
  let schedule: string = "";
  if (layer === "SUP") {
    start = isoOrNull(p.FROM);
    end = isoOrNull(p.TO);
    schedule = cleanText(p.SCHEDULE).replace(/\n+/g, "; ");
  } else if (layer === "NOTAM") {
    start = isoOrNull(p.STARTVALIDITY);
    end = isoOrNull(p.ENDVALIDITY);
    schedule = cleanText(p.ITEM_D).replace(/\n+/g, " ");
  } else return null;
  if (!start && !end && !schedule) return null;
  const entry: Record<string, any> = { permanent: "NO" };
  if (start) entry.startDateTime = start;
  if (end) entry.endDateTime = end;
  // Freitext-Zeitpläne bleiben als String: die App zeigt sie an und wertet die
  // Zone innerhalb des Fensters vorsichtshalber als aktiv.
  if (schedule) entry.schedule = [schedule];
  return entry;
}

/**
 * Normalisiert die Features eines WFS-Layers. Verwirft Gebiete mit
 * Untergrenze > 500 ft, abgelaufene SUP/NOTAM und (bei NOTAM) alles außer
 * Luftraumbeschränkungen. SUP-Gebiete mit mehreren Aktivierungszeiträumen
 * (identische Geometrie, je eigenes FROM/TO) werden zu einem Feature mit
 * mehreren applicability-Einträgen zusammengeführt.
 */
export function normalizeSwedishWfsFeatures(layer: SeLayer, features: any[], now: Date = new Date()): SeFeature[] {
  const out: SeFeature[] = [];
  const supIndex = new Map<string, SeFeature>();
  const nowTs = now.getTime();
  for (const f of Array.isArray(features) ? features : []) {
    if (!f || !f.geometry) continue;
    const g = f.geometry;
    if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
    const p: Record<string, any> = f.properties || {};
    if (layer === "NOTAM" && !seNotamIsAirspaceRestriction(p)) continue;

    const { lower, upper } = wfsAltitudes(layer, p);
    if (!seLowerIsRelevant(lower)) continue;

    const window = wfsWindow(layer, p);
    if (window?.endDateTime && new Date(window.endDateTime).getTime() < nowTs) continue;

    const restriction = seWfsRestriction(layer, p);
    const identifier = wfsIdentifier(layer, p, f.id);

    if (layer === "SUP") {
      const key = `${identifier}|${JSON.stringify(g.coordinates)}`;
      const existing = supIndex.get(key);
      if (existing) {
        if (window) {
          const app: any[] = existing.properties.applicability || (existing.properties.applicability = []);
          if (!app.some((a) => JSON.stringify(a) === JSON.stringify(window))) app.push(window);
        }
        continue;
      }
    }

    const summary = layerGermanSummary(layer, p, restriction);
    const original = wfsOriginalText(layer, p);
    const name = wfsName(layer, p);
    const props: Record<string, any> = {
      identifier,
      zoneId: wfsZoneId(layer, p, f.id, identifier),
      name,
      restriction,
      zoneType: LAYER_LABEL_DE[layer],
      source: SE_GEOZONE_SOURCE_LABEL,
      sourceLayer: layer,
    };
    applyAltitudes(props, lower, upper);
    props.message = [
      `${LAYER_LABEL_DE[layer]}. ${summary}`.trim(),
      `Höhe laut Quelle: ${props.altitudeText}`,
      original,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (window) props.applicability = [window];
    if (layer === "CTR") {
      props.militaryCtr = isSwedishMilitaryCtr(p);
      props.openCategoryMaxAglMeters = props.militaryCtr ? 10 : 50;
    } else if (layer === "TIZ" || layer === "ATZ") {
      props.openCategoryMaxAglMeters = 50;
    }
    if (layer === "SUP" || layer === "NOTAM") props._notamEligible = true;
    if (layer === "NOTAM") {
      props.isNotam = true;
      props.notamId = identifier;
      if (p.CODE23) props.notamQCode = `Q${String(p.CODE23)}${String(p.CODE45 ?? "")}`;
    }
    if (layer === "SUP" && /^https?:\/\//i.test(String(p.URL ?? ""))) {
      props.infoUrl = String(p.URL);
      props.infoUrlLabel = "AIP SUP öffnen";
    }

    const feature: SeFeature = { type: "Feature", geometry: simplifyGeometry({ type: g.type, coordinates: g.coordinates }), properties: props };
    if (layer === "SUP") supIndex.set(`${identifier}|${JSON.stringify(g.coordinates)}`, feature);
    out.push(feature);
  }
  return out;
}
