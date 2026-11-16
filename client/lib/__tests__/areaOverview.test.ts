// Gebietsübersicht der Flugplanung: Umkreis-Filter, Hinweise in der Nähe
// (Entfernung/Richtung, Schwellen Helipad-Vorsicht vs. Flugplatz-Info),
// Overpass-Abfrage/Parser für Hubschrauberlandeplätze, Hindernis-Summe,
// Vorschau-Ausschnitt.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  airportPoisFromList,
  bearingDeg,
  buildAviationPoiQuery,
  buildNearbyHints,
  circleToRing,
  compassDe,
  dedupePois,
  filterZonesInRadius,
  formatDistanceDe,
  haversineM,
  hintsSummaryDe,
  obstacleSummaryTextDe,
  parseAviationPoisOverpass,
  poisFromFeatureCollection,
  previewRegion,
  restrictionInRadius,
  ringIntersectsCircle,
  splitNotamsForArea,
  summarizeObstaclesInRadius,
  zoneIntersectsRadius,
  type AviationPoi,
} from "../areaOverview";

const C = { lat: 50.0, lon: 8.0 };
/** Punkt in `m` Metern Entfernung in Richtung `deg` von C (genügt für < 10 km). */
function offset(m: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  return {
    lat: C.lat + (m * Math.cos(r)) / 111_195,
    lon: C.lon + (m * Math.sin(r)) / (111_195 * Math.cos((C.lat * Math.PI) / 180)),
  };
}
function square(centerM: number, deg: number, halfM: number): [number, number][] {
  const c = offset(centerM, deg);
  const dLat = halfM / 111_195;
  const dLon = halfM / (111_195 * Math.cos((c.lat * Math.PI) / 180));
  return [[c.lat - dLat, c.lon - dLon], [c.lat - dLat, c.lon + dLon], [c.lat + dLat, c.lon + dLon], [c.lat + dLat, c.lon - dLon]];
}

describe("Geometrie", () => {
  it("Entfernung, Kurs und deutscher Kompass", () => {
    const p = offset(2400, 45);
    assert.ok(Math.abs(haversineM(C, p) - 2400) < 15);
    assert.ok(Math.abs(bearingDeg(C, p) - 45) < 1);
    assert.equal(compassDe(45), "NO");
    assert.equal(compassDe(90), "O");
    assert.equal(compassDe(135), "SO");
    assert.equal(compassDe(225), "SW");
    assert.equal(compassDe(350), "N");
    assert.equal(formatDistanceDe(2400), "2,4 km");
    assert.equal(formatDistanceDe(847), "850 m");
    assert.equal(formatDistanceDe(12_400), "12 km");
  });

  it("Ring berührt Kreis: Mittelpunkt innen, Kante nah, weit weg", () => {
    assert.equal(ringIntersectsCircle(square(0, 0, 5000), C, 100), true, "Standort in großer Zone");
    assert.equal(ringIntersectsCircle(square(1200, 90, 300), C, 1000), true, "Kante 900 m entfernt, Radius 1 km");
    assert.equal(ringIntersectsCircle(square(3000, 90, 300), C, 1000), false);
  });

  it("filterZonesInRadius: nur berührende Zonen, Zonen ohne Geometrie bleiben", () => {
    const inside = { name: "in", polygonRings: [square(500, 0, 200)] };
    const outside = { name: "out", polygonGroups: [[square(5000, 180, 200)]] };
    const noGeom = { name: "wms" };
    assert.equal(zoneIntersectsRadius(noGeom, C, 1000), null);
    const r = filterZonesInRadius([inside, outside, noGeom], C, 1);
    assert.deepEqual(r.map((z) => z.name), ["in", "wms"]);
  });

  it("dipul-Beschränkung: Kreis und Polygon gegen Umkreis", () => {
    const c = offset(1500, 0);
    assert.equal(restrictionInRadius({ centerLat: c.lat, centerLon: c.lon, radiusM: 600 }, C, 1000), true);
    assert.equal(restrictionInRadius({ centerLat: c.lat, centerLon: c.lon, radiusM: 100 }, C, 1000), false);
    assert.equal(restrictionInRadius({ polygonRings: [square(4000, 0, 100)] }, C, 1000), false);
    assert.equal(restrictionInRadius({}, C, 1000), true, "ohne Geometrie nicht wegfiltern");
  });

  it("NOTAMs: örtlich im Umkreis, großräumig getrennt, entfernte fallen weg", () => {
    const near = { id: 1, ...offset(3000, 90), radius: 2 }; // 3 km, 2 NM = 3,7 km -> berührt
    const far = { id: 2, ...offset(20_000, 90), radius: 1 };
    const fir = { id: 3, ...offset(1000, 0), radius: 999 };
    const noPos = { id: 4 } as { id: number; lat?: number; lon?: number; radius?: number };
    const s = splitNotamsForArea([near, far, fir, noPos], C, 500);
    assert.deepEqual(s.local.map((n) => n.id), [1]);
    assert.deepEqual(s.wide.map((n) => n.id), [3, 4]);
  });

  it("circleToRing ergibt einen Kreis mit dem Radius", () => {
    const ring = circleToRing(C, 1000, 24);
    assert.equal(ring.length, 25);
    for (const [la, lo] of ring) assert.ok(Math.abs(haversineM(C, { lat: la, lon: lo }) - 1000) < 2);
  });

  it("Vorschau-Ausschnitt: Umkreis füllt ~55 % der Höhe", () => {
    const r = previewRegion(50.23, 8.45, 0.21);
    const diameterLat = (2 * 210) / 110_540;
    assert.ok(Math.abs(diameterLat / r.latitudeDelta - 0.55) < 0.01);
    assert.ok(r.longitudeDelta > r.latitudeDelta, "Längenspanne in Grad größer (Breite 50°)");
  });
});

