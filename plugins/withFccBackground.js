/**
 * Expo-Config-Plugin: macht den FCC-Keepalive-Vordergrunddienst (react-native-background-actions)
 * Android-14-tauglich.
 *
 *  - fügt die nötigen Berechtigungen hinzu (FOREGROUND_SERVICE[_DATA_SYNC], POST_NOTIFICATIONS,
 *    CHANGE_WIFI_STATE)
 *  - setzt android:foregroundServiceType="dataSync" auf den Dienst RNBackgroundActionsTask
 *    (per Manifest-Merge), weil startForeground() ab Android 14 sonst abbricht.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.CHANGE_WIFI_STATE",
];

const BG_SERVICE = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

module.exports = function withFccBackground(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // tools-Namespace für den Merge
    manifest.$ = manifest.$ || {};
    manifest.$["xmlns:tools"] = manifest.$["xmlns:tools"] || "http://schemas.android.com/tools";

    // Berechtigungen
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    for (const name of PERMISSIONS) {
      if (!manifest["uses-permission"].some((p) => p.$ && p.$["android:name"] === name)) {
        manifest["uses-permission"].push({ $: { "android:name": name } });
      }
    }

    // Service-Typ per Merge ergänzen
    const app = manifest.application && manifest.application[0];
    if (app) {
      app.service = app.service || [];
      const existing = app.service.find((s) => s.$ && s.$["android:name"] === BG_SERVICE);
      if (existing) {
        existing.$["android:foregroundServiceType"] = "location|dataSync";
        existing.$["tools:node"] = "merge";
      } else {
        app.service.push({
          $: {
            "android:name": BG_SERVICE,
            "android:foregroundServiceType": "location|dataSync",
            "tools:node": "merge",
          },
        });
      }
    }

    return cfg;
  });
};
