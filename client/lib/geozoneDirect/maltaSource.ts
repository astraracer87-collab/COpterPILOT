// Direkter Abruf der maltesischen Drohnen-Geozonen (Transport Malta CAD /
// iDronect, tmcad.idronect.com) über Meteor-DDP – siehe
// docs/idronect-mt-api-integration.md §2 und §6a.
//
// Ablauf (anonym, kein Login – verifiziert im EU-Browser: 195 Zonen):
//  1. WebSocket wss://tmcad.idronect.com/websocket (rohes DDP, kein SockJS-Framing)
//  2. → {"msg":"connect","version":"1","support":["1","pre2","pre1"]}
//     ← {"msg":"connected","session":…}
//  3. → {"msg":"method","method":"Zones.getFilteredZones","params":[{"managedZones":true}],"id":"1"}
//  4. ← {"msg":"ping"} jederzeit → {"msg":"pong"} (mit id, falls mitgeschickt)
//  5. ← {"msg":"result","id":"1","result":[…]} bzw. {"msg":"result","id":"1","error":{…}}
//     Zeitlimit MT_DDP_TIMEOUT_MS; danach/bei Fehler wird die Verbindung geschlossen.
//
// Ergebnis: Array von Zonen-Dokumenten mit `flightArea` (GeoJSON: Feature,
// FeatureCollection oder Geometrie) + Feldern zoneId (bzw. _id), name (inkl.
// Kontakt-E-Mail), forbidden, minHeight, maxHeight, center, radius, archived …
// → als Roh-Export-Features durch shared/malteseGeozones.ts (origin "online"):
// forbidden → PROHIBITED, sonst REQ_AUTHORISATION; maxHeight = Luftraumdecke
// (ft, nur Info); LUQA „Auto Authorised maximum XX m AGL“ → auto_limit_m.
//
// Origin-Header: React Native erlaubt Header als 3. Konstruktor-Argument
// (`new WebSocket(url, protocols, { headers })`). Wir setzen
// Origin: https://tmcad.idronect.com wie die Web-App (der Headless-/US-Test
// ohne Browser-Kontext bekam „no access“, Doku §6/§6a). Im Web-Build setzt der
// Browser den Origin selbst und ignoriert das 3. Argument.
//
// Freigabe: laut Product Owner liegt sie vor (Doku-Kopf: „Freigabe liegt laut
// Product Owner vor“; §7 verlangte sie vor automatisiertem Bezug). Der
// Datei-Import (RcOfflineMapsScreen) bleibt Rückfall; ein erfolgreicher
// Online-Abruf ersetzt einen Import.
//
// Aus der US-Cloud nicht live testbar – Test mit nachgespielter DDP-Sitzung
// (client/lib/__tests__/maltaSource.test.ts). Bewusst frei von
// React-Native-/Expo-Importen.
import type { GeoFeature } from "./ed269Sources";
import { finalizeDirectFeatures } from "./directFetchUtil";
import { normalizeMalteseImport } from "../../../shared/malteseGeozones";

export const MT_DDP_URL = "wss://tmcad.idronect.com/websocket";
export const MT_DDP_ORIGIN = "https://tmcad.idronect.com";
export const MT_DDP_METHOD = "Zones.getFilteredZones";
/** Öffentlicher Filter der Karte (Doku §6a; `{}` liefert 0 Zonen). */
export const MT_DDP_PARAMS = [{ managedZones: true }] as const;
export const MT_DDP_TIMEOUT_MS = 45_000;
export const MT_UNREACHABLE_MESSAGE = "Transport Malta / iDronect nicht erreichbar – Datei-Import nutzen";

