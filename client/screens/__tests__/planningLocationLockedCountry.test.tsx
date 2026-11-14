/**
 * Mobile-Gegenstück zur Web-E2E "gesperrtes Land blockiert das Weitergehen"
 * (Task #561/#567): Auf dem nativen Standort-Schritt (PlanningLocationScreen)
 * MUSS handleContinue für ein NICHT freigeschaltetes Land abgewiesen werden —
 * der Pilot darf nicht in die Flugplanung für ein Land vordringen, das wir nicht
 * abdecken.
 *
 * Warum ein Komponenten-Test (jest-expo) statt runTest/e2e?
 *   Die e2e-Harness steuert die Expo-App (:8081) per UI, kann dort aber weder
 *   deterministisch eine gesperrte Länder-Berechtigung einsetzen (kein Test-Hook
 *   auf Mobile) noch den nativen Karten-Picker zuverlässig bedienen. Wir rendern
 *   den Screen daher direkt, seeden Berechtigung + Standort über Props/Mocks und
 *   drücken den echten "Standort bestätigen"-Button — so wird genau der
 *   handleContinue-Pfad (countryLocked -> Alert + return) geprüft.
 *
 * Aufbau (analog trafficMapLockedCountries.native.test.tsx): Platform.OS wird auf
 * "web" gezwungen, damit der Render-Zweig OHNE nativen MapPicker greift; die
 * Koordinaten werden über die manuelle Eingabe gesetzt (Salzburg/AT). Bei nur-DE-
 * Berechtigung erwarten wir den Block (Alert, keine Navigation); mit AT-Add-on
 * erwarten wir den regulären Weiter-Pfad (Navigation, kein Sperr-Alert).
 */
import React from "react";
import { Platform, Alert } from "react-native";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import type { CountryEntitlementView } from "../../../shared/countryEntitlements";

// Salzburg (AT) — sicher innerhalb Österreichs (eigene ED-269-Daten, hasOwnMap).
const AT_LAT = "47.8";
const AT_LON = "13.04";

// --- Berechtigung pro Test umschaltbar -------------------------------------
let mockEntitlement: CountryEntitlementView | null = null;
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ entitlement: mockEntitlement }),
}));
jest.mock("@/lib/useGermanEnergyInfrastructure", () => ({
  useGermanEnergyInfrastructure: () => ({ data: undefined, isLoading: false, isError: false }),
}));

// --- Navigation: navigate beobachtbar, route liefert Pflicht-Params ---------
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, addListener: () => () => {} }),
  useRoute: () => ({ params: { droneId: "drone-1", countryIso: "DE" } }),
}));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// --- Schwergewichtige/native Kinder neutralisieren --------------------------
jest.mock("@/components/MapPicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MapPicker = React.forwardRef((props: any, _ref: any) =>
    React.createElement(View, props),
  );
  MapPicker.displayName = "MapPicker";
  return { __esModule: true, default: MapPicker };
});

// Button durch ein einfaches pressbares Element ersetzen (vermeidet Reanimated)
// und testID/onPress 1:1 durchreichen.
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

// Geozonen-Vorschau ins Leere laufen lassen (kein Netzwerk im Test).
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
function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(React.createElement(PlanningLocationScreen as any));
  });
  currentTree = tree;
  return tree;
}

function hostByPlaceholder(tree: ReactTestRenderer, placeholder: string) {
  return tree.root.find(
    (n) => typeof n.type === "string" && n.props?.placeholder === placeholder,
  );
}

function byTestId(tree: ReactTestRenderer, testID: string) {
  return tree.root.find((n) => n.props?.testID === testID);
}

function hasTestId(tree: ReactTestRenderer, testID: string): boolean {
  return tree.root.findAll((n) => n.props?.testID === testID, { deep: true }).length > 0;
}

// Setzt den Standort über die manuelle Koordinaten-Eingabe (AT) und bestätigt.
async function seedAtLocation(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    hostByPlaceholder(tree, "z.B. 50.1109").props.onChangeText(AT_LAT);
    hostByPlaceholder(tree, "z.B. 8.6821").props.onChangeText(AT_LON);
  });
  await act(async () => {
    byTestId(tree, "button-apply-coords").props.onPress();
  });
}

let originalOS: typeof Platform.OS;
beforeAll(() => {
  originalOS = Platform.OS;
  // Web-Render-Zweig: ohne nativen MapPicker, mit manueller Koordinaten-Eingabe.
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = originalOS;
});

beforeEach(() => {
  mockNavigate.mockClear();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
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

describe("PlanningLocationScreen: gesperrtes Land blockiert handleContinue", () => {
  it("nur-DE-Berechtigung + AT-Standort: 'Standort bestätigen' zeigt Sperr-Alert und navigiert NICHT", async () => {
    mockEntitlement = { active: true, allCountries: false, countries: ["DE"] };

    const tree = render();
    await seedAtLocation(tree);

    // Der Sperr-Hinweis (Card testID planning-country-locked) ist sichtbar.
    expect(hasTestId(tree, "planning-country-locked")).toBe(true);

    // "Standort bestätigen" drücken -> handleContinue.
    await act(async () => {
      byTestId(tree, "button-confirm-location").props.onPress();
    });

    // Block: Sperr-Alert gezeigt, KEINE Navigation in den nächsten Schritt.
    expect(Alert.alert).toHaveBeenCalled();
    const [firstArg] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(String(firstArg)).toContain("nicht freigeschaltet");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("AT freigeschaltet (DE + AT): 'Standort bestätigen' navigiert weiter, kein Sperr-Alert/Hinweis", async () => {
    mockEntitlement = { active: true, allCountries: false, countries: ["DE", "AT"] };

    const tree = render();
    await seedAtLocation(tree);

    // Kein Sperr-Hinweis mehr.
    expect(hasTestId(tree, "planning-country-locked")).toBe(false);

    await act(async () => {
      byTestId(tree, "button-confirm-location").props.onPress();
    });

    // Regulärer Weiter-Pfad: Navigation zum DateTime-Schritt erfolgt.
    expect(mockNavigate).toHaveBeenCalledWith(
      "PlanningDateTime",
      expect.objectContaining({ droneId: "drone-1" }),
    );
    // Kein "nicht freigeschaltet"-Sperr-Alert.
    const lockedAlert = (Alert.alert as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes("nicht freigeschaltet"),
    );
    expect(lockedAlert).toBeUndefined();
  });
});
