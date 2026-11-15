/**
 * Offline-Länder (offlineMaps.ts): Jedes Land der App ist wählbar. Länder ohne
 * frei speicherbare Grundkarte laden nur Geozonen (Kacheln oder ED-269-Vektor-
 * datei) und Hindernisse – nie eine Karte von CARTO/OSM/Esri.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  defaultConfig,
  deleteCountry,
  estimateSize,
  offlineCountries,
  startCountryDownload,
  tileSourceHash,
} from "@/lib/offlineMaps";
import { COUNTRY_MAP_PROVIDERS, getMapProvider } from "@/lib/mapSources";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const mockDownloadAsync = jest.fn(async (_url: string, _path: string) => ({
  status: 200,
}));
const mockDeleteAsync = jest.fn(async (_path: string, _opts?: unknown) => {});
jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => {}),
  downloadAsync: (url: string, path: string) => mockDownloadAsync(url, path),
  deleteAsync: (path: string, opts?: unknown) => mockDeleteAsync(path, opts),
  getFreeDiskStorageAsync: jest.fn(async () => 10 * 1024 * 1024 * 1024),
  readAsStringAsync: jest.fn(async () => ""),
  writeAsStringAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
}));

const mockRefreshEd269 = jest.fn(async (_iso: string) => true);
jest.mock("@/lib/geozoneDirect/ed269Store", () => ({
  refreshEd269Dataset: (iso: string) => mockRefreshEd269(iso),
}));

jest.mock("@/lib/obstacles", () => ({
  OBSTACLE_TILE_ZOOM: 10,
  tilesForBounds: (w: number, s: number, e: number, n: number) => {
    const out: { x: number; y: number }[] = [];
    for (let x = Math.floor(w); x <= Math.floor(e); x++)
      for (let y = Math.floor(s); y <= Math.floor(n); y++) out.push({ x, y });
    return out;
  },
  hasObstacleTile: jest.fn(async () => true),
  loadObstacleTile: jest.fn(async () => null),
  deleteObstacleTiles: jest.fn(async () => {}),
}));

const FORBIDDEN =
  /openstreetmap\.org|cartocdn|arcgisonline|googleapis|google\.com/i;

beforeEach(async () => {
  mockDownloadAsync.mockClear();
  mockDeleteAsync.mockClear();
  mockRefreshEd269.mockClear();
  await AsyncStorage.clear();
});

describe("offlineCountries", () => {
  it("lists every app country, including those without an official basemap", () => {
    const isos = offlineCountries().map((c) => c.iso);
    for (const iso of [
      "DE",
      "AT",
      "HU",
      "IT",
      "DK",
      "SE",
      "FI",
      "GB",
      "PL",
      "NO",
      "ES",
      "CZ",
      "SK",
      "GR",
      "RO",
      "MT",
      "LI",
      "IS",
      "CY",
      "BG",
      "HR",
      "SI",
      "LT",
      "LV",
      "IE",
      "PT",
      "EE",
      "BE",
      "LU",
      "NL",
      "FR",
      "CH",
    ]) {
      expect(isos).toContain(iso);
    }
  });

  it("disables map packs with a German note where no basemap may be stored", () => {
    const hu = offlineCountries().find((c) => c.iso === "HU")!;
    expect(hu.hasMap).toBe(false);
    expect(hu.hasGeozones).toBe(true);
    expect(hu.geozoneKind).toBe("tiles");
    expect(hu.note).toBe(
      "Für Ungarn gibt es keine frei speicherbare Grundkarte – offline werden Geozonen und Hindernisse gespeichert; die Karte wird online angezeigt.",
    );
    const dk = offlineCountries().find((c) => c.iso === "DK")!;
    expect(dk.geozoneKind).toBe("vector");
    expect(dk.note).toMatch(
      /^Für Dänemark gibt es keine frei speicherbare Grundkarte/,
    );
    const cz = offlineCountries().find((c) => c.iso === "CZ")!;
    expect(cz.hasMap).toBe(true);
    expect(cz.note).toBeUndefined();
    const de = offlineCountries().find((c) => c.iso === "DE")!;
    expect(de.note).toBeUndefined();
  });

  it("defaults: no map for countries without basemap, geozones on where available", () => {
    expect(defaultConfig("HU")).toMatchObject({
      map: false,
      geozones: true,
      obstacles: true,
    });
    expect(defaultConfig("DK")).toMatchObject({ map: false, geozones: true });
    expect(defaultConfig("GR")).toMatchObject({
      map: false,
      geozones: false,
      obstacles: true,
    });
    expect(defaultConfig("NO")).toMatchObject({ map: true, geozones: true });
  });

  it("estimates sizes for new countries (used by the free-disk check)", () => {
    for (const iso of ["NO", "ES", "CZ", "EE", "IS", "PL", "HU", "DK", "GR"]) {
      const c = {
        ...defaultConfig(iso),
        satellite: !!getMapProvider(iso)?.satellite?.length,
      };
      const est = estimateSize(c);
      expect(Number.isFinite(est.totalMB)).toBe(true);
      expect(est.totalMB).toBeGreaterThan(0);
      expect(est.obstaclesMB).toBeGreaterThan(0);
      if (!getMapProvider(iso)?.map) expect(est.mapMB).toBe(0);
    }
    expect(estimateSize(defaultConfig("DK")).geoMB).toBeGreaterThan(0);
  });

  it("never offers bulk download from OSM/CARTO/Esri/Google", () => {
    for (const p of COUNTRY_MAP_PROVIDERS) {
      if (p.map) expect(p.map.tiles).not.toMatch(FORBIDDEN);
      for (const s of p.satellite ?? []) expect(s.tiles).not.toMatch(FORBIDDEN);
    }
  });
});

describe("startCountryDownload without basemap", () => {
  it("vector country: loads the ED-269 file, no tiles", async () => {
    const packs: any[] = [];
    await startCountryDownload(
      { ...defaultConfig("DK"), map: true, satellite: true, obstacles: false },
      (p) => packs.push(p),
      () => {},
      () => false,
    );
    expect(mockRefreshEd269).toHaveBeenCalledWith("DK");
    expect(mockDownloadAsync).not.toHaveBeenCalled();
    expect(packs[packs.length - 1]).toMatchObject({
      key: "DK:geo:vector",
      state: "complete",
    });
  });

  it("raster geozone country (HU): only geozone tiles, no map tiles", async () => {
    await startCountryDownload(
      { ...defaultConfig("HU"), map: true, geoMaxZoom: 11, obstacles: false },
      () => {},
      () => {},
      () => false,
    );
    expect(mockDownloadAsync).toHaveBeenCalled();
    for (const [url] of mockDownloadAsync.mock.calls) {
      expect(url).toMatch(/mydronespace\.hu/);
      expect(url).not.toMatch(FORBIDDEN);
    }
  });

  it("reports an error when the vector download fails", async () => {
    mockRefreshEd269.mockResolvedValueOnce(false);
    const packs: any[] = [];
    await startCountryDownload(
      { ...defaultConfig("NO"), map: false, obstacles: false },
      (p) => packs.push(p),
      () => {},
      () => false,
    );
    expect(
      packs.find((p) => p.key === "NO:geo:vector" && p.state === "error"),
    ).toBeTruthy();
  });
});

describe("deleteCountry", () => {
  it("keeps tiles shared with another country (LI uses the CH swisstopo tiles)", async () => {
    const tpl = getMapProvider("CH")!.map!.tiles;
    expect(getMapProvider("LI")!.map!.tiles).toBe(tpl);
    await AsyncStorage.setItem(
      "@copterpilot/offline_progress",
      JSON.stringify({
        "CH:map": { done: 1, total: 1, bytes: 1, maxZoom: 12, template: tpl },
        "LI:map": { done: 1, total: 1, bytes: 1, maxZoom: 12, template: tpl },
      }),
    );
    await deleteCountry("LI");
    const deleted = mockDeleteAsync.mock.calls.map((c) => c[0]);
    expect(deleted.some((p) => String(p).includes(tileSourceHash(tpl)))).toBe(
      false,
    );
    const left = JSON.parse(
      (await AsyncStorage.getItem("@copterpilot/offline_progress")) ?? "{}",
    );
    expect(Object.keys(left)).toEqual(["CH:map"]);
  });
});
