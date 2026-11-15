/**
 * Sonnenbogen im Range-Modus mit Flugfenster über Mitternacht (23:30–03:00):
 * Achse reicht in den Folgetag, Ende trägt "+1", Beschriftung zeigt das
 * echte Fenster und die Achsen sind mit Einheiten beschriftet.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    isDark: false,
    theme: {
      backgroundDefault: "#fff",
      border: "#ddd",
      primary: "#06f",
      text: "#111",
      textSecondary: "#555",
      textTertiary: "#888",
    },
  }),
}));

jest.mock("@/components/ThemedText", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return { ThemedText: ({ children, ...props }: any) => React.createElement(Text, props, children) };
});

jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn().mockResolvedValue(undefined) }));

import SunArcChart from "../SunArcChart";

function allText(tree: ReactTestRenderer): string[] {
  // react-native-svg ist im Test gemockt und rendert nichts ins JSON – Texte
  // daher aus den Element-Props lesen.
  const out = new Set<string>();
  for (const n of tree.root.findAll(() => true)) {
    const c = n.props?.children;
    if (typeof c === "string") out.add(c);
  }
  return [...out];
}

it("zeigt ein Fenster 23:30–03:00 über Mitternacht vollständig an", () => {
  const day = new Date(2026, 10, 15, 0, 0, 0, 0);
  const start = new Date(2026, 10, 15, 23, 30, 0, 0);
  const end = new Date(2026, 10, 16, 3, 0, 0, 0);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <SunArcChart
        lat={52.52}
        lon={13.405}
        date={day}
        width={640}
        height={200}
        rangeStart={start}
        rangeEnd={end}
        onRangeChange={() => {}}
        tempSeries={[
          { time: new Date(2026, 10, 15, 23, 0), tempC: 4 },
          { time: new Date(2026, 10, 16, 2, 0), tempC: 1 },
        ]}
      />,
    );
  });
  const texts = allText(tree);
  expect(texts).toContain("Flugzeit 23:30–03:00 (+1 Tag) · 3h 30min");
  expect(texts).toContain("03:00 +1 ◀");
  expect(texts.some((t) => t.startsWith("+1 Tag · "))).toBe(true);
  // Achse läuft über 00:00 hinaus bis nach dem Ende.
  expect(texts).toContain("00:00");
  expect(texts).toContain("02:00");
  // Temperatur mit Einheit, Sonnenhöhe mit Horizont-Label.
  expect(texts.some((t) => /°C$/.test(t))).toBe(true);
  expect(texts).toContain("0°");
  expect(texts).toContain("Sonne");
});
