import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  queryChRestIdentifyFrom,
  queryLuOgcFeaturesFrom,
  queryNlWfsFeaturesFrom,
  queryDipulWfsFeaturesFrom,
  parseDipulWfsBatches,
  DipulWfsAccessError,
  queryFrWmsFeaturesFrom,
  isLuZonePermanent,
  buildLuNotamFromWms,
  fetchLuTsaAsNotams,
  fetchAllLuZonesAsNotamsFrom,
  type ChRestConfig,
  type LuNotam,
} from "../geozoneQueries";
import { FR_ZONE_TYPES, classifyFrRestrictionType } from "../frZoneTypes";

// ---------------------------------------------------------------------------
// fetch-Mock (analog zu geozoneCoverage.test.ts). Die vier Abfragen feuern
// jeweils mehrere Sample-Requests parallel ab; daher werden ALLE aufgerufenen
// URLs gesammelt, und der Impl liefert pro Aufruf die gleiche Antwort.
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let urls: string[] = [];
let fetchImpl: (url: string) => Promise<any>;

function installFetch(impl: (url: string) => Promise<any>) {
  fetchImpl = impl;
  globalThis.fetch = (async (input: any) => {
    const u = typeof input === "string" ? input : input?.toString?.() ?? String(input);
    urls.push(u);
    return fetchImpl(u);
  }) as any;
}

function jsonResponse(body: any, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function jsonThrows(ok = true) {
  return { ok, status: 200, json: async () => { throw new Error("malformed json"); } };
}

function textResponse(body: string, ok = true, status = 200) {
  return { ok, status, text: async () => body };
}

// Liefert die zentrierte Sample-URL (Mittelpunkt der jeweiligen Box).
function centerUrl(match: (u: string) => boolean): string {
  const found = urls.find(match);
  assert.ok(found, "Erwartete zentrale Sample-URL fehlt");
  return found!;
}

// ===========================================================================
// CH – geo.admin.ch REST identify
// ===========================================================================
const CH_CONFIG: ChRestConfig = {
  restIdentifyUrl: "https://api3.geo.admin.ch/rest/services/api/MapServer/identify",
  restIdentifyLayers: ["ch.bazl.einschraenkungen-drohnen", "ch.bazl.uas-aktivitaetszonen"],
  layers: [
    { id: "ch_drohnen", wmsLayer: "ch.bazl.einschraenkungen-drohnen", label: "Drohnen-Einschränkungen", defaultEnabled: true },
    { id: "ch_akt", wmsLayer: "ch.bazl.uas-aktivitaetszonen", label: "UAS-Aktivitätszonen", defaultEnabled: true },
  ],
};

describe("queryChRestIdentifyFrom", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("baut die REST-identify-URL mit Punkt-Geometrie, all:-Layern und mapExtent-Bbox", async () => {
    installFetch(async () => jsonResponse({ results: [] }));
    await queryChRestIdentifyFrom(CH_CONFIG, 46.948, 7.4474, 1);

    // 9 Sample-Punkte -> 9 Requests.
    assert.equal(urls.length, 9);
    const u = new URL(centerUrl((x) => x.includes("geometry=7.4474,46.948")));
    assert.equal(u.origin + u.pathname, CH_CONFIG.restIdentifyUrl);
    assert.equal(u.searchParams.get("geometryType"), "esriGeometryPoint");
    assert.equal(u.searchParams.get("sr"), "4326");
    assert.equal(u.searchParams.get("layers"), `all:${CH_CONFIG.restIdentifyLayers!.join(",")}`);
    assert.equal(u.searchParams.get("returnGeometry"), "false");

    const ext = u.searchParams.get("mapExtent")!.split(",").map(Number);
    assert.equal(ext.length, 4);
    const [minLon, minLat, maxLon, maxLat] = ext;
    assert.ok(minLon < maxLon && minLat < maxLat, "bbox-Reihenfolge");
    assert.ok(Math.abs((minLat + maxLat) / 2 - 46.948) < 1e-4, "lat-Mitte");
  });

  it("normalisiert results[] zu GeozoneFeatureInfo (Label-Lookup, Höhe, Einschränkung) und dedupliziert", async () => {
    installFetch(async () => jsonResponse({
      results: [{
        layerBodId: "ch.bazl.einschraenkungen-drohnen",
        attributes: {
          zone_name_de: "Testzone Bern",
          zone_restriction_de: "Verboten",
          air_vol_lower_limit: 0,
          air_vol_upper_limit: 120,
          label: "L1",
        },
      }],
    }));
    const res = await queryChRestIdentifyFrom(CH_CONFIG, 46.948, 7.4474, 1);

    // Alle 9 Samples liefern denselben Treffer -> Dedup auf genau 1.
    assert.equal(res.length, 1);
    assert.equal(res[0].layerLabel, "Drohnen-Einschränkungen");
    assert.equal(res[0].name, "Testzone Bern");
    assert.match(res[0].details, /Einschränkung: Verboten/);
    assert.match(res[0].details, /Höhe: 0 m/);
    assert.equal(res[0].featureId, "L1");
  });

  it("liefert [] bei non-ok Antwort", async () => {
    installFetch(async () => jsonResponse({ results: [{ layerBodId: "x", attributes: { name: "y" } }] }, false, 500));
    assert.deepEqual(await queryChRestIdentifyFrom(CH_CONFIG, 46.948, 7.4474, 1), []);
  });

  it("liefert [] bei fehlendem results-Feld (malformed)", async () => {
    installFetch(async () => jsonResponse({ foo: "bar" }));
    assert.deepEqual(await queryChRestIdentifyFrom(CH_CONFIG, 46.948, 7.4474, 1), []);
  });

  it("liefert [] wenn keine restIdentify-Config gesetzt ist", async () => {
    installFetch(async () => jsonResponse({ results: [] }));
    const res = await queryChRestIdentifyFrom({ layers: CH_CONFIG.layers }, 46.948, 7.4474, 1);
    assert.deepEqual(res, []);
    assert.equal(urls.length, 0, "ohne Identify-URL darf kein Request abgehen");
  });
});

