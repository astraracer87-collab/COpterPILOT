import { openLink } from "@/lib/webBrowser";
import React from "react";
import { Linking, Pressable, Text, View } from "react-native";
import type { GeozoneFeatureInfo } from "../../shared/geozoneFeatureInfo";

/** Same conditional guidance as the map popups; no clearance badges/actions. */
export function InfrastructureFlightGuidance({ zone, textColor, linkColor }: {
  zone: GeozoneFeatureInfo;
  textColor: string;
  linkColor: string;
}) {
  if (!zone.informationalOnly || !zone.infrastructureFlightGuidance) return null;
  return (
    <View testID="infrastructure-flight-guidance" style={{ marginTop: 8, gap: 6 }}>
      <Text style={{ color: textColor, fontSize: 12, lineHeight: 18 }}>{zone.applicationText}</Text>
      {zone.links?.map((link, index) => (
        <Pressable key={`${link.url}-${index}`} accessibilityRole="link" testID={`infrastructure-flight-link-${index}`}
          onPress={() => openLink(/@/.test(link.url) && !/^https?:/i.test(link.url) ? `mailto:${link.url}` : link.url).catch(() => {})}>
          <Text style={{ color: linkColor, fontSize: 12 }}>{link.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
