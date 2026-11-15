// Kooperative Hintergrundarbeit (shared/yieldingWork.ts) – Product Owner:
// „Während die Geozonen laden kann man nichts in der App machen“.
// Geprüft: Warteschlange (Reihenfolge, Serialisierung, Abbruch), Zeitscheiben
// mit künstlicher Uhr, Pause bei Interaktion/Vordergrundarbeit, identische
// Ergebnisse der zerlegten JSON-/DEFLATE-Helfer, Overlay für nicht zerlegbare
// Arbeit und – als Regressionstest – dass die Hauptladepfade den JS-Thread nie
// länger als ein Budget am Stück blockieren (Event-Loop-Lag-Messung).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inflateSync, strToU8 } from "fflate";

import {
  WorkCancelledError,
  __setWaitForPaintForTests,
  __setYieldingWorkEnvForTests,
  backgroundJobCount,
  deflateYielding,
  filterYielding,
  getBlockingWork,
  getYieldStats,
  inflateYielding,
  isUserActive,
  mapYielding,
  noteUserActivity,
  parseJsonYielding,
  runBackgroundJob,
  runBlocking,
  runForegroundWork,
  stringifyYielding,
  subscribeBlockingWork,
  waitForIdle,
  yieldToUi,
} from "../../../shared/yieldingWork";
import {
  appendFeatures,
  appendFeaturesYielding,
  buildGrid,
  buildGridYielding,
  decodeRecord,
  emptyIndex,
  loadIndex,
  queryIndex,
  queryIndexYielding,
} from "../geozoneTiles/tileStoreCore";
import {
  __resetEd269StoreForTests,
  __setEd269FsForTests,
  importEd269Dataset,
  loadStoredEd269Dataset,
} from "../geozoneDirect/ed269Store";
import { parseEd269ToGeozoneInfo, parseEd269ToGeozoneInfoYielding } from "../ed269";
import {
  __setTileStoreEnvForTests,
  downloadTileStore,
  queryTiledGeozones,
} from "../geozoneTiles/tileStore";
import { createNodeTileFs } from "./helpers/nodeTileFs";

// ---------------------------------------------------------------------------
// Künstliche Uhr
// ---------------------------------------------------------------------------

function fakeClock() {
  let t = 0;
  const yields: number[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    yields,
    env: {
      now: () => t,
      yieldImpl: async () => {
        yields.push(t);
        await new Promise<void>((r) => setImmediate(r));
      },
      sleep: async (ms: number) => {
        t += ms;
        await new Promise<void>((r) => setImmediate(r));
      },
      sliceMs: 12,
    },
  };
}

afterEach(() => {
  __setYieldingWorkEnvForTests(null);
  __setWaitForPaintForTests(null);
});

describe("Zeitscheiben", () => {
  it("mapYielding gibt nach ≈ 12 ms ab und liefert dasselbe wie map()", async () => {
    const c = fakeClock();
    __setYieldingWorkEnvForTests(c.env);
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const out = await mapYielding(arr, (x) => {
      c.advance(1); // jedes Element „kostet“ 1 ms
      return x * 2;
    });
    assert.deepEqual(out, arr.map((x) => x * 2));
    // 100 ms Arbeit in 12-ms-Scheiben → 8 Abgaben, jede Scheibe ≤ 12 ms
    assert.equal(c.yields.length, 8);
    assert.ok(getYieldStats().maxSliceMs <= 12, `max ${getYieldStats().maxSliceMs}`);
    const f = await filterYielding(arr, (x) => {
      c.advance(1);
      return x % 3 === 0;
    });
    assert.deepEqual(f, arr.filter((x) => x % 3 === 0));
  });

  it("pausiert nach einer Berührung, bis Ruhe ist (höchstens MAX_USER_PAUSE_MS)", async () => {
    const c = fakeClock();
    __setYieldingWorkEnvForTests(c.env);
    noteUserActivity(0);
    assert.equal(isUserActive(), true);
    const t0 = c.now();
    await yieldToUi();
    // 400 ms Ruhe abgewartet (Schritte à 50 ms)
    assert.ok(c.now() - t0 >= 400, `waited ${c.now() - t0}`);
    assert.equal(isUserActive(), false);
  });

  it("waitForIdle wartet auf Ende der Vordergrundarbeit", async () => {
    const c = fakeClock();
    __setYieldingWorkEnvForTests(c.env);
    let release!: () => void;
    const fg = runForegroundWork(() => new Promise<void>((r) => (release = r)));
    let idle = false;
    const w = waitForIdle(60_000).then(() => (idle = true));
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
    assert.equal(idle, false);
    release();
    await fg;
    await w;
    assert.equal(idle, true);
  });
});

