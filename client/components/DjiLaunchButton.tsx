import React, { useEffect, useState } from "react";
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { findInstalledDjiApp, launchDjiApp, type InstalledDjiApp } from "@/lib/djiLauncher";

/**
 * Runder weißer Knopf in der Mitte der Tab-Leiste: öffnet DJI Fly (bzw. DJI Pilot 2).
 * Gezeigt wird das Symbol der auf dem Gerät installierten DJI-App.
 */
export function DjiLaunchButton({ size = 48 }: { size?: number }) {
  const [app, setApp] = useState<InstalledDjiApp | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    findInstalledDjiApp()
      .then((a) => { if (alive) { setApp(a); setChecked(true); } })
      .catch(() => { if (alive) setChecked(true); });
    return () => { alive = false; };
  }, []);

  // Ohne installierte DJI-App (oder solange noch gesucht wird) gibt es den Knopf gar nicht –
  // die Leiste sieht dann aus wie vorher.
  if (Platform.OS !== "android" || !checked || !app) return null;

  const onPress = () => {
    if (!launchDjiApp(app.pkg)) {
      Alert.alert(app.label, `${app.label} konnte nicht geöffnet werden.`);
    }
  };

  return (
    // Ragt etwas über die Tab-Leiste hinaus (größerer Knopf, Leiste bleibt flach)
    <View style={[styles.slot, { marginTop: -Math.round(size * 0.3) }]} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${app.label} öffnen`}
        testID="tab-dji-launch"
        android_ripple={null}
        style={({ pressed }) => [
          styles.button,
          { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        {app.iconUri ? (
          <Image source={{ uri: app.iconUri }} style={{ width: size * 0.7, height: size * 0.7, borderRadius: size * 0.16 }} />
        ) : (
          <Feather name="navigation" size={size * 0.46} color="#1C1C1E" />
        )}
      </Pressable>
      <Text style={styles.caption} numberOfLines={1}>{app.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  button: {
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  caption: { fontSize: 9, color: "#9AA0A6", marginTop: 1 },
});