// ===========================================================================
// LU – geoportail.lu WMS GetFeatureInfo (text/plain)
// ===========================================================================
describe("queryLuOgcFeaturesFrom", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("baut die LU-WMS-GetFeatureInfo-URL (EPSG:3857, Layer 1927/1928, text/plain)", async () => {
    installFetch(async () => textResponse("no features were found"));
    await queryLuOgcFeaturesFrom(49.6116, 6.1319, 1);

    assert.equal(urls.length, 9);
    const u = urls[0];
    assert.ok(u.startsWith("https://wms.geoportail.lu/public_map_layers/service"), "LU-Endpoint");
    assert.match(u, /REQUEST=GetFeatureInfo/);
    assert.match(u, /LAYERS=1927,1928/);
    assert.match(u, /QUERY_LAYERS=1927,1928/);
    assert.match(u, /SRS=EPSG:3857/);
    assert.match(u, /INFO_FORMAT=text\/plain/);
    const bbox = new URL(u).searchParams.get("BBOX")!.split(",").map(Number);
    assert.equal(bbox.length, 4);
    assert.ok(bbox[0] < bbox[2] && bbox[1] < bbox[3], "bbox-Reihenfolge");
  });

  it("parst den text/plain-Block zu GeozoneFeatureInfo und übersetzt FR-Begriffe", async () => {
    const block = [
      "Zone Identifier : LU-R1",
      "Description : Aérodrome de Test",
      "Activity : permanent",
      "Lower limit (meter) : 0",
      "Upper limit (meter) : 50",
    ].join("\n");
    installFetch(async () => textResponse(block));
    const res = await queryLuOgcFeaturesFrom(49.6116, 6.1319, 1);

    assert.equal(res.length, 1);
    assert.equal(res[0].name, "LU-R1");
    // permanent + Untergrenze < 50 -> 0–50 m Zone.
    assert.equal(res[0].layerLabel, "UAS-Zonen 0–50 m");
    assert.match(res[0].details, /Beschreibung: Flugplatz/);
    assert.match(res[0].details, /Höhe: 0 – 50 m/);
    assert.equal(res[0].featureId, "LU-R1");
  });

  it("liefert [] bei non-ok Antwort", async () => {
    installFetch(async () => textResponse("Zone Identifier : X", false, 500));
    assert.deepEqual(await queryLuOgcFeaturesFrom(49.6116, 6.1319, 1), []);
  });

  it("liefert [] bei 'no features were found' (malformed/leer)", async () => {
    installFetch(async () => textResponse("no features were found"));
    assert.deepEqual(await queryLuOgcFeaturesFrom(49.6116, 6.1319, 1), []);
  });
});

