/**
 * Tasten und Rädchen der Fernsteuerung (DJI RC Pro 2 u. a.) – Schritt 1:
 * nur Erfassung/Auswertung für den Tasten-Test (Einstellungen → „Tasten der
 * Fernsteuerung“), noch keine Funktionsbelegung.
 *
 * Native Seite: plugins/withRcKeyEvents.js (MainActivity.dispatchKeyEvent /
 * dispatchGenericMotionEvent, im Test zusätzlich Window.Callback-Hülle und
 * View-Listener → Modul „RcKeys“ → RCTDeviceEventEmitter, Ereignisse „rcKey“,
 * „rcMotion“ und „rcDevice“). Das Modul sendet nur, solange hier mindestens
 * ein Abonnent angemeldet ist (setListening = Test-Modus): dann jede Taste
 * jedes Geräts und jede Bewegung jeder Quelle außer Touchscreen/Stift mit
 * allen Achsen des Geräts (auch 0).
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
  /** erster Meldeweg: „activity“, „window“, „view“, „activity-fallback“ */
  via?: string;
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
  historySize?: number;
  /**
   * Achsen ohne „AXIS_“-Präfix: alle Achsen des Geräts (auch 0) plus weitere
   * Achsen ≠ 0, z. B. { X: 0, Y: 0, HAT_X: -1, VSCROLL: 1 }
   */
  axes: Record<string, number>;
  /** alle Achsen 0 (z. B. 5D-Knopf wieder in der Mitte) */
  centered: boolean;
  consumed: boolean;
  via?: string;
  eventTime: number;
  timestamp: number;
}

/** Eingabegerät hinzugekommen/entfernt/geändert (InputManager). */
export interface RcDeviceChangeEvent {
  type: "device";
  change: "added" | "removed" | "changed";
  deviceId: number;
  deviceName: string;
  sources: number;
  sourceNames: string[];
  timestamp: number;
}

export type RcInputEvent = RcKeyEvent | RcMotionEvent | RcDeviceChangeEvent;

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
  /** Achsenbereiche (MotionRange), Achse ohne „AXIS_“-Präfix */
  ranges?: RcAxisRange[];
}

export interface RcAxisRange {
  axis: string;
  source: number;
  min: number;
  max: number;
  flat: number;
  fuzz: number;
  resolution: number;
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
  /** /dev/input-Einträge (null: Verzeichnis nicht lesbar – Normalfall) */
  devInput?: { name: string; readable: boolean }[] | null;
  /** Inhalt von /proc/bus/input/devices (null: nicht lesbar) */
  procInputDevices?: string | null;
  /** aktive Bedienungshilfen (Settings.Secure, durch „:“ getrennt) */
  accessibilityEnabled?: string;
  /** installierte Bedienungshilfen (Paket/Dienst) */
  accessibilityInstalled?: string[];
}

interface RcKeysNative {
  setCaptureMode(enabled: boolean): void;
  setListening(enabled: boolean): void;
  getDeviceInfo(): Promise<RcDeviceInfo>;
  listDjiPackages?(): Promise<RcPackageInfo[]>;
  exportApk?(packageName: string): Promise<string>;
}

export interface RcPackageInfo {
  packageName: string;
  label: string;
  system: boolean;
  size: number;
  splits: number;
}

export const RC_KEY_EVENT = "rcKey";
export const RC_MOTION_EVENT = "rcMotion";
export const RC_DEVICE_EVENT = "rcDevice";

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
    DeviceEventEmitter.addListener(RC_DEVICE_EVENT, (e: RcDeviceChangeEvent) => listener({ ...e, type: "device" })),
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
  if (e.type === "device") return `Gerät ${DEVICE_CHANGE_DE[e.change] ?? e.change}: ${e.deviceName} (#${e.deviceId})`;
  return `Bewegung: ${formatAxes(e.axes)} · ${e.action.replace(/^ACTION_/, "")}`;
}

