// Reines, von React Native / Expo unabhängiges Helfer-Stück zum Bauen der
// Geozonen-Kachel-URL des serverseitigen Caches. Bewusst frei von RN-/Expo-
// Importen, damit es deterministisch (unter tsx/Node) getestet werden kann —
// die eigentliche Komponente (MapPicker.native) erzeugt aus EINER solchen URL
// genau EINE UrlTile-Ebene pro Land (statt einer pro Layer).

/**
 * Baut die kombinierte XYZ-Kachel-URL für ein Land: ALLE übergebenen WMS-Layer
 * landen in EINEM `layers=`-Parameter, dedupliziert und sortiert (stabile
 * Cache-Schlüssel). Liefert "" wenn keine gültigen Layer übergeben wurden.
 *
 * @param apiBase  Basis-URL des Backends (z. B. aus getApiUrl()).
 * @param layers   Liste von WMS-Layer-Namen.
 * @param countryIso Länder-ISO (Standard "DE").
 */
export function buildGeozoneCacheTileUrlFrom(
  apiBase: string,
  layers: string[],
  countryIso?: string,
): string {
  if (!layers || layers.length === 0) return "";
  const iso = (countryIso || "DE").toLowerCase();
  const sorted = Array.from(new Set(layers.filter(Boolean))).sort();
  if (sorted.length === 0) return "";
  const base = (apiBase || "").replace(/\/+$/, "");
  return `${base}/api/proxy/geozone-tiles/${iso}/{z}/{x}/{y}.png?layers=${encodeURIComponent(sorted.join(","))}`;
}

/**
 * Baut die XYZ-Kachel-URL für ein VEKTOR-Geozonen-Land (ED-269 ohne WMS, z. B.
 * Belgien), das der Server selbst zu PNG-Kacheln rasterisiert. Anders als die
 * WMS-Variante hat sie keinen `layers`-Parameter — der Server zeichnet ALLE
 * dauerhaften Zonen des Landes in die Kachel. Der Client bindet sie wie eine
 * gewöhnliche WMS-Kachel-Ebene ein (eine UrlTile/tileLayer pro Land), wodurch
 * die Zonen robust erscheinen statt als fragile Client-Vektor-Polygone.
 *
 * @param apiBase    Basis-URL des Backends (z. B. aus getApiUrl()).
 * @param countryIso Länder-ISO (z. B. "BE").
 */
export function buildVectorGeozoneTileUrlFrom(apiBase: string, countryIso: string): string {
  const iso = (countryIso || "").toLowerCase();
  if (!iso) return "";
  const base = (apiBase || "").replace(/\/+$/, "");
  return `${base}/api/proxy/geozone-vector-tiles/${iso}/{z}/{x}/{y}.png`;
}
