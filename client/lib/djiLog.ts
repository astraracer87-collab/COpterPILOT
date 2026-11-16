import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkpoint } from "../../shared/yieldingWork";
import {
  createLogbookEntry,
  getDrones,
  getEntryDjiLogs,
  getLogbook,
  getLogbookEntry,
  updateDrone,
  attachDjiLogToEntry,
  type DroneProfile,
  type LogbookEntry,
} from "./storage";
import type {
  DjiAnalyzeResult,
  DjiBulkError,
  DjiBulkProgress,
  DjiBulkResult,
  DjiLogMeta,
} from "./djiLogCore";
import {
  analyzeDjiLogSource,
  type DjiAnalyzePhase,
  type DjiLogSource,
} from "./djiLogAnalyzer";
import { djiLogWorkerHub } from "./djiLogWorkerHub";
import { getDjiApiKey } from "./djiApiKeyStore";
import { fetchDjiKeychains } from "./djiKeychainApi";
import {
  getCachedKeychains,
  removeCachedKeychains,
  setCachedKeychains,
} from "./djiKeychainCache";
import { DJI_CHUNK_BYTES } from "./djiLogWorkerProtocol";
import { findDroneForLog, linkBatteryForLog } from "./djiBatteryLink";
import { logbookEntryFromDjiLog } from "./djiLogMapping";

export { logbookEntryFromDjiLog };

// RN-freie Kernlogik (Typen, Konstanten, reine Auswerte-/Gruppierungs-Funktionen)
// lebt in ./djiLogCore und wird hier re-exportiert.
export * from "./djiLogCore";

/**
 * DJI-Flugprotokolle werden vollständig auf dem Gerät ausgewertet:
 * dji-log-parser (WebAssembly) in einer versteckten WebView
 * (DjiLogWorkerHost), Schlüssel für verschlüsselte Logs (ab v13) direkt von
 * DJI (API-Schlüssel des Piloten, nur im SecureStore) und pro Log gecacht.
 */

const FOLDER_URI_KEY = "@copterpilot/djiFlightRecordFolderUri";

/** DJI Fly legt die Protokolle hier ab (Android 11 sperrt Android/data teilweise). */
export const DJI_FLY_FLIGHTRECORD_DOC_URI =
  "content://com.android.externalstorage.documents/document/primary%3AAndroid%2Fdata%2Fdji.go.v5%2Ffiles%2FFlightRecord";
/** Empfohlene Ablage, wenn Android/data gesperrt ist (Kopie per PC/USB). */
export const DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI =
  "content://com.android.externalstorage.documents/document/primary%3ADownload%2FFlightRecords";

export type DjiAnalyzeProgress = (
  phase: DjiAnalyzePhase,
  fraction?: number,
) => void;

interface PickedFile {
  uri: string;
  name: string;
  size?: number;
  /** temporäre Kopie (Cache) → nach der Auswertung löschen */
  temporary?: boolean;
}

function looksLikeDat(name: string): boolean {
  return /\.dat$/i.test(name);
}

function fileSource(file: PickedFile): DjiLogSource {
  let ended = false;
  return {
    fileName: file.name,
    sizeBytes: file.size,
    async readChunk(index: number) {
      if (ended) return null;
      const position = index * DJI_CHUNK_BYTES;
      if (file.size != null && file.size > 0 && position >= file.size)
        return null;
      const data = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
        position,
        length: DJI_CHUNK_BYTES,
      });
      if (!data) return null;
      // kürzeres Stück = Dateiende
      if (data.length < Math.ceil(DJI_CHUNK_BYTES / 3) * 4) ended = true;
      return data;
    },
  };
}

async function cleanup(file: PickedFile): Promise<void> {
  if (!file.temporary) return;
  await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
}

async function analyzeWith(
  file: PickedFile,
  worker: Awaited<ReturnType<typeof djiLogWorkerHub.acquire>>,
  onPhase?: DjiAnalyzeProgress,
): Promise<DjiAnalyzeResult> {
  if (looksLikeDat(file.name)) {
    throw new Error(
      "…DAT-Dateien werden nicht unterstützt – bitte die „DJIFlightRecord_….txt“ wählen.",
    );
  }
  return analyzeDjiLogSource(fileSource(file), {
    worker,
    getApiKey: getDjiApiKey,
    fetchKeychains: (apiKey, request) => fetchDjiKeychains(apiKey, request),
    cache: {
      get: getCachedKeychains,
      set: setCachedKeychains,
      remove: removeCachedKeychains,
    },
    onPhase,
    checkpoint: () => checkpoint("dji-log"),
  });
}

