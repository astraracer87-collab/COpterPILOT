import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  IT_DFLIGHT_WFS_URL,
  IT_WFS_LAYER_NFZ,
  IT_WFS_LAYER_NOTAM,
  IT_WFS_LAYER_ZONES,
  italianWfsUrl,
  italianWfsViewparams,
  normalizeItalianWfs,
  parseItalianDate,
} from "../../../shared/italianGeozones";
import { __resetItalyStateForTests, fetchItalyWith, type ItalyFetchDeps } from "../geozoneDirect/italySource";
import { DFLIGHT_DIRECT_GRANT_DISABLED_MESSAGE, DflightAuthError, dflightLoginErrorMessage } from "../geozoneDirect/dflightAuth";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { assessGeozoneAltitudeConflict } from "../../../shared/geozoneAltitudeFilter";
import { getGeozoneSourceMeta } from "../../../shared/geozoneSourceMeta";

// HANDGEBAUTE Fixture nach den dokumentierten Feldern (Anhang IT) – siehe
// `_hinweis` in der Datei. Kein Live-Abruf.
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/dflight-it-wfs-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");
const byId = (fs: any[], id: string) => fs.find((f) => f.properties.identifier === id);

describe("d-flight WFS – URLs", () => {
  it("GetFeature-URL wie in der Doku (GeoJSON, EPSG:4326, Paging)", () => {
    const url = italianWfsUrl(IT_WFS_LAYER_ZONES, { count: 1000, startIndex: 2000 });
    assert.equal(
      url,
      `${IT_DFLIGHT_WFS_URL}?service=WFS&version=2.0.0&request=GetFeature&typeNames=D-FLIGHT:ATM09_INFO` +
        "&outputFormat=application/json&srsName=EPSG:4326&count=1000&startIndex=2000",
    );
    assert.equal(IT_DFLIGHT_WFS_URL, "https://www.d-flight.it/maps/wms");
    assert.doesNotMatch(italianWfsUrl(IT_WFS_LAYER_ZONES, { now: NOW }), /viewparams/);
  });

  it("NFZ/NOTAM-Zeitfilter (viewparams) wie die Web-App", () => {
    assert.equal(italianWfsViewparams(IT_WFS_LAYER_NFZ, NOW), "start_nfz:2026-11-15T12:00;end_nfz:9999-12-31T00:00;");
    assert.equal(
      italianWfsViewparams(IT_WFS_LAYER_NOTAM, NOW),
      "div_notam:2026-11-15T12:00;dfv_notam:9999-12-31T00:00;quota_max:20000;",
    );
    const url = italianWfsUrl(IT_WFS_LAYER_NFZ, { now: NOW, count: 2000 });
    assert.match(url, /typeNames=D-FLIGHT:NO_FLY_ZONE/);
    assert.ok(url.includes(`viewparams=${encodeURIComponent("start_nfz:2026-11-15T12:00;end_nfz:9999-12-31T00:00;")}`));
  });

  it("Datumsformate", () => {
    assert.equal(parseItalianDate("2026-10-29"), Date.UTC(2026, 9, 29));
    assert.equal(parseItalianDate("2026-10-29 12:30"), Date.UTC(2026, 9, 29, 12, 30));
    assert.equal(parseItalianDate("29/10/2026 08:00"), Date.UTC(2026, 9, 29, 8, 0));
    assert.equal(parseItalianDate(""), null);
    assert.equal(parseItalianDate(null), null);
  });
});

