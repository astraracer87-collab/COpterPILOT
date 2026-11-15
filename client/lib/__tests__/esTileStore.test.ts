// Spanien (ENAIRE insignias-MapServer) als Kachelspeicher-Land: Layer-Katalog,
// URLs (volle Präzision), Download mit ArcGIS-Paging inkl. gekappter Seiten,
// abwählbare Teile (infra/enp), NOTAM live/offline, Live-Pfad ohne Paket und
// Registry. Echte Attribute aus fixtures/enaire_aero_layer0_sample.geojson
// (Layer 0 = Flugplatz-Bezugspunkte; Zonen-Layer-Felder nicht als Fixture
// vorhanden – siehe shared/spanishGeozones.ts).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ES_INSIGNIAS_LAYERS,
  esInsigniasBboxUrl,
  esInsigniasCount,
  esInsigniasCountUrl,
  esInsigniasLayer,
  esInsigniasPageUrl,
  esInsigniasToEd318Props,
  esNotamDateIso,
  normalizeEnaireInsigniasFeature,
  tagEsInsigniasFeature,
} from "../../../shared/spanishGeozones";
import {
  __setTileStoreEnvForTests,
  downloadTileStore,
  getEsTempStatus,
  getTilePartMeta,
  hasTiledGeozones,
  loadTileStoreMeta,
  queryTiledGeozones,
  queryTiledGeozonesAtPoint,
  tileStoreVersionCheck,
} from "../geozoneTiles/tileStore";
import { TILE_STORE_ISOS, TILE_STORE_OPTIONAL_PARTS, bboxAround, isTileStoreIso, tileStorePartsOf } from "../geozoneTiles/tileStoreCore";
import { __setEsLiveFetchForTests, esLiveLayers, queryEsLiveZones } from "../geozoneTiles/esLive";
import { esZoneFromStored } from "../geozoneTiles/tileZones";
import { getGeozoneSourceMeta, temporarySourceOf, isLargeGeozoneDataset } from "../../../shared/geozoneSourceMeta";
import { buildCountryGeozoneConfigs, getGeozoneSource, getSourceDataStatus } from "../geozoneSources/registry";
import { ED269_FETCHERS, isEd269DirectCountry } from "../geozoneDirect/ed269Sources";
import { hasOwnMap } from "../../../shared/countryDetection";
import { createNodeTileFs } from "./helpers/nodeTileFs";

