import assert from "node:assert/strict";
import { getGermanWindFacility100mPoints, type GermanEnergyInfrastructureItem } from "../../../shared/germanEnergyInfrastructure";
import { windFacilitiesAsGeozones, supplementalLinesAsGeozones, supplementalInfrastructureAsGeozones, infrastructureMapGeometry } from "../energyInfrastructureZones";
import { computeGeozoneTabSeverity, isProhibitionZone, isAltitudeRestrictionZone } from "../geozoneSeverity";

const registered: GermanEnergyInfrastructureItem = {
  id: "registered", kind: "wind_turbine", name: "Windanlage", source: "MaStR",
  geometry: { type: "Point", coordinates: [8, 50] }, distanceMeters: 50,
  officialMatch: "unknown", estimatedTipHeightM: 190, operatorName: "Betreiber",
};
const osm: GermanEnergyInfrastructureItem = {
  ...registered, id: "osm", source: "OpenStreetMap", officialMatch: "not_found",
  geometry: { type: "Point", coordinates: [8.001, 50] },
};
const points = getGermanWindFacility100mPoints("DE", [osm, registered]);
assert.equal(points.length, 1, "nearby cross-source records represent one facility");
assert.equal(points[0].source, "MaStR");
assert.equal(points[0].longitude, 8, "registered coordinates remain canonical");
assert.deepEqual(new Set(points[0].sources), new Set(["MaStR", "OpenStreetMap"]));
const [zone] = windFacilitiesAsGeozones(points, [osm, registered]);
assert.equal(zone.layerLabel, "Windkraftanlagen");
assert.equal(zone.polygonRings?.[0].length, 65);
assert.match(zone.details, /MaStR/);
assert.match(zone.details, /OpenStreetMap/);
assert.match(zone.details, /Anlagenhöhe: 190 m/);
assert.match(zone.details, /Betreiber: Betreiber/);
assert.equal(getGermanWindFacility100mPoints("DE", [osm, { ...registered, officialMatch: "matched" }]).length, 0);
const lines = supplementalLinesAsGeozones([{
  ...osm, kind: "power_line", geometry: { type: "LineString", coordinates: [[8, 50], [8.002, 50]] },
}]);
assert.equal(lines[0].layerLabel, "Stromleitungen");
assert.equal(lines[0].polygonGroups?.length, 1);
assert.deepEqual(supplementalLinesAsGeozones([{ ...osm, kind: "power_line", geometry: { type: "LineString" } }]), []);

for (const country of ["AT", "BE", "CH", "DK", "FR", "LU", "NL"]) {
  const [hint] = supplementalInfrastructureAsGeozones(country, [osm]);
  assert.equal(hint.country, country);
  assert.equal(hint.informationalOnly, true);
  assert.equal(hint.restriction, undefined, "asset inventories do not establish an authorisation requirement");
  assert.equal(hint.lowerMeters, undefined);
  assert.equal(hint.upperMeters, undefined);
  assert.deepEqual(hint.polygonGroups, [], "a foreign point must not become an invented 100-m zone");
  assert.doesNotMatch(hint.details, /§\s*21h|100.m/i);
  assert.equal(isProhibitionZone(hint), false);
  assert.equal(isAltitudeRestrictionZone(hint), false);
  assert.equal(computeGeozoneTabSeverity([hint], {
    isCoveredByAV: () => { throw new Error("An informational entry must never enter the AV permission check"); },
    mapsToAvRule: () => { throw new Error("German law must never be inferred for a foreign inventory point"); },
  }), "blue");
}
const foreignLine = supplementalInfrastructureAsGeozones("BE", [{
  ...osm, kind: "power_line", geometry: { type: "MultiLineString", coordinates: [[[8, 50], [8.002, 50]]] },
}])[0];
assert.deepEqual(infrastructureMapGeometry(foreignLine.infrastructureGeometry).lines, [[[50, 8], [50, 8.002]]]);
assert.deepEqual(foreignLine.polygonGroups, []);
assert.deepEqual(supplementalInfrastructureAsGeozones("FR", [
  {...osm, officialMatch:"unknown"}, {...osm, officialMatch:"matched"},
]), [], "unknown comparisons and existing official hits remain hidden");
const mergedForeign = supplementalInfrastructureAsGeozones("NL", [
  osm, {...registered, source:"RIVM", officialMatch:"not_found", estimatedTipHeightM:null},
]);
assert.equal(mergedForeign.length, 1);
assert.match(mergedForeign[0].details, /OpenStreetMap.*RIVM/);
assert.equal(infrastructureMapGeometry(mergedForeign[0].infrastructureGeometry).points[0][1], 8);
const outer = [[8,50],[9,50],[9,51],[8,51],[8,50]];
const hole = [[8.2,50.2],[8.3,50.2],[8.3,50.3],[8.2,50.2]];
const polygonHint = supplementalInfrastructureAsGeozones("CH", [{
  ...osm, geometry:{type:"MultiPolygon",coordinates:[[outer,hole]]},
}])[0];
assert.equal(polygonHint.polygonGroups?.[0].length, 2, "real source holes are retained");
assert.deepEqual(infrastructureMapGeometry({type:"Point",coordinates:[181,50]}).points, []);
assert.equal(infrastructureMapGeometry({type:"GeometryCollection",geometries:[
  {type:"Point",coordinates:[8,50]}, {type:"LineString",coordinates:[[8,50],[9,51]]},
]}).lines.length, 1);
