// DK: NOTAM-Ebenen und An-/Abflugflächen von dronezoner.eu (nicht im
// Tagesexport). ECHTE Auszüge, abgerufen 2026-11-15 (Kilde: Trafikstyrelsen):
// Web Map 4d73b795… (nur id/title/url/layerType), awareness_notams (2 von 3),
// disabled_notams (2 von 53), Ind__og_udflyvningsplaner/188 (2 von 186).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DK_ARCGIS_BASE,
  DK_DISABLED_HORIZON_MS,
  DK_WEBMAP_DATA_URL,
  danishNotamLowerLimit,
  danishRawNotams,
  normalizeDanishLiveLayers,
  resolveDanishLiveLayers,
} from "../../../shared/danishGeozones";
import { zoneActivityAt } from "../../../shared/ed269Restriction";
import { isTemporaryGeozoneProps } from "../../../shared/geozoneTemporary";
import { fetchDanishLiveLayers } from "../geozoneDirect/ed269Sources";

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures/dk-dronezoner-live-sample.json"), "utf8"));
const NOW = Date.parse("2026-11-15T16:20:00Z");
const byLayer = () => ({
  awareness: fx.awareness.features,
  disabled: fx.disabled.features,
  corridors: fx.corridors.features,
  active: [],
  inactive: [],
});

describe("DK – Live-Ebenen aus der Web Map", () => {
  it("löst alle fünf Ebenen über die Web Map auf (Titel/Dienst)", () => {
    const r = resolveDanishLiveLayers(fx.webmap);
    assert.equal(r.awareness.url, `${DK_ARCGIS_BASE}/awareness_notams/FeatureServer/0`);
    assert.equal(r.disabled.url, `${DK_ARCGIS_BASE}/disabled_notams/FeatureServer/0`);
    assert.equal(r.corridors.url, `${DK_ARCGIS_BASE}/Ind__og_udflyvningsplaner/FeatureServer/188`);
    assert.ok(Object.values(r).every((x) => x.fromWebmap));
  });

  it("folgt einem umbenannten Dienst; ohne Web Map bekannte Pfade", () => {
    const wm = JSON.parse(JSON.stringify(fx.webmap));
    for (const l of wm.operationalLayers) if (l.title === "Ind_ og udflyvningsplaner") l.url = `${DK_ARCGIS_BASE}/Ind__og_udflyvningsplaner_2027/FeatureServer/12`;
    assert.equal(resolveDanishLiveLayers(wm).corridors.url, `${DK_ARCGIS_BASE}/Ind__og_udflyvningsplaner_2027/FeatureServer/12`);
    const none = resolveDanishLiveLayers(null);
    assert.equal(none.active.url, `${DK_ARCGIS_BASE}/active_notams/FeatureServer/0`);
    assert.equal(none.active.fromWebmap, false);
  });
});

