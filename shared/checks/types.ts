// Prüfkette (B4): ein typisiertes Prüfergebnis je Befund. Planung und
// Pre-Check bauen dieselben CheckResults, speichern sie in der Flugsession und
// bilden das Gesamturteil ausschließlich über aggregate() (shared/checks/aggregate.ts).
//
// Reines Modul (kein React Native).

/** Schwere eines Befunds. "unknown" = Status nicht feststellbar (fehlende
 * Daten, Abfragefehler) und zählt im Urteil mindestens als CAUTION. */
export type CheckSeverity = "info" | "caution" | "nogo" | "unknown";

export type CheckCategory =
  | "geozone"
  | "coverage"
  | "notam"
  | "weather"
  | "night"
  | "compliance"
  | "other";

/** Gesamturteil. */
export type FlightVerdict = "go" | "caution" | "nogo";

/** Zeitbezug, in dem ein Befund erhoben wurde (Planung: geplante Zeit;
 * Pre-Check: jetzt bzw. jetzt ODER geplant, siehe zoneActivityAt). */
export type CheckContext = "planning" | "precheck";

/** Erläuterung für den Info-Dialog (wie ExpertTip in client/lib/assessment). */
export interface CheckTip {
  title: string;
  description: string;
  practiceCheck?: string;
}

/** Überschrittenes Drohnen-Limit (strukturgleich zu LimitExceedance in
 * client/lib/droneRecommendation.ts) – ermöglicht die Drohnen-Empfehlung. */
export interface CheckExceedance {
  kind: "wind" | "gusts" | "temp" | "tempMax";
  value: number;
  limit: number;
  height?: number;
}

export interface CheckOverride {
  /** Dokumentierte Begründung des Piloten. */
  reason: string;
  /** ISO-Zeitstempel. */
  at: string;
}

export interface CheckDataAge {
  /** ISO-Zeitstempel des Datenbestands. */
  fetchedAt: string;
  stale: boolean;
}

export interface CheckResult {
  /** Stabile ID (z. B. "geozone:prohibited", "weather:3"). */
  id: string;
  category: CheckCategory;
  severity: CheckSeverity;
  /** Kurzer deutscher Befundtext (erscheint als Grund im Protokoll). */
  title: string;
  /** Erläuterung (deutsch), darf leer sein. */
  detail: string;
  source?: string;
  /** Betroffene Zonen (Name bzw. Layer). */
  zoneRefs?: string[];
  /** Pilot darf ein NO-GO mit Begründung überschreiben (PROHIBITED). */
  overridable?: boolean;
  /** Überschrieben → zählt im Urteil als CAUTION statt NO-GO. */
  overriddenBy?: CheckOverride;
  dataAge?: CheckDataAge;
  /** Erheblicher Befund: Pilot muss vor dem Speichern ausdrücklich bestätigen
   * (entspricht requiresConfirmation von assessWeather). */
  requiresConfirmation?: boolean;
  /** Darstellung: "warning" = rot (erheblich), sonst orange. */
  emphasis?: "warning" | "caution";
  tip?: CheckTip;
  exceedance?: CheckExceedance;
  /** Kontext, in dem der Befund erhoben wurde. */
  context?: CheckContext;
}

export interface CheckAggregate {
  verdict: FlightVerdict;
  /** Alle Befunde mit Einfluss (Schwere ≠ info), stabil nach wirksamer
   * Schwere absteigend sortiert. */
  reasons: CheckResult[];
  /** Mindestens ein Befund verlangt eine ausdrückliche Bestätigung. */
  requiresConfirmation: boolean;
}
