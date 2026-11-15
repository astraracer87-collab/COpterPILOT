/**
 * Akustischer TCAS-Alarm (client/lib/proximityAlarm.ts + alarmSound.ts):
 * mitgelieferte WAV-Töne über expo-audio (ohne Google-TTS), Audio-Modus
 * „im Hintergrund spielen“, Wiederholung laut Ton-Plan, Knopf
 * „Alarmton testen“ in den TCAS-Einstellungen.
 */
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Vibration } from "react-native";

type MockPlayer = {
  kind: string;
  volume: number;
  play: jest.Mock;
  pause: jest.Mock;
  seekTo: jest.Mock;
};
const mockPlayers: MockPlayer[] = [];
const mockSetAudioMode = jest.fn(async (_mode: unknown) => {});
jest.mock("expo-audio", () => ({
  setAudioModeAsync: (m: unknown) => mockSetAudioMode(m),
  createAudioPlayer: (src: unknown) => {
    const p: MockPlayer = {
      kind: String(src),
      volume: 1,
      play: jest.fn(),
      pause: jest.fn(),
      seekTo: jest.fn(async () => {}),
    };
    mockPlayers.push(p);
    return p;
  },
}));
const mockSpeak = jest.fn();
jest.mock("expo-speech", () => ({
  speak: (...a: unknown[]) => mockSpeak(...a),
  stop: jest.fn(),
}));
jest.mock("react-native-background-actions", () => ({
  __esModule: true,
  default: { start: jest.fn(), stop: jest.fn(), isRunning: () => false },
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: "max" },
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock("@/lib/location", () => ({
  Accuracy: { High: 4 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));
jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (cb: () => void) => require("react").useEffect(cb, []),
}));
jest.mock("@react-native-community/slider", () => () => null);

import {
  stopAlarmSound,
  triggerCriticalAlarm,
  triggerWarningAlarm,
  updateAlarmAltitude,
} from "@/lib/proximityAlarm";
import { DEFAULT_PROXIMITY_ALARM } from "@/lib/storage";
import TcasSettingsScreen from "@/screens/TcasSettingsScreen";

const plays = () =>
  mockPlayers.reduce((n, p) => n + p.play.mock.calls.length, 0);
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let vibrate: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  vibrate = jest.spyOn(Vibration, "vibrate").mockImplementation(() => {});
  jest.spyOn(Vibration, "cancel").mockImplementation(() => {});
  for (const p of mockPlayers) p.play.mockClear();
  mockSpeak.mockClear();
});
afterEach(() => {
  stopAlarmSound();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("RA: Audio-Modus im Hintergrund, Ton sofort und alle 3 s, Vibration, Ansage nach dem Ton", async () => {
  triggerCriticalAlarm(DEFAULT_PROXIMITY_ALARM, 52);
  await flush();
  expect(mockSetAudioMode).toHaveBeenCalledWith(
    expect.objectContaining({
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
    }),
  );
  expect(plays()).toBe(1);
  expect(vibrate).toHaveBeenCalled();
  jest.advanceTimersByTime(1100);
  expect(mockSpeak).toHaveBeenCalledWith(
    expect.stringContaining("Descend"),
    expect.anything(),
  );
  jest.advanceTimersByTime(1900);
  await flush();
  expect(plays()).toBe(2);
  stopAlarmSound();
  jest.advanceTimersByTime(10000);
  await flush();
  expect(plays()).toBe(2);
});

test("TA „entfernt sich“: genau ein leiser Ton, keine Ansage; dreht es → laut und wiederholt", async () => {
  triggerWarningAlarm(DEFAULT_PROXIMITY_ALARM, 52, false);
  await flush();
  expect(plays()).toBe(1);
  jest.advanceTimersByTime(20000);
  await flush();
  expect(plays()).toBe(1);
  expect(mockSpeak).not.toHaveBeenCalled();
  updateAlarmAltitude(50, true);
  await flush();
  expect(plays()).toBe(2);
  jest.advanceTimersByTime(6000);
  await flush();
  expect(plays()).toBe(3);
});

test("„Akustisch“ aus → kein Ton", async () => {
  triggerWarningAlarm(
    {
      ...DEFAULT_PROXIMITY_ALARM,
      ta: { ...DEFAULT_PROXIMITY_ALARM.ta, audio: false },
    },
    52,
    true,
  );
  await flush();
  jest.advanceTimersByTime(20000);
  await flush();
  expect(plays()).toBe(0);
  expect(vibrate).toHaveBeenCalled();
});

test("TCAS-Einstellungen: „Alarmton testen“ spielt TA- und RA-Ton", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<TcasSettingsScreen />);
  });
  const btn = tree.root.findByProps({ testID: "button-test-alarm-sound" });
  await act(async () => {
    btn.props.onPress();
    await flush();
  });
  expect(plays()).toBe(1);
  await act(async () => {
    jest.advanceTimersByTime(1500);
    await flush();
  });
  expect(plays()).toBe(2);
  act(() => tree.unmount());
});