describe("d-flight WFS – ATM09_INFO", () => {
  const zones = normalizeItalianWfs(fixture.ATM09_INFO, IT_WFS_LAYER_ZONES, NOW);

  it("abgelaufene Zonen entfallen", () => {
    assert.deepEqual(
      zones.map((f) => f.properties.identifier),
      ["IT-ATM09-101", "IT-ATM09-102", "IT-ATM09-103"],
    );
  });

  it("Höhenklasse 0 m → Flugverbot", () => {
    const p = byId(zones, "IT-ATM09-101").properties;
    assert.equal(p.restriction, "PROHIBITED");
    assert.equal(p.maxFlightHeightAglM, undefined);
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.upperMeters, undefined);
  });

  it("Höhenklasse 25 m → CONDITIONAL mit Flughöhe 25 m AGL, ohne Obergrenze; Text IT + DE", () => {
    const p = byId(zones, "IT-ATM09-102").properties;
    assert.equal(p.restriction, "CONDITIONAL");
    assert.equal(p.maxFlightHeightAglM, 25);
    assert.equal(p.upperMeters, undefined);
    assert.equal(p.lowerReference, "AGL");
    assert.equal(p.name, "LIRF - FIUMICINO");
    assert.match(p.message, /^UAS-Geozone \(ENAC ATM-09, d-flight\)\nMax\. Flughöhe laut d-flight \(ENAC ATM-09\): 25 m über Grund\./);
    assert.match(p.message, /Originaltext der Behörde:\nAltezza massima 25 m\nOperazioni consentite fino a 25 m AGL/);
    const lm = p.extendedProperties.localizedMessages;
    assert.equal(lm[0].language, "de");
    assert.equal(lm[1].language, "it");
    assert.match(lm[1].message, /Operazioni consentite/);
    assert.equal(p.source, "d-flight (ENAV)");
    assert.ok(p.attribution.includes("d-flight"));
  });

  it("Lat/Lon-Achsfolge wird erkannt und gedreht", () => {
    const f = byId(zones, "IT-ATM09-103");
    assert.deepEqual(f.geometry.coordinates[0][0], [12.4, 41.78]);
  });

  it("Prüfkette: unter der Flughöhe frei, darüber Höhenfrage; 0 m = Verbot", () => {
    const infos = parseEd269ToGeozoneInfo(zones as any[], "IT");
    const z25 = infos.find((i) => i.featureId === "IT-ATM09-102")!;
    assert.equal(z25.maxFlightHeightAglM, 25);
    assert.equal(assessGeozoneAltitudeConflict(z25, 20).clearedByAltitude, true);
    assert.equal(assessGeozoneAltitudeConflict(z25, 40).needsClimbQuestion, true);
    const z0 = infos.find((i) => i.featureId === "IT-ATM09-101")!;
    assert.equal(assessGeozoneAltitudeConflict(z0, 10).kind, "noFly");
  });

  it("ohne Höhenangabe: Verbotstext → PROHIBITED, sonst REQ_AUTHORISATION", () => {
    const base = fixture.ATM09_INFO.features[1];
    const mk = (props: Record<string, unknown>) => ({ ...base, properties: { ...base.properties, upper_limit_m: null, quota_max: null, ...props } });
    const [a, b] = normalizeItalianWfs(
      [mk({ id: 1, regola: "Volo vietato", rule: "" }), mk({ id: 2, regola: "Previo coordinamento con ENAV", rule: "" })],
      IT_WFS_LAYER_ZONES,
      NOW,
    );
    assert.equal(a.properties.restriction, "PROHIBITED");
    assert.equal(b.properties.restriction, "REQ_AUTHORISATION");
  });
});

describe("d-flight WFS – NO_FLY_ZONE und NOTAM", () => {
  it("NFZ: PROHIBITED, temporär, Gültigkeit; abgelaufene entfallen", () => {
    const nfz = normalizeItalianWfs(fixture.NO_FLY_ZONE, IT_WFS_LAYER_NFZ, NOW);
    assert.equal(nfz.length, 1);
    const p = nfz[0].properties;
    assert.equal(p.identifier, "IT-NFZ-9001");
    assert.equal(p.restriction, "PROHIBITED");
    assert.equal(p.isTemporary, true);
    assert.equal(p.validStartTs, Date.UTC(2026, 10, 15, 8));
    assert.equal(p.validEndTs, Date.UTC(2026, 10, 16, 20));
    assert.equal(p.upperMeters, 150);
    assert.match(p.message, /Gültig: 2026-11-15 08:00 UTC bis 2026-11-16 20:00 UTC/);
    assert.match(p.message, /Originaltext der Behörde:\nDivieto temporaneo di sorvolo UAS/);
    const [info] = parseEd269ToGeozoneInfo(nfz as any[], "IT");
    assert.equal(info.restriction, "PROHIBITED");
    assert.equal(info.validEndTs, Date.UTC(2026, 10, 16, 20));
  });

  it("NOTAM: Punkt mit Radius → Kreis, Verbotstext → PROHIBITED", () => {
    const [n] = normalizeItalianWfs(fixture.NOTAM, IT_WFS_LAYER_NOTAM, NOW);
    assert.equal(n.geometry.type, "Polygon");
    assert.equal(n.properties.name, "NOTAM W1234/26");
    assert.equal(n.properties.restriction, "PROHIBITED");
    assert.equal(n.properties.isNotam, true);
    assert.equal(n.properties.validEndTs, Date.UTC(2026, 10, 30, 23, 59));
    const quiet = normalizeItalianWfs(
      [{ ...fixture.NOTAM.features[0], properties: { ...fixture.NOTAM.features[0].properties, text: "UAS ACTIVITY WI 2KM" } }],
      IT_WFS_LAYER_NOTAM,
      NOW,
    );
    assert.equal(quiet[0].properties.restriction, "RESTRICTED");
  });
});

// ---------------------------------------------------------------------------
// Abruf-Ablauf (Netz ersetzt)
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function deps(over: Partial<ItalyFetchDeps> = {}, log: string[] = []): ItalyFetchDeps {
  return {
    hasCredentials: async () => true,
    login: async () => "token",
    ed269Url: async () => "https://www.d-flight.it/geo-awareness/api/ed-269/geo-zones/download",
    ed269Get: async (url) => {
      log.push(`ed269 ${url}`);
      return json({ error: "Authentication failed" }, 401);
    },
    wfsGet: async (url) => {
      log.push(`wfs ${url}`);
      if (url.includes("ATM09_INFO")) return json(fixture.ATM09_INFO);
      if (url.includes("NO_FLY_ZONE")) return json(fixture.NO_FLY_ZONE);
      return json(fixture.NOTAM);
    },
    now: () => NOW,
    ...over,
  };
}

