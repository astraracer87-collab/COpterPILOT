import React, { useCallback, useState, useMemo, useSyncExternalStore } from "react";
import { removeDuplicateDjiLogEntries } from "@/lib/djiLog";
import { View, StyleSheet, FlatList, RefreshControl, Pressable, Alert, ScrollView, Image, GestureResponderEvent } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import StatusBadge from "@/components/StatusBadge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getLogbook, LogbookEntry, getBriefings, Briefing, getDrone, deleteLogbookEntry, deleteBriefing } from "@/lib/storage";
import { getCheckItemLabel } from "@/lib/checklists";
import { exportLogbookPdf, exportSingleEntryPdf, exportFlightProtocolPdf } from "@/lib/pdfExport";
import { useAuth } from "@/lib/auth";
import { promptFeatureUpgrade } from "@/components/FeatureGate";
import { ShareControls } from "@/components/ShareControls";
import type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";
import { formatPlannedTimeRange } from "@/lib/planningDateTime";
import { getDjiLogAutoImported, getDjiLogNewHint, getDjiLogNewHintVersion, subscribeDjiLogNewHint } from "@/lib/djiLogFolder";

type NavigationProp = NativeStackNavigationProp<HistoryStackParamList>;

interface LogbookDisplayItem {
  type: "logbook" | "briefing";
  id: string;
  date: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  droneName?: string;
  droneClass?: string;
  flightDuration?: number;
  status: "go" | "caution" | "nogo";
  hasIncident?: boolean;
  entry?: LogbookEntry;
  briefing?: Briefing;
}

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

