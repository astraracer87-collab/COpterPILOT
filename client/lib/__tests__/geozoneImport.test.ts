import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

import {
  GEOZONE_IMPORT_ONLY_ISOS,
  decodeGeozoneImportBytes,
  detectGeozoneImportFormat,
  genericRestriction,
  parseGeozoneImport,
  parseGeozoneImportBytes,
} from "../../../shared/geozoneImport";
import { hasOwnMap, setCountryAccessAvailable } from "../../../shared/countryDetection";
import {
  __resetEd269StoreForTests,
  canImportEd269Dataset,
  deleteEd269Dataset,
  getEd269Dataset,
  getEd269DatasetStatus,
  importEd269Dataset,
  initEd269ImportFlags,
  refreshEd269Dataset,
} from "../geozoneDirect/ed269Store";
import { queryEd269CachedFeaturesFrom } from "../geozoneCoverage";
import type { GeoFeature } from "../geozoneDirect/ed269Sources";

const FIX = path.join(__dirname, "fixtures");
const NOW = new Date("2026-11-15T12:00:00Z");
const lvEd269 = JSON.parse(fs.readFileSync(path.join(FIX, "drz-lv-ed269-sample.json"), "utf8"));
const seEd318 = JSON.parse(fs.readFileSync(path.join(FIX, "se-ed318-sample.json"), "utf8"));

// Einfache GeoJSON-Datei, wie sie ein Behörden-Export (z. B. ROMATSA) liefern
// könnte. ⚠️ Das echte Format von Restricted_zones_for_UAS.json ist unbekannt
// (Server für Android/Sandbox nicht erreichbar) – generische Zuordnung.
const roGeojson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: 7,
      properties: { NAME: "LRR01 Cotroceni", TYPE: "Prohibited", LOWER_LIM: "GND", UPPER_LIM: "1500FT AMSL", REMARKS: "Zonă interzisă" },
      geometry: { type: "Polygon", coordinates: [[[26.06, 44.43], [26.08, 44.43], [26.08, 44.45], [26.06, 44.43]]] },
    },
    {
      type: "Feature",
      properties: { nume: "CTR Otopeni", tip: "Restricție – necesită autorizare", lower: 0, upper: 120, uom: "m" },
      geometry: { type: "MultiPolygon", coordinates: [[[[26.0, 44.5], [26.2, 44.5], [26.2, 44.6], [26.0, 44.5]]]] },
    },
    {
      type: "Feature",
      properties: { name: "Ohne Typ", upper: "400 ft AGL" },
      geometry: { type: "Point", coordinates: [26.1, 44.4], radius: 500 },
    },
    {
      type: "Feature",
      properties: { name: "Abgelaufen", type: "PROHIBITED", validTo: "2025-01-01T00:00:00Z" },
      geometry: { type: "Polygon", coordinates: [[[26.3, 44.4], [26.4, 44.4], [26.4, 44.5], [26.3, 44.4]]] },
    },
    { type: "Feature", properties: { name: "Linie" }, geometry: { type: "LineString", coordinates: [[26, 44], [27, 45]] } },
  ],
};

describe("Geozonen-Import – Formaterkennung & Parsing", () => {
  it("erkennt ED-269, ED-318 und GeoJSON", () => {
    assert.equal(detectGeozoneImportFormat(lvEd269), "ed269");
    assert.equal(detectGeozoneImportFormat(seEd318), "ed318");
    assert.equal(detectGeozoneImportFormat(roGeojson), "geojson");
    assert.equal(detectGeozoneImportFormat({ foo: 1 }), null);
  });

  it("ED-269 (drz.lv-Fixture) → App-Features", () => {
    const r = parseGeozoneImport(lvEd269, { iso: "RO", source: "Test", now: NOW });
    assert.equal(r.format, "ed269");
    assert.ok(r.features.length > 0);
    assert.ok(r.features.every((f) => typeof f.properties.restriction === "string" && f.properties.source === "Test"));
  });

  it("ED-318 als ZIP (SE-Fixture) → erste .json im ZIP", () => {
    const zip = zipSync({ "doc/readme.txt": strToU8("x"), "zones/ed318.json": strToU8(`﻿${JSON.stringify(seEd318)}`) });
    const r = parseGeozoneImportBytes(zip, { iso: "RO", now: NOW });
    assert.equal(r.format, "ed318");
    assert.equal(r.innerName, "zones/ed318.json");
    const f = r.features.find((x) => x.properties.identifier === "ESU200")!;
    assert.equal(f.properties.zoneId, "RO-ESU200");
    assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
    assert.throws(() => decodeGeozoneImportBytes(zipSync({ "a.txt": strToU8("x") })), /keine \.json/);
  });

  it("GeoJSON generisch: Typ-/Höhenfelder, vorsichtiger Default, Ablauf, Kreise", () => {
    const r = parseGeozoneImport(JSON.stringify(roGeojson), { iso: "RO", source: "ROMATSA", now: NOW });
    assert.equal(r.format, "geojson");
    const byName = Object.fromEntries(r.features.map((f) => [f.properties.name, f.properties]));
    assert.deepEqual(Object.keys(byName).sort(), ["CTR Otopeni", "LRR01 Cotroceni", "Ohne Typ"]);
    assert.equal(byName["LRR01 Cotroceni"].restriction, "PROHIBITED");
    assert.equal(byName["LRR01 Cotroceni"].upperMeters, 457.2);
    assert.equal(byName["LRR01 Cotroceni"].upperReference, "MSL");
    assert.equal(byName["LRR01 Cotroceni"].zoneId, "RO-7");
    assert.match(byName["LRR01 Cotroceni"].message, /Zonă interzisă/); // Original bleibt
    assert.equal(byName["CTR Otopeni"].restriction, "REQ_AUTHORISATION");
    assert.equal(byName["CTR Otopeni"].upperMeters, 120);
    assert.equal(byName["Ohne Typ"].restriction, "REQ_AUTHORISATION");
    assert.equal(byName["Ohne Typ"].restrictionAssumed, true);
    assert.equal(byName["Ohne Typ"].upperMeters, 121.9);
  });

  it("Stichwörter → Beschränkung", () => {
    assert.equal(genericRestriction("Zonă interzisă"), "PROHIBITED");
    assert.equal(genericRestriction("REQ_AUTHORIZATION"), "REQ_AUTHORISATION");
    assert.equal(genericRestriction("Conditional"), "CONDITIONAL");
    assert.equal(genericRestriction("xyz"), null);
  });

  it("ungültige Dateien → deutsche Fehlermeldung", () => {
    assert.throws(() => parseGeozoneImport("nicht json", { iso: "RO" }), /kein gültiges JSON/);
    assert.throws(() => parseGeozoneImport({ type: "FeatureCollection", features: [] }, { iso: "RO" }), /Unbekanntes Format/);
  });
});

