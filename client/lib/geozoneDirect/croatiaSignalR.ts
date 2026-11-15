// Minimaler Client für klassisches ASP.NET SignalR (Protokoll 1.x/2.x, NICHT
// ASP.NET Core SignalR) – ohne Bibliothek. Genutzt für den öffentlichen
// AMC-Hub von Croatia Control (docs/croatia-amc-api-integration.md §2).
//
// Ablauf (live verifiziert 2026-11-15):
//  1) GET  {base}/negotiate?clientProtocol=2.1&connectionData=[{"name":hub}]
//  2) Transport verbinden:
//     - webSockets: WS {base}/connect?transport=webSockets&…&connectionToken=…
//     - longPolling (Fallback): GET {base}/connect?transport=longPolling&…
//       (antwortet sofort mit der Init-Nachricht {S:1,…}), danach
//       POST {base}/poll?transport=longPolling&messageId=<C>&… in Schleife.
//  3) GET  {base}/start?transport=…&connectionToken=…
//  4) Hub-Aufruf {"H":hub,"M":method,"A":[…],"I":n} (WS: senden; longPolling:
//     POST {base}/send, Formular „data=<json>“)
//  5) Server-Pushes {"C":…,"M":[{"H":hub,"M":"SRVC_…","A":[…]}]} sammeln, bis
//     `isComplete` erfüllt ist, dann Verbindung schließen (+ /abort).
//
// serverSentEvents wird nicht angeboten: React Native hat kein EventSource
// und kein Streaming-fetch; die AMC-Doku nennt nur webSockets (das Portal
// selbst verbindet mit transport: ['webSockets']).
//
// Bewusst frei von React-Native-/Expo-Importen: nutzt nur das globale `fetch`
// und `WebSocket` (in React Native und Node ≥ 22 vorhanden). Beide sind für
// Tests injizierbar.

export type SignalRTransport = "webSockets" | "longPolling";

export type HubInvocation = { method: string; args?: unknown[] };

/** Gesammelte Pushes: Methodenname (wie vom Server gesendet) → Argumente des letzten Aufrufs. */
export type HubPushes = Record<string, any[]>;

export type ClassicSignalROptions = {
  /** z. B. "https://amc.crocontrol.hr/amc/signalr" */
  baseUrl: string;
  /** Hub-Name, z. B. "aMCHub" */
  hub: string;
  /** Aufrufe nach start (z. B. CLIC_ClientReady). */
  invocations?: HubInvocation[];
  /** Abbruchbedingung; Standard: mindestens ein Push. */
  isComplete?: (pushes: HubPushes) => boolean;
  /** Transporte in Versuchsreihenfolge (Standard: webSockets, longPolling). */
  transports?: SignalRTransport[];
  /** Timeout je HTTP-Anfrage (negotiate/start/send/abort), ms. */
  requestTimeoutMs?: number;
  /** Timeout für den Verbindungsaufbau eines Transports, ms. */
  connectTimeoutMs?: number;
  /** Gesamt-Timeout je Transportversuch (bis isComplete), ms. */
  collectTimeoutMs?: number;
  /** Bei Ablauf von collectTimeoutMs die bis dahin gesammelten Pushes liefern statt zu werfen (wenn nicht leer). */
  resolvePartialOnTimeout?: boolean;
  /** Clientprotokoll (Standard "2.1"). */
  clientProtocol?: string;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: any;
  /** Diagnose-Logger (Standard: keiner). */
  log?: (msg: string) => void;
};

export type ClassicSignalRResult = {
  pushes: HubPushes;
  transport: SignalRTransport;
  /** Fehlerantworten auf Hub-Aufrufe ({I, E}). */
  invocationErrors: string[];
  complete: boolean;
};

const DEFAULTS = {
  requestTimeoutMs: 20_000,
  connectTimeoutMs: 15_000,
  collectTimeoutMs: 60_000,
  clientProtocol: "2.1",
};

