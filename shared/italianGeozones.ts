// Italienische Geozonen (d-flight S.p.A., ENAV-Gruppe), siehe
// docs/dflight-it-api-integration.md („Anhang IT“ ist maßgeblich).
//
// Hauptweg (seit 2026-11-15): GeoServer-WFS mit dem Bearer-Token des eigenen
// d-flight-Kontos – Layer D-FLIGHT:ATM09_INFO (UAS-Geozonen), NO_FLY_ZONE
// (temporäre Verbotszonen) und NOTAM → normalizeItalianWfs (weiter unten).
// Der ED-269-Gesamtdownload ist für die Rolle USER gesperrt (401) und wird nur
// noch als optionaler erster Versuch genutzt (Operator-/USSP-Rollen).
//
// ED-269-Download `GET /geo-awareness/api/ed-269/geo-zones/download` (§4.1)
// – Eigenheiten / Annahmen (Format ist erst nach Login live zu bestätigen):
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
import { ed269CircleToPolygon, ed269ExtractZones, ed269ZonesToFeatures, type Ed269PureFeature } from "./ed269Pure";
import { ensureLonLat, type LonLatBounds } from "./geozoneKit/wfs";
import { round1 } from "./geozoneKit/text";
import { localizedExtendedProperties, messageWithOriginal, originalBlock, pushHints, sourceLineDe } from "./geozoneKit/messages";

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

// ===========================================================================
// GeoServer-WFS (Hauptweg) – docs/dflight-it-api-integration.md „Anhang IT“
// ===========================================================================
//
// GET https://www.d-flight.it/maps/wms?service=WFS&version=2.0.0&request=GetFeature
//     &typeNames=D-FLIGHT:ATM09_INFO&outputFormat=application/json&srsName=EPSG:4326
//     Authorization: Bearer <token>        (Paging count/startIndex)
//
// Layer (Zahlen laut Live-Analyse 2026-11-15):
//   ATM09_INFO   3.876 UAS-Geozonen (ENAC ATM-09, „max. Höhe + Regel“)
//   NO_FLY_ZONE 16.134 temporäre/dynamische Verbotszonen; Zeitfilter
//                viewparams=start_nfz:<jetzt>;end_nfz:9999-12-31T00:00;
//   NOTAM          18 drohnenrelevante NOTAMs; Zeitfilter analog mit
//                div_notam/dfv_notam/quota_max:20000
//
// ATM09_INFO-Felder (Doku): id, name, quota_max, type, rule, regola, subtype,
// lower_limit_m, upper_limit_m, valid_from, valid_to, priority, designator,
// title_rule, titolo_regola, note – Höhen bereits in METERN. Einen Höhenbezug
// nennt die Doku nicht; ATM-09 sind ENAC-Höhenlimits rund um Flugplätze
// (Höhenklassen 0/25/45/60/120 m, Layer ATM09) – also Flughöhen über Grund.
//
// Einstufung ATM09_INFO (Annahmen, mit Live-Fixture zu bestätigen):
//   | upper_limit_m (sonst quota_max) | App                                   |
//   |---------------------------------|---------------------------------------|
//   | 0                               | PROHIBITED (kein Flug)                |
//   | > 0                             | CONDITIONAL + maxFlightHeightAglM = X |
//   | fehlt, Regeltext „vietat…/      | PROHIBITED                            |
//   |   prohibit…/divieto/no fly“     |                                       |
//   | fehlt, sonst                    | REQ_AUTHORISATION (vorsichtig)        |
// Die Zone gilt ab Boden OHNE Obergrenze (das Höhenlimit ist eine Flughöhe,
// kein Volumen): lowerMeters 0 AGL, upperMeters entfällt. Über X m verlangt
// die Prüfkette die Höhenfrage („über X m steigen?“).
// NO_FLY_ZONE → PROHIBITED (temporär, Gültigkeit aus den Feldern); NOTAM →
// RESTRICTED, bei ausdrücklichem Verbotstext PROHIBITED (temporär). Abgelaufene Einträge entfallen.
// Texte: Regel-/NOTAM-Text bleibt italienisch (Originalblock), dazu eine
// deutsche Zusammenfassung (localizedMessages: de zuerst, dann it).

