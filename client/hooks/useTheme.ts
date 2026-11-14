import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/useColorScheme";

export function useTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const base = Colors[colorScheme === "dark" ? "dark" : "light"];

  // Aliases für historische Property-Namen (`card`, `background`),
  // die in einigen Screens noch verwendet werden. Mappen auf existierende
  // Theme-Farben, damit nichts undefined wird.
  const theme = {
    ...base,
    card: base.backgroundDefault,
    background: base.backgroundRoot,
  };

  return {
    theme,
    isDark,
  };
}
