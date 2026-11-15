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
      {
        id: 6,
        name: "DJI embedded joystick",
        descriptor: "joy",
        sources: 0x01000511,
        sourceNames: ["KEYBOARD", "GAMEPAD", "JOYSTICK"],
        vendorId: 0x2ca3,
        productId: 0x1501,
        keyboardType: "non_alphabetic",
        isVirtual: false,
        controllerNumber: 1,
        axes: ["AXIS_X", "AXIS_HAT_X"],
        ranges: [
          { axis: "X", source: 0x01000010, min: -1, max: 1, flat: 0.01, fuzz: 0, resolution: 0 },
          { axis: "HAT_X", source: 0x01000010, min: -1, max: 1, flat: 0, fuzz: 0, resolution: 0 },
        ],
      },
    ],
    devInput: null,
    procInputDevices: null,
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
    expect(rc.formatAxes({ X: 0, HAT_Y: 1 })).toBe("HAT_Y 1");
    expect(rc.formatAllAxes({ X: 0, HAT_Y: 1 })).toBe("X=0 HAT_Y=1");
    expect(
      rc.formatRcLogLine({
        type: "device",
        change: "added",
        deviceId: 9,
        deviceName: "dji-wheel",
        sources: 0x400000,
        sourceNames: ["ROTARY_ENCODER"],
        timestamp: new Date(2026, 10, 15, 12, 0, 0, 0).getTime(),
      }),
    ).toBe('12:00:00.000 DEVICE added dev=9 "dji-wheel" src=4194304[ROTARY_ENCODER]');
  });

  test("Achsen-Stand und Balken", () => {
    const motion = (axes: Record<string, number>, timestamp: number) =>
      ({ type: "motion", action: "ACTION_MOVE", axes, deviceId: 6, timestamp }) as unknown as rc.RcMotionEvent;
    let st: rc.RcAxisState = {};
    st = rc.updateRcAxisState(st, motion({ X: 0, Z: 0.4 }, 1));
    st = rc.updateRcAxisState(st, motion({ X: -0.8, Z: 0 }, 2));
    expect(st[6].X).toEqual({ value: -0.8, seenMin: -0.8, seenMax: 0, changedAt: 2 });
    expect(st[6].Z).toEqual({ value: 0, seenMin: 0, seenMax: 0.4, changedAt: 2 });
    expect(rc.rcAxisBar(0.5, { min: -1, max: 1 })).toEqual({ start: 0.5, end: 0.75, zero: 0.5 });
    expect(rc.rcAxisBar(-1)).toEqual({ start: 0, end: 0.5, zero: 0.5 });
    expect(rc.rcAxisBar(0.25, { min: 0, max: 1 })).toEqual({ start: 0, end: 0.25, zero: 0 });
    expect(rc.rcAxisBar(5, { min: 0, max: 0 })).toEqual({ start: 0.5, end: 1, zero: 0.5 });
  });

  test("Geräteangaben: Joystick-Geräte, Achsenbereiche, Direktzugriff", async () => {
    const info = await rc.getRcDeviceInfo();
    expect(rc.rcAxisDevices(info).map((d) => d.id)).toEqual([6]);
    const txt = rc.formatRcDeviceInfo(info);
    expect(txt).toContain("X [-1..1] flat=0.01 fuzz=0");
    expect(txt).toContain("/dev/input: nicht lesbar");
    expect(txt).toContain("/proc/bus/input/devices: nicht lesbar");
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
    expect(text).toContain("Protokoll (4 Ereignisse, max. 300 Zeilen)");
    expect(text).toContain("VSCROLL 1");
    // Achsen-Panel: Joystick aus den Geräteangaben + gemeldetes Rad-Gerät
    expect(tree.root.findAllByProps({ testID: "rc-axis-panel" }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: "rc-axis-6-HAT_X" }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: "rc-axis-5-VSCROLL" }).length).toBeGreaterThan(0);

    // Markierung, dann Joystick-Bewegung mit allen Achsen (auch 0)
    press(tree, "rc-key-marker");
    act(() => {
      DeviceEventEmitter.emit("rcMotion", {
        action: "ACTION_MOVE",
        axes: { X: 0, HAT_X: -1 },
        sourceNames: ["JOYSTICK"],
        source: 0x01000010,
        deviceId: 6,
        deviceName: "DJI embedded joystick",
        buttonState: 0,
        centered: false,
        consumed: true,
        via: "window",
        eventTime: 4,
        timestamp: 4,
      });
      DeviceEventEmitter.emit("rcDevice", {
        change: "changed",
        deviceId: 6,
        deviceName: "DJI embedded joystick",
        sources: 0x01000511,
        sourceNames: ["KEYBOARD", "GAMEPAD", "JOYSTICK"],
        timestamp: 5,
      });
    });
    await act(async () => {});
    text = allText(tree);
    expect(text).toContain("----- Markierung 1 -----");
    expect(text).toContain("Markierung setzen (2)");
    expect(text).toContain("Bewegung HAT_X -1 · MOVE · JOYSTICK · DJI embedded joystick");
    expect(text).toContain("Gerät geändert: DJI embedded joystick (#6)");
    expect(text).toContain("-1.00 (-1.00…0.00)");

    await act(async () => {
      tree.root.findAll((n) => n.props.testID === "rc-key-copy" && typeof n.props.onPress === "function")[0].props.onPress();
    });
    expect(mockSetStringAsync).toHaveBeenCalledTimes(1);
    const copied = mockSetStringAsync.mock.calls[0][0];
    expect(copied).toContain("Gerät: DJI RC Pro 2");
    expect(copied).toContain("KEY down KEYCODE_DPAD_UP(19)");
    expect(copied).toContain("MOTION ACTION_SCROLL VSCROLL=1");
    expect(copied).toContain('MOTION ACTION_MOVE X=0 HAT_X=-1 btn=0 src=16777232[JOYSTICK] dev=6 "DJI embedded joystick" abgefangen via=window');
    // älteste zuerst, Markierung zwischen den Ereignissen
    expect(copied.indexOf("ACTION_SCROLL")).toBeLessThan(copied.indexOf("----- Markierung 1 -----"));
    expect(copied.indexOf("----- Markierung 1 -----")).toBeLessThan(copied.indexOf("ACTION_MOVE"));

    press(tree, "rc-key-clear");
    text = allText(tree);
    expect(text).toContain("Protokoll (0 Ereignisse, max. 300 Zeilen)");
    expect(text).toContain("Markierung setzen (1)");

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
