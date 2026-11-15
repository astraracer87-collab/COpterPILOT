// Direkter Abruf der polnischen Drohnen-Geozonen (PANSA / PAŻP DroneMap).
// Siehe docs/pansa-pl-api-integration.md (§2, §9, §10) und das Referenzskript
// docs/tools/poland/pansa_geozones.py.
//
// Hauptweg JSON (Doku §10, 3.170 Zonen):
//  1. POST /v1/front/login mit Header x-api-key → { access_token }
//  2. GET  /v1/zones + /v1/zones/types (Pflicht) mit x-api-key UND
//     Authorization: Bearer <access_token>; Hülle { properties: [...] }
//  3. GET  /v1/activ/timeslices, /v1/activ/activations, /v1/notams (optional –
//     fehlen sie, gelten zeitgesteuerte Zonen vorsorglich als aktiv mit Hinweis
//     „Aktivierung prüfen (AUP)“)
//  4. normalizePansaZonesJson (shared/polishGeozones.ts)
// Zonen + Typen werden im Speicher 6 h wiederverwendet (Doku: Zonen 1×/Tag),
// Aktivierungen/NOTAMs bei jedem Abruf neu geladen.
//
// Rückfall KML (bisheriger Weg, 1.774 DRA-Zonen), falls der JSON-Weg scheitert:
//  GET /v1/kml/filtered?extrude=false&types=DRAP,DRAR,DRAI&max=500 → KML →
//  normalizePolishKml (Typ/Höhen aus der <description>).
//
// Freigabe: schriftlich von PANSA, vom Product Owner bestätigt (2026-11-15) für
// Zonen, Typen, Aktivierungen und NOTAMs wie dokumentiert. Aus der US-Cloud
// geo-geblockt – Live-Verifikation nur von EU-IP/auf dem Gerät.
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
  normalizePansaZonesJson,
  parsePansaLoginToken,
  PANSA_ACTIVATIONS_URL,
  PANSA_NOTAMS_URL,
  PANSA_TIMESLICES_URL,
  PANSA_ZONES_URL,
  PANSA_ZONE_TYPES_URL,
  type PansaJsonRaw,
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

/** Schritt 2 (JSON): Endpunkt mit beiden Headern laden und parsen. */
export async function pansaFetchJson(url: string, token: string, apiKey: string = pansaApiKey(), timeoutMs: number = 120_000): Promise<any> {
  const text = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    },
    timeoutMs,
  );
  return JSON.parse(text);
}

/** Netzzugriffe (in Tests ersetzbar). */
export interface PansaHttp {
  login(): Promise<string>;
  getJson(url: string, token: string): Promise<any>;
  getKml(url: string, token: string): Promise<string>;
}

const defaultHttp: PansaHttp = {
  login: () => pansaLogin(),
  getJson: (url, token) => pansaFetchJson(url, token),
  getKml: (url, token) => pansaFetchKml(token, url),
};

/** Zonen + Typen ändern sich selten (Doku: 1×/Tag) – im Speicher so lange wiederverwenden. */
export const PANSA_ZONES_MEMORY_MS = 6 * 60 * 60 * 1000;
let zonesMemory: { at: number; zones: unknown; types: unknown } | null = null;

/** Nur für Tests: Zonen-Zwischenspeicher leeren. */
export function resetPansaMemory(): void {
  zonesMemory = null;
}

/** Ergebnis des JSON-Wegs (für Tests/Diagnose). */
export interface PolandLoadResult {
  features: GeoFeature[];
  via: "json" | "kml";
  activationsLoaded: boolean;
  jsonError?: string;
}

/** JSON laden; abgelaufenes Token (401/403) → einmal neu einloggen. */
async function getJsonWithRelogin(http: PansaHttp, url: string, auth: { token: string }): Promise<any> {
  try {
    return await http.getJson(url, auth.token);
  } catch (e) {
    if (!(e instanceof PansaAuthError)) throw e;
    auth.token = await http.login();
    return await http.getJson(url, auth.token);
  }
}

async function optional(p: Promise<any>, what: string): Promise<any> {
  try {
    return await p;
  } catch (e) {
    console.warn(`[geozoneDirect] PL: ${what} nicht geladen:`, (e as Error)?.message || e);
    return undefined;
  }
}

/** JSON-Weg; wirft, wenn Zonen/Typen nicht ladbar sind oder keine Zone entsteht. */
export async function loadPolandJson(http: PansaHttp = defaultHttp, now: number = Date.now()): Promise<{ features: GeoFeature[]; activationsLoaded: boolean }> {
  const auth = { token: await http.login() };
  let zones: unknown;
  let types: unknown;
  if (zonesMemory && now - zonesMemory.at < PANSA_ZONES_MEMORY_MS) {
    ({ zones, types } = zonesMemory);
  } else {
    zones = await getJsonWithRelogin(http, PANSA_ZONES_URL, auth);
    types = await optional(getJsonWithRelogin(http, PANSA_ZONE_TYPES_URL, auth), "Zonentypen");
  }
  const timeslices = await optional(getJsonWithRelogin(http, PANSA_TIMESLICES_URL, auth), "Timeslices");
  const activations = await optional(getJsonWithRelogin(http, PANSA_ACTIVATIONS_URL, auth), "Aktivierungen");
  const notams = await optional(getJsonWithRelogin(http, PANSA_NOTAMS_URL, auth), "NOTAMs");
  const raw: PansaJsonRaw = { zones, types, timeslices, activations, notams };
  const result = normalizePansaZonesJson(raw, now);
  if (result.zoneCount === 0) throw new Error("PANSA lieferte keine Zonen (JSON)");
  if (!zonesMemory || zonesMemory.zones !== zones) zonesMemory = { at: now, zones, types };
  return {
    features: finalizeDirectFeatures(result.features as unknown as GeoFeature[], "pl"),
    activationsLoaded: result.activationsLoaded,
  };
}

/** JSON-Weg, bei Fehlschlag KML-Rückfall (testbar mit eigenem PansaHttp). */
export async function loadPoland(http: PansaHttp = defaultHttp, now: number = Date.now()): Promise<PolandLoadResult> {
  let jsonError: unknown;
  try {
    const r = await loadPolandJson(http, now);
    return { features: r.features, via: "json", activationsLoaded: r.activationsLoaded };
  } catch (e) {
    jsonError = e;
    console.warn("[geozoneDirect] PL: JSON-Weg fehlgeschlagen, KML-Rückfall:", (e as Error)?.message || e);
  }
  try {
    const token = await http.login();
    const kml = await http.getKml(PANSA_KML_REQUEST_URL, token);
    if (!/<(\w+:)?kml[\s>]|<(\w+:)?Placemark[\s>]/.test(kml)) throw new Error("PANSA lieferte kein KML");
    const features = polandFeaturesFromKml(kml);
    if (features.length === 0) throw new Error("PANSA lieferte keine Zonen");
    return { features, via: "kml", activationsLoaded: false, jsonError: (jsonError as Error)?.message };
  } catch (e) {
    // Auth-Fehler des JSON-Wegs ist aussagekräftiger („API-Key prüfen“).
    throw jsonError instanceof PansaAuthError ? jsonError : e;
  }
}

export async function fetchPoland(): Promise<GeoFeature[]> {
  return (await loadPoland()).features;
}
