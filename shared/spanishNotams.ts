// Spanien: NOTAM für UAS (ENAIRE „NOTAM/NOTAM_UAS_APP_V3/MapServer/1“, Ebene
// „Áreas“) – Normalisierung in die ED-269-nahe Feature-Form.
//
// Grundlage: docs/enaire-es-notam-integration.md (live analysiert vom Product
// Owner, 15.11.2026) und docs/enaire-es-api-integration.md „Anhang ES (2)“.
//
//  - Ein Layer, Serie V, ein Feature je NOTAM; Schlüssel `notamId` (nie
//    OBJECTID/GFID – GFID ist hier die Quell-NOTAM-Nummer). Gleiche Geometrie
//    bei mehreren NOTAMs (z. B. LED120 ×5) → NIE über die Geometrie
//    deduplizieren.
//  - Zeit (alles UTC): itemB/itemC als Unix-ms (Rückfall itemBIcaro
//    „yyMMddhhmm“, itemBstr „dd/mm/yyyy hh:mm:ss“ – ebenfalls UTC). itemC im
//    Jahr ≥ 2049 (01.10.2050) = faktisch dauerhaft. itemB > jetzt = geplant
//    (die App graut über zoneActivityAt aus). itemD = Zeitplan innerhalb B–C
//    (parseEsNotamSchedule); unlesbar → vorsorglich im ganzen Zeitraum aktiv,
//    itemD als Text.
//  - Höhen NUR aus itemF/itemG („SFC“, „GND“, „00120M AGL“, „04300FT AMSL“,
//    „FL100“, „UNL“) über shared/heights.ts. LOWER_VAL/UPPER_VAL sind auf
//    100 ft gerundete Fußwerte ohne Bezug (00100M AMSL → 400, UNL → 99900) und
//    werden NIE für Drohnenhöhen genutzt; LOWER_VAL_AGL ist überall null.
//    AMSL-Untergrenzen: der Höhenfilter der App blendet ohne Gelände nie aus
//    (= „betrifft“).
//  - Kategorie aus qcode: R*** → RESTRICTED (PROHIBITED nur bei eindeutigem
//    Verbotstext), WULW → CONDITIONAL „UAS-Aktivität“, sonstige W*** →
//    CONDITIONAL „Warnung“. Kartenfarben wie drones.enaire.es (R rot, WULW
//    gelb, sonst orange).
//  - incidenceType: AREA DINAMICA → Name aus areaSactaName; AREA ESTATICA +
//    ACTIVA → Aktivierung des festen AIP-Gebiets `affectedElement`
//    (↔ IDENT_TXT der Ebene ZG_Restringidas, siehe esNotamStaticActivations).
//  - Kreise (37 Stützpunkte, liegen innerhalb des echten Kreises, bis ~105 m):
//    aus „RADIUS …“ + Mittelpunkt in itemE/itemQ fein neu erzeugt, sonst um
//    max(0,5 % des Radius, 150 m) radial nach außen gepuffert
//    (esNotamFixCircleGeometry, beim Abruf angewandt).
//  - Texte: DESCRIPTION (HTML) wird nicht übernommen; itemE (Whitespace
//    normalisiert), FLYING_LEVELS_DESC, itemD und die Zeiten werden selbst
//    dargestellt, icaoFormatText kommt in den Originaltext-Block.
//  - Kein Filter nach `fir` (GMMM für Melilla, LEXX Sammel-FIR).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { parseHeight, type Height } from "./heights";
import { localizedExtendedProperties, messageWithOriginal } from "./geozoneKit/messages";
import { round1 } from "./geozoneKit/text";
import { densifyCircle, destinationPointSpherical, distanceM, bearingDeg, type LonLat } from "./geozoneKit/aixm";
import { zoneActivityAt } from "./ed269Restriction";

export const ES_NOTAM_DISCLAIMER_DE = "NOTAM-Darstellung ohne Gewähr; verbindlich sind die NOTAMs/AIS von ENAIRE";
/** itemC ab diesem Jahr = faktisch dauerhaft (Doku: 01.10.2050). */
export const ES_NOTAM_PERMANENT_FROM_YEAR = 2049;
/** Höchstzahl konkreter Zeitfenster aus einem itemD (sonst: unlesbar). */
const MAX_WINDOWS = 600;

export type EsNotamCategory = "restricted" | "uas_activity" | "warning";
export type EsNotamStatus = "planned" | "active" | "scheduled_inactive" | "expired";

/** Farben wie drones.enaire.es (Kontur R rot, WULW gelb, sonst orange). */
export const ES_NOTAM_COLORS: Record<EsNotamCategory, { fill: string; stroke: string }> = {
  restricted: { fill: "rgba(255,0,0,0.16)", stroke: "rgba(255,0,0,0.95)" },
  uas_activity: { fill: "rgba(230,230,0,0.18)", stroke: "rgba(230,230,0,0.95)" },
  warning: { fill: "rgba(230,148,0,0.18)", stroke: "rgba(230,148,0,0.95)" },
};

