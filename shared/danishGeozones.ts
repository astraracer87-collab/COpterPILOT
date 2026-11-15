// Geteilte, React-Native-freie Aufbereitung des dänischen Drohnen-Geozonen-Feeds
// (Trafikstyrelsen, EPSG:4326). Wird serverseitig beim Daten-Sync genutzt
// (server/dataSync.ts), damit der zwischengespeicherte Datensatz bereits
// deutsch-aufbereitete ED-269-ähnliche Features enthält. Mobile (parseEd269To-
// GeozoneInfo) und Web (renderEd269Layer) rendern dadurch automatisch Deutsch,
// ohne die Übersetzung doppelt zu pflegen.
//
// Besonderheiten des echten Feeds (geprüft an 1811 Features):
//  - Geometrie ist teils Punkt + Bufferzone (Kreisradius), teils Polygon/Multi-
//    Polygon. Punkt-Features werden hier in Kreis-Polygone umgerechnet.
//  - `Farve` (= Farbe) ist der offizielle Farbcode 1/4/5 (NICHT 1/2/3):
//      1 -> Kontrollzonen (Flughäfen, Militärflugplätze, HEMS)          -> PROHIBITED
//      4 -> gesetzliche Sperrzonen um sensible Orte (Botschaften,
//           Polizei, Gefängnisse, Militär, Schlösser, kritische
//           Unternehmen, 150–300 m)                                     -> REQ_AUTHORISATION
//      5 -> kleinere Flugplätze/Helipads/Modellflug ("sei aufmerksam")  -> NO_RESTRICTION
//  - `Enhed` (= Einheit) bestimmt die Bufferzone-Einheit bei reinen Zahlen:
//      Enhed = 1    -> Wert ist in Kilometern
//      Enhed = 1000 -> Wert ist in Metern
//    Enthält die Bufferzone explizit "km"/"m"/"meter", hat das Vorrang.
//  - `Lovkrav` ist eine Distanz-Kategorie (Zahl), KEIN Gesetzestext.
//  - `Elevation_meter` ist die Geländehöhe – KEINE Drohnen-Obergrenze; daher
//    nicht als upperMeters übernehmen. `MaxFlyveHoejde` (falls numerisch) ist
//    die zulässige Flughöhe und wird – wenn vorhanden – als Obergrenze genutzt.
import { defaultYielder, type Yielder } from "./yieldingWork";

export interface DanishGeoFeature {
  type?: string;
  geometry: { type: string; coordinates: any } | null;
  properties?: Record<string, any>;
  bbox?: [number, number, number, number];
}

// Farbcode (Farve) -> ED-269-Beschränkungsschlüssel.
export function farveToRestriction(farve: any): string {
  const n = Number(String(farve ?? "").trim());
  switch (n) {
    case 1:
      return "PROHIBITED";
    case 4:
      return "REQ_AUTHORISATION";
    case 5:
      return "NO_RESTRICTION";
    default:
      return "";
  }
}

// Bufferzone -> Radius in Metern. Versteht "2 km", "150 meter", "150 m", "300"
// sowie reine Zahlen in Verbindung mit `Enhed` (1 = km, 1000 = m). Komma wird
// als Dezimaltrennzeichen behandelt ("1,5 km").
export function parseBufferMeters(bufferRaw: any, enhed?: any): number | undefined {
  if (bufferRaw == null) return undefined;
  const s = String(bufferRaw).trim().toLowerCase().replace(",", ".");
  if (s === "" || s === "0") return undefined;
  const num = parseFloat(s);
  if (!Number.isFinite(num) || num <= 0) return undefined;

  // Explizite Einheit im Text hat Vorrang ("km" zuerst prüfen, da es ein "m"
  // enthält).
  if (s.includes("km")) return num * 1000;
  if (/m(eter)?s?\b/.test(s) || s.includes("meter") || /\dm$/.test(s)) return num;

  // Reine Zahl: Einheit über `Enhed`.
  const e = Number(String(enhed ?? "").trim());
  if (e === 1) return num * 1000; // km
  if (e === 1000) return num; // m

  // Fallback-Heuristik: kleine Werte sind km, große Meter.
  return num <= 20 ? num * 1000 : num;
}

// Erzeugt einen Kreis-Polygon-Ring (GeoJSON [lon, lat]) um ein Zentrum mit
// gegebenem Radius (Meter). Äquirektanguläre Näherung – für Drohnen-Pufferzonen
// (typ. < 10 km) ausreichend genau.
export function circlePolygon(
  lon: number,
  lat: number,
  radiusMeters: number,
  segments = 64,
): number[][][] {
  const latRad = (lat * Math.PI) / 180;
  const dLat = radiusMeters / 111320;
  const dLon = radiusMeters / (111320 * Math.max(0.01, Math.cos(latRad)));
  const ring: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    ring.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)]);
  }
  return [ring];
}

// typeId (dänisch, inkl. Tippfehler im Feed) -> deutsche Bezeichnung. Der
// Schlüssel wird normalisiert (klein, Leerraum reduziert), um Varianten wie
// "Virksomhed kol3"/"Vrksomhed kol 3"/"Security " abzudecken.
const DK_TYPE_TRANSLATIONS: { match: (k: string) => boolean; de: string }[] = [
  { match: (k) => k.includes("militaer flyvestation") || k.includes("militær flyvestation"), de: "Militärflugplatz" },
  { match: (k) => k.includes("civil lufthavn"), de: "Ziviler Flughafen" },
  { match: (k) => k.includes("offentlig godkendt flyveplads"), de: "Öffentlich zugelassener Flugplatz" },
  { match: (k) => k.includes("hems"), de: "Rettungshubschrauber-Landeplatz (HEMS)" },
  { match: (k) => k.includes("vandflyveplads"), de: "Wasserflugplatz" },
  { match: (k) => k.includes("helipad") || k.includes("helikopter"), de: "Hubschrauberlandeplatz" },
  { match: (k) => k.includes("privat flyveplads"), de: "Privatflugplatz" },
  { match: (k) => k.includes("svaeveflyveplads") || k.includes("svæveflyveplads"), de: "Segelflugplatz" },
  { match: (k) => k.includes("faldskaermsplads") || k.includes("faldskærmsplads"), de: "Fallschirmsprungplatz" },
  { match: (k) => k.includes("modelflyve"), de: "Modellflugplatz" },
  { match: (k) => k.includes("ambassade"), de: "Botschaft" },
  { match: (k) => k.startsWith("militaer") || k.startsWith("militær"), de: "Militärisches Gebiet" },
  { match: (k) => k.includes("slotshave"), de: "Schlosspark" },
  { match: (k) => k.includes("slot"), de: "Schloss" },
  { match: (k) => k.includes("faengsel") || k.includes("fængsel"), de: "Gefängnis" },
  { match: (k) => k.includes("politi"), de: "Polizei" },
  { match: (k) => k.includes("virksomhed") || k.includes("vrksomhed"), de: "Kritisches Unternehmen (Kol. 3)" },
  { match: (k) => k.includes("byret") || k.includes("retsvaesen") || k.includes("retsvæsen") || k.includes("restvaesen") || k.includes("restvæsen") || k.includes("retsinstans"), de: "Gericht" },
  { match: (k) => k.includes("sikringskritisk"), de: "Sicherheitskritischer Bereich" },
  { match: (k) => k.includes("safety") || k.includes("security") || k === "mgz" || k.includes("mgz") || k === "mmo", de: "Sicherheits-/Schutzzone" },
];

