// Reine, von React Native / Expo unabhängige Zoom-/Grenzkonstanten für die
// Geozonen-Overlays. Bewusst frei von RN-/Expo-Importen (kein AsyncStorage/
// expo-constants), damit beide Oberflächen DIESELBEN Werte teilen können:
//   - Mobile-App  (client/lib/geozones.ts re-exportiert von hier)
//   - Web         (web/src/pages/MapPage.tsx via @client/lib/geozoneZoom)
// Analog zu ctrAltitude.ts / firDetection.ts / geozoneTileUrl.ts. Vorher war
// GEOZONE_VECTOR_MIN_ZOOM in geozones.ts definiert und in MapPage.tsx als
// VECTOR_MIN_ZOOM dupliziert, weil geozones.ts React-Native-Importe zieht.

// Minimale Zoomstufe, ab der native Karten Geozonen-/WMS-Kachel-Overlays
// rendern dürfen. Darunter (Übersichts-/Kontinentebene, ~z3-z6) werden die
// Overlays komplett unmountet bzw. via minimumZ gar nicht erst angefordert:
// die kombinierten 33-Layer-Kacheln sind dort nutzlos, brauchen aber mehrere
// Sekunden pro Kachel und brachten iOS/MapKit beim Rauszoomen zum Absturz.
// Einheitlich genutzt von TrafficMapView, MapPicker, DjiTracksMap usw.
export const GEOZONE_TILE_MIN_ZOOM = 7;

// Mindest-Zoomstufe für VEKTOR-Länder (ED-269, z. B. DK), die keine WMS-
// Kacheln, sondern per bbox geladene GeoJSON-Polygone liefern. WMS-Länder laden
// nur die kleinen sichtbaren Kacheln (ab z7 unkritisch); Vektor-Länder müssen
// dagegen den gesamten sichtbaren Bereich als ein einziges JSON ziehen. Bei
// herausgezoomter Radaransicht (~z7) ergibt das für ein dichtes Land wie
// Dänemark eine landesweite Massenabfrage (~11 MB / ~1700 Zonen), die ins
// 12-s-Client-Timeout läuft und still leer zurückkommt. Daher werden Vektor-
// Zonen erst ab einer höheren Zoomstufe geladen, ab der der sichtbare Bereich
// (und damit die Antwort) handhabbar klein ist. Bei normaler Radar-Nutzung
// (Umkreis 3–30 km -> z9–z11) liegt der Zoom über dieser Schwelle, sodass
// dänische Zonen tatsächlich gezeichnet werden.
export const GEOZONE_VECTOR_MIN_ZOOM = 9;

// Pro-Land-Override der Vektor-Mindestzoomstufe.
//
// BE/AT: An die WMS-Kachel-Schwelle (GEOZONE_TILE_MIN_ZOOM, z7) gekoppelt statt
// an den generischen Vektor-Default (z9). Grund: Beide laden ihren kompletten
// Landesbestand (BE ~288, AT ~291 Zonen, jeweils weit unter dem Feature-Deckel
// 1200) ohnehin in einem kleinen, gedeckelten Request
// (GEOZONE_VECTOR_FULL_COUNTRY_ISOS), daher ist ein frühes Anzeigen ungefährlich
// (kein Timeout-Risiko wie bei DK). So erscheinen belgische UND österreichische
// Zonen ab derselben Zoomstufe wie die WMS-Nachbarländer (FR/NL/DE) und nicht
// erst deutlich später — kein fälschlicher "Hineinzoomen"-Hinweis mehr.
//
// DK: KEIN Override — bleibt beim höheren Default (z9), weil seine bbox-Abfrage
// bei weiter Sicht sonst eine landesweite Massenabfrage (~1700 Zonen) ins
// 12-s-Client-Timeout zieht (Datenmengen-/Timeout-Schutz).
//
// DE/FR/CZ (Offline-Kachelspeicher, geozoneTiles/): sehr dichte Bestände
// (DE ≈ 83 000 Zonen, teils MB-große Polygone) – Vektor-Zeichnung erst ab z10;
// darunter bleibt online das WMS-Bild (CZ: Hinweis „Hineinzoomen“ entfällt,
// da CZ kein WMS hat – unter z10 einfach keine Zonen).
export const GEOZONE_VECTOR_COUNTRY_MIN_ZOOM: Record<string, number> = {
  BE: GEOZONE_TILE_MIN_ZOOM,
  AT: GEOZONE_TILE_MIN_ZOOM,
  DE: 10,
  FR: 10,
  CZ: 10,
};