describe("Warteschlange für Hintergrund-Jobs", () => {
  beforeEach(() => __setYieldingWorkEnvForTests({ yieldImpl: () => new Promise<void>((r) => setImmediate(r)), sleep: () => new Promise<void>((r) => setImmediate(r)) }));

  it("führt Jobs nacheinander in Einreihungsreihenfolge aus", async () => {
    const log: string[] = [];
    const mk = (name: string) =>
      runBackgroundJob(name, async (ctx) => {
        log.push(`${name}:start`);
        for (let i = 0; i < 3; i++) {
          await ctx.yield();
          log.push(`${name}:${i}`);
        }
        log.push(`${name}:end`);
        return name;
      }).promise;
    const res = await Promise.all([mk("A"), mk("B"), mk("C")]);
    assert.deepEqual(res, ["A", "B", "C"]);
    assert.deepEqual(log, ["A:start", "A:0", "A:1", "A:2", "A:end", "B:start", "B:0", "B:1", "B:2", "B:end", "C:start", "C:0", "C:1", "C:2", "C:end"]);
    assert.equal(backgroundJobCount(), 0);
  });

  it("Abbruch: wartender Job läuft nie, laufender endet am nächsten Kontrollpunkt", async () => {
    let ranB = false;
    let steps = 0;
    const a = runBackgroundJob("A", async (ctx) => {
      for (;;) {
        steps++;
        await ctx.yield();
      }
    });
    const b = runBackgroundJob("B", async () => {
      ranB = true;
    });
    b.cancel();
    await assert.rejects(b.promise, WorkCancelledError);
    await new Promise<void>((r) => setImmediate(r));
    a.cancel();
    await assert.rejects(a.promise, WorkCancelledError);
    assert.equal(ranB, false);
    assert.ok(steps >= 1);
    // Warteschlange wieder frei
    assert.equal(await runBackgroundJob("C", async () => 42).promise, 42);
  });

  it("Fehler eines Jobs gibt die Warteschlange frei; Fortschritt wird gemeldet", async () => {
    const fr: number[] = [];
    await assert.rejects(runBackgroundJob("X", async () => { throw new Error("kaputt"); }).promise, /kaputt/);
    const v = await runBackgroundJob(
      "Y",
      async (ctx) => {
        ctx.progress(0.5);
        ctx.progress(2);
        return 1;
      },
      { onProgress: (f) => fr.push(f) },
    ).promise;
    assert.equal(v, 1);
    assert.deepEqual(fr, [0.5, 1]);
  });

  it("Hintergrund-Job pausiert, solange Vordergrundarbeit läuft", async () => {
    const log: string[] = [];
    let release!: () => void;
    const fg = runForegroundWork(async () => {
      log.push("fg:start");
      await new Promise<void>((r) => (release = r));
      log.push("fg:end");
    });
    const bg = runBackgroundJob("bg", async (ctx) => {
      log.push("bg:start");
    }).promise;
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
    assert.deepEqual(log, ["fg:start"]);
    release();
    await fg;
    await bg;
    assert.deepEqual(log, ["fg:start", "fg:end", "bg:start"]);
  });
});