export function translateDanishType(typeId: any, restriction?: string): string | undefined {
  const raw = String(typeId ?? "").trim();
  if (!raw) return undefined;
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  for (const t of DK_TYPE_TRANSLATIONS) {
    if (t.match(key)) return t.de;
  }
  // Rein numerische typeIds ("1"/"2"/"5") tragen keine eigene Bezeichnung –
  // generische Beschreibung nach Beschränkung.
  if (/^\d+$/.test(raw)) {
    if (restriction === "PROHIBITED") return "Kontrollzone";
    if (restriction === "REQ_AUTHORISATION") return "Sensibler Bereich";
    if (restriction === "NO_RESTRICTION") return "Flugplatz";
    return undefined;
  }
  return undefined;
}

function parseDanishValidityTimestamp(value: unknown): number | undefined {
  if (value == null || String(value).trim() === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 1e12 ? value * 1000 : value > 0 ? value : undefined;
  }
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return raw.length <= 10 ? numeric * 1000 : numeric;
  }
  const danishDate = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(.+))?$/);
  const normalized = danishDate
    ? `${danishDate[3]}-${danishDate[2].padStart(2, "0")}-${danishDate[1].padStart(2, "0")}${danishDate[4] ? `T${danishDate[4]}` : ""}`
    : raw;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

// Deutsche Antrags-/Genehmigungs-Hinweise pro Zone, abgeleitet aus den Rohfeldern
// des Trafikstyrelsen-Feeds.
export interface DanishApplicationInfo {
  // Erläuternder deutscher Fließtext (umbruchfähig, NICHT als "Label: Wert"-Zeile).
  text?: string;
  applicationUrl?: string;
  applicationUrlLabel?: string;
  infoUrl?: string;
  infoUrlLabel?: string;
  contactEmail?: string;
  contactLabel?: string;
  notamsUrl?: string;
  exceptionsText?: string;
  // Militärische Zonen (§13 bzw. MIL.DK-Kontakt) verweisen auf das
  // Verteidigungskommando statt auf das Trafikstyrelsen-Standardverfahren.
  isMilitary: boolean;
  // Rechtsgrundlage als reine Paragraf-Nummer (z. B. "11", "13"), falls vorhanden.
  paragraf?: string;
}

const DK_INFO_LABEL = "Infos (droneregler.dk)";
const DK_APPLICATION_LABEL = "Antrag stellen (virk.dk)";

