// Hindernis-Kacheln: Speicher-Treffer ohne Internet, veraltete Daten sofort +
// stille Aktualisierung, nur fehlende Kacheln laden, Pause nach Fehlern,
// Vorab-Laden, Länderfilter.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createObstacleTileCache, tileKeyOf, tilesAround, tilesForBounds, lonToTileX, latToTileY, OBSTACLE_TILE_ZOOM, type ObstacleTileData } from "../obstacleTileCache";

const fcOf = (n: number): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: n }, (_, i) => ({ type: "Feature", properties: { k: "wind", h: 100 + i }, geometry: { type: "Point", coordinates: [9, 51] } })),
});

function setup(opts: { disk?: Record<string, ObstacleTileData>; fail?: boolean; allowed?: (x: number, y: number) => boolean } = {}) {
  let t = 1_000_000_000;
  const disk = new Map(Object.entries(opts.disk ?? {}));
  const fetched: string[] = [];
  let reads = 0;
  const cache = createObstacleTileCache({
    now: () => t,
    maxAgeMs: 1000,
    storage: {
      read: async (k) => { reads++; return disk.get(k) ?? null; },
      write: async (k, d) => void disk.set(k, d),
    },
    fetchTile: async (x, y) => {
      fetched.push(tileKeyOf(x, y));
      if (opts.fail) throw new Error("Overpass 504");
      return fcOf(1);
    },
    isAllowed: opts.allowed,
  });
  return { cache, disk, fetched, reads: () => reads, advance: (ms: number) => { t += ms; }, now: () => t };
}

const flush = () => new Promise((r) => setImmediate(r));
const kassel = { x: lonToTileX(9.48, OBSTACLE_TILE_ZOOM), y: latToTileY(51.31, OBSTACLE_TILE_ZOOM) };

describe("Obstacle-Kachelspeicher", () => {
  it("Treffer auf dem Gerät: sofort, ohne Internet; danach aus dem Arbeitsspeicher", async () => {
    const key = tileKeyOf(kassel.x, kassel.y);
    const s = setup({ disk: { [key]: { t: 1_000_000_000, fc: fcOf(3) } } });
    const d = await s.cache.get(kassel.x, kassel.y);
    assert.equal(d?.fc.features.length, 3);
    assert.deepEqual(s.fetched, []);
    await s.cache.get(kassel.x, kassel.y);
    assert.equal(s.reads(), 1, "zweiter Zugriff aus dem Arbeitsspeicher");
    assert.ok(s.cache.peek(kassel.x, kassel.y));
  });

  it("veraltete Kachel: alte Daten sofort, Aktualisierung still im Hintergrund", async () => {
    const key = tileKeyOf(kassel.x, kassel.y);
    const s = setup({ disk: { [key]: { t: 1_000_000_000, fc: fcOf(2) } } });
    s.advance(5000);
    const d = await s.cache.get(kassel.x, kassel.y);
    assert.equal(d?.fc.features.length, 2, "alte Daten sofort");
    await flush();
    assert.deepEqual(s.fetched, [key]);
    assert.equal(s.disk.get(key)?.fc.features.length, 1, "neu gespeichert");
  });

  it("Ausschnitt: gespeicherte Kacheln zuerst (ein Zwischenstand), nur fehlende aus dem Internet", async () => {
    const tiles = tilesForBounds(9.3, 51.2, 9.9, 51.4);
    assert.ok(tiles.length >= 2);
    const cachedKey = tileKeyOf(tiles[0].x, tiles[0].y);
    const s = setup({ disk: { [cachedKey]: { t: 1_000_000_000, fc: fcOf(4) } } });
    const partials: number[] = [];
    const sentTiles: string[] = [];
    const fc = await s.cache.loadForBounds(9.3, 51.2, 9.9, 51.4, {
      onPartial: (p) => partials.push(p.features.length),
      onTile: (k) => sentTiles.push(k),
    });
    assert.equal(partials[0], 4, "erster Zwischenstand nur aus dem Speicher");
    assert.equal(s.fetched.length, tiles.length - 1);
    assert.ok(!s.fetched.includes(cachedKey));
    assert.equal(fc.features.length, 4 + (tiles.length - 1));
    assert.equal(new Set(sentTiles).size, tiles.length);
    // zweiter Aufruf: alles aus dem Speicher
    const before = s.fetched.length;
    await s.cache.loadForBounds(9.3, 51.2, 9.9, 51.4);
    assert.equal(s.fetched.length, before);
  });

  it("Fehler: wachsende Pause statt sofortiger Wiederholung", async () => {
    const s = setup({ fail: true });
    assert.equal(await s.cache.get(kassel.x, kassel.y), null);
    assert.equal(await s.cache.get(kassel.x, kassel.y), null);
    assert.equal(s.fetched.length, 1, "keine sofortige Wiederholung");
    s.advance(2 * 60 * 1000 + 1);
    await s.cache.get(kassel.x, kassel.y);
    assert.equal(s.fetched.length, 2);
    s.advance(2 * 60 * 1000 + 1); // zweite Pause ist doppelt so lang
    await s.cache.get(kassel.x, kassel.y);
    assert.equal(s.fetched.length, 2);
  });

  it("deaktiviertes Land: weder Speicher noch Internet", async () => {
    const s = setup({ allowed: () => false });
    assert.equal(await s.cache.get(kassel.x, kassel.y), null);
    assert.equal(await s.cache.prefetchAround(51.31, 9.48), 0);
    assert.deepEqual(s.fetched, []);
  });

  it("Vorab-Laden: 3×3 Kacheln, Mitte zuerst, vorhandene übersprungen", async () => {
    const around = tilesAround(51.31, 9.48, 1);
    assert.equal(around.length, 9);
    assert.deepEqual(around[0], kassel);
    const s = setup({ disk: { [tileKeyOf(kassel.x, kassel.y)]: { t: 1_000_000_000, fc: fcOf(1) } } });
    const n = await s.cache.prefetchAround(51.31, 9.48, 1);
    assert.equal(n, 8);
    assert.equal(await s.cache.prefetchAround(51.31, 9.48, 1), 0, "zweites Mal nichts zu tun");
  });

  it("Lade-Hinweis: meldet laufende Internet-Abfragen", async () => {
    const s = setup();
    const seen: number[] = [];
    s.cache.subscribeLoading((n) => seen.push(n));
    await s.cache.get(kassel.x, kassel.y);
    assert.deepEqual(seen, [1, 0]);
  });
});
