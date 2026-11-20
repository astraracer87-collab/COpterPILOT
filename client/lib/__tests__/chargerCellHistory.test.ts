import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cellHistory } from "../charger/batteryStats";
import { maxCellDelta, type SessionIndexEntry } from "../chargerStore";

const entry = (t: number, cells: number[] | undefined, maxDelta: number | null = null, status: "done" | "active" = "done"): SessionIndexEntry => ({
  id: `s${t}`, chargerId: "c", slot: 0, status, startedAt: t, startPercent: 20, endPercent: 100,
  chargedMah: 2000, startMah: 500, endMah: 2500, maxTempC: 30, maxCurrentA: 4, maxPowerW: 70,
  endCellDeltaMv: cells ? Math.max(...cells) - Math.min(...cells) : null, endCellsMv: cells, maxCellDeltaMv: maxDelta,
  cyclesStart: 1, cyclesEnd: 2, productionDate: "2025-05-22", samples: 10,
});

describe("Zell-Historie", () => {
  it("Verlauf je Zelle, Abweichung vom Mittel, schwächste Zelle, Spreizung beim Laden", () => {
    const h = cellHistory([
      entry(3, [4350, 4348, 4340, 4350], 25),
      entry(1, [4350, 4350, 4346, 4350], 12),
      entry(2, [4351, 4349, 4343, 4351], 18),
      entry(4, undefined, 30),
      entry(5, [4300, 4300, 4300, 4300], null, "active"),
    ]);
    assert.equal(h.cells, 4);
    assert.equal(h.sessions, 3);
    assert.deepEqual(h.endMv[2].map((p) => p.y), [4346, 4343, 4340]);
    assert.deepEqual(h.lowestCount, [0, 0, 3, 0]);
    assert.deepEqual(h.lastMv, [4350, 4348, 4340, 4350]);
    assert.equal(h.deviationMv[2][2].y, Math.round(4340 - (4350 + 4348 + 4340 + 4350) / 4));
    assert.deepEqual(h.maxDuringCharge.map((p) => p.y), [12, 18, 25, 30]);
  });

  it("ohne Zellwerte leer; Gleichstand zählt nicht als schwächste Zelle", () => {
    assert.equal(cellHistory([entry(1, undefined)]).cells, 0);
    assert.deepEqual(cellHistory([entry(1, [4200, 4200, 4200, 4200])]).lowestCount, [0, 0, 0, 0]);
  });

  it("größte Spreizung während des Ladens ignoriert ungültige Messpunkte", () => {
    assert.equal(maxCellDelta([{ cells: [3900, 3910, 3905, 3920] }, { cells: [0, 0, 0, 0] }, { cells: [4100, 4090, 4100, 4105] }]), 20);
    assert.equal(maxCellDelta([]), null);
  });
});
