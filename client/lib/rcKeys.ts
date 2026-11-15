/**
 * Tasten und Rädchen der Fernsteuerung (DJI RC Pro 2 u. a.) – Schritt 1:
 * nur Erfassung/Auswertung für den Tasten-Test (Einstellungen → „Tasten der
 * Fernsteuerung“), noch keine Funktionsbelegung.
 *
 * Native Seite: plugins/withRcKeyEvents.js (MainActivity.dispatchKeyEvent /
 * dispatchGenericMotionEvent → Modul „RcKeys“ → RCTDeviceEventEmitter,
 * Ereignisse „rcKey“ und „rcMotion“). Das Modul sendet nur, solange hier
 * mindestens ein Abonnent angemeldet ist (setListening).
 *
 * Ohne natives Modul (Tests, iOS, Web, Expo Go) ist alles ein No-op.
 */
import { DeviceEventEmitter, NativeModules, Platform, type EmitterSubscription } from "react-native";

export type RcKeyAction = "down" | "up" | "multiple";

export interface RcKeyEvent {
  type: "key";
  action: RcKeyAction;
  keyCode: number;
  /** KeyEvent.keyCodeToString, z. B. „KEYCODE_DPAD_UP“ (unbekannte: Zahl als Text) */
  keyName: string;
  scanCode: number;
  repeatCount: number;
  metaState: number;
  flags: number;
  source: number;
  sourceNames: string[];
  deviceId: number;
  deviceName: string;
  deviceDescriptor?: string;
  deviceSources?: number;
  isGamepad: boolean;
  isJoystick?: boolean;
  isVirtual?: boolean;
  isSystem: boolean;
  /** true: im Aufnahme-Modus abgefangen (keine normale Navigation) */
  consumed: boolean;
  eventTime: number;
  timestamp: number;
}

export interface RcMotionEvent {
  type: "motion";
  /** MotionEvent.actionToString, z. B. „ACTION_MOVE“, „ACTION_SCROLL“ */
  action: string;
  source: number;
  sourceNames: string[];
  deviceId: number;
  deviceName: string;
  buttonState: number;
  /** Achsen ≠ 0 ohne „AXIS_“-Präfix, z. B. { HAT_X: -1, VSCROLL: 1 } */
  axes: Record<string, number>;
  /** alle Achsen 0 (z. B. 5D-Knopf wieder in der Mitte) */
  centered: boolean;
  consumed: boolean;
  eventTime: number;
  timestamp: number;
}

export type RcInputEvent = RcKeyEvent | RcMotionEvent;

export interface RcInputDevice {
  id: number;
  name: string;
  descriptor: string;
  sources: number;
  sourceNames: string[];
  vendorId: number;
  productId: number;
  keyboardType: "none" | "non_alphabetic" | "alphabetic";
  isVirtual: boolean;
  isExternal?: boolean;
  controllerNumber: number;
  axes: string[];
}

export interface RcDeviceInfo {
  model: string;
  manufacturer: string;
  brand: string;
  product: string;
  device: string;
  hardware: string;
  board: string;
  display: string;
  release: string;
  sdkInt: number;
  captureMode: boolean;
  inputDevices: RcInputDevice[];
}

interface RcKeysNative {
  setCaptureMode(enabled: boolean): void;
  setListening(enabled: boolean): void;
  getDeviceInfo(): Promise<RcDeviceInfo>;
}

export const RC_KEY_EVENT = "rcKey";
export const RC_MOTION_EVENT = "rcMotion";

function nativeModule(): RcKeysNative | null {
  if (Platform.OS !== "android") return null;
  const mod = (NativeModules as Record<string, unknown>).RcKeys as Partial<RcKeysNative> | undefined;
  if (!mod || typeof mod.setCaptureMode !== "function") return null;
  return mod as RcKeysNative;
}

/** Ist die native Erfassung vorhanden (nur Android-Build mit Config-Plugin)? */
export function isRcKeysAvailable(): boolean {
  return nativeModule() !== null;
}

let listenerCount = 0;

/**
 * Abonniert Tasten- und Bewegungs-Ereignisse. Gibt eine Abmelde-Funktion
 * zurück (mehrfacher Aufruf unschädlich).
 */
