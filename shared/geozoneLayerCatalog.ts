// Geteilter, React-Native-freier Geozonen-Layer-Katalog.
//
// Dieses Modul ist bewusst frei von React-Native-Importen (kein AsyncStorage
// o. Ä.), damit es sowohl von der Expo-App (client/lib/geozones.ts) als auch
// vom tsx-Test-Runner importiert werden kann. Es ist die EINZIGE Quelle der
// pro-Land/pro-Layer-Definitionen (id/wmsLayer/Label/Defaults/Overrides) der
// nativen App. `client/lib/geozones.ts` baut COUNTRY_GEOZONE_CONFIGS aus diesen
// Arrays und re-exportiert sie, damit bestehende Importe stabil bleiben.
//
// Folge: Wird hier ein neuer nativer Layer ergänzt, fließt er automatisch in
// den Migrationstest (web/src/lib/__tests__/geozoneMigration.test.ts) ein, der
// seine Alt-Layer-Referenzen über getNativeLegacyLayerRefs() aus genau diesem
// Katalog ableitet — der Migrations-Sicherheitsnetz-Test kann nicht mehr
// stillschweigend veralten.

import type { OldLayerRef } from "./geozoneCategories";

export interface GeozoneLayer {
  id: string;
  wmsLayer: string;
  label: string;
  defaultEnabled: boolean;
  // Optional pro-Layer-Override für WMS-Basis-URL/-Version. Wird genutzt,
  // wenn ein Layer NICHT vom Standard-WMS des Landes kommt (z. B. NL
  // Natura 2000 liegt auf einem anderen PDOK-Endpoint als die LVNL
  // Drohnen-Sperrzonen). Tile-URL-Builder gruppieren Layer pro Endpoint.
  wmsBaseUrl?: string;
  wmsVersion?: string;
  // Optional pro-Layer WMS-Stil. Entweder ein benannter Server-Style
  // (`wmsStyle`) oder ein vollständiger Inline-SLD (`wmsSldBody`). Wird
  // genutzt, um z. B. NL-Natura-2000/NNN im Godrone-Gelb statt im
  // PDOK-Default-Oliv zu rendern. Layer mit eigenem Style werden im
  // Tile-Builder separat gruppiert, damit STYLES/SLD_BODY pro Request
  // sauber zugeordnet bleibt.
  wmsStyle?: string;
  wmsSldBody?: string;
  // Optional: fertige XYZ-Kachel-Vorlage ({z}/{x}/{y}, Web-Mercator,
  // GoogleMapsCompatible) statt eines WMS-GetMap. Ist sie gesetzt, liefern ALLE
  // Kachel-Builder genau diese Vorlage (nie mit WMS-Layern kombiniert); die
  // WMS-Felder werden ignoriert. Genutzt für reine Anzeige-Overlays ohne WMS,
  // z. B. Ungarn (MyDroneSpace-WMTS).
  tileUrlTemplate?: string;
  // Pflicht-Attribution der Kachel-Quelle (wird an der Kachel-Ebene der Karte
  // angezeigt). Derzeit nur für XYZ-Overlays gesetzt.
  tileAttribution?: string;
}

// Godrone-Gelb (NATURE CONSERVATION AREA / GROUND HAZARD Nature Reserve).
// Halbtransparent, damit Untergrund (OSM/Sat) sichtbar bleibt.
export function buildYellowPolygonSld(layerName: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<NamedLayer><Name>${layerName}</Name>` +
    `<UserStyle><FeatureTypeStyle><Rule><PolygonSymbolizer>` +
    `<Fill><CssParameter name="fill">#F5C24A</CssParameter><CssParameter name="fill-opacity">0.55</CssParameter></Fill>` +
    `<Stroke><CssParameter name="stroke">#B8860B</CssParameter><CssParameter name="stroke-width">1.2</CssParameter></Stroke>` +
    `</PolygonSymbolizer></Rule></FeatureTypeStyle></UserStyle>` +
    `</NamedLayer></StyledLayerDescriptor>`
  );
}

