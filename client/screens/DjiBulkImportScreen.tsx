import React, { useCallback, useEffect, useMemo, useState } from "react";
import { computeMatches, type EntryMatch } from "@/lib/djiLogMatch";
import { View, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator, Modal } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  pickAndAnalyzeMultipleDjiLogs,
  analyzeDjiLogFolder,
  chooseDjiLogFolder,
  getSavedDjiLogFolder,
  forgetDjiLogFolder,
  folderLabelFromUri,
  refreshDjiLogNewHint,
  subscribeDjiLogFolder,
  isFolderImportSupported,
  type DjiBulkResult,
  groupDjiAnalyses,
  assignDjiLog,
  tidyDjiLogEntries,
  isLikelyTestStart,
  type DjiAnalyzeResult,
  dronesCompatible,
  type DjiAnalysisGroup,
  type DjiBulkError,
  type DjiBulkProgress,
} from "@/lib/djiLog";
import { getLogbookLite, getDrones, updateDrone, type LogbookEntry, type DroneProfile } from "@/lib/storage";
import { findDroneForLog } from "@/lib/djiBatteryLink";
import { DroneImage } from "@/components/DroneImage";
import { reverseGeocodePlace } from "@/lib/countryMaps";
import { type DjiMapTrack } from "@/components/DjiTracksMap";
import MiniTrackSketch from "@/components/MiniTrackSketch";
import { DjiLogHelp } from "@/components/DjiLogHelp";
import type { HistoryStackParamList } from "@/navigation/HistoryStackNavigator";

const PREVIEW_TRACK_COLORS = ["#0A84FF", "#FF9F0A", "#30D158", "#BF5AF2", "#FF375F"];
const NO_TRACKS: DjiMapTrack[] = [];

type NavigationProp = NativeStackNavigationProp<HistoryStackParamList>;



