import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  batteryNumberOf,
  batteryDisplayName,
  compareBatteries,
  plausibleTs,
  computeBatteryStats,
  normalizeCycleCount,
  linkBatteryForLog,
} from "../djiBatteryLink";

describe("Akku-Nummern", () => {
  it("liest die Nummer aus Feld oder Namen „Akku 3“", () => {
    assert.equal(batteryNumberOf({ number: 4 }), 4);
    assert.equal(batteryNumberOf({ name: "Akku 3" }), 3);
    assert.equal(batteryNumberOf({ name: "Akku …02TE" }), undefined);
  });

  it("baut den Anzeigenamen aus Nummer bzw. Seriennummer", () => {
    assert.equal(batteryDisplayName({ number: 2, name: "x" }), "Akku 2");
    assert.equal(batteryDisplayName({ name: "", serialNumber: "7QKPM4ADA002TE" }), "Akku …02TE");
  });

  it("sortiert nummerierte Akkus zuerst, numerisch", () => {
    const list = [{ name: "Akku …02TE" }, { number: 10 }, { number: 2 }].sort(compareBatteries);
    assert.deepEqual(list.map((b) => batteryDisplayName(b)), ["Akku 2", "Akku 10", "Akku …02TE"]);
  });
});

describe("plausibleTs", () => {
  const now = Date.UTC(2026, 10, 22);
  it("verwirft Zeitstempel weit in der Zukunft (z. B. 2041)", () => {
    assert.equal(plausibleTs(Date.UTC(2041, 0, 26), now), undefined);
    assert.equal(plausibleTs(Date.UTC(2026, 9, 10), now), Date.UTC(2026, 9, 10));
    assert.equal(plausibleTs(0, now), undefined);
  });

  it("Akku-Statistik nutzt bei unplausiblem Log-Zeitstempel das Flugdatum", () => {
    const stats = computeBatteryStats(
      [{ id: "d1", name: "DJI Avata 2", batteries: [{ id: "b1", name: "Akku 1", serialNumber: "7QKPM4ADA002TE", createdAt: "" }] }],
      [
        {
          id: "e1",
          droneId: "d1",
          flightDate: "2026-11-01",
          djiLog: { batterySn: "7QKPM4ADA002TE", startTs: Date.UTC(2041, 0, 26), batteryCycleCount: 38 } as never,
        },
      ],
    );
    assert.equal(stats[0].lastUsedAt?.slice(0, 10), "2026-11-01");
    assert.equal(stats[0].trend[0].cycleCount, 38);
  });
});

describe("normalizeCycleCount", () => {
  it("rechnet byteweise vertauschte Werte zurück (512 → 2, 1024 → 4)", () => {
    assert.equal(normalizeCycleCount(512), 2);
    assert.equal(normalizeCycleCount(768), 3);
    assert.equal(normalizeCycleCount(1024), 4);
    assert.equal(normalizeCycleCount(38), 38);
    assert.equal(normalizeCycleCount(0), undefined);
    assert.equal(normalizeCycleCount(5000), undefined);
  });

  it("korrigiert einen falsch gespeicherten Zyklenstand beim nächsten Log", () => {
    const drone = { id: "d", name: "Neo", batteries: [{ id: "b", name: "Akku 1", serialNumber: "A4LPNAQCA037RL", createdAt: "", cycleCount: 512 }] };
    const res = linkBatteryForLog(drone, { batterySn: "A4LPNAQCA037RL", batteryCycleCount: 3, startTs: Date.UTC(2026, 2, 3) }, { now: "2026-11-22T00:00:00Z" });
    assert.equal(res.updatedDrone?.batteries?.[0].cycleCount, 3);
  });
});
