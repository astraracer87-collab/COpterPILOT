/**
 * Ladegerät-Logger: verbindet Transport, Ladevorgänge, Akku-Erkennung,
 * Speicher und Hintergrund-Loggen. RN-frei (alles über `ControllerDeps`).
 *
 *  - `connect()` startet den Transport (Scan/Verbinden/Koppeln/Abfragen).
 *  - Jeder Status-Frame geht in den SessionTracker. Gestartete und beendete
 *    Vorgänge werden sofort gespeichert, laufende alle 60 s als Zwischenstand
 *    (bei einem Absturz bleibt ein Teil-Vorgang erhalten und wird beim
 *    nächsten Start fortgesetzt oder als „disconnected“ beendet).
 *  - Akku-Erkennung je Schacht (Produktionsdatum + Zyklen). Unbekannt oder
 *    mehrdeutig → EINE Frage „Welcher Akku ist das?“ je Schacht-Belegung.
 *  - Hintergrund: `startBackground()` meldet sich beim gemeinsamen
 *    Vordergrunddienst an; die Dienst-Schleife beendet das Loggen nach 10 min
 *    ohne ladenden Akku oder bei dauerhaft verlorener Verbindung.
 */
import type {
  ChargerTransport,
  RawFrame,
  TransportSnapshot,
} from "./bleTransport";
import { formatRawFrames } from "./bleTransport";
import type { SettingsWriteResult } from "./bleTransport";
import { applySettingsPatch } from "./ma331WriteCommands";
import {
  createSessionTracker,
  type BatteryRef,
  type ChargeSession,
  type SessionEndReason,
  type SessionTracker,
} from "./chargeSession";
import {
  linkBattery,
  matchFingerprint,
  refFromLink,
  touchLink,
  batteryKey,
  type BatteryFingerprint,
  type BatteryLink,
} from "./batteryFingerprint";
import {
  isSlotIdle,
  shouldAutoStop,
  type AutoStopReason,
} from "./chargerBackground";
import {
  productionDateKey,
  IsdtSlotState,
  type IsdtSettings,
  type IsdtStatus,
} from "./ma331Protocol";

export const CHECKPOINT_MS = 60_000;
export const BACKGROUND_CHECK_MS = 5_000;

export interface ControllerStore {
  saveSession(s: ChargeSession): Promise<void>;
  loadActiveSessions(chargerId: string): Promise<ChargeSession[]>;
  getLinks(): Promise<BatteryLink[]>;
  saveLinks(l: BatteryLink[]): Promise<void>;
}

export interface ControllerDeps {
  createTransport(): ChargerTransport | null;
  store: ControllerStore;
  background: {
    start(task: () => Promise<void>): Promise<boolean>;
    stop(): Promise<void>;
  };
  now(): number;
  sleep(ms: number): Promise<void>;
  newId(): string;
  log?(m: string): void;
}

export interface BatteryPrompt {
  slot: number;
  fingerprint: BatteryFingerprint;
  reason: "ambiguous" | "unknown";
  candidates: BatteryLink[];
}

export interface SlotIdentity {
  fingerprint: BatteryFingerprint | null;
  battery: BatteryRef | null;
  asked: boolean;
}

export interface ControllerSnapshot {
  connecting: boolean;
  transport: TransportSnapshot | null;
  status: IsdtStatus | null;
  statusAt: number | null;
  parseError: string | null;
  activeSessions: ChargeSession[];
  slots: Record<number, SlotIdentity>;
  prompt: BatteryPrompt | null;
  backgroundActive: boolean;
  lastAutoStop: AutoStopReason | null;
  available: boolean;
}

