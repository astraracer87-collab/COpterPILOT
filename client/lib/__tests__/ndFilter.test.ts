import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeStops,
  computeTargetShutterDenom,
  estimateEv,
  recommendNd,
  roundToStandardNd,
  shutterDenomFromEv,
  sunElevationDeg,
} from "../ndFilter";

const MINI_4_PRO_ECO = ["ND4", "ND8", "ND16", "ND32", "ND64", "ND128", "ND256"];

describe("computeTargetShutterDenom / computeStops", () => {
  it("180°-Regel: Zielshutter = 2 * fps", () => {
    assert.equal(computeTargetShutterDenom(24), 48);
    assert.equal(computeTargetShutterDenom(60), 120);
  });

  it("Stops = log2(measured / target)", () => {
    assert.equal(computeStops(48, 48), 0);
    assert.equal(computeStops(60, 480), 3);
    assert.ok(Math.abs(computeStops(48, 2000) - Math.log2(2000 / 48)) < 1e-9);
  });

  it("nicht-positive Werte ergeben 0 Stops", () => {
    assert.equal(computeStops(0, 1000), 0);
    assert.equal(computeStops(48, 0), 0);
  });
});

describe("recommendNd", () => {
  it("24 fps + 1/2000 → ND32 (Mini-4-Pro-Ökosystem)", () => {
    const rec = recommendNd({
      fps: 24,
      measuredShutterDenom: 2000,
      filterEcosystem: MINI_4_PRO_ECO,
    });
    assert.equal(rec.ndValue, 32);
    assert.equal(rec.targetShutterDenom, 48);
    assert.equal(rec.ecosystemMismatch, false);
    assert.equal(rec.ecosystemPick, 32);
    assert.ok(rec.stops > 5 && rec.stops < 6);
  });

  it("60 fps + 1/1000 → ND8 (Zielshutter 1/120)", () => {
    // Hinweis: Die Task-Vorlage nannte 60 fps + 1/4000 → ND8; rechnerisch ergibt
    // 1/4000 bei Ziel 1/120 jedoch ~5 Stops (ND32). Wir testen den realistischen
    // ND8-Fall (3 Stops Reduktion) sowie zusätzlich 60 fps + 1/4000 → ND32 unten.
    const rec = recommendNd({ fps: 60, measuredShutterDenom: 1000 });
    assert.equal(rec.ndValue, 8);
    assert.equal(rec.targetShutterDenom, 120);
    assert.ok(Math.abs(rec.stops - 3.0589) < 0.01);
  });

  it("60 fps + 1/4000 → ND32 (Zielshutter 1/120, ~5 Stops)", () => {
    const rec = recommendNd({ fps: 60, measuredShutterDenom: 4000 });
    assert.equal(rec.ndValue, 32);
    assert.equal(rec.targetShutterDenom, 120);
    assert.ok(rec.stops > 5 && rec.stops < 5.2);
  });

  it("Kein Filter nötig, wenn Stops < 1", () => {
    const rec = recommendNd({ fps: 24, measuredShutterDenom: 50 });
    assert.equal(rec.ndValue, null);
    assert.equal(rec.ecosystemMismatch, false);
  });
});

describe("roundToStandardNd – Ökosystem-Snap", () => {
  it("snap auf nächsten Standardwert ohne Ökosystem", () => {
    const r = roundToStandardNd(Math.log2(33));
    assert.equal(r.ndValue, 32);
    assert.equal(r.ecosystemMismatch, false);
    assert.equal(r.ecosystemPick, null);
  });

  it("ecosystemMismatch=true wenn Snap-Wert nicht im Ökosystem ist", () => {
    // ~5 Stops → ideal ND32. Ökosystem ohne 32 → muss auf ND64 hochgehen.
    const r = roundToStandardNd(5.06, [4, 8, 16, 64]);
    assert.equal(r.ndValue, 32);
    assert.equal(r.ecosystemMismatch, true);
    assert.equal(r.ecosystemPick, 64);
  });

  it("kein Mismatch, wenn Standardwert im Ökosystem enthalten ist", () => {
    const r = roundToStandardNd(5.06, ["ND8", "ND16", "ND32", "ND64"]);
    assert.equal(r.ndValue, 32);
    assert.equal(r.ecosystemMismatch, false);
    assert.equal(r.ecosystemPick, 32);
  });

  it("nimmt das größte verfügbare Filter, wenn auch das nicht reicht", () => {
    // Sehr viele Stops → ideal ND1000; Ökosystem nur bis ND16.
    const r = roundToStandardNd(12, [4, 8, 16]);
    assert.equal(r.ndValue, 1000);
    assert.equal(r.ecosystemMismatch, true);
    assert.equal(r.ecosystemPick, 16);
  });
});

describe("estimateEv – Stützpunkte", () => {
  it("klarer Himmel, hoch stehende Sonne → EV 15 (Sunny-16)", () => {
    assert.equal(estimateEv(10, 0, 60), 15);
  });

  it("bedeckt → EV 11 (12 - 1 für mittleren Sonnenstand)", () => {
    assert.equal(estimateEv(95, 0, 40), 11);
  });

  it("Regen → EV 10 (11 - 1)", () => {
    assert.equal(estimateEv(80, 1, 30), 10);
  });

  it("Dämmerung (Sonne < 0°) → EV 9 ohne Höhenkorrektur", () => {
    assert.equal(estimateEv(40, 0, -3), 9);
  });

  it("Nacht (Sonne < -6°) → EV 4", () => {
    assert.equal(estimateEv(0, 0, -10), 4);
  });

  it("shutterDenomFromEv passt zur Sunny-16-Regel bei f/2.8", () => {
    // EV 15, N=2.8 → 1/t = 2^15 / 7.84 ≈ 4180
    const d = shutterDenomFromEv(15, 2.8);
    assert.ok(d > 4000 && d < 4400);
  });
});

describe("sunElevationDeg – Referenzwerte", () => {
  it("Berlin Sommer-Sonnenwende mittags ≈ 61° (Referenz ~62°)", () => {
    // 21. Juni 2025, ~11:13 UTC ≈ solar noon Berlin (13.4° E)
    const alt = sunElevationDeg(52.52, 13.405, new Date(Date.UTC(2025, 5, 21, 11, 13, 0)));
    assert.ok(alt > 59 && alt < 63, `erwartet ~61°, war ${alt.toFixed(2)}°`);
  });

  it("Berlin Winter-Sonnenwende mittags ≈ 14°", () => {
    const alt = sunElevationDeg(52.52, 13.405, new Date(Date.UTC(2025, 11, 21, 11, 13, 0)));
    assert.ok(alt > 12 && alt < 16, `erwartet ~14°, war ${alt.toFixed(2)}°`);
  });

  it("Berlin Mitternacht im Juni → Sonne unter dem Horizont", () => {
    const alt = sunElevationDeg(52.52, 13.405, new Date(Date.UTC(2025, 5, 21, 0, 0, 0)));
    assert.ok(alt < 0, `erwartet < 0°, war ${alt.toFixed(2)}°`);
  });

  it("Äquator zur Tagundnachtgleiche mittags → nahe Zenit (>85°)", () => {
    const alt = sunElevationDeg(0, 0, new Date(Date.UTC(2025, 2, 21, 12, 0, 0)));
    assert.ok(alt > 85, `erwartet > 85°, war ${alt.toFixed(2)}°`);
  });
});
