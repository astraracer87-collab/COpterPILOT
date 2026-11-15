// Griechenland (HASP/HCAA, DAGR) – Normalisierung der GeoJSON-Datei, die das
// PC-Skript docs/tools/greece/dagr_geozonen.py erzeugt (WMS-KML-Polygone +
// GetFeatureInfo-Attribute). Die App fragt DAGR selbst NICHT ab (Bot-Schutz;
// nur Bild-Overlay) – Vektorzonen gibt es nur per Datei-Import.
// Siehe docs/greece-romania-geozones-notes.md („Anhang GR“).
//
// Properties je Feature (Skript):
//   layer            all_limitation_layer | all_warning_layer |
//                    all_permifrag_layer | hellas_CTR
//   reg_no, name, authority, valid_from, valid_to,
//   alt_agl_from_ft, alt_agl_to_ft, alt_msl_from_ft, alt_msl_to_ft
//   (nicht zuordenbare Polygone: nur layer + candidates)
//
// Beschränkung je Ebene (Annahme, auf dem Gerät/mit HASP zu bestätigen):
//   all_limitation_layer → RESTRICTED (Einschränkungsgebiet – Freigabe nötig)
//   hellas_CTR           → REQ_AUTHORISATION (Kontrollzone)
//   all_warning_layer    → CONDITIONAL (Warngebiet)
//   all_permifrag_layer  → CONDITIONAL (genehmigte Flüge/Bereiche Dritter)
//   sonst                → REQ_AUTHORISATION (vorsichtig, mit Hinweis)
// Höhen in ft: AGL-Werte bevorzugt, sonst MSL.
//
// Lizenz: CC BY-NC-ND 4.0 – Nutzung nur im Rahmen der Datenfreigabe HASP/HCAA.
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { parseHeight, type Height } from "./geozoneKit/heights";
import { round1 } from "./geozoneKit/text";
import { localizedExtendedProperties, messageWithOriginal, sourceLineDe, heightLineDe } from "./geozoneKit/messages";

export const GR_GEOZONE_SOURCE_LABEL = "HASP / DAGR (Datei-Import)";
export const GR_IMPORT_ATTRIBUTION = "© HASP / HCAA – DAGR (CC BY-NC-ND 4.0)";

export const GR_DAGR_LAYER_INFO: Record<string, { restriction: string; labelDe: string }> = {
  all_limitation_layer: { restriction: "RESTRICTED", labelDe: "Einschränkungsgebiet (Limitation)" },
  hellas_CTR: { restriction: "REQ_AUTHORISATION", labelDe: "Kontrollzone (CTR)" },
  all_warning_layer: { restriction: "CONDITIONAL", labelDe: "Warngebiet (Warning)" },
  all_permifrag_layer: { restriction: "CONDITIONAL", labelDe: "Genehmigter Flugbereich (Permit)" },
};

export type GrFeature = { type: "Feature"; geometry: any; properties: Record<string, any> };

/** Stammt ein Feature aus dagr_geozonen.py? */
export function isDagrImportFeature(props: Record<string, any> | null | undefined): boolean {
  const p = props ?? {};
  const layer = String(p.layer ?? "");
  return /^(all_limitation_layer|all_warning_layer|all_permifrag_layer|hellas_CTR)/.test(layer) && ("reg_no" in p || "candidates" in p || "alt_agl_to_ft" in p);
}

