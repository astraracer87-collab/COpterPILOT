export type CountryMapConfig = {
  iso: string;
  nameDE: string;
  urlTemplate: string;
  supportsCoordinates: boolean;
  coordinateType?: "wgs84" | "epsg2169" | "epsg3857" | "lv95";
  iframeable: boolean;
};

function wgs84ToEpsg3857(lat: number, lon: number) {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x: Math.round(x), y: Math.round(y) };
}

function wgs84ToEpsg2169(lat: number, lon: number) {
  const x = 699003 + (lon - 6.13) * 73000;
  const y = 6414253 + (lat - 49.75) * 111000;
  return { x: Math.round(x), y: Math.round(y) };
}

function wgs84ToLV95(lat: number, lon: number) {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180;
  const phi0 = (46.9524056 * Math.PI) / 180;
  const lambda0 = (7.4395833 * Math.PI) / 180;
  const phiDiff = (phi - phi0) * 10000;
  const lambdaDiff = (lambda - lambda0) * 10000;
  const easting =
    2600000 +
    211455.93 * lambdaDiff -
    10938.51 * lambdaDiff * phiDiff -
    0.36 * lambdaDiff * phiDiff * phiDiff -
    44.54 * lambdaDiff * lambdaDiff * lambdaDiff;
  const northing =
    1200000 +
    308807.95 * phiDiff +
    3745.25 * lambdaDiff * lambdaDiff +
    76.63 * phiDiff * phiDiff -
    194.56 * lambdaDiff * lambdaDiff * phiDiff +
    119.79 * phiDiff * phiDiff * phiDiff;
  return { easting: Math.round(easting), northing: Math.round(northing) };
}

export const COUNTRY_MAPS: CountryMapConfig[] = [
  { iso: "DE", nameDE: "Deutschland", urlTemplate: "https://maptool-dipul.dfs.de/geozones/@{lon},{lat},1000r?language=de&zoom=11", supportsCoordinates: true, coordinateType: "wgs84", iframeable: true },
  { iso: "AT", nameDE: "Österreich", urlTemplate: "https://utm.dronespace.at/avm/#p=12/{lat}/{lon}", supportsCoordinates: true, coordinateType: "wgs84", iframeable: true },
  { iso: "BE", nameDE: "Belgien", urlTemplate: "https://map.droneguide.be/", supportsCoordinates: false, iframeable: false },
  { iso: "CH", nameDE: "Schweiz", urlTemplate: "https://map.geo.admin.ch/#/map?lang=de&center={easting},{northing}&z=9", supportsCoordinates: true, coordinateType: "lv95", iframeable: true },
  { iso: "DK", nameDE: "Dänemark", urlTemplate: "https://www.en.droneregler.dk/uas-geographical-zones", supportsCoordinates: false, iframeable: false },
  { iso: "EE", nameDE: "Estland", urlTemplate: "https://utm.eans.ee/avm/#p=12/{lat}/{lon}", supportsCoordinates: true, coordinateType: "wgs84", iframeable: true },
  { iso: "ES", nameDE: "Spanien", urlTemplate: "https://drones.enaire.es/", supportsCoordinates: false, iframeable: false },
  { iso: "FR", nameDE: "Frankreich", urlTemplate: "https://www.geoportail.gouv.fr/", supportsCoordinates: false, iframeable: false },
  { iso: "GR", nameDE: "Griechenland", urlTemplate: "https://dagr.hasp.gov.gr/", supportsCoordinates: false, iframeable: false },
  { iso: "HR", nameDE: "Kroatien", urlTemplate: "https://amc-en.crocontrol.hr/Current-situation-anonymous-users", supportsCoordinates: false, iframeable: false },
  { iso: "IT", nameDE: "Italien", urlTemplate: "https://www.d-flight.it/", supportsCoordinates: false, iframeable: false },
  { iso: "LI", nameDE: "Liechtenstein", urlTemplate: "https://map.geo.admin.ch/#/map?lang=de&center={easting},{northing}&z=9", supportsCoordinates: true, coordinateType: "lv95", iframeable: true },
  { iso: "LU", nameDE: "Luxemburg", urlTemplate: "https://map.geoportail.lu/theme/main?lang=de&version=3&zoom=12&X={x}&Y={y}", supportsCoordinates: true, coordinateType: "epsg2169", iframeable: true },
  { iso: "LV", nameDE: "Lettland", urlTemplate: "https://www.airspace.lv/", supportsCoordinates: false, iframeable: false },
  { iso: "NL", nameDE: "Niederlande", urlTemplate: "https://map.godrone.nl/#loc={lat},{lon},13", supportsCoordinates: true, coordinateType: "wgs84", iframeable: true },
  { iso: "NO", nameDE: "Norwegen", urlTemplate: "https://nsm.geodataonline.no/", supportsCoordinates: false, iframeable: false },
  { iso: "PL", nameDE: "Polen", urlTemplate: "https://dronemap.pansa.pl/", supportsCoordinates: false, iframeable: false },
  { iso: "PT", nameDE: "Portugal", urlTemplate: "https://dnt.anac.pt/mapa.html", supportsCoordinates: false, iframeable: false },
  { iso: "RO", nameDE: "Rumänien", urlTemplate: "https://flightplan.romatsa.ro/init/drones", supportsCoordinates: false, iframeable: false },
  { iso: "SE", nameDE: "Schweden", urlTemplate: "https://daim.lfv.se/echarts/dronechart/?x={x}&y={y}&z=10", supportsCoordinates: true, coordinateType: "epsg3857", iframeable: true },
  { iso: "SI", nameDE: "Slowenien", urlTemplate: "https://caa-slovenia.maps.arcgis.com/", supportsCoordinates: false, iframeable: false },
];

