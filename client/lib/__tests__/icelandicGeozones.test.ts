import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  IS_GEOZONE_SOURCE_LABEL,
  IS_TEXT_AIRPORT,
  IS_TEXT_GENERIC,
  IS_TEXT_INFRASTRUCTURE,
  IS_ZONES_LAYER,
  IS_CLOSURES_LAYER,
  icelandWfsHasMore,
  icelandWfsUrl,
  icelandicClosureRestriction,
  icelandicRestriction,
  icelandicZoneCategory,
  mergeIcelandicFeatures,
  normalizeIcelandicClosures,
  normalizeIcelandicZones,
} from "../../../shared/icelandicGeozones";
import { fetchIceland } from "../geozoneDirect/icelandSource";

// Gekürzter ECHTER WFS-Abzug von samgongustofa:dronemap_isl_geom (gis.is,
// 2026-11-15): 9 von 271 Zonen, Geometrien unverändert; numberReturned an die
// Kürzung angepasst, numberMatched/totalFeatures original (271).
const sample = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "is-samgongustofa-wfs-sample.json"), "utf8"),
);
// Echte (leere) Antwort von samgongustofa:skyndilokanir_dronar am selben Tag.
const emptyClosures = {
  type: "FeatureCollection",
  features: [],
  totalFeatures: 0,
  numberMatched: 0,
  numberReturned: 0,
  timeStamp: "2026-11-15T02:34:10.561Z",
  crs: null,
};

const byId = (fs: any[], id: string) => fs.find((f) => f.properties.identifier === id);

describe("Island (Samgöngustofa) – Normalisierung", () => {
  const zones = normalizeIcelandicZones(sample);

  it("liest alle Zonen der Stichprobe mit Quelle und Kennung", () => {
    assert.equal(zones.length, 9);
    for (const z of zones) {
      assert.match(String(z.properties.identifier), /^NFZ-\d+$/);
      assert.equal(z.properties.source, IS_GEOZONE_SOURCE_LABEL);
      assert.equal(z.properties.country, "ISL");
    }
  });

  it("CONDITIONAL aus dem Feed → REQ_AUTHORISATION, Original bleibt erhalten", () => {
    for (const z of zones) {
      assert.equal(z.properties.restriction, "REQ_AUTHORISATION");
      assert.equal(z.properties.originalRestriction, "CONDITIONAL");
    }
  });

  it("Einstufungstabelle", () => {
    assert.equal(icelandicRestriction({ restriction: "PROHIBITED" }), "PROHIBITED");
    assert.equal(icelandicRestriction({ restriction: "REQ_AUTHORISATION" }), "REQ_AUTHORISATION");
    assert.equal(icelandicRestriction({ restriction: "CONDITIONAL" }), "REQ_AUTHORISATION");
    assert.equal(icelandicRestriction({ restriction: "NO_RESTRICTION" }), "REQ_AUTHORISATION");
    assert.equal(icelandicRestriction({}), "REQ_AUTHORISATION");
    assert.equal(icelandicClosureRestriction({ zoneType: "PROHIBITED" }), "PROHIBITED");
    assert.equal(icelandicClosureRestriction({ zoneType: "Lokun" }), "PROHIBITED");
    assert.equal(icelandicClosureRestriction({ zoneType: "REQ_AUTHORISATION" }), "REQ_AUTHORISATION");
  });

  it("fehlende Höhen: ab Grund, ohne Obergrenze", () => {
    for (const z of zones) {
      assert.equal(z.properties.lowerMeters, 0);
      assert.equal(z.properties.upperMeters, undefined);
      assert.equal(z.properties.lowerReference, "AGL");
    }
  });

  it("Geometrie bleibt in Originalpräzision (keine Vereinfachung)", () => {
    for (const raw of sample.features) {
      const z = byId(zones, raw.properties.identifier);
      assert.deepEqual(z.geometry, raw.geometry);
    }
    // Hlið: MultiPolygon mit Loch bleibt vollständig
    const hlid = byId(zones, "NFZ-126");
    assert.equal(hlid.geometry.type, "MultiPolygon");
    assert.equal((hlid.geometry.coordinates as any[]).length, 2);
  });

  it("Kategorie aus dem Namen und offizieller Text", () => {
    assert.equal(icelandicZoneCategory("Lögreglan á höfuðborgarsvæðinu"), "police");
    assert.equal(icelandicZoneCategory("Forsætisráðuneyti"), "ministry");
    assert.equal(icelandicZoneCategory("Þýskaland"), "embassy");
    assert.equal(icelandicZoneCategory("HSS Keflavík"), "hospital");
    assert.equal(icelandicZoneCategory("Ísafjörður"), "airport");
    assert.equal(icelandicZoneCategory("Búrfellsvirkjun"), "energy");
    assert.equal(icelandicZoneCategory("Steingrímsstöð"), "energy");
    assert.equal(icelandicZoneCategory("Surtsey"), "nature");
    assert.equal(icelandicZoneCategory("Hólmanes Friðland"), "nature");
    assert.equal(icelandicZoneCategory("Hlið"), "other");

    const police = byId(zones, "NFZ-1");
    assert.equal(police.properties.message, `Kategorie: Polizei\n${IS_TEXT_INFRASTRUCTURE}`);
    const airport = byId(zones, "NFZ-153");
    assert.ok(airport.properties.message.split("\n").includes(IS_TEXT_AIRPORT));
    const surtsey = byId(zones, "NFZ-138");
    assert.ok(surtsey.properties.message.endsWith(IS_TEXT_GENERIC));
    // Name bleibt isländisch (Übersetzung macht zoneTranslate)
    assert.equal(police.properties.name, "Lögreglan á höfuðborgarsvæðinu");
  });

  it("Dedupe über identifier", () => {
    const doubled = { features: [...sample.features, sample.features[0]] };
    assert.equal(normalizeIcelandicZones(doubled).length, 9);
  });

  it("verwirft Features ohne Flächengeometrie", () => {
    const bad = { features: [{ type: "Feature", geometry: null, properties: { identifier: "X" } }, { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }] };
    assert.equal(normalizeIcelandicZones(bad).length, 0);
  });
});

