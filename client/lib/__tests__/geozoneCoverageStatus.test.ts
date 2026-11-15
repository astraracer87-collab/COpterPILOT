import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  queryEd269CachedFeaturesWithStatusFrom,
  queryEd269CachedFeaturesFrom,
  summarizeGeozoneCoverage,
  uncoveredGeozoneSources,
  geozoneCoverageWarning,
  worseSourceStatus,
  withPartialDatasetNote,
} from "../geozoneCoverage";
import { __resetEd269StoreForTests } from "../geozoneDirect/ed269Store";

// Review-Fix 4: "keine Zonen" darf nicht mit "keine Daten" verwechselt werden.

const realFetch = globalThis.fetch;
function installFetch(impl: (url: string) => Promise<any>) {
  globalThis.fetch = (async (input: any) => impl(typeof input === "string" ? input : String(input))) as any;
}
const json = (body: any, ok = true, status = 200) => ({ ok, status, json: async () => body });

const AT_FEED = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[16.3, 48.15], [16.45, 48.15], [16.45, 48.25], [16.3, 48.15]]] },
      properties: { restriction: "PROHIBITED", name: "Wien-Zone" },
    },
  ],
};

describe("queryEd269CachedFeaturesWithStatusFrom", () => {
  beforeEach(() => __resetEd269StoreForTests());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("leerer Gerätebestand + Download-Fehler -> missing -> unavailable", async () => {
    installFetch(async () => json({}, false, 503));
    const r = await queryEd269CachedFeaturesWithStatusFrom("", 47.8, 13.0, 10, "AT");
    assert.deepEqual(r.zones, []);
    assert.equal(r.status, "missing");
    assert.equal(summarizeGeozoneCoverage([{ iso: "AT", status: r.status }]), "unavailable");
  });

  it("Netzwerkfehler -> kein grünes Ergebnis (missing/error), nie ok", async () => {
    installFetch(async () => {
      throw new Error("network down");
    });
    const r = await queryEd269CachedFeaturesWithStatusFrom("", 47.8, 13.0, 10, "AT");
    assert.ok(r.status === "missing" || r.status === "error", r.status);
    assert.equal(summarizeGeozoneCoverage([{ iso: "AT", status: r.status }]), "unavailable");
  });

  it("normaler (frisch geladener) Datensatz -> ok -> complete", async () => {
    installFetch(async () => json(JSON.parse(JSON.stringify(AT_FEED))));
    const r = await queryEd269CachedFeaturesWithStatusFrom("", 48.2, 16.37, 10, "AT");
    assert.equal(r.status, "ok");
    assert.deepEqual(r.zones.map((z) => z.name), ["Wien-Zone"]);
    assert.ok(typeof r.fetchedAt === "number" && r.fetchedAt > 0);
    assert.equal(summarizeGeozoneCoverage([{ iso: "AT", status: r.status }]), "complete");
  });

  it("Land ohne Store (z. B. CZ/HU) -> missing", async () => {
    installFetch(async () => json(AT_FEED));
    const r = await queryEd269CachedFeaturesWithStatusFrom("", 50.08, 14.43, 10, "CZ");
    assert.equal(r.status, "missing");
  });

  it("alte Signatur queryEd269CachedFeaturesFrom liefert weiterhin nur das Zonen-Array", async () => {
    installFetch(async () => json(JSON.parse(JSON.stringify(AT_FEED))));
    const zones = await queryEd269CachedFeaturesFrom("", 48.2, 16.37, 10, "AT");
    assert.ok(Array.isArray(zones));
    assert.equal(zones.length, 1);
  });
});

describe("summarizeGeozoneCoverage / Helfer", () => {
  it("leere Quellenliste -> unavailable", () => {
    assert.equal(summarizeGeozoneCoverage([]), "unavailable");
  });

  it("CZ ohne Paket (missing) als einziges Land -> unavailable", () => {
    assert.equal(summarizeGeozoneCoverage([{ iso: "CZ", status: "missing" }]), "unavailable");
  });

  it("DE ok + CZ-Nachbar missing -> partial; Lücke wird gemeldet", () => {
    const sources = [
      { iso: "DE", status: "ok" as const },
      { iso: "CZ", status: "missing" as const, note: "Offline-Paket nicht geladen" },
    ];
    assert.equal(summarizeGeozoneCoverage(sources), "partial");
    assert.deepEqual(uncoveredGeozoneSources(sources).map((s) => s.iso), ["CZ"]);
  });

  it("HU unsupported -> unavailable; stale zählt als abgedeckt", () => {
    assert.equal(summarizeGeozoneCoverage([{ iso: "HU", status: "unsupported" }]), "unavailable");
    assert.equal(summarizeGeozoneCoverage([{ iso: "AT", status: "stale" }]), "complete");
  });

  it("DE partial (Wohngrundstücke fehlen) allein -> partial, gilt als Lücke", () => {
    const sources = [{ iso: "DE", status: "partial" as const, note: "Wohngrundstücke offline nicht gespeichert – nicht geprüft" }];
    assert.equal(summarizeGeozoneCoverage(sources), "partial");
    assert.equal(uncoveredGeozoneSources(sources).length, 1);
  });

  it("worseSourceStatus wählt den schlechteren Status", () => {
    assert.equal(worseSourceStatus("ok", "missing"), "missing");
    assert.equal(worseSourceStatus("error", "ok"), "error");
  });

  it("Warntext auf Deutsch", () => {
    assert.equal(
      geozoneCoverageWarning("Tschechien"),
      "Geozonen-Daten für Tschechien nicht verfügbar – Zonen bitte manuell prüfen.",
    );
  });
});

describe("Teilbestand eines Abrufs (partialNote)", () => {
  it("ok → partial mit Hinweis; stale bleibt stale; ohne Hinweis unverändert", () => {
    assert.deepEqual(withPartialDatasetNote({ status: "ok" }, undefined), { status: "ok" });
    assert.deepEqual(withPartialDatasetNote({ status: "ok" }, "CAA Slovenia: 1 von 18 Ebenen nicht abrufbar (CTR)"), {
      status: "partial",
      note: "CAA Slovenia: 1 von 18 Ebenen nicht abrufbar (CTR)",
    });
    const stale = withPartialDatasetNote({ status: "stale", note: "Temporäre Beschränkungen nicht aktuell" }, "X fehlt");
    assert.equal(stale.status, "partial");
    assert.equal(stale.note, "X fehlt · Temporäre Beschränkungen nicht aktuell");
    assert.equal(summarizeGeozoneCoverage([{ iso: "SI", status: "partial", note: "X" }]), "partial");
  });
});
