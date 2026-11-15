// Slowakei (SK) – Normalisierung der Drohnen-Geozonen und der drohnenrelevanten
// Lufträume. Siehe docs/slovakia-lps-api-integration.md.
//
// Ausgabe: GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo in
// client/lib/ed269.ts liest (restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, extendedProperties.localizedMessages,
// applicability, infoUrl, notamsUrl …).
//
// ---------------------------------------------------------------------------
// Quellen (live geprüft 2026-11-15) – zwei öffentliche Quellen, kombiniert
// ---------------------------------------------------------------------------
// 1. DROHNENSPEZIFISCH (bevorzugt): Dopravný úrad (Verkehrsbehörde der SR),
//    Seite „Zemepisné oblasti UAS“
//    https://letectvo.nsat.sk/bezpilotne-letectvo/zemepisne-oblasti-uas/
//    verlinkt ein ZIP mit einer KML-Datei („KML – Aktuálne zemepisné oblasti“,
//    Dateiname wechselt mit dem Stand, z. B. „Aktuálne-30.10.2026.zip“ →
//    „Aktuálne - 30.10.2026.kml“). Die offiziellen UAS-Geozonen nach
//    Art. 15 DVO (EU) 2019/947, festgelegt per Entscheidung des DÚ bzw. des
//    Verkehrsministeriums (MD SR). Live 275 Placemarks:
//
//      | KML-Ordner                       | Anz. | Behördenkategorie            |
//      |----------------------------------|------|------------------------------|
//      | Stále/RUAS004M - RUAS008M        |    5 | podmienená (Schutzobjekte)   |
//      | Stále/MOSR/RUAS 100 - 268        |  169 | podmienená (krit. Infrastr.) |
//      | Stále/MOSR (RUAS013M–098M)       |   86 | podmienená (MO SR, ≤ 500 m)  |
//      | Stále/CTR (5 Flughafen + 5 CTR)  |   10 | podmienená (nur „speziell“)  |
//      | Stále/DÚ (R00001D Zoo Bojnice)   |    1 | podmienená                   |
//      | Stále/DÚ (PUAS001-D)             |    1 | zakázaná                     |
//      | Dočasné (PUAS0158M–0160M)        |    3 | zakázaná, befristet          |
//
//    Beschreibung je Zone als zweisprachige HTML-Tabelle (SK/EN):
//    Kopfzeile („PODMIENENÁ PREVÁDZKA UAS / CONDITIONAL UAS OPERATION“ bzw.
//    „ZAKÁZANÁ PREVÁDZKA UAS“), Označenie (Kennung), Obmedzenie (Beschränkung),
//    Doba platnosti (Gültigkeit) und Výška (Höhe, z. B. „GND - 120m AGL“,
//    „30 - 120m AGL“, „GND - 500m AGL“, „GND - 5000ft AMSL“).
//
// 2. ERGÄNZEND: LPS SR (Flugsicherung), VFR-Manual-Karte gis.lps.sk/vfrm –
//    öffentlicher ArcGIS-MapServer VFRM/VFRM_popup/MapServer/5 „Airspace“
//    (178 Lufträume, AIXM-Schema). Die drohnenspezifische KML enthält keine
//    P/R/D-Gebiete, TRA, ATZ, RMZ usw. – diese kommen von hier.
//
//    Weitere geprüfte Dienste (kein drohnenspezifischer Layer):
//      VFRM_popup/MapServer: 0 ADHP_SRSS, 1 ADHP, 2 Obstacle_Join_ENR, 3 Navaid
//        (Punkte), 4 Airspace_point (Beschriftungsflächen), 5 Airspace,
//        6 NONaixm_linie, 7 NONaixm_plochy (Flugplatzflächen), 8 Obstacles_ENR.
//      VFRM_popup_fis/MapServer/0 Airspace_sectors_FIS (FIS-Sektoren, keine
//        Beschränkung). Airspaces/MapServer/0 (Wurzelordner, 274 Lufträume inkl.
//        Paragliding-Gebiete „W“) – Obermenge für die bemannte Luftfahrt.
//      Hosted/Reservation_(Public)/FeatureServer/0 – Live-Reservierungen
//        (LARA/AMA: aktive R/TRA mit Start/Ende); hier noch nicht verwendet.
//      Ordner Utilities: Token erforderlich; inspire/*: INSPIRE-Verkehrsnetz.
//
// ---------------------------------------------------------------------------
// Beschränkung – DÚ-Geozonen
// ---------------------------------------------------------------------------
//   | Behördenangabe                                    | restriction       |
//   |---------------------------------------------------|-------------------|
//   | ZAKÁZANÁ PREVÁDZKA UAS / Text „zákaz/zakázaná“    | PROHIBITED        |
//   | PODMIENENÁ PREVÁDZKA UAS (Zustimmung/Genehmigung, | REQ_AUTHORISATION |
//   |   nur Kategorie „speziell“, Zoo Bojnice …)        |                   |
//   | unbekannte Kopfzeile                              | REQ_AUTHORISATION |
//   Höhen stehen in der Zone (z. B. CTR: 30–120 m AGL → unter 30 m ist der
//   Betrieb nach DÚ außerhalb 5 km vom Flughafen frei).
//   Gültigkeit: „stála/permanent“ → dauerhaft; Datumsbereich
//   „dd.mm.yyyy HH:MM GMT+1 – …“ → applicability (UTC); „während der
//   Betriebszeiten der TWR …“ → ohne Zeiten nicht maschinenlesbar, daher
//   vorsichtig dauerhaft aktiv + Hinweis.
//
// ---------------------------------------------------------------------------
// Beschränkung – LPS-Lufträume (TYPE_CODE / LOCALTYPE_TXT, alle Live-Werte)
// ---------------------------------------------------------------------------
//   | TYPE_CODE | LOCALTYPE | Anz. | Grenzen (live)          | Ergebnis                      |
//   |-----------|-----------|------|-------------------------|-------------------------------|
//   | P         |           |    3 | GND – 4000/5000 ft MSL  | PROHIBITED                    |
//   | PROTECT   |           |    9 | GND – 4445…9711 ft MSL  | REQ_AUTHORISATION (1)         |
//   | R         |           |   30 | GND/2000 ft MSL…        | RESTRICTED (2), Höhenfilter   |
//   | D, D-OTHER|           |  2+1 | GND – …                 | CONDITIONAL                   |
//   | TRA       |           |   17 | 4000 ft MSL – FL660     | RESTRICTED (2), Höhenfilter   |
//   | TSA       |           |    5 | FL125+                  | RESTRICTED, alle zu hoch      |
//   | CTR       |           |    6 | GND – 5000/8000 ft MSL  | 5 LZxx: durch DÚ-CTR-Geozonen |
//   |           |           |      |                         | ersetzt (3); UKLU: REQ_AUTH.  |
//   | TMA-P     |           |   20 | 1000 ft SFC / ≥1500 MSL | REQ_AUTHORISATION, Höhenfilter|
//   | A         |           |   12 | 2500…8000 ft MSL        | CONDITIONAL (Segelflug/Fallsch.)|
//   | RAS       | ATZ       |   23 | GND – 4000/8000 ft MSL  | REQ_AUTHORISATION             |
//   | RAS       | RMZ       |    5 | GND – …                 | CONDITIONAL (Funkpflicht)     |
//   | RAS       | (leer)    |    1 | GND – FL660 (Artillerie)| RESTRICTED                    |
//   | RAS       | MRVA      |   35 | 2000–11600 ft MSL       | AUSGESCHLOSSEN (4)            |
//   | RAS       | NPZ       |    4 | FL95 / FL245            | AUSGESCHLOSSEN (4)            |
//   | (leer)    | FBZ       |    4 | FL195+                  | AUSGESCHLOSSEN (4)            |
//   | FIR-P     |           |    1 | 9000 ft MSL – FL195     | AUSGESCHLOSSEN (4)            |
//   | unbekannt |           |      |                         | REQ_AUTHORISATION (vorsichtig)|
//
//   (1) Faunaschutz-Gebiete der Nationalparks (ACTIVITY FAUNA). Nach § 15
//       Abs. 2 lit. d Gesetz Nr. 543/2002 Z. z. (Natur- und Landschaftsschutz)
//       braucht ein Flug eines Luftfahrzeugs (UAS sind Luftfahrzeuge nach § 2
//       Gesetz 143/1998) unter 300 m über dem höchsten Hindernis im Umkreis von
//       600 m im Gebiet der 3. Schutzstufe die Zustimmung der Naturschutzbehörde
//       → Genehmigung, nicht pauschales Verbot.
//   (2) Militärisch, Aktivierung über AUP/UUP bzw. NOTAM. Die Aktivierungszeiten
//       sind im Layer nicht enthalten (WORKHR_CODE leer) → vorsichtig dauerhaft
//       aktiv, Hinweis auf Statusprüfung.
//   (3) Die DÚ-KML enthält für alle fünf slowakischen CTR eigene UAS-Geozonen
//       (Flughafenbereich GND–120 m, CTR 30–120 m AGL). Die LPS-CTR (GND – 5000
//       ft MSL) werden nur verwendet, wenn die DÚ-Daten nicht verfügbar sind.
//   (4) Keine Drohnenbeschränkung: MRVA = Radar-Mindestvektorhöhen (Lotsen-
//       konstrukt, KEIN Luftraum – ausdrücklich nach Typ ausgeschlossen, nicht
//       über die Höhe, da 2000 ft MSL in der Slowakei unter Gelände liegen kann),
//       NPZ = No-Planning-Zones der Streckenplanung, FBZ = Pufferzonen der TSA,
//       FIR-P = FIR-Teilgebiet.
//
// Höhenfilter (Untergrenze klar über Drohnenhöhe → Zone entfällt):
//   - Untergrenze über Grund (SFC/GND/HEI) > 500 ft (152,4 m) AGL
//     (live: R40 und KOŠICE TMA 2 mit 1000 ft SFC).
//   - Untergrenze MSL/ALT > 2800 m MSL: höchster Gipfel der Slowakei
//     (Gerlachovský štít 2655 m) + 120 m Open-Kategorie + Reserve.
//   - Untergrenze als Flugfläche: FL × 100 ft − 600 m Luftdruckreserve
//     > 2800 m (≙ ab etwa FL112).
//   Zonen mit niedrigerer MSL-Untergrenze bleiben mit lowerReference "MSL"
//   erhalten; der App-Höhenfilter (shared/geozoneAltitudeFilter.ts) rechnet
//   sie mit der Geländehöhe in AGL um.
//
// Umrechnung: 1 ft = 0,3048 m (ICAO Annex 5); FL n = n × 100 ft Druckhöhe
// (Standardatmosphäre, als MSL-Näherung).
//
// Drohnenregeln der Slowakei (Quellen):
//   - DVO (EU) 2019/947, Open-Kategorie max. 120 m über Grund.
//   - DÚ „Riadené okrsky CTR“: In den CTR Štefánik, Košice, Žilina, Piešťany,
//     Tatry ist der Flug ohne Genehmigung nur > 5 km vom Flughafen und bis 30 m
//     Höhe oder im atypischen Luftraum zulässig; sonst nur Kategorie
//     „speziell“ mit Betriebsgenehmigung (Koordination nach Beschluss SMK
//     U/2026/6). https://letectvo.nsat.sk/bezpilotne-letectvo/podmienky-vykonania-letu/riadene-okrsky-ctr/
//   - Gesetz 543/2002 Z. z. § 15 Abs. 2 lit. d (Nationalparks, s. o.).
//
// Texte: Alle live vorkommenden Behördenangaben (DÚ-Beschränkungen,
// Gültigkeiten, Höhen, Kopfzeilen; LPS-Typen, Aktivitäten, Zonennamen) werden
// über ein eingebautes Wörterbuch ins Deutsche übertragen; Unbekanntes wird
// nicht geraten („siehe Originaltext“). Die Behördenangaben stehen unverändert
// unter „Originaltext der Behörde:“; die deutsche Fassung steht in
// extendedProperties.localizedMessages als "de" an erster Stelle, damit
// client/lib/ed269.ts nicht erneut übersetzt.
//
// Geometrie: volle Präzision (Koordinaten unverändert; nur die Höhen-
// Ordinate z wird entfernt). Bewusst frei von React-Native-Importen (unter
// tsx/Node testbar); keine Lookbehinds, keine \p{…}-Klassen, kein normalize().

