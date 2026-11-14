import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { polygonGroupsIntersectCircle } from "../geozoneSpatial";

const donut = [[
  [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]],
  [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006], [0.004, 0.004]],
]] as [number, number][][][];

describe("polygonGroupsIntersectCircle", () => {
  it("does not report a planning circle wholly inside a polygon hole", () => {
    assert.equal(polygonGroupsIntersectCircle(donut, 0.005, 0.005, 50), false);
  });

  it("reports a circle that reaches a hole boundary", () => {
    assert.equal(polygonGroupsIntersectCircle(donut, 0.005, 0.005, 150), true);
  });

  it("reports a circle centered in the filled area or touching the outer edge", () => {
    assert.equal(polygonGroupsIntersectCircle(donut, 0.002, 0.002, 10), true);
    assert.equal(polygonGroupsIntersectCircle(donut, 0.005, 0.012, 250), true);
  });

  it("checks separate MultiPolygon parts independently", () => {
    const groups = [
      [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
      [[[1, 1], [1.001, 1], [1.001, 1.001], [1, 1.001], [1, 1]]],
    ] as [number, number][][][];
    assert.equal(polygonGroupsIntersectCircle(groups, 1.0005, 1.0005, 10), true);
    assert.equal(polygonGroupsIntersectCircle(groups, 0.5, 0.5, 10), false);
  });
});
