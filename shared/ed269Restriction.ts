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

function ed269ScheduleTime(value: any): string {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z)?$/i);
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
  if (days.length > 0) parts.push(days.join(", "));

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
    parts.push(`${startText}–${endText} Uhr`);
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
