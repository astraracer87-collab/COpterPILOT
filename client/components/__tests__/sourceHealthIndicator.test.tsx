/**
 * Regressionsschutz: Der Verkehrsquellen-Status (SourceHealthIndicator) ist eine
 * Datenquellen-Attribution und darf NUR Admins angezeigt werden. Normale Piloten
 * sollen nie sehen, aus welchen Quellen der Live-Verkehr zusammengeführt wird.
 *
 * Die Komponente rendert `null`, sobald `user?.isAdmin !== true` — unabhängig vom
 * Quellen-Status. Dieser Test fängt einen künftigen Refactor ab, der das Gating
 * versehentlich entfernt (z. B. geänderte useAuth-Form oder vergessene Prüfung).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

// @expo/vector-icons + expo-haptics laden native Module — im Test durch
// leichtgewichtige Platzhalter ersetzt.
jest.mock("@expo/vector-icons", () => {
  const ReactLocal = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => ReactLocal.createElement(View, props) };
});
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

import SourceHealthIndicator from "../SourceHealthIndicator";

// useAuth wird pro Test über diese veränderbare Variable gesteuert.
let mockIsAdmin = false;
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { isAdmin: mockIsAdmin } }),
}));

// Quellen-Status fest auf "alle gestört" verdrahten, damit die Komponente — wenn
// das Admin-Gating sie durchlässt — die Stör-Pill tatsächlich rendern WÜRDE
// (status vorhanden, degraded != [], okCount === 0).
jest.mock("@/lib/trafficStatus", () => {
  const ALL_SOURCES = ["opensky", "adsbfi"] as const;
  const status = {
    sourceStatus: { opensky: "error", adsbfi: "error" },
    sourceLastOk: { opensky: 0, adsbfi: 0 },
  };
  return {
    ALL_SOURCES,
    SOURCE_LABELS: { opensky: "OpenSky", adsbfi: "adsb.fi" },
    getCachedTrafficStatus: () => status,
    subscribeTrafficStatus: (cb: (s: any) => void) => {
      cb(status);
      return () => {};
    },
    getDegradedSources: () => [
      { source: "opensky", lastOk: 0 },
      { source: "adsbfi", lastOk: 0 },
    ],
    getStatusLabel: () => "Fehler",
    formatLastOkRelative: () => "vor 1 Min.",
  };
});

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<SourceHealthIndicator isDark={false} testID="src-pill" />);
  });
  return tree;
}

// Sucht im gerenderten Host-Baum (toJSON) nach einem Knoten mit testID. Nur die
// tatsächlich gerenderten Views zählen — die Komponenten-Instanz selbst (die den
// testID-Prop ebenfalls trägt) taucht hier nicht auf.
function hasTestId(node: any, id: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (node.props?.testID === id) return true;
  return Array.isArray(node.children) && node.children.some((c: any) => hasTestId(c, id));
}

afterEach(() => {
  mockIsAdmin = false;
});

test("Pilot (isAdmin=false): kein Quellen-Status, Pill wird NICHT gerendert", () => {
  mockIsAdmin = false;
  const tree = render();
  // Komponente rendert nichts Sichtbares.
  expect(tree.toJSON()).toBeNull();
  expect(hasTestId(tree.toJSON(), "src-pill")).toBe(false);
  tree.unmount();
});

test("Admin (isAdmin=true): Quellen-Status-Pill wird gerendert", () => {
  mockIsAdmin = true;
  const tree = render();
  expect(tree.toJSON()).not.toBeNull();
  expect(hasTestId(tree.toJSON(), "src-pill")).toBe(true);
  tree.unmount();
});
