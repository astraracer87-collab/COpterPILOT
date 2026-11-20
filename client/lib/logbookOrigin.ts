/**
 * Das Logbuch ist kein eigener Tab mehr; es wird aus den Einstellungen oder
 * den Briefings geöffnet. Von wo, merken wir uns hier – für „Zurück“ und die
 * Hervorhebung in der Tab-Leiste.
 */
export type LogbookOrigin = "SettingsTab" | "BriefingsTab";

let origin: LogbookOrigin = "SettingsTab";

export function setLogbookOrigin(o: LogbookOrigin): void {
  origin = o;
}

export function getLogbookOrigin(): LogbookOrigin {
  return origin;
}
