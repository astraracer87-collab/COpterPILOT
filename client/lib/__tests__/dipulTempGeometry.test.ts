import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  attachDipulTempGeometry,
  clearDipulTempGeometryCache,
  dipulWfsFeatureToGeoapiArea,
  enrichDipulTempGeometry,
  DIPUL_NOTE_NO_GEOMETRY,
  type DipulFeatureStore,
  geometryFromGeoJson,
  hasDipulGeometry,
  DIPUL_TEMP_WFS_LAYER,
  DIPUL_EDR_WFS_LAYER,
  type DipulGeometryTarget,
} from "../dipulTempGeometry";

// Echter Mitschnitt (15.11.2026, ~19:30 UTC erneuert; liegt bewusst nicht in fixtures/, da dort jede
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

  // Reale Fehlermeldung vom Gerät (15.11.2026): „17 Einträge ohne darstellbare
  // Geometrie“ – u. a. diese fünf. Kompletter Pfad wie in der App:
  // geoapi-Sachdaten → enrichDipulTempGeometry → WFS-Antwort (Mitschnitt).
  it("Gerätefall: alle 17 Live-Einträge (u. a. NFL Allianz Arena, D1659/26, D1660/26, Parow, Ahaus) bekommen eine Fläche", async () => {
    const fetchImpl = (async (url: string) => {
      const body = url.includes(DIPUL_TEMP_WFS_LAYER) ? fx.wfsTemp : fx.wfsEdrSubset;
      return { ok: true, json: async () => JSON.parse(JSON.stringify(body)) } as Response;
    }) as unknown as typeof fetch;
    const recs = recordsFromGeoapi();
    const res = await enrichDipulTempGeometry({ active: recs, upcoming: [] }, { fetchImpl });
    const missing = res.active.filter((r) => !hasDipulGeometry(r));
    assert.deepEqual(missing.map((r) => r.name), []);
    const byRef = new Map(res.active.map((r) => [r.extRef, r]));
    const expect: [string, string, number, number][] = [
      ["9293b7f9-129a-4810-be28-4b737c341aa1", "NFL Spiel Allianz Arena 15.11.2026", 48.219, 11.625],
      ["6d475dc3-8b57-401b-b8e8-ca1a9c8bc43f", "NOTAM D1659/26", NaN, NaN],
      ["d963b2b3-ec1d-4183-bd71-86d300bc1576", "NOTAM D1660/26", NaN, NaN],
      ["fe1f01da-ffc2-4337-a4f5-3fc04b814cd3", "ED-R Parow", 54.36, 13.05],
      ["2cabd78c-5982-48bd-9163-de31afa0a00b", "ED-R 18 Ahaus", 52.08, 7.0],
    ];
    for (const [ref, name, lat, lon] of expect) {
      const r = byRef.get(ref)!;
      assert.equal(r.name, name);
      assert.ok(r.polygonGroups && r.polygonGroups[0][0].length >= 4, name);
      assert.ok(inDe(r.centerLat!, r.centerLon!), name);
      if (Number.isFinite(lat)) assert.ok(Math.abs(r.centerLat! - lat) < 0.1 && Math.abs(r.centerLon! - lon) < 0.15, `${name} ${r.centerLat},${r.centerLon}`);
      assert.equal(r.geometryNote ?? null, null);
    }
  });

  it("Join über extRef ist unabhängig von Groß-/Kleinschreibung", () => {
    const [rec] = recordsFromGeoapi().filter((r) => r.name === "ED-R Parow");
    const [out] = attachDipulTempGeometry([{ ...rec, extRef: rec.extRef.toUpperCase() }], fx.wfsTemp.features);
    assert.ok(hasDipulGeometry(out));
  });

  it("gespeicherte Liste einer alten App-Version (ohne Flächen) wird nachgerüstet – auch offline aus dem gespeicherten WFS-Stand", async () => {
    // So lag „dipul_all“/„dipul_restrictions“ von Versionen vor dem Fix im Speicher.
    const oldCache = { active: recordsFromGeoapi(), upcoming: [], offline: { fetchedAt: 1, cached: true } };
    const saved = new Map<string, any[]>();
    const store: DipulFeatureStore = {
      load: async (layer) => saved.get(layer) ?? null,
      save: async (layer, f) => void saved.set(layer, f),
    };
    // 1) Online: Layer laden → speichern.
    const online = (async (url: string) => ({
      ok: true,
      json: async () => (url.includes(DIPUL_TEMP_WFS_LAYER) ? fx.wfsTemp : fx.wfsEdrSubset),
    })) as unknown as typeof fetch;
    await enrichDipulTempGeometry({ active: recordsFromGeoapi().slice(0, 1), upcoming: [] }, { fetchImpl: online, store });
    assert.ok(saved.get(DIPUL_TEMP_WFS_LAYER)?.length);
    // 2) Später offline, Sitzungs-Cache leer: gespeicherter Stand reicht.
    clearDipulTempGeometryCache();
    const offline = (async () => { throw new Error("Network request failed"); }) as unknown as typeof fetch;
    const res = await enrichDipulTempGeometry(oldCache, { fetchImpl: offline, store, timeoutMs: 50 });
    assert.equal(res.active.filter((r) => !hasDipulGeometry(r)).length, 0);
    assert.deepEqual(res.offline, oldCache.offline);
  });

  it("zweiter Versuch, wenn der erste WFS-Abruf scheitert", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) } as Response;
      return { ok: true, json: async () => fx.wfsTemp } as Response;
    }) as unknown as typeof fetch;
    const res = await enrichDipulTempGeometry({ active: recordsFromGeoapi(), upcoming: [] }, { fetchImpl: flaky });
    assert.equal(calls, 2);
    assert.equal(res.active.filter((r) => !hasDipulGeometry(r)).length, 0);
  });

  it("ohne Fläche bleibt der Eintrag in der Liste – mit verständlichem Grund", async () => {
    const ghost: DipulGeometryTarget = {
      extRef: "00000000-0000-0000-0000-000000000000", name: "NOTAM D9999/26", names: ["NOTAM D9999/26"], genNames: [],
      centerLat: null, centerLon: null, radiusM: null, polygonRings: null, polygonGroups: null,
    };
    const ok = (async () => ({ ok: true, json: async () => fx.wfsTemp })) as unknown as typeof fetch;
    const res = await enrichDipulTempGeometry({ active: [ghost], upcoming: [] }, { fetchImpl: ok });
    assert.equal(res.active.length, 1);
    assert.equal(res.active[0].geometryNote, DIPUL_NOTE_NO_GEOMETRY);

    clearDipulTempGeometryCache();
    const down = (async () => ({ ok: false, status: 502, json: async () => ({}) })) as unknown as typeof fetch;
    const res2 = await enrichDipulTempGeometry({ active: [ghost], upcoming: [] }, { fetchImpl: down });
    assert.match(res2.active[0].geometryNote!, /nicht erreichbar – HTTP 502/);
  });

  it("WFS-Feature → geoapi-Eintrag (Rückfall, wenn die geoapi nicht antwortet)", () => {
    const f = fx.wfsTemp.features.find((x: any) => x.properties.name.startsWith("NFL Spiel"));
    const a = dipulWfsFeatureToGeoapiArea(f)! as any;
    assert.equal(a.extRef, "9293b7f9-129a-4810-be28-4b737c341aa1");
    assert.deepEqual(a.names, ["NFL Spiel Allianz Arena 15.11.2026"]);
    assert.equal(a.legalRef, "§ 21h, Abs. 3 (11.) LuftVO");
    assert.equal(a.upperAlt, 120);
    assert.equal(a.upperAltUnit, "m");
    assert.equal(a.startTs, "2026-11-15T09:00:00Z");
    assert.equal(a.geometry.type, "MultiPolygon");
    const ahaus = dipulWfsFeatureToGeoapiArea(fx.wfsTemp.features.find((x: any) => x.properties.name === "ED-R 18 Ahaus"))! as any;
    assert.equal(ahaus.upperAltUnit, "ft");
    assert.equal(ahaus.upperAltRef, "MSL");
  });
});
