/**
 * Google-Satellitenbild über die offizielle Google Map Tiles API (2D-Kacheln),
 * wie im KMZ-Tool. Der API-Schlüssel wird vom Nutzer in den Einstellungen
 * eingegeben und verschlüsselt auf dem Gerät gespeichert – er steht nie im
 * Quellcode oder in der APK.
 *
 * Google erlaubt kein Vorab-Herunterladen ganzer Gebiete: diese Kacheln gibt es
 * nur online (kurzzeitiger Zwischenspeicher der Karte ist erlaubt).
 */
import * as SecureStore from "expo-secure-store";

const API = "https://tile.googleapis.com/v1";
const KEY_NAME = "google_map_tiles_key";

export type GoogleTileState = { template: string | null };

let session: { id: string; key: string; until: number } | null = null;
let cachedKey: string | null | undefined;
const listeners = new Set<(s: GoogleTileState) => void>();
let current: GoogleTileState = { template: null };

function emit(s: GoogleTileState) {
  current = s;
  listeners.forEach((l) => l(s));
}

export function onGoogleTilesChange(l: (s: GoogleTileState) => void): () => void {
  listeners.add(l);
  l(current);
  return () => listeners.delete(l);
}

export async function getGoogleKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  try {
    cachedKey = (await SecureStore.getItemAsync(KEY_NAME)) || null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

async function createSession(key: string): Promise<{ id: string; until: number }> {
  const res = await fetch(`${API}/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "de-DE", region: "DE" }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.session) {
    const msg = j?.error?.message || `HTTP ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const exp = j.expiry ? Number(j.expiry) * 1000 : Date.now() + 12 * 3600e3;
  return { id: j.session, until: Math.min(exp - 600e3, Date.now() + 7 * 24 * 3600e3) };
}

function templateFor(key: string, sessionId: string): string {
  return `${API}/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(sessionId)}&key=${encodeURIComponent(key)}`;
}

/** Liefert die Kachel-Adresse (oder null ohne Schlüssel / offline). */
export async function ensureGoogleTiles(): Promise<string | null> {
  const key = await getGoogleKey();
  if (!key) {
    emit({ template: null });
    return null;
  }
  if (session && session.key === key && Date.now() < session.until) {
    const t = templateFor(key, session.id);
    if (current.template !== t) emit({ template: t });
    return t;
  }
  try {
    const s = await createSession(key);
    session = { ...s, key };
    const t = templateFor(key, s.id);
    emit({ template: t });
    return t;
  } catch {
    emit({ template: null });
    return null;
  }
}

/** Prüft den Schlüssel bei Google und speichert ihn nur, wenn er funktioniert. */
export async function setGoogleKey(raw: string): Promise<{ ok: boolean; error?: string }> {
  const key = raw.trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(key)) return { ok: false, error: "Das sieht nicht wie ein Google-API-Schlüssel aus." };
  try {
    const s = await createSession(key);
    await SecureStore.setItemAsync(KEY_NAME, key);
    cachedKey = key;
    session = { ...s, key };
    emit({ template: templateFor(key, s.id) });
    return { ok: true };
  } catch (e: any) {
    if (e?.status === 403 || e?.status === 400) {
      return {
        ok: false,
        error: `Google lehnt den Schlüssel ab – ist die „Map Tiles API“ im Google-Cloud-Projekt aktiviert und die Abrechnung eingerichtet? (${e.message})`,
      };
    }
    return { ok: false, error: `Prüfen fehlgeschlagen: ${e?.message ?? "keine Verbindung"}` };
  }
}

export async function clearGoogleKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_NAME).catch(() => {});
  cachedKey = null;
  session = null;
  emit({ template: null });
}
