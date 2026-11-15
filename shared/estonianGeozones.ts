// Estnische Geozonen (EANS / Transpordiamet, utm.eans.ee) – gleiche
// Frequentis-Plattform wie Dronespace Österreich, daher ED-269-Schema.
// Das Feld `restriction` ist dort aber unbrauchbar (fast alles NO_RESTRICTION,
// auch Sperr- und Genehmigungszonen). Die Einstufung kommt deshalb aus der
// Zonenkennung und dem Text – siehe docs/geozonen-weitere-laender.md §6.5.
//
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar).

export const EANS_GEOZONE_SOURCE_LABEL = "EANS / Transpordiamet (utm.eans.ee)";

function englishMessage(p: Record<string, any>): string {
  const msgs = p?.extendedProperties?.localizedMessages;
  if (Array.isArray(msgs)) {
    const en = msgs.find((m: any) => String(m?.language ?? "").toLowerCase().startsWith("en"));
    if (en?.message) return String(en.message);
  }
  return String(p?.message ?? "");
}

function zoneCode(p: Record<string, any>): string {
  return String(p?.identifier ?? p?.name ?? "").trim().toUpperCase();
}

export function isEstonianNotamZone(p: Record<string, any>): boolean {
  return String(p?.metaData?.author ?? "").toUpperCase().includes("NOTAM");
}

/** Einstufung nach Kennung/Text (§6.5). */
export function estonianRestriction(p: Record<string, any>): string {
  const raw = String(p?.restriction ?? "").toUpperCase();
  const text = englishMessage(p).toUpperCase();
  const code = zoneCode(p);
  const reason = String(p?.reason ?? "").toLowerCase();

  if (raw === "PROHIBITED") return "PROHIBITED";
  if (isEstonianNotamZone(p)) return /PROHIBITED/.test(text) ? "PROHIBITED" : "REQ_AUTHORISATION";
  if (code.startsWith("EERZ")) return "REQ_AUTHORISATION";
  if (code.startsWith("EER")) return reason === "nature" ? "NATURE" : "REQ_AUTHORISATION";
  if (code.startsWith("EED")) return "CONDITIONAL";
  if (code.startsWith("EEGZ")) return raw === "REQ_AUTHORISATION" ? "REQ_AUTHORISATION" : "CONDITIONAL";
  if (/PROHIBITED/.test(text)) return "PROHIBITED";
  if (/PERMISSION|AUTHORI[SZ]ATION|COORDINAT/.test(text)) return "REQ_AUTHORISATION";
  if (raw && raw !== "NO_RESTRICTION") return raw;
  return "CONDITIONAL";
}

/** Normalisiert die Properties einer estnischen Zone (Geometrie bleibt). */
export function normalizeEstonianProps(p: Record<string, any>): Record<string, any> {
  const restriction = estonianRestriction(p);
  const out: Record<string, any> = { ...p, restriction, source: EANS_GEOZONE_SOURCE_LABEL };
  if (restriction !== String(p?.restriction ?? "")) out.originalRestriction = p?.restriction ?? null;
  if (isEstonianNotamZone(p)) out.isNotam = true;
  return out;
}
