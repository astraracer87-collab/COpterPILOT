import type { GeoJsonGeometryLike } from "./germanEnergyInfrastructure";

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
  polygonRings?: [number, number][][];
  /** One entry per polygon: outer ring followed by holes. */
  polygonGroups?: [number, number][][][];
  country?: string;
  restriction?: string;
  fillColor?: string;
  strokeColor?: string;
  lowerMeters?: number;
  upperMeters?: number;
  altitudeLabel?: string;
  /** Null for permanent zones; timestamps in milliseconds otherwise. */
  validStartTs?: number | null;
  validEndTs?: number | null;
  scheduleText?: string[];
  /** Raw ED-269 applicability[] of time-dependent zones (see ed269IsActiveAt /
   * geozoneIsActiveAt). Absent for permanent zones and non-ED-269 sources. */
  ed269Applicability?: any[];
  /** A temporary/NOTAM record may be eligible even without validity dates. */
  notamEligible?: boolean;
  applicationText?: string;
  links?: { label: string; url: string }[];
  /** Unknown reference retains the existing AGL fallback in height filtering. */
  lowerReference?: "MSL" | "AGL";
  /** Explicit maximum flight height AGL (m) allowed without authorisation, e.g.
   * SE CTR/TIZ/ATZ 50 m (normalisers: openCategoryMaxAglMeters). The only
   * structured field that may clear a zone by altitude — upperMeters is the top
   * of the restricted volume, NOT a height limit (ED-269). */
  maxFlightHeightAglM?: number;
}
