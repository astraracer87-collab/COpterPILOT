/**
 * Einstellungen: Jeder Menüpunkt ist tippbar, zeigt einen Pfeil „›“ und
 * navigiert zur richtigen Seite. Zusätzlich muss jedes Navigationsziel im
 * SettingsStackNavigator registriert sein (sonst passiert auf dem Gerät nichts).
 */
import fs from "fs";
import path from "path";
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Dimensions, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockLaunchGuide = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Feather: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({ useBottomTabBarHeight: () => 0 }));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
    useRoute: () => ({ params: undefined }),
    useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]),
  };
});
jest.mock("@/lib/auth", () => ({
  ...jest.requireActual("@/lib/auth"),
  useAuth: () => ({ user: null, isAuthenticated: false, status: "anonymous" }),
}));
jest.mock("@/lib/setupGuide", () => ({ setupGuideController: { launch: () => mockLaunchGuide() } }));
jest.mock("@/lib/geozones", () => ({
  MAP_STYLES: [
    { id: "grayscale", label: "Grau" },
    { id: "osm", label: "OSM" },
  ],
  loadMapStyle: async () => "grayscale",
  saveMapStyle: async () => {},
  loadRadarSettings: async () => ({ showEnergyInfrastructure: true }),
  saveRadarSettings: async () => {},
}));

import SettingsScreen from "@/screens/SettingsScreen";
import { saveDrone, saveSettings, getSettings, type DroneProfile, type Settings } from "@/lib/storage";

const NAVIGATOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../navigation/SettingsStackNavigator.tsx"),
  "utf8",
);
/** Ziele in anderen Tabs (nicht im SettingsStackNavigator) */
const OTHER_TAB_ROUTES = new Set(["ChargerTab"]);
const REGISTERED_ROUTES = new Set(
  Array.from(NAVIGATOR_SOURCE.matchAll(/<Stack\.Screen\s+name="([A-Za-z]+)"/g)).map((m) => m[1]),
);

const EXPECTED: Array<[testID: string, route: string, params?: unknown]> = [
  ["settings-row-my-data", "MyData"],
  ["settings-row-pilot-profile", "PilotProfile"],
  ["settings-row-license", "PilotLicenseCard"],
  ["settings-row-expiry", "ExpiryOverview"],
  ["settings-row-drones", "Drones"],
  // Ladegerät-Einstellungen liegen im Akkus-Tab (anderer Navigator)
  ["settings-row-charger", "ChargerTab", { screen: "ChargerSettings", initial: false }],
  ["settings-row-tcas", "TcasSettings"],
  ["settings-row-links", "ResourceLinks"],
  ["settings-row-glossary", "Glossary"],
  ["menu-vlos-info", "VlosInfo"],
  ["settings-row-easa-reference", "EasaReference"],
  ["settings-row-easa-rules", "EasaRules"],
  ["settings-row-countries", "CountryInfo"],
  ["menu-offline-maps", "RcOfflineMaps"],
  ["menu-rc-key-test", "RcKeyTest"],
  ["settings-row-weather", "DipulWeather"],
  ["settings-row-privacy", "PrivacyPolicy"],
  ["settings-row-terms", "LegalDocument", { doc: "terms" }],
  ["menu-data-sources", "DataSources"],
  ["settings-row-imprint", "LegalDocument", { doc: "imprint" }],
];

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function pressableByTestID(tree: ReactTestRenderer, testID: string) {
  // äußerster Knoten mit dieser testID, der einen Tap-Handler hat (Pressable)
  const hits = tree.root.findAll(
    (n) => n.props.testID === testID && typeof n.props.onPress === "function",
  );
  expect(hits.length).toBeGreaterThan(0);
  return hits[0];
}

async function renderScreen(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<SettingsScreen />);
  });
  await flush();
  return tree;
}

beforeEach(async () => {
  mockNavigate.mockClear();
  mockLaunchGuide.mockClear();
  await AsyncStorage.clear();
});

test("alle Navigationsziele sind im SettingsStackNavigator registriert", () => {
  expect(REGISTERED_ROUTES.size).toBeGreaterThan(10);
  for (const [, route] of EXPECTED) {
    if (OTHER_TAB_ROUTES.has(route)) continue;
    expect(REGISTERED_ROUTES.has(route)).toBe(true);
  }
  expect(REGISTERED_ROUTES.has("DroneSetup")).toBe(true);
});

