import { useEffect, useState } from "react";
import { computeSunElevation } from "../../shared/solar";

/** Sonnenuntergang/-aufgang: Sonnenmittelpunkt 0,833° unter dem Horizont */
const SUNSET_ELEVATION_DEG = -0.833;

export function isNightAt(lat: number | null | undefined, lon: number | null | undefined, now = new Date()): boolean {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return computeSunElevation(lat, lon, now) < SUNSET_ELEVATION_DEG;
}

/**
 * Nacht am Ort (zwischen Sonnenuntergang und -aufgang). Wird jede Minute neu
 * geprüft, damit die Karte zur richtigen Zeit dunkel bzw. wieder hell wird.
 */
export function useIsNight(lat: number | null | undefined, lon: number | null | undefined): boolean {
  const [night, setNight] = useState(() => isNightAt(lat, lon));
  useEffect(() => {
    const check = () => setNight(isNightAt(lat, lon));
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [lat == null ? null : Math.round(lat * 10), lon == null ? null : Math.round(lon * 10)]);
  return night;
}
