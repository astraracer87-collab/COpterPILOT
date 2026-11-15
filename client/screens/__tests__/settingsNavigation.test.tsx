/**
 * Einstellungen: Jeder Menüpunkt ist tippbar, zeigt einen Pfeil „›“ und
 * navigiert zur richtigen Seite. Zusätzlich muss jedes Navigationsziel im
 * SettingsStackNavigator registriert sein (sonst passiert auf dem Gerät nichts).
 */
import fs from "fs";
import path from "path";
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Dimensions } from "react-native";
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
jest.mock("@/components/WildlifeRescueInfo", () => ({ WildlifeRescueInfoModal: () => null }));
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
import { saveDrone, type DroneProfile } from "@/lib/storage";

const NAVIGATOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../navigation/SettingsStackNavigator.tsx"),
  "utf8",
);
const REGISTERED_ROUTES = new Set(
  Array.from(NAVIGATOR_SOURCE.matchAll(/<Stack\.Screen\s+name="([A-Za-z]+)"/g)).map((m) => m[1]),
);

const EXPECTED: Array<[testID: string, route: string, params?: unknown]> = [
  ["settings-row-my-data", "MyData"],
  ["settings-row-pilot-profile", "PilotProfile"],
  ["settings-row-license", "PilotLicenseCard"],
  ["settings-row-expiry", "ExpiryOverview"],
  ["settings-row-drones", "Drones"],
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

test("im Querformat werden die Einstellungen zweispaltig dargestellt", async () => {
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 960, height: 540, scale: 2, fontScale: 1 }));
  try {
    const tree = await renderScreen();
    expect(tree.root.findAllByProps({ testID: "settings-two-columns" }).length).toBeGreaterThan(0);
    // beide Spalten enthalten tippbare Zeilen, Navigation funktioniert weiter
    act(() => {
      pressableByTestID(tree, "settings-row-pilot-profile").props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith("PilotProfile");
  } finally {
    spy.mockRestore();
  }
});
