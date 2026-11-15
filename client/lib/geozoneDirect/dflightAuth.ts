// d-flight (IT) – Anmeldung des Nutzers direkt auf dem Gerät (kein Backend).
// Ablauf laut docs/dflight-it-api-integration.md §2/§3/§3a und Web-App-Bundle:
//
//  1. Laufzeitkonfiguration per socket.io (EIO=4) holen: nach dem Connect
//     `d-flight.hci.read` senden, Antwort-Event `d-flight.hci.configuration`
//     enthält general.csrf_pub_key (+ gatewayBaseUrl). Primär über WebSocket,
//     Fallback HTTP-Long-Polling (beides Engine.IO v4).
//  2. csrf_pub_key (base64) mit dem fest hinterlegten Key per RSA-publicDecrypt
//     (PKCS#1 v1.5, Blocktyp 1) entschlüsseln -> PEM des echten CSRF-Keys.
//  3. Pro Anfrage: GET {gateway}/pre-flight -> {value: W}; Nonce H = UUID;
//     X-CSRF-Token = base64(RSA-publicEncrypt_PKCS1v1.5(H + "|" + W)),
//     X-CSRF-Nonce = H.
//  4. Token: POST /auth-iam/token (Password-Grant, client_id web-app, kein
//     client_secret), Refresh: POST /auth-iam/token/refresh, jeweils mit CSRF.
//
// Zugangsdaten gibt der Nutzer in der App ein; sie liegen ausschließlich im
// SecureStore (dflight_username / dflight_password). Tokens nur im Speicher.
//
// RN hat kein Node-crypto -> node-forge (reines JS). expo-secure-store wird
// erst bei Bedarf geladen, damit die CSRF-/Socket-Teile unter tsx testbar sind.

import { setCountryAccessAvailable } from "../../../shared/countryDetection";
import forge from "node-forge";
import { IT_DFLIGHT_BASE_URL } from "../../../shared/italianGeozones";

export const DFLIGHT_USERNAME_KEY = "dflight_username";
export const DFLIGHT_PASSWORD_KEY = "dflight_password";

export const DFLIGHT_SOCKET_PATH = "/socket.io/";
export const DFLIGHT_DEFAULT_GATEWAY_URL = `${IT_DFLIGHT_BASE_URL}/api-gateway`;
export const DFLIGHT_KEYCLOAK_URL = `${IT_DFLIGHT_BASE_URL}/auth-iam`;
export const DFLIGHT_TOKEN_URL = `${DFLIGHT_KEYCLOAK_URL}/token`;
export const DFLIGHT_REFRESH_URL = `${DFLIGHT_KEYCLOAK_URL}/token/refresh`;
export const DFLIGHT_CLIENT_ID = "web-app";
export const DFLIGHT_SCOPE = "openid email profile user-data personal-data pilot-license dflight-identification";

export const DFLIGHT_CONFIG_EVENT = "d-flight.hci.configuration";
export const DFLIGHT_CONFIG_REQUEST_EVENT = "d-flight.hci.read";

const SOCKET_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 20_000;
// Konfiguration (CSRF-Key) im Speicher halten; bei „Malformed Headers“ neu holen.
const CONFIG_TTL_MS = 6 * 3600 * 1000;
// Token so früh erneuern, dass er während eines großen Downloads nicht abläuft.
const TOKEN_SAFETY_MS = 60_000;

/**
 * Fest im Web-App-Client hinterlegter (öffentlicher) Schlüssel zum
 * Entschlüsseln von general.csrf_pub_key (`publicCsrfDecryptKey`).
 */