export interface ChargerController {
  connect(): boolean;
  /** Verbindung beenden; offene Vorgänge als „interrupted“ speichern */
  disconnect(reason?: SessionEndReason): Promise<void>;
  retryNow(): void;
  snapshot(): ControllerSnapshot;
  subscribe(l: (s: ControllerSnapshot) => void): () => void;
  rawFramesText(n?: number): string;
  rawFrames(): RawFrame[];
  hasActiveSession(): boolean;
  /** Antwort auf „Welcher Akku ist das?“ (undefined = später/überspringen) */
  answerPrompt(slot: number, ref: BatteryRef | undefined): Promise<void>;
  /** Einstellung am Ladegerät ändern (nur das übergebene Feld, Rest wie gelesen) */
  writeSettings(patch: Partial<IsdtSettings>): Promise<SettingsWriteResult>;
  startBackground(): Promise<boolean>;
  stopBackground(): Promise<void>;
  /** Für Tests/Diagnose: Status direkt einspeisen */
  handleStatus(status: IsdtStatus, at: number): Promise<void>;
}

export function slotFingerprint(
  slot: IsdtStatus["slots"][number],
): BatteryFingerprint | null {
  if (!slot.hasData) return null;
  const d = productionDateKey(slot.productionDate);
  return d ? { productionDate: d, cycles: slot.cycleCount } : null;
}

