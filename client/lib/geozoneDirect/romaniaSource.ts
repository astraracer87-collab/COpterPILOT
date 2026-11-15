// Direkter Abruf der rumänischen Drohnen-Geozonen (ROMATSA) – siehe
// docs/greece-romania-geozones-notes.md („Rumänien“). Öffentlich, ohne Login:
//
//  1. statischer Zonensatz (dauerhafte Zonen)
//     https://flightplan.romatsa.ro/init/static/zone_restrictionate_uav.json
//  2. GeoServer-WFS NOTAM-UAV (temporäre Zonen, dfrom/dto)
//     …/init/geoserver/ows?…typeName=carto:restrictii_notam_pt_uav
//
// Normalisierung: shared/romanianGeozones.ts. Die statischen Zonen sind
// Pflicht (ohne sie wird nichts gespeichert, ein vorhandener Bestand/Import
// bleibt); die NOTAM-Ebene darf fehlen (dann nur Warnung).
//
// TLS: Früher scheiterte Android am ROMATSA-Server (zu kleine DH-Parameter).
// Der Abruf von DE (Browser) klappte am 2026-11-15; auf dem Gerät prüfen. Bei
// einem Verbindungsfehler gibt es eine klare Meldung – der Datei-Import bleibt
// als Rückfall (RcOfflineMapsScreen).
//
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar).
import type { GeoFeature } from "./ed269Sources";
import { directFetchJson, finalizeDirectFeatures } from "./directFetchUtil";
import {
  RO_GEOZONE_ATTRIBUTION,
  RO_GEOZONE_SOURCE_LABEL,
  RO_STATIC_ZONES_URL,
  normalizeRomanianGeozones,
  roNotamWfsUrl,
} from "../../../shared/romanianGeozones";

export { RO_GEOZONE_SOURCE_LABEL, RO_GEOZONE_ATTRIBUTION };

/** Meldung bei Verbindungsfehlern (z. B. TLS-Handshake der Fernsteuerung). */
export const RO_UNREACHABLE_MESSAGE = "ROMATSA nicht erreichbar – Datei-Import nutzen";

const STATIC_TIMEOUT_MS = 90_000;
const NOTAM_TIMEOUT_MS = 60_000;

type FetchJson = (url: string, timeoutMs?: number) => Promise<any>;

export class RomatsaUnreachableError extends Error {
  constructor(cause?: unknown) {
    const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
    super(`${RO_UNREACHABLE_MESSAGE}${detail}`);
    this.name = "RomatsaUnreachableError";
  }
}

/** Beide Quellen laden + normalisieren (testbar mit eigenem fetchJson). */
export async function loadRomania(fetchJson: FetchJson = directFetchJson, now: Date = new Date()): Promise<GeoFeature[]> {
  let staticBody: any;
  try {
    staticBody = await fetchJson(RO_STATIC_ZONES_URL, STATIC_TIMEOUT_MS);
  } catch (e) {
    throw new RomatsaUnreachableError(e);
  }
  let notamBody: any = null;
  try {
    notamBody = await fetchJson(roNotamWfsUrl(), NOTAM_TIMEOUT_MS);
  } catch (e) {
    console.warn("[geozoneDirect] RO: NOTAM-WFS nicht erreichbar:", (e as Error)?.message || e);
  }
  const { features, staticCount } = normalizeRomanianGeozones(staticBody, notamBody, now);
  if (staticCount === 0) throw new Error("ROMATSA lieferte keine Zonen");
  return finalizeDirectFeatures(features as unknown as GeoFeature[], "ro");
}

export async function fetchRomania(): Promise<GeoFeature[]> {
  return loadRomania(directFetchJson);
}