describe("Hinweise in der Nähe", () => {
  const poi = (id: string, kind: AviationPoi["kind"], m: number, deg: number, extra: Partial<AviationPoi> = {}): AviationPoi => ({
    id, kind, ...offset(m, deg), source: "osm", ...extra,
  });

  it("Rettungshubschrauber-Landeplatz 1,2 km NO = Vorsicht, Flugplatz 2,4 km = Info", () => {
    const hints = buildNearbyHints(C, 0.5, [
      poi("af", "airfield", 2400, 45, { name: "Egelsbach", icao: "EDFE" }),
      poi("hp", "helipad", 1200, 45, { name: "Klinikum Nord", hospital: true, rescue: true }),
    ]);
    assert.equal(hints.length, 2);
    assert.equal(hints[0].id, "hp");
    assert.equal(hints[0].level, "caution");
    assert.equal(hints[0].title, "Rettungshubschrauber-Landeplatz Klinikum Nord");
    assert.equal(hints[0].distanceText, "1,2 km NO");
    assert.equal(hints[1].level, "info");
    assert.equal(hints[1].title, "Flugplatz Egelsbach (EDFE)");
    assert.equal(hints[1].distanceText, "2,4 km NO");
    assert.equal(hintsSummaryDe(hints), "2 Hinweise in der Nähe");
  });

  it("Helipad im (großen) Umkreis = Vorsicht, auch über 1,5 km", () => {
    const [h] = buildNearbyHints(C, 3, [poi("hp", "heliport", 2500, 180)]);
    assert.equal(h.level, "caution");
    assert.equal(h.insideRadius, true);
    assert.equal(h.direction, "S");
  });

  it("Helipad 2,5 km bei kleinem Umkreis = Info, über 3 km kein Hinweis", () => {
    const hints = buildNearbyHints(C, 0.3, [poi("a", "helipad", 2500, 270), poi("b", "helipad", 3600, 270)]);
    assert.deepEqual(hints.map((h) => [h.id, h.level]), [["a", "info"]]);
  });

  it("Flugplatz unter 1,5 km = Vorsicht; über 5 km kein Hinweis; Modellflug bis 3 km", () => {
    const hints = buildNearbyHints(C, 0.5, [
      poi("near", "airfield", 1000, 0),
      poi("far", "airport", 6000, 0),
      poi("m1", "model", 2000, 90),
      poi("m2", "model", 3500, 90),
    ]);
    assert.deepEqual(hints.map((h) => [h.id, h.level]), [["near", "caution"], ["m1", "info"]]);
  });

  it("Doppelte Einträge (OSM + Flughafenliste) werden zusammengeführt", () => {
    const osm = poi("osm:1", "airfield", 3000, 90, { name: "Platz" });
    const db = airportPoisFromList([{ icao: "EDXX", name: "Liste", ...offset(3200, 90) }]);
    const merged = dedupePois([...db, osm]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].name, "Platz");
    assert.equal(merged[0].icao, "EDXX");
    assert.equal(merged[0].kind, "airport");
  });
});