const FIX = path.join(__dirname, "fixtures");
const layer0 = JSON.parse(nodeFs.readFileSync(path.join(FIX, "enaire_aero_layer0_sample.geojson"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");

const square = (lon: number, lat: number, d = 0.05) => ({
  type: "Polygon",
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});

// Zone aus ECHTEN Layer-0-Attributen (La Palma) mit Fläche – Feldnamen der insignias-Layer
const realPropsZone = (oid: number, lon: number, lat: number, extra: Record<string, any> = {}) => ({
  type: "Feature",
  id: oid,
  geometry: square(lon, lat),
  properties: { ...layer0.features[1].properties, OBJECTID: oid, ...extra },
});

describe("ES – Layer-Katalog und URLs", () => {
  it("Layer laut Doku (Aero 1,2,3,4,6,10 + Urbano 11 | Infra 11 | ENP 0,1 | NOTAM 1), Layer 0 nur Punkte", () => {
    const ids = (part: string) => ES_INSIGNIAS_LAYERS.filter((l) => l.part === part).map((l) => `${l.service}/${l.layerId}`);
    assert.deepEqual(ids("base"), [
      "NSF/Drones_ZG_Aero_V3/1", "NSF/Drones_ZG_Aero_V3/2", "NSF/Drones_ZG_Aero_V3/3", "NSF/Drones_ZG_Aero_V3/4",
      "NSF/Drones_ZG_Aero_V3/6", "NSF/Drones_ZG_Aero_V3/10", "NSF/Drones_ZG_Urbano_V0/11",
    ]);
    assert.deepEqual(ids("infra"), ["NSF/Drones_ZG_Infra_V0/11"]);
    assert.deepEqual(ids("enp"), ["ENP/ENP_APP_Local_V4/0", "ENP/ENP_APP_Local_V4/1"]);
    assert.deepEqual(ids("temp"), ["NOTAM/NOTAM_UAS_APP_V3/1"]);
    // Fixture Layer 0: nur Bezugspunkte → keine Zonen
    assert.ok(layer0.features.every((f: any) => f.geometry.type === "Point"));
    assert.ok(layer0.features.every((f: any) => tagEsInsigniasFeature(f, "es_aerodromos") === null));
  });

  it("Seiten-URL ohne Vereinfachung (kein maxAllowableOffset/geometryPrecision), Zähl- und bbox-URL", () => {
    const l = esInsigniasLayer("es_infra")!;
    const u = new URL(esInsigniasPageUrl(l, 400, 200));
    assert.equal(u.origin + u.pathname, "https://servais.enaire.es/insignias/rest/services/NSF/Drones_ZG_Infra_V0/MapServer/11/query");
    assert.equal(u.searchParams.get("f"), "geojson");
    assert.equal(u.searchParams.get("outSR"), "4326");
    assert.equal(u.searchParams.get("returnGeometry"), "true");
    assert.equal(u.searchParams.get("resultOffset"), "400");
    assert.equal(u.searchParams.get("resultRecordCount"), "200");
    assert.equal(u.searchParams.get("maxAllowableOffset"), null);
    assert.equal(u.searchParams.get("geometryPrecision"), null);
    assert.equal(new URL(esInsigniasCountUrl(l)).searchParams.get("returnCountOnly"), "true");
    const b = new URL(esInsigniasBboxUrl(l, [-3.8, 40.3, -3.6, 40.5]));
    assert.equal(b.searchParams.get("geometry"), "-3.8,40.3,-3.6,40.5");
    assert.equal(b.searchParams.get("geometryType"), "esriGeometryEnvelope");
    assert.equal(b.searchParams.get("spatialRel"), "esriSpatialRelIntersects");
    assert.equal(esInsigniasCount({ count: 14163 }), 14163);
    assert.throws(() => esInsigniasCount({ error: { code: 400, message: "x" } }), /ArcGIS-Fehler 400/);
  });
});

describe("ES – Feldzuordnung insignias → ED-318 → App", () => {
  it("echte Layer-0-Felder: NAME_TXT, IDENT_TXT, REMARKS_TXT; RESTRICCION_LOWER/UPPER; NOTAM-Zeiten", () => {
    const p = esInsigniasToEd318Props({ ...layer0.features[1].properties, RESTRICCION_LOWER: 0, RESTRICCION_UPPER: 120 });
    assert.equal(p.Name, "LA PALMA");
    assert.equal(p.Identifier, "GCLA");
    assert.match(p.Message, /^Tráfico de Aviación General/);
    assert.equal(p.Lower, 0);
    assert.equal(p.Upper, 120);
    assert.equal(esNotamDateIso("2611010000"), "2026-11-01T00:00:00.000Z");
    assert.equal(esNotamDateIso("2613010000"), null);
  });

  it("Layer-Defaults: Flugplätze Genehmigung, Urbano Auflagen, ENP Naturschutz, NOTAM Freigabe + temporär", () => {
    const mk = (key: string) => normalizeEnaireInsigniasFeature(tagEsInsigniasFeature(realPropsZone(7, -17.76, 28.62, { RESTRICCION_LOWER: 0, RESTRICCION_UPPER: 120 }), key), NOW)!;
    const ad = mk("es_aerodromos").properties;
    assert.equal(ad.restriction, "REQ_AUTHORISATION");
    assert.equal(ad.zoneId, "ES-es_aerodromos.7");
    assert.equal(ad.upperMeters, 120);
    assert.match(ad.message, /^ENAIRE-Ebene: Flugplätze\n\nFlug nur mit Genehmigung\./);
    assert.equal(mk("es_urbano").properties.restriction, "CONDITIONAL");
    const enp = mk("es_enp0").properties;
    assert.equal(enp.restriction, "NATURE");
    assert.match(enp.message, /Naturschutzgebiet \(Espacio Natural Protegido\)/);
    assert.doesNotMatch(enp.message, /Flug nur mit Genehmigung\./);
    const n = mk("es_notam").properties;
    assert.equal(n.restriction, "RESTRICTED");
    assert.equal(n.isNotam, true);
    // expliziter ED-318-Typ hat Vorrang vor dem Layer-Default
    const typed = normalizeEnaireInsigniasFeature(tagEsInsigniasFeature(realPropsZone(8, -17.76, 28.62, { Type: "PROHIBITED" }), "es_enp0"), NOW)!;
    assert.equal(typed.properties.restriction, "PROHIBITED");
    assert.equal(typed.properties.restrictionAssumed, undefined);
  });

  it("App-Zone: Ebene je ENAIRE-Layer, © ENAIRE, Polygon", () => {
    const z = esZoneFromStored(tagEsInsigniasFeature(realPropsZone(9, -17.76, 28.62), "es_infra"), NOW)!;
    assert.equal(z.layerLabel, "ENAIRE – Infrastruktur");
    assert.equal(z.country, "ES");
    assert.equal(z.restriction, "REQ_AUTHORISATION");
    assert.match(z.details, /© ENAIRE – AIS/);
  });
});

// ---------------------------------------------------------------------------
// Download (gemockter ArcGIS-Server)
// ---------------------------------------------------------------------------

let dir = "";
let offline = false;
let failAll = false;
let calls: string[] = [];
const SERVER_CAP = 2; // Server liefert höchstens 2 je Seite (exceededTransferLimit)

const DATA: Record<string, any[]> = {
  "NSF/Drones_ZG_Aero_V3/6": [
    realPropsZone(1, -3.6, 40.45, { RESTRICCION_LOWER: 0, RESTRICCION_UPPER: 120 }),
    realPropsZone(2, -3.9, 40.2),
    realPropsZone(3, 2.0, 41.3),
    { type: "Feature", id: 4, geometry: { type: "Point", coordinates: [-3.6, 40.4] }, properties: { OBJECTID: 4 } },
  ],
  "NSF/Drones_ZG_Aero_V3/10": [realPropsZone(1, -3.62, 40.46, { Type: "PROHIBITED" })],
  "NSF/Drones_ZG_Urbano_V0/11": [realPropsZone(1, -3.61, 40.44)],
  "NSF/Drones_ZG_Infra_V0/11": [realPropsZone(1, -3.605, 40.455), realPropsZone(2, -5.9, 37.4)],
  "ENP/ENP_APP_Local_V4/0": [realPropsZone(1, -3.6, 40.45)],
  "NOTAM/NOTAM_UAS_APP_V3/1": [
    realPropsZone(1, -3.6, 40.45, { ITEMB: "2611010000", ITEMC: "2612010000", ITEME: "ZONA RESTRINGIDA TEMPORAL UAS" }),
    realPropsZone(2, -3.6, 40.45, { ITEMB: "2501010000", ITEMC: "2502010000" }), // abgelaufen
  ],
};

function jsonResponse(data: any) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as any;
}

const fakeFetch = (async (input: any) => {
  const url = String(input);
  calls.push(url);
  if (failAll) throw new Error("offline");
  const u = new URL(url);
  const m = u.pathname.match(/\/insignias\/rest\/services\/(.+)\/MapServer\/(\d+)\/query$/);
  if (!m) return { ok: false, status: 404, json: async () => ({}) } as any;
  const feats = DATA[`${m[1]}/${m[2]}`] ?? [];
  if (u.searchParams.get("returnCountOnly") === "true") return jsonResponse({ count: feats.length });
  let list = feats;
  const g = u.searchParams.get("geometry");
  if (g) {
    const [w, s, e, n] = g.split(",").map(Number);
    list = feats.filter((f) => {
      const c = f.geometry.type === "Point" ? f.geometry.coordinates : f.geometry.coordinates[0][0];
      return c[0] >= w - 0.1 && c[0] <= e && c[1] >= s - 0.1 && c[1] <= n;
    });
  }
  const off = Number(u.searchParams.get("resultOffset") || 0);
  const cnt = Number(u.searchParams.get("resultRecordCount") || 1000);
  const page = list.slice(off, off + Math.min(cnt, SERVER_CAP));
  const exceeded = off + page.length < list.length && page.length < cnt ? true : off + page.length < list.length;
  return jsonResponse({ type: "FeatureCollection", features: page, ...(exceeded ? { exceededTransferLimit: true } : {}) });
}) as typeof fetch;

beforeEach(() => {
  dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "es-tilestore-"));
  offline = false;
  failAll = false;
  calls = [];
  __setTileStoreEnvForTests({
    fs: createNodeTileFs(dir, fakeFetch),
    isOffline: () => offline,
    isWifi: async () => true,
    fetch: fakeFetch,
    retryDelaysMs: [1, 1, 1],
  });
  __setEsLiveFetchForTests(async (url: string) => (await fakeFetch(url)).json());
});

