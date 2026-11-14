import { openLink } from "@/lib/webBrowser";
import React, { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Platform, Linking } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";
import { getDrone, DroneProfile } from "@/lib/storage";
import {
  getCinematicSettingsForModel,
  DRONE_MOVES_GUIDE,
  type DroneCinematicSettings,
} from "@/lib/droneCinematicSettings";
import type { NdFilterStackParamList } from "@/navigation/NdFilterStackNavigator";

type RouteParams = RouteProp<NdFilterStackParamList, "DroneCinematic">;
type NavigationProp = NativeStackNavigationProp<NdFilterStackParamList>;

type ViewMode = "settings" | "moves";

export default function DroneCinematicScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const params = route.params ?? {};
  const [drone, setDrone] = useState<DroneProfile | null>(null);

  const load = useCallback(async () => {
    if (params.droneId) {
      const d = await getDrone(params.droneId);
      setDrone(d);
    }
  }, [params.droneId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const settings: DroneCinematicSettings | null = useMemo(() => {
    const model = params.model ?? drone?.model ?? null;
    const name = params.droneName ?? drone?.name ?? null;
    return getCinematicSettingsForModel(model, name);
  }, [params.model, params.droneName, drone?.model, drone?.name]);

  const [mode, setMode] = useState<ViewMode>(
    params.initialView ?? (settings ? "settings" : "moves"),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: settings ? settings.displayName : "Cinematic-Guide",
    });
  }, [navigation, settings]);

  const openSource = async (url: string) => {
    if (Platform.OS === "web") {
      openLink(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  const Tab = ({ value, label }: { value: ViewMode; label: string }) => {
    const active = mode === value;
    return (
      <Pressable
        onPress={() => setMode(value)}
        style={[
          styles.tab,
          { backgroundColor: active ? theme.primary : theme.backgroundSecondary },
        ]}
        testID={`tab-cinematic-${value}`}
      >
        <ThemedText style={[styles.tabText, { color: active ? "#FFF" : theme.text }]}>
          {label}
        </ThemedText>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container} testID="screen-drone-cinematic">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        {settings ? (
          <View style={styles.tabRow}>
            <Tab value="settings" label="Kameraeinstellungen" />
            <Tab value="moves" label="Flugmanöver" />
          </View>
        ) : null}

        {mode === "settings" && settings ? (
          <>
            <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
              Empfohlene cinematische Kamera- und Tuning-Einstellungen für die{" "}
              {settings.displayName}.
            </ThemedText>
            {settings.groups.map((group) => (
              <Card key={group.title} style={styles.card}>
                <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>
                  {group.title}
                </ThemedText>
                {group.items.map((item, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <View style={[styles.bullet, { backgroundColor: theme.primary }]} />
                    <ThemedText style={styles.bulletText}>{item}</ThemedText>
                  </View>
                ))}
              </Card>
            ))}
            <Pressable
              onPress={() => openSource(settings.sourceUrl)}
              style={styles.sourceRow}
              testID="link-cinematic-source"
            >
              <Feather name="external-link" size={14} color={theme.textTertiary} />
              <ThemedText style={[styles.sourceText, { color: theme.textTertiary }]}>
                Quelle: {settings.source}
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
              {DRONE_MOVES_GUIDE.title} — funktioniert mit jeder Drohne.
            </ThemedText>
            {DRONE_MOVES_GUIDE.moves.map((move) => (
              <Card key={move.title} style={styles.card}>
                <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>
                  {move.title}
                </ThemedText>
                {move.sections.map((section, sIdx) => (
                  <View key={sIdx} style={sIdx > 0 ? styles.moveSectionGap : undefined}>
                    {section.label ? (
                      <ThemedText style={[styles.moveLabel, { color: theme.textSecondary }]}>
                        {section.label}
                      </ThemedText>
                    ) : null}
                    {section.steps.map((step, stepIdx) => (
                      <View key={stepIdx} style={styles.bulletRow}>
                        <View style={[styles.bullet, { backgroundColor: theme.primary }]} />
                        <ThemedText style={styles.bulletText}>{step}</ThemedText>
                      </View>
                    ))}
                  </View>
                ))}
              </Card>
            ))}
            <Pressable
              onPress={() => openSource(DRONE_MOVES_GUIDE.sourceUrl)}
              style={styles.sourceRow}
              testID="link-moves-source"
            >
              <Feather name="external-link" size={14} color={theme.textTertiary} />
              <ThemedText style={[styles.sourceText, { color: theme.textTertiary }]}>
                Quelle: {DRONE_MOVES_GUIDE.source}
              </ThemedText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    flexGrow: 1,
  },
  tabRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: 10,
    alignItems: "center",
  },
  tabText: {
    ...Typography.small,
    fontWeight: "700",
  },
  intro: {
    ...Typography.small,
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  card: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 6,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 7,
    marginRight: Spacing.sm,
  },
  bulletText: {
    ...Typography.small,
    flex: 1,
    lineHeight: 19,
  },
  moveLabel: {
    ...Typography.small,
    fontWeight: "700",
    marginTop: Spacing.sm,
  },
  moveSectionGap: {
    marginTop: Spacing.xs,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  sourceText: {
    fontSize: 11,
  },
});