export function getCountryMapConfig(iso: string): CountryMapConfig | undefined {
  return COUNTRY_MAPS.find((c) => c.iso === iso.toUpperCase());
}

export function buildMapUrl(config: CountryMapConfig, lat: number, lon: number): string {
  if (!config.supportsCoordinates) return config.urlTemplate;
  let url = config.urlTemplate;
  if (config.coordinateType === "epsg3857") {
    const { x, y } = wgs84ToEpsg3857(lat, lon);
    url = url.replace(/{x}/g, String(x)).replace(/{y}/g, String(y));
  } else if (config.coordinateType === "epsg2169") {
    const { x, y } = wgs84ToEpsg2169(lat, lon);
    url = url.replace(/{x}/g, String(x)).replace(/{y}/g, String(y));
  } else if (config.coordinateType === "lv95") {
    const { easting, northing } = wgs84ToLV95(lat, lon);
    url = url.replace(/{easting}/g, String(easting)).replace(/{northing}/g, String(northing));
  } else {
    url = url
      .replace(/{lat}/g, lat.toFixed(6))
      .replace(/{lon}/g, lon.toFixed(6))
      .replace(/{lng}/g, lon.toFixed(6));
  }
  return url;
}

const COUNTRY_BOUNDING_BOXES: { iso: string; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
  { iso: "AT", minLat: 46.37, maxLat: 49.02, minLon: 9.53, maxLon: 17.16 },
  { iso: "BE", minLat: 49.49, maxLat: 51.51, minLon: 2.54, maxLon: 6.41 },
  { iso: "CH", minLat: 45.82, maxLat: 47.81, minLon: 5.96, maxLon: 10.49 },
  { iso: "DE", minLat: 47.27, maxLat: 55.06, minLon: 5.87, maxLon: 15.04 },
  { iso: "DK", minLat: 54.56, maxLat: 57.75, minLon: 8.07, maxLon: 15.19 },
  { iso: "EE", minLat: 57.52, maxLat: 59.68, minLon: 21.76, maxLon: 28.21 },
  { iso: "ES", minLat: 35.95, maxLat: 43.79, minLon: -9.3, maxLon: 4.33 },
  { iso: "FR", minLat: 41.33, maxLat: 51.12, minLon: -5.14, maxLon: 9.56 },
  { iso: "GR", minLat: 34.8, maxLat: 41.75, minLon: 19.37, maxLon: 29.65 },
  { iso: "HR", minLat: 42.39, maxLat: 46.55, minLon: 13.49, maxLon: 19.45 },
  { iso: "IT", minLat: 35.49, maxLat: 47.09, minLon: 6.63, maxLon: 18.52 },
  { iso: "LI", minLat: 47.05, maxLat: 47.27, minLon: 9.47, maxLon: 9.64 },
  { iso: "LU", minLat: 49.45, maxLat: 50.18, minLon: 5.73, maxLon: 6.53 },
  { iso: "LV", minLat: 55.67, maxLat: 58.08, minLon: 20.97, maxLon: 28.24 },
  { iso: "NL", minLat: 50.75, maxLat: 53.47, minLon: 3.36, maxLon: 7.21 },
  { iso: "NO", minLat: 57.96, maxLat: 71.19, minLon: 4.64, maxLon: 31.08 },
  { iso: "PL", minLat: 49.0, maxLat: 54.84, minLon: 14.12, maxLon: 24.15 },
  { iso: "PT", minLat: 36.96, maxLat: 42.15, minLon: -9.5, maxLon: -6.19 },
  { iso: "RO", minLat: 43.62, maxLat: 48.27, minLon: 20.26, maxLon: 29.76 },
  { iso: "SE", minLat: 55.34, maxLat: 69.06, minLon: 10.96, maxLon: 24.17 },
  { iso: "SI", minLat: 45.42, maxLat: 46.88, minLon: 13.38, maxLon: 16.61 },
];

export function detectCountryFromCoordinates(lat: number, lon: number): string | null {
  const matches = COUNTRY_BOUNDING_BOXES.filter(
    (b) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  );
  if (matches.length === 0) return null;
  for (const prio of ["LU", "NL", "CH", "DE"]) {
    const m = matches.find((x) => x.iso === prio);
    if (m) return m.iso;
  }
  matches.sort(
    (a, b) =>
      (a.maxLat - a.minLat) * (a.maxLon - a.minLon) -
      (b.maxLat - b.minLat) * (b.maxLon - b.minLon),
  );
  return matches[0].iso;
}
