// Malta (Transport Malta CAD / iDronect, tmcad.idronect.com) – Normalisierung
// des MANUELLEN Browser-Exports für den Datei-Import. Siehe
// docs/idronect-mt-api-integration.md §7 und docs/tools/malta/README.md.
//
// Es gibt keinen automatischen Abruf: Die öffentlichen Zonen kommen nur über
// die Meteor-DDP-Methode Zones.getFilteredZones (Filter-Parameter unbekannt;
// automatisierter Bezug erst mit Datenfreigabe). Der Nutzer exportiert die
// gerenderten Zonen am PC (export_tmcad_geozonen.js) und importiert die Datei.
//
// Zwei Dateiformate werden erkannt:
//  1. Roh-Export (`malta_geozonen_roh_<datum>.geojson`, Layer „operator-zones“):
//     zoneId, name (inkl. Kontakt-E-Mail), type, forbidden (1/true), minHeight,
//     maxHeight, maxPilots, cost, center („lon,lat“), radius (m), archived …
//  2. normalisierte Datei aus normalisieren.py (`malta_geozonen.geojson`):
//     land "MT", zone_id, name, typ_code, verboten, min_hoehe, max_hoehe,
//     max_piloten, kosten, kreis_mitte_lon/lat, kreis_radius_m, archiviert,
//     quelle, stand.
// Kreiszonen liegen bereits als angenäherte Polygone vor.
//
// Beschränkung: forbidden/verboten → PROHIBITED, sonst REQ_AUTHORISATION
// (Flug nur mit Genehmigung/Absprache – vorsichtig, die Quelle kennt nur
// „verboten“ oder nicht).
//
// ⚠️ Höhen: Die Quelle nennt WEDER Einheit NOCH Bezug (Werte 60–8800, laut
// Doku „vermutlich ft“). Der Bezug bleibt deshalb leer (UNKNOWN – der
// Höhenfilter blendet solche Zonen nie aus) und die Meter werden jeweils
// VORSICHTIG gewählt: Untergrenze als ft (kleinerer Wert → Zone reicht tiefer),
// Obergrenze als m (größerer Wert → Zone reicht höher). Angezeigt wird der
// Rohwert mit Hinweis „Einheit nicht angegeben“.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { ftToM } from "./geozoneKit/heights";
import { round1 } from "./geozoneKit/text";
import { localizedExtendedProperties, messageWithOriginal, sourceLineDe } from "./geozoneKit/messages";

export const MT_GEOZONE_SOURCE_LABEL = "Transport Malta / iDronect (Datei-Import)";
export const MT_GEOZONE_ATTRIBUTION = "© Transport Malta CAD / iDronect";
export const MT_TMCAD_MAP_URL = "https://tmcad.idronect.com/map";

export type MtFeature = { type: "Feature"; geometry: any; properties: Record<string, any> };

function truthy(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "string") return ["1", "true", "yes", "ja"].includes(v.trim().toLowerCase());
  return !!v;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Roh-Export (zoneId + forbidden/maxHeight/center) oder normalisierte Datei (land MT + zone_id)? */
export function maltaImportVariant(props: Record<string, any> | null | undefined): "raw" | "normalized" | null {
  const p = props ?? {};
  if (String(p.land ?? "").toUpperCase() === "MT" && "zone_id" in p) return "normalized";
  if ("zoneId" in p && ("forbidden" in p || "maxHeight" in p || "minHeight" in p || "center" in p)) return "raw";
  return null;
}

/** Bezeichnung und Kontakt trennen („Victoria Health Centre  Contact a@gov.mt“). */
export function splitMaltaName(raw: unknown): { name: string; contact: string; email?: string } {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  const email = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  const m = s.match(/^(.*?)(?:\s*[-–,]?\s*(?:Please contact|Contact|Kontakt)\s*:?\s*)(.*)$/i);
  if (m && m[1].trim()) return { name: m[1].trim(), contact: m[2].trim(), ...(email ? { email } : {}) };
  if (email) {
    const name = s.replace(email, "").replace(/[\s,;:-]+$/, "").trim();
    return { name: name || s, contact: email, email };
  }
  return { name: s, contact: "" };
}

function fmtRaw(v: number | null): string {
  return v == null ? "–" : String(Math.round(v * 10) / 10);
}

