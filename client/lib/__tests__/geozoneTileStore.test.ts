import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";

import {
  TILE_STORE_REFRESH_MS,
  appendFeatures,
  bboxAround,
  cellsForBBox,
  decodeRecord,
  emptyIndex,
  encodeRecord,
  featureStoreKey,
  geometryBBox,
  isIndexStale,
  listCzZipEntries,
  loadIndex,
  pageJobs,
  parseCzUasIndex,
  queryIndex,
  readCzZipEntry,
  wfsCountUrl,
} from "../geozoneTiles/tileStoreCore";
import { czCategory, dedupeZones, dipulLayerOfId, zoneFromStored } from "../geozoneTiles/tileZones";
import {
  __setTileStoreEnvForTests,
  deleteTileStore,
  downloadTileStore,
  getTilePartMeta,
  hasTiledGeozones,
  loadTileStoreMeta,
  queryTiledGeozones,
  queryTiledGeozonesAtPoint,
  tileStoreRefreshDue,
} from "../geozoneTiles/tileStore";
import { createNodeTileFs } from "./helpers/nodeTileFs";

// ---------------------------------------------------------------------------
// Testdaten
// ---------------------------------------------------------------------------

const square = (lon: number, lat: number, d: number) => ({
  type: "Polygon",
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});

const ctr = (n: number, lon: number, lat: number) => ({
  type: "Feature",
  id: `kontrollzonen.${n}`,
  geometry: square(lon, lat, 0.1),
  properties: { name: `CTR ${n}`, type_code: "KONTROLLZONE", lower_limit_altitude: 0, upper_limit_altitude: 2500, upper_limit_unit: "FT" },
});

// Eine „Autobahn“ über viele Kacheln (5,7° breit wie die A2)
const autobahn = {
  type: "Feature",
  id: "bundesautobahnen.1",
  geometry: {
    type: "Polygon",
    coordinates: [[[6.0, 52.0], [11.7, 52.4], [11.7, 52.41], [6.0, 52.01], [6.0, 52.0]]],
  },
  properties: { name: "Bundesautobahn A2", type_code: "BUNDESAUTOBAHN", legal_ref: "§ 21h, Abs. 3 (5.) LuftVO" },
};

const wohn = {
  type: "Feature",
  id: "wohngrundstuecke.7",
  geometry: { type: "MultiPolygon", coordinates: [square(11.5, 48.1, 0.1).coordinates] },
  properties: { name: "Stadt München", type_code: "WOHNGRUNDSTUECK" },
};

const temp = {
  type: "Feature",
  id: "temporaere_betriebseinschraenkungen.1",
  geometry: square(11.55, 48.12, 0.02),
  properties: { name: "Christkindlmarkt", start_time: "2026-11-01T00:00:00Z", end_time: "2099-01-01T00:00:00Z" },
};

// ---------------------------------------------------------------------------
// Kachel-Mathematik + Index
// ---------------------------------------------------------------------------

