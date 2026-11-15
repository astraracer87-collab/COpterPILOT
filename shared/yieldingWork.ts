// Kooperative Hintergrundarbeit auf dem EINEN JS-Thread (Hermes).
//
// Befund des Product Owners: „Während die Geozonen laden kann man nichts in der
// App machen“ – Downloads verarbeiten Megabytes JSON (Parse, Normalisierung,
// Komprimierung, Index) synchron und blockieren damit Touch-Ereignisse und
// Rendering für Sekunden. Dieses Modul zerlegt solche Arbeit in Zeitscheiben:
//
//  - shouldYield()/yieldToUi(): nach höchstens SLICE_MS Rechenzeit gibt die
//    laufende Arbeit per setTimeout(0) (Makrotask) an die Ereignisschleife ab –
//    Touch, Navigation und Rendering kommen dazwischen dran. Hat die Nutzerin
//    gerade getippt/gewischt (noteUserActivity), wartet die Arbeit zusätzlich,
//    bis USER_ACTIVITY_QUIET_MS Ruhe ist (höchstens MAX_USER_PAUSE_MS am Stück).
//  - runBackgroundJob(): schwere Hintergrund-Phasen (Verarbeitung eines
//    Downloads, Schreiben großer Dateien, Auto-Aktualisierung) laufen EINE nach
//    der anderen (Warteschlange); das Netz darf parallel laden, die CPU-Phasen
//    sind serialisiert. Abbruch über cancel(), Fortschritt über onProgress.
//    Während Vordergrundarbeit läuft (runForegroundWork, z. B. Kartenabfrage),
//    pausieren Hintergrund-Jobs an ihren Kontrollpunkten.
//  - Hilfen: mapYielding/filterYielding/forEachYielding (Schleifen über
//    Features), stringifyYielding (großes JSON-Objekt in Scheiben serialisieren,
//    byte-identisch zu JSON.stringify), parseJsonYielding (große
//    FeatureCollections ohne einen einzigen riesigen JSON.parse),
//    deflateYielding/inflateYielding (fflate-Streaming statt *Sync).
//
// Rein (keine React-Native-Importe), unter tsx/Node testbar. Uhr, Abgabe und
// Pause sind für Tests austauschbar (__setYieldingWorkEnvForTests).
import { Deflate, Inflate, deflateSync, inflateSync } from "fflate";

/** Ziel-Rechenzeit je Scheibe (ms) – < 1 Frame (16 ms) inkl. Abgabe */
export const SLICE_MS = 12;
/** Nach einer Berührung so lange Ruhe abwarten, bevor Arbeit weiterläuft */
export const USER_ACTIVITY_QUIET_MS = 400;
/** … aber höchstens so lange am Stück pausieren (kein Verhungern) */
export const MAX_USER_PAUSE_MS = 3000;

export interface YieldingEnv {
  now: () => number;
  /** an die Ereignisschleife abgeben (Makrotask) */
  yieldImpl: () => Promise<void>;
  /** ms warten */
  sleep: (ms: number) => Promise<void>;
  sliceMs: number;
}

const defaultNow = (): number => {
  const p = (globalThis as any).performance;
  return p && typeof p.now === "function" ? p.now() : Date.now();
};
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let env: YieldingEnv = {
  now: defaultNow,
  yieldImpl: () => defaultSleep(0),
  sleep: defaultSleep,
  sliceMs: SLICE_MS,
};

let sliceStart = env.now();
let lastUserActivity = -Infinity;
let foregroundActive = 0;

export interface YieldStats {
  /** Anzahl Abgaben */
  yields: number;
  /** längste beobachtete Scheibe (ms, zwischen zwei Abgaben) */
  maxSliceMs: number;
  /** Bezeichnung der Stelle mit der längsten Scheibe (Diagnose) */
  maxSliceAt?: string;
}
let stats: YieldStats = { yields: 0, maxSliceMs: 0 };

/** Nur für Tests: Uhr/Abgabe ersetzen (null = Standard) und Zustand leeren. */
export function __setYieldingWorkEnvForTests(e: Partial<YieldingEnv> | null): void {
  env = {
    now: e?.now ?? defaultNow,
    yieldImpl: e?.yieldImpl ?? (() => defaultSleep(0)),
    sleep: e?.sleep ?? defaultSleep,
    sliceMs: e?.sliceMs ?? SLICE_MS,
  };
  sliceStart = env.now();
  lastUserActivity = -Infinity;
  foregroundActive = 0;
  stats = { yields: 0, maxSliceMs: 0 };
  queue.length = 0;
  runningJob = null;
  blockingState = null;
  blockingDepth = 0;
}