import { unzipSync, strFromU8 } from "fflate";
import { htmlToText, parseKmlPlacemarks, type KmlPlacemark } from "./geozoneKit/kml";
import { FT_M, parseHeight } from "./geozoneKit/heights";
import { arcgisPage, arcgisQueryUrl } from "./geozoneKit/arcgis";
import { collapseWhitespace as clean } from "./geozoneKit/text";
import {
  SEE_ORIGINAL_DE,
  appendOriginalText,
  localizedExtendedProperties,
  sourceLineDe,
} from "./geozoneKit/messages";

export const SK_GEOZONE_SOURCE_LABEL = "Dopravný úrad SR / LPS SR";
export const SK_GEOZONE_ATTRIBUTION = "© LPS SR";
/** Attribution der drohnenspezifischen Geozonen (Dopravný úrad). */
export const SK_DU_ATTRIBUTION = "© Dopravný úrad SR";

export const SK_LPS_AIRSPACE_LAYER_URL =
  "https://gis.lps.sk/server/rest/services/VFRM/VFRM_popup/MapServer/5";
export const SK_VFRM_MAP_URL = "https://gis.lps.sk/vfrm/";
export const SK_DU_UAS_ZONES_PAGE_URL = "https://letectvo.nsat.sk/bezpilotne-letectvo/zemepisne-oblasti-uas/";
export const SK_DU_CTR_RULES_URL =
  "https://letectvo.nsat.sk/bezpilotne-letectvo/podmienky-vykonania-letu/riadene-okrsky-ctr/";

/** Untergrenze über Grund, ab der eine Zone für Drohnen irrelevant ist (500 ft). */
export const SK_MAX_LOWER_AGL_M = 500 * FT_M;
/** Gerlachovský štít (2655 m) + 120 m + Reserve. */
export const SK_MAX_LOWER_MSL_M = 2800;
/** Reserve bei Flugflächen für tiefen Luftdruck (≈ 2000 ft). */
export const SK_FL_PRESSURE_MARGIN_M = 600;

export type SkRestriction = "PROHIBITED" | "RESTRICTED" | "REQ_AUTHORISATION" | "CONDITIONAL";

const RESTRICTION_DE: Record<SkRestriction, string> = {
  PROHIBITED: "UAS-Flüge verboten",
  RESTRICTED: "Flugbeschränkungsgebiet – bei Aktivierung keine UAS-Flüge ohne Freigabe",
  REQ_AUTHORISATION: "UAS-Flüge nur mit Genehmigung/Zustimmung",
  CONDITIONAL: "Zone mit Auflagen – besondere Vorsicht",
};

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const SK_FOLD: Record<string, string> = {
  á: "a", ä: "a", č: "c", ď: "d", é: "e", ě: "e", í: "i", ĺ: "l", ľ: "l", ň: "n", ó: "o", ô: "o",
  ŕ: "r", ř: "r", š: "s", ť: "t", ú: "u", ů: "u", ý: "y", ž: "z", ö: "o", ü: "u",
};

/** Kleinbuchstaben ohne Diakritika (Hermes-sicher, ohne normalize()). */
export function foldSk(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[áäčďéěíĺľňóôŕřšťúůýžöü]/g, (c) => SK_FOLD[c] ?? c);
}

/** Vergleichsschlüssel: gefaltet, Leerraum vereinheitlicht, Satzzeichen am Ende entfernt. */
export function skKey(s: string): string {
  return foldSk(s).replace(/\s+/g, " ").replace(/[\s.;:,!]+$/g, "").trim();
}

function fmtNum(n: number): string {
  return String(Math.round(n));
}

function fmtDec(n: number): string {
  return String(n).replace(".", ",");
}

const UPPER_RE = /[A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]/;
const LOWER_RE = /[a-záäčďéíĺľňóôŕšťúýž]/;

/** „NOVÉ ZÁMKY“ → „Nové Zámky“; gemischte Schreibweise bleibt unverändert. */
export function skTitleCase(s: string): string {
  const t = clean(s);
  if (!t || LOWER_RE.test(t) || !UPPER_RE.test(t)) return t;
  return t
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/-([a-záäčďéíĺľňóôŕšťúýž])/g, (_m, c: string) => `-${c.toUpperCase()}`);
}

export type SkFeature = { type: "Feature"; id?: string; geometry: any; properties: Record<string, any> };

function validCoords(c: unknown, depth: number): boolean {
  if (!Array.isArray(c)) return false;
  if (depth === 0) return c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
  return c.length > 0 && c.every((x) => validCoords(x, depth - 1));
}

const xy = (c: any[]): [number, number] => [Number(c[0]), Number(c[1])];

