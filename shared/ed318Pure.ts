// Generischer Normalisierer für EUROCAE ED-318 (Nachfolger von ED-269) –
// „UAS Geographical Zones“ in der GeoJSON-Kodierung (FeatureCollection mit
// UASZone-Features, Höhe in geometry.layer) sowie tolerant für ED-318-Objekte
// mit ED-269-artigem `geometry[]` (horizontalProjection inkl. Circle).
//
// Liefert eine neutrale Zwischenform (Ed318Zone) und – für generische Importe –
// direkt App-Features in der Property-Form, die client/lib/ed269.ts
// (parseEd269ToGeozoneInfo) liest (restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, applicability, zoneAuthority …).
//
// Vorbilder (bewusst NICHT umgebaut): shared/swedishGeozones.ts
// (normalizeEd318Feature, echte Transportstyrelsen-Datei) und
// client/lib/geozoneTiles/tileZones.ts (czZoneFromStored, echte ŘLP-Kacheln).
// Genutzt von Spanien (ENAIRE-AIP-ZIPs, shared/spanishGeozones.ts) und dem
// Datei-Import (shared/geozoneImport.ts).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { normalizeEd269Restriction } from "./ed269Restriction";
import { ed269ProjectionToPolygons, ed269CircleToPolygon, ED269_REASON_LABELS_DE, type Ed269PureFeature } from "./ed269Pure";
import { isoDurationText } from "./swedishGeozones";

const FT = 0.3048;
// Obergrenzen ab hier (≈ FL490) gelten als „unbegrenzt“ (CZ: FL660).
const UNLIMITED_M = 15000;

export type Ed318AltitudeReference = "AGL" | "MSL";

export type Ed318Altitude = {
  /** Meter; undefined = unbegrenzt bzw. nicht lesbar. */
  meters: number | undefined;
  reference: Ed318AltitudeReference;
  unlimited?: boolean;
  /** Anzeige-Text (Original-Einheit/-Bezug). */
  text: string;
};

export type Ed318Authority = {
  name: string;
  purpose?: string;
  service?: string;
  contactName?: string;
  intervalBefore?: string;
  siteURL?: string;
  phone?: string;
  email?: string;
};

export type Ed318Volume = {
  /** GeoJSON-Polygon-Koordinaten (je Polygon: [Außenring, Löcher…]). */
  polygons: number[][][][];
  lower: Ed318Altitude | null;
  upper: Ed318Altitude | null;
};

export type Ed318Zone = {
  identifier: string;
  country?: string;
  name: string;
  /** Name in einer weiteren Sprache (falls mehrsprachig). */
  nameLocal?: string;
  /** Rohwert der Beschränkung (type bzw. restriction). */
  rawType: string | null;
  /** Normalisierter ED-269-Schlüssel oder null (unbekannt/fehlend). */
  restriction: string | null;
  reasons: string[];
  otherReasonInfo?: string;
  message: string;
  restrictionConditions?: string;
  regulationExemption?: string;
  extendedProperties?: unknown;
  authorities: Ed318Authority[];
  /** ED-269-applicability; undefined = dauerhaft, null = komplett abgelaufen. */
  applicability: any[] | undefined | null;
  volumes: Ed318Volume[];
};

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/**
 * ED-318-Text: String oder Sprach-Array [{text, lang}] (auch {text}). Ohne
 * Präferenz bzw. ohne Treffer gewinnt der erste nicht leere Eintrag
 * (= Originalsprache der Behörde).
 */
export function ed318Text(value: unknown, prefs: string[] = []): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (!Array.isArray(value)) {
    const t = (value as any)?.text;
    return typeof t === "string" ? t.trim() : "";
  }
  for (const pref of prefs) {
    const hit = value.find(
      (v: any) => String(v?.lang ?? "").toLowerCase().startsWith(pref) && typeof v?.text === "string" && v.text.trim(),
    );
    if (hit) return String(hit.text).trim();
  }
  for (const v of value) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v?.text === "string" && v.text.trim()) return v.text.trim();
  }
  return "";
}

