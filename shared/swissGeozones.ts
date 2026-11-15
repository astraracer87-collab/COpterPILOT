// Schweizer (und Liechtensteiner) Geozonen des BAZL – Normalisierung des
// ED-269-Datensatzes `ch.bazl.einschraenkungen-drohnen` (data.geo.admin.ch)
// sowie der separaten UAS-Aktivitätszonen (`ch.bazl.uas-aktivitaetszonen`) auf
// das ED-269-nahe Property-Format, das client/lib/ed269.ts
// (parseEd269ToGeozoneInfo) liest. Siehe docs/geozonen-weitere-laender.md §4.
//
// Besonderheiten des BAZL-Feeds:
// - Reines ED-269 (`{title, description, features:[…]}`), jedes Feature trägt
//   `geometry[]` mit `horizontalProjection` (immer Polygon) und Höhen je
//   Volumen – also KEIN GeoJSON. Wir bauen daraus GeoJSON-Features.
// - `restriction` ist IMMER `REQ_AUTHORISATION`; die echte Abstufung steckt in
//   `restrictionConditions[]` (nur Englisch). Einstufung siehe
//   swissRestrictionKind()/swissRestriction() unten.
// - `upperLimit: 99999` bedeutet unbegrenzt.
// - `applicability[].dailyPeriod` statt `schedule`, Zeiten mit Offset
//   („07:00:00.000+01:00“) statt „Z“, Tag „Any“ bzw. leere Platzhalter.
// - Liechtenstein (country „LIE“) ist im selben Datensatz enthalten.
// - Lizenz: opendata.swiss „Opendata BY“ (Quellenangabe Pflicht).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { parseHeight } from "./geozoneKit/heights";
import { localizedExtendedProperties } from "./geozoneKit/messages";
import { round1 } from "./geozoneKit/text";

export const CH_GEOZONE_SOURCE_LABEL = "BAZL / swisstopo (geo.admin.ch)";
export const CH_GEOZONE_ATTRIBUTION = "© BAZL / swisstopo (Opendata BY)";

export const CH_GEOZONES_URL =
  "https://data.geo.admin.ch/ch.bazl.einschraenkungen-drohnen/einschraenkungen-drohnen/einschraenkungen-drohnen_4326.json";
export const CH_ACTIVITY_ZONES_URL =
  "https://data.geo.admin.ch/ch.bazl.uas-aktivitaetszonen/uas-aktivitaetszonen/uas-aktivitaetszonen_4326.geojson";

// ED-269-Wert für „unbegrenzt“ beim BAZL.
const CH_UNLIMITED = 99999;

// Douglas-Peucker-Toleranz in Grad (≈ 5,5 m Nord-Süd, ≈ 3,8 m Ost-West auf
// 47° N). Die Naturschutz-/Jagdbanngebiete sind sehr detailreich digitalisiert.
// 0 = keine Vereinfachung, volle Genauigkeit der BAZL-Daten
export const CH_SIMPLIFY_TOLERANCE_DEG = 0;
// Nachkommastellen der gespeicherten Koordinaten (5 ≈ 1,1 m).
// 7 Nachkommastellen ≈ 1 cm – praktisch die Originalgenauigkeit
export const CH_COORD_DECIMALS = 7;

export type SwissFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
  bbox?: [number, number, number, number];
};

// ---------------------------------------------------------------------------
// Einstufung (restrictionConditions → restriction)
// ---------------------------------------------------------------------------

/**
 * Art der BAZL-Einschränkung, abgeleitet aus dem englischen Text in
 * `restrictionConditions` (gemessen 2026-11-15: genau drei Varianten).
 *
 * - "PROHIBITED_ALL": „The operation of unmanned aircraft is prohibited.“
 *   (1186 Zonen: Naturschutz, Militär, Gefängnisse, Kernanlagen, …)
 * - "PROHIBITED_OVER_250G": „… weighing more than 250 g is prohibited.“
 *   (84 Zonen: Flugplatz-/Heliport-Perimeter)
 * - "PROHIBITED_OVER_250G_ABOVE_120M": „… more than 250 g is prohibited from an
 *   altitude of 120 m above ground.“ (18 Zonen: Kontrollzonen CTR; das Volumen
 *   beginnt im Feed bereits bei lowerLimit 120 m AGL)
 * - "OTHER": unbekannter Text (künftige Änderungen des Feeds)
 */
