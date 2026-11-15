// Spanien (ENAIRE): NOTAM für UAS (Zeitfilter, Zeitplan itemD, Höhen aus
// itemF/itemG, Kategorien, Kreise, MultiPolygon, kein Geometrie-Dedupe,
// statische Aktivierungen) und dynamische Dienstauflösung über die Web Map
// (Titel → URL, 404 → neu lesen, Teilausfall → „partial“).
//
// Fixtures HANDGEBAUT (nicht live abgerufen, siehe _comment in den Dateien):
//  - fixtures/es-enaire-notam-handbuilt.geojson nach docs/enaire-es-notam-integration.md §4/§7
//  - fixtures/es-enaire-webmap-handbuilt.json nach docs/enaire-es-api-integration.md „Anhang ES (2)“
// sowie die echte Layer-0-Fixture enaire_aero_layer0_sample.geojson (Attribute).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ES_INSIGNIAS_LAYERS,
  ES_WEBMAP_DATA_URL,
  esInsigniasLayerUrl,
  esLayerForTitle,
  normalizeEnaireInsigniasFeature,
  resolveEsLayersFromWebmap,
  tagEsInsigniasFeature,
} from "../../../shared/spanishGeozones";
import {
  ES_NOTAM_COLORS,
  ES_NOTAM_DISCLAIMER_DE,
  esNotamCategory,
  esNotamFixCircleGeometry,
  esNotamRestriction,
  esNotamTs,
  esNotamValidity,
  parseEsNotamHeight,
  parseEsNotamSchedule,
} from "../../../shared/spanishNotams";
import { zoneActivityAt } from "../../../shared/ed269Restriction";
import { distanceM } from "../../../shared/geozoneKit/aixm";
import { collapseStackedTempZonesForMap } from "../../../shared/geozoneTemporary";
import { esZoneFromStored } from "../geozoneTiles/tileZones";
import {
  __setTileStoreEnvForTests,
  annotateEsStaticActivations,
  downloadTileStore,
  esPartialNote,
  getEsTempFeatures,
  getTilePartMeta,
  queryTiledGeozones,
  tileStoreVersionCheck,
} from "../geozoneTiles/tileStore";
import { bboxAround } from "../geozoneTiles/tileStoreCore";
import { __resetEsServicesForTests, isEsNotFoundError, resolveEsLayers, withEsLayer } from "../geozoneTiles/esServices";
import { __setEsLiveFetchForTests, queryEsLiveZones } from "../geozoneTiles/esLive";
import { createNodeTileFs } from "./helpers/nodeTileFs";

const FIX = path.join(__dirname, "fixtures");
const json = (f: string) => JSON.parse(nodeFs.readFileSync(path.join(FIX, f), "utf8"));
const notamFc = json("es-enaire-notam-handbuilt.geojson");
const webmap = json("es-enaire-webmap-handbuilt.json");
const layer0 = json("enaire_aero_layer0_sample.geojson");
const NOW = new Date("2026-11-15T12:00:00Z"); // Sonntag
const byId = (id: string) => notamFc.features.find((f: any) => f.properties.notamId === id);
const norm = (id: string, now = NOW) => normalizeEnaireInsigniasFeature(tagEsInsigniasFeature(byId(id), "es_notam"), now);
const at = (iso: string) => new Date(iso);
const act = (applicability: any[], iso: string, extra: Record<string, any> = {}) => zoneActivityAt({ ed269Applicability: applicability, ...extra }, at(iso));

// ---------------------------------------------------------------------------
// Web Map → Layer-URLs
// ---------------------------------------------------------------------------

