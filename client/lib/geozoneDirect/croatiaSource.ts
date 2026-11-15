// Direkter Abruf der kroatischen Geozonen (Croatia Control – AMC-Portal) über
// den öffentlichen, anonymen SignalR-Hub „aMCHub“.
// Siehe docs/croatia-amc-api-integration.md und shared/croatianGeozones.ts.
//
//  negotiate → WebSocket (Fallback longPolling) → start → CLIC_ClientReady
//  → SRVC_Areas, SRVC_Reservations, SRVC_DroneReservations, SRVC_ClientSettings
//  einsammeln → Verbindung schließen (einmaliger Abzug, kein Dauer-Socket).
//
// Live geprüft am 2026-11-15 (WebSocket und longPolling). Wirft, wenn nichts
// geladen werden kann (damit ein gespeicherter Datensatz erhalten bleibt).
// Bewusst frei von React-Native-/Expo-Importen.
import type { GeoFeature } from "./ed269Sources";
import { finalizeDirectFeatures } from "./directFetchUtil";
import { collectSignalRPushes, type ClassicSignalROptions, type HubPushes } from "./croatiaSignalR";
import {
  HR_GEOZONE_ATTRIBUTION,
  HR_GEOZONE_SOURCE_LABEL,
  HR_REQUIRED_PUSHES,
  normalizeCroatiaFeatures,
} from "../../../shared/croatianGeozones";

export { HR_GEOZONE_ATTRIBUTION, HR_GEOZONE_SOURCE_LABEL };

export const HR_AMC_SIGNALR_URL = "https://amc.crocontrol.hr/amc/signalr";
export const HR_AMC_HUB = "aMCHub";
/** Das Portal ruft CLIC_ClientReady("WebClient") auf (comm.js); ohne Argument antwortet der Hub mit einem Fehler. */
export const HR_AMC_CLIENT_READY = { method: "CLIC_ClientReady", args: ["WebClient"] };

/** Alle Pflicht-Pushes + ClientSettings da? */
export function croatiaPushesComplete(p: HubPushes): boolean {
  return HR_REQUIRED_PUSHES.every((m) => Array.isArray(p[m])) && Array.isArray(p.SRVC_ClientSettings);
}

/** Pushes → finalisierte App-Features (testbar ohne Netz). */
export function croatiaFeaturesFromPushes(pushes: HubPushes, now: Date = new Date()): GeoFeature[] {
  const features = normalizeCroatiaFeatures(pushes, now) as unknown as GeoFeature[];
  return finalizeDirectFeatures(features, "hr");
}

/** Rohabzug der Hub-Pushes (für Diagnose/Fixtures). */
export async function fetchCroatiaPushes(overrides: Partial<ClassicSignalROptions> = {}): Promise<HubPushes> {
  const res = await collectSignalRPushes({
    baseUrl: HR_AMC_SIGNALR_URL,
    hub: HR_AMC_HUB,
    invocations: [HR_AMC_CLIENT_READY],
    isComplete: croatiaPushesComplete,
    // ~3,7 MB Pushes; live < 2 s, großzügig wegen Mobilfunk.
    connectTimeoutMs: 15_000,
    collectTimeoutMs: 90_000,
    requestTimeoutMs: 20_000,
    // Fehlen nur optionale Pushes, trotzdem verwerten (Prüfung unten).
    resolvePartialOnTimeout: true,
    ...overrides,
  });
  if (res.invocationErrors.length > 0) {
    console.warn("[geozoneDirect] HR: Hub-Aufruf meldete Fehler:", res.invocationErrors.join("; "));
  }
  if (!Array.isArray(res.pushes.SRVC_Areas) && !Array.isArray(res.pushes.SRVC_DroneReservations)) {
    throw new Error(`AMC-Hub lieferte keine Zonen (erhalten: ${Object.keys(res.pushes).join(", ") || "nichts"})`);
  }
  if (!res.complete) {
    console.warn("[geozoneDirect] HR: unvollständiger Abzug, erhalten:", Object.keys(res.pushes).join(", "));
  }
  return res.pushes;
}

export async function fetchCroatia(): Promise<GeoFeature[]> {
  const pushes = await fetchCroatiaPushes();
  const features = croatiaFeaturesFromPushes(pushes);
  if (features.length === 0) throw new Error("Croatia Control (AMC) lieferte keine Zonen");
  return features;
}
