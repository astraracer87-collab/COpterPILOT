// Reine, React-Native-freie Höhenstaffelungs-Logik für das neue DFS-CTR-Modell
// (NfL 2026-1-3884 / 2026-1-3885, BMV, in Kraft seit 24.04.2026).
//
// Bewusst frei von React-Native-Imports (kein AsyncStorage/expo-constants), damit
// die Logik unter dem tsx-Testrunner (web/run-tests.sh) ohne den nativen
// Modulgraphen geprüft werden kann – analog zu geozoneCoverage.ts/geozoneTileUrl.ts.
// Sowohl die Mobile-App (client/lib/ctrData.ts) als auch das Web (@client/lib/ctrAltitude)
// nutzen DIESE eine Quelle, damit beide Oberflächen identische Logik/Werte zeigen.
//
// OFFIZIELLES MODELL (NfL 2026-1-3884, BMV, Bonn 24.04.2026 – gilt ab sofort in
// allen CTR deutscher Flugplätze):
// Das BMV teilt die Kontrollzone (CTR) in zwei Bereiche:
//   - Außenbereich bis max. 100 m über Flugplatzhöhe / 100 m über Grund (der
//     niedrigere Wert ist maßgeblich): Hier kann die örtlich zuständige
//     Flugsicherung eine pauschale Freigabe per Allgemeinverfügung erteilen.
//   - Innenbereich UND Außenbereich über 100 m: individuelle Flugverkehrs-
//     kontrollfreigabe der örtlich zuständigen Flugsicherung erforderlich.
// Es gibt KEINE distanzabhängige Höhenstaffel (50/75/100 m); im gesamten
// Außenbereich gilt einheitlich max. 100 m AGL.
//
// WICHTIG – per-CTR-Geometrie: Die genaue Lage von Außen-/Innenbereich je CTR
// wird vom BMV im Luftfahrthandbuch (AIP GERMANY) bekanntgegeben und schrittweise
// bis Herbst 2026 umgestellt. Die hier verwendete Innenbereich-Grenze (Näherung)
// dient nur der distanzbasierten Anzeige; maßgeblich ist stets das AIP der CTR.

/**
 * Höhenbezugs-Regel eines Bands (NfL 2026-1-3960, 4-Zonen-Modell):
 * - "agl":     Höhe rein über Grund (AGL) – Legacy/flaches Modell.
 * - "lowerOf": max(H über Grund) ODER (H über Flugplatzhöhe) – der NIEDRIGERE
 *              Wert zählt (Zonen 2 und 3).
 * - "higherOf": (minAglM über Grund) ODER (H über Flugplatzhöhe) – der HÖHERE
 *              Wert zählt, gedeckelt durch die EU-120-m-Grenze (Zone 4).
 */
export type CtrHeightRule = "agl" | "lowerOf" | "higherOf";

export interface CtrHeightStep {
  /** Untergrenze der Distanz von der Flughafen-Referenz in km (inklusive). */
  fromDistanceKm: number;
  /**
   * Pauschal freigegebene maximale Aufstiegshöhe in m für dieses Distanzband
   * (nomineller Bezugswert; siehe heightRule). 0 m bedeutet Innenbereich/Zone 1 –
   * keine pauschale Freigabe, Einzelfreigabe nötig.
   */
  maxHeightAglM: number;
  /** Zonen-Label des neuen 4-Zonen-Modells (z. B. "Zone 2"). */
  zoneLabel?: string;
  /** Höhenbezugs-Regel; Default "agl". */
  heightRule?: CtrHeightRule;
  /** Nur heightRule "higherOf" (Zone 4): garantierte Mindesthöhe über Grund. */
  minAglM?: number;
}