export const GEOZONE_LAYERS: GeozoneLayer[] = [
  { id: "kontrollzonen", wmsLayer: "kontrollzonen", label: "Kontrollzonen (CTR)", defaultEnabled: true },
  { id: "flugbeschraenkungsgebiete", wmsLayer: "flugbeschraenkungsgebiete", label: "Flugbeschränkungsgebiete (ED-R)", defaultEnabled: true },
  { id: "temporaere_betriebseinschraenkungen", wmsLayer: "temporaere_betriebseinschraenkungen", label: "Temporäre Beschränkungen", defaultEnabled: true },
  { id: "flughaefen", wmsLayer: "flughaefen", label: "Flughäfen", defaultEnabled: true },
  { id: "flugplaetze", wmsLayer: "flugplaetze", label: "Flugplätze", defaultEnabled: true },
  { id: "binnenwasserstrassen", wmsLayer: "binnenwasserstrassen", label: "Binnenwasserstraßen", defaultEnabled: true },
  { id: "seewasserstrassen", wmsLayer: "seewasserstrassen", label: "Seewasserstraßen", defaultEnabled: true },
  { id: "schifffahrtsanlagen", wmsLayer: "schifffahrtsanlagen", label: "Schifffahrtsanlagen", defaultEnabled: true },
  { id: "industrieanlagen", wmsLayer: "industrieanlagen", label: "Industrieanlagen", defaultEnabled: true },
  { id: "naturschutzgebiete", wmsLayer: "naturschutzgebiete", label: "Naturschutzgebiete", defaultEnabled: true },
  { id: "nationalparks", wmsLayer: "nationalparks", label: "Nationalparks", defaultEnabled: true },
  { id: "vogelschutzgebiete", wmsLayer: "vogelschutzgebiete", label: "Vogelschutzgebiete", defaultEnabled: true },
  { id: "ffh-gebiete", wmsLayer: "ffh-gebiete", label: "FFH-Gebiete", defaultEnabled: true },
  { id: "militaerische_anlagen", wmsLayer: "militaerische_anlagen", label: "Militärische Anlagen", defaultEnabled: true },
  { id: "stromleitungen", wmsLayer: "stromleitungen", label: "Stromleitungen", defaultEnabled: true },
  { id: "umspannwerke", wmsLayer: "umspannwerke", label: "Umspannwerke", defaultEnabled: true },
  { id: "kraftwerke", wmsLayer: "kraftwerke", label: "Kraftwerke", defaultEnabled: true },
  { id: "windkraftanlagen", wmsLayer: "windkraftanlagen", label: "Windkraftanlagen", defaultEnabled: true },
  { id: "bundesautobahnen", wmsLayer: "bundesautobahnen", label: "Bundesautobahnen", defaultEnabled: true },
  { id: "bundesstrassen", wmsLayer: "bundesstrassen", label: "Bundesstraßen", defaultEnabled: true },
  { id: "bahnanlagen", wmsLayer: "bahnanlagen", label: "Bahnanlagen", defaultEnabled: true },
  { id: "diplomatische_vertretungen", wmsLayer: "diplomatische_vertretungen", label: "Diplomatische Vertretungen", defaultEnabled: true },
  { id: "behoerden", wmsLayer: "behoerden", label: "Oberste Bundes-/Landesbehörden", defaultEnabled: true },
  { id: "internationale_organisationen", wmsLayer: "internationale_organisationen", label: "Internationale Organisationen", defaultEnabled: true },
  { id: "justizvollzugsanstalten", wmsLayer: "justizvollzugsanstalten", label: "JVA / Maßregelvollzug", defaultEnabled: true },
  { id: "polizei", wmsLayer: "polizei", label: "Polizeiliegenschaften", defaultEnabled: true },
  { id: "sicherheitsbehoerden", wmsLayer: "sicherheitsbehoerden", label: "Andere Sicherheitsbehörden", defaultEnabled: true },
  { id: "krankenhaeuser", wmsLayer: "krankenhaeuser", label: "Krankenhäuser", defaultEnabled: true },
  { id: "labore", wmsLayer: "labore", label: "Einrichtungen BSL-4", defaultEnabled: true },
  { id: "freibaeder", wmsLayer: "freibaeder", label: "Freibäder / Badestrände", defaultEnabled: true },
  { id: "modellflugplaetze", wmsLayer: "modellflugplaetze", label: "Modellflugplätze", defaultEnabled: true },
  { id: "haengegleiter", wmsLayer: "haengegleiter", label: "Hängegleiter", defaultEnabled: true },
  { id: "wohngrundstuecke", wmsLayer: "wohngrundstuecke", label: "Wohngrundstücke", defaultEnabled: true },
];