export function subscribeRcInput(listener: (event: RcInputEvent) => void): () => void {
  const mod = nativeModule();
  if (!mod) return () => {};
  const subs: EmitterSubscription[] = [
    DeviceEventEmitter.addListener(RC_KEY_EVENT, (e: RcKeyEvent) => listener({ ...e, type: "key" })),
    DeviceEventEmitter.addListener(RC_MOTION_EVENT, (e: RcMotionEvent) => listener({ ...e, type: "motion" })),
  ];
  listenerCount += 1;
  if (listenerCount === 1) safe(() => mod.setListening(true));
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    for (const s of subs) s.remove();
    listenerCount = Math.max(0, listenerCount - 1);
    if (listenerCount === 0) safe(() => mod.setListening(false));
  };
}

/**
 * Aufnahme-Modus: Steuerkreuz/5D-Knopf, Enter, Bild-auf/-ab, F- und
 * Gamepad-Tasten werden abgefangen (keine Navigation während des Tests).
 * Zurück, Home, Ein/Aus und Lautstärke bleiben immer normal.
 */
export function setRcCaptureMode(enabled: boolean): void {
  const mod = nativeModule();
  if (mod) safe(() => mod.setCaptureMode(enabled));
}

/** Gerätemodell und Eingabegeräte; null ohne natives Modul oder bei Fehler. */
export async function getRcDeviceInfo(): Promise<RcDeviceInfo | null> {
  const mod = nativeModule();
  if (!mod) return null;
  try {
    return await mod.getDeviceInfo();
  } catch {
    return null;
  }
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // natives Modul nicht bereit – ignorieren
  }
}

const ACTION_DE: Record<RcKeyAction, string> = { down: "gedrückt", up: "losgelassen", multiple: "mehrfach" };

/** Kurzbeschreibung für Anzeige und Protokoll (deutsch). */
export function describeRcEvent(e: RcInputEvent): string {
  if (e.type === "key") {
    const rep = e.repeatCount > 0 ? ` · Wiederholung ${e.repeatCount}` : "";
    return `Taste: ${e.keyName} (${e.keyCode}) · ${ACTION_DE[e.action] ?? e.action}${rep}`;
  }
  return `Bewegung: ${formatAxes(e.axes)} · ${e.action.replace(/^ACTION_/, "")}`;
}

export function formatAxes(axes: Record<string, number>): string {
  const parts = Object.entries(axes).map(([k, v]) => `${k} ${Number.isInteger(v) ? v : v.toFixed(2)}`);
  return parts.length ? parts.join(", ") : "Mitte (alle Achsen 0)";
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function formatRcTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Eine Protokollzeile (Text zum Kopieren) mit allen Rohwerten. */
export function formatRcLogLine(e: RcInputEvent): string {
  const t = formatRcTime(e.timestamp);
  if (e.type === "key") {
    return [
      t,
      "KEY",
      e.action,
      `${e.keyName}(${e.keyCode})`,
      `scan=${e.scanCode}`,
      `rep=${e.repeatCount}`,
      `meta=${e.metaState}`,
      `flags=${e.flags}`,
      `src=${e.source}[${e.sourceNames.join("|")}]`,
      `dev=${e.deviceId} "${e.deviceName}"`,
      e.isGamepad ? "gamepad" : "",
      e.isJoystick ? "joystick" : "",
      e.consumed ? "abgefangen" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    t,
    "MOTION",
    e.action,
    formatAxes(e.axes),
    `btn=${e.buttonState}`,
    `src=${e.source}[${e.sourceNames.join("|")}]`,
    `dev=${e.deviceId} "${e.deviceName}"`,
    e.consumed ? "abgefangen" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Geräte-Block für das kopierte Protokoll. */
export function formatRcDeviceInfo(info: RcDeviceInfo | null): string {
  if (!info) return "Gerät: unbekannt (keine native Erfassung)";
  const lines = [
    `Gerät: ${info.manufacturer} ${info.model} (product=${info.product}, device=${info.device}, brand=${info.brand}, hardware=${info.hardware}, board=${info.board})`,
    `Android ${info.release} (SDK ${info.sdkInt}), Build ${info.display}`,
    "Eingabegeräte:",
    ...info.inputDevices.map(
      (d) =>
        `  #${d.id} "${d.name}" src=${d.sources}[${d.sourceNames.join("|")}] vendor=0x${d.vendorId.toString(16)} product=0x${d.productId.toString(16)} keyboard=${d.keyboardType}${d.isVirtual ? " virtuell" : ""}${d.isExternal ? " extern" : ""}${d.axes.length ? ` Achsen=${d.axes.join(",")}` : ""}`,
    ),
  ];
  return lines.join("\n");
}