export function getYieldStats(): YieldStats {
  return { ...stats };
}

export function resetYieldStats(): void {
  stats = { yields: 0, maxSliceMs: 0 };
  sliceStart = env.now();
}

/** Rechenzeit der laufenden Scheibe (ms). */
export function currentSliceMs(): number {
  return env.now() - sliceStart;
}

/** Ist die Zeitscheibe aufgebraucht? (billig – in heißen Schleifen nutzbar) */
export function shouldYield(): boolean {
  return env.now() - sliceStart >= env.sliceMs;
}

/** Berührung/Geste gesehen (App-Wurzel ruft das bei onTouchStart auf). */
export function noteUserActivity(at: number = env.now()): void {
  lastUserActivity = at;
}

/** Hat die Nutzerin gerade interagiert? */
export function isUserActive(): boolean {
  return env.now() - lastUserActivity < USER_ACTIVITY_QUIET_MS;
}

function recordSlice(label?: string): void {
  const d = env.now() - sliceStart;
  if (d > stats.maxSliceMs) {
    stats.maxSliceMs = d;
    stats.maxSliceAt = label;
  }
}

/**
 * An die Ereignisschleife abgeben; während Interaktion zusätzlich pausieren.
 * Setzt danach eine neue Zeitscheibe.
 */
export async function yieldToUi(label?: string): Promise<void> {
  recordSlice(label);
  stats.yields++;
  await env.yieldImpl();
  const t0 = env.now();
  while (isUserActive() && env.now() - t0 < MAX_USER_PAUSE_MS) {
    await env.sleep(50);
  }
  sliceStart = env.now();
}

/**
 * Warten, bis die App ruhig ist (keine Berührung seit USER_ACTIVITY_QUIET_MS,
 * keine Vordergrundarbeit) – höchstens `maxMs`. Für niedrig priorisierte
 * Folgeaufgaben (z. B. nächstes Land der Auto-Aktualisierung).
 */
export async function waitForIdle(maxMs = 10_000): Promise<void> {
  const t0 = env.now();
  await env.yieldImpl();
  while ((isUserActive() || foregroundActive > 0) && env.now() - t0 < maxMs) await env.sleep(100);
  sliceStart = env.now();
}

/** Abgeben, falls die Zeitscheibe aufgebraucht ist. */
export async function checkpoint(label?: string): Promise<void> {
  if (shouldYield()) await yieldToUi(label);
}

// ---------------------------------------------------------------------------
// Schleifen-Helfer
// ---------------------------------------------------------------------------

export interface Yielder {
  shouldYield(): boolean;
  yield(label?: string): Promise<void>;
}

/** Standard-Abgabe (global) */
export const defaultYielder: Yielder = { shouldYield, yield: yieldToUi };

/** map() mit Abgaben zwischen Elementen; Ergebnis identisch zu arr.map(fn). */
export async function mapYielding<T, R>(arr: readonly T[], fn: (x: T, i: number) => R, y: Yielder = defaultYielder): Promise<R[]> {
  const out = new Array<R>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = fn(arr[i], i);
    if (y.shouldYield()) await y.yield("map");
  }
  return out;
}

/** filter() mit Abgaben; Ergebnis identisch zu arr.filter(fn). */
export async function filterYielding<T>(arr: readonly T[], fn: (x: T, i: number) => unknown, y: Yielder = defaultYielder): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (fn(arr[i], i)) out.push(arr[i]);
    if (y.shouldYield()) await y.yield("filter");
  }
  return out;
}

/** forEach() mit Abgaben. */
export async function forEachYielding<T>(arr: readonly T[], fn: (x: T, i: number) => void, y: Yielder = defaultYielder): Promise<void> {
  for (let i = 0; i < arr.length; i++) {
    fn(arr[i], i);
    if (y.shouldYield()) await y.yield("forEach");
  }
}

// ---------------------------------------------------------------------------
// Warteschlange für schwere Hintergrund-Jobs
// ---------------------------------------------------------------------------

export class WorkCancelledError extends Error {
  constructor(label?: string) {
    super(`Abgebrochen${label ? `: ${label}` : ""}`);
    this.name = "WorkCancelledError";
  }
}

