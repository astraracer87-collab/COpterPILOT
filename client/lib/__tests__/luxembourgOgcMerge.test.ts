import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeLuxembourgOgc } from "../../../shared/irishLuxGeozones";

// Echte Auszüge (2026-11-15): 1927 = 0–50 m, 1928 = 50–120 m; EL-UAS-S10 (0–120 m) steht in beiden.
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures", "lu-ogc-1927-1928-sample.json"), "utf8"));

test("Luxemburg: beide Höhenschichten, 0–120-m-Zonen nur einmal", () => {
  const out = mergeLuxembourgOgc([fx.c1927, fx.c1928]);
  const names = out.map((f: any) => String(f.properties.identifier)).sort();
  assert.deepEqual(names, ["EL-UAS-H1-1", "EL-UAS-H1-2", "EL-UAS-S10"]);
  const h1low = out.find((f: any) => f.properties.identifier === "EL-UAS-H1-1")!.properties;
  assert.equal(h1low.lowerMeters, 0);
  assert.equal(h1low.upperMeters, 50);
  const h1up = out.find((f: any) => f.properties.identifier === "EL-UAS-H1-2")!.properties;
  assert.equal(h1up.lowerMeters, 50);
  assert.equal(h1up.upperMeters, 120);
});
