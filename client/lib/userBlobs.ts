// Große Felder der NUTZERDATEN (Karten-Snapshots als Base64) liegen als eigene
// Dateien unter documentDirectory/user-blobs/<ns>/ statt inline im
// AsyncStorage-Wert. Im gespeicherten Datensatz steht dann nur ein Verweis
// ("blobref:v1:<ns>/<datei>").
//
// Warum: ein 800×480-PNG als Base64 ist schnell 0,5–1 MB. Ein paar Sessions
// damit sprengen sowohl das SQLite-Limit von AsyncStorage als auch das
// Android-CursorWindow (~2 MB pro Wert → der Wert ist nicht mehr lesbar).
//
// Anders als fileCache.ts ist das KEIN Cache: diese Dateien werden nie bei
// Speichermangel geleert. Entfernt werden nur Dateien, auf die kein
// gespeicherter Datensatz mehr verweist (collectBlobGarbage), und das erst
// nach einer Karenzzeit.
//
// RN-frei (Dateisystem über fileStoreFs.ts, in Tests ersetzbar).

import {
  encodeFileKey,
  getSimpleFs,
  writeTextAtomic,
  type SimpleFs,
} from "./fileStoreFs";

export const USER_BLOB_DIR_NAME = "user-blobs";
export const BLOB_REF_PREFIX = "blobref:v1:";
/** Kürzere Strings bleiben inline. */
export const BLOB_MIN_LENGTH = 16 * 1024;
const EXT = ".b64";

export type BlobFieldPath = readonly string[];

export interface BlobSpec {
  /** Unterordner, z. B. "sessions" oder "logbook". */
  ns: string;
  /** Feldpfade je Datensatz, z. B. ["mapSnapshotBase64"], ["trafficLog","mapSnapshotBase64"]. */
  fields: readonly BlobFieldPath[];
  /**
   * Felder mit JSON-Werten (Objekte/Arrays, z. B. ausgewertete DJI-Logs):
   * werden als JSON-Text ausgelagert und beim Lesen wieder geparst.
   */
  jsonFields?: readonly BlobFieldPath[];
}

function allFields(spec: BlobSpec): readonly BlobFieldPath[] {
  return spec.jsonFields && spec.jsonFields.length ? [...spec.fields, ...spec.jsonFields] : spec.fields;
}

function isJsonField(spec: BlobSpec, field: BlobFieldPath): boolean {
  return !!spec.jsonFields?.some((f) => f.length === field.length && f.every((p, i) => p === field[i]));
}

/** Inline-JSON-Wert, der groß genug zum Auslagern ist (sonst null). */
function jsonToExternalize(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  try {
    const text = JSON.stringify(value);
    return text.length >= BLOB_MIN_LENGTH ? text : null;
  } catch {
    return null;
  }
}

export function isBlobRef(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(BLOB_REF_PREFIX);
}

function activeFs(fs?: SimpleFs | null): SimpleFs | null {
  const f = fs === undefined ? getSimpleFs() : fs;
  return f && f.root ? f : null;
}

function blobRoot(fs: SimpleFs): string {
  return `${fs.root}${USER_BLOB_DIR_NAME}/`;
}

function relPathFor(spec: BlobSpec, id: string, field: BlobFieldPath): string {
  return `${spec.ns}/${encodeFileKey(id)}.${field.join("_")}${EXT}`;
}

function getAt(obj: unknown, path: BlobFieldPath): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Kopie von obj mit neuem Wert am Pfad (Zwischenobjekte flach kopiert). */
function setAt<T>(obj: T, path: BlobFieldPath, value: unknown): T {
  const [head, ...rest] = path;
  const src = (obj ?? {}) as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...src };
  if (rest.length === 0) {
    if (value === undefined) delete copy[head];
    else copy[head] = value;
  } else {
    const child = src[head];
    if (!child || typeof child !== "object") return obj;
    copy[head] = setAt(child, rest, value);
  }
  return copy as T;
}

async function readRef(fs: SimpleFs, ref: string): Promise<string | null> {
  const rel = ref.slice(BLOB_REF_PREFIX.length);
  if (!rel || rel.includes("..")) return null;
  try {
    return await fs.readText(`${blobRoot(fs)}${rel}`);
  } catch {
    return null;
  }
}

/**
 * Große Felder in Dateien auslagern; liefert NEUE Objekte mit Verweisen (die
 * übergebenen bleiben unverändert). Scheitert das Schreiben, bleibt der Wert
 * inline – lieber ein großer Datensatz als ein verlorenes Bild.
 */
