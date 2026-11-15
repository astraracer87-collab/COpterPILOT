import React from "react";
import { StyleSheet, Pressable, View, ViewStyle, StyleProp } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface CardProps {
  elevation?: number;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const getBackgroundColorForElevation = (
  elevation: number,
  theme: any,
): string => {
  switch (elevation) {
    case 1:
      return theme.backgroundDefault;
    case 2:
      return theme.backgroundSecondary;
    case 3:
      return theme.backgroundTertiary;
    default:
      return theme.backgroundRoot;
  }
};

// Bewusst ein einfaches Pressable ohne Reanimated: Die frühere
// Reanimated-Variante (createAnimatedComponent(Pressable) + Skalierung beim
// Drücken) löste auf der Fernsteuerung (Android, neue Architektur) onPress
// nicht zuverlässig aus – Menüpunkte in den Einstellungen reagierten nicht.

export function Card({
  elevation = 1,
  title,
  description,
  children,
  onPress,
  style,
  testID,
}: CardProps) {
  const { theme } = useTheme();

  const cardBackgroundColor = getBackgroundColorForElevation(elevation, theme);

  const cardContent = (
    <>
      {title ? (
        <ThemedText type="h4" style={styles.cardTitle}>
          {title}
        </ThemedText>
      ) : null}
      {description ? (
        <ThemedText type="small" style={styles.cardDescription}>
          {description}
        </ThemedText>
      ) : null}
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: cardBackgroundColor,
          },
          style,
          pressed ? styles.pressed : null,
        ]}
      >
        {cardContent}
      </Pressable>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: cardBackgroundColor,
        },
        style,
      ]}
    >
      {cardContent}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: BorderRadius.md,
  },
  pressed: {
    opacity: 0.7,
  },
  cardTitle: {
    marginBottom: Spacing.sm,
  },
  cardDescription: {
    opacity: 0.7,
  },
});
