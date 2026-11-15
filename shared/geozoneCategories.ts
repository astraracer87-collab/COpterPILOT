// Länderübergreifende Geozonen-Kategorie-Taxonomie.
//
// Dieses Modul ist bewusst frei von React-Native- und Web-spezifischen Importen,
// damit es sowohl von der Expo-App (client/) als auch von der Web-App (web/)
// genutzt UND mit dem tsx-Test-Runner geprüft werden kann.
//
// Idee: Die Geozonen-Auswahl wird NICHT mehr pro Land gespeichert, sondern pro
// länderübergreifender Kategorie (z. B. "Naturschutz"). Ein einziger Schalter
// blendet diesen Zonentyp in JEDEM Land ein/aus, in dem er als eigener WMS-Layer
// trennbar ist. Datensätze, die technisch nicht trennbar sind (CH-Restriktionen,
// NL, LU, FR sowie die Vektor-Zonen AT/BE/DK), behalten einen eigenen
// landeseigenen Gesamt-Schalter.

export type GeozoneCategoryId =
  | "ctr"
  | "edr"
  | "temp"
  | "airports"
  | "nature"
  | "military_security"
  | "infrastructure"
  | "residential";

export interface GeozoneCategoryDef {
  id: GeozoneCategoryId;
  label: string;
  order: number;
  defaultEnabled: boolean;
  // Schlüssel in GEOZONE_REGULATORY_INFO (repräsentativer Original-Layer), damit
  // der Info-(i)-Button je Kategorie weiterhin Inhalte zeigt. Optional.
  infoId?: string;
}

// Anzeige-Reihenfolge entspricht order. Defaults: für eine Sicherheits-App
// werden alle Kategorien standardmäßig eingeblendet (fail-safe: lieber zu viel
// anzeigen als eine relevante Zone verstecken).
export const GEOZONE_CATEGORIES: GeozoneCategoryDef[] = [
  { id: "ctr", label: "Kontrollzonen (CTR)", order: 1, defaultEnabled: true, infoId: "kontrollzonen" },
  { id: "edr", label: "Flugbeschränkungsgebiete (ED-R)", order: 2, defaultEnabled: true, infoId: "flugbeschraenkungsgebiete" },
  { id: "temp", label: "Temporäre Beschränkungen", order: 3, defaultEnabled: true, infoId: "temporaere_betriebseinschraenkungen" },
  { id: "airports", label: "Flughäfen & Flugplätze", order: 4, defaultEnabled: true, infoId: "flughaefen" },
  { id: "nature", label: "Naturschutz", order: 5, defaultEnabled: true, infoId: "naturschutzgebiete" },
  { id: "military_security", label: "Militär & Sicherheit", order: 6, defaultEnabled: true, infoId: "militaerische_anlagen" },
  { id: "infrastructure", label: "Infrastruktur (Energie/Verkehr)", order: 7, defaultEnabled: true, infoId: "stromleitungen" },
  { id: "residential", label: "Wohngebiete", order: 8, defaultEnabled: true, infoId: "wohngrundstuecke" },
];

export function getCategoryDef(id: GeozoneCategoryId): GeozoneCategoryDef | undefined {
  return GEOZONE_CATEGORIES.find((c) => c.id === id);
}