function cleanText(s: unknown): string {
  return String(s ?? "")
    .replace(/\r/g, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Beschränkung
// ---------------------------------------------------------------------------

const KNOWN_RESTRICTIONS = ["PROHIBITED", "REQ_AUTHORISATION", "CONDITIONAL", "NO_RESTRICTION", "RESTRICTED"];

/**
 * ED-318 `type` bzw. ED-269 `restriction` → App-Schlüssel. In ED-269 heißt
 * `type` COMMON/CUSTOMIZED (= Variante), daher wird der erste Kandidat mit
 * bekanntem Wert genommen. Unbekannt/fehlend → null (Aufrufer entscheidet).
 */
export function ed318Restriction(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    const raw = c && typeof c === "object" && !Array.isArray(c) ? (c as any).type : c;
    if (raw == null || raw === "") continue;
    const n = normalizeEd269Restriction(String(raw));
    if (KNOWN_RESTRICTIONS.includes(n)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

function reference(refRaw: unknown, fallback: Ed318AltitudeReference): Ed318AltitudeReference {
  const r = String(refRaw ?? "").trim().toUpperCase();
  if (!r) return fallback;
  if (r === "AGL" || r === "SFC" || r === "GND" || r === "HEI" || r === "AGND") return "AGL";
  return "MSL"; // AMSL, MSL, WGS84, STD (FL), ALT → MSL (App kennt nur AGL/MSL)
}

/**
 * Ein ED-318-Höhenwert (layer.lower/upper bzw. ED-269 lowerLimit/upperLimit)
 * + uom (M/FT/FL) + Bezug (AGL/AMSL/WGS84/STD/SFC) → Meter. GND/SFC → 0 AGL,
 * UNL bzw. ≥ 15 000 m → unbegrenzt. Strings mit Einheit/Bezug („120 m AGL“,
 * „500FT AMSL“, „FL 65“) werden ebenfalls gelesen. Zahl ohne Einheit = Meter.
 */
export function ed318Altitude(value: unknown, uomRaw?: unknown, refRaw?: unknown): Ed318Altitude | null {
  if (value == null || value === "") return null;
  const s = String(value).trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (s === "GND" || s === "SFC" || s === "0 GND" || s === "0 SFC") return { meters: 0, reference: "AGL", text: "GND" };
  if (s === "UNL" || s === "UNLTD" || s === "UNLIMITED") return { meters: undefined, reference: "MSL", unlimited: true, text: "UNL" };
  const fl = s.match(/^FL ?(\d{1,3})$/);
  if (fl) return flAltitude(Number(fl[1]));
  const m = s.match(/^(-?\d+(?:[.,]\d+)?) ?(FT|F|FEET|M|METERS?|METRES?|FL)? ?(AGL|AMSL|MSL|SFC|GND|WGS84|STD|ALT|HEI)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const refU = String(m[3] ?? refRaw ?? "").trim().toUpperCase();
  let uom = String(m[2] ?? uomRaw ?? "").trim().toUpperCase();
  if (uom === "F" || uom === "FEET") uom = "FT";
  if (/^MET/.test(uom) || uom === "") uom = refU === "STD" ? "FL" : "M";
  if (uom === "FL") return flAltitude(n);
  const ref = reference(refU, "AGL");
  if (n <= 0 && ref === "AGL") return { meters: 0, reference: ref, text: "GND" };
  const meters = uom === "FT" ? n * FT : n;
  if (meters >= UNLIMITED_M) return { meters: undefined, reference: "MSL", unlimited: true, text: `${n} ${uom === "FT" ? "ft" : "m"}` };
  const refText = refU === "WGS84" || refU === "MSL" || refU === "ALT" ? "AMSL" : refU === "SFC" || refU === "GND" || refU === "HEI" || !refU ? "AGL" : refU;
  return { meters: round1(meters), reference: ref, text: `${n} ${uom === "FT" ? "ft" : "m"} ${refText}` };
}

function flAltitude(fl: number): Ed318Altitude {
  const meters = fl * 100 * FT;
  if (meters >= UNLIMITED_M) return { meters: undefined, reference: "MSL", unlimited: true, text: `FL ${fl}` };
  return { meters: round1(meters), reference: "MSL", text: `FL ${fl}` };
}

/** Höhen in die App-Properties schreiben (wie applyAltitudes in SE/ES). */
export function ed318ApplyAltitudes(out: Record<string, any>, lower: Ed318Altitude | null, upper: Ed318Altitude | null): void {
  if (lower && typeof lower.meters === "number") {
    out.lowerMeters = lower.meters;
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
// Zeiten
// ---------------------------------------------------------------------------

function isoOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const ts = typeof value === "number" ? value : new Date(String(value)).getTime();
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

/** Wochentage zusammenfassen: gleiche Uhrzeiten → ein Eintrag mit mehreren Tagen. */
function mergeScheduleDays(schedule: any[]): any[] {
  const out: any[] = [];
  const byTime = new Map<string, any>();
  for (const s of schedule) {
    if (!s || typeof s !== "object") continue;
    const day = Array.isArray(s.day) ? s.day.map((d: unknown) => String(d).toUpperCase()) : s.day != null ? [String(s.day).toUpperCase()] : ["ANY"];
    const { day: _d, ...rest } = s;
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
 * ED-318 limitedApplicability (bzw. ED-269 applicability) → ED-269
 * applicability. Abgelaufene Fenster entfallen; ein Fenster ohne Ende/Zeitplan
 * mit vergangenem Start (oder ED-269 permanent: "YES") = dauerhaft → undefined.
 * Rückgabe null = Zone komplett abgelaufen.
 */
export function ed318Applicability(value: unknown, now: Date = new Date()): any[] | undefined | null {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  if (list.length === 0) return undefined;
  const nowTs = now.getTime();
  const out: any[] = [];
  let permanent = false;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const start = isoOrNull((e as any).startDateTime ?? (e as any).startTime);
    const end = isoOrNull((e as any).endDateTime ?? (e as any).endTime);
    const schedule = Array.isArray((e as any).schedule) ? (e as any).schedule : [];
    if (end && new Date(end).getTime() < nowTs) continue;
    if (String((e as any).permanent ?? "").toUpperCase() === "YES" && schedule.length === 0) {
      permanent = true;
      continue;
    }
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

// ---------------------------------------------------------------------------
// Behörden & Gründe
// ---------------------------------------------------------------------------

/** zoneAuthority[] (Texte als String oder Sprach-Array) → flache Liste. */
export function ed318Authorities(value: unknown, prefs: string[] = []): Ed318Authority[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const out: Ed318Authority[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as any;
    const service = ed318Text(a.service, prefs);
    const contactName = ed318Text(a.contactName, prefs);
    const name = ed318Text(a.name, prefs) || service || contactName;
    if (!name) continue;
    const flat: Ed318Authority = { name };
    const purpose = String(a.purpose ?? "").trim().toUpperCase();
    if (purpose) flat.purpose = purpose === "AUTHORISATION" ? "AUTHORIZATION" : purpose;
    if (service && service !== name) flat.service = service;
    if (contactName && contactName !== name) flat.contactName = contactName;
    if (a.intervalBefore) flat.intervalBefore = String(a.intervalBefore);
    let site = ed318Text(a.siteURL, prefs);
    if (site && /^www\./i.test(site)) site = `https://${site}`;
    if (/^https?:\/\//i.test(site)) flat.siteURL = site;
    const phone = ed318Text(a.phone, prefs);
    if (phone) flat.phone = phone;
    const email = ed318Text(a.email, prefs).replace(/^mailto:/i, "");
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) flat.email = email;
    if (!out.some((x) => JSON.stringify(x) === JSON.stringify(flat))) out.push(flat);
  }
  return out;
}

/** reason[] (+ otherReasonInfo) → deutscher Text. */
export function ed318ReasonText(reasons: string[], otherReasonInfo?: string): string {
  const out: string[] = [];
  for (const r of reasons) {
    const key = r.toUpperCase().replace(/[\s-]+/g, "_");
    if (key === "OTHER") {
      if (otherReasonInfo) out.push(otherReasonInfo);
      else out.push(ED269_REASON_LABELS_DE.OTHER);
    } else out.push(ED269_REASON_LABELS_DE[key] ?? r);
  }
  if (out.length === 0 && otherReasonInfo) out.push(otherReasonInfo);
  return [...new Set(out)].join(", ");
}

function intervalText(raw: string | undefined): string {
  if (!raw) return "";
  return isoDurationText(raw) || raw;
}

const PURPOSE_DE: Record<string, string> = {
  AUTHORIZATION: "Genehmigung",
  NOTIFICATION: "Vorab-Mitteilung",
  INFORMATION: "Information",
};

/** Kontaktzeile je Behörde (für die Popup-Nachricht). */
export function ed318AuthorityLine(a: Ed318Authority): string {
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

/** Deutsche Kurzfassung der Auflagen aus Beschränkung und Behörden. */
export function ed318GermanSummary(restriction: string, authorities: Ed318Authority[]): string {
  const lines: string[] = [];
  if (restriction === "PROHIBITED") lines.push("Flugverbot für UAS.");
  else if (restriction === "REQ_AUTHORISATION") lines.push("Flug nur mit Genehmigung.");
  else if (restriction === "CONDITIONAL") lines.push("Flug unter Auflagen zulässig – Bedingungen im Originaltext beachten.");
  for (const a of authorities.filter((x) => x.purpose === "AUTHORIZATION")) {
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

function circleOf(center: unknown, radiusRaw: unknown): number[][][][] {
  const radius = Number(radiusRaw);
  if (!Array.isArray(center) || center.length < 2 || !Number.isFinite(radius) || radius <= 0) return [];
  const lon = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
  return [ed269CircleToPolygon([lon, lat], radius, radius >= 1500 ? 64 : 48)];
}

/** GeoJSON-/ED-269-Projektion → Polygone (Polygon, MultiPolygon, Circle, Point+extent). */
export function ed318GeometryPolygons(g: any): number[][][][] {
  if (!g || typeof g !== "object") return [];
  const type = String(g.type ?? "");
  if (type === "Point") return circleOf(g.coordinates, g.extent?.radius ?? g.radius);
  if (type === "Circle") return circleOf(g.center ?? g.coordinates, g.radius ?? g.extent?.radius);
  if (type === "Polygon" || type === "MultiPolygon") return ed269ProjectionToPolygons(g);
  return [];
}

function layerAltitudes(src: any): { lower: Ed318Altitude | null; upper: Ed318Altitude | null } {
  const layer = src?.layer && typeof src.layer === "object" ? src.layer : null;
  if (layer) {
    const uom = layer.uom ?? layer.uomDimensions;
    return {
      lower: ed318Altitude(layer.lower ?? layer.lowerLimit, uom, layer.lowerReference ?? layer.lowerVerticalReference),
      upper: ed318Altitude(layer.upper ?? layer.upperLimit, uom, layer.upperReference ?? layer.upperVerticalReference),
    };
  }
  const uom = src?.uomDimensions ?? src?.uom;
  return {
    lower: ed318Altitude(src?.lowerLimit ?? src?.lower, uom, src?.lowerVerticalReference ?? src?.lowerReference),
    upper: ed318Altitude(src?.upperLimit ?? src?.upper, uom, src?.upperVerticalReference ?? src?.upperReference),
  };
}

/** Geometrie einer Zone → Volumen (GeoJSON mit layer, GeometryCollection, ED-269 geometry[]). */
export function ed318Volumes(geometry: unknown): Ed318Volume[] {
  const out: Ed318Volume[] = [];
  const push = (polygons: number[][][][], alt: { lower: Ed318Altitude | null; upper: Ed318Altitude | null }) => {
    if (polygons.length > 0) out.push({ polygons, ...alt });
  };
  const visit = (g: any, inherited?: any) => {
    if (!g || typeof g !== "object") return;
    if (Array.isArray(g)) {
      for (const x of g) visit(x, inherited);
      return;
    }
    if (g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
      for (const x of g.geometries) visit(x, g.layer ? g : inherited);
      return;
    }
    if (g.horizontalProjection) {
      const hp = g.horizontalProjection;
      push(ed318GeometryPolygons(hp), layerAltitudes(g.layer || g.lowerLimit != null || g.upperLimit != null ? g : hp.layer ? hp : inherited));
      return;
    }
    const alt = layerAltitudes(g.layer || g.lowerLimit != null || g.upperLimit != null ? g : inherited);
    push(ed318GeometryPolygons(g), alt);
  };
  visit(geometry);
  return out;
}

// ---------------------------------------------------------------------------
// Zonen
// ---------------------------------------------------------------------------

/**
 * Zonenliste aus den üblichen Hüllen ziehen: FeatureCollection/{features},
 * nacktes Array, {items:[{zone}]}, {UASZoneList}, {uasZones}, {zones}.
 */
export function ed318ExtractZones(input: unknown): any[] {
  if (Array.isArray(input)) return input.map((x: any) => (x && x.zone && !x.geometry ? x.zone : x));
  const o = input as any;
  if (!o || typeof o !== "object") return [];
  for (const key of ["features", "UASZoneList", "uasZoneList", "uasZones", "UASZones", "zones", "items"]) {
    if (Array.isArray(o[key])) return ed318ExtractZones(o[key]);
  }
  if (o.type === "Feature") return [o];
  return [];
}

/**
 * Rohe Zone (GeoJSON-Feature mit properties+geometry ODER UASZone-Objekt mit
 * Feldern auf oberster Ebene) → Ed318Zone. null, wenn keine Geometrie lesbar.
 * `prefs`: bevorzugte Sprachen für Name/Meldung (leer = Originalsprache).
 */
export function ed318ParseZone(raw: any, now: Date = new Date(), prefs: string[] = []): Ed318Zone | null {
  if (!raw || typeof raw !== "object") return null;
  const isFeature = raw.type === "Feature" || (raw.properties && typeof raw.properties === "object");
  const p: Record<string, any> = isFeature ? raw.properties || {} : raw;
  const geometry = isFeature ? raw.geometry : raw.geometry ?? raw.geometries;
  const volumes = ed318Volumes(geometry);
  if (volumes.length === 0) return null;

  const identifier = String(p.identifier ?? p.id ?? (isFeature ? raw.id : undefined) ?? "").trim();
  const name = cleanText(ed318Text(p.name, prefs)) || identifier;
  const otherLang = Array.isArray(p.name) ? cleanText(ed318Text(p.name, ["en"])) : "";
  const rawType = p.type != null && typeof p.type !== "object" ? String(p.type) : p.restriction != null ? String(typeof p.restriction === "object" ? p.restriction.type ?? "" : p.restriction) : null;
  const reasons = (Array.isArray(p.reason) ? p.reason : p.reason ? [p.reason] : []).map((r: unknown) => String(r).trim()).filter(Boolean);
  const otherReasonInfo = ed318Text(p.otherReasonInfo, prefs) || undefined;
  const zone: Ed318Zone = {
    identifier,
    country: p.country ? String(p.country) : undefined,
    name,
    nameLocal: otherLang && otherLang !== name ? otherLang : undefined,
    rawType,
    restriction: ed318Restriction(p.restriction, p.type),
    reasons,
    otherReasonInfo,
    message: cleanText(ed318Text(p.message, prefs)),
    restrictionConditions: ed318Text(p.restrictionConditions, prefs) || undefined,
    regulationExemption: p.regulationExemption != null ? String(p.regulationExemption) : undefined,
    extendedProperties: p.extendedProperties,
    authorities: ed318Authorities(p.zoneAuthority ?? p.authority, prefs),
    applicability: ed318Applicability(p.limitedApplicability ?? p.applicability, now),
    volumes,
  };
  return zone;
}

/** Volumen mit gleichen Höhen zu einer Gruppe (ein Feature, ggf. MultiPolygon). */
export function ed318GroupVolumes(volumes: Ed318Volume[]): Ed318Volume[] {
  const groups = new Map<string, Ed318Volume>();
  for (const v of volumes) {
    const key = `${v.lower?.meters ?? "-"}${v.lower?.reference ?? ""}/${v.upper?.meters ?? (v.upper?.unlimited ? "UNL" : "-")}${v.upper?.reference ?? ""}`;
    const g = groups.get(key);
    if (g) g.polygons.push(...v.polygons);
    else groups.set(key, { ...v, polygons: [...v.polygons] });
  }
  return [...groups.values()];
}

export function ed318PolygonsGeometry(polygons: number[][][][]): { type: string; coordinates: unknown } {
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}

export interface Ed318FeatureOptions {
  /** Quellenlabel (properties.source). */
  source?: string;
  /** Präfix für zoneId (z. B. „RO“). */
  idPrefix?: string;
  /** Beschränkung, wenn die Zone keine bekannte angibt. Default REQ_AUTHORISATION (vorsichtig). */
  defaultRestriction?: string;
  /** Bevorzugte Sprachen für Texte (leer = Originalsprache). */
  langPrefs?: string[];
  now?: Date;
}

/**
 * ED-318-Datensatz (beliebige Hülle) → App-Features. Abgelaufene Zonen
 * entfallen; je Höhenband ein Feature. Fehlt die Beschränkung, wird
 * vorsichtig `defaultRestriction` (REQ_AUTHORISATION) gesetzt und markiert.
 */
export function ed318ZonesToFeatures(input: unknown, opts: Ed318FeatureOptions = {}): Ed269PureFeature[] {
  const now = opts.now ?? new Date();
  const out: Ed269PureFeature[] = [];
  const seen = new Map<string, number>();
  ed318ExtractZones(input).forEach((raw, idx) => {
    const z = ed318ParseZone(raw, now, opts.langPrefs ?? []);
    if (!z || z.applicability === null) return;
    const restriction = z.restriction ?? opts.defaultRestriction ?? "REQ_AUTHORISATION";
    const assumed = z.restriction == null;
    const message = [
      ed318GermanSummary(restriction, z.authorities),
      assumed ? "Beschränkung in der Datei nicht angegeben – vorsichtshalber als genehmigungspflichtig eingestuft." : "",
      z.message,
      z.restrictionConditions && !z.message.includes(z.restrictionConditions) ? z.restrictionConditions : "",
      z.authorities.map(ed318AuthorityLine).join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n");
    const baseId = z.identifier || `${idx + 1}`;
    const groups = ed318GroupVolumes(z.volumes);
    groups.forEach((g, gi) => {
      let zoneId = `${opts.idPrefix ? `${opts.idPrefix}-` : ""}${baseId}${groups.length > 1 ? `#${gi + 1}` : ""}`;
      const n = seen.get(zoneId) ?? 0;
      seen.set(zoneId, n + 1);
      if (n > 0) zoneId = `${zoneId}~${n + 1}`;
      const props: Record<string, any> = {
        identifier: z.identifier || undefined,
        zoneId,
        name: z.name || "Geozone",
        nameLocal: z.nameLocal,
        restriction,
        originalType: z.rawType,
        restrictionAssumed: assumed || undefined,
        message,
        reason: ed318ReasonText(z.reasons, z.otherReasonInfo) || undefined,
        reasonCodes: z.reasons.length > 0 ? z.reasons : undefined,
        restrictionConditions: z.restrictionConditions,
        regulationExemption: z.regulationExemption,
        zoneCountry: z.country,
        extendedProperties: z.extendedProperties,
        source: opts.source,
      };
      if (z.applicability) props.applicability = z.applicability;
      ed318ApplyAltitudes(props, g.lower, g.upper);
      if (z.authorities.length > 0) {
        props.zoneAuthority = z.authorities.map(({ email: _e, ...rest }) => rest);
        const mail = (z.authorities.find((a) => a.purpose === "AUTHORIZATION" && a.email) ?? z.authorities.find((a) => a.email))?.email;
        if (mail) props.contactEmail = mail;
      }
      for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
      out.push({ type: "Feature", geometry: ed318PolygonsGeometry(g.polygons), properties: props });
    });
  });
  return out;
}
