// Gültigkeit belgischer Veranstaltungs-Sperrzonen (TEMPORARY-NO-FLY-ZONE).
//
// Droneguide (geo_zone_fast) und die skeyes-Live-API führen Event-Zonen wie
// „Tomorrowland 2026“ oder „Gentse Feesten 2026“ ohne Start/Ende (skeyes:
// applicability permanent: YES) – auch Monate nach der Veranstaltung. Die
// einzige belastbare Quelle der Gültigkeit ist Droneguides WFS-Layer
// `uaszone` mit Zeitfenster (viewparams window_start/window_end): er liefert
// nur Zonen, deren Gültigkeit das Fenster berührt. Fenster [jetzt, +10 Jahre]
// ⇒ fehlt eine Event-Zone, ist sie nachweislich vorbei.
//
// Zusätzlich (auch offline, beim Lesen älterer Gerätespeicher):
//  - Datumsangaben im Namen/Text („21 July 2026“, „18/07/2025 - 27/07/2025“):
//    Ende vorbei → verwerfen, sonst Gültigkeit setzen;
//  - ausdrückliche Jahresangabe („Marathon 2025“, Code „G25-195“), die vor
//    dem laufenden Jahr liegt → verwerfen (sofern Droneguide die Zone nicht
//    beim letzten Abruf als weiterhin gültig bestätigt hat).
// Nur Event-Zonen (Typ TEMPORARY-NO-FLY-ZONE) – dauerhafte Zonen (Flugplätze,
// CTR, Militär, Natur, …) bleiben immer unangetastet.
//
// Reines Modul (kein React Native).

export const BE_EVENT_ZONE_TYPE = "TEMPORARY-NO-FLY-ZONE";
/** Markierung: beim letzten Abruf von Droneguide als (weiter) gültig bestätigt. */
export const DRONEGUIDE_WINDOW_VALID_FLAG = "_droneguideWindowValid";

const DAY_MS = 86_400_000;
// Belgien liegt bei UTC+1/+2: Tagesbeginn großzügig 2 h früher, Tagesende =
// Mitternacht UTC des Folgetags (später als Brüsseler Mitternacht → konservativ).
const DAY_START_MARGIN_MS = 2 * 3600_000;

type Props = Record<string, any>;

export function isBelgianEventZone(p: Props | null | undefined): boolean {
  if (!p) return false;
  const t = String(p.type ?? p.type_code ?? p.otherReasonInfo ?? "").toUpperCase().trim();
  return t === BE_EVENT_ZONE_TYPE;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, janvier: 0, januari: 0, januar: 0, janv: 0,
  feb: 1, february: 1, fevrier: 1, février: 1, februari: 1, februar: 1, fev: 1, fév: 1, févr: 1,
  mar: 2, march: 2, mars: 2, maart: 2, märz: 2, maerz: 2,
  apr: 3, april: 3, avril: 3, avr: 3,
  may: 4, mai: 4, mei: 4,
  jun: 5, june: 5, juin: 5, juni: 5,
  jul: 6, july: 6, juillet: 6, juli: 6, juil: 6,
  aug: 7, august: 7, aout: 7, août: 7, augustus: 7,
  sep: 8, sept: 8, september: 8, septembre: 8,
  oct: 9, october: 9, octobre: 9, oktober: 9, okt: 9,
  nov: 10, november: 10, novembre: 10,
  dec: 11, december: 11, decembre: 11, décembre: 11, dezember: 11, dez: 11, déc: 11,
};

function validDay(y: number, m: number, d: number): number | null {
  if (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const ts = Date.UTC(y, m, d);
  const dt = new Date(ts);
  return dt.getUTCMonth() === m && dt.getUTCDate() === d ? ts : null;
}

/** Alle Kalendertage (UTC-Mitternacht) aus einem Text. */
export function datesInText(text: string): number[] {
  const out: number[] = [];
  const s = String(text ?? "");
  // 18/07/2025, 18.07.2025, 18-07-2025
  for (const m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/g)) {
    const ts = validDay(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (ts != null) out.push(ts);
  }
  // 2025-07-18
  for (const m of s.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const ts = validDay(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (ts != null) out.push(ts);
  }
  // 21 July 2026, 21 juillet 2026, 1er mai 2026
  for (const m of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th|er|e)?\.?\s+([A-Za-zÀ-ÿ]{3,10})\.?\s+(20\d{2})\b/g)) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon == null) continue;
    const ts = validDay(Number(m[3]), mon, Number(m[1]));
    if (ts != null) out.push(ts);
  }
  // July 21, 2026
  for (const m of s.matchAll(/\b([A-Za-zÀ-ÿ]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/g)) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon == null) continue;
    const ts = validDay(Number(m[3]), mon, Number(m[2]));
    if (ts != null) out.push(ts);
  }
  return out;
}

