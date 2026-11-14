// Reine FIR-Zuordnung (welche Flight Information Region eine Position berührt)
// für die NOTAM-Abfrage. Bewusst frei von React-Native-Imports
// (kein AsyncStorage/expo-constants), damit die manuell gepflegten
// Lat/Lon-Grenzboxen unter dem tsx-Testrunner (web/run-tests.sh) ohne den
// nativen Modulgraphen geprüft werden können – analog zu geozoneCoverage.ts.
//
// Diese Logik ist die EINZIGE Quelle für client/lib/notams.ts und
// server/proxy.ts; beide re-exportieren bzw. importieren sie, damit die
// Länder-FIR-Zuordnung auf Client und Server nicht auseinanderdriften kann.
import { detectCountryFromCoordinates } from "../../shared/countryDetection";

// Französische FIRs (LFBB/LFMM/LFRR/LFEE/LFFF). Liefert null außerhalb
// des grob abgesteckten französischen Luftraums, sodass der Aufrufer auf
// die deutschen FIRs zurückfällt.
export function getFrenchFir(lat: number, lon: number): string | null {
  if (lat < 42.3 || lat > 51.1) return null;
  let eastCap: number;
  if (lat < 44.2) eastCap = 7.6;
  else if (lat < 47.5) eastCap = 7.1;
  else if (lat < 48.3) eastCap = 7.6;
  else if (lat < 48.8) eastCap = 8.0;
  else if (lat < 49.0) eastCap = 8.25;
  else if (lat < 49.5) eastCap = 6.9;
  else eastCap = 3.3;
  const westCap = lat < 43.6 ? -2.0 : -5.2;
  if (lon < westCap || lon > eastCap) return null;
  if (lat < 44.7) return lon < 2.0 ? "LFBB" : "LFMM";
  if (lat < 46.9) return lon < 1.5 ? "LFBB" : "LFMM";
  if (lon < 0.2) return "LFRR";
  if (lon >= 4.5) return "LFEE";
  return "LFFF";
}

// Liefert die FIR-Kennung für eine Position. Reihenfolge ist wichtig:
// Belgien (EBBU), Österreich (LOVV), die Niederlande (EHAA), die Schweiz (LSAS)
// und Luxemburg (ELLX) werden über die präzise Länder-Erkennung aus
// shared/countryDetection bestimmt (analog zu Frankreich), NICHT über rohe
// Grenzboxen. Das löst die Überschneidungen der groben Nachbar-Boxen sauber auf:
// Antwerpen wäre sonst NL/EHAA, Vorarlberg CH/LSAS und Arlon LU/ELLX.
// Die rohen Boxen hatten zwei konkrete Übergriffe: die EHAA-Box (lon bis 7.21)
// reichte ins westliche NRW (Köln/Düsseldorf/Aachen); die LSAS-Box
// (lat 45.8–47.9, lon 5.9–10.5) verschluckte das südliche Baden-Württemberg
// (Bodensee/Hochrhein) und das Genfer Umland in Frankreich. detectCountry-
// FromCoordinates klassifiziert diese Orte bereits korrekt als DE/FR, daher gehen
// wir durchgängig über `country ===`. Damit ist die FIR-Zuordnung konsistent mit
// der übrigen App (Geozonen/Compliance nutzen dieselbe Quelle). FR (LF*) wird
// danach geprüft, weil getFrenchFir den westfranzösischen Luftraum abdeckt, für
// den detectCountryFromCoordinates kein verfeinertes Polygon führt.
export function getFirForPosition(lat: number, lon: number): string {
  const country = detectCountryFromCoordinates(lat, lon);
  if (country === "BE") return "EBBU";
  if (country === "AT") return "LOVV";
  if (country === "NL") return "EHAA";
  if (country === "CH") return "LSAS";
  if (country === "LU") return "ELLX";
  const frFir = getFrenchFir(lat, lon);
  if (frFir) return frFir;
  if (lat < 48.0) return "EDMM";
  if (lat < 49.5 && lon > 10.0) return "EDMM";
  if (lat < 49.0 && lon > 11.5) return "EDMM";
  if (lat >= 52.0) return "EDWW";
  if (lat >= 51.0 && lon > 10.5) return "EDWW";
  if (lat >= 51.5 && lon > 9.0) return "EDWW";
  return "EDGG";
}
