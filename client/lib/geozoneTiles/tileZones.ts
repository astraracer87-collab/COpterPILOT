// Umwandlung der unverändert gespeicherten Features (dipul-WFS, Géoplateforme-
// WFS, ŘLP ED-318) in das App-Modell GeozoneFeatureInfo – erst beim Lesen.
// Rein, ohne React-Native-Importe (unter tsx testbar).
import type { GeozoneFeatureInfo } from "../geozones";
import { GEOZONE_LAYERS } from "../../../shared/geozoneLayerCatalog";
import { dipulZoneFromFeature, frZoneFromWfsFeature } from "../geozoneQueries";
import { ed269RestrictionColors, normalizeEd269Restriction } from "../../../shared/ed269Restriction";
import { TILE_STORE_ATTRIBUTION, type TileStoreIso } from "./tileStoreCore";

const DIPUL_LAYER_BY_NAME = new Map(GEOZONE_LAYERS.map((l) => [l.wmsLayer, l]));

/** Ebene eines dipul-Features aus seiner WFS-ID („kontrollzonen.12“). */
export function dipulLayerOfId(id: string): string {
  const s = String(id || "");
  const dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(0, dot) : s;
}

const DE_ATTR = TILE_STORE_ATTRIBUTION.DE;
const DE_LINKS = [
  { label: "Quelle: dipul (DFS)", url: "https://www.dipul.de" },
  { label: "Lizenz CC BY-ND 4.0", url: DE_ATTR.url! },
];

function parseTs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

export function deZoneFromStored(f: any): GeozoneFeatureInfo | null {
  const layerName = dipulLayerOfId(f?.id);
  const layer = DIPUL_LAYER_BY_NAME.get(layerName) ?? { id: layerName, wmsLayer: layerName, label: layerName, defaultEnabled: true };
  const z = dipulZoneFromFeature(f, layer);
  if (!z) return null;
  const p = (f?.properties ?? {}) as Record<string, unknown>;
  const out: GeozoneFeatureInfo = {
    ...z,
    details: `${z.details ? `${z.details}\n` : ""}Quelle: ${DE_ATTR.label}`,
    links: DE_LINKS,
  };
  const start = parseTs(p.start_time);
  const end = parseTs(p.end_time);
  if (start != null || end != null) {
    out.validStartTs = start;
    out.validEndTs = end;
  }
  return out;
}

export function frZoneFromStored(f: any): GeozoneFeatureInfo | null {
  const z = frZoneFromWfsFeature(f);
  if (!z) return null;
  return {
    ...z,
    details: z.details.replace("Quelle: DGAC / Géoplateforme.", `Quelle: ${TILE_STORE_ATTRIBUTION.FR.label}.`),
    links: [{ label: "Géoplateforme (IGN)", url: TILE_STORE_ATTRIBUTION.FR.url! }],
  };
}

// --- Tschechien (ED-318) ----------------------------------------------------

function localized(list: unknown, prefer = ["de", "en", "cs"]): string {
  if (!Array.isArray(list)) return typeof list === "string" ? list : "";
  for (const lang of prefer) {
    const hit = list.find((t: any) => String(t?.lang || "").toLowerCase().startsWith(lang) && t?.text);
    if (hit) return String(hit.text);
  }
  const first = list.find((t: any) => t?.text);
  return first ? String(first.text) : "";
}

/** Kategorie (Ebenen-Bezeichnung) einer ŘLP-Zone aus Name/ID/Behörde. */
export function czCategory(name: string, identifier: string, authority: string): string {
  const n = name || "";
  if (/^Grid (ATZ|CTR)/i.test(n)) return `Höhenraster ${n.match(/^Grid (ATZ|CTR)/i)![1].toUpperCase()}`;
  if (/^Hust[ěe] osídlen/i.test(n)) return "Dicht besiedeltes Gebiet (HOP)";
  if (/^(Silnice|Dálnice)/i.test(n)) return "Straßen";
  if (/^Železni/i.test(n)) return "Bahnanlagen";
  if (/^Elektrick/i.test(n)) return "Energieanlagen";
  if (/(^|\s)(M?CTR|ATZ)(\s|$)/.test(n)) return "Kontrollzonen / ATZ";
  if (/^(HEL|PIS)/.test(n) || /^SLZ/.test(n)) return "Hubschrauber- und Sportflugplätze";
  if (/^LK/.test(identifier)) return "Lufträume (LKP/LKD/TSA/TRA/TMA)";
  if (/životního prostředí|Národní park|CHKO/i.test(authority + " " + n)) return "Naturschutz";
  if (/Armáda|obran/i.test(authority)) return "Militärische Objekte";
  return "Geozonen ČR";
}

const CZ_TYPE_DE: Record<string, string> = {
  PROHIBITED: "Flugverbot",
  REQ_AUTHORISATION: "Genehmigung erforderlich",
  CONDITIONAL: "Bedingt zulässig (Auflagen)",
  NO_RESTRICTION: "Keine Beschränkung",
};

function czLimitMeters(v: unknown, uom: string): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return /^ft$/i.test(uom) ? n * 0.3048 : n;
}