/** Nur Flächen; x/y unverändert (volle Präzision), z entfernt. */
export function skGeometry(geometry: any): { type: "Polygon" | "MultiPolygon"; coordinates: any } | null {
  if (!geometry || typeof geometry !== "object") return null;
  const ring = (r: any[]) => r.map(xy);
  if (geometry.type === "Polygon" && validCoords(geometry.coordinates, 2)) {
    const rings = (geometry.coordinates as any[][]).filter((r) => r.length >= 4).map(ring);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }
  if (geometry.type === "MultiPolygon" && validCoords(geometry.coordinates, 3)) {
    const polys = (geometry.coordinates as any[][][])
      .map((p) => p.filter((r) => r.length >= 4).map(ring))
      .filter((p) => p.length > 0);
    if (polys.length === 0) return null;
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Höhen (LPS, AIXM DISTVERT*)
// ---------------------------------------------------------------------------

export interface SkLimit {
  /** Meter (FT → ×0,3048; FL → ×100 ft); undefined = unbegrenzt/unbekannt. */
  meters?: number;
  /** Bezug: AGL (SFC/GND/HEI), MSL (MSL/ALT) oder STD (Flugfläche). */
  reference: "AGL" | "MSL" | "STD";
  /** Behördennahe Kurzform, z. B. „5000 ft MSL“, „FL 245“, „GND“. */
  label: string;
}

/** AIXM-Höhenangabe (VAL/UOM/CODE) in Meter samt Bezug. */
export function skLimit(val: unknown, uom: unknown, code: unknown): SkLimit | undefined {
  const c = clean(code).toUpperCase();
  const u = clean(uom).toUpperCase();
  const raw = clean(val).toUpperCase();
  if (!c && !u && !raw) return undefined;
  if (raw === "UNL" || raw === "UNLIMITED") return { reference: "MSL", label: "unbegrenzt" };
  const n = Number(String(val ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  if (c === "STD" || u === "FL") {
    return { meters: parseHeight(n, "FL")?.m ?? 0, reference: "STD", label: `FL ${fmtNum(n)}` };
  }
  // Umrechnung über den gemeinsamen Parser (AIXM: „M“, sonst Fuß).
  const meters = parseHeight(n, u === "M" ? "m" : "ft")?.m ?? n;
  const unit = u === "M" ? "m" : "ft";
  if (c === "SFC" || c === "GND" || c === "HEI" || c === "AGL") {
    if (n === 0) return { meters: 0, reference: "AGL", label: "GND" };
    return { meters, reference: "AGL", label: `${fmtNum(n)} ${unit} über Grund (AGL)` };
  }
  return { meters, reference: "MSL", label: `${fmtNum(n)} ${unit} MSL` };
}

/** Untergrenze in Meter, mit Luftdruckreserve bei Flugflächen (nur für den Höhenfilter). */
function lowerForFilter(l: SkLimit): number {
  const m = l.meters ?? 0;
  return l.reference === "STD" ? m - SK_FL_PRESSURE_MARGIN_M : m;
}

/** Liegt die Untergrenze klar über jeder erreichbaren Drohnenhöhe? */
export function skLowerAboveDroneHeight(l: SkLimit | undefined): boolean {
  if (!l || l.meters == null) return false;
  if (l.reference === "AGL") return l.meters > SK_MAX_LOWER_AGL_M;
  return lowerForFilter(l) > SK_MAX_LOWER_MSL_M;
}

function limitDe(l: SkLimit | undefined, isUpper: boolean): string {
  if (!l) return isUpper ? "unbegrenzt" : "GND (Boden)";
  if (l.meters == null) return l.label;
  if (l.reference === "AGL" && l.meters === 0) return "GND (Boden)";
  const m = fmtNum(l.meters);
  if (l.reference === "STD") return `${l.label} (≈ ${m} m Druckhöhe)`;
  if (l.reference === "AGL") return `${l.label} = ${m} m AGL`;
  return `${l.label} (${m} m MSL)`;
}

// ---------------------------------------------------------------------------
// LPS: Klassifizierung
// ---------------------------------------------------------------------------

export type SkLpsKind =
  | "prohibited"
  | "fauna"
  | "restricted"
  | "danger"
  | "tra"
  | "tsa"
  | "ctr"
  | "tma"
  | "glider"
  | "parachute"
  | "activity"
  | "atz"
  | "rmz"
  | "artillery"
  | "unknown";

export type SkExclusionReason = "mrva" | "npz" | "fbz" | "fir_part" | "above_drone_height" | "covered_by_du";

export interface SkLpsDecision {
  kind: SkLpsKind;
  restriction: SkRestriction;
  /** Gesetzt, wenn die Zone nicht übernommen wird. */
  excluded?: SkExclusionReason;
}

const LPS_KIND_DE: Record<SkLpsKind, string> = {
  prohibited: "Luftsperrgebiet (P)",
  fauna: "Schutzgebiet für empfindliche Fauna (Nationalpark)",
  restricted: "Flugbeschränkungsgebiet (R)",
  danger: "Gefahrengebiet (D)",
  tra: "Temporär reserviertes Gebiet (TRA)",
  tsa: "Temporär abgetrenntes Gebiet (TSA)",
  ctr: "Kontrollzone (CTR)",
  tma: "Nahkontrollbereich (TMA)",
  glider: "Segelfluggebiet",
  parachute: "Fallschirmsprunggebiet",
  activity: "Luftsportgebiet",
  atz: "Flugplatzverkehrszone (ATZ)",
  rmz: "Funkpflichtzone (RMZ)",
  artillery: "Artillerie-Schießgebiet",
  unknown: "Luftraum (unbekannter Typ)",
};

export const SK_EXCLUSION_DE: Record<SkExclusionReason, string> = {
  mrva: "MRVA – Radar-Mindestvektorhöhe (kein Luftraum, keine Drohnenbeschränkung)",
  npz: "NPZ – No-Planning-Zone der Streckenplanung (FL95+)",
  fbz: "FBZ – Pufferzone einer TSA (FL195+)",
  fir_part: "FIR-P – FIR-Teilgebiet (keine Drohnenbeschränkung)",
  above_drone_height: "Untergrenze klar über Drohnenhöhe",
  covered_by_du: "durch drohnenspezifische DÚ-Geozone ersetzt",
};

/** TYPE_CODE/LOCALTYPE_TXT → Art + Beschränkung (ohne Höhenfilter). */
export function classifySkLps(props: Record<string, any>): SkLpsDecision {
  const type = clean(props.TYPE_CODE).toUpperCase();
  const local = clean(props.LOCALTYPE_TXT).toUpperCase();
  const act = clean(props.ACTIVITY_CODE).toUpperCase();
  // RAS ist gemischt – nach LOCALTYPE_TXT trennen.
  if (local === "MRVA") return { kind: "unknown", restriction: "REQ_AUTHORISATION", excluded: "mrva" };
  if (local === "NPZ") return { kind: "unknown", restriction: "REQ_AUTHORISATION", excluded: "npz" };
  if (local === "FBZ" || act === "OTHER:FBZ") return { kind: "unknown", restriction: "REQ_AUTHORISATION", excluded: "fbz" };
  if (type === "FIR-P" || type === "FIR") return { kind: "unknown", restriction: "REQ_AUTHORISATION", excluded: "fir_part" };
  if (local === "ATZ") return { kind: "atz", restriction: "REQ_AUTHORISATION" };
  if (local === "RMZ") return { kind: "rmz", restriction: "CONDITIONAL" };
  switch (type) {
    case "P":
      return { kind: "prohibited", restriction: "PROHIBITED" };
    case "PROTECT":
      return { kind: "fauna", restriction: "REQ_AUTHORISATION" };
    case "R":
      return { kind: "restricted", restriction: "RESTRICTED" };
    case "D":
    case "D-OTHER":
      return { kind: "danger", restriction: "CONDITIONAL" };
    case "TRA":
      return { kind: "tra", restriction: "RESTRICTED" };
    case "TSA":
      return { kind: "tsa", restriction: "RESTRICTED" };
    case "CTR":
      return { kind: "ctr", restriction: "REQ_AUTHORISATION" };
    case "TMA":
    case "TMA-P":
      return { kind: "tma", restriction: "REQ_AUTHORISATION" };
    case "A":
      if (act === "GLIDER") return { kind: "glider", restriction: "CONDITIONAL" };
      if (act === "PARACHUTE") return { kind: "parachute", restriction: "CONDITIONAL" };
      return { kind: "activity", restriction: "CONDITIONAL" };
    case "RAS":
      if (act === "ARTILLERY" || act === "SHOOT") return { kind: "artillery", restriction: "RESTRICTED" };
      return { kind: "unknown", restriction: "REQ_AUTHORISATION" };
    default:
      return { kind: "unknown", restriction: "REQ_AUTHORISATION" };
  }
}

const ACTIVITY_DE: Record<string, string> = {
  EXERCISE: "Militärübungen",
  ATS: "Flugverkehrsdienste",
  "TFC-AD": "Flugplatzverkehr",
  GLIDER: "Segelflug",
  SHOOT: "Schießübungen",
  FAUNA: "Schutz empfindlicher Fauna",
  "OTHER:FBZ": "Pufferzone (FBZ)",
  PARACHUTE: "Fallschirmspringen",
  "IND-NUCLEAR": "Kernkraftanlage",
  "IND-CHEM": "Chemieanlage",
  BLAST: "Sprengungen",
  OTHER: "Sonstige Aktivität",
  MILOPS: "Militärische Flugoperationen",
  ARTILLERY: "Artilleriefeuer",
  TRG: "Ausbildungsflüge",
};

const MIL_DE: Record<string, string> = { MIL: "militärisch", CIVIL: "zivil" };

const WORKHR_DE: Record<string, string> = {
  H24: "durchgehend (H24)",
  HJ: "von Sonnenaufgang bis Sonnenuntergang (HJ)",
  HN: "von Sonnenuntergang bis Sonnenaufgang (HN)",
  HX: "ohne feste Betriebszeiten (HX)",
  HO: "nach Verkehrsbedarf (HO)",
  NOTAM: "Aktivierung per NOTAM",
  TIMSH: "nach festgelegtem Zeitplan",
};

// Freitext-Phrasen (WORKHRRMK_TXT/REMARKS_TXT; live leer) – nur sichere Muster.
const REMARK_RULES: [RegExp, string][] = [
  [/^(?:activ(?:ated|ity)|active)\s+(?:by|notified by|as notified by|by)\s+notam$/i, "Aktivierung per NOTAM"],
  [/^(?:aup|aup\/uup|uup)$/i, "Aktivierung gemäß AUP/UUP"],
  [/^(?:activated|active)\s+(?:by|via|according to)\s+aup(?:\/uup)?$/i, "Aktivierung gemäß AUP/UUP"],
  [/^h24$/i, "durchgehend (H24)"],
];

/** Freitext ins Deutsche, sonst null (nicht raten). */
export function translateSkRemark(text: string): string | null {
  const t = clean(text).replace(/[.;]+$/, "");
  if (!t) return null;
  for (const [re, de] of REMARK_RULES) if (re.test(t)) return de;
  return null;
}

const FAUNA_NAMES: Record<string, string> = {
  tanap: "Tatra-Nationalpark (TANAP)",
  "napant zapad": "Nationalpark Niedere Tatra (NAPANT) – West",
  "napant vychod a slovensky raj": "Nationalpark Niedere Tatra (NAPANT) – Ost und Nationalpark Slowakisches Paradies",
  "velka fatra": "Nationalpark Große Fatra (Veľká Fatra)",
  "mala fatra": "Nationalpark Kleine Fatra (Malá Fatra)",
  "muranska planina": "Nationalpark Muránska planina",
  "slovensky kras": "Nationalpark Slowakischer Karst (Slovenský kras)",
  poloniny: "Nationalpark Poloniny",
  pienap: "Pieninen-Nationalpark (PIENAP)",
};

const SPECIAL_NAMES: Record<string, string> = {
  "ejection area": "Schleudersitz-Erprobungsgebiet",
};

/** Deutscher Zonenname aus NAME_TXT/IDENT_TXT. */
export function translateSkLpsName(props: Record<string, any>, kind: SkLpsKind): string {
  const ident = clean(props.IDENT_TXT);
  const rawName = clean(props.NAME_TXT);
  const k = skKey(rawName);
  const withIdent = (base: string) => (ident && !base.includes(ident) ? `${base} (${ident})` : base);
  const label = (p: string, n: string) => tidyName(n ? `${p} ${ident} ${n}` : `${p} ${ident}`);
  switch (kind) {
    case "fauna":
      return withIdent(`Faunaschutz: ${FAUNA_NAMES[k] ?? skTitleCase(rawName)}`);
    case "prohibited":
      return label("Luftsperrgebiet", skTitleCase(rawName));
    case "restricted":
      return label("Flugbeschränkungsgebiet", skTitleCase(rawName));
    case "danger":
      return label("Gefahrengebiet", SPECIAL_NAMES[k] ?? skTitleCase(rawName));
    case "tra":
      return label("TRA", skTitleCase(rawName));
    case "tsa":
      return label("TSA", skTitleCase(rawName));
    case "ctr":
      return withIdent(`Kontrollzone ${skTitleCase(rawName.replace(/\bCTR\b/gi, " ").trim())}`.trim());
    case "tma":
      return withIdent(`Nahkontrollbereich (TMA) ${skTitleCase(rawName.replace(/\bTMA\b/gi, " ").replace(/\s+/g, " ").trim())}`);
    case "atz":
      return withIdent(`Flugplatzverkehrszone (ATZ) ${skTitleCase(rawName.replace(/\bATZ\b/gi, " ").trim())}`);
    case "rmz":
      return withIdent(`Funkpflichtzone (RMZ) ${skTitleCase(rawName.replace(/\bRMZ\b/gi, " ").trim())}`);
    case "glider":
      return withIdent(`Segelfluggebiet ${skTitleCase(rawName)}`);
    case "parachute":
      return withIdent(`Fallschirmsprunggebiet ${skTitleCase(rawName)}`);
    case "artillery":
      return withIdent(`Artillerie-Schießgebiet ${skTitleCase(rawName)}`);
    default:
      return withIdent(`${LPS_KIND_DE[kind]} ${skTitleCase(rawName)}`.trim());
  }
}

function tidyName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const LPS_NOTE: Partial<Record<SkLpsKind, string>> = {
  prohibited: "Luftsperrgebiet: Flüge aller Luftfahrzeuge – auch UAS – sind verboten.",
  fauna:
    "Nationalpark mit empfindlicher Fauna: Nach § 15 Abs. 2 lit. d Gesetz Nr. 543/2002 Z. z. ist für Flüge von Luftfahrzeugen (auch UAS) unter 300 m über dem höchsten Hindernis im Umkreis von 600 m die Zustimmung der Naturschutzbehörde erforderlich; in Gebieten der 4./5. Schutzstufe gelten strengere Regeln.",
  restricted:
    "Militärisches/behördliches Flugbeschränkungsgebiet; Aktivierung über AUP/UUP bzw. NOTAM. Aktivierungszeiten liegen hier nicht vor – die Zone wird vorsichtshalber als dauerhaft aktiv behandelt. Vor dem Flug den Status prüfen.",
  tra: "Temporär reserviertes Gebiet (militärisch); Aktivierung über AUP/UUP bzw. NOTAM. Aktivierungszeiten liegen hier nicht vor – die Zone wird vorsichtshalber als dauerhaft aktiv behandelt.",
  tsa: "Temporär abgetrenntes Gebiet; Aktivierung über AUP/UUP bzw. NOTAM. Aktivierungszeiten liegen hier nicht vor – die Zone wird vorsichtshalber als dauerhaft aktiv behandelt.",
  danger: "Gefahrengebiet: gefährliche Aktivitäten möglich; nur mit besonderer Vorsicht fliegen und den Status per NOTAM prüfen.",
  ctr: "Kontrollzone: UAS-Betrieb nur mit Genehmigung bzw. nach Koordination mit der zuständigen Flugverkehrskontrolle.",
  tma: "Kontrollierter Luftraum mit Untergrenze über dem Meeresspiegel – relevant nur, wo das Gelände nahe an die Untergrenze reicht. UAS-Flüge im kontrollierten Luftraum nur mit Genehmigung/Koordination der Flugverkehrskontrolle.",
  glider: "Segelfluggebiet: erhöhter Segelflugverkehr; Untergrenze über dem Meeresspiegel – relevant nur in hohem Gelände.",
  parachute: "Fallschirmsprunggebiet: Fallschirmspringer möglich; Untergrenze über dem Meeresspiegel – relevant nur in hohem Gelände.",
  activity: "Luftsportgebiet: erhöhter Luftsportverkehr.",
  atz: "Flugplatzverkehrszone eines Flugplatzes: UAS-Flüge nur nach vorheriger Absprache mit dem Flugplatzbetreiber bzw. der Flugplatz-Funkstelle.",
  rmz: "Funkpflichtzone: Zweiwege-Funkverbindung bzw. Kontakt mit der zuständigen Flugverkehrsdienststelle erforderlich (SERA.6005) – vor dem Flug Kontakt mit der Flugplatz-/Flugverkehrsdienststelle aufnehmen.",
  artillery: "Militärisches Artillerie-Schießgebiet: bei Schießbetrieb Lebensgefahr; Status vor dem Flug prüfen.",
  unknown: "Unbekannter Luftraumtyp – vorsichtige Einstufung als genehmigungspflichtig.",
};

const LPS_ORIGINAL_FIELDS = [
  "IDENT_TXT",
  "NAME_TXT",
  "TYPE_CODE",
  "LOCALTYPE_TXT",
  "CLASS_CODE",
  "ACTIVITY_CODE",
  "MIL_CODE",
  "DISTVERTLOWER_VAL",
  "DISTVERTLOWER_UOM",
  "DISTVERTLOWER_CODE",
  "DISTVERTUPPER_VAL",
  "DISTVERTUPPER_UOM",
  "DISTVERTUPPER_CODE",
  "WORKHR_CODE",
  "WORKHRRMK_TXT",
  "REMARKS_TXT",
  "COMNAME_TXT",
  "TYPE_CODE_1",
  "FREQTRANS_VAL1",
  "CTAF_FREQ",
  "activity",
  "lower",
  "upper",
];

function lpsOriginalText(p: Record<string, any>): string {
  const lines = ["Ebene: VFRM_popup/MapServer/5 „Airspace“ (LPS SR)"];
  for (const k of LPS_ORIGINAL_FIELDS) {
    const v = clean(p[k]);
    if (v) lines.push(`${k}: ${v}`);
  }
  return lines.join("\n");
}

/** Deutsche Meldung + Originaltext für einen LPS-Luftraum. */
export function buildSkLpsMessageDe(
  p: Record<string, any>,
  d: SkLpsDecision,
  lower: SkLimit | undefined,
  upper: SkLimit | undefined,
): string {
  const lines: string[] = [];
  lines.push(`Typ: ${LPS_KIND_DE[d.kind]} – ${RESTRICTION_DE[d.restriction]}`);
  const note = LPS_NOTE[d.kind];
  if (note) lines.push(note);
  if (d.kind === "ctr" && /^UK/.test(clean(p.IDENT_TXT))) {
    lines.push("Ukrainische Kontrollzone (Uschhorod), die in slowakisches Gebiet hineinreicht; nicht in den slowakischen UAS-Geozonen enthalten.");
  }
  lines.push(`Vertikale Grenzen laut Behörde: ${limitDe(lower, false)} – ${limitDe(upper, true)}`);
  const act = clean(p.ACTIVITY_CODE).toUpperCase();
  if (act) lines.push(`Aktivität: ${ACTIVITY_DE[act] ?? SEE_ORIGINAL_DE}`);
  const mil = clean(p.MIL_CODE).toUpperCase();
  if (mil) lines.push(`Nutzung: ${MIL_DE[mil] ?? SEE_ORIGINAL_DE}`);
  const cls = clean(p.CLASS_CODE).toUpperCase();
  if (cls) lines.push(`Luftraumklasse: ${cls}`);
  const wh = clean(p.WORKHR_CODE).toUpperCase();
  if (wh) lines.push(`Betriebszeiten: ${WORKHR_DE[wh] ?? SEE_ORIGINAL_DE}`);
  for (const [key, label] of [
    ["WORKHRRMK_TXT", "Hinweis zu Betriebszeiten"],
    ["REMARKS_TXT", "Bemerkung"],
  ] as const) {
    const v = clean(p[key]);
    if (v) lines.push(`${label}: ${translateSkRemark(v) ?? SEE_ORIGINAL_DE}`);
  }
  const freq = clean(p.FREQTRANS_VAL1) || clean(p.CTAF_FREQ);
  if (freq) {
    const svc = clean(p.TYPE_CODE_1);
    lines.push(`Funkfrequenz: ${freq} MHz${svc ? ` (${svc})` : ""}`);
  }
  lines.push(
    sourceLineDe(
      `${SK_GEOZONE_SOURCE_LABEL} – VFR-Manual (gis.lps.sk/vfrm), Luftraum ${clean(p.IDENT_TXT) || "?"}`,
      SK_GEOZONE_ATTRIBUTION,
      "AUP/NOTAM",
    ),
  );
  return appendOriginalText(lines, lpsOriginalText(p), { always: true }).join("\n");
}

/** Einzelnes LPS-Feature normalisieren; null ohne Fläche. Ausschlüsse prüft der Aufrufer. */
export function normalizeSkLpsFeature(raw: any, decision?: SkLpsDecision): SkFeature | null {
  const geometry = skGeometry(raw?.geometry);
  if (!geometry) return null;
  const p: Record<string, any> = raw?.properties ?? {};
  const d = decision ?? classifySkLps(p);
  const lower = skLimit(p.DISTVERTLOWER_VAL, p.DISTVERTLOWER_UOM, p.DISTVERTLOWER_CODE);
  const upper = skLimit(p.DISTVERTUPPER_VAL, p.DISTVERTUPPER_UOM, p.DISTVERTUPPER_CODE);
  const type = clean(p.TYPE_CODE) || clean(p.LOCALTYPE_TXT) || "X";
  const ident = clean(p.IDENT_TXT) || String(p.OBJECTID ?? "?");
  const identifier = `SK-LPS-${type}${clean(p.LOCALTYPE_TXT) ? `-${clean(p.LOCALTYPE_TXT)}` : ""}-${ident}`;
  const message = buildSkLpsMessageDe(p, d, lower, upper);
  const props: Record<string, any> = {
    identifier,
    name: translateSkLpsName(p, d.kind),
    restriction: d.restriction,
    lowerMeters: lower?.meters ?? 0,
    lowerReference: lower?.meters ? lower.reference : "AGL",
    upperMeters: upper?.meters,
    upperReference: upper?.reference,
    message,
    extendedProperties: localizedExtendedProperties(message, lpsOriginalText(p), "sk", { always: true }),
    country: "SVK",
    source: SK_GEOZONE_SOURCE_LABEL,
    attribution: SK_GEOZONE_ATTRIBUTION,
    nameOriginal: clean(p.NAME_TXT) || undefined,
    skSource: "lps",
    skKind: d.kind,
    skTypeCode: clean(p.TYPE_CODE) || undefined,
    skLocalType: clean(p.LOCALTYPE_TXT) || undefined,
    skIdent: clean(p.IDENT_TXT) || undefined,
    infoUrl: SK_VFRM_MAP_URL,
    infoUrlLabel: "VFR-Manual-Karte (LPS SR)",
  };
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: identifier, geometry, properties: props };
}

// ---------------------------------------------------------------------------
// DÚ: KML-Geozonen
// ---------------------------------------------------------------------------

export interface SkDuZone {
  ident: string;
  headerSk: string;
  headerEn: string;
  restrictionSk: string;
  restrictionEn: string;
  validity: string;
  height: string;
  folders: string[];
  name: string;
  /** Tabellenzeilen „Etikett: Wert“ in Behördenfassung. */
  originalLines: string[];
}

function cellTexts(rowHtml: string): string[] {
  return (rowHtml.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? []).map((c) => htmlToText(c));
}

/** Zweisprachige Beschreibungstabelle eines DÚ-Placemarks lesen. */
export function parseSkDuDescription(pm: KmlPlacemark): SkDuZone {
  const rows = (pm.description ?? "").match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  let headerSk = "";
  let headerEn = "";
  const z: SkDuZone = {
    ident: "",
    headerSk: "",
    headerEn: "",
    restrictionSk: "",
    restrictionEn: "",
    validity: "",
    height: "",
    // Dokumentname der KML („Aktuálne - 30.10.2026.kml“) ist kein Ordner.
    folders: pm.folders.filter((f) => !/\.kml$/i.test(f)),
    name: clean(pm.name),
    originalLines: [],
  };
  for (const row of rows) {
    const cells = cellTexts(row);
    if (cells.length === 1) {
      const parts = cells[0].split("\n").map(clean).filter(Boolean);
      headerSk = parts[0] ?? "";
      headerEn = parts.slice(1).join(" ");
      z.originalLines.push(clean(cells[0].replace(/\n/g, " / ")));
      continue;
    }
    if (cells.length !== 2) continue;
    const label = skKey(cells[0].split("\n")[0]);
    const value = clean(cells[1]);
    z.originalLines.push(`${clean(cells[0].replace(/\n/g, " / "))}: ${value}`);
    if (label.startsWith("oznacenie")) z.ident = value;
    else if (label.startsWith("obmedzenie")) {
      const i = value.indexOf(" / ");
      z.restrictionSk = clean(i >= 0 ? value.slice(0, i) : value);
      z.restrictionEn = clean(i >= 0 ? value.slice(i + 3) : "");
    } else if (label.startsWith("doba platnosti")) z.validity = value;
    else if (label.startsWith("vyska")) z.height = value;
  }
  z.headerSk = headerSk;
  z.headerEn = headerEn;
  if (!z.ident) z.ident = z.name.replace(/^UAS\s+/i, "");
  return z;
}

// Alle live vorkommenden Beschränkungstexte (Schlüssel: gefalteter SK-Text).
const DU_RESTRICTION_DE: [string[], string][] = [
  [
    ["let povoleny iba s predhadzujucim povolenim kritickeho subjektu", "let povoleny iba s predchadzajucim povolenim kritickeho subjektu"],
    "Flug nur mit vorheriger Genehmigung des Betreibers der kritischen Infrastruktur erlaubt.",
  ],
  [
    [
      "let uas je povoleny iba na zaklade predchadzajuceho suhlasu ministerstva obrany slovenskej republiky, ktore su vybavene systemom dialkovej identifikacie",
    ],
    "UAS-Flüge nur mit vorheriger Zustimmung des Verteidigungsministeriums der Slowakischen Republik erlaubt, und nur mit UAS, die über ein System zur Fernidentifizierung (Remote ID) verfügen.",
  ],
  [
    ["let uas povoleny na zaklade predchadzajuceho suhlasu spravcu prislusneho chraneneho objektu"],
    "UAS-Flug nur mit vorheriger Zustimmung des Verwalters des betreffenden Schutzobjekts erlaubt.",
  ],
  [
    ["civilna prevadzka uas je povolena len v osobitnej kategorii uas s vynimkou atypickeho vzdusneho priestoru"],
    "Ziviler UAS-Betrieb nur in der Kategorie „speziell“ (mit Betriebsgenehmigung) erlaubt – ausgenommen im atypischen Luftraum.",
  ],
  [
    ["civilna prevadzka uas je povolena len v osobitnej kategorii uas"],
    "Ziviler UAS-Betrieb nur in der Kategorie „speziell“ (mit Betriebsgenehmigung) erlaubt.",
  ],
  [["zakaz vykonavania civilnych letov uas"], "Zivile UAS-Flüge sind verboten."],
  [["prevadzka civilnych letov uas je zakazana"], "Der Betrieb ziviler UAS-Flüge ist verboten."],
  [
    [
      "civilna prevadzka uas v zemepisnej oblasti je povolena len pre lety uas vykonavanych na ucely plnenia pracovnych uloh narodnej zoologickej zahrady bojnice a po jej predchadzajucom suhlase, a to bez ohladu na to, kto je prevadzkovatelom uas",
    ],
    "Ziviler UAS-Betrieb in dieser Zone nur für Flüge zur Erfüllung von Arbeitsaufgaben des Nationalen Zoologischen Gartens Bojnice und mit dessen vorheriger Zustimmung erlaubt – unabhängig davon, wer das UAS betreibt.",
  ],
];

const DU_RESTRICTION_MAP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [keys, de] of DU_RESTRICTION_DE) for (const k of keys) m.set(k, de);
  return m;
})();

