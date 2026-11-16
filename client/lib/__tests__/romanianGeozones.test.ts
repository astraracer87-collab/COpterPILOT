// Rumänien (ROMATSA): statische Zonen + NOTAM-UAV – mit ECHTEN Ausschnitten
// (DE-IP, 2026-11-15): fixtures/ro_zones_sample.geojson, ro_notam_sample.geojson.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  RO_STATIC_ZONES_URL,
  normalizeRomanianGeozones,
  parseRoContact,
  parseRoHeight,
  parseRoNotamSchedule,
  parseRoNotamText,
  roNotamRestriction,
  roNotamWfsUrl,
  roStatusRestriction,
} from "../../../shared/romanianGeozones";
import { loadRomania, RO_UNREACHABLE_MESSAGE } from "../geozoneDirect/romaniaSource";
import { parseEd269ToGeozoneInfo, zoneActivityAt } from "../ed269";
import { isTemporaryGeozoneProps } from "../../../shared/geozoneTemporary";
import { getGeozoneSourceMeta, temporarySourceOf } from "../../../shared/geozoneSourceMeta";
import { hasOwnMap } from "../../../shared/countryDetection";
import { ED269_FETCHERS } from "../geozoneDirect/ed269Sources";
import { canImportEd269Dataset } from "../geozoneDirect/ed269Store";
import { parseGeozoneImport } from "../../../shared/geozoneImport";

