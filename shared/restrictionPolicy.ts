// Geschlossene Einstufung (Restriction) und EINE Policy-Tabelle für alle
// Geozonen-Quellen. Farbe, Label, Planungsliste, Radar-Reiter, Kartenstil und
// Urteil lesen ausschließlich aus RESTRICTION_POLICY – keine eigenen Farb-/
// Schwere-Tabellen mehr in Screens oder Normalisierern.
//
// Reines Modul (kein React Native), damit Client, Tests und künftige Server-
// Teile dieselbe Klassifizierung verwenden.

/** Geschlossene Einstufung einer Geozone. */
export type Restriction =
  | "PROHIBITED"
  | "RESTRICTED"
  | "REQ_AUTHORISATION"
  | "CONDITIONAL"
  | "NATURE"
  | "NO_RESTRICTION"
  | "UNKNOWN";

export const RESTRICTIONS: readonly Restriction[] = [
  "PROHIBITED",
  "RESTRICTED",
  "REQ_AUTHORISATION",
  "CONDITIONAL",
  "NATURE",
  "NO_RESTRICTION",
  "UNKNOWN",
] as const;

export type RestrictionVerdict = "nogo" | "caution" | "info";

export interface RestrictionPolicyEntry {
  /** 1 = Info … 4 = Verbot. */
  severity: 1 | 2 | 3 | 4;
  labelDe: string;
  explanationDe: string;
  /** Volltonfarbe für Liste/Badge/Rand. */
  color: string;
  /** Kartenstil (Polygonfüllung/-rand). */
  fill: string;
  stroke: string;
  /** Urteil, wenn die Zone aktiv und erreichbar ist (ohne Abdeckung/Override). */
  verdict: RestrictionVerdict;
  /** Muss der Pilot die Zone vor dem Weiterplanen ausdrücklich bestätigen? */
  requiresConfirmation: boolean;
  /** Kann eine AV/Genehmigung des Piloten die Zone abdecken? */
  coverableByAuthorisation: boolean;
  /** Darf der Pilot ein NO-GO mit dokumentierter Begründung überschreiben? */
  overridableWithReason: boolean;
}

export const RESTRICTION_POLICY: Record<Restriction, RestrictionPolicyEntry> = {
  PROHIBITED: {
    severity: 4,
    labelDe: "Flugverbot",
    explanationDe:
      "Drohnenflug in dieser Zone ist verboten. NO-GO – nur mit dokumentierter Begründung (z. B. Sondergenehmigung der Behörde) überschreibbar.",
    color: "#FF3B30",
    fill: "rgba(255,59,48,0.20)",
    stroke: "rgba(255,59,48,0.95)",
    verdict: "nogo",
    requiresConfirmation: true,
    coverableByAuthorisation: false,
    overridableWithReason: true,
  },
  RESTRICTED: {
    severity: 3,
    labelDe: "Sperr-/Beschränkungsgebiet – Freigabe nötig",
    explanationDe:
      "Einflug nur mit Freigabe der zuständigen Stelle (z. B. Durchfluggenehmigung, Flugverkehrskontrollfreigabe). Ohne Freigabe nicht fliegen.",
    color: "#FF6347",
    fill: "rgba(255,99,71,0.18)",
    stroke: "rgba(255,69,58,0.95)",
    verdict: "caution",
    requiresConfirmation: true,
    coverableByAuthorisation: false,
    overridableWithReason: false,
  },
  REQ_AUTHORISATION: {
    severity: 3,
    labelDe: "Genehmigung erforderlich",
    explanationDe:
      "Flug nur mit Genehmigung/Zustimmung der zuständigen Stelle. Eine passende Allgemeinverfügung oder Einzelgenehmigung kann die Zone abdecken.",
    color: "#FF9500",
    fill: "rgba(255,149,0,0.18)",
    stroke: "rgba(255,149,0,0.95)",
    verdict: "caution",
    requiresConfirmation: true,
    coverableByAuthorisation: true,
    overridableWithReason: false,
  },
  CONDITIONAL: {
    severity: 2,
    labelDe: "Bedingt zulässig",
    explanationDe: "Flug unter Auflagen zulässig (z. B. Höhe, Zeit, Anmeldung). Auflagen der Zone beachten.",
    color: "#F5B800",
    fill: "rgba(255,204,0,0.18)",
    stroke: "rgba(255,159,10,0.95)",
    verdict: "caution",
    requiresConfirmation: false,
    coverableByAuthorisation: false,
    overridableWithReason: false,
  },
  NATURE: {
    severity: 2,
    labelDe: "Naturschutz",
    explanationDe: "Naturschutzgebiet: Schutzvorschriften (teils saisonal) beachten, Tiere nicht stören.",
    color: "#2E7D32",
    fill: "rgba(46,125,50,0.22)",
    stroke: "rgba(27,94,32,0.95)",
    verdict: "caution",
    requiresConfirmation: false,
    coverableByAuthorisation: false,
    overridableWithReason: false,
  },
  UNKNOWN: {
    severity: 2,
    labelDe: "Einstufung unbekannt",
    explanationDe: "Die Quelle liefert keine verwertbare Einstufung. Zone vor dem Flug in der offiziellen Karte prüfen.",
    color: "#8E8E93",
    fill: "rgba(142,142,147,0.18)",
    stroke: "rgba(99,99,102,0.9)",
    verdict: "caution",
    requiresConfirmation: false,
    coverableByAuthorisation: false,
    overridableWithReason: false,
  },
  NO_RESTRICTION: {
    severity: 1,
    labelDe: "Keine Beschränkung (Info)",
    explanationDe: "Reine Informationszone ohne Beschränkung für den Drohnenflug.",
    color: "#34C759",
    fill: "rgba(52,199,89,0.15)",
    stroke: "rgba(52,199,89,0.9)",
    verdict: "info",
    requiresConfirmation: false,
    coverableByAuthorisation: false,
    overridableWithReason: false,
  },
};

