// Irland (IAA) und Luxemburg (DAC / Geoportail) – Normalisierung auf das
// App-Format. Siehe docs/ireland-geozones-integration.md und
// docs/luxembourg-geozones-integration.md.
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).
import { normalizeEd269Restriction } from "./ed269Restriction";
import { simplifyGeometry } from "./dutchGeozones";

export const IE_GEOZONE_SOURCE_LABEL = "Irish Aviation Authority (ED-269)";
export const LU_GEOZONE_SOURCE_LABEL = "DAC / Geoportail Luxembourg (CC0)";

const FT = 0.3048;

type Feature = { type: "Feature"; geometry: any; properties: Record<string, any>; id?: any };

// ---------------------------------------------------------------------------
// Irland
// ---------------------------------------------------------------------------

/** Aktuellen GeoJSON-Link aus der IAA-Seite lesen (Dateiname enthält das Datum). */
export function irishGeojsonUrlFromHtml(html: string): string | null {
  const m = html.match(/href="([^"]*\.geojson[^"]*)"/i);
  if (!m) return null;
  const href = m[1].replace(/&amp;/g, "&");
  return href.startsWith("http") ? href : `https://www.iaa.ie${href.startsWith("/") ? "" : "/"}${href}`;
}

function irishLimit(v: any, uom: string): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.round((String(uom).toLowerCase() === "ft" ? n * FT : n) * 10) / 10;
}

export function normalizeIrishFeature(f: Feature): Feature | null {
  if (!f?.geometry) return null;
  const p = f.properties || {};
  const layer = f.geometry.layer || {};
  const uom = layer.uom ?? "m";
  const restriction = normalizeEd269Restriction(String(p.type ?? p.restriction ?? "REQ_AUTHORISATION"));
  const lowerMeters = irishLimit(layer.lower, uom) ?? 0;
  const upperMeters = irishLimit(layer.upper, uom);
  const lines: string[] = [];
  if (p.message) lines.push(String(p.message));
  if (p.otherReasonInfo) lines.push(`Hinweis: ${p.otherReasonInfo}`);
  if (p.restrictionConditions) lines.push(`Bedingung: ${p.restrictionConditions}`);
  const auth = Array.isArray(p.zoneAuthority) ? p.zoneAuthority[0] : null;
  if (auth) lines.push(`Kontakt: ${[auth.name, auth.service, auth.email, auth.phone].filter(Boolean).join(" · ")}`);
  lines.push("IAA: nur zur Information, nicht zur Navigation – NOTAMs/TRAs zusätzlich prüfen.");
  const app = Array.isArray(p.limitedApplicability)
    ? p.limitedApplicability.map((a: any) => ({ permanent: "NO", startDateTime: a?.startDateTime, endDateTime: a?.endDateTime }))
    : undefined;
  const props: Record<string, any> = {
    ...p,
    restriction,
    name: String(p.name ?? p.identifier ?? "Geozone"),
    lowerMeters,
    lowerReference: String(layer.lowerReference ?? "AGL").toUpperCase(),
    upperReference: String(layer.upperReference ?? "AGL").toUpperCase(),
    message: lines.join("\n"),
    source: IE_GEOZONE_SOURCE_LABEL,
  };
  if (upperMeters != null) props.upperMeters = upperMeters;
  if (app && app.length) props.applicability = app;
  const { layer: _drop, ...geom } = f.geometry;
  return { type: "Feature", id: p.identifier ?? f.id, geometry: simplifyGeometry(geom), properties: props };
}

export function normalizeIrishZones(body: any): Feature[] {
  const raw: Feature[] = Array.isArray(body?.features) ? body.features : [];
  const seen = new Set<string>();
  const out: Feature[] = [];
  for (const f of raw) {
    const n = normalizeIrishFeature(f);
    if (!n) continue;
    const key = String(n.id ?? "");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Luxemburg (OGC API Features, natives Geoportail-Schema)
// ---------------------------------------------------------------------------

export function normalizeLuxembourgFeature(f: Feature): Feature | null {
  if (!f?.geometry) return null;
  const p = f.properties || {};
  if (String(p.statut ?? "PROD").toUpperCase() !== "PROD") return null;
  const resp = String(p.responsabilite ?? "");
  const restriction = /autorisation/i.test(resp) ? "REQ_AUTHORISATION" : /interdi/i.test(resp) ? "PROHIBITED" : "CONDITIONAL";
  const lines: string[] = [];
  if (p.description) lines.push(String(p.description));
  if (resp) lines.push(`Zuständig: ${resp}`);
  if (p.conditions) lines.push(`Bedingungen: ${p.conditions}`);
  if (p.exceptions) lines.push(`Ausnahmen: ${p.exceptions}`);
  if (p.remarques) lines.push(String(p.remarques));
  const props: Record<string, any> = {
    identifier: p.nom_zone ?? p.objectid,
    name: String(p.nom_zone ?? "Geozone") + (p.description ? ` – ${p.description}` : ""),
    restriction,
    lowerMeters: Number(p.min_height) || 0,
    lowerReference: "AGL",
    upperReference: "AGL",
    message: lines.join("\n"),
    country: "LUX",
    source: LU_GEOZONE_SOURCE_LABEL,
  };
  const up = Number(p.max_height);
  if (Number.isFinite(up) && up > 0) props.upperMeters = up;
  const start = p.start_date ? Date.parse(p.start_date) : NaN;
  const end = p.end_date ? Date.parse(p.end_date) : NaN;
  if (Number.isFinite(start)) props.validStartTs = start;
  if (Number.isFinite(end)) props.validEndTs = end;
  if (String(p.activite ?? "Actif").toLowerCase() !== "actif") props.hidden = true;
  return { type: "Feature", id: p.objectid ?? p.pygeoapi_id, geometry: simplifyGeometry(f.geometry), properties: props };
}

export function normalizeLuxembourgOgc(body: any): Feature[] {
  const raw: Feature[] = Array.isArray(body?.features) ? body.features : [];
  return raw.map(normalizeLuxembourgFeature).filter((f): f is Feature => !!f);
}