export interface JobContext extends Yielder {
  readonly label: string;
  readonly cancelled: boolean;
  /** abgeben, falls fällig; wirft WorkCancelledError nach cancel() */
  checkpoint(): Promise<void>;
  /** Fortschritt 0..1 melden (Download-Anzeige) */
  progress(fraction: number): void;
}

export interface JobHandle<T> {
  promise: Promise<T>;
  cancel(): void;
}

export interface BackgroundJobOptions {
  onProgress?: (fraction: number) => void;
  /** wird bei Start geprüft und an jedem Kontrollpunkt */
  isCancelled?: () => boolean;
}

interface QueuedJob {
  label: string;
  start: () => void;
}
const queue: QueuedJob[] = [];
let runningJob: QueuedJob | null = null;

function pump(): void {
  if (runningJob) return;
  const next = queue.shift();
  if (!next) return;
  runningJob = next;
  next.start();
}

/** Anzahl wartender + laufender Hintergrund-Jobs (Diagnose/Tests). */
export function backgroundJobCount(): number {
  return queue.length + (runningJob ? 1 : 0);
}

/**
 * Schwere Hintergrundarbeit einreihen: Jobs laufen nacheinander (FIFO),
 * time-sliced (ctx.checkpoint()), pausieren während Vordergrundarbeit und
 * Interaktion. NICHT verschachteln (ein Job darf nicht auf einen weiteren
 * runBackgroundJob warten – Verklemmung); Unterfunktionen bekommen `ctx`.
 */
export function runBackgroundJob<T>(label: string, fn: (ctx: JobContext) => Promise<T>, opts: BackgroundJobOptions = {}): JobHandle<T> {
  let cancelled = false;
  let started = false;
  let rejectQueued: ((e: unknown) => void) | null = null;
  const isCancelled = () => cancelled || !!opts.isCancelled?.();
  const ctx: JobContext = {
    label,
    get cancelled() {
      return isCancelled();
    },
    shouldYield,
    async yield(l?: string) {
      await yieldToUi(l ?? label);
      // Vordergrundarbeit (Nutzer wartet) hat Vorrang
      const t0 = env.now();
      while (foregroundActive > 0 && env.now() - t0 < 30_000) await env.sleep(16);
      if (isCancelled()) throw new WorkCancelledError(label);
    },
    async checkpoint() {
      if (isCancelled()) throw new WorkCancelledError(label);
      if (shouldYield()) await ctx.yield();
    },
    progress(f: number) {
      try {
        opts.onProgress?.(Math.max(0, Math.min(1, f)));
      } catch {}
    },
  };
  let job: QueuedJob | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    rejectQueued = reject;
    job = {
      label,
      start: () => {
        started = true;
        void (async () => {
          try {
            if (isCancelled()) throw new WorkCancelledError(label);
            // erst nach einer Abgabe beginnen (der Aufrufer-Frame endet zuerst)
            await ctx.yield();
            resolve(await fn(ctx));
          } catch (e) {
            reject(e);
          } finally {
            runningJob = null;
            pump();
          }
        })();
      },
    };
    queue.push(job);
  });
  pump();
  return {
    promise,
    cancel() {
      cancelled = true;
      if (!started && job) {
        const i = queue.indexOf(job);
        if (i >= 0) queue.splice(i, 1);
        rejectQueued?.(new WorkCancelledError(label));
      }
    },
  };
}

/** Schweren Job einreihen und auf das Ergebnis warten (Kurzform). */
export function runInBackground<T>(label: string, fn: (ctx: JobContext) => Promise<T>, opts?: BackgroundJobOptions): Promise<T> {
  return runBackgroundJob(label, fn, opts).promise;
}

/**
 * Vordergrundarbeit (die Nutzerin wartet darauf, z. B. Kartenabfrage):
 * Hintergrund-Jobs pausieren an ihren Kontrollpunkten, bis sie fertig ist.
 */
export async function runForegroundWork<T>(fn: () => Promise<T>): Promise<T> {
  foregroundActive++;
  try {
    return await fn();
  } finally {
    foregroundActive--;
  }
}

// ---------------------------------------------------------------------------
// JSON in Scheiben
// ---------------------------------------------------------------------------

const ARRAY_SLICE_ITEMS = 64;

