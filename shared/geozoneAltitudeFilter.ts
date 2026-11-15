// Höhen-Filter für vektorbasierte ED-269-Geozonen (AT/BE/DK).
//
// Bewusst frei von React-Native-Imports, damit die reine Logik sowohl von der
// Mobile-App (client/) als auch von der Web-Karte (web/) UND unter dem
// tsx-Testrunner (web/run-tests.sh) genutzt werden kann.
//
// Idee: Geozonen mit einer Untergrenze, die über der erreichbaren Flughöhe
// liegt, sind für den Piloten irrelevant (z. B. FLORENNES TMA 2500–4500 m MSL
// für eine Mini 5 Pro mit 120 m AGL) und werden ausgeblendet. WMS-Raster-Zonen
// (DE/CH/LU/NL/FR) sind hier NICHT erfasst – sie werden serverseitig zu
// Kachelbildern zusammengesetzt und lassen sich nicht client-seitig filtern.

import { normalizeRestriction, restrictionFromText } from "./restrictionPolicy";
import { heightFromMeters, normalizeVRef, type Height, type VRef } from "./heights";

// Standard-erreichbare Höhe (EU Open-Kategorie: 120 m AGL), wenn keine Drohne
// gewählt ist bzw. keine geplante Höhe vorliegt.
export const DEFAULT_REACHABLE_ALTITUDE_M = 120;

export type AltitudeReference = VRef;

// Normalisiert die verschiedenen Höhenbezugs-Schreibweisen der Anbieter
// (shared/heights.ts normalizeVRef): AGL/SFC/GND/HEI -> AGL; MSL/AMSL/ALT/
// WGS84/STD/FL -> MSL; leer/unbekannt -> UNKNOWN. UNKNOWN wird vom Höhenfilter
// NIE ausgeblendet (früher stiller AGL-Rückfall – unsicher).
export function normalizeAltitudeReference(raw: any): AltitudeReference {
  return normalizeVRef(raw).ref;
}

// ---------------------------------------------------------------------------
// Gelände (MSL -> AGL)
//
// Eine Zone mit MSL-Untergrenze L ist erreichbar, sobald IRGENDEIN Punkt des
// Flugvolumens sie berührt: höchste Flughöhe MSL = höchstes Gelände im
// Planungsradius + geplante Höhe AGL. Deshalb zählt das MAXIMUM der
// Geländehöhe im Radius, nicht der Mittelpunkt (sonst blendet der Filter im
// Gebirge Zonen fälschlich aus). Gemessen wird günstig an Mittelpunkt + zwei
// Ringen à 8 Punkten (client/lib/elevation.ts fetchTerrainEstimate, ein
// Open-Meteo-Aufruf, Cache). Margen:
// - TERRAIN_SAMPLED_MARGIN_M: Gipfel zwischen den Stützpunkten.
// - TERRAIN_CENTER_ONLY_MARGIN_M: nur der Mittelpunkt ist bekannt (offline,
//   Altaufrufer mit terrainElevationM) -> Maximum ≈ Mitte + 150 m.
// - STD (Flugfläche = Druckhöhe): bei tiefem Luftdruck/Kälte liegt die wahre
//   Höhe einer FL-Grenze bis zu einigen hundert Metern tiefer -> 300 m.
// - WGS84 (ellipsoidisch): in Europa ca. 35–55 m über MSL -> 60 m.
// Für Obergrenzen (Zone liegt komplett unter dem Gelände) zählt das MINIMUM
// mit Marge; ohne mehrere Stützpunkte wird über die Obergrenze nie
// ausgeblendet.
// ---------------------------------------------------------------------------

export const TERRAIN_SAMPLED_MARGIN_M = 30;
export const TERRAIN_CENTER_ONLY_MARGIN_M = 150;
export const STD_DATUM_MARGIN_M = 300;
export const WGS84_DATUM_MARGIN_M = 60;
export const TERRAIN_MIN_MARGIN_M = 100;

export interface TerrainEstimate {
  /** Geländehöhe MSL am Mittelpunkt (null = unbekannt). */
  centerM: number | null;
  /** Höchster/tiefster gemessener Stützpunkt (inkl. Mittelpunkt). */
  maxM: number | null;
  minM: number | null;
  /** Anzahl gültiger Stützpunkte (1 = nur Mittelpunkt). */
  samples: number;
}

