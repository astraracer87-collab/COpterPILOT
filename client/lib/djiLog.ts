import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { apiJson } from "./api-client";
import type { LogbookEntry } from "./storage";
import { MAX_DJI_LOG_BYTES, type DjiAnalyzeResult, type DjiLogMeta, type DjiBulkProgress, type DjiBulkError, type DjiBulkResult } from "./djiLogCore";

// RN-freie Kernlogik (Typen, Konstanten, reine Auswerte-/Gruppierungs-Funktionen)
// lebt in ./djiLogCore und wird hier re-exportiert, damit das Web-Bundle (Vite)
// sie ohne Expo-/react-native-Abhängigkeit importieren kann.
export * from "./djiLogCore";

/**
 * Lädt den Inhalt einer lokalen Datei per Presigned-PUT ins Object Storage.
 *
 * WICHTIG: Die `File`-Instanz aus `expo-file-system` ist KEIN Blob und kann
 * nicht direkt als `fetch`-Body übergeben werden — auf nativem iOS/Android
 * würde dabei nicht der Dateiinhalt, sondern eine kaputte Serialisierung
 * hochgeladen (der Server erhält Müll, der Parser lehnt die Datei als
 * „kein gültiges DJI-Flugprotokoll“ ab). Deshalb lesen wir die echten Bytes
 * (`file.bytes()`) und senden sie über `expo/fetch`, das `Uint8Array`-Bodies
 * korrekt überträgt.
 */
async function putFileToPresignedUrl(uploadURL: string, fileUri: string): Promise<void> {
  const file = new File(fileUri);
  const bytes = await file.bytes();
  if (bytes.length === 0) {
    throw new Error("Datei ist leer.");
  }
  if (bytes.length > MAX_DJI_LOG_BYTES) {
    throw new Error("Datei ist zu groß (max. 15 MB).");
  }
  const putRes = await expoFetch(uploadURL, {
    method: "PUT",
    body: bytes,
    headers: { "Content-Type": "text/plain" },
  });
  if (!putRes.ok) throw new Error(`Upload fehlgeschlagen (Status ${putRes.status})`);
}

/**
 * Lässt den Piloten ein DJI-Controller-Flugprotokoll (.txt aus DJI
 * Fly/GO/Pilot) auswählen, lädt es per Presigned-PUT direkt ins Object
 * Storage und stößt die serverseitige Auswertung an
 * (`POST /api/logbook/:id/dji-log`). Der Server setzt die ACL, parst die
 * Datei (GPS-Track, Höhe, Dauer, Akku) und liefert den aktualisierten
 * Eintrag zurück. Erfordert Login (Session-Cookie via apiJson).
 *
 * Rückgabe: aktualisierter Eintrag, oder `null` wenn der Picker abgebrochen
 * wurde.
 */
export async function pickAndUploadDjiLog(entryId: string): Promise<LogbookEntry | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["text/plain", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const asset = res.assets[0];

  const sizeBytes = asset.size ?? undefined;
  if (sizeBytes != null && sizeBytes > MAX_DJI_LOG_BYTES) {
    throw new Error("Datei ist zu groß (max. 15 MB).");
  }

  const { uploadURL } = await apiJson<{ uploadURL: string }>("/api/objects/upload", {
    method: "POST",
  });
  if (!uploadURL) throw new Error("Keine Upload-URL vom Server erhalten");

  await putFileToPresignedUrl(uploadURL, asset.uri);

  const updated = await apiJson<LogbookEntry>(
    `/api/logbook/${encodeURIComponent(entryId)}/dji-log`,
    {
      method: "POST",
      body: { uploadURL, fileName: asset.name || "flugprotokoll.txt", sizeBytes },
    },
  );
  return updated;
}

/**
 * Lässt den Piloten ein DJI-Protokoll auswählen, lädt es hoch und stößt die
 * eigenständige Auswertung an (`POST /api/dji-log/analyze`). Liefert
 * Kennzahlen + GPS-Track OHNE Datenbank-Schreibvorgang zurück. Die Auswertung
 * wird erst durch `assignDjiLog()` dauerhaft gespeichert.
 *
 * Rückgabe: Auswertungsergebnis, oder `null` wenn der Picker abgebrochen wurde.
 */
async function uploadAndAnalyzeAsset(asset: {
  uri: string;
  name?: string | null;
  size?: number | null;
}): Promise<DjiAnalyzeResult> {
  const sizeBytes = asset.size ?? undefined;
  if (sizeBytes != null && sizeBytes > MAX_DJI_LOG_BYTES) {
    throw new Error("Datei ist zu groß (max. 15 MB).");
  }
  const { uploadURL } = await apiJson<{ uploadURL: string }>("/api/objects/upload", {
    method: "POST",
  });
  if (!uploadURL) throw new Error("Keine Upload-URL vom Server erhalten");
  await putFileToPresignedUrl(uploadURL, asset.uri);
  return apiJson<DjiAnalyzeResult>("/api/dji-log/analyze", {
    method: "POST",
    body: { uploadURL, fileName: asset.name || "flugprotokoll.txt", sizeBytes },
  });
}

export async function pickAndAnalyzeDjiLog(): Promise<DjiAnalyzeResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["text/plain", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  return uploadAndAnalyzeAsset(res.assets[0]);
}

/**
 * Lässt den Piloten MEHRERE DJI-Protokolle auf einmal auswählen, lädt sie der
 * Reihe nach hoch und wertet sie aus (`/api/dji-log/analyze`, kein DB-Schreiben).
 * Fehlerhafte Einzeldateien brechen den Lauf nicht ab, sondern werden gesammelt.
 */
export async function pickAndAnalyzeMultipleDjiLogs(
  onProgress?: (p: DjiBulkProgress) => void,
): Promise<DjiBulkResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["text/plain", "*/*"],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;

  const assets = res.assets;
  const results: DjiAnalyzeResult[] = [];
  const errors: DjiBulkError[] = [];

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    const fileName = asset.name || `Datei ${i + 1}`;
    onProgress?.({ done: i, total: assets.length, fileName });
    try {
      results.push(await uploadAndAnalyzeAsset(asset));
    } catch (e) {
      errors.push({ fileName, error: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.({ done: i + 1, total: assets.length, fileName });
  }

  return { results, errors };
}

/**
 * Ordnet eine zuvor mit `pickAndAnalyzeDjiLog()` erstellte Auswertung einem
 * Flug zu (`POST /api/dji-log/assign`). Bei `target: "existing"` wird der
 * bestehende Logbucheintrag aktualisiert; bei `target: "new"` wird ein neuer
 * Eintrag erstellt. Erst hierbei wird die Auswertung dauerhaft gespeichert.
 */
export async function assignDjiLog(params: {
  meta: DjiLogMeta;
  target: "existing" | "new";
  entryId?: string;
}): Promise<LogbookEntry> {
  const { meta, target, entryId } = params;
  return apiJson<LogbookEntry>("/api/dji-log/assign", {
    method: "POST",
    body: {
      objectPath: meta.objectPath,
      fileName: meta.fileName,
      sizeBytes: meta.sizeBytes,
      target,
      entryId: target === "existing" ? entryId : undefined,
    },
  });
}
