import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  queryEd269CachedFeaturesFrom,
  getCountriesInRadius,
  getViewportCountries,
} from "../geozoneCoverage";
import { __resetEd269StoreForTests } from "../geozoneDirect/ed269Store";

// Spiegelt Object.keys(COUNTRY_GEOZONE_CONFIGS) aus geozones.ts (die geozones.ts-
// Wrapper injizieren genau diese Menge). Reihenfolge = Iterationsreihenfolge der
// Config, die das Filterergebnis von getCountriesInRadius bestimmt.
const SUPPORTED_ISOS = ["DE", "CH", "LU", "NL", "FR", "AT", "BE"];

const API = "https://example.replit.app";

// ---------------------------------------------------------------------------
// fetch-Mock
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let lastUrl = "";
let fetchImpl: (url: string) => Promise<any>;

function installFetch(impl: (url: string) => Promise<any>) {
  fetchImpl = impl;
  globalThis.fetch = (async (input: any) => {
    lastUrl = typeof input === "string" ? input : input?.toString?.() ?? String(input);
    return fetchImpl(lastUrl);
  }) as any;
}

function jsonResponse(body: any, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

// Österreich-Feed (Austro Control) als Stub: zwei Zonen (Wien, Salzburg) + eine
// abgelaufene temporäre Zone in Wien.
const AT_FEED = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[16.3, 48.15], [16.45, 48.15], [16.45, 48.25], [16.3, 48.15]]] },
      properties: { restriction: "PROHIBITED", name: "Wien-Zone" },
    },
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[13.0, 47.78], [13.1, 47.78], [13.1, 47.85], [13.0, 47.78]]] },
      properties: { restriction: "REQ_AUTHORISATION", name: "Salzburg-Zone" },
    },
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[16.35, 48.18], [16.4, 48.18], [16.4, 48.2], [16.35, 48.18]]] },
      properties: {
        restriction: "PROHIBITED",
        name: "Abgelaufen",
        applicability: [{ startDateTime: "2020-01-01T00:00:00Z", endDateTime: "2020-01-02T00:00:00Z" }],
      },
    },
  ],
};

describe("queryEd269CachedFeaturesFrom – direkter Feed + lokale Abfrage", () => {
  beforeEach(() => {
    lastUrl = "";
    __resetEd269StoreForTests();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("lädt den AT-Feed direkt beim Anbieter und filtert lokal per bbox", async () => {
    let calls = 0;
    installFetch(async () => {
      calls++;
      return jsonResponse(JSON.parse(JSON.stringify(AT_FEED)));
    });
    const wien = await queryEd269CachedFeaturesFrom(API, 48.2, 16.37, 10, "AT");
    assert.ok(lastUrl.startsWith("https://utm.dronespace.at/"), lastUrl);
    assert.deepEqual(wien.map((z) => z.name), ["Wien-Zone"]);
    assert.equal(wien[0].country, "AT");

    // Zweite Abfrage aus dem Gerätecache (kein weiterer Download).
    const salzburg = await queryEd269CachedFeaturesFrom(API, 47.8095, 13.055, 10, "AT");
    assert.deepEqual(salzburg.map((z) => z.name), ["Salzburg-Zone"]);
    assert.equal(calls, 1);
  });

  it("liefert mit fullCountry den gesamten (nicht abgelaufenen) Bestand", async () => {
    installFetch(async () => jsonResponse(JSON.parse(JSON.stringify(AT_FEED))));
    const all = await queryEd269CachedFeaturesFrom(API, 0, 0, 1, "AT", undefined, true);
    assert.deepEqual(all.map((z) => z.name).sort(), ["Salzburg-Zone", "Wien-Zone"]);
  });

  it("liefert [] für Länder ohne Vektor-Feed, ohne Netzabruf", async () => {
    installFetch(async () => jsonResponse(AT_FEED));
    const out = await queryEd269CachedFeaturesFrom(API, 50, 8, 10, "DE");
    assert.deepEqual(out, []);
    assert.equal(lastUrl, "");
  });
});

describe("queryEd269CachedFeaturesFrom – Fehlerfälle ohne throw", () => {
  beforeEach(() => __resetEd269StoreForTests());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("liefert [] bei nicht-ok-Status", async () => {
    installFetch(async () => jsonResponse(AT_FEED, false, 503));
    const out = await queryEd269CachedFeaturesFrom(API, 47.8, 13.0, 10, "AT");
    assert.deepEqual(out, []);
  });

  it("liefert [] bei fehlendem features-Array", async () => {
    installFetch(async () => jsonResponse({ foo: "bar" }));
    const out = await queryEd269CachedFeaturesFrom(API, 47.8, 13.0, 10, "AT");
    assert.deepEqual(out, []);
  });

  it("liefert [] (statt throw) bei Netzwerkfehler", async () => {
    installFetch(async () => {
      throw new Error("network down");
    });
    const out = await queryEd269CachedFeaturesFrom(API, 47.8, 13.0, 10, "AT");
    assert.deepEqual(out, []);
  });

  it("liefert [] (statt throw) bei kaputtem JSON", async () => {
    installFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    }));
    const out = await queryEd269CachedFeaturesFrom(API, 47.8, 13.0, 10, "AT");
    assert.deepEqual(out, []);
  });
});