export const IT_DFLIGHT_WFS_URL = `${IT_DFLIGHT_BASE_URL}/maps/wms`;
export const IT_WFS_LAYER_ZONES = "D-FLIGHT:ATM09_INFO";
export const IT_WFS_LAYER_NFZ = "D-FLIGHT:NO_FLY_ZONE";
export const IT_WFS_LAYER_NOTAM = "D-FLIGHT:NOTAM";
export type ItalianWfsLayer = typeof IT_WFS_LAYER_ZONES | typeof IT_WFS_LAYER_NFZ | typeof IT_WFS_LAYER_NOTAM;
/** Seitengröße je Layer (3.876 / 16.134 / 18 Einträge laut Doku). */
export const IT_WFS_PAGE_SIZE: Readonly<Record<ItalianWfsLayer, number>> = {
  [IT_WFS_LAYER_ZONES]: 1000,
  [IT_WFS_LAYER_NFZ]: 2000,
  [IT_WFS_LAYER_NOTAM]: 500,
};
/** Grob Italien inkl. Inseln/Campione/Lampedusa – Lon- und Lat-Bereich überschneiden sich nicht. */
export const IT_LONLAT_BOUNDS: LonLatBounds = { minLon: 6, maxLon: 19, minLat: 35, maxLat: 48 };
export const IT_WFS_OPEN_END = "9999-12-31T00:00";

/** „jetzt“ im Format der Web-App (YYYY-MM-DDTHH:MM, UTC). */
export function italianViewparamTime(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

/** viewparams der Web-App: NFZ ab jetzt bis offen, NOTAM analog (div/dfv, quota_max 20000). */
export function italianWfsViewparams(layer: ItalianWfsLayer, now: Date = new Date()): string | null {
  const t = italianViewparamTime(now);
  if (layer === IT_WFS_LAYER_NFZ) return `start_nfz:${t};end_nfz:${IT_WFS_OPEN_END};`;
  if (layer === IT_WFS_LAYER_NOTAM) return `div_notam:${t};dfv_notam:${IT_WFS_OPEN_END};quota_max:20000;`;
  return null;
}

/** WFS-2.0-GetFeature-URL (GeoJSON, EPSG:4326) für einen d-flight-Layer. */
export function italianWfsUrl(
  layer: ItalianWfsLayer,
  opts: { count?: number; startIndex?: number; now?: Date; base?: string } = {},
): string {
  const params = [
    "service=WFS",
    "version=2.0.0",
    "request=GetFeature",
    `typeNames=${layer}`,
    "outputFormat=application/json",
    "srsName=EPSG:4326",
  ];
  if (opts.count != null) params.push(`count=${opts.count}`);
  if (opts.startIndex != null && opts.startIndex > 0) params.push(`startIndex=${opts.startIndex}`);
  const vp = italianWfsViewparams(layer, opts.now);
  if (vp) params.push(`viewparams=${encodeURIComponent(vp)}`);
  return `${opts.base ?? IT_DFLIGHT_WFS_URL}?${params.join("&")}`;
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function text(v: unknown): string {
  return v == null ? "" : String(v).replace(/\r\n/g, "\n").trim();
}

function meters(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}

/** Datum der d-flight-Felder (ISO, „YYYY-MM-DD HH:MM[:SS]“, „DD/MM/YYYY[ HH:MM]“) → ms, sonst null. */
export function parseItalianDate(v: unknown): number | null {
  const s = text(v);
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = dmy;
    return Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss);
  }
  let iso = s.replace(" ", "T");
  // Ohne Zeitzone gilt UTC (wie die viewparams der Web-App).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(iso)) iso += "Z";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += "T00:00:00Z";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function firstDate(p: Record<string, any>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const t = parseItalianDate(p[k]);
    if (t != null) return t;
  }
  return null;
}

