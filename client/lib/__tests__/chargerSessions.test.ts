// Ladevorgänge (client/lib/charger/chargeSession.ts): Start/Ende, Unterbrechung,
// Akku-Wechsel, Ausdünnen der Zeitreihe; Akku-Erkennung (batteryFingerprint.ts);
// Hintergrund-Entscheidungen (chargerBackground.ts); Tab-Badge (chargerTabBadge.ts).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  appendSample,
  createSessionTracker,
  downsampleSeries,
  RESUME_WINDOW_MS,
  SAMPLE_INTERVAL_MS,
  STOP_GRACE_MS,
  type ChargeSample,
} from "../charger/chargeSession";
import {
  batteryKey,
  linkBattery,
  matchFingerprint,
  touchLink,
  type BatteryLink,
} from "../charger/batteryFingerprint";
import {
  CHARGER_BACKGROUND_HELP,
  CHARGER_BACKGROUND_SETTING_TITLE,
  CHARGER_SERVICE_TITLE,
  decideOnAppBackground,
  decideOnLeave,
  IDLE_AUTO_STOP_MS,
  LEAVE_DIALOG_CONTINUE,
  LEAVE_DIALOG_STOP,
  LEAVE_DIALOG_TITLE,
  parseBackgroundMode,
  resolveLeaveDialog,
  shouldAutoStop,
} from "../charger/chargerBackground";
import {
  BADGE_GREEN,
  BADGE_RED,
  BADGE_YELLOW,
  chargerTabBadge,
} from "../charger/chargerTabBadge";
import { computeBatteryStats, trendSeries } from "../charger/batteryStats";
import { status } from "./helpers/chargerFixtures";

function tracker() {
  let n = 0;
  return createSessionTracker({ chargerId: "AA:BB", newId: () => `s${++n}` });
}

describe("Ladevorgang: Start und Ende", () => {
  it("startet bei „Lädt“, sammelt Maxima, endet bei „Voll“", () => {
    const t = tracker();
    assert.deepEqual(t.update(status({ state: 1, soc: 20 }), 0), []);
    const ev = t.update(
      status({ state: 2, soc: 20, mah: 1000, cycles: 47 }),
      1000,
    );
    assert.equal(ev.length, 1);
    assert.equal(ev[0].type, "started");
    assert.equal(ev[0].session.startedMidway, false);
    t.update(
      status({
        state: 2,
        soc: 60,
        mah: 2500,
        temp: 38,
        a: 4.1,
        w: 66,
        cycles: 47,
      }),
      1000 + 5000,
    );
    t.update(
      status({
        state: 2,
        soc: 80,
        mah: 3300,
        temp: 41,
        a: 3.0,
        w: 50,
        cycles: 48,
      }),
      1000 + 15000,
    );
    const end = t.update(
      status({
        state: 3,
        soc: 100,
        mah: 4241,
        temp: 35,
        a: 0,
        w: 0,
        cycles: 48,
        cells: [4350, 4348, 4351, 4330],
      }),
      1000 + 30000,
    );
    assert.equal(end.length, 1);
    const s = end[0].session;
    assert.equal(end[0].type, "ended");
    assert.equal(s.endReason, "full");
    assert.equal(s.status, "done");
    assert.equal(s.startPercent, 20);
    assert.equal(s.endPercent, 100);
    assert.equal(s.chargedMah, 3241);
    assert.equal(s.maxTempC, 41);
    assert.equal(s.maxCurrentA, 4.1);
    assert.equal(s.maxPowerW, 66);
    assert.equal(s.cyclesStart, 47);
    assert.equal(s.cyclesEnd, 48);
    assert.equal(s.endCellDeltaMv, 21);
    assert.deepEqual(s.endCellsMv, [4350, 4348, 4351, 4330]);
    assert.equal(s.productionDate, "2024-05-13");
    assert.equal(s.endedAt, 31000);
    // 5-s-Punkt wird ausgelassen (10-s-Raster), Endpunkt immer
    assert.deepEqual(
      s.series.map((p) => p.t),
      [1000, 16000, 31000],
    );
    assert.equal(t.active().length, 0);
  });

  it("erster Blick zeigt schon „Lädt“ → startedMidway", () => {
    const t = tracker();
    const ev = t.update(status({ state: 2 }), 0);
    assert.equal(ev[0].session.startedMidway, true);
  });

  it("Entnahme, Fehler, Akkuwechsel, Stopp nach Karenz, Wärme pausiert nur", () => {
    const t = tracker();
    t.update(
      status({ state: 2 }, { state: 2 }, { state: 2, date: [2023, 1, 1] }),
      0,
    );
    let ev = t.update(
      status(
        { state: 0 },
        { state: 6 },
        { state: 7, temp: 52, date: [2023, 1, 1] },
      ),
      2000,
    );
    const reasons = Object.fromEntries(
      ev.map((e) => [e.session.slot, e.session.endReason]),
    );
    assert.deepEqual(reasons, { 0: "removed", 1: "error" });
    assert.equal(t.activeForSlot(2)?.warnings[0], "overtemp");
    // anderer Akku (Datum anders) in Schacht 3 → altes Ende + neuer Start
    ev = t.update(
      status({ state: 0 }, { state: 0 }, { state: 2, date: [2024, 2, 2] }),
      4000,
    );
    assert.deepEqual(
      ev.map((e) => [e.type, e.session.endReason ?? null]),
      [
        ["ended", "removed"],
        ["started", null],
      ],
    );
    // gleicher Akku, Zyklen kleiner → auch Wechsel
    ev = t.update(
      status(
        { state: 0 },
        { state: 0 },
        { state: 2, date: [2024, 2, 2], cycles: 3 },
      ),
      6000,
    );
    assert.equal(ev[0].session.endReason, "removed");
    // Bereit → erst nach Karenz „stopped“
    assert.deepEqual(
      t.update(
        status(
          { state: 0 },
          { state: 0 },
          { state: 1, date: [2024, 2, 2], cycles: 3 },
        ),
        8000,
      ),
      [],
    );
    ev = t.update(
      status(
        { state: 0 },
        { state: 0 },
        { state: 1, date: [2024, 2, 2], cycles: 3 },
      ),
      8000 + STOP_GRACE_MS,
    );
    assert.equal(ev[0].session.endReason, "stopped");
  });
});

