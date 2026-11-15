import { GODRONE_GEOZONE_SOURCE_LABEL } from "../../shared/dutchGeozones";
import { translateTextDe, translateZoneNameDe } from "../../shared/zoneTranslate";
import { EANS_GEOZONE_SOURCE_LABEL } from "../../shared/estonianGeozones";
import { CH_GEOZONE_SOURCE_LABEL } from "../../shared/swissGeozones";
import { FI_GEOZONE_SOURCE_LABEL } from "../../shared/finnishGeozones";
import { NO_GEOZONE_SOURCE_LABEL } from "../../shared/norwegianGeozones";
import { IE_GEOZONE_SOURCE_LABEL, LU_GEOZONE_SOURCE_LABEL } from "../../shared/irishLuxGeozones";
import { SE_GEOZONE_SOURCE_LABEL } from "../../shared/swedishGeozones";
import { PT_GEOZONE_SOURCE_LABEL } from "../../shared/portugueseGeozones";
import { ES_GEOZONE_SOURCE_LABEL } from "../../shared/spanishGeozones";
import { PL_GEOZONE_SOURCE_LABEL } from "../../shared/polishGeozones";
import { IT_GEOZONE_SOURCE_LABEL } from "../../shared/italianGeozones";
import type { GeozoneFeatureInfo } from "@/lib/geozones";
import { DANISH_GEOZONE_SOURCE_LABEL } from "../../shared/danishGeozones";
import { belgianAltitudeMeters } from "../../shared/belgianGeozones";
import { normalizeAltitudeReference, isGeozoneExpired, type AltitudeReference } from "../../shared/geozoneAltitudeFilter";
import { ed269SourceInfo } from "../../shared/ed269SourceInfo";
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
} from "../../shared/ed269Restriction";

export {
  normalizeEd269Restriction,
  ed269RestrictionColors,
  ed269ValidityFromProps,
  ed269ScheduleFromProps,
  ed269IsNotamEligible,
  ed269IsActiveAt,
  geozoneIsActiveAt,
  ed269InactiveInfoText,
} from "../../shared/ed269Restriction";

// Liest den Höhenbezug (MSL/AGL) der Untergrenze aus den uneinheitlichen
// ED-269-Quellfeldern: Belgien (Droneguide-Bundle) liefert
// `lowerAltitude.reference`, die skeyes-Live-API `lowerReference`
// (lowerVerticalReference), Österreich i. d. R. nichts -> Default AGL.
export function ed269LowerReference(p: Record<string, any>): AltitudeReference {
  const raw =
    (p.lowerAltitude && typeof p.lowerAltitude === "object"
      ? p.lowerAltitude.reference
      : undefined) ??
    p.lowerReference ??
    p.lowerVerticalReference ??
    p.lowerLimitReference;
  return normalizeAltitudeReference(raw);
}

export const ED269_RESTRICTION_LABELS: Record<string, string> = {
  PROHIBITED: "Verboten",
  RESTRICTED: "Beschränkt",
  REQ_AUTHORISATION: "Genehmigung erforderlich",
  CONDITIONAL: "Bedingt zulässig",
  NO_RESTRICTION: "Keine Beschränkung",
  NATURE: "Naturschutz",
};

// Quellen-/Anbieterbezeichnung je Land für ED-269-Vektorzonen (Popup-Untertitel).
export const ED269_SOURCE_LABELS: Record<string, string> = {
  AT: "Austro Control (ED-269)",
  BE: "skeyes / Droneguide (ED-269)",
  DK: DANISH_GEOZONE_SOURCE_LABEL,
  NL: GODRONE_GEOZONE_SOURCE_LABEL,
  EE: EANS_GEOZONE_SOURCE_LABEL,
  CH: CH_GEOZONE_SOURCE_LABEL,
  LI: CH_GEOZONE_SOURCE_LABEL,
  FI: FI_GEOZONE_SOURCE_LABEL,
  NO: NO_GEOZONE_SOURCE_LABEL,
  IE: IE_GEOZONE_SOURCE_LABEL,
  LU: LU_GEOZONE_SOURCE_LABEL,
  SE: SE_GEOZONE_SOURCE_LABEL,
  PT: PT_GEOZONE_SOURCE_LABEL,
  ES: ES_GEOZONE_SOURCE_LABEL,
  PL: PL_GEOZONE_SOURCE_LABEL,
  LT: "Oro navigacija (ED-269)",
  IT: IT_GEOZONE_SOURCE_LABEL,
};

