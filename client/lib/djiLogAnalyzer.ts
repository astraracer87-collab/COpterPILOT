/**
 * Ablauf einer DJI-Log-Auswertung auf dem Gerät:
 *
 *   Datei stückweise → Worker (WebView) → Kopf lesen (Version, Details)
 *     ├─ < v13: direkt auswerten
 *     └─ ≥ v13: Keychains aus dem Cache, sonst mit dem API-Schlüssel des
 *               Piloten bei DJI abrufen (und cachen) → auswerten
 *   → Kennzahlen + Zeilen → DjiLogMeta (djiLogMapping.ts)
 *
 * Ohne Schlüssel / offline / Kontingent: Ergebnis mit status "undecryptable"
 * und Basis-Kennzahlen aus dem Details-Block, Meldung auf Deutsch.
 *
 * RN-frei; alle Abhängigkeiten werden übergeben (Tests: vm-Worker, Fake-fetch).
 */
import type { DjiAnalyzeResult } from "./djiLogCore";
import { DjiKeychainError, djiKeychainErrorMessage } from "./djiKeychainApi";
import {
  buildParsedMeta,
  buildUndecryptableMeta,
  localObjectPath,
  toAnalyzeResult,
} from "./djiLogMapping";
import { DjiWorkerError, type DjiParseOutput } from "./djiLogWorkerClient";
import {
  DJI_ROW_COLUMNS,
  base64ByteLength,
  type DjiInspectInfo,
  type DjiKeychains,
  type DjiKeychainsRequest,
} from "./djiLogWorkerProtocol";

/** Obergrenze je Datei (lokal ausgewertet; lange Flüge haben einige MB). */
export const MAX_LOCAL_DJI_LOG_BYTES = 40 * 1024 * 1024;

export interface DjiLogSource {
  fileName: string;
  sizeBytes?: number;
  /** Base64 des i-ten Stücks (DJI_CHUNK_BYTES) oder null am Dateiende. */
  readChunk(index: number): Promise<string | null>;
}

export interface DjiWorkerLike {
  upload(
    jobId: string,
    fileName: string,
    readChunk: (i: number) => Promise<string | null>,
    onChunk?: (i: number) => void,
  ): Promise<number>;
  inspect(jobId: string): Promise<DjiInspectInfo>;
  parse(
    jobId: string,
    keychains?: DjiKeychains | null,
    onRows?: (received: number, total: number) => void,
  ): Promise<DjiParseOutput>;
  release(jobId: string): void;
}

export interface DjiKeychainCacheLike {
  get(fingerprint: string): Promise<DjiKeychains | null>;
  set(fingerprint: string, keychains: DjiKeychains): Promise<void>;
  remove(fingerprint: string): Promise<void>;
}

export type DjiAnalyzePhase = "read" | "decode" | "keys" | "rows";

export interface DjiAnalyzerDeps {
  worker: DjiWorkerLike;
  getApiKey(): Promise<string | null>;
  fetchKeychains(
    apiKey: string,
    request: DjiKeychainsRequest,
  ): Promise<DjiKeychains>;
  cache: DjiKeychainCacheLike;
  onPhase?(phase: DjiAnalyzePhase, fraction?: number): void;
  /** Zwischen Schritten an die UI abgeben (yieldingWork.checkpoint). */
  checkpoint?(): Promise<void>;
  now?(): Date;
}

let jobCounter = 0;