/** Eine Datei (z. B. aus dem Picker) auswerten. */
export async function analyzeDjiLogFile(
  file: PickedFile,
  onPhase?: DjiAnalyzeProgress,
): Promise<DjiAnalyzeResult> {
  const worker = await djiLogWorkerHub.acquire();
  try {
    return await analyzeWith(file, worker, onPhase);
  } finally {
    djiLogWorkerHub.releaseClient();
    await cleanup(file);
  }
}

async function pickFiles(multiple: boolean): Promise<PickedFile[] | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["text/plain", "application/octet-stream", "*/*"],
    copyToCacheDirectory: true,
    multiple,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  return res.assets.map((a, i) => ({
    uri: a.uri,
    name: a.name || `flugprotokoll-${i + 1}.txt`,
    size: a.size ?? undefined,
    temporary: true,
  }));
}

/**
 * Lässt den Piloten ein DJI-Protokoll wählen und wertet es aus (ohne zu
 * speichern). `null` bei Abbruch.
 */
export async function pickAndAnalyzeDjiLog(
  onPhase?: DjiAnalyzeProgress,
): Promise<DjiAnalyzeResult | null> {
  const files = await pickFiles(false);
  if (!files) return null;
  return analyzeDjiLogFile(files[0], onPhase);
}

/**
 * Mehrere Dateien nacheinander auswerten (eine WebView für alle, zwischen den
 * Dateien an die UI abgeben). Fehlerhafte Einzeldateien werden gesammelt.
 */
export async function analyzeDjiLogFiles(
  files: PickedFile[],
  onProgress?: (p: DjiBulkProgress) => void,
): Promise<DjiBulkResult> {
  const results: DjiAnalyzeResult[] = [];
  const errors: DjiBulkError[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress?.({ done: i, total: files.length, fileName: f.name });
    try {
      // je Datei anmelden: die WebView bleibt dazwischen bestehen; stürzt sie
      // ab (Speicher), läuft die nächste Datei in einer neu gestarteten weiter.
      const worker = await djiLogWorkerHub.acquire();
      try {
        results.push(await analyzeWith(f, worker));
      } finally {
        djiLogWorkerHub.releaseClient();
      }
    } catch (e) {
      errors.push({
        fileName: f.name,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      await cleanup(f);
    }
    onProgress?.({ done: i + 1, total: files.length, fileName: f.name });
    await checkpoint("dji-bulk");
  }
  return { results, errors };
}

export async function pickAndAnalyzeMultipleDjiLogs(
  onProgress?: (p: DjiBulkProgress) => void,
): Promise<DjiBulkResult | null> {
  const files = await pickFiles(true);
  if (!files) return null;
  return analyzeDjiLogFiles(files, onProgress);
}

// ---------------------------------------------------------------------------
// Ordner (Storage Access Framework, Android)
// ---------------------------------------------------------------------------

export function isFolderImportSupported(): boolean {
  return Platform.OS === "android";
}

export async function getSavedDjiLogFolder(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(FOLDER_URI_KEY)) || null;
  } catch {
    return null;
  }
}

export async function forgetDjiLogFolder(): Promise<void> {
  await AsyncStorage.removeItem(FOLDER_URI_KEY).catch(() => {});
}

/** Lesbarer Ordnername aus einer SAF-URI ("primary:Download/FlightRecords" → "Download/FlightRecords"). */
export function folderLabelFromUri(uri: string): string {
  try {
    const m = uri.match(/\/tree\/([^/]+)/);
    const raw = decodeURIComponent(m ? m[1] : uri);
    return raw.replace(/^primary:/, "") || "Interner Speicher";
  } catch {
    return uri;
  }
}

export function fileNameFromSafUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri);
    const last = decoded.split("/").pop() ?? decoded;
    return last.replace(/^.*:/, "") || "flugprotokoll.txt";
  } catch {
    return uri.split("%2F").pop() || "flugprotokoll.txt";
  }
}

/** Nur DJI-Textprotokolle eines Ordners (DJIFlightRecord_*.txt bevorzugt). */
export function filterDjiLogNames<T extends { name: string }>(items: T[]): T[] {
  const txt = items.filter((f) => /\.txt$/i.test(f.name));
  const djiNamed = txt.filter((f) => /flightrecord/i.test(f.name));
  return (djiNamed.length > 0 ? djiNamed : txt).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Ordner wählen und Freigabe dauerhaft merken. `initial`: wo der
 * Systemdialog startet (DJI-Fly-Ordner oder Download/FlightRecords).
 * Liefert null, wenn abgebrochen oder von Android verweigert.
 */
export async function chooseDjiLogFolder(
  initial: "djiFly" | "download" = "djiFly",
): Promise<string | null> {
  if (!isFolderImportSupported()) return null;
  const start =
    initial === "djiFly"
      ? DJI_FLY_FLIGHTRECORD_DOC_URI
      : DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI;
  const res =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
      start,
    );
  if (!res.granted) return null;
  await AsyncStorage.setItem(FOLDER_URI_KEY, res.directoryUri).catch(() => {});
  return res.directoryUri;
}

