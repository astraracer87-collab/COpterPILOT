import React, { useCallback, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Switch, Alert } from "react-native";
import { enableBackgroundTraffic, disableBackgroundTraffic, isBackgroundTrafficOn } from "@/lib/trafficBackground";
import Slider from "@react-native-community/slider";
import { useFocusEffect } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getSettings, saveSettings, Settings, DEFAULT_PROXIMITY_ALARM } from "@/lib/storage";

function formatRadius(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return km % 1 === 0 ? `${km} km` : `${km.toFixed(1)} km`;
  }
  return `${meters} m`;
}

function snapToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export default function TcasSettingsScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bgTraffic, setBgTraffic] = useState(false);

  useEffect(() => {
    setBgTraffic(isBackgroundTrafficOn());
  }, []);

  const loadSettings = useCallback(async () => {
    const data = await getSettings();
    setSettings(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings])
  );

  const renderTcasToggle = (icon: string, label: string, value: boolean, onToggle: (v: boolean) => void, color: string) => (
    <Pressable
      onPress={() => onToggle(!value)}
      style={[styles.tcasToggleItem, { backgroundColor: value ? color : theme.backgroundSecondary }]}
    >
      <Feather name={icon as any} size={14} color={value ? "#FFFFFF" : theme.textTertiary} />
      <ThemedText style={[styles.tcasToggleLabel, { color: value ? "#FFFFFF" : theme.textTertiary }]}>
        {label}
      </ThemedText>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
      >
        <Card style={styles.menuItem}>
          <View style={styles.switchRow}>
            <Feather name="alert-triangle" size={20} color={theme.primary} />
            <View style={styles.switchContent}>
              <ThemedText style={styles.menuText}>TCAS aktiviert</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Traffic Alert and Collision Avoidance
              </ThemedText>
            </View>
            <Switch
              value={settings?.proximityAlarm?.enabled ?? DEFAULT_PROXIMITY_ALARM.enabled}
              onValueChange={async (value) => {
                if (!settings) return;
                const newSettings = {
                  ...settings,
                  proximityAlarm: { ...(settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM), enabled: value },
                };
                setSettings(newSettings);
                await saveSettings(newSettings);
              }}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary }}
              thumbColor="#FFFFFF"
              testID="toggle-proximity-alarm"
            />
          </View>
        </Card>
        <Card style={styles.menuItem}>
          <View style={styles.switchRow}>
            <Feather name="radio" size={20} color={theme.primary} />
            <View style={styles.switchContent}>
              <ThemedText style={styles.menuText}>Im Hintergrund überwachen</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Annäherungsalarm läuft weiter, während z. B. DJI Fly vorne ist (Vordergrunddienst, Ton). Braucht „Standort immer".
              </ThemedText>
            </View>
            <Switch
              value={bgTraffic}
              onValueChange={async (value) => {
                if (value) {
                  const r = await enableBackgroundTraffic();
                  if (r.ok) setBgTraffic(true);
                  else {
                    setBgTraffic(false);
                    Alert.alert("Hintergrund nicht aktiviert", r.message ?? "Bitte Berechtigungen prüfen.");
                  }
                } else {
                  await disableBackgroundTraffic();
                  setBgTraffic(false);
                }
              }}
              trackColor={{ false: theme.backgroundSecondary, true: theme.primary }}
              thumbColor="#FFFFFF"
              testID="toggle-bg-traffic"
            />
          </View>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.sliderHeader}>
            <Feather name="arrow-down" size={16} color={theme.primary} />
            <ThemedText style={styles.menuText}>Max. Höhe (AGL)</ThemedText>
            <ThemedText style={[styles.sliderValue, { color: theme.primary }]}>
              {settings?.proximityAlarm?.maxAltitudeM ?? DEFAULT_PROXIMITY_ALARM.maxAltitudeM} m
            </ThemedText>
          </View>
          <View style={styles.sliderRow}>
            <ThemedText style={[styles.sliderBound, { color: theme.textTertiary }]}>0m</ThemedText>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={500}
              step={10}
              value={settings?.proximityAlarm?.maxAltitudeM ?? DEFAULT_PROXIMITY_ALARM.maxAltitudeM}
              onSlidingComplete={async (val) => {
                if (!settings) return;
                const snapped = snapToStep(val, 10);
                const ns = {
                  ...settings,
                  proximityAlarm: { ...(settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM), maxAltitudeM: snapped },
                };
                setSettings(ns); await saveSettings(ns);
              }}
              onValueChange={(val) => {
                if (!settings) return;
                const snapped = snapToStep(val, 10);
                setSettings({
                  ...settings,
                  proximityAlarm: { ...(settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM), maxAltitudeM: snapped },
                });
              }}
              minimumTrackTintColor={theme.primary}
              maximumTrackTintColor={theme.backgroundSecondary}
              thumbTintColor={theme.primary}
            />
            <ThemedText style={[styles.sliderBound, { color: theme.textTertiary }]}>500m</ThemedText>
          </View>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={styles.alarmSettingRow}>
            <Feather name="target" size={18} color={theme.primary} />
            <ThemedText style={styles.menuText}>Erfassung</ThemedText>
            <ThemedText style={[styles.menuSubText, { color: theme.textTertiary }]}>= Radar-Radius</ThemedText>
          </View>
        </Card>

        <ThemedText style={[styles.tcasSubHeader, { color: "#FF9500" }]}>
          TA - Traffic Advisory (Gelb)
        </ThemedText>
        <ThemedText style={[styles.tcasDescription, { color: theme.textTertiary }]}>
          Warnung vor nahem Verkehr
        </ThemedText>
        <Card style={[styles.menuItem, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.sliderHeader}>
            <Feather name="radio" size={16} color="#FF9500" />
            <ThemedText style={styles.menuText}>Radius</ThemedText>
            <ThemedText style={[styles.sliderValue, { color: "#FF9500" }]}>
              {formatRadius((settings?.proximityAlarm?.ta?.radiusKm ?? DEFAULT_PROXIMITY_ALARM.ta.radiusKm) * 1000)}
            </ThemedText>
          </View>
          <View style={styles.sliderRow}>
            <ThemedText style={[styles.sliderBound, { color: theme.textTertiary }]}>50m</ThemedText>
            <Slider
              style={styles.slider}
              minimumValue={50}
              maximumValue={5000}
              step={50}
              value={(settings?.proximityAlarm?.ta?.radiusKm ?? DEFAULT_PROXIMITY_ALARM.ta.radiusKm) * 1000}
              onSlidingComplete={async (val) => {
                if (!settings) return;
                const snapped = snapToStep(val, 50);
                const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                const ns = { ...settings, proximityAlarm: { ...pa, ta: { ...(pa.ta ?? DEFAULT_PROXIMITY_ALARM.ta), radiusKm: snapped / 1000 } } };
                setSettings(ns); await saveSettings(ns);
              }}
              onValueChange={(val) => {
                if (!settings) return;
                const snapped = snapToStep(val, 50);
                const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                setSettings({ ...settings, proximityAlarm: { ...pa, ta: { ...(pa.ta ?? DEFAULT_PROXIMITY_ALARM.ta), radiusKm: snapped / 1000 } } });
              }}
              minimumTrackTintColor="#FF9500"
              maximumTrackTintColor={theme.backgroundSecondary}
              thumbTintColor="#FF9500"
            />
            <ThemedText style={[styles.sliderBound, { color: theme.textTertiary }]}>5km</ThemedText>
          </View>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={styles.tcasToggleRow}>
            {renderTcasToggle("eye", "Optisch", settings?.proximityAlarm?.ta?.visual ?? true, async (v) => {
              if (!settings) return;
              const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
              const ns = { ...settings, proximityAlarm: { ...pa, ta: { ...(pa.ta ?? DEFAULT_PROXIMITY_ALARM.ta), visual: v } } };
              setSettings(ns); await saveSettings(ns);
            }, "#FF9500")}
            {renderTcasToggle("volume-2", "Akustisch", settings?.proximityAlarm?.ta?.audio ?? true, async (v) => {
              if (!settings) return;
              const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
              const ns = { ...settings, proximityAlarm: { ...pa, ta: { ...(pa.ta ?? DEFAULT_PROXIMITY_ALARM.ta), audio: v } } };
              setSettings(ns); await saveSettings(ns);
            }, "#FF9500")}
            {renderTcasToggle("smartphone", "Vibration", settings?.proximityAlarm?.ta?.haptic ?? true, async (v) => {
              if (!settings) return;
              const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
              const ns = { ...settings, proximityAlarm: { ...pa, ta: { ...(pa.ta ?? DEFAULT_PROXIMITY_ALARM.ta), haptic: v } } };
              setSettings(ns); await saveSettings(ns);
            }, "#FF9500")}
          </View>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={styles.alarmSettingRow}>
            <Feather name="clock" size={16} color="#FF9500" />
            <ThemedText style={styles.menuText}>TA Zeit</ThemedText>
            <View style={styles.alarmInputRow}>
              <Pressable
                onPress={async () => {
                  if (!settings) return;
                  const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                  const ns = { ...settings, proximityAlarm: { ...pa, taTimeEnabled: !(pa.taTimeEnabled ?? true) } };
                  setSettings(ns); await saveSettings(ns);
                }}
                style={[styles.alarmChip, { backgroundColor: !(settings?.proximityAlarm?.taTimeEnabled ?? true) ? "#FF9500" : theme.backgroundSecondary }]}
              >
                <ThemedText style={[styles.alarmChipText, { color: !(settings?.proximityAlarm?.taTimeEnabled ?? true) ? "#FFFFFF" : theme.textSecondary }]}>
                  Aus
                </ThemedText>
              </Pressable>
              {[30, 40, 45, 60].map((val) => (
                <Pressable
                  key={val}
                  onPress={async () => {
                    if (!settings) return;
                    const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                    const ns = { ...settings, proximityAlarm: { ...pa, taTimeEnabled: true, taTimeSec: val } };
                    setSettings(ns); await saveSettings(ns);
                  }}
                  style={[
                    styles.alarmChip,
                    {
                      backgroundColor:
                        (settings?.proximityAlarm?.taTimeEnabled ?? true) && (settings?.proximityAlarm?.taTimeSec ?? DEFAULT_PROXIMITY_ALARM.taTimeSec) === val
                          ? "#FF9500"
                          : theme.backgroundSecondary,
                    },
                  ]}
                >
                  <ThemedText style={[styles.alarmChipText, { color: (settings?.proximityAlarm?.taTimeEnabled ?? true) && (settings?.proximityAlarm?.taTimeSec ?? DEFAULT_PROXIMITY_ALARM.taTimeSec) === val ? "#FFFFFF" : theme.textSecondary }]}>
                    {val}s
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </Card>

        <ThemedText style={[styles.tcasSubHeader, { color: "#FF3B30" }]}>
          RA - Resolution Advisory (Rot)
        </ThemedText>
        <ThemedText style={[styles.tcasDescription, { color: theme.textTertiary }]}>
          Kritische Annäherung - Ausweichanweisung
        </ThemedText>
        <Card style={[styles.menuItem, { flexDirection: "column", alignItems: "stretch" }]}>
          <View style={styles.sliderHeader}>
            <Feather name="alert-octagon" size={16} color="#FF3B30" />
            <ThemedText style={styles.menuText}>Radius</ThemedText>
            <ThemedText style={[styles.sliderValue, { color: "#FF3B30" }]}>
              {formatRadius((settings?.proximityAlarm?.ra?.radiusKm ?? DEFAULT_PROXIMITY_ALARM.ra.radiusKm) * 1000)}
            </ThemedText>
          </View>
          <View style={styles.sliderRow}>
            <ThemedText style={[styles.sliderBound, { color: theme.textTertiary }]}>50m</ThemedText>
            <Slider
              style={styles.slider}
              minimumValue={50}
              maximumValue={2000}
              step={50}
              value={(settings?.proximityAlarm?.ra?.radiusKm ?? DEFAULT_PROXIMITY_ALARM.ra.radiusKm) * 1000}
              onSlidingComplete={async (val) => {
                if (!settings) return;
                const snapped = snapToStep(val, 50);
                const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                const ns = { ...settings, proximityAlarm: { ...pa, ra: { ...(pa.ra ?? DEFAULT_PROXIMITY_ALARM.ra), radiusKm: snapped / 1000 } } };
                setSettings(ns); await saveSettings(ns);
              }}
              onValueChange={(val) => {
                if (!settings) return;
                const snapped = snapToStep(val, 50);
                const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                setSettings({ ...settings, proximityAlarm: { ...pa, ra: { ...(pa.ra ?? DEFAULT_PROXIMITY_ALARM.ra), radiusKm: snapped / 1000 } } });
              }}
              minimumTrackTintColor="#FF3B30"
              maximumTrackTintColor={theme.backgroundSecondary}
              thumbTintColor="#FF3B30"
            />
            <ThemedText style={[styles.sliderBound, { color: theme.textTertiary }]}>2km</ThemedText>
          </View>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={styles.tcasToggleRow}>
            {renderTcasToggle("eye", "Optisch", settings?.proximityAlarm?.ra?.visual ?? true, async (v) => {
              if (!settings) return;
              const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
              const ns = { ...settings, proximityAlarm: { ...pa, ra: { ...(pa.ra ?? DEFAULT_PROXIMITY_ALARM.ra), visual: v } } };
              setSettings(ns); await saveSettings(ns);
            }, "#FF3B30")}
            {renderTcasToggle("volume-2", "Akustisch", settings?.proximityAlarm?.ra?.audio ?? true, async (v) => {
              if (!settings) return;
              const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
              const ns = { ...settings, proximityAlarm: { ...pa, ra: { ...(pa.ra ?? DEFAULT_PROXIMITY_ALARM.ra), audio: v } } };
              setSettings(ns); await saveSettings(ns);
            }, "#FF3B30")}
            {renderTcasToggle("smartphone", "Vibration", settings?.proximityAlarm?.ra?.haptic ?? true, async (v) => {
              if (!settings) return;
              const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
              const ns = { ...settings, proximityAlarm: { ...pa, ra: { ...(pa.ra ?? DEFAULT_PROXIMITY_ALARM.ra), haptic: v } } };
              setSettings(ns); await saveSettings(ns);
            }, "#FF3B30")}
          </View>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={styles.alarmSettingRow}>
            <Feather name="clock" size={16} color="#FF3B30" />
            <ThemedText style={styles.menuText}>RA Zeit</ThemedText>
            <View style={styles.alarmInputRow}>
              <Pressable
                onPress={async () => {
                  if (!settings) return;
                  const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                  const ns = { ...settings, proximityAlarm: { ...pa, raTimeEnabled: !(pa.raTimeEnabled ?? true) } };
                  setSettings(ns); await saveSettings(ns);
                }}
                style={[styles.alarmChip, { backgroundColor: !(settings?.proximityAlarm?.raTimeEnabled ?? true) ? "#FF3B30" : theme.backgroundSecondary }]}
              >
                <ThemedText style={[styles.alarmChipText, { color: !(settings?.proximityAlarm?.raTimeEnabled ?? true) ? "#FFFFFF" : theme.textSecondary }]}>
                  Aus
                </ThemedText>
              </Pressable>
              {[15, 20, 25, 30].map((val) => (
                <Pressable
                  key={val}
                  onPress={async () => {
                    if (!settings) return;
                    const pa = settings.proximityAlarm ?? DEFAULT_PROXIMITY_ALARM;
                    const ns = { ...settings, proximityAlarm: { ...pa, raTimeEnabled: true, raTimeSec: val } };
                    setSettings(ns); await saveSettings(ns);
                  }}
                  style={[
                    styles.alarmChip,
                    {
                      backgroundColor:
                        (settings?.proximityAlarm?.raTimeEnabled ?? true) && (settings?.proximityAlarm?.raTimeSec ?? DEFAULT_PROXIMITY_ALARM.raTimeSec) === val
                          ? "#FF3B30"
                          : theme.backgroundSecondary,
                    },
                  ]}
                >
                  <ThemedText style={[styles.alarmChipText, { color: (settings?.proximityAlarm?.raTimeEnabled ?? true) && (settings?.proximityAlarm?.raTimeSec ?? DEFAULT_PROXIMITY_ALARM.raTimeSec) === val ? "#FFFFFF" : theme.textSecondary }]}>
                    {val}s
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </Card>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  menuText: {
    ...Typography.body,
  },
  menuSubText: {
    ...Typography.caption,
    marginLeft: Spacing.xs,
  },
  menuItemSpacing: {
    marginTop: Spacing.sm,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  switchContent: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  switchDescription: {
    ...Typography.small,
    marginTop: 2,
  },
  alarmSettingRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.sm,
  },
  alarmInputRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginLeft: "auto",
  },
  alarmChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  alarmChipText: {
    ...Typography.small,
    fontWeight: "600",
  },
  tcasSubHeader: {
    ...Typography.body,
    fontWeight: "700",
    fontSize: 14,
    marginTop: Spacing.lg,
    marginBottom: 2,
    marginLeft: Spacing.xs,
  },
  tcasDescription: {
    ...Typography.small,
    fontSize: 11,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  sliderHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sliderValue: {
    ...Typography.body,
    fontWeight: "700",
    marginLeft: "auto",
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderBound: {
    ...Typography.small,
    fontSize: 10,
    minWidth: 28,
    textAlign: "center",
  },
  tcasToggleRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    flex: 1,
  },
  tcasToggleItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  tcasToggleLabel: {
    ...Typography.small,
    fontWeight: "600",
    fontSize: 11,
  },
});
