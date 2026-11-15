// B7/S7: Keine stille Kürzung der Vektor-Zonen auf GEOZONE_VECTOR_MAX_FEATURES.
// Wird die Trefferliste gekürzt, meldet die Abfrage `truncated` und eine
// Abdeckungs-Notiz „Nur die nächstgelegenen N Zonen angezeigt – hineinzoomen“.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { queryEd269CachedFeaturesWithStatusFrom } from "../geozoneCoverage";
import { __resetEd269StoreForTests } from "../geozoneDirect/ed269Store";
import { queryEd269Features } from "../geozoneDirect/ed269Query";
import { coverageChecks, formatCoverageTruncation, geozoneTruncationHint } from "../../../shared/checks/builders";

const realFetch = globalThis.fetch;
function installFetch(impl: (url: string) => Promise<any>) {
  globalThis.fetch = (async (input: any) => impl(typeof input === "string" ? input : String(input))) as any;
}
const json = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

const square = (lon: number, lat: number, d = 0.01) => ({
  type: "Polygon",
  coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]],
});
const AT_FEED = {
  type: "FeatureCollection",
  features: [0, 1, 2].map((i) => ({
    type: "Feature",
    geometry: square(16.37 + i * 0.02, 48.2),
    properties: { restriction: "REQ_AUTHORISATION", name: `Zone ${i}` },
  })),
};

describe("Kürzung der Vektor-Zonen (B7/S7)", () => {
  beforeEach(() => __resetEd269StoreForTests());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("queryEd269Features meldet die Kürzung über stats", () => {
    const feats = AT_FEED.features.map((f, i) => ({ ...f, bbox: [16.37 + i * 0.02, 48.2, 16.38 + i * 0.02, 48.21] })) as any[];
    const stats: { truncated?: boolean; total?: number } = {};
    const out = queryEd269Features(feats, "AT", { bbox: [16.3, 48.1, 16.5, 48.3], limit: 2, stats });
    assert.equal(out.length, 2);
    assert.deepEqual(stats, { truncated: true, total: 3 });
    const none: { truncated?: boolean } = {};
    queryEd269Features(feats, "AT", { bbox: [16.3, 48.1, 16.5, 48.3], limit: 5, stats: none });
    assert.equal(none.truncated, undefined);
  });

  it("gekürzte Abfrage: truncated + Hinweis als Abdeckungs-Notiz", async () => {
    installFetch(async () => json(JSON.parse(JSON.stringify(AT_FEED))));
    const r = await queryEd269CachedFeaturesWithStatusFrom("", 48.205, 16.39, 10, "AT", 2);
    assert.equal(r.status, "ok");
    assert.equal(r.zones.length, 2);
    assert.equal(r.truncated, true);
    assert.equal(r.note, "Nur die nächstgelegenen 2 Zonen angezeigt – hineinzoomen");
    const full = await queryEd269CachedFeaturesWithStatusFrom("", 48.205, 16.39, 10, "AT", 10);
    assert.equal(full.truncated, undefined);
    assert.equal(full.zones.length, 3);
  });

  it("Liste/Prüfkette: Hinweiszeile und Notiz im Datenstand-Befund", () => {
    assert.equal(geozoneTruncationHint(1200), "Nur die nächstgelegenen 1200 Zonen angezeigt – hineinzoomen");
    const sources = [
      { iso: "DK", status: "ok" as const, fetchedAt: Date.now(), truncated: true, note: geozoneTruncationHint(1200) },
      { iso: "AT", status: "ok" as const },
    ];
    assert.equal(
      formatCoverageTruncation(sources, (iso) => (iso === "DK" ? "Dänemark" : iso), 1200),
      "Dänemark: Nur die nächstgelegenen 1200 Zonen angezeigt – hineinzoomen",
    );
    const checks = coverageChecks({ context: "planning", sources });
    assert.equal(checks.find((c) => c.id === "coverage:DK:age")?.detail, geozoneTruncationHint(1200));
  });
});
