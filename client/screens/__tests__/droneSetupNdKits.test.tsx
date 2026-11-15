/**
 * Drohne einrichten → ND-Filter-Schnellauswahl: Ohne Auswahl ist nichts blau;
 * „DJI-Standard“ wählt genau 8/32/128 und nur dieser Kit-Chip ist hervorgehoben.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null, MaterialCommunityIcons: () => null }));
jest.mock("react-native-webview", () => ({ WebView: () => null }));
jest.mock("@/lib/auth", () => ({
  ...jest.requireActual("@/lib/auth"),
  useAuth: () => ({ user: null, isAuthenticated: false, status: "anonymous" }),
}));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: {} }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: () => () => {} }),
  useFocusEffect: () => {},
}));

import DroneSetupScreen from "@/screens/DroneSetupScreen";
import { Colors } from "@/constants/theme";

const PRIMARY = [Colors.light.primary, Colors.dark.primary];

async function flush() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function pressable(tree: ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
}

function kitHighlighted(tree: ReactTestRenderer, testID: string): boolean {
  const style = StyleSheet.flatten(pressable(tree, testID).props.style);
  return PRIMARY.includes(style.borderColor as string);
}

function selectedNds(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => typeof n.props.testID === "string" && /^nd-chip-ND\d+$/.test(n.props.testID) && typeof n.props.onPress === "function")
    .filter((n) => n.props.accessibilityState?.selected || n.props.accessibilityState?.checked)
    .map((n) => n.props.testID.replace("nd-chip-", ""));
}

test("leer: kein Kit hervorgehoben; DJI-Standard → genau dieses Kit und 8/32/128", async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<DroneSetupScreen />);
  });
  await flush();
  // „Manuell einrichten“ → Details-Schritt
  await act(async () => {
    pressable(tree, "button-manual-setup").props.onPress();
  });
  await flush();

  expect(kitHighlighted(tree, "nd-kit-dji-standard")).toBe(false);
  expect(kitHighlighted(tree, "nd-kit-fpv-standard")).toBe(false);
  expect(selectedNds(tree)).toEqual([]);

  await act(async () => {
    pressable(tree, "nd-kit-dji-standard").props.onPress();
  });
  expect(kitHighlighted(tree, "nd-kit-dji-standard")).toBe(true);
  expect(kitHighlighted(tree, "nd-kit-fpv-standard")).toBe(false);
  expect(selectedNds(tree).sort()).toEqual(["ND128", "ND32", "ND8"]);
});
