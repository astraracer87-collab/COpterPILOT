// Geteilte Länder-Karten-Registry für Mobile (client/) und Web (web/).
// Einzige Quelle für COUNTRY_MAPS, EASA_FALLBACK_MAP und die Karten-Hilfen
// (getCountryMapConfig, getMapConfigOrFallback, buildMapUrl), damit beide
// Plattformen exakt dieselben Karten/Deep-Links nutzen. Früher war diese Liste
// in client/lib/countryMaps.ts und web/src/lib/planning/countryMaps.ts dupliziert
// und konnte unbemerkt auseinanderlaufen (iso/urlTemplate/supportsCoordinates/
// coordinateType/iframeable). Ein Parität-Test (web/run-tests.sh) wacht zusätzlich
// darüber, dass kein lokaler Override wieder eingeführt wird.

export interface CountryMapConfig {
  iso: string;
  name: string;
  nameDE: string;
  urlTemplate: string;
  supportsCoordinates: boolean;
  coordinateType?: "wgs84" | "epsg2169" | "epsg3857" | "lv95";
  // Ob das Portal in einem iframe/WebView eingebettet werden darf. Web nutzt
  // dies für die Inline-Einbettung; auf Mobile dient es als Konsistenz-Hinweis
  // (manche Portale blockieren das Framing auch im WebView).
  iframeable: boolean;
}

export function wgs84ToEpsg3857(lat: number, lon: number): { x: number; y: number } {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x: Math.round(x), y: Math.round(y) };
}

export function wgs84ToEpsg2169(lat: number, lon: number): { x: number; y: number } {
  const x = 699003 + (lon - 6.13) * 73000;
  const y = 6414253 + (lat - 49.75) * 111000;
  return { x: Math.round(x), y: Math.round(y) };
}

