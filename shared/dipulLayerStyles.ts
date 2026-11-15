// Kartenfarben der deutschen Geozonen je dipul-Ebene – wie in der offiziellen
// dipul-Karte (DFS). Quelle: die SLD-Stile des dipul-WMS
// (https://uas-betrieb.de/geoservices/dipul/wms?REQUEST=GetStyles&LAYERS=dipul:<ebene>),
// Stand 11/2026. Gruppen der DFS:
//   luftverkehr_zone      #CF2B2B  Flughäfen, Flugplätze, ED-R, Temporäre, CTR
//   luftverkehr_info      #CF2B2B  Modellflugplätze, Hängegleiter (nur gestrichelter Rand)
//   kontrollzone_zone     CTR nach type_code_detail (U_CONTROL_ZONE_1…4)
//   naturschutzflaechen   #67A147  NSG, Nationalparks, Vogelschutz, FFH
//   siedlung_zone         #F0CB51  Wohngrundstücke, Freibäder
//   behoerden_zone        #E56F07  Behörden, Botschaften, JVA, Polizei, Militär, Krankenhäuser, BSL-4 …
//   industrie_zone        #2A2869  Industrie, Kraftwerke, Umspannwerke, Stromleitungen, Windkraft
//   strassenverkehr_zone  #969EA6  Bundesautobahnen, Bundesstraßen
//   schienenverkehr_zone  #282C30  Bahnanlagen
//   schiffsverkehr_zone   #3493E1  Binnen-/Seewasserstraßen, Schifffahrtsanlagen
//
// Die Füllfarbe folgt der Zonenart (wie dipul). Die Einstufung (Verbot/
// Genehmigung) bleibt über den Rand sichtbar: Verbots- und Sperrzonen
// bekommen den roten Rand der Policy-Tabelle.
//
// Reines Modul (kein React Native) – unter tsx testbar.

import { RESTRICTION_POLICY, zonePolicy, zoneRestriction, type Restriction, type RestrictionZoneLike } from "./restrictionPolicy";
import { GEOZONE_LAYERS } from "./geozoneLayerCatalog";

export interface DipulLayerStyle {
  /** Grundfarbe (Hex) aus dem dipul-SLD. */
  color: string;
  /** Deckkraft der Füllung (dipul: 0,25; reine Info-Ebenen fast transparent). */
  fillOpacity: number;
  /** Deckkraft des Randes. */
  strokeOpacity: number;
}

const AIR = "#CF2B2B";
const NATURE = "#67A147";
const SETTLEMENT = "#F0CB51";
const AUTHORITY = "#E56F07";
const INDUSTRY = "#2A2869";
const ROAD = "#969EA6";
const RAIL = "#282C30";
const WATER = "#3493E1";

// Etwas kräftiger als im WMS (0,25 auf weißem Grund), weil die App die Zonen
// auf grauer bzw. Luftbild-Karte zeichnet; Verhältnis der Gruppen bleibt.
const ZONE: Omit<DipulLayerStyle, "color"> = { fillOpacity: 0.28, strokeOpacity: 0.9 };
const INFO: Omit<DipulLayerStyle, "color"> = { fillOpacity: 0.06, strokeOpacity: 0.75 };

export const DIPUL_LAYER_STYLES: Record<string, DipulLayerStyle> = {
  kontrollzonen: { color: AIR, ...ZONE },
  flugbeschraenkungsgebiete: { color: AIR, ...ZONE },
  temporaere_betriebseinschraenkungen: { color: AIR, ...ZONE },
  flughaefen: { color: AIR, ...ZONE },
  flugplaetze: { color: AIR, ...ZONE },
  modellflugplaetze: { color: AIR, ...INFO },
  haengegleiter: { color: AIR, ...INFO },
  naturschutzgebiete: { color: NATURE, ...ZONE },
  nationalparks: { color: NATURE, ...ZONE },
  vogelschutzgebiete: { color: NATURE, ...ZONE },
  "ffh-gebiete": { color: NATURE, ...ZONE },
  wohngrundstuecke: { color: SETTLEMENT, ...ZONE },
  freibaeder: { color: SETTLEMENT, ...ZONE },
  behoerden: { color: AUTHORITY, ...ZONE },
  diplomatische_vertretungen: { color: AUTHORITY, ...ZONE },
  internationale_organisationen: { color: AUTHORITY, ...ZONE },
  justizvollzugsanstalten: { color: AUTHORITY, ...ZONE },
  polizei: { color: AUTHORITY, ...ZONE },
  sicherheitsbehoerden: { color: AUTHORITY, ...ZONE },
  militaerische_anlagen: { color: AUTHORITY, ...ZONE },
  krankenhaeuser: { color: AUTHORITY, ...ZONE },
  labore: { color: AUTHORITY, ...ZONE },
  industrieanlagen: { color: INDUSTRY, ...ZONE },
  kraftwerke: { color: INDUSTRY, ...ZONE },
  umspannwerke: { color: INDUSTRY, ...ZONE },
  stromleitungen: { color: INDUSTRY, ...ZONE },
  windkraftanlagen: { color: INDUSTRY, ...ZONE },
  bundesautobahnen: { color: ROAD, ...ZONE },
  bundesstrassen: { color: ROAD, ...ZONE },
  bahnanlagen: { color: RAIL, ...ZONE },
  binnenwasserstrassen: { color: WATER, ...ZONE },
  seewasserstrassen: { color: WATER, ...ZONE },
  schifffahrtsanlagen: { color: WATER, ...ZONE },
};

