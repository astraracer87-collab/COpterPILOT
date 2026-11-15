import { normalizeEd269Restriction } from "@/lib/ed269";
import { isZoneActiveInContext, type ZoneActivityInput } from "../../shared/ed269Restriction";

// Schweregrad-Klassifizierung für den seitlichen Geozonen-Reiter auf dem
// Radar-Screen. Reines, React-Native-freies Modul, damit Web/Tests es teilen
// können — die AV-/§21h-Abdeckungsprüfung (die auf storage.ts/AsyncStorage
// fußt) wird als Callback hereingereicht, statt hier importiert zu werden.

export interface GeozoneSeverityZone extends ZoneActivityInput {
  layerLabel: string;
  name: string;
  details: string;
  restriction?: string;
  upperMeters?: number;
  informationalOnly?: boolean;
}

// Aggregierter Reiter-Schweregrad. Reihenfolge (höchster gewinnt):
// red > orange > blue > green.
export type GeozoneTabSeverity = "red" | "orange" | "blue" | "green" | "unknown";

// Klartext-Marker eines echten Flugverbots/No-Go (deutsch/französisch/englisch),
// falls kein strukturiertes ED-269-`restriction`-Feld vorliegt.
const PROHIBITION_TEXT_RE =
  /flugverbot|sperrgebiet|verbotszone|vol\s+interdit|interdiction|no[\s-]?fly|prohibited|\bverboten\b/i;

// Klartext-Marker einer reinen Höhenbeschränkung.
const ALTITUDE_TEXT_RE =
  /maximale?\s+flugh[öo]he|max\.?\s*flugh[öo]he|h[öo]henbeschr[äa]nkung/i;

/**
 * Aktiv-Erkennung für Radar/Live-Karte (Zeitbezug: JETZT) über die eine
 * Aktivitätsprüfung zoneActivityAt (Gültigkeitsfenster, ED-269-applicability,
 * SR/SS). Zonen ohne strukturierte Zeitangaben sind aktiv; `unknown` zählt als
 * aktiv. Ersetzt das frühere Parsen von „Status: Inaktiv“/„Von:“ im Detailtext.
 */
export function isGeozoneActiveForRadar(z: ZoneActivityInput, now: number | Date = Date.now()): boolean {
  return isZoneActiveInContext(z, { kind: "now", now: now instanceof Date ? now : new Date(now) });
}

/**
 * Echtes Flugverbot/No-Go (vs. reine Höhenbeschränkung). Erkennt das
 * strukturierte ED-269-Feld `PROHIBITED` (AT/BE/DK) sowie Klartext-Marker wie
 * „Flugverbot" / „vol interdit". Deutsche §21h-„untersagt"-Zonen werden NICHT
 * hier, sondern über den optionalen Callback in `computeGeozoneTabSeverity`
 * (mapsToAvRule) erfasst, weil das die AV-Abdeckung wiederverwendet.
 */
export function isProhibitionZone(z: GeozoneSeverityZone): boolean {
  if (z.informationalOnly) return false;
  if (normalizeEd269Restriction(z.restriction || "") === "PROHIBITED") return true;
  return PROHIBITION_TEXT_RE.test(`${z.name}\n${z.details}`);
}

/**
 * Reine Höhenbeschränkung (z. B. max. 50/100 m). Erkennt das strukturierte
 * ED-269-Feld `RESTRICTED`, den Klartext „Maximale Flughöhe … m" sowie ein
 * vorhandenes oberes Höhenlimit.
 */
export function isAltitudeRestrictionZone(z: GeozoneSeverityZone): boolean {
  if (z.informationalOnly) return false;
  if (normalizeEd269Restriction(z.restriction || "") === "RESTRICTED") return true;
  if (ALTITUDE_TEXT_RE.test(`${z.name}\n${z.details}`)) return true;
  return typeof z.upperMeters === "number" && isFinite(z.upperMeters) && z.upperMeters > 0;
}

/**
 * Leitet aus allen Zonen den höchsten Reiter-Schweregrad ab:
 * - ROT: aktive Flugverbots-/No-Go-Zone ohne AV-Abdeckung.
 * - ORANGE: sonstige aktive Zone (Höhenbeschränkung oder AV-gedecktes Verbot).
 * - BLAU: Zone vorhanden, aber keine aktive Beschränkung.
 * - GRÜN: keine Zone.
 *
 * @param isCoveredByAV  Prüft, ob eine (Flugverbots-)Zone durch eine gültige
 *   AV/Sondergenehmigung des Piloten abgedeckt ist.
 * @param mapsToAvRule  Optional: markiert deutsche §21h-„untersagt"-Zonen
 *   zusätzlich als Flugverbot (per find21hRuleForLayer), damit eine nicht
 *   abgedeckte §21h-Zone rot statt orange wird.
 */
export function computeGeozoneTabSeverity(
  zones: GeozoneSeverityZone[],
  opts: {
    isCoveredByAV: (z: GeozoneSeverityZone) => boolean;
    mapsToAvRule?: (z: GeozoneSeverityZone) => boolean;
    now?: number;
  },
): GeozoneTabSeverity {
  if (!zones || zones.length === 0) return "green";
  const now = opts.now ?? Date.now();
  let hasActive = false;
  let hasRed = false;
  for (const z of zones) {
    if (z.informationalOnly) continue;
    if (!isGeozoneActiveForRadar(z, now)) continue;
    hasActive = true;
    const prohibition = isProhibitionZone(z) || (opts.mapsToAvRule?.(z) ?? false);
    if (prohibition && !opts.isCoveredByAV(z)) hasRed = true;
  }
  if (hasRed) return "red";
  if (hasActive) return "orange";
  return "blue";
}
