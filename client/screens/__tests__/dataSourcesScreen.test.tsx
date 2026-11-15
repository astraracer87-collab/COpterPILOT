/**
 * Einstellungen → Datenquellen & Lizenzen: rendert alle Gruppen/Einträge aus
 * client/lib/dataSources.ts, zeigt die Freigabe-Zeile und öffnet Lizenz-Links
 * über openLink (In-App-Seite).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";

const mockOpenLink = jest.fn(async (_url: string, _title?: string) => {});
jest.mock("@/lib/webBrowser", () => ({
  openLink: (url: string, title?: string) => mockOpenLink(url, title),
}));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

import DataSourcesScreen from "@/screens/DataSourcesScreen";
import {
  WRITTEN_PERMISSION_TEXT,
  getDataSourceGroups,
} from "@/lib/dataSources";

function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join("") : String(c ?? "");
    })
    .join("\n");
}

test("zeigt alle Gruppen, Einträge, Pflicht-Attributionen und Freigaben", () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<DataSourcesScreen />);
  });
  const text = allText(tree);
  for (const g of getDataSourceGroups()) {
    expect(text).toContain(g.title.toUpperCase());
    for (const e of g.entries) {
      expect(
        tree.root.findAllByProps({ testID: `data-source-${e.id}` }).length,
      ).toBeGreaterThan(0);
    }
  }
  expect(text).toContain("dipul, CC-BY-ND 4.0");
  expect(text).toContain("© OpenStreetMap contributors");
  expect(text).toContain(WRITTEN_PERMISSION_TEXT);
});

test("Lizenz-Link öffnet die Lizenzseite in der App", () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<DataSourcesScreen />);
  });
  const license = tree.root.findAll(
    (n) =>
      typeof n.props.onPress === "function" &&
      n.findAllByType(Text).some((t) => t.props.children === "CC BY-ND 4.0"),
  )[0];
  expect(license).toBeTruthy();
  act(() => {
    license.props.onPress();
  });
  expect(mockOpenLink).toHaveBeenCalledWith(
    "https://creativecommons.org/licenses/by-nd/4.0/legalcode.de",
    "CC BY-ND 4.0",
  );
});
