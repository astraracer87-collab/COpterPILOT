// Cinematic-Vorschau: Wolkenmeer-/Hochnebel-Score (rein, RN-frei, unter tsx testbar).
//
// Idee: Ein Gipfel ragt über ein Nebel-/Hochnebelmeer, wenn im Tal (Referenz-
// punkt) die untere Luftschicht gesättigt ist, darüber eine Inversion („Deckel“)
// mit trockener Luft liegt und der Gipfel deutlich über der Nebelobergrenze
// steht. Grundlage sind die Druckflächen-Daten von Open-Meteo (Modell ICON-D2):
// Temperatur, relative Feuchte und geopotentielle Höhe je Druckfläche.
//
// Das Ergebnis ist ein FILTER, keine Garantie: Die Modellhöhe der Nebel-
// obergrenze schwankt um ±100–200 m. Vor Ort prüfen (Sicht/VLOS, Luftraum,
// Geozonen).

import { computeSunElevation } from "../../shared/solar";

/** Druckflächen, die abgefragt werden (hPa). 800 hPa ≈ 2 km reicht für den Feldberg/Schwarzwald. */
export const CINEMATIC_PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800] as const;

/** Bodennahe Größen je Punkt (Tal + Gipfel teilen sich eine Abfrage, daher dieselbe Liste). */
export const CINEMATIC_SURFACE_VARS = [
  "relative_humidity_2m",
  "temperature_2m",
  "dew_point_2m",
  "cloud_cover_low",
  "visibility",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "direct_radiation",
] as const;

export const CINEMATIC_FORECAST_HOURS = 30;

/** Liste der stündlichen Variablen für die Open-Meteo-Abfrage (bewusst schlank). */
export function cinematicHourlyVars(): string[] {
  const out: string[] = [];
  for (const p of CINEMATIC_PRESSURE_LEVELS) {
    out.push(`temperature_${p}hPa`, `relative_humidity_${p}hPa`, `geopotential_height_${p}hPa`);
  }
  out.push(...CINEMATIC_SURFACE_VARS);
  return out;
}

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Eine Abfrage für viele Punkte (Open-Meteo akzeptiert kommagetrennte Listen). */
export function buildCinematicForecastUrl(points: LatLon[], hours: number = CINEMATIC_FORECAST_HOURS): string {
  const lat = points.map((p) => p.latitude.toFixed(4)).join(",");
  const lon = points.map((p) => p.longitude.toFixed(4)).join(",");
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    `hourly=${cinematicHourlyVars().join(",")}`,
    "models=icon_d2",
    `forecast_hours=${hours}`,
    "timeformat=unixtime",
    "wind_speed_unit=ms",
    "timezone=Europe%2FBerlin",
  ];
  return `https://api.open-meteo.com/v1/forecast?${params.join("&")}`;
}

// ───────────────────────────── Datenmodell ─────────────────────────────────

export interface LevelValue {
  /** Druckfläche hPa */
  p: number;
  /** Geopotentielle Höhe m ü. NN */
  z: number;
  /** Temperatur °C */
  tC: number;
  /** Relative Feuchte % */
  rh: number;
}

export interface PointHour {
  /** Zeit (ms, UTC) */
  t: number;
  levels: LevelValue[];
  rh2m?: number | null;
  t2m?: number | null;
  /** Taupunkt 2 m (°C) */
  td2m?: number | null;
  cloudLow?: number | null;
  visibility?: number | null;
  precip?: number | null;
  wind?: number | null;
  gust?: number | null;
  directRad?: number | null;
}

