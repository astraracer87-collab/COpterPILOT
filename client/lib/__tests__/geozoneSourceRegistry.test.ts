// B5: Quellen-Registry der Geozonen – Konsistenz, abgeleitete Länderlisten
// (gegen die früher hart kodierten Listen als Schnappschuss), hasOwnMap,
// Datenalter und „veraltet → CAUTION“.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  ACCESS_GATED_SOURCE_ISOS,
  ED269_STORE_REFRESH_MS,
  FULL_COUNTRY_VECTOR_ISOS,
  GEOZONE_SOURCE_META,
  NOTAM_LIST_SOURCE_ISOS,
  TILE_STORE_REFRESH_MS,
  getGeozoneSourceMeta,
  isEd269VectorIso,
  isSourceDataStale,
  resolveGeozoneSourceIso,
} from "../../../shared/geozoneSourceMeta";
import {
  GEOZONE_SOURCES,
  buildCountryGeozoneConfigs,
  ed269SourceLabels,
  getGeozoneSource,
  getSourceDataStatus,
} from "../geozoneSources/registry";
import { ED269_DIRECT_COUNTRIES, ED269_FETCHERS, isEd269DirectCountry } from "../geozoneDirect/ed269Sources";
import { ED269_SOURCE_LABELS } from "../ed269";
import { OWN_MAP_DATA_COUNTRIES, hasOwnMap, setCountryAccessAvailable } from "../../../shared/countryDetection";
import { GEOZONE_IMPORT_ONLY_ISOS } from "../../../shared/geozoneImport";
import { GEOZONE_TILE_MIN_ZOOM, GEOZONE_VECTOR_COUNTRY_MIN_ZOOM, getVectorMinZoom, loadsFullCountryVectorZones } from "../geozoneZoom";
import { TILE_STORE_ATTRIBUTION, TILE_STORE_ISOS, isTileStoreIso } from "../geozoneTiles/tileStoreCore";
import { GEOZONE_COUNTRY_WMS } from "../geozoneTileUrl";
import { getDataSourceGroups, geozoneCountries } from "../dataSources";
import { ed269IsNotamEligible } from "../../../shared/ed269Restriction";
import { __resetEd269StoreForTests, importEd269Dataset } from "../geozoneDirect/ed269Store";
import { queryEd269CachedFeaturesWithStatusFrom } from "../geozoneCoverage";
import { __setTileStoreEnvForTests, loadTileStoreMeta } from "../geozoneTiles/tileStore";
import { createNodeTileFs } from "./helpers/nodeTileFs";
import { aggregate, coverageChecks } from "../../../shared/checks";

const sorted = (xs: readonly string[]) => [...xs].sort();