export const ES_NOTAM_CATEGORY_LABEL_DE: Record<EsNotamCategory, string> = {
  restricted: "NOTAM – Beschränkung",
  uas_activity: "NOTAM – UAS-Aktivität",
  warning: "NOTAM – Warnung",
};

const QCODE_DE: Record<string, string> = {
  RTCA: "Temporäres Beschränkungsgebiet (TRA/TSA) aktiviert",
  RDCA: "Gefahrengebiet aktiviert",
  RACA: "Luftraumreservierung aktiviert",
  RRCA: "Beschränkungsgebiet aktiviert",
  RPCA: "Sperrgebiet aktiviert",
  WULW: "Drohnenbetrieb (UAS-Aktivität) findet statt",
  WELW: "Militärübung",
  WMLW: "Schießen (Rakete/Geschütz)",
  WPLW: "Fallschirmsprung",
  WGLW: "Segelflug",
  WLLW: "Freiballon-Aufstieg",
  WYLW: "Luftbild-/Vermessungsflug",
};

// ---------------------------------------------------------------------------
// Attribut-Zugriff (tolerant: itemB, ITEM_B, itemb …)
// ---------------------------------------------------------------------------

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function reader(props: Record<string, any> | null | undefined): (name: string) => any {
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

/** Teletype-Layout (feste Umbrüche, viele Leerzeichen) → eine Zeile. */
export function esNotamCleanText(v: unknown): string {
  return str(v)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Zeiten
// ---------------------------------------------------------------------------

/**
 * NOTAM-Zeitwert → ms (UTC). Zahl = Unix-ms (ArcGIS-GeoJSON); 10 Ziffern =
 * ICAO „yyMMddhhmm“; „dd/mm/yyyy hh:mm[:ss]“ (itemBstr, UTC!); ISO.
 */
export function esNotamTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  let m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (m) {
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24 || mi > 59) return null;
    return Date.UTC(2000 + y, mo - 1, d, h, mi);
  }
  if (/^-?\d{11,}$/.test(s)) return Number(s);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [d, mo, y, h, mi, sec] = [m[1], m[2], m[3], m[4] ?? "0", m[5] ?? "0", m[6] ?? "0"].map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return Date.UTC(y, mo - 1, d, h, mi, sec);
  }
  // ISO ohne Zeitzone ist hier UTC (alle NOTAM-Zeiten sind UTC)
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s}Z` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function firstTs(get: (n: string) => any, names: string[]): number | null {
  for (const n of names) {
    const t = esNotamTs(get(n));
    if (t != null) return t;
  }
  return null;
}

/** Beginn/Ende eines NOTAM (ms); `permanent` bei itemC ≥ 2049. */
export function esNotamValidity(props: Record<string, any>): { start: number | null; end: number | null; permanent: boolean } {
  const get = reader(props);
  const start = firstTs(get, ["itemB", "itemBIcaro", "itemBstr", "itemB_str"]);
  const endRaw = firstTs(get, ["itemC", "itemCIcaro", "itemCstr", "itemC_str"]);
  const permanent = endRaw != null && new Date(endRaw).getUTCFullYear() >= ES_NOTAM_PERMANENT_FROM_YEAR;
  return { start, end: permanent ? null : endRaw, permanent };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** „15.11.2026 18:00 UTC“ (nie Ortszeit). */
export function fmtUtcDe(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

function fmtDayDe(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.`;
}

// ---------------------------------------------------------------------------
// Zeitplan itemD
// ---------------------------------------------------------------------------

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const WEEKDAY_DE: Record<string, string> = { MON: "Mo", TUE: "Di", WED: "Mi", THU: "Do", FRI: "Fr", SAT: "Sa", SUN: "So", ANY: "täglich" };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type TimePoint = { min: number } | { event: "SR" | "SS" };
type TimeRange = { start: TimePoint; end: TimePoint };

function timePoint(s: string): TimePoint | null {
  if (s === "SR" || s === "SS") return { event: s };
  const m = s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
  // „2359“ als Ende = Tagesende (24:00)
  return { min: h === 23 && mi === 59 ? 24 * 60 : h * 60 + mi };
}

function timeRangeOf(tok: string): TimeRange | null {
  if (tok === "H24") return { start: { min: 0 }, end: { min: 24 * 60 } };
  const m = tok.match(/^(\d{4}|SR|SS)-(\d{4}|SR|SS)$/);
  if (!m) return null;
  const start = timePoint(m[1]);
  const end = timePoint(m[2]);
  if (!start || !end) return null;
  // „2359“ als Beginn bleibt 23:59
  if ("min" in start && start.min === 24 * 60) (start as { min: number }).min = 23 * 60 + 59;
  return { start, end };
}

