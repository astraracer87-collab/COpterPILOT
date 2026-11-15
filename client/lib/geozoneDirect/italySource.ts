// Italien (d-flight S.p.A., ENAV) – Abruf mit dem eigenen d-flight-Konto des
// Nutzers. Ohne eingetragenen Zugang wird nichts geladen (Fehler „Kein
// d-flight-Zugang eingetragen“). Siehe docs/dflight-it-api-integration.md,
// „Anhang IT“ (maßgeblich):
//
//  1. Anmeldung (Password-Grant, dflightAuth.ts). NUR ein fehlgeschlagener
//     Login meldet einen Zugangsdaten-Fehler.
//  2. Optional: ED-269-Gesamtdownload (für Rolle USER gesperrt, 401). Jeder
//     Fehlschlag fällt still auf den WFS zurück; nach einer Ablehnung wird er
//     bis zum App-Neustart nicht mehr versucht.
//  3. Hauptweg: GeoServer-WFS D-FLIGHT:ATM09_INFO (Bearer, Paging
//     count/startIndex), dazu NO_FLY_ZONE (temporäre Verbotszonen) und NOTAM.
//     Die beiden temporären Ebenen sind optional (Fehler nur im Log).
import type { GeoFeature } from "./ed269Sources";
import { finalizeDirectFeatures } from "./directFetchUtil";
import {
  DFLIGHT_NO_CREDENTIALS_MESSAGE,
  DflightAuthError,
  dflightAuthorizedGet,
  dflightBearerGet,
  getDflightAccessToken,
  getDflightCredentials,
  getDflightRuntimeConfig,
} from "./dflightAuth";
import {
  IT_DFLIGHT_ED269_URL,
  IT_WFS_LAYER_NFZ,
  IT_WFS_LAYER_NOTAM,
  IT_WFS_LAYER_ZONES,
  IT_WFS_PAGE_SIZE,
  decodeItalianDownload,
  italianWfsUrl,
  normalizeItalianWfs,
  normalizeItalianZones,
  type ItalianWfsLayer,
} from "../../../shared/italianGeozones";
import { fetchWfsPaged } from "../../../shared/geozoneKit/wfs";

export {
  IT_DFLIGHT_ED269_URL,
  IT_GEOZONE_SOURCE_LABEL,
  IT_GEOZONE_ATTRIBUTION,
} from "../../../shared/italianGeozones";

const IT_DOWNLOAD_TIMEOUT_MS = 120_000;
/** Obergrenze je Layer (Sicherheitsnetz gegen Endlos-Paging). */
const IT_WFS_MAX_FEATURES: Readonly<Record<ItalianWfsLayer, number>> = {
  [IT_WFS_LAYER_ZONES]: 10_000,
  [IT_WFS_LAYER_NFZ]: 30_000,
  [IT_WFS_LAYER_NOTAM]: 1_000,
};

/** Normalisiert eine bereits geladene ED-269-Antwort (für Tests/Offline). */
export function italyFeaturesFromBody(body: unknown, now: Date = new Date()): GeoFeature[] {
  return finalizeDirectFeatures(normalizeItalianZones(body, now) as unknown as GeoFeature[], "it");
}

/** Normalisiert eine bereits geladene WFS-Antwort eines Layers (für Tests/Offline). */
export function italyFeaturesFromWfs(body: unknown, layer: ItalianWfsLayer, now: Date = new Date()): GeoFeature[] {
  return finalizeDirectFeatures(normalizeItalianWfs(body, layer, now) as unknown as GeoFeature[], "it");
}

/** Abhängigkeiten von fetchItalyWith (Netz/Anmeldung) – in Tests ersetzbar. */
export type ItalyFetchDeps = {
  hasCredentials: () => Promise<boolean>;
  /** Anmeldung bzw. gültigen Token sicherstellen (wirft bei falschen Zugangsdaten). */
  login: () => Promise<unknown>;
  ed269Url: () => Promise<string>;
  /** Bearer + CSRF (ED-269-Download). */
  ed269Get: (url: string) => Promise<Response>;
  /** Bearer (GeoServer-WFS). */
  wfsGet: (url: string) => Promise<Response>;
  now: () => Date;
};

const defaultDeps: ItalyFetchDeps = {
  hasCredentials: async () => !!(await getDflightCredentials()),
  login: () => getDflightAccessToken(),
  ed269Url: async () => {
    try {
      return (await getDflightRuntimeConfig()).ed269Url || IT_DFLIGHT_ED269_URL;
    } catch {
      return IT_DFLIGHT_ED269_URL;
    }
  },
  ed269Get: (url) => dflightAuthorizedGet(url, IT_DOWNLOAD_TIMEOUT_MS),
  wfsGet: (url) => dflightBearerGet(url, IT_DOWNLOAD_TIMEOUT_MS),
  now: () => new Date(),
};

