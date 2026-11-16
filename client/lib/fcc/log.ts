/** Protokoll mit Stufen (ohne Zeitstempel) für den FCC-Bildschirm. */
export type LogLevel = "step" | "ok" | "warn" | "err" | "info" | "detail";

export interface LogEntry {
  id: number;
  level: LogLevel;
  text: string;
}

let nextId = 1;
let entries: LogEntry[] = [];
let verbose = false;
const listeners = new Set<(e: LogEntry[]) => void>();

function emit() {
  const snapshot = entries;
  listeners.forEach((l) => l(snapshot));
}

function add(level: LogLevel, text: string) {
  if (level === "detail" && !verbose) return;
  entries = [...entries, { id: nextId++, level, text }];
  if (entries.length > 1500) entries = entries.slice(entries.length - 1500);
  emit();
}

export const FccLog = {
  step: (t: string) => add("step", t),
  ok: (t: string) => add("ok", t),
  warn: (t: string) => add("warn", t),
  err: (t: string) => add("err", t),
  info: (t: string) => add("info", t),
  detail: (t: string) => add("detail", t),
  clear: () => {
    entries = [];
    emit();
  },
  all: () => entries,
  setVerbose: (v: boolean) => {
    verbose = v;
  },
  isVerbose: () => verbose,
  subscribe: (l: (e: LogEntry[]) => void) => {
    listeners.add(l);
    l(entries);
    return () => {
      listeners.delete(l);
    };
  },
};
