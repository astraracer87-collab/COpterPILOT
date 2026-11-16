import { StorageAccessFramework as SAF } from "expo-file-system/legacy";
import { FccLog } from "@/lib/fcc/log";

/**
 * FCC-Datei auf die microSD-Karte der DJI-Goggle schreiben bzw. wieder entfernen
 * (öffentlich beschriebene „ham file“-Methode). Über das Storage Access Framework,
 * ohne besondere Speicherrechte.
 */
export type GoggleVariant = "ham" | "naco";

export const VARIANTS: Record<GoggleVariant, { label: string; fileName: string; content: string }> = {
  ham: { label: "Goggles 2 / 3 / N3 / Integra (ham_cfg_support)", fileName: "ham_cfg_support", content: "" },
  naco: { label: "Goggles V1 / V2 (naco_pwr.txt)", fileName: "naco_pwr.txt", content: "pwr_2" },
};

export interface SdResult {
  ok: boolean;
  message: string;
}

/** Name aus einer SAF-Dokument-URI herauslösen (letztes Segment, dekodiert). */
function nameFromUri(uri: string): string {
  const decoded = decodeURIComponent(uri);
  const slash = decoded.lastIndexOf("/");
  return slash >= 0 ? decoded.substring(slash + 1) : decoded;
}

async function pickDirectory(): Promise<string | null> {
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) return null;
  return perm.directoryUri;
}

/** Vorhandene FCC-Dateien im Ordner löschen (verhindert „(1)"-Dubletten). */
async function removeKnown(dirUri: string): Promise<string[]> {
  const removed: string[] = [];
  let files: string[] = [];
  try {
    files = await SAF.readDirectoryAsync(dirUri);
  } catch {
    return removed;
  }
  for (const uri of files) {
    const name = nameFromUri(uri);
    if (name.startsWith("ham_cfg_support") || name.startsWith("naco_pwr")) {
      try {
        await SAF.deleteAsync(uri, { idempotent: true });
        removed.push(name);
      } catch {
        /* ignore */
      }
    }
  }
  return removed;
}

export async function writeFile(variant: GoggleVariant): Promise<SdResult> {
  const v = VARIANTS[variant];
  const dirUri = await pickDirectory();
  if (!dirUri) return { ok: false, message: "Keine SD-Karte ausgewählt." };
  try {
    await removeKnown(dirUri);
    const fileUri = await SAF.createFileAsync(dirUri, v.fileName, "application/octet-stream");
    await SAF.writeAsStringAsync(fileUri, v.content);
    const actual = nameFromUri(fileUri);
    FccLog.ok(`SD-Karte: Datei „${actual}" geschrieben (${v.content.length} Byte)`);
    if (actual !== v.fileName) {
      return {
        ok: true,
        message: `Geschrieben, aber als „${actual}" statt „${v.fileName}". Bitte auf der Karte in „${v.fileName}" umbenennen (ohne Endung).`,
      };
    }
    return { ok: true, message: `Datei „${actual}" auf die Karte geschrieben.` };
  } catch (e) {
    FccLog.err(`SD-Karte: Fehler ${String(e)}`);
    return { ok: false, message: `Fehler: ${String(e)}` };
  }
}

export async function removeFile(): Promise<SdResult> {
  const dirUri = await pickDirectory();
  if (!dirUri) return { ok: false, message: "Keine SD-Karte ausgewählt." };
  try {
    const removed = await removeKnown(dirUri);
    if (removed.length === 0) {
      FccLog.warn("SD-Karte: keine FCC-Datei gefunden");
      return { ok: true, message: "Es war keine FCC-Datei auf der Karte. Nichts zu entfernen." };
    }
    FccLog.ok("SD-Karte: entfernt " + removed.join(", "));
    return { ok: true, message: "Entfernt: " + removed.join(", ") + "." };
  } catch (e) {
    FccLog.err(`SD-Karte: Fehler ${String(e)}`);
    return { ok: false, message: `Fehler: ${String(e)}` };
  }
}