/** Stützpunkte: Mittelpunkt + je 8 Punkte auf dem Radius und dem halben Radius. */
export function terrainSamplePoints(
  lat: number,
  lon: number,
  radiusM: number,
): { lat: number; lon: number }[] {
  const pts = [{ lat, lon }];
  const r = Math.max(0, radiusM);
  if (!(r > 0)) return pts;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  for (const f of [1, 0.5]) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const dLat = ((r * f) / 111320) * Math.cos(a);
      const dLon = ((r * f) / (111320 * cosLat)) * Math.sin(a);
      pts.push({ lat: lat + dLat, lon: lon + dLon });
    }
  }
  return pts;
}

/** Schätzung aus Mittelpunkt + weiteren Stützpunkten (ungültige Werte ignoriert). */
export function terrainEstimateFromSamples(
  centerM: number | null | undefined,
  others: (number | null | undefined)[] = [],
): TerrainEstimate | null {
  const c = typeof centerM === "number" && Number.isFinite(centerM) ? centerM : null;
  const vals = [c, ...others].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return null;
  return { centerM: c, maxM: Math.max(...vals), minM: Math.min(...vals), samples: vals.length };
}

/** Konservatives Gelände-Maximum (für Untergrenzen) oder null. */
export function conservativeTerrainMaxM(t: TerrainEstimate | null | undefined): number | null {
  if (!t || t.maxM == null || !Number.isFinite(t.maxM)) return null;
  return t.samples > 1 ? t.maxM + TERRAIN_SAMPLED_MARGIN_M : t.maxM + TERRAIN_CENTER_ONLY_MARGIN_M;
}

export interface ZoneAltitudeInput {
  // Untergrenze der Zone in Metern (bereits in der Quelleinheit umgerechnet).
  // null/undefined oder <= 0 bedeutet "keine erkennbare Untergrenze" (GND/SFC/0).
  lowerMeters?: number | null;
  // Höhenbezug der Untergrenze (MSL/AGL/UNKNOWN bzw. roher Quellwert).
  lowerReference?: AltitudeReference | string | null;
  // Strukturierte Grenzen (shared/heights.ts). Haben Vorrang vor
  // lowerMeters/lowerReference.
  lower?: Height | null;
  upper?: Height | null;
}

export interface ReachabilityOptions {
  // Erreichbare bzw. geplante Flughöhe in Höhe über Grund (AGL), in Metern.
  reachableAltitudeM: number;
  // Geländeschätzung im Planungsradius (bevorzugt).
  terrain?: TerrainEstimate | null;
  // Altform: nur Geländehöhe am Mittelpunkt (MSL) -> Maximum ≈ Mitte + Marge.
  // null/undefined (und kein terrain) => MSL-Zonen bleiben sichtbar.
  terrainElevationM?: number | null;
}

function lowerOf(zone: ZoneAltitudeInput): Height {
  if (zone.lower) return zone.lower;
  return heightFromMeters(zone.lowerMeters, zone.lowerReference, "lower");
}

function datumMargin(h: Height): number {
  if (h.datum === "STD") return STD_DATUM_MARGIN_M;
  if (h.datum === "WGS84") return WGS84_DATUM_MARGIN_M;
  return 0;
}

function terrainOf(opts: ReachabilityOptions): TerrainEstimate | null {
  if (opts.terrain) return opts.terrain;
  return terrainEstimateFromSamples(opts.terrainElevationM);
}

