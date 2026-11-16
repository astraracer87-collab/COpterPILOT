/**
 * Einblendung über anderen Apps (client/lib/alertOverlay.ts): No-op ohne
 * natives Modul, Durchreichen an das Modul „AlertOverlay“, Ereignis
 * „alertOverlayDismissed“ → Überwachung quittiert, Zeile „Warnung über
 * anderen Apps einblenden“ in den TCAS-Einstellungen, einmaliger Hinweis beim
 * Start der Überwachung.
 */
import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, DeviceEventEmitter, NativeModules, Platform } from "react-native";

jest.mock("react-native-background-actions", () => ({
  __esModule: true,
  default: { start: jest.fn(async () => {}), stop: jest.fn(async () => {}), isRunning: () => false },
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5, HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { MAX: "max", HIGH: "high" },
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  dismissNotificationAsync: jest.fn(async () => {}),
  deleteNotificationChannelAsync: jest.fn(async () => {}),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock("expo-audio", () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  createAudioPlayer: () => ({ volume: 1, play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}) }),
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
  addOverlayDismissListener,
  ALERT_OVERLAY_DISMISSED_EVENT,
  canDrawOverlays,
  consumeOverlayDismissed,
  hideAlertOverlay,
  isAlertOverlaySupported,
  openOverlaySettings,
  restyleServiceNotification,
  showAlertOverlay,
  showTestOverlay,
  updateAlertOverlay,
} from "@/lib/alertOverlay";
import { maybeShowOverlayPermissionHint, OVERLAY_HINT_KEY, radarMonitor } from "@/lib/radarMonitorNative";
import TcasSettingsScreen from "@/screens/TcasSettingsScreen";

const originalOS = Platform.OS;
const modules = NativeModules as Record<string, unknown>;

function installNative(allowed: boolean) {
  const m = {
    canDrawOverlays: jest.fn(async () => allowed),
    openOverlaySettings: jest.fn(async () => true),
    show: jest.fn(async () => allowed),
    update: jest.fn(async () => allowed),
    hide: jest.fn(),
    consumeDismissed: jest.fn(async () => true),
    restyleServiceNotification: jest.fn(),
  };
  modules.AlertOverlay = m;
  return m;
}

beforeEach(async () => {
  Platform.OS = "android";
  delete modules.AlertOverlay;
  await AsyncStorage.clear();
});
afterEach(async () => {
  await radarMonitor.stop();
  delete modules.AlertOverlay;
  Platform.OS = originalOS;
});

describe("ohne natives Modul (Tests, iOS, alte APK): alles No-op", () => {
  test("liefert false bzw. tut nichts und wirft nie", async () => {
    expect(isAlertOverlaySupported()).toBe(false);
    expect(await canDrawOverlays()).toBe(false);
    expect(await openOverlaySettings()).toBe(false);
    expect(await showAlertOverlay({ level: "ra", title: "RA", text: "x" })).toBe(false);
    expect(await updateAlertOverlay({ level: "ta", title: "TA", text: "x" })).toBe(false);
    expect(await consumeOverlayDismissed()).toBe(false);
    expect(await showTestOverlay()).toBe(false);
    expect(() => hideAlertOverlay()).not.toThrow();
    expect(() => restyleServiceNotification()).not.toThrow();
    const cb = jest.fn();
    const off = addOverlayDismissListener(cb);
    DeviceEventEmitter.emit(ALERT_OVERLAY_DISMISSED_EVENT, { test: false });
    expect(cb).not.toHaveBeenCalled();
    off();
    expect(await maybeShowOverlayPermissionHint()).toBe(false);
  });

  test("iOS: auch mit Modul kein Aufruf", async () => {
    const m = installNative(true);
    Platform.OS = "ios";
    expect(await showAlertOverlay({ level: "ra", title: "RA", text: "x" })).toBe(false);
    expect(m.show).not.toHaveBeenCalled();
  });

  test("TCAS-Einstellungen zeigen die Zeile nur mit Modul", async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<TcasSettingsScreen />);
    });
    expect(tree.root.findAllByProps({ testID: "button-test-overlay" })).toHaveLength(0);
    act(() => tree.unmount());
  });
});