export const DFLIGHT_CSRF_DECRYPT_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA1bpY0TH/OqwY71j+7ayl
bWIo2njiAh2H+o0ghgOhXxcUgw4RSZrUzTRdJOhXKozgXwZ4BX2rrMpEZJ/RCZQA
HiSvmhFeuztgFLK7CFKTkS3uftaT7jBdvtI9GKgxgPd+nrThnc78w/fBilzPVCdg
+U0zhA4mnWNco2Jk1WDEK6PJ05SC4ZwQ29SVMZv6264q6bs6Le4lmWC/JxzeR2Sq
TprCwIa9y1Yq22u27wgwVqcqc1vsGgTHQe/VWLmbb6QxfJpTyNJc+ZwH1N6gILkC
E2RF52mWrQ/grz7YoLXg7haLWxzjflbhVlRujGqcrdYpNm5u8yGiKYmNlWvGP0dv
Qy8LJZXlmaiKHy8v70NobdzgodepoENIL4QS5nI5HyMMBAo5pWSQFktOiuTokY/s
2O6oWliIwdevqLg64cW2joWNAV9a8sfU49OXrEzuZPve3gJRxhdwKjlfW7STIFrU
pGUheLpUfjrjSUY3WWIw6lXimllHOg0iIsCq7UBFWvXLz2xubw4DGNFWrj/5oX7Q
9+367SxJMErS9xvhuP8vlvDQ/XISCHox9v4tvBP/jNZAirP15UbWtGhritJ1v9St
7765ICsoDSDddSgQJ4UC5m5kwVFi5WlKaYig3lvW8DFGbrwocbdCQetOt8tGoxwT
+Y5a/Mb8L8KiEJ4RPspHLvsCAwEAAQ==
-----END PUBLIC KEY-----`;

export type DflightCsrfHeaders = { "X-CSRF-Token": string; "X-CSRF-Nonce": string };

export class DflightAuthError extends Error {
  /** "credentials" = Zugangsdaten falsch/fehlend, "csrf", "network", "server". */
  kind: "credentials" | "csrf" | "network" | "server";
  status?: number;
  constructor(message: string, kind: DflightAuthError["kind"], status?: number) {
    super(message);
    this.name = "DflightAuthError";
    this.kind = kind;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Reine CSRF-Bausteine (testbar)
// ---------------------------------------------------------------------------

/**
 * csrf_pub_key (base64) -> PEM des echten CSRF-Public-Keys
 * (RSA publicDecrypt, PKCS#1 v1.5 = Node `padding: 1`).
 */
export function decryptCsrfPublicKey(
  csrfPubKeyB64: string,
  decryptKeyPem: string = DFLIGHT_CSRF_DECRYPT_KEY_PEM,
): string {
  const key = forge.pki.publicKeyFromPem(decryptKeyPem);
  // forge: decrypt(ed, key, pub=true) entfernt die PKCS#1-Blocktyp-1-Polsterung.
  // (forge exportiert rsa.decrypt, @types/node-forge typisiert es aber nicht.)
  const rsaDecrypt = (forge.pki.rsa as unknown as {
    decrypt: (ed: string, key: forge.pki.rsa.PublicKey, pub: boolean) => string;
  }).decrypt;
  const raw = rsaDecrypt(forge.util.decode64(String(csrfPubKeyB64).trim()), key, true);
  const pem = forge.util.decodeUtf8(raw).trim();
  if (!pem.includes("BEGIN PUBLIC KEY")) throw new DflightAuthError("d-flight: CSRF-Schlüssel unlesbar", "csrf");
  return pem;
}

/**
 * Sichere Zufallsbytes des Geräts: Web-Crypto, sonst expo-crypto (Android-
 * SecureRandom). Null, wenn beides fehlt (dann bleibt forge allein zuständig).
 */
function deviceRandomBytes(n: number): Uint8Array | null {
  try {
    const c = (globalThis as any).crypto;
    if (c?.getRandomValues) return c.getRandomValues(new Uint8Array(n));
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ec = require("expo-crypto");
    if (ec?.getRandomBytes) return ec.getRandomBytes(n) as Uint8Array;
  } catch {}
  return null;
}

let forgeSeeded = false;
/** forge-Zufallsgenerator (Nonce, PKCS#1-Padding) mit Geräte-Entropie füttern. */
function seedForge(): void {
  if (forgeSeeded) return;
  const b = deviceRandomBytes(64);
  if (b) {
    (forge.random as unknown as { collect(bytes: string): void }).collect(String.fromCharCode(...Array.from(b)));
    forgeSeeded = true;
  }
}

/** UUID v4 (Format ist dem Server egal, er vergleicht nur Nonce gegen Token). */
export function dflightNonce(): string {
  seedForge();
  const dev = deviceRandomBytes(16);
  const bytes = dev ? Array.from(dev) : Array.from(forge.random.getBytesSync(16), (c) => c.charCodeAt(0));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Header für eine Anfrage: X-CSRF-Token = base64(RSA-PKCS#1-v1.5(nonce|value)).
 * `publicKeyPem` = Ergebnis von decryptCsrfPublicKey, `preflightValue` =
 * `value` aus GET /pre-flight.
 */
export function buildCsrfHeaders(
  publicKeyPem: string,
  preflightValue: string | number,
  nonce: string = dflightNonce(),
): DflightCsrfHeaders {
  seedForge();
  const key = forge.pki.publicKeyFromPem(publicKeyPem);
  const data = forge.util.encodeUtf8(`${nonce}|${preflightValue}`);
  const token = forge.util.encode64(key.encrypt(data, "RSAES-PKCS1-V1_5"));
  return { "X-CSRF-Token": token, "X-CSRF-Nonce": nonce };
}

// ---------------------------------------------------------------------------
// socket.io-Konfiguration (Engine.IO v4, minimal)
// ---------------------------------------------------------------------------

export type DflightRuntimeConfig = {
  csrfPubKey: string;
  gatewayBaseUrl: string;
  ed269Url?: string;
};

/**
 * Engine.IO-Payload (ggf. mehrere Pakete, getrennt durch \x1e) nach dem
 * Konfigurations-Event durchsuchen. Liefert das Event-Objekt oder null.
 */
export function parseSocketConfigPackets(payload: string): any | null {
  for (const packet of String(payload).split("\x1e")) {
    // "4" = Engine.IO message, "2" = socket.io EVENT (ohne Namespace/Ack-ID).
    if (!packet.startsWith("42")) continue;
    const start = packet.indexOf("[");
    if (start < 0) continue;
    try {
      const arr = JSON.parse(packet.slice(start));
      if (Array.isArray(arr) && arr[0] === DFLIGHT_CONFIG_EVENT && arr[1] && typeof arr[1] === "object") return arr[1];
    } catch {
      // unvollständig/anderes Paket – weiter
    }
  }
  return null;
}

/** Relevante Teile aus dem Konfigurations-Event ziehen (clientSecret wird ignoriert). */
export function runtimeConfigFromEvent(cfg: any): DflightRuntimeConfig {
  const csrfPubKey = String(cfg?.general?.csrf_pub_key ?? "").trim();
  if (!csrfPubKey) throw new DflightAuthError("d-flight: Konfiguration ohne CSRF-Schlüssel", "server");
  let gatewayBaseUrl = String(cfg?.general?.gatewayBaseUrl ?? "").trim() || DFLIGHT_DEFAULT_GATEWAY_URL;
  gatewayBaseUrl = gatewayBaseUrl.replace(/\/+$/, "").replace("https://www.d-flight.it:443", IT_DFLIGHT_BASE_URL);
  const ed = String(cfg?.geoawareness?.baseUrl ?? "").trim();
  const out: DflightRuntimeConfig = { csrfPubKey, gatewayBaseUrl };
  if (ed) out.ed269Url = ed.replace(/\/+$/, "").replace("https://www.d-flight.it:443", IT_DFLIGHT_BASE_URL);
  return out;
}

/** Konfiguration über WebSocket (EIO=4, transport=websocket). */
export function fetchSocketConfigViaWebSocket(
  baseUrl: string = IT_DFLIGHT_BASE_URL,
  timeoutMs: number = SOCKET_TIMEOUT_MS,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(new DflightAuthError("WebSocket nicht verfügbar", "network"));
      return;
    }
    const url = `${baseUrl.replace(/^http/, "ws")}${DFLIGHT_SOCKET_PATH}?EIO=4&transport=websocket`;
    let done = false;
    let ws: WebSocket;
    const finish = (err: Error | null, value?: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // egal
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new DflightAuthError("d-flight: Zeitüberschreitung bei der Konfiguration (WebSocket)", "network")),
      timeoutMs,
    );
    try {
      ws = new WebSocket(url);
    } catch (e: any) {
      clearTimeout(timer);
      reject(new DflightAuthError(`d-flight: WebSocket fehlgeschlagen (${e?.message ?? e})`, "network"));
      return;
    }
    ws.onmessage = (ev: { data?: unknown }) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (data.startsWith("0")) {
        ws.send("40"); // socket.io CONNECT (Default-Namespace)
      } else if (data.startsWith("40")) {
        ws.send(`42${JSON.stringify([DFLIGHT_CONFIG_REQUEST_EVENT])}`);
      } else if (data === "2") {
        ws.send("3"); // Ping -> Pong
      } else if (data.startsWith("44")) {
        finish(new DflightAuthError("d-flight: socket.io-Verbindung abgelehnt", "server"));
      } else {
        const cfg = parseSocketConfigPackets(data);
        if (cfg) finish(null, cfg);
      }
    };
    ws.onerror = () => finish(new DflightAuthError("d-flight: WebSocket-Fehler", "network"));
    ws.onclose = () => finish(new DflightAuthError("d-flight: WebSocket vorzeitig geschlossen", "network"));
  });
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs: number = HTTP_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { credentials: "include", ...init, signal: controller.signal });
  } catch (e: any) {
    if (e instanceof DflightAuthError) throw e;
    throw new DflightAuthError(`d-flight nicht erreichbar (${e?.name === "AbortError" ? "Zeitüberschreitung" : e?.message ?? e})`, "network");
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback: Konfiguration über Engine.IO-HTTP-Long-Polling. */
export async function fetchSocketConfigViaPolling(
  baseUrl: string = IT_DFLIGHT_BASE_URL,
  timeoutMs: number = SOCKET_TIMEOUT_MS,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(1000, deadline - Date.now());
  const base = `${baseUrl}${DFLIGHT_SOCKET_PATH}?EIO=4&transport=polling`;
  const open = await (await fetchWithTimeout(`${base}&t=${Date.now()}`, {}, left())).text();
  const openPacket = open.split("\x1e").find((p) => p.startsWith("0"));
  const sid = openPacket ? JSON.parse(openPacket.slice(1))?.sid : undefined;
  if (!sid) throw new DflightAuthError("d-flight: kein socket.io-Handshake", "server");
  const url = `${base}&sid=${encodeURIComponent(sid)}`;
  const post = (body: string) =>
    fetchWithTimeout(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body }, left());
  await post("40");
  let requested = false;
  while (Date.now() < deadline) {
    const payload = await (await fetchWithTimeout(`${url}&t=${Date.now()}`, {}, left())).text();
    const cfg = parseSocketConfigPackets(payload);
    if (cfg) return cfg;
    const packets = payload.split("\x1e");
    if (packets.some((p) => p.startsWith("44"))) throw new DflightAuthError("d-flight: socket.io-Verbindung abgelehnt", "server");
    if (packets.includes("2")) await post("3");
    if (!requested && packets.some((p) => p.startsWith("40"))) {
      requested = true;
      await post(`42${JSON.stringify([DFLIGHT_CONFIG_REQUEST_EVENT])}`);
    }
  }
  throw new DflightAuthError("d-flight: Zeitüberschreitung bei der Konfiguration (Polling)", "network");
}

type CachedConfig = DflightRuntimeConfig & { publicKeyPem: string; at: number };
let cachedConfig: CachedConfig | null = null;

/** Laufzeitkonfiguration + entschlüsselten CSRF-Key holen (gecacht). */
export async function getDflightRuntimeConfig(force = false): Promise<CachedConfig> {
  if (!force && cachedConfig && Date.now() - cachedConfig.at < CONFIG_TTL_MS) return cachedConfig;
  let event: any;
  try {
    event = await fetchSocketConfigViaWebSocket();
  } catch {
    event = await fetchSocketConfigViaPolling();
  }
  const cfg = runtimeConfigFromEvent(event);
  cachedConfig = { ...cfg, publicKeyPem: decryptCsrfPublicKey(cfg.csrfPubKey), at: Date.now() };
  return cachedConfig;
}

/** GET {gateway}/pre-flight -> value. */
export async function fetchPreflightValue(gatewayBaseUrl: string = DFLIGHT_DEFAULT_GATEWAY_URL): Promise<string | number> {
  const res = await fetchWithTimeout(`${gatewayBaseUrl.replace(/\/+$/, "")}/pre-flight`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new DflightAuthError(`d-flight pre-flight: HTTP ${res.status}`, "server", res.status);
  const body: any = await res.json();
  if (body?.value == null) throw new DflightAuthError("d-flight pre-flight: kein Wert", "server");
  return body.value;
}

/** Frische CSRF-Header für genau eine Anfrage. */
export async function getDflightCsrfHeaders(forceConfig = false): Promise<DflightCsrfHeaders> {
  const cfg = await getDflightRuntimeConfig(forceConfig);
  const value = await fetchPreflightValue(cfg.gatewayBaseUrl);
  return buildCsrfHeaders(cfg.publicKeyPem, value);
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export type DflightToken = {
  accessToken: string;
  refreshToken?: string;
  /** ms seit Epoch */
  expiresAt: number;
  refreshExpiresAt?: number;
};

let currentToken: DflightToken | null = null;

function tokenFromResponse(body: any): DflightToken {
  const now = Date.now();
  if (!body?.access_token) throw new DflightAuthError("d-flight: Antwort ohne Access-Token", "server");
  const exp = Number(body.expires_in);
  const rexp = Number(body.refresh_expires_in);
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresAt: now + (Number.isFinite(exp) && exp > 0 ? exp : 300) * 1000,
    refreshExpiresAt: Number.isFinite(rexp) && rexp > 0 ? now + rexp * 1000 : undefined,
  };
}

export const DFLIGHT_DIRECT_GRANT_DISABLED_MESSAGE = "d-flight-Anmeldung per App nicht möglich – bitte melden";

/** Keycloak-/Gateway-Fehler in eine verständliche deutsche Meldung übersetzen. */
export function dflightLoginErrorMessage(status: number, body: any): DflightAuthError {
  const raw = typeof body === "string" ? body : JSON.stringify(body ?? "");
  const desc = String(body?.error_description ?? body?.message ?? "");
  if (status === 403 && /missing headers|malformed headers/i.test(raw)) {
    return new DflightAuthError("d-flight: Sicherheitsprüfung (CSRF) fehlgeschlagen", "csrf", status);
  }
  // Keycloak: Password-Grant (Direct Access Grants) für den Client abgeschaltet.
  // Laut Doku (2026-11-15) funktioniert er; falls d-flight ihn sperrt, liegt es
  // nicht an den Zugangsdaten des Nutzers.
  if (body?.error === "unauthorized_client" || /direct access grants/i.test(desc)) {
    return new DflightAuthError(DFLIGHT_DIRECT_GRANT_DISABLED_MESSAGE, "server", status);
  }
  if (/not fully set up/i.test(desc)) {
    return new DflightAuthError("d-flight-Konto ist noch nicht vollständig eingerichtet (bitte auf d-flight.it abschließen)", "credentials", status);
  }
  if (/disabled/i.test(desc)) return new DflightAuthError("d-flight-Konto ist gesperrt", "credentials", status);
  if (body?.error === "invalid_grant" || status === 400 || status === 401) {
    return new DflightAuthError("d-flight: Benutzername oder Passwort falsch", "credentials", status);
  }
  return new DflightAuthError(`d-flight-Anmeldung fehlgeschlagen (HTTP ${status})`, "server", status);
}

async function postTokenRequest(url: string, form: string): Promise<DflightToken> {
  let lastErr: DflightAuthError | null = null;
  // Zweiter Versuch mit frisch geholter Konfiguration, falls der CSRF-Key rotiert wurde.
  for (const forceConfig of [false, true]) {
    const csrf = await getDflightCsrfHeaders(forceConfig);
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...csrf },
      body: form,
    });
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Klartext-Fehler
    }
    if (res.ok) return tokenFromResponse(body);
    lastErr = dflightLoginErrorMessage(res.status, body);
    if (lastErr.kind !== "csrf") throw lastErr;
  }
  throw lastErr!;
}

/** Password-Grant mit den übergebenen Zugangsdaten (Benutzername kleingeschrieben, wie die Web-App). */
export async function dflightLogin(username: string, password: string): Promise<DflightToken> {
  const form =
    `scope=${encodeURIComponent(DFLIGHT_SCOPE)}&grant_type=password&client_id=${DFLIGHT_CLIENT_ID}` +
    `&username=${encodeURIComponent(username.trim().toLowerCase())}&password=${encodeURIComponent(password)}`;
  return postTokenRequest(DFLIGHT_TOKEN_URL, form);
}

/** Refresh-Grant (eigener Gateway-Pfad /token/refresh). */
export async function dflightRefresh(refreshToken: string): Promise<DflightToken> {
  const form = `grant_type=refresh_token&client_id=${DFLIGHT_CLIENT_ID}&refresh_token=${encodeURIComponent(refreshToken)}`;
  return postTokenRequest(DFLIGHT_REFRESH_URL, form);
}

// ---------------------------------------------------------------------------
// Zugangsdaten (SecureStore)
// ---------------------------------------------------------------------------

function secureStore(): typeof import("expo-secure-store") {
  // Erst bei Bedarf laden: hält dieses Modul unter Node/tsx importierbar.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-secure-store");
}

export async function getDflightCredentials(): Promise<{ username: string; password: string } | null> {
  try {
    const ss = secureStore();
    const [username, password] = await Promise.all([
      ss.getItemAsync(DFLIGHT_USERNAME_KEY),
      ss.getItemAsync(DFLIGHT_PASSWORD_KEY),
    ]);
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

/**
 * Prüft die Zugangsdaten per Login und speichert sie nur bei Erfolg.
 * Liefert {ok:false, error} mit deutscher Meldung bei Fehlern.
 */
/** Beim App-Start: merken, ob ein d-flight-Zugang eingetragen ist (für hasOwnMap). */
export async function initDflightAccessFlag(): Promise<void> {
  try {
    setCountryAccessAvailable("IT", !!(await getDflightCredentials()));
  } catch {
    setCountryAccessAvailable("IT", false);
  }
}

export async function setDflightCredentials(
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const u = String(username ?? "").trim();
  const p = String(password ?? "");
  if (!u || !p) return { ok: false, error: "Bitte Benutzername und Passwort eingeben" };
  try {
    const token = await dflightLogin(u, p);
    const ss = secureStore();
    await ss.setItemAsync(DFLIGHT_USERNAME_KEY, u);
    await ss.setItemAsync(DFLIGHT_PASSWORD_KEY, p);
    currentToken = token;
    setCountryAccessAvailable("IT", true);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "d-flight-Anmeldung fehlgeschlagen" };
  }
}

export async function clearDflightCredentials(): Promise<void> {
  currentToken = null;
  setCountryAccessAvailable("IT", false);
  try {
    const ss = secureStore();
    await ss.deleteItemAsync(DFLIGHT_USERNAME_KEY).catch(() => {});
    await ss.deleteItemAsync(DFLIGHT_PASSWORD_KEY).catch(() => {});
  } catch {
    // SecureStore nicht verfügbar – nichts zu löschen
  }
}

export const DFLIGHT_NO_CREDENTIALS_MESSAGE = "Kein d-flight-Zugang eingetragen";

/**
 * Gültigen Access-Token liefern: gecacht -> Refresh -> Login mit gespeicherten
 * Zugangsdaten. Wirft „Kein d-flight-Zugang eingetragen“ ohne Zugangsdaten.
 */
export async function getDflightAccessToken(forceNew = false): Promise<string> {
  const now = Date.now();
  if (!forceNew && currentToken && currentToken.expiresAt - TOKEN_SAFETY_MS > now) return currentToken.accessToken;
  if (
    currentToken?.refreshToken &&
    (currentToken.refreshExpiresAt == null || currentToken.refreshExpiresAt - TOKEN_SAFETY_MS > now)
  ) {
    try {
      currentToken = await dflightRefresh(currentToken.refreshToken);
      return currentToken.accessToken;
    } catch (e) {
      if (e instanceof DflightAuthError && e.kind === "network") throw e;
      currentToken = null; // Refresh abgelaufen -> neu anmelden
    }
  }
  const creds = await getDflightCredentials();
  if (!creds) throw new DflightAuthError(DFLIGHT_NO_CREDENTIALS_MESSAGE, "credentials");
  currentToken = await dflightLogin(creds.username, creds.password);
  return currentToken.accessToken;
}

/**
 * Authentifizierte GET-Anfrage (Bearer + frische CSRF-Header). Bei 401 wird
 * einmal mit neuem Token (und frischer Konfiguration) wiederholt.
 */
export async function dflightAuthorizedGet(url: string, timeoutMs: number = 120_000, accept = "application/json, application/zip, */*"): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getDflightAccessToken(attempt > 0);
    const csrf = await getDflightCsrfHeaders(attempt > 0);
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: accept, Authorization: `Bearer ${token}`, ...csrf } },
      timeoutMs,
    );
    if ((res.status === 401 || res.status === 403) && attempt === 0) continue;
    return res;
  }
  throw new DflightAuthError("d-flight: Anfrage nicht autorisiert", "server");
}

/**
 * GeoServer-WFS (/maps/wms): laut Doku („Anhang IT“) genügt der Bearer-Token,
 * der CSRF-/Pre-Flight-Weg ist dort nicht nötig. Bei 401/403 einmal mit neuem
 * Token UND (falls erhältlich) CSRF-Headern wiederholen. Liefert die Antwort
 * unverändert (auch 401/403) – der Aufrufer entscheidet über die Meldung.
 */
export async function dflightBearerGet(url: string, timeoutMs: number = 120_000, accept = "application/json"): Promise<Response> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getDflightAccessToken(attempt > 0);
    let csrf: Partial<DflightCsrfHeaders> = {};
    if (attempt > 0) {
      try {
        csrf = await getDflightCsrfHeaders(true);
      } catch {
        // CSRF ist für den WFS nicht vorgeschrieben – ohne weiter versuchen.
      }
    }
    res = await fetchWithTimeout(url, { headers: { Accept: accept, Authorization: `Bearer ${token}`, ...csrf } }, timeoutMs);
    if (res.status !== 401 && res.status !== 403) return res;
  }
  return res!;
}

/** Nur für Tests: In-Memory-Zustand zurücksetzen. */
export function __resetDflightAuthStateForTests(): void {
  cachedConfig = null;
  currentToken = null;
}
