// Check-Builder der Prüfkette (B4) für Geozonen, Abdeckung, NOTAMs,
// Gegenprüfung und Compliance. Sie übersetzen die BESTEHENDE Logik
// (Policy-Klassifizierung aus client/lib/restrictionPlanning.ts,
// Abdeckungsstatus aus queryGeozonesInAreaWithCoverage, NOTAM-Fehlerstatus) in
// CheckResults – keine neuen Regeln. Wetter- und Nacht-Builder liegen in
// client/lib/flightChecks.ts (sie kapseln client/lib/assessment.ts).
//
// Reines Modul (kein React Native).

import type { CheckContext, CheckOverride, CheckResult, CheckTip } from "./types";

// ---------------------------------------------------------------------------
// Texte (einzige Quelle; client/lib/assessment.ts und notams.ts re-exportieren)
// ---------------------------------------------------------------------------

/** Text des NO-GO-Grunds bei aktiver Flugverbotszone (Protokoll/Tests). */
export const RESTRICTION_NOGO_TEXT = "Flugverbotszone im Umkreis – Flug nicht zulässig (NO-GO)";

export const RESTRICTION_NOGO_TIP: CheckTip = {
  title: "Flugverbotszone",
  description:
    "Am Standort liegt eine aktive Geozone mit Flugverbot (z. B. Sperrgebiet, Kernanlage, Justizvollzug). Ein Flug ist ohne Sondergenehmigung der zuständigen Behörde nicht zulässig.",
  practiceCheck:
    "Standort/Flughöhe/Zeit ändern oder – nur mit Sondergenehmigung – im Schritt „Einschränkungen“ die Begründung dokumentieren.",
};

export const RESTRICTION_APPROVED_TEXT = "Einschränkungen vorhanden - Genehmigung liegt vor";
export const RESTRICTION_LIMITED_TEXT = "Flug mit Einschränkungen - bitte Auflagen beachten";
export const RESTRICTION_UNCLEAR_TEXT = "Geozonen-Einschränkungen am Standort festgestellt";
export const RESTRICTION_NONE_TEXT = "Keine Geozonen-Einschränkungen am Standort festgestellt";

export const RESTRICTION_LIMITED_TIP: CheckTip = {
  title: "Flug mit Einschränkungen",
  description:
    "Am Standort gelten Geozonen-Auflagen (z. B. Höhenbegrenzung, Zeitfenster oder Genehmigungspflicht). Der Flug ist möglich, aber an Bedingungen geknüpft.",
  practiceCheck:
    "Prüfe die konkreten Auflagen der betroffenen Geozone und halte Genehmigungen/Aktenzeichen bereit. Notiere sie im Schritt „Einschränkungen“ für die Dokumentation.",
};

export const RESTRICTION_UNCLEAR_TIP: CheckTip = {
  title: "Geozonen-Einschränkungen",
  description:
    "Am Standort wurden Geozonen erkannt, deren Status noch nicht abschließend geklärt ist. Ein Flug kann je nach Zone genehmigungspflichtig oder verboten sein.",
  practiceCheck:
    "Kläre vor dem Flug den genauen Status der Geozone (dipul/Karte) und hole bei Bedarf die nötige Freigabe ein.",
};

export const NOTAM_STATUS_UNKNOWN_TEXT = "NOTAM-Status unbekannt – bitte manuell prüfen (z. B. DFS AIS / EAD)";

// ---------------------------------------------------------------------------
// Geozonen
// ---------------------------------------------------------------------------

export interface GeozoneZoneRef {
  name?: string | null;
  layerLabel?: string | null;
}

/** Strukturgleich zu PlanningZoneClassification (client/lib/restrictionPlanning.ts). */
export interface GeozoneClassLike<T> {
  openProhibitedZones: T[];
  overriddenZones: T[];
  unresolvedZones: T[];
  coveredZones: T[];
}

export type RestrictionStatusInput = "approved" | "limited" | undefined;

export interface GeozoneCheckInput<T extends GeozoneZoneRef> {
  context: CheckContext;
  /** Klassifizierungen der zur Kontextzeit aktiven, erreichbaren Zonen
   * (Geozonen, temporäre Beschränkungen). */
  classes: GeozoneClassLike<T>[];
  /** Override-Begründung + Zeitpunkt je überschriebenem Flugverbot. */
  overrideOf?: (z: T) => CheckOverride | null | undefined;
  /** Beschränkungen am Standort OHNE Abdeckungslücke (Zonen, temporäre
   * Beschränkungen, aktiver Tiefflug, Energie-Infrastruktur …). */
  hasRestrictions: boolean;
  /** Ergebnis der Einschränkungs-Stufe (Genehmigung/Auflagen/ungeklärt). */
  restrictionStatus?: RestrictionStatusInput;
  source?: string;
}