export const CH_GEOZONE_LAYERS: GeozoneLayer[] = [
  // Drohnen-Einschränkungen und Aktivitätszonen kommen als Vektoren (BAZL ED-269);
  // die WMS-Ebenen bleiben abschaltbar erhalten, standardmäßig aus (sonst doppelt).
  { id: "ch_drohnen", wmsLayer: "ch.bazl.einschraenkungen-drohnen", label: "Drohnen-Einschränkungen (WMS)", defaultEnabled: false },
  { id: "ch_aktivitaetszonen", wmsLayer: "ch.bazl.uas-aktivitaetszonen", label: "UAS-Aktivitätszonen (WMS)", defaultEnabled: false },
  { id: "ch_bodenrisiko_100", wmsLayer: "ch.bazl.intrinsisches-bodenrisiko_sora_100", label: "Bodenrisiko SORA 100J", defaultEnabled: true },
  { id: "ch_bodenrisiko_200", wmsLayer: "ch.bazl.intrinsisches-bodenrisiko_sora_200", label: "Bodenrisiko SORA 200J", defaultEnabled: true },
  { id: "ch_ruhezonen", wmsLayer: "ch.bazl.landschaftsruhezonen", label: "Landschaftsruhezonen", defaultEnabled: true },
  { id: "ch_wohngebiete", wmsLayer: "ch.bazl.wohngebiete-aulav", label: "Wohngebiete (AuLaV)", defaultEnabled: true },
];

export const LU_GEOZONE_LAYERS: GeozoneLayer[] = [
  // Kommen als Vektoren (siehe geozones.ts LU); WMS standardmäßig aus (sonst doppelt).
  { id: "lu_uas_0_50", wmsLayer: "1927", label: "UAS-Zonen 0–50 m (WMS)", defaultEnabled: false },
  { id: "lu_uas_50_120", wmsLayer: "1928", label: "UAS-Zonen 50–120 m (WMS)", defaultEnabled: false },
];

export const NL_GEOZONE_LAYERS: GeozoneLayer[] = [
  // Die PDOK-Dienste von LVNL sind abgeschaltet (404). Die NL-Zonen kommen jetzt
  // als Vektoren aus GoDrone (LVNL / Altitude Angel); die alten Ebenen bleiben
  // abgeschaltet erhalten, falls PDOK sie wieder bereitstellt.
  { id: "nl_no_fly_zones", wmsLayer: "luchtvaartgebieden", label: "Flugverbotszonen PDOK (alle)", defaultEnabled: false },
  { id: "nl_no_fly_ohne_natura", wmsLayer: "luchtvaartgebieden_zonder_natura2000", label: "Flugverbotszonen PDOK (ohne Natura2000)", defaultEnabled: false },
  { id: "nl_landingsite", wmsLayer: "landingsite", label: "Landeplätze PDOK", defaultEnabled: false },
  // Natura 2000 — EU-Vogelschutz- und FFH-Schutzgebiete (NL). Quelle: PDOK
  // (RVO). Eigener WMS-Endpoint, daher Override pro Layer. Drohnenbetrieb
  // ist in Natura-2000-Gebieten oft komplett untersagt (Wet
  // natuurbescherming + jeweiliger Beheerplan). Auf godrone.nl als gelbe
  // "NATURE CONSERVATION AREA" sichtbar.
  {
    id: "nl_natura2000",
    wmsLayer: "natura2000",
    label: "Natura 2000 (Naturschutz, gelb)",
    defaultEnabled: false, // in GoDrone enthalten (lvnl:natura2000) – nur bei Bedarf als WMS
    wmsBaseUrl: "https://service.pdok.nl/rvo/natura2000/wms/v1_0",
    wmsVersion: "1.3.0",
    // Godrone-Gelb statt PDOK-Default-Oliv, damit der Pilot 1:1 sieht,
    // was auch auf map.godrone.nl als "NATURE CONSERVATION AREA" markiert ist.
    wmsSldBody: buildYellowPolygonSld("natura2000"),
  },
  // Natuurnetwerk Nederland (NNN) — provinziale Naturschutzgebiete, geführt
  // von BIJ12 (Provincies). Auf godrone.nl als gelbe "GROUND HAZARD: Nature
  // Reserve" sichtbar (z. B. Duinen Goeree, Volgerland), die NICHT durch
  // Natura 2000 abgedeckt sind. Eigener PDOK-Endpoint, INSPIRE-harmonisiert.
  {
    id: "nl_nnn",
    wmsLayer: "PS.ProtectedSite",
    label: "Naturnetzwerk Niederlande (NNN, gelb)",
    defaultEnabled: true,
    wmsBaseUrl: "https://service.pdok.nl/provincies/natuurnetwerk-nederland/wms/v1_0",
    wmsVersion: "1.3.0",
    // Godrone-Gelb statt INSPIRE-Default-Oliv — identische Farbe wie
    // map.godrone.nl "GROUND HAZARD: Nature Reserve".
    wmsSldBody: buildYellowPolygonSld("PS.ProtectedSite"),
  },
];

