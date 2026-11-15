/**
 * Länder-Nutzung: „Land aktivieren (online)“ für deaktivierte Länder am
 * geprüften Ort (Planung, Pre-Check, Radar). Ein Tipp stellt das Land auf
 * „Online“; die Prüfung lädt danach neu (onCountryUsageChange →
 * onGeozoneDataChanged).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { applyCountryUsage } from "@/lib/countryUsageData";
import { ENABLE_COUNTRY_ACTION_LABEL, usageCountryLabel } from "@/lib/countryUsage";

export function EnableCountryButtons({
  isos,
  color = "#0A84FF",
  style,
  onEnabled,
}: {
  isos: string[];
  color?: string;
  style?: StyleProp<ViewStyle>;
  onEnabled?: (iso: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const unique = [...new Set(isos.map((i) => i.toUpperCase()))];
  if (unique.length === 0) return null;
  return (
    <View style={[styles.wrap, style]}>
      {unique.map((iso) => (
        <Pressable
          key={iso}
          testID={`enable-country-${iso}`}
          accessibilityRole="button"
          disabled={busy != null}
          onPress={async () => {
            setBusy(iso);
            try {
              await applyCountryUsage(iso, "online");
              onEnabled?.(iso);
            } catch {
            } finally {
              setBusy(null);
            }
          }}
          style={[styles.btn, { borderColor: color, opacity: busy != null && busy !== iso ? 0.5 : 1 }]}
        >
          {busy === iso ? <ActivityIndicator size="small" color={color} /> : <Feather name="power" size={14} color={color} />}
          <Text style={[styles.text, { color }]}>
            {unique.length > 1 ? `${usageCountryLabel(iso)}: ${ENABLE_COUNTRY_ACTION_LABEL}` : ENABLE_COUNTRY_ACTION_LABEL}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  text: { fontWeight: "700", fontSize: 14 },
});