/**
 * JSON.stringify eines Objekts, dessen große Arrays (oberste Ebene) in
 * Scheiben serialisiert werden – Ergebnis byte-identisch zu
 * JSON.stringify(obj) für einfache Daten (ohne toJSON/replacer/space).
 * Große Arrays: mindestens `minArray` Elemente.
 */
export async function stringifyYielding(obj: unknown, y: Yielder = defaultYielder, minArray = ARRAY_SLICE_ITEMS): Promise<string> {
  if (Array.isArray(obj)) return stringifyArray(obj, y);
  if (!obj || typeof obj !== "object" || typeof (obj as any).toJSON === "function") return JSON.stringify(obj);
  const parts: string[] = [];
  for (const key of Object.keys(obj)) {
    const v = (obj as any)[key];
    if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
    const k = JSON.stringify(key);
    if (Array.isArray(v) && v.length >= minArray) parts.push(`${k}:${await stringifyArray(v, y)}`);
    else parts.push(`${k}:${JSON.stringify(v)}`);
    if (y.shouldYield()) await y.yield("stringify");
  }
  return `{${parts.join(",")}}`;
}

async function stringifyArray(arr: readonly unknown[], y: Yielder): Promise<string> {
  const parts: string[] = [];
  // adaptiv: Scheibengröße so wählen, dass eine Scheibe ≈ ein paar ms dauert
  let step = 1;
  for (let i = 0; i < arr.length; ) {
    const t0 = defaultNow();
    const end = Math.min(arr.length, i + step);
    const s = JSON.stringify(arr.slice(i, end));
    if (s.length > 2) parts.push(s.slice(1, -1));
    i = end;
    const dt = defaultNow() - t0;
    // Größe der Teile begrenzen: einzelne Features sind bis > 1 MB groß
    if (dt > 4 || s.length > 256 * 1024) step = Math.max(1, step >> 2);
    else if (dt < 1.5 && s.length < 64 * 1024 && step < 16384) step *= 2;
    if (y.shouldYield()) await y.yield("stringify");
  }
  return `[${parts.join(",")}]`;
}

/** Ab dieser Textlänge lohnt sich das zerlegte Parsen (kleiner: JSON.parse). */
export const SPLIT_PARSE_MIN_CHARS = 512 * 1024;
/** Zielgröße eines Teil-Parse (Zeichen) */
const SPLIT_PARSE_GROUP_CHARS = 192 * 1024;

const WS = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

/** Ende eines JSON-Strings ab Anführungszeichen bei `i` (Index des schließenden "). */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  for (;;) {
    const q = text.indexOf('"', j);
    if (q < 0) return -1;
    // Backslashes davor zählen
    let b = q - 1;
    let n = 0;
    while (b > i && text.charCodeAt(b) === 92) {
      n++;
      b--;
    }
    if (n % 2 === 0) return q;
    j = q + 1;
  }
}

/** Nächstes struktur-relevantes Zeichen ({ } ") ab i – Klammern [] werden übersprungen. */
function nextBraceOrQuote(text: string, i: number): number {
  let best = -1;
  for (const ch of ['"', "{", "}"]) {
    const p = text.indexOf(ch, i);
    if (p >= 0 && (best < 0 || p < best)) best = p;
  }
  return best;
}

interface TopArray {
  key: string;
  /** Position von '[' */
  start: number;
  /** Position von ']' */
  end: number;
  /** Teil-Texte: [start, endExclusive] je Gruppe (ohne Klammern) */
  groups: number[];
}

/** Ende ']' eines Arrays von Objekten ab '[' bei `open`; Gruppen-Grenzen gesammelt. */
async function scanObjectArray(text: string, open: number, y: Yielder): Promise<TopArray | null> {
  const groups: number[] = [];
  let groupStart = -1;
  let lastEnd = -1;
  let count = 0;
  let k = open + 1;
  for (;;) {
    while (k < text.length && WS(text.charCodeAt(k))) k++;
    const c = text.charCodeAt(k);
    if (c === 93) break; // ]
    if (count > 0) {
      if (c !== 44) return null; // ,
      k++;
      while (k < text.length && WS(text.charCodeAt(k))) k++;
    }
    if (text.charCodeAt(k) !== 123) return null; // nur Objekt-Arrays
    const start = k;
    let d = 0;
    let p = k;
    for (;;) {
      const q = nextBraceOrQuote(text, p);
      if (q < 0) return null;
      const ch = text.charCodeAt(q);
      if (ch === 34) {
        const e = stringEnd(text, q);
        if (e < 0) return null;
        p = e + 1;
      } else if (ch === 123) {
        d++;
        p = q + 1;
      } else {
        d--;
        p = q + 1;
        if (d === 0) break;
      }
    }
    if (groupStart < 0) groupStart = start;
    lastEnd = p;
    count++;
    if (lastEnd - groupStart >= SPLIT_PARSE_GROUP_CHARS) {
      groups.push(groupStart, lastEnd);
      groupStart = -1;
    }
    k = p;
    if (y.shouldYield()) await y.yield("json-split");
  }
  if (groupStart >= 0) groups.push(groupStart, lastEnd);
  return { key: "", start: open, end: k, groups };
}

