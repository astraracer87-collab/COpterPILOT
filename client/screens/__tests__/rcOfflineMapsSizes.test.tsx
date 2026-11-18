/**
 * Einstellungen → Länder & Offline-Daten: geschätzter Speicherbedarf je
 * Nutzungsstufe („Online ≈ … · Offline ≈ …“) neben der Auswahl, bevor sie
 * gewählt wird; Offline folgt den Paket-Optionen.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({ useBottomTabBarHeight: () => 0 }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock("@/lib/webBrowser", () => ({ openLink: jest.fn(async () => {}) }));
jest.mock("@/lib/zoneTranslationStore", () => ({
}));
jest.mock("@/lib/geozoneDirect/dflightAuth", () => ({
  getDflightCredentials: jest.fn(async () => null),
  setDflightCredentials: jest.fn(async () => ({ ok: true })),
  clearDflightCredentials: jest.fn(async () => {}),
}));
jest.mock("@/lib/geozoneDirect/geozoneFileImport", () => ({
  GEOZONE_IMPORT_FORMAT_LABELS: {},
  pickAndImportGeozoneFile: jest.fn(async () => ({ ok: false, canceled: true })),
}));
jest.mock("@/lib/obstacles", () => ({
  OBSTACLE_TILE_ZOOM: 10,
  tilesForBounds: () => [],
  hasObstacleTile: jest.fn(async () => true),
  loadObstacleTile: jest.fn(async () => null),
  deleteObstacleTiles: jest.fn(async () => {}),
  getObstaclesEnabled: jest.fn(async () => true),
  setObstaclesEnabled: jest.fn(async () => {}),
}));

const MB = 1024 * 1024;
jest.mock("@/lib/offlineMaps", () => {
  const actual = jest.requireActual("@/lib/offlineMaps");
  return {
    ...actual,
    freeDiskMB: jest.fn(async () => 5000),
    loadOfflineConfigs: jest.fn(async () => []),
    packStatuses: jest.fn(async () => []),
    obstacleTilesStored: jest.fn(async () => ({ done: 0, total: 0 })),
    storedCountrySizes: jest.fn(async () => ({
      byIso: {
        DE: { iso: "DE", packBytes: 300 * MB, datasetBytes: 0, importBytes: 0, obstacleBytes: 20 * MB, totalBytes: 320 * MB },
        MT: { iso: "MT", packBytes: 0, datasetBytes: 0, importBytes: 2 * MB, obstacleBytes: 0, totalBytes: 2 * MB },
      },
      totalBytes: 322 * MB,
    })),
  };
});

const mockApply = jest.fn(async (iso: string, usage: string) => {
  const cu = jest.requireActual("@/lib/countryUsage");
  await cu.setCountryUsage(iso, usage);
  return null;
});
const mockCleanup = jest.fn(async () => []);
jest.mock("@/lib/countryUsageData", () => ({
  applyCountryUsage: (iso: string, usage: string) => mockApply(iso, usage),
  cleanupDisabledCountries: () => mockCleanup(),
  getOfflineSyncState: () => ({}),
  onOfflineSyncChange: () => () => {},
  syncOfflineCountries: jest.fn(async () => []),
}));

import RcOfflineMapsScreen from "@/screens/RcOfflineMapsScreen";
import { __resetCountryUsageForTests, __setCountryUsageForTests } from "@/lib/countryUsage";
import {
  defaultConfig,
  estimateBaseGeozonesMB,
  estimateSize,
  estimateUsageSizes,
  formatMB,
  formatUsageSizes,
  TILE_STORE_ES_PART_MB,
  TILE_STORE_MB,
  TILE_STORE_WOHN_MB,
} from "@/lib/offlineMaps";

function textOf(node: { props: { children?: unknown } }): string {
  const c = node.props.children;
  return Array.isArray(c) ? c.join("") : String(c ?? "");
}

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<RcOfflineMapsScreen />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return tree;
}

const sizesText = (tree: ReactTestRenderer, iso: string) =>
  textOf(tree.root.findAll((n) => n.props.testID === `usage-sizes-${iso}` && n.type === Text)[0]);

beforeEach(() => {
  __resetCountryUsageForTests(null);
  __setCountryUsageForTests({ DE: "offline", AT: "online", MT: "off" });
});
afterEach(() => {
  __resetCountryUsageForTests(undefined);
  jest.restoreAllMocks();
});

describe("Größen-Schätzung je Nutzungsstufe", () => {
  test("Basis-Geozonen (= Online) aus Kachelspeicher bzw. ED-269-Datei", () => {
    expect(estimateBaseGeozonesMB("DE")).toBe(TILE_STORE_MB.DE);
    expect(estimateBaseGeozonesMB("FR")).toBe(TILE_STORE_MB.FR);
    expect(estimateBaseGeozonesMB("CZ")).toBe(TILE_STORE_MB.CZ);
    expect(estimateBaseGeozonesMB("CH")).toBe(18);
    expect(estimateBaseGeozonesMB("LI")).toBe(18);
    expect(estimateBaseGeozonesMB("NL")).toBe(23);
    expect(estimateBaseGeozonesMB("AT")).toBeLessThanOrEqual(5);
    expect(estimateBaseGeozonesMB("AT")).toBeGreaterThan(0);
    // Nur Datei-Import (GR): nichts zu laden; MT seit 2026-11 online (≈ 0,4 MB)
    expect(estimateBaseGeozonesMB("GR")).toBe(0);
    expect(estimateBaseGeozonesMB("MT")).toBe(1);
    expect(estimateBaseGeozonesMB("PL")).toBe(10);
  });

  test("Offline = Basis + Karte/Luftbild/Hindernisse/Zusatzteile laut Optionen", () => {
    const de = defaultConfig("DE");
    const e = estimateSize(de);
    const s = estimateUsageSizes(de);
    expect(s.onlineMB).toBe(TILE_STORE_MB.DE);
    expect(s.offlineMB).toBeCloseTo(TILE_STORE_MB.DE + TILE_STORE_WOHN_MB + e.mapMB + e.satMB + e.obstaclesMB, 5);
    const noWohn = estimateUsageSizes({ ...de, wohngebiete: false });
    expect(s.offlineMB - noWohn.offlineMB).toBeCloseTo(TILE_STORE_WOHN_MB, 5);
    // Basis bleibt auch bei abgewählten Geozonen (wird für jedes aktive Land gehalten)
    expect(estimateUsageSizes({ ...de, geozones: false }).offlineMB).toBeGreaterThanOrEqual(TILE_STORE_MB.DE);
    const es = estimateUsageSizes({ ...defaultConfig("ES"), map: false, obstacles: false });
    expect(es.offlineMB).toBeCloseTo(TILE_STORE_MB.ES + TILE_STORE_ES_PART_MB.infra + TILE_STORE_ES_PART_MB.enp, 5);
    expect(estimateUsageSizes({ ...defaultConfig("ES"), map: false, obstacles: false, esEnp: false }).offlineMB).toBeCloseTo(
      TILE_STORE_MB.ES + TILE_STORE_ES_PART_MB.infra,
      5,
    );
  });

  test("deutsche Formatierung", () => {
    expect(formatMB(205)).toBe("205 MB");
    expect(formatMB(1126)).toBe("1,1 GB");
    expect(formatUsageSizes({ onlineMB: 205, offlineMB: 1126 })).toBe("Online ≈ 205 MB · Offline ≈ 1,1 GB");
    expect(formatUsageSizes({ onlineMB: 0, offlineMB: 4.2 })).toBe("Online: kein Download · Offline ≈ 4,2 MB");
  });
});

test("Einstellungen zeigen je Land die Größe je Stufe neben der Auswahl – auch bei „Aus“", async () => {
  const tree = await render();
  expect(sizesText(tree, "DE")).toBe(formatUsageSizes(estimateUsageSizes(defaultConfig("DE"))));
  expect(sizesText(tree, "DE")).toMatch(/^Online ≈ 240 MB · Offline ≈ \d/);
  // FR ist aus: Schätzung trotzdem sichtbar (vor der Wahl)
  expect(sizesText(tree, "FR")).toMatch(/^Online ≈ 115 MB · Offline ≈ /);
  expect(sizesText(tree, "CH")).toMatch(/^Online ≈ 18 MB · Offline ≈ /);
  expect(sizesText(tree, "GR")).toMatch(/^Online: kein Download · Offline ≈ /);
  expect(sizesText(tree, "MT")).toMatch(/^Online ≈ 1,0 MB · Offline ≈ /);
  act(() => tree.unmount());
});

test("Abwählen der Wohngebiete verringert die Offline-Schätzung sofort", async () => {
  const tree = await render();
  const before = sizesText(tree, "DE");
  // Land aufklappen (Kopfzeile) und Wohngebiete abwählen
  let head = tree.root.findAll((n) => n.props.testID === "country-status-DE")[0];
  while (head && !head.props.onPress) head = head.parent!;
  await act(async () => head.props.onPress());
  const label = tree.root.findAll((n) => n.type === Text && textOf(n) === "Wohngebiete (Wohngrundstücke) offline speichern")[0];
  let row = label.parent!;
  const switches = (n: typeof row) => n.findAll((x) => typeof x.props.onValueChange === "function");
  while (switches(row).length === 0) row = row.parent!;
  const sw = switches(row)[0];
  await act(async () => sw.props.onValueChange(false));
  const after = sizesText(tree, "DE");
  expect(after).not.toBe(before);
  expect(after).toBe(formatUsageSizes(estimateUsageSizes({ ...defaultConfig("DE"), wohngebiete: false })));
  act(() => tree.unmount());
});