type Negotiation = {
  ConnectionToken: string;
  ConnectionId?: string;
  TryWebSockets?: boolean;
  KeepAliveTimeout?: number | null;
  ProtocolVersion?: string;
};

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuter = () => controller.abort();
  outerSignal?.addEventListener?.("abort", onOuter);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} (${url.split("?")[0]})`);
    return await res.text();
  } catch (e: any) {
    if (controller.signal.aborted) throw new Error(`Zeitüberschreitung/Abbruch (${url.split("?")[0]})`);
    throw e;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener?.("abort", onOuter);
  }
}

function connectionDataParam(hub: string): string {
  return encodeURIComponent(JSON.stringify([{ name: hub }]));
}

/** Query-String für connect/start/send/poll/abort. */
function transportQuery(o: { transport: SignalRTransport; clientProtocol: string; token: string; hub: string; extra?: Record<string, string> }): string {
  let q = `transport=${o.transport}&clientProtocol=${encodeURIComponent(o.clientProtocol)}&connectionToken=${encodeURIComponent(o.token)}&connectionData=${connectionDataParam(o.hub)}`;
  for (const [k, v] of Object.entries(o.extra ?? {})) q += `&${k}=${encodeURIComponent(v)}`;
  return q;
}

/**
 * Verarbeitet eine Server-Nachricht (bereits geparstes JSON) und trägt Pushes
 * ein. Exportiert für Tests.
 */
export function applySignalRMessage(
  msg: any,
  hub: string,
  pushes: HubPushes,
  invocationErrors: string[],
): { messageId?: string; groupsToken?: string; initialized?: boolean } {
  const out: { messageId?: string; groupsToken?: string; initialized?: boolean } = {};
  if (!msg || typeof msg !== "object") return out;
  if (typeof msg.C === "string") out.messageId = msg.C;
  if (typeof msg.G === "string") out.groupsToken = msg.G;
  if (msg.S === 1) out.initialized = true;
  if (msg.I != null && msg.E) invocationErrors.push(String(msg.E).split("\n")[0]);
  if (Array.isArray(msg.M)) {
    for (const m of msg.M) {
      if (!m || typeof m !== "object" || typeof m.M !== "string") continue;
      if (m.H && String(m.H).toLowerCase() !== hub.toLowerCase()) continue;
      pushes[m.M] = Array.isArray(m.A) ? m.A : [];
    }
  }
  return out;
}

function parseFrame(data: unknown): any {
  if (typeof data !== "string") return null;
  if (data === "" || data === "{}") return null; // Keep-Alive
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function negotiate(opts: Required<Pick<ClassicSignalROptions, "baseUrl" | "hub">> & { clientProtocol: string; requestTimeoutMs: number; fetchImpl: typeof fetch }): Promise<Negotiation> {
  const url = `${opts.baseUrl}/negotiate?clientProtocol=${encodeURIComponent(opts.clientProtocol)}&connectionData=${connectionDataParam(opts.hub)}&_=${Date.now()}`;
  const text = await fetchWithTimeout(opts.fetchImpl, url, { method: "GET", headers: { Accept: "application/json" } }, opts.requestTimeoutMs);
  const neg = JSON.parse(text);
  if (!neg || typeof neg.ConnectionToken !== "string" || !neg.ConnectionToken) throw new Error("SignalR negotiate: kein ConnectionToken");
  return neg;
}

function wsBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
}

type Ctx = {
  baseUrl: string;
  hub: string;
  clientProtocol: string;
  requestTimeoutMs: number;
  connectTimeoutMs: number;
  collectTimeoutMs: number;
  resolvePartialOnTimeout: boolean;
  invocations: HubInvocation[];
  isComplete: (p: HubPushes) => boolean;
  fetchImpl: typeof fetch;
  WebSocketImpl: any;
  log: (m: string) => void;
};

function invocationFrames(ctx: Ctx): string[] {
  return ctx.invocations.map((inv, i) => JSON.stringify({ H: ctx.hub, M: inv.method, A: inv.args ?? [], I: i }));
}

async function sendAbort(ctx: Ctx, transport: SignalRTransport, token: string): Promise<void> {
  try {
    await fetchWithTimeout(
      ctx.fetchImpl,
      `${ctx.baseUrl}/abort?${transportQuery({ transport, clientProtocol: ctx.clientProtocol, token, hub: ctx.hub })}`,
      { method: "POST" },
      Math.min(ctx.requestTimeoutMs, 5000),
    );
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function runWebSockets(ctx: Ctx, token: string): Promise<ClassicSignalRResult> {
  const WS = ctx.WebSocketImpl;
  if (typeof WS !== "function") return Promise.reject(new Error("WebSocket nicht verfügbar"));
  const pushes: HubPushes = {};
  const invocationErrors: string[] = [];
  const q = transportQuery({ transport: "webSockets", clientProtocol: ctx.clientProtocol, token, hub: ctx.hub });
  const url = `${wsBaseUrl(ctx.baseUrl)}/connect?${q}`;

  return new Promise<ClassicSignalRResult>((resolve, reject) => {
    let settled = false;
    let opened = false;
    let ws: any;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (err: Error | null, complete = true) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      try {
        ws?.close?.();
      } catch {
        /* ignorieren */
      }
      void sendAbort(ctx, "webSockets", token);
      if (err) reject(err);
      else resolve({ pushes, transport: "webSockets", invocationErrors, complete });
    };
    try {
      ws = new WS(url);
    } catch (e: any) {
      reject(new Error(`WebSocket-Aufbau fehlgeschlagen: ${e?.message || e}`));
      return;
    }
    timers.push(
      setTimeout(() => {
        if (!opened) finish(new Error("WebSocket: Verbindungsaufbau Zeitüberschreitung"));
      }, ctx.connectTimeoutMs),
    );
    timers.push(
      setTimeout(() => {
        if (ctx.resolvePartialOnTimeout && Object.keys(pushes).length > 0) finish(null, false);
        else finish(new Error(`WebSocket: Daten unvollständig nach ${ctx.collectTimeoutMs} ms (erhalten: ${Object.keys(pushes).join(", ") || "nichts"})`));
      }, ctx.collectTimeoutMs),
    );
    ws.onopen = () => {
      opened = true;
      ctx.log("SignalR: WebSocket offen");
      fetchWithTimeout(ctx.fetchImpl, `${ctx.baseUrl}/start?${q}`, { method: "GET" }, ctx.requestTimeoutMs)
        .then(() => {
          if (settled) return;
          for (const frame of invocationFrames(ctx)) ws.send(frame);
        })
        .catch((e) => finish(new Error(`SignalR start: ${e?.message || e}`)));
    };
    ws.onmessage = (ev: any) => {
      const msg = parseFrame(ev?.data);
      if (!msg) return;
      applySignalRMessage(msg, ctx.hub, pushes, invocationErrors);
      if (ctx.isComplete(pushes)) finish(null);
    };
    ws.onerror = (ev: any) => {
      if (!settled) ctx.log(`SignalR: WebSocket-Fehler ${ev?.message ?? ""}`);
      if (!opened) finish(new Error("WebSocket-Fehler beim Verbindungsaufbau"));
    };
    ws.onclose = (ev: any) => {
      if (settled) return;
      if (ctx.isComplete(pushes)) finish(null);
      else if (ctx.resolvePartialOnTimeout && Object.keys(pushes).length > 0) finish(null, false);
      else finish(new Error(`WebSocket geschlossen (Code ${ev?.code ?? "?"}) vor vollständigen Daten`));
    };
  });
}

// ---------------------------------------------------------------------------
// Long Polling
// ---------------------------------------------------------------------------

async function runLongPolling(ctx: Ctx, token: string): Promise<ClassicSignalRResult> {
  const pushes: HubPushes = {};
  const invocationErrors: string[] = [];
  const deadline = Date.now() + ctx.collectTimeoutMs;
  const outer = new AbortController();
  const base = { transport: "longPolling" as const, clientProtocol: ctx.clientProtocol, token, hub: ctx.hub };
  let messageId: string | undefined;
  let groupsToken: string | undefined;
  const handle = (text: string) => {
    const msg = parseFrame(text);
    if (!msg) return;
    const r = applySignalRMessage(msg, ctx.hub, pushes, invocationErrors);
    if (r.messageId) messageId = r.messageId;
    if (r.groupsToken) groupsToken = r.groupsToken;
  };
  try {
    // connect liefert sofort die Init-Nachricht (S:1).
    handle(await fetchWithTimeout(ctx.fetchImpl, `${ctx.baseUrl}/connect?${transportQuery(base)}`, { method: "GET" }, ctx.connectTimeoutMs));
    await fetchWithTimeout(ctx.fetchImpl, `${ctx.baseUrl}/start?${transportQuery(base)}`, { method: "GET" }, ctx.requestTimeoutMs);
    for (const frame of invocationFrames(ctx)) {
      handle(
        await fetchWithTimeout(
          ctx.fetchImpl,
          `${ctx.baseUrl}/send?${transportQuery(base)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body: `data=${encodeURIComponent(frame)}`,
          },
          ctx.requestTimeoutMs,
        ),
      );
    }
    while (!ctx.isComplete(pushes)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const extra: Record<string, string> = {};
      if (messageId) extra.messageId = messageId;
      if (groupsToken) extra.groupsToken = groupsToken;
      // Poll hält bis zu ~110 s (ConnectionTimeout); auf Restzeit begrenzen.
      const text = await fetchWithTimeout(
        ctx.fetchImpl,
        `${ctx.baseUrl}/poll?${transportQuery({ ...base, extra })}`,
        { method: "POST" },
        Math.max(1000, remaining),
        outer.signal,
      ).catch((e) => {
        if (Date.now() >= deadline) return "";
        throw e;
      });
      handle(text);
    }
  } finally {
    outer.abort();
    void sendAbort(ctx, "longPolling", token);
  }
  const complete = ctx.isComplete(pushes);
  if (!complete && !(ctx.resolvePartialOnTimeout && Object.keys(pushes).length > 0)) {
    throw new Error(`longPolling: Daten unvollständig nach ${ctx.collectTimeoutMs} ms (erhalten: ${Object.keys(pushes).join(", ") || "nichts"})`);
  }
  return { pushes, transport: "longPolling", invocationErrors, complete };
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/**
 * Einmaliger Abzug: verbindet, ruft die Hub-Methoden auf, sammelt Pushes bis
 * `isComplete`, schließt. Probiert die Transporte der Reihe nach (je mit
 * frischem negotiate) und wirft erst, wenn alle scheitern.
 */
