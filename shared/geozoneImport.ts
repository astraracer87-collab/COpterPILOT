// Geozonen-Datei-Import (serverloser Rückfall für Länder, deren Server die
// Fernsteuerung nicht erreicht – erster Fall Rumänien: ROMATSA-TLS mit zu
// kleinem DH-Schlüssel, Android verbindet nicht).
//
// Akzeptiert .json/.geojson oder .zip (erste .json/.geojson im Archiv) und
// erkennt automatisch:
//  1. ED-269 (UASZoneVersion-Objekte mit `restriction` und `geometry[]`) →
//     shared/ed269Pure.ts
//  2. ED-318 (GeoJSON-UASZone-Features mit geometry.layer bzw. ED-318-Feldern
//     wie zoneAuthority/limitedApplicability/Sprach-Arrays) → shared/ed318Pure.ts
//  3. sonst einfache GeoJSON-FeatureCollection mit generischer Feldzuordnung
//     (restriction/type/name/lower/upper …, siehe geojsonImportToFeatures).
//     Unbekannte Beschränkung → REQ_AUTHORISATION (vorsichtig) + Hinweis.
//
// Texte bleiben in der Originalsprache (Übersetzung macht die App separat).
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { strFromU8, unzipSync } from "fflate";
import { normalizeEd269Restriction } from "./ed269Restriction";
import { ed269ExtractZones, ed269ZonesToFeatures, type Ed269PureFeature } from "./ed269Pure";
import {
  ed318Altitude,
  ed318ApplyAltitudes,
  ed318Applicability,
  ed318ExtractZones,
  ed318GeometryPolygons,
  ed318PolygonsGeometry,
  ed318Text,
  ed318ZonesToFeatures,
} from "./ed318Pure";
import { GEOZONE_IMPORT_ONLY_SOURCE_ISOS } from "./geozoneSourceMeta";

export const RO_GEOZONE_SOURCE_LABEL = "ROMATSA (Datei-Import)";
export const RO_ROMATSA_DRONES_URL = "https://flightplan.romatsa.ro/init/drones";
/** Länder ohne erreichbaren Online-Feed: Geozonen nur per Datei-Import
 * (Registry: kind "import-only"). */
export const GEOZONE_IMPORT_ONLY_ISOS: string[] = [...GEOZONE_IMPORT_ONLY_SOURCE_ISOS];

export type GeozoneImportFormat = "ed269" | "ed318" | "geojson";

export type GeozoneImportResult = {
  format: GeozoneImportFormat;
  features: Ed269PureFeature[];
  /** Name der JSON-Datei im ZIP (falls ZIP). */
  innerName?: string;
};

/** Datei-Bytes (JSON oder ZIP) → JSON-Text. ZIP: erste .json/.geojson. */
export function decodeGeozoneImportBytes(bytes: Uint8Array): { text: string; innerName?: string } {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const names: string[] = [];
    unzipSync(bytes, {
      filter: (f) => {
        if (/\.(geo)?json$/i.test(f.name) && !/(^|\/)__MACOSX\//.test(f.name)) names.push(f.name);
        return false;
      },
    });
    names.sort();
    const name = names[0];
    if (!name) throw new Error("Das ZIP enthält keine .json- oder .geojson-Datei.");
    const files = unzipSync(bytes, { filter: (f) => f.name === name });
    return { text: strFromU8(files[name]).replace(/^﻿/, ""), innerName: name };
  }
  return { text: strFromU8(bytes).replace(/^﻿/, "") };
}

const ED318_TYPES = /^(PROHIBITED|REQ_AUTHORI[SZ]ATION|CONDITIONAL|NO_RESTRICTION)$/i;

function looksEd269(z: any): boolean {
  return !!z && typeof z === "object" && z.type !== "Feature" && Array.isArray(z.geometry) && z.restriction != null &&
    z.geometry.some((v: any) => v && typeof v === "object" && v.horizontalProjection);
}

function looksEd318(z: any): boolean {
  if (!z || typeof z !== "object") return false;
  const p = z.type === "Feature" ? z.properties ?? {} : z;
  const g = z.geometry;
  if (g && !Array.isArray(g) && typeof g === "object" && g.layer && typeof g.layer === "object") return true;
  if (Array.isArray(g) && g.some((v: any) => v?.horizontalProjection)) return true; // ED-318 ohne `restriction`
  if (p.limitedApplicability != null || p.zoneAuthority != null) return true;
  if (p.identifier != null && typeof p.type === "string" && ED318_TYPES.test(p.type)) return true;
  return Array.isArray(p.name) && p.name.some((n: any) => n && typeof n === "object" && "lang" in n);
}

