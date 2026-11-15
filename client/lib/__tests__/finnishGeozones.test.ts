import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ed269VolumeLimitMeters,
  ed269ProjectionToPolygons,
  ed269ZoneToFeatures,
  ED269_CIRCLE_SEGMENTS,
} from "../../../shared/ed269Pure";
import {
  normalizeFinnishApplicability,
  normalizeFinnishZones,
  FI_GEOZONE_SOURCE_LABEL,
} from "../../../shared/finnishGeozones";
import { finlandFeaturesFromBody } from "../geozoneDirect/finlandSource";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { ed269IsActiveAt } from "../../../shared/ed269Restriction";

// Gekürzter echter Traficom-Abruf vom 2026-11-15 (14 Einträge, EFUTUASC3 doppelt).
const body = JSON.parse(readFileSync(join(__dirname, "fixtures/traficom-uas-zones-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");
const byId = (features: any[], id: string) => features.find((f) => f.properties.zoneId === id);

describe("ed269Pure – Grundbausteine", () => {
  it("Höhen: null -> undefined, FT -> m, FL600+ -> unbegrenzt, SFC -> 0", () => {
    assert.equal(ed269VolumeLimitMeters(null, "M"), undefined);
    assert.equal(ed269VolumeLimitMeters(120, "M"), 120);
    assert.equal(ed269VolumeLimitMeters(2000, "FT"), 609.6);
    assert.equal(ed269VolumeLimitMeters(99999, "M"), undefined);
    assert.equal(ed269VolumeLimitMeters("SFC", "M"), 0);
    assert.equal(ed269VolumeLimitMeters(95, "FL"), 2895.6);
  });
  it("Kreis -> geschlossenes 48-Eck mit passendem Radius", () => {
    const [poly] = ed269ProjectionToPolygons({ type: "Circle", center: [25, 60], radius: 1000 });
    const ring = poly[0];
    assert.equal(ring.length, ED269_CIRCLE_SEGMENTS + 1);
    assert.deepEqual(ring[0], ring[ring.length - 1]);
    // Nordpunkt ~ 1000 m = 0,008993° Breite
    assert.ok(Math.abs(ring[0][1] - 60 - 1000 / 111195) < 1e-5);
  });
  it("Volumes mit unterschiedlichen Höhen -> getrennte Features, gleiche -> MultiPolygon", () => {
    const sq = (x: number) => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
    const zone = {
      identifier: "T1",
      restriction: "REQ_AUTHORISATION",
      zoneAuthority: [{ name: "Behörde", contactName: "Frau X", phone: "+1", email: "a@b.cd" }],
      geometry: [
        { uomDimensions: "M", lowerLimit: 0, upperLimit: 120, horizontalProjection: sq(0) },
        { uomDimensions: "M", lowerLimit: 0, upperLimit: 120, horizontalProjection: sq(2) },
        { uomDimensions: "FT", lowerLimit: 500, lowerVerticalReference: "AMSL", horizontalProjection: sq(4) },
      ],
    };
    const fs = ed269ZoneToFeatures(zone);
    assert.equal(fs.length, 2);
    assert.equal(fs[0].geometry.type, "MultiPolygon");
    assert.equal(fs[0].properties.upperMeters, 120);
    assert.equal(fs[1].properties.lowerMeters, 152.4);
    assert.equal(fs[1].properties.lowerReference, "AMSL");
    assert.equal("upperMeters" in fs[1].properties, false);
    assert.deepEqual(fs.map((f) => f.properties.zoneId), ["T1#1", "T1#2"]);
    assert.match(fs[0].properties.message, /Kontakt: Frau X · \+1 · a@b\.cd/);
    assert.equal(fs[0].properties.contactEmail, "a@b.cd");
  });
});

describe("Finnland (Traficom) – Normalisierung", () => {
  const features = finlandFeaturesFromBody(body, NOW);

  it("alle Einträge werden Features mit _country fi, bbox und Quelle", () => {
    assert.equal(features.length, 14);
    for (const f of features) {
      assert.equal(f.properties._country, "fi");
      assert.equal(f.properties.source, FI_GEOZONE_SOURCE_LABEL);
      assert.equal(f.bbox?.length, 4);
    }
  });

  it("Restriction bleibt (PROHIBITED / REQ_AUTHORISATION / NO_RESTRICTION = erlaubende Zone)", () => {
    assert.equal(byId(features, "FIN712").properties.restriction, "PROHIBITED");
    assert.equal(byId(features, "EFAAUAS").properties.restriction, "REQ_AUTHORISATION");
    const perm = byId(features, "FIN432").properties;
    assert.equal(perm.restriction, "NO_RESTRICTION");
    assert.equal(perm.permissiveZone, true);
    assert.match(perm.message, /Erlaubende Zone/);
  });

  it("Höhen: null -> SFC/unbegrenzt, Untergrenze 120 m, FT AMSL -> m", () => {
    const aa = byId(features, "EFAAUAS").properties;
    assert.equal(aa.lowerMeters, 0);
    assert.equal("upperMeters" in aa, false);
    const kk = byId(features, "EFKKUASD").properties;
    assert.equal(kk.lowerMeters, 120);
    assert.equal(kk.lowerReference, "AGL");
    const p432 = byId(features, "FIN432").properties;
    assert.equal(p432.upperMeters, 609.6);
    assert.equal(p432.upperReference, "AMSL");
  });

  it("permanent YES mit Enddatum = Verordnungsperiode, kein Ablauf", () => {
    const aa = byId(features, "EFAAUAS").properties;
    assert.deepEqual(aa.applicability, [{ permanent: "YES", regulationPeriodEndDateTime: "2027-04-17T21:00:00.00Z" }]);
    assert.equal(aa.regulationPeriodEnd, "2027-04-17T21:00:00.00Z");
    // Auch nach der Periode bleibt die Zone sichtbar (Feed wird ohnehin täglich erneuert).
    const [z] = parseEd269ToGeozoneInfo([byId(features, "EFAAUAS")], "fi");
    assert.equal(z.validEndTs, null);
    assert.equal(z.scheduleText, undefined);
  });

  it("echte befristete Zone (≤ 1 Jahr) behält ihr Gültigkeitsfenster", () => {
    const f = byId(features, "FIN748");
    assert.equal(f.properties.temporary, true);
    const [z] = parseEd269ToGeozoneInfo([f], "fi");
    assert.equal(z.validEndTs, Date.parse("2026-12-30T22:00:00Z"));
  });

  it("Start in der Zukunft -> erst ab Startdatum aktiv", () => {
    const p = byId(features, "FIN760").properties;
    assert.equal(ed269IsActiveAt(p, NOW), false);
    assert.equal(ed269IsActiveAt(p, new Date("2026-12-05T00:00:00Z")), true);
  });

  it("Wochentagsplan (Utti) bleibt erhalten und wird kompakt angezeigt", () => {
    const weekend = byId(features, "EFUTUASC3");
    const weekdays = byId(features, "EFUTUASC3~2");
    assert.ok(weekend && weekdays, "doppelte Kennung wird eindeutig gemacht");
    const parsed = parseEd269ToGeozoneInfo([weekend, weekdays], "fi");
    assert.deepEqual(parsed.map((z) => z.scheduleText), [["Sa, So"], ["Mo–Fr"]]);
    assert.equal(ed269IsActiveAt(weekend.properties, new Date("2026-11-14T10:00:00Z")), true); // Samstag
    assert.equal(ed269IsActiveAt(weekend.properties, new Date("2026-11-16T10:00:00Z")), false); // Montag
  });

  it("Erklärtext aus exceptionPermit landet in der Meldung", () => {
    const [z] = parseEd269ToGeozoneInfo([byId(features, "FIN435")], "fi");
    assert.match(z.details, /Hinweis Traficom \(fi\): Lennättäminen/);
    assert.match(z.details, /Zuständige Stelle: Traficom/);
    assert.match(z.details, /Grund: Sensibles Gebiet/);
  });

  it("normalizeFinnishApplicability: trivialer Schedule entfällt", () => {
    const out = normalizeFinnishApplicability(
      [{ permanent: "YES", startDateTime: "2020-01-01T00:00:00Z", endDateTime: "2050-01-01T00:00:00Z", schedule: [{ day: ["ANY"], startTime: "00:00:00Z", endTime: "23:59:59Z" }] }],
      NOW,
    );
    assert.deepEqual(out, [{ permanent: "YES", regulationPeriodEndDateTime: "2050-01-01T00:00:00Z" }]);
  });

  it("normalizeFinnishZones ohne Features -> leer", () => {
    assert.deepEqual(normalizeFinnishZones({ features: [] }), []);
    assert.deepEqual(normalizeFinnishZones(null), []);
  });
});