describe("tile math", () => {
  it("lists the 0.25° cells a bbox touches", () => {
    assert.deepEqual(cellsForBBox([11.5, 48.0, 11.6, 48.1]), [[46, 192]]);
    assert.equal(cellsForBBox([11.4, 48.0, 11.6, 48.3]).length, 2 * 2);
  });

  it("rounds geometry bboxes outward (index only)", () => {
    const bb = geometryBBox({ type: "Polygon", coordinates: [[[11.123456789, 48.987654321], [11.2, 49]]] })!;
    assert.ok(bb[0] <= 11.123456789 && bb[1] <= 48.987654321);
    assert.ok(bb[2] >= 11.2 && bb[3] >= 49);
    assert.equal(geometryBBox(null), null);
  });

  it("returns a feature spanning many cells once (dedupe) and honours limit", () => {
    const idx = emptyIndex("DE", "base");
    const seen = new Set<string>();
    appendFeatures(idx, seen, [autobahn, ctr(1, 8, 52.1), ctr(2, 11.6, 48.1)], 0);
    const loaded = loadIndex(idx);
    // die Autobahn steckt in vielen Kacheln des Rasters …
    let cellsWithA2 = 0;
    for (const list of loaded.grid.values()) if (list.includes(0)) cellsWithA2++;
    assert.ok(cellsWithA2 > 20);
    // … kommt bei einer Abfrage über mehrere Kacheln aber nur einmal heraus
    const hits = queryIndex(loaded, [6, 51.9, 12, 52.5]);
    assert.deepEqual(hits.map((i) => idx.ids[i]).sort(), ["bundesautobahnen.1", "kontrollzonen.1"]);
    assert.equal(queryIndex(loaded, [6, 51.9, 12, 52.5], { limit: 1 }).length, 1);
    // Ebenen-Filter
    const onlyCtr = queryIndex(loaded, [0, 40, 20, 60], { filter: (id) => dipulLayerOfId(id) === "kontrollzonen" });
    assert.equal(onlyCtr.length, 2);
  });

  it("stores features unchanged (lossless records)", () => {
    const rec = encodeRecord(autobahn);
    assert.ok(rec.length < JSON.stringify(autobahn).length * 2);
    assert.equal(JSON.stringify(decodeRecord(rec)), JSON.stringify(autobahn));
  });

  it("skips already stored ids when appending (resume)", () => {
    const idx = emptyIndex("DE", "base");
    const seen = new Set<string>();
    const a = appendFeatures(idx, seen, [ctr(1, 8, 50)], 0);
    const b = appendFeatures(idx, seen, [ctr(1, 8, 50), ctr(2, 9, 50)], a.bytes.length);
    assert.equal(b.added, 1);
    assert.equal(idx.ids.length, 2);
    assert.equal(idx.entries[6], a.bytes.length); // Offset des 2. Datensatzes
  });

  it("builds page jobs and count URLs per service", () => {
    assert.deepEqual(pageJobs("x", 5, 2).map((j) => j.start), [0, 2, 4]);
    assert.match(wfsCountUrl("DE", "kontrollzonen"), /COUNT=0/);
    assert.match(wfsCountUrl("FR", "fr"), /COUNT=1.*PROPERTYNAME=limite/);
  });
});

// ---------------------------------------------------------------------------
// CZ (ED-318)
// ---------------------------------------------------------------------------

const CZ_INDEX_HTML = `
<h3 id="letecke">Aktuální</h3><table><tbody>
<tr><td>ED-318 A1, A2 - dlaždice</td><td>…</td><td><a href="/data/uas/2026_11_12/actual/ed_318_a1_a2_tiles.zip" download="ed_318_a1_a2_tiles.zip">ed_318_a1_a2_tiles.zip</a></td><td>35,46&nbsp;MB</td><td style="font-size: 70%;">eae8ccd941992528f339b1044b4987ad</td><td>31. 10. 2026</td></tr>
</tbody></table><h3>Budoucí</h3><table><tbody>
<tr><td>ED-318 A1, A2 - dlaždice</td><td><a href="/data/uas/2026_11_12/2026_11_26/ed_318_a1_a2_tiles.zip">x</a></td><td>f8c2c51f840f199ab0b79c0333949af1</td></tr>
</tbody></table>`;

const czFeature = (identifier: string, name: string, geometry: any, type = "REQ_AUTHORIZATION") => ({
  type: "Feature",
  geometry: { ...geometry, layer: { upper: 120, upperReference: "AGL", lower: 0, lowerReference: "AGL", uom: "m" } },
  properties: {
    identifier,
    country: "CZE",
    name: [{ text: name, lang: "cs-CZ" }],
    type,
    variant: "COMMON",
    message: [{ text: "upper limit FL660", lang: "en-GB" }],
    zoneAuthority: [{ name: [{ text: "Příslušný krajský úřad (odbor životního prostředí)", lang: "cs-CZ" }], purpose: "AUTHORIZATION" }],
  },
});

