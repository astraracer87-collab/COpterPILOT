// NO: in ED-269 fehlende Ebenen aus dronesoner.no/data/ (ECHTE Auszüge,
// 2026-11-15, Luftfartstilsynet NLOD 2.0) – Abgleich, Dedupe, Zeit, Abruf.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NO_DATA_LAYERS,
  NO_GEOZONE_ATTRIBUTION,
  NO_OSM_ATTRIBUTION,
  mergeNorwayDataLayers,
  norwayAreaCode,
  norwayLimit,
} from "../../../shared/norwegianGeozones";
import { zoneActivityAt } from "../../../shared/ed269Restriction";
import { isTemporaryGeozoneProps } from "../../../shared/geozoneTemporary";
import { __resetNorwayDataMemoForTests, fetchNorwayDataLayers, loadNorway } from "../geozoneDirect/norwaySource";
import { fetchCoverageOf, mergeCarriedOverFeatures } from "../geozoneDirect/directFetchUtil";

const fx = JSON.parse(readFileSync(join(__dirname, "fixtures/no-dronesoner-data-sample.json"), "utf8"));
const NOW = Date.parse("2026-11-15T16:30:00Z");
const files = () => Object.fromEntries(Object.entries(fx.files).map(([k, v]: [string, any]) => [k, v.features]));
// Handgebaut: Namen, wie sie in der ED-269-Tagesdatei 2026-11-15 vorkommen.
const ED269 = ["END104 Bradalsmyra", "END110 Regionfelt Østlandet 1", "Rognan flyplass", "Oslo lufthavn, Gardermoen"].map((name) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [] },
  properties: { name },
}));

describe("NO /data/ – Abgleich mit ED-269", () => {
  it("übernimmt nur Fehlendes: END104/END110/Flugplatz sind schon in ED-269", () => {
    const { features, duplicates } = mergeNorwayDataLayers(ED269, files(), { now: NOW, statusIso: fx.notam_status.oppdatert_iso });
    assert.deepEqual(duplicates, { obs_fareomrader: 1, obs_sanntid_fareomrader: 1, obs_flyplasser: 1 });
    const names = features.map((f) => f.properties.name).sort();
    assert.ok(names.includes("END156 Hengsvatn"));
    assert.ok(names.includes("END107 Airwork A"));
    assert.ok(names.includes("EN R121 Arendal Sentrum"));
    assert.ok(names.includes("Andøya CTR"));
    assert.ok(!names.includes("END104 Bradalsmyra"));
    assert.equal(new Set(features.map((f) => f.properties.identifier)).size, features.length);
  });

  it("Kennungen: END104, EN R121 = ENR121", () => {
    assert.equal(norwayAreaCode("EN R121 Arendal Sentrum"), "ENR121");
    assert.equal(norwayAreaCode("ENR409 BARENTS 1"), "ENR409");
    assert.equal(norwayAreaCode("END104 Bradalsmyra"), "END104");
    assert.equal(norwayAreaCode("Andøya CTR"), "");
  });

  it("Höhentexte: GND, FT AMSL, FL, MSL, unbekannter Text", () => {
    assert.deepEqual(norwayLimit("GND"), { meters: 0, reference: "AGL", text: "GND" });
    assert.equal(norwayLimit("4500 FT AMSL")!.reference, "MSL");
    assert.ok(Math.abs(norwayLimit("6000FT AMSL")!.meters - 1828.8) < 1e-6);
    assert.equal(norwayLimit("FL 130")!.reference, "STD");
    assert.equal(norwayLimit("MSL")!.meters, 0);
    assert.equal(norwayLimit("Underside kontrollert luftrom"), null);
  });

  it("NOTAM-aktiviertes Gefahrengebiet: temporär, Fenster, Achtung", () => {
    const { features } = mergeNorwayDataLayers(ED269, files(), { now: NOW });
    const f = features.find((x) => x.properties.name === "END156 Hengsvatn")!;
    assert.equal(f.properties.restriction, "CONDITIONAL");
    assert.equal(f.properties.isNotam, true);
    assert.equal(isTemporaryGeozoneProps(f.properties, "NO"), true);
    assert.equal(zoneActivityAt(f.properties as any, new Date(NOW)), "active");
    assert.equal(zoneActivityAt(f.properties as any, new Date("2026-12-01T00:00:00Z")), "inactive");
    assert.match(f.properties.message, /Aktivierung: per NOTAM/);
  });

  it("Echtzeit-Gefahrengebiet: Temporär-Ebene, MSL-Untergrenze, nicht in der NOTAM-Liste", () => {
    const { features } = mergeNorwayDataLayers(ED269, files(), { now: NOW, statusIso: fx.notam_status.oppdatert_iso });
    const f = features.find((x) => x.properties.name === "END107 Airwork A")!;
    assert.equal(f.properties._layer, "obs_sanntid_fareomrader");
    assert.equal(isTemporaryGeozoneProps(f.properties, "NO"), true);
    assert.equal(f.properties.isNotam, undefined);
    assert.equal(f.properties.lowerReference, "MSL");
    assert.match(f.properties.message, /NOTAM-Stand 2026-11-15 12:12 UTC/);
    assert.match(f.properties.message, /Originaltext der Behörde:\nSanntidsaktivert fareområde/);
  });

  it("CTR/TIZ und RMZ/TMZ: Achtung, dauerhaft", () => {
    const { features } = mergeNorwayDataLayers(ED269, files(), { now: NOW });
    const ctr = features.find((x) => x.properties.noLayer === "luftrom_ctr_tiz")!;
    assert.equal(ctr.properties.restriction, "CONDITIONAL");
    assert.equal(isTemporaryGeozoneProps(ctr.properties, "NO"), false);
    assert.match(ctr.properties.message, /ICAO: ENAN/);
    assert.ok(features.some((x) => x.properties.noLayer === "luftrom_rmz_tmz"));
  });

  it("OSM-Attribution (Botschaften in ED-269 stammen aus OpenStreetMap)", () => {
    assert.ok(NO_GEOZONE_ATTRIBUTION.includes(NO_OSM_ATTRIBUTION));
    assert.equal(NO_OSM_ATTRIBUTION, "© OpenStreetMap contributors (ODbL)");
  });
});

