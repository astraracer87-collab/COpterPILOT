import { Platform } from "react-native";
import * as Speech from "expo-speech";
import type { AircraftState } from "@/lib/opensky";
import type { ProximityAlarmSettings } from "@/lib/storage";

export type AlertLevel = "approach" | "warning" | "critical";

export interface ProximityAlert {
  aircraft: AircraftState;
  distanceKm: number;
  altitudeM: number;
  level: AlertLevel;
  ttcSec?: number;
  isApproaching: boolean;
}

export interface ApproachingAircraft {
  aircraft: AircraftState;
  distanceKm: number;
  altitudeM: number;
  bearingDiff: number;
  ttcSec?: number;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function bearingFromTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function angleDifference(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function computeTTC(
  acLat: number,
  acLon: number,
  acTrack: number | null,
  acVelocity: number | null,
  userLat: number,
  userLon: number
): number | undefined {
  if (acTrack == null || acVelocity == null || acVelocity < 1) return undefined;
  const dist = haversineDistance(userLat, userLon, acLat, acLon);
  const bearingToUser = bearingFromTo(acLat, acLon, userLat, userLon);
  const bearingDiff = angleDifference(acTrack, bearingToUser);
  if (bearingDiff > 90) return undefined;
  const closingSpeedKmS = (acVelocity / 1000) * Math.cos((bearingDiff * Math.PI) / 180);
  if (closingSpeedKmS <= 0) return undefined;
  return dist / closingSpeedKmS;
}

export function checkApproachingAircraft(
  aircraft: AircraftState[],
  userLat: number,
  userLon: number,
  settings: ProximityAlarmSettings,
  pilotElevationMSL?: number | null
): ApproachingAircraft[] {
  if (!settings.enabled) return [];

  const approaching: ApproachingAircraft[] = [];
  const detectionRadiusKm = settings.radiusKm;

  for (const ac of aircraft) {
    if (ac.trueTrack == null) continue;

    const mslAlt = ac.geoAltitude ?? ac.baroAltitude;
    if (mslAlt == null) continue;
    if (ac.onGround && mslAlt < 100) continue;

    const relativeAlt = pilotElevationMSL != null ? mslAlt - pilotElevationMSL : mslAlt;
    // Hartes AGL-Limit aus den User-Settings: alles oberhalb wird gar nicht
    // erst geprüft (eine Drohne in 250 m AGL hat mit Verkehr in 500 m/800 m
    // schlicht nichts zu tun).
    if (relativeAlt > settings.maxAltitudeM) continue;

    const dist = haversineDistance(userLat, userLon, ac.latitude, ac.longitude);
    if (dist > detectionRadiusKm) continue;

    const bearingToUser = bearingFromTo(ac.latitude, ac.longitude, userLat, userLon);
    const bearingDiff = angleDifference(ac.trueTrack, bearingToUser);

    if (bearingDiff < 45) {
      const ttcSec = computeTTC(ac.latitude, ac.longitude, ac.trueTrack, ac.velocity, userLat, userLon);
      approaching.push({
        aircraft: ac,
        distanceKm: dist,
        altitudeM: relativeAlt,
        bearingDiff,
        ttcSec,
      });
    }
  }

  return approaching.sort((a, b) => a.distanceKm - b.distanceKm);
}

export function checkProximityAlerts(
  aircraft: AircraftState[],
  userLat: number,
  userLon: number,
  settings: ProximityAlarmSettings,
  pilotElevationMSL?: number | null
): ProximityAlert[] {
  if (!settings.enabled) return [];

  const alerts: ProximityAlert[] = [];
  const taRadiusKm = settings.ta?.radiusKm ?? 3;
  const raRadiusKm = settings.ra?.radiusKm ?? 1;
  const taTimeOn = settings.tcasTimeEnabled && (settings.taTimeEnabled ?? true);
  const raTimeOn = settings.tcasTimeEnabled && (settings.raTimeEnabled ?? true);
  const taTriggerSec = taTimeOn ? (settings.taTimeSec ?? 40) : undefined;
  const raTriggerSec = raTimeOn ? (settings.raTimeSec ?? 30) : undefined;

  for (const ac of aircraft) {
    const mslAlt = ac.geoAltitude ?? ac.baroAltitude;
    if (mslAlt == null) continue;
    if (ac.onGround && mslAlt < 100) continue;

    const relativeAlt = pilotElevationMSL != null ? mslAlt - pilotElevationMSL : mslAlt;
    // Hartes AGL-Limit aus den User-Settings (siehe checkApproachingAircraft).
    if (relativeAlt > settings.maxAltitudeM) continue;

    const dist = haversineDistance(userLat, userLon, ac.latitude, ac.longitude);
    const ttcSec = computeTTC(ac.latitude, ac.longitude, ac.trueTrack, ac.velocity, userLat, userLon);

    let level: AlertLevel | null = null;

    if (dist <= raRadiusKm) {
      level = "critical";
    } else if (raTriggerSec != null && ttcSec != null && ttcSec <= raTriggerSec && dist <= taRadiusKm) {
      level = "critical";
    } else if (dist <= taRadiusKm) {
      level = "warning";
    } else if (taTriggerSec != null && ttcSec != null && ttcSec <= taTriggerSec && dist <= taRadiusKm * 1.5) {
      level = "warning";
    }

    if (level) {
      let approaching = false;
      if (ac.trueTrack != null) {
        const bearingToUser = bearingFromTo(ac.latitude, ac.longitude, userLat, userLon);
        const bearingDiff = angleDifference(ac.trueTrack, bearingToUser);
        approaching = bearingDiff < 90;
      }
      alerts.push({
        aircraft: ac,
        distanceKm: dist,
        altitudeM: relativeAlt,
        level,
        ttcSec,
        isApproaching: approaching,
      });
    }
  }

  return alerts.sort((a, b) => a.distanceKm - b.distanceKm);
}

let speechActive = false;
let speechRepeatTimer: ReturnType<typeof setTimeout> | null = null;
let speechDeferTimer: ReturnType<typeof setTimeout> | null = null;
let currentAlarmPhrase = "";
let currentAlarmLevel: "warning" | "critical" | "none" = "none";

type AlarmLevelListener = (level: "warning" | "critical" | "none") => void;
const alarmLevelListeners = new Set<AlarmLevelListener>();

export function subscribeAlarmLevel(listener: AlarmLevelListener): () => void {
  alarmLevelListeners.add(listener);
  listener(currentAlarmLevel);
  return () => { alarmLevelListeners.delete(listener); };
}

function notifyAlarmLevel(level: "warning" | "critical" | "none"): void {
  for (const l of alarmLevelListeners) {
    try { l(level); } catch {}
  }
}

function safeHaptic(): void {}

function playWarningChime(onDone: () => void): void {
  if (Platform.OS === "web") { onDone(); return; }
  try {
    safeHaptic();
    setTimeout(() => {
      safeHaptic();
      setTimeout(() => {
        safeHaptic();
        setTimeout(() => {
          safeHaptic();
          setTimeout(() => { onDone(); }, 300);
        }, 100);
      }, 100);
    }, 100);
  } catch {
    onDone();
  }
}

function hapticForLevel(): void {
  if (Platform.OS === "web") return;
  try {
    if (currentAlarmLevel === "critical") {
      
    } else if (currentAlarmLevel === "warning") {
      
    }
  } catch {}
}

let speakFallbackTimer: ReturnType<typeof setTimeout> | null = null;

function doSpeak(phrase: string, repeat: boolean): void {
  let callbackFired = false;
  const scheduleRepeat = (delayMs: number) => {
    if (callbackFired) return;
    callbackFired = true;
    if (speakFallbackTimer) { clearTimeout(speakFallbackTimer); speakFallbackTimer = null; }
    if (repeat && speechActive) {
      speechRepeatTimer = setTimeout(() => {
        if (speechActive) {
          speakTCAS(currentAlarmPhrase || phrase, true, false);
        }
      }, delayMs);
    }
  };

  Speech.speak(phrase, {
    language: "en-US",
    pitch: 0.9,
    rate: 1.1,
    onDone: () => scheduleRepeat(4000),
    onError: (err) => {
      console.warn("Speech.speak onError:", err);
      scheduleRepeat(5000);
    },
  });

  if (repeat) {
    speakFallbackTimer = setTimeout(() => {
      speakFallbackTimer = null;
      if (!callbackFired && speechActive) {
        scheduleRepeat(3000);
      }
    }, 8000);
  }
}

function speakPhrase(phrase: string, repeat: boolean): void {
  try {
    hapticForLevel();

    if (speakFallbackTimer) { clearTimeout(speakFallbackTimer); speakFallbackTimer = null; }

    Speech.isSpeakingAsync().then((speaking) => {
      if (!speechActive) return;
      if (speaking) {
        try { Speech.stop(); } catch {}
        setTimeout(() => {
          if (speechActive) doSpeak(phrase, repeat);
        }, 150);
      } else {
        doSpeak(phrase, repeat);
      }
    }).catch(() => {
      if (speechActive) doSpeak(phrase, repeat);
    });
  } catch (e) {
    console.warn("Speech.speak failed:", e);
    if (repeat && speechActive) {
      speechRepeatTimer = setTimeout(() => {
        if (speechActive) speakTCAS(currentAlarmPhrase || phrase, true, false);
      }, 5000);
    }
  }
}

function speakTCAS(phrase: string, repeat: boolean = false, withChime: boolean = false): void {
  try {
    speechActive = true;
    if (speechRepeatTimer) {
      clearTimeout(speechRepeatTimer);
      speechRepeatTimer = null;
    }
    if (speechDeferTimer) {
      clearTimeout(speechDeferTimer);
      speechDeferTimer = null;
    }

    try { Speech.stop(); } catch {}

    const startSpeak = () => {
      if (!speechActive) return;
      speechDeferTimer = setTimeout(() => {
        speechDeferTimer = null;
        if (!speechActive) return;
        speakPhrase(phrase, repeat);
      }, 200);
    };

    if (withChime) {
      playWarningChime(startSpeak);
    } else {
      startSpeak();
    }
  } catch (e) {
    console.warn("speakTCAS failed:", e);
    if (speechActive) {
      speakPhrase(phrase, repeat);
    }
  }
}

function formatAltitudePhrase(altitudeM: number | null | undefined): string {
  if (altitudeM == null || isNaN(altitudeM)) return "";
  const rounded = Math.round(altitudeM / 10) * 10;
  return `, altitude ${rounded} meters`;
}

function buildWarningPhrase(altitudeM?: number | null): string {
  return `Traffic, traffic!${formatAltitudePhrase(altitudeM)}`;
}

function buildCriticalPhrase(altitudeM?: number | null): string {
  return `Descend, descend!${formatAltitudePhrase(altitudeM)}`;
}

export function triggerWarningAlarm(settings?: ProximityAlarmSettings, altitudeM?: number | null): void {
  const ta = settings?.ta ?? { visual: true, audio: true, haptic: true, radiusKm: 3 };
  if (ta.haptic && Platform.OS !== "web") {
    try {  } catch {}
  }
  if (ta.audio) {
    const phrase = buildWarningPhrase(altitudeM);
    currentAlarmPhrase = phrase;
    currentAlarmLevel = "warning";
    notifyAlarmLevel("warning");
    speakTCAS(phrase, true, true);
  } else {
    currentAlarmLevel = "warning";
    notifyAlarmLevel("warning");
  }
}

export function triggerCriticalAlarm(settings?: ProximityAlarmSettings, altitudeM?: number | null): void {
  const ra = settings?.ra ?? { visual: true, audio: true, haptic: true, radiusKm: 1 };
  if (ra.haptic && Platform.OS !== "web") {
    try {  } catch {}
  }
  if (ra.audio) {
    const phrase = buildCriticalPhrase(altitudeM);
    currentAlarmPhrase = phrase;
    currentAlarmLevel = "critical";
    notifyAlarmLevel("critical");
    speakTCAS(phrase, true, true);
  } else {
    currentAlarmLevel = "critical";
    notifyAlarmLevel("critical");
  }
}

export function updateAlarmAltitude(altitudeM: number | null | undefined): void {
  if (!speechActive) return;
  if (currentAlarmLevel === "critical") {
    currentAlarmPhrase = buildCriticalPhrase(altitudeM);
  } else if (currentAlarmLevel === "warning") {
    currentAlarmPhrase = buildWarningPhrase(altitudeM);
  }
}

export function shouldShowVisual(level: "warning" | "critical", settings?: ProximityAlarmSettings): boolean {
  if (!settings) return true;
  if (level === "critical") return settings.ra?.visual ?? true;
  return settings.ta?.visual ?? true;
}

export function stopAlarmSound(): void {
  speechActive = false;
  currentAlarmLevel = "none";
  notifyAlarmLevel("none");
  currentAlarmPhrase = "";
  if (speechRepeatTimer) {
    clearTimeout(speechRepeatTimer);
    speechRepeatTimer = null;
  }
  if (speechDeferTimer) {
    clearTimeout(speechDeferTimer);
    speechDeferTimer = null;
  }
  if (speakFallbackTimer) {
    clearTimeout(speakFallbackTimer);
    speakFallbackTimer = null;
  }
  try { Speech.stop(); } catch {}
}

export function speakClearOfConflict(): void {
  try {
    try { Speech.stop(); } catch {}
    setTimeout(() => {
      Speech.isSpeakingAsync().then((speaking) => {
        if (speaking) {
          try { Speech.stop(); } catch {}
          setTimeout(() => {
            try {
              Speech.speak("Clear of conflict", { language: "en-US", pitch: 0.9, rate: 1.0 });
            } catch {}
          }, 300);
        } else {
          try {
            Speech.speak("Clear of conflict", { language: "en-US", pitch: 0.9, rate: 1.0 });
          } catch {}
        }
      }).catch(() => {
        try {
          Speech.speak("Clear of conflict", { language: "en-US", pitch: 0.9, rate: 1.0 });
        } catch {}
      });
    }, 350);
    if (Platform.OS !== "web") {
      try {  } catch {}
    }
  } catch {}
}
