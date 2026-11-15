// Quellen-Registry der Geozonen (B5) – React-Native-freier Kern.
//
// Eine Zeile je Länder-Quelle mit allen Eigenschaften, die GEMEINSAMER Code
// braucht (shared/, geozoneZoom, Länder-Erkennung, Prüfkette): Art der Quelle,
// Aliase (LI → CH-Datensatz), Aktualisierungs- und Offline-Strategie,
// Vektor-Mindestzoom, Zugangs-/Sonderfall-Flags sowie Anbieter/Lizenz für
// „Datenquellen & Lizenzen“. Alle Länderlisten (ED-269-Direktländer,
// eigene Karte, zugangsgebunden, Kachelspeicher, Vollland-Laden …) werden
// hieraus abgeleitet.
//
// Bewusst OHNE Importe: shared/*Geozones.ts und ed269Restriction.ts dürfen
// dieses Modul importieren, ohne dass ein Zyklus entsteht. Quellen-Label,
// Pflicht-Attributionen (aus den Normalisierern), WMS-Konfiguration und
// Abruf-Funktion ergänzt die Client-Registry
// (client/lib/geozoneSources/registry.ts).

/**
 * Art der Quelle:
 * - "ed269-vector": Vektor-Feed (ED-269/ED-318/GeoJSON/KML/WFS), im
 *   ED-269-Gerätecache gespeichert (geozoneDirect/ed269Store.ts)
 * - "tiled": großer Bestand im Offline-Kachelspeicher (geozoneTiles/, DE/FR/CZ/ES)
 * - "wms": nur WMS-Abfrage (derzeit kein Land; DE/FR fallen ohne Paket darauf zurück)
 * - "xyz-raster": nur Bild-Overlay ohne Zonenabfrage (HU; GR zusätzlich mit Datei-Import)
 * - "import-only": kein erreichbarer Feed, nur Datei-Import (derzeit kein Land;
 *   MT seit 2026-11 online per DDP)
 * - "login": Vektor-Feed nur mit eigenem Zugang des Nutzers (IT d-flight)
 */
export type GeozoneSourceKind = "ed269-vector" | "tiled" | "wms" | "xyz-raster" | "import-only" | "login";

/** Wie liegen die Zonen offline vor? */
export type GeozoneOfflineStrategy = "ed269-store" | "tile-store" | "import" | "raster-tiles" | "none";

/** Zugangsbindung: ohne Zugang/Paket/Import gilt das Land als „ohne eigene Daten“. */
export type GeozoneAccessGate = "login" | "pack" | "import";

export interface GeozoneRefreshPolicy {
  /** Bestand gilt nach dieser Zeit als fällig und wird (online) erneuert; null = nie automatisch. */
  maxAgeMs: number | null;
  /**
   * Ab diesem Alter: Abdeckung „stale“ → Befund CAUTION mit Datenalter. Gilt
   * für die DAUERHAFTEN Zonen (Teil A: 28 Tage = AIRAC-Zyklus).
   */
  staleWarnAfterMs: number;
  /**
   * Temporäre Zonen (Teil A): online höchstens so alt (kurzer Cache), bevor
   * bei Bedarf (Planung/Pre-Check) neu geladen wird. Fehlt = keine temporären Zonen.
   */
  temporaryMaxAgeMs?: number;
  /**
   * Temporäre Zonen älter als dieser Wert → Abdeckung „partial“
   * („Temporäre Beschränkungen nicht aktuell“) → Befund unbekannt (≥ CAUTION).
   */
  temporaryStaleAfterMs?: number;
}

/**
 * Wo stecken die temporären Zonen einer Quelle (Teil A)?
 * - "dataset": im selben Landesbestand (ED-269-Gerätecache) – Alter = Bestand
 * - "separate": eigener Abruf mit eigenem Stand (DE: dipul-Ebene
 *   temporaere_betriebseinschraenkungen, tileStore temp.json)
 * - "none": Quelle veröffentlicht keine temporären Zonen bzw. sie lassen sich
 *   nicht aktualisieren (FR-Karte, CZ-ED-318-Paket, HU-/GR-Bild, GR-Import)
 */
export type GeozoneTemporarySource = "dataset" | "separate" | "none";

export interface GeozoneLicenceRef {
  license: string;
  licenseUrl?: string;
}

