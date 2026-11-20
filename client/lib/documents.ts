import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";
import { isLocalObjectPath, resolveLocalObjectPath, uploadDocumentToStorage } from "./objectStorage";

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export interface DocumentRef {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  /**
   * Verweis auf eine lokal abgelegte Datei (`local:documents/...`, große
   * Dateien). Altdaten können noch Server-Pfade (`/objects/...`) enthalten –
   * diese sind ohne Backend nicht mehr abrufbar.
   */
  objectPath?: string;
  /** base64-codiertes PDF/Bild (kleine Dateien, direkt im Datensatz). */
  dataBase64?: string;
}

function inferMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

const SERVER_DOC_UNAVAILABLE =
  "Dieses Dokument lag auf dem früheren Server und ist in der RC-Version nicht mehr verfügbar. Bitte erneut hochladen.";

function extForMime(mime: string, fallbackName: string): string {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/heic") return ".heic";
  if (mime === "image/webp") return ".webp";
  const dot = fallbackName.lastIndexOf(".");
  return dot > 0 ? fallbackName.substring(dot) : "";
}

export async function pickDocument(): Promise<DocumentRef | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const asset = res.assets[0];
  let sizeBytes = asset.size ?? 0;
  if (!sizeBytes) {
    // Fallback wenn der Picker (z.B. iCloud-Datei) keine Größe meldet —
    // sonst würde ein 50 MB-PDF die Sperre umgehen.
    try {
      const info = await FileSystem.getInfoAsync(asset.uri);
      if (info.exists && typeof (info as any).size === "number") {
        sizeBytes = (info as any).size as number;
      }
    } catch {
      // ignore — wir fallen unten auf base64-Längen-Check zurück
    }
  }
  if (sizeBytes > MAX_DOCUMENT_BYTES) {
    Alert.alert(
      "Datei zu groß",
      `Maximal ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB erlaubt (gewählt: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Bitte PDF komprimieren oder Foto verkleinern.`,
    );
    return null;
  }

  const fileName = asset.name || `dokument${extForMime(asset.mimeType || "", "")}`;
  const mimeType = asset.mimeType || inferMimeFromName(fileName);

  // Lokal ablegen: kleine Dateien base64 im Datensatz, große als Datei im
  // Dokumentenverzeichnis (kein Server mehr).
  const ref = await uploadDocumentToStorage(asset.uri, mimeType, fileName, sizeBytes || 0);
  if (ref.sizeBytes > MAX_DOCUMENT_BYTES) {
    Alert.alert(
      "Datei zu groß",
      `Maximal ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB erlaubt (gewählt: ${(ref.sizeBytes / 1024 / 1024).toFixed(1)} MB).`,
    );
    return null;
  }
  return ref;
}

/**
 * Materialisiert ein Dokument als lokale Datei im Cache und liefert deren
 * `file://`-Pfad zurück. Quelle ist entweder eine lokal abgelegte Datei
 * (objectPath `local:...`) oder das base64-Feld.
 *
 * Wirft auf Web — dort wird stattdessen `getWebPreviewUrl` genutzt.
 */
export async function materializeDocument(doc: DocumentRef): Promise<string> {
  if (Platform.OS === "web") {
    throw new Error("materializeDocument ist auf Web nicht verfügbar");
  }
  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error("Kein Cache-Verzeichnis verfügbar");
  const safeName =
    doc.fileName.replace(/[^A-Za-z0-9._-]/g, "_") || `doc${extForMime(doc.mimeType, doc.fileName)}`;
  const path = `${dir}preflight-doc-${Date.now()}-${safeName}`;

  if (doc.dataBase64) {
    await FileSystem.writeAsStringAsync(path, doc.dataBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  }

  if (isLocalObjectPath(doc.objectPath)) {
    const src = resolveLocalObjectPath(doc.objectPath);
    const info = await FileSystem.getInfoAsync(src);
    if (!info.exists) throw new Error("Dokument-Datei wurde auf dem Gerät nicht gefunden");
    // Kopie mit sprechendem Dateinamen im Cache (für Teilen/Vorschau).
    await FileSystem.copyAsync({ from: src, to: path });
    return path;
  }

  if (doc.objectPath) {
    throw new Error(SERVER_DOC_UNAVAILABLE);
  }

  throw new Error("Dokument enthält keine Daten");
}

/**
 * Liefert eine im Web nutzbare URL (data:-URL aus base64 bzw. lokaler Datei).
 */
export async function getWebPreviewUrl(doc: DocumentRef): Promise<string> {
  if (doc.dataBase64) {
    return `data:${doc.mimeType};base64,${doc.dataBase64}`;
  }
  if (isLocalObjectPath(doc.objectPath)) {
    const b64 = await FileSystem.readAsStringAsync(resolveLocalObjectPath(doc.objectPath), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:${doc.mimeType};base64,${b64}`;
  }
  if (doc.objectPath) {
    throw new Error(SERVER_DOC_UNAVAILABLE);
  }
  throw new Error("Dokument enthält keine Daten");
}

/**
 * Schreibt das gespeicherte Dokument in eine temporäre Datei und öffnet den
 * System-Sharing-Dialog (iOS) bzw. Intent (Android).
 */
export async function viewDocument(doc: DocumentRef): Promise<void> {
  if (Platform.OS === "web") {
    Alert.alert("Nicht verfügbar", "Dokument-Vorschau bitte im Expo Go oder auf einem Gerät öffnen.");
    return;
  }
  const path = await materializeDocument(doc);
  if (Platform.OS === "android") {
    // Fernsteuerung: „Teilen“ hat keine Ziele → mit passender App öffnen
    // (z. B. Firefox für PDFs), sonst in einen Ordner speichern.
    try {
      const contentUri = await FileSystem.getContentUriAsync(path);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const IntentLauncher = require("expo-intent-launcher") as typeof import("expo-intent-launcher");
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: doc.mimeType,
      });
      return;
    } catch {
      const { saveToDevice } = require("./saveToDevice") as typeof import("./saveToDevice");
      const r = await saveToDevice({ fileName: doc.fileName, mimeType: doc.mimeType, srcUri: path });
      if (r.saved) Alert.alert("Gespeichert", `Keine App zum Öffnen gefunden – gespeichert unter: ${r.location}`);
      return;
    }
  }
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert("Nicht verfügbar", "Teilen/Öffnen wird auf diesem Gerät nicht unterstützt.");
    return;
  }
  await Sharing.shareAsync(path, {
    mimeType: doc.mimeType,
    UTI: doc.mimeType === "application/pdf" ? "com.adobe.pdf" : undefined,
    dialogTitle: doc.fileName,
  });
}

export function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
