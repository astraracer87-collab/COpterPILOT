import * as FileSystem from "expo-file-system/legacy";
import type { DocumentRefJson } from "../../shared/schema";

/**
 * Lokale Dokumentablage (Ersatz für den früheren Upload ins Object Storage).
 *
 * - Kleine Dateien (≤ INLINE_MAX_BYTES = 16 KB) werden base64-codiert direkt im
 *   Dokument-Verweis gespeichert (`dataBase64`).
 * - Größere Dateien werden ins App-Dokumentenverzeichnis kopiert und über
 *   `objectPath = "local:documents/<datei>"` referenziert – AsyncStorage
 *   (Android: ~2 MB pro Eintrag) ist für große base64-Blobs ungeeignet.
 *   Der Pfad ist relativ zum Dokumentenverzeichnis, damit er App-Updates
 *   übersteht.
 */
export const LOCAL_OBJECT_PREFIX = "local:";
const LOCAL_DOCS_SUBDIR = "documents/";
// Bewusst klein: Inline-Dokumente landen im JSON von @preflight/pilot_profile
// bzw. @preflight/drones. Mehrere große base64-Dokumente sprengen dort das
// Android-CursorWindow (~2 MB pro Wert) → der Wert ist nicht mehr lesbar.
export const INLINE_MAX_BYTES = 16 * 1024;

export function isLocalObjectPath(p: string | undefined | null): p is string {
  return typeof p === "string" && p.startsWith(LOCAL_OBJECT_PREFIX);
}

/** Absoluter `file://`-Pfad zu einem `local:`-Verweis. */
export function resolveLocalObjectPath(p: string): string {
  const rel = p.slice(LOCAL_OBJECT_PREFIX.length).replace(/^\/+/, "");
  if (rel.includes("..")) throw new Error("Ungültiger Dokument-Verweis");
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error("Kein Dokumentenverzeichnis verfügbar");
  return `${base}${rel}`;
}

async function ensureDocsDir(): Promise<string> {
  const base = FileSystem.documentDirectory;
  if (!base) throw new Error("Kein Dokumentenverzeichnis verfügbar");
  const dir = `${base}${LOCAL_DOCS_SUBDIR}`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/**
 * Speichert eine (z. B. vom DocumentPicker gelieferte) Datei lokal und liefert
 * den fertigen Dokument-Verweis zurück.
 */
export async function uploadDocumentToStorage(
  uri: string,
  mimeType: string,
  fileName = "dokument",
  sizeBytes = 0,
): Promise<DocumentRefJson> {
  let size = sizeBytes;
  if (!size) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && typeof (info as { size?: number }).size === "number") {
        size = (info as { size: number }).size;
      }
    } catch {
      // Größe unbekannt → unten base64-Länge
    }
  }
  const base = {
    fileName,
    mimeType: mimeType || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  };

  // Ohne Dokumentenverzeichnis (Web) bleibt nur inline.
  const canUseFiles = !!FileSystem.documentDirectory;
  // Größe unbekannt → lieber als Datei (sicher für AsyncStorage).
  if (canUseFiles && (size <= 0 || size > INLINE_MAX_BYTES)) {
    const dir = await ensureDocsDir();
    const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "_") || "dokument";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    await FileSystem.copyAsync({ from: uri, to: `${dir}${unique}` });
    let storedSize = size;
    if (!storedSize) {
      try {
        const info = await FileSystem.getInfoAsync(`${dir}${unique}`);
        if (info.exists && typeof (info as { size?: number }).size === "number") {
          storedSize = (info as { size: number }).size;
        }
      } catch {
        // Größe bleibt unbekannt
      }
    }
    return { ...base, sizeBytes: storedSize, objectPath: `${LOCAL_OBJECT_PREFIX}${LOCAL_DOCS_SUBDIR}${unique}` };
  }

  const dataBase64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return {
    ...base,
    sizeBytes: size || Math.ceil((dataBase64.length * 3) / 4),
    dataBase64,
  };
}

/** Entfernt eine lokal abgelegte Dokumentdatei (best-effort). */
export async function deleteLocalDocument(objectPath: string | undefined | null): Promise<void> {
  if (!isLocalObjectPath(objectPath)) return;
  try {
    await FileSystem.deleteAsync(resolveLocalObjectPath(objectPath), { idempotent: true });
  } catch {
    // best-effort
  }
}
