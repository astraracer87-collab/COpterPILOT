/**
 * Querformat-Layout des nativen Standort-Schritts (PlanningLocationScreen) für
 * die DJI RC Pro 2 (Landscape, ~1920x1080 px): Statt der halbhohen Bottom-Card
 * steht die Karte in voller Höhe links und ein kompaktes Seiten-Panel rechts
 * (Ort, Koordinaten, Umkreis, angehefteter "Standort bestätigen"-Button).
 *
 * Gerendert wird der NATIVE Zweig (Platform.OS != "web") mit gemocktem
 * MapPicker; die Fenstergröße kommt aus einem gemockten useWindowDimensions.
 */
import React from "react";
import { StyleSheet } from "react-native";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

let mockWindow = { width: 960, height: 540, scale: 2, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ entitlement: { active: true, allCountries: true, countries: [] } }),
}));
jest.mock("@/lib/useGermanEnergyInfrastructure", () => ({
  useGermanEnergyInfrastructure: () => ({ data: undefined, isLoading: false, isError: false }),
}));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn(), addListener: () => () => {} }),
  useRoute: () => ({ params: { droneId: "drone-1", countryIso: "DE" } }),
}));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 56 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/components/MapPicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapPicker = React.forwardRef((props: any, _ref: any) =>
    React.createElement(View, { testID: "mock-map-picker", mapStyleSwitcherVariant: props.mapStyleSwitcherVariant }),
  );
  MapPicker.displayName = "MapPicker";
  return { __esModule: true, default: MapPicker };
});

jest.mock("@/components/Button", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    Button: ({ title, onPress, disabled, testID }: any) =>
      React.createElement(
        Pressable,
        { onPress: disabled ? undefined : onPress, disabled, testID },
        React.createElement(Text, null, title),
      ),
  };
});

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => React.createElement(View, props) };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 0, Medium: 1 },
  NotificationFeedbackType: { Success: 0 },
}));

jest.mock("expo-location", () => ({
  __esModule: true,
  Accuracy: { High: 5 },
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "denied" }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({ coords: { latitude: 0, longitude: 0 } }),
}));

jest.mock("@/lib/geozones", () => ({
  __esModule: true,
  queryGeozonesInArea: jest.fn().mockResolvedValue([]),
  TEMP_RESTRICTION_LAYER_LABEL: "Temporär",
}));
jest.mock("@/lib/storage", () => ({
  getDrone: jest.fn().mockResolvedValue(null),
  getSettings: jest.fn().mockResolvedValue({ officialMapCrossCheck: false }),
}));
jest.mock("@/lib/flightPlanningMode", () => ({
  getFlightPlanningMode: () => "planning",
}));
jest.mock("@/lib/dronePresets", () => ({
  findPresetForDrone: () => null,
}));

import PlanningLocationScreen from "../PlanningLocationScreen";

let currentTree: ReactTestRenderer | null = null;
async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(React.createElement(PlanningLocationScreen as any));
  });
  currentTree = tree;
  return tree;
}

function hostsByTestId(tree: ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === "string" && n.props?.testID === testID);
}
function hostByTestId(tree: ReactTestRenderer, testID: string) {
  const all = hostsByTestId(tree, testID);
  expect(all).toHaveLength(1);
  return all[0];
}

beforeEach(() => {
  jest.spyOn(global, "fetch" as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  } as any);
});

afterEach(() => {
  if (currentTree) {
    act(() => {
      currentTree?.unmount();
    });
    currentTree = null;
  }
  jest.restoreAllMocks();
});

describe("PlanningLocationScreen: Querformat-Layout", () => {
  it("Landscape: Karte und Seiten-Panel nebeneinander, Bestätigen-Button im Panel", async () => {
    mockWindow = { width: 960, height: 540, scale: 2, fontScale: 1 };
    const tree = await render();

    const body = hostByTestId(tree, "planning-location-landscape");
    expect(StyleSheet.flatten(body.props.style).flexDirection).toBe("row");
    expect(hostsByTestId(tree, "planning-location-bottom-sheet")).toHaveLength(0);

    // Direkte Kinder des Rows: links die Karte (flex: 1), rechts das Panel.
    const rowChildren = body.children.filter((c): c is renderer.ReactTestInstance => typeof c !== "string");
    expect(rowChildren.map((c) => c.props.testID)).toEqual([
      "planning-location-map",
      "planning-location-side-panel",
    ]);
    const mapStyle = StyleSheet.flatten(rowChildren[0].props.style);
    expect(mapStyle.flex).toBe(1);
    expect(mapStyle.marginTop).toBeUndefined();

    const panelStyle = StyleSheet.flatten(rowChildren[1].props.style);
    expect(panelStyle.width).toBe("34%");

    // Bestätigen-Button sitzt im Seiten-Panel (außerhalb des Scrollbereichs).
    const confirm = hostByTestId(tree, "button-confirm-location");
    let p: renderer.ReactTestInstance | null = confirm.parent;
    let inPanel = false;
    while (p) {
      if (p.props?.testID === "planning-location-side-panel") { inPanel = true; break; }
      p = p.parent;
    }
    expect(inPanel).toBe(true);
    expect(JSON.stringify(confirm.findByType("Text" as any).props.children)).toContain("Standort bestätigen");

    // Kartentyp-Auswahl im Querformat kompakt (Ecke statt Chip-Leiste mittig).
    expect(hostByTestId(tree, "mock-map-picker").props.mapStyleSwitcherVariant).toBe("compact");

    // Suchfeld bleibt über der Karte, ohne Android-Vollbild-Eingabemaske.
    const search = hostByTestId(tree, "input-poi-search");
    expect(search.props.disableFullscreenUI).toBe(true);
  });

  it("Portrait: bisherige Bottom-Card bleibt, Chip-Leiste unverändert", async () => {
    mockWindow = { width: 540, height: 960, scale: 2, fontScale: 1 };
    const tree = await render();

    expect(hostsByTestId(tree, "planning-location-landscape")).toHaveLength(0);
    expect(hostsByTestId(tree, "planning-location-side-panel")).toHaveLength(0);
    hostByTestId(tree, "planning-location-bottom-sheet");
    hostByTestId(tree, "button-confirm-location");
    expect(hostByTestId(tree, "mock-map-picker").props.mapStyleSwitcherVariant).toBe("segmented");
  });
});