export function zoneRefName(z: GeozoneZoneRef | null | undefined): string {
  return String(z?.name || z?.layerLabel || "").trim();
}

function uniqueNames(zones: GeozoneZoneRef[]): string[] {
  const out: string[] = [];
  for (const z of zones) {
    const n = zoneRefName(z);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function prohibitedOpenResult(context: CheckContext, names: string[], source?: string): CheckResult {
  return {
    id: "geozone:prohibited",
    category: "geozone",
    severity: "nogo",
    title: RESTRICTION_NOGO_TEXT,
    detail: names.length > 0 ? `Betroffen: ${names.join(", ")}` : "",
    source,
    zoneRefs: names.length > 0 ? names : undefined,
    overridable: true,
    requiresConfirmation: true,
    emphasis: "warning",
    tip: RESTRICTION_NOGO_TIP,
    context,
  };
}

function restrictionStatusResult(
  context: CheckContext,
  hasRestrictions: boolean,
  status: RestrictionStatusInput,
  zoneRefs: string[],
  source?: string,
): CheckResult {
  const refs = zoneRefs.length > 0 ? zoneRefs : undefined;
  // Manuelle Angabe "Einschränkungen vorhanden" (Länder ohne eigene Daten)
  // zählt ebenfalls als Einschränkung (wie buildRestrictionSessionPatch).
  if (!hasRestrictions && status !== "limited") {
    return { id: "geozone:status", category: "geozone", severity: "info", title: RESTRICTION_NONE_TEXT, detail: "", source, context };
  }
  if (status === "approved") {
    return {
      id: "geozone:status",
      category: "geozone",
      severity: "info",
      title: RESTRICTION_APPROVED_TEXT,
      detail: "",
      source,
      zoneRefs: refs,
      context,
    };
  }
  if (status === "limited") {
    return {
      id: "geozone:status",
      category: "geozone",
      severity: "caution",
      title: RESTRICTION_LIMITED_TEXT,
      detail: RESTRICTION_LIMITED_TIP.description,
      source,
      zoneRefs: refs,
      emphasis: "caution",
      tip: RESTRICTION_LIMITED_TIP,
      context,
    };
  }
  return {
    id: "geozone:status",
    category: "geozone",
    severity: "caution",
    title: RESTRICTION_UNCLEAR_TEXT,
    detail: RESTRICTION_UNCLEAR_TIP.description,
    source,
    zoneRefs: refs,
    emphasis: "caution",
    tip: RESTRICTION_UNCLEAR_TIP,
    context,
  };
}

/**
 * Geozonen-Befunde aus der Policy-Klassifizierung:
 *  - offene Flugverbote (PROHIBITED ohne Begründung) → ein nogo-Befund,
 *  - überschriebene Flugverbote → je Zone ein nogo-Befund mit overriddenBy
 *    (zählt im Urteil als CAUTION),
 *  - Gesamtstatus der Einschränkungs-Stufe (wie bisher assessWeather):
 *    Genehmigung → info, Auflagen/ungeklärt → caution, keine → info.
 */
export function geozoneChecks<T extends GeozoneZoneRef>(input: GeozoneCheckInput<T>): CheckResult[] {
  const { context, source } = input;
  const out: CheckResult[] = [];
  const open = input.classes.flatMap((c) => c.openProhibitedZones);
  if (open.length > 0) out.push(prohibitedOpenResult(context, uniqueNames(open), source));
  const overridden = input.classes.flatMap((c) => c.overriddenZones);
  overridden.forEach((z, i) => {
    const name = zoneRefName(z) || "Flugverbotszone";
    const ov = input.overrideOf?.(z) ?? null;
    out.push({
      id: `geozone:prohibited-override:${i}`,
      category: "geozone",
      severity: "nogo",
      title: `Flugverbotszone bewusst übersteuert: ${name}`,
      detail: ov?.reason ? `Begründung: ${ov.reason}` : "",
      source,
      zoneRefs: [name],
      overridable: true,
      // Ohne gespeicherte Begründung bleibt es ein offenes Verbot.
      overriddenBy: ov && ov.reason.trim() ? { reason: ov.reason.trim(), at: ov.at } : undefined,
      requiresConfirmation: !(ov && ov.reason.trim()),
      emphasis: ov && ov.reason.trim() ? "caution" : "warning",
      tip: RESTRICTION_NOGO_TIP,
      context,
    });
  });
  const refs = uniqueNames(input.classes.flatMap((c) => [...c.unresolvedZones, ...c.coveredZones]));
  out.push(restrictionStatusResult(context, input.hasRestrictions, input.restrictionStatus, refs, source));
  return out;
}

export interface LegacyRestrictionInput {
  hasRestrictions?: boolean;
  restrictionStatus?: RestrictionStatusInput;
  restrictionVerdict?: "nogo" | "caution" | "info";
}

/**
 * Rückfall für Sessions/Routen ohne gespeicherte CheckResults (Altdaten,
 * Direkteinstieg): dieselben Befunde aus den bisherigen Feldern
 * hasRestrictions/restrictionStatus/restrictionVerdict.
 */
export function legacyGeozoneChecks(input: LegacyRestrictionInput, context: CheckContext): CheckResult[] {
  const out: CheckResult[] = [];
  if (input.restrictionVerdict === "nogo") out.push(prohibitedOpenResult(context, []));
  out.push(restrictionStatusResult(context, input.hasRestrictions === true, input.restrictionStatus, []));
  return out;
}

// ---------------------------------------------------------------------------
// Abdeckung
// ---------------------------------------------------------------------------

export type CoverageSourceStatus = "ok" | "stale" | "partial" | "missing" | "error" | "unsupported";

export interface CoverageSourceLike {
  iso: string;
  status: CoverageSourceStatus;
  fetchedAt?: number;
  note?: string;
}

/** Deutscher Warntext für eine Abdeckungslücke. */
export function geozoneCoverageWarning(countryLabel: string, note?: string): string {
  const base = `Geozonen-Daten für ${countryLabel} nicht verfügbar – Zonen bitte manuell prüfen.`;
  return note ? `${base} (${note})` : base;
}

/** Warntext je Quelle: "partial" -> unvollständig (mit Hinweis), sonst nicht verfügbar. */
export function sourceCoverageWarning(source: CoverageSourceLike, countryLabel: string): string {
  if (source.status === "partial") {
    return `Geozonen-Daten für ${countryLabel} unvollständig${source.note ? `: ${source.note}` : ""} – Zonen bitte manuell prüfen.`;
  }
  return geozoneCoverageWarning(countryLabel);
}

function formatDateDe(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export interface CoverageCheckInput {
  context: CheckContext;
  /** Quellen aus queryGeozonesInAreaWithCoverage (alle, auch ok/stale). */
  sources: CoverageSourceLike[];
  /** Abfrage komplett fehlgeschlagen (Ausnahme) → Status unbekannt. */
  queryFailed?: boolean;
  /** Land des Standorts (für den Text bei komplettem Fehlschlag). */
  primaryIso?: string | null;
  /** Länder, deren Lücke der Pilot bereits manuell geklärt hat (manueller
   * Flow im Standort-Schritt). */
  resolvedIsos?: string[];
  /** Ländername (deutsch) für den Text. */
  countryLabel?: (iso: string) => string;
}

/**
 * Abdeckungs-Befunde: fehlende/fehlerhafte/nicht unterstützte Quellen und
 * unvollständige Länder (z. B. DE ohne Wohngrundstücke) → "unknown"
 * (≥ CAUTION); veraltete Daten → Info mit Datenalter (wie bisher: zählen als
 * abgedeckt).
 */
export function coverageChecks(input: CoverageCheckInput): CheckResult[] {
  const label = (iso: string) => (input.countryLabel?.(iso) || iso || "den Standort");
  const resolved = new Set((input.resolvedIsos ?? []).map((s) => s.toUpperCase()));
  const out: CheckResult[] = [];
  const primary = (input.primaryIso || "").toUpperCase();
  if (input.queryFailed) {
    if (!(primary && resolved.has(primary))) {
      out.push({
        id: "coverage:query-failed",
        category: "coverage",
        severity: "unknown",
        title: geozoneCoverageWarning(primary ? label(primary) : "den Standort"),
        detail: "Die Geozonen-Abfrage ist fehlgeschlagen – der Status am Standort ist unbekannt.",
        emphasis: "caution",
        context: input.context,
      });
    }
    return out;
  }
  for (const s of input.sources) {
    const iso = String(s.iso || "").toUpperCase();
    if (s.status === "ok") continue;
    const dataAge = s.fetchedAt && Number.isFinite(s.fetchedAt)
      ? { fetchedAt: new Date(s.fetchedAt).toISOString(), stale: s.status === "stale" }
      : undefined;
    if (s.status === "stale") {
      out.push({
        id: `coverage:${iso}:stale`,
        category: "coverage",
        severity: "info",
        title: `Geozonen-Daten für ${label(iso)} nicht aktuell${s.fetchedAt ? ` (Stand ${formatDateDe(s.fetchedAt)})` : ""} – vor dem Start online aktualisieren.`,
        detail: s.note ?? "",
        dataAge: dataAge ?? undefined,
        context: input.context,
      });
      continue;
    }
    if (resolved.has(iso)) continue;
    out.push({
      id: `coverage:${iso}:${s.status}`,
      category: "coverage",
      severity: "unknown",
      title: sourceCoverageWarning(s, label(iso)),
      detail: s.note ?? "",
      dataAge,
      emphasis: "caution",
      context: input.context,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// NOTAMs
// ---------------------------------------------------------------------------

export interface NotamCheckInput {
  context: CheckContext;
  /** Abfrage fehlgeschlagen (z. B. HTTP 401) → Status unbekannt. */
  failed: boolean;
  /** Anzahl NOTAMs im Umkreis (null = nicht abgefragt). */
  count: number | null | undefined;
  source?: string;
}

/** NOTAM-Befund: Fehlschlag → "unknown"; sonst nur Info (Anzahl beeinflusst
 * das Urteil wie bisher nicht). Nicht abgefragt → kein Befund. */
export function notamChecks(input: NotamCheckInput): CheckResult[] {
  if (input.failed) {
    return [{
      id: "notam:status",
      category: "notam",
      severity: "unknown",
      title: NOTAM_STATUS_UNKNOWN_TEXT,
      detail: "Die NOTAM-Abfrage ist fehlgeschlagen – NOTAMs vor dem Flug manuell prüfen.",
      source: input.source,
      emphasis: "caution",
      context: input.context,
    }];
  }
  if (input.count == null) return [];
  return [{
    id: "notam:status",
    category: "notam",
    severity: "info",
    title: input.count === 0 ? "Keine NOTAMs im Umkreis" : `${input.count} NOTAM(s) im Umkreis – bitte beachten`,
    detail: "",
    source: input.source,
    context: input.context,
  }];
}

// ---------------------------------------------------------------------------
// Gegenprüfung offizielle Karte / Compliance
// ---------------------------------------------------------------------------

/** Gegenprüfung der offiziellen Staatskarte: "blocking" → CAUTION (wie bisher). */
export function officialMapCrossCheckChecks(
  crossCheck: { blocking: boolean; note?: string } | null | undefined,
  context: CheckContext,
): CheckResult[] {
  if (!crossCheck?.blocking) return [];
  return [{
    id: "other:official-map-crosscheck",
    category: "other",
    severity: "caution",
    title: crossCheck.note
      ? `Offizielle Karte: startverhindernde Geozonen gemeldet. Notiz: ${crossCheck.note}`
      : "Offizielle Karte: startverhindernde Geozonen gemeldet.",
    detail:
      "Du hast bei der Gegenprüfung der offiziellen Staatskarte angegeben, dass dort Geozonen einen Start verhindern würden. Bitte vor dem Flug prüfen.",
    emphasis: "caution",
    context,
  }];
}

export const ALPHA_TANGO_MISSING_TEXT =
  "FR: AlphaTango-Registrierung der Drohne fehlt – Fortsetzen im Protokoll dokumentiert";

/**
 * Compliance (light): nur was das Urteil heute schon beeinflusst. Die
 * Länder-Compliance (countryCompliance) wird nur angezeigt; einzig die
 * dokumentierte FR-AlphaTango-Lücke wirkt – über den Einschränkungsstatus
 * ("Auflagen") des Geozonen-Befunds. Hier daher nur als Info-Befund.
 */
export function complianceChecks(
  input: { alphaTangoMissingAcknowledged?: boolean },
  context: CheckContext,
): CheckResult[] {
  if (!input.alphaTangoMissingAcknowledged) return [];
  return [{
    id: "compliance:fr-alphatango",
    category: "compliance",
    severity: "info",
    title: ALPHA_TANGO_MISSING_TEXT,
    detail: "Für Drohnen ab 800 g MTOM ist in Frankreich die AlphaTango-Registrierung Pflicht (DGAC).",
    context,
  }];
}
