/**
 * Abhaken in Checklisten (Geräte-Feedback RC Pro 2: „träge beim Abhaken“).
 *
 * Abgedeckt:
 * 1. useChecklistState: Haken sind sofort im UI, eine Folge schneller Haken
 *    wird zu EINER Speicherung gebündelt (≤ alle 500 ms).
 * 2. Ausstehende Haken werden bei Unmount, App-Hintergrund und Navigation
 *    (blur) sofort gespeichert – kein Haken geht verloren.
 * 3. Render-Probe: Ein Haken im echten ChecklistScreen rendert nur die
 *    getippte Zeile neu (React.memo + stabile Callbacks), nicht die anderen.
 */
import React from "react";
import { AppState, Text, Pressable } from "react-native";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

// ---------------------------------------------------------------------------
// Mocks (nur für den Screen-Test relevant; der Hook-Test nutzt eine Harness)
// ---------------------------------------------------------------------------

const mockNavigate = jest.fn();
const mockNavListeners: Record<string, Array<() => void>> = {};

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  const nav = {
    navigate: (...args: any[]) => mockNavigate(...args),
    getParent: () => null,
    goBack: jest.fn(),
    addListener: (event: string, cb: () => void) => {
      (mockNavListeners[event] ||= []).push(cb);
      return () => {
        mockNavListeners[event] = (mockNavListeners[event] || []).filter((f) => f !== cb);
      };
    },
  };
  const NavigationContext = React.createContext(undefined);
  return {
    NavigationContext,
    CommonActions: {},
    useNavigation: () => nav,
    useRoute: () => ({
      params: {
        latitude: 50.1,
        longitude: 8.6,
        hasRestrictions: false,
        weatherData: undefined,
        droneId: undefined,
        limits: undefined,
        sessionId: "s1",
        isFpvFlight: false,
      },
    }),
    __mockNav: nav,
  };
});

jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Feather = (props: any) => React.createElement(View, props);
  Feather.glyphMap = {};
  return { Feather };
});
jest.mock("@/lib/storage", () => ({ getDrone: jest.fn(async () => null) }));
jest.mock("@/components/InfoDialog", () => ({ InfoDialog: () => null }));

// Render-Probe: zählt, wie oft jeder Text (z. B. ein Zeilen-Label) gerendert wird.
const mockTextRenders = new Map<string, number>();
jest.mock("@/components/ThemedText", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    ThemedText: ({ children, ...props }: any) => {
      if (typeof children === "string") {
        mockTextRenders.set(children, (mockTextRenders.get(children) ?? 0) + 1);
      }
      return React.createElement(Text, props, children);
    },
  };
});

import { useChecklistState, CHECKLIST_PERSIST_DEBOUNCE_MS } from "@/hooks/useChecklistState";
import ChecklistScreen from "@/screens/ChecklistScreen";

// ---------------------------------------------------------------------------
// Harness für den Hook
// ---------------------------------------------------------------------------

function Harness({ onPersist }: { onPersist: (ids: string[]) => void }) {
  const api = useChecklistState(undefined, { onPersist });
  return (
    <>
      {["a", "b", "c"].map((id) => (
        <Pressable key={id} testID={`row-${id}`} onPress={() => api.toggle(id)}>
          <Text testID={`state-${id}`}>{api.checked.has(id) ? "on" : "off"}</Text>
        </Pressable>
      ))}
    </>
  );
}

function stateOf(tree: ReactTestRenderer, id: string): string {
  return tree.root.findByProps({ testID: `state-${id}` }).props.children;
}

function tap(tree: ReactTestRenderer, testID: string) {
  const node = tree.root.find((n) => n.props.testID === testID && typeof n.props.onPress === "function");
  act(() => {
    node.props.onPress();
  });
}

