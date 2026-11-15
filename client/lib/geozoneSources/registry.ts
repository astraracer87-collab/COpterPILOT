// Quellen-Registry der Geozonen (B5): EINE Stelle je Länder-Quelle.
//
// Kern-Eigenschaften (Art, Aliase, Aktualisierungs-/Offline-Strategie,
// Mindestzoom, Flags, Anbieter/Lizenz) stehen React-Native-frei in
// shared/geozoneSourceMeta.ts, damit auch shared/ sie nutzen kann. Hier kommen
// hinzu: Quellen-Label (Popup-Untertitel), Pflicht-Attributionen der
// Normalisierer, WMS-Konfiguration, Abruf-Funktion und Datenalter
// (getSourceDataStatus). Alle Länderlisten der App werden aus der Registry
// abgeleitet (ED269_SOURCE_LABELS, COUNTRY_GEOZONE_CONFIGS, Datenquellen,
// Offline-Arten …).
//
// Bewusst frei von React-Native-/Expo-Importen (unter tsx testbar); Gerätecache
// und Kachelspeicher laden expo-file-system nur lazy.
//
// Neues Land: siehe docs/pruefung-umbau-plan.md „Stand B5“.
import {
  GEOZONE_SOURCE_META,
  getGeozoneSourceMeta,
  isSourceDataStale,
  resolveGeozoneSourceIso,
  type GeozoneSourceKind,
  type GeozoneSourceMeta,
} from "../../../shared/geozoneSourceMeta";
import { BELGIAN_GEOZONE_SOURCE_LABEL } from "../../../shared/belgianGeozones";
import { BG_GEOZONE_ATTRIBUTION, BG_GEOZONE_SOURCE_LABEL } from "../../../shared/bulgarianGeozones";
import { HR_GEOZONE_ATTRIBUTION, HR_GEOZONE_SOURCE_LABEL } from "../../../shared/croatianGeozones";
import { CY_GEOZONE_ATTRIBUTION, CY_GEOZONE_SOURCE_LABEL } from "../../../shared/cypriotGeozones";
import { DANISH_GEOZONE_SOURCE_LABEL } from "../../../shared/danishGeozones";
import { GODRONE_ATTRIBUTION, GODRONE_GEOZONE_SOURCE_LABEL } from "../../../shared/dutchGeozones";
import { EANS_GEOZONE_SOURCE_LABEL } from "../../../shared/estonianGeozones";
import { FI_GEOZONE_ATTRIBUTION, FI_GEOZONE_SOURCE_LABEL } from "../../../shared/finnishGeozones";
import { RO_GEOZONE_SOURCE_LABEL, RO_ROMATSA_DRONES_URL } from "../../../shared/geozoneImport";
import { HU_GEOZONE_ATTRIBUTION, HU_GEOZONE_RASTER_HINT } from "../../../shared/geozoneLayerCatalog";
import { IS_GEOZONE_ATTRIBUTION, IS_GEOZONE_SOURCE_LABEL } from "../../../shared/icelandicGeozones";
import { IE_GEOZONE_SOURCE_LABEL, LU_GEOZONE_SOURCE_LABEL } from "../../../shared/irishLuxGeozones";
import { IT_GEOZONE_ATTRIBUTION, IT_GEOZONE_SOURCE_LABEL } from "../../../shared/italianGeozones";
import { LV_GEOZONE_SOURCE_LABEL } from "../../../shared/latvianGeozones";
import { NO_GEOZONE_ATTRIBUTION, NO_GEOZONE_SOURCE_LABEL } from "../../../shared/norwegianGeozones";
import { PL_ATTRIBUTION, PL_GEOZONE_SOURCE_LABEL } from "../../../shared/polishGeozones";
import { PT_GEOZONE_SOURCE_LABEL } from "../../../shared/portugueseGeozones";
import { SK_DU_ATTRIBUTION, SK_GEOZONE_ATTRIBUTION, SK_GEOZONE_SOURCE_LABEL } from "../../../shared/slovakGeozones";
import { SI_GEOZONE_ATTRIBUTION, SI_GEOZONE_SOURCE_LABEL } from "../../../shared/slovenianGeozones";
import { ES_GEOZONE_ATTRIBUTION, ES_GEOZONE_SOURCE_LABEL } from "../../../shared/spanishGeozones";
import { SE_GEOZONE_ATTRIBUTION, SE_GEOZONE_SOURCE_LABEL } from "../../../shared/swedishGeozones";
import { CH_GEOZONE_ATTRIBUTION, CH_GEOZONE_SOURCE_LABEL } from "../../../shared/swissGeozones";
import { GB_ATTRIBUTION, GB_GEOZONE_SOURCE_LABEL } from "../../../shared/ukGeozones";
import {
  ED269_BUNDLED_FALLBACKS,
  ED269_FETCHERS,
  LT_GEOZONE_SOURCE_LABEL,
  type GeoFeature,
} from "../geozoneDirect/ed269Sources";
import { getEd269DatasetStatus } from "../geozoneDirect/ed269Store";
import { getTilePartMeta } from "../geozoneTiles/tileStore";
import { TILE_STORE_ATTRIBUTION } from "../geozoneTiles/tileStoreCore";
import { WMS_GEOZONE_CONFIGS, type CountryGeozoneConfig, type CountryIsoWithGeozones } from "./wmsConfigs";

