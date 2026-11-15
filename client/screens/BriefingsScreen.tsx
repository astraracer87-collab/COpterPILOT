import React, { useCallback, useMemo, useState } from "react";
import { View, StyleSheet, FlatList, Pressable, RefreshControl, Alert } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { getActiveSessions, FlightSession, getDrone, deleteFlightSession, updateFlightSession, archiveSessionToLogbook, DEFAULT_LIMITS, trashFlightSession, restoreFlightSession, getTrashedFlightSessions, TRASH_RETENTION_DAYS } from "@/lib/storage";
import { getCheckItemLabel } from "@/lib/checklists";
import { setFlightPlanningMode } from "@/lib/flightPlanningMode";
import type { BriefingsStackParamList } from "@/navigation/BriefingsStackNavigator";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { formatPlannedTimeRange } from "@/lib/planningDateTime";

const DEPRECATED_CHECKLIST_IDS = ["registration", "insurance", "permissions"];

type NavigationProp = NativeStackNavigationProp<BriefingsStackParamList>;
type RootNavProp = NativeStackNavigationProp<RootStackParamList>;

interface SessionDisplayItem {
  type: "session";
  id: string;
  createdAt: string;
  locationName?: string;
  latitude: number;
  longitude: number;
  status: "go" | "caution" | "nogo";
  hasRestrictions: boolean;
  phase?: string;
  phaseLabel?: string;
  droneName?: string;
  droneClass?: string;
  droneType?: "standard" | "fpv_only" | "hybrid_fpv" | "selfie";
  plannedDate?: string;
  plannedTime?: string;
  plannedEndTime?: string;
  isExpired?: boolean;
  canCheckWeather?: boolean;
  session?: FlightSession;
}

interface ExpiredSectionItem {
  type: "expired_header";
  id: string;
  count: number;
}

interface TrashSectionItem {
  type: "trash_header";
  id: string;
  count: number;
}

interface TrashedDisplayItem {
  type: "trashed";
  id: string;
  session: FlightSession;
  droneName?: string;
  droneClass?: string;
  deletedAt: string;
  daysLeft: number;
}

type DisplayItem = SessionDisplayItem | ExpiredSectionItem | TrashSectionItem | TrashedDisplayItem;

const EXPIRY_AUTO_DELETE_DAYS = 28;

const PHASE_LABELS: Record<string, string> = {
  planning: "Planung",
  preflight: "Pre-Check",
  hover: "Flight-Check",
  postlanding: "Post-Check",
  debriefing: "Debriefing",
};

const PHASE_ORDER = ["planning", "preflight", "hover", "postlanding", "debriefing", "completed"];

