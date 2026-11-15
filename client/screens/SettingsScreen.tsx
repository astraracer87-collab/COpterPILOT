import Constants from "expo-constants";
import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Modal, SectionList, Platform, useWindowDimensions } from "react-native";
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
import { Spacing, Typography, Colors, BorderRadius } from "@/constants/theme";
import { getSettings, saveSettings, Settings, DEFAULT_PROXIMITY_ALARM, getDrones, getSelectedDroneId, setSelectedDroneId, getActiveSessions, getFlightCountsForDrones, getPilotProfile, type DroneProfile, type PilotProfile } from "@/lib/storage";
import * as Haptics from "expo-haptics";
import { setActiveNotamCount } from "@/lib/notamAlertStore";
import { COUNTRY_MAPS, getCountryMapConfig, getCountryFlag } from "@/lib/countryMaps";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import { useAuth } from "@/lib/auth";
import { setupGuideController } from "@/lib/setupGuide";
import { WildlifeRescueInfoModal } from "@/components/WildlifeRescueInfo";
import {
  MAP_STYLES,
  loadMapStyle,
  loadRadarSettings,
  saveMapStyle,
  saveRadarSettings,
  type MapStyleOption,
} from "@/lib/geozones";
import {
  WILDLIFE_RESCUE_MODE_TITLE,
  WILDLIFE_RESCUE_MODE_SUBTITLE,
  WILDLIFE_RESCUE_CONFIRM_QUESTION,
  WILDLIFE_RESCUE_THANK_YOU,
} from "../../shared/wildlifeRescue";

const SORTED_COUNTRY_MAPS = [...COUNTRY_MAPS].sort((a, b) => a.nameDE.localeCompare(b.nameDE, "de"));

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

interface SettingsRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  /** kurzer Wert rechts neben dem Titel (z. B. gewähltes Land) */
  value?: string;
  /** eigenes Bedienelement rechts (Umschalter); ersetzt den Pfeil */
  accessory?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}

/**
 * Eine Zeile der Einstellungen. Mit onPress ist die ganze Zeile tippbar und
 * zeigt rechts einen Pfeil „›“. Bewusst ein einfaches Pressable (keine
 * Reanimated-Animation), damit Taps auf der Fernsteuerung sicher ankommen.
 */
