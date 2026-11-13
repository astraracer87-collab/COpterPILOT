/**
 * Globaler Store für die Anzahl aktiver NOTAMs / Beschränkungen.
 * Wird vom NotamsScreen aktualisiert und vom Tab-Navigator abonniert,
 * um den NOTAM-Tab rot pulsieren zu lassen, sobald aktive Einträge existieren.
 */

type Listener = (count: number) => void;

let activeCount = 0;
const listeners = new Set<Listener>();

export function setActiveNotamCount(count: number): void {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (safe === activeCount) return;
  activeCount = safe;
  for (const l of listeners) {
    try {
      l(activeCount);
    } catch {
      // ignore listener errors
    }
  }
}

export function getActiveNotamCount(): number {
  return activeCount;
}

export function subscribeActiveNotamCount(listener: Listener): () => void {
  listeners.add(listener);
  listener(activeCount);
  return () => {
    listeners.delete(listener);
  };
}
