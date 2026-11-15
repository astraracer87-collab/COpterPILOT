// Slowenien (SI) – Normalisierung der UAS-Geozonen der CAA Slovenia
// (Javna agencija za civilno letalstvo RS, ArcGIS-Online-Organisation
// „caa-slovenia“). Siehe docs/slovenia-caa-api-integration.md.
//
// Ausgabe: GeoJSON-Features mit den Properties, die parseEd269ToGeozoneInfo in
// client/lib/ed269.ts liest (restriction, name, lowerMeters/upperMeters,
// lowerReference/upperReference, message, extendedProperties.localizedMessages,
// infoUrl, notamsUrl, applicationUrl, contactEmail …).
//
// ---------------------------------------------------------------------------
// Aktualität / Layerwahl (live geprüft 2026-11-15)
// ---------------------------------------------------------------------------
// Die im Integrationsdokument genannte App 2d42618566cc4f49a263a676a964ec90 ist
// die „GAT map“ (General Air Traffic, Untertitel „Informacije za splošni
// zračni promet, verzija 1, Marec 2021“, WebMap b380ca2b…). Ihre Zonen-Layer
// (restricted_danger 2021-03-26, CTR_AIRAC_AMDT_108_2021 2021-04-21,
// TMZ_areas 2021-03-29, Danger_corridor_LJD2 2021-03-29, gat_jan2021_v2_gdb
// 2021-02-04) sind veraltet und für die bemannte Luftfahrt gedacht.
//
// Die offizielle DROHNEN-Karte der CAA ist die App
// „GEOGRAFSKA OBMOČJA UAS GEO ZONES - Maj 2026“
// (25ba69037c264c5faa5381174f76f861, Untertitel „last edited May 2026“) mit
// der WebMap „UAS GEO ZONES - May 2026“ (14c35a6c4d5a472ea2ed5b2a75abc690,
// geändert 2026-05-21). Gefunden über die öffentliche Item-Suche
// (q=owner:CAA_SLO). Deren operative Layer werden hier verwendet – alle
// öffentlich, ohne Authentifizierung, Stand (editingInfo.lastEditDate):
//
//   | Layer (WebMap-Titel)             | Dienst                                   | Stand      | Anz. |
//   |----------------------------------|------------------------------------------|------------|------|
//   | Triglav National Park            | UAS_GEO_ZONES___March_2022_WFL1/12       | 2022-03-07 |    1 |
//   | CTR                              | CTR_WGS_24/0                             | 2024-08-07 |    4 |
//   | Restricted - Area                | UAS_GEO_ZONES___March_2022_WFL1/11       | 2022-03-07 |    5 |
//   | TEŠ power plant                  | UAS_GEO_ZONES___March_2022_WFL1/8        | 2025-12-12 |    1 |
//   | Coal mine Premogovnik Velenje    | UAS_GEO_ZONES___March_2022_WFL1/7        | 2025-12-12 |    2 |
//   | Nuclear power plant - prohibited | UAS_GEO_ZONES___March_2022_WFL1/0        | 2024-09-12 |    1 |
//   | Danger area                      | UAS_GEO_ZONES___March_2022_WFL1/10       | 2022-03-07 |    1 |
//   | ELES                             | ELES_2023/0 (Item „ELES_2025“)           | 2025-03-12 |   32 |
//   | Aerodrome VFR                    | letalisca_VFR_jan2023/0                  | 2026-03-06 |   12 |
//   | Aerodrome IFR                    | letalisca_IFR_jan23/0                    | 2024-08-09 |    4 |
//   | airfield                         | airfields_WGS_jan23/0                    | 2023-02-13 |   23 |
//   | Public interest sites - heliports| PIS_feb_23/0                             | 2023-02-24 |    7 |
//   | Heliport                         | Heliports_May_24/0                       | 2024-05-28 |    5 |
//   | Port of Koper - 2025             | Luka_Koper_25/0                          | 2025-06-10 |    5 |
//   | GO_07_SERMIN                     | GO_07_SERMIN/0                           | 2025-08-21 |    6 |
//   | ModelarskeCone                   | ModelarskeCone/0                         | 2025-09-29 |    3 |
//   | GO.08 URSIKS                     | UAS_URSIKS/0                             | 2026-03-02 |   14 |
//   | GO_09_SND                        | GO_09_SND/0                              | 2026-05-21 |    4 |
//
// Bewusst NICHT übernommen:
//   - „Pozidano-built“ (Pozidano_built_May24, 189 789 Gebäude-/Bebauungs-
//     polygone): flächendeckende Regel für bebaute Gebiete („prepovedano“, in
//     der Kategorie „offen“ nur UAS < 1200 g, max. 50 m, tagsüber, mit
//     Zustimmung des Eigentümers und Fluganmeldung). Für einen App-Download
//     viel zu groß (≈ 190 000 Polygone); die Regel gehört in den Länderhinweis.
//   - „FIR“ (Linien, keine Zone), „Skiciraj“ (Zeichen-Layer ohne Dienst).
//   - Layer der GAT-Karte: VFR-Routen, Reporting Points, Flugplatz-Punkte,
//     Paragliding-Startplätze (1-NM-Kreise, Stand 2021, nicht in der UAS-Karte),
//     TMZ (Transponderpflicht für bemannte Luftfahrt, nicht in der UAS-Karte),
//     LJD2-Korridor (nicht in der UAS-Karte) sowie die alten 2021er Restricted-/
//     CTR-Layer (durch die UAS-Layer oben ersetzt).
//
// ---------------------------------------------------------------------------
// Beschränkung (vorsichtig; Behördenangabe „UAS_omejitve/UAS restriction“)
// ---------------------------------------------------------------------------
//   | Behördenangabe                                    | restriction       | Höhe                      |
//   |---------------------------------------------------|-------------------|---------------------------|
//   | prepovedano / forbidden / prohibited              | PROHIBITED        | 0 – unbegrenzt (Ausnahmen |
//   |   (TNP, Flugplätze, Flugfelder, Heliports,        |                   |   per Genehmigung im Text)|
//   |   Kraftwerke, ELES, Hafen, Petrol, JVA …)         |                   |                           |
//   | „dovoljeno do višine 50 m AGL“ (CTR)              | REQ_AUTHORISATION | ab 50 m AGL, ohne Obergr. |
//   |   bis 50 m frei, darüber nur Kategorie „speziell“ |                   |                           |
//   |   mit Zustimmung von Slovenia Control             |                   |                           |
//   | Restricted Area (LJR4/5/6A–C, Aktivierung NOTAM)  | REQ_AUTHORISATION | 0 – unbegrenzt            |
//   | Danger Area (LJD1, NOTAM)                         | CONDITIONAL       | 0 – unbegrenzt            |
//   | Modellfluggelände („dovoljenje za modelarske …“)  | CONDITIONAL       | 0 – unbegrenzt            |
//   | unbekannte Angabe                                 | Layer-Default, sonst REQ_AUTHORISATION |      |
//   Höhenfelder: nur „Visina/Upper“ (URSIKS, 150 → 0–150 m AGL). Sonst ab
//   Boden ohne Obergrenze, außer der Text nennt „bis N m AGL erlaubt“ (CTR).
//
// Texte: Alle live vorkommenden slowenischen/englischen Angaben (Beschränkung,
// Ausnahmen, Grund, Rechtsgrundlage, Zonennamen) werden über ein eingebautes
// Wörterbuch ins Deutsche übertragen; unbekannte Angaben werden nicht geraten
// („siehe Originaltext“). Alle Behördenfelder stehen unverändert unter
// „Originaltext der Behörde:“.
//
// Geometrie: unverändert (volle Präzision, keine Vereinfachung).
// Bewusst frei von React-Native-Importen (unter tsx/Node testbar); keine
// Lookbehinds und keine \p{…}-Klassen (Hermes-kompatibel), kein normalize().
import { arcgisPage, arcgisQueryUrl } from "./geozoneKit/arcgis";
import {
  NO_HEIGHT_LINE_DE,
  SEE_ORIGINAL_DE,
  appendOriginalText,
  localizedExtendedProperties,
  sourceLineDe,
} from "./geozoneKit/messages";
import { collapseWhitespace } from "./geozoneKit/text";