describe("Overlay für nicht zerlegbare Arbeit (runBlocking)", () => {
  it("zeigt das Overlay, BEVOR die Arbeit startet, und blendet es danach aus", async () => {
    const events: string[] = [];
    __setWaitForPaintForTests(async () => {
      events.push(`paint:${getBlockingWork() ? "overlay" : "none"}`);
    });
    const unsub = subscribeBlockingWork(() => events.push(`state:${getBlockingWork()?.step ?? (getBlockingWork() ? "on" : "off")}`));
    const r = await runBlocking({ label: "Geozonen", iso: "DE", step: "Index" }, async (update) => {
      events.push(`work:${getBlockingWork() ? "overlay" : "none"}`);
      await update({ step: "Schreiben", fraction: 0.5 });
      return 7;
    });
    unsub();
    assert.equal(r, 7);
    assert.equal(getBlockingWork(), null);
    assert.deepEqual(events, ["state:Index", "paint:overlay", "work:overlay", "state:Schreiben", "paint:overlay", "state:off"]);
  });

  it("blendet das Overlay auch bei einem Fehler aus", async () => {
    __setWaitForPaintForTests(async () => {});
    await assert.rejects(runBlocking({ label: "x" }, () => { throw new Error("boom"); }), /boom/);
    assert.equal(getBlockingWork(), null);
  });
});

// ---------------------------------------------------------------------------
// JSON in Scheiben: identische Ergebnisse
// ---------------------------------------------------------------------------

const tiny = { minChars: 0 };

describe("parseJsonYielding", () => {
  const cases: [string, string][] = [
    ["FeatureCollection", JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { a: 1 }, geometry: { type: "Point", coordinates: [1, 2] } }] })],
    ["Strings mit Klammern, Anführungszeichen, Backslashes", JSON.stringify({ features: [{ n: 'a}{]["\\"', m: "\\\\" }, { n: "\\\"}", x: [1, [2, [3]]] }], tail: "}" })],
    ["leeres Array + Leerraum", ' \n{ "features" :\t[ ] , "n" : 1 }\n'],
    ["Zahlen-/String-Arrays (Index)", JSON.stringify({ v: 1, entries: [0, 1.5, -2e-7, 3], ids: ["a,b", 'c"]d', "e\\", "", "ü€😀"], done: [] })],
    ["verschachtelte Arrays bleiben im Kopf", JSON.stringify({ coords: [[1, 2], [3, 4]], features: [{ a: 1 }] })],
    ["doppelte Schlüssel (letzter gewinnt)", '{"features":[{"a":1}],"features":[{"b":2}]}'],
    ["doppelte Schlüssel, letzter kein Array", '{"features":[{"a":1}],"features":5}'],
    ["__proto__ als Schlüssel", '{"__proto__":[{"x":1}],"features":[{"y":2}]}'],
    ["ArcGIS mit Objekt auf Ebene 1", JSON.stringify({ spatialReference: { wkid: 4326 }, fields: [{ name: "a" }], features: [{ attributes: { a: 1 }, geometry: { rings: [[[1, 2]]] } }], exceededTransferLimit: true })],
    ["Top-Level-Array", JSON.stringify([{ a: 1 }, { b: 2 }])],
    ["Gemischtes Array", JSON.stringify({ features: [{ a: 1 }, 2] })],
    ["Unicode-Escapes", '{"features":[{"n":"\\u007d\\u0022"}],"ids":["\\u002c"]}'],
  ];
  for (const [name, text] of cases) {
    it(`identisch zu JSON.parse: ${name}`, async () => {
      const ref = JSON.parse(text);
      const got = await parseJsonYielding(text, tiny);
      assert.deepStrictEqual(got, ref);
      assert.equal(Object.getPrototypeOf(got), Object.getPrototypeOf(ref));
    });
  }

  it("wirft bei ungültigem JSON wie JSON.parse", async () => {
    for (const bad of ['{"features":[{"a":1},]}', '{"features":[{"a":1}', '{"features":[{"a":"x}]}', "{", '{"a":1}x']) {
      await assert.rejects(parseJsonYielding(bad, tiny), SyntaxError, bad);
    }
  });

  it("große FeatureCollection: identisch und in Scheiben", async () => {
    const fc = { type: "FeatureCollection", numberMatched: 3000, features: Array.from({ length: 3000 }, (_, i) => bigFeature(i, 60)) };
    const text = JSON.stringify(fc);
    __setYieldingWorkEnvForTests({ sliceMs: 2 });
    const got = await parseJsonYielding(text);
    assert.deepStrictEqual(got, fc);
    assert.ok(getYieldStats().yields > 1);
  });
});

