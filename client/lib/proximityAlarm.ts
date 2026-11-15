import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import type { ProximityAlarmSettings } from "@/lib/storage";

// Reine Erkennung (Schwellen TA/RA, TTC, Anflug) liegt RN-frei in
// radarAlertLogic.ts – gemeinsam für Radar-Screen und Hintergrund-Überwachung.
export {
  checkApproachingAircraft,
  checkProximityAlerts,
  type AlertLevel,
  type ApproachingAircraft,
  type ProximityAlert,
} from "@/lib/radarAlertLogic";

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

function safeHaptic(style: Haptics.ImpactFeedbackStyle): void {
  if (Platform.OS === "web") return;
  try { Haptics.impactAsync(style).catch(() => {}); } catch {}
}

function playWarningChime(onDone: () => void): void {
  if (Platform.OS === "web") { onDone(); return; }
  try {
    safeHaptic(Haptics.ImpactFeedbackStyle.Heavy);
    setTimeout(() => {
      safeHaptic(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => {
        safeHaptic(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => {
          safeHaptic(Haptics.ImpactFeedbackStyle.Heavy);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else if (currentAlarmLevel === "warning") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
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
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); } catch {}
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
    try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); } catch {}
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
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); } catch {}
    }
  } catch {}
}
