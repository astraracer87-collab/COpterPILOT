import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { checkpoint } from "../../shared/yieldingWork";
import {
  createLogbookEntry,
  getDrones,
  getLogbookEntry,
  getLogbook,
  getEntryDjiLogs,
  deleteLogbookEntry,
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
import { sameAircraft } from "./djiLogCore";
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
import {
  fileNameFromSafUri,
  filterDjiLogNames,
  folderLabelFromUri,
  knownDjiLogNames,
} from "./djiLogFolder";

export { logbookEntryFromDjiLog };

// RN-freie Kernlogik (Typen, Konstanten, reine Auswerte-/Gruppierungs-Funktionen)
// lebt in ./djiLogCore und wird hier re-exportiert.
export * from "./djiLogCore";
export * from "./djiLogFolder";

/**
 * DJI-Flugprotokolle werden vollständig auf dem Gerät ausgewertet:
 * dji-log-parser (WebAssembly) in einer versteckten WebView
 * (DjiLogWorkerHost), Schlüssel für verschlüsselte Logs (ab v13) direkt von
 * DJI (API-Schlüssel des Piloten, nur im SecureStore) und pro Log gecacht.
 */

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
// Ordner (Storage Access Framework, Android) – gemerkter Ordner, Zugriffs-
// prüfung und Pfad-Anzeige leben in ./djiLogFolder (gemeinsam mit den
// Einstellungen).
// ---------------------------------------------------------------------------

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
    const known = await knownDjiLogNames();
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
/** Gleiches Protokoll? Dateiname, sonst gleicher Startzeitpunkt (± 2 s) derselben Drohne. */
export function sameDjiLog(a: Pick<DjiLogMeta, "fileName" | "startTs" | "aircraftSn">, b: Pick<DjiLogMeta, "fileName" | "startTs" | "aircraftSn">): boolean {
  const fa = (a.fileName || "").toLowerCase();
  const fb = (b.fileName || "").toLowerCase();
  if (fa && fa === fb) return true;
  if (a.startTs != null && b.startTs != null && Math.abs(a.startTs - b.startTs) <= 2000) {
    const sa = (a.aircraftSn || "").toUpperCase();
    const sb = (b.aircraftSn || "").toUpperCase();
    return !sa || !sb || sa === sb;
  }
  return false;
}

/** Logbuch-Eintrag, der dieses Protokoll schon enthält (oder null). */
export function findEntryWithDjiLog(entries: readonly LogbookEntry[], meta: DjiLogMeta): LogbookEntry | null {
  for (const e of entries) {
    if (getEntryDjiLogs(e).some((l) => sameDjiLog(l, meta))) return e;
  }
  return null;
}

/**
 * Doppelt importierte Flüge entfernen: ein aus einem DJI-Protokoll angelegter
 * Eintrag, dessen Protokolle alle schon in einem älteren Eintrag stecken.
 * Rückgabe: Anzahl gelöschter Einträge.
 */
export async function removeDuplicateDjiLogEntries(): Promise<number> {
  const entries = [...(await getLogbook())].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const kept: LogbookEntry[] = [];
  let removed = 0;
  for (const e of entries) {
    const logs = getEntryDjiLogs(e);
    const fromLog = typeof e.sessionId === "string" && e.sessionId.startsWith("dji-log:");
    const dup = fromLog && logs.length > 0 && logs.every((l) => kept.some((k) => getEntryDjiLogs(k).some((kl) => sameDjiLog(kl, l))));
    if (dup) {
      await deleteLogbookEntry(e.id);
      removed++;
    } else {
      kept.push(e);
    }
  }
  return removed;
}

/**
 * Führt bereits vorhandene, zusammengehörige DJI-Log-Einträge nachträglich
 * zusammen: gleiche Drohne (bevorzugt Seriennummer, sonst Name) und zeitlich
 * nah beieinander (Standard 3 h) werden zu EINEM Logbuch-Eintrag verschmolzen.
 * Der früheste Eintrag bleibt, die Protokolle der anderen wandern hinein, die
 * anderen Einträge werden gelöscht. Rückgabe: Anzahl verschmolzener Einträge.
 */
export async function mergeRelatedDjiLogEntries(maxHours = 3): Promise<number> {
  const maxMs = maxHours * 3600 * 1000;
  const all = await getLogbook();
  type Row = { entry: LogbookEntry; sn?: string; name?: string; startTs: number };
  const rows: Row[] = [];
  for (const e of all) {
    const fromLog = typeof e.sessionId === "string" && e.sessionId.startsWith("dji-log:");
    const logs = getEntryDjiLogs(e);
    if (!fromLog || logs.length === 0) continue;
    const startTs = Math.min(...logs.map((l) => l.startTs ?? Infinity));
    if (!Number.isFinite(startTs)) continue;
    rows.push({ entry: e, sn: logs[0].aircraftSn, name: logs[0].droneName ?? e.droneName, startTs });
  }
  rows.sort((a, b) => a.startTs - b.startTs);

  const keepers: Row[] = [];
  let merged = 0;
  for (const row of rows) {
    const target = keepers.find(
      (k) => sameAircraft(k.name, k.sn, row.name, row.sn) && Math.abs(k.startTs - row.startTs) <= maxMs,
    );
    if (!target) {
      keepers.push(row);
      continue;
    }
    // Alle Protokolle des jüngeren Eintrags in den Keeper übernehmen, dann löschen.
    try {
      for (const l of getEntryDjiLogs(row.entry)) {
        await attachDjiLogToEntry(target.entry.id, l);
      }
      await deleteLogbookEntry(row.entry.id);
      merged++;
      if (!target.sn && row.sn) target.sn = row.sn;
    } catch {
      // Eintrag überspringen, Rest weiterführen
    }
  }
  return merged;
}

export async function assignDjiLog(params: {
  meta: DjiLogMeta;
  target: "existing" | "new";
  entryId?: string;
}): Promise<LogbookEntry> {
  const { meta, target, entryId } = params;
  // Ein Flug nur einmal: steckt das Protokoll schon in einem Eintrag, diesen nehmen
  const already = findEntryWithDjiLog(await getLogbook().catch(() => [] as LogbookEntry[]), meta);
  if (already && (target === "new" || already.id === entryId)) return already;
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
