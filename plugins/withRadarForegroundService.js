/**
 * Expo-Config-Plugin: Vordergrunddienst der Radar-Hintergrund-Überwachung
 * (react-native-background-actions, client/lib/radarMonitorNative.ts).
 *
 * Android 14 (API 34) verlangt für jeden Vordergrunddienst einen Typ im
 * Manifest und die passende Berechtigung:
 *   - „location“  (FOREGROUND_SERVICE_LOCATION): Standard, das Radar schreibt
 *     die GPS-Position fort. Voraussetzung zur Laufzeit: erteilte Vordergrund-
 *     Standort-Berechtigung, Start aus der sichtbaren App. Kein
 *     ACCESS_BACKGROUND_LOCATION nötig.
 *   - „dataSync“  (FOREGROUND_SERVICE_DATA_SYNC): Rückfall bei manuell
 *     gesetztem Standort bzw. ohne Standort-Berechtigung (Android 15:
 *     höchstens 6 h/Tag – die Überwachung endet ohnehin nach 4 h).
 * Dazu FOREGROUND_SERVICE, WAKE_LOCK (HeadlessJsTaskService hält eine
 * Wake-Lock), POST_NOTIFICATIONS (Android 13+: Daueranzeige und Warnungen)
 * und VIBRATE.
 *
 * Die Bibliothek meldet den Dienst ohne Typ an; der Manifest-Merger ergänzt
 * das Attribut aus dem App-Manifest (gleicher voll qualifizierter Name).
 */
const { withAndroidManifest } = require("expo/config-plugins");

const SERVICE_NAME = "com.asterinet.react.bgactions.RNBackgroundActionsTask";
const SERVICE_TYPES = "location|dataSync";
const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.WAKE_LOCK",
  "android.permission.VIBRATE",
];

/** Reine Funktion (testbar): ergänzt Berechtigungen und Dienst-Eintrag. */
function applyRadarForegroundService(androidManifest) {
  const manifest = androidManifest.manifest;
  manifest["uses-permission"] = manifest["uses-permission"] || [];
  const have = new Set(manifest["uses-permission"].map((p) => p.$ && p.$["android:name"]));
  for (const name of PERMISSIONS) {
    if (!have.has(name)) manifest["uses-permission"].push({ $: { "android:name": name } });
  }
  const app = (manifest.application && manifest.application[0]) || null;
  if (!app) throw new Error("withRadarForegroundService: <application> fehlt im AndroidManifest");
  app.service = app.service || [];
  let svc = app.service.find((s) => s.$ && s.$["android:name"] === SERVICE_NAME);
  if (!svc) {
    svc = { $: { "android:name": SERVICE_NAME } };
    app.service.push(svc);
  }
  svc.$["android:foregroundServiceType"] = SERVICE_TYPES;
  svc.$["android:exported"] = "false";
  return androidManifest;
}

module.exports = function withRadarForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyRadarForegroundService(cfg.modResults);
    return cfg;
  });
};
module.exports.applyRadarForegroundService = applyRadarForegroundService;
module.exports.RADAR_SERVICE_NAME = SERVICE_NAME;
module.exports.RADAR_SERVICE_PERMISSIONS = PERMISSIONS;
