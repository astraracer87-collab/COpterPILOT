/**
 * Gemerkter DJI-Protokoll-Ordner (SAF, Android): gemeinsame Helfer für
 * Logbuch (DjiBulkImportScreen) und Einstellungen (DjiLogFolderCard).
 * Gleicher AsyncStorage-Schlüssel überall → beide Stellen bleiben synchron.
 *
 * Optional („Neue Logs beim App-Start automatisch prüfen“): stille Prüfung
 * ohne Benachrichtigung; das Ergebnis erscheint nur als kleiner Hinweis im
 * Logbuch (getDjiLogNewHint / subscribeDjiLogNewHint).
 */
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getEntryDjiLogs, getLogbookLite, type LogbookEntry } from "./storage";
import {
  DJI_LOG_AUTO_CHECK_STORAGE_KEY,
  DJI_LOG_AUTO_IMPORT_STORAGE_KEY,
  DJI_LOG_FOLDER_STORAGE_KEY,
  checkDjiLogFolderAccessWith,
  suggestDjiFlyFolderUri,
  type DjiLogFolderAccess,
  type DjiLogFolderSuggestion,
} from "./djiLogFolderCore";

export * from "./djiLogFolderCore";

export function isFolderImportSupported(): boolean {
  return Platform.OS === "android";
}

// ---------------------------------------------------------------------------
// Gemerkter Ordner
// ---------------------------------------------------------------------------

type FolderListener = (uri: string | null) => void;
const folderListeners = new Set<FolderListener>();

/** Benachrichtigt, wenn der gemerkte Ordner gesetzt/entfernt wird. */
export function subscribeDjiLogFolder(fn: FolderListener): () => void {
  folderListeners.add(fn);
  return () => folderListeners.delete(fn);
}

function emitFolder(uri: string | null): void {
  for (const fn of [...folderListeners]) {
    try {
      fn(uri);
    } catch {}
  }
}

export async function getDjiLogFolder(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(DJI_LOG_FOLDER_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

export async function setDjiLogFolder(uri: string): Promise<void> {
  await AsyncStorage.setItem(DJI_LOG_FOLDER_STORAGE_KEY, uri).catch(() => {});
  emitFolder(uri);
}

export async function clearDjiLogFolder(): Promise<void> {
  await AsyncStorage.removeItem(DJI_LOG_FOLDER_STORAGE_KEY).catch(() => {});
  setNewHint(null);
  emitFolder(null);
}

/** Ältere Namen (Logbuch) – identisch zu getDjiLogFolder / clearDjiLogFolder. */
export const getSavedDjiLogFolder = getDjiLogFolder;
export const forgetDjiLogFolder = clearDjiLogFolder;

/**
 * SAF-Ordnerdialog öffnen (Start: DJI-Fly-Ordner bzw. Download/FlightRecords)
 * und die Freigabe dauerhaft merken. `null`, wenn abgebrochen oder von
 * Android verweigert (Android 11: „Android/data“ teils gesperrt).
 */
export async function chooseDjiLogFolder(
  initial: DjiLogFolderSuggestion = "djiFly",
): Promise<string | null> {
  if (!isFolderImportSupported()) return null;
  const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(
    suggestDjiFlyFolderUri(initial),
  );
  if (!res.granted) return null;
  await setDjiLogFolder(res.directoryUri);
  return res.directoryUri;
}

// ---------------------------------------------------------------------------
// Zugriff prüfen / zählen
// ---------------------------------------------------------------------------

/** Dateinamen aller schon ausgewerteten (im Logbuch hinterlegten) Protokolle (leichte Liste, keine Blob-Dateien). */
export async function knownDjiLogNames(): Promise<Set<string>> {
  const known = new Set<string>();
  for (const e of await getLogbookLite().catch(() => [] as LogbookEntry[])) {
    for (const l of getEntryDjiLogs(e)) if (l.status === "parsed") known.add(l.fileName.toLowerCase());
  }
  return known;
}

/** Freigabe noch gültig? Anzahl Protokolle und davon neue. */
export async function checkDjiLogFolderAccess(folderUri: string): Promise<DjiLogFolderAccess> {
  return checkDjiLogFolderAccessWith(folderUri, {
    readDirectory: (uri) => FileSystem.StorageAccessFramework.readDirectoryAsync(uri),
    knownLogNames: knownDjiLogNames,
  });
}

// ---------------------------------------------------------------------------
// Stille Prüfung beim App-Start → Hinweis im Logbuch
// ---------------------------------------------------------------------------

export async function getDjiLogAutoCheck(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DJI_LOG_AUTO_CHECK_STORAGE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setDjiLogAutoCheck(on: boolean): Promise<void> {
  await AsyncStorage.setItem(DJI_LOG_AUTO_CHECK_STORAGE_KEY, on ? "1" : "0").catch(() => {});
  if (!on) setNewHint(null);
}

export async function getDjiLogAutoImport(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DJI_LOG_AUTO_IMPORT_STORAGE_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setDjiLogAutoImport(on: boolean): Promise<void> {
  await AsyncStorage.setItem(DJI_LOG_AUTO_IMPORT_STORAGE_KEY, on ? "1" : "0").catch(() => {});
}

/** Zuletzt automatisch übernommene Protokolle (für den Logbuch-Hinweis). */
let autoImported = 0;
export function getDjiLogAutoImported(): number {
  return autoImported;
}
export function setDjiLogAutoImported(n: number): void {
  autoImported = n;
  hintVersion += 1;
  for (const l of hintListeners) {
    try {
      l();
    } catch {}
  }
}

let newHint: number | null = null;
let hintVersion = 0;
const hintListeners = new Set<() => void>();

function setNewHint(n: number | null): void {
  if (n === newHint) return;
  newHint = n;
  hintVersion++;
  for (const fn of [...hintListeners]) {
    try {
      fn();
    } catch {}
  }
}

/** Anzahl neuer Logs aus der letzten stillen Prüfung (null = keine Prüfung/aus). */
export function getDjiLogNewHint(): number | null {
  return newHint;
}

export function getDjiLogNewHintVersion(): number {
  return hintVersion;
}

export function subscribeDjiLogNewHint(fn: () => void): () => void {
  hintListeners.add(fn);
  return () => hintListeners.delete(fn);
}

/**
 * Stille Prüfung (keine Benachrichtigung): nur wenn eingeschaltet und ein
 * Ordner freigegeben ist. Aktualisiert den Logbuch-Hinweis.
 */
export async function refreshDjiLogNewHint(): Promise<number | null> {
  if (!isFolderImportSupported() || !(await getDjiLogAutoCheck())) {
    setNewHint(null);
    return null;
  }
  const uri = await getDjiLogFolder();
  if (!uri) {
    setNewHint(null);
    return null;
  }
  const res = await checkDjiLogFolderAccess(uri).catch(() => null);
  const n = res && res.ok ? res.newCount : null;
  setNewHint(n);
  return n;
}