export interface PointForecast {
  latitude: number;
  longitude: number;
  /** Modell-Geländehöhe (m) */
  elevation: number;
  hours: PointHour[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Eine Location aus der Open-Meteo-Antwort (Objekt oder Array-Element) umwandeln. */
export function parseOpenMeteoPoint(raw: unknown): PointForecast | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const h = r.hourly as Record<string, unknown[]> | undefined;
  if (!h || !Array.isArray(h.time)) return null;
  const lat = num(r.latitude);
  const lon = num(r.longitude);
  if (lat == null || lon == null) return null;
  const col = (k: string, i: number) => (Array.isArray(h[k]) ? num(h[k][i]) : null);
  const hours: PointHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const tRaw = h.time[i];
    const t = typeof tRaw === "number" ? tRaw * 1000 : Date.parse(String(tRaw));
    if (!Number.isFinite(t)) continue;
    const levels: LevelValue[] = [];
    for (const p of CINEMATIC_PRESSURE_LEVELS) {
      const z = col(`geopotential_height_${p}hPa`, i);
      const tC = col(`temperature_${p}hPa`, i);
      const rh = col(`relative_humidity_${p}hPa`, i);
      // gerundet: hält den Zwischenspeicher klein
      if (z != null && tC != null && rh != null) levels.push({ p, z: Math.round(z), tC: Math.round(tC * 10) / 10, rh: Math.round(rh) });
    }
    hours.push({
      t,
      levels,
      rh2m: col("relative_humidity_2m", i),
      t2m: col("temperature_2m", i),
      td2m: col("dew_point_2m", i),
      cloudLow: col("cloud_cover_low", i),
      visibility: col("visibility", i),
      precip: col("precipitation", i),
      wind: col("wind_speed_10m", i),
      gust: col("wind_gusts_10m", i),
      directRad: col("direct_radiation", i),
    });
  }
  return { latitude: lat, longitude: lon, elevation: num(r.elevation) ?? 0, hours };
}

/** Ganze Antwort (eine Location = Objekt, mehrere = Array) umwandeln. */
export function parseOpenMeteoMulti(json: unknown): (PointForecast | null)[] {
  const arr = Array.isArray(json) ? json : [json];
  return arr.map(parseOpenMeteoPoint);
}

// ───────────────────────────── Profil & Nebel ──────────────────────────────

export interface ProfilePoint {
  z: number;
  tC: number;
  rh: number;
}

/** Profil des Talpunkts: Boden (2 m) + Druckflächen über Grund, nach Höhe sortiert. */
export function buildProfile(hour: PointHour, groundElevation: number): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  if (hour.t2m != null && hour.rh2m != null) pts.push({ z: groundElevation + 2, tC: hour.t2m, rh: hour.rh2m });
  for (const l of hour.levels) {
    // Unter Grund extrapolierte Druckflächen (z. B. 1000 hPa im Mittelgebirge) verwerfen
    if (l.z <= groundElevation + 20) continue;
    pts.push({ z: l.z, tC: l.tC, rh: l.rh });
  }
  return pts.sort((a, b) => a.z - b.z);
}

/** Lineare Interpolation eines Werts im Profil auf Höhe z (außerhalb: Randwert). */
export function interpolateAt(profile: ProfilePoint[], z: number, key: "tC" | "rh"): number | null {
  if (profile.length === 0) return null;
  if (z <= profile[0].z) return profile[0][key];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (z <= b.z) {
      const f = (z - a.z) / Math.max(1, b.z - a.z);
      return a[key] + f * (b[key] - a[key]);
    }
  }
  return profile[profile.length - 1][key];
}

export const RH_SATURATED = 95;
export const RH_WEAK = 93;

export interface FogLayer {
  /** Interpolierte Obergrenze der gesättigten Schicht (m ü. NN) */
  topM: number;
  /** Untergrenze (Boden oder Stratus-Untergrenze) */
  baseM: number;
  /** true = Schicht reicht bis zur obersten Druckfläche (Obergrenze unbekannt) */
  unbounded: boolean;
  /** stark = RH ≥ 95 %, schwach = 93–95 % */
  strength: "strong" | "weak";
  /** Index der obersten gesättigten Profilstufe */
  topIndex: number;
}

/**
 * Nebel-/Hochnebelschicht von unten: erste gesättigte Stufe in den unteren
 * 1200 m über Grund; sie muss am Boden liegen ODER der Talpunkt meldet tiefe
 * Wolken ≥ 60 % bzw. Sicht < 1500 m. Danach zusammenhängend nach oben.
 */
