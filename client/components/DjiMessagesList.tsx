import React from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import type { DjiLogMessage } from "@/lib/storage";

/** Liefert true, wenn App-/Fernsteuerungs-Meldungen vorhanden sind. */
export function hasMessages(messages?: DjiLogMessage[]): boolean {
  return !!messages && messages.length > 0;
}

function fmtTime(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function kindLabel(kind: DjiLogMessage["kind"]): string {
  if (kind === "tip") return "Hinweis";
  if (kind === "serious") return "Warnung";
  return "Warnung";
}

/**
 * Chronologische Liste der Meldungen, die der Pilot während des Fluges in der
 * DJI-App / auf der Fernsteuerung sah (Hinweise + Warnungen).
 */
export function DjiMessagesList({ messages }: { messages: DjiLogMessage[] }) {
  const { theme } = useTheme();

  const colorFor = (kind: DjiLogMessage["kind"]) => {
    if (kind === "tip") return theme.textSecondary;
    if (kind === "serious") return theme.statusNoGo;
    return theme.statusCaution;
  };
  const bgFor = (kind: DjiLogMessage["kind"]) => {
    if (kind === "tip") return theme.backgroundSecondary;
    if (kind === "serious") return theme.statusNoGoBackground;
    return theme.statusCautionBackground;
  };

  return (
    <View style={styles.list}>
      {messages.map((m, i) => {
        const time = fmtTime(m.t);
        return (
          <View
            key={`msg-${i}`}
            testID={`row-dji-message-${i}`}
            style={[styles.item, { borderColor: theme.border }]}
          >
            <View style={[styles.bar, { backgroundColor: colorFor(m.kind) }]} />
            <View style={styles.body}>
              <View style={styles.head}>
                <View style={[styles.badge, { backgroundColor: bgFor(m.kind) }]}>
                  <ThemedText style={[styles.badgeText, { color: colorFor(m.kind) }]}>
                    {kindLabel(m.kind)}
                  </ThemedText>
                </View>
                {time ? (
                  <ThemedText style={[styles.time, { color: theme.textTertiary }]}>
                    {time}
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText style={[styles.text, { color: theme.text }]}>{m.text}</ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.xs,
  },
  item: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
  },
  bar: {
    width: 4,
  },
  body: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    gap: 3,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  badgeText: {
    ...Typography.caption,
    fontWeight: "700",
  },
  time: {
    ...Typography.caption,
    fontVariant: ["tabular-nums"],
  },
  text: {
    ...Typography.small,
  },
});