describe("ES – Dienstnamen aus der Web Map", () => {
  it("Titel → URL (Akzente/Schreibweise egal), Dienst mit Unterebenen, Rückfall, nur servais-Hosts", () => {
    const r = resolveEsLayersFromWebmap(webmap);
    const url = (k: string) => esInsigniasLayerUrl(r.layers.find((l) => l.key === k)!);
    const base = "https://servais.enaire.es/insignias/rest/services";
    assert.equal(url("es_eac_fiz"), `${base}/NSF/Drones_ZG_Aero_V4/MapServer/1`);
    assert.equal(url("es_aerodromos"), `${base}/NSF/Drones_ZG_Aero_V4/MapServer/7`, "ZG_Aeródromos (neu nummeriert), nicht AERODROMOS");
    assert.equal(url("es_aeromodelismo"), `${base}/NSF/Drones_ZG_Aero_V4/MapServer/4`, "Groß-/Kleinschreibung egal");
    assert.equal(url("es_restringidas"), `${base}/NSF/Drones_ZG_Aero_V4/MapServer/10`, "„ZG Restringidas“, http → https, ohne „/“");
    assert.equal(url("es_infra"), `${base}/NSF/Drones_ZG_Infra_V1/MapServer/11`);
    assert.equal(url("es_notam"), `${base}/NOTAM/NOTAM_UAS_APP_V4/MapServer/1`, "Unterebene „Áreas“ über den Dienst-Titel NOTAM");
    assert.equal(url("es_enp0"), `${base}/ENP/ENP_APP_Local_V5/MapServer/0`);
    assert.equal(url("es_enp1"), `${base}/ENP/ENP_APP_Local_V5/MapServer/1`, "ZEPA eigene Ebene");
    // Urbano nur über den Webseiten-Proxy → nicht übernommen, fester Pfad
    assert.deepEqual(r.fallback, ["es_urbano"]);
    assert.equal(url("es_urbano"), `${base}/NSF/Drones_ZG_Urbano_V0/MapServer/11`);
    assert.ok(r.unknown.includes("AERODROMOS"));
    assert.equal(esLayerForTitle("zg_aerodromos")?.key, "es_aerodromos");
    assert.equal(esLayerForTitle("AERODROMOS"), null);
    // Katalog unverändert (Rückfall)
    assert.equal(ES_INSIGNIAS_LAYERS.find((l) => l.key === "es_infra")!.url, undefined);
  });

  it("ZEPA mit gleichen Regeln wie ENP (Naturschutz), eigene Beschriftung", () => {
    const f = { type: "Feature", id: 5, geometry: { type: "Polygon", coordinates: [[[-3, 40], [-2.9, 40], [-2.9, 40.1], [-3, 40]]] }, properties: { ...layer0.features[1].properties, OBJECTID: 5 } };
    const z = normalizeEnaireInsigniasFeature(tagEsInsigniasFeature(f, "es_enp1"), NOW)!.properties;
    assert.equal(z.restriction, "NATURE");
    assert.equal(z.esLayerLabel, "Vogelschutzgebiet (ZEPA)");
    assert.match(z.message, /Vogelschutzgebiet \(ZEPA/);
    assert.match(z.legalBasis, /ZEPA/);
  });
});

// ---------------------------------------------------------------------------
// Zeiten + Zeitplan itemD
// ---------------------------------------------------------------------------

describe("ES-NOTAM – Zeiten und Zeitplan itemD (UTC)", () => {
  const B = Date.UTC(2026, 10, 1);
  const C = Date.UTC(2026, 10, 30, 23, 59);

  it("Zeitwerte: Unix-ms, ICAO yyMMddhhmm, itemBstr dd/mm/yyyy (UTC), 2050 = dauerhaft", () => {
    assert.equal(esNotamTs(1794700800000), 1794700800000);
    assert.equal(esNotamTs("2611150600"), Date.UTC(2026, 10, 15, 6));
    assert.equal(esNotamTs("15/11/2026 06:00:00"), Date.UTC(2026, 10, 15, 6), "itemBstr ist UTC, nie Ortszeit");
    const perm = esNotamValidity(byId("V00950/26").properties);
    assert.equal(perm.permanent, true);
    assert.equal(perm.end, null);
    // nur itemBstr/itemCstr vorhanden
    const s = esNotamValidity({ itemBstr: "01/11/2026 00:00:00", itemCstr: "02/11/2026 12:30:00" });
    assert.deepEqual([s.start, s.end], [Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 2, 12, 30)]);
  });

  it("nur Zeiten „0600-1400“ = täglich; „MON-FRI 0600-1400“ Wochentage", () => {
    const d = parseEsNotamSchedule("0600-1400", B, C)!;
    assert.deepEqual(d.applicability[0].schedule, [{ day: ["ANY"], startTime: "06:00Z", endTime: "14:00Z" }]);
    const w = parseEsNotamSchedule("MON-FRI 0600-1400", B, C)!;
    assert.deepEqual(w.applicability[0].schedule[0].day, ["MON", "TUE", "WED", "THU", "FRI"]);
    assert.equal(act(w.applicability, "2026-11-16T07:00:00Z"), "active"); // Montag
    assert.equal(act(w.applicability, "2026-11-15T07:00:00Z"), "inactive"); // Sonntag
    assert.equal(act(w.applicability, "2026-11-16T15:00:00Z"), "inactive");
    assert.match(w.textDe, /Mo–Fr 06:00–14:00 UTC/);
  });

  it("„SR-SS“ und „SR-2100“ über die SR/SS-Unterstützung von zoneActivityAt (je Ort)", () => {
    const ring: [number, number][] = [[40.4, -3.7], [40.41, -3.7], [40.41, -3.69], [40.4, -3.7]]; // Madrid [lat, lon]
    const ss = parseEsNotamSchedule("SR-SS", B, C)!;
    assert.deepEqual(ss.applicability[0].schedule, [{ day: ["ANY"], startTime: "SR", startEvent: "SR", endTime: "SS", endEvent: "SS" }]);
    assert.equal(act(ss.applicability, "2026-11-15T12:00:00Z", { polygonRings: [ring] }), "active");
    assert.equal(act(ss.applicability, "2026-11-15T02:00:00Z", { polygonRings: [ring] }), "inactive");
    const sr21 = parseEsNotamSchedule("SR-2100", B, C)!;
    assert.equal(sr21.applicability[0].schedule[0].endTime, "21:00Z");
    assert.equal(act(sr21.applicability, "2026-11-15T20:30:00Z", { polygonRings: [ring] }), "active");
    assert.equal(act(sr21.applicability, "2026-11-15T21:30:00Z", { polygonRings: [ring] }), "inactive");
    assert.match(ss.textDe, /Sonnenaufgang–Sonnenuntergang/);
  });

  it("Tage des Monats „03-05 12 17-19 24 2000-2359, 10-11 1900-2359“ → konkrete Fenster (2359 = Tagesende)", () => {
    const r = parseEsNotamSchedule("03-05 12 17-19 24 2000-2359, 10-11 1900-2359", B, C)!;
    assert.equal(r.applicability.length, 10);
    assert.equal(act(r.applicability, "2026-11-12T23:59:30Z"), "active");
    assert.equal(act(r.applicability, "2026-11-10T19:30:00Z"), "active", "10.11. nach dem Komma = November");
    assert.equal(act(r.applicability, "2026-11-12T19:30:00Z"), "inactive");
    assert.equal(act(r.applicability, "2026-11-06T21:00:00Z"), "inactive");
  });

  it("Monatsnamen über den Jahreswechsel (NOV → DEC → JAN), geteilte Nachtblöcke", () => {
    const b = Date.UTC(2026, 10, 14, 19);
    const c = Date.UTC(2027, 0, 3, 6);
    const r = parseEsNotamSchedule("NOV 14 1900-2359, NOV 15-17 0000-0600 1900-2359, DEC 30-31 1900-2359, JAN 01-03 0000-0600", b, c)!;
    assert.equal(r.applicability.length, 12);
    // Nacht 31.12./01.01.: 19:00–24:00 + 00:00–06:00
    assert.equal(act(r.applicability, "2026-12-31T23:30:00Z"), "active");
    assert.equal(act(r.applicability, "2027-01-01T03:00:00Z"), "active", "JAN = Folgejahr");
    assert.equal(act(r.applicability, "2027-01-01T12:00:00Z"), "inactive");
    assert.equal(act(r.applicability, "2026-11-16T03:00:00Z"), "active");
    assert.equal(act(r.applicability, "2026-11-16T12:00:00Z"), "inactive");
    assert.equal(act(r.applicability, "2026-12-15T21:00:00Z"), "inactive");
    // Monate OCT → NOV über Monatsgrenze
    const o = parseEsNotamSchedule("OCT 30-31 NOV 01-02 0800-1200", Date.UTC(2026, 9, 30), Date.UTC(2026, 10, 2, 12))!;
    assert.equal(o.applicability.length, 4);
    assert.equal(o.applicability[3].startDateTime, "2026-11-02T08:00:00.000Z");
  });

  it("über Mitternacht in einem Block „2200-0400“; Unlesbares (EXC, Freitext) → null", () => {
    const r = parseEsNotamSchedule("12 2200-0400", B, C)!;
    assert.equal(r.applicability[0].endDateTime, "2026-11-13T04:00:00.000Z");
    assert.equal(parseEsNotamSchedule("SR-2100 EXC SAT", B, C), null);
    assert.equal(parseEsNotamSchedule("AS PER AIP", B, C), null);
    assert.equal(parseEsNotamSchedule("31 1000-1200", Date.UTC(2026, 10, 1), Date.UTC(2026, 10, 30)), null, "31.11. gibt es nicht");
  });
});

