import { test } from "node:test";
import assert from "node:assert/strict";

import { findPresetForDrone, searchPresets } from "../dronePresets";
import { computeHorizontalVlosLimitM, computeVlosM } from "../vlos";

// CD aus dem Hoverpoint-Katalog (Spannweite inkl. Propeller, vom Nutzer freigegeben)
const expectedPresets = [
  { model: "Air 3S", dimensionM: 0.58, vlosM: 210 },
  { model: "Avata 2", dimensionM: 0.25, vlosM: 102 },
  { model: "Mini 4 Pro", dimensionM: 0.395, vlosM: 149 },
  { model: "Mini 5 Pro", dimensionM: 0.4, vlosM: 151 },
  { model: "Mavic 3T", dimensionM: 0.6, vlosM: 216 },
  { model: "Matrice 4T", dimensionM: 0.71, vlosM: 252 },
  { model: "Matrice 4TD", dimensionM: 0.825, vlosM: 290 },
  { model: "Matrice 30T", dimensionM: 1.05, vlosM: 363 },
];

test("drone presets calculate the intended propeller-inclusive ALOS values", () => {
  for (const expected of expectedPresets) {
    const preset = findPresetForDrone(`DJI ${expected.model}`, "DJI", expected.model);
    assert.ok(preset, `Expected a preset for ${expected.model}`);
    assert.equal(preset.charDimensionM, expected.dimensionM, `${expected.model} CD`);
    assert.equal(computeVlosM(preset.charDimensionM).vlosM, expected.vlosM, `${expected.model} VLOS`);
  }
});

test("Mavic 3T preset matches searches with a space before T", () => {
  const preset = findPresetForDrone("DJI Mavic 3 T", "DJI", "Mavic 3 T");
  assert.equal(preset?.model, "Mavic 3T");
  assert.ok(searchPresets("Mavic 3 T").some((result) => result.model === "Mavic 3T"));
});

test("Matrice 4TD preset matches searches with a space before TD", () => {
  const preset = findPresetForDrone("DJI Matrice 4 TD", "DJI", "Matrice 4 TD");
  assert.equal(preset?.model, "Matrice 4TD");
  assert.ok(searchPresets("Matrice 4 TD").some((result) => result.model === "Matrice 4TD"));
});

test("height correction converts direct VLOS distance into a conservative horizontal radius", () => {
  assert.equal(computeHorizontalVlosLimitM(151, 0), 151);
  assert.equal(computeHorizontalVlosLimitM(151, 120), 91);
  assert.equal(computeHorizontalVlosLimitM(120, 120), 0);
  assert.equal(computeHorizontalVlosLimitM(100, 120), 0);
});