test("jeder Menüpunkt hat einen Pfeil und navigiert zur richtigen Seite", async () => {
  const tree = await renderScreen();
  expect(tree.root.findAllByProps({ testID: "settings-two-columns" })).toHaveLength(0);
  for (const [testID, route, params] of EXPECTED) {
    mockNavigate.mockClear();
    const row = pressableByTestID(tree, testID);
    expect(tree.root.findAllByProps({ testID: `${testID}-chevron` }).length).toBeGreaterThan(0);
    act(() => {
      row.props.onPress();
    });
    if (params === undefined) {
      expect(mockNavigate).toHaveBeenCalledWith(route);
    } else {
      expect(mockNavigate).toHaveBeenCalledWith(route, params);
    }
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  }
});

test("Einrichtungs-Assistent startet, ohne Drohne führt die Zeile zur Drohnen-Einrichtung", async () => {
  const tree = await renderScreen();
  act(() => {
    pressableByTestID(tree, "settings-row-setup-guide").props.onPress();
  });
  expect(mockLaunchGuide).toHaveBeenCalledTimes(1);

  act(() => {
    pressableByTestID(tree, "settings-row-first-drone").props.onPress();
  });
  expect(mockNavigate).toHaveBeenLastCalledWith("DroneSetup", {});
});

test("gespeicherte Drohne erscheint als Zeile und öffnet ihre Einrichtung", async () => {
  const saved = await saveDrone({
    name: "Mavic Test",
    classMark: "C1",
    mtomGrams: 895,
  } as unknown as Omit<DroneProfile, "id" | "createdAt" | "updatedAt">);
  const tree = await renderScreen();
  act(() => {
    pressableByTestID(tree, `settings-row-drone-${saved.id}`).props.onPress();
  });
  expect(mockNavigate).toHaveBeenLastCalledWith("DroneSetup", { droneId: saved.id });
});

function hostNodes(root: ReactTestRenderer["root"], match: (testID: string) => boolean) {
  return root.findAll(
    (n) => typeof n.type === "string" && typeof n.props.testID === "string" && match(n.props.testID),
  );
}

function flat(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as any) ?? {};
}

async function withLandscape<T>(fn: () => Promise<T>): Promise<T> {
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 960, height: 540, scale: 2, fontScale: 1 }));
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

const EXPECTED_GRID: Array<[rowKey: string, cards: string[]]> = [
  ["profile-maps", ["profile", "maps"]],
  ["drones", ["drones"]],
  ["radar-planning", ["radar", "planning"]],
  ["knowledge", ["knowledge"]],
  ["data-info", ["data", "info"]],
];