describe("stringifyYielding", () => {
  it("byte-identisch zu JSON.stringify", async () => {
    const objs: unknown[] = [
      { a: 1, b: undefined, c: () => 1, d: [1, undefined, () => 2, null], e: new Date(0), f: "x\"y", g: { h: [1, 2] } },
      { features: Array.from({ length: 500 }, (_, i) => bigFeature(i, 10)), n: NaN, inf: Infinity },
      [1, "a", { b: [2] }],
      "text",
      42,
      null,
      { entries: Array.from({ length: 10000 }, (_, i) => i * 1.5), ids: Array.from({ length: 5000 }, (_, i) => `k.${i}`) },
    ];
    for (const o of objs) assert.equal(await stringifyYielding(o), JSON.stringify(o));
  });
});

describe("DEFLATE in Scheiben", () => {
  it("verlustfrei (groß und klein)", async () => {
    for (const n of [10, 70_000, 600_000]) {
      const data = strToU8(JSON.stringify(Array.from({ length: n / 10 }, (_, i) => [i, Math.sin(i)])));
      const z = await deflateYielding(data);
      assert.deepEqual(inflateSync(z), data);
      assert.deepEqual(await inflateYielding(z), data);
    }
  });
});

// ---------------------------------------------------------------------------
// Kachelspeicher-Kern: zerlegte Varianten liefern dasselbe
// ---------------------------------------------------------------------------

function bigFeature(i: number, points: number, prefix = "kontrollzonen") {
  const lon = 6 + (i % 90) * 0.1;
  const lat = 47 + Math.floor(i / 90) * 0.1;
  const ring: number[][] = [];
  for (let k = 0; k < points; k++) {
    const a = (k / points) * 2 * Math.PI;
    ring.push([+(lon + 0.03 * Math.cos(a)).toFixed(7), +(lat + 0.03 * Math.sin(a)).toFixed(7)]);
  }
  ring.push(ring[0]);
  return {
    type: "Feature",
    id: `${prefix}.${i}`,
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: { name: `Zone ${i} "}{"`, type_code: "KONTROLLZONE", lower_limit_altitude: 0, upper_limit_altitude: 2500, upper_limit_unit: "FT" },
  };
}

describe("Kachelspeicher: zerlegte Varianten identisch", () => {
  it("appendFeaturesYielding = appendFeatures (Index, Inhalte)", async () => {
    const feats = [...Array.from({ length: 200 }, (_, i) => bigFeature(i, 50)), bigFeature(999, 40_000)];
    const a = emptyIndex("DE", "base");
    const b = emptyIndex("DE", "base");
    const ra = appendFeatures(a, new Set(), feats, 0);
    const rb = await appendFeaturesYielding(b, new Set(), feats, 0);
    assert.equal(ra.added, rb.added);
    assert.deepEqual(b.ids, a.ids);
    // BBoxen gleich, Offsets/Längen dürfen sich bei großen Zonen unterscheiden (Blockgrenzen)
    for (let i = 0; i < a.ids.length; i++) {
      assert.deepEqual(b.entries.slice(i * 6 + 2, i * 6 + 6), a.entries.slice(i * 6 + 2, i * 6 + 6));
      const off = b.entries[i * 6];
      const len = b.entries[i * 6 + 1];
      assert.deepEqual(decodeRecord(rb.bytes.subarray(off, off + len)), feats[i]);
    }
  });

  it("buildGridYielding/queryIndexYielding = buildGrid/queryIndex", async () => {
    const idx = emptyIndex("DE", "base");
    appendFeatures(idx, new Set(), Array.from({ length: 2000 }, (_, i) => bigFeature(i, 8)), 0);
    assert.deepEqual(await buildGridYielding(idx), buildGrid(idx));
    const L = loadIndex(idx);
    for (const [q, limit] of [[[6, 47, 15, 55], 300], [[7, 48, 7.5, 48.5], undefined], [[0, 0, 1, 1], 10]] as const) {
      const s1: { truncated?: boolean; total?: number } = {};
      const s2: { truncated?: boolean; total?: number } = {};
      assert.deepEqual(await queryIndexYielding(L, q as any, { limit, stats: s2 }), queryIndex(L, q as any, { limit, stats: s1 }));
      assert.deepEqual(s2, s1);
    }
  });

  it("parseEd269ToGeozoneInfoYielding = parseEd269ToGeozoneInfo", async () => {
    const feats = Array.from({ length: 100 }, (_, i) => ({ ...bigFeature(i, 12), properties: { name: `Z${i}`, restriction: "PROHIBITED", lowerMeters: 0, upperMeters: 120 } }));
    assert.deepEqual(await parseEd269ToGeozoneInfoYielding(feats, "AT"), parseEd269ToGeozoneInfo(feats, "AT"));
  });
});

