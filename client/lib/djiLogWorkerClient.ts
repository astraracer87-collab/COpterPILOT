/**
 * App-Seite des DJI-Log-Workers: spricht das Protokoll aus
 * djiLogWorkerProtocol.ts mit der versteckten WebView.
 *
 * - Dateiinhalt geht in Base64-Stücken hinein; jedes Stück wird quittiert,
 *   bevor das nächste folgt (Flusskontrolle, kein Stau auf der Brücke).
 * - Ergebnisse kommen gestreamt (summary, rows…, done) zurück.
 * - Jeder Schritt hat ein Zeitlimit; stirbt die WebView, werden alle
 *   wartenden Aufträge mit Fehler beendet (reset()).
 *
 * RN-frei: der Transport (injectJavaScript) wird übergeben – Tests verbinden
 * den Client direkt mit dem Worker-Skript in einem Node-vm-Kontext.
 */
import {
  decodeWorkerResponse,
  type DjiInspectInfo,
  type DjiKeychains,
  type DjiParseSummary,
  type DjiRow,
  type DjiWorkerErrorCode,
  type DjiWorkerRequest,
  type DjiWorkerResponse,
} from "./djiLogWorkerProtocol";

export class DjiWorkerError extends Error {
  code: DjiWorkerErrorCode | "timeout" | "closed";
  constructor(code: DjiWorkerError["code"], message: string) {
    super(message);
    this.name = "DjiWorkerError";
    this.code = code;
  }
}

export interface DjiParseOutput {
  summary: DjiParseSummary;
  rows: DjiRow[];
}

type Pending =
  | {
      kind: "inspect";
      resolve: (v: DjiInspectInfo) => void;
      reject: (e: Error) => void;
      timer: unknown;
    }
  | {
      kind: "parse";
      resolve: (v: DjiParseOutput) => void;
      reject: (e: Error) => void;
      timer: unknown;
      summary: DjiParseSummary | null;
      chunks: DjiRow[][];
      onRows?: (received: number, total: number) => void;
      received: number;
      total: number;
    };

interface AckWaiter {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: unknown;
}

export interface DjiWorkerClientOptions {
  ackTimeoutMs?: number;
  inspectTimeoutMs?: number;
  parseTimeoutMs?: number;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (t: unknown) => void;
}