describe("fetchItalyWith – Ablauf", () => {
  beforeEach(() => __resetItalyStateForTests());

  it("ED-269 401 → still auf WFS; Zonen + NFZ + NOTAM, _country it", async () => {
    const log: string[] = [];
    const out = await fetchItalyWith(deps({}, log));
    assert.deepEqual(
      out.map((f) => f.properties.identifier),
      ["IT-ATM09-101", "IT-ATM09-102", "IT-ATM09-103", "IT-NFZ-9001", "IT-NOTAM-18"],
    );
    for (const f of out) {
      assert.equal(f.properties._country, "it");
      assert.ok(Array.isArray(f.bbox));
    }
    assert.equal(log.filter((l) => l.startsWith("ed269")).length, 1);
    // zweiter Abruf: ED-269 nach der Ablehnung nicht erneut versucht
    await fetchItalyWith(deps({}, log));
    assert.equal(log.filter((l) => l.startsWith("ed269")).length, 1);
  });

  it("ohne Zugangsdaten: Hinweis, kein Netz", async () => {
    const log: string[] = [];
    await assert.rejects(fetchItalyWith(deps({ hasCredentials: async () => false }, log)), /Kein d-flight-Zugang eingetragen/);
    assert.equal(log.length, 0);
  });

  it("nur ein fehlgeschlagener Login meldet Zugangsdaten-Fehler", async () => {
    await assert.rejects(
      fetchItalyWith(
        deps({
          login: async () => {
            throw new DflightAuthError("d-flight: Benutzername oder Passwort falsch", "credentials", 401);
          },
        }),
      ),
      (e: any) => e.kind === "credentials",
    );
  });

  it("WFS 403 auf der Zonen-Ebene: Fehler ohne Zugangsdaten-Vorwurf", async () => {
    await assert.rejects(
      fetchItalyWith(deps({ wfsGet: async () => json({}, 403) })),
      (e: any) => e.kind === "server" && /nicht freigegeben/.test(e.message) && !/Zugang.*prüfen|Passwort/.test(e.message),
    );
  });

  it("NFZ/NOTAM-Fehler sind nicht fatal", async () => {
    const out = await fetchItalyWith(
      deps({ wfsGet: async (url) => (url.includes("ATM09_INFO") ? json(fixture.ATM09_INFO) : json({}, 500)) }),
    );
    assert.equal(out.length, 3);
  });

  it("Paging über count/startIndex bis numberMatched", async () => {
    const seen: string[] = [];
    const page = (n: number, start: number) => ({
      type: "FeatureCollection",
      numberMatched: 2500,
      features: Array.from({ length: n }, (_, i) => ({
        ...fixture.ATM09_INFO.features[1],
        properties: { ...fixture.ATM09_INFO.features[1].properties, id: start + i },
      })),
    });
    const out = await fetchItalyWith(
      deps({
        wfsGet: async (url) => {
          if (!url.includes("ATM09_INFO")) return json({ features: [] });
          seen.push(url);
          const start = Number(url.match(/startIndex=(\d+)/)?.[1] ?? 0);
          return json(page(start >= 2000 ? 500 : 1000, start));
        },
      }),
    );
    assert.equal(seen.length, 3);
    assert.match(seen[1], /count=1000&startIndex=1000/);
    assert.equal(out.length, 2500);
  });

  it("ED-269 erfolgreich → ATM09_INFO entfällt, NFZ/NOTAM kommen dazu", async () => {
    const ed = {
      features: [
        {
          identifier: "ED_A",
          name: "Zona ED",
          restriction: "PROHIBITED",
          geometry: [{ horizontalProjection: { type: "Polygon", coordinates: [[[12, 41], [12.1, 41], [12.1, 41.1], [12, 41]]] } }],
        },
      ],
    };
    const log: string[] = [];
    const out = await fetchItalyWith(deps({ ed269Get: async () => json(ed) }, log));
    assert.ok(!log.some((l) => l.includes("ATM09_INFO")));
    assert.ok(out.some((f) => f.properties.identifier === "IT-NFZ-9001"));
    assert.ok(out.some((f) => String(f.properties.zoneId ?? "").startsWith("ED_A")));
  });
});

describe("d-flight – Login-Fehler und Registry", () => {
  it("Direct Access Grants abgeschaltet → klare Meldung (kein Passwort-Vorwurf)", () => {
    const e = dflightLoginErrorMessage(400, { error: "unauthorized_client", error_description: "Client not allowed for direct access grants" });
    assert.equal(e.message, DFLIGHT_DIRECT_GRANT_DISABLED_MESSAGE);
    assert.equal(e.message, "d-flight-Anmeldung per App nicht möglich – bitte melden");
    assert.equal(e.kind, "server");
  });

  it("Registry IT: Freigabe-Text mit Umfang", () => {
    const m = getGeozoneSourceMeta("IT")!;
    assert.equal(m.writtenPermission, true);
    assert.match(m.license!, /eigenes d-flight-Konto zum persönlichen Gebrauch/);
    assert.match(m.license!, /nicht weitergegeben/);
    assert.match(m.license!, /2026-11-15/);
  });
});
