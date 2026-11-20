// BLE-Transport zum MA331 (client/lib/charger/bleTransport.ts) mit nachgebautem
// BLE-Modul und künstlicher Uhr: Scan-Filter, Bootloader, Reihenfolge
// Notify AF01 → AF02 → MTU 240 → Bind, Modus 0/1, E0, Poll im 1-s-Takt mit
// genau einer Anfrage unterwegs, Antwort-Timeout, Neuverbinden mit Backoff,
// Polying-Hinweis, nur-lesen-Sperre.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  backoffMs,
  createChargerTransport,
  RESPONSE_TIMEOUT_MS,
  SEARCH_ENDED_TEXT,
  SEARCH_LIMIT_MS,
  type BleDiscovered,
  type BleLike,
  type PairingRecord,
  type PairingStore,
  type TimerApi,
  type TransportEvent,
} from "../charger/bleTransport";
import { ISDT_SCAN_FILTER, toHex } from "../charger/ma331Protocol";
import { encodeStatus } from "./helpers/chargerFixtures";

const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};

class FakeClock implements TimerApi {
  t = 1_000_000;
  private seq = 0;
  private tasks: { id: number; at: number; fn: () => void }[] = [];
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.tasks.push({ id, at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown) {
    this.tasks = this.tasks.filter((x) => x.id !== h);
  }
  async advance(ms: number) {
    const end = this.t + ms;
    await flush();
    for (;;) {
      this.tasks.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.tasks[0];
      if (!next || next.at > end) break;
      this.tasks.shift();
      this.t = next.at;
      next.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

const MAC = "C8:47:8C:00:11:22";
const MA331_ADV = {
  manufacturerData: { abba: { bytes: [0xaf, 0xfa, 0x01, 0x40, 0x00, 0x00] } },
};

interface MockOpts {
  bindReply?: (mode: number) => number[] | null;
  answerStatus?: boolean;
  connectFails?: boolean;
  mtu?: number;
  advertise?: BleDiscovered[];
  /** Antwort auf 12 C4 (rr); null = keine Antwort */
  settingsAck?: number | null;
}

function mockBle(o: MockOpts = {}) {
  const calls: string[] = [];
  const writes: { ch: string; hex: string }[] = [];
  const discover = new Set<(p: BleDiscovered) => void>();
  const disc = new Set<(e: { peripheral: string; status?: number }) => void>();
  const value = new Set<
    (e: { peripheral: string; characteristic: string; value: number[] }) => void
  >();
  const scanOpts: unknown[] = [];
  const state = {
    answerStatus: o.answerStatus ?? true,
    connectFails: o.connectFails ?? false,
    inFlight: 0,
    maxInFlight: 0,
  };
  // Antworten asynchron, aber deterministisch (setImmediate, nicht die echte Uhr)
  const notify = (ch: string, v: number[]) =>
    setImmediate(() =>
      value.forEach((cb) =>
        cb({ peripheral: MAC, characteristic: ch, value: v }),
      ),
    );
  const ble: BleLike = {
    start: async () => void calls.push("start"),
    checkState: async () => "on",
    scan: async (opts) => {
      calls.push("scan");
      scanOpts.push(opts);
      const list = o.advertise ?? [
        { id: MAC, rssi: -60, name: "MA331", advertising: MA331_ADV },
      ];
      setImmediate(() => list.forEach((p) => discover.forEach((cb) => cb(p))));
    },
    stopScan: async () => void calls.push("stopScan"),
    connect: async (id) => {
      calls.push(`connect ${id}`);
      if (state.connectFails) throw new Error("Connection error status 133");
    },
    disconnect: async (id) => void calls.push(`disconnect ${id}`),
    retrieveServices: async () => void calls.push("services"),
    startNotification: async (_id, _s, c) =>
      void calls.push(`notify ${c.slice(4, 8)}`),
    requestMTU: async (_id, mtu) => {
      calls.push(`mtu ${mtu}`);
      return o.mtu ?? 240;
    },
    requestConnectionPriorityHigh: async () => void calls.push("prio"),
    writeWithoutResponse: async (_id, _s, c, data) => {
      const ch = c.slice(4, 8);
      writes.push({ ch, hex: toHex(data) });
      if (ch === "af02" && data[0] === 0x18) {
        const r = (o.bindReply ?? (() => [0x19, 0x00]))(data[18]);
        if (r) notify("af02", r);
      } else if (ch === "af02" && data[0] === 0xe0)
        notify("af02", [0xe1, 1, 0, 1, 5, 1, 2, 3, 4, 5, 6, 7, 8]);
      else if (ch === "af01" && data[1] === 0xc6)
        notify("af01", [0x31, 0xc7, 1, 0, 1, 0, 0, 1, 0]);
      else if (ch === "af01" && data[1] === 0xc4) {
        const rr = o.settingsAck === undefined ? 1 : o.settingsAck;
        if (rr != null) notify("af01", [0x31, 0xc5, rr]);
      }
      else if (ch === "af01" && data[1] === 0xc2) {
        state.inFlight++;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        if (state.answerStatus)
          setImmediate(() => {
            state.inFlight--;
            value.forEach((cb) =>
              cb({
                peripheral: MAC,
                characteristic: "0000af01-0000-1000-8000-00805f9b34fb",
                value: encodeStatus({ state: 2, soc: 40 }),
              }),
            );
          });
      }
    },
    onDiscover: (cb) => (discover.add(cb), () => discover.delete(cb)),
    onDisconnect: (cb) => (disc.add(cb), () => disc.delete(cb)),
    onValue: (cb) => (value.add(cb), () => value.delete(cb)),
  };
  return {
    ble,
    calls,
    writes,
    scanOpts,
    state,
    dropConnection: () =>
      disc.forEach((cb) => cb({ peripheral: MAC, status: 8 })),
  };
}

function memPairing(
  initial?: PairingRecord,
  last?: string,
): PairingStore & { recs: Map<string, PairingRecord> } {
  const recs = new Map<string, PairingRecord>();
  if (initial) recs.set(initial.mac, initial);
  let lastDev = last ?? null;
  return {
    recs,
    get: async (m) => recs.get(m) ?? null,
    set: async (r) => void recs.set(r.mac, { ...r }),
    getLastDevice: async () => lastDev,
    setLastDevice: async (m) => {
      lastDev = m;
    },
  };
}

function setup(o: MockOpts = {}, pairing = memPairing()) {
  const clock = new FakeClock();
  const m = mockBle(o);
  const events: TransportEvent[] = [];
  const tr = createChargerTransport({
    ble: m.ble,
    pairing,
    randomBytes: (n) =>
      Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff),
    now: () => clock.t,
    timers: clock,
  });
  tr.subscribe((e) => events.push(e));
  return { clock, m, tr, events, pairing };
}

describe("Verbinden und Koppeln", () => {
  it("Erstkopplung: Filter-Scan, Notify AF01 → AF02 → MTU 240, Bind Modus 0, dann E0, Einstellungen, Status", async () => {
    const { clock, m, tr, events, pairing } = setup();
    tr.start();
    await clock.advance(3500); // Sammelzeit für unbekannte Geräte
    assert.deepEqual(
      (m.scanOpts[0] as { manufacturerFilter: unknown }).manufacturerFilter,
      ISDT_SCAN_FILTER,
    );
    const seq = m.calls.filter(
      (c) => !c.startsWith("stopScan") && c !== "start" && c !== "scan",
    );
    assert.deepEqual(seq, [
      `connect ${MAC}`,
      "prio",
      "services",
      "notify af01",
      "notify af02",
      "mtu 240",
    ]);
    const bind = m.writes[0];
    assert.equal(bind.ch, "af02");
    assert.match(bind.hex, /^18 ( ?[0-9a-f]{2}){16} 00 00$/);
    assert.equal(m.writes[1].hex, "e0");
    assert.equal(tr.snapshot().state, "connected");
    assert.equal(tr.snapshot().hardware?.firmwareLabel, "1.0.1.5");
    // gespeicherte Kopplung: eine zufällige ID je MAC, jetzt „schon gekoppelt“
    const rec = pairing.recs.get(MAC)!;
    assert.equal(rec.boundOnce, true);
    assert.equal(bind.hex.replace(/ /g, "").slice(2, 34), rec.appId);
    assert.equal(await pairing.getLastDevice(), MAC);
    await clock.advance(1000);
    assert.equal(m.writes[2].hex, "12 c6");
    assert.ok(tr.snapshot().settings);
    await clock.advance(1000);
    assert.equal(m.writes[3].hex, "12 c2");
    assert.ok(events.some((e) => e.type === "status"));
  });

  it("bekanntes Gerät: Bind Modus 1 mit gespeicherter ID, sofort verbinden", async () => {
    const appId = "3f2a9c1e5b7d40a89e1c6d2f8b4a7c10";
    const { clock, m, tr } = setup(
      {},
      memPairing(
        { mac: MAC, appId, modelId: "01400000", boundOnce: true },
        MAC,
      ),
    );
    tr.start();
    await clock.advance(10);
    assert.equal(
      m.writes[0].hex,
      "18 3f 2a 9c 1e 5b 7d 40 a8 9e 1c 6d 2f 8b 4a 7c 10 00 01",
    );
    assert.equal(tr.snapshot().state, "connected");
  });

  it("Modus 1 wird nicht bestätigt → nächstes Mal Erstkopplung (Modus 0) mit Hinweis", async () => {
    const appId = "3f2a9c1e5b7d40a89e1c6d2f8b4a7c10";
    const pairing = memPairing(
      { mac: MAC, appId, modelId: "01400000", boundOnce: true },
      MAC,
    );
    const { clock, m, tr } = setup(
      { bindReply: (mode) => (mode === 1 ? [0x19, 0x01] : [0x19, 0x00]) },
      pairing,
    );
    tr.start();
    await clock.advance(8100);
    assert.ok(
      m.writes.filter((w) => w.hex.endsWith("00 01")).length >= 7,
      "Bind wird jede Sekunde wiederholt",
    );
    assert.equal(tr.snapshot().hint, "repair");
    assert.equal(pairing.recs.get(MAC)!.boundOnce, false);
    await clock.advance(backoffMs(1) + 100);
    assert.ok(m.writes.some((w) => w.hex.endsWith("00 00")));
    assert.equal(tr.snapshot().state, "connected");
  });

  it("Bootloader 81400000 wird nicht verbunden (Hinweis)", async () => {
    const { clock, m, tr } = setup({
      advertise: [
        {
          id: MAC,
          rssi: -50,
          advertising: {
            manufacturerData: {
              abba: { bytes: [0xaf, 0xfa, 0x81, 0x40, 0, 0] },
            },
          },
        },
      ],
    });
    tr.start();
    await clock.advance(11_000);
    assert.equal(
      m.calls.some((c) => c.startsWith("connect")),
      false,
    );
    assert.equal(tr.snapshot().hint, "bootloader");
    assert.equal(tr.snapshot().state, "reconnecting");
  });

  it("nichts gefunden → Hinweis „Polying schließen / nicht gefunden“, zweiter Scan ohne Hardware-Filter", async () => {
    const { clock, m, tr } = setup({ advertise: [] });
    tr.start();
    await clock.advance(11_000);
    assert.equal(tr.snapshot().hint, "not-found");
    await clock.advance(backoffMs(1) + 100);
    assert.equal(
      (m.scanOpts[1] as { manufacturerFilter?: unknown }).manufacturerFilter,
      undefined,
    );
  });
});

describe("Suchdauer", () => {
  it("nichts gefunden → Suche nach 30 s beendet, kein weiterer Scan; „Erneut suchen“ startet neu", async () => {
    const { clock, m, tr } = setup({ advertise: [] });
    tr.start();
    await clock.advance(SEARCH_LIMIT_MS + 100);
    assert.equal(tr.snapshot().state, "stopped");
    assert.equal(tr.snapshot().lastError, SEARCH_ENDED_TEXT);
    assert.equal(tr.snapshot().hint, "not-found");
    const scans = m.calls.filter((c) => c === "scan").length;
    await clock.advance(120_000);
    assert.equal(m.calls.filter((c) => c === "scan").length, scans, "kein Scan im Hintergrund");
    tr.retryNow();
    assert.equal(tr.snapshot().state, "scanning");
    await clock.advance(1000);
    assert.equal(m.calls.filter((c) => c === "scan").length, scans + 1);
    await tr.stop();
  });

  it("Verbindung gefunden → kein Abbruch; nach Verbindungsverlust wieder höchstens 30 s Suche", async () => {
    const { clock, m, tr } = setup();
    tr.start();
    await clock.advance(SEARCH_LIMIT_MS + 5000);
    assert.equal(tr.snapshot().state, "connected");
    m.state.connectFails = true;
    m.dropConnection();
    await clock.advance(SEARCH_LIMIT_MS + 100);
    assert.equal(tr.snapshot().state, "stopped");
    assert.equal(tr.snapshot().lastError, SEARCH_ENDED_TEXT);
  });
});

describe("Einstellungen schreiben", () => {
  async function connected(o: MockOpts = {}) {
    const ctx = setup(o);
    ctx.tr.start();
    await ctx.clock.advance(3500);
    await ctx.clock.advance(1000); // 12 C6 → Einstellungen gelesen
    assert.ok(ctx.tr.snapshot().settings);
    return ctx;
  }

  it("schreibt genau 12 C4 mit dem geänderten Feld, wertet 31 C5 aus und liest neu", async () => {
    const { m, tr, clock } = await connected();
    const cur = tr.snapshot().settings!;
    const r = await tr.writeSettings({ ...cur, chargeTarget: 0 });
    assert.equal(r, "ok");
    assert.equal(m.writes.filter((w) => w.hex.startsWith("12 c4")).map((w) => w.hex)[0], "12 c4 00 00 01 00 00 01 00");
    // alter Stand bleibt sichtbar (keine springende Anzeige), es wird aber neu gelesen
    assert.notEqual(tr.snapshot().settings, null);
    await clock.advance(1000);
    assert.ok(m.writes.slice(-1)[0].hex === "12 c6");
  });

  it("abgelehnt und keine Antwort werden gemeldet; nicht verbunden wird nichts gesendet", async () => {
    const rej = await connected({ settingsAck: 0 });
    assert.equal(await rej.tr.writeSettings({ ...rej.tr.snapshot().settings!, lamp: true }), "rejected");
    const silent = await connected({ settingsAck: null });
    const p = silent.tr.writeSettings({ ...silent.tr.snapshot().settings!, lamp: true });
    await silent.clock.advance(5000);
    assert.equal(await p, "timeout");
    const off = setup();
    assert.equal(await off.tr.writeSettings({ chargeTarget: 1, dischargeToZero: false, alarm: true, lamp: false, mute: false, screenAutoOff: true, mode: 0 }), "not-connected");
    assert.equal(off.m.writes.length, 0);
    const bad = await connected();
    assert.equal(await bad.tr.writeSettings({ ...bad.tr.snapshot().settings!, mute: true, screenAutoOff: true }), "invalid");
    assert.ok(!bad.m.writes.some((w) => w.hex.startsWith("12 c4")));
  });
});

describe("Abfragen", () => {
  it("1-s-Takt, nie mehr als eine Anfrage unterwegs; 10 s ohne Antwort → neu verbinden", async () => {
    const { clock, m, tr, events } = setup();
    tr.start();
    await clock.advance(3500);
    await clock.advance(10_000);
    const polls = () => m.writes.filter((w) => w.hex === "12 c2").length;
    assert.ok(polls() >= 8 && polls() <= 10, `Polls: ${polls()}`);
    assert.equal(m.state.maxInFlight, 1);
    // Ladegerät antwortet nicht mehr
    m.state.answerStatus = false;
    const before = polls();
    await clock.advance(RESPONSE_TIMEOUT_MS - 1500);
    assert.equal(
      polls(),
      before + 1,
      "keine zweite Anfrage, solange die erste offen ist",
    );
    assert.equal(tr.snapshot().state, "connected");
    await clock.advance(2000);
    assert.equal(tr.snapshot().state, "reconnecting");
    assert.ok(events.some((e) => e.type === "connection-lost"));
    assert.ok(m.calls.includes(`disconnect ${MAC}`));
    // Neuverbinden (bekanntes Gerät, Modus 1)
    m.state.answerStatus = true;
    await clock.advance(backoffMs(1) + 200);
    assert.equal(tr.snapshot().state, "connected");
    assert.ok(m.writes.some((w) => w.hex.endsWith("00 01")));
  });

  it("Trennung durch das Gerät → Backoff 1, 2, 4 s …; Verbindungsfehler → Polying-Hinweis", async () => {
    const { clock, m, tr } = setup();
    tr.start();
    await clock.advance(3500);
    assert.equal(tr.snapshot().state, "connected");
    m.state.connectFails = true;
    m.dropConnection();
    await clock.advance(10);
    assert.equal(tr.snapshot().state, "reconnecting");
    assert.equal(tr.snapshot().failures, 1);
    await clock.advance(1000);
    assert.equal(tr.snapshot().failures, 2);
    assert.equal(tr.snapshot().hint, "polying");
    const next = tr.snapshot().nextRetryAt! - clock.t;
    assert.ok(
      next > backoffMs(1) && next <= backoffMs(2),
      `nächster Versuch in ${next} ms`,
    );
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 9].map(backoffMs),
      [1000, 2000, 4000, 8000, 15000, 30000, 30000],
    );
    m.state.connectFails = false;
    await clock.advance(next + 10);
    assert.equal(tr.snapshot().state, "connected");
    assert.equal(tr.snapshot().failures, 0);
    await tr.stop();
    assert.equal(tr.snapshot().state, "stopped");
  });

  it("BLE-Fehler werfen nie; unbekannte Frames werden nur protokolliert; Rohdaten-Puffer", async () => {
    const { clock, tr } = setup();
    tr.start();
    await clock.advance(5000);
    const raw = tr.rawFrames();
    assert.ok(raw.some((f) => f.dir === "tx" && f.hex === "12 c2"));
    assert.ok(raw.some((f) => f.dir === "rx" && f.hex.startsWith("31 c3")));
    // nichts außer erlaubten Anfragen wurde gesendet
    assert.ok(
      raw
        .filter((f) => f.dir === "tx")
        .every((f) => /^(12 c2|12 c6|e0|18 .*)$/.test(f.hex)),
    );
  });
});