function hhmm(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

function pointText(p: TimePoint): string {
  if ("event" in p) return p.event === "SR" ? "Sonnenaufgang" : "Sonnenuntergang";
  return hhmm(p.min);
}

function rangeText(r: TimeRange): string {
  return `${pointText(r.start)}–${pointText(r.end)}`;
}

function scheduleEntry(days: string[], r: TimeRange): Record<string, any> {
  const e: Record<string, any> = { day: days };
  if ("event" in r.start) {
    e.startTime = r.start.event;
    e.startEvent = r.start.event;
  } else e.startTime = `${hhmm(r.start.min)}Z`;
  if ("event" in r.end) {
    e.endTime = r.end.event;
    e.endEvent = r.end.event;
  } else e.endTime = `${hhmm(r.end.min)}Z`;
  return e;
}

export interface EsNotamSchedule {
  /** ED-269 applicability[] (permanent "NO"), bereits auf B–C begrenzt. */
  applicability: any[];
  /** Deutsche Kurzfassung des Zeitplans (UTC). */
  textDe: string;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/**
 * itemD → Zeitplan innerhalb B–C. Erkannt (alle Zeiten UTC):
 *  - nur Zeiten „0600-1400“, „SR-SS“, „SR-2100“, „H24“ (täglich)
 *  - Wochentage „MON-FRI 0600-1400“, „DAILY …“, mehrere Gruppen
 *  - Tage des Monats „03-05 12 17-19 24 2000-2359, 10-11 1900-2359“
 *  - Monatsnamen „NOV 02 1900-2359, NOV 03-06 0000-0600 1900-2359 …“, auch
 *    über Monats-/Jahresgrenzen (OCT→NOV→DEC→JAN)
 * Über Mitternacht reichende Blöcke („2200-0400“) werden als ein Fenster bis
 * zum Folgetag gelesen; geteilte Nachtblöcke (… 1900-2359, … 0000-0600) sind
 * einfach zwei Fenster. null = nicht sicher lesbar (Aufrufer: im ganzen
 * Zeitraum aktiv + Text).
 */
export function parseEsNotamSchedule(itemD: unknown, startTs: number | null, endTs: number | null): EsNotamSchedule | null {
  const raw = str(itemD).toUpperCase();
  if (!raw || startTs == null) return null;
  const tokens = raw
    .replace(/\.$/, "")
    .replace(/\s*,\s*/g, " , ")
    .replace(/\bAND\b/g, " , ")
    .replace(/\s*-\s*/g, "-")
    .split(/\s+/)
    .filter(Boolean);
  type Tok =
    | { k: "time"; r: TimeRange }
    | { k: "wd"; days: string[] }
    | { k: "month"; m: number }
    | { k: "day"; a: number; b: number }
    | { k: "sep" };
  const toks: Tok[] = [];
  for (const t of tokens) {
    if (t === ",") {
      toks.push({ k: "sep" });
      continue;
    }
    const r = timeRangeOf(t);
    if (r) {
      toks.push({ k: "time", r });
      continue;
    }
    if (t === "DAILY" || t === "DLY") {
      toks.push({ k: "wd", days: ["ANY"] });
      continue;
    }
    const wd = t.match(/^(MON|TUE|WED|THU|FRI|SAT|SUN)(?:-(MON|TUE|WED|THU|FRI|SAT|SUN))?$/);
    if (wd) {
      const a = WEEKDAYS.indexOf(wd[1]);
      const b = wd[2] ? WEEKDAYS.indexOf(wd[2]) : a;
      const days: string[] = [];
      for (let i = a; ; i = (i + 1) % 7) {
        days.push(WEEKDAYS[i]);
        if (i === b) break;
      }
      toks.push({ k: "wd", days });
      continue;
    }
    const mon = MONTHS.indexOf(t);
    if (mon >= 0) {
      toks.push({ k: "month", m: mon });
      continue;
    }
    const dm = t.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
    if (dm) {
      const a = Number(dm[1]);
      const b = dm[2] ? Number(dm[2]) : a;
      if (a < 1 || a > 31 || b < 1 || b > 31) return null;
      toks.push({ k: "day", a, b });
      continue;
    }
    return null; // EXC, SR MINUS30, Freitext … → nicht sicher lesbar
  }
  const hasWd = toks.some((t) => t.k === "wd");
  const hasDate = toks.some((t) => t.k === "day" || t.k === "month");
  if (hasWd && hasDate) return null;
  if (!toks.some((t) => t.k === "time") && !hasDate) return null;

  const endLimit = endTs ?? Number.POSITIVE_INFINITY;

  if (!hasDate) {
    // Wochentage bzw. täglich: ein applicability-Eintrag mit Zeitplan
    const groups: { days: string[]; times: TimeRange[] }[] = [];
    let days: string[] = [];
    let times: TimeRange[] = [];
    const flush = () => {
      if (times.length === 0) return;
      const d = days.length > 0 ? days : groups.length > 0 ? groups[groups.length - 1].days : ["ANY"];
      groups.push({ days: d, times });
      days = [];
      times = [];
    };
    for (const t of toks) {
      if (t.k === "wd") {
        if (times.length > 0) flush();
        for (const d of t.days) if (!days.includes(d)) days.push(d);
      } else if (t.k === "time") times.push(t.r);
      else if (t.k === "sep") flush();
    }
    if (days.length > 0 && times.length === 0) times.push({ start: { min: 0 }, end: { min: 24 * 60 } });
    flush();
    if (groups.length === 0) return null;
    const schedule = groups.flatMap((g) => g.times.map((r) => scheduleEntry(g.days, r)));
    const entry: Record<string, any> = { permanent: "NO", startDateTime: new Date(startTs).toISOString(), schedule };
    if (endTs != null) entry.endDateTime = new Date(endTs).toISOString();
    const textDe = groups
      .map((g) => {
        const d = g.days.includes("ANY") ? "täglich" : dayListDe(g.days);
        return `${d} ${g.times.map(rangeText).join(", ")}`;
      })
      .join("; ");
    return { applicability: [entry], textDe: `${textDe} UTC` };
  }

  // Tage des Monats (ggf. mit Monatsnamen): konkrete Fenster je Tag
  const b0 = new Date(startTs);
  let cy = b0.getUTCFullYear();
  let cm = b0.getUTCMonth();
  let lastDay = 0;
  let pendingDates: number[] = []; // Tagesbeginn (ms) der aktuellen Gruppe
  let groupTimes: TimeRange[] = [];
  let prevDates: number[] = [];
  const out: any[] = [];
  const textParts: string[] = [];
  let bad = false;
  const advance = () => {
    cm += 1;
    if (cm > 11) {
      cm = 0;
      cy += 1;
    }
  };
  let explicitMonth = false;
  const bDay = b0.getUTCDate();
  const addDay = (d: number) => {
    if (explicitMonth) {
      // nach Monatsnamen: fortlaufend, kleinerer Tag = Folgemonat
      if (d < lastDay) advance();
    } else {
      // ohne Monatsnamen: erster passender Tag ab B (B-Monat, sonst Folgemonat);
      // Gruppen nach einem Komma beginnen wieder bei B („…, 10-11 1900-2359“)
      cy = b0.getUTCFullYear();
      cm = b0.getUTCMonth();
      if (d < bDay) advance();
    }
    lastDay = d;
    if (d > daysInMonth(cy, cm)) {
      bad = true;
      return;
    }
    pendingDates.push(Date.UTC(cy, cm, d));
  };
  const flush = () => {
    if (groupTimes.length === 0) return;
    const dates = pendingDates.length > 0 ? pendingDates : prevDates;
    if (dates.length === 0) {
      bad = true;
      return;
    }
    for (const day of dates) {
      for (const r of groupTimes) {
        if ("min" in r.start && "min" in r.end) {
          let s = day + r.start.min * 60_000;
          let e = day + r.end.min * 60_000;
          if (e <= s) e += 86_400_000; // über Mitternacht
          // Plausibilität: Fenster muss den Zeitraum B–C (± 1 Tag) treffen
          if (e < startTs - 86_400_000 || s > endLimit + 86_400_000) {
            bad = true;
            return;
          }
          s = Math.max(s, startTs);
          e = Math.min(e, endLimit);
          if (e > s) out.push({ permanent: "NO", startDateTime: new Date(s).toISOString(), endDateTime: new Date(e).toISOString() });
        } else {
          // Sonnenereignis: Tagesfenster mit SR/SS-Zeitplan (zoneActivityAt rechnet je Ort)
          const s = Math.max(day, startTs);
          const e = Math.min(day + 86_400_000, endLimit);
          if (day + 86_400_000 < startTs - 86_400_000 || day > endLimit + 86_400_000) {
            bad = true;
            return;
          }
          if (e > s) out.push({ permanent: "NO", startDateTime: new Date(s).toISOString(), endDateTime: new Date(e).toISOString(), schedule: [scheduleEntry(["ANY"], r)] });
        }
      }
    }
    textParts.push(`${dates.map(fmtDayDe).join(", ")} ${groupTimes.map(rangeText).join(", ")}`);
    prevDates = dates;
    pendingDates = [];
    groupTimes = [];
  };
  for (const t of toks) {
    if (bad) return null;
    if (t.k === "month") {
      if (groupTimes.length > 0) flush();
      let y = cy;
      if (t.m < cm) y += 1; // Jahreswechsel (DEC → JAN)
      cy = y;
      cm = t.m;
      lastDay = 0;
      explicitMonth = true;
    } else if (t.k === "day") {
      if (groupTimes.length > 0) flush();
      if (t.b >= t.a) for (let d = t.a; d <= t.b; d++) addDay(d);
      else {
        for (let d = t.a; d <= daysInMonth(cy, cm); d++) addDay(d);
        for (let d = 1; d <= t.b; d++) addDay(d);
      }
    } else if (t.k === "time") groupTimes.push(t.r);
    else if (t.k === "sep") flush();
  }
  if (pendingDates.length > 0 && groupTimes.length === 0) groupTimes.push({ start: { min: 0 }, end: { min: 24 * 60 } });
  flush();
  if (bad || out.length === 0 || out.length > MAX_WINDOWS) return null;
  return { applicability: out, textDe: `${textParts.join("; ")} UTC` };
}

function dayListDe(days: string[]): string {
  const idx = days.map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0);
  const contiguous = idx.length > 2 && idx.every((v, i) => i === 0 || v === (idx[i - 1] + 1) % 7);
  if (contiguous) return `${WEEKDAY_DE[days[0]]}–${WEEKDAY_DE[days[days.length - 1]]}`;
  return days.map((d) => WEEKDAY_DE[d] ?? d).join(", ");
}

// ---------------------------------------------------------------------------
// Höhen (nur itemF/itemG)
// ---------------------------------------------------------------------------

/** itemF/itemG-Text → Height („00120M AGL“, „04300FT AMSL“, „FL 100“, „SFC“, „UNL“). */
export function parseEsNotamHeight(raw: unknown): Height | null {
  const s = str(raw).toUpperCase().replace(/\s+/g, " ");
  if (!s) return null;
  return parseHeight(s.replace(/^FL\s+/, "FL"));
}

function heightTextDe(h: Height | null, side: "lower" | "upper"): string {
  if (!h) return side === "lower" ? "GND" : "keine Angabe";
  if (h.m == null) return h.text === "GND" ? "GND" : "unbegrenzt";
  if (h.unit === "FL") return `${h.text} (≈ ${Math.round(h.m)} m AMSL, Druckhöhe)`;
  if (h.unit === "ft") return `${h.text} (${Math.round(h.m)} m)`;
  return h.text;
}

function applyHeights(props: Record<string, any>, lower: Height | null, upper: Height | null): void {
  if (lower && lower.m != null) {
    props.lowerMeters = round1(lower.m);
    props.lowerReference = lower.ref;
  } else {
    props.lowerMeters = 0;
    props.lowerReference = "AGL";
  }
  if (upper && upper.m != null) {
    props.upperMeters = round1(upper.m);
    props.upperReference = upper.ref;
  }
  props.altitudeText = `${lower?.text || "GND"} – ${upper?.text || "UNL"}`;
}

// ---------------------------------------------------------------------------
// Kategorie
// ---------------------------------------------------------------------------

export function esNotamCategory(qcode: unknown): EsNotamCategory {
  const q = str(qcode).toUpperCase().replace(/^Q/, "");
  if (q === "WULW") return "uas_activity";
  if (q.startsWith("W")) return "warning";
  return "restricted"; // R*** und unbekannt (vorsichtig)
}

const PROHIBIT_RE =
  /\b(?:FLT|FLTS|FLIGHTS?|OPS|OPERATIONS?|ACTIVIT(?:Y|IES))\s+(?:ARE\s+|IS\s+)?(?:PROHIBITED|FORBIDDEN|NOT\s+(?:ALLOWED|PERMITTED))\b|\bPROHIBID[OA]S?\b/;

/** Kategorie → App-Beschränkung (PROHIBITED nur bei eindeutigem Verbotstext). */
export function esNotamRestriction(category: EsNotamCategory, itemE: string): string {
  if (category !== "restricted") return "CONDITIONAL";
  return PROHIBIT_RE.test(itemE.toUpperCase()) ? "PROHIBITED" : "RESTRICTED";
}

// ---------------------------------------------------------------------------
// Kreise: 37 Stützpunkte → fein neu erzeugen bzw. puffern
// ---------------------------------------------------------------------------

/** „403012N0034512W“ / „4030N00345W“ → [lon, lat]; null ohne Treffer. */
export function esNotamCoord(text: string): LonLat | null {
  const m = text.match(/(\d{2})(\d{2})(\d{2}(?:[.,]\d+)?)?\s?([NS])\s?(\d{3})(\d{2})(\d{2}(?:[.,]\d+)?)?\s?([EW])/);
  if (!m) return null;
  const lat = Number(m[1]) + Number(m[2]) / 60 + Number((m[3] ?? "0").replace(",", ".")) / 3600;
  const lon = Number(m[5]) + Number(m[6]) / 60 + Number((m[7] ?? "0").replace(",", ".")) / 3600;
  return [m[8] === "W" ? -lon : lon, m[4] === "S" ? -lat : lat];
}

/** „RADIUS 5NM“, „RADIUS OF 2KM“, „2NM RADIUS“ → Meter; null ohne Treffer. */
export function esNotamRadiusM(text: string): number | null {
  const m =
    text.match(/RADIUS(?:\s+OF)?\s+(\d+(?:[.,]\d+)?)\s?(NM|KM|M)\b/) ?? text.match(/\b(\d+(?:[.,]\d+)?)\s?(NM|KM|M)\s+RADIUS\b/);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  return m[2] === "NM" ? v * 1852 : m[2] === "KM" ? v * 1000 : v;
}

/** Kreisartiger Ring (≥ 30 Stützpunkte, gleicher Abstand zum Mittel ±2 %) → Mitte/Radius. */
function circleOfRing(ring: number[][]): { center: LonLat; radius: number } | null {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length < 30) return null;
  const center: LonLat = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  const d = pts.map((p) => distanceM(center, [p[0], p[1]]));
  const mean = d.reduce((a, x) => a + x, 0) / d.length;
  if (!(mean > 0) || d.some((x) => Math.abs(x - mean) / mean > 0.02)) return null;
  return { center, radius: mean };
}

