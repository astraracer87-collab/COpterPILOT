import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  COUNTRY_MAP_PROVIDERS,
  OFFLINE_APP_COUNTRIES,
  countryOfflineBounds,
  getMapProvider,
  noOfflineBasemapNote,
  sourcesForView,
} from "../mapSources";
import { COUNTRY_BOUNDING_BOXES } from "../../../shared/countryDetection";

// Nur live geprüfte, offline erlaubte amtliche Quellen (docs/offline-karten-quellen.md)
const EXPECTED_MAP = [
  "DE",
  "AT",
  // CH/LI: bewusst ohne swisstopo-Grundkarte (normale Karte + BAZL-Geozonen)
  "NL",
  "FR",
  "NO",
  "ES",
  "EE",
  "CZ",
  "IS",
  "BE",
  "HR",
];
const EXPECTED_SAT = [
  "DE",
  "AT",
  "CH",
  "NL",
  "FR",
  "LI",
  "ES",
  "EE",
  "CZ",
  "PL",
  "HR",
];
const FORBIDDEN =
  /openstreetmap\.org|cartocdn|arcgisonline\.com|googleapis|google\.com/i;

test("provider list: official basemaps/orthophotos per country", () => {
  const withMap = COUNTRY_MAP_PROVIDERS.filter((p) => p.map)
    .map((p) => p.iso)
    .sort();
  const withSat = COUNTRY_MAP_PROVIDERS.filter((p) => p.satellite?.length)
    .map((p) => p.iso)
    .sort();
  assert.deepEqual(withMap, [...EXPECTED_MAP].sort());
  assert.deepEqual(withSat, [...EXPECTED_SAT].sort());
  // ohne freie Grundkarte: Karte nur online
  for (const iso of [
    "CH",
    "LI",
    "LU",
    "PL",
    "DK",
    "SE",
    "FI",
    "GB",
    "IT",
    "HU",
    "SI",
    "SK",
    "PT",
    "IE",
  ]) {
    assert.equal(getMapProvider(iso)?.map, undefined, iso);
  }
});

test("provider entries are complete and never use OSM/CARTO/Esri/Google tiles", () => {
  const ids = new Set<string>();
  for (const p of COUNTRY_MAP_PROVIDERS) {
    for (const r of [...(p.map ? [p.map] : []), ...(p.satellite ?? [])]) {
      assert.ok(!ids.has(r.id), `doppelte id ${r.id}`);
      ids.add(r.id);
      assert.match(r.tiles, /^https:\/\//, r.id);
      assert.ok(
        /\{z\}.*\{[xy]\}|\{bbox-epsg-3857\}/.test(r.tiles),
        `${r.id}: Platzhalter`,
      );
      assert.doesNotMatch(r.tiles, FORBIDDEN, r.id);
      assert.ok(r.attribution.length > 2, `${r.id}: Attribution`);
      assert.ok(r.maxzoom >= 15 && r.maxzoom <= 20, `${r.id}: maxzoom`);
      assert.ok(r.kbPerTile > 0, `${r.id}: kbPerTile`);
      const [w, s, e, n] = r.bounds;
      assert.ok(w < e && s < n, `${r.id}: bounds`);
    }
  }
});

test("every app country is offline-selectable and has bounds", () => {
  // Spiegel von LICENSE_COUNTRIES (storage.ts) – Text lesen, um RN-Importe zu vermeiden
  const storage = readFileSync(join(__dirname, "..", "storage.ts"), "utf8");
  const block = storage.slice(
    storage.indexOf("export const LICENSE_COUNTRIES"),
  );
  const codes = [
    ...block
      .slice(0, block.indexOf("] as const"))
      .matchAll(/code: "([A-Z]{2})"/g),
  ].map((m) => m[1]);
  assert.ok(codes.length >= 30);
  const offline = OFFLINE_APP_COUNTRIES.map((c) => c.iso);
  for (const iso of codes)
    assert.ok(offline.includes(iso), `${iso} fehlt in OFFLINE_APP_COUNTRIES`);
  for (const iso of offline) {
    assert.ok(countryOfflineBounds(iso), `${iso}: keine Bounding-Box`);
    assert.ok(
      COUNTRY_BOUNDING_BOXES.some((b) => b.iso === iso),
      `${iso}: fehlt in COUNTRY_BOUNDING_BOXES`,
    );
  }
  for (const p of COUNTRY_MAP_PROVIDERS)
    assert.ok(offline.includes(p.iso), `${p.iso}: Anbieter ohne App-Land`);
});

test("no-basemap path: bounds from shared boxes and German note", () => {
  assert.deepEqual(countryOfflineBounds("HU"), [16.45, 45.74, 22.9, 48.58]);
  assert.equal(
    noOfflineBasemapNote("Ungarn"),
    "Für Ungarn gibt es keine frei speicherbare Grundkarte – offline werden Geozonen und Hindernisse gespeichert; die Karte wird online angezeigt.",
  );
  assert.match(
    noOfflineBasemapNote("Griechenland", false),
    /offline werden Hindernisse gespeichert/,
  );
  // Budapest: keine amtliche Quelle -> Ersatzkarte online
  assert.deepEqual(sourcesForView([19.0, 47.4, 19.1, 47.6], "map"), []);
  // Oslo: Kartverket
  assert.deepEqual(
    sourcesForView([10.7, 59.9, 10.8, 60.0], "map").map((s) => s.id),
    ["no-kartverket-topo"],
  );
  // Warschau: nur Luftbild
  assert.deepEqual(sourcesForView([21.0, 52.2, 21.1, 52.3], "map"), []);
  assert.deepEqual(
    sourcesForView([21.0, 52.2, 21.1, 52.3], "satellite").map((s) => s.id),
    ["pl-gugik-orto"],
  );
});