export type { GeozoneSourceKind, GeozoneSourceMeta } from "../../../shared/geozoneSourceMeta";

/** Client-Ergänzung je Quelle (Labels, Attribution, WMS, Abruf). */
interface GeozoneSourceClientPart {
  /** Quellen-/Anbieterbezeichnung (Popup-Untertitel der Zonen) */
  sourceLabel: string;
  /** Pflicht-Namensnennung(en), exakt wie in der App angezeigt */
  attributions: string[];
  /** Webseite, falls nicht im Kern (aus Konstanten der Quelle) */
  url?: string;
  /** Kachelspeicher-Attribution (DE/FR/CZ) */
  tileAttribution?: { label: string; license?: string; url?: string };
  /** WMS-/XYZ-Konfiguration (Kachel-Overlay, Zusatz-Ebenen) */
  wms?: CountryGeozoneConfig;
  /** Hinweis bei manueller Prüfung (manualCheckOnly) */
  manualCheckHint?: string;
}

export interface GeozoneSource extends GeozoneSourceMeta, GeozoneSourceClientPart {
  iso: CountryIsoWithGeozones;
  /** Abruf des kompletten Landesbestands (Vektor-Feed) */
  fetch?: () => Promise<GeoFeature[]>;
  /** Gebündelte Basisdaten (Rückfall ohne Netz) */
  bundled?: () => GeoFeature[];
}

