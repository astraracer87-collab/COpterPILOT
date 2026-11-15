// Malta online per Meteor-DDP (Zones.getFilteredZones({managedZones:true})).
// Nachgespielte DDP-Sitzung über eine WebSocket-Attrappe; die Zonen-Dokumente
// werden aus dem ECHTEN Export-Ausschnitt fixtures/mt_zones_sample.geojson
// gebaut (flightArea = Feature wie im Karten-Layer „operator-zones“).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  MT_DDP_METHOD,
  MT_DDP_ORIGIN,
  MT_DDP_URL,
  MaltaDdpError,
  ddpCall,
  loadMalta,
  maltaDdpResultToRawFeatures,
  maltaFeaturesFromDdpResult,
  type DdpSocket,
} from "../geozoneDirect/maltaSource";
import { ED269_FETCHERS } from "../geozoneDirect/ed269Sources";
import { getGeozoneSource } from "../geozoneSources/registry";
import { MT_GEOZONE_SOURCE_LABEL } from "../../../shared/malteseGeozones";
import { GEOZONE_IMPORT_ONLY_SOURCE_ISOS, ED269_FETCH_ISOS } from "../../../shared/geozoneSourceMeta";
import { parseEd269ToGeozoneInfo } from "../ed269";

const mtRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "mt_zones_sample.geojson"), "utf8"));

/** DDP-Ergebnis aus dem Export bauen: Dokument-Felder + flightArea-Feature. */
function ddpDocs(): any[] {
  const docs = mtRaw.features.map((f: any) => ({
    ...f.properties,
    flightArea: { type: "Feature", geometry: f.geometry, properties: { ...f.properties } },
  }));
  const g = mtRaw.features[0].geometry;
  // LUQA-Zone (Auto-Freigabe im Namen), nur _id, flightArea als Geometrie
  docs.push({
    _id: "luqa1",
    name: "LUQA Zone 3 - Auto Authorised maximum 30m AGL - contact atc@maltats.com",
    minHeight: 0,
    maxHeight: 400,
    type: 1,
    archived: false,
    flightArea: g,
  });
  // archivierte Zone entfällt
  docs.push({ zoneId: "old1", name: "Old", forbidden: 1, archived: true, flightArea: { type: "Feature", geometry: g, properties: {} } });
  // ohne Geometrie entfällt
  docs.push({ zoneId: "nogeo", name: "No geometry", forbidden: 0 });
  return docs;
}

type Script = (sock: MockSocket, sent: any) => void;