afterEach(() => {
  __setTileStoreEnvForTests(null);
  __setEsLiveFetchForTests(null);
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

describe("ES – Kachelspeicher", () => {
  it("lädt base + infra (enp abgewählt) vollständig trotz gekappter Seiten, Punkte entfallen", async () => {
    const res = await downloadTileStore("ES", { parts: ["infra"] });
    assert.deepEqual(res.map((r) => [r.part, r.state]), [["base", "complete"], ["infra", "complete"]]);
    assert.equal(hasTiledGeozones("ES"), true);
    assert.equal(getTilePartMeta("ES", "base")!.count, 5); // 3 Flugplätze + 1 Sperrgebiet + 1 Urbano (Punkt verworfen)
    assert.equal(getTilePartMeta("ES", "infra")!.count, 2);
    assert.equal(getTilePartMeta("ES", "enp"), null);
    assert.equal(getTilePartMeta("ES", "base")!.source?.service, "enaire-insignias");
    // gekappte Seiten: innerhalb eines Auftrags weitergeblättert
    assert.ok(calls.some((c) => c.includes("Aero_V3/MapServer/6/query") && c.includes("resultOffset=2")));
    assert.ok(calls.every((c) => !c.includes("maxAllowableOffset")));
  });

  it("Abfrage: base + infra + NOTAM (live), abgelaufene NOTAM entfallen; offline letzter NOTAM-Stand", async () => {
    await downloadTileStore("ES", { parts: ["infra", "enp"] });
    const zones = (await queryTiledGeozones("ES", bboxAround(40.47, -3.58, 3)))!;
    const labels = zones.map((z) => z.layerLabel).sort();
    assert.deepEqual(labels, [
      "ENAIRE – Flugplätze",
      "ENAIRE – Infrastruktur",
      "ENAIRE – NOTAM – Beschränkung",
      "ENAIRE – Naturschutz (ENP)",
      "ENAIRE – Sperr-/Beschränkungsgebiete",
      "ENAIRE – Urbane Zonen",
    ]);
    assert.equal(zones.find((z) => z.layerLabel === "ENAIRE – Sperr-/Beschränkungsgebiete")!.restriction, "PROHIBITED");
    assert.equal(zones.find((z) => z.layerLabel === "ENAIRE – Naturschutz (ENP)")!.restriction, "NATURE");
    const notam = zones.find((z) => z.layerLabel === "ENAIRE – NOTAM – Beschränkung")!;
    assert.equal(notam.notamEligible, true);
    assert.equal(notam.validEndTs, Date.UTC(2026, 11, 1));
    assert.ok(getEsTempStatus().fetchedAt != null);

    // offline: neuer Prozess-Zustand, NOTAM aus es/temp.json
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => true, isWifi: async () => false, fetch: fakeFetch, retryDelaysMs: [1] });
    failAll = true;
    await loadTileStoreMeta();
    const off = (await queryTiledGeozones("ES", bboxAround(40.47, -3.58, 3)))!;
    assert.equal(off.length, zones.length);
    const atPoint = (await queryTiledGeozonesAtPoint("ES", 40.47, -3.575))!;
    assert.ok(atPoint.length >= 4);
  });

  it("abgewählter Teil wird beim nächsten Speichern gelöscht; AIRAC-Versionsprüfung", async () => {
    await downloadTileStore("ES", { parts: ["infra", "enp"] });
    assert.ok(getTilePartMeta("ES", "enp"));
    await downloadTileStore("ES", { parts: ["infra"] });
    assert.equal(getTilePartMeta("ES", "enp"), null);
    const created = getTilePartMeta("ES", "base")!.createdAt;
    const check = await tileStoreVersionCheck("ES", created + 29 * 86_400_000);
    assert.equal(check.due, true);
  });

  it("Live-Pfad ohne Paket: bbox-Abfragen aller Teile, Cache, Teilfehler", async () => {
    assert.equal(esLiveLayers().length, 10);
    const r = await queryEsLiveZones(bboxAround(40.47, -3.58, 3), ["base", "infra", "enp"], NOW.getTime());
    assert.equal(r.failedLayers.length, 0);
    assert.ok(r.zones.some((z) => z.layerLabel === "ENAIRE – Naturschutz (ENP)"));
    assert.ok(r.zones.every((z) => !/NOTAM/.test(z.layerLabel)));
    const n = calls.length;
    await queryEsLiveZones(bboxAround(40.47, -3.58, 3), ["base", "infra", "enp"], NOW.getTime() + 60_000);
    assert.equal(calls.length, n, "aus dem 10-min-Cache");
    __setEsLiveFetchForTests(async () => {
      throw new Error("WAF 403");
    });
    await assert.rejects(queryEsLiveZones(bboxAround(40.47, -3.58, 3), ["base"], NOW.getTime()), /WAF 403/);
  });
});