const CLIENT_PARTS: Record<CountryIsoWithGeozones, GeozoneSourceClientPart> = {
  DE: {
    sourceLabel: TILE_STORE_ATTRIBUTION.DE.label,
    attributions: [TILE_STORE_ATTRIBUTION.DE.label],
    tileAttribution: TILE_STORE_ATTRIBUTION.DE,
    wms: WMS_GEOZONE_CONFIGS.DE,
  },
  CH: {
    sourceLabel: CH_GEOZONE_SOURCE_LABEL,
    attributions: [CH_GEOZONE_ATTRIBUTION],
    wms: WMS_GEOZONE_CONFIGS.CH,
  },
  LU: {
    sourceLabel: LU_GEOZONE_SOURCE_LABEL,
    attributions: ["© Direction de l'Aviation Civile / Geoportail Luxembourg – CC0"],
    wms: WMS_GEOZONE_CONFIGS.LU,
  },
  NL: {
    sourceLabel: GODRONE_GEOZONE_SOURCE_LABEL,
    attributions: [GODRONE_ATTRIBUTION],
    wms: WMS_GEOZONE_CONFIGS.NL,
  },
  FR: {
    sourceLabel: TILE_STORE_ATTRIBUTION.FR.label,
    attributions: [TILE_STORE_ATTRIBUTION.FR.label],
    url: TILE_STORE_ATTRIBUTION.FR.url,
    tileAttribution: TILE_STORE_ATTRIBUTION.FR,
    wms: WMS_GEOZONE_CONFIGS.FR,
  },
  HU: {
    sourceLabel: HU_GEOZONE_ATTRIBUTION,
    attributions: [HU_GEOZONE_ATTRIBUTION],
    wms: WMS_GEOZONE_CONFIGS.HU,
    manualCheckHint: HU_GEOZONE_RASTER_HINT,
  },
  AT: { sourceLabel: "Austro Control (ED-269)", attributions: ["Austro Control (ED-269)"] },
  BE: { sourceLabel: BELGIAN_GEOZONE_SOURCE_LABEL, attributions: ["© skeyes / Droneguide"] },
  DK: { sourceLabel: DANISH_GEOZONE_SOURCE_LABEL, attributions: ["Kilde: Trafikstyrelsen (dronezoner.dk)"] },
  EE: {
    sourceLabel: EANS_GEOZONE_SOURCE_LABEL,
    attributions: ["Quelle: EANS (Lennuliiklusteeninduse AS) / Transpordiamet, utm.eans.ee"],
  },
  IE: { sourceLabel: IE_GEOZONE_SOURCE_LABEL, attributions: [IE_GEOZONE_SOURCE_LABEL] },
  SE: { sourceLabel: SE_GEOZONE_SOURCE_LABEL, attributions: [SE_GEOZONE_ATTRIBUTION] },
  PT: { sourceLabel: PT_GEOZONE_SOURCE_LABEL, attributions: ["© ANAC – Autoridade Nacional da Aviação Civil"] },
  ES: { sourceLabel: ES_GEOZONE_SOURCE_LABEL, attributions: [ES_GEOZONE_ATTRIBUTION] },
  PL: { sourceLabel: PL_GEOZONE_SOURCE_LABEL, attributions: [PL_ATTRIBUTION] },
  LT: { sourceLabel: LT_GEOZONE_SOURCE_LABEL, attributions: ["© Oro navigacija / Lithuanian ANS"] },
  GB: { sourceLabel: GB_GEOZONE_SOURCE_LABEL, attributions: [GB_ATTRIBUTION] },
  IT: { sourceLabel: IT_GEOZONE_SOURCE_LABEL, attributions: [IT_GEOZONE_ATTRIBUTION] },
  IS: { sourceLabel: IS_GEOZONE_SOURCE_LABEL, attributions: [IS_GEOZONE_ATTRIBUTION] },
  CY: { sourceLabel: CY_GEOZONE_SOURCE_LABEL, attributions: [CY_GEOZONE_ATTRIBUTION] },
  HR: { sourceLabel: HR_GEOZONE_SOURCE_LABEL, attributions: [HR_GEOZONE_ATTRIBUTION] },
  SI: { sourceLabel: SI_GEOZONE_SOURCE_LABEL, attributions: [SI_GEOZONE_ATTRIBUTION] },
  BG: { sourceLabel: BG_GEOZONE_SOURCE_LABEL, attributions: [BG_GEOZONE_ATTRIBUTION] },
  LV: { sourceLabel: LV_GEOZONE_SOURCE_LABEL, attributions: [LV_GEOZONE_SOURCE_LABEL] },
  SK: { sourceLabel: SK_GEOZONE_SOURCE_LABEL, attributions: [SK_DU_ATTRIBUTION, SK_GEOZONE_ATTRIBUTION] },
  RO: { sourceLabel: RO_GEOZONE_SOURCE_LABEL, attributions: [RO_GEOZONE_SOURCE_LABEL], url: RO_ROMATSA_DRONES_URL },
  FI: { sourceLabel: FI_GEOZONE_SOURCE_LABEL, attributions: [FI_GEOZONE_ATTRIBUTION] },
  NO: { sourceLabel: NO_GEOZONE_SOURCE_LABEL, attributions: [NO_GEOZONE_ATTRIBUTION] },
  CZ: {
    sourceLabel: TILE_STORE_ATTRIBUTION.CZ.label,
    attributions: [TILE_STORE_ATTRIBUTION.CZ.label],
    url: TILE_STORE_ATTRIBUTION.CZ.url,
    tileAttribution: TILE_STORE_ATTRIBUTION.CZ,
  },
};

