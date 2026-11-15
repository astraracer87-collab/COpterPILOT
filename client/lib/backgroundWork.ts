// App-Anbindung der kooperativen Hintergrundarbeit (shared/yieldingWork.ts):
//
// - Berührungs-Heuristik: die App-Wurzel meldet jede Berührung
//   (rootTouchHandlers an GestureHandlerRootView) → laufende schwere Arbeit
//   pausiert, bis ~400 ms Ruhe ist. Touch-Ereignisse „bubbeln“ in React
//   Native zur Wurzel, ohne dass die Wurzel den Responder übernimmt.
// - runAfterStartup(): Start-Aufgaben erst, wenn der erste Bildschirm
//   bedienbar ist (InteractionManager + Verzögerung), nie während der Navigation.
// - Fortschritt eines Hintergrund-Jobs in die Download-Anzeige übernehmen.
//
// RN-Module werden lazy per require geladen (unter tsx/Node testbar).
import { noteUserActivity, runBackgroundJob, type JobContext } from "../../shared/yieldingWork";
import { beginDownload, endDownload, progressDownload, type DownloadTaskInput } from "./downloadActivity";

let lastMoveNote = 0;

/** An die App-Wurzel hängen: <GestureHandlerRootView {...rootTouchHandlers}> */
export const rootTouchHandlers = {
  onTouchStart: (): void => noteUserActivity(),
  onTouchMove: (): void => {
    // Bewegungsereignisse kommen sehr oft – gedrosselt melden
    const now = Date.now();
    if (now - lastMoveNote > 100) {
      lastMoveNote = now;
      noteUserActivity();
    }
  },
  onTouchEnd: (): void => noteUserActivity(),
};

function afterInteractions(): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { InteractionManager } = require("react-native");
      if (InteractionManager?.runAfterInteractions) {
        InteractionManager.runAfterInteractions(() => resolve());
        return;
      }
    } catch {}
    resolve();
  });
}

/**
 * Start-Aufgabe nach `delayMs` UND nachdem laufende Interaktionen/Animationen
 * (Navigation) beendet sind. Liefert eine Abbruch-Funktion.
 */
export function runAfterStartup(fn: () => void, delayMs: number): () => void {
  let cancelled = false;
  const t = setTimeout(() => {
    void afterInteractions().then(() => {
      if (!cancelled) fn();
    });
  }, delayMs);
  (t as any)?.unref?.();
  return () => {
    cancelled = true;
    clearTimeout(t);
  };
}

/**
 * Schwerer Hintergrund-Job mit Eintrag in der Download-Anzeige (Fortschritt
 * über ctx.progress).
 */
export function runTrackedBackgroundJob<T>(task: DownloadTaskInput, fn: (ctx: JobContext) => Promise<T>): Promise<T> {
  const id = beginDownload(task);
  const h = runBackgroundJob(task.id, fn, { onProgress: (f) => progressDownload(id, { fraction: f }) });
  return h.promise.finally(() => endDownload(id));
}