const START_KEYS = ["valid_from", "start_nfz", "div", "div_notam", "data_inizio", "start_date", "startDateTime", "start"] as const;
const END_KEYS = ["valid_to", "end_nfz", "dfv", "dfv_notam", "data_fine", "end_date", "endDateTime", "end"] as const;

function fmtUtc(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Geometrie als (Multi)Polygon in Lon/Lat; Punkt mit `radius` (m) → Kreis. Sonst null. */
function italianGeometry(f: any): { type: string; coordinates: any } | null {
  const g = f?.geometry;
  if (!g || typeof g !== "object") return null;
  if ((g.type === "Polygon" || g.type === "MultiPolygon") && Array.isArray(g.coordinates)) {
    return ensureLonLat({ type: g.type, coordinates: g.coordinates }, IT_LONLAT_BOUNDS);
  }
  const radius = meters(f?.properties?.radius);
  if (g.type === "Point" && Array.isArray(g.coordinates) && radius != null && radius > 0) {
    const pt = ensureLonLat({ type: "Point", coordinates: g.coordinates }, IT_LONLAT_BOUNDS).coordinates as number[];
    return { type: "Polygon", coordinates: ed269CircleToPolygon([Number(pt[0]), Number(pt[1])], radius) };
  }
  return null;
}

function validity(p: Record<string, any>): { start: number | null; end: number | null } {
  return { start: firstDate(p, START_KEYS), end: firstDate(p, END_KEYS) };
}

function validityProps(start: number | null, end: number | null): Record<string, any> {
  const out: Record<string, any> = {};
  if (start != null) out.validStartTs = start;
  if (end != null) out.validEndTs = end;
  if (start != null || end != null) {
    out.applicability = [
      {
        permanent: "NO",
        ...(start != null ? { startDateTime: new Date(start).toISOString() } : {}),
        ...(end != null ? { endDateTime: new Date(end).toISOString() } : {}),
      },
    ];
  }
  return out;
}

function validityLine(start: number | null, end: number | null): string | null {
  if (start == null && end == null) return null;
  if (start != null && end != null) return `Gültig: ${fmtUtc(start)} bis ${fmtUtc(end)}`;
  return start != null ? `Gültig ab ${fmtUtc(start)}` : `Gültig bis ${fmtUtc(end as number)}`;
}

function finish(
  id: string,
  geometry: { type: string; coordinates: any },
  props: Record<string, any>,
  lines: string[],
  original: string,
): Ed269PureFeature {
  const message = messageWithOriginal(lines, original || null);
  const out: Record<string, any> = {
    ...props,
    identifier: id,
    zoneId: id,
    message,
    extendedProperties: localizedExtendedProperties(message, original || null, "it"),
    country: "ITA",
    source: IT_GEOZONE_SOURCE_LABEL,
    attribution: IT_GEOZONE_ATTRIBUTION,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { type: "Feature", geometry, properties: out };
}

const PROHIBITION_RE = /\bvietat|\bdivieto\b|\bprohibit|\bforbidden\b|\bno[\s-]?fly\b|\binterdett/i;

// ---------------------------------------------------------------------------
// ATM09_INFO
// ---------------------------------------------------------------------------

/** Einstufung + Flughöhe einer ATM09_INFO-Zone (Tabelle oben). */
export function italianAtm09Restriction(p: Record<string, any>): { restriction: string; maxAglM: number | null } {
  const upper = meters(p.upper_limit_m) ?? meters(p.quota_max);
  if (upper != null) {
    if (upper <= 0) return { restriction: "PROHIBITED", maxAglM: 0 };
    return { restriction: "CONDITIONAL", maxAglM: round1(upper) };
  }
  const rules = [p.rule, p.regola, p.title_rule, p.titolo_regola, p.type, p.subtype].map(text).join(" ");
  return { restriction: PROHIBITION_RE.test(rules) ? "PROHIBITED" : "REQ_AUTHORISATION", maxAglM: null };
}

/** Eine ATM09_INFO-Zone → App-Feature (null = keine Fläche bzw. abgelaufen). */
export function normalizeItalianAtm09Feature(f: any, now: Date = new Date(), idx = 0): Ed269PureFeature | null {
  const geometry = italianGeometry(f);
  if (!geometry) return null;
  const p: Record<string, any> = f.properties || {};
  const { start, end } = validity(p);
  if (end != null && end < now.getTime()) return null;
  const rawId = text(p.id) || text(f.id) || text(p.designator) || `${idx + 1}`;
  const id = `IT-ATM09-${rawId.replace(/^ATM09_INFO\./, "")}`;
  const name = text(p.name) || text(p.designator) || "Geozona ATM-09 (ENAC)";
  const { restriction, maxAglM } = italianAtm09Restriction(p);
  const lower = meters(p.lower_limit_m);
  const upper = meters(p.upper_limit_m);

  const lines = ["UAS-Geozone (ENAC ATM-09, d-flight)"];
  if (restriction === "PROHIBITED") lines.push("Flugverbot für Drohnen (Höhenlimit 0 m bzw. Verbot laut Regel).");
  else if (maxAglM != null) lines.push(`Max. Flughöhe laut d-flight (ENAC ATM-09): ${maxAglM} m über Grund.`);
  else lines.push("Flug nur mit Genehmigung/Koordinierung – Regel im Originaltext beachten.");
  if (lower != null && lower > 0) lines.push(`Höhenband laut d-flight: ${round1(lower)}–${upper != null ? round1(upper) : "?"} m.`);
  const hints: string[] = [];
  if (text(p.type) || text(p.subtype)) hints.push(`Typ: ${[text(p.type), text(p.subtype)].filter(Boolean).join(" / ")}`);
  if (text(p.designator)) hints.push(`Kennung: ${text(p.designator)}`);
  pushHints(lines, hints);
  const vl = validityLine(start, end);
  if (vl) lines.push(vl);
  lines.push(sourceLineDe("d-flight (ENAC ATM-09)", IT_GEOZONE_ATTRIBUTION));
  // Italienischer Regeltext zuerst, englische Fassung danach (beide Original).
  const original = originalBlock([p.titolo_regola, p.regola, p.title_rule, p.rule, p.note]);

  return finish(
    id,
    geometry,
    {
      name,
      restriction,
      reason: "Luftfahrt (ENAC ATM-09)",
      lowerMeters: 0,
      lowerReference: "AGL",
      upperReference: "AGL",
      maxFlightHeightAglM: maxAglM != null && maxAglM > 0 ? maxAglM : undefined,
      itLayer: "ATM09_INFO",
      itRule: text(p.regola) || text(p.rule) || undefined,
      priority: p.priority ?? undefined,
      ...validityProps(start, end),
    },
    lines,
    original,
  );
}

// ---------------------------------------------------------------------------
// NO_FLY_ZONE und NOTAM (temporär)
// ---------------------------------------------------------------------------

function temporaryHeights(p: Record<string, any>): Record<string, any> {
  const lower = meters(p.lower_limit_m);
  const upper = meters(p.upper_limit_m);
  const out: Record<string, any> = {};
  // Ohne Angabe: ab Boden ohne Obergrenze. Bezug der Meterwerte nennt die Doku
  // nicht → nur 0 als AGL, sonst UNKNOWN (wird nie ausgeblendet).
  if (lower == null || lower <= 0) {
    out.lowerMeters = 0;
    out.lowerReference = "AGL";
  } else out.lowerMeters = round1(lower);
  if (upper != null && upper > 0 && (lower == null || upper > lower)) out.upperMeters = round1(upper);
  return out;
}

/** Eine temporäre Verbotszone (NO_FLY_ZONE) → PROHIBITED; abgelaufen → null. */
export function normalizeItalianNfzFeature(f: any, now: Date = new Date(), idx = 0): Ed269PureFeature | null {
  const geometry = italianGeometry(f);
  if (!geometry) return null;
  const p: Record<string, any> = f.properties || {};
  const { start, end } = validity(p);
  if (end != null && end < now.getTime()) return null;
  const rawId = text(p.id) || text(f.id) || `${idx + 1}`;
  const id = `IT-NFZ-${rawId.replace(/^NO_FLY_ZONE\./, "")}`;
  const name = text(p.name) || text(p.nome) || text(p.designator) || "Zona di divieto temporanea (d-flight)";
  const lines = ["Temporäre Flugverbotszone (d-flight NO_FLY_ZONE) – Drohnenflug verboten."];
  const vl = validityLine(start, end);
  if (vl) lines.push(vl);
  lines.push(sourceLineDe("d-flight (temporäre Verbotszonen)", IT_GEOZONE_ATTRIBUTION));
  const original = originalBlock([p.description, p.descrizione, p.motivazione, p.reason, p.note, p.regola, p.rule]);
  return finish(
    id,
    geometry,
    {
      name,
      restriction: "PROHIBITED",
      ...temporaryHeights(p),
      isTemporary: true,
      _notamEligible: true,
      itLayer: "NO_FLY_ZONE",
      ...validityProps(start, end),
    },
    lines,
    original,
  );
}

/** Ein NOTAM-Gebiet → RESTRICTED bzw. PROHIBITED bei Verbotstext (temporär); abgelaufen → null. */
export function normalizeItalianNotamFeature(f: any, now: Date = new Date(), idx = 0): Ed269PureFeature | null {
  const geometry = italianGeometry(f);
  if (!geometry) return null;
  const p: Record<string, any> = f.properties || {};
  const { start, end } = validity(p);
  if (end != null && end < now.getTime()) return null;
  const rawId = text(p.id) || text(p.notam_id) || text(f.id) || `${idx + 1}`;
  const id = `IT-NOTAM-${rawId.replace(/^NOTAM\./, "")}`;
  const notamNo = text(p.notam) || text(p.notam_id) || text(p.series_number) || text(p.name);
  const name = notamNo ? `NOTAM ${notamNo.replace(/^NOTAM\s*/i, "")}` : "NOTAM (d-flight)";
  const lines = ["NOTAM für Drohnen (d-flight) – Inhalt beachten, Flug nur nach Prüfung der Auflagen."];
  const vl = validityLine(start, end);
  if (vl) lines.push(vl);
  lines.push(sourceLineDe("d-flight (NOTAM)", IT_GEOZONE_ATTRIBUTION));
  const original = originalBlock([p.text, p.testo, p.item_e, p.e, p.description, p.descrizione, p.note]);
  // NOTAM mit ausdrücklichem Verbot („PROHIBITED“, „vietato“ …) → Flugverbot.
  const restriction = PROHIBITION_RE.test(original) ? "PROHIBITED" : "RESTRICTED";
  return finish(
    id,
    geometry,
    {
      name,
      restriction,
      reason: "NOTAM",
      ...temporaryHeights(p),
      isTemporary: true,
      isNotam: true,
      _notamEligible: true,
      itLayer: "NOTAM",
      ...validityProps(start, end),
    },
    lines,
    original,
  );
}

function wfsFeatures(body: unknown): any[] {
  if (Array.isArray(body)) return body;
  const b = body as any;
  return Array.isArray(b?.features) ? b.features : [];
}

/**
 * WFS-Antwort (FeatureCollection oder Feature-Array) eines d-flight-Layers →
 * App-Features. Dedupe über identifier; abgelaufene Einträge entfallen.
 */
export function normalizeItalianWfs(body: unknown, layer: ItalianWfsLayer, now: Date = new Date()): Ed269PureFeature[] {
  const fn =
    layer === IT_WFS_LAYER_NFZ
      ? normalizeItalianNfzFeature
      : layer === IT_WFS_LAYER_NOTAM
        ? normalizeItalianNotamFeature
        : normalizeItalianAtm09Feature;
  const seen = new Set<string>();
  const out: Ed269PureFeature[] = [];
  wfsFeatures(body).forEach((f, i) => {
    const n = fn(f, now, i);
    if (!n) return;
    const key = String(n.properties.identifier);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  });
  return out;
}