function SessionCard({ 
  item, 
  index, 
  onContinue, 
  onDelete, 
  loadData,
  onOpenMap,
  onCancelSession,
  onSkipToPostCheck,
  onEditPlanningChecklist,
  onReplan,
  onCheckWeather,
}: { 
  item: SessionDisplayItem; 
  index: number; 
  onContinue: () => void; 
  onDelete: () => void;
  loadData: () => void;
  onOpenMap: () => void;
  onCancelSession: () => void;
  onSkipToPostCheck: () => void;
  onEditPlanningChecklist: () => void;
  onReplan: () => void;
  onCheckWeather: () => void;
}) {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const session = item.session;

  const getPhaseColor = (phase?: string) => {
    switch (phase) {
      case "planning": return theme.phasePlanning;
      case "preflight": return theme.phasePrecheck;
      case "hover": return theme.phaseInFlight;
      case "postlanding": return theme.phaseInFlight;
      case "debriefing": return theme.phaseDebriefing;
      default: return theme.phasePlanning;
    }
  };

  const getPhaseActionText = (phase?: string) => {
    switch (phase) {
      case "planning": return "Pre-Check starten";
      case "preflight": return "Pre-Check fortsetzen";
      case "hover": return "Flight-Check";
      case "postlanding": return "Post-Check fortsetzen";
      case "debriefing": return "Debriefing abschließen";
      default: return "Fortfahren";
    }
  };

  const getPhaseIcon = (phase?: string): keyof typeof Feather.glyphMap => {
    switch (phase) {
      case "planning": return "clipboard";
      case "preflight": return "navigation";
      case "hover": return "navigation-2";
      case "postlanding": return "flag";
      case "debriefing": return "book";
      default: return "play";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const openDipulMap = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenMap();
  };

  const toggleExpanded = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(!expanded);
  };

  const handleArchiveDirectly = async () => {
    try {
      await archiveSessionToLogbook(item.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadData();
    } catch (error) {
      Alert.alert("Fehler", "Session konnte nicht archiviert werden.");
    }
  };

  const currentPhaseIndex = PHASE_ORDER.indexOf(item.phase || "planning");

  // Pflicht-Vorbereitungs-Items aus PLANNING_CHECKLIST ("Vorbereitung"-Sektion)
  const PREP_REQUIRED_IDS = ["drone_ready", "firmware", "batteries", "controller"] as const;
  const completedIds = session?.planning?.checklistCompleted ?? [];
  const allPrepDone = PREP_REQUIRED_IDS.every((id) => completedIds.includes(id));
  
  const isPlanningComplete = currentPhaseIndex > 0;
  const isPreflightComplete = currentPhaseIndex > 1;
  const isHoverComplete = currentPhaseIndex > 2 || !!session?.hoverCheck?.skippedFlightCheck;
  const isDebriefingComplete = currentPhaseIndex > 4;

  const renderPhaseSection = (
    phaseKey: string, 
    title: string, 
    icon: keyof typeof Feather.glyphMap, 
    data: any,
    isCompleted: boolean
  ) => {
    if (!data && !isCompleted) return null;
    
    return (
      <View style={[styles.phaseSection, { borderLeftColor: isCompleted ? theme.statusGo : theme.border }]}>
        <View style={styles.phaseSectionHeader}>
          <Feather name={icon} size={14} color={isCompleted ? theme.statusGo : theme.textTertiary} />
          <ThemedText style={[styles.phaseSectionTitle, { color: isCompleted ? theme.text : theme.textTertiary }]}>
            {title}
          </ThemedText>
          {isCompleted ? (
            <Feather name="check-circle" size={14} color={theme.statusGo} />
          ) : null}
        </View>
        {data ? (
          <View style={styles.phaseSectionContent}>
            {Object.entries(data).map(([key, value]) => {
              const HIDDEN_KEYS = new Set([
                "radiusKm",
                "isFpvFlight",
                "fpvMode",
                "vlosExceeded",
                "recommendedVlosM",
                "vlosCharDimensionM",
                "routeWaypoints",
                "countryIso",
                "mapUrl",
                "sessionId",
                "forecastWeather",
                "latitude",
                "longitude",
                "locationName",
                "droneId",
                "restrictionStatus",
                "endTime",
                "plannedEndTime",
              ]);
              if (HIDDEN_KEYS.has(key)) return null;
              if (key === "checklistCompleted" && Array.isArray(value) && value.length > 0) {
                const filteredItems = value.filter((id: string) => !DEPRECATED_CHECKLIST_IDS.includes(id));
                if (filteredItems.length === 0) return null;
                return (
                  <View key={key} style={styles.checklistSection}>
                    <View style={styles.checklistGrid}>
                      {filteredItems.map((id: string) => (
                        <View key={id} style={styles.checklistItem}>
                          <Feather name="check-circle" size={12} color={theme.statusGo} />
                          <ThemedText style={[styles.checklistText, { color: theme.statusGo }]}>
                            {getCheckItemLabel(id) || id}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              }
              if (typeof value === "object" && value !== null) return null;
              if (value === undefined || value === null || value === "") return null;
              
              const labelMap: Record<string, string> = {
                plannedDate: "Datum",
                plannedTime: "Uhrzeit",
                flightPurpose: "Zweck",
                maxAltitude: "Max. Höhe",
                controlsOk: "Steuerung OK",
                signalOk: "Signal OK",
                hoverStable: "Hover stabil",
                incidentOccurred: "Vorfall",
                maintenanceRequired: "Wartung nötig",
                generalNotes: "Notizen",
              };
              
              const label = labelMap[key] || key;
              let displayValue = String(value);
              if (typeof value === "boolean") {
                displayValue = value ? "Ja" : "Nein";
              }
              if (key === "plannedTime" && typeof value === "string") {
                const plannedEnd = (data as { plannedEndTime?: unknown }).plannedEndTime;
                displayValue = formatPlannedTimeRange(value, typeof plannedEnd === "string" ? plannedEnd : undefined);
              }
              
              return (
                <View key={key} style={styles.detailRow}>
                  <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>
                    {label}:
                  </ThemedText>
                  <ThemedText style={styles.detailValue}>
                    {displayValue}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  const renderWeatherInfo = () => {
    const weather = session?.preflight?.actualWeather || session?.planning?.forecastWeather;
    if (!weather) return null;

    return (
      <View style={[styles.weatherSection, { backgroundColor: theme.backgroundSecondary }]}>
        <View style={styles.weatherHeader}>
          <Feather name="cloud" size={14} color={theme.primary} />
          <ThemedText style={styles.weatherTitle}>Wetter</ThemedText>
        </View>
        <View style={styles.weatherGrid}>
          <View style={styles.weatherItem}>
            <ThemedText style={[styles.weatherValue, { color: theme.text }]}>
              {weather.temperature?.toFixed(0)}°C
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>Temp</ThemedText>
          </View>
          <View style={styles.weatherItem}>
            <ThemedText style={[styles.weatherValue, { color: theme.text }]}>
              {weather.windSpeed?.toFixed(1)} m/s
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>Wind</ThemedText>
          </View>
          {weather.windGust ? (
            <View style={styles.weatherItem}>
              <ThemedText style={[styles.weatherValue, { color: theme.text }]}>
                {weather.windGust?.toFixed(1)} m/s
              </ThemedText>
              <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>Böen</ThemedText>
            </View>
          ) : null}
          <View style={styles.weatherItem}>
            <ThemedText style={[styles.weatherValue, { color: theme.text }]}>
              {weather.rain?.toFixed(1)} mm
            </ThemedText>
            <ThemedText style={[styles.weatherLabel, { color: theme.textTertiary }]}>Regen</ThemedText>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
      <Card style={styles.card}>
        <Pressable onPress={toggleExpanded} onLongPress={onDelete} delayLongPress={500}>
          <View style={styles.cardHeader}>
            <View style={styles.cardInfo}>
              <View style={styles.phaseRow}>
                <View style={[styles.phaseBadge, { backgroundColor: getPhaseColor(item.phase) + "20" }]}>
                  <ThemedText style={[styles.phaseText, { color: getPhaseColor(item.phase) }]}>
                    {item.phaseLabel}
                  </ThemedText>
                </View>
                <StatusBadge status={item.status} size="small" />
              </View>
              
              {item.droneName ? (
                <View style={styles.droneRow}>
                  <Feather name="send" size={12} color={theme.textSecondary} />
                  <ThemedText style={[styles.droneText, { color: theme.textSecondary }]}>
                    {item.droneName}
                  </ThemedText>
                  {item.droneClass ? (
                    <View style={[styles.droneClassBadge, { backgroundColor: theme.backgroundSecondary }]}>
                      <ThemedText style={[styles.droneClassBadgeText, { color: theme.primary }]}>{item.droneClass}</ThemedText>
                    </View>
                  ) : null}
                  {item.droneType === "fpv_only" ? (
                    <View style={[styles.droneTypeBadge, { backgroundColor: theme.statusCautionBackground }]}>
                      <ThemedText style={[styles.droneTypeBadgeText, { color: theme.statusCaution }]}>FPV</ThemedText>
                    </View>
                  ) : item.droneType === "hybrid_fpv" ? (
                    session?.planning?.isFpvFlight ? (
                      <View style={[styles.droneTypeBadge, { backgroundColor: theme.statusCautionBackground }]}>
                        <ThemedText style={[styles.droneTypeBadgeText, { color: theme.statusCaution }]}>FPV</ThemedText>
                      </View>
                    ) : session?.planning?.isFpvFlight === false ? (
                      <View style={[styles.droneTypeBadge, { backgroundColor: theme.statusGoBackground }]}>
                        <ThemedText style={[styles.droneTypeBadgeText, { color: theme.statusGo }]}>Normal</ThemedText>
                      </View>
                    ) : (
                      <View style={[styles.droneTypeBadge, { backgroundColor: theme.primary + "20" }]}>
                        <ThemedText style={[styles.droneTypeBadgeText, { color: theme.primary }]}>Hybrid</ThemedText>
                      </View>
                    )
                  ) : null}
                </View>
              ) : null}
              
              <View style={styles.phaseProgressRow}>
                <View style={[styles.phaseProgressItem, isPlanningComplete && styles.phaseProgressItemComplete]}>
                  <Feather name="calendar" size={14} color={isPlanningComplete ? theme.statusGo : theme.textTertiary} />
                </View>
                <View style={[styles.phaseProgressLine, { backgroundColor: isPlanningComplete ? theme.statusGo : theme.border }]} />
                <View style={[styles.phaseProgressItem, isPreflightComplete && styles.phaseProgressItemComplete]}>
                  <Feather name="clipboard" size={14} color={isPreflightComplete ? theme.statusGo : theme.textTertiary} />
                </View>
                <View style={[styles.phaseProgressLine, { backgroundColor: isPreflightComplete ? theme.statusGo : theme.border }]} />
                <View style={[styles.phaseProgressItem, isHoverComplete && styles.phaseProgressItemComplete]}>
                  <Feather name="navigation" size={14} color={isHoverComplete ? theme.statusGo : theme.textTertiary} />
                </View>
                <View style={[styles.phaseProgressLine, { backgroundColor: isHoverComplete ? theme.statusGo : theme.border }]} />
                <View style={[styles.phaseProgressItem, isDebriefingComplete && styles.phaseProgressItemComplete]}>
                  <Feather name="book" size={14} color={isDebriefingComplete ? theme.statusGo : theme.textTertiary} />
                </View>
              </View>
              
              <ThemedText
                style={[
                  styles.dateText,
                  item.isExpired ? { color: theme.statusNoGo, fontWeight: "600" } : null,
                ]}
              >
                {item.plannedTime 
                  ? (() => {
                      const timeRange = formatPlannedTimeRange(item.plannedTime, item.plannedEndTime);
                      let datePart = "";
                      if (item.plannedDate) {
                        const d = new Date(`${item.plannedDate}T00:00:00`);
                        if (!isNaN(d.getTime())) {
                          datePart = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", ";
                        }
                      }
                      return `Geplant: ${datePart}${timeRange}`;
                    })()
                  : formatDate(item.createdAt)
                }
              </ThemedText>
              {item.isExpired ? (
                <View style={styles.expiredBanner}>
                  <Feather name="alert-circle" size={12} color={theme.statusNoGo} />
                  <ThemedText style={[styles.expiredBannerText, { color: theme.statusNoGo }]}>
                    Planung abgelaufen
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.cardHeaderRight}>
              {item.isExpired ? (
                <Pressable
                  onPress={onDelete}
                  hitSlop={10}
                  style={[styles.trashBtn, { backgroundColor: theme.statusNoGo + "15" }]}
                >
                  <Feather name="trash-2" size={16} color={theme.statusNoGo} />
                </Pressable>
              ) : null}
              <Feather 
                name={expanded ? "chevron-up" : "chevron-down"} 
                size={20} 
                color={theme.textTertiary} 
              />
            </View>
          </View>

          {item.locationName ? (
            <Pressable onPress={openDipulMap} style={styles.locationRow}>
              <Feather name="map-pin" size={12} color={theme.primary} />
              <ThemedText style={[styles.locationText, { color: theme.primary, textDecorationLine: "underline" }]}>
                {item.locationName}
              </ThemedText>
              <Feather name="map" size={10} color={theme.primary} />
            </Pressable>
          ) : null}
          
          {item.hasRestrictions ? (
            <View style={styles.restrictionRow}>
              <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
              <ThemedText style={[styles.restrictionText, { color: theme.statusCaution }]}>
                Einschränkungen vorhanden
              </ThemedText>
            </View>
          ) : null}
        </Pressable>

        {expanded && session ? (
          <View style={styles.expandedContent}>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            
            {renderPhaseSection(
              "planning",
              "Planung",
              "calendar",
              session.planning,
              currentPhaseIndex > 0
            )}
            
            {renderPhaseSection(
              "preflight",
              "Pre-Check",
              "clipboard",
              session.preflight,
              currentPhaseIndex > 1
            )}
            
            {renderPhaseSection(
              "hover",
              "Flight-Check",
              "navigation",
              session.hoverCheck,
              currentPhaseIndex > 2
            )}
            
            {renderPhaseSection(
              "debriefing",
              "Debriefing",
              "file-text",
              session.debriefing,
              currentPhaseIndex > 4
            )}
            
            {session.debriefing && currentPhaseIndex > 4 ? (
              <View style={[styles.completionSummary, { backgroundColor: session.debriefing.incidentOccurred ? theme.statusNoGoBackground : theme.statusGoBackground }]}>
                <Feather 
                  name={session.debriefing.incidentOccurred ? "alert-triangle" : "check-circle"} 
                  size={16} 
                  color={session.debriefing.incidentOccurred ? theme.statusNoGo : theme.statusGo} 
                />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.completionText, { color: session.debriefing.incidentOccurred ? theme.statusNoGo : theme.statusGo }]}>
                    {session.debriefing.incidentOccurred ? "Flug mit Vorfall" : "Flug abgeschlossen"}
                  </ThemedText>
                  <View style={styles.completionDetails}>
                    {session.debriefing.flightDurationMinutes ? (
                      <ThemedText style={[styles.completionDetail, { color: theme.textSecondary }]}>
                        {session.debriefing.flightDurationMinutes} Min
                      </ThemedText>
                    ) : null}
                    {session.debriefing.batteryUsedPercent ? (
                      <ThemedText style={[styles.completionDetail, { color: theme.textSecondary }]}>
                        {session.debriefing.batteryUsedPercent}% Akku
                      </ThemedText>
                    ) : null}
                    {session.debriefing.maintenanceRequired ? (
                      <ThemedText style={[styles.completionDetail, { color: theme.statusCaution }]}>
                        Wartung nötig
                      </ThemedText>
                    ) : null}
                  </View>
                  {session.debriefing.generalNotes ? (
                    <ThemedText style={[styles.completionNotes, { color: theme.textTertiary }]} numberOfLines={2}>
                      {session.debriefing.generalNotes}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
            ) : null}

            {renderWeatherInfo()}
            
            {item.isExpired ? (
              <View>
                <View style={[styles.expiredBanner, { marginBottom: Spacing.sm }]}>
                  <Feather name="alert-circle" size={14} color={theme.statusNoGo} />
                  <ThemedText style={[styles.expiredBannerText, { color: theme.statusNoGo }]}>
                    Diese Planung ist abgelaufen. Bitte neu planen, damit Wetter und NOTAMs aktuell sind.
                  </ThemedText>
                </View>
                <View style={styles.expandedActions}>
                  <Button
                    title="Neu planen"
                    onPress={onReplan}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.expandedActions}>
                  <Button
                    title={getPhaseActionText(item.phase)}
                    onPress={onContinue}
                    style={{ flex: 1 }}
                  />
                  {item.phase === "hover" ? (
                    <Button
                      title="Post-Check"
                      onPress={onSkipToPostCheck}
                      variant="secondary"
                      style={{ flex: 1 }}
                    />
                  ) : null}
                </View>

                {item.canCheckWeather ? (
                  <View style={[styles.expandedActions, { marginTop: Spacing.sm }]}>
                    <Button
                      title="Wetterprüfung"
                      onPress={onCheckWeather}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : null}

                {(item.phase === "planning" || item.phase === "preflight") && session.planning ? (
                  allPrepDone ? (
                    <Pressable
                      onPress={onEditPlanningChecklist}
                      style={[styles.cancelLink, { marginTop: Spacing.sm }]}
                      hitSlop={8}
                    >
                      <Feather name="check-square" size={13} color={theme.textTertiary} />
                      <ThemedText style={[styles.cancelText, { color: theme.textTertiary }]}>
                        Vorbereitung bearbeiten
                      </ThemedText>
                    </Pressable>
                  ) : (
                    <View style={[styles.expandedActions, { marginTop: Spacing.sm }]}>
                      <Button
                        title="Vorbereitung abhaken"
                        onPress={onEditPlanningChecklist}
                        variant="secondary"
                        style={{ flex: 1 }}
                      />
                    </View>
                  )
                ) : null}
              </>
            )}
            
            {item.phase === "hover" ? (
              <View style={[styles.expandedActions, { marginTop: Spacing.sm }]}>
                <Button
                  title="Direkt ins Logbuch"
                  onPress={handleArchiveDirectly}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
            
            {item.phase !== "completed" ? (
              <Pressable 
                onPress={onCancelSession}
                style={[styles.cancelLink, { marginTop: Spacing.md }]}
              >
                <Feather name="x" size={14} color={theme.textTertiary} />
                <ThemedText style={[styles.cancelText, { color: theme.textTertiary }]}>
                  Planung abbrechen
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View>
            {item.isExpired ? (
              <View style={[styles.expandedActions, { marginTop: Spacing.md }]}>
                <Button
                  title="Neu planen"
                  onPress={onReplan}
                  style={{ flex: 1 }}
                />
              </View>
            ) : (
              // Wenn Vorbereitung schon komplett abgehakt ist, wird der Pre-Check-
              // Button zur prominenten Aktion und "Vorbereitung abhaken" rutscht
              // unten in einen unauffälligen Text-Link.
              allPrepDone && (item.phase === "planning" || item.phase === "preflight") ? (
                <View style={styles.expandedActions}>
                  <Button
                    title={getPhaseActionText(item.phase)}
                    onPress={onContinue}
                    style={{ flex: 1 }}
                  />
                </View>
              ) : item.phase === "hover" ? (
                // Im Flug: direkt die Aktions-Buttons zeigen, damit der Pilot
                // schnell weiterkommt. Die volle Checkliste gibt es nur auf
                // Wunsch über den dezenten "Checkliste prüfen"-Link.
                <View>
                  <View style={styles.expandedActions}>
                    <Button
                      title="Flight-Check"
                      onPress={onContinue}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Post-Check"
                      onPress={onSkipToPostCheck}
                      variant="secondary"
                      style={{ flex: 1 }}
                    />
                  </View>
                  <View style={[styles.expandedActions, { marginTop: Spacing.sm }]}>
                    <Button
                      title="Direkt ins Logbuch"
                      onPress={handleArchiveDirectly}
                      variant="secondary"
                      style={{ flex: 1 }}
                    />
                  </View>
                  <Pressable
                    onPress={toggleExpanded}
                    style={[styles.cancelLink, { marginTop: Spacing.sm }]}
                    hitSlop={8}
                  >
                    <Feather name="list" size={13} color={theme.textTertiary} />
                    <ThemedText style={[styles.cancelText, { color: theme.textTertiary }]}>
                      Checkliste & Details prüfen
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={onContinue}>
                  <View style={[styles.actionHint, { backgroundColor: getPhaseColor(item.phase) + "15" }]}>
                    <Feather 
                      name={getPhaseIcon(item.phase)} 
                      size={14} 
                      color={getPhaseColor(item.phase)} 
                    />
                    <ThemedText style={[styles.actionHintText, { color: getPhaseColor(item.phase) }]}>
                      {getPhaseActionText(item.phase)}
                    </ThemedText>
                  </View>
                </Pressable>
              )
            )}

            {!item.isExpired && (item.phase === "planning" || item.phase === "preflight") && session?.planning ? (
              allPrepDone ? (
                <Pressable
                  onPress={onEditPlanningChecklist}
                  style={[styles.cancelLink, { marginTop: Spacing.sm }]}
                  hitSlop={8}
                >
                  <Feather name="check-square" size={13} color={theme.textTertiary} />
                  <ThemedText style={[styles.cancelText, { color: theme.textTertiary }]}>
                    Vorbereitung bearbeiten
                  </ThemedText>
                </Pressable>
              ) : (
                <View style={[styles.expandedActions, { marginTop: Spacing.sm }]}>
                  <Button
                    title="Vorbereitung abhaken"
                    onPress={onEditPlanningChecklist}
                    variant="secondary"
                    style={{ flex: 1 }}
                  />
                </View>
              )
            ) : null}
          </View>
        )}
      </Card>
    </Animated.View>
  );
}

export default function BriefingsScreen() {
  const navigation = useNavigation<NavigationProp>();
  const rootNav = useNavigation<RootNavProp>();
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const [activeItems, setActiveItems] = useState<SessionDisplayItem[]>([]);
  const [expiredItems, setExpiredItems] = useState<SessionDisplayItem[]>([]);
  const [trashedItems, setTrashedItems] = useState<TrashedDisplayItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expiredCollapsed, setExpiredCollapsed] = useState(true);
  const [trashCollapsed, setTrashCollapsed] = useState(true);

  const items: DisplayItem[] = useMemo(() => {
    const combined: DisplayItem[] = [...activeItems];
    if (expiredItems.length > 0) {
      combined.push({ type: "expired_header", id: "__expired_header__", count: expiredItems.length });
      if (!expiredCollapsed) combined.push(...expiredItems);
    }
    if (trashedItems.length > 0) {
      combined.push({ type: "trash_header", id: "__trash_header__", count: trashedItems.length });
      if (!trashCollapsed) combined.push(...trashedItems);
    }
    return combined;
  }, [activeItems, expiredItems, trashedItems, expiredCollapsed, trashCollapsed]);

  const loadData = useCallback(async () => {
    try {
      const sessions = await getActiveSessions();
      const now = Date.now();
      const autoDeleteCutoff = now - EXPIRY_AUTO_DELETE_DAYS * 24 * 60 * 60 * 1000;

      const active: SessionDisplayItem[] = [];
      const expired: SessionDisplayItem[] = [];

      for (const session of sessions) {
        // Auto-Cleanup: Briefings älter als 4 Wochen werden entfernt
        const createdMs = new Date(session.createdAt).getTime();
        if (!isNaN(createdMs) && createdMs < autoDeleteCutoff) {
          try { await deleteFlightSession(session.id); } catch {}
          continue;
        }

        const drone = await getDrone(session.droneId);
        const plannedDate = session.planning?.plannedDate;
        const plannedTime = session.planning?.plannedTime;

        // Eine Planung gilt als abgelaufen, wenn der geplante Termin in der
        // Vergangenheit liegt und der Pilot noch nicht in die Luft ist.
        let isExpired = false;
        let canCheckWeather = false;
        if (
          plannedDate &&
          plannedTime &&
          (session.currentPhase === "planning" || session.currentPhase === "preflight")
        ) {
          // Annahme Flugfenster = 2 h ab geplantem Startzeitpunkt (gleiche
          // Logik wie die "HH:MM - HH:MM+2"-Anzeige). Erst NACH dem Fenster
          // gilt die Planung als abgelaufen — während des Fensters bleibt
          // sie aktiv.
          const plannedMs = new Date(`${plannedDate}T${plannedTime}:00`).getTime();
          const windowEndMs = plannedMs + 2 * 60 * 60 * 1000;
          if (!isNaN(plannedMs) && windowEndMs < now) {
            isExpired = true;
          }
          // In den letzten 24 h vor Start (und noch nicht abgelaufen) bietet die
          // Übersicht eine "Wetterprüfung" an — bei der Planung wurde das Wetter
          // bewusst übersprungen, weil der Start damals > 24 h entfernt war.
          if (
            !isNaN(plannedMs) &&
            !isExpired &&
            session.currentPhase === "planning" &&
            plannedMs - now < 24 * 60 * 60 * 1000
          ) {
            canCheckWeather = true;
          }
        }

        const display: SessionDisplayItem = {
          type: "session",
          id: session.id,
          createdAt: session.createdAt,
          locationName: session.locationName,
          latitude: session.latitude,
          longitude: session.longitude,
          status: session.status,
          hasRestrictions: session.hasRestrictions,
          phase: session.currentPhase,
          phaseLabel: PHASE_LABELS[session.currentPhase] || session.currentPhase,
          droneName: drone?.name,
          droneClass: drone?.classMark,
          droneType: drone?.droneType,
          plannedDate,
          plannedTime,
          plannedEndTime: session.planning?.plannedEndTime,
          isExpired,
          canCheckWeather,
          session,
        };

        if (isExpired) expired.push(display);
        else active.push(display);
      }

      const byCreatedDesc = (a: SessionDisplayItem, b: SessionDisplayItem) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      active.sort(byCreatedDesc);
      expired.sort(byCreatedDesc);

      setActiveItems(active);
      setExpiredItems(expired);

      // Papierkorb — Soft-Delete-Liste mit verbleibender Aufbewahrungsdauer.
      try {
        const trashed = await getTrashedFlightSessions();
        const display: TrashedDisplayItem[] = [];
        for (const s of trashed) {
          const drone = await getDrone(s.droneId);
          const deletedAtRaw = (s as any).deletedAt as string | Date | undefined;
          const deletedAt = deletedAtRaw
            ? new Date(deletedAtRaw).toISOString()
            : new Date().toISOString();
          const ageMs = Date.now() - new Date(deletedAt).getTime();
          const daysLeft = Math.max(
            0,
            Math.ceil(TRASH_RETENTION_DAYS - ageMs / (24 * 60 * 60 * 1000)),
          );
          display.push({
            type: "trashed",
            id: s.id,
            session: s,
            droneName: drone?.name,
            droneClass: drone?.classMark,
            deletedAt,
            daysLeft,
          });
        }
        setTrashedItems(display);
      } catch (e) {
        console.warn("Failed to load trash:", e);
        setTrashedItems([]);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const navigateToFlightCheck = async (sessionId: string) => {
    rootNav.navigate("FlightCheck", { sessionId });
  };

  const handleItemPress = async (item: DisplayItem) => {
    if (item.type === "session" && item.session) {
      const session = item.session;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      if (session.currentPhase === "planning") {
        await updateFlightSession(session.id, { currentPhase: "preflight" });
      }
      
      navigateToFlightCheck(session.id);
    }
  };
  
  const handleOpenMap = (item: SessionDisplayItem) => {
    const radiusKm = item.session?.planning?.radiusKm;
    const radiusM = typeof radiusKm === "number" && radiusKm > 0 ? radiusKm * 1000 : undefined;
    navigation.navigate("LocationMap", { 
      latitude: item.latitude, 
      longitude: item.longitude,
      title: item.locationName,
      radiusM,
      countryIso: item.session?.countryIso,
    });
  };
  
  const handleCancelSession = (item: DisplayItem) => {
    if (item.type !== "session" || !item.session) return;

    Alert.alert(
      "Planung abbrechen",
      `Diese Flugplanung wird in den Papierkorb verschoben und nach ${TRASH_RETENTION_DAYS} Tagen endgültig gelöscht. Du kannst sie bis dahin wiederherstellen.`,
      [
        { text: "Nein", style: "cancel" },
        {
          text: "In Papierkorb",
          style: "destructive",
          onPress: async () => {
            await trashFlightSession(item.session!.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            loadData();
          },
        },
      ]
    );
  };
  
  const handleEditPlanningChecklist = (item: DisplayItem) => {
    if (item.type !== "session" || !item.session || !item.session.planning) return;
    const s = item.session;
    const p = s.planning!;
    rootNav.navigate("FlightPlanning", {
      screen: "PlanningChecklist",
      params: {
        droneId: s.droneId,
        latitude: s.latitude,
        longitude: s.longitude,
        locationName: s.locationName,
        countryIso: s.countryIso,
        mapUrl: s.mapUrl,
        plannedDate: p.plannedDate,
        plannedTime: p.plannedTime,
        forecastWeather: p.forecastWeather,
        limits: DEFAULT_LIMITS,
        maxAltitude: p.maxAltitude,
        isFpvFlight: p.isFpvFlight ?? false,
        fpvMode: p.fpvMode,
        sessionId: s.id,
        editMode: true,
        existingChecked: Array.isArray(p.checklistCompleted) ? p.checklistCompleted : [],
        directEntry: true,
      },
    });
  };

  const handleCheckWeather = (item: DisplayItem) => {
    if (item.type !== "session" || !item.session || !item.session.planning) return;
    const s = item.session;
    const p = s.planning!;
    // Wetterprüfung erfolgt im planning-Modus (nicht preflight), damit der
    // PlanningDetailsScreen ggf. wieder als normale Planung agiert.
    setFlightPlanningMode("planning");
    rootNav.navigate("FlightPlanning", {
      screen: "PlanningDetails",
      params: {
        droneId: s.droneId,
        latitude: s.latitude,
        longitude: s.longitude,
        locationName: s.locationName,
        countryIso: s.countryIso,
        mapUrl: s.mapUrl,
        plannedDate: p.plannedDate,
        plannedTime: p.plannedTime,
        endTime: p.plannedEndTime,
        radiusKm: p.radiusKm,
        recommendedVlosM: p.recommendedVlosM,
        vlosExceeded: p.vlosExceeded,
        vlosCharDimensionM: p.vlosCharDimensionM,
        sessionId: s.id,
        directEntry: true,
      },
    });
  };

  const handleSkipToPostCheck = async (item: DisplayItem) => {
    if (item.type !== "session" || !item.session) return;
    
    try {
      await updateFlightSession(item.session.id, {
        currentPhase: "postlanding",
        hoverCheck: {
          takeoffTime: new Date().toISOString(),
          landingTime: new Date().toISOString(),
          skippedFlightCheck: true,
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      rootNav.navigate("FlightCheck", { sessionId: item.session.id, initialScreen: "DebriefingChecklist" });
    } catch (error) {
      Alert.alert("Fehler", "Konnte nicht zum Post-Check wechseln.");
    }
  };

  const handleItemLongPress = (item: DisplayItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Planung in Papierkorb",
      `Die Planung wird in den Papierkorb verschoben und nach ${TRASH_RETENTION_DAYS} Tagen endgültig entfernt.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "In Papierkorb",
          style: "destructive",
          onPress: async () => {
            if (item.type === "session" && item.session) {
              await trashFlightSession(item.session.id);
            }
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            loadData();
          },
        },
      ]
    );
  };

  const handleRestoreTrashed = useCallback(async (sessionId: string) => {
    try {
      await restoreFlightSession(sessionId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      loadData();
    } catch (e) {
      Alert.alert("Fehler", "Wiederherstellen fehlgeschlagen.");
    }
  }, [loadData]);

  const handlePermanentDelete = useCallback((sessionId: string) => {
    Alert.alert(
      "Endgültig löschen",
      "Diese Planung wird unwiderruflich gelöscht. Fortfahren?",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Endgültig löschen",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteFlightSession(sessionId);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              loadData();
            } catch (e) {
              Alert.alert("Fehler", "Löschen fehlgeschlagen.");
            }
          },
        },
      ]
    );
  }, [loadData]);

  const handleReplan = useCallback(async (item: SessionDisplayItem) => {
    if (!item.session) return;
    const s = item.session;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Die alte Session NICHT löschen — wir geben ihre sessionId an die
    // Planung weiter, damit PlanningDetailsScreen denselben Datensatz
    // aktualisiert. So bleibt die Karte sichtbar, falls der Pilot mitten
    // im Re-Planen abbricht, und es entsteht kein Duplikat.
    rootNav.navigate("FlightPlanning", {
      screen: "PlanningDateTime",
      params: {
        droneId: s.droneId,
        latitude: s.latitude,
        longitude: s.longitude,
        locationName: s.locationName,
        countryIso: s.countryIso,
        radiusKm: s.planning?.radiusKm ?? 0.5,
        recommendedVlosM: s.planning?.recommendedVlosM,
        vlosExceeded: s.planning?.vlosExceeded,
        vlosCharDimensionM: s.planning?.vlosCharDimensionM,
        sessionId: s.id,
        directEntry: true,
      },
    });
  }, [rootNav]);

  const renderItem = useCallback(
    ({ item, index }: { item: DisplayItem; index: number }) => {
      if (item.type === "expired_header") {
        return (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setExpiredCollapsed((v) => !v);
            }}
            style={[styles.expiredHeader, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            testID="button-toggle-expired"
          >
            <Feather name="archive" size={16} color={theme.textSecondary} />
            <ThemedText style={[styles.expiredHeaderText, { color: theme.textSecondary }]}>
              Abgelaufene Briefings ({item.count})
            </ThemedText>
            <Feather
              name={expiredCollapsed ? "chevron-down" : "chevron-up"}
              size={18}
              color={theme.textSecondary}
            />
          </Pressable>
        );
      }
      if (item.type === "trash_header") {
        return (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setTrashCollapsed((v) => !v);
            }}
            style={[styles.expiredHeader, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            testID="button-toggle-trash"
          >
            <Feather name="trash-2" size={16} color={theme.textSecondary} />
            <ThemedText style={[styles.expiredHeaderText, { color: theme.textSecondary }]}>
              Papierkorb ({item.count}) — {TRASH_RETENTION_DAYS} Tage Aufbewahrung
            </ThemedText>
            <Feather
              name={trashCollapsed ? "chevron-down" : "chevron-up"}
              size={18}
              color={theme.textSecondary}
            />
          </Pressable>
        );
      }
      if (item.type === "trashed") {
        const session = item.session;
        const planned = session.planning?.plannedDate && session.planning?.plannedTime
          ? `${session.planning.plannedDate} ${session.planning.plannedTime}`
          : new Date(session.createdAt).toLocaleDateString("de-DE");
        return (
          <Card style={[styles.card, { opacity: 0.85 }]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardInfo}>
                <ThemedText style={{ fontWeight: "600" }}>
                  {item.droneName ?? "Planung"}
                  {item.droneClass ? ` · ${item.droneClass}` : ""}
                </ThemedText>
                <ThemedText style={{ color: theme.textSecondary }}>
                  {session.locationName ?? "Ohne Standort"}
                </ThemedText>
                <ThemedText style={{ color: theme.textTertiary, ...Typography.caption }}>
                  Geplant: {planned}
                </ThemedText>
                <ThemedText style={{ color: theme.statusCaution, ...Typography.caption, marginTop: 2 }}>
                  Wird in {item.daysLeft} {item.daysLeft === 1 ? "Tag" : "Tagen"} endgültig gelöscht
                </ThemedText>
              </View>
            </View>
            <View style={[styles.expandedActions, { marginTop: Spacing.md }]}>
              <Button
                title="Wiederherstellen"
                variant="secondary"
                onPress={() => handleRestoreTrashed(item.id)}
                style={{ flex: 1 }}
              />
              <Button
                title="Endgültig löschen"
                onPress={() => handlePermanentDelete(item.id)}
                style={{ flex: 1, backgroundColor: theme.statusNoGo }}
              />
            </View>
          </Card>
        );
      }
      return (
        <SessionCard 
          item={item} 
          index={index} 
          onContinue={() => handleItemPress(item)}
          onDelete={() => handleItemLongPress(item)}
          loadData={loadData}
          onOpenMap={() => handleOpenMap(item)}
          onCancelSession={() => handleCancelSession(item)}
          onSkipToPostCheck={() => handleSkipToPostCheck(item)}
          onEditPlanningChecklist={() => handleEditPlanningChecklist(item)}
          onReplan={() => handleReplan(item)}
          onCheckWeather={() => handleCheckWeather(item)}
        />
      );
    },
    [loadData, expiredCollapsed, trashCollapsed, theme, handleReplan, handleRestoreTrashed, handlePermanentDelete]
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: theme.primary + "15" }]}>
        <Feather name="clipboard" size={48} color={theme.primary} />
      </View>
      <ThemedText style={styles.emptyTitle}>Keine offenen Briefings</ThemedText>
      <ThemedText style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
        Tippe auf + um eine Flugplanung oder einen Pre-Check zu starten
      </ThemedText>
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

  return (
    <ThemedView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: tabBarHeight + Spacing.xl + 80,
          },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  card: {
    padding: Spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginLeft: Spacing.sm,
  },
  trashBtn: {
    padding: 6,
    borderRadius: BorderRadius.sm,
  },
  cardInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  phaseBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  phaseText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  droneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  droneText: {
    ...Typography.caption,
  },
  droneClassBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
    marginLeft: Spacing.xs,
  },
  droneClassBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  droneTypeBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
    marginLeft: Spacing.xs,
  },
  droneTypeBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  dateText: {
    ...Typography.caption,
    marginTop: Spacing.xs,
  },
  expiredBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  expiredBannerText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  expiredHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  expiredHeaderText: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  locationText: {
    ...Typography.caption,
    flex: 1,
  },
  restrictionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  restrictionText: {
    ...Typography.caption,
  },
  actionHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
    marginTop: Spacing.md,
  },
  actionHintText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
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
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    ...Typography.h3,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  emptySubtitle: {
    ...Typography.body,
    textAlign: "center",
  },
  expandedContent: {
    marginTop: Spacing.md,
  },
  divider: {
    height: 1,
    marginBottom: Spacing.md,
  },
  phaseSection: {
    borderLeftWidth: 2,
    paddingLeft: Spacing.md,
    marginBottom: Spacing.md,
  },
  phaseSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  phaseSectionTitle: {
    ...Typography.caption,
    fontWeight: "600",
    flex: 1,
  },
  phaseSectionContent: {
    gap: Spacing.xs,
  },
  detailRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  detailLabel: {
    ...Typography.caption,
    minWidth: 80,
  },
  detailValue: {
    ...Typography.caption,
    flex: 1,
  },
  weatherSection: {
    borderRadius: 8,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  weatherHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  weatherTitle: {
    ...Typography.caption,
    fontWeight: "600",
  },
  weatherGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  weatherItem: {
    alignItems: "center",
    minWidth: 60,
  },
  weatherValue: {
    ...Typography.body,
    fontWeight: "600",
  },
  weatherLabel: {
    ...Typography.caption,
  },
  expandedActions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  completionSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: 8,
    marginBottom: Spacing.md,
  },
  completionText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  completionDetail: {
    ...Typography.caption,
  },
  completionDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: 2,
  },
  completionNotes: {
    ...Typography.caption,
    marginTop: Spacing.xs,
    fontStyle: "italic",
  },
  cancelLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  cancelText: {
    ...Typography.caption,
  },
  checklistSection: {
    marginTop: Spacing.xs,
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
    borderRadius: 4,
  },
  checklistText: {
    ...Typography.caption,
    fontSize: 11,
  },
  phaseProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  phaseProgressItem: {
    padding: 6,
    borderRadius: 6,
  },
  phaseProgressItemComplete: {
    backgroundColor: "rgba(0, 200, 100, 0.15)",
  },
  phaseProgressLine: {
    width: 10,
    height: 2,
  },
});