describe("Ladevorgang: Unterbrechung", () => {
  it("kurze Trennung → läuft weiter (Lücke gezählt)", () => {
    const t = tracker();
    t.update(status({ state: 2, soc: 30 }), 0);
    t.connectionLost(5000);
    const ev = t.update(status({ state: 2, soc: 35 }), 60_000);
    assert.deepEqual(ev, []);
    const s = t.activeForSlot(0)!;
    assert.equal(s.gaps, 1);
    assert.equal(s.endPercent, 35);
  });

  it("lange Trennung → „disconnected“ zum letzten Messpunkt, danach neuer Vorgang", () => {
    const t = tracker();
    t.update(status({ state: 2, soc: 30 }), 0);
    t.update(status({ state: 2, soc: 40 }), 20_000);
    t.connectionLost(21_000);
    const ev = t.update(
      status({ state: 2, soc: 90 }),
      20_000 + RESUME_WINDOW_MS + 1,
    );
    assert.equal(ev[0].type, "ended");
    assert.equal(ev[0].session.endReason, "disconnected");
    assert.equal(ev[0].session.endedAt, 20_000);
    assert.equal(ev[1].type, "started");
  });

  it("finalizeAll speichert Teil-Vorgänge als „interrupted“; restore setzt fort", () => {
    const t = tracker();
    t.update(status({ state: 2, soc: 30 }, { state: 2, soc: 70 }), 0);
    t.update(status({ state: 2, soc: 31 }, { state: 2, soc: 71 }), 10_000);
    const active = t.active().map((s) => JSON.parse(JSON.stringify(s)));
    const done = t.finalizeAll("interrupted", 99_000);
    assert.equal(done.length, 2);
    assert.ok(
      done.every((s) => s.endReason === "interrupted" && s.endedAt === 10_000),
    );
    // Neustart (z. B. App neu): offene Vorgänge aus dem Speicher übernehmen
    const t2 = tracker();
    t2.restore(active);
    assert.equal(t2.active().length, 2);
    const ev = t2.update(
      status({ state: 3, soc: 100 }, { state: 2, soc: 75 }),
      60_000,
    );
    assert.equal(ev.length, 1);
    assert.equal(ev[0].session.id, active[0].id);
    assert.equal(ev[0].session.endReason, "full");
    assert.equal(t2.activeForSlot(1)?.gaps, 1);
  });
});