// ===========================================================================
// NL – PDOK WFS GetFeature (EPSG:4326, application/json)
// ===========================================================================
const NL_LAYERS = [
  { id: "nl_no_fly_zones", wmsLayer: "luchtvaartgebieden", label: "Flugverbotszonen (alle)", defaultEnabled: true },
  { id: "nl_landingsite", wmsLayer: "landingsite", label: "Landeplätze", defaultEnabled: true },
];

describe("queryNlWfsFeaturesFrom", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("baut die WFS-GetFeature-URL mit korrektem TYPENAME und EPSG:4326-Bbox (minLat,minLon,maxLat,maxLon)", async () => {
    installFetch(async () => jsonResponse({ features: [] }));
    await queryNlWfsFeaturesFrom(NL_LAYERS, 52.0, 5.0, 1);

    assert.equal(urls.length, 1, "Default-Layer luchtvaartgebieden -> genau 1 Request");
    const u = new URL(urls[0]);
    assert.match(u.searchParams.get("TYPENAMES")!, /drone-no-flyzones:luchtvaartgebieden/);
    assert.equal(u.searchParams.get("REQUEST"), "GetFeature");
    assert.equal(u.searchParams.get("OUTPUTFORMAT"), "application/json");

    const bbox = u.searchParams.get("BBOX")!.split(",");
    assert.equal(bbox[4], "EPSG:4326");
    const nums = bbox.slice(0, 4).map(Number);
    const delta = 1 / 111.32;
    assert.ok(Math.abs(nums[0] - (52.0 - delta)) < 1e-9, "minLat");
    assert.ok(Math.abs(nums[1] - (5.0 - delta)) < 1e-9, "minLon");
    assert.ok(Math.abs(nums[2] - (52.0 + delta)) < 1e-9, "maxLat");
    assert.ok(Math.abs(nums[3] - (5.0 + delta)) < 1e-9, "maxLon");
  });

  it("normalisiert WFS-features zu GeozoneFeatureInfo inkl. Polygon-Ringe und übersetztem Quelltext", async () => {
    installFetch(async () => jsonResponse({
      features: [{
        id: "nl-1",
        properties: { localtype: "Verboden", sourceTxt: "Gecontroleerde luchthavens (Verboden voor open categorie)" },
        geometry: { type: "Polygon", coordinates: [[[5.0, 52.0], [5.1, 52.0], [5.1, 52.1], [5.0, 52.0]]] },
      }],
    }));
    const res = await queryNlWfsFeaturesFrom(NL_LAYERS, 52.0, 5.0, 1);

    assert.equal(res.length, 1);
    assert.equal(res[0].layerLabel, "Flugverbotszonen (alle)");
    assert.match(res[0].details, /Zonentyp: Verboten \(Prohibited\)/);
    assert.match(res[0].name, /Kontrollierte Flughäfen/);
    assert.ok(res[0].polygonRings && res[0].polygonRings.length === 1, "Polygon-Ring vorhanden");
    // WFS-Koordinaten [lon,lat] -> intern [lat,lon] gedreht.
    assert.deepEqual(res[0].polygonRings![0][0], [52.0, 5.0]);
  });

  it("normalisiert landingsite-features (eigener Parser)", async () => {
    installFetch(async () => jsonResponse({
      features: [{ id: "ls-1", properties: { txtname: "Heliport Rotterdam", specifiek: "Heliport" } }],
    }));
    const res = await queryNlWfsFeaturesFrom(NL_LAYERS, 52.0, 5.0, 1, ["landingsite"]);

    assert.equal(res.length, 1);
    assert.equal(res[0].layerLabel, "Landeplätze");
    assert.equal(res[0].name, "Heliport Rotterdam");
    assert.match(res[0].details, /Typ: Hubschrauberlandeplatz/);
  });

  it("liefert [] bei non-ok Antwort", async () => {
    installFetch(async () => jsonResponse({ features: [{ id: "x", properties: {} }] }, false, 503));
    assert.deepEqual(await queryNlWfsFeaturesFrom(NL_LAYERS, 52.0, 5.0, 1), []);
  });

  it("liefert [] bei fehlendem features-Feld (malformed)", async () => {
    installFetch(async () => jsonResponse({ type: "FeatureCollection" }));
    assert.deepEqual(await queryNlWfsFeaturesFrom(NL_LAYERS, 52.0, 5.0, 1), []);
  });
});

