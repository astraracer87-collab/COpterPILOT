// Gemeinsamer Vordergrunddienst (foregroundServiceHost.ts: Radar + Ladegerät
// in EINEM react-native-background-actions-Dienst), Speicher des Ladegeräts
// (chargerStore.ts, Dateien) und der Controller (chargerController.ts):
// Akku-Frage, Speichern, Teil-Vorgänge, Hintergrund-Auto-Ende.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createForegroundServiceHost,
  type ForegroundServiceStartOptions,
} from "../foregroundServiceHost";
import {
  __setChargerStoreAdaptersForTests,
  chargerPairingStore,
  findChargerLinkByDjiSerial,
  getBatteryLinks,
  getChargeSession,
  getChargerBackgroundMode,
  getChargerLinkForBattery,
  listChargeSessions,
  loadActiveSessions,
  saveBatteryLinks,
  saveChargeSession,
  setChargerBackgroundMode,
  setDjiSerialForBattery,
  type KvStore,
} from "../chargerStore";
import type { SimpleFs } from "../fileStoreFs";
import {
  createChargerController,
  type ControllerDeps,
} from "../charger/chargerController";
import type {
  ChargerTransport,
  TransportEvent,
  TransportSnapshot,
} from "../charger/bleTransport";
import { status } from "./helpers/chargerFixtures";

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

// ── Vordergrunddienst ──────────────────────────────────────────────────────
function fakeBackend() {
  const log: string[] = [];
  let task: (() => Promise<void>) | null = null;
  const b = {
    log,
    starts: [] as ForegroundServiceStartOptions[],
    updates: [] as ForegroundServiceStartOptions[],
    runTask: () => task?.(),
    async start(t: () => Promise<void>, o: ForegroundServiceStartOptions) {
      task = t;
      b.starts.push(o);
      log.push(`start ${o.types.join("+")}`);
    },
    async stop() {
      log.push("stop");
    },
    async update(o: ForegroundServiceStartOptions) {
      b.updates.push(o);
      log.push("update");
    },
  };
  return b;
}

const radarOpts = {
  title: "Radar",
  description: "Radar läuft",
  shortLabel: "Radar",
  linkingURI: "x://radar",
  foregroundServiceType: "location" as const,
};
const chargerOpts = {
  title: "Ladegerät wird geloggt",
  description: "MA331",
  shortLabel: "Ladegerät wird geloggt",
  linkingURI: "x://charger",
  foregroundServiceType: "dataSync" as const,
};

describe("Gemeinsamer Vordergrunddienst", () => {
  it("zwei Clients teilen sich EINEN Dienst; Anzeige des wichtigeren; Stopp erst nach dem letzten", async () => {
    const b = fakeBackend();
    const host = createForegroundServiceHost(b);
    let radarRuns = 0;
    let chargerRuns = 0;
    const forever = () => new Promise<void>(() => {});
    await host.acquire(
      "charger",
      async () => (chargerRuns++, forever()),
      chargerOpts,
      0,
    );
    assert.deepEqual(b.log, ["start dataSync"]);
    void b.runTask();
    await flush();
    assert.equal(chargerRuns, 1);
    // Radar braucht „location“ → Dienst mit beiden Typen neu starten
    await host.acquire(
      "radar",
      async () => (radarRuns++, forever()),
      radarOpts,
      10,
    );
    assert.deepEqual(b.log, [
      "start dataSync",
      "stop",
      "start dataSync+location",
    ]);
    assert.equal(b.starts[1].title, "Radar");
    assert.equal(
      b.starts[1].description,
      "Radar läuft · Ladegerät wird geloggt",
    );
    void b.runTask();
    await flush();
    assert.equal(radarRuns, 1);
    assert.equal(
      chargerRuns,
      1,
      "laufende Schleife wird nicht doppelt gestartet",
    );
    await host.release("radar");
    assert.equal(b.log[b.log.length - 1], "update");
    assert.equal(
      b.updates[b.updates.length - 1].title,
      "Ladegerät wird geloggt",
    );
    assert.ok(host.running());
    await host.release("charger");
    assert.equal(b.log[b.log.length - 1], "stop");
    assert.equal(host.running(), false);
  });

  it("zweiter Client mit vorhandenem Typ: nur Anzeige aktualisieren, Schleife sofort starten", async () => {
    const b = fakeBackend();
    const host = createForegroundServiceHost(b);
    let runs = 0;
    await host.acquire("radar", () => new Promise(() => {}), radarOpts, 10);
    void b.runTask();
    await host.acquire(
      "charger",
      async () => void runs++,
      { ...chargerOpts, foregroundServiceType: "location" },
      0,
    );
    await flush();
    // kein Neustart: anmelden = Anzeige aktualisieren; Ende der Schleife = Abmelden (noch ein Update)
    assert.deepEqual(b.log, ["start location", "update", "update"]);
    assert.equal(runs, 1);
    // Schleife endete von selbst → Client freigegeben
    assert.deepEqual(host.clientIds(), ["radar"]);
  });

  it("Startfehler: Client wird nicht registriert, Fehler geht an den Aufrufer", async () => {
    const b = fakeBackend();
    b.start = async () => {
      throw new Error("nope");
    };
    const host = createForegroundServiceHost(b);
    await assert.rejects(host.acquire("charger", async () => {}, chargerOpts));
    assert.equal(host.isActive("charger"), false);
  });
});

