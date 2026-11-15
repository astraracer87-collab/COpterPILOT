/**
 * Tasten der Fernsteuerung: client/lib/rcKeys.ts mit gemocktem nativen Modul
 * (DeviceEventEmitter als Ereignisquelle) und der Tasten-Test-Bildschirm.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { DeviceEventEmitter, NativeModules, Platform, Text } from "react-native";

// rcKeys liest NativeModules/Platform erst beim Aufruf → Mocks in beforeEach genügen.
import * as rc from "@/lib/rcKeys";
import RcKeyTestScreen, { RC_KEY_TEST_HINT } from "@/screens/RcKeyTestScreen";

const mockSetStringAsync = jest.fn(async (_t: string) => true);
jest.mock("expo-clipboard", () => ({ setStringAsync: (t: string) => mockSetStringAsync(t) }));
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@react-navigation/bottom-tabs", () => ({ useBottomTabBarHeight: () => 0 }));
jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return { useFocusEffect: (cb: () => void | (() => void)) => useEffect(cb, [cb]) };
});

const native = {
  setCaptureMode: jest.fn(),
  setListening: jest.fn(),
  getDeviceInfo: jest.fn(async () => ({
    model: "RC Pro 2",
    manufacturer: "DJI",
    brand: "DJI",
    product: "rcpro2",
    device: "rm520",
    hardware: "qcom",
    board: "b",
    display: "d",
    release: "13",
    sdkInt: 33,
    captureMode: false,
    inputDevices: [
      {
        id: 3,
        name: "dji-keys",
        descriptor: "abc",
        sources: 0x101,
        sourceNames: ["KEYBOARD"],
        vendorId: 0x2ca3,
        productId: 0x1020,
        keyboardType: "non_alphabetic",
        isVirtual: false,
        controllerNumber: 0,
        axes: [],
      },
    ],
  })),
};

const originalOS = Platform.OS;

function keyEvent(over: Record<string, unknown> = {}) {
  return {
    type: "key",
    action: "down",
    keyCode: 19,
    keyName: "KEYCODE_DPAD_UP",
    scanCode: 103,
    repeatCount: 0,
    metaState: 0,
    flags: 8,
    source: 0x301,
    sourceNames: ["KEYBOARD", "DPAD"],
    deviceId: 3,
    deviceName: "dji-keys",
    isGamepad: false,
    isSystem: false,
    consumed: true,
    eventTime: 1,
    timestamp: new Date(2026, 10, 15, 12, 30, 5, 42).getTime(),
    ...over,
  };
}

function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => {
      const c = t.props.children;
      return Array.isArray(c) ? c.join("") : String(c ?? "");
    })
    .join("\n");
}

beforeEach(() => {
  jest.clearAllMocks();
  (NativeModules as Record<string, unknown>).RcKeys = native;
  Object.defineProperty(Platform, "OS", { value: "android", configurable: true, writable: true });
});

afterEach(() => {
  delete (NativeModules as Record<string, unknown>).RcKeys;
  Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true, writable: true });
});

describe("lib/rcKeys", () => {

  test("abonnieren, Ereignisse empfangen, abmelden (setListening nur beim ersten/letzten)", () => {
    expect(rc.isRcKeysAvailable()).toBe(true);
    const a = jest.fn();
    const b = jest.fn();
    const offA = rc.subscribeRcInput(a);
    const offB = rc.subscribeRcInput(b);
    expect(native.setListening).toHaveBeenCalledTimes(1);
    expect(native.setListening).toHaveBeenLastCalledWith(true);
    DeviceEventEmitter.emit("rcKey", keyEvent());
    DeviceEventEmitter.emit("rcMotion", {
      action: "ACTION_MOVE",
      axes: { HAT_X: -1 },
      sourceNames: ["JOYSTICK"],
      source: 0x1000010,
      deviceId: 4,
      deviceName: "joy",
      buttonState: 0,
      centered: false,
      consumed: false,
      eventTime: 2,
      timestamp: 2,
    });
    expect(a).toHaveBeenCalledTimes(2);
    expect(a.mock.calls[0][0]).toMatchObject({ type: "key", keyCode: 19 });
    expect(a.mock.calls[1][0]).toMatchObject({ type: "motion", axes: { HAT_X: -1 } });
    offA();
    offA();
    expect(native.setListening).toHaveBeenCalledTimes(1);
    offB();
    expect(native.setListening).toHaveBeenLastCalledWith(false);
    DeviceEventEmitter.emit("rcKey", keyEvent());
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  test("Aufnahme-Modus und Geräteangaben", async () => {
    rc.setRcCaptureMode(true);
    expect(native.setCaptureMode).toHaveBeenCalledWith(true);
    const info = await rc.getRcDeviceInfo();
    expect(info?.model).toBe("RC Pro 2");
    expect(rc.formatRcDeviceInfo(info)).toContain('#3 "dji-keys" src=257[KEYBOARD] vendor=0x2ca3 product=0x1020');
  });

  test("Beschreibung und Protokollzeile", () => {
    const e = keyEvent() as unknown as rc.RcKeyEvent;
    expect(rc.describeRcEvent(e)).toBe("Taste: KEYCODE_DPAD_UP (19) · gedrückt");
    expect(rc.describeRcEvent({ ...e, action: "up", repeatCount: 0 })).toBe("Taste: KEYCODE_DPAD_UP (19) · losgelassen");
    expect(rc.formatRcLogLine(e)).toBe(
      '12:30:05.042 KEY down KEYCODE_DPAD_UP(19) scan=103 rep=0 meta=0 flags=8 src=769[KEYBOARD|DPAD] dev=3 "dji-keys" abgefangen',
    );
    expect(rc.formatAxes({})).toBe("Mitte (alle Achsen 0)");
    expect(rc.formatAxes({ HAT_Y: 1, VSCROLL: -0.5 })).toBe("HAT_Y 1, VSCROLL -0.50");
  });

  test("ohne natives Modul (iOS/Web/Tests): No-op", async () => {
    delete (NativeModules as Record<string, unknown>).RcKeys;
    expect(rc.isRcKeysAvailable()).toBe(false);
    const off = rc.subscribeRcInput(jest.fn());
    off();
    rc.setRcCaptureMode(true);
    expect(await rc.getRcDeviceInfo()).toBeNull();
    (NativeModules as Record<string, unknown>).RcKeys = native;
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true, writable: true });
    expect(rc.isRcKeysAvailable()).toBe(false);
  });
});

describe("RcKeyTestScreen", () => {

  function press(tree: ReactTestRenderer, testID: string) {
    const el = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
    act(() => {
      el.props.onPress();
    });
  }

  test("Start → Aufnahme-Modus, Ereignis groß + Protokoll, kopieren, leeren, beenden", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RcKeyTestScreen />);
    });
    let text = allText(tree);
    expect(text).toContain(RC_KEY_TEST_HINT);
    expect(text).toContain("Tasten-Test starten");
    expect(text).toContain("Test nicht gestartet");
    expect(text).toContain("DJI RC Pro 2");
    expect(text).toContain("dji-keys");

    press(tree, "rc-key-toggle");
    expect(native.setCaptureMode).toHaveBeenLastCalledWith(true);
    expect(native.setListening).toHaveBeenLastCalledWith(true);
    expect(allText(tree)).toContain("Tasten-Test beenden");

    act(() => {
      DeviceEventEmitter.emit("rcKey", keyEvent());
      DeviceEventEmitter.emit("rcKey", keyEvent({ action: "up" }));
      DeviceEventEmitter.emit("rcMotion", {
        action: "ACTION_SCROLL",
        axes: { VSCROLL: 1 },
        sourceNames: ["ROTARY_ENCODER"],
        source: 0x400000,
        deviceId: 5,
        deviceName: "wheel",
        buttonState: 0,
        centered: false,
        consumed: true,
        eventTime: 3,
        timestamp: 3,
      });
      DeviceEventEmitter.emit("rcKey", keyEvent());
    });
    text = allText(tree);
    expect(tree.root.findByProps({ testID: "rc-key-last" }).props.children).toBe("Taste: KEYCODE_DPAD_UP (19) · gedrückt");
    expect(text).toContain("Protokoll (4/100)");
    expect(text).toContain("VSCROLL 1");

    await act(async () => {
      tree.root.findAll((n) => n.props.testID === "rc-key-copy" && typeof n.props.onPress === "function")[0].props.onPress();
    });
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    const copied = mockSetStringAsync.mock.calls[0][0];
    expect(copied).toContain("Gerät: DJI RC Pro 2");
    expect(copied).toContain("KEY down KEYCODE_DPAD_UP(19)");
    expect(copied).toContain("MOTION ACTION_SCROLL VSCROLL 1");

    press(tree, "rc-key-clear");
    expect(allText(tree)).toContain("Protokoll (0/100)");

    press(tree, "rc-key-toggle");
    expect(native.setCaptureMode).toHaveBeenLastCalledWith(false);
    expect(native.setListening).toHaveBeenLastCalledWith(false);
    act(() => tree.unmount());
  });

  test("Verlassen während des Tests schaltet den Aufnahme-Modus ab", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RcKeyTestScreen />);
    });
    press(tree, "rc-key-toggle");
    expect(native.setCaptureMode).toHaveBeenLastCalledWith(true);
    act(() => tree.unmount());
    expect(native.setCaptureMode).toHaveBeenLastCalledWith(false);
  });

  test("ohne natives Modul: Hinweis, Start-Knopf deaktiviert", async () => {
    delete (NativeModules as Record<string, unknown>).RcKeys;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<RcKeyTestScreen />);
    });
    expect(tree.root.findAllByProps({ testID: "rc-key-unavailable" }).length).toBeGreaterThan(0);
    const btn = tree.root.findAll((n) => n.props.testID === "rc-key-toggle" && n.props.disabled !== undefined)[0];
    expect(btn.props.disabled).toBe(true);
    expect(allText(tree)).toContain("Keine Geräteangaben verfügbar.");
    act(() => tree.unmount());
  });
});
