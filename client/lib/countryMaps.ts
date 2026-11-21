import { BUNDESLAND_POLYGONS } from "./bundeslandPolygons";
import {
  COUNTRY_BOUNDING_BOXES,
  detectCountryFromCoordinates,
  getCountryBoundingBox,
  hasOwnMap,
  OWN_MAP_DATA_COUNTRIES,
  pointInPolygon,
} from "../../shared/countryDetection";
import type { BoundingBox, CountryBoundingBox } from "../../shared/countryDetection";
// COUNTRY_MAPS + Karten-Hilfen stammen aus der geteilten Registry, damit Mobile
// und Web (web/src/lib/planning/countryMaps.ts) garantiert identische Karten/
// Deep-Links verwenden. Siehe shared/countryMaps.ts.
import {
  COUNTRY_MAPS,
  EASA_FALLBACK_MAP,
  buildMapUrl,
  getCountryMapConfig,
  getMapConfigOrFallback,
} from "../../shared/countryMaps";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { CountryMapConfig } from "../../shared/countryMaps";

// Nominatim-Reverse-Geocoding darf nie unbegrenzt hängen (RN-Android-fetch hat
// keinen Default-Timeout; RC Pro 2 oft offline / hängender Link).
export const REVERSE_GEOCODE_TIMEOUT_MS = 6000;

export { detectCountryFromCoordinates, getCountryBoundingBox, hasOwnMap, OWN_MAP_DATA_COUNTRIES };
export type { BoundingBox, CountryBoundingBox };
export { COUNTRY_MAPS, EASA_FALLBACK_MAP, buildMapUrl, getCountryMapConfig, getMapConfigOrFallback };
export type { CountryMapConfig };

/**
 * Standard-Mittelpunkt eines Landes (WGS84) für Karten-Zentrierung,
 * wenn keine GPS-Position verfügbar ist.
 */
const COUNTRY_DEFAULT_CENTER: Record<string, { lat: number; lon: number; latDelta: number; lonDelta: number }> = {
  DE: { lat: 51.1657, lon: 10.4515, latDelta: 7.5, lonDelta: 8.5 },
  AT: { lat: 47.5162, lon: 14.5501, latDelta: 3.0, lonDelta: 5.5 },
  CH: { lat: 46.8182, lon: 8.2275, latDelta: 2.5, lonDelta: 4.5 },
  FR: { lat: 46.2276, lon: 2.2137, latDelta: 8.0, lonDelta: 9.0 },
  IT: { lat: 41.8719, lon: 12.5674, latDelta: 8.0, lonDelta: 7.0 },
  ES: { lat: 40.4637, lon: -3.7492, latDelta: 7.5, lonDelta: 9.0 },
  NL: { lat: 52.1326, lon: 5.2913, latDelta: 2.5, lonDelta: 3.5 },
  BE: { lat: 50.5039, lon: 4.4699, latDelta: 1.8, lonDelta: 3.0 },
  DK: { lat: 56.2639, lon: 9.5018, latDelta: 4.0, lonDelta: 6.0 },
  IE: { lat: 53.1424, lon: -7.6921, latDelta: 4.0, lonDelta: 5.5 },
  GB: { lat: 54.0, lon: -2.5, latDelta: 10.0, lonDelta: 9.0 },
  PL: { lat: 51.9194, lon: 19.1451, latDelta: 5.5, lonDelta: 8.0 },
  CZ: { lat: 49.8175, lon: 15.473, latDelta: 2.8, lonDelta: 5.0 },
  PT: { lat: 39.3999, lon: -8.2245, latDelta: 5.0, lonDelta: 4.0 },
  GR: { lat: 39.0742, lon: 21.8243, latDelta: 6.0, lonDelta: 7.0 },
  FI: { lat: 61.9241, lon: 25.7482, latDelta: 9.0, lonDelta: 10.0 },
  SE: { lat: 60.1282, lon: 18.6435, latDelta: 11.0, lonDelta: 10.0 },
  NO: { lat: 60.472, lon: 8.4689, latDelta: 12.0, lonDelta: 12.0 },
  LU: { lat: 49.8153, lon: 6.1296, latDelta: 0.8, lonDelta: 1.2 },
  EE: { lat: 58.5953, lon: 25.0136, latDelta: 2.5, lonDelta: 4.5 },
  LV: { lat: 56.8796, lon: 24.6032, latDelta: 2.5, lonDelta: 5.0 },
  HR: { lat: 45.1, lon: 15.2, latDelta: 3.0, lonDelta: 5.0 },
  RO: { lat: 45.9432, lon: 24.9668, latDelta: 4.5, lonDelta: 7.0 },
  SI: { lat: 46.1512, lon: 14.9955, latDelta: 1.5, lonDelta: 3.0 },
  LI: { lat: 47.166, lon: 9.5554, latDelta: 0.5, lonDelta: 0.8 },
  BG: { lat: 42.7339, lon: 25.4858, latDelta: 3.0, lonDelta: 6.0 },
  CY: { lat: 35.1264, lon: 33.4299, latDelta: 1.2, lonDelta: 2.2 },
  HU: { lat: 47.1625, lon: 19.5033, latDelta: 2.8, lonDelta: 6.5 },
  LT: { lat: 55.1694, lon: 23.8813, latDelta: 2.5, lonDelta: 5.5 },
  MT: { lat: 35.9375, lon: 14.3754, latDelta: 0.4, lonDelta: 0.6 },
  SK: { lat: 48.669, lon: 19.699, latDelta: 1.8, lonDelta: 5.5 },
  AL: { lat: 41.15, lon: 20.17, latDelta: 1.6, lonDelta: 1.6 },
  BA: { lat: 43.92, lon: 17.68, latDelta: 1.6, lonDelta: 2.2 },
  IS: { lat: 64.96, lon: -19.02, latDelta: 2.0, lonDelta: 6.0 },
  XK: { lat: 42.6, lon: 20.9, latDelta: 0.9, lonDelta: 1.2 },
  MC: { lat: 43.7384, lon: 7.4246, latDelta: 0.05, lonDelta: 0.05 },
  MK: { lat: 41.61, lon: 21.75, latDelta: 1.0, lonDelta: 1.6 },
  ME: { lat: 42.71, lon: 19.37, latDelta: 1.0, lonDelta: 1.2 },
  RS: { lat: 44.02, lon: 21.01, latDelta: 2.2, lonDelta: 2.5 },
  UA: { lat: 48.38, lon: 31.17, latDelta: 4.5, lonDelta: 9.0 },
  BY: { lat: 53.71, lon: 27.95, latDelta: 2.6, lonDelta: 5.0 },
  RU: { lat: 55.75, lon: 37.62, latDelta: 10, lonDelta: 20 },
};

