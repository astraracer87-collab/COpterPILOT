/**
 * ND-Filter Finder nach der 180°-Shutter-Regel.
 *
 * Zielshutter = 1 / (2 · fps). Daraus + gemessenem/geschätztem Shutter
 * der Drohne ergibt sich die nötige Lichtreduktion in Blenden­stufen
 * (Stops) und damit die passende ND-Stärke (ND2 … ND1000).
 *
 * Reine Funktionen ohne UI-Abhängigkeiten — leicht testbar.
 */

export const STANDARD_ND_VALUES = [2, 4, 8, 16, 32, 64, 128, 256, 400, 1000] as const;

export type NdValue = (typeof STANDARD_ND_VALUES)[number];

export const SHUTTER_FPS_OPTIONS = [24, 25, 30, 50, 60, 120] as const;
export type ShutterFps = (typeof SHUTTER_FPS_OPTIONS)[number];

/** Manuell wählbare Shutter-Nenner (1/x) im UI-Slider. */
export const MANUAL_SHUTTER_DENOMS = [
  100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000,
  1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12500, 16000,
];

export interface NdRecommendation {
  /** Empfohlener Standard-ND-Wert (z. B. 8 für ND8). null = kein Filter nötig. */
  ndValue: NdValue | null;
  /** Zielshutter-Nenner (1/x), z. B. 48 für 24 fps. */
  targetShutterDenom: number;
  /** Roher (idealer) ND-Faktor vor dem Snap auf Standardwerte. */
  rawNdFactor: number;
  /** Berechnete Stops (log2(measured/target)). Negativ = zu wenig Licht. */
  stops: number;
  /**
   * Empfohlener Wert ist nicht im Ökosystem der Drohne enthalten —
   * nächstgrößeres verfügbares Filter wurde gewählt.
   */
  ecosystemMismatch: boolean;
  /** Welcher konkrete Wert aus dem Ökosystem ausgewählt wurde (falls vorhanden). */
  ecosystemPick: NdValue | null;
  /** Klartext-Erklärung für die UI. */
  reasoning: string;
}

/**
 * Zielshutter-Nenner nach der Shutter-Winkel-Regel.
 *
 * 180° (Cinematic-Default) → 1/(2·fps), natürlicher Kino-Blur.
 * 270° (FPV-Look)          → 1/(1.333·fps), stärkerer Motion-Blur,
 *                            kaschiert Vibrationen und Prop-Wash bei
 *                            schnellen Manövern (typisch für FPV Racing
 *                            und Freestyle).
 * 360° (Maximaler Blur)    → 1/fps, alles maximal verschmiert.
 *
 * Formel: targetDenom = fps · 360 / shutterAngleDeg
 */
export function computeTargetShutterDenom(fps: number, shutterAngleDeg: number = 180): number {
  const angle = shutterAngleDeg > 0 ? shutterAngleDeg : 180;
  return (fps * 360) / angle;
}

export const SHUTTER_ANGLES = [180, 270, 360] as const;
export type ShutterAngle = (typeof SHUTTER_ANGLES)[number];

/** log2(measured / target) — Anzahl Stops, die das ND-Filter „wegnehmen" muss. */
export function computeStops(targetDenom: number, measuredDenom: number): number {
  if (targetDenom <= 0 || measuredDenom <= 0) return 0;
  return Math.log2(measuredDenom / targetDenom);
}

