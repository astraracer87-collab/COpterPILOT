export interface CountryMapConfig {
  iso: string;
  name: string;
  nameDE: string;
  urlTemplate: string;
  supportsCoordinates: boolean;
  coordinateType?: "wgs84" | "epsg2169" | "epsg3857" | "lv95";
}

function wgs84ToEpsg3857(lat: number, lon: number): { x: number; y: number } {
  const x = lon * 20037508.34 / 180;
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  y = y * 20037508.34 / 180;
  return { x: Math.round(x), y: Math.round(y) };
}

function wgs84ToEpsg2169(lat: number, lon: number): { x: number; y: number } {
  const x = 699003 + (lon - 6.13) * 73000;
  const y = 6414253 + (lat - 49.75) * 111000;
  return { x: Math.round(x), y: Math.round(y) };
}

function wgs84ToLV95(lat: number, lon: number): { easting: number; northing: number } {
  const phi = lat * Math.PI / 180;
  const lambda = lon * Math.PI / 180;
  const phi0 = 46.9524056 * Math.PI / 180;
  const lambda0 = 7.4395833 * Math.PI / 180;
  const phiDiff = (phi - phi0) * 10000;
  const lambdaDiff = (lambda - lambda0) * 10000;
  const easting = 2600000 + 211455.93 * lambdaDiff - 10938.51 * lambdaDiff * phiDiff - 0.36 * lambdaDiff * phiDiff * phiDiff - 44.54 * lambdaDiff * lambdaDiff * lambdaDiff;
  const northing = 1200000 + 308807.95 * phiDiff + 3745.25 * lambdaDiff * lambdaDiff + 76.63 * phiDiff * phiDiff - 194.56 * lambdaDiff * lambdaDiff * phiDiff + 119.79 * phiDiff * phiDiff * phiDiff;
  return { easting: Math.round(easting), northing: Math.round(northing) };
}

