// Malta (Transport Malta CAD / iDronect, tmcad.idronect.com) – Normalisierung
// der Zonen aus dem ONLINE-Abruf (Meteor-DDP Zones.getFilteredZones
// ({managedZones:true}), client/lib/geozoneDirect/maltaSource.ts, Doku §6a)
// und des manuellen Browser-Exports für den Datei-Import (Rückfall; Doku §7,
// docs/tools/malta/README.md). Der DDP-Abruf liefert dieselben Felder wie der
// Roh-Export (flightArea-GeoJSON + zoneId, name, forbidden, minHeight, …) und
// läuft durch denselben Normalisierer (Option `origin: "online"`).
//
// Drei Dateiformate werden erkannt:
//  1. Roh-Export (`malta_geozonen_roh_<datum>.geojson`, Layer „operator-zones“):
//     zoneId, name (inkl. Kontakt-E-Mail), type, forbidden (1/true), minHeight,
//     maxHeight, maxPilots, cost, center („lon,lat“), radius (m), archived …
//  2. normalisierte Datei aus normalisieren.py (`malta_geozonen.geojson`):
//     land "MT", zone_id, name, typ_code, verboten, min_hoehe, max_hoehe,
//     max_piloten, kosten, kreis_mitte_lon/lat, kreis_radius_m, archiviert,
//     quelle, stand.
//  3. normalisiertes Übergabe-Schema (Doku §6a): label (ohne Kontakt),
//     kontakt_email, auto_limit_m und die Rohwerte unter
//     _raw{zoneId, name, maxHeight, minHeight, type, forbidden, radius, …}.
// Kreiszonen liegen bereits als angenäherte Polygone vor.
//
// Beschränkung: forbidden/verboten → PROHIBITED, sonst REQ_AUTHORISATION
// (Flug nur mit Genehmigung/Absprache – vorsichtig, die Quelle kennt nur
// „verboten“ oder nicht).
//
// ⚠️ Höhen (Doku §6a): `maxHeight` (60/120/400/1200/8800 …) ist die
// LUFTRAUMDECKE (vermutlich ft), KEIN Drohnenlimit und keine Zonen-Obergrenze.
// Die Zone gilt daher ohne Obergrenze (unbegrenzt); `maxHeight` erscheint nur
// als Info „Luftraumdecke X ft“. Die Untergrenze (minHeight, Einheit/Bezug
// nicht angegeben) wird weiterhin VORSICHTIG als ft gelesen (kleinerer Wert →
// Zone reicht tiefer) und ohne Bezug (UNKNOWN – nie ausgeblendet) geführt.
// Die 9 LUQA-Flughafenzonen nennen im Namen „Auto Authorised maximum XX m
// AGL“ → `auto_limit_m` und Hinweis „Auto-Freigabe bis XX m AGL“. Das ist
// eine automatische FREIGABE (Antrag nötig), keine genehmigungsfreie Höhe:
// die Zone bleibt REQ_AUTHORISATION, es wird KEIN maxFlightHeightAglM gesetzt.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { ftToM } from "./geozoneKit/heights";
import { round1 } from "./geozoneKit/text";
import { localizedExtendedProperties, messageWithOriginal, sourceLineDe } from "./geozoneKit/messages";

/** Quellen-Label (Popup-Untertitel) – Online-Abruf per DDP. */
export const MT_GEOZONE_SOURCE_LABEL = "Transport Malta / iDronect";
/** Label importierter Zonen (Datei-Import als Rückfall). */
export const MT_GEOZONE_IMPORT_SOURCE_LABEL = "Transport Malta / iDronect (Datei-Import)";
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

export type MaltaImportVariant = "raw" | "normalized" | "handover";

function rawObject(p: Record<string, any>): Record<string, any> | null {
  return p._raw && typeof p._raw === "object" && !Array.isArray(p._raw) ? (p._raw as Record<string, any>) : null;
}

