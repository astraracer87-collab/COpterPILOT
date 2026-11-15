/**
 * Übersetzung neuer Behördentexte per DeepL (optional, eigener Schlüssel).
 *
 * Das mitgelieferte Wörterbuch (shared/data/zoneTranslationsDe.json) deckt alle
 * bekannten Texte ab. Taucht nach einem Länder-Download ein neuer Text auf und
 * ist ein DeepL-Schlüssel eingetragen, wird er einmal übersetzt und dauerhaft
 * auf dem Gerät gespeichert (danach auch offline). Ohne Schlüssel bleibt der
 * Originaltext stehen.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { onEd269Downloaded } from "@/lib/geozoneDirect/ed269Store";
import type { GeoFeature } from "@/lib/geozoneDirect/ed269Sources";
import { addRuntimeTranslations, hasGermanFor, translationKey } from "../../shared/zoneTranslate";
import { shouldYield, yieldToUi } from "../../shared/yieldingWork";

const KEY_NAME = "deepl_api_key";
const CACHE_FILE = `${FileSystem.documentDirectory}zone-translations-de.json`;

type Cache = { lines: Record<string, string>; names: Record<string, string> };
let cache: Cache = { lines: {}, names: {} };
let loaded = false;

async function loadCache(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const info = await FileSystem.getInfoAsync(CACHE_FILE);
    if (!info.exists) return;
    const c = JSON.parse(await FileSystem.readAsStringAsync(CACHE_FILE)) as Cache;
    cache = { lines: c.lines ?? {}, names: c.names ?? {} };
    addRuntimeTranslations(cache.lines, "line");
    addRuntimeTranslations(cache.names, "name");
  } catch {}
}

async function saveCache(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(cache));
  } catch {}
}

export async function getDeeplKey(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(KEY_NAME)) || null;
  } catch {
    return null;
  }
}

function endpoint(key: string): string {
  return key.trim().endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

export async function setDeeplKey(raw: string): Promise<{ ok: boolean; error?: string }> {
  const key = raw.trim();
  if (key.length < 20) return { ok: false, error: "Das sieht nicht wie ein DeepL-Schlüssel aus." };
  try {
    const res = await fetch(`${endpoint(key)}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${key}` } });
    if (res.status === 403) return { ok: false, error: "DeepL lehnt den Schlüssel ab." };
    if (!res.ok) return { ok: false, error: `DeepL antwortet mit ${res.status}.` };
    await SecureStore.setItemAsync(KEY_NAME, key);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `Prüfen fehlgeschlagen: ${e?.message ?? "keine Verbindung"}` };
  }
}

export async function clearDeeplKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_NAME).catch(() => {});
}

async function deeplTranslate(key: string, texts: string[]): Promise<string[]> {
  const body = new URLSearchParams();
  for (const t of texts) body.append("text", t);
  body.append("target_lang", "DE");
  const res = await fetch(`${endpoint(key)}/v2/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}`);
  const j: any = await res.json();
  return (j?.translations ?? []).map((t: any) => String(t?.text ?? ""));
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
}

/** Sammelt Texte eines Länder-Datensatzes, die noch keine deutsche Fassung haben. */
export function missingTexts(features: GeoFeature[]): { lines: string[]; names: string[] } {
  const lines = new Set<string>();
  const names = new Set<string>();
  for (const f of features) collectMissing(f, lines, names);
  return { lines: [...lines], names: [...names] };
}

/** Wie missingTexts, in Zeitscheiben (CH ≈ 30 ms Node am Stück). Ergebnis identisch. */
export async function missingTextsYielding(features: GeoFeature[]): Promise<{ lines: string[]; names: string[] }> {
  const lines = new Set<string>();
  const names = new Set<string>();
  for (const f of features) {
    collectMissing(f, lines, names);
    if (shouldYield()) await yieldToUi("translate-scan");
  }
  return { lines: [...lines], names: [...names] };
}

function collectMissing(f: GeoFeature, lines: Set<string>, names: Set<string>): void {
  const p: any = f.properties || {};
  const name = String(p.name ?? "").trim();
  if (name && !hasGermanFor(name, "name")) names.add(translationKey(name));
  const loc = p.extendedProperties?.localizedMessages;
  if (Array.isArray(loc) && loc.some((m: any) => String(m?.language ?? "").toLowerCase().startsWith("de"))) return;
  const msg =
    (Array.isArray(loc) && (loc.find((m: any) => String(m?.language ?? "").toLowerCase().startsWith("en")) ?? loc[0])?.message) ||
    p.message ||
    "";
  for (const line of stripHtml(String(msg)).split("\n")) {
    const k = translationKey(line);
    if (k && /[A-Za-zÀ-ÿ]{3}/.test(k) && !hasGermanFor(k, "line")) lines.add(k);
  }
}

async function translateMissing(_iso: string, features: GeoFeature[]): Promise<void> {
  await loadCache();
  const key = await getDeeplKey();
  if (!key) return;
  const { lines, names } = await missingTextsYielding(features);
  const run = async (items: string[], kind: "line" | "name") => {
    for (let i = 0; i < items.length; i += 40) {
      const batch = items.slice(i, i + 40);
      const out = await deeplTranslate(key, batch);
      const add: Record<string, string> = {};
      batch.forEach((orig, j) => {
        if (out[j]) add[orig] = out[j];
      });
      Object.assign(kind === "name" ? cache.names : cache.lines, add);
      addRuntimeTranslations(add, kind);
    }
  };
  try {
    await run(lines, "line");
    await run(names, "name");
  } finally {
    await saveCache();
  }
}

let started = false;
/** Beim App-Start einmal aufrufen. */
export function startZoneTranslation(): void {
  if (started) return;
  started = true;
  loadCache().catch(() => {});
  onEd269Downloaded((iso, features) => translateMissing(iso, features));
}
