// Finnische Geozonen (Traficom, „Finnish UASZoneVersion“) – reines ED-269
// ({title, description, features:[UASZoneVersion]}), siehe
// docs/geozonen-weitere-laender.md §5.
//
// Eigenheiten:
//  - `restriction` ist brauchbar (PROHIBITED / REQ_AUTHORISATION /
//    NO_RESTRICTION). NO_RESTRICTION = erlaubende Zonen (Modellflugplätze,
//    „sallivat vyöhykkeet“), keine bloße Info.
//  - `applicability[].permanent` ist immer "YES", trotzdem steht ein Enddatum
//    drin = Ende der Verordnungsperiode (meist April 2027 oder 2050). Das ist
//    KEIN Ablaufdatum. Nur echte befristete Zonen (Spanne ≤ 1 Jahr, Traficom:
//    temporäre Zonen gelten höchstens ein Jahr) bekommen ein Gültigkeitsfenster.
//  - Der Schedule „ANY 00:00–23:59:59“ ist bedeutungslos und wird entfernt;
//    echte Wochentagspläne (z. B. EFUTUASC3 Utti Mo–Fr / Sa–So) bleiben.
//  - Höhen fehlen oft (null): Untergrenze = SFC, Obergrenze = unbegrenzt
//    (erledigt shared/ed269Pure.ts).
//  - Der wichtigste Erklärtext steht in extendedProperties.exceptionPermit
//    (nur Finnisch).
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

import { ed269ZonesToFeatures, type Ed269PureFeature } from "./ed269Pure";
import { normalizeEd269Restriction } from "./ed269Restriction";

export const FI_GEOZONES_URL = "https://eservices.traficom.fi/Ilmatilasovellus/api/uas-reservations/json?lang=fi";
export const FI_GEOZONE_SOURCE_LABEL = "Traficom (ED-269)";
// Attribution laut Traficom-Musterzitat (Lizenz auf der Downloadseite nicht
// genannt; allgemein CC BY 4.0 – Bestätigung bei copyright@traficom.fi offen).
export const FI_GEOZONE_ATTRIBUTION = "Lähde: Liikenne- ja viestintävirasto Traficom (CC BY 4.0)";
export const FI_PERMISSIVE_ZONE_LABEL = "Erlaubende Zone (Modellflug)";

// Längste Spanne, die noch als echte befristete Zone gilt (1 Jahr + Puffer).
const FI_MAX_TEMPORARY_MS = 366 * 24 * 3600 * 1000;

function parseTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Schedule „jeden Tag 00:00–23:59(:59)“ -> ohne Aussage. */
function isTrivialSchedule(schedule: unknown): boolean {
  if (!Array.isArray(schedule) || schedule.length === 0) return true;
  return schedule.every((s: any) => {
    const days = Array.isArray(s?.day) ? s.day : s?.day != null ? [s.day] : [];
    const anyDay = days.length === 0 || days.some((d: any) => String(d).toUpperCase() === "ANY");
    const start = String(s?.startTime ?? "00:00").replace(/Z$/i, "");
    const end = String(s?.endTime ?? "23:59").replace(/Z$/i, "");
    return anyDay && /^00:00(:00)?$/.test(start) && /^(23:59(:59)?|24:00(:00)?)$/.test(end);
  });
}

/**
 * Normalisiert applicability[] eines finnischen Eintrags:
 *  - Spanne start–end ≤ 1 Jahr -> echte befristete Zone (permanent "NO" mit
 *    start/end), damit Ablauf und Aktivität korrekt ausgewertet werden.
 *  - sonst dauerhaft: Enddatum (Verordnungsperiode) entfernen und als
 *    `regulationPeriodEndDateTime` am Eintrag aufheben. Ein Start in der
 *    Zukunft bleibt erhalten (permanent "NO" + startDateTime, kein Ende).
 *  - nicht-trivialer Schedule -> permanent "NO" (sonst würde die App den
 *    Wochentagsplan ignorieren), triviale Schedules entfallen.
 */