// ---------------------------------------------------------------------------
// Schnappschuss der bis B4 hart kodierten Listen – nichts darf still wegfallen.
// ---------------------------------------------------------------------------
const OLD = {
  ED269_DIRECT_COUNTRIES: ["at", "be", "dk", "nl", "ee", "ch", "fi", "no", "ie", "lu", "se", "pt", "pl", "lt", "it", "gb", "is", "cy", "hr", "si", "bg", "lv", "sk", "ro", "mt"],
  ED269_SOURCE_LABELS: {
    AT: "Austro Control (ED-269)",
    BE: "skeyes / Droneguide (ED-269)",
    DK: "Trafikstyrelsen (Dänemark)",
    NL: "LVNL / GoDrone (Altitude Angel)",
    EE: "EANS / Transpordiamet (utm.eans.ee)",
    CH: "BAZL / swisstopo (geo.admin.ch)",
    LI: "BAZL / swisstopo (geo.admin.ch)",
    FI: "Traficom (ED-269)",
    NO: "Luftfartstilsynet / dronesoner.no",
    IE: "Irish Aviation Authority (ED-269)",
    LU: "DAC / Geoportail Luxembourg (CC0)",
    SE: "LFV / Transportstyrelsen (CC BY 4.0)",
    PT: "ANAC – DNT (ED-269)",
    PL: "PANSA DroneMap",
    LT: "Oro navigacija (ED-269)",
    IT: "d-flight (ENAV)",
    SK: "Dopravný úrad SR / LPS SR",
    LV: "LGS / AIS Latvia (ED-269)",
    BG: "ГД ГВА / CAA Bulgaria",
    SI: "CAA Slovenia",
    HR: "Croatia Control (AMC)",
    CY: "DCA Cyprus (AMC)",
    IS: "Samgöngustofa (ISAVIA)",
    GB: "UK AIP (CAA)",
    RO: "ROMATSA",
    MT: "Transport Malta / iDronect",
    GR: "HASP / DAGR (Datei-Import)",
  } as Record<string, string>,
  // PlanningRestrictionsScreen (VECTOR_ISOS, zweimal) – GR nur mit Import (RO und MT seit 2026-11 online)
  PLANNING_VECTOR_ISOS: ["MT", "AT", "BE", "DK", "NL", "EE", "CH", "LI", "FI", "NO", "SE", "IE", "LU", "PT", "PL", "LT", "IT", "GB", "IS", "CY", "HR", "SI", "BG", "LV", "SK", "RO"],
  OWN_MAP_DATA_COUNTRIES: ["DE", "FR", "CH", "LU", "NL", "AT", "BE", "DK", "EE", "FI", "NO", "IE", "SE", "PT", "ES", "PL", "LT", "IT", "GB", "IS", "CY", "HR", "SI", "BG", "LV", "CZ", "SK", "RO", "MT", "GR"],
  ACCESS_GATED_COUNTRIES: ["IT", "CZ", "GR"],
  GEOZONE_VECTOR_COUNTRY_MIN_ZOOM: { BE: 7, AT: 7, DE: 10, FR: 10, ES: 10, CZ: 10 } as Record<string, number>,
  GEOZONE_VECTOR_FULL_COUNTRY_ISOS: ["BE", "AT", "MT"],
  TILE_STORE_ISOS: ["DE", "FR", "ES", "CZ"],
  GEOZONE_IMPORT_ONLY_ISOS: ["GR"],
  // COUNTRY_GEOZONE_CONFIGS (geozones.ts): Schlüssel in Reihenfolge + featureInfoType
  COUNTRY_GEOZONE_CONFIGS: [
    ["DE", "wms-plain"], ["CH", "ed269-cached"], ["LU", "ed269-cached"], ["NL", "ed269-cached"], ["FR", "wms-fr"],
    ["HU", "none"], ["AT", "ed269-cached"], ["BE", "ed269-cached"], ["DK", "ed269-cached"], ["EE", "ed269-cached"],
    ["IE", "ed269-cached"], ["SE", "ed269-cached"], ["PT", "ed269-cached"], ["ES", "ed269-cached"], ["PL", "ed269-cached"],
    ["LT", "ed269-cached"], ["GB", "ed269-cached"], ["IT", "ed269-cached"], ["IS", "ed269-cached"], ["CY", "ed269-cached"],
    ["HR", "ed269-cached"], ["SI", "ed269-cached"], ["BG", "ed269-cached"], ["LV", "ed269-cached"], ["SK", "ed269-cached"],
    ["RO", "ed269-cached"], ["FI", "ed269-cached"], ["NO", "ed269-cached"], ["CZ", "tiles"],
    ["MT", "ed269-cached"], ["GR", "ed269-cached"],
  ],
  GEOZONE_COUNTRY_WMS: {
    DE: { baseUrl: "https://uas-betrieb.de/geoservices/dipul/wms", version: "1.1.1" },
    CH: { baseUrl: "https://wms.geo.admin.ch/", version: "1.3.0" },
    LU: { baseUrl: "https://wms.geoportail.lu/public_map_layers/service", version: "1.1.1" },
    NL: { baseUrl: "https://service.pdok.nl/lvnl/drone-no-flyzones/wms/v1_0", version: "1.3.0" },
    FR: { baseUrl: "https://data.geopf.fr/wms-r/wms", version: "1.3.0" },
  },
  // dataSources.geozoneCountries()
  GEOZONE_COUNTRIES: ["AT", "BE", "DK", "NL", "EE", "CH", "LI", "FI", "NO", "IE", "LU", "SE", "PT", "ES", "PL", "LT", "IT", "SK", "LV", "BG", "SI", "HR", "CY", "IS", "GB", "RO", "DE", "FR", "CZ", "HU", "MT", "GR"],
  // NotamsScreen: temporäre Gerätecache-Zonen als NOTAM
  NOTAM_LIST: ["BE", "AT", "DK"],
};

