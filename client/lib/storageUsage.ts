// Speicherbelegung der App für „Meine Daten“: AsyncStorage-Einträge plus
// Dateien unter documentDirectory (Offline-Karten, Geozonen, Hindernisse,
// Dokumente …). Reine Funktionen mit übergebenen Abhängigkeiten (unter tsx testbar).
//
// Hintergrund: Die frühere Berechnung las alle Werte mit EINEM multiGet. Auf
// Android scheitert das, sobald ein einzelner Wert zu groß für das
// SQLite-CursorWindow (~2 MB) ist – der Fehler wurde verschluckt und es wurde
// „ca. 0 B“ angezeigt. Außerdem fehlten die Dateien komplett.

export interface KeyValueStore {
  getAllKeys(): Promise<readonly string[]>;
  getItem(key: string): Promise<string | null>;
}

export interface FileInfoLike {
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
}

export interface FileStore {
  getInfoAsync(uri: string): Promise<FileInfoLike>;
  readDirectoryAsync(uri: string): Promise<string[]>;
}

export interface KeyValueUsage {
  keys: number;
  bytes: number;
  /** Einträge, deren Wert nicht gelesen werden konnte (z. B. zu groß) */
  unreadable: number;
}

export interface FileUsagePart {
  name: string;
  label: string;
  bytes: number;
}

export interface FileUsage {
  bytes: number;
  parts: FileUsagePart[];
}

/** Bekannte Verzeichnisse unter documentDirectory → verständliche Namen. */
export const KNOWN_DIRECTORIES: Record<string, string> = {
  tiles: "Offline-Karten",
  "geozone-tiles": "Geozonen (offline)",
  "geozones-direct": "Geozonen (Import)",
  obstacles: "Hindernisse",
  offline: "Offline-Pakete",
  documents: "Dokumente",
  // fileCache.ts: re-fetchbare Abrufe (dipul-Layer, Wetter/NOTAM-Stände …), früher in AsyncStorage
  "kv-cache": "Zwischenspeicher (Abrufe)",
  // userBlobs.ts: ausgelagerte Karten-Snapshots aus Flug-Sessions und Logbuch
  "user-blobs": "Karten-Snapshots (Flüge)",
};

/** UTF-8-Länge eines Strings in Byte (ohne TextEncoder, Ersatzpaare = 4 Byte). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2).replace(".", ",")} GB`;
}

/** Liest jeden Eintrag einzeln – ein zu großer Wert verdirbt nicht die Summe. */
export async function measureKeyValueStore(store: KeyValueStore): Promise<KeyValueUsage> {
  let keys: readonly string[] = [];
  try {
    keys = await store.getAllKeys();
  } catch {
    return { keys: 0, bytes: 0, unreadable: 0 };
  }
  let bytes = 0;
  let unreadable = 0;
  for (const key of keys) {
    bytes += utf8Length(key);
    try {
      const v = await store.getItem(key);
      if (v != null) bytes += utf8Length(v);
    } catch {
      unreadable++;
    }
  }
  return { keys: keys.length, bytes, unreadable };
}

/**
 * Größe von documentDirectory, aufgeteilt nach den Verzeichnissen der ersten
 * Ebene. getInfoAsync liefert für Ordner auf Android die rekursive Summe.
 */
export async function measureDocumentDirectory(fs: FileStore, root: string | null | undefined): Promise<FileUsage> {
  if (!root) return { bytes: 0, parts: [] };
  const base = root.endsWith("/") ? root : `${root}/`;
  let names: string[] = [];
  try {
    names = await fs.readDirectoryAsync(base);
  } catch {
    return { bytes: 0, parts: [] };
  }
  const parts: FileUsagePart[] = [];
  let other = 0;
  for (const name of names) {
    let size = 0;
    try {
      const info = await fs.getInfoAsync(`${base}${name}`);
      size = info.exists && typeof info.size === "number" && Number.isFinite(info.size) ? info.size : 0;
    } catch {
      size = 0;
    }
    const label = KNOWN_DIRECTORIES[name];
    if (label) parts.push({ name, label, bytes: size });
    else other += size;
  }
  if (other > 0) parts.push({ name: "", label: "Sonstige Dateien", bytes: other });
  parts.sort((a, b) => b.bytes - a.bytes);
  return { bytes: parts.reduce((sum, p) => sum + p.bytes, 0), parts };
}