/** Deutsche Meldung für Worker-Fehler. */
export function djiWorkerErrorMessage(e: unknown): string {
  if (e instanceof DjiWorkerError) {
    switch (e.code) {
      case "not_a_log":
        return "Keine gültige DJI-Flugprotokoll-Datei. Bitte die „DJIFlightRecord_….txt“ aus DJI Fly/GO/Pilot wählen (.DAT-Dateien werden nicht unterstützt).";
      case "unsupported":
        return "Diese Protokoll-Version wird vom eingebauten Parser noch nicht unterstützt.";
      case "decrypt_failed":
        return "Das Protokoll ließ sich nicht entschlüsseln – die DJI-Schlüssel passen nicht zu dieser Datei.";
      case "keychain_required":
        return djiKeychainErrorMessage("no_key");
      case "timeout":
      case "closed":
      case "internal":
      case "unknown_job":
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

function tooLarge(): Error {
  return new Error(
    `Datei ist zu groß (max. ${Math.round(MAX_LOCAL_DJI_LOG_BYTES / 1024 / 1024)} MB).`,
  );
}

/** Eine Datei vollständig auswerten. Wirft nur bei unlesbaren Dateien/Worker-Fehlern. */
export async function analyzeDjiLogSource(
  src: DjiLogSource,
  deps: DjiAnalyzerDeps,
): Promise<DjiAnalyzeResult> {
  if (src.sizeBytes != null && src.sizeBytes > MAX_LOCAL_DJI_LOG_BYTES)
    throw tooLarge();
  const jobId = `dji-${Date.now().toString(36)}-${(++jobCounter).toString(36)}`;
  const nowIso = () => (deps.now ? deps.now() : new Date()).toISOString();
  const cp = async () => {
    if (deps.checkpoint) await deps.checkpoint();
  };
  let readBytes = 0;
  try {
    deps.onPhase?.("read", 0);
    const chunks = await deps.worker.upload(jobId, src.fileName, async (i) => {
      const data = await src.readChunk(i);
      if (data) {
        readBytes += base64ByteLength(data);
        if (readBytes > MAX_LOCAL_DJI_LOG_BYTES) throw tooLarge();
        if (src.sizeBytes)
          deps.onPhase?.("read", Math.min(1, readBytes / src.sizeBytes));
      }
      return data;
    });
    if (chunks === 0) throw new Error("Datei ist leer.");
    await cp();

    deps.onPhase?.("decode");
    const info = await deps.worker.inspect(jobId);
    const file = {
      fileName: src.fileName,
      objectPath: localObjectPath(info.fingerprint),
      sizeBytes: src.sizeBytes ?? info.byteLength,
    };

    let keychains: DjiKeychains | null = null;
    let keychainSource: "cache" | "api" | undefined;
    if (info.keychainsRequired) {
      deps.onPhase?.("keys");
      keychains = await deps.cache.get(info.fingerprint);
      keychainSource = keychains ? "cache" : undefined;
      if (!keychains) {
        const fetched = await fetchKeys(info, deps);
        if ("message" in fetched) {
          return toAnalyzeResult(
            buildUndecryptableMeta(file, info, fetched.message, {
              parsedAt: nowIso(),
            }),
          );
        }
        keychains = fetched.keychains;
        keychainSource = "api";
        await deps.cache.set(info.fingerprint, keychains);
      }
    }

    let out: DjiParseOutput;
    try {
      out = await deps.worker.parse(jobId, keychains, (got, total) =>
        deps.onPhase?.("rows", total ? got / total : 1),
      );
    } catch (e) {
      // Veraltete/falsche Schlüssel im Cache: verwerfen und einmal frisch abrufen
      if (
        e instanceof DjiWorkerError &&
        e.code === "decrypt_failed" &&
        keychainSource === "cache"
      ) {
        await deps.cache.remove(info.fingerprint);
        const fetched = await fetchKeys(info, deps);
        if ("message" in fetched) {
          return toAnalyzeResult(
            buildUndecryptableMeta(file, info, fetched.message, {
              parsedAt: nowIso(),
            }),
          );
        }
        keychains = fetched.keychains;
        keychainSource = "api";
        out = await deps.worker.parse(jobId, keychains);
        await deps.cache.set(info.fingerprint, keychains);
      } else {
        throw e;
      }
    }
    await cp();
    if (out.summary.columns.join(",") !== DJI_ROW_COLUMNS.join(",")) {
      throw new Error(
        "Interner Fehler: Spalten der Log-Auswertung passen nicht zur App-Version.",
      );
    }
    const meta = buildParsedMeta(file, out.summary, out.rows, {
      parsedAt: nowIso(),
      keychainSource,
    });
    return toAnalyzeResult(meta);
  } catch (e) {
    if (e instanceof DjiWorkerError) throw new Error(djiWorkerErrorMessage(e));
    throw e;
  } finally {
    deps.worker.release(jobId);
  }
}

async function fetchKeys(
  info: DjiInspectInfo,
  deps: DjiAnalyzerDeps,
): Promise<{ keychains: DjiKeychains } | { message: string }> {
  const apiKey = await deps.getApiKey();
  if (!apiKey) return { message: djiKeychainErrorMessage("no_key") };
  if (!info.keychainsRequest)
    return {
      message: djiKeychainErrorMessage(
        "bad_response",
        "keine Schlüsselmerkmale im Log",
      ),
    };
  try {
    return {
      keychains: await deps.fetchKeychains(apiKey, info.keychainsRequest),
    };
  } catch (e) {
    if (e instanceof DjiKeychainError) return { message: e.message };
    return { message: e instanceof Error ? e.message : String(e) };
  }
}