const DEVICE_CHANGE_DE: Record<RcDeviceChangeEvent["change"], string> = {
  added: "hinzugekommen",
  removed: "entfernt",
  changed: "geändert",
};

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** Nur Achsen ≠ 0 (kompakt); alle 0 → „Mitte“. */
export function formatAxes(axes: Record<string, number>): string {
  const parts = Object.entries(axes)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k} ${fmtNum(v)}`);
  return parts.length ? parts.join(", ") : "Mitte (alle Achsen 0)";
}

/** Alle Achsen inkl. 0 (für das kopierte Protokoll). */
export function formatAllAxes(axes: Record<string, number>): string {
  const parts = Object.entries(axes).map(([k, v]) => `${k}=${fmtNum(v)}`);
  return parts.length ? parts.join(" ") : "(keine Achsen)";
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
      e.via ? `via=${e.via}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (e.type === "device") {
    return `${t} DEVICE ${e.change} dev=${e.deviceId} "${e.deviceName}" src=${e.sources}[${e.sourceNames.join("|")}]`;
  }
  return [
    t,
    "MOTION",
    e.action,
    formatAllAxes(e.axes),
    `btn=${e.buttonState}`,
    `src=${e.source}[${e.sourceNames.join("|")}]`,
    `dev=${e.deviceId} "${e.deviceName}"`,
    e.consumed ? "abgefangen" : "",
    e.via ? `via=${e.via}` : "",
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
        `  #${d.id} "${d.name}" src=${d.sources}[${d.sourceNames.join("|")}] vendor=0x${d.vendorId.toString(16)} product=0x${d.productId.toString(16)} keyboard=${d.keyboardType}${d.isVirtual ? " virtuell" : ""}${d.isExternal ? " extern" : ""}${d.axes.length ? ` Achsen=${d.axes.join(",")}` : ""}` +
        (d.ranges ?? [])
          .map((r) => `\n    ${r.axis} [${fmtNum(r.min)}..${fmtNum(r.max)}] flat=${fmtNum(r.flat)} fuzz=${fmtNum(r.fuzz)} src=${r.source}`)
          .join(""),
    ),
  ];
  if (info.devInput !== undefined) {
    lines.push(
      info.devInput === null
        ? "/dev/input: nicht lesbar"
        : `/dev/input: ${info.devInput.map((n) => `${n.name}${n.readable ? "(lesbar)" : ""}`).join(" ") || "leer"}`,
    );
  }
  if (info.procInputDevices !== undefined) {
    lines.push(info.procInputDevices ? `/proc/bus/input/devices:\n${info.procInputDevices.trim()}` : "/proc/bus/input/devices: nicht lesbar");
  }
  if (info.accessibilityEnabled !== undefined) {
    lines.push(`Bedienungshilfen aktiv: ${info.accessibilityEnabled || "keine"}`);
  }
  if (info.accessibilityInstalled) {
    lines.push(`Bedienungshilfen installiert: ${info.accessibilityInstalled.join(", ") || "keine"}`);
  }
  return lines.join("\n");
}

/** Live-Stand einer Achse für die Balkenanzeige (seit Teststart). */
export interface RcAxisLive {
  value: number;
  /** kleinster/größter gesehener Wert seit Start (auch kurze Ausschläge) */
  seenMin: number;
  seenMax: number;
  /** Zeitpunkt der letzten Änderung (ms) */
  changedAt: number;
}

/** Je Gerät (deviceId) → Achse → Live-Stand. */
export type RcAxisState = Record<number, Record<string, RcAxisLive>>;

/** Achsenstand mit einem Bewegungs-Ereignis fortschreiben (rein, neues Objekt). */
export function updateRcAxisState(state: RcAxisState, e: RcMotionEvent): RcAxisState {
  const prevDev = state[e.deviceId] ?? {};
  const dev: Record<string, RcAxisLive> = { ...prevDev };
  for (const [axis, value] of Object.entries(e.axes)) {
    const p = prevDev[axis];
    dev[axis] = p
      ? {
          value,
          seenMin: Math.min(p.seenMin, value),
          seenMax: Math.max(p.seenMax, value),
          changedAt: p.value !== value ? e.timestamp : p.changedAt,
        }
      : { value, seenMin: Math.min(0, value), seenMax: Math.max(0, value), changedAt: value !== 0 ? e.timestamp : 0 };
  }
  return { ...state, [e.deviceId]: dev };
}

/**
 * Balken-Geometrie (Anteile 0..1 der Balkenbreite): Achsen mit negativem
 * Minimum wachsen von der Mitte aus, sonst von links. Ohne Bereich: -1..1.
 */
export function rcAxisBar(value: number, range?: Pick<RcAxisRange, "min" | "max">): { start: number; end: number; zero: number } {
  let min = range?.min ?? -1;
  let max = range?.max ?? 1;
  if (!(max > min)) {
    min = -1;
    max = 1;
  }
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min)));
  const zero = min < 0 && max > 0 ? frac(0) : 0;
  const pos = frac(value);
  return { start: Math.min(zero, pos), end: Math.max(zero, pos), zero };
}

/** Joystick-/Gamepad-/Rad-Geräte, deren Achsen im Panel erscheinen. */
export function rcAxisDevices(info: RcDeviceInfo | null): RcInputDevice[] {
  if (!info) return [];
  return info.inputDevices.filter(
    (d) =>
      d.axes.length > 0 &&
      d.sourceNames.some((s) => s === "JOYSTICK" || s === "GAMEPAD" || s === "ROTARY_ENCODER" || s === "TRACKBALL"),
  );
}

/** Diagnose: DJI-Pakete auf dem Gerät (leer ohne natives Modul) */
export async function listRcDjiPackages(): Promise<RcPackageInfo[]> {
  const mod = (NativeModules as { RcKeys?: RcKeysNative }).RcKeys;
  if (Platform.OS !== "android" || !mod?.listDjiPackages) return [];
  try {
    return await mod.listDjiPackages();
  } catch {
    return [];
  }
}

/** Diagnose: App-Datei eines Pakets in den Download-Ordner kopieren → Pfad */
export async function exportRcApk(packageName: string): Promise<string> {
  const mod = (NativeModules as { RcKeys?: RcKeysNative }).RcKeys;
  if (Platform.OS !== "android" || !mod?.exportApk) throw new Error("In dieser App-Version nicht verfügbar");
  return mod.exportApk(packageName);
}
