// Reine, von React Native / Express unabhängige ED-269-Hilfslogik:
// Beschränkungs-Normalisierung, Anzeigefarben, Beschränkungs-Extraktion aus den
// uneinheitlichen Anbieter-Properties sowie die Gültigkeits-Zeitfenster. Liegt
// in shared/, damit sowohl der Client (Vektor-Polygone, Popups) als auch der
// Server (Rasterisierung der Geozonen-Kacheln) GENAU dieselbe Klassifizierung
// und dieselben Farben verwenden — keine Drift zwischen Mobile-Polygon und
// serverseitig gerenderter Kachel.

// Normalisiert die unterschiedlichen ED-269-Beschränkungs-/Typ-Schreibweisen
// verschiedener Anbieter auf einen einheitlichen Schlüssel. Belgien
// (Droneguide) nutzt z. B. `type` mit Werten wie REQ_AUTH/RESTRICTED, Österreich
// `restriction` mit REQ_AUTHORISATION.
export function normalizeEd269Restriction(raw: string): string {
  const v = (raw || "").toString().toUpperCase().trim().replace(/[\s-]+/g, "_");
  switch (v) {
    case "REQ_AUTH":
    case "REQ_AUTHORISATION":
    case "REQ_AUTHORIZATION":
    case "AUTHORISATION":
    case "AUTHORIZATION":
    case "REQUIRES_AUTHORISATION":
      return "REQ_AUTHORISATION";
    case "PROHIBITED":
    case "FORBIDDEN":
    case "NO_FLY":
      return "PROHIBITED";
    case "RESTRICTED":
      return "RESTRICTED";
    case "CONDITIONAL":
    case "CONDITIONS":
      return "CONDITIONAL";
    case "NO_RESTRICTION":
    case "NONE":
    case "INFORMATION":
    case "INFO":
      return "NO_RESTRICTION";
    case "NATURE":
    case "NATURSCHUTZ":
    case "NATURA":
      return "NATURE";
    default:
      return v;
  }
}

// ED-269-Restriction -> Anzeigefarbe (rgba). PROHIBITED rot, REQ_AUTHORISATION
// orange, CONDITIONAL gelb, NO_RESTRICTION blau/grün.
export function ed269RestrictionColors(restriction: string): { fill: string; stroke: string } {
  switch (normalizeEd269Restriction(restriction)) {
    case "PROHIBITED":
      return { fill: "rgba(255,59,48,0.20)", stroke: "rgba(255,59,48,0.95)" };
    case "RESTRICTED":
      return { fill: "rgba(255,99,71,0.18)", stroke: "rgba(255,69,58,0.95)" };
    case "REQ_AUTHORISATION":
      return { fill: "rgba(255,149,0,0.18)", stroke: "rgba(255,149,0,0.95)" };
    case "CONDITIONAL":
      return { fill: "rgba(255,204,0,0.18)", stroke: "rgba(255,159,10,0.95)" };
    case "NO_RESTRICTION":
      return { fill: "rgba(52,199,89,0.15)", stroke: "rgba(52,199,89,0.9)" };
    // Naturschutz (Naturområder): kräftiges Waldgrün, bewusst dunkler als das
    // systemGrün von NO_RESTRICTION, damit Naturschutzzonen von reinen
    // Aufmerksamkeitszonen (Farve 5) unterscheidbar bleiben.
    case "NATURE":
      return { fill: "rgba(46,125,50,0.22)", stroke: "rgba(27,94,32,0.95)" };
    default:
      return { fill: "rgba(0,122,255,0.15)", stroke: "rgba(0,122,255,0.85)" };
  }
}

// Extrahiert die normalisierte Beschränkung aus den ED-269-Properties. Belgien
// (skeyes) liefert restriction als Objekt { type: "PROHIBITED" }; AT/DK liefern
// einen String. Beide Formen unterstützen (identisch zur Client-Parselogik in
// client/lib/ed269.ts parseEd269ToGeozoneInfo).
export function ed269RestrictionForProps(p: Record<string, any>): string {
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

// Prüft einen einzelnen Schedule-Eintrag gegen einen Zeitpunkt (UTC).
// Unlesbare Tages-/Zeitangaben gelten aus Sicherheitsgründen als passend
// (lieber eine Zone zu viel als aktiv werten als eine echte zu verschweigen).
function ed269ScheduleEntryMatches(entry: any, date: Date): boolean {
  if (!entry || typeof entry !== "object") return true;
  const dayKeys = ed269RawScheduleDays(entry).map(ed269RawDayKey).filter(Boolean);
  const anyDay =
    dayKeys.length === 0 ||
    dayKeys.some((d) => d === "ANY" || d === "DAILY" || d === "ALL" || !(d in ED269_WEEKDAY_INDEX));
  const dayMatches = (utcDay: number): boolean =>
    anyDay || dayKeys.some((d) => ED269_WEEKDAY_INDEX[d] === utcDay);

  const startRaw = entry.startTime ?? entry.startTimeOfDay ?? entry.timeStart ?? entry.beginTime ?? entry.from;
  const endRaw = entry.endTime ?? entry.timeEnd ?? entry.untilTime ?? entry.to;
  const start = startRaw == null ? 0 : ed269TimeMinutes(startRaw);
  const end = endRaw == null ? 24 * 60 : ed269TimeMinutes(endRaw);
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
export function ed269IsActiveAt(p: Record<string, any>, date: Date): boolean {
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
    return schedule.some((s: any) => ed269ScheduleEntryMatches(s, date));
  });
}

/**
 * Kompakte, serialisierbare Aktivitätsinfo für Karten/Planung (wird an
 * GeozoneFeatureInfo gehängt). Nur wenn die Zone überhaupt zeitabhängig ist.
 */
export function ed269ActivityFromProps(p: Record<string, any>): any[] | undefined {
  const n = normalizeAustrianEd269Placeholder(p || {});
  const app = n?.applicability;
  if (!Array.isArray(app) || app.length === 0) return undefined;
  if (app.some((a: any) => String(a?.permanent ?? "").toUpperCase() === "YES")) return undefined;
  return app;
}

/** Aktivität einer bereits geparsten Zone (GeozoneFeatureInfo-ähnlich). Zonen
 * ohne ED-269-Aktivitätsinfo (andere Quellen, alte Offline-Pakete) gelten als
 * aktiv; das Gültigkeitsfenster (validStart/EndTs) behandelt der bestehende Code. */
export function geozoneIsActiveAt(
  z: { ed269Applicability?: any[] | null } | null | undefined,
  date: Date,
): boolean {
  const app = z?.ed269Applicability;
  if (!Array.isArray(app) || app.length === 0) return true;
  return ed269IsActiveAt({ applicability: app }, date);
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
  const iso = countryIso.toUpperCase();
  if (iso === "BE" && p?._live === true && p?.permanent !== true) return true;
  if (iso !== "AT" || !Array.isArray(p?.applicability)) return false;
  return p.applicability.some((entry: any) => {
    const permanent = String(entry?.permanent ?? "").toUpperCase();
    const hasTimeWindow = !!entry?.startDateTime || !!entry?.endDateTime ||
      (Array.isArray(entry?.schedule) && entry.schedule.length > 0);
    return permanent === "NO" && hasTimeWindow;
  });
}
