/**
 * Datumshilfen für die native Zeitplanung.
 *
 * DateTimePicker braucht auch im `time`-Modus ein vollständiges Date-Objekt.
 * Dieses Objekt muss auf demselben lokalen Kalendertag wie die Planung liegen;
 * nur Stunde und Minute aus `new Date()` zu übernehmen kann beim Wechsel des
 * Planungstags zu einem inkonsistenten nativen Picker-Zustand führen.
 */

export function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getDeviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function dateForLocalTime(dateKey: string, time: string): Date {
  const date = parseLocalDateKey(dateKey) ?? new Date();
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  date.setHours(
    Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 0,
    Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0,
    0,
    0,
  );
  return date;
}
// Flugfenster (Über-Mitternacht-Regel: Ende <= Start = Folgetag) – die
// Berechnung lebt in shared/, damit auch die Zonen-Aktivitätsprüfung sie nutzt.
export * from "../../shared/flightWindow";
