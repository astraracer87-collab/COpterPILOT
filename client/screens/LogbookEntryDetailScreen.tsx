import { normalizeCycleCount } from "@/lib/djiBatteryLink";
import React, { useCallback, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Image, Pressable, Alert, Platform } from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { DjiLogHelp } from "@/components/DjiLogHelp";
import DjiTracksMap, { DjiTracksMapHandle } from "@/components/DjiTracksMap";
import { DjiRecordsTable } from "@/components/DjiRecordsTable";
import { DjiStickVisualizer, hasStickData } from "@/components/DjiStickVisualizer";
import { DjiFlightReplay, hasReplayData } from "@/components/DjiFlightReplay";
import { DjiMessagesList, hasMessages } from "@/components/DjiMessagesList";
import StatusBadge from "@/components/StatusBadge";
import { ShareControls } from "@/components/ShareControls";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  getLogbookEntryBySessionId,
  getLogbookEntry,
  getEntryDjiLogs,
  getDrone,
  getPilotProfile,
  updateLogbookEntry,
  LogbookEntry,
  DjiLogMeta,
  DroneBattery,
} from "@/lib/storage";
import { getCheckItemLabel } from "@/lib/checklists";
import { exportFlightProtocolPdf } from "@/lib/pdfExport";
import { resolveFlightTimeDocuments, type ResolvedPilotDocument } from "../../shared/archivedDocuments";
import { pickAndUploadDjiLog } from "@/lib/djiLog";
import { viewDocument } from "@/lib/documents";
import { useAuth } from "@/lib/auth";
import { promptFeatureUpgrade } from "@/components/FeatureGate";
import type { SettingsStackParamList } from "@/navigation/SettingsStackNavigator";

type RouteParams = RouteProp<SettingsStackParamList, "LogbookEntryDetail">;
type NavProp = NativeStackNavigationProp<SettingsStackParamList, "LogbookEntryDetail">;

const CHECKLIST_LABELS: Record<string, string> = {
  props_check: "Propeller geprüft",
  motors_temp: "Motoren Temperatur",
  battery_final: "Akkustand",
  landing_clean: "Saubere Landung",
  landing_soft: "Sanft gelandet",
  landing_hard: "Hart / unsanft gelandet",
  smooth_landing: "Smooth Landing",
  firm_landing: "Smooth Landing",
  hard_landing: "Hard Landing",
  crash_landing: "Crash Landing",
  flight_log: "Flug dokumentiert",
  issues_noted: "Probleme notiert",
  footage_backup: "Aufnahmen gesichert",
  equipment_packed: "Ausrüstung verpackt",
  battery_storage: "Akku-Lagerung",
  hover_stable: "Hover stabil",
  controls_responsive: "Steuerung reaktiv",
  gps_stable: "GPS stabil",
  rth_verified: "RTH geprüft",
  battery_check: "Akku geprüft",
  propeller_check: "Propeller geprüft",
  firmware_check: "Firmware aktuell",
  storage_check: "Speicher geprüft",
  controller_check: "Fernsteuerung geprüft",
  legal_ready: "Rechtlich vorbereitet",
  area_clear: "Bereich frei",
  weather_acceptable: "Wetter geeignet",
};

const DEPRECATED_CHECKLIST_IDS = ["registration", "insurance", "permissions"];

const DJI_TRACK_COLORS = [
  "rgba(0, 122, 255, 0.9)",
  "rgba(255, 149, 0, 0.9)",
  "rgba(52, 199, 89, 0.9)",
  "rgba(175, 82, 222, 0.9)",
  "rgba(255, 59, 48, 0.9)",
  "rgba(90, 200, 250, 0.9)",
];

