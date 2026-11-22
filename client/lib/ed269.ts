import { ed269SourceLabels } from "./geozoneSources/registry";
import { translateLineDe, translateTextDe, translateZoneNameDe } from "../../shared/zoneTranslate";
import type { GeozoneFeatureInfo } from "@/lib/geozones";
import { belgianAltitudeMeters } from "../../shared/belgianGeozones";
import { stripHtml } from "../../shared/geozoneKit/text";
import { ORIGINAL_TEXT_HEADING } from "../../shared/geozoneKit/messages";
import { normalizeAltitudeReference, type AltitudeReference } from "../../shared/geozoneAltitudeFilter";
import {
  formatHeightRangeDe,
  heightFromMeters,
  parseHeight,
  parseHeightRange,
  withSourceText,
  type Height,
} from "../../shared/heights";
import { ed269SourceInfo } from "../../shared/ed269SourceInfo";
import { RESTRICTIONS, RESTRICTION_POLICY, type Restriction } from "../../shared/restrictionPolicy";
// Beschränkungs-Normalisierung, Farben und Gültigkeitsfenster leben in shared/,
// damit der Server (Kachel-Rasterisierung) und der Client GENAU dieselbe
// Klassifizierung/Färbung verwenden. Hier nur re-exportieren, damit bestehende
// Importpfade ("@/lib/ed269") stabil bleiben.
import {
  normalizeEd269Restriction,
  ed269RestrictionColors,
  ed269ValidityFromProps,
  ed269ScheduleFromProps,
  ed269IsNotamEligible,
  ed269ActivityFromProps,
  zoneEndedLongAgo,
} from "../../shared/ed269Restriction";
import { shouldYield, yieldToUi } from "../../shared/yieldingWork";

export {
  normalizeEd269Restriction,
  ed269RestrictionColors,
  ed269ValidityFromProps,
  ed269ScheduleFromProps,
  ed269IsNotamEligible,
  ed269IsActiveAt,
  zoneActivityAt,
  isZoneActiveAt,
  isZoneActiveInContext,
  zoneTimeReferences,
  ed269InactiveInfoText,
  type ZoneActivity,
  type ZoneTimeContext,
} from "../../shared/ed269Restriction";

// Rohbezug einer Grenze aus den uneinheitlichen ED-269-Quellfeldern: Belgien
// (Droneguide-Bundle) liefert `lowerAltitude.reference`, die skeyes-Live-API
// `lowerReference` (lowerVerticalReference). Österreich/Litauen (Frequentis)
// liefern den Bezug nur im ED-269-Original `properties.geometry` (Objekt bzw.
// erstes Volumen) und im Anzeige-String `lower`/`upper` („150 M AGL“).
function ed269RawReference(p: Record<string, any>, side: "lower" | "upper"): unknown {
  const alt = p[`${side}Altitude`];
  const g = Array.isArray(p.geometry) ? p.geometry[0] : p.geometry;
  return (
    (alt && typeof alt === "object" ? alt.reference : undefined) ??
    p[`${side}Reference`] ??
    p[`${side}VerticalReference`] ??
    p[`${side}LimitReference`] ??
    (g && typeof g === "object" ? g[`${side}VerticalReference`] : undefined)
  );
}

// Höhenbezug (MSL/AGL/UNKNOWN) der Untergrenze. Fehlt er, ist er UNKNOWN
// (früher stiller AGL-Rückfall); der Höhenfilter blendet UNKNOWN nie aus.
export function ed269LowerReference(p: Record<string, any>): AltitudeReference {
  return normalizeAltitudeReference(ed269RawReference(p, "lower"));
}

/**
 * Explizite max. Flughöhe AGL ohne Genehmigung (m) aus den Normalisierer-
 * Properties (maxFlightHeightAglM bzw. openCategoryMaxAglMeters, z. B. SE/HR
 * CTR 50 m). undefined, wenn nicht gesetzt — die Volumen-Obergrenze (upper)
 * wird bewusst NICHT als Flughöhen-Limit interpretiert.
 */