/**
 * Array aus Zahlen/Strings/true/false/null ab '[' bei `open`: Schnitt an
 * Kommas außerhalb von Strings (nur Anführungszeichen werden verfolgt). null
 * bei verschachtelten Arrays/Objekten.
 */
async function scanPrimitiveArray(text: string, open: number, y: Yielder): Promise<TopArray | null> {
  // indexOf-Ergebnisse zwischenspeichern (sonst quadratisch bei vielen Strings)
  const cache: Record<string, number> = {};
  const find = (ch: string, from: number): number => {
    const c = cache[ch];
    if (c !== undefined && (c >= from || c === -1)) return c === -1 ? -1 : c;
    const r = text.indexOf(ch, from);
    cache[ch] = r;
    return r;
  };
  // ']' außerhalb von Strings
  let end = -1;
  {
    let p = open + 1;
    for (;;) {
      const br = find("]", p);
      const q = find('"', p);
      if (br < 0) return null;
      if (q < 0 || br < q) {
        end = br;
        break;
      }
      const e = stringEnd(text, q);
      if (e < 0) return null;
      p = e + 1;
      if ((p & 1023) === 0 && y.shouldYield()) await y.yield("json-split");
    }
  }
  for (const k of Object.keys(cache)) delete cache[k];
  const groups: number[] = [];
  let pos = open + 1;
  while (pos < end) {
    let target = Math.min(end, pos + SPLIT_PARSE_GROUP_CHARS);
    if (target >= end) {
      groups.push(pos, end);
      break;
    }
    // Strings bis über target hinaus überspringen
    let p = pos;
    for (;;) {
      const q = find('"', p);
      if (q < 0 || q >= target) break;
      const e = stringEnd(text, q);
      if (e < 0) return null;
      p = e + 1;
      if (p > target) target = p;
    }
    // nächstes Komma außerhalb von Strings ab target
    let cut = -1;
    let r = target;
    for (;;) {
      const cm = find(",", r);
      if (cm < 0 || cm >= end) break;
      const q = find('"', r);
      if (q < 0 || cm < q) {
        cut = cm;
        break;
      }
      const e = stringEnd(text, q);
      if (e < 0) return null;
      r = e + 1;
    }
    if (cut < 0) {
      groups.push(pos, end);
      break;
    }
    groups.push(pos, cut);
    pos = cut + 1;
    if (y.shouldYield()) await y.yield("json-split");
  }
  return { key: "", start: open, end, groups };
}

/**
 * Große Arrays auf oberster Ebene eines JSON-Objekts finden (Objekt-Arrays wie
 * `features` und Arrays einfacher Werte wie `entries`/`ids`). Durchläuft nur
 * Anführungszeichen und geschweifte Klammern (indexOf, nativ) – Koordinaten-
 * listen werden übersprungen. null = Struktur passt nicht (Aufrufer nutzt
 * JSON.parse – gleiches Ergebnis, gleiche Fehler).
 */