export function SettingsRow({ icon, title, subtitle, value, accessory, onPress, testID }: SettingsRowProps) {
  const { theme } = useTheme();
  const content = (
    <>
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowText}>
        <ThemedText style={styles.menuText} numberOfLines={2}>{title}</ThemedText>
        {subtitle ? (
          <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>{subtitle}</ThemedText>
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
      <View style={[styles.row, { backgroundColor: theme.backgroundDefault }]} testID={testID}>
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
      style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundDefault }, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}
type SettingsRoute = RouteProp<SettingsStackParamList, "Settings">;

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<SettingsRoute>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { user, isAuthenticated, status: authStatus } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [selectedDroneId, setSelectedDroneIdState] = useState<string | null>(null);
  const [pilot, setPilot] = useState<PilotProfile | null>(null);
  const [flightCounts, setFlightCounts] = useState<Record<string, number>>({});
  const [activeDroneIds, setActiveDroneIds] = useState<Set<string>>(new Set());
  const [wildlifeDialogStage, setWildlifeDialogStage] = useState<"closed" | "confirm" | "thanks">("closed");
  const [wildlifeInfoOpen, setWildlifeInfoOpen] = useState(false);
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

  const handleToggleWildlifeRescue = useCallback(async () => {
    if (!settings) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    const currentlyOn = settings.wildlifeRescueMode ?? false;
    if (currentlyOn) {
      const next: Settings = { ...settings, wildlifeRescueMode: false };
      setSettings(next);
      await saveSettings(next);
      return;
    }
    setWildlifeDialogStage("confirm");
  }, [settings]);

  const handleConfirmWildlifeRescue = useCallback(async () => {
    if (!settings) return;
    const next: Settings = { ...settings, wildlifeRescueMode: true };
    setSettings(next);
    await saveSettings(next);
    setWildlifeDialogStage("thanks");
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
  const chevron = <Feather name="chevron-right" size={20} color={theme.textTertiary} />;
  const valuePill = (text: string, onPress: () => void, testID?: string, role: "button" | "switch" = "button", checked?: boolean) => (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityState={role === "switch" ? { checked: !!checked } : undefined}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.unitToggle, { backgroundColor: theme.backgroundSecondary }, pressed && styles.pressed]}
    >
      <ThemedText style={[styles.unitText, { color: theme.primary }]}>{text}</ThemedText>
    </Pressable>
  );
  const sectionTitle = (title: string, first = false) => (
    <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary }, first ? null : styles.sectionTitleSpacing]}>
      {title}
    </ThemedText>
  );

  const leftColumn = (
    <>
      {sectionTitle("DATEN", true)}
      <SettingsRow
        testID="settings-row-my-data"
        icon={<Feather name="database" size={20} color={theme.primary} />}
        title="Meine Daten"
        subtitle="Alles bleibt auf diesem Gerät (RC-Version ohne Konto)"
        onPress={() => navigation.navigate("MyData")}
      />

      {sectionTitle("FLUGREGION")}
      <SettingsRow
        testID="settings-row-country"
        icon={<Feather name="globe" size={20} color={theme.primary} />}
        title="Land"
        value={getCountryMapConfig(settings?.preferredCountryIso || "DE")?.nameDE || "Deutschland"}
        subtitle="Bestimmt Karten-Zentrierung, NOTAMs & Geozonen-Filter"
        onPress={() => setCountryPickerOpen(true)}
      />

      {sectionTitle("PILOT")}
      <SettingsRow
        testID="settings-row-pilot-profile"
        icon={<Feather name="user" size={20} color={theme.primary} />}
        title="Pilotenprofil"
        subtitle={pilot?.name?.trim() || undefined}
        onPress={() => navigation.navigate("PilotProfile")}
      />
      <SettingsRow
        testID="settings-row-license"
        icon={<Feather name="credit-card" size={20} color={theme.primary} />}
        title="Führerschein anzeigen"
        onPress={() => navigation.navigate("PilotLicenseCard")}
      />
      <SettingsRow
        testID="settings-row-expiry"
        icon={<Feather name="clock" size={20} color={theme.primary} />}
        title="Ablaufende Dokumente"
        onPress={() => navigation.navigate("ExpiryOverview")}
      />
      <SettingsRow
        testID="settings-row-setup-guide"
        icon={<Feather name="compass" size={20} color={theme.primary} />}
        title="Einrichtungs-Assistent"
        subtitle="Drohnen, Pilotendaten und Lizenzen Schritt für Schritt einrichten"
        onPress={() => setupGuideController.launch()}
      />

      <View style={[styles.dronesSectionHeader, styles.sectionTitleSpacing]}>
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginBottom: 0 }]}>
          DROHNEN
        </ThemedText>
        <Pressable
          onPress={() => navigation.navigate("DroneSetup", {})}
          style={({ pressed }) => pressed && styles.pressed}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Drohne hinzufügen"
          testID="button-add-drone"
        >
          <View style={[styles.droneAddButton, { backgroundColor: theme.primary }]}>
            <Feather name="plus" size={18} color="#FFFFFF" />
          </View>
        </Pressable>
      </View>
      <SettingsRow
        testID="settings-row-drones"
        icon={<MaterialCommunityIcons name="quadcopter" size={22} color={theme.primary} />}
        title="Drohnen"
        value={drones.length > 0 ? String(drones.length) : undefined}
        subtitle="Alle Drohnen verwalten, Dokumente, Historie, Archiv"
        onPress={() => navigation.navigate("Drones")}
      />
      {drones.length === 0 ? (
        <SettingsRow
          testID="settings-row-first-drone"
          icon={<Feather name="plus-circle" size={20} color={theme.primary} />}
          title="Erste Drohne hinzufügen"
          onPress={() => navigation.navigate("DroneSetup", {})}
        />
      ) : (
        drones.map((drone) => {
          const isSelected = drone.id === selectedDroneId;
          const count = flightCounts[drone.id] || 0;
          return (
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
                  <Feather name={isSelected ? "check-circle" : "circle"} size={22} color={isSelected ? theme.primary : theme.textTertiary} />
                </Pressable>
              }
              title={drone.name}
              value={activeDroneIds.has(drone.id) ? "Aktiv" : undefined}
              subtitle={`${drone.classMark} · ${drone.mtomGrams} g · ${count} ${count === 1 ? "Flug" : "Flüge"}${isSelected ? " · ausgewählt" : ""}`}
              onPress={() => navigation.navigate("DroneSetup", { droneId: drone.id })}
            />
          );
        })
      )}

      {sectionTitle("TCAS - PROXIMITY-ALARM")}
      <SettingsRow
        testID="settings-row-tcas"
        icon={<Feather name="alert-triangle" size={20} color={theme.primary} />}
        title="TCAS - Proximity-Alarm"
        subtitle={`${(settings?.proximityAlarm?.enabled ?? DEFAULT_PROXIMITY_ALARM.enabled) ? "Aktiviert" : "Deaktiviert"} · TA/RA, Radius, Töne`}
        onPress={() => navigation.navigate("TcasSettings")}
      />
    </>
  );

  const rightColumn = (
    <>
      {sectionTitle("KARTEN", landscape)}
      <Card style={styles.mapStyleCard}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: Spacing.sm }}>
          <Feather name="layers" size={20} color={theme.primary} />
          <ThemedText style={[styles.menuText, { marginLeft: Spacing.md }]}>Basiskarte</ThemedText>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs }}>
          {MAP_STYLES.map((option) => {
            const selected = mapStyle === option.id;
            return (
              <Pressable
                key={option.id}
                testID={`map-style-${option.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => handleSelectMapStyle(option.id)}
                style={{
                  paddingHorizontal: Spacing.md,
                  paddingVertical: Spacing.sm,
                  borderRadius: BorderRadius.md,
                  backgroundColor: selected ? theme.primary : theme.backgroundSecondary,
                }}
              >
                <ThemedText style={{ color: selected ? "#FFFFFF" : theme.text, fontWeight: "600" }}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <SettingsRow
        icon={<Feather name="wind" size={20} color={theme.primary} />}
        title="Ergänzende Anlagen"
        accessory={valuePill(showEnergyInfrastructure ? "An" : "Aus", handleToggleEnergyInfrastructure, "toggle-energy-infrastructure", "switch", showEnergyInfrastructure)}
      />

      {sectionTitle("EINHEITEN")}
      <SettingsRow
        icon={<Feather name="wind" size={20} color={theme.primary} />}
        title="Windgeschwindigkeit"
        accessory={valuePill(settings?.windUnit || "m/s", () => toggleUnit("windUnit"), "toggle-wind-unit")}
      />
      <SettingsRow
        icon={<Feather name="thermometer" size={20} color={theme.primary} />}
        title="Temperatur"
        accessory={valuePill(settings?.tempUnit === "F" ? "°F" : "°C", () => toggleUnit("tempUnit"), "toggle-temp-unit")}
      />

      {sectionTitle("DOKUMENTE")}
      <SettingsRow
        icon={<Feather name="paperclip" size={20} color={theme.primary} />}
        title="Dokumente an Exporte anhängen"
        subtitle="Hängt beim PDF-Export die zum Flugzeitpunkt gültige Allgemeinverfügung, das A2-Zeugnis und den Versicherungsnachweis an. Pro Export überschreibbar."
        accessory={valuePill((settings?.attachPilotDocsToExports ?? true) ? "An" : "Aus", handleToggleAttachDocs, "toggle-attach-docs")}
      />

      {sectionTitle("WILDTIERRETTUNG")}
      <SettingsRow
        icon={<MaterialCommunityIcons name="paw" size={20} color={theme.primary} />}
        title={WILDLIFE_RESCUE_MODE_TITLE}
        subtitle={WILDLIFE_RESCUE_MODE_SUBTITLE}
        accessory={valuePill((settings?.wildlifeRescueMode ?? false) ? "An" : "Aus", handleToggleWildlifeRescue, "toggle-wildlife-rescue")}
      />
      {(settings?.wildlifeRescueMode ?? false) ? (
        <SettingsRow
          testID="menu-wildlife-info"
          icon={<Feather name="info" size={20} color={theme.primary} />}
          title="Mehr Infos zu den Allgemeinverfügungen"
          onPress={() => setWildlifeInfoOpen(true)}
        />
      ) : null}

      {sectionTitle("RESSOURCEN")}
      <SettingsRow testID="settings-row-links" icon={<Feather name="bookmark" size={20} color={theme.primary} />} title="Nützliche Links" onPress={() => navigation.navigate("ResourceLinks")} />
      <SettingsRow testID="settings-row-glossary" icon={<Feather name="book" size={20} color={theme.primary} />} title="Glossar" onPress={() => navigation.navigate("Glossary")} />
      <SettingsRow testID="menu-vlos-info" icon={<Feather name="eye" size={20} color={theme.primary} />} title="VLOS — Sichtweite erklärt" onPress={() => navigation.navigate("VlosInfo")} />
      <SettingsRow testID="settings-row-easa-reference" icon={<Feather name="book-open" size={20} color={theme.primary} />} title="EASA — EU-Drohnenregeln" onPress={() => navigation.navigate("EasaReference")} />
      <SettingsRow testID="settings-row-easa-rules" icon={<Feather name="file-text" size={20} color={theme.primary} />} title="Easy Access Rules (UAS)" onPress={() => navigation.navigate("EasaRules")} />
      <SettingsRow testID="settings-row-countries" icon={<Feather name="globe" size={20} color={theme.primary} />} title="Länder — Rules & Regulations" onPress={() => navigation.navigate("CountryInfo")} />
      <SettingsRow testID="menu-offline-maps" icon={<Feather name="download-cloud" size={20} color={theme.primary} />} title="Karten, Hindernisse & Offline" onPress={() => navigation.navigate("RcOfflineMaps")} />
      <SettingsRow testID="menu-rc-key-test" icon={<Feather name="radio" size={20} color={theme.primary} />} title="Tasten der Fernsteuerung" onPress={() => navigation.navigate("RcKeyTest")} />
      <SettingsRow testID="settings-row-weather" icon={<Feather name="cloud" size={20} color={theme.primary} />} title="Aktuelles Wetter" onPress={() => navigation.navigate("DipulWeather")} />

      {sectionTitle("ÜBER")}
      <SettingsRow
        icon={<Feather name="info" size={20} color={theme.primary} />}
        title="Version"
        accessory={<ThemedText style={{ color: theme.textTertiary }}>RC-Version {Constants.expoConfig?.version ?? ""}</ThemedText>}
      />
      <SettingsRow testID="settings-row-privacy" icon={<Feather name="shield" size={20} color={theme.primary} />} title="Datenschutzerklärung" onPress={() => navigation.navigate("PrivacyPolicy")} />
      <SettingsRow testID="settings-row-terms" icon={<Feather name="file-text" size={20} color={theme.primary} />} title="AGB / Nutzungsbedingungen" onPress={() => navigation.navigate("LegalDocument", { doc: "terms" })} />
      <SettingsRow testID="menu-data-sources" icon={<Feather name="database" size={20} color={theme.primary} />} title="Datenquellen & Lizenzen" onPress={() => navigation.navigate("DataSources")} />
      <SettingsRow testID="settings-row-imprint" icon={<Feather name="briefcase" size={20} color={theme.primary} />} title="Impressum" onPress={() => navigation.navigate("LegalDocument", { doc: "imprint" })} />
    </>
  );

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
        {landscape ? (
          <View style={styles.columns} testID="settings-two-columns">
            <View style={styles.column}>{leftColumn}</View>
            <View style={styles.column}>{rightColumn}</View>
          </View>
        ) : (
          <>
            {leftColumn}
            {rightColumn}
          </>
        )}
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
      <Modal
        visible={wildlifeDialogStage !== "closed"}
        transparent
        animationType="fade"
        onRequestClose={() => setWildlifeDialogStage("closed")}
      >
        <View style={styles.dialogOverlay}>
          <View style={[styles.dialogBox, { backgroundColor: theme.backgroundDefault }]}>
            {wildlifeDialogStage === "confirm" ? (
              <>
                <ThemedText type="h3" style={styles.dialogTitle}>
                  {WILDLIFE_RESCUE_MODE_TITLE}
                </ThemedText>
                <ThemedText style={[styles.dialogBody, { color: theme.textSecondary }]}>
                  {WILDLIFE_RESCUE_CONFIRM_QUESTION}
                </ThemedText>
                <View style={styles.dialogButtonRow}>
                  <Pressable
                    testID="button-wildlife-decline"
                    onPress={() => setWildlifeDialogStage("closed")}
                    style={[styles.dialogButton, { backgroundColor: theme.backgroundSecondary }]}
                  >
                    <ThemedText style={[styles.dialogButtonText, { color: theme.text }]}>Nein</ThemedText>
                  </Pressable>
                  <Pressable
                    testID="button-wildlife-confirm"
                    onPress={handleConfirmWildlifeRescue}
                    style={[styles.dialogButton, { backgroundColor: theme.primary }]}
                  >
                    <ThemedText style={[styles.dialogButtonText, { color: "#FFFFFF" }]}>Ja</ThemedText>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <ThemedText style={[styles.dialogBody, { color: theme.text, textAlign: "center" }]}>
                  {WILDLIFE_RESCUE_THANK_YOU}
                </ThemedText>
                <View style={styles.dialogButtonRow}>
                  <Pressable
                    testID="button-wildlife-more-info"
                    onPress={() => {
                      setWildlifeDialogStage("closed");
                      setWildlifeInfoOpen(true);
                    }}
                    style={[styles.dialogButton, { backgroundColor: theme.backgroundSecondary }]}
                  >
                    <ThemedText style={[styles.dialogButtonText, { color: theme.text }]}>Mehr Infos</ThemedText>
                  </Pressable>
                  <Pressable
                    testID="button-wildlife-done"
                    onPress={() => setWildlifeDialogStage("closed")}
                    style={[styles.dialogButton, { backgroundColor: theme.primary }]}
                  >
                    <ThemedText style={[styles.dialogButtonText, { color: "#FFFFFF" }]}>Over and Out</ThemedText>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      <WildlifeRescueInfoModal
        visible={wildlifeInfoOpen}
        onClose={() => setWildlifeInfoOpen(false)}
      />
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
  sectionTitleSpacing: {
    marginTop: Spacing.xl,
  },
  columns: {
    flexDirection: "row",
    gap: Spacing.lg,
    alignItems: "flex-start",
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 52,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  rowIcon: {
    width: 24,
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowValue: {
    fontWeight: "600",
    maxWidth: 160,
  },
  mapStyleCard: {
    padding: Spacing.md,
    marginBottom: Spacing.xs,
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
  dronesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  droneAddButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
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
  dialogOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  dialogBox: {
    width: "100%",
    maxWidth: 400,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
  },
  dialogTitle: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  dialogBody: {
    ...Typography.body,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  dialogButtonRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  dialogButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogButtonText: {
    ...Typography.body,
    fontWeight: "600",
  },
});
