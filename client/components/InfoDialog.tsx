import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as SafeArea from "react-native-safe-area-context";
import type { EdgeInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";

/**
 * Gemeinsamer Info-Dialog (alle „i“-/Hilfe-Fenster der App).
 *
 * Querformat (Fernsteuerung, ~960×540 dp): breites Panel (≈78 % Breite, max.
 * 760 dp, Höhe bis ≈85 %), Titel und Schließen/OK bleiben fest, nur der Inhalt
 * scrollt. Lange Texte laufen in zwei Spalten. Die Statusleisten-Zeile oben
 * (mit der Download-Pille) bleibt frei, das X liegt darunter.
 * Hochformat: volle Breite als Bottom-Sheet.
 *
 * Schließen: Tipp außerhalb, X, OK-Knopf, Android-Zurück (onRequestClose).
 */

export type InfoDialogSection = {
  /** Optionale Zwischenüberschrift. */
  title?: string;
  /** Fließtext oder eigener Inhalt. */
  body: React.ReactNode;
  /** Gewicht für die Spaltenaufteilung (Standard: Textlänge bzw. 200). */
  weight?: number;
};

export type InfoDialogProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Feather-Icon links neben dem Titel (optional). */
  icon?: React.ComponentProps<typeof Feather>["name"];
  /** Akzentfarbe für Titel/Icon/OK (Standard: theme.primary). */
  accentColor?: string;
  /** Einfacher Fließtext; Absätze (Leerzeile) werden im Querformat auf zwei Spalten verteilt. */
  text?: string;
  /** Abschnitte; im Querformat ggf. auf zwei Spalten verteilt. */
  sections?: InfoDialogSection[];
  /** Freier Inhalt oben im Scrollbereich (volle Breite, vor text/sections). */
  intro?: React.ReactNode;
  /** Freier Inhalt (immer einspaltig, unter text/sections). */
  children?: React.ReactNode;
  /** Beschriftung des Bestätigungsknopfs (Standard „OK“); null blendet ihn aus. */
  okLabel?: string | null;
  /** Zusätzlicher Inhalt im festen Fußbereich links neben OK. */
  footer?: React.ReactNode;
  /** Spalten: "auto" (Standard) = zwei Spalten im Querformat bei langem Inhalt. */
  columns?: "auto" | 1 | 2;
  /** Farbe des Fließtexts (Standard theme.textSecondary). */
  textColor?: string;
  /** Hintergrund des Panels (Standard theme.backgroundDefault). */
  backgroundColor?: string;
  testID?: string;
  /** Eigene testIDs für X bzw. OK (Standard: `${testID}-close` / `${testID}-ok`). */
  closeTestID?: string;
  okTestID?: string;
};

/** Ab dieser (geschätzten) Textlänge werden im Querformat zwei Spalten genutzt. */
export const TWO_COLUMN_MIN_CHARS = 420;

export type InfoDialogLayout = {
  landscape: boolean;
  panelWidth: number;
  panelMaxHeight: number;
  /** Abstand des Panels/Overlays nach oben (Statusleisten-Streifen + Luft). */
  topReserve: number;
  bottomReserve: number;
};

/** Reine Layout-Berechnung (auch für Tests). */
export function computeInfoDialogLayout(
  width: number,
  height: number,
  insets: EdgeInsets,
  statusBarHeight = 0,
): InfoDialogLayout {
  const landscape = width > height;
  const topStrip = Math.max(insets.top, statusBarHeight);
  if (landscape) {
    const topReserve = topStrip + 8;
    const bottomReserve = insets.bottom + 8;
    const horizontalRoom = width - insets.left - insets.right - 24;
    const panelWidth = Math.round(Math.max(Math.min(760, width * 0.78, horizontalRoom), Math.min(320, horizontalRoom)));
    const panelMaxHeight = Math.round(Math.min(height * 0.85, height - topReserve - bottomReserve));
    return { landscape, panelWidth, panelMaxHeight, topReserve, bottomReserve };
  }
  const topReserve = topStrip + 24;
  return {
    landscape,
    panelWidth: Math.round(width),
    panelMaxHeight: Math.round(Math.min(height * 0.85, height - topReserve)),
    topReserve,
    bottomReserve: insets.bottom,
  };
}

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Safe-Area-Insets; ohne Provider (z. B. in Tests) einfach 0. */
function useInsetsOrZero(): EdgeInsets {
  try {
    return SafeArea.useSafeAreaInsets?.() ?? ZERO_INSETS;
  } catch {
    return ZERO_INSETS;
  }
}

function estimateWeight(node: React.ReactNode): number {
  if (typeof node === "string") return node.length;
  if (typeof node === "number") return String(node).length;
  if (Array.isArray(node)) return node.reduce((s: number, n) => s + estimateWeight(n), 0);
  if (React.isValidElement(node)) {
    const children = (node.props as { children?: React.ReactNode })?.children;
    const w = estimateWeight(children);
    return w > 0 ? w : 120;
  }
  return 0;
}