describe("useChecklistState – optimistisch + gebündelte Speicherung", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("zeigt jeden Haken sofort an und speichert eine Tap-Folge nur einmal", () => {
    const onPersist = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Harness onPersist={onPersist} />);
    });

    tap(tree, "row-a");
    // Sofort sichtbar – ohne auf Timer/Speicher zu warten.
    expect(stateOf(tree, "a")).toBe("on");
    tap(tree, "row-b");
    tap(tree, "row-c");
    tap(tree, "row-b"); // wieder abwählen
    expect(stateOf(tree, "b")).toBe("off");
    expect(stateOf(tree, "c")).toBe("on");

    // Noch keine Speicherung während der Tap-Folge.
    expect(onPersist).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(CHECKLIST_PERSIST_DEBOUNCE_MS);
    });
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenLastCalledWith(["a", "c"]);

    // Ohne neue Haken keine weitere Speicherung.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(onPersist).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it("speichert ausstehende Haken sofort beim Unmount", () => {
    const onPersist = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(<Harness onPersist={onPersist} />);
    });
    tap(tree, "row-a");
    tap(tree, "row-c");
    expect(onPersist).not.toHaveBeenCalled();

    act(() => tree.unmount());
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenLastCalledWith(["a", "c"]);

    // Der abgelaufene Timer schreibt nicht ein zweites Mal.
    act(() => {
      jest.advanceTimersByTime(CHECKLIST_PERSIST_DEBOUNCE_MS * 2);
    });
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it("speichert ausstehende Haken sofort, wenn die App in den Hintergrund geht", () => {
    const appStateHandlers: Array<(s: string) => void> = [];
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, h: any) => {
      appStateHandlers.push(h);
      return { remove: () => {} } as any;
    }) as any);
    try {
      const onPersist = jest.fn();
        let tree!: ReactTestRenderer;
      act(() => {
        tree = renderer.create(<Harness onPersist={onPersist} />);
      });
      tap(tree, "row-b");
      expect(onPersist).not.toHaveBeenCalled();

      act(() => {
        appStateHandlers.forEach((h) => h("background"));
      });
      expect(onPersist).toHaveBeenCalledTimes(1);
      expect(onPersist).toHaveBeenLastCalledWith(["b"]);

      act(() => tree.unmount());
      expect(onPersist).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("speichert ausstehende Haken sofort beim Verlassen des Screens (blur)", () => {
    const { NavigationContext } = require("@react-navigation/native");
    const listeners: Record<string, Array<() => void>> = {};
    const nav = {
      addListener: (e: string, cb: () => void) => {
        (listeners[e] ||= []).push(cb);
        return () => {};
      },
    };
    const onPersist = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <NavigationContext.Provider value={nav}>
          <Harness onPersist={onPersist} />
        </NavigationContext.Provider>,
      );
    });
    tap(tree, "row-a");
    act(() => {
      (listeners.blur || []).forEach((cb) => cb());
    });
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenLastCalledWith(["a"]);
    act(() => tree.unmount());
  });
});

// ---------------------------------------------------------------------------
// Render-Probe im echten ChecklistScreen
// ---------------------------------------------------------------------------

describe("ChecklistScreen – ein Haken rendert nur die getippte Zeile", () => {
  const PROPS_LABEL = "Propeller fest und unbeschädigt";
  const OTHER_LABELS = [
    "Start-/Landeplatz bestätigt",
    "RTH-Höhe korrekt gesetzt",
    "GNSS-Fix stabil (10+ Sats)",
    "Hindernisse vor Ort identifiziert",
  ];

  it("aktualisiert die Checkbox sofort und lässt unbeteiligte Zeilen unangetastet", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<ChecklistScreen />);
    });

    const row = () => tree.root.findByProps({ testID: "checklist-row-props" });
    expect(row().props.accessibilityState).toEqual({ checked: false });

    mockTextRenders.clear();
    act(() => {
      row().props.onPress();
    });

    // Sofort abgehakt (gleicher Render, kein Speicherzugriff).
    expect(row().props.accessibilityState).toEqual({ checked: true });
    // Nur die getippte Zeile hat neu gerendert …
    expect(mockTextRenders.get(PROPS_LABEL)).toBe(1);
    // … alle anderen Zeilen nicht.
    for (const label of OTHER_LABELS) {
      expect(mockTextRenders.get(label) ?? 0).toBe(0);
    }

    // Abwählen ebenso.
    mockTextRenders.clear();
    act(() => {
      row().props.onPress();
    });
    expect(row().props.accessibilityState).toEqual({ checked: false });
    expect(mockTextRenders.get(PROPS_LABEL)).toBe(1);
    for (const label of OTHER_LABELS) {
      expect(mockTextRenders.get(label) ?? 0).toBe(0);
    }

    act(() => tree.unmount());
  });
});