function czZip(): Uint8Array {
  const x = czFeature("79418B", "Vinařský rybník", square(14.40, 50.05, 0.01));
  const yA = czFeature("3611B", "Železniční zóna vnější - SŽ", square(14.45, 50.05, 0.01), "CONDITIONAL");
  const yB = czFeature("3611B", "Železniční zóna vnější - SŽ", square(14.47, 50.05, 0.01), "CONDITIONAL");
  const tile = (name: string, features: any[]) =>
    // echte Dateien: UTF-8-BOM, CRLF, eingerückt
    strToU8("﻿" + JSON.stringify({ type: "FeatureCollection", name, features }, null, 3).replace(/\n/g, "\r\n"));
  return zipSync({
    "ed_318_a1_a2_tiles/": new Uint8Array(0),
    "ed_318_a1_a2_tiles/ed_318_1.json": tile("ed_318_1", [x, yA]),
    "ed_318_a1_a2_tiles/ed_318_2.json": tile("ed_318_2", [x, yB]),
  });
}

describe("CZ index + zip parsing", () => {
  it("finds the current (not the future) ED-318 tiles publication", () => {
    const pub = parseCzUasIndex(CZ_INDEX_HTML)!;
    assert.equal(pub.folder, "2026_11_12");
    assert.equal(pub.url, "https://aim.rlp.cz/data/uas/2026_11_12/actual/ed_318_a1_a2_tiles.zip");
    assert.equal(pub.md5, "eae8ccd941992528f339b1044b4987ad");
    assert.equal(parseCzUasIndex("<html>nothing</html>"), null);
  });

  it("lists and reads tile files (BOM/CRLF tolerant)", () => {
    const zip = czZip();
    assert.deepEqual(listCzZipEntries(zip), ["ed_318_a1_a2_tiles/ed_318_1.json", "ed_318_a1_a2_tiles/ed_318_2.json"]);
    const feats = readCzZipEntry(zip, "ed_318_a1_a2_tiles/ed_318_1.json");
    assert.equal(feats.length, 2);
  });

  it("keys CZ features by identifier + geometry (identifier is not unique)", () => {
    const a = czFeature("PIS005", "PISLK005 zone I", square(14, 50, 0.01));
    const b = czFeature("PIS005", "PISLK005 zone III", square(14, 50, 0.03));
    assert.notEqual(featureStoreKey("CZ", a), featureStoreKey("CZ", b));
    assert.equal(featureStoreKey("CZ", a), featureStoreKey("CZ", JSON.parse(JSON.stringify(a))));
  });

  it("converts ED-318 features to app zones", () => {
    const z = zoneFromStored("CZ", czFeature("79418B", "Vinařský rybník", square(14.4, 50.05, 0.01)))!;
    assert.equal(z.country, "CZ");
    assert.equal(z.restriction, "REQ_AUTHORISATION");
    assert.equal(z.upperMeters, 120);
    assert.equal(z.layerLabel, "Naturschutz");
    assert.match(z.details, /ŘLP ČR/);
    assert.equal(czCategory("Grid ATZ 1", "1", ""), "Höhenraster ATZ");
  });
});

// ---------------------------------------------------------------------------
// Download + Lesen (Node-fs, gemocktes Netz)
// ---------------------------------------------------------------------------

const FILLER = Array.from({ length: 4997 }, (_, i) => ctr(100 + i, 3 + (i % 50) * 0.01, 55 + Math.floor(i / 50) * 0.01));

let dir = "";
let offline = false;
let fetchCalls: string[] = [];
let failAll = false;

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => new ArrayBuffer(0) } as any;
}