export const COUNTRY_MAPS: CountryMapConfig[] = [
  {
    iso: "DE",
    name: "Germany",
    nameDE: "Deutschland",
    urlTemplate: "https://maptool-dipul.dfs.de/geozones/@{lon},{lat},1000r?language=de&zoom=11",
    supportsCoordinates: true,
    coordinateType: "wgs84",
  },
  {
    iso: "AT",
    name: "Austria",
    nameDE: "Österreich",
    urlTemplate: "https://utm.dronespace.at/avm/#p=12/{lat}/{lon}",
    supportsCoordinates: true,
    coordinateType: "wgs84",
  },
  {
    iso: "BE",
    name: "Belgium",
    nameDE: "Belgien",
    urlTemplate: "https://map.droneguide.be/",
    supportsCoordinates: false,
  },
  {
    iso: "CH",
    name: "Switzerland",
    nameDE: "Schweiz",
    urlTemplate: "https://map.geo.admin.ch/#/map?lang=de&center={easting},{northing}&z=9",
    supportsCoordinates: true,
    coordinateType: "lv95",
  },
  {
    iso: "DK",
    name: "Denmark",
    nameDE: "Dänemark",
    urlTemplate: "https://www.en.droneregler.dk/uas-geographical-zones",
    supportsCoordinates: false,
  },
  {
    iso: "EE",
    name: "Estonia",
    nameDE: "Estland",
    urlTemplate: "https://utm.eans.ee/avm/#p=12/{lat}/{lon}",
    supportsCoordinates: true,
    coordinateType: "wgs84",
  },
  {
    iso: "ES",
    name: "Spain",
    nameDE: "Spanien",
    urlTemplate: "https://drones.enaire.es/",
    supportsCoordinates: false,
  },
  {
    iso: "FR",
    name: "France",
    nameDE: "Frankreich",
    urlTemplate: "https://www.geoportail.gouv.fr/",
    supportsCoordinates: false,
  },
  {
    iso: "GR",
    name: "Greece",
    nameDE: "Griechenland",
    urlTemplate: "https://dagr.hasp.gov.gr/",
    supportsCoordinates: false,
  },
  {
    iso: "HR",
    name: "Croatia",
    nameDE: "Kroatien",
    urlTemplate: "https://amc-en.crocontrol.hr/Current-situation-anonymous-users",
    supportsCoordinates: false,
  },
  {
    iso: "IT",
    name: "Italy",
    nameDE: "Italien",
    urlTemplate: "https://www.d-flight.it/",
    supportsCoordinates: false,
  },
  {
    iso: "LI",
    name: "Liechtenstein",
    nameDE: "Liechtenstein",
    urlTemplate: "https://map.geo.admin.ch/#/map?lang=de&center={easting},{northing}&z=9",
    supportsCoordinates: true,
    coordinateType: "lv95",
  },
  {
    iso: "LU",
    name: "Luxembourg",
    nameDE: "Luxemburg",
    urlTemplate: "https://map.geoportail.lu/theme/main?lang=de&version=3&zoom=12&X={x}&Y={y}",
    supportsCoordinates: true,
    coordinateType: "epsg2169",
  },
  {
    iso: "LV",
    name: "Latvia",
    nameDE: "Lettland",
    urlTemplate: "https://www.airspace.lv/",
    supportsCoordinates: false,
  },
  {
    iso: "NL",
    name: "Netherlands",
    nameDE: "Niederlande",
    urlTemplate: "https://map.godrone.nl/#loc={lat},{lon},13",
    supportsCoordinates: true,
    coordinateType: "wgs84",
  },
  {
    iso: "NO",
    name: "Norway",
    nameDE: "Norwegen",
    urlTemplate: "https://nsm.geodataonline.no/",
    supportsCoordinates: false,
  },
  {
    iso: "PL",
    name: "Poland",
    nameDE: "Polen",
    urlTemplate: "https://dronemap.pansa.pl/",
    supportsCoordinates: false,
  },
  {
    iso: "PT",
    name: "Portugal",
    nameDE: "Portugal",
    urlTemplate: "https://dnt.anac.pt/mapa.html",
    supportsCoordinates: false,
  },
  {
    iso: "RO",
    name: "Romania",
    nameDE: "Rumänien",
    urlTemplate: "https://flightplan.romatsa.ro/init/drones",
    supportsCoordinates: false,
  },
  {
    iso: "SE",
    name: "Sweden",
    nameDE: "Schweden",
    urlTemplate: "https://daim.lfv.se/echarts/dronechart/?x={x}&y={y}&z=10",
    supportsCoordinates: true,
    coordinateType: "epsg3857",
  },
  {
    iso: "SI",
    name: "Slovenia",
    nameDE: "Slowenien",
    urlTemplate: "https://caa-slovenia.maps.arcgis.com/",
    supportsCoordinates: false,
  },
];

export function getCountryMapConfig(isoCode: string): CountryMapConfig | undefined {
  return COUNTRY_MAPS.find((c) => c.iso === isoCode.toUpperCase());
}

/**
 * Standard-Mittelpunkt eines Landes (WGS84) für Karten-Zentrierung,
 * wenn keine GPS-Position verfügbar ist.
 */
