// Reine (React-Native-freie) Einstufung der Planungsliste über die Policy-
// Tabelle (shared/restrictionPolicy.ts). Der PlanningRestrictionsScreen und
// die Tests nutzen dieselbe Funktion, damit Liste, Bestätigungsdialog und
// Urteil (in der Session gespeichert) nicht auseinanderlaufen.
//
// Eingabe sind die zur geplanten Zeit aktiven, erreichbaren Zonen (Zeit- und
// Höhenfilter macht der Screen vorher).

import {
  assessZoneRestriction,
  maxRestrictionVerdict,
  zoneRestriction,
  type RestrictionVerdict,
  type RestrictionZoneLike,
  type ZoneAssessment,
} from "../../shared/restrictionPolicy";

export interface PlanningZoneOptions<T> {
  /** AV/Genehmigung des Piloten deckt die Zone (DE: § 21h-Landes-AV).
   * Wird nur für abdeckbare Einstufungen (REQ_AUTHORISATION) gefragt. */
  isCoveredByAV: (z: T) => boolean;
  /** Pilot hat eine Einzelgenehmigung für die Zone bestätigt. Für Verbote
   * (PROHIBITED) wirkungslos – dort zählt nur die Override-Begründung. */
  isExempted?: (z: T) => boolean;
  /** Dokumentierte Begründung, mit der ein Flugverbot überschrieben wird. */
  overrideReason?: (z: T) => string | null | undefined;
}

export interface PlanningZoneClassification<T> {
  /** NO_RESTRICTION: nur Info – keine Ausnahme, keine Bestätigung. */
  infoZones: T[];
  /** Durch AV/Genehmigung gedeckt (nur coverableByAuthorisation). */
  coveredZones: T[];
  /** Alle übrigen beschränkenden Zonen (brauchen Behandlung). */
  uncoveredZones: T[];
  /** Davon mit bestätigter Einzelgenehmigung (nie PROHIBITED). */
  exemptedZones: T[];
  /** Davon Flugverbote (PROHIBITED). */
  prohibitedZones: T[];
  /** Flugverbote mit dokumentierter Begründung (→ CAUTION). */
  overriddenZones: T[];
  /** Flugverbote ohne Begründung (→ NO-GO). */
  openProhibitedZones: T[];
  /** Ungedeckt, Policy verlangt Bestätigung, weder Ausnahme noch Override. */
  confirmationZones: T[];
  /** Ungedeckt und nicht durch Ausnahme erledigt (inkl. Overrides). */
  unresolvedZones: T[];
  /** Höchstes Urteil: nogo (offenes Verbot) > caution (ungelöste
   * Beschränkung) > info (nichts offen bzw. alles gedeckt/freigegeben). */
  verdict: RestrictionVerdict;
  assessment: (z: T) => ZoneAssessment;
}

export function hasOverrideReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim().length > 0;
}

export function classifyPlanningZones<T extends RestrictionZoneLike>(
  zones: T[],
  opts: PlanningZoneOptions<T>,
): PlanningZoneClassification<T> {
  const out: PlanningZoneClassification<T> = {
    infoZones: [],
    coveredZones: [],
    uncoveredZones: [],
    exemptedZones: [],
    prohibitedZones: [],
    overriddenZones: [],
    openProhibitedZones: [],
    confirmationZones: [],
    unresolvedZones: [],
    verdict: "info",
    assessment: () => {
      throw new Error("unknown zone");
    },
  };
  const assessments = new Map<T, ZoneAssessment>();
  const verdicts: RestrictionVerdict[] = [];
  for (const z of zones || []) {
    const restriction = zoneRestriction(z);
    const overridden = restriction === "PROHIBITED" && hasOverrideReason(opts.overrideReason?.(z));
    const covered = restriction === "REQ_AUTHORISATION" ? opts.isCoveredByAV(z) : false;
    const a = assessZoneRestriction(z, { active: true, covered, overridden });
    assessments.set(z, a);
    if (a.verdict === "info") {
      out.infoZones.push(z);
      continue;
    }
    if (a.coveredByAuthorisation) {
      out.coveredZones.push(z);
      continue;
    }
    out.uncoveredZones.push(z);
    const exempted = restriction !== "PROHIBITED" && (opts.isExempted?.(z) ?? false);
    if (exempted) out.exemptedZones.push(z);
    if (restriction === "PROHIBITED") {
      out.prohibitedZones.push(z);
      (overridden ? out.overriddenZones : out.openProhibitedZones).push(z);
    }
    if (!exempted) {
      out.unresolvedZones.push(z);
      verdicts.push(a.verdict);
      if (a.needsConfirmation && !overridden) out.confirmationZones.push(z);
    }
  }
  out.verdict = maxRestrictionVerdict(verdicts);
  out.assessment = (z: T) => {
    const a = assessments.get(z);
    if (!a) throw new Error("Zone nicht klassifiziert");
    return a;
  };
  return out;
}

/** Protokoll-Notiz für überschriebene Flugverbote. */
export function buildProhibitedOverrideNote<T extends RestrictionZoneLike>(
  zones: T[],
  reasonOf: (z: T) => string | null | undefined,
): string {
  const parts = zones
    .map((z) => {
      const reason = (reasonOf(z) ?? "").trim();
      const name = z.name || z.layerLabel || "";
      return name && reason ? `${name} (Begründung: ${reason})` : "";
    })
    .filter(Boolean);
  return parts.length > 0 ? `Flugverbot bewusst übersteuert: ${parts.join("; ")}` : "";
}
