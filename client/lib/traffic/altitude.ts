// Einheitliche Meereshöhe (MSL) für Luftfahrzeuge aus den verschiedenen Quellen.
//
// - geoAltitude (ADS-B/OpenSky): GNSS-Höhe über dem WGS84-Ellipsoid → minus
//   Geoidundulation (EGM96, in Mitteleuropa ≈ 40–50 m).
// - baroAltitude: Druckhöhe bezogen auf 1013,25 hPa → mit örtlichem QNH auf
//   MSL umgerechnet (≈ 8 m je hPa Abweichung).
// - mslAltitude (OGN/FLARM): bereits MSL.
import { geoidUndulationM } from "../../../shared/geoid";
import { fetchWithTimeout } from "../fetchWithTimeout";

const ISA_P0_HPA = 1013.25;
const QNH_MIN_HPA = 900;
const QNH_MAX_HPA = 1090;
const QNH_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const QNH_REFRESH_MS = 20 * 60 * 1000;
const QNH_REFRESH_DIST_KM = 25;

export interface AltitudeSource {
  latitude: number;
  longitude: number;
  baroAltitude: number | null;
  geoAltitude: number | null;
  mslAltitude?: number | null;
  onGround?: boolean;
}

/** Druckhöhe der QNH-Fläche (ISA). Negativ bei Hochdruck. */
export function qnhLevelPressureAltitudeM(qnhHpa: number): number {
  return 44330.77 * (1 - Math.pow(qnhHpa / ISA_P0_HPA, 0.190263));
}

export function pressureAltitudeToMslM(pressureAltM: number, qnhHpa: number): number {
  return pressureAltM - qnhLevelPressureAltitudeM(qnhHpa);
}

export function isPlausibleQnh(hpa: unknown): hpa is number {
  return typeof hpa === "number" && Number.isFinite(hpa) && hpa >= QNH_MIN_HPA && hpa <= QNH_MAX_HPA;
}

let qnh: { hpa: number; lat: number; lon: number; at: number } | null = null;
let qnhInFlight: Promise<void> | null = null;

export function setQnh(hpa: number, lat: number, lon: number, at: number = Date.now()): void {
  if (!isPlausibleQnh(hpa)) return;
  qnh = { hpa, lat, lon, at };
}

/** Aktueller QNH in hPa oder null (unbekannt/zu alt). */
export function currentQnhHpa(now: number = Date.now()): number | null {
  if (!qnh || now - qnh.at > QNH_MAX_AGE_MS) return null;
  return qnh.hpa;
}

export function resetQnhForTests(): void {
  qnh = null;
  qnhInFlight = null;
}

function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Holt den QNH (Open-Meteo pressure_msl) für den Standort, gedrosselt auf alle
 * 20 min bzw. bei > 25 km Ortswechsel. Offline/Fehler: alter Wert bleibt.
 */
export function refreshQnh(lat: number, lon: number, now: number = Date.now()): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve();
  if (qnh && now - qnh.at < QNH_REFRESH_MS && distKm(qnh.lat, qnh.lon, lat, lon) < QNH_REFRESH_DIST_KM) {
    return Promise.resolve();
  }
  if (qnhInFlight) return qnhInFlight;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=pressure_msl`;
  qnhInFlight = fetchWithTimeout(url, {}, 10_000)
    .then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      const hpa = data?.current?.pressure_msl;
      if (isPlausibleQnh(hpa)) setQnh(hpa, lat, lon, Date.now());
    })
    .catch(() => {})
    .finally(() => {
      qnhInFlight = null;
    });
  return qnhInFlight;
}

/** Meereshöhe in Metern (bestmögliche Quelle), oder null. */
export function aircraftMslM(ac: AltitudeSource, qnhHpa: number | null = currentQnhHpa()): number | null {
  if (ac.mslAltitude != null && Number.isFinite(ac.mslAltitude)) return ac.mslAltitude;
  if (ac.geoAltitude != null && Number.isFinite(ac.geoAltitude)) {
    return ac.geoAltitude - geoidUndulationM(ac.latitude, ac.longitude);
  }
  if (ac.baroAltitude != null && Number.isFinite(ac.baroAltitude)) {
    // Am Boden meldet FR24 0 – nicht umrechnen, sonst „schwebt“ das Ziel.
    if (ac.onGround || !isPlausibleQnh(qnhHpa)) return ac.baroAltitude;
    return pressureAltitudeToMslM(ac.baroAltitude, qnhHpa);
  }
  return null;
}
