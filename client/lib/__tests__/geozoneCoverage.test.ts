import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  queryEd269CachedFeaturesFrom,
  getCountriesInRadius,
  getViewportCountries,
} from "../geozoneCoverage";

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

describe("queryEd269CachedFeaturesFrom – bbox/URL-Aufbau", () => {
  beforeEach(() => {
    lastUrl = "";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("baut country (lowercase) + bbox (lon,lat,lon,lat) korrekt und trifft den Cache-Endpoint", async () => {
    installFetch(async () => jsonResponse({ countries: [] }));
    await queryEd269CachedFeaturesFrom(API, 47.8095, 13.055, 10, "AT");

    const url = new URL(lastUrl);
    assert.equal(url.origin + url.pathname, `${API}/api/cached/geozones`);
    assert.equal(url.searchParams.get("country"), "at");

    const bbox = url.searchParams.get("bbox")!;
    const parts = bbox.split(",").map(Number);
    assert.equal(parts.length, 4);
    const [minLon, minLat, maxLon, maxLat] = parts;
    // bbox ist um den Mittelpunkt zentriert -> Mittelwerte ~ Eingabe.
    assert.ok(Math.abs((minLat + maxLat) / 2 - 47.8095) < 1e-6, "lat-Mitte");
    assert.ok(Math.abs((minLon + maxLon) / 2 - 13.055) < 1e-6, "lon-Mitte");
    // Reihenfolge: minLon < maxLon, minLat < maxLat.
    assert.ok(minLon < maxLon && minLat < maxLat, "bbox-Reihenfolge");
    // 10 km in Breitengrad ~ 0.0898 Grad -> Spannweite ~ 0.1796.
    assert.ok(Math.abs(maxLat - minLat - 2 * (10 / 111.32)) < 1e-3, "lat-Spannweite");
  });

  it("wählt den passenden country-Eintrag aus countries[] (nicht einfach [0])", async () => {
    installFetch(async () =>
      jsonResponse({
        countries: [
          { country: "ch", features: [] },
          {
            country: "AT",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Polygon",
                  coordinates: [[[16.0, 48.0], [16.1, 48.0], [16.1, 48.1], [16.0, 48.0]]],
                },
                properties: { restriction: "PROHIBITED", name: "Wien-Zone" },
              },
            ],
          },
        ],
      }),
    );

    const out = await queryEd269CachedFeaturesFrom(API, 48.2, 16.37, 10, "AT");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Wien-Zone");
    assert.equal(out[0].country, "AT");
  });

  it("fällt auf countries[0] zurück, wenn kein passender ISO-Eintrag existiert", async () => {
    installFetch(async () =>
      jsonResponse({
        countries: [
          {
            country: "xx",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Polygon",
                  coordinates: [[[16.0, 48.0], [16.1, 48.0], [16.1, 48.1], [16.0, 48.0]]],
                },
                properties: { restriction: "PROHIBITED", name: "Fallback-Zone" },
              },
            ],
          },
        ],
      }),
    );

    const out = await queryEd269CachedFeaturesFrom(API, 48.2, 16.37, 10, "AT");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "Fallback-Zone");
  });
});

describe("queryEd269CachedFeaturesFrom – Fehlerfälle ohne throw", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("liefert [] bei nicht-ok-Status", async () => {
    installFetch(async () => jsonResponse({ countries: [{ country: "at", features: [{}] }] }, false, 503));
    const out = await queryEd269CachedFeaturesFrom(API, 47.8, 13.0, 10, "AT");
    assert.deepEqual(out, []);
  });

  it("liefert [] bei fehlendem countries-Array", async () => {
    installFetch(async () => jsonResponse({ foo: "bar" }));
    const out = await queryEd269CachedFeaturesFrom(API, 47.8, 13.0, 10, "AT");
    assert.deepEqual(out, []);
  });

  it("liefert [] wenn features keine Liste ist", async () => {
    installFetch(async () => jsonResponse({ countries: [{ country: "at", features: "nope" }] }));
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
