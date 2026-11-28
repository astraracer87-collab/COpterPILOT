// Cinematic-Vorschau: kuratierte Gipfel mit typischem Wolkenmeer-/Hochnebel-
// Blick. Je Spot: Gipfel (reale Höhe) + ein nahegelegener Tal-/Tiefland-
// Referenzpunkt, dessen Höhenprofil die Nebelobergrenze liefert.
// Koordinaten aus amtlichen/Wikipedia-Angaben, gegen das Copernicus-DEM
// (Open-Meteo Elevation) geprüft. RN-frei.

export interface CinematicSpot {
  id: string;
  name: string;
  /** Gebirge/Region */
  region: string;
  latitude: number;
  longitude: number;
  /** Reale Gipfelhöhe m ü. NN */
  elevationM: number;
  /** Tal-/Tiefland-Referenzpunkt */
  valley: { latitude: number; longitude: number; name: string };
  /** DWD-Station am/nahe dem Gipfel (Stationsvorhersage, Gegenprobe) */
  dwdSummitStation?: string;
  /** DWD-Station im Tal */
  dwdValleyStation?: string;
}

// Gemeinsame Tal-Referenzen (gleiche Koordinaten → nur eine Abfrage-Location)
const RHEIN_MAIN = { latitude: 50.11, longitude: 8.6, name: "Rhein-Main-Ebene (Frankfurt)" };
const OBERRHEIN_SUED = { latitude: 47.9, longitude: 7.62, name: "Oberrheinebene (Breisgau)" };

