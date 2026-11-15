import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  attachDipulTempGeometry,
  clearDipulTempGeometryCache,
  enrichDipulTempGeometry,
  geometryFromGeoJson,
  hasDipulGeometry,
  DIPUL_TEMP_WFS_LAYER,
  DIPUL_EDR_WFS_LAYER,
  type DipulGeometryTarget,
} from "../dipulTempGeometry";

// Echter Mitschnitt (15.11.2026; liegt bewusst nicht in fixtures/, da dort jede
// Datei einen ED-269-Union-Test braucht): geoapi v4 liefert 18 Einträge ohne jede
// Geometrie; der dipul-WFS-Layer temporaere_betriebseinschraenkungen hat für
// dieselben extRefs exakte MultiPolygone.
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures-live/dipul-temp-geometry-sample.json"), "utf8"));

// Wie parseGeoApiResponse (geozones.ts): Testzone raus, Name = names[0], ohne Geometrie.
function recordsFromGeoapi(): DipulGeometryTarget[] {
  return fx.geoapi.affectedAreas
    .filter((a: any) => a.legalRef !== "Test zone on prod")
    .map((a: any) => ({
      extRef: a.extRef,
      name: a.names?.[0] ?? "",
      names: a.names ?? [],
      genNames: a.genNames ?? [],
      centerLat: null,
      centerLon: null,
      radiusM: null,
      polygonRings: null,
      polygonGroups: null,
    }));
}

const inDe = (lat: number, lon: number) => lat > 47 && lat < 55.2 && lon > 5.8 && lon < 15.1;

describe("dipul temporäre Beschränkungen – Geometrie-Join", () => {
  beforeEach(() => clearDipulTempGeometryCache());

  it("geoapi-Mitschnitt hat keine Geometrie (Ursache des Fehlers)", () => {
    const recs = recordsFromGeoapi();
    assert.equal(recs.length, 17);
    assert.ok(fx.geoapi.affectedAreas.every((a: any) => a.geometry == null));
    assert.equal(recs.filter(hasDipulGeometry).length, 0);
  });

  it("alle 17 Einträge erhalten ihre exakte WFS-Fläche per extRef", () => {
    const out = attachDipulTempGeometry(recordsFromGeoapi(), fx.wfsTemp.features);
    assert.equal(out.filter((r) => !hasDipulGeometry(r)).length, 0);
    for (const r of out) {
      assert.ok(r.polygonGroups && r.polygonGroups.length > 0, r.name);
      assert.ok(r.polygonGroups![0][0].length >= 4, r.name);
      for (const [lat, lon] of r.polygonGroups![0][0]) assert.ok(inDe(lat, lon), `${r.name} ${lat},${lon}`);
      assert.ok(inDe(r.centerLat!, r.centerLon!), r.name);
    }
    const arena = out.find((r) => r.name.startsWith("NFL Spiel Allianz Arena"))!;
    // Allianz Arena, Fröttmaning: ca. 48.219 N / 11.625 E
    assert.ok(Math.abs(arena.centerLat! - 48.219) < 0.02 && Math.abs(arena.centerLon! - 11.625) < 0.03);
    // Die drei gleichnamigen „ED-R Wilhelmshaven“ bekommen je ihre eigene Fläche.
    const wil = out.filter((r) => r.name === "ED-R Wilhelmshaven");
    assert.equal(wil.length, 3);
    assert.equal(new Set(wil.map((r) => r.polygonRings![0].length)).size, 2);
  });

  it("vorhandene Geometrie bleibt unverändert", () => {
    const rec = { ...recordsFromGeoapi()[0], centerLat: 50, centerLon: 8, radiusM: 1000 };
    const [out] = attachDipulTempGeometry([rec], fx.wfsTemp.features);
    assert.equal(out, rec);
  });

  it("ED-R ohne Eintrag im temporären Layer → Fläche aus flugbeschraenkungsgebiete (Name ohne ED-R/Nummer)", () => {
    const recs = recordsFromGeoapi().filter((r) => /^ED-R (18 Ahaus|19 Gorleben|20 Greifswald|Lindenberg)/.test(r.name));
    assert.equal(recs.length, 4);
    const out = attachDipulTempGeometry(recs, [], fx.wfsEdrSubset.features);
    assert.equal(out.filter(hasDipulGeometry).length, 4);
  });

  it("Kreis (Punkt + Radius) wird über geozoneKit zum Polygon; projizierte Koordinaten werden verworfen", () => {
    const g = geometryFromGeoJson({ type: "Point", coordinates: [11.6247, 48.2188] }, 1500)!;
    assert.ok(g.polygonRings && g.polygonRings[0].length > 100);
    assert.ok(Math.abs(g.centerLat! - 48.2188) < 0.001);
    const gc = geometryFromGeoJson({
      type: "GeometryCollection",
      geometries: [{ type: "Polygon", coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50]]] }],
    })!;
    assert.equal(gc.polygonGroups!.length, 1);
    assert.equal(geometryFromGeoJson({ type: "Polygon", coordinates: [[[691000, 5335000], [692000, 5335000], [692000, 5336000], [691000, 5335000]]] }), null);
  });

  it("enrichDipulTempGeometry lädt den WFS-Layer und füllt active/upcoming", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const body = url.includes(DIPUL_TEMP_WFS_LAYER) ? fx.wfsTemp : { features: [] };
      return { ok: true, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    const recs = recordsFromGeoapi();
    const res = await enrichDipulTempGeometry({ active: recs.slice(0, 10), upcoming: recs.slice(10) }, { fetchImpl });
    assert.equal([...res.active, ...res.upcoming].filter((r) => !hasDipulGeometry(r)).length, 0);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].includes("SRSNAME=EPSG%3A4326"));
    assert.ok(!urls.some((u) => u.includes(DIPUL_EDR_WFS_LAYER)));
  });

  it("enrichDipulTempGeometry wirft bei Netzfehler nicht", async () => {
    const fetchImpl = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const recs = recordsFromGeoapi();
    const res = await enrichDipulTempGeometry({ active: recs, upcoming: [] }, { fetchImpl, timeoutMs: 50 });
    assert.equal(res.active.length, 17);
  });
});
