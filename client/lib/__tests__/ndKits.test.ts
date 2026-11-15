// Drohne einrichten → Vorhandene ND-Filter → Schnellauswahl Standard-Kits:
// Hervorhebung folgt allein der Auswahl.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { activeNdKitId, applyNdKitSelection, buildNdKits, DJI_STANDARD_KIT } from "../ndKits";

const air3s = { model: "Air 3S", filterEcosystem: ["ND8", "ND16", "ND32", "ND64", "ND128", "ND256"] };

describe("ND-Kit-Hervorhebung", () => {
  it("leere Auswahl: kein Kit hervorgehoben (auch nicht das Preset-Set an erster Stelle)", () => {
    const kits = buildNdKits(air3s);
    assert.equal(kits[0].id, "preset");
    assert.equal(activeNdKitId([], kits), null);
  });

  it("DJI-Standard antippen wählt genau 8/32/128 und hebt nur dieses Kit hervor", () => {
    const kits = buildNdKits(air3s);
    const dji = kits.find((k) => k.id === "dji-standard")!;
    const selection = applyNdKitSelection(dji);
    assert.deepEqual(selection, ["ND8", "ND32", "ND128"]);
    assert.equal(activeNdKitId(selection, kits), "dji-standard");
  });

  it("Kit antippen ersetzt eine vorherige Auswahl statt sie zu ergänzen", () => {
    const kits = buildNdKits(air3s);
    const afterAir = applyNdKitSelection(kits[0]);
    assert.equal(activeNdKitId(afterAir, kits), "preset");
    const afterFpv = applyNdKitSelection(kits.find((k) => k.id === "fpv-standard")!);
    assert.deepEqual(afterFpv, ["ND8", "ND16", "ND32"]);
    assert.equal(activeNdKitId(afterFpv, kits), "fpv-standard");
  });

  it("Reihenfolge egal, abweichende Auswahl hebt nichts hervor", () => {
    const kits = buildNdKits(null);
    assert.equal(activeNdKitId(["ND128", "ND8", "ND32"], kits), "dji-standard");
    assert.equal(activeNdKitId(["ND8", "ND32"], kits), null);
    assert.equal(activeNdKitId([...DJI_STANDARD_KIT.filters, "ND2"], kits), null);
  });
});