// Liefert die Vektor-Mindestzoomstufe für ein Land (pro-Land-Override oder Default).
export function getVectorMinZoom(iso: string): number {
  return GEOZONE_VECTOR_COUNTRY_MIN_ZOOM[(iso || "").toUpperCase()] ?? GEOZONE_VECTOR_MIN_ZOOM;
}

// ED-269-Länder, deren DAUERHAFTE Zonen serverseitig zu PNG-Kacheln
// rasterisiert und wie eine WMS-Kachel-Ebene eingebunden werden (statt als
// fragile Client-Vektor-Polygone). Belgien (skeyes/BCAA) liefert kein WMS, soll
// aber genauso robust erscheinen wie DE/NL/FR. Temporäre Zonen dieser Länder
// bleiben auf dem Vektor-/NOTAM-Pfad (zeitgefiltert), da die Kacheln 24 h
// gecacht werden. Für TAP-Abfragen permanenter Zonen werden die Vektor-Daten
// weiterhin (best-effort) geladen, nur nicht mehr gezeichnet.
// RC-Version: kein Server, der Belgien zu Kacheln rendert – BE wird als Vektor gezeichnet.
export const RASTER_TILED_VECTOR_ISOS = new Set<string>([]);

// True, wenn dauerhafte Vektor-Zonen dieses Landes als serverseitige Rasterkacheln
// angezeigt werden (siehe RASTER_TILED_VECTOR_ISOS).
export function isRasterTiledVectorCountry(iso: string): boolean {
  return RASTER_TILED_VECTOR_ISOS.has((iso || "").toUpperCase());
}

/**
 * Wird eine Vektor-Zone auf der Radar-Karte NICHT gezeichnet (nur unsichtbar für
 * Tap-Abfragen behalten)? Einziger Grund: dauerhafte Zonen eines Raster-Kachel-
 * Landes. Die deutschen 100-m-Windkraft-Pufferzonen (featureId "energy-zone:*")
 * werden unabhängig vom Zoom IMMER gezeichnet — früher wurden sie ab Zoom 12
 * zugunsten serverseitiger Anlagen-Kacheln ausgeblendet, die es in der
 * RC-Version nicht gibt (Review-Fix 7).
 */
export function isVectorZoneDrawSuppressed(
  zone: { informationalOnly?: boolean; country?: string | null },
  isTemp: boolean,
): boolean {
  return !zone.informationalOnly && !isTemp && isRasterTiledVectorCountry(zone.country ?? "");
}

// Länder, deren Vektor-Geozonen-Datensatz klein genug ist, um beim Herauszoomen
// den GESAMTEN Landesbestand zu laden (ohne bbox-Radius-Begrenzung), statt nur die
// Zonen nahe der Bildmitte. Sonst erschienen beim Rauszoomen nur zentrumsnahe
// Zonen. Belgiens ~288 Zonen liegen weit unter dem Feature-Deckel (1200).
const GEOZONE_VECTOR_FULL_COUNTRY_ISOS = new Set<string>(["BE", "AT"]);

// True, wenn für dieses Land beim Herauszoomen der gesamte Landesbestand statt
// eines bbox-Radius geladen werden soll (siehe GEOZONE_VECTOR_FULL_COUNTRY_ISOS).
export function loadsFullCountryVectorZones(iso: string): boolean {
  return GEOZONE_VECTOR_FULL_COUNTRY_ISOS.has((iso || "").toUpperCase());
}

// Obergrenze (km) für den bbox-Radius, mit dem Vektor-Zonen abgefragt werden.
// Deckelt die Antwortgröße auch dann, wenn der Nutzer über die Vektor-Mindest-
// Zoomstufe hinaus herauszoomt, und verhindert eine landesweite Massenabfrage.
export const GEOZONE_VECTOR_MAX_RADIUS_KM = 50;