function parseFilterEcosystem(eco: string[] | undefined): NdValue[] {
  if (!eco || eco.length === 0) return [];
  const out: NdValue[] = [];
  for (const raw of eco) {
    const m = raw.match(/(\d+)/);
    if (!m) continue;
    const n = Number(m[1]);
    if ((STANDARD_ND_VALUES as readonly number[]).includes(n)) {
      out.push(n as NdValue);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function nearestFromList(target: number, list: readonly number[]): number {
  let best = list[0];
  let bestDiff = Math.abs(list[0] - target);
  for (const v of list) {
    const d = Math.abs(v - target);
    if (d < bestDiff) { best = v; bestDiff = d; }
  }
  return best;
}

function nextLargerOrEqual(target: number, list: readonly number[]): number | null {
  for (const v of list) {
    if (v >= target) return v;
  }
  return null;
}

/**
 * Berechnet die ND-Empfehlung. Wenn ein `ecosystem` (z. B. herstellerseitig
 * verfügbare Filter) übergeben wird und der Standard-Snap nicht enthalten
 * ist, wird auf das nächstgrößere verfügbare Filter aufgerundet und
 * `ecosystemMismatch=true` zurückgegeben.
 */
export interface RoundResult {
  ndValue: NdValue | null;
  rawFactor: number;
  ecosystemMismatch: boolean;
  ecosystemPick: NdValue | null;
}

export function roundToStandardNd(
  stops: number,
  ecosystem?: string[] | NdValue[] | null,
): RoundResult {
  // < ~1 Stop Differenz → kein Filter nötig.
  if (stops < 1) {
    return { ndValue: null, rawFactor: Math.pow(2, Math.max(0, stops)), ecosystemMismatch: false, ecosystemPick: null };
  }
  const raw = Math.pow(2, stops);
  const snap = nearestFromList(raw, STANDARD_ND_VALUES) as NdValue;

  let ecoList: NdValue[] | null = null;
  if (Array.isArray(ecosystem) && ecosystem.length > 0) {
    if (typeof ecosystem[0] === "number") {
      ecoList = (ecosystem as NdValue[]).slice().sort((a, b) => a - b);
    } else {
      ecoList = parseFilterEcosystem(ecosystem as string[]);
    }
  }

  if (ecoList && ecoList.length > 0) {
    if (ecoList.includes(snap)) {
      return { ndValue: snap, rawFactor: raw, ecosystemMismatch: false, ecosystemPick: snap };
    }
    const pick = (nextLargerOrEqual(snap, ecoList) ?? ecoList[ecoList.length - 1]) as NdValue;
    return { ndValue: snap, rawFactor: raw, ecosystemMismatch: true, ecosystemPick: pick };
  }

  return { ndValue: snap, rawFactor: raw, ecosystemMismatch: false, ecosystemPick: null };
}

export interface RecommendInput {
  fps: number;
  measuredShutterDenom: number;
  filterEcosystem?: string[] | null;
  /** Shutter-Winkel in Grad. 180° = Cinematic-Default, 270° = FPV-Look,
   *  360° = maximaler Motion-Blur. Beeinflusst den Zielshutter und damit
   *  die benötigte ND-Stärke direkt (270° ≈ +0.6 Stops dunkler als 180°). */
  shutterAngleDeg?: number;
}

export function recommendNd({ fps, measuredShutterDenom, filterEcosystem, shutterAngleDeg = 180 }: RecommendInput): NdRecommendation {
  const targetDenom = Math.round(computeTargetShutterDenom(fps, shutterAngleDeg));
  const stops = computeStops(targetDenom, measuredShutterDenom);
  const snap = roundToStandardNd(stops, filterEcosystem ?? undefined);

  const angleLabel = shutterAngleDeg === 180 ? "180°-Regel" : `${shutterAngleDeg}°-Shutter`;

  let reasoning: string;
  if (stops < 1) {
    const t = stops < 0
      ? `Die aktuelle Belichtung ist bereits dunkler als das Ziel — vermutlich zu wenig Licht. Kein ND nötig, ggf. ISO erhöhen.`
      : `Die Szene entspricht bereits dem Zielshutter 1/${targetDenom} (${angleLabel}). Kein Filter nötig.`;
    reasoning = t;
  } else if (snap.ecosystemMismatch && snap.ecosystemPick) {
    reasoning = `${stops.toFixed(1)} Stops Reduktion nötig → idealerweise ND${snap.ndValue} (${angleLabel}). ` +
      `Nicht im Filter-Ökosystem der Drohne — verwende ND${snap.ecosystemPick} (nächstgrößer verfügbar).`;
  } else {
    reasoning = `${stops.toFixed(1)} Stops Reduktion nötig → ND${snap.ndValue} (Zielshutter 1/${targetDenom}, ${angleLabel}).`;
  }

  return {
    ndValue: snap.ndValue,
    targetShutterDenom: targetDenom,
    rawNdFactor: snap.rawFactor,
    stops,
    ecosystemMismatch: snap.ecosystemMismatch,
    ecosystemPick: snap.ecosystemPick,
    reasoning,
  };
}

// ─── Auto-Schätzung: EV → Shutter ──────────────────────────────────────────────

export type SkyCondition = "clear" | "lightClouds" | "cloudy" | "overcast" | "rain" | "twilight" | "night";

/** Basis-EV (ISO 100, Sunny-16-Regel) für gegebene Himmelsbedingung bei hochstehender Sonne. */
const EV_BASE: Record<SkyCondition, number> = {
  clear: 15,
  lightClouds: 14,
  cloudy: 13,
  overcast: 12,
  rain: 11,
  twilight: 9,
  night: 4,
};

export function classifySky(cloudCoverPercent: number, rainMmPerH: number, sunElevationDeg: number): SkyCondition {
  if (sunElevationDeg < -6) return "night";
  if (sunElevationDeg < 0) return "twilight";
  if (rainMmPerH >= 0.3) return "rain";
  if (cloudCoverPercent >= 90) return "overcast";
  if (cloudCoverPercent >= 60) return "cloudy";
  if (cloudCoverPercent >= 25) return "lightClouds";
  return "clear";
}

/** Korrektur für niedrigen Sonnenstand (Sunny-16 gilt für ~Sonne > 45°). */
export function sunElevationEvOffset(elevationDeg: number): number {
  if (elevationDeg >= 45) return 0;
  if (elevationDeg >= 25) return -1;
  if (elevationDeg >= 10) return -2;
  if (elevationDeg >= 0) return -3;
  return 0; // Twilight/Night werden bereits über die Klassifikation abgebildet.
}

export function estimateEv(cloudCoverPercent: number, rainMmPerH: number, sunElevationDeg: number): number {
  const sky = classifySky(cloudCoverPercent, rainMmPerH, sunElevationDeg);
  const base = EV_BASE[sky];
  // Twilight/Night sind absolute Stützpunkte → keine Höhenkorrektur addieren.
  if (sky === "twilight" || sky === "night") return base;
  return base + sunElevationEvOffset(sunElevationDeg);
}

/**
 * EV (ISO 100) → Shutter-Nenner bei gegebener Blende.
 *   EV = log2(N² / t)   ⇒   1/t = 2^EV / N²
 */
export function shutterDenomFromEv(ev: number, apertureN: number): number {
  if (apertureN <= 0) return 1000;
  return Math.pow(2, ev) / (apertureN * apertureN);
}

/** Snap auf den nächsten Wert aus MANUAL_SHUTTER_DENOMS (für die UI-Anzeige). */
export function snapShutterDenom(denom: number): number {
  if (denom <= MANUAL_SHUTTER_DENOMS[0]) return MANUAL_SHUTTER_DENOMS[0];
  if (denom >= MANUAL_SHUTTER_DENOMS[MANUAL_SHUTTER_DENOMS.length - 1]) {
    return MANUAL_SHUTTER_DENOMS[MANUAL_SHUTTER_DENOMS.length - 1];
  }
  return nearestFromList(denom, MANUAL_SHUTTER_DENOMS);
}

// ─── Sonnenstand (vereinfachte NOAA-Näherung) ─────────────────────────────────

const DEG = Math.PI / 180;

function julianDay(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate() + (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600) / 24;
  let jy = y;
  let jm = m;
  if (m <= 2) { jy--; jm += 12; }
  const A = Math.floor(jy / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (jy + 4716)) + Math.floor(30.6001 * (jm + 1)) + d + B - 1524.5;
}

/** Sonnenhöhe in Grad über dem Horizont (vereinfacht, ±0.5°). */
export function sunElevationDeg(latDeg: number, lonDeg: number, date: Date = new Date()): number {
  const jd = julianDay(date);
  const n = jd - 2451545.0;
  const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  // Greenwich Mean Sidereal Time → Lokaler Stundenwinkel
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst + lonDeg / 15) % 24;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)); // Radians
  const raHours = ((ra * 12 / Math.PI) + 24) % 24;
  const haHours = lst - raHours;
  const ha = haHours * 15 * DEG;
  const latRad = latDeg * DEG;
  const sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;
}

export const SKY_LABEL_DE: Record<SkyCondition, string> = {
  clear: "Klar / Sonnig",
  lightClouds: "Leicht bewölkt",
  cloudy: "Bewölkt",
  overcast: "Bedeckt",
  rain: "Regen / sehr dunkel",
  twilight: "Dämmerung",
  night: "Nacht",
};