// ---------------------------------------------------------------------------
// Normalisierung (Fixture)
// ---------------------------------------------------------------------------

describe("ES-NOTAM – Normalisierung (handgebaute Fixture)", () => {
  it("Schlüssel notamId, Status geplant/aktiv/nach Zeitplan inaktiv, 2050 dauerhaft, Abgelaufenes entfällt", () => {
    const t = tagEsInsigniasFeature(byId("V03255/26"), "es_notam");
    assert.equal(t.id, "es_notam.V03255/26");
    const tra = norm("V03255/26")!.properties;
    assert.equal(tra.esNotamStatus, "scheduled_inactive", "MON-FRI, Sonntag");
    assert.equal(tra.validStartTs, Date.UTC(2026, 10, 10, 6));
    assert.equal(tra.validEndTs, Date.UTC(2026, 10, 28, 14));
    const planned = norm("V03300/26")!.properties;
    assert.equal(planned.esNotamStatus, "planned");
    assert.match(planned.message, /Status: geplant – gilt ab 01\.12\.2026 00:00 UTC/);
    const perm = norm("V00950/26")!.properties;
    assert.equal(perm.validEndTs, undefined);
    assert.match(perm.message, /auf Weiteres \(Ende 2050/);
    assert.equal(perm.esNotamStatus, "active");
    assert.equal(norm("V03255/26", at("2026-11-29T00:00:00Z")), null, "itemC < jetzt");
    // Zeitplan unlesbar → aktiv im ganzen Zeitraum + Text
    const unparsed = norm("V03700/26")!.properties;
    assert.equal(unparsed.esNotamScheduleParsed, false);
    assert.match(unparsed.message, /SR-2100 EXC SAT – nicht maschinenlesbar, die Zone gilt vorsorglich im ganzen Gültigkeitszeitraum/);
  });

  it("Höhen nur aus itemF/itemG (nie LOWER_VAL/UPPER_VAL), alle Bezüge über shared/heights.ts", () => {
    assert.deepEqual(parseEsNotamHeight("00120M AGL"), { m: 120, ref: "AGL", text: "120 m AGL", unit: "m", value: 120 });
    assert.equal(parseEsNotamHeight("04300FT AMSL")!.ref, "MSL");
    assert.ok(Math.abs(parseEsNotamHeight("04300FT AMSL")!.m! - 1310.64) < 0.01);
    assert.equal(parseEsNotamHeight("FL 100")!.datum, "STD");
    assert.equal(parseEsNotamHeight("SFC")!.m, 0);
    assert.equal(parseEsNotamHeight("GND")!.text, "GND");
    assert.equal(parseEsNotamHeight("UNL")!.m, null);
    assert.equal(parseEsNotamHeight("00060FT AGL")!.ref, "AGL");
    const uas = norm("V01001/26")!.properties; // UPPER_VAL 400 (gerundete ft) – ignoriert
    assert.equal(uas.upperMeters, 120);
    assert.equal(uas.upperReference, "AGL");
    const mel = norm("V03600/26")!.properties; // 00100M AMSL, UPPER_VAL 400
    assert.equal(mel.upperMeters, 100);
    assert.equal(mel.upperReference, "MSL");
    const tsa = norm("V03400/26")!.properties; // FL050 Untergrenze
    assert.equal(tsa.lowerMeters, 1524);
    assert.equal(tsa.lowerReference, "MSL");
    assert.match(tsa.message, /Untergrenze über Meeresspiegel – ohne Geländehöhe vorsorglich/);
  });

  it("Kategorie/Farbe aus qcode; PROHIBITED nur bei klarem Verbotstext; FIR GMMM (Melilla) bleibt", () => {
    assert.equal(esNotamCategory("RTCA"), "restricted");
    assert.equal(esNotamCategory("WULW"), "uas_activity");
    assert.equal(esNotamCategory("WMLW"), "warning");
    assert.equal(esNotamRestriction("restricted", "TRA ACTIVATED."), "RESTRICTED");
    assert.equal(esNotamRestriction("restricted", "UAS FLIGHTS PROHIBITED."), "PROHIBITED");
    assert.equal(esNotamRestriction("warning", "UAS FLIGHTS PROHIBITED."), "CONDITIONAL");
    assert.equal(norm("V03400/26")!.properties.restriction, "PROHIBITED");
    assert.equal(norm("V03255/26")!.properties.restriction, "RESTRICTED");
    const uas = esZoneFromStored(tagEsInsigniasFeature(byId("V01001/26"), "es_notam"), NOW)!;
    assert.equal(uas.restriction, "CONDITIONAL");
    assert.equal(uas.layerLabel, "ENAIRE – NOTAM – UAS-Aktivität");
    assert.equal(uas.strokeColor, ES_NOTAM_COLORS.uas_activity.stroke);
    const mel = esZoneFromStored(tagEsInsigniasFeature(byId("V03600/26"), "es_notam"), NOW)!;
    assert.equal(mel.layerLabel, "ENAIRE – NOTAM – Warnung");
    assert.equal(mel.strokeColor, ES_NOTAM_COLORS.warning.stroke);
    assert.equal(mel.notamEligible, true);
    assert.match(mel.details, /FIR GMMM/);
  });

  it("Texte: itemE ohne Fernschreib-Layout, Originalblock = icaoFormatText, Hinweis ohne Gewähr, kein HTML", () => {
    const p = norm("V03255/26")!.properties;
    assert.match(p.message, /NOTAM-Text \(E\): TEMPORARY RESERVED AREA TRA TOTANA ACTIVATED\. UAS FLT NOT AFFECTED BY OTHER RESTRICTIONS\./);
    assert.match(p.message, /Originaltext der Behörde:\n\(V03255\/26 NOTAMN/);
    assert.ok(p.message.includes(ES_NOTAM_DISCLAIMER_DE));
    assert.doesNotMatch(p.message, /<b>|<br/);
    assert.equal(p.name, "TRA TOTANA (NOTAM V03255/26)");
    assert.equal(p.sourceNotam, "D5296/26");
  });

  it("Kreis (37 Punkte) aus „RADIUS OF 2KM CENTRED ON …“ fein neu erzeugt; ohne Text gepuffert", () => {
    const raw = byId("V01001/26");
    const t = tagEsInsigniasFeature(raw, "es_notam");
    assert.equal(t.properties._esCircle, "rebuilt");
    const ring = t.geometry.coordinates[0];
    assert.ok(ring.length > 100);
    const c: [number, number] = [-3.8, 43.4666667];
    // geodätisch (WGS84) erzeugt; Kugel-Abstand weicht ≤ 0,4 % ab
    for (const p of ring) assert.ok(Math.abs(distanceM(c, p) - 2000) < 10);
    // Mittelpunkt einer Sehne des Original-Polygons liegt jetzt innerhalb
    const fix = esNotamFixCircleGeometry(raw.geometry, ["NO RADIUS IN TEXT"]);
    assert.equal(fix.circle, "buffered");
    const buf = fix.geometry.coordinates[0];
    for (const p of buf.slice(0, -1)) assert.ok(distanceM(c, p) >= 2000 + 149);
    // Dreieck/Viereck bleibt unverändert
    const sq = byId("V03255/26").geometry;
    assert.equal(esNotamFixCircleGeometry(sq, ["RADIUS OF 2KM"]).circle, undefined);
  });

  it("MultiPolygon (zwei Dreiecke) bleibt erhalten; gleiche Geometrie wird NICHT dedupliziert", () => {
    const multi = esZoneFromStored(tagEsInsigniasFeature(byId("V03400/26"), "es_notam"), NOW)!;
    assert.equal(multi.polygonGroups?.length ?? multi.polygonRings?.length, 2);
    const a = esZoneFromStored(tagEsInsigniasFeature(byId("V03500/26"), "es_notam"), NOW)!;
    const b = esZoneFromStored(tagEsInsigniasFeature(byId("V03501/26"), "es_notam"), NOW)!;
    assert.notEqual(a.featureId, b.featureId);
    assert.equal(zoneActivityAt(a, NOW), "active");
    assert.equal(zoneActivityAt(b, NOW), "inactive");
    // Karte: nur die aktive zeichnen (nicht stapeln); Prüfungen behalten beide
    const drawn = collapseStackedTempZonesForMap([a, b], () => true, (z) => zoneActivityAt(z, NOW) !== "inactive");
    assert.deepEqual(drawn.map((z) => z.featureId), [a.featureId]);
    const later = new Date("2026-11-17T00:00:00Z");
    assert.equal(collapseStackedTempZonesForMap([a, b], () => true, (z) => zoneActivityAt(z, later) !== "inactive").length, 1, "keine aktiv → eine abgeschwächt");
  });

  it("statische Aktivierung: „Zone LED90A …“ an der festen Zone (IDENT_TXT), nur Ebene ZG_Restringidas", () => {
    const fixed = (key: string) =>
      esZoneFromStored(
        tagEsInsigniasFeature(
          { type: "Feature", id: 77, geometry: byId("V02002/26").geometry, properties: { ...layer0.features[1].properties, OBJECTID: 77, IDENT_TXT: "LED90A", NAME_TXT: "LED90A ALBACETE" } },
          key,
        ),
        NOW,
      )!;
    const restr = fixed("es_restringidas");
    assert.equal(restr.sourceIdent, "LED90A");
    const notams = notamFc.features.map((f: any) => tagEsInsigniasFeature(f, "es_notam"));
    const [annotated, other] = annotateEsStaticActivations([restr, fixed("es_aerodromos")], notams, NOW);
    assert.match(annotated.details, /^NOTAM V02002\/26: Zone LED90A ist aktiviert, derzeit laut Zeitplan nicht aktiv \(Höhe GND – FL100/);
    assert.doesNotMatch(other.details, /NOTAM V02002/);
    // aktive Aktivierung (LED120) → „ist jetzt aktiv“
    const led120 = { ...restr, sourceIdent: "LED120" };
    assert.match(annotateEsStaticActivations([led120], notams, NOW)[0].details, /NOTAM V03500\/26: Zone LED120 ist jetzt aktiv/);
    assert.match(annotateEsStaticActivations([led120], notams, NOW)[0].details, /NOTAM V03501\/26: Zone LED120 wird aktiviert ab 18\.11\.2026 08:00 UTC/);
    // die NOTAM-Zone selbst
    assert.equal(norm("V03500/26")!.properties.name, "LED120 – Aktivierung per NOTAM V03500/26");
    assert.match(norm("V03500/26")!.properties.message, /Zone LED120 ist jetzt aktiv/);
  });
});

// ---------------------------------------------------------------------------
// Abruf: Web Map, 404, Teilausfall, NOTAM in einem Request
// ---------------------------------------------------------------------------

const BASE = "https://servais.enaire.es/insignias/rest/services";
let dir = "";
let calls: string[] = [];
let served: Record<string, any> = {}; // Webmap-URL bzw. „<Dienst>/<id>“ → Features
let webmapBody: any = webmap;
let fail = new Set<string>(); // Pfade mit HTTP 500

const sqZone = (oid: number, lon: number, lat: number, extra: Record<string, any> = {}) => ({
  type: "Feature",
  id: oid,
  geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.05, lat], [lon + 0.05, lat + 0.05], [lon, lat + 0.05], [lon, lat]]] },
  properties: { ...layer0.features[1].properties, OBJECTID: oid, ...extra },
});