/** Alle Geozonen-Quellen (Reihenfolge = shared/geozoneSourceMeta.ts). */
export const GEOZONE_SOURCES: readonly GeozoneSource[] = GEOZONE_SOURCE_META.map((meta) => {
  const iso = meta.iso as CountryIsoWithGeozones;
  const part = CLIENT_PARTS[iso];
  if (!part) throw new Error(`Geozonen-Registry: ${iso} ohne Label/Attribution`);
  return {
    ...meta,
    ...part,
    iso,
    url: meta.url ?? part.url,
    fetch: ED269_FETCHERS[iso],
    bundled: meta.bundledFallback ? ED269_BUNDLED_FALLBACKS[iso] : undefined,
  };
});

const BY_ISO = new Map<string, GeozoneSource>(GEOZONE_SOURCES.map((s) => [s.iso, s]));

/** Quelle eines Landes (Aliase aufgelöst, z. B. LI → CH) oder null. */
export function getGeozoneSource(iso: string | null | undefined): GeozoneSource | null {
  return BY_ISO.get(resolveGeozoneSourceIso(iso)) ?? null;
}

/** Quellen-Label je Land für ED-269-Vektorzonen inkl. Aliase (Popup-Untertitel). */
export function ed269SourceLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of GEOZONE_SOURCES) {
    if (s.offline !== "ed269-store" && s.offline !== "import") continue;
    for (const iso of [s.iso, ...(s.aliases ?? [])]) out[iso] = s.sourceLabel;
  }
  return out;
}

/**
 * COUNTRY_GEOZONE_CONFIGS (geozones.ts): WMS-Länder mit ihrer Konfiguration,
 * alle übrigen Quellen mit der Standard-Vektor-Konfiguration ("ed269-cached",
 * Kachelspeicher ohne WMS: "tiles").
 */
export function buildCountryGeozoneConfigs(): Record<string, CountryGeozoneConfig> {
  const out: Record<string, CountryGeozoneConfig> = {};
  for (const s of GEOZONE_SOURCES) {
    out[s.iso] = s.wms ?? {
      iso: s.iso,
      wmsBaseUrl: "",
      wmsVersion: "1.3.0",
      layers: [],
      featureInfoType: s.kind === "tiled" ? "tiles" : "ed269-cached",
      alwaysVisibleLayerIds: [],
      forceEnabledLayerIds: [],
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Datenalter je Quelle
// ---------------------------------------------------------------------------

export interface SourceDataStatus {
  /** Zeitpunkt des gespeicherten Bestands (ms) bzw. des Datei-Imports; null = keiner/live */
  fetchedAt: number | null;
  ageMs: number | null;
  /** Älter als staleWarnAfterMs der Registry-Policy */
  stale: boolean;
  kind: GeozoneSourceKind | null;
  /** Bestand stammt aus einem Datei-Import */
  imported?: boolean;
}

/**
 * Datenalter des gespeicherten Bestands eines Landes – aus dem ED-269-
 * Gerätecache (inkl. Import-Metadaten) bzw. den Metadaten des
 * Kachelspeichers. Liest nur bereits geladene Metadaten (synchron, kein Netz):
 * ED-269 aus dem Speicher-Cache (nach einer Abfrage vorhanden), Kachelspeicher
 * nach loadTileStoreMeta (App-Start).
 */
export function getSourceDataStatus(iso: string | null | undefined, now: number = Date.now()): SourceDataStatus {
  const meta = getGeozoneSourceMeta(iso);
  if (!meta) return { fetchedAt: null, ageMs: null, stale: false, kind: null };
  let fetchedAt: number | null = null;
  let imported: boolean | undefined;
  if (meta.offline === "tile-store") {
    const part = getTilePartMeta(meta.iso, "base");
    fetchedAt = part?.complete && part.createdAt > 0 ? part.createdAt : null;
  } else if (meta.offline === "ed269-store" || meta.offline === "import") {
    const st = getEd269DatasetStatus(meta.iso);
    fetchedAt = st.fetchedAt;
    if (st.imported) imported = true;
  }
  const ageMs = fetchedAt != null ? Math.max(0, now - fetchedAt) : null;
  return {
    fetchedAt,
    ageMs,
    stale: fetchedAt != null && isSourceDataStale(meta.iso, fetchedAt, now),
    kind: meta.kind,
    ...(imported ? { imported } : {}),
  };
}