async function findTopLevelArrays(text: string, minChars: number, y: Yielder): Promise<TopArray[] | null> {
  let i = 0;
  while (i < text.length && WS(text.charCodeAt(i))) i++;
  if (text.charCodeAt(i) !== 123) return null; // {
  let depth = 0;
  let pos = i;
  const out: TopArray[] = [];
  // doppelte Schlüssel: JSON.parse nimmt den letzten Wert – nur dieses Array zerlegen
  const lastOf = new Map<string, TopArray | null>();
  for (;;) {
    const p = nextBraceOrQuote(text, pos);
    if (p < 0) return null;
    const c = text.charCodeAt(p);
    if (c === 34) {
      const e = stringEnd(text, p);
      if (e < 0) return null;
      pos = e + 1;
      if (depth === 1) {
        let k = e + 1;
        while (k < text.length && WS(text.charCodeAt(k))) k++;
        if (text.charCodeAt(k) === 58) {
          // Schlüssel auf oberster Ebene
          k++;
          while (k < text.length && WS(text.charCodeAt(k))) k++;
          if (text.charCodeAt(k) === 91) {
            let f = k + 1;
            while (f < text.length && WS(text.charCodeAt(f))) f++;
            const first = text.charCodeAt(f);
            let arr: TopArray | null = null;
            if (first === 123) arr = await scanObjectArray(text, k, y);
            else if (first !== 91) arr = await scanPrimitiveArray(text, k, y);
            if (!arr) return null;
            arr.key = JSON.parse(text.slice(p, e + 1));
            lastOf.set(arr.key, arr);
            if (arr.end - arr.start >= minChars && arr.key !== "__proto__") out.push(arr);
            pos = arr.end + 1;
          } else {
            lastOf.set(JSON.parse(text.slice(p, e + 1)), null);
          }
        }
      }
    } else if (c === 123) {
      depth++;
      pos = p + 1;
    } else {
      depth--;
      pos = p + 1;
      if (depth === 0) break;
    }
    if (y.shouldYield()) await y.yield("json-split");
  }
  return out.filter((a) => lastOf.get(a.key) === a);
}

/**
 * JSON.parse in Scheiben für große Objekte mit großen Arrays auf oberster
 * Ebene (FeatureCollections: `features`; Kachel-Index: `entries`/`ids`;
 * Geräte-Bestände): die Arrays werden gruppenweise geparst (je ≈ 192 KB,
 * nativ), dazwischen wird abgegeben. Ergebnis identisch zu JSON.parse(text);
 * bei unerwarteter Struktur oder kleinem Text wird JSON.parse(text) verwendet.
 */
export async function parseJsonYielding(text: string, opts: { yielder?: Yielder; minChars?: number } = {}): Promise<any> {
  const y = opts.yielder ?? defaultYielder;
  if (text.length < (opts.minChars ?? SPLIT_PARSE_MIN_CHARS)) return JSON.parse(text);
  const arrays = await findTopLevelArrays(text, 32 * 1024, y);
  if (!arrays || arrays.length === 0) {
    if (y.shouldYield()) await y.yield("json-parse");
    return JSON.parse(text);
  }
  // Rest des Objekts mit leeren Arrays parsen (klein) – prüft zugleich die Syntax
  const headParts: string[] = [];
  let last = 0;
  for (const a of arrays) {
    headParts.push(text.slice(last, a.start), "[]");
    last = a.end + 1;
  }
  headParts.push(text.slice(last));
  const head = JSON.parse(headParts.join(""));
  if (y.shouldYield()) await y.yield("json-parse");
  for (const a of arrays) {
    const items: any[] = [];
    for (let g = 0; g < a.groups.length; g += 2) {
      const arr = JSON.parse(`[${text.slice(a.groups[g], a.groups[g + 1])}]`) as any[];
      for (let n = 0; n < arr.length; n++) items.push(arr[n]);
      if (y.shouldYield()) await y.yield("json-parse");
    }
    head[a.key] = items;
  }
  return head;
}

/**
 * JSON-Text (oft riesig) aus einer fetch-Antwort lesen und in Scheiben parsen.
 * Ersetzt `await res.json()`.
 */
export async function responseJsonYielding(
  res: { text?: () => Promise<string>; json?: () => Promise<any> },
  opts?: { yielder?: Yielder },
): Promise<any> {
  if (typeof res.text !== "function") return res.json!();
  const text = await res.text();
  return parseJsonYielding(text, opts);
}

// ---------------------------------------------------------------------------
// fflate in Scheiben (Streaming-Klassen statt *Sync – Hermes kennt keine Worker)
// ---------------------------------------------------------------------------

/** Ab dieser Größe wird gestreamt (kleiner: *Sync, < 1 ms) */
export const STREAM_MIN_BYTES = 64 * 1024;
const STREAM_CHUNK = 32 * 1024;

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * raw DEFLATE in Scheiben. Verlustfrei; die komprimierten Bytes können sich
 * von deflateSync unterscheiden (Blockgrenzen), entpackt ist der Inhalt identisch.
 */
