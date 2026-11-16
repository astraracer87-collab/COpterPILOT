/**
 * Radar-Tab (client/components/RadarTabIcon.tsx): Zähl-Badge mit Anzahl der
 * Luftfahrzeuge in TA/RA, Farbe orange (TA) / rot (RA), Ring statt Pille.
 */
import React from "react";
import renderer, { act } from "react-test-renderer";
import { StyleSheet } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));

import { RadarTabIcon, RadarTabLabel } from "@/components/RadarTabIcon";
import { __resetTrafficAlertStoreForTests, publishTrafficAlerts, RA_COLOR, TA_COLOR } from "@/lib/trafficAlertStore";

afterEach(() => __resetTrafficAlertStoreForTests());

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <>
        <RadarTabIcon focused={false} />
        <RadarTabLabel focused={false} />
      </>,
    );
  });
  return tree;
}

const badgeText = (tree: renderer.ReactTestRenderer) => tree.root.findByProps({ testID: "radar-tab-badge-text" }).props.children;
const badgeColor = (tree: renderer.ReactTestRenderer) =>
  StyleSheet.flatten(tree.root.findByProps({ testID: "radar-tab-badge" }).props.style).backgroundColor;

test("0 → kein Badge, kein Ring", () => {
  const tree = render();
  expect(tree.root.findAllByProps({ testID: "radar-tab-badge" })).toHaveLength(0);
  expect(tree.root.findAllByProps({ testID: "radar-tab-alarm-ring" })).toHaveLength(0);
  act(() => tree.unmount());
});

test("nur TA → orange Badge „1“, Ring orange (transparent, keine Pille)", () => {
  const tree = render();
  act(() => publishTrafficAlerts("foreground", { level: "warning", count: 1, acknowledged: 0 }));
  expect(badgeText(tree)).toBe("1");
  expect(badgeColor(tree)).toBe(TA_COLOR);
  const ring = tree.root.findAllByProps({ testID: "radar-tab-alarm-ring" })[0]!;
  const rs = StyleSheet.flatten(ring.props.style);
  expect(rs.borderColor).toBe(TA_COLOR);
  expect(rs.backgroundColor).toBe("transparent");
  act(() => tree.unmount());
});

test("TA + RA (Hintergrund) → rotes Badge mit Gesamtzahl", () => {
  const tree = render();
  act(() => publishTrafficAlerts("background", { level: "critical", count: 3, acknowledged: 0 }));
  expect(badgeText(tree)).toBe("3");
  expect(badgeColor(tree)).toBe(RA_COLOR);
  act(() => publishTrafficAlerts("background", { level: "none", count: 0, acknowledged: 0 }));
  expect(tree.root.findAllByProps({ testID: "radar-tab-badge" })).toHaveLength(0);
  act(() => tree.unmount());
});

test("alles quittiert → Badge bleibt, gedimmt", () => {
  const tree = render();
  act(() => publishTrafficAlerts("foreground", { level: "critical", count: 2, acknowledged: 2 }));
  expect(badgeText(tree)).toBe("2");
  expect(StyleSheet.flatten(tree.root.findByProps({ testID: "radar-tab-badge" }).props.style).opacity).toBe(0.5);
  act(() => tree.unmount());
});
