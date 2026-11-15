/**
 * Regression coverage for the native planning date/time picker flow.
 *
 * The real DateTimePicker is native code and cannot be launched by the Jest
 * runner. The screen is rendered with a faithful picker boundary instead:
 * the test drives the real screen handlers and invokes the callbacks with
 * the values a native picker would return. Running the same flow for both
 * platform values protects the iOS inline-picker and Android dialog branches.
 */
import React from "react";
import { Platform } from "react-native";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

const mockNavigate = jest.fn();

jest.mock("@react-native-community/datetimepicker", () => {
  const React = require("react");
  return {
    __esModule: true,
    default: (props: any) => React.createElement("DateTimePicker", props),
  };
});

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({
    params: {
      droneId: undefined,
      latitude: 50.1109,
      longitude: 8.6821,
      locationName: "Teststandort",
      countryIso: "DE",
      radiusKm: 0.1,
      maxAltitude: 120,
      recommendedVlosM: null,
      vlosExceeded: false,
      vlosCharDimensionM: null,
      routeWaypoints: undefined,
      sessionId: undefined,
      restrictionStatus: undefined,
      restrictionNotes: undefined,
      officialMapCrossCheck: undefined,
    },
  }),
}));

jest.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 0,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    isDark: false,
    theme: {
      backgroundDefault: "#fff",
      backgroundSecondary: "#f5f5f5",
      backgroundTertiary: "#eee",
      border: "#ddd",
      primary: "#06f",
      statusCaution: "#c80",
      statusCautionBackground: "#fff4d6",
      statusGo: "#080",
      statusGoBackground: "#e5f7e5",
      statusNoGo: "#d00",
      statusNoGoBackground: "#ffe5e5",
      text: "#111",
      textSecondary: "#555",
      textTertiary: "#888",
    },
  }),
}));

jest.mock("@/components/ThemedText", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    ThemedText: ({ children, ...props }: any) =>
      React.createElement(Text, props, children),
  };
});

jest.mock("@/components/ThemedView", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    ThemedView: ({ children, ...props }: any) =>
      React.createElement(View, props, children),
  };
});

jest.mock("@/components/Card", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Card: ({ children, ...props }: any) =>
      React.createElement(View, props, children),
  };
});

jest.mock("@/components/Button", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({ title, onPress, disabled, ...props }: any) =>
      React.createElement(
        Pressable,
        { ...props, disabled, onPress: disabled ? undefined : onPress },
        React.createElement(Text, null, title),
      ),
  };
});

jest.mock("@/components/SunArcChart", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: (props: any) => React.createElement(View, props),
  };
});

jest.mock("@/components/HourlyForecastTable", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: (props: any) => React.createElement(View, props),
  };
});

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => React.createElement(View, props) };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 0 },
  NotificationFeedbackType: { Success: 0 },
}));

jest.mock("@/lib/storage", () => ({
  DEFAULT_LIMITS: {
    maxWind: 10,
    maxGusts: 15,
    maxRain: 2,
  },
  getDrone: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/flightPlanningMode", () => ({
  getFlightPlanningMode: () => "planning",
}));

jest.mock("@/lib/weather", () => ({
  fetchHourlyForecasts: jest
    .fn()
    .mockResolvedValue({ slots: [], source: "openmeteo" }),
}));

jest.mock("@/lib/manualRestrictionFlow", () => ({
  forwardManualRestrictionParams: () => ({}),
  forwardCrossCheckParams: () => ({}),
}));

jest.mock("@/lib/countryInfo", () => ({
  getNightFlightRule: () => ({ severity: "info", shortText: "Nachtflug" }),
}));

import PlanningDateTimeScreen from "../PlanningDateTimeScreen";
import { formatLocalDateKey } from "../../lib/planningDateTime";

function byTestId(tree: ReactTestRenderer, testID: string) {
  return tree.root.find((node) => node.props?.testID === testID);
}

function picker(tree: ReactTestRenderer, testID: string) {
  return byTestId(tree, testID);
}

function renderScreen(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(React.createElement(PlanningDateTimeScreen));
  });
  return tree;
}

let originalOS: typeof Platform.OS;
beforeAll(() => {
  originalOS = Platform.OS;
});

afterAll(() => {
  Platform.OS = originalOS;
});

