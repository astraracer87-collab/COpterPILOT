// Drohnenbild aus assets/images/drones (falls für das Modell vorhanden), sonst
// Herstellerlogo bzw. Herstellername, ohne Hersteller ein Symbol.
import React from "react";
import { Image, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { getDroneImage } from "@/lib/droneImage";
import { getManufacturerLogo, isMonochromeLogo } from "@/lib/manufacturerLogo";

export function ManufacturerBadge({ manufacturer, size, color }: { manufacturer: string; size: number; color: string }) {
  const logo = getManufacturerLogo(manufacturer);
  if (logo)
    return (
      <Image
        source={logo}
        style={[{ width: size, height: size }, isMonochromeLogo(manufacturer) ? { tintColor: color } : null]}
        resizeMode="contain"
      />
    );
  // Schriftzug passend zur Fläche verkleinern
  const len = Math.max(3, manufacturer.length);
  const fontSize = Math.max(8, Math.min(size * 0.32, (size * 1.6) / len));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <ThemedText numberOfLines={2} style={{ fontSize, lineHeight: fontSize * 1.15, fontWeight: "800", color, textAlign: "center" }}>
        {manufacturer}
      </ThemedText>
    </View>
  );
}

export function DroneImage({
  manufacturer,
  model,
  size,
  iconColor,
  iconSize = 24,
  fill = false,
}: {
  manufacturer?: string;
  model?: string;
  size: number;
  iconColor: string;
  iconSize?: number;
  /** Bild füllt den umgebenden Rahmen (Breite/Höhe 100 %) statt fester Größe */
  fill?: boolean;
}) {
  const src = getDroneImage(manufacturer, model);
  if (src)
    return (
      <Image
        source={src}
        style={fill ? { width: "100%", height: "100%" } : { width: size, height: size }}
        resizeMode="contain"
      />
    );
  if (manufacturer?.trim()) return <ManufacturerBadge manufacturer={manufacturer.trim()} size={size} color={iconColor} />;
  return <MaterialCommunityIcons name="quadcopter" size={iconSize} color={iconColor} />;
}