export function normalizeFinnishApplicability(applicability: unknown, now: Date = new Date()): any[] | undefined {
  if (!Array.isArray(applicability) || applicability.length === 0) return undefined;
  const nowMs = now.getTime();
  return applicability.map((entry: any) => {
    if (!entry || typeof entry !== "object") return entry;
    const start = parseTs(entry.startDateTime);
    const end = parseTs(entry.endDateTime);
    const schedule = isTrivialSchedule(entry.schedule) ? undefined : entry.schedule;
    const out: Record<string, any> = {};
    if (start != null && end != null && end - start <= FI_MAX_TEMPORARY_MS) {
      out.permanent = "NO";
      out.startDateTime = entry.startDateTime;
      out.endDateTime = entry.endDateTime;
    } else {
      const futureStart = start != null && start > nowMs;
      out.permanent = futureStart || schedule ? "NO" : "YES";
      if (futureStart) out.startDateTime = entry.startDateTime;
      if (entry.endDateTime) out.regulationPeriodEndDateTime = entry.endDateTime;
    }
    if (schedule) out.schedule = compactWholeDaySchedule(schedule);
    return out;
  });
}

/**
 * Traficom schreibt ganztägige Wochentage als je einen Eintrag
 * „{day:[SAT], 00:00Z–00:00Z}“. Für eine lesbare Anzeige („Sa, So“ statt
 * „Sa · 00:00–00:00 UTC, So · …“) werden solche Einträge zu EINEM Eintrag ohne
 * Uhrzeit zusammengefasst (ohne Uhrzeit = ganzer Tag, gleiche Auswertung).
 * Andere Schedules bleiben unverändert.
 */
function compactWholeDaySchedule(schedule: any[]): any[] {
  const wholeDay = schedule.every((s: any) => {
    const st = String(s?.startTime ?? "").replace(/Z$/i, "");
    const en = String(s?.endTime ?? "").replace(/Z$/i, "");
    return /^00:00(:00)?$/.test(st) && /^00:00(:00)?$/.test(en);
  });
  if (!wholeDay) return schedule;
  const order = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const days = new Set<string>();
  for (const s of schedule) {
    for (const d of Array.isArray(s?.day) ? s.day : [s?.day]) if (d != null) days.add(String(d).toUpperCase());
  }
  const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [{ day: sorted }];
}

/** Einstufung (§5.5): Feldwert ist brauchbar und bleibt erhalten. */
export function finnishRestriction(zone: any): string {
  const r = normalizeEd269Restriction(String(zone?.restriction ?? ""));
  return r || "REQ_AUTHORISATION";
}

function isTemporary(app: any[] | undefined): boolean {
  return Array.isArray(app) && app.some((a) => a?.permanent === "NO" && a?.endDateTime);
}

/** Wandelt die Traficom-Antwort ({features:[…]}) in GeoJSON-Features um. */
export function normalizeFinnishZones(body: unknown, now: Date = new Date()): Ed269PureFeature[] {
  return ed269ZonesToFeatures(body, {
    source: FI_GEOZONE_SOURCE_LABEL,
    restriction: finnishRestriction,
    applicability: (z) => normalizeFinnishApplicability(z?.applicability, now),
    messagePrefix: (z) =>
      finnishRestriction(z) === "NO_RESTRICTION"
        ? [`${FI_PERMISSIVE_ZONE_LABEL}: Drohnenflug hier unter den Bedingungen der Zone erlaubt – Höchsthöhe beachten (oft AMSL).`]
        : [],
    messageSuffix: (z) => {
      const permit = String(z?.extendedProperties?.exceptionPermit ?? "").trim();
      return permit ? [`Hinweis Traficom (fi): ${permit}`] : [];
    },
    extraProps: (z) => {
      const p: Record<string, any> = { attribution: FI_GEOZONE_ATTRIBUTION };
      if (finnishRestriction(z) === "NO_RESTRICTION") {
        p.permissiveZone = true;
        p.typeLabel = FI_PERMISSIVE_ZONE_LABEL;
      }
      const app = normalizeFinnishApplicability(z?.applicability, now);
      if (isTemporary(app)) p.temporary = true;
      const reg = (Array.isArray(z?.applicability) ? z.applicability : [])
        .map((a: any) => a?.endDateTime)
        .filter(Boolean)[0];
      if (reg && !isTemporary(app)) p.regulationPeriodEnd = reg;
      return p;
    },
  });
}
