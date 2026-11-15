// Umwandlung der unverändert gespeicherten Features (dipul-WFS, Géoplateforme-
// WFS, ŘLP ED-318, ENAIRE insignias) in das App-Modell GeozoneFeatureInfo – erst beim Lesen.
// Rein, ohne React-Native-Importe (unter tsx testbar).
import { translateTextDe, translateZoneNameDe } from "../../../shared/zoneTranslate";
import type { GeozoneFeatureInfo } from "../geozones";
import { GEOZONE_LAYERS } from "../../../shared/geozoneLayerCatalog";
import { dipulZoneFromFeature, frZoneFromWfsFeature } from "../geozoneQueries";
import {
  ed269ActivityFromProps,
  ed269RestrictionColors,
  ed269ScheduleFromProps,
  ed269ValidityFromProps,
  normalizeEd269Restriction,
  zoneEndedLongAgo,
} from "../../../shared/ed269Restriction";
import { ed318Applicability } from "../../../shared/ed318Pure";
import { restrictionLabelDe } from "../../../shared/restrictionPolicy";
import { capUnlimited, formatHeightRangeDe, parseHeight, type Height } from "../../../shared/heights";
import { TILE_STORE_ATTRIBUTION, type TileStoreIso } from "./tileStoreCore";
import { normalizeEnaireInsigniasFeature } from "../../../shared/spanishGeozones";
import { ES_NOTAM_COLORS, type EsNotamCategory } from "../../../shared/spanishNotams";

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

export function deZoneFromStored(f: any): GeozoneFeatureInfo | null {
  const layerName = dipulLayerOfId(f?.id);
  const layer = DIPUL_LAYER_BY_NAME.get(layerName) ?? { id: layerName, wmsLayer: layerName, label: layerName, defaultEnabled: true };
  const z = dipulZoneFromFeature(f, layer);
  if (!z) return null;
  // validStartTs/validEndTs (start_time/end_time) setzt dipulZoneFromFeature.
  return {
    ...z,
    details: `${z.details ? `${z.details}\n` : ""}Quelle: ${DE_ATTR.label}`,
    links: DE_LINKS,
  };
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

// ŘLP-Grenzen über den gemeinsamen Höhenparser: m/ft/FL, Bezug AGL/AMSL/STD
// (STD = Flugfläche, früher fälschlich als Meter AGL gelesen). FL660
// (≥ 15 000 m) bedeutet praktisch „ohne Obergrenze“.
const CZ_UNLIMITED_M = 15000;
function czHeight(v: unknown, uom: string, ref: unknown, side: "lower" | "upper"): Height | null {
  const h = parseHeight(v, uom, ref);
  return side === "upper" ? capUnlimited(h, CZ_UNLIMITED_M) : h;
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
  const restrictionSource = String(p.type ?? "");
  const restriction = normalizeEd269Restriction(restrictionSource);
  const colors = ed269RestrictionColors(restriction);
  const layer = f?.geometry?.layer ?? {};
  const uom = String(layer.uom ?? "m");
  const lower = czHeight(layer.lower, uom, layer.lowerReference, "lower") ?? { m: null, ref: "AGL", text: "GND" };
  const upper = czHeight(layer.upper, uom, layer.upperReference, "upper") ?? { m: null, ref: "UNKNOWN", text: "UNL" };
  const lowerMeters = lower.m ?? undefined;
  const upperMeters = upper.m ?? undefined;
  const lowerReference = lower.ref;
  const altitudeLabel = formatHeightRangeDe(lower, upper);
  const category = czCategory(name, identifier, authority);
  const details: string[] = [
    `Zone: ${czNameDe(name)}`,
    `Kategorie: ${category}`,
    `Beschränkung: ${restrictionLabelDe(restriction)}`,
    `Höhe: ${altitudeLabel}`,
  ];
  if (upperMeters != null && upperMeters <= 0) details.push("Hinweis: Höhengrenze 0 m – Flug nur mit Genehmigung.");
  const msg = Array.isArray(p.message) ? p.message.map((m: any) => m?.text).filter(Boolean).join(" ") : "";
  if (msg) {
    const tr = translateTextDe(msg, { markUntranslated: true });
    details.push(`Hinweis der Behörde: ${tr.text}`);
    if (tr.changed && !tr.originalIncluded) details.push(`Originaltext der Behörde: ${msg}`);
  }
  if (authority) details.push(`Zuständig: ${authority}`);
  if (identifier) details.push(`Kennung: ${identifier}`);
  // ED-318 limitedApplicability -> ED-269 applicability (ohne Ablauf-Filter:
  // ob die Zone zum Zeitpunkt aktiv ist, entscheidet zoneActivityAt). Nur lange
  // abgelaufene Zonen werden verworfen (Speicher).
  const rawApplicability = ed318Applicability(p.limitedApplicability ?? p.applicability, new Date(-8.64e15));
  const activityProps = rawApplicability ? { applicability: rawApplicability } : {};
  const { validStartTs, validEndTs } = ed269ValidityFromProps(activityProps);
  const ed269Applicability = ed269ActivityFromProps(activityProps);
  if (zoneEndedLongAgo({ validEndTs, ed269Applicability })) return null;
  const scheduleText = ed269ScheduleFromProps(activityProps);
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
    restrictionRaw: restrictionSource && restrictionSource !== restriction ? restrictionSource : undefined,
    fillColor: colors.fill,
    strokeColor: colors.stroke,
    lowerMeters,
    upperMeters,
    lower,
    upper,
    altitudeLabel,
    lowerReference,
    ...(upper.m != null ? { upperReference: upper.ref } : {}),
    ...(validStartTs != null || validEndTs != null ? { validStartTs, validEndTs } : {}),
    ...(ed269Applicability ? { ed269Applicability } : {}),
    ...(scheduleText.length > 0 ? { scheduleText } : {}),
    links: [
      { label: "ŘLP ČR – UAS-Geozonen", url: TILE_STORE_ATTRIBUTION.CZ.url! },
      { label: "DroneMap (verbindlich)", url: "https://dronemap.gov.cz" },
    ],
  };
}

