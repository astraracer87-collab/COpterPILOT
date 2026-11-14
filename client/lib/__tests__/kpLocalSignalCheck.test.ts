import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { summarizeKpLocalSignalCheck } from "../kpLocalSignalCheck";

describe("summarizeKpLocalSignalCheck", () => {
  it("fasst GPS-Genauigkeit und Magnetfeldmessungen zusammen", () => {
    const result = summarizeKpLocalSignalCheck(
      [8, 4, 6],
      [40, 42, 44],
    );
    assert.equal(result.gpsSampleCount, 3);
    assert.equal(result.gpsMedianAccuracyMeters, 6);
    assert.equal(result.magneticSampleCount, 3);
    assert.equal(result.magneticMeanMicrotesla, 42);
    assert.equal(result.magneticRangeMicrotesla, 4);
  });

  it("ignoriert ungültige Werte und meldet fehlende Messungen als null", () => {
    const result = summarizeKpLocalSignalCheck(
      [10, Number.NaN, -1],
      [Number.POSITIVE_INFINITY, -2],
    );
    assert.equal(result.gpsSampleCount, 1);
    assert.equal(result.gpsMedianAccuracyMeters, 10);
    assert.equal(result.magneticSampleCount, 0);
    assert.equal(result.magneticMeanMicrotesla, null);
    assert.equal(result.magneticRangeMicrotesla, null);
  });
});
