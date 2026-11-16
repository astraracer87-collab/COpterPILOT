/**
 * DJI-Flugprotokoll-Ordner (Storage Access Framework) – RN-freie Kernlogik:
 * Speicher-Schlüssel, Start-URIs, Pfad-Anzeige aus SAF-URIs, Filter für
 * Protokolldateien und die Zugriffs-/Zählprüfung mit eingespeisten
 * Abhängigkeiten (testbar ohne React Native).
 *
 * Logbuch (DjiBulkImportScreen) und Einstellungen (DjiLogFolderCard) nutzen
 * denselben Schlüssel – der gemerkte Ordner ist überall derselbe.
 */

/** AsyncStorage-Schlüssel des freigegebenen Ordners (Tree-URI). */
export const DJI_LOG_FOLDER_STORAGE_KEY = "@copterpilot/djiFlightRecordFolderUri";
/** AsyncStorage-Schlüssel: neue Logs beim App-Start still prüfen ("1"/"0"). */
export const DJI_LOG_AUTO_CHECK_STORAGE_KEY = "@copterpilot/djiFlightRecordAutoCheck";

/** DJI Fly legt die Protokolle hier ab (Android 11 sperrt Android/data teilweise). */
export const DJI_FLY_FLIGHTRECORD_PATH = "Android/data/dji.go.v5/files/FlightRecord";
/** Empfohlene Ablage, wenn Android/data gesperrt ist (Kopie per PC/USB). */
export const DJI_DOWNLOAD_FLIGHTRECORDS_PATH = "Download/FlightRecords";

const EXTERNAL_STORAGE_DOC = "content://com.android.externalstorage.documents/document/";

export const DJI_FLY_FLIGHTRECORD_DOC_URI =
  EXTERNAL_STORAGE_DOC + encodeURIComponent(`primary:${DJI_FLY_FLIGHTRECORD_PATH}`);
export const DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI =
  EXTERNAL_STORAGE_DOC + encodeURIComponent(`primary:${DJI_DOWNLOAD_FLIGHTRECORDS_PATH}`);

export type DjiLogFolderSuggestion = "djiFly" | "download";

/** Start-URI (initialUri) für den SAF-Ordnerdialog. */
export function suggestDjiFlyFolderUri(kind: DjiLogFolderSuggestion = "djiFly"): string {
  return kind === "djiFly" ? DJI_FLY_FLIGHTRECORD_DOC_URI : DJI_DOWNLOAD_FLIGHTRECORDS_DOC_URI;
}

/**
 * Lesbarer Pfad aus einer SAF-URI:
 * ".../tree/primary%3AAndroid%2Fdata%2Fdji.go.v5%2Ffiles%2FFlightRecord"
 *   → "Android/data/dji.go.v5/files/FlightRecord".
 * Funktioniert für Tree-, Document- und Tree+Document-URIs; bei SD-Karten
 * ("1234-ABCD:DCIM") wird "SD-Karte 1234-ABCD/DCIM" angezeigt.
 */
export function folderLabelFromUri(uri: string): string {
  try {
    const doc = uri.match(/\/document\/([^/?#]+)/);
    const tree = uri.match(/\/tree\/([^/?#]+)/);
    const m = doc ?? tree;
    const raw = decodeURIComponent(m ? m[1] : uri);
    const idx = raw.indexOf(":");
    if (idx < 0 || /^[a-z]+:\/\//i.test(raw)) return raw || "Interner Speicher";
    const volume = raw.slice(0, idx);
    const path = raw.slice(idx + 1).replace(/^\/+|\/+$/g, "");
    if (volume === "primary" || volume === "home") return path || "Interner Speicher";
    return path ? `SD-Karte ${volume}/${path}` : `SD-Karte ${volume}`;
  } catch {
    return uri;
  }
}

/** Liegt der Ordner unter „Android/data“ (ab Android 11 für andere Apps oft gesperrt)? */
export function isAndroidDataFolder(uri: string): boolean {
  return /^Android\/data(\/|$)/i.test(folderLabelFromUri(uri));
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
  return (djiNamed.length > 0 ? djiNamed : txt).sort((a, b) => a.name.localeCompare(b.name));
}

/** Identität eines Protokolls für „schon importiert?“ (Dateiname, ohne Groß/klein). */
export function djiLogIdentity(fileName: string): string {
  return fileName.trim().toLowerCase();
}

export interface DjiLogFolderAccess {
  /** Ordner lesbar (Freigabe besteht noch) */
  ok: boolean;
  /** Anzahl DJI-Protokolle (.txt) im Ordner */
  count: number;
  /** davon noch nicht im Logbuch */
  newCount: number;
  /** Fehlertext, wenn nicht lesbar */
  error?: string;
}

export interface DjiLogFolderAccessDeps {
  /** SAF readDirectoryAsync (liefert Kind-URIs) */
  readDirectory(folderUri: string): Promise<string[]>;
  /** Dateinamen bereits importierter Protokolle */
  knownLogNames(): Promise<Iterable<string>>;
}

/** Ordner lesen, Protokolle zählen und mit den importierten Protokollen abgleichen. */
export async function checkDjiLogFolderAccessWith(
  folderUri: string,
  deps: DjiLogFolderAccessDeps,
): Promise<DjiLogFolderAccess> {
  let children: string[];
  try {
    children = await deps.readDirectory(folderUri);
  } catch (e) {
    return {
      ok: false,
      count: 0,
      newCount: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const logs = filterDjiLogNames(children.map((uri) => ({ uri, name: fileNameFromSafUri(uri) })));
  let known = new Set<string>();
  try {
    known = new Set([...(await deps.knownLogNames())].map(djiLogIdentity));
  } catch {
    // ohne Logbuch gelten alle als neu
  }
  const newCount = logs.filter((f) => !known.has(djiLogIdentity(f.name))).length;
  return { ok: true, count: logs.length, newCount };
}
