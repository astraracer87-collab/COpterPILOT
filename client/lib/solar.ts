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
