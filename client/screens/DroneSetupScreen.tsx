import React, { useState, useEffect, useCallback } from "react";
import { DroneImage } from "@/components/DroneImage";
import { beaufortLevel, warnThresholdMs, WIND_WARN_FRACTION } from "@/lib/beaufort";
import { activeNdKitId, applyNdKitSelection, buildNdKits, type NdKit } from "@/lib/ndKits";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  FlatList,
  Modal,
  ActivityIndicator,
} from "react-native";
import { useRoute, useNavigation, CommonActions } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import Checkbox from "@/components/Checkbox";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius, Colors } from "@/constants/theme";
import {
  getDrone,
  saveDrone,
  updateDrone,
  setSelectedDroneId,
  getSettings,
  Settings,
  DroneProfile,
  DroneClass,
  DroneType,
  OpenCategory,
  DroneCompliance,
  DEFAULT_COMPLIANCE,
  getDefaultLimitsForClass,
  WeatherLimits,
  DroneBattery,
} from "@/lib/storage";
import {
  ALL_PRESETS,
  searchPresets,
  getPresetLimits,
  getDefaultCategoryForPreset,
  findPresetForDrone,
  DronePreset,
  DRONE_CLASS_INFO,
  DRONE_TYPE_INFO,
} from "@/lib/dronePresets";
import * as Haptics from "@/lib/noHaptics";
import { DocumentField } from "@/components/DocumentField";
import { DocumentRef } from "@/lib/documents";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type RouteParams = RouteProp<SettingsStackParamList, "DroneSetup">;

type SetupStep = "select" | "details";