describe("getCountriesInRadius – AT als Grenz-Sicherheitsnetz", () => {
  it("nimmt AT auf für einen Punkt knapp außerhalb AT, aber in Reichweite (LI-Grenze, Primär CH)", () => {
    // Vaduz (LI) wird primär als CH/LI erkannt; ein 10-km-Radius überlappt die
    // AT-Box (Vorarlberg). AT muss als Abdeckung erscheinen.
    const out = getCountriesInRadius(SUPPORTED_ISOS, 47.141, 9.5209, 10, "CH");
    assert.ok(out.includes("AT"), `AT fehlt: ${out.join(",")}`);
    assert.equal(out[0], "CH", "primäres ISO zuerst");
  });

  it("setzt primaryIso (großgeschrieben) immer als erstes Element", () => {
    const out = getCountriesInRadius(SUPPORTED_ISOS, 48.2, 16.37, 5, "at");
    assert.equal(out[0], "AT");
  });

  it("listet AT NICHT für einen weit entfernten Punkt (Norddeutschland)", () => {
    const out = getCountriesInRadius(SUPPORTED_ISOS, 53.55, 9.99, 10); // Hamburg
    assert.ok(!out.includes("AT"), `AT fälschlich enthalten: ${out.join(",")}`);
    assert.ok(out.includes("DE"));
  });
});

describe("getCountriesInRadius – Belgien kein FR-Leck", () => {
  it("zeigt für Flémalle/Liège (BE) KEIN Frankreich an (1 km)", () => {
    // Standort eindeutig in Belgien; die grobe FR-Box reicht über die Grenze und
    // hatte FR fälschlich (sogar als erstes Land) mitgezählt.
    const out = getCountriesInRadius(SUPPORTED_ISOS, 50.6163, 5.479, 1, "BE");
    assert.ok(!out.includes("FR"), `FR fälschlich enthalten: ${out.join(",")}`);
    assert.equal(out[0], "BE", "primäres ISO zuerst");
  });

  it("zeigt für einen tiefer in Belgien liegenden Punkt nur BE (5 km)", () => {
    const out = getCountriesInRadius(SUPPORTED_ISOS, 50.85, 4.35, 5); // Brüssel
    assert.deepEqual(out, ["BE"], `unerwartete Länder: ${out.join(",")}`);
  });

  it("liefert für einen grenznahen Punkt weiterhin korrekt FR", () => {
    // Mouscron (BE) direkt an der Grenze zu Tourcoing (FR); ein 10-km-Radius
    // reicht real in beide Länder, also müssen BE und FR erscheinen.
    const out = getCountriesInRadius(SUPPORTED_ISOS, 50.74, 3.21, 10, "BE");
    assert.ok(out.includes("BE"), `BE fehlt: ${out.join(",")}`);
    assert.ok(out.includes("FR"), `FR fehlt: ${out.join(",")}`);
  });

  it("erzwingt KEIN FR, wenn FR als Vorzugsland gewählt ist, der Flug aber tief in BE liegt", () => {
    // Reproduziert den gemeldeten Bug: Vorzugsland = FR, Standort = Charleroi (BE).
    // Das primäre Land darf NICHT erzwungen aufgenommen werden, sonst erscheinen
    // französische DGAC/AlphaTango-Karten bei einem Flug in Belgien.
    const out = getCountriesInRadius(SUPPORTED_ISOS, 50.4109, 4.4446, 1, "FR");
    assert.ok(!out.includes("FR"), `FR fälschlich enthalten: ${out.join(",")}`);
    assert.deepEqual(out, ["BE"], `unerwartete Länder: ${out.join(",")}`);
  });
});

describe("getViewportCountries – AT im Viewport an der Grenze", () => {
  it("erfasst AT, wenn der Viewport von DE (Mitte) nach AT reicht", () => {
    // Mitte knapp auf DE-Seite nahe Salzburg, Ausdehnung greift nach AT hinein.
    const out = getViewportCountries(SUPPORTED_ISOS, 47.9, 12.9, 0.6, 0.9);
    assert.ok(out.includes("AT"), `AT fehlt: ${out.join(",")}`);
    assert.ok(out.includes("DE"), `DE fehlt: ${out.join(",")}`);
  });

  it("liefert ohne Ausdehnung den nächsten unterstützten Nachbarn via Border-Proben", () => {
    // Vaduz (LI, nicht unterstützt) -> Proben finden CH und/oder AT.
    const out = getViewportCountries(SUPPORTED_ISOS, 47.141, 9.5209);
    assert.ok(out.length > 0, "kein Nachbar gefunden");
    assert.ok(out.every((iso) => SUPPORTED_ISOS.includes(iso)), `nicht unterstütztes ISO: ${out.join(",")}`);
  });
});

describe("Liechtenstein nutzt den Schweizer BAZL-Datensatz", () => {
  it("zählt einen Punkt in Vaduz als CH (Karte + Zonencheck)", () => {
    const isos = [...SUPPORTED_ISOS];
    assert.deepEqual(getViewportCountries(isos, 47.141, 9.521).slice(0, 1), ["CH"]);
    assert.equal(getCountriesInRadius(isos, 47.141, 9.521, 1)[0], "CH");
  });
});