export type SwissRestrictionKind =
  | "PROHIBITED_ALL"
  | "PROHIBITED_OVER_250G"
  | "PROHIBITED_OVER_250G_ABOVE_120M"
  | "OTHER";

const KIND_SEVERITY: Record<SwissRestrictionKind, number> = {
  PROHIBITED_ALL: 3,
  PROHIBITED_OVER_250G: 2,
  PROHIBITED_OVER_250G_ABOVE_120M: 1,
  OTHER: 0,
};

/** Einstufung eines einzelnen Bedingungstextes. */
export function swissConditionKind(text: string): SwissRestrictionKind {
  const t = String(text ?? "").toLowerCase().replace(/\s+/g, " ");
  if (!/prohibited|forbidden|not permitted/.test(t)) return "OTHER";
  const weight = /(\d+)\s*g\b/.exec(t);
  if (!weight) return "PROHIBITED_ALL";
  if (/altitude|above ground|\bagl\b|from a height/.test(t)) return "PROHIBITED_OVER_250G_ABOVE_120M";
  return "PROHIBITED_OVER_250G";
}

/** Strengste Einstufung über alle `restrictionConditions` eines Features. */
export function swissRestrictionKind(p: Record<string, any>): SwissRestrictionKind {
  const conds: unknown[] = Array.isArray(p?.restrictionConditions)
    ? p.restrictionConditions
    : p?.restrictionConditions
      ? [p.restrictionConditions]
      : [];
  let best: SwissRestrictionKind = "OTHER";
  for (const c of conds) {
    const k = swissConditionKind(String(c ?? ""));
    if (KIND_SEVERITY[k] > KIND_SEVERITY[best]) best = k;
  }
  return best;
}

/**
 * Abbildung auf die App-Einstufung:
 *
 * - PROHIBITED_ALL → "PROHIBITED" (rot). Gilt auch für Zonen mit Grund NATURE:
 *   In Schweizer Natur-/Jagdbanngebieten ist der Drohnenbetrieb verboten, eine
 *   grüne „Naturschutz“-Einfärbung würde das verharmlosen.
 * - PROHIBITED_OVER_250G → "REQ_AUTHORISATION" (orange): für Drohnen über 250 g
 *   verboten, Ausnahmebewilligung möglich; bis 250 g gilt die Zone nicht.
 * - PROHIBITED_OVER_250G_ABOVE_120M → "REQ_AUTHORISATION" (orange). Bewusst
 *   NICHT "CONDITIONAL": Innerhalb des Zonenvolumens (das im Feed erst bei
 *   120 m AGL beginnt, lowerMeters = 120) gilt dieselbe Regel wie im
 *   Flugplatzperimeter. Unterhalb von 120 m blendet der Höhenfilter
 *   (shared/geozoneAltitudeFilter.ts isZoneReachable) die Zone ohnehin aus,
 *   solange die geplante Flughöhe unter 120 m liegt – die Gelb-Abstufung
 *   ergäbe also keinen Informationsgewinn, würde die Lage über 120 m aber
 *   unterschätzen.
 * - OTHER → Feed-Wert (normalerweise "REQ_AUTHORISATION"), sicherheitshalber
 *   nie schwächer als REQ_AUTHORISATION.
 */
