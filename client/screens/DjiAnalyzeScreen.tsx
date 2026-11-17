import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import DjiTracksMap from "@/components/DjiTracksMap";
import { DjiRecordsTable } from "@/components/DjiRecordsTable";
import { DjiStickVisualizer, hasStickData } from "@/components/DjiStickVisualizer";
import { DjiFlightReplay, hasReplayData } from "@/components/DjiFlightReplay";
import { DjiMessagesList, hasMessages } from "@/components/DjiMessagesList";
import { DjiLogHelp } from "@/components/DjiLogHelp";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  pickAndAnalyzeDjiLog,
  assignDjiLog,
  isLikelyTestStart,
  type DjiAnalyzeResult,
} from "@/lib/djiLog";
import { getLogbook, type LogbookEntry } from "@/lib/storage";
import { isLoggedInSync } from "@/lib/auth";
import { FeatureLockCard, useFeatureAccess } from "@/components/FeatureGate";
import type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";

type NavigationProp = NativeStackNavigationProp<HistoryStackParamList>;

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type EntryMatch = {
  entry: LogbookEntry;
  sameDay: boolean;
  timeDiffMs: number | null;
  distKm: number | null;
  score: number;
  isSuggested: boolean;
};

function matchLabel(m: EntryMatch): string {
  const parts: string[] = [];
  if (m.sameDay) {
    parts.push("gleicher Tag");
  } else if (m.timeDiffMs != null) {
    const h = m.timeDiffMs / 3_600_000;
    if (h < 48) parts.push(`±${Math.max(1, Math.round(h))} h`);
  }
  if (m.distKm != null) {
    parts.push(
      m.distKm < 1
        ? `${Math.round(m.distKm * 1000)} m`
        : `${m.distKm.toFixed(1).replace(".", ",")} km`,
    );
  }
  return parts.join(" · ");
}

