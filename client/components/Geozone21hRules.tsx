import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { find21hRuleForLayer } from "@/lib/storage";

/**
 * Zeigt zu einer § 21h-Geozone (z. B. Wohngrundstücke, Bundesstraßen) die
 * dokumentierten Auflagen an, unter denen der Flug trotz des grundsätzlichen
 * Verbots ZULÄSSIG ist (§ 21h Abs. 4 LuftVO / Allgemeinverfügung). So sieht der
 * Pilot pro Zone konkret, WIE er dort legal fliegen darf, statt nur „Flugverbot".
 *
 * Rendert nichts, wenn der Layer keiner standardisierten § 21h-Regel entspricht.
 */
export function Geozone21hRules({
  layerLabel,
  isDark,
  covered,
  bundesland,
  avMissingHint,
}: {
  layerLabel?: string | null;
  isDark: boolean;
  covered?: boolean;
  bundesland?: string | null;
  /** Warum die AV hier (noch) nicht greift, z. B. „keine AV für Hessen eingetragen“ */
  avMissingHint?: string | null;
}) {
  const rule = find21hRuleForLayer(layerLabel);
  if (!rule) return null;

  const accent = isDark ? "#30D158" : "#248A3D";
  const textColor = isDark ? "#E5E5EA" : "#1C1C1E";
  const mutedColor = isDark ? "#9BA1A6" : "#6B7280";
  const boxBg = isDark ? "rgba(48,209,88,0.08)" : "rgba(52,199,89,0.06)";
  const boxBorder = isDark ? "rgba(48,209,88,0.35)" : "rgba(52,199,89,0.3)";

  return (
    <View style={[styles.box, { backgroundColor: boxBg, borderColor: boxBorder }]}>
      <View style={styles.headerRow}>
        <Feather name="check-circle" size={13} color={accent} />
        <Text style={[styles.heading, { color: accent }]}>
          {covered
            ? bundesland
              ? `Mit deiner Allgemeinverfügung ${bundesland} erlaubt`
              : "Mit deiner Allgemeinverfügung erlaubt"
            : "So darfst du hier fliegen"}
        </Text>
      </View>
      <Text style={[styles.paragraph, { color: mutedColor }]}>{rule.paragraph}</Text>
      <Text style={[styles.grundsatz, { color: mutedColor }]}>Grundsatz: {rule.tatbestand}</Text>
      <Text style={[styles.auflagenLabel, { color: accent }]}>
        {covered ? "Diese Auflagen musst du einhalten:" : "Zulässig unter diesen Auflagen:"}
      </Text>
      {rule.auflagen.map((a, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={[styles.bulletDot, { color: accent }]}>•</Text>
          <Text style={[styles.bulletText, { color: textColor }]}>{a}</Text>
        </View>
      ))}
      {covered ? (
        <View style={styles.coveredRow}>
          <Feather name="shield" size={11} color={accent} />
          <Text style={[styles.coveredText, { color: accent }]}>
            {bundesland
              ? `Durch deine Allgemeinverfügung für ${bundesland} abgedeckt`
              : "Durch deine Allgemeinverfügung abgedeckt"}
          </Text>
        </View>
      ) : avMissingHint ? (
        <View style={styles.coveredRow}>
          <Feather name="alert-circle" size={11} color={isDark ? "#F5D080" : "#92400E"} />
          <Text style={[styles.coveredText, { color: isDark ? "#F5D080" : "#92400E" }]}>{avMissingHint}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  heading: {
    fontSize: 12,
    fontWeight: "700",
  },
  paragraph: {
    fontSize: 10,
    marginTop: 2,
  },
  grundsatz: {
    fontSize: 10,
    marginTop: 4,
    lineHeight: 14,
  },
  auflagenLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 6,
    marginBottom: 2,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    marginTop: 2,
  },
  bulletDot: {
    fontSize: 12,
    lineHeight: 16,
  },
  bulletText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  coveredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  coveredText: {
    flex: 1,
    fontSize: 10,
    fontWeight: "600",
  },
});