describe("mit nativem Modul", () => {
  test("reicht Inhalt bereinigt durch; Fehler des Moduls → false", async () => {
    const m = installNative(true);
    expect(await showAlertOverlay({ level: "ra", title: "RA – Flugobjekt sehr nah!", text: "MUK6978 · 0,8 km", bearingDeg: 45, autoHideMs: 0 })).toBe(true);
    expect(m.show).toHaveBeenCalledWith({ level: "ra", title: "RA – Flugobjekt sehr nah!", text: "MUK6978 · 0,8 km", bearingDeg: 45 });
    m.update.mockRejectedValueOnce(new Error("BadTokenException"));
    expect(await updateAlertOverlay({ level: "ta", title: "TA", text: "" })).toBe(false);
    m.hide.mockImplementationOnce(() => {
      throw new Error("weg");
    });
    expect(() => hideAlertOverlay()).not.toThrow();
  });

  test("Test-Einblendung: 8 s, gelb, als Test markiert", async () => {
    const m = installNative(true);
    expect(await showTestOverlay()).toBe(true);
    expect(m.show).toHaveBeenCalledWith(expect.objectContaining({ level: "ta", autoHideMs: 8000, test: true }));
  });

  test("Ereignis „alertOverlayDismissed“ erreicht den Listener (Test-Einblendung markiert)", () => {
    installNative(true);
    const cb = jest.fn();
    const off = addOverlayDismissListener(cb);
    DeviceEventEmitter.emit(ALERT_OVERLAY_DISMISSED_EVENT, { test: false });
    DeviceEventEmitter.emit(ALERT_OVERLAY_DISMISSED_EVENT, { test: true });
    expect(cb.mock.calls).toEqual([[{ test: false }], [{ test: true }]]);
    off();
  });

  test("TCAS-Einstellungen: Status, „Erlauben“ öffnet die Android-Einstellung, „Einblendung testen“", async () => {
    const m = installNative(false);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<TcasSettingsScreen />);
    });
    const status = tree.root.findByProps({ testID: "text-overlay-status" });
    expect(status.props.children).toBe("Nicht erlaubt");
    await act(async () => tree.root.findByProps({ testID: "button-overlay-settings" }).props.onPress());
    expect(m.openOverlaySettings).toHaveBeenCalled();
    await act(async () => tree.root.findByProps({ testID: "button-test-overlay" }).props.onPress());
    expect(m.show).not.toHaveBeenCalled(); // ohne Erlaubnis kein Versuch
    act(() => tree.unmount());

    const m2 = installNative(true);
    await act(async () => {
      tree = renderer.create(<TcasSettingsScreen />);
    });
    expect(tree.root.findByProps({ testID: "text-overlay-status" }).props.children).toBe("Erlaubt");
    await act(async () => tree.root.findByProps({ testID: "button-test-overlay" }).props.onPress());
    expect(m2.show).toHaveBeenCalledWith(expect.objectContaining({ test: true, autoHideMs: 8000 }));
    act(() => tree.unmount());
  });

  test("Hinweis beim Start der Überwachung nur einmal und nur ohne Erlaubnis", async () => {
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    installNative(true);
    expect(await maybeShowOverlayPermissionHint()).toBe(false);
    const m = installNative(false);
    expect(await maybeShowOverlayPermissionHint()).toBe(true);
    expect(await maybeShowOverlayPermissionHint()).toBe(false);
    expect(await AsyncStorage.getItem(OVERLAY_HINT_KEY)).toBe("1");
    expect(spy).toHaveBeenCalledTimes(1);
    const buttons = spy.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === "Einstellungen öffnen")!.onPress!();
    expect(m.openOverlaySettings).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("Start der Überwachung hängt die Daueranzeige auf den stillen Kanal um", async () => {
    const spy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const m = installNative(true);
    expect(await radarMonitor.start({ latitude: 50, longitude: 8, followGps: true, radiusKm: 10, raRadiusKm: 1, countryIso: "DE", pilotElevationMSL: 0 })).toBe(true);
    expect(m.restyleServiceNotification).toHaveBeenCalled();
    spy.mockRestore();
  });
});