describe("NO /data/ – Abruf mit notam_status.json", () => {
  beforeEach(() => __resetNorwayDataMemoForTests());
  const fetcher = (state: { iso: string; fail?: string; calls: string[] }) => async (url: string) => {
    state.calls.push(url);
    if (url.includes("notam_status.json")) return { ...fx.notam_status, oppdatert_iso: state.iso };
    const file = url.match(/data\/([a-z_]+)\.geojson/)?.[1] ?? "";
    if (state.fail === file) throw new Error("HTTP 500");
    return fx.files[file] ?? { type: "FeatureCollection", features: [] };
  };

  it("NOTAM-Dateien nur bei geändertem oppdatert_iso, feste täglich", async () => {
    const state = { iso: "2026-11-15T12:12:37Z", calls: [] as string[] };
    const a = await fetchNorwayDataLayers(fetcher(state), NOW);
    assert.equal(a.downloaded.length, NO_DATA_LAYERS.length);
    const b = await fetchNorwayDataLayers(fetcher(state), NOW + 600_000);
    assert.deepEqual(b.downloaded, []);
    state.iso = "2026-11-15T16:40:00Z";
    const c = await fetchNorwayDataLayers(fetcher(state), NOW + 1_200_000);
    assert.deepEqual(c.downloaded.sort(), NO_DATA_LAYERS.filter((d) => d.dynamic).map((d) => d.file).sort());
    const d = await fetchNorwayDataLayers(fetcher(state), NOW + 25 * 3600_000);
    assert.deepEqual(d.downloaded.sort(), NO_DATA_LAYERS.filter((x) => !x.dynamic).map((x) => x.file).sort());
  });

  it("fehlende Datei → ED-269 + Rest, „partial“, Zonen der Datei aus dem letzten Stand", async () => {
    const ed269 = async () => ED269 as any;
    const ok = await loadNorway(ed269, fetcher({ iso: "x1", calls: [] }), NOW);
    assert.equal(fetchCoverageOf(ok), undefined);
    __resetNorwayDataMemoForTests();
    const part = await loadNorway(ed269, fetcher({ iso: "x2", fail: "luftrom_ctr_tiz", calls: [] }), NOW);
    const cov = fetchCoverageOf(part)!;
    assert.match(cov.partialNote!, /dronesoner\.no: luftrom_ctr_tiz nicht abrufbar/);
    assert.ok(!part.some((f) => f.properties.noLayer === "luftrom_ctr_tiz"));
    const merged = mergeCarriedOverFeatures(part, ok, cov.keepPrevious);
    assert.equal(merged.filter((f) => f.properties.noLayer === "luftrom_ctr_tiz").length, 1);
  });

  it("notam_status meldet fehlgeschlagene Quellen → „partial“", async () => {
    const fetchJson = async (url: string) =>
      url.includes("notam_status.json") ? { ...fx.notam_status, kilder_feilet: ["ippc.no"], antall_feilet: 3 } : fx.files[url.match(/data\/([a-z_]+)\.geojson/)?.[1] ?? ""];
    const out = await loadNorway(async () => ED269 as any, fetchJson, NOW);
    assert.match(fetchCoverageOf(out)!.partialNote!, /NOTAM-Quellen teilweise fehlgeschlagen \(ippc\.no\)/);
  });
});
