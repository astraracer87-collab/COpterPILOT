// Zusatzinfos zur dipul-Geozone „Bahnanlagen“ (§ 21h Abs. 3 Nr. 5 LuftVO).
// Inhalte aus den Originaldokumenten zusammengefasst (Stand geprüft 18.11.2026):
// - NfL 2026-1-3788 vom 11.02.2026 (DB InfraGO: Voraussetzungen für eine Zustimmung)
// - Allgemeinverfügungen nach § 21i LuftVO der Luftämter Süd- und Nordbayern (2024)
import { BAVARIA_RING } from "./bavariaBoundary";

export const DB_UAS_GEOZONE_EMAIL = "uas-geozone@deutschebahn.com";

export const RAILWAY_NFL_URL =
  "https://uas-operations.bund.de/homepage/en/aktuelle-meldungen/entry-into-the-geographical-zone-of-railway-facilities-consent-by-infrago-ag/nfl-2026-1-3788.pdf";
export const BAVARIA_SOUTH_AV_URL =
  "https://www.regierung.oberbayern.bayern.de/mam/dokumente/bereich2/sg25/obabl_08_15032024_sg25.pdf";
export const BAVARIA_NORTH_AV_URL =
  "https://www.regierung.mittelfranken.bayern.de/mam/service/rabl/rabl_2024_04_av_geozonen_bylan.pdf";

export interface RailwayZoneNotes {
  text: string;
  links: { label: string; url: string }[];
}

function inRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isInBavaria(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return inRing(lon, lat, BAVARIA_RING);
}

const DB_TEXT = [
  "DB InfraGO (NfL 2026-1-3788 vom 11.02.2026):",
  "• Ohne Zustimmung erlaubt: Höhe über Grund stets kleiner als der seitliche Abstand zur Anlage, mindestens 10 m Abstand (1:1-Regel).",
  `• Alles darüber hinaus nur mit Einzelzustimmung der DB: Antrag per E-Mail an ${DB_UAS_GEOZONE_EMAIL}, mindestens 4 Wochen vor dem Flug.`,
  "• Übliche Auflagen: A2-Fernpilotenzeugnis und Haftpflichtversicherung, Überflug erst ab 40 m über Grund, Pilot mindestens 10 m von der Anlage entfernt mit orangefarbener Warnweste, Flug vorher per E-Mail anmelden und danach abmelden, keine fahrenden Züge überfliegen.",
  "• Gilt nur für Anlagen der DB InfraGO – bei anderen Bahnbetreibern dort anfragen.",
].join("\n");

const BAVARIA_TEXT = [
  "Bayern – Allgemeinverfügungen der Luftämter Süd- und Nordbayern (2024, unbefristet, ohne Antrag):",
  "• Überflug ab 15 m über Schienenoberkante, zügig und ohne Halt; diese Höhe schon bei 10 m Abstand erreicht haben.",
  "• Unterhalb von 15 m: 10 m Abstand zur Anlage und 1:1-Regel.",
  "• 10 m Abstand zu Masten, Antennen und Schienenfahrzeugen; keine fahrenden Züge überfliegen; Bahngelände nicht betreten.",
  "• Gilt nur für Anlagen der DB InfraGO, Kategorie offen und speziell.",
].join("\n");

/** Hinweise für eine Bahnanlagen-Zone; lat/lon = Lage der Zone (für Bayern). */
export function railwayZoneNotes(lat: number | null, lon: number | null): RailwayZoneNotes {
  const bavaria = lat != null && lon != null && isInBavaria(lat, lon);
  const links = [{ label: "NfL 2026-1-3788 (DB InfraGO)", url: RAILWAY_NFL_URL }];
  if (bavaria) {
    links.push(
      { label: "Allgemeinverfügung Luftamt Südbayern", url: BAVARIA_SOUTH_AV_URL },
      { label: "Allgemeinverfügung Luftamt Nordbayern", url: BAVARIA_NORTH_AV_URL },
    );
  }
  const text = [DB_TEXT, bavaria ? BAVARIA_TEXT : null, "Kurzfassung ohne Gewähr – verbindlich sind die verlinkten Originaldokumente."]
    .filter(Boolean)
    .join("\n\n");
  return { text, links };
}