export function wgs84ToLV95(lat: number, lon: number): { easting: number; northing: number } {
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
  {
    iso: "DE",
    name: "Germany",
    nameDE: "Deutschland",
    urlTemplate: "https://maptool-dipul.dfs.de/geozones/@{lon},{lat},1000r?language=de&zoom=11",
    supportsCoordinates: true,
    coordinateType: "wgs84",
    iframeable: true,
  },
  {
    iso: "AT",
    name: "Austria",
    nameDE: "Österreich",
    urlTemplate: "https://utm.dronespace.at/avm/#p=12/{lat}/{lon}",
    supportsCoordinates: true,
    coordinateType: "wgs84",
    iframeable: true,
  },
  {
    iso: "BE",
    name: "Belgium",
    nameDE: "Belgien",
    urlTemplate: "https://map.droneguide.be/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "CH",
    name: "Switzerland",
    nameDE: "Schweiz",
    urlTemplate: "https://map.geo.admin.ch/#/map?lang=de&center={easting},{northing}&z=9",
    supportsCoordinates: true,
    coordinateType: "lv95",
    iframeable: true,
  },
  {
    iso: "DK",
    name: "Denmark",
    nameDE: "Dänemark",
    urlTemplate: "https://www.en.droneregler.dk/uas-geographical-zones",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "EE",
    name: "Estonia",
    nameDE: "Estland",
    urlTemplate: "https://utm.eans.ee/avm/#p=12/{lat}/{lon}",
    supportsCoordinates: true,
    coordinateType: "wgs84",
    iframeable: true,
  },
  {
    iso: "FI",
    name: "Finland",
    nameDE: "Finnland",
    urlTemplate: "https://aviationmap.fintraffic.fi/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "ES",
    name: "Spain",
    nameDE: "Spanien",
    urlTemplate: "https://drones.enaire.es/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "FR",
    name: "France",
    nameDE: "Frankreich",
    urlTemplate:
      "https://www.geoportail.gouv.fr/donnees/restrictions-uas-categorie-ouverte-et-aeromodelisme",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    // Vereinigtes Königreich: CAA-Seite „Where you can fly“ (Drone Code) mit
    // Verweis auf die offiziellen Karten; keine Koordinaten-Deep-Links.
    iso: "GB",
    name: "United Kingdom",
    nameDE: "Vereinigtes Königreich",
    urlTemplate: "https://register-drones.caa.co.uk/drone-code/where-you-can-fly",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "GR",
    name: "Greece",
    nameDE: "Griechenland",
    urlTemplate: "https://dagr.hasp.gov.gr/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "HR",
    name: "Croatia",
    nameDE: "Kroatien",
    urlTemplate: "https://amc-en.crocontrol.hr/Current-situation-anonymous-users",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "IE",
    name: "Ireland",
    nameDE: "Irland",
    urlTemplate: "https://www.iaa.ie/general-aviation/drones",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "IT",
    name: "Italy",
    nameDE: "Italien",
    urlTemplate: "https://www.d-flight.it/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "LI",
    name: "Liechtenstein",
    nameDE: "Liechtenstein",
    urlTemplate: "https://map.geo.admin.ch/#/map?lang=de&center={easting},{northing}&z=9",
    supportsCoordinates: true,
    coordinateType: "lv95",
    iframeable: true,
  },
  {
    iso: "LT",
    name: "Lithuania",
    nameDE: "Litauen",
    urlTemplate: "https://utm.ans.lt/avm/#p=12/{lat}/{lon}",
    supportsCoordinates: true,
    coordinateType: "wgs84",
    iframeable: false,
  },
  {
    iso: "LU",
    name: "Luxembourg",
    nameDE: "Luxemburg",
    urlTemplate: "https://map.geoportail.lu/theme/main?lang=de&version=3&zoom=12&X={x}&Y={y}",
    supportsCoordinates: true,
    coordinateType: "epsg2169",
    iframeable: true,
  },
  {
    iso: "LV",
    name: "Latvia",
    nameDE: "Lettland",
    urlTemplate: "https://www.airspace.lv/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "NL",
    name: "Netherlands",
    nameDE: "Niederlande",
    urlTemplate: "https://map.godrone.nl/#loc={lat},{lon},13",
    supportsCoordinates: true,
    coordinateType: "wgs84",
    iframeable: true,
  },
  {
    iso: "NO",
    name: "Norway",
    nameDE: "Norwegen",
    urlTemplate: "https://utm.avinor.no/avm/#p=12/{lat}/{lon}",
    supportsCoordinates: true,
    coordinateType: "wgs84",
    iframeable: true,
  },
  {
    iso: "PL",
    name: "Poland",
    nameDE: "Polen",
    urlTemplate: "https://dronemap.pansa.pl/",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "PT",
    name: "Portugal",
    nameDE: "Portugal",
    urlTemplate: "https://dnt.anac.pt/mapa.html",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "RO",
    name: "Romania",
    nameDE: "Rumänien",
    urlTemplate: "https://flightplan.romatsa.ro/init/drones",
    supportsCoordinates: false,
    iframeable: false,
  },
  {
    iso: "SE",
    name: "Sweden",
    nameDE: "Schweden",
    urlTemplate: "https://daim.lfv.se/echarts/dronechart/?x={x}&y={y}&z=10",
    supportsCoordinates: true,
    coordinateType: "epsg3857",
    iframeable: true,
  },
  {
    iso: "SI",
    name: "Slovenia",
    nameDE: "Slowenien",
    urlTemplate: "https://caa-slovenia.maps.arcgis.com/",
    supportsCoordinates: false,
    iframeable: false,
  },
];

export function getCountryMapConfig(isoCode: string): CountryMapConfig | undefined {
  return COUNTRY_MAPS.find((c) => c.iso === isoCode.toUpperCase());
}

// Globaler Rückfall auf das zentrale EASA-Drohnenportal (Liste der nationalen
// Luftfahrtbehörden), wenn für ein Land keine eigene Karte hinterlegt ist. Das
// Portal akzeptiert keine Koordinaten und erlaubt kein Framing.
export const EASA_FALLBACK_MAP: CountryMapConfig = {
  iso: "EASA",
  name: "EASA Drone Portal",
  nameDE: "EASA Drohnen-Portal",
  urlTemplate: "https://www.easa.europa.eu/en/domains/civil-drones/naa",
  supportsCoordinates: false,
  iframeable: false,
};

// Liefert die offizielle Staatskarte für das Land oder – falls keine hinterlegt
// ist – den EASA-Global-Fallback. Niemals undefined, damit Web und Mobile immer
// eine Karte anzeigen können.
export function getMapConfigOrFallback(isoCode: string | null | undefined): CountryMapConfig {
  if (!isoCode) return EASA_FALLBACK_MAP;
  return getCountryMapConfig(isoCode) ?? EASA_FALLBACK_MAP;
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
