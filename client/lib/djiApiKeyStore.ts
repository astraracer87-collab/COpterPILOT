/**
 * DJI-API-Schlüssel des Piloten – ausschließlich im verschlüsselten
 * Schlüsselspeicher des Geräts (expo-secure-store, Android Keystore).
 * Nie in AsyncStorage, nie in Logs, nie im Repo.
 *
 * RN-frei ladbar: expo-secure-store wird erst bei Bedarf per require geladen;
 * Tests setzen einen eigenen Speicher (__setDjiSecureStoreForTests).
 */
import {
  validateDjiApiKey,
  type DjiKeyCheck,
  type DjiKeychainFetchOptions,
} from "./djiKeychainApi";

export const DJI_API_KEY_STORE_KEY = "dji_openapi_api_key";

export interface SecureKv {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

let override: SecureKv | null = null;
let cached: string | null | undefined;
const listeners = new Set<(hasKey: boolean) => void>();

function store(): SecureKv {
  if (override) return override;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-secure-store") as SecureKv;
}

export function __setDjiSecureStoreForTests(kv: SecureKv | null): void {
  override = kv;
  cached = undefined;
}

function notify(): void {
  const has = !!cached;
  listeners.forEach((l) => {
    try {
      l(has);
    } catch {
      // ignorieren
    }
  });
}

export function onDjiApiKeyChange(fn: (hasKey: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getDjiApiKey(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    const v = await store().getItemAsync(DJI_API_KEY_STORE_KEY);
    cached = v && v.trim() ? v.trim() : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function hasDjiApiKey(): Promise<boolean> {
  return !!(await getDjiApiKey());
}

/** Für die Anzeige: nur die letzten 4 Zeichen. */
export function maskDjiApiKey(key: string | null | undefined): string {
  const k = (key ?? "").trim();
  if (!k) return "";
  if (k.length <= 4) return "••••";
  return `••••••••${k.slice(-4)}`;
}

/**
 * Prüfen (günstiger API-Aufruf) und nur bei Erfolg speichern. Offline wird
 * unbestätigt gespeichert (mit Hinweis).
 */
export async function verifyAndSaveDjiApiKey(
  apiKey: string,
  opts: DjiKeychainFetchOptions = {},
): Promise<DjiKeyCheck> {
  const key = String(apiKey ?? "").trim();
  const check = await validateDjiApiKey(key, opts);
  if (!check.ok) return check;
  try {
    await store().setItemAsync(DJI_API_KEY_STORE_KEY, key);
  } catch {
    return {
      ok: false,
      code: "server",
      error:
        "Der Schlüssel konnte nicht im sicheren Speicher des Geräts abgelegt werden.",
    };
  }
  cached = key;
  notify();
  return check;
}

export async function clearDjiApiKey(): Promise<void> {
  try {
    await store().deleteItemAsync(DJI_API_KEY_STORE_KEY);
  } catch {
    // nichts zu löschen
  }
  cached = null;
  notify();
}
