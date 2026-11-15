// Höhen im Geozonen-Baukasten (Umbau B6): der gemeinsame Parser aus
// shared/heights.ts (B3) plus kleine Umrechnungen für die Länder-Adapter.
// Die Normalisierer lesen Zahlen/Einheiten/Bezüge nur noch über parseHeight /
// parseHeightRange und bilden das Ergebnis auf ihre (historischen) Feldformen ab.
import { FT_M } from "../heights";

export * from "../heights";

/** Fuß → Meter (ungerundet). */
export function ftToM(ft: number): number {
  return ft * FT_M;
}

/** Meter → Fuß (ungerundet). */
export function mToFt(m: number): number {
  return m / FT_M;
}

/** Flugfläche → Meter Druckhöhe (FL n = n × 100 ft, ungerundet). */
export function flToM(fl: number): number {
  return fl * 100 * FT_M;
}
