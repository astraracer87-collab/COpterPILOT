/**
 * Expo-Config-Plugin: signiert den Release-Build mit dem Keystore aus den
 * Umgebungsvariablen (GitHub Actions). Ohne Variablen bleibt die Signatur
 * mit dem Debug-Schlüssel (nur zum Testen; Updates erfordern dann Neuinstallation).
 *
 *   CP_KEYSTORE_FILE      Pfad zur .jks/.keystore-Datei
 *   CP_KEYSTORE_PASSWORD  Passwort des Keystores
 *   CP_KEY_ALIAS          Alias des Schlüssels
 *   CP_KEY_PASSWORD       Passwort des Schlüssels
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// copterpilot-release-signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARKER}
        release {
            if (System.getenv("CP_KEYSTORE_FILE")) {
                storeFile file(System.getenv("CP_KEYSTORE_FILE"))
                storePassword System.getenv("CP_KEYSTORE_PASSWORD")
                keyAlias System.getenv("CP_KEY_ALIAS")
                keyPassword System.getenv("CP_KEY_PASSWORD")
            }
        }`,
    );

    // Im release-Block die Signatur umstellen (nur wenn ein Keystore gesetzt ist)
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig System.getenv("CP_KEYSTORE_FILE") ? signingConfigs.release : signingConfigs.debug`,
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
