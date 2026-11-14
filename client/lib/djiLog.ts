import type { LogbookEntry } from "./storage";
import type { DjiAnalyzeResult, DjiLogMeta, DjiBulkProgress, DjiBulkResult } from "./djiLogCore";

// RN-freie Kernlogik (Typen, Konstanten, reine Auswerte-/Gruppierungs-Funktionen)
// lebt in ./djiLogCore und wird hier re-exportiert, damit das Web-Bundle (Vite)
// sie ohne Expo-/react-native-Abhängigkeit importieren kann.
export * from "./djiLogCore";

/**
 * Die Auswertung von DJI-Flugprotokollen lief serverseitig (Entschlüsselung mit
 * dem DJI-Schlüssel). In der RC-Version ohne Backend ist sie nicht verfügbar;
 * die Funktionen bleiben für die Kompatibilität bestehen und werfen einen
 * verständlichen Fehler.
 */
export const DJI_LOG_UNAVAILABLE_MESSAGE =
  "Die Auswertung von DJI-Flugprotokollen ist in der RC-Version nicht verfügbar, da sie einen Server (DJI-Entschlüsselung) benötigt.";

function unavailable(): never {
  throw new Error(DJI_LOG_UNAVAILABLE_MESSAGE);
}

export async function pickAndUploadDjiLog(_entryId: string): Promise<LogbookEntry | null> {
  return unavailable();
}

export async function pickAndAnalyzeDjiLog(): Promise<DjiAnalyzeResult | null> {
  return unavailable();
}

export async function pickAndAnalyzeMultipleDjiLogs(
  _onProgress?: (p: DjiBulkProgress) => void,
): Promise<DjiBulkResult | null> {
  return unavailable();
}

export async function assignDjiLog(_params: {
  meta: DjiLogMeta;
  target: "existing" | "new";
  entryId?: string;
}): Promise<LogbookEntry> {
  return unavailable();
}