export const CINEMATIC_SPOTS: readonly CinematicSpot[] = [
  { id: "grosser-feldberg", name: "Großer Feldberg", region: "Taunus", latitude: 50.2325, longitude: 8.4572, elevationM: 879, valley: RHEIN_MAIN, dwdSummitStation: "10635", dwdValleyStation: "10637" },
  { id: "kleiner-feldberg", name: "Kleiner Feldberg", region: "Taunus", latitude: 50.2222, longitude: 8.4444, elevationM: 825, valley: RHEIN_MAIN, dwdSummitStation: "10635", dwdValleyStation: "10637" },
  { id: "altkoenig", name: "Altkönig", region: "Taunus", latitude: 50.212, longitude: 8.4847, elevationM: 798, valley: RHEIN_MAIN, dwdSummitStation: "10635", dwdValleyStation: "10637" },
  { id: "hohe-wurzel", name: "Hohe Wurzel", region: "Taunus", latitude: 50.1086, longitude: 8.1333, elevationM: 618, valley: { latitude: 50.02, longitude: 8.26, name: "Rheintal (Mainz/Wiesbaden)" } },
  { id: "taufstein", name: "Taufstein / Hoherodskopf", region: "Vogelsberg", latitude: 50.5154, longitude: 9.2416, elevationM: 773, valley: { latitude: 50.36, longitude: 8.85, name: "Wetterau" } },
  { id: "wasserkuppe", name: "Wasserkuppe", region: "Rhön", latitude: 50.4978, longitude: 9.9375, elevationM: 950, valley: { latitude: 50.555, longitude: 9.68, name: "Fuldaer Becken" }, dwdSummitStation: "10544" },
  { id: "kreuzberg-rhoen", name: "Kreuzberg", region: "Rhön", latitude: 50.3708, longitude: 9.9819, elevationM: 928, valley: { latitude: 50.2, longitude: 10.08, name: "Saaletal (Bad Kissingen)" } },
  { id: "melibokus", name: "Melibokus", region: "Odenwald", latitude: 49.7231, longitude: 8.6403, elevationM: 517, valley: { latitude: 49.72, longitude: 8.5, name: "Hessisches Ried" } },
  { id: "katzenbuckel", name: "Katzenbuckel", region: "Odenwald", latitude: 49.4719, longitude: 9.0414, elevationM: 626, valley: { latitude: 49.4, longitude: 9.07, name: "Neckartal" } },
  { id: "donnersberg", name: "Donnersberg", region: "Pfalz", latitude: 49.6256, longitude: 7.9147, elevationM: 687, valley: { latitude: 49.63, longitude: 8.3, name: "Rheinebene (Worms)" } },
  { id: "erbeskopf", name: "Erbeskopf", region: "Hunsrück", latitude: 49.73, longitude: 7.0925, elevationM: 816, valley: { latitude: 49.98, longitude: 6.89, name: "Wittlicher Senke / Mosel" } },
  { id: "hohe-acht", name: "Hohe Acht", region: "Eifel", latitude: 50.3864, longitude: 7.0111, elevationM: 747, valley: { latitude: 50.42, longitude: 7.4, name: "Neuwieder Becken" } },
  { id: "grosser-oelberg", name: "Großer Ölberg", region: "Siebengebirge", latitude: 50.6809, longitude: 7.2497, elevationM: 460, valley: { latitude: 50.72, longitude: 7.12, name: "Rheintal (Bonn)" } },
  { id: "kahler-asten", name: "Kahler Asten", region: "Sauerland", latitude: 51.18, longitude: 8.4894, elevationM: 841, valley: { latitude: 51.345, longitude: 8.29, name: "Ruhrtal (Meschede)" }, dwdSummitStation: "10427" },
  { id: "grosser-inselsberg", name: "Großer Inselsberg", region: "Thüringer Wald", latitude: 50.8492, longitude: 10.4636, elevationM: 916, valley: { latitude: 50.95, longitude: 10.68, name: "Gothaer Land" } },
  { id: "brocken", name: "Brocken", region: "Harz", latitude: 51.7994, longitude: 10.6156, elevationM: 1141, valley: { latitude: 51.9, longitude: 10.75, name: "Nördliches Harzvorland" }, dwdSummitStation: "10453" },
  { id: "fichtelberg", name: "Fichtelberg", region: "Erzgebirge", latitude: 50.4294, longitude: 12.9547, elevationM: 1215, valley: { latitude: 50.38, longitude: 13.27, name: "Egertal (Kadaň)" }, dwdSummitStation: "10578" },
  { id: "grosser-arber", name: "Großer Arber", region: "Bayerischer Wald", latitude: 49.1128, longitude: 13.1347, elevationM: 1456, valley: { latitude: 49.22, longitude: 12.68, name: "Chamer Becken" } },
  { id: "hornisgrinde", name: "Hornisgrinde", region: "Nordschwarzwald", latitude: 48.6081, longitude: 8.2017, elevationM: 1164, valley: { latitude: 48.63, longitude: 7.98, name: "Oberrheinebene (Achern)" } },
  { id: "feldberg-schwarzwald", name: "Feldberg", region: "Schwarzwald", latitude: 47.8739, longitude: 8.0042, elevationM: 1493, valley: OBERRHEIN_SUED, dwdSummitStation: "10908" },
  { id: "belchen", name: "Belchen", region: "Schwarzwald", latitude: 47.8228, longitude: 7.8331, elevationM: 1414, valley: OBERRHEIN_SUED },
  { id: "hohenpeissenberg", name: "Hoher Peißenberg", region: "Alpenvorland", latitude: 47.8014, longitude: 11.0131, elevationM: 988, valley: { latitude: 47.84, longitude: 11.14, name: "Ammertal (Weilheim)" }, dwdSummitStation: "10962" },
  { id: "pfaender", name: "Pfänder", region: "Bodensee (AT)", latitude: 47.5067, longitude: 9.7806, elevationM: 1064, valley: { latitude: 47.53, longitude: 9.68, name: "Bodensee (Lindau)" } },
];

export const DEFAULT_SPOT_RADIUS_KM = 150;
export const MAX_SPOTS_PER_REQUEST = 12;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface SpotWithDistance extends CinematicSpot {
  distanceKm: number;
}

/**
 * Spots im Umkreis, nach Entfernung sortiert, höchstens `max`. Liegt keiner
 * im Umkreis, kommen die nächsten 3 (mit `outsideRadius: true`).
 */
export function selectSpots(
  pos: { latitude: number; longitude: number },
  radiusKm: number = DEFAULT_SPOT_RADIUS_KM,
  max: number = MAX_SPOTS_PER_REQUEST,
  spots: readonly CinematicSpot[] = CINEMATIC_SPOTS,
): { spots: SpotWithDistance[]; outsideRadius: boolean } {
  const all = spots
    .map((s) => ({ ...s, distanceKm: distanceKm(pos.latitude, pos.longitude, s.latitude, s.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const inside = all.filter((s) => s.distanceKm <= radiusKm).slice(0, max);
  if (inside.length > 0) return { spots: inside, outsideRadius: false };
  return { spots: all.slice(0, Math.min(3, max)), outsideRadius: true };
}

/** Standard-Mitte ohne bekannte Position: Rhein-Main. */
export const DEFAULT_CINEMATIC_CENTER = { latitude: 50.11, longitude: 8.68 };
