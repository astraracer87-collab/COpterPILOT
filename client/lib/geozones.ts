import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCached, setCache, makeCacheKey } from "@/lib/dataCache";

const GEOZONES_KEY = "@preflight/geozone_layers";
const MAP_STYLE_KEY = "@preflight/map_style";

export interface GeozoneLayer {
  id: string;
  wmsLayer: string;
  label: string;
  defaultEnabled: boolean;
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
  { id: "ch_drohnen", wmsLayer: "ch.bazl.einschraenkungen-drohnen", label: "Drohnen-Einschränkungen", defaultEnabled: true },
  { id: "ch_aktivitaetszonen", wmsLayer: "ch.bazl.uas-aktivitaetszonen", label: "UAS-Aktivitätszonen", defaultEnabled: true },
  { id: "ch_bodenrisiko_100", wmsLayer: "ch.bazl.intrinsisches-bodenrisiko_sora_100", label: "Bodenrisiko SORA 100J", defaultEnabled: false },
  { id: "ch_bodenrisiko_200", wmsLayer: "ch.bazl.intrinsisches-bodenrisiko_sora_200", label: "Bodenrisiko SORA 200J", defaultEnabled: false },
  { id: "ch_ruhezonen", wmsLayer: "ch.bazl.landschaftsruhezonen", label: "Landschaftsruhezonen", defaultEnabled: true },
  { id: "ch_wohngebiete", wmsLayer: "ch.bazl.wohngebiete-aulav", label: "Wohngebiete (AuLaV)", defaultEnabled: true },
];

export const LU_GEOZONE_LAYERS: GeozoneLayer[] = [
  { id: "lu_uas_0_50", wmsLayer: "1927", label: "UAS-Zonen 0–50 m", defaultEnabled: true },
  { id: "lu_uas_50_120", wmsLayer: "1928", label: "UAS-Zonen 50–120 m", defaultEnabled: true },
];

export const NL_GEOZONE_LAYERS: GeozoneLayer[] = [
  { id: "nl_no_fly_zones", wmsLayer: "luchtvaartgebieden", label: "Flugverbotszonen (alle)", defaultEnabled: true },
  { id: "nl_no_fly_ohne_natura", wmsLayer: "luchtvaartgebieden_zonder_natura2000", label: "Flugverbotszonen (ohne Natura2000)", defaultEnabled: false },
  { id: "nl_landingsite", wmsLayer: "landingsite", label: "Landeplätze", defaultEnabled: false },
];

export type CountryIsoWithGeozones = "DE" | "CH" | "LU" | "NL";

export interface CountryGeozoneConfig {
  iso: CountryIsoWithGeozones;
  wmsBaseUrl: string;
  wmsVersion: string;
  layers: GeozoneLayer[];
  featureInfoType: "wms-plain" | "rest-json" | "ogc-features" | "wfs-json" | "none";
  restIdentifyUrl?: string;
  restIdentifyLayers?: string[];
  alwaysVisibleLayerIds: string[];
  forceEnabledLayerIds: string[];
}

export const COUNTRY_GEOZONE_CONFIGS: Record<string, CountryGeozoneConfig> = {
  DE: {
    iso: "DE",
    wmsBaseUrl: "https://uas-betrieb.de/geoservices/dipul/wms",
    wmsVersion: "1.1.1",
    layers: GEOZONE_LAYERS,
    featureInfoType: "wms-plain",
    alwaysVisibleLayerIds: ["kontrollzonen", "flugbeschraenkungsgebiete", "temporaere_betriebseinschraenkungen", "flughaefen", "flugplaetze"],
    forceEnabledLayerIds: ["flugplaetze"],
  },
  CH: {
    iso: "CH",
    wmsBaseUrl: "https://wms.geo.admin.ch/",
    wmsVersion: "1.3.0",
    layers: CH_GEOZONE_LAYERS,
    featureInfoType: "rest-json",
    restIdentifyUrl: "https://api3.geo.admin.ch/rest/services/api/MapServer/identify",
    restIdentifyLayers: ["ch.bazl.einschraenkungen-drohnen", "ch.bazl.uas-aktivitaetszonen", "ch.bazl.landschaftsruhezonen"],
    alwaysVisibleLayerIds: ["ch_drohnen", "ch_aktivitaetszonen"],
    forceEnabledLayerIds: ["ch_drohnen"],
  },
  LU: {
    iso: "LU",
    wmsBaseUrl: "https://wms.geoportail.lu/public_map_layers/service",
    wmsVersion: "1.1.1",
    layers: LU_GEOZONE_LAYERS,
    featureInfoType: "ogc-features",
    alwaysVisibleLayerIds: ["lu_uas_0_50", "lu_uas_50_120"],
    forceEnabledLayerIds: ["lu_uas_0_50"],
  },
  NL: {
    iso: "NL",
    wmsBaseUrl: "https://service.pdok.nl/lvnl/drone-no-flyzones/wms/v1_0",
    wmsVersion: "1.3.0",
    layers: NL_GEOZONE_LAYERS,
    featureInfoType: "wfs-json",
    alwaysVisibleLayerIds: ["nl_no_fly_zones"],
    forceEnabledLayerIds: ["nl_no_fly_zones"],
  },
};

export function getCountryGeozoneConfig(countryIso?: string): CountryGeozoneConfig {
  if (countryIso && COUNTRY_GEOZONE_CONFIGS[countryIso.toUpperCase()]) {
    return COUNTRY_GEOZONE_CONFIGS[countryIso.toUpperCase()];
  }
  return COUNTRY_GEOZONE_CONFIGS.DE;
}

export function getCountryGeozoneLayers(countryIso?: string): GeozoneLayer[] {
  return getCountryGeozoneConfig(countryIso).layers;
}

export interface GeozoneContact {
  type: "email" | "phone" | "web";
  label: string;
  value: string;
}

export interface GeozoneRegulatoryInfo {
  title: string;
  referenz: string;
  definition: string;
  abstandsregel: string;
  betriebsvoraussetzung: string;
  hinweis?: string;
  links?: { label: string; url: string }[];
  contacts?: GeozoneContact[];
}