export async function deflateYielding(data: Uint8Array, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6, y: Yielder = defaultYielder): Promise<Uint8Array> {
  if (data.length < STREAM_MIN_BYTES) return deflateSync(data, { level });
  const parts: Uint8Array[] = [];
  const d = new Deflate({ level }, (chunk) => parts.push(chunk));
  for (let i = 0; i < data.length; i += STREAM_CHUNK) {
    const end = Math.min(data.length, i + STREAM_CHUNK);
    d.push(data.subarray(i, end), end >= data.length);
    if (y.shouldYield()) await y.yield("deflate");
  }
  return concat(parts);
}

/** raw INFLATE in Scheiben (Ergebnis identisch zu inflateSync). */
export async function inflateYielding(data: Uint8Array, y: Yielder = defaultYielder): Promise<Uint8Array> {
  if (data.length < STREAM_MIN_BYTES / 4) return inflateSync(data);
  const parts: Uint8Array[] = [];
  const d = new Inflate((chunk) => parts.push(chunk));
  const step = STREAM_CHUNK / 4;
  for (let i = 0; i < data.length; i += step) {
    const end = Math.min(data.length, i + step);
    d.push(data.subarray(i, end), end >= data.length);
    if (y.shouldYield()) await y.yield("inflate");
  }
  return concat(parts);
}

// ---------------------------------------------------------------------------
// Nicht zerlegbare Arbeit: bewusstes Vollbild-Overlay (Product Owner)
// ---------------------------------------------------------------------------
//
// Regel: Eine halb eingefrorene App (UI sichtbar, Tipps reagieren nicht) ist
// nicht akzeptabel. Was sich nicht in Scheiben teilen lässt und auf dem Gerät
// voraussichtlich > ~300 ms blockiert, läuft über runBlocking(): erst wird das
// Overlay „Bitte warten – Daten werden verarbeitet“ gesetzt und gemalt
// (nächster Frame), dann läuft die Arbeit, danach verschwindet es. Das Overlay
// (client/components/BlockingWorkOverlay.tsx) fängt alle Berührungen ab.

export interface BlockingWorkState {
  label: string;
  /** Land (ISO) */
  iso?: string;
  /** Schritt, z. B. „Index wird aufgebaut“ */
  step?: string;
  /** 0..1, falls bekannt */
  fraction?: number;
}

let blockingState: BlockingWorkState | null = null;
let blockingDepth = 0;
const blockingListeners = new Set<() => void>();
/** wartet, bis das Overlay sicher gemalt ist (Gerät: rAF + setTimeout) */
let waitForPaint: () => Promise<void> = () =>
  new Promise<void>((resolve) => {
    const raf = (globalThis as any).requestAnimationFrame as ((cb: () => void) => void) | undefined;
    if (typeof raf === "function") raf(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });

function emitBlocking(): void {
  for (const l of blockingListeners) {
    try {
      l();
    } catch {}
  }
}

export function getBlockingWork(): BlockingWorkState | null {
  return blockingState;
}

export function subscribeBlockingWork(l: () => void): () => void {
  blockingListeners.add(l);
  return () => {
    blockingListeners.delete(l);
  };
}

/** Nur für Tests: Paint-Warten ersetzen. */
export function __setWaitForPaintForTests(fn: (() => Promise<void>) | null): void {
  waitForPaint =
    fn ??
    (() =>
      new Promise<void>((resolve) => {
        const raf = (globalThis as any).requestAnimationFrame as ((cb: () => void) => void) | undefined;
        if (typeof raf === "function") raf(() => setTimeout(resolve, 0));
        else setTimeout(resolve, 0);
      }));
}

/**
 * Nicht zerlegbare, lange blockierende Arbeit hinter dem Vollbild-Overlay
 * ausführen. `fn` bekommt `update` für Schritt/Fortschritt (wird zwischen
 * Teilschritten gemalt, wenn `fn` selbst awaitet).
 */
export async function runBlocking<T>(
  state: BlockingWorkState,
  fn: (update: (patch: Partial<BlockingWorkState>) => Promise<void>) => Promise<T> | T,
): Promise<T> {
  blockingDepth++;
  blockingState = { ...state };
  emitBlocking();
  try {
    await waitForPaint();
    const update = async (patch: Partial<BlockingWorkState>) => {
      blockingState = { ...(blockingState ?? state), ...patch };
      emitBlocking();
      await waitForPaint();
    };
    return await fn(update);
  } finally {
    blockingDepth--;
    if (blockingDepth === 0) {
      blockingState = null;
      emitBlocking();
    }
  }
}