export function swissRestriction(p: Record<string, any>): string {
  const kind = swissRestrictionKind(p);
  if (kind === "PROHIBITED_ALL") return "PROHIBITED";
  if (kind === "PROHIBITED_OVER_250G" || kind === "PROHIBITED_OVER_250G_ABOVE_120M") return "REQ_AUTHORISATION";
  const raw = String(p?.restriction ?? "").toUpperCase();
  if (raw === "PROHIBITED") return "PROHIBITED";
  return "REQ_AUTHORISATION";
}

const KIND_MESSAGE_DE: Record<SwissRestrictionKind, string> = {
  PROHIBITED_ALL: "Der Betrieb von Drohnen ist verboten.",
  PROHIBITED_OVER_250G:
    "Verboten für Drohnen über 250 g. Für Drohnen bis 250 g gilt diese Einschränkung nicht.",
  PROHIBITED_OVER_250G_ABOVE_120M:
    "Kontrollzone (CTR): ab 120 m über Grund verboten für Drohnen über 250 g. Unterhalb von 120 m über Grund gilt diese Einschränkung nicht.",
  OTHER: "",
};

/** Kurzer deutscher Hinweistext zur Einschränkung (für Listen/Popups). */
export function swissRestrictionMessageDe(kind: SwissRestrictionKind): string {
  return KIND_MESSAGE_DE[kind];
}

// Bekannte englische `message`-Texte des BAZL → Deutsch.
const MESSAGE_DE: Record<string, string> = {
  "exemption permits may be applied for at the competent cantonal specialist office.":
    "Ausnahmebewilligungen können bei der zuständigen kantonalen Fachstelle beantragt werden.",
  "exemption permits may be applied for at the competent authority.":
    "Ausnahmebewilligungen können bei der zuständigen Behörde beantragt werden.",
};

function translateMessage(en: string): string | null {
  const key = en.trim().toLowerCase().replace(/\s+/g, " ");
  return MESSAGE_DE[key] ?? null;
}

const REASON_DE: Record<string, string> = {
  NATURE: "Naturschutz",
  SENSITIVE: "Sensibles Gebiet",
  AIR_TRAFFIC: "Flugverkehr",
  PRIVACY: "Privatsphäre",
  POPULATION: "Bevölkerung",
  NOISE: "Lärm",
  EMERGENCY: "Notfall",
  OTHER: "Sonstiges",
};