export interface GeozoneSourceMeta {
  /** ISO-3166-Alpha-2 (Großbuchstaben) des Datensatzes */
  iso: string;
  /** Weitere Länder, deren Zonen in diesem Datensatz stecken (LI → CH) */
  aliases?: string[];
  /** Deutscher Ländername */
  labelDe: string;
  kind: GeozoneSourceKind;
  /** null = keine gespeicherten Daten (nur Live-/Bild-Overlay) */
  refresh: GeozoneRefreshPolicy | null;
  /** Herkunft der temporären Zonen (Teil A); Standard aus `kind` (temporarySourceOf). */
  temporary?: GeozoneTemporarySource;
  /**
   * Großer Bestand (Teil A): Neuladen nur im WLAN, außer der Nutzer erlaubt
   * „Große Pakete auch über mobile Daten laden“. Kachelspeicher (DE/FR/CZ)
   * immer; ED-269-Länder mit sehr großem Feed (NL ≈ 23 MB) per Flag.
   */
  largeDataset?: boolean;
  offline: GeozoneOfflineStrategy;
  /** Vektor-Mindestzoom (sonst GEOZONE_VECTOR_MIN_ZOOM aus geozoneZoom.ts) */
  vectorMinZoom?: number;
  /** Gesamten Landesbestand statt bbox-Radius laden (kleine Datensätze) */
  loadsFullCountry?: boolean;
  /**
   * Kachelspeicher-Land, das OHNE Offline-Paket online direkt beim Anbieter je
   * Ausschnitt abfragt (ES: ArcGIS-bbox-Abfragen, Ergebnis je Standort
   * zwischengespeichert) – Karte zeichnet dann Vektorzonen statt nichts.
   */
  liveVectorQuery?: boolean;
  /** Zonen nur mit Zugang (IT), Offline-Paket (CZ) bzw. Import (GR) */
  accessGate?: GeozoneAccessGate;
  /** Hinweis, wenn der Zugang fehlt bzw. der Abruf daran scheitert */
  accessHint?: string;
  /** Keine automatische Zonenprüfung möglich (nur Bild-Overlay) → manuell prüfen */
  manualCheckOnly?: boolean;
  /**
   * Frequentis-AVM-Plattform: MATZ/MCTR mit Platzhalter-Enddatum
   * 2100-12-31 sind dauerhaft (normalizeAustrianEd269Placeholder beim Abruf).
   * Geprüft 2026-11-15: AT 5 Zonen betroffen; EE (utm.eans.ee) 0 von 233
   * Zonen; LT (utm.ans.lt) hinter Cloudflare nicht prüfbar – bleibt wie bisher
   * normalisiert (wirkt nur auf MATZ/MCTR mit genau diesem Muster).
   */
  frequentisPlaceholder?: boolean;
  /**
   * Frequentis-AVM-Feed (AT, EE, LT): beim Abruf `hidden`-Features (AT
   * sys_*) und weltumspannende PROHIBITED-Polygone (LT „Outside Lithuania“,
   * bbox > 90° Länge oder > 45° Breite) verwerfen – siehe
   * dropFrequentisSystemFeatures (client/lib/geozoneDirect/ed269Sources.ts).
   */
  frequentisAvm?: boolean;
  /** Zeitgesteuerte applicability-Einträge (permanent NO + Zeitfenster) zählen als NOTAM-artig */
  notamFromApplicability?: boolean;
  /** Live-Zonen (`_live`, nicht permanent) zählen als NOTAM-artig (BE skeyes) */
  notamFromLiveFlag?: boolean;
  /** Gebündelte Basisdaten als Rückfall ohne Netz und ohne Gerätebestand (BE) */
  bundledFallback?: boolean;
  /**
   * Temporäre Zonen (< 30 Tage) dieses Gerätecache-Landes zusätzlich in der
   * NOTAM-Liste (NotamsScreen); Wert = Reihenfolge der Länder dort.
   */
  notamListOrder?: number;