describe("Ausdünnen", () => {
  it("appendSample hält das 10-s-Raster, force hängt immer an", () => {
    const s: ChargeSample[] = [];
    const p = (t: number): ChargeSample => ({
      t,
      soc: 0,
      mah: 0,
      a: 0,
      w: 0,
      temp: 0,
      cells: [],
    });
    for (let t = 0; t <= 60_000; t += 1000)
      appendSample(s, p(t), SAMPLE_INTERVAL_MS);
    assert.deepEqual(
      s.map((x) => x.t),
      [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000],
    );
    assert.equal(appendSample(s, p(61_000), SAMPLE_INTERVAL_MS), false);
    assert.equal(appendSample(s, p(61_000), SAMPLE_INTERVAL_MS, true), true);
    assert.equal(s.length, 8);
  });

  it("downsampleSeries: höchstens n Punkte, erster und letzter bleiben", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsampleSeries(pts, 50);
    assert.equal(d.length, 50);
    assert.equal(d[0], 0);
    assert.equal(d[49], 999);
    assert.deepEqual(downsampleSeries([1, 2, 3], 10), [1, 2, 3]);
    // 1 h bei 1-s-Abfrage → 360 Punkte gespeichert
    const s: ChargeSample[] = [];
    for (let t = 0; t < 3_600_000; t += 1000)
      appendSample(
        s,
        { t, soc: 0, mah: 0, a: 0, w: 0, temp: 0, cells: [] },
        SAMPLE_INTERVAL_MS,
      );
    assert.equal(s.length, 360);
  });
});

describe("Akku-Erkennung (Fingerabdruck)", () => {
  const L = (batteryId: string, date: string, cycles: number): BatteryLink => ({
    key: batteryKey({ droneId: "d1", batteryId }),
    droneId: "d1",
    batteryId,
    label: batteryId,
    productionDate: date,
    lastCycles: cycles,
    lastSeenAt: 0,
  });

  it("gleiches Datum, Zyklen gleich oder +1/+2 → Treffer", () => {
    const links = [L("A", "2024-05-13", 47), L("B", "2023-11-02", 112)];
    for (const c of [47, 48, 49]) {
      const r = matchFingerprint(links, {
        productionDate: "2024-05-13",
        cycles: c,
      });
      assert.equal(r.kind, "match");
      assert.equal(r.kind === "match" && r.link.batteryId, "A");
    }
  });

  it("unbekanntes Datum oder gesunkene Zyklen → nachfragen (unbekannt)", () => {
    const links = [L("A", "2024-05-13", 47)];
    assert.deepEqual(
      matchFingerprint(links, { productionDate: "2022-01-01", cycles: 5 }),
      { kind: "ask", reason: "unknown", candidates: [] },
    );
    assert.equal(
      matchFingerprint(links, { productionDate: "2024-05-13", cycles: 40 })
        .kind,
      "ask",
    );
  });

  it("einziger Akku mit diesem Datum, viele Zyklen später (woanders geladen) → Treffer", () => {
    const r = matchFingerprint([L("A", "2024-05-13", 47)], {
      productionDate: "2024-05-13",
      cycles: 60,
    });
    assert.equal(r.kind, "match");
  });

  it("zwei Akkus mit gleichem Datum: Monotonie entscheidet, sonst nachfragen", () => {
    const links = [L("A", "2024-05-13", 47), L("B", "2024-05-13", 80)];
    // 48: nur A ist nahe (B hätte rückwärts gezählt)
    const a = matchFingerprint(links, {
      productionDate: "2024-05-13",
      cycles: 48,
    });
    assert.equal(a.kind === "match" && a.link.batteryId, "A");
    // 81: nur B ist nahe (A wäre +34)
    const b = matchFingerprint(links, {
      productionDate: "2024-05-13",
      cycles: 81,
    });
    assert.equal(b.kind === "match" && b.link.batteryId, "B");
    // 60: nur A wäre monoton, aber +13 und es gibt zwei Akkus mit diesem Datum → fragen, A vorschlagen
    const c = matchFingerprint(links, {
      productionDate: "2024-05-13",
      cycles: 60,
    });
    assert.equal(c.kind === "ask" && c.reason, "ambiguous");
    assert.deepEqual(c.kind === "ask" && c.candidates.map((x) => x.batteryId), [
      "A",
    ]);
    // 90: beide monoton → mehrdeutig, Kandidaten nach Nähe
    const d = matchFingerprint(links, {
      productionDate: "2024-05-13",
      cycles: 90,
    });
    assert.equal(d.kind, "ask");
    assert.equal(d.kind === "ask" && d.reason, "ambiguous");
    assert.deepEqual(d.kind === "ask" && d.candidates.map((x) => x.batteryId), [
      "B",
      "A",
    ]);
    // beide nahe (47/48 → 48) → mehrdeutig
    const e = matchFingerprint(
      [L("A", "2024-05-13", 47), L("B", "2024-05-13", 48)],
      { productionDate: "2024-05-13", cycles: 48 },
    );
    assert.equal(e.kind === "ask" && e.reason, "ambiguous");
  });

  it("belegte Akkus (anderer Schacht) sind ausgeschlossen", () => {
    const links = [L("A", "2024-05-13", 47), L("B", "2024-05-13", 48)];
    const r = matchFingerprint(
      links,
      { productionDate: "2024-05-13", cycles: 48 },
      { exclude: new Set([links[0].key]) },
    );
    assert.equal(r.kind === "match" && r.link.batteryId, "B");
  });

  it("Antwort speichern: eine Verknüpfung je Akku, Zyklen nie rückwärts", () => {
    let links = linkBattery(
      [],
      { droneId: "d1", batteryId: "A", label: "A" },
      { productionDate: "2024-05-13", cycles: 47 },
      1,
    );
    links = linkBattery(
      links,
      { droneId: "d1", batteryId: "A", label: "A" },
      { productionDate: "2024-05-13", cycles: 50 },
      2,
    );
    assert.equal(links.length, 1);
    assert.equal(links[0].lastCycles, 50);
    links = touchLink(
      links,
      links[0].key,
      { productionDate: "2024-05-13", cycles: 49 },
      3,
    );
    assert.equal(links[0].lastCycles, 50);
    assert.equal(batteryKey({ batteryId: "x" }), "-/x");
  });
});