// ── Speicher ───────────────────────────────────────────────────────────────
function memFs(): SimpleFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    root: "file:///docs/",
    readText: async (p) => files.get(p) ?? null,
    writeText: async (p, t) => void files.set(p, t),
    move: async (a, b) => {
      const t = files.get(a);
      if (t == null) throw new Error("missing");
      files.set(b, t);
      files.delete(a);
    },
    remove: async (p) => void files.delete(p),
    list: async () => [],
    mkdirp: async () => {},
    info: async (p) => ({ exists: files.has(p) }),
  };
}
function memKv(): KvStore {
  const m = new Map<string, string>();
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
}

let fs: ReturnType<typeof memFs>;
beforeEach(() => {
  fs = memFs();
  __setChargerStoreAdaptersForTests({ fs, kv: memKv() });
});

describe("chargerStore", () => {
  it("Vorgänge als Dateien mit Index (nicht in AsyncStorage), Teil-Vorgänge wieder ladbar", async () => {
    const s = {
      id: "s1",
      chargerId: "M",
      slot: 0,
      status: "active" as const,
      startedAt: 10,
      startedMidway: false,
      startPercent: 20,
      endPercent: 30,
      startMah: 1,
      endMah: 2,
      chargedMah: 1,
      maxTempC: 30,
      maxCurrentA: 3,
      maxPowerW: 40,
      endCellsMv: [1, 2, 3, 4],
      endCellDeltaMv: 3,
      cyclesStart: 1,
      cyclesEnd: 1,
      productionDate: "2024-05-13",
      warnings: [],
      gaps: 0,
      lastSeenAt: 20,
      series: [
        { t: 10, soc: 20, mah: 1, a: 3, w: 40, temp: 30, cells: [1, 2, 3, 4] },
      ],
    };
    await saveChargeSession(s);
    assert.ok(fs.files.has("file:///docs/charger/sessions/s1.json"));
    assert.ok(fs.files.has("file:///docs/charger/index.json"));
    assert.equal((await loadActiveSessions("M")).length, 1);
    assert.equal((await loadActiveSessions("other")).length, 0);
    await saveChargeSession({
      ...s,
      status: "done",
      endReason: "full",
      battery: { droneId: "d", batteryId: "b", label: "B" },
    });
    const idx = await listChargeSessions({ batteryKey: "d/b" });
    assert.equal(idx.length, 1);
    assert.equal(idx[0].endReason, "full");
    assert.equal(idx[0].samples, 1);
    assert.equal((await getChargeSession("s1"))?.series.length, 1);
    assert.equal((await loadActiveSessions()).length, 0);
  });

  it("Kopplung je MAC, Einstellung, DJI-Seriennummer an der Verknüpfung", async () => {
    await chargerPairingStore.set({
      mac: "aa:bb",
      appId: "0".repeat(32),
      modelId: "01400000",
      boundOnce: true,
    });
    assert.equal((await chargerPairingStore.get("AA:BB"))?.boundOnce, true);
    assert.equal(await getChargerBackgroundMode(), "ask");
    await setChargerBackgroundMode("never");
    assert.equal(await getChargerBackgroundMode(), "never");
    await saveBatteryLinks([
      {
        key: "d/b",
        droneId: "d",
        batteryId: "b",
        label: "B",
        productionDate: "2024-05-13",
        lastCycles: 4,
        lastSeenAt: 0,
      },
    ]);
    assert.equal(await setDjiSerialForBattery("d", "b", "3QJ1234"), true);
    assert.equal(await setDjiSerialForBattery("d", "x", "1"), false);
    assert.equal((await findChargerLinkByDjiSerial("3qj1234"))?.batteryId, "b");
    assert.equal(
      (await getChargerLinkForBattery("d", "b"))?.djiSerial,
      "3QJ1234",
    );
  });
});

// ── Controller ─────────────────────────────────────────────────────────────
function fakeTransport() {
  const listeners = new Set<(e: TransportEvent) => void>();
  let snap: TransportSnapshot = {
    state: "connected",
    deviceId: "M",
    deviceName: "MA331",
    modelKind: "MA331",
    hardware: null,
    settings: null,
    mtu: 240,
    hint: null,
    lastError: null,
    failures: 0,
    connectedAt: 0,
    lastStatusAt: null,
    nextRetryAt: null,
    discovered: [],
  };
  const tr: ChargerTransport & {
    emit(e: TransportEvent): void;
    setState(s: Partial<TransportSnapshot>): void;
    stopped: number;
  } = {
    stopped: 0,
    start() {},
    async stop() {
      tr.stopped++;
      snap = { ...snap, state: "stopped" };
    },
    retryNow() {},
    snapshot: () => snap,
    rawFrames: () => [],
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(e) {
      listeners.forEach((l) => l(e));
    },
    setState(s) {
      snap = { ...snap, ...s };
      listeners.forEach((l) => l({ type: "state", snapshot: snap }));
    },
  };
  return tr;
}

