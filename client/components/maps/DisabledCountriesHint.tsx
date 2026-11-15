/**
 * Kleines Popup „Geozonen für <Land> sind deaktiviert“ – NUR nach einem Tipp
 * auf die Karte in einem Land mit Nutzung „Aus“ (kein Dauer-Banner beim
 * Verschieben). Mit „Land aktivieren (online)“ und „×“. Schließt bei Tipp
 * daneben, beim Verschieben (Aufrufer) oder über „×“. Flugprüfung und Pre-Check
 * melden ungeprüfte Länder davon unabhängig weiter.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { EnableCountryButtons } from "@/components/EnableCountryButtons";
import { countryDisabledWarning, isGeozoneSourceEnabled, usageCountryLabel, usageIsoOf } from "@/lib/countryUsage";
import { detectCountryFromCoordinates } from "../../../shared/countryDetection";

export interface DisabledCountryTap {
  iso: string;
  /** Bildschirmposition des Tipps (px in der Karte) */
  x: number;
  y: number;
}

/** Land am Tipp-Punkt, falls dessen Geozonen deaktiviert sind; sonst null. */
export function disabledCountryAt(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let iso: string | null = null;
  try {
    iso = detectCountryFromCoordinates(lat, lon);
  } catch {
    iso = null;
  }
  if (!iso) return null;
  return isGeozoneSourceEnabled(iso) ? null : usageIsoOf(iso);
}

/** Tipp-Position (lat/lon) grob in Karten-Pixel umrechnen (für die Popup-Lage). */
export function tapToScreen(
  lat: number,
  lon: number,
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const x = ((lon - (region.longitude - region.longitudeDelta / 2)) / Math.max(region.longitudeDelta, 1e-9)) * size.width;
  const y = (((region.latitude + region.latitudeDelta / 2) - lat) / Math.max(region.latitudeDelta, 1e-9)) * size.height;
  return { x: Math.max(0, Math.min(size.width, x)), y: Math.max(0, Math.min(size.height, y)) };
}

const POPUP_W = 280;

export function DisabledCountryPopup({
  tap,
  mapSize,
  onClose,
}: {
  tap: DisabledCountryTap | null;
  mapSize: { width: number; height: number };
  onClose: () => void;
}) {
  if (!tap) return null;
  const left = Math.max(8, Math.min(mapSize.width - POPUP_W - 8, tap.x - POPUP_W / 2));
  // unter dem Tipp, sonst darüber (unten zu wenig Platz)
  const below = tap.y + 14 + 110 < mapSize.height;
  const top = below ? tap.y + 14 : Math.max(8, tap.y - 14 - 110);
  return (
    <View style={[styles.container, { left, top }]} testID="hint-disabled-countries">
      <View style={styles.row}>
        <Feather name="alert-triangle" size={12} color="#FFFFFF" />
        <Text style={styles.text}>{countryDisabledWarning(usageCountryLabel(tap.iso))}</Text>
        <Pressable
          testID="hint-disabled-countries-close"
          accessibilityRole="button"
          accessibilityLabel="Hinweis schließen"
          hitSlop={10}
          onPress={onClose}
          style={styles.close}
        >
          <Feather name="x" size={14} color="#FFFFFF" />
        </Pressable>
      </View>
      <EnableCountryButtons isos={[tap.iso]} color="#FFFFFF" style={styles.buttons} onEnabled={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    width: POPUP_W,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 6,
    backgroundColor: "rgba(146, 64, 14, 0.94)",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(251, 191, 36, 0.6)",
    zIndex: 30,
    elevation: 12,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  text: { flex: 1, color: "rgba(255, 255, 255, 0.97)", fontSize: 11, fontWeight: "600" },
  close: { padding: 2 },
  buttons: { marginTop: 4, gap: 6 },
});
