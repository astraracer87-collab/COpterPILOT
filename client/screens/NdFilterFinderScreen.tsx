import { openLink } from "@/lib/webBrowser";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, Modal } from "react-native";
import { HeaderButton } from "@react-navigation/elements";
import Slider from "@react-native-community/slider";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getDrones, type DroneProfile } from "@/lib/storage";
import { FeatureLockCard, useFeatureAccess } from "@/components/FeatureGate";
import {
  ALL_PRESETS,
  findPresetForDrone,
  type DronePreset,
  type CameraSpec,
} from "@/lib/dronePresets";
import {
  SHUTTER_FPS_OPTIONS,
  SHUTTER_ANGLES,
  type ShutterAngle,
  MANUAL_SHUTTER_DENOMS,
  recommendNd,
  estimateEv,
  shutterDenomFromEv,
  snapShutterDenom,
  classifySky,
  sunElevationDeg,
  SKY_LABEL_DE,
  type ShutterFps,
} from "@/lib/ndFilter";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { getCinematicSettingsForModel } from "@/lib/droneCinematicSettings";
import type { NdFilterStackParamList } from "@/navigation/NdFilterStackNavigator";

type RouteParams = RouteProp<NdFilterStackParamList, "NdFilterFinder">;
type NavigationProp = NativeStackNavigationProp<NdFilterStackParamList>;

type Mode = "manual" | "auto";

interface DroneOption {
  key: string;
  label: string;
  preset: DronePreset;
  source: "profile" | "preset";
}