// ===========================================================================
// OFFIZIELLES NEUES DFS-MODELL (NfL 2026-1-3884): Außenbereich einheitlich bis
// max. 100 m AGL (pauschale Freigabe möglich); Innenbereich = Einzelfreigabe.
//
// Die exakte Innen-/Außenbereich-Geometrie je CTR steht im AIP GERMANY und wird
// bis Herbst 2026 schrittweise umgestellt. Die Distanzgrenze (1,5 km) ist daher
// nur eine Näherung für die Anzeige – maßgeblich ist das AIP der jeweiligen CTR.
// ===========================================================================
export const DFS_CTR_HEIGHT_STEPS: CtrHeightStep[] = [
  { fromDistanceKm: 0, maxHeightAglM: 0 }, // Innenbereich: keine pauschale Freigabe (Einzelfreigabe)
  { fromDistanceKm: 1.5, maxHeightAglM: 100 }, // Außenbereich: pauschal bis 100 m AGL (Grenze je CTR im AIP)
];

// ===========================================================================
// NEUES 4-ZONEN-MODELL (NfL 2026-1-3960, gültig ab 06.08.2026) – gilt NUR in
// den Kontrollzonen der 15 Flughäfen mit DFS-Flugplatzkontrolle. Hebt die
// bisherige NfL 2023-1-2705 auf.
//
//   Zone 1: Flughafenbereich + 1-km/5-km-Bereich (§ 21h Abs. 3 Nr. 2 LuftVO)
//           → IMMER individuelle FVK-Freigabe (keine pauschale Höhe).
//   Zone 2: außerhalb Zone 1, innerhalb 4-km-Kreis um den Flugplatzbezugspunkt
//           → max. 25 m über Grund ODER 25 m über Flugplatzhöhe (der
//             NIEDRIGERE Wert zählt).
//   Zone 3: außerhalb Zonen 1–2, innerhalb 6-km-Kreis → max. 45 m; der
//             NIEDRIGERE Wert zählt.
//   Zone 4: restliche CTR → 100 m über Flugplatzhöhe ODER 50 m über Grund
//             (der HÖHERE Wert zählt; EU-Grenze 120 m bleibt bestehen).
//
// Die Zone-1-Grenze (1-km/5-km-Bereich) ist NICHT kreisförmig; die 1,5-km-
// Distanzgrenze ist nur eine Anzeige-Näherung. Die örtliche Darstellung der
// Zonen wird je Flughafen in Ergänzungen zur AIP GERMANY veröffentlicht.
// ===========================================================================
export const DFS_ZONEN_HEIGHT_STEPS: CtrHeightStep[] = [
  { fromDistanceKm: 0, maxHeightAglM: 0, zoneLabel: "Zone 1" },
  { fromDistanceKm: 1.5, maxHeightAglM: 25, zoneLabel: "Zone 2", heightRule: "lowerOf" },
  { fromDistanceKm: 4, maxHeightAglM: 45, zoneLabel: "Zone 3", heightRule: "lowerOf" },
  { fromDistanceKm: 6, maxHeightAglM: 100, zoneLabel: "Zone 4", heightRule: "higherOf", minAglM: 50 },
];

/** Stichtag, ab dem die NfL 2026-1-3960 (4-Zonen-Modell) gilt. */
export const DFS_ZONEN_EFFECTIVE_DATE_ISO = "2026-08-06";
/** Anzeige-Hinweis zum Stichtag des 4-Zonen-Modells. */
export const DFS_ZONEN_EFFECTIVE_NOTE =
  "Neue DFS-Zonen (NfL 2026-1-3960) \u2013 g\u00fcltig ab 6.8.2026; bis 5.8.2026 gilt die bisherige Regelung";

/**
 * Konfigurierba­res Datum, ab dem die AIP-GERMANY-Umstellung der Innen-/
 * Außenbereich-Geometrie aller CTR als abgeschlossen gilt (NfL 2026-1-3884).
 * Sobald dieses Datum erreicht ist, verschwinden alle "Umstellung bis Herbst
 * 2026"- und "vorläufig"-Hinweise automatisch.
 *
 * Anpassen, sobald die Umstellung offiziell bestätigt ist. Der Platzhalter
 * "2027-01-01" hält die Hinweise sichtbar, bis das Datum manuell gesetzt wird.
 */
export const DFS_AIP_GEOMETRY_DATE_ISO = "2027-01-01";

