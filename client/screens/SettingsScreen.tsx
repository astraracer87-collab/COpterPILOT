import Constants from "expo-constants";
import { setLogbookOrigin } from "@/lib/logbookOrigin";
import { DroneImage } from "@/components/DroneImage";
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  SectionList,
  Platform,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getSettings, saveSettings, Settings, DEFAULT_PROXIMITY_ALARM, getDrones, getSelectedDroneId, setSelectedDroneId, getActiveSessions, getFlightCountsForDrones, getPilotProfile, type DroneProfile, type PilotProfile } from "@/lib/storage";
import * as Haptics from "@/lib/noHaptics";
import { setActiveNotamCount } from "@/lib/notamAlertStore";
import { COUNTRY_MAPS, getCountryMapConfig, getCountryFlag } from "@/lib/countryMaps";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import { setupGuideController } from "@/lib/setupGuide";
import {
  MAP_STYLES,
  loadMapStyle,
  loadRadarSettings,
  saveMapStyle,
  saveRadarSettings,
  type MapStyleOption,
} from "@/lib/geozones";

const SORTED_COUNTRY_MAPS = [...COUNTRY_MAPS].sort((a, b) => a.nameDE.localeCompare(b.nameDE, "de"));

/** Einheitliche Zeilenhöhe aller Einträge (Titel + einzeilige Unterzeile). */
/** Einheitliche Zeilenhöhe: alle Einträge gleich hoch, Karten nebeneinander enden bündig */
const ROW_MIN_HEIGHT = 64;

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

interface SettingsRowProps {
  icon: React.ReactNode;
  title: string;
  /** optionale, einzeilige Unterzeile */
  subtitle?: string;
  /** kurzer Wert rechts neben dem Titel (z. B. gewähltes Land) */
  value?: string;
  /** eigenes Bedienelement rechts (Umschalter); ersetzt den Pfeil */
  accessory?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Eine Zeile der Einstellungen. Mit onPress ist die ganze Zeile tippbar und
 * zeigt rechts einen Pfeil „›“. Bewusst ein einfaches Pressable (keine
 * Reanimated-Animation), damit Taps auf der Fernsteuerung sicher ankommen.
 * Titel und Unterzeile sind jeweils einzeilig, damit alle Zeilen gleich hoch sind.
 */
export function SettingsRow({ icon, title, subtitle, value, accessory, onPress, testID, style }: SettingsRowProps) {
  const { theme } = useTheme();
  const content = (
    <>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle} numberOfLines={1}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText style={[styles.rowSubtitle, { color: theme.textSecondary }]} numberOfLines={1}>{subtitle}</ThemedText>
        ) : null}
      </View>
      {value ? (
        <ThemedText style={[styles.rowValue, { color: theme.primary }]} numberOfLines={1}>{value}</ThemedText>
      ) : null}
      {accessory ?? null}
      {onPress ? <Feather name="chevron-right" size={20} color={theme.textTertiary} testID={testID ? `${testID}-chevron` : undefined} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={[styles.row, { backgroundColor: theme.backgroundSecondary }, style]} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      android_ripple={{ color: theme.backgroundTertiary }}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundSecondary }, style, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