export const SI_GEOZONE_SOURCE_LABEL = "CAA Slovenia";
export const SI_GEOZONE_ATTRIBUTION = "© Javna agencija za civilno letalstvo RS (CAA Slovenia)";
export const SI_ARCGIS_BASE = "https://services6.arcgis.com/1F2lR3M9nMUYDj5l/arcgis/rest/services";
/** WebMap „UAS GEO ZONES - May 2026“ der CAA Slovenia. */
export const SI_UAS_WEBMAP_ID = "14c35a6c4d5a472ea2ed5b2a75abc690";
/** Offizielle UAS-Geozonen-Karte (Web AppBuilder). */
export const SI_UAS_MAP_URL =
  "https://caa-slovenia.maps.arcgis.com/apps/webappviewer/index.html?id=25ba69037c264c5faa5381174f76f861";
/** Luftraumsperren / aktive Gebiete (Slovenia Control). */
export const SI_AIRSPACE_CLOSURES_URL = "https://www.sloveniacontrol.si/Strani/Zapore.aspx";

export type SiRestriction = "PROHIBITED" | "REQ_AUTHORISATION" | "CONDITIONAL";

export type SiZoneKind =
  | "national_park"
  | "ctr"
  | "restricted"
  | "danger"
  | "infrastructure"
  | "nuclear"
  | "aerodrome"
  | "airfield"
  | "heliport"
  | "prison"
  | "model"
  /** Ebene der Web-Map ohne bekannte Feldzuordnung (generisch gelesen). */
  | "other";

/** Feldpaar [slowenisch, englisch] – die Daten tragen beide Sprachen. */
type FieldPair = [string, string];

export interface SiLayerDef {
  key: string;
  /**
   * Zuordnung einer Web-Map-Ebene zu dieser Feld-Definition: weitere Titel
   * (zusätzlich zu `title`, Vergleich gefaltet/klein) bzw. Präfixe des
   * Dienstnamens (z. B. „ELES_“ für ELES_2023 → ELES_2025). Ebenen im
   * gemeinsamen Dienst UAS_GEO_ZONES… werden nur über den Titel erkannt.
   */
  match?: { titles?: string[]; servicePrefixes?: string[] };
  /** Felder je Feature tolerant erkennen (restrict…, subject, except…), siehe siAutoFieldLayer. */
  autoFields?: boolean;
  /** Titel der Ebene in der offiziellen WebMap. */
  title: string;
  /** Pfad relativ zu SI_ARCGIS_BASE: „<Dienst>/FeatureServer/<id>“. */
  service: string;
  kind: SiZoneKind;
  defaultRestriction: SiRestriction;
  /** Namensfelder (slowenisch zuerst). */
  nameFields: string[];
  /** Englische Namensfelder (nur Original/Fallback). */
  nameEnFields?: string[];
  /** Deutsches Präfix, falls der Name die Gattung nicht nennt. */
  namePrefix?: string;
  restriction?: FieldPair;
  exceptions?: { label: string; fields: FieldPair }[];
  reason?: FieldPair;
  regulation?: FieldPair;
  contact?: string[];
  info?: string[];
  notam?: string[];
  form?: string[];
  upper?: string[];
}

const UAS = "UAS_GEO_ZONES___March_2022_WFL1/FeatureServer";
const EXC_OPEN_SPECIFIC = "Ausnahmen (Kategorie „offen“ und „speziell“)";

