/**
 * Flugwetter-Sheet (METAR/TAF): im Querformat Seitenpanel mit METAR und TAF
 * nebeneinander, Schließen-Knopf erreichbar; im Hochformat wie bisher.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { Dimensions } from "react-native";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@/lib/dataSource", () => ({ useShowDataSources: () => false }));
jest.mock("@/lib/aviationWeather", () => ({
  decodeMetar: () => [{ label: "Wind", value: "250° 8 kt" }],
  decodeTaf: () => ({ validity: "15.11. 12 Uhr – 16.11. 18 Uhr", base: [{ label: "Wind", value: "250° 10 kt" }], trends: [] }),
  formatObservedTime: () => null,
  fetchAirportWeather: jest.fn(async (icao: string) => ({
    icao,
    metarRaw: "EDDM 151220Z 25008KT 9999 FEW030 12/05 Q1018",
    tafRaw: "TAF EDDM 151100Z 1512/1618 25010KT 9999 SCT030",
    observedAt: null,
    issuedAt: null,
  })),
}));

import AirportWeatherSheet from "@/components/AirportWeatherSheet";

async function renderSheet(onClose: () => void): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<AirportWeatherSheet icao="EDDM" name="München" onClose={onClose} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return tree;
}

const byId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id);

test("Querformat: zwei Spalten und erreichbarer Schließen-Knopf", async () => {
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 960, height: 540, scale: 2, fontScale: 1 }));
  try {
    const onClose = jest.fn();
    const tree = await renderSheet(onClose);
    expect(byId(tree, "airport-weather-landscape").length).toBeGreaterThan(0);
    expect(byId(tree, "airport-weather-columns").length).toBeGreaterThan(0);
    const close = byId(tree, "airport-weather-close").find((n) => typeof n.props.onPress === "function")!;
    act(() => close.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test("Hochformat: eine Spalte", async () => {
  const spy = jest
    .spyOn(Dimensions, "get")
    .mockImplementation(() => ({ width: 540, height: 960, scale: 2, fontScale: 1 }));
  try {
    const tree = await renderSheet(jest.fn());
    expect(byId(tree, "airport-weather-portrait").length).toBeGreaterThan(0);
    expect(byId(tree, "airport-weather-columns")).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});
