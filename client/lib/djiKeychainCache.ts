/**
 * Zwischenspeicher der DJI-Entschlüsselungs-Schlüssel je Flugprotokoll.
 *
 * Einmal abgerufene Keychains (pro Log, nicht der API-Schlüssel!) werden als
 * Datei unter documentDirectory/dji-keychains/ abgelegt – so lässt sich ein
 * verschlüsseltes Log später offline und ohne weiteres API-Kontingent erneut
 * auswerten (Empfehlung von dji-log-parser). Schlüssel ist der Fingerabdruck
 * des Logs aus dem Worker (Version, Größe, Prüfsumme, Seriennummer, Startzeit).
 *
 * RN-frei (Dateisystem über fileStoreFs.ts, in Tests ersetzbar). Ohne
 * Dateisystem (Web) nur im Arbeitsspeicher.
 */
import {
  encodeFileKey,
  getSimpleFs,
  writeTextAtomic,
  type SimpleFs,
} from "./fileStoreFs";
import type { DjiKeychains } from "./djiLogWorkerProtocol";

export const DJI_KEYCHAIN_DIR = "dji-keychains/";

const memory = new Map<string, DjiKeychains>();

function dir(fs: SimpleFs): string | null {
  return fs.root ? `${fs.root}${DJI_KEYCHAIN_DIR}` : null;
}

function pathFor(fs: SimpleFs, fingerprint: string): string | null {
  const d = dir(fs);
  return d ? `${d}${encodeFileKey(fingerprint)}.json` : null;
}

function valid(v: unknown): v is DjiKeychains {
  return (
    Array.isArray(v) &&
    v.every(
      (g) =>
        Array.isArray(g) &&
        g.every(
          (k) =>
            k && typeof k.aesKey === "string" && typeof k.aesIv === "string",
        ),
    )
  );
}

export async function getCachedKeychains(
  fingerprint: string,
  fsArg?: SimpleFs | null,
): Promise<DjiKeychains | null> {
  const mem = memory.get(fingerprint);
  if (mem) return mem;
  const fs = fsArg === undefined ? getSimpleFs() : fsArg;
  const p = fs ? pathFor(fs, fingerprint) : null;
  if (!fs || !p) return null;
  try {
    const text = await fs.readText(p);
    if (!text) return null;
    const parsed = JSON.parse(text) as { keychains?: unknown };
    if (!valid(parsed.keychains)) return null;
    memory.set(fingerprint, parsed.keychains);
    return parsed.keychains;
  } catch {
    return null;
  }
}

export async function setCachedKeychains(
  fingerprint: string,
  keychains: DjiKeychains,
  fsArg?: SimpleFs | null,
): Promise<void> {
  memory.set(fingerprint, keychains);
  const fs = fsArg === undefined ? getSimpleFs() : fsArg;
  const p = fs ? pathFor(fs, fingerprint) : null;
  if (!fs || !p) return;
  try {
    await fs.mkdirp(dir(fs)!);
    await writeTextAtomic(
      fs,
      p,
      JSON.stringify({ v: 1, savedAt: new Date().toISOString(), keychains }),
    );
  } catch {
    // nur im Arbeitsspeicher – nächste Auswertung fragt DJI erneut
  }
}

export async function removeCachedKeychains(
  fingerprint: string,
  fsArg?: SimpleFs | null,
): Promise<void> {
  memory.delete(fingerprint);
  const fs = fsArg === undefined ? getSimpleFs() : fsArg;
  const p = fs ? pathFor(fs, fingerprint) : null;
  if (!fs || !p) return;
  await fs.remove(p).catch(() => {});
}

export function __clearKeychainMemoryForTests(): void {
  memory.clear();
}
