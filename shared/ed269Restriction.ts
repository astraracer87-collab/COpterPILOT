// Reine, von React Native / Express unabhängige ED-269-Hilfslogik:
// Beschränkungs-Normalisierung, Anzeigefarben, Beschränkungs-Extraktion aus den
// uneinheitlichen Anbieter-Properties sowie die Gültigkeits-Zeitfenster. Liegt
// in shared/, damit sowohl der Client (Vektor-Polygone, Popups) als auch der
// Server (Rasterisierung der Geozonen-Kacheln) GENAU dieselbe Klassifizierung
// und dieselben Farben verwenden — keine Drift zwischen Mobile-Polygon und
// serverseitig gerenderter Kachel.

import { calculateSolarTimes } from "./solar";

// Beschränkungs-Normalisierung und Farben kommen aus der EINEN Policy-Tabelle
// (shared/restrictionPolicy.ts). Die ED-269-Namen bleiben als dünne Aliase
// erhalten, damit bestehende Importpfade stabil bleiben.
import { normalizeRestriction, restrictionColors, type Restriction } from "./restrictionPolicy";
import { getOwnGeozoneSourceMeta } from "./geozoneSourceMeta";

/** Normalisiert jede ED-269-/ED-318-/Anbieter-Schreibweise (REQ_AUTH,
 * REQ_AUTHORIZATION, INFORMATION, { type } …) auf die geschlossene Union;
 * leer/unbekannt → "UNKNOWN". */
export function normalizeEd269Restriction(raw: unknown): Restriction {
  return normalizeRestriction(raw);
}

/** Anzeigefarbe (rgba) einer Einstufung – aus RESTRICTION_POLICY. */
export function ed269RestrictionColors(restriction: unknown): { fill: string; stroke: string } {
  return restrictionColors(restriction);
}

// Extrahiert die normalisierte Beschränkung aus den ED-269-Properties. Belgien
// (skeyes) liefert restriction als Objekt { type: "PROHIBITED" }; AT/DK liefern
// einen String. Beide Formen unterstützen (identisch zur Client-Parselogik in
// client/lib/ed269.ts parseEd269ToGeozoneInfo).
export function ed269RestrictionForProps(p: Record<string, any>): Restriction {
  const restrictionRaw =
    p?.restriction && typeof p.restriction === "object"
      ? (p.restriction as any).type
      : p?.restriction;
  return normalizeEd269Restriction((restrictionRaw ?? p?.type ?? p?.zoneRestriction ?? "").toString());
}

/**
 * Austro Control's published ED-269 feed currently gives MATZ/MCTR zones an
 * applicability window ending at 2100-12-31, with permanent="NO" and no
 * schedule. The official Dronespace zone information directs pilots to the
 * AIP for actual operating hours; this far-future interval is not an expiry
 * date for the zone. Normalize only this exact zone family/end-date pattern.
 */
export function normalizeAustrianEd269Placeholder(
  p: Record<string, any>,
): Record<string, any> {
  const name = String(p?.name || p?.airspaceclass || "").trim().toUpperCase();
  if (!/^(?:MATZ|MCTR)\b/.test(name)) return p;
  const applicability = p?.applicability;
  if (!Array.isArray(applicability) || applicability.length === 0) return p;

  const isPlaceholderEntry = (entry: any): boolean => {
    const end = entry?.endDateTime;
    const endDate = end ? new Date(end) : null;
    return (
      String(entry?.permanent ?? "").toUpperCase() === "NO" &&
      endDate != null &&
      Number.isFinite(endDate.getTime()) &&
      endDate.getUTCFullYear() === 2100 &&
      endDate.getUTCMonth() === 11 &&
      endDate.getUTCDate() === 31 &&
      (!Array.isArray(entry?.schedule) || entry.schedule.length === 0)
    );
  };
  if (!applicability.every(isPlaceholderEntry)) return p;

  return {
    ...p,
    applicability: applicability.map((entry: any) => {
      const { startDateTime: _start, endDateTime: _end, ...rest } = entry;
      return { ...rest, permanent: "YES" };
    }),
  };
}

