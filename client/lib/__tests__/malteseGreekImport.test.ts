// Malta (Nur-Import, manueller iDronect-Export) und Griechenland (Bild-Overlay
// + optionaler Import aus dagr_geozonen.py). Malta mit dem ECHTEN Ausschnitt
// fixtures/mt_zones_sample.geojson (Browser-Export, DE-Session 2026-11-15).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parseGeozoneImport, GEOZONE_IMPORT_ONLY_ISOS } from "../../../shared/geozoneImport";
import { maltaImportVariant, normalizeMalteseImport, splitMaltaName } from "../../../shared/malteseGeozones";
import { isDagrImportFeature, normalizeGreekDagrImport, parseDagrDate } from "../../../shared/greekGeozones";
import {
  GR_GEOZONE_TILE_URL,
  fillGeozoneDatePlaceholders,
} from "../../../shared/geozoneLayerCatalog";
import { buildGeozoneWmsTileTemplates } from "../geozoneTileUrl";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { getGeozoneSourceMeta, isEd269VectorIso } from "../../../shared/geozoneSourceMeta";
import { getGeozoneSource, buildCountryGeozoneConfigs } from "../geozoneSources/registry";
import { hasOwnMap, setCountryAccessAvailable } from "../../../shared/countryDetection";
import {
  __resetEd269StoreForTests,
  canImportEd269Dataset,
  deleteEd269Dataset,
  getEd269Dataset,
  importEd269Dataset,
  refreshEd269Dataset,
} from "../geozoneDirect/ed269Store";
import { queryEd269CachedFeaturesFrom } from "../geozoneCoverage";
import type { GeoFeature } from "../geozoneDirect/ed269Sources";