// ---------------------------------------------------------------------------
// Gerätebestand ED-269: gleiches Dateiformat, zerlegt gelesen/geschrieben
// ---------------------------------------------------------------------------

function memFs() {
  const files = new Map<string, string>();
  return {
    files,
    documentDirectory: "mem://doc/",
    async getInfoAsync(u: string) {
      return files.has(u) ? { exists: true, size: files.get(u)!.length } : { exists: [...files.keys()].some((k) => k.startsWith(u)) };
    },
    async makeDirectoryAsync() {},
    async readAsStringAsync(u: string) {
      if (!files.has(u)) throw new Error("ENOENT");
      return files.get(u)!;
    },
    async writeAsStringAsync(u: string, d: string) {
      files.set(u, d);
    },
    async moveAsync({ from, to }: { from: string; to: string }) {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    async deleteAsync(u: string) {
      files.delete(u);
    },
    async readDirectoryAsync() {
      return [...files.keys()].map((k) => k.split("/").pop()!);
    },
  };
}

describe("ED-269-Gerätebestand (Format unverändert, keine Migration nötig)", () => {
  afterEach(() => {
    __setEd269FsForTests(undefined);
    __resetEd269StoreForTests();
  });

  it("schreibt byte-identisch zu JSON.stringify und liest alte Dateien identisch", async () => {
    const fs = memFs();
    __setEd269FsForTests(fs as any);
    const feats = Array.from({ length: 300 }, (_, i) => ({ type: "Feature" as const, geometry: bigFeature(i, 30).geometry, properties: { name: `MT ${i}`, identifier: `MT${i}` } }));
    const ds = await importEd269Dataset("MT", feats as any, { source: "Test", importedAt: 1_700_000_000_000, fileName: "mt.geojson" });
    const file = fs.files.get("mem://doc/geozones-direct/ed269-mt.json")!;
    assert.equal(file, JSON.stringify(ds));
    // „Alte“ Datei (mit JSON.stringify geschrieben) frisch lesen
    __resetEd269StoreForTests();
    fs.files.set("mem://doc/geozones-direct/ed269-mt.json", JSON.stringify(ds));
    const back = await loadStoredEd269Dataset("MT");
    assert.deepStrictEqual(back, { ...JSON.parse(JSON.stringify(ds)), iso: "mt" });
  });
});

// ---------------------------------------------------------------------------
// Regressionstest: keine lange Blockade in den Hauptladepfaden
// ---------------------------------------------------------------------------

/** misst die längste Lücke zwischen setTimeout(0)-Rückrufen (= Blockade des JS-Threads) */
function lagMonitor() {
  let max = 0;
  let last = performance.now();
  let stop = false;
  const tick = () => {
    const now = performance.now();
    max = Math.max(max, now - last);
    last = now;
    if (!stop) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return {
    stop(): number {
      stop = true;
      return Math.max(max, performance.now() - last);
    },
  };
}

// Großzügig gegen CI-Rauschen (Ziel 12 ms je Scheibe); der alte synchrone
// Pfad blockiert mit denselben Daten ein Vielfaches (wird mitgemessen).
const LAG_BUDGET_MS = 80;

describe("Regression: Hauptladepfade blockieren nie länger als das Budget", () => {
  let dir = "";
  afterEach(() => {
    __setTileStoreEnvForTests(null);
    if (dir) nodeFs.rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("DE-Kachelspeicher: Seiten-Parse, Komprimieren, Index, Abfrage", async () => {
    // eine dipul-artige Seite: 1500 Zonen à 400 Punkte + eine sehr große (≈ 1 MB)
    const page = [...Array.from({ length: 1500 }, (_, i) => bigFeature(i, 400)), bigFeature(5000, 50_000)];
    const pageText = JSON.stringify({ type: "FeatureCollection", numberMatched: page.length, features: page });
    // Vergleich: alter synchroner Pfad (JSON.parse + appendFeatures) am Stück
    const t0 = performance.now();
    appendFeatures(emptyIndex("DE", "base"), new Set(), JSON.parse(pageText).features, 0);
    const syncMs = performance.now() - t0;

    const fakeFetch = (async (input: any) => {
      const u = new URL(String(input));
      const layer = (u.searchParams.get("TYPENAMES") || "").replace("dipul:", "");
      const count = Number(u.searchParams.get("COUNT"));
      if (layer !== "kontrollzonen") return { ok: true, status: 200, text: async () => '{"numberMatched":0,"features":[]}' } as any;
      const text = count === 0 ? JSON.stringify({ numberMatched: page.length, features: [] }) : pageText;
      return { ok: true, status: 200, text: async () => text } as any;
    }) as typeof fetch;
    dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "yield-tiles-"));
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir, fakeFetch), isOffline: () => false, isWifi: async () => true, fetch: fakeFetch, retryDelaysMs: [1] });

    // Aufwärmen: lazy require der Geräte-Adapter (nur unter Node langsam)
    await queryTiledGeozones("DE", [5, 46, 16, 56]);
    const mon = lagMonitor();
    const res = await downloadTileStore("DE", {});
    const zones = await queryTiledGeozones("DE", [5, 46, 16, 56], { limit: 1200, includeTemp: false });
    const lag = mon.stop();
    assert.equal(res[0].state, "complete");
    assert.equal(zones?.length, 1200);
    assert.ok(lag < LAG_BUDGET_MS, `längste Blockade ${lag.toFixed(1)} ms (alt synchron: ${syncMs.toFixed(0)} ms)`);
    assert.ok(syncMs > lag, `alt ${syncMs.toFixed(0)} ms vs. neu max. ${lag.toFixed(1)} ms`);
  });

  it("ED-269: großer Bestand parsen, schreiben, lesen, umwandeln", async () => {
    const feats = Array.from({ length: 3000 }, (_, i) => ({ type: "Feature" as const, geometry: bigFeature(i, 300).geometry, properties: { name: `Z ${i}`, identifier: `Z${i}`, restriction: "PROHIBITED", lowerMeters: 0, upperMeters: 120 } }));
    const text = JSON.stringify({ type: "FeatureCollection", features: feats });
    const fs = memFs();
    __setEd269FsForTests(fs as any);
    try {
      const mon = lagMonitor();
      const parsed = await parseJsonYielding(text);
      const ds = await importEd269Dataset("MT", parsed.features, { source: "Test", importedAt: Date.now(), fileName: "x" });
      __resetEd269StoreForTests();
      const back = await loadStoredEd269Dataset("MT");
      const zones = await parseEd269ToGeozoneInfoYielding(back!.features.slice(0, 1200), "MT");
      const lag = mon.stop();
      assert.equal(ds.features.length, 3000);
      assert.equal(zones.length, 1200);
      assert.ok(lag < LAG_BUDGET_MS, `längste Blockade ${lag.toFixed(1)} ms`);
    } finally {
      __setEd269FsForTests(undefined);
      __resetEd269StoreForTests();
    }
  });
});