function LogbookCard({ item, index, onDelete }: { item: LogbookDisplayItem; index: number; onDelete: () => void }) {
  const { theme } = useTheme();
  const { entitlement } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const [expanded, setExpanded] = useState(false);
  const [entry, setEntry] = useState(item.entry);

  const toggleExpanded = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(!expanded);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatTime = (timeString?: string) => {
    if (!timeString) return null;
    const date = new Date(timeString);
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return null;
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}min`;
  };

  const handleOpenMap = () => {
    if (item.latitude && item.longitude) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const radiusKm = entry?.planning?.radiusKm;
      navigation.navigate("LocationMap", {
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.locationName || "Flugort",
        radiusM: typeof radiusKm === "number" && radiusKm > 0 ? radiusKm * 1000 : undefined,
      });
    }
  };

  const getCompletedPhases = () => {
    const phases: string[] = [];
    if (Array.isArray(entry?.planning?.checklistCompleted) && entry.planning.checklistCompleted.length > 0) phases.push("planning");
    if (entry?.preflight?.completedAt) phases.push("preflight");
    if ((Array.isArray(entry?.hoverCheck?.checklistCompleted) && entry.hoverCheck.checklistCompleted.length > 0) || entry?.hoverCheck?.skippedFlightCheck) phases.push("hover");
    if (Array.isArray(entry?.debriefing?.checklistCompleted) && entry.debriefing.checklistCompleted.length > 0) phases.push("debriefing");
    return phases;
  };

  const renderPhaseIcons = () => {
    const completedPhases = new Set(getCompletedPhases());
    const hasFluglog = !!(entry && ((entry.djiLogs?.length ?? 0) > 0 || entry.djiLog));
    type PhasePoint = {
      id: string;
      icon: keyof typeof Feather.glyphMap;
      focus: "planning" | "preflight" | "hover" | "debriefing" | "fluglog";
    };
    const allPhases: PhasePoint[] = [
      { id: "planning", icon: "calendar", focus: "planning" },
      { id: "preflight", icon: "clipboard", focus: "preflight" },
      { id: "hover", icon: "navigation", focus: "hover" },
      { id: "debriefing", icon: "book", focus: "debriefing" },
    ];
    if (hasFluglog) {
      allPhases.push({ id: "fluglog", icon: "file-text", focus: "fluglog" });
    }

    const handlePhasePress = (
      focus: PhasePoint["focus"],
      e?: GestureResponderEvent,
    ) => {
      e?.stopPropagation?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (entry) {
        navigation.navigate("LogbookEntryDetail", {
          logbookEntryId: entry.id,
          focusSection: focus,
        });
      } else {
        toggleExpanded();
      }
    };

    return (
      <View style={styles.phasesRow}>
        {allPhases.map((phase, idx) => {
          const isComplete = phase.id === "fluglog" ? hasFluglog : completedPhases.has(phase.id);
          return (
            <React.Fragment key={phase.id}>
              <Pressable
                testID={`phase-icon-${phase.id}`}
                onPress={(e) => handlePhasePress(phase.focus, e)}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.phaseIconContainer,
                  isComplete && styles.phaseIconComplete,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Feather 
                  name={phase.icon} 
                  size={14} 
                  color={isComplete ? theme.statusGo : theme.textTertiary} 
                />
              </Pressable>
              {idx < allPhases.length - 1 ? (
                <View style={[styles.phaseConnector, { backgroundColor: isComplete ? theme.statusGo : theme.border }]} />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  const renderWeatherInfo = (weather: any, label: string) => {
    if (!weather) return null;
    return (
      <View style={[styles.weatherBox, { backgroundColor: theme.backgroundSecondary }]}>
        <ThemedText style={[styles.weatherLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <View style={styles.weatherGrid}>
          <View style={styles.weatherItem}>
            <ThemedText style={styles.weatherValue}>{weather.temperature?.toFixed(0)}°C</ThemedText>
            <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Temp</ThemedText>
          </View>
          <View style={styles.weatherItem}>
            <ThemedText style={styles.weatherValue}>{weather.windSpeed?.toFixed(1)} m/s</ThemedText>
            <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Wind</ThemedText>
          </View>
          {weather.windGust ? (
            <View style={styles.weatherItem}>
              <ThemedText style={styles.weatherValue}>{weather.windGust?.toFixed(1)} m/s</ThemedText>
              <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Böen</ThemedText>
            </View>
          ) : null}
          <View style={styles.weatherItem}>
            <ThemedText style={styles.weatherValue}>{weather.rain?.toFixed(1)} mm</ThemedText>
            <ThemedText style={[styles.weatherItemLabel, { color: theme.textTertiary }]}>Regen</ThemedText>
          </View>
        </View>
      </View>
    );
  };

  const renderDetailedChecklist = (
    presentedItems: string[],
    completedItems: string[],
    label: string
  ) => {
    if (!presentedItems || presentedItems.length === 0) return null;
    const completedSet = new Set(completedItems || []);
    const filteredItems = presentedItems.filter(id => !DEPRECATED_CHECKLIST_IDS.includes(id));
    if (filteredItems.length === 0) return null;
    
    return (
      <View style={styles.checklistSection}>
        <ThemedText style={[styles.checklistLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <View style={styles.checklistGrid}>
          {filteredItems.map((id) => {
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
                    { color: isChecked ? theme.statusGo : theme.textTertiary }
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

  const renderChecklist = (items: string[], label: string) => {
    if (!items || items.length === 0) return null;
    const filteredItems = items.filter(id => !DEPRECATED_CHECKLIST_IDS.includes(id));
    if (filteredItems.length === 0) return null;
    return (
      <View style={styles.checklistSection}>
        <ThemedText style={[styles.checklistLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
        <View style={styles.checklistGrid}>
          {filteredItems.map((id) => (
            <View key={id} style={styles.checklistItem}>
              <Feather name="check-circle" size={14} color={theme.statusGo} />
              <ThemedText style={[styles.checklistText, { color: theme.statusGo }]}>
                {CHECKLIST_LABELS[id] || getCheckItemLabel(id) || id}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderPhaseSection = (
    title: string,
    icon: keyof typeof Feather.glyphMap,
    content: React.ReactNode,
    isPresent: boolean
  ) => {
    if (!isPresent) return null;
    return (
      <View style={[styles.phaseSection, { borderLeftColor: theme.statusGo }]}>
        <View style={styles.phaseSectionHeader}>
          <Feather name={icon} size={14} color={theme.statusGo} />
          <ThemedText style={styles.phaseSectionTitle}>{title}</ThemedText>
        </View>
        {content}
      </View>
    );
  };

  const renderExpandedContent = () => {
    if (!entry) return null;

    return (
      <View style={styles.expandedContent}>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />

        {item.latitude && item.longitude ? (
          <Pressable
            onPress={handleOpenMap}
            style={({ pressed }) => [
              styles.locationLink,
              { backgroundColor: theme.primary + "15" },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name="map" size={16} color={theme.primary} />
            <ThemedText style={[styles.locationLinkText, { color: theme.primary }]}>
              {item.locationName || `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`}
            </ThemedText>
            <Feather name="external-link" size={14} color={theme.primary} />
          </Pressable>
        ) : null}

        {entry?.mapSnapshotBase64 ? (
          <View style={[styles.mapSnapshotWrapper, { borderColor: theme.border }]}>
            <Image
              source={{ uri: `data:image/jpeg;base64,${entry.mapSnapshotBase64}` }}
              style={styles.mapSnapshotImage}
              resizeMode="cover"
            />
            <View style={styles.mapSnapshotCaption}>
              <Feather name="map" size={11} color="#fff" />
              <ThemedText style={styles.mapSnapshotCaptionText}>Geplantes Fluggebiet</ThemedText>
            </View>
          </View>
        ) : null}

        {renderPhaseSection(
          "Planung",
          "calendar",
          <View style={styles.phaseSectionContent}>
            {entry.planning?.plannedDate ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Datum:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.planning.plannedDate}</ThemedText>
              </View>
            ) : null}
            {entry.planning?.plannedTime ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Uhrzeit:</ThemedText>
                <ThemedText style={styles.detailValue}>
                  {(() => {
                    return formatPlannedTimeRange(entry.planning.plannedTime, entry.planning.plannedEndTime);
                  })()}
                </ThemedText>
              </View>
            ) : null}
            {entry.planning?.flightPurpose ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Zweck:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.planning.flightPurpose}</ThemedText>
              </View>
            ) : null}
            {entry.planning?.maxAltitude ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Max. Höhe:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.planning.maxAltitude}m</ThemedText>
              </View>
            ) : null}
            {renderWeatherInfo(entry.planning?.forecastWeather, "Vorhersage")}
            {entry.planning?.checklistPresented && entry.planning.checklistPresented.length > 0
              ? renderDetailedChecklist(
                  entry.planning.checklistPresented,
                  entry.planning.checklistCompleted || [],
                  "Planungs-Checks"
                )
              : renderChecklist(entry.planning?.checklistCompleted || [], "Planungs-Checks")
            }
          </View>,
          !!entry.planning
        )}

        {renderPhaseSection(
          "Pre-Check",
          "clipboard",
          <View style={styles.phaseSectionContent}>
            {entry.preflight?.completedAt ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Abgeschlossen:</ThemedText>
                <ThemedText style={styles.detailValue}>{formatTime(entry.preflight.completedAt)}</ThemedText>
              </View>
            ) : null}
            {renderWeatherInfo(entry.preflight?.actualWeather, "Aktuelles Wetter")}
            {entry.preflight?.equipmentNotes ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Equipment:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.preflight.equipmentNotes}</ThemedText>
              </View>
            ) : null}
            {entry.preflight?.checklistPresented && entry.preflight.checklistPresented.length > 0
              ? renderDetailedChecklist(
                  entry.preflight.checklistPresented,
                  entry.preflight.checklistCompleted || [],
                  "Pre-Check Items"
                )
              : renderChecklist(entry.preflight?.checklistCompleted || [], "Pre-Check Items")
            }
          </View>,
          !!entry.preflight
        )}

        {renderPhaseSection(
          "Im Flug",
          "navigation",
          <View style={styles.phaseSectionContent}>
            {entry.hoverCheck?.takeoffTime ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Start:</ThemedText>
                <ThemedText style={styles.detailValue}>{formatTime(entry.hoverCheck.takeoffTime)}</ThemedText>
              </View>
            ) : null}
            {entry.hoverCheck?.landingTime ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Landung:</ThemedText>
                <ThemedText style={styles.detailValue}>{formatTime(entry.hoverCheck.landingTime)}</ThemedText>
              </View>
            ) : null}
            {entry.hoverCheck?.hoverStable !== undefined ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Hover stabil:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.hoverCheck.hoverStable ? "Ja" : "Nein"}</ThemedText>
              </View>
            ) : null}
            {entry.hoverCheck?.controlsOk !== undefined ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Steuerung OK:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.hoverCheck.controlsOk ? "Ja" : "Nein"}</ThemedText>
              </View>
            ) : null}
            {entry.hoverCheck?.signalOk !== undefined ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Signal OK:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.hoverCheck.signalOk ? "Ja" : "Nein"}</ThemedText>
              </View>
            ) : null}
            {renderChecklist(entry.hoverCheck?.checklistCompleted || [], "Flug-Checks")}
          </View>,
          !!entry.hoverCheck
        )}

        {renderPhaseSection(
          "Nach Landung",
          "flag",
          <View style={styles.phaseSectionContent}>
            {entry.postLanding?.damageChecked !== undefined ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Schäden geprüft:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.postLanding.damageChecked ? "Ja" : "Nein"}</ThemedText>
              </View>
            ) : null}
            {entry.postLanding?.uasPoweredOff !== undefined ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>UAS ausgeschaltet:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.postLanding.uasPoweredOff ? "Ja" : "Nein"}</ThemedText>
              </View>
            ) : null}
            {renderChecklist(entry.postLanding?.checklistCompleted || [], "Post-Landing Checks")}
          </View>,
          !!entry.postLanding
        )}

        {renderPhaseSection(
          "Debriefing",
          "book",
          <View style={styles.phaseSectionContent}>
            {entry.debriefing?.landingTime ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Landung:</ThemedText>
                <ThemedText style={styles.detailValue}>{formatTime(entry.debriefing.landingTime)}</ThemedText>
              </View>
            ) : null}
            {entry.debriefing?.flightDurationMinutes ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Flugdauer:</ThemedText>
                <ThemedText style={styles.detailValue}>{formatDuration(entry.debriefing.flightDurationMinutes)}</ThemedText>
              </View>
            ) : null}
            {entry.debriefing?.batteryUsedPercent ? (
              <View style={styles.detailRow}>
                <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>Akku verbraucht:</ThemedText>
                <ThemedText style={styles.detailValue}>{entry.debriefing.batteryUsedPercent}%</ThemedText>
              </View>
            ) : null}
            {entry.debriefing?.incidentOccurred ? (
              <View style={[styles.incidentBox, { backgroundColor: theme.statusNoGoBackground }]}>
                <Feather name="alert-triangle" size={14} color={theme.statusNoGo} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.incidentLabel, { color: theme.statusNoGo }]}>Vorfall aufgetreten</ThemedText>
                  {entry.debriefing.incidentDescription ? (
                    <ThemedText style={[styles.incidentDescription, { color: theme.text }]}>
                      {entry.debriefing.incidentDescription}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            ) : null}
            {entry.debriefing?.maintenanceRequired ? (
              <View style={[styles.maintenanceBox, { backgroundColor: theme.statusCautionBackground }]}>
                <Feather name="tool" size={14} color={theme.statusCaution} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.maintenanceLabel, { color: theme.statusCaution }]}>Wartung erforderlich</ThemedText>
                  {entry.debriefing.maintenanceNotes ? (
                    <ThemedText style={[styles.maintenanceDescription, { color: theme.text }]}>
                      {entry.debriefing.maintenanceNotes}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            ) : null}
            {entry.debriefing?.generalNotes ? (
              <View style={styles.notesBox}>
                <ThemedText style={[styles.notesLabel, { color: theme.textSecondary }]}>Notizen:</ThemedText>
                <ThemedText style={styles.notesText}>{entry.debriefing.generalNotes}</ThemedText>
              </View>
            ) : null}
          </View>,
          !!entry.debriefing
        )}

        {entry.hasRestrictions ? (
          <View style={[styles.restrictionsBox, { backgroundColor: theme.statusCautionBackground }]}>
            <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
            <View style={{ flex: 1 }}>
              <ThemedText style={[styles.restrictionsLabel, { color: theme.statusCaution }]}>
                Einschränkungen vorhanden
              </ThemedText>
              {entry.restrictionNotes ? (
                <ThemedText style={[styles.restrictionsText, { color: theme.text }]}>
                  {entry.restrictionNotes}
                </ThemedText>
              ) : null}
            </View>
          </View>
        ) : null}

        <Pressable
          testID={`button-open-flight-detail-${entry.id}`}
          onPress={() => navigation.navigate("LogbookEntryDetail", { logbookEntryId: entry.id })}
          style={({ pressed }) => [
            styles.pdfButton,
            { backgroundColor: theme.primary + "15", marginBottom: Spacing.sm },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Feather name="file-text" size={16} color={theme.primary} />
          <ThemedText style={[styles.pdfButtonText, { color: theme.primary }]}>
            Flugdetails & Fluglog
          </ThemedText>
        </Pressable>

        <View style={styles.exportButtons}>
          <Pressable
            onPress={async () => {
              if (!promptFeatureUpgrade(entitlement, "pdf_export")) return;
              try {
                await exportFlightProtocolPdf(entry);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e) {
                Alert.alert("Fehler", "Protokoll konnte nicht erstellt werden.");
              }
            }}
            style={({ pressed }) => [
              styles.pdfButton,
              { backgroundColor: theme.primary + "15", flex: 1 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name="clipboard" size={16} color={theme.primary} />
            <ThemedText style={[styles.pdfButtonText, { color: theme.primary }]}>
              Protokoll
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={async () => {
              if (!promptFeatureUpgrade(entitlement, "pdf_export")) return;
              try {
                await exportSingleEntryPdf(entry);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e) {
                Alert.alert("Fehler", "PDF konnte nicht erstellt werden.");
              }
            }}
            style={({ pressed }) => [
              styles.pdfButton,
              { backgroundColor: theme.primary + "15", flex: 1 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name="file-text" size={16} color={theme.primary} />
            <ThemedText style={[styles.pdfButtonText, { color: theme.primary }]}>
              Logbuch-PDF
            </ThemedText>
          </Pressable>
        </View>

        <ShareControls entry={entry} onEntryChange={setEntry} style={{ marginTop: Spacing.sm, marginBottom: 0 }} />
      </View>
    );
  };

  if (item.type === "briefing") {
    return (
      <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
        <Card 
          style={styles.card}
          onPress={() => navigation.navigate("BriefingDetail", { briefingId: item.id })}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardInfo}>
              <ThemedText style={styles.dateText}>{formatDate(item.date)}</ThemedText>
              {item.locationName ? (
                <View style={styles.locationRow}>
                  <Feather name="map-pin" size={12} color={theme.textTertiary} />
                  <ThemedText style={[styles.locationText, { color: theme.textTertiary }]}>
                    {item.locationName}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <StatusBadge status={item.status} size="small" />
          </View>
        </Card>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
      <Card style={styles.card}>
        <Pressable
          onPress={() =>
            entry
              ? navigation.navigate("LogbookEntryDetail", { logbookEntryId: entry.id })
              : toggleExpanded()
          }
          onLongPress={onDelete}
          delayLongPress={500}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardInfo}>
              <View style={styles.topRow}>
                <ThemedText style={styles.dateText}>{formatDate(item.date)}</ThemedText>
                <StatusBadge status={item.status} size="small" />
              </View>
              
              {item.droneName ? (
                <View style={styles.droneRow}>
                  <Feather name="send" size={12} color={theme.textSecondary} />
                  <ThemedText style={[styles.droneText, { color: theme.textSecondary }]}>
                    {item.droneName}
                  </ThemedText>
                  {item.droneClass ? (
                    <View style={[styles.classBadge, { backgroundColor: theme.backgroundSecondary }]}>
                      <ThemedText style={[styles.classText, { color: theme.primary }]}>
                        {item.droneClass}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : null}
              
              <View style={styles.phaseProgressRow}>
                {renderPhaseIcons()}
              </View>
              
              <View style={styles.bottomRow}>
                {item.locationName ? (
                  <View style={styles.locationRow}>
                    <Feather name="map-pin" size={12} color={theme.textTertiary} />
                    <ThemedText style={[styles.locationText, { color: theme.textTertiary }]}>
                      {item.locationName}
                    </ThemedText>
                  </View>
                ) : null}
                
                <View style={styles.rightInfo}>
                  {item.flightDuration ? (
                    <View style={styles.durationBadge}>
                      <Feather name="clock" size={12} color={theme.textSecondary} />
                      <ThemedText style={[styles.durationText, { color: theme.textSecondary }]}>
                        {formatDuration(item.flightDuration)}
                      </ThemedText>
                    </View>
                  ) : null}
                  {item.hasIncident ? (
                    <View style={[styles.incidentBadge, { backgroundColor: theme.statusNoGoBackground }]}>
                      <Feather name="alert-circle" size={12} color={theme.statusNoGo} />
                      <ThemedText style={[styles.incidentBadgeText, { color: theme.statusNoGo }]}>
                        Vorfall
                      </ThemedText>
                    </View>
                  ) : null}
                  <Feather 
                    name="chevron-right" 
                    size={18} 
                    color={theme.textTertiary} 
                  />
                </View>
              </View>
            </View>
            {entry?.routeMapSnapshotBase64 || entry?.mapSnapshotBase64 ? (
              <Image
                source={{
                  uri: `data:image/jpeg;base64,${entry.routeMapSnapshotBase64 || entry.mapSnapshotBase64}`,
                }}
                style={[styles.cardThumb, { borderColor: theme.border }]}
                resizeMode="cover"
              />
            ) : null}
          </View>
        </Pressable>

        {expanded ? renderExpandedContent() : null}
      </Card>
    </Animated.View>
  );
}

export default function HistoryScreen() {
  const { theme } = useTheme();
  const { entitlement } = useAuth();
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [items, setItems] = useState<LogbookDisplayItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDrone, setSelectedDrone] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      // doppelt importierte DJI-Flüge vor der Anzeige entfernen
      await removeDuplicateDjiLogEntries().catch(() => 0);
      const [logbook, briefings] = await Promise.all([
        getLogbook(),
        getBriefings(),
      ]);
      
      const displayItems: LogbookDisplayItem[] = [];
      
      for (const entry of logbook) {
        displayItems.push({
          type: "logbook",
          id: entry.id,
          date: entry.flightDate,
          locationName: entry.locationName,
          latitude: entry.latitude,
          longitude: entry.longitude,
          droneName: entry.droneName,
          droneClass: entry.droneClass,
          flightDuration: entry.flightDurationMinutes,
          status: entry.status || "go",
          hasIncident: entry.incidentOccurred,
          entry,
        });
      }
      
      const completedBriefings = briefings.filter((b: Briefing) => b.completed);
      for (const briefing of completedBriefings) {
        const drone = briefing.droneId ? await getDrone(briefing.droneId) : null;
        displayItems.push({
          type: "briefing",
          id: briefing.id,
          date: briefing.createdAt,
          locationName: briefing.locationName,
          droneName: drone?.name,
          droneClass: drone?.classMark,
          status: briefing.status,
          briefing,
        });
      }
      
      displayItems.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      setItems(displayItems);
    } catch (error) {
      console.error("Failed to load logbook:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Stille Prüfung beim App-Start (Einstellungen → DJI-Flugprotokolle – Speicherort)
  useSyncExternalStore(subscribeDjiLogNewHint, getDjiLogNewHintVersion, getDjiLogNewHintVersion);
  const djiNewLogs = getDjiLogNewHint() ?? 0;
  const djiAutoImported = getDjiLogAutoImported();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const uniqueDrones = useMemo(() => {
    const droneNames = items
      .map(item => item.droneName)
      .filter((name): name is string => !!name);
    return [...new Set(droneNames)];
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!selectedDrone) return items;
    return items.filter(item => item.droneName === selectedDrone);
  }, [items, selectedDrone]);

  const toggleDroneFilter = (droneName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDrone(prev => prev === droneName ? null : droneName);
  };

  const handleExportAll = useCallback(async () => {
    if (!promptFeatureUpgrade(entitlement, "pdf_export")) return;
    const logbookEntries = items
      .filter((i) => i.type === "logbook" && i.entry)
      .map((i) => i.entry as LogbookEntry);
    if (logbookEntries.length === 0) {
      Alert.alert("Hinweis", "Keine Logbuch-Eintraege zum Exportieren.");
      return;
    }
    try {
      await exportLogbookPdf(logbookEntries);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Fehler", "PDF konnte nicht erstellt werden.");
    }
  }, [items]);

  const handleDelete = useCallback((item: LogbookDisplayItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Eintrag löschen",
      "Möchtest du diesen Logbuch-Eintrag wirklich löschen?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            try {
              if (item.type === "logbook") {
                await deleteLogbookEntry(item.id);
              } else if (item.type === "briefing") {
                await deleteBriefing(item.id);
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              loadData();
            } catch (error) {
              Alert.alert("Fehler", "Eintrag konnte nicht gelöscht werden.");
            }
          },
        },
      ]
    );
  }, [loadData]);

  // DJI-Fluglogs: Auswertung auf dem Gerät (dji-log-parser in einer
  // versteckten WebView), Sammel-Import und Akku-Statistik.
  const renderDjiEntry = () => (
    <View style={styles.djiEntryRow}>
      <Pressable
        testID="button-dji-analyze-entry"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate("DjiAnalyze");
        }}
        style={({ pressed }) => [
          styles.djiEntryButton,
          { backgroundColor: theme.primary + "15", borderColor: theme.primary + "30" },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Feather name="file-text" size={18} color={theme.primary} />
        <ThemedText style={[styles.djiEntryText, { color: theme.primary }]} numberOfLines={1}>
          Fluglog auswerten
        </ThemedText>
      </Pressable>
      <Pressable
        testID="button-dji-bulk-entry"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate("DjiBulkImport");
        }}
        style={({ pressed }) => [
          styles.djiEntryButton,
          { backgroundColor: theme.primary + "15", borderColor: theme.primary + "30" },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Feather name="layers" size={18} color={theme.primary} />
        <ThemedText style={[styles.djiEntryText, { color: theme.primary }]} numberOfLines={1}>
          Mehrere Logs / Ordner
        </ThemedText>
        {djiNewLogs === 0 && djiAutoImported > 0 ? (
          <View
            testID="badge-dji-auto-imported"
            accessibilityLabel={`${djiAutoImported} DJI-Flugprotokolle automatisch übernommen`}
            style={[styles.djiNewBadge, { backgroundColor: theme.primary }]}
          >
            <ThemedText style={styles.djiNewBadgeText} numberOfLines={1}>
              {`${djiAutoImported} übernommen`}
            </ThemedText>
          </View>
        ) : null}
        {djiNewLogs > 0 ? (
          <View
            testID="badge-dji-new-logs"
            accessibilityLabel={`${djiNewLogs} neue DJI-Flugprotokolle im Ordner`}
            style={[styles.djiNewBadge, { backgroundColor: theme.statusGo }]}
          >
            <ThemedText style={styles.djiNewBadgeText} numberOfLines={1}>
              {`${djiNewLogs} neu`}
            </ThemedText>
          </View>
        ) : null}
      </Pressable>
      <Pressable
        testID="button-battery-stats-entry"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate("BatteryStats");
        }}
        style={({ pressed }) => [
          styles.djiEntryButton,
          { backgroundColor: theme.primary + "15", borderColor: theme.primary + "30" },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Feather name="battery-charging" size={18} color={theme.primary} />
        <ThemedText style={[styles.djiEntryText, { color: theme.primary }]} numberOfLines={1}>
          Akku-Statistik
        </ThemedText>
      </Pressable>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: theme.primary + "15" }]}>
        <Feather name="book-open" size={48} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>Logbuch leer</ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Abgeschlossene Flüge erscheinen hier nach dem Debriefing
      </ThemedText>
      <View style={styles.emptyDjiWrapper}>{renderDjiEntry()}</View>
    </View>
  );

  if (loading) {
    return (
      <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]}>
        <View style={styles.loadingContainer}>
          <ThemedText style={{ color: theme.textSecondary }}>Laden...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (items.length === 0) {
    return (
      <ThemedView style={[styles.container, styles.emptyStateContainer]}>
        {renderEmpty()}
      </ThemedView>
    );
  }

  const renderDroneFilters = () => {
    if (uniqueDrones.length < 2) return null;
    
    return (
      <View style={[styles.filterContainer, { paddingTop: headerHeight + Spacing.md }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScrollContent}
        >
          <Pressable
            onPress={() => setSelectedDrone(null)}
            style={[
              styles.filterBadge,
              { 
                backgroundColor: selectedDrone === null ? theme.primary : theme.backgroundSecondary,
                borderColor: selectedDrone === null ? theme.primary : theme.border,
              }
            ]}
          >
            <ThemedText 
              style={[
                styles.filterBadgeText, 
                { color: selectedDrone === null ? "#fff" : theme.text }
              ]}
            >
              Alle
            </ThemedText>
          </Pressable>
          {uniqueDrones.map(droneName => {
            const isSelected = selectedDrone === droneName;
            return (
              <Pressable
                key={droneName}
                onPress={() => setSelectedDrone(isSelected ? null : droneName)}
                style={[
                  styles.filterBadge,
                  { 
                    backgroundColor: isSelected ? theme.primary : theme.backgroundSecondary,
                    borderColor: isSelected ? theme.primary : theme.border,
                  }
                ]}
              >
                <Feather 
                  name="send" 
                  size={14} 
                  color={isSelected ? "#fff" : theme.textSecondary} 
                />
                <ThemedText 
                  style={[
                    styles.filterBadgeText, 
                    { color: isSelected ? "#fff" : theme.text }
                  ]}
                >
                  {droneName}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      {renderDroneFilters()}
      <FlatList
        data={filteredItems}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderItem={({ item, index }) => <LogbookCard item={item} index={index} onDelete={() => handleDelete(item)} />}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: uniqueDrones.length >= 2 ? Spacing.md : headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl,
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListHeaderComponent={<View style={styles.djiEntryHeader}>{renderDjiEntry()}</View>}
        ListFooterComponent={
          filteredItems.some((i) => i.type === "logbook") ? (
            <Pressable
              onPress={handleExportAll}
              style={({ pressed }) => [
                styles.exportAllButton,
                { backgroundColor: theme.primary + "15", borderColor: theme.primary + "30" },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather name="download" size={18} color={theme.primary} />
              <ThemedText style={[styles.exportAllText, { color: theme.primary }]}>
                Alle Fluege als PDF exportieren
              </ThemedText>
            </Pressable>
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  emptyList: {
    flex: 1,
    justifyContent: "center",
  },
  card: {
    padding: Spacing.lg,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardInfo: {
    flex: 1,
  },
  cardThumb: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.md,
    marginLeft: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E7EB",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  phaseProgressRow: {
    marginTop: Spacing.sm,
  },
  dateText: {
    ...Typography.body,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  droneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  droneText: {
    ...Typography.small,
    fontWeight: "500",
  },
  classBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: 3,
    marginLeft: Spacing.xs,
  },
  classText: {
    ...Typography.caption,
    fontSize: 10,
    fontWeight: "600",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  locationText: {
    ...Typography.small,
  },
  rightInfo: {
    alignItems: "flex-end",
    gap: Spacing.xs,
  },
  durationBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  durationText: {
    ...Typography.small,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  phasesRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  phaseIconContainer: {
    padding: 6,
    borderRadius: 6,
  },
  phaseIconComplete: {
    backgroundColor: "rgba(0, 200, 100, 0.15)",
  },
  phaseConnector: {
    width: 10,
    height: 2,
  },
  incidentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 4,
  },
  incidentBadgeText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  expandedContent: {
    marginTop: Spacing.md,
  },
  divider: {
    height: 1,
    marginBottom: Spacing.md,
  },
  locationLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  mapSnapshotWrapper: {
    height: 200,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.md,
    position: "relative",
    backgroundColor: "#E5E7EB",
  },
  mapSnapshotImage: {
    width: "100%",
    height: "100%",
  },
  mapSnapshotCaption: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  mapSnapshotCaptionText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  locationLinkText: {
    ...Typography.small,
    fontWeight: "600",
    flex: 1,
  },
  phaseSection: {
    marginBottom: Spacing.md,
    paddingLeft: Spacing.md,
    borderLeftWidth: 3,
  },
  phaseSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  phaseSectionTitle: {
    ...Typography.body,
    fontWeight: "600",
  },
  phaseSectionContent: {
    gap: Spacing.sm,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    ...Typography.small,
  },
  detailValue: {
    ...Typography.small,
    fontWeight: "500",
  },
  weatherBox: {
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginVertical: Spacing.xs,
  },
  weatherLabel: {
    ...Typography.caption,
    marginBottom: Spacing.xs,
  },
  weatherGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  weatherItem: {
    minWidth: 60,
  },
  weatherValue: {
    ...Typography.small,
    fontWeight: "600",
  },
  weatherItemLabel: {
    ...Typography.caption,
  },
  checklistSection: {
    marginTop: Spacing.xs,
  },
  checklistLabel: {
    ...Typography.caption,
    marginBottom: Spacing.xs,
  },
  checklistGrid: {
    flexDirection: "column",
    gap: 2,
  },
  checklistItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    backgroundColor: "rgba(0,200,100,0.1)",
    borderRadius: BorderRadius.xs,
  },
  checklistText: {
    ...Typography.caption,
  },
  incidentBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  incidentLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  incidentDescription: {
    ...Typography.small,
    marginTop: 2,
  },
  maintenanceBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.xs,
  },
  maintenanceLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  maintenanceDescription: {
    ...Typography.small,
    marginTop: 2,
  },
  notesBox: {
    marginTop: Spacing.xs,
  },
  notesLabel: {
    ...Typography.caption,
  },
  notesText: {
    ...Typography.small,
    marginTop: 2,
  },
  restrictionsBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
  },
  restrictionsLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  restrictionsText: {
    ...Typography.small,
    marginTop: 2,
  },
  exportButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  pdfButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  pdfButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  exportAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  exportAllText: {
    ...Typography.body,
    fontWeight: "600",
  },
  djiEntryRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  djiEntryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  djiEntryText: {
    ...Typography.body,
    fontWeight: "600",
  },
  djiNewBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.sm,
  },
  djiNewBadgeText: {
    ...Typography.caption,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  djiEntryHeader: {
    marginBottom: Spacing.md,
  },
  emptyDjiWrapper: {
    marginTop: Spacing.xl,
    alignSelf: "stretch",
  },
  emptyStateContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.h3,
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  filterContainer: {
    paddingBottom: Spacing.md,
  },
  filterScrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  filterBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  filterBadgeText: {
    ...Typography.body,
    fontWeight: "600",
  },
});