// Zuordnung WMS-Layer-Name -> Kategorie, je Land. Es wird bewusst nach dem
// WMS-Layer-NAMEN gemappt (nicht nach der app-spezifischen Layer-ID), weil Web
// (`layer`) und Native (`wmsLayer`) denselben WMS-Namen verwenden. Die Web-DE-
// Layer sind eine Teilmenge der nativen ~33 DE-Layer.
//
// Nur trennbare Layer stehen hier. Nicht trennbare/landeseigene Datensätze
// (CH-Drohnen/UAS/SORA, NL, LU, FR) tauchen NICHT auf und werden über den
// kombinierten Länder-Gesamt-Schalter (siehe COMBINED_COUNTRY_TOGGLES) gesteuert.
export const WMS_LAYER_CATEGORY: Record<string, Record<string, GeozoneCategoryId>> = {
  DE: {
    kontrollzonen: "ctr",
    flugbeschraenkungsgebiete: "edr",
    temporaere_betriebseinschraenkungen: "temp",
    flughaefen: "airports",
    flugplaetze: "airports",
    modellflugplaetze: "airports",
    haengegleiter: "airports",
    naturschutzgebiete: "nature",
    nationalparks: "nature",
    vogelschutzgebiete: "nature",
    "ffh-gebiete": "nature",
    militaerische_anlagen: "military_security",
    diplomatische_vertretungen: "military_security",
    behoerden: "military_security",
    internationale_organisationen: "military_security",
    justizvollzugsanstalten: "military_security",
    polizei: "military_security",
    sicherheitsbehoerden: "military_security",
    krankenhaeuser: "military_security",
    labore: "military_security",
    binnenwasserstrassen: "infrastructure",
    seewasserstrassen: "infrastructure",
    schifffahrtsanlagen: "infrastructure",
    industrieanlagen: "infrastructure",
    stromleitungen: "infrastructure",
    umspannwerke: "infrastructure",
    kraftwerke: "infrastructure",
    windkraftanlagen: "infrastructure",
    bundesautobahnen: "infrastructure",
    bundesstrassen: "infrastructure",
    bahnanlagen: "infrastructure",
    wohngrundstuecke: "residential",
    freibaeder: "residential",
  },
  CH: {
    // Nur die trennbaren CH-Layer. Drohnen-Einschränkungen, UAS-Aktivitätszonen
    // und SORA-Bodenrisiko bleiben über den CH-Gesamt-Schalter gebündelt.
    "ch.bazl.landschaftsruhezonen": "nature",
    "ch.bazl.wohngebiete-aulav": "residential",
  },
};

export function getLayerCategory(countryIso: string, wmsLayer: string): GeozoneCategoryId | null {
  const map = WMS_LAYER_CATEGORY[(countryIso || "").toUpperCase()];
  return map?.[wmsLayer] ?? null;
}

// Landeseigene Gesamt-Schalter für nicht trennbare Datensätze. `iso` ist das
// Land, dessen (nicht kategorisierte) Layer dieser Schalter steuert. `vector`
// markiert Länder ohne WMS (AT/BE/DK), die als native Vektor-Polygone gerendert
// werden — deren Sichtbarkeit steuert ebenfalls dieser Schalter.
export interface CombinedCountryToggleDef {
  id: string;
  label: string;
  iso: string;
  vector?: boolean;
  infoId?: string;
}

export const COMBINED_COUNTRY_TOGGLES: CombinedCountryToggleDef[] = [
  { id: "ch_combined", label: "Schweiz – Drohnenzonen (BAZL, gesamt)", iso: "CH", infoId: "ch_drohnen" },
  { id: "nl_combined", label: "Niederlande – Drohnenzonen (LVNL, gesamt)", iso: "NL", infoId: "nl_no_fly_zones" },
  { id: "lu_combined", label: "Luxemburg – Drohnenzonen (gesamt)", iso: "LU" },
  { id: "fr_combined", label: "Frankreich – Drohnenzonen (DGAC, gesamt)", iso: "FR", infoId: "fr_restrictions" },
  // Ungarn: reines Bild-Overlay (MyDroneSpace-WMTS), keine Zonenabfrage.
  { id: "hu_combined", label: "Ungarn – Lufträume & Drohnenzonen (MyDroneSpace, nur Karte)", iso: "HU" },
  { id: "at_geozones", label: "Österreich – Drohnenzonen (Austro Control)", iso: "AT", vector: true },
  { id: "be_geozones", label: "Belgien – Drohnenzonen (skeyes)", iso: "BE", vector: true },
  { id: "dk_geozones", label: "Dänemark – Drohnenzonen (Trafikstyrelsen)", iso: "DK", vector: true },
];

