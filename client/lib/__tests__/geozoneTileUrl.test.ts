import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGeozoneCacheTileUrlFrom,
  buildGeozoneWmsTileTemplates,
  buildVectorGeozoneTileUrlFrom,
  fillGeozoneTileTemplate,
  tileToBbox3857,
  LEAFLET_WMS_BBOX_FN_JS,
  MAX_LAYERS_PER_GETMAP,
} from "../geozoneTileUrl";
import {
  GEOZONE_LAYERS,
  HU_GEOZONE_LAYERS,
  HU_GEOZONE_TILE_URL,
  getNativeLegacyLayerRefs,
} from "../../../shared/geozoneLayerCatalog";
import {
  defaultGeozoneSelection,
  filterActiveWmsLayers,
  getCombinedSwitchId,
  migrateSelection,
} from "../../../shared/geozoneCategories";

const ALL_DE_LAYERS = GEOZONE_LAYERS.map((l) => l.wmsLayer);

describe("buildGeozoneWmsTileTemplates (direkte WMS-Kacheln, kein Backend)", () => {
  it("zielt direkt auf den Anbieter-WMS (DE: dipul) mit {bbox}-Platzhalter, EPSG:3857, 256 px", () => {
    const [url] = buildGeozoneWmsTileTemplates(["kontrollzonen", "flughaefen"], "DE");
    assert.ok(url.startsWith("https://uas-betrieb.de/geoservices/dipul/wms?"), url);
    assert.doesNotMatch(url, /\/api\/proxy\//);
    assert.ok(url.endsWith("&BBOX={bbox}"));
    const q = new URL(url.replace("{bbox}", "0,0,1,1")).searchParams;
    assert.equal(q.get("REQUEST"), "GetMap");
    assert.equal(q.get("VERSION"), "1.1.1");
    assert.equal(q.get("SRS"), "EPSG:3857");
    assert.equal(q.get("WIDTH"), "256");
    assert.equal(q.get("TRANSPARENT"), "true");
    assert.equal(q.get("LAYERS"), "flughaefen,kontrollzonen");
  });

  it("teilt viele DE-Layer in Pakete à MAX_LAYERS_PER_GETMAP (dipul scheitert an zu vielen Layern)", () => {
    const urls = buildGeozoneWmsTileTemplates(ALL_DE_LAYERS, "DE");
    assert.equal(urls.length, Math.ceil(new Set(ALL_DE_LAYERS).size / MAX_LAYERS_PER_GETMAP));
    const seen: string[] = [];
    for (const u of urls) {
      const layers = new URL(u.replace("{bbox}", "0")).searchParams.get("LAYERS")!.split(",");
      assert.ok(layers.length <= MAX_LAYERS_PER_GETMAP);
      seen.push(...layers);
    }
    assert.deepEqual(seen.sort(), Array.from(new Set(ALL_DE_LAYERS)).sort());
  });

  it("legt Layer mit eigenem Endpoint/SLD (NL Natura 2000) in eine eigene Vorlage", () => {
    const urls = buildGeozoneWmsTileTemplates(["natura2000", "luchtvaartgebieden"], "NL");
    assert.ok(urls.some((u) => u.startsWith("https://service.pdok.nl/rvo/natura2000/wms/v1_0?")));
    const natura = urls.find((u) => u.includes("rvo/natura2000"))!;
    assert.match(natura, /SLD_BODY=/);
    // Klammern im SLD sind kodiert -> nur {bbox} als Platzhalter.
    assert.deepEqual(natura.match(/\{[^}]*\}/g), ["{bbox}"]);
  });

  it("ignoriert unbekannte Layer und Länder ohne WMS", () => {
    assert.deepEqual(buildGeozoneWmsTileTemplates(["gibtsnicht"], "DE"), []);
    assert.deepEqual(buildGeozoneWmsTileTemplates(["kontrollzonen"], "AT"), []);
    assert.deepEqual(buildGeozoneWmsTileTemplates([], "DE"), []);
  });
});

