/**
 * Datenquellen & Lizenzen – zentrale, React-Native-freie Liste aller externen
 * Datenquellen der App (Einstellungen → Datenquellen & Lizenzen).
 *
 * Wo möglich wird die Liste direkt aus dem Code gebaut, damit sie nicht
 * auseinanderläuft:
 *  - Grundkarten/Luftbilder aus COUNTRY_MAP_PROVIDERS + Online-Ersatzkarten
 *    (mapSources.ts), Lizenzen laut docs/offline-karten-quellen.md
 *  - Geozonen aus der Quellen-Registry (client/lib/geozoneSources/registry.ts:
 *    Anbieter, Lizenz, Freigabe, Attributionen je Land); Lizenzen/Freigaben
 *    laut docs/*-integration.md
 *  - Energie-Infrastruktur aus shared/germanEnergyInfrastructure.ts
 *
 * client/lib/__tests__/dataSources.test.ts prüft, dass jede Kartenquelle und
 * jedes Geozonen-Land hier auftaucht.
 */
import {
  COUNTRY_MAP_PROVIDERS,
  FALLBACK_MAP,
  FALLBACK_SATELLITE,
  OFFLINE_APP_COUNTRIES,
  type RasterDef,
} from "./mapSources";
import { GEOZONE_SOURCES } from "./geozoneSources/registry";
import { GEOZONE_LICENCES } from "../../shared/geozoneSourceMeta";
import {
  ENERGY_INFRASTRUCTURE_COUNTRIES,
  getEnergyInfrastructureCountry,
} from "../../shared/germanEnergyInfrastructure";

export const WRITTEN_PERMISSION_TEXT = "Nutzung mit schriftlicher Genehmigung";

export interface DataSourceEntry {
  id: string;
  /** Anbieter / Behörde */
  provider: string;
  /** Wofür die App die Daten nutzt */
  usage: string;
  /** Lizenz bzw. Nutzungsbedingungen */
  license?: string;
  licenseUrl?: string;
  /** Pflicht-Namensnennung, exakt wie in der App angezeigt */
  attributions?: string[];
  /** Nutzung mit schriftlicher Genehmigung/Freigabe des Anbieters */
  writtenPermission?: boolean;
  /** Länder (ISO-3166-Alpha-2), für die die Quelle genutzt wird */
  countries?: string[];
  /** Webseite des Anbieters */
  url?: string;
  note?: string;
}

export interface DataSourceGroup {
  id: string;
  title: string;
  intro?: string;
  entries: DataSourceEntry[];
}

