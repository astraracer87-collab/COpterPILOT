import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  aircraftMslM,
  currentQnhHpa,
  pressureAltitudeToMslM,
  qnhLevelPressureAltitudeM,
  resetQnhForTests,
  setQnh,
} from "../altitude";
import { geoidUndulationM } from "../../../../shared/geoid";

const FRA = { latitude: 50.11, longitude: 8.68 };

describe("aircraft altitude (MSL)", () => {
  beforeEach(() => resetQnhForTests());

  it("geoid undulation matches EGM96 reference values", () => {
    assert.ok(Math.abs(geoidUndulationM(50.11, 8.68) - 48.18) < 1);
    assert.ok(Math.abs(geoidUndulationM(52.52, 13.4) - 39.53) < 2);
    assert.ok(Math.abs(geoidUndulationM(40.71, -74.0) - -32.76) < 2);
    assert.ok(Math.abs(geoidUndulationM(-33.87, 151.21) - 22.42) < 2);
    assert.ok(Number.isFinite(geoidUndulationM(90, 180)));
    assert.ok(Number.isFinite(geoidUndulationM(-90, -180)));
  });

  it("QNH correction: ~8 m per hPa, sign by pressure", () => {
    assert.ok(Math.abs(qnhLevelPressureAltitudeM(1013.25)) < 0.01);
    const low = pressureAltitudeToMslM(1000, 990);
    assert.ok(low < 1000 - 180 && low > 1000 - 210, `low ${low}`);
    const high = pressureAltitudeToMslM(1000, 1030);
    assert.ok(high > 1000 + 130 && high < 1000 + 150, `high ${high}`);
  });

  it("prefers MSL > geometric (geoid-corrected) > baro (QNH-corrected)", () => {
    assert.equal(aircraftMslM({ ...FRA, baroAltitude: 900, geoAltitude: 1000, mslAltitude: 500 }), 500);
    const geo = aircraftMslM({ ...FRA, baroAltitude: 900, geoAltitude: 1000 })!;
    assert.ok(Math.abs(geo - (1000 - 48.18)) < 1);
    assert.equal(aircraftMslM({ ...FRA, baroAltitude: 900, geoAltitude: null }), 900);
    setQnh(990, FRA.latitude, FRA.longitude);
    const baro = aircraftMslM({ ...FRA, baroAltitude: 900, geoAltitude: null })!;
    assert.ok(baro < 720 && baro > 690, `baro ${baro}`);
    assert.equal(aircraftMslM({ ...FRA, baroAltitude: 0, geoAltitude: null, onGround: true }), 0);
    assert.equal(aircraftMslM({ ...FRA, baroAltitude: null, geoAltitude: null }), null);
  });

  it("QNH: implausible ignored, expires after 3 h", () => {
    setQnh(500, 0, 0);
    assert.equal(currentQnhHpa(), null);
    const t = Date.now();
    setQnh(1005, 0, 0, t);
    assert.equal(currentQnhHpa(t + 60_000), 1005);
    assert.equal(currentQnhHpa(t + 4 * 3600_000), null);
  });
});