// ===========================================================================
// DE – DIPUL WFS vector features (server proxy, GeoJSON lon/lat)
// ===========================================================================
const DE_LAYERS = [
  { id: "flughaefen", wmsLayer: "flughaefen", label: "Flughäfen", defaultEnabled: true },
  { id: "temporaere_betriebseinschraenkungen", wmsLayer: "temporaere_betriebseinschraenkungen", label: "Temporäre Beschränkungen", defaultEnabled: true },
];

describe("DIPUL WFS Vektordaten", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("fragt den festen App-Proxy für den gewählten Standort und Radius ab", async () => {
    installFetch(async () => jsonResponse({
      byLayer: [{
        layer: "flughaefen",
        features: [{
          id: "flughaefen.1",
          properties: { name: "Köln/Bonn", type_code: "FLUGPLATZ", legal_ref: "§ 21h LuftVO" },
          geometry: {
            type: "Polygon",
            coordinates: [[[7.1, 50.8], [7.2, 50.8], [7.2, 50.9], [7.1, 50.8]]],
          },
        }],
      }],
      failedLayers: [],
      fallbackLayers: ["temporaere_betriebseinschraenkungen"],
    }));

    const result = await queryDipulWfsFeaturesFrom("https://app.example/", DE_LAYERS, 50.85, 7.15, 2);
    const request = new URL(urls[0]);
    assert.equal(request.origin + request.pathname, "https://app.example/api/proxy/dipul-geozones");
    assert.equal(request.searchParams.get("lat"), "50.85");
    assert.equal(request.searchParams.get("lon"), "7.15");
    assert.equal(request.searchParams.get("radiusKm"), "2");
    assert.equal(result.zones.length, 1);
    assert.deepEqual(result.zones[0].polygonRings?.[0][0], [50.8, 7.1]);
    assert.equal(result.zones[0].country, "DE");
    assert.match(result.zones[0].details, /§ 21h LuftVO/);
    assert.deepEqual(result.fallbackLayers, ["temporaere_betriebseinschraenkungen"]);
  });

  it("erhält Löcher in MultiPolygonen und meldet Geometrien ohne Polygon als Fallback", () => {
    const parsed = parseDipulWfsBatches([{
      layer: "flughaefen",
      features: [
        {
          id: "donut",
          properties: { name: "Donut-Zone" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [[
              [[7, 50], [7.2, 50], [7.2, 50.2], [7, 50.2], [7, 50]],
              [[7.05, 50.05], [7.15, 50.05], [7.15, 50.15], [7.05, 50.15], [7.05, 50.05]],
            ]],
          },
        },
        {
          id: "unexpected",
          properties: { name: "Nicht als Polygon" },
          geometry: { type: "LineString", coordinates: [[7, 50], [7.1, 50.1]] },
        },
      ],
    }], DE_LAYERS);

    assert.equal(parsed.zones.length, 1);
    assert.equal(parsed.zones[0].polygonGroups?.[0].length, 2);
    assert.deepEqual(parsed.failedLayers, ["flughaefen"]);
  });

  it("lehnt eine nicht erfolgreiche Proxy-Antwort ausdrücklich ab", async () => {
    installFetch(async () => jsonResponse({ error: "upstream unavailable" }, false, 502));
    await assert.rejects(
      queryDipulWfsFeaturesFrom("https://app.example/", DE_LAYERS, 50.85, 7.15, 2),
      /DIPUL Vektordaten nicht verfügbar/,
    );
  });

  it("lässt fehlende Anmeldung oder Länderfreischaltung nicht auf den WMS-Fallback durch", async () => {
    installFetch(async () => jsonResponse({ error: "locked" }, false, 403));
    await assert.rejects(
      queryDipulWfsFeaturesFrom("https://app.example/", DE_LAYERS, 50.85, 7.15, 2),
      (error) => error instanceof DipulWfsAccessError && error.status === 403,
    );
  });
});

// ===========================================================================
// FR – DGAC / Géoplateforme WMS GetFeatureInfo (EPSG:3857, application/json)
// ===========================================================================
const FR_WMS_BASE = "https://data.geopf.fr/wms-r/wms";