/** Ring gegen den Uhrzeigersinn (RFC 7946) aus einem Kreis. */
function ccwCircle(center: LonLat, radius: number): number[][] {
  return densifyCircle(center, radius, 2).reverse();
}

/** Ringe radial um max(0,5 % r, 150 m) nach außen schieben (deckt die Sehnen ab). */
function bufferedCircleRing(ring: number[][], c: { center: LonLat; radius: number }): number[][] {
  const buf = Math.max(0.005 * c.radius, 150);
  return ring.map((p) => {
    const d = distanceM(c.center, [p[0], p[1]]);
    // Kugel durchgehend (Abstand/Peilung/Zielpunkt), damit der Puffer exakt bleibt
    return destinationPointSpherical(c.center, d + buf, bearingDeg(c.center, [p[0], p[1]]));
  });
}

/**
 * NOTAM-Kreise korrigieren: Mittelpunkt + Radius aus itemE/itemQ stimmen mit
 * dem Polygon überein → feiner Neuaufbau (2°-Schritte); sonst Puffer
 * max(0,5 % r, 150 m). Andere Polygone (Dreiecke, Vielecke) bleiben
 * unverändert; MultiPolygon je Teilfläche (nur Puffer).
 */
export function esNotamFixCircleGeometry(
  geometry: { type: string; coordinates: any },
  texts: string[],
): { geometry: { type: string; coordinates: any }; circle?: "rebuilt" | "buffered" } {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return { geometry };
  const text = texts.map((t) => str(t).toUpperCase()).join(" \n ");
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates?.[0];
    if (!Array.isArray(ring) || (geometry.coordinates?.length ?? 0) !== 1) return { geometry };
    const c = circleOfRing(ring);
    if (!c) return { geometry };
    const r = esNotamRadiusM(text);
    const center = esNotamCoord(text.slice(Math.max(0, text.search(/RADIUS|CENT|PSN/)))) ?? esNotamCoord(text);
    if (r != null && center && Math.abs(r - c.radius) / c.radius <= 0.03 && distanceM(center, c.center) <= Math.max(0.01 * r, 200)) {
      return { geometry: { type: "Polygon", coordinates: [ccwCircle(center, r)] }, circle: "rebuilt" };
    }
    return { geometry: { type: "Polygon", coordinates: [bufferedCircleRing(ring, c)] }, circle: "buffered" };
  }
  let changed = false;
  const polys = (geometry.coordinates as number[][][][]).map((poly) => {
    if (!Array.isArray(poly) || poly.length !== 1) return poly;
    const c = circleOfRing(poly[0]);
    if (!c) return poly;
    changed = true;
    return [bufferedCircleRing(poly[0], c)];
  });
  return changed ? { geometry: { type: "MultiPolygon", coordinates: polys }, circle: "buffered" } : { geometry };
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

