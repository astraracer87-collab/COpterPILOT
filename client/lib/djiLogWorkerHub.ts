/**
 * Verwaltet die EINE versteckte Worker-WebView für DJI-Logs:
 *
 * - acquire(): Bedarf anmelden → die Host-Komponente (DjiLogWorkerHost, in
 *   App.tsx eingehängt) rendert die WebView, verbindet sich per attach() und
 *   der Client wartet auf "ready" (WebAssembly geladen).
 * - releaseClient(): Bedarf abmelden; nach einer Leerlaufzeit wird die WebView
 *   wieder entfernt (Speicher frei).
 * - detach(): WebView beendet/abgestürzt → laufende Aufträge enden mit Fehler.
 *
 * RN-frei (die WebView selbst lebt in der Host-Komponente).
 */
import { DjiWorkerClient, DjiWorkerError } from "./djiLogWorkerClient";
import { encodeWorkerRequest } from "./djiLogWorkerProtocol";

export const DJI_WORKER_IDLE_MS = 45_000;
export const DJI_WORKER_START_TIMEOUT_MS = 25_000;

type Listener = () => void;

class DjiLogWorkerHub {
  private client: DjiWorkerClient | null = null;
  private users = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private generation = 0;
  private listeners = new Set<Listener>();
  private attachWaiters: ((c: DjiWorkerClient) => void)[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Soll die WebView gerade existieren? */
  isWanted(): boolean {
    return this.wanted;
  }

  /** Zähler, der bei jedem Neustart wächst (key der WebView). */
  getGeneration(): number {
    return this.generation;
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        // ignorieren
      }
    });
  }

  /** Host: WebView ist eingehängt; inject = webViewRef.injectJavaScript. */
  attach(inject: (js: string) => void): DjiWorkerClient {
    this.client?.reset("Die Log-Auswertung wurde neu gestartet.");
    const client = new DjiWorkerClient((msg) =>
      inject(encodeWorkerRequest(msg)),
    );
    this.client = client;
    this.attachWaiters.splice(0).forEach((w) => w(client));
    return client;
  }

  /** Host: Nachricht der WebView. */
  onMessage(raw: unknown): void {
    this.client?.handleRaw(raw);
  }

  /** Host: WebView entfernt oder abgestürzt. */
  detach(reason?: string, opts: { restart?: boolean } = {}): void {
    const c = this.client;
    this.client = null;
    c?.reset(reason);
    if (opts.restart && this.wanted) {
      this.generation++;
      this.notify();
    }
  }

  async acquire(
    timeoutMs = DJI_WORKER_START_TIMEOUT_MS,
  ): Promise<DjiWorkerClient> {
    this.users++;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.wanted) {
      this.wanted = true;
      this.notify();
    }
    try {
      const client =
        this.client ??
        (await new Promise<DjiWorkerClient>((resolve, reject) => {
          const t = setTimeout(() => {
            const i = this.attachWaiters.indexOf(resolve);
            if (i >= 0) this.attachWaiters.splice(i, 1);
            reject(
              new DjiWorkerError(
                "timeout",
                "Die Log-Auswertung konnte nicht gestartet werden (WebView nicht verfügbar).",
              ),
            );
          }, timeoutMs);
          unref(t);
          this.attachWaiters.push((c) => {
            clearTimeout(t);
            resolve(c);
          });
        }));
      await withTimeout(
        client.whenReady(),
        timeoutMs,
        "Der DJI-Log-Parser startet nicht (WebAssembly in der WebView nicht verfügbar?).",
      );
      return client;
    } catch (e) {
      this.releaseClient();
      throw e;
    }
  }

  releaseClient(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0 || this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.users > 0) return;
      this.wanted = false;
      this.notify();
    }, DJI_WORKER_IDLE_MS);
    unref(this.idleTimer);
  }
}

/** Node/Jest: Zeitgeber halten den Prozess nicht am Leben (RN: ohne Wirkung). */
function unref(t: unknown): void {
  (t as { unref?: () => void } | null)?.unref?.();
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new DjiWorkerError("timeout", message)),
      ms,
    );
    unref(t);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export const djiLogWorkerHub = new DjiLogWorkerHub();
