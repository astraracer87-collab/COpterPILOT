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

// Standard-erreichbare Höhe (EU Open-Kategorie: 120 m AGL), wenn keine Drohne
// gewählt ist bzw. keine geplante Höhe vorliegt.
export const DEFAULT_REACHABLE_ALTITUDE_M = 120;

export type AltitudeReference = "MSL" | "AGL";

// Normalisiert die verschiedenen Höhenbezugs-Schreibweisen der ED-269-Anbieter
// auf MSL oder AGL. MSL/AMSL/STD/FL -> MSL (über Meeresspiegel, muss erst in
// AGL umgerechnet werden). GND/SFC/AGL sowie leer/unbekannt -> AGL (direkter
// Vergleich, da der Wert bereits Höhe über Grund ist).
export function normalizeAltitudeReference(raw: any): AltitudeReference {
  const r = String(raw ?? "").toUpperCase().trim();
  if (r === "MSL" || r === "AMSL" || r === "STD" || r === "FL") return "MSL";
  return "AGL";
}

export interface ZoneAltitudeInput {
  // Untergrenze der Zone in Metern (bereits in der Quelleinheit umgerechnet).
  // null/undefined oder <= 0 bedeutet "keine erkennbare Untergrenze" (GND/SFC/0).
  lowerMeters?: number | null;
  // Höhenbezug der Untergrenze (MSL/AGL bzw. roher Quellwert).
  lowerReference?: AltitudeReference | string | null;
}

export interface ReachabilityOptions {
  // Erreichbare bzw. geplante Flughöhe in Höhe über Grund (AGL), in Metern.
  reachableAltitudeM: number;
  // Geländehöhe (MSL) am Ort/Kartenzentrum, für die MSL->AGL-Umrechnung.
  // null/undefined => MSL-Zonen können nicht sicher umgerechnet werden und
  // bleiben sicherheitshalber sichtbar.
  terrainElevationM?: number | null;
}

// Entscheidet, ob eine Zone für die erreichbare Höhe relevant ist (= sichtbar).
// true  = anzeigen (Drohne kann die Untergrenze erreichen oder Untergrenze GND).
// false = wegen Höhe ausblenden (Untergrenze liegt über der erreichbaren Höhe).
export function isZoneReachable(
  zone: ZoneAltitudeInput,
  opts: ReachabilityOptions,
): boolean {
  const lower = zone.lowerMeters;
  // Keine erkennbare Untergrenze bzw. GND/0 -> immer sichtbar (z. B. CTR-Ringe).
  if (lower == null || !Number.isFinite(lower) || lower <= 0) return true;

  const ref = normalizeAltitudeReference(zone.lowerReference);
  let lowerAgl = lower;
  if (ref === "MSL") {
    const terrain = opts.terrainElevationM;
    // Ohne bekannte Geländehöhe keine sichere MSL->AGL-Umrechnung möglich ->
    // sicherheitshalber anzeigen, statt fälschlich auszublenden.
    if (terrain == null || !Number.isFinite(terrain)) return true;
    lowerAgl = lower - terrain;
  }
  // Untergrenze auf/unter Grund -> immer sichtbar.
  if (lowerAgl <= 0) return true;
  // Bei Gleichstand (==) bleibt die Zone sichtbar; nur echt darüber ausblenden.
  return lowerAgl <= opts.reachableAltitudeM;
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
}

export interface GeozoneAltitudeClassification {
  kind: GeozoneAltitudeKind;
  // Decke in Metern (nur bei kind === "altitudeLimit"), sonst null.
  ceilingM: number | null;
  // Kurzes deutsches Label: "bis 100 m" / "Flugverbot" / null (unknown).
  label: string | null;
}

// Schlüsselwörter, die ein Flugverbot / eine genehmigungspflichtige Sperrung
// signalisieren (DE/FR/EN/NL). "Sperrungen" (NOTAM-Quellenhinweis) bleibt
// bewusst außen vor.
const NO_FLY_TEXT_RE =
  /(flugverbot|verboten|gesperrt|sperrgebiet|interdit|interdiction|prohibit|forbidden|no[\s-]?fly|geen\s+drone|verboden|überflug ist strafbar)/i;

