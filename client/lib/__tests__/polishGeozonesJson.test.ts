// PANSA-JSON-Weg (/v1/zones + Typen + Aktivierungen + NOTAMs) und KML-Rückfall.
// Fixture HANDGEBAUT aus den dokumentierten Feldern (docs/pansa-pl-api-integration.md
// §10, docs/tools/poland/pansa_geozones.py) – keine echte PANSA-Antwort.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  PANSA_ACTIVATIONS_URL,
  PANSA_AUP_HINT_DE,
  PANSA_NOTAMS_URL,
  PANSA_TIMESLICES_URL,
  PANSA_ZONES_URL,
  PANSA_ZONE_TYPES_URL,
  normalizePansaZonesJson,
  pansaActivationHorizon,
  pansaActivationWindows,
  pansaCircleGeometry,
  pansaJsonType,
  pansaList,
  pansaNotams,
  pansaTypeInfos,
} from "../../../shared/polishGeozones";
import { zoneActivityAt } from "../../../shared/ed269Restriction";
import { isZoneReachable } from "../../../shared/geozoneAltitudeFilter";
import { isTemporaryGeozoneProps } from "../../../shared/geozoneTemporary";
import { PansaAuthError, loadPoland, resetPansaMemory, type PansaHttp } from "../geozoneDirect/polandSource";
import { parseEd269ToGeozoneInfo } from "../ed269";

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "pansa_zones_json_handbuilt.json"), "utf8"));
const REAL_KML = fs.readFileSync(path.join(__dirname, "fixtures", "pansa_kml_sample.kml"), "utf8");
const NOW = Date.parse("2026-11-15T12:00:00Z");
const at = (iso: string) => new Date(iso);

function byName(features: any[], name: string): any {
  const f = features.find((x) => x.properties.name === name);
  assert.ok(f, `Zone ${name} fehlt`);
  return f;
}

function info(feature: any): any {
  const [i] = parseEd269ToGeozoneInfo([feature], "pl", NOW);
  assert.ok(i, `parse ${feature.properties.name}`);
  return i;
}

describe("PANSA JSON – Hülle, Typen, Kreise", () => {
  it("pansaList entpackt { properties: [...] }", () => {
    assert.equal(pansaList({ properties: [1, 2], status: 200 }).length, 2);
    assert.deepEqual(pansaList([3]), [3]);
    assert.deepEqual(pansaList({ properties: null }), []);
    assert.deepEqual(pansaList(null), []);
  });

  it("Typ: Tabelle vor Kategorie; MTMA wie TMA; unbekannt → Kategorie bzw. vorsorglich Genehmigung", () => {
    const types = pansaTypeInfos(RAW.types);
    assert.equal(types.get("XYZ")?.category, "DRA-P");
    assert.equal(pansaJsonType("DRAP").restriction, "PROHIBITED");
    assert.equal(pansaJsonType("CTR1KM").restriction, "REQ_AUTHORISATION");
    assert.equal(pansaJsonType("RMZ").restriction, "NO_RESTRICTION");
    assert.equal(pansaJsonType("MTMA").restriction, "PROHIBITED");
    assert.equal(pansaJsonType("MATZ").restriction, "REQ_AUTHORISATION");
    assert.equal(pansaJsonType("XYZ", types).restriction, "PROHIBITED");
    const unk = pansaJsonType("QQQ", types);
    assert.equal(unk.restriction, "REQ_AUTHORISATION");
    assert.equal(unk.unknown, true);
  });

  it("Kreis aus etc.primitive (centre [lon,lat], radius m) → geschlossenes Polygon", () => {
    const g = pansaCircleGeometry({ type: "CIRCLE", centre: [21.0122, 52.2297], radius: 1500 });
    assert.ok(g);
    const ring = g!.coordinates[0];
    assert.equal(ring.length, 65);
    assert.deepEqual(ring[0], ring[64]);
    // Nordpunkt ≈ 1500 m nördlich
    assert.ok(Math.abs((ring[0][1] - 52.2297) * 111_195 - 1500) < 5);
    assert.equal(pansaCircleGeometry({ type: "POLYGON" }), null);
    assert.equal(pansaCircleGeometry({ type: "CIRCLE", centre: [21, 52], radius: 0 }), null);
  });
});