describe("ES – Registry & Offline-Teile", () => {
  it("Kachelspeicher-Land mit Live-Abfrage, temporäre Zonen separat, kein ED-269-Abruf", () => {
    const m = getGeozoneSourceMeta("ES")!;
    assert.equal(m.kind, "tiled");
    assert.equal(m.offline, "tile-store");
    assert.equal(m.liveVectorQuery, true);
    assert.equal(temporarySourceOf("ES"), "separate");
    assert.equal(isLargeGeozoneDataset("ES"), true);
    assert.equal(buildCountryGeozoneConfigs().ES.featureInfoType, "ed269-cached");
    assert.equal(ED269_FETCHERS.ES, undefined);
    assert.equal(isEd269DirectCountry("es"), false);
    assert.equal(hasOwnMap("ES"), true);
    assert.ok(TILE_STORE_ISOS.includes("ES") && isTileStoreIso("es"));
    assert.deepEqual(tileStorePartsOf("ES"), ["base", "infra", "enp"]);
    assert.deepEqual(TILE_STORE_OPTIONAL_PARTS.DE, ["wohn"]);
    assert.equal(getGeozoneSource("ES")!.tileAttribution?.label, "© ENAIRE – AIS");
  });

  it("Datenstand: Paket + eigener NOTAM-Stand", async () => {
    await downloadTileStore("ES", {});
    await queryTiledGeozones("ES", bboxAround(40.47, -3.58, 3));
    const st = getSourceDataStatus("ES");
    assert.equal(st.kind, "tiled");
    assert.ok(st.fetchedAt != null);
    assert.ok(st.temporaryFetchedAt != null);
    assert.equal(st.temporaryStale, false);
  });
});