function lonLatRings(geometry: any): [number, number][][][] {
  const ring = (r: any): [number, number][] =>
    Array.isArray(r) ? r.filter((p: any) => Array.isArray(p) && p.length >= 2).map((p: any) => [Number(p[1]), Number(p[0])] as [number, number]) : [];
  if (geometry?.type === "Polygon") {
    const rings = (geometry.coordinates || []).map(ring).filter((r: any[]) => r.length >= 4);
    return rings.length ? [rings] : [];
  }
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates || [])
      .map((poly: any) => (Array.isArray(poly) ? poly.map(ring).filter((r: any[]) => r.length >= 4) : []))
      .filter((g: any[]) => g.length > 0);
  }
  return [];
}

export function czZoneFromStored(f: any): GeozoneFeatureInfo | null {
  const polygonGroups = lonLatRings(f?.geometry);
  if (polygonGroups.length === 0) return null;
  const p = f?.properties ?? {};
  const identifier = String(p.identifier ?? "");
  const name = localized(p.name, ["cs", "en"]) || identifier || "Geozone";
  const authority = Array.isArray(p.zoneAuthority) ? p.zoneAuthority.map((a: any) => localized(a?.name, ["cs", "en"])).filter(Boolean).join(", ") : "";
  const restriction = normalizeEd269Restriction(String(p.type ?? ""));
  const colors = ed269RestrictionColors(restriction);
  const layer = f?.geometry?.layer ?? {};
  const uom = String(layer.uom ?? "m");
  const lowerMeters = czLimitMeters(layer.lower, uom);
  const upperRaw = czLimitMeters(layer.upper, uom);
  // FL660 (66 000 ft AMSL) bedeutet praktisch „ohne Obergrenze“
  const upperMeters = upperRaw != null && upperRaw >= 15000 ? undefined : upperRaw;
  const lowerReference = /AMSL|MSL/i.test(String(layer.lowerReference ?? "")) ? "MSL" : "AGL";
  const upperRef = /AMSL|MSL/i.test(String(layer.upperReference ?? "")) ? "MSL" : "AGL";
  const altitudeLabel = `${lowerMeters == null ? "GND" : `${Math.round(lowerMeters)} m ${lowerReference}`} – ${
    upperMeters == null ? "unbegrenzt" : `${Math.round(upperMeters)} m ${upperRef}`
  }`;
  const category = czCategory(name, identifier, authority);
  const details: string[] = [
    `Zone: ${name}`,
    `Kategorie: ${category}`,
    `Beschränkung: ${CZ_TYPE_DE[restriction] ?? restriction}`,
    `Höhe: ${altitudeLabel}`,
  ];
  if (upperMeters != null && upperMeters <= 0) details.push("Hinweis: Höhengrenze 0 m – Flug nur mit Genehmigung.");
  const msg = Array.isArray(p.message) ? p.message.map((m: any) => m?.text).filter(Boolean).join(" ") : "";
  if (msg) details.push(`Hinweis der Behörde: ${msg}`);
  if (authority) details.push(`Zuständig: ${authority}`);
  if (identifier) details.push(`Kennung: ${identifier}`);
  details.push(
    `Quelle: ${TILE_STORE_ATTRIBUTION.CZ.label}. Vereinfachte ED-318-Daten – verbindlich sind die Zonen auf dronemap.gov.cz.`,
  );
  return {
    layerLabel: category,
    name,
    details: details.join("\n"),
    featureId: identifier ? `${identifier}|${name}` : undefined,
    polygonRings: polygonGroups.flat(),
    polygonGroups,
    country: "CZ",
    restriction,
    fillColor: colors.fill,
    strokeColor: colors.stroke,
    lowerMeters,
    upperMeters,
    altitudeLabel,
    lowerReference,
    links: [
      { label: "ŘLP ČR – UAS-Geozonen", url: TILE_STORE_ATTRIBUTION.CZ.url! },
      { label: "DroneMap (verbindlich)", url: "https://dronemap.gov.cz" },
    ],
  };
}

export function zoneFromStored(iso: TileStoreIso, f: any): GeozoneFeatureInfo | null {
  try {
    if (iso === "DE") return deZoneFromStored(f);
    if (iso === "FR") return frZoneFromStored(f);
    return czZoneFromStored(f);
  } catch {
    return null;
  }
}

/**
 * Dedupliziert Zonen per featureId (Zonen über mehrere Kacheln bzw. Teile,
 * CZ: an ED-318-Kachelgrenzen geschnittene Teile derselben Zone). Teile mit
 * gleicher ID, aber anderer Geometrie werden zu EINER Zone mit mehreren
 * Polygonen zusammengeführt.
 */
export function dedupeZones(zones: GeozoneFeatureInfo[]): GeozoneFeatureInfo[] {
  const byId = new Map<string, GeozoneFeatureInfo>();
  const out: GeozoneFeatureInfo[] = [];
  for (const z of zones) {
    const id = z.featureId ? `${z.layerLabel}|${z.featureId}` : "";
    if (!id) {
      out.push(z);
      continue;
    }
    const prev = byId.get(id);
    if (!prev) {
      const copy = { ...z, polygonGroups: z.polygonGroups ? [...z.polygonGroups] : undefined };
      byId.set(id, copy);
      out.push(copy);
      continue;
    }
    if (!z.polygonGroups?.length) continue;
    const have = new Set((prev.polygonGroups ?? []).map((g) => JSON.stringify(g[0]?.slice(0, 3))));
    for (const g of z.polygonGroups) {
      const sig = JSON.stringify(g[0]?.slice(0, 3));
      if (have.has(sig)) continue;
      have.add(sig);
      (prev.polygonGroups ??= []).push(g);
    }
    prev.polygonRings = (prev.polygonGroups ?? []).flat();
  }
  return out;
}