// Mapping iso -> kombinierter Gesamt-Schalter (nur WMS-Länder, deren nicht
// kategorisierte Layer gebündelt werden). Vektor-Länder (AT/BE/DK) haben keine
// WMS-Layer und werden separat über ihren Schalter gerendert.
const COMBINED_SWITCH_BY_ISO: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const t of COMBINED_COUNTRY_TOGGLES) {
    if (!t.vector) m[t.iso] = t.id;
  }
  return m;
})();

export function getCombinedSwitchId(countryIso: string): string | null {
  return COMBINED_SWITCH_BY_ISO[(countryIso || "").toUpperCase()] ?? null;
}

// Auswahlzustand: Schlüssel sind Kategorie-IDs UND landeseigene Gesamt-Schalter-
// IDs (sowie der unveränderte LFA-Schalter `de_lfa`).
export type GeozoneSelection = Record<string, boolean>;

// LFA-Tiefflug bleibt unverändert als eigener Schalter erhalten.
export const DE_LFA_TOGGLE_ID = "de_lfa";

export function defaultGeozoneSelection(): GeozoneSelection {
  const out: GeozoneSelection = {};
  for (const c of GEOZONE_CATEGORIES) out[c.id] = c.defaultEnabled;
  for (const t of COMBINED_COUNTRY_TOGGLES) out[t.id] = true;
  out[DE_LFA_TOGGLE_ID] = true;
  return out;
}

// Ergänzt fehlende Schlüssel mit den Defaults, ohne vorhandene (auch `false`)
// zu überschreiben.
export function mergeSelectionWithDefaults(sel: GeozoneSelection | null | undefined): GeozoneSelection {
  const defaults = defaultGeozoneSelection();
  const out: GeozoneSelection = { ...defaults };
  if (sel && typeof sel === "object") {
    for (const [k, v] of Object.entries(sel)) {
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

// Filtert eine Liste von WMS-Layer-Namen eines Landes auf die laut Auswahl
// aktiven Layer. Kategorisierte Layer folgen ihrer Kategorie, nicht
// kategorisierte Layer folgen dem kombinierten Länder-Gesamt-Schalter.
export function filterActiveWmsLayers(
  countryIso: string,
  wmsLayerNames: string[],
  sel: GeozoneSelection,
): string[] {
  const combinedId = getCombinedSwitchId(countryIso);
  return wmsLayerNames.filter((name) => {
    const cat = getLayerCategory(countryIso, name);
    if (cat) return !!sel[cat];
    if (combinedId) return !!sel[combinedId];
    // Nicht kategorisierter Layer in einem Land ohne Gesamt-Schalter: sollte
    // nicht vorkommen (Test stellt das sicher) — sicherheitshalber ausblenden.
    return false;
  });
}

// Einmalige Migration der alten, pro-Layer gespeicherten Auswahl auf die neuen
// Kategorie-/Gesamt-Schlüssel. `oldLayers` beschreibt die früher existierenden
// Layer beider Apps (id = alte Speicher-Schlüssel, iso + wmsLayer für die
// Kategorie-Auflösung). OR-Faltung: eine Kategorie ist aktiv, wenn IRGENDEIN
// ihr zugeordneter Alt-Layer aktiv war; sonst explizit aus.
export interface OldLayerRef {
  id: string;
  iso: string;
  wmsLayer: string;
}

export function migrateSelection(
  old: Record<string, boolean> | null | undefined,
  oldLayers: OldLayerRef[],
  passthroughIds: string[] = [DE_LFA_TOGGLE_ID, "at_geozones", "be_geozones", "dk_geozones"],
): GeozoneSelection {
  const src = old && typeof old === "object" ? old : {};
  const folded: GeozoneSelection = {};
  for (const l of oldLayers) {
    const key = getLayerCategory(l.iso, l.wmsLayer) ?? getCombinedSwitchId(l.iso);
    if (!key) continue;
    if (folded[key] === undefined) folded[key] = false;
    if (src[l.id] === true) folded[key] = true;
  }
  for (const id of passthroughIds) {
    if (typeof src[id] === "boolean") folded[id] = src[id];
  }
  return mergeSelectionWithDefaults(folded);
}