// Entscheidet, ob eine Zone für die erreichbare Höhe relevant ist (= sichtbar).
// Konservativ: die Zone zählt, sobald irgendein Teil des Flugvolumens (Boden
// bis geplante Höhe AGL, überall im Radius) sie berühren KÖNNTE.
// true  = anzeigen; false = wegen Höhe ausblenden.
export function isZoneReachable(
  zone: ZoneAltitudeInput,
  opts: ReachabilityOptions,
): boolean {
  const lower = lowerOf(zone);
  // Untergrenze: GND/0/fehlend -> erreichbar; UNKNOWN -> nie ausblenden.
  if (lower.m != null && Number.isFinite(lower.m) && lower.m > 0 && lower.ref !== "UNKNOWN") {
    let lowerAgl = lower.m;
    if (lower.ref === "MSL") {
      const tMax = conservativeTerrainMaxM(terrainOf(opts));
      // Ohne Geländehöhe keine sichere MSL->AGL-Umrechnung -> anzeigen.
      if (tMax == null) return true;
      lowerAgl = lower.m - datumMargin(lower) - tMax;
    }
    // Bei Gleichstand (==) bleibt die Zone sichtbar; nur echt darüber ausblenden.
    if (lowerAgl > opts.reachableAltitudeM) return false;
  }
  // Obergrenze: nur MSL-Obergrenzen, die im GANZEN Radius sicher unter dem
  // Gelände liegen (mehrere Stützpunkte, Minimum minus Marge), blenden aus.
  // AGL-Obergrenzen nie (z. B. CZ „Höhengrenze 0 m“ = Flug nur mit Genehmigung).
  const upper = zone.upper;
  if (upper && upper.m != null && Number.isFinite(upper.m) && upper.ref === "MSL") {
    const t = terrainOf(opts);
    if (t && t.samples > 1 && t.minM != null) {
      const upperTrue = upper.m + datumMargin(upper);
      if (upperTrue < t.minM - TERRAIN_MIN_MARGIN_M) return false;
    }
  }
  return true;
}

// Entscheidet, ob eine Vektor-Geozone (ED-269: AT/BE/DK) abgelaufen ist und
// daher NICHT mehr auf der Karte gezeigt werden soll. Eine Zone gilt als
// abgelaufen, wenn ihr Gültigkeitsende (validEndTs, ms) in der Vergangenheit
// liegt. Dauerhafte Zonen (validEndTs == null/undefined) laufen nie ab und
// bleiben immer sichtbar. RN-frei, damit Mobile (client/), Web (web/) und
// Server (server/) dieselbe Logik teilen.
export function isGeozoneExpired(
  validEndTs: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (validEndTs == null || !Number.isFinite(validEndTs)) return false;
  return validEndTs < nowMs;
}

// ---------------------------------------------------------------------------
// Höhen-/Art-Klassifizierung einer Geozone (für die höhenbewusste Planung).
//
// Aus den vorhandenen Feldern (Name, Layer, Detailtext, Höhen-Label,
// Beschränkung) wird abgeleitet, ob eine Zone ein echtes Flugverbot ist, eine
// reine Höhen-Limit-Zone (mit Decke X m) oder unbekannt. Bewusst konservativ:
// Nur ein expliziter "Maximale Flughöhe X m"-Text (z. B. DGAC) gilt als
// Höhen-Limit. Vertikale Zonen-Obergrenzen (CTR/TMA-Decken, ED-269 upperMeters)
// sind KEINE Flughöhen-Limits und werden NICHT als solche gewertet — sie
// bleiben Konflikt (Fallback "unknown"). So wird nie eine genehmigungspflichtige
// Zone fälschlich als unkritisch markiert.
// RN-frei, damit Mobile/Web/tsx dieselbe Logik teilen.

export type GeozoneAltitudeKind = "noFly" | "altitudeLimit" | "unknown";

export interface ZoneAltitudeClassificationInput {
  name?: string | null;
  layerLabel?: string | null;
  details?: string | null;
  altitudeLabel?: string | null;
  restriction?: string | null;
  // Strukturierte Höhenfelder (CH/NL/LU/ED-269 liefern diese bereits in Metern).
  lowerMeters?: number | null;
  upperMeters?: number | null;
  lowerReference?: AltitudeReference | string | null;
  // Explizite max. Flughöhe AGL ohne Genehmigung (z. B. SE CTR 50 m). Einzige
  // strukturierte Quelle für eine Höhen-Freigabe (NICHT upperMeters).
  maxFlightHeightAglM?: number | null;
}

export interface GeozoneAltitudeClassification {
  kind: GeozoneAltitudeKind;
  // Decke in Metern (nur bei kind === "altitudeLimit"), sonst null.
  ceilingM: number | null;
  // Kurzes deutsches Label: "bis 100 m" / "Flugverbot" / null (unknown).
  label: string | null;
}