const FIX = path.join(__dirname, "fixtures");
const mtRaw = JSON.parse(fs.readFileSync(path.join(FIX, "mt_zones_sample.geojson"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");

// Ausgabe von normalisieren.py (gleiche Zonen, deutsches Schema)
const mtNormalized = {
  type: "FeatureCollection",
  features: mtRaw.features.map((f: any) => ({
    type: "Feature",
    geometry: f.geometry,
    properties: {
      land: "MT",
      zone_id: f.properties.zoneId,
      name: f.properties.name,
      typ_code: f.properties.type,
      verboten: !!f.properties.forbidden,
      min_hoehe: f.properties.minHeight,
      max_hoehe: f.properties.maxHeight,
      max_piloten: f.properties.maxPilots,
      kosten: f.properties.cost,
      kreis_radius_m: f.properties.radius,
      archiviert: false,
      quelle: "Transport Malta / Idronect (tmcad.idronect.com)",
      stand: "2026-11-15",
    },
  })),
};

// Ausgabe von dagr_geozonen.py (Schema laut Skript; Werte konstruiert, die
// Datei kann aus dieser Umgebung nicht erzeugt werden – Bot-Schutz).
const square = (x: number, y: number) => ({ type: "Polygon", coordinates: [[[x, y], [x + 0.05, y], [x + 0.05, y + 0.05], [x, y + 0.05], [x, y]]] });
const grDagr = {
  type: "FeatureCollection",
  meta: { source: "https://dagr.hasp.gov.gr (HASP/HCAA)", window: ["2026-11-15 00:00", "2026-12-15 24:00"] },
  features: [
    {
      type: "Feature",
      geometry: square(23.7, 37.9),
      properties: {
        layer: "all_limitation_layer", reg_no: "r1234", name: "Akropolis", authority: "HCAA",
        valid_from: "01/01/2026 00:00", valid_to: "31/12/2099 23:59",
        alt_agl_from_ft: "0", alt_agl_to_ft: "400", alt_msl_from_ft: "", alt_msl_to_ft: "",
      },
    },
    {
      type: "Feature",
      geometry: square(22.9, 40.5),
      properties: { layer: "hellas_CTR", reg_no: "r55", name: "CTR Thessaloniki", authority: "HASP", valid_from: "", valid_to: "", alt_agl_from_ft: "", alt_agl_to_ft: "", alt_msl_from_ft: "0", alt_msl_to_ft: "2500" },
    },
    { type: "Feature", geometry: square(24, 38), properties: { layer: "all_warning_layer", candidates: ["r9 Übung", "r10 Feuerwerk"] } },
    { type: "Feature", geometry: square(25, 39), properties: { layer: "all_permifrag_layer", reg_no: "r7", name: "Abgelaufen", valid_to: "01/01/2025 00:00" } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[23, 38], [24, 39]] }, properties: { layer: "hellas_CTR", reg_no: "r8" } },
  ],
};

describe("Malta – Import des Browser-Exports (echte Fixture)", () => {
  it("Formaterkennung Roh-Export und normalisierte Datei", () => {
    assert.equal(maltaImportVariant(mtRaw.features[0].properties), "raw");
    assert.equal(maltaImportVariant(mtNormalized.features[0].properties), "normalized");
    assert.equal(parseGeozoneImport(mtRaw, { iso: "MT", now: NOW }).format, "mt-tmcad");
    assert.equal(parseGeozoneImport(mtNormalized, { iso: "MT", now: NOW }).format, "mt-tmcad");
  });

  it("Name und Kontakt trennen", () => {
    assert.deepEqual(splitMaltaName("Victoria Health Centre  Contact carmen.ogilvie-galea@gov.mt"), {
      name: "Victoria Health Centre",
      contact: "carmen.ogilvie-galea@gov.mt",
      email: "carmen.ogilvie-galea@gov.mt",
    });
    assert.equal(splitMaltaName("Sir Paul Boffa Hospital - Please contact: joseph.c.chetcuti@gov.mt").name, "Sir Paul Boffa Hospital");
  });

  it("forbidden → Flugverbot, Höhe mit unbekannter Einheit/Bezug (vorsichtig), deutsche Meldung", () => {
    const [a, b] = normalizeMalteseImport(mtRaw.features);
    assert.equal(a.properties.name, "Victoria Health Centre");
    assert.equal(a.properties.restriction, "PROHIBITED");
    assert.equal(a.properties.zoneId, "MT-BNtjEqFyvU2BOxsUGtXrBksm");
    assert.equal(a.properties.lowerMeters, 0);
    assert.equal(a.properties.upperMeters, 60); // Obergrenze vorsichtig als m
    assert.equal(a.properties.upperReference, undefined); // Bezug unbekannt
    assert.equal(a.properties.altitudeText, "GND – 60 (Einheit unbekannt)");
    assert.equal(a.properties.contactEmail, "carmen.ogilvie-galea@gov.mt");
    assert.match(a.properties.message, /^Malta-Geozone \(Transport Malta \/ iDronect\) · Typ-Code 1\nFlugverbot für Drohnen/);
    assert.match(a.properties.message, /Höhe laut Quelle: GND bis 60 – Einheit und Bezug nicht angegeben \(vermutlich ft\)\./);
    assert.match(a.properties.message, /Kreiszone mit Radius ca\. 98 m\./);
    assert.match(a.properties.message, /Originaltext der Behörde:\nVictoria Health Centre {2}Contact/);
    assert.equal(b.properties.name, "Sir Paul Boffa Hospital");
    const infos = parseEd269ToGeozoneInfo(normalizeMalteseImport(mtRaw.features) as any[], "MT");
    assert.equal(infos.length, 2);
    assert.equal(infos[0].restriction, "PROHIBITED");
    assert.equal(infos[0].upper?.ref, "UNKNOWN");
  });

  it("nicht verboten → Genehmigung; Untergrenze vorsichtig als ft; archivierte entfallen", () => {
    const f = JSON.parse(JSON.stringify(mtRaw.features[0]));
    f.properties.forbidden = 0;
    f.properties.minHeight = 100;
    f.properties.zoneId = "X1";
    const g = JSON.parse(JSON.stringify(mtRaw.features[1]));
    g.properties.archived = true;
    const out = normalizeMalteseImport([f, g]);
    assert.equal(out.length, 1);
    assert.equal(out[0].properties.restriction, "REQ_AUTHORISATION");
    assert.equal(out[0].properties.lowerMeters, 30.5);
    assert.equal(out[0].properties.lowerReference, undefined);
  });

  it("normalisierte Datei liefert dieselben Zonen", () => {
    const a = parseGeozoneImport(mtRaw, { iso: "MT", now: NOW }).features.map((f) => [f.properties.zoneId, f.properties.restriction, f.properties.upperMeters]);
    const b = parseGeozoneImport(mtNormalized, { iso: "MT", now: NOW }).features.map((f) => [f.properties.zoneId, f.properties.restriction, f.properties.upperMeters]);
    assert.deepEqual(a, b);
    assert.throws(() => parseGeozoneImport(mtRaw, { iso: "GR", now: NOW }), /für Malta/);
  });
});

describe("Griechenland – Bild-Overlay + Import aus dagr_geozonen.py", () => {
  it("WMS-Vorlage mit Zeitfenster heute..morgen", () => {
    assert.match(GR_GEOZONE_TILE_URL, /mapserv\.exe\?map=C:\/ms4w_3\.1\.4\/MAPFILES\/dagr_TILED\.map&SERVICE=WMS&VERSION=1\.3\.0&REQUEST=GetMap/);
    assert.match(GR_GEOZONE_TILE_URL, /LAYERS=all_limitation_layer,all_warning_layer,all_permifrag_layer,hellas_CTR/);
    const filled = fillGeozoneDatePlaceholders(GR_GEOZONE_TILE_URL, new Date(2026, 10, 15, 9, 30));
    assert.match(filled, /WMS_DATE_FROM=2026-11-15%2000%3A00&WMS_DATE_TO=2026-11-16%2024%3A00&BBOX=\{bbox\}$/);
    assert.equal(fillGeozoneDatePlaceholders("https://x/{z}/{x}/{y}.png"), "https://x/{z}/{x}/{y}.png");
    const [tpl] = buildGeozoneWmsTileTemplates(["DAGR"], "GR");
    assert.ok(tpl && !tpl.includes("{wmsDate") && tpl.includes("{bbox}"));
  });

  it("Registry: Bild-Overlay, manuelle Prüfung, Import-Gate", () => {
    const m = getGeozoneSourceMeta("GR")!;
    assert.equal(m.kind, "xyz-raster");
    assert.equal(m.manualCheckOnly, true);
    assert.equal(m.accessGate, "import");
    assert.match(getGeozoneSource("GR")!.manualCheckHint!, /^Für Griechenland zeigt die Karte die Zonen nur als Bild \(HASP\/DAGR\)/);
    assert.equal(buildCountryGeozoneConfigs().GR.featureInfoType, "ed269-cached");
    assert.deepEqual(GEOZONE_IMPORT_ONLY_ISOS, ["MT", "GR"]);
  });

  it("Datum und Erkennung", () => {
    assert.equal(parseDagrDate("15/11/2026 08:30"), Date.UTC(2026, 10, 15, 8, 30));
    assert.equal(parseDagrDate("2026-11-15 24:00"), Date.UTC(2026, 10, 16, 0, 0));
    assert.equal(parseDagrDate(""), null);
    assert.equal(isDagrImportFeature(grDagr.features[0].properties), true);
    assert.equal(isDagrImportFeature({ layer: "foo" }), false);
  });

  it("Ebene → Beschränkung, ft-Höhen (AGL bevorzugt), Gültigkeit, Linien und Abgelaufenes entfallen", () => {
    const out = normalizeGreekDagrImport(grDagr.features, NOW);
    assert.deepEqual(out.map((f) => [f.properties.zoneId, f.properties.restriction]), [
      ["GR-r1234", "RESTRICTED"],
      ["GR-r55", "REQ_AUTHORISATION"],
      ["GR-all_warning_layer-3", "CONDITIONAL"],
    ]);
    const a = out[0].properties;
    assert.equal(a.upperMeters, 121.9);
    assert.equal(a.upperReference, "AGL");
    assert.equal(a.applicability[0].endDateTime, "2099-12-31T23:59:00.000Z");
    assert.match(a.message, /^DAGR-Zone r1234 · Einschränkungsgebiet \(Limitation\)/);
    assert.match(a.message, /Zuständig: HCAA/);
    assert.equal(out[1].properties.upperReference, "MSL");
    assert.match(out[2].properties.message, /nicht eindeutig zugeordnet/);
    assert.equal(parseGeozoneImport(grDagr, { iso: "GR", now: NOW }).format, "gr-dagr");
  });
});

describe("MT/GR – Gerätecache & Freischaltung (wie früher RO)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    __resetEd269StoreForTests();
    setCountryAccessAvailable("MT", false);
    setCountryAccessAvailable("GR", false);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    setCountryAccessAvailable("MT", false);
    setCountryAccessAvailable("GR", false);
  });

  for (const iso of ["MT", "GR"]) {
    it(`${iso}: ohne Import keine eigene Karte und kein Netzabruf; Import schaltet frei, Entfernen sperrt`, async () => {
      let fetched = false;
      globalThis.fetch = (async () => {
        fetched = true;
        throw new Error("kein Netz");
      }) as typeof fetch;
      assert.equal(hasOwnMap(iso), false);
      assert.equal(isEd269VectorIso(iso, hasOwnMap), false);
      assert.equal(canImportEd269Dataset(iso), true);
      assert.equal(await refreshEd269Dataset(iso), false);
      assert.equal(fetched, false);

      const parsed = iso === "MT" ? parseGeozoneImport(mtRaw, { iso, now: NOW }) : parseGeozoneImport(grDagr, { iso, now: NOW });
      await importEd269Dataset(iso, parsed.features as unknown as GeoFeature[], { source: parsed.format, importedAt: NOW.getTime(), fileName: "x.geojson" });
      assert.equal(hasOwnMap(iso), true);
      assert.equal(isEd269VectorIso(iso, hasOwnMap), true);
      const [lat, lon] = iso === "MT" ? [36.042, 14.2404] : [37.92, 23.72];
      const zones = await queryEd269CachedFeaturesFrom("", lat, lon, 1, iso);
      assert.ok(zones.length > 0 && zones[0].restriction != null);
      await deleteEd269Dataset(iso);
      assert.equal(hasOwnMap(iso), false);
      assert.equal(await getEd269Dataset(iso), null);
    });
  }
});