// --- Spanien (ENAIRE insignias) ---------------------------------------------

/**
 * Gespeichertes bzw. live geladenes insignias-Feature → App-Zone: Normalisierung
 * wie die übrigen ED-318-Länder (shared/spanishGeozones.ts), dann das ED-269-
 * Lesemodell (client/lib/ed269.ts; lazy geladen – ed269.ts importiert die
 * Registry, die diesen Speicher importiert). Ebene je ENAIRE-Layer.
 */
export function esZoneFromStored(f: any, now: Date = new Date()): GeozoneFeatureInfo | null {
  const n = normalizeEnaireInsigniasFeature(f, now);
  if (!n) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseEd269ToGeozoneInfo } = require("../ed269") as typeof import("../ed269");
  const [z] = parseEd269ToGeozoneInfo([n], "ES");
  if (!z) return null;
  // NOTAM: Farben wie drones.enaire.es (R rot, UAS gelb, Warnung orange)
  const cat = n.properties.notamCategory as EsNotamCategory | undefined;
  const colors = cat && ES_NOTAM_COLORS[cat] ? { fillColor: ES_NOTAM_COLORS[cat].fill, strokeColor: ES_NOTAM_COLORS[cat].stroke } : {};
  // Sperrgebiete: IDENT_TXT für die Verknüpfung mit statischen NOTAM-Aktivierungen
  const ident = n.properties.esLayerKey === "es_restringidas" ? String(f?.properties?.IDENT_TXT ?? n.properties.identifier ?? "").trim() : "";
  return {
    ...z,
    ...colors,
    ...(ident ? { sourceIdent: ident } : {}),
    layerLabel: `ENAIRE – ${n.properties.esLayerLabel ?? "Geozonen"}`,
    details: `${z.details}\nQuelle: ${TILE_STORE_ATTRIBUTION.ES.label} (ENAIRE Drones, insignias)`,
    links: [...(z.links ?? []), { label: "ENAIRE Drones (verbindlich)", url: TILE_STORE_ATTRIBUTION.ES.url! }],
  };
}

export function zoneFromStored(iso: TileStoreIso, f: any): GeozoneFeatureInfo | null {
  try {
    if (iso === "DE") return deZoneFromStored(f);
    if (iso === "FR") return frZoneFromStored(f);
    if (iso === "ES") return esZoneFromStored(f);
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

/** Deutscher Zonenname für die Anzeige; Original in Klammern, wenn übersetzt. */
function czNameDe(name: string): string {
  const de = translateZoneNameDe(name);
  return de && de !== name ? `${de} (${name})` : name;
}
