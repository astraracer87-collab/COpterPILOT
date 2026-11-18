import { openLink } from "@/lib/webBrowser";
import React, { useCallback, useLayoutEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Linking, Platform, Image } from "react-native";
import { getDroneImage } from "@/lib/droneImage";
import { beaufortLevel, warnThresholdMs, WIND_WARN_FRACTION } from "@/lib/beaufort";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { DocumentPreviewModal } from "@/components/DocumentPreviewModal";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, Colors } from "@/constants/theme";
import {
  getDrone,
  getLogbook,
  DroneProfile,
  LogbookEntry,
} from "@/lib/storage";
import {
  findPresetForDrone,
  DronePreset,
  DRONE_CLASS_INFO,
  DRONE_TYPE_INFO,
  LICENSE_LEVEL_LABELS,
  CONSTRAINT_LABELS,
} from "@/lib/dronePresets";
import type { DocumentRef } from "@/lib/documents";
import { computeBatteryStats } from "@/lib/djiBatteryLink";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type RouteParams = RouteProp<SettingsStackParamList, "DroneInfo">;
type NavigationProp = NativeStackNavigationProp<SettingsStackParamList>;

const DASH = "—";

function cleanPresetNotes(notes: string): string {
  return notes
    .replace(/\s*\(JSON[^)]*\)\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function fmtDate(iso?: string | null): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE");
}

function or(value: string | number | undefined | null, suffix?: string): string {
  if (value === undefined || value === null || value === "") return DASH;
  return suffix ? `${value} ${suffix}` : String(value);
}

