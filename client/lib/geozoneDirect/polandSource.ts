// Direkter Abruf der polnischen Drohnen-Geozonen (PANSA / PAŻP DroneMap).
// Siehe docs/pansa-pl-api-integration.md.
//
//  1. POST /v1/front/login mit Header x-api-key → { access_token }
//  2. GET  /v1/kml/filtered?extrude=false&types=DRAP,DRAR,DRAI&max=500
//     mit x-api-key UND Authorization: Bearer <access_token> → KML
//     (`max` = Höhengrenze in Metern; 500 = ungefiltert, siehe PANSA_KML_MAX_M)
//  3. KML parsen (shared/geozoneKit/kml.ts) → normalisieren (shared/polishGeozones.ts;
//     Typ/Höhen aus der <description> „Restriction: …, Type: DRAP, Min: 0 ft, Max: 600 ft“)
//
// Live verifiziert von DE-IP (2026-11-15, 1.774 Zonen); aus der US-Cloud geblockt.
// Wirft, wenn nichts geladen werden kann (damit ein gespeicherter Datensatz
// erhalten bleibt). Bewusst frei von React-Native-/Expo-Importen.
import type { GeoFeature } from "./ed269Sources";
import { DIRECT_FETCH_TIMEOUT_MS, finalizeDirectFeatures } from "./directFetchUtil";
import {
  PANSA_DEFAULT_API_KEY,
  PANSA_LOGIN_URL,
  PANSA_WEB_ORIGIN,
  PL_DRONE_ZONE_TYPES,
  PL_GEOZONE_SOURCE_LABEL,
  PANSA_KML_MAX_M,
  buildPansaKmlUrl,
  normalizePolishKml,
  parsePansaLoginToken,
} from "../../../shared/polishGeozones";

export { PL_GEOZONE_SOURCE_LABEL, PANSA_LOGIN_URL };
export const PANSA_KML_REQUEST_URL = buildPansaKmlUrl(PL_DRONE_ZONE_TYPES, PANSA_KML_MAX_M);

/**
 * API-Key: über EXPO_PUBLIC_PANSA_API_KEY konfigurierbar (eigener Key von PANSA,
 * Doku §6.1); Default ist der öffentliche Key des offiziellen QGIS-Plugins.
 */
export function pansaApiKey(): string {
  const env = typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_PANSA_API_KEY : undefined;
  return (env && env.trim()) || PANSA_DEFAULT_API_KEY;
}

export class PansaAuthError extends Error {
  constructor(status: number) {
    super(`PANSA DroneMap nicht verfügbar (HTTP ${status}) – API-Key prüfen`);
    this.name = "PansaAuthError";
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
    if (res.status === 401 || res.status === 403) throw new PansaAuthError(res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** Schritt 1: Bearer-Token holen. */
export async function pansaLogin(apiKey: string = pansaApiKey()): Promise<string> {
  const body = await fetchWithTimeout(
    PANSA_LOGIN_URL,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        // Wie das Plugin/die Web-App. In nativen Apps erlaubt, im Browser
        // (Web-Build) setzt der Browser Origin/Referer selbst.
        Origin: PANSA_WEB_ORIGIN,
        Referer: `${PANSA_WEB_ORIGIN}/`,
      },
    },
    DIRECT_FETCH_TIMEOUT_MS,
  );
  const token = parsePansaLoginToken(body);
  if (!token) throw new Error("PANSA-Login lieferte kein Token");
  return token;
}

/** Schritt 2: KML mit den Drohnenzonen laden. */
export async function pansaFetchKml(token: string, url: string = PANSA_KML_REQUEST_URL, apiKey: string = pansaApiKey()): Promise<string> {
  return await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        // Doku §2: BEIDE Header (x-api-key + Bearer) sind nötig.
        "x-api-key": apiKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.google-earth.kml+xml, application/xml;q=0.9, */*;q=0.8",
      },
    },
    120_000,
  );
}

/** KML-Text → finalisierte App-Features (testbar ohne Netz). */
export function polandFeaturesFromKml(kml: string): GeoFeature[] {
  const features = normalizePolishKml(kml) as unknown as GeoFeature[];
  return finalizeDirectFeatures(features, "pl");
}

export async function fetchPoland(): Promise<GeoFeature[]> {
  const token = await pansaLogin();
  const kml = await pansaFetchKml(token);
  if (!/<(\w+:)?kml[\s>]|<(\w+:)?Placemark[\s>]/.test(kml)) {
    throw new Error("PANSA lieferte kein KML");
  }
  const features = polandFeaturesFromKml(kml);
  if (features.length === 0) throw new Error("PANSA lieferte keine Zonen");
  return features;
}
