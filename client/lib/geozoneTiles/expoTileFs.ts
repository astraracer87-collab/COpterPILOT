// Dateisystem-Adapter des Geozonen-Kachelspeichers für das Gerät
// (expo-file-system). Wird von tileStore.ts lazy per require geladen, damit
// die Logik unter tsx/Node ohne nativen Modulgraphen testbar bleibt.
//
// Neue API (File/FileHandle) für Binärzugriffe: Anhängen an data.bin und
// Lesen einzelner Datensätze per Offset. Legacy-API für Ordner, Text und
// Downloads (wie offlineMaps.ts).
import * as Legacy from "expo-file-system/legacy";
import { File, FileMode } from "expo-file-system";
import type { TileFs } from "./tileStore";

export function createExpoTileFs(): TileFs | null {
  if (!Legacy.documentDirectory) return null;
  const root = `${Legacy.documentDirectory}geozone-tiles/`;
  const parentOf = (p: string) => p.replace(/[^/]+\/?$/, "");
  return {
    root: () => root,
    async exists(path) {
      return (await Legacy.getInfoAsync(path)).exists;
    },
    async readText(path) {
      const info = await Legacy.getInfoAsync(path);
      if (!info.exists) return null;
      return Legacy.readAsStringAsync(path);
    },
    async writeText(path, text) {
      await Legacy.makeDirectoryAsync(parentOf(path), { intermediates: true }).catch(() => {});
      const tmp = `${path}.tmp`;
      await Legacy.writeAsStringAsync(tmp, text);
      await Legacy.deleteAsync(path, { idempotent: true });
      await Legacy.moveAsync({ from: tmp, to: path });
    },
    async appendBytes(path, bytes) {
      const f = new File(path);
      if (!f.exists) f.create({ intermediates: true });
      f.write(bytes, { append: true });
    },
    async size(path) {
      const f = new File(path);
      return f.exists ? f.size ?? 0 : 0;
    },
    async readRanges(path, ranges) {
      const handle = new File(path).open(FileMode.ReadOnly);
      try {
        return ranges.map(([off, len]) => {
          handle.offset = off;
          return handle.readBytes(len);
        });
      } finally {
        handle.close();
      }
    },
    async readBytes(path) {
      return new File(path).bytes();
    },
    async download(url, path) {
      await Legacy.makeDirectoryAsync(parentOf(path), { intermediates: true }).catch(() => {});
      const res = await Legacy.downloadAsync(url, path, { headers: { "User-Agent": "COpterPilot-RC/1.0" } });
      if (res.status !== 200) {
        await Legacy.deleteAsync(path, { idempotent: true }).catch(() => {});
        throw new Error(`HTTP ${res.status}`);
      }
      const info = await Legacy.getInfoAsync(path);
      return info.exists && "size" in info ? info.size ?? 0 : 0;
    },
    async remove(path) {
      await Legacy.deleteAsync(path, { idempotent: true });
    },
    async move(from, to) {
      await Legacy.makeDirectoryAsync(parentOf(to.replace(/\/$/, "")), { intermediates: true }).catch(() => {});
      await Legacy.moveAsync({ from: from.replace(/\/$/, ""), to: to.replace(/\/$/, "") });
    },
    async mkdirp(path) {
      await Legacy.makeDirectoryAsync(path, { intermediates: true }).catch(() => {});
    },
    async freeBytes() {
      try {
        return await Legacy.getFreeDiskStorageAsync();
      } catch {
        return null;
      }
    },
  };
}