describe("queryFrWmsFeaturesFrom", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("baut die DGAC-GetFeatureInfo-URL (EPSG:3857, INFO_FORMAT json, DRONES-Layer)", async () => {
    installFetch(async () => jsonResponse({ features: [] }));
    await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1);

    // Mittelpunkt + 8 Randpunkte -> 9 Requests.
    assert.equal(urls.length, 9);
    const u = new URL(urls[0]);
    assert.equal(u.origin + u.pathname, FR_WMS_BASE);
    assert.equal(u.searchParams.get("REQUEST"), "GetFeatureInfo");
    assert.equal(u.searchParams.get("CRS"), "EPSG:3857");
    assert.equal(u.searchParams.get("INFO_FORMAT"), "application/json");
    assert.match(u.searchParams.get("QUERY_LAYERS")!, /TRANSPORTS\.DRONES\.RESTRICTIONS/);
    const bbox = u.searchParams.get("BBOX")!.split(",").map(Number);
    assert.equal(bbox.length, 4);
    assert.ok(bbox[0] < bbox[2] && bbox[1] < bbox[3], "bbox-Reihenfolge");
  });

  it("normalisiert features zu GeozoneFeatureInfo mit übersetzter Höhengrenze und Typ-Label", async () => {
    installFetch(async () => jsonResponse({
      features: [{
        id: "fr-1",
        properties: { limite: "50", remarque: "" },
        geometry: { type: "Polygon", coordinates: [[[2.0, 48.0], [2.1, 48.0], [2.1, 48.1], [2.0, 48.0]]] },
      }],
    }));
    const res = await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1);

    assert.equal(res.length, 1);
    assert.equal(res[0].layerLabel, "Drohnen-Beschränkungen (DGAC)");
    const expectedLabel = FR_ZONE_TYPES[classifyFrRestrictionType("50", "")].label;
    assert.equal(res[0].name, expectedLabel);
    assert.match(res[0].details, /Beschränkung: Maximale Flughöhe 50 m/);
    assert.ok(res[0].polygonRings && res[0].polygonRings.length === 1, "Polygon-Ring vorhanden");
  });

  it("übersetzt 'Vol interdit' und dedupliziert die 9 identischen Samples", async () => {
    installFetch(async () => jsonResponse({
      features: [{ id: "fr-2", properties: { limite: "Vol interdit", remarque: "" } }],
    }));
    const res = await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1);

    assert.equal(res.length, 1, "Dedup über alle Samples");
    assert.match(res[0].details, /Zonentyp: Sperrgebiet \(Flugverbot\)/);
    assert.match(res[0].details, /Beschränkung: Flugverbot/);
  });

  it("übersetzt die DGAC-Pflicht zur vorherigen Meldung vollständig", async () => {
    installFetch(async () => jsonResponse({
      features: [{
        id: "fr-notification",
        properties: {
          limite: "Vol interdit",
          remarque:
            "Notification préalable obligatoire pour les aéronefs de masse supérieure à 900g, " +
            "sans préjudice du respect des autres restrictions de survol applicables.",
        },
      }],
    }));
    const res = await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1);

    assert.equal(res.length, 1);
    assert.match(
      res[0].details,
      /Eine vorherige Meldung ist für Luftfahrzeuge mit einer Masse über 900 g verpflichtend/,
    );
    assert.doesNotMatch(res[0].details, /Notification préalable|aéronefs|survol applicables/);
  });

  it("übersetzt DGAC-Hinweise zu öffentlichem Raum und Plattform-Referenzhöhe", async () => {
    installFetch(async () => jsonResponse({
      features: [
        {
          id: "fr-public-space",
          properties: {
            limite: "Vol interdit",
            remarque:
              "Évolution interdite en espace public en agglomération sauf conformément à l'arrêté Espace.",
          },
        },
        {
          id: "fr-platform-altitude",
          properties: {
            limite: "100",
            remarque: "Altitude de référence de la plateforme : 168 m",
          },
        },
      ],
    }));
    const res = await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1);

    assert.equal(res.length, 2);
    assert.match(res[0].details, /Im öffentlichen Raum in geschlossenen Ortschaften ist der Betrieb verboten/);
    assert.match(res[0].details, /gemäß dem Erlass „Espace“/);
    assert.match(res[1].details, /Referenzhöhe der Plattform: 168 m/);
    assert.doesNotMatch(res[0].details, /espace public|agglomération|arrêté/);
    assert.doesNotMatch(res[1].details, /Altitude de référence/);
  });

  it("liefert [] bei non-ok Antwort", async () => {
    installFetch(async () => jsonResponse({ features: [{ id: "x", properties: { limite: "50" } }] }, false, 500));
    assert.deepEqual(await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1), []);
  });

  it("liefert [] bei json-Parsing-Fehler (malformed)", async () => {
    installFetch(async () => jsonThrows(true));
    assert.deepEqual(await queryFrWmsFeaturesFrom(FR_WMS_BASE, 48.8566, 2.3522, 1), []);
  });
});