const fakeFetch = (async (input: any) => {
  const url = String(input);
  calls.push(url);
  const ok = (data: any) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }) as any;
  if (url === ES_WEBMAP_DATA_URL) return ok(webmapBody);
  const u = new URL(url);
  const m = u.pathname.match(/\/insignias\/rest\/services\/(.+\/MapServer\/\d+)\/query$/);
  if (!m || !(m[1] in served)) return { ok: false, status: 404, json: async () => ({}) } as any;
  if (fail.has(m[1])) return { ok: false, status: 500, json: async () => ({}) } as any;
  const feats = served[m[1]];
  if (u.searchParams.get("returnCountOnly") === "true") return ok({ count: feats.length });
  const off = Number(u.searchParams.get("resultOffset") || 0);
  const cnt = Number(u.searchParams.get("resultRecordCount") || 1000);
  return ok({ type: "FeatureCollection", features: feats.slice(off, off + cnt) });
}) as typeof fetch;

/** Fixture-Zeiten auf die echte Uhr verschieben (der Abruf filtert mit Date.now()). */
function shiftedNotams(): any[] {
  const shift = Date.now() - NOW.getTime();
  return notamFc.features.map((f: any) => {
    const p = { ...f.properties };
    for (const k of ["itemB", "itemC"]) if (typeof p[k] === "number" && new Date(p[k]).getUTCFullYear() < 2049) p[k] += shift;
    for (const k of ["itemBstr", "itemCstr", "itemBIcaro", "itemCIcaro"]) delete p[k];
    return { ...f, properties: p };
  });
}