describe.each(["ios", "android"] as const)(
  "native picker flow on %s",
  (platform) => {
    let tree: ReactTestRenderer | null = null;

    beforeEach(() => {
      mockNavigate.mockClear();
      Platform.OS = platform;
      tree = renderScreen();
    });

    afterEach(() => {
      if (tree) {
        act(() => tree?.unmount());
        tree = null;
      }
    });

    it("keeps tomorrow on the local calendar day while changing both times", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      await act(async () => {
        byTestId(tree!, "planning-date-button").props.onPress();
      });
      const datePicker = picker(tree!, "planning-date-picker");
      expect(datePicker.props.mode).toBe("date");

      await act(async () => {
        datePicker.props.onChange({ type: "set" }, tomorrow);
      });

      await act(async () => {
        byTestId(tree!, "planning-start-time-button").props.onPress();
      });
      const startPicker = picker(tree!, "planning-start-time-picker");
      const changedStart = new Date(tomorrow);
      changedStart.setHours(8, 15, 0, 0);
      expect(formatLocalDateKey(startPicker.props.value)).toBe(
        formatLocalDateKey(tomorrow),
      );

      await act(async () => {
        startPicker.props.onChange({ type: "set" }, changedStart);
      });

      await act(async () => {
        byTestId(tree!, "planning-end-time-button").props.onPress();
      });
      const endPicker = picker(tree!, "planning-end-time-picker");
      expect(endPicker.props.mode).toBe("time");
      expect(formatLocalDateKey(endPicker.props.value)).toBe(
        formatLocalDateKey(tomorrow),
      );

      const changedEnd = new Date(tomorrow);
      changedEnd.setHours(9, 15, 0, 0);
      await act(async () => {
        endPicker.props.onChange({ type: "set" }, changedEnd);
      });

      if (platform === "ios") {
        await act(async () => {
          byTestId(tree!, "planning-end-time-button").props.onPress();
        });
      }
      await act(async () => {
        byTestId(tree!, "planning-end-time-button").props.onPress();
      });
      const reopenedEndPicker = picker(tree!, "planning-end-time-picker");
      expect(formatLocalDateKey(reopenedEndPicker.props.value)).toBe(
        formatLocalDateKey(tomorrow),
      );
      expect(reopenedEndPicker.props.value.getHours()).toBe(9);
      expect(reopenedEndPicker.props.value.getMinutes()).toBe(15);

      await act(async () => {
        byTestId(tree!, "planning-continue-button").props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith(
        "PlanningRestrictions",
        expect.objectContaining({
          plannedDate: formatLocalDateKey(tomorrow),
          plannedTime: "08:15",
          endTime: "09:15",
        }),
      );
    });

    it("takes over an end time after midnight (23:30–03:00) in chart, summary and params", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);

      await act(async () => {
        byTestId(tree!, "planning-date-button").props.onPress();
      });
      await act(async () => {
        picker(tree!, "planning-date-picker").props.onChange({ type: "set" }, tomorrow);
      });

      await act(async () => {
        byTestId(tree!, "planning-start-time-button").props.onPress();
      });
      const start = new Date(tomorrow);
      start.setHours(23, 30, 0, 0);
      await act(async () => {
        picker(tree!, "planning-start-time-picker").props.onChange({ type: "set" }, start);
      });

      if (platform === "ios") {
        await act(async () => {
          byTestId(tree!, "planning-start-time-button").props.onPress();
        });
      }
      await act(async () => {
        byTestId(tree!, "planning-end-time-button").props.onPress();
      });
      const end = new Date(tomorrow);
      end.setHours(3, 0, 0, 0);
      await act(async () => {
        picker(tree!, "planning-end-time-picker").props.onChange({ type: "set" }, end);
      });

      // Chart: Bereich endet am Folgetag 03:00 (nicht mehr auf 23:45 geklemmt).
      const chart = tree!.root.find((n) => typeof n.props?.onRangeChange === "function");
      const expectedStart = new Date(tomorrow);
      expectedStart.setHours(23, 30, 0, 0);
      const expectedEnd = new Date(dayAfter);
      expectedEnd.setHours(3, 0, 0, 0);
      expect(chart.props.rangeStart.getTime()).toBe(expectedStart.getTime());
      expect(chart.props.rangeEnd.getTime()).toBe(expectedEnd.getTime());

      // "+1"-Hinweis an der Endzeit und Hinweiszeile.
      expect(tree!.root.findAll((n) => n.props?.testID === "planning-end-next-day-badge").length).toBeGreaterThan(0);
      const summary = byTestId(tree!, "planning-window-summary");
      const summaryText = ([] as unknown[]).concat(summary.props.children).join("");
      expect(summaryText).toContain("23:30–03:00 (+1 Tag)");

      // Endzeit-Picker liegt auf dem Kalendertag des Endes.
      if (platform === "ios") {
        await act(async () => {
          byTestId(tree!, "planning-end-time-button").props.onPress();
        });
      }
      await act(async () => {
        byTestId(tree!, "planning-end-time-button").props.onPress();
      });
      const reopened = picker(tree!, "planning-end-time-picker");
      expect(formatLocalDateKey(reopened.props.value)).toBe(formatLocalDateKey(dayAfter));
      expect(reopened.props.value.getHours()).toBe(3);

      // Ziehen im Chart aktualisiert die Picker (Zwei-Wege-Sync).
      const dragEnd = new Date(dayAfter);
      dragEnd.setHours(2, 0, 0, 0);
      await act(async () => {
        chart.props.onRangeChange(expectedStart, dragEnd);
      });
      expect(picker(tree!, "planning-end-time-picker").props.value.getHours()).toBe(2);

      await act(async () => {
        byTestId(tree!, "planning-continue-button").props.onPress();
      });
      expect(mockNavigate).toHaveBeenCalledWith(
        "PlanningRestrictions",
        expect.objectContaining({
          plannedDate: formatLocalDateKey(tomorrow),
          plannedTime: "23:30",
          endTime: "02:00",
        }),
      );
    });
  },
);
