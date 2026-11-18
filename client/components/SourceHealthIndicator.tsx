import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/noHaptics";
import {
  ALL_SOURCES,
  DegradedSource,
  formatLastOkRelative,
  getCachedTrafficStatus,
  getDegradedSources,
  getStatusLabel,
  SOURCE_LABELS,
  subscribeTrafficStatus,
  TrafficStatus,
} from "@/lib/trafficStatus";
import type { DataSource, SourceStatus } from "@/lib/opensky";
import { useShowDataSources } from "@/lib/dataSource";

const DEGRADED_THRESHOLD_MS = 5 * 60 * 1000;

interface Props {
  isDark: boolean;
  testID?: string;
}

export default function SourceHealthIndicator({ isDark, testID }: Props) {
  const isAdmin = useShowDataSources();
  const [status, setStatus] = useState<TrafficStatus | null>(() => getCachedTrafficStatus());
  const [showModal, setShowModal] = useState(false);

  // Subscribe to the shared traffic-status poller (liest lokal aus dem
  // clientseitigen Aggregator). There is exactly one cadence in the app, regardless of how many
  // indicators are mounted (first subscriber starts it, last stops it).
  useEffect(() => {
    const unsub = subscribeTrafficStatus((s) => setStatus(s));
    return unsub;
  }, []);

  const degraded: DegradedSource[] = useMemo(
    () => (status ? getDegradedSources(status, DEGRADED_THRESHOLD_MS) : []),
    [status],
  );

  const handlePress = useCallback(() => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    setShowModal(true);
  }, []);

  const okCount = useMemo(() => {
    if (!status) return 0;
    return ALL_SOURCES.reduce((acc, src) => {
      const st: SourceStatus = status.sourceStatus?.[src] ?? "error";
      return acc + (st === "ok" ? 1 : 0);
    }, 0);
  }, [status]);

  if (!isAdmin) return null;
  if (!status || degraded.length === 0) return null;
  if (okCount > 0) return null;

  const pillBg = isDark ? "rgba(60, 30, 10, 0.92)" : "rgba(255, 240, 220, 0.96)";
  const pillBorder = "rgba(255, 149, 0, 0.55)";
  const pillText = isDark ? "#FFB454" : "#B86F00";
  const label = degraded.length === 1
    ? `${SOURCE_LABELS[degraded[0].source]} gestört`
    : `${degraded.length} Quellen gestört`;

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={[styles.pill, { backgroundColor: pillBg, borderColor: pillBorder }]}
        hitSlop={6}
        testID={testID || "source-health-pill"}
      >
        <Feather name="alert-triangle" size={12} color={pillText} />
        <Text style={[styles.pillText, { color: pillText }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>

      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowModal(false)}
        >
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, {
              backgroundColor: isDark ? "rgba(15, 22, 45, 0.98)" : "rgba(255,255,255,0.99)",
            }]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <Feather name="activity" size={18} color={pillText} />
                <Text style={[styles.modalTitle, { color: isDark ? "#fff" : "#1A1A2E" }]}>
                  Verkehrsquellen
                </Text>
              </View>
              <Pressable onPress={() => setShowModal(false)} hitSlop={8} testID="source-health-close">
                <Feather name="x" size={20} color={isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)"} />
              </Pressable>
            </View>

            <Text style={[styles.modalIntro, { color: isDark ? "rgba(220,225,240,0.75)" : "rgba(40,40,60,0.75)" }]}>
              {degraded.length === 1
                ? "Eine Datenquelle liefert seit einigen Minuten keine Updates. Es kann sein, dass weniger Verkehr angezeigt wird."
                : "Mehrere Datenquellen liefern seit einigen Minuten keine Updates. Es kann sein, dass weniger Verkehr angezeigt wird."}
            </Text>

            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {ALL_SOURCES.map((src) => {
                const st: SourceStatus = status.sourceStatus?.[src] ?? "error";
                const lastOk = status.sourceLastOk?.[src] ?? 0;
                const isDegraded = degraded.some((d) => d.source === src);
                const dotColor = st === "ok"
                  ? "#34C759"
                  : st === "timeout" ? "#FF9500" : "#FF3B30";
                return (
                  <View
                    key={src}
                    style={[styles.row, {
                      borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                    }]}
                    testID={`source-health-row-${src}`}
                  >
                    <View style={[styles.dot, { backgroundColor: dotColor }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, {
                        color: isDark ? "#fff" : "#1A1A2E",
                        fontWeight: isDegraded ? "700" : "500",
                      }]}>
                        {SOURCE_LABELS[src as DataSource]}
                      </Text>
                      <Text style={[styles.rowMeta, { color: isDark ? "rgba(220,225,240,0.55)" : "rgba(40,40,60,0.55)" }]}>
                        Letzte Daten: {formatLastOkRelative(lastOk)}
                      </Text>
                    </View>
                    <Text style={[styles.rowStatus, { color: dotColor }]}>{getStatusLabel(st)}</Text>
                  </View>
                );
              })}
            </ScrollView>

            <Text style={[styles.modalFooter, { color: isDark ? "rgba(220,225,240,0.45)" : "rgba(40,40,60,0.5)" }]}>
              Aktualisiert alle 60 s
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 240,
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 3 },
      android: { elevation: 3 },
    }),
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    padding: 18,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  modalIntro: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowLabel: {
    fontSize: 14,
  },
  rowMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  rowStatus: {
    fontSize: 11,
    fontWeight: "700",
  },
  modalFooter: {
    fontSize: 10,
    textAlign: "center",
    marginTop: 10,
  },
});