export type EsNotamFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: any };
  properties: Record<string, any>;
};

/** Stabiler Schlüssel eines NOTAM-Rohfeatures (notamId); null ohne Kennung. */
export function esNotamKey(props: Record<string, any> | null | undefined): string | null {
  const id = str(reader(props)("notamId"));
  return id || null;
}

function sunRing(geometry: { type: string; coordinates: any }): [number, number][] | undefined {
  const ring = geometry.type === "Polygon" ? geometry.coordinates?.[0] : geometry.coordinates?.[0]?.[0];
  return Array.isArray(ring) ? ring.map((p: number[]) => [p[1], p[0]] as [number, number]) : undefined;
}

export interface EsNotamContext {
  now?: Date;
  /** Attribution/Quelle (aus shared/spanishGeozones.ts). */
  sourceLabel: string;
  attribution: string;
  layerKey: string;
}

/**
 * Ein NOTAM-Rohfeature → App-Feature. null: keine Fläche oder abgelaufen
 * (itemC < jetzt).
 */
export function normalizeEsNotamFeature(f: any, ctx: EsNotamContext): EsNotamFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  const now = ctx.now ?? new Date();
  const nowTs = now.getTime();
  const props = f.properties || {};
  const get = reader(props);
  const { start, end, permanent } = esNotamValidity(props);
  if (end != null && end < nowTs) return null;

  const notamId = str(get("notamId")) || str(f.id).replace(/^es_notam\./, "") || "?";
  const qcode = str(get("qcode")).toUpperCase();
  const category = esNotamCategory(qcode);
  const itemE = esNotamCleanText(get("itemE"));
  const restriction = esNotamRestriction(category, itemE);
  const incidence = str(get("incidenceType")).toUpperCase();
  const qualifier = str(get("incidenceQualifier")).toUpperCase();
  const affected = str(get("affectedElement"));
  const sacta = esNotamCleanText(get("areaSactaName"));
  const isStatic = /ESTATICA|ESTÁTICA/.test(incidence) && /ACTIVA/.test(qualifier) && !!affected && !/^DIN/i.test(affected);

  const itemD = esNotamCleanText(get("itemD"));
  const sched = itemD ? parseEsNotamSchedule(itemD, start, end) : null;
  let applicability: any[] | undefined;
  if (sched) applicability = sched.applicability;
  else if (start != null || end != null) {
    const e: Record<string, any> = { permanent: "NO" };
    if (start != null) e.startDateTime = new Date(start).toISOString();
    if (end != null) e.endDateTime = new Date(end).toISOString();
    applicability = [e];
  }

  const ring = sunRing(g);
  const activity = zoneActivityAt(
    { validStartTs: start, validEndTs: end, ed269Applicability: applicability, ...(ring ? { polygonRings: [ring] } : {}) },
    now,
  );
  const status: EsNotamStatus = start != null && start > nowTs ? "planned" : activity === "inactive" ? "scheduled_inactive" : "active";

  const lower = parseEsNotamHeight(get("itemF"));
  const upper = parseEsNotamHeight(get("itemG"));
  const levels = esNotamCleanText(get("FLYING_LEVELS_DESC")) || [str(get("itemF")), str(get("itemG"))].filter(Boolean).join(" / ");

  const name = isStatic
    ? `${affected} – Aktivierung per NOTAM ${notamId}`
    : `${sacta || (affected && !/^DIN/i.test(affected) ? affected : "") || "NOTAM-Gebiet"} (NOTAM ${notamId})`;

  const lines: string[] = [];
  const qDe = QCODE_DE[qcode] ?? (qcode ? `Q-Code ${qcode}` : "ohne Q-Code");
  lines.push(`NOTAM ${notamId} (ENAIRE, Drohnen-Serie V) – ${ES_NOTAM_CATEGORY_LABEL_DE[category].replace("NOTAM – ", "")}: ${qDe}${qcode && QCODE_DE[qcode] ? ` (${qcode})` : ""}.`);
  if (restriction === "PROHIBITED") lines.push("Flugverbot für UAS laut NOTAM-Text.");
  else if (restriction === "RESTRICTED") lines.push("Beschränkungsgebiet: Einflug nur mit Freigabe – NOTAM-Text beachten.");
  else if (category === "uas_activity") lines.push("Hinweis: Drohnenbetrieb im Gebiet – Auflagen im NOTAM-Text beachten.");
  else lines.push("Warnung: Aktivität im Luftraum – Vorsicht, Auflagen im NOTAM-Text beachten.");
  if (isStatic) {
    lines.push(
      status === "planned" && start != null
        ? `Zone ${affected} wird per NOTAM aktiviert (ab ${fmtUtcDe(start)}).`
        : status === "scheduled_inactive"
          ? `Zone ${affected} ist per NOTAM aktiviert – derzeit laut Zeitplan nicht aktiv.`
          : `Zone ${affected} ist jetzt aktiv (Aktivierung des festen AIP-Gebiets per NOTAM).`,
    );
  }
  if (status === "planned" && start != null) lines.push(`Status: geplant – gilt ab ${fmtUtcDe(start)}.`);
  else if (status === "scheduled_inactive") lines.push(`Status (${fmtUtcDe(nowTs)}): gültig, derzeit laut Zeitplan nicht aktiv.`);
  else lines.push(`Status (${fmtUtcDe(nowTs)}): aktiv.`);
  lines.push(
    `Gültig: ${start != null ? fmtUtcDe(start) : "offen"} bis ${permanent ? "auf Weiteres (Ende 2050 = faktisch dauerhaft)" : end != null ? fmtUtcDe(end) : "offen"}.`,
  );
  if (itemD) {
    lines.push(
      sched
        ? `Zeitplan (UTC): ${sched.textDe} – laut NOTAM: ${itemD}.`
        : `Zeitplan laut NOTAM (UTC): ${itemD} – nicht maschinenlesbar, die Zone gilt vorsorglich im ganzen Gültigkeitszeitraum.`,
    );
  }
  lines.push(`Höhe laut NOTAM: ${heightTextDe(lower, "lower")} bis ${heightTextDe(upper, "upper")}${levels ? ` (${levels})` : ""}.`);
  if (lower && lower.ref === "MSL" && (lower.m ?? 0) > 0) {
    lines.push("Untergrenze über Meeresspiegel – ohne Geländehöhe vorsorglich als „betrifft den Flug“ gewertet.");
  }
  if (itemE) lines.push(`NOTAM-Text (E): ${itemE}`);
  const itemA = esNotamCleanText(get("itemA"));
  const fir = str(get("fir"));
  if (itemA || fir) lines.push(`Ort (A): ${itemA || "–"}${fir ? ` · FIR ${fir}` : ""}`);
  const tps = [str(get("traffic")), str(get("purpose")), str(get("scope"))];
  if (tps.some(Boolean)) lines.push(`Verkehr/Zweck/Geltung (Q-Zeile): ${tps.map((x) => x || "–").join(" / ")}`);
  const src = str(get("sourceInformationNotam"));
  if (src) lines.push(`Quell-NOTAM: ${src}`);
  lines.push(`Hinweis: ${ES_NOTAM_DISCLAIMER_DE}.`);
  const original = str(get("icaoFormatText")).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
  const message = messageWithOriginal(lines, original || null);

  const out: Record<string, any> = {
    identifier: notamId,
    zoneId: `ES-NOTAM-${notamId}`,
    name,
    restriction,
    originalType: qcode || null,
    message,
    extendedProperties: localizedExtendedProperties(message, original || null, "en"),
    country: "ESP",
    source: ctx.sourceLabel,
    attribution: ctx.attribution,
    sourceLayer: ctx.layerKey,
    esLayerKey: ctx.layerKey,
    esLayerLabel: ES_NOTAM_CATEGORY_LABEL_DE[category],
    legalBasis: "NOTAM (ENAIRE AIS, Serie V)",
    isNotam: true,
    _notamEligible: true,
    notamCategory: category,
    esNotamStatus: status,
    esNotamSchedule: itemD || undefined,
    esNotamScheduleParsed: itemD ? !!sched : undefined,
    esStaticArea: isStatic ? affected : undefined,
    sourceNotam: src || undefined,
    fir: fir || undefined,
    validStartTs: start ?? undefined,
    validEndTs: end ?? undefined,
  };
  if (applicability) out.applicability = applicability;
  applyHeights(out, lower, upper);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { type: "Feature", geometry: { type: g.type, coordinates: g.coordinates }, properties: out };
}

