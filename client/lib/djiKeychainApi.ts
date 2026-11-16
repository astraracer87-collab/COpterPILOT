/**
 * DJI Open API: Entschlüsselungs-Schlüssel ("Keychains") für Flugprotokolle
 * ab Version 13, direkt vom Gerät abgerufen (kein eigener Server).
 *
 *   POST https://dev.dji.com/openapi/v1/flight-records/keychains
 *   Header: Api-Key: <Schlüssel des Piloten>, Content-Type: application/json
 *   Body:   { version, department, keychainsArray: [[{ featurePoint, aesCiphertext }]] }
 *   Antwort: { result: { code, msg }, data: [[{ featurePoint, aesKey, aesIv }]] }
 *
 * (Format laut dji-log-parser, keychain/api.rs.) Der Body entsteht im Worker
 * aus den KeyStorage-Datensätzen des Logs (DJILog.keychainsRequest()).
 *
 * Der API-Schlüssel wird nie protokolliert und nur an dev.dji.com gesendet.
 * RN-frei; fetch ist für Tests austauschbar.
 */
import type { DjiKeychains, DjiKeychainsRequest } from "./djiLogWorkerProtocol";

export const DJI_KEYCHAINS_ENDPOINT =
  "https://dev.dji.com/openapi/v1/flight-records/keychains";

export type DjiKeychainErrorCode =
  | "no_key"
  | "invalid_key"
  | "quota"
  | "offline"
  | "version"
  | "server"
  | "bad_response";

export const DJI_KEY_SETTINGS_HINT =
  "Einstellungen → Karten, Hindernisse & Offline → DJI-Flugprotokolle";

export function djiKeychainErrorMessage(
  code: DjiKeychainErrorCode,
  detail?: string,
): string {
  switch (code) {
    case "no_key":
      return `Verschlüsseltes Protokoll (ab Version 13): Für die vollständige Auswertung wird ein DJI-API-Schlüssel benötigt (${DJI_KEY_SETTINGS_HINT}).`;
    case "invalid_key":
      return `Der DJI-API-Schlüssel wurde abgelehnt. Bitte den Schlüssel prüfen und sicherstellen, dass die App im DJI-Entwicklerportal aktiviert ist (${DJI_KEY_SETTINGS_HINT}).`;
    case "quota":
      return "Das Abruf-Kontingent des DJI-API-Schlüssels ist erschöpft. Bitte später erneut versuchen – bereits ausgewertete Protokolle bleiben offline lesbar.";
    case "offline":
      return "Keine Verbindung zu DJI: Die Schlüssel für verschlüsselte Protokolle (ab Version 13) gibt es nur online. Einmal ausgewertete Protokolle lassen sich danach auch offline erneut auswerten.";
    case "version":
      return `DJI unterstützt diese Protokoll-Version nicht (mehr)${detail ? ` (${detail})` : ""}. Bitte DJI Fly aktualisieren bzw. das Protokoll neu exportieren.`;
    case "server":
      return `Der DJI-Server hat die Anfrage nicht beantwortet${detail ? ` (${detail})` : ""}. Bitte später erneut versuchen.`;
    case "bad_response":
    default:
      return `Unerwartete Antwort von DJI${detail ? ` (${detail})` : ""}.`;
  }
}

export class DjiKeychainError extends Error {
  code: DjiKeychainErrorCode;
  status?: number;
  constructor(code: DjiKeychainErrorCode, detail?: string, status?: number) {
    super(djiKeychainErrorMessage(code, detail));
    this.name = "DjiKeychainError";
    this.code = code;
    this.status = status;
  }
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}>;

export interface DjiKeychainFetchOptions {
  fetchImpl?: FetchLike;
  endpoint?: string;
  timeoutMs?: number;
}

/** Fehlermeldung der API (result.msg) einordnen. */
export function classifyApiMessage(msg: string): DjiKeychainErrorCode {
  const m = msg.toLowerCase();
  if (/(quota|limit|exceed|too many|frequen|times)/.test(m)) return "quota";
  if (
    /(api[-_ ]?key|apikey|unauthor|forbidden|auth|sign|permission|not activ|invalid key|app key)/.test(
      m,
    )
  )
    return "invalid_key";
  if (/version/.test(m)) return "version";
  return "server";
}

function classifyStatus(status: number): DjiKeychainErrorCode {
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "quota";
  if (status === 400 || status === 422) return "version";
  return "server";
}

function isKeychainArray(v: unknown): v is DjiKeychains {
  return (
    Array.isArray(v) &&
    v.every(
      (g) =>
        Array.isArray(g) &&
        g.every(
          (k) =>
            k &&
            typeof k === "object" &&
            typeof (k as Record<string, unknown>).featurePoint === "string" &&
            typeof (k as Record<string, unknown>).aesKey === "string" &&
            typeof (k as Record<string, unknown>).aesIv === "string",
        ),
    )
  );
}

