// Brussels FIR: NOTAMs aus dem belgischen ED-269-Bestand (skeyes) werden nach
// Geometrie BE bzw. LU zugeordnet; abgelaufene erscheinen nie.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ed269ZonesToNotamRestrictions } from "../ed269Notams";
import { parseEd269ToGeozoneInfo } from "../ed269";
import {
  isNotamExpired,
  luBrusselsFirNotamsNear,
  notamCountryByGeometry,
  notamWithinRadius,
  splitBrusselsFirNotams,
} from "../brusselsFirNotams";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const HOUR = 3600_000;

/** Kreis als GeoJSON-Ring [lon, lat] (wie die NOTAM-Q-Zeile). */
function circle(lat: number, lon: number, radiusKm: number, n = 32): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    ring.push([
      lon + (radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a),
      lat + (radiusKm / 110.574) * Math.cos(a),
    ]);
  }
  return ring;
}

function zone(name: string, ring: number[][], startTs: number | null, endTs: number | null, notam = true) {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      name,
      code: name,
      restriction: "PROHIBITED",
      type: "NOTAM",
      ...(notam ? { _notamEligible: true } : {}),
      ...(startTs != null ? { validStartTs: startTs } : {}),
      ...(endTs != null ? { validEndTs: endTs } : {}),
    },
  };
}

function toRestrictions(features: any[], now = NOW) {
  return ed269ZonesToNotamRestrictions(parseEd269ToGeozoneInfo(features, "BE", now), now);
}

// G2219/26 (Tour de Luxembourg): 25-NM-Kreis um ≈ 49,78 N / 6,10 O.
const LU_RACE = zone("G2219/26", circle(49.783, 6.1, 46), NOW - 24 * HOUR, NOW + 3 * 24 * HOUR);
// Belgische TSA bei Brüssel.
const BE_TSA = zone("F3501/26", circle(50.85, 4.35, 5), NOW - HOUR, NOW + 4 * HOUR);
// Über der Nordsee (kein Land) – muss bei BE bleiben.
const SEA_TSA = zone("F1712/26", circle(51.3, 2.3, 8), NOW - HOUR, NOW + 4 * HOUR);

describe("Brussels FIR – Länderzuordnung nach Geometrie", () => {
  it("Kreis über Luxemburg → LU, auch wenn er nach BE/DE/FR hineinreicht", () => {
    const [r] = toRestrictions([LU_RACE]);
    assert.equal(notamCountryByGeometry(r), "LU");
  });

  it("Zone bei Brüssel → BE", () => {
    const [r] = toRestrictions([BE_TSA]);
    assert.equal(notamCountryByGeometry(r), "BE");
  });

  it("teilt auf: LU-NOTAM nur unter LU, alles andere (auch über See) unverändert unter BE", () => {
    const list = toRestrictions([LU_RACE, BE_TSA, SEA_TSA]);
    assert.equal(list.length, 3);
    const split = splitBrusselsFirNotams(list);
    assert.deepEqual(split.LU.map((r) => r.name), ["G2219/26"]);
    assert.deepEqual(split.BE.map((r) => r.name).sort(), ["F1712/26", "F3501/26"]);
    // nichts verloren, nichts doppelt
    assert.equal(split.BE.length + split.LU.length, list.length);
  });

  it("Eintrag über LU ohne belegte Gültigkeit bleibt bei BE (keine Änderung zu heute)", () => {
    const list = toRestrictions([zone("TNFZ", circle(49.61, 6.13, 2), null, null)]);
    assert.equal(list.length, 1);
    assert.equal(list[0].validityUnknown, true);
    const split = splitBrusselsFirNotams(list);
    assert.equal(split.LU.length, 0);
    assert.equal(split.BE.length, 1);
  });
});

describe("Brussels FIR – Gültigkeit", () => {
  it("abgelaufener NOTAM (Ende vorbei) erscheint nicht", () => {
    const expired = zone("G2219/26", circle(49.783, 6.1, 46), NOW - 5 * 24 * HOUR, NOW - 2 * HOUR);
    assert.equal(toRestrictions([expired]).length, 0);
  });

  it("isNotamExpired als zusätzliche Absicherung", () => {
    assert.equal(isNotamExpired({ endTs: new Date(NOW - 1000).toISOString() }, NOW), true);
    assert.equal(isNotamExpired({ endTs: new Date(NOW + 1000).toISOString() }, NOW), false);
    assert.equal(isNotamExpired({ endTs: null }, NOW), false);
  });

  it("zukünftiger NOTAM → upcoming, laufender → active", () => {
    const future = zone("G9999/26", circle(49.61, 6.13, 3), NOW + 2 * 24 * HOUR, NOW + 3 * 24 * HOUR);
    const list = toRestrictions([future, LU_RACE]);
    const byName = Object.fromEntries(list.map((r) => [r.name, r.status]));
    assert.equal(byName["G9999/26"], "upcoming");
    assert.equal(byName["G2219/26"], "active");
  });
});

describe("Brussels FIR – Umkreis (Radar LU)", () => {
  it("Punkt bei Findel liegt im Kreis → gefunden", () => {
    const list = toRestrictions([LU_RACE, BE_TSA]);
    const near = luBrusselsFirNotamsNear(list, 49.63, 6.21, 8.3, NOW);
    assert.deepEqual(near.map((r) => r.name), ["G2219/26"]);
  });

  it("kleine LU-Zone außerhalb des Radius → nicht gefunden; Rand im Radius → gefunden", () => {
    const [small] = toRestrictions([zone("G1111/26", circle(49.95, 6.0, 1), NOW - HOUR, NOW + HOUR)]);
    // Findel → Zone ≈ 37 km entfernt
    assert.equal(notamWithinRadius(small, 49.63, 6.21, 8.3), false);
    // Punkt ≈ 2 km südlich des Zentrums, Rand ≈ 1 km entfernt
    assert.equal(notamWithinRadius(small, 49.932, 6.0, 1.5), true);
  });

  it("abgelaufene Einträge fallen auch im Umkreis weg", () => {
    const list = toRestrictions([LU_RACE], NOW);
    const later = NOW + 10 * 24 * HOUR;
    assert.equal(luBrusselsFirNotamsNear(list, 49.63, 6.21, 8.3, later).length, 0);
  });
});