// Frankreich — offizieller Géoplateforme/IGN-WMS (DGAC). Ein einziger Layer
// mit den Drohnen-Beschränkungszonen der offenen Kategorie + Aeromodellismus.
// Kein API-Key nötig. WMS 1.3.0, EPSG:3857. GetFeatureInfo liefert die
// Properties `limite` (Höhengrenze bzw. "Vol interdit") und `remarque`.
export const FR_GEOZONE_LAYERS: GeozoneLayer[] = [
  {
    id: "fr_restrictions",
    wmsLayer: "TRANSPORTS.DRONES.RESTRICTIONS",
    label: "Drohnen-Beschränkungen (DGAC)",
    defaultEnabled: true,
  },
];

// Ungarn — HungaroControl / MyDroneSpace. Öffentlicher WMTS (RESTful, ohne
// Login), Layer "AIXM", TileMatrixSet GoogleMapsCompatible (XYZ, y NICHT
// TMS-gespiegelt), Zoom 0–18 laut WMTSCapabilities.xml. NUR Anzeige: Die
// Kacheln sind ein Bild ohne Zonengrenzen/Höhen – eine automatische Prüfung
// ist damit nicht möglich (die Vektor-API /api/zones braucht einen Login).
// Deshalb steht HU bewusst NICHT in OWN_MAP_DATA_COUNTRIES.
export const HU_GEOZONE_ATTRIBUTION = "© HungaroControl / MyDroneSpace";
export const HU_GEOZONE_TILE_URL = "https://mds.mydronespace.hu/wmts/1.0.0/aixm/{z}/{x}/{y}.png";
export const HU_GEOZONE_RASTER_HINT =
  "Für Ungarn zeigt die Karte die Lufträume und Drohnenzonen nur als Bild (MyDroneSpace). " +
  "Eine automatische Prüfung ist nicht möglich – Zonen bitte in der App MyDroneSpace prüfen und den Flug dort anmelden.";

export const HU_GEOZONE_LAYERS: GeozoneLayer[] = [
  {
    id: "hu_aixm",
    wmsLayer: "AIXM",
    label: "Lufträume & Drohnenzonen (MyDroneSpace)",
    defaultEnabled: true,
    tileUrlTemplate: HU_GEOZONE_TILE_URL,
    tileAttribution: HU_GEOZONE_ATTRIBUTION,
  },
];

// Länder, die erst NACH der einmaligen Migration auf die Kategorie-Auswahl
// dazukamen. Für sie gibt es keine alten Speicher-Schlüssel; als Alt-Layer
// gezählt würde die Migration ihren Gesamt-Schalter fälschlich auf "aus" falten.
const POST_MIGRATION_ISOS = new Set(["HU"]);

// Pro-Land-Liste der nativen Layer (id/iso/wmsLayer-Quelle). Vektor-Länder
// AT/BE/DK liefern KEIN WMS und haben daher keine Layer; sie werden als
// kombinierte Gesamt-Schalter (COMBINED_COUNTRY_TOGGLES) gesteuert. Diese
// Aufstellung MUSS COUNTRY_GEOZONE_CONFIGS in client/lib/geozones.ts
// entsprechen — dort werden genau diese Arrays referenziert.
export interface NativeGeozoneCountryLayers {
  iso: string;
  layers: GeozoneLayer[];
}

export const NATIVE_GEOZONE_LAYER_CATALOG: NativeGeozoneCountryLayers[] = [
  { iso: "DE", layers: GEOZONE_LAYERS },
  { iso: "CH", layers: CH_GEOZONE_LAYERS },
  { iso: "LU", layers: LU_GEOZONE_LAYERS },
  { iso: "NL", layers: NL_GEOZONE_LAYERS },
  { iso: "FR", layers: FR_GEOZONE_LAYERS },
  { iso: "HU", layers: HU_GEOZONE_LAYERS },
  { iso: "AT", layers: [] },
  { iso: "BE", layers: [] },
  { iso: "DK", layers: [] },
];

// Baut die früher pro Land/Layer gespeicherten Alt-Layer-Referenzen (für die
// einmalige Migration auf die Kategorie-Auswahl). id = alter AsyncStorage-
// Schlüssel, iso + wmsLayer für die Kategorie-Auflösung. EINZIGE Quelle, die
// sowohl client/lib/geozones.ts (Laufzeit-Migration) als auch der
// Migrationstest nutzen.
export function getNativeLegacyLayerRefs(): OldLayerRef[] {
  return NATIVE_GEOZONE_LAYER_CATALOG.filter(({ iso }) => !POST_MIGRATION_ISOS.has(iso)).flatMap(({ iso, layers }) =>
    layers.map((l) => ({ id: l.id, iso, wmsLayer: l.wmsLayer })),
  );
}