/** ED-269-Gründe als deutscher Klartext (z. B. „Naturschutz, Flugverkehr“). */
export function swissReasonLabel(reasons: unknown): string {
  const list = Array.isArray(reasons) ? reasons : reasons ? [reasons] : [];
  return list
    .map((r) => String(r ?? "").trim())
    .filter(Boolean)
    .map((r) => REASON_DE[r.toUpperCase()] ?? r)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Höhen
// ---------------------------------------------------------------------------

/** ED-269-Höhenwert → Meter; 99999 / null = unbegrenzt (undefined). */
export function swissLimitMeters(value: unknown, uom: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  if (n >= CH_UNLIMITED) return undefined;
  const u = String(uom ?? "M").toUpperCase();
  // Nur ft und m kommen vor; alles andere gilt als Meter (Umrechnung zentral).
  return round1(parseHeight(n, u === "FT" || u === "F" ? "ft" : "m")?.m ?? n);
}

// ⚠️ Leerer/unbekannter Bezug wird (wie bisher) AGL – siehe docs/pruefung-umbau-plan.md (B6).
function verticalRef(raw: unknown): string {
  const r = String(raw ?? "").toUpperCase().trim();
  if (r === "AMSL" || r === "MSL" || r === "WGS84") return "AMSL";
  return "AGL";
}

// ---------------------------------------------------------------------------
// Gültigkeit (applicability / dailyPeriod → schedule)
// ---------------------------------------------------------------------------

// „07:00:00.000+01:00“ → Minuten in UTC (0..1439), null wenn unlesbar.
function timeToUtcMinutes(raw: unknown): number | null {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  let minutes = Number(m[1]) * 60 + Number(m[2]);
  const off = m[3];
  if (off && off.toUpperCase() !== "Z") {
    const sign = off[0] === "-" ? -1 : 1;
    const digits = off.slice(1).replace(":", "");
    minutes -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  return ((minutes % 1440) + 1440) % 1440;
}

function fmtUtc(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}Z`;
}

/**
 * Wandelt BAZL-`dailyPeriod`-Einträge in ED-269-`schedule`-Einträge (Zeiten in
 * UTC mit „Z“, die shared/ed269Restriction.ts versteht). Leere Platzhalter
 * (`day:[""]`, leere Zeiten) und ganztägige Fenster (00:00–00:00, 00:00–23:59)
 * entfallen – dann gilt die Zone im Gültigkeitszeitraum durchgehend.
 * Unlesbare Zeiten bleiben als Rohtext erhalten (→ gelten als aktiv).
 */
export function swissDailyPeriodToSchedule(dailyPeriod: unknown): any[] {
  const list = Array.isArray(dailyPeriod) ? dailyPeriod : [];
  const out: any[] = [];
  for (const dp of list) {
    if (!dp || typeof dp !== "object") continue;
    const rawDays: string[] = (Array.isArray((dp as any).day) ? (dp as any).day : [(dp as any).day])
      .map((d: unknown) => String(d ?? "").trim())
      .filter(Boolean);
    const startRaw = String((dp as any).startTime ?? "").trim();
    const endRaw = String((dp as any).endTime ?? "").trim();
    const anyDay = rawDays.length === 0 || rawDays.some((d) => /^(any|all|daily)$/i.test(d));
    if (!startRaw && !endRaw) {
      if (anyDay) continue; // reiner Platzhalter
      out.push({ day: rawDays });
      continue;
    }
    const s = timeToUtcMinutes(startRaw);
    const e = timeToUtcMinutes(endRaw);
    if (s == null || e == null) {
      out.push({ day: anyDay ? ["ANY"] : rawDays, startTime: startRaw, endTime: endRaw });
      continue;
    }
    const span = (e - s + 1440) % 1440;
    const fullDay = span === 0 || span >= 1439;
    if (fullDay && anyDay) continue;
    const entry: Record<string, any> = { day: anyDay ? ["ANY"] : rawDays };
    if (!fullDay) {
      entry.startTime = fmtUtc(s);
      entry.endTime = fmtUtc(e);
    }
    out.push(entry);
  }
  return out;
}

/** BAZL-`applicability` → ED-269-`applicability` mit `schedule` statt `dailyPeriod`. */
export function swissApplicability(app: unknown): any[] {
  const list = Array.isArray(app) ? app : [];
  const out: any[] = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const permanent = String((a as any).permanent ?? "").toUpperCase() === "YES" ? "YES" : "NO";
    const entry: Record<string, any> = { permanent };
    if (permanent === "NO") {
      if ((a as any).startDateTime) entry.startDateTime = String((a as any).startDateTime);
      if ((a as any).endDateTime) entry.endDateTime = String((a as any).endDateTime);
      const schedule = swissDailyPeriodToSchedule((a as any).dailyPeriod);
      if (schedule.length > 0) entry.schedule = schedule;
    }
    out.push(entry);
  }
  return out.length > 0 ? out : [{ permanent: "YES" }];
}

// ---------------------------------------------------------------------------
// Geometrie: Vereinfachung + Rundung
// ---------------------------------------------------------------------------

/** Douglas-Peucker-Vereinfachung eines Rings (Toleranz in Grad) – aus dutchGeozones.ts übernommen. */
export function simplifyRing(ring: number[][], tol: number): number[][] {
  if (ring.length <= 8) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

// Ring bereinigen: nur gültige [lon, lat], schließen, vereinfachen, runden und
// danach aufeinanderfolgende Duplikate (durch die Rundung entstanden) entfernen.
function cleanRing(ring: unknown, tol: number, factor: number): number[][] | null {
  if (!Array.isArray(ring)) return null;
  const pts: number[][] = [];
  for (const c of ring) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const x = Number(c[0]);
    const y = Number(c[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([x, y]);
  }
  if (pts.length < 3) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) pts.push([first[0], first[1]]);
  const simplified = tol > 0 ? simplifyRing(pts, tol) : pts;
  const out: number[][] = [];
  for (const [x, y] of simplified) {
    const rx = Math.round(x * factor) / factor;
    const ry = Math.round(y * factor) / factor;
    const prev = out[out.length - 1];
    if (prev && prev[0] === rx && prev[1] === ry) continue;
    out.push([rx, ry]);
  }
  return out.length >= 4 ? out : null;
}

function cleanPolygon(rings: unknown, tol: number, factor: number): number[][][] | null {
  if (!Array.isArray(rings)) return null;
  const out: number[][][] = [];
  for (let i = 0; i < rings.length; i++) {
    const r = cleanRing(rings[i], tol, factor);
    if (r) out.push(r);
    else if (i === 0) return null; // ohne Außenring kein Polygon
  }
  return out.length > 0 ? out : null;
}

function computeBbox(coords: unknown): [number, number, number, number] | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const x = c[0] as number, y = c[1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    } else c.forEach(visit);
  };
  visit(coords);
  return isFinite(minX) ? [minX, minY, maxX, maxY] : undefined;
}

export type SwissNormalizeOptions = {
  /** Douglas-Peucker-Toleranz in Grad (0 = aus). */
  simplifyToleranceDeg?: number;
  /** Nachkommastellen der Koordinaten. */
  decimals?: number;
};

// ---------------------------------------------------------------------------
// Drohnen-Einschränkungen (ED-269)
// ---------------------------------------------------------------------------

// Leere Felder aus zoneAuthority entfernen (spart Speicher auf dem Gerät).
function compactAuthority(list: unknown): Record<string, any>[] {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  const out: Record<string, any>[] = [];
  for (const a of arr) {
    if (!a || typeof a !== "object") continue;
    const c: Record<string, any> = {};
    for (const [k, v] of Object.entries(a as Record<string, any>)) {
      if (v == null || v === "") continue;
      c[k] = v;
    }
    if (Object.keys(c).length > 0) out.push(c);
  }
  return out;
}

// „P05DT00H“ → 5 (Tage), null wenn unlesbar.
function intervalDays(raw: unknown): number | null {
  const m = String(raw ?? "").match(/^P(\d+)D/i);
  return m ? Number(m[1]) : null;
}

// Antrags-/Kontakthinweis aus der ersten zuständigen Stelle.
function applicationText(authorities: Record<string, any>[]): string | undefined {
  const a = authorities.find((x) => String(x.purpose ?? "").toUpperCase() === "AUTHORIZATION") ?? authorities[0];
  if (!a) return undefined;
  const parts: string[] = [];
  const who = [a.name, a.service].filter(Boolean).join(" – ");
  if (who) parts.push(`Ausnahmebewilligung: ${who}`);
  if (a.contactName) parts.push(`Kontakt: ${a.contactName}`);
  if (a.phone) parts.push(`Tel. ${a.phone}`);
  if (a.email) parts.push(String(a.email));
  const days = intervalDays(a.intervalBefore);
  if (days != null && days > 0) parts.push(`Antrag mind. ${days} ${days === 1 ? "Tag" : "Tage"} im Voraus`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * Normalisiert EIN ED-269-Feature des BAZL in ein oder mehrere GeoJSON-
 * Features (eines je unterschiedlichem Höhenband in `geometry[]`; im aktuellen
 * Feed haben alle Volumen eines Features dieselben Höhen → genau ein Feature,
 * bei mehreren Polygonen als MultiPolygon).
 */
export function normalizeSwissEd269Feature(
  zone: Record<string, any>,
  opts: SwissNormalizeOptions = {},
): SwissFeature[] {
  if (!zone || typeof zone !== "object") return [];
  const tol = opts.simplifyToleranceDeg ?? CH_SIMPLIFY_TOLERANCE_DEG;
  const factor = Math.pow(10, opts.decimals ?? CH_COORD_DECIMALS);

  // Volumen nach Höhenband gruppieren.
  const groups = new Map<string, { vol: Record<string, any>; polys: number[][][][] }>();
  const vols: any[] = Array.isArray(zone.geometry) ? zone.geometry : [];
  for (const vol of vols) {
    const hp = vol?.horizontalProjection;
    if (!hp) continue;
    const polys: number[][][][] = [];
    if (hp.type === "Polygon") {
      const p = cleanPolygon(hp.coordinates, tol, factor);
      if (p) polys.push(p);
    } else if (hp.type === "MultiPolygon" && Array.isArray(hp.coordinates)) {
      for (const raw of hp.coordinates) {
        const p = cleanPolygon(raw, tol, factor);
        if (p) polys.push(p);
      }
    }
    // Kreise (ED-269 „Circle“) kommen beim BAZL nicht vor → ignoriert.
    if (polys.length === 0) continue;
    const key = [
      vol.lowerLimit, verticalRef(vol.lowerVerticalReference),
      vol.upperLimit, verticalRef(vol.upperVerticalReference),
      String(vol.uomDimensions ?? "M").toUpperCase(),
    ].join("|");
    const g = groups.get(key);
    if (g) g.polys.push(...polys);
    else groups.set(key, { vol, polys });
  }
  if (groups.size === 0) return [];

  const kind = swissRestrictionKind(zone);
  const restriction = swissRestriction(zone);
  const iso3 = String(zone.country ?? "CHE").toUpperCase();
  const country = iso3 === "LIE" || iso3 === "LI" ? "LI" : "CH";
  const enMessage = String(zone.message ?? "").trim();
  const conditionsEn = (Array.isArray(zone.restrictionConditions) ? zone.restrictionConditions : [])
    .map((c: unknown) => String(c ?? "").trim())
    .filter(Boolean);
  const deParts = [swissRestrictionMessageDe(kind)];
  if (kind === "OTHER" && conditionsEn.length > 0) deParts.push(conditionsEn.join(" "));
  if (enMessage) deParts.push(translateMessage(enMessage) ?? enMessage);
  const messageDe = deParts.filter(Boolean).join(" ");
  const messageEn = [...conditionsEn, enMessage].filter(Boolean).join(" ");
  const authorities = compactAuthority(zone.zoneAuthority);
  const reasonCodes = (Array.isArray(zone.reason) ? zone.reason : zone.reason ? [zone.reason] : [])
    .map((r: unknown) => String(r ?? "").trim())
    .filter(Boolean);
  const identifier = String(zone.identifier ?? "").trim();

  const out: SwissFeature[] = [];
  let idx = 0;
  for (const { vol, polys } of groups.values()) {
    const uom = vol.uomDimensions ?? "M";
    const lowerMeters = swissLimitMeters(vol.lowerLimit, uom) ?? 0;
    const upperMeters = swissLimitMeters(vol.upperLimit, uom);
    const props: Record<string, any> = {
      identifier: groups.size > 1 ? `${identifier}#${idx + 1}` : identifier,
      name: String(zone.name ?? identifier ?? "Geozone").trim() || "Geozone",
      // ISO-2 („CH“ / „LI“) – Liechtensteiner Zonen bleiben als solche erkennbar,
      // obwohl sie im CH-Bestand (`_country: "ch"`) gespeichert werden.
      country,
      countryIso3: iso3,
      restriction,
      originalRestriction: zone.restriction ?? null,
      swissRestrictionKind: kind,
      restrictionConditions: conditionsEn,
      reason: swissReasonLabel(reasonCodes) || undefined,
      reasonCodes,
      message: messageDe,
      extendedProperties: localizedExtendedProperties(messageDe, messageEn, "en", { deLanguage: "de-CH" }),
      lowerMeters,
      lowerReference: verticalRef(vol.lowerVerticalReference),
      upperReference: verticalRef(vol.upperVerticalReference),
      applicability: swissApplicability(zone.applicability),
      source: CH_GEOZONE_SOURCE_LABEL,
    };
    if (upperMeters != null) props.upperMeters = upperMeters;
    if (kind === "PROHIBITED_OVER_250G" || kind === "PROHIBITED_OVER_250G_ABOVE_120M") {
      // Gewichtsschwelle maschinenlesbar: Drohnen bis einschließlich 250 g sind
      // von dieser Zone nicht betroffen.
      props.exemptMaxMassGrams = 250;
    }
    if (authorities.length > 0) {
      props.zoneAuthority = authorities;
      const app = applicationText(authorities);
      if (app) props.applicationText = app;
    }
    if (String(zone.regulationExemption ?? "").toUpperCase() === "YES") props.regulationExemption = "YES";
    if (zone.uSpaceClass) props.uSpaceClass = zone.uSpaceClass;
    if (zone.otherReasonInfo) props.otherReasonInfo = zone.otherReasonInfo;
    if (zone.type) props.type = zone.type;

    const geometry =
      polys.length === 1
        ? { type: "Polygon", coordinates: polys[0] }
        : { type: "MultiPolygon", coordinates: polys };
    const feature: SwissFeature = { type: "Feature", geometry, properties: props };
    const bb = computeBbox(geometry.coordinates);
    if (bb) feature.bbox = bb;
    out.push(feature);
    idx++;
  }
  return out;
}

