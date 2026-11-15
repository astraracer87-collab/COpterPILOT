// fetch mit Timeout (AbortController) – RN-frei, damit unter tsx testbar.
//
// Hintergrund (Review-Fix 8): Die Wetter-/Kp-Abrufe nutzten plain fetch. Hängt
// z. B. der DFS-/dipul-Wetterdienst, kam der Open-Meteo-Rückfall nie zum Zug.
// Mit Timeout wirft der Abruf nach `timeoutMs` (AbortError), die vorhandenen
// catch-Zweige greifen und der Rückfall übernimmt. Analog aviationWeather.ts.

export const DEFAULT_FETCH_TIMEOUT_MS = 10000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Ein vom Aufrufer übergebenes Signal weiterhin respektieren.
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
