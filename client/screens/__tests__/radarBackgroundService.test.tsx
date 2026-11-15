/**
 * Hintergrund-Überwachung: Android-Verdrahtung (client/lib/radarMonitorNative.ts)
 * mit nachgebautem Vordergrunddienst (react-native-background-actions) und
 * Benachrichtigungen (expo-notifications), Schalter in den TCAS-Einstellungen.
 * Was nur auf dem Gerät prüfbar ist: siehe docs/pruefung-umbau-plan.md
 * („Stand Hintergrund-Radar“).
 */
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Platform } from "react-native";

const mockStart = jest.fn(async () => {});
const mockStop = jest.fn(async () => {});
let mockRunning = false;
jest.mock("react-native-background-actions", () => ({
  __esModule: true,
  default: {
    start: (...a: unknown[]) => {
      mockRunning = true;
      return (mockStart as (...x: unknown[]) => Promise<void>)(...a);
    },
    stop: () => {
      mockRunning = false;
      return mockStop();
    },
    isRunning: () => mockRunning,
  },
}));
const mockSchedule = jest.fn(async () => "id");
const mockChannel = jest.fn(async () => null);
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: "max" },
  setNotificationChannelAsync: (...a: unknown[]) => (mockChannel as (...x: unknown[]) => Promise<null>)(...a),
  scheduleNotificationAsync: (...a: unknown[]) => (mockSchedule as (...x: unknown[]) => Promise<string>)(...a),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock("@/lib/location", () => ({
  Accuracy: { High: 4, Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
}));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({ useBottomTabBarHeight: () => 0 }));
jest.mock("@react-navigation/native", () => ({ useFocusEffect: (cb: () => void) => require("react").useEffect(cb, []) }));
jest.mock("@react-native-community/slider", () => () => null);

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getRadarBackgroundEnabled,
  radarMonitor,
  radarMonitorDeps,
  RADAR_ALERT_CHANNEL_ID,
  RADAR_BACKGROUND_KEY,
} from "@/lib/radarMonitorNative";
import TcasSettingsScreen from "@/screens/TcasSettingsScreen";

const PARAMS = { latitude: 50, longitude: 8, followGps: true, radiusKm: 10, raRadiusKm: 1, countryIso: "DE", pilotElevationMSL: 0 };
const originalOS = Platform.OS;

beforeEach(async () => {
  Platform.OS = "android";
  await AsyncStorage.clear();
  mockStart.mockClear();
  mockStop.mockClear();
  mockSchedule.mockClear();
});
afterEach(async () => {
  await radarMonitor.stop();
  Platform.OS = originalOS;
});

test("Standard an; Start mit Daueranzeige, Typ location, Stopp-Link; Stopp beendet den Dienst", async () => {
  expect(await getRadarBackgroundEnabled()).toBe(true);
  expect(await radarMonitor.start(PARAMS)).toBe(true);
  expect(mockStart).toHaveBeenCalledTimes(1);
  const opts = (mockStart.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
  expect(opts).toMatchObject({
    taskTitle: "COpter Pilot – Luftraumüberwachung aktiv",
    linkingURI: "copterpilot://radar-monitor/stop",
    foregroundServiceType: ["location"],
    taskIcon: { name: "ic_launcher", type: "mipmap" },
  });
  await radarMonitor.stop("screen");
  expect(mockStop).toHaveBeenCalledTimes(1);
});

test("Einstellung aus → kein Dienst; nicht-Android → kein Dienst", async () => {
  await AsyncStorage.setItem(RADAR_BACKGROUND_KEY, "0");
  expect(await radarMonitor.start(PARAMS)).toBe(false);
  await AsyncStorage.removeItem(RADAR_BACKGROUND_KEY);
  Platform.OS = "ios";
  expect(await radarMonitor.start(PARAMS)).toBe(false);
  expect(mockStart).not.toHaveBeenCalled();
});

test("Warnung als lokale Benachrichtigung im Kanal „radar-alerts“ mit Ton und Vibration", async () => {
  await radarMonitorDeps.notify({ kind: "traffic-critical", title: "RA – Luftfahrzeug sehr nah!", body: "DLH1 · 0,5 km" });
  expect(mockChannel).toHaveBeenCalledWith(RADAR_ALERT_CHANNEL_ID, expect.objectContaining({ importance: 5, sound: "default", enableVibrate: true }));
  expect(mockSchedule).toHaveBeenCalledWith(
    expect.objectContaining({
      content: expect.objectContaining({ title: "RA – Luftfahrzeug sehr nah!", sound: "default" }),
      trigger: { channelId: RADAR_ALERT_CHANNEL_ID },
    }),
  );
});

test("TCAS-Einstellungen: Schalter „Im Hintergrund weiter überwachen“ speichert und stoppt laufende Überwachung", async () => {
  await radarMonitor.start(PARAMS);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<TcasSettingsScreen />);
  });
  const sw = tree.root.findByProps({ testID: "toggle-radar-background" });
  expect(sw.props.value).toBe(true);
  await act(async () => sw.props.onValueChange(false));
  expect(await AsyncStorage.getItem(RADAR_BACKGROUND_KEY)).toBe("0");
  expect(radarMonitor.status().running).toBe(false);
  expect(radarMonitor.status().lastStopReason).toBe("disabled");
  act(() => tree.unmount());
});
