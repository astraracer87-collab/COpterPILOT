import type { AircraftState } from "./opensky";
import { compassDir, haversineKm } from "./opensky";

export interface ProximityAlert {
  aircraft: AircraftState;
  distanceKm: number;
  altitudeM: number | null;
  bearingDeg: number;
  level: "warning" | "critical";
  ts: number;
}

export interface TrafficLogEntry {
  ts: number;
  icao24: string;
  callsign: string;
  distanceKm: number;
  altitudeM: number | null;
  bearingDeg: number;
  direction: string;
  level: "warning" | "critical";
}

export interface RadarSettings {
  warnRadiusKm: number;
  criticalRadiusKm: number;
  maxAltitudeM: number;
  muted: boolean;
}

export const DEFAULT_RADAR_SETTINGS: RadarSettings = {
  warnRadiusKm: 3,
  criticalRadiusKm: 1,
  maxAltitudeM: 500,
  muted: false,
};

const SETTINGS_KEY = "copterpilot.web.radar.settings";

export function loadRadarSettings(): RadarSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_RADAR_SETTINGS };
    return { ...DEFAULT_RADAR_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_RADAR_SETTINGS };
  }
}

export function saveRadarSettings(s: RadarSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

export function detectAlerts(
  aircraft: AircraftState[],
  userLat: number,
  userLon: number,
  settings: RadarSettings,
): ProximityAlert[] {
  const alerts: ProximityAlert[] = [];
  for (const ac of aircraft) {
    const altM = ac.geoAltitude ?? ac.baroAltitude;
    if (ac.onGround && (altM ?? 0) < 50) continue;
    if (altM != null && altM > settings.maxAltitudeM + 100) continue;
    const dist = ac.distanceKm ?? haversineKm(userLat, userLon, ac.latitude, ac.longitude);
    if (dist > settings.warnRadiusKm) continue;
    const level: "critical" | "warning" = dist <= settings.criticalRadiusKm ? "critical" : "warning";
    alerts.push({
      aircraft: ac,
      distanceKm: dist,
      altitudeM: altM,
      bearingDeg: ac.bearingDeg ?? 0,
      level,
      ts: Date.now(),
    });
  }
  return alerts.sort((a, b) => a.distanceKm - b.distanceKm);
}

const SPEAK_THROTTLE_MS = 12000;
const lastSpokenAt = new Map<string, number>();

function germanVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang.toLowerCase().startsWith("de"));
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function buildAlertPhrase(alert: ProximityAlert): string {
  const meters = Math.round(alert.distanceKm * 1000);
  const distancePart =
    meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(".", ",")} Kilometer` : `${meters} Metern`;
  const dir = compassDir(alert.bearingDeg);
  const altPart = alert.altitudeM != null ? `, Höhe ${Math.round(alert.altitudeM)} Meter` : "";
  const prefix = alert.level === "critical" ? "Achtung! Verkehr in" : "Verkehr in";
  return `${prefix} ${distancePart}, ${dir}${altPart}.`;
}

export function speakAlert(alert: ProximityAlert, settings: RadarSettings): boolean {
  if (settings.muted || !speechSupported()) return false;
  const key = alert.aircraft.icao24;
  const now = Date.now();
  const last = lastSpokenAt.get(key) ?? 0;
  if (now - last < SPEAK_THROTTLE_MS) return false;
  lastSpokenAt.set(key, now);
  try {
    const utt = new SpeechSynthesisUtterance(buildAlertPhrase(alert));
    utt.lang = "de-DE";
    utt.rate = alert.level === "critical" ? 1.05 : 0.95;
    utt.pitch = alert.level === "critical" ? 1.1 : 1.0;
    const v = germanVoice();
    if (v) utt.voice = v;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking() {
  if (speechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

export function clearSpeechThrottle() {
  lastSpokenAt.clear();
}

const TRAFFIC_LOG_KEY = "copterpilot.web.radar.log";
const TRAFFIC_LOG_MAX = 200;

export function appendTrafficLog(alert: ProximityAlert): TrafficLogEntry {
  const entry: TrafficLogEntry = {
    ts: alert.ts,
    icao24: alert.aircraft.icao24,
    callsign: alert.aircraft.callsign || alert.aircraft.icao24,
    distanceKm: alert.distanceKm,
    altitudeM: alert.altitudeM,
    bearingDeg: alert.bearingDeg,
    direction: compassDir(alert.bearingDeg),
    level: alert.level,
  };
  try {
    const list = getTrafficLog();
    list.unshift(entry);
    const trimmed = list.slice(0, TRAFFIC_LOG_MAX);
    localStorage.setItem(TRAFFIC_LOG_KEY, JSON.stringify(trimmed));
  } catch {}
  return entry;
}

export function getTrafficLog(): TrafficLogEntry[] {
  try {
    const raw = localStorage.getItem(TRAFFIC_LOG_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function clearTrafficLog() {
  try {
    localStorage.removeItem(TRAFFIC_LOG_KEY);
  } catch {}
}

const RECENT_DUPE_MS = 30000;

export function shouldLogAlert(alert: ProximityAlert, recentLog: TrafficLogEntry[]): boolean {
  return !recentLog.some(
    (e) => e.icao24 === alert.aircraft.icao24 && alert.ts - e.ts < RECENT_DUPE_MS,
  );
}
