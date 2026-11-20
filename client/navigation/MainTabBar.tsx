import React, { useContext, useState } from "react";
import { View, Pressable, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import {
  BottomTabBarHeightCallbackContext,
  BottomTabBarHeightContext,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { DjiLaunchButton } from "@/components/DjiLaunchButton";

/** Höhe der Tab-Leiste ohne Safe-Area (Querformat = Fernsteuerung kompakt). */
export function getMainTabBarHeight(landscape: boolean, bottomInset: number): number {
  return (landscape ? 46 : 60) + bottomInset;
}

/** Hex-Farbe (#RRGGBB) mit Deckkraft; andere Formate unverändert. */
export function withAlpha(color: string, alpha: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${a}`;
  }
  return color;
}

/** Der runde DJI-Knopf steht direkt hinter diesem Tab (zwischen NOTAMs und Logbuch). */
export const DJI_BUTTON_AFTER_ROUTE = "NotamsTab";
/** Tabs, die nicht in der Leiste stehen (über die Einstellungen erreichbar) und welcher Tab dann markiert ist */
export const HIDDEN_TAB_ROUTES: Record<string, string> = { HistoryTab: "SettingsTab" };

/**
 * Index des Tabs, hinter dem der DJI-Knopf steht: nach „NotamsTab“ (per Name,
 * unabhängig von der Anzahl der Tabs); ohne diesen Tab in der Mitte.
 */
export function djiAfterIndex(routes: ReadonlyArray<{ name: string }>): number {
  const byName = routes.findIndex((r) => r.name === DJI_BUTTON_AFTER_ROUTE);
  return byName >= 0 ? byName : Math.ceil(routes.length / 2) - 1;
}

/**
 * Eigene Tab-Leiste: Der aktive Tab bekommt eine gefüllte, eingefärbte „Pille“
 * hinter Symbol und Beschriftung (nicht nur blaue Schrift). Im Querformat
 * (Fernsteuerung) stehen Symbol und Text nebeneinander und die Leiste ist flach.
 *
 * Die Leiste liegt NICHT absolut über dem Inhalt, sondern im Layout-Fluss: Der
 * Inhaltsbereich jedes Tabs endet oberhalb der Leiste, dadurch kann nichts
 * mehr hinter der Leiste verschwinden (Scroll-Ende immer erreichbar).
 */
export function MainTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const barHeight = getMainTabBarHeight(landscape, insets.bottom);

  const handleLayout = (e: LayoutChangeEvent) => {
    onHeightChange?.(e.nativeEvent.layout.height);
  };

  return (
    <View
      onLayout={handleLayout}
      testID="main-tab-bar"
      style={[
        styles.bar,
        {
          height: barHeight,
          paddingBottom: insets.bottom,
          paddingLeft: Math.max(insets.left, Spacing.xs),
          paddingRight: Math.max(insets.right, Spacing.xs),
          backgroundColor: theme.backgroundDefault,
          borderTopColor: theme.border,
        },
      ]}
    >
      {state.routes.flatMap((route, index) => {
        if (HIDDEN_TAB_ROUTES[route.name]) return [];
        const { options } = descriptors[route.key];
        const currentName = state.routes[state.index]?.name;
        const focused = state.index === index || HIDDEN_TAB_ROUTES[currentName] === route.name;
        const color = focused ? theme.primary : theme.textTertiary;
        const labelOption = options.tabBarLabel;
        const title = typeof labelOption === "string" ? labelOption : options.title ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };
        const onLongPress = () => {
          navigation.emit({ type: "tabLongPress", target: route.key });
        };

        const icon = options.tabBarIcon?.({ focused, color, size: landscape ? 20 : 22 });
        const label =
          typeof labelOption === "function" ? (
            labelOption({ focused, color, position: landscape ? "beside-icon" : "below-icon", children: title })
          ) : (
            <ThemedText style={[styles.label, { color, fontWeight: focused ? "700" : "500" }]} numberOfLines={1}>
              {title}
            </ThemedText>
          );

        const item = (
          <TabItem
            key={route.key}
            routeName={route.name}
            focused={focused}
            landscape={landscape}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
            testID={options.tabBarButtonTestID ?? `tab-${route.name}`}
          >
            {icon}
            {label}
          </TabItem>
        );
        return index === djiAfterIndex(state.routes)
          ? [item, <DjiLaunchButton key="dji-launch" size={landscape ? 40 : 48} />]
          : [item];
      })}
    </View>
  );
}

interface TabItemProps {
  routeName: string;
  focused: boolean;
  landscape: boolean;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel: string;
  testID: string;
  children: React.ReactNode;
}

/**
 * Ein Tab. „Aktiv“ (= angezeigter Tab) → gefüllte Pille. Nur Tastatur-/
 * Steuerkreuz-Fokus der Fernsteuerung → dünner gestrichelter Rahmen OHNE
 * Füllung, damit ein fokussierter Tab nie wie der aktive aussieht.
 */
function TabItem({ routeName, focused, landscape, onPress, onLongPress, accessibilityLabel, testID, children }: TabItemProps) {
  const { theme } = useTheme();
  const [hasFocus, setHasFocus] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      // kein Android-Ripple/Standard-Fokus-Overlay, das wie eine Auswahl wirkt
      android_ripple={null}
      style={styles.item}
    >
      <View
        testID={focused ? `tab-active-pill-${routeName}` : hasFocus ? `tab-focus-ring-${routeName}` : undefined}
        style={[
          styles.pill,
          landscape ? styles.pillLandscape : styles.pillPortrait,
          focused
            ? { backgroundColor: withAlpha(theme.primary, 0.18), borderColor: withAlpha(theme.primary, 0.45) }
            : hasFocus
              ? { borderColor: theme.textTertiary, borderStyle: "dashed", backgroundColor: "transparent" }
              : styles.pillIdle,
        ]}
      >
        {children}
      </View>
    </Pressable>
  );
}

/**
 * Da die Tab-Leiste im Layout-Fluss liegt, braucht der Inhalt der Tabs keinen
 * zusätzlichen Abstand nach unten mehr: useBottomTabBarHeight() liefert in den
 * Tab-Stacks 0 (sonst entstünde doppelter Leerraum unter Listen und Karten).
 */
export function withContentAboveTabBar<P extends object>(Component: React.ComponentType<P>) {
  function ContentAboveTabBar(props: P) {
    return (
      <BottomTabBarHeightContext.Provider value={0}>
        <Component {...props} />
      </BottomTabBarHeightContext.Provider>
    );
  }
  ContentAboveTabBar.displayName = `ContentAboveTabBar(${Component.displayName || Component.name || "Screen"})`;
  return ContentAboveTabBar;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  pill: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%",
  },
  pillIdle: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  pillLandscape: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
  },
  pillPortrait: {
    flexDirection: "column",
    gap: 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: 16,
  },
  label: {
    fontSize: 12,
  },
});