export function findFogLayer(profile: ProfilePoint[], hour: PointHour, groundElevation: number): FogLayer | null {
  if (profile.length < 2) return null;
  const lowCloud = (hour.cloudLow ?? 0) >= 60;
  const lowVis = hour.visibility != null && hour.visibility < 1500;
  let i0 = -1;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i].z > groundElevation + 1200) break;
    if (profile[i].rh >= RH_WEAK) {
      i0 = i;
      break;
    }
  }
  if (i0 < 0) return null;
  const atBottom = i0 === 0 || (i0 === 1 && profile[0].rh >= 88);
  if (!atBottom && !lowCloud && !lowVis) return null;
  let i1 = i0;
  while (i1 + 1 < profile.length && profile[i1 + 1].rh >= RH_WEAK) i1++;
  let minRh = 100;
  for (let i = i0; i <= i1; i++) minRh = Math.min(minRh, profile[i].rh);
  const strength: FogLayer["strength"] = minRh >= RH_SATURATED || lowCloud || lowVis ? "strong" : "weak";
  const baseM = i0 === 0 ? groundElevation : profile[i0 - 1].z + (profile[i0].z - profile[i0 - 1].z) / 2;
  if (i1 === profile.length - 1) {
    return { topM: profile[i1].z, baseM, unbounded: true, strength, topIndex: i1 };
  }
  // Obergrenze: dort, wo RH die Schwelle (94 %) unterschreitet
  const a = profile[i1];
  const b = profile[i1 + 1];
  const thr = 94;
  let f = a.rh === b.rh ? 0.5 : (a.rh - thr) / (a.rh - b.rh);
  f = Math.max(0, Math.min(1, f));
  return { topM: a.z + f * (b.z - a.z), baseM, unbounded: false, strength, topIndex: i1 };
}

export interface InversionInfo {
  /** Temperaturzunahme über der Nebelobergrenze (K, max. innerhalb 600 m); < 0 = normale Abnahme */
  strengthK: number;
  /** Feuchteabnahme (Prozentpunkte) über der Obergrenze */
  rhDropPp: number;
  /** Deckel: ΔT ≥ 0 und RH-Abfall ≥ 15 pp */
  lid: boolean;
  /** Kräftiger Deckel: ΔT ≥ 2 K und RH-Abfall ≥ 25 pp */
  strong: boolean;
}

export function analyzeInversion(profile: ProfilePoint[], layer: FogLayer): InversionInfo {
  const ref = profile[layer.topIndex];
  let maxT = -Infinity;
  let minRh = Infinity;
  for (let j = layer.topIndex + 1; j < profile.length; j++) {
    if (profile[j].z > ref.z + 650) break;
    maxT = Math.max(maxT, profile[j].tC);
    minRh = Math.min(minRh, profile[j].rh);
  }
  if (!Number.isFinite(maxT)) return { strengthK: 0, rhDropPp: 0, lid: false, strong: false };
  const strengthK = Math.round((maxT - ref.tC) * 10) / 10;
  const rhDropPp = Math.round(ref.rh - minRh);
  const lid = strengthK >= 0 && rhDropPp >= 15;
  return { strengthK, rhDropPp, lid, strong: lid && strengthK >= 2 && rhDropPp >= 25 };
}

// ───────────────────────────── Score ───────────────────────────────────────

export interface CinematicSpotInput {
  latitude: number;
  longitude: number;
  /** Reale Gipfelhöhe (m ü. NN) */
  elevationM: number;
}

export interface ScoreOptions {
  /** Böengrenze der Drohne (m/s), Standard 10 */
  maxGustMs?: number;
}

export type CinematicLabel = "Wolkenmeer sehr wahrscheinlich" | "Wolkenmeer möglich" | "Wolkenmeer unwahrscheinlich";

export interface HourScore {
  t: number;
  score: number;
  label: CinematicLabel;
  reasons: string[];
  fogTopM: number | null;
  clearanceM: number | null;
  inversionStrengthK: number | null;
  /** Wolkenuntergrenze im Tal (m über Grund) nach Spread-Formel (T − Td) × 122 m; 0 = Bodennebel */
  cloudBaseAglM: number | null;
  /** Spread T_2m − Td_2m im Tal (K) */
  spreadK: number | null;
  /** Tiefe Wolken im Tal (%) */
  valleyCloudLow: number | null;
  /** Sicht im Tal (m) */
  valleyVisibility: number | null;
  /** Feuchte in Gipfelhöhe (%), aus dem Talprofil */
  summitRh: number | null;
  /** Temperatur in Gipfelhöhe (°C) */
  summitTempC: number | null;
  gustMs: number | null;
  windMs: number | null;
  light: "golden" | "day" | "twilight" | "night";
  /** Gegenprobe mit der DWD-Stationsvorhersage (falls Station zugeordnet) */
  dwd?: "confirms" | "contradicts" | null;
}

export function labelForScore(score: number): CinematicLabel {
  if (score >= 70) return "Wolkenmeer sehr wahrscheinlich";
  if (score >= 40) return "Wolkenmeer möglich";
  return "Wolkenmeer unwahrscheinlich";
}

