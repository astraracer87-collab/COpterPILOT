/**
 * Flache Kopfzeile wie bei den NOTAMs: Titel links in einer Zeile, Aktionen
 * rechts, kein großer zentrierter Stack-Titel (Querformat der Fernsteuerung).
 * Als `header` einer Stack-Seite verwenden; die Höhe misst der Stack selbst.
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

export function CompactStackHeader({ navigation, options, route, back }: NativeStackHeaderProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const title =
    typeof options.headerTitle === "string" ? options.headerTitle : options.title ?? route.name;
  const left = options.headerLeft?.({ canGoBack: !!back, tintColor: theme.text });
  const right = options.headerRight?.({ canGoBack: !!back, tintColor: theme.text });

  return (
    <View
      testID={`compact-header-${route.name}`}
      style={[styles.row, { paddingTop: insets.top + Spacing.xs, backgroundColor: theme.backgroundRoot }]}
    >
      {left ??
        (back ? (
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Zurück"
            testID="compact-header-back"
          >
            <Feather name="arrow-left" size={22} color={theme.text} />
          </Pressable>
        ) : null)}
      <ThemedText style={[styles.title, { color: theme.text }]} numberOfLines={1}>
        {title}
      </ThemedText>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export const compactHeader = (props: NativeStackHeaderProps) => <CompactStackHeader {...props} />;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xs,
    minHeight: 40,
  },
  title: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
});
