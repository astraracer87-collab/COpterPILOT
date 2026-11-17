import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, TextInput, Modal, SectionList, Platform, Alert } from "react-native";
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
import { setActiveNotamCount } from "@/lib/notamAlertStore";
import { COUNTRY_MAPS, getCountryMapConfig, getCountryFlag } from "@/lib/countryMaps";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";
import { useAuth } from "@/lib/auth";
import { setupGuideController } from "@/lib/setupGuide";
import { DroneCard } from "@/components/DroneCard";
import { DocumentPreviewModal } from "@/components/DocumentPreviewModal";
import type { DocumentRef } from "@/lib/documents";
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
type SettingsRoute = RouteProp<SettingsStackParamList, "Settings">;

// Freischaltung des FCC-Punkts – nur für die laufende App-Sitzung (wird beim App-Neustart zurückgesetzt).
let fccUnlockedSession = false;

export default function SettingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<SettingsRoute>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { user, isAuthenticated, status: authStatus } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [selectedDroneId, setSelectedDroneIdState] = useState<string | null>(null);
  const [pilot, setPilot] = useState<PilotProfile | null>(null);
  const [flightCounts, setFlightCounts] = useState<Record<string, number>>({});
  const [activeDroneIds, setActiveDroneIds] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<{ doc: DocumentRef; label: string } | null>(null);
  const [wildlifeDialogStage, setWildlifeDialogStage] = useState<"closed" | "confirm" | "thanks">("closed");
  const [wildlifeInfoOpen, setWildlifeInfoOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyleOption>("grayscale");
  const [showEnergyInfrastructure, setShowEnergyInfrastructure] = useState(true);
  // Versteckter Schalter: 8× auf die Kopf-Überschrift „Einstellungen" tippen blendet den FCC-Punkt ein/aus.
  // Gilt nur für die laufende App-Sitzung (fccUnlockedSession, Modulebene) – nach dem Schließen
  // der App ist der Punkt wieder versteckt und muss erneut per 8× Tippen freigeschaltet werden.
  const [fccUnlocked, setFccUnlocked] = useState(fccUnlockedSession);
  const fccTapsRef = useRef<number[]>([]);

  const handleSecretTap = useCallback(() => {
    const now = Date.now();
    fccTapsRef.current = [...fccTapsRef.current, now].filter((t) => now - t < 3000);
    if (fccTapsRef.current.length >= 8) {
      fccTapsRef.current = [];
      setFccUnlocked((prev) => {
        const next = !prev;
        fccUnlockedSession = next;
        Alert.alert(
          next ? "FCC-Tool sichtbar" : "FCC-Tool ausgeblendet",
          next
            ? "Der Punkt „FCC-Tool“ erscheint jetzt unten in den Einstellungen."
            : "Der Punkt „FCC-Tool“ ist wieder ausgeblendet.",
        );
        return next;
      });
    }
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable onPress={handleSecretTap} hitSlop={8} accessibilityRole="header">
          <ThemedText style={{ fontSize: 17, fontWeight: "600", color: theme.text }}>Einstellungen</ThemedText>
        </Pressable>
      ),
    });
  }, [navigation, theme, handleSecretTap]);

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
          DATEN
        </ThemedText>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("MyData")}>
          <View style={styles.menuRow}>
            <Feather name="database" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>Meine Daten</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Alles bleibt auf diesem Gerät (RC-Version ohne Konto)
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          FLUGREGION
        </ThemedText>
        <Card
          style={styles.menuItem}
          onPress={() => setCountryPickerOpen(true)}
        >
          <View style={[styles.menuRow, { flex: 1 }]}>
            <Feather name="globe" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <ThemedText style={styles.menuText}>Land</ThemedText>
                <ThemedText style={{ color: theme.primary, fontWeight: "600" }} numberOfLines={1}>
                  {getCountryMapConfig(settings?.preferredCountryIso || "DE")?.nameDE || "Deutschland"}
                </ThemedText>
              </View>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Bestimmt Karten-Zentrierung, NOTAMs & Geozonen-Filter
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          KARTEN
        </ThemedText>
        <Card style={{ padding: Spacing.md, marginBottom: Spacing.sm }}>
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
        <Card style={[styles.menuItem, styles.menuItemSpacing]}>
          <View style={[styles.menuRow, { flex: 1, paddingRight: Spacing.md }]}>
            <Feather name="wind" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>Ergänzende Anlagen</ThemedText>
            </View>
          </View>
          <Pressable
            testID="toggle-energy-infrastructure"
            accessibilityRole="switch"
            accessibilityState={{ checked: showEnergyInfrastructure }}
            onPress={handleToggleEnergyInfrastructure}
            style={[styles.unitToggle, { backgroundColor: theme.backgroundSecondary }]}
          >
            <ThemedText style={[styles.unitText, { color: theme.primary }]}>
              {showEnergyInfrastructure ? "An" : "Aus"}
            </ThemedText>
          </Pressable>
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
        <Card style={styles.menuItem} onPress={() => navigation.navigate("PilotLicenseCard")}>
          <View style={styles.menuRow}>
            <Feather name="credit-card" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Führerschein anzeigen</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("ExpiryOverview")}>
          <View style={styles.menuRow}>
            <Feather name="clock" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Ablaufende Dokumente</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card
          style={[styles.menuItem, styles.menuItemSpacing]}
          onPress={() => setupGuideController.launch()}
        >
          <View style={[styles.menuRow, { flex: 1 }]}>
            <Feather name="compass" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>Einrichtungs-Assistent</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                Drohnen, Pilotendaten und Lizenzen Schritt für Schritt einrichten
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <View style={styles.dronesSectionHeader}>
          <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginBottom: 0 }]}>
            DROHNEN
          </ThemedText>
          <Pressable
            onPress={() => navigation.navigate("DroneSetup", {})}
            style={({ pressed }) => pressed && styles.pressed}
            testID="button-add-drone"
          >
            <View style={[styles.droneAddButton, { backgroundColor: theme.primary }]}>
              <Feather name="plus" size={18} color="#FFFFFF" />
            </View>
          </Pressable>
        </View>
        {drones.length === 0 ? (
          <Card style={styles.menuItem} onPress={() => navigation.navigate("DroneSetup", {})}>
            <View style={styles.menuRow}>
              <MaterialCommunityIcons name="quadcopter" size={22} color={theme.primary} />
              <ThemedText style={styles.menuText}>Erste Drohne hinzufügen</ThemedText>
            </View>
            <Feather name="plus" size={20} color={theme.textTertiary} />
          </Card>
        ) : (
          drones.map((drone) => (
            <DroneCard
              key={drone.id}
              drone={drone}
              pilot={pilot}
              isSelected={drone.id === selectedDroneId}
              hasActiveBriefing={activeDroneIds.has(drone.id)}
              flightCount={flightCounts[drone.id] || 0}
              navigation={navigation}
              onSelect={() => handleSelectDrone(drone.id)}
              onChanged={loadSettings}
              onPreviewDoc={(doc, label) => setPreviewDoc({ doc, label })}
            />
          ))
        )}
        <Card style={[styles.menuItem, styles.menuItemSpacing]} onPress={() => navigation.navigate("Drones")}>
          <View style={styles.menuRow}>
            <Feather name="settings" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Alle Drohnen verwalten</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          TCAS - PROXIMITY-ALARM
        </ThemedText>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("TcasSettings")}>
          <View style={styles.switchRow}>
            <Feather name="alert-triangle" size={20} color={theme.primary} />
            <View style={styles.switchContent}>
              <ThemedText style={styles.menuText}>TCAS - Proximity-Alarm</ThemedText>
              <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                {(settings?.proximityAlarm?.enabled ?? DEFAULT_PROXIMITY_ALARM.enabled) ? "Aktiviert" : "Deaktiviert"} · TA/RA, Radius, Töne
              </ThemedText>
            </View>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>

        {fccUnlocked && (
          <Card style={styles.menuItem} onPress={() => navigation.navigate("FccTool")}>
            <View style={styles.switchRow}>
              <Feather name="radio" size={20} color={theme.primary} />
              <View style={styles.switchContent}>
                <ThemedText style={styles.menuText}>FCC-Tool</ThemedText>
                <ThemedText style={[styles.switchDescription, { color: theme.textSecondary }]}>
                  Funkregion CE/FCC für Fluggerät oder Goggle · nur wo zulässig
                </ThemedText>
              </View>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </Card>
        )}

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
          DOKUMENTE
        </ThemedText>
        <Card style={styles.menuItem}>
          <View style={[styles.menuRow, { flex: 1, paddingRight: Spacing.md }]}>
            <Feather name="paperclip" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>Dokumente an Exporte anhängen</ThemedText>
              <ThemedText style={[styles.menuSubText, { color: theme.textTertiary }]}>
                Hängt beim PDF-Export die zum Flugzeitpunkt gültige Allgemeinverfügung,
                das A2-Zeugnis und den Versicherungsnachweis an. Pro Export überschreibbar.
              </ThemedText>
            </View>
          </View>
          <Pressable
            testID="toggle-attach-docs"
            onPress={handleToggleAttachDocs}
            style={[styles.unitToggle, { backgroundColor: theme.backgroundSecondary }]}
          >
            <ThemedText style={[styles.unitText, { color: theme.primary }]}>
              {(settings?.attachPilotDocsToExports ?? true) ? "An" : "Aus"}
            </ThemedText>
          </Pressable>
        </Card>

        <ThemedText style={[styles.sectionTitle, { color: theme.textSecondary, marginTop: Spacing["2xl"] }]}>
          WILDTIERRETTUNG
        </ThemedText>
        <Card style={styles.menuItem}>
          <View style={[styles.menuRow, { flex: 1, paddingRight: Spacing.md }]}>
            <MaterialCommunityIcons name="paw" size={20} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.menuText}>{WILDLIFE_RESCUE_MODE_TITLE}</ThemedText>
              <ThemedText style={[styles.menuSubText, { color: theme.textTertiary }]}>
                {WILDLIFE_RESCUE_MODE_SUBTITLE}
              </ThemedText>
            </View>
          </View>
          <Pressable
            testID="toggle-wildlife-rescue"
            onPress={handleToggleWildlifeRescue}
            style={[styles.unitToggle, { backgroundColor: theme.backgroundSecondary }]}
          >
            <ThemedText style={[styles.unitText, { color: theme.primary }]}>
              {(settings?.wildlifeRescueMode ?? false) ? "An" : "Aus"}
            </ThemedText>
          </Pressable>
        </Card>
        {(settings?.wildlifeRescueMode ?? false) ? (
          <Card style={[styles.menuItem, styles.menuItemSpacing]} onPress={() => setWildlifeInfoOpen(true)} testID="menu-wildlife-info">
            <View style={styles.menuRow}>
              <Feather name="info" size={20} color={theme.primary} />
              <ThemedText style={styles.menuText}>Mehr Infos zu den Allgemeinverfügungen</ThemedText>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textTertiary} />
          </Card>
        ) : null}

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
        <Card style={styles.menuItem} onPress={() => navigation.navigate("VlosInfo")} testID="menu-vlos-info">
          <View style={styles.menuRow}>
            <Feather name="eye" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>VLOS — Sichtweite erklärt</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("EasaReference")}>
          <View style={styles.menuRow}>
            <Feather name="book-open" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>EASA — EU-Drohnenregeln</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("EasaRules")}>
          <View style={styles.menuRow}>
            <Feather name="file-text" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Easy Access Rules (UAS)</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={[styles.menuItem, styles.menuItemSpacing]} onPress={() => navigation.navigate("CountryInfo")}>
          <View style={styles.menuRow}>
            <Feather name="globe" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Länder — Rules &amp; Regulations</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("RcOfflineMaps")} testID="menu-offline-maps">
          <View style={styles.menuRow}>
            <Feather name="download-cloud" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Karten, Hindernisse & Offline</ThemedText>
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
          <ThemedText style={{ color: theme.textTertiary }}>RC-Version {Constants.expoConfig?.version ?? ""}</ThemedText>
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("PrivacyPolicy")}>
          <View style={styles.menuRow}>
            <Feather name="shield" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Datenschutzerklärung</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("LegalDocument", { doc: "terms" })}>
          <View style={styles.menuRow}>
            <Feather name="file-text" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>AGB / Nutzungsbedingungen</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
        </Card>
        <Card style={styles.menuItem} onPress={() => navigation.navigate("LegalDocument", { doc: "imprint" })}>
          <View style={styles.menuRow}>
            <Feather name="briefcase" size={20} color={theme.primary} />
            <ThemedText style={styles.menuText}>Impressum</ThemedText>
          </View>
          <Feather name="chevron-right" size={20} color={theme.textTertiary} />
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
      <DocumentPreviewModal
        visible={previewDoc !== null}
        onClose={() => setPreviewDoc(null)}
        document={previewDoc?.doc ?? null}
      />
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
    marginTop: Spacing["2xl"],
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