const L = {
  ...GEOZONE_LICENCES,
  ccBySa2: {
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/deed.de",
  },
  odbl: {
    license: "Open Database License (ODbL) 1.0",
    licenseUrl: "https://www.openstreetmap.org/copyright",
  },
  dlDeBy2: {
    license: "Datenlizenz Deutschland – Namensnennung – Version 2.0",
    licenseUrl: "https://www.govdata.de/dl-de/by-2-0",
  },
  swisstopoOgd: {
    license: "swisstopo – kostenlose Geodaten (OGD)",
    licenseUrl:
      "https://www.swisstopo.admin.ch/de/nutzungsbedingungen-kostenlose-geodaten-und-geodienste",
  },
  bsd2: {
    license: "BSD-2-Clause",
    licenseUrl: "https://opensource.org/license/bsd-2-clause",
  },
  bsd3: {
    license: "BSD-3-Clause",
    licenseUrl: "https://opensource.org/license/bsd-3-clause",
  },
  mit: { license: "MIT", licenseUrl: "https://opensource.org/license/mit" },
  apache2: {
    license: "Apache License 2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  },
  ofl: {
    license: "SIL Open Font License 1.1",
    licenseUrl: "https://openfontlicense.org/",
  },
} as const;

/** Deutscher Ländername zu ISO-Code (Fallback: ISO-Code selbst). */
export function countryName(iso: string): string {
  return (
    OFFLINE_APP_COUNTRIES.find((c) => c.iso === iso.toUpperCase())?.label ??
    iso.toUpperCase()
  );
}

// ---------------------------------------------------------------------------
// Grundkarten & Luftbilder
// ---------------------------------------------------------------------------

interface MapSourceMeta {
  /** Gleicher Schlüssel = ein Eintrag (z. B. swisstopo für CH und LI) */
  key: string;
  provider: string;
  license?: string;
  licenseUrl?: string;
  url?: string;
  writtenPermission?: boolean;
  note?: string;
}

/** Metadaten je Kachel-Quelle (RasterDef.id) aus COUNTRY_MAP_PROVIDERS. */
export const MAP_SOURCE_META: Record<string, MapSourceMeta> = {
  "de-basemap": {
    key: "de-basemap",
    provider: "Bundesamt für Kartographie und Geodäsie (BKG) – basemap.de",
    ...L.dlDeBy2,
    url: "https://basemap.de",
  },
  "de-dop-he": {
    key: "de-dop",
    provider:
      "Vermessungsverwaltungen der Länder (GeoBasis-DE): HVBG Hessen, LVermGeo Rheinland-Pfalz, Geobasis NRW, LDBV Bayern",
    license:
      "Datenlizenz Deutschland 2.0 bzw. Open-Data-Lizenz des jeweiligen Landes",
    licenseUrl: "https://www.govdata.de/lizenzen",
  },
  "de-dop-rp": { key: "de-dop", provider: "" },
  "de-dop-nw": { key: "de-dop", provider: "" },
  "de-dop-by": { key: "de-dop", provider: "" },
  "at-basemap": {
    key: "at-basemap",
    provider: "basemap.at (Verwaltungsgrundkarte Österreich)",
    ...L.ccBy4,
    url: "https://basemap.at",
  },
  "at-ortho": { key: "at-basemap", provider: "" },
  "ch-swisstopo": {
    key: "swisstopo",
    provider: "Bundesamt für Landestopografie swisstopo",
    ...L.swisstopoOgd,
    url: "https://www.swisstopo.admin.ch",
  },
  "ch-swissimage": { key: "swisstopo", provider: "" },
  "li-swisstopo": { key: "swisstopo", provider: "" },
  "li-swissimage": { key: "swisstopo", provider: "" },
  "nl-brt": {
    key: "nl-pdok",
    provider:
      "Kadaster / PDOK (BRT-Achtergrondkaart, Beeldmateriaal Nederland)",
    ...L.ccBy4,
    url: "https://www.pdok.nl",
  },
  "nl-luchtfoto": { key: "nl-pdok", provider: "" },
  "fr-planign": {
    key: "fr-ign",
    provider:
      "Institut national de l'information géographique et forestière (IGN) – Géoplateforme",
    ...L.etalab2,
    url: "https://geoservices.ign.fr",
  },
  "fr-ortho": { key: "fr-ign", provider: "" },
  "no-kartverket-topo": {
    key: "no-kartverket",
    provider: "Kartverket (Topografisk Norgeskart)",
    ...L.ccBy4,
    url: "https://www.kartverket.no",
  },
  "es-ignbase": {
    key: "es-ign",
    provider:
      "Instituto Geográfico Nacional de España (IGN) – Mapa base und PNOA",
    ...L.ccBy4,
    url: "https://www.ign.es",
  },
  "es-pnoa": { key: "es-ign", provider: "" },
  "ee-maaamet-kaart": {
    key: "ee-maaamet",
    provider: "Maa- ja Ruumiamet (Estnisches Land- und Raumamt)",
    license:
      "Offene-Daten-Lizenz des Maa- ja Ruumiamet (frei, auch kommerziell, mit Quellenangabe)",
    url: "https://maaruum.ee",
  },
  "ee-maaamet-foto": { key: "ee-maaamet", provider: "" },
  "be-ngi-cartoweb-topo": {
    key: "be-ngi",
    provider:
      "Nationaal Geografisch Instituut / Institut géographique national (NGI/IGN Belgien) – CartoWeb",
    license:
      "CC BY-NC 4.0; Speichern und Kopieren mit schriftlicher Genehmigung des NGI",
    licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/deed.de",
    url: "https://www.ngi.be",
    writtenPermission: true,
  },
  "cz-cuzk-ztm": {
    key: "cz-cuzk",
    provider: "Český úřad zeměměřický a katastrální (ČÚZK)",
    ...L.ccBy4,
    url: "https://cuzk.gov.cz",
  },
  "cz-cuzk-orto": { key: "cz-cuzk", provider: "" },
  "pl-gugik-orto": {
    key: "pl-gugik",
    provider: "Główny Urząd Geodezji i Kartografii (GUGiK) – Geoportal",
    license:
      "Kostenfreie, beliebige Nutzung („dowolne wykorzystanie“) laut geoportal.gov.pl",
    url: "https://www.geoportal.gov.pl",
  },
  "hr-dgu-tk25": {
    key: "hr-dgu",
    provider: "Državna geodetska uprava (DGU) – Geoportal",
    license: "Speichern und Kopieren mit schriftlicher Genehmigung der DGU",
    url: "https://geoportal.dgu.hr",
    writtenPermission: true,
    note: "Auflage: Das Wasserzeichen „GEOPORTAL“ im Orthofoto bleibt sichtbar; Kacheln werden unverändert gespeichert und angezeigt. Pflicht-Namensnennung: © Državna geodetska uprava (DGU).",
  },
  "hr-dgu-dof": { key: "hr-dgu", provider: "" },
  "is-lmi-grunnkort": {
    key: "is-lmi",
    provider: "Náttúrufræðistofnun / Landmælingar Íslands",
    ...L.ccBy4,
    url: "https://www.lmi.is",
  },
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function buildMapEntries(): DataSourceEntry[] {
  const byKey = new Map<string, DataSourceEntry & { kinds: Set<string> }>();
  const firstMeta = new Map<string, MapSourceMeta>();
  for (const m of Object.values(MAP_SOURCE_META))
    if (m.provider && !firstMeta.has(m.key)) firstMeta.set(m.key, m);

  const add = (iso: string, def: RasterDef, kind: string) => {
    const meta = MAP_SOURCE_META[def.id];
    const key = meta?.key ?? def.id;
    const head = firstMeta.get(key);
    let e = byKey.get(key);
    if (!e) {
      e = {
        id: `map-${key}`,
        provider: head?.provider || def.attribution,
        usage: "",
        license: head?.license ?? "Nutzungsbedingungen des Anbieters",
        licenseUrl: head?.licenseUrl,
        url: head?.url,
        writtenPermission: head?.writtenPermission,
        note: head?.note,
        attributions: [],
        countries: [],
        kinds: new Set(),
      };
      byKey.set(key, e);
    }
    e.kinds.add(kind + (def.region ? ` ${def.region}` : ""));
    e.attributions = uniq([...(e.attributions ?? []), def.attribution]);
    e.countries = uniq([...(e.countries ?? []), iso]);
  };

  for (const p of COUNTRY_MAP_PROVIDERS) {
    if (p.map) add(p.iso, p.map, "Karte");
    for (const s of p.satellite ?? []) add(p.iso, s, "Luftbild");
  }
  return Array.from(byKey.values()).map(({ kinds, ...e }) => {
    const k = Array.from(kinds);
    const hasMap = k.some((x) => x.startsWith("Karte"));
    const sats = k.filter((x) => x.startsWith("Luftbild"));
    const regions = sats
      .map((x) => x.replace(/^Luftbild ?/, ""))
      .filter(Boolean);
    const parts: string[] = [];
    if (hasMap) parts.push("Amtliche Grundkarte");
    if (sats.length)
      parts.push(
        regions.length ? `Luftbilder (${regions.join(", ")})` : "Luftbilder",
      );
    return {
      ...e,
      usage: `${parts.join(" und ")} – online und als Offline-Paket speicherbar.`,
    };
  });
}

function buildMapFallbackEntries(): DataSourceEntry[] {
  return [
    {
      id: "map-esri-street",
      provider: "Esri World Street Map (u. a. auf Basis von OpenStreetMap)",
      usage:
        "Online-Ersatzkarte außerhalb der Länder mit amtlicher Karte (nicht offline speicherbar).",
      license: "Esri-Nutzungsbedingungen · OSM-Daten: ODbL 1.0",
      licenseUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
      attributions: [FALLBACK_MAP.attribution],
      url: "https://www.arcgis.com/home/item.html?id=3b93337983e9436f8db950e38a8629af",
    },
    {
      id: "map-esri",
      provider:
        "Esri (World Imagery, World Boundaries and Places, World Light Gray Base)",
      usage:
        "Online-Ersatz-Luftbild, Beschriftungen im Hybrid-Modus und Graustufen-Karte (nicht offline speicherbar).",
      license: "Esri-Nutzungsbedingungen",
      licenseUrl:
        "https://www.esri.com/en-us/legal/terms/full-master-agreement",
      attributions: [FALLBACK_SATELLITE.attribution],
      note: "Bildquellen laut Esri: Esri, Maxar, Earthstar Geographics und die GIS User Community.",
      url: "https://www.esri.com",
    },
    {
      id: "map-osm-tiles",
      provider:
        "OpenStreetMap Foundation (Standard-Kacheln tile.openstreetmap.org)",
      usage:
        "Kartenhintergrund in Standortwahl, Verkehrskarte, Flugprotokoll-Karte und Vorab-Übersicht (nur online).",
      ...L.odbl,
      attributions: ["© OpenStreetMap-Mitwirkende"],
      note: "Kartendarstellung CC BY-SA 2.0; Nutzung gemäß OSM-Tile-Usage-Policy (kein Massen-Download).",
      url: "https://www.openstreetmap.org",
    },
    {
      id: "map-glyphs",
      provider: "MapLibre Demo-Schriften (Open Sans)",
      usage: "Schrift für Höhenangaben an Hindernissen auf der Karte.",
      ...L.ofl,
      url: "https://demotiles.maplibre.org",
    },
  ];
}

// ---------------------------------------------------------------------------
// Geozonen
// ---------------------------------------------------------------------------

interface GeozoneSourceMeta {
  provider: string;
  usage?: string;
  license?: string;
  licenseUrl?: string;
  attributions?: string[];
  writtenPermission?: boolean;
  url?: string;
  note?: string;
  /** Weitere Länder, die dieselbe Quelle nutzen (z. B. LI über CH) */
  alsoCountries?: string[];
}

const ED269_USAGE =
  "Drohnen-Geozonen als Vektordaten (Karte, Flugprüfung, offline speicherbar).";

/**
 * Geozonen-Quellen je Land – abgeleitet aus der Quellen-Registry (einzige
 * Quelle für Anbieter, Lizenz, Freigabe, Attribution; Lizenzen/Freigaben laut
 * docs/*-integration.md).
 */
export const GEOZONE_SOURCE_META: Record<string, GeozoneSourceMeta> = Object.fromEntries(
  GEOZONE_SOURCES.map((src) => [
    src.iso,
    {
      provider: src.provider,
      usage: src.usage,
      license: src.license,
      licenseUrl: src.licenseUrl,
      attributions: src.attributions,
      writtenPermission: src.writtenPermission || undefined,
      url: src.url,
      note: src.note,
      alsoCountries: src.aliases,
    },
  ]),
);

/** Alle Länder, für die die App Geozonen aus externen Quellen lädt (inkl. Aliase wie LI). */
export function geozoneCountries(): string[] {
  return uniq(GEOZONE_SOURCES.flatMap((src) => [src.iso, ...(src.aliases ?? [])]));
}

function buildGeozoneEntries(): DataSourceEntry[] {
  const out: DataSourceEntry[] = [];
  const done = new Set<string>();
  // Reihenfolge: zuerst DE, dann alphabetisch nach deutschem Ländernamen
  const isos = geozoneCountries()
    .filter(
      (iso) =>
        GEOZONE_SOURCE_META[iso] ||
        !Object.values(GEOZONE_SOURCE_META).some((m) =>
          m.alsoCountries?.includes(iso),
        ),
    )
    .sort((a, b) =>
      a === "DE"
        ? -1
        : b === "DE"
          ? 1
          : countryName(a).localeCompare(countryName(b), "de"),
    );
  for (const iso of isos) {
    if (done.has(iso)) continue;
    const m = GEOZONE_SOURCE_META[iso];
    const countries = uniq([iso, ...(m?.alsoCountries ?? [])]);
    countries.forEach((c) => done.add(c));
    out.push({
      id: `geo-${iso.toLowerCase()}`,
      provider: m?.provider ?? iso,
      usage: m?.usage ?? ED269_USAGE,
      license:
        m?.license ??
        (m?.writtenPermission
          ? "Nutzungsbedingungen laut Freigabe des Anbieters"
          : "Nutzungsbedingungen des Anbieters"),
      licenseUrl: m?.licenseUrl,
      attributions: uniq(m?.attributions ?? []),
      writtenPermission: m?.writtenPermission,
      countries,
      url: m?.url,
      note: m?.note,
    });
  }
  out.push(
    {
      id: "geo-nl-pdok",
      provider:
        "PDOK (LVNL-Flugverbotszonen, Natura 2000 / RVO, Natuurnetwerk Nederland / Provinzen)",
      usage:
        "Zusätzliche Kartenebenen für die Niederlande (Naturschutz, Landeplätze).",
      license: "Offene PDOK-Daten (CC0 bzw. CC BY 4.0 je Datensatz)",
      licenseUrl: "https://www.pdok.nl/introductie",
      countries: ["NL"],
      url: "https://www.pdok.nl",
    },
    {
      id: "geo-lu-wms",
      provider: "Geoportail Luxembourg (WMS)",
      usage: "Abschaltbare Zusatz-Ebenen für Luxemburg.",
      ...L.cc0,
      countries: ["LU"],
      url: "https://map.geoportail.lu",
    },
    {
      id: "geo-de-bfn",
      provider: "Bundesamt für Naturschutz (BfN) – Geodienste Schutzgebiete",
      usage: "Naturschutzgebiete-Karte (Deutschland).",
      license: "Nutzungsbedingungen der BfN-Geodienste",
      licenseUrl: "https://geodienste.bfn.de",
      countries: ["DE"],
      url: "https://geodienste.bfn.de",
    },
    {
      id: "geo-de-lfa",
      provider: "Bundeswehr / Luftwaffe – militärische Tieffluggebiete (LFA)",
      usage:
        "In der App gebündelte Umrisse der Tieffluggebiete (Deutschland), Aktivierung über dipul.",
      license: "Amtliche Veröffentlichung der Luftwaffe",
      countries: ["DE"],
      url: "https://www.bundeswehr.de",
    },
  );
  return out;
}

// ---------------------------------------------------------------------------
// Energie-Infrastruktur (aus shared/germanEnergyInfrastructure.ts)
// ---------------------------------------------------------------------------

function buildEnergyEntries(): DataSourceEntry[] {
  const byId = new Map<string, DataSourceEntry>();
  for (const iso of ENERGY_INFRASTRUCTURE_COUNTRIES) {
    const c = getEnergyInfrastructureCountry(iso);
    if (!c) continue;
    for (const s of c.dataSources) {
      if (s.referenceOnly || s.id === "openStreetMap") continue;
      const prev = byId.get(s.id);
      if (prev) {
        prev.countries = uniq([...(prev.countries ?? []), c.iso]);
        continue;
      }
      byId.set(s.id, {
        id: `energy-${s.id}`,
        provider: s.label,
        usage: `Windkraftanlagen und Stromleitungen (Abgleich/Anzeige). ${s.coverage}`,
        license: s.license,
        countries: [c.iso],
        url: s.url,
      });
    }
  }
  return Array.from(byId.values());
}

// ---------------------------------------------------------------------------
// Gesamtliste
// ---------------------------------------------------------------------------

export function getDataSourceGroups(): DataSourceGroup[] {
  return [
    {
      id: "maps",
      title: "Grundkarten & Luftbilder",
      intro:
        "Amtliche Karten und Luftbilder der Vermessungsämter (offline speicherbar) sowie Online-Ersatzkarten.",
      entries: [...buildMapEntries(), ...buildMapFallbackEntries()],
    },
    {
      id: "geozones",
      title: "Geozonen",
      intro:
        "UAS-Geozonen der zuständigen Behörden und Flugsicherungen je Land. Maßgeblich bleiben die amtlichen Angaben der Behörde.",
      entries: buildGeozoneEntries(),
    },
    {
      id: "obstacles",
      title: "Hindernisse & Infrastruktur",
      entries: [
        {
          id: "osm-overpass",
          provider:
            "OpenStreetMap-Mitwirkende (Abruf über die Overpass-API: overpass-api.de, overpass.kumi.systems, overpass.private.coffee)",
          usage:
            "Hindernisse auf der Karte (Stromleitungen, Windräder, Masten, Türme, Schornsteine, Bahnstrecken) und Energie-Infrastruktur.",
          ...L.odbl,
          attributions: ["© OpenStreetMap contributors"],
          url: "https://www.openstreetmap.org/copyright",
        },
        ...buildEnergyEntries(),
      ],
    },
    {
      id: "geocoding",
      title: "Ortssuche",
      entries: [
        {
          id: "nominatim",
          provider: "Nominatim (OpenStreetMap Foundation)",
          usage: "Ortssuche und Ermittlung von Ort/Land zu einer Position.",
          ...L.odbl,
          attributions: ["© OpenStreetMap contributors"],
          note: "Nutzung gemäß Nominatim Usage Policy.",
          url: "https://nominatim.org",
        },
      ],
    },
    {
      id: "weather",
      title: "Wetter, Flugwetter & Weltraumwetter",
      entries: [
        {
          id: "open-meteo",
          provider: "Open-Meteo",
          usage:
            "Wettervorhersage (Wind, Böen, Temperatur, Sicht, Niederschlag) und Geländehöhe.",
          ...L.ccBy4,
          attributions: ["Weather data by Open-Meteo.com"],
          url: "https://open-meteo.com",
        },
        {
          id: "brightsky",
          provider: "Bright Sky (Daten des Deutschen Wetterdienstes)",
          usage: "Wetterdaten für Deutschland.",
          license:
            "DWD-Daten: Nutzungsbedingungen des Deutschen Wetterdienstes",
          licenseUrl: "https://www.dwd.de/copyright",
          attributions: ["Quelle: Deutscher Wetterdienst"],
          url: "https://brightsky.dev",
        },
        {
          id: "dfs-weather",
          provider: "DFS Deutsche Flugsicherung – UTM-Wetterdienst (dipul)",
          usage:
            "Aktuelles Wetter in den Einstellungen und der Flugvorbereitung (Deutschland).",
          license: "Nutzungsbedingungen der DFS",
          url: "https://www.dipul.de",
        },
        {
          id: "awc",
          provider:
            "NOAA / National Weather Service – Aviation Weather Center (aviationweather.gov)",
          usage:
            "METAR und TAF der Flughäfen (Flughafen-Wetter auf der Karte).",
          license: "Gemeinfrei (U.S. Government Work)",
          url: "https://aviationweather.gov",
        },
        {
          id: "swpc",
          provider: "NOAA Space Weather Prediction Center",
          usage:
            "Kp-Index (geomagnetische Aktivität, GPS-Störungen) und Vorhersage.",
          license: "Gemeinfrei (U.S. Government Work)",
          url: "https://www.swpc.noaa.gov",
        },
      ],
    },
    {
      id: "notams",
      title: "NOTAMs",
      entries: [
        {
          id: "autorouter",
          provider: "autorouter.aero (Garmin)",
          usage: "NOTAMs im Umkreis des Flugortes.",
          license: "Nutzungsbedingungen von autorouter",
          licenseUrl: "https://www.autorouter.aero",
          url: "https://www.autorouter.aero",
        },
      ],
    },
    {
      id: "traffic",
      title: "Live-Flugverkehr",
      intro:
        "Öffentliche ADS-B- und FLARM-Empfängernetze sowie Flightradar24; nur zur Information, kein Kollisionswarnsystem.",
      entries: [
        {
          id: "adsbfi",
          provider: "adsb.fi",
          usage: "ADS-B-Flugverkehr in der Umgebung.",
          license: "Nutzungsbedingungen von adsb.fi (Open Data)",
          url: "https://adsb.fi",
        },
        {
          id: "adsbone",
          provider: "ADSB One",
          usage: "ADS-B-Flugverkehr in der Umgebung.",
          license: "Nutzungsbedingungen von ADSB One",
          url: "https://adsb.one",
        },
        {
          id: "airplaneslive",
          provider: "airplanes.live",
          usage: "ADS-B-Flugverkehr in der Umgebung.",
          license: "Nutzungsbedingungen von airplanes.live",
          url: "https://airplanes.live",
        },
        {
          id: "adsblol",
          provider: "adsb.lol",
          usage: "ADS-B-Flugverkehr in der Umgebung.",
          ...L.odbl,
          licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
          url: "https://adsb.lol",
        },
        {
          id: "ogn",
          provider: "Open Glider Network (OGN)",
          usage:
            "FLARM/OGN-Positionen von Segelflugzeugen, Gleitschirmen u. a.",
          license: "OGN-Datennutzungsregeln",
          licenseUrl: "https://www.glidernet.org",
          attributions: ["Open Glider Network"],
          url: "https://live.glidernet.org",
        },
        {
          id: "fr24",
          provider: "Flightradar24 AB",
          usage:
            "Zusätzliche Live-Flugpositionen (ADS-B, MLAT, FLARM, geschätzt) aus dem Web-Feed von Flightradar24.",
          license: "Nutzung mit Zustimmung von Flightradar24",
          attributions: ["Flightradar24"],
          url: "https://www.flightradar24.com",
          note:
            "Kostenlose Nutzung des öffentlichen Web-Feeds mit Zustimmung von Flightradar24 (keine bezahlte API).",
        },
      ],
    },
    {
      id: "rules",
      title: "Regelwerke",
      entries: [
        {
          id: "easa",
          provider: "European Union Aviation Safety Agency (EASA)",
          usage:
            "Easy Access Rules for Unmanned Aircraft Systems (in der App gebündelt) und EU-Drohnenregeln.",
          license: "Wiedergabe mit Quellenangabe gestattet (EASA Legal Notice)",
          licenseUrl: "https://www.easa.europa.eu/en/legal-notice",
          attributions: ["EASA — European Union Aviation Safety Agency"],
          url: "https://www.easa.europa.eu/en/document-library/easy-access-rules",
        },
        {
          id: "eurlex",
          provider: "Amt für Veröffentlichungen der EU – EUR-Lex",
          usage:
            "Verweise auf die Durchführungsverordnung (EU) 2019/947 und weitere Rechtstexte.",
          license: "© Europäische Union, Weiterverwendung gestattet",
          licenseUrl:
            "https://eur-lex.europa.eu/content/legal-notice/legal-notice.html",
          url: "https://eur-lex.europa.eu",
        },
        {
          id: "hoverpoint",
          provider: "Hoverpoint (web.hoverpoint.info)",
          usage:
            "Drohnen-Katalogdaten (Maße und Grenzwerte), weltweite Länder-Regeln, Landesluftfahrtbehörden sowie NOTAM- und Zonen-Begriffe.",
          writtenPermission: true,
          attributions: ["Hoverpoint – mit Zustimmung des Erstellers"],
          url: "https://web.hoverpoint.info",
          note: "Datenübernahme mit Zustimmung des App-Erstellers (2026-11-17). Verbindlich bleiben stets die jeweils verlinkten offiziellen Stellen.",
        },
      ],
    },
    {
      id: "services",
      title: "Weitere Dienste",
      entries: [
        {
          id: "qrserver",
          provider: "goQR.me (api.qrserver.com)",
          usage: "QR-Code im druckbaren „Drohne gefunden“-Etikett.",
          license: "Nutzungsbedingungen von goQR.me",
          licenseUrl: "https://goqr.me/api/",
          url: "https://goqr.me",
        },
        {
          id: "cdnjs",
          provider: "cdnjs (Cloudflare)",
          usage:
            "Auslieferung von pdf.js zur Anzeige von PDF-Dokumenten in der App.",
          license: "Nutzungsbedingungen von cdnjs",
          licenseUrl: "https://cdnjs.com",
          url: "https://cdnjs.com",
        },
      ],
    },
    {
      id: "libraries",
      title: "Software-Bibliotheken",
      entries: [
        {
          id: "lib-leaflet",
          provider: "Leaflet 1.9.4 (© Volodymyr Agafonkin, CloudMade)",
          usage: "Interaktive Karten in der App (gebündelt).",
          ...L.bsd2,
          url: "https://leafletjs.com",
        },
        {
          id: "lib-maplibre",
          provider: "MapLibre Native / @maplibre/maplibre-react-native",
          usage: "Kartendarstellung und Offline-Kachelspeicher.",
          license:
            "BSD-2-Clause (MapLibre Native) / MIT (React-Native-Anbindung)",
          licenseUrl:
            "https://github.com/maplibre/maplibre-native/blob/main/LICENSE.md",
          url: "https://maplibre.org",
        },
        {
          id: "lib-pdfjs",
          provider: "pdf.js (Mozilla)",
          usage: "Anzeige von PDF-Dokumenten.",
          ...L.apache2,
          url: "https://mozilla.github.io/pdf.js/",
        },
        {
          id: "lib-fflate",
          provider: "fflate",
          usage: "Komprimierung des Offline-Geozonen-Speichers, ZIP-Entpacken.",
          ...L.mit,
          url: "https://github.com/101arrowz/fflate",
        },
        {
          id: "lib-metar",
          provider: "metar-taf-parser",
          usage: "Dekodierung von METAR/TAF.",
          ...L.mit,
          url: "https://github.com/mivek/MetarTAFParser",
        },
        {
          id: "lib-forge",
          provider: "node-forge",
          usage: "Verschlüsselung bei der d-flight-Anmeldung.",
          license: "BSD-3-Clause oder GPL-2.0",
          licenseUrl:
            "https://github.com/digitalbazaar/forge/blob/main/LICENSE",
          url: "https://github.com/digitalbazaar/forge",
        },
        {
          id: "lib-qrcode",
          provider: "react-native-qrcode-svg",
          usage: "QR-Codes in der App.",
          ...L.mit,
          url: "https://github.com/awesomejerry/react-native-qrcode-svg",
        },
        {
          id: "lib-rn",
          provider:
            "React, React Native, Expo, React Navigation, TanStack Query",
          usage: "App-Grundlage.",
          ...L.mit,
          url: "https://reactnative.dev",
        },
        {
          id: "lib-feather",
          provider: "Feather Icons (über @expo/vector-icons)",
          usage: "Symbole der Benutzeroberfläche.",
          ...L.mit,
          url: "https://feathericons.com",
        },
      ],
    },
  ];
}