export function getCountryDefaultCenter(isoCode: string | null | undefined): { lat: number; lon: number; latDelta: number; lonDelta: number } {
  if (!isoCode) return COUNTRY_DEFAULT_CENTER.DE;
  return COUNTRY_DEFAULT_CENTER[isoCode.toUpperCase()] ?? COUNTRY_DEFAULT_CENTER.DE;
}

/**
 * Convert a 2-letter ISO country code into its emoji flag.
 * Falls back to a globe emoji if the code is invalid.
 */
export function getCountryFlag(isoCode: string | null | undefined): string {
  const c = (isoCode || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "\uD83C\uDF10"; // 🌐
  const A = 0x1f1e6;
  const a = "A".charCodeAt(0);
  return String.fromCodePoint(A + (c.charCodeAt(0) - a)) + String.fromCodePoint(A + (c.charCodeAt(1) - a));
}

/**
 * True if (lat,lon) lies inside the bounding box / refined boundary
 * of the given country. Uses detectCountryFromCoordinates for accuracy.
 */
export function isPointInCountry(lat: number, lon: number, isoCode: string | null | undefined): boolean {
  if (!isoCode) return false;
  const detected = detectCountryFromCoordinates(lat, lon);
  if (!detected) return false;
  return detected.toUpperCase() === isoCode.toUpperCase();
}

export function getDefaultMapConfig(): CountryMapConfig {
  return COUNTRY_MAPS[0];
}

export interface CountryCenter {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export async function reverseGeocodeCountry(lat: number, lon: number): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=3&accept-language=en`,
      {
        headers: {
          "User-Agent": "DronePreFlightApp/1.0",
        },
      },
      REVERSE_GEOCODE_TIMEOUT_MS,
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    const countryCode = data?.address?.country_code?.toUpperCase();
    
    if (countryCode) {
      const ISO_ALIASES: Record<string, string> = {
        UK: "GB",
        EL: "GR",
      };
      return ISO_ALIASES[countryCode] || countryCode;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

export async function reverseGeocodePlace(lat: number, lon: number): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&accept-language=de`,
      {
        headers: {
          "User-Agent": "DronePreFlightApp/1.0",
        },
      },
      REVERSE_GEOCODE_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const data = await response.json();
    const a = data?.address;
    if (!a) return data?.display_name?.split(",").slice(0, 2).join(", ") || null;
    const local =
      a.village || a.hamlet || a.suburb || a.town || a.city || a.municipality || a.county;
    const region = a.town || a.city || a.municipality || a.county || a.state;
    const parts: string[] = [];
    if (local) parts.push(local);
    if (region && region !== local) parts.push(region);
    if (parts.length === 0 && a.country) parts.push(a.country);
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

export function getCountryCenter(isoCode: string): CountryCenter {
  const box = COUNTRY_BOUNDING_BOXES.find((b) => b.iso === isoCode.toUpperCase());
  
  if (!box) {
    return {
      latitude: 51.1657,
      longitude: 10.4515,
      latitudeDelta: 6,
      longitudeDelta: 6,
    };
  }
  
  const latitude = (box.minLat + box.maxLat) / 2;
  const longitude = (box.minLon + box.maxLon) / 2;
  const latitudeDelta = Math.max((box.maxLat - box.minLat) * 1.2, 0.5);
  const longitudeDelta = Math.max((box.maxLon - box.minLon) * 1.2, 0.5);
  
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

interface BundeslandBBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  priority: number;
}

const BUNDESLAND_BBOXES: BundeslandBBox[] = [
  { name: "Berlin", minLat: 52.34, maxLat: 52.68, minLon: 13.09, maxLon: 13.76, priority: 1 },
  { name: "Hamburg", minLat: 53.39, maxLat: 53.74, minLon: 9.73, maxLon: 10.33, priority: 1 },
  { name: "Bremen", minLat: 53.01, maxLat: 53.61, minLon: 8.48, maxLon: 8.99, priority: 1 },
  { name: "Saarland", minLat: 49.11, maxLat: 49.64, minLon: 6.36, maxLon: 7.41, priority: 2 },
  { name: "Thüringen", minLat: 50.20, maxLat: 51.65, minLon: 9.88, maxLon: 12.65, priority: 3 },
  { name: "Sachsen", minLat: 50.17, maxLat: 51.68, minLon: 11.87, maxLon: 15.04, priority: 3 },
  { name: "Sachsen-Anhalt", minLat: 50.94, maxLat: 53.04, minLon: 10.56, maxLon: 13.19, priority: 3 },
  { name: "Schleswig-Holstein", minLat: 53.36, maxLat: 55.06, minLon: 7.87, maxLon: 11.35, priority: 3 },
  { name: "Mecklenburg-Vorpommern", minLat: 53.11, maxLat: 54.68, minLon: 10.59, maxLon: 14.41, priority: 3 },
  { name: "Hessen", minLat: 49.39, maxLat: 51.66, minLon: 7.77, maxLon: 10.24, priority: 3 },
  { name: "Rheinland-Pfalz", minLat: 48.97, maxLat: 50.94, minLon: 6.11, maxLon: 8.51, priority: 3 },
  { name: "Baden-Württemberg", minLat: 47.53, maxLat: 49.79, minLon: 7.51, maxLon: 10.50, priority: 4 },
  { name: "Bayern", minLat: 47.27, maxLat: 50.56, minLon: 8.98, maxLon: 13.84, priority: 4 },
  { name: "Nordrhein-Westfalen", minLat: 50.32, maxLat: 52.53, minLon: 5.87, maxLon: 9.46, priority: 4 },
  { name: "Niedersachsen", minLat: 51.30, maxLat: 53.89, minLon: 6.65, maxLon: 11.60, priority: 5 },
  { name: "Brandenburg", minLat: 51.36, maxLat: 53.56, minLon: 11.27, maxLon: 14.77, priority: 5 },
];

/**
 * Punktgenaue Bundesland-Erkennung über echte Grenzpolygone (Point-in-Polygon).
 * Löst korrekt Grenzfälle auf, bei denen sich die groben Bounding-Boxen mehrerer
 * Bundesländer überlappen (z. B. Limburg an der Lahn = Hessen, nicht RLP).
 * Fällt nur dann auf die Bounding-Box-Heuristik zurück, wenn kein Polygon trifft.
 */
export function detectBundeslandFromCoordinates(lat: number, lon: number): string | null {
  for (const bl of BUNDESLAND_POLYGONS) {
    for (const polygon of bl.polygons) {
      if (pointInPolygon(lon, lat, polygon)) return bl.name;
    }
  }

  // Fallback: grobe Bounding-Box-Heuristik (z. B. wenn Punkt knapp außerhalb
  // der vereinfachten Polygongrenze liegt).
  const matches = BUNDESLAND_BBOXES.filter(
    (b) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.priority - b.priority);

  if (matches.length === 1) return matches[0].name;

  const cityState = matches.find((m) => m.priority === 1);
  if (cityState) return cityState.name;

  let best = matches[0];
  let bestArea = (best.maxLat - best.minLat) * (best.maxLon - best.minLon);
  for (let i = 1; i < matches.length; i++) {
    const area = (matches[i].maxLat - matches[i].minLat) * (matches[i].maxLon - matches[i].minLon);
    if (area < bestArea) {
      best = matches[i];
      bestArea = area;
    }
  }
  return best.name;
}

export function detectAllBundeslaenderInRadius(
  lat: number,
  lon: number,
  radiusKm: number,
): string[] {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLon = lon - lonDelta;
  const maxLon = lon + lonDelta;

  return BUNDESLAND_BBOXES
    .filter(
      (b) =>
        b.minLat <= maxLat &&
        b.maxLat >= minLat &&
        b.minLon <= maxLon &&
        b.maxLon >= minLon,
    )
    .map((b) => b.name);
}
