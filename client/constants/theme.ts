import { Platform } from "react-native";

export const Colors = {
  light: {
    text: "#1A202C",
    textSecondary: "#4A5568",
    textTertiary: "#A0AEC0",
    buttonText: "#FFFFFF",
    tabIconDefault: "#687076",
    tabIconSelected: "#0A4D8C",
    link: "#0A4D8C",
    backgroundRoot: "#F5F7FA",
    backgroundDefault: "#FFFFFF",
    backgroundSecondary: "#F5F7FA",
    backgroundTertiary: "#E2E8F0",
    border: "#D1D5DB",
    primary: "#0A4D8C",
    statusGo: "#2D8659",
    statusGoBackground: "rgba(45, 134, 89, 0.1)",
    statusCaution: "#D97706",
    statusCautionBackground: "rgba(217, 119, 6, 0.1)",
    statusNoGo: "#C53030",
    statusNoGoBackground: "rgba(197, 48, 48, 0.1)",
    phasePlanning: "#D97706",
    phasePrecheck: "#2563EB",
    phaseInFlight: "#EA580C",
    phaseDebriefing: "#2D8659",
  },
  dark: {
    text: "#ECEDEE",
    textSecondary: "#A0AEC0",
    textTertiary: "#718096",
    buttonText: "#FFFFFF",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: "#60A5FA",
    link: "#60A5FA",
    backgroundRoot: "#1A202C",
    backgroundDefault: "#2D3748",
    backgroundSecondary: "#1A202C",
    backgroundTertiary: "#4A5568",
    border: "#4A5568",
    primary: "#60A5FA",
    statusGo: "#48BB78",
    statusGoBackground: "rgba(72, 187, 120, 0.15)",
    statusCaution: "#ECC94B",
    statusCautionBackground: "rgba(236, 201, 75, 0.15)",
    statusNoGo: "#FC8181",
    statusNoGoBackground: "rgba(252, 129, 129, 0.15)",
    phasePlanning: "#ECC94B",
    phasePrecheck: "#60A5FA",
    phaseInFlight: "#FB923C",
    phaseDebriefing: "#48BB78",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 6,
  sm: 10,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 28,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 22,
    fontWeight: "600" as const,
  },
  h3: {
    fontSize: 20,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 17,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 17,
    fontWeight: "400" as const,
  },
  callout: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  caption: {
    fontSize: 13,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 17,
    fontWeight: "400" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

export const Shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  fab: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
};