export async function collectSignalRPushes(options: ClassicSignalROptions): Promise<ClassicSignalRResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis as any).fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch nicht verfügbar");
  const ctx: Ctx = {
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    hub: options.hub,
    clientProtocol: options.clientProtocol ?? DEFAULTS.clientProtocol,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    connectTimeoutMs: options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs,
    collectTimeoutMs: options.collectTimeoutMs ?? DEFAULTS.collectTimeoutMs,
    resolvePartialOnTimeout: options.resolvePartialOnTimeout ?? false,
    invocations: options.invocations ?? [],
    isComplete: options.isComplete ?? ((p) => Object.keys(p).length > 0),
    fetchImpl,
    WebSocketImpl: options.WebSocketImpl ?? (globalThis as any).WebSocket,
    log: options.log ?? (() => {}),
  };
  const transports = options.transports ?? ["webSockets", "longPolling"];
  const errors: string[] = [];
  for (const transport of transports) {
    try {
      const neg = await negotiate({ ...ctx });
      if (transport === "webSockets" && neg.TryWebSockets === false) {
        errors.push("webSockets: vom Server nicht angeboten");
        continue;
      }
      ctx.log(`SignalR: versuche ${transport}`);
      return transport === "webSockets" ? await runWebSockets(ctx, neg.ConnectionToken) : await runLongPolling(ctx, neg.ConnectionToken);
    } catch (e: any) {
      const msg = `${transport}: ${e?.message || e}`;
      errors.push(msg);
      ctx.log(`SignalR: ${msg}`);
    }
  }
  throw new Error(`SignalR-Abruf fehlgeschlagen – ${errors.join(" | ")}`);
}