/** Ein Feature (Roh- oder normalisierter Export) → App-Feature; null = übersprungen. */
export function normalizeMalteseFeature(f: any, idx = 0): MtFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  const p = f.properties || {};
  const variant = maltaImportVariant(p);
  if (!variant) return null;
  const raw = variant === "raw";
  if (truthy(raw ? p.archived : p.archiviert)) return null;
  if (raw && p.visible === false) return null;

  const zoneId = String((raw ? p.zoneId : p.zone_id) ?? "").trim() || `MT-${idx + 1}`;
  const forbidden = truthy(raw ? p.forbidden : p.verboten);
  const minH = num(raw ? p.minHeight : p.min_hoehe);
  const maxH = num(raw ? p.maxHeight : p.max_hoehe);
  const maxPilots = num(raw ? p.maxPilots : p.max_piloten);
  const cost = num(raw ? p.cost : p.kosten);
  const radius = num(raw ? p.radius : p.kreis_radius_m);
  const typeCode = raw ? p.type : p.typ_code;
  const { name, contact, email } = splitMaltaName(p.name);
  const restriction = forbidden ? "PROHIBITED" : "REQ_AUTHORISATION";

  const lines: string[] = [`Malta-Geozone (Transport Malta / iDronect)${typeCode != null && typeCode !== "" ? ` · Typ-Code ${typeCode}` : ""}`];
  lines.push(
    forbidden
      ? "Flugverbot für Drohnen (in der Quelle als „forbidden“ markiert)."
      : "Flug nur mit Genehmigung/Absprache – Bedingungen bei Transport Malta (TMCAD) bzw. dem genannten Kontakt klären.",
  );
  if (minH != null || maxH != null) {
    lines.push(`Höhe laut Quelle: ${minH == null || minH <= 0 ? "GND" : fmtRaw(minH)} bis ${fmtRaw(maxH)} – Einheit und Bezug nicht angegeben (vermutlich ft).`);
  }
  if (radius != null && radius > 0) lines.push(`Kreiszone mit Radius ca. ${Math.round(radius)} m.`);
  if (maxPilots != null && maxPilots > 0) lines.push(`Höchstzahl gleichzeitiger Piloten: ${maxPilots}.`);
  if (cost != null && cost > 0) lines.push(`Gebühr laut Quelle: ${cost}.`);
  if (contact) lines.push(`Kontakt: ${contact}`);
  lines.push(sourceLineDe("Transport Malta CAD / iDronect (manueller Export)", MT_GEOZONE_ATTRIBUTION));
  const original = String(p.name ?? "").trim();
  const message = messageWithOriginal(lines, original && original !== name ? original : null);

  const props: Record<string, any> = {
    identifier: zoneId,
    zoneId: `MT-${zoneId}`,
    name: name || zoneId,
    restriction,
    originalType: typeCode != null ? String(typeCode) : null,
    message,
    extendedProperties: localizedExtendedProperties(message, original && original !== name ? original : null, "en"),
    country: "MLT",
    source: MT_GEOZONE_SOURCE_LABEL,
    attribution: MT_GEOZONE_ATTRIBUTION,
    contactEmail: email,
    mtImportVariant: variant,
    // Untergrenze vorsichtig als ft, Obergrenze vorsichtig als m (siehe Kopf); Bezug leer = UNKNOWN.
    lowerMeters: minH == null || minH <= 0 ? 0 : round1(ftToM(minH)),
    lowerReference: minH == null || minH <= 0 ? "AGL" : undefined,
    upperMeters: maxH == null ? undefined : round1(maxH),
    altitudeText: `${minH == null || minH <= 0 ? "GND" : fmtRaw(minH)} – ${maxH == null ? "UNL" : fmtRaw(maxH)} (Einheit unbekannt)`,
    heightUnitUnknown: true,
  };
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", geometry: { type: g.type, coordinates: g.coordinates }, properties: props };
}

/** Feature-Liste → App-Features (archivierte entfallen, Dubletten über zoneId). */
export function normalizeMalteseImport(features: any[]): MtFeature[] {
  const out: MtFeature[] = [];
  const seen = new Set<string>();
  features.forEach((f, i) => {
    const n = normalizeMalteseFeature(f, i);
    if (!n) return;
    const key = n.properties.zoneId;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  });
  return out;
}