// Liefert Gültigkeits-Zeitstempel (ms) eines ED-269-Features. Belgien (live
// skeyes) liefert validStartTs/validEndTs bereits als ms; AT/generisch über
// applicability[] (startDateTime/endDateTime). Permanente Zonen -> null/null.
export function ed269ValidityFromProps(p: Record<string, any>): {
  validStartTs: number | null;
  validEndTs: number | null;
} {
  p = normalizeAustrianEd269Placeholder(p);
  const ds = Number(p?.validStartTs);
  const de = Number(p?.validEndTs);
  if (Number.isFinite(ds) || Number.isFinite(de)) {
    return {
      validStartTs: Number.isFinite(ds) ? ds : null,
      validEndTs: Number.isFinite(de) ? de : null,
    };
  }
  if (p?.permanent === true || String(p?.permanent ?? "").toUpperCase() === "YES") {
    return { validStartTs: null, validEndTs: null };
  }
  const app = p?.applicability;
  if (Array.isArray(app) && app.length > 0) {
    if (app.some((a: any) => String(a?.permanent ?? "").toUpperCase() === "YES")) {
      return { validStartTs: null, validEndTs: null };
    }
    let min: number | null = null;
    let max: number | null = null;
    for (const a of app) {
      if (a?.startDateTime) {
        const s = new Date(a.startDateTime).getTime();
        if (!isNaN(s) && (min === null || s < min)) min = s;
      }
      if (a?.endDateTime) {
        const e = new Date(a.endDateTime).getTime();
        if (!isNaN(e) && (max === null || e > max)) max = e;
      }
    }
    return { validStartTs: min, validEndTs: max };
  }
  return { validStartTs: null, validEndTs: null };
}

const ED269_WEEKDAYS: Record<string, string> = {
  MO: "Mo",
  MON: "Mo",
  MONDAY: "Mo",
  TU: "Di",
  TUE: "Di",
  TUESDAY: "Di",
  WE: "Mi",
  WED: "Mi",
  WEDNESDAY: "Mi",
  TH: "Do",
  THU: "Do",
  THURSDAY: "Do",
  FR: "Fr",
  FRI: "Fr",
  FRIDAY: "Fr",
  SA: "Sa",
  SAT: "Sa",
  SATURDAY: "Sa",
  SU: "So",
  SUN: "So",
  SUNDAY: "So",
};

// Wochentagskürzel (ED-269 MON..SUN, auch Langform/2-Buchstaben) -> JS-UTC-Tag
// (0 = Sonntag … 6 = Samstag). ANY/DAILY gilt für jeden Tag.
const ED269_WEEKDAY_INDEX: Record<string, number> = {
  SU: 0, SUN: 0, SUNDAY: 0,
  MO: 1, MON: 1, MONDAY: 1,
  TU: 2, TUE: 2, TUESDAY: 2,
  WE: 3, WED: 3, WEDNESDAY: 3,
  TH: 4, THU: 4, THURSDAY: 4,
  FR: 5, FRI: 5, FRIDAY: 5,
  SA: 6, SAT: 6, SATURDAY: 6,
};

function ed269RawScheduleDays(entry: any): any[] {
  const daysValue =
    entry?.daysOfWeek ?? entry?.dayOfWeek ?? entry?.days ?? entry?.byDay ?? entry?.day;
  return Array.isArray(daysValue)
    ? daysValue
    : typeof daysValue === "string" && /[,;]/.test(daysValue)
      ? daysValue.split(/[,;]/)
      : daysValue == null
        ? []
        : [daysValue];
}

function ed269RawDayKey(value: any): string {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? value.day ?? value.dayOfWeek ?? value.value ?? value.name ?? ""
        : String(value ?? "");
  return String(raw).trim().toUpperCase();
}