export default function NdFilterFinderScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const hasNdFilter = useFeatureAccess("nd_filter");

  const [loading, setLoading] = useState(true);
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [selectedDroneKey, setSelectedDroneKey] = useState<string | null>(null);
  const [fps, setFps] = useState<ShutterFps>(24);
  const [shutterAngle, setShutterAngle] = useState<ShutterAngle>(180);
  const [shutterAngleUserSet, setShutterAngleUserSet] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");
  const [manualDenom, setManualDenom] = useState(1000);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraPickerOpen, setCameraPickerOpen] = useState(false);
  const [selectedCameraIndex, setSelectedCameraIndex] = useState(0);
  const [infoVisible, setInfoVisible] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton onPress={() => setInfoVisible(true)} accessibilityLabel="Hilfe zum ND-Filter">
          <Feather name="help-circle" size={22} color={theme.primary} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme.primary]);

  const params = route.params ?? {};

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getDrones();
        if (cancelled) return;
        setDrones(list);
        if (params.droneId) {
          const d = list.find((x) => x.id === params.droneId);
          if (d) setSelectedDroneKey(`profile:${d.id}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.droneId]);

  const droneOptions: DroneOption[] = useMemo(() => {
    const opts: DroneOption[] = [];
    for (const d of drones) {
      const preset = findPresetForDrone(d.name, d.manufacturer, d.model);
      if (preset) {
        opts.push({ key: `profile:${d.id}`, label: `${d.name} (Profil)`, preset, source: "profile" });
      }
    }
    if (opts.length === 0) {
      for (const p of ALL_PRESETS) {
        if (!p.apertureValue) continue;
        opts.push({ key: `preset:${p.manufacturer}-${p.model}`, label: `${p.manufacturer} ${p.model}`, preset: p, source: "preset" });
      }
    }
    return opts;
  }, [drones]);

  const selectedOption = useMemo(
    () => droneOptions.find((o) => o.key === selectedDroneKey) ?? droneOptions[0] ?? null,
    [droneOptions, selectedDroneKey],
  );
  const basePreset = selectedOption?.preset ?? null;

  const cinematic = useMemo(
    () => getCinematicSettingsForModel(basePreset?.model ?? null, selectedOption?.label ?? null),
    [basePreset?.model, selectedOption?.label],
  );

  const openCinematic = useCallback(
    (initialView: "settings" | "moves") => {
      const droneId = selectedOption?.source === "profile"
        ? selectedOption.key.replace(/^profile:/, "")
        : undefined;
      navigation.navigate("DroneCinematic", {
        droneId,
        model: basePreset?.model,
        droneName: selectedOption?.label,
        initialView,
      });
    },
    [navigation, selectedOption, basePreset?.model],
  );

  // Kamera-Auswahl bei Multi-Cam-Drohnen zurücksetzen wenn Drohne wechselt
  useEffect(() => {
    setSelectedCameraIndex(0);
    setCameraPickerOpen(false);
  }, [selectedOption?.key]);

  const cameras: CameraSpec[] = basePreset?.cameras ?? [];
  const hasMultipleCameras = cameras.length > 1;
  const activeCamera: CameraSpec | null = hasMultipleCameras
    ? (cameras[selectedCameraIndex] ?? cameras[0])
    : null;

  // Effektives Preset: bei aktivierter Kamera-Auswahl deren Optik überlagern
  const preset: DronePreset | null = useMemo(() => {
    if (!basePreset) return null;
    if (!activeCamera) return basePreset;
    return {
      ...basePreset,
      sensor: activeCamera.sensor,
      apertureValue: activeCamera.apertureValue,
      hasVariableAperture: activeCamera.hasVariableAperture ?? false,
      fovDeg: activeCamera.fovDeg,
      focalLength35mmEquiv: activeCamera.focalLength35mmEquiv,
      filterEcosystem: activeCamera.filterEcosystem ?? basePreset.filterEcosystem,
    };
  }, [basePreset, activeCamera]);

  // Wenn der Pilot in seinem Drohnen-Profil eigene ND-Filter gepflegt hat,
  // hat sein Bestand Vorrang vor dem Hersteller-Ökosystem.
  const ownedFromProfile: string[] | null = useMemo(() => {
    if (selectedOption?.source !== "profile") return null;
    // Nur den Bestand verwenden, wenn der aktuell ausgewählte Schlüssel auch
    // tatsächlich aktiv ist (nicht stiller Fallback auf droneOptions[0]).
    if (selectedDroneKey && selectedOption.key !== selectedDroneKey) return null;
    const id = selectedOption.key.replace(/^profile:/, "");
    const drone = drones.find((d) => d.id === id);
    return drone?.ownedNdFilters && drone.ownedNdFilters.length > 0 ? drone.ownedNdFilters : null;
  }, [selectedOption, selectedDroneKey, drones]);

  const effectiveEcosystem: string[] | undefined = ownedFromProfile ?? preset?.filterEcosystem ?? undefined;

  // ─── Auto-Modus: Wetter laden ──────────────────────────────────────────────
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoCloud, setAutoCloud] = useState<number | null>(params.cloudCoverPercent ?? null);
  const [autoRain, setAutoRain] = useState<number>(params.rainMmPerH ?? 0);
  const [autoSunElev, setAutoSunElev] = useState<number | null>(null);
  const [autoLat, setAutoLat] = useState<number | null>(params.latitude ?? null);
  const [autoLon, setAutoLon] = useState<number | null>(params.longitude ?? null);
  const [autoDenom, setAutoDenom] = useState<number | null>(null);

  const refreshAuto = useCallback(async () => {
    if (!preset?.apertureValue) {
      setAutoError("Diese Drohne hat keine bekannte Blende — Auto-Modus nicht möglich.");
      return;
    }
    setAutoLoading(true);
    setAutoError(null);
    try {
      let lat = autoLat;
      let lon = autoLon;
      let cloud = autoCloud;
      let rain = autoRain;
      if (lat == null || lon == null) {
        try {
          const Loc = await import("@/lib/location");
          const perm = await Loc.requestForegroundPermissionsAsync();
          if (perm.status === "granted") {
            const pos = await Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy.Balanced });
            lat = pos.coords.latitude;
            lon = pos.coords.longitude;
            setAutoLat(lat);
            setAutoLon(lon);
          } else {
            throw new Error("Standortzugriff verweigert. Bitte Standort manuell setzen oder den Pre-Check öffnen.");
          }
        } catch (err) {
          throw new Error((err as Error).message || "Standort nicht verfügbar.");
        }
      }
      if (cloud == null) {
        try {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=cloud_cover,precipitation`;
          const res = await fetch(url);
          const json = await res.json();
          cloud = json?.current?.cloud_cover ?? 50;
          rain = json?.current?.precipitation ?? 0;
          setAutoCloud(cloud);
          setAutoRain(rain);
        } catch {
          cloud = 50;
          rain = 0;
        }
      }
      const sunElev = sunElevationDeg(lat!, lon!, new Date());
      setAutoSunElev(sunElev);
      const ev = estimateEv(cloud ?? 50, rain ?? 0, sunElev);
      const denom = snapShutterDenom(shutterDenomFromEv(ev, preset.apertureValue!));
      setAutoDenom(denom);
    } catch (err) {
      setAutoError((err as Error).message || "Auto-Schätzung fehlgeschlagen.");
    } finally {
      setAutoLoading(false);
    }
  }, [preset, autoLat, autoLon, autoCloud, autoRain]);

  useEffect(() => {
    if (mode === "auto" && autoDenom == null && !autoLoading && !autoError && preset?.apertureValue) {
      refreshAuto();
    }
  }, [mode, autoDenom, autoLoading, autoError, preset, refreshAuto]);

  // ─── Empfehlung berechnen ──────────────────────────────────────────────────
  const measuredDenom = mode === "manual" ? manualDenom : (autoDenom ?? manualDenom);
  const recommendation = useMemo(() => {
    if (!preset) return null;
    return recommendNd({
      fps,
      measuredShutterDenom: measuredDenom,
      filterEcosystem: effectiveEcosystem ?? null,
      shutterAngleDeg: shutterAngle,
    });
  }, [preset, fps, measuredDenom, effectiveEcosystem, shutterAngle]);

  // Auto-Default: bei FPV-Drohnen 270° vorbelegen, solange der Pilot
  // nicht selbst etwas anderes ausgewählt hat. Sobald er manuell tippt,
  // bleibt seine Wahl sticky (shutterAngleUserSet).
  useEffect(() => {
    if (shutterAngleUserSet) return;
    const isFpv = preset?.droneType === "fpv_only" || preset?.droneType === "hybrid_fpv";
    setShutterAngle(isFpv ? 270 : 180);
  }, [preset, shutterAngleUserSet]);

  const denomIndex = MANUAL_SHUTTER_DENOMS.indexOf(snapShutterDenom(manualDenom));
  const safeDenomIndex = denomIndex >= 0 ? denomIndex : MANUAL_SHUTTER_DENOMS.indexOf(1000);

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  if (!hasNdFilter) {
    return (
      <ThemedView style={styles.container}>
        <View style={{ paddingTop: headerHeight + Spacing.lg }}>
          <FeatureLockCard featureKey="nd_filter" />
        </View>
      </ThemedView>
    );
  }

  const skyForUi = autoCloud != null && autoSunElev != null
    ? classifySky(autoCloud, autoRain, autoSunElev)
    : null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        {/* Schritt 1 — Drohne */}
        <SectionTitle theme={theme}>1. DROHNE</SectionTitle>
        {droneOptions.length === 0 ? (
          <Card style={styles.card}>
            <ThemedText style={{ color: theme.textSecondary }}>
              Keine Drohne mit bekannten optischen Daten gefunden. Lege im Pilotenprofil
              eine DJI-Drohne an (z. B. Mini 4 Pro) oder wähle ein Preset.
            </ThemedText>
          </Card>
        ) : (
          <>
            <Pressable onPress={() => setPickerOpen((v) => !v)}>
              <Card style={styles.card}>
                <View style={styles.row}>
                  <Feather name="aperture" size={20} color={theme.primary} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={styles.rowTitle}>
                      {selectedOption?.label ?? "Drohne wählen"}
                    </ThemedText>
                    {preset ? (
                      <ThemedText style={[styles.rowSub, { color: theme.textSecondary }]}>
                        {preset.sensor ?? "—"} · ƒ/{preset.apertureValue?.toFixed(1) ?? "?"}
                        {preset.hasVariableAperture ? " (variabel)" : ""}
                        {preset.focalLength35mmEquiv ? ` · ${preset.focalLength35mmEquiv} mm` : ""}
                      </ThemedText>
                    ) : null}
                  </View>
                  <Feather name={pickerOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.textTertiary} />
                </View>
              </Card>
            </Pressable>
            {pickerOpen ? (
              <Card style={[styles.card, { marginTop: Spacing.sm, padding: 0 }]}>
                {droneOptions.map((o) => {
                  const active = o.key === selectedOption?.key;
                  return (
                    <Pressable
                      key={o.key}
                      onPress={() => { setSelectedDroneKey(o.key); setPickerOpen(false); setAutoDenom(null); }}
                      style={({ pressed }) => [
                        styles.pickerItem,
                        active ? { backgroundColor: theme.primary + "15" } : null,
                        pressed ? { opacity: 0.7 } : null,
                      ]}
                    >
                      <ThemedText style={{ flex: 1, fontWeight: active ? "700" : "500" }}>{o.label}</ThemedText>
                      {active ? <Feather name="check" size={16} color={theme.primary} /> : null}
                    </Pressable>
                  );
                })}
              </Card>
            ) : null}
            {preset?.hasVariableAperture ? (
              <Card style={[styles.hint, { backgroundColor: theme.primary + "10", marginTop: Spacing.sm }]}>
                <Feather name="info" size={14} color={theme.primary} />
                <ThemedText style={[styles.hintText, { color: theme.text }]}>
                  Diese Drohne hat eine variable Blende. Du kannst alternativ die Blende
                  schließen (z. B. ƒ/8) statt einen ND-Filter zu verwenden.
                </ThemedText>
              </Card>
            ) : null}

            {hasMultipleCameras ? (
              <>
                <SectionTitle theme={theme} mt>1B. KAMERA</SectionTitle>
                <Pressable onPress={() => setCameraPickerOpen((v) => !v)}>
                  <Card style={styles.card}>
                    <View style={styles.row}>
                      <Feather name="camera" size={20} color={theme.primary} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={styles.rowTitle}>
                          {activeCamera?.name ?? "Kamera wählen"}
                        </ThemedText>
                        {activeCamera ? (
                          <ThemedText style={[styles.rowSub, { color: theme.textSecondary }]}>
                            {activeCamera.sensor} · ƒ/{activeCamera.apertureValue.toFixed(1)}
                            {activeCamera.hasVariableAperture ? " (variabel)" : ""}
                            {activeCamera.focalLength35mmEquiv ? ` · ${activeCamera.focalLength35mmEquiv} mm` : ""}
                          </ThemedText>
                        ) : null}
                      </View>
                      <Feather name={cameraPickerOpen ? "chevron-up" : "chevron-down"} size={18} color={theme.textTertiary} />
                    </View>
                  </Card>
                </Pressable>
                {cameraPickerOpen ? (
                  <Card style={[styles.card, { marginTop: Spacing.sm, padding: 0 }]}>
                    {cameras.map((cam, idx) => {
                      const active = idx === selectedCameraIndex;
                      return (
                        <Pressable
                          key={`${cam.name}-${idx}`}
                          onPress={() => { setSelectedCameraIndex(idx); setCameraPickerOpen(false); setAutoDenom(null); }}
                          style={({ pressed }) => [
                            styles.pickerItem,
                            active ? { backgroundColor: theme.primary + "15" } : null,
                            pressed ? { opacity: 0.7 } : null,
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <ThemedText style={{ fontWeight: active ? "700" : "500" }}>{cam.name}</ThemedText>
                            <ThemedText style={[styles.rowSub, { color: theme.textTertiary }]}>
                              {cam.sensor} · ƒ/{cam.apertureValue.toFixed(1)}
                              {cam.focalLength35mmEquiv ? ` · ${cam.focalLength35mmEquiv} mm` : ""}
                            </ThemedText>
                          </View>
                          {active ? <Feather name="check" size={16} color={theme.primary} /> : null}
                        </Pressable>
                      );
                    })}
                  </Card>
                ) : null}
              </>
            ) : null}
          </>
        )}

        {droneOptions.length > 0 ? (
          <Card style={[styles.card, { marginTop: Spacing.sm, padding: 0 }]}>
            {cinematic ? (
              <Pressable
                onPress={() => openCinematic("settings")}
                style={({ pressed }) => [styles.cineRow, pressed ? { opacity: 0.7 } : null]}
                testID="button-cinematic-settings"
              >
                <Feather name="film" size={18} color={theme.primary} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.rowTitle}>Cinematic-Einstellungen</ThemedText>
                  <ThemedText style={[styles.rowSub, { color: theme.textSecondary }]} numberOfLines={1}>
                    Empfohlene Kamera- & Tuning-Werte für {cinematic.displayName}
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={18} color={theme.textTertiary} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => openCinematic("moves")}
              style={({ pressed }) => [
                styles.cineRow,
                cinematic ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null,
                pressed ? { opacity: 0.7 } : null,
              ]}
              testID="button-cinematic-moves"
            >
              <Feather name="navigation" size={18} color={theme.primary} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.rowTitle}>Flugmanöver für Einsteiger</ThemedText>
                <ThemedText style={[styles.rowSub, { color: theme.textSecondary }]} numberOfLines={1}>
                  10 cinematische Moves — für jede Drohne
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={18} color={theme.textTertiary} />
            </Pressable>
          </Card>
        ) : null}

        {/* Schritt 2 — Ziel-FPS */}
        <SectionTitle theme={theme} mt>2. ZIEL-FRAMERATE</SectionTitle>
        <Card style={styles.card}>
          <View style={styles.fpsRow}>
            {SHUTTER_FPS_OPTIONS.map((f) => {
              const active = fps === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => setFps(f)}
                  style={[
                    styles.fpsChip,
                    {
                      backgroundColor: active ? theme.primary : theme.backgroundSecondary,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                >
                  <ThemedText style={{ color: active ? "#fff" : theme.text, fontWeight: "700" }}>{f}</ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText style={[styles.targetShutter, { color: theme.textSecondary }]}>
            Zielshutter ({shutterAngle === 180 ? "180°-Regel" : `${shutterAngle}°-Shutter`}): <ThemedText style={{ fontWeight: "700", color: theme.text }}>1/{Math.round((fps * 360) / shutterAngle)} s</ThemedText>
          </ThemedText>

          <ThemedText style={[styles.checkHint, { color: theme.textSecondary, marginTop: Spacing.sm, fontWeight: "600" }]}>
            Shutter-Winkel (Motion-Blur-Stil):
          </ThemedText>
          <View style={[styles.fpsRow, { marginTop: 4 }]}>
            {SHUTTER_ANGLES.map((a) => {
              const active = shutterAngle === a;
              const label = a === 180 ? "180° Cinematic" : a === 270 ? "270° FPV-Look" : "360° Max-Blur";
              return (
                <Pressable
                  key={a}
                  onPress={() => {
                    setShutterAngle(a);
                    setShutterAngleUserSet(true);
                  }}
                  style={[
                    styles.fpsChip,
                    {
                      backgroundColor: active ? theme.primary : theme.backgroundSecondary,
                      borderColor: active ? theme.primary : theme.border,
                    },
                  ]}
                  testID={`shutter-angle-${a}`}
                >
                  <ThemedText style={{ color: active ? "#fff" : theme.text, fontWeight: "700", fontSize: 12 }}>{label}</ThemedText>
                </Pressable>
              );
            })}
          </View>
          {shutterAngle !== 180 ? (
            <ThemedText style={[styles.checkHint, { color: theme.textTertiary, marginTop: 4 }]}>
              {shutterAngle === 270
                ? "+0.6 Stops dunkler als 180° — stärkeres ND nötig. Kaschiert Vibrationen und Prop-Wash, typischer FPV-Freestyle-Look."
                : "+1.0 Stops dunkler als 180° — maximaler Blur, nur für sehr ruhige Schwenks geeignet."}
            </ThemedText>
          ) : null}
          {(() => {
            const isFpv = preset?.droneType === "fpv_only" || preset?.droneType === "hybrid_fpv";
            let title: string | null = null;
            let body: string | null = null;
            if (isFpv && fps <= 30) {
              title = "FPV mit Cine-Framerate";
              body = "Schnelle Kurven und Dives wirken bei 24/25/30 fps oft ruckelig oder zerreissen. Für FPV werden 50/60 fps (flüssig) oder 120 fps (Slow-Mo) empfohlen.";
            } else if (!isFpv && fps >= 60) {
              title = "Action-Look";
              body = "Sehr flüssig — ideal für Sport, B-Roll oder spätere Zeitlupe. Für epische Landschafts- oder Cinematic-Shots erzeugen 24/25 fps den natürlicheren Kino-Look.";
            } else if (fps === 120) {
              title = "Super Slow-Mo (120 fps)";
              body = "Zielshutter 1/240 s — die Kamera schluckt von Natur aus viel Licht. Oft reicht ein schwacher ND oder gar keiner.";
            } else if (fps === 25) {
              title = "PAL / Europa-TV (25 fps)";
              body = "Synchron zum 50-Hz-Netz, verhindert Flackern bei Kunstlicht. Für reine Online-Inhalte tut's auch 24 oder 30 fps.";
            } else if (fps === 30) {
              title = "Web-Standard (30 fps)";
              body = "Allrounder für YouTube, Instagram, Tutorials. Wirkt nahbar und realitätsnah, dabei flüssiger als 24 fps.";
            } else if (fps === 24) {
              title = "Kino-Look (24 fps)";
              body = "Klassische Filmrate. Schwenks bewusst langsam ausführen, sonst entsteht Stottern (Judder).";
            } else if (fps === 50 || fps === 60) {
              title = "Flüssiger Look (50/60 fps)";
              body = "Gestochen scharf, ideal für Action und FPV. Im Schnitt auf 24/25 fps verlangsamt = saubere 2× Zeitlupe.";
            }
            if (!title) return null;
            const isWarn = isFpv && fps <= 30;
            return (
              <View style={[styles.hintBox, {
                backgroundColor: isWarn ? theme.statusCautionBackground : theme.backgroundSecondary,
                borderColor: isWarn ? theme.statusCaution : theme.border,
                marginTop: Spacing.sm,
              }]}>
                <Feather name={isWarn ? "alert-triangle" : "info"} size={14} color={isWarn ? theme.statusCaution : theme.primary} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.hintText, { fontWeight: "700" }]}>{title}</ThemedText>
                  <ThemedText style={[styles.hintText, { color: theme.textSecondary }]}>{body}</ThemedText>
                </View>
              </View>
            );
          })()}
        </Card>

        {/* Schritt 3 — Modus */}
        <SectionTitle theme={theme} mt>3. SHUTTER ERMITTELN</SectionTitle>
        <View style={[styles.segment, { backgroundColor: theme.backgroundSecondary }]}>
          {(["manual", "auto"] as Mode[]).map((m) => {
            const active = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[
                  styles.segmentItem,
                  active ? { backgroundColor: theme.primary } : null,
                ]}
              >
                <ThemedText style={{ color: active ? "#fff" : theme.text, fontWeight: "600" }}>
                  {m === "manual" ? "Manuell" : "Auto (Wetter)"}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {mode === "manual" ? (
          <Card style={[styles.card, { marginTop: Spacing.md }]}>
            <ThemedText style={[styles.rowSub, { color: theme.textSecondary }]}>
              Aktuelle Shutter-Speed der Drohne (ohne ND, ISO 100):
            </ThemedText>
            <ThemedText style={styles.bigShutter}>
              1/{snapShutterDenom(manualDenom)} s
            </ThemedText>
            <Slider
              style={{ width: "100%", height: 40 }}
              minimumValue={0}
              maximumValue={MANUAL_SHUTTER_DENOMS.length - 1}
              step={1}
              value={safeDenomIndex}
              onValueChange={(idx) => setManualDenom(MANUAL_SHUTTER_DENOMS[Math.round(idx)])}
              minimumTrackTintColor={theme.primary}
              maximumTrackTintColor={theme.border}
              thumbTintColor={theme.primary}
            />
            <View style={styles.sliderEnds}>
              <ThemedText style={[styles.rowSub, { color: theme.textTertiary }]}>1/100</ThemedText>
              <ThemedText style={[styles.rowSub, { color: theme.textTertiary }]}>1/16000</ThemedText>
            </View>
            {snapShutterDenom(manualDenom) < 250 ? (
              <View style={[styles.hintBox, { backgroundColor: theme.statusCautionBackground, borderColor: theme.statusCaution }]}>
                <Feather name="info" size={14} color={theme.statusCaution} style={{ marginTop: 1 }} />
                <ThemedText style={[styles.hintText, { color: theme.text }]}>
                  Niedriger Shutter (1/{snapShutterDenom(manualDenom)} s) deutet auf wenig Licht —
                  ein ND-Filter blockt zusätzliches Licht und ist hier meist unnötig.
                  Bei Dämmerung/Nacht: kein ND, stattdessen ISO/Blende anpassen.
                </ThemedText>
              </View>
            ) : null}
          </Card>
        ) : (
          <Card style={[styles.card, { marginTop: Spacing.md }]}>
            {autoLoading ? (
              <View style={{ alignItems: "center", padding: Spacing.lg }}>
                <ActivityIndicator color={theme.primary} />
                <ThemedText style={{ color: theme.textSecondary, marginTop: Spacing.sm }}>
                  Wetter & Sonnenstand werden ermittelt…
                </ThemedText>
              </View>
            ) : autoError ? (
              <>
                <ThemedText style={{ color: "#C62828" }}>{autoError}</ThemedText>
                <Button title="Erneut versuchen" variant="secondary" onPress={refreshAuto} style={{ marginTop: Spacing.md }} />
              </>
            ) : autoDenom != null && preset?.apertureValue ? (
              <>
                <View style={styles.metaGrid}>
                  <MetaItem icon="cloud" label="Bewölkung" value={`${Math.round(autoCloud ?? 0)} %`} theme={theme} />
                  <MetaItem icon="cloud-rain" label="Regen" value={`${(autoRain ?? 0).toFixed(1)} mm/h`} theme={theme} />
                  <MetaItem icon="sun" label="Sonne" value={`${autoSunElev?.toFixed(0) ?? "?"}°`} theme={theme} />
                  <MetaItem icon="aperture" label="Blende" value={`ƒ/${preset.apertureValue.toFixed(1)}`} theme={theme} />
                </View>
                {skyForUi ? (
                  <ThemedText style={[styles.rowSub, { color: theme.textSecondary, marginTop: Spacing.sm }]}>
                    Lichtbedingung: <ThemedText style={{ fontWeight: "700", color: theme.text }}>{SKY_LABEL_DE[skyForUi]}</ThemedText>
                  </ThemedText>
                ) : null}
                <ThemedText style={[styles.rowSub, { color: theme.textSecondary, marginTop: Spacing.sm }]}>
                  Geschätzter nativer Shutter (ISO 100):
                </ThemedText>
                <ThemedText style={styles.bigShutter}>1/{autoDenom} s</ThemedText>
                <Button title="Neu schätzen" variant="secondary" onPress={refreshAuto} style={{ marginTop: Spacing.md }} />
                <ThemedText style={[styles.disclaimer, { color: theme.textTertiary, marginTop: Spacing.sm }]}>
                  Schätzung über Sunny-16-Regel (ISO 100). Tatsächlicher Drohnen-Shutter
                  kann abweichen — bitte vor dem Flug am Display verifizieren.
                </ThemedText>
              </>
            ) : (
              <Button title="Wetter laden" onPress={refreshAuto} />
            )}
          </Card>
        )}

        {/* Schritt 4 — Ergebnis */}
        <SectionTitle theme={theme} mt>4. EMPFEHLUNG</SectionTitle>
        {mode === "auto" && (skyForUi === "night" || skyForUi === "twilight") ? (
          <Card style={[styles.resultCard, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: Spacing.sm }}>
              <Feather name="alert-triangle" size={20} color={theme.primary} />
              <ThemedText style={[styles.resultLabel, { color: theme.textSecondary, marginBottom: 0 }]}>
                {skyForUi === "night" ? "Nacht erkannt" : "Dämmerung erkannt"}
              </ThemedText>
            </View>
            <ThemedText style={[styles.resultBadge, { color: theme.primary }]}>Kein Filter</ThemedText>
            <ThemedText style={[styles.resultReason, { color: theme.text }]}>
              {skyForUi === "night"
                ? "Bei Nacht fehlt Licht — ein ND-Filter würde die Szene nur weiter abdunkeln. Öffne stattdessen die Blende, erhöhe ISO und nutze einen langsameren Shutter. Hinweis: Nachtflug in der Open-Kategorie nur mit grünem Blinklicht zulässig."
                : "In der Dämmerung ist meist zu wenig Licht für die 180°-Regel. Statt ND-Filter: Blende öffnen, ISO erhöhen, ggf. die Belichtungszeit über 1/Frame anheben (cinematischer Look bewusst akzeptieren)."}
            </ThemedText>
          </Card>
        ) : recommendation && preset ? (
          <Card style={[styles.resultCard, { backgroundColor: theme.backgroundSecondary }]}>
            <ThemedText style={[styles.resultLabel, { color: theme.textSecondary }]}>
              {recommendation.ndValue == null
                ? "Empfehlung"
                : recommendation.ecosystemMismatch
                  ? "Ideal / Dein bestes Filter"
                  : "Empfohlener Filter"}
            </ThemedText>

            {recommendation.ndValue == null ? (
              <ThemedText style={[styles.resultBadge, { color: theme.primary }]}>Kein Filter</ThemedText>
            ) : recommendation.ecosystemMismatch && recommendation.ecosystemPick ? (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <ThemedText style={[styles.resultBadge, { color: theme.textTertiary, fontSize: 32 }]}>
                  ND{recommendation.ndValue}
                </ThemedText>
                <Feather name="arrow-right" size={20} color={theme.textTertiary} />
                <ThemedText style={[styles.resultBadge, { color: theme.primary }]}>
                  ND{recommendation.ecosystemPick}
                </ThemedText>
              </View>
            ) : (
              <ThemedText style={[styles.resultBadge, { color: theme.primary }]}>
                ND{recommendation.ndValue}
              </ThemedText>
            )}

            <ThemedText style={[styles.resultReason, { color: theme.text }]}>
              {recommendation.reasoning}
            </ThemedText>

            {effectiveEcosystem && effectiveEcosystem.length > 0 ? (
              <View style={styles.ecoRow}>
                <ThemedText style={[styles.rowSub, { color: theme.textTertiary }]}>
                  {ownedFromProfile ? "Dein Bestand:" : "Verfügbar (Hersteller):"}
                </ThemedText>
                <View style={styles.ecoChips}>
                  {effectiveEcosystem.map((nd) => {
                    const isActive = recommendation.ecosystemPick != null && nd === `ND${recommendation.ecosystemPick}`;
                    return (
                      <View
                        key={nd}
                        style={[
                          styles.ecoChip,
                          {
                            backgroundColor: isActive ? theme.primary + "20" : "transparent",
                            borderColor: isActive ? theme.primary : theme.border,
                          },
                        ]}
                      >
                        <ThemedText style={{ color: isActive ? theme.primary : theme.textSecondary, fontWeight: "600", fontSize: 12 }}>{nd}</ThemedText>
                      </View>
                    );
                  })}
                </View>
                {!ownedFromProfile && selectedOption?.source === "profile" ? (
                  <ThemedText style={{ color: theme.textTertiary, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
                    Tipp: Pflege deinen eigenen ND-Bestand im Drohnen-Profil — dann
                    bekommst du Vorschläge passend zu deinen tatsächlich vorhandenen Filtern.
                  </ThemedText>
                ) : null}
              </View>
            ) : recommendation.ndValue != null && !ownedFromProfile && effectiveEcosystem && effectiveEcosystem.length === 0 ? (
              <View style={styles.ecoRow}>
                <ThemedText style={[styles.rowSub, { color: theme.textTertiary }]}>
                  Keine Hersteller-ND-Filter bekannt
                </ThemedText>
                <ThemedText style={{ color: theme.textTertiary, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
                  Für diese Drohne bietet der Hersteller keine passenden ND-Filter an.
                  Der obige Wert gilt als Richtwert für Drittanbieter-Filter.
                </ThemedText>
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* Footer */}
        <Pressable onPress={() => openLink("https://shuttercalculator.com/")} style={{ marginTop: Spacing.xl, alignItems: "center" }}>
          <ThemedText style={{ color: theme.textTertiary, fontSize: 11 }}>
            180°-Shutter-Regel · Werte gerundet auf Standard-ND-Filter
          </ThemedText>
        </Pressable>
      </ScrollView>

      <Modal
        visible={infoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInfoVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setInfoVisible(false)}
          />
          <View
            style={[styles.modalCard, { backgroundColor: theme.backgroundSecondary }]}
          >
            <View style={styles.modalHeader}>
              <Feather name="help-circle" size={24} color={theme.primary} />
              <ThemedText style={styles.modalTitle}>ND-Filter verstehen</ThemedText>
              <Pressable onPress={() => setInfoVisible(false)} hitSlop={10}>
                <Feather name="x" size={22} color={theme.textTertiary} />
              </Pressable>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: Spacing.md }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
            >
              <ThemedText style={styles.modalH3}>Warum überhaupt ein ND-Filter?</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Stell dir einen ND-Filter wie eine <ThemedText style={styles.modalBold}>Sonnenbrille
                für deine Drohnen-Kamera</ThemedText> vor. An einem hellen Tag trifft so viel Licht auf
                den Sensor, dass das Bild ohne Gegenmaßnahme überbelichtet wäre. Die meisten Drohnen
                (Mini- oder Air-Serie) haben eine feste Blende und können nicht „die Augen
                zusammenkneifen". Sie müssen deshalb die Belichtungszeit extrem verkürzen — genau das
                ist beim Video das Problem.
              </ThemedText>

              <ThemedText style={styles.modalH3}>Die drei Kern-Faktoren</ThemedText>

              <ThemedText style={styles.modalH4}>1. Ziel-Framerate &amp; 180°-Regel</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Das menschliche Auge ist an natürliche Bewegungsunschärfe gewöhnt. Damit Video
                flüssig „wie im Kino" wirkt, gilt die 180°-Regel: die Belichtungszeit sollte genau
                <ThemedText style={styles.modalBold}> doppelt so schnell </ThemedText>
                sein wie deine Framerate.{"\n"}
                • 24 fps → Zielshutter 1/48 s{"\n"}
                • 30 fps → Zielshutter 1/60 s{"\n"}
                • 60 fps → Zielshutter 1/120 s
              </ThemedText>

              <ThemedText style={styles.modalH4}>2. Der Shutter (Belichtungszeit)</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Ohne Filter wählt die Drohne in der Sonne oft 1/1000 s oder schneller. Das Bild ist
                richtig belichtet, aber die Bewegungsunschärfe fehlt — das Video wirkt abgehackt,
                künstlich scharf und „digital" (Soap-Opera-Effekt).
              </ThemedText>

              <ThemedText style={styles.modalH4}>3. Die „Stops" (Lichtreduktion)</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Ein „Stop" halbiert das Licht. Sagt die App dir <ThemedText style={styles.modalBold}>
                4,4 Stops</ThemedText> Reduktion, heißt das: es ist ca. 16-mal zu hell für ein
                kinoreifes Video.
              </ThemedText>

              <ThemedText style={styles.modalH3}>Framerate-Guide: Welche fps für welchen Look?</ThemedText>

              <ThemedText style={styles.modalH4}>24 / 25 fps — Kino-Look</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Optimal für <ThemedText style={styles.modalBold}>Cinematic-Drohnen</ThemedText> (Air, Mavic,
                Mini, Inspire). Erzeugt den klassischen Filmlook mit natürlicher Bewegungsunschärfe — perfekt
                für Landschaften, Hochzeiten, Doku, Musikvideos. 25 fps = PAL/Europa (50-Hz-Netz, kein
                Flackern bei Kunstlicht). Schwenks bewusst langsam — sonst Judder.{"\n"}
                Nicht geeignet für FPV-Manöver.
              </ThemedText>

              <ThemedText style={styles.modalH4}>30 fps — Web &amp; Social</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Allrounder für YouTube, Instagram-Reels, Vlogs, Tutorials, Livestreams. Etwas schärfer und
                flüssiger als 24 fps, wirkt nahbar und realitätsnah. Verdoppelt sich sauber auf
                60-Hz-Displays. Funktioniert auf jeder Drohne.
              </ThemedText>

              <ThemedText style={styles.modalH4}>50 / 60 fps — Action &amp; FPV</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Optimal für <ThemedText style={styles.modalBold}>FPV-Drohnen</ThemedText> (Avata 2, DJI FPV,
                Neo) und schnelle Sport-/B-Roll-Aufnahmen mit Cinematic-Drohnen. Gestochen scharf, absolut
                flüssig. Beim Schnitt auf 24/25 fps verlangsamt = seidenweiche 2× Slow-Mo.{"\n"}
                Wichtig: Zielshutter steigt auf 1/100 bzw. 1/120 s → meist <ThemedText style={styles.modalBold}>
                schwächerer ND</ThemedText> als bei 24 fps unter derselben Sonne.
              </ThemedText>

              <ThemedText style={styles.modalH4}>120 fps — Super Slow-Mo</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Für 4–5× Zeitlupe: Wellen, Sprünge, Drifts. Zielshutter 1/240 s — die Kamera braucht von Natur
                aus viel Licht. Häufig <ThemedText style={styles.modalBold}>kein oder nur schwacher ND</ThemedText>
                {" "}nötig. Im Schnitt auf 24/25 fps exportieren.
              </ThemedText>

              <ThemedText style={styles.modalH4}>Cinematic vs. FPV — auf einen Blick</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                <ThemedText style={styles.modalBold}>Cinematic</ThemedText> (Air 3S, Mavic, Mini): 24/25/30
                fps für ruhige Schwenks, Landschaften, epische Shots. ND-Filter Pflicht, sonst flimmert
                schnelle Bewegung.{"\n\n"}
                <ThemedText style={styles.modalBold}>FPV</ThemedText> (Avata 2, DJI FPV, Neo): 50/60/120
                fps für Dives, Gaps, Speedflights. Schwächerer ND als bei Cinematic, da die kürzere
                Zielbelichtung schon mehr Licht „verbraucht".
              </ThemedText>

              <ThemedText style={styles.modalH3}>Was bedeuten die Ergebnisse?</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                Die App berechnet die Lücke zwischen dem, was die Drohne <ThemedText style={styles.modalBold}>
                aktuell tun muss</ThemedText>, und dem, was für den <ThemedText style={styles.modalBold}>
                Kino-Look optimal</ThemedText> wäre.{"\n\n"}
                • <ThemedText style={styles.modalBold}>ND4 / ND8</ThemedText> — bewölkte Tage,
                goldene Stunde (leichte Sonnenbrille){"\n"}
                • <ThemedText style={styles.modalBold}>ND16 / ND32</ThemedText> — normale, sonnige
                Tage (Standard-Sonnenbrille){"\n"}
                • <ThemedText style={styles.modalBold}>ND64 / ND128</ThemedText> — greller
                Sonnenschein, Schnee, Sandstrand (Skibrille)
              </ThemedText>

              <ThemedText style={styles.modalH3}>Schritt-für-Schritt vor dem Start</ThemedText>
              <ThemedText style={[styles.modalBody, { color: theme.textSecondary }]}>
                <ThemedText style={styles.modalBold}>1.</ThemedText> In der DJI-Fly-App (o. ä.) den
                Kamera-Modus von <ThemedText style={styles.modalBold}>Auto</ThemedText> auf
                {" "}<ThemedText style={styles.modalBold}>Manuell (M)</ThemedText> umstellen.{"\n\n"}
                <ThemedText style={styles.modalBold}>2.</ThemedText> ISO fest auf{" "}
                <ThemedText style={styles.modalBold}>100</ThemedText> stellen — maximale Bildqualität
                ohne digitales Rauschen.{"\n\n"}
                <ThemedText style={styles.modalBold}>3.</ThemedText> Aktuellen Shutter-Wert vom
                Live-Bild ablesen und hier im Slider eintragen — oder den{" "}
                <ThemedText style={styles.modalBold}>Auto-Modus</ThemedText> mit Wetterdaten nutzen.{"\n\n"}
                <ThemedText style={styles.modalBold}>4.</ThemedText> Die Empfehlung ablesen
                (z. B. <ThemedText style={styles.modalBold}>ND16</ThemedText>), den passenden Filter
                aufs Objektiv stecken — fertig für den Kino-Look.
              </ThemedText>
            </ScrollView>

            <Button
              title="Verstanden"
              onPress={() => setInfoVisible(false)}
              style={{ marginTop: Spacing.lg }}
            />
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

function SectionTitle({ children, theme, mt }: { children: React.ReactNode; theme: any; mt?: boolean }) {
  return (
    <ThemedText style={[
      styles.sectionTitle,
      { color: theme.textSecondary, marginTop: mt ? Spacing["2xl"] : 0 },
    ]}>
      {children}
    </ThemedText>
  );
}

function MetaItem({ icon, label, value, theme }: { icon: any; label: string; value: string; theme: any }) {
  return (
    <View style={styles.metaItem}>
      <Feather name={icon} size={16} color={theme.primary} />
      <ThemedText style={{ ...Typography.caption, color: theme.textTertiary, marginTop: 2 }}>{label}</ThemedText>
      <ThemedText style={{ fontSize: 14, fontWeight: "700", color: theme.text }}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionTitle: {
    ...Typography.caption,
    fontWeight: "700",
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
    letterSpacing: 0.5,
  },
  card: { padding: Spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowTitle: { ...Typography.body, fontWeight: "600" },
  rowSub: { ...Typography.caption },
  cineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  checkHint: { ...Typography.caption },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  hint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: Spacing.md,
  },
  hintBox: {
    flexDirection: "row",
    gap: 8,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  hintText: { fontSize: 12, lineHeight: 16, flex: 1 },
  fpsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fpsChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    minWidth: 48,
    alignItems: "center",
  },
  targetShutter: { ...Typography.caption, marginTop: Spacing.md },
  segment: {
    flexDirection: "row",
    borderRadius: BorderRadius.sm,
    padding: 4,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BorderRadius.sm - 2,
    alignItems: "center",
  },
  bigShutter: {
    ...Typography.h2,
    fontWeight: "800",
    marginVertical: Spacing.sm,
    textAlign: "center",
  },
  sliderEnds: { flexDirection: "row", justifyContent: "space-between" },
  metaGrid: { flexDirection: "row", flexWrap: "wrap" },
  metaItem: {
    width: "25%",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  resultCard: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  resultLabel: { ...Typography.caption, fontWeight: "600", letterSpacing: 0.5 },
  resultBadge: { fontSize: 64, fontWeight: "900", marginVertical: Spacing.sm, letterSpacing: -2 },
  resultReason: { ...Typography.body, textAlign: "center", lineHeight: 20 },
  ecoRow: { marginTop: Spacing.lg, alignSelf: "stretch" },
  ecoChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  ecoChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  disclaimer: { fontSize: 11, fontStyle: "italic", lineHeight: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "85%",
    borderRadius: 16,
    padding: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  modalTitle: {
    ...Typography.h4,
    flex: 1,
  },
  modalH3: {
    ...Typography.body,
    fontWeight: "800",
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  modalH4: {
    ...Typography.caption,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginTop: Spacing.md,
    marginBottom: 4,
  },
  modalBody: {
    ...Typography.body,
    lineHeight: 21,
  },
  modalBold: {
    fontWeight: "700",
  },
});