/** Operative Zonen-Layer der WebMap „UAS GEO ZONES - May 2026“. */
export const SI_LAYERS: SiLayerDef[] = [
  {
    key: "tnp", title: "Triglav National Park", service: `${UAS}/12`, kind: "national_park",
    defaultRestriction: "PROHIBITED", nameFields: ["IME_ZNAMEN"], nameEnFields: ["Subject"],
    restriction: ["UAS_omejitve", "UAS_restriction"],
    exceptions: [{ label: EXC_OPEN_SPECIFIC, fields: ["Izjeme_odprta_posebna_kat", "Exceptions_open_specific_cat"] }],
    info: ["Information", "Informacije"],
  },
  {
    key: "ctr", title: "CTR", service: "CTR_WGS_24/FeatureServer/0", kind: "ctr", match: { servicePrefixes: ["CTR_WGS"] },
    defaultRestriction: "REQ_AUTHORISATION", nameFields: ["OBMOCJE"], nameEnFields: ["Subject"],
    restriction: ["OMEJITEV", "UAS_restriction2"],
    exceptions: [
      { label: "Während der Betriebszeit der Kontrollzone", fields: ["Izjeme_obratuje", "Exceptions_oper"] },
      { label: "Außerhalb der Betriebszeit", fields: ["Izjeme_ne_obr", "Exceptions_outs"] },
    ],
    contact: ["Kontakt_Co"],
  },
  {
    key: "restricted", title: "Restricted - Area", service: `${UAS}/11`, kind: "restricted",
    match: { titles: ["Restricted area", "Restricted areas"] },
    defaultRestriction: "REQ_AUTHORISATION", nameFields: ["IME"], notam: ["glej_NOTAM", "Check_NOTAM"],
  },
  {
    key: "tes", title: "TEŠ power plant", service: `${UAS}/8`, kind: "infrastructure", match: { titles: ["TES"] },
    defaultRestriction: "PROHIBITED", nameFields: ["Naziv"], nameEnFields: ["Subject"],
    restriction: ["Omejitev", "Restrict_"], exceptions: [{ label: "Ausnahmen", fields: ["Izjema", "Exception"] }],
    reason: ["Razlog", "Reason"], regulation: ["Zakonodaja", "Regulation"],
  },
  {
    key: "premogovnik", title: "Coal mine Premogovnik Velenje", service: `${UAS}/7`, kind: "infrastructure",
    defaultRestriction: "PROHIBITED", nameFields: ["Naziv"], nameEnFields: ["Subject"],
    restriction: ["Omejitev", "Restrict_"], exceptions: [{ label: "Ausnahmen", fields: ["Izjema", "Exception"] }],
    reason: ["Razlog", "Reason"], regulation: ["Zakonodaja", "Regulation"],
  },
  {
    key: "jek", title: "Nuclear power plant - prohibited", service: `${UAS}/0`, kind: "nuclear",
    match: { titles: ["Nuclear power plant"] },
    defaultRestriction: "PROHIBITED", nameFields: ["Naziv"], nameEnFields: ["Zone"],
    restriction: ["UAS_omejitve", "UAS_restrictions"],
    exceptions: [{ label: "Ausnahmen (Kategorie „speziell“)", fields: ["Izjeme_posebna", "Exceptions_specific"] }],
  },
  {
    key: "danger", title: "Danger area", service: `${UAS}/10`, kind: "danger", match: { titles: ["Danger areas"] },
    defaultRestriction: "CONDITIONAL", nameFields: ["Naziv"], notam: ["Check_NOTAM"],
  },
  {
    key: "eles", title: "ELES", service: "ELES_2023/FeatureServer/0", kind: "infrastructure", match: { servicePrefixes: ["ELES_"] },
    defaultRestriction: "PROHIBITED", nameFields: ["NAZIV"], nameEnFields: ["SUBJECT"],
    restriction: ["OMEJITEV", "RESTRICT_"], exceptions: [{ label: "Ausnahmen", fields: ["IZJEMA", "EXCEPTION"] }],
    reason: ["RAZLOG", "REASON"], regulation: ["ZAKON", "REGUL"], form: ["Obrazec"],
  },
  {
    key: "aerodrome_vfr", title: "Aerodrome VFR", service: "letalisca_VFR_jan2023/FeatureServer/0", kind: "aerodrome",
    match: { servicePrefixes: ["letalisca_VFR"] },
    defaultRestriction: "PROHIBITED", nameFields: ["letalisce"], nameEnFields: ["Subject"], namePrefix: "Flugplatz",
    restriction: ["UAS_omejitve", "UAS_restriction"],
    exceptions: [{ label: EXC_OPEN_SPECIFIC, fields: ["Izjeme_odprta_posebna", "Exceptions_open_specific"] }],
    contact: ["kontakt"],
  },
  {
    key: "aerodrome_ifr", title: "Aerodrome IFR", service: "letalisca_IFR_jan23/FeatureServer/0", kind: "aerodrome",
    match: { servicePrefixes: ["letalisca_IFR"] },
    defaultRestriction: "PROHIBITED", nameFields: ["LETALISCE"], nameEnFields: ["Subject"], namePrefix: "Flughafen",
    restriction: ["UAS_omejitve", "UAS_restriction"],
    exceptions: [
      { label: "Ausnahmen bei geöffnetem Flughafen", fields: ["Izjeme_deluje", "Exceptionsopen"] },
      { label: "Bei geschlossenem Flughafen", fields: ["Izjeme_zaprto", "Except_closed"] },
    ],
    contact: ["Kontakt"],
  },
  {
    key: "airfield", title: "airfield", service: "airfields_WGS_jan23/FeatureServer/0", kind: "airfield",
    match: { titles: ["airfields"], servicePrefixes: ["airfields_WGS"] },
    defaultRestriction: "PROHIBITED", nameFields: ["Ime"], namePrefix: "Flugfeld",
    restriction: ["UAS_omejit", "UAS_restri"], exceptions: [{ label: "Ausnahmen", fields: ["izjeme", "exceptions"] }],
  },
  {
    key: "pis_heliport", title: "Public interest sites - heliports", service: "PIS_feb_23/FeatureServer/0",
    match: { servicePrefixes: ["PIS_"] },
    kind: "heliport", defaultRestriction: "PROHIBITED", nameFields: ["Naziv"], nameEnFields: ["Subject"],
    namePrefix: "Hubschrauberlandeplatz",
    restriction: ["UAS_omejit", "UAS_restri"], exceptions: [{ label: "Ausnahmen", fields: ["Izjeme_za", "Exceptions"] }],
  },
  {
    key: "heliport", title: "Heliport", service: "Heliports_May_24/FeatureServer/0", kind: "heliport",
    match: { titles: ["Heliports"], servicePrefixes: ["Heliports_"] },
    defaultRestriction: "PROHIBITED", nameFields: ["Obmocje"], nameEnFields: ["Contact_approval"],
    namePrefix: "Hubschrauberlandeplatz",
    restriction: ["UAS_omejitve", "UAS_restriction"], exceptions: [{ label: "Ausnahmen", fields: ["Izjeme", "Exceptions"] }],
    contact: ["Kontakt"],
  },
  {
    key: "port_koper", title: "Port of Koper - 2025", service: "Luka_Koper_25/FeatureServer/0", kind: "infrastructure",
    match: { titles: ["Port of Koper"], servicePrefixes: ["Luka_Koper", "Luka_KP"] },
    defaultRestriction: "PROHIBITED", nameFields: ["Naziv"], nameEnFields: ["Subject"],
    restriction: ["omejitev", "Restric"], exceptions: [{ label: "Ausnahmen", fields: ["Izjema", "Exempt"] }],
    reason: ["Razlog", "Reason"], regulation: ["Zakonodaja", "Regul"], contact: ["Kontakt", "Contact"],
  },
  {
    key: "sermin", title: "GO_07_SERMIN", service: "GO_07_SERMIN/FeatureServer/0", kind: "infrastructure",
    match: { servicePrefixes: ["GO_07_SERMIN"] },
    defaultRestriction: "PROHIBITED", nameFields: ["NAME", "Naziv"], nameEnFields: ["Subject"],
    namePrefix: "Petrol-Terminal Sermin",
    restriction: ["omejitev", "Restrict_"], exceptions: [{ label: "Ausnahmen", fields: ["Izjema", "Exception"] }],
    reason: ["Razlog", "Reason"], regulation: ["Zakonodaja", "Regulation"], contact: ["Kontakt", "Contact"],
  },
  {
    key: "model", title: "ModelarskeCone", service: "ModelarskeCone/FeatureServer/0", kind: "model",
    match: { servicePrefixes: ["ModelarskeCone"] },
    defaultRestriction: "CONDITIONAL", nameFields: ["Obmocje"], nameEnFields: ["Subject"], namePrefix: "Modellfluggelände",
    restriction: ["Omejitve", "Restrict_"], contact: ["Kontakt", "Contact"],
  },
  {
    key: "ursiks", title: "GO.08 URSIKS", service: "UAS_URSIKS/FeatureServer/0", kind: "prison",
    match: { titles: ["GO_08_URSIKS"], servicePrefixes: ["UAS_URSIKS"] },
    defaultRestriction: "PROHIBITED", nameFields: ["naziv"], nameEnFields: ["subject"],
    restriction: ["omejitev", "Restrict_"], exceptions: [{ label: "Ausnahmen", fields: ["Izjema", "Exception"] }],
    reason: ["Razlog", "Reason"], regulation: ["Zakonodaja", "Regulation"], contact: ["Kontakt", "Contact"],
    upper: ["Visina", "Upper"],
  },
  {
    key: "snd", title: "GO_09_SND", service: "GO_09_SND/FeatureServer/0", kind: "infrastructure",
    match: { servicePrefixes: ["GO_09_SND"] },
    defaultRestriction: "PROHIBITED", nameFields: ["NAZIV"], nameEnFields: ["SUBJECT"],
    restriction: ["Omejitev", "Restrict_"], exceptions: [{ label: "Ausnahmen", fields: ["Izjema", "Exception"] }],
    reason: ["RAZLOG", "REASON"], regulation: ["Zakonodaja", "Regulation"], contact: ["Kontakt", "Contact"],
  },
];

export function siLayerUrl(layer: SiLayerDef): string {
  return `${SI_ARCGIS_BASE}/${layer.service}`;
}

export function siLayerByKey(key: string): SiLayerDef | undefined {
  return SI_LAYERS.find((l) => l.key === key);
}

// ---------------------------------------------------------------------------
// Ebenen dynamisch aus der Web Map (Pflicht laut Doku: die CAA tauscht bei
// Updates ganze Dienste aus, z. B. ELES_2023 → ELES_2025, Luka_KP →
// Luka_Koper_25). SI_LAYERS ist nur noch die Feldzuordnung (über Titel bzw.
// Dienst-Präfix) und der Rückfall, wenn die Web Map nicht lesbar ist.
// ---------------------------------------------------------------------------

/** Web-Map-Definition (JSON) der offiziellen UAS-Karte. */
export const SI_WEBMAP_DATA_URL = `https://www.arcgis.com/sharing/rest/content/items/${SI_UAS_WEBMAP_ID}/data?f=json`;