describe("PANSA JSON – Normalisierung (handgebaute Fixture)", () => {
  const res = normalizePansaZonesJson(RAW, NOW);
  const F = res.features;

  it("Zonen ohne Geometrie und FIS entfallen; NOTAM mit eigener Geometrie wird temporäre Zone", () => {
    assert.equal(res.zoneCount, 12);
    assert.equal(res.notamZoneCount, 1);
    assert.equal(res.notamUnplaced, 1); // C0001 ohne Zone/Geometrie; D0002 inaktiv
    assert.equal(res.activationsLoaded, true);
    assert.ok(!F.some((f) => f.properties.name === "FIS WARSZAWA" || f.properties.name === "BROKEN"));
  });

  it("Beschränkung laut PL_TYPE_TABLE, Unterzonen, RPA-Ampel", () => {
    assert.equal(byName(F, "DRA-P 2550").properties.restriction, "PROHIBITED");
    const ring = byName(F, "EPKK CTR1KM").properties;
    assert.equal(ring.restriction, "REQ_AUTHORISATION");
    assert.equal(ring.plParent, "CTR EPKK");
    assert.match(ring.message, /Teil von: CTR EPKK/);
    const rpa = byName(F, "RA RPA51").properties;
    assert.equal(rpa.restriction, "REQ_AUTHORISATION");
    assert.equal(rpa.plRpaStatus, "YELLOW");
    assert.equal(rpa.plRpaColor, "#f9a825");
    assert.match(rpa.message, /RPA-Ampel: GELB \(Farbe #f9a825\)/);
    assert.equal(byName(F, "MTMA EPDE").properties.restriction, "PROHIBITED");
    assert.equal(byName(F, "NEW ZONE 1").properties.restriction, "PROHIBITED"); // Kategorie DRA-P
    assert.equal(byName(F, "RMZ EPLL").properties.restriction, "NO_RESTRICTION");
  });

  it("Kreiszone wird aus dem Primitiv gerendert (nicht das Ersatz-Polygon)", () => {
    const p = byName(F, "EP P1");
    assert.equal(p.properties.plShape, "CIRCLE");
    assert.equal(p.geometry.coordinates[0].length, 65);
  });

  it("Höhen: Untergrenze MSL (Doku), Obergrenze ohne Bezug (UNKNOWN) – nichts wird fälschlich ausgegraut", () => {
    const rmz = byName(F, "RMZ EPLL");
    assert.equal(rmz.properties.lowerMeters, 762);
    assert.equal(rmz.properties.lowerReference, "AMSL");
    assert.equal(rmz.properties.upperReference, undefined);
    const i = info(rmz);
    assert.equal(i.lower.ref, "MSL");
    assert.equal(i.upper.ref, "UNKNOWN");
    // Gelände 150 m: 762 − 150 − Marge ≫ 120 m → ausgegraut; ohne Gelände sichtbar.
    const zone = { lower: i.lower, upper: i.upper, lowerMeters: i.lowerMeters, lowerReference: i.lowerReference } as any;
    assert.equal(isZoneReachable(zone, { reachableAltitudeM: 120, terrain: { centerM: 120, maxM: 150, minM: 100, samples: 5 } } as any), false);
    assert.equal(isZoneReachable(zone, { reachableAltitudeM: 120 } as any), true);
    // GND-Zone: Bezug AGL 0
    const drap = info(byName(F, "DRA-P 2550"));
    assert.equal(drap.lowerMeters, 0);
    assert.equal(drap.upper.ref, "UNKNOWN");
  });

  it("H24-Zonen dauerhaft; TFR mit start/stop hat Gültigkeitsfenster", () => {
    const h24 = byName(F, "EPTR99").properties;
    assert.equal(h24.applicability, undefined);
    assert.equal(h24.plH24, true);
    const tfr = byName(F, "EP TFR 7").properties;
    assert.equal(tfr.validStartTs, Date.parse("2026-11-15T06:00:00Z"));
    assert.equal(tfr.validEndTs, Date.parse("2026-11-16T18:00:00Z"));
  });

  it("Zeitgesteuerte TRA: aktiv nur in den Fenstern (Timeslice + UUP), nach dem Horizont vorsorglich aktiv", () => {
    const tra = byName(F, "EPTR12A");
    assert.equal(tra.properties.plTimeControlled, true);
    assert.equal(res.horizon, Date.parse("2026-11-16T12:00:00Z"));
    const i = info(tra);
    assert.equal(zoneActivityAt(i, at("2026-11-15T07:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(i, at("2026-11-15T12:00:00Z")), "active");
    assert.equal(zoneActivityAt(i, at("2026-11-15T15:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(i, at("2026-11-16T10:00:00Z")), "active");
    assert.equal(zoneActivityAt(i, at("2026-11-16T13:00:00Z")), "active"); // nach Horizont
    assert.match(tra.properties.message, /Aktivierung prüfen \(AUP\)/);
    assert.match(tra.properties.message, /UUP/);
    // dauerhafte Geometrie, kein NOTAM-artiger Kurzzeit-Eintrag
    assert.equal(isTemporaryGeozoneProps(tra.properties, "PL"), false);
  });

  it("MRT ohne Aktivierung: jetzt inaktiv, nach dem Horizont aktiv", () => {
    const i = info(byName(F, "MRT 22"));
    assert.equal(zoneActivityAt(i, at("2026-11-15T12:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(i, at("2026-11-16T12:30:00Z")), "active");
  });

  it("TSA per NOTAM aktiviert (Join über Zonenname); inaktive NOTAMs zählen nicht", () => {
    const tsa = byName(F, "EPTS05");
    const i = info(tsa);
    assert.equal(zoneActivityAt(i, at("2026-11-15T12:00:00Z")), "active");
    assert.equal(zoneActivityAt(i, at("2026-11-15T17:00:00Z")), "inactive");
    assert.match(tsa.properties.message, /NOTAM A1234\/26/);
    assert.doesNotMatch(tsa.properties.message, /D0002/);
  });

  it("NOTAM-Zone ist temporär (isNotam, Fenster)", () => {
    const n = byName(F, "NOTAM B0042/26");
    assert.equal(n.properties.isNotam, true);
    assert.equal(isTemporaryGeozoneProps(n.properties, "PL"), true);
    const i = info(n);
    assert.equal(zoneActivityAt(i, at("2026-11-15T12:00:00Z")), "active");
    assert.equal(zoneActivityAt(i, at("2026-11-15T21:00:00Z")), "inactive");
  });

  it("ohne Aktivierungsdaten: zeitgesteuerte Zonen aktiv + Hinweis „Aktivierung prüfen (AUP)“", () => {
    const r = normalizePansaZonesJson({ zones: RAW.zones, types: RAW.types }, NOW);
    assert.equal(r.activationsLoaded, false);
    assert.equal(r.horizon, null);
    const mrt = byName(r.features, "MRT 22").properties;
    assert.equal(mrt.applicability, undefined);
    assert.equal(mrt.plActivationUnknown, true);
    assert.ok(mrt.message.includes(`${PANSA_AUP_HINT_DE}: zeitgesteuerte Zone, Aktivierungsdaten nicht geladen`));
    assert.equal(zoneActivityAt(info({ ...byName(r.features, "MRT 22") }), at("2026-11-15T12:00:00Z")), "active");
  });

  it("Horizont höchstens 36 h nach Abruf; ohne Fensterende = Abrufzeit", () => {
    const w = pansaActivationWindows([{ designator: "X", start: "2026-11-15T00:00:00Z", stop: "2026-12-30T00:00:00Z" }], undefined);
    assert.equal(pansaActivationHorizon(w, NOW), NOW + 36 * 3_600_000);
    assert.equal(pansaActivationHorizon(new Map(), NOW), NOW);
    assert.equal(pansaNotams(RAW.notams).length, 3);
  });
});

describe("PANSA Abruf – JSON-Weg, Speicher, Token, KML-Rückfall", () => {
  beforeEach(() => resetPansaMemory());

  function mockHttp(opts: { failZones?: boolean; failActivations?: boolean; expireOnce?: boolean } = {}) {
    const calls: string[] = [];
    let logins = 0;
    let expired = !!opts.expireOnce;
    const http: PansaHttp = {
      login: async () => `tok${++logins}`,
      getJson: async (url, token) => {
        calls.push(url);
        if (expired && token === "tok1") {
          expired = false;
          throw new PansaAuthError(401);
        }
        if (url === PANSA_ZONES_URL) {
          if (opts.failZones) throw new Error("HTTP 500");
          return RAW.zones;
        }
        if (url === PANSA_ZONE_TYPES_URL) return RAW.types;
        if (url === PANSA_TIMESLICES_URL || url === PANSA_ACTIVATIONS_URL) {
          if (opts.failActivations) throw new Error("HTTP 503");
          return url === PANSA_TIMESLICES_URL ? RAW.timeslices : RAW.activations;
        }
        if (url === PANSA_NOTAMS_URL) return RAW.notams;
        throw new Error(`unerwartet ${url}`);
      },
      getKml: async () => REAL_KML,
    };
    return { http, calls, logins: () => logins };
  }

  it("JSON-Weg: alle fünf Endpunkte; zweiter Abruf nutzt Zonen/Typen aus dem Speicher", async () => {
    const m = mockHttp();
    const r1 = await loadPoland(m.http, NOW);
    assert.equal(r1.via, "json");
    assert.equal(r1.activationsLoaded, true);
    assert.equal(r1.features.length, 13);
    assert.ok(r1.features.every((f) => (f.properties as any)._country === "pl" || (f.properties as any).country === "POL"));
    assert.deepEqual(m.calls, [PANSA_ZONES_URL, PANSA_ZONE_TYPES_URL, PANSA_TIMESLICES_URL, PANSA_ACTIVATIONS_URL, PANSA_NOTAMS_URL]);
    m.calls.length = 0;
    await loadPoland(m.http, NOW + 3_600_000);
    assert.deepEqual(m.calls, [PANSA_TIMESLICES_URL, PANSA_ACTIVATIONS_URL, PANSA_NOTAMS_URL]);
  });

  it("abgelaufenes Token → einmal neu einloggen", async () => {
    const m = mockHttp({ expireOnce: true });
    const r = await loadPoland(m.http, NOW);
    assert.equal(r.via, "json");
    assert.equal(m.logins(), 2);
  });

  it("Aktivierungen nicht ladbar → JSON-Zonen trotzdem, zeitgesteuerte Zonen vorsorglich aktiv", async () => {
    const m = mockHttp({ failActivations: true });
    const r = await loadPoland(m.http, NOW);
    assert.equal(r.via, "json");
    assert.equal(r.activationsLoaded, false);
    const mrt = r.features.find((f) => (f.properties as any).name === "MRT 22")!;
    assert.equal((mrt.properties as any).plActivationUnknown, true);
  });

  it("Zonen nicht ladbar → KML-Rückfall", async () => {
    const m = mockHttp({ failZones: true });
    const r = await loadPoland(m.http, NOW);
    assert.equal(r.via, "kml");
    assert.ok(r.features.length > 0);
    assert.match(r.jsonError ?? "", /HTTP 500/);
  });
});
