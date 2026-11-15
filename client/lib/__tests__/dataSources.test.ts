import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GEOZONE_SOURCE_META,
  MAP_SOURCE_META,
  WRITTEN_PERMISSION_TEXT,
  geozoneCountries,
  getDataSourceGroups,
} from "../dataSources";
import {
  COUNTRY_MAP_PROVIDERS,
  FALLBACK_MAP,
  FALLBACK_SATELLITE,
} from "../mapSources";
import { ED269_SOURCE_LABELS } from "../ed269";
import { TILE_STORE_ATTRIBUTION } from "../geozoneTiles/tileStoreCore";
import { HU_GEOZONE_ATTRIBUTION } from "../../../shared/geozoneLayerCatalog";

const groups = getDataSourceGroups();
const all = groups.flatMap((g) => g.entries);
const group = (id: string) => {
  const g = groups.find((x) => x.id === id);
  assert.ok(g, `Gruppe ${id} fehlt`);
  return g;
};

test("jede Attribution aus COUNTRY_MAP_PROVIDERS steht in der Liste", () => {
  const attrs = new Set(
    group("maps").entries.flatMap((e) => e.attributions ?? []),
  );
  for (const p of COUNTRY_MAP_PROVIDERS) {
    for (const def of [p.map, ...(p.satellite ?? [])]) {
      if (!def) continue;
      assert.ok(
        attrs.has(def.attribution),
        `${p.iso}/${def.id}: "${def.attribution}" fehlt`,
      );
      assert.ok(
        MAP_SOURCE_META[def.id],
        `${def.id}: keine Lizenz-Metadaten in MAP_SOURCE_META`,
      );
    }
  }
  assert.ok(attrs.has(FALLBACK_MAP.attribution));
  assert.ok(attrs.has(FALLBACK_SATELLITE.attribution));
});

test("jedes ED-269-Land (ED269_SOURCE_LABELS) steht bei den Geozonen", () => {
  const countries = new Set(
    group("geozones").entries.flatMap((e) => e.countries ?? []),
  );
  for (const iso of Object.keys(ED269_SOURCE_LABELS)) {
    assert.ok(countries.has(iso), `Geozonen-Land ${iso} fehlt`);
  }
  for (const iso of [
    ...Object.keys(TILE_STORE_ATTRIBUTION),
    "HU",
    "LU",
    "FR",
    "DE",
    "CZ",
  ]) {
    assert.ok(countries.has(iso), `Geozonen-Land ${iso} fehlt`);
  }
});

test("jedes Geozonen-Land hat eigene Metadaten (oder ist mitversorgt)", () => {
  const covered = new Set(
    Object.values(GEOZONE_SOURCE_META).flatMap((m) => m.alsoCountries ?? []),
  );
  for (const iso of geozoneCountries()) {
    assert.ok(
      GEOZONE_SOURCE_META[iso] || covered.has(iso),
      `${iso}: keine Metadaten in GEOZONE_SOURCE_META`,
    );
  }
});

test("Pflicht-Attributionen der Geozonen", () => {
  const attrs = new Set(
    group("geozones").entries.flatMap((e) => e.attributions ?? []),
  );
  assert.ok(attrs.has("dipul, CC-BY-ND 4.0"));
  assert.ok(attrs.has(HU_GEOZONE_ATTRIBUTION));
  assert.ok(attrs.has(TILE_STORE_ATTRIBUTION.FR.label));
  assert.ok(attrs.has(TILE_STORE_ATTRIBUTION.CZ.label));
  const de = all.find((e) => e.id === "geo-de");
  assert.equal(
    de?.licenseUrl,
    "https://creativecommons.org/licenses/by-nd/4.0/legalcode.de",
  );
});

test("schriftliche Genehmigungen sind markiert", () => {
  const geo = group("geozones").entries;
  const withPermission = new Set(
    geo.filter((e) => e.writtenPermission).flatMap((e) => e.countries ?? []),
  );
  for (const iso of [
    "NL",
    "AT",
    "DK",
    "IT",
    "LU",
    "IE",
    "PT",
    "ES",
    "PL",
    "BE",
    "LT",
    "HR",
    "CY",
    "IS",
    "BG",
    "SI",
    "CZ",
    "LV",
    "HU",
  ]) {
    assert.ok(withPermission.has(iso), `${iso}: Freigabe nicht markiert`);
  }
  // EE: Freigabe von EANS nur mündlich, schriftliche Bestätigung ausstehend
  for (const iso of ["DE", "FR", "CH", "FI", "NO", "SE", "GB", "EE"]) {
    assert.ok(
      !withPermission.has(iso),
      `${iso}: fälschlich als Freigabe markiert`,
    );
  }
  const maps = group("maps").entries;
  assert.ok(maps.find((e) => e.countries?.includes("BE"))?.writtenPermission);
  const hr = maps.find((e) => e.countries?.includes("HR"));
  assert.ok(hr?.writtenPermission);
  assert.ok(
    hr?.attributions?.some((a) =>
      a.includes("© Državna geodetska uprava (DGU)"),
    ),
  );
  assert.equal(
    WRITTEN_PERMISSION_TEXT,
    "Nutzung mit schriftlicher Genehmigung",
  );
});

test("Hindernisse/OSM, Nominatim, Wetter, Verkehr, Bibliotheken vorhanden", () => {
  const osm = all.find((e) => e.id === "osm-overpass");
  assert.ok(osm?.attributions?.includes("© OpenStreetMap contributors"));
  assert.equal(osm?.licenseUrl, "https://www.openstreetmap.org/copyright");
  for (const id of [
    "nominatim",
    "open-meteo",
    "awc",
    "swpc",
    "autorouter",
    "adsblol",
    "ogn",
    "deepl",
    "easa",
    "lib-leaflet",
    "lib-maplibre",
    "lib-pdfjs",
    "map-google",
    "map-esri-street",
    "map-esri",
  ]) {
    assert.ok(
      all.some((e) => e.id === id),
      `${id} fehlt`,
    );
  }
});

test("IDs eindeutig, Links https, Pflichtfelder gesetzt", () => {
  const ids = all.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "doppelte IDs");
  for (const e of all) {
    assert.ok(e.provider.trim(), `${e.id}: Anbieter fehlt`);
    assert.ok(e.usage.trim(), `${e.id}: Verwendung fehlt`);
    for (const u of [e.url, e.licenseUrl])
      if (u) assert.match(u, /^https:\/\//, `${e.id}: ${u}`);
  }
});