// Baut die deutschen Antrags-/Genehmigungs-Hinweise einer dänischen Zone aus den
// Rohfeldern des Feeds (`AnsoegningsLink` = virk.dk-Antragsformular, `InfoLink` =
// droneregler.dk, `kontaktMail`, `Paragraf`). Zwei Fälle:
//  - Militärische Zonen (§13 bzw. Kontakt @MIL.DK): Verweis auf das Servicecenter
//    des Verteidigungskommandos (Forsvaret); KEIN Trafikstyrelsen-30-Tage-Text.
//  - Sonstige genehmigungspflichtige Zonen mit Antragslink: Antrag über das
//    Trafikstyrelsen-Formular auf virk.dk (MitID, ca. 30 Tage Bearbeitung).
// Aufmerksamkeitszonen ohne Antragslink (Farve 5) liefern keinen Antragstext.
export function buildDanishApplicationInfo(p: Record<string, any>): DanishApplicationInfo {
  const trim = (v: any) => String(v ?? "").trim();
  const kontaktMail = trim(p.kontaktMail);
  const paragrafRaw = trim(p.Paragraf);
  const paragraf = /^\d+$/.test(paragrafRaw) ? paragrafRaw : "";
  const applicationUrl = trim(p.AnsoegningsLink);
  const infoUrl = trim(p.InfoLink);
  const notamsUrl = trim(p.NOTAMS_url);
  const exceptionsText = trim(p.undtagelsesText);
  const isMilitary = /mil\.dk/i.test(kontaktMail) || paragraf === "13";

  const info: DanishApplicationInfo = { isMilitary };
  if (/^https?:\/\//i.test(notamsUrl)) info.notamsUrl = notamsUrl;
  if (exceptionsText && !/^ingen undtagelser$/i.test(exceptionsText)) {
    info.exceptionsText = exceptionsText;
  }
  if (paragraf) info.paragraf = paragraf;
  if (infoUrl) {
    info.infoUrl = infoUrl;
    info.infoUrlLabel = DK_INFO_LABEL;
  }

  if (isMilitary) {
    info.text =
      "Militärisches Gebiet. Genehmigung bzw. Zustimmung erteilt das Servicecenter des Verteidigungskommandos (Forsvaret) nach §13 der dänischen Drohnenverordnung.";
    if (kontaktMail) {
      info.contactEmail = kontaktMail;
      info.contactLabel = "Verteidigungskommando";
    }
    if (applicationUrl) {
      info.applicationUrl = applicationUrl;
      info.applicationUrlLabel = DK_APPLICATION_LABEL;
    }
    return info;
  }

  if (applicationUrl) {
    info.text =
      "Genehmigung erforderlich. Antrag über das Trafikstyrelsen-Formular auf virk.dk (Anmeldung mit MitID). Bearbeitungszeit ca. 30 Tage.";
    info.applicationUrl = applicationUrl;
    info.applicationUrlLabel = DK_APPLICATION_LABEL;
    if (kontaktMail) {
      info.contactEmail = kontaktMail;
      info.contactLabel = "Kontakt";
    }
    return info;
  }

  // Keine Antragsdaten (z. B. Aufmerksamkeitszonen Farve 5).
  if (kontaktMail) {
    info.contactEmail = kontaktMail;
    info.contactLabel = "Kontakt";
  }
  return info;
}

function formatBufferLabel(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

// Normalisiert ein einzelnes dänisches Feature in ein ED-269-ähnliches Feature:
//  - Punkt + Bufferzone -> Kreis-Polygon; Polygon/MultiPolygon bleiben erhalten.
//  - setzt `restriction` (aus Farve), `name` (aus title/ICAO/Typ), optional
//    `upperMeters` (aus MaxFlyveHoejde) und eine deutsche Detailzeile in
//    `message` (Typ, Pufferradius, ICAO, Kategorie).
// Liefert `null`, wenn keine renderbare Geometrie erzeugt werden kann
// (z. B. Punkt ohne gültige Bufferzone).
export function normalizeDanishFeature(f: DanishGeoFeature): DanishGeoFeature | null {
  if (!f || !f.geometry) return null;
  const p: Record<string, any> = f.properties || {};
  if (/^(NEJ|NO|FALSE|0)$/i.test(String(p.Aktiv ?? "").trim())) return null;
  const restriction = farveToRestriction(p.Farve);

  let geometry = f.geometry;
  const bufferMeters = parseBufferMeters(p.Bufferzone ?? p.Buffer_Zone, p.Enhed);

  if (geometry.type === "Point") {
    const coords = geometry.coordinates as [number, number] | undefined;
    let lon = Array.isArray(coords) ? Number(coords[0]) : NaN;
    let lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      lon = Number(p.CenterPoint_Longitude);
      lat = Number(p.CenterPoint_Latitude);
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (!bufferMeters) return null; // ohne Radius keine Zone darstellbar
    geometry = { type: "Polygon", coordinates: circlePolygon(lon, lat, bufferMeters) };
  } else if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    return null;
  }

  const title = String(p.title ?? "").trim();
  const icao = String(p.ICAO ?? "").trim();
  const typeDe = translateDanishType(p.typeId, restriction);
  const name = title || icao || typeDe || "Geozone";

  // Obergrenze nur aus MaxFlyveHoejde (zulässige Flughöhe), nicht aus
  // Elevation_meter (Geländehöhe).
  const maxHoehe = Number(String(p.MaxFlyveHoejde ?? "").trim());
  const upperMeters = Number.isFinite(maxHoehe) && maxHoehe > 0 ? maxHoehe : undefined;

  const kategorie = String(p.zoneKategori ?? "").trim();
  const kategorieDe =
    kategorie.toLowerCase() === "permanent"
      ? "Dauerhaft"
      : kategorie.toLowerCase() === "midlertidig"
        ? "Temporär"
        : "";

  const appInfo = buildDanishApplicationInfo(p);
  const validStartTs = parseDanishValidityTimestamp(p.datoTidSTART);
  const validEndTs = parseDanishValidityTimestamp(p.datoTidSLUT);
  const notamEligible =
    String(p.zoneKategori ?? "").trim().toLowerCase() === "midlertidig" ||
    validStartTs != null ||
    validEndTs != null;

  const detailLines: string[] = [];
  if (typeDe) detailLines.push(`Typ: ${typeDe}`);
  if (bufferMeters) detailLines.push(`Pufferradius: ${formatBufferLabel(bufferMeters)}`);
  if (icao) detailLines.push(`ICAO: ${icao}`);
  if (kategorieDe) detailLines.push(`Kategorie: ${kategorieDe}`);
  if (appInfo.paragraf) detailLines.push(`Rechtsgrundlage: §${appInfo.paragraf} (dän. Drohnenverordnung)`);
  if (appInfo.exceptionsText) {
    detailLines.push(`Ausnahmen (dänischer Quelltext): ${appInfo.exceptionsText}`);
  }

  const properties: Record<string, any> = {
    ...p,
    restriction,
    name,
  };
  if (upperMeters != null) {
    properties.upperMeters = upperMeters;
    properties.lowerMeters = 0;
  }
  if (detailLines.length > 0) properties.message = detailLines.join("\n");

  // Antrags-/Genehmigungs-Hinweise als strukturierte Felder, damit Mobile- und
  // Web-Rendering einen erklärenden Text plus anklickbare Links (virk.dk,
  // droneregler.dk, Kontakt-E-Mail) zeigen können – ohne den Fließtext als
  // abgeschnittene "Label: Wert"-Zeile darzustellen.
  if (appInfo.text) properties.applicationText = appInfo.text;
  if (appInfo.applicationUrl) {
    properties.applicationUrl = appInfo.applicationUrl;
    properties.applicationUrlLabel = appInfo.applicationUrlLabel;
  }
  if (appInfo.infoUrl) {
    properties.infoUrl = appInfo.infoUrl;
    properties.infoUrlLabel = appInfo.infoUrlLabel;
  }
  if (appInfo.contactEmail) {
    properties.contactEmail = appInfo.contactEmail;
    properties.contactLabel = appInfo.contactLabel;
  }
  properties.isMilitaryZone = appInfo.isMilitary;
  if (validStartTs != null) properties.validStartTs = validStartTs;
  if (validEndTs != null) properties.validEndTs = validEndTs;
  if (notamEligible) properties._notamEligible = true;
  if (appInfo.notamsUrl) {
    properties.notamsUrl = appInfo.notamsUrl;
    properties.notamsUrlLabel = "NOTAM-/Luftraumkarte öffnen";
  }

  return {
    type: "Feature",
    geometry,
    properties,
    // bbox bewusst NICHT setzen – wird nach der Geometrie-Umrechnung neu berechnet.
  };
}

// Normalisiert eine Feature-Liste und entfernt nicht darstellbare Features.
export function normalizeDanishFeatures(features: DanishGeoFeature[]): DanishGeoFeature[] {
  const out: DanishGeoFeature[] = [];
  const seen = new Set<string>();
  for (const f of features || []) danishNormalizeStep(f, seen, out);
  return out;
}

function danishNormalizeStep(f: DanishGeoFeature, seen: Set<string>, out: DanishGeoFeature[]): void {
  const n = normalizeDanishFeature(f);
  if (!n) return;
  const p = n.properties || {};
  const stableId = p.OBJECTID ?? p.objectid ?? p.id ?? "";
  const geometryKey = `${n.geometry?.type}:${JSON.stringify(n.geometry?.coordinates)}`;
  const key = stableId !== ""
    ? `${stableId}:${geometryKey}`
    : `${p.name ?? ""}:${p.Farve ?? ""}:${geometryKey}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(n);
}

/**
 * Wie normalizeDanishFeatures, aber in Zeitscheiben (≈ 160 ms Node für den
 * 11-MB-Export am Stück). Ergebnis identisch.
 */
export async function normalizeDanishFeaturesYielding(features: DanishGeoFeature[], y: Yielder = defaultYielder): Promise<DanishGeoFeature[]> {
  const out: DanishGeoFeature[] = [];
  const seen = new Set<string>();
  for (const f of features || []) {
    danishNormalizeStep(f, seen, out);
    if (y.shouldYield()) await y.yield("dk-normalise");
  }
  return out;
}

// Quell-/Layer-Bezeichnung der dänischen Vektorzonen. Wird auch in
// ED269_SOURCE_LABELS (client/lib/ed269.ts) referenziert, damit die
// Gruppierungslogik unten und das Rendering dieselbe Beschriftung nutzen
// (keine Drift).
export const DANISH_GEOZONE_SOURCE_LABEL = "Trafikstyrelsen (Dänemark)";

// ---------------------------------------------------------------------------
// Dänische Naturschutzzonen ("Naturområder" / Natura 2000, Trafikstyrelsen /
// Naturstyrelsen). Separater Datensatz vom Drohnenzonen-Feed: grüne Zonen mit
// (teils saisonaler) Sperrperiode zum Schutz brütender/rastender Vögel. Wird in
// server/dataSync.ts geholt, hier deutsch als ED-269-ähnliche Features
// normalisiert und in den geozones-dk-Cache gemergt, sodass Mobile
// (parseEd269ToGeozoneInfo) und Web (renderEd269Layer) sie automatisch grün
// rendern.
//
// Rohfelder (geprüft an 140 Features): Temanavn (Thema), Fnr (Gebietsnummer),
// Fuglebeskyttelsesområder_og_Hab (Gebietsname), Restriktionsperiode_ (Saison,
// z. B. "1. februar – 31. oktober" oder "Hele året"), Årsag__ (Grund, dänisch),
// Aktiv ("JA"/"NEJ"), URL (Infolink). Geometrie ist Polygon/MultiPolygon
// (EPSG:4326).

const DK_MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  marts: 3,
  april: 4,
  maj: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  december: 12,
};

// Parst einen dänischen Tag+Monat ("1. februar") in {m, d}. Liefert null, wenn
// nicht eindeutig parsebar.
function parseDanishDayMonth(s: string): { m: number; d: number } | null {
  const t = (s || "").trim().toLowerCase();
  const m = t.match(/(\d{1,2})\.?\s*([a-zæøå]+)/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = DK_MONTHS[m[2]];
  if (!mon || !(day >= 1 && day <= 31)) return null;
  return { m: mon, d: day };
}

// Ist eine dänische Sperrperiode aktuell in Kraft? "Hele året" -> immer true.
// Bereiche mit Jahres-Übergang (z. B. "1. oktober – 20. april") werden korrekt
// behandelt. Liefert undefined, wenn die Periode nicht parsebar ist (Aufrufer
// zeigt dann nur den Rohtext ohne "aktuell"-Zusatz).
export function isDanishNatureSeasonActive(
  period: string,
  now: Date = new Date(),
): boolean | undefined {
  const raw = (period || "").trim().toLowerCase();
  if (!raw) return undefined;
  if (raw.includes("hele året") || raw.includes("hele aret")) return true;
  const parts = raw
    .split(/[–—-]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  const a = parseDanishDayMonth(parts[0]);
  const b = parseDanishDayMonth(parts[parts.length - 1]);
  if (!a || !b) return undefined;
  const cur = (now.getMonth() + 1) * 100 + now.getDate();
  const start = a.m * 100 + a.d;
  const end = b.m * 100 + b.d;
  if (start <= end) return cur >= start && cur <= end;
  return cur >= start || cur <= end; // Bereich läuft über den Jahreswechsel
}

// Temanavn (dänisches Thema) -> deutsche Bezeichnung + ED-269-Beschränkung.
// "Droneforbudszone" ist ein echtes Drohnenverbot (PROHIBITED, rot); alle
// übrigen Naturthemen erhalten die grüne Beschränkung "NATURE".
export function translateDanishNatureTheme(tema: string): {
  de: string;
  restriction: string;
} {
  const k = (tema || "").toLowerCase();
  if (k.includes("droneforbud"))
    return { de: "Drohnenverbotszone", restriction: "PROHIBITED" };
  if (k.includes("fuglebeskyttelse"))
    return { de: "Natura 2000 – Vogelschutzgebiet", restriction: "NATURE" };
  if (k.includes("habitat"))
    return { de: "Natura 2000 – Habitatgebiet", restriction: "NATURE" };
  if (k.includes("natura"))
    return { de: "Natura-2000-Gebiet", restriction: "NATURE" };
  if (k.includes("fredning"))
    return { de: "Naturschutzgebiet (Fredning)", restriction: "NATURE" };
  return { de: "Naturschutzgebiet", restriction: "NATURE" };
}

// Normalisiert ein einzelnes dänisches Naturschutz-Feature in ein
// ED-269-ähnliches Feature (Polygon/MultiPolygon bleibt erhalten). Nur aktive
// Ausweisungen (Aktiv = "JA") werden übernommen; "NEJ" (derzeit nicht in Kraft)
// liefert null. Setzt `restriction` (NATURE bzw. PROHIBITED bei
// Droneforbudszonen), `name`, `lowerMeters=0` (Naturschutz gilt in jeder Höhe,
// keine Obergrenze) sowie eine deutsche Detailbeschreibung in `message`
// (Thema, Gebietsnummer, Sperrperiode inkl. aktuellem Status, Grund) und den
// Infolink.
export function normalizeDanishNatureFeature(
  f: DanishGeoFeature,
  now: Date = new Date(),
): DanishGeoFeature | null {
  if (!f || !f.geometry) return null;
  if (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")
    return null;
  const p: Record<string, any> = f.properties || {};
  if (String(p.Aktiv ?? "").trim().toUpperCase() !== "JA") return null;

  const theme = translateDanishNatureTheme(String(p.Temanavn ?? ""));
  const fnr = String(p.Fnr ?? "").trim();
  const areaName = String(p.Fuglebeskyttelsesområder_og_Hab ?? "").trim();
  const name = areaName || theme.de || fnr || "Naturschutzgebiet";
  const period = String(p.Restriktionsperiode_ ?? "").trim();
  const reason = String(p.Årsag__ ?? "").trim();
  const url = String(p.URL ?? "").trim();
  const isForbidden = theme.restriction === "PROHIBITED";

  const detailLines: string[] = [];
  detailLines.push(`Typ: ${theme.de}`);
  if (fnr) detailLines.push(`Gebietsnummer: ${fnr}`);
  if (period) {
    const active = isDanishNatureSeasonActive(period, now);
    const suffix =
      active === true
        ? " (aktuell in Kraft)"
        : active === false
          ? " (derzeit außerhalb der Sperrzeit)"
          : "";
    detailLines.push(`Sperrperiode: ${period}${suffix}`);
  }
  detailLines.push(
    isForbidden
      ? "In dieser Zone ist der Drohnenbetrieb untersagt."
      : "Innerhalb der Sperrperiode ist der Drohnenbetrieb zum Schutz brütender/rastender Vögel einzuschränken bzw. zu unterlassen.",
  );
  if (reason) detailLines.push(`Grund (dän.): ${reason}`);

  const properties: Record<string, any> = {
    ...p,
    restriction: theme.restriction,
    name,
    natureZone: true,
    lowerMeters: 0,
    message: detailLines.join("\n"),
    zoneId: fnr ? `DK-NATUR-${fnr}` : `DK-NATUR-${p.OBJECTID ?? name}`,
  };
  if (url) {
    properties.infoUrl = url;
    properties.infoUrlLabel = "Weitere Infos (Naturstyrelsen)";
  }

  return { type: "Feature", geometry: f.geometry, properties };
}

// Normalisiert eine Liste dänischer Naturschutz-Features und entfernt inaktive /
// nicht darstellbare Einträge.
export function normalizeDanishNatureFeatures(
  features: DanishGeoFeature[],
  now: Date = new Date(),
): DanishGeoFeature[] {
  const out: DanishGeoFeature[] = [];
  for (const f of features || []) {
    const n = normalizeDanishNatureFeature(f, now);
    if (n) out.push(n);
  }
  return out;
}

// Liest den Wert einer Detail-Zeile ("Label: Wert") aus dem mehrzeiligen
// `details`-String einer Zone. Groß-/Kleinschreibung egal.
function getDetailValue(details: string, label: string): string | undefined {
  const prefix = `${label.toLowerCase()}:`;
  for (const line of (details || "").split("\n")) {
    const t = line.trim();
    if (t.toLowerCase().startsWith(prefix)) return t.slice(t.indexOf(":") + 1).trim();
  }
  return undefined;
}

// Ersetzt (oder ergänzt) eine Detail-Zeile "Label: Wert" im details-String.
function setDetailValue(details: string, label: string, value: string): string {
  const prefix = `${label.toLowerCase()}:`;
  const lines = (details || "").split("\n");
  let replaced = false;
  const out = lines.map((line) => {
    if (line.trim().toLowerCase().startsWith(prefix)) {
      replaced = true;
      return `${label}: ${value}`;
    }
    return line;
  });
  if (!replaced) out.push(`${label}: ${value}`);
  return out.join("\n");
}

// "1 km" -> 1000, "150 m" -> 150. Liefert undefined bei ungültigen Werten.
function bufferLabelToMeters(label: string): number | undefined {
  const s = (label || "").trim().toLowerCase().replace(",", ".");
  const num = parseFloat(s);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  if (s.includes("km")) return num * 1000;
  return num;
}

// "1 km – 10 km" -> { min: 1000, max: 10000 }; "1 km" -> { min: 1000, max: 1000 }.
// Jeder Bereichsteil trägt seine eigene Einheit, daher pro Teil parsen.
function bufferRangeMeters(label: string): { min?: number; max?: number } {
  const meters = (label || "")
    .split(/[–—-]/)
    .map((p) => bufferLabelToMeters(p))
    .filter((m): m is number => m != null);
  if (meters.length === 0) return {};
  return { min: Math.min(...meters), max: Math.max(...meters) };
}

export interface DanishGroupableZone {
  layerLabel: string;
  name: string;
  details: string;
}

// Verschmilzt zwei konzentrische Ringe derselben Anlage: behält den äußersten
// Ring (größter Radius) als Basis – damit dessen Geometrie/Farben erhalten
// bleiben – und ersetzt die Pufferradius-Zeile durch den kombinierten Bereich.
function mergeDanishRings<T extends DanishGroupableZone>(a: T, b: T): T {
  const ra = bufferRangeMeters(getDetailValue(a.details, "Pufferradius") ?? "");
  const rb = bufferRangeMeters(getDetailValue(b.details, "Pufferradius") ?? "");
  const aMax = ra.max ?? ra.min ?? 0;
  const bMax = rb.max ?? rb.min ?? 0;
  const base = bMax > aMax ? b : a;

  const mins = [ra.min, rb.min].filter((m): m is number => m != null);
  const maxs = [ra.max, rb.max].filter((m): m is number => m != null);
  if (mins.length === 0 || maxs.length === 0) return base;

  const min = Math.min(...mins);
  const max = Math.max(...maxs);
  const label =
    min === max
      ? formatBufferLabel(max)
      : `${formatBufferLabel(min)} – ${formatBufferLabel(max)}`;
  return { ...base, details: setDetailValue(base.details, "Pufferradius", label) };
}

// Fasst konzentrische Pufferringe derselben dänischen Anlage (gleicher Name +
// ICAO + Beschränkung) zu EINEM Listeneintrag zusammen. Der Trafikstyrelsen-Feed
// listet pro Flugplatz/Helipad oft mehrere Ringe (z. B. 1 km / 10 km), die sonst
// je eine eigene Karte/Tabellenzeile erzeugen. Nicht-dänische Zonen bleiben
// unverändert und behalten ihre Reihenfolge. Die Pufferradius-Zeile des
// zusammengefassten Eintrags zeigt den Bereich (z. B. "1 km – 10 km").
export function groupDanishBufferRings<T extends DanishGroupableZone>(items: T[]): T[] {
  const out: T[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items || []) {
    if (item.layerLabel !== DANISH_GEOZONE_SOURCE_LABEL) {
      out.push(item);
      continue;
    }
    const icao = getDetailValue(item.details, "ICAO") ?? "";
    const restriction = getDetailValue(item.details, "Beschränkung") ?? "";
    const key = `${item.name}\u0000${icao}\u0000${restriction}`;
    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, out.length);
      out.push(item);
      continue;
    }
    out[existingIdx] = mergeDanishRings(out[existingIdx], item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live-Ebenen von dronezoner.eu (Trafikstyrelsen / GisVision): NOTAMs und
// An-/Abflugflächen. Siehe docs/denmark-dronezoner-api-integration.md §3.
//
// Live geprüft 2026-11-15: Der Tagesexport (Item 980697ac…, 1.793 Zonen,
// Felder Farve/Type/Bufferzone/Lovkrav/ICAO …, Farve nur 1/4/5) enthält
// KEINE NOTAM-Ebenen und KEINE An-/Abflugflächen. Diese kommen daher aus den
// Feature-Services; die Dienstnamen werden aus der Web Map 4d73b795… gelesen
// (Titel bzw. Dienst-Präfix), Rückfall die bekannten Namen. Zugangsdaten aus
// dem APP_CONFIG der Seite werden NIE verwendet (öffentliche Dienste, kein Token).
//
//  | Ebene (Web-Map-Titel)       | Dienst                         | live | App                      |
//  |-----------------------------|--------------------------------|------|--------------------------|
//  | NOTAMS - Aktiv              | active_notams/0                |    0 | aktiv (temporär, NOTAM)  |
//  | NOTAMS - Opmærksomhed       | awareness_notams/0             |    3 | Achtung (temporär, NOTAM)|
//  | NOTAMS - Inaktiv            | inactive_notams/0              |    0 | Fenster laut NOTAM       |
//  | GUL _ restriktionsområde    | disabled_notams/0              |   53 | R/D/TSA derzeit nicht    |
//  |                             |                                |      | aktiviert (s. u.)        |
//  | Ind_ og udflyvningsplaner   | Ind__og_udflyvningsplaner/188  |  186 | An-/Abflugfläche (Achtung)|
//
// „disabled“ = gelbe Restriktions-/Gefahrengebiete (EK R…, EK D…, TSA) ohne
// aktivierende NOTAM. Wird ein Gebiet aktiviert, erscheint es unter
// active_notams. Ein deaktiviertes Gebiet gilt deshalb bis DK_DISABLED_HORIZON_MS
// nach dem Abruf als nicht aktiv und danach vorsorglich wieder als aktiv
// (ohne neuere Daten weiß die App nicht, ob es inzwischen aktiviert wurde).
// Dedupe über den Namen: aktiv > Achtung > inaktiv > deaktiviert.

export const DK_ARCGIS_BASE = "https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services";
export const DK_WEBMAP_ID = "4d73b79535104a509575e50cd7b30244";
export const DK_WEBMAP_DATA_URL = `https://www.arcgis.com/sharing/rest/content/items/${DK_WEBMAP_ID}/data?f=json`;
/** Deaktivierte Gebiete gelten so lange nach dem Abruf als nicht aktiv. */
export const DK_DISABLED_HORIZON_MS = 2 * 60 * 60 * 1000;
const DK_OPEN_AFTER_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;
export const DK_NAVIAIR_BRIEFING_URL = "https://briefing.naviair.dk";

export type DanishLiveLayerKey = "active" | "awareness" | "inactive" | "disabled" | "corridors";

export interface DanishLiveLayerDef {
  key: DanishLiveLayerKey;
  /** Web-Map-Titel (gefaltet/klein verglichen) */
  title: RegExp;
  /** Dienstname-Präfix (Rückfall-Erkennung) */
  servicePrefix: string;
  /** Bekannter Pfad, falls die Web Map nicht lesbar ist */
  fallbackPath: string;
}

export const DK_LIVE_LAYERS: readonly DanishLiveLayerDef[] = [
  { key: "active", title: /^notams?\s*-\s*aktiv$/i, servicePrefix: "active_notams", fallbackPath: "active_notams/FeatureServer/0" },
  { key: "awareness", title: /^notams?\s*-\s*opm/i, servicePrefix: "awareness_notams", fallbackPath: "awareness_notams/FeatureServer/0" },
  { key: "inactive", title: /^notams?\s*-\s*inaktiv$/i, servicePrefix: "inactive_notams", fallbackPath: "inactive_notams/FeatureServer/0" },
  { key: "disabled", title: /^gul\b/i, servicePrefix: "disabled_notams", fallbackPath: "disabled_notams/FeatureServer/0" },
  { key: "corridors", title: /udflyvning/i, servicePrefix: "Ind__og_udflyvningsplaner", fallbackPath: "Ind__og_udflyvningsplaner/FeatureServer/188" },
];

/**
 * Layer-URLs der Live-Ebenen aus der Web Map (operationalLayers[].url, Titel
 * bzw. Dienst-Präfix); fehlende Ebenen → bekannter Pfad. `fromWebmap` je Ebene.
 */
export function resolveDanishLiveLayers(webmap: any): Record<DanishLiveLayerKey, { url: string; fromWebmap: boolean }> {
  const entries: { title: string; url: string }[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const l of list as any[]) {
      if (!l || typeof l !== "object") continue;
      if (Array.isArray(l.layers) && !l.url) walk(l.layers);
      else if (typeof l.url === "string") entries.push({ title: String(l.title ?? "").trim(), url: l.url.replace(/\/+$/, "") });
    }
  };
  walk(webmap?.operationalLayers);
  const out = {} as Record<DanishLiveLayerKey, { url: string; fromWebmap: boolean }>;
  for (const def of DK_LIVE_LAYERS) {
    const inBase = entries.filter((e) => e.url.toLowerCase().startsWith(DK_ARCGIS_BASE.toLowerCase()) && /\/FeatureServer\/\d+$/i.test(e.url));
    const svc = (e: { url: string }) => e.url.slice(DK_ARCGIS_BASE.length + 1).split("/")[0] ?? "";
    const hit = inBase.find((e) => def.title.test(e.title)) ?? inBase.find((e) => svc(e).toLowerCase().startsWith(def.servicePrefix.toLowerCase()));
    out[def.key] = hit ? { url: hit.url, fromWebmap: true } : { url: `${DK_ARCGIS_BASE}/${def.fallbackPath}`, fromWebmap: false };
  }
  return out;
}

function dkStr(v: unknown): string {
  const s = String(v ?? "").trim();
  return s === "None" || s === "null" ? "" : s;
}

function dkTs(v: unknown): number | null {
  if (v == null || v === "" || v === "None") return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function dkUtc(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Untergrenze aus LimitMeter/LimitFod („0 meter til 120 meter“, „0 SFC til 395 FT“); 0 = Boden. */
export function danishNotamLowerLimit(p: Record<string, any>): { meters: number; reference: "AGL" | "MSL" | "STD" } {
  const meterTxt = dkStr(p.LimitMeter);
  const fodTxt = dkStr(p.LimitFod).toUpperCase();
  const m = meterTxt.match(/^(-?\d+(?:[.,]\d+)?)\s*meter/i);
  const meters = m ? Number(m[1].replace(",", ".")) : 0;
  if (!(meters > 0)) return { meters: 0, reference: "AGL" };
  const low = fodTxt.split(/\s+TIL\s+/)[0] ?? "";
  const reference = /\bFL\b/.test(low) ? "STD" : /\b(?:AMSL|MSL|ALT)\b/.test(low) ? "MSL" : "AGL";
  return { meters, reference };
}

/** Roh-NOTAM-Texte aus dem JSON-String `notams` (rawInput). */
export function danishRawNotams(p: Record<string, any>): string[] {
  try {
    const arr = JSON.parse(String(p.notams ?? "[]"));
    return Array.isArray(arr) ? arr.map((n: any) => String(n?.rawInput ?? "").replace(/\r\n/g, "\n").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const DK_NOTAM_TYPE_DE: Record<string, string> = {
  RESTRICTED: "Flugbeschränkungsgebiet",
  DANGER: "Gefahrengebiet",
  AWARENESS: "Hinweis-NOTAM (Achtung)",
  PROHIBITED: "Luftsperrgebiet",
};

function danishNotamRestriction(type: string, text: string): string {
  if (/\bPROHIBITED\b|\bFORBUDT\b/i.test(text) || type === "PROHIBITED") return "PROHIBITED";
  if (type === "RESTRICTED") return "RESTRICTED";
  if (type === "DANGER" || type === "AWARENESS") return "CONDITIONAL";
  return "REQ_AUTHORISATION";
}

function polygonal(g: any): boolean {
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon") && Array.isArray(g.coordinates) && g.coordinates.length > 0;
}

/** Ein Feature einer NOTAM-Ebene → App-Feature; null ohne Fläche bzw. abgelaufen. */
export function normalizeDanishNotamFeature(
  raw: DanishGeoFeature,
  layer: Exclude<DanishLiveLayerKey, "corridors">,
  ctx: { now: number },
): DanishGeoFeature | null {
  if (!raw || !polygonal(raw.geometry)) return null;
  const p: Record<string, any> = raw.properties || {};
  const name = dkStr(p.name) || "NOTAM";
  const description = dkStr(p.description);
  const type = (dkStr(p.type) || (layer === "awareness" ? "AWARENESS" : "")).toUpperCase();
  const start = dkTs(p.StartDate);
  const end = dkTs(p.EndDate);
  if (end != null && end < ctx.now) return null;
  const notamText = dkStr(p.NOTAMtxt);
  const rawNotams = danishRawNotams(p);
  const restriction = danishNotamRestriction(type, notamText);
  const lower = danishNotamLowerLimit(p);
  const lines: string[] = [];
  const typeDe = DK_NOTAM_TYPE_DE[type] ?? (type ? `Typ ${type}` : "NOTAM-Gebiet");
  if (layer === "disabled") {
    const horizon = ctx.now + DK_DISABLED_HORIZON_MS;
    lines.push(`Typ: ${typeDe} (gelbes Restriktionsgebiet) – derzeit NICHT aktiviert laut NOTAM-Daten (Naviair, Stand ${dkUtc(ctx.now)}).`);
    lines.push(
      `Wird das Gebiet per NOTAM aktiviert, erscheint es als eigene NOTAM-Zone. Ab ${dkUtc(horizon)} ohne neuere Daten vorsorglich als aktiv gewertet.`,
    );
  } else {
    const what = layer === "active" ? "AKTIV per NOTAM" : layer === "awareness" ? "Hinweis (Opmærksomhed)" : "per NOTAM angekündigt (noch nicht aktiv)";
    lines.push(`Typ: ${typeDe} – ${what}`);
    if (start != null || end != null) lines.push(`Gültig: ${start != null ? dkUtc(start) : "offen"} – ${end != null ? dkUtc(end) : "offen"}`);
    const sched = dkStr(p.timeSchedule);
    if (sched) lines.push(`Zeitplan laut NOTAM (UTC): ${sched} – die Zone gilt vorsorglich im ganzen Gültigkeitszeitraum.`);
  }
  const lm = dkStr(p.LimitMeter);
  const lf = dkStr(p.LimitFod);
  if (lm || lf) lines.push(`Höhe laut NOTAM: ${[lm, lf].filter(Boolean).join(" / ")}`);
  if (description && description !== name) lines.push(`Beschreibung: ${description}`);
  lines.push(`Quelle: Trafikstyrelsen / Naviair – dronezoner.eu (NOTAM). Nur zur Information; aktuelle NOTAMs zusätzlich prüfen.`);
  const original = [notamText, ...rawNotams].filter(Boolean);
  if (original.length) lines.push("", "Originaltext der Behörde:", ...original);
  const props: Record<string, any> = {
    identifier: `DK-NOTAM-${layer}-${name.replace(/\s+/g, "")}-${start ?? dkStr(p.OBJECTID)}`,
    name: layer === "disabled" ? `${name}${description && description !== name ? ` (${description.replace(name, "").trim()})` : ""} – nicht aktiviert` : name,
    restriction,
    lowerMeters: lower.meters,
    lowerReference: lower.reference,
    message: lines.join("\n"),
    source: DANISH_GEOZONE_SOURCE_LABEL,
    dkLayer: layer,
    dkNotamType: type || undefined,
    dkStatus: dkStr(p.Status) || undefined,
  };
  const link = dkStr(p.link);
  if (/^https?:\/\//i.test(link)) {
    props.notamsUrl = link;
    props.notamsUrlLabel = "Naviair-Briefingkarte öffnen";
  }
  if (layer === "disabled") {
    const horizon = ctx.now + DK_DISABLED_HORIZON_MS;
    props.applicability = [
      { permanent: "NO", startDateTime: new Date(horizon).toISOString(), endDateTime: new Date(horizon + DK_OPEN_AFTER_HORIZON_MS).toISOString() },
    ];
  } else {
    props.isNotam = true;
    props._notamEligible = true;
    if (start != null) props.validStartTs = start;
    if (end != null) props.validEndTs = end;
    if (start != null || end != null) {
      props.applicability = [{
        permanent: "NO",
        ...(start != null ? { startDateTime: new Date(start).toISOString() } : {}),
        ...(end != null ? { endDateTime: new Date(end).toISOString() } : {}),
      }];
    }
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", geometry: raw.geometry, properties: props };
}

/** An-/Abflugfläche (Ind- og udflyvningsplan) → Achtungs-Zone. */
export function normalizeDanishCorridorFeature(raw: DanishGeoFeature): DanishGeoFeature | null {
  if (!raw || !polygonal(raw.geometry)) return null;
  const p: Record<string, any> = raw.properties || {};
  const airport = dkStr(p.lufthavn);
  const icao = dkStr(p.icaokode);
  const type = dkStr(p.type);
  const name = `An-/Abflugfläche ${airport || icao || "Flugplatz"}${icao && airport ? ` (${icao})` : ""}`;
  const lines = [
    `Typ: An- und Abflugfläche (Ind- og udflyvningsplan${type ? `, ${type}` : ""}) – Zone mit Auflagen, besondere Vorsicht`,
    "Hier fliegen Luftfahrzeuge in geringer Höhe an und ab. Für Drohnenflüge gelten die Regeln der Trafikstyrelsen (Flugplatz-Abstände) – im Zweifel vorher mit dem Flugplatz abstimmen.",
  ];
  if (icao) lines.push(`ICAO: ${icao}`);
  const inForce = dkStr(p.ikrafttr);
  if (inForce) lines.push(`In Kraft seit: ${inForce}`);
  lines.push("Quelle: Trafikstyrelsen – offizielle Ind- og udflyvningsplaner (dronezoner.eu). Nur zur Information, nicht zur Navigation.");
  const props: Record<string, any> = {
    identifier: `DK-APP-${icao || airport.replace(/\s+/g, "")}-${dkStr(p.FID) || dkStr(p.OBJECTID) || dkStr(p.gml_id)}`,
    name,
    restriction: "CONDITIONAL",
    lowerMeters: 0,
    lowerReference: "AGL",
    message: lines.join("\n"),
    source: DANISH_GEOZONE_SOURCE_LABEL,
    ICAO: icao || undefined,
    dkLayer: "corridors",
  };
  const link = dkStr(p.link);
  if (/^https?:\/\//i.test(link)) {
    props.infoUrl = link;
    props.infoUrlLabel = "Ind- og udflyvningsplaner (Trafikstyrelsen)";
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", geometry: raw.geometry, properties: props };
}

const DK_LAYER_PRIORITY: Record<string, number> = { active: 0, awareness: 1, inactive: 2, disabled: 3 };

/**
 * Live-Ebenen → App-Features. NOTAM-Ebenen werden über den Namen dedupliziert
 * (aktiv > Achtung > inaktiv > deaktiviert; mehrere NOTAMs desselben Gebiets
 * mit unterschiedlichem Beginn bleiben), Flächen über identische Geometrie.
 */
export function normalizeDanishLiveLayers(
  byLayer: Partial<Record<DanishLiveLayerKey, DanishGeoFeature[]>>,
  now: number,
): DanishGeoFeature[] {
  const notams: DanishGeoFeature[] = [];
  for (const key of ["active", "awareness", "inactive", "disabled"] as const) {
    for (const raw of byLayer[key] ?? []) {
      const f = normalizeDanishNotamFeature(raw, key, { now });
      if (f) notams.push(f);
    }
  }
  const bestByName = new Map<string, number>();
  for (const f of notams) {
    const n = dkStr((f.properties as any).name).replace(/ – nicht aktiviert$/, "").split(" (")[0];
    const pr = DK_LAYER_PRIORITY[String(f.properties?.dkLayer)] ?? 9;
    bestByName.set(n, Math.min(bestByName.get(n) ?? 9, pr));
  }
  const out: DanishGeoFeature[] = [];
  const seenIds = new Set<string>();
  for (const f of notams) {
    const n = dkStr((f.properties as any).name).replace(/ – nicht aktiviert$/, "").split(" (")[0];
    const pr = DK_LAYER_PRIORITY[String(f.properties?.dkLayer)] ?? 9;
    if (pr !== bestByName.get(n)) continue;
    const id = String(f.properties?.identifier);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(f);
  }
  const seenGeom = new Set<string>();
  for (const raw of byLayer.corridors ?? []) {
    const f = normalizeDanishCorridorFeature(raw);
    if (!f) continue;
    const g = JSON.stringify(f.geometry?.coordinates);
    if (seenGeom.has(g)) continue;
    seenGeom.add(g);
    let id = String(f.properties?.identifier);
    while (seenIds.has(id)) id = `${id}#`;
    seenIds.add(id);
    (f.properties as any).identifier = id;
    out.push(f);
  }
  return out;
}