/** DÚ-Beschränkungstext (SK, sonst EN) ins Deutsche; null = unbekannt. */
export function translateSkDuRestriction(sk: string, en = ""): string | null {
  const k = skKey(sk);
  if (k && DU_RESTRICTION_MAP.has(k)) return DU_RESTRICTION_MAP.get(k)!;
  const e = skKey(en);
  if (/^civil uas (?:flights|operations?) (?:are|is) prohibit+ed$|^operations of civil uas are prohibit+ed$/.test(e)) {
    return "Zivile UAS-Flüge sind verboten.";
  }
  if (/^civil uas operations are permitted only in the specific category of uas$/.test(e)) {
    return "Ziviler UAS-Betrieb nur in der Kategorie „speziell“ (mit Betriebsgenehmigung) erlaubt.";
  }
  return null;
}

/** Kategorie der Kopfzeile ins Deutsche. */
export function translateSkDuHeader(sk: string, en = ""): string | null {
  const k = skKey(`${sk} ${en}`);
  if (/zakazana prevadzka|prohibited/.test(k)) return "Verbotener UAS-Betrieb";
  if (/podmienena prevadzka|conditional/.test(k)) return "Bedingter UAS-Betrieb (nur unter den genannten Voraussetzungen)";
  return null;
}

export interface SkDuDecision {
  restriction: SkRestriction;
  fromDefault: boolean;
}

