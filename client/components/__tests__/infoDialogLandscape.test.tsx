/**
 * Gemeinsamer Info-Dialog: im Querformat der Fernsteuerung (960×540 dp) breites
 * Panel mit zwei Spalten bei langem Text; im Hochformat (540×960) volle Breite
 * als Bottom-Sheet. Schließen per X, OK, Tipp außerhalb und Android-Zurück.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Dimensions, Modal, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));

// eslint-disable-next-line import/first
import { InfoDialog, computeInfoDialogLayout, splitIntoColumns } from "@/components/InfoDialog";

const LONG_TEXT = [
  "Angezeigt werden Temperatur in 6 Höhen (2/50/100/150/200/250m AGL), Wind in 6 Höhen, Böen, Windrichtung, Wolkenbedeckung, Niederschlag, Luftfeuchtigkeit, QNH und Sichtweite.",
  "Der Kp-Index zeigt die geomagnetische Aktivität: 0–2 grün, 3–4 gelb, 5 orange, ab 6 rot. Ab Kp 5 können GNSS- und Kompassstörungen auftreten, müssen am Standort aber nicht.",
  "Rot/Orange markierte Wetterwerte überschreiten Grenzwerte oder bilden gefährliche Kombinationen:\n- Bodenwind > 10 m/s (rot) / > 7 m/s (orange)\n- Böen > 12 m/s (rot) / > 9 m/s (orange)",
  "Bewölkung & Feuchte allein werden nicht mehr highlightet — nur in der Vereisungs-/Beschlagskombination mit der Temperatur.",
].join("\n\n");

const INSETS = { top: 24, bottom: 0, left: 0, right: 0 };

function mockWindow(width: number, height: number) {
  return jest.spyOn(Dimensions, "get").mockImplementation(() => ({ width, height, scale: 2, fontScale: 1 }));
}

function renderDialog(onClose: () => void, text = LONG_TEXT): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 0, height: 0 }, insets: INSETS }}>
        <InfoDialog visible onClose={onClose} title="Wetterdaten" text={text} />
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id);
const hostById = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === id)[0];

test("Querformat 960×540: breites Panel, zwei Spalten, X unterhalb der Statusleiste", () => {
  const spy = mockWindow(960, 540);
  try {
    const onClose = jest.fn();
    const tree = renderDialog(onClose);
    expect(byId(tree, "info-dialog-landscape").length).toBeGreaterThan(0);
    expect(byId(tree, "info-dialog-portrait")).toHaveLength(0);
    expect(byId(tree, "info-dialog-columns").length).toBeGreaterThan(0);

    const panel = StyleSheet.flatten(hostById(tree, "info-dialog-landscape").props.style);
    expect(panel.width).toBeGreaterThanOrEqual(0.7 * 960);
    expect(panel.width).toBeLessThanOrEqual(940);
    expect(panel.maxHeight).toBeLessThanOrEqual(0.94 * 540);
    expect(panel.maxHeight).toBeGreaterThan(400);

    // Overlay hält den Statusleisten-Streifen (Download-Pille) frei.
    const overlay = StyleSheet.flatten(hostById(tree, "info-dialog-overlay").props.style);
    expect(overlay.paddingTop).toBeGreaterThanOrEqual(INSETS.top);

    // Alle Texte vollständig vorhanden (nichts abgeschnitten/verändert).
    const texts = tree.root
      .findAll((n) => typeof n.type === "string" && n.type === "Text")
      .map((n) => n.props.children)
      .filter((c) => typeof c === "string") as string[];
    for (const para of LONG_TEXT.split("\n\n")) expect(texts).toContain(para);

    // Schließen: X, OK, Tipp außerhalb, Android-Zurück.
    act(() => byId(tree, "info-dialog-close").find((n) => typeof n.props.onPress === "function")!.props.onPress());
    act(() => byId(tree, "info-dialog-ok").find((n) => typeof n.props.onPress === "function")!.props.onPress());
    act(() => byId(tree, "info-dialog-backdrop").find((n) => typeof n.props.onPress === "function")!.props.onPress());
    act(() => tree.root.findByType(Modal).props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(4);
  } finally {
    spy.mockRestore();
  }
});

test("Hochformat 540×960: volles Bottom-Sheet, eine Spalte", () => {
  const spy = mockWindow(540, 960);
  try {
    const tree = renderDialog(jest.fn());
    expect(byId(tree, "info-dialog-portrait").length).toBeGreaterThan(0);
    expect(byId(tree, "info-dialog-landscape")).toHaveLength(0);
    expect(byId(tree, "info-dialog-columns")).toHaveLength(0);
    const panel = StyleSheet.flatten(hostById(tree, "info-dialog-portrait").props.style);
    expect(panel.width).toBe(540);
    expect(panel.maxHeight).toBeLessThanOrEqual(0.85 * 960);
  } finally {
    spy.mockRestore();
  }
});

test("Querformat mit kurzem Text bleibt einspaltig", () => {
  const spy = mockWindow(960, 540);
  try {
    const tree = renderDialog(jest.fn(), "Kurzer Hinweis.\n\nNoch ein Satz.");
    expect(byId(tree, "info-dialog-landscape").length).toBeGreaterThan(0);
    expect(byId(tree, "info-dialog-columns")).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

test("Layout-Berechnung und Spaltenaufteilung", () => {
  const l = computeInfoDialogLayout(960, 540, { top: 24, bottom: 0, left: 0, right: 0 });
  expect(l.landscape).toBe(true);
  expect(l.panelWidth).toBe(902);
  expect(l.topReserve).toBe(32);
  expect(l.panelMaxHeight).toBe(500);
  const wide = computeInfoDialogLayout(1400, 800, { top: 0, bottom: 0, left: 0, right: 0 });
  expect(wide.panelWidth).toBe(1100);
  const p = computeInfoDialogLayout(540, 960, { top: 24, bottom: 16, left: 0, right: 0 });
  expect(p.landscape).toBe(false);
  expect(p.panelWidth).toBe(540);

  const [a, b] = splitIntoColumns(["aaaa", "bb", "cc"], (s) => s.length);
  expect(a).toEqual(["aaaa"]);
  expect(b).toEqual(["bb", "cc"]);
});
