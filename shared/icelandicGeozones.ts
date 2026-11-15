// Isländische Geozonen (Samgöngustofa / ISAVIA, Drohnenkarte island.is/dronakort).
// Quelle: GeoServer-WFS auf gis.is (GeoJSON, ohne Authentifizierung), siehe
// docs/iceland-samgongustofa-api-integration.md.
//
// Layer (live geprüft 2026-11-15):
//   - samgongustofa:dronemap_isl_geom   → 271 Zonen, MultiPolygon, Felder
//       identifier ("NFZ-<n>"), country ("ISL"), name (isländisch),
//       type ("COMMON"), restriction ("CONDITIONAL"), purpose ("INFORMATION").
//       Alle 271 Zonen tragen exakt dieselben Werte für type/restriction/
//       purpose/country – es gibt KEINE Höhen- und KEINE Textfelder.
//   - samgongustofa:skyndilokanir_dronar → temporäre Sperrungen
//       ("skyndilokanir" = kurzfristige Sperrungen), Felder zoneType,
//       effectiveDate, expirationDate, contact; aktuell 0 Einträge.
//
// Einstufung (restriction) – Begründung:
//   Das Feld `restriction` steht durchgehend auf CONDITIONAL, die Kennungen
//   heißen aber „NFZ“ (No-Fly-Zone), und island.is beschreibt die Karteninhalte
//   als Gebiete mit besonderen Flugbeschränkungen: Flüge im Umkreis von 150 m um
//   sensible Infrastruktur (Kraftwerke, Alþingi, Präsidentensitz, Ministerien,
//   Botschaften, Polizei, Gefängnisse, Krankenhäuser) sind „verboten, außer mit
//   Genehmigung der Eigentümer/Betreiber“; an Flugplätzen „verboten ohne
//   Genehmigung des Flugplatzbetreibers“. Der ältere Schwesterlayer
//   samgongustofa:dronemap_ice_json führt dieselben Zonen als REQ_AUTHORISATION
//   („No drone flights allowed in this area.“). Daher – die vorsichtige Wahl:
//
//   | Quelle                 | Wert im Feed                   | App-Einstufung      |
//   |------------------------|--------------------------------|---------------------|
//   | dronemap_isl_geom      | PROHIBITED                     | PROHIBITED          |
//   | dronemap_isl_geom      | CONDITIONAL (alle 271, live)   | REQ_AUTHORISATION   |
//   | dronemap_isl_geom      | REQ_AUTHORISATION / RESTRICTED | unverändert         |
//   | dronemap_isl_geom      | NO_RESTRICTION / leer / sonst. | REQ_AUTHORISATION   |
//   | skyndilokanir_dronar   | zoneType = REQ_AUTHORISATION   | REQ_AUTHORISATION   |
//   | skyndilokanir_dronar   | alles andere (Sperrung)        | PROHIBITED          |
//
//   Naturschutzgebiete werden bewusst NICHT als NATURE (grün) eingestuft: auch
//   dort gelten laut island.is besondere Beschränkungen, Grün würde das
//   verharmlosen. Der Originalwert bleibt in `originalRestriction`.
//
// Höhen: Der Layer hat keine Höhengrenzen. Die Zonen gelten daher vom Boden an
// in jeder Höhe: lowerMeters = 0 (AGL), upperMeters bleibt undefined
// („unbegrenzt“) – damit greift weder der Höhenfilter noch eine Decken-Freigabe.
//
// Texte: Der Feed hat keine Beschreibung. `message` erhält den offiziellen
// englischen Wortlaut von island.is/en/drone-map passend zur (aus dem Namen
// abgeleiteten) Kategorie, dazu eine deutsche „Kategorie:“-Zeile. Namen bleiben
// isländisch; die Übersetzung erledigt shared/zoneTranslate.ts.
//
// Geometrie: unverändert in Originalpräzision (der Server liefert 4 Nachkomma-
// stellen, sowohl als GeoJSON als auch als GML) – keine Vereinfachung.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { normalizeEd269Restriction } from "./ed269Restriction";
import { wfsGetFeatureUrl, wfsHasMore } from "./geozoneKit/wfs";

