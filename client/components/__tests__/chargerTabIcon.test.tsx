/**
 * Akkus-Tab: immer Feather „battery“, Zustand im runden Badge oben rechts
 * (wie NOTAM/Radar). Je Zustand ein Badge, Vorrang Warnung > lädt > verbunden
 * > verbindet; kein Ring/keine Fläche hinter dem Symbol (≠ aktive Pille).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet } from "react-native";

import {
  ChargerTabIconView,
  badgeFromSnapshot,
} from "@/components/ChargerTabIcon";
import {
  BADGE_GREEN,
  BADGE_RED,
  BADGE_YELLOW,
  chargerTabBadge,
} from "@/lib/charger/chargerTabBadge";
import type { ControllerSnapshot } from "@/lib/charger/chargerController";

const mockFeather = jest.fn((_p: { name: string }) => null);
jest.mock("@expo/vector-icons", () => ({
  Feather: (p: { name: string }) => mockFeather(p),
}));
jest.mock("@/hooks/useCharger", () => ({ useChargerSnapshot: () => ({}) }));

const mounted: ReactTestRenderer[] = [];

// Puls-Animation (Animated.loop) läuft sonst über das Testende hinaus weiter
afterEach(() => {
  act(() => {
    for (const t of mounted.splice(0)) t.unmount();
  });
});

function render(el: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(el);
  });
  mounted.push(tree);
  return tree;
}

const badgeNode = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) =>
      typeof n.props.testID === "string" &&
      n.props.testID.startsWith("charger-tab-badge-") &&
      n.props.style,
  );

function snap(
  state: string | null,
  slotStates: number[] = [],
  connecting = false,
): ControllerSnapshot {
  return {
    connecting,
    transport: state ? ({ state } as ControllerSnapshot["transport"]) : null,
    status: {
      slots: slotStates.map((s, index) => ({ index, state: s })),
    } as unknown as ControllerSnapshot["status"],
  } as ControllerSnapshot;
}

beforeEach(() => mockFeather.mockClear());

test("immer dasselbe Akku-Symbol, ohne Verbindung kein Badge", () => {
  const tree = render(
    <ChargerTabIconView
      focused={false}
      badge={chargerTabBadge({
        connected: false,
        connecting: false,
        slotStates: [],
      })}
    />,
  );
  expect(badgeNode(tree)).toHaveLength(0);
  expect(mockFeather.mock.calls.map((c) => c[0].name)).toEqual(["battery"]);
});

test.each([
  ["connecting", snap("scanning", [], true), BADGE_YELLOW, null, ""],
  ["connected", snap("connected", [0, 3, 1]), BADGE_GREEN, null, ""],
  ["charging", snap("connected", [2, 3, 0]), BADGE_GREEN, "zap", ""],
  ["warning", snap("connected", [2, 7, 0]), BADGE_RED, null, "!"],
])("Badge „%s“", (kind, s, color, icon, text) => {
  const badge = badgeFromSnapshot(s);
  expect(badge.kind).toBe(kind);
  const tree = render(<ChargerTabIconView focused badge={badge} />);
  const nodes = badgeNode(tree);
  expect(nodes.length).toBeGreaterThan(0);
  const style = StyleSheet.flatten(nodes[0].props.style);
  expect(style.backgroundColor).toBe(color);
  // gleiche Lage/Größe wie NOTAM/Radar-Badge
  expect(style).toEqual(
    expect.objectContaining({
      position: "absolute",
      top: -4,
      right: -10,
      height: 18,
      borderRadius: 9,
    }),
  );
  const names = mockFeather.mock.calls.map((c) => c[0].name);
  expect(names[0]).toBe("battery");
  expect(names.includes("battery-charging")).toBe(false);
  expect(names.includes("zap")).toBe(icon === "zap");
  expect(
    tree.root.findAll((n) => n.props.testID === "charger-tab-badge-text")
      .length > 0,
  ).toBe(text !== "");
});

test("Vorrang: Warnung > lädt > verbunden > verbindet; getrennt zeigt keinen Status der Schächte", () => {
  expect(badgeFromSnapshot(snap("connected", [2, 6, 0], true)).kind).toBe(
    "warning",
  );
  expect(badgeFromSnapshot(snap("connected", [2, 1, 0], true)).kind).toBe(
    "charging",
  );
  expect(badgeFromSnapshot(snap("connected", [], true)).kind).toBe("connected");
  expect(badgeFromSnapshot(snap("reconnecting", [2, 7], true)).kind).toBe(
    "connecting",
  );
  expect(badgeFromSnapshot(snap("stopped", [2, 7], false)).kind).toBe("none");
});
