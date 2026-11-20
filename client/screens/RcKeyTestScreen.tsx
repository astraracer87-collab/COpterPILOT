/**
 * Einstellungen → Tasten der Fernsteuerung (Tasten-Test, Schritt 1).
 *
 * Zeigt jede Taste, jedes Rädchen und jede Richtung des 5D-Knopfs, die die
 * Fernsteuerung an die App meldet (client/lib/rcKeys.ts, natives Modul aus
 * plugins/withRcKeyEvents.js) – mit Rohwerten, Live-Balken je Achse der
 * Joystick-Geräte, Markierungen (nummerierte Trennzeilen) und Protokoll zum
 * Kopieren samt Geräteangaben. Während der Test läuft, ist der
 * Aufnahme-Modus an: Steuerkreuz/Enter/Bild-Tasten navigieren dann nicht.
 * Zurück bleibt normal; beim Verlassen des Bildschirms endet der Test.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import * as Clipboard from "expo-clipboard";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import {
  describeRcEvent,
  formatAxes,
  formatRcDeviceInfo,
  formatRcLogLine,
  listRcDjiPackages,
  exportRcApk,
  type RcPackageInfo,
  formatRcTime,
  getRcDeviceInfo,
  isRcKeysAvailable,
  rcAxisBar,
  rcAxisDevices,
  setRcCaptureMode,
  subscribeRcInput,
  updateRcAxisState,
  type RcAxisRange,
  type RcAxisState,
  type RcDeviceInfo,
  type RcInputEvent,
} from "@/lib/rcKeys";

export const RC_KEY_TEST_HINT =
  "Bitte jedes Bedienelement einzeln testen: zuerst „Markierung setzen“ tippen, dann genau ein Element betätigen " +
  "(Taste kurz und lang drücken, Rädchen in beide Richtungen drehen, 5D-Knopf in jede Richtung kippen und drücken). " +
  "Notiere zu jeder Nummer, was du betätigt hast, z. B. „1 = C1, 2 = Rad links, 3 = 5D oben …“. " +
  "Die Balken zeigen live, welche Achse sich bewegt. " +
  "Die Kamera-, Rückkehr- und Ein/Aus-Tasten gehören zu DJI Fly bzw. dem System und melden sich hier eventuell nicht.";

export const RC_LOG_MAX = 300;

type LogEntry = { id: number; kind: "event"; event: RcInputEvent } | { id: number; kind: "marker"; n: number };

export function markerLine(n: number): string {
  return `----- Markierung ${n} -----`;
}

const ACTION_DE: Record<string, string> = { down: "gedrückt", up: "losgelassen", multiple: "mehrfach" };

export default function RcKeyTestScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;
  const available = isRcKeysAvailable();

  const [active, setActive] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [axisState, setAxisState] = useState<RcAxisState>({});
  const [deviceInfo, setDeviceInfo] = useState<RcDeviceInfo | null>(null);
  const nextId = useRef(1);
  // Fokus-Test: bewegt die Fernsteuerung den Fokus (Bedienungshilfe) statt Tasten zu senden?
  const [focusLog, setFocusLog] = useState<string[]>([]);
  const [focusedBox, setFocusedBox] = useState<string | null>(null);
  // Diagnose: DJI-Systemteile auflisten und App-Datei exportieren (zur Analyse)
  const [djiPkgs, setDjiPkgs] = useState<RcPackageInfo[] | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const loadDjiPkgs = useCallback(() => {
    void listRcDjiPackages().then(setDjiPkgs);
  }, []);
  const doExport = useCallback(async (pkg: string) => {
    setExporting(pkg);
    try {
      const path = await exportRcApk(pkg);
      Alert.alert("Exportiert", `Gespeichert unter ${path}. Bitte per USB auf den PC kopieren und in Google Drive hochladen.`);
    } catch (e) {
      Alert.alert("Export nicht möglich", String((e as Error)?.message ?? e));
    } finally {
      setExporting(null);
    }
  }, []);
  const noteFocus = useCallback((text: string) => {
    const t = new Date().toLocaleTimeString("de-DE");
    setFocusLog((prev) => [`${t} ${text}`, ...prev].slice(0, 60));
  }, []);
  const markerCount = useRef(0);

  const loadDeviceInfo = useCallback(() => {
    let alive = true;
    void getRcDeviceInfo().then((info) => {
      if (alive) setDeviceInfo(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => loadDeviceInfo(), [loadDeviceInfo]);

  // Test läuft: Ereignisse sammeln und Aufnahme-Modus an; aus beim Verlassen.
  useEffect(() => {
    if (!active) return;
    setAxisState({});
    setRcCaptureMode(true);
    let cancelInfo: (() => void) | null = null;
    const unsubscribe = subscribeRcInput((event) => {
      const id = nextId.current++;
      setLog((prev) => [{ id, kind: "event" as const, event }, ...prev].slice(0, RC_LOG_MAX));
      if (event.type === "motion") setAxisState((s) => updateRcAxisState(s, event));
      if (event.type === "device") {
        cancelInfo?.();
        cancelInfo = loadDeviceInfo();
      }
    });
    return () => {
      unsubscribe();
      cancelInfo?.();
      setRcCaptureMode(false);
    };
  }, [active, loadDeviceInfo]);

  // Anderer Tab/Bildschirm: Test beenden (sonst blieben Steuerkreuz-Tasten abgefangen).
  useFocusEffect(
    useCallback(() => {
      return () => setActive(false);
    }, []),
  );

  const addMarker = useCallback(() => {
    markerCount.current += 1;
    const n = markerCount.current;
    const id = nextId.current++;
    setLog((prev) => [{ id, kind: "marker" as const, n }, ...prev].slice(0, RC_LOG_MAX));
  }, []);

  const clearLog = useCallback(() => {
    setLog([]);
    setAxisState({});
    markerCount.current = 0;
  }, []);

  const lastEntry = log.find((e) => e.kind === "event");
  const last = lastEntry && lastEntry.kind === "event" ? lastEntry.event : null;

  const copyLog = useCallback(async () => {
    const text = [
      "COpter Pilot – Tasten-Test",
      formatRcDeviceInfo(deviceInfo),
      "",
      `Ereignisse (älteste zuerst, max. ${RC_LOG_MAX}):`,
      ...[...log].reverse().map((e) => (e.kind === "marker" ? markerLine(e.n) : formatRcLogLine(e.event))),
      "",
      "Fokus-Test (älteste zuerst):",
      ...(focusLog.length ? [...focusLog].reverse() : ["(keine Fokus-Ereignisse)"]),
    ].join("\n");
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert("Kopiert", "Das Protokoll liegt in der Zwischenablage.");
    } catch {
      Alert.alert("Fehler", "Das Protokoll konnte nicht kopiert werden.");
    }
  }, [deviceInfo, log, focusLog]);

  // Achsen-Panel: Joystick-/Gamepad-Geräte aus den Geräteangaben plus jedes Gerät, das Bewegungen meldet.
  const panelDevices = useMemo(() => {
    const list: { id: number; name: string; ranges: RcAxisRange[]; axes: string[] }[] = rcAxisDevices(deviceInfo).map((d) => ({
      id: d.id,
      name: d.name,
      ranges: d.ranges ?? [],
      axes: d.axes.map((a) => a.replace(/^AXIS_/, "")),
    }));
    for (const idStr of Object.keys(axisState)) {
      const id = Number(idStr);
      const dev = list.find((d) => d.id === id);
      const seen = Object.keys(axisState[id] ?? {});
      if (dev) {
        for (const a of seen) if (!dev.axes.includes(a)) dev.axes.push(a);
      } else {
        const info = deviceInfo?.inputDevices.find((d) => d.id === id);
        const lastName = log.find((e) => e.kind === "event" && e.event.type === "motion" && e.event.deviceId === id);
        list.push({
          id,
          name: info?.name ?? (lastName && lastName.kind === "event" ? lastName.event.deviceName : `#${id}`),
          ranges: info?.ranges ?? [],
          axes: seen,
        });
      }
    }
    return list;
  }, [deviceInfo, axisState, log]);

  const lastText = last
    ? describeRcEvent(last)
    : active
      ? "Jetzt ein Bedienelement betätigen …"
      : "Test nicht gestartet";

  const lastDetail = !last
    ? null
    : last.type === "key"
      ? `Scan-Code ${last.scanCode} · Gerät „${last.deviceName}“ (#${last.deviceId}) · Quelle ${last.sourceNames.join("/") || last.source}${last.consumed ? " · abgefangen" : ""}${last.via ? ` · über ${last.via}` : ""}`
      : last.type === "motion"
        ? `Gerät „${last.deviceName}“ (#${last.deviceId}) · Quelle ${last.sourceNames.join("/") || last.source}${last.via ? ` · über ${last.via}` : ""}`
        : `Quelle ${last.sourceNames.join("/") || last.sources}`;

  const axisPanel = (
    <Card style={styles.infoCard} testID="rc-axis-panel">
      <ThemedText style={styles.sectionTitle}>Achsen live</ThemedText>
      {panelDevices.length === 0 ? (
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
          Kein Joystick-Gerät gefunden – Bewegungen anderer Geräte erscheinen hier, sobald sie gemeldet werden.
        </ThemedText>
      ) : (
        panelDevices.map((dev) => (
          <View key={dev.id} style={styles.axisDevice}>
            <ThemedText style={[styles.small, { fontWeight: "600" }]}>
              {dev.name} (#{dev.id})
            </ThemedText>
            {dev.axes.map((axis) => {
              const live = axisState[dev.id]?.[axis];
              const range = dev.ranges.find((r) => r.axis === axis);
              const value = live?.value ?? 0;
              const bar = rcAxisBar(value, range);
              const seen = live ? rcAxisBar(live.seenMin, range) : null;
              const seenHi = live ? rcAxisBar(live.seenMax, range) : null;
              const moved = !!live && (live.seenMin !== 0 || live.seenMax !== 0);
              return (
                <View key={axis} style={styles.axisRow} testID={`rc-axis-${dev.id}-${axis}`}>
                  <ThemedText style={[styles.mono, styles.axisName, moved && { color: theme.primary, fontWeight: "700" }]}>
                    {axis}
                  </ThemedText>
                  <View style={[styles.axisTrack, { backgroundColor: theme.backgroundTertiary }]}>
                    {seen && seenHi ? (
                      <View
                        style={[
                          styles.axisFill,
                          {
                            left: `${Math.min(seen.start, seenHi.start) * 100}%`,
                            width: `${(Math.max(seen.end, seenHi.end) - Math.min(seen.start, seenHi.start)) * 100}%`,
                            backgroundColor: theme.statusCautionBackground,
                          },
                        ]}
                      />
                    ) : null}
                    <View
                      style={[
                        styles.axisFill,
                        {
                          left: `${bar.start * 100}%`,
                          width: `${Math.max(0.01, bar.end - bar.start) * 100}%`,
                          backgroundColor: value !== 0 ? theme.primary : theme.textTertiary,
                        },
                      ]}
                    />
                    <View style={[styles.axisZero, { left: `${bar.zero * 100}%`, backgroundColor: theme.textSecondary }]} />
                  </View>
                  <ThemedText style={[styles.mono, styles.axisValue]}>
                    {value.toFixed(2)}
                    {moved && live ? ` (${live.seenMin.toFixed(2)}…${live.seenMax.toFixed(2)})` : ""}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        ))
      )}
    </Card>
  );

  const controls = (
    <>
      <ThemedText style={[styles.hint, { color: theme.textSecondary }]} testID="rc-key-hint">
        {RC_KEY_TEST_HINT}
      </ThemedText>
      {!available ? (
        <ThemedText style={[styles.hint, { color: theme.statusCaution }]} testID="rc-key-unavailable">
          Tasten-Erfassung ist hier nicht verfügbar (nur in der Android-App auf der Fernsteuerung).
        </ThemedText>
      ) : null}
      <View style={styles.buttonRow}>
        <Button
          title={active ? "Tasten-Test beenden" : "Tasten-Test starten"}
          onPress={() => setActive((a) => !a)}
          disabled={!available}
          style={styles.flexButton}
          testID="rc-key-toggle"
        />
        <Button
          title={`Markierung setzen (${markerCount.current + 1})`}
          variant="secondary"
          onPress={addMarker}
          style={styles.flexButton}
          testID="rc-key-marker"
        />
      </View>
      {active ? (
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
          Aufnahme läuft: Steuerkreuz, Enter, Bild-Tasten und Joystick bedienen die App gerade nicht. „Zurück“ funktioniert normal.
        </ThemedText>
      ) : null}
      <Card style={styles.lastCard}>
        <ThemedText style={styles.lastLabel}>Zuletzt erkannt</ThemedText>
        <ThemedText style={styles.lastText} testID="rc-key-last">
          {lastText}
        </ThemedText>
        {lastDetail ? <ThemedText style={[styles.small, { color: theme.textSecondary }]}>{lastDetail}</ThemedText> : null}
      </Card>
      {active || Object.keys(axisState).length > 0 ? axisPanel : null}
      <View style={styles.buttonRow}>
        <Button
          title="Protokoll kopieren"
          variant="secondary"
          onPress={() => void copyLog()}
          style={styles.flexButton}
          testID="rc-key-copy"
        />
        <Button title="Protokoll leeren" variant="secondary" onPress={clearLog} style={styles.flexButton} testID="rc-key-clear" />
      </View>
      <Card style={styles.infoCard}>
        <ThemedText style={styles.sectionTitle}>Fokus-Test</ThemedText>
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
          Sticks bewegen, ohne den Bildschirm zu berühren: Springt der Rahmen zwischen den Feldern, steuert die
          Fernsteuerung über den Fokus (wie in den Android-Einstellungen).
        </ThemedText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.sm }}>
          {["Feld A", "Feld B", "Feld C", "Feld D"].map((name) => (
            <Pressable
              key={name}
              testID={`rc-focus-${name}`}
              focusable
              accessible
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityActions={[{ name: "activate" }, { name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e: { nativeEvent: { actionName: string } }) => noteFocus(`${name}: Bedienungshilfe-Aktion „${e.nativeEvent.actionName}“`)}
              onFocus={() => {
                setFocusedBox(name);
                noteFocus(`${name}: Fokus erhalten`);
              }}
              onBlur={() => {
                setFocusedBox((f) => (f === name ? null : f));
                noteFocus(`${name}: Fokus verloren`);
              }}
              onPress={() => noteFocus(`${name}: ausgelöst (Klick/Enter)`)}
              style={[
                styles.focusBox,
                {
                  borderColor: focusedBox === name ? theme.primary : theme.border,
                  backgroundColor: focusedBox === name ? theme.primary + "22" : theme.backgroundSecondary,
                },
              ]}
            >
              <ThemedText style={{ fontWeight: "700" }}>{name}</ThemedText>
            </Pressable>
          ))}
        </View>
        {focusLog.slice(0, 6).map((l, i) => (
          <ThemedText key={i} style={[styles.mono, { color: theme.textSecondary }]}>
            {l}
          </ThemedText>
        ))}
      </Card>
      <Card style={styles.infoCard}>
        <ThemedText style={styles.sectionTitle}>DJI-Systemteile (Analyse)</ThemedText>
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
          Listet die DJI-Apps und alle Systemteile außerhalb des Standard-Androids. „Exportieren“ kopiert die App-Datei nach Download/CopterPilot –
          damit lässt sich herausfinden, wie DJI die Sticks an andere Apps weitergibt.
        </ThemedText>
        {djiPkgs == null ? (
          <Button title="DJI-Systemteile auflisten" variant="secondary" onPress={loadDjiPkgs} testID="rc-dji-list" />
        ) : djiPkgs.length === 0 ? (
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Keine gefunden (oder in dieser App-Version nicht verfügbar).</ThemedText>
        ) : (
          djiPkgs.map((p) => (
            <View key={p.packageName} style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: "700" }} numberOfLines={1}>{p.label}</ThemedText>
                <ThemedText style={[styles.mono, { color: theme.textSecondary }]} numberOfLines={1}>
                  {p.packageName} · {p.system ? "System" : "installiert"} · {(p.size / 1048576).toFixed(1)} MB{p.splits ? ` · +${p.splits} Teile` : ""}
                </ThemedText>
              </View>
              <Button
                title={exporting === p.packageName ? "…" : "Exportieren"}
                variant="secondary"
                disabled={exporting != null}
                onPress={() => void doExport(p.packageName)}
                testID={`rc-dji-export-${p.packageName}`}
              />
            </View>
          ))
        )}
      </Card>
      <Card style={styles.infoCard}>
        <ThemedText style={styles.sectionTitle}>Gerät</ThemedText>
        {deviceInfo ? (
          <>
            <ThemedText style={styles.small} testID="rc-key-model">
              {deviceInfo.manufacturer} {deviceInfo.model} · product {deviceInfo.product} · device {deviceInfo.device} ·
              Android {deviceInfo.release} (SDK {deviceInfo.sdkInt})
            </ThemedText>
            <ThemedText style={[styles.sectionTitle, { marginTop: Spacing.sm }]}>Eingabegeräte</ThemedText>
            {deviceInfo.inputDevices.map((d) => (
              <ThemedText key={d.id} style={[styles.mono, { color: theme.textSecondary }]}>
                #{d.id} {d.name} · {d.sourceNames.join("/") || d.sources} · Tastatur {d.keyboardType}
                {d.vendorId || d.productId
                  ? ` · ${d.vendorId.toString(16).padStart(4, "0")}:${d.productId.toString(16).padStart(4, "0")}`
                  : ""}
                {d.isVirtual ? " · virtuell" : ""}
                {d.axes.length ? ` · Achsen ${d.axes.map((a) => a.replace(/^AXIS_/, "")).join(",")}` : ""}
              </ThemedText>
            ))}
            {deviceInfo.devInput !== undefined ? (
              <ThemedText style={[styles.mono, { color: theme.textSecondary, marginTop: Spacing.xs }]}>
                Direktzugriff /dev/input:{" "}
                {deviceInfo.devInput === null
                  ? "nicht lesbar"
                  : deviceInfo.devInput.some((n) => n.readable)
                    ? "teilweise lesbar"
                    : "nicht lesbar"}
                {" · "}/proc/bus/input/devices: {deviceInfo.procInputDevices ? "lesbar (im Protokoll)" : "nicht lesbar"}
              </ThemedText>
            ) : null}
          </>
        ) : (
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Keine Geräteangaben verfügbar.</ThemedText>
        )}
      </Card>
    </>
  );

  const eventCount = log.filter((e) => e.kind === "event").length;

  const logView = (
    <Card style={styles.logCard}>
      <ThemedText style={styles.sectionTitle}>
        Protokoll ({eventCount} Ereignisse, max. {RC_LOG_MAX} Zeilen)
      </ThemedText>
      {log.length === 0 ? (
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Noch keine Ereignisse.</ThemedText>
      ) : (
        log.map((entry) => {
          if (entry.kind === "marker") {
            return (
              <View key={entry.id} style={[styles.markerRow, { borderColor: theme.primary }]} testID="rc-key-marker-row">
                <ThemedText style={[styles.mono, { color: theme.primary, fontWeight: "700" }]}>{markerLine(entry.n)}</ThemedText>
              </View>
            );
          }
          const event = entry.event;
          return (
            <View key={entry.id} style={[styles.logRow, { borderBottomColor: theme.border }]}>
              <ThemedText style={[styles.mono, { color: theme.textSecondary }]}>{formatRcTime(event.timestamp)}</ThemedText>
              {event.type === "key" ? (
                <ThemedText style={styles.mono}>
                  Taste {event.keyName} ({event.keyCode}) · {ACTION_DE[event.action] ?? event.action}
                  {event.repeatCount ? ` · Wdh. ${event.repeatCount}` : ""} · scan {event.scanCode} · {event.deviceName}
                  {event.consumed ? " · abgefangen" : ""}
                </ThemedText>
              ) : event.type === "motion" ? (
                <ThemedText style={styles.mono}>
                  Bewegung {formatAxes(event.axes)} · {event.action.replace(/^ACTION_/, "")} ·{" "}
                  {event.sourceNames.join("/") || event.source} · {event.deviceName}
                </ThemedText>
              ) : (
                <ThemedText style={styles.mono}>{describeRcEvent(event)}</ThemedText>
              )}
            </View>
          );
        })
      )}
    </Card>
  );

  const padTop = headerHeight + Spacing.md;
  const padBottom = tabBarHeight + Spacing.xl;

  return (
    <ThemedView style={styles.container}>
      {landscape ? (
        <View style={[styles.row, { paddingTop: padTop }]}>
          <ScrollView style={styles.column} contentContainerStyle={{ paddingBottom: padBottom, gap: Spacing.md }}>
            {controls}
          </ScrollView>
          <ScrollView style={styles.column} contentContainerStyle={{ paddingBottom: padBottom }}>
            {logView}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: Spacing.lg, gap: Spacing.md }}
        >
          {controls}
          {logView}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  focusBox: { minWidth: 110, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, borderWidth: 3, alignItems: "center" },
  container: { flex: 1 },
  row: { flex: 1, flexDirection: "row", paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  column: { flex: 1 },
  hint: { fontSize: 14, lineHeight: 20 },
  small: { fontSize: 13, lineHeight: 18 },
  mono: { fontSize: 12, lineHeight: 17, fontFamily: "monospace" },
  lastCard: { padding: Spacing.lg, borderRadius: BorderRadius.md },
  lastLabel: { fontSize: 12, fontWeight: "600", opacity: 0.7, marginBottom: Spacing.xs },
  lastText: { fontSize: 24, lineHeight: 32, fontWeight: "700", marginBottom: Spacing.xs },
  buttonRow: { flexDirection: "row", gap: Spacing.md },
  flexButton: { flex: 1 },
  infoCard: { padding: Spacing.lg },
  logCard: { padding: Spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: "600", marginBottom: Spacing.xs },
  logRow: { paddingVertical: Spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  markerRow: { paddingVertical: Spacing.xs, marginVertical: Spacing.xs, borderTopWidth: 1, borderBottomWidth: 1 },
  axisDevice: { marginTop: Spacing.xs, gap: 2 },
  axisRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  axisName: { width: 84 },
  axisTrack: { flex: 1, height: 12, borderRadius: 6, overflow: "hidden", position: "relative" },
  axisFill: { position: "absolute", top: 0, bottom: 0 },
  axisZero: { position: "absolute", top: 0, bottom: 0, width: 1 },
  axisValue: { width: 150, textAlign: "right" },
});