// ===========================================================================
// LU – NOTAM-Aufbereitung der temporären UAS-Zonen
// ===========================================================================

// Baut einen text/plain-WMS-Block (geoportail.lu GetFeatureInfo) aus key:value.
function luBlock(props: Record<string, string>): string {
  return Object.entries(props).map(([k, v]) => `${k} : ${v}`).join("\n");
}

// Ein vollständiger temporärer (aktivierbarer) Zonen-Datensatz.
const LU_TEMP_PROPS: Record<string, string> = {
  "Zone Identifier": "LU-TSA01",
  "Description": "Aérodrome de Test",
  "Activity": "active",
  "Lower limit (meter)": "0",
  "Upper limit (meter)": "120",
  "Start date and time": "15/07/2026 08:00",
  "End date and time": "15/07/2026 18:00",
  "Nature of proctection": "MILITARY",
  "Responsability": "Police",
  "Duration of previsualisation (hours)": "24",
  "Remarks": "Vol interdit",
};

describe("isLuZonePermanent", () => {
  it("erkennt Activity=permanent als dauerhaft", () => {
    assert.equal(isLuZonePermanent({ Activity: "permanent" }), true);
    assert.equal(isLuZonePermanent({ Activity: "PERMANENT" }), true);
  });

  it("erkennt eine über ein Jahr laufende Zone als dauerhaft", () => {
    assert.equal(isLuZonePermanent({
      "Start date and time": "01/01/2020 00:00",
      "End date and time": "01/01/2026 00:00",
    }), true);
  });

  it("erkennt eine seit über einem Jahr aktive Zone ohne Enddatum als dauerhaft", () => {
    assert.equal(isLuZonePermanent({ "Start date and time": "01/01/2000 00:00" }), true);
  });

  it("behandelt eine kurze aktivierbare Zone als NICHT dauerhaft", () => {
    assert.equal(isLuZonePermanent(LU_TEMP_PROPS), false);
  });

  it("behandelt eine leere Zone als NICHT dauerhaft", () => {
    assert.equal(isLuZonePermanent({}), false);
  });
});

describe("buildLuNotamFromWms", () => {
  it("liefert null ohne Zone Identifier", () => {
    assert.equal(buildLuNotamFromWms({ Description: "X" }), null);
  });

  it("liefert null für dauerhafte Zonen (kein NOTAM)", () => {
    assert.equal(buildLuNotamFromWms({ "Zone Identifier": "LU-P1", Activity: "permanent" }), null);
  });

  it("baut ein NOTAM mit deutschem Freitext, Datumsformat und Höhengrenzen", () => {
    const n = buildLuNotamFromWms(LU_TEMP_PROPS);
    assert.ok(n, "NOTAM erwartet");
    assert.equal(n!.series, "LU-TSA");
    assert.equal(n!.type, "N");
    assert.equal(n!.fir, "ELLX");
    assert.deepEqual(n!.itema, ["LU-TSA01"]);
    assert.equal(n!.nom_zone, "LU-TSA01-0-120");
    assert.equal(n!.itemf, "0 M AGL");
    assert.equal(n!.itemg, "120 M AGL");
    assert.ok(n!.startvalidity > 0 && n!.endvalidity > n!.startvalidity, "Validity-Zeitstempel");

    // Freitext (iteme) ist Deutsch + korrekt formatiert.
    assert.match(n!.iteme, /\(LU-TSA01\)/);
    assert.match(n!.iteme, /Art: Militär/);
    assert.match(n!.iteme, /Status: Aktiv/);
    assert.match(n!.iteme, /Zuständigkeit: Police/);
    assert.match(n!.iteme, /Höhe: 0 – 120 m/);
    assert.match(n!.iteme, /Von: 15\.07\.2026, 08:00/);
    assert.match(n!.iteme, /Bis: 15\.07\.2026, 18:00/);
    assert.match(n!.iteme, /Vorankündigung: 24 Std\./);
    // Beschreibung wird FR->DE übersetzt (Aérodrome -> Flugplatz).
    assert.match(n!.iteme, /Flugplatz/);
    // Keine Obergrenze -> itemg entfällt, Höhe zeigt "?".
    const noMax = buildLuNotamFromWms({ ...LU_TEMP_PROPS, "Upper limit (meter)": "" });
    assert.equal(noMax!.itemg, undefined);
    assert.match(noMax!.iteme, /Höhe: 0 – \? m/);
  });
});

