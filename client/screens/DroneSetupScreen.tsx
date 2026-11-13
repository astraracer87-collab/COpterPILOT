import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  FlatList,
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
} from "@/lib/storage";
import {
  ALL_PRESETS,
  searchPresets,
  getPresetLimits,
  getDefaultCategoryForPreset,
  DronePreset,
  DRONE_CLASS_INFO,
  DRONE_TYPE_INFO,
} from "@/lib/dronePresets";
import * as Haptics from "expo-haptics";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type RouteParams = RouteProp<SettingsStackParamList, "DroneSetup">;

type SetupStep = "select" | "details" | "compliance" | "limits";

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
  const [classMark, setClassMark] = useState<DroneClass>("C0");
  const [mtomGrams, setMtomGrams] = useState(249);
  const [hasCameraOrSensor, setHasCameraOrSensor] = useState(true);
  const [hasRemoteId, setHasRemoteId] = useState(false);
  const [altitudeLocked120m, setAltitudeLocked120m] = useState(false);
  const [droneType, setDroneType] = useState<DroneType>("standard");
  const [openCategory, setOpenCategory] = useState<OpenCategory>("A1");
  const [compliance, setCompliance] = useState<DroneCompliance>(DEFAULT_COMPLIANCE);
  const [limits, setLimits] = useState<WeatherLimits>(getDefaultLimitsForClass("C0"));
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);

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
    const drone = await getDrone(droneId);
    if (drone) {
      setName(drone.name);
      setManufacturer(drone.manufacturer || "");
      setModel(drone.model || "");
      setClassMark(drone.classMark);
      setMtomGrams(drone.mtomGrams);
      setHasCameraOrSensor(drone.hasCameraOrSensor);
      setHasRemoteId(drone.hasRemoteId ?? false);
      setAltitudeLocked120m(drone.altitudeLocked120m ?? false);
      setDroneType(drone.droneType);
      setOpenCategory(drone.openCategory);
      setCompliance(drone.compliance);
      setLimits(drone.limits);
    }
  };

  const selectPreset = (preset: DronePreset) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setName(`${preset.manufacturer} ${preset.model}`);
    setManufacturer(preset.manufacturer);
    setModel(preset.model);
    setClassMark(preset.classMark);
    setMtomGrams(preset.mtomGrams);
    setHasCameraOrSensor(preset.hasCameraOrSensor);
    setHasRemoteId(preset.hasRemoteId);
    setAltitudeLocked120m(preset.altitudeLocked120m);
    setDroneType(preset.droneType);
    setLimits(getPresetLimits(preset));
    setOpenCategory(getDefaultCategoryForPreset(preset));
    setStep("details");
  };

  const selectManual = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep("details");
  };

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
          classMark,
          mtomGrams,
          hasCameraOrSensor,
          hasRemoteId,
          altitudeLocked120m,
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
          classMark,
          mtomGrams,
          hasCameraOrSensor,
          hasRemoteId,
          altitudeLocked120m,
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

      <TextInput
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
          <Pressable onPress={selectManual} style={({ pressed }) => pressed && styles.pressed}>
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

  const renderDetailsStep = () => (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <ThemedText style={styles.stepTitle}>
        {isEditing ? "Drohne bearbeiten" : "Details eingeben"}
      </ThemedText>

      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>NAME</ThemedText>
      <TextInput
        style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
        placeholder="z.B. DJI Mini 4 Pro"
        placeholderTextColor={theme.textTertiary}
        value={name}
        onChangeText={setName}
      />

      <View style={styles.row}>
        <View style={styles.halfInput}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>HERSTELLER</ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
            placeholder="z.B. DJI"
            placeholderTextColor={theme.textTertiary}
            value={manufacturer}
            onChangeText={setManufacturer}
          />
        </View>
        <View style={styles.halfInput}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>MODELL</ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
            placeholder="z.B. Mini 4 Pro"
            placeholderTextColor={theme.textTertiary}
            value={model}
            onChangeText={setModel}
          />
        </View>
      </View>

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
        <TextInput
          style={[styles.input, styles.numberInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
          value={String(mtomGrams)}
          onChangeText={(v) => setMtomGrams(parseInt(v) || 0)}
          keyboardType="numeric"
        />
        <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>Gramm</ThemedText>
      </View>

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
          label="Kamera / Sensor fur personenbezogene Daten"
        />
      </Card>

      <Card style={styles.checkCard}>
        <Checkbox
          checked={hasRemoteId}
          onPress={() => setHasRemoteId(!hasRemoteId)}
          label="EU Remote-ID integriert"
        />
        <ThemedText style={[styles.checkHint, { color: theme.textTertiary }]}>
          Remote-ID ist ab 2024 fur C1-C3 Pflicht
        </ThemedText>
      </Card>

      <Card style={styles.checkCard}>
        <Checkbox
          checked={altitudeLocked120m}
          onPress={() => setAltitudeLocked120m(!altitudeLocked120m)}
          label="Hohe auf 120 m begrenzt (Firmware)"
        />
        <ThemedText style={[styles.checkHint, { color: theme.textTertiary }]}>
          Firmware-Lock auf max. 120 m AGL
        </ThemedText>
      </Card>

      <View style={styles.buttonRow}>
        <Button
          title="Weiter zu Drohnen-Status"
          onPress={() => setStep("compliance")}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );

  const needsEid = classMark !== "C0" || mtomGrams >= 250 || hasCameraOrSensor;
  const needsRemoteId = classMark === "C1" || classMark === "C2" || classMark === "C3";
  const needsSpotter = droneType === "fpv_only";
  const optionalSpotter = droneType === "hybrid_fpv";

  const renderComplianceStep = () => (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <ThemedText style={styles.stepTitle}>Drohnen-Status</ThemedText>
      <ThemedText style={[styles.stepDescription, { color: theme.textSecondary }]}>
        Bestätige die drohnenspezifischen Anforderungen für {classMark === "legacy" ? "deine Drohne" : `Klasse ${classMark}`}.
      </ThemedText>

      {needsEid ? (
        <Card style={styles.complianceCard}>
          <Checkbox
            checked={compliance.eIdLabeledOnDrone}
            onPress={() => updateCompliance("eIdLabeledOnDrone", !compliance.eIdLabeledOnDrone)}
            label="e-ID auf der Drohne angebracht"
          />
          <ThemedText style={[styles.complianceHint, { color: theme.statusNoGo }]}>
            Pflicht
          </ThemedText>
        </Card>
      ) : null}

      {needsRemoteId ? (
        <Card style={styles.complianceCard}>
          <Checkbox
            checked={compliance.remoteIdConfigured}
            onPress={() => updateCompliance("remoteIdConfigured", !compliance.remoteIdConfigured)}
            label="Remote-ID konfiguriert"
          />
          <ThemedText style={[styles.complianceHint, { color: theme.statusNoGo }]}>
            Pflicht
          </ThemedText>
        </Card>
      ) : null}

      {needsSpotter ? (
        <Card style={styles.complianceCard}>
          <Checkbox
            checked={compliance.spotterConfirmed || false}
            onPress={() => updateCompliance("spotterConfirmed", !compliance.spotterConfirmed)}
            label="Spotter verfügbar (FPV-Flug)"
          />
          <ThemedText style={[styles.complianceHint, { color: theme.statusNoGo }]}>
            Pflicht (FPV)
          </ThemedText>
        </Card>
      ) : null}

      {optionalSpotter ? (
        <Card style={styles.complianceCard}>
          <Checkbox
            checked={compliance.spotterConfirmed || false}
            onPress={() => updateCompliance("spotterConfirmed", !compliance.spotterConfirmed)}
            label="Spotter verfügbar (nur bei FPV-Flug)"
          />
          <ThemedText style={[styles.complianceHint, { color: theme.statusCaution }]}>
            Optional
          </ThemedText>
        </Card>
      ) : null}

      <Card style={[styles.complianceCard, { backgroundColor: theme.backgroundSecondary }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
          <Feather name="info" size={14} color={theme.textTertiary} />
          <ThemedText style={[styles.complianceHint, { color: theme.textTertiary, flex: 1 }]}>
            Versicherung, LBA-Registrierung und Kompetenznachweise werden im Pilotenprofil verwaltet.
          </ThemedText>
        </View>
      </Card>

      <View style={styles.buttonRow}>
        <Button
          title="Zurück"
          onPress={() => setStep("details")}
          variant="secondary"
          style={{ flex: 1 }}
        />
        <Button
          title="Weiter zu Limits"
          onPress={() => setStep("limits")}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );

  const renderLimitsStep = () => (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <ThemedText style={styles.stepTitle}>Wettergrenzen</ThemedText>
      <ThemedText style={[styles.stepDescription, { color: theme.textSecondary }]}>
        Diese Werte stammen aus den technischen Datenblättern. Wind- und Böenlimits sind drohnenspezifisch.
      </ThemedText>

      <Card style={styles.limitCard}>
        <View style={styles.limitRow}>
          <ThemedText style={styles.limitLabel}>Max. Wind</ThemedText>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
              value={convertWindForDisplay(limits.maxWind)}
              onChangeText={(v) => setLimits(prev => ({ ...prev, maxWind: parseWindFromInput(v) }))}
              keyboardType="numeric"
            />
            <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>{getWindUnit()}</ThemedText>
          </View>
        </View>
      </Card>

      <Card style={styles.limitCard}>
        <View style={styles.limitRow}>
          <ThemedText style={styles.limitLabel}>Max. Böen</ThemedText>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
              value={convertWindForDisplay(limits.maxGusts)}
              onChangeText={(v) => setLimits(prev => ({ ...prev, maxGusts: parseWindFromInput(v) }))}
              keyboardType="numeric"
            />
            <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>{getWindUnit()}</ThemedText>
          </View>
        </View>
      </Card>

      <Card style={styles.limitCard}>
        <View style={styles.limitRow}>
          <ThemedText style={styles.limitLabel}>Min. Temperatur</ThemedText>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.limitInput, { backgroundColor: theme.backgroundSecondary, color: theme.text }]}
              value={String(limits.minTemp)}
              onChangeText={(v) => updateLimit("minTemp", v)}
              keyboardType="numeric"
            />
            <ThemedText style={[styles.unitLabel, { color: theme.textSecondary }]}>°C</ThemedText>
          </View>
        </View>
      </Card>


      <View style={styles.buttonRow}>
        <Button
          title="Zurück"
          onPress={() => setStep("compliance")}
          variant="secondary"
          style={{ flex: 1 }}
        />
        <Button
          title={isEditing ? "Speichern" : "Drohne anlegen"}
          onPress={handleSave}
          disabled={saving}
          loading={saving}
          style={{ flex: 1 }}
        />
      </View>
    </ScrollView>
  );

  return (
    <ThemedView
      style={[
        styles.container,
        { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100 },
      ]}
    >
      {step === "select" && renderSelectStep()}
      {step === "details" && renderDetailsStep()}
      {step === "compliance" && renderComplianceStep()}
      {step === "limits" && renderLimitsStep()}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
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