// Genehmigungspflicht-Schlüsselwörter (DE/FR/EN/NL). Eine Zone, die eine
// Freigabe/Genehmigung verlangt, wird NICHT durch Unterschreiten einer Decke
// unkritisch — die Genehmigung gilt in jeder Höhe. Solche Zonen bleiben
// "unknown" (heutiges Verhalten -> AV-/Genehmigungs-Flow greift).
const REQ_AUTH_TEXT_RE =
  /(genehmigung|bewilligung|freigabe|zustimmung|erlaubnispflichtig|authoris|authoriz|autorisation|toestemming|vergunning)/i;

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

// Max-Flughöhe-Wortlaut OHNE Zahl (Decke kommt dann aus upperMeters).
const MAX_HEIGHT_WORDING_RE =
  /(maximale?\s*flugh[öo]he|h[öo]henbeschr[äa]nkung|hauteur\s+maximale|altitude\s+maximale|maximum\s+(?:flight\s+)?(?:height|altitude)|maximale?\s*(?:vlieg)?hoogte)/i;

// Bezugs-Token, die eine Decke als MSL/Flugfläche (Luftraumstruktur wie CTR/TMA)
// ausweisen. Solche Decken sind KEINE Drohnen-Flughöhen-Limits.
const MSL_CEILING_RE = /\b(msl|amsl|qnh|std|fl\s?\d|flight\s*level)\b/i;

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
  const restriction = String(zone.restriction ?? "").toUpperCase();
  const text = [zone.name, zone.layerLabel, zone.details, zone.altitudeLabel]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");

  // 1) Echtes Flugverbot -> immer Konflikt.
  if (
    restriction === "PROHIBITED" ||
    restriction.includes("PROHIBIT") ||
    NO_FLY_TEXT_RE.test(text)
  ) {
    return { kind: "noFly", ceilingM: null, label: "Flugverbot" };
  }

  // Strukturierte, autoritative Genehmigungspflicht aus dem restriction-Feld der
  // Quelle (ED-269/CH RESTRICTED etc.). Sie ist ein verlässliches Regulierungs-
  // Signal und sticht IMMER — auch einen genannten Max-Flughöhe-Wert.
  const restrictionRequiresAuth =
    restriction === "REQ_AUTHORISATION" ||
    restriction.includes("AUTHORIS") ||
    restriction.includes("AUTHORIZ") ||
    restriction.includes("REQ_AUTH");

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

  // Genehmigungspflichtige Zonen NIE über eine Decke freigeben: die Genehmigung
  // gilt in jeder Höhe (Sicherheits-Guard). -> "unknown", AV-Flow greift.
  // Greift für die unschärferen Pfade 2b/2c (Wortlaut ohne Zahl / strukturierte
  // Decke); hier zählt auch das textuelle Genehmigungs-Schlagwort.
  const requiresAuthorisation =
    restrictionRequiresAuth || REQ_AUTH_TEXT_RE.test(text);

  // 2b) Max-Flughöhe-Wortlaut ohne Zahl, aber mit strukturierter Decke
  //     (upperMeters). Greift z. B. wenn das Label nur "Höhenbeschränkung"
  //     trägt und die Zahl separat als upperMeters vorliegt.
  const upper = zone.upperMeters;
  const hasFiniteUpper = typeof upper === "number" && Number.isFinite(upper) && upper > 0;
  if (!requiresAuthorisation && hasFiniteUpper && MAX_HEIGHT_WORDING_RE.test(text)) {
    return { kind: "altitudeLimit", ceilingM: upper as number, label: `bis ${Math.round(upper as number)} m` };
  }

  // 2c) Strukturierte "von Grund bis X m AGL"-Beschränkungszone (CH/NL/LU/
  //     ED-269 RESTRICTED): Untergrenze am Boden, endliche AGL-Decke, KEIN
  //     Flugverbot und KEINE Genehmigungspflicht -> Decke = upperMeters.
  //     MSL/Flugflächen-Decken (Luftraumstrukturen wie CTR/TMA) sind bewusst
  //     ausgenommen — ihre Oberkante ist keine Drohnen-Flughöhe.
  const lower = zone.lowerMeters;
  const groundBasedFloor = lower == null || !Number.isFinite(lower) || lower <= 0;
  const lowerRef = normalizeAltitudeReference(zone.lowerReference);
  const mslCeiling = lowerRef === "MSL" || MSL_CEILING_RE.test(text);
  if (
    !requiresAuthorisation &&
    hasFiniteUpper &&
    groundBasedFloor &&
    !mslCeiling
  ) {
    const ceil = Math.round(upper as number);
    return { kind: "altitudeLimit", ceilingM: ceil, label: `bis ${ceil} m` };
  }

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