export class DjiWorkerClient {
  private send: (msg: DjiWorkerRequest) => void;
  private pending = new Map<string, Pending>();
  private acks = new Map<string, AckWaiter>();
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] =
    [];
  private readyState: "waiting" | "ready" | "failed" = "waiting";
  private readyError: Error | null = null;
  private opts: Required<DjiWorkerClientOptions>;
  parserVersion: string | undefined;

  constructor(
    send: (msg: DjiWorkerRequest) => void,
    opts: DjiWorkerClientOptions = {},
  ) {
    this.send = send;
    this.opts = {
      ackTimeoutMs: opts.ackTimeoutMs ?? 30_000,
      inspectTimeoutMs: opts.inspectTimeoutMs ?? 60_000,
      parseTimeoutMs: opts.parseTimeoutMs ?? 240_000,
      setTimeoutImpl:
        opts.setTimeoutImpl ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms);
          (t as { unref?: () => void }).unref?.();
          return t;
        }),
      clearTimeoutImpl:
        opts.clearTimeoutImpl ??
        ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
    };
  }

  get isReady(): boolean {
    return this.readyState === "ready";
  }

  whenReady(): Promise<void> {
    if (this.readyState === "ready") return Promise.resolve();
    if (this.readyState === "failed") return Promise.reject(this.readyError);
    return new Promise((resolve, reject) =>
      this.readyWaiters.push({ resolve, reject }),
    );
  }

  /** Rohnachricht der WebView (onMessage → nativeEvent.data). */
  handleRaw(raw: unknown): void {
    const msg = decodeWorkerResponse(raw);
    if (msg) this.handle(msg);
  }

  handle(msg: DjiWorkerResponse): void {
    switch (msg.type) {
      case "ready":
        this.readyState = "ready";
        this.parserVersion = msg.parserVersion;
        this.readyWaiters.splice(0).forEach((w) => w.resolve());
        return;
      case "fatal": {
        this.readyState = "failed";
        this.readyError = new DjiWorkerError(
          "internal",
          `Der DJI-Log-Parser ließ sich in der WebView nicht starten (${msg.message}). Ist die Android System WebView aktuell?`,
        );
        this.readyWaiters.splice(0).forEach((w) => w.reject(this.readyError!));
        return;
      }
      case "ack": {
        const key = `${msg.jobId}:${msg.index}`;
        const w = this.acks.get(key);
        if (!w) return;
        this.acks.delete(key);
        this.opts.clearTimeoutImpl(w.timer);
        w.resolve();
        return;
      }
      case "inspected": {
        const p = this.pending.get(msg.jobId);
        if (!p || p.kind !== "inspect") return;
        this.finish(msg.jobId);
        p.resolve(msg.info);
        return;
      }
      case "summary": {
        const p = this.pending.get(msg.jobId);
        if (!p || p.kind !== "parse") return;
        p.summary = msg.summary;
        p.total = msg.totalRows;
        p.chunks = new Array(msg.rowChunks);
        p.onRows?.(0, p.total);
        return;
      }
      case "rows": {
        const p = this.pending.get(msg.jobId);
        if (!p || p.kind !== "parse") return;
        p.chunks[msg.index] = msg.rows;
        p.received += msg.rows.length;
        p.onRows?.(p.received, p.total);
        return;
      }
      case "done": {
        const p = this.pending.get(msg.jobId);
        if (!p || p.kind !== "parse") return;
        this.finish(msg.jobId);
        if (!p.summary) {
          p.reject(
            new DjiWorkerError(
              "internal",
              "Auswertung ohne Kennzahlen beendet",
            ),
          );
          return;
        }
        const rows: DjiRow[] = [];
        for (const c of p.chunks) if (c) for (const r of c) rows.push(r);
        p.resolve({ summary: p.summary, rows });
        return;
      }
      case "error": {
        const err = new DjiWorkerError(msg.code, msg.message);
        // Fehler kann ein Stück (ack) oder den laufenden Schritt betreffen
        for (const [key, w] of this.acks) {
          if (key.startsWith(`${msg.jobId}:`)) {
            this.acks.delete(key);
            this.opts.clearTimeoutImpl(w.timer);
            w.reject(err);
          }
        }
        const p = this.pending.get(msg.jobId);
        if (p) {
          this.finish(msg.jobId);
          p.reject(err);
        }
        return;
      }
    }
  }

  private finish(jobId: string): void {
    const p = this.pending.get(jobId);
    if (p) this.opts.clearTimeoutImpl(p.timer);
    this.pending.delete(jobId);
  }

  private waitAck(jobId: string, index: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const key = `${jobId}:${index}`;
      const timer = this.opts.setTimeoutImpl(() => {
        this.acks.delete(key);
        reject(
          new DjiWorkerError(
            "timeout",
            "Die Log-Auswertung reagiert nicht (Datenübergabe).",
          ),
        );
      }, this.opts.ackTimeoutMs);
      this.acks.set(key, { resolve, reject, timer });
    });
  }

  /**
   * Datei stückweise übergeben. readChunk(i) liefert Base64 des i-ten Stücks
   * oder null am Dateiende.
   */
  async upload(
    jobId: string,
    fileName: string,
    readChunk: (index: number) => Promise<string | null>,
    onChunk?: (index: number) => void,
  ): Promise<number> {
    await this.whenReady();
    const begun = this.waitAck(jobId, -1);
    this.send({ type: "begin", jobId, fileName });
    await begun;
    let index = 0;
    for (;;) {
      const data = await readChunk(index);
      if (data == null || data.length === 0) break;
      const acked = this.waitAck(jobId, index);
      this.send({ type: "chunk", jobId, index, data });
      await acked;
      onChunk?.(index);
      index++;
    }
    return index;
  }

  inspect(jobId: string): Promise<DjiInspectInfo> {
    return new Promise((resolve, reject) => {
      const timer = this.opts.setTimeoutImpl(() => {
        this.pending.delete(jobId);
        reject(
          new DjiWorkerError(
            "timeout",
            "Die Log-Auswertung reagiert nicht (Kopfdaten).",
          ),
        );
      }, this.opts.inspectTimeoutMs);
      this.pending.set(jobId, { kind: "inspect", resolve, reject, timer });
      this.send({ type: "inspect", jobId });
    });
  }

  parse(
    jobId: string,
    keychains?: DjiKeychains | null,
    onRows?: (received: number, total: number) => void,
  ): Promise<DjiParseOutput> {
    return new Promise((resolve, reject) => {
      const timer = this.opts.setTimeoutImpl(() => {
        this.pending.delete(jobId);
        reject(
          new DjiWorkerError(
            "timeout",
            "Die Log-Auswertung hat zu lange gedauert.",
          ),
        );
      }, this.opts.parseTimeoutMs);
      this.pending.set(jobId, {
        kind: "parse",
        resolve,
        reject,
        timer,
        summary: null,
        chunks: [],
        onRows,
        received: 0,
        total: 0,
      });
      this.send({ type: "parse", jobId, keychains: keychains ?? null });
    });
  }

  release(jobId: string): void {
    this.finish(jobId);
    try {
      this.send({ type: "release", jobId });
    } catch {
      // WebView schon weg
    }
  }

  /** WebView beendet/abgestürzt: alle Wartenden mit Fehler beenden. */
  reset(reason = "Die Log-Auswertung (WebView) wurde beendet."): void {
    const err = new DjiWorkerError("closed", reason);
    for (const w of this.acks.values()) {
      this.opts.clearTimeoutImpl(w.timer);
      w.reject(err);
    }
    this.acks.clear();
    for (const p of this.pending.values()) {
      this.opts.clearTimeoutImpl(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    if (this.readyState !== "ready") {
      this.readyState = "failed";
      this.readyError = err;
      this.readyWaiters.splice(0).forEach((w) => w.reject(err));
    }
  }
}
