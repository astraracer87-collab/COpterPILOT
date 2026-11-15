import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LV_GEOZONE_SOURCE_LABEL,
  LV_SUNRISE_SUNSET_NOTE,
  latvianApplicability,
  latvianIsSunriseSunsetZone,
  latvianMessage,
  latvianZoneExpired,
  normalizeLatvianZones,
} from "../../../shared/latvianGeozones";
import { finalizeDirectFeatures } from "../geozoneDirect/directFetchUtil";
import { parseEd269ToGeozoneInfo, ed269IsActiveAt } from "../ed269";
import { hasGermanFor } from "../../../shared/zoneTranslate";

// Gekürzter echter Export von drz.lv (UASZoneVersion_2026_11_13…), 9 Zonen.
const body = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "drz-lv-ed269-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");
const raw = (id: string) => body.features.find((z: any) => z.identifier === id);
const byId = (features: any[], id: string) => features.filter((f) => f.properties.identifier === id);

describe("Lettland (LGS / drz.lv) – ED-269", () => {
  const features = normalizeLatvianZones(body, NOW);

  it("Fixture ist Standard-ED-269", () => {
    assert.equal(body.features.length, 9);
    assert.ok(body.features.every((z: any) => z.country === "LVA" && Array.isArray(z.geometry)));
  });

  it("abgelaufene Zonen werden verworfen, übrige bleiben", () => {
    assert.equal(latvianZoneExpired(raw("0461312"), NOW), true); // GORGON4, Ende 13.11.2026
    assert.equal(byId(features, "0461312").length, 0);
    assert.equal(new Set(features.map((f) => f.properties.identifier)).size, 8);
    // Zonen ohne endDateTime gelten als unbefristet
    assert.equal(latvianZoneExpired(raw("4d93ad0"), NOW), false);
    // vor Ablauf noch vorhanden
    assert.equal(normalizeLatvianZones(body, new Date("2026-11-13T12:00:00Z")).some((f) => f.properties.identifier === "0461312"), true);
  });

  it("Restriktionen, Quelle, Höhen und Höhenbezug", () => {
    const counts: Record<string, number> = {};
    for (const f of features) counts[f.properties.restriction] = (counts[f.properties.restriction] ?? 0) + 1;
    assert.deepEqual(counts, { REQ_AUTHORISATION: 5, NO_RESTRICTION: 1, PROHIBITED: 1, CONDITIONAL: 1 });
    assert.ok(features.every((f) => f.properties.source === LV_GEOZONE_SOURCE_LABEL));
    const nbs = byId(features, "b2appgd")[0].properties;
    assert.equal(nbs.lowerMeters, 0);
    assert.equal(nbs.upperMeters, 300);
    assert.equal(nbs.lowerReference, "AGL");
    const biggy = byId(features, "26885c8")[0].properties; // obere Grenze AMSL
    assert.equal(biggy.upperReference, "AMSL");
  });

  it("mehrere geometry[] mit gleicher Höhe -> ein MultiPolygon, volle Präzision", () => {
    const z = raw("kHxxOPx");
    assert.equal(z.geometry.length, 5);
    const f = byId(features, "kHxxOPx");
    assert.equal(f.length, 1);
    assert.equal(f[0].geometry.type, "MultiPolygon");
    assert.equal((f[0].geometry.coordinates as any[]).length, 5);
    assert.deepEqual((f[0].geometry.coordinates as any[])[0], z.geometry[0].horizontalProjection.coordinates);
    assert.equal(f[0].properties.zoneId, "kHxxOPx");
  });

  it("unterschiedliche Höhenbänder in einer Zone -> getrennte Features", () => {
    const z = JSON.parse(JSON.stringify(raw("kHxxOPx")));
    z.geometry[1] = { ...z.geometry[1], lowerLimit: 40, upperLimit: 120, upperVerticalReference: "AMSL" };
    const f = normalizeLatvianZones({ features: [z] }, NOW);
    assert.equal(f.length, 2);
    const bands = f.map((x) => [x.properties.lowerMeters, x.properties.upperMeters, x.properties.upperReference]);
    assert.deepEqual(bands, [[0, 40, "AGL"], [40, 120, "AMSL"]]);
    assert.deepEqual(f.map((x) => x.properties.zoneId), ["kHxxOPx#1", "kHxxOPx#2"]);
    assert.equal(f[0].geometry.type, "MultiPolygon");
    assert.equal(f[1].geometry.type, "Polygon");
  });

  it("englischer Text (messageEng), lettisches Original bleibt erhalten", () => {
    const z = raw("b2appgd");
    assert.equal(latvianMessage(z), z.extendedProperties.messageEng);
    assert.equal(latvianMessage({ message: "Tikai latviski" }), "Tikai latviski");
    const p = byId(features, "b2appgd")[0].properties;
    assert.ok(p.message.startsWith("Flight authorisation must be obtained"));
    assert.ok(p.message.includes("Kontakt: 29333009 · droni@mil.lv"));
    assert.equal(p.messageLv, z.message);
    assert.equal(p.messageEn, z.extendedProperties.messageEng);
    assert.equal(p.zoneCountry, "LVA");
  });

  it("Sonnenaufgang–Sonnenuntergang (SR-SS)", () => {
    const z = raw("VRRKYpR");
    assert.equal(latvianIsSunriseSunsetZone(z), true);
    assert.equal(latvianIsSunriseSunsetZone(raw("b2appgd")), false);
    const app = latvianApplicability(z, NOW)!;
    assert.equal(app.length, 4);
    assert.ok(app.every((a) => a.schedule[0].startEvent === "SR" && a.schedule[0].endEvent === "SS"));
    // chronologisch sortiert
    assert.equal(app[0].startDateTime, "2026-10-25T01:00:00.00Z");
    const p = byId(features, "VRRKYpR")[0].properties;
    assert.equal(p.sunriseSunset, "SR-SS");
    assert.ok(p.message.includes(LV_SUNRISE_SUNSET_NOTE));
    assert.equal(hasGermanFor(LV_SUNRISE_SUNSET_NOTE), true);
    // konservativ: auch nachts aktiv
    assert.equal(ed269IsActiveAt(p, new Date("2026-12-01T23:00:00Z")), true);
  });

  it("konkrete Zeitpläne bleiben, siteUrl wird zu siteURL", () => {
    const sched = byId(features, "2c49773")[0].properties.applicability[0].schedule;
    assert.deepEqual(sched, raw("2c49773").applicability[0].schedule);
    const auth = byId(features, "8a54094")[0].properties.zoneAuthority[0];
    assert.equal(auth.siteURL, "https://rpp.riga.lv");
  });

  it("App-Darstellung (parseEd269ToGeozoneInfo) und Länder-Tagging", () => {
    const fin = finalizeDirectFeatures(JSON.parse(JSON.stringify(features)) as any, "lv");
    assert.ok(fin.every((f: any) => f.properties._country === "lv" && Array.isArray(f.bbox)));
    // Zonen ohne Ende -> unabhängig vom Testdatum sichtbar
    const unlimited = fin.filter((f: any) => ["8a54094", "4d93ad0", "2c49773"].includes(f.properties.identifier));
    const infos = parseEd269ToGeozoneInfo(unlimited, "LV");
    assert.equal(infos.length, 3);
    const vecaki = infos.find((i) => i.featureId === "8a54094")!;
    assert.equal(vecaki.restriction, "REQ_AUTHORISATION");
    assert.ok(vecaki.details.includes("Zuständige Stelle:"));
    assert.ok(vecaki.links?.some((l) => l.url === "https://rpp.riga.lv/"));
    const nakotne = infos.find((i) => i.featureId === "2c49773")!;
    assert.ok((nakotne.scheduleText ?? []).length > 0);
  });
});
