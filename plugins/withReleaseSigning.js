/**
 * Expo-Config-Plugin: signiert den Release-Build mit einem FESTEN Schlüssel,
 * damit App-Updates (drüber­installieren) alle gespeicherten Daten behalten.
 *
 * Reihenfolge:
 *   1. GitHub-Secrets (CP_KEYSTORE_FILE/…), falls gesetzt – für CI-Override.
 *   2. Fester Keystore im Repo: signing/copterpilot-release.keystore
 *      (Alias/Passwörter „copterpilot"). Dadurch ist die Signatur über alle
 *      Builds identisch und Updates löschen keine Daten.
 *   3. Sonst Debug-Schlüssel (nur falls der Repo-Keystore fehlt).
 *
 * Hinweis: Der Keystore liegt bewusst im (privaten) Repo. Für eine privat
 * verteilte RC-App ist das vertretbar; ein echter Play-Store-Release sollte
 * stattdessen GitHub-Secrets verwenden.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// copterpilot-release-signing";
const REPO_STORE = '../signing/copterpilot-release.keystore';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARKER}
        release {
            def cpEnvStore = System.getenv("CP_KEYSTORE_FILE")
            def cpRepoStore = new File(rootProject.projectDir, "${REPO_STORE}")
            if (cpEnvStore) {
                storeFile file(cpEnvStore)
                storePassword System.getenv("CP_KEYSTORE_PASSWORD")
                keyAlias System.getenv("CP_KEY_ALIAS")
                keyPassword System.getenv("CP_KEY_PASSWORD")
            } else if (cpRepoStore.exists()) {
                storeFile cpRepoStore
                storePassword "copterpilot"
                keyAlias "copterpilot"
                keyPassword "copterpilot"
            }
        }`,
    );

    // Release-Build mit dem festen Schlüssel signieren, sobald einer verfügbar ist.
    // Ganzer Ternär-Ausdruck in den Methodenklammern, sonst parst Groovy
    // signingConfig(Bedingung) und wirft "Boolean cannot be cast to SigningConfig".
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig(((System.getenv("CP_KEYSTORE_FILE") != null) || new File(rootProject.projectDir, "${REPO_STORE}").exists()) ? signingConfigs.release : signingConfigs.debug)`,
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
