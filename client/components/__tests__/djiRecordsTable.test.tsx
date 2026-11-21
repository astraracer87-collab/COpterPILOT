/**
 * DJI-Detailtabelle: Aufklappen rendert seitenweise (je 100 Zeilen) statt
 * aller ~900 Zeilen × 16 Spalten auf einmal (Speicher auf der DJI RC Pro 2).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    isDark: false,
    theme: { border: "#ddd", primary: "#06f", textSecondary: "#555", backgroundSecondary: "#eee" },
  }),
}));

jest.mock("@/components/ThemedText", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return { ThemedText: ({ children, ...props }: any) => React.createElement(Text, props, children) };
});

import { DjiRecordsTable, COLLAPSED_ROWS, ROWS_PER_PAGE } from "../DjiRecordsTable";

const records = Array.from({ length: 900 }, (_, i) => ({ t: i, heightM: i / 10 }));

/** Anzahl gerenderter Datenzeilen (Zeit-Zelle "m:ss" je Zeile). */
function rowCount(tree: ReactTestRenderer): number {
  return tree.root.findAll(
    (n) => typeof n.type === "string" && typeof n.props.children === "string" && /^\d+:\d\d$/.test(n.props.children),
  ).length;
}

function press(tree: ReactTestRenderer, testID: string) {
  const btn = tree.root.find((n) => n.props.testID === testID && typeof n.props.onPress === "function");
  act(() => btn.props.onPress());
}

describe("DjiRecordsTable", () => {
  it("zeigt zunächst wenige Zeilen und lädt je Tipp 100 weitere", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<DjiRecordsTable records={records} />);
    });
    expect(rowCount(tree)).toBe(COLLAPSED_ROWS);
    press(tree, "button-dji-table-toggle");
    expect(rowCount(tree)).toBe(COLLAPSED_ROWS + ROWS_PER_PAGE);
    press(tree, "button-dji-table-toggle");
    expect(rowCount(tree)).toBe(COLLAPSED_ROWS + 2 * ROWS_PER_PAGE);
    press(tree, "button-dji-table-collapse");
    expect(rowCount(tree)).toBe(COLLAPSED_ROWS);
  });

  it("nach dem letzten Tipp alle Zeilen, kein weiterer Knopf", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<DjiRecordsTable records={records.slice(0, 150)} />);
    });
    press(tree, "button-dji-table-toggle");
    press(tree, "button-dji-table-toggle");
    expect(rowCount(tree)).toBe(150);
    expect(tree.root.findAll((n) => n.props.testID === "button-dji-table-toggle")).toHaveLength(0);
  });
});
