import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayBounds } from "../notamFocusBounds";

test("Fokus-Rahmen umfasst das ganze Polygon", () => {
  const b = overlayBounds({
    
    groups: [[[[54.0, 9.0], [54.0, 11.0], [55.0, 11.0], [55.0, 9.0], [54.0, 9.0]]]],
  });
  assert.deepEqual(b, { minLat: 54, maxLat: 55, minLon: 9, maxLon: 11 });
});

test("Kreis ohne Polygon: Rahmen um den Radius", () => {
  const b = overlayBounds({ center: [50, 8], radiusM: 10000 });
  assert.ok(b && b.maxLat - b.minLat > 0.15 && b.maxLat - b.minLat < 0.2);
});
