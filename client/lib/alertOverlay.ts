/**
 * Einblendung über anderen Apps (Android „Über anderen Apps einblenden“,
 * SYSTEM_ALERT_WINDOW) für TCAS-Warnungen, während DJI Fly im Vordergrund ist
 * und das Radar im Hintergrund überwacht.
 *
 * Native Seite: plugins/withAlertOverlay.js → AlertOverlayModule.kt (Modul
 * „AlertOverlay“): Banner oben mittig (~60 % breit) per WindowManager,
 * TYPE_APPLICATION_OVERLAY, FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCH_MODAL (DJI
 * Fly behält jede Eingabe außer auf dem Banner), rot RA / gelb TA / grün
 * „Clear of conflict“, großer Knopf „Quittieren“.
 *
 * „Quittieren“ blendet aus und meldet das auf zwei Wegen:
 *  1. Ereignis „alertOverlayDismissed“ (RCTDeviceEventEmitter) – sofort,
 *     solange der JS-Kontext läuft (im Vordergrunddienst der Fall).
 *  2. Statischer Merker im nativen Modul, den die Überwachung bei jedem
 *     Durchlauf abfragt (consumeDismissed) – falls das Ereignis nicht ankommt.
 *
 * Ohne natives Modul (Tests, iOS, Web, Expo Go, alte APK) ist alles ein No-op
 * und liefert false: die Überwachung fällt auf Ton + eine Benachrichtigung
 * zurück. Fehler werden nie geworfen.
 */
import { DeviceEventEmitter, NativeModules, Platform } from "react-native";
import type { AlertOverlayContent } from "@/lib/radarAlertLogic";

export type { AlertOverlayContent, AlertOverlayLevel } from "@/lib/radarAlertLogic";

export const ALERT_OVERLAY_DISMISSED_EVENT = "alertOverlayDismissed";
/** Dauer der Test-Einblendung (TCAS-Einstellungen) */
export const TEST_OVERLAY_MS = 8000;

interface AlertOverlayNative {
  canDrawOverlays(): Promise<boolean>;
  openOverlaySettings(): Promise<boolean>;
  show(c: AlertOverlayContent): Promise<boolean>;
  update(c: AlertOverlayContent): Promise<boolean>;
  hide(): void;
  consumeDismissed(): Promise<boolean>;
  restyleServiceNotification?(): void;
}

export interface OverlayDismissEvent {
  test: boolean;
}

function native(): AlertOverlayNative | null {
  if (Platform.OS !== "android") return null;
  const m = (NativeModules as Record<string, unknown>).AlertOverlay as AlertOverlayNative | undefined;
  return m && typeof m.show === "function" ? m : null;
}

/** Natives Modul vorhanden (APK mit plugins/withAlertOverlay.js gebaut)? */
export function isAlertOverlaySupported(): boolean {
  return native() != null;
}

/** Berechtigung „Über anderen Apps einblenden“ erteilt? (false ohne Modul) */
export async function canDrawOverlays(): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return (await m.canDrawOverlays()) === true;
  } catch {
    return false;
  }
}

/** Öffnet die Android-Einstellung „Über anderen Apps einblenden“ für COpter Pilot. */
export async function openOverlaySettings(): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return (await m.openOverlaySettings()) === true;
  } catch {
    return false;
  }
}

function clean(c: AlertOverlayContent): AlertOverlayContent {
  const out: AlertOverlayContent = { level: c.level, title: c.title, text: c.text };
  if (c.bearingDeg != null && Number.isFinite(c.bearingDeg)) out.bearingDeg = c.bearingDeg;
  if (c.autoHideMs != null && c.autoHideMs > 0) out.autoHideMs = c.autoHideMs;
  if (c.test) out.test = true;
  return out;
}

/** Einblenden bzw. vorhandene Einblendung ersetzen. false = nicht möglich (Rückfall). */
export async function showAlertOverlay(c: AlertOverlayContent): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return (await m.show(clean(c))) === true;
  } catch {
    return false;
  }
}

/** Text/Farbe der angezeigten Einblendung ändern, ohne sie neu hinzuzufügen. */
export async function updateAlertOverlay(c: AlertOverlayContent): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return (await m.update(clean(c))) === true;
  } catch {
    return false;
  }
}

export function hideAlertOverlay(): void {
  const m = native();
  if (!m) return;
  try {
    m.hide();
  } catch {
    /* nie werfen */
  }
}

/** Rückfall zum Ereignis: wurde seit der letzten Abfrage quittiert? (setzt den Merker zurück) */
export async function consumeOverlayDismissed(): Promise<boolean> {
  const m = native();
  if (!m) return false;
  try {
    return (await m.consumeDismissed()) === true;
  } catch {
    return false;
  }
}

/** „Quittieren“ getippt (Ereignis). Ohne Modul: No-op. */
export function addOverlayDismissListener(cb: (e: OverlayDismissEvent) => void): () => void {
  if (!native()) return () => {};
  try {
    const sub = DeviceEventEmitter.addListener(ALERT_OVERLAY_DISMISSED_EVENT, (e?: { test?: boolean }) => {
      try {
        cb({ test: e?.test === true });
      } catch {
        /* Listener-Fehler ignorieren */
      }
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/**
 * „Einblendung testen“ (TCAS-Einstellungen): gelbe TA-Einblendung für 8 s,
 * auch innerhalb der App sichtbar. false = Modul fehlt oder keine Berechtigung.
 */
export async function showTestOverlay(): Promise<boolean> {
  if (!(await canDrawOverlays())) return false;
  return showAlertOverlay({
    level: "ta",
    title: "TRAFFIC – Test der Einblendung",
    text: "DLH4AB · 2,4 km · +150 m relativ · aus NO (045°) – blendet sich nach 8 s aus",
    bearingDeg: 45,
    autoHideMs: TEST_OVERLAY_MS,
    test: true,
  });
}

/**
 * Daueranzeige des Vordergrunddienstes auf den eigenen stillen Kanal
 * „radar-monitor-silent“ (IMPORTANCE_MIN, ohne Ton/Abzeichen) umhängen.
 */
export function restyleServiceNotification(): void {
  const m = native();
  if (!m?.restyleServiceNotification) return;
  try {
    m.restyleServiceNotification();
  } catch {
    /* nie werfen */
  }
}