/**
 * Bewusst NICHT übernommene Ebenen der Web Map: FIR (Linie, keine Zone),
 * Pozidano (bebaute Gebiete, ≈ 190 000 Polygone – zurückgestellt, PO),
 * Skiciraj (Zeichenebene ohne Dienst).
 */
const SI_EXCLUDED_TITLE_RE = /^(?:fir|skiciraj)$|pozidano/;
const SI_EXCLUDED_SERVICE_RE = /^(?:fir\d*|pozidano)/i;

export interface SiResolvedLayers {
  /** Zu ladende Ebenen (Feldzuordnung + aktueller Dienstpfad). */
  layers: SiLayerDef[];
  /** Titel der Web-Map-Ebenen ohne bekannte Feldzuordnung (generisch gelesen). */
  generic: string[];
  /** Bewusst ausgelassene Ebenen (FIR, Pozidano, ohne Dienst-URL …). */
  skipped: string[];
}

/** Dienstpfad „<Dienst>/FeatureServer/<id>“ aus einer Ebenen-URL unter SI_ARCGIS_BASE; sonst null. */
export function siServicePathFromUrl(url: unknown): string | null {
  const u = String(url ?? "").trim().replace(/\/+$/, "");
  const m = u.match(/\/rest\/services\/(.+\/FeatureServer\/\d+)$/i);
  if (!m || !u.toLowerCase().startsWith(SI_ARCGIS_BASE.toLowerCase())) return null;
  return m[1];
}

function siServiceName(servicePath: string): string {
  return servicePath.split("/")[0] ?? "";
}

/** Feld-Definition für eine Web-Map-Ebene (Titel, sonst Dienst-Präfix); null = unbekannt. */
export function siLayerDefFor(title: string, servicePath: string, defs: readonly SiLayerDef[] = SI_LAYERS): SiLayerDef | null {
  const t = siKey(title);
  if (t) {
    for (const d of defs) {
      const titles = [d.title, ...(d.match?.titles ?? [])].map(siKey);
      if (titles.includes(t)) return d;
    }
  }
  const svc = siServiceName(servicePath).toLowerCase();
  if (svc) {
    for (const d of defs) {
      if ((d.match?.servicePrefixes ?? []).some((pre) => svc.startsWith(pre.toLowerCase()))) return d;
    }
  }
  return null;
}

function slug(s: string): string {
  return foldSl(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "ebene";
}

/** Generische Definition für eine unbekannte Ebene (Felder je Feature erkannt, vorsichtig genehmigungspflichtig). */
export function siGenericLayerDef(title: string, servicePath: string): SiLayerDef {
  return {
    key: `wm_${slug(siServiceName(servicePath) || title)}`,
    title: title || siServiceName(servicePath),
    service: servicePath,
    kind: "other",
    defaultRestriction: "REQ_AUTHORISATION",
    nameFields: [],
    autoFields: true,
  };
}

function walkWebmapLayers(list: unknown, out: { title: string; url: unknown }[]): void {
  if (!Array.isArray(list)) return;
  for (const l of list) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, any>;
    if (Array.isArray(o.layers) && !o.url) walkWebmapLayers(o.layers, out);
    else out.push({ title: String(o.title ?? "").trim(), url: o.url });
  }
}

/**
 * Ebenen aus der Web-Map-Definition (`…/items/<id>/data?f=json` →
 * operationalLayers[].url, Gruppen rekursiv). Bekannte Ebenen erhalten ihre
 * Feldzuordnung (Titel/Dienst-Präfix) mit dem AKTUELLEN Dienstpfad; unbekannte
 * werden generisch gelesen; FIR/Pozidano/Ebenen ohne Dienst entfallen.
 */
export function resolveSloveniaLayersFromWebmap(webmap: any, defs: readonly SiLayerDef[] = SI_LAYERS): SiResolvedLayers {
  const entries: { title: string; url: unknown }[] = [];
  walkWebmapLayers(webmap?.operationalLayers, entries);
  const layers: SiLayerDef[] = [];
  const generic: string[] = [];
  const skipped: string[] = [];
  const usedKeys = new Set<string>();
  const usedServices = new Set<string>();
  for (const { title, url } of entries) {
    const servicePath = siServicePathFromUrl(url);
    if (!servicePath) {
      skipped.push(title || String(url ?? "?"));
      continue;
    }
    if (SI_EXCLUDED_TITLE_RE.test(siKey(title)) || SI_EXCLUDED_SERVICE_RE.test(siServiceName(servicePath))) {
      skipped.push(title || servicePath);
      continue;
    }
    if (usedServices.has(servicePath.toLowerCase())) continue;
    const def = siLayerDefFor(title, servicePath, defs);
    let layer: SiLayerDef;
    if (def && !usedKeys.has(def.key)) {
      layer = { ...def, service: servicePath };
    } else {
      layer = siGenericLayerDef(title, servicePath);
      if (usedKeys.has(layer.key)) layer = { ...layer, key: `${layer.key}_${layers.length}` };
      generic.push(title || servicePath);
    }
    usedKeys.add(layer.key);
    usedServices.add(servicePath.toLowerCase());
    layers.push(layer);
  }
  return { layers, generic, skipped };
}

// Tolerante Feldnamen (Doku: „Feldnamen je Layer verschieden … auf
// restrict*/subject/except* zurückfallen“), SL zuerst, EN danach.
const AUTO_FIELDS: { [K in "name" | "nameEn" | "restriction" | "exception" | "reason" | "regulation" | "contact" | "upper"]: [RegExp, RegExp?] } = {
  name: [/^(?:naziv|ime|ime_znamen|obmocje|letalisce|name)$/i],
  nameEn: [/^(?:subject|zone)$/i],
  restriction: [/^(?:uas_)?omejit/i, /^(?:uas_)?restri/i],
  exception: [/^izjem/i, /^(?:except|exempt)/i],
  reason: [/^razlog/i, /^reason/i],
  regulation: [/^zakon/i, /^regul/i],
  contact: [/^kontakt/i, /^contact/i],
  upper: [/^visina$/i, /^upper$/i],
};

function firstKey(keys: string[], re: RegExp | undefined): string | undefined {
  return re ? keys.find((k) => re.test(k)) : undefined;
}

/** Ebene mit `autoFields`: Feldnamen aus den Attributen eines Features ableiten. */
export function siAutoFieldLayer(layer: SiLayerDef, props: Record<string, any>): SiLayerDef {
  if (!layer.autoFields) return layer;
  const keys = Object.keys(props ?? {});
  const pair = (k: keyof typeof AUTO_FIELDS): [string, string] | undefined => {
    const sl = firstKey(keys, AUTO_FIELDS[k][0]);
    const en = firstKey(keys, AUTO_FIELDS[k][1]);
    return sl || en ? [sl ?? "", en ?? ""] : undefined;
  };
  const one = (k: keyof typeof AUTO_FIELDS): string[] =>
    [firstKey(keys, AUTO_FIELDS[k][0]), firstKey(keys, AUTO_FIELDS[k][1])].filter((x): x is string => !!x);
  const exc = pair("exception");
  return {
    ...layer,
    nameFields: one("name"),
    nameEnFields: one("nameEn"),
    restriction: pair("restriction"),
    exceptions: exc ? [{ label: "Ausnahmen", fields: exc }] : undefined,
    reason: pair("reason"),
    regulation: pair("regulation"),
    contact: one("contact"),
    upper: one("upper"),
  };
}

// ---------------------------------------------------------------------------
// Text-Helfer
// ---------------------------------------------------------------------------

