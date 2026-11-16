import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/useColorScheme";

// Aliases für historische Property-Namen (`card`, `background`),
// die in einigen Screens noch verwendet werden. Mappen auf existierende
// Theme-Farben, damit nichts undefined wird.
function buildTheme(scheme: "light" | "dark") {
  const base = Colors[scheme];
  return {
    ...base,
    card: base.backgroundDefault,
    background: base.backgroundRoot,
  };
}

type AppTheme = ReturnType<typeof buildTheme>;

// Einmal je Farbschema erzeugt: `theme` ist über Renders hinweg dasselbe
// Objekt. So brechen Props/Abhängigkeiten mit `theme` keine Memoisierung
// (React.memo/useMemo) und es entsteht nicht bei jedem Render ein neues Objekt.
const themeCache: Partial<Record<"light" | "dark", { theme: AppTheme; isDark: boolean }>> = {};

export function useTheme() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme === "dark" ? "dark" : "light";
  let entry = themeCache[scheme];
  if (!entry) {
    entry = { theme: buildTheme(scheme), isDark: scheme === "dark" };
    themeCache[scheme] = entry;
  }
  return entry;
}
