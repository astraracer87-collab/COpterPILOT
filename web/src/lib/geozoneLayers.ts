export type WmsLayer = {
  id: string;
  label: string;
  baseUrl: string;
  layer: string;
  format?: string;
  version?: string;
  styles?: string;
  defaultEnabled?: boolean;
};

export type LayerGroup = {
  country: "DE" | "CH" | "LU" | "NL";
  label: string;
  layers: WmsLayer[];
};

const DE_BASE = "https://uas-betrieb.de/geoservices/dipul/wms";
const CH_BASE = "https://wms.geo.admin.ch/";
const LU_BASE = "https://wms.geoportail.lu/public_map_layers/service";
const NL_BASE = "https://service.pdok.nl/lvnl/drone-no-flyzones/wms/v1_0";

export const LAYER_GROUPS: LayerGroup[] = [
  {
    country: "DE",
    label: "Deutschland (Dipul)",
    layers: [
      { id: "de_kontrollzonen", label: "Kontrollzonen (CTR)", baseUrl: DE_BASE, layer: "kontrollzonen", defaultEnabled: true },
      { id: "de_edr", label: "Flugbeschränkungsgebiete (ED-R)", baseUrl: DE_BASE, layer: "flugbeschraenkungsgebiete", defaultEnabled: true },
      { id: "de_temp", label: "Temporäre Beschränkungen", baseUrl: DE_BASE, layer: "temporaere_betriebseinschraenkungen", defaultEnabled: true },
      { id: "de_flughaefen", label: "Flughäfen", baseUrl: DE_BASE, layer: "flughaefen", defaultEnabled: true },
      { id: "de_flugplaetze", label: "Flugplätze", baseUrl: DE_BASE, layer: "flugplaetze", defaultEnabled: true },
      { id: "de_naturschutz", label: "Naturschutzgebiete", baseUrl: DE_BASE, layer: "naturschutzgebiete" },
      { id: "de_nationalparks", label: "Nationalparks", baseUrl: DE_BASE, layer: "nationalparks" },
      { id: "de_ffh", label: "FFH-Gebiete", baseUrl: DE_BASE, layer: "ffh-gebiete" },
      { id: "de_militaer", label: "Militärische Anlagen", baseUrl: DE_BASE, layer: "militaerische_anlagen", defaultEnabled: true },
      { id: "de_strom", label: "Stromleitungen", baseUrl: DE_BASE, layer: "stromleitungen" },
      { id: "de_kraftwerke", label: "Kraftwerke", baseUrl: DE_BASE, layer: "kraftwerke" },
      { id: "de_wind", label: "Windkraftanlagen", baseUrl: DE_BASE, layer: "windkraftanlagen" },
      { id: "de_autobahnen", label: "Bundesautobahnen", baseUrl: DE_BASE, layer: "bundesautobahnen" },
      { id: "de_bahn", label: "Bahnanlagen", baseUrl: DE_BASE, layer: "bahnanlagen" },
      { id: "de_modellflug", label: "Modellflugplätze", baseUrl: DE_BASE, layer: "modellflugplaetze" },
      { id: "de_wohn", label: "Wohngrundstücke", baseUrl: DE_BASE, layer: "wohngrundstuecke" },
    ],
  },
  {
    country: "CH",
    label: "Schweiz (BAZL)",
    layers: [
      { id: "ch_drohnen", label: "Drohnen-Einschränkungen", baseUrl: CH_BASE, layer: "ch.bazl.einschraenkungen-drohnen", defaultEnabled: true },
      { id: "ch_uas", label: "UAS-Aktivitätszonen", baseUrl: CH_BASE, layer: "ch.bazl.uas-aktivitaetszonen", defaultEnabled: true },
      { id: "ch_ruhe", label: "Landschaftsruhezonen", baseUrl: CH_BASE, layer: "ch.bazl.landschaftsruhezonen" },
      { id: "ch_wohn", label: "Wohngebiete (AuLaV)", baseUrl: CH_BASE, layer: "ch.bazl.wohngebiete-aulav" },
    ],
  },
  {
    country: "LU",
    label: "Luxemburg",
    layers: [
      { id: "lu_zones", label: "Drohnen-Zonen (Geoportail)", baseUrl: LU_BASE, layer: "drone_zones", defaultEnabled: true },
    ],
  },
  {
    country: "NL",
    label: "Niederlande (LVNL)",
    layers: [
      { id: "nl_no_fly", label: "Drone No-Fly Zones", baseUrl: NL_BASE, layer: "luchtvaartgebieden", defaultEnabled: true },
    ],
  },
];

export const ALL_LAYERS: WmsLayer[] = LAYER_GROUPS.flatMap((g) => g.layers);