const FOLD: Record<string, string> = {
  č: "c", ć: "c", š: "s", ž: "z", đ: "d", Č: "C", Ć: "C", Š: "S", Ž: "Z", Đ: "D",
};

/** Slowenische/kroatische Sonderzeichen falten (č→c, š→s, ž→z, …). */
export function foldSl(s: string): string {
  return String(s ?? "").replace(/[čćšžđČĆŠŽĐ]/g, (c) => FOLD[c] ?? c);
}

/** Vergleichsschlüssel: gefaltet, klein, Leerraum zusammengefasst, ohne Schlusspunkt. */
export function siKey(s: unknown): string {
  return foldSl(String(s ?? ""))
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.]+$/, "");
}

/** Wert bereinigen (Leerraum, \r\n), leere Strings → "". */
const clean = collapseWhitespace;

/** Feldwert, Feldname ohne Beachtung der Groß-/Kleinschreibung. */
function field(props: Record<string, any>, name: string): unknown {
  if (name in props) return props[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
  return undefined;
}

function firstField(props: Record<string, any>, names: string[] | undefined): string {
  for (const n of names ?? []) {
    const v = clean(field(props, n));
    if (v) return v;
  }
  return "";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex, die Buchstaben mit/ohne Hatschek gleich behandelt (c ≙ č/ć, s ≙ š, z ≙ ž). */
function slRe(pattern: string, flags = "gi"): RegExp {
  const src = escapeRe(foldSl(pattern))
    .replace(/c/gi, "[cčćCČĆ]")
    .replace(/s/gi, "[sšSŠ]")
    .replace(/z/gi, "[zžZŽ]")
    .replace(/ /g, "\\s+");
  return new RegExp(src, flags);
}

function tidy(s: string): string {
  return s
    .replace(/\s+-\s+/g, " – ")
    .replace(/\s+([,.)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Wörterbuch: alle live vorkommenden Angaben (SL und EN) → Deutsch
// ---------------------------------------------------------------------------

const PHRASES: [string[], string][] = [
  // Beschränkung
  [["prepovedano", "forbidden", "prohibited"], "UAS-Flüge verboten"],
  [
    ["dovoljenje za modelarske aktivnosti za člane modelskega kluba", "permit for modeling activities for members of the modeling club"],
    "Modellflug nur für Mitglieder des Modellflugvereins (Genehmigung des Vereins)",
  ],
  // Ausnahmen
  [["dovoljenje TNP (glej info)", "approval from TNP (see information)"], "Genehmigung des Triglav-Nationalparks (TNP) – siehe Informationen"],
  [
    ["posebna kategorija: soglasje KZPS", "specific category only: approval SloveniaControl", "specific category: approval SloveniaControl"],
    "nur Kategorie „speziell“ mit Zustimmung von Slovenia Control (KZPS)",
  ],
  [["odprto 24/7", "open 24/7"], "entfällt – rund um die Uhr in Betrieb (24/7), die Einschränkungen gelten jederzeit"],
  [
    ["izven obratovalnega časa veljajo splošna UAS pravila", "outside operational hours, general UAS rules apply"],
    "außerhalb der Betriebszeiten gelten die allgemeinen UAS-Regeln",
  ],
  [["dovoljenje TEŠ", "approval from TEŠ"], "Genehmigung der TEŠ (Thermokraftwerk Šoštanj)"],
  [["dovoljenje Premogovnik Velenje", "approval from Premogovnik Velenje"], "Genehmigung des Kohlebergwerks Premogovnik Velenje"],
  [
    ["dovoljenje uprave za jedrsko var", "dovoljenje uprave za jedrsko varnost", "Nuclear Safety Administration approval"],
    "Genehmigung der slowenischen Behörde für nukleare Sicherheit (URSJV)",
  ],
  [
    ["predhodna odobritev ali operacije ELES", "authorisation or operations by ELES"],
    "nur mit vorheriger Genehmigung oder bei Einsätzen von ELES (Stromübertragungsnetzbetreiber)",
  ],
  [
    ["soglasje upravljalca letališča (glej kontakt)", "approval from aerodrome operator (see contact)"],
    "Zustimmung des Flugplatzbetreibers (siehe Kontakt)",
  ],
  [
    [
      "prepovedane operacije v radiju 2600m od vzletno pristajalne steze, znotraj tega radija pa le ob soglasju letališča",
      "operations prohibited within a radius of 2600m from RWY, closer with approval by aerodrome operator only",
    ],
    "UAS-Betrieb im Umkreis von 2.600 m um die Start- und Landebahn verboten – innerhalb dieses Umkreises nur mit Zustimmung des Flughafenbetreibers",
  ],
  [["dovoljenje upravljalca vzletišča", "approval from airfield operator"], "Genehmigung des Flugfeldbetreibers"],
  [["soglasje uporabnika območja", "approval from operator"], "Zustimmung des Nutzers bzw. Betreibers des Gebiets"],
  [
    ["Dovoljenje upravljalca heliporta + veljaven certifikat podkategorije A2", "Approval from heliport + valid certificate for subcategory A2"],
    "Genehmigung des Hubschrauberlandeplatz-Betreibers und gültiges Fernpilotenzeugnis für die Unterkategorie A2",
  ],
  [
    ["predhodna odobritev ali operacije Luke Koper", "authorisation of operations by Port of Koper"],
    "nur mit vorheriger Genehmigung oder bei Einsätzen des Hafens Koper (Luka Koper)",
  ],
  [["Predhodna odobritev Petrol", "Authorisation of operation by Petrol"], "nur mit vorheriger Genehmigung durch Petrol d.d."],
  [
    ["predhodna odobritev ali operacije Petrol", "authorisation or operations by Petrol"],
    "nur mit vorheriger Genehmigung oder bei Einsätzen von Petrol d.d.",
  ],
  [
    ["Lastne potrebe ali predhodna odobritev", "For operational needs with prior approval"],
    "nur für eigene Zwecke der Gefängnisverwaltung (URSIKS) oder mit vorheriger Genehmigung",
  ],
  // Grund
  [["varovanje", "security"], "Objektschutz (Sicherheit)"],
  [["varnost in varovanje", "safety and security"], "Sicherheit und Objektschutz"],
];

const PHRASE_MAP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [keys, de] of PHRASES) for (const k of keys) m.set(siKey(k), de);
  return m;
})();

/** Höhen-Freigabe „dovoljeno do višine 50 m AGL“ / „allowed up to a height of 50 m AGL“. */
const ALLOWED_UP_TO_RE = /^(?:dovoljeno do visine|allowed up to (?:a )?height of|allowed up to)\s*(\d{1,4})\s*m\b/;

export function parseSiAllowedUpTo(text: string): number | undefined {
  const m = siKey(text).match(ALLOWED_UP_TO_RE);
  return m ? Number(m[1]) : undefined;
}

/**
 * Eine Behördenangabe (slowenisch oder englisch) ins Deutsche übertragen;
 * null, wenn sie nicht sicher übersetzt werden kann.
 */
export function translateSiPhrase(text: string): string | null {
  const k = siKey(text);
  if (!k) return null;
  const hit = PHRASE_MAP.get(k);
  if (hit) return hit;
  const up = parseSiAllowedUpTo(text);
  if (up != null) return `bis ${up} m über Grund (AGL) erlaubt; darüber nur mit Genehmigung`;
  if (/^(?:check notam|glej notam)/.test(k)) return "aktuelle NOTAMs/Luftraumsperren prüfen";
  return null;
}

/** Paar [SL, EN] übersetzen: SL zuerst, dann EN. */
function translatePair(sl: string, en: string): string | null {
  return (sl && translateSiPhrase(sl)) || (en && translateSiPhrase(en)) || null;
}

// Rechtsgrundlagen: Wortgruppen-Ersetzung (SL und EN), Nummern bleiben.
const REGULATION_RULES: [RegExp, string][] = [
  [slRe("sklep Vlade Republike Slovenije st."), "Beschluss der Regierung der Republik Slowenien Nr."],
  [slRe("sklep Vlade RS, st."), "Beschluss der Regierung der Republik Slowenien Nr."],
  [slRe("Zakon o zasebnem varovanju"), "Gesetz über private Sicherheitsdienste"],
  [/Private Security Act/gi, "Gesetz über private Sicherheitsdienste"],
  [slRe("Uredbe o obveznem organiziranju varovanja"), "Verordnung über die Pflicht zur Einrichtung eines Sicherheitsdienstes"],
  [slRe("Uredba o obveznem organiziranju varovanja"), "Verordnung über die Pflicht zur Einrichtung eines Sicherheitsdienstes"],
  [/Decree on obligatory setting-up of security service/gi, "Verordnung über die Pflicht zur Einrichtung eines Sicherheitsdienstes"],
  [slRe("Zakon o kriticni infrastrukturi"), "Gesetz über kritische Infrastruktur"],
  [/Act on Critical Infrastructure/gi, "Gesetz über kritische Infrastruktur"],
  [slRe("Zakon o izvrsevanju kazenskih sankcij"), "Gesetz über den Vollzug strafrechtlicher Sanktionen"],
  [/Act on the Execution of Criminal Sanctions/gi, "Gesetz über den Vollzug strafrechtlicher Sanktionen"],
  [/Uradni\s+list\s+RS,?\s*(?:št\.|st\.)?\s*/gi, "Amtsblatt der Republik Slowenien Nr. "],
  [/Official\s+Gazette\s+RS,?\s*(?:Nos?\.)?\s*/gi, "Amtsblatt der Republik Slowenien Nr. "],
  [/\s+z\s+dne\s+/gi, " vom "],
  [/(\d+\/\d+)\s+(?:in|and)\s+(\d+\/\d+)/gi, "$1 und $2"],
];

/** Rechtsgrundlage ins Deutsche (Behörden-/Gesetzesnamen übersetzt, Nummern unverändert). */
export function translateSiRegulation(text: string): string {
  let s = clean(text);
  for (const [re, de] of REGULATION_RULES) s = s.replace(re, de);
  return tidy(s.replace(/;\s*/g, "; ").replace(/Nr\.\s+(\d)/g, "Nr. $1"));
}

/** Enthält die übersetzte Rechtsgrundlage noch erkennbar slowenische/englische Wörter? */
export function hasUntranslatedRegulationWords(de: string): boolean {
  return /\b(?:zakon|uredb|sklep|uradni|vlade|act|decree|gazette|official|regulation)\w*/i.test(foldSl(de));
}

// ---------------------------------------------------------------------------
// Zonennamen
// ---------------------------------------------------------------------------

const NAME_EXACT: Record<string, string> = {
  tes: "Thermokraftwerk Šoštanj (TEŠ)",
  eles: "ELES-Anlage (Stromübertragungsnetz)",
  "premogovnik velenje": "Kohlebergwerk Velenje (Premogovnik Velenje)",
  "luka koper": "Hafen Koper (Luka Koper)",
  "go.08 ursiks": "Justizvollzugsanstalt (GO.08 URSIKS)",
};

// Reihenfolge wichtig: längere Wortgruppen zuerst.
const NAME_RULES: [RegExp, string][] = [
  [slRe("Triglavski narodni park"), "Triglav-Nationalpark"],
  [slRe("Kontrolirana cona"), "Kontrollzone"],
  [slRe("Prepovedana cona"), "Verbotszone"],
  [slRe("Nuklearna elektrarna Krsko"), "Kernkraftwerk Krško"],
  [slRe("Nuklearna elektrarna"), "Kernkraftwerk"],
  [slRe("Splosna bolnisnica"), "Allgemeines Krankenhaus"],
  [/^([^-]+?)\s+civilna\s+za[sš][cč]ita$/i, "Zivilschutz $1"],
  [slRe("civilna zascita"), "Zivilschutz"],
  [/^Heliport\s+SB\s+/i, "Hubschrauberlandeplatz Allgemeines Krankenhaus (SB) "],
  [/^Heliport\s+/i, "Hubschrauberlandeplatz "],
  [/\bUKC\b/g, "Universitätsklinikum (UKC)"],
  [slRe("Cevovod v obmocju Luke Koper"), "Pipeline im Bereich des Hafens Koper"],
  [slRe("Varovano obmocje"), "Sicherheitsbereich"],
  [slRe("Kamionsko pretakalisce"), "Lkw-Abfüllstation"],
  [slRe("Zelezniško pretakalisce"), "Bahn-Abfüllstation"],
  [slRe("Cevovod"), "Pipeline"],
  [/\s+-\s+sever$/i, " – Nord"],
  [/\s+-\s+jug$/i, " – Süd"],
  [slRe("Letalisce"), ""],
  [slRe("Vzletisce"), ""],
];

function titleCaseWord(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Zonennamen ins Deutsche: Gattungsbegriffe übersetzt, Eigennamen bleiben.
 * `layer` liefert ggf. ein Präfix (Flugplatz, Flugfeld, …).
 */
export function translateSiZoneName(original: string, layer?: SiLayerDef, enName?: string): string {
  const raw = clean(original);
  if (!raw) return "";
  const k = siKey(raw);
  if (NAME_EXACT[k]) return NAME_EXACT[k];
  // Restricted Areas: „LJ R6A restricted“, „L JR6B restricted“, „LJR 6C restricted“, „LJR5 restricted“.
  const r = raw.match(/^(L\s*J\s*R\s*\d+\s*[A-Z]?)\s+restricted$/i);
  if (r) return `Flugbeschränkungsgebiet ${r[1].replace(/\s+/g, "").toUpperCase()}`;
  // Danger Areas: „LJD1 - Danger area“.
  const d = raw.match(/^(L\s*J\s*D\s*\d+\s*[A-Z]?)\s*-?\s*danger(?:\s+area)?$/i);
  if (d) return `Gefahrengebiet ${d[1].replace(/\s+/g, "").toUpperCase()}`;
  // Erdöllager (SND = skladišče naftnih derivatov): „SND_ZALOG“, „SND RAČE“.
  const snd = raw.match(/^SND[\s_]+(.+)$/i);
  if (snd) {
    const place = snd[1].replace(/_/g, " ").split(/\s+/).map(titleCaseWord).join(" ");
    return `Erdöllager ${place} (SND)`;
  }
  let s = raw;
  for (const [re, de] of NAME_RULES) s = s.replace(re, de);
  s = tidy(s);
  // ICAO-Kennung aus dem englischen Namen („Aerodrome Ljubljana - LJLJ“).
  const icao = (enName ?? "").match(/\b(LJ[A-Z]{2})\b/);
  if (icao && !s.includes(icao[1])) s = `${s} (${icao[1]})`;
  const prefix = layer?.namePrefix;
  if (prefix) {
    // Präfix nur, wenn der Name die Gattung (bzw. bei Sermin „Petrol“) nicht schon nennt.
    const firstWord = siKey(prefix).split(/[\s-]+/)[0];
    const already =
      siKey(s).includes(firstWord) || /^(Hubschrauberlandeplatz|Flugplatz|Flughafen|Flugfeld)\b/.test(s);
    if (!already) s = layer?.key === "sermin" ? `${prefix} – ${s}` : `${prefix} ${s}`;
  }
  return tidy(s);
}

// ---------------------------------------------------------------------------
// Beschränkung
// ---------------------------------------------------------------------------

export interface SiRestrictionDecision {
  restriction: SiRestriction;
  /** Untergrenze aus „bis N m erlaubt“ (CTR). */
  lowerMeters?: number;
  /** true, wenn die Behördenangabe fehlte/unbekannt war (Layer-Default). */
  fromDefault: boolean;
}

/** Beschränkung aus der Behördenangabe [SL, EN] ableiten; sonst Layer-Default. */
export function decideSiRestriction(sl: string, en: string, layer?: SiLayerDef): SiRestrictionDecision {
  const keys = [siKey(sl), siKey(en)].filter(Boolean);
  for (const k of keys) {
    if (/^(?:prepovedano|forbidden|prohibited)\b/.test(k)) return { restriction: "PROHIBITED", fromDefault: false };
  }
  for (const t of [sl, en]) {
    const up = t ? parseSiAllowedUpTo(t) : undefined;
    if (up != null) return { restriction: "REQ_AUTHORISATION", lowerMeters: up, fromDefault: false };
  }
  for (const k of keys) {
    if (/modelars|modeling|modelling/.test(k)) return { restriction: "CONDITIONAL", fromDefault: false };
  }
  return { restriction: layer?.defaultRestriction ?? "REQ_AUTHORISATION", fromDefault: true };
}

// ---------------------------------------------------------------------------
// Meldungstext
// ---------------------------------------------------------------------------

const KIND_DE: Record<SiZoneKind, string> = {
  national_park: "Nationalpark",
  ctr: "Kontrollzone (CTR)",
  restricted: "Flugbeschränkungsgebiet (Restricted Area)",
  danger: "Gefahrengebiet (Danger Area)",
  infrastructure: "Schutzbereich kritische Infrastruktur",
  nuclear: "Kernkraftwerk – Verbotszone",
  aerodrome: "Flugplatz",
  airfield: "Flugfeld (vzletišče)",
  heliport: "Hubschrauberlandeplatz",
  prison: "Justizvollzugsanstalt",
  model: "Modellfluggelände",
  other: "Geozone (UAS)",
};

const RESTRICTION_DE: Record<SiRestriction, string> = {
  PROHIBITED: "UAS-Flüge verboten (Ausnahmen nur wie unten angegeben)",
  REQ_AUTHORISATION: "UAS-Flüge nur mit Genehmigung",
  CONDITIONAL: "Zone mit Auflagen – besondere Vorsicht",
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_RE = /^https?:\/\/\S+$/i;

/** Technische Felder, die nicht in den Originaltext gehören. */
const TECH_FIELDS = /^(?:objectid|fid|id|shape__area|shape__length|shape_leng|shape_area|lat|lon|lat_dec|lon_dec)$/i;

export interface SiParsedZone {
  nameOriginal: string;
  nameEn: string;
  restrictionSl: string;
  restrictionEn: string;
  exceptions: { label: string; sl: string; en: string }[];
  reasonSl: string;
  reasonEn: string;
  regulationSl: string;
  regulationEn: string;
  contact: string;
  email?: string;
  infoUrl?: string;
  notamUrl?: string;
  formUrl?: string;
  upperMeters?: number;
  originalText: string;
}

function urlField(props: Record<string, any>, names: string[] | undefined): string | undefined {
  for (const n of names ?? []) {
    const v = clean(field(props, n));
    if (URL_RE.test(v)) return v;
  }
  return undefined;
}

/** Behördenfelder eines Features (Layer-spezifisch) auslesen. */
export function parseSiZone(props: Record<string, any>, layerDef: SiLayerDef): SiParsedZone {
  const layer = siAutoFieldLayer(layerDef, props);
  const pair = (fp?: FieldPair): [string, string] =>
    fp ? [clean(field(props, fp[0])), clean(field(props, fp[1]))] : ["", ""];
  const [restrictionSl, restrictionEn] = pair(layer.restriction);
  const [reasonSl, reasonEn] = pair(layer.reason);
  const [regulationSl, regulationEn] = pair(layer.regulation);
  const exceptions = (layer.exceptions ?? [])
    .map((e) => {
      const [sl, en] = pair(e.fields);
      return { label: e.label, sl, en };
    })
    .filter((e) => e.sl || e.en);
  // Kontakt: erstes nicht leeres Feld (SL/EN sind i. d. R. identisch).
  const contact = firstField(props, layer.contact);
  const email = contact.match(EMAIL_RE)?.[0];
  let upperMeters: number | undefined;
  for (const n of layer.upper ?? []) {
    const v = Number(field(props, n));
    if (Number.isFinite(v) && v > 0) {
      upperMeters = v;
      break;
    }
  }
  const originalLines: string[] = [`Ebene: ${layer.title}`];
  for (const [k, v] of Object.entries(props)) {
    if (TECH_FIELDS.test(k)) continue;
    const val = clean(v);
    if (val) originalLines.push(`${k}: ${val}`);
  }
  return {
    nameOriginal: firstField(props, layer.nameFields),
    nameEn: firstField(props, layer.nameEnFields),
    restrictionSl,
    restrictionEn,
    exceptions,
    reasonSl,
    reasonEn,
    regulationSl,
    regulationEn,
    contact,
    email,
    infoUrl: urlField(props, layer.info),
    notamUrl: urlField(props, layer.notam),
    formUrl: urlField(props, layer.form),
    upperMeters,
    originalText: originalLines.join("\n"),
  };
}

/** Deutsche, strukturierte Beschreibung + Originaltext der Behörde. */
export function buildSiMessageDe(zone: SiParsedZone, decision: SiRestrictionDecision, layer: SiLayerDef): string {
  const lines: string[] = [];
  lines.push(`Typ: ${KIND_DE[layer.kind]} – ${RESTRICTION_DE[decision.restriction]}`);
  if (zone.restrictionSl || zone.restrictionEn) {
    const de = translatePair(zone.restrictionSl, zone.restrictionEn);
    lines.push(`Beschränkung laut Behörde: ${de ?? SEE_ORIGINAL_DE}`);
  }
  if (decision.fromDefault) {
    if (layer.kind === "restricted") {
      lines.push("Hinweis: Aktivierung per NOTAM – vor dem Flug die aktuellen Luftraumsperren prüfen; bei aktivem Gebiet nur mit Genehmigung.");
    } else if (layer.kind === "danger") {
      lines.push("Hinweis: Gefahrengebiet, Aktivierung per NOTAM – vor dem Flug die aktuellen Luftraumsperren prüfen.");
    } else {
      lines.push("Hinweis zur Einstufung: keine verwertbare Behördenangabe – vorsichtige Einstufung nach Ebene.");
    }
  }
  for (const e of zone.exceptions) {
    const de = translatePair(e.sl, e.en);
    lines.push(`${e.label}: ${de ?? SEE_ORIGINAL_DE}`);
  }
  if (decision.lowerMeters != null) {
    lines.push(
      `Höhe laut Behörde: bis ${decision.lowerMeters} m über Grund (AGL) erlaubt – die Beschränkung gilt ab ${decision.lowerMeters} m AGL ohne Obergrenze.`,
    );
  } else if (zone.upperMeters != null) {
    lines.push(`Höhe laut Behörde: Boden (GND) bis ${zone.upperMeters} m (Bezug nicht angegeben, als über Grund angenommen).`);
  } else {
    lines.push(NO_HEIGHT_LINE_DE);
  }
  if (zone.reasonSl || zone.reasonEn) {
    lines.push(`Grund: ${translatePair(zone.reasonSl, zone.reasonEn) ?? SEE_ORIGINAL_DE}`);
  }
  const reg = zone.regulationSl || zone.regulationEn;
  if (reg) {
    const de = translateSiRegulation(reg);
    lines.push(`Rechtsgrundlage: ${hasUntranslatedRegulationWords(de) ? SEE_ORIGINAL_DE : de}`);
  }
  if (zone.contact) lines.push(`Kontakt: ${zone.contact}`);
  if (zone.infoUrl) lines.push(`Informationen: ${zone.infoUrl}`);
  if (zone.formUrl) lines.push(`Bedingungen/Antrag: ${zone.formUrl}`);
  if (zone.notamUrl) lines.push(`Luftraumsperren (Slovenia Control): ${zone.notamUrl}`);
  lines.push(sourceLineDe(`${SI_GEOZONE_SOURCE_LABEL} – Karte „UAS GEO ZONES“, Ebene „${layer.title}“`, SI_GEOZONE_ATTRIBUTION));
  return appendOriginalText(lines, zone.originalText, { always: true }).join("\n");
}

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

export type SiFeature = { type: "Feature"; id?: string; geometry: any; properties: Record<string, any> };

export type SiDropReason = "no_geometry" | "duplicate";

export interface SiNormalizeResult {
  features: SiFeature[];
  dropped: { layer: string; name: string; reason: SiDropReason }[];
}

function validCoords(c: unknown, depth: number): boolean {
  if (!Array.isArray(c)) return false;
  if (depth === 0) return c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
  return c.length > 0 && c.every((x) => validCoords(x, depth - 1));
}

/** Nur Flächen; Koordinaten unverändert (volle Präzision). */
export function siGeometry(geometry: any): { type: "Polygon" | "MultiPolygon"; coordinates: any } | null {
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "Polygon" && validCoords(geometry.coordinates, 2)) {
    const rings = (geometry.coordinates as unknown[][]).filter((r) => r.length >= 4);
    return rings.length ? { type: "Polygon", coordinates: rings } : null;
  }
  if (geometry.type === "MultiPolygon" && validCoords(geometry.coordinates, 3)) {
    const polys = (geometry.coordinates as unknown[][][])
      .map((p) => p.filter((r) => r.length >= 4))
      .filter((p) => p.length > 0);
    if (polys.length === 0) return null;
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }
  return null;
}

function objectId(raw: any): string | undefined {
  const p = raw?.properties ?? {};
  const v = p.OBJECTID ?? p.FID ?? raw?.id;
  return v == null ? undefined : String(v);
}

/** Einzelnes ArcGIS-GeoJSON-Feature eines Layers normalisieren; null ohne Fläche. */
export function normalizeSloveniaFeature(raw: any, layer: SiLayerDef): SiFeature | null {
  const geometry = siGeometry(raw?.geometry);
  if (!geometry) return null;
  const p: Record<string, any> = raw?.properties ?? {};
  const oid = objectId(raw);
  const zone = parseSiZone(p, layer);
  const decision = decideSiRestriction(zone.restrictionSl, zone.restrictionEn, layer);
  const name =
    translateSiZoneName(zone.nameOriginal || zone.nameEn, layer, zone.nameEn) ||
    `${KIND_DE[layer.kind]} ${oid ?? ""}`.trim();
  const identifier = `SI-${layer.key}-${oid ?? "?"}`;
  const message = buildSiMessageDe(zone, decision, layer);

  const props: Record<string, any> = {
    identifier,
    name,
    restriction: decision.restriction,
    lowerMeters: decision.lowerMeters ?? 0,
    lowerReference: "AGL",
    upperReference: "AGL",
    message,
    extendedProperties: localizedExtendedProperties(message, zone.originalText, "sl", { always: true }),
    country: "SVN",
    source: SI_GEOZONE_SOURCE_LABEL,
    nameOriginal: zone.nameOriginal || zone.nameEn || undefined,
    siLayer: layer.key,
    siLayerTitle: layer.title,
    siObjectId: oid,
    siRestrictionRaw: zone.restrictionSl || zone.restrictionEn || undefined,
    siRestrictionFromDefault: decision.fromDefault || undefined,
    infoUrl: zone.infoUrl ?? SI_UAS_MAP_URL,
    infoUrlLabel: zone.infoUrl ? "Weitere Informationen" : "UAS-Geozonenkarte CAA Slovenia",
  };
  if (zone.upperMeters != null && decision.lowerMeters == null) props.upperMeters = zone.upperMeters;
  if (zone.email) props.contactEmail = zone.email;
  if (zone.formUrl) {
    props.applicationUrl = zone.formUrl;
    props.applicationUrlLabel = "Bedingungen/Antrag";
  }
  if (zone.notamUrl) {
    props.notamsUrl = zone.notamUrl;
    props.notamsUrlLabel = "Luftraumsperren (Slovenia Control)";
  }
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];
  return { type: "Feature", id: identifier, geometry, properties: props };
}

/** Rohfeatures je Layer → Features + Verwerfungsstatistik (Dedupe je Layer über ID bzw. Geometrie). */
export function normalizeSloveniaLayersWithStats(byLayer: { layer: SiLayerDef; features: any[] }[]): SiNormalizeResult {
  const features: SiFeature[] = [];
  const dropped: SiNormalizeResult["dropped"] = [];
  const ids = new Map<string, number>();
  for (const { layer, features: raws } of byLayer) {
    const seenOid = new Set<string>();
    const seenGeom = new Set<string>();
    for (const raw of raws ?? []) {
      const p = raw?.properties ?? {};
      const label = firstField(p, layer.nameFields) || String(objectId(raw) ?? "?");
      const oid = objectId(raw);
      const gKey = JSON.stringify(raw?.geometry?.coordinates ?? null);
      if ((oid != null && seenOid.has(oid)) || (raw?.geometry && seenGeom.has(gKey))) {
        dropped.push({ layer: layer.key, name: label, reason: "duplicate" });
        continue;
      }
      const f = normalizeSloveniaFeature(raw, layer);
      if (!f) {
        dropped.push({ layer: layer.key, name: label, reason: "no_geometry" });
        continue;
      }
      if (oid != null) seenOid.add(oid);
      seenGeom.add(gKey);
      const id = String(f.properties.identifier);
      const n = (ids.get(id) ?? 0) + 1;
      ids.set(id, n);
      if (n > 1) {
        f.properties.identifier = `${id}#${n}`;
        f.id = `${id}#${n}`;
      }
      features.push(f);
    }
  }
  return { features, dropped };
}

export function normalizeSloveniaLayers(byLayer: { layer: SiLayerDef; features: any[] }[]): SiFeature[] {
  return normalizeSloveniaLayersWithStats(byLayer).features;
}

// ---------------------------------------------------------------------------
// ArcGIS-Abfrage (URL + Seitenauswertung)
// ---------------------------------------------------------------------------

/** Query-URL (GeoJSON, WGS84, alle Felder, volle Präzision, eine Seite). */
export function sloveniaQueryUrl(layer: SiLayerDef, offset = 0, count = 1000): string {
  return arcgisQueryUrl(siLayerUrl(layer), { offset, count });
}

/** Seite einer ArcGIS-`f=geojson`-Antwort lesen; ArcGIS-Fehlerobjekt (HTTP 200 + {error}) wird geworfen. */
export function sloveniaArcgisPage(body: any): { features: any[]; exceeded: boolean } {
  return arcgisPage(body);
}