/**
 * True, sobald das 4-Zonen-Modell (NfL 2026-1-3960) in Kraft ist (lokales
 * Datum >= Stichtag). Steuert das automatische Ausblenden aller
 * "gültig ab 6.8.2026"-Hinweise am/nach dem Stichtag.
 */
export function isDfsZonenEffective(now: Date = new Date()): boolean {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` >= DFS_ZONEN_EFFECTIVE_DATE_ISO;
}

/**
 * Stichtags-Hinweis für die UI: vor dem 6.8.2026 der bekannte
 * "gültig ab"-Text, ab dem Stichtag null (Hinweis entfällt).
 */
export function getDfsZonenEffectiveNote(now: Date = new Date()): string | null {
  return isDfsZonenEffective(now) ? null : DFS_ZONEN_EFFECTIVE_NOTE;
}

/**
 * True, sobald die AIP-GERMANY-Umstellung der Innen-/Außenbereich-Geometrie
 * (NfL 2026-1-3884) als abgeschlossen gilt (lokales Datum >= DFS_AIP_GEOMETRY_DATE_ISO).
 * Steuert das automatische Ausblenden aller "Umstellung bis Herbst 2026"-
 * und "vorläufig"-Hinweise für das Außen-/Innenbereich-Modell.
 * Datum in DFS_AIP_GEOMETRY_DATE_ISO anpassen, sobald die Umstellung bestätigt ist.
 */
export function isDfsAipGeometryComplete(now: Date = new Date()): boolean {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` >= DFS_AIP_GEOMETRY_DATE_ISO;
}

/**
 * @deprecated Alias auf {@link DFS_CTR_HEIGHT_STEPS}. Die Werte sind nicht mehr
 * vorläufig (NfL 2026-1-3884 offiziell veröffentlicht); nur die Innen-/Außen-
 * Geometrie je CTR wird im AIP GERMANY schrittweise bekanntgegeben.
 */
export const DFS_CTR_HEIGHT_STEPS_PROVISIONAL = DFS_CTR_HEIGHT_STEPS;

/** Legacy-50-m-Allgemeinverfügung (altes Modell), solange eine CTR noch nicht
 * auf das neue BMV-Modell umgestellt ist (z.B. Austro Control / TRIAC). */
export const LEGACY_50M_HEIGHT_STEPS: CtrHeightStep[] = [
  { fromDistanceKm: 0, maxHeightAglM: 0 }, // Innenbereich (< 1,5 km): Einzelfreigabe
  { fromDistanceKm: 1.5, maxHeightAglM: 50 }, // Außenbereich: pauschal bis 50 m AGL
];

/** Absolute Obergrenze der Höhe im neuen Modell (m AGL). */
export const DFS_CTR_MAX_HEIGHT_AGL_M = 100;

export type CtrArea = "innen" | "aussen";

export interface CtrClearanceResult {
  /** "innen" => Einzelfreigabe nötig; "aussen" => pauschale Freigabe. */
  area: CtrArea;
  /** Pauschal freigegebene max. Aufstiegshöhe in m AGL (0 im Innenbereich). */
  maxHeightAglM: number;
  /**
   * True, solange die exakte Innen-/Außenbereich-Geometrie der CTR im AIP noch
   * nicht umgestellt ist (Distanzgrenze ist dann eine Näherung). Die
   * Rahmenbedingungen selbst (NfL 2026-1-3884) sind offiziell.
   */
  geometryPerAip: boolean;
  /** Die zugrundeliegende Distanz von der Flughafen-Referenz in km. */
  distanceKm: number;
  /** Zonen-Label des getroffenen Bands (4-Zonen-Modell), z. B. "Zone 2". */
  zoneLabel?: string;
  /** Klartext der Höhenregel des getroffenen Bands (inkl. Bezugsregel). */
  heightText: string;
}

function sortedSteps(steps: CtrHeightStep[]): CtrHeightStep[] {
  return [...steps].sort((a, b) => a.fromDistanceKm - b.fromDistanceKm);
}