describe("DK – NOTAMs und An-/Abflugflächen", () => {
  it("Achtungs-NOTAM: temporär, Fenster aus Start/Ende, Höhe, Roh-NOTAM im Original", () => {
    const out = normalizeDanishLiveLayers(byLayer(), NOW);
    const d = out.find((f) => f.properties!.name === "D0522/26")!;
    const p = d.properties!;
    assert.equal(p.restriction, "CONDITIONAL");
    assert.equal(p.isNotam, true);
    assert.equal(isTemporaryGeozoneProps(p, "DK"), true);
    assert.equal(p.validEndTs, 1794952740000);
    assert.equal(zoneActivityAt(p as any, new Date(NOW)), "active");
    assert.equal(zoneActivityAt(p as any, new Date(1794952740000 + 60_000)), "inactive");
    assert.match(String(p.message), /Höhe laut NOTAM: 0 meter til 120 meter/);
    assert.match(String(p.message), /Originaltext der Behörde:\nDRONE OPERATIONS WILL TAKE PLACE/);
    assert.match(String(p.message), /D0522\/26 NOTAMN/);
    assert.equal(p.notamsUrlLabel, "Naviair-Briefingkarte öffnen");
    assert.equal(danishRawNotams(fx.awareness.features[0].properties).length, 1);
  });

  it("deaktivierte R/D-Gebiete: bis Abruf + 2 h nicht aktiv, danach vorsorglich aktiv, nicht temporär", () => {
    const out = normalizeDanishLiveLayers(byLayer(), NOW);
    const r12 = out.find((f) => String(f.properties!.name).startsWith("EK R12"))!;
    const p = r12.properties!;
    assert.equal(p.name, "EK R12 (GNIBEN) – nicht aktiviert");
    assert.equal(p.restriction, "RESTRICTED");
    assert.equal(zoneActivityAt({ ed269Applicability: p.applicability as any[] }, new Date(NOW + 60_000)), "inactive");
    assert.equal(zoneActivityAt({ ed269Applicability: p.applicability as any[] }, new Date(NOW + DK_DISABLED_HORIZON_MS + 60_000)), "active");
    assert.equal(isTemporaryGeozoneProps(p, "DK"), false);
    assert.equal(p.isNotam, undefined);
    const d350 = out.find((f) => String(f.properties!.name).startsWith("EK D350"))!;
    assert.equal(d350.properties!.restriction, "CONDITIONAL");
  });

  it("aktive NOTAM verdrängt das deaktivierte Gebiet gleichen Namens", () => {
    // handgebaut: R12 als aktiv (gleiche Geometrie, Status/Fenster gesetzt)
    const r12 = fx.disabled.features.find((f: any) => f.properties.name === "EK R12");
    const active = { ...r12, properties: { ...r12.properties, Status: "ACTIVE", StartDate: NOW - 3600_000, EndDate: NOW + 3600_000 } };
    const out = normalizeDanishLiveLayers({ ...byLayer(), active: [active] }, NOW);
    const r = out.filter((f) => String(f.properties!.name).startsWith("EK R12"));
    assert.equal(r.length, 1);
    assert.equal(r[0].properties!.dkLayer, "active");
    assert.equal(r[0].properties!.restriction, "RESTRICTED");
    assert.equal(zoneActivityAt(r[0].properties as any, new Date(NOW)), "active");
  });

  it("An-/Abflugflächen: Achtung, deutscher Name mit ICAO, Link", () => {
    const out = normalizeDanishLiveLayers(byLayer(), NOW);
    const c = out.filter((f) => f.properties!.dkLayer === "corridors");
    assert.equal(c.length, 2);
    assert.equal(c[0].properties!.name, "An-/Abflugfläche Anholt (EKAT)");
    assert.equal(c[0].properties!.restriction, "CONDITIONAL");
    assert.equal(new Set(c.map((f) => f.properties!.identifier)).size, 2);
  });

  it("Untergrenze aus LimitMeter/LimitFod", () => {
    assert.deepEqual(danishNotamLowerLimit({ LimitMeter: "0 meter til 120 meter", LimitFod: "0 SFC til 395 FT" }), { meters: 0, reference: "AGL" });
    assert.deepEqual(danishNotamLowerLimit({ LimitMeter: "300 meter til 900 meter", LimitFod: "1000 AMSL til 3000 FT" }), { meters: 300, reference: "MSL" });
    assert.deepEqual(danishNotamLowerLimit({ LimitMeter: "None" }), { meters: 0, reference: "AGL" });
  });
});

describe("DK – Abruf der Live-Ebenen", () => {
  const route = (fail?: string) => async (url: string) => {
    if (url === DK_WEBMAP_DATA_URL) return fx.webmap;
    if (fail && url.includes(fail)) throw new Error("HTTP 500");
    const offset = Number(new URL(url).searchParams.get("resultOffset"));
    if (offset > 0) return { type: "FeatureCollection", features: [] };
    for (const key of ["awareness", "disabled", "active", "inactive"]) if (url.includes(`/${key}_notams/`)) return fx[key];
    if (url.includes("udflyvningsplaner")) return fx.corridors;
    throw new Error(`unerwartete URL ${url}`);
  };

  it("lädt alle Ebenen vollständig (ohne Teil-Hinweis)", async () => {
    const r = await fetchDanishLiveLayers(route(), NOW);
    assert.equal(r.features.length, 6);
    assert.equal(r.coverage, undefined);
  });

  it("fehlende Ebene → Teil-Hinweis und Übernahme aus dem letzten Stand", async () => {
    const r = await fetchDanishLiveLayers(route("awareness_notams"), NOW);
    assert.equal(r.features.filter((f) => f.properties!.dkLayer === "awareness").length, 0);
    assert.match(r.coverage!.partialNote!, /^Dänemark: NOTAM Achtung nicht abrufbar/);
    assert.equal(r.coverage!.keepPrevious!({ dkLayer: "awareness" }), true);
    assert.equal(r.coverage!.keepPrevious!({ dkLayer: "corridors" }), false);
  });
});
