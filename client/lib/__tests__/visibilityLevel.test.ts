import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibilityLevel, computeRadarAreaFlags } from "../radarAlertLogic";

describe("Sichtweite relativ zu VLOS", () => {
  it("unter VLOS rot, unter 2 km orange, sonst ok", () => {
    assert.equal(visibilityLevel(180, 210), "critical");
    assert.equal(visibilityLevel(220, 210), "caution");
    assert.equal(visibilityLevel(1900, 210), "caution");
    assert.equal(visibilityLevel(2500, 210), "hint");
    assert.equal(visibilityLevel(5000, 210), "ok");
    assert.equal(visibilityLevel(undefined, 210), "ok");
  });
  it("Wetter-Reiter folgt der VLOS-Regel", () => {
    const base = { kpValue: null, notamUnknown: false, highNotamCount: 0, tempRestrictionCount: 0, activeDipulCount: 0, geozoneCount: 0 };
    const f = { windSpeed: 2, rain: 0, snow: 0, temperature: 10, cloudCover: 20, visibility: 180 };
    assert.equal(computeRadarAreaFlags({ ...base, forecast: f, vlosM: 210 }).weatherStatus, "critical");
    assert.equal(computeRadarAreaFlags({ ...base, forecast: { ...f, visibility: 900 }, vlosM: 210 }).weatherStatus, "caution");
  });
});
