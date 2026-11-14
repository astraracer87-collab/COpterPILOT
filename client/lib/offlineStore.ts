import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

// Reiner Offline-Speicher (KEINE App-spezifischen Importe → kein Import-Cycle
// mit geozones.ts / notams.ts, die von hier lesen). Hält pro Land ein
// "Offline-Paket": Geozonen-Vektordaten + NOTAMs + Zeitstempel.
//
// - Index (leichtgewichtige Metadaten) liegt in AsyncStorage.
// - Die eigentlichen (ggf. mehrere MB großen) Paket-Daten liegen als JSON-Datei
//   im Dokumentenverzeichnis (AsyncStorage ist für große Blobs ungeeignet).

const INDEX_KEY = "@preflight/offline_packs_index";
const OFFLINE_DIR = `${FileSystem.documentDirectory ?? ""}offline/`;

// Ein Paket gilt nach 3 Tagen als veraltet ("muss aktualisiert werden").
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export interface OfflinePackMeta {
  iso: string;
  name: string;
  /** Zeitpunkt des Downloads (ms seit Epoch). */
  cachedAt: number;
  featureCount: number;
  notamCount: number;
  sizeBytes: number;
}

export interface OfflinePackData {
  iso: string;
  cachedAt: number;
  features: unknown[];
  notams: unknown[];
}

export function isPackStale(meta: { cachedAt: number } | null | undefined): boolean {
  if (!meta) return false;
  return Date.now() - meta.cachedAt > STALE_AFTER_MS;
}

function normIso(iso: string): string {
  return String(iso || "").trim().toUpperCase();
}

function packFilePath(iso: string): string {
  return `${OFFLINE_DIR}pack-${normIso(iso)}.json`;
}

async function ensureDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(OFFLINE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true });
    }
  } catch {
    // Verzeichnis-Anlage scheitert nur in exotischen Fällen — Schreiben würde
    // dann ebenfalls scheitern und sauber im Aufrufer landen.
  }
}

export async function getOfflineIndex(): Promise<Record<string, OfflinePackMeta>> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, OfflinePackMeta>) : {};
  } catch {
    return {};
  }
}

async function saveIndex(index: Record<string, OfflinePackMeta>): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export async function listOfflinePacks(): Promise<OfflinePackMeta[]> {
  const index = await getOfflineIndex();
  return Object.values(index).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export async function getOfflinePackMeta(iso: string): Promise<OfflinePackMeta | null> {
  const index = await getOfflineIndex();
  return index[normIso(iso)] ?? null;
}

export async function writePack(iso: string, name: string, data: OfflinePackData): Promise<OfflinePackMeta> {
  await ensureDir();
  const path = packFilePath(iso);
  const json = JSON.stringify(data);
  await FileSystem.writeAsStringAsync(path, json);

  let sizeBytes = json.length;
  try {
    const info = await FileSystem.getInfoAsync(path, { size: true } as any);
    if (info.exists && typeof (info as any).size === "number") {
      sizeBytes = (info as any).size;
    }
  } catch {
    // Größe ist nur informativ.
  }

  const meta: OfflinePackMeta = {
    iso: normIso(iso),
    name,
    cachedAt: data.cachedAt,
    featureCount: Array.isArray(data.features) ? data.features.length : 0,
    notamCount: Array.isArray(data.notams) ? data.notams.length : 0,
    sizeBytes,
  };

  const index = await getOfflineIndex();
  index[meta.iso] = meta;
  await saveIndex(index);
  return meta;
}

export async function readPackData(iso: string): Promise<OfflinePackData | null> {
  const path = packFilePath(iso);
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as OfflinePackData;
  } catch {
    return null;
  }
}

export async function deleteOfflinePack(iso: string): Promise<void> {
  const path = packFilePath(iso);
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // ignore
  }
  const index = await getOfflineIndex();
  delete index[normIso(iso)];
  await saveIndex(index);
}

export async function getTotalOfflineBytes(): Promise<number> {
  const index = await getOfflineIndex();
  return Object.values(index).reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
}

// Liefert alle gespeicherten Geozonen-Features eines Landes (für den
// Offline-Fallback in geozones.ts). Geometrie-/Radius-Filterung übernimmt der
// Aufrufer (queryGeozonesInArea filtert ohnehin streng nach Polygon-Schnitt).
export async function getOfflinePackFeatures(iso: string): Promise<unknown[] | null> {
  const data = await readPackData(iso);
  if (!data || !Array.isArray(data.features)) return null;
  return data.features;
}

export async function getOfflinePackNotams(iso: string): Promise<unknown[] | null> {
  const data = await readPackData(iso);
  if (!data || !Array.isArray(data.notams)) return null;
  return data.notams;
}
