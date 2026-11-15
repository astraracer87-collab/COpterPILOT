// Direkter Abruf der Schweizer (inkl. Liechtensteiner) Geozonen vom BAZL über
// data.geo.admin.ch – ED-269-Datei `ch.bazl.einschraenkungen-drohnen` plus die
// kleine GeoJSON-Datei der UAS-Aktivitätszonen. Normalisierung in
// shared/swissGeozones.ts. Siehe docs/geozonen-weitere-laender.md §4.
//
// Bewusst frei von React-Native-/Expo-Importen (unter tsx/Node testbar) und
// ohne Wert-Import aus ed269Sources.ts, damit dort später
// `import { fetchSwitzerland } from "./switzerlandSource"` keinen Zyklus
// erzeugt (nur `import type`).
//
// Länder-Tag: ALLE Features (auch die drei Liechtensteiner Zonen) bekommen
// `_country: "ch"`. Grund: Der Geräte-Bestand ist pro Land eine Datei
// (ed269Store: `ed269-<iso>.json`), Liechtenstein hat weder einen eigenen Feed
// noch einen Eintrag in COUNTRY_GEOZONE_CONFIGS – die BAZL-Datei deckt FL mit
// ab. Die Herkunft bleibt über `properties.country === "LI"` (und
// `countryIso3: "LIE"`) erkennbar. Für Nutzer, die per countryDetection als
// „LI“ erkannt werden, sollte die App den CH-Bestand verwenden.
import type { GeoFeature } from "./ed269Sources";
import {
  CH_ACTIVITY_ZONES_URL,
  CH_GEOZONES_URL,
  normalizeSwissActivityZones,
  normalizeSwissEd269,
  stripBom,
  type SwissFeature,
} from "../../../shared/swissGeozones";

// CH_GEOZONE_SOURCE_LABEL = "BAZL / swisstopo (geo.admin.ch)" – Popup-/Quellen-
// bezeichnung (Opendata BY: Quellenangabe Pflicht); definiert in shared/.
export {
  CH_GEOZONES_URL,
  CH_ACTIVITY_ZONES_URL,
  CH_GEOZONE_SOURCE_LABEL,
  CH_GEOZONE_ATTRIBUTION,
} from "../../../shared/swissGeozones";

// Die ED-269-Datei ist ~18 MB groß und wird OHNE Kompression ausgeliefert
// (S3/CloudFront, auch mit Accept-Encoding: gzip). Auf langsamen Mobilfunk-
// verbindungen braucht der Download deutlich länger als die üblichen 60 s.
export const CH_FETCH_TIMEOUT_MS = 120_000;
const CH_ACTIVITY_TIMEOUT_MS = 30_000;

// Plausibilitätsgrenze: Der Feed hat ~1290 Zonen. Deutlich weniger deutet auf
// eine abgeschnittene/fehlerhafte Antwort hin → lieber den alten Gerätebestand
// behalten (Fehler werfen).
const CH_MIN_ZONES = 500;

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Lädt eine (große) JSON-Datei als Text und parst sie selbst:
 * - langer Timeout per AbortController,
 * - BOM wird entfernt (die Aktivitätszonen-Datei beginnt mit U+FEFF; manche
 *   fetch-Polyfills reichen das an JSON.parse weiter),
 * - KEIN eigener `Accept-Encoding`-Header: OkHttp (Android) und NSURLSession
 *   (iOS) sowie Node/undici fordern gzip selbst an und entpacken transparent.
 *   Setzt man den Header manuell, entpackt OkHttp NICHT mehr und res.text()
 *   liefert Binärmüll. Sollte geo.admin.ch künftig gzip ausliefern, greift das
 *   also automatisch.
 */
async function fetchLargeJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "application/json, application/geo+json;q=0.9, */*;q=0.1", "User-Agent": BROWSER_UA },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(stripBom(text));
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s (${url})`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function tagCountry(features: SwissFeature[]): GeoFeature[] {
  return features.map((f) => ({
    ...f,
    properties: { ...(f.properties || {}), _country: "ch" },
  })) as GeoFeature[];
}

/**
 * Schweizer + Liechtensteiner Geozonen (BAZL). Wirft, wenn die Hauptdatei nicht
 * geladen werden kann oder unplausibel klein ist; die Aktivitätszonen sind
 * optional (Fehler nur als Warnung).
 *
 * Geometrien sind bereits vereinfacht (Douglas-Peucker ≈ 5 m) und auf
 * 5 Nachkommastellen gerundet; `bbox` ist gesetzt. Ein zusätzliches
 * roundFeatureCoords() in fetchEd269CountryFeatures ist harmlos (idempotent).
 */
export async function fetchSwitzerland(): Promise<GeoFeature[]> {
  const body = await fetchLargeJson(CH_GEOZONES_URL, CH_FETCH_TIMEOUT_MS);
  const zones = normalizeSwissEd269(body);
  if (zones.length < CH_MIN_ZONES) {
    throw new Error(`BAZL lieferte nur ${zones.length} Zonen (erwartet > ${CH_MIN_ZONES})`);
  }
  let activity: SwissFeature[] = [];
  try {
    activity = normalizeSwissActivityZones(await fetchLargeJson(CH_ACTIVITY_ZONES_URL, CH_ACTIVITY_TIMEOUT_MS));
  } catch (e) {
    console.warn("[geozoneDirect] CH: UAS-Aktivitätszonen nicht erreichbar:", (e as Error)?.message || e);
  }
  return tagCountry([...zones, ...activity]);
}
