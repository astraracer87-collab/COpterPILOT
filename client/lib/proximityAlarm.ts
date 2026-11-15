import { Platform } from "react-native";
import * as Speech from "expo-speech";
import type { ProximityAlarmSettings } from "@/lib/storage";
import { decideAlarmTone, type AlarmTonePlan } from "@/lib/radarAlertLogic";
import {
  cancelAlarmVibration,
  playAlarmTone,
  preloadAlarmSounds,
  stopAlarmTones,
  vibrateAlarm,
} from "@/lib/alarmSound";

// Reine Erkennung (Schwellen TA/RA, TTC, Anflug) und die Ton-Entscheidung
// (decideAlarmTone) liegen RN-frei in radarAlertLogic.ts – gemeinsam für
// Radar-Screen und Hintergrund-Überwachung.
export {
  checkApproachingAircraft,
  checkProximityAlerts,
  type AlertLevel,
  type ApproachingAircraft,
  type ProximityAlert,
} from "@/lib/radarAlertLogic";

export { preloadAlarmSounds };

/**
 * Akustischer Alarm: zuerst ein mitgelieferter Ton (alarmSound.ts, expo-audio –
 * funktioniert ohne Google-Dienste, auch im Hintergrund), danach optional eine
 * Sprachansage (expo-speech). Auf Geräten ohne TTS-Engine (DJI RC Pro 2) bleibt
 * die Ansage stumm, der Ton aber nicht. Wiederholung laut Ton-Plan
 * (RA alle 3 s, TA „nähert sich“ alle 6 s, „entfernt sich“ nur einmal leise).
 */

/** Pause zwischen Tonbeginn und Sprachansage (Ton ist ≤ 1 s lang) */
const SPEECH_AFTER_TONE_MS = 1100;

let cycleTimer: ReturnType<typeof setTimeout> | null = null;
let speechTimer: ReturnType<typeof setTimeout> | null = null;
let alarmRunning = false;
let currentAlarmPhrase = "";
let currentAlarmLevel: "warning" | "critical" | "none" = "none";
let currentApproaching = true;
let currentSettings: ProximityAlarmSettings | undefined;
let currentPlan: AlarmTonePlan | null = null;

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

function safeSpeechStop(): void {
  try { Speech.stop(); } catch {}
}

function speak(phrase: string, rate = 1.1): void {
  if (!phrase) return;
  try {
    safeSpeechStop();
    Speech.speak(phrase, {
      language: "en-US",
      pitch: 0.9,
      rate,
      onError: () => { /* keine TTS-Engine: Ton genügt */ },
    });
  } catch {
    /* expo-speech nicht verfügbar */
  }
}

function clearTimers(): void {
  if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
  if (speechTimer) { clearTimeout(speechTimer); speechTimer = null; }
}

/** Ein Durchlauf: Ton, danach Ansage, ggf. Wiederholung planen. */
function runCycle(): void {
  const plan = currentPlan;
  if (!alarmRunning || !plan) return;
  if (plan.tone) playAlarmTone(plan.tone);
  if (plan.speak) {
    speechTimer = setTimeout(() => {
      speechTimer = null;
      if (alarmRunning) speak(currentAlarmPhrase);
    }, SPEECH_AFTER_TONE_MS);
  }
  if (plan.repeatMs != null) {
    cycleTimer = setTimeout(() => {
      cycleTimer = null;
      if (!alarmRunning) return;
      // RA: Vibration bei jeder Wiederholung (Pilot schaut evtl. nicht aufs Gerät)
      if (currentAlarmLevel === "critical") vibrateAlarm(plan.vibrate);
      runCycle();
    }, plan.repeatMs);
  }
}

function startAlarm(
  level: "warning" | "critical",
  approaching: boolean,
  settings: ProximityAlarmSettings | undefined,
  altitudeM: number | null | undefined,
): void {
  clearTimers();
  stopAlarmTones();
  safeSpeechStop();
  currentSettings = settings;
  currentApproaching = approaching;
  currentAlarmLevel = level;
  currentAlarmPhrase = level === "critical" ? buildCriticalPhrase(altitudeM) : buildWarningPhrase(altitudeM);
  currentPlan = decideAlarmTone(level, approaching, settings);
  alarmRunning = true;
  notifyAlarmLevel(level);
  vibrateAlarm(currentPlan.vibrate);
  runCycle();
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

/**
 * TA-Alarm. `approaching` = false (Flugobjekt entfernt sich): nur ein leiser
 * Einzelton. Standard true (laut, wiederholt) – im Zweifel lieber warnen.
 */
export function triggerWarningAlarm(settings?: ProximityAlarmSettings, altitudeM?: number | null, approaching: boolean = true): void {
  startAlarm("warning", approaching, settings, altitudeM);
}

export function triggerCriticalAlarm(settings?: ProximityAlarmSettings, altitudeM?: number | null): void {
  startAlarm("critical", true, settings, altitudeM);
}

/**
 * Laufender Alarm: Höhe für die Ansage aktualisieren. Wechselt ein TA von
 * „entfernt sich“ auf „nähert sich“, wird auf den lauten, wiederholten Ton
 * hochgestuft; umgekehrt endet die Wiederholung (kein neuer Ton).
 */
export function updateAlarmAltitude(altitudeM: number | null | undefined, approaching?: boolean): void {
  if (!alarmRunning) return;
  if (currentAlarmLevel === "critical") {
    currentAlarmPhrase = buildCriticalPhrase(altitudeM);
    return;
  }
  if (currentAlarmLevel !== "warning") return;
  currentAlarmPhrase = buildWarningPhrase(altitudeM);
  if (approaching == null || approaching === currentApproaching) return;
  if (approaching) {
    startAlarm("warning", true, currentSettings, altitudeM);
  } else {
    currentApproaching = false;
    currentPlan = decideAlarmTone("warning", false, currentSettings);
    clearTimers();
  }
}

export function shouldShowVisual(level: "warning" | "critical", settings?: ProximityAlarmSettings): boolean {
  if (!settings) return true;
  if (level === "critical") return settings.ra?.visual ?? true;
  return settings.ta?.visual ?? true;
}

export function stopAlarmSound(): void {
  const wasRunning = alarmRunning;
  alarmRunning = false;
  currentAlarmLevel = "none";
  currentPlan = null;
  notifyAlarmLevel("none");
  currentAlarmPhrase = "";
  clearTimers();
  stopAlarmTones();
  if (wasRunning) cancelAlarmVibration();
  safeSpeechStop();
}

export function speakClearOfConflict(): void {
  setTimeout(() => speak("Clear of conflict", 1.0), 350);
}

/**
 * „Alarmton testen“ (TCAS-Einstellungen): TA-Ton, dann RA-Ton, mit Vibration.
 * Ignoriert „Akustisch“/„Vibration“ bewusst, damit der Pilot Lautstärke und
 * Lautsprecher prüfen kann. Gibt false zurück, wenn kein Audio-Player erstellt
 * werden konnte (natives Modul fehlt).
 */
export function testAlarmSound(): boolean {
  preloadAlarmSounds();
  const ok = playAlarmTone("warning");
  vibrateAlarm(decideAlarmTone("warning", true).vibrate);
  setTimeout(() => {
    playAlarmTone("critical");
    vibrateAlarm(decideAlarmTone("critical", true).vibrate);
  }, 1400);
  if (Platform.OS !== "web") setTimeout(() => speak("Traffic, traffic!"), 2600);
  return ok;
}
