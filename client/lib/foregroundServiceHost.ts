/**
 * Gemeinsamer Vordergrunddienst für mehrere Hintergrund-Aufgaben
 * (Radar-Überwachung, Ladegerät-Loggen).
 *
 * Warum: react-native-background-actions ist ein Singleton – EIN Dienst,
 * EINE Aufgabe, EINE Daueranzeige. Ein zweites `start()` ersetzt die erste
 * Aufgabe, `stop()` beendet alles. Zwei Aufgaben können also nicht
 * nebeneinander laufen. Dieser Host besitzt den Dienst und führt eine kleine
 * Registry von „Clients“:
 *   - erster `acquire` startet den Dienst; die Dienst-Aufgabe startet dann die
 *     Schleifen aller Clients (sie laufen im selben JS-Kontext nebeneinander);
 *   - weitere Clients hängen sich an (Daueranzeige wird aktualisiert);
 *     braucht ein Client einen Diensttyp, den der laufende Dienst nicht hat
 *     (z. B. „location“), wird der Dienst mit allen Typen neu gestartet;
 *   - `release` des letzten Clients beendet den Dienst;
 *   - endet die Schleife eines Clients von selbst, wird er freigegeben.
 * Die Daueranzeige zeigt den Client mit der höchsten Priorität; weitere
 * Clients stehen kurz im Text („· Ladegerät wird geloggt“).
 *
 * RN-frei: das native Backend kommt über `ForegroundServiceBackend`
 * (foregroundServiceHostNative.ts).
 */

export type ForegroundServiceType = "location" | "dataSync";

export interface ForegroundClientOptions {
  title: string;
  description: string;
  /** Kurzform für die Daueranzeige, wenn ein anderer Client vorne steht */
  shortLabel?: string;
  linkingURI: string;
  foregroundServiceType: ForegroundServiceType;
}

export interface ForegroundServiceStartOptions {
  title: string;
  description: string;
  linkingURI: string;
  types: ForegroundServiceType[];
}

export interface ForegroundServiceBackend {
  start(
    task: () => Promise<void>,
    opts: ForegroundServiceStartOptions,
  ): Promise<void>;
  stop(): Promise<void>;
  update(opts: ForegroundServiceStartOptions): Promise<void>;
}

export interface ForegroundServiceHost {
  /** Client anmelden (bzw. Optionen aktualisieren). Wirft, wenn der Dienst nicht startet. */
  acquire(
    id: string,
    task: () => Promise<void>,
    opts: ForegroundClientOptions,
    priority?: number,
  ): Promise<void>;
  release(id: string): Promise<void>;
  isActive(id: string): boolean;
  clientIds(): string[];
  running(): boolean;
}

interface Client {
  id: string;
  task: () => Promise<void>;
  opts: ForegroundClientOptions;
  priority: number;
  started: boolean;
  seq: number;
}

export function createForegroundServiceHost(
  backend: ForegroundServiceBackend,
  log?: (m: string) => void,
): ForegroundServiceHost {
  const clients = new Map<string, Client>();
  let nativeRunning = false;
  let hostRunning = false;
  let resolveHost: (() => void) | null = null;
  let types: ForegroundServiceType[] = [];
  let seq = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  function ordered(): Client[] {
    return [...clients.values()].sort(
      (a, b) => b.priority - a.priority || a.seq - b.seq,
    );
  }

  function combined(): ForegroundServiceStartOptions {
    const list = ordered();
    const primary = list[0];
    const others = list.slice(1).map((c) => c.opts.shortLabel ?? c.opts.title);
    const t = new Set<ForegroundServiceType>();
    for (const c of list) t.add(c.opts.foregroundServiceType);
    return {
      title: primary.opts.title,
      description: others.length
        ? `${primary.opts.description} · ${others.join(" · ")}`
        : primary.opts.description,
      linkingURI: primary.opts.linkingURI,
      types: [...t].sort(),
    };
  }

  function runClient(c: Client) {
    if (c.started) return;
    c.started = true;
    const mySeq = c.seq;
    void Promise.resolve()
      .then(() => c.task())
      .catch((e) => log?.(`[fgHost] ${c.id}: ${(e as Error)?.message ?? e}`))
      .then(() => {
        // Schleife endete von selbst → Client freigeben (nur wenn noch derselbe)
        const cur = clients.get(c.id);
        if (cur && cur.seq === mySeq) void release(c.id);
      });
  }

  const hostTask = async () => {
    hostRunning = true;
    for (const c of ordered()) runClient(c);
    await new Promise<void>((r) => {
      resolveHost = r;
    });
  };

  function endHostTask() {
    hostRunning = false;
    const r = resolveHost;
    resolveHost = null;
    r?.();
  }

  async function acquire(
    id: string,
    task: () => Promise<void>,
    opts: ForegroundClientOptions,
    priority = 0,
  ): Promise<void> {
    return serial(async () => {
      const existing = clients.get(id);
      const c: Client = existing
        ? { ...existing, task, opts, priority }
        : { id, task, opts, priority, started: false, seq: ++seq };
      clients.set(id, c);
      const next = combined();
      try {
        if (!nativeRunning) {
          types = next.types;
          await backend.start(hostTask, next);
          nativeRunning = true;
        } else if (next.types.some((t) => !types.includes(t))) {
          // Diensttyp fehlt → Dienst mit allen Typen neu starten
          endHostTask();
          await backend.stop().catch(() => {});
          nativeRunning = false;
          types = next.types;
          await backend.start(hostTask, next);
          nativeRunning = true;
        } else {
          await backend
            .update(next)
            .catch((e) =>
              log?.(`[fgHost] update: ${(e as Error)?.message ?? e}`),
            );
        }
      } catch (e) {
        if (!existing) clients.delete(id);
        else clients.set(id, existing);
        if (clients.size === 0) {
          nativeRunning = false;
          endHostTask();
        }
        throw e;
      }
      if (hostRunning) runClient(clients.get(id)!);
    });
  }

  function release(id: string): Promise<void> {
    return serial(async () => {
      if (!clients.delete(id)) return;
      if (clients.size === 0) {
        endHostTask();
        if (nativeRunning) {
          nativeRunning = false;
          types = [];
          await backend
            .stop()
            .catch((e) =>
              log?.(`[fgHost] stop: ${(e as Error)?.message ?? e}`),
            );
        }
        return;
      }
      if (nativeRunning) await backend.update(combined()).catch(() => {});
    });
  }

  return {
    acquire,
    release,
    isActive: (id) => clients.has(id),
    clientIds: () => ordered().map((c) => c.id),
    running: () => nativeRunning,
  };
}