export function decideSkDuRestriction(z: Pick<SkDuZone, "headerSk" | "headerEn" | "restrictionSk" | "restrictionEn">): SkDuDecision {
  const head = skKey(`${z.headerSk} ${z.headerEn}`);
  const text = skKey(`${z.restrictionSk} ${z.restrictionEn}`);
  if (/zakazana prevadzka|operation prohibited|prohibited uas operation/.test(head)) {
    return { restriction: "PROHIBITED", fromDefault: false };
  }
  if (/\bzakaz\b|zakazana|prohibit/.test(text) && !/povolen|permitted/.test(text)) {
    return { restriction: "PROHIBITED", fromDefault: false };
  }
  if (/podmienena prevadzka|conditional/.test(head)) return { restriction: "REQ_AUTHORISATION", fromDefault: false };
  return { restriction: "REQ_AUTHORISATION", fromDefault: true };
}

export interface SkDuHeight {
  lowerMeters: number;
  /** UNKNOWN: Text nennt keinen Bezug (nie still AGL, Product Owner) */
  lowerReference: "AGL" | "MSL" | "UNKNOWN";
  upperMeters?: number;
  upperReference?: "AGL" | "MSL" | "UNKNOWN";
  label: string;
}

const HEIGHT_RE =
  /^(GND|SFC|\d+(?:[.,]\d+)?)\s*(m|ft)?\s*(AGL|AMSL|MSL)?\s*[-–]\s*(\d+(?:[.,]\d+)?)\s*(m|ft)\s*(AGL|AMSL|MSL)?$/i;

