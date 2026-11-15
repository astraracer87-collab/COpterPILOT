// Kleiner Dateisystem-Adapter für die Datei-Speicher der App (fileCache.ts:
// re-fetchbare Caches, userBlobs.ts: große Felder der Nutzerdaten).
//
// RN-frei: expo-file-system wird erst bei Bedarf per require geladen, damit
// die Logik unter tsx/Node testbar bleibt (Tests setzen einen eigenen Adapter).
//
// Hintergrund: AsyncStorage ist auf Android eine SQLite-Datenbank (Standard
// 6 MB, einzelne Werte > ~2 MB lassen sich wegen des CursorWindow nicht mehr
// lesen). Große Daten gehören deshalb in Dateien unter documentDirectory.

export interface SimpleFileInfo {
  exists: boolean;
  size?: number;
  /** Letzte Änderung in ms seit Epoch (falls bekannt). */
  mtimeMs?: number;
}

export interface SimpleFs {
  /** documentDirectory mit abschließendem "/" – null, wenn es keins gibt (Web). */
  root: string | null;
  /** Inhalt oder null, wenn die Datei fehlt. */
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  /** Verschieben; ein vorhandenes Ziel wird ersetzt. */
  move(from: string, to: string): Promise<void>;
  /** Löschen (Datei oder Ordner), idempotent. */
  remove(path: string): Promise<void>;
  /** Namen im Ordner ([] wenn er fehlt). */
  list(dir: string): Promise<string[]>;
  mkdirp(dir: string): Promise<void>;
  info(path: string): Promise<SimpleFileInfo>;
}

let override: SimpleFs | null | undefined;
let lazy: SimpleFs | null | undefined;

function createExpoFs(): SimpleFs | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FS = require("expo-file-system/legacy");
    const root: string | null = FS?.documentDirectory ?? null;
    if (!root) return null;
    return {
      root: root.endsWith("/") ? root : `${root}/`,
      async readText(path) {
        const info = await FS.getInfoAsync(path);
        if (!info.exists) return null;
        return FS.readAsStringAsync(path);
      },
      async writeText(path, text) {
        await FS.writeAsStringAsync(path, text);
      },
      async move(from, to) {
        // Android: File.renameTo ersetzt das Ziel atomar. Rückfall für
        // Plattformen, die ein vorhandenes Ziel ablehnen.
        try {
          await FS.moveAsync({ from, to });
        } catch {
          await FS.deleteAsync(to, { idempotent: true });
          await FS.moveAsync({ from, to });
        }
      },
      async remove(path) {
        await FS.deleteAsync(path, { idempotent: true });
      },
      async list(dir) {
        try {
          const info = await FS.getInfoAsync(dir);
          if (!info.exists) return [];
          return await FS.readDirectoryAsync(dir);
        } catch {
          return [];
        }
      },
      async mkdirp(dir) {
        const info = await FS.getInfoAsync(dir);
        if (!info.exists)
          await FS.makeDirectoryAsync(dir, { intermediates: true });
      },
      async info(path) {
        const info = await FS.getInfoAsync(path, { size: true });
        if (!info.exists) return { exists: false };
        return {
          exists: true,
          size: typeof info.size === "number" ? info.size : undefined,
          mtimeMs:
            typeof info.modificationTime === "number"
              ? info.modificationTime * 1000
              : undefined,
        };
      },
    };
  } catch {
    return null;
  }
}

/** Adapter des Geräts (oder null im Web / ohne documentDirectory). */
export function getSimpleFs(): SimpleFs | null {
  if (override !== undefined) return override;
  if (lazy !== undefined) return lazy;
  lazy = createExpoFs();
  return lazy;
}

/** Nur für Tests: Adapter ersetzen (null = keiner, undefined = Standard). */
export function __setSimpleFsForTests(fs: SimpleFs | null | undefined): void {
  override = fs;
}

function parentDir(path: string): string {
  return path.replace(/[^/]+$/, "");
}

let tmpCounter = 0;

/**
 * Atomar schreiben: erst in eine temporäre Datei, dann verschieben. Ein
 * Abbruch mittendrin hinterlässt nie eine halb geschriebene Zieldatei.
 */
export async function writeTextAtomic(
  fs: SimpleFs,
  path: string,
  text: string,
): Promise<void> {
  await fs.mkdirp(parentDir(path)).catch(() => {});
  tmpCounter = (tmpCounter + 1) % 1_000_000;
  const tmp = `${path}.${Date.now()}-${tmpCounter}.tmp`;
  try {
    await fs.writeText(tmp, text);
    await fs.move(tmp, path);
  } catch (e) {
    await fs.remove(tmp).catch(() => {});
    throw e;
  }
}

/**
 * Dateinamen-sichere, umkehrbare Kodierung eines Schlüssels: Zeichen außerhalb
 * [A-Za-z0-9._-] werden als "~XXXX" (UTF-16-Codeeinheit, hex) geschrieben.
 */
export function encodeFileKey(key: string): string {
  let out = "";
  for (let i = 0; i < key.length; i++) {
    const ch = key[i];
    if (/[A-Za-z0-9._-]/.test(ch)) out += ch;
    else out += `~${key.charCodeAt(i).toString(16).padStart(4, "0")}`;
  }
  return out;
}

export function decodeFileKey(name: string): string {
  return name.replace(/~([0-9a-f]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}
