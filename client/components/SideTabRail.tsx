/**
 * Senkrechte Reiter am rechten Kartenrand und das dazugehörige ausklappbare
 * Seiten-Panel – ursprünglich aus dem Radar (StandaloneLiveTrafficScreen),
 * jetzt gemeinsam genutzt (Radar: Geozone/NOTAM/Wetter/Radar; Gebiets-
 * übersicht der Flugplanung: Geozonen/NOTAMs/Hinweise).
 */
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

export interface SideTab<T extends string> {
  id: T;
  label: string;
  /** Hintergrund des Reiters (Status-Farbe) */
  bg: string;
  /** weiße Schrift (auf kräftiger Statusfarbe) */
  textWhite?: boolean;
  /** kleine Zahl unter dem Text (z. B. Anzahl Einträge) */
  badge?: string | number;
  /** eigener Hintergrund-Inhalt (z. B. Puls-Animation) */
  background?: React.ReactNode;
  hidden?: boolean;
  testID?: string;
}

export function sideTabPalette(isDark: boolean) {
  return {
    green: "#22C55E",
    orange: "#FF9500",
    red: "#FF3B30",
    blue: "#4A90D9",
    neutral: isDark ? "rgba(20, 30, 55, 0.88)" : "rgba(255, 255, 255, 0.92)",
    panelBg: isDark ? "rgba(12, 18, 38, 0.94)" : "rgba(255, 255, 255, 0.96)",
    text: isDark ? "#D0DDF0" : "#1A1A2E",
    muted: isDark ? "rgba(160,180,210,0.7)" : "rgba(80,80,100,0.6)",
    divider: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    neutralText: isDark ? "rgba(180,200,230,0.85)" : "#444444",
  };
}

export function SideTabRail<T extends string>({
  tabs,
  activeId,
  onPress,
  isDark,
  top,
  bottom,
  hideWhenOpen = true,
  style,
}: {
  tabs: SideTab<T>[];
  activeId: T | null;
  onPress: (id: T) => void;
  isDark: boolean;
  /** Abstand vom oberen Rand des Elternelements */
  top: number;
  /** Optional: Abstand nach unten – die Reiter teilen sich dann die Höhe
   *  (max. 116 dp je Reiter), damit auch im Querformat alle sichtbar sind */
  bottom?: number;
  /** Reiter ausblenden, solange ein Panel offen ist (wie im Radar) */
  hideWhenOpen?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const pal = sideTabPalette(isDark);
  if (hideWhenOpen && activeId != null) return null;
  return (
    <View style={[railStyles.container, { top }, bottom != null && { bottom }, style]} pointerEvents="box-none">
      {tabs.map((t) => {
        if (t.hidden) return null;
        const isActive = activeId === t.id;
        const color = isActive ? pal.neutralText : t.textWhite ? "#FFFFFF" : pal.neutralText;
        return (
          <Pressable
            key={t.id}
            onPress={() => onPress(t.id)}
            style={[railStyles.tab, bottom != null && railStyles.tabFlex, { backgroundColor: isActive ? pal.panelBg : t.bg }]}
            accessibilityRole="button"
            accessibilityLabel={t.label}
            testID={t.testID ?? `side-tab-${t.id}`}
          >
            {!isActive ? t.background : null}
            <View style={railStyles.tabRotateWrap}>
              <Text style={[railStyles.tabLabel, { color }]} numberOfLines={1}>
                {t.label}
                {t.badge != null && t.badge !== "" ? ` · ${t.badge}` : ""}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Ausklappbares Panel am rechten Rand: Kopf (Titel, optional „i“, Schließen),
 * Trennlinie und scrollbarer Inhalt.
 */
export function SidePanelShell({
  title,
  accentColor,
  isDark,
  onClose,
  onInfo,
  style,
  children,
  testID,
}: {
  title: string;
  accentColor: string;
  isDark: boolean;
  onClose: () => void;
  onInfo?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  testID?: string;
}) {
  const pal = sideTabPalette(isDark);
  return (
    <View style={[panelStyles.container, { backgroundColor: pal.panelBg }, style]} testID={testID}>
      <View style={panelStyles.header}>
        <Text style={[panelStyles.title, { color: accentColor }]} numberOfLines={1}>{title}</Text>
        <View style={panelStyles.headerButtons}>
          {onInfo ? (
            <Pressable onPress={onInfo} hitSlop={8} style={[panelStyles.infoBtn, { borderColor: accentColor }]} accessibilityLabel="Info">
              <Feather name="info" size={12} color={accentColor} />
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Schließen" testID={testID ? `${testID}-close` : undefined}>
            <Feather name="x" size={20} color={pal.muted} />
          </Pressable>
        </View>
      </View>
      <View style={[panelStyles.divider, { backgroundColor: pal.divider }]} />
      <ScrollView style={panelStyles.scroll} contentContainerStyle={panelStyles.scrollContent} showsVerticalScrollIndicator>
        {children}
      </ScrollView>
    </View>
  );
}

export const railStyles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 0,
    zIndex: 130,
    gap: 4,
  },
  tab: {
    width: 38,
    height: 116,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: -3, height: 2 }, shadowOpacity: 0.35, shadowRadius: 6 },
      android: { elevation: 6 },
    }),
  },
  tabFlex: {
    height: undefined,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    maxHeight: 116,
    minHeight: 56,
  },
  tabRotateWrap: {
    width: 112,
    transform: [{ rotate: "90deg" }],
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
    textAlign: "center",
  },
});

const panelStyles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 0,
    zIndex: 125,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: -4, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
      android: { elevation: 16 },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 16, fontWeight: "800", letterSpacing: 0.5, flex: 1 },
  infoBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16, gap: 8 },
});
