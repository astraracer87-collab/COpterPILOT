import React from "react";
import { StyleSheet, Pressable, ViewStyle, StyleProp, ActivityIndicator, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Colors } from "@/constants/theme";

interface ButtonProps {
  title: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary";
  testID?: string;
}

// Einfaches Pressable ohne Reanimated (siehe Card.tsx: onPress auf der RC zuverlässig).
export function Button({
  title,
  onPress,
  style,
  disabled = false,
  loading = false,
  variant = "primary",
  testID,
}: ButtonProps) {
  const { theme } = useTheme();
  const isPrimary = variant === "primary";

  return (
    <Pressable
      testID={testID}
      onPress={disabled || loading ? undefined : onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        isPrimary
          ? { backgroundColor: theme.primary }
          : { backgroundColor: "transparent", borderWidth: 1.5, borderColor: theme.primary },
        (disabled || loading) && styles.disabled,
        style,
        pressed && !(disabled || loading) ? styles.pressed : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? "#FFFFFF" : theme.primary} size="small" />
      ) : (
        <ThemedText
          type="body"
          style={[
            styles.buttonText,
            { color: isPrimary ? "#FFFFFF" : theme.primary },
          ]}
        >
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  buttonText: {
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});