const fakeFetch = (async (input: any) => {
  const url = String(input);
  fetchCalls.push(url);
  if (failAll) throw new Error("offline");
  if (url.startsWith("https://aim.rlp.cz/?")) {
    return { ok: true, status: 200, text: async () => CZ_INDEX_HTML } as any;
  }
  if (url.endsWith("ed_318_a1_a2_tiles.zip")) {
    const z = czZip();
    return { ok: true, status: 200, arrayBuffer: async () => z.buffer.slice(z.byteOffset, z.byteOffset + z.length) } as any;
  }
  const u = new URL(url);
  const layer = (u.searchParams.get("TYPENAMES") || "").replace("dipul:", "");
  const count = Number(u.searchParams.get("COUNT"));
  const start = Number(u.searchParams.get("STARTINDEX") || 0);
  const all: Record<string, any[]> = {
    // 3 echte + viele Füllzonen fern ab (Nordsee) -> mehrere Seiten à 1000
    kontrollzonen: [ctr(1, 11.55, 48.1), ctr(2, 13.4, 52.4), ctr(3, 6.9, 50.9), ...FILLER],
    bundesautobahnen: [autobahn],
    wohngrundstuecke: [wohn],
    temporaere_betriebseinschraenkungen: [temp],
  };
  const feats = all[layer] ?? [];
  return jsonResponse({ type: "FeatureCollection", numberMatched: feats.length, features: count === 0 ? [] : feats.slice(start, start + count) });
}) as typeof fetch;

beforeEach(() => {
  dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "tilestore-"));
  offline = false;
  failAll = false;
  fetchCalls = [];
  __setTileStoreEnvForTests({
    fs: createNodeTileFs(dir, fakeFetch),
    isOffline: () => offline,
    isWifi: async () => true,
    fetch: fakeFetch,
    retryDelaysMs: [1, 1, 1],
  });
});

afterEach(() => {
  __setTileStoreEnvForTests(null);
  nodeFs.rmSync(dir, { recursive: true, force: true });
});