export default function DjiAnalyzeScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const hasDjiLog = useFeatureAccess("dji_log");

  const [analyzing, setAnalyzing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<DjiAnalyzeResult | null>(null);
  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await getLogbook();
        setEntries(list);
      } catch {
        // ignore — offline / no entries
      }
    })();
  }, []);

  const track = result?.track ?? [];
  const mapTracks = useMemo(
    () => [
      {
        coords: track.map((p) => ({ latitude: p.lat, longitude: p.lon })),
        color: "rgba(0, 122, 255, 0.9)",
      },
    ],
    [track],
  );

  // Konsistenter Flugstart: erster Punkt mit Zeitstempel liefert sowohl die
  // Startzeit als auch (wenn vorhanden) die Startkoordinate. Fehlt am
  // Startpunkt die Koordinate, wird der erste gültige Track-Punkt genutzt.
  const { logStartTs, logPoint } = useMemo(() => {
    const trk = result?.track ?? [];
    const startPt = trk.find((pt) => typeof pt.ts === "number");
    const ts = startPt?.ts ?? null;
    let point: { lat: number; lon: number } | null = null;
    if (startPt && Number.isFinite(startPt.lat) && Number.isFinite(startPt.lon)) {
      point = { lat: startPt.lat, lon: startPt.lon };
    } else {
      const validPt = trk.find((pt) => Number.isFinite(pt.lat) && Number.isFinite(pt.lon));
      if (validPt) point = { lat: validPt.lat, lon: validPt.lon };
    }
    return { logStartTs: ts, logPoint: point };
  }, [result]);

  const rankedEntries = useMemo<EntryMatch[]>(() => {
    const scored: EntryMatch[] = entries.map((e) => {
      const entryStart = e.takeoffTime
        ? Date.parse(e.takeoffTime)
        : e.flightDate
          ? Date.parse(e.flightDate)
          : NaN;
      const haveTimes = logStartTs != null && Number.isFinite(entryStart);
      const timeDiffMs = haveTimes ? Math.abs(logStartTs - entryStart) : null;
      let sameDay = false;
      if (haveTimes) {
        const a = new Date(logStartTs);
        const b = new Date(entryStart);
        sameDay =
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate();
      }
      let distKm: number | null = null;
      if (logPoint && Number.isFinite(e.latitude) && Number.isFinite(e.longitude)) {
        distKm = haversineKm(logPoint.lat, logPoint.lon, e.latitude, e.longitude);
      }
      let score = 0;
      if (sameDay) score += 1000;
      if (timeDiffMs != null) score += Math.max(0, 200 - timeDiffMs / 3_600_000);
      if (distKm != null) score += Math.max(0, 100 - distKm * 5);
      const closeInTime = timeDiffMs != null && timeDiffMs <= 3 * 3_600_000;
      const closeInSpace = distKm != null && distKm <= 2;
      const isSuggested = sameDay || closeInTime || closeInSpace;
      return { entry: e, sameDay, timeDiffMs, distKm, score, isSuggested };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }, [entries, logStartTs, logPoint]);

  // Besten Treffer automatisch vorauswählen — aber nur EINMAL je Auswertung,
  // damit ein manuelles Abwählen des Piloten respektiert wird.
  const autoSelectedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = result?.meta.objectPath ?? null;
    if (!key || autoSelectedFor.current === key) return;
    if (rankedEntries.length === 0) return;
    autoSelectedFor.current = key;
    const best = rankedEntries[0];
    if (best && best.isSuggested) {
      setSelectedEntryId(best.entry.id);
    }
  }, [result, rankedEntries]);

  const handleAnalyze = useCallback(async () => {
    if (!isLoggedInSync()) {
      Alert.alert(
        "Anmeldung erforderlich",
        "Bitte melde dich an, um ein DJI-Flugprotokoll auszuwerten.",
      );
      return;
    }
    setAnalyzing(true);
    try {
      const res = await pickAndAnalyzeDjiLog();
      if (res) {
        setResult(res);
        setSelectedEntryId(null);
        
      }
    } catch (e) {
      Alert.alert(
        "Fehler",
        e instanceof Error ? e.message : "Protokoll konnte nicht ausgewertet werden.",
      );
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleAssign = useCallback(
    async (target: "existing" | "new") => {
      if (!result) return;
      if (target === "existing" && !selectedEntryId) {
        Alert.alert("Hinweis", "Bitte wähle zuerst einen Flug aus.");
        return;
      }
      setAssigning(true);
      try {
        await assignDjiLog({
          meta: result.meta,
          target,
          entryId: target === "existing" ? selectedEntryId ?? undefined : undefined,
        });
        
        Alert.alert(
          "Gespeichert",
          target === "new"
            ? "Ein neuer Logbucheintrag wurde aus dem DJI-Protokoll erstellt."
            : "Die Auswertung wurde dem ausgewählten Flug zugeordnet.",
          [{ text: "OK", onPress: () => navigation.goBack() }],
        );
      } catch (e) {
        Alert.alert(
          "Fehler",
          e instanceof Error ? e.message : "Zuordnung fehlgeschlagen.",
        );
      } finally {
        setAssigning(false);
      }
    },
    [result, selectedEntryId, navigation],
  );

  const meta = result?.meta;

  const renderRow = (label: string, value: string) => (
    <View style={styles.detailRow}>
      <ThemedText style={[styles.detailLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
      <ThemedText style={styles.detailValue}>{value}</ThemedText>
    </View>
  );

  if (!hasDjiLog) {
    return (
      <ThemedView style={styles.container}>
        <View style={{ paddingTop: headerHeight + Spacing.lg }}>
          <FeatureLockCard featureKey="dji_log" />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + Spacing["2xl"],
          paddingHorizontal: Spacing.lg,
          gap: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <Card style={styles.section}>
          <View style={styles.headerRow}>
            <Feather name="file-text" size={16} color={theme.primary} />
            <ThemedText style={styles.headerText}>Fluglog auswerten</ThemedText>
          </View>
          <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
            Lade ein DJI-Controller-Flugprotokoll (.txt aus DJI Fly/GO/Pilot) hoch. Die Auswertung
            erscheint sofort — du kannst sie anschließend optional einem Flug zuordnen.
          </ThemedText>
          <Pressable
            testID="button-dji-analyze-upload"
            disabled={analyzing}
            onPress={handleAnalyze}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.primary + "15" },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name="upload" size={15} color={theme.primary} />
            <ThemedText style={[styles.primaryButtonText, { color: theme.primary }]}>
              {analyzing
                ? "Wird ausgewertet …"
                : result
                ? "Anderes Fluglog auswerten"
                : "Fluglog hochladen"}
            </ThemedText>
          </Pressable>
        </Card>

        <DjiLogHelp />

        {meta ? (
          <Card style={styles.section} testID="section-dji-analyze-result">
            <View style={styles.headerRow}>
              <Feather name="bar-chart-2" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Auswertung</ThemedText>
            </View>
            {meta.status === "parsed" ? (
              <ThemedText style={[styles.notice, { color: theme.statusGo }]}>
                Protokoll ausgewertet
                {meta.trackPointCount ? ` · ${meta.trackPointCount} GPS-Punkte` : ""}
              </ThemedText>
            ) : null}
            {meta.status === "parsed" && isLikelyTestStart(meta) ? (
              <View style={[styles.alertBox, { backgroundColor: theme.statusCautionBackground }]}>
                <Feather name="info" size={14} color={theme.statusCaution} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.alertLabel, { color: theme.statusCaution }]}>
                    Vermutlich Test-/Einstellstart
                  </ThemedText>
                  <ThemedText style={[styles.alertText, { color: theme.text }]}>
                    Sehr kurz und ohne zurückgelegte Strecke. Beim Sammel-Import wird so ein Start nicht als Flug erfasst.
                  </ThemedText>
                </View>
              </View>
            ) : null}
            {meta.status !== "parsed" ? (
              <View style={[styles.alertBox, { backgroundColor: theme.statusCautionBackground }]}>
                <Feather name="alert-triangle" size={14} color={theme.statusCaution} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.alertLabel, { color: theme.statusCaution }]}>
                    {meta.status === "undecryptable"
                      ? "Verschlüsseltes Protokoll (DJI v13+)"
                      : "Auswertung unvollständig"}
                  </ThemedText>
                  <ThemedText style={[styles.alertText, { color: theme.text }]}>
                    {meta.status === "undecryptable"
                      ? "Ohne DJI-API-Schlüssel nicht vollständig auswertbar. Basis-Kennzahlen unten."
                      : meta.message || "Einige Werte konnten nicht ermittelt werden."}
                  </ThemedText>
                </View>
              </View>
            ) : null}
            {renderRow("Datei", meta.fileName)}
            {meta.droneName ? renderRow("Drohne (Log)", meta.droneName) : null}
            {meta.version != null ? renderRow("Log-Version", `v${meta.version}`) : null}
            {meta.maxAltitudeM != null ? renderRow("Max. Höhe", `${meta.maxAltitudeM.toFixed(1)} m`) : null}
            {meta.durationSec != null ? renderRow("Flugdauer", `${Math.round(meta.durationSec)} s`) : null}
            {meta.totalDistanceM != null
              ? renderRow("Strecke", `${(meta.totalDistanceM / 1000).toFixed(2)} km`)
              : null}
            {meta.batteryStartPercent != null ||
            meta.batteryEndPercent != null ||
            meta.batteryMinPercent != null
              ? renderRow(
                  "Akku (Start/Ende/Min)",
                  [
                    meta.batteryStartPercent != null ? `${meta.batteryStartPercent}%` : "—",
                    meta.batteryEndPercent != null ? `${meta.batteryEndPercent}%` : "—",
                    meta.batteryMinPercent != null ? `${meta.batteryMinPercent}%` : "—",
                  ].join(" / "),
                )
              : null}
          </Card>
        ) : null}

        {meta && hasReplayData(meta.records) ? (
          <Card style={styles.section} testID="section-dji-analyze-replay">
            <View style={styles.headerRow}>
              <Feather name="play-circle" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Flugwiedergabe</ThemedText>
            </View>
            <DjiFlightReplay records={meta.records!} />
          </Card>
        ) : meta ? (
          <Card style={styles.section} testID="section-dji-analyze-track">
            <View style={styles.headerRow}>
              <Feather name="map" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>GPS-Track</ThemedText>
            </View>
            <DjiTracksMap tracks={mapTracks} />
          </Card>
        ) : null}

        {meta && hasMessages(meta.messages) ? (
          <Card style={styles.section} testID="section-dji-analyze-messages">
            <View style={styles.headerRow}>
              <Feather name="message-square" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Meldungen der Fernsteuerung</ThemedText>
            </View>
            <DjiMessagesList messages={meta.messages!} />
          </Card>
        ) : null}

        {meta && hasStickData(meta.records) ? (
          <Card style={styles.section} testID="section-dji-analyze-sticks">
            <View style={styles.headerRow}>
              <Feather name="navigation" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Steuerknüppel-Eingaben</ThemedText>
            </View>
            <DjiStickVisualizer records={meta.records!} />
          </Card>
        ) : null}

        {meta && meta.records && meta.records.length > 0 ? (
          <Card style={styles.section} testID="section-dji-analyze-table">
            <View style={styles.headerRow}>
              <Feather name="list" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Detailauswertung</ThemedText>
            </View>
            <DjiRecordsTable records={meta.records} />
          </Card>
        ) : null}

        {meta ? (
          <Card style={styles.section} testID="section-dji-analyze-assign">
            <View style={styles.headerRow}>
              <Feather name="link" size={16} color={theme.primary} />
              <ThemedText style={styles.headerText}>Einem Flug zuordnen</ThemedText>
            </View>
            <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
              Diese Auswertung wird nicht gespeichert, solange du sie keinem Flug zuordnest.
            </ThemedText>

            {entries.length > 0 ? (
              <View style={styles.entryList}>
                <ThemedText style={[styles.subLabel, { color: theme.textSecondary }]}>
                  Bestehendem Flug zuordnen
                </ThemedText>
                {rankedEntries.map((m) => {
                  const e = m.entry;
                  const selected = selectedEntryId === e.id;
                  const badge = m.isSuggested ? matchLabel(m) : "";
                  return (
                    <Pressable
                      key={e.id}
                      testID={`row-dji-entry-${e.id}`}
                      onPress={() => setSelectedEntryId(selected ? null : e.id)}
                      style={({ pressed }) => [
                        styles.entryRow,
                        {
                          backgroundColor: selected ? theme.primary + "15" : theme.backgroundSecondary,
                          borderColor: selected
                            ? theme.primary
                            : m.isSuggested
                              ? theme.statusGo
                              : theme.border,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Feather
                        name={selected ? "check-circle" : "circle"}
                        size={16}
                        color={selected ? theme.primary : theme.textTertiary}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={styles.entryTitleRow}>
                          <ThemedText style={styles.entryTitle} numberOfLines={1}>
                            {e.droneName || "Unbenannte Drohne"}
                          </ThemedText>
                          {m.isSuggested ? (
                            <View style={[styles.matchBadge, { backgroundColor: theme.statusGo + "22" }]}>
                              <Feather name="zap" size={10} color={theme.statusGo} />
                              <ThemedText style={[styles.matchBadgeText, { color: theme.statusGo }]} numberOfLines={1}>
                                {badge ? `Passt · ${badge}` : "Passt"}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                        <ThemedText style={[styles.entrySub, { color: theme.textSecondary }]} numberOfLines={1}>
                          {e.flightDate}
                          {e.locationName ? ` · ${e.locationName}` : ""}
                        </ThemedText>
                      </View>
                    </Pressable>
                  );
                })}
                <Pressable
                  testID="button-dji-assign-existing"
                  disabled={assigning || !selectedEntryId}
                  onPress={() => handleAssign("existing")}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    {
                      backgroundColor: theme.backgroundSecondary,
                      opacity: !selectedEntryId ? 0.5 : 1,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Feather name="check" size={15} color={theme.primary} />
                  <ThemedText style={[styles.primaryButtonText, { color: theme.primary }]}>
                    {assigning ? "Wird zugeordnet …" : "Ausgewähltem Flug zuordnen"}
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            <Pressable
              testID="button-dji-assign-new"
              disabled={assigning}
              onPress={() => handleAssign("new")}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary + "15", marginTop: Spacing.md },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Feather name="plus-circle" size={15} color={theme.primary} />
              <ThemedText style={[styles.primaryButtonText, { color: theme.primary }]}>
                {assigning ? "Wird gespeichert …" : "Als neuen Flug speichern"}
              </ThemedText>
            </Pressable>
          </Card>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  headerText: {
    ...Typography.body,
    fontWeight: "600",
  },
  intro: {
    ...Typography.small,
    lineHeight: 18,
  },
  notice: {
    ...Typography.small,
    fontWeight: "500",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
  },
  primaryButtonText: {
    ...Typography.small,
    fontWeight: "600",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: Spacing.md,
  },
  detailLabel: {
    ...Typography.small,
    flexShrink: 0,
  },
  detailValue: {
    ...Typography.small,
    fontWeight: "500",
    flex: 1,
    textAlign: "right",
  },
  alertBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  alertLabel: {
    ...Typography.small,
    fontWeight: "600",
  },
  alertText: {
    ...Typography.small,
    marginTop: 2,
  },
  mapWrapper: {
    height: 260,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.xs,
    backgroundColor: "#E5E7EB",
  },
  entryList: {
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  subLabel: {
    ...Typography.caption,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  entryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  entryTitle: {
    ...Typography.small,
    fontWeight: "600",
    flexShrink: 1,
  },
  matchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    flexShrink: 0,
  },
  matchBadgeText: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 10,
  },
  entrySub: {
    ...Typography.caption,
  },
});