interface SettingsCardProps {
  id: string;
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  /** z. B. „+ Hinzufügen“ rechts in der Kopfzeile */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Abschnitts-Karte mit Kopfzeile; Inhalt sind SettingsRow-Einträge. */
function SettingsCard({ id, title, icon, headerAction, children, style }: SettingsCardProps) {
  const { theme } = useTheme();
  return (
    <View testID={`settings-card-${id}`} style={[styles.card, { backgroundColor: theme.backgroundDefault }, style]}>
      <View style={styles.cardHeader}>
        <Feather name={icon} size={16} color={theme.textSecondary} />
        <ThemedText style={[styles.cardTitle, { color: theme.textSecondary }]} numberOfLines={1}>
          {title}
        </ThemedText>
        {headerAction ?? null}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

/**
 * Einträge in Zweierreihen (Querformat, nur in voll breiten Karten). Jede Reihe
 * ist `alignItems: "stretch"` mit `flex: 1` je Zelle, damit Nachbarn exakt gleich
 * groß sind; bei ungerader Anzahl füllt ein Platzhalter die zweite Zelle.
 */
function PairedRows({ id, items, paired }: { id: string; items: React.ReactElement<SettingsRowProps>[]; paired: boolean }) {
  if (!paired) return <>{items}</>;
  const rows: React.ReactNode[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i + 1];
    rows.push(
      <View key={`${id}-pair-${i}`} style={styles.pairRow} testID={`settings-${id}-pair`}>
        {React.cloneElement(left, { style: styles.pairCell })}
        {right ? React.cloneElement(right, { style: styles.pairCell }) : <View style={[styles.row, styles.pairCell]} />}
      </View>,
    );
  }
  return <>{rows}</>;
}

type GridRow =
  | { kind: "pair"; key: string; left: React.ReactElement; right: React.ReactElement }
  | { kind: "full"; key: string; card: React.ReactElement };

type SettingsRoute = RouteProp<SettingsStackParamList, "Settings">;

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<SettingsRoute>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [selectedDroneId, setSelectedDroneIdState] = useState<string | null>(null);
  const [pilot, setPilot] = useState<PilotProfile | null>(null);
  const [flightCounts, setFlightCounts] = useState<Record<string, number>>({});
  const [activeDroneIds, setActiveDroneIds] = useState<Set<string>>(new Set());
  const [mapStyle, setMapStyle] = useState<MapStyleOption>("grayscale");
  const [showEnergyInfrastructure, setShowEnergyInfrastructure] = useState(true);

  const loadSettings = useCallback(async () => {
    const [data, droneList, selected, activeSessions, pilotProfile, radar, savedMapStyle] = await Promise.all([
      getSettings(),
      getDrones(),
      getSelectedDroneId(),
      getActiveSessions(),
      getPilotProfile(),
      loadRadarSettings(),
      loadMapStyle(),
    ]);
    setSettings(data);
    setDrones(droneList);
    setSelectedDroneIdState(selected);
    setPilot(pilotProfile);
    setActiveDroneIds(new Set(activeSessions.map((s) => s.droneId)));
    setShowEnergyInfrastructure(radar.showEnergyInfrastructure);
    setMapStyle(savedMapStyle);
    const counts = await getFlightCountsForDrones(droneList.map((d) => d.id));
    setFlightCounts(counts);
  }, []);

  const handleSelectDrone = useCallback(async (id: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setSelectedDroneIdState(id);
    await setSelectedDroneId(id);
  }, []);

  const handleSelectCountry = useCallback(async (iso: string) => {
    if (!settings) return;
    const newSettings: Settings = { ...settings, preferredCountryIso: iso };
    setSettings(newSettings);
    setCountryPickerOpen(false);
    await saveSettings(newSettings);
    // Stale NOTAM-Badge sofort zurücksetzen — wird beim nächsten Öffnen
    // der NOTAM-Seite mit dem korrekten Wert für das neue Land neu befüllt.
    setActiveNotamCount(0);
  }, [settings]);

  const handleToggleAttachDocs = useCallback(async () => {
    if (!settings) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    const next: Settings = {
      ...settings,
      attachPilotDocsToExports: !(settings.attachPilotDocsToExports ?? true),
    };
    setSettings(next);
    await saveSettings(next);
  }, [settings]);

  const handleToggleFavoriteCountry = useCallback(async (iso: string) => {
    if (!settings) return;
    const code = iso.toUpperCase();
    const prev = (settings.favoriteCountries || []).map((c) => c.toUpperCase());
    const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
    const newSettings: Settings = { ...settings, favoriteCountries: next };
    setSettings(newSettings);
    await saveSettings(newSettings);
  }, [settings]);

  // Favoriten zuerst (in Reihenfolge der Auswahl), Rest alphabetisch.
  const orderedCountryMaps = useMemo(() => {
    const favs = (settings?.favoriteCountries || []).map((c) => c.toUpperCase());
    if (favs.length === 0) {
      return [{ title: "Alle Länder", data: SORTED_COUNTRY_MAPS }];
    }
    const favSet = new Set(favs);
    const favoriteItems = favs
      .map((iso) => SORTED_COUNTRY_MAPS.find((m) => m.iso === iso))
      .filter((m): m is typeof SORTED_COUNTRY_MAPS[number] => !!m);
    const rest = SORTED_COUNTRY_MAPS.filter((m) => !favSet.has(m.iso));
    return [
      { title: "Favoriten", data: favoriteItems },
      { title: "Alle Länder", data: rest },
    ];
  }, [settings?.favoriteCountries]);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings])
  );

  // Wenn von außerhalb (z.B. Radar-Karte) navigiert wird, Picker auto-öffnen
  // und den Param sofort wieder leeren, damit er nicht beim nächsten Focus
  // erneut feuert.
  useFocusEffect(
    useCallback(() => {
      if (route.params?.openCountryPicker) {
        setCountryPickerOpen(true);
        navigation.setParams({ openCountryPicker: undefined } as any);
      }
    }, [route.params?.openCountryPicker, navigation])
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

  const handleToggleEnergyInfrastructure = useCallback(async () => {
    const next = !showEnergyInfrastructure;
    setShowEnergyInfrastructure(next);
    await saveRadarSettings({ showEnergyInfrastructure: next });
  }, [showEnergyInfrastructure]);

  const handleSelectMapStyle = useCallback(async (next: MapStyleOption) => {
    setMapStyle(next);
    await saveMapStyle(next);
  }, []);

  const landscape = width > height;
  const icon = (name: React.ComponentProps<typeof Feather>["name"]) => <Feather name={name} size={20} color={theme.primary} />;
  const valuePill = (text: string, onPress: () => void, testID?: string, role: "button" | "switch" = "button", checked?: boolean) => (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityState={role === "switch" ? { checked: !!checked } : undefined}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.unitToggle, { backgroundColor: theme.backgroundDefault }, pressed && styles.pressed]}
    >
      <ThemedText style={[styles.unitText, { color: theme.primary }]}>{text}</ThemedText>
    </Pressable>
  );

  // ── Profil & Pilot ──────────────────────────────────────────────────────
  const profileCard = (
    <SettingsCard id="profile" title="PROFIL & PILOT" icon="user">
      <SettingsRow
        testID="settings-row-pilot-profile"
        icon={icon("user")}
        title="Pilotenprofil"
        subtitle={pilot?.name?.trim() || "Name, Registrierung, Nachweise"}
        onPress={() => navigation.navigate("PilotProfile")}
      />
      <SettingsRow
        testID="settings-row-license"
        icon={icon("credit-card")}
        title="Führerschein anzeigen"
        subtitle="A1/A3- bzw. A2-Nachweis"
        onPress={() => navigation.navigate("PilotLicenseCard")}
      />
      <SettingsRow
        testID="settings-row-expiry"
        icon={icon("clock")}
        title="Ablaufende Dokumente"
        subtitle="Fristen im Blick behalten"
        onPress={() => navigation.navigate("ExpiryOverview")}
      />
      <SettingsRow
        testID="settings-row-setup-guide"
        icon={icon("compass")}
        title="Einrichtungs-Assistent"
        subtitle="Drohnen, Pilotendaten, Lizenzen"
        onPress={() => setupGuideController.launch()}
      />
    </SettingsCard>
  );

  // ── Karten, Länder & Offline ────────────────────────────────────────────
  const mapsCard = (
    <SettingsCard id="maps" title="KARTEN, LÄNDER & OFFLINE" icon="map">
      <SettingsRow
        testID="settings-row-country"
        icon={icon("globe")}
        title="Land"
        value={getCountryMapConfig(settings?.preferredCountryIso || "DE")?.nameDE || "Deutschland"}
        subtitle="Karten, NOTAMs & Geozonen"
        onPress={() => setCountryPickerOpen(true)}
      />
      <View style={[styles.row, styles.mapStyleRow, { backgroundColor: theme.backgroundSecondary }]} testID="settings-row-map-style">
        <View style={styles.rowIcon}>{icon("layers")}</View>
        <View style={styles.rowText}>
          <ThemedText style={styles.rowTitle} numberOfLines={1}>Basiskarte</ThemedText>
          <View style={styles.chipRow}>
            {MAP_STYLES.map((option) => {
              const selected = mapStyle === option.id;
              return (
                <Pressable
                  key={option.id}
                  testID={`map-style-${option.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => handleSelectMapStyle(option.id)}
                  style={[styles.chip, { backgroundColor: selected ? theme.primary : theme.backgroundDefault }]}
                >
                  <ThemedText style={[styles.chipText, { color: selected ? "#FFFFFF" : theme.text }]}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      <SettingsRow
        testID="menu-offline-maps"
        icon={icon("download-cloud")}
        title="Karten, Hindernisse & Offline"
        subtitle="Offline-Pakete, d-flight, DJI-Schlüssel & -Logs"
        onPress={() => navigation.navigate("RcOfflineMaps")}
      />
    </SettingsCard>
  );

  // ── Drohnen (voll breit, Einträge paarweise) ────────────────────────────
  const droneItems: React.ReactElement<SettingsRowProps>[] = [
    <SettingsRow
      key="manage"
      testID="settings-row-drones"
      icon={<MaterialCommunityIcons name="quadcopter" size={22} color={theme.primary} />}
      title="Drohnen verwalten"
      value={drones.length > 0 ? String(drones.length) : undefined}
      subtitle="Dokumente, Historie, Archiv"
      onPress={() => navigation.navigate("Drones")}
    />,
    // Ladegerät lebt im Akkus-Tab; hier nur der Weg zu seinen Einstellungen
    <SettingsRow
      key="charger"
      testID="settings-row-charger"
      icon={icon("battery-charging")}
      title="Ladegerät-Einstellungen"
      subtitle="ISDT MA331 · Hintergrund-Loggen, Kopplung"
      onPress={() =>
        (navigation as unknown as { navigate(r: string, p: unknown): void }).navigate("ChargerTab", { screen: "ChargerSettings", initial: false })
      }
    />,
  ];
  if (drones.length === 0) {
    droneItems.push(
      <SettingsRow
        key="first"
        testID="settings-row-first-drone"
        icon={icon("plus-circle")}
        title="Erste Drohne hinzufügen"
        subtitle="Modell wählen und einrichten"
        onPress={() => navigation.navigate("DroneSetup", {})}
      />,
    );
  } else {
    for (const drone of drones) {
      const isSelected = drone.id === selectedDroneId;
      const count = flightCounts[drone.id] || 0;
      droneItems.push(
        <SettingsRow
          key={drone.id}
          testID={`settings-row-drone-${drone.id}`}
          icon={
            <Pressable
              onPress={() => handleSelectDrone(drone.id)}
              hitSlop={10}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${drone.name} als aktive Drohne wählen`}
              testID={`settings-drone-select-${drone.id}`}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
                <Feather name={isSelected ? "check-circle" : "circle"} size={22} color={isSelected ? theme.primary : theme.textTertiary} />
                <DroneImage manufacturer={drone.manufacturer} model={drone.model} size={44} iconColor={theme.textSecondary} iconSize={22} />
              </View>
            </Pressable>
          }
          title={drone.name}
          value={activeDroneIds.has(drone.id) ? "Aktiv" : undefined}
          subtitle={`${drone.classMark} · ${drone.mtomGrams} g · ${count} ${count === 1 ? "Flug" : "Flüge"}${isSelected ? " · ausgewählt" : ""}`}
          onPress={() => navigation.navigate("DroneSetup", { droneId: drone.id })}
        />,
      );
    }
  }
  const dronesCard = (
    <SettingsCard
      id="drones"
      title="DROHNEN"
      icon="send"
      headerAction={
        <Pressable
          onPress={() => navigation.navigate("DroneSetup", {})}
          style={({ pressed }) => [styles.headerButton, { backgroundColor: theme.primary }, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Drohne hinzufügen"
          testID="button-add-drone"
        >
          <Feather name="plus" size={16} color="#FFFFFF" />
          <ThemedText style={styles.headerButtonText}>Hinzufügen</ThemedText>
        </Pressable>
      }
    >
      <PairedRows id="drones" items={droneItems} paired={landscape} />
    </SettingsCard>
  );

  // ── Radar & Warnungen ───────────────────────────────────────────────────
  const radarCard = (
    <SettingsCard id="radar" title="RADAR & WARNUNGEN" icon="radio">
      <SettingsRow
        testID="settings-row-tcas"
        icon={icon("alert-triangle")}
        title="TCAS - Proximity-Alarm"
        subtitle={`${(settings?.proximityAlarm?.enabled ?? DEFAULT_PROXIMITY_ALARM.enabled) ? "Aktiviert" : "Deaktiviert"} · TA/RA, Radius, Töne`}
        onPress={() => navigation.navigate("TcasSettings")}
      />
      <SettingsRow
        testID="settings-row-energy-infrastructure"
        icon={icon("zap")}
        title="Ergänzende Anlagen"
        subtitle="Energieanlagen auf der Radar-Karte"
        accessory={valuePill(showEnergyInfrastructure ? "An" : "Aus", handleToggleEnergyInfrastructure, "toggle-energy-infrastructure", "switch", showEnergyInfrastructure)}
      />
      <SettingsRow
        testID="menu-rc-key-test"
        icon={icon("sliders")}
        title="Tasten der Fernsteuerung"
        subtitle="Belegung testen"
        onPress={() => navigation.navigate("RcKeyTest")}
      />
    </SettingsCard>
  );

  // ── Flugplanung & Wetter ────────────────────────────────────────────────
  const planningCard = (
    <SettingsCard id="planning" title="FLUGPLANUNG & WETTER" icon="cloud">
      <SettingsRow
        testID="settings-row-weather"
        icon={icon("cloud")}
        title="Aktuelles Wetter"
        subtitle="Wind, Böen, Sicht am Standort"
        onPress={() => navigation.navigate("DipulWeather")}
      />
      <SettingsRow
        testID="settings-row-wind-unit"
        icon={icon("wind")}
        title="Windgeschwindigkeit"
        subtitle="Einheit"
        accessory={valuePill(settings?.windUnit || "m/s", () => toggleUnit("windUnit"), "toggle-wind-unit")}
      />
      <SettingsRow
        testID="settings-row-temp-unit"
        icon={icon("thermometer")}
        title="Temperatur"
        subtitle="Einheit"
        accessory={valuePill(settings?.tempUnit === "F" ? "°F" : "°C", () => toggleUnit("tempUnit"), "toggle-temp-unit")}
      />
    </SettingsCard>
  );

  // ── Regeln & Wissen (voll breit, Einträge paarweise) ────────────────────
  const knowledgeItems: React.ReactElement<SettingsRowProps>[] = [
    <SettingsRow key="countries" testID="settings-row-countries" icon={icon("globe")} title="Länder — Rules & Regulations" subtitle="Regeln je Land" onPress={() => navigation.navigate("CountryInfo")} />,
    <SettingsRow key="easa-ref" testID="settings-row-easa-reference" icon={icon("book-open")} title="EASA — EU-Drohnenregeln" subtitle="Kategorien, Klassen, Pflichten" onPress={() => navigation.navigate("EasaReference")} />,
    <SettingsRow key="easa-rules" testID="settings-row-easa-rules" icon={icon("file-text")} title="Easy Access Rules (UAS)" subtitle="Volltext der EASA" onPress={() => navigation.navigate("EasaRules")} />,
    <SettingsRow key="vlos" testID="menu-vlos-info" icon={icon("eye")} title="VLOS — Sichtweite erklärt" subtitle="Sichtflug richtig einschätzen" onPress={() => navigation.navigate("VlosInfo")} />,
    <SettingsRow key="glossary" testID="settings-row-glossary" icon={icon("book")} title="Glossar" subtitle="Begriffe und Abkürzungen" onPress={() => navigation.navigate("Glossary")} />,
    <SettingsRow key="links" testID="settings-row-links" icon={icon("bookmark")} title="Nützliche Links" subtitle="Behörden, Karten, Portale" onPress={() => navigation.navigate("ResourceLinks")} />,
  ];
  const knowledgeCard = (
    <SettingsCard id="knowledge" title="REGELN & WISSEN" icon="book-open">
      <PairedRows id="knowledge" items={knowledgeItems} paired={landscape} />
    </SettingsCard>
  );

  // ── Daten & Speicher ────────────────────────────────────────────────────
  const dataCard = (
    <SettingsCard id="data" title="DATEN & SPEICHER" icon="database">
      <SettingsRow
        testID="settings-row-logbook"
        icon={icon("book")}
        title="Logbuch"
        subtitle="Flüge, Wartung, DJI-Flugprotokolle"
        onPress={() => {
          setLogbookOrigin("SettingsTab");
          (navigation as unknown as { navigate(r: string, p?: unknown): void }).navigate("HistoryTab", { screen: "History" });
        }}
      />
      <SettingsRow
        testID="settings-row-my-data"
        icon={icon("database")}
        title="Meine Daten"
        subtitle="Alles bleibt auf diesem Gerät"
        onPress={() => navigation.navigate("MyData")}
      />
      <SettingsRow
        testID="settings-row-attach-docs"
        icon={icon("paperclip")}
        title="Dokumente an Exporte"
        subtitle="AV, A2, Versicherung ans PDF"
        accessory={valuePill((settings?.attachPilotDocsToExports ?? true) ? "An" : "Aus", handleToggleAttachDocs, "toggle-attach-docs", "switch", settings?.attachPilotDocsToExports ?? true)}
      />
      <SettingsRow
        testID="menu-data-sources"
        icon={icon("layers")}
        title="Datenquellen & Lizenzen"
        subtitle="Herkunft der Karten- und Zonendaten"
        onPress={() => navigation.navigate("DataSources")}
      />
    </SettingsCard>
  );

  // ── Hilfe & Info ────────────────────────────────────────────────────────
  const infoCard = (
    <SettingsCard id="info" title="HILFE & INFO" icon="info">
      <SettingsRow
        testID="settings-row-version"
        icon={icon("info")}
        title="Version"
        accessory={<ThemedText style={{ color: theme.textTertiary }} numberOfLines={1}>RC-Version {Constants.expoConfig?.version ?? ""}</ThemedText>}
      />
      <SettingsRow testID="settings-row-privacy" icon={icon("shield")} title="Datenschutzerklärung" onPress={() => navigation.navigate("PrivacyPolicy")} />
      <SettingsRow testID="settings-row-terms" icon={icon("file-text")} title="AGB / Nutzungsbedingungen" onPress={() => navigation.navigate("LegalDocument", { doc: "terms" })} />
      <SettingsRow testID="settings-row-imprint" icon={icon("briefcase")} title="Impressum" onPress={() => navigation.navigate("LegalDocument", { doc: "imprint" })} />
    </SettingsCard>
  );

  // Reihenfolge der Reihen. Paare sind auf ähnliche Höhe abgestimmt
  // (4:3, 3:3, 3:4 Einträge); lange Abschnitte laufen über die volle Breite.
  const gridRows: GridRow[] = [
    { kind: "pair", key: "profile-maps", left: profileCard, right: mapsCard },
    { kind: "full", key: "drones", card: dronesCard },
    { kind: "pair", key: "radar-planning", left: radarCard, right: planningCard },
    { kind: "full", key: "knowledge", card: knowledgeCard },
    { kind: "pair", key: "data-info", left: dataCard, right: infoCard },
  ];

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        testID="settings-scroll"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + (landscape ? Spacing.md : Spacing.xl),
            paddingBottom: tabBarHeight + insets.bottom + Spacing.xl,
          },
        ]}
      >
        <View style={styles.grid} testID={landscape ? "settings-grid" : "settings-list"}>
          {gridRows.map((row) => {
            if (!landscape) {
              return row.kind === "pair" ? (
                <React.Fragment key={row.key}>
                  {row.left}
                  {row.right}
                </React.Fragment>
              ) : (
                <React.Fragment key={row.key}>{row.card}</React.Fragment>
              );
            }
            if (row.kind === "full") {
              return (
                <View key={row.key} testID={`settings-grid-row-${row.key}`} style={styles.gridRow}>
                  {React.cloneElement(row.card as React.ReactElement<SettingsCardProps>, { style: styles.gridCell })}
                </View>
              );
            }
            return (
              <View key={row.key} testID={`settings-grid-row-${row.key}`} style={styles.gridRow}>
                {React.cloneElement(row.left as React.ReactElement<SettingsCardProps>, { style: styles.gridCell })}
                {React.cloneElement(row.right as React.ReactElement<SettingsCardProps>, { style: styles.gridCell })}
              </View>
            );
          })}
        </View>
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
          <SectionList
            sections={orderedCountryMaps}
            keyExtractor={(it) => it.iso}
            contentContainerStyle={{ padding: Spacing.lg, paddingBottom: Spacing["2xl"] }}
            ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <ThemedText
                style={{
                  ...Typography.caption,
                  fontWeight: "700",
                  color: theme.textSecondary,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginTop: Spacing.md,
                  marginBottom: Spacing.sm,
                  marginLeft: Spacing.xs,
                }}
              >
                {section.title}
              </ThemedText>
            )}
            renderItem={({ item }) => {
              const selected = (settings?.preferredCountryIso || "DE").toUpperCase() === item.iso;
              const favorite = (settings?.favoriteCountries || []).map((c) => c.toUpperCase()).includes(item.iso);
              return (
                <Card
                  style={[
                    styles.countryRow,
                    selected ? { borderColor: theme.primary, borderWidth: 2 } : null,
                  ]}
                  onPress={() => handleSelectCountry(item.iso)}
                >
                  <ThemedText style={{ fontSize: 26, marginRight: Spacing.md }}>
                    {getCountryFlag(item.iso)}
                  </ThemedText>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ ...Typography.body, fontWeight: "600" }}>
                      {item.nameDE}
                    </ThemedText>
                    <ThemedText style={{ ...Typography.small, color: theme.textTertiary }}>
                      {item.iso}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={(e) => { e.stopPropagation?.(); handleToggleFavoriteCountry(item.iso); }}
                    hitSlop={10}
                    style={{ paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs }}
                    testID={`country-fav-${item.iso}`}
                  >
                    <Feather
                      name="star"
                      size={20}
                      color={favorite ? "#F5A623" : theme.textTertiary}
                      style={{ opacity: favorite ? 1 : 0.55 }}
                    />
                  </Pressable>
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
  grid: {
    gap: Spacing.md,
  },
  gridRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: Spacing.md,
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 32,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  cardTitle: {
    ...Typography.caption,
    fontWeight: "700",
    letterSpacing: 0.5,
    flex: 1,
  },
  cardBody: {
    gap: Spacing.xs,
  },
  pairRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: Spacing.xs,
  },
  pairCell: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    height: ROW_MIN_HEIGHT,
    borderRadius: BorderRadius.md,
  },
  // Mindestbreite statt fester Breite: breitere Inhalte (Auswahlkreis + Drohnenbild)
  // schieben den Text nach rechts, statt ihn zu überdecken
  rowIcon: {
    minWidth: 24,
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...Typography.body,
    fontWeight: "500",
  },
  rowSubtitle: {
    ...Typography.small,
    marginTop: 1,
  },
  rowValue: {
    fontWeight: "600",
    maxWidth: 140,
  },
  // Basiskarte belegt genau zwei Zeilenhöhen (Titel + Auswahl)
  mapStyleRow: {
    alignItems: "center",
    height: ROW_MIN_HEIGHT * 2 + Spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  chipText: {
    ...Typography.small,
    fontWeight: "600",
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  headerButtonText: {
    ...Typography.small,
    color: "#FFFFFF",
    fontWeight: "700",
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
});
