import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  recommendDroneForExceedance,
  type LimitExceedance,
  type RecommendDroneLike,
} from "../droneRecommendation";

const mini: RecommendDroneLike = {
  id: "mini",
  name: "Mini 4 Pro",
  limits: { maxWind: 8, maxGusts: 10, minTemp: 0 },
};
const air: RecommendDroneLike = {
  id: "air",
  name: "Air 3S",
  limits: { maxWind: 12, maxGusts: 14, minTemp: -10 },
};
const matrice: RecommendDroneLike = {
  id: "matrice",
  name: "Matrice 30",
  limits: { maxWind: 15, maxGusts: 18, minTemp: -20 },
};

describe("recommendDroneForExceedance — Wind", () => {
  it("empfiehlt die eigene Drohne mit dem höchsten Windlimit", () => {
    const exc: LimitExceedance = { kind: "wind", value: 11, limit: 8 };
    const rec = recommendDroneForExceedance(exc, [mini, air, matrice], "mini");
    assert.equal(rec.hasMatch, true);
    assert.equal(rec.droneId, "matrice");
    assert.ok(rec.message.includes("Matrice 30"));
    assert.ok(rec.message.includes("11"));
  });

  it("schließt die aktuell geplante Drohne aus", () => {
    const exc: LimitExceedance = { kind: "wind", value: 9, limit: 8 };
    const rec = recommendDroneForExceedance(exc, [mini, air], "mini");
    assert.equal(rec.droneId, "air");
  });

  it("generischer Hinweis, wenn keine eigene Drohne ausreicht", () => {
    const exc: LimitExceedance = { kind: "wind", value: 20, limit: 8 };
    const rec = recommendDroneForExceedance(exc, [mini, air, matrice], "mini");
    assert.equal(rec.hasMatch, false);
    assert.equal(rec.droneId, undefined);
    assert.ok(rec.message.includes("20"));
    assert.ok(rec.message.includes("Windlimit"));
  });

  it("hängt die Höhe an, wenn vorhanden", () => {
    const exc: LimitExceedance = { kind: "wind", value: 13, limit: 8, height: 100 };
    const rec = recommendDroneForExceedance(exc, [mini, matrice], "mini");
    assert.ok(rec.message.includes("100 m"));
  });
});

describe("recommendDroneForExceedance — Böen", () => {
  it("empfiehlt die Drohne mit dem höchsten Böenlimit", () => {
    const exc: LimitExceedance = { kind: "gusts", value: 13, limit: 10 };
    const rec = recommendDroneForExceedance(exc, [mini, air, matrice], "mini");
    assert.equal(rec.hasMatch, true);
    assert.equal(rec.droneId, "matrice");
  });

  it("generischer Hinweis bei zu starken Böen", () => {
    const exc: LimitExceedance = { kind: "gusts", value: 25, limit: 10 };
    const rec = recommendDroneForExceedance(exc, [mini, air], "mini");
    assert.equal(rec.hasMatch, false);
    assert.ok(rec.message.includes("Böenlimit"));
  });
});

describe("recommendDroneForExceedance — Temperatur", () => {
  it("empfiehlt die Drohne mit dem niedrigsten Temperatur-Minimum", () => {
    const exc: LimitExceedance = { kind: "temp", value: -5, limit: 0 };
    const rec = recommendDroneForExceedance(exc, [mini, air, matrice], "mini");
    assert.equal(rec.hasMatch, true);
    assert.equal(rec.droneId, "matrice");
    assert.ok(rec.message.includes("-5"));
  });

  it("matched genau bei value == minTemp", () => {
    const exc: LimitExceedance = { kind: "temp", value: -10, limit: 0 };
    const rec = recommendDroneForExceedance(exc, [mini, air], "mini");
    assert.equal(rec.hasMatch, true);
    assert.equal(rec.droneId, "air");
  });

  it("generischer Hinweis, wenn es zu kalt für alle ist", () => {
    const exc: LimitExceedance = { kind: "temp", value: -30, limit: 0 };
    const rec = recommendDroneForExceedance(exc, [mini, air, matrice], "mini");
    assert.equal(rec.hasMatch, false);
    assert.ok(rec.message.includes("Temperatur-Minimum"));
  });
});

describe("recommendDroneForExceedance — Randfälle", () => {
  it("leerer Bestand → generischer Hinweis", () => {
    const exc: LimitExceedance = { kind: "wind", value: 11, limit: 8 };
    const rec = recommendDroneForExceedance(exc, [], "mini");
    assert.equal(rec.hasMatch, false);
  });

  it("nur die aktuelle Drohne im Bestand → kein Match", () => {
    const exc: LimitExceedance = { kind: "wind", value: 11, limit: 8 };
    const rec = recommendDroneForExceedance(exc, [mini], "mini");
    assert.equal(rec.hasMatch, false);
  });
});