/**
 * Liefert für eine gegebene Distanz von der Flughafen-Referenz die zutreffende
 * Freigabe: Innen-/Außenbereich und die pauschal freigegebene max. Höhe (AGL).
 * Wählt das höchste Band, dessen fromDistanceKm <= distanceKm ist.
 *
 * `geometryPerAip` markiert, dass die distanzbasierte Innen-/Außen-Grenze eine
 * Näherung ist (maßgeblich ist das AIP GERMANY der jeweiligen CTR).
 */
export function getCtrClearance(
  distanceKm: number,
  steps: CtrHeightStep[] = DFS_CTR_HEIGHT_STEPS,
  geometryPerAip: boolean = true,
): CtrClearanceResult {
  const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const ordered = sortedSteps(steps);
  let applicable: CtrHeightStep = ordered[0] ?? { fromDistanceKm: 0, maxHeightAglM: 0 };
  for (const step of ordered) {
    if (safeDistance >= step.fromDistanceKm) applicable = step;
    else break;
  }
  const maxHeightAglM = Math.max(0, applicable.maxHeightAglM);
  return {
    area: maxHeightAglM > 0 ? "aussen" : "innen",
    maxHeightAglM,
    geometryPerAip,
    distanceKm: safeDistance,
    zoneLabel: applicable.zoneLabel,
    heightText: describeStepHeight(applicable),
  };
}

/**
 * Näherungs-Radius (km) des Innenbereichs ab der Flughafen-Referenz: die
 * Untergrenze des ersten Bands mit einer Höhe > 0. Dient nur der Anzeige; die
 * exakte Geometrie steht im AIP GERMANY der jeweiligen CTR.
 */
export function getCtrInnerRadiusKm(
  steps: CtrHeightStep[] = DFS_CTR_HEIGHT_STEPS,
): number {
  const ordered = sortedSteps(steps);
  const firstOuter = ordered.find((s) => s.maxHeightAglM > 0);
  return firstOuter ? firstOuter.fromDistanceKm : 0;
}

const M_PER_KM = 1000;

/** Kompakte Beschreibung eines Distanzbands für die UI (z. B. "ab 1,5 km: max. 100 m AGL"). */
export function describeHeightStep(
  step: CtrHeightStep,
  nextStep?: CtrHeightStep,
): string {
  const from = formatKm(step.fromDistanceKm);
  const range = nextStep
    ? `${from}\u2013${formatKm(nextStep.fromDistanceKm)} km`
    : `ab ${from} km`;
  const prefix = step.zoneLabel ? `${step.zoneLabel} (${range})` : range;
  return `${prefix}: ${describeStepHeight(step)}`;
}

/** Höhen-Kurztext eines Bands inkl. Bezugsregel (niedrigerer/höherer Wert). */
export function describeStepHeight(step: CtrHeightStep): string {
  if (step.maxHeightAglM <= 0) {
    return step.zoneLabel
      ? "immer individuelle FVK-Freigabe"
      : "Innenbereich (Einzelfreigabe)";
  }
  if (step.heightRule === "lowerOf") {
    return `max. ${step.maxHeightAglM} m \u00fcber Grund oder \u00fcber Flugplatzh\u00f6he (der niedrigere Wert z\u00e4hlt)`;
  }
  if (step.heightRule === "higherOf") {
    return `${step.maxHeightAglM} m \u00fcber Flugplatzh\u00f6he oder ${step.minAglM ?? 50} m \u00fcber Grund (der h\u00f6here Wert z\u00e4hlt)`;
  }
  return `max. ${step.maxHeightAglM} m AGL`;
}

/** Liefert alle Distanzband-Beschreibungen einer Staffelung (für Listen). */
export function describeHeightSteps(
  steps: CtrHeightStep[] = DFS_CTR_HEIGHT_STEPS,
): string[] {
  const ordered = sortedSteps(steps);
  return ordered.map((s, i) => describeHeightStep(s, ordered[i + 1]));
}

function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(".", ",");
}