export function createChargerController(
  deps: ControllerDeps,
): ChargerController {
  let transport: ChargerTransport | null = null;
  let unsubTransport: (() => void) | null = null;
  let tracker: SessionTracker | null = null;
  let trackerCharger: string | null = null;
  let restoring: Promise<void> | null = null;
  let links: BatteryLink[] | null = null;
  const slots: Record<number, SlotIdentity> = {};
  const prompts: BatteryPrompt[] = [];
  let lastCheckpoint = 0;
  let idleSince: number | null = null;
  let disconnectedSince: number | null = null;
  let bgActive = false;
  let bgGen = 0;
  let lastAutoStop: AutoStopReason | null = null;
  const listeners = new Set<(s: ControllerSnapshot) => void>();
  let snap: ControllerSnapshot = {
    connecting: false,
    transport: null,
    status: null,
    statusAt: null,
    parseError: null,
    activeSessions: [],
    slots: {},
    prompt: null,
    backgroundActive: false,
    lastAutoStop: null,
    available: true,
  };

  function emit(p: Partial<ControllerSnapshot> = {}) {
    snap = {
      ...snap,
      ...p,
      activeSessions: tracker?.active() ?? [],
      slots: { ...slots },
      prompt: prompts[0] ?? null,
      backgroundActive: bgActive,
      lastAutoStop,
    };
    for (const l of listeners) {
      try {
        l(snap);
      } catch {
        /* egal */
      }
    }
  }

  const save = (s: ChargeSession) =>
    deps.store
      .saveSession(JSON.parse(JSON.stringify(s)) as ChargeSession)
      .catch((e) =>
        deps.log?.(`[charger] speichern: ${(e as Error)?.message ?? e}`),
      );

  async function getLinks(): Promise<BatteryLink[]> {
    if (!links) links = await deps.store.getLinks().catch(() => []);
    return links;
  }

  async function ensureTracker(chargerId: string) {
    if (tracker && trackerCharger === chargerId) return;
    if (restoring) return restoring;
    restoring = (async () => {
      if (tracker && trackerCharger && trackerCharger !== chargerId) {
        for (const s of tracker.finalizeAll("interrupted", deps.now()))
          await save(s);
      }
      const t = createSessionTracker({ chargerId, newId: deps.newId });
      const open = await deps.store
        .loadActiveSessions(chargerId)
        .catch(() => []);
      t.restore(open);
      tracker = t;
      trackerCharger = chargerId;
    })();
    try {
      await restoring;
    } finally {
      restoring = null;
    }
  }

  async function identify(status: IsdtStatus, now: number) {
    const all = await getLinks();
    const occupied = new Set<string>();
    for (const s of Object.values(slots))
      if (s.battery) occupied.add(batteryKey(s.battery));
    for (const slot of status.slots) {
      const fp = slotFingerprint(slot);
      const cur = slots[slot.index];
      if (slot.state === IsdtSlotState.Empty) {
        if (cur) {
          delete slots[slot.index];
          dropPrompt(slot.index);
        }
        continue;
      }
      if (!fp) continue;
      const same =
        cur?.fingerprint &&
        cur.fingerprint.productionDate === fp.productionDate &&
        fp.cycles >= cur.fingerprint.cycles;
      if (same && cur) {
        if (cur.battery && fp.cycles > cur.fingerprint!.cycles) {
          links = touchLink(all, batteryKey(cur.battery), fp, now);
          await deps.store.saveLinks(links).catch(() => {});
        }
        cur.fingerprint = fp;
        continue;
      }
      // neue Belegung
      if (cur?.battery) occupied.delete(batteryKey(cur.battery));
      dropPrompt(slot.index);
      const m = matchFingerprint(links ?? all, fp, { exclude: occupied });
      if (m.kind === "match") {
        links = touchLink(links ?? all, m.link.key, fp, now);
        await deps.store.saveLinks(links).catch(() => {});
        slots[slot.index] = {
          fingerprint: fp,
          battery: refFromLink(m.link),
          asked: false,
        };
        occupied.add(m.link.key);
      } else {
        slots[slot.index] = { fingerprint: fp, battery: null, asked: true };
        prompts.push({
          slot: slot.index,
          fingerprint: fp,
          reason: m.reason,
          candidates: m.candidates,
        });
      }
    }
  }

  function dropPrompt(slot: number) {
    for (let i = prompts.length - 1; i >= 0; i--)
      if (prompts[i].slot === slot) prompts.splice(i, 1);
  }

  async function handleStatus(status: IsdtStatus, at: number) {
    const chargerId =
      transport?.snapshot().deviceId ?? trackerCharger ?? "unknown";
    await ensureTracker(chargerId);
    const t = tracker!;
    disconnectedSince = null;
    try {
      await identify(status, at);
    } catch (e) {
      deps.log?.(`[charger] Akku-Erkennung: ${(e as Error)?.message ?? e}`);
    }
    const events = t.update(status, at);
    for (const ev of events) {
      const s = ev.session;
      if (ev.type === "started") {
        const id = slots[s.slot];
        if (id?.battery) t.setBattery(s.id, id.battery);
      } else if (!s.battery && slots[s.slot]?.battery)
        s.battery = slots[s.slot].battery!;
      await save(s);
    }
    if (at - lastCheckpoint >= CHECKPOINT_MS) {
      lastCheckpoint = at;
      for (const s of t.active())
        if (!events.some((e) => e.session.id === s.id)) await save(s);
    }
    const allIdle = status.slots.every((s) => isSlotIdle(s.state));
    idleSince = allIdle ? (idleSince ?? at) : null;
    emit({ status, statusAt: at, parseError: null });
  }

  function attach(tr: ChargerTransport) {
    unsubTransport?.();
    unsubTransport = tr.subscribe((e) => {
      if (e.type === "state") {
        if (
          e.snapshot.state !== "connected" &&
          disconnectedSince == null &&
          e.snapshot.state !== "stopped"
        )
          disconnectedSince = deps.now();
        emit({
          transport: e.snapshot,
          connecting:
            e.snapshot.state !== "connected" &&
            e.snapshot.state !== "stopped" &&
            e.snapshot.state !== "idle",
        });
      } else if (e.type === "status") {
        void handleStatus(e.status, e.at).catch((err) =>
          deps.log?.(`[charger] status: ${(err as Error)?.message ?? err}`),
        );
      } else if (e.type === "parse-error") {
        emit({ parseError: e.error });
      } else if (e.type === "connection-lost") {
        tracker?.connectionLost(e.at);
        disconnectedSince = disconnectedSince ?? e.at;
        // Zwischenstand sichern
        for (const s of tracker?.active() ?? []) void save(s);
      }
    });
  }

  async function finalize(reason: SessionEndReason) {
    if (!tracker) return;
    for (const s of tracker.finalizeAll(reason, deps.now())) {
      if (!s.battery && slots[s.slot]?.battery)
        s.battery = slots[s.slot].battery!;
      await save(s);
    }
  }

  async function disconnect(reason: SessionEndReason = "interrupted") {
    bgGen++;
    const wasBg = bgActive;
    bgActive = false;
    await finalize(reason);
    unsubTransport?.();
    unsubTransport = null;
    const tr = transport;
    transport = null;
    if (tr) await tr.stop().catch(() => {});
    for (const k of Object.keys(slots)) delete slots[Number(k)];
    prompts.length = 0;
    idleSince = null;
    disconnectedSince = null;
    if (wasBg) await deps.background.stop().catch(() => {});
    emit({
      connecting: false,
      transport: tr?.snapshot() ?? snap.transport,
      status: null,
      statusAt: null,
    });
  }

  async function backgroundLoop(gen: number) {
    while (bgActive && gen === bgGen) {
      await deps.sleep(BACKGROUND_CHECK_MS);
      if (!bgActive || gen !== bgGen) break;
      const ts = transport?.snapshot();
      const reason = shouldAutoStop({
        now: deps.now(),
        idleSince,
        activeSessions: tracker?.active().length ?? 0,
        disconnectedSince:
          ts && ts.state !== "connected"
            ? (disconnectedSince ?? deps.now())
            : null,
        failures: ts?.failures ?? 0,
      });
      if (reason) {
        lastAutoStop = reason;
        deps.log?.(`[charger] Hintergrund-Loggen beendet: ${reason}`);
        await disconnect(reason === "idle" ? "stopped" : "disconnected");
        break;
      }
    }
  }

  return {
    connect() {
      if (transport) {
        transport.start();
        return true;
      }
      const tr = deps.createTransport();
      if (!tr) {
        emit({ available: false });
        return false;
      }
      transport = tr;
      lastAutoStop = null;
      attach(tr);
      tr.start();
      emit({ available: true, transport: tr.snapshot(), connecting: true });
      return true;
    },
    disconnect,
    retryNow: () => transport?.retryNow(),
    snapshot: () => snap,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    rawFramesText: (n = 60) => formatRawFrames(transport?.rawFrames() ?? [], n),
    rawFrames: () => transport?.rawFrames() ?? [],
    hasActiveSession: () => (tracker?.active().length ?? 0) > 0,
    async writeSettings(patch) {
      const tr = transport;
      const cur = tr?.snapshot().settings;
      if (!tr || !cur) return "not-connected";
      return tr.writeSettings(applySettingsPatch(cur, patch));
    },
    async answerPrompt(slot, ref) {
      const p = prompts.find((x) => x.slot === slot);
      dropPrompt(slot);
      if (p && ref) {
        links = linkBattery(await getLinks(), ref, p.fingerprint, deps.now());
        await deps.store.saveLinks(links).catch(() => {});
        slots[slot] = { fingerprint: p.fingerprint, battery: ref, asked: true };
        const s = tracker?.activeForSlot(slot);
        if (s) {
          tracker!.setBattery(s.id, ref);
          await save(s);
        }
      }
      emit();
    },
    async startBackground() {
      if (bgActive) return true;
      if (!transport) return false;
      bgActive = true;
      const gen = ++bgGen;
      let ok = false;
      try {
        ok = await deps.background.start(() => backgroundLoop(gen));
      } catch {
        ok = false;
      }
      if (!ok && gen === bgGen) bgActive = false;
      emit();
      return ok;
    },
    async stopBackground() {
      if (!bgActive) return;
      bgActive = false;
      bgGen++;
      await deps.background.stop().catch(() => {});
      emit();
    },
    handleStatus,
  };
}