class MockSocket implements DdpSocket {
  onopen: ((ev?: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  onclose: ((ev?: any) => void) | null = null;
  sent: any[] = [];
  closed = false;
  constructor(public url: string, private script: Script) {
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string): void {
    const m = JSON.parse(data);
    this.sent.push(m);
    setTimeout(() => this.script(this, m), 0);
  }
  close(): void {
    this.closed = true;
  }
  push(m: unknown): void {
    this.onmessage?.({ data: typeof m === "string" ? m : JSON.stringify(m) });
  }
}

/** Server-Verhalten: connected → (ping) → result. */
function serverScript(result: { result?: unknown; error?: unknown }, opts: { ping?: boolean } = {}): Script {
  return (sock, m) => {
    if (m.msg === "connect") {
      sock.push({ server_id: "0" });
      sock.push({ msg: "connected", session: "abc" });
    } else if (m.msg === "method") {
      if (opts.ping) {
        sock.push({ msg: "ping", id: "p1" });
        return; // Ergebnis erst nach dem Pong
      }
      sock.push({ msg: "updated", methods: ["1"] });
      sock.push({ msg: "result", id: m.id, ...result });
    } else if (m.msg === "pong") {
      sock.push({ msg: "result", id: "1", ...result });
    }
  };
}

function factory(script: Script) {
  const sockets: MockSocket[] = [];
  return {
    sockets,
    socketFactory: (url: string) => {
      const s = new MockSocket(url, script);
      sockets.push(s);
      return s;
    },
  };
}

describe("Malta DDP – Protokoll", () => {
  it("connect → method → result; Verbindung wird geschlossen", async () => {
    const f = factory(serverScript({ result: ddpDocs() }));
    const result = await ddpCall(MT_DDP_METHOD, [{ managedZones: true }], { socketFactory: f.socketFactory });
    assert.equal(result.length, 5);
    const s = f.sockets[0];
    assert.equal(s.url, MT_DDP_URL);
    assert.deepEqual(s.sent[0], { msg: "connect", version: "1", support: ["1", "pre2", "pre1"] });
    assert.deepEqual(s.sent[1], { msg: "method", method: "Zones.getFilteredZones", params: [{ managedZones: true }], id: "1" });
    assert.equal(s.closed, true);
  });

  it("Ping wird mit Pong (gleiche id) beantwortet", async () => {
    const f = factory(serverScript({ result: [] }, { ping: true }));
    await ddpCall(MT_DDP_METHOD, [{ managedZones: true }], { socketFactory: f.socketFactory });
    assert.deepEqual(f.sockets[0].sent[2], { msg: "pong", id: "p1" });
  });

  it("Methodenfehler („no access“) → MaltaDdpError mit Grund", async () => {
    const f = factory(serverScript({ error: { error: 403, reason: "You have no access to the zones for this company" } }));
    await assert.rejects(
      ddpCall(MT_DDP_METHOD, [{ managedZones: true }], { socketFactory: f.socketFactory }),
      (e: any) => e instanceof MaltaDdpError && /no access/.test(e.message) && /Datei-Import nutzen/.test(e.message),
    );
  });

  it("keine Antwort → Zeitüberschreitung, Verbindung geschlossen", async () => {
    const f = factory(() => {});
    await assert.rejects(
      ddpCall(MT_DDP_METHOD, [{}], { socketFactory: f.socketFactory, timeoutMs: 30 }),
      (e: any) => e instanceof MaltaDdpError && /Zeitüberschreitung/.test(e.message),
    );
    assert.equal(f.sockets[0].closed, true);
  });

  it("Verbindungsabbruch vor dem Ergebnis → Fehler", async () => {
    const f = factory((sock) => sock.onclose?.({ code: 1006 }));
    await assert.rejects(ddpCall(MT_DDP_METHOD, [{}], { socketFactory: f.socketFactory }), /1006/);
  });

  it("Standard-Fabrik setzt den Origin-Header (RN: 3. Argument headers)", async () => {
    const calls: any[] = [];
    const orig = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = function (this: any, url: string, protocols: unknown, options: unknown) {
      calls.push({ url, protocols, options });
      return new MockSocket(url, serverScript({ result: ddpDocs() }));
    };
    try {
      const features = await loadMalta();
      assert.equal(features.length, 3);
    } finally {
      (globalThis as any).WebSocket = orig;
    }
    assert.deepEqual(calls[0].options, { headers: { Origin: MT_DDP_ORIGIN } });
  });
});

describe("Malta DDP – Zonen", () => {
  it("Dokumente → Roh-Features (zoneId ersatzweise aus _id, flightArea-Geometrie)", () => {
    const raw = maltaDdpResultToRawFeatures(ddpDocs());
    assert.equal(raw.length, 4); // ohne Geometrie entfällt hier, archiviert erst im Normalisierer
    assert.equal(raw[2].properties.zoneId, "luqa1");
    assert.equal(raw[2].geometry.type, "Polygon");
  });

  it("Normalisierung über shared/malteseGeozones.ts (origin online)", async () => {
    const f = factory(serverScript({ result: ddpDocs() }));
    const features = await loadMalta({ socketFactory: f.socketFactory });
    assert.equal(features.length, 3);
    const byId = Object.fromEntries(features.map((x: any) => [x.properties.zoneId, x.properties]));
    const victoria = byId["MT-BNtjEqFyvU2BOxsUGtXrBksm"];
    assert.equal(victoria.restriction, "PROHIBITED");
    assert.equal(victoria.source, MT_GEOZONE_SOURCE_LABEL);
    assert.equal(victoria.mtOnline, true);
    assert.equal(victoria.mtImportVariant, undefined);
    assert.equal(victoria.contactEmail, "carmen.ogilvie-galea@gov.mt");
    assert.match(victoria.message, /Kontakt: .*für Genehmigungsanfragen/);
    assert.match(victoria.message, /\(online\)/);
    // maxHeight = Luftraumdecke (Info), keine Obergrenze
    assert.equal(victoria.airspaceCeilingFt, 60);
    assert.equal(victoria.upperMeters, undefined);
    const luqa = byId["MT-luqa1"];
    assert.equal(luqa.restriction, "REQ_AUTHORISATION");
    assert.equal(luqa.auto_limit_m, 30);
    assert.match(luqa.message, /Auto-Freigabe bis 30 m AGL/);
    assert.ok(features.every((x: any) => x.properties._country === "mt" || x.bbox));
    // App liest die Zonen
    const infos = parseEd269ToGeozoneInfo(features, "mt");
    assert.equal(infos.length, 3);
    assert.equal(infos[0].maxFlightHeightAglM, undefined);
  });

  it("leeres Ergebnis → Fehler (gespeicherter Bestand/Import bleibt)", async () => {
    const f = factory(serverScript({ result: [] }));
    await assert.rejects(loadMalta({ socketFactory: f.socketFactory }), /keine Zonen/);
    assert.equal(maltaFeaturesFromDdpResult(null).length, 0);
  });
});

describe("Malta – Registry", () => {
  it("MT ist Online-Vektorquelle (ed269-store), kein Import-Gate; Import bleibt Rückfall", () => {
    const s = getGeozoneSource("MT")!;
    assert.equal(s.kind, "ed269-vector");
    assert.equal(s.offline, "ed269-store");
    assert.equal(s.accessGate, undefined);
    assert.equal(s.fetch, ED269_FETCHERS.MT);
    assert.ok(ED269_FETCH_ISOS.includes("MT"));
    assert.ok(!GEOZONE_IMPORT_ONLY_SOURCE_ISOS.includes("MT"));
    assert.match(s.note ?? "", /Kontakt-E-Mails/);
    assert.equal(s.sourceLabel, "Transport Malta / iDronect");
  });
});
