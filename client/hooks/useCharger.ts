/**
 * React-Anbindung des Ladegerät-Loggers (lib/charger/chargerControllerNative).
 *
 *  - useChargerSnapshot(): aktueller Zustand (Transport, Status, Vorgänge …)
 *  - Rückfrage beim Verlassen (Dialog „Ladevorgang läuft – im Hintergrund
 *    weiter loggen?“): kleiner Store, angezeigt von <ChargerLeaveDialog/>,
 *    das dauerhaft im Tab-Navigator hängt (der Akkus-Tab ist beim Verlassen
 *    nicht mehr sichtbar).
 *  - useChargerAppStateHandling(): App geht in den Hintergrund → Einstellung
 *    befolgen („Immer fragen“ → weiter loggen, ein Dialog ist dann nicht möglich).
 */
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { chargerController } from "@/lib/charger/chargerControllerNative";
import type { ControllerSnapshot } from "@/lib/charger/chargerController";
import {
  decideOnAppBackground,
  decideOnLeave,
  resolveLeaveDialog,
} from "@/lib/charger/chargerBackground";
import {
  chargerPairingStore,
  getChargerBackgroundMode,
  setChargerBackgroundMode,
} from "@/lib/chargerStore";
import {
  isLocationServiceOn,
  requestBlePermissions,
} from "@/lib/charger/blePermissions";

const subscribeController = (cb: () => void) =>
  chargerController.subscribe(() => cb());
const getControllerSnapshot = () => chargerController.snapshot();

export function useChargerSnapshot(): ControllerSnapshot {
  return useSyncExternalStore(
    subscribeController,
    getControllerSnapshot,
    getControllerSnapshot,
  );
}

// ── Rückfrage beim Verlassen ───────────────────────────────────────────────
type LeaveListener = (open: boolean) => void;
let leaveOpen = false;
const leaveListeners = new Set<LeaveListener>();
function setLeaveOpen(v: boolean) {
  leaveOpen = v;
  for (const l of leaveListeners) l(v);
}

const subscribeLeave = (cb: () => void) => {
  const l: LeaveListener = () => cb();
  leaveListeners.add(l);
  return () => {
    leaveListeners.delete(l);
  };
};
const getLeaveOpen = () => leaveOpen;

export function useLeaveDialogOpen(): boolean {
  return useSyncExternalStore(subscribeLeave, getLeaveOpen, getLeaveOpen);
}

/** Antwort aus dem Dialog */
export async function answerLeaveDialog(
  choice: "continue" | "stop",
  remember: boolean,
): Promise<void> {
  setLeaveOpen(false);
  const r = resolveLeaveDialog(choice, remember);
  if (r.newMode) await setChargerBackgroundMode(r.newMode);
  if (r.action === "continue") await chargerController.startBackground();
  else await chargerController.disconnect("interrupted");
}

/**
 * Akkus-Tab bzw. Ladegerät-Bildschirm wird verlassen. Ohne laufenden
 * Ladevorgang wird getrennt; sonst entscheidet die Einstellung.
 */
export async function onLeaveChargerArea(): Promise<void> {
  const snap = chargerController.snapshot();
  if (!snap.transport || snap.transport.state === "stopped") return;
  const mode = await getChargerBackgroundMode();
  const d = decideOnLeave(mode, chargerController.hasActiveSession());
  if (d === "stop") await chargerController.disconnect("interrupted");
  else if (d === "continue") await chargerController.startBackground();
  else setLeaveOpen(true);
}

/** App-weit (im Tab-Navigator): Home-Taste / App in den Hintergrund */
export function useChargerAppStateHandling(): void {
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "background") return;
      const snap = chargerController.snapshot();
      if (!snap.transport || snap.transport.state === "stopped") return;
      void (async () => {
        const mode = await getChargerBackgroundMode();
        if (leaveOpen) setLeaveOpen(false); // Dialog jetzt nicht beantwortbar
        const d = decideOnAppBackground(
          mode,
          chargerController.hasActiveSession(),
        );
        if (d === "continue") await chargerController.startBackground();
        else await chargerController.disconnect("interrupted");
      })();
    });
    return () => sub.remove();
  }, []);
}

// ── Verbinden mit Berechtigungen ───────────────────────────────────────────
export interface ConnectAttempt {
  ok: boolean;
  message?: string;
  locationOff?: boolean;
}

/** Berechtigungen anfragen, Standort prüfen (Android 11), dann verbinden. */
export async function connectCharger(): Promise<ConnectAttempt> {
  const perm = await requestBlePermissions();
  if (!perm.ok) return { ok: false, message: perm.message };
  const loc = await isLocationServiceOn();
  const started = chargerController.connect();
  if (!started)
    return {
      ok: false,
      message: "Bluetooth-Modul fehlt in dieser App-Version (neue APK nötig).",
    };
  return { ok: true, locationOff: loc === false };
}

export async function isChargerPaired(): Promise<boolean> {
  return (await chargerPairingStore.getLastDevice()) != null;
}
