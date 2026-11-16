import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";

import {
  IT_GEOZONE_SOURCE_LABEL,
  decodeItalianDownload,
  italianZoneExpired,
  normalizeItalianZones,
} from "../../../shared/italianGeozones";
import { italyFeaturesFromBody } from "../geozoneDirect/italySource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Handgemachte, ED-269-konforme Fixture (KEIN echter d-flight-Abruf – der ist
// erst nach Login möglich, siehe docs/dflight-it-api-integration.md §5).
const raw = readFileSync(join(__dirname, "fixtures/dflight-it-ed269-sample.json"), "utf8");
const body = JSON.parse(raw);
const NOW = new Date("2026-11-15T12:00:00Z");
const byId = (features: any[], id: string) => features.find((f) => f.properties.zoneId === id);

describe("italianGeozones – Normalisierung", () => {
  const features = normalizeItalianZones(body, NOW);

  it("verwirft abgelaufene befristete Zonen und Zonen ohne Geometrie", () => {
    const ids = features.map((f) => f.properties.zoneId);
    assert.ok(!ids.some((id) => String(id).startsWith("EVENTO_2025")));
    assert.ok(!ids.some((id) => String(id).startsWith("SENZA_GEOMETRIA")));
    // CTR, Park, ATZ (2 Höhenbänder), Modellflug
    assert.equal(features.length, 5);
  });

  it("CTR: Höhen FT -> m, Bezüge, Quelle, italienischer Text bleibt", () => {
    const p = byId(features, "LIRF_CTR_01").properties;
    assert.equal(p.restriction, "REQ_AUTHORISATION");
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.upperMeters, 609.6);
    assert.equal(p.lowerReference, "AGL");
    assert.equal(p.upperReference, "AMSL");
    assert.equal(p.source, IT_GEOZONE_SOURCE_LABEL);
    assert.equal(IT_GEOZONE_SOURCE_LABEL, "d-flight (ENAV)");
    assert.match(p.message, /Operazioni consentite previa autorizzazione\.\nContattare ENAV\./);
    assert.match(p.message, /Kontakt: Ufficio UAS · \+39 06 44596 1 · uas@enac\.gov\.it/);
    assert.equal(p.contactEmail, "uas@enac.gov.it");
    assert.equal(p.name, "CTR ROMA - Settore 1");
    assert.ok(p.attribution);
  });

  it("Kreis -> Polygon, Untergrenze null -> 0", () => {
    const f = byId(features, "PARCO_GRAN_SASSO");
    assert.equal(f.geometry.type, "Polygon");
    assert.equal(f.properties.restriction, "PROHIBITED");
    assert.equal(f.properties.lowerMeters, 0);
    assert.equal(f.properties.upperMeters, 120);
    assert.equal(f.properties.reason, "Naturschutz");
  });

  it("unterschiedliche Höhenbänder werden getrennte Features", () => {
    const a = byId(features, "LIMC_ATZ#1");
    const b = byId(features, "LIMC_ATZ#2");
    assert.equal(a.properties.upperMeters, 30);
    assert.equal(b.properties.upperMeters, 60);
  });

  it("Modellflugfläche: NO_RESTRICTION, SFC, Zeitplan bleibt erhalten", () => {
    const p = byId(features, "CAMPO_VOLO_ULM").properties;
    assert.equal(p.restriction, "NO_RESTRICTION");
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.upperMeters, 121.9);
    const [z] = parseEd269ToGeozoneInfo([byId(features, "CAMPO_VOLO_ULM")], "it", NOW.getTime());
    assert.deepEqual(z.scheduleText, ["Sa, So · 08:00–18:00 UTC"]);
  });

  it("italianZoneExpired", () => {
    assert.equal(italianZoneExpired({ applicability: [{ permanent: "NO", endDateTime: "2025-01-01T00:00:00Z" }] }, NOW), true);
    assert.equal(italianZoneExpired({ applicability: [{ permanent: "YES", endDateTime: "2025-01-01T00:00:00Z" }] }, NOW), false);
    assert.equal(italianZoneExpired({ applicability: [] }, NOW), false);
    assert.equal(italianZoneExpired({}, NOW), false);
  });

  it("italyFeaturesFromBody: bbox + _country 'it'", () => {
    const out = italyFeaturesFromBody(body, NOW);
    assert.equal(out.length, 5);
    for (const f of out) {
      assert.equal(f.properties._country, "it");
      assert.ok(Array.isArray(f.bbox) && f.bbox.length === 4);
    }
    const ctr = out.find((f) => f.properties.zoneId === "LIRF_CTR_01")!;
    assert.deepEqual(ctr.bbox, [12.2, 41.75, 12.35, 41.85]);
  });

  it("akzeptiert nacktes Array und JSON-String", () => {
    assert.equal(normalizeItalianZones(body.features, NOW).length, 5);
    assert.equal(normalizeItalianZones(raw, NOW).length, 5);
  });
});

describe("italianGeozones – Download dekodieren", () => {
  it("reines JSON (mit BOM)", () => {
    const parsed: any = decodeItalianDownload(strToU8("﻿" + raw));
    assert.equal(parsed.features.length, body.features.length);
  });

  it("ZIP mit JSON-Datei", () => {
    const zip = zipSync({ "readme.txt": strToU8("x"), "uas_zones.json": strToU8(raw) });
    const parsed: any = decodeItalianDownload(zip);
    assert.equal(parsed.features.length, body.features.length);
  });

  it("kein JSON -> Fehler", () => {
    assert.throws(() => decodeItalianDownload(strToU8("<html>login</html>")), /kein JSON/);
  });
});