// Serverseitige Obergrenze der pro Abruf zurückgegebenen Vektor-Zonen. Wird vom
// Radar als limit-Param mitgeschickt; der Server liefert dann die dem bbox-
// Zentrum nächstgelegenen Zonen. Schützt Antwortgröße und WebView-Rendering vor
// extrem dichten Ausschnitten (z. B. Großraum Kopenhagen).
export const GEOZONE_VECTOR_MAX_FEATURES = 1200;

// Höchste Zoomstufe, die der WMS-Server eines Landes tatsächlich rendert.
// Darüber skaliert die Karte (native: WMSTile via maximumNativeZ; Web: Leaflet
// via maxNativeZoom) die letzte echte Kachel hoch, statt leere Kacheln
// nachzuladen. Single Source of Truth für Mobile (client/lib/geozones.ts
// CountryGeozoneConfig.wmsMaxNativeZoom) und Web (web/src/pages/MapPage.tsx
// COUNTRY_MAX_NATIVE_ZOOM) — vorher als Literal `{ FR: 14 }` im Web dupliziert
// und konnte gegenüber der nativen Config driften.
//
// FR (DGAC `TRANSPORTS.DRONES.RESTRICTIONS`): MinScaleDenominator 17061.84.
// WMS-Scale pro Zoom (256px-Kachel, EPSG:3857, 0.00028 m/px):
//   z14 = 34124, z15 = 17062.4, z16 = 8531. Die Regel rendert, solange
//   scaleDenominator >= MinScaleDenominator. z15 (17062.4) liegt knapp ÜBER
//   der Grenze und rendert daher noch echte Geometrie; z16 (8531) liegt
//   darunter und liefert flächig transparente Kacheln. Empirisch über data.geopf.fr
//   bestätigt (z15 = echte Zonen inkl. Kanten, z16+ = leer). Letzte zuverlässig
//   gerenderte Stufe ist also Zoom 15 — NICHT 14. Mit der früheren 14er-Grenze
//   skalierte die Karte beim Hineinzoomen (z15/z16) die groben z14-Kacheln hoch,
//   wodurch über Frankreich ein Raster aus einfarbig gefüllten Blöcken und
//   leeren Kacheln entstand (Kachelgrenzen statt Zonengrenzen).
// Nur Länder mit einer echten Grenze eintragen; fehlende Länder nutzen den
// jeweiligen Karten-Default.
//
// DE/CH/LU/NL: KEIN Cap nötig — empirisch verifiziert (2026-06-24, Tiefzoom-
// Kacheln über bekannten Zonen z13–z18 abgerufen und pixelweise dekodiert,
// nicht nur Byte-Größe geprüft):
//   - DE (dipul `kontrollzonen`): scharfe Vektor-Kanten bis z17 (≈170–250
//     distinkte Farben an Zonenrändern), Innenfüllung bei z18.
//   - CH (`ch.bazl.einschraenkungen-drohnen`): Kanten bis z15, Innenfüllung z18.
//   - LU (`1927`): echte Kanten + Beschriftungen bis z18 (≈145 Farben).
//   - NL (`luchtvaartgebieden`): dichte Geometrie bis z18 (≈350 Farben).
// Keiner dieser WMS zeigt das FR-Verhalten (MinScaleDenominator -> ab einer
// Stufe flächig TRANSPARENTE Kacheln). Sie rendern bis in die Tiefe; eine
// einfarbige 100%-Kachel bei tiefem Zoom bedeutet hier "mitten in einer großen
// Zone" (korrekt), nicht "verschwunden". Daher bewusst OHNE Eintrag.
// HU (MyDroneSpace-WMTS "AIXM", GoogleMapsCompatible): TileMatrix 0–18 laut
// WMTSCapabilities.xml; darüber skaliert die Karte die z18-Kachel hoch.
export const COUNTRY_WMS_MAX_NATIVE_ZOOM: Record<string, number> = { FR: 15, HU: 18 };