// "06:00Z", "6:00", "06:00:00", "24:00" -> Minuten seit Mitternacht (UTC);
// null, wenn nicht lesbar.
function ed269TimeMinutes(value: any): number | null {
  if (value == null) return null;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:Z|UTC)?$/i);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/** Bezugspunkt (WGS84) für Sonnenauf-/-untergangs-Zeitpläne (SR/SS). */
export interface ZoneSunLocation {
  lat: number;
  lon: number;
}

type SunEvent = "SR" | "SS" | "BMCT" | "EECT";

// Ereignis-Kennung aus startEvent/endEvent bzw. Klartext der Uhrzeit
// ("SR", "SUNRISE", "Sonnenaufgang" …). null = kein Sonnenereignis.
function ed269SunEvent(eventRaw: any, timeRaw: any): SunEvent | null {
  for (const raw of [eventRaw, timeRaw]) {
    const v = String(raw ?? "").trim().toUpperCase();
    if (!v) continue;
    if (v === "SR" || v === "SUNRISE" || v === "SONNENAUFGANG") return "SR";
    if (v === "SS" || v === "SUNSET" || v === "SONNENUNTERGANG") return "SS";
    if (v === "BMCT") return "BMCT";
    if (v === "EECT") return "EECT";
  }
  return null;
}

// Sonnenereignis am UTC-Tag von `date` am Bezugspunkt -> Minuten seit
// Mitternacht UTC; null, wenn nicht berechenbar (kein Ort, Polartag/-nacht).
function ed269SunEventMinutes(event: SunEvent, date: Date, loc: ZoneSunLocation | null | undefined): number | null {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  // calculateSolarTimes rechnet mit dem lokalen Kalendertag; 12:00 UTC liegt
  // für alle europäischen Zeitzonen am selben Kalendertag wie der UTC-Tag.
  const noonUtc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
  const solar = calculateSolarTimes(loc.lat, loc.lon, noonUtc);
  const t =
    event === "SR" ? solar.sunrise : event === "SS" ? solar.sunset : event === "BMCT" ? solar.civilDawnStart : solar.civilDuskEnd;
  if (!t || !Number.isFinite(t.getTime())) return null;
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const min = Math.round((t.getTime() - dayStart) / 60000);
  return min >= 0 && min <= 24 * 60 ? min : null;
}

// Prüft einen einzelnen Schedule-Eintrag gegen einen Zeitpunkt (UTC).
// Unlesbare Tages-/Zeitangaben gelten aus Sicherheitsgründen als passend
// (lieber eine Zone zu viel als aktiv werten als eine echte zu verschweigen).
// Sonnenereignisse (SR/SS, BMCT/EECT) werden am Bezugspunkt `sun` berechnet;
// ohne Bezugspunkt (oder Polartag/-nacht) gilt der Eintrag ganztägig.
function ed269ScheduleEntryMatches(entry: any, date: Date, sun?: ZoneSunLocation | null): boolean {
  if (!entry || typeof entry !== "object") return true;
  const dayKeys = ed269RawScheduleDays(entry).map(ed269RawDayKey).filter(Boolean);
  const anyDay =
    dayKeys.length === 0 ||
    dayKeys.some((d) => d === "ANY" || d === "DAILY" || d === "ALL" || !(d in ED269_WEEKDAY_INDEX));
  const dayMatches = (utcDay: number): boolean =>
    anyDay || dayKeys.some((d) => ED269_WEEKDAY_INDEX[d] === utcDay);

  const startRaw = entry.startTime ?? entry.startTimeOfDay ?? entry.timeStart ?? entry.beginTime ?? entry.from;
  const endRaw = entry.endTime ?? entry.timeEnd ?? entry.untilTime ?? entry.to;
  // Uhrzeit hat Vorrang; fehlt sie (oder ist Klartext wie „Sonnenaufgang“),
  // gilt startEvent/endEvent. Ohne beides: ganztägig (0–24 h).
  let start = startRaw == null ? (entry.startEvent == null ? 0 : null) : ed269TimeMinutes(startRaw);
  let end = endRaw == null ? (entry.endEvent == null ? 24 * 60 : null) : ed269TimeMinutes(endRaw);
  if (start == null) {
    const ev = ed269SunEvent(entry.startEvent, startRaw);
    start = ev ? ed269SunEventMinutes(ev, date, sun) : null;
  }
  if (end == null) {
    const ev = ed269SunEvent(entry.endEvent, endRaw);
    end = ev ? ed269SunEventMinutes(ev, date, sun) : null;
  }
  if (start == null || end == null) return dayMatches(date.getUTCDay());

  const day = date.getUTCDay();
  const t = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (start === end) return dayMatches(day); // ganztägig
  if (start < end) return dayMatches(day) && t >= start && t < end;
  // Über Mitternacht (z. B. 22:00Z–04:00Z): der Wochentag bezieht sich auf den
  // Beginn; der Teil nach Mitternacht gehört zum Vortag.
  if (t >= start) return dayMatches(day);
  if (t < end) return dayMatches((day + 6) % 7);
  return false;
}