const FIX = path.join(__dirname, "fixtures");
const zones = JSON.parse(fs.readFileSync(path.join(FIX, "ro_zones_sample.geojson"), "utf8"));
const notams = JSON.parse(fs.readFileSync(path.join(FIX, "ro_notam_sample.geojson"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");

describe("Rumänien – Bausteine", () => {
  it("Höhen (GND, 120M AGL, 2500FT AMSL, FL065)", () => {
    assert.equal(parseRoHeight("GND")?.m, 0);
    assert.deepEqual([parseRoHeight("120M AGL")?.m, parseRoHeight("120M AGL")?.ref], [120, "AGL"]);
    const ft = parseRoHeight("2500FT AMSL")!;
    assert.deepEqual([Math.round(ft.m!), ft.ref], [762, "MSL"]);
    assert.equal(Math.round(parseRoHeight("FL065")!.m!), 1981);
    assert.equal(parseRoHeight(""), null);
  });

  it("Status/tip → Beschränkung (Doku-Tabelle)", () => {
    assert.deepEqual(roStatusRestriction("RESTRICTED"), { restriction: "REQ_AUTHORISATION", assumed: false });
    assert.deepEqual(roStatusRestriction("PROHIBITED"), { restriction: "PROHIBITED", assumed: false });
    assert.deepEqual(roStatusRestriction("XYZ"), { restriction: "REQ_AUTHORISATION", assumed: true });
    assert.equal(roNotamRestriction("R"), "RESTRICTED");
    assert.equal(roNotamRestriction("P"), "PROHIBITED");
    assert.equal(roNotamRestriction("D"), "CONDITIONAL");
  });

  it("Kontaktfeld: Telefon, E-Mail, angeklebter englischer Hinweis → Deutsch", () => {
    const c = parseRoContact(zones.features[1].properties.contact);
    assert.deepEqual(c.phones, ["+40257 255 706", "+40734 222 926"]);
    assert.deepEqual(c.emails, ["twr.arad@romatsa.ro"]);
    assert.equal(c.org, "ROMATSA");
    assert.match(c.noteDe, /^Für Flüge bis 120 m AGL in dieser Zone müssen Drohnenpiloten den Tower \(TWR\)/);
  });

  it("NOTAM-Text: Felder Q–G, Zeitplan DAILY", () => {
    const p = parseRoNotamText(notams.features[0].properties.mesaj);
    assert.equal(p.a, "LRBB");
    assert.equal(p.d, "DAILY 1730-0530");
    assert.equal(p.f, "GND");
    assert.equal(p.g, "FL065");
    assert.match(p.e!, /^TEMPORARY RESTRICTED AREA FOR IFR, VFR AND UNMANNED ACFT FLT/);
    assert.deepEqual(parseRoNotamSchedule(p.d), [{ day: ["ANY"], startTime: "17:30Z", endTime: "05:30Z" }]);
    assert.equal(parseRoNotamSchedule("MON-FRI 0800-1600"), null);
  });

  it("URLs", () => {
    assert.equal(RO_STATIC_ZONES_URL, "https://flightplan.romatsa.ro/init/static/zone_restrictionate_uav.json");
    assert.equal(
      roNotamWfsUrl(),
      "https://flightplan.romatsa.ro/init/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=carto%3Arestrictii_notam_pt_uav&maxFeatures=5000&outputFormat=application%2Fjson",
    );
  });
});

describe("Rumänien – echte Fixtures → Zonen", () => {
  const { features, staticCount, notamCount } = normalizeRomanianGeozones(zones, notams, NOW);
  const byId = (id: string) => features.find((f) => f.properties.identifier === id)!;

  it("2 statische + 2 NOTAM-Zonen", () => {
    assert.equal(staticCount, 2);
    assert.equal(notamCount, 2);
  });

  it("RZ 1001: RESTRICTED → Genehmigung, GND–120 m AGL, deutsche Meldung + Original", () => {
    const p = byId("RZ 1001").properties;
    assert.equal(p.restriction, "REQ_AUTHORISATION");
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.upperMeters, 120);
    assert.equal(p.upperReference, "AGL");
    assert.equal(p.contactEmail, "twr.arad@romatsa.ro");
    assert.match(p.message, /^ROMATSA-Drohnenzone RZ 1001 · Status RESTRICTED\nFlug nur nach Genehmigung/);
    assert.match(p.message, /Höhe laut ROMATSA: GND bis 120 m AGL\./);
    assert.match(p.message, /Originaltext der Behörde:\nROMATSA \+40257/);
    assert.equal(p.extendedProperties.localizedMessages[0].language, "de");
    assert.equal(isTemporaryGeozoneProps(p, "RO"), false);
  });

  it("RZ 1002: Untergrenze 120 m AGL, Obergrenze 2500 ft AMSL, Hinweis übersetzt", () => {
    const p = byId("RZ 1002").properties;
    assert.equal(p.lowerMeters, 120);
    assert.equal(p.lowerReference, "AGL");
    assert.equal(p.upperMeters, 762);
    assert.equal(p.upperReference, "MSL");
    assert.match(p.message, /Für Flüge bis 120 m AGL in dieser Zone müssen Drohnenpiloten den Tower/);
  });

  it("NOTAM R5607/2026: temporär, Gültigkeit dfrom/dto, täglich 17:30–05:30 UTC, GND–FL65", () => {
    const p = byId("R5607/2026").properties;
    assert.equal(p.restriction, "RESTRICTED");
    assert.equal(p.isNotam, true);
    assert.deepEqual(p.applicability, [
      { permanent: "NO", startDateTime: "2026-10-31T17:30:00.000Z", endDateTime: "2026-11-30T05:30:00.000Z", schedule: [{ day: ["ANY"], startTime: "17:30Z", endTime: "05:30Z" }] },
    ]);
    assert.equal(p.upperMeters, 1981.2);
    assert.equal(isTemporaryGeozoneProps(p, "RO"), true);
    assert.match(p.message, /Temporäres Beschränkungsgebiet für IFR-, VFR- und unbemannte Flüge \(Drohnen\)\./);
    assert.match(p.message, /Originaltext der Behörde:\n\(R5607\/26 NOTAMN\nQ\) LRBB/);
  });

  it("App-Modell: NOTAM aktiv nur im Tagesfenster", () => {
    const infos = parseEd269ToGeozoneInfo(features as any[], "RO", NOW.getTime());
    assert.equal(infos.length, 4);
    const n = infos.find((z) => z.name === "NOTAM R5607/2026")!;
    assert.equal(zoneActivityAt(n, new Date("2026-11-15T12:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(n, new Date("2026-11-15T20:00:00Z")), "active");
    assert.equal(n.notamEligible, true);
  });

  it("abgelaufene NOTAMs entfallen", () => {
    const r = normalizeRomanianGeozones(zones, notams, new Date("2027-01-01T00:00:00Z"));
    assert.equal(r.notamCount, 0);
    assert.equal(r.staticCount, 2);
  });
});

describe("Rumänien – Abruf & Registry", () => {
  afterEach(() => {});

  it("Registry: Vektor-Land mit Abruf, kein Zugangs-Gate, Import weiter erlaubt", () => {
    const m = getGeozoneSourceMeta("RO")!;
    assert.equal(m.kind, "ed269-vector");
    assert.equal(m.accessGate, undefined);
    assert.equal(typeof ED269_FETCHERS.RO, "function");
    assert.equal(hasOwnMap("RO"), true);
    assert.equal(temporarySourceOf("RO"), "dataset");
    assert.equal(canImportEd269Dataset("RO"), true);
  });

  it("loadRomania: beide Quellen, NOTAM-Fehler tolerant, Server-Fehler → klare Meldung", async () => {
    const urls: string[] = [];
    const ok = await loadRomania(async (url: string) => {
      urls.push(url);
      return url.includes("geoserver") ? notams : zones;
    }, NOW);
    assert.equal(ok.length, 4);
    assert.ok(ok.every((f) => f.properties._country === "ro" && Array.isArray(f.bbox)));
    assert.equal(urls.length, 2);

    const noNotam = await loadRomania(async (url: string) => {
      if (url.includes("geoserver")) throw new Error("HTTP 503");
      return zones;
    }, NOW);
    assert.equal(noNotam.length, 2);

    await assert.rejects(
      loadRomania(async () => {
        throw new Error("SSL handshake failed");
      }, NOW),
      (e: Error) => e.message.startsWith(RO_UNREACHABLE_MESSAGE) && /SSL handshake/.test(e.message),
    );
    assert.equal(RO_UNREACHABLE_MESSAGE, "ROMATSA nicht erreichbar – Datei-Import nutzen");
  });

  it("Datei-Import der ROMATSA-Datei (Rückfall) nutzt denselben Normalisierer; falsches Land wird abgelehnt", () => {
    const r = parseGeozoneImport(zones, { iso: "RO", now: NOW });
    assert.equal(r.format, "ro-romatsa");
    assert.equal(r.features.length, 2);
    assert.equal(r.features[0].properties.restriction, "REQ_AUTHORISATION");
    const n = parseGeozoneImport(notams, { iso: "RO", now: NOW });
    assert.equal(n.features.length, 2);
    assert.equal(n.features[0].properties.isNotam, true);
    assert.throws(() => parseGeozoneImport(zones, { iso: "MT", now: NOW }), /für Rumänien – bitte beim Land Rumänien importieren/);
  });
});
