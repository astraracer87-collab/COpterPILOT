/**
 * Review-Fix 6: DE-Kachelpaket ohne "wohn"-Teil.
 *  - online: Wohngrundstücke live über den DIPUL-WFS laden und zusammenführen,
 *  - offline: DE-Abdeckung "partial" mit Hinweis statt still "keine".
 */
let mockOffline = false;
jest.mock("@/lib/network", () => ({ isOfflineNow: () => mockOffline }));
jest.mock("@/lib/offlineStore", () => ({ getOfflinePackFeatures: jest.fn(async () => null) }));

let mockWohnComplete = false;
jest.mock("@/lib/geozoneTiles/tileStore", () => ({
  hasTiledGeozones: (iso: string) => String(iso).toUpperCase() === "DE",
  queryTiledGeozones: jest.fn(async () => []),
  queryTiledGeozonesAtPoint: jest.fn(async () => []),
  getTilePartMeta: (iso: string, part: string) =>
    iso === "DE" && part === "wohn" && mockWohnComplete ? { complete: true } : part === "base" ? { complete: true } : null,
}));

const WOHN_ZONE = {
  layerLabel: "Wohngrundstücke",
  name: "Wohngrundstück Musterstraße",
  details: "",
  polygonRings: [[[52.5199, 13.3999], [52.5201, 13.3999], [52.5201, 13.4001], [52.5199, 13.4001], [52.5199, 13.3999]]],
};
const mockWfs = jest.fn();
jest.mock("@/lib/geozoneQueries", () => {
  const actual = jest.requireActual("@/lib/geozoneQueries");
  return { ...actual, queryDipulWfsFeaturesFrom: (...args: any[]) => mockWfs(...args) };
});

import { queryGeozonesInAreaWithCoverage, DE_WOHN_OFFLINE_MISSING_NOTE } from "@/lib/geozones";
import { sourceCoverageWarning } from "@/lib/geozoneCoverage";

const realFetch = global.fetch;
beforeEach(() => {
  mockOffline = false;
  mockWohnComplete = false;
  mockWfs.mockReset();
  // dipul-WMS-Ergänzung (Modellflug/Hängegleiter): keine Treffer.
  (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "no features were found", json: async () => ({}) }));
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  (global as any).fetch = realFetch;
  jest.restoreAllMocks();
});

describe("DE-Paket ohne Wohngrundstücke", () => {
  it("online: Wohngrundstücke werden live per DIPUL-WFS geladen und zusammengeführt", async () => {
    mockWfs.mockResolvedValue({ zones: [WOHN_ZONE], failedLayers: [], fallbackLayers: [] });
    const r = await queryGeozonesInAreaWithCoverage(52.52, 13.4, 1, "DE");
    expect(mockWfs).toHaveBeenCalledTimes(1);
    const layers = mockWfs.mock.calls[0][1].map((l: any) => l.wmsLayer);
    expect(layers).toEqual(["wohngrundstuecke"]);
    expect(r.zones.map((z) => z.name)).toContain("Wohngrundstück Musterstraße");
    expect(r.coverage).toBe("complete");
  });

  it("online, WFS schlägt fehl: DE partial statt still 'keine'", async () => {
    mockWfs.mockRejectedValue(new Error("down"));
    const r = await queryGeozonesInAreaWithCoverage(52.52, 13.4, 1, "DE");
    expect(r.coverage).toBe("partial");
    expect(r.sources[0]).toEqual(expect.objectContaining({ iso: "DE", status: "partial" }));
  });

  it("offline: DE-Abdeckung partial mit Hinweis 'Wohngrundstücke offline nicht gespeichert – nicht geprüft'", async () => {
    mockOffline = true;
    const r = await queryGeozonesInAreaWithCoverage(52.52, 13.4, 1, "DE");
    expect(mockWfs).not.toHaveBeenCalled();
    expect(r.coverage).toBe("partial");
    expect(r.sources[0]).toEqual(
      expect.objectContaining({ iso: "DE", status: "partial", note: DE_WOHN_OFFLINE_MISSING_NOTE }),
    );
    expect(DE_WOHN_OFFLINE_MISSING_NOTE).toBe("Wohngrundstücke offline nicht gespeichert – nicht geprüft");
    expect(sourceCoverageWarning(r.sources[0], "Deutschland")).toContain(DE_WOHN_OFFLINE_MISSING_NOTE);
  });

  it("Paket MIT wohn-Teil: kein Live-Abruf, complete (online und offline)", async () => {
    mockWohnComplete = true;
    const online = await queryGeozonesInAreaWithCoverage(52.52, 13.4, 1, "DE");
    expect(online.coverage).toBe("complete");
    mockOffline = true;
    const offline = await queryGeozonesInAreaWithCoverage(52.52, 13.4, 1, "DE");
    expect(offline.coverage).toBe("complete");
    expect(mockWfs).not.toHaveBeenCalled();
  });
});