/** Liest die Zonenliste aus dem BAZL-Dokument (`{features}` oder nacktes Array). */
export function swissEd269Zones(body: unknown): Record<string, any>[] {
  if (Array.isArray(body)) return body as Record<string, any>[];
  const f = (body as any)?.features;
  return Array.isArray(f) ? f : [];
}

/** Normalisiert alle ED-269-Zonen des BAZL-Dokuments. */
export function normalizeSwissEd269(body: unknown, opts: SwissNormalizeOptions = {}): SwissFeature[] {
  const out: SwissFeature[] = [];
  for (const z of swissEd269Zones(body)) out.push(...normalizeSwissEd269Feature(z, opts));
  return out;
}

// ---------------------------------------------------------------------------
// UAS-Aktivitätszonen (ch.bazl.uas-aktivitaetszonen, GeoJSON)
// ---------------------------------------------------------------------------

// „115m / 377ft“ → 115; „GND“ → 0; unlesbar → undefined.
export function swissActivityMeters(raw: unknown): number | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  if (/^(GND|SFC)$/i.test(s)) return 0;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*m\b/i);
  if (m) return Number(m[1].replace(",", "."));
  const ft = s.match(/(\d+(?:[.,]\d+)?)\s*ft\b/i);
  if (ft) return Math.round(parseHeight(Number(ft[1].replace(",", ".")), "ft")?.m ?? 0);
  return undefined;
}