describe("Hintergrund-Loggen", () => {
  it("Texte (loggen)", () => {
    assert.equal(
      CHARGER_BACKGROUND_SETTING_TITLE,
      "Ladegerät im Hintergrund loggen",
    );
    assert.equal(
      LEAVE_DIALOG_TITLE,
      "Ladevorgang läuft – im Hintergrund weiter loggen?",
    );
    assert.equal(LEAVE_DIALOG_CONTINUE, "Im Hintergrund loggen");
    assert.equal(LEAVE_DIALOG_STOP, "Beenden");
    assert.equal(CHARGER_SERVICE_TITLE, "Ladegerät wird geloggt");
    assert.match(CHARGER_BACKGROUND_HELP, /Home-Taste/);
    assert.match(CHARGER_BACKGROUND_HELP, /loggen/);
  });

  it("Standard „Immer fragen“; Verlassen/Hintergrund je Einstellung", () => {
    assert.equal(parseBackgroundMode(null), "ask");
    assert.equal(parseBackgroundMode("quatsch"), "ask");
    assert.equal(decideOnLeave("ask", true), "ask");
    assert.equal(decideOnLeave("always", true), "continue");
    assert.equal(decideOnLeave("never", true), "stop");
    for (const m of ["ask", "always", "never"] as const) {
      assert.equal(decideOnLeave(m, false), "stop");
      assert.equal(decideOnAppBackground(m, false), "stop");
    }
    // Home-Taste: kein Dialog möglich → bei „Immer fragen“ weiter loggen
    assert.equal(decideOnAppBackground("ask", true), "continue");
    assert.equal(decideOnAppBackground("always", true), "continue");
    assert.equal(decideOnAppBackground("never", true), "stop");
  });

  it("„Auswahl merken“ setzt die Einstellung", () => {
    assert.deepEqual(resolveLeaveDialog("continue", true), {
      action: "continue",
      newMode: "always",
    });
    assert.deepEqual(resolveLeaveDialog("stop", true), {
      action: "stop",
      newMode: "never",
    });
    assert.deepEqual(resolveLeaveDialog("stop", false), {
      action: "stop",
      newMode: null,
    });
  });

  it("Auto-Ende: 10 min ohne Arbeit, dauerhaft getrennt", () => {
    const base = {
      now: 0,
      idleSince: null,
      activeSessions: 0,
      disconnectedSince: null,
      failures: 0,
    };
    assert.equal(
      shouldAutoStop({ ...base, now: IDLE_AUTO_STOP_MS, idleSince: 0 }),
      "idle",
    );
    assert.equal(
      shouldAutoStop({ ...base, now: IDLE_AUTO_STOP_MS - 1, idleSince: 0 }),
      null,
    );
    assert.equal(
      shouldAutoStop({
        ...base,
        now: IDLE_AUTO_STOP_MS,
        idleSince: 0,
        activeSessions: 1,
      }),
      null,
    );
    assert.equal(
      shouldAutoStop({ ...base, now: 1000, disconnectedSince: 0, failures: 8 }),
      "connection-lost",
    );
    assert.equal(
      shouldAutoStop({
        ...base,
        now: 5 * 60_000,
        disconnectedSince: 0,
        failures: 2,
      }),
      "connection-lost",
    );
    assert.equal(
      shouldAutoStop({
        ...base,
        now: 60_000,
        disconnectedSince: 0,
        failures: 2,
      }),
      null,
    );
  });
});

