/**
 * Akustischer TCAS-Alarm ohne Google-Dienste: kurze, mitgelieferte WAV-Töne
 * (assets/sounds) über expo-audio (ExoPlayer, Medien-Lautstärke) plus
 * Vibration über react-native `Vibration`.
 *
 * Hintergrund: Der Alarm lief früher nur über expo-speech (Android-TTS). Auf
 * Geräten ohne Google Play Services (DJI RC Pro 2) ist meist keine TTS-Engine
 * installiert → Speech.speak bleibt stumm; Haptik allein ist kein Alarm.
 *
 * Audio-Modus: `shouldPlayInBackground` (sonst pausiert expo-audio beim Wechsel
 * in den Hintergrund, z. B. wenn DJI Fly im Vordergrund ist), `duckOthers`
 * (andere Audioquellen werden kurz leiser statt den Ton zu verschlucken) und
 * `playsInSilentMode`. Die JS-Laufzeit hält im Hintergrund der Vordergrund-
 * dienst (react-native-background-actions) am Leben.
 *
 * expo-audio wird erst bei Bedarf geladen und jeder Aufruf ist abgesichert:
 * fehlt das native Modul, bleibt mindestens die Vibration.
 */
import { Platform, Vibration } from "react-native";
import type { AudioPlayer } from "expo-audio";
import type { AlarmToneKind } from "./radarAlertLogic";

type ExpoAudio = typeof import("expo-audio");

const SOURCES: Record<AlarmToneKind, number> = {
  critical: require("../../assets/sounds/tcas_critical.wav"),
  warning: require("../../assets/sounds/tcas_warning.wav"),
  soft: require("../../assets/sounds/tcas_soft.wav"),
};

/** Lautstärke je Ton (relativ zur Medien-Lautstärke des Geräts) */
const VOLUME: Record<AlarmToneKind, number> = {
  critical: 1,
  warning: 1,
  soft: 0.6,
};

let audioMod: ExpoAudio | null | undefined;
function audio(): ExpoAudio | null {
  if (audioMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      audioMod = require("expo-audio") as ExpoAudio;
    } catch (e) {
      console.warn("[alarmSound] expo-audio nicht verfügbar:", e);
      audioMod = null;
    }
  }
  return audioMod;
}

let modePromise: Promise<void> | null = null;
function ensureAudioMode(): Promise<void> {
  const mod = audio();
  if (!mod) return Promise.resolve();
  if (!modePromise) {
    modePromise = mod
      .setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "duckOthers",
        shouldRouteThroughEarpiece: false,
        allowsRecording: false,
      })
      .catch((e: unknown) => {
        modePromise = null;
        console.warn("[alarmSound] setAudioModeAsync:", e);
      });
  }
  return modePromise;
}

const players: Partial<Record<AlarmToneKind, AudioPlayer>> = {};
function player(kind: AlarmToneKind): AudioPlayer | null {
  const existing = players[kind];
  if (existing) return existing;
  const mod = audio();
  if (!mod) return null;
  try {
    const p = mod.createAudioPlayer(SOURCES[kind]);
    p.volume = VOLUME[kind];
    players[kind] = p;
    return p;
  } catch (e) {
    console.warn(`[alarmSound] createAudioPlayer(${kind}):`, e);
    return null;
  }
}

/**
 * Audio-Modus setzen und Töne vorladen (Radar-Screen geöffnet bzw. Start der
 * Hintergrund-Überwachung), damit der erste Alarm ohne Verzögerung kommt und
 * der Modus schon steht, bevor die App in den Hintergrund geht.
 */
export function preloadAlarmSounds(): void {
  void ensureAudioMode();
  (Object.keys(SOURCES) as AlarmToneKind[]).forEach((k) => player(k));
}

/** Spielt einen Alarmton von vorn. Gibt false zurück, wenn kein Player möglich war. */
export function playAlarmTone(kind: AlarmToneKind): boolean {
  const p = player(kind);
  if (!p) return false;
  const start = () => {
    try {
      p.volume = VOLUME[kind];
      p.play();
    } catch (e) {
      console.warn(`[alarmSound] play(${kind}):`, e);
    }
  };
  void ensureAudioMode().then(() => {
    try {
      // Nach dem Abspielen steht der Player am Ende → von vorn beginnen
      p.seekTo(0).then(start, start);
    } catch {
      start();
    }
  });
  return true;
}

export function stopAlarmTones(): void {
  for (const p of Object.values(players)) {
    try {
      p?.pause();
    } catch {
      /* Player bereits freigegeben */
    }
  }
}

export function vibrateAlarm(pattern: number[] | null): void {
  if (!pattern || Platform.OS === "web") return;
  try {
    Vibration.vibrate(pattern);
  } catch {
    /* kein Vibrationsmotor */
  }
}

export function cancelAlarmVibration(): void {
  if (Platform.OS === "web") return;
  try {
    Vibration.cancel();
  } catch {
    /* ignorieren */
  }
}