function serveV4() {
  served = {
    "NSF/Drones_ZG_Aero_V4/MapServer/1": [sqZone(1, -3.6, 40.45)],
    "NSF/Drones_ZG_Aero_V4/MapServer/2": [],
    "NSF/Drones_ZG_Aero_V4/MapServer/3": [],
    "NSF/Drones_ZG_Aero_V4/MapServer/4": [],
    "NSF/Drones_ZG_Aero_V4/MapServer/7": [sqZone(1, -3.62, 40.46), sqZone(2, -3.9, 40.2)],
    "NSF/Drones_ZG_Aero_V4/MapServer/10": [sqZone(1, -2.1, 41.6, { IDENT_TXT: "LED120", NAME_TXT: "LED120 TORREJÓN" })],
    "NSF/Drones_ZG_Urbano_V0/MapServer/11": [sqZone(1, -3.61, 40.44)],
    "NOTAM/NOTAM_UAS_APP_V4/MapServer/1": [
      ...shiftedNotams(),
      // abgelaufen (Server entfernt so etwas normalerweise selbst)
      { ...byId("V03255/26"), properties: { ...byId("V03255/26").properties, notamId: "V00001/20", itemB: Date.UTC(2020, 0, 1), itemC: Date.UTC(2020, 0, 2) } },
    ],
  };
}