/**
 * Normalisiert ein Feature der UAS-Aktivitätszonen. Das sind Gebiete, in denen
 * andere Drohnen (meist BVLOS, z. B. Inspektions-/Lieferflüge) aktiv sind – kein
 * Verbot, sondern ein Aufmerksamkeitshinweis → "CONDITIONAL" (gelb).
 *
 * Gültigkeit: `startdatetime`/`enddatetime` sind reine Daten (Ortszeit,
 * Ende inklusive). Wir rechnen großzügig (Beginn 00:00 MESZ = frühester
 * Zeitpunkt, Ende 23:59:59 MEZ = spätester), damit eine Zone nie zu früh
 * verschwindet. Die Tageszeiten (`validity`, z. B. „0700-1700 (LT), Mo-Fri“)
 * sind Freitext; sie werden als Text-`schedule` übernommen (Anzeige über
 * ed269ScheduleFromProps, beim Aktiv-Test gelten Text-Einträge als aktiv).
 */
export function normalizeSwissActivityFeature(
  f: Record<string, any>,
  opts: SwissNormalizeOptions = {},
): SwissFeature | null {
  if (!f || !f.geometry) return null;
  const tol = opts.simplifyToleranceDeg ?? CH_SIMPLIFY_TOLERANCE_DEG;
  const factor = Math.pow(10, opts.decimals ?? CH_COORD_DECIMALS);
  const g = f.geometry;
  const polys: number[][][][] = [];
  if (g.type === "Polygon") {
    const p = cleanPolygon(g.coordinates, tol, factor);
    if (p) polys.push(p);
  } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    for (const raw of g.coordinates) {
      const p = cleanPolygon(raw, tol, factor);
      if (p) polys.push(p);
    }
  }
  if (polys.length === 0) return null;

  const p: Record<string, any> = f.properties || {};
  const identifier = String(p.identifier ?? "").trim();
  const name = String(p.routelocation_de ?? p.routelocation_en ?? identifier ?? "").trim() || "UAS-Aktivitätszone";
  const upperAgl = swissActivityMeters(p.heightaboveground);
  const validity = String(p.validity ?? "").trim();
  const description = String(p.description ?? "").trim();

  const lines: string[] = ["UAS-Aktivitätszone: Hier sind andere Drohnen aktiv (z. B. Flüge außer Sichtweite). Besondere Aufmerksamkeit erforderlich."];
  if (description) lines.push(description);
  if (validity) lines.push(`Zeiten: ${validity}`);
  if (p.upperlimit) lines.push(`Obergrenze: ${p.upperlimit} (AMSL)`);
  if (p.existingdetectionsystems) lines.push(`Erkennungssysteme: ${p.existingdetectionsystems}`);
  if (p.coordination) lines.push(`Koordination: ${p.coordination}`);

  const applicability: Record<string, any> = { permanent: "NO" };
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const start = String(p.startdatetime ?? "").trim();
  const end = String(p.enddatetime ?? "").trim();
  if (dateRe.test(start)) applicability.startDateTime = `${start}T00:00:00+02:00`;
  else if (start) applicability.startDateTime = start;
  if (dateRe.test(end)) applicability.endDateTime = `${end}T23:59:59+01:00`;
  else if (end) applicability.endDateTime = end;
  if (validity && !/^all hours$/i.test(validity)) applicability.schedule = [validity];
  const hasWindow = !!applicability.startDateTime || !!applicability.endDateTime || !!applicability.schedule;

  const props: Record<string, any> = {
    identifier: identifier || name,
    name,
    country: "CH",
    restriction: "CONDITIONAL",
    zoneKind: "UAS_ACTIVITY",
    isActivityZone: true,
    reason: "Drohnenaktivität (BVLOS)",
    message: lines.join("\n"),
    lowerMeters: swissActivityMeters(p.lowerlimit) ?? 0,
    lowerReference: "AGL",
    upperReference: "AGL",
    applicability: [hasWindow ? applicability : { permanent: "YES" }],
    source: CH_GEOZONE_SOURCE_LABEL,
  };
  if (upperAgl != null) props.upperMeters = upperAgl;
  if (p.upperlimit) props.upperLimitAmslText = String(p.upperlimit);
  if (p.coordination) props.coordination = String(p.coordination);

  const geometry =
    polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  const feature: SwissFeature = { type: "Feature", geometry, properties: props };
  const bb = computeBbox(geometry.coordinates);
  if (bb) feature.bbox = bb;
  return feature;
}

export function normalizeSwissActivityZones(body: unknown, opts: SwissNormalizeOptions = {}): SwissFeature[] {
  const list = Array.isArray((body as any)?.features) ? (body as any).features : [];
  const out: SwissFeature[] = [];
  for (const f of list) {
    const n = normalizeSwissActivityFeature(f, opts);
    if (n) out.push(n);
  }
  return out;
}

/** Entfernt ein UTF-8-BOM am Anfang (die Aktivitätszonen-Datei beginnt mit BOM). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