function formatDate(dateString?: string) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return date.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(timeString?: string) {
  if (!timeString) return null;
  const date = new Date(timeString);
  return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function djiLogKey(log: DjiLogMeta, index: number): string {
  return log.objectPath || `${log.fileName}-${index}`;
}

function formatDuration(minutes?: number) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}min`;
}

export default function LogbookEntryDetailScreen() {
  const route = useRoute<RouteParams>();
  const navigation = useNavigation<NavProp>();
  const { theme } = useTheme();
  const { entitlement } = useAuth();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<LogbookEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [batteries, setBatteries] = useState<DroneBattery[]>([]);
  const [batteryPickerFor, setBatteryPickerFor] = useState<string | null>(null);
  const [savingBattery, setSavingBattery] = useState(false);
  const [resolvedDocs, setResolvedDocs] = useState<ResolvedPilotDocument[]>([]);
  /** Aufgeklapptes DJI-Log (undefined = Standard: bei genau einem Log dieses). */
  const [expandedLogKey, setExpandedLogKey] = useState<string | null | undefined>(undefined);

  // Bereits angezeigte Daten beim erneuten Fokussieren nicht durch einen
  // Vollbild-Ladezustand ersetzen (nur der erste Ladevorgang zeigt „Laden…“).
  const hasShownEntry = useRef(false);
  const load = useCallback(async () => {
    if (!hasShownEntry.current) setLoading(true);
    try {
      await loadInner();
    } catch (e) {
      console.warn("[LogbookEntryDetail] Laden fehlgeschlagen:", (e as Error)?.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.sessionId, route.params.logbookEntryId]);

  const loadInner = async () => {
    let result: LogbookEntry | null = null;
    if (route.params.logbookEntryId) {
      result = await getLogbookEntry(route.params.logbookEntryId);
    } else if (route.params.sessionId) {
      result = await getLogbookEntryBySessionId(route.params.sessionId);
    }
    setEntry(result);
    hasShownEntry.current = !!result;
    if (result) {
      try {
        const pilot = await getPilotProfile();
        setResolvedDocs(
          resolveFlightTimeDocuments(pilot, {
            flightDateISO: result.flightDate,
            bundesland: result.bundesland,
          }),
        );
      } catch {
        setResolvedDocs([]);
      }
    } else {
      setResolvedDocs([]);
    }
    if (result?.droneId) {
      try {
        const drone = await getDrone(result.droneId);
        setBatteries(drone?.batteries ?? []);
      } catch {
        setBatteries([]);
      }
    } else {
      setBatteries([]);
    }
  };

  const entryHasRoute = useCallback((e: LogbookEntry) => {
    const logs = getEntryDjiLogs(e);
    return logs.some((l) => (l.track ?? []).length >= 2) || (e.gpsTrack ?? []).length >= 2;
  }, []);

  const handleAssignBattery = useCallback(
    async (objectPath: string, battery: DroneBattery | null) => {
      if (!entry) return;
      setSavingBattery(true);
      try {
        const allLogs = getEntryDjiLogs(entry);
        const logs = allLogs.map((l) =>
          l.objectPath === objectPath
            ? {
                ...l,
                batteryId: battery?.id,
                batteryLabel: battery
                  ? battery.serialNumber
                    ? `${battery.name} (${battery.serialNumber})`
                    : battery.name
                  : undefined,
              }
            : l,
        );
        const patch: Partial<LogbookEntry> = { djiLogs: logs };

        // Fluggerätedaten aus dem Log nur in noch leere Felder übernehmen.
        const target = allLogs.find((l) => l.objectPath === objectPath);
        if (battery && target) {
          if (entry.maxAltitude == null && target.maxAltitudeM != null) {
            patch.maxAltitude = Math.round(target.maxAltitudeM);
          }
          if (entry.flightDurationMinutes == null && target.durationSec) {
            patch.flightDurationMinutes = Math.max(1, Math.round(target.durationSec / 60));
          }
          // Akku-Anfangswert (Pre-Check) — nur ergänzen, wenn Pre-Check existiert.
          if (target.batteryStartPercent != null && entry.preflight) {
            const pre = [...(entry.preflight.batteryUsage ?? [])];
            const idx = pre.findIndex((u) => u.batteryId === battery.id);
            if (idx === -1) {
              pre.push({
                batteryId: battery.id,
                name: battery.name,
                serialNumber: battery.serialNumber,
                percentBefore: target.batteryStartPercent,
              });
            } else if (pre[idx].percentBefore == null) {
              pre[idx] = { ...pre[idx], percentBefore: target.batteryStartPercent };
            }
            patch.preflight = { ...entry.preflight, batteryUsage: pre };
          }
          // Akku-Endwert (Debriefing) — nur ergänzen, wenn Debriefing existiert.
          if (target.batteryEndPercent != null && entry.debriefing) {
            const post = [...(entry.debriefing.batteryUsage ?? [])];
            const idx = post.findIndex((u) => u.batteryId === battery.id);
            if (idx === -1) {
              post.push({
                batteryId: battery.id,
                name: battery.name,
                serialNumber: battery.serialNumber,
                percentAfter: target.batteryEndPercent,
              });
            } else if (post[idx].percentAfter == null) {
              post[idx] = { ...post[idx], percentAfter: target.batteryEndPercent };
            }
            patch.debriefing = { ...entry.debriefing, batteryUsage: post };
          }
        }

        await updateLogbookEntry(entry.id, patch);
        setBatteryPickerFor(null);
        await load();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        Alert.alert("Fehler", "Akku konnte nicht zugeordnet werden.");
      } finally {
        setSavingBattery(false);
      }
    },
    [entry, load],
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const [uploadingDji, setUploadingDji] = useState(false);
  const [savingSnapshots, setSavingSnapshots] = useState(false);
  const protocolMapRef = useRef<DjiTracksMapHandle>(null);
  const autoSnapshotRan = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});
  const didFocusScroll = useRef(false);
  const focusSection = route.params?.focusSection;

  const maybeScrollToFocus = useCallback(() => {
    if (!focusSection || didFocusScroll.current) return;
    const y = sectionY.current[focusSection];
    if (y === undefined) return;
    didFocusScroll.current = true;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - headerHeight), animated: true });
  }, [focusSection, headerHeight]);

  const registerSectionLayout = useCallback(
    (key: string, y: number) => {
      sectionY.current[key] = y;
      maybeScrollToFocus();
    },
    [maybeScrollToFocus],
  );

  const handleSaveSnapshots = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!entry) return false;
      if (Platform.OS === "web") {
        if (!silent) {
          Alert.alert(
            "Nur in Expo Go",
            "Karten-Snapshots können nur in der mobilen App (Expo Go) erstellt werden.",
          );
        }
        return false;
      }
      const mapApi = protocolMapRef.current;
      if (!mapApi) return false;
      setSavingSnapshots(true);
      try {
        const { standard, satellite } = await mapApi.captureBoth();
        if (!standard && !satellite) {
          if (!silent) {
            Alert.alert(
              "Keine Karte erfasst",
              "Bitte warte, bis die Karte vollständig geladen ist, und versuche es erneut.",
            );
          }
          return false;
        }
        const isRoute = entryHasRoute(entry);
        const patch: Partial<LogbookEntry> = {};
        if (isRoute) {
          if (standard) patch.routeMapSnapshotBase64 = standard;
          if (satellite) patch.routeMapSatelliteSnapshotBase64 = satellite;
        } else {
          if (standard) patch.mapSnapshotBase64 = standard;
          if (satellite) patch.mapSatelliteSnapshotBase64 = satellite;
        }
        await updateLogbookEntry(entry.id, patch);
        await load();
        if (!silent) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert("Gespeichert", "Die Karte (Karte + Satellit) wurde fürs Protokoll-PDF gespeichert.");
        }
        // Erfolg nur, wenn beide Stile erfasst wurden.
        return !!standard && !!satellite;
      } catch {
        if (!silent) Alert.alert("Fehler", "Kartenausschnitte konnten nicht gespeichert werden.");
        return false;
      } finally {
        setSavingSnapshots(false);
      }
    },
    [entry, load, entryHasRoute],
  );

  // Auto-Capture, sobald die Karte bereit ist und noch beide Stile fehlen.
  const handleMapsReady = useCallback(() => {
    if (autoSnapshotRan.current || !entry) return;
    const isRoute = entryHasRoute(entry);
    const hasStd = isRoute ? !!entry.routeMapSnapshotBase64 : !!entry.mapSnapshotBase64;
    const hasSat = isRoute
      ? !!entry.routeMapSatelliteSnapshotBase64
      : !!entry.mapSatelliteSnapshotBase64;
    if (hasStd && hasSat) {
      autoSnapshotRan.current = true;
      return;
    }
    // Optimistisch sperren; bei Fehlschlag wieder freigeben, damit ein erneutes
    // Map-Ready-Event (oder der manuelle Button) es nochmal versuchen kann.
    autoSnapshotRan.current = true;
    handleSaveSnapshots(true).then((ok) => {
      if (!ok) autoSnapshotRan.current = false;
    });
  }, [entry, entryHasRoute, handleSaveSnapshots]);

  const handleApplyBatteryFromLog = useCallback(
    async (usage: number) => {
      if (!entry) return;
      try {
        const base = entry.debriefing ?? { incidentOccurred: false, maintenanceRequired: false };
        await updateLogbookEntry(entry.id, {
          debriefing: { ...base, batteryUsedPercent: usage },
        });
        await load();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Übernommen", `Akkuverbrauch ${usage}% aus dem Fluglog ins Debriefing übernommen.`);
      } catch {
        Alert.alert("Fehler", "Akkuverbrauch konnte nicht übernommen werden.");
      }
    },
    [entry, load],
  );

  const handleDjiUpload = useCallback(async () => {
    if (!entry) return;
    setUploadingDji(true);
    try {
      const updated = await pickAndUploadDjiLog(entry.id);
      if (updated) {
        setEntry(updated);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      Alert.alert("Fehler", e instanceof Error ? e.message : "DJI-Protokoll konnte nicht verarbeitet werden.");
    } finally {
      setUploadingDji(false);
    }
  }, [entry]);


  const renderWeatherInfo = (weather: any, label: string) => {
    if (!weather) return null;
    return (
      <View style={[styles.weatherBox, { backgroundColor: theme.backgroundSecondary }]}>
        <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <View style={styles.weatherGrid}>
          <View style={styles.weatherItem}>
            <ThemedText style={styles.weatherValue}>{weather.temperature?.toFixed(0) ?? "-"}°C</ThemedText>
            <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Temp</ThemedText>
          </View>
          <View style={styles.weatherItem}>
            <ThemedText style={styles.weatherValue}>{weather.windSpeed?.toFixed(1) ?? "-"} m/s</ThemedText>
            <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Wind</ThemedText>
          </View>
          {weather.windGust ? (
            <View style={styles.weatherItem}>
              <ThemedText style={styles.weatherValue}>{weather.windGust?.toFixed(1)} m/s</ThemedText>
              <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Böen</ThemedText>
            </View>
          ) : null}
          <View style={styles.weatherItem}>
            <ThemedText style={styles.weatherValue}>{weather.rain?.toFixed(1) ?? "0"} mm</ThemedText>
            <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Regen</ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderChecklist = (
    presentedItems: string[] | undefined,
    completedItems: string[] | undefined,
    label: string,
  ) => {
    const presented = presentedItems && presentedItems.length > 0
      ? presentedItems
      : completedItems || [];
    if (!presented || presented.length === 0) return null;
    const completedSet = new Set(completedItems || []);
    const filtered = presented.filter((id) => !DEPRECATED_CHECKLIST_IDS.includes(id));
    if (filtered.length === 0) return null;
    return (
      <View style={styles.checklistSection}>
        <ThemedText style={[styles.checklistLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <View style={styles.checklistGrid}>
          {filtered.map((id) => {
            const isChecked = completedSet.has(id);
            const itemLabel = CHECKLIST_LABELS[id] || getCheckItemLabel(id) || id;
            return (
              <View key={id} style={styles.checklistItem}>
                <Feather
                  name={isChecked ? "check-circle" : "circle"}
                  size={14}
                  color={isChecked ? theme.statusGo : theme.textTertiary}
                />
                <ThemedText
                  style={[
                    styles.checklistText,
                    { color: isChecked ? theme.statusGo : theme.textTertiary },
                  ]}
                >
                  {itemLabel}
                </ThemedText>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderDetailRow = (label: string, value?: string | number | null) => {
    if (value === undefined || value === null || value === "") return null;
    return (
      <View style={styles.detailRow}>
        <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>{label}:</ThemedText>
        <ThemedText style={styles.detailValue}>{String(value)}</ThemedText>
      </View>
    );
  };

  const formatMeters = (m: number) =>
    m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;

  const renderVlosWarning = (planning?: LogbookEntry["planning"]) => {
    if (!planning?.vlosExceeded) return null;
    const recommended =
      typeof planning.recommendedVlosM === "number" && planning.recommendedVlosM > 0
        ? planning.recommendedVlosM
        : null;
    const heightCorrected = planning.vlosAltitudeCorrection === true;
    return (
      <View style={[styles.vlosWarningBox, { borderColor: "#C53030" }]}>
        <View style={styles.vlosWarningHeader}>
          <Feather name="alert-triangle" size={14} color="#C53030" />
          <ThemedText style={styles.vlosWarningTitle}>
            {heightCorrected ? "Über dem horizontalen VLOS-Richtwert" : "Außerhalb VLOS (BVLOS)"}
          </ThemedText>
        </View>
        <ThemedText style={[styles.vlosWarningText, { color: theme.textSecondary }]}>
          {heightCorrected
            ? "Der geplante horizontale Radius überschreitet den höhenkorrigierten Richtwert. Die Korrektur ist eine geometrische Näherung."
            : "Flug außerhalb der direkten Sichtweite (BVLOS) — Spotter erforderlich. Pilot hat den Override bewusst gesetzt."}
        </ThemedText>
        {recommended != null ? (
          <ThemedText style={[styles.vlosWarningText, { color: theme.textSecondary }]}>
            Empfohlene VLOS: {formatMeters(recommended)}
          </ThemedText>
        ) : null}
        {heightCorrected && typeof planning.vlosHorizontalLimitM === "number" ? (
          <ThemedText style={[styles.vlosWarningText, { color: theme.textSecondary }]}>
            Horizontaler Richtwert bei {Math.round(planning.maxAltitude ?? 0)} m AGL: {formatMeters(planning.vlosHorizontalLimitM)}
          </ThemedText>
        ) : null}
      </View>
    );
  };

  const renderPhase = (
    title: string,
    icon: keyof typeof Feather.glyphMap,
    content: React.ReactNode,
    isPresent: boolean,
    sectionKey?: string,
  ) => {
    if (!isPresent) return null;
    return (
      <View
        onLayout={
          sectionKey
            ? (e) => registerSectionLayout(sectionKey, e.nativeEvent.layout.y)
            : undefined
        }
      >
        <Card style={styles.phaseCard}>
          <View style={styles.phaseHeader}>
            <Feather name={icon} size={16} color={theme.statusGo} />
            <ThemedText style={styles.phaseTitle}>{title}</ThemedText>
          </View>
          {content}
        </Card>
      </View>
    );
  };

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight }]}>
          <ThemedText style={{ color: theme.textSecondary }}>Laden...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (!entry) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight + Spacing.xl, paddingHorizontal: Spacing.lg }]}>
          <Feather name="file-text" size={48} color={theme.textTertiary} />
          <ThemedText style={[styles.notFoundTitle, { marginTop: Spacing.md }]}>
            Kein Logbuch-Eintrag gefunden
          </ThemedText>
          <ThemedText style={[{ color: theme.textSecondary, textAlign: "center", marginTop: Spacing.sm }]}>
            Zu diesem Ereignis existiert kein passender Logbuch-Eintrag mehr.
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  const djiLogs = getEntryDjiLogs(entry);
  const djiMapTracks = djiLogs
    .map((l, i) => ({
      coords: (l.track ?? []).map((p) => ({ latitude: p.lat, longitude: p.lon })),
      color: DJI_TRACK_COLORS[i % DJI_TRACK_COLORS.length],
    }))
    .filter((t) => t.coords.length >= 2);
  const djiAggDuration = djiLogs.reduce((s, l) => s + (l.durationSec ?? 0), 0);
  const djiAggDistance = djiLogs.reduce((s, l) => s + (l.totalDistanceM ?? 0), 0);
  const djiAggMaxAlt = djiLogs.reduce(
    (m, l) => (l.maxAltitudeM != null && l.maxAltitudeM > m ? l.maxAltitudeM : m),
    0,
  );

  const radiusCircle =
    typeof entry.planning?.radiusKm === "number" && entry.planning.radiusKm > 0
      ? { latitude: entry.latitude, longitude: entry.longitude, radiusKm: entry.planning.radiusKm }
      : undefined;

  const gpsRouteCoords = (entry.gpsTrack ?? []).map((p) => ({ latitude: p.lat, longitude: p.lon }));
  const routeTracks =
    djiMapTracks.length > 0
      ? djiMapTracks
      : gpsRouteCoords.length >= 2
        ? [{ coords: gpsRouteCoords, color: DJI_TRACK_COLORS[0] }]
        : [];

  const logBatteryStart = djiLogs.find((l) => l.batteryStartPercent != null)?.batteryStartPercent;
  const logBatteryEnd = [...djiLogs]
    .reverse()
    .find((l) => l.batteryEndPercent != null)?.batteryEndPercent;
  const logBatteryUsage =
    logBatteryStart != null && logBatteryEnd != null
      ? Math.max(0, Math.round(logBatteryStart - logBatteryEnd))
      : null;
  const hasSavedSnapshots = !!(
    entry.routeMapSnapshotBase64 ||
    entry.mapSnapshotBase64 ||
    entry.routeMapSatelliteSnapshotBase64 ||
    entry.mapSatelliteSnapshotBase64
  );

  const renderDjiLogCard = (log: DjiLogMeta, index: number) => {
    const color = DJI_TRACK_COLORS[index % DJI_TRACK_COLORS.length];
    const pickerOpen = batteryPickerFor === log.objectPath;
    const logKey = djiLogKey(log, index);
    // Schwere Teile (Wiedergabe mit nativer Karte, Knüppel, Tabelle, Meldungen)
    // nur für das EINE aufgeklappte Log mounten – sonst OOM bei vielen Logs.
    const expanded = expandedLogKey === undefined ? djiLogs.length === 1 : expandedLogKey === logKey;
    const hasHeavy =
      hasReplayData(log.records) || hasMessages(log.messages) || hasStickData(log.records) || (log.records?.length ?? 0) > 0;
    return (
      <View
        key={log.objectPath || `${log.fileName}-${index}`}
        style={[styles.djiLogCard, { borderColor: theme.border }]}
        testID={`card-dji-log-${index}`}
      >
        <View style={styles.djiLogHeader}>
          <View style={[styles.djiColorDot, { backgroundColor: color }]} />
          <ThemedText style={styles.djiLogTitle} numberOfLines={1}>
            {djiLogs.length > 1 ? `Log ${index + 1}` : "Log"}
            {log.batteryLabel ? ` · ${log.batteryLabel}` : ""}
          </ThemedText>
        </View>
        {log.status === "parsed" ? (
          <ThemedText style={[styles.djiNotice, { color: theme.statusGo }]}>
            Protokoll ausgewertet
            {log.trackPointCount ? ` · ${log.trackPointCount} GPS-Punkte` : ""}
          </ThemedText>
        ) : (
          <View style={[styles.alertBox, { backgroundColor: theme.statusCautionBackground }]}>
            <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.alertLabel, { color: theme.statusCaution }]}>
                {log.status === "undecryptable"
                  ? "Verschlüsseltes Protokoll (DJI v13+)"
                  : "Auswertung fehlgeschlagen"}
              </ThemedText>
              <ThemedText style={styles.alertText}>
                {log.status === "undecryptable"
                  ? log.message || "Ohne DJI-API-Schlüssel nicht vollständig auswertbar."
                  : log.message || "Das Protokoll enthält keine verwertbaren Daten."}
              </ThemedText>
            </View>
          </View>
        )}
        {log.droneName ? renderDetailRow("Drohne (Log)", log.droneName) : null}
        {log.version != null ? renderDetailRow("Log-Version", `v${log.version}`) : null}
        {log.maxAltitudeM != null ? renderDetailRow("Max. Höhe", `${log.maxAltitudeM.toFixed(1)} m`) : null}
        {log.durationSec != null ? renderDetailRow("Flugdauer", `${Math.round(log.durationSec)} s`) : null}
        {log.totalDistanceM != null ? renderDetailRow("Strecke", `${(log.totalDistanceM / 1000).toFixed(2)} km`) : null}
        {log.batteryStartPercent != null || log.batteryEndPercent != null || log.batteryMinPercent != null
          ? renderDetailRow(
              "Akku (Start/Ende/Min)",
              [
                log.batteryStartPercent != null ? `${log.batteryStartPercent}%` : "—",
                log.batteryEndPercent != null ? `${log.batteryEndPercent}%` : "—",
                log.batteryMinPercent != null ? `${log.batteryMinPercent}%` : "—",
              ].join(" / "),
            )
          : null}
        {log.batterySn ? renderDetailRow("Akku S/N", log.batterySn) : null}
        {normalizeCycleCount(log.batteryCycleCount) != null ? renderDetailRow("Ladezyklen", String(normalizeCycleCount(log.batteryCycleCount))) : null}
        {log.minCellV != null
          ? renderDetailRow(
              "Min. Zellspannung",
              `${log.minCellV.toFixed(2).replace(".", ",")} V${log.minCellEstimated ? " (geschätzt)" : ""}`,
            )
          : null}
        {log.maxBatteryTempC != null ? renderDetailRow("Max. Akkutemperatur", `${Math.round(log.maxBatteryTempC)} °C`) : null}

        {batteries.length > 0 ? (
          <View style={styles.djiBatterySection}>
            <Pressable
              testID={`button-dji-battery-${index}`}
              onPress={() => setBatteryPickerFor(pickerOpen ? null : log.objectPath)}
              style={({ pressed }) => [
                styles.djiButton,
                { backgroundColor: theme.backgroundSecondary },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather name="battery-charging" size={15} color={theme.primary} />
              <ThemedText style={[styles.djiButtonText, { color: theme.primary }]} numberOfLines={1}>
                {log.batteryLabel ? `Akku: ${log.batteryLabel}` : "Akku zuordnen"}
              </ThemedText>
              <Feather name={pickerOpen ? "chevron-up" : "chevron-down"} size={15} color={theme.textTertiary} />
            </Pressable>
            {pickerOpen ? (
              <View style={styles.djiBatteryList}>
                {batteries.map((b) => {
                  const selected = log.batteryId === b.id;
                  return (
                    <Pressable
                      key={b.id}
                      testID={`row-dji-battery-${index}-${b.id}`}
                      disabled={savingBattery}
                      onPress={() => handleAssignBattery(log.objectPath, selected ? null : b)}
                      style={({ pressed }) => [
                        styles.djiBatteryRow,
                        {
                          backgroundColor: selected ? theme.primary + "15" : theme.backgroundSecondary,
                          borderColor: selected ? theme.primary : theme.border,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Feather
                        name={selected ? "check-circle" : "circle"}
                        size={15}
                        color={selected ? theme.primary : theme.textTertiary}
                      />
                      <ThemedText style={styles.djiBatteryName} numberOfLines={1}>
                        {b.name}
                        {b.serialNumber ? ` · ${b.serialNumber}` : ""}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {hasHeavy ? (
          <Pressable
            testID={`button-dji-expand-${index}`}
            onPress={() => setExpandedLogKey(expanded ? null : logKey)}
            style={({ pressed }) => [
              styles.djiButton,
              { backgroundColor: theme.backgroundSecondary, marginTop: Spacing.sm },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name={expanded ? "chevron-up" : "play-circle"} size={15} color={theme.primary} />
            <ThemedText style={[styles.djiButtonText, { color: theme.primary }]} numberOfLines={1}>
              {expanded ? "Wiedergabe & Details ausblenden" : "Wiedergabe & Details anzeigen"}
            </ThemedText>
          </Pressable>
        ) : null}

        {expanded && hasReplayData(log.records) ? (
          <View style={{ marginTop: Spacing.sm }}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              Flugwiedergabe
            </ThemedText>
            <DjiFlightReplay records={log.records!} />
          </View>
        ) : null}

        {expanded && hasMessages(log.messages) ? (
          <View style={{ marginTop: Spacing.sm }}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              Meldungen der Fernsteuerung
            </ThemedText>
            <DjiMessagesList messages={log.messages!} />
          </View>
        ) : null}

        {expanded && hasStickData(log.records) ? (
          <View style={{ marginTop: Spacing.sm }}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              Steuerknüppel-Eingaben
            </ThemedText>
            <DjiStickVisualizer records={log.records!} />
          </View>
        ) : null}

        {expanded && log.records && log.records.length > 0 ? (
          <View style={{ marginTop: Spacing.sm }}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              Detailauswertung
            </ThemedText>
            <DjiRecordsTable records={log.records} />
          </View>
        ) : null}

        <Pressable
          testID={`button-dji-download-${index}`}
          onPress={() =>
            viewDocument({
              fileName: log.fileName,
              mimeType: "text/plain",
              sizeBytes: log.sizeBytes ?? 0,
              uploadedAt: log.uploadedAt ?? "",
              objectPath: log.objectPath,
            }).catch(() => Alert.alert("Fehler", "Datei konnte nicht geöffnet werden."))
          }
          style={({ pressed }) => [
            styles.djiButton,
            { backgroundColor: theme.backgroundSecondary },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="download" size={15} color={theme.primary} />
          <ThemedText style={[styles.djiButtonText, { color: theme.primary }]} numberOfLines={1}>
            {log.fileName}
          </ThemedText>
        </Pressable>
      </View>
    );
  };

  const renderDjiSection = () => {
    if (djiLogs.length === 0 && routeTracks.length === 0 && !radiusCircle) {
      return (
        <ThemedText style={[styles.djiNotice, { color: theme.textSecondary }]}>
          Lade ein DJI-Controller-Flugprotokoll (.txt aus DJI Fly/GO/Pilot) hoch, um GPS-Track,
          Höhe, Dauer und Akkudaten automatisch zu übernehmen.
        </ThemedText>
      );
    }
    return (
      <View>
        {routeTracks.length > 0 || radiusCircle ? (
          <View style={{ marginBottom: Spacing.sm }}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              {routeTracks.length > 0
                ? "Flugroute (mit Geozonen-Overlay)"
                : "Geplantes Fluggebiet (mit Geozonen-Overlay)"}
            </ThemedText>
            <DjiTracksMap
              ref={protocolMapRef}
              tracks={routeTracks}
              radiusCircle={radiusCircle}
              initialGeozonesOn
              onReady={handleMapsReady}
            />
            <ThemedText style={[styles.djiNotice, { color: theme.textSecondary }]}>
              Tipp: Oben rechts auf „Satellit" umschalten. Karte und Satellit kommen automatisch ins Protokoll-PDF.
            </ThemedText>
          </View>
        ) : null}
        {(routeTracks.length > 0 || radiusCircle) && Platform.OS !== "web" ? (
          <Pressable
            testID="button-save-protocol-maps"
            onPress={() => handleSaveSnapshots(false)}
            disabled={savingSnapshots}
            style={({ pressed }) => [
              styles.djiButton,
              { backgroundColor: theme.backgroundSecondary, marginBottom: Spacing.xs },
              pressed && { opacity: 0.7 },
              savingSnapshots && { opacity: 0.6 },
            ]}
          >
            <Feather name="refresh-cw" size={15} color={theme.primary} />
            <ThemedText style={[styles.djiButtonText, { color: theme.primary }]} numberOfLines={1}>
              {savingSnapshots
                ? "Speichere Karte…"
                : hasSavedSnapshots
                  ? "Karte fürs Protokoll neu aufnehmen"
                  : "Karte fürs Protokoll aufnehmen"}
            </ThemedText>
          </Pressable>
        ) : null}
        {hasSavedSnapshots ? (
          <ThemedText style={[styles.djiNotice, { color: theme.statusGo, marginTop: 0 }]}>
            Karte fürs Protokoll-PDF gespeichert (Karte + Satellit).
          </ThemedText>
        ) : null}
        {logBatteryUsage != null ? (
          <View style={[styles.djiAggBox, { backgroundColor: theme.backgroundSecondary }]}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              Akkuverbrauch laut Fluglog
            </ThemedText>
            {renderDetailRow("Akku Start → Ende", `${logBatteryStart}% → ${logBatteryEnd}%`)}
            {renderDetailRow("Verbrauch", `${logBatteryUsage}%`)}
            {entry.debriefing?.batteryUsedPercent != null ? (
              <ThemedText style={[styles.djiNotice, { color: theme.textSecondary }]}>
                Debriefing-Akkuverbrauch: {entry.debriefing.batteryUsedPercent}%
              </ThemedText>
            ) : (
              <Pressable
                testID="button-apply-battery-from-log"
                onPress={() => handleApplyBatteryFromLog(logBatteryUsage)}
                style={({ pressed }) => [
                  styles.djiButton,
                  { backgroundColor: theme.background, marginTop: Spacing.xs },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Feather name="battery-charging" size={15} color={theme.primary} />
                <ThemedText style={[styles.djiButtonText, { color: theme.primary }]} numberOfLines={1}>
                  In Debriefing übernehmen
                </ThemedText>
              </Pressable>
            )}
          </View>
        ) : null}
        {djiLogs.length > 1 ? (
          <View style={[styles.djiAggBox, { backgroundColor: theme.backgroundSecondary }]}>
            <ThemedText style={[styles.djiSubLabel, { color: theme.textSecondary }]}>
              Gesamt ({djiLogs.length} Logs · Akku-Tausch)
            </ThemedText>
            {renderDetailRow("Gesamtdauer", `${Math.round(djiAggDuration)} s`)}
            {renderDetailRow("Gesamtstrecke", `${(djiAggDistance / 1000).toFixed(2)} km`)}
            {djiAggMaxAlt > 0 ? renderDetailRow("Max. Höhe", `${djiAggMaxAlt.toFixed(1)} m`) : null}
          </View>
        ) : null}
        {djiLogs.map((log, i) => renderDjiLogCard(log, i))}
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl + 40,
          },
        ]}
      >
        <View style={styles.statusRow}>
          {entry.status ? <StatusBadge status={entry.status} size="large" /> : null}
          <ThemedText style={[styles.dateText, { color: theme.textSecondary }]}>
            {formatDate(entry.flightDate)}
          </ThemedText>
        </View>

        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <Feather name="send" size={16} color={theme.primary} />
            <ThemedText style={styles.headerText}>{entry.droneName}</ThemedText>
            {entry.droneClass ? (
              <View style={[styles.classBadge, { backgroundColor: theme.backgroundSecondary }]}>
                <ThemedText style={[styles.classText, { color: theme.primary }]}>{entry.droneClass}</ThemedText>
              </View>
            ) : null}
          </View>
          {entry.locationName ? (
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={14} color={theme.textSecondary} />
              <ThemedText style={[styles.locationText, { color: theme.textSecondary }]}>{entry.locationName}</ThemedText>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            {entry.takeoffTime ? renderDetailRow("Start", formatTime(entry.takeoffTime)) : null}
            {entry.landingTime ? renderDetailRow("Landung", formatTime(entry.landingTime)) : null}
            {entry.flightDurationMinutes ? renderDetailRow("Flugdauer", formatDuration(entry.flightDurationMinutes)) : null}
            {entry.maxAltitude ? renderDetailRow("Max. Höhe", `${entry.maxAltitude} m`) : null}
          </View>
        </Card>

        {entry.mapSnapshotBase64 ? (
          <View style={[styles.mapWrapper, { borderColor: theme.border }]}>
            <Image
              source={{ uri: `data:image/jpeg;base64,${entry.mapSnapshotBase64}` }}
              style={styles.mapImage}
              resizeMode="cover"
            />
          </View>
        ) : null}

        {renderPhase(
          "Planung",
          "calendar",
          <View>
            {renderDetailRow("Datum", entry.planning?.plannedDate)}
            {renderDetailRow("Uhrzeit", entry.planning?.plannedTime)}
            {renderDetailRow("Zweck", entry.planning?.flightPurpose)}
            {renderDetailRow("Max. Höhe", entry.planning?.maxAltitude ? `${entry.planning.maxAltitude} m` : null)}
            {renderVlosWarning(entry.planning)}
            {renderWeatherInfo(entry.planning?.forecastWeather, "Vorhersage")}
            {renderChecklist(entry.planning?.checklistPresented, entry.planning?.checklistCompleted, "Planungs-Checks")}
          </View>,
          !!entry.planning,
          "planning",
        )}

        {renderPhase(
          "Pre-Check",
          "clipboard",
          <View>
            {renderDetailRow("Abgeschlossen", formatTime(entry.preflight?.completedAt))}
            {renderWeatherInfo(entry.preflight?.actualWeather, "Aktuelles Wetter")}
            {renderDetailRow("Equipment", entry.preflight?.equipmentNotes)}
            {renderChecklist(entry.preflight?.checklistPresented, entry.preflight?.checklistCompleted, "Pre-Check Items")}
          </View>,
          !!entry.preflight,
          "preflight",
        )}

        {renderPhase(
          "Im Flug",
          "navigation",
          <View>
            {renderDetailRow("Start", formatTime(entry.hoverCheck?.takeoffTime))}
            {renderDetailRow("Landung", formatTime(entry.hoverCheck?.landingTime))}
            {entry.hoverCheck?.hoverStable !== undefined
              ? renderDetailRow("Hover stabil", entry.hoverCheck.hoverStable ? "Ja" : "Nein")
              : null}
            {entry.hoverCheck?.controlsOk !== undefined
              ? renderDetailRow("Steuerung OK", entry.hoverCheck.controlsOk ? "Ja" : "Nein")
              : null}
            {entry.hoverCheck?.signalOk !== undefined
              ? renderDetailRow("Signal OK", entry.hoverCheck.signalOk ? "Ja" : "Nein")
              : null}
            {renderChecklist(undefined, entry.hoverCheck?.checklistCompleted, "Flug-Checks")}
          </View>,
          !!entry.hoverCheck,
          "hover",
        )}

        {renderPhase(
          "Nach Landung",
          "flag",
          <View>
            {entry.postLanding?.damageChecked !== undefined
              ? renderDetailRow("Schäden geprüft", entry.postLanding.damageChecked ? "Ja" : "Nein")
              : null}
            {entry.postLanding?.uasPoweredOff !== undefined
              ? renderDetailRow("UAS ausgeschaltet", entry.postLanding.uasPoweredOff ? "Ja" : "Nein")
              : null}
            {renderChecklist(undefined, entry.postLanding?.checklistCompleted, "Post-Landing Checks")}
          </View>,
          !!entry.postLanding,
          "postLanding",
        )}

        {renderPhase(
          "Debriefing",
          "book",
          <View>
            {renderDetailRow("Landung", formatTime(entry.debriefing?.landingTime))}
            {entry.debriefing?.flightDurationMinutes
              ? renderDetailRow("Flugdauer", formatDuration(entry.debriefing.flightDurationMinutes))
              : null}
            {entry.debriefing?.batteryUsedPercent
              ? renderDetailRow("Akku verbraucht", `${entry.debriefing.batteryUsedPercent}%`)
              : null}
            {(() => {
              const pre = entry.preflight?.batteryUsage || [];
              const post = entry.debriefing?.batteryUsage || [];
              const merged = new Map<string, { name: string; serial: string; before?: number; after?: number }>();
              for (const u of pre) {
                merged.set(u.batteryId, { name: u.name, serial: u.serialNumber, before: u.percentBefore });
              }
              for (const u of post) {
                const ex = merged.get(u.batteryId);
                merged.set(u.batteryId, {
                  name: u.name,
                  serial: u.serialNumber,
                  before: ex?.before,
                  after: u.percentAfter,
                });
              }
              if (merged.size === 0) return null;
              return (
                <View style={{ marginTop: Spacing.sm }}>
                  <ThemedText style={[styles.checklistLabel, { color: theme.textSecondary, marginBottom: 4 }]}>
                    Verwendete Akkus:
                  </ThemedText>
                  {Array.from(merged.entries()).map(([batteryId, info]) => (
                    <Pressable
                      key={batteryId}
                      testID={`battery-link-${batteryId}`}
                      onPress={() => {
                        if (!entry.droneId) return;
                        (navigation as any).navigate("BatteryDetail", {
                          droneId: entry.droneId,
                          batteryId,
                        });
                      }}
                      style={({ pressed }) => [
                        styles.batteryLinkRow,
                        { borderColor: theme.border, backgroundColor: theme.backgroundSecondary },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Feather name="battery" size={16} color={theme.primary} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ ...Typography.body, fontWeight: "600" }}>{info.name}</ThemedText>
                        <ThemedText style={[styles.checklistLabel, { color: theme.textSecondary }]}>
                          SN: {info.serial || "—"}
                          {typeof info.before === "number" ? ` · Start ${info.before}%` : ""}
                          {typeof info.after === "number" ? ` · Ende ${info.after}%` : ""}
                        </ThemedText>
                      </View>
                      <Feather name="chevron-right" size={18} color={theme.textSecondary} />
                    </Pressable>
                  ))}
                </View>
              );
            })()}
            {entry.debriefing?.incidentOccurred ? (
              <View style={[styles.alertBox, { backgroundColor: theme.statusNoGoBackground }]}>
                <Feather name="alert-triangle" size={14} color={theme.statusNoGo} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.alertLabel, { color: theme.statusNoGo }]}>Vorfall aufgetreten</ThemedText>
                  {entry.debriefing.incidentDescription ? (
                    <ThemedText style={styles.alertText}>{entry.debriefing.incidentDescription}</ThemedText>
                  ) : null}
                </View>
              </View>
            ) : null}
            {entry.debriefing?.maintenanceRequired ? (
              <View style={[styles.alertBox, { backgroundColor: theme.statusCautionBackground }]}>
                <Feather name="tool" size={14} color={theme.statusCaution} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.alertLabel, { color: theme.statusCaution }]}>Wartung erforderlich</ThemedText>
                  {entry.debriefing.maintenanceNotes ? (
                    <ThemedText style={styles.alertText}>{entry.debriefing.maintenanceNotes}</ThemedText>
                  ) : null}
                </View>
              </View>
            ) : null}
            {entry.debriefing?.generalNotes ? (
              <View style={styles.notesBox}>
                <ThemedText style={[styles.checklistLabel, { color: theme.textSecondary }]}>Notizen:</ThemedText>
                <ThemedText style={styles.notesText}>{entry.debriefing.generalNotes}</ThemedText>
              </View>
            ) : null}
          </View>,
          !!entry.debriefing,
          "debriefing",
        )}

        {entry.hasRestrictions ? (
          <View style={[styles.alertBox, { backgroundColor: theme.statusCautionBackground, marginBottom: Spacing.md }]}>
            <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.alertLabel, { color: theme.statusCaution }]}>Einschränkungen vorhanden</ThemedText>
              {entry.restrictionNotes ? (
                <ThemedText style={styles.alertText}>{entry.restrictionNotes}</ThemedText>
              ) : null}
            </View>
          </View>
        ) : null}

        {entry.planning?.officialMapCrossCheck ? (
          <View
            testID="box-crosscheck"
            style={[
              styles.alertBox,
              {
                backgroundColor: entry.planning.officialMapCrossCheck.blocking
                  ? theme.statusCautionBackground
                  : theme.statusGoBackground,
                marginBottom: Spacing.md,
              },
            ]}
          >
            <Feather
              name={entry.planning.officialMapCrossCheck.blocking ? "alert-triangle" : "check-circle"}
              size={14}
              color={entry.planning.officialMapCrossCheck.blocking ? theme.statusCaution : theme.statusGo}
            />
            <View style={{ flex: 1 }}>
              <ThemedText
                style={[
                  styles.alertLabel,
                  { color: entry.planning.officialMapCrossCheck.blocking ? theme.statusCaution : theme.statusGo },
                ]}
              >
                Offizielle Karte gegengeprüft:{" "}
                {entry.planning.officialMapCrossCheck.blocking
                  ? "startverhindernde Geozonen"
                  : "keine startverhindernden Geozonen"}
              </ThemedText>
              {entry.planning.officialMapCrossCheck.note ? (
                <ThemedText style={styles.alertText}>
                  Notiz: {entry.planning.officialMapCrossCheck.note}
                </ThemedText>
              ) : null}
            </View>
          </View>
        ) : null}

        {resolvedDocs.length > 0 ? (
          <Card style={styles.section}>
            <View style={styles.headerRow}>
              <Feather name="paperclip" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Hinterlegte Dokumente</ThemedText>
            </View>
            <ThemedText style={[styles.alertText, { marginBottom: Spacing.sm }]}>
              Zum Flugzeitpunkt gültige Pilotendokumente. Werden auf Wunsch dem PDF-Export beigefügt.
            </ThemedText>
            {resolvedDocs.map((doc, idx) => (
              <View
                key={`${doc.type}-${doc.bundesland ?? ""}-${idx}`}
                testID={`row-doc-${doc.type}`}
                style={[styles.docRow, { borderColor: theme.border }]}
              >
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.docLabel}>{doc.label}</ThemedText>
                  <ThemedText style={[styles.docMeta, { color: theme.textTertiary }]}>
                    {doc.matchedExactly
                      ? "Zum Flugzeitpunkt gültige Fassung"
                      : "Bestmögliche Fassung"}
                    {doc.expirationDate ? ` · gültig bis ${doc.expirationDate}` : ""}
                    {doc.source === "archive" ? " · archiviert" : ""}
                  </ThemedText>
                </View>
                {doc.document ? (
                  <Pressable
                    testID={`button-view-doc-${doc.type}`}
                    onPress={async () => {
                      try {
                        await viewDocument(doc.document!);
                      } catch {
                        Alert.alert("Fehler", "Dokument konnte nicht geöffnet werden.");
                      }
                    }}
                    style={({ pressed }) => [
                      styles.docViewButton,
                      { backgroundColor: theme.primary + "15" },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Feather name="eye" size={14} color={theme.primary} />
                    <ThemedText style={[styles.docViewText, { color: theme.primary }]}>Ansehen</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <View onLayout={(e) => registerSectionLayout("fluglog", e.nativeEvent.layout.y)}>
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <Feather name="file-text" size={16} color={theme.primary} />
            <ThemedText style={styles.headerText}>Fluglog</ThemedText>
          </View>
          {renderDjiSection()}
          <Pressable
            testID="button-dji-add"
            disabled={uploadingDji}
            onPress={handleDjiUpload}
            style={({ pressed }) => [
              styles.djiButton,
              { backgroundColor: theme.primary + "15", marginTop: Spacing.md },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name="plus-circle" size={15} color={theme.primary} />
            <ThemedText style={[styles.djiButtonText, { color: theme.primary }]}>
              {uploadingDji
                ? "Wird ausgewertet …"
                : djiLogs.length > 0
                ? "Weiteres Fluglog hinzufügen (Akku-Tausch)"
                : "Fluglog hinzufügen"}
            </ThemedText>
          </Pressable>
          <View style={{ marginTop: Spacing.md }}>
            <DjiLogHelp />
          </View>
        </Card>
        </View>

        <Pressable
          onPress={async () => {
            if (!promptFeatureUpgrade(entitlement, "pdf_export")) return;
            const runExport = async (includeDocs: boolean) => {
              try {
                await exportFlightProtocolPdf(entry, { includeDocs });
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                Alert.alert("Fehler", "Protokoll konnte nicht erstellt werden.");
              }
            };
            if (resolvedDocs.length > 0) {
              const message =
                "Die zum Flugzeitpunkt gültigen Dokumente (Allgemeinverfügung, A2-Zeugnis, Versicherung) können dem Protokoll beigefügt werden.";
              Alert.alert(
                "Dokumente anhängen?",
                message,
                [
                  { text: "Ohne Dokumente", onPress: () => runExport(false) },
                  { text: "Mit Dokumenten", onPress: () => runExport(true) },
                ],
              );
            } else {
              await runExport(false);
            }
          }}
          style={({ pressed }) => [
            styles.pdfButton,
            { backgroundColor: theme.primary + "15" },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="clipboard" size={16} color={theme.primary} />
          <ThemedText style={[styles.pdfButtonText, { color: theme.primary }]}>Protokoll als PDF</ThemedText>
        </Pressable>

        <ShareControls entry={entry} onEntryChange={setEntry} style={styles.section} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  notFoundTitle: { ...Typography.h3, textAlign: "center" },
  statusRow: { alignItems: "center", marginBottom: Spacing.lg, gap: Spacing.sm },
  dateText: { ...Typography.body },
  section: { padding: Spacing.lg, marginBottom: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  headerText: { ...Typography.body, fontWeight: "600" },
  classBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: 6 },
  classText: { ...Typography.caption, fontWeight: "700" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginBottom: Spacing.sm },
  locationText: { ...Typography.caption },
  metaRow: { gap: Spacing.xs },
  phaseCard: { padding: Spacing.lg, marginBottom: Spacing.md, borderLeftWidth: 3, borderLeftColor: "#52c41a" },
  phaseHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  phaseTitle: { ...Typography.body, fontWeight: "600" },
  detailRow: { flexDirection: "row", gap: Spacing.sm, marginBottom: 4 },
  detailLabel: { ...Typography.caption, minWidth: 110 },
  detailValue: { ...Typography.caption, flex: 1, fontWeight: "500" },
  weatherBox: { borderRadius: 8, padding: Spacing.md, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  weatherLabel: { ...Typography.caption, fontWeight: "600", marginBottom: Spacing.xs },
  weatherGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  weatherItem: { alignItems: "center", minWidth: 60 },
  weatherValue: { ...Typography.body, fontWeight: "600" },
  weatherItemLabel: { ...Typography.caption, fontSize: 10 },
  checklistSection: { marginTop: Spacing.sm },
  checklistLabel: { ...Typography.caption, fontWeight: "600", marginBottom: Spacing.xs },
  checklistGrid: { gap: 4 },
  checklistItem: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  checklistText: { ...Typography.caption },
  vlosWarningBox: { borderWidth: 1, borderRadius: 8, padding: Spacing.md, marginTop: Spacing.sm, marginBottom: Spacing.sm, backgroundColor: "rgba(197, 48, 48, 0.08)" },
  vlosWarningHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginBottom: Spacing.xs },
  vlosWarningTitle: { ...Typography.caption, fontWeight: "700", color: "#C53030" },
  vlosWarningText: { ...Typography.caption, marginTop: 2 },
  alertBox: { flexDirection: "row", gap: Spacing.sm, padding: Spacing.md, borderRadius: 8, marginTop: Spacing.sm, alignItems: "flex-start" },
  alertLabel: { ...Typography.caption, fontWeight: "700", marginBottom: 2 },
  alertText: { ...Typography.caption },
  notesBox: { marginTop: Spacing.sm },
  notesText: { ...Typography.body },
  mapWrapper: { borderWidth: 1, borderRadius: 12, overflow: "hidden", marginBottom: Spacing.md },
  mapImage: { width: "100%", height: 180 },
  pdfButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, padding: Spacing.lg, borderRadius: 12, marginTop: Spacing.md },
  batteryLinkRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: 1, borderRadius: 10, marginTop: 6 },
  pdfButtonText: { ...Typography.body, fontWeight: "600" },
  docRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  docLabel: { ...Typography.body, fontWeight: "600" },
  docMeta: { ...Typography.caption, marginTop: 2 },
  docViewButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: 10 },
  docViewText: { ...Typography.caption, fontWeight: "600" },
  shareButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, padding: Spacing.md, borderRadius: 10 },
  shareButtonText: { ...Typography.body, fontWeight: "600" },
  shareToggleRow: { flexDirection: "row", alignItems: "center", marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  shareToggleTitle: { ...Typography.body, fontWeight: "600" },
  shareToggleHint: { ...Typography.caption, marginTop: 2 },
  togglePill: { minWidth: 56, alignItems: "center", paddingVertical: 6, paddingHorizontal: Spacing.md, borderRadius: 20, borderWidth: 1 },
  togglePillText: { ...Typography.caption, fontWeight: "700" },
  shareActiveBox: { marginTop: Spacing.md },
  shareLinkText: { ...Typography.caption, marginBottom: Spacing.sm },
  shareActionsRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  smallAction: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: Spacing.md, borderRadius: 8, borderWidth: 1 },
  smallActionText: { ...Typography.caption, fontWeight: "600" },
  djiNotice: { ...Typography.caption, marginBottom: Spacing.sm },
  djiButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: 10, marginTop: Spacing.sm },
  djiButtonText: { ...Typography.body, fontWeight: "600", flexShrink: 1 },
  djiSubLabel: { ...Typography.caption, fontWeight: "700", marginBottom: 4 },
  djiLogCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: 2 },
  djiLogHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: 4 },
  djiColorDot: { width: 12, height: 12, borderRadius: 6 },
  djiLogTitle: { ...Typography.body, fontWeight: "700", flex: 1 },
  djiAggBox: { padding: Spacing.md, borderRadius: BorderRadius.md, marginBottom: Spacing.sm, gap: 2 },
  djiBatterySection: { marginTop: Spacing.xs },
  djiBatteryList: { gap: Spacing.xs, marginTop: Spacing.xs },
  djiBatteryRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.sm, borderRadius: BorderRadius.sm, borderWidth: 1 },
  djiBatteryName: { ...Typography.small, fontWeight: "500", flex: 1 },
});
