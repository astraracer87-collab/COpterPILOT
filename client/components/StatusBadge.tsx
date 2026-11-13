import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography } from "@/constants/theme";

interface StatusBadgeProps {
  status: "go" | "caution" | "nogo";
  size?: "small" | "medium" | "large";
}

export default function StatusBadge({ status, size = "medium" }: StatusBadgeProps) {
  const { theme } = useTheme();

  const getConfig = () => {
    switch (status) {
      case "go":
        return {
          label: "GO",
          color: theme.statusGo,
          background: theme.statusGoBackground,
        };
      case "caution":
        return {
          label: "CAUTION",
          color: theme.statusCaution,
          background: theme.statusCautionBackground,
        };
      case "nogo":
        return {
          label: "NO-GO",
          color: theme.statusNoGo,
          background: theme.statusNoGoBackground,
        };
    }
  };

  const config = getConfig();

  const getSizeStyle = () => {
    switch (size) {
      case "small":
        return {
          paddingHorizontal: Spacing.sm,
          paddingVertical: Spacing.xs,
          fontSize: 11,
        };
      case "large":
        return {
          paddingHorizontal: Spacing.lg,
          paddingVertical: Spacing.sm,
          fontSize: 16,
        };
      default:
        return {
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.xs,
          fontSize: 12,
        };
    }
  };

  const sizeStyle = getSizeStyle();

  const iconSize = size === "small" ? 10 : size === "large" ? 14 : 12;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: config.background,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          paddingVertical: sizeStyle.paddingVertical,
        },
      ]}
    >
      {status === "caution" ? (
        <Feather name="alert-triangle" size={iconSize} color={config.color} style={styles.icon} />
      ) : null}
      <ThemedText
        style={[
          styles.text,
          { color: config.color, fontSize: sizeStyle.fontSize },
        ]}
      >
        {config.label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    marginRight: 4,
  },
  text: {
    fontWeight: "700",
    letterSpacing: 0.5,
  },
});
