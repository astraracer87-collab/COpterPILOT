import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  norwayEd269UrlFromHtml,
  norwayFallbackUrls,
  norwegianRestriction,
  NO_GEOZONE_SOURCE_LABEL,
} from "../../../shared/norwegianGeozones";
import { norwayFeaturesFromBody } from "../geozoneDirect/norwaySource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Gekürzter echter dronesoner.no-Abruf (NOR_ED269_compliant_geozones_2026-11-14.json, 14 Zonen).
const body = JSON.parse(readFileSync(join(__dirname, "fixtures/dronesoner-no-ed269-sample.json"), "utf8"));
const byId = (features: any[], id: string) => features.find((f) => f.properties.zoneId === id);

describe("Norwegen – Dateiname der Tagesdatei", () => {
  it("liest den Namen aus index.html (jüngstes Datum gewinnt)", () => {
    const html =
      '<a href="Downloads/NOR_ED269_compliant_geozones_2026-11-14.json">ED-269</a>' +
      '<a href="Downloads/NOR_ED318_compliant_geozones_2026-11-14.json">ED-318</a>' +
      "<!-- NOR_ED269_compliant_geozones_2026-11-13.json -->";
    assert.equal(
      norwayEd269UrlFromHtml(html),
      "https://dronesoner.no/Downloads/NOR_ED269_compliant_geozones_2026-11-14.json",
    );
    assert.equal(norwayEd269UrlFromHtml("<html></html>"), null);
  });
  it("Rückfall: heute und gestern (UTC)", () => {
    assert.deepEqual(norwayFallbackUrls(new Date("2026-11-15T00:30:00Z")), [
      "https://dronesoner.no/Downloads/NOR_ED269_compliant_geozones_2026-11-15.json",
      "https://dronesoner.no/Downloads/NOR_ED269_compliant_geozones_2026-11-14.json",
    ]);
  });
});

describe("Norwegen – Normalisierung", () => {
  const features = norwayFeaturesFromBody(body);

  it("nacktes Array -> Features mit _country no, Quelle und bbox", () => {
    assert.equal(features.length, 14);
    for (const f of features) {
      assert.equal(f.properties._country, "no");
      assert.equal(f.properties.source, NO_GEOZONE_SOURCE_LABEL);
      assert.equal(f.bbox?.length, 4);
    }
  });

  it("Mapping §3.5: NATURE, Flugverbot im Text -> PROHIBITED, sonst Genehmigung/bedingt", () => {
    const r = (id: string) => byId(features, id).properties.restriction;
    assert.equal(r("C917A6F"), "NATURE"); // Verneområde
    assert.equal(r("00A2051"), "PROHIBITED"); // „All flyging i restriksjonsområdet er forbudt“
    assert.equal(r("CC12313"), "PROHIBITED"); // „Droneforbud over Loen Skylift“
    assert.equal(r("5E2DA4D"), "PROHIBITED"); // NOTAM „ALL FLYING PROHIBITED“
    assert.equal(r("D6FB63A"), "REQ_AUTHORISATION"); // NSM-Kameraverbot, Flug erlaubt
    assert.equal(r("0355687"), "REQ_AUTHORISATION"); // Fengsel, krever tillatelse
    assert.equal(r("86C2719"), "REQ_AUTHORISATION"); // 5-km-Flughafenzone
    assert.equal(r("7E91C22"), "CONDITIONAL"); // Fareområde
    assert.equal(norwegianRestriction({ restriction: "REQ_AUTHORISATION", reason: ["SENSITIVE"], message: "Bruk av Wi-Fi er forbudt." }), "REQ_AUTHORISATION");
  });

  it("Höhen: 300 m AGL bleibt, FT AMSL wird in Meter umgerechnet", () => {
    const air = byId(features, "86C2719").properties;
    assert.equal(air.lowerMeters, 0);
    assert.equal(air.upperMeters, 300);
    assert.equal(air.upperReference, "AGL");
    const r = byId(features, "73804A3").properties;
    assert.equal(r.upperMeters, 762);
    assert.equal(r.upperReference, "AMSL");
  });

  it("mehrere Volumes gleicher Höhe -> ein MultiPolygon", () => {
    const f = byId(features, "9C8717E");
    assert.equal(f.geometry.type, "MultiPolygon");
    assert.equal((f.geometry.coordinates as unknown[]).length, 2);
  });

  it("NOTAM-Zonen: markiert, mit Zeitfenster; abgelaufene filtert der Parser", () => {
    const f = byId(features, "A0C4D87");
    assert.equal(f.properties.isNotam, true);
    assert.equal(f.properties._notamEligible, true);
    const [z] = parseEd269ToGeozoneInfo([f], "no");
    assert.equal(z, undefined, "NOTAM endete am 14.11.2026 -> nicht mehr sichtbar");
    const fresh = JSON.parse(JSON.stringify(f));
    fresh.properties.applicability = [{ permanent: "NO", startDateTime: "2099-01-01T00:00:00Z", endDateTime: "2099-01-02T00:00:00Z" }];
    const [z2] = parseEd269ToGeozoneInfo([fresh], "no");
    assert.equal(z2.validEndTs, Date.parse("2099-01-02T00:00:00Z"));
    assert.equal(z2.notamEligible, true);
  });

  it("Popup-Text: Meldung, Grund und zuständige Stelle mit Link", () => {
    const [z] = parseEd269ToGeozoneInfo([byId(features, "86C2719")], "no");
    assert.match(z.details, /Grund: Luftverkehr/);
    assert.match(z.details, /Droneflyging krever tillatelse/);
    assert.match(z.details, /Zuständige Stelle: Avinor AS/);
    assert.ok(z.links?.some((l) => l.url.startsWith("https://avinor.no/")));
  });

  it("NATURE mit Saison-Hinweis, NSM mit Foto-Verbot", () => {
    assert.match(byId(features, "41986E7").properties.message, /saisonal/);
    assert.match(byId(features, "D6FB63A").properties.message, /NO_PHOTOGRAPH/);
  });
});
