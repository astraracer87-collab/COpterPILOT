import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Colors, BorderRadius, Spacing, Typography } from "@/constants/theme";

interface CheckboxProps {
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  label?: string;
}

export default function Checkbox({ checked, onPress, disabled, label }: CheckboxProps) {
  const { theme } = useTheme();

  const checkboxElement = (
    <View
      style={[
        styles.checkbox,
        {
          backgroundColor: checked ? theme.primary : "transparent",
          borderColor: checked ? theme.primary : theme.border,
        },
        disabled && styles.disabled,
      ]}
    >
      {checked ? (
        <Feather name="check" size={16} color="#FFFFFF" />
      ) : null}
    </View>
  );

  if (label) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.container,
          pressed && !disabled && styles.pressed,
        ]}
      >
        {checkboxElement}
        <ThemedText style={styles.label}>{label}</ThemedText>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        pressed && !disabled && styles.pressed,
      ]}
    >
      {checkboxElement}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...Typography.body,
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});
