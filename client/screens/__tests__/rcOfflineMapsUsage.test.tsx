/**
 * Einstellungen → Karten & Offline, Abschnitt „Länder & Offline-Daten“:
 * alle App-Länder mit Auswahl Aus/Online/Offline, gespeicherte Größe je Land
 * und gesamt, Import deaktivierter Länder bleibt sichtbar erhalten, Pack-
 * Optionen nur bei „Offline“, „Alle deaktivierten Länder bereinigen“.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Text } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({ useBottomTabBarHeight: () => 0 }));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock("@/lib/webBrowser", () => ({ openLink: jest.fn(async () => {}) }));
jest.mock("@/lib/googleTiles", () => ({
  getGoogleKey: jest.fn(async () => null),
  setGoogleKey: jest.fn(async () => ({ ok: true })),
  clearGoogleKey: jest.fn(async () => {}),
}));
jest.mock("@/lib/zoneTranslationStore", () => ({
  getDeeplKey: jest.fn(async () => null),
  setDeeplKey: jest.fn(async () => ({ ok: true })),
  clearDeeplKey: jest.fn(async () => {}),
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
import { __resetCountryUsageForTests, __setCountryUsageForTests, getCountryUsage, USAGE_COUNTRIES } from "@/lib/countryUsage";

function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join("") : String(c ?? "");
    })
    .join("\n");
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

beforeEach(() => {
  __resetCountryUsageForTests(null);
  __setCountryUsageForTests({ DE: "offline", AT: "online", MT: "off" });
  mockApply.mockClear();
  mockCleanup.mockClear();
});
afterEach(() => {
  __resetCountryUsageForTests(undefined);
  jest.restoreAllMocks();
});

test("Abschnitt „Länder & Offline-Daten“ mit Aus/Online/Offline für alle Länder, Größe je Land und gesamt", async () => {
  const tree = await render();
  const text = allText(tree);
  expect(text).toContain("LÄNDER & OFFLINE-DATEN");
  expect(text).not.toContain("OFFLINE-LÄNDER");
  for (const { iso } of USAGE_COUNTRIES) {
    for (const u of ["off", "online", "offline"]) {
      expect(tree.root.findAllByProps({ testID: `usage-${iso}-${u}` }).length).toBeGreaterThan(0);
    }
  }
  expect(tree.root.findByProps({ testID: "usage-DE-offline" }).props.accessibilityState).toEqual({ selected: true });
  expect(tree.root.findByProps({ testID: "usage-AT-online" }).props.accessibilityState).toEqual({ selected: true });
  expect(tree.root.findByProps({ testID: "usage-FR-off" }).props.accessibilityState).toEqual({ selected: true });
  expect(text).toContain("Gespeichert gesamt: 322 MB");
  expect(text).toMatch(/Offline verfügbar|Teilweise gespeichert|ca\. .*· gespeichert 320 MB/);
  expect(text).toContain("Aus · Import bleibt erhalten (Land deaktiviert) · 2,0 MB");
  expect(text).toContain("Online – Abfrage bei Bedarf");
  expect(tree.root.findAllByProps({ testID: "cleanup-disabled-countries" }).length).toBeGreaterThan(0);
  act(() => tree.unmount());
});

test("Pack-Optionen nur bei „Offline“; Wechsel auf Online ohne Bestätigung, auf Aus mit Bestätigung", async () => {
  const tree = await render();
  // DE (offline) aufklappen → Pack-Optionen inkl. Wohngebiete
  const deHead = tree.root.findAll((n) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === "Deutschland"))[0];
  await act(async () => deHead.props.onPress());
  let text = allText(tree);
  expect(text).toContain("Wohngebiete (Wohngrundstücke) offline speichern");
  expect(text).toContain("Hindernisse");
  // AT (online) aufklappen → keine Pack-Optionen
  const atHead = tree.root.findAll((n) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === "Österreich"))[0];
  await act(async () => atHead.props.onPress());
  text = allText(tree);
  expect(tree.root.findByProps({ testID: "usage-hint-AT" })).toBeTruthy();
  expect(tree.root.findAllByProps({ testID: "download-AT" }).length).toBe(0);

  // FR aus → online: direkt
  await act(async () => tree.root.findByProps({ testID: "usage-FR-online" }).props.onPress());
  expect(mockApply).toHaveBeenCalledWith("FR", "online");
  expect(getCountryUsage("FR")).toBe("online");

  // AT online → aus: Bestätigung „Land deaktivieren“
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await act(async () => tree.root.findByProps({ testID: "usage-AT-off" }).props.onPress());
  expect(alert).toHaveBeenCalledWith("Land deaktivieren", expect.stringContaining("Österreich"), expect.any(Array));
  const buttons = alert.mock.calls[0][2] as any[];
  await act(async () => {
    await buttons.find((b) => b.text === "Deaktivieren").onPress();
  });
  expect(mockApply).toHaveBeenCalledWith("AT", "off");

  // Bereinigen mit Bestätigung (Importe bleiben)
  alert.mockClear();
  await act(async () => tree.root.findByProps({ testID: "cleanup-disabled-countries" }).props.onPress());
  expect(alert.mock.calls[0][1]).toContain("importierte Geozonen bleiben erhalten");
  await act(async () => {
    await (alert.mock.calls[0][2] as any[]).find((b) => b.text === "Bereinigen").onPress();
  });
  expect(mockCleanup).toHaveBeenCalled();
  act(() => tree.unmount());
});
