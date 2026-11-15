// B7: Zonenmittelpunkt der ED-269-NOTAM-Einträge. polygonRings/-Groups aus
// parseEd269ToGeozoneInfo sind [lat, lon]; der Mittelpunkt wurde früher als
// [lon, lat] gelesen (Breite/Länge vertauscht).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ed269ZonesToNotamRestrictions } from "../ed269Notams";
import { parseEd269ToGeozoneInfo } from "../ed269";

const HOUR = 3600_000;

describe("ed269ZonesToNotamRestrictions – Zonenmittelpunkt", () => {
  it("liefert centerLat/centerLon in der richtigen Reihenfolge (Brüssel)", () => {
    const now = Date.now();
    // Quadrat um 50,85° N / 4,35° O in GeoJSON-Reihenfolge [lon, lat].
    const feature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[4.3, 50.8], [4.4, 50.8], [4.4, 50.9], [4.3, 50.9], [4.3, 50.8]]],
      },
      properties: {
        name: "Temporäre Zone",
        restriction: "PROHIBITED",
        validStartTs: now - HOUR,
        validEndTs: now + 2 * HOUR,
      },
    };
    const zones = parseEd269ToGeozoneInfo([feature] as any[], "BE");
    assert.equal(zones.length, 1);
    const [r] = ed269ZonesToNotamRestrictions(zones);
    assert.ok(r, "kurzzeitige Zone erscheint als NOTAM");
    // Mittel über die 5 Ringpunkte (Schlusspunkt doppelt): Breite ≈ 50,84, Länge ≈ 4,34.
    assert.ok(Math.abs((r.centerLat ?? 0) - 50.84) < 1e-9, `centerLat ${r.centerLat}`);
    assert.ok(Math.abs((r.centerLon ?? 0) - 4.34) < 1e-9, `centerLon ${r.centerLon}`);
    assert.equal(r.status, "active");
  });

  it("ohne Ring bleibt der Mittelpunkt leer", () => {
    const now = Date.now();
    const [r] = ed269ZonesToNotamRestrictions([
      { name: "X", validStartTs: now, validEndTs: now + HOUR, polygonRings: [] } as any,
    ]);
    assert.equal(r.centerLat, null);
    assert.equal(r.centerLon, null);
  });
});

describe("ed269ZonesToNotamRestrictions – Status über zoneActivityAt", () => {
  const NOW = Date.parse("2026-11-15T12:00:00Z");
  const ring: [number, number][] = [[50.8, 4.3], [50.8, 4.4], [50.9, 4.4], [50.8, 4.3]];
  const zone = (extra: Record<string, unknown>) => ({ name: "Z", polygonRings: [ring], ...extra }) as any;

  it("Beginn in der Zukunft → Zukünftig", () => {
    const [r] = ed269ZonesToNotamRestrictions([zone({ validStartTs: NOW + 3600_000, validEndTs: NOW + 7200_000 })], NOW);
    assert.equal(r.status, "upcoming");
  });

  it("gültig, aber applicability-Fenster erst später → Zukünftig (bisher: aktiv)", () => {
    const [r] = ed269ZonesToNotamRestrictions(
      [
        zone({
          validStartTs: NOW - 3600_000,
          validEndTs: NOW + 86400_000,
          ed269Applicability: [{ startDateTime: "2026-11-15T15:00:00Z", endDateTime: "2026-11-15T17:00:00Z" }],
        }),
      ],
      NOW,
    );
    assert.equal(r.status, "upcoming");
  });

  it("abgelaufene Zone entfällt; alle applicability-Fenster vorbei ebenso", () => {
    assert.deepEqual(ed269ZonesToNotamRestrictions([zone({ validStartTs: NOW - 7200_000, validEndTs: NOW - 1 })], NOW), []);
    assert.deepEqual(
      ed269ZonesToNotamRestrictions(
        [
          zone({
            notamEligible: true,
            ed269Applicability: [{ startDateTime: "2026-11-15T08:00:00Z", endDateTime: "2026-11-15T09:00:00Z" }],
          }),
        ],
        NOW,
      ),
      [],
    );
  });
});