function controllerHarness() {
  const clock = { t: 1_000_000 };
  const tr = fakeTransport();
  const bg = {
    started: 0,
    stopped: 0,
    task: null as null | (() => Promise<void>),
  };
  const sleeps: (() => void)[] = [];
  let n = 0;
  const deps: ControllerDeps = {
    createTransport: () => tr,
    store: {
      saveSession: saveChargeSession,
      loadActiveSessions,
      getLinks: getBatteryLinks,
      saveLinks: saveBatteryLinks,
    },
    background: {
      async start(task) {
        bg.started++;
        bg.task = task;
        return true;
      },
      async stop() {
        bg.stopped++;
      },
    },
    now: () => clock.t,
    sleep: () => new Promise<void>((r) => sleeps.push(r)),
    newId: () => `s${++n}`,
  };
  const c = createChargerController(deps);
  return { c, tr, clock, bg, sleeps };
}

describe("Ladegerät-Controller", () => {
  it("unbekannter Akku → EINE Frage; Antwort verknüpft und ordnet den laufenden Vorgang zu; danach automatisch erkannt", async () => {
    const { c, tr, clock } = controllerHarness();
    c.connect();
    tr.emit({
      type: "status",
      status: status({ state: 2, cycles: 47 }),
      at: clock.t,
    });
    await flush();
    const p = c.snapshot().prompt;
    assert.ok(p);
    assert.equal(p.slot, 0);
    assert.equal(p.reason, "unknown");
    assert.deepEqual(p.fingerprint, {
      productionDate: "2024-05-13",
      cycles: 47,
    });
    // gleicher Akku, weitere Frames → keine zweite Frage
    tr.emit({
      type: "status",
      status: status({ state: 2, cycles: 47 }),
      at: clock.t + 1000,
    });
    await flush();
    assert.equal(c.snapshot().prompt?.slot, 0);
    await c.answerPrompt(0, { droneId: "d1", batteryId: "A", label: "Akku A" });
    assert.equal(c.snapshot().prompt, null);
    assert.equal(c.snapshot().slots[0].battery?.batteryId, "A");
    assert.equal((await getBatteryLinks())[0].lastCycles, 47);
    assert.equal((await listChargeSessions())[0].batteryKey, "d1/A");
    // voll → gespeichert mit Akku
    tr.emit({
      type: "status",
      status: status({ state: 3, soc: 100, cycles: 48 }),
      at: clock.t + 60_000,
    });
    await flush();
    const [done] = await listChargeSessions({ batteryKey: "d1/A" });
    assert.equal(done.status, "done");
    assert.equal(done.endReason, "full");
    // Akku raus und wieder rein → ohne Frage erkannt (Zyklen +1)
    tr.emit({
      type: "status",
      status: status({ state: 0 }),
      at: clock.t + 70_000,
    });
    tr.emit({
      type: "status",
      status: status({ state: 2, cycles: 49 }),
      at: clock.t + 80_000,
    });
    await flush();
    assert.equal(c.snapshot().prompt, null);
    assert.equal(c.snapshot().slots[0].battery?.batteryId, "A");
    assert.equal((await getBatteryLinks())[0].lastCycles, 49);
  });

  it("Verbindung weg → Zwischenstand gespeichert; Trennen speichert „interrupted“", async () => {
    const { c, tr, clock } = controllerHarness();
    c.connect();
    tr.emit({
      type: "status",
      status: status({ state: 2, soc: 30 }),
      at: clock.t,
    });
    await flush();
    await c.answerPrompt(0, undefined);
    tr.emit({ type: "connection-lost", at: clock.t + 5000, reason: "x" });
    await flush();
    assert.equal((await listChargeSessions({ status: "active" })).length, 1);
    await c.disconnect();
    const all = await listChargeSessions();
    assert.equal(all[0].status, "done");
    assert.equal(all[0].endReason, "interrupted");
    assert.equal(tr.stopped, 1);
  });

  it("Hintergrund: Auto-Ende nach 10 min ohne ladenden Akku", async () => {
    const { c, tr, clock, bg, sleeps } = controllerHarness();
    c.connect();
    tr.emit({
      type: "status",
      status: status({ state: 3, soc: 100 }),
      at: clock.t,
    });
    await flush();
    assert.equal(await c.startBackground(), true);
    assert.equal(bg.started, 1);
    void bg.task!();
    await flush();
    clock.t += 5 * 60_000;
    sleeps.shift()!();
    await flush();
    assert.equal(c.snapshot().backgroundActive, true);
    clock.t += 5 * 60_000;
    sleeps.shift()!();
    await flush();
    assert.equal(c.snapshot().backgroundActive, false);
    assert.equal(c.snapshot().lastAutoStop, "idle");
    assert.equal(bg.stopped, 1);
    assert.equal(tr.stopped, 1);
  });
});
