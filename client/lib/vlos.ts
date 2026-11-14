import type { DroneType } from "@/lib/storage";

export const DEFAULT_GROUND_VISIBILITY_M = 5000;
export const VLOS_OVERRIDE_MAX_FACTOR = 3;

export type AlosKind = "multirotor" | "fixed_wing";

// Alle in der App modellierten Drohnentypen (selfie/standard/fpv_only/hybrid_fpv)
// sind Multicopter. Die fixed_wing-ALOS-Formel (computeAlosM) existiert nur für
// didaktische Beispiele (VlosInfoScreen) und wird dort direkt mit kind:"fixed_wing"
// aufgerufen. Kommt später ein Starrflügler-DroneType dazu, hier mappen.
export function alosKindForDroneType(_droneType: DroneType): AlosKind {
  return "multirotor";
}

export function computeAlosM(charDimensionM: number, kind: AlosKind = "multirotor"): number {
  if (!charDimensionM || charDimensionM <= 0) return 0;
  if (kind === "fixed_wing") return 490 * charDimensionM + 30;
  return 327 * charDimensionM + 20;
}

export function computeDlosM(groundVisibilityM: number = DEFAULT_GROUND_VISIBILITY_M): number {
  return 0.3 * groundVisibilityM;
}

/**
 * Convert a direct line-of-sight distance into a conservative horizontal
 * planning radius for a given vertical separation (Pythagoras).
 */
export function computeHorizontalVlosLimitM(vlosM: number, altitudeDifferenceM: number): number {
  if (!Number.isFinite(vlosM) || vlosM <= 0) return 0;
  const height = Number.isFinite(altitudeDifferenceM) ? Math.max(0, altitudeDifferenceM) : 0;
  return Math.floor(Math.sqrt(Math.max(0, vlosM * vlosM - height * height)));
}

export interface VlosResult {
  vlosM: number;
  alosM: number;
  dlosM: number;
  limitedBy: "alos" | "dlos";
  groundVisibilityM: number;
  charDimensionM: number;
}

export function computeVlosM(
  charDimensionM: number,
  opts: { kind?: AlosKind; groundVisibilityM?: number } = {}
): VlosResult {
  const gv = opts.groundVisibilityM ?? DEFAULT_GROUND_VISIBILITY_M;
  const alos = computeAlosM(charDimensionM, opts.kind);
  const dlos = computeDlosM(gv);
  const vlos = Math.min(alos, dlos);
  return {
    vlosM: Math.round(vlos),
    alosM: Math.round(alos),
    dlosM: Math.round(dlos),
    limitedBy: alos <= dlos ? "alos" : "dlos",
    groundVisibilityM: gv,
    charDimensionM,
  };
}

export function snapMeters(meters: number, step: number = 100): number {
  return Math.round(meters / step) * step;
}

export function formatMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}
