import assert from "node:assert/strict";
import {
  classifyOfficialInfrastructureMatch,
  getEnergyInfrastructureCountry,
  getGermanWindFacility100mPoints,
  getRadarEnergyInfrastructureItems,
  type GermanEnergyInfrastructureItem,
  type InfrastructureKind,
} from "../../../shared/germanEnergyInfrastructure";
import { supplementalInfrastructureAsGeozones } from "../energyInfrastructureZones";

const kinds: InfrastructureKind[] = ["wind_turbine", "power_line", "power_mast"];
const timestamp = "2026-10-12T12:00:00Z";
const available = { status: "available" as const, updatedAt: timestamp };
for (const iso of ["AT", "DK"]) {
  const country = getEnergyInfrastructureCountry(iso)!;
  assert.equal(country.hasComparableOfficialAssetLayers, false);
  assert.deepEqual(country.comparableOfficialAssetKinds, []);
  assert.equal(country.assetComparisonStatusKeyByKind, undefined);
  assert.match(country.comparisonNote, /unknown/);
  for (const source of country.dataSources.filter((source) => source.id !== "openStreetMap")) {
    assert.equal(source.referenceOnly, true, `${iso}/${source.id} is not a queried comparison feed`);
    assert.equal(source.statusKey, undefined);
  }
  for (const kind of kinds) {
    const fixture: GermanEnergyInfrastructureItem = {
      id: `${iso}:${kind}`,
      kind,
      name: "Recherchetreffer",
      source: "OpenStreetMap",
      geometry: kind === "power_line"
        ? { type: "LineString", coordinates: [[12, 48], [12.001, 48.001]] }
        : { type: "Point", coordinates: [12, 48] },
      distanceMeters: 10,
      officialMatch: "unknown",
    };
    assert.deepEqual(getRadarEnergyInfrastructureItems(
      true, [fixture], { openStreetMap: available, officialWind: available, officialPower: available },
      country.assetComparisonStatusKeyByKind,
    ), [], "unrelated available feeds cannot prove an AT/DK omission");
    assert.deepEqual(getRadarEnergyInfrastructureItems(
      true, [{ ...fixture, officialMatch: "not_found" }], { officialWind: available, officialPower: available },
      country.assetComparisonStatusKeyByKind,
    ), [], "even a mislabeled negative needs a configured country comparison");
    assert.deepEqual(supplementalInfrastructureAsGeozones(iso, [
      fixture, { ...fixture, officialMatch: "matched" },
    ]), [], "unknowns and positive matches cannot duplicate the official map");
    assert.deepEqual(getGermanWindFacility100mPoints(iso, [{ ...fixture, source: "MaStR" }]), [],
      "the German register exception and 100-m buffers must not leak abroad");

    // Prospective adapter behavior: NOT a country/feed activation.
    const verified = { ...fixture, officialMatch: "not_found" as const };
    const statusKeys = { [kind]: "officialWind" as const };
    for (const status of ["unavailable", "partial", "stale"] as const) {
      assert.deepEqual(getRadarEnergyInfrastructureItems(
        true, [verified], { officialWind: { status, updatedAt: timestamp } }, statusKeys,
      ), [], `${status} comparisons cannot be drawn`);
    }
    assert.deepEqual(getRadarEnergyInfrastructureItems(false, [verified], { officialWind: available }, statusKeys), []);
    const permitted = getRadarEnergyInfrastructureItems(true, [verified], { officialWind: available }, statusKeys);
    assert.equal(permitted.length, 1);
    const zones = supplementalInfrastructureAsGeozones(iso, [permitted[0], { ...permitted[0], id: "duplicate" }]);
    assert.equal(zones.length, 1, "duplicate facility geometries share one zone");
    assert.equal(zones[0].informationalOnly, true);
    assert.equal(zones[0].country, iso);
    assert.deepEqual(zones[0].polygonGroups, [], "do not invent a foreign restriction boundary");
  }
}
assert.equal(classifyOfficialInfrastructureMatch(null, "unavailable", 50), "unknown");
assert.equal(classifyOfficialInfrastructureMatch(null, "partial", 50), "unknown");
assert.equal(classifyOfficialInfrastructureMatch(10, "partial", 50), "matched");
assert.equal(classifyOfficialInfrastructureMatch(null, "available", 50), "not_found");
const bev = getEnergyInfrastructureCountry("AT")!.dataSources.find((s) => s.id === "bevDlmBauten")!;
assert.match(bev.license, /CC BY 4.0/);
assert.match(bev.coverage, /STROMLEITUNG_L.*STROMMAST_P/);
assert.match(bev.coverage, /kein Nachweis/i);
const dk = getEnergyInfrastructureCountry("DK")!;
assert.match(dk.dataSources.find((s) => s.id === "dronezonerWind")!.updateStatus, /22.09.2024/);
assert.match(dk.dataSources.find((s) => s.id === "geoDanmarkInfrastructure")!.license, /API-key\/OAuth/);
console.log("AT/DK source research and unknown-gate regressions passed");