export function isRestriction(v: unknown): v is Restriction {
  return typeof v === "string" && (RESTRICTIONS as readonly string[]).includes(v);
}

const RESTRICTION_ALIASES: Record<string, Restriction> = {
  // Genehmigungspflicht (ED-269 REQ_AUTHORISATION, ED-318 REQ_AUTHORIZATION …)
  REQ_AUTH: "REQ_AUTHORISATION",
  REQ_AUTHORISATION: "REQ_AUTHORISATION",
  REQ_AUTHORIZATION: "REQ_AUTHORISATION",
  AUTHORISATION: "REQ_AUTHORISATION",
  AUTHORIZATION: "REQ_AUTHORISATION",
  REQUIRES_AUTHORISATION: "REQ_AUTHORISATION",
  REQUIRES_AUTHORIZATION: "REQ_AUTHORISATION",
  AUTHORISATION_REQUIRED: "REQ_AUTHORISATION",
  AUTHORIZATION_REQUIRED: "REQ_AUTHORISATION",
  // Verbot
  PROHIBITED: "PROHIBITED",
  PROHIBITION: "PROHIBITED",
  FORBIDDEN: "PROHIBITED",
  NO_FLY: "PROHIBITED",
  NOFLY: "PROHIBITED",
  // Sperr-/Beschränkungsgebiet
  RESTRICTED: "RESTRICTED",
  RESTRICTION: "RESTRICTED",
  // Auflagen
  CONDITIONAL: "CONDITIONAL",
  CONDITIONS: "CONDITIONAL",
  CONDITION: "CONDITIONAL",
  // Nur Information
  NO_RESTRICTION: "NO_RESTRICTION",
  NO_RESTRICTIONS: "NO_RESTRICTION",
  NONE: "NO_RESTRICTION",
  INFORMATION: "NO_RESTRICTION",
  INFORMATIONAL: "NO_RESTRICTION",
  INFO: "NO_RESTRICTION",
  // Naturschutz
  NATURE: "NATURE",
  NATURSCHUTZ: "NATURE",
  NATURA: "NATURE",
  NATURA_2000: "NATURE",
  NATURA2000: "NATURE",
  // Explizit unbekannt
  UNKNOWN: "UNKNOWN",
};

/**
 * Bildet jede Schreibweise aus allen Quellen auf die geschlossene Union ab.
 * Akzeptiert Strings und ED-269-Objekte `{ type: "…" }`. Leer, unbekannt oder
 * nicht lesbar → "UNKNOWN" (nie ein durchgereichter Rohwert).
 */
export function normalizeRestriction(raw: unknown): Restriction {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as any).type : raw;
  if (value == null) return "UNKNOWN";
  const v = String(value).toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (!v) return "UNKNOWN";
  return RESTRICTION_ALIASES[v] ?? "UNKNOWN";
}

export function restrictionPolicy(r: unknown): RestrictionPolicyEntry {
  return RESTRICTION_POLICY[isRestriction(r) ? r : normalizeRestriction(r)];
}

export function restrictionLabelDe(r: unknown): string {
  return restrictionPolicy(r).labelDe;
}

export function restrictionColors(r: unknown): { fill: string; stroke: string } {
  const p = restrictionPolicy(r);
  return { fill: p.fill, stroke: p.stroke };
}

const VERDICT_RANK: Record<RestrictionVerdict, number> = { info: 0, caution: 1, nogo: 2 };