// ---------------------------------------------------------------------------
// Statische Aktivierungen ↔ ZG_Restringidas (IDENT_TXT)
// ---------------------------------------------------------------------------

export interface EsStaticActivation {
  notamId: string;
  status: EsNotamStatus;
  /** Anzeigezeile für die feste Zone. */
  line: string;
}

/**
 * NOTAM-Features (normalisiert) → Aktivierungen je Gebietskennung
 * (affectedElement, groß geschrieben). Nur AREA ESTATICA + ACTIVA.
 */
export function esNotamStaticActivations(normalized: EsNotamFeature[]): Map<string, EsStaticActivation[]> {
  const map = new Map<string, EsStaticActivation[]>();
  for (const f of normalized) {
    const p = f?.properties;
    const ident = str(p?.esStaticArea).toUpperCase();
    if (!ident) continue;
    const status = p.esNotamStatus as EsNotamStatus;
    const when =
      status === "planned" && p.validStartTs != null
        ? `wird aktiviert ab ${fmtUtcDe(p.validStartTs)}`
        : status === "scheduled_inactive"
          ? "ist aktiviert, derzeit laut Zeitplan nicht aktiv"
          : "ist jetzt aktiv";
    const parts = [`Höhe ${p.altitudeText}`];
    if (p.validStartTs != null || p.validEndTs != null) {
      parts.push(`gültig ${p.validStartTs != null ? fmtUtcDe(p.validStartTs) : "offen"} bis ${p.validEndTs != null ? fmtUtcDe(p.validEndTs) : "auf Weiteres"}`);
    }
    if (p.esNotamSchedule) parts.push(`Zeitplan ${p.esNotamSchedule}`);
    const line = `NOTAM ${p.identifier}: Zone ${ident} ${when} (${parts.join(", ")}).`;
    const list = map.get(ident) ?? [];
    list.push({ notamId: String(p.identifier), status, line });
    map.set(ident, list);
  }
  return map;
}