export const GEOZONE_REGULATORY_INFO: Record<string, GeozoneRegulatoryInfo> = {
  kontrollzonen: {
    title: "Kontrollzonen (CTR)",
    referenz: "\u00a7 21h Absatz 3 Nr. 9 LuftVO",
    definition: "Luftraum",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Grunds\u00e4tzlich gilt, dass der Betrieb von unbemannten Luftfahrzeugen in Kontrollzonen (CTR) oder Flugbeschr\u00e4nkungsgebieten (ED-R) nur dann zul\u00e4ssig ist, wenn zuvor bei der entsprechenden Flugverkehrskontrollstelle eine Flugverkehrskontrollfreigabe gem. \u00a7 21 LuftVO eingeholt wurde. Bei CTR kann dies z.B. der Betreiber des Flughafen-Towers sein, bei ED-R ist dies das Bundesaufsichtsamt f\u00fcr Flugsicherung (BAF).",
    hinweis: "Wichtig:\nTrotz Freigabe kann der Flugbetrieb f\u00fcr unbemannte Luftfahrzeuge jederzeit wieder eingestellt werden. Alle bereits erteilten Freigaben verlieren dann sofort ihre G\u00fcltigkeit!\n\nEine Flugverkehrskontrollfreigabe betrifft nur den jeweiligen Luftraum. Eine ggf. erforderliche Genehmigung des Drohnenbetriebs (z.B. aufgrund von Geozonen oder Betrieb in der Speziellen Kategorie) ist weiterhin einzuholen!\n\nF\u00fcr bestimmte CTR und ED-R gibt es Allgemeinverf\u00fcgungen von den Flugverkehrskontrolldiensten. Diese werden in den Nachrichten f\u00fcr Luftfahrer (NfL) ver\u00f6ffentlicht und stellen eine allgemeing\u00fcltige Flugverkehrskontrollfreigabe dar, sofern die darin genannten Bedingungen vollst\u00e4ndig eingehalten werden.\n\nDFS Deutsche Flugsicherung GmbH:\nBerlin Brandenburg, Bremen, Dresden, D\u00fcsseldorf, Erfurt-Weimar, Frankfurt Main, Hamburg, Hannover, K\u00f6ln/Bonn, Leipzig/Halle, M\u00fcnchen, M\u00fcnster/Osnabr\u00fcck, N\u00fcrnberg, Saarbr\u00fccken, Stuttgart\n\nDFS Aviation Services GmbH:\nBraunschweig, Dortmund, Friedrichshafen, Karlsruhe/Baden-Baden, Lahr, Magdeburg-Cochstedt, Memmingen, M\u00f6nchengladbach, Niederrhein, Paderborn-Lippstadt\n\nAustroControl:\nAugsburg, Frankfurt/Hahn, Heringsdorf, L\u00fcbeck, Hof/Plauen, M\u00fcnchen, M\u00fcnster/Osnabr\u00fcck, N\u00fcrnberg, Saarbr\u00fccken, Stuttgart, Kassel/Calden, Sylt\n\nBundesaufsichtsamt f\u00fcr Flugsicherung:\nFlugbeschr\u00e4nkungsgebiet ED-R 146 (Berlin)\n\nTRIAC:\nOberpfaffenhofen",
    links: [
      { label: "NfL 2023-1-2705 (DFS)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-dfs-deutsche-flugsicherung-gmbh-nfl-2023-1-2705.pdf?cid=3b5" },
      { label: "NfL 2022-1-2670 (DFS Aviation Services)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-dfs-aviation-services-gmbh-nfl-2022-1-2670.pdf?cid=3b2" },
      { label: "NfL 2024-1-3081 (AustroControl)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-austro-control-gmbh-nfl-2024-1-3081.pdf?cid=3b6" },
      { label: "NfL 2024-1-3127 (BAF ED-R 146 Berlin)", url: "https://dipul.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ed-r-146-berlin-zur-erteilung-von-durchfluggenehmigungen-nfl-2024-1-3127.pdf?cid=3be" },
      { label: "NfL 2024-1-3082 (TRIAC Oberpfaffenhofen)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/allgemeinverfuegung-uas-in-ctr-flugplatzkontrolle-der-triac-oberpfaffenhofen-nfl-2024-1-3082.pdf?cid=3k3" },
      { label: "NfL 2025-1-3658 (BOS in CTR)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/einsatz-von-unbemannten-luftfahrzeugsystemen-durch-bos-in-kontrollzonen-nfl-2025-1-3658.pdf?cid=5b7" },
      { label: "Freigabe online beantragen (DFS)", url: "https://ais.dfs.de/pilotservice/bnl/leisure/airdrone/airdrone_edit.jsp" },
      { label: "Alle Allgemeinverfügungen CTR", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugverkehrskontrollfreigabe/" },
    ],
    contacts: [
      { type: "email", label: "DFS — Berlin Brandenburg (BER)", value: "tower-ber@dfs.de" },
      { type: "phone", label: "DFS — Berlin Brandenburg (BER)", value: "+493060916131" },
      { type: "email", label: "DFS — Bremen (BRE)", value: "tower-bre@dfs.de" },
      { type: "phone", label: "DFS — Bremen (BRE)", value: "+494215592451" },
      { type: "email", label: "DFS — Dresden (DRS)", value: "tower-drs@dfs.de" },
      { type: "phone", label: "DFS — Dresden (DRS)", value: "+493512131146" },
      { type: "email", label: "DFS — Düsseldorf (DUS)", value: "tower-dus@dfs.de" },
      { type: "phone", label: "DFS — Düsseldorf (DUS)", value: "+492114212451" },
      { type: "email", label: "DFS — Erfurt-Weimar (ERF)", value: "tower-erf@dfs.de" },
      { type: "phone", label: "DFS — Erfurt-Weimar (ERF)", value: "+493614580201" },
      { type: "email", label: "DFS — Frankfurt Main (FRA)", value: "tower-fra@dfs.de" },
      { type: "phone", label: "DFS — Frankfurt Main (FRA)", value: "+496969024451" },
      { type: "email", label: "DFS — Hamburg (HAM)", value: "tower-ham@dfs.de" },
      { type: "phone", label: "DFS — Hamburg (HAM)", value: "+4940507522451" },
      { type: "email", label: "DFS — Hannover (HAJ)", value: "tower-haj@dfs.de" },
      { type: "phone", label: "DFS — Hannover (HAJ)", value: "+495119772451" },
      { type: "email", label: "DFS — Köln/Bonn (CGN)", value: "tower-cgn@dfs.de" },
      { type: "phone", label: "DFS — Köln/Bonn (CGN)", value: "+492203402451" },
      { type: "email", label: "DFS — Leipzig/Halle (LEJ)", value: "tower-lej@dfs.de" },
      { type: "phone", label: "DFS — Leipzig/Halle (LEJ)", value: "+493412240451" },
      { type: "email", label: "DFS — München (MUC)", value: "tower-muc@dfs.de" },
      { type: "phone", label: "DFS — München (MUC)", value: "+498997524451" },
      { type: "email", label: "DFS — Münster/Osnabrück (FMO)", value: "tower-fmo@dfs.de" },
      { type: "phone", label: "DFS — Münster/Osnabrück (FMO)", value: "+492571940451" },
      { type: "email", label: "DFS — Nürnberg (NUE)", value: "tower-nue@dfs.de" },
      { type: "phone", label: "DFS — Nürnberg (NUE)", value: "+49911935451" },
      { type: "email", label: "DFS — Saarbrücken (SCN)", value: "tower-scn@dfs.de" },
      { type: "phone", label: "DFS — Saarbrücken (SCN)", value: "+496893832451" },
      { type: "email", label: "DFS — Stuttgart (STR)", value: "tower-str@dfs.de" },
      { type: "phone", label: "DFS — Stuttgart (STR)", value: "+497117948451" },
      { type: "email", label: "DFS Aviation — Braunschweig (BWE)", value: "TWR-BWE@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Braunschweig (BWE)", value: "+495312952391" },
      { type: "email", label: "DFS Aviation — Dortmund (DTM)", value: "TWR-DTM@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Dortmund (DTM)", value: "+492319211024" },
      { type: "email", label: "DFS Aviation — Friedrichshafen (FDH)", value: "TWR-FDH@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Friedrichshafen (FDH)", value: "+497541284251" },
      { type: "email", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "TWR-FKB@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "+497229662821" },
      { type: "email", label: "DFS Aviation — Lahr (LHA)", value: "TWR-LHA@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Lahr (LHA)", value: "+497821959110" },
      { type: "email", label: "DFS Aviation — Magdeburg-Cochstedt (CSO)", value: "TWR-CSO@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Magdeburg-Cochstedt (CSO)", value: "+493925784423" },
      { type: "email", label: "DFS Aviation — Memmingen (FMM)", value: "TWR-FMM@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Memmingen (FMM)", value: "+498331984421" },
      { type: "email", label: "DFS Aviation — Mönchengladbach (MGL)", value: "TWR-MGL@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Mönchengladbach (MGL)", value: "+492161682920" },
      { type: "email", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "TWR-NRN@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "+492837664991" },
      { type: "email", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "TWR-PAD@dfs-as.aero" },
      { type: "phone", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "+492955774251" },
      { type: "email", label: "AustroControl — Augsburg (AGB)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Frankfurt/Hahn (HHN)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Heringsdorf (HDF)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Lübeck (LBC)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Hof/Plauen (HOQ)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — München (MUC)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Münster/Osnabrück (FMO)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Nürnberg (NUE)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Saarbrücken (SCN)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Stuttgart (STR)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Kassel/Calden (KSF)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "AustroControl — Sylt (GWT)", value: "flugplatzkontrolle@uas-betrieb.de" },
      { type: "email", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "uas@triac-gmbh.de" },
      { type: "phone", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "+498153282116" },
      { type: "web", label: "Freigabe online beantragen (DFS)", value: "https://ais.dfs.de/pilotservice/bnl/leisure/airdrone/airdrone_edit.jsp" },
    ],
  },
  flugbeschraenkungsgebiete: {
    title: "Flugbeschränkungsgebiete (ED-R)",
    referenz: "§ 21h Absatz 3 Nr. 9 LuftVO",
    definition: "Luftraum",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Grundsätzlich gilt, dass der Betrieb von unbemannten Luftfahrzeugen in Flugbeschränkungsgebieten (ED-R) nur dann zulässig ist, wenn zuvor beim Bundesaufsichtsamt für Flugsicherung (BAF) eine Durchfluggenehmigung gem. § 17 Abs. 2 LuftVO eingeholt wurde. Ein Einflug ohne Genehmigung stellt nach § 62 LuftVG eine Straftat dar.\n\nFür bestimmte ED-R zum Schutz von Energie-, Rückbau- und Forschungsanlagen sowie der Wartburg besteht eine Allgemeinverfügung (NfL 2025-1-3652), die unter bestimmten Bedingungen eine allgemeine Durchfluggenehmigung erteilt.\n\nBetroffene ED-R (NfL 2025-1-3652, neue Nummerierung):\nED-R 1 Garching (Forschungsreaktor)\nED-R 3 Geesthacht/Krümmel\nED-R 5 Biblis (Kernkraftwerk)\nED-R 6 Brokdorf (Kernkraftwerk)\nED-R 7 Brunsbüttel (Kernkraftwerk)\nED-R 8 Emsland (Kernkraftwerk)\nED-R 23 Grafenrheinfeld (Kernkraftwerk)\nED-R 24 Grohnde (Kernkraftwerk)\nED-R 25 Gundremmingen (Kernkraftwerk)\nED-R 27 Isar (Kernkraftwerk)\nED-R 38 Neckarwestheim (Kernkraftwerk)\nED-R 39 Obrigheim (Kernkraftwerk)\nED-R 40 Philippsburg (Kernkraftwerk)\nED-R 41 Unterweser (Kernkraftwerk)\nED-R 90 Wartburg (Kulturdenkmal)\nED-R 111 Jülich (Forschungszentrum)\nED-R 133 Karlsruhe (Forschungszentrum)\n\nED-R 146 (Berlin) ist NICHT von dieser AV umfasst — eigene AV (NfL 2024-1-3127).",
    hinweis: "Wichtig:\nTrotz Freigabe kann der Flugbetrieb für unbemannte Luftfahrzeuge jederzeit wieder eingestellt werden. Alle bereits erteilten Freigaben verlieren dann sofort ihre Gültigkeit!\n\nEine Flugverkehrskontrollfreigabe betrifft nur den jeweiligen Luftraum. Eine ggf. erforderliche Genehmigung des Drohnenbetriebs ist weiterhin einzuholen!\n\nBedingungen der AV (NfL 2025-1-3652):\n- Betrieb nur in der offenen Kategorie gem. DVO (EU) 2019/947\n- Betrieb nur bei Tageslicht und bei Sichtflugbedingungen (VMC)\n- Maximale Flughöhe 50 m über Grund (AGL)\n- Mindestabstand zur Anlage: 200 m horizontal\n- Fernpilot muss sich vor dem Flug über die genaue Lage der Anlage informieren\n- ED-R 146 (Berlin) ist NICHT von dieser AV umfasst — eigene AV (NfL 2024-1-3127)",
    links: [
      { label: "NfL 2025-1-3652 (AV ED-R Energie/Forschung/Wartburg)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugbeschraenkungsgebiete-ed-r/allgemeinverfuegung-uas-in-verschiedenen-ed-r-zum-schutz-von-energie-rueckbau-und-forschungsanlagen-sowie-der-wartburg-nfl-2025-1-3652.pdf?cid=5ay" },
      { label: "NfL 2024-1-3127 (BAF ED-R 146 Berlin)", url: "https://dipul.de/homepage/en/applications-administrative-services/air-traffic-control-clearance/allgemeinverfuegung-uas-in-ed-r-146-berlin-zur-erteilung-von-durchfluggenehmigungen-nfl-2024-1-3127.pdf?cid=3be" },
      { label: "Alle Allgemeinverfügungen ED-R", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/flugbeschraenkungsgebiete-ed-r/" },
    ],
    contacts: [
      { type: "email", label: "BAF — Allgemein (Drohnen)", value: "drohne@baf.bund.de" },
      { type: "email", label: "BAF — ED-R 146 Berlin", value: "ed-r@baf.bund.de" },
      { type: "phone", label: "BAF — Referat LFR", value: "+496103707290" },
      { type: "phone", label: "Polizei Berlin — Lagezentrum (ED-R 146)", value: "+49304664707110" },
      { type: "web", label: "BAF — ED-R Informationen", value: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/Flugbeschraenkungsgebiete_UAS_node.html" },
      { type: "web", label: "BAF — Antragsformulare", value: "https://www.baf.bund.de/DE/Themen/Luftraum_Flugverfahren_Recht/Flugbeschraenkungsgebiete_UAS/Antraege_Durchflug/Antraege_Durchflug_node.html" },
    ],
  },
  temporaere_betriebseinschraenkungen: {
    title: "Tempor\u00e4re Betriebseinschr\u00e4nkungen",
    referenz: "\u00a7 21h Absatz 3 LuftVO",
    definition: "Zeitlich begrenzte Einschr\u00e4nkungen des Drohnenbetriebs, z.B. bei Gro\u00dfveranstaltungen, Staatsbesuchen oder besonderen Sicherheitslagen.",
    abstandsregel: "Variabel",
    betriebsvoraussetzung: "Betrieb nur mit ausdr\u00fccklicher Genehmigung der zust\u00e4ndigen Stelle m\u00f6glich. Aktuelle tempor\u00e4re Einschr\u00e4nkungen sind \u00fcber NOTAMs und dipul abrufbar.",
  },
  flughaefen: {
    title: "Flugh\u00e4fen",
    referenz: "\u00a7 21h Absatz 3 Nr. 2 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 1000 m von der Begrenzung eines Flughafens sowie von den in den An- und Abflugrichtungen um jeweils 5000 m verl\u00e4ngerten Bahnmittellinien eines Flughafens.",
    abstandsregel: "1000 m",
    betriebsvoraussetzung: "Betrieb in der Kategorie \u201eSpecific\u201c.",
  },
  flugplaetze: {
    title: "Flugpl\u00e4tze",
    referenz: "\u00a7 21h Absatz 3 Nr. 1 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 1500 m von der Begrenzung eines Flugplatzes.",
    abstandsregel: "1500 m",
    betriebsvoraussetzung: "Betrieb in der Kategorie \u201eSpecific\u201c oder Vorliegen einer Genehmigung der Luftaufsichtsstelle, der Flugleitung oder des Betreibers am Flugplatz.",
  },
  binnenwasserstrassen: {
    title: "Binnenwasserstra\u00dfen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bundeswasserstra\u00dfen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m oder\nd. Beim \u00dcberflug von Bundeswasserstra\u00dfen wird das Flugger\u00e4t mindestens 100 m \u00fcber Grund oder Wasser betrieben, es erfolgt lediglich eine Querung auf dem k\u00fcrzesten Weg und keine Schiffe und keine Schifffahrtsanlagen, insbesondere Schleusen, Wehre, Schiffshebewerke und Liegestellen, werden \u00fcberflogen.",
  },
  seewasserstrassen: {
    title: "Seewasserstra\u00dfen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Seewasserstra\u00dfen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m oder\nd. Beim \u00dcberflug wird das Flugger\u00e4t mindestens 100 m \u00fcber Grund oder Wasser betrieben, es erfolgt lediglich eine Querung auf dem k\u00fcrzesten Weg und keine Schiffe und keine Schifffahrtsanlagen werden \u00fcberflogen.",
  },
  schifffahrtsanlagen: {
    title: "Schifffahrtsanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Schleusen, Wehre, Schiffshebewerke, Liegestellen und sonstige Schifffahrtsanlagen an Bundeswasserstra\u00dfen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen.",
  },
  industrieanlagen: {
    title: "Industrieanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung von Industrieanlagen, Justizvollzugsanstalten, Einrichtungen des Ma\u00dfregelvollzugs, milit\u00e4rischen Anlagen und Organisationen, Anlagen der zentralen Energieerzeugung und Energieverteilung sowie Einrichtungen, in denen erlaubnisbed\u00fcrftige T\u00e4tigkeiten der Schutzstufe 4 nach der Biostoffverordnung (BioStoffV) ausge\u00fcbt werden. Anlagen der zentralen Energieerzeugung sind alle diejenigen an das Verteilernetz angeschlossenen Energieerzeugungsanlagen, die keine dezentrale Erzeugungsanlage im Sinne des \u00a7 3 Nummer 11 des Energiewirtschaftsgesetzes (EnWG) sind.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  naturschutzgebiete: {
    title: "Naturschutzgebiete",
    referenz: "§ 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich über Naturschutzgebieten im Sinne des § 23 Absatz 1 des Bundesnaturschutzgesetzes (BNatSchG), über Nationalparks im Sinne des § 24 des Bundesnaturschutzgesetzes (BNatSchG) und über Gebieten im Sinne des § 7 Absatz 1 Nummer 6 und 7 des Bundesnaturschutzgesetzes (BNatSchG).",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zuständigen Naturschutzbehörde oder der Betrieb ist gemäß anderslautender landesrechtlicher Vorschriften erlaubt oder (nicht bei Nationalparks):\n\na. Der Betrieb erfolgt nicht zu Zwecken des Sports oder der Freizeitgestaltung und\nb. der Betrieb erfolgt in einer Höhe von mehr als 100 m und\nc. der Fernpilot kennt den Schutzzweck des betroffenen Schutzgebietes und berücksichtigt diesen in angemessener Weise und\nd. die Luftraumnutzung durch den Überflug über dem betroffenen Schutzgebiet ist zur Erfüllung des Zwecks für den Betrieb unumgänglich erforderlich.",
    hinweis: "In mehreren Bundesländern gibt es Allgemeinverfügungen (AV), die den Drohnenbetrieb in Naturschutzgebieten unter bestimmten Bedingungen erlauben. Prüfe, ob für dein Bundesland eine AV vorliegt.",
    links: [
      { label: "Allgemeinverfügungen (dipul Übersicht)", url: "https://dipul.de/homepage/de/antraege-behoerdendienste/" },
    ],
  },
  nationalparks: {
    title: "Nationalparks",
    referenz: "\u00a7 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich \u00fcber Nationalparks im Sinne des \u00a7 24 des Bundesnaturschutzgesetzes (BNatSchG).",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Naturschutzbeh\u00f6rde oder der Betrieb ist gem\u00e4\u00df anderslautender landesrechtlicher Vorschriften erlaubt.\n\nWichtig: Die Ausnahmen (Betrieb \u00fcber 100 m H\u00f6he etc.) gelten NICHT f\u00fcr Nationalparks!",
  },
  vogelschutzgebiete: {
    title: "Vogelschutzgebiete",
    referenz: "\u00a7 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich \u00fcber Gebieten im Sinne des \u00a7 7 Absatz 1 Nummer 6 und 7 des Bundesnaturschutzgesetzes (BNatSchG) \u2014 europ\u00e4ische Vogelschutzgebiete (SPA).",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Naturschutzbeh\u00f6rde oder der Betrieb ist gem\u00e4\u00df anderslautender landesrechtlicher Vorschriften erlaubt oder:\n\na. Der Betrieb erfolgt nicht zu Zwecken des Sports oder der Freizeitgestaltung und\nb. der Betrieb erfolgt in einer H\u00f6he von mehr als 100 m und\nc. der Fernpilot kennt den Schutzzweck des betroffenen Schutzgebietes und ber\u00fccksichtigt diesen in angemessener Weise und\nd. die Luftraumnutzung ist zur Erf\u00fcllung des Zwecks f\u00fcr den Betrieb unumg\u00e4nglich erforderlich.",
  },
  "ffh-gebiete": {
    title: "FFH-Gebiete",
    referenz: "\u00a7 21h Absatz 3 Nr. 6 LuftVO",
    definition: "Ein Bereich \u00fcber Fauna-Flora-Habitat-Gebieten gem\u00e4\u00df der FFH-Richtlinie (92/43/EWG), die als Gebiete von gemeinschaftlicher Bedeutung (GGB) oder als besondere Erhaltungsgebiete (BEG) ausgewiesen sind.",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Naturschutzbeh\u00f6rde oder der Betrieb ist gem\u00e4\u00df anderslautender landesrechtlicher Vorschriften erlaubt oder:\n\na. Der Betrieb erfolgt nicht zu Zwecken des Sports oder der Freizeitgestaltung und\nb. der Betrieb erfolgt in einer H\u00f6he von mehr als 100 m und\nc. der Fernpilot kennt den Schutzzweck und ber\u00fccksichtigt diesen angemessen und\nd. die Luftraumnutzung ist zur Erf\u00fcllung des Zwecks unumg\u00e4nglich erforderlich.",
  },
  militaerische_anlagen: {
    title: "Milit\u00e4rische Anlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung milit\u00e4rischer Anlagen und Organisationen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  stromleitungen: {
    title: "Stromleitungen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Freileitungen zur Energieverteilung (Hochspannungsleitungen). Teil der Anlagen der zentralen Energieerzeugung und Energieverteilung.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  umspannwerke: {
    title: "Umspannwerke",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Umspannwerke als Teil der Anlagen der zentralen Energieerzeugung und Energieverteilung.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  kraftwerke: {
    title: "Kraftwerke",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Anlagen der zentralen Energieerzeugung \u2014 alle an das Verteilernetz angeschlossenen Energieerzeugungsanlagen, die keine dezentrale Erzeugungsanlage im Sinne des \u00a7 3 Nr. 11 EnWG sind.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  windkraftanlagen: {
    title: "Windkraftanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Windenergieanlagen als Teil der Anlagen der zentralen Energieerzeugung und Energieverteilung.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  bundesautobahnen: {
    title: "Bundesautobahnen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bundesfernstra\u00dfen (Bundesautobahnen).",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m.",
  },
  bundesstrassen: {
    title: "Bundesstra\u00dfen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bundesfernstra\u00dfen (Bundesstra\u00dfen).",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m.",
  },
  bahnanlagen: {
    title: "Bahnanlagen",
    referenz: "\u00a7 21h Absatz 3 Nr. 5 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Bahnanlagen.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "a. Betrieb in der Kategorie \u201eSpecific\u201c oder\nb. Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder der Betreiber der Einrichtungen oder\nc. H\u00f6he des Flugger\u00e4tes \u00fcber Grund ist stets kleiner als der seitliche Abstand zur Infrastruktur und der seitliche Abstand zur Infrastruktur ist stets gr\u00f6\u00dfer als 10 m.",
  },
  diplomatische_vertretungen: {
    title: "Diplomatische Vertretungen",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Grundst\u00fccken, auf denen diplomatische und konsularische Vertretungen sowie internationale Organisationen im Sinne des V\u00f6lkerrechts ihren Sitz haben.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  behoerden: {
    title: "Oberste Bundes-/Landesbeh\u00f6rden",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Grundst\u00fccken, auf denen die Verfassungsorgane des Bundes oder der L\u00e4nder oder oberste und obere Bundes- oder Landesbeh\u00f6rden ihren Sitz haben.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  internationale_organisationen: {
    title: "Internationale Organisationen",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Grundst\u00fccken, auf denen internationale Organisationen im Sinne des V\u00f6lkerrechts ihren Sitz haben.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  justizvollzugsanstalten: {
    title: "JVA / Ma\u00dfregelvollzug",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung von Justizvollzugsanstalten und Einrichtungen des Ma\u00dfregelvollzugs.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  polizei: {
    title: "Polizeiliegenschaften",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Liegenschaften von Polizei und anderen Sicherheitsbeh\u00f6rden.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  sicherheitsbehoerden: {
    title: "Andere Sicherheitsbeh\u00f6rden",
    referenz: "\u00a7 21h Absatz 3 Nr. 4 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Liegenschaften anderer Sicherheitsbeh\u00f6rden.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  krankenhaeuser: {
    title: "Krankenh\u00e4user",
    referenz: "\u00a7 21h Absatz 3 Nr. 10 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von der Begrenzung von Krankenh\u00e4usern.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der Betreiber der Einrichtungen.",
  },
  labore: {
    title: "Einrichtungen BSL-4",
    referenz: "\u00a7 21h Absatz 3 Nr. 3 LuftVO",
    definition: "Ein Bereich \u00fcber und innerhalb eines seitlichen Abstands von 100 m von Einrichtungen, in denen erlaubnisbed\u00fcrftige T\u00e4tigkeiten der Schutzstufe 4 nach der Biostoffverordnung (BioStoffV) ausge\u00fcbt werden.",
    abstandsregel: "100 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung der zust\u00e4ndigen Stelle oder des Betreibers der Einrichtungen.",
  },
  freibaeder: {
    title: "Freib\u00e4der / Badestr\u00e4nde",
    referenz: "\u00a7 21h Absatz 3 Nr. 8 LuftVO",
    definition: "Ein Bereich \u00fcber Freib\u00e4dern, Badestr\u00e4nden und \u00e4hnlichen Einrichtungen.",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "Vorliegen einer Genehmigung und Flugbetrieb au\u00dferhalb der Betriebs- oder Badezeiten der Einrichtung.",
  },
  modellflugplaetze: {
    title: "Modellflugpl\u00e4tze",
    referenz: "Darstellung zur Information von Fernpiloten!",
    definition: "Ein Bereich \u00fcber und um Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4. sowie Modellflugpl\u00e4tzen.",
    abstandsregel: "Keine Beschr\u00e4nkung durch LuftVO, aber lokale Regeln durch jeweiligen Betreiber beachten!",
    betriebsvoraussetzung: "Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4. sowie Modellflugpl\u00e4tze sind keine geografischen Gebiete im Sinne des \u00a7 21h LuftVO, d.h. der Drohnenbetrieb wird durch diese nicht grunds\u00e4tzlich beschr\u00e4nkt.\n\nEs k\u00f6nnen lokale Betriebsvoraussetzungen durch den jeweiligen Betreiber gelten. Es wird empfohlen, diesen zu kontaktieren.",
    hinweis: "WICHTIG\nIn diesen Gebieten und auch au\u00dferhalb des markierten Bereichs ist stets mit Flugverkehr durch \u2013 teils lautlose! \u2013 Luftfahrzeuge zu rechnen! Fernpiloten m\u00fcssen jedes Kollisionsrisiko mit Luftfahrzeugen vermeiden und m\u00fcssen entsprechend ausweichen oder ihren Flug abbrechen.",
  },
  haengegleiter: {
    title: "H\u00e4ngegleiter",
    referenz: "Darstellung zur Information von Fernpiloten!",
    definition: "Ein Bereich \u00fcber und um Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4.",
    abstandsregel: "Keine Beschr\u00e4nkung durch LuftVO, aber lokale Regeln durch jeweiligen Betreiber beachten!",
    betriebsvoraussetzung: "Flugpl\u00e4tze f\u00fcr H\u00e4ngegleiter, Gleitschirme u.\u00e4. sind keine geografischen Gebiete im Sinne des \u00a7 21h LuftVO, d.h. der Drohnenbetrieb wird durch diese nicht grunds\u00e4tzlich beschr\u00e4nkt.\n\nEs k\u00f6nnen lokale Betriebsvoraussetzungen durch den jeweiligen Betreiber gelten. Es wird empfohlen, diesen zu kontaktieren.",
    hinweis: "WICHTIG\nIn diesen Gebieten und auch au\u00dferhalb des markierten Bereichs ist stets mit Flugverkehr durch \u2013 teils lautlose! \u2013 Luftfahrzeuge zu rechnen! Fernpiloten m\u00fcssen jedes Kollisionsrisiko mit Luftfahrzeugen vermeiden und m\u00fcssen entsprechend ausweichen oder ihren Flug abbrechen.",
  },
  wohngrundstuecke: {
    title: "Wohngrundst\u00fccke",
    referenz: "\u00a7 21h Absatz 3 Nr. 7 LuftVO",
    definition: "Ein Bereich \u00fcber Wohngrundst\u00fccken.",
    abstandsregel: "0 m",
    betriebsvoraussetzung: "a. Vorliegen einer Genehmigung des Eigent\u00fcmers oder sonstigen Nutzungsberechtigten oder\nb. die Startmasse des unbemannten Flugger\u00e4tes betr\u00e4gt bis zu 0,25 kg und das unbemannte Flugger\u00e4t und seine Ausr\u00fcstung sind zu optischen und akustischen Aufzeichnungen und \u00dcbertragungen sowie zur Aufzeichnung und zur \u00dcbertragung von Funksignalen Dritter nicht in der Lage oder\nc. der Betrieb findet in einer Flugh\u00f6he von mindestens 100 m statt und\n\n   1. die Luftraumnutzung \u00fcber dem betroffenen Wohngrundst\u00fcck ist zur Erf\u00fcllung eines berechtigten Betriebszwecks erforderlich; \u00f6ffentliche Fl\u00e4chen oder Grundst\u00fccke, die keine Wohngrundst\u00fccke sind, k\u00f6nnen f\u00fcr den \u00dcberflug nicht genutzt werden und die Zustimmung des Grundst\u00fcckeigent\u00fcmers oder sonstigen Nutzungsberechtigten kann nicht in zumutbarer Weise eingeholt werden, und\n   2. es werden alle Vorkehrungen getroffen, um einen Eingriff in den gesch\u00fctzten Privatbereich und in das Recht auf informationelle Selbstbestimmung der betroffenen B\u00fcrger zu vermeiden; dazu z\u00e4hlt insbesondere, dass in ihren Rechten Betroffene regelm\u00e4\u00dfig vorab zu informieren sind, und\n   3. der Betrieb findet nicht zwischen 22:00 Uhr und 6:00 Uhr Ortszeit statt und\n   4. es ist nicht zu erwarten, dass durch den Betrieb Immissionsrichtwerte nach Nummer 6.1 der Technischen Anleitung zum Schutz gegen L\u00e4rm \u00fcberschritten werden.",
  },
  ch_drohnen: {
    title: "Drohnen-Einschr\u00e4nkungen (CH)",
    referenz: "BAZL — Verordnung des UVEK \u00fcber unbemannte Luftfahrzeuge (VUL), SR 748.941",
    definition: "Gebiete in der Schweiz, in denen der Betrieb von Drohnen eingeschr\u00e4nkt oder verboten ist. Dazu geh\u00f6ren Kontrollzonen um Flugh\u00e4fen, Naturschutzgebiete, milit\u00e4rische Sperrgebiete und weitere sensible Bereiche.",
    abstandsregel: "Abh\u00e4ngig von Zone — siehe Kartendetails",
    betriebsvoraussetzung: "In Einschr\u00e4nkungszonen ist der Drohnenbetrieb nur mit entsprechender Bewilligung des BAZL oder der zust\u00e4ndigen Stelle (z.\u00a0B. skyguide f\u00fcr CTR) gestattet. F\u00fcr die offene Kategorie gelten die EU-Regeln gem\u00e4ss CH-Umsetzung.",
    hinweis: "Die Schweiz hat die EU-Drohnenverordnung (EU) 2019/947 \u00fcbernommen. F\u00fcr Fl\u00fcge in Kontrollzonen (CTR) ist eine Freigabe von skyguide erforderlich. In Nationalparks und Naturschutzgebieten gelten zus\u00e4tzliche kantonale Einschr\u00e4nkungen.\n\nRegistrierung: Alle Drohnen ab 250\u00a0g oder mit Kamera m\u00fcssen beim BAZL registriert werden.\n\nOnline-Bewilligung f\u00fcr CTR: \u00dcber das skyguide-Portal SWISSDRONE.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
      { label: "Geo-Awareness Karte (BAZL)", url: "https://map.geo.admin.ch/?topic=aviation&layers=ch.bazl.einschraenkungen-drohnen" },
      { label: "skyguide SWISSDRONE (CTR-Freigabe)", url: "https://swissdrone.skyguide.ch/" },
      { label: "VUL (SR 748.941)", url: "https://www.fedlex.admin.ch/eli/cc/2023/202/de" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
      { type: "phone", label: "BAZL — Zentrale", value: "+41583165511" },
      { type: "web", label: "skyguide SWISSDRONE", value: "https://swissdrone.skyguide.ch/" },
    ],
  },
  ch_aktivitaetszonen: {
    title: "UAS-Aktivit\u00e4tszonen (CH)",
    referenz: "BAZL — Art. 19 VUL (SR 748.941)",
    definition: "Gebiete, die f\u00fcr bestimmte UAS-Aktivit\u00e4ten ausgewiesen sind (z.\u00a0B. Modellflugpl\u00e4tze, Testgebiete).",
    abstandsregel: "Je nach Zone — siehe Kartendetails",
    betriebsvoraussetzung: "Betrieb gem\u00e4ss den Bedingungen der jeweiligen Aktivit\u00e4tszone. Modellflugpl\u00e4tze k\u00f6nnen besondere Regeln und H\u00f6hengrenzen haben.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_bodenrisiko_100: {
    title: "Intrinsisches Bodenrisiko SORA 100J (CH)",
    referenz: "BAZL — SORA-Methodik (Specific Operations Risk Assessment), JARUS Guidelines",
    definition: "Kartierung des intrinsischen Bodenrisikos f\u00fcr die SORA-Bewertung mit einer statistischen Wiederkehrperiode von 100 Jahren. Zeigt die Bev\u00f6lkerungsdichte und kritische Infrastruktur.",
    abstandsregel: "Gem\u00e4ss SORA Ground Risk Class (GRC)",
    betriebsvoraussetzung: "Relevant f\u00fcr Betrieb in der speziellen Kategorie. Die GRC bestimmt die erforderlichen Risikominderungsmassnahmen (M1/M2/M3).",
    links: [
      { label: "BAZL SORA-Info", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen/drohnen-und-flugmodelle/betrieb-in-der-speziellen-kategorie.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_bodenrisiko_200: {
    title: "Intrinsisches Bodenrisiko SORA 200J (CH)",
    referenz: "BAZL — SORA-Methodik (Specific Operations Risk Assessment), JARUS Guidelines",
    definition: "Kartierung des intrinsischen Bodenrisikos f\u00fcr die SORA-Bewertung mit einer statistischen Wiederkehrperiode von 200 Jahren. Konservativere Bewertung als 100J.",
    abstandsregel: "Gem\u00e4ss SORA Ground Risk Class (GRC)",
    betriebsvoraussetzung: "Relevant f\u00fcr Betrieb in der speziellen Kategorie mit erh\u00f6htem Risikoprofil.",
    links: [
      { label: "BAZL SORA-Info", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen/drohnen-und-flugmodelle/betrieb-in-der-speziellen-kategorie.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_ruhezonen: {
    title: "Landschaftsruhezonen (CH)",
    referenz: "BAZL — Verordnung \u00fcber die Luftfahrt (LFV), kantonale Regelungen",
    definition: "Gebiete mit erh\u00f6htem Schutz f\u00fcr Wildtiere und Natur. In diesen Zonen ist der Drohnenbetrieb eingeschr\u00e4nkt oder verboten.",
    abstandsregel: "Flugverbot oder saisonale Einschr\u00e4nkungen",
    betriebsvoraussetzung: "In Landschaftsruhezonen ist der Drohnenbetrieb grunds\u00e4tzlich nicht gestattet. Ausnahmen erfordern eine kantonale Bewilligung.",
    hinweis: "Besonders relevant in Gebirgsregionen und W\u00e4ldern w\u00e4hrend Brut- und Setzzeiten. Kantonale Jagd- und Naturschutzbeh\u00f6rden k\u00f6nnen zus\u00e4tzliche saisonale Verbote erlassen.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  ch_wohngebiete: {
    title: "Wohngebiete AuLaV (CH)",
    referenz: "BAZL — Aussenlande-Verordnung (AuLaV), SR 748.131.1",
    definition: "Dicht besiedelte Wohngebiete gem\u00e4ss AuLaV-Definition. Fl\u00fcge \u00fcber diesen Gebieten unterliegen besonderen Auflagen.",
    abstandsregel: "Abh\u00e4ngig von Drohnenkategorie und -gewicht",
    betriebsvoraussetzung: "In der offenen Kategorie (A1/A3) gelten Einschr\u00e4nkungen \u00fcber Menschenansammlungen. F\u00fcr die Unterkategorien A2 gelten Mindestabst\u00e4nde zu unbeteiligten Personen.",
    links: [
      { label: "BAZL Drohnen-Infoseite", url: "https://www.bazl.admin.ch/bazl/de/home/drohnen.html" },
    ],
    contacts: [
      { type: "email", label: "BAZL — Sektion UAS", value: "uas@bazl.admin.ch" },
    ],
  },
  lu_uas_0_50: {
    title: "UAS-Zonen 0\u201350\u00a0m (LU)",
    referenz: "Art. 15 DVO (EU) 2019/947 / R\u00e8glement minist\u00e9riel du 16 d\u00e9cembre 2020",
    definition: "Gebiete in Luxemburg, in denen der Betrieb unbemannter Luftfahrzeuge von 0 bis 50\u00a0m H\u00f6he eingeschr\u00e4nkt oder verboten ist. Umfasst Flughafen Findel (ELLX), Residenzen, Haftanstalten, Milit\u00e4rgelände und weitere sensible Bereiche.\n\nFarbcodierung der Karte:\n\u2022 Rot: Aktive Zone \u2014 UAS-Flug verboten/genehmigungspflichtig\n\u2022 Gelb: Demnächst aktiv \u2014 Zone wird in Kürze aktiviert\n\u2022 Grau: Inaktiv \u2014 Zone existiert, aktuell keine Beschr\u00e4nkung",
    abstandsregel: "5 km Flughafen Findel \u2014 2 km Hubschrauberlandeplätze/Flugplätze",
    betriebsvoraussetzung: "Drei Arten von Beschr\u00e4nkungen:\n\u2022 PROHIBITED (Verboten): Jeglicher UAS-Betrieb untersagt\n\u2022 REQ_AUTHORISATION (Genehmigungspflichtig): Genehmigung der DAC oder ATC erforderlich\n\u2022 CONDITIONAL (Unter Auflagen): Meldepflicht oder Bedingungen\n\nGeo-Awareness: Vor jedem Flug JSON-Datei von drones.geoportail.lu/zones in das UAS laden (C1/C2/C3 Pflicht).\n\nVersicherung: Seit Loi du 20 d\u00e9cembre 2024 f\u00fcr alle Betreiber obligatorisch.\n\nStrafe: Bis zu 1 Jahr Freiheitsstrafe und 5.000 \u20ac Geldstrafe.",
    hinweis: "WICHTIG: Die Geozonen des Drohnenherstellers auf der Fernsteuerung decken NICHT unbedingt alle Beschr\u00e4nkungsgebiete Luxemburgs ab. Es findet KEIN automatischer Datenaustausch zwischen Hersteller und G\u00e9oportail statt.\n\nNur die Zonen auf g-o.lu/uas sind rechtlich verbindlich.\n\nDie Karte wird alle 5 Minuten aktualisiert. Durchschnittlich ca. 2.000 Aktivierungen pro Monat.\n\nRegistrierung: Pflicht f\u00fcr alle UAS-Betreiber \u00fcber MyGuichet.lu.\n\nKontrollzone Findel (ELLX): Freigabe \u00fcber DAC/ATC erforderlich.",
    links: [
      { label: "Offizielle UAS-Zonenkarte (g-o.lu/uas)", url: "https://g-o.lu/uas" },
      { label: "DAC Geozonen-Infoseite", url: "https://dac.gouvernement.lu/en/drones/geozones.html" },
      { label: "Benutzerhandbuch G\u00e9oportail (DE, PDF)", url: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-de.pdf" },
      { label: "G\u00e9oportail UAS-Zonen (Vollansicht)", url: "https://map.geoportail.lu/theme/drones" },
      { label: "JSON-Feed (Geo-Awareness, ED-269)", url: "https://drones.geoportail.lu/zones" },
      { label: "Open Data (GeoJSON)", url: "https://data.public.lu/en/datasets/uas-geographical-zones-grand-duchy-of-luxembourg-zones-geographiques-uas-grand-duche-de-luxembourg/" },
      { label: "DAC Drohnen-Hauptseite", url: "https://dac.gouvernement.lu/en/drones.html" },
      { label: "Loi du 20 d\u00e9cembre 2024 (Legilux)", url: "https://legilux.public.lu/eli/etat/leg/loi/2024/12/20/a747/jo" },
      { label: "R\u00e8glement minist\u00e9riel du 16.12.2020 (Legilux)", url: "https://legilux.public.lu/eli/etat/leg/rmin/2020/12/16/a1028/jo" },
    ],
    contacts: [
      { type: "email", label: "DAC — UAS allgemein", value: "uas@av.etat.lu" },
      { type: "email", label: "DAC — Geographische Zonen", value: "uas.zones@av.etat.lu" },
      { type: "email", label: "DAC — Schulung/Prüfungen", value: "uas.training@av.etat.lu" },
      { type: "phone", label: "DAC — Zentrale", value: "+35224782480" },
      { type: "web", label: "DAC Drohnen-Portal", value: "https://dac.gouvernement.lu/en/drones.html" },
    ],
  },
  lu_uas_50_120: {
    title: "UAS-Zonen 50\u2013120\u00a0m (LU)",
    referenz: "Art. 15 DVO (EU) 2019/947 / R\u00e8glement minist\u00e9riel du 16 d\u00e9cembre 2020",
    definition: "Gebiete in Luxemburg mit Einschr\u00e4nkungen f\u00fcr den UAS-Betrieb in H\u00f6hen von 50 bis 120\u00a0m. Zusätzliche Beschr\u00e4nkungen gelten in der N\u00e4he von Flugpl\u00e4tzen und im unkontrollierten Luftraum.\n\nFarbcodierung identisch zur 0\u201350 m Schicht (Rot/Gelb/Grau).",
    abstandsregel: "50\u2013120\u00a0m AGL — zonenabh\u00e4ngig",
    betriebsvoraussetzung: "Betrieb mit erweiterter Genehmigung oder in der speziellen Kategorie. In Kontrollzonen Freigabe der DAC/ATC erforderlich.\n\nGeo-Awareness-Datei vor jedem Flug aktualisieren (drones.geoportail.lu/zones).",
    links: [
      { label: "Offizielle UAS-Zonenkarte (g-o.lu/uas)", url: "https://g-o.lu/uas" },
      { label: "DAC Geozonen-Infoseite", url: "https://dac.gouvernement.lu/en/drones/geozones.html" },
      { label: "Benutzerhandbuch G\u00e9oportail (DE, PDF)", url: "https://dac.gouvernement.lu/dam-assets/documents/drones/zoneuas/241216-quick-user-guide-de.pdf" },
      { label: "G\u00e9oportail UAS-Zonen (Vollansicht)", url: "https://map.geoportail.lu/theme/drones" },
    ],
    contacts: [
      { type: "email", label: "DAC — UAS allgemein", value: "uas@av.etat.lu" },
      { type: "email", label: "DAC — Geographische Zonen", value: "uas.zones@av.etat.lu" },
      { type: "phone", label: "DAC — Zentrale", value: "+35224782480" },
    ],
  },
  nl_no_fly_zones: {
    title: "Flugverbotszonen (NL)",
    referenz: "Verordnung für ferngesteuerte Luftfahrzeuge (RBML) / EU 2019/947",
    definition: "Drohnen-Flugverbotszonen der Niederlande, bereitgestellt durch LVNL (Luchtverkeersleiding Nederland) \u00fcber PDOK. Umfasst CTR, Sperrgebiete, Beschr\u00e4nkungsgebiete und sonstige No-fly-Zonen.",
    abstandsregel: "Zonenabh\u00e4ngig \u2014 siehe Kartendetails",
    betriebsvoraussetzung: "In Kontrollzonen (CTR) und Sperrgebieten ist der Drohnenbetrieb grunds\u00e4tzlich verboten. Ausnahmen erfordern eine Genehmigung der ILT (Inspectie Leefomgeving en Transport) oder eine Freigabe der LVNL. Die EU-Drohnenverordnung gilt unmittelbar.",
    hinweis: "Registrierung: Pflicht f\u00fcr alle UAS-Betreiber \u00fcber das EASA-Portal oder das niederl\u00e4ndische Registrierungssystem.\n\nDie Niederlande verwenden das PDOK-System (Publieke Dienstverlening Op de Kaart) f\u00fcr die Bereitstellung geographischer UAS-Zonen.\n\nSchiphol CTR: Besonders gro\u00dfe Kontrollzone \u2014 Drohnenflug nur mit ausdr\u00fccklicher LVNL-Freigabe.",
    links: [
      { label: "GoDrone.nl \u2014 Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
      { label: "ILT \u2014 Drohnen-Infoseite", url: "https://www.ilent.nl/onderwerpen/drones" },
      { label: "PDOK No-fly-Zonen", url: "https://www.pdok.nl/introductie/-/article/no-fly-zones-voor-drones" },
    ],
    contacts: [
      { type: "web", label: "ILT \u2014 Inspectie Leefomgeving en Transport", value: "https://www.ilent.nl/onderwerpen/drones" },
      { type: "web", label: "LVNL \u2014 Luchtverkeersleiding Nederland", value: "https://www.lvnl.nl/" },
    ],
  },
  nl_no_fly_ohne_natura: {
    title: "Flugverbotszonen ohne Natura2000 (NL)",
    referenz: "Verordnung für ferngesteuerte Luftfahrzeuge (RBML) / EU 2019/947",
    definition: "Drohnen-Flugverbotszonen der Niederlande ohne Natura-2000-Schutzgebiete. Zeigt nur CTR, Sperrgebiete, Beschr\u00e4nkungsgebiete und vitale Infrastruktur.",
    abstandsregel: "Zonenabh\u00e4ngig \u2014 siehe Kartendetails",
    betriebsvoraussetzung: "In Kontrollzonen (CTR) und Sperrgebieten ist der Drohnenbetrieb grunds\u00e4tzlich verboten. Ausnahmen erfordern eine Genehmigung der ILT oder eine Freigabe der LVNL.",
    hinweis: "Dieser Layer blendet Natura-2000-Schutzgebiete aus und zeigt nur die direkt f\u00fcr den Drohnenbetrieb relevanten Einschr\u00e4nkungen.",
    links: [
      { label: "GoDrone.nl \u2014 Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
      { label: "ILT \u2014 Drohnen-Infoseite", url: "https://www.ilent.nl/onderwerpen/drones" },
    ],
    contacts: [
      { type: "web", label: "ILT \u2014 Inspectie Leefomgeving en Transport", value: "https://www.ilent.nl/onderwerpen/drones" },
    ],
  },
  nl_landingsite: {
    title: "Landepl\u00e4tze (NL)",
    referenz: "PDOK / LVNL",
    definition: "Registrierte Landepl\u00e4tze in den Niederlanden.",
    abstandsregel: "Standortabh\u00e4ngig",
    betriebsvoraussetzung: "Start- und Landepl\u00e4tze \u2014 informative Ebene.",
    hinweis: "Informative Ebene der PDOK-Drohnenkarte.",
    links: [
      { label: "GoDrone.nl \u2014 Offizielle Drohnenkarte", url: "https://map.godrone.nl/" },
    ],
    contacts: [],
  },
};

export const EDR_ZONE_CONTACTS: Record<string, GeozoneContact[]> = {
  "401": [
    { type: "email", label: "Betreiber — ED-R 401 Brunsbüttel", value: "kkw-brunsbuettel@vattenfall.de" },
    { type: "phone", label: "Betreiber — ED-R 401 Brunsbüttel", value: "+494852880" },
  ],
  "402": [
    { type: "email", label: "Betreiber — ED-R 402 Krümmel", value: "kkw-kruemmel@vattenfall.de" },
    { type: "phone", label: "Betreiber — ED-R 402 Krümmel", value: "+4941529370" },
  ],
  "403": [
    { type: "email", label: "Betreiber — ED-R 403 Brokdorf", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 403 Brokdorf", value: "+494829760" },
  ],
  "404": [
    { type: "email", label: "Betreiber — ED-R 404 Stade", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 404 Stade", value: "+4941416920" },
  ],
  "405": [
    { type: "email", label: "Betreiber — ED-R 405 Unterweser", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 405 Unterweser", value: "+494735770" },
  ],
  "406": [
    { type: "email", label: "Betreiber — ED-R 406 Grohnde", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 406 Grohnde", value: "+495155670" },
  ],
  "407": [
    { type: "email", label: "Betreiber — ED-R 407 Lingen", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 407 Lingen", value: "+4959160020" },
  ],
  "409": [
    { type: "email", label: "Betreiber — ED-R 409 Hamm-Uentrop", value: "kontakt@htrgmbh.de" },
    { type: "phone", label: "Betreiber — ED-R 409 Hamm-Uentrop", value: "+492388370" },
  ],
  "411": [
    { type: "email", label: "Betreiber — ED-R 411 Würgassen", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 411 Würgassen", value: "+49527140030" },
  ],
  "412": [
    { type: "email", label: "Betreiber — ED-R 412 Jülich", value: "info@fz-juelich.de" },
    { type: "phone", label: "Betreiber — ED-R 412 Jülich", value: "+492461610" },
  ],
  "413": [
    { type: "email", label: "Betreiber — ED-R 413 Mülheim-Kärlich", value: "info@rwe.com" },
    { type: "phone", label: "Betreiber — ED-R 413 Mülheim-Kärlich", value: "+492637640" },
  ],
  "415": [
    { type: "email", label: "Betreiber — ED-R 415 Philippsburg", value: "poststelle@enbw.com" },
    { type: "phone", label: "Betreiber — ED-R 415 Philippsburg", value: "+497256930" },
  ],
  "417": [
    { type: "email", label: "Betreiber — ED-R 417 Obrigheim", value: "poststelle@enbw.com" },
    { type: "phone", label: "Betreiber — ED-R 417 Obrigheim", value: "+496261860" },
  ],
  "418": [
    { type: "email", label: "Betreiber — ED-R 418 Biblis", value: "info@rwe.com" },
    { type: "phone", label: "Betreiber — ED-R 418 Biblis", value: "+496245280" },
  ],
  "419": [
    { type: "email", label: "Betreiber — ED-R 419 Grafenrheinfeld", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 419 Grafenrheinfeld", value: "+499723710" },
  ],
  "420": [
    { type: "email", label: "Betreiber — ED-R 420 Karlstein", value: "kontakt@framatome.com" },
    { type: "phone", label: "Betreiber — ED-R 420 Karlstein", value: "+496023910" },
  ],
  "421": [
    { type: "email", label: "Betreiber — ED-R 421 Isar", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 421 Isar", value: "+498702380" },
  ],
  "422": [
    { type: "email", label: "Betreiber — ED-R 422 Gundremmingen", value: "info@preussenelektra.de" },
    { type: "phone", label: "Betreiber — ED-R 422 Gundremmingen", value: "+498282820" },
  ],
  "423": [
    { type: "email", label: "Betreiber — ED-R 423 Garching", value: "info@frm2.tum.de" },
    { type: "phone", label: "Betreiber — ED-R 423 Garching", value: "+498928914700" },
  ],
  "424": [
    { type: "email", label: "Betreiber — ED-R 424 Neckarwestheim", value: "poststelle@enbw.com" },
    { type: "phone", label: "Betreiber — ED-R 424 Neckarwestheim", value: "+497133180" },
  ],
  "427": [
    { type: "email", label: "Betreiber — ED-R 427 Geesthacht", value: "kontakt@hereon.de" },
    { type: "phone", label: "Betreiber — ED-R 427 Geesthacht", value: "+4941527010" },
  ],
  "450": [
    { type: "email", label: "Betreiber — ED-R 450 Wartburg", value: "info@wartburg.de" },
    { type: "phone", label: "Betreiber — ED-R 450 Wartburg", value: "+493691250" },
  ],
  "451": [
    { type: "email", label: "Betreiber — ED-R 451 Greifswald", value: "info@ewn-gmbh.de" },
    { type: "phone", label: "Betreiber — ED-R 451 Greifswald", value: "+49383486150" },
  ],
  "452": [
    { type: "email", label: "Betreiber — ED-R 452 Rheinsberg", value: "info@ewn-gmbh.de" },
    { type: "phone", label: "Betreiber — ED-R 452 Rheinsberg", value: "+49338318210" },
  ],
  "453": [
    { type: "email", label: "Betreiber — ED-R 453 Rossendorf", value: "kontakt@vkta.de" },
    { type: "phone", label: "Betreiber — ED-R 453 Rossendorf", value: "+493512600" },
  ],
  "146": [
    { type: "email", label: "BAF — ED-R 146 Berlin", value: "drohne@baf.bund.de" },
    { type: "phone", label: "BAF — ED-R 146 Berlin", value: "+496103707290" },
  ],
};

export const CTR_ZONE_CONTACTS: Record<string, GeozoneContact[]> = {
  "Berlin Brandenburg": [
    { type: "email", label: "DFS — Berlin Brandenburg (BER)", value: "tower-ber@dfs.de" },
    { type: "phone", label: "DFS — Berlin Brandenburg (BER)", value: "+493060916131" },
  ],
  "Bremen": [
    { type: "email", label: "DFS — Bremen (BRE)", value: "tower-bre@dfs.de" },
    { type: "phone", label: "DFS — Bremen (BRE)", value: "+494215592451" },
  ],
  "Dresden": [
    { type: "email", label: "DFS — Dresden (DRS)", value: "tower-drs@dfs.de" },
    { type: "phone", label: "DFS — Dresden (DRS)", value: "+493512131146" },
  ],
  "Düsseldorf": [
    { type: "email", label: "DFS — Düsseldorf (DUS)", value: "tower-dus@dfs.de" },
    { type: "phone", label: "DFS — Düsseldorf (DUS)", value: "+492114212451" },
  ],
  "Erfurt": [
    { type: "email", label: "DFS — Erfurt-Weimar (ERF)", value: "tower-erf@dfs.de" },
    { type: "phone", label: "DFS — Erfurt-Weimar (ERF)", value: "+493614580201" },
  ],
  "Frankfurt Main": [
    { type: "email", label: "DFS — Frankfurt Main (FRA)", value: "tower-fra@dfs.de" },
    { type: "phone", label: "DFS — Frankfurt Main (FRA)", value: "+496969024451" },
  ],
  "Hamburg": [
    { type: "email", label: "DFS — Hamburg (HAM)", value: "tower-ham@dfs.de" },
    { type: "phone", label: "DFS — Hamburg (HAM)", value: "+4940507522451" },
  ],
  "Hannover": [
    { type: "email", label: "DFS — Hannover (HAJ)", value: "tower-haj@dfs.de" },
    { type: "phone", label: "DFS — Hannover (HAJ)", value: "+495119772451" },
  ],
  "Köln": [
    { type: "email", label: "DFS — Köln/Bonn (CGN)", value: "tower-cgn@dfs.de" },
    { type: "phone", label: "DFS — Köln/Bonn (CGN)", value: "+492203402451" },
  ],
  "Leipzig": [
    { type: "email", label: "DFS — Leipzig/Halle (LEJ)", value: "tower-lej@dfs.de" },
    { type: "phone", label: "DFS — Leipzig/Halle (LEJ)", value: "+493412240451" },
  ],
  "München": [
    { type: "email", label: "DFS — München (MUC)", value: "tower-muc@dfs.de" },
    { type: "phone", label: "DFS — München (MUC)", value: "+498997524451" },
    { type: "email", label: "AustroControl — München (MUC)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Münster": [
    { type: "email", label: "DFS — Münster/Osnabrück (FMO)", value: "tower-fmo@dfs.de" },
    { type: "phone", label: "DFS — Münster/Osnabrück (FMO)", value: "+492571940451" },
    { type: "email", label: "AustroControl — Münster/Osnabrück (FMO)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Nürnberg": [
    { type: "email", label: "DFS — Nürnberg (NUE)", value: "tower-nue@dfs.de" },
    { type: "phone", label: "DFS — Nürnberg (NUE)", value: "+49911935451" },
    { type: "email", label: "AustroControl — Nürnberg (NUE)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Saarbrücken": [
    { type: "email", label: "DFS — Saarbrücken (SCN)", value: "tower-scn@dfs.de" },
    { type: "phone", label: "DFS — Saarbrücken (SCN)", value: "+496893832451" },
    { type: "email", label: "AustroControl — Saarbrücken (SCN)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Stuttgart": [
    { type: "email", label: "DFS — Stuttgart (STR)", value: "tower-str@dfs.de" },
    { type: "phone", label: "DFS — Stuttgart (STR)", value: "+497117948451" },
    { type: "email", label: "AustroControl — Stuttgart (STR)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Braunschweig": [
    { type: "email", label: "DFS Aviation — Braunschweig (BWE)", value: "TWR-BWE@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Braunschweig (BWE)", value: "+495312952391" },
  ],
  "Dortmund": [
    { type: "email", label: "DFS Aviation — Dortmund (DTM)", value: "TWR-DTM@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Dortmund (DTM)", value: "+492319211024" },
  ],
  "Friedrichshafen": [
    { type: "email", label: "DFS Aviation — Friedrichshafen (FDH)", value: "TWR-FDH@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Friedrichshafen (FDH)", value: "+497541284251" },
  ],
  "Karlsruhe": [
    { type: "email", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "TWR-FKB@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Karlsruhe/Baden-Baden (FKB)", value: "+497229662821" },
  ],
  "Lahr": [
    { type: "email", label: "DFS Aviation — Lahr (LHA)", value: "TWR-LHA@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Lahr (LHA)", value: "+497821959110" },
  ],
  "Magdeburg": [
    { type: "email", label: "DFS Aviation — Magdeburg-Cochstedt (CSO)", value: "TWR-CSO@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Magdeburg-Cochstedt (CSO)", value: "+493925784423" },
  ],
  "Memmingen": [
    { type: "email", label: "DFS Aviation — Memmingen (FMM)", value: "TWR-FMM@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Memmingen (FMM)", value: "+498331984421" },
  ],
  "Mönchengladbach": [
    { type: "email", label: "DFS Aviation — Mönchengladbach (MGL)", value: "TWR-MGL@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Mönchengladbach (MGL)", value: "+492161682920" },
  ],
  "Niederrhein": [
    { type: "email", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "TWR-NRN@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Niederrhein/Weeze (NRN)", value: "+492837664991" },
  ],
  "Paderborn": [
    { type: "email", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "TWR-PAD@dfs-as.aero" },
    { type: "phone", label: "DFS Aviation — Paderborn-Lippstadt (PAD)", value: "+492955774251" },
  ],
  "Augsburg": [
    { type: "email", label: "AustroControl — Augsburg (AGB)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Frankfurt/Hahn": [
    { type: "email", label: "AustroControl — Frankfurt/Hahn (HHN)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Heringsdorf": [
    { type: "email", label: "AustroControl — Heringsdorf (HDF)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Lübeck": [
    { type: "email", label: "AustroControl — Lübeck (LBC)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Hof": [
    { type: "email", label: "AustroControl — Hof/Plauen (HOQ)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Kassel": [
    { type: "email", label: "AustroControl — Kassel/Calden (KSF)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Sylt": [
    { type: "email", label: "AustroControl — Sylt (GWT)", value: "flugplatzkontrolle@uas-betrieb.de" },
  ],
  "Oberpfaffenhofen": [
    { type: "email", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "uas@triac-gmbh.de" },
    { type: "phone", label: "TRIAC — Oberpfaffenhofen (OBF)", value: "+498153282116" },
  ],
};

export function getContactsForZone(layerLabelOrId: string, zoneName?: string): GeozoneContact[] {
  const allLayers = Object.values(COUNTRY_GEOZONE_CONFIGS).flatMap((c) => c.layers);
  const layer = allLayers.find((l) => l.label === layerLabelOrId || l.id === layerLabelOrId);
  const layerId = layer?.id;
  const regInfo = layerId ? GEOZONE_REGULATORY_INFO[layerId] : null;
  const fallbackContacts = regInfo?.contacts || [];

  if (!zoneName) return fallbackContacts;

  if (layerId === "flugbeschraenkungsgebiete") {
    const m = zoneName.match(/ED-R\s+(\d+)/i);
    if (m) {
      const zoneContacts = EDR_ZONE_CONTACTS[m[1]];
      if (zoneContacts) return zoneContacts;
    }
    return fallbackContacts;
  }

  if (layerId === "kontrollzonen") {
    const ctrName = zoneName.replace(/^CTR\s+/i, "").replace(/\s*\(.*$/, "").trim().toLowerCase();
    const keys = Object.keys(CTR_ZONE_CONTACTS);
    const exact = keys.find((k) => k.toLowerCase() === ctrName);
    if (exact) return CTR_ZONE_CONTACTS[exact];
    const sorted = [...keys].sort((a, b) => b.length - a.length);
    for (const key of sorted) {
      if (ctrName.includes(key.toLowerCase())) {
        return CTR_ZONE_CONTACTS[key];
      }
    }
    return fallbackContacts;
  }

  return fallbackContacts;
}

export const ALWAYS_VISIBLE_LAYERS = new Set([
  "kontrollzonen",
  "flugbeschraenkungsgebiete",
  "temporaere_betriebseinschraenkungen",
  "flughaefen",
  "flugplaetze",
]);

export function getAlwaysVisibleLayers(countryIso?: string): Set<string> {
  const config = getCountryGeozoneConfig(countryIso);
  return new Set(config.alwaysVisibleLayerIds);
}

export const WMS_BASE_URL = "https://uas-betrieb.de/geoservices/dipul/wms";

function buildWmsGetMapUrl(baseUrl: string, version: string, layers: string[]): string {
  if (layers.length === 0) return "";
  const layerStr = layers.join(",");
  const crsParam = version === "1.3.0" ? "CRS" : "srs";
  return `${baseUrl}?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap&LAYERS=${layerStr}&STYLES=&${crsParam}=EPSG:3857&BBOX={minX},{minY},{maxX},{maxY}&WIDTH={width}&HEIGHT={height}&FORMAT=image/png&TRANSPARENT=true`;
}

export function buildWmsTileUrl(layerName: string, countryIso?: string): string {
  const config = getCountryGeozoneConfig(countryIso);
  return buildWmsGetMapUrl(config.wmsBaseUrl, config.wmsVersion, [layerName]);
}

export function buildCombinedWmsTileUrl(layers: string[], countryIso?: string): string {
  const config = getCountryGeozoneConfig(countryIso);
  return buildWmsGetMapUrl(config.wmsBaseUrl, config.wmsVersion, layers);
}

function getStorageKeyForCountry(countryIso?: string): string {
  const iso = countryIso?.toUpperCase() || "DE";
  if (iso === "DE") return GEOZONES_KEY;
  return `${GEOZONES_KEY}_${iso}`;
}

export async function loadGeozoneSettings(countryIso?: string): Promise<Record<string, boolean>> {
  const config = getCountryGeozoneConfig(countryIso);
  const defaults: Record<string, boolean> = {};
  for (const layer of config.layers) {
    defaults[layer.id] = layer.defaultEnabled;
  }
  try {
    const key = getStorageKeyForCountry(countryIso);
    const stored = await AsyncStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, boolean>;
      const merged = { ...defaults, ...parsed };
      for (const id of config.forceEnabledLayerIds) {
        if (parsed[id] === false && defaults[id] === true) {
          merged[id] = true;
          delete parsed[id];
          await AsyncStorage.setItem(key, JSON.stringify(parsed));
        }
      }
      return merged;
    }
  } catch {
  }
  return defaults;
}

export async function saveGeozoneSettings(settings: Record<string, boolean>, countryIso?: string): Promise<void> {
  try {
    const key = getStorageKeyForCountry(countryIso);
    await AsyncStorage.setItem(key, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving geozone settings:", error);
  }
}

export type MapStyleOption = "standard" | "satellite" | "osm";

export const MAP_STYLES: { id: MapStyleOption; label: string; icon?: string }[] = [
  { id: "standard", label: "Standard", icon: "map" },
  { id: "satellite", label: "Satellit", icon: "globe" },
  { id: "osm", label: "OSM", icon: "layers" },
];

export async function loadMapStyle(): Promise<MapStyleOption> {
  try {
    const stored = await AsyncStorage.getItem(MAP_STYLE_KEY);
    if (stored && MAP_STYLES.some((s) => s.id === stored)) {
      return stored as MapStyleOption;
    }
  } catch {}
  return "standard";
}

export async function saveMapStyle(style: MapStyleOption): Promise<void> {
  try {
    await AsyncStorage.setItem(MAP_STYLE_KEY, style);
  } catch {}
}

const RADAR_SETTINGS_KEY = "@preflight/radar_settings";

export interface RadarDisplaySettings {
  radiusKm: number;
  showRadar: boolean;
  showTraffic: boolean;
  showWindsock: boolean;
  showGeozones: boolean;
  showWeatherOverlay: boolean;
  controlsExpanded: boolean;
}

const DEFAULT_RADAR_SETTINGS: RadarDisplaySettings = {
  radiusKm: 10,
  showRadar: true,
  showTraffic: true,
  showWindsock: true,
  showGeozones: true,
  showWeatherOverlay: false,
  controlsExpanded: false,
};

export async function loadRadarSettings(): Promise<RadarDisplaySettings> {
  try {
    const stored = await AsyncStorage.getItem(RADAR_SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_RADAR_SETTINGS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_RADAR_SETTINGS };
}

export async function saveRadarSettings(settings: Partial<RadarDisplaySettings>): Promise<void> {
  try {
    const current = await loadRadarSettings();
    const merged = { ...current, ...settings };
    await AsyncStorage.setItem(RADAR_SETTINGS_KEY, JSON.stringify(merged));
  } catch {}
}

export function getActiveLayerNames(settings: Record<string, boolean>, countryIso?: string): string[] {
  const layers = getCountryGeozoneLayers(countryIso);
  return layers
    .filter((l) => settings[l.id])
    .map((l) => l.wmsLayer);
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

function lonToMercX(lon: number): number {
  return (lon / 180) * 20037508.34;
}

function latToMercY(lat: number): number {
  const r = degToRad(lat);
  return (Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) * 20037508.34;
}

export interface GeozoneFeatureInfo {
  layerLabel: string;
  name: string;
  details: string;
  featureId?: string;
}

export const TEMP_RESTRICTION_LAYER_LABEL = "Temporäre Beschränkungen";

export interface DipulTempRestriction {
  id: string;
  extRef: string;
  name: string;
  names: string[];
  genNames: string[];
  type: string;
  legalRef: string;
  legalExplanation: string;
  category: "military" | "notam" | "nature" | "other";
  lowerAlt: number;
  lowerAltRef: string;
  lowerAltUnit: string;
  upperAlt: number;
  upperAltRef: string;
  upperAltUnit: string;
  status: "active" | "upcoming";
  startTs: string | null;
  endTs: string | null;
  endTsIndefinite: boolean;
  recurRules: string[] | null;
  centerLat: number | null;
  centerLon: number | null;
  radiusM: number | null;
  polygonRings: [number, number][][] | null;
  kind?: "mil_low_flight_day";
}

function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1];
    const yj = ring[j][0], xj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(lat: number, lon: number, rings: [number, number][][]): boolean {
  for (const ring of rings) {
    if (pointInRing(lat, lon, ring)) return true;
  }
  return false;
}

const DIPUL_TOKEN_URL = "https://uas-betrieb.dfs.de/api/token/v1/anonymous/bmdv/token";
const DIPUL_GEOAPI_URL = "https://dipul-service.dfs.de/api/geoapi/dipul/v4/affectedAreas";

let cachedToken: { token: string; expiry: number } | null = null;

async function getDipulToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiry) return cachedToken.token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(DIPUL_TOKEN_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) throw new Error("Token request failed");
    const data = await resp.json();
    const token = data.token as string;
    const expMs = data.expiration ? new Date(data.expiration).getTime() - 30000 : Date.now() + 240000;
    cachedToken = { token, expiry: expMs };
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

const LUFT_VO_21H_EXPLANATIONS: Record<string, { explanation: string; category: "military" | "notam" | "nature" | "other" }> = {
  "1": { explanation: "Flugplätze und Flughäfen", category: "other" },
  "2": { explanation: "Kontrollzonen", category: "other" },
  "3": { explanation: "Industrieanlagen, Kraftwerke und JVA", category: "other" },
  "4": { explanation: "Verfassungsorgane, Behörden und Botschaften", category: "other" },
  "5": { explanation: "Bundesfernstraßen, Bundeswasserstraßen und Bahnanlagen", category: "other" },
  "6": { explanation: "Naturschutzgebiete", category: "nature" },
  "7": { explanation: "Wohngrundstücke", category: "other" },
  "8": { explanation: "Menschenansammlungen", category: "other" },
  "9": { explanation: "Einsatzorte von Polizei und Rettungskräften", category: "other" },
  "10": { explanation: "Krankenhäuser", category: "other" },
  "11": { explanation: "Militärische Anlagen und Organisationen", category: "military" },
};

function parse21hNumber(legalRef: string): string | null {
  const m = legalRef.match(/Abs\.\s*3\s*\(?(\d+)/);
  if (m) return m[1];
  const m2 = legalRef.match(/Nr\.\s*(\d+)/);
  if (m2) return m2[1];
  const m3 = legalRef.match(/\((\d+)\.\)/);
  if (m3) return m3[1];
  const m4 = legalRef.match(/\((\d+)\)/);
  if (m4) return m4[1];
  return null;
}

const TYPE_CODE_TO_21H: Record<string, string> = {
  FLUGPLATZ: "1", HUBSCHRAUBERLANDEPLATZ: "1", SEGELFLUGGELAENDE: "1",
  KONTROLLZONE: "2",
  INDUSTRIEANLAGE: "3", KRAFTWERK: "3", JVA: "3",
  VERFASSUNGSORGAN: "4", BOTSCHAFT: "4", POLIZEI: "4", SICHERHEITSBEHOERDE: "4",
  BUNDESFERNSTRASSE: "5", BUNDESWASSERSTRASSE: "5", BAHNANLAGE: "5", BUNDESAUTOBAHN: "5",
  NATURSCHUTZGEBIET: "6", NATIONALPARK: "6", LANDSCHAFTSSCHUTZGEBIET: "6", VOGELSCHUTZGEBIET: "6",
  WOHNGEBIET: "7",
  MENSCHENANSAMMLUNG: "8", FREIBAD: "8",
  FEUERWEHR: "9", KATASTROPHENSCHUTZ: "9", UNFALL: "9",
  KRANKENHAUS: "10",
  MILITAERISCHE_ANLAGE: "11",
};

function classifyLegalRef(legalRef: string, name: string, typeCode?: string): { explanation: string; category: "military" | "notam" | "nature" | "other" } {
  if (legalRef.includes("§ 17") && legalRef.includes("LuftVO")) {
    return { explanation: "Flugbeschränkungsgebiet (militärisch)", category: "military" };
  }
  if (legalRef.includes("§ 21h") && legalRef.includes("LuftVO")) {
    if (legalRef.includes("Abs. 4")) {
      return { explanation: "Erprobungszentrum / Sondergebiet", category: "other" };
    }
    const tcNum = typeCode ? TYPE_CODE_TO_21H[typeCode] || TYPE_CODE_TO_21H[typeCode.toUpperCase()] : null;
    if (tcNum && LUFT_VO_21H_EXPLANATIONS[tcNum]) {
      return LUFT_VO_21H_EXPLANATIONS[tcNum];
    }
    const num = parse21hNumber(legalRef);
    if (num && LUFT_VO_21H_EXPLANATIONS[num]) {
      return LUFT_VO_21H_EXPLANATIONS[num];
    }
    return { explanation: "Geografisches UAS-Gebiet (§ 21h LuftVO)", category: "other" };
  }
  if (legalRef.includes("§ 29") && legalRef.includes("Luftverkehrsgesetz")) {
    return { explanation: "Allg. Beschränkung per NOTAM (LuftVG)", category: "notam" };
  }
  if (legalRef.includes("§ 21a") || legalRef.includes("§ 21b")) {
    return { explanation: "UAS-Betriebsbeschränkung", category: "other" };
  }
  if (name.startsWith("ED-R")) {
    return { explanation: "Restricted Area", category: "military" };
  }
  if (name.toLowerCase().startsWith("notam")) {
    return { explanation: "Temporäre NOTAM-Beschränkung", category: "notam" };
  }
  return { explanation: "Temporäre Betriebseinschränkung", category: "other" };
}

export interface DipulTempRestrictionsResult {
  active: DipulTempRestriction[];
  upcoming: DipulTempRestriction[];
}

async function fetchGeoapi(token: string, body: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${DIPUL_GEOAPI_URL}?typeCode=U_NFZ&locale=de`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
  });
}

function parseGeoApiResponse(data: any): DipulTempRestrictionsResult {
  if (!data.affectedAreas || !Array.isArray(data.affectedAreas)) {
    return { active: [], upcoming: [] };
  }

  const now = new Date();
  const active: DipulTempRestriction[] = [];
  const upcoming: DipulTempRestriction[] = [];
  const seen = new Set<string>();

  for (const area of data.affectedAreas) {
    if (area.legalRef === "Test zone on prod") continue;

    const legalRef = area.legalRef || "";
    const areaTypeCode = area.typeCode || "";
    const { explanation, category } = classifyLegalRef(legalRef, "", areaTypeCode);

    const rawName = area.names?.[0] || area.genNames?.[0] || "";
    const name = (!rawName || rawName === "null" || rawName === "undefined")
      ? (explanation || area.typeCode || "Unbekannt")
      : rawName;
    const id = area.extRef || `${area.typeCode}-${name}-${area.startTs || ""}-${area.endTs || ""}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const startDate = area.startTs ? new Date(area.startTs) : null;
    const endDate = area.endTs ? new Date(area.endTs) : null;
    const endYear = endDate ? endDate.getFullYear() : 0;
    const endTsIndefinite = endYear >= 2099;
    const isActive = startDate && endDate ? startDate <= now && (endTsIndefinite || endDate >= now) : true;
    const isFuture = startDate ? startDate > now : false;

    let centerLon: number | null = null;
    let centerLat: number | null = null;
    let areaRadiusM: number | null = null;
    let polygonRings: [number, number][][] | null = null;
    if (area.geometry) {
      const geo = area.geometry;
      if (geo.type === "Point" && Array.isArray(geo.coordinates)) {
        centerLon = geo.coordinates[0];
        centerLat = geo.coordinates[1];
      } else if (geo.type === "Polygon" && Array.isArray(geo.coordinates) && geo.coordinates[0]) {
        const ring = geo.coordinates[0] as number[][];
        let sumLon = 0, sumLat = 0;
        for (const c of ring) { sumLon += c[0]; sumLat += c[1]; }
        centerLon = sumLon / ring.length;
        centerLat = sumLat / ring.length;
        polygonRings = [ring.map((c) => [c[1], c[0]] as [number, number])];
      } else if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
        let sumLon = 0, sumLat = 0, count = 0;
        const rings: [number, number][][] = [];
        for (const poly of geo.coordinates) {
          if (Array.isArray(poly) && poly[0]) {
            const outerRing = poly[0] as number[][];
            rings.push(outerRing.map((c) => [c[1], c[0]] as [number, number]));
            for (const c of outerRing) { sumLon += c[0]; sumLat += c[1]; count++; }
          }
        }
        if (count > 0) { centerLon = sumLon / count; centerLat = sumLat / count; }
        if (rings.length > 0) polygonRings = rings;
      }
    }
    if (centerLat == null && area.centerLat != null) centerLat = area.centerLat;
    if (centerLon == null && area.centerLon != null) centerLon = area.centerLon;
    if (area.properties?.subType === "Circle" && area.properties?.radius) {
      areaRadiusM = area.properties.radius;
    }
    if (area.radius) {
      areaRadiusM = area.radius;
    }

    const restriction: DipulTempRestriction = {
      id,
      extRef: area.extRef || "",
      name,
      names: area.names || [],
      genNames: area.genNames || [],
      type: area.typeCode || "U_NFZ",
      legalRef,
      legalExplanation: explanation,
      category,
      lowerAlt: area.lowerAlt ?? 0,
      lowerAltRef: area.lowerAltRef || "AGL",
      lowerAltUnit: area.lowerAltUnit || "m",
      upperAlt: area.upperAlt ?? 0,
      upperAltRef: area.upperAltRef || "AGL",
      upperAltUnit: area.upperAltUnit || "m",
      status: isFuture ? "upcoming" : "active",
      startTs: area.startTs || null,
      endTs: area.endTs || null,
      endTsIndefinite,
      recurRules: area.recurRules && Array.isArray(area.recurRules) ? area.recurRules : null,
      centerLat,
      centerLon,
      radiusM: areaRadiusM,
      polygonRings,
    };

    if (isFuture) {
      upcoming.push(restriction);
    } else if (isActive) {
      active.push(restriction);
    }
  }

  active.sort((a, b) => {
    if (a.endTs && b.endTs) return new Date(a.endTs).getTime() - new Date(b.endTs).getTime();
    return 0;
  });
  upcoming.sort((a, b) => {
    if (a.startTs && b.startTs) return new Date(a.startTs).getTime() - new Date(b.startTs).getTime();
    return 0;
  });

  return { active, upcoming };
}

async function fetchDipulGeoapi(lon: number, lat: number, radiusM: number): Promise<DipulTempRestrictionsResult> {
  let token = await getDipulToken();

  const body = JSON.stringify({
    type: "Feature",
    properties: {
      subType: "Circle",
      radius: radiusM,
      altitude: { value: 120, altitudeReference: "AGL", unit: "m" },
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    let resp = await fetchGeoapi(token, body, controller.signal);

    if (resp.status === 401) {
      cachedToken = null;
      token = await getDipulToken();
      resp = await fetchGeoapi(token, body, controller.signal);
    }

    if (!resp.ok) throw new Error(`Geoapi returned ${resp.status}`);
    const data = await resp.json();
    return parseGeoApiResponse(data);
  } finally {
    clearTimeout(timeout);
  }
}

function mergeMilLowFlight(
  data: DipulTempRestrictionsResult,
  extra: DipulTempRestriction[]
): DipulTempRestrictionsResult {
  if (extra.length === 0) return data;
  const existingIds = new Set(data.active.map((r) => r.id));
  const merged = [...data.active];
  for (const e of extra) if (!existingIds.has(e.id)) merged.push(e);
  return { active: merged, upcoming: data.upcoming };
}

export async function fetchAllTempRestrictions(): Promise<DipulTempRestrictionsResult> {
  const { getAllMilLowFlightRestrictions } = await import("@/lib/milLowFlight");
  try {
    const data = await fetchDipulGeoapi(10.4515, 51.1657, 600000);
    setCache("dipul_all", data).catch(() => {});
    return mergeMilLowFlight(data, getAllMilLowFlightRestrictions());
  } catch (err) {
    const cached = await getCached<DipulTempRestrictionsResult>("dipul_all");
    if (cached) return mergeMilLowFlight(cached.data, getAllMilLowFlightRestrictions());
    throw err;
  }
}

export async function fetchNearbyTempRestrictions(lat: number, lon: number, radiusKm: number): Promise<DipulTempRestrictionsResult> {
  const { getNearbyMilLowFlightRestrictions } = await import("@/lib/milLowFlight");
  const radiusM = Math.max(radiusKm * 1000, 5000);
  const ck = makeCacheKey("dipul_nearby", lat, lon);
  const milExtra = getNearbyMilLowFlightRestrictions(lat, lon, Math.max(radiusKm, 5));
  try {
    const data = await fetchDipulGeoapi(lon, lat, radiusM);
    setCache(ck, data).catch(() => {});
    return mergeMilLowFlight(data, milExtra);
  } catch (err) {
    const cached = await getCached<DipulTempRestrictionsResult>(ck);
    if (cached) return mergeMilLowFlight(cached.data, milExtra);
    throw err;
  }
}

/**
 * Same as fetchNearbyTempRestrictions, but without merging the synthetic
 * mil low-flight polygons (which are always synthesised as `active`). Use
 * this when callers need to derive the *real* live activation status of
 * mil low-flight areas via deriveMilLowFlightStatuses /
 * classifyMilLowFlightHits, where the synthetic entries would otherwise
 * be misinterpreted as "currently active".
 */
export async function fetchNearbyTempRestrictionsRaw(lat: number, lon: number, radiusKm: number): Promise<DipulTempRestrictionsResult> {
  const radiusM = Math.max(radiusKm * 1000, 5000);
  const ck = makeCacheKey("dipul_nearby", lat, lon);
  try {
    const data = await fetchDipulGeoapi(lon, lat, radiusM);
    setCache(ck, data).catch(() => {});
    return data;
  } catch (err) {
    const cached = await getCached<DipulTempRestrictionsResult>(ck);
    if (cached) return cached.data;
    throw err;
  }
}

export const EDR_LAYER_LABEL = "Flugbeschränkungsgebiete (ED-R)";
export const LU_TEMP_ZONE_LABEL = "LU Aktivierbare UAS-Zonen";

export function buildDipulLink(name: string): string | null {
  if (!name || name.length < 3) return null;
  if (!name.match(/^ED-R\s/i)) return null;
  const slug = name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return null;
  return `https://www.dipul.de/homepage/de/temporaere-betriebseinschraenkungen/${slug}/`;
}

export function separateTempRestrictions(zones: GeozoneFeatureInfo[]): {
  geozones: GeozoneFeatureInfo[];
  tempRestrictions: GeozoneFeatureInfo[];
} {
  const geozones: GeozoneFeatureInfo[] = [];
  const tempRestrictions: GeozoneFeatureInfo[] = [];
  const seenNames = new Set<string>();
  for (const z of zones) {
    if (z.layerLabel === TEMP_RESTRICTION_LAYER_LABEL || z.layerLabel === EDR_LAYER_LABEL || z.layerLabel === LU_TEMP_ZONE_LABEL) {
      const normName = z.name.replace(/^ED-R\s*/i, "").trim().toLowerCase();
      if (seenNames.has(normName)) continue;
      seenNames.add(normName);
      tempRestrictions.push(z);
    } else {
      geozones.push(z);
    }
  }
  return { geozones, tempRestrictions };
}

export function getAllDefaultEnabledLayerNames(countryIso?: string): string[] {
  const layers = getCountryGeozoneLayers(countryIso);
  return layers
    .filter((l) => l.defaultEnabled)
    .map((l) => l.wmsLayer);
}

export function getAllLayerNames(countryIso?: string): string[] {
  return getCountryGeozoneLayers(countryIso).map((l) => l.wmsLayer);
}

async function queryChRestIdentifySingle(
  lat: number,
  lon: number,
  radiusKm: number,
  layerLookup: Record<string, string>,
): Promise<GeozoneFeatureInfo[]> {
  const config = COUNTRY_GEOZONE_CONFIGS.CH;
  if (!config.restIdentifyUrl || !config.restIdentifyLayers) return [];

  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  const minLon = (lon - dLon).toFixed(5);
  const minLat = (lat - dLat).toFixed(5);
  const maxLon = (lon + dLon).toFixed(5);
  const maxLat = (lat + dLat).toFixed(5);
  const imgSize = 1000;

  const url = `${config.restIdentifyUrl}?geometry=${lon},${lat}`
    + `&geometryType=esriGeometryPoint`
    + `&layers=all:${config.restIdentifyLayers.join(",")}`
    + `&sr=4326&returnGeometry=false&tolerance=10`
    + `&mapExtent=${minLon},${minLat},${maxLon},${maxLat}&imageDisplay=${imgSize},${imgSize},96`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return parseChIdentifyResponse(data, layerLookup);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function queryChRestIdentify(
  lat: number,
  lon: number,
  radiusKm: number = 1,
): Promise<GeozoneFeatureInfo[]> {
  const config = COUNTRY_GEOZONE_CONFIGS.CH;
  const layerLookup: Record<string, string> = {};
  for (const l of config.layers) {
    layerLookup[l.wmsLayer] = l.label;
  }

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -1], [0, 1],
    [1, 0], [-1, 0],
    [0.7, 0.7], [-0.7, 0.7],
    [0.7, -0.7], [-0.7, -0.7],
  ];
  const samplePoints = sampleOffsets.map(([fy, fx]) => [lat + fy * dLat, lon + fx * dLon] as [number, number]);

  const results = await Promise.all(
    samplePoints.map(([sLat, sLon]) => queryChRestIdentifySingle(sLat, sLon, 0.5, layerLookup).catch(() => [] as GeozoneFeatureInfo[]))
  );

  const seen = new Set<string>();
  const allResults: GeozoneFeatureInfo[] = [];
  for (const zones of results) {
    for (const z of zones) {
      const key = `${z.layerLabel}|${z.name}|${z.details}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(z);
    }
  }

  return allResults;
}

function parseChIdentifyResponse(data: any, layerLookup: Record<string, string>): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  if (!data.results || !Array.isArray(data.results)) return results;

  for (const feature of data.results) {
    const attrs = feature.attributes || feature.properties || {};
    const layerId = feature.layerBodId || feature.layerName || "";
    const layerLabel = layerLookup[layerId] || layerId;

    const name = attrs.zone_name_de || attrs.zone_name || attrs.name_de || attrs.name || attrs.bezeichnung || layerLabel;

    const detailParts: string[] = [];

    const restriction = attrs.zone_restriction_de || attrs.zone_restriction;
    if (restriction) detailParts.push(`Einschränkung: ${restriction}`);

    const description = attrs.description_de || attrs.description;
    if (description && !restriction) detailParts.push(`Beschreibung: ${description}`);

    const message = attrs.zone_message_de || attrs.zone_message;
    if (message) detailParts.push(`Hinweis: ${message}`);

    const reason = attrs.zone_reason_id;
    if (reason) detailParts.push(`Grund: ${reason.replace(/_/g, " ")}`);

    const authNames = attrs.auth_name_de || attrs.auth_name;
    if (authNames) {
      const names = Array.isArray(authNames) ? authNames.filter(Boolean).join(", ") : String(authNames);
      if (names) detailParts.push(`Behörde: ${names}`);
    }

    const authService = attrs.auth_service_de || attrs.auth_service;
    if (authService) {
      const svc = Array.isArray(authService) ? authService.filter(Boolean).join(", ") : String(authService);
      if (svc) detailParts.push(`Dienst: ${svc}`);
    }

    const authEmails = attrs.auth_email || attrs.auth_contact;
    if (authEmails) {
      const emails = Array.isArray(authEmails) ? authEmails.filter(Boolean).join(", ") : String(authEmails);
      if (emails) detailParts.push(`E-Mail: ${emails}`);
    }

    const authPhones = attrs.auth_phone;
    if (authPhones) {
      const phones = Array.isArray(authPhones) ? authPhones.filter(Boolean).join(", ") : String(authPhones);
      if (phones) detailParts.push(`Telefon: ${phones}`);
    }

    const authUrls = attrs.auth_url_de || attrs.auth_url;
    if (authUrls) {
      const urls = Array.isArray(authUrls) ? authUrls.filter(Boolean).join(", ") : String(authUrls);
      if (urls) detailParts.push(`Info: ${urls}`);
    }

    if (attrs.air_vol_lower_limit != null || attrs.air_vol_upper_limit != null) {
      const lower = attrs.air_vol_lower_limit != null ? `${attrs.air_vol_lower_limit} m ${attrs.air_vol_lower_vref || ""}`.trim() : "SFC";
      const upper = attrs.air_vol_upper_limit != null ? `${attrs.air_vol_upper_limit} m ${attrs.air_vol_upper_vref || ""}`.trim() : "unbegrenzt";
      detailParts.push(`Höhe: ${lower} – ${upper}`);
    }

    if (attrs.time_permanent === "Yes") {
      detailParts.push("Gültigkeit: dauerhaft");
    } else if (attrs.time_start || attrs.time_end) {
      detailParts.push(`Gültigkeit: ${attrs.time_start || "?"} – ${attrs.time_end || "?"}`);
    }

    if (detailParts.length === 0 && !name) continue;

    results.push({
      layerLabel,
      name: String(name),
      details: detailParts.join("\n"),
      featureId: attrs.label || feature.id || undefined,
    });
  }

  return results;
}

function parseLuWmsPlainText(text: string): Record<string, string>[] {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  const results: Record<string, string>[] = [];
  for (const block of blocks) {
    const props: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const idx = line.indexOf(" : ");
      if (idx < 0) continue;
      const key = line.substring(0, idx).trim();
      const val = line.substring(idx + 3).trim();
      props[key] = val;
    }
    if (Object.keys(props).length > 0) results.push(props);
  }
  return results;
}

function luWmsDateToDisplay(dateStr: string): string {
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return dateStr;
  return `${m[1]}.${m[2]}.${m[3]}, ${m[4]}:${m[5]}`;
}

function luWmsDateToMs(dateStr: string): number {
  const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss || "00"}`;
  const d = new Date(iso);
  return d.getTime();
}

async function queryLuWmsFeatureInfo(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<Record<string, string>[]> {
  const lonToMercXLocal = (l: number) => (l * 20037508.34) / 180;
  const latToMercYLocal = (la: number) => {
    const r = Math.log(Math.tan(((90 + la) * Math.PI) / 360)) * 20037508.34 / Math.PI;
    return r;
  };
  const halfM = radiusKm * 1000;
  const cx = lonToMercXLocal(lon);
  const cy = latToMercYLocal(lat);

  const bbox = `${cx - halfM},${cy - halfM},${cx + halfM},${cy + halfM}`;
  const url = `https://wms.geoportail.lu/public_map_layers/service?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
    + `&LAYERS=1927,1928&QUERY_LAYERS=1927,1928`
    + `&SRS=EPSG:3857&BBOX=${bbox}`
    + `&WIDTH=256&HEIGHT=256&X=128&Y=128`
    + `&INFO_FORMAT=text/plain&FEATURE_COUNT=50`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return [];
    const text = await resp.text();
    if (!text || text.trim() === "no features were found") return [];
    return parseLuWmsPlainText(text);
  } catch (e: any) {
    console.warn("[Geozones] LU WMS FeatureInfo error:", e?.message || e);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function queryLuOgcFeatures(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<GeozoneFeatureInfo[]> {
  const lonToMercXLocal = (l: number) => (l * 20037508.34) / 180;
  const latToMercYLocal = (la: number) => Math.log(Math.tan(((90 + la) * Math.PI) / 360)) * 20037508.34 / Math.PI;

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -0.7], [0, 0.7],
    [0.7, 0], [-0.7, 0],
    [0.5, 0.5], [-0.5, 0.5],
    [0.5, -0.5], [-0.5, -0.5],
  ];

  const localHalfM = 500;
  const imgSize = 256;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const results = await Promise.all(
      sampleOffsets.map(async ([oLat, oLon]) => {
        const sLat = lat + oLat * dLat;
        const sLon = lon + oLon * dLon;
        const cx = lonToMercXLocal(sLon);
        const cy = latToMercYLocal(sLat);
        const bbox = `${cx - localHalfM},${cy - localHalfM},${cx + localHalfM},${cy + localHalfM}`;
        const url = `https://wms.geoportail.lu/public_map_layers/service?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo`
          + `&LAYERS=1927,1928&QUERY_LAYERS=1927,1928`
          + `&SRS=EPSG:3857&BBOX=${bbox}`
          + `&WIDTH=${imgSize}&HEIGHT=${imgSize}&X=${imgSize / 2}&Y=${imgSize / 2}`
          + `&INFO_FORMAT=text/plain&FEATURE_COUNT=50`;
        try {
          const resp = await fetch(url, { signal: controller.signal });
          if (!resp.ok) return [];
          const text = await resp.text();
          if (!text || text.trim() === "no features were found") return [];
          return parseLuWmsPlainText(text);
        } catch {
          return [] as Record<string, string>[];
        }
      })
    );

    const seen = new Set<string>();
    const allRaw: Record<string, string>[] = [];
    for (const raw of results) {
      for (const wms of raw) {
        const key = `${wms["Zone Identifier"] || ""}-${wms["Lower limit (meter)"] || ""}-${wms["Upper limit (meter)"] || ""}`;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allRaw.push(wms);
      }
    }
    return parseLuWmsToGeozoneInfo(allRaw);
  } catch (e: any) {
    console.warn("[Geozones] LU query error:", e?.message || e);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function parseLuWmsToGeozoneInfo(features: Record<string, string>[]): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  const seen = new Set<string>();

  for (const wms of features) {
    const nomZone = wms["Zone Identifier"] || "";
    const description = wms["Description"] || "";
    const dedup = `${nomZone}-${wms["Lower limit (meter)"] || ""}-${wms["Upper limit (meter)"] || ""}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const rawName = nomZone || description || "UAS-Zone";
    const name = translateLuFrench(rawName);

    const detailParts: string[] = [];
    if (description) detailParts.push(`Beschreibung: ${translateLuFrench(description)}`);
    const nature = wms["Nature of proctection"];
    if (nature) {
      const reasonMap: Record<string, string> = { AERO: "Flugplatz", NATURE: "Naturschutz", MILITARY: "Militär", SENSITIVE: "Sensibel", PRIVACY: "Privatsphäre", TERR: "Gebietsschutz", NUCLEAR: "Kernanlage", PRISON: "Justizvollzug", HOSPITAL: "Krankenhaus", INDUSTRIAL: "Industrieanlage", OTHER: "Sonstige" };
      detailParts.push(`Grund: ${reasonMap[nature] || nature}`);
    }
    const minH = wms["Lower limit (meter)"];
    const maxH = wms["Upper limit (meter)"];
    if (minH || maxH) {
      detailParts.push(`Höhe: ${minH ? parseFloat(minH) : 0} – ${maxH ? parseFloat(maxH) : "?"} m`);
    }
    const resp = wms["Responsability"];
    if (resp) detailParts.push(`Zuständigkeit: ${translateLuFrench(resp)}`);
    const startDate = wms["Start date and time"];
    const endDate = wms["End date and time"];
    if (startDate || endDate) {
      detailParts.push(`Von: ${startDate ? luWmsDateToDisplay(startDate) : "?"}`);
      detailParts.push(`Bis: ${endDate ? luWmsDateToDisplay(endDate) : "?"}`);
    }
    const activite = wms["Activity"];
    if (activite) detailParts.push(`Status: ${LU_ACTIVITE_DE[activite] || activite}`);
    const durPrev = wms["Duration of previsualisation (hours)"];
    if (durPrev) detailParts.push(`Vorankündigung: ${parseFloat(durPrev)} Std.`);
    const remarks = wms["Remarks"];
    if (remarks) detailParts.push(`Hinweis: ${translateLuFrench(remarks)}`);

    const isInactive = activite ? /^(inactif|inactive|INACTIF|INACTIVE)$/i.test(activite) : false;
    let longDuration = false;
    if (startDate && endDate) {
      const startMs = luWmsDateToMs(startDate);
      const endMs = luWmsDateToMs(endDate);
      if (startMs > 0 && endMs > 0 && (endMs - startMs) > 365.25 * 24 * 3600 * 1000) {
        longDuration = true;
      }
    }
    const isPermanent = (longDuration || (activite ? /^permanent$/i.test(activite) : false)) && !isInactive;

    const layerLabel = isPermanent
      ? (minH && parseFloat(minH) >= 50 ? "UAS-Zonen 50–120 m" : "UAS-Zonen 0–50 m")
      : LU_TEMP_ZONE_LABEL;

    results.push({
      layerLabel,
      name,
      details: detailParts.join("\n"),
      featureId: nomZone || undefined,
    });
  }

  return results;
}

const NL_LOCALTYPE_DE: Record<string, string> = {
  Verboden: "Verboten (Prohibited)",
  Beperking: "Beschränkt (Restricted)",
  CTR: "Kontrollzone (CTR)",
  TMA: "Nahverkehrsbereich (TMA)",
  Natura2000: "Natura-2000-Schutzgebiet",
  Militair: "Militärgebiet",
  Laagvlieggebied: "Tieffluggebiet",
  Gevaarlijk: "Gefahrengebiet (Danger)",
};

function translateNlLocalType(localtype: string): string {
  return NL_LOCALTYPE_DE[localtype] || localtype;
}

const NL_WMS_TO_WFS_TYPENAME: Record<string, string> = {
  luchtvaartgebieden: "drone-no-flyzones:luchtvaartgebieden",
  luchtvaartgebieden_zonder_natura2000: "drone-no-flyzones:luchtvaartgebieden_zonder_natura2000",
  landingsite: "drone-no-flyzones:landingsite",
};

const NL_SPECIFIEK_DE: Record<string, string> = {
  Heliport: "Hubschrauberlandeplatz",
  Luchthaven: "Flughafen",
  Vliegveld: "Flugplatz",
};

const NL_SOURCE_DE: Record<string, string> = {
  "Gecontroleerde luchthavens en/of radioverplichting (Verboden voor open categorie)": "Kontrollierte Flughäfen und/oder Funkpflicht (Verboten für offene Kategorie)",
  "Gecontroleerde luchthavens (Verboden voor open categorie)": "Kontrollierte Flughäfen (Verboten für offene Kategorie)",
  "Radioverplichting (Verboden voor open categorie)": "Funkpflicht (Verboten für offene Kategorie)",
  "Verboden voor open categorie": "Verboten für offene Kategorie",
  "Toegestaan met beperkingen": "Erlaubt mit Einschränkungen",
  "Verboden in open categorie": "Verboten in offener Kategorie",
  "Laagvliegroute": "Tiefflugstrecke",
  "Laagvliegroute Defensie": "Tiefflugstrecke Verteidigung",
  "Schietrange": "Schießanlage",
  "Militair oefengebied": "Militärisches Übungsgebiet",
  "Vliegveld": "Flugplatz",
  "Zweefvliegterrein": "Segelfluggelände",
  "Modelvliegterrein": "Modellfluggelände",
  "Vliegbasis": "Luftwaffenstützpunkt",
  "Helikopterlandingsplaats": "Hubschrauberlandeplatz",
  "Luchthaven": "Flughafen",
};

const NL_WORD_DE: [RegExp, string][] = [
  [/\bGecontroleerde luchthavens\b/g, "Kontrollierte Flughäfen"],
  [/\bradioverplichting\b/gi, "Funkpflicht"],
  [/\bVerboden voor open categorie\b/gi, "Verboten für offene Kategorie"],
  [/\bVerboden\b/g, "Verboten"],
  [/\bToegestaan met beperkingen\b/gi, "Erlaubt mit Einschränkungen"],
  [/\blaagvlieggebied\b/gi, "Tieffluggebiet"],
  [/\blaagvliegroute\b/gi, "Tiefflugstrecke"],
  [/\bmilitair\b/gi, "Militärisch"],
  [/\boefengebied\b/gi, "Übungsgebiet"],
  [/\bschietrange\b/gi, "Schießanlage"],
  [/\bgevaarlijk gebied\b/gi, "Gefahrengebiet"],
  [/\bluchthaven\b/gi, "Flughafen"],
  [/\bvliegveld\b/gi, "Flugplatz"],
  [/\bvliegbasis\b/gi, "Luftwaffenstützpunkt"],
  [/\bzweefvliegterrein\b/gi, "Segelfluggelände"],
  [/\bmodelvliegterrein\b/gi, "Modellfluggelände"],
  [/\bhelikopterlandingsplaats\b/gi, "Hubschrauberlandeplatz"],
  [/\bnatura\s*2000\b/gi, "Natura-2000"],
  [/\bbeschermd natuurgebied\b/gi, "Geschütztes Naturgebiet"],
  [/\bnationaal park\b/gi, "Nationalpark"],
  [/\ben\/of\b/g, "und/oder"],
  [/\ben\b/g, "und"],
  [/\bvoor\b/g, "für"],
  [/\bmet\b/g, "mit"],
  [/\bopen categorie\b/gi, "offene Kategorie"],
];

function translateNlSource(source: string): string {
  if (!source) return source;
  const exact = NL_SOURCE_DE[source];
  if (exact) return exact;
  let result = source;
  for (const [pattern, replacement] of NL_WORD_DE) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

async function queryNlWfsFeatures(
  lat: number,
  lon: number,
  radiusKm: number,
  activeWmsLayers?: string[],
): Promise<GeozoneFeatureInfo[]> {
  const delta = radiusKm / 111.32;
  const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},EPSG:4326`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let wmsLayersToQuery = activeWmsLayers && activeWmsLayers.length > 0
    ? activeWmsLayers
    : ["luchtvaartgebieden"];

  const allResults: GeozoneFeatureInfo[] = [];

  try {
    for (const wmsLayer of wmsLayersToQuery) {
      const typeName = NL_WMS_TO_WFS_TYPENAME[wmsLayer];
      if (!typeName) continue;
      const nlLayer = NL_GEOZONE_LAYERS.find((l) => l.wmsLayer === wmsLayer);
      const layerLabel = nlLayer?.label || "Flugverbotszone (NL)";
      const isLandingsite = wmsLayer === "landingsite";

      const url = `https://service.pdok.nl/lvnl/drone-no-flyzones/wfs/v1_0?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${encodeURIComponent(typeName)}&OUTPUTFORMAT=${encodeURIComponent("application/json")}&SRSNAME=EPSG:4326&BBOX=${encodeURIComponent(bbox)}&count=50`;
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (isLandingsite) {
        allResults.push(...parseNlLandingsiteResponse(data, layerLabel));
      } else {
        allResults.push(...parseNlGeozoneResponse(data, layerLabel));
      }
    }
  } catch (e: any) {
    console.warn("[Geozones] NL WFS query error:", e?.message || e);
  } finally {
    clearTimeout(timeout);
  }

  const seen = new Set<string>();
  return allResults.filter((z) => {
    const key = `${z.name}|${z.details}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseNlGeozoneResponse(data: any, layerLabel: string): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  if (!data.features || !Array.isArray(data.features)) return results;

  for (const feature of data.features) {
    const props = feature.properties || {};
    const localtype = props.localtype || "";
    const sourceTxt = props.sourceTxt || "";
    const translatedType = translateNlLocalType(localtype);
    const translatedSource = translateNlSource(sourceTxt);

    const name = translatedSource || translatedType || "Flugverbotszone";

    const detailParts: string[] = [];
    detailParts.push(`Zonentyp: ${translatedType}`);
    if (translatedSource) detailParts.push(`Quelle: ${translatedSource}`);

    const fid = feature.id || (props.objectid != null ? `nl-${props.objectid}` : undefined);

    results.push({
      layerLabel,
      name,
      details: detailParts.join("\n"),
      featureId: fid,
    });
  }

  return results;
}

function parseNlLandingsiteResponse(data: any, layerLabel: string): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  if (!data.features || !Array.isArray(data.features)) return results;

  for (const feature of data.features) {
    const props = feature.properties || {};
    const txtname = props.txtname || "Landeplatz";
    const specifiek = props.specifiek || "";
    const specifiekDe = NL_SPECIFIEK_DE[specifiek] || specifiek;

    const detailParts: string[] = [];
    if (specifiekDe) detailParts.push(`Typ: ${specifiekDe}`);

    results.push({
      layerLabel,
      name: txtname,
      details: detailParts.join("\n"),
      featureId: feature.id || undefined,
    });
  }

  return results;
}

const LU_FR_DE_TRANSLATIONS: Record<string, string> = {
  "Aérodrome": "Flugplatz",
  "aérodrome": "Flugplatz",
  "Aeroport": "Flughafen",
  "aeroport": "Flughafen",
  "Héliport": "Hubschrauberlandeplatz",
  "héliport": "Hubschrauberlandeplatz",
  "Zone interdite": "Flugverbotszone",
  "zone interdite": "Flugverbotszone",
  "Zone restreinte": "Beschränktes Gebiet",
  "zone restreinte": "Beschränktes Gebiet",
  "Zone dangereuse": "Gefahrengebiet",
  "zone dangereuse": "Gefahrengebiet",
  "Réserve naturelle": "Naturschutzgebiet",
  "réserve naturelle": "Naturschutzgebiet",
  "Zone de protection": "Schutzzone",
  "zone de protection": "Schutzzone",
  "Zone de contrôle": "Kontrollzone",
  "zone de contrôle": "Kontrollzone",
  "Espace aérien contrôlé": "Kontrollierter Luftraum",
  "Zone militaire": "Militärgebiet",
  "zone militaire": "Militärgebiet",
  "Château": "Schloss",
  "château": "Schloss",
  "Centre pénitentiaire": "Justizvollzugsanstalt",
  "centre pénitentiaire": "Justizvollzugsanstalt",
  "Centre de rétention": "Abschiebungshaftanstalt",
  "centre de rétention": "Abschiebungshaftanstalt",
  "Centre de détention": "Haftanstalt",
  "centre de détention": "Haftanstalt",
  "Prison": "Gefängnis",
  "prison": "Gefängnis",
  "Établissement pénitentiaire": "Justizvollzugsanstalt",
  "établissement pénitentiaire": "Justizvollzugsanstalt",
  "Hôpital": "Krankenhaus",
  "hôpital": "Krankenhaus",
  "École": "Schule",
  "école": "Schule",
  "Centrale nucléaire": "Kernkraftwerk",
  "centrale nucléaire": "Kernkraftwerk",
  "Parc naturel": "Naturpark",
  "parc naturel": "Naturpark",
  "Site classé": "Denkmalgeschütztes Gebiet",
  "Ambassade": "Botschaft",
  "ambassade": "Botschaft",
  "Palais": "Palast",
  "palais": "Palast",
  "Hélistation": "Hubschrauberlandeplatz",
  "Site": "Standort",
  "hélistation": "Hubschrauberlandeplatz",
  "Hélipad": "Hubschrauberlandeplatz",
  "hélipad": "Hubschrauberlandeplatz",
  "Port de": "Hafen von",
  "port de": "Hafen von",
  "Gare": "Bahnhof",
  "gare": "Bahnhof",
  "Stade": "Stadion",
  "stade": "Stadion",
  "Caserne": "Kaserne",
  "caserne": "Kaserne",
  "Cimetière": "Friedhof",
  "cimetière": "Friedhof",
  "Église": "Kirche",
  "église": "Kirche",
  "Cathédrale": "Kathedrale",
  "cathédrale": "Kathedrale",
  "Musée": "Museum",
  "musée": "Museum",
  "Bibliothèque": "Bibliothek",
  "bibliothèque": "Bibliothek",
  "Mairie": "Rathaus",
  "mairie": "Rathaus",
  "Tribunal": "Gericht",
  "tribunal": "Gericht",
  "Poste de police": "Polizeiwache",
  "poste de police": "Polizeiwache",
  "Université": "Universität",
  "université": "Universität",
  "Lycée": "Gymnasium",
  "lycée": "Gymnasium",
  "Collège": "Sekundarschule",
  "collège": "Sekundarschule",
  "Centre hospitalier": "Klinikum",
  "centre hospitalier": "Klinikum",
  "Clinique": "Klinik",
  "clinique": "Klinik",
  "Maison de retraite": "Altersheim",
  "maison de retraite": "Altersheim",
  "Centre de soins": "Pflegezentrum",
  "centre de soins": "Pflegezentrum",
  "Centrale électrique": "Kraftwerk",
  "centrale électrique": "Kraftwerk",
  "Station d'épuration": "Kläranlage",
  "station d'épuration": "Kläranlage",
  "Réservoir": "Speicher",
  "réservoir": "Speicher",
  "Barrage": "Staudamm",
  "barrage": "Staudamm",
  "Pont": "Brücke",
  "pont": "Brücke",
  "Aerodrome public": "Öffentlicher Flugplatz",
  "aerodrome public": "Öffentlicher Flugplatz",
  "Palais Grand-Ducal": "Großherzoglicher Palast",
  "palais grand-ducal": "Großherzoglicher Palast",
  "Autorisation vol ANA et tour": "Fluggenehmigung ANA und Tower",
  "Notification vol ANA et tour": "Flugmeldung ANA und Tower",
  "Autorisation vol ANA": "Fluggenehmigung ANA",
  "Notification vol ANA": "Flugmeldung ANA",
  "Autorisation vol DAC": "Fluggenehmigung DAC",
  "Notification vol DAC": "Flugmeldung DAC",
  "Autorisation vol": "Fluggenehmigung",
  "autorisation vol": "Fluggenehmigung",
  "Notification vol": "Flugmeldung",
  "Autorisation": "Genehmigung",
  "autorisation": "Genehmigung",
  "Direction de l'aviation civile": "Direktion der Zivilluftfahrt",
  "Règlement grand-ducal": "Großherzogliche Verordnung",
  "règlement grand-ducal": "Großherzogliche Verordnung",
  "Zones géographiques UAS": "UAS-Geographische Zonen",
  "zones géographiques UAS": "UAS-Geographische Zonen",
  "Zones géographiques": "Geographische Zonen",
  "zones géographiques": "Geographische Zonen",
  "Activité ponctuelle": "Einmalige Aktivität",
  "activité ponctuelle": "Einmalige Aktivität",
  "Activation à la demande de la Police": "Aktivierung auf Anfrage der Polizei",
  "Activation at the request of the Police": "Aktivierung auf Anfrage der Polizei",
  "DAC for activation at least 6h in advance": "DAC zur Aktivierung mind. 6 Std. im Voraus",
  "DAC for activation at least": "DAC zur Aktivierung mind.",
  "L'activation est annoncée": "Die Aktivierung wird angekündigt",
  "L'activation de la zone est annoncée": "Die Aktivierung der Zone wird angekündigt",
  "Activation is announced": "Aktivierung wird angekündigt",
  "heures à l'avance": "Stunden im Voraus",
  "minutes à l'avance": "Minuten im Voraus",
  "au minimum": "mindestens",
  "at least": "mindestens",
  "et est corrélée sur les TSA correspondantes": "und ist an die entsprechenden TSA gekoppelt",
  "est corrélée sur les TSA correspondantes": "ist an die entsprechenden TSA gekoppelt",
  "Voir NOTAM": "Siehe NOTAM",
  "One-off activity": "Einmalige Aktivität",
  "Seasonal activity": "Saisonale Aktivität",
  "Activité saisonnière": "Saisonale Aktivität",
  "hours in advance": "Stunden im Voraus",
  "minutes in advance": "Minuten im Voraus",
  "and correlated to the corresponding TSA": "und an die entsprechende TSA gekoppelt",
  "See NOTAM": "Siehe NOTAM",
  "ANA/ARO for activation": "ANA/ARO zur Aktivierung",
  "in advance": "im Voraus",
  "à l'avance": "im Voraus",
  "DAC - Notification LAR/H": "DAC — Meldung LAR/H",
  "Une coordination des services étatiques": "Eine Abstimmung der staatlichen Dienste",
  "avec la tour de contrôle": "mit dem Kontrollturm",
  "de l'aérodrome": "des Flugplatzes",
  "est nécessaire dans tous les cas": "ist in jedem Fall erforderlich",
  "services étatiques": "staatliche Dienste",
  "tour de contrôle": "Kontrollturm",
  "Police/CGDIS": "Polizei/CGDIS",
  "à la demande": "auf Anfrage",
  "Notification": "Meldung",
  "notification": "Meldung",
  "Militaire": "Militärgebiet",
  "militaire": "Militärgebiet",
  "août": "August",
  "janvier": "Januar",
  "février": "Februar",
  "mars": "März",
  "avril": "April",
  "mai": "Mai",
  "juin": "Juni",
  "juillet": "Juli",
  "septembre": "September",
  "octobre": "Oktober",
  "novembre": "November",
  "décembre": "Dezember",
  "1er": "1.",
};

const LU_TYPE_RESTRICTION_DE: Record<string, string> = {
  "0to50m": "0 bis 50 m",
  "50to120m": "50 bis 120 m",
  "0to120m": "0 bis 120 m",
  "prohibited": "Verboten",
  "restricted": "Beschränkt",
  "authorization": "Genehmigungspflichtig",
};

const LU_ACTIVITE_DE: Record<string, string> = {
  active: "Aktiv",
  inactive: "Inaktiv",
  permanent: "Dauerhaft",
  temporary: "Vorübergehend",
  ACTIVE: "Aktiv",
  INACTIVE: "Inaktiv",
  PERMANENT: "Dauerhaft",
  TEMPORARY: "Vorübergehend",
  Actif: "Aktiv",
  Inactif: "Inaktiv",
  ACTIF: "Aktiv",
  INACTIF: "Inaktiv",
  Permanent: "Dauerhaft",
  Temporaire: "Vorübergehend",
  TEMPORAIRE: "Vorübergehend",
};

const LU_SORTED_TRANSLATIONS = Object.entries(LU_FR_DE_TRANSLATIONS)
  .sort((a, b) => b[0].length - a[0].length);

function translateLuFrench(text: string): string {
  let result = text;
  for (const [fr, de] of LU_SORTED_TRANSLATIONS) {
    if (result.includes(fr)) {
      result = result.replace(new RegExp(fr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "g"), de);
    }
  }
  result = result
    .replace(/\bd'([A-ZÀÂÇÉÈÊËÎÏÔÙÛÜŸÆŒ])/g, "von $1")
    .replace(/\bde la\b/gi, "der")
    .replace(/\bde l'/gi, "des ")
    .replace(/\bdu\b/g, "des")
    .replace(/\bde\b/g, "von");
  return result;
}

const LU_SCAN_POINTS: [number, number][] = [
  [49.87, 6.15], [49.60, 6.13], [49.75, 6.35], [49.50, 5.98],
  [49.95, 6.00], [49.70, 5.85], [49.55, 6.35], [49.80, 5.95],
  [49.65, 6.30], [49.90, 6.30], [49.50, 6.15], [49.75, 6.00],
];

function isLuZonePermanent(wms: Record<string, string>): boolean {
  const activite = (wms["Activity"] || "").toLowerCase();
  if (activite === "permanent") return true;
  const startMs = wms["Start date and time"] ? luWmsDateToMs(wms["Start date and time"]) : 0;
  const endMs = wms["End date and time"] ? luWmsDateToMs(wms["End date and time"]) : 0;
  if (startMs > 0 && endMs > 0) {
    const durationMs = endMs - startMs;
    const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
    if (durationMs > oneYearMs) return true;
  }
  if (startMs > 0 && endMs === 0) {
    const ageMs = Date.now() - startMs;
    const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
    if (ageMs > oneYearMs) return true;
  }
  return false;
}

function buildLuNotamFromWms(wms: Record<string, string>): { id: number; series: string; number: number; type: string; itema: string[]; iteme: string; startvalidity: number; endvalidity: number; fir: string; nom_zone: string; itemf?: string; itemg?: string } | null {
  const nomZone = wms["Zone Identifier"] || "";
  if (!nomZone) return null;

  if (isLuZonePermanent(wms)) return null;

  const minH = wms["Lower limit (meter)"] || "0";
  const maxH = wms["Upper limit (meter)"] || "";
  const startMs = wms["Start date and time"] ? luWmsDateToMs(wms["Start date and time"]) : 0;
  const endMs = wms["End date and time"] ? luWmsDateToMs(wms["End date and time"]) : 0;
  const desc = translateLuFrench(wms["Description"] || nomZone || "");
  const remarks = wms["Remarks"] ? translateLuFrench(wms["Remarks"]) : "";
  const activite = wms["Activity"] || "";
  const status = LU_ACTIVITE_DE[activite] || activite || "";
  const resp2 = wms["Responsability"] ? translateLuFrench(wms["Responsability"]) : "";
  const nature = wms["Nature of proctection"] || "";
  const durPrevStr = wms["Duration of previsualisation (hours)"] || "";
  const hasDurPrev = durPrevStr && parseFloat(durPrevStr) > 0;

  const textParts: string[] = [];
  textParts.push(`${desc} (${nomZone})`);
  if (nature) {
    const reasonMap: Record<string, string> = { AERO: "Flugplatz", NATURE: "Naturschutz", MILITARY: "Militär", SENSITIVE: "Sensibel", PRIVACY: "Privatsphäre", TERR: "Gebietsschutz", NUCLEAR: "Kernanlage", PRISON: "Justizvollzug", HOSPITAL: "Krankenhaus", INDUSTRIAL: "Industrieanlage", OTHER: "Sonstige" };
    textParts.push(`Art: ${reasonMap[nature] || nature}`);
  }
  if (status) textParts.push(`Status: ${status}`);
  if (resp2) textParts.push(`Zuständigkeit: ${resp2}`);
  if (minH || maxH) textParts.push(`Höhe: ${parseFloat(minH)} – ${maxH ? parseFloat(maxH) : "?"} m`);
  if (wms["Start date and time"]) textParts.push(`Von: ${luWmsDateToDisplay(wms["Start date and time"])}`);
  if (wms["End date and time"]) textParts.push(`Bis: ${luWmsDateToDisplay(wms["End date and time"])}`);
  if (hasDurPrev) textParts.push(`Vorankündigung: ${parseFloat(durPrevStr)} Std.`);
  if (remarks) textParts.push(`Hinweis: ${remarks}`);

  return {
    id: -(Math.abs(nomZone.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 100 + parseFloat(minH))),
    series: "LU-TSA",
    number: 0,
    type: "N",
    itema: [nomZone || "ELLX"],
    iteme: textParts.join("\n"),
    startvalidity: startMs,
    endvalidity: endMs,
    fir: "ELLX",
    nom_zone: `${nomZone}-${minH}-${maxH}`,
    itemf: minH ? `${parseFloat(minH)} M AGL` : "GND",
    itemg: maxH ? `${parseFloat(maxH)} M AGL` : undefined,
  };
}

export async function fetchLuTsaAsNotams(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<{ id: number; series: string; number: number; type: string; itema: string[]; iteme: string; startvalidity: number; endvalidity: number; fir: string; nom_zone: string; itemf?: string; itemg?: string }[]> {
  const rawFeatures = await queryLuWmsFeatureInfo(lat, lon, radiusKm);
  const results: any[] = [];
  const seen = new Set<string>();

  for (const wms of rawFeatures) {
    const r = buildLuNotamFromWms(wms);
    if (!r) continue;
    if (seen.has(r.nom_zone)) continue;
    seen.add(r.nom_zone);
    results.push(r);
  }

  return results;
}

export async function fetchAllLuZonesAsNotams(): Promise<{ id: number; series: string; number: number; type: string; itema: string[]; iteme: string; startvalidity: number; endvalidity: number; fir: string; nom_zone: string; itemf?: string; itemg?: string }[]> {
  try {
    const seen = new Set<string>();
    const results: any[] = [];

    const scanPoint = async (lat: number, lon: number) => {
      try {
        const raw = await queryLuWmsFeatureInfo(lat, lon, 10);
        for (const wms of raw) {
          const r = buildLuNotamFromWms(wms);
          if (!r) continue;
          if (seen.has(r.nom_zone)) continue;
          seen.add(r.nom_zone);
          results.push(r);
        }
      } catch {}
    };

    await Promise.all(LU_SCAN_POINTS.map(([la, lo]) => scanPoint(la, lo)));

    if (results.length > 0) {
      setCache("lu_zones_all", results).catch(() => {});
    }
    return results;
  } catch (err) {
    const cached = await getCached<any[]>("lu_zones_all");
    if (cached) return cached.data;
    throw err;
  }
}

export function getCountriesInRadius(lat: number, lon: number, radiusKm: number, primaryIso?: string): string[] {
  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;
  const minLat = lat - dLat;
  const maxLat = lat + dLat;
  const minLon = lon - dLon;
  const maxLon = lon + dLon;

  const supportedIsos = Object.keys(COUNTRY_GEOZONE_CONFIGS);
  const BOXES: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> = {
    DE: { minLat: 47.27, maxLat: 55.06, minLon: 5.87, maxLon: 15.04 },
    CH: { minLat: 45.82, maxLat: 47.81, minLon: 5.96, maxLon: 10.49 },
    LU: { minLat: 49.45, maxLat: 50.18, minLon: 5.73, maxLon: 6.53 },
    NL: { minLat: 50.75, maxLat: 53.47, minLon: 3.36, maxLon: 7.21 },
  };

  const result: string[] = [];
  if (primaryIso && supportedIsos.includes(primaryIso.toUpperCase())) {
    result.push(primaryIso.toUpperCase());
  }

  for (const iso of supportedIsos) {
    if (result.includes(iso)) continue;
    const box = BOXES[iso];
    if (!box) continue;
    if (maxLat >= box.minLat && minLat <= box.maxLat && maxLon >= box.minLon && minLon <= box.maxLon) {
      result.push(iso);
    }
  }

  return result;
}

async function queryGeozonesForCountry(
  lat: number,
  lon: number,
  radiusKm: number,
  iso: string,
): Promise<GeozoneFeatureInfo[]> {
  const config = getCountryGeozoneConfig(iso);

  if (config.featureInfoType === "rest-json" && config.iso === "CH") {
    return queryChRestIdentify(lat, lon, radiusKm);
  }

  if (config.featureInfoType === "ogc-features" && config.iso === "LU") {
    return queryLuOgcFeatures(lat, lon, radiusKm);
  }

  if (config.featureInfoType === "wfs-json" && config.iso === "NL") {
    const nlWmsLayers = config.layers.filter((l) => l.defaultEnabled).map((l) => l.wmsLayer);
    return queryNlWfsFeatures(lat, lon, radiusKm, nlWmsLayers);
  }

  const layers = getAllLayerNames(iso);
  if (layers.length === 0) return [];

  const kmToDegLat = 1 / 111.32;
  const kmToDegLon = 1 / (111.32 * Math.cos(degToRad(lat)));
  const dLat = radiusKm * kmToDegLat;
  const dLon = radiusKm * kmToDegLon;

  const sampleOffsets: [number, number][] = [
    [0, 0],
    [0, -1], [0, 1],
    [1, 0], [-1, 0],
    [0.7, 0.7], [-0.7, 0.7],
    [0.7, -0.7], [-0.7, -0.7],
  ];

  const mapSize = 512;
  const bboxLatDelta = dLat * 2.5;
  const bboxLonDelta = dLon * 2.5;

  const results = await Promise.all(
    sampleOffsets.map(([oLat, oLon]) => {
      const sLat = lat + oLat * dLat;
      const sLon = lon + oLon * dLon;
      return queryGeozoneFeatureInfo(
        layers, sLat, sLon,
        mapSize, mapSize,
        bboxLatDelta, bboxLonDelta,
        iso,
      ).catch(() => [] as GeozoneFeatureInfo[]);
    })
  );

  const seen = new Set<string>();
  const unique: GeozoneFeatureInfo[] = [];
  for (const batch of results) {
    if (!batch) continue;
    for (const z of batch) {
      const key = `${z.layerLabel}|${z.name}|${z.details}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(z);
    }
  }
  return unique;
}

export async function queryGeozonesInArea(
  lat: number,
  lon: number,
  radiusKm: number,
  countryIso?: string,
): Promise<GeozoneFeatureInfo[]> {
  const countries = getCountriesInRadius(lat, lon, radiusKm, countryIso);
  if (countries.length === 0) return [];
  const primary = countries[0];
  const neighbors = countries.slice(1);

  const withTimeout = (promise: Promise<GeozoneFeatureInfo[]>, ms: number): Promise<GeozoneFeatureInfo[]> =>
    Promise.race([promise, new Promise<GeozoneFeatureInfo[]>((resolve) => setTimeout(() => resolve([]), ms))]);

  const primaryResult = await queryGeozonesForCountry(lat, lon, radiusKm, primary).catch((e) => {
    console.warn(`[Geozones] Primary query failed for ${primary}:`, e?.message || e);
    return [] as GeozoneFeatureInfo[];
  });

  let neighborResults: GeozoneFeatureInfo[] = [];
  if (neighbors.length > 0) {
    const settled = await Promise.allSettled(
      neighbors.map((iso) =>
        withTimeout(
          queryGeozonesForCountry(lat, lon, radiusKm, iso).catch((e) => {
            console.warn(`[Geozones] Neighbor query failed for ${iso}:`, e?.message || e);
            return [] as GeozoneFeatureInfo[];
          }),
          8000,
        ),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") neighborResults.push(...s.value);
    }
  }

  const seen = new Set<string>();
  const unique: GeozoneFeatureInfo[] = [];
  for (const z of [...primaryResult, ...neighborResults]) {
    const key = `${z.layerLabel}|${z.name}|${z.details}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(z);
  }
  return unique;
}

export async function queryGeozoneFeatureInfo(
  layers: string[],
  lat: number,
  lon: number,
  mapWidth: number,
  mapHeight: number,
  latDelta: number,
  lonDelta: number,
  countryIso?: string,
): Promise<GeozoneFeatureInfo[]> {
  const config = getCountryGeozoneConfig(countryIso);

  if (config.featureInfoType === "rest-json" && config.iso === "CH") {
    const radiusKmCh = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryChRestIdentify(lat, lon, radiusKmCh);
  }

  if (config.featureInfoType === "ogc-features" && config.iso === "LU") {
    const radiusKm = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryLuOgcFeatures(lat, lon, Math.max(radiusKm, 0.5));
  }

  if (config.featureInfoType === "wfs-json" && config.iso === "NL") {
    const radiusKm = Math.max(latDelta * 111.32, lonDelta * 111.32 * Math.cos(degToRad(lat))) / 2;
    return queryNlWfsFeatures(lat, lon, Math.max(radiusKm, 0.5), layers);
  }

  if (config.featureInfoType === "none") return [];

  if (layers.length === 0) return [];

  const west = lon - lonDelta / 2;
  const east = lon + lonDelta / 2;
  const south = lat - latDelta / 2;
  const north = lat + latDelta / 2;

  const bboxMinX = lonToMercX(west);
  const bboxMinY = latToMercY(south);
  const bboxMaxX = lonToMercX(east);
  const bboxMaxY = latToMercY(north);

  const tapMercX = lonToMercX(lon);
  const tapMercY = latToMercY(lat);

  const pixelX = Math.round(((tapMercX - bboxMinX) / (bboxMaxX - bboxMinX)) * mapWidth);
  const pixelY = Math.round(((bboxMaxY - tapMercY) / (bboxMaxY - bboxMinY)) * mapHeight);

  const layerStr = layers.join(",");
  const bbox = `${bboxMinX},${bboxMinY},${bboxMaxX},${bboxMaxY}`;

  const crsParam = config.wmsVersion === "1.3.0" ? "CRS" : "srs";
  const url = `${config.wmsBaseUrl}?SERVICE=WMS&VERSION=${config.wmsVersion}&REQUEST=GetFeatureInfo`
    + `&LAYERS=${layerStr}&QUERY_LAYERS=${layerStr}`
    + `&${crsParam}=EPSG:3857&BBOX=${bbox}`
    + `&WIDTH=${mapWidth}&HEIGHT=${mapHeight}`
    + `&X=${pixelX}&Y=${pixelY}`
    + `&INFO_FORMAT=text/plain`
    + `&FEATURE_COUNT=20`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const layerLookup: Record<string, string> = {};
  for (const l of config.layers) {
    layerLookup[l.wmsLayer] = l.label;
  }

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return [];
    const text = await resp.text();

    if (!text || text.trim() === "no features were found") return [];

    return parsePlainTextFeatureInfo(text, layerLookup);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

const TYPE_CODE_LABELS: Record<string, string> = {
  MILITAERISCHE_ANLAGE: "Militärische Anlage oder Organisation",
  SICHERHEITSBEHOERDE: "Andere Sicherheitsbehörde",
  KRANKENHAUS: "Krankenhaus",
  INDUSTRIEANLAGE: "Industrieanlage",
  KRAFTWERK: "Kraftwerk",
  JVA: "Justizvollzugsanstalt",
  NATURSCHUTZGEBIET: "Naturschutzgebiet",
  NATIONALPARK: "Nationalpark",
  LANDSCHAFTSSCHUTZGEBIET: "Landschaftsschutzgebiet",
  VOGELSCHUTZGEBIET: "Vogelschutzgebiet",
  WOHNGEBIET: "Wohngebiet",
  MENSCHENANSAMMLUNG: "Menschenansammlung",
  FLUGPLATZ: "Flugplatz",
  HUBSCHRAUBERLANDEPLATZ: "Hubschrauberlandeplatz",
  SEGELFLUGGELAENDE: "Segelfluggelände",
  KONTROLLZONE: "Kontrollzone",
  FLUGBESCHRAENKUNGSGEBIET: "Flugbeschränkungsgebiet",
  ED_R: "Flugbeschränkungsgebiet (ED-R)",
  BUNDESFERNSTRASSE: "Bundesfernstraße",
  BUNDESWASSERSTRASSE: "Bundeswasserstraße",
  BAHNANLAGE: "Bahnanlage",
  BUNDESAUTOBAHN: "Bundesautobahn",
  BOTSCHAFT: "Botschaft / Konsulat",
  VERFASSUNGSORGAN: "Verfassungsorgan",
  POLIZEI: "Polizeidienststelle",
  FEUERWEHR: "Feuerwehr",
  KATASTROPHENSCHUTZ: "Katastrophenschutz",
  UNFALL: "Unfallstelle / Einsatzstelle",
};

function humanizeTypeCode(typeCode: string): string {
  const label = TYPE_CODE_LABELS[typeCode] || TYPE_CODE_LABELS[typeCode.toUpperCase()];
  if (label) return label;
  return typeCode
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/oe/g, "ö")
    .replace(/ue/g, "ü")
    .replace(/ae/g, "ä")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function parsePlainTextFeatureInfo(text: string, layerLookup: Record<string, string>): GeozoneFeatureInfo[] {
  const results: GeozoneFeatureInfo[] = [];
  const blocks = text.split(/Results for FeatureType '([^']+)':/);

  for (let i = 1; i < blocks.length; i += 2) {
    const rawFeatureType = blocks[i];
    const content = blocks[i + 1] || "";

    const layerKey = rawFeatureType.replace(/^[^:]+:/, "");
    const layerLabel = layerLookup[layerKey] || layerKey;

    const featureSections = content.split(/^-{4,}$/m).filter((s) => s.trim().length > 0);

    for (const section of featureSections) {
      const props: Record<string, string> = {};
      const lines = section.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const eqIdx = line.indexOf(" = ");
        if (eqIdx > 0) {
          const key = line.substring(0, eqIdx).trim();
          const val = line.substring(eqIdx + 3).trim();
          if (key && val && key !== "geom" && !val.startsWith("[GEOMETRY")) {
            props[key] = val;
          }
        }
      }

      if (Object.keys(props).length === 0) continue;

      const isNull = (v: string | undefined) => !v || v === "null" || v.trim() === "";
      let name = !isNull(props.name) ? props.name! : !isNull(props.bezeichnung) ? props.bezeichnung! : !isNull(props.NAME) ? props.NAME! : !isNull(props.BEZEICHNUNG) ? props.BEZEICHNUNG! : "";
      if (!name) {
        const tc = props.type_code || props.TYPE_CODE || "";
        if (tc) name = humanizeTypeCode(tc);
      }
      if (!name) {
        const legalRef = props.legal_ref || props.LEGAL_REF || props.rechtsgrundlage || "";
        if (legalRef) {
          const tc2 = props.type_code || props.TYPE_CODE || "";
          const classified = classifyLegalRef(legalRef, "", tc2);
          if (classified.explanation) name = classified.explanation;
        }
      }
      if (!name) name = layerLabel;

      const DETAIL_KEY_LABELS: Record<string, string> = {
        name: "Name", bezeichnung: "Bezeichnung",
        type_code: "Typ", legal_ref: "Rechtshinweis",
        lower_limit_altitude: "Untere Grenze", upper_limit_altitude: "Obere Grenze",
        lower_limit_alt_ref: "Untere Grenze Ref", upper_limit_alt_ref: "Obere Grenze Ref",
        lower_limit_unit: "Einheit (unten)", upper_limit_unit: "Einheit (oben)",
        external_reference: "Identifikation",
      };
      const detailParts: string[] = [];
      for (const [key, val] of Object.entries(props)) {
        if (val === "null") continue;
        const lk = key.toLowerCase();
        if (lk === "name" || lk === "bezeichnung") continue;
        let displayVal = val;
        if (lk === "type_code") displayVal = humanizeTypeCode(val);
        if (lk === "legal_ref" || lk === "rechtsgrundlage") {
          const tc = props.type_code || props.TYPE_CODE || "";
          const classified = classifyLegalRef(val, "", tc);
          if (classified.explanation) displayVal = `${val} – ${classified.explanation}`;
        }
        const displayKey = DETAIL_KEY_LABELS[lk] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        detailParts.push(`${displayKey}: ${displayVal}`);
      }

      results.push({
        layerLabel,
        name,
        details: detailParts.join("\n"),
        featureId: props.uuid || props.UUID || props.external_reference || props.id || undefined,
      });
    }
  }

  return results;
}
