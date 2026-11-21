/**
 * Hindernisse nur in aktiven Ländern: für Länder mit Nutzung „Aus“ wird keine
 * Overpass-Kachel geladen (kein fetch), weder einzeln noch für einen
 * Kartenausschnitt; aktive Länder laden wie bisher.
 */
// obstacles.ts prüft vor Overpass-Abfragen den Offline-Status (NetInfo); das
// native NetInfo-Modul fehlt unter Jest → Status hier fest „online“.
jest.mock("@/lib/network", () => ({ isOfflineNow: () => false }));
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  readAsStringAsync: jest.fn(async () => ""),
  writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
}));

import { latToTileY, loadObstacleTile, loadObstaclesForBounds, lonToTileX, OBSTACLE_TILE_ZOOM } from "@/lib/obstacles";
import { __resetCountryUsageForTests, __setCountryUsageForTests } from "@/lib/countryUsage";

const mockFetch = jest.fn(async (..._a: unknown[]) => ({ ok: true, status: 200, json: async () => ({ elements: [] }) }));
const realFetch = globalThis.fetch;

beforeEach(() => {
  mockFetch.mockClear();
  (globalThis as any).fetch = mockFetch;
  __setCountryUsageForTests({ DE: "off", AT: "online" });
});
afterEach(() => {
  (globalThis as any).fetch = realFetch;
  __resetCountryUsageForTests(undefined);
});

const tileAt = (lat: number, lon: number) => ({ x: lonToTileX(lon, OBSTACLE_TILE_ZOOM), y: latToTileY(lat, OBSTACLE_TILE_ZOOM) });

test("deaktiviertes Land (DE aus): keine Overpass-Abfrage, keine Daten", async () => {
  const kassel = tileAt(51.31, 9.48);
  expect(await loadObstacleTile(kassel.x, kassel.y)).toBeNull();
  const fc = await loadObstaclesForBounds(9.3, 51.2, 9.7, 51.4);
  expect(fc.features).toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});

test("aktives Land (AT online): Kachel wird geladen", async () => {
  const wien = tileAt(48.2, 16.37);
  const r = await loadObstacleTile(wien.x, wien.y);
  expect(r).not.toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test("DE wieder aktiv → lädt", async () => {
  __setCountryUsageForTests({ DE: "online" });
  const kassel = tileAt(51.31, 9.48);
  await loadObstacleTile(kassel.x, kassel.y);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
