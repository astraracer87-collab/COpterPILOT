// Italienische Geozonen (d-flight S.p.A., ENAV-Gruppe) – ED-269-Gesamtdownload
// `GET /geo-awareness/api/ed-269/geo-zones/download`, siehe
// docs/dflight-it-api-integration.md §4.1.
//
// Eigenheiten / Annahmen (Format ist erst nach Login live zu bestätigen):
//  - Erwartet wird Standard-ED-269 ({title?, description?, features:[UASZoneVersion]})
//    wie bei AT/FI. Toleriert werden auch ein nacktes Array, {items:[{zone}]}
//    und eine JSON-Hülle als String.
//  - Der Download kann als ZIP kommen (Menüpunkt „Download UAS Geo Zone“).
//    decodeItalianDownload() erkennt ZIP (PK-Signatur) und nimmt die erste
//    JSON-Datei darin; gzip erledigt bereits der HTTP-Stack.
//  - Texte (name, message) bleiben italienisch – die App übersetzt separat.
//  - Abgelaufene befristete Zonen (alle applicability-Fenster vorbei) werden
//    verworfen.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

import { unzipSync, strFromU8 } from "fflate";
import { ed269ExtractZones, ed269ZonesToFeatures, type Ed269PureFeature } from "./ed269Pure";

export const IT_DFLIGHT_BASE_URL = "https://www.d-flight.it";
export const IT_DFLIGHT_ED269_URL = `${IT_DFLIGHT_BASE_URL}/geo-awareness/api/ed-269/geo-zones/download`;
export const IT_GEOZONE_SOURCE_LABEL = "d-flight (ENAV)";
// Disclaimer d-flight: Nutzung „esclusivamente per il proprio utilizzo“.
export const IT_GEOZONE_ATTRIBUTION = "Fonte: d-flight S.p.A. (Gruppo ENAV) – dati per uso esclusivamente personale";

function parseTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * true, wenn die Zone nur befristete Gültigkeitsfenster hat und ALLE vor
 * `now` geendet haben. Dauerhafte Zonen bzw. fehlende Angaben -> false.
 */
export function italianZoneExpired(zone: any, now: Date = new Date()): boolean {
  const app = Array.isArray(zone?.applicability) ? zone.applicability : [];
  if (app.length === 0) return false;
  const nowMs = now.getTime();
  return app.every((a: any) => {
    if (!a || typeof a !== "object") return false;
    if (String(a.permanent ?? "").toUpperCase() === "YES") return false;
    const end = parseTs(a.endDateTime);
    return end != null && end < nowMs;
  });
}

/** Zonenliste aus der (bereits geparsten) Download-Antwort ziehen. */
export function italianEd269Zones(body: unknown): any[] {
  let b: unknown = body;
  if (typeof b === "string") {
    const s = b.replace(/^﻿/, "").trim();
    if (!s) return [];
    b = JSON.parse(s);
  }
  return ed269ExtractZones(b);
}

/**
 * Rohbytes des Downloads -> geparstes JSON. Erkennt ZIP (erste .json-Datei,
 * sonst erste Datei) und UTF-8-BOM. Wirft bei unlesbarem Inhalt.
 */
export function decodeItalianDownload(bytes: Uint8Array): unknown {
  let text: string;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const files = unzipSync(bytes);
    const names = Object.keys(files).filter((n) => !n.endsWith("/") && files[n].length > 0);
    const name = names.find((n) => /\.(geo)?json$/i.test(n)) ?? names[0];
    if (!name) throw new Error("d-flight: ZIP-Download ist leer");
    text = strFromU8(files[name]);
  } else {
    text = strFromU8(bytes);
  }
  text = text.replace(/^﻿/, "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) {
    throw new Error("d-flight: Download ist kein JSON");
  }
  return JSON.parse(text);
}

/**
 * Normalisiert den d-flight-ED-269-Download in die Feature-Form der App
 * (shared/ed269Pure.ts). Länder-Tagging (_country "it") und bbox ergänzt
 * finalizeDirectFeatures im Client.
 */
export function normalizeItalianZones(body: unknown, now: Date = new Date()): Ed269PureFeature[] {
  const zones = italianEd269Zones(body).filter((z) => z && typeof z === "object" && !italianZoneExpired(z, now));
  return ed269ZonesToFeatures(zones, {
    source: IT_GEOZONE_SOURCE_LABEL,
    extraProps: () => ({ attribution: IT_GEOZONE_ATTRIBUTION }),
  });
}