  // --- Datenquellen & Lizenzen -------------------------------------------
  /** Anbieter / Behörde */
  provider: string;
  /** Verwendung (Standard: ED-269-Vektordaten) */
  usage?: string;
  license?: string;
  licenseUrl?: string;
  /** Nutzung mit schriftlicher Genehmigung/Freigabe des Anbieters */
  writtenPermission: boolean;
  /** Webseite des Anbieters */
  url?: string;
  note?: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * ED-269-Gerätecache (Teil A): kleine Landesbestände online nach 6 h neu laden
 * (günstig, stale-while-revalidate). Früher 24 h.
 */
export const ED269_STORE_REFRESH_MS = 6 * HOUR;
/** Offline-Kachelspeicher: AIRAC-Zyklus. */
export const TILE_STORE_REFRESH_MS = 28 * DAY;
/** Dauerhafte Zonen ändern sich mit AIRAC: Warnung erst nach 28 Tagen (Teil A, früher 24 h). */
export const PERMANENT_ZONES_STALE_MS = 28 * DAY;
/** Temporäre Zonen: online kurzer Cache (≤ 10 min). */
export const TEMPORARY_ZONES_MAX_AGE_MS = 10 * 60 * 1000;
/** Temporäre Zonen älter als 24 h → „Temporäre Beschränkungen nicht aktuell“. */
export const TEMPORARY_ZONES_STALE_MS = 24 * HOUR;

const TEMP_POLICY = { temporaryMaxAgeMs: TEMPORARY_ZONES_MAX_AGE_MS, temporaryStaleAfterMs: TEMPORARY_ZONES_STALE_MS } as const;
const ED269_POLICY: GeozoneRefreshPolicy = { maxAgeMs: ED269_STORE_REFRESH_MS, staleWarnAfterMs: PERMANENT_ZONES_STALE_MS, ...TEMP_POLICY };
const TILE_POLICY: GeozoneRefreshPolicy = { maxAgeMs: TILE_STORE_REFRESH_MS, staleWarnAfterMs: TILE_STORE_REFRESH_MS };
// DE/ES: Kachelspeicher + eigener Abruf der temporären Zonen (dipul-Ebene bzw. ENAIRE-NOTAM).
const TILE_POLICY_DE: GeozoneRefreshPolicy = { ...TILE_POLICY, ...TEMP_POLICY };
// Import: kein automatischer Abruf; Altersschwelle wie beim ED-269-Gerätecache.
// Importe (GR) lassen sich nicht online aktualisieren, nur neu importieren.
// Warnung erst nach einem AIRAC-Zyklus (28 Tage), nicht schon nach 24 h.
const IMPORT_POLICY: GeozoneRefreshPolicy = { maxAgeMs: null, staleWarnAfterMs: TILE_STORE_REFRESH_MS };

/** Gemeinsame Lizenzen (auch von client/lib/dataSources.ts genutzt). */
export const GEOZONE_LICENCES = {
  ccBy4: { license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/deed.de" },
  ccByNd4: { license: "CC BY-ND 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nd/4.0/legalcode.de" },
  cc0: { license: "CC0 1.0 (Public Domain)", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/deed.de" },
  etalab2: { license: "Licence Ouverte / Open Licence 2.0 (Etalab)", licenseUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/" },
  nlod2: { license: "Norsk lisens for offentlige data (NLOD) 2.0", licenseUrl: "https://data.norge.no/nlod/no/2.0" },
  swissOgd: { license: "Open Government Data (Opendata BY)", licenseUrl: "https://opendata.swiss/de/terms-of-use" },
} as const satisfies Record<string, GeozoneLicenceRef>;

const L = GEOZONE_LICENCES;

// Vektor-Länder mit ED-269-Gerätecache (Standardwerte).
const vector = {
  kind: "ed269-vector",
  refresh: ED269_POLICY,
  offline: "ed269-store",
} as const;

/**
 * Alle Geozonen-Quellen. Reihenfolge = Reihenfolge von
 * COUNTRY_GEOZONE_CONFIGS (client/lib/geozones.ts).
 *
 * Neues Land: hier eine Zeile, in client/lib/geozoneSources/registry.ts Label/
 * Attribution (und ggf. WMS-Konfiguration) und in
 * client/lib/geozoneDirect/ed269Sources.ts die Abruf-Funktion
 * (ED269_FETCHERS) – siehe docs/pruefung-umbau-plan.md „Stand B5“.
 */
export const GEOZONE_SOURCE_META: readonly GeozoneSourceMeta[] = [
  {
    iso: "DE",
    labelDe: "Deutschland",
    kind: "tiled",
    refresh: TILE_POLICY_DE,
    offline: "tile-store",
    temporary: "separate",
    // sehr dichter Bestand (≈ 83 000 Zonen) – Vektor-Zeichnung erst ab z10
    vectorMinZoom: 10,
    provider:
      "DFS Deutsche Flugsicherung / Bundesministerium für Verkehr – dipul (Digitale Plattform Unbemannte Luftfahrt)",
    usage:
      "Geografische Gebiete (WMS-Karte, Vektordaten, offline speicherbar), temporäre Betriebseinschränkungen, militärische Tiefflug-Bezüge.",
    ...L.ccByNd4,
    writtenPermission: false,
    url: "https://www.dipul.de",
    note: "Geometrien werden unverändert gespeichert und angezeigt (keine Bearbeitung, CC BY-ND).",
  },
  {
    // BAZL-ED-269-Datei (offline nutzbar); WMS/REST nur noch für Zusatz-Ebenen.
    iso: "CH",
    aliases: ["LI"], // Liechtenstein steckt im BAZL-Datensatz
    labelDe: "Schweiz",
    ...vector,
    provider: "Bundesamt für Zivilluftfahrt (BAZL) / swisstopo – geo.admin.ch",
    usage:
      "Drohnen-Einschränkungen als Vektordaten (Schweiz und Liechtenstein) sowie Zusatz-Ebenen (Landschaftsruhezonen u. a.).",
    ...L.swissOgd,
    writtenPermission: false,
    url: "https://map.geo.admin.ch",
  },
  {
    // Zonen als Vektoren (ED-269 CC0, sonst OGC-Features); WMS-Ebenen abschaltbar.
    iso: "LU",
    labelDe: "Luxemburg",
    ...vector,
    provider: "Direction de l'Aviation Civile (DAC) / Geoportail Luxembourg",
    usage:
      "Drohnen-Geozonen als Vektordaten: OGC-Features des Geoportails (Höhenschichten 1927/1928) als Hauptquelle; der ED-269-Feed (zeitweise HTTP 422) wird höchstens einmal täglich geprüft bzw. als Rückfall genutzt.",
    ...L.cc0,
    writtenPermission: true,
    url: "https://drones.geoportail.lu",
  },
  {
    // GoDrone-Vektorzonen (ED-269-Pfad); WMS nur noch für Natur-Ebenen.
    iso: "NL",
    labelDe: "Niederlande",
    ...vector,
    // GoDrone-Feed ≈ 23 MB JSON: wie ein großes Paket nur im WLAN neu laden.
    largeDataset: true,
    provider: "Luchtverkeersleiding Nederland (LVNL) / Altitude Angel – GoDrone",
    writtenPermission: true,
    url: "https://map.godrone.nl",
  },
  {
    iso: "FR",
    labelDe: "Frankreich",
    kind: "tiled",
    refresh: TILE_POLICY,
    offline: "tile-store",
    vectorMinZoom: 10,
    provider: "IGN / Direction générale de l'Aviation civile (DGAC) – Géoplateforme",
    usage: "Drohnen-Beschränkungen (WMS-Karte und Vektordaten, offline speicherbar).",
    ...L.etalab2,
    writtenPermission: false,
    // url: TILE_STORE_ATTRIBUTION.FR.url – ergänzt die Client-Registry
  },
  {
    // HungaroControl / MyDroneSpace: nur Bild-Overlay (WMTS), Vektor-API mit Login.
    iso: "HU",
    labelDe: "Ungarn",
    kind: "xyz-raster",
    refresh: null,
    offline: "raster-tiles",
    manualCheckOnly: true,
    provider: "HungaroControl – MyDroneSpace",
    usage: "Lufträume und Drohnenzonen als Bild-Overlay (WMTS); keine automatische Zonenprüfung.",
    writtenPermission: true,
    url: "https://app.mydronespace.hu",
  },
  {
    // Austro Control / Dronespace (Frequentis-AVM): ~291 Zonen, ganzes Land laden.
    // authorityRequirementConditions (z. B. „EXCLUDED/LOS=VLOS/
    // ALTITUDE_AGL_MAX=30/MTOM_G_MAX=249“, live 12 Zonen) erscheinen nur als
    // Infotext (shared/ed269SourceInfo.ts), nie als Freigabe.
    iso: "AT",
    labelDe: "Österreich",
    ...vector,
    vectorMinZoom: 7, // = GEOZONE_TILE_MIN_ZOOM
    loadsFullCountry: true,
    frequentisPlaceholder: true,
    frequentisAvm: true,
    notamFromApplicability: true,
    notamListOrder: 2,
    provider: "Austro Control – Dronespace",
    writtenPermission: true,
    url: "https://www.dronespace.at",
  },
  {
    // skeyes / BCAA Droneguide: Bundle + WFS + Live-API, ~288 Zonen.
    iso: "BE",
    labelDe: "Belgien",
    ...vector,
    vectorMinZoom: 7, // = GEOZONE_TILE_MIN_ZOOM
    loadsFullCountry: true,
    notamFromLiveFlag: true,
    bundledFallback: true,
    notamListOrder: 1,
    provider: "skeyes / Belgian Civil Aviation Authority – Droneguide",
    writtenPermission: true,
    url: "https://map.droneguide.be",
  },
  {
    // Trafikstyrelsen: dicht (~1700 Zonen) – bewusst KEIN früherer Mindestzoom.
    iso: "DK",
    labelDe: "Dänemark",
    ...vector,
    notamListOrder: 3,
    provider: "Trafikstyrelsen (Dänische Verkehrsbehörde) – dronezoner.dk",
    usage:
      "Drohnenzonen (Tagesexport), Naturschutzzonen sowie live von dronezoner.eu: NOTAM-Ebenen (aktiv/Achtung/angekündigt/gelbe Restriktionsgebiete) und An-/Abflugflächen; Dienstnamen aus der Web Map.",
    note: "Öffentliche Feature-Services ohne Token – Zugangsdaten aus der Seitenkonfiguration der Karte werden nie verwendet.",
    license:
      "Freie Nutzung mit Quellenangabe („Data kan frit anvendes med kildeangivelse“), per E-Mail bestätigt",
    writtenPermission: true,
    url: "https://www.droneregler.dk",
  },
  {
    // EANS / Transpordiamet (Frequentis-AVM wie AT), eigener Normalisierer.
    iso: "EE",
    labelDe: "Estland",
    ...vector,
    frequentisAvm: true,
    provider: "EANS (Lennuliiklusteeninduse AS) / Transpordiamet",
    license: "Öffentliche Daten; Freigabe von EANS mündlich erteilt, schriftliche Bestätigung ausstehend",
    writtenPermission: false,
    url: "https://utm.eans.ee",
  },
  {
    iso: "IE",
    labelDe: "Irland",
    ...vector,
    provider: "Irish Aviation Authority (IAA) / AirNav Ireland",
    writtenPermission: true,
    url: "https://www.iaa.ie",
  },
  {
    iso: "SE",
    labelDe: "Schweden",
    ...vector,
    provider: "LFV Drönarkartan / Transportstyrelsen",
    note: "ED-318-Datei von dronechart.lfv.se (Rückfall daim.lfv.se); der Datenstand (issued) steht in der Quellenzeile jeder Zone.",
    ...L.ccBy4,
    writtenPermission: false,
    url: "https://dronechart.lfv.se",
  },
  {
    iso: "PT",
    labelDe: "Portugal",
    ...vector,
    provider: "ANAC – Autoridade Nacional da Aviação Civil",
    writtenPermission: true,
    url: "https://www.anac.pt",
  },
  {
    // ENAIRE insignias-MapServer (live verifiziert von DE-IP, 2026-11-15):
    // ≈ 21 000 Zonen, Infra ≈ 177 MB, ENP ≈ 221 MB → Kachelspeicher mit Teilen
    // base (Luftfahrt + Urbano), infra, enp; NOTAM live (eigener Abruf).
    // Ohne Paket: online bbox-Abfragen je Ausschnitt (liveVectorQuery).
    iso: "ES",
    labelDe: "Spanien",
    kind: "tiled",
    refresh: TILE_POLICY_DE,
    offline: "tile-store",
    temporary: "separate",
    vectorMinZoom: 10,
    liveVectorQuery: true,
    provider: "ENAIRE – Drones (insignias-MapServer)",
    usage:
      "Drohnen-Geozonen (Luftfahrt, urbane Zonen, Infrastruktur, Naturschutz) als Vektordaten – offline als Paket mit abwählbaren Teilen, online je Ausschnitt; NOTAM für UAS live.",
    license: "Nutzung laut schriftlicher Freigabe von ENAIRE; Rechtehinweis „© ENAIRE – AIS“ Pflicht",
    writtenPermission: true,
    url: "https://drones.enaire.es",
    note: "Volle Geometrie-Genauigkeit (keine Vereinfachung). Infrastruktur- und Naturschutz-Teil sind sehr groß (je über 100 MB Download).",
  },
  {
    iso: "PL",
    labelDe: "Polen",
    ...vector,
    provider: "Polska Agencja Żeglugi Powietrznej (PAŻP / PANSA) – DroneMap",
    usage:
      "Alle Zonen und Lufträume (JSON /v1/zones inkl. TRA/TSA/MRT, RPA-Sektoren, CTR/ATZ, P/R/D) mit Aktivierungen (AUP/UUP, Timeslices) und NOTAMs; KML der Drohnenzonen als Rückfall.",
    license:
      "Schriftliche Freigabe von PAŻP/PANSA, vom Product Owner bestätigt (2026-11-15), für den dokumentierten Umfang: statische Zonen über /v1/zones und KML, Zonentypen (/v1/zones/types), Aktivierungen und NOTAM-Endpunkte wie dokumentiert",
    writtenPermission: true,
    url: "https://dronemap.pansa.pl",
  },
  {
    // Oro navigacija: Frequentis-AVM wie AT.
    iso: "LT",
    labelDe: "Litauen",
    ...vector,
    frequentisPlaceholder: true,
    frequentisAvm: true,
    provider: "Oro navigacija (Lithuanian ANS)",
    writtenPermission: true,
    url: "https://utm.ans.lt",
  },
  {
    // Primär NATS-Digitaldatensatz (AIXM 5.1, je AIRAC-Zyklus eine Datei),
    // Rückfall Google-My-Maps-KML der NATS-Karte (client/lib/geozoneDirect/ukSource.ts).
    // Aktualisierung: alle 6 h eine günstige Prüfung – gleicher AIRAC-Stand →
    // If-Modified-Since (304, kein Download); neuer Zyklus ab Effective Date →
    // voller Download (≈ 0,5 MB). Keine temporären Zonen (NOTAM/AIP SUP sind
    // nicht im Datensatz) → kein 10-min-Neuladen bei Prüfungen.
    iso: "GB",
    labelDe: "Vereinigtes Königreich",
    ...vector,
    temporary: "none",
    provider: "NATS (UK AIS) / UK Civil Aviation Authority – UK AIP ENR 5.1, Digitaldatensatz „UK UAS Flight Restrictions“ (AIXM 5.1)",
    usage:
      "Drohnen-Geozonen (Prohibited/Restricted/Danger Areas inkl. Flugplatz-FRZ/RPZ) als Vektordaten je AIRAC-Zyklus; Rückfall: NATS-Karte (Google My Maps, KML).",
    license:
      "© NATS Limited – Datensatz-Bedingungen: „For aviation use only“, Zugang/Nutzung „Unrestricted“, „Not for resale“; Nutzungsbedingungen von NATS / UK CAA",
    writtenPermission: false,
    url: "https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/",
    note: "NOTAMs und AIP-Ergänzungen (SUP) sind nicht enthalten – vor dem Flug separat prüfen.",
  },
  {
    // d-flight: GeoServer-WFS (ATM09_INFO, NO_FLY_ZONE, NOTAM) nur mit eigenem
    // Zugang (Zugangsdaten verschlüsselt auf dem Gerät); ED-269-Download nur
    // als optionaler erster Versuch (für Rolle USER gesperrt).
    iso: "IT",
    labelDe: "Italien",
    kind: "login",
    refresh: ED269_POLICY,
    offline: "ed269-store",
    accessGate: "login",
    accessHint: "d-flight-Zugang fehlt oder Anmeldung fehlgeschlagen",
    provider: "d-flight S.p.A. (Gruppo ENAV)",
    usage:
      "UAS-Geozonen (ENAC ATM-09), temporäre Flugverbotszonen und drohnenrelevante NOTAMs per GeoServer-WFS – Abruf auf dem Gerät mit dem eigenen d-flight-Konto des Nutzers.",
    license:
      "Schriftliche Freigabe von d-flight, vom Product Owner bestätigt (2026-11-15), für den dokumentierten Umfang: Jeder Nutzer verwendet sein eigenes d-flight-Konto zum persönlichen Gebrauch; die Daten werden nicht weitergegeben",
    writtenPermission: true,
    url: "https://www.d-flight.it",
    note: "Abruf nur mit eigenem d-flight-Zugang des Nutzers (persönlicher Gebrauch, keine Weitergabe der Daten).",
  },
  {
    iso: "IS",
    labelDe: "Island",
    ...vector,
    provider: "Samgöngustofa / ISAVIA / gis.is",
    usage:
      "Drohnenzonen der offiziellen Karte (gis.natt.is, dronemap_ice_geom) ergänzt um weitere Zonen aus dronemap_isl_geom (ohne Doppelungen) sowie temporäre Sperrungen.",
    writtenPermission: true,
    url: "https://gis.is",
  },
  {
    iso: "CY",
    labelDe: "Zypern",
    ...vector,
    provider: "Department of Civil Aviation, Cyprus (DCA / AMC Cyprus)",
    writtenPermission: true,
    url: "https://drones.gov.cy",
  },
  {
    iso: "HR",
    labelDe: "Kroatien",
    ...vector,
    provider: "Hrvatska kontrola zračne plovidbe (Croatia Control) – AMC-Portal",
    writtenPermission: true,
    url: "https://amc.crocontrol.hr",
  },
  {
    iso: "SI",
    labelDe: "Slowenien",
    ...vector,
    provider: "Javna agencija za civilno letalstvo RS (CAA Slovenia) / Slovenia Control",
    usage:
      "UAS-Geozonen der offiziellen Karte „UAS GEO ZONES“ – Ebenen werden bei jedem Abruf aus der Web Map gelesen; fehlt eine Ebene, gilt die Abdeckung als unvollständig. Bebaute Gebiete (Pozidano) nicht enthalten.",
    writtenPermission: true,
    url: "https://www.caa.si",
  },
  {
    iso: "BG",
    labelDe: "Bulgarien",
    ...vector,
    provider: "ГД „Гражданска въздухоплавателна администрация“ (CAA Bulgaria)",
    writtenPermission: true,
    url: "https://uas.caa.bg",
  },
  {
    iso: "LV",
    labelDe: "Lettland",
    ...vector,
    provider: "LGS (Latvijas gaisa satiksme) / AIS Latvia",
    writtenPermission: true,
    url: "https://www.airspace.lv",
  },
  {
    iso: "SK",
    labelDe: "Slowakei",
    ...vector,
    provider:
      "Dopravný úrad SR (Drohnenzonen „Zemepisné oblasti UAS“) / Letové prevádzkové služby SR (Lufträume)",
    usage:
      "Drohnen-Geozonen (Dopravný úrad, KML) und drohnenrelevante Lufträume (LPS SR, VFR Manual) inkl. Live-Reservierungen: R/TRA/TSA nur in Reservierungsfenstern aktiv (Höhen der Reservierung).",
    license: "Attribution „VFR Manual, LPS SR, š. p.“ (LPS-Daten) bzw. „© Dopravný úrad SR“",
    writtenPermission: true,
    url: "https://letectvo.nsat.sk/bezpilotne-letectvo/zemepisne-oblasti-uas/",
  },
  {
    // ROMATSA: öffentlicher statischer Zonensatz + NOTAM-UAV-WFS (live
    // verifiziert von DE-IP, 2026-11-15). Datei-Import bleibt als Rückfall,
    // falls die Fernsteuerung den Server nicht erreicht (früher: TLS-DH).
    iso: "RO",
    labelDe: "Rumänien",
    ...vector,
    provider: "ROMATSA (Romanian Air Traffic Services Administration) – flightplan.romatsa.ro",
    usage:
      "Drohnen-Geozonen (statischer Zonensatz) und NOTAM-UAV (temporäre Zonen) als Vektordaten; Datei-Import als Rückfall, wenn der ROMATSA-Server nicht erreichbar ist.",
    license: "Öffentliche Daten von ROMATSA, Nutzung laut Freigabe",
    writtenPermission: true,
    // url: RO_ROMATSA_DRONES_URL (shared/romanianGeozones.ts) – ergänzt die Client-Registry
  },
  {
    iso: "FI",
    labelDe: "Finnland",
    ...vector,
    provider: "Liikenne- ja viestintävirasto Traficom",
    ...L.ccBy4,
    writtenPermission: false,
    url: "https://www.traficom.fi",
  },
  {
    iso: "NO",
    labelDe: "Norwegen",
    ...vector,
    provider: "Luftfartstilsynet – dronesoner.no",
    usage:
      "ED-269-Tagesdatei plus in ED-269 fehlende Ebenen aus dronesoner.no/data/ (NOTAM-Verbote, NOTAM-/Echtzeit-Gefahrengebiete, gemeldete Drohnenflüge, per NOTAM aktivierbare R-Gebiete, CTR/TIZ, RMZ/TMZ).",
    ...L.nlod2,
    writtenPermission: false,
    url: "https://dronesoner.no",
    note: "Botschafts-Zonen stammen aus OpenStreetMap: © OpenStreetMap contributors (ODbL).",
  },
  {
    // ŘLP ČR: ED-318-Kacheln nur über das Geozonen-Paket (ZIP ≈ 36 MB). Es
    // wird bei aktivem Land (online UND offline) automatisch geladen; bis
    // dahin „manuell prüfen“ (accessGate "pack").
    iso: "CZ",
    labelDe: "Tschechien",
    kind: "tiled",
    refresh: TILE_POLICY,
    offline: "tile-store",
    vectorMinZoom: 10,
    accessGate: "pack",
    accessHint: "Geozonen-Paket noch nicht geladen",
    provider: "Řízení letového provozu ČR (ŘLP ČR / ANS CR)",
    usage: "Drohnen-Geozonen (ED-318) als Offline-Kachelspeicher.",
    writtenPermission: true,
    // url: TILE_STORE_ATTRIBUTION.CZ.url – ergänzt die Client-Registry
  },
  {
    // Transport Malta / iDronect: online per Meteor-DDP
    // Zones.getFilteredZones({managedZones:true}) (geozoneDirect/maltaSource.ts,
    // Doku §6a). Datei-Import des Browser-Exports (docs/tools/malta/) bleibt
    // Rückfall wie bei RO (ein erfolgreicher Online-Abruf ersetzt ihn).
    iso: "MT",
    labelDe: "Malta",
    ...vector,
    loadsFullCountry: true, // 195 Zonen, ~400 KB
    // Die iDronect-Zonen tragen keine Zeitfenster (keine NOTAM-/Temporär-Ebene).
    temporary: "none",
    provider: "Transport Malta – Civil Aviation Directorate (TMCAD) / iDronect",
    usage:
      "Drohnen-Geozonen der öffentlichen Karte tmcad.idronect.com, automatisch per DDP (WebSocket) geladen; Datei-Import des Browser-Exports als Rückfall.",
    license:
      "Öffentlich angezeigte Daten; automatisierter Abruf laut Freigabe von Transport Malta (vom Product Owner bestätigt, 2026-11-15)",
    writtenPermission: true,
    url: "https://tmcad.idronect.com/map",
    note:
      "Zonennamen enthalten Kontakt-E-Mails der zuständigen Stellen; sie werden dem Piloten für Genehmigungsanfragen angezeigt. Höhenwert der Quelle (maxHeight) ist die Luftraumdecke (vermutlich ft), kein Drohnenlimit.",
  },
  {
    // HASP/HCAA (DAGR): nur WMS-Raster (Bild); Host blockt Nicht-Browser-
    // Clients. Vektorzonen nur per Datei-Import (docs/tools/greece/dagr_geozonen.py).
    iso: "GR",
    labelDe: "Griechenland",
    kind: "xyz-raster",
    refresh: IMPORT_POLICY,
    offline: "import",
    accessGate: "import",
    accessHint: "Geozonen-Datei nicht importiert – Karte zeigt die Zonen nur als Bild",
    manualCheckOnly: true,
    provider: "Hellenic Air Navigation Service Provider (HASP) / HCAA – DAGR",
    usage:
      "Drohnenzonen als Bild-Overlay (WMS, zeitgefiltert); keine automatische Zonenprüfung. Optional Vektorzonen per Datei-Import (am PC mit dagr_geozonen.py erzeugt).",
    license: "CC BY-NC-ND 4.0 – Nutzung nur im Rahmen der erteilten Datenfreigabe von HASP/HCAA",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.de",
    writtenPermission: true,
    url: "https://dagr.hasp.gov.gr",
    note: "Der Server blockt Nicht-Browser-Clients; ob die Bildkacheln in der App laden, auf dem Gerät prüfen.",
  },
];

// ---------------------------------------------------------------------------
// Nachschlagen
// ---------------------------------------------------------------------------

const BY_ISO = new Map<string, GeozoneSourceMeta>();
const ALIAS_OF = new Map<string, string>();
for (const m of GEOZONE_SOURCE_META) {
  BY_ISO.set(m.iso, m);
  for (const a of m.aliases ?? []) ALIAS_OF.set(a, m.iso);
}

/** ISO des Datensatzes (Alias → Hauptland, z. B. LI → CH), Großbuchstaben. */
export function resolveGeozoneSourceIso(iso: string | null | undefined): string {
  const up = String(iso || "").toUpperCase();
  return ALIAS_OF.get(up) ?? up;
}

/** Quelle eines Landes (Aliase aufgelöst) oder null. */
export function getGeozoneSourceMeta(iso: string | null | undefined): GeozoneSourceMeta | null {
  return BY_ISO.get(resolveGeozoneSourceIso(iso)) ?? null;
}

/** Quelle genau dieses ISO-Codes (ohne Alias-Auflösung) oder null. */
export function getOwnGeozoneSourceMeta(iso: string | null | undefined): GeozoneSourceMeta | null {
  return BY_ISO.get(String(iso || "").toUpperCase()) ?? null;
}

const isos = (pred: (m: GeozoneSourceMeta) => boolean): string[] =>
  GEOZONE_SOURCE_META.filter(pred).map((m) => m.iso);

const withAliases = (list: string[]): string[] =>
  list.flatMap((iso) => [iso, ...(BY_ISO.get(iso)?.aliases ?? [])]);

/** Alle Quellen-Länder (ohne Aliase), in Registry-Reihenfolge. */
export const GEOZONE_SOURCE_ISOS: string[] = isos(() => true);

/** Länder mit Vektor-Feed (ED-269-Gerätecache, automatischer Abruf; IT nur mit Zugang). */
export const ED269_FETCH_ISOS: string[] = isos((m) => m.kind === "ed269-vector" || m.kind === "login");

/** Länder im ED-269-Gerätecache (Abruf oder Datei-Import). */
export const ED269_STORE_ISOS: string[] = isos((m) => m.offline === "ed269-store" || m.offline === "import");

/** ED-269-Gerätecache-Länder inkl. Aliase (Quellen-Labels, Höhenfilter). */
export const ED269_STORE_ISOS_WITH_ALIASES: string[] = withAliases(ED269_STORE_ISOS);

/**
 * Bestand nur per Datei-Import (kein erreichbarer Vektor-Feed): GR
 * (Bild-Overlay mit optionalem Import). MT ist seit 2026-11 ein Vektor-Feed
 * (DDP), sein Datei-Import ist nur Rückfall.
 */
export const GEOZONE_IMPORT_ONLY_SOURCE_ISOS: string[] = isos((m) => m.offline === "import");

/** Offline-Kachelspeicher (DE/FR/CZ). */
export const TILE_STORE_SOURCE_ISOS: string[] = isos((m) => m.offline === "tile-store");

/**
 * Länder mit EIGENEN, automatisch prüfbaren Geozonen-Daten (eigene Karte mit
 * Overlay). Reine Bild-Overlays (HU) zählen nicht; Aliase (LI) auch nicht.
 * Bild-Overlays mit Import (GR) zählen – zugangsgebunden – erst mit Import.
 */
export const OWN_MAP_SOURCE_ISOS: string[] = isos((m) => !m.manualCheckOnly || m.accessGate === "import");

/** Zugangsgebundene Länder (IT Login, CZ Offline-Paket, GR Import). */
export const ACCESS_GATED_SOURCE_ISOS: string[] = isos((m) => !!m.accessGate);

/** Pro-Land-Override des Vektor-Mindestzooms. */
export const VECTOR_MIN_ZOOM_BY_ISO: Record<string, number> = Object.fromEntries(
  GEOZONE_SOURCE_META.filter((m) => m.vectorMinZoom != null).map((m) => [m.iso, m.vectorMinZoom as number]),
);

/** Länder, deren temporäre Gerätecache-Zonen in der NOTAM-Liste erscheinen (in Listen-Reihenfolge). */
export const NOTAM_LIST_SOURCE_ISOS: string[] = GEOZONE_SOURCE_META
  .filter((m) => m.notamListOrder != null)
  .sort((a, b) => (a.notamListOrder as number) - (b.notamListOrder as number))
  .map((m) => m.iso);

/** Länder, deren gesamter Landesbestand beim Herauszoomen geladen wird. */
export const FULL_COUNTRY_VECTOR_ISOS: string[] = isos((m) => !!m.loadsFullCountry);

/**
 * Vektorzonen (ED-269-Gerätecache, inkl. Aliase), die nach Höhe gefiltert
 * werden dürfen. Nur-Import-Länder zählen erst mit gespeichertem Bestand
 * (`hasOwnMap`).
 */
export function isEd269VectorIso(iso: string | null | undefined, hasOwnMap: (iso: string) => boolean): boolean {
  const up = String(iso || "").toUpperCase();
  if (!ED269_STORE_ISOS_WITH_ALIASES.includes(up)) return false;
  const m = getGeozoneSourceMeta(up);
  return m?.accessGate === "import" ? hasOwnMap(up) : true;
}

/** Aktualisierungs-Policy eines Landes (Aliase aufgelöst) oder null. */
export function geozoneRefreshPolicy(iso: string | null | undefined): GeozoneRefreshPolicy | null {
  return getGeozoneSourceMeta(iso)?.refresh ?? null;
}

/**
 * Ist ein Bestand mit diesem Zeitstempel laut Policy veraltet? Unbekannter
 * Zeitstempel (0/null, z. B. gebündelte BE-Basisdaten) gilt als veraltet,
 * sofern das Land gespeicherte Daten hat.
 */
export function isSourceDataStale(
  iso: string | null | undefined,
  fetchedAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  const policy = geozoneRefreshPolicy(iso);
  if (!policy) return false;
  return now - (fetchedAt || 0) > policy.staleWarnAfterMs;
}

// ---------------------------------------------------------------------------
// Teil A: dauerhafte vs. temporäre Zonen, große Pakete
// ---------------------------------------------------------------------------

/**
 * Herkunft der temporären Zonen einer Quelle. Standard: Vektor-Feeds
 * ("ed269-vector"/"login") liefern sie im Landesbestand mit; Kachelspeicher,
 * Bild-Overlay und Import haben keine aktualisierbaren temporären Zonen.
 */
export function temporarySourceOf(iso: string | null | undefined): GeozoneTemporarySource {
  const m = getGeozoneSourceMeta(iso);
  if (!m) return "none";
  if (m.temporary) return m.temporary;
  return m.kind === "ed269-vector" || m.kind === "login" ? "dataset" : "none";
}

/** Großer Bestand (Kachelspeicher oder Flag) → Neuladen nur im WLAN bzw. mit Erlaubnis. */
export function isLargeGeozoneDataset(iso: string | null | undefined): boolean {
  const m = getGeozoneSourceMeta(iso);
  return !!m && (m.offline === "tile-store" || m.largeDataset === true);
}

/** Sind die temporären Zonen (Stand `fetchedAt`) laut Policy nicht mehr aktuell? */
export function isTemporaryDataStale(
  iso: string | null | undefined,
  fetchedAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (temporarySourceOf(iso) === "none") return false;
  const ms = geozoneRefreshPolicy(iso)?.temporaryStaleAfterMs ?? TEMPORARY_ZONES_STALE_MS;
  return now - (fetchedAt || 0) > ms;
}

/** Hinweis bei veralteten temporären Zonen (Abdeckung „partial“). */
export const TEMPORARY_ZONES_STALE_NOTE = "Temporäre Beschränkungen nicht aktuell";