/**
 * Roh-Export (zoneId + forbidden/maxHeight/center), normalisierte Datei
 * (land MT + zone_id) oder Übergabe-Schema (label/kontakt_email/auto_limit_m
 * + _raw{maxHeight,minHeight,type,…})?
 */
export function maltaImportVariant(props: Record<string, any> | null | undefined): MaltaImportVariant | null {
  const p = props ?? {};
  const r = rawObject(p);
  if (r && ("maxHeight" in r || "minHeight" in r || "forbidden" in r || "zoneId" in r || "type" in r || "radius" in r)) {
    return "handover";
  }
  if ("label" in p && ("kontakt_email" in p || "auto_limit_m" in p)) return "handover";
  if (String(p.land ?? "").toUpperCase() === "MT" && "zone_id" in p) return "normalized";
  if ("zoneId" in p && ("forbidden" in p || "maxHeight" in p || "minHeight" in p || "center" in p)) return "raw";
  return null;
}

const AUTO_LIMIT_RE = /auto[\s-]*authori[sz]ed\s+(?:maximum|max\.?)\s*(?:of\s*)?(\d{1,4}(?:[.,]\d+)?)\s*m(?:etres|eters)?\s*AGL/i;

/** „Auto Authorised maximum XX m AGL“ aus dem Namenstext (LUQA-Zonen) → Meter, sonst null. */
export function parseMaltaAutoLimitM(text: unknown): number | null {
  const m = String(text ?? "").match(AUTO_LIMIT_RE);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
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

export interface MtNormalizeOptions {
  /** Herkunft: Datei-Import (Standard) oder Online-Abruf per DDP. */
  origin?: "import" | "online";
}

/** Ein Feature (Roh- oder normalisierter Export) → App-Feature; null = übersprungen. */
export function normalizeMalteseFeature(f: any, idx = 0, opts: MtNormalizeOptions = {}): MtFeature | null {
  const online = opts.origin === "online";
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  const p = f.properties || {};
  const variant = maltaImportVariant(p);
  if (!variant) return null;
  // Einheitliche Sicht auf die drei Formate (siehe Kopf).
  const r = rawObject(p) ?? {};
  const pick = (raw: unknown, normalized: unknown, handover: unknown): unknown =>
    variant === "raw" ? raw : variant === "normalized" ? normalized : handover;
  if (truthy(pick(p.archived, p.archiviert, p.archiviert ?? p.archived ?? r.archived))) return null;
  if ((variant === "raw" ? p.visible : variant === "handover" ? p.visible ?? r.visible : undefined) === false) return null;

  const zoneId =
    String(pick(p.zoneId, p.zone_id, p.zone_id ?? p.zoneId ?? p.id ?? r.zoneId ?? r._id) ?? "").trim() || `MT-${idx + 1}`;
  const forbidden = truthy(pick(p.forbidden, p.verboten, p.verboten ?? p.forbidden ?? r.forbidden));
  const minH = num(pick(p.minHeight, p.min_hoehe, r.minHeight ?? p.min_hoehe));
  const maxH = num(pick(p.maxHeight, p.max_hoehe, r.maxHeight ?? p.max_hoehe));
  const maxPilots = num(pick(p.maxPilots, p.max_piloten, r.maxPilots ?? p.max_piloten));
  const cost = num(pick(p.cost, p.kosten, r.cost ?? p.kosten));
  const radius = num(pick(p.radius, p.kreis_radius_m, r.radius ?? p.kreis_radius_m));
  const typeCode = pick(p.type, p.typ_code, r.type ?? p.typ_code);
  // Originaltext (Name inkl. Kontakt) – im Übergabe-Schema unter _raw.name.
  const original = String(pick(p.name, p.name, r.name ?? p.name ?? p.label) ?? "").trim();
  const split = splitMaltaName(original);
  const label = variant === "handover" ? String(p.label ?? "").replace(/\s+/g, " ").trim() : "";
  const name = label || split.name;
  const handoverEmail = variant === "handover" ? String(p.kontakt_email ?? "").trim() : "";
  const email = handoverEmail || split.email;
  const contact = split.contact || handoverEmail;
  const autoLimitM = num(variant === "handover" ? p.auto_limit_m : null) ?? parseMaltaAutoLimitM(original || name);
  const restriction = forbidden ? "PROHIBITED" : "REQ_AUTHORISATION";
  const lowerGnd = minH == null || minH <= 0;

  const lines: string[] = [`Malta-Geozone (Transport Malta / iDronect)${typeCode != null && typeCode !== "" ? ` · Typ-Code ${typeCode}` : ""}`];
  lines.push(
    forbidden
      ? "Flugverbot für Drohnen (in der Quelle als „forbidden“ markiert)."
      : "Flug nur mit Genehmigung/Absprache – Bedingungen bei Transport Malta (TMCAD) bzw. dem genannten Kontakt klären.",
  );
  if (!forbidden && autoLimitM != null) {
    lines.push(
      `Hinweis: Auto-Freigabe bis ${fmtRaw(autoLimitM)} m AGL – automatische Freigabe nach Antrag, kein genehmigungsfreier Flug.`,
    );
  }
  lines.push(
    lowerGnd
      ? "Höhe: ab Boden ohne Obergrenze."
      : `Höhe: ab ${fmtRaw(minH)} (Einheit und Bezug nicht angegeben, vermutlich ft) ohne Obergrenze.`,
  );
  if (maxH != null) lines.push(`Luftraumdecke ${fmtRaw(maxH)} ft (laut Quelle, vermutlich ft) – kein Drohnen-Höhenlimit.`);
  if (radius != null && radius > 0) lines.push(`Kreiszone mit Radius ca. ${Math.round(radius)} m.`);
  if (maxPilots != null && maxPilots > 0) lines.push(`Höchstzahl gleichzeitiger Piloten: ${maxPilots}.`);
  if (cost != null && cost > 0) lines.push(`Gebühr laut Quelle: ${cost}.`);
  if (contact) lines.push(`Kontakt: ${contact}${online ? " (für Genehmigungsanfragen laut Quelle)" : ""}`);
  lines.push(
    sourceLineDe(online ? "Transport Malta CAD / iDronect (online)" : "Transport Malta CAD / iDronect (manueller Export)", MT_GEOZONE_ATTRIBUTION),
  );
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
    source: online ? MT_GEOZONE_SOURCE_LABEL : MT_GEOZONE_IMPORT_SOURCE_LABEL,
    attribution: MT_GEOZONE_ATTRIBUTION,
    contactEmail: email,
    mtImportVariant: online ? undefined : variant,
    mtOnline: online || undefined,
    // Untergrenze vorsichtig als ft (Bezug leer = UNKNOWN); KEINE Obergrenze:
    // maxHeight ist die Luftraumdecke, nicht das Zonenvolumen (siehe Kopf).
    lowerMeters: lowerGnd ? 0 : round1(ftToM(minH as number)),
    lowerReference: lowerGnd ? "AGL" : undefined,
    altitudeText: lowerGnd ? "GND – UNL" : `${fmtRaw(minH)} – UNL (Einheit unbekannt)`,
    heightUnitUnknown: lowerGnd ? undefined : true,
    airspaceCeilingFt: maxH ?? undefined,
    // LUQA: automatische Freigabe bis X m AGL – nur Info, keine Höhen-Freigabe.
    auto_limit_m: autoLimitM ?? undefined,
  };
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", geometry: { type: g.type, coordinates: g.coordinates }, properties: props };
}

/** Feature-Liste → App-Features (archivierte entfallen, Dubletten über zoneId). */
export function normalizeMalteseImport(features: any[], opts: MtNormalizeOptions = {}): MtFeature[] {
  const out: MtFeature[] = [];
  const seen = new Set<string>();
  features.forEach((f, i) => {
    const n = normalizeMalteseFeature(f, i, opts);
    if (!n) return;
    const key = n.properties.zoneId;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  });
  return out;
}
