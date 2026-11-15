/**
 * Einstellungen → Tasten der Fernsteuerung (Tasten-Test, Schritt 1).
 *
 * Zeigt jede Taste, jedes Rädchen und jede Richtung des 5D-Knopfs, die die
 * Fernsteuerung an die App meldet (client/lib/rcKeys.ts, natives Modul aus
 * plugins/withRcKeyEvents.js) – mit Rohwerten, Protokoll zum Kopieren und
 * Geräteangaben. Während der Test läuft, ist der Aufnahme-Modus an:
 * Steuerkreuz/Enter/Bild-Tasten navigieren dann nicht. Zurück bleibt normal.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
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
  formatRcTime,
  getRcDeviceInfo,
  isRcKeysAvailable,
  setRcCaptureMode,
  subscribeRcInput,
  type RcDeviceInfo,
  type RcInputEvent,
} from "@/lib/rcKeys";

export const RC_KEY_TEST_HINT =
  "Drücke nacheinander jede Taste und jedes Rädchen der Fernsteuerung und kippe den 5D-Knopf in alle Richtungen. " +
  "Die Kamera-, Rückkehr- und Ein/Aus-Tasten gehören zu DJI Fly bzw. dem System und melden sich hier eventuell nicht.";

const MAX_LOG = 100;

interface LogEntry {
  id: number;
  event: RcInputEvent;
}

export default function RcKeyTestScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const { width, height } = useWindowDimensions();
  const landscape = width >= height;
  const available = isRcKeysAvailable();

  const [active, setActive] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<RcDeviceInfo | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    let alive = true;
    void getRcDeviceInfo().then((info) => {
      if (alive) setDeviceInfo(info);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Test läuft: Ereignisse sammeln und Aufnahme-Modus an; aus beim Verlassen.
  useEffect(() => {
    if (!active) return;
    setRcCaptureMode(true);
    const unsubscribe = subscribeRcInput((event) => {
      const id = nextId.current++;
      setLog((prev) => [{ id, event }, ...prev].slice(0, MAX_LOG));
    });
    return () => {
      unsubscribe();
      setRcCaptureMode(false);
    };
  }, [active]);

  // Anderer Tab/Bildschirm: Test beenden (sonst blieben Steuerkreuz-Tasten abgefangen).
  useFocusEffect(
    useCallback(() => {
      return () => setActive(false);
    }, []),
  );

  const last = log[0]?.event ?? null;

  const copyLog = useCallback(async () => {
    const text = [
      "COpter Pilot – Tasten-Test",
      formatRcDeviceInfo(deviceInfo),
      "",
      `Ereignisse (neueste zuerst, max. ${MAX_LOG}):`,
      ...log.map((e) => formatRcLogLine(e.event)),
    ].join("\n");
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert("Kopiert", "Das Protokoll liegt in der Zwischenablage.");
    } catch {
      Alert.alert("Fehler", "Das Protokoll konnte nicht kopiert werden.");
    }
  }, [deviceInfo, log]);

  const lastText = last
    ? describeRcEvent(last)
    : active
      ? "Jetzt eine Taste drücken …"
      : "Test nicht gestartet";

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
      <Button
        title={active ? "Tasten-Test beenden" : "Tasten-Test starten"}
        onPress={() => setActive((a) => !a)}
        disabled={!available}
        testID="rc-key-toggle"
      />
      {active ? (
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
          Aufnahme läuft: Steuerkreuz, Enter und Bild-Tasten bedienen die App gerade nicht. „Zurück“ funktioniert normal.
        </ThemedText>
      ) : null}
      <Card style={styles.lastCard}>
        <ThemedText style={styles.lastLabel}>Zuletzt erkannt</ThemedText>
        <ThemedText style={styles.lastText} testID="rc-key-last">
          {lastText}
        </ThemedText>
        {last ? (
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>
            {last.type === "key"
              ? `Scan-Code ${last.scanCode} · Gerät „${last.deviceName}“ (#${last.deviceId}) · Quelle ${last.sourceNames.join("/") || last.source}${last.consumed ? " · abgefangen" : ""}`
              : `Gerät „${last.deviceName}“ (#${last.deviceId}) · Quelle ${last.sourceNames.join("/") || last.source}`}
          </ThemedText>
        ) : null}
      </Card>
      <View style={styles.buttonRow}>
        <Button
          title="Protokoll kopieren"
          variant="secondary"
          onPress={() => void copyLog()}
          style={styles.flexButton}
          testID="rc-key-copy"
        />
        <Button
          title="Protokoll leeren"
          variant="secondary"
          onPress={() => setLog([])}
          style={styles.flexButton}
          testID="rc-key-clear"
        />
      </View>
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
          </>
        ) : (
          <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Keine Geräteangaben verfügbar.</ThemedText>
        )}
      </Card>
    </>
  );

  const logView = (
    <Card style={styles.logCard}>
      <ThemedText style={styles.sectionTitle}>
        Protokoll ({log.length}/{MAX_LOG})
      </ThemedText>
      {log.length === 0 ? (
        <ThemedText style={[styles.small, { color: theme.textSecondary }]}>Noch keine Ereignisse.</ThemedText>
      ) : (
        log.map(({ id, event }) => (
          <View key={id} style={[styles.logRow, { borderBottomColor: theme.border }]} testID="rc-key-log-row">
            <ThemedText style={[styles.mono, { color: theme.textSecondary }]}>{formatRcTime(event.timestamp)}</ThemedText>
            {event.type === "key" ? (
              <ThemedText style={styles.mono}>
                Taste {event.keyName} ({event.keyCode}) · {event.action === "down" ? "gedrückt" : event.action === "up" ? "losgelassen" : event.action}
                {event.repeatCount ? ` · Wdh. ${event.repeatCount}` : ""} · scan {event.scanCode} · {event.deviceName}
                {event.consumed ? " · abgefangen" : ""}
              </ThemedText>
            ) : (
              <ThemedText style={styles.mono}>
                Bewegung {formatAxes(event.axes)} · {event.action.replace(/^ACTION_/, "")} · {event.sourceNames.join("/") || event.source} ·{" "}
                {event.deviceName}
              </ThemedText>
            )}
          </View>
        ))
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
        <ScrollView contentContainerStyle={{ paddingTop: padTop, paddingBottom: padBottom, paddingHorizontal: Spacing.lg, gap: Spacing.md }}>
          {controls}
          {logView}
        </ScrollView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
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
});