describe("Geozonen-Import – Gerätecache & RO-Freischaltung", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    __resetEd269StoreForTests();
    setCountryAccessAvailable("RO", false);
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("RO ist Nur-Import-Land: ohne Import keine eigene Karte, kein Netzabruf", async () => {
    assert.deepEqual(GEOZONE_IMPORT_ONLY_ISOS, ["RO"]);
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error("kein Netz");
    }) as typeof fetch;
    assert.equal(hasOwnMap("RO"), false);
    assert.equal(canImportEd269Dataset("RO"), true);
    assert.equal(await getEd269Dataset("RO", { forceRefresh: true }), null);
    assert.equal(await refreshEd269Dataset("RO"), false);
    assert.equal(fetched, false);
    await initEd269ImportFlags();
    assert.equal(hasOwnMap("RO"), false);
  });

  it("Import → Karte/Zonencheck nutzen den Bestand; Entfernen sperrt wieder", async () => {
    const { features } = parseGeozoneImport(roGeojson, { iso: "RO", source: "ROMATSA (Datei-Import)", now: NOW });
    const ds = await importEd269Dataset("RO", features as unknown as GeoFeature[], {
      source: "GeoJSON",
      importedAt: NOW.getTime(),
      fileName: "Restricted_zones_for_UAS.json",
    });
    assert.equal(ds.iso, "ro");
    assert.ok(ds.features.every((f) => f.properties._country === "ro" && Array.isArray(f.bbox)));
    assert.equal(hasOwnMap("RO"), true);
    assert.deepEqual(getEd269DatasetStatus("RO").imported, {
      source: "GeoJSON",
      importedAt: NOW.getTime(),
      fileName: "Restricted_zones_for_UAS.json",
    });
    const zones = await queryEd269CachedFeaturesFrom("", 44.44, 26.07, 2, "RO");
    assert.ok(zones.some((z) => z.name === "LRR01 Cotroceni" && z.restriction === "PROHIBITED"));
    await deleteEd269Dataset("RO");
    assert.equal(hasOwnMap("RO"), false);
    assert.equal(await getEd269Dataset("RO"), null);
  });

  it("Import in einem Online-Land: Fehlschlag lässt ihn stehen, Erfolg ersetzt ihn", async () => {
    const { features } = parseGeozoneImport(roGeojson, { iso: "LV", now: NOW });
    await importEd269Dataset("LV", features as unknown as GeoFeature[], { source: "GeoJSON", importedAt: Date.now(), fileName: "x.json" });
    globalThis.fetch = (async () => ({ ok: false, status: 503, text: async () => "" })) as any;
    assert.equal(await refreshEd269Dataset("LV"), false);
    assert.equal(getEd269DatasetStatus("LV").imported?.fileName, "x.json");
    globalThis.fetch = (async () => ({ ok: true, status: 200, text: async () => JSON.stringify(lvEd269) })) as any;
    assert.equal(await refreshEd269Dataset("LV"), true);
    assert.equal(getEd269DatasetStatus("LV").imported, undefined);
    assert.ok(getEd269DatasetStatus("LV").count > 0);
  });

  it("Länder ohne Vektor-Cache (z. B. DE) lehnen den Import ab", async () => {
    assert.equal(canImportEd269Dataset("DE"), false);
    await assert.rejects(importEd269Dataset("DE", [], { source: "x", importedAt: 0, fileName: "x" }), /kein Geozonen-Import/);
  });
});