export const IS_GEOZONE_SOURCE_LABEL = "Samgöngustofa (ISAVIA)";
export const IS_GEOZONE_ATTRIBUTION = "© Samgöngustofa / ISAVIA / gis.is";

export const IS_WFS_URL = "https://gis.is/geoserver/wfs";
export const IS_WFS_FALLBACK_URL = "https://gis.natt.is/geoserver/wfs";
export const IS_ZONES_LAYER = "samgongustofa:dronemap_isl_geom";
export const IS_CLOSURES_LAYER = "samgongustofa:skyndilokanir_dronar";
/** Seitengröße für WFS-Paging (count/startIndex). Live: 271 Zonen → 1 Seite. */
export const IS_WFS_PAGE_SIZE = 1000;

export type IsFeature = {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, any>;
  bbox?: [number, number, number, number];
};

/** WFS-2.0-GetFeature-URL (GeoJSON, WGS84, Achsfolge lon/lat). */
export function icelandWfsUrl(
  layer: string,
  opts: { base?: string; count?: number; startIndex?: number } = {},
): string {
  // outputFormat historisch unkodiert („application/json“) – bleibt so.
  return wfsGetFeatureUrl({ ...opts, base: opts.base ?? IS_WFS_URL, layer, encodeOutputFormat: false });
}

// ---------------------------------------------------------------------------
// Kategorie aus dem Namen (nur für Anzeige-Text, nicht für die Einstufung)
// ---------------------------------------------------------------------------

export type IsZoneCategory =
  | "energy"
  | "ministry"
  | "parliament"
  | "residence"
  | "embassy"
  | "police"
  | "prison"
  | "hospital"
  | "airport"
  | "nature"
  | "other";

// Botschaften heißen im Feed nur nach dem Land (älterer Layer: „<Land> Sendiráð“).
const IS_EMBASSY_NAMES = new Set([
  "Danmörk", "Finnland", "Frakkland", "Indland", "Japan", "Kanada", "Kína", "Noregur",
  "Pólland", "Rússland", "Svíþjóð", "UK", "USA", "Þýskaland",
]);
// Flugplätze heißen nur nach dem Ort (älterer Layer: „<Ort> flugvöllur“).
const IS_AIRPORT_NAMES = new Set([
  "Akureyri", "Bíldudalur", "Egilsstaðir", "Gjögur", "Grímsey", "Hornafjörður", "Húsavík",
  "Ísafjörður", "Keflavík", "Reykjavík", "Vestmannaeyjar", "Vopnafjörður", "Þórshöfn",
]);
const IS_NATURE_RE =
  /Friðland|Fólkvangur|Landslagsverndarsvæði|^(Surtsey|Þjórsárver|Hornstrandir|Látrabjarg|Dyrhólaey|Geysir|Gullfoss|Goðafoss|Dynjandi|Skógafoss|Ingólfshöfði|Fjallabak|Kerlingafjöll|Varmárósar|Urriðakotshraun|Dverghamrar|Akurey|Lundey|Blikastaðakró|Ströndin við Stapa|Svæði í Þjórsárdal|Búrfell, Búrfellsgjá)/;
const IS_ENERGY_RE = /virkjun|stöð|orka|myllur|^Mjólká|^Svartsengi$|^Bjarnarflag$|^Belgsholt$|^Hafið$/i;
// Belgsholt und Hafið (bei Búrfell) sind Windkraftanlagen.

export function icelandicZoneCategory(name: unknown): IsZoneCategory {
  const n = String(name ?? "").trim();
  if (!n) return "other";
  if (/ráðuneyti/i.test(n)) return "ministry";
  if (n === "Alþingi") return "parliament";
  // Präsidentensitz Bessastaðir liegt auf der Halbinsel Bessastaðanes.
  if (/^Bessastað/.test(n)) return "residence";
  if (/^Lögreglan\b/.test(n)) return "police";
  if (/^Fangelsi/.test(n)) return "prison";
  if (/^(HSS|HSU|HSV|SAk)\b|Landspítali|sjúkrahús/i.test(n)) return "hospital";
  if (IS_EMBASSY_NAMES.has(n) || /sendiráð/i.test(n)) return "embassy";
  if (IS_AIRPORT_NAMES.has(n) || /flugvöllur/i.test(n)) return "airport";
  if (IS_NATURE_RE.test(n)) return "nature";
  if (IS_ENERGY_RE.test(n)) return "energy";
  return "other";
}