function ed269ParseTs(value: any): number | null {
  if (value == null || value === "") return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * Ist eine ED-269-Zone zum Zeitpunkt `date` aktiv? Aktiv, wenn ein Eintrag in
 * `applicability` passt: permanent === "YES" ODER (start ≤ date ≤ end, fehlende
 * Grenze = offen) UND (kein schedule ODER ein schedule-Eintrag passt auf
 * UTC-Wochentag und UTC-Uhrzeit). Zonen ohne jede Gültigkeitsangabe gelten als
 * aktiv. Die Austro-Control-Platzhalter (MATZ/MCTR bis 2100) gelten als dauerhaft.
 */
export function ed269IsActiveAt(p: Record<string, any>, date: Date, sun?: ZoneSunLocation | null): boolean {
  p = normalizeAustrianEd269Placeholder(p || {});
  const ts = date.getTime();
  if (!Number.isFinite(ts)) return true;
  if (p?.permanent === true || String(p?.permanent ?? "").toUpperCase() === "YES") return true;
  const app = p?.applicability;
  if (!Array.isArray(app) || app.length === 0) {
    // Belgien (skeyes live) liefert nur validStartTs/validEndTs (ms).
    const ds = Number(p?.validStartTs);
    const de = Number(p?.validEndTs);
    if (p?.validStartTs != null && Number.isFinite(ds) && ts < ds) return false;
    if (p?.validEndTs != null && Number.isFinite(de) && ts > de) return false;
    return true;
  }
  return app.some((entry: any) => {
    if (!entry || typeof entry !== "object") return true;
    if (String(entry.permanent ?? "").toUpperCase() === "YES") return true;
    const start = ed269ParseTs(entry.startDateTime);
    const end = ed269ParseTs(entry.endDateTime);
    if (start != null && ts < start) return false;
    if (end != null && ts > end) return false;
    const schedule = entry.schedule;
    if (!Array.isArray(schedule) || schedule.length === 0) return true;
    return schedule.some((s: any) => ed269ScheduleEntryMatches(s, date, sun));
  });
}

/**
 * Kompakte, serialisierbare Aktivitätsinfo für Karten/Planung (wird an
 * GeozoneFeatureInfo gehängt). Nur wenn die Zone überhaupt zeitabhängig ist.
 */
export function ed269ActivityFromProps(p: Record<string, any>): any[] | undefined {
  const n = normalizeAustrianEd269Placeholder(p || {});
  // Feature-weites permanent (wie ed269IsActiveAt/ed269ValidityFromProps):
  // dauerhaft, applicability-Fenster sind dann nicht maßgeblich.
  if (n?.permanent === true || String(n?.permanent ?? "").toUpperCase() === "YES") return undefined;
  const app = n?.applicability;
  if (!Array.isArray(app) || app.length === 0) return undefined;
  if (app.some((a: any) => String(a?.permanent ?? "").toUpperCase() === "YES")) return undefined;
  return app;
}

// ---------------------------------------------------------------------------
// Eine Aktivitätsprüfung für alle Zonen (Karte, Liste, Radar-Reiter, Urteil)
// ---------------------------------------------------------------------------

/** Ergebnis der Aktivitätsprüfung. `unknown` nur bei widersprüchlichen bzw.
 * unlesbaren Zeitangaben; in Urteilen wie `active` behandeln. */
export type ZoneActivity = "active" | "inactive" | "unknown";

/** Was zoneActivityAt von einer Zone braucht (strukturell, GeozoneFeatureInfo
 * erfüllt es). Fehlende Felder = keine Einschränkung. */
export interface ZoneActivityInput {
  /** Hartes Gültigkeitsfenster in ms (Ende inklusive); null = offen. */
  validStartTs?: number | null;
  validEndTs?: number | null;
  /** ED-269 applicability[] (permanent/startDateTime/endDateTime/schedule). */
  ed269Applicability?: any[];
  /** Geometrie im App-Format [lat, lon] – nur für SR/SS-Zeitpläne genutzt. */
  polygonGroups?: [number, number][][][];
  polygonRings?: [number, number][][];
}

/** Bezugspunkt für SR/SS: Mittel der Eckpunkte des ersten Außenrings. */
export function zoneSunLocation(z: ZoneActivityInput | null | undefined): ZoneSunLocation | null {
  const ring = z?.polygonGroups?.[0]?.[0] ?? z?.polygonRings?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const p of ring) {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    lat += p[0];
    lon += p[1];
    n++;
  }
  return n > 0 ? { lat: lat / n, lon: lon / n } : null;
}