/** Höchstes Urteil (nogo > caution > info); leere Liste → info. */
export function maxRestrictionVerdict(verdicts: Iterable<RestrictionVerdict | null | undefined>): RestrictionVerdict {
  let best: RestrictionVerdict = "info";
  for (const v of verdicts) {
    if (v && VERDICT_RANK[v] > VERDICT_RANK[best]) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Deutschland (dipul): Einstufung aus Layer / type_code
// ---------------------------------------------------------------------------

// Textmarker, dass eine temporäre Betriebseinschränkung KEIN Verbot ist
// (z. B. „Flugbeschränkung … mit Genehmigung zulässig“).
const DE_TEMP_NOT_PROHIBITED_RE =
  /genehmigung|zustimmung|freigabe|erlaubnis|zulässig|zulaessig|bedingt|auflage|hinweis/i;

/**
 * Einstufung deutscher dipul-Zonen. dipul liefert keine ED-269-Einstufung,
 * daher aus Layer-ID (`wmsLayer`), Layer-Label bzw. type_code abgeleitet –
 * mit der Semantik der bisherigen DE-Logik (§ 21h-Katalog in storage.ts):
 *  - Flugbeschränkungsgebiete (ED-R): RESTRICTED (BAF-Durchfluggenehmigung,
 *    Einflug ohne Genehmigung Straftat; nie über eine Landes-AV gedeckt).
 *  - Kontrollzonen (CTR) / Flughäfen: REQ_AUTHORISATION (FVK-Freigabe der
 *    Flugsicherung einholbar; nie über eine Landes-AV gedeckt).
 *  - Flugplätze / HEMS, Modellflugplätze, Hängegleiter: CONDITIONAL („bedingt
 *    zulässig“ – Koordination mit dem Betreiber, kein Flugverbot).
 *  - Temporäre Betriebseinschränkungen: PROHIBITED, außer der Text nennt eine
 *    Genehmigungs-/Zustimmungsmöglichkeit (dann REQ_AUTHORISATION).
 *  - Alle übrigen § 21h-Kategorien (Wohngrundstücke, Bundesfern-/Wasser-
 *    straßen, Bahn, Industrie/Energie, Behörden, Naturschutz, Krankenhäuser,
 *    Freibäder …): REQ_AUTHORISATION („untersagt ohne Zustimmung“ – AV bzw.
 *    Zustimmung kann abdecken; ob eine Landes-AV tatsächlich deckt, entscheidet
 *    weiterhin isDe21hZoneAvEligible).
 * Naturschutz bleibt bewusst REQ_AUTHORISATION statt NATURE: in DE ist der
 * Betrieb ohne Genehmigung der Naturschutzbehörde untersagt (bisher roter
 * Reiter), NATURE wäre nur „Hinweis/Caution“.
 */
export function deRestrictionForLayer(layerIdOrLabel: string | null | undefined, text = ""): Restriction {
  const l = String(layerIdOrLabel ?? "").toLowerCase();
  if (!l && !text) return "UNKNOWN";
  if (/temporaere_betriebseinschraenkungen|tempor(ä|ae)re/.test(l)) {
    return DE_TEMP_NOT_PROHIBITED_RE.test(text) ? "REQ_AUTHORISATION" : "PROHIBITED";
  }
  if (/flugbeschraenkungsgebiet|flugbeschränkungsgebiet|ed-r\b|\(ed-r\)/.test(l)) return "RESTRICTED";
  if (/kontrollzon|\bctr\b|flughaefen|flughäfen|flughafen/.test(l)) return "REQ_AUTHORISATION";
  if (/modellflug|haengegleiter|hängegleiter|flugpl(ä|ae)tze|flugplatz|hems|hubschrauber/.test(l)) {
    return "CONDITIONAL";
  }
  return "REQ_AUTHORISATION";
}

// ---------------------------------------------------------------------------
// Text-Rückfall (nur für reine Textquellen ohne strukturierte Einstufung)
// ---------------------------------------------------------------------------

/** Klartext-Marker eines echten Flugverbots (DE/FR/EN/NL). Nur Rückfall für
 * Zonen OHNE strukturierte Einstufung (WMS-GetFeatureInfo FR/LU/CH/NL). */
export const NO_FLY_TEXT_RE =
  /(flugverbot|verboten|gesperrt|sperrgebiet|verbotszone|vol\s+interdit|interdit|interdiction|prohibit|forbidden|no[\s-]?fly|geen\s+drone|verboden|überflug ist strafbar)/i;

const AUTH_TEXT_RE = /(genehmigung|autorisation|authori[sz]ation|toestemming|bewilligung|zustimmung)/i;

/** Text-Heuristik für reine Textzonen: Verbot → PROHIBITED, Genehmigung →
 * REQ_AUTHORISATION, sonst UNKNOWN. */
export function restrictionFromText(text: string | null | undefined): Restriction {
  const t = String(text ?? "");
  if (!t.trim()) return "UNKNOWN";
  if (NO_FLY_TEXT_RE.test(t)) return "PROHIBITED";
  if (AUTH_TEXT_RE.test(t)) return "REQ_AUTHORISATION";
  return "UNKNOWN";
}

export interface RestrictionZoneLike {
  restriction?: string | null;
  country?: string | null;
  layerLabel?: string | null;
  name?: string | null;
  details?: string | null;
  informationalOnly?: boolean;
}

/**
 * DIE Einstufung einer geparsten Zone. Strukturierte Einstufung hat Vorrang;
 * fehlt sie (Altdaten aus Cache, DE-WMS, Text-WMS), wird für DE aus dem Layer
 * abgeleitet, sonst per Text-Rückfall. Reine Hinweis-Zonen
 * (informationalOnly) sind NO_RESTRICTION.
 */
export function zoneRestriction(z: RestrictionZoneLike | null | undefined): Restriction {
  if (!z) return "UNKNOWN";
  if (z.informationalOnly) return "NO_RESTRICTION";
  const structured = normalizeRestriction(z.restriction);
  if (structured !== "UNKNOWN") return structured;
  const iso = String(z.country ?? "").toUpperCase();
  const text = `${z.name ?? ""}\n${z.details ?? ""}`;
  if (iso === "DE") return deRestrictionForLayer(z.layerLabel, text);
  return restrictionFromText(text);
}

export function zonePolicy(z: RestrictionZoneLike | null | undefined): RestrictionPolicyEntry {
  return RESTRICTION_POLICY[zoneRestriction(z)];
}

// ---------------------------------------------------------------------------
// Zonen-Darstellung (Liste ↔ Radar-Reiter ↔ Karte) aus der Policy
// ---------------------------------------------------------------------------

export type ZoneTabColor = "red" | "orange" | "blue";

export interface ZoneAssessmentInput {
  /** Aktiv zum Zeitpunkt des Kontexts (zoneActivityAt). */
  active: boolean;
  /** Durch AV/Genehmigung des Piloten gedeckt (nur wirksam, wenn die Policy
   * coverableByAuthorisation erlaubt). */
  covered?: boolean;
  /** Pilot hat ein PROHIBITED-NO-GO mit Begründung überschrieben. */
  overridden?: boolean;
}

export interface ZoneAssessment {
  restriction: Restriction;
  policy: RestrictionPolicyEntry;
  /** Wirksames Urteil nach Aktivität, Abdeckung und Override. */
  verdict: RestrictionVerdict;
  /** Farbe des Reiters/der Hervorhebung: rot = ungedeckt Schwere ≥ 3,
   * orange = sonstige aktive Beschränkung, blau = nur Info/inaktiv. */
  tab: ZoneTabColor;
  /** Abdeckung durch AV/Genehmigung war wirksam. */
  coveredByAuthorisation: boolean;
  /** Pilot muss die Zone bestätigen (ungedeckt, Policy verlangt es). */
  needsConfirmation: boolean;
}

/**
 * Bewertet eine Zone über die Policy. Einzige Stelle, an der Aktivität,
 * AV-Abdeckung und Override zu Urteil + Reiterfarbe werden – Planungsliste
 * und Radar-Reiter nutzen dieselbe Funktion (gleiche Farbe für dieselbe Zone).
 */
export function assessZoneRestriction(z: RestrictionZoneLike, input: ZoneAssessmentInput): ZoneAssessment {
  const restriction = zoneRestriction(z);
  const policy = RESTRICTION_POLICY[restriction];
  const coveredByAuthorisation = !!input.covered && policy.coverableByAuthorisation;
  if (!input.active || policy.verdict === "info") {
    return { restriction, policy, verdict: "info", tab: "blue", coveredByAuthorisation, needsConfirmation: false };
  }
  if (coveredByAuthorisation) {
    return { restriction, policy, verdict: "caution", tab: "orange", coveredByAuthorisation, needsConfirmation: false };
  }
  let verdict: RestrictionVerdict = policy.verdict;
  if (verdict === "nogo" && input.overridden && policy.overridableWithReason) verdict = "caution";
  const tab: ZoneTabColor = policy.severity >= 3 && !(input.overridden && policy.overridableWithReason) ? "red" : "orange";
  return {
    restriction,
    policy,
    verdict,
    tab,
    coveredByAuthorisation,
    needsConfirmation: policy.requiresConfirmation,
  };
}
