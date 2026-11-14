// Globaler 402-Handler für die mobile App (Spiegel von
// web/src/lib/subscriptionLock.ts).
//
// Wenn irgendein /api-Aufruf 402 (subscription_required) liefert, soll die App
// eine einheitliche, freundliche Meldung zeigen und auf die Paketauswahl
// (PaywallScreen) leiten — statt einer rohen Fehlermeldung oder eines leeren
// Zustands.
//
// `apiFetch` lebt außerhalb des React-Baums und kann daher nicht selbst
// navigieren. Stattdessen meldet es den Sperr-Fall über dieses kleine Pub/Sub
// an eine im AuthGate montierte Komponente (SubscriptionLockNotice), die
// Meldung + Neubewertung des Abo-Status übernimmt.

export const SUBSCRIPTION_REQUIRED_MESSAGE = "Aktives Abo erforderlich";

type Listener = () => void;

const listeners = new Set<Listener>();
let lastFired = 0;

/** Registriert einen Listener; gibt eine Cleanup-Funktion zurück. */
export function onSubscriptionRequired(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Meldet, dass ein API-Aufruf wegen fehlendem Abo (402) blockiert wurde.
 * Entprellt, damit gleichzeitige Hintergrund-Requests nicht mehrfach feuern.
 */
export function notifySubscriptionRequired(): void {
  const now = Date.now();
  if (now - lastFired < 1500) return;
  lastFired = now;
  for (const fn of listeners) fn();
}