function finiteTs(v: unknown): number | null {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Ein applicability-Eintrag: active/inactive, oder unknown bei unlesbaren bzw.
// widersprüchlichen Grenzen (Beginn nach Ende).
function applicabilityEntryActivity(entry: any, date: Date, sun: ZoneSunLocation | null): ZoneActivity {
  if (!entry || typeof entry !== "object") return "active";
  if (String(entry.permanent ?? "").toUpperCase() === "YES") return "active";
  const hasStart = entry.startDateTime != null && entry.startDateTime !== "";
  const hasEnd = entry.endDateTime != null && entry.endDateTime !== "";
  const start = ed269ParseTs(entry.startDateTime);
  const end = ed269ParseTs(entry.endDateTime);
  if ((hasStart && start == null) || (hasEnd && end == null)) return "unknown";
  if (start != null && end != null && start > end) return "unknown";
  return ed269IsActiveAt({ applicability: [entry] }, date, sun) ? "active" : "inactive";
}

/**
 * DIE Aktivitätsprüfung einer geparsten Zone zum Zeitpunkt `date`. Reihenfolge:
 *  1. hartes Gültigkeitsfenster validStartTs/validEndTs (alle Quellen: ED-269,
 *     DE-WFS/Kachel-Temporärzonen, CZ, NOTAM-artige Zonen, LU-WMS …);
 *  2. ED-269 applicability (permanent / startDateTime / endDateTime / schedule
 *     inkl. Über-Mitternacht-Regel, Austro-Control-Platzhalter = dauerhaft);
 *  3. SR/SS-Zeitpläne am Zonen-Bezugspunkt (ohne Geometrie: ganztägig aktiv).
 * Zonen ohne jede Zeitangabe (reine Textquellen) sind `active`. `unknown` nur
 * bei widersprüchlichen/unlesbaren Angaben (Beginn > Ende, unlesbares Datum,
 * ungültiges `date`) – Aufrufer behandeln `unknown` wie `active`
 * (isZoneActiveAt).
 */
export function zoneActivityAt(z: ZoneActivityInput | null | undefined, date: Date): ZoneActivity {
  const ts = date instanceof Date ? date.getTime() : NaN;
  if (!Number.isFinite(ts)) return "unknown";
  if (!z) return "active";
  const vs = finiteTs(z.validStartTs);
  const ve = finiteTs(z.validEndTs);
  if (vs != null && ve != null && vs > ve) return "unknown";
  if (vs != null && ts < vs) return "inactive";
  if (ve != null && ts > ve) return "inactive";
  const app = z.ed269Applicability;
  if (!Array.isArray(app) || app.length === 0) return "active";
  const sun = zoneSunLocation(z);
  let unknown = false;
  for (const entry of app) {
    const a = applicabilityEntryActivity(entry, date, sun);
    if (a === "active") return "active";
    if (a === "unknown") unknown = true;
  }
  return unknown ? "unknown" : "inactive";
}

/** zoneActivityAt als Wahrheitswert; `unknown` zählt (sicherheitshalber) als aktiv. */
export function isZoneActiveAt(z: ZoneActivityInput | null | undefined, date: Date): boolean {
  return zoneActivityAt(z, date) !== "inactive";
}

/**
 * Zeitbezug je Kontext – explizit statt ad hoc in den Screens:
 *  - "now": Radar/Live-Karte, Pre-Check-Karte – Zustand jetzt.
 *  - "planned": Planung – geplanter Zeitpunkt; ohne geplante Zeit jetzt.
 *  - "precheck": Pre-Check – aktiv, wenn JETZT ODER zur geplanten Zeit aktiv.
 *    Der Pre-Check läuft unmittelbar vor dem Start; der tatsächliche Start
 *    kann vor oder nach der geplanten Zeit liegen. Eine Zone, die zu einem der
 *    beiden Zeitpunkte aktiv ist, muss deshalb berücksichtigt werden (sicherer
 *    als nur einer der beiden Zeitpunkte).
 */
export type ZoneTimeContext =
  | { kind: "now"; now?: Date }
  | { kind: "planned"; planned: Date | null | undefined; now?: Date }
  | { kind: "precheck"; planned: Date | null | undefined; now?: Date };

/** Die zu prüfenden Zeitpunkte eines Kontexts (mindestens einer). */
export function zoneTimeReferences(ctx: ZoneTimeContext): Date[] {
  const now = ctx.now ?? new Date();
  if (ctx.kind === "now") return [now];
  const planned = ctx.planned && Number.isFinite(ctx.planned.getTime()) ? ctx.planned : null;
  if (ctx.kind === "planned") return [planned ?? now];
  return planned ? [now, planned] : [now];
}

/** Ist die Zone im Kontext relevant (aktiv/unbekannt zu einem der Zeitpunkte)? */
export function isZoneActiveInContext(z: ZoneActivityInput | null | undefined, ctx: ZoneTimeContext): boolean {
  return zoneTimeReferences(ctx).some((d) => isZoneActiveAt(z, d));
}

/** Zonen, deren Gültigkeit länger als diese Frist vorbei ist, werden beim
 * Parsen verworfen (Speicher). Kürzer zurückliegende bleiben erhalten; ob sie
 * aktiv sind, entscheidet zoneActivityAt für den jeweiligen Zeitpunkt. */
export const ZONE_EXPIRED_DROP_GRACE_MS = 24 * 60 * 60 * 1000;

/** true, wenn die Zone mehr als `graceMs` vor `nowMs` geendet hat (hartes
 * Fenster bzw. alle applicability-Fenster) – nur fürs Speichersparen beim
 * Parsen, nie für die Aktivität selbst. */
export function zoneEndedLongAgo(
  z: ZoneActivityInput | null | undefined,
  nowMs: number = Date.now(),
  graceMs: number = ZONE_EXPIRED_DROP_GRACE_MS,
): boolean {
  if (!z || !Number.isFinite(nowMs)) return false;
  const cutoff = nowMs - graceMs;
  const ve = finiteTs(z.validEndTs);
  if (ve != null && ve < cutoff) return true;
  const app = z.ed269Applicability;
  if (!Array.isArray(app) || app.length === 0) return false;
  return app.every((e: any) => {
    if (!e || typeof e !== "object" || String(e.permanent ?? "").toUpperCase() === "YES") return false;
    const end = ed269ParseTs(e.endDateTime);
    return end != null && end < cutoff;
  });
}

/** Hinweistext für eine zeitgesteuerte Zone, die zum Zeitpunkt inaktiv ist. */
export function ed269InactiveInfoText(
  z: { scheduleText?: string[]; validStartTs?: number | null; validEndTs?: number | null },
  when: "planned" | "now" = "planned",
): string {
  const suffix = when === "planned" ? "(zur geplanten Zeit inaktiv)" : "(derzeit inaktiv)";
  const schedule = (z.scheduleText ?? []).filter(Boolean);
  if (schedule.length > 0) return `zeitweise aktiv – ${schedule.join("; ")} ${suffix}`;
  const fmt = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
  };
  const parts: string[] = [];
  if (z.validStartTs != null) parts.push(`ab ${fmt(z.validStartTs)}`);
  if (z.validEndTs != null) parts.push(`bis ${fmt(z.validEndTs)}`);
  return parts.length > 0
    ? `zeitweise aktiv – gültig ${parts.join(" ")} ${suffix}`
    : `zeitweise aktiv ${suffix}`;
}