export async function listDjiLogsInFolder(
  folderUri: string,
): Promise<PickedFile[]> {
  let children: string[];
  try {
    children =
      await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
  } catch {
    throw new Error(
      "Der Ordner ist nicht (mehr) lesbar. Bitte den Ordner erneut wählen – Android gibt Android/data teils nicht frei (siehe Hilfe).",
    );
  }
  return filterDjiLogNames(
    children.map((uri) => ({ uri, name: fileNameFromSafUri(uri) })),
  );
}

export interface DjiFolderImportResult extends DjiBulkResult {
  /** bereits im Logbuch vorhandene Dateien (übersprungen) */
  skippedKnown: number;
  folderLabel: string;
}

/**
 * Alle Protokolle eines (gemerkten) Ordners auswerten. Dateien, die schon
 * einem Flug zugeordnet sind (gleicher Dateiname), werden übersprungen.
 */
export async function analyzeDjiLogFolder(
  folderUri: string,
  onProgress?: (p: DjiBulkProgress) => void,
  opts: { includeKnown?: boolean } = {},
): Promise<DjiFolderImportResult> {
  const files = await listDjiLogsInFolder(folderUri);
  let todo = files;
  if (!opts.includeKnown) {
    const known = new Set<string>();
    for (const e of await getLogbook().catch(() => [] as LogbookEntry[])) {
      for (const l of getEntryDjiLogs(e))
        if (l.status === "parsed") known.add(l.fileName.toLowerCase());
    }
    todo = files.filter((f) => !known.has(f.name.toLowerCase()));
  }
  const res = await analyzeDjiLogFiles(todo, onProgress);
  return {
    ...res,
    skippedKnown: files.length - todo.length,
    folderLabel: folderLabelFromUri(folderUri),
  };
}

// ---------------------------------------------------------------------------
// Zuordnung zu Flügen + Akku-Verknüpfung
// ---------------------------------------------------------------------------

/** Drohne finden, Akku verknüpfen/anlegen, Zyklen übernehmen. Liefert das ergänzte Log. */
async function linkDroneAndBattery(
  meta: DjiLogMeta,
  preferredDroneId?: string,
): Promise<{ meta: DjiLogMeta; drone: DroneProfile | null }> {
  let drones: DroneProfile[] = [];
  try {
    drones = await getDrones({ includeArchived: true });
  } catch {
    return { meta, drone: null };
  }
  const drone =
    (preferredDroneId
      ? drones.find((d) => d.id === preferredDroneId)
      : undefined) ?? findDroneForLog(drones, meta);
  if (!drone) return { meta, drone: null };
  const link = linkBatteryForLog(drone, meta);
  if (link.updatedDrone) {
    try {
      await updateDrone(drone.id, {
        batteries: link.updatedDrone.batteries,
        serialNumber: link.updatedDrone.serialNumber,
      });
    } catch {
      // Verknüpfung im Log bleibt trotzdem erhalten
    }
  }
  const linked = link.batteryId
    ? { ...meta, batteryId: link.batteryId, batteryLabel: link.batteryLabel }
    : meta;
  return { meta: linked, drone: link.updatedDrone ?? drone };
}

/**
 * Ordnet eine Auswertung einem Flug zu: bestehender Eintrag (Log anhängen)
 * oder neuer Eintrag. Verknüpft dabei Drohne (Seriennummer) und Akku.
 */
export async function assignDjiLog(params: {
  meta: DjiLogMeta;
  target: "existing" | "new";
  entryId?: string;
}): Promise<LogbookEntry> {
  const { meta, target, entryId } = params;
  if (target === "existing") {
    if (!entryId) throw new Error("Kein Flug ausgewählt.");
    const entry = await getLogbookEntry(entryId);
    if (!entry) throw new Error("Der Flug wurde nicht gefunden.");
    const { meta: linked } = await linkDroneAndBattery(
      meta,
      entry.droneId || undefined,
    );
    const updated = await attachDjiLogToEntry(entryId, linked);
    if (!updated) throw new Error("Der Flug wurde nicht gefunden.");
    return updated;
  }
  const { meta: linked, drone } = await linkDroneAndBattery(meta);
  return createLogbookEntry(logbookEntryFromDjiLog(linked, drone));
}

/**
 * Ein Protokoll wählen, auswerten und direkt an einen Logbuch-Eintrag hängen.
 * `null` bei Abbruch.
 */
export async function pickAndUploadDjiLog(
  entryId: string,
  onPhase?: DjiAnalyzeProgress,
): Promise<LogbookEntry | null> {
  const res = await pickAndAnalyzeDjiLog(onPhase);
  if (!res) return null;
  return assignDjiLog({ meta: res.meta, target: "existing", entryId });
}