/** DAGR-Datum („15/11/2026 00:00“, „2026-11-15 00:00“, ISO) → ms; null = unlesbar. */
export function parseDagrDate(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (dmy) {
    const t = Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 0), Number(dmy[5] ?? 0));
    return Number.isFinite(t) ? t : null;
  }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (ymd) return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), Number(ymd[4]), Number(ymd[5]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function ftHeight(v: unknown, ref: "AGL" | "MSL"): Height | null {
  const s = String(v ?? "").trim();
  if (!s || s === "-") return null;
  if (/^(GND|SFC)$/i.test(s)) return parseHeight("GND");
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return parseHeight(s, "ft", ref);
  return parseHeight(n, "ft", ref);
}

function heightText(h: Height | null, side: "lower" | "upper"): string {
  if (!h) return side === "lower" ? "GND" : "keine Angabe";
  if (h.m == null) return h.text === "GND" ? "GND" : "unbegrenzt";
  return h.unit === "ft" ? `${h.text} (${Math.round(h.m)} m)` : h.text;
}

export function normalizeGreekDagrFeature(f: any, idx: number, now: Date = new Date()): GrFeature | null {
  if (!f || typeof f !== "object" || !f.geometry) return null;
  const g = f.geometry;
  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null; // Linien (KML-LineString) entfallen
  const p = f.properties || {};
  const layer = String(p.layer ?? "");
  const info = GR_DAGR_LAYER_INFO[layer.replace(/_ann$/, "")];
  const matched = p.reg_no != null && String(p.reg_no).trim() !== "";
  const validFrom = parseDagrDate(p.valid_from);
  const validTo = parseDagrDate(p.valid_to);
  if (validTo != null && validTo < now.getTime()) return null;

  let lower = ftHeight(p.alt_agl_from_ft, "AGL");
  let upper = ftHeight(p.alt_agl_to_ft, "AGL");
  if (!lower && !upper) {
    lower = ftHeight(p.alt_msl_from_ft, "MSL");
    upper = ftHeight(p.alt_msl_to_ft, "MSL");
  }
  const restriction = info?.restriction ?? "REQ_AUTHORISATION";
  const regNo = matched ? String(p.reg_no).trim() : "";
  const name = String(p.name ?? "").trim() || (regNo ? `DAGR ${regNo}` : `DAGR-Zone ${idx + 1}`);

  const lines: string[] = [`DAGR-Zone ${regNo || "(ohne Kennung)"} · ${info?.labelDe ?? layer ?? "unbekannte Ebene"}`];
  if (restriction === "RESTRICTED") lines.push("Einschränkungsgebiet – Flug nur mit Freigabe/Genehmigung (HASP/HCAA bzw. zuständige Stelle).");
  else if (restriction === "REQ_AUTHORISATION") lines.push("Flug nur mit Genehmigung der Flugsicherung.");
  else lines.push("Hinweis-/Warngebiet – Flug unter Auflagen; Bedingungen in DAGR prüfen.");
  if (!info) lines.push("Ebene unbekannt – vorsichtshalber als genehmigungspflichtig eingestuft.");
  if (!matched) lines.push("Attribute konnten beim Export nicht eindeutig zugeordnet werden – Details in DAGR prüfen.");
  if (p.authority) lines.push(`Zuständig: ${String(p.authority).trim()}`);
  if (validFrom != null || validTo != null) {
    const d = (t: number | null) => (t == null ? "offen" : new Date(t).toISOString().slice(0, 16).replace("T", " "));
    lines.push(`Gültig: ${d(validFrom)} bis ${d(validTo)}`);
  }
  if (lower || upper) lines.push(`${heightLineDe(heightText(lower, "lower"), heightText(upper, "upper"), "DAGR")}.`);
  lines.push(sourceLineDe("HASP/HCAA – DAGR (Export mit dagr_geozonen.py)", GR_IMPORT_ATTRIBUTION));
  const original = [p.name ? `${String(p.name).trim()}${p.authority ? ` (${String(p.authority).trim()})` : ""}` : "", Array.isArray(p.candidates) ? p.candidates.join("\n") : ""]
    .filter(Boolean)
    .join("\n");
  const message = messageWithOriginal(lines, original || null);

  const props: Record<string, any> = {
    identifier: regNo || undefined,
    zoneId: `GR-${regNo || `${layer}-${idx + 1}`}`,
    name,
    restriction,
    originalType: layer || null,
    restrictionAssumed: info ? undefined : true,
    message,
    extendedProperties: localizedExtendedProperties(message, original || null, "el"),
    country: "GRC",
    source: GR_GEOZONE_SOURCE_LABEL,
    attribution: GR_IMPORT_ATTRIBUTION,
    grLayer: layer || undefined,
  };
  if (lower && lower.m != null) {
    props.lowerMeters = round1(lower.m);
    props.lowerReference = lower.ref === "UNKNOWN" ? undefined : lower.ref;
  } else {
    props.lowerMeters = 0;
    props.lowerReference = "AGL";
  }
  if (upper && upper.m != null) {
    props.upperMeters = round1(upper.m);
    if (upper.ref !== "UNKNOWN") props.upperReference = upper.ref;
  }
  if (validFrom != null || validTo != null) {
    const a: Record<string, any> = { permanent: "NO" };
    if (validFrom != null) a.startDateTime = new Date(validFrom).toISOString();
    if (validTo != null) a.endDateTime = new Date(validTo).toISOString();
    props.applicability = [a];
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", geometry: { type: g.type, coordinates: g.coordinates }, properties: props };
}

export function normalizeGreekDagrImport(features: any[], now: Date = new Date()): GrFeature[] {
  const out: GrFeature[] = [];
  const seen = new Set<string>();
  features.forEach((f, i) => {
    const n = normalizeGreekDagrFeature(f, i, now);
    if (!n) return;
    const key = `${n.properties.zoneId}|${JSON.stringify(n.geometry.coordinates).slice(0, 80)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  });
  return out;
}