describe("DE tile store", () => {
  it("pauses, resumes, completes and answers queries offline", async () => {
    // 1. Durchgang: nach dem ersten Auftrag pausieren
    let jobs = 0;
    const first = await downloadTileStore("DE", {
      wohn: true,
      onProgress: (p) => {
        if (p.state === "active" && p.done > 0) jobs = p.done;
      },
      shouldStop: () => jobs >= 1,
    });
    assert.equal(first[0].state, "inactive");
    assert.equal(hasTiledGeozones("DE"), false);

    // 2. Durchgang: fortsetzen bis vollständig
    const second = await downloadTileStore("DE", { wohn: true });
    assert.deepEqual(second.map((r) => r.state), ["complete", "complete"]);
    assert.equal(hasTiledGeozones("DE"), true);
    assert.equal(getTilePartMeta("DE", "base")!.count, 5001); // 5000 CTR + Autobahn, keine Dubletten
    assert.equal(getTilePartMeta("DE", "wohn")!.count, 1);

    // Temporäre Zonen einmal online laden (wird gespeichert)
    const online = await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 2));
    assert.ok(online!.some((z) => z.name === "Christkindlmarkt"));

    // 3. Offline: neuer Prozess-Zustand, Netz weg
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => true, isWifi: async () => false, fetch: fakeFetch, retryDelaysMs: [1, 1, 1] });
    failAll = true;
    await loadTileStoreMeta();
    const zones = (await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 5)))!;
    const names = zones.map((z) => z.name).sort();
    assert.deepEqual(names, ["CTR 1", "Christkindlmarkt", "Stadt München"]);
    const ctr1 = zones.find((z) => z.name === "CTR 1")!;
    assert.equal(ctr1.layerLabel, "Kontrollzonen (CTR)");
    assert.match(ctr1.details, /dipul, CC-BY-ND 4\.0/);
    assert.ok(ctr1.links!.some((l) => l.url === "https://creativecommons.org/licenses/by-nd/4.0/legalcode.de"));

    // Ebenen-Filter: nur Kontrollzonen
    const onlyCtr = (await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 5), { layers: ["kontrollzonen"] }))!;
    assert.deepEqual(onlyCtr.map((z) => z.name), ["CTR 1"]);

    // Punktabfrage
    const atPoint = (await queryTiledGeozonesAtPoint("DE", 48.15, 11.57))!;
    assert.deepEqual(atPoint.map((z) => z.name).sort(), ["CTR 1", "Stadt München"]);
    assert.deepEqual(await queryTiledGeozonesAtPoint("DE", 47.5, 9.0), []);

    // Autobahn über viele Kacheln: genau einmal
    const a2 = (await queryTiledGeozones("DE", [6, 51.9, 12, 52.6]))!.filter((z) => z.name === "Bundesautobahn A2");
    assert.equal(a2.length, 1);
  });

  it("returns null without a store (caller falls back to online)", async () => {
    assert.equal(await queryTiledGeozones("DE", bboxAround(48, 11, 1)), null);
    assert.equal(await queryTiledGeozones("AT", bboxAround(48, 14, 1)), null);
  });

  it("drops the Wohngebiete part when deselected", async () => {
    await downloadTileStore("DE", { wohn: true });
    assert.ok(getTilePartMeta("DE", "wohn"));
    await downloadTileStore("DE", { wohn: false });
    assert.equal(getTilePartMeta("DE", "wohn"), null);
    assert.ok(getTilePartMeta("DE", "base"));
    const zones = (await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 5), { includeTemp: false }))!;
    assert.deepEqual(zones.map((z) => z.name), ["CTR 1"]);
  });

  it("keeps the old store when a refresh fails", async () => {
    await downloadTileStore("DE", {});
    const before = getTilePartMeta("DE", "base")!.createdAt;
    failAll = true;
    const res = await downloadTileStore("DE", { force: true });
    assert.equal(res[0].state, "error");
    assert.equal(getTilePartMeta("DE", "base")!.createdAt, before);
    failAll = false;
    assert.ok((await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 5), { includeTemp: false }))!.length > 0);
  });

  it("offline-first: hängender Live-Abruf der temporären Zonen blockiert die lokalen Zonen nicht", async () => {
    await downloadTileStore("DE", {});
    // temp.json einmal online speichern
    assert.ok((await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 2)))!.some((z) => z.name === "Christkindlmarkt"));
    // Neuer Prozess-Zustand, online, aber der temporäre Layer hängt (nur Abort beendet ihn)
    let tempAborted = false;
    let released = false;
    const pending: (() => void)[] = [];
    const hangingTemp = (async (input: any, init?: RequestInit) => {
      if (!released && String(input).includes("temporaere_betriebseinschraenkungen")) {
        return new Promise((res, rej) => {
          pending.push(() => res(fakeFetch(input, init)));
          init?.signal?.addEventListener("abort", () => {
            tempAborted = true;
            const e = new Error("aborted");
            e.name = "AbortError";
            rej(e);
          });
        });
      }
      return fakeFetch(input, init);
    }) as typeof fetch;
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, hangingTemp), isOffline: () => false, isWifi: async () => true, fetch: hangingTemp, retryDelaysMs: [1, 1, 1] });
    await loadTileStoreMeta();
    const t0 = Date.now();
    const zones = (await queryTiledGeozones("DE", bboxAround(48.13, 11.56, 5), { tempMaxWaitMs: 50 }))!;
    assert.ok(Date.now() - t0 < 5000, "nicht auf den 20-s-Timeout gewartet");
    const names = zones.map((z) => z.name).sort();
    // lokale Zonen + gespeicherter Stand der temporären Zonen
    assert.ok(names.includes("CTR 1"));
    assert.ok(names.includes("Christkindlmarkt"));
    assert.equal(tempAborted, false, "Live-Abruf läuft im Hintergrund weiter");
    // Hintergrund-Abruf beenden (sonst hält sein 20-s-Timer den Testprozess)
    released = true;
    for (const r of pending) r();
    await new Promise((r) => setTimeout(r, 20));
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => false, isWifi: async () => true, fetch: fakeFetch, retryDelaysMs: [1, 1, 1] });
  });

  it("is due for refresh after 28 days", async () => {
    await downloadTileStore("DE", {});
    assert.equal(await tileStoreRefreshDue("DE"), false);
    assert.equal(await tileStoreRefreshDue("DE", Date.now() + TILE_STORE_REFRESH_MS + 1000), true);
    assert.equal(isIndexStale({ createdAt: 0, complete: true }), true);
  });

  it("deletes everything", async () => {
    await downloadTileStore("DE", { wohn: true });
    await deleteTileStore("DE");
    assert.equal(hasTiledGeozones("DE"), false);
    assert.equal(nodeFs.existsSync(path.join(dir, "de")), false);
  });
});

