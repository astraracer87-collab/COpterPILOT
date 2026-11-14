const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

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

function solarDeclination(jd: number): number {
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = 23.439 * DEG - 0.0000004 * n * DEG;
  return Math.asin(Math.sin(eps) * Math.sin(lambda));
}

function equationOfTime(jd: number): number {
  const n = jd - 2451545.0;
  const L = ((280.460 + 0.9856474 * n) % 360) * DEG;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = L + 1.915 * DEG * Math.sin(g) + 0.020 * DEG * Math.sin(2 * g);
  const eps = 23.439 * DEG - 0.0000004 * n * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  return (L - ra) * RAD * 4;
}

function hourAngle(lat: number, decl: number, altitude: number): number | null {
  const latRad = lat * DEG;
  const cosH = (Math.sin(altitude * DEG) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
  if (cosH > 1 || cosH < -1) return null;
  return Math.acos(cosH) * RAD;
}

function eventTime(jd: number, lat: number, lng: number, altitude: number, isRise: boolean): Date | null {
  const decl = solarDeclination(jd);
  const eot = equationOfTime(jd);
  const ha = hourAngle(lat, decl, altitude);
  if (ha === null) return null;
  const noon = 720 - 4 * lng - eot;
  const minutes = isRise ? noon - 4 * ha : noon + 4 * ha;

  const baseDate = new Date((jd - 2440587.5) * 86400000);
  const result = new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    0, 0, 0, 0
  ));
  result.setUTCMinutes(Math.round(minutes));
  return result;
}

export interface SolarTimes {
  civilDawnStart: Date | null;
  sunrise: Date | null;
  sunset: Date | null;
  civilDuskEnd: Date | null;
  nauticalDawnStart: Date | null;
  nauticalDuskEnd: Date | null;
  isDayNow: boolean;
  isCivilTwilightNow: boolean;
  isNightNow: boolean;
  dayLengthMinutes: number | null;
}

export function calculateSolarTimes(lat: number, lng: number, date?: Date): SolarTimes {
  const d = date || new Date();
  const jd = julianDay(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0)));

  const sunrise = eventTime(jd, lat, lng, -0.833, true);
  const sunset = eventTime(jd, lat, lng, -0.833, false);
  const civilDawnStart = eventTime(jd, lat, lng, -6, true);
  const civilDuskEnd = eventTime(jd, lat, lng, -6, false);
  const nauticalDawnStart = eventTime(jd, lat, lng, -12, true);
  const nauticalDuskEnd = eventTime(jd, lat, lng, -12, false);

  const now = new Date();
  const isDayNow = sunrise && sunset ? now >= sunrise && now <= sunset : false;
  const isCivilTwilightNow = !isDayNow && (
    (civilDawnStart && sunrise ? now >= civilDawnStart && now < sunrise : false) ||
    (sunset && civilDuskEnd ? now > sunset && now <= civilDuskEnd : false)
  );
  const isNightNow = !isDayNow && !isCivilTwilightNow;

  const dayLengthMinutes = sunrise && sunset
    ? Math.round((sunset.getTime() - sunrise.getTime()) / 60000)
    : null;

  return {
    civilDawnStart,
    sunrise,
    sunset,
    civilDuskEnd,
    nauticalDawnStart,
    nauticalDuskEnd,
    isDayNow,
    isCivilTwilightNow,
    isNightNow,
    dayLengthMinutes,
  };
}

export function formatSolarTime(date: Date | null): string {
  if (!date) return "--:--";
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function getDaylightPhase(solar: SolarTimes): { label: string; color: "day" | "twilight" | "night" } {
  if (solar.isDayNow) return { label: "Tag", color: "day" };
  if (solar.isCivilTwilightNow) return { label: "Dämmerung", color: "twilight" };
  return { label: "Nacht", color: "night" };
}

export function isTimeDuringDaylight(time: Date, solar: SolarTimes): boolean {
  if (!solar.sunrise || !solar.sunset) return false;
  return time >= solar.sunrise && time <= solar.sunset;
}

export interface SunArcSample {
  /** Lokale Uhrzeit dieses Samples. */
  time: Date;
  /** Sonnenhöhe in Grad über dem Horizont (negativ = unter Horizont). */
  elevationDeg: number;
}

/**
 * Samples des Sonnenstands über den gewählten Tag, ein Wert pro `stepMinutes`.
 * Erlaubt eine ehrliche Bogendarstellung (statt einer linearen Zeitleiste)
 * — Sonnenhöhe variiert tatsächlich sinusähnlich, der Bogen wird dadurch
 * im Winter flach und im Sommer hoch.
 */
export function hourlySunArc(lat: number, lng: number, date?: Date, stepMinutes = 15): SunArcSample[] {
  const baseDate = date || new Date();
  const day = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
  const samples: SunArcSample[] = [];
  for (let mins = 0; mins <= 24 * 60; mins += stepMinutes) {
    const t = new Date(day.getTime() + mins * 60 * 1000);
    samples.push({ time: t, elevationDeg: computeSunElevation(lat, lng, t) });
  }
  return samples;
}

/** Sonnenhöhe in Grad über dem Horizont (vereinfacht, ±0.5°). */
export function computeSunElevation(latDeg: number, lonDeg: number, date: Date): number {
  const jd = julianDay(date);
  const n = jd - 2451545.0;
  const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst + lonDeg / 15) % 24;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const raHours = ((ra * 12 / Math.PI) + 24) % 24;
  const haHours = lst - raHours;
  const ha = haHours * 15 * DEG;
  const latRad = latDeg * DEG;
  const sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD;
}

export function isTimeDuringCivilTwilight(time: Date, solar: SolarTimes): boolean {
  if (isTimeDuringDaylight(time, solar)) return false;
  const inMorning = solar.civilDawnStart && solar.sunrise
    ? time >= solar.civilDawnStart && time < solar.sunrise
    : false;
  const inEvening = solar.sunset && solar.civilDuskEnd
    ? time > solar.sunset && time <= solar.civilDuskEnd
    : false;
  return inMorning || inEvening;
}

export interface NightWindowResult {
  /** True, wenn mindestens ein Teil des Flugfensters in der gesetzlichen Nacht liegt. */
  anyNight: boolean;
  /** True, wenn das gesamte Flugfenster in der gesetzlichen Nacht liegt. */
  allNight: boolean;
}

/**
 * Prüft, ob ein geplantes Flugfenster (Start- bis Endzeit in Minuten ab
 * Mitternacht des `date`) ganz oder teilweise in der gesetzlichen Nacht liegt.
 * "Gesetzliche Nacht" = Sonne tiefer als -6° (Ende der bürgerlichen Dämmerung),
 * am konkreten Standort/Datum per Sonnenstand berechnet.
 *
 * Über-Mitternacht-Fenster (endMin <= startMin) werden auf den Folgetag
 * verlängert. Sampling in `stepMinutes`-Schritten inkl. Start und Ende.
 */
export function isFlightWindowDuringNight(
  lat: number,
  lng: number,
  date: Date,
  startMin: number,
  endMin: number,
  stepMinutes = 10,
): NightWindowResult {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const effectiveEnd = endMin <= startMin ? endMin + 1440 : endMin;
  let anyNight = false;
  let allNight = true;
  let samples = 0;
  for (let m = startMin; m <= effectiveEnd; m += stepMinutes) {
    const t = new Date(base.getTime() + m * 60000);
    const isNight = computeSunElevation(lat, lng, t) < -6;
    if (isNight) anyNight = true;
    else allNight = false;
    samples++;
  }
  if (samples === 0) allNight = false;
  return { anyNight, allNight };
}
