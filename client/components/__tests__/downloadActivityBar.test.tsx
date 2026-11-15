/**
 * App-weite Download-Anzeige (DownloadActivityBar): erscheint erst nach 1 s,
 * zeigt Land, Inhalt und Prozent bzw. die Zahl der Aufgaben, berücksichtigt
 * die Safe-Area (Querformat) und öffnet beim Tippen die Länder-Einstellungen.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 10, right: 30, bottom: 0, left: 30 }),
}));
const mockNavigate = jest.fn();
jest.mock("@/navigation/navigationRef", () => ({
  navigationRef: { isReady: () => true, navigate: (...a: unknown[]) => mockNavigate(...a) },
}));

import { DownloadActivityBar } from "@/components/DownloadActivityBar";
import {
  __resetDownloadActivityForTests,
  beginDownload,
  DOWNLOAD_DISPLAY_DELAY_MS,
  endDownload,
  progressDownload,
} from "@/lib/downloadActivity";

function text(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join("") : String(t.props.children ?? "")))
    .join("\n");
}

beforeEach(() => {
  jest.useFakeTimers();
  __resetDownloadActivityForTests(() => Date.now());
  mockNavigate.mockClear();
});
afterEach(() => {
  __resetDownloadActivityForTests(null);
  jest.useRealTimers();
});

test("kurze Downloads (< 1 s) erscheinen nicht, längere mit Land, Inhalt und Prozent", () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<DownloadActivityBar />);
  });
  expect(tree.toJSON()).toBeNull();
  act(() => {
    const id = beginDownload({ id: "short", iso: "AT", labelDe: "Geozonen", kind: "geozones" });
    jest.advanceTimersByTime(300);
    endDownload(id);
  });
  act(() => {
    jest.advanceTimersByTime(2000);
  });
  expect(tree.toJSON()).toBeNull();

  act(() => {
    beginDownload({ id: "tiles:DE:base", iso: "DE", labelDe: "Geozonen", kind: "geozones", totalItems: 100 });
    progressDownload("tiles:DE:base", { doneItems: 45 });
  });
  expect(tree.toJSON()).toBeNull();
  act(() => {
    jest.advanceTimersByTime(DOWNLOAD_DISPLAY_DELAY_MS + 10);
  });
  expect(text(tree)).toContain("Lädt: Deutschland – Geozonen 45 %");
  // Safe-Area (Querformat): Abstand oben und rechts
  const wrap = tree.root.findByProps({ testID: "download-activity-bar" });
  const style = Object.assign({}, ...[wrap.props.style].flat());
  expect(style.top).toBe(16);
  expect(style.right).toBe(42);
  act(() => tree.unmount());
});

test("mehrere Aufgaben → „Lädt 3 Aufgaben …“; Tippen öffnet Einstellungen → Länder & Offline-Daten; danach verschwindet die Anzeige", () => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<DownloadActivityBar />);
  });
  act(() => {
    beginDownload({ id: "a", iso: "CZ", labelDe: "Geozonen", kind: "geozones" });
    beginDownload({ id: "b", iso: "CH", labelDe: "Geozonen", kind: "geozones" });
    beginDownload({ id: "c", labelDe: "Hindernisse", kind: "obstacles" });
    jest.advanceTimersByTime(DOWNLOAD_DISPLAY_DELAY_MS + 10);
  });
  expect(text(tree)).toContain("Lädt 3 Aufgaben …");
  act(() => {
    tree.root.findByProps({ testID: "download-activity-pill" }).props.onPress();
  });
  expect(mockNavigate).toHaveBeenCalledWith("Main", { screen: "SettingsTab", params: { screen: "RcOfflineMaps" } });
  act(() => {
    endDownload("a");
    endDownload("c");
  });
  expect(text(tree)).toContain("Lädt: Schweiz / Liechtenstein – Geozonen …");
  act(() => endDownload("b"));
  expect(tree.toJSON()).toBeNull();
  act(() => tree.unmount());
});