export function ed269MaxFlightHeightAglM(p: Record<string, any>): number | undefined {
  const raw = p.maxFlightHeightAglM ?? p.openCategoryMaxAglMeters;
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Labels kommen aus der Policy-Tabelle (einzige Quelle).
export const ED269_RESTRICTION_LABELS: Record<Restriction, string> = Object.fromEntries(
  RESTRICTIONS.map((r) => [r, RESTRICTION_POLICY[r].labelDe]),
) as Record<Restriction, string>;

// Quellen-/Anbieterbezeichnung je Land für ED-269-Vektorzonen (Popup-Untertitel)
// – abgeleitet aus der Quellen-Registry (client/lib/geozoneSources/registry.ts,
// Feld sourceLabel; alle Länder des ED-269-Gerätecaches inkl. Aliase wie LI).
export const ED269_SOURCE_LABELS: Record<string, string> = ed269SourceLabels();

// Wandelt einen ED-269-Höhenwert in Meter um (shared/heights.ts parseHeight):
// SFC/GND -> 0, UNL/UNLIMITED -> unbegrenzt (undefined), Zahlen mit Maßeinheit
// (FT -> Meter, FL -> 100 ft) sowie Text wie „1500 ft AMSL“.
export function ed269LimitMeters(value: any, uom: string): number | undefined {
  const h = parseHeight(value, uom);
  return h && h.m != null ? h.m : undefined;
}

/**
 * Strukturierte Unter-/Obergrenze (Height) einer ED-269-Zone. Meter und Bezug
 * kommen aus den Normalisierer-Properties; Einheit/Schreibweise der Quelle
 * („1500 ft AMSL“, „FL95“) aus dem Wert selbst bzw. `altitudeText`, sofern sie
 * zu den Metern passen.
 */
export function ed269Heights(
  p: Record<string, any>,
  lowerMeters: number | undefined,
  upperMeters: number | undefined,
): { lower: Height; upper: Height } {
  const uom = (p.uomDimensions ?? p.uom ?? p.unit ?? "M").toString();
  const fromText = parseHeightRange(p.altitudeText);
  const side = (s: "lower" | "upper", meters: number | undefined, text: Height | null): Height => {
    const ref = ed269RawReference(p, s);
    const alt = p[`${s}Altitude`];
    const srcValue = alt && typeof alt === "object" ? alt : p[`${s}Limit`] ?? p[s];
    const src = srcValue != null ? parseHeight(srcValue, uom, ref) : null;
    // AT/LT: upperMeters 10000 ist der UNL-Platzhalter (Anzeige-String „UNL“).
    if (s === "upper" && src?.m == null && src?.text === "UNL" && meters != null && meters >= 9999) {
      return heightFromMeters(undefined, ref, "upper");
    }
    // Quellwert/-text ergänzt Einheit und (falls fehlend) den Bezug, nur wenn
    // er zu den Metern passt (withSourceText).
    return withSourceText(withSourceText(heightFromMeters(meters, ref, s), src), text);
  };
  return {
    lower: side("lower", lowerMeters, fromText.lower),
    upper: side("upper", upperMeters, fromText.upper),
  };
}

// HTML → Klartext: gemeinsamer Baukasten (shared/geozoneKit/text.ts).
export { stripHtml };

export function ed269AltitudeLabel(
  lowerMeters: number | undefined,
  upperMeters: number | undefined,
  lower?: Height,
  upper?: Height,
): string {
  // Mit strukturierten Grenzen: Bezug anzeigen („GND – 1500 ft AMSL (457 m)“).
  if (lower || upper) return formatHeightRangeDe(lower, upper);
  const fmtLower = lowerMeters == null ? "GND" : `${Math.round(lowerMeters)} m`;
  const fmtUpper = upperMeters == null ? "unbegrenzt" : `${Math.round(upperMeters)} m`;
  return `${fmtLower} – ${fmtUpper}`;
}

// Absolutbetrag der (planar-shoelace) Ringfläche für Ringe im internen
// [lat, lon]-Format. Nur als Größenvergleich (Außenring vs. Loch) genutzt –
// keine geodätische Genauigkeit nötig.
function ringAbsArea(ring: [number, number][]): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// Wandelt eine ED-269-GeoJSON-FeatureCollection (Austro Control) in das interne
// GeozoneFeatureInfo-Schema um. Höhen liegen bereits in Metern vor
// (lowerMeters/upperMeters). `hidden`-Zonen werden gefiltert. Koordinaten der
// GeoJSON-Geometrie liegen als [lon, lat] vor und werden in das interne
// [lat, lon]-Format gedreht.
export function parseEd269ToGeozoneInfo(
  features: any[],
  countryIso: string,
  nowMs: number = Date.now(),
): GeozoneFeatureInfo[] {
  const out: GeozoneFeatureInfo[] = [];
  for (const f of features) {
    if (!f || !f.geometry) continue;
    const p: Record<string, any> = f.properties || {};
    if (p.hidden === true) continue;

    const geom = f.geometry;
    const polygonRings: [number, number][][] = [];
    // Gruppierte Ringe pro Polygon: [Außenring, Loch1, …]. In GeoJSON ist der
    // erste Ring eines Polygons der Außenring, alle weiteren sind Löcher. Diese
    // Gruppierung bleibt erhalten, damit die native Karte Donut-Zonen (z. B.
    // belgische Flughäfen) als echte Löcher aussparen kann.
    const polygonGroups: [number, number][][][] = [];
    const pushPolygon = (coords: any) => {
      if (!Array.isArray(coords)) return;
      const group: [number, number][][] = [];
      for (const ring of coords) {
        if (!Array.isArray(ring)) continue;
        const pts: [number, number][] = [];
        for (const c of ring) {
          if (!Array.isArray(c) || c.length < 2) continue;
          const lon = Number(c[0]);
          const lat = Number(c[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          pts.push([lat, lon]);
        }
        if (pts.length >= 3) {
          polygonRings.push(pts);
          group.push(pts);
        }
      }
      // Ring-Rollen deterministisch über Geometrie statt blind über die GeoJSON-
      // Reihenfolge bestimmen: der flächengrößte Ring ist der Außenring, alle
      // übrigen sind Löcher. So wird das durch die innere Zone definierte Loch
      // zuverlässig ausgestochen, selbst wenn der Außenring nicht zuerst steht.
      if (group.length > 1) {
        let maxIdx = 0;
        let maxArea = -1;
        for (let i = 0; i < group.length; i++) {
          const a = ringAbsArea(group[i]);
          if (a > maxArea) {
            maxArea = a;
            maxIdx = i;
          }
        }
        if (maxIdx !== 0) {
          const tmp = group[0];
          group[0] = group[maxIdx];
          group[maxIdx] = tmp;
        }
      }
      if (group.length > 0) polygonGroups.push(group);
    };
    if (geom.type === "Polygon") pushPolygon(geom.coordinates);
    else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) pushPolygon(poly);
    }
    if (polygonRings.length === 0) continue;

    // Belgien (skeyes) liefert restriction als Objekt { type: "PROHIBITED" };
    // AT/DK liefern einen String. Beide Formen unterstützen. Ergebnis ist immer
    // ein Wert der geschlossenen Union (unbekannt → UNKNOWN).
    const restrictionRawValue =
      p.restriction && typeof p.restriction === "object"
        ? (p.restriction as any).type
        : p.restriction;
    const restrictionSource = (restrictionRawValue ?? p.type ?? p.zoneRestriction ?? "").toString();
    const restriction = normalizeEd269Restriction(restrictionSource);
    const colors = ed269RestrictionColors(restriction);
    // Unbekannte Rohwerte bleiben zur Anzeige erhalten (nie für Entscheidungen).
    const restrictionLabel =
      restriction === "UNKNOWN" && restrictionSource.trim()
        ? `${ED269_RESTRICTION_LABELS.UNKNOWN} (${restrictionSource.trim()})`
        : ED269_RESTRICTION_LABELS[restriction];

    // Höhen: Österreich liefert lowerMeters/upperMeters (bereits Meter). Belgien
    // (Droneguide) liefert lowerLimit/upperLimit + uomDimensions (M/FT). Beides
    // auf Meter normalisieren; SFC/GND -> 0, UNL -> unbegrenzt.
    const uom = (p.uomDimensions ?? p.uom ?? p.unit ?? "M").toString();
    // Belgien (skeyes) liefert lowerAltitude/upperAltitude als Objekt
    // { value, reference, unit: "F"|"FL" }. Diese Form über belgianAltitudeMeters
    // umrechnen, sonst die bestehenden Felder (AT: lowerMeters; generisch:
    // lowerLimit/lower + uom).
    const lowerMeters =
      typeof p.lowerMeters === "number"
        ? p.lowerMeters
        : p.lowerAltitude && typeof p.lowerAltitude === "object"
          ? belgianAltitudeMeters(p.lowerAltitude)
          : ed269LimitMeters(p.lowerLimit ?? p.lower, uom);
    const upperMeters =
      typeof p.upperMeters === "number"
        ? p.upperMeters
        : p.upperAltitude && typeof p.upperAltitude === "object"
          ? belgianAltitudeMeters(p.upperAltitude)
          : ed269LimitMeters(p.upperLimit ?? p.upper, uom);
    const heights = ed269Heights(p, lowerMeters, upperMeters);
    const altitudeLabel = ed269AltitudeLabel(lowerMeters, upperMeters, heights.lower, heights.upper);

    const originalName = (p.name || p.identifier || p.zoneId || "Geozone").toString();
    // Zonenname ins Deutsche (Gattungswörter übersetzt, Eigennamen bleiben)
    const name = translateZoneNameDe(originalName);

    let message = "";
    let hasGermanOriginal = false;
    const localized = p.extendedProperties?.localizedMessages;
    if (Array.isArray(localized) && localized.length > 0) {
      const deMsg = localized.find((m: any) => (m?.language || "").toLowerCase().startsWith("de"));
      hasGermanOriginal = !!deMsg;
      const pick = deMsg ?? localized.find((m: any) => (m?.language || "").toLowerCase().startsWith("en")) ?? localized[0];
      message = stripHtml((pick?.message || pick?.text || "").toString());
    }
    if (!message) message = stripHtml((p.message || p.reason || p.description || "").toString());
    // Behördentext ins Deutsche (Wörterbuch + Satzmuster, offline); das Original
    // bleibt unten erhalten. Enthält die (deutsche) Meldung schon einen Block
    // „Originaltext der Behörde:“, kommen dessen übersetzte Zeilen davor und das
    // Original wird nicht ein zweites Mal angehängt. Nicht übersetzbare Zeilen
    // tragen „(nicht übersetzt)“ – außer in deutschen Meldungen der Normalisierer.
    const originalMessage = message;
    let messageTranslated = false;
    let originalInMessage = false;
    if (message) {
      const tr = translateTextDe(message, { markUntranslated: !hasGermanOriginal });
      message = tr.text;
      originalInMessage = tr.originalIncluded;
      messageTranslated = tr.changed && !tr.originalIncluded;
    }
    if (originalInMessage && name !== originalName) {
      // Originalname in den vorhandenen Originalblock statt einer zweiten Überschrift
      message = message.replace(`${ORIGINAL_TEXT_HEADING}\n`, `${ORIGINAL_TEXT_HEADING}\n${originalName}\n`);
    }

    const detailLines: string[] = [];
    // Den Zonennamen in der Beschreibung erneut aufgreifen, damit die Zone auch im
    // Beschreibungstext (nicht nur im Titel/Popup-Header) eindeutig benannt ist –
    // besonders hilfreich, wenn sich mehrere Zonen überlagern.
    if (name && name !== "Geozone") detailLines.push(`Zone: ${name}`);
    detailLines.push(`Beschränkung: ${restrictionLabel}`);
    detailLines.push(`Höhe: ${altitudeLabel}`);
    const scheduleText = ed269ScheduleFromProps(p);
    if (p.reason) detailLines.push(translateLineDe(`Grund: ${stripHtml(String(p.reason))}`));
    if (message) detailLines.push(message);
    const sourceInfo = ed269SourceInfo(p);
    detailLines.push(...sourceInfo.details);
    // Rechtlich maßgeblich ist die Behördenfassung: Original immer mitgeben
    if (messageTranslated || (name !== originalName && !originalInMessage)) {
      detailLines.push(ORIGINAL_TEXT_HEADING);
      if (name !== originalName) detailLines.push(originalName);
      if (messageTranslated) detailLines.push(originalMessage);
    }

    const { validStartTs, validEndTs } = ed269ValidityFromProps(p);
    const ed269Applicability = ed269ActivityFromProps(p);

    // Ob eine Zone aktiv ist, entscheidet NICHT das Parsen, sondern
    // zoneActivityAt für den jeweiligen Zeitpunkt (Radar: jetzt, Planung:
    // geplante Zeit …) – Gültigkeit und applicability bleiben dafür erhalten.
    // Nur Zonen, die schon länger als ZONE_EXPIRED_DROP_GRACE_MS (1 Tag) vorbei
    // sind, werden verworfen, damit lange gecachte Pakete keinen Speicher
    // binden. Dauerhafte Zonen (ohne Ende) bleiben immer erhalten.
    if (zoneEndedLongAgo({ validEndTs, ed269Applicability }, nowMs)) continue;
    // Brussels FIR (BE/LU): NOTAM-Gebiete ohne Gültigkeit stammen aus dem
    // Droneguide-Bestand geo_zone_fast und sind fast immer längst abgelaufen
    // (z. B. G2219/26 Tour de Luxembourg). Auch aus älteren Gerätespeichern
    // verwerfen – gültige NOTAMs liefert skeyes mit Start/Ende.
    if (
      countryIso.toUpperCase() === "BE" &&
      validEndTs == null &&
      String(p.type ?? p.type_code ?? "").toUpperCase() === "NOTAM"
    ) continue;

    // Anklickbare Zonen-Links (dänische Zonen tragen Antrags-/Info-Links und ggf.
    // eine Kontakt-E-Mail). Andere Quellen lassen diese Felder leer.
    const links: { label: string; url: string }[] = [...sourceInfo.links];
    if (p.applicationUrl) {
      links.push({ label: (p.applicationUrlLabel || "Antrag stellen").toString(), url: String(p.applicationUrl) });
    }
    if (p.infoUrl) {
      links.push({ label: (p.infoUrlLabel || "Weitere Infos").toString(), url: String(p.infoUrl) });
    }
    if (p.contactEmail) {
      links.push({ label: String(p.contactEmail), url: `mailto:${String(p.contactEmail)}` });
    }
    if (p.notamsUrl) {
      links.push({
        label: String(p.notamsUrlLabel || "NOTAM-/Luftraumkarte öffnen"),
        url: String(p.notamsUrl),
      });
    }

    out.push({
      layerLabel: ED269_SOURCE_LABELS[countryIso.toUpperCase()] ?? "ED-269",
      name,
      details: detailLines.join("\n"),
      featureId: (p.zoneId || p.identifier || name).toString(),
      polygonRings,
      polygonGroups,
      country: countryIso.toUpperCase(),
      restriction,
      restrictionRaw: restrictionSource && restrictionSource !== restriction ? restrictionSource : undefined,
      fillColor: colors.fill,
      strokeColor: colors.stroke,
      lowerMeters,
      upperMeters,
      lower: heights.lower,
      upper: heights.upper,
      altitudeLabel,
      validStartTs,
      validEndTs,
      scheduleText: scheduleText.length > 0 ? scheduleText : undefined,
      ed269Applicability,
      notamEligible: ed269IsNotamEligible(p, countryIso),
      applicationText: p.applicationText ? String(p.applicationText) : undefined,
      links: links.length > 0 ? links : undefined,
      lowerReference: heights.lower.ref,
      ...(heights.upper.m != null ? { upperReference: heights.upper.ref } : {}),
      maxFlightHeightAglM: ed269MaxFlightHeightAglM(p),
    });
  }
  return out;
}

/**
 * parseEd269ToGeozoneInfo in Zeitscheiben (je Feature unabhängig – Ergebnis
 * identisch). Kartenabfrage eines ganzen Landes: 1200 Zonen ≈ 40–100 ms Node am
 * Stück, auf dem Gerät mehrere hundert ms.
 */
export async function parseEd269ToGeozoneInfoYielding(features: any[], countryIso: string): Promise<GeozoneFeatureInfo[]> {
  const out: GeozoneFeatureInfo[] = [];
  for (let i = 0; i < features.length; i += 16) {
    for (const z of parseEd269ToGeozoneInfo(features.slice(i, i + 16), countryIso)) out.push(z);
    if (shouldYield()) await yieldToUi("ed269-convert");
  }
  return out;
}
