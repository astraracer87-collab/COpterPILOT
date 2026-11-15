// Teil A: dauerhafte vs. temporäre Geozonen – EINE Regel.
//
// Eine Zone gilt als TEMPORÄR, wenn mindestens eines zutrifft:
//  1. die Quelle markiert sie als NOTAM-artig: `isNotam` (EE, NO, SE),
//     `_notamEligible`, oder die Registry-Flags `notamFromLiveFlag` (BE
//     skeyes-Live-Zonen) bzw. `notamFromApplicability` (AT: zeitgesteuerte
//     applicability-Einträge) – siehe ed269IsNotamEligible;
//  2. sie stammt aus einer Temporär-Ebene (DE dipul
//     „temporaere_betriebseinschraenkungen“ = Ebene „Temporäre Beschränkungen“,
//     NO „obs_sanntid_fareomrader“ (Echtzeit-Gefahrengebiete), LU-TSA,
//     HR-Reservierungen, IS-Sperrungen, LV-/ES-NOTAM-Ebenen – diese
//     Normalisierer setzen dafür ein Gültigkeitsfenster bzw. `isNotam`);
//  3. ihr Gültigkeitsfenster (Start UND Ende) ist kürzer als
//     TEMPORARY_ZONE_MAX_VALIDITY_DAYS (30 Tage, gleiche Grenze wie die
//     NOTAM-Liste `maxValidityDays`).
// Alles andere (kein Fenster, „permanent“, Platzhalter-Ende 2100 der
// Frequentis-Plattform, AIRAC-Gültigkeit NL) ist DAUERHAFT.
//
// Temporäre Zonen: online immer frisch (≤ 10 min Cache), offline mit Alter;
// älter als 24 h → Abdeckung „Temporäre Beschränkungen nicht aktuell“.
// Dauerhafte Zonen: lokal zuerst, Warnung erst nach 28 Tagen (AIRAC).
//
// Reines Modul (kein React Native).

import { ed269IsNotamEligible, ed269ValidityFromProps } from "./ed269Restriction";

export const TEMPORARY_ZONE_MAX_VALIDITY_DAYS = 30;
const MAX_VALIDITY_MS = TEMPORARY_ZONE_MAX_VALIDITY_DAYS * 86_400_000;

/** Ebenen-Bezeichnungen der Temporär-Ebenen (GeozoneFeatureInfo.layerLabel). */
export const TEMPORARY_LAYER_LABELS = ["Temporäre Beschränkungen", "LU Aktivierbare UAS-Zonen"];
/**
 * Temporär-Ebenen nach Roh-`_layer`: dipul-Ebene der temporären
 * Betriebseinschränkungen; NO dronesoner.no „obs_sanntid_fareomrader“
 * (Echtzeit-aktivierte Gefahrengebiete, live).
 */
export const TEMPORARY_LAYER_IDS = ["temporaere_betriebseinschraenkungen", "obs_sanntid_fareomrader"];

function shortWindow(start: number | null | undefined, end: number | null | undefined): boolean {
  return start != null && end != null && Number.isFinite(start) && Number.isFinite(end) && end - start < MAX_VALIDITY_MS;
}

/** Regel für Roh-Features (Properties eines ED-269-/Vektor-Features). */
export function isTemporaryGeozoneProps(props: Record<string, any> | null | undefined, countryIso: string): boolean {
  const p = props ?? {};
  if (p.isNotam === true || p._notamEligible === true) return true;
  if (TEMPORARY_LAYER_IDS.includes(String(p._layer ?? p.layer ?? ""))) return true;
  if (ed269IsNotamEligible(p, countryIso)) return true;
  const v = ed269ValidityFromProps(p);
  return shortWindow(v.validStartTs, v.validEndTs);
}

export interface TemporaryZoneLike {
  layerLabel?: string | null;
  notamEligible?: boolean;
  validStartTs?: number | null;
  validEndTs?: number | null;
}

/** Regel für normalisierte Zonen (GeozoneFeatureInfo). */
export function isTemporaryGeozone(z: TemporaryZoneLike | null | undefined): boolean {
  if (!z) return false;
  if (z.notamEligible === true) return true;
  if (z.layerLabel && TEMPORARY_LAYER_LABELS.includes(z.layerLabel)) return true;
  return shortWindow(z.validStartTs, z.validEndTs);
}
