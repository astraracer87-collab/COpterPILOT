import { test } from "node:test";
import assert from "node:assert/strict";
import { LT_GEOZONES_URL, frequentisAvmUrl, ED269_DIRECT_COUNTRIES } from "../geozoneDirect/ed269Sources";
import { ED269_SOURCE_LABELS } from "../ed269";

test("Litauen: Feed mit einem Jahr Zeitfenster (wie AT)", () => {
  const url = frequentisAvmUrl(LT_GEOZONES_URL, new Date("2026-11-15T00:00:00.000Z"));
  assert.equal(url, "https://utm.ans.lt/avm/utm/uas.geojson?start=2026-11-15T00:00:00.000Z&end=2027-11-15T00:00:00.000Z");
});

test("Litauen: als Vektor-Land mit Quellenlabel registriert", () => {
  assert.ok((ED269_DIRECT_COUNTRIES as readonly string[]).includes("lt"));
  assert.equal(ED269_SOURCE_LABELS.LT, "Oro navigacija (ED-269)");
});