/** „GND - 120m AGL“, „30 - 120m AGL“, „GND - 5000ft AMSL“ → Meter. */
export function parseSkDuHeight(text: string): SkDuHeight | null {
  const m = clean(text).match(HEIGHT_RE);
  if (!m) return null;
  const toM = (v: string, unit: string) => {
    const n = Number(v.replace(",", "."));
    return parseHeight(n, unit.toLowerCase() === "ft" ? "ft" : "m")?.m ?? n;
  };
  const ref = (r: string | undefined): "AGL" | "MSL" | undefined =>
    !r ? undefined : r.toUpperCase() === "AGL" ? "AGL" : "MSL";
  const upperUnit = m[5];
  // Obergrenze ohne Bezug → UNKNOWN (nie still AGL); die Untergrenze erbt ihn
  const upperRef: "AGL" | "MSL" | "UNKNOWN" = ref(m[6]) ?? "UNKNOWN";
  const upperMeters = toM(m[4], upperUnit);
  const isGround = /^(GND|SFC)$/i.test(m[1]);
  const lowerMeters = isGround ? 0 : toM(m[1], m[2] ?? upperUnit);
  const lowerReference: "AGL" | "MSL" | "UNKNOWN" = isGround ? "AGL" : (ref(m[3]) ?? upperRef);
  const unitDe = (u: string) => (u.toLowerCase() === "ft" ? "ft" : "m");
  const refDe = (r: "AGL" | "MSL" | "UNKNOWN") =>
    r === "AGL" ? "über Grund (AGL)" : r === "MSL" ? "über dem Meeresspiegel (MSL)" : "(Bezug unbekannt)";
  const lowerLabel = isGround
    ? "Boden (GND)"
    : `${fmtDec(Number(m[1].replace(",", ".")))} ${unitDe(m[2] ?? upperUnit)} ${refDe(lowerReference)}`;
  const upperNum = Number(m[4].replace(",", "."));
  let upperLabel = `${fmtDec(upperNum)} ${unitDe(upperUnit)} ${refDe(upperRef)}`;
  if (unitDe(upperUnit) === "ft") upperLabel += ` = ${fmtNum(upperMeters)} m`;
  return {
    lowerMeters,
    lowerReference,
    upperMeters,
    upperReference: upperRef,
    label: `${lowerLabel} bis ${upperLabel}`,
  };
}

export interface SkDuValidity {
  permanent: boolean;
  /** UTC-ISO-Zeitpunkte bei befristeten Zonen. */
  start?: string;
  end?: string;
  /** Deutsche Beschreibung. */
  de: string;
  /** true, wenn der Text Zeiten nennt, die nicht maschinenlesbar sind (→ dauerhaft aktiv behandelt). */
  unparsedSchedule?: boolean;
}

