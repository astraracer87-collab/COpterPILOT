// Aggregation der Prüfkette: EINE Funktion für das Gesamturteil in Planung und
// Pre-Check.
//
// Regeln:
//  - NO-GO nur, wenn ein nogo-Befund NICHT überschrieben ist
//    (überschriebenes nogo zählt als CAUTION),
//  - "unknown" zählt mindestens als CAUTION,
//  - sonst CAUTION bei mindestens einem caution-Befund, sonst GO,
//  - Gründe: alle Befunde ≠ info, stabil nach wirksamer Schwere absteigend
//    (nogo > unknown > caution), bei Gleichstand in Eingabereihenfolge.

import type { CheckAggregate, CheckCategory, CheckContext, CheckResult, CheckSeverity, FlightVerdict } from "./types";

/** Wirksame Schwere nach Override. */
export function effectiveSeverity(r: CheckResult): CheckSeverity {
  if (r.severity === "nogo" && r.overriddenBy && r.overriddenBy.reason.trim().length > 0) return "caution";
  return r.severity;
}

const RANK: Record<CheckSeverity, number> = { nogo: 3, unknown: 2, caution: 1, info: 0 };

export function severityRank(s: CheckSeverity): number {
  return RANK[s];
}

/** Stabil sortiert (wirksame Schwere absteigend). */
export function sortChecks(results: CheckResult[]): CheckResult[] {
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => RANK[effectiveSeverity(b.r)] - RANK[effectiveSeverity(a.r)] || a.i - b.i)
    .map((x) => x.r);
}

export function aggregate(results: readonly CheckResult[] | null | undefined): CheckAggregate {
  const list = (results ?? []).filter(Boolean) as CheckResult[];
  let verdict: FlightVerdict = "go";
  for (const r of list) {
    const s = effectiveSeverity(r);
    if (s === "nogo") {
      verdict = "nogo";
      break;
    }
    if (s === "caution" || s === "unknown") verdict = "caution";
  }
  const reasons = sortChecks(list.filter((r) => effectiveSeverity(r) !== "info"));
  return {
    verdict,
    reasons,
    requiresConfirmation: reasons.some((r) => r.requiresConfirmation === true),
  };
}

/** Grund im Protokoll-Format (FlightSession.reasons / AssessmentReason). */
export interface SessionReason {
  type: FlightVerdict;
  message: string;
}

export const ALL_CHECKS_CLEAR_TEXT = "Alle Prüfungen ohne Befund – Bedingungen innerhalb der Limits";

/** Gründe für FlightSession.reasons (Logbuch/PDF): jeder wirksame Befund als
 * nogo bzw. caution; ohne Befund ein GO-Grund. */
export function sessionReasonsFromChecks(results: readonly CheckResult[] | null | undefined): SessionReason[] {
  const agg = aggregate(results);
  if (agg.reasons.length === 0) return [{ type: "go", message: ALL_CHECKS_CLEAR_TEXT }];
  return agg.reasons.map((r) => ({
    type: effectiveSeverity(r) === "nogo" ? "nogo" : "caution",
    message: r.overriddenBy ? `${r.title} – übersteuert (Begründung: ${r.overriddenBy.reason})` : r.title,
  }));
}

export const ALL_CHECK_CATEGORIES: readonly CheckCategory[] = [
  "geozone", "coverage", "notam", "weather", "night", "compliance", "other",
];

/**
 * Ersetzt in `existing` alle Befunde der Kategorien `categories` (optional nur
 * die eines Kontexts) durch `incoming` (Reihenfolge: übrige bestehende, dann
 * neue). So schreibt jede Stufe nur ihre eigenen Befunde in die Session;
 * Planungs- und Pre-Check-Befunde bleiben nebeneinander erhalten.
 */
export function replaceCheckCategories(
  existing: readonly CheckResult[] | null | undefined,
  incoming: readonly CheckResult[],
  categories: readonly CheckCategory[],
  context?: CheckContext,
): CheckResult[] {
  const drop = new Set<CheckCategory>(categories);
  return [
    ...(existing ?? []).filter((r) => !(drop.has(r.category) && (context === undefined || r.context === context))),
    ...incoming,
  ];
}

/** Befunde eines Kontexts und optional bestimmter Kategorien. */
export function checksFor(
  results: readonly CheckResult[] | null | undefined,
  context: CheckResult["context"],
  categories?: readonly CheckCategory[],
): CheckResult[] {
  const cats = categories ? new Set<CheckCategory>(categories) : null;
  return (results ?? []).filter((r) => r.context === context && (!cats || cats.has(r.category)));
}