// Alle ISO-Codes der App plus Aliase/Unbekannte
const ALL_ISOS = "DE AT CH LU NL BE FR PL CZ DK IT ES SE PT IE GB GR FI HR BG RO HU SK SI LT LV EE CY MT NO IS LI XX".split(" ");

describe("Quellen-Registry: Konsistenz", () => {
  it("jede Quelle hat Ländername, Quellen-Label, Attribution, Anbieter, Lizenzangabe und https-Link", () => {
    assert.equal(GEOZONE_SOURCES.length, GEOZONE_SOURCE_META.length);
    const entries = getDataSourceGroups().find((g) => g.id === "geozones")!.entries;
    for (const s of GEOZONE_SOURCES) {
      assert.ok(s.labelDe.trim(), `${s.iso}: labelDe`);
      assert.ok(s.sourceLabel.trim(), `${s.iso}: sourceLabel`);
      assert.ok(s.attributions.length > 0 && s.attributions.every((a) => a.trim()), `${s.iso}: Attribution`);
      assert.ok(s.provider.trim(), `${s.iso}: Anbieter`);
      assert.ok(s.url && /^https:\/\//.test(s.url), `${s.iso}: url ${s.url}`);
      assert.equal(typeof s.writtenPermission, "boolean", `${s.iso}: writtenPermission`);
      const entry = entries.find((e) => e.countries?.includes(s.iso));
      assert.ok(entry?.license?.trim(), `${s.iso}: Lizenz in Datenquellen`);
      if (s.licenseUrl) assert.match(s.licenseUrl, /^https:\/\//);
    }
  });

  it("ISO-Codes eindeutig, Aliase zeigen auf genau eine Quelle (LI → CH)", () => {
    const isos = GEOZONE_SOURCES.map((s) => s.iso);
    assert.equal(new Set(isos).size, isos.length);
    const aliases = GEOZONE_SOURCES.flatMap((s) => s.aliases ?? []);
    assert.deepEqual(aliases, ["LI"]);
    for (const a of aliases) assert.ok(!isos.includes(a as any), `${a} ist Alias und eigene Quelle`);
    assert.equal(resolveGeozoneSourceIso("li"), "CH");
    assert.equal(getGeozoneSource("LI")?.iso, "CH");
    assert.equal(resolveGeozoneSourceIso("at"), "AT");
    assert.equal(getGeozoneSource("XX"), null);
  });

  it("jede Abruf-Funktion gehört zu einer Registry-Quelle mit Vektor-Feed und umgekehrt", () => {
    for (const iso of Object.keys(ED269_FETCHERS)) {
      const m = getGeozoneSourceMeta(iso);
      assert.ok(m && m.iso === iso, `${iso}: nicht in der Registry`);
      assert.ok(m.kind === "ed269-vector" || m.kind === "login", `${iso}: kind ${m.kind}`);
    }
    for (const s of GEOZONE_SOURCES) {
      const feed = s.kind === "ed269-vector" || s.kind === "login";
      assert.equal(typeof s.fetch === "function", feed, `${s.iso}: fetch`);
      assert.equal(!!s.bundled, !!s.bundledFallback, `${s.iso}: bundled`);
    }
  });

  it("Art und Strategie passen zusammen", () => {
    for (const s of GEOZONE_SOURCES) {
      if (s.kind === "tiled") assert.equal(s.offline, "tile-store", s.iso);
      if (s.kind === "ed269-vector" || s.kind === "login") assert.equal(s.offline, "ed269-store", s.iso);
      if (s.kind === "import-only") assert.equal(s.offline, "import", s.iso);
      if (s.kind === "xyz-raster") {
        // reines Bild (HU) ohne Bestand; GR zusätzlich mit Datei-Import (Stand = Import)
        if (s.offline === "import") assert.equal(s.accessGate, "import", s.iso);
        else assert.equal(s.refresh, null, s.iso);
        assert.ok(s.manualCheckOnly && s.manualCheckHint, s.iso);
      } else assert.ok(s.refresh, s.iso);
      if (s.kind === "login") assert.equal(s.accessGate, "login", s.iso);
      if (s.kind === "import-only") assert.equal(s.accessGate, "import", s.iso);
      if (s.offline === "tile-store") assert.ok(s.tileAttribution, s.iso);
    }
  });

  it("Aktualisierungs-Policy (Teil A): ED-269 online nach 6 h neu laden, dauerhafte Zonen Warnung nach 28 Tagen, temporäre 10 min / 24 h", () => {
    assert.equal(ED269_STORE_REFRESH_MS, 6 * 3_600_000);
    assert.equal(TILE_STORE_REFRESH_MS, 28 * 86_400_000);
    const temp = { temporaryMaxAgeMs: 10 * 60_000, temporaryStaleAfterMs: 24 * 3_600_000 };
    for (const s of GEOZONE_SOURCES) {
      if (s.offline === "tile-store") {
        assert.deepEqual(
          s.refresh,
          { maxAgeMs: TILE_STORE_REFRESH_MS, staleWarnAfterMs: TILE_STORE_REFRESH_MS, ...(s.iso === "DE" || s.iso === "ES" ? temp : {}) },
          s.iso,
        );
      }
      if (s.offline === "ed269-store") assert.deepEqual(s.refresh, { maxAgeMs: ED269_STORE_REFRESH_MS, staleWarnAfterMs: 28 * 86_400_000, ...temp }, s.iso);
      if (s.offline === "import") assert.deepEqual(s.refresh, { maxAgeMs: null, staleWarnAfterMs: TILE_STORE_REFRESH_MS }, s.iso);
    }
  });

  it("Frequentis-Platzhalter: AT und LT (EE geprüft: keine Platzhalter, eigener Normalisierer)", () => {
    assert.deepEqual(GEOZONE_SOURCES.filter((s) => s.frequentisPlaceholder).map((s) => s.iso), ["AT", "LT"]);
  });
});

describe("Quellen-Registry: abgeleitete Listen = frühere Listen", () => {
  it("ED269_DIRECT_COUNTRIES / isEd269DirectCountry", () => {
    assert.deepEqual(sorted(ED269_DIRECT_COUNTRIES), sorted(OLD.ED269_DIRECT_COUNTRIES));
    for (const iso of ALL_ISOS) {
      assert.equal(isEd269DirectCountry(iso), OLD.ED269_DIRECT_COUNTRIES.includes(iso.toLowerCase()), iso);
    }
  });

  it("ED269_SOURCE_LABELS (Schlüssel und Texte)", () => {
    assert.deepEqual(ED269_SOURCE_LABELS, ed269SourceLabels());
    assert.deepEqual(sorted(Object.keys(ED269_SOURCE_LABELS)), sorted(Object.keys(OLD.ED269_SOURCE_LABELS)));
    for (const [iso, label] of Object.entries(OLD.ED269_SOURCE_LABELS)) assert.equal(ED269_SOURCE_LABELS[iso], label, iso);
  });

  it("Höhenfilter-Vektorländer der Planung (GR nur mit Import)", () => {
    const own = (withImport: boolean) => (iso: string) => (iso === "GR" ? withImport : hasOwnMap(iso));
    for (const withImport of [false, true]) {
      const expected = [...OLD.PLANNING_VECTOR_ISOS, ...(withImport ? ["GR"] : [])];
      for (const iso of ALL_ISOS) assert.equal(isEd269VectorIso(iso, own(withImport)), expected.includes(iso), `${iso} (Import ${withImport})`);
      assert.equal(isEd269VectorIso(null, own(withImport)), false);
      assert.equal(isEd269VectorIso("li", own(withImport)), true);
    }
  });

  it("OWN_MAP_DATA_COUNTRIES, zugangsgebundene Länder, Nur-Import", () => {
    assert.deepEqual(sorted(OWN_MAP_DATA_COUNTRIES), sorted(OLD.OWN_MAP_DATA_COUNTRIES));
    assert.deepEqual(sorted(ACCESS_GATED_SOURCE_ISOS), sorted(OLD.ACCESS_GATED_COUNTRIES));
    assert.deepEqual(GEOZONE_IMPORT_ONLY_ISOS, OLD.GEOZONE_IMPORT_ONLY_ISOS);
  });

  it("hasOwnMap unverändert für alle Länder – mit und ohne Zugang", () => {
    const oldHasOwnMap = (iso: string, access: Set<string>) =>
      OLD.ACCESS_GATED_COUNTRIES.includes(iso) && !access.has(iso) ? false : OLD.OWN_MAP_DATA_COUNTRIES.includes(iso);
    const gated = OLD.ACCESS_GATED_COUNTRIES;
    try {
      for (const g of [...gated, "HU", "LI"]) setCountryAccessAvailable(g, false);
      for (const iso of ALL_ISOS) {
        assert.equal(hasOwnMap(iso), oldHasOwnMap(iso, new Set()), `${iso} ohne Zugang`);
        assert.equal(hasOwnMap(iso.toLowerCase()), oldHasOwnMap(iso, new Set()), `${iso} klein`);
      }
      for (const g of [...gated, "HU", "LI"]) setCountryAccessAvailable(g, true);
      for (const iso of ALL_ISOS) assert.equal(hasOwnMap(iso), oldHasOwnMap(iso, new Set(gated)), `${iso} mit Zugang`);
      assert.equal(hasOwnMap(null), false);
      assert.equal(hasOwnMap(""), false);
    } finally {
      for (const g of [...gated, "HU", "LI"]) setCountryAccessAvailable(g, false);
    }
  });

  it("Vektor-Mindestzoom und Vollland-Laden", () => {
    assert.deepEqual(GEOZONE_VECTOR_COUNTRY_MIN_ZOOM, OLD.GEOZONE_VECTOR_COUNTRY_MIN_ZOOM);
    assert.equal(getGeozoneSourceMeta("AT")?.vectorMinZoom, GEOZONE_TILE_MIN_ZOOM);
    assert.equal(getGeozoneSourceMeta("BE")?.vectorMinZoom, GEOZONE_TILE_MIN_ZOOM);
    assert.deepEqual(sorted(FULL_COUNTRY_VECTOR_ISOS), sorted(OLD.GEOZONE_VECTOR_FULL_COUNTRY_ISOS));
    for (const iso of ALL_ISOS) {
      assert.equal(getVectorMinZoom(iso), OLD.GEOZONE_VECTOR_COUNTRY_MIN_ZOOM[iso] ?? 9, iso);
      assert.equal(loadsFullCountryVectorZones(iso), OLD.GEOZONE_VECTOR_FULL_COUNTRY_ISOS.includes(iso), iso);
    }
  });

  it("Kachelspeicher-Länder (TileStoreIso)", () => {
    assert.deepEqual(TILE_STORE_ISOS, OLD.TILE_STORE_ISOS);
    for (const iso of ALL_ISOS) assert.equal(isTileStoreIso(iso), OLD.TILE_STORE_ISOS.includes(iso), iso);
    for (const iso of TILE_STORE_ISOS) assert.equal(getGeozoneSource(iso)?.tileAttribution, TILE_STORE_ATTRIBUTION[iso]);
  });

  it("COUNTRY_GEOZONE_CONFIGS: Länder, Reihenfolge, featureInfoType; WMS-Konfiguration aus der Registry", () => {
    const configs = buildCountryGeozoneConfigs();
    assert.deepEqual(Object.entries(configs).map(([k, c]) => [k, c.featureInfoType]), OLD.COUNTRY_GEOZONE_CONFIGS);
    for (const [iso, c] of Object.entries(configs)) {
      assert.equal(c.iso, iso);
      const src = getGeozoneSource(iso)!;
      if (src.wms) assert.equal(c, src.wms, `${iso}: WMS-Konfiguration nicht referenziert`);
      else assert.deepEqual([c.wmsBaseUrl, c.layers.length], ["", 0], iso);
    }
    assert.deepEqual(GEOZONE_COUNTRY_WMS, OLD.GEOZONE_COUNTRY_WMS);
  });

  it("Datenquellen-Länder und NOTAM-Liste", () => {
    assert.deepEqual(sorted(geozoneCountries()), sorted(OLD.GEOZONE_COUNTRIES));
    assert.deepEqual(NOTAM_LIST_SOURCE_ISOS, OLD.NOTAM_LIST);
  });

  it("NOTAM-Eignung nach Quellen-Flags unverändert (AT applicability, BE live)", () => {
    const timed = { applicability: [{ permanent: "NO", startDateTime: "2026-11-01T00:00:00Z", endDateTime: "2026-11-02T00:00:00Z" }] };
    assert.equal(ed269IsNotamEligible(timed, "AT"), true);
    assert.equal(ed269IsNotamEligible(timed, "at"), true);
    for (const iso of ["LT", "EE", "BE", "DK", "CH"]) assert.equal(ed269IsNotamEligible(timed, iso), false, iso);
    const live = { _live: true };
    assert.equal(ed269IsNotamEligible(live, "BE"), true);
    assert.equal(ed269IsNotamEligible({ _live: true, permanent: true }, "BE"), false);
    assert.equal(ed269IsNotamEligible(live, "AT"), false);
  });
});

// ---------------------------------------------------------------------------
// Datenalter
// ---------------------------------------------------------------------------

const RO_FEATURE = {
  type: "Feature" as const,
  geometry: { type: "Polygon", coordinates: [[[26.0, 44.4], [26.2, 44.4], [26.2, 44.5], [26.0, 44.4]]] },
  properties: { restriction: "PROHIBITED", name: "Bukarest-Zone" },
};

describe("getSourceDataStatus / veraltet → CAUTION", () => {
  let dir = "";
  beforeEach(() => {
    __resetEd269StoreForTests();
    dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "registry-"));
    __setTileStoreEnvForTests({ fs: createNodeTileFs(dir), isOffline: () => true, isWifi: async () => false });
  });
  afterEach(() => {
    __resetEd269StoreForTests();
    __setTileStoreEnvForTests(null);
    nodeFs.rmSync(dir, { recursive: true, force: true });
    setCountryAccessAvailable("MT", false);
  });

  it("ohne gespeicherten Bestand bzw. ohne Speicher: kein Stand", () => {
    assert.deepEqual(getSourceDataStatus("AT"), { fetchedAt: null, ageMs: null, stale: false, kind: "ed269-vector" });
    assert.deepEqual(getSourceDataStatus("HU"), { fetchedAt: null, ageMs: null, stale: false, kind: "xyz-raster" });
    assert.deepEqual(getSourceDataStatus("XX"), { fetchedAt: null, ageMs: null, stale: false, kind: null });
    assert.equal(isSourceDataStale("HU", 0), false);
  });

  it("Datei-Import (MT, Rückfall im Online-Land): Stand = Importzeit; nach 28 Tagen veraltet → Abdeckung stale → CAUTION", async () => {
    const now = Date.now();
    const importedAt = now - 2 * 3_600_000;
    await importEd269Dataset("MT", [JSON.parse(JSON.stringify(RO_FEATURE))], { source: "test", importedAt, fileName: "mt.json" });
    const fresh = getSourceDataStatus("MT", now);
    assert.equal(fresh.fetchedAt, importedAt);
    assert.equal(fresh.ageMs, 2 * 3_600_000);
    assert.equal(fresh.stale, false);
    assert.equal(fresh.kind, "ed269-vector");
    assert.equal(fresh.imported, true);
    const r1 = await queryEd269CachedFeaturesWithStatusFrom("", 44.45, 26.1, 10, "MT");
    assert.equal(r1.status, "ok");
    assert.equal(r1.fetchedAt, importedAt);
    const info = coverageChecks({ context: "planning", sources: [{ iso: "MT", status: r1.status, fetchedAt: r1.fetchedAt }], now });
    assert.deepEqual(info.map((c) => [c.id, c.severity]), [["coverage:MT:age", "info"]]);
    assert.match(info[0].title, /Stand: vor 2 h/);
    assert.equal(aggregate(info).verdict, "go");

    // 30 h alt: für einen Import noch aktuell (Warnschwelle 28 Tage)
    await importEd269Dataset("MT", [JSON.parse(JSON.stringify(RO_FEATURE))], { source: "test", importedAt: now - 30 * 3_600_000, fileName: "mt.json" });
    assert.equal(getSourceDataStatus("MT", now).stale, false);

    const oldAt = now - 30 * 24 * 3_600_000;
    await importEd269Dataset("MT", [JSON.parse(JSON.stringify(RO_FEATURE))], { source: "test", importedAt: oldAt, fileName: "mt.json" });
    assert.equal(getSourceDataStatus("MT", now).stale, true);
    const r2 = await queryEd269CachedFeaturesWithStatusFrom("", 44.45, 26.1, 10, "MT");
    assert.equal(r2.status, "stale");
    const caution = coverageChecks({ context: "precheck", sources: [{ iso: "MT", status: r2.status, fetchedAt: r2.fetchedAt }], now });
    assert.deepEqual(caution.map((c) => [c.id, c.severity]), [["coverage:MT:stale", "caution"]]);
    assert.equal(caution[0].dataAge?.stale, true);
    // MT ist seit 2026-11 ein Online-Land (DDP) – Hinweis „online aktualisieren“ statt „neu importieren“
    assert.match(caution[0].title, /online aktualisieren/);
    assert.equal(aggregate(caution).verdict, "caution");
  });

  it("Kachelspeicher: Stand = createdAt des Pakets; älter als 28 Tage → stale", async () => {
    const now = Date.now();
    const writeMeta = (iso: string, createdAt: number) => {
      const d = path.join(dir, iso.toLowerCase(), "base");
      nodeFs.mkdirSync(d, { recursive: true });
      nodeFs.writeFileSync(path.join(d, "meta.json"), JSON.stringify({ iso, part: "base", complete: true, createdAt, count: 1, dataBytes: 1, rawBytes: 1 }));
    };
    writeMeta("DE", now - 3 * 86_400_000);
    writeMeta("CZ", now - 29 * 86_400_000);
    await loadTileStoreMeta(true);
    const de = getSourceDataStatus("DE", now);
    // Teil A: temporäre DE-Zonen haben einen eigenen Stand – hier nie geladen → nicht aktuell
    assert.deepEqual(de, {
      fetchedAt: now - 3 * 86_400_000, ageMs: 3 * 86_400_000, stale: false, kind: "tiled",
      temporaryFetchedAt: null, temporaryStale: true,
    });
    const cz = getSourceDataStatus("CZ", now);
    assert.equal(cz.stale, true);
    assert.equal(getSourceDataStatus("FR", now).fetchedAt, null);
  });
});