/** Format eines geparsten Datensatzes erkennen (null = unbekannt). */
export function detectGeozoneImportFormat(input: unknown): GeozoneImportFormat | null {
  const zones = ed318ExtractZones(input);
  if (zones.length === 0) return null;
  const sample = zones.slice(0, 50);
  if (sample.some(looksEd269)) return "ed269";
  if (sample.some(looksEd318)) return "ed318";
  if (sample.some((z: any) => z && z.type === "Feature" && z.geometry)) return "geojson";
  return null;
}

// ---------------------------------------------------------------------------
// Generisches GeoJSON
// ---------------------------------------------------------------------------

function normKey(k: string): string {
  const bare = k.includes(":") ? k.slice(k.lastIndexOf(":") + 1) : k;
  return bare.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function reader(props: Record<string, any> | null | undefined): (...names: string[]) => any {
  const map = new Map<string, any>();
  for (const [k, v] of Object.entries(props || {})) {
    const nk = normKey(k);
    if (!map.has(nk) || map.get(nk) == null || map.get(nk) === "") map.set(nk, v);
  }
  return (...names: string[]) => {
    for (const n of names) {
      const v = map.get(normKey(n));
      if (v == null) continue;
      if (typeof v === "string" && (!v.trim() || v.trim().toUpperCase() === "NULL")) continue;
      return v;
    }
    return undefined;
  };
}

/**
 * Freitext-/Codewert → App-Beschränkung; null = unbekannt. Versteht ED-269/
 * ED-318-Codes sowie englische/rumänische/deutsche Stichwörter.
 */
export function genericRestriction(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(typeof value === "object" ? (value as any).type ?? "" : value).trim();
  if (!raw) return null;
  const n = normalizeEd269Restriction(raw);
  if (["PROHIBITED", "REQ_AUTHORISATION", "CONDITIONAL", "NO_RESTRICTION", "RESTRICTED"].includes(n)) return n;
  const t = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/prohib|interzis|forbid|no.?fly|verbot|^p$/.test(t)) return "PROHIBITED";
  if (/author|autoriz|aprob|permit|approval|genehmig|clearance/.test(t)) return "REQ_AUTHORISATION";
  if (/restric|^r$/.test(t)) return "RESTRICTED";
  if (/condit|auflage/.test(t)) return "CONDITIONAL";
  if (/no.?restriction|fara restrict|info/.test(t)) return "NO_RESTRICTION";
  return null;
}

export interface GeozoneImportOptions {
  /** ISO-Land (Präfix für generierte zoneIds). */
  iso: string;
  /** Quellenlabel (properties.source). */
  source?: string;
  now?: Date;
}

/**
 * Einfache GeoJSON-FeatureCollection → App-Features. Feldzuordnung
 * (Groß-/Kleinschreibung, Unterstriche, Namespace egal):
 *  - Beschränkung: restriction, type, zoneType, restrictionType, category,
 *    class, status, tip, restrictie → genericRestriction; unbekannt/fehlend →
 *    REQ_AUTHORISATION (vorsichtig, `restrictionAssumed: true` + Hinweis).
 *  - Name: name, title, zoneName, designator, nume, denumire, identifier, id.
 *  - Höhen: lower/lowerLimit/lowerLim/floor/minAltitude bzw. upper/…/ceiling/
 *    maxAltitude; Einheit uom/unit/uomDimensions, Bezug lowerReference/… –
 *    Zahl ohne Einheit = Meter, ohne Bezug = AGL; Strings wie „120 m AGL“,
 *    „FL 65“, „GND“, „UNL“ werden gelesen.
 *  - Text: message, description, remarks, remark, info, observatii, details.
 *  - Zeit: applicability (ED-269) bzw. validFrom/validTo, startDateTime/
 *    endDateTime, start/end → abgelaufene Zonen entfallen.
 * Punkte mit radius werden als Kreis übernommen; Linien/Punkte ohne Radius entfallen.
 */