describe("Island – temporäre Sperrungen", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const geom = { type: "MultiPolygon", coordinates: [[[[-21.9, 64.1], [-21.8, 64.1], [-21.8, 64.2], [-21.9, 64.1]]]] };

  it("leere Live-Antwort → keine Sperrungen", () => {
    assert.deepEqual(normalizeIcelandicClosures(emptyClosures, now), []);
  });

  it("aktive Sperrung → PROHIBITED mit Zeitfenster; abgelaufene entfällt", () => {
    const out = normalizeIcelandicClosures({
      features: [
        { type: "Feature", id: "skyndilokanir_dronar.1", geometry: geom, properties: { zoneType: "Lokun", effectiveDate: "2026-11-15T08:00:00Z", expirationDate: "2026-11-16T08:00:00Z", contact: "lögregla" } },
        { type: "Feature", id: "skyndilokanir_dronar.2", geometry: geom, properties: { effectiveDate: "2026-11-01T08:00:00Z", expirationDate: "2026-11-02T08:00:00Z" } },
      ],
    }, now);
    assert.equal(out.length, 1);
    const p = out[0].properties;
    assert.equal(p.restriction, "PROHIBITED");
    assert.equal(p.validStartTs, Date.parse("2026-11-15T08:00:00Z"));
    assert.equal(p.validEndTs, Date.parse("2026-11-16T08:00:00Z"));
    assert.equal(p.applicability[0].permanent, "NO");
    assert.match(p.message, /Kontakt: lögregla/);
    assert.equal(p.lowerMeters, 0);
    const merged = mergeIcelandicFeatures(normalizeIcelandicZones(sample), out);
    assert.equal(merged.length, 10);
  });
});

describe("Island – WFS-Abruf", () => {
  it("URL und Paging-Entscheidung", () => {
    const u = icelandWfsUrl(IS_ZONES_LAYER, { count: 1000, startIndex: 0 });
    assert.equal(
      u,
      "https://gis.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=samgongustofa:dronemap_isl_geom&srsName=EPSG:4326&outputFormat=application/json&count=1000",
    );
    assert.match(icelandWfsUrl(IS_ZONES_LAYER, { count: 9, startIndex: 9 }), /&count=9&startIndex=9$/);
    // Stichprobe: 9 geliefert, 271 gesamt → weitere Seite nötig
    assert.equal(icelandWfsHasMore(sample, 9, 9), true);
    assert.equal(icelandWfsHasMore(sample, 271, 9), false);
    assert.equal(icelandWfsHasMore(emptyClosures, 0, 1000), false);
    assert.equal(icelandWfsHasMore({ features: [1, 2] }, 2, 2), true);
    assert.equal(icelandWfsHasMore({ features: [1] }, 1, 2), false);
  });

  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const respond = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as unknown as Response;

  it("fetchIceland: Paging, Fallback-Host, Sperrungen gemergt, _country=is", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes(IS_CLOSURES_LAYER)) return respond(emptyClosures);
      if (url.startsWith("https://gis.is/")) return respond({}, 503); // Primär-Host down
      // Fallback gis.natt.is: zwei Seiten (5 + 4 Zonen)
      const start = Number(/startIndex=(\d+)/.exec(url)?.[1] ?? 0);
      const feats = sample.features.slice(start, start + 5);
      return respond({ ...sample, features: feats, numberMatched: 9, numberReturned: feats.length });
    }) as typeof fetch;

    const out = await fetchIceland();
    assert.equal(out.length, 9);
    for (const f of out) {
      assert.equal(f.properties._country, "is");
      assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
      assert.ok(Array.isArray(f.bbox));
    }
    assert.ok(calls.some((c) => c.startsWith("https://gis.natt.is/") && c.includes("startIndex=5")));
  });

  it("fetchIceland: leere Hauptebene → Fehler", async () => {
    globalThis.fetch = (async () => respond(emptyClosures)) as typeof fetch;
    await assert.rejects(fetchIceland(), /keine Zonen/);
  });

  it("fetchIceland: Fehler bei Sperrungen kostet die Zonen nicht", async () => {
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes(IS_CLOSURES_LAYER)) return respond({}, 500);
      return respond({ ...sample, numberMatched: 9 });
    }) as typeof fetch;
    const out = await fetchIceland();
    assert.equal(out.length, 9);
  });
});