describe("buildGeozoneCacheTileUrlFrom (Kompatibilität)", () => {
  it("liefert die erste direkte Vorlage, dedupliziert/sortiert stabil", () => {
    const a = buildGeozoneCacheTileUrlFrom("", ["kontrollzonen", "flughaefen", "kontrollzonen"], "DE");
    const b = buildGeozoneCacheTileUrlFrom("https://ignored.example", ["flughaefen", "kontrollzonen"], "DE");
    assert.equal(a, b);
    assert.equal(a, buildGeozoneWmsTileTemplates(["flughaefen", "kontrollzonen"], "DE")[0]);
  });

  it("liefert leeren String ohne Layer", () => {
    assert.equal(buildGeozoneCacheTileUrlFrom("", [], "DE"), "");
    assert.equal(buildGeozoneCacheTileUrlFrom("", [""], "DE"), "");
  });

  it("Vektor-Kacheln gibt es ohne Backend nicht mehr", () => {
    assert.equal(buildVectorGeozoneTileUrlFrom("", "BE"), "");
  });
});

describe("bbox-Berechnung", () => {
  it("fillGeozoneTileTemplate und die Leaflet-Funktion liefern dieselbe EPSG:3857-bbox", () => {
    const tpl = "https://x/wms?A=1&BBOX={bbox}";
    const filled = fillGeozoneTileTemplate(tpl, 10, 537, 347);
    // eslint-disable-next-line no-new-func
    const fn = new Function(`${LEAFLET_WMS_BBOX_FN_JS}; return __geozoneWmsBbox;`)() as (d: any) => string;
    assert.equal(filled, `https://x/wms?A=1&BBOX=${fn({ x: 537, y: 347, z: 10 })}`);
    const [minX, minY, maxX, maxY] = tileToBbox3857(0, 0, 0);
    assert.ok(Math.abs(minX + 20037508.34) < 0.01 && Math.abs(maxY - 20037508.34) < 0.01);
    assert.ok(maxX > minX && maxY > minY);
  });
});

describe("XYZ-Kachel-Vorlage (tileUrlTemplate, z. B. Ungarn/MyDroneSpace)", () => {
  const huLayers = HU_GEOZONE_LAYERS.map((l) => l.wmsLayer);

  it("liefert die XYZ-Vorlage unverändert statt eines WMS-GetMap", () => {
    const urls = buildGeozoneWmsTileTemplates(huLayers, "HU");
    assert.deepEqual(urls, [HU_GEOZONE_TILE_URL]);
    assert.equal(HU_GEOZONE_TILE_URL, "https://mds.mydronespace.hu/wmts/1.0.0/aixm/{z}/{x}/{y}.png");
    assert.doesNotMatch(urls[0], /REQUEST=GetMap|\{bbox\}/);
    assert.equal(buildGeozoneCacheTileUrlFrom("", huLayers, "hu"), HU_GEOZONE_TILE_URL);
  });

  it("dedupliziert und ignoriert fremde Layer", () => {
    assert.deepEqual(buildGeozoneWmsTileTemplates([...huLayers, ...huLayers, "kontrollzonen"], "HU"), [HU_GEOZONE_TILE_URL]);
    assert.deepEqual(buildGeozoneWmsTileTemplates(huLayers, "DE"), []);
  });

  it("füllt {z}/{x}/{y} im XYZ-Schema (kein TMS-Flip)", () => {
    // Budapest, z10: x=566, y=358 (XYZ). TMS wäre y=665.
    assert.equal(
      fillGeozoneTileTemplate(HU_GEOZONE_TILE_URL, 10, 566, 358),
      "https://mds.mydronespace.hu/wmts/1.0.0/aixm/10/566/358.png",
    );
  });

  it("HU folgt dem Gesamt-Schalter hu_combined (Standard an) und wird nicht als Alt-Layer migriert", () => {
    assert.equal(getCombinedSwitchId("HU"), "hu_combined");
    const sel = defaultGeozoneSelection();
    assert.equal(sel.hu_combined, true);
    assert.deepEqual(filterActiveWmsLayers("HU", huLayers, sel), huLayers);
    assert.deepEqual(filterActiveWmsLayers("HU", huLayers, { ...sel, hu_combined: false }), []);
    assert.ok(!getNativeLegacyLayerRefs().some((r) => r.iso === "HU"));
    // Eine (späte) Migration alter Daten darf HU nicht abschalten.
    const migrated = migrateSelection({ kontrollzonen: true }, getNativeLegacyLayerRefs());
    assert.equal(migrated.hu_combined, true);
  });
});