describe("fetchLuTsaAsNotams", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("parst den WMS-Block zu NOTAMs und dedupliziert identische Zonen", async () => {
    // Zwei identische Zonen-Blöcke -> Dedup über nom_zone auf genau 1.
    installFetch(async () => textResponse(`${luBlock(LU_TEMP_PROPS)}\n\n${luBlock(LU_TEMP_PROPS)}`));
    const res = await fetchLuTsaAsNotams(49.6116, 6.1319, 1);
    assert.equal(urls.length, 1, "queryLuWmsFeatureInfo feuert genau 1 Request");
    assert.equal(res.length, 1);
    assert.equal(res[0].nom_zone, "LU-TSA01-0-120");
    assert.match(res[0].iteme, /Status: Aktiv/);
  });

  it("filtert dauerhafte Zonen heraus (kein NOTAM)", async () => {
    installFetch(async () => textResponse(luBlock({ "Zone Identifier": "LU-P1", Activity: "permanent" })));
    assert.deepEqual(await fetchLuTsaAsNotams(49.6116, 6.1319, 1), []);
  });

  it("liefert [] bei non-ok Antwort", async () => {
    installFetch(async () => textResponse(luBlock(LU_TEMP_PROPS), false, 500));
    assert.deepEqual(await fetchLuTsaAsNotams(49.6116, 6.1319, 1), []);
  });

  it("liefert [] bei 'no features were found' (leer/malformed)", async () => {
    installFetch(async () => textResponse("no features were found"));
    assert.deepEqual(await fetchLuTsaAsNotams(49.6116, 6.1319, 1), []);
  });
});

describe("fetchAllLuZonesAsNotamsFrom", () => {
  beforeEach(() => { urls = []; });
  afterEach(() => { globalThis.fetch = realFetch; });

  const SCAN_POINTS: [number, number][] = [[49.60, 6.13], [49.75, 6.35]];

  it("aggregiert über alle Scan-Punkte, dedupliziert und schreibt in den Cache", async () => {
    installFetch(async () => textResponse(luBlock(LU_TEMP_PROPS)));
    let cacheKey = "";
    let cached: LuNotam[] | null = null;
    const res = await fetchAllLuZonesAsNotamsFrom(SCAN_POINTS, {
      setCache: async (key, data) => { cacheKey = key; cached = data; },
      getCached: async () => null,
    });

    assert.equal(urls.length, 2, "1 Request pro Scan-Punkt");
    assert.equal(res.length, 1, "selbe Zone an beiden Punkten -> dedup");
    assert.equal(res[0].nom_zone, "LU-TSA01-0-120");
    assert.equal(cacheKey, "lu_zones_all");
    assert.ok(cached && (cached as LuNotam[]).length === 1, "Cache befüllt");
  });

  it("liefert [] ohne Treffer und schreibt NICHT in den Cache", async () => {
    installFetch(async () => textResponse("no features were found"));
    let setCalled = false;
    const res = await fetchAllLuZonesAsNotamsFrom(SCAN_POINTS, {
      setCache: async () => { setCalled = true; },
      getCached: async () => null,
    });
    assert.deepEqual(res, []);
    assert.equal(setCalled, false, "leeres Ergebnis darf nichts cachen");
  });

  it("fällt bei Schreibfehler auf den Cache zurück", async () => {
    installFetch(async () => textResponse(luBlock(LU_TEMP_PROPS)));
    const fallback: LuNotam[] = [{
      id: -1, series: "LU-TSA", number: 0, type: "N", itema: ["CACHED"],
      iteme: "Cache-Eintrag", startvalidity: 0, endvalidity: 0, fir: "ELLX", nom_zone: "CACHED-0-0",
    }];
    const res = await fetchAllLuZonesAsNotamsFrom(SCAN_POINTS, {
      setCache: () => { throw new Error("cache write failed"); },
      getCached: async () => ({ data: fallback }),
    });
    assert.deepEqual(res, fallback);
  });
});
