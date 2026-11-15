// Hervorhebung großer Geozonen endet am Prüfkreis.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clipRingGroupToCircle } from "../circleClip";

const center: [number, number] = [51, 9];
const distM = (p: [number, number]) => Math.hypot((p[0] - center[0]) * 111320, (p[1] - center[1]) * 111320 * Math.cos((center[0] * Math.PI) / 180));

describe("clipRingGroupToCircle", () => {
  it("langer Korridor (Autobahn) wird am Kreis abgeschnitten", () => {
    const corridor: [number, number][] = [[50.999, 8], [50.999, 10], [51.001, 10], [51.001, 8], [50.999, 8]];
    const out = clipRingGroupToCircle([corridor], center, 3000);
    assert.equal(out.length, 1);
    for (const p of out[0]) assert.ok(distM(p) <= 3001, `Punkt außerhalb: ${distM(p)}`);
    const lons = out[0].map((p) => p[1]);
    assert.ok(Math.max(...lons) - Math.min(...lons) < 0.1, "nur der Teil im Kreis");
  });
  it("Zone ganz außerhalb → nichts", () => {
    const far: [number, number][] = [[52, 9], [52, 9.1], [52.1, 9.1], [52.1, 9], [52, 9]];
    assert.deepEqual(clipRingGroupToCircle([far], center, 3000), []);
  });
  it("kleine Zone im Kreis bleibt unverändert", () => {
    const small: [number, number][] = [[51.001, 9.001], [51.001, 9.002], [51.002, 9.002], [51.002, 9.001]];
    const out = clipRingGroupToCircle([small], center, 3000);
    assert.equal(out[0].length, 4);
    out[0].forEach((p, i) => {
      assert.ok(Math.abs(p[0] - small[i][0]) < 1e-9 && Math.abs(p[1] - small[i][1]) < 1e-9);
    });
  });
  it("Radius 0 → nichts", () => {
    assert.deepEqual(clipRingGroupToCircle([[[51, 9], [51, 9.1], [51.1, 9]]], center, 0), []);
  });
});