function ed269ScheduleDay(value: any): string {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? value.day ?? value.dayOfWeek ?? value.value ?? value.name ?? ""
        : String(value ?? "");
  const normalized = String(raw).trim().toUpperCase();
  return ED269_WEEKDAYS[normalized] ?? normalized;
}

const ED269_DAY_ORDER = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// "Mo, Di, Mi, Do" -> "Mo–Do"; nicht zusammenhängende Tage bleiben einzeln
// ("Mo, Mi, Fr"). ANY -> "täglich".
function compactEd269Days(days: string[]): string {
  if (days.some((d) => d === "ANY" || d === "DAILY")) return "täglich";
  const idx = days.map((d) => ED269_DAY_ORDER.indexOf(d));
  if (idx.some((i) => i < 0)) return days.join(", ");
  const sorted = [...new Set(idx)].sort((a, b) => a - b);
  if (sorted.length === 7) return "täglich";
  const groups: number[][] = [];
  for (const i of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else groups.push([i]);
  }
  return groups
    .map((g) =>
      g.length >= 3
        ? `${ED269_DAY_ORDER[g[0]]}–${ED269_DAY_ORDER[g[g.length - 1]]}`
        : g.map((i) => ED269_DAY_ORDER[i]).join(", "),
    )
    .join(", ");
}