// Wandelt einen ED-269-Höhenwert in Meter um. Versteht Klartext-Marker (SFC/GND
// -> 0, UNL/UNLIMITED -> unbegrenzt) sowie Zahlen mit Maßeinheit (FT -> Meter).
export function ed269LimitMeters(value: any, uom: string): number | undefined {
  if (value == null) return undefined;
  const s = value.toString().toUpperCase().trim();
  if (s === "SFC" || s === "GND" || s === "0") return 0;
  if (s === "UNL" || s === "UNLIMITED" || s === "GND_UNL") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const u = (uom || "").toString().toUpperCase();
  if (u === "FT" || u === "F" || u === "FEET") return n * 0.3048;
  return n; // M / METERS / Default
}

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ed269AltitudeLabel(
  lowerMeters: number | undefined,
  upperMeters: number | undefined,
): string {
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
    // AT/DK liefern einen String. Beide Formen unterstützen.
    const restrictionRaw =
      p.restriction && typeof p.restriction === "object"
        ? (p.restriction as any).type
        : p.restriction;
    const restriction = normalizeEd269Restriction(
      (restrictionRaw ?? p.type ?? p.zoneRestriction ?? "").toString(),
    );
    const colors = ed269RestrictionColors(restriction);
    const restrictionLabel = ED269_RESTRICTION_LABELS[restriction] ?? (restriction || "Beschränkung");

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
    const altitudeLabel = ed269AltitudeLabel(lowerMeters, upperMeters);

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
    // Behördentext ins Deutsche; das Original bleibt unten erhalten
    const originalMessage = message;
    if (message && !hasGermanOriginal) {
      const tr = translateTextDe(message);
      message = tr.text;
    }
    const messageTranslated = !!originalMessage && message !== originalMessage;

    const detailLines: string[] = [];
    // Den Zonennamen in der Beschreibung erneut aufgreifen, damit die Zone auch im
    // Beschreibungstext (nicht nur im Titel/Popup-Header) eindeutig benannt ist –
    // besonders hilfreich, wenn sich mehrere Zonen überlagern.
    if (name && name !== "Geozone") detailLines.push(`Zone: ${name}`);
    detailLines.push(`Beschränkung: ${restrictionLabel}`);
    detailLines.push(`Höhe: ${altitudeLabel}`);
    const scheduleText = ed269ScheduleFromProps(p);
    if (p.reason) detailLines.push(`Grund: ${stripHtml(String(p.reason))}`);
    if (message) detailLines.push(message);
    const sourceInfo = ed269SourceInfo(p);
    detailLines.push(...sourceInfo.details);
    // Rechtlich maßgeblich ist die Behördenfassung: Original immer mitgeben
    if (messageTranslated || name !== originalName) {
      detailLines.push("Originaltext der Behörde:");
      if (name !== originalName) detailLines.push(originalName);
      if (messageTranslated) detailLines.push(originalMessage);
    }

    const { validStartTs, validEndTs } = ed269ValidityFromProps(p);

    // Abgelaufene Zonen (Gültigkeitsende in der Vergangenheit) gar nicht erst
    // ausgeben -> sie verschwinden so aus ALLEN nativen Karten/Listen/Treffer-
    // tests (Radar, MapPicker, NOTAMs, Planung), die über parseEd269ToGeozoneInfo
    // laufen. Dauerhafte Zonen (validEndTs == null) bleiben sichtbar.
    if (isGeozoneExpired(validEndTs)) continue;

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
      fillColor: colors.fill,
      strokeColor: colors.stroke,
      lowerMeters,
      upperMeters,
      altitudeLabel,
      validStartTs,
      validEndTs,
      scheduleText: scheduleText.length > 0 ? scheduleText : undefined,
      ed269Applicability: ed269ActivityFromProps(p),
      notamEligible: ed269IsNotamEligible(p, countryIso),
      applicationText: p.applicationText ? String(p.applicationText) : undefined,
      links: links.length > 0 ? links : undefined,
      lowerReference: ed269LowerReference(p),
    });
  }
  return out;
}