const DT_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})\s*(?:(?:GMT|UTC)\s*([+-]\d{1,2})(?::?(\d{2}))?|(UTC|GMT|Z))?/gi;

function dtToIso(m: RegExpExecArray): string | undefined {
  const [d, mo, y, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  let offMin = 0;
  if (m[6]) offMin = Number(m[6]) * 60 + (Number(m[6]) < 0 ? -1 : 1) * Number(m[7] ?? 0);
  else if (!m[8]) offMin = 60; // ohne Angabe: slowakische Normalzeit (MEZ) angenommen
  const ts = Date.UTC(y, mo - 1, d, h, mi) - offMin * 60_000;
  if (!Number.isFinite(ts)) return undefined;
  return new Date(ts).toISOString().replace(/\.000Z$/, "Z");
}

/** Gültigkeit („stála permanent“, Datumsbereich, TWR-Betriebszeiten). */
export function parseSkDuValidity(text: string): SkDuValidity {
  const t = clean(text);
  const k = skKey(t);
  if (!k || /^stala\b|permanent$/.test(k)) return { permanent: true, de: "dauerhaft" };
  const twr = t.match(/\(TWR\)\s+([^\s]+(?:\s+-\s+[^\s]+)?)\s+During/i) ?? t.match(/\(TWR\)\s+(\S+)/);
  if (/prevadzkovych hodin/.test(k) || /operations? hours/.test(k)) {
    const place = twr ? twr[1] : "";
    return {
      permanent: true,
      unparsedSchedule: true,
      de: `während der Betriebszeiten der Flugverkehrskontrollstelle (TWR)${place ? ` ${place}` : ""} – Zeiten nicht angegeben, daher vorsichtshalber als dauerhaft aktiv behandelt (Betriebszeiten im Luftfahrthandbuch AIP SR / per NOTAM)`,
    };
  }
  const re = new RegExp(DT_RE.source, "gi");
  const found: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) found.push(m);
  if (found.length >= 2) {
    const start = dtToIso(found[0]);
    const end = dtToIso(found[1]);
    if (start && end) {
      const fmt = (x: RegExpExecArray) =>
        `${x[1].padStart(2, "0")}.${x[2].padStart(2, "0")}.${x[3]} ${x[4].padStart(2, "0")}:${x[5]}`;
      return { permanent: false, start, end, de: `befristet vom ${fmt(found[0])} bis ${fmt(found[1])} (Ortszeit MEZ, GMT+1)` };
    }
  }
  return {
    permanent: true,
    unparsedSchedule: true,
    de: "siehe Originaltext – vorsichtshalber als dauerhaft aktiv behandelt",
  };
}

export type SkDuCategory =
  | "airport"
  | "ctr"
  | "critical"
  | "military"
  | "protected"
  | "zoo"
  | "prohibited_permanent"
  | "prohibited_temporary"
  | "other";

/** Zonenart aus Ordner, Name und Beschränkungstext. */
export function skDuCategory(z: SkDuZone): SkDuCategory {
  const folders = z.folders.map(skKey).join("/");
  const name = skKey(z.name);
  const text = skKey(z.restrictionSk);
  if (/(^|\/)ctr(\/|$)/.test(folders) || /-ctr-|ad-d$/.test(skKey(z.ident))) {
    if (/^letisko\b/.test(name) || /ad-d$/.test(skKey(z.ident))) return "airport";
    return "ctr";
  }
  if (/bojnice|zoologick/.test(text)) return "zoo";
  if (/kritickeho subjektu/.test(text)) return "critical";
  if (/ministerstva obrany/.test(text)) return "military";
  if (/chraneneho objektu/.test(text)) return "protected";
  if (/zakaz|zakazana/.test(text)) return /docasne/.test(folders) ? "prohibited_temporary" : "prohibited_permanent";
  return "other";
}

const CATEGORY_DE: Record<SkDuCategory, string> = {
  airport: "Flughafenbereich",
  ctr: "Kontrollzone (CTR)",
  critical: "Kritische Infrastruktur",
  military: "Militärisches Objekt (Verteidigungsministerium)",
  protected: "Schutzobjekt",
  zoo: "Nationaler Zoologischer Garten Bojnice",
  prohibited_permanent: "UAS-Verbotszone",
  prohibited_temporary: "Befristete UAS-Verbotszone",
  other: "UAS-Geozone",
};

/** Deutscher Zonenname. */
export function translateSkDuName(z: SkDuZone, cat: SkDuCategory = skDuCategory(z)): string {
  const n = clean(z.name);
  if (cat === "airport") {
    const place = n.replace(/^Letisko\s+/i, "");
    return `Flughafen ${place} – Flughafenbereich (${z.ident})`;
  }
  if (cat === "ctr") {
    const place = n.replace(/^CTR\s+/i, "");
    return `Kontrollzone ${place} (${z.ident})`;
  }
  if (cat === "zoo") return `Zoo Bojnice (${z.ident})`;
  return `${CATEGORY_DE[cat]} ${z.ident}`;
}

/** Deutsche Meldung + Originaltext für eine DÚ-Geozone. */
export function buildSkDuMessageDe(
  z: SkDuZone,
  d: SkDuDecision,
  h: SkDuHeight | null,
  v: SkDuValidity,
  cat: SkDuCategory,
): string {
  const lines: string[] = [];
  lines.push(`Typ: Offizielle UAS-Geozone (Dopravný úrad) – ${CATEGORY_DE[cat]} – ${RESTRICTION_DE[d.restriction]}`);
  const head = translateSkDuHeader(z.headerSk, z.headerEn);
  if (z.headerSk || z.headerEn) lines.push(`Kategorie laut Behörde: ${head ?? SEE_ORIGINAL_DE}`);
  if (z.restrictionSk || z.restrictionEn) {
    lines.push(`Beschränkung laut Behörde: ${translateSkDuRestriction(z.restrictionSk, z.restrictionEn) ?? SEE_ORIGINAL_DE}`);
  }
  if (d.fromDefault) lines.push("Hinweis zur Einstufung: keine eindeutige Behördenkategorie – vorsichtig als genehmigungspflichtig eingestuft.");
  if (cat === "ctr" || cat === "airport") {
    lines.push(
      "Regel laut Dopravný úrad: In der CTR ist der Flug ohne Genehmigung nur mehr als 5 km vom Flughafen entfernt und bis 30 m Höhe zulässig oder im atypischen Luftraum (bis zur Gebäudehöhe, höchstens 30 m horizontal vom Gebäude, mehr als 5 km vom Flughafen). Sonst nur in der Kategorie „speziell“ mit Betriebsgenehmigung und Koordination mit der Flugverkehrskontrolle.",
    );
  }
  lines.push(`Gültigkeit: ${v.de}`);
  lines.push(h ? `Höhe laut Behörde: ${h.label}` : "Höhe laut Behörde: siehe Originaltext – Zone gilt ab Boden ohne Obergrenze.");
  if (h && h.lowerMeters > 0) {
    lines.push(`Die Beschränkung gilt ab ${fmtNum(h.lowerMeters)} m ${h.lowerReference}; darunter gelten die allgemeinen Regeln.`);
  }
  lines.push(sourceLineDe("Dopravný úrad SR – „Zemepisné oblasti UAS“ (KML)", SK_DU_ATTRIBUTION));
  return appendOriginalText(lines, duOriginalText(z), { always: true }).join("\n");
}

function duOriginalText(z: SkDuZone): string {
  const lines: string[] = [];
  if (z.folders.length) lines.push(`Ordner: ${z.folders.join(" / ")}`);
  if (z.name) lines.push(`Name: ${z.name}`);
  lines.push(...z.originalLines);
  return lines.join("\n");
}

