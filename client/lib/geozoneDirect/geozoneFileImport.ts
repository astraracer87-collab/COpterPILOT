// „Geozonen-Datei importieren“ (Einstellungen → Offline-Karten, je Land):
// Datei wählen (expo-document-picker), lesen, als ED-269/ED-318/GeoJSON
// erkennen (shared/geozoneImport.ts) und als Landesbestand im ED-269-
// Gerätecache speichern (ed269Store.importEd269Dataset) – danach nutzen Karte,
// Zonencheck und Offline-Betrieb die Zonen wie bei heruntergeladenen Ländern.
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { base64ToBytes } from "@/lib/base64";
import { trackDownload } from "@/lib/downloadActivity";
import { ED269_SOURCE_LABELS } from "@/lib/ed269";
import { parseGeozoneImportBytes, type GeozoneImportFormat } from "../../../shared/geozoneImport";
import { importEd269Dataset, type Ed269Dataset } from "./ed269Store";
import type { GeoFeature } from "./ed269Sources";

/** Obergrenze der Importdatei (ZIP/JSON); größere Dateien überfordern die Fernsteuerung. */
export const GEOZONE_IMPORT_MAX_BYTES = 80 * 1024 * 1024;

export const GEOZONE_IMPORT_FORMAT_LABELS: Record<GeozoneImportFormat, string> = {
  ed269: "ED-269",
  ed318: "ED-318",
  geojson: "GeoJSON",
  "mt-tmcad": "Transport Malta / iDronect (Export)",
  "gr-dagr": "HASP / DAGR (dagr_geozonen.py)",
  "ro-romatsa": "ROMATSA (GeoJSON)",
};

export type GeozoneFileImportResult =
  | { ok: true; dataset: Ed269Dataset; format: GeozoneImportFormat; count: number; fileName: string }
  | { ok: false; canceled?: boolean; error?: string };

/** Datei auswählen und für `iso` importieren. Wirft nicht. */
export async function pickAndImportGeozoneFile(iso: string): Promise<GeozoneFileImportResult> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      // Android meldet .geojson oft als application/octet-stream – daher */* zulassen.
      type: ["application/json", "application/geo+json", "application/zip", "application/x-zip-compressed", "application/octet-stream", "*/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets || res.assets.length === 0) return { ok: false, canceled: true };
    const asset = res.assets[0];
    const fileName = asset.name || "geozonen.json";
    if (!/\.(json|geojson|zip)$/i.test(fileName)) {
      return { ok: false, error: "Bitte eine .json-, .geojson- oder .zip-Datei wählen." };
    }
    if (asset.size && asset.size > GEOZONE_IMPORT_MAX_BYTES) {
      return { ok: false, error: `Datei zu groß (max. ${Math.round(GEOZONE_IMPORT_MAX_BYTES / 1024 / 1024)} MB).` };
    }
    // Import-Verarbeitung in der Download-Anzeige (große Dateien dauern)
    return await trackDownload(
      { id: `import:${iso.toUpperCase()}`, iso, labelDe: "Geozonen-Import wird verarbeitet", kind: "import" },
      async () => {
        const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        return importGeozoneBytes(iso, base64ToBytes(b64), fileName);
      },
    );
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "Import fehlgeschlagen." };
  }
}

/** Bytes (JSON/ZIP) für `iso` parsen und speichern. Wirft nicht. */
export async function importGeozoneBytes(iso: string, bytes: Uint8Array, fileName: string): Promise<GeozoneFileImportResult> {
  try {
    const up = iso.toUpperCase();
    const source = ED269_SOURCE_LABELS[up] ? `${ED269_SOURCE_LABELS[up]} – Import ${fileName}` : `Datei-Import ${fileName}`;
    const parsed = parseGeozoneImportBytes(bytes, { iso: up, source });
    const dataset = await importEd269Dataset(iso, parsed.features as unknown as GeoFeature[], {
      source: GEOZONE_IMPORT_FORMAT_LABELS[parsed.format],
      importedAt: Date.now(),
      fileName: parsed.innerName ? `${fileName} (${parsed.innerName})` : fileName,
    });
    return { ok: true, dataset, format: parsed.format, count: dataset.features.length, fileName };
  } catch (e: any) {
    return { ok: false, error: e?.message ? String(e.message) : "Import fehlgeschlagen." };
  }
}