async function postKeychains(
  apiKey: string,
  body: DjiKeychainsRequest,
  opts: DjiKeychainFetchOptions,
): Promise<{ status: number; ok: boolean; json: unknown }> {
  const key = String(apiKey ?? "").trim();
  if (!key) throw new DjiKeychainError("no_key");
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const ctrl =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl
    ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000)
    : null;
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(opts.endpoint ?? DJI_KEYCHAINS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-Key": key,
      },
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
  } catch {
    throw new DjiKeychainError("offline");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json };
}

function resultOf(json: unknown): { code?: number; msg?: string } | null {
  if (!json || typeof json !== "object") return null;
  const r = (json as { result?: unknown }).result;
  if (!r || typeof r !== "object") return null;
  const code = (r as { code?: unknown }).code;
  const msg = (r as { msg?: unknown }).msg;
  return {
    code: typeof code === "number" ? code : undefined,
    msg: typeof msg === "string" ? msg : undefined,
  };
}

/**
 * Schlüssel für ein Log abrufen. Wirft DjiKeychainError mit deutscher Meldung
 * (ungültiger Schlüssel, Kontingent, offline, Version, Serverfehler).
 */
export async function fetchDjiKeychains(
  apiKey: string,
  request: DjiKeychainsRequest,
  opts: DjiKeychainFetchOptions = {},
): Promise<DjiKeychains> {
  const { status, ok, json } = await postKeychains(apiKey, request, opts);
  const result = resultOf(json);
  if (!ok) {
    const code = result?.msg
      ? classifyApiMessage(result.msg)
      : classifyStatus(status);
    // Statuscode hat Vorrang bei eindeutigen Fällen
    const final =
      status === 401 || status === 403
        ? "invalid_key"
        : status === 429
          ? "quota"
          : code;
    throw new DjiKeychainError(final, result?.msg ?? `HTTP ${status}`, status);
  }
  if (!result)
    throw new DjiKeychainError("bad_response", `HTTP ${status}`, status);
  if (result.code !== 0) {
    throw new DjiKeychainError(
      classifyApiMessage(result.msg ?? ""),
      result.msg ?? `Code ${result.code}`,
      status,
    );
  }
  const data = (json as { data?: unknown }).data;
  if (!isKeychainArray(data))
    throw new DjiKeychainError(
      "bad_response",
      "keine Schlüssel in der Antwort",
      status,
    );
  return data;
}

export type DjiKeyCheck =
  | { ok: true; verified: true }
  | { ok: true; verified: false; warning: string }
  | { ok: false; error: string; code: DjiKeychainErrorCode };

/**
 * Günstige Prüfung des API-Schlüssels: Anfrage ohne Log-Merkmale. Ein
 * abgelehnter Schlüssel liefert 401/403 bzw. eine Auth-Meldung; jede andere
 * Antwort zeigt, dass DJI den Schlüssel akzeptiert hat. Offline kann nicht
 * geprüft werden (dann ok, aber unbestätigt).
 */
export async function validateDjiApiKey(
  apiKey: string,
  opts: DjiKeychainFetchOptions = {},
): Promise<DjiKeyCheck> {
  const key = String(apiKey ?? "").trim();
  if (!key)
    return {
      ok: false,
      code: "no_key",
      error: "Bitte einen API-Schlüssel eingeben.",
    };
  if (!/^[A-Za-z0-9._\-]{8,200}$/.test(key)) {
    return {
      ok: false,
      code: "invalid_key",
      error:
        "Das sieht nicht nach einem DJI-API-Schlüssel aus (nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich).",
    };
  }
  try {
    const { status, json } = await postKeychains(
      key,
      { version: 1, department: 3, keychainsArray: [] },
      opts,
    );
    if (status === 401 || status === 403) {
      return {
        ok: false,
        code: "invalid_key",
        error: djiKeychainErrorMessage("invalid_key"),
      };
    }
    if (status === 429) {
      // Schlüssel ist gültig, nur das Kontingent ist aufgebraucht.
      return {
        ok: true,
        verified: false,
        warning: djiKeychainErrorMessage("quota"),
      };
    }
    const result = resultOf(json);
    if (
      result &&
      result.code !== 0 &&
      result.msg &&
      classifyApiMessage(result.msg) === "invalid_key"
    ) {
      return {
        ok: false,
        code: "invalid_key",
        error: djiKeychainErrorMessage("invalid_key"),
      };
    }
    if (status >= 500) {
      return {
        ok: true,
        verified: false,
        warning: djiKeychainErrorMessage("server", `HTTP ${status}`),
      };
    }
    return { ok: true, verified: true };
  } catch (e) {
    if (e instanceof DjiKeychainError && e.code === "offline") {
      return {
        ok: true,
        verified: false,
        warning:
          "Ohne Internet nicht prüfbar – der Schlüssel wird gespeichert und beim ersten verschlüsselten Protokoll geprüft.",
      };
    }
    return {
      ok: false,
      code: "server",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