test("Querformat 960x540: Karten liegen in Reihen, Nachbarn sind gleich groß, keine zwei unabhängigen Spalten", async () => {
  await withLandscape(async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: "settings-two-columns" })).toHaveLength(0);
    expect(hostNodes(tree.root, (id) => id === "settings-list")).toHaveLength(0);

    const grid = hostNodes(tree.root, (id) => id === "settings-grid");
    expect(grid).toHaveLength(1);
    // Das Raster ist eine vertikale Folge von Reihen, nicht zwei Spalten nebeneinander.
    expect(flat(grid[0]).flexDirection ?? "column").toBe("column");

    const rows = hostNodes(tree.root, (id) => id.startsWith("settings-grid-row-"));
    expect(rows.map((r) => r.props.testID)).toEqual(EXPECTED_GRID.map(([key]) => `settings-grid-row-${key}`));

    for (const [i, [, cardIds]] of EXPECTED_GRID.entries()) {
      const row = rows[i];
      expect(flat(row)).toEqual(expect.objectContaining({ flexDirection: "row", alignItems: "stretch" }));
      const cards = hostNodes(row as any, (id) => id.startsWith("settings-card-"));
      expect(cards.map((c) => c.props.testID)).toEqual(cardIds.map((id) => `settings-card-${id}`));
      for (const card of cards) {
        // gleiche Breite (flex: 1) und gleiche Höhe (Reihe streckt, Karte nicht selbst ausgerichtet)
        expect(flat(card).flex).toBe(1);
        expect(flat(card).alignSelf).toBeUndefined();
        expect(flat(card).height).toBeUndefined();
      }
    }

    // Jede Karte kommt genau einmal vor, keine Karte außerhalb der Reihen.
    const allCards = hostNodes(tree.root, (id) => id.startsWith("settings-card-"));
    expect(allCards).toHaveLength(EXPECTED_GRID.flatMap(([, c]) => c).length);

    // Voll breite Karten: Einträge in Zweierreihen mit gleich großen Zellen.
    const knowledgePairs = hostNodes(tree.root, (id) => id === "settings-knowledge-pair");
    expect(knowledgePairs).toHaveLength(3);
    const dronePairs = hostNodes(tree.root, (id) => id === "settings-drones-pair");
    expect(dronePairs).toHaveLength(2); // „Drohnen verwalten“ | „Ladegerät-Einstellungen“, „Erste Drohne hinzufügen“ | Platzhalter
    for (const pair of [...knowledgePairs, ...dronePairs]) {
      expect(flat(pair)).toEqual(expect.objectContaining({ flexDirection: "row", alignItems: "stretch" }));
      const cells = (pair.children as any[]).filter((c) => typeof c !== "string");
      expect(cells).toHaveLength(2);
      for (const cell of cells) {
        const host = typeof cell.type === "string" ? cell : cell.findAll((n: any) => typeof n.type === "string")[0];
        expect(flat(host).flex).toBe(1);
      }
    }

    // Navigation funktioniert auch im Querformat für jeden Eintrag.
    for (const [testID, route, params] of EXPECTED) {
      mockNavigate.mockClear();
      act(() => {
        pressableByTestID(tree, testID).props.onPress();
      });
      if (params === undefined) expect(mockNavigate).toHaveBeenCalledWith(route);
      else expect(mockNavigate).toHaveBeenCalledWith(route, params);
    }
  });
});

test("Querformat: mehrere Drohnen werden paarweise in der voll breiten Drohnen-Karte gezeigt", async () => {
  for (const name of ["A", "B"]) {
    await saveDrone({ name, classMark: "C0", mtomGrams: 249 } as unknown as Omit<DroneProfile, "id" | "createdAt" | "updatedAt">);
  }
  await withLandscape(async () => {
    const tree = await renderScreen();
    // Verwalten + Ladegerät + 2 Drohnen = 4 Einträge -> 2 Reihen
    const pairs = hostNodes(tree.root, (id) => id === "settings-drones-pair");
    expect(pairs).toHaveLength(2);
    expect(tree.root.findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("settings-drone-select-") && typeof n.props.onPress === "function").length).toBe(2);
    act(() => {
      pressableByTestID(tree, "button-add-drone").props.onPress();
    });
    expect(mockNavigate).toHaveBeenLastCalledWith("DroneSetup", {});
  });
});

test("Hochformat: eine Spalte ohne Raster-Reihen", async () => {
  const tree = await renderScreen();
  expect(hostNodes(tree.root, (id) => id === "settings-list")).toHaveLength(1);
  expect(hostNodes(tree.root, (id) => id.startsWith("settings-grid-row-"))).toHaveLength(0);
  expect(hostNodes(tree.root, (id) => id.endsWith("-pair"))).toHaveLength(0);
});

test("der entfernte Wildtierretter-Modus taucht nicht mehr auf, alte Einstellungen laden weiter", async () => {
  // Altbestand: gespeicherte Einstellungen enthalten noch das frühere Feld.
  await saveSettings({ ...(await getSettings()), windUnit: "km/h", wildlifeRescueMode: true } as Settings);
  const tree = await renderScreen();
  expect(tree.root.findAll((n) => n.props.testID === "toggle-wildlife-rescue")).toHaveLength(0);
  const texts = tree.root
    .findAll((n) => typeof n.type === "string" && n.type === "Text")
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join("") : String(n.props.children ?? "")));
  expect(texts.some((t) => /wildtier/i.test(t))).toBe(false);
  // Altdaten werden weiter gelesen (Windeinheit aus dem gespeicherten Objekt)
  expect(texts).toContain("km/h");
});
