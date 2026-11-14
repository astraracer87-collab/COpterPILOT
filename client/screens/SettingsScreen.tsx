import React, { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Switch, TextInput, Modal, FlatList } from "react-native";
import Slider from "@react-native-community/slider";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors, BorderRadius } from "@/constants/theme";
import { getSettings, saveSettings, Settings, DEFAULT_PROXIMITY_ALARM, type TcasLevelSettings } from "@/lib/storage";
import { COUNTRY_MAPS, getCountryMapConfig } from "@/lib/countryMaps";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

const SORTED_COUNTRY_MAPS = [...COUNTRY_MAPS].sort((a, b) => a.nameDE.localeCompare(b.nameDE, "de"));

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

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

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  const loadSettings = useCallback(async () => {
    const data = await getSettings();
    setSettings(data);
  }, []);

  const handleSelectCountry = useCallback(async (iso: string) => {
    if (!settings) return;
    const newSettings: Settings = { ...settings, preferredCountryIso: iso };
    setSettings(newSettings);
    setCountryPickerOpen(false);
    await saveSettings(newSettings);
  }, [settings]);

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

  const toggleUnit = async (key: "windUnit" | "tempUnit") => {
    if (!settings) return;
    const newSettings = { ...settings };
    if (key === "windUnit") {
      newSettings.windUnit = settings.windUnit === "m/s" ? "km/h" : "m/s";
    } else if (key === "tempUnit") {
      newSettings.tempUnit = settings.tempUnit === "C" ? "F" : "C";
    }
    setSettings(newSettings);
    await saveSettings(newSettings);
  };

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
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          FLUGREGION
        </ThemedText>
        <Card
          style={styles.menuItem}
          onPress={() => setCountryPickerOpen(true)}
        >
          <View style={styles.menuRow}>
            <Feather name="globe" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>Land</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Bestimmt Karten-Zentrierung, NOTAMs & Geozonen-Filter
              </ThemedText>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ThemedText style={{ color: theme.primary, fontWeight: "600" }}>
              {getCountryMapConfig(settings?.preferredCountryIso || "DE")?.nameDE || "Deutschland"}
            </ThemedText>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </View>
        </Card>

        <Card style={[styles.menuItem, styles.menuItemSpacing]} onPress={() => navigation.navigate("OfflineMaps")}>
          <View style={styles.menuRow}>
            <Feather name="download-cloud" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>Karten & Offline</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Hindernisse, Länder für Karten, Satellit & Geozonen ohne Internet
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          PILOT
        </ThemedText>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("PilotProfile")}>
          <View style={styles.menuRow}>
            <Feather name="user" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Pilotenprofil</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          DROHNEN
        </ThemedText>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("Drones")}>
          <View style={styles.menuRow}>
            <MaterialCommunityIcons name="quadcopter" size={22} color={theme.primary} />
            <ThemedText style={styles.menuText}>Meine Drohnen</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          WETTERGRENZEN
        </ThemedText>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("WeatherLimits")}>
          <View style={styles.menuRow}>
            <Feather name="sliders" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Globale Grenzwerte</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          TCAS - PROXIMITY-ALARM
        </ThemedText>
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

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          EINHEITEN
        </ThemedText>
        <Card style={styles.menuItem}>
          <View style={styles.menuRow}>
            <Feather name="wind" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Windgeschwindigkeit</ThemedText>
          </View>
          <Pressable
            onPress={() => toggleUnit("windUnit")}
            style={[styles.unitToggle, { backgroundColor: theme.backgroundSecondary }]}
          >
            <ThemedText style={[styles.unitText, { color: theme.primary }]}>
              {settings?.windUnit || "m/s"}
            </ThemedText>
          </Pressable>
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={styles.menuRow}>
            <Feather name="thermometer" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Temperatur</ThemedText>
          </View>
          <Pressable
            onPress={() => toggleUnit("tempUnit")}
            style={[styles.unitToggle, { backgroundColor: theme.backgroundSecondary }]}
          >
            <ThemedText style={[styles.unitText, { color: theme.primary }]}>
              {settings?.tempUnit === "F" ? "°F" : "°C"}
            </ThemedText>
          </Pressable>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          RESSOURCEN
        </ThemedText>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("ResourceLinks")}>
          <View style={styles.menuRow}>
            <Feather name="bookmark" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Nützliche Links</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("Glossary")}>
          <View style={styles.menuRow}>
            <Feather name="book" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Glossar</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          ÜBER
        </ThemedText>
        <Card style={styles.menuItem}>
          <View style={styles.menuRow}>
            <Feather name="info" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Version</ThemedText>
          </View>
          <ThemedText style={{ color: theme.textTertiary }}>1.0.0</ThemedText>
        </Card>
        <Pressable
          onPress={() => navigation.navigate("DipulWeather")}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card style={[styles.menuItem, styles.menuItemSpacing]}>
            <View style={styles.menuRow}>
              <Feather name="cloud" size={20} color={theme.primary} />
              <ThemedText style={styles.menuText}>Aktuelles Wetter</ThemedText>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </Card>
        </Pressable>
      </ScrollView>

      <Modal
        visible={countryPickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <ThemedView style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>Land wählen</ThemedText>
            <Pressable
              onPress={() => setCountryPickerOpen(false)}
              hitSlop={12}
              testID="country-picker-close"
            >
              <Feather name="x" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ThemedText style={[styles.modalHint, { color: theme.textSecondary }]}>
            Karten, NOTAMs und Geozonen werden auf dieses Land beschränkt.
            Du kannst es jederzeit hier wechseln.
          </ThemedText>
          <FlatList
            data={SORTED_COUNTRY_MAPS}
            keyExtractor={(it) => it.iso}
            contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing["2xl"] }}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            renderItem={({ item }) => {
              const selected = (settings?.preferredCountryIso || "DE").toUpperCase() === item.iso;
              return (
                <Card
                  style={[
                    styles.countryRow,
                    selected ? { borderColor: theme.primary, borderWidth: 2 } : null,
                  ]}
                  onPress={() => handleSelectCountry(item.iso)}
                >
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ ...Typography.body, fontWeight: "600" }}>
                      {item.nameDE}
                    </ThemedText>
                    <ThemedText style={{ ...Typography.small, color: theme.textTertiary }}>
                      {item.iso}
                    </ThemedText>
                  </View>
                  {selected ? (
                    <Feather name="check-circle" size={22} color={theme.primary} />
                  ) : (
                    <Feather name="circle" size={22} color={theme.textTertiary} />
                  )}
                </Card>
              );
            }}
          />
        </ThemedView>
      </Modal>
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
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
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
  pressed: {
    opacity: 0.7,
  },
  unitToggle: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: 8,
  },
  unitText: {
    ...Typography.body,
    fontWeight: "600",
  },
  sourceText: {
    ...Typography.small,
  },
  switchContent: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  switchDescription: {
    ...Typography.small,
    marginTop: 2,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  modalTitle: {
    ...Typography.h2,
    fontSize: 22,
    fontWeight: "700",
  },
  modalHint: {
    ...Typography.small,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
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
  alarmScrollRow: {
    flexGrow: 0,
    flexShrink: 1,
    marginLeft: "auto" as any,
  },
  alarmScrollContent: {
    gap: Spacing.xs,
    alignItems: "center" as const,
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
