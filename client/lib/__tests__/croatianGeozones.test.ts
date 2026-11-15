import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseWkt, tryParseWkt, wktToAreaGeometry, WktParseError } from "../../../shared/wktParse";
import {
  HR_AREA_TYPE_RESTRICTION,
  HR_GEOZONE_SOURCE_LABEL,
  hrIsPlaceholderValidity,
  hrLowerIsRelevant,
  hrParseUtc,
  hrRestrictionForType,
  normalizeCroatiaHub,
  parseHrAltitude,
  splitHrNameCoords,
} from "../../../shared/croatianGeozones";
import { applySignalRMessage, collectSignalRPushes } from "../geozoneDirect/croatiaSignalR";
import { croatiaFeaturesFromPushes, croatiaPushesComplete } from "../geozoneDirect/croatiaSource";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { ed269IsActiveAt } from "../../../shared/ed269Restriction";

// Gekürzter ECHTER Abzug des AMC-Hubs (2026-11-15): 10 von 565 Gebieten, 12 von
// 126 Aktivierungen, 16 von 257 Drohnenreservierungen; personenbezogene Felder
// entfernt (siehe _comment in der Datei).
const pushes = JSON.parse(readFileSync(join(__dirname, "fixtures/hr-amc-signalr-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T04:00:00Z");
const result = normalizeCroatiaHub(pushes, NOW);
const byId = (id: string) => result.features.find((f) => f.properties.identifier === id);
const byName = (prefix: string) => result.features.find((f) => String(f.properties.name).startsWith(prefix));

describe("wktParse", () => {
  it("POLYGON in voller Präzision (lon lat), geschlossen", () => {
    const g = parseWkt("POLYGON ((14.0108 45.3828, 14.095 45.2725, 14.1367 45.3894, 14.0108 45.3828))");
    assert.equal(g?.type, "Polygon");
    assert.deepEqual((g as any).coordinates[0][0], [14.0108, 45.3828]);
    const precise = parseWkt("POLYGON((18.304660412922122 42.55200471, 18.31 42.56, 18.32 42.55))") as any;
    assert.equal(precise.coordinates[0][0][0], 18.304660412922122);
    // offener Ring wird geschlossen
    assert.deepEqual(precise.coordinates[0][3], precise.coordinates[0][0]);
  });

  it("Löcher, MULTIPOLYGON, Z/M, SRID, EMPTY, GEOMETRYCOLLECTION", () => {
    const holed = parseWkt("POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (2 2, 4 2, 4 4, 2 2))") as any;
    assert.equal(holed.coordinates.length, 2);
    const mp = parseWkt("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5), (5.2 5.1, 5.5 5.1, 5.5 5.4, 5.2 5.1)))") as any;
    assert.equal(mp.type, "MultiPolygon");
    assert.equal(mp.coordinates[1].length, 2);
    const z = parseWkt("SRID=4326;POLYGON Z ((0 0 5, 1 0 5, 1 1 5, 0 0 5))") as any;
    assert.deepEqual(z.coordinates[0][1], [1, 0]);
    assert.equal(parseWkt("POLYGON EMPTY"), null);
    assert.deepEqual(parseWkt("MULTIPOINT ((1 2), (3 4))"), { type: "MultiPoint", coordinates: [[1, 2], [3, 4]] });
    assert.deepEqual(parseWkt("multipoint (1 2, 3 4)"), { type: "MultiPoint", coordinates: [[1, 2], [3, 4]] });
    const gc = wktToAreaGeometry("GEOMETRYCOLLECTION (POINT (1 1), POLYGON ((0 0, 1 0, 1 1, 0 0)), POLYGON ((2 2, 3 2, 3 3, 2 2)))");
    assert.equal(gc?.type, "MultiPolygon");
  });

  it("CIRCLE (Nicht-Standard) → Polygon mit korrektem Radius", () => {
    const g = parseWkt("CIRCLE (16 45, 1000)") as any;
    assert.equal(g.type, "Polygon");
    const [lon, lat] = g.coordinates[0][0]; // Peilung 0° = Norden
    assert.ok(Math.abs(lon - 16) < 1e-9);
    assert.ok(Math.abs((lat - 45) * 111_195 - 1000) < 2);
  });

  it("Syntaxfehler → WktParseError bzw. null", () => {
    assert.throws(() => parseWkt("POLYGON ((0 0, 1 0"), WktParseError);
    assert.throws(() => parseWkt("TRIANGLE ((0 0, 1 0, 1 1, 0 0))"), WktParseError);
    assert.equal(tryParseWkt("POLYGON ((0 0, 1 1, 0 0))"), null); // < 3 verschiedene Punkte
    assert.equal(tryParseWkt(42), null);
  });
});

describe("croatianGeozones – Höhen, Zeiten, Typen", () => {
  it("Einheiten FL / ft AMSL / ft AGL / m AGL / FEET (Hundert Fuß, AUP)", () => {
    assert.deepEqual(parseHrAltitude(0, "FL"), { meters: 0, reference: "AGL", text: "GND" });
    assert.deepEqual(parseHrAltitude(125, "FL"), { meters: 3810, reference: "MSL", text: "FL 125" });
    assert.deepEqual(parseHrAltitude(4500, "ft AMSL"), { meters: 1371.6, reference: "MSL", text: "4500 ft AMSL" });
    assert.deepEqual(parseHrAltitude(1000, "ft AGL"), { meters: 304.8, reference: "AGL", text: "1000 ft AGL" });
    assert.deepEqual(parseHrAltitude(50, "m AGL"), { meters: 50, reference: "AGL", text: "50 m AGL" });
    // SRVC_Reservations: „40 FEET“ = 4000 ft (NUP: „GND - 4000 FEET“)
    assert.deepEqual(parseHrAltitude(40, "FEET", { hundredsFeet: true }), { meters: 1219.2, reference: "MSL", text: "4000 ft AMSL" });
  });

  it("Relevanzfilter: > 500 ft AGL bzw. > 6500 ft AMSL verworfen", () => {
    assert.equal(hrLowerIsRelevant(parseHrAltitude(500, "ft AGL")), true);
    assert.equal(hrLowerIsRelevant(parseHrAltitude(600, "ft AGL")), false);
    assert.equal(hrLowerIsRelevant(parseHrAltitude(2500, "ft AMSL")), true);
    assert.equal(hrLowerIsRelevant(parseHrAltitude(65, "FL")), true);
    assert.equal(hrLowerIsRelevant(parseHrAltitude(120, "FL")), false);
  });

  it("Zeiten ohne Zone = UTC; Platzhalter 2001–2030 = dauerhaft", () => {
    assert.equal(hrParseUtc("2026-11-16T07:00:00"), Date.UTC(2026, 10, 16, 7));
    assert.equal(hrIsPlaceholderValidity("2001-01-01T00:00:00", "2030-01-01T00:00:00"), true);
    assert.equal(hrIsPlaceholderValidity("2026-11-15T06:00:00", "2026-11-15T09:00:00"), false);
  });

  it("Typ-Mapping (alle Legenden-Typen) und vorsichtiger Default", () => {
    const legend = pushes.SRVC_ClientSettings[0].FilterZona.map((z: any) => z.Naziv);
    for (const t of legend) assert.ok(HR_AREA_TYPE_RESTRICTION[t], `Mapping für ${t}`);
    assert.equal(hrRestrictionForType("URG"), "PROHIBITED");
    assert.equal(hrRestrictionForType("no  fly"), "PROHIBITED");
    assert.equal(hrRestrictionForType("TSA"), "RESTRICTED");
    assert.equal(hrRestrictionForType("CTR"), "REQ_AUTHORISATION");
    assert.equal(hrRestrictionForType("D"), "CONDITIONAL");
    assert.equal(hrRestrictionForType("XYZ"), "REQ_AUTHORISATION");
  });

  it("Koordinatenzusatz im Namen abtrennen", () => {
    assert.deepEqual(splitHrNameCoords(`Snimanje u svrhu promocija tura po Rijeci ( 45° 19' 29" N, 14° 25' 45" E ) `), {
      name: "Snimanje u svrhu promocija tura po Rijeci",
      coords: `45° 19' 29" N, 14° 25' 45" E`,
    });
    assert.deepEqual(splitHrNameCoords("URG DUBROVNIK"), { name: "URG DUBROVNIK" });
  });
});

describe("croatianGeozones – Normalisierung (echte Daten)", () => {
  it("Gesamtzahl und Verwerfungsgründe", () => {
    assert.equal(result.features.length, 20);
    assert.deepEqual(result.dropped, { lower_too_high: 4, merged_into_area: 1, retired: 2 });
    assert.equal(result.horizonTs, Date.UTC(2026, 10, 18)); // LDR49 bis 18.11. 00:00
  });

  it("AUP-Gebiet mit Aktivierungen: Fenster + Fenster ab Datenhorizont, Aktivität aus Drohnenreservierung", () => {
    const f = byId("LDD185")!;
    const p = f.properties;
    assert.equal(p.restriction, "CONDITIONAL");
    assert.equal(p.name, "LDD185 (D)");
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.upperMeters, 2895.6);
    assert.equal(p.upperReference, "MSL");
    assert.deepEqual(
      p.applicability.map((a: any) => [a.startDateTime, a.endDateTime]),
      [
        ["2026-11-15T06:00:00.000Z", "2026-11-15T09:00:00.000Z"],
        ["2026-11-15T13:30:00.000Z", "2026-11-15T15:30:00.000Z"],
        ["2026-11-18T00:00:00.000Z", "2027-11-18T00:00:00.000Z"],
      ],
    );
    assert.deepEqual(p.activities, ["Manned balloons"]);
    assert.match(p.message, /Reservierte Höhe laut AUP: GND – 4000 ft AMSL/);
    assert.match(p.message, /15\.11\.2026 06:00–09:00 UTC/);
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-15T07:00:00Z")), true);
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-15T10:00:00Z")), false);
    assert.equal(f.geometry.type, "Polygon");
    assert.deepEqual(f.geometry.coordinates[0][0], [15.6111, 46.1294]);
  });

  it("AUP-Gebiet ohne Aktivierung: inaktiv bis zum Datenhorizont, danach wieder aktiv (konfigurierbar)", () => {
    const p = byId("LDTS174")!.properties;
    assert.equal(p.restriction, "RESTRICTED");
    assert.equal(p.applicability.length, 1);
    assert.equal(ed269IsActiveAt(p, NOW), false);
    const cautious = normalizeCroatiaHub(pushes, NOW, { unreservedAlwaysActive: true });
    const c = cautious.features.find((f) => f.properties.identifier === "LDTS174")!.properties;
    assert.equal(c.applicability, undefined);
    assert.match(c.message, /keine Aktivierung bekannt/);
  });

  it("Höhenfilter: D ab FL125/FL280 verworfen, TSA ab 2500 ft AMSL behalten", () => {
    assert.equal(byId("LDD35B"), undefined);
    assert.equal(byId("LDD35C"), undefined);
    assert.equal(byId("LILDD35B"), undefined); // Aktivierung FL125–FL280
    assert.equal(byId("LDTR24B"), undefined); // Aktivierung ab FL120
    const uav = byId("LDUAV39")!.properties;
    assert.equal(uav.lowerMeters, 762);
    assert.equal(uav.lowerReference, "MSL");
  });

  it("Aktivierung ohne Katalogeintrag (LDP1, LDATR97) mit eigener Geometrie", () => {
    const p1 = byId("LDP1")!.properties;
    assert.equal(p1.restriction, "PROHIBITED");
    assert.equal(p1.sourceLayer, "AUP");
    assert.equal(p1.upperMeters, 304.8);
    assert.equal(p1.applicability[0].startDateTime, "2026-11-15T00:00:00.000Z");
    assert.equal(p1.applicability[0].endDateTime, "2026-11-17T00:00:00.000Z"); // zusammengeführt
    const atr = byId("LDATR97")!.properties;
    assert.equal(atr.restriction, "RESTRICTED");
    assert.equal(atr.lowerMeters, 609.6); // 20 FEET = 2000 ft
  });

  it("dauerhafte Drohnenzonen CTR/ATZ/URG/ULG", () => {
    const ctr = byName("CTR SPLIT 1")!.properties;
    assert.equal(ctr.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.applicability, undefined);
    assert.equal(ctr.openCategoryMaxAglMeters, 50);
    assert.equal(ctr.sourceLayer, "DRONE_ZONE");
    assert.equal(byName("ATZ LOSINJ")!.properties.restriction, "REQ_AUTHORISATION");
    const urg = byName("URG DUBROVNIK")!.properties;
    assert.equal(urg.restriction, "PROHIBITED");
    assert.equal(urg.upperReference, "AGL");
    assert.equal(urg.upperMeters, 304.8);
    assert.equal(byName("URG Buzin")!.properties.upperMeters, 50);
    assert.equal(byName("LDOB-ULG")!.properties.restriction, "REQ_AUTHORISATION");
  });

  it("zeitliche Drohnenreservierungen: gruppiert, abgelaufene/zurückgezogene verworfen, keine Personendaten", () => {
    const utr = byName("UTR: Snimanje u svrhu promocija tura po Rijeci")!.properties;
    assert.equal(utr.restriction, "CONDITIONAL");
    assert.equal(utr.applicability.length, 2);
    assert.equal(utr.upperMeters, 50);
    assert.equal(utr._notamEligible, true);
    assert.match(utr.message, /Position laut Antrag: 45° 19' 29" N, 14° 25' 45" E/);
    const tra = byName("TRA: Snimanje iz zraka")!.properties;
    assert.equal(tra.restriction, "RESTRICTED");
    assert.equal(tra.applicability.length, 3);
    const noFly = result.features.filter((f) => f.properties.originalType === "NO FLY");
    assert.equal(noFly.length, 2);
    assert.ok(noFly.every((f) => f.properties.restriction === "PROHIBITED"));
    assert.equal(byName("TRA: UAS"), undefined); // TAReq_Retired
    assert.ok(!result.features.some((f) => /Rezervacija iz mobilne/.test(f.properties.name))); // TAReq_Finished
    const json = JSON.stringify(result.features);
    assert.ok(!/@/.test(json), "keine E-Mail-Adressen");
    assert.ok(!/UserName/.test(json));
  });

  it("zoneIds eindeutig, Quelle gesetzt, deutsche Meldung zuerst", () => {
    const ids = result.features.map((f) => f.properties.zoneId);
    assert.equal(new Set(ids).size, ids.length);
    for (const f of result.features) {
      assert.equal(f.properties.source, HR_GEOZONE_SOURCE_LABEL);
      assert.equal(f.properties.extendedProperties.localizedMessages[0].language, "de");
      assert.match(f.properties.message, /^Typ: /);
    }
  });
});

describe("croatiaSource – App-Integration", () => {
  it("finalisiert mit _country hr + bbox und ist für parseEd269ToGeozoneInfo lesbar", () => {
    const features = croatiaFeaturesFromPushes(pushes, NOW);
    assert.equal(features.length, 20);
    assert.ok(features.every((f) => f.properties._country === "hr" && Array.isArray(f.bbox)));
    const infos = parseEd269ToGeozoneInfo(features as any, "hr");
    const urg = infos.find((z) => z.name.includes("DUBROVNIK"))!;
    assert.equal(urg.restriction, "PROHIBITED");
    assert.equal(urg.upperMeters, 304.8);
    const d = infos.find((z) => z.featureId === "HR-AREA-LDD185")!;
    assert.ok(Array.isArray(d.ed269Applicability) && d.ed269Applicability.length === 3);
    assert.equal(d.validEndTs, Date.UTC(2027, 10, 18)); // verschwindet nicht nach dem letzten Fenster
    assert.match(d.details, /Gefahrengebiet/);
  });

  it("croatiaPushesComplete", () => {
    assert.equal(croatiaPushesComplete(pushes), true);
    assert.equal(croatiaPushesComplete({ SRVC_Areas: [[]] }), false);
  });
});

// ---------------------------------------------------------------------------
// SignalR-Client mit Fake-fetch/-WebSocket (Protokollablauf wie live beobachtet)
// ---------------------------------------------------------------------------

function fakeFetch(log: string[], opts: { poll?: () => any } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.split("/").pop()!;
    log.push(`${init?.method ?? "GET"} ${path}`);
    let body: any = {};
    if (path === "negotiate") body = { ConnectionToken: "tok+/=", TryWebSockets: true, ProtocolVersion: "2.0" };
    else if (path === "start") body = { Response: "started" };
    else if (path === "connect") body = { C: "d-1", S: 1, M: [] };
    else if (path === "send") body = { I: "0" };
    else if (path === "poll") body = opts.poll?.() ?? {};
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as any;
  }) as any;
}