function matchDetail(m: EntryMatch): string {
  const parts: string[] = [];
  if (m.timeDiffMs != null) {
    const h = m.timeDiffMs / 3_600_000;
    parts.push(h < 1 ? `${Math.round(m.timeDiffMs / 60000)} min` : `±${h.toFixed(1).replace(".", ",")} h`);
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

const MIN_PLAUSIBLE_TS = Date.UTC(2000, 0, 1);

function plausibleTs(ts?: number | null): ts is number {
  return ts != null && Number.isFinite(ts) && ts >= MIN_PLAUSIBLE_TS;
}

// DJI-Dateinamen enthalten oft das Datum, z. B. FlightRecord_2026-04-04_[12-17-39].txt
function parseFileNameTs(fileName?: string): number | null {
  if (!fileName) return null;
  const m = fileName.match(/(\d{4})-(\d{2})-(\d{2})(?:[_ T]*\[?(\d{2})-(\d{2})-(\d{2})\]?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hh ? Number(hh) : 0,
    mm ? Number(mm) : 0,
    ss ? Number(ss) : 0,
  );
  const t = dt.getTime();
  return plausibleTs(t) ? t : null;
}

function groupDisplayTs(group: DjiAnalysisGroup): number | null {
  if (plausibleTs(group.startTs)) return group.startTs;
  for (const it of group.items) {
    const fromName = parseFileNameTs(it.meta.fileName);
    if (fromName != null) return fromName;
  }
  return null;
}

function fmtDateTime(ts?: number | null): string {
  if (!plausibleTs(ts)) return "Ohne Zeitstempel";
  try {
    return new Date(ts).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Ohne Zeitstempel";
  }
}

function logSummary(r: DjiAnalyzeResult): string {
  const m = r.meta;
  const parts: string[] = [];
  if (m.durationSec != null) parts.push(`${Math.round(m.durationSec)} s`);
  if (m.maxAltitudeM != null) parts.push(`${m.maxAltitudeM.toFixed(0)} m`);
  if (m.totalDistanceM != null) parts.push(`${(m.totalDistanceM / 1000).toFixed(2)} km`);
  return parts.join(" · ");
}

type Selection = { target: "new" | "existing"; entryId?: string };

export default function DjiBulkImportScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<HistoryStackParamList, "DjiBulkImport">>();
  const autoImportAt = route.params?.autoImportAt;
  const handledAutoImport = React.useRef<number | undefined>(undefined);
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<DjiBulkProgress | null>(null);
  const [results, setResults] = useState<DjiAnalyzeResult[]>([]);
  const [errors, setErrors] = useState<DjiBulkError[]>([]);
  const [skippedTestStarts, setSkippedTestStarts] = useState(0);
  const [entries, setEntries] = useState<LogbookEntry[]>([]);
  const [selection, setSelection] = useState<Record<string, Selection>>({});
  const [assignedTo, setAssignedTo] = useState<Record<string, string>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [assigningAll, setAssigningAll] = useState<{ done: number; total: number } | null>(null);
  const [folderUri, setFolderUri] = useState<string | null>(null);
  const [skippedKnown, setSkippedKnown] = useState(0);
  const [showFolderHelp, setShowFolderHelp] = useState(false);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [drones, setDrones] = useState<DroneProfile[]>([]);
  const [dronePickerGroup, setDronePickerGroup] = useState<string | null>(null);
  const requestedPlaces = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        setEntries(await getLogbookLite());
      } catch {
        // ignore — offline / no entries
      }
      try {
        setDrones(await getDrones({ includeArchived: true }));
      } catch {
        // ignore
      }
    })();
    getSavedDjiLogFolder().then(setFolderUri).catch(() => {});
    // gleicher Ordner wie in den Einstellungen (dort geändert → hier mitziehen)
    return subscribeDjiLogFolder(setFolderUri);
  }, []);

  const groups = useMemo(() => groupDjiAnalyses(results, { maxKm: 2, maxHours: 3 }), [results]);

  // Automatische Drohnen-Erkennung je Gruppe über die Seriennummer (sonst Name)
  const detectedDroneByGroup = useMemo(() => {
    const map: Record<string, DroneProfile | null> = {};
    for (const g of groups) {
      const meta = g.items[0]?.meta;
      map[g.id] = meta ? findDroneForLog(drones, meta) : null;
    }
    return map;
  }, [groups, drones]);

  // Seriennummer automatisch lernen: passt ein Log eindeutig über den Namen zu
  // einer Drohne, die noch keine Seriennummer hat, wird sie aus dem Log
  // übernommen – ab dann matchen alle Flüge dieses Fluggeräts per Seriennummer.
  const autoLearnedRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let changed = false;
      for (const g of groups) {
        const det = detectedDroneByGroup[g.id];
        const sn = g.items[0]?.meta.aircraftSn;
        if (det && sn && !det.serialNumber && !autoLearnedRef.current.has(det.id)) {
          autoLearnedRef.current.add(det.id);
          try {
            await updateDrone(det.id, { serialNumber: sn });
            changed = true;
          } catch {
            // ignore
          }
        }
      }
      if (changed && !cancelled) {
        try { setDrones(await getDrones({ includeArchived: true })); } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [groups, detectedDroneByGroup]);

  // Drohne manuell zuordnen: lernt die Seriennummer aus dem Log, damit ab jetzt
  // alle Flüge dieses Fluggeräts automatisch dieser Drohne zugeordnet werden.
  const assignDroneToGroup = useCallback(async (groupId: string, drone: DroneProfile) => {
    setDronePickerGroup(null);
    const g = groups.find((x) => x.id === groupId);
    const sn = g?.items[0]?.meta.aircraftSn;
    try {
      if (sn && sn !== drone.serialNumber) {
        await updateDrone(drone.id, { serialNumber: sn });
      }
      setDrones(await getDrones({ includeArchived: true }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Fehler", e instanceof Error ? e.message : "Drohne konnte nicht zugeordnet werden.");
    }
  }, [groups]);

  const matchesByGroup = useMemo(() => {
    const map: Record<string, EntryMatch[]> = {};
    for (const g of groups) map[g.id] = computeMatches(g, entries);
    return map;
  }, [groups, entries]);

  // Vorschau-Routen je Gruppe nur neu bauen, wenn sich die Gruppen ändern
  // (stabile Referenz → MiniTrackSketch-memo greift bei jedem Re-Render).
  const previewTracksByGroup = useMemo(() => {
    const map: Record<string, DjiMapTrack[]> = {};
    for (const g of groups) {
      map[g.id] = g.items
        .map((it, i) => {
          const pts = it.track && it.track.length > 0 ? it.track : it.meta.track ?? [];
          return {
            coords: pts
              .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
              .map((p) => ({ latitude: p.lat, longitude: p.lon })),
            color: PREVIEW_TRACK_COLORS[i % PREVIEW_TRACK_COLORS.length],
            label: it.meta.fileName,
          };
        })
        .filter((t) => t.coords.length >= 2);
    }
    return map;
  }, [groups]);

  // Ortsnamen per Reverse-Geocoding nachladen (einmal pro Gruppe).
  useEffect(() => {
    groups.forEach((g) => {
      if (g.startLat == null || g.startLon == null) return;
      if (placeNames[g.id] || requestedPlaces.current.has(g.id)) return;
      requestedPlaces.current.add(g.id);
      reverseGeocodePlace(g.startLat, g.startLon)
        .then((name) => {
          if (name) setPlaceNames((prev) => ({ ...prev, [g.id]: name }));
          else requestedPlaces.current.delete(g.id); // erneuter Versuch erlaubt
        })
        .catch(() => {
          requestedPlaces.current.delete(g.id); // Koordinaten bleiben Fallback, Retry möglich
        });
    });
  }, [groups, placeNames]);

  // Bei perfektem Treffer den bestehenden Flug vorschlagen, sonst "neuer Flug".
  useEffect(() => {
    setSelection((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const g of groups) {
        if (next[g.id]) continue;
        const top = matchesByGroup[g.id]?.[0];
        if (top && top.isStrong) {
          next[g.id] = { target: "existing", entryId: top.entry.id };
        } else {
          next[g.id] = { target: "new" };
        }
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [groups, matchesByGroup]);

  const applyResult = useCallback((res: DjiBulkResult, known = 0) => {
    // Test-/Einstellstarts (sehr kurz + keine Strecke) gar nicht erst als
    // importierbaren Flug anbieten — sie sollen nicht erfasst werden.
    const kept = res.results.filter((r) => !isLikelyTestStart(r.meta));
    setResults(kept);
    setSkippedTestStarts(res.results.length - kept.length);
    setSkippedKnown(known);
    setErrors(res.errors);
    setSelection({});
    setAssignedTo({});
    setPlaceNames({});
    requestedPlaces.current.clear();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handlePick = useCallback(async () => {
    setAnalyzing(true);
    setProgress(null);
    try {
      const res = await pickAndAnalyzeMultipleDjiLogs((p) => setProgress(p));
      if (!res) return; // abgebrochen
      applyResult(res);
    } catch (e) {
      Alert.alert("Fehler", e instanceof Error ? e.message : "Import fehlgeschlagen.");
    } finally {
      setAnalyzing(false);
      setProgress(null);
    }
  }, [applyResult]);

  const importFolder = useCallback(
    async (uri: string) => {
      setAnalyzing(true);
      setProgress(null);
      try {
        const res = await analyzeDjiLogFolder(uri, (p) => setProgress(p));
        applyResult(res, res.skippedKnown);
        if (res.results.length === 0 && res.errors.length === 0 && res.skippedKnown === 0) {
          Alert.alert(
            "Keine Protokolle",
            `Im Ordner „${res.folderLabel}“ wurden keine DJI-Flugprotokolle (.txt) gefunden.`,
          );
        }
      } catch (e) {
        Alert.alert("Ordner nicht lesbar", e instanceof Error ? e.message : "Import fehlgeschlagen.");
        setShowFolderHelp(true);
      } finally {
        setAnalyzing(false);
        setProgress(null);
      }
    },
    [applyResult],
  );

  // Einstellungen → „Jetzt neue Logs importieren“: gemerkten Ordner direkt einlesen
  useEffect(() => {
    if (autoImportAt == null || handledAutoImport.current === autoImportAt) return;
    handledAutoImport.current = autoImportAt;
    (async () => {
      const uri = await getSavedDjiLogFolder();
      if (!uri) {
        Alert.alert("Kein Ordner", "Bitte zuerst einen Ordner mit den DJI-Flugprotokollen freigeben.");
        return;
      }
      setFolderUri(uri);
      await importFolder(uri);
    })().catch(() => {});
  }, [autoImportAt, importFolder]);

  const handleChooseFolder = useCallback(
    async (initial: "djiFly" | "download") => {
      try {
        const uri = await chooseDjiLogFolder(initial);
        if (!uri) {
          // abgebrochen oder von Android verweigert (Android/data ab Android 11 teils gesperrt)
          if (initial === "djiFly") setShowFolderHelp(true);
          return;
        }
        setFolderUri(uri);
        await importFolder(uri);
      } catch (e) {
        setShowFolderHelp(true);
        Alert.alert("Ordner", e instanceof Error ? e.message : "Ordner konnte nicht geöffnet werden.");
      }
    },
    [importFolder],
  );

  const assignGroup = useCallback(
    async (group: DjiAnalysisGroup) => {
      const sel = selection[group.id] ?? { target: "new" };
      if (sel.target === "existing" && !sel.entryId) {
        Alert.alert("Auswahl fehlt", "Bitte wähle einen bestehenden Flug oder „Neuer Flug“.");
        return;
      }
      setBusyGroup(group.id);
      try {
        let entryId = sel.entryId;
        if (sel.target === "new") {
          const created = await assignDjiLog({ meta: group.items[0].meta, target: "new" });
          entryId = created.id;
        } else {
          await assignDjiLog({
            meta: group.items[0].meta,
            target: "existing",
            entryId,
          });
        }
        for (let i = 1; i < group.items.length; i++) {
          await assignDjiLog({ meta: group.items[i].meta, target: "existing", entryId });
        }
        setAssignedTo((prev) => ({ ...prev, [group.id]: entryId! }));
        setEntries(await getLogbookLite());
        refreshDjiLogNewHint().catch(() => {}); // Logbuch-Hinweis „neue Logs“ nachziehen
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (e) {
        Alert.alert("Fehler", e instanceof Error ? e.message : "Zuordnung fehlgeschlagen.");
      } finally {
        setBusyGroup(null);
      }
    },
    [selection],
  );

  // Alle Gruppen auf einen Schlag zuordnen: pro Flug ein neuer Eintrag, außer es
  // gibt einen eindeutigen (starken) Treffer zu einem bestehenden Flug – dann
  // dorthin. Drohne/Akku werden wie gehabt automatisch verknüpft. Keine 40 Klicks.
  const assignAllGroups = useCallback(async () => {
    const todo = groups.filter((g) => !assignedTo[g.id]);
    if (todo.length === 0) return;
    setAssigningAll({ done: 0, total: todo.length });
    let done = 0;
    const newAssigned: Record<string, string> = {};
    try {
      for (const group of todo) {
        try {
          const strong = (matchesByGroup[group.id] ?? []).find((m) => m.isStrong);
          let entryId: string;
          if (strong) {
            const e = await assignDjiLog({ meta: group.items[0].meta, target: "existing", entryId: strong.entry.id });
            entryId = e.id;
          } else {
            const created = await assignDjiLog({ meta: group.items[0].meta, target: "new" });
            entryId = created.id;
          }
          for (let i = 1; i < group.items.length; i++) {
            await assignDjiLog({ meta: group.items[i].meta, target: "existing", entryId });
          }
          newAssigned[group.id] = entryId;
        } catch {
          // einzelne Gruppe überspringen, Rest weiterführen
        }
        done += 1;
        setAssigningAll({ done, total: todo.length });
        // UI kurz atmen lassen (Fortschritt sichtbar, kein Einfrieren)
        await new Promise((r) => setTimeout(r, 0));
      }
      setAssignedTo((prev) => ({ ...prev, ...newAssigned }));
      // Zusammengehörige Flüge (gleiche Drohne, zeitnah) zusammenführen.
      await tidyDjiLogEntries();
      setEntries(await getLogbookLite());
      refreshDjiLogNewHint().catch(() => {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setAssigningAll(null);
    }
  }, [groups, assignedTo, matchesByGroup]);

  const setGroupSelection = (groupId: string, sel: Selection) => {
    setSelection((prev) => ({ ...prev, [groupId]: sel }));
  };

  const renderGroup = (group: DjiAnalysisGroup, index: number) => {
    const sel = selection[group.id] ?? { target: "new" };
    const matches = matchesByGroup[group.id] ?? [];
    const suggested = matches.filter((m) => m.isSuggested).slice(0, 4);
    const assignedEntryId = assignedTo[group.id];
    const busy = busyGroup === group.id;

    const hasCoords = group.startLat != null && group.startLon != null;
    const coordsText = hasCoords
      ? `${group.startLat!.toFixed(4)}, ${group.startLon!.toFixed(4)}`
      : "Kein GPS-Startpunkt";
    const placeName = placeNames[group.id];
    const displayTs = groupDisplayTs(group);

    const previewTracks = previewTracksByGroup[group.id] ?? NO_TRACKS;

    return (
      <Card key={group.id} style={styles.section} testID={`group-dji-bulk-${index}`}>
        <View style={styles.headerRow}>
          <Feather name="navigation" size={16} color={theme.primary} />
          <ThemedText style={styles.headerText}>
            {`Flug ${index + 1} · ${group.items.length} ${group.items.length === 1 ? "Log" : "Logs"}`}
          </ThemedText>
        </View>

        <View style={styles.droneRow}>
          <Feather name="cpu" size={13} color={theme.primary} />
          <ThemedText style={[styles.droneText, { color: theme.text }]}>
            {group.droneName || "Unbekanntes Fluggerät"}
          </ThemedText>
        </View>
        {(() => {
          const det = detectedDroneByGroup[group.id];
          const sn = group.items[0]?.meta.aircraftSn;
          if (det) {
            return (
              <Pressable
                testID={`group-drone-detected-${index}`}
                onPress={() => setDronePickerGroup(group.id)}
                style={[styles.detectedDrone, { borderColor: theme.statusGo }]}
              >
                <DroneImage manufacturer={det.manufacturer} model={det.model} size={32} iconColor={theme.statusGo} iconSize={20} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.detectedText, { color: theme.statusGo }]} numberOfLines={1}>
                    Erkannt: {det.name}
                  </ThemedText>
                  <ThemedText style={[styles.detectedSub, { color: theme.textTertiary }]} numberOfLines={1}>
                    {det.serialNumber && sn && det.serialNumber === sn ? "über Seriennummer" : "über Modellname · tippen zum Ändern"}
                  </ThemedText>
                </View>
                <Feather name="edit-2" size={13} color={theme.textTertiary} />
              </Pressable>
            );
          }
          return (
            <Pressable
              testID={`group-drone-assign-${index}`}
              onPress={() => setDronePickerGroup(group.id)}
              style={[styles.detectedDrone, { borderColor: theme.border }]}
            >
              <Feather name="help-circle" size={18} color={theme.textTertiary} />
              <View style={{ flex: 1 }}>
                <ThemedText style={[styles.detectedText, { color: theme.text }]} numberOfLines={1}>
                  Keiner Drohne zugeordnet
                </ThemedText>
                <ThemedText style={[styles.detectedSub, { color: theme.textTertiary }]} numberOfLines={1}>
                  {sn ? "Drohne zuordnen – Seriennummer wird gelernt" : "Drohne zuordnen"}
                </ThemedText>
              </View>
              <Feather name="plus-circle" size={16} color={theme.primary} />
            </Pressable>
          );
        })()}
        <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
          {fmtDateTime(displayTs)}
        </ThemedText>
        <ThemedText style={[styles.meta, { color: theme.textSecondary }]}>
          {placeName || coordsText}
        </ThemedText>
        {placeName && hasCoords ? (
          <ThemedText style={[styles.metaSub, { color: theme.textTertiary }]}>
            {coordsText}
          </ThemedText>
        ) : null}

        {previewTracks.length > 0 ? (
          <View style={styles.preview}>
            <MiniTrackSketch tracks={previewTracks} />
          </View>
        ) : null}

        <View style={styles.logList}>
          {group.items.map((it, i) => (
            <View key={`${group.id}-log-${i}`} style={[styles.logRow, { borderColor: theme.border }]}>
              <Feather name="file-text" size={14} color={theme.textTertiary} />
              <View style={styles.logInfo}>
                <ThemedText style={styles.logName} numberOfLines={1}>
                  {it.meta.fileName}
                </ThemedText>
                <ThemedText style={[styles.logSummary, { color: theme.textTertiary }]}>
                  {logSummary(it) || "Keine Kennzahlen"}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        {assignedEntryId ? (
          <Pressable
            testID={`button-open-entry-${index}`}
            onPress={() =>
              navigation.navigate("LogbookEntryDetail", { logbookEntryId: assignedEntryId })
            }
            style={({ pressed }) => [
              styles.assignedBox,
              { backgroundColor: theme.statusGoBackground },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Feather name="check-circle" size={16} color={theme.statusGo} />
            <ThemedText style={[styles.assignedText, { color: theme.statusGo }]}>
              Zugeordnet — Flug öffnen
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.choiceBlock}>
            <ThemedText style={[styles.choiceLabel, { color: theme.textSecondary }]}>
              Zuordnen zu
            </ThemedText>

            <Pressable
              testID={`choice-new-${index}`}
              onPress={() => setGroupSelection(group.id, { target: "new" })}
              style={[
                styles.choiceRow,
                {
                  borderColor: sel.target === "new" ? theme.primary : theme.border,
                  backgroundColor: sel.target === "new" ? theme.primary + "12" : "transparent",
                },
              ]}
            >
              <Feather
                name={sel.target === "new" ? "check-circle" : "circle"}
                size={16}
                color={sel.target === "new" ? theme.primary : theme.textTertiary}
              />
              <ThemedText style={styles.choiceText}>Neuer Flug</ThemedText>
            </Pressable>

            {suggested.map((m) => {
              const active = sel.target === "existing" && sel.entryId === m.entry.id;
              const title = m.entry.locationName || m.entry.flightDate || "Flug";
              return (
                <Pressable
                  key={`${group.id}-match-${m.entry.id}`}
                  testID={`choice-existing-${index}-${m.entry.id}`}
                  onPress={() =>
                    setGroupSelection(group.id, { target: "existing", entryId: m.entry.id })
                  }
                  style={[
                    styles.choiceRow,
                    {
                      borderColor: active ? theme.primary : theme.border,
                      backgroundColor: active ? theme.primary + "12" : "transparent",
                    },
                  ]}
                >
                  <Feather
                    name={active ? "check-circle" : "circle"}
                    size={16}
                    color={active ? theme.primary : theme.textTertiary}
                  />
                  <View style={styles.choiceInfo}>
                    <ThemedText style={styles.choiceText} numberOfLines={1}>
                      {title}
                    </ThemedText>
                    <ThemedText style={[styles.choiceMeta, { color: theme.textTertiary }]}>
                      {matchDetail(m) || "Bestehender Flug"}
                      {m.isStrong ? "  ·  passt genau" : ""}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}

            <Pressable
              testID={`button-assign-group-${index}`}
              disabled={busy}
              onPress={() => assignGroup(group)}
              style={({ pressed }) => [
                styles.assignButton,
                { backgroundColor: theme.primary },
                (pressed || busy) && { opacity: 0.7 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Feather name="link" size={16} color="#fff" />
                  <ThemedText style={styles.assignButtonText}>Zuordnen</ThemedText>
                </>
              )}
            </Pressable>
          </View>
        )}
      </Card>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: insets.bottom + Spacing["3xl"],
          paddingHorizontal: Spacing.lg,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
      >
        <ThemedText style={[styles.intro, { color: theme.textSecondary }]}>
          Wähle mehrere DJI-Flugprotokolle (.txt) oder einen ganzen Ordner. Ausgewertet wird auf
          diesem Gerät. Logs vom selben Startort (unter 2 km) und derselben Startzeit (unter 3 h)
          werden als ein Flug gruppiert — ideal bei Akku-Wechseln.
        </ThemedText>

        <Pressable
          testID="button-bulk-pick"
          disabled={analyzing}
          onPress={handlePick}
          style={({ pressed }) => [
            styles.pickButton,
            { backgroundColor: theme.primary },
            (pressed || analyzing) && { opacity: 0.7 },
          ]}
        >
          {analyzing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Feather name="upload" size={18} color="#fff" />
              <ThemedText style={styles.pickButtonText}>Logs auswählen</ThemedText>
            </>
          )}
        </Pressable>

        {isFolderImportSupported() ? (
          <View style={styles.folderBlock}>
            <View style={styles.folderRow}>
              <Pressable
                testID="button-bulk-folder-djifly"
                disabled={analyzing}
                onPress={() => handleChooseFolder("djiFly")}
                style={({ pressed }) => [
                  styles.folderButton,
                  { borderColor: theme.primary + "40", backgroundColor: theme.primary + "12" },
                  (pressed || analyzing) && { opacity: 0.6 },
                ]}
              >
                <Feather name="folder" size={16} color={theme.primary} />
                <ThemedText style={[styles.folderButtonText, { color: theme.primary }]} numberOfLines={1}>
                  Ordner wählen (DJI Fly)
                </ThemedText>
              </Pressable>
              <Pressable
                testID="button-bulk-folder-download"
                disabled={analyzing}
                onPress={() => handleChooseFolder("download")}
                style={({ pressed }) => [
                  styles.folderButton,
                  { borderColor: theme.border, backgroundColor: theme.backgroundSecondary },
                  (pressed || analyzing) && { opacity: 0.6 },
                ]}
              >
                <Feather name="download" size={16} color={theme.text} />
                <ThemedText style={[styles.folderButtonText, { color: theme.text }]} numberOfLines={1}>
                  Download/FlightRecords
                </ThemedText>
              </Pressable>
            </View>
            {folderUri ? (
              <View style={styles.folderRow}>
                <Pressable
                  testID="button-bulk-folder-rescan"
                  disabled={analyzing}
                  onPress={() => importFolder(folderUri)}
                  style={({ pressed }) => [
                    styles.folderButton,
                    { borderColor: theme.statusGo + "60", backgroundColor: theme.statusGoBackground },
                    (pressed || analyzing) && { opacity: 0.6 },
                  ]}
                >
                  <Feather name="refresh-cw" size={16} color={theme.statusGo} />
                  <ThemedText style={[styles.folderButtonText, { color: theme.statusGo }]} numberOfLines={1}>
                    {`Neue Logs aus „${folderLabelFromUri(folderUri)}“`}
                  </ThemedText>
                </Pressable>
                <Pressable
                  testID="button-bulk-folder-forget"
                  disabled={analyzing}
                  onPress={() => {
                    forgetDjiLogFolder().catch(() => {});
                    setFolderUri(null);
                  }}
                  style={({ pressed }) => [styles.folderForget, pressed && { opacity: 0.6 }]}
                  accessibilityLabel="Gemerkten Ordner vergessen"
                >
                  <Feather name="x" size={16} color={theme.textSecondary} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {showFolderHelp ? (
          <Card style={[styles.section, { backgroundColor: theme.statusCautionBackground }]} testID="card-folder-help">
            <ThemedText style={[styles.errorTitle, { color: theme.statusCaution }]}>
              DJI-Fly-Ordner nicht freigegeben?
            </ThemedText>
            <ThemedText style={[styles.hint, { color: theme.text, marginTop: Spacing.xs }]}>
              Android 11 sperrt „Android/data“ für andere Apps oft. Dann: Protokolle per PC/USB aus
              „Android/data/dji.go.v5/files/FlightRecord“ nach „Download/FlightRecords“ kopieren und
              diesen Ordner wählen – oder in DJI Fly das Protokoll exportieren/teilen und hier einzeln
              auswählen. Details unten in der Hilfe.
            </ThemedText>
          </Card>
        ) : null}

        {analyzing && progress ? (
          <View style={styles.progressBlock}>
            <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSecondary }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: theme.primary,
                    width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                  },
                ]}
              />
            </View>
            <ThemedText style={[styles.progress, { color: theme.textSecondary }]} numberOfLines={1}>
              {`Verarbeite ${Math.min(progress.done + 1, progress.total)} / ${progress.total} — ${progress.fileName}`}
            </ThemedText>
          </View>
        ) : null}

        {skippedKnown > 0 ? (
          <ThemedText style={[styles.hint, { color: theme.textTertiary, marginTop: Spacing.md }]}>
            {`${skippedKnown} ${skippedKnown === 1 ? "Protokoll ist" : "Protokolle sind"} schon im Logbuch und ${skippedKnown === 1 ? "wurde" : "wurden"} übersprungen.`}
          </ThemedText>
        ) : null}

        {errors.length > 0 ? (
          <Card style={[styles.section, { backgroundColor: theme.statusNoGoBackground }]}>
            <ThemedText style={[styles.errorTitle, { color: theme.statusNoGo }]}>
              {`${errors.length} ${errors.length === 1 ? "Datei" : "Dateien"} fehlgeschlagen`}
            </ThemedText>
            {errors.map((er, i) => (
              <ThemedText
                key={`err-${i}`}
                style={[styles.errorItem, { color: theme.statusNoGo }]}
                numberOfLines={2}
              >
                {`${er.fileName}: ${er.error}`}
              </ThemedText>
            ))}
          </Card>
        ) : null}

        {skippedTestStarts > 0 ? (
          <Card style={[styles.section, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.headerRow}>
              <Feather name="info" size={16} color={theme.textSecondary} />
              <ThemedText style={[styles.headerText, { color: theme.textSecondary }]}>
                {`${skippedTestStarts} Test-/Einstellstart${skippedTestStarts === 1 ? "" : "s"} übersprungen`}
              </ThemedText>
            </View>
            <ThemedText style={[styles.hint, { color: theme.textTertiary, marginTop: Spacing.xs }]}>
              Sehr kurze Starts ohne zurückgelegte Strecke (Kalibrierung/Funktionstest) werden nicht als Flug erfasst.
            </ThemedText>
          </Card>
        ) : null}

        {(() => {
          const open = groups.filter((g) => !assignedTo[g.id]).length;
          if (open < 2) return null;
          return (
            <Pressable
              testID="button-assign-all"
              disabled={!!assigningAll}
              onPress={assignAllGroups}
              style={({ pressed }) => [
                styles.assignAllButton,
                { backgroundColor: theme.primary },
                (pressed || !!assigningAll) && { opacity: 0.7 },
              ]}
            >
              {assigningAll ? (
                <>
                  <ActivityIndicator color="#fff" size="small" />
                  <ThemedText style={styles.assignAllText}>
                    {`Importiere … ${assigningAll.done}/${assigningAll.total}`}
                  </ThemedText>
                </>
              ) : (
                <>
                  <Feather name="layers" size={16} color="#fff" />
                  <ThemedText style={styles.assignAllText}>
                    {`Alle ${open} Flüge auf einmal importieren`}
                  </ThemedText>
                </>
              )}
            </Pressable>
          );
        })()}

        {groups.map((g, i) => renderGroup(g, i))}

        {!analyzing && results.length === 0 ? (
          <ThemedText style={[styles.hint, { color: theme.textTertiary }]}>
            {skippedTestStarts > 0
              ? "Nur Test-/Einstellstarts gefunden – keine Flüge zu importieren."
              : "Noch keine Logs ausgewählt."}
          </ThemedText>
        ) : null}

        <View style={{ marginTop: Spacing.lg }}>
          <DjiLogHelp />
        </View>
      </ScrollView>
      <Modal visible={dronePickerGroup != null} transparent animationType="fade" onRequestClose={() => setDronePickerGroup(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setDronePickerGroup(null)}>
          <Pressable onPress={() => {}} style={[styles.modalCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText style={[styles.modalTitle, { color: theme.text }]}>Drohne zuordnen</ThemedText>
            <ThemedText style={[styles.modalHint, { color: theme.textSecondary }]}>
              Die Seriennummer aus dem Log wird der gewählten Drohne gemerkt. Künftige Flüge
              dieses Fluggeräts werden dann automatisch zugeordnet.
            </ThemedText>
            <ScrollView style={{ maxHeight: 320 }}>
              {drones.filter((d) => !d.archivedAt).map((d) => (
                <Pressable
                  key={d.id}
                  testID={`drone-pick-${d.id}`}
                  onPress={() => dronePickerGroup && assignDroneToGroup(dronePickerGroup, d)}
                  style={[styles.dronePickRow, { borderColor: theme.border }]}
                >
                  <DroneImage manufacturer={d.manufacturer} model={d.model} size={50} iconColor={theme.textSecondary} iconSize={30} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontSize: 14, fontWeight: "600", color: theme.text }} numberOfLines={1}>{d.name}</ThemedText>
                    {d.serialNumber ? (
                      <ThemedText style={{ fontSize: 11, color: theme.textTertiary }} numberOfLines={1}>SN {d.serialNumber}</ThemedText>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={18} color={theme.textTertiary} />
                </Pressable>
              ))}
              {drones.filter((d) => !d.archivedAt).length === 0 ? (
                <ThemedText style={{ fontSize: 13, color: theme.textSecondary, paddingVertical: 10 }}>
                  Noch keine Drohne angelegt. Lege unter Einstellungen → Drohnen eine an.
                </ThemedText>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  intro: {
    ...Typography.small,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  pickButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
  },
  pickButtonText: {
    ...Typography.body,
    fontWeight: "700",
    color: "#fff",
  },
  progress: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing.sm,
  },
  progressBlock: {
    marginTop: Spacing.md,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  folderBlock: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  folderRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
  },
  folderButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  folderButtonText: {
    ...Typography.small,
    fontWeight: "600",
    flexShrink: 1,
  },
  folderForget: {
    padding: Spacing.sm,
  },
  section: {
    marginTop: Spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  headerText: {
    ...Typography.body,
    fontWeight: "700",
  },
  assignAllButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#007AFF", paddingVertical: 14, borderRadius: 12, marginBottom: Spacing.md },
  assignAllText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 480, borderRadius: 16, padding: 16 },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalHint: { fontSize: 12, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  dronePickRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  detectedDrone: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderRadius: 10 },
  detectedText: { fontSize: 13, fontWeight: "600" },
  detectedSub: { fontSize: 11, marginTop: 1 },
  droneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: 4,
  },
  droneText: {
    ...Typography.small,
    fontWeight: "600",
  },
  meta: {
    ...Typography.caption,
    marginBottom: 2,
  },
  metaSub: {
    ...Typography.caption,
    marginBottom: 2,
  },
  preview: {
    marginTop: Spacing.sm,
  },
  logList: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  logInfo: {
    flex: 1,
  },
  logName: {
    ...Typography.small,
    fontWeight: "600",
  },
  logSummary: {
    ...Typography.caption,
  },
  choiceBlock: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  choiceLabel: {
    ...Typography.caption,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  choiceInfo: {
    flex: 1,
  },
  choiceText: {
    ...Typography.small,
    fontWeight: "600",
  },
  choiceMeta: {
    ...Typography.caption,
  },
  assignButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xs,
  },
  assignButtonText: {
    ...Typography.body,
    fontWeight: "700",
    color: "#fff",
  },
  assignedBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  assignedText: {
    ...Typography.body,
    fontWeight: "700",
  },
  errorTitle: {
    ...Typography.small,
    fontWeight: "700",
    marginBottom: Spacing.xs,
  },
  errorItem: {
    ...Typography.caption,
  },
  hint: {
    ...Typography.caption,
    textAlign: "center",
    marginTop: Spacing["2xl"],
  },
});