// ED-269 nach einer Ablehnung (401/403) in dieser App-Sitzung nicht erneut versuchen.
let ed269Denied = false;

/** Nur für Tests. */
export function __resetItalyStateForTests(): void {
  ed269Denied = false;
}

/** Optionaler ED-269-Versuch: Features oder null (jeder Fehler → null, ohne Meldung). */
async function tryItalyEd269(deps: ItalyFetchDeps, now: Date): Promise<GeoFeature[] | null> {
  if (ed269Denied) return null;
  try {
    const res = await deps.ed269Get(await deps.ed269Url());
    if (res.status === 401 || res.status === 403) {
      ed269Denied = true; // Rolle USER: Download gesperrt – kein Zugangsdaten-Fehler.
      return null;
    }
    if (!res.ok) return null;
    const features = italyFeaturesFromBody(decodeItalianDownload(new Uint8Array(await res.arrayBuffer())), now);
    return features.length > 0 ? features : null;
  } catch (e) {
    console.warn("[geozoneDirect] IT: ED-269-Download nicht nutzbar, weiter mit WFS:", (e as Error)?.message || e);
    return null;
  }
}

const LAYER_LABEL_DE: Record<ItalianWfsLayer, string> = {
  [IT_WFS_LAYER_ZONES]: "UAS-Geozonen",
  [IT_WFS_LAYER_NFZ]: "temporäre Verbotszonen",
  [IT_WFS_LAYER_NOTAM]: "NOTAM",
};

/** Alle Features eines WFS-Layers (Paging count/startIndex). */
async function fetchItalyWfsLayer(deps: ItalyFetchDeps, layer: ItalianWfsLayer, now: Date): Promise<any[]> {
  const pageSize = IT_WFS_PAGE_SIZE[layer];
  return fetchWfsPaged({
    pageSize,
    maxPages: Math.ceil(IT_WFS_MAX_FEATURES[layer] / pageSize),
    pageUrl: (startIndex, count) => italianWfsUrl(layer, { count, startIndex, now }),
    fetchJson: async (url) => {
      const res = await deps.wfsGet(url);
      if (res.status === 401 || res.status === 403) {
        // Login war erfolgreich – die Ablehnung betrifft die Ebene, nicht die Zugangsdaten.
        throw new DflightAuthError(
          `d-flight: Kartendaten (${LAYER_LABEL_DE[layer]}) nicht freigegeben (HTTP ${res.status}) – das d-flight-Konto hat für diese Ebene keinen Zugriff`,
          "server",
          res.status,
        );
      }
      if (!res.ok) throw new Error(`d-flight WFS (${LAYER_LABEL_DE[layer]}): HTTP ${res.status}`);
      return await res.json();
    },
  });
}

/** Lädt alle italienischen Geozonen mit den übergebenen Abhängigkeiten. */
export async function fetchItalyWith(deps: ItalyFetchDeps): Promise<GeoFeature[]> {
  if (!(await deps.hasCredentials())) throw new Error(DFLIGHT_NO_CREDENTIALS_MESSAGE);
  // Einzige Stelle, an der Zugangsdaten-Fehler entstehen (falsches Passwort usw.).
  await deps.login();
  const now = deps.now();

  let zones = await tryItalyEd269(deps, now);
  if (!zones) {
    const raw = await fetchItalyWfsLayer(deps, IT_WFS_LAYER_ZONES, now);
    zones = italyFeaturesFromWfs(raw, IT_WFS_LAYER_ZONES, now);
  }

  const temporary: GeoFeature[] = [];
  for (const layer of [IT_WFS_LAYER_NFZ, IT_WFS_LAYER_NOTAM] as const) {
    try {
      const raw = await fetchItalyWfsLayer(deps, layer, now);
      temporary.push(...italyFeaturesFromWfs(raw, layer, now));
    } catch (e) {
      console.warn(`[geozoneDirect] IT: ${LAYER_LABEL_DE[layer]} nicht geladen:`, (e as Error)?.message || e);
    }
  }

  const features = [...zones, ...temporary];
  if (zones.length === 0) throw new Error("d-flight lieferte keine Zonen");
  return features;
}

/** Lädt alle italienischen Geozonen. Wirft ohne Zugang, bei Login-Fehler oder leerer Antwort. */
export async function fetchItaly(): Promise<GeoFeature[]> {
  return fetchItalyWith(defaultDeps);
}