/** Verteilt Elemente nach Gewicht ausgewogen und in Reihenfolge auf zwei Spalten. */
export function splitIntoColumns<T>(items: T[], weightOf: (t: T) => number): [T[], T[]] {
  if (items.length < 2) return [items, []];
  const weights = items.map(weightOf);
  const total = weights.reduce((a, b) => a + b, 0);
  let best = 1;
  let bestDiff = Infinity;
  let acc = 0;
  for (let i = 0; i < items.length - 1; i++) {
    acc += weights[i];
    const diff = Math.abs(total / 2 - acc);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i + 1;
    }
  }
  return [items.slice(0, best), items.slice(best)];
}

export function InfoDialog({
  visible,
  onClose,
  title,
  icon,
  accentColor,
  text,
  sections,
  intro,
  children,
  okLabel = "OK",
  footer,
  columns = "auto",
  textColor,
  backgroundColor,
  testID = "info-dialog",
  closeTestID,
  okTestID,
}: InfoDialogProps) {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useInsetsOrZero();
  const statusBarHeight = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const layout = computeInfoDialogLayout(width, height, insets, statusBarHeight);
  const accent = accentColor ?? theme.primary;
  const bodyColor = textColor ?? theme.textSecondary;
  const panelBg = backgroundColor ?? theme.backgroundDefault;

  // Einheitliche Abschnittsliste aus text (Absätze) bzw. sections.
  const items: InfoDialogSection[] = sections
    ? sections
    : text
      ? text.split(/\n\s*\n/).map((p) => ({ body: p }))
      : [];
  const totalWeight = items.reduce((s, it) => s + (it.weight ?? (estimateWeight(it.body) || 200)), 0);
  const twoColumns =
    layout.landscape &&
    items.length >= 2 &&
    (columns === 2 || (columns === "auto" && totalWeight >= TWO_COLUMN_MIN_CHARS));
  const [left, right] = twoColumns
    ? splitIntoColumns(items, (it) => it.weight ?? (estimateWeight(it.body) || 200))
    : [items, [] as InfoDialogSection[]];

  const renderSection = (it: InfoDialogSection, i: number) => (
    <View key={i} style={styles.section}>
      {it.title ? <Text style={[styles.sectionTitle, { color: accent }]}>{it.title}</Text> : null}
      {typeof it.body === "string" || typeof it.body === "number" ? (
        <Text style={[styles.bodyText, { color: bodyColor }]}>{it.body}</Text>
      ) : (
        it.body
      )}
    </View>
  );

  const panelStyle: StyleProp<ViewStyle> = layout.landscape
    ? [styles.panel, styles.panelLandscape, { width: layout.panelWidth, maxHeight: layout.panelMaxHeight, backgroundColor: panelBg }]
    : [
        styles.panel,
        styles.panelPortrait,
        { width: layout.panelWidth, maxHeight: layout.panelMaxHeight, backgroundColor: panelBg, paddingBottom: Math.max(12, layout.bottomReserve) },
      ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType={layout.landscape ? "fade" : "slide"}
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape", "landscape-left", "landscape-right"]}
    >
      <View
        style={[
          styles.overlay,
          layout.landscape
            ? { justifyContent: "center", paddingTop: layout.topReserve, paddingBottom: layout.bottomReserve, paddingLeft: insets.left, paddingRight: insets.right }
            : { justifyContent: "flex-end", paddingTop: layout.topReserve },
        ]}
        testID={`${testID}-overlay`}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Schließen"
          testID={`${testID}-backdrop`}
        />
        <View style={panelStyle} testID={layout.landscape ? `${testID}-landscape` : `${testID}-portrait`}>
          <View style={styles.header}>
            {icon ? <Feather name={icon} size={20} color={accent} /> : null}
            <Text style={[styles.title, { color: accent }]} numberOfLines={2} testID={`${testID}-title`}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Schließen"
              testID={closeTestID ?? `${testID}-close`}
            >
              <Feather name="x" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            testID={`${testID}-scroll`}
          >
            {intro}
            {twoColumns ? (
              <View style={styles.columns} testID={`${testID}-columns`}>
                <View style={styles.column}>{left.map(renderSection)}</View>
                <View style={styles.column}>{right.map((it, i) => renderSection(it, i + left.length))}</View>
              </View>
            ) : (
              items.map(renderSection)
            )}
            {children}
          </ScrollView>
          {okLabel !== null || footer ? (
            <View style={[styles.footer, { borderTopColor: theme.border }]}>
              <View style={{ flex: 1 }}>{footer}</View>
              {okLabel !== null ? (
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => [styles.okBtn, { backgroundColor: accent, opacity: pressed ? 0.8 : 1 }]}
                  accessibilityRole="button"
                  testID={okTestID ?? `${testID}-ok`}
                >
                  <Text style={styles.okText}>{okLabel}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export default InfoDialog;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  panel: {
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 16 },
      default: { elevation: 20 },
    }),
  },
  panelLandscape: {
    borderRadius: 16,
  },
  panelPortrait: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 18,
    paddingRight: 10,
    paddingTop: 12,
    paddingBottom: 10,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
  },
  columns: {
    flexDirection: "row",
    gap: 22,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  section: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 21,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  okBtn: {
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: "center",
  },
  okText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