export const IS_CATEGORY_LABELS_DE: Record<IsZoneCategory, string> = {
  energy: "Energieanlage (Kraftwerk)",
  ministry: "Ministerium",
  parliament: "Parlament (Alþingi)",
  residence: "Präsidentensitz (Bessastaðir)",
  embassy: "Botschaft",
  police: "Polizei",
  prison: "Gefängnis",
  hospital: "Krankenhaus",
  airport: "Flugplatz",
  nature: "Natur-/Schutzgebiet",
  other: "Gebiet mit besonderen Drohnen-Beschränkungen",
};

// Offizieller Wortlaut von island.is/en/drone-map (englisch, unverändert).
export const IS_TEXT_INFRASTRUCTURE =
  "Flying unmanned aircraft within 150 meters of sensitive public infrastructure, such as power plants, parliament buildings, presidential residences, ministries, embassies, police stations, prisons, or hospitals, is prohibited unless authorized by the owners or operators.";
export const IS_TEXT_AIRPORT =
  "Flying at airports or within airport zones is prohibited without authorization from the airport operator.";
export const IS_TEXT_AIRPORT_OBSTACLES =
  "Within restricted zones around scheduled flight airports, flying is allowed without special permission if the unmanned aircraft is flown below the height of the highest obstacles and within 50 meters of its flight path.";
// Angelehnt an „The drone map provides a comprehensive view of areas where
// special flight restrictions on drones are in place“.
export const IS_TEXT_GENERIC = "Special flight restrictions on drones are in place in this area.";

export function icelandicCategoryTexts(category: IsZoneCategory): string[] {
  switch (category) {
    case "airport":
      return [IS_TEXT_AIRPORT, IS_TEXT_AIRPORT_OBSTACLES];
    case "nature":
    case "other":
      return [IS_TEXT_GENERIC];
    default:
      return [IS_TEXT_INFRASTRUCTURE];
  }
}

// ---------------------------------------------------------------------------
// Einstufung
// ---------------------------------------------------------------------------

/** Einstufung einer Zone aus dronemap_isl_geom (Tabelle oben). */
export function icelandicRestriction(p: Record<string, any>): string {
  const raw = normalizeEd269Restriction(String(p?.restriction ?? ""));
  if (raw === "PROHIBITED" || raw === "REQ_AUTHORISATION" || raw === "RESTRICTED") return raw;
  return "REQ_AUTHORISATION";
}

