import { isZoneActiveInContext, type ZoneActivityInput } from "../../shared/ed269Restriction";
import {
  assessZoneRestriction,
  zoneRestriction,
  type RestrictionZoneLike,
  type ZoneAssessment,
} from "../../shared/restrictionPolicy";

// Schweregrad-Klassifizierung für den seitlichen Geozonen-Reiter auf dem
// Radar-Screen. Reines, React-Native-freies Modul, damit Web/Tests es teilen
// können — die AV-/§21h-Abdeckungsprüfung (die auf storage.ts/AsyncStorage
// fußt) wird als Callback hereingereicht, statt hier importiert zu werden.
//
// Die Einstufung kommt ausschließlich aus der Policy-Tabelle
// (shared/restrictionPolicy.ts) – dieselbe Funktion (assessZoneRestriction)
// färbt auch die Planungsliste, damit eine Zone überall gleich bewertet wird.

export interface GeozoneSeverityZone extends ZoneActivityInput, RestrictionZoneLike {
  layerLabel: string;
  name: string;
  details: string;
  upperMeters?: number;
  informationalOnly?: boolean;
}

// Aggregierter Reiter-Schweregrad. Reihenfolge (höchster gewinnt):
// red > orange > blue > green.
export type GeozoneTabSeverity = "red" | "orange" | "blue" | "green" | "unknown";

/**
 * Aktiv-Erkennung für Radar/Live-Karte (Zeitbezug: JETZT) über die eine
 * Aktivitätsprüfung zoneActivityAt (Gültigkeitsfenster, ED-269-applicability,
 * SR/SS). Zonen ohne strukturierte Zeitangaben sind aktiv; `unknown` zählt als
 * aktiv. Ersetzt das frühere Parsen von „Status: Inaktiv“/„Von:“ im Detailtext.
 */
export function isGeozoneActiveForRadar(z: ZoneActivityInput, now: number | Date = Date.now()): boolean {
  return isZoneActiveInContext(z, { kind: "now", now: now instanceof Date ? now : new Date(now) });
}

/** Echtes Flugverbot laut Policy (PROHIBITED, inkl. Text-Rückfall für reine
 * Textquellen). Reine Hinweis-Zonen sind nie ein Verbot. */
export function isProhibitionZone(z: GeozoneSeverityZone): boolean {
  return zoneRestriction(z) === "PROHIBITED";
}

/**
 * Policy-Bewertung einer Zone für Radar/Live-Karte (Zeitbezug jetzt).
 * `isCoveredByAV` wird nur für Zonen gefragt, deren Einstufung überhaupt durch
 * eine AV/Genehmigung abdeckbar ist (REQ_AUTHORISATION).
 */
export function assessGeozoneForRadar(
  z: GeozoneSeverityZone,
  opts: { isCoveredByAV: (z: GeozoneSeverityZone) => boolean; now?: number | Date },
): ZoneAssessment {
  const active = !z.informationalOnly && isGeozoneActiveForRadar(z, opts.now ?? Date.now());
  const restriction = zoneRestriction(z);
  const covered =
    active && restriction === "REQ_AUTHORISATION" ? opts.isCoveredByAV(z) : false;
  return assessZoneRestriction(z, { active, covered });
}

/**
 * Leitet aus allen Zonen den höchsten Reiter-Schweregrad ab (Policy):
 * - ROT: aktive Zone mit Schwere ≥ 3 (Verbot, Sperrgebiet, Genehmigung
 *   erforderlich), die nicht durch AV/Genehmigung gedeckt ist.
 * - ORANGE: sonstige aktive Beschränkung (Auflagen, Naturschutz, unbekannt,
 *   AV-gedeckte Genehmigungspflicht).
 * - BLAU: Zone vorhanden, aber nur Info bzw. derzeit inaktiv.
 * - GRÜN: keine Zone.
 *
 * @param isCoveredByAV  Prüft, ob eine genehmigungspflichtige Zone durch eine
 *   gültige AV/Sondergenehmigung des Piloten abgedeckt ist (DE: § 21h-AV).
 */
export function computeGeozoneTabSeverity(
  zones: GeozoneSeverityZone[],
  opts: {
    isCoveredByAV: (z: GeozoneSeverityZone) => boolean;
    now?: number;
  },
): GeozoneTabSeverity {
  if (!zones || zones.length === 0) return "green";
  const now = opts.now ?? Date.now();
  let hasOrange = false;
  for (const z of zones) {
    if (z.informationalOnly) continue;
    const a = assessGeozoneForRadar(z, { isCoveredByAV: opts.isCoveredByAV, now });
    if (a.tab === "red") return "red";
    if (a.tab === "orange") hasOrange = true;
  }
  return hasOrange ? "orange" : "blue";
}