describe("Akkus-Tab-Badge", () => {
  it("je Zustand und Vorrang Warnung > lädt > verbunden > verbindet", () => {
    assert.equal(
      chargerTabBadge({ connected: false, connecting: false, slotStates: [] })
        .visible,
      false,
    );
    const c = chargerTabBadge({
      connected: false,
      connecting: true,
      slotStates: [],
    });
    assert.deepEqual(
      [c.kind, c.color, c.pulseMs != null],
      ["connecting", BADGE_YELLOW, true],
    );
    assert.equal(BADGE_YELLOW, "#FFD60A");
    const idle = chargerTabBadge({
      connected: true,
      connecting: false,
      slotStates: [0, 3, 1],
    });
    assert.deepEqual(
      [idle.kind, idle.color, idle.icon, idle.text],
      ["connected", BADGE_GREEN, null, ""],
    );
    const ch = chargerTabBadge({
      connected: true,
      connecting: true,
      slotStates: [2, 3, 0],
    });
    assert.deepEqual(
      [ch.kind, ch.icon, ch.color],
      ["charging", "zap", BADGE_GREEN],
    );
    for (const w of [6, 7, 8]) {
      const b = chargerTabBadge({
        connected: true,
        connecting: false,
        slotStates: [2, w, 0],
      });
      assert.deepEqual(
        [b.kind, b.color, b.text, b.pulseMs != null],
        ["warning", BADGE_RED, "!", true],
      );
    }
  });
});

describe("Akku-Kennzahlen", () => {
  const e = (startedAt: number, extra: Record<string, unknown>) =>
    ({
      id: String(startedAt),
      chargerId: "x",
      slot: 0,
      status: "done",
      endReason: "full",
      startedAt,
      endedAt: startedAt + 1,
      startPercent: 20,
      endPercent: 100,
      chargedMah: 3000,
      startMah: 1000,
      endMah: 4200,
      maxTempC: 40,
      maxCurrentA: 4,
      maxPowerW: 60,
      endCellDeltaMv: 10,
      cyclesStart: 1,
      cyclesEnd: 2,
      productionDate: "2024-05-13",
      samples: 3,
      ...extra,
    }) as never;

  it("Zustand aus Spreizung und Kapazität, Trends nach Zeit", () => {
    const good = computeBatteryStats([
      e(1, {}),
      e(2, { endMah: 4100, cyclesEnd: 3 }),
    ]);
    assert.equal(good.health, "good");
    assert.equal(good.cycles, 3);
    assert.equal(
      computeBatteryStats([e(1, {}), e(2, { endCellDeltaMv: 45 })]).health,
      "good",
    );
    assert.equal(
      computeBatteryStats([e(1, {}), e(2, { endCellDeltaMv: 60 })]).health,
      "watch",
    );
    assert.equal(
      computeBatteryStats([e(1, {}), e(2, { endCellDeltaMv: 100 })]).health,
      "bad",
    );
    assert.equal(
      computeBatteryStats([e(1, {}), e(2, { endMah: 3000 })]).health,
      "bad",
    );
    assert.equal(computeBatteryStats([]).health, "unknown");
    const tr = trendSeries([e(2, { cyclesEnd: 5 }), e(1, { cyclesEnd: 4 })]);
    assert.deepEqual(
      tr.cycles.map((p) => p.y),
      [4, 5],
    );
  });
});
