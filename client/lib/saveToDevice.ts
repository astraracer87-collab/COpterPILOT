/**
 * Dateien auf dem Gerät speichern statt „Teilen“: Auf der DJI-Fernsteuerung
 * gibt es keine Apps, an die geteilt werden kann („Diese Aktion kann von
 * keiner App ausgeführt werden“). Android: Ordner einmal wählen (z. B.
 * Download), die App merkt ihn sich und legt die Datei dort ab.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DIR_KEY = "@copterpilot/export_dir_uri";
const SAF = FileSystem.StorageAccessFramework;

export type SaveResult = { saved: true; location: string } | { saved: false; reason: "cancelled" | "unsupported" };

function folderLabel(dirUri: string): string {
  try {
    const dec = decodeURIComponent(dirUri);
    const m = /tree\/[^:]*:(.*)$/.exec(dec);
    return m ? (m[1] ? m[1] : "Hauptordner") : dec;
  } catch {
    return dirUri;
  }
}

async function pickDir(): Promise<string | null> {
  const initial = SAF.getUriForDirectoryInRoot("Download");
  const res = await SAF.requestDirectoryPermissionsAsync(initial);
  if (!res.granted) return null;
  await AsyncStorage.setItem(DIR_KEY, res.directoryUri).catch(() => {});
  return res.directoryUri;
}

async function writeInto(dirUri: string, fileName: string, mime: string, data: { text?: string; base64?: string }): Promise<string> {
  const base = fileName.replace(/\.[^.]+$/, "");
  const uri = await SAF.createFileAsync(dirUri, base, mime);
  if (data.base64 != null) {
    await FileSystem.writeAsStringAsync(uri, data.base64, { encoding: FileSystem.EncodingType.Base64 });
  } else {
    await FileSystem.writeAsStringAsync(uri, data.text ?? "", { encoding: FileSystem.EncodingType.UTF8 });
  }
  return uri;
}

/** Text (z. B. JSON) oder vorhandene Datei (srcUri) im gewählten Ordner speichern. */
export async function saveToDevice(opts: {
  fileName: string;
  mimeType: string;
  text?: string;
  srcUri?: string;
  /** immer neu nach dem Ordner fragen */
  chooseFolder?: boolean;
}): Promise<SaveResult> {
  if (Platform.OS !== "android" || !SAF) return { saved: false, reason: "unsupported" };
  const data = opts.srcUri
    ? { base64: await FileSystem.readAsStringAsync(opts.srcUri, { encoding: FileSystem.EncodingType.Base64 }) }
    : { text: opts.text ?? "" };
  let dir = opts.chooseFolder ? null : await AsyncStorage.getItem(DIR_KEY).catch(() => null);
  if (dir) {
    try {
      await writeInto(dir, opts.fileName, opts.mimeType, data);
      return { saved: true, location: `${folderLabel(dir)}/${opts.fileName}` };
    } catch {
      // Berechtigung weg oder Ordner gelöscht → neu wählen
      dir = null;
    }
  }
  dir = await pickDir();
  if (!dir) return { saved: false, reason: "cancelled" };
  await writeInto(dir, opts.fileName, opts.mimeType, data);
  return { saved: true, location: `${folderLabel(dir)}/${opts.fileName}` };
}