const COUNTRY_DEFAULT_CENTER: Record<string, { lat: number; lon: number; latDelta: number; lonDelta: number }> = {
  DE: { lat: 51.1657, lon: 10.4515, latDelta: 7.5, lonDelta: 8.5 },
  AT: { lat: 47.5162, lon: 14.5501, latDelta: 3.0, lonDelta: 5.5 },
  CH: { lat: 46.8182, lon: 8.2275, latDelta: 2.5, lonDelta: 4.5 },
  FR: { lat: 46.2276, lon: 2.2137, latDelta: 8.0, lonDelta: 9.0 },
  IT: { lat: 41.8719, lon: 12.5674, latDelta: 8.0, lonDelta: 7.0 },
  ES: { lat: 40.4637, lon: -3.7492, latDelta: 7.5, lonDelta: 9.0 },
  NL: { lat: 52.1326, lon: 5.2913, latDelta: 2.5, lonDelta: 3.5 },
  BE: { lat: 50.5039, lon: 4.4699, latDelta: 1.8, lonDelta: 3.0 },
  DK: { lat: 56.2639, lon: 9.5018, latDelta: 4.0, lonDelta: 6.0 },
  IE: { lat: 53.1424, lon: -7.6921, latDelta: 4.0, lonDelta: 5.5 },
  PL: { lat: 51.9194, lon: 19.1451, latDelta: 5.5, lonDelta: 8.0 },
  CZ: { lat: 49.8175, lon: 15.473, latDelta: 2.8, lonDelta: 5.0 },
  PT: { lat: 39.3999, lon: -8.2245, latDelta: 5.0, lonDelta: 4.0 },
  GR: { lat: 39.0742, lon: 21.8243, latDelta: 6.0, lonDelta: 7.0 },
  FI: { lat: 61.9241, lon: 25.7482, latDelta: 9.0, lonDelta: 10.0 },
  SE: { lat: 60.1282, lon: 18.6435, latDelta: 11.0, lonDelta: 10.0 },
  NO: { lat: 60.472, lon: 8.4689, latDelta: 12.0, lonDelta: 12.0 },
  LU: { lat: 49.8153, lon: 6.1296, latDelta: 0.8, lonDelta: 1.2 },
  EE: { lat: 58.5953, lon: 25.0136, latDelta: 2.5, lonDelta: 4.5 },
  LV: { lat: 56.8796, lon: 24.6032, latDelta: 2.5, lonDelta: 5.0 },
  HR: { lat: 45.1, lon: 15.2, latDelta: 3.0, lonDelta: 5.0 },
  RO: { lat: 45.9432, lon: 24.9668, latDelta: 4.5, lonDelta: 7.0 },
  SI: { lat: 46.1512, lon: 14.9955, latDelta: 1.5, lonDelta: 3.0 },
  LI: { lat: 47.166, lon: 9.5554, latDelta: 0.5, lonDelta: 0.8 },
};

export function getCountryDefaultCenter(isoCode: string | null | undefined): { lat: number; lon: number; latDelta: number; lonDelta: number } {
  if (!isoCode) return COUNTRY_DEFAULT_CENTER.DE;
  return COUNTRY_DEFAULT_CENTER[isoCode.toUpperCase()] ?? COUNTRY_DEFAULT_CENTER.DE;
}

export function buildMapUrl(config: CountryMapConfig, lat: number, lon: number): string {
  if (!config.supportsCoordinates) {
    return config.urlTemplate;
  }

  let url = config.urlTemplate;

  if (config.coordinateType === "epsg3857") {
    const { x, y } = wgs84ToEpsg3857(lat, lon);
    url = url.replace(/{x}/g, x.toString()).replace(/{y}/g, y.toString());
  } else if (config.coordinateType === "epsg2169") {
    const { x, y } = wgs84ToEpsg2169(lat, lon);
    url = url.replace(/{x}/g, x.toString()).replace(/{y}/g, y.toString());
  } else if (config.coordinateType === "lv95") {
    const { easting, northing } = wgs84ToLV95(lat, lon);
    url = url.replace(/{easting}/g, easting.toString()).replace(/{northing}/g, northing.toString());
  } else {
    url = url
      .replace(/{lat}/g, lat.toFixed(6))
      .replace(/{lon}/g, lon.toFixed(6))
      .replace(/{lng}/g, lon.toFixed(6));
  }

  return url;
}

export function getDefaultMapConfig(): CountryMapConfig {
  return COUNTRY_MAPS[0];
}

