import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "./query-client";
import { notifySubscriptionRequired } from "./subscriptionLock";

/**
 * Cookie-bewusster fetch-Wrapper für mobile Clients.
 *
 * React Natives `fetch` hat keinen verlässlichen plattform-übergreifenden
 * Cookie-Store. Wir behandeln den `connect.sid`-Session-Cookie deshalb
 * manuell: Login/Register liefern ihn im JSON-Body mit, wir persistieren
 * ihn in AsyncStorage und schicken ihn bei jedem nachfolgenden Request
 * als `Cookie`-Header zurück. Server-seitig läuft alles über das gleiche
 * Passport/express-session wie auf der Webseite.
 */

const SESSION_COOKIE_KEY = "@auth/session_cookie";
const API_TIMEOUT_MS = 15000;

let cachedCookie: string | null = null;
let cookieLoaded = false;

async function loadCookie(): Promise<string | null> {
  if (cookieLoaded) return cachedCookie;
  try {
    const v = await AsyncStorage.getItem(SESSION_COOKIE_KEY);
    cachedCookie = v;
  } catch {
    cachedCookie = null;
  }
  cookieLoaded = true;
  return cachedCookie;
}

export async function setSessionCookie(cookie: string | null): Promise<void> {
  cachedCookie = cookie;
  cookieLoaded = true;
  try {
    if (cookie) {
      await AsyncStorage.setItem(SESSION_COOKIE_KEY, cookie);
    } else {
      await AsyncStorage.removeItem(SESSION_COOKIE_KEY);
    }
  } catch (e) {
    console.warn("[api-client] failed to persist session cookie:", e);
  }
}

export async function getSessionCookie(): Promise<string | null> {
  return loadCookie();
}

export function hasSessionCookieSync(): boolean {
  return cookieLoaded && cachedCookie != null;
}

export async function clearSessionCookie(): Promise<void> {
  await setSessionCookie(null);
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Führt einen API-Request aus. Hängt den Session-Cookie automatisch an,
 * sofern einer in AsyncStorage liegt. Wirft `ApiError` bei !ok.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { method = "GET", body, headers = {}, timeoutMs = API_TIMEOUT_MS, signal } = options;
  const cookie = await loadCookie();
  const url = new URL(path, getApiUrl()).toString();

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined && !finalHeaders["Content-Type"]) {
    finalHeaders["Content-Type"] = "application/json";
  }
  if (cookie) {
    finalHeaders["Cookie"] = cookie;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: "include",
    });
    // Globaler Abo-Gate: Liefert irgendein API-Aufruf 402 (subscription_required),
    // melden wir das zentral, damit die App eine einheitliche Meldung zeigt und
    // zur Paketauswahl (PaywallScreen) leitet — statt eines rohen Fehlers.
    if (res.status === 402) {
      notifySubscriptionRequired();
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public payload?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiJson<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const res = await apiFetch(path, options);
  const contentType = res.headers.get("content-type") || "";
  const parse = async () => {
    if (contentType.includes("application/json")) {
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    try {
      return (await res.text()) as unknown;
    } catch {
      return null;
    }
  };

  if (!res.ok) {
    const payload = await parse();
    const msg =
      (payload && typeof payload === "object" && "error" in (payload as any) && String((payload as any).error)) ||
      `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, payload);
  }

  return (await parse()) as T;
}
