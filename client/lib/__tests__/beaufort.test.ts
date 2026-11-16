import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { beaufortLevel, droneWindVerdict, warnThresholdMs } from "../beaufort";

describe("beaufort", () => {
  it("maps WMO boundaries", () => {
    assert.equal(beaufortLevel(0).bft, 0);
    assert.equal(beaufortLevel(0.3).bft, 1);
    assert.equal(beaufortLevel(5.4).bft, 3);
    assert.equal(beaufortLevel(5.5).bft, 4);
    assert.equal(beaufortLevel(10.7).bft, 5);
    assert.equal(beaufortLevel(10.8).bft, 6);
    assert.equal(beaufortLevel(12).bft, 6);
    assert.equal(beaufortLevel(40).bft, 12);
  });

  it("handles invalid input", () => {
    assert.equal(beaufortLevel(NaN).bft, 0);
    assert.equal(beaufortLevel(-3).bft, 0);
  });

  it("warns from 80 % of the drone limit", () => {
    assert.ok(Math.abs(warnThresholdMs(10) - 8) < 1e-9);
    assert.equal(droneWindVerdict(7.9, 10), "ok");
    assert.equal(droneWindVerdict(8.1, 10), "caution");
    assert.equal(droneWindVerdict(10, 10), "caution");
    assert.equal(droneWindVerdict(10.1, 10), "over");
    assert.equal(droneWindVerdict(50, 0), "ok");
  });
});