// ===========================================================================
// Visuelle Darstellung der Innen-/Außenbereich-Staffelung als konzentrische
// Ringe auf der Karte (nativ react-native-maps Circle, Web Leaflet L.circle).
// Reine Geometrie/Farb-Logik (RN-frei), damit beide Oberflächen identische
// Ringe zeichnen und die Logik unter dem tsx-Testrunner prüfbar bleibt.
// ===========================================================================

/** Ein farblich codierter Höhenband-Ring um die Flughafen-Referenz. */
export interface CtrBandRing {
  /** Außenradius des Bands ab der Flughafen-Referenz in Metern. */
  radiusM: number;
  area: CtrArea;
  /** Pauschal freigegebene max. Höhe in m AGL (0 = Innenbereich). */
  maxHeightAglM: number;
  /** Kurzlabel für Callout/Legende (z. B. "Außenbereich · max. 50 m AGL"). */
  label: string;
  /** Linienfarbe (Hex). */
  strokeColor: string;
  /** Füllfarbe (Hex; Deckkraft separat über fillOpacity). */
  fillColor: string;
  fillOpacity: number;
  strokeOpacity: number;
}

interface BandColor {
  stroke: string;
  fill: string;
  fillOpacity: number;
  strokeOpacity: number;
}

const CTR_INNEN_COLOR: BandColor = {
  stroke: "#FF3B30",
  fill: "#FF3B30",
  fillOpacity: 0.22,
  strokeOpacity: 0.95,
};
const CTR_50_COLOR: BandColor = {
  stroke: "#FF9500",
  fill: "#FF9500",
  fillOpacity: 0.16,
  strokeOpacity: 0.9,
};
const CTR_75_COLOR: BandColor = {
  stroke: "#E6B400",
  fill: "#FFCC00",
  fillOpacity: 0.15,
  strokeOpacity: 0.9,
};
const CTR_100_COLOR: BandColor = {
  stroke: "#34C759",
  fill: "#34C759",
  fillOpacity: 0.12,
  strokeOpacity: 0.9,
};

function ctrBandColor(area: CtrArea, maxHeightAglM: number): BandColor {
  if (area === "innen") return CTR_INNEN_COLOR;
  if (maxHeightAglM <= 30) return CTR_50_COLOR; // Zone 2 (25 m) – orange
  if (maxHeightAglM <= 75) return CTR_75_COLOR; // Zone 3 (45 m) / Legacy 50 m – gelb
  return CTR_100_COLOR; // Zone 4 / Außenbereich 100 m – grün
}

/** Kurzlabel eines Bands für Callouts/Legenden. */
export function describeCtrBand(
  area: CtrArea,
  maxHeightAglM: number,
  step?: CtrHeightStep,
): string {
  if (area === "innen") {
    return step?.zoneLabel
      ? `${step.zoneLabel} \u00b7 individuelle FVK-Freigabe`
      : "Innenbereich \u00b7 Einzelfreigabe";
  }
  if (step?.zoneLabel) {
    if (step.heightRule === "higherOf") {
      return `${step.zoneLabel} \u00b7 ${step.minAglM ?? 50}\u2013${step.maxHeightAglM} m (der h\u00f6here Wert z\u00e4hlt)`;
    }
    if (step.heightRule === "lowerOf") {
      return `${step.zoneLabel} \u00b7 max. ${step.maxHeightAglM} m (der niedrigere Wert z\u00e4hlt)`;
    }
    return `${step.zoneLabel} \u00b7 max. ${step.maxHeightAglM} m AGL`;
  }
  return `Au\u00dfenbereich \u00b7 max. ${maxHeightAglM} m AGL`;
}

/** Ein Eintrag der Kartenlegende: Farb-Swatch + Bedeutung eines Höhenbands. */
export interface CtrLegendEntry {
  /** Linienfarbe (Hex) – Rand des Swatches, identisch zum Karten-Ring. */
  strokeColor: string;
  /** Füllfarbe (Hex) – Fläche des Swatches, identisch zum Karten-Ring. */
  fillColor: string;
  /** Deckkraft der Füllfläche (wie der Karten-Ring). */
  fillOpacity: number;
  /** Bedeutung des Bands (aus describeCtrBand). */
  label: string;
}