interface CountryBoundingBox {
  iso: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const COUNTRY_BOUNDING_BOXES: CountryBoundingBox[] = [
  { iso: "AT", minLat: 46.37, maxLat: 49.02, minLon: 9.53, maxLon: 17.16 },
  { iso: "BE", minLat: 49.49, maxLat: 51.51, minLon: 2.54, maxLon: 6.41 },
  { iso: "CH", minLat: 45.82, maxLat: 47.81, minLon: 5.96, maxLon: 10.49 },
  { iso: "DE", minLat: 47.27, maxLat: 55.06, minLon: 5.87, maxLon: 15.04 },
  { iso: "DK", minLat: 54.56, maxLat: 57.75, minLon: 8.07, maxLon: 15.19 },
  { iso: "EE", minLat: 57.52, maxLat: 59.68, minLon: 21.76, maxLon: 28.21 },
  { iso: "ES", minLat: 35.95, maxLat: 43.79, minLon: -9.30, maxLon: 4.33 },
  { iso: "FR", minLat: 41.33, maxLat: 51.12, minLon: -5.14, maxLon: 9.56 },
  { iso: "GR", minLat: 34.80, maxLat: 41.75, minLon: 19.37, maxLon: 29.65 },
  { iso: "HR", minLat: 42.39, maxLat: 46.55, minLon: 13.49, maxLon: 19.45 },
  { iso: "IT", minLat: 35.49, maxLat: 47.09, minLon: 6.63, maxLon: 18.52 },
  { iso: "LI", minLat: 47.05, maxLat: 47.27, minLon: 9.47, maxLon: 9.64 },
  { iso: "LU", minLat: 49.45, maxLat: 50.18, minLon: 5.73, maxLon: 6.53 },
  { iso: "LV", minLat: 55.67, maxLat: 58.08, minLon: 20.97, maxLon: 28.24 },
  { iso: "NL", minLat: 50.75, maxLat: 53.47, minLon: 3.36, maxLon: 7.21 },
  { iso: "NO", minLat: 57.96, maxLat: 71.19, minLon: 4.64, maxLon: 31.08 },
  { iso: "PL", minLat: 49.00, maxLat: 54.84, minLon: 14.12, maxLon: 24.15 },
  { iso: "PT", minLat: 36.96, maxLat: 42.15, minLon: -9.50, maxLon: -6.19 },
  { iso: "RO", minLat: 43.62, maxLat: 48.27, minLon: 20.26, maxLon: 29.76 },
  { iso: "SE", minLat: 55.34, maxLat: 69.06, minLon: 10.96, maxLon: 24.17 },
  { iso: "SI", minLat: 45.42, maxLat: 46.88, minLon: 13.38, maxLon: 16.61 },
];

const PRIORITY_COUNTRIES = ["LU", "NL", "CH", "DE"];

const REFINED_BOUNDARIES: { iso: string; check: (lat: number, lon: number) => boolean }[] = [
  {
    iso: "LU",
    check: (lat, lon) => lat >= 49.45 && lat <= 50.18 && lon >= 5.73 && lon <= 6.53,
  },
  {
    iso: "NL",
    check: (lat, lon) => {
      if (lat < 50.75 || lat > 53.47 || lon < 3.36 || lon > 7.21) return false;
      if (lat >= 51.55) return true;
      if (lat >= 51.0 && lon <= 6.25) return true;
      if (lat >= 50.75 && lon <= 6.05) return true;
      return false;
    },
  },
  {
    iso: "DE",
    check: (lat, lon) => {
      if (lat < 47.27 || lat > 55.06 || lon < 5.87 || lon > 15.04) return false;
      if (lat >= 47.81) return true;
      if (lat >= 47.55 && lon >= 7.5 && lon <= 13.9) return true;
      if (lat >= 47.27 && lon >= 10.2 && lon <= 13.9) return true;
      return false;
    },
  },
  {
    iso: "CH",
    check: (lat, lon) => lat >= 45.82 && lat <= 47.81 && lon >= 5.96 && lon <= 10.49,
  },
];

export function detectCountryFromCoordinates(lat: number, lon: number): string | null {
  for (const refined of REFINED_BOUNDARIES) {
    if (refined.check(lat, lon)) {
      return refined.iso;
    }
  }

  const matches: { iso: string; area: number }[] = [];
  
  for (const box of COUNTRY_BOUNDING_BOXES) {
    if (lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon) {
      const area = (box.maxLat - box.minLat) * (box.maxLon - box.minLon);
      matches.push({ iso: box.iso, area });
    }
  }
  
  if (matches.length === 0) return null;

  for (const prio of PRIORITY_COUNTRIES) {
    if (matches.find(m => m.iso === prio)) return prio;
  }
  
  matches.sort((a, b) => a.area - b.area);
  return matches[0].iso;
}

export interface CountryCenter {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export async function reverseGeocodeCountry(lat: number, lon: number): Promise<string | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=3&accept-language=en`,
      {
        headers: {
          "User-Agent": "DronePreFlightApp/1.0",
        },
      }
    );
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    const countryCode = data?.address?.country_code?.toUpperCase();
    
    if (countryCode) {
      const ISO_ALIASES: Record<string, string> = {
        UK: "GB",
        EL: "GR",
      };
      return ISO_ALIASES[countryCode] || countryCode;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

export function getCountryCenter(isoCode: string): CountryCenter {
  const box = COUNTRY_BOUNDING_BOXES.find((b) => b.iso === isoCode.toUpperCase());
  
  if (!box) {
    return {
      latitude: 51.1657,
      longitude: 10.4515,
      latitudeDelta: 6,
      longitudeDelta: 6,
    };
  }
  
  const latitude = (box.minLat + box.maxLat) / 2;
  const longitude = (box.minLon + box.maxLon) / 2;
  const latitudeDelta = Math.max((box.maxLat - box.minLat) * 1.2, 0.5);
  const longitudeDelta = Math.max((box.maxLon - box.minLon) * 1.2, 0.5);
  
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

interface BundeslandBBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  priority: number;
}

const BUNDESLAND_BBOXES: BundeslandBBox[] = [
  { name: "Berlin", minLat: 52.34, maxLat: 52.68, minLon: 13.09, maxLon: 13.76, priority: 1 },
  { name: "Hamburg", minLat: 53.39, maxLat: 53.74, minLon: 9.73, maxLon: 10.33, priority: 1 },
  { name: "Bremen", minLat: 53.01, maxLat: 53.61, minLon: 8.48, maxLon: 8.99, priority: 1 },
  { name: "Saarland", minLat: 49.11, maxLat: 49.64, minLon: 6.36, maxLon: 7.41, priority: 2 },
  { name: "Thüringen", minLat: 50.20, maxLat: 51.65, minLon: 9.88, maxLon: 12.65, priority: 3 },
  { name: "Sachsen", minLat: 50.17, maxLat: 51.68, minLon: 11.87, maxLon: 15.04, priority: 3 },
  { name: "Sachsen-Anhalt", minLat: 50.94, maxLat: 53.04, minLon: 10.56, maxLon: 13.19, priority: 3 },
  { name: "Schleswig-Holstein", minLat: 53.36, maxLat: 55.06, minLon: 7.87, maxLon: 11.35, priority: 3 },
  { name: "Mecklenburg-Vorpommern", minLat: 53.11, maxLat: 54.68, minLon: 10.59, maxLon: 14.41, priority: 3 },
  { name: "Hessen", minLat: 49.39, maxLat: 51.66, minLon: 7.77, maxLon: 10.24, priority: 3 },
  { name: "Rheinland-Pfalz", minLat: 48.97, maxLat: 50.94, minLon: 6.11, maxLon: 8.51, priority: 3 },
  { name: "Baden-Württemberg", minLat: 47.53, maxLat: 49.79, minLon: 7.51, maxLon: 10.50, priority: 4 },
  { name: "Bayern", minLat: 47.27, maxLat: 50.56, minLon: 8.98, maxLon: 13.84, priority: 4 },
  { name: "Nordrhein-Westfalen", minLat: 50.32, maxLat: 52.53, minLon: 5.87, maxLon: 9.46, priority: 4 },
  { name: "Niedersachsen", minLat: 51.30, maxLat: 53.89, minLon: 6.65, maxLon: 11.60, priority: 5 },
  { name: "Brandenburg", minLat: 51.36, maxLat: 53.56, minLon: 11.27, maxLon: 14.77, priority: 5 },
];

export function detectBundeslandFromCoordinates(lat: number, lon: number): string | null {
  const matches = BUNDESLAND_BBOXES.filter(
    (b) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.priority - b.priority);

  if (matches.length === 1) return matches[0].name;

  const cityState = matches.find((m) => m.priority === 1);
  if (cityState) return cityState.name;

  let best = matches[0];
  let bestArea = (best.maxLat - best.minLat) * (best.maxLon - best.minLon);
  for (let i = 1; i < matches.length; i++) {
    const area = (matches[i].maxLat - matches[i].minLat) * (matches[i].maxLon - matches[i].minLon);
    if (area < bestArea) {
      best = matches[i];
      bestArea = area;
    }
  }
  return best.name;
}

export function detectAllBundeslaenderInRadius(
  lat: number,
  lon: number,
  radiusKm: number,
): string[] {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLon = lon - lonDelta;
  const maxLon = lon + lonDelta;

  return BUNDESLAND_BBOXES
    .filter(
      (b) =>
        b.minLat <= maxLat &&
        b.maxLat >= minLat &&
        b.minLon <= maxLon &&
        b.maxLon >= minLon,
    )
    .map((b) => b.name);
}