// Expliziter Max-Flughöhe-Satz mit Zahl, mehrsprachig:
//   DE  "Maximale Flughöhe 100 m" / "max. Höhe 50 m" / "Höhenbeschränkung 80 m"
//   FR  "hauteur maximale de vol de 50 m" / "altitude maximale 100 m"
//   EN  "maximum flight height 120 m" / "max altitude 60 m"
//   NL  "maximale (vlieg)hoogte 100 m"
const MAX_HEIGHT_TEXT_PATTERNS: RegExp[] = [
  /maximale?\s*flugh[öo]he\s*(?:von\s*)?(\d{1,3})\s*m/i,
  /h[öo]henbeschr[äa]nkung\s*(?:auf\s*|von\s*)?(\d{1,3})\s*m/i,
  /max\.?\s*(?:flug)?h[öo]he\s*(?:von\s*)?(\d{1,3})\s*m/i,
  /hauteur\s+maximale(?:\s+de\s+vol)?\s*(?:de\s*)?(\d{1,3})\s*m/i,
  /altitude\s+maximale\s*(?:de\s*)?(\d{1,3})\s*m/i,
  /maximum\s+(?:flight\s+)?(?:height|altitude)\s*(?:of\s*)?(\d{1,3})\s*m/i,
  /max\.?\s*(?:height|altitude)\s*(?:of\s*)?(\d{1,3})\s*m/i,
  /maximale?\s*(?:vlieg)?hoogte\s*(?:van\s*)?(\d{1,3})\s*m/i,
];

function parseMaxHeightFromText(text: string): number | null {
  for (const re of MAX_HEIGHT_TEXT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const ceil = parseInt(m[1], 10);
      if (Number.isFinite(ceil) && ceil > 0) return ceil;
    }
  }
  return null;
}

export function classifyGeozoneAltitude(
  zone: ZoneAltitudeClassificationInput,
): GeozoneAltitudeClassification {
  const text = [zone.name, zone.layerLabel, zone.details, zone.altitudeLabel]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
  // Strukturierte Einstufung (Policy-Union) hat Vorrang. Der Klartext-Rückfall
  // NO_FLY_TEXT_RE greift NUR für reine Textzonen ohne Einstufung (UNKNOWN,
  // z. B. WMS-GetFeatureInfo ohne strukturierte Felder).
  const structured = normalizeRestriction(zone.restriction);
  const restriction = structured !== "UNKNOWN" ? structured : restrictionFromText(text);

  // 1) Echtes Flugverbot -> immer Konflikt.
  if (restriction === "PROHIBITED") {
    return { kind: "noFly", ceilingM: null, label: "Flugverbot" };
  }

  // Strukturierte Freigabe-/Genehmigungspflicht (REQ_AUTHORISATION, RESTRICTED
  // = „Freigabe nötig“). Sie ist ein verlässliches Regulierungs-Signal und
  // sticht IMMER — auch einen genannten Max-Flughöhe-Wert. CONDITIONAL/NATURE
  // zählen NICHT als Genehmigungspflicht; sie werden aber ebenso wenig über
  // ihre Volumen-Obergrenze freigegeben (die Beschränkung gilt INNERHALB des
  // Volumens). NO_RESTRICTION-Zonen sind nur Info und werden von den
  // Aufrufern gar nicht als Konflikt geführt.
  const restrictionRequiresAuth =
    restriction === "REQ_AUTHORISATION" || restriction === "RESTRICTED";

  // 2b) Explizites strukturiertes Feld "max. Flughöhe AGL ohne Genehmigung"
  //     (maxFlightHeightAglM, z. B. SE CTR/TIZ/ATZ 50 m, aus den Normalisierern
  //     als openCategoryMaxAglMeters/maxFlightHeightAglM). Das ist eine echte
  //     Flughöhen-Erlaubnis, KEINE Volumen-Obergrenze. Strukturierte
  //     Genehmigungspflicht sticht weiterhin (z. B. HR CTR: auch < 50 m
  //     App-Freigabe nötig).
  const maxAgl = zone.maxFlightHeightAglM;
  if (
    !restrictionRequiresAuth &&
    typeof maxAgl === "number" &&
    Number.isFinite(maxAgl) &&
    maxAgl > 0
  ) {
    const ceil = Math.round(maxAgl);
    return { kind: "altitudeLimit", ceilingM: ceil, label: `bis ${ceil} m` };
  }

  // 2a) Expliziter Max-Flughöhe-Satz mit Zahl (z. B. DGAC "Maximale Flughöhe
  //     100 m"). Eine konkret genannte, offizielle Höchst-Flughöhe ist eine
  //     positive Höhen-Erlaubnis: unterhalb dieser Decke ist der Betrieb unter
  //     den genannten Bedingungen zulässig. Sie hat deshalb Vorrang vor
  //     generischen Genehmigungs-Schlagworten im FREItext — insbesondere vor dem
  //     DGAC-Kontakt-Baustein "Bei Genehmigungsbedarf … kontaktieren", der auf
  //     JEDER generischen FR-Zone steht und die Zone sonst fälschlich zum Dauer-
  //     Konflikt macht. NICHT jedoch Vorrang vor einer strukturierten
  //     Genehmigungspflicht (restrictionRequiresAuth) oder einem echten
  //     Flugverbot (Schritt 1) — beide bleiben Konflikt.
  if (!restrictionRequiresAuth) {
    const textCeil = parseMaxHeightFromText(text);
    if (textCeil != null) {
      return { kind: "altitudeLimit", ceilingM: textCeil, label: `bis ${textCeil} m` };
    }
  }

  // KEINE Freigabe über die Volumen-Obergrenze (upperMeters): Nach ED-269
  // beschreibt [lower, upper] das Volumen, IN dem die Beschränkung gilt. Eine
  // Zone GND–150 m (CONDITIONAL/RESTRICTED/NATURE/leer) betrifft also gerade den
  // Bereich unterhalb von 150 m — sie ist kein "Höhenlimit bis 150 m". Früher
  // gab es hier die Pfade 2b (Wortlaut ohne Zahl + upperMeters) und 2c (GND–X m
  // -> Decke X), die genau das invertierten und Zonen fälschlich als
  // unkritisch markierten. Freigabe nur noch über 2a (expliziter Text mit Zahl)
  // oder das strukturierte Feld maxFlightHeightAglM. Zonen, deren UNTERgrenze
  // über der geplanten Höhe liegt, behandelt isZoneReachable separat.

  // 3) Keine verwertbaren Höhen-/Beschränkungsdaten -> heutiges Verhalten.
  return { kind: "unknown", ceilingM: null, label: null };
}