describe("Overpass: Luftfahrt-Punkte", () => {
  it("Abfrage enthält Helipads, Luftrettung, Flugplätze und Modellflug für die Bbox", () => {
    const q = buildAviationPoiQuery({ s: 49.9, w: 7.9, n: 50.1, e: 8.1 });
    assert.match(q, /\[out:json\]/);
    assert.match(q, /nwr\["aeroway"~"\^\(helipad\|heliport\)\$"\]\(49\.90000,7\.90000,50\.10000,8\.10000\)/);
    assert.match(q, /nwr\["emergency"="air_rescue_service"\]/);
    assert.match(q, /nwr\["aeroway"="aerodrome"\]/);
    assert.match(q, /nwr\["sport"="model_aerodrome"\]/);
    assert.match(q, /out tags center/);
  });

  it("Parser: Arten, Luftrettung/Klinik, Mittelpunkt von Flächen, unbekannte ignoriert", () => {
    const fc = parseAviationPoisOverpass({
      elements: [
        { type: "node", id: 1, lat: 50.01, lon: 8.01, tags: { aeroway: "helipad", name: "Klinikum Frankfurt Höchst" } },
        { type: "way", id: 2, center: { lat: 50.02, lon: 8.02 }, tags: { aeroway: "heliport", name: "Luftrettungsstation", operator: "DRF Luftrettung" } },
        { type: "node", id: 3, lat: 50.03, lon: 8.03, tags: { emergency: "air_rescue_service", name: "Christoph 2" } },
        { type: "way", id: 4, center: { lat: 50.04, lon: 8.04 }, tags: { aeroway: "aerodrome", name: "Flugplatz Egelsbach", icao: "EDFE" } },
        { type: "way", id: 5, center: { lat: 50.05, lon: 8.05 }, tags: { aeroway: "aerodrome", "aerodrome:type": "gliding", name: "Segelfluggelände X" } },
        { type: "way", id: 6, center: { lat: 50.06, lon: 8.06 }, tags: { leisure: "pitch", sport: "model_aerodrome", name: "MFC" } },
        { type: "way", id: 7, center: { lat: 50.07, lon: 8.07 }, tags: { aeroway: "aerodrome", "aerodrome:type": "international", iata: "FRA", icao: "EDDF" } },
        { type: "node", id: 8, lat: 50.08, lon: 8.08, tags: { aeroway: "runway" } },
        { type: "node", id: 9, tags: { aeroway: "helipad" } },
      ],
    });
    const pois = poisFromFeatureCollection(fc);
    const byId = Object.fromEntries(pois.map((p) => [p.id, p]));
    assert.equal(pois.length, 7);
    assert.equal(byId["osm:node1"].kind, "helipad");
    assert.equal(byId["osm:node1"].hospital, true);
    assert.equal(byId["osm:way2"].kind, "heliport");
    assert.equal(byId["osm:way2"].rescue, true);
    assert.equal(byId["osm:way2"].lat, 50.02);
    assert.equal(byId["osm:node3"].rescue, true);
    assert.equal(byId["osm:way4"].kind, "airfield");
    assert.equal(byId["osm:way4"].icao, "EDFE");
    assert.equal(byId["osm:way5"].kind, "glider");
    assert.equal(byId["osm:way6"].kind, "model");
    assert.equal(byId["osm:way7"].kind, "airport");
  });
});

describe("Hindernisse im Umkreis", () => {
  it("zählt Punkte im Umkreis nach Art, höchstes Hindernis und Freileitungen", () => {
    const pt = (k: string, h: number, m: number, deg: number) => {
      const p = offset(m, deg);
      return { type: "Feature" as const, properties: { k, h }, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } };
    };
    const a = offset(800, 270);
    const b = offset(800, 90);
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        pt("wind", 200, 600, 0),
        pt("wind", 230, 900, 10),
        pt("mast", 40, 300, 180),
        pt("wind", 240, 5000, 0),
        { type: "Feature", properties: { k: "line", c: "hs" }, geometry: { type: "LineString", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } },
      ],
    };
    const s = summarizeObstaclesInRadius(fc, C, 1000);
    assert.equal(s.total, 3);
    assert.equal(s.powerLines, 1);
    assert.equal(s.tallest?.heightM, 230);
    assert.equal(s.tallest?.direction, "N");
    assert.equal(obstacleSummaryTextDe(s), "2 Windkraftanlagen (bis 230 m), 1 Mast (bis 40 m), 1 Freileitung");
  });
});