function ed269ScheduleTime(value: any): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:Z|UTC)?$/i);
  if (!match) return raw;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatEd269ScheduleEntry(entry: any): string {
  if (typeof entry === "string" || typeof entry === "number") return String(entry);
  if (!entry || typeof entry !== "object") return "";

  const parts: string[] = [];
  const daysValue =
    entry.daysOfWeek ??
    entry.dayOfWeek ??
    entry.days ??
    entry.byDay ??
    entry.day;
  const dayValues = Array.isArray(daysValue)
    ? daysValue
    : typeof daysValue === "string" && /[,;]/.test(daysValue)
      ? daysValue.split(/[,;]/)
      : daysValue == null
        ? []
        : [daysValue];
  const days = dayValues
    .map(ed269ScheduleDay)
    .filter(Boolean);
  if (days.length > 0) parts.push(compactEd269Days(days));

  const frequency = String(entry.frequency ?? entry.freq ?? "")
    .trim()
    .toUpperCase();
  const frequencyLabels: Record<string, string> = {
    DAILY: "täglich",
    WEEKLY: "wöchentlich",
    MONTHLY: "monatlich",
    YEARLY: "jährlich",
  };
  if (frequencyLabels[frequency]) parts.push(frequencyLabels[frequency]);

  const start =
    entry.startTime ??
    entry.startTimeOfDay ??
    entry.timeStart ??
    entry.beginTime ??
    entry.from;
  const end = entry.endTime ?? entry.timeEnd ?? entry.untilTime ?? entry.to;
  if (start != null || end != null) {
    const startText = start == null ? "Beginn offen" : ed269ScheduleTime(start);
    const endText = end == null ? "Ende offen" : ed269ScheduleTime(end);
    // ED-269-Zeiten mit "Z"-Suffix sind UTC -> nicht als Ortszeit ("Uhr") ausgeben.
    const isUtc = [start, end].some((v) => v != null && /(?:Z|UTC)\s*$/i.test(String(v).trim()));
    parts.push(`${startText}–${endText} ${isUtc ? "UTC" : "Uhr"}`);
  }

  const interval = entry.timeInterval ?? entry.interval;
  if (interval != null && start == null && end == null) {
    if (typeof interval === "object") {
      const intervalStart =
        interval.startTime ?? interval.start ?? interval.from;
      const intervalEnd = interval.endTime ?? interval.end ?? interval.to;
      if (intervalStart != null || intervalEnd != null) {
        parts.push(
          `${intervalStart == null ? "Beginn offen" : ed269ScheduleTime(intervalStart)}–${intervalEnd == null ? "Ende offen" : ed269ScheduleTime(intervalEnd)} Uhr`,
        );
      } else {
        parts.push(JSON.stringify(interval));
      }
    } else {
      parts.push(String(interval));
    }
  }

  const recurrenceRule = entry.recurrenceRule ?? entry.rrule ?? entry.rule;
  if (recurrenceRule != null) parts.push(String(recurrenceRule));

  if (parts.length > 0) return parts.join(" · ");
  // Preserve provider-specific schedule shapes rather than silently dropping
  // their restrictions if Austro Control adds fields we do not yet recognize.
  try {
    return JSON.stringify(entry);
  } catch {
    return String(entry);
  }
}