export default function DroneInfoScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const droneId = route.params?.droneId;
  const [drone, setDrone] = useState<DroneProfile | null>(null);
  const [logbook, setLogbook] = useState<LogbookEntry[]>([]);
  const [previewDoc, setPreviewDoc] = useState<{ doc: DocumentRef; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!droneId) return;
    const [d, entries] = await Promise.all([getDrone(droneId), getLogbook()]);
    setDrone(d);
    setLogbook(entries);
  }, [droneId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: drone?.name || "Drohne",
      headerRight: () => (
        <HeaderButton
          onPress={() => navigation.navigate("DroneSetup", { droneId })}
          testID="button-edit-drone-info"
        >
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Feather name="edit-2" size={16} color={theme.primary} />
            <ThemedText style={{ color: theme.primary, marginLeft: 6, fontWeight: "600" }}>
              Bearbeiten
            </ThemedText>
          </View>
        </HeaderButton>
      ),
    });
  }, [navigation, drone?.name, droneId, theme.primary]);

  const openManualUrl = async (url: string) => {
    if (Platform.OS === "web") {
      openLink(url);
    } else {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  if (!drone) {
    return (
      <ThemedView style={styles.container}>
        <View style={{ paddingTop: headerHeight + Spacing.xl, alignItems: "center" }}>
          <ThemedText style={{ color: theme.textSecondary }}>Drohne wird geladen…</ThemedText>
        </View>
      </ThemedView>
    );
  }

  const preset: DronePreset | null = findPresetForDrone(drone.name, drone.manufacturer, drone.model);
  const droneImage = getDroneImage(drone.manufacturer, drone.model ?? preset?.model);
  const entriesForDrone = logbook.filter((e) => e.droneId === droneId);
  const lastFlight = entriesForDrone[0]; // logbook is sorted desc

  // Flüge je Akku: manuelle Auswahl (Pre-Check/Debriefing) + DJI-Flugprotokolle
  // (Akku-Seriennummer), Ladezyklen und Zellspannung aus den Protokollen.
  const batteryStats: Record<
    string,
    { flights: number; lastUsedAt?: string; cycleCount?: number; lowestCellV?: number; highestTempC?: number }
  > = {};
  for (const st of computeBatteryStats([drone], logbook)) {
    if (!st.batteryId) continue;
    batteryStats[st.batteryId] = {
      flights: st.flightCount,
      lastUsedAt: st.lastUsedAt,
      cycleCount: st.cycleCount,
      lowestCellV: st.lowestCellV,
      highestTempC: st.highestTempC,
    };
  }
  const lastMaintenance = entriesForDrone.find((e) => e.maintenanceRequired);
  const nextMaintenance = entriesForDrone.find(
    (e) => e.maintenanceRequired && e.maintenanceNotes && /next|nächst|fällig/i.test(e.maintenanceNotes),
  );

  const classLabel = drone.classMark === "legacy" ? "Bestandsdrohne" : drone.classMark;
  const typeLabel = DRONE_TYPE_INFO[drone.droneType]?.label ?? drone.droneType;
  const minLicense = preset ? LICENSE_LEVEL_LABELS[preset.minLicenseLevel] : DASH;
  const presetNotes = preset?.notes ? cleanPresetNotes(preset.notes) : "";

  const Row = ({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) => (
    <View style={styles.row}>
      <ThemedText style={[styles.rowLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
      <ThemedText style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value as any}</ThemedText>
    </View>
  );

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <ThemedText style={[styles.sectionTitle, { color: theme.primary }]}>{children}</ThemedText>
  );

  const DocCard = ({
    label,
    doc,
    testID,
  }: {
    label: string;
    doc: DocumentRef;
    testID: string;
  }) => (
    <Pressable
      onPress={() => setPreviewDoc({ doc, label })}
      style={({ pressed }) => [
        styles.docRow,
        { backgroundColor: theme.backgroundSecondary },
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Feather name={doc.mimeType === "application/pdf" ? "file-text" : "image"} size={18} color={theme.primary} />
      <View style={{ flex: 1, marginLeft: Spacing.sm }}>
        <ThemedText style={styles.docLabel}>{label}</ThemedText>
        <ThemedText style={[styles.docMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {doc.fileName}
        </ThemedText>
      </View>
      <Feather name="eye" size={18} color={theme.primary} />
    </Pressable>
  );

  return (
    <ThemedView style={styles.container} testID="screen-drone-info">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.lg,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
      >
        {/* Drohnenbild */}
        {droneImage ? (
          <View style={[styles.imageContainer, { backgroundColor: theme.backgroundSecondary }]}>
            <Image source={droneImage} style={styles.heroDroneImage} resizeMode="contain" />
          </View>
        ) : null}

        {/* Stammdaten */}
        <Card style={styles.card}>
          <SectionTitle>Stammdaten</SectionTitle>
          <Row label="Hersteller" value={or(drone.manufacturer)} />
          <Row label="Modell" value={or(drone.model)} />
          <Row label="EU-Klasse" value={classLabel} />
          <Row label="MTOM" value={`${drone.mtomGrams} g`} />
          <Row label="Seriennummer" value={or(drone.serialNumber)} />
          <Row label="e-ID / AlphaTango" value={or(drone.alphaTangoId)} />
          <Row label="Baujahr" value={or(preset?.year)} />
          <Row label="Typ" value={typeLabel} />
          <Row label="Mindestlizenz" value={minLicense} />
        </Card>

        {/* Technische Daten */}
        <Card style={styles.card}>
          <SectionTitle>Technische Daten</SectionTitle>
          <Row
            label="Remote-ID"
            value={drone.hasRemoteId ? "Ja" : "Nein"}
            valueColor={drone.hasRemoteId ? theme.statusGo : Colors.light.statusNoGo}
          />
          <Row label="120 m-Sperre" value={drone.altitudeLocked120m ? "Ja" : "Nein"} />
          <Row label="Lidar" value={preset?.hasLidar === undefined ? DASH : preset.hasLidar ? "Ja" : "Nein"} />
          <Row label="Kamera / Sensor" value={drone.hasCameraOrSensor ? "Ja" : "Nein"} />
          <Row label="Sensor (Preset)" value={or(preset?.sensor)} />
          <Row
            label="Charakteristische Dimension"
            value={drone.charDimensionM && drone.charDimensionM > 0 ? `${Math.round(drone.charDimensionM * 1000)} mm` : DASH}
          />
          <Row
            label="Max. Sichtweite (VLOS)"
            value={preset?.vlosMeters != null ? `${preset.vlosMeters} m` : DASH}
          />
          <Row
            label="Akku (Katalog)"
            value={preset?.batteryWh != null ? `${preset.batteryWh} Wh` : DASH}
          />
          {preset ? (
            <View style={[styles.constraintBox, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="alert-circle" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.constraintText, { color: theme.textSecondary }]}>
                {CONSTRAINT_LABELS[preset.constraintId]}
              </ThemedText>
            </View>
          ) : null}
          {presetNotes ? (
            <ThemedText style={[styles.note, { color: theme.textTertiary }]}>{presetNotes}</ThemedText>
          ) : null}
        </Card>

        {/* Wetter-Limits */}
        <Card style={styles.card}>
          <SectionTitle>Wetter-Limits</SectionTitle>
          <Row
            label="Max. Wind"
            value={
              drone.limits?.maxWind != null
                ? `${drone.limits.maxWind} m/s · ${(drone.limits.maxWind * 3.6).toFixed(1)} km/h (Bft ${beaufortLevel(drone.limits.maxWind).bft})`
                : DASH
            }
          />
          {drone.limits?.maxWind != null ? (
            <Row
              label={`Warnung ab (${Math.round(WIND_WARN_FRACTION * 100)} %)`}
              value={`${warnThresholdMs(drone.limits.maxWind).toFixed(1)} m/s · ${(warnThresholdMs(drone.limits.maxWind) * 3.6).toFixed(0)} km/h (Bft ${beaufortLevel(warnThresholdMs(drone.limits.maxWind)).bft})`}
            />
          ) : null}
          <Row label="Max. Böen" value={drone.limits?.maxGusts != null ? `${drone.limits.maxGusts} m/s` : DASH} />
          <Row label="Min. Temperatur" value={drone.limits?.minTemp != null ? `${drone.limits.minTemp} °C` : DASH} />
          <Row label="Max. Temperatur" value={drone.limits?.maxTemp != null ? `${drone.limits.maxTemp} °C` : DASH} />
          <Row label="Max. Regen" value={drone.limits?.maxRain != null ? `${drone.limits.maxRain} mm/h` : DASH} />
          <Row label="Min. Wolkenbasis" value={drone.limits?.minCloudCeiling != null ? `${drone.limits.minCloudCeiling} m` : DASH} />
          <Row label="Min. Sichtweite" value={drone.limits?.minVisibility != null ? `${drone.limits.minVisibility} m` : DASH} />
        </Card>

        {/* Flugzähler & Wartung */}
        <Card style={styles.card}>
          <SectionTitle>Flugzähler & Wartung</SectionTitle>
          <Row label="Anzahl Flüge" value={String(entriesForDrone.length)} />
          <Row label="Letzter Flug" value={lastFlight ? fmtDate(lastFlight.flightDate) : DASH} />
          <Row
            label="Letzte Wartung"
            value={lastMaintenance ? fmtDate(lastMaintenance.flightDate) : DASH}
          />
          {lastMaintenance?.maintenanceNotes ? (
            <ThemedText style={[styles.note, { color: theme.textTertiary }]}>
              {lastMaintenance.maintenanceNotes}
            </ThemedText>
          ) : null}
          {nextMaintenance ? (
            <Row label="Nächste Wartung" value={nextMaintenance.maintenanceNotes ?? DASH} />
          ) : null}
        </Card>

        {/* Akkus */}
        <Card style={styles.card}>
          <SectionTitle>Akkus</SectionTitle>
          {drone.batteries && drone.batteries.length > 0 ? (
            drone.batteries.map((b) => {
              const stats = batteryStats[b.id] ?? { flights: 0, lastUsedAt: undefined };
              const cycles = stats.cycleCount ?? stats.flights;
              const statusLabel =
                stats.flights === 0 && !stats.cycleCount
                  ? "Unbenutzt"
                  : cycles >= 200
                  ? "Hohe Zyklenzahl"
                  : "Aktiv";
              const statusColor =
                stats.flights === 0 && !stats.cycleCount
                  ? theme.textTertiary
                  : cycles >= 200
                  ? Colors.light.statusCaution
                  : theme.statusGo;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => navigation.navigate("BatteryDetail", { droneId: drone.id, batteryId: b.id })}
                  style={({ pressed }) => [
                    styles.docRow,
                    { backgroundColor: theme.backgroundSecondary },
                    pressed && styles.pressed,
                  ]}
                  testID={`card-battery-${b.id}`}
                >
                  <Feather name="battery" size={18} color={theme.primary} />
                  <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                    <ThemedText style={styles.docLabel}>{b.name || "Akku"}</ThemedText>
                    <ThemedText style={[styles.docMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                      {b.serialNumber ? `S/N ${b.serialNumber}` : "Keine S/N"} · {stats.flights} {stats.flights === 1 ? "Flug" : "Flüge"}
                      {stats.cycleCount != null ? ` · ${stats.cycleCount} Zyklen (DJI)` : ""} · Letzte Nutzung {stats.lastUsedAt ? fmtDate(stats.lastUsedAt) : DASH}
                    </ThemedText>
                    {stats.lowestCellV != null || stats.highestTempC != null ? (
                      <ThemedText style={[styles.docMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                        {[
                          stats.lowestCellV != null ? `Min. Zelle ${stats.lowestCellV.toFixed(2).replace(".", ",")} V` : null,
                          stats.highestTempC != null ? `Max. ${Math.round(stats.highestTempC)} °C` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </ThemedText>
                    ) : null}
                    <ThemedText style={[styles.docMeta, { color: statusColor }]}>
                      {statusLabel}
                    </ThemedText>
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.textTertiary} />
                </Pressable>
              );
            })
          ) : (
            <ThemedText style={[styles.note, { color: theme.textTertiary }]}>
              Keine Akkus hinterlegt. Über „Bearbeiten" können Akkus mit Name, Seriennummer und Zyklen gepflegt werden.
            </ThemedText>
          )}
        </Card>

        {/* Dokumente */}
        <Card style={styles.card}>
          <SectionTitle>Dokumente</SectionTitle>
          {drone.alphaTangoDocument ? (
            <DocCard
              label="AlphaTango-Bestätigung"
              doc={drone.alphaTangoDocument}
              testID={`card-document-alphatango-${drone.id}`}
            />
          ) : null}
          {drone.dflightDocument ? (
            <DocCard
              label="D-Flight-Bestätigung"
              doc={drone.dflightDocument}
              testID={`card-document-dflight-${drone.id}`}
            />
          ) : null}
          {preset?.manualUrl ? (
            <Pressable
              onPress={() => openManualUrl(preset.manualUrl!)}
              style={({ pressed }) => [
                styles.docRow,
                { backgroundColor: theme.backgroundSecondary },
                pressed && styles.pressed,
              ]}
              testID={`button-manual-info-${drone.id}`}
            >
              <Feather name="external-link" size={18} color={theme.primary} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <ThemedText style={styles.docLabel}>
                  {`${preset.manufacturer} ${preset.model} – Handbuch & Downloads`}
                </ThemedText>
                <ThemedText style={[styles.docMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                  Hersteller-Seite öffnen
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={18} color={theme.textTertiary} />
            </Pressable>
          ) : null}
          {!drone.alphaTangoDocument && !drone.dflightDocument && !preset?.manualUrl ? (
            <ThemedText style={[styles.note, { color: theme.textTertiary }]}>
              Keine Dokumente hinterlegt.
            </ThemedText>
          ) : null}
        </Card>
      </ScrollView>

      <DocumentPreviewModal
        visible={previewDoc !== null}
        onClose={() => setPreviewDoc(null)}
        document={previewDoc?.doc ?? null}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    flexGrow: 1,
  },
  imageContainer: {
    marginBottom: Spacing.md,
    borderRadius: 16,
    overflow: "hidden",
    height: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  heroDroneImage: {
    width: "100%",
    height: 170,
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
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  rowLabel: {
    ...Typography.small,
    flex: 1,
  },
  rowValue: {
    ...Typography.small,
    fontWeight: "600",
    textAlign: "right",
    flex: 1,
  },
  note: {
    ...Typography.small,
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  constraintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
  },
  constraintText: {
    ...Typography.small,
    flex: 1,
    lineHeight: 18,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
    marginTop: Spacing.xs,
  },
  docLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  docMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  pressed: { opacity: 0.7 },
});
