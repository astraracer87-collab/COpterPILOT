import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import Checkbox from "@/components/Checkbox";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";

export interface ChecklistRowProps {
  id: string;
  label: string;
  required: boolean;
  tip: string;
  checked: boolean;
  /** Muss stabil sein (z. B. `toggle` aus useChecklistState). */
  onToggle: (id: string) => void;
  /** Muss stabil sein (useCallback). */
  onShowTip: (title: string, tip: string) => void;
  /** Trennlinie unter der Zeile. */
  showDivider: boolean;
  /**
   * "badge": „Pflicht“-Badge + Hilfe-Kreis (Pre-Check, Planung, Debriefing).
   * "asterisk": rotes * hinter dem Text + Info-Symbol (Flight-Check).
   */
  variant?: "badge" | "asterisk";
}

/**
 * Eine Checklisten-Zeile. Memoisiert: Beim Abhaken rendert nur die geänderte
 * Zeile neu, nicht die ganze Liste. Die Checkbox ist rein visuell
 * (pointerEvents="none"); die ganze Zeile ist EIN Touch-Ziel, damit kein
 * zweiter, verschachtelter Responder um den Tap konkurriert.
 */
function ChecklistRowImpl({
  id,
  label,
  required,
  tip,
  checked,
  onToggle,
  onShowTip,
  showDivider,
  variant = "badge",
}: ChecklistRowProps) {
  const { theme } = useTheme();
  const handleToggle = React.useCallback(() => onToggle(id), [onToggle, id]);
  const handleTip = React.useCallback(() => onShowTip(label, tip), [onShowTip, label, tip]);

  return (
    <View
      style={[
        styles.checkItem,
        variant === "asterisk" && styles.checkItemCompact,
        showDivider && {
          borderBottomWidth: variant === "asterisk" ? StyleSheet.hairlineWidth : 1,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <Pressable
        onPress={handleToggle}
        style={styles.checkRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        testID={`checklist-row-${id}`}
      >
        <View pointerEvents="none">
          <Checkbox checked={checked} onPress={handleToggle} />
        </View>
        {variant === "asterisk" ? (
          <View style={styles.labelWrap}>
            <ThemedText style={styles.asteriskLabel}>
              {label}
              {required ? <ThemedText style={{ color: theme.statusNoGo }}> *</ThemedText> : null}
            </ThemedText>
          </View>
        ) : (
          <ThemedText style={styles.checkLabel}>{label}</ThemedText>
        )}
      </Pressable>
      {variant === "asterisk" ? (
        <Pressable style={styles.plainTipButton} onPress={handleTip} hitSlop={8}>
          <Feather name="info" size={18} color={theme.textTertiary} />
        </Pressable>
      ) : (
        <View style={styles.itemActions}>
          {required ? (
            <View style={[styles.requiredBadge, { backgroundColor: theme.statusCautionBackground }]}>
              <ThemedText style={[styles.requiredText, { color: theme.statusCaution }]}>Pflicht</ThemedText>
            </View>
          ) : null}
          <Pressable
            onPress={handleTip}
            style={({ pressed }) => [
              styles.tipButton,
              { backgroundColor: theme.backgroundSecondary },
              pressed && { opacity: 0.7 },
            ]}
            hitSlop={8}
          >
            <Feather name="help-circle" size={18} color={theme.primary} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

export const ChecklistRow = React.memo(ChecklistRowImpl);

const styles = StyleSheet.create({
  checkItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  checkItemCompact: {
    justifyContent: "flex-start",
    paddingHorizontal: Spacing.md,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
  },
  checkLabel: {
    ...Typography.body,
    flex: 1,
  },
  labelWrap: {
    flex: 1,
  },
  asteriskLabel: {
    ...Typography.body,
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  requiredBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 4,
  },
  requiredText: {
    ...Typography.caption,
    fontWeight: "600",
  },
  tipButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  plainTipButton: {
    padding: Spacing.xs,
  },
});
