import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildGeozoneCacheTileUrlFrom } from "../geozoneTileUrl";

const API = "https://example.replit.app";

// Repräsentativer "alle DE-Layer aktiv"-Satz (Union aus Web-/Mobile-Config).
const ALL_DE_LAYERS = [
  "kontrollzonen", "flugbeschraenkungsgebiete", "temporaere_betriebseinschraenkungen",
  "flughaefen", "flugplaetze", "naturschutzgebiete", "nationalparks", "ffh-gebiete",
  "militaerische_anlagen", "stromleitungen", "kraftwerke", "windkraftanlagen",
  "bundesautobahnen", "bahnanlagen", "modellflugplaetze", "wohngrundstuecke",
];

describe("buildGeozoneCacheTileUrlFrom (Mobile-Karte)", () => {
  it("bündelt ALLE Layer in EINE Kachel-URL (eine UrlTile pro Land, nicht pro Layer)", () => {
    const url = buildGeozoneCacheTileUrlFrom(API, ALL_DE_LAYERS, "DE");
    assert.equal(typeof url, "string");
    // Genau EIN layers=-Parameter -> EINE UrlTile-Ebene.
    assert.equal((url.match(/layers=/g) || []).length, 1);
    const got = decodeURIComponent(url.split("layers=")[1]);
    // Alle Layer stecken im selben Parameter.
    for (const l of ALL_DE_LAYERS) assert.ok(got.includes(l), `fehlt: ${l}`);
  });

  it("zielt auf den Cache-Endpoint und nicht auf einen Anbieter-WMS", () => {
    const url = buildGeozoneCacheTileUrlFrom(API, ALL_DE_LAYERS, "DE");
    assert.ok(url.startsWith(`${API}/api/proxy/geozone-tiles/de/`));
    assert.match(url, /\{z\}\/\{x\}\/\{y\}\.png\?layers=/);
    assert.doesNotMatch(url, /uas-betrieb\.de|geo\.admin\.ch|geoportail\.lu|pdok\.nl|geopf\.fr/);
  });

  it("nutzt das ISO-Kürzel kleingeschrieben im Pfad", () => {
    assert.ok(buildGeozoneCacheTileUrlFrom(API, ["x"], "CH").includes("/geozone-tiles/ch/"));
    assert.ok(buildGeozoneCacheTileUrlFrom(API, ["x"], "NL").includes("/geozone-tiles/nl/"));
    // Standard DE ohne explizites Land.
    assert.ok(buildGeozoneCacheTileUrlFrom(API, ["x"]).includes("/geozone-tiles/de/"));
  });

  it("dedupliziert und sortiert Layer für stabile Cache-Schlüssel", () => {
    const a = buildGeozoneCacheTileUrlFrom(API, ["b", "a", "b"], "DE");
    const b = buildGeozoneCacheTileUrlFrom(API, ["a", "b"], "DE");
    assert.equal(a, b);
    assert.equal(decodeURIComponent(a.split("layers=")[1]), "a,b");
  });

  it("liefert leeren String ohne Layer", () => {
    assert.equal(buildGeozoneCacheTileUrlFrom(API, [], "DE"), "");
    assert.equal(buildGeozoneCacheTileUrlFrom(API, [""], "DE"), "");
  });

  it("entfernt nachgestellte Slashes der API-Basis", () => {
    const url = buildGeozoneCacheTileUrlFrom("https://x.app///", ["a"], "DE");
    assert.ok(url.startsWith("https://x.app/api/proxy/geozone-tiles/de/"));
  });
});
