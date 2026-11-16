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

  if (Platform.OS !== "android") return null;

  const onPress = () => {
    if (!app) {
      Alert.alert("DJI-App nicht gefunden", "DJI Fly bzw. DJI Pilot 2 ist auf diesem Gerät nicht installiert.");
      return;
    }
    if (!launchDjiApp(app.pkg)) {
      Alert.alert(app.label, `${app.label} konnte nicht geöffnet werden.`);
    }
  };

  return (
    <View style={styles.slot} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={app ? `${app.label} öffnen` : "DJI-App öffnen"}
        testID="tab-dji-launch"
        android_ripple={null}
        style={({ pressed }) => [
          styles.button,
          { width: size, height: size, borderRadius: size / 2, opacity: checked && !app ? 0.5 : pressed ? 0.8 : 1 },
        ]}
      >
        {app?.iconUri ? (
          <Image source={{ uri: app.iconUri }} style={{ width: size * 0.62, height: size * 0.62, borderRadius: size * 0.14 }} />
        ) : (
          <Feather name="navigation" size={size * 0.42} color="#1C1C1E" />
        )}
      </Pressable>
      {app ? <Text style={styles.caption} numberOfLines={1}>{app.label}</Text> : null}
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