/** Minimale WebSocket-Schnittstelle (RN/Browser-WebSocket bzw. Test-Attrappe). */
export interface DdpSocket {
  onopen: ((ev?: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onerror: ((ev?: any) => void) | null;
  onclose: ((ev?: any) => void) | null;
  send(data: string): void;
  close(): void;
}

export type DdpSocketFactory = (url: string) => DdpSocket;

/** Standard: globaler WebSocket mit Origin-Header (RN: 3. Argument `{ headers }`). */
export const defaultDdpSocketFactory: DdpSocketFactory = (url) => {
  const WS: any = (globalThis as any).WebSocket;
  if (typeof WS !== "function") throw new Error("WebSocket nicht verfügbar");
  return new WS(url, [], { headers: { Origin: MT_DDP_ORIGIN } }) as DdpSocket;
};

export class MaltaDdpError extends Error {
  constructor(detail: string) {
    super(`${MT_UNREACHABLE_MESSAGE} (${detail})`);
    this.name = "MaltaDdpError";
  }
}

/**
 * Eine DDP-Methode aufrufen und das Ergebnis liefern. Beantwortet Pings,
 * ignoriert fremde Nachrichten, schließt die Verbindung immer.
 */
export function ddpCall(
  method: string,
  params: readonly unknown[],
  opts: { url?: string; socketFactory?: DdpSocketFactory; timeoutMs?: number; id?: string } = {},
): Promise<any> {
  const id = opts.id ?? "1";
  return new Promise((resolve, reject) => {
    let done = false;
    let ws: DdpSocket;
    const finish = (err: Error | null, value?: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      } catch {
        /* egal */
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new MaltaDdpError("Zeitüberschreitung")), opts.timeoutMs ?? MT_DDP_TIMEOUT_MS);
    try {
      ws = (opts.socketFactory ?? defaultDdpSocketFactory)(opts.url ?? MT_DDP_URL);
    } catch (e) {
      clearTimeout(timer);
      done = true;
      reject(new MaltaDdpError((e as Error)?.message || "WebSocket"));
      return;
    }
    const send = (msg: unknown) => {
      try {
        ws.send(JSON.stringify(msg));
      } catch (e) {
        finish(new MaltaDdpError((e as Error)?.message || "Senden fehlgeschlagen"));
      }
    };
    ws.onopen = () => send({ msg: "connect", version: "1", support: ["1", "pre2", "pre1"] });
    ws.onmessage = (ev) => {
      let m: any;
      try {
        m = JSON.parse(typeof ev?.data === "string" ? ev.data : String(ev?.data ?? ""));
      } catch {
        return; // z. B. SockJS-„o“-Rahmen – ignorieren
      }
      if (!m || typeof m !== "object") return;
      switch (m.msg) {
        case "connected":
          send({ msg: "method", method, params, id });
          break;
        case "ping":
          send(m.id != null ? { msg: "pong", id: m.id } : { msg: "pong" });
          break;
        case "failed":
          finish(new MaltaDdpError(`DDP-Version abgelehnt (${m.version ?? "?"})`));
          break;
        case "error":
          finish(new MaltaDdpError(String(m.reason ?? "DDP-Fehler")));
          break;
        case "result":
          if (String(m.id) !== id) break;
          if (m.error) {
            const e = m.error;
            finish(new MaltaDdpError(String(e.reason ?? e.message ?? e.error ?? "Methodenfehler")));
          } else finish(null, m.result);
          break;
        default:
          break; // updated, added, server_id …
      }
    };
    ws.onerror = (ev) => finish(new MaltaDdpError(ev?.message ? String(ev.message) : "Verbindungsfehler"));
    ws.onclose = (ev) => finish(new MaltaDdpError(`Verbindung geschlossen${ev?.code != null ? ` (${ev.code})` : ""}`));
  });
}

type Geometry = { type: string; coordinates: unknown };

function geometryOf(fa: any): { geometry: Geometry | null; props: Record<string, any> } {
  if (!fa || typeof fa !== "object") return { geometry: null, props: {} };
  if (fa.type === "Feature") return { geometry: fa.geometry ?? null, props: fa.properties ?? {} };
  if (fa.type === "FeatureCollection" && Array.isArray(fa.features)) {
    const polys: unknown[] = [];
    let props: Record<string, any> = {};
    for (const f of fa.features) {
      const g = f?.geometry;
      if (!g) continue;
      if (g.type === "Polygon") polys.push(g.coordinates);
      else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) polys.push(...g.coordinates);
      if (Object.keys(props).length === 0 && f.properties) props = f.properties;
    }
    if (polys.length === 0) return { geometry: null, props };
    return { geometry: polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys }, props };
  }
  if ((fa.type === "Polygon" || fa.type === "MultiPolygon") && Array.isArray(fa.coordinates)) return { geometry: fa, props: {} };
  return { geometry: null, props: {} };
}

/**
 * DDP-Ergebnis (Zonen-Dokumente) → Roh-Export-Features (gleiches Schema wie
 * export_tmcad_geozonen.js): Geometrie aus flightArea, Felder aus dem Dokument
 * (vor den flightArea-Properties), zoneId ersatzweise aus _id.
 */
export function maltaDdpResultToRawFeatures(result: unknown): { type: "Feature"; geometry: Geometry; properties: Record<string, any> }[] {
  const list = Array.isArray(result) ? result : Array.isArray((result as any)?.zones) ? (result as any).zones : [];
  const out: { type: "Feature"; geometry: Geometry; properties: Record<string, any> }[] = [];
  for (const doc of list) {
    if (!doc || typeof doc !== "object") continue;
    const { geometry, props } = geometryOf(doc.flightArea);
    if (!geometry) continue;
    const own: Record<string, any> = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === "flightArea") continue;
      if (v !== null && typeof v === "object" && !Array.isArray(v) && k !== "center") continue; // verschachtelte Objekte (Firma, Termine …) weglassen
      own[k] = v;
    }
    const properties: Record<string, any> = { ...props, ...own };
    if (properties.zoneId == null || properties.zoneId === "") {
      const fallback = doc._id ?? props._id ?? props.id;
      if (fallback != null) properties.zoneId = String(fallback);
    }
    // Normalisierer erkennt den Roh-Export an zoneId + (forbidden|maxHeight|minHeight|center).
    if (!("forbidden" in properties)) properties.forbidden = false;
    out.push({ type: "Feature", geometry, properties });
  }
  return out;
}

/** DDP-Ergebnis → finalisierte App-Features (testbar ohne Netz). */
export function maltaFeaturesFromDdpResult(result: unknown): GeoFeature[] {
  const features = normalizeMalteseImport(maltaDdpResultToRawFeatures(result), { origin: "online" }) as unknown as GeoFeature[];
  return finalizeDirectFeatures(features, "mt");
}

/** Abruf + Normalisierung (testbar mit eigener Socket-Fabrik). */
export async function loadMalta(opts: { socketFactory?: DdpSocketFactory; timeoutMs?: number } = {}): Promise<GeoFeature[]> {
  const result = await ddpCall(MT_DDP_METHOD, MT_DDP_PARAMS, opts);
  const features = maltaFeaturesFromDdpResult(result);
  if (features.length === 0) throw new Error("Transport Malta / iDronect lieferte keine Zonen");
  return features;
}

export async function fetchMalta(): Promise<GeoFeature[]> {
  return loadMalta();
}