/** Höchste ausdrückliche Jahreszahl aus Name/Code (z. B. „Marathon 2025“, „G25-195“). */
export function eventYearFromProps(p: Props): number | null {
  let best: number | null = null;
  const take = (y: number) => {
    if (y >= 2000 && y <= 2100 && (best == null || y > best)) best = y;
  };
  for (const v of [p.name, p.code]) {
    const s = String(v ?? "");
    for (const m of s.matchAll(/(?:^|[^\d])(20\d{2})(?!\d)/g)) take(Number(m[1]));
  }
  // skeyes-Referenzen der Event-Zonen: G<JJ><nnn> bzw. G<JJ>-<nnn> (+ Suffix)
  const code = String(p.code ?? "").trim();
  const m = code.match(/^G(\d{2})(?:-|[A-Z])?\d{2,3}[A-Za-z]?$/i);
  if (m) take(2000 + Number(m[1]));
  return best;
}

function textOf(p: Props): string {
  return [p.name, p.description, p.message].filter((v) => v != null).map(String).join("\n");
}

export type EventVerdict =
  | { action: "keep" }
  | { action: "drop"; reason: string }
  | { action: "date"; validStartTs: number; validEndTs: number };

/** Entscheidung für eine Zone (nur Event-Zonen werden je verworfen/datiert). */
export function belgianEventVerdict(p: Props | null | undefined, nowMs: number = Date.now()): EventVerdict {
  if (!p || !isBelgianEventZone(p)) return { action: "keep" };
  const srcEnd = Number(p.validEndTs);
  if (p.validEndTs != null && Number.isFinite(srcEnd)) {
    // Quelle ist datiert – deren Gültigkeit gilt (Ablauf regelt zoneEndedLongAgo)
    return { action: "keep" };
  }
  const days = datesInText(textOf(p));
  if (days.length > 0) {
    const start = Math.min(...days) - DAY_START_MARGIN_MS;
    const end = Math.max(...days) + DAY_MS;
    if (end < nowMs) return { action: "drop", reason: "Datum im Text vorbei" };
    return { action: "date", validStartTs: start, validEndTs: end };
  }
  if (p[DRONEGUIDE_WINDOW_VALID_FLAG] === true) return { action: "keep" };
  const year = eventYearFromProps(p);
  // Kleine Kulanz über den Jahreswechsel (Silvester-Veranstaltungen)
  if (year != null && nowMs >= Date.UTC(year + 1, 0, 8)) {
    return { action: "drop", reason: `Veranstaltungsjahr ${year} vorbei` };
  }
  return { action: "keep" };
}

interface FeatureLike {
  properties?: Props | null;
  [k: string]: any;
}

/** Wendet belgianEventVerdict auf eine Feature-Liste an (Kopien, keine Mutation). */
export function applyBelgianEventValidity<T extends FeatureLike>(features: T[], nowMs: number = Date.now()): T[] {
  const out: T[] = [];
  for (const f of features || []) {
    const v = belgianEventVerdict(f?.properties, nowMs);
    if (v.action === "drop") continue;
    if (v.action === "date") {
      out.push({ ...f, properties: { ...(f.properties || {}), validStartTs: v.validStartTs, validEndTs: v.validEndTs } });
      continue;
    }
    out.push(f);
  }
  return out;
}

interface ZoneRef {
  id?: string | null;
  code?: string | null;
}

/**
 * Abgleich mit Droneguides Zeitfenster-Abfrage (uaszone, Fenster ab jetzt):
 * Event-Zonen des Bestands, die dort fehlen, sind vorbei → verwerfen
 * (auch die gleichnamige skeyes-Live-Zone, Abgleich über den Code). Im
 * Fenster enthaltene erhalten die Markierung DRONEGUIDE_WINDOW_VALID_FLAG.
 * `allEvents` = alle Event-Zonen aus geo_zone_fast (ohne Fenster).
 */
export function applyDroneguideEventWindow<T extends FeatureLike>(
  features: T[],
  allEvents: ZoneRef[],
  validEvents: ZoneRef[],
): T[] {
  const norm = (v: unknown) => String(v ?? "").trim();
  const validIds = new Set(validEvents.map((z) => norm(z.id)).filter(Boolean));
  const validCodes = new Set(validEvents.map((z) => norm(z.code)).filter(Boolean));
  const expiredIds = new Set<string>();
  const expiredCodes = new Set<string>();
  for (const z of allEvents) {
    const id = norm(z.id);
    if (!id || validIds.has(id)) continue;
    expiredIds.add(id);
    const code = norm(z.code);
    // Mehrdeutige Codes (z. B. „Temporary“ bei gültigen UND abgelaufenen) nicht nutzen
    if (code && !validCodes.has(code)) expiredCodes.add(code);
  }
  const out: T[] = [];
  for (const f of features || []) {
    const p = f?.properties || {};
    if (!isBelgianEventZone(p)) {
      out.push(f);
      continue;
    }
    const id = norm(p.uniqueIdentifier ?? p.unique_identifier);
    const code = norm(p.code);
    if (expiredIds.has(id) || (code && expiredCodes.has(code) && !validIds.has(id))) continue;
    if (validIds.has(id) || (code && validCodes.has(code))) {
      out.push({ ...f, properties: { ...p, [DRONEGUIDE_WINDOW_VALID_FLAG]: true } });
      continue;
    }
    out.push(f);
  }
  return out;
}
