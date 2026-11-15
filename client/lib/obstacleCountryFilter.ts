// Hindernisse nur in aktiven Ländern (Product Owner): für Länder mit Nutzung
// „Aus“ werden keine Hindernis-Kacheln (Overpass) geladen.
//
// Eine Kachel (Zoom 10) zählt, wenn ihre Mitte oder – an Grenzen – eine ihrer
// Ecken in einem aktiven Land liegt. Liegt kein Prüfpunkt in einem bekannten
// Land (offenes Meer, außerhalb der Länder-Erkennung), wird die Kachel
// ebenfalls geladen: dort gibt es keine Einstellung, die sie abschaltet.
//
// RN-frei (unter tsx testbar); Länder-Erkennung und Nutzung sind injizierbar.

import { detectCountryFromCoordinates } from "../../shared/countryDetection";
import { isCountryEnabled } from "./countryUsage";

export interface TileBox {
  s: number;
  w: number;
  n: number;
  e: number;
}

export interface ObstacleCountryDeps {
  detect: (lat: number, lon: number) => string | null;
  isEnabled: (iso: string) => boolean;
}

const defaultDeps: ObstacleCountryDeps = {
  detect: (lat, lon) => {
    try {
      return detectCountryFromCoordinates(lat, lon);
    } catch {
      return null;
    }
  },
  isEnabled: (iso) => isCountryEnabled(iso),
};

/** Darf diese Hindernis-Kachel geladen werden? */
export function obstacleTileInActiveCountry(b: TileBox, deps: ObstacleCountryDeps = defaultDeps): boolean {
  const points: [number, number][] = [
    [(b.s + b.n) / 2, (b.w + b.e) / 2],
    [b.s, b.w],
    [b.s, b.e],
    [b.n, b.w],
    [b.n, b.e],
  ];
  let known = false;
  for (const [lat, lon] of points) {
    const iso = deps.detect(lat, lon);
    if (!iso) continue;
    known = true;
    if (deps.isEnabled(iso)) return true;
  }
  return !known;
}
