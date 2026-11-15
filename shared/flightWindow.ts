/**
 * Geplantes Flugfenster aus Datum + Start-/Endzeit (lokale Uhrzeit "HH:MM").
 *
 * Regel (überall gleich): Liegt die Endzeit VOR oder GLEICH der Startzeit,
 * endet der Flug am FOLGETAG (23:30–03:00 = 3 h 30 min über Mitternacht).
 * Start == Ende bedeutet ein volles 24-h-Fenster.
 *
 * Reine Funktionen ohne React/RN-Abhängigkeit – genutzt von der Zeitauswahl,
 * dem Sonnenbogen, der Zonen-/Nachtflug-/Tiefflug-Prüfung, Wetter-Abfragen
 * und Logbuch/PDF.
 */

export const MINUTES_PER_DAY = 1440;

/** "HH:MM" → Minuten ab Mitternacht; null bei unlesbarer Angabe. */
export function parseHHMM(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minuten (auch > 1440 oder negativ) → "HH:MM" der Uhrzeit (mod 24 h). */
export function formatHHMM(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Ende in Minuten relativ zur Mitternacht des Planungstags: Ende <= Start wird
 * auf den Folgetag verschoben (Ergebnis dann > 1440).
 */
export function effectiveEndMinutes(startMin: number, endMin: number): number {
  return endMin <= startMin ? endMin + MINUTES_PER_DAY : endMin;
}

/** Dauer in Minuten (1..1440) für Start/Ende in Minuten ab Mitternacht. */
export function windowDurationMinutes(startMin: number, endMin: number): number {
  return effectiveEndMinutes(startMin, endMin) - startMin;
}

/** true, wenn das Fenster über Mitternacht in den Folgetag reicht. */
export function crossesMidnight(startMin: number, endMin: number): boolean {
  return effectiveEndMinutes(startMin, endMin) > MINUTES_PER_DAY;
}

/** "YYYY-MM-DD" → lokale Mitternacht; null bei ungültigem Datum. */
function parseDateKey(dateKey: string | null | undefined): Date | null {
  if (typeof dateKey !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lokales Datum + Minuten ab dessen Mitternacht (DST-sicher über setHours). */
function localDateAtMinutes(base: Date, minutes: number): Date {
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const rest = minutes - dayOffset * MINUTES_PER_DAY;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 0, 0, 0, 0);
  d.setHours(Math.floor(rest / 60), rest % 60, 0, 0);
  return d;
}

export interface FlightWindow {
  /** Start (lokal) am Planungstag. */
  start: Date;
  /** Ende (lokal) – am Folgetag, wenn crossesMidnight. */
  end: Date;
  /** Minuten ab Mitternacht des Planungstags. */
  startMin: number;
  /** Ende in Minuten ab Mitternacht des Planungstags (> 1440 = Folgetag). */
  endMin: number;
  durationMin: number;
  crossesMidnight: boolean;
  /** Kalendertag (YYYY-MM-DD) des Endes. */
  endDateKey: string;
}

/**
 * Baut das Flugfenster. Ohne gültige Endzeit: null-Ende → `fallbackDurationMin`
 * (Standard 60 min). Ohne gültiges Datum/Startzeit: null.
 */
export function computeFlightWindow(
  plannedDate: string | null | undefined,
  plannedTime: string | null | undefined,
  endTime: string | null | undefined,
  fallbackDurationMin = 60,
): FlightWindow | null {
  const base = parseDateKey(plannedDate);
  const startMin = parseHHMM(plannedTime);
  if (!base || startMin == null) return null;
  const rawEnd = parseHHMM(endTime);
  const endMin = rawEnd == null
    ? startMin + Math.max(1, Math.min(MINUTES_PER_DAY, fallbackDurationMin))
    : effectiveEndMinutes(startMin, rawEnd);
  const start = localDateAtMinutes(base, startMin);
  const end = localDateAtMinutes(base, endMin);
  return {
    start,
    end,
    startMin,
    endMin,
    durationMin: endMin - startMin,
    crossesMidnight: endMin > MINUTES_PER_DAY,
    endDateKey: dateKeyOf(end),
  };
}

/**
 * Lokale ISO-Zeitstempel ohne Zeitzone ("YYYY-MM-DDTHH:MM") für Start und
 * Ende – das Ende trägt bei Über-Mitternacht-Flügen das Datum des Folgetags.
 */
export function flightWindowLocalIso(
  plannedDate: string,
  plannedTime: string,
  endTime: string | null | undefined,
): { startIso: string; endIso: string } {
  const w = computeFlightWindow(plannedDate, plannedTime, endTime);
  if (!w) return { startIso: `${plannedDate}T${plannedTime}`, endIso: `${plannedDate}T${endTime ?? plannedTime}` };
  return {
    startIso: `${plannedDate}T${formatHHMM(w.startMin)}`,
    endIso: `${w.endDateKey}T${formatHHMM(w.endMin)}`,
  };
}

/** "3h 30min", "1h", "45min". */
export function formatDurationMinutes(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return `${h}h${m > 0 ? ` ${m}min` : ""}`;
}

/** "23:30–03:00 (+1 Tag)" bzw. "10:00–12:00". */
export function formatFlightWindowRange(
  plannedTime: string,
  endTime: string | null | undefined,
  separator = "–",
): string {
  const s = parseHHMM(plannedTime);
  const e = parseHHMM(endTime);
  if (s == null || e == null) return endTime ? `${plannedTime}${separator}${endTime}` : plannedTime;
  return `${formatHHMM(s)}${separator}${formatHHMM(e)}${crossesMidnight(s, e) ? " (+1 Tag)" : ""}`;
}

/**
 * Prüfzeitpunkte über das ganze Fenster: Start, alle `stepMinutes` und Ende.
 * Für Prüfungen, die "irgendwann im Fenster" gelten (Zonen, Tieffluggebiete).
 */
export function flightWindowSampleTimes(start: Date, end: Date, stepMinutes = 15): Date[] {
  const s = start.getTime();
  const e = end.getTime();
  if (!Number.isFinite(s)) return [];
  if (!Number.isFinite(e) || e <= s) return [new Date(s)];
  const step = Math.max(1, stepMinutes) * 60000;
  const out: Date[] = [];
  for (let t = s; t < e; t += step) out.push(new Date(t));
  out.push(new Date(e));
  return out;
}

/**
 * Anzeige "Start - Ende" für Logbuch/Briefings. Mit gespeicherter Endzeit
 * wird das echte Fenster gezeigt (inkl. "(+1 Tag)"); Altbestände ohne
 * Endzeit behalten die bisherige Anzeige (Start + `legacyHours`).
 */
export function formatPlannedTimeRange(
  plannedTime: string,
  plannedEndTime?: string | null,
  legacyHours = 2,
): string {
  const s = parseHHMM(plannedTime);
  if (s == null) return plannedTime;
  if (parseHHMM(plannedEndTime) != null) return formatFlightWindowRange(plannedTime, plannedEndTime, " - ");
  return `${plannedTime} - ${formatHHMM(s + legacyHours * 60)}`;
}