export default function DroneSetupScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const droneId = route.params?.droneId;
  const isEditing = !!droneId;

  const [step, setStep] = useState<SetupStep>(isEditing ? "details" : "select");
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredPresets, setFilteredPresets] = useState<DronePreset[]>(ALL_PRESETS);

  const [name, setName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [alphaTangoId, setAlphaTangoId] = useState("");
  const [alphaTangoExpirationDate, setAlphaTangoExpirationDate] = useState("");
  const [alphaTangoDocument, setAlphaTangoDocument] = useState<DocumentRef | null>(null);
  const [dflightDocument, setDflightDocument] = useState<DocumentRef | null>(null);
  const [classMark, setClassMark] = useState<DroneClass>("C0");
  const [mtomGrams, setMtomGrams] = useState(249);
  const [charDimensionM, setCharDimensionM] = useState<number>(0.3);
  const [hasCameraOrSensor, setHasCameraOrSensor] = useState(true);
  const [hasRemoteId, setHasRemoteId] = useState(false);
  const [altitudeLocked120m, setAltitudeLocked120m] = useState(false);
  const [ownedNdFilters, setOwnedNdFilters] = useState<string[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<DronePreset | null>(null);
  const [batteries, setBatteries] = useState<DroneBattery[]>([]);
  const [batteryEditor, setBatteryEditor] = useState<{
    visible: boolean;
    editingId: string | null;
    name: string;
    serial: string;
  }>({ visible: false, editingId: null, name: "", serial: "" });
  const [droneType, setDroneType] = useState<DroneType>("standard");
  const [openCategory, setOpenCategory] = useState<OpenCategory>("A1");
  const [compliance, setCompliance] = useState<DroneCompliance>(DEFAULT_COMPLIANCE);
  const [limits, setLimits] = useState<WeatherLimits>(getDefaultLimitsForClass("C0"));
  const [customLimitsEnabled, setCustomLimitsEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // Im Edit-Modus zeigen wir einen Spinner, bis getDrone() zurückkommt.
  // Ohne diesen Loading-State würde das Formular mit leeren Strings rendern
  // (TextInput-Placeholder "z.B. DJI Mini 4 Pro" sichtbar), bevor loadDrone()
  // die echten Werte einsetzt — User denkt fälschlich, nichts sei voreingestellt.
  const [loadingDrone, setLoadingDrone] = useState<boolean>(isEditing);

  useEffect(() => {
    getSettings().then(setSettings);
    if (droneId) {
      loadDrone();
    }
  }, [droneId]);
  
  const getWindUnit = () => settings?.windUnit || "m/s";
  
  const convertWindForDisplay = (value: number) => {
    if (settings?.windUnit === "km/h") {
      return (value * 3.6).toFixed(1);
    }
    return String(value);
  };
  
  const parseWindFromInput = (value: string) => {
    const numValue = parseFloat(value) || 0;
    if (settings?.windUnit === "km/h") {
      return numValue / 3.6;
    }
    return numValue;
  };

  useEffect(() => {
    if (searchQuery.trim()) {
      setFilteredPresets(searchPresets(searchQuery));
    } else {
      setFilteredPresets(ALL_PRESETS);
    }
  }, [searchQuery]);

  const loadDrone = async () => {
    if (!droneId) return;
    setLoadingDrone(true);
    try {
      const drone = await getDrone(droneId);
      if (drone) {
        setName(drone.name);
        setManufacturer(drone.manufacturer || "");
        setModel(drone.model || "");
        setSerialNumber(drone.serialNumber || "");
        setAlphaTangoId(drone.alphaTangoId || "");
        setAlphaTangoExpirationDate(drone.alphaTangoExpirationDate || "");
        setAlphaTangoDocument(drone.alphaTangoDocument ?? null);
        setDflightDocument(drone.dflightDocument ?? null);
        setClassMark(drone.classMark);
        setMtomGrams(drone.mtomGrams);
        if (typeof drone.charDimensionM === "number" && drone.charDimensionM > 0) {
          setCharDimensionM(drone.charDimensionM);
        }
        setHasCameraOrSensor(drone.hasCameraOrSensor);
        setHasRemoteId(drone.hasRemoteId ?? false);
        setAltitudeLocked120m(drone.altitudeLocked120m ?? false);
        setOwnedNdFilters(drone.ownedNdFilters ?? []);
        setBatteries(drone.batteries ?? []);
        setDroneType(drone.droneType);
        setOpenCategory(drone.openCategory);
        setCompliance(drone.compliance);
        setLimits(drone.limits);
      } else {
        console.warn("[DroneSetup] Drohne nicht gefunden:", droneId);
        Alert.alert(
          "Drohne nicht gefunden",
          "Die Drohne konnte nicht geladen werden. Eventuell ist sie inzwischen archiviert oder gelöscht.",
        );
      }
    } catch (err) {
      console.error("[DroneSetup] loadDrone failed:", err);
      Alert.alert(
        "Fehler beim Laden",
        "Die Drohnendaten konnten nicht geladen werden. Bitte erneut versuchen.",
      );
    } finally {
      setLoadingDrone(false);
    }
  };

  const selectPreset = (preset: DronePreset) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setName(`${preset.manufacturer} ${preset.model}`);
    setManufacturer(preset.manufacturer);
    setModel(preset.model);
    setClassMark(preset.classMark);
    setMtomGrams(preset.mtomGrams);
    if (preset.charDimensionM && preset.charDimensionM > 0) {
      setCharDimensionM(preset.charDimensionM);
    }
    setHasCameraOrSensor(preset.hasCameraOrSensor);
    setHasRemoteId(preset.hasRemoteId);
    setAltitudeLocked120m(preset.altitudeLocked120m);
    // ND-Filter werden bewusst NICHT aus preset.filterEcosystem vorausgewählt:
    // das Hersteller-Ökosystem listet nur die kompatiblen Filterstärken auf,
    // nicht den tatsächlichen Bestand des Piloten. Vorbelegen würde dazu
    // führen, dass der ND-Filter Finder Filter empfiehlt, die der Pilot
    // gar nicht besitzt. Pilot wählt seinen echten Bestand selbst aus.
    setDroneType(preset.droneType);
    setLimits(getPresetLimits(preset));
    setCustomLimitsEnabled(false);
    setOpenCategory(getDefaultCategoryForPreset(preset));
    setSelectedPreset(preset);
    setStep("details");
  };

  const selectManual = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPreset(null);
    setStep("details");
  };

  // Kit antippen setzt die Auswahl GENAU auf das Kit (nicht zusammenführen),
  // damit die Hervorhebung eindeutig aus der Auswahl folgt.
  const applyNdKit = (kit: NdKit) => {
    Haptics.selectionAsync().catch(() => {});
    setOwnedNdFilters(applyNdKitSelection(kit));
  };
  const ndKits = buildNdKits(selectedPreset);
  // Hervorhebung nur aus der Auswahl abgeleitet (kein gespeicherter Index)
  const activeKitId = activeNdKitId(ownedNdFilters, ndKits);

  const handleSave = async () => {
    if (saving) return;
    if (!name.trim()) {
      Alert.alert("Fehler", "Bitte geben Sie einen Namen für die Drohne ein.");
      return;
    }

    setSaving(true);
    try {
      if (isEditing && droneId) {
        await updateDrone(droneId, {
          name,
          manufacturer,
          model,
          serialNumber: serialNumber.trim() || undefined,
          alphaTangoId: alphaTangoId.trim() || undefined,
          alphaTangoExpirationDate: alphaTangoExpirationDate.trim() || undefined,
          alphaTangoDocument,
          dflightDocument,
          classMark,
          mtomGrams,
          charDimensionM: charDimensionM > 0 ? charDimensionM : undefined,
          hasCameraOrSensor,
          hasRemoteId,
          altitudeLocked120m,
          ownedNdFilters: ownedNdFilters.length > 0 ? ownedNdFilters : undefined,
          batteries: batteries.length > 0 ? batteries : undefined,
          droneType,
          openCategory,
          compliance,
          limits,
        });
      } else {
        const newDrone = await saveDrone({
          name,
          manufacturer,
          model,
          serialNumber: serialNumber.trim() || undefined,
          alphaTangoId: alphaTangoId.trim() || undefined,
          alphaTangoExpirationDate: alphaTangoExpirationDate.trim() || undefined,
          alphaTangoDocument,
          dflightDocument,
          classMark,
          mtomGrams,
          charDimensionM: charDimensionM > 0 ? charDimensionM : undefined,
          hasCameraOrSensor,
          hasRemoteId,
          altitudeLocked120m,
          ownedNdFilters: ownedNdFilters.length > 0 ? ownedNdFilters : undefined,
          batteries: batteries.length > 0 ? batteries : undefined,
          droneType,
          openCategory,
          compliance,
          limits,
        });
        await setSelectedDroneId(newDrone.id);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setSaving(false);
      if (isEditing && navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: "Settings" }],
          })
        );
      }
    } catch (error) {
      console.error("Drone save error:", error);
      setSaving(false);
      Alert.alert("Fehler", "Drohne konnte nicht gespeichert werden, bitte prüfe die Eingaben.");
    }
  };

  const updateCompliance = (key: keyof DroneCompliance, value: boolean) => {
    setCompliance((prev) => ({ ...prev, [key]: value }));
  };

  const updateLimit = (key: keyof WeatherLimits, value: string) => {
    const numValue = parseFloat(value) || 0;
    setLimits((prev) => ({ ...prev, [key]: numValue }));
  };

  const renderPresetItem = ({ item }: { item: DronePreset }) => (
    <Card style={styles.presetCard} onPress={() => selectPreset(item)}>
      <View style={styles.presetImage}>
        <DroneImage manufacturer={item.manufacturer} model={item.model} size={44} iconColor={theme.textTertiary} iconSize={22} />
      </View>
      <View style={styles.presetInfo}>
        <ThemedText style={styles.presetName}>
          {item.manufacturer} {item.model}
        </ThemedText>
        <ThemedText style={[styles.presetDetails, { color: theme.textSecondary }]}>
          {DRONE_CLASS_INFO[item.classMark].label} | {item.mtomGrams}g | Wind: {item.maxWindMs} m/s
        </ThemedText>
      </View>
      <Feather name="chevron-right" size={20} color={theme.textTertiary} />
    </Card>
  );

  const renderSelectStep = () => (
    <View style={styles.stepContainer}>
      <ThemedText style={styles.stepTitle}>Drohne auswählen</ThemedText>
      <ThemedText style={[styles.stepDescription, { color: theme.textSecondary }]}>
        Wählen Sie ein vordefiniertes Modell oder richten Sie manuell ein.
      </ThemedText>

      <TextInput disableFullscreenUI
        style={[
          styles.searchInput,
          { backgroundColor: theme.backgroundSecondary, color: theme.text },
        ]}
        placeholder="Drohne suchen..."
        placeholderTextColor={theme.textTertiary}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      <FlatList
        data={filteredPresets}
        keyExtractor={(item) => `${item.manufacturer}-${item.model}`}
        renderItem={renderPresetItem}
        style={styles.presetList}
        ListHeaderComponent={
          <Pressable onPress={selectManual} style={({ pressed }) => pressed && styles.pressed} testID="button-manual-setup">
            <Card style={[styles.presetCard, { borderStyle: "dashed", borderWidth: 1, borderColor: theme.border }]}>
              <View style={styles.presetInfo}>
                <ThemedText style={styles.presetName}>Manuell einrichten</ThemedText>
                <ThemedText style={[styles.presetDetails, { color: theme.textSecondary }]}>
                  Eigene Drohne ohne Preset konfigurieren
                </ThemedText>
              </View>
              <Feather name="plus" size={20} color={theme.primary} />
            </Card>
          </Pressable>
        }
      />
    </View>
  );

  const renderDetailsStep = () => {
    return (
    <KeyboardAwareScrollViewCompat bottomOffset={24} contentContainerStyle={styles.scrollContent}>
      <View style={styles.detailsHeader}>
        <View style={[styles.detailsImage, { backgroundColor: theme.backgroundSecondary }]}>
          <DroneImage manufacturer={manufacturer} model={model} size={84} iconColor={theme.primary} iconSize={40} />
        </View>
        <ThemedText style={[styles.stepTitle, { flex: 1 }]}>
          {isEditing ? "Drohne bearbeiten" : "Details eingeben"}
        </ThemedText>
      </View>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>NAME</ThemedText>
      <TextInput disableFullscreenUI
        style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
        placeholder="z.B. DJI Mini 4 Pro"
        placeholderTextColor={theme.textTertiary}
        value={name}
        onChangeText={setName}
      />

      <View style={styles.row}>
        <View style={styles.halfInput}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>HERSTELLER</ThemedText>
          <TextInput disableFullscreenUI
            style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
            placeholder="z.B. DJI"
            placeholderTextColor={theme.textTertiary}
            value={manufacturer}
            onChangeText={setManufacturer}
          />
        </View>
        <View style={styles.halfInput}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>MODELL</ThemedText>
          <TextInput disableFullscreenUI
            style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
            placeholder="z.B. Mini 4 Pro"
            placeholderTextColor={theme.textTertiary}
            value={model}
            onChangeText={setModel}
          />
        </View>
      </View>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>SERIENNUMMER</ThemedText>
      <TextInput disableFullscreenUI
        testID="drone-input-serial"
        style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
        placeholder="optional, z.B. 1581F4..."
        placeholderTextColor={theme.textTertiary}
        value={serialNumber}
        onChangeText={setSerialNumber}
        autoCapitalize="characters"
      />

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>EU-KLASSE</ThemedText>
      <View style={styles.classButtons}>
        {(Object.keys(DRONE_CLASS_INFO) as DroneClass[]).map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              setClassMark(c);
              setLimits(getDefaultLimitsForClass(c));
            }}
            style={[
              styles.classButton,
              {
                backgroundColor: classMark === c ? theme.primary : theme.backgroundSecondary,
              },
            ]}
          >
            <ThemedText
              style={[
                styles.classButtonText,
                { color: classMark === c ? "#FFF" : theme.text },
              ]}
            >
              {DRONE_CLASS_INFO[c].label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>GEWICHT (MTOM)</ThemedText>
      <View style={styles.inputRow}>
        <TextInput disableFullscreenUI
          style={[styles.input, styles.numberInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
          value={String(mtomGrams)}
          onChangeText={(v) => setMtomGrams(parseInt(v) || 0)}
          keyboardType="numeric"
        />
        <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>Gramm</ThemedText>
      </View>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
        CHARAKTERISTISCHE DIMENSION (CD)
      </ThemedText>
      <View style={styles.inputRow}>
        <TextInput disableFullscreenUI
          style={[styles.input, styles.numberInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
          value={charDimensionM > 0 ? String(Math.round(charDimensionM * 1000)) : ""}
          onChangeText={(v) => setCharDimensionM((parseInt(v) || 0) / 1000)}
          keyboardType="number-pad"
          placeholder="z.B. 300"
          placeholderTextColor={theme.textTertiary}
        />
        <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>mm</ThemedText>
      </View>
      <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginTop: -4, marginBottom: 12 }]}>
        Multicopter: Diagonale zwischen den Rotorspitzen in ungünstigster Propellerstellung · Starrflügler: Spannweite oder Rumpflänge.
        Grundlage für die VLOS-Planung (EASA Issue 2).
      </ThemedText>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>TYP</ThemedText>
      <View style={styles.typeButtons}>
        {(Object.keys(DRONE_TYPE_INFO) as DroneType[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setDroneType(t)}
            style={[
              styles.typeButton,
              {
                backgroundColor: droneType === t ? theme.primary : theme.backgroundSecondary,
              },
            ]}
          >
            <ThemedText
              style={[
                styles.typeButtonText,
                { color: droneType === t ? "#FFF" : theme.text },
              ]}
            >
              {DRONE_TYPE_INFO[t].label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Card style={styles.checkCard}>
        <Checkbox
          checked={hasCameraOrSensor}
          onPress={() => setHasCameraOrSensor(!hasCameraOrSensor)}
          label="Kamera / Sensor für personenbezogene Daten"
        />
      </Card>

      <Card style={styles.checkCard}>
        <Checkbox
          checked={hasRemoteId}
          onPress={() => setHasRemoteId(!hasRemoteId)}
          label="EU Remote-ID integriert"
        />
        <ThemedText style={[styles.checkHint, { color: theme.textTertiary }]}>
          Remote-ID ist ab 2024 für C1-C3 Pflicht
        </ThemedText>
      </Card>

      <Card style={styles.checkCard}>
        <Checkbox
          checked={altitudeLocked120m}
          onPress={() => setAltitudeLocked120m(!altitudeLocked120m)}
          label="Höhe auf 120 m begrenzt (Firmware)"
        />
        <ThemedText style={[styles.checkHint, { color: theme.textTertiary }]}>
          Firmware-Lock auf max. 120 m AGL
        </ThemedText>
      </Card>

      <Card style={styles.checkCard}>
        <ThemedText style={{ ...Typography.body, color: theme.text, fontWeight: "600" }}>
          Vorhandene ND-Filter
        </ThemedText>
        <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginBottom: Spacing.sm }]}>
          Wähle aus, welche ND-Filter du tatsächlich besitzt. Der ND-Filter Finder
          schlägt dir dann das beste passende Filter aus deinem Bestand vor —
          zusätzlich zum idealen Wert.
        </ThemedText>

        <ThemedText style={[styles.checkHint, { color: theme.textSecondary, marginBottom: 6, fontWeight: "600" }]}>
          Schnellauswahl Standard-Kits:
        </ThemedText>
        <View style={[styles.ndChipRow, { marginBottom: Spacing.sm }]}>
          {ndKits.map((kit) => {
            const active = kit.id === activeKitId;
            return (
              <Pressable
                key={kit.id}
                onPress={() => applyNdKit(kit)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.ndKitChip,
                  active
                    ? { borderColor: theme.primary, backgroundColor: theme.primary + "15" }
                    : { borderColor: theme.border },
                ]}
                testID={`nd-kit-${kit.id}`}
              >
                {kit.id === "preset" ? (
                  <Feather name="package" size={12} color={active ? theme.primary : theme.textSecondary} />
                ) : null}
                <ThemedText style={{ color: active ? theme.primary : theme.textSecondary, fontWeight: "600", fontSize: 12 }}>
                  {kit.label} ({kit.filters.join("/").replace(/ND/g, "")})
                </ThemedText>
              </Pressable>
            );
          })}
          {ownedNdFilters.length > 0 ? (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setOwnedNdFilters([]);
              }}
              style={[styles.ndKitChip, { borderColor: theme.border }]}
              testID="nd-kit-clear"
            >
              <Feather name="x" size={12} color={theme.textTertiary} />
              <ThemedText style={{ color: theme.textTertiary, fontWeight: "600", fontSize: 12 }}>
                Alle abwählen
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.ndChipRow}>
          {["ND2","ND4","ND8","ND16","ND32","ND64","ND128","ND256","ND400","ND1000"].map((nd) => {
            const active = ownedNdFilters.includes(nd);
            return (
              <Pressable
                key={nd}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setOwnedNdFilters((prev) =>
                    prev.includes(nd) ? prev.filter((v) => v !== nd) : [...prev, nd],
                  );
                }}
                style={[
                  styles.ndChip,
                  {
                    backgroundColor: active ? theme.primary + "20" : "transparent",
                    borderColor: active ? theme.primary : theme.border,
                  },
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                testID={`nd-chip-${nd}`}
              >
                <ThemedText
                  style={{
                    color: active ? theme.primary : theme.textSecondary,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  {nd}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={styles.checkCard}>
        <View style={styles.batteryHeaderRow}>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ ...Typography.body, color: theme.text, fontWeight: "600" }}>
              Akkus (optional)
            </ThemedText>
            <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginTop: 2 }]}>
              Lege Akkus an, um pro Flug Auswahl + Restkapazität zu erfassen.
              Die Historie pro Akku findest du im Logbuch.
            </ThemedText>
          </View>
          <Pressable
            testID="battery-add-button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setBatteryEditor({ visible: true, editingId: null, name: "", serial: "" });
            }}
            style={({ pressed }) => [
              styles.batteryAddButton,
              { backgroundColor: theme.primary + "15" },
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
          >
            <Feather name="plus" size={18} color={theme.primary} />
            <ThemedText style={[styles.batteryAddText, { color: theme.primary }]}>
              Hinzufügen
            </ThemedText>
          </Pressable>
          <Pressable
            testID="battery-open-charger"
            onPress={() => (navigation as any).navigate("ChargerTab", { screen: "ChargerLive" })}
            style={({ pressed }) => [
              styles.batteryAddButton,
              { backgroundColor: theme.primary + "15", marginLeft: Spacing.xs },
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
            accessibilityLabel="Ladegerät (ISDT MA331)"
          >
            <Feather name="battery-charging" size={18} color={theme.primary} />
            <ThemedText style={[styles.batteryAddText, { color: theme.primary }]}>
              Ladegerät
            </ThemedText>
          </Pressable>
        </View>

        {batteries.length === 0 ? (
          <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginTop: Spacing.sm, fontStyle: "italic" }]}>
            Noch keine Akkus angelegt.
          </ThemedText>
        ) : (
          <View style={{ marginTop: Spacing.sm, gap: Spacing.xs }}>
            {batteries.map((b) => (
              <View
                key={b.id}
                style={[styles.batteryRow, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
                testID={`battery-row-${b.id}`}
              >
                <Pressable
                  testID={`battery-open-${b.id}`}
                  onPress={() => {
                    if (isEditing && droneId) {
                      (navigation as any).navigate("BatteryDetail", { droneId, batteryId: b.id });
                    } else {
                      Alert.alert(
                        "Verlauf nicht verfügbar",
                        "Bitte zuerst die Drohne speichern, um die Akku-Historie zu öffnen.",
                      );
                    }
                  }}
                  style={({ pressed }) => [
                    { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Feather name="battery" size={18} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ ...Typography.body, fontWeight: "600" }}>
                      {b.name} · SN: {b.serialNumber || "—"}
                    </ThemedText>
                  </View>
                </Pressable>
                <Pressable
                  testID={`battery-edit-${b.id}`}
                  onPress={() => setBatteryEditor({ visible: true, editingId: b.id, name: b.name, serial: b.serialNumber })}
                  hitSlop={8}
                  style={({ pressed }) => [styles.batteryIconBtn, pressed && { opacity: 0.6 }]}
                >
                  <Feather name="edit-2" size={16} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  testID={`battery-delete-${b.id}`}
                  onPress={() => {
                    Alert.alert(
                      "Akku entfernen",
                      `„${b.name}" wirklich löschen? Bereits gespeicherte Flugeinträge bleiben erhalten.`,
                      [
                        { text: "Abbrechen", style: "cancel" },
                        {
                          text: "Löschen",
                          style: "destructive",
                          onPress: () => setBatteries((prev) => prev.filter((x) => x.id !== b.id)),
                        },
                      ],
                    );
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.batteryIconBtn, pressed && { opacity: 0.6 }]}
                >
                  <Feather name="trash-2" size={16} color={theme.statusNoGo} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </Card>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: Spacing.lg }]}>DROHNEN-STATUS</ThemedText>

      {needsEid ? (
        <Card style={styles.checkCard}>
          <Checkbox
            checked={compliance.eIdLabeledOnDrone}
            onPress={() => updateCompliance("eIdLabeledOnDrone", !compliance.eIdLabeledOnDrone)}
            label="e-ID auf der Drohne angebracht"
          />
          <ThemedText style={[styles.checkHint, { color: theme.statusNoGo }]}>Pflicht</ThemedText>
        </Card>
      ) : null}

      {needsRemoteId ? (
        <Card style={styles.checkCard}>
          <Checkbox
            checked={compliance.remoteIdConfigured}
            onPress={() => updateCompliance("remoteIdConfigured", !compliance.remoteIdConfigured)}
            label="Remote-ID konfiguriert"
          />
          <ThemedText style={[styles.checkHint, { color: theme.statusNoGo }]}>Pflicht</ThemedText>
        </Card>
      ) : null}

      <Card style={[styles.checkCard, { backgroundColor: theme.backgroundSecondary }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
          <Feather name="info" size={14} color={theme.textTertiary} />
          <ThemedText style={[styles.checkHint, { color: theme.textTertiary, flex: 1 }]}>
            Versicherung, LBA-Registrierung und Kompetenznachweise werden im Pilotenprofil verwaltet.
          </ThemedText>
        </View>
      </Card>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary, marginTop: Spacing.lg }]}>
        LÄNDERSPEZIFISCHE DOKUMENTE
      </ThemedText>

      <ThemedText style={[styles.subsectionLabel, { color: theme.text, marginTop: Spacing.md }]}>
        AlphaTango-Registrierung (Frankreich)
      </ThemedText>
      <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginBottom: Spacing.sm }]}>
        {mtomGrams >= 800
          ? "Pflicht in FR ab MTOM 800 g – Bestätigung/QR der DGAC hier hinterlegen."
          : "Nur in Frankreich nötig (ab 800 g MTOM oder mit Kamera ohne Spielzeug-Status)."}
      </ThemedText>
      <TextInput disableFullscreenUI
        testID="drone-input-alphatango-id"
        style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text, marginBottom: Spacing.sm }]}
        placeholder="AlphaTango-Nummer (z.B. UAS-FR-XXXXXX)"
        placeholderTextColor={theme.textTertiary}
        value={alphaTangoId}
        onChangeText={setAlphaTangoId}
        autoCapitalize="characters"
      />
      <TextInput disableFullscreenUI
        testID="drone-input-alphatango-expiry"
        style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text, marginBottom: Spacing.sm }]}
        placeholder="Ablaufdatum AlphaTango (TT.MM.JJJJ)"
        placeholderTextColor={theme.textTertiary}
        value={alphaTangoExpirationDate}
        onChangeText={setAlphaTangoExpirationDate}
        keyboardType="numbers-and-punctuation"
      />
      <DocumentField
        testID="drone-alphatango-doc"
        label="AlphaTango-Bestätigung (PDF/Foto)"
        document={alphaTangoDocument}
        onChange={setAlphaTangoDocument}
      />

      <ThemedText style={[styles.subsectionLabel, { color: theme.text, marginTop: Spacing.lg }]}>
        D-Flight QR-Code (Italien)
      </ThemedText>
      <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginBottom: Spacing.sm }]}>
        Pflicht in IT — kostenpflichtiger QR-Code (~ 6 EUR) von d-flight.it, sichtbar an der Drohne anbringen.
      </ThemedText>
      <DocumentField
        testID="drone-dflight-doc"
        label="D-Flight-Bestätigung (PDF/Foto)"
        document={dflightDocument}
        onChange={setDflightDocument}
      />

      {/*
        Hersteller-Limits werden zur Laufzeit aus dem Preset (Hersteller +
        Modell oder Drohnen-Name) ermittelt. Sobald der Pilot einen Wert
        ändert, zeigen wir den Hersteller-Originalwert klein darunter an
        und blenden eine "Zurücksetzen"-Aktion ein, damit nichts versehentlich
        verloren geht.
      */}
      {(() => {
        const matchedPreset = findPresetForDrone(name, manufacturer, model);
        const presetLimits = matchedPreset ? getPresetLimits(matchedPreset) : null;
        const presetDiffers = (key: keyof WeatherLimits) =>
          !!presetLimits && Math.abs((limits[key] as number) - (presetLimits[key] as number)) > 0.001;
        const anyDiffers = !!presetLimits && (
          presetDiffers("maxWind") || presetDiffers("maxGusts") || presetDiffers("minTemp")
        );
        const formatPresetWind = (v: number) =>
          settings?.windUnit === "km/h" ? (v * 3.6).toFixed(1) : String(v);
        const resetToManufacturer = () => {
          if (!presetLimits) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setLimits(presetLimits);
        };
        return (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: Spacing.lg, marginBottom: Spacing.xs }}>
              <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>WETTERGRENZEN</ThemedText>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {presetLimits && anyDiffers ? (
                  <Pressable
                    testID="drone-limits-reset"
                    onPress={resetToManufacturer}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 4,
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
                      backgroundColor: theme.backgroundSecondary,
                    }}
                  >
                    <Feather name="rotate-ccw" size={12} color={theme.primary} />
                    <ThemedText style={{ fontSize: 12, fontWeight: "600", color: theme.primary }}>
                      Hersteller-Limits
                    </ThemedText>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setCustomLimitsEnabled((v) => !v);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
                    backgroundColor: customLimitsEnabled ? theme.primary + "22" : theme.backgroundSecondary }}
                >
                  <Feather name={customLimitsEnabled ? "unlock" : "lock"} size={12} color={customLimitsEnabled ? theme.primary : theme.textTertiary} />
                  <ThemedText style={{ fontSize: 12, fontWeight: "600", color: customLimitsEnabled ? theme.primary : theme.textTertiary }}>
                    {customLimitsEnabled ? "Angepasst" : "Anpassen"}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
            <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginBottom: Spacing.md }]}>
              {customLimitsEnabled
                ? "Abweichend vom Hersteller – eigene Limits werden für die Bewertung verwendet."
                : "Herstellerwerte aus dem technischen Datenblatt. Tippe auf \"Anpassen\" um eigene Limits zu setzen."}
            </ThemedText>

            <Card style={styles.limitCard}>
              <View style={styles.limitRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.limitLabel}>Max. Wind</ThemedText>
                  {presetDiffers("maxWind") ? (
                    <ThemedText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
                      Hersteller: {formatPresetWind(presetLimits!.maxWind)} {getWindUnit()}
                    </ThemedText>
                  ) : null}
                  {limits.maxWind > 0 ? (
                    <ThemedText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }} testID="text-wind-beaufort">
                      Bft {beaufortLevel(limits.maxWind).bft} · Warnung ab {convertWindForDisplay(Number(warnThresholdMs(limits.maxWind).toFixed(1)))} {getWindUnit()} ({Math.round(WIND_WARN_FRACTION * 100)} %)
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.inputRow}>
                  {customLimitsEnabled ? (
                    <TextInput disableFullscreenUI
                      style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                      value={convertWindForDisplay(limits.maxWind)}
                      onChangeText={(v) => setLimits(prev => ({ ...prev, maxWind: parseWindFromInput(v) }))}
                      keyboardType="numeric"
                    />
                  ) : (
                    <View style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, justifyContent: "center", alignItems: "center" }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: "600", color: theme.textSecondary }}>{convertWindForDisplay(limits.maxWind)}</ThemedText>
                    </View>
                  )}
                  <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>{getWindUnit()}</ThemedText>
                </View>
              </View>
            </Card>

            <Card style={styles.limitCard}>
              <View style={styles.limitRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.limitLabel}>Max. Böen</ThemedText>
                  {presetDiffers("maxGusts") ? (
                    <ThemedText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
                      Hersteller: {formatPresetWind(presetLimits!.maxGusts)} {getWindUnit()}
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.inputRow}>
                  {customLimitsEnabled ? (
                    <TextInput disableFullscreenUI
                      style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                      value={convertWindForDisplay(limits.maxGusts)}
                      onChangeText={(v) => setLimits(prev => ({ ...prev, maxGusts: parseWindFromInput(v) }))}
                      keyboardType="numeric"
                    />
                  ) : (
                    <View style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, justifyContent: "center", alignItems: "center" }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: "600", color: theme.textSecondary }}>{convertWindForDisplay(limits.maxGusts)}</ThemedText>
                    </View>
                  )}
                  <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>{getWindUnit()}</ThemedText>
                </View>
              </View>
            </Card>

            <Card style={styles.limitCard}>
              <View style={styles.limitRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.limitLabel}>Min. Temperatur</ThemedText>
                  {presetDiffers("minTemp") ? (
                    <ThemedText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
                      Hersteller: {presetLimits!.minTemp} °C
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.inputRow}>
                  {customLimitsEnabled ? (
                    <TextInput disableFullscreenUI
                      style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                      value={String(limits.minTemp)}
                      onChangeText={(v) => updateLimit("minTemp", v)}
                      keyboardType="numeric"
                    />
                  ) : (
                    <View style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, justifyContent: "center", alignItems: "center" }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: "600", color: theme.textSecondary }}>{limits.minTemp}</ThemedText>
                    </View>
                  )}
                  <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>°C</ThemedText>
                </View>
              </View>
            </Card>

            <Card style={styles.limitCard}>
              <View style={styles.limitRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.limitLabel}>Max. Temperatur</ThemedText>
                  {presetDiffers("maxTemp") ? (
                    <ThemedText style={{ fontSize: 11, color: theme.textTertiary, marginTop: 2 }}>
                      Hersteller: {presetLimits!.maxTemp} °C
                    </ThemedText>
                  ) : null}
                </View>
                <View style={styles.inputRow}>
                  {customLimitsEnabled ? (
                    <TextInput disableFullscreenUI
                      style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
                      value={String(limits.maxTemp ?? 40)}
                      onChangeText={(v) => updateLimit("maxTemp", v)}
                      keyboardType="numeric"
                    />
                  ) : (
                    <View style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, justifyContent: "center", alignItems: "center" }]}>
                      <ThemedText style={{ fontSize: 15, fontWeight: "600", color: theme.textSecondary }}>{limits.maxTemp ?? 40}</ThemedText>
                    </View>
                  )}
                  <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>°C</ThemedText>
                </View>
              </View>
            </Card>
          </>
        );
      })()}

      <View style={styles.buttonRow}>
        <Button
          title={isEditing ? "Speichern" : "Drohne anlegen"}
          onPress={handleSave}
          disabled={saving}
          loading={saving}
          style={{ flex: 1 }}
        />
      </View>

      <Modal
        visible={batteryEditor.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setBatteryEditor((p) => ({ ...p, visible: false }))}
      >
        <Pressable
          style={styles.batteryModalOverlay}
          onPress={() => setBatteryEditor((p) => ({ ...p, visible: false }))}
        >
          <Pressable style={[styles.batteryModalContent, { backgroundColor: theme.backgroundSecondary }]}>
            <ThemedText style={{ ...Typography.h4, marginBottom: Spacing.md }}>
              {batteryEditor.editingId ? "Akku bearbeiten" : "Neuen Akku anlegen"}
            </ThemedText>
            <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>NAME</ThemedText>
            <TextInput disableFullscreenUI
              testID="battery-input-name"
              style={[styles.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
              placeholder="z.B. Akku #1"
              placeholderTextColor={theme.textTertiary}
              value={batteryEditor.name}
              onChangeText={(t) => setBatteryEditor((p) => ({ ...p, name: t }))}
            />
            <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>SERIENNUMMER</ThemedText>
            <TextInput disableFullscreenUI
              testID="battery-input-serial"
              style={[styles.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
              placeholder="z.B. DJI-BAT-12345"
              placeholderTextColor={theme.textTertiary}
              value={batteryEditor.serial}
              onChangeText={(t) => setBatteryEditor((p) => ({ ...p, serial: t }))}
              autoCapitalize="characters"
            />
            <View style={{ flexDirection: "row", gap: Spacing.md, marginTop: Spacing.md }}>
              <Button
                title="Abbrechen"
                variant="secondary"
                onPress={() => setBatteryEditor((p) => ({ ...p, visible: false }))}
                style={{ flex: 1 }}
              />
              <Button
                title="Speichern"
                testID="battery-save-button"
                onPress={() => {
                  const trimmedName = batteryEditor.name.trim();
                  if (!trimmedName) {
                    Alert.alert("Fehler", "Bitte einen Namen für den Akku angeben.");
                    return;
                  }
                  const trimmedSerial = batteryEditor.serial.trim();
                  if (!trimmedSerial) {
                    Alert.alert("Fehler", "Bitte eine Seriennummer für den Akku angeben.");
                    return;
                  }
                  if (batteryEditor.editingId) {
                    setBatteries((prev) =>
                      prev.map((b) =>
                        b.id === batteryEditor.editingId
                          ? { ...b, name: trimmedName, serialNumber: trimmedSerial }
                          : b,
                      ),
                    );
                  } else {
                    const newBattery: DroneBattery = {
                      id: `bat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      name: trimmedName,
                      serialNumber: trimmedSerial,
                      createdAt: new Date().toISOString(),
                    };
                    setBatteries((prev) => [...prev, newBattery]);
                  }
                  setBatteryEditor({ visible: false, editingId: null, name: "", serial: "" });
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAwareScrollViewCompat>
    );
  };

  const needsEid = classMark !== "C0" || mtomGrams >= 250 || hasCameraOrSensor;
  const needsRemoteId = classMark === "C1" || classMark === "C2" || classMark === "C3";

  return (
    <ThemedView
      style={[
        styles.container,
        { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom },
      ]}
    >
      {step === "select" && renderSelectStep()}
      {step === "details" && !loadingDrone && renderDetailsStep()}
      {step === "details" && loadingDrone && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={theme.primary} />
          <ThemedText style={[styles.loadingLabel, { color: theme.textSecondary }]}>
            Drohne wird geladen…
          </ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
  },
  loadingLabel: {
    fontSize: Typography.body.fontSize,
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    // Tab-Leiste liegt im Layout-Fluss → nur noch Luft für das letzte Feld
    paddingBottom: Spacing["4xl"],
  },
  stepTitle: {
    ...Typography.h2,
    marginBottom: Spacing.sm,
  },
  stepDescription: {
    ...Typography.body,
    marginBottom: Spacing.xl,
  },
  searchInput: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
    marginBottom: Spacing.lg,
  },
  presetList: {
    flex: 1,
  },
  presetImage: { width: 48, height: 48, alignItems: "center", justifyContent: "center", marginRight: Spacing.md },
  detailsHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.lg },
  detailsImage: { width: 92, height: 92, borderRadius: 16, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  presetCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  presetInfo: {
    flex: 1,
  },
  presetName: {
    ...Typography.body,
    fontWeight: "600",
  },
  presetDetails: {
    ...Typography.small,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  sectionLabel: {
    ...Typography.caption,
    fontWeight: "600",
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  subsectionLabel: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  input: {
    height: Spacing.inputHeight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.lg,
    ...Typography.body,
  },
  row: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  halfInput: {
    flex: 1,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  numberInput: {
    width: 100,
    textAlign: "center",
  },
  unitLabel: {
    ...Typography.body,
    minWidth: 40,
  },
  classButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  classButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  classButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  typeButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  typeButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  typeButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  checkCard: {
    padding: Spacing.lg,
    marginTop: Spacing.lg,
  },
  checkHint: {
    ...Typography.caption,
    marginTop: 4,
    paddingLeft: 28,
  },
  ndChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ndChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
  },
  ndKitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
  },
  batteryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  batteryAddButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  batteryAddText: { ...Typography.small, fontWeight: "600" },
  batteryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
  batteryIconBtn: {
    padding: 6,
  },
  batteryModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  batteryModalContent: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },
  complianceCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  complianceHint: {
    ...Typography.caption,
    fontWeight: "600",
    flexShrink: 0,
  },
  limitCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  limitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  limitLabel: {
    ...Typography.body,
  },
  limitInput: {
    width: 80,
    height: 40,
    borderRadius: BorderRadius.xs,
    textAlign: "center",
    ...Typography.body,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing["2xl"],
  },
});
