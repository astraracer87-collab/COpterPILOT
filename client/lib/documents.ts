import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";
import { isLoggedInSync } from "./auth";
import { getSessionCookie } from "./api-client";
import { getApiUrl } from "./query-client";
import { uploadDocumentToStorage } from "./objectStorage";

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;

export interface DocumentRef {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  /**
   * Verweis auf das private Objekt im Replit Object Storage
   * (`/objects/...`). Neue Uploads (eingeloggt) nutzen diesen Pfad — das
   * Dokument liegt dann NICHT mehr base64-codiert im Profil-Datensatz, was
   * das 500er-Limit beim Speichern umgeht.
   */
  objectPath?: string;
  /**
   * Legacy: base64-codiertes PDF/Bild. Wird weiterhin gelesen (Altdaten,
   * Offline-Modus ohne Login), aber für neue Uploads im Online-Modus nicht
   * mehr verwendet.
   */
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

/**
 * Ein gültiger Object-Storage-Verweis ist immer ein relativer Pfad unter
 * `/objects/`. Diese Prüfung verhindert, dass ein manipulierter `objectPath`
 * (z.B. eine absolute externe URL) beim Download den Session-Cookie an einen
 * fremden Host schickt.
 */
function isStorageObjectPath(p: string | undefined): p is string {
  return typeof p === "string" && p.startsWith("/objects/");
}

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

  // Online (eingeloggt): Direkt-Upload ins Object Storage — kleines Ref im
  // Profil, kein base64. Offline: base64-Fallback (lokal in AsyncStorage).
  if (isLoggedInSync()) {
    const objectPath = await uploadDocumentToStorage(asset.uri, mimeType);
    return {
      fileName,
      mimeType,
      sizeBytes: sizeBytes || 0,
      uploadedAt: new Date().toISOString(),
      objectPath,
    };
  }

  const dataBase64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  // Zweite Sicherungslinie: base64 ist ~4/3 der Rohgröße.
  const decodedBytes = Math.ceil((dataBase64.length * 3) / 4);
  if (decodedBytes > MAX_DOCUMENT_BYTES) {
    Alert.alert(
      "Datei zu groß",
      `Maximal ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB erlaubt (gewählt: ${(decodedBytes / 1024 / 1024).toFixed(1)} MB).`,
    );
    return null;
  }
  if (!sizeBytes) sizeBytes = decodedBytes;
  return {
    fileName,
    mimeType,
    sizeBytes,
    uploadedAt: new Date().toISOString(),
    dataBase64,
  };
}

/**
 * Materialisiert ein Dokument als lokale Datei im Cache und liefert deren
 * `file://`-Pfad zurück. Quelle ist entweder das Object Storage (objectPath,
 * via authentifiziertem Download) oder das Legacy-base64-Feld.
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

  if (doc.objectPath) {
    if (!isStorageObjectPath(doc.objectPath)) {
      throw new Error("Ungültiger Dokument-Verweis");
    }
    const url = new URL(doc.objectPath, getApiUrl()).toString();
    const cookie = await getSessionCookie();
    const result = await FileSystem.downloadAsync(url, path, {
      headers: cookie ? { Cookie: cookie } : undefined,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Dokument konnte nicht geladen werden (Status ${result.status})`);
    }
    return result.uri;
  }

  if (doc.dataBase64) {
    await FileSystem.writeAsStringAsync(path, doc.dataBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  }

  throw new Error("Dokument enthält keine Daten");
}

/**
 * Liefert eine im Web nutzbare URL (data: für base64, Blob-URL für
 * Object-Storage-Refs via authentifiziertem fetch).
 */
export async function getWebPreviewUrl(doc: DocumentRef): Promise<string> {
  if (doc.dataBase64) {
    return `data:${doc.mimeType};base64,${doc.dataBase64}`;
  }
  if (doc.objectPath) {
    if (!isStorageObjectPath(doc.objectPath)) {
      throw new Error("Ungültiger Dokument-Verweis");
    }
    const url = new URL(doc.objectPath, getApiUrl()).toString();
    const cookie = await getSessionCookie();
    const res = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : undefined,
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Dokument konnte nicht geladen werden (Status ${res.status})`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
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