export async function externalizeBlobs<T>(
  spec: BlobSpec,
  items: readonly T[],
  fsArg?: SimpleFs | null,
): Promise<T[]> {
  const fs = activeFs(fsArg);
  if (!fs) return [...items];
  const out: T[] = [];
  for (const item of items) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) {
      out.push(item);
      continue;
    }
    let next = item;
    for (const field of allFields(spec)) {
      let value = getAt(next, field);
      if (typeof value !== "string") {
        if (!isJsonField(spec, field)) continue;
        const text = jsonToExternalize(value);
        if (text == null) continue;
        value = text;
      }
      const rel = relPathFor(spec, id, field);
      if (isBlobRef(value)) {
        if (value === BLOB_REF_PREFIX + rel) continue;
        // Verweis auf eine fremde Datei (z. B. Session-Bild ins Logbuch
        // kopiert): eigene Kopie anlegen, sonst räumt die GC sie später weg.
        const content = await readRef(fs, value);
        if (content == null) continue;
        value = content;
      }
      if ((value as string).length < BLOB_MIN_LENGTH) continue;
      try {
        await writeTextAtomic(fs, `${blobRoot(fs)}${rel}`, value as string);
        next = setAt(next, field, BLOB_REF_PREFIX + rel);
      } catch (e) {
        console.warn(
          "[userBlobs] Auslagern fehlgeschlagen, bleibt inline:",
          (e as Error)?.message,
        );
      }
    }
    out.push(next);
  }
  return out;
}

/** Verweise eines Datensatzes durch den Dateiinhalt ersetzen (fehlende Datei → Feld entfällt). */
export async function hydrateBlobsOne<T>(
  spec: BlobSpec,
  item: T,
  fsArg?: SimpleFs | null,
): Promise<T> {
  if (!item || typeof item !== "object") return item;
  let next = item;
  for (const field of allFields(spec)) {
    const value = getAt(next, field);
    if (!isBlobRef(value)) continue;
    const fs = activeFs(fsArg);
    const content = fs ? await readRef(fs, value) : null;
    let restored: unknown = content ?? undefined;
    if (content != null && isJsonField(spec, field)) {
      try {
        restored = JSON.parse(content);
      } catch {
        restored = undefined;
      }
    }
    next = setAt(next, field, restored);
  }
  return next;
}

export async function hydrateBlobs<T>(
  spec: BlobSpec,
  items: readonly T[],
  fsArg?: SimpleFs | null,
): Promise<T[]> {
  const out: T[] = [];
  for (const item of items) out.push(await hydrateBlobsOne(spec, item, fsArg));
  return out;
}

/** Enthält ein Datensatz noch große Inline-Werte, die ausgelagert werden sollten? */
export function hasInlineBlobs<T>(
  spec: BlobSpec,
  items: readonly T[],
): boolean {
  return items.some((item) =>
    allFields(spec).some((f) => {
      const v = getAt(item, f);
      if (typeof v !== "string") return isJsonField(spec, f) && jsonToExternalize(v) != null;
      return v.length >= BLOB_MIN_LENGTH && !v.startsWith(BLOB_REF_PREFIX);
    }),
  );
}

/**
 * Dateien im Ordner der Spec löschen, auf die keiner der (rohen, gespeicherten)
 * Datensätze verweist. Nur Dateien älter als minAgeMs (schützt gerade
 * geschriebene Bilder, deren Datensatz noch gespeichert wird).
 */
export async function collectBlobGarbage<T>(
  spec: BlobSpec,
  rawItems: readonly T[],
  opts: { minAgeMs?: number; now?: number; fs?: SimpleFs | null } = {},
): Promise<number> {
  const fs = activeFs(opts.fs);
  if (!fs) return 0;
  const minAge = opts.minAgeMs ?? 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const referenced = new Set<string>();
  for (const item of rawItems) {
    for (const f of allFields(spec)) {
      const v = getAt(item, f);
      if (isBlobRef(v)) referenced.add(v.slice(BLOB_REF_PREFIX.length));
    }
  }
  const dir = `${blobRoot(fs)}${spec.ns}/`;
  let removed = 0;
  for (const name of await fs.list(dir).catch(() => [] as string[])) {
    const rel = `${spec.ns}/${name}`;
    if (referenced.has(rel)) continue;
    try {
      const info = await fs.info(`${dir}${name}`);
      if (!info.exists) continue;
      if (typeof info.mtimeMs !== "number" || now - info.mtimeMs < minAge)
        continue;
      await fs.remove(`${dir}${name}`);
      removed++;
    } catch {
      // nächste Datei
    }
  }
  return removed;
}

/** Alle ausgelagerten Dateien (relativer Pfad → Inhalt) – für den Daten-Export. */
export async function readAllUserBlobs(
  fsArg?: SimpleFs | null,
): Promise<Record<string, string>> {
  const fs = activeFs(fsArg);
  const out: Record<string, string> = {};
  if (!fs) return out;
  const root = blobRoot(fs);
  for (const ns of await fs.list(root).catch(() => [] as string[])) {
    for (const name of await fs
      .list(`${root}${ns}/`)
      .catch(() => [] as string[])) {
      if (!name.endsWith(EXT)) continue;
      const content = await fs
        .readText(`${root}${ns}/${name}`)
        .catch(() => null);
      if (content != null) out[`${ns}/${name}`] = content;
    }
  }
  return out;
}

/** Ordner aller ausgelagerten Nutzerdaten-Dateien (für „Alle Daten löschen“). */
export function userBlobRootDir(fsArg?: SimpleFs | null): string | null {
  const fs = activeFs(fsArg);
  return fs ? blobRoot(fs) : null;
}
