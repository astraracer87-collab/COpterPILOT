import type { GeoJsonGeometryLike } from "./germanEnergyInfrastructure";
import type { Restriction } from "./restrictionPolicy";
import type { Height, VRef } from "./heights";

/** Conditional legal guidance, never a machine-readable flight clearance. */
export interface InfrastructureFlightRule {
  id: string;
  title: string;
  condition: string;
  guidance: string;
  legalBasis: string;
  sources: { label: string; url: string }[];
}

export interface InfrastructureFlightGuidance {
  checkedOn: string;
  limitation: string;
  rules: InfrastructureFlightRule[];
  authority: { name: string; remit: string; url: string; email?: string };
}

/** Shared map/detail data; importing this type never pulls in a platform API. */
export interface GeozoneFeatureInfo {
  /** Remains informational even when conditional legal guidance is supplied. */
  informationalOnly?: boolean;
  infrastructureFlightGuidance?: InfrastructureFlightGuidance;
  infrastructureGeometry?: GeoJsonGeometryLike;
  layerLabel: string;
  name: string;
  details: string;
  featureId?: string;
  /** Kennung der Quelle für Verknüpfungen (ES: IDENT_TXT der Sperrgebiete ↔
   * NOTAM-affectedElement); nur Anzeige, nie für Einstufungen. */
  sourceIdent?: string;
  polygonRings?: [number, number][][];
  /** One entry per polygon: outer ring followed by holes. */
  polygonGroups?: [number, number][][][];
  country?: string;
  /** Geschlossene Einstufung (shared/restrictionPolicy.ts). Policy-Tabelle
   * entscheidet Farbe, Label, Liste, Radar-Reiter und Urteil. Für Altdaten aus
   * dem Cache immer über zoneRestriction() lesen. */
  restriction: Restriction;
  /** Rohwert der Quelle (z. B. "REQ_AUTHORIZATION", "AUTHORISATION") – nur
   * zur Anzeige, nie für Entscheidungen. */
  restrictionRaw?: string;
  fillColor?: string;
  strokeColor?: string;
  /** Kompatibilität: Meter ohne Bezug. Maßgeblich sind `lower`/`upper`. */
  lowerMeters?: number;
  upperMeters?: number;
  /** Strukturierte Grenzen mit Bezug (shared/heights.ts, Umbau B3). Neue
   * Logik liest diese; lowerMeters/upperMeters bleiben parallel befüllt. */
  lower?: Height;
  upper?: Height;
  /** Anzeige mit Bezug, z. B. „GND – 1500 ft AMSL (457 m)“. */
  altitudeLabel?: string;
  /** Hard validity window (ms, end inclusive); null/absent = open. Set by all
   * structured paths (ED-269 vector, DE WFS/tile-store temp zones, CZ ED-318,
   * NOTAM-like records, LU WMS temp zones). Evaluated by zoneActivityAt
   * (shared/ed269Restriction.ts) – never decided at parse time. */
  validStartTs?: number | null;
  validEndTs?: number | null;
  scheduleText?: string[];
  /** Raw ED-269 applicability[] of time-dependent zones (evaluated by
   * zoneActivityAt). Absent for permanent zones and text-only sources, which
   * zoneActivityAt treats as active. */
  ed269Applicability?: any[];
  /** A temporary/NOTAM record may be eligible even without validity dates. */
  notamEligible?: boolean;
  applicationText?: string;
  links?: { label: string; url: string }[];
  /** Bezug der Untergrenze. UNKNOWN wird vom Höhenfilter nie ausgeblendet. */
  lowerReference?: VRef;
  /** Bezug der Obergrenze (ging früher verloren, z. B. SE „0 AGL / 1500 ft AMSL“). */
  upperReference?: VRef;
  /** Explicit maximum flight height AGL (m) allowed without authorisation, e.g.
   * SE CTR/TIZ/ATZ 50 m (normalisers: openCategoryMaxAglMeters). The only
   * structured field that may clear a zone by altitude — upperMeters is the top
   * of the restricted volume, NOT a height limit (ED-269). */
  maxFlightHeightAglM?: number;
}
