import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isInBavaria, railwayZoneNotes, DB_UAS_GEOZONE_EMAIL } from "../../../shared/railwayZoneInfo";
import { dipulZoneFromFeature } from "../geozoneQueries";

const rail = { id: "bahnanlagen", wmsLayer: "bahnanlagen", label: "Bahnanlagen", defaultEnabled: true };
const square = (lat: number, lon: number) => ({
  id: "bahnanlagen.1",
  properties: { name: "Bahnanlage", type_code: "RAILWAY" },
  geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat + 0.01], [lon, lat]]] },
});

describe("railway zone info", () => {
  it("detects Bavaria", () => {
    assert.equal(isInBavaria(48.14, 11.58), true); // München
    assert.equal(isInBavaria(49.45, 11.08), true); // Nürnberg
    assert.equal(isInBavaria(49.79, 9.95), true); // Würzburg
    assert.equal(isInBavaria(50.11, 8.68), false); // Frankfurt
    assert.equal(isInBavaria(48.78, 9.18), false); // Stuttgart
    assert.equal(isInBavaria(47.8, 13.04), false); // Salzburg
  });

  it("DB notes everywhere, Bavarian rules only in Bavaria", () => {
    const de = railwayZoneNotes(50.11, 8.68);
    assert.match(de.text, new RegExp(DB_UAS_GEOZONE_EMAIL.replace(".", "\\.")));
    assert.doesNotMatch(de.text, /Luftämter/);
    assert.equal(de.links.length, 1);
    const by = railwayZoneNotes(48.14, 11.58);
    assert.match(by.text, /Luftämter Süd- und Nordbayern/);
    assert.equal(by.links.length, 3);
  });

  it("is attached to dipul Bahnanlagen zones", () => {
    const munich = dipulZoneFromFeature(square(48.14, 11.58), rail)!;
    assert.match(munich.details, /NfL 2026-1-3788/);
    assert.match(munich.details, /Bayern/);
    assert.equal(munich.links?.length, 3);
    const frankfurt = dipulZoneFromFeature(square(50.11, 8.68), rail)!;
    assert.doesNotMatch(frankfurt.details, /Bayern/);
    const road = dipulZoneFromFeature(square(50.11, 8.68), { ...rail, id: "bundesautobahnen", wmsLayer: "bundesautobahnen" })!;
    assert.doesNotMatch(road.details, /NfL/);
  });
});