/** Placemark-Polygone → GeoJSON (volle Präzision, ohne z). */
export function skDuGeometry(pm: KmlPlacemark): { type: "Polygon" | "MultiPolygon"; coordinates: any } | null {
  const polys = pm.polygons
    .map((p) => p.rings.filter((r) => r.length >= 4).map((r) => r.map(xy)))
    .filter((p) => p.length > 0);
  if (polys.length === 0) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

/** Einzelnes DÚ-Placemark normalisieren; null ohne Fläche. */
export function normalizeSkDuPlacemark(pm: KmlPlacemark): SkFeature | null {
  const geometry = skDuGeometry(pm);
  if (!geometry) return null;
  const z = parseSkDuDescription(pm);
  const d = decideSkDuRestriction(z);
  const h = parseSkDuHeight(z.height);
  const v = parseSkDuValidity(z.validity);
  const cat = skDuCategory(z);
  const identifier = `SK-DU-${z.ident || clean(pm.name) || "?"}`;
  const message = buildSkDuMessageDe(z, d, h, v, cat);
  const props: Record<string, any> = {
    identifier,
    name: translateSkDuName(z, cat),
    restriction: d.restriction,
    lowerMeters: h?.lowerMeters ?? 0,
    lowerReference: h?.lowerReference ?? "AGL",
    upperMeters: h?.upperMeters,
    upperReference: h?.upperReference,
    message,
    extendedProperties: localizedExtendedProperties(message, duOriginalText(z), "sk", { always: true }),
    country: "SVK",
    source: SK_GEOZONE_SOURCE_LABEL,
    attribution: SK_DU_ATTRIBUTION,
    nameOriginal: clean(pm.name) || undefined,
    skSource: "du",
    skKind: cat,
    skIdent: z.ident || undefined,
    skRestrictionFromDefault: d.fromDefault || undefined,
    infoUrl: SK_DU_UAS_ZONES_PAGE_URL,
    infoUrlLabel: "UAS-Geozonen (Dopravný úrad)",
  };
  if (!v.permanent && v.start && v.end) {
    props.applicability = [{ permanent: "NO", startDateTime: v.start, endDateTime: v.end }];
  }
  if (cat === "ctr" || cat === "airport") {
    props.applicationUrl = SK_DU_CTR_RULES_URL;
    props.applicationUrlLabel = "Flüge in der CTR (Dopravný úrad)";
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: identifier, geometry, properties: props };
}

// ---------------------------------------------------------------------------
// DÚ: Download (Seite → ZIP → KML)
// ---------------------------------------------------------------------------

/** ZIP-Link der aktuellen KML auf der DÚ-Seite finden (https, URL-kodiert). */
export function findSkDuZipUrl(html: string, pageUrl: string = SK_DU_UAS_ZONES_PAGE_URL): string | null {
  const hrefs = String(html ?? "").match(/href\s*=\s*["']([^"']+\.(?:zip|kmz|kml))["']/gi) ?? [];
  const urls = hrefs.map((h) => h.replace(/^href\s*=\s*["']/i, "").replace(/["']$/, ""));
  const pick = urls.find((u) => /wp-content\/uploads\//i.test(u)) ?? urls[0];
  if (!pick) return null;
  let u = pick.replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = `https:${u}`;
  else if (u.startsWith("/")) u = pageUrl.replace(/^(https?:\/\/[^/]+).*$/, "$1") + u;
  else if (!/^https?:/i.test(u)) u = pageUrl.replace(/[^/]*$/, "") + u;
  // Android blockiert Klartext-HTTP – der Server liefert dieselbe Datei per HTTPS.
  u = u.replace(/^http:\/\//i, "https://");
  try {
    u = encodeURI(decodeURI(u));
  } catch {
    u = encodeURI(u);
  }
  return u;
}

/** ZIP/KMZ/KML-Bytes → KML-Text (erste .kml im Archiv). */
export function decodeSkDuArchive(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /\.kml$/i.test(n));
    if (!name) throw new Error("DÚ-Archiv enthält keine KML-Datei");
    return strFromU8(files[name]);
  }
  return strFromU8(bytes);
}

// ---------------------------------------------------------------------------
// Kombination
// ---------------------------------------------------------------------------

export type SkDropReason = SkExclusionReason | "no_geometry" | "duplicate" | "expired";

export interface SkNormalizeResult {
  features: SkFeature[];
  dropped: { source: "du" | "lps"; name: string; reason: SkDropReason }[];
}

export interface SkNormalizeInput {
  /** Rohfeatures (ArcGIS f=geojson) aus VFRM_popup/MapServer/5. */
  lps?: any[];
  /** KML-Text der DÚ-Geozonen. */
  duKml?: string;
  /** Bezugszeit für abgelaufene befristete Zonen (Default: jetzt). */
  now?: number;
}

/** DÚ-Geozonen + LPS-Lufträume → Features + Verwerfungsstatistik. */
export function normalizeSlovakiaWithStats(input: SkNormalizeInput): SkNormalizeResult {
  const now = input.now ?? Date.now();
  const features: SkFeature[] = [];
  const dropped: SkNormalizeResult["dropped"] = [];
  const ids = new Set<string>();

  // 1) DÚ (drohnenspezifisch)
  let duHasCtr = false;
  if (input.duKml) {
    const seenGeom = new Set<string>();
    for (const pm of parseKmlPlacemarks(input.duKml)) {
      const label = clean(pm.name) || "?";
      const f = normalizeSkDuPlacemark(pm);
      if (!f) {
        dropped.push({ source: "du", name: label, reason: "no_geometry" });
        continue;
      }
      const gKey = JSON.stringify(f.geometry.coordinates);
      const id = String(f.properties.identifier);
      if (ids.has(id) && seenGeom.has(gKey)) {
        dropped.push({ source: "du", name: label, reason: "duplicate" });
        continue;
      }
      const end = f.properties.applicability?.[0]?.endDateTime;
      if (end && new Date(end).getTime() < now) {
        dropped.push({ source: "du", name: label, reason: "expired" });
        continue;
      }
      seenGeom.add(gKey);
      if (ids.has(id)) {
        let n = 2;
        while (ids.has(`${id}#${n}`)) n++;
        f.properties.identifier = `${id}#${n}`;
        f.id = `${id}#${n}`;
      }
      ids.add(String(f.properties.identifier));
      if (f.properties.skKind === "ctr") duHasCtr = true;
      features.push(f);
    }
  }

  // 2) LPS (ergänzend)
  const seenLps = new Set<string>();
  for (const raw of input.lps ?? []) {
    const p = raw?.properties ?? {};
    const label = clean(p.IDENT_TXT) || clean(p.NAME_TXT) || String(p.OBJECTID ?? "?");
    // Dedupe über TYPE_CODE + LOCALTYPE_TXT + IDENT_TXT (IDENT allein ist nicht
    // eindeutig: z. B. LZPP = CTR und ATZ PIEŠŤANY).
    const key = `${clean(p.TYPE_CODE)}|${clean(p.LOCALTYPE_TXT)}|${clean(p.IDENT_TXT) || String(p.OBJECTID ?? "")}`;
    if (seenLps.has(key)) {
      dropped.push({ source: "lps", name: label, reason: "duplicate" });
      continue;
    }
    seenLps.add(key);
    const d = classifySkLps(p);
    if (d.excluded) {
      dropped.push({ source: "lps", name: label, reason: d.excluded });
      continue;
    }
    if (d.kind === "ctr" && duHasCtr && /^LZ/i.test(clean(p.IDENT_TXT))) {
      dropped.push({ source: "lps", name: label, reason: "covered_by_du" });
      continue;
    }
    const lower = skLimit(p.DISTVERTLOWER_VAL, p.DISTVERTLOWER_UOM, p.DISTVERTLOWER_CODE);
    if (skLowerAboveDroneHeight(lower)) {
      dropped.push({ source: "lps", name: label, reason: "above_drone_height" });
      continue;
    }
    const f = normalizeSkLpsFeature(raw, d);
    if (!f) {
      dropped.push({ source: "lps", name: label, reason: "no_geometry" });
      continue;
    }
    const id = String(f.properties.identifier);
    if (ids.has(id)) {
      let n = 2;
      while (ids.has(`${id}#${n}`)) n++;
      f.properties.identifier = `${id}#${n}`;
      f.id = `${id}#${n}`;
    }
    ids.add(String(f.properties.identifier));
    features.push(f);
  }
  return { features, dropped };
}

export function normalizeSlovakia(input: SkNormalizeInput): SkFeature[] {
  return normalizeSlovakiaWithStats(input).features;
}

// ---------------------------------------------------------------------------
// ArcGIS-Abfrage (URL + Seitenauswertung)
// ---------------------------------------------------------------------------

/** Query-URL (GeoJSON, WGS84, alle Felder, volle Präzision, eine Seite). */
export function skLpsQueryUrl(offset = 0, count = 1000): string {
  return arcgisQueryUrl(SK_LPS_AIRSPACE_LAYER_URL, { offset, count, orderByFields: "OBJECTID" });
}

/** Seite einer ArcGIS-`f=geojson`-Antwort lesen; ArcGIS-Fehlerobjekt (HTTP 200 + {error}) wird geworfen. */
export function skArcgisPage(body: any): { features: any[]; exceeded: boolean } {
  return arcgisPage(body);
}