export interface AltitudeConflictResult extends GeozoneAltitudeClassification {
  // true: Höhen-Limit liegt über/gleich der geplanten Höhe -> unkritisch.
  clearedByAltitude: boolean;
  // true: Höhen-Limit liegt unter der geplanten Höhe -> Pro-Zone-Frage
  // "Planst du, hier über X m zu steigen?".
  needsClimbQuestion: boolean;
}

// Bewertet eine Zone gegen die geplante Flughöhe (AGL). Reichweite (Unterkante)
// wird separat über isZoneReachable / partitionByReachability behandelt.
export function assessGeozoneAltitudeConflict(
  zone: ZoneAltitudeClassificationInput,
  plannedAltitudeM: number,
): AltitudeConflictResult {
  const c = classifyGeozoneAltitude(zone);
  if (c.kind === "altitudeLimit" && c.ceilingM != null) {
    if (c.ceilingM >= plannedAltitudeM) {
      return { ...c, clearedByAltitude: true, needsClimbQuestion: false };
    }
    return { ...c, clearedByAltitude: false, needsClimbQuestion: true };
  }
  // noFly + unknown -> Konflikt, keine Pro-Zone-Frage.
  return { ...c, clearedByAltitude: false, needsClimbQuestion: false };
}

// Partitioniert Zonen in sichtbare und (wegen Höhe) ausgeblendete.
export function partitionByReachability<T extends ZoneAltitudeInput>(
  zones: T[],
  opts: ReachabilityOptions,
): { visible: T[]; hiddenAbove: T[] } {
  const visible: T[] = [];
  const hiddenAbove: T[] = [];
  for (const z of zones || []) {
    if (isZoneReachable(z, opts)) visible.push(z);
    else hiddenAbove.push(z);
  }
  return { visible, hiddenAbove };
}
