import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { assessCtrVmc, type CtrAvInfo } from "../ctrData";

// Minimal DFS-2026-AV: nur Mindestsicht (0,8 km), keine Wolkenuntergrenze.
const AV_DFS: CtrAvInfo = {
  model: "dfs2026",
  nflReference: "NfL 2026-1-3884",
  provider: "DFS Deutsche Flugsicherung",
  pdfUrl: "",
  heightSteps: [],
  geometryPerAip: true,
  provisional: true,
  minVisibilityKm: 0.8,
};

// Legacy-50m-AV: Mindestsicht 5 km + Wolkenuntergrenze 1500 ft.
const AV_LEGACY: CtrAvInfo = {
  model: "legacy50m",
  nflReference: "NfL legacy",
  provider: "Austro Control",
  pdfUrl: "",
  heightSteps: [],
  geometryPerAip: false,
  provisional: false,
  minVisibilityKm: 5,
  minCeilingFt: 1500,
};

describe("assessCtrVmc – DFS-2026-Modell (nur Sicht)", () => {
  it("erfüllt VMC bei ausreichender Sicht", () => {
    const r = assessCtrVmc({ visibilityM: 9999, ceilingFt: null }, AV_DFS);
    assert.equal(r.compliant, true);
    assert.equal(r.minVisibilityM, 800);
    assert.equal(r.minCeilingFt, null);
  });

  it("nicht erfüllt bei zu geringer Sicht", () => {
    const r = assessCtrVmc({ visibilityM: 500, ceilingFt: null }, AV_DFS);
    assert.equal(r.compliant, false);
  });

  it("nicht verifizierbar ohne Sichtangabe", () => {
    const r = assessCtrVmc({ visibilityM: null, ceilingFt: null }, AV_DFS);
    assert.equal(r.compliant, null);
  });

  it("ignoriert Wolkenuntergrenze im DFS-Modell", () => {
    const r = assessCtrVmc({ visibilityM: 9999, ceilingFt: 200 }, AV_DFS);
    assert.equal(r.compliant, true);
  });
});

describe("assessCtrVmc – Legacy-Modell (Sicht + Wolkenuntergrenze)", () => {
  it("erfüllt VMC bei Sicht und Untergrenze über Minimum", () => {
    const r = assessCtrVmc({ visibilityM: 8000, ceilingFt: 2000 }, AV_LEGACY);
    assert.equal(r.compliant, true);
    assert.equal(r.minCeilingFt, 1500);
  });

  it("nicht erfüllt bei zu niedriger Wolkenuntergrenze", () => {
    const r = assessCtrVmc({ visibilityM: 8000, ceilingFt: 1000 }, AV_LEGACY);
    assert.equal(r.compliant, false);
  });

  it("fehlende BKN/OVC-Untergrenze ist nicht limitierend", () => {
    const r = assessCtrVmc({ visibilityM: 8000, ceilingFt: null }, AV_LEGACY);
    assert.equal(r.compliant, true);
  });

  it("nicht erfüllt bei zu geringer Sicht trotz hoher Untergrenze", () => {
    const r = assessCtrVmc({ visibilityM: 3000, ceilingFt: 2000 }, AV_LEGACY);
    assert.equal(r.compliant, false);
  });

  it("nicht verifizierbar ohne Sicht trotz ausreichender Untergrenze", () => {
    const r = assessCtrVmc({ visibilityM: null, ceilingFt: 2000 }, AV_LEGACY);
    assert.equal(r.compliant, null);
  });
});