const AREAS_FRAME = JSON.stringify({ C: "d-2", M: [{ H: "aMCHub", M: "SRVC_Areas", A: [[{ Name: "X" }]] }, { H: "other", M: "SRVC_Foo", A: [] }] });

describe("croatiaSignalR", () => {
  it("applySignalRMessage: Pushes, Fehlerantworten, Init/Tokens", () => {
    const pushes: Record<string, any[]> = {};
    const errs: string[] = [];
    const r = applySignalRMessage({ C: "c1", S: 1, G: "g", M: [{ H: "AMCHUB", M: "SRVC_Areas", A: [[1]] }] }, "aMCHub", pushes, errs);
    assert.deepEqual(r, { messageId: "c1", groupsToken: "g", initialized: true });
    assert.deepEqual(pushes.SRVC_Areas, [[1]]);
    applySignalRMessage({ I: "0", E: "'CLIC_ClientReady' method could not be resolved.\nmore" }, "aMCHub", pushes, errs);
    assert.deepEqual(errs, ["'CLIC_ClientReady' method could not be resolved."]);
  });

  it("WebSocket: negotiate → connect → start → Aufruf → Pushes → schließen", async () => {
    const log: string[] = [];
    const sent: string[] = [];
    let wsUrl = "";
    class FakeWS {
      onopen?: () => void;
      onmessage?: (e: any) => void;
      onclose?: (e: any) => void;
      onerror?: (e: any) => void;
      constructor(url: string) {
        wsUrl = url;
        setTimeout(() => this.onopen?.(), 0);
      }
      send(s: string) {
        sent.push(s);
        setTimeout(() => {
          this.onmessage?.({ data: "{}" });
          this.onmessage?.({ data: AREAS_FRAME });
        }, 0);
      }
      close() {
        log.push("ws close");
      }
    }
    const res = await collectSignalRPushes({
      baseUrl: "https://amc.example/amc/signalr/",
      hub: "aMCHub",
      invocations: [{ method: "CLIC_ClientReady", args: ["WebClient"] }],
      isComplete: (p) => Array.isArray(p.SRVC_Areas),
      fetchImpl: fakeFetch(log),
      WebSocketImpl: FakeWS,
    });
    assert.equal(res.transport, "webSockets");
    assert.deepEqual(Object.keys(res.pushes), ["SRVC_Areas"]);
    assert.match(wsUrl, /^wss:\/\/amc\.example\/amc\/signalr\/connect\?transport=webSockets&clientProtocol=2\.1&connectionToken=tok%2B%2F%3D&connectionData=%5B%7B%22name%22%3A%22aMCHub%22%7D%5D$/);
    assert.deepEqual(JSON.parse(sent[0]), { H: "aMCHub", M: "CLIC_ClientReady", A: ["WebClient"], I: 0 });
    assert.deepEqual(log.slice(0, 2), ["GET negotiate", "GET start"]);
    assert.ok(log.includes("ws close"));
  });

  it("Fallback auf longPolling, wenn der WebSocket nicht öffnet", async () => {
    const log: string[] = [];
    class BrokenWS {
      onerror?: (e: any) => void;
      constructor() {
        setTimeout(() => this.onerror?.({ message: "blocked" }), 0);
      }
      close() {}
    }
    let polls = 0;
    const res = await collectSignalRPushes({
      baseUrl: "https://amc.example/amc/signalr",
      hub: "aMCHub",
      invocations: [{ method: "CLIC_ClientReady", args: ["WebClient"] }],
      isComplete: (p) => Array.isArray(p.SRVC_Areas),
      fetchImpl: fakeFetch(log, { poll: () => (++polls < 2 ? { C: "d-1", M: [] } : JSON.parse(AREAS_FRAME)) }),
      WebSocketImpl: BrokenWS,
    });
    assert.equal(res.transport, "longPolling");
    assert.ok(Array.isArray(res.pushes.SRVC_Areas));
    assert.deepEqual(
      log.filter((l) => !/abort/.test(l)),
      ["GET negotiate", "GET negotiate", "GET connect", "GET start", "POST send", "POST poll", "POST poll"],
    );
  });

  it("Zeitüberschreitung ohne Daten → Fehler mit Transport-Diagnose", async () => {
    class SilentWS {
      onopen?: () => void;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send() {}
      close() {}
    }
    await assert.rejects(
      collectSignalRPushes({
        baseUrl: "https://amc.example/amc/signalr",
        hub: "aMCHub",
        transports: ["webSockets"],
        collectTimeoutMs: 50,
        fetchImpl: fakeFetch([]),
        WebSocketImpl: SilentWS,
      }),
      /webSockets: WebSocket: Daten unvollständig/,
    );
  });
});
