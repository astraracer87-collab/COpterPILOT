// AsyncStorage (Android, SQLite) ist standardmäßig auf 6 MB begrenzt. Ist die Datenbank voll,
// schlägt jedes Speichern fehl (z. B. „Session konnte nicht erstellt werden“).
// Grenze auf 512 MB anheben – belegt wird nur, was tatsächlich gespeichert ist.
const { withGradleProperties } = require("expo/config-plugins");

const KEY = "AsyncStorage_db_size_in_MB";
const SIZE_MB = "512";

module.exports = function withAsyncStorageSize(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === "property" && p.key === KEY));
    cfg.modResults.push({ type: "property", key: KEY, value: SIZE_MB });
    return cfg;
  });
};
