import { File } from "expo-file-system";
import { apiJson } from "./api-client";

/**
 * Client-Helfer für den Direkt-Upload vertraulicher Dokumente ins Replit
 * Object Storage.
 *
 * Ablauf:
 * 1. `POST /api/objects/upload` (mit Session-Cookie via apiJson) → Presigned-URL.
 * 2. `PUT` der Datei DIREKT an die Presigned-URL (Gerät → Bucket, umgeht das
 *    Proxy-Größenlimit, das beim base64-Speichern 500er auslöste).
 * 3. `POST /api/objects/finalize` → setzt die ACL (Eigentümer = Pilot, privat)
 *    und liefert den normalisierten `/objects/...`-Pfad, der im Profil landet.
 *
 * Die File-Klasse aus expo-file-system implementiert Blob und kann direkt als
 * fetch-Body übergeben werden (siehe Expo-FileSystem-Doku).
 */
export async function uploadDocumentToStorage(
  uri: string,
  mimeType: string,
): Promise<string> {
  const { uploadURL } = await apiJson<{ uploadURL: string }>("/api/objects/upload", {
    method: "POST",
  });
  if (!uploadURL) {
    throw new Error("Keine Upload-URL vom Server erhalten");
  }

  const file = new File(uri);
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file as unknown as BodyInit,
    headers: { "Content-Type": mimeType || "application/octet-stream" },
  });
  if (!putRes.ok) {
    throw new Error(`Upload fehlgeschlagen (Status ${putRes.status})`);
  }

  const { objectPath } = await apiJson<{ objectPath: string }>("/api/objects/finalize", {
    method: "POST",
    body: { uploadURL },
  });
  if (!objectPath) {
    throw new Error("Dokument-Pfad konnte nicht ermittelt werden");
  }
  return objectPath;
}