beforeEach(() => {
  dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "es-notam-"));
  calls = [];
  fail = new Set();
  webmapBody = webmap;
  serveV4();
  __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => false, isWifi: async () => true, fetch: fakeFetch, retryDelaysMs: [1, 1, 1] });
  __setEsLiveFetchForTests(async (url: string) => {
    const r = await fakeFetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
});

afterEach(() => {
  __setTileStoreEnvForTests(null);
  __setEsLiveFetchForTests(null);
  __resetEsServicesForTests();
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

describe("ES – Abruf mit dynamischen Dienstnamen", () => {
  it("Download nutzt die Web-Map-URLs (V4, Layer 7), Urbano über den festen Pfad", async () => {
    const res = await downloadTileStore("ES", {});
    assert.deepEqual(res.map((r) => r.state), ["complete"]);
    assert.equal(calls[0], ES_WEBMAP_DATA_URL);
    assert.ok(calls.some((c) => c.includes("Drones_ZG_Aero_V4/MapServer/7/query")));
    assert.ok(!calls.some((c) => c.includes("Drones_ZG_Aero_V3")));
    assert.ok(calls.some((c) => c.includes("Drones_ZG_Urbano_V0/MapServer/11/query")));
    assert.equal(getTilePartMeta("ES", "base")!.count, 5);
    assert.equal(getTilePartMeta("ES", "base")!.source?.failedLayers, undefined);
    assert.equal(esPartialNote(), null);
  });

  it("404 einer Layer-URL → Web Map einmal neu lesen und mit neuer URL wiederholen", async () => {
    // gemerkte Auflösung zeigt auf V4; ENAIRE stellt auf V5 um
    await resolveEsLayers(async (u) => (await fakeFetch(u)).json());
    served = Object.fromEntries(Object.entries(served).map(([k, v]) => [k.replace("NOTAM_UAS_APP_V4", "NOTAM_UAS_APP_V5"), v]));
    webmapBody = JSON.parse(JSON.stringify(webmap).replace(/NOTAM_UAS_APP_V4/g, "NOTAM_UAS_APP_V5"));
    const fj = async (u: string) => {
      const r = await fakeFetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    };
    const urls: string[] = [];
    const n = await withEsLayer("es_notam", fj, async (l) => {
      urls.push(esInsigniasLayerUrl(l));
      return (await fj(`${esInsigniasLayerUrl(l)}/query?f=geojson`)).features.length;
    });
    assert.equal(n, notamFc.features.length + 1);
    assert.deepEqual(urls, [`${BASE}/NOTAM/NOTAM_UAS_APP_V4/MapServer/1`, `${BASE}/NOTAM/NOTAM_UAS_APP_V5/MapServer/1`]);
    assert.equal(calls.filter((c) => c === ES_WEBMAP_DATA_URL).length, 2, "genau einmal neu gelesen");
    // bleibt es bei 404 → Fehler (kein Endlos-Lesen)
    await assert.rejects(withEsLayer("es_infra", fj, async (l) => fj(`${esInsigniasLayerUrl(l)}/query`)), /HTTP 404/);
    assert.equal(isEsNotFoundError(new Error("ArcGIS-Fehler 404: Service not found")), true);
  });

  it("Web Map nicht lesbar → feste Pfade (Rückfall)", async () => {
    webmapBody = { error: { code: 403, message: "forbidden" } };
    const r = await resolveEsLayers(async (u) => (await fakeFetch(u)).json(), { fresh: true });
    assert.equal(r.fromWebmap, false);
    assert.equal(esInsigniasLayerUrl(r.layers.find((l) => l.key === "es_notam")!), `${BASE}/NOTAM/NOTAM_UAS_APP_V3/MapServer/1`);
  });

  it("Teilausfall einer Ebene → Rest gespeichert, Ebene aus dem letzten Stand, Hinweis „partial“, Wiederholung nach 1 Tag", async () => {
    await downloadTileStore("ES", {});
    fail.add("NSF/Drones_ZG_Aero_V4/MapServer/7");
    const res = await downloadTileStore("ES", { force: true });
    assert.deepEqual(res.map((r) => r.state), ["complete"]);
    const meta = getTilePartMeta("ES", "base")!;
    assert.equal(meta.source?.failedLayers, "es_aerodromos");
    assert.equal(meta.source?.carriedLayers, "es_aerodromos");
    assert.equal(meta.count, 5, "Flugplätze aus dem letzten Stand übernommen");
    assert.match(esPartialNote()!, /ENAIRE: 1 Ebene\(n\) beim letzten Abruf nicht erreichbar \(Flugplätze\) – deren Zonen stammen aus dem letzten Stand/);
    assert.equal((await tileStoreVersionCheck("ES", meta.createdAt + 60_000)).due, false);
    assert.deepEqual(await tileStoreVersionCheck("ES", meta.createdAt + 25 * 3600_000), { due: true, reason: "es-partial" });
    // alle Ebenen aus → Fehler, alter Bestand bleibt
    for (const k of Object.keys(served)) fail.add(k);
    const bad = await downloadTileStore("ES", { force: true });
    assert.equal(bad[0].state, "error");
    assert.equal(getTilePartMeta("ES", "base")!.count, 5);
  });

  it("NOTAM: ein Request (resultRecordCount 3000, ohne Zeit-where), Abgelaufenes verworfen, Schlüssel notamId, Aktivierung an LED120", async () => {
    await downloadTileStore("ES", {});
    const feats = await getEsTempFeatures({ force: true });
    const nq = calls.filter((c) => c.includes("NOTAM_UAS_APP_V4/MapServer/1/query"));
    assert.equal(nq.length, 1);
    const q = new URL(nq[0]).searchParams;
    assert.equal(q.get("resultRecordCount"), "3000");
    assert.equal(q.get("where"), "1=1");
    assert.ok(feats.every((f) => f.id !== "es_notam.V00001/20"));
    assert.ok(feats.some((f) => f.id === "es_notam.V00950/26"), "dauerhaft (2050)");
    assert.ok(feats.some((f) => f.id === "es_notam.V03500/26") && feats.some((f) => f.id === "es_notam.V03501/26"), "gleiche Geometrie, beide behalten");
    const zones = (await queryTiledGeozones("ES", bboxAround(41.62, -2.07, 5)))!;
    const fixedZone = zones.find((z) => z.sourceIdent === "LED120")!;
    assert.match(fixedZone.details, /Zone LED120/);
    assert.ok(zones.filter((z) => /NOTAM V0350[01]\/26/.test(z.name)).length === 2);
  });

  it("Live-Pfad ohne Paket nutzt die Web-Map-URLs; fehlende Ebene → failedLayers", async () => {
    fail.add("NSF/Drones_ZG_Aero_V4/MapServer/1");
    const r = await queryEsLiveZones(bboxAround(40.47, -3.58, 3), ["base"], NOW.getTime());
    assert.deepEqual(r.failedLayers, ["es_eac_fiz"]);
    assert.ok(r.zones.some((z) => z.layerLabel === "ENAIRE – Flugplätze"));
    assert.ok(calls.some((c) => c.includes("Drones_ZG_Aero_V4/MapServer/7/query")));
  });
});