/** Stückweise lineare Interpolation über Stützstellen [x, y]. */
function piecewise(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

/** Abstand Gipfel ↔ Nebelobergrenze → Faktor (Modellfehler ±100–200 m). */
export function clearanceFactor(clearanceM: number): number {
  return piecewise(clearanceM, [
    [0, 0],
    [50, 0.15],
    [150, 0.85],
    [250, 1],
    [700, 1],
    [1100, 0.75],
  ]);
}

function lightClass(sunElevDeg: number): HourScore["light"] {
  if (sunElevDeg < -6) return "night";
  if (sunElevDeg < -1) return "twilight";
  if (sunElevDeg <= 8) return "golden";
  return "day";
}

/** Eine Nachkommastelle, deutsches Komma */
function de1(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

function valleyInfoText(spreadK: number | null, hour: PointHour): string {
  const parts: string[] = [];
  if (spreadK != null) parts.push(`Spread ${de1(spreadK)} K`);
  if (hour.cloudLow != null) parts.push(`tiefe Wolken ${Math.round(hour.cloudLow)} %`);
  if (hour.visibility != null) parts.push(`Sicht ${hour.visibility >= 10000 ? `${Math.round(hour.visibility / 1000)} km` : `${de1(hour.visibility / 1000)} km`}`);
  return parts.join(", ") || "keine Talwerte";
}

function fmt0(v: number): string {
  return String(Math.round(v));
}

/** Meter je Kelvin Spread (Faustformel 400 ft/K ≈ 122 m/K). */
export const SPREAD_M_PER_K = 122;

/** Wolkenuntergrenze über Grund nach der Spread-Formel; null ohne Daten. */
export function spreadCloudBaseAgl(t2m: number | null | undefined, td2m: number | null | undefined): number | null {
  if (t2m == null || td2m == null) return null;
  return Math.max(0, Math.round((t2m - td2m) * SPREAD_M_PER_K));
}

export type ValleyFogConfirmation = "confirmed" | "partial" | "none";

/**
 * Bestätigt der Talpunkt eine echte Nebel-/Stratusschicht? Kleiner Spread
 * (≤ 2 K → Untergrenze ≤ ~250 m) zusammen mit tiefen Wolken/schlechter Sicht
 * bestätigt; großer Spread bei wolkenfreiem Tal und guter Sicht heißt: kein
 * Nebelmeer – auch wenn darüber eine Inversion liegt.
 */
export function valleyFogConfirmation(hour: PointHour): ValleyFogConfirmation {
  const cl = hour.cloudLow ?? null;
  const vis = hour.visibility ?? null;
  const spread = hour.t2m != null && hour.td2m != null ? hour.t2m - hour.td2m : null;
  if ((cl != null && cl >= 60) || (vis != null && vis < 1500)) return "confirmed";
  if (spread != null && spread <= 2 && ((cl != null && cl >= 30) || (vis != null && vis < 5000))) return "confirmed";
  if ((cl != null && cl >= 25) || (vis != null && vis < 5000) || (spread != null && spread <= 1)) return "partial";
  return "none";
}

/** Temperaturzunahme mit der Höhe irgendwo in den unteren 1500 m über Grund? */
function hasInversionAloft(profile: ProfilePoint[], groundElevation: number): boolean {
  for (let i = 1; i < profile.length; i++) {
    if (profile[i].z > groundElevation + 1500) break;
    if (profile[i].tC - profile[i - 1].tC >= 0.5) return true;
  }
  return false;
}

/**
 * Score einer Stunde. `valley` und `summit` müssen dieselbe Stunde betreffen.
 * `summitGridElevation` = Modell-Geländehöhe des Gipfelpunkts (meist tiefer
 * als der reale Gipfel).
 */
export function scoreHour(
  spot: CinematicSpotInput,
  valley: PointHour,
  valleyElevation: number,
  summit: PointHour | null,
  summitGridElevation: number | null,
  opts: ScoreOptions = {},
): HourScore {
  const maxGust = opts.maxGustMs ?? 10;
  const reasons: string[] = [];
  const profile = buildProfile(valley, valleyElevation);
  // Stundenwert gilt für die Stunde → Sonnenstand zur halben Stunde
  const light = lightClass(computeSunElevation(spot.latitude, spot.longitude, new Date(valley.t + 1800_000)));
  const summitRhProfile = interpolateAt(profile, spot.elevationM, "rh");
  const summitTemp = interpolateAt(profile, spot.elevationM, "tC");
  const gust = summit?.gust ?? null;
  const wind = summit?.wind ?? null;
  const spreadK = valley.t2m != null && valley.td2m != null ? Math.round((valley.t2m - valley.td2m) * 10) / 10 : null;
  const base: Omit<HourScore, "score" | "label" | "reasons" | "fogTopM" | "clearanceM" | "inversionStrengthK"> = {
    t: valley.t,
    cloudBaseAglM: spreadCloudBaseAgl(valley.t2m, valley.td2m),
    spreadK,
    valleyCloudLow: valley.cloudLow ?? null,
    valleyVisibility: valley.visibility ?? null,
    summitRh: summitRhProfile != null ? Math.round(summitRhProfile) : null,
    summitTempC: summitTemp != null ? Math.round(summitTemp * 10) / 10 : null,
    gustMs: gust,
    windMs: wind,
    light,
  };
  const zero = (why: string, extra: Partial<HourScore> = {}): HourScore => ({
    ...base,
    score: 0,
    label: labelForScore(0),
    reasons: [...reasons, why],
    fogTopM: null,
    clearanceM: null,
    inversionStrengthK: null,
    ...extra,
  });

  if (profile.length < 3) return zero("Keine Höhendaten für das Tal");
  const confirm = valleyFogConfirmation(valley);
  const valleyInfo = valleyInfoText(spreadK, valley);
  const layer = findFogLayer(profile, valley, valleyElevation);
  if (!layer) {
    return zero(
      hasInversionAloft(profile, valleyElevation)
        ? `Inversion vorhanden, aber kein Nebel darunter vorhergesagt (${valleyInfo})`
        : `Kein Nebel/Hochnebel im Tal erwartet (${valleyInfo})`,
    );
  }
  const fogTopM = Math.round(layer.topM);
  const inv = analyzeInversion(profile, layer);
  const clearanceM = Math.round(spot.elevationM - layer.topM);
  const extra = { fogTopM, clearanceM, inversionStrengthK: inv.strengthK };

  if (layer.unbounded) return zero("Feuchte Schicht reicht über den Gipfel", extra);
  if (clearanceM <= 0) return zero(`Gipfel im Nebel (Obergrenze ~${fogTopM} m)`, extra);

  // Nebel-/Stratusschicht
  let fogF = layer.strength === "strong" ? 1 : 0.7;
  // Gegenprobe am Talpunkt (Spread, tiefe Wolken, Sicht)
  if (confirm === "none") {
    fogF *= 0.15;
    reasons.push(
      inv.lid || inv.strengthK > 0
        ? `Inversion vorhanden, aber kein Nebel darunter vorhergesagt (${valleyInfo})`
        : `Tal voraussichtlich nebelfrei (${valleyInfo})`,
    );
  } else if (confirm === "partial") {
    fogF *= 0.6;
    reasons.push(`Nebel im Tal unsicher (${valleyInfo})`);
  }
  const thickness = layer.topM - layer.baseM;
  if (thickness < 100) fogF *= 0.8;
  reasons.push(
    confirm === "none"
      ? `Feuchte Schicht im Profil bis ~${fogTopM} m`
      : layer.strength === "strong"
        ? `Nebel/Hochnebel bis ~${fogTopM} m`
        : `Feuchte Dunstschicht bis ~${fogTopM} m (schwach gesättigt)`,
  );

  // Deckel (Inversion)
  let lidF: number;
  if (inv.strong) {
    lidF = 1;
    reasons.push(`Kräftige Inversion (+${de1(inv.strengthK)} K, trockene Luft darüber)`);
  } else if (inv.lid) {
    lidF = 0.85;
    reasons.push(`Inversion/Deckel (${inv.strengthK >= 0 ? "+" : ""}${de1(inv.strengthK)} K)`);
  } else if (inv.rhDropPp >= 15) {
    lidF = 0.55;
    reasons.push("Trockenere Luft darüber, aber keine Inversion");
  } else {
    lidF = 0.3;
    reasons.push("Kein Deckel – Luft gut durchmischt");
  }

  // Abstand
  const clearF = clearanceFactor(clearanceM);
  if (clearanceM < 150) reasons.push(`Gipfel nur ~${clearanceM} m über der Obergrenze (Modellfehler ±150 m)`);
  else if (clearanceM > 700) reasons.push(`Nebelmeer weit unter dem Gipfel (~${clearanceM} m)`);
  else reasons.push(`Gipfel ~${clearanceM} m über dem Nebel`);

  // Gipfelbedingungen
  let summitF = 1;
  let summitRh = summitRhProfile ?? 0;
  // Gipfel-Gitterpunkt nur heranziehen, wenn er sicher über der Nebelobergrenze liegt
  const gridAbove = summit && summitGridElevation != null && summitGridElevation >= layer.topM + 50;
  if (gridAbove && summit!.rh2m != null) summitRh = Math.max(summitRh, summit!.rh2m);
  if (gridAbove && summit!.visibility != null && summit!.visibility < 1500) {
    summitF *= 0.2;
    reasons.push("Gipfel voraussichtlich in Wolken (Sicht < 1,5 km)");
  } else if (summitRh >= RH_WEAK) {
    summitF *= 0.15;
    reasons.push(`Gipfel feucht (${fmt0(summitRh)} %) – evtl. in Wolken`);
  } else if (summitRh >= 85) {
    summitF *= 0.6;
    reasons.push(`Feuchte am Gipfel ${fmt0(summitRh)} %`);
  }

  const precip = summit?.precip ?? valley.precip ?? 0;
  let precipF = 1;
  if (precip >= 0.5) {
    precipF = 0.1;
    reasons.push(`Niederschlag (${de1(precip)} mm/h)`);
  } else if (precip >= 0.1) {
    precipF = 0.4;
    reasons.push("Leichter Niederschlag");
  }

  let windF = 1;
  if (gust != null) {
    if (gust > maxGust * 1.5) {
      windF = 0.1;
      reasons.push(`Sturmböen ${gust.toFixed(0)} m/s am Gipfel`);
    } else if (gust > maxGust) {
      windF = 0.3;
      reasons.push(`Böen ${gust.toFixed(0)} m/s über Drohnenlimit (${maxGust} m/s)`);
    } else if (gust > maxGust * 0.7) {
      windF = piecewise(gust, [
        [maxGust * 0.7, 1],
        [maxGust, 0.65],
      ]);
      reasons.push(`Böen ${gust.toFixed(0)} m/s – nahe am Limit`);
    }
  }

  // Licht
  let lightAdj = 0;
  if (light === "golden") {
    lightAdj = 12;
    reasons.push("Goldene Stunde (Sonnenauf-/-untergang)");
  } else if (light === "day") {
    lightAdj = (summit?.directRad ?? 0) > 0 ? 6 : 2;
    if ((summit?.directRad ?? 0) > 0) reasons.push("Sonne am Gipfel");
  } else if (light === "twilight") {
    lightAdj = 0;
    reasons.push("Dämmerung");
  } else {
    lightAdj = -28;
    reasons.push("Nacht – kaum Licht (Nachtflugregeln beachten)");
  }

  const product = fogF * lidF * clearF * summitF * precipF * windF;
  const score = Math.max(0, Math.min(100, Math.round(product * (88 + lightAdj))));
  return { ...base, score, label: labelForScore(score), reasons, ...extra };
}

/** Alle gemeinsamen Stunden von Tal- und Gipfelpunkt bewerten (ab `fromMs`, max. `hours`). */
export function scoreSpotHours(
  spot: CinematicSpotInput,
  valley: PointForecast,
  summit: PointForecast | null,
  opts: ScoreOptions & { fromMs?: number; hours?: number } = {},
): HourScore[] {
  const from = opts.fromMs ?? -Infinity;
  const maxH = opts.hours ?? 24;
  const summitByT = new Map<number, PointHour>();
  for (const h of summit?.hours ?? []) summitByT.set(h.t, h);
  const out: HourScore[] = [];
  for (const h of valley.hours) {
    // laufende Stunde mitnehmen (Beginn bis 59 min zurück)
    if (h.t < from - 3600_000 + 1) continue;
    out.push(scoreHour(spot, h, valley.elevation, summitByT.get(h.t) ?? null, summit?.elevation ?? null, opts));
    if (out.length >= maxH) break;
  }
  return out;
}

export interface ScoreWindow {
  startMs: number;
  /** Ende (exklusiv) = Beginn der letzten Stunde + 1 h */
  endMs: number;
  peakScore: number;
  peakMs: number;
  avgScore: number;
  hours: number;
}

/**
 * Bestes Fenster: zusammenhängende Stunden mit Score ≥ `threshold`; gewählt
 * wird das mit dem höchsten Spitzenwert (bei Gleichstand das längere/frühere).
 */
export function findBestWindow(hours: HourScore[], threshold: number): ScoreWindow | null {
  let best: ScoreWindow | null = null;
  let i = 0;
  while (i < hours.length) {
    if (hours[i].score < threshold) {
      i++;
      continue;
    }
    let j = i;
    let peak = hours[i];
    let sum = 0;
    while (j < hours.length && hours[j].score >= threshold && (j === i || hours[j].t - hours[j - 1].t <= 3600_000)) {
      if (hours[j].score > peak.score) peak = hours[j];
      sum += hours[j].score;
      j++;
    }
    const w: ScoreWindow = {
      startMs: hours[i].t,
      endMs: hours[j - 1].t + 3600_000,
      peakScore: peak.score,
      peakMs: peak.t,
      avgScore: Math.round(sum / (j - i)),
      hours: j - i,
    };
    if (!best || w.peakScore > best.peakScore || (w.peakScore === best.peakScore && w.hours > best.hours)) best = w;
    i = j;
  }
  return best;
}

// ───────────────────────────── Formatierung ────────────────────────────────

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function hh(d: Date): string {
  return String(d.getHours()).padStart(2, "0");
}

/** „Sa 06–09 Uhr“ (lokale Zeit des Geräts) */
export function formatWindow(w: { startMs: number; endMs: number }): string {
  const s = new Date(w.startMs);
  const e = new Date(w.endMs);
  return `${WEEKDAYS[s.getDay()]} ${hh(s)}–${hh(e)} Uhr`;
}

/** „Sa 06 Uhr“ */
export function formatHour(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${hh(d)} Uhr`;
}

// ───────────────────────────── Kompakte Speicherform ───────────────────────

/** Kompakt für den Zwischenspeicher: je Stunde ein Zahlen-Tupel statt Objekten. */
export interface CompactPointForecast {
  la: number;
  lo: number;
  el: number;
  /** [t, rh2m, t2m, td2m, cloudLow, visibility, precip, wind, gust, directRad, (z, tC, rh) je Druckfläche] */
  h: (number | null)[][];
}

const SURFACE_KEYS = ["rh2m", "t2m", "td2m", "cloudLow", "visibility", "precip", "wind", "gust", "directRad"] as const;

export function compactPoint(p: PointForecast): CompactPointForecast {
  return {
    la: p.latitude,
    lo: p.longitude,
    el: p.elevation,
    h: p.hours.map((hr) => {
      const row: (number | null)[] = [hr.t, ...SURFACE_KEYS.map((k) => hr[k] ?? null)];
      for (const lv of CINEMATIC_PRESSURE_LEVELS) {
        const l = hr.levels.find((x) => x.p === lv);
        row.push(l ? l.z : null, l ? l.tC : null, l ? l.rh : null);
      }
      return row;
    }),
  };
}

export function expandPoint(c: CompactPointForecast): PointForecast {
  return {
    latitude: c.la,
    longitude: c.lo,
    elevation: c.el,
    hours: c.h.map((row) => {
      const hr: PointHour = { t: Number(row[0]), levels: [] };
      SURFACE_KEYS.forEach((k, i) => {
        hr[k] = row[i + 1] ?? null;
      });
      CINEMATIC_PRESSURE_LEVELS.forEach((p, i) => {
        const o = 1 + SURFACE_KEYS.length + i * 3;
        const z = row[o];
        const tC = row[o + 1];
        const rh = row[o + 2];
        if (z != null && tC != null && rh != null) hr.levels.push({ p, z, tC, rh });
      });
      return hr;
    }),
  };
}

// ───────────────────────────── DWD-Stationsvorhersage (Gegenprobe) ─────────

/**
 * DWD-App-Endpunkt (warnwetter, ohne Schlüssel), alle Stationen in EINER
 * Abfrage. Werte in Zehnteln: temperature/dewPoint2m 0,1 °C, humidity 0,1 %,
 * sunshine 0,1 min je Stunde; forecast1 = Beginn (ms) + Stundenschritt.
 */
export const DWD_STATION_OVERVIEW_URL = "https://app-prod-ws.warnwetter.de/v30/stationOverviewExtended";

export function buildDwdStationUrl(ids: string[]): string {
  return `${DWD_STATION_OVERVIEW_URL}?stationIds=${ids.map(encodeURIComponent).join(",")}`;
}

export interface DwdStationForecast {
  start: number;
  step: number;
  /** % */
  humidity: (number | null)[];
  /** °C */
  temperature: (number | null)[];
  /** °C */
  dewPoint: (number | null)[];
  /** min Sonnenschein je Stunde */
  sunshine: (number | null)[];
}

export interface DwdHour {
  humidity: number | null;
  temperature: number | null;
  dewPoint: number | null;
  sunshineMin: number | null;
}

function tenths(arr: unknown): (number | null)[] {
  if (!Array.isArray(arr)) return [];
  // 32767 = fehlender Wert
  return arr.map((v) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 32000 ? v / 10 : null));
}

export function parseDwdStationOverview(json: unknown): Record<string, DwdStationForecast> {
  const out: Record<string, DwdStationForecast> = {};
  if (!json || typeof json !== "object") return out;
  for (const [id, v] of Object.entries(json as Record<string, any>)) {
    const f = v?.forecast1;
    if (!f || typeof f.start !== "number") continue;
    out[id] = {
      start: f.start,
      step: typeof f.timeStep === "number" && f.timeStep > 0 ? f.timeStep : 3600_000,
      humidity: tenths(f.humidity),
      temperature: tenths(f.temperature),
      dewPoint: tenths(f.dewPoint2m),
      sunshine: tenths(f.sunshine),
    };
  }
  return out;
}

/** Werte der Stunde, die bei `t` beginnt (null, wenn außerhalb). */
export function dwdHourAt(f: DwdStationForecast | undefined, t: number): DwdHour | null {
  if (!f) return null;
  const i = Math.round((t - f.start) / f.step);
  if (i < 0 || i >= f.humidity.length) return null;
  const h: DwdHour = {
    humidity: f.humidity[i] ?? null,
    temperature: f.temperature[i] ?? null,
    dewPoint: f.dewPoint[i] ?? null,
    sunshineMin: f.sunshine[i] ?? null,
  };
  return h.humidity == null ? null : h;
}

/**
 * Gegenprobe mit der DWD-Stationsvorhersage: Gipfel trocken (< 85 %, tagsüber
 * mit Sonne) und Tal gesättigt (≥ 95 % bzw. Spread ≤ 1 K) bestätigt; Gipfel in
 * Wolken (≥ 95 %) oder trockenes Tal (< 85 %, Spread > 2 K) widerspricht und
 * dämpft den Score.
 */
export function applyDwdCrossCheck(h: HourScore, summit: DwdHour | null, valley: DwdHour | null): HourScore {
  if (!summit && !valley) return h;
  if (h.score <= 0) return { ...h, dwd: null };
  const sRh = summit?.humidity ?? null;
  const vRh = valley?.humidity ?? null;
  const vSpread = valley && valley.temperature != null && valley.dewPoint != null ? valley.temperature - valley.dewPoint : null;
  const parts: string[] = [];
  if (sRh != null) parts.push(`Gipfel ${Math.round(sRh)} %`);
  if (vRh != null) parts.push(`Tal ${Math.round(vRh)} %`);
  const info = parts.join(", ");
  const summitInCloud = sRh != null && sRh >= 95;
  const valleyDry = vRh != null && vRh < 85 && (vSpread == null || vSpread > 2);
  if (summitInCloud || valleyDry) {
    const score = Math.round(h.score * 0.35);
    return {
      ...h,
      score,
      label: labelForScore(score),
      dwd: "contradicts",
      reasons: [...h.reasons, `DWD-Stationsvorhersage widerspricht (${info})`],
    };
  }
  const isDayHour = h.light === "day" || h.light === "golden";
  const summitOk = sRh != null && sRh < 85 && (!isDayHour || (summit?.sunshineMin ?? 0) > 0);
  const valleyOk = valley == null || (vRh != null && vRh >= 95) || (vSpread != null && vSpread <= 1);
  if (summitOk && valleyOk && h.score >= 25) {
    const score = Math.min(100, Math.round(h.score * 1.05));
    return {
      ...h,
      score,
      label: labelForScore(score),
      dwd: "confirms",
      reasons: [...h.reasons, `DWD-Stationsvorhersage bestätigt (${info})`],
    };
  }
  return { ...h, dwd: null };
}
