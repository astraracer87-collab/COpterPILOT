import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dropFrequentisSystemFeatures,
  isFrequentisSystemFeature,
  isLithuaniaOutsideZone,
  type GeoFeature,
} from "../geozoneDirect/ed269Sources";
import { getGeozoneSourceMeta } from "../../../shared/geozoneSourceMeta";

// Handgebaute Features nach dem Feldschema aus
// docs/lithuania-ans-api-integration.md §6 (kein Live-Abruf).
function poly(ring: number[][], props: Record<string, unknown>): GeoFeature {
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: props };
}

const WORLD = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];
const VILNIUS = [
  [25.2, 54.6],
  [25.4, 54.6],
  [25.4, 54.75],
  [25.2, 54.75],
  [25.2, 54.6],
];
// Breiter Streifen (100° Länge, 1° Breite) bzw. hoher Streifen (1° × 50°).
const WIDE = [
  [-40, 50],
  [60, 50],
  [60, 51],
  [-40, 51],
  [-40, 50],
];
const TALL = [
  [20, 10],
  [21, 10],
  [21, 60],
  [20, 60],
  [20, 10],
];

describe("Frequentis-AVM – Systemzonen beim Abruf verwerfen", () => {
  it("„Outside Lithuania“ wird am Namen erkannt (auch ohne Welt-bbox)", () => {
    const f = poly(VILNIUS, { name: "Outside Lithuania", restriction: "PROHIBITED" });
    assert.equal(isLithuaniaOutsideZone(f), true);
    assert.equal(isFrequentisSystemFeature(f), true);
    assert.equal(isLithuaniaOutsideZone(poly(VILNIUS, { name: "URVI01" })), false);
  });

  it("PROHIBITED-Welt-Polygone (> 90° Länge oder > 45° Breite) fallen weg", () => {
    assert.equal(isFrequentisSystemFeature(poly(WORLD, { name: "X", restriction: "PROHIBITED" })), true);
    assert.equal(isFrequentisSystemFeature(poly(WIDE, { name: "X", restriction: "PROHIBITED" })), true);
    assert.equal(isFrequentisSystemFeature(poly(TALL, { name: "X", restriction: "PROHIBITED" })), true);
  });

  it("große Nicht-Verbotszonen und normale Verbotszonen bleiben", () => {
    assert.equal(isFrequentisSystemFeature(poly(WORLD, { name: "FIR", restriction: "REQ_AUTHORISATION" })), false);
    assert.equal(isFrequentisSystemFeature(poly(VILNIUS, { name: "URVI01", restriction: "PROHIBITED" })), false);
  });

  it("hidden === true (AT sys_*) fällt weg, hidden false bleibt", () => {
    assert.equal(isFrequentisSystemFeature(poly(VILNIUS, { name: "sys_1", hidden: true, restriction: "NO_RESTRICTION" })), true);
    assert.equal(isFrequentisSystemFeature(poly(VILNIUS, { name: "LOWW CTR", hidden: false, restriction: "REQ_AUTHORISATION" })), false);
  });

  it("vorhandene bbox wird genutzt; Reihenfolge der übrigen Zonen bleibt", () => {
    const withBbox: GeoFeature = { ...poly(VILNIUS, { name: "Y", restriction: "PROHIBITED" }), bbox: [-180, -85, 180, 85] };
    const keepA = poly(VILNIUS, { name: "A", restriction: "PROHIBITED" });
    const keepB = poly(VILNIUS, { name: "B", restriction: "REQ_AUTHORISATION" });
    const out = dropFrequentisSystemFeatures([
      keepA,
      withBbox,
      poly(WORLD, { name: "Outside Lithuania", restriction: "PROHIBITED" }),
      poly(VILNIUS, { name: "sys_2", hidden: true }),
      keepB,
    ]);
    assert.deepEqual(out.map((f) => f.properties.name), ["A", "B"]);
  });

  it("Registry: Flag frequentisAvm genau für AT, EE, LT", () => {
    for (const iso of ["AT", "EE", "LT"]) assert.equal(getGeozoneSourceMeta(iso)?.frequentisAvm, true, iso);
    for (const iso of ["DE", "PL", "IT", "CH", "LV"]) assert.ok(!getGeozoneSourceMeta(iso)?.frequentisAvm, iso);
  });
});