export function geojsonImportToFeatures(input: unknown, opts: GeozoneImportOptions): Ed269PureFeature[] {
  const now = opts.now ?? new Date();
  const prefix = opts.iso.toUpperCase();
  const out: Ed269PureFeature[] = [];
  const seen = new Map<string, number>();
  ed318ExtractZones(input).forEach((f: any, idx) => {
    if (!f || typeof f !== "object" || !f.geometry) return;
    const get = reader(f.properties);
    const g = f.geometry;
    const polygons = g.type === "Point"
      ? ed318GeometryPolygons({ ...g, radius: g.radius ?? get("radius", "radiusM", "raza") })
      : ed318GeometryPolygons(g);
    if (polygons.length === 0) return;

    const applicability = Array.isArray(get("applicability"))
      ? ed318Applicability(get("applicability"), now)
      : ed318Applicability(
          get("validFrom", "startDateTime", "start", "dateFrom", "valabilDe") != null || get("validTo", "endDateTime", "end", "dateTo", "valabilPana") != null
            ? [{
                startDateTime: get("validFrom", "startDateTime", "start", "dateFrom", "valabilDe"),
                endDateTime: get("validTo", "endDateTime", "end", "dateTo", "valabilPana"),
              }]
            : undefined,
          now,
        );
    if (applicability === null) return;

    const rawRestriction = get("restriction", "type", "zoneType", "restrictionType", "category", "class", "status", "tip", "tipZona", "restrictie");
    const known = genericRestriction(rawRestriction);
    const restriction = known ?? "REQ_AUTHORISATION";
    const identifier = String(get("identifier", "id", "code", "designator", "cod") ?? f.id ?? "").trim();
    const name = ed318Text(get("name", "title", "zoneName", "designator", "nume", "denumire")) || identifier || `Geozone ${idx + 1}`;
    const uom = get("uom", "unit", "units", "uomDimensions", "altitudeUnit");
    const lower = ed318Altitude(
      get("lower", "lowerLimit", "lowerLim", "lowerAltitude", "floor", "minAltitude", "minAlt", "bottom", "limitaInferioara"),
      get("lowerUom", "lowerUnit") ?? uom,
      get("lowerReference", "lowerRef", "lowerVerticalReference", "lowerDatum"),
    );
    const upper = ed318Altitude(
      get("upper", "upperLimit", "upperLim", "upperAltitude", "ceiling", "maxAltitude", "maxAlt", "top", "limitaSuperioara"),
      get("upperUom", "upperUnit") ?? uom,
      get("upperReference", "upperRef", "upperVerticalReference", "upperDatum"),
    );
    const text = ed318Text(get("message", "description", "remarks", "remark", "info", "observatii", "details", "note"));
    const message = [
      known == null ? "Beschränkung in der Datei nicht angegeben – vorsichtshalber als genehmigungspflichtig eingestuft." : "",
      text,
    ].filter(Boolean).join("\n\n");

    let zoneId = `${prefix}-${identifier || name}`;
    const n = seen.get(zoneId) ?? 0;
    seen.set(zoneId, n + 1);
    if (n > 0) zoneId = `${zoneId}~${n + 1}`;
    const props: Record<string, any> = {
      identifier: identifier || undefined,
      zoneId,
      name,
      restriction,
      originalType: rawRestriction != null ? String(typeof rawRestriction === "object" ? JSON.stringify(rawRestriction) : rawRestriction) : null,
      restrictionAssumed: known == null || undefined,
      message: message || undefined,
      source: opts.source,
    };
    if (applicability) props.applicability = applicability;
    ed318ApplyAltitudes(props, lower, upper);
    for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
    out.push({ type: "Feature", geometry: ed318PolygonsGeometry(polygons), properties: props });
  });
  return out;
}

/**
 * Geparsten Datensatz (oder JSON-Text) in App-Features wandeln. Wirft mit
 * deutscher Meldung, wenn das Format unbekannt ist oder keine Zone übrig bleibt.
 */
export function parseGeozoneImport(input: unknown, opts: GeozoneImportOptions): GeozoneImportResult {
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input.replace(/^﻿/, ""));
    } catch {
      throw new Error("Die Datei ist kein gültiges JSON.");
    }
  }
  const format = detectGeozoneImportFormat(data);
  if (!format) throw new Error("Unbekanntes Format – erwartet ED-269, ED-318 oder eine GeoJSON-FeatureCollection.");
  const now = opts.now ?? new Date();
  let features: Ed269PureFeature[];
  if (format === "ed269") {
    features = ed269ZonesToFeatures(ed269ExtractZones(data).length > 0 ? data : ed318ExtractZones(data), { source: opts.source });
    // ED-269-Hilfsfunktionen kennen keinen Ablauf: abgelaufene Zeitfenster entfernen.
    features = features.filter((f) => {
      const a = f.properties.applicability;
      if (!Array.isArray(a) || a.length === 0) return true;
      const app = ed318Applicability(a, now);
      if (app === null) return false;
      if (app === undefined) delete f.properties.applicability;
      else f.properties.applicability = app;
      return true;
    });
  } else if (format === "ed318") {
    features = ed318ZonesToFeatures(data, { source: opts.source, idPrefix: opts.iso.toUpperCase(), now });
  } else {
    features = geojsonImportToFeatures(data, { ...opts, now });
  }
  if (features.length === 0) throw new Error("Die Datei enthält keine gültigen (nicht abgelaufenen) Geozonen.");
  return { format, features };
}

/** Bytes (JSON/ZIP) → Import-Ergebnis. */
export function parseGeozoneImportBytes(bytes: Uint8Array, opts: GeozoneImportOptions): GeozoneImportResult {
  const { text, innerName } = decodeGeozoneImportBytes(bytes);
  return { ...parseGeozoneImport(text, opts), innerName };
}