/** Einstufung einer temporären Sperrung (skyndilokanir_dronar). */
export function icelandicClosureRestriction(p: Record<string, any>): string {
  const raw = normalizeEd269Restriction(String(p?.zoneType ?? p?.restriction ?? ""));
  return raw === "REQ_AUTHORISATION" ? "REQ_AUTHORISATION" : "PROHIBITED";
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

function hasPolygonGeometry(f: any): boolean {
  const t = f?.geometry?.type;
  return (t === "Polygon" || t === "MultiPolygon") && Array.isArray(f.geometry.coordinates);
}

function withBbox(out: IsFeature, f: any): IsFeature {
  if (Array.isArray(f?.bbox) && f.bbox.length === 4 && f.bbox.every((n: any) => Number.isFinite(Number(n)))) {
    out.bbox = f.bbox.map(Number) as [number, number, number, number];
  }
  return out;
}

/** Eine Zone aus dronemap_isl_geom → App-Format (Geometrie unverändert). */
export function normalizeIcelandicFeature(f: any): IsFeature | null {
  if (!f || !hasPolygonGeometry(f)) return null;
  const p: Record<string, any> = f.properties || {};
  const identifier = String(p.identifier ?? f.id ?? "").trim();
  const name = String(p.name ?? "").trim() || identifier || "Geozone";
  const restriction = icelandicRestriction(p);
  const category = icelandicZoneCategory(name);
  const lines = [`Kategorie: ${IS_CATEGORY_LABELS_DE[category]}`, ...icelandicCategoryTexts(category)];
  const props: Record<string, any> = {
    ...p,
    identifier: identifier || undefined,
    name,
    restriction,
    category,
    // Keine Höhen im Feed → ab Grund, ohne Obergrenze (gilt in jeder Höhe).
    lowerMeters: 0,
    lowerReference: "AGL",
    upperReference: "AGL",
    message: lines.join("\n"),
    source: IS_GEOZONE_SOURCE_LABEL,
    attribution: IS_GEOZONE_ATTRIBUTION,
  };
  if (restriction !== String(p.restriction ?? "")) props.originalRestriction = p.restriction ?? null;
  const out: IsFeature = {
    type: "Feature",
    id: identifier || undefined,
    geometry: f.geometry,
    properties: props,
  };
  return withBbox(out, f);
}

function parseTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** Eine temporäre Sperrung (skyndilokanir_dronar) → App-Format. Abgelaufene → null. */
export function normalizeIcelandicClosure(f: any, now: Date = new Date()): IsFeature | null {
  if (!f || !hasPolygonGeometry(f)) return null;
  const p: Record<string, any> = f.properties || {};
  const start = parseTs(p.effectiveDate);
  const end = parseTs(p.expirationDate);
  if (end != null && end < now.getTime()) return null;
  const id = `IS-TMP-${String(p.identifier ?? f.id ?? "").trim() || "unbekannt"}`;
  const restriction = icelandicClosureRestriction(p);
  const lines = ["Hinweis: Temporäre Sperrung für Drohnenflüge – der Flug ist hier verboten."];
  if (p.zoneType) lines.push(`Typ: ${String(p.zoneType)}`);
  if (p.contact) lines.push(`Kontakt: ${String(p.contact)}`);
  const props: Record<string, any> = {
    ...p,
    identifier: id,
    name: String(p.name ?? "").trim() || "Temporäre Sperrung (Samgöngustofa)",
    restriction,
    category: "closure",
    isTemporaryClosure: true,
    lowerMeters: 0,
    lowerReference: "AGL",
    upperReference: "AGL",
    message: lines.join("\n"),
    source: IS_GEOZONE_SOURCE_LABEL,
    attribution: IS_GEOZONE_ATTRIBUTION,
  };
  if (start != null) props.validStartTs = start;
  if (end != null) props.validEndTs = end;
  if (start != null || end != null) {
    props.applicability = [{
      permanent: "NO",
      ...(start != null ? { startDateTime: new Date(start).toISOString() } : {}),
      ...(end != null ? { endDateTime: new Date(end).toISOString() } : {}),
    }];
  }
  return withBbox({ type: "Feature", id, geometry: f.geometry, properties: props }, f);
}

function dedupe(features: (IsFeature | null)[]): IsFeature[] {
  const seen = new Set<string>();
  const out: IsFeature[] = [];
  for (const f of features) {
    if (!f) continue;
    const key = String(f.properties?.identifier ?? f.id ?? "");
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(f);
  }
  return out;
}

/** FeatureCollection (oder Feature-Array) aus dronemap_isl_geom; Dedupe über `identifier`. */
export function normalizeIcelandicZones(body: any): IsFeature[] {
  const raw: any[] = Array.isArray(body) ? body : Array.isArray(body?.features) ? body.features : [];
  return dedupe(raw.map(normalizeIcelandicFeature));
}

/** FeatureCollection (oder Feature-Array) aus skyndilokanir_dronar. */
export function normalizeIcelandicClosures(body: any, now: Date = new Date()): IsFeature[] {
  const raw: any[] = Array.isArray(body) ? body : Array.isArray(body?.features) ? body.features : [];
  return dedupe(raw.map((f) => normalizeIcelandicClosure(f, now)));
}

/** Zonen + Sperrungen zusammenführen (Dedupe über `identifier`). */
export function mergeIcelandicFeatures(zones: IsFeature[], closures: IsFeature[]): IsFeature[] {
  return dedupe([...zones, ...closures]);
}

/**
 * Soll nach dieser WFS-Seite eine weitere geladen werden? GeoServer liefert
 * numberMatched/numberReturned; ohne diese Angaben entscheidet die Seitengröße.
 */
export function icelandWfsHasMore(body: any, collected: number, pageSize: number): boolean {
  return wfsHasMore(body, collected, pageSize);
}