/** Füllfarbe der Kontrollzonen nach type_code_detail (dipul-SLD „kontrollzone_zone“). */
const CTR_DETAIL_FILL: Record<string, string> = {
  U_CONTROL_ZONE_1: "#660004",
  U_CONTROL_ZONE_2: "#F25100",
  U_CONTROL_ZONE_3: "#E17C4B",
  U_CONTROL_ZONE_4: "#A743A7",
};

export function hexToRgbaString(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

const KEY_BY_LABEL = new Map(GEOZONE_LAYERS.map((l) => [l.label.toLowerCase(), l.wmsLayer]));

/**
 * Ebenen-Schlüssel normalisieren: wmsLayer/ID, „dipul:…“, WFS-ID
 * („kontrollzonen.12“) oder das Ebenen-Label des Katalogs („Kontrollzonen (CTR)“,
 * so steht es in layerLabel älterer, gespeicherter Zonen).
 */
export function normalizeDipulLayerKey(layer: string | null | undefined): string {
  const raw = String(layer ?? "").trim();
  let s = raw.toLowerCase();
  if (s.startsWith("dipul:")) s = s.slice(6);
  if (DIPUL_LAYER_STYLES[s]) return s;
  const dot = s.lastIndexOf(".");
  if (dot > 0 && DIPUL_LAYER_STYLES[s.slice(0, dot)]) return s.slice(0, dot);
  const byLabel = KEY_BY_LABEL.get(s);
  if (byLabel) return byLabel;
  return s;
}

export function dipulLayerStyle(layer: string | null | undefined): DipulLayerStyle | null {
  return DIPUL_LAYER_STYLES[normalizeDipulLayerKey(layer)] ?? null;
}

/**
 * Kartenfarben einer deutschen dipul-Zone: Füllung nach Zonenart (dipul),
 * Rand nach Zonenart – bei Verbot/Sperrgebiet der rote Rand der Policy.
 * null = unbekannte Ebene (Aufrufer nimmt die Policy-Farbe).
 */
export function dipulZoneColors(
  layer: string | null | undefined,
  opts: { typeCodeDetail?: string | null; restriction?: Restriction | null } = {},
): { fill: string; stroke: string } | null {
  const key = normalizeDipulLayerKey(layer);
  const style = DIPUL_LAYER_STYLES[key];
  if (!style) return null;
  const detail = String(opts.typeCodeDetail ?? "").trim().toUpperCase();
  const fillHex = key === "kontrollzonen" && CTR_DETAIL_FILL[detail] ? CTR_DETAIL_FILL[detail] : style.color;
  const fill = hexToRgbaString(fillHex, style.fillOpacity);
  const r = opts.restriction;
  const stroke = r === "PROHIBITED" || r === "RESTRICTED" ? RESTRICTION_POLICY[r].stroke : hexToRgbaString(style.color, style.strokeOpacity);
  return { fill, stroke };
}

/**
 * Kartenfarben einer beliebigen Zone: eigene Farbe der Quelle (fillColor/
 * strokeColor) → für DE die dipul-Farbe der Ebene (auch für ältere, ohne Farbe
 * gespeicherte Zonen) → Policy-Farbe nach Einstufung.
 */
export function zoneMapColors(
  z: (RestrictionZoneLike & { fillColor?: string | null; strokeColor?: string | null }) | null | undefined,
): { fill: string; stroke: string } {
  const policy = zonePolicy(z);
  let fill = z?.fillColor || null;
  let stroke = z?.strokeColor || null;
  if ((!fill || !stroke) && String(z?.country ?? "").toUpperCase() === "DE") {
    const de = dipulZoneColors(z?.layerLabel, { restriction: zoneRestriction(z) });
    if (de) {
      fill = fill || de.fill;
      stroke = stroke || de.stroke;
    }
  }
  return { fill: fill || policy.fill, stroke: stroke || policy.stroke };
}
