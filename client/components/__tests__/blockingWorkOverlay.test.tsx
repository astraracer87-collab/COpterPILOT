/**
 * Vollbild-Overlay „Bitte warten – Daten werden verarbeitet“ (Product Owner):
 * erscheint, BEVOR nicht zerlegbare Arbeit startet (runBlocking), fängt
 * Berührungen ab und verschwindet danach wieder.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";

import { BlockingWorkOverlay } from "@/components/BlockingWorkOverlay";
import { __setWaitForPaintForTests, runBlocking } from "../../../shared/yieldingWork";

function overlay(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.props?.testID === "blocking-work-overlay" && typeof n.type === "string");
}

function text(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join("") : String(t.props.children ?? "")))
    .join("\n");
}

afterEach(() => __setWaitForPaintForTests(null));

test("Overlay ist sichtbar, bevor die blockierende Arbeit läuft, und danach weg", async () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<BlockingWorkOverlay />);
  });
  expect(tree.toJSON()).toBeNull();

  let visibleDuringWork = false;
  let visibleAtPaint = false;
  // „nächster Frame“: React rendert den gesetzten Zustand (wie rAF + setTimeout auf dem Gerät)
  __setWaitForPaintForTests(async () => {
    await act(async () => {});
    visibleAtPaint = overlay(tree).length > 0;
  });
  let detail = "";
  await runBlocking({ label: "Geozonen", iso: "DE", step: "Index wird aufgebaut", fraction: 0.4 }, () => {
    visibleDuringWork = overlay(tree).length > 0;
    detail = text(tree);
    // fängt Berührungen ab
    expect(overlay(tree)[0].props.onStartShouldSetResponder()).toBe(true);
  });
  await act(async () => {});
  expect(detail).toContain("Bitte warten – Daten werden verarbeitet");
  expect(detail).toContain("Deutschland · Geozonen · Index wird aufgebaut · 40 %");
  expect(visibleAtPaint).toBe(true);
  expect(visibleDuringWork).toBe(true);
  expect(tree.toJSON()).toBeNull();
});
