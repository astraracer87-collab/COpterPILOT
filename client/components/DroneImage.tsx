// Drohnenbild aus assets/images/drones (falls für das Modell vorhanden), sonst Symbol.
import React from "react";
import { Image } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { getDroneImage } from "@/lib/droneImage";

export function DroneImage({
  manufacturer,
  model,
  size,
  iconColor,
  iconSize = 24,
}: {
  manufacturer?: string;
  model?: string;
  size: number;
  iconColor: string;
  iconSize?: number;
}) {
  const src = getDroneImage(manufacturer, model);
  if (src) return <Image source={src} style={{ width: size, height: size }} resizeMode="contain" />;
  return <MaterialCommunityIcons name="quadcopter" size={iconSize} color={iconColor} />;
}
