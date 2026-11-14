import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyFrRestrictionType,
  FR_ZONE_TYPES,
  type FrZoneTypeKey,
} from "../frZoneTypes";

describe("classifyFrRestrictionType", () => {
  const cases: { limite: string; remarque: string; expected: FrZoneTypeKey }[] = [
    { limite: "interdit", remarque: "CNPE de Cattenom", expected: "nucleaire" },
    { limite: "interdit", remarque: "Installation nucléaire", expected: "nucleaire" },
    { limite: "interdit", remarque: "Zone militaire - base aérienne", expected: "militaire" },
    { limite: "interdit", remarque: "LF-P 23 zone réglementée", expected: "militaire" },
    { limite: "interdit", remarque: "LF-P54A", expected: "militaire" },
    { limite: "interdit", remarque: "Centre pénitentiaire", expected: "penitentiaire" },
    { limite: "30", remarque: "CTR LFPG Paris CDG", expected: "aeroport" },
    { limite: "30", remarque: "Aérodrome LFPO Orly", expected: "aeroport" },
    { limite: "interdit", remarque: "Parc national des Écrins", expected: "parc" },
    { limite: "interdit", remarque: "Réserve naturelle", expected: "parc" },
    { limite: "50", remarque: "Agglomération de Lyon", expected: "agglomeration" },
    { limite: "interdit", remarque: "", expected: "interdit" },
    { limite: "100", remarque: "", expected: "generique" },
    { limite: "50", remarque: "null", expected: "generique" },
  ];

  for (const c of cases) {
    it(`ordnet "${c.remarque || c.limite}" -> ${c.expected} zu`, () => {
      assert.equal(classifyFrRestrictionType(c.limite, c.remarque), c.expected);
    });
  }

  it("stuft reine ICAO-Codes nicht fälschlich als militärisch ein", () => {
    assert.equal(classifyFrRestrictionType("30", "LFPG"), "generique");
    assert.equal(classifyFrRestrictionType("30", "LFPO"), "generique");
  });

  it("priorisiert Flughafen-Indikatoren vor mehrdeutigen Militär-Tokens", () => {
    assert.equal(classifyFrRestrictionType("30", "CTR LFPG"), "aeroport");
  });

  it("liefert für jeden Typ kuratierte Auflagen und Kontakte", () => {
    for (const key of Object.keys(FR_ZONE_TYPES) as FrZoneTypeKey[]) {
      const info = FR_ZONE_TYPES[key];
      assert.ok(info.label.length > 0);
      assert.ok(info.auflage.length > 0);
      assert.ok(info.kontakt.length > 0);
    }
  });
});
