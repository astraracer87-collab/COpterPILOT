// Frankreich kennt verschiedene Beschränkungs-Zonentypen (Flughafen-CTR,
// militärische Sperrgebiete, Atomanlagen, Justizvollzug, Naturschutz,
// Städte/Ballungsräume). Der DGAC-WMS-Layer liefert nur `limite` und
// `remarque`; daraus wird der Typ heuristisch erkannt, um pro Typ passende
// kuratierte Hinweise/Ansprechpartner statt eines generischen Sammeleintrags
// auszuspielen. Dieses Modul ist bewusst frei von React-Native-Imports,
// damit die Klassifizierung isoliert getestet werden kann.

import type { Restriction } from "../../shared/restrictionPolicy";

export type FrZoneTypeKey =
  | "nucleaire"
  | "militaire"
  | "penitentiaire"
  | "aeroport"
  | "parc"
  | "agglomeration"
  | "interdit"
  | "generique";

export interface FrZoneTypeInfo {
  label: string;
  auflage: string;
  kontakt: string;
}

export const FR_ZONE_TYPES: Record<FrZoneTypeKey, FrZoneTypeInfo> = {
  nucleaire: {
    label: "Atomanlage / Kerntechnik",
    auflage:
      "Kerntechnische Anlage (CNPE) — vollständiges Flugverbot im Umkreis. Überflug ist strafbar (Code de la défense / Code des transports).",
    kontakt:
      "Keine Freigabe für Freizeitflüge. Bei dienstlichem Bedarf Anlagenbetreiber, Präfektur und DSAC-Regionaldirektion kontaktieren.",
  },
  militaire: {
    label: "Militärisches Sperrgebiet",
    auflage:
      "Militärisch genutztes Gebiet — Betrieb grundsätzlich verboten. Ausnahmen nur mit Genehmigung der zuständigen Militärbehörde.",
    kontakt:
      "Zuständige Präfektur (préfecture) bzw. Militärbehörde / DSAC-Regionaldirektion kontaktieren.",
  },
  penitentiaire: {
    label: "Justizvollzugsanstalt",
    auflage:
      "Justizvollzugsanstalt — Überflug verboten. Betrieb nur mit ausdrücklicher Genehmigung zulässig.",
    kontakt:
      "Genehmigung über die zuständige Präfektur bzw. die Anstaltsleitung einholen.",
  },
  aeroport: {
    label: "Flughafen-Umgebung (CTR)",
    auflage:
      "Kontrollzone / Flughafenumgebung — Betrieb nur nach Abstimmung mit der Flugsicherung (SNA). Ohne Freigabe Flugverbot, innerhalb der CTR reduzierte Höhe.",
    kontakt:
      "Zuständige DSAC-Regionaldirektion / SNA bzw. Flughafenbetreiber kontaktieren.",
  },
  parc: {
    label: "Naturschutz / Nationalpark",
    auflage:
      "Naturschutzgebiet / Nationalpark — Drohnenbetrieb i.d.R. untersagt oder genehmigungspflichtig (Schutz von Fauna und Ruhezonen).",
    kontakt:
      "Parkverwaltung (établissement public du parc) bzw. zuständige Präfektur kontaktieren.",
  },
  agglomeration: {
    label: "Stadt / Ballungsraum",
    auflage:
      "Stadt / Menschenansammlung — Betrieb über bebautem Gebiet und über Personen nur unter besonderen Auflagen (Unterkategorie / Genehmigung).",
    kontakt:
      "Zuständige Präfektur bzw. DSAC-Regionaldirektion kontaktieren.",
  },
  interdit: {
    label: "Sperrgebiet (Flugverbot)",
    auflage:
      "Flugverbot — Betrieb nur mit ausdrücklicher Genehmigung zulässig.",
    kontakt:
      "Zuständige DSAC-Regionaldirektion / Präfektur kontaktieren.",
  },
  generique: {
    label: "Drohnen-Beschränkungszone",
    auflage:
      "Betrieb nur unter den angegebenen Bedingungen (Höhenbegrenzung) zulässig.",
    kontakt:
      "Bei Genehmigungsbedarf DSAC-Regionaldirektion / Präfektur kontaktieren.",
  },
};

// Zonentyp → geschlossene Einstufung (shared/restrictionPolicy.ts). Die
// DGAC-Daten tragen keine strukturierte Einstufung; die bestehende Text-
// Heuristik (classifyFrRestrictionType) liefert den Typ.
const FR_TYPE_RESTRICTION: Record<FrZoneTypeKey, Restriction> = {
  nucleaire: "PROHIBITED",
  militaire: "PROHIBITED",
  penitentiaire: "PROHIBITED",
  interdit: "PROHIBITED",
  aeroport: "REQ_AUTHORISATION",
  parc: "NATURE",
  agglomeration: "CONDITIONAL",
  generique: "CONDITIONAL",
};

/** Einstufung einer DGAC-Zone. `limite` „Vol interdit“ (bzw. 0 m) ist immer
 * ein Verbot (auch in Flughafennähe); eine genannte Höchst-Flughöhe > 0 m ist
 * eine Auflage (CONDITIONAL – unterhalb zulässig, wie in der DGAC-Karte);
 * sonst entscheidet der Zonentyp. */
export function frRestrictionFromText(limite: string, remarque: string): Restriction {
  const lim = normalizeFrText(limite);
  if (/interdit/.test(lim)) return "PROHIBITED";
  const m = lim.match(/(\d+)\s*m\b/) || lim.trim().match(/^(\d+)(?:[.,]\d+)?$/);
  if (m) return Number(m[1]) > 0 ? "CONDITIONAL" : "PROHIBITED";
  return FR_TYPE_RESTRICTION[classifyFrRestrictionType(limite, remarque)];
}

function normalizeFrText(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function classifyFrRestrictionType(
  limite: string,
  remarque: string,
): FrZoneTypeKey {
  const text = normalizeFrText(`${remarque || ""} ${limite || ""}`);
  const lim = normalizeFrText(limite);

  // Explizite Flughafen-Indikatoren haben Vorrang, damit ICAO-Codes wie
  // "LFPG"/"LFPO" (CTR) nicht fälschlich als militärisch eingestuft werden.
  const isAeroport = /(aerodrome|aeroport|\bctr\b|heliport|\bpiste\b|aviation|atterriss)/.test(text);

  if (/(nucle|cnpe|atomique|electronucle)/.test(text)) return "nucleaire";
  // Militär nur über eindeutige Tokens bzw. grenzgebundene Sperrgebiet-Codes
  // (LF-P / LF-Pnnn). Kein roher "lfp"-Substring-Match (würde LFPG etc. treffen).
  if (!isAeroport && /(militaire|defense|\barmee\b|base aerienne|\bcamp\b|\blf-?p\s?\d)/.test(text)) return "militaire";
  if (/(penitent|\bprison\b|detention|maison d'?arret)/.test(text)) return "penitentiaire";
  if (isAeroport) return "aeroport";
  if (/(parc national|parc naturel|reserve naturel|reserve nat|biotope|natura)/.test(text)) return "parc";
  if (/(agglomeration|\bville\b|\bcommune\b|rassemblement|personnes|urbain)/.test(text)) return "agglomeration";

  if (lim.includes("interdit") || /interdit/.test(text)) return "interdit";
  return "generique";
}
