/**
 * Offline-Länder (offlineMaps.ts): Jedes Land der App ist wählbar. Länder ohne
 * frei speicherbare Grundkarte laden nur Geozonen (Kacheln oder ED-269-Vektor-
 * datei) und Hindernisse – nie eine Karte von CARTO/OSM/Esri.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  autoSyncCountry,
  defaultConfig,
  deleteCountry,
  deleteCountryExtras,
  loadOfflineConfigs,
  estimateSize,
  offlineCountries,
  startCountryDownload,
  storePartsFor,
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

// Automatische Synchronisation (ED-269 nach Teil-A-Regeln) ohne Netz-/NetInfo-Graph
const mockRevalidate = jest.fn(async (isos: string[], _p: string) => isos.map((iso) => ({ iso, action: "refreshed" })));
jest.mock("@/lib/geozoneSources/revalidate", () => ({
  revalidateGeozoneSources: (isos: string[], p: string) => mockRevalidate(isos, p),
}));

const mockDownloadTileStore = jest.fn(async (iso: string, opts: any) => {
  const parts = iso === "DE" && opts?.wohn ? ["base", "wohn"] : ["base"];
  return parts.map((part) => {
    const p = { iso, part, done: 3, total: 3, bytes: 1000, state: "complete" };
    opts?.onProgress?.(p);
    return p;
  });
});
const mockDeleteTileStore = jest.fn(async (_iso: string, _part?: string) => {});
jest.mock("@/lib/geozoneTiles/tileStore", () => ({
  downloadTileStore: (iso: string, opts: any) => mockDownloadTileStore(iso, opts),
  deleteTileStore: (iso: string, part?: string) => mockDeleteTileStore(iso, part),
  getTilePartMeta: () => null,
  loadTileStoreMeta: async () => {},
  hasTiledGeozones: () => false,
  queryTiledGeozones: async () => null,
  queryTiledGeozonesAtPoint: async () => null,
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
  mockDownloadTileStore.mockClear();
  mockDeleteTileStore.mockClear();
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
    // GR: Bild-Overlay nur online (zeitgefiltert), Vektorzonen nur per Datei-Import
    expect(defaultConfig("GR")).toMatchObject({
      map: false,
      geozones: true,
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
    // CH/LI: keine swisstopo-Grundkarte mehr (normale Karte), Luftbild gemeinsam
    expect(getMapProvider("CH")!.map).toBeUndefined();
    const tpl = getMapProvider("CH")!.satellite![0].tiles;
    expect(getMapProvider("LI")!.satellite![0].tiles).toBe(tpl);
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

describe("tiled vector geozones (DE/FR/CZ) and Liechtenstein", () => {
  it("uses the tiled vector store for DE/FR/CZ and the CH file for LI", () => {
    const byIso = Object.fromEntries(offlineCountries().map((c) => [c.iso, c]));
    for (const iso of ["DE", "FR", "CZ"]) {
      expect(byIso[iso].geozoneKind).toBe("tilestore");
      expect(byIso[iso].hasGeozones).toBe(true);
      expect(byIso[iso].geozoneAttribution?.label).toBeTruthy();
    }
    expect(byIso.DE.geozoneAttribution?.label).toBe("dipul, CC-BY-ND 4.0");
    expect(byIso.DE.geozoneAttribution?.url).toBe("https://creativecommons.org/licenses/by-nd/4.0/legalcode.de");
    // Liechtenstein: kein eigener Eintrag – „Schweiz / Liechtenstein“ (gleiche Daten)
    expect(byIso.LI).toBeUndefined();
    expect(byIso.CH.label).toBe("Schweiz / Liechtenstein");
    // CH: Bildkacheln (Zusatz-Ebenen) + BAZL-Landesdatei (deckt LI ab)
    expect(byIso.CH.geozoneKind).toBe("tiles");
    expect(defaultConfig("LI").geozones).toBe(true);
    expect(defaultConfig("DE").wohngebiete).toBe(true);
  });

  it("Malta: online vector dataset since 2026-11 via DDP (import stays as fallback)", async () => {
    const mt = offlineCountries().find((c) => c.iso === "MT")!;
    expect(mt.geozoneKind).toBe("vector");
    await startCountryDownload({ ...defaultConfig("MT"), map: false, obstacles: false }, () => {}, () => {}, () => false);
    expect(mockRefreshEd269).toHaveBeenCalledWith("MT");
  });

  it("Griechenland: geozones only via file import (no download attempt, no GR raster tiles)", async () => {
    for (const iso of ["GR"]) {
      const c = offlineCountries().find((x) => x.iso === iso)!;
      expect(c.geozoneKind).toBe("import");
      expect(c.hasGeozones).toBe(true);
      expect(estimateSize(defaultConfig(iso)).geoMB).toBe(0);
      await startCountryDownload({ ...defaultConfig(iso), obstacles: false }, () => {}, () => {}, () => false);
    }
    expect(mockRefreshEd269).not.toHaveBeenCalled();
    expect(mockDownloadAsync).not.toHaveBeenCalled();
  });

  it("Romania: online vector dataset since 2026-11 (import stays as fallback)", async () => {
    const ro = offlineCountries().find((c) => c.iso === "RO")!;
    expect(ro.geozoneKind).toBe("vector");
    await startCountryDownload({ ...defaultConfig("RO"), map: false, obstacles: false }, () => {}, () => {}, () => false);
    expect(mockRefreshEd269).toHaveBeenCalledWith("RO");
  });

  it("Spain: tiled store with selectable parts (infra/enp) and size estimates", async () => {
    const es = offlineCountries().find((c) => c.iso === "ES")!;
    expect(es.geozoneKind).toBe("tilestore");
    expect(es.geozoneAttribution?.label).toBe("© ENAIRE – AIS");
    const c = { ...defaultConfig("ES"), map: false, obstacles: false };
    expect(c).toMatchObject({ esInfra: true, esEnp: true });
    expect(storePartsFor(c)).toEqual(["base", "infra", "enp"]);
    expect(storePartsFor({ ...c, esEnp: false })).toEqual(["base", "infra"]);
    const all = estimateSize(c);
    const none = estimateSize({ ...c, esInfra: false, esEnp: false });
    expect(all.esInfraMB).toBeGreaterThan(50);
    expect(all.esEnpMB).toBeGreaterThan(100);
    expect(none.esInfraMB + none.esEnpMB).toBe(0);
    expect(all.geoMB - none.geoMB).toBe(all.esInfraMB + all.esEnpMB);
    const packs: any[] = [];
    await startCountryDownload({ ...c, esEnp: false }, (p) => packs.push(p), () => {}, () => false);
    expect(mockDownloadTileStore).toHaveBeenCalledWith("ES", expect.objectContaining({ parts: ["infra"] }));
    expect(mockRefreshEd269).not.toHaveBeenCalledWith("ES");
  });

  it("estimates DE with and without Wohngebiete", () => {
    const base = { ...defaultConfig("DE"), map: false, obstacles: false };
    const withWohn = estimateSize(base);
    const without = estimateSize({ ...base, wohngebiete: false });
    expect(withWohn.wohnMB).toBeGreaterThan(100);
    expect(without.wohnMB).toBe(0);
    expect(withWohn.geoMB - without.geoMB).toBe(withWohn.wohnMB);
    expect(estimateSize({ ...defaultConfig("CZ"), map: false, obstacles: false }).geoMB).toBeGreaterThan(30);
  });

  it("LI: loads the Swiss BAZL dataset (contains Liechtenstein)", async () => {
    const packs: any[] = [];
    await startCountryDownload({ ...defaultConfig("LI"), map: false, obstacles: false }, (p) => packs.push(p), () => {}, () => false);
    expect(mockRefreshEd269).toHaveBeenCalledWith("LI");
    expect(packs[packs.length - 1]).toMatchObject({ key: "LI:geo:vector", state: "complete" });
  });

  it("DE: downloads the vector store incl. Wohngebiete, no WMS raster tiles", async () => {
    const packs: any[] = [];
    await startCountryDownload({ ...defaultConfig("DE"), map: false, obstacles: false }, (p) => packs.push(p), () => {}, () => false);
    expect(mockDownloadTileStore).toHaveBeenCalledWith("DE", expect.objectContaining({ wohn: true }));
    expect(mockDownloadAsync).not.toHaveBeenCalled();
    const keys = new Set(packs.filter((p) => p.state === "complete").map((p) => p.key));
    expect(keys).toEqual(new Set(["DE:geo:store", "DE:geo:wohn"]));
  });

  it("DE: deselecting Wohngebiete drops that part, deleting the country drops the store", async () => {
    await startCountryDownload({ ...defaultConfig("DE"), map: false, obstacles: false }, () => {}, () => {}, () => false);
    await startCountryDownload({ ...defaultConfig("DE"), map: false, obstacles: false, wohngebiete: false }, () => {}, () => {}, () => false);
    expect(mockDeleteTileStore).toHaveBeenCalledWith("DE", "wohn");
    expect(mockDownloadTileStore).toHaveBeenLastCalledWith("DE", expect.objectContaining({ wohn: false }));
    await deleteCountry("DE");
    expect(mockDeleteTileStore).toHaveBeenCalledWith("DE", undefined);
  });
});

describe("Länder-Nutzung „online“: Basis-Geozonen werden geladen und gehalten", () => {
  it("CZ online: lädt das ED-318-Paket (nur Teil „base“), keine Karte, keine Hindernisse, keine Konfiguration", async () => {
    const r = await autoSyncCountry("CZ", true, () => {}, "base");
    expect(r.status).toBe("updated");
    expect(mockDownloadTileStore).toHaveBeenCalledWith("CZ", expect.objectContaining({ parts: [], wohn: false }));
    expect(mockDownloadAsync).not.toHaveBeenCalled();
    expect((await loadOfflineConfigs()).map((c) => c.iso)).not.toContain("CZ");
  });

  it("CZ online ohne WLAN (mobile Daten nicht erlaubt): wartet auf WLAN", async () => {
    const r = await autoSyncCountry("CZ", false, () => {}, "base");
    expect(r.status).toBe("pending-wifi");
    expect(mockDownloadTileStore).not.toHaveBeenCalled();
  });

  it("ES online: nur Luftfahrt-Teil („base“), Infrastruktur/Naturschutz nicht gespeichert", async () => {
    await autoSyncCountry("ES", true, () => {}, "base");
    expect(mockDownloadTileStore).toHaveBeenCalledWith("ES", expect.objectContaining({ parts: [] }));
  });

  it("AT online: ED-269-Landesdatei wird geladen und aktuell gehalten (Teil-A-Regeln, keine 24-h-Grenze)", async () => {
    mockRevalidate.mockClear();
    const r = await autoSyncCountry("AT", true, () => {}, "base");
    expect(r.status).toBe("updated");
    expect(mockRevalidate).toHaveBeenCalledWith(["AT"], "map");
    expect(mockDownloadAsync).not.toHaveBeenCalled();
  });

  it("offline → online: Zusätze (Karte, Wohngrundstücke, Hindernisse) gelöscht, Basis-Kachelspeicher bleibt", async () => {
    await startCountryDownload({ ...defaultConfig("DE"), map: false, obstacles: false }, () => {}, () => {}, () => false);
    mockDeleteTileStore.mockClear();
    await deleteCountryExtras("DE");
    expect(mockDeleteTileStore).toHaveBeenCalledWith("DE", "wohn");
    expect(mockDeleteTileStore).not.toHaveBeenCalledWith("DE", "base");
    expect(mockDeleteTileStore).not.toHaveBeenCalledWith("DE", undefined);
    expect((await loadOfflineConfigs()).map((c) => c.iso)).not.toContain("DE");
  });

  it("Karten-Paket meldet sich bei der Download-Anzeige an und ab", async () => {
    const { getActiveDownloads } = jest.requireActual("@/lib/downloadActivity");
    const seen: string[] = [];
    let n = 0;
    await startCountryDownload(
      { ...defaultConfig("AT"), obstacles: false, geozones: false },
      (p) => {
        if (p.state === "active") for (const t of getActiveDownloads()) seen.push(`${t.iso}|${t.labelDe}`);
      },
      () => {},
      () => ++n > 3,
    );
    expect(seen).toContain("AT|Karte");
    expect(getActiveDownloads()).toEqual([]);
  });
});


describe("Schweiz / Liechtenstein: ein Eintrag, BAZL-Datei deckt beide ab", () => {
  it("CH offline lädt die BAZL-Landesdatei (inkl. LI) zusätzlich zu den Bildkacheln", async () => {
    const packs: any[] = [];
    let checks = 0;
    // nach der Landesdatei anhalten (Bildkacheln hier nicht laden)
    await startCountryDownload({ ...defaultConfig("CH"), map: false, obstacles: false, geozones: true }, (p) => packs.push(p), () => {}, () => checks++ > 0);
    expect(mockRefreshEd269).toHaveBeenCalledWith("CH");
    expect(packs.some((p) => p.key === "CH:geo:vector" && p.state === "complete")).toBe(true);
  });
  it("CH online (Basis) lädt nur die BAZL-Landesdatei", async () => {
    mockRevalidate.mockClear();
    await autoSyncCountry("CH", true, () => {}, "base");
    expect(mockRevalidate).toHaveBeenCalledWith(["CH"], "map");
    expect(mockDownloadAsync).not.toHaveBeenCalled();
  });
});
