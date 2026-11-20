/**
 * Tab-Leiste: aktiver Tab mit gefüllter, eingefärbter Pille; Tippen auf einen
 * anderen Tab navigiert; im Querformat kompakter (Symbol neben Text).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Dimensions, StyleSheet, Text } from "react-native";

jest.mock("@/components/DjiLaunchButton", () => {
  const { Text } = jest.requireActual("react-native");
  return { DjiLaunchButton: () => <Text testID="tab-dji-launch">DJI</Text> };
});

import { MainTabBar, djiAfterIndex, getMainTabBarHeight, withAlpha } from "@/navigation/MainTabBar";

function makeProps(index: number) {
  const routes = [
    { key: "a", name: "BriefingsTab", params: undefined },
    { key: "b", name: "NotamsTab", params: undefined },
  ];
  const descriptors: Record<string, any> = {
    a: { options: { tabBarLabel: "Briefings", tabBarIcon: () => <Text>icon-a</Text> } },
    b: {
      options: {
        tabBarLabel: "NOTAMs",
        // eigenes Symbol mit Zähler-Badge muss erhalten bleiben
        tabBarIcon: ({ focused }: { focused: boolean }) => <Text testID="notam-badge">{focused ? "3!" : "3"}</Text>,
      },
    },
  };
  const navigation = {
    emit: jest.fn(() => ({ defaultPrevented: false })),
    navigate: jest.fn(),
  };
  return {
    state: { index, routes } as any,
    descriptors: descriptors as any,
    navigation: navigation as any,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function render(props: ReturnType<typeof makeProps>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<MainTabBar {...props} />);
  });
  return tree;
}

test("aktiver Tab hat eine gefüllte Pille, inaktive nicht", () => {
  const tree = render(makeProps(0));
  const pill = tree.root.find((n) => n.props.testID === "tab-active-pill-BriefingsTab" && n.props.style);
  const style = StyleSheet.flatten(pill.props.style);
  expect(style.backgroundColor).toBeTruthy();
  expect(style.backgroundColor).not.toBe("transparent");
  expect(tree.root.findAll((n) => n.props.testID === "tab-active-pill-NotamsTab")).toHaveLength(0);
  // Badge-Symbol des NOTAM-Tabs wird gerendert
  expect(tree.root.findAll((n) => n.props.testID === "notam-badge").length).toBeGreaterThan(0);
});

test("Tippen auf einen anderen Tab navigiert dorthin", () => {
  const props = makeProps(0);
  const tree = render(props);
  const tab = tree.root.find((n) => n.props.testID === "tab-NotamsTab" && typeof n.props.onPress === "function");
  act(() => tab.props.onPress());
  expect(props.navigation.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "tabPress", target: "b" }));
  expect(props.navigation.navigate).toHaveBeenCalledWith("NotamsTab", undefined);
});

test("Querformat: flachere Leiste", () => {
  expect(getMainTabBarHeight(true, 0)).toBeLessThan(getMainTabBarHeight(false, 0));
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 960, height: 540, scale: 2, fontScale: 1 }));
  try {
    const tree = render(makeProps(1));
    const bar = tree.root.find((n) => n.props.testID === "main-tab-bar" && n.props.style);
    expect(StyleSheet.flatten(bar.props.style).height).toBe(getMainTabBarHeight(true, 0));
  } finally {
    spy.mockRestore();
  }
});

test("withAlpha hängt Deckkraft an Hex-Farben an", () => {
  expect(withAlpha("#0A4D8C", 1)).toBe("#0A4D8Cff");
  expect(withAlpha("rgba(0,0,0,1)", 0.5)).toBe("rgba(0,0,0,1)");
});

test("Steuerkreuz-Fokus auf einem inaktiven Tab sieht nicht aktiv aus; aktiver Tab bleibt markiert", () => {
  // aktiver Tab: NOTAMs (index 1), Fokus wandert auf Briefings
  const tree = render(makeProps(1));
  const briefings = tree.root.find((n) => n.props.testID === "tab-BriefingsTab" && typeof n.props.onFocus === "function");
  act(() => briefings.props.onFocus());
  const ring = tree.root.find((n) => n.props.testID === "tab-focus-ring-BriefingsTab" && n.props.style);
  const ringStyle = StyleSheet.flatten(ring.props.style);
  expect(ringStyle.backgroundColor).toBe("transparent");
  expect(tree.root.findAll((n) => n.props.testID === "tab-active-pill-BriefingsTab")).toHaveLength(0);
  const active = tree.root.find((n) => n.props.testID === "tab-active-pill-NotamsTab" && n.props.style);
  expect(StyleSheet.flatten(active.props.style).backgroundColor).not.toBe("transparent");
  act(() => briefings.props.onBlur());
  expect(tree.root.findAll((n) => n.props.testID === "tab-focus-ring-BriefingsTab")).toHaveLength(0);
});

const SEVEN_TABS = ["BriefingsTab", "RadarTab", "NotamsTab", "HistoryTab", "NdFilterTab", "ChargerTab", "SettingsTab"];

test("6 sichtbare Tabs: Logbuch ausgeblendet, DJI-Knopf mittig (3 links, 3 rechts), Akkus links von Einstellungen", () => {
  const routes = SEVEN_TABS.map((name) => ({ key: name, name, params: undefined }));
  const descriptors: Record<string, any> = Object.fromEntries(
    SEVEN_TABS.map((name) => [name, { options: { tabBarLabel: name === "ChargerTab" ? "Akkus" : name } }]),
  );
  expect(djiAfterIndex(routes)).toBe(2);
  // ohne Namen (früheres Verhalten): Mitte
  expect(djiAfterIndex([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }])).toBe(1);
  const tree = render({
    state: { index: 5, routes } as any,
    descriptors: descriptors as any,
    navigation: { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() } as any,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const bar = tree.root.find((n) => n.props.testID === "main-tab-bar" && typeof n.type === "string");
  const order = bar.children
    .map((c: any) => c.findAll((n: any) => typeof n.props.testID === "string" && (n.props.testID.startsWith("tab-") && !n.props.testID.startsWith("tab-active") && !n.props.testID.startsWith("tab-focus")))[0]?.props.testID)
    .filter(Boolean);
  expect(order).toEqual([
    "tab-BriefingsTab",
    "tab-RadarTab",
    "tab-NotamsTab",
    "tab-dji-launch",
    "tab-NdFilterTab",
    "tab-ChargerTab",
    "tab-SettingsTab",
  ]);
  expect(tree.root.findAll((n) => n.props.testID === "tab-active-pill-ChargerTab").length).toBeGreaterThan(0);
});

test("im ausgeblendeten Logbuch ist der Einstellungen-Tab markiert", () => {
  const routes = SEVEN_TABS.map((name) => ({ key: name, name, params: undefined }));
  const descriptors: Record<string, any> = Object.fromEntries(SEVEN_TABS.map((name) => [name, { options: { tabBarLabel: name } }]));
  const tree = render({
    state: { index: SEVEN_TABS.indexOf("HistoryTab"), routes } as any,
    descriptors: descriptors as any,
    navigation: { emit: jest.fn(() => ({ defaultPrevented: false })), navigate: jest.fn() } as any,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  expect(tree.root.findAll((n) => n.props.testID === "tab-active-pill-SettingsTab").length).toBeGreaterThan(0);
  expect(tree.root.findAll((n) => n.props.testID === "tab-HistoryTab")).toHaveLength(0);
});
