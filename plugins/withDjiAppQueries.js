// Android 11+ (Paket-Sichtbarkeit): DJI Fly / DJI Pilot 2 im Manifest unter <queries> anmelden,
// damit unsere App deren Symbol lesen und sie starten kann. Keine Berechtigung nötig.
const { withAndroidManifest } = require("expo/config-plugins");

const PACKAGES = ["dji.go.v5", "dji.pilot2"];

module.exports = function withDjiAppQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries || [{}];
    const q = manifest.queries[0];
    q.package = q.package || [];
    for (const name of PACKAGES) {
      if (!q.package.some((p) => p.$ && p.$["android:name"] === name)) {
        q.package.push({ $: { "android:name": name } });
      }
    }
    return cfg;
  });
};