/** Readable recurring activity windows declared in ED-269 applicability.schedule. */
export function ed269ScheduleFromProps(p: Record<string, any>): string[] {
  const schedules = (Array.isArray(p?.applicability) ? p.applicability : [])
    .flatMap((entry: any) =>
      Array.isArray(entry?.schedule) ? entry.schedule : [],
    )
    .map(formatEd269ScheduleEntry)
    .filter((value: string) => value.length > 0);
  return [...new Set(schedules)];
}

// Eine ED-269-Zone gilt als "temporär", wenn sie ein Gültigkeitsfenster
// (Start ODER Ende) trägt. Permanente Zonen (beide null) sind dauerhaft.
export function ed269IsTemporary(p: Record<string, any>): boolean {
  const { validStartTs, validEndTs } = ed269ValidityFromProps(p);
  return validStartTs != null || validEndTs != null;
}

/** Source-declared temporary zones that belong in the NOTAM list even when
 * their validity period exceeds the generic short-validity window. */
export function ed269IsNotamEligible(p: Record<string, any>, countryIso: string): boolean {
  p = normalizeAustrianEd269Placeholder(p);
  if (p?._notamEligible === true) return true;
  // Quellen-Flags aus der Registry (BE: skeyes-Live-Zonen; AT: zeitgesteuerte
  // applicability-Einträge der Frequentis-Plattform).
  const source = getOwnGeozoneSourceMeta(countryIso);
  if (source?.notamFromLiveFlag && p?._live === true && p?.permanent !== true) return true;
  if (!source?.notamFromApplicability || !Array.isArray(p?.applicability)) return false;
  return p.applicability.some((entry: any) => {
    const permanent = String(entry?.permanent ?? "").toUpperCase();
    const hasTimeWindow = !!entry?.startDateTime || !!entry?.endDateTime ||
      (Array.isArray(entry?.schedule) && entry.schedule.length > 0);
    return permanent === "NO" && hasTimeWindow;
  });
}