describe("CZ tile store", () => {
  it("imports the official tiles once and merges clipped parts at read time", async () => {
    const res = await downloadTileStore("CZ", {});
    assert.equal(res[0].state, "complete");
    const meta = getTilePartMeta("CZ", "base")!;
    assert.equal(meta.count, 3); // X einmal (exakte Kopie verworfen), Y in zwei Teilen
    assert.equal(meta.source?.folder, "2026_11_12");
    assert.equal(nodeFs.existsSync(path.join(dir, "cz", "base", "tiles.zip")), false);

    offline = true;
    const zones = (await queryTiledGeozones("CZ", [14.3, 50.0, 14.6, 50.1]))!;
    assert.equal(zones.length, 2);
    const rail = zones.find((z) => z.layerLabel === "Bahnanlagen")!;
    assert.equal(rail.polygonGroups!.length, 2);
    const atPoint = (await queryTiledGeozonesAtPoint("CZ", 50.055, 14.405))!;
    assert.deepEqual(atPoint.map((z) => z.name), ["Vinařský rybník"]);
  });

  it("Download-Anzeige: „Tschechien – Geozonen“ mit Fortschritt während des Pakets (inkl. ZIP), danach beendet", async () => {
    const { getActiveDownloads, downloadFraction } = await import("../downloadActivity");
    const seen: string[] = [];
    const fractions: number[] = [];
    await downloadTileStore("CZ", {
      onProgress: () => {
        for (const t of getActiveDownloads()) {
          seen.push(`${t.id}|${t.iso}|${t.labelDe}`);
          const f = downloadFraction(t);
          if (f != null) fractions.push(f);
        }
      },
    });
    assert.ok(seen.includes("tiles:CZ:base|CZ|Geozonen"), seen.join(","));
    assert.ok(fractions.some((f) => f > 0 && f <= 1));
    assert.equal(getActiveDownloads().length, 0);
  });

  it("detects a new ŘLP publication folder", async () => {
    await downloadTileStore("CZ", {});
    assert.equal(await tileStoreRefreshDue("CZ"), false);
    // gespeicherten Ordner künstlich veralten lassen
    const metaPath = path.join(dir, "cz", "base", "meta.json");
    const m = JSON.parse(nodeFs.readFileSync(metaPath, "utf8"));
    m.source.folder = "2026_10_15";
    nodeFs.writeFileSync(metaPath, JSON.stringify(m));
    await loadTileStoreMeta(true);
    assert.equal(await tileStoreRefreshDue("CZ"), true);
  });
});

describe("dedupeZones", () => {
  it("drops duplicate ids and merges parts with different geometry", () => {
    const a = zoneFromStored("DE", ctr(1, 8, 50))!;
    const out = dedupeZones([a, { ...a }, zoneFromStored("DE", ctr(2, 9, 50))!]);
    assert.equal(out.length, 2);
  });
});