/**
 * Hinweistext zur vorläufigen Natur der Höhenbänder (für die Legende).
 * Datumsgesteuert: der "gültig ab 6.8.2026"-Teil entfällt ab dem Stichtag.
 */
export function getCtrProvisionalNote(now: Date = new Date()): string {
  return isDfsZonenEffective(now)
    ? "NfL 2026-1-3960 \u00b7 Zonen-Geometrie je CTR: AIP/dipul (Ringe = N\u00e4herung)"
    : "NfL 2026-1-3960 g\u00fcltig ab 6.8.2026 \u00b7 Zonen-Geometrie je CTR: AIP/dipul (Ringe = N\u00e4herung)";
}

/**
 * Legenden-Einträge für die farbcodierten CTR-Höhenbänder. Farben und Labels
 * stammen aus DERSELBEN Quelle wie die Kartenringe (ctrBandColor +
 * describeCtrBand), damit Karte und Legende immer konsistent bleiben.
 */
export function getCtrLegendEntries(
  stepsList: CtrHeightStep[][] = [
    DFS_ZONEN_HEIGHT_STEPS,
    DFS_CTR_HEIGHT_STEPS,
    LEGACY_50M_HEIGHT_STEPS,
  ],
): CtrLegendEntry[] {
  const seen = new Set<string>();
  const entries: CtrLegendEntry[] = [];
  for (const steps of stepsList) {
    for (const step of sortedSteps(steps)) {
      const area: CtrArea = step.maxHeightAglM > 0 ? "aussen" : "innen";
      const label = describeCtrBand(area, step.maxHeightAglM, step);
      if (seen.has(label)) continue;
      seen.add(label);
      const color = ctrBandColor(area, step.maxHeightAglM);
      entries.push({
        strokeColor: color.stroke,
        fillColor: color.fill,
        fillOpacity: color.fillOpacity,
        label,
      });
    }
  }
  return entries;
}

/**
 * Liefert die konzentrischen Höhenband-Ringe um die Flughafen-Referenz,
 * GRÖSSTER RING ZUERST, sodass der Aufrufer sie der Reihe nach zeichnen kann:
 * jeder kleinere (später gezeichnete) Kreis überdeckt den größeren, wodurch
 * sichtbare, farblich unterscheidbare Bänder entstehen. Der Innenkreis ist der
 * vorläufige Innenbereich-Radius (siehe getCtrInnerRadiusKm).
 *
 * Das letzte (nach außen unbegrenzte) Band erhält einen vorläufigen
 * Außenradius (Breite des letzten definierten Bands an die letzte Grenze
 * angehängt), da die exakte CTR-Geometrie erst im Laufe der Umstellung vorliegt.
 */
export function getCtrBandRings(
  steps: CtrHeightStep[] = DFS_CTR_HEIGHT_STEPS_PROVISIONAL,
): CtrBandRing[] {
  const ordered = sortedSteps(steps);
  if (ordered.length === 0) return [];
  const rings: CtrBandRing[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const step = ordered[i];
    const next = ordered[i + 1];
    let upperKm: number;
    if (next) {
      upperKm = next.fromDistanceKm;
    } else {
      const prev = ordered[i - 1];
      const width = prev ? step.fromDistanceKm - prev.fromDistanceKm : step.fromDistanceKm;
      upperKm = step.fromDistanceKm + (width > 0 ? width : Math.max(step.fromDistanceKm, 1));
    }
    if (!(upperKm > 0)) continue;
    const area: CtrArea = step.maxHeightAglM > 0 ? "aussen" : "innen";
    const color = ctrBandColor(area, step.maxHeightAglM);
    rings.push({
      radiusM: upperKm * M_PER_KM,
      area,
      maxHeightAglM: step.maxHeightAglM,
      label: describeCtrBand(area, step.maxHeightAglM, step),
      strokeColor: color.stroke,
      fillColor: color.fill,
      fillOpacity: color.fillOpacity,
      strokeOpacity: color.strokeOpacity,
    });
  }
  return rings.sort((a, b) => b.radiusM - a.radiusM);
}

export { M_PER_KM };
