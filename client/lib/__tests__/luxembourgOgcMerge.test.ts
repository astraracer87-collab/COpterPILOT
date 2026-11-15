import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeLuxembourgOgc } from "../../../shared/irishLuxGeozones";
import {
  LU_ED269_CHECK_INTERVAL_MS,
  LU_ED269_URL,
  __resetLuxembourgForTests,
  loadLuxembourg,
  luxembourgEd269CheckStatus,
} from "../geozoneDirect/irelandLuxSource";

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

// P3: OGC zuerst, ED-269 (live HTTP 422) höchstens einmal täglich als Prüfung bzw. Rückfall.

test("Luxemburg: OGC zuerst; ED-269 nur einmal täglich geprüft", async () => {
  __resetLuxembourgForTests();
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    if (url === LU_ED269_URL) throw new Error("HTTP 422");
    return url.includes("/1927/") ? fx.c1927 : fx.c1928;
  };
  const t0 = Date.parse("2026-11-15T12:00:00Z");
  const a = await loadLuxembourg(fetchJson, t0);
  assert.equal(a.length, 3);
  assert.ok(calls[0].includes("features.geoportail.lu"), "OGC zuerst");
  assert.equal(calls.filter((u) => u === LU_ED269_URL).length, 1);
  assert.equal(luxembourgEd269CheckStatus()?.ok, false);
  await loadLuxembourg(fetchJson, t0 + 6 * 3600_000);
  assert.equal(calls.filter((u) => u === LU_ED269_URL).length, 1, "innerhalb eines Tages keine weitere Prüfung");
  await loadLuxembourg(fetchJson, t0 + LU_ED269_CHECK_INTERVAL_MS + 1);
  assert.equal(calls.filter((u) => u === LU_ED269_URL).length, 2);
});

test("Luxemburg: OGC fällt aus → ED-269 als Rückfall; beide aus → Fehler", async () => {
  __resetLuxembourgForTests();
  const ed269 = [{
    identifier: "EL-UAS-TEST",
    name: "Test",
    type: "COMMON",
    restriction: "PROHIBITED",
    geometry: [{ horizontalProjection: { type: "Polygon", coordinates: [[[6.1, 49.6], [6.2, 49.6], [6.2, 49.7], [6.1, 49.6]]] }, lowerLimit: 0, upperLimit: 120, lowerVerticalReference: "AGL", upperVerticalReference: "AGL", uomDimensions: "M" }],
  }];
  const out = await loadLuxembourg(async (url) => {
    if (url === LU_ED269_URL) return ed269;
    throw new Error("HTTP 503");
  }, Date.parse("2026-11-15T12:00:00Z"));
  assert.ok(out.length >= 1);
  await assert.rejects(loadLuxembourg(async () => { throw new Error("HTTP 503"); }, Date.parse("2026-11-16T12:00:00Z")), /HTTP 503/);
});
