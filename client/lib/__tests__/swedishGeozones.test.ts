import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  SE_GEOZONE_SOURCE_LABEL,
  SE_WFS_LAYERS,
  englishPartOfSvEn,
  isoDurationText,
  isSwedishMilitaryCtr,
  normalizeEd318Collection,
  normalizeSwedishWfsFeatures,
  parseSwedishAltitude,
  seNotamIsAirspaceRestriction,
  seWfsRestriction,
  textSaysProhibited,
  ed318IssuedDateDe,
} from "../../../shared/swedishGeozones";
import { SE_ED318_FALLBACK_URL, SE_ED318_URL, fetchSwedenEd318, swedenWfsUrl } from "../geozoneDirect/swedenSource";
import { parseEd269ToGeozoneInfo, ed269IsActiveAt } from "../ed269";

// Gekürzte echte Daten (abgerufen 2026-11-15, CC BY 4.0 LFV/Transportstyrelsen).
const FIX = path.join(__dirname, "fixtures");
const ed318 = JSON.parse(fs.readFileSync(path.join(FIX, "se-ed318-sample.json"), "utf8"));
const wfs = JSON.parse(fs.readFileSync(path.join(FIX, "se-wfs-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");

const byId = (features: any[], id: string) => features.find((f) => f.properties.identifier === id);

describe("Schweden – Höhenangaben", () => {
  it("GND/SFC/UNL", () => {
    assert.deepEqual(parseSwedishAltitude("GND"), { meters: 0, reference: "AGL", text: "GND" });
    assert.equal(parseSwedishAltitude("SFC")?.meters, 0);
    const unl = parseSwedishAltitude("UNL");
    assert.equal(unl?.meters, undefined);
    assert.equal(unl?.unlimited, true);
  });
  it("Flugflächen mit und ohne Leerzeichen", () => {
    assert.equal(parseSwedishAltitude("FL 85")?.meters, 2590.8);
    assert.equal(parseSwedishAltitude("FL85")?.reference, "MSL");
    assert.equal(parseSwedishAltitude("FL520")?.meters, 15849.6);
  });
  it("Zahl ohne Einheit = ft AMSL", () => {
    const a = parseSwedishAltitude("2500");
    assert.equal(a?.meters, 762);
    assert.equal(a?.reference, "MSL");
    assert.equal(a?.text, "2500 ft AMSL");
  });
  it("NOTAM- und SUP-Schreibweisen", () => {
    assert.deepEqual(parseSwedishAltitude("260FT AGL"), { meters: 79.2, reference: "AGL", text: "260FT AGL" });
    assert.equal(parseSwedishAltitude("1200FT AMSL")?.reference, "MSL");
    assert.equal(parseSwedishAltitude("260", "ft SFC")?.reference, "AGL");
    assert.equal(parseSwedishAltitude("1200", "ft AMSL")?.meters, 365.8);
    assert.equal(parseSwedishAltitude("150 M AGL")?.meters, 150);
    assert.equal(parseSwedishAltitude("Kein Wert"), null);
    assert.equal(parseSwedishAltitude(null), null);
  });
});

describe("Schweden – Hilfsfunktionen", () => {
  it("Dauer, Verbotstext, sv/en-Kommentar", () => {
    assert.equal(isoDurationText("P14DT00H00M"), "14 Tage");
    assert.equal(isoDurationText("P00DT24H00M"), "24 Std.");
    assert.equal(textSaysProhibited("Flight within the area prohibited for all non-participating aircraft."), true);
    assert.equal(textSaysProhibited("Drönarflygning är förbjuden."), true);
    assert.equal(textSaysProhibited("UAS flying is not prohibited"), false);
    assert.equal(englishPartOfSvEn("Fågelreservat.\n\nBird sanctuary."), "Bird sanctuary.");
  });
  it("NOTAM-Filter wie Drönarkartan", () => {
    assert.equal(seNotamIsAirspaceRestriction({ CODE23: "RT", CODE45: "CA", TYPE: "N" }), true);
    assert.equal(seNotamIsAirspaceRestriction({ CODE23: "WO", CODE45: "LW", TYPE: "N" }), true);
    assert.equal(seNotamIsAirspaceRestriction({ CODE23: "RT", CODE45: "TT", TYPE: "N" }), false);
    assert.equal(seNotamIsAirspaceRestriction({ CODE23: "RD", CODE45: "AW", TYPE: "N" }), false);
    assert.equal(seNotamIsAirspaceRestriction({ CODE23: "ST", CODE45: "AH", TYPE: "N" }), false);
    assert.equal(seNotamIsAirspaceRestriction({ CODE23: "RT", CODE45: "CA", TYPE: "C" }), false);
  });
  it("WFS-typeNames inkl. nicht gelistetem NOTAM-Layer", () => {
    assert.deepEqual(
      SE_WFS_LAYERS.map((l) => l.typeName),
      ["mais:CTR", "mais:TIZ", "mais:ATZ", "DAIM_TOPO:RWY5K", "DAIM_TOPO:HKP1K", "mais:RSTA", "mais:DNGA", "DAIM_TOPO:SUP", "dynais:NOTAM"],
    );
    const u = new URL(swedenWfsUrl("mais:CTR", { count: 2000 }));
    assert.equal(u.searchParams.get("typename"), "mais:CTR");
    assert.equal(u.searchParams.get("srsname"), "EPSG:4326");
    assert.equal(u.searchParams.get("outputFormat"), "application/json");
    assert.equal(u.searchParams.get("maxFeatures"), "2000");
  });
});

describe("Schweden – ED-318 (Transportstyrelsen)", () => {
  const feats = normalizeEd318Collection(ed318, NOW);

  it("abgelaufene Zonen entfallen, übrige bleiben", () => {
    assert.equal(byId(feats, "ESU279"), undefined); // Ende 2026-11-13
    assert.ok(byId(feats, "ESU200"));
    assert.ok(byId(feats, "ESU218")); // künftige Zone bleibt
  });

  it("Kreis (Point + extent) wird Polygon, Texte englisch + deutsche Kurzfassung", () => {
    const f = byId(feats, "ESU200");
    assert.equal(f.geometry.type, "Polygon");
    assert.equal(f.geometry.coordinates[0].length, 49);
    const p = f.properties;
    assert.equal(p.restriction, "REQ_AUTHORISATION");
    assert.equal(p.name, "Stornorrforsen hydro power plant");
    assert.equal(p.nameLocal, "Stornorrforsen kraftverk");
    assert.equal(p.reason, "Sensibles Objekt");
    assert.match(p.message, /^Flug nur mit Genehmigung\. Genehmigung bei Swedish Transport Agency \(mind\. 14 Tage vorher beantragen\)/);
    assert.match(p.message, /Vattenfall \(7 Tage vorher\)/);
    assert.match(p.message, /Access prohibited\. Special permission/);
    assert.match(p.message, /Exempted operators shall/);
    assert.doesNotMatch(p.message, /SE: Undantagna/);
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.upperMeters, 150);
    assert.equal(p.upperReference, "AGL");
    assert.equal(p.applicability, undefined); // nur vergangener Start → dauerhaft
    assert.equal(p.contactEmail, "luftfart@transportstyrelsen.se");
    assert.equal(p.zoneAuthority[0].name, "Swedish Transport Agency");
    assert.equal(p.zoneAuthority[0].email, undefined);
    assert.equal(p.source, SE_GEOZONE_SOURCE_LABEL);
  });

  it("Höhe in ft AMSL, Radius 1852 m", () => {
    const p = byId(feats, "ESU209").properties;
    assert.equal(p.upperMeters, 457.2);
    assert.equal(p.upperReference, "MSL");
    assert.equal(p.lowerReference, "AGL");
  });

  it("Untergrenze über Grund (80–120 m AGL)", () => {
    const p = byId(feats, "ESU271").properties;
    assert.equal(p.lowerMeters, 80);
    assert.equal(p.upperMeters, 120);
  });

  it("Wochenzeitplan bleibt als ED-269-applicability erhalten", () => {
    const p = byId(feats, "ESU210").properties;
    assert.equal(p.applicability.length, 1);
    // fünf Einzeltage mit gleicher Uhrzeit → ein Eintrag Mo–Fr
    assert.equal(p.applicability[0].schedule.length, 1);
    assert.deepEqual(p.applicability[0].schedule[0].day, ["MON", "TUE", "WED", "THU", "FRI"]);
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-16T10:00:00Z")), true); // Montag
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-15T10:00:00Z")), false); // Sonntag
  });

  it("Fotografierverbot und CONDITIONAL", () => {
    const p = byId(feats, "ESU218").properties;
    assert.equal(p.restriction, "CONDITIONAL");
    assert.match(p.message, /Fotografieren\/Filmen verboten/);
  });

  it("parseEd269ToGeozoneInfo versteht das Ergebnis", () => {
    const zones = parseEd269ToGeozoneInfo(feats, "se", NOW.getTime());
    const z = zones.find((x) => x.featureId === "SE-ESU200");
    assert.ok(z);
    assert.equal(z!.restriction, "REQ_AUTHORISATION");
    assert.equal(z!.upperMeters, 150);
    assert.match(z!.details, /Zuständige Stelle: Swedish Transport Agency/);
    assert.ok(z!.links?.some((l) => l.url === "mailto:luftfart@transportstyrelsen.se"));
    const sched = zones.find((x) => x.featureId === "SE-ESU210");
    assert.deepEqual(sched?.scheduleText, ["Mo–Fr · 06:00–21:00 UTC"]);
  });
});

describe("Schweden – WFS-Luftraum (LFV)", () => {
  const all = SE_WFS_LAYERS.flatMap(({ layer }) => normalizeSwedishWfsFeatures(layer, wfs[layer], NOW));
  const ofLayer = (l: string) => all.filter((f) => f.properties.sourceLayer === l);

  it("CTR: CONDITIONAL mit 50 m bzw. 10 m (militärisch), Sektor-Namen", () => {
    const ctr = ofLayer("CTR");
    assert.equal(ctr.length, 4);
    assert.ok(ctr.every((f) => f.properties.restriction === "CONDITIONAL"));
    const sundsvall = byId(ctr, "SUNDSVALL CTR").properties;
    assert.equal(sundsvall.upperMeters, 762);
    assert.equal(sundsvall.upperReference, "MSL");
    assert.equal(sundsvall.openCategoryMaxAglMeters, 50);
    assert.equal(byId(ctr, "MALMEN CTR").properties.openCategoryMaxAglMeters, 10);
    const names = ctr.map((f) => f.properties.name).sort();
    assert.deepEqual(names, ["MALMEN CTR", "SAAB CTR Sector a", "SUNDSVALL CTR", "SÄLEN CTR Sector a"]);
    assert.equal(ctr.find((f) => f.properties.name === "SAAB CTR Sector a")!.properties.militaryCtr, true);
    assert.equal(ctr.find((f) => f.properties.name === "SÄLEN CTR Sector a")!.properties.militaryCtr, false);
    assert.equal(isSwedishMilitaryCtr({ NAMEOFAREA: "Sector b", POSITIONINDICATOR: "ESSL" }), true);
  });

  it("RWY5K Genehmigung, HKP1K Auflagen, Geometrie in voller Genauigkeit", () => {
    const rwy = ofLayer("RWY5K")[0];
    assert.equal(rwy.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(rwy.properties.zoneId, "SE-RWY5K-ESST");
    assert.equal(rwy.properties.upperMeters, undefined);
    const hkp = ofLayer("HKP1K")[0];
    assert.equal(hkp.properties.restriction, "CONDITIONAL");
    assert.match(hkp.properties.name, /SKELLEFTEÅ LASARETT/);
    const rawPts = JSON.stringify(wfs.HKP1K[0].geometry.coordinates).split("],[").length;
    const pts = JSON.stringify(hkp.geometry.coordinates).split("],[").length;
    assert.equal(pts, rawPts, `volle Genauigkeit: ${rawPts} → ${pts}`);
  });

  it("R-Gebiete: RESTRICTED, verbotene als PROHIBITED, hohe Untergrenze verworfen", () => {
    const r = ofLayer("RSTA");
    assert.equal(byId(r, "ES R31").properties.restriction, "RESTRICTED");
    assert.equal(byId(r, "ES R31").properties.upperMeters, 2590.8);
    assert.match(byId(r, "ES R31").properties.message, /Bird sanctuary/);
    assert.equal(byId(r, "ES R113").properties.restriction, "PROHIBITED");
    assert.equal(byId(r, "ES R25"), undefined); // LOWER 3000 ft
    const unl = byId(r, "ES R33").properties;
    assert.equal(unl.upperMeters, undefined);
    assert.equal(seWfsRestriction("DNGA", {}), "CONDITIONAL");
    assert.equal(ofLayer("DNGA")[0].properties.restriction, "CONDITIONAL");
  });

  it("AIP SUP: Gültigkeit, ESD = CONDITIONAL, abgelaufen/zu hoch entfällt", () => {
    const sup = ofLayer("SUP");
    const ids = sup.map((f) => f.properties.identifier).sort();
    assert.deepEqual(ids, ["ESD653", "ESD891", "ESR34", "ESR833"]); // ESR576 abgelaufen, ESD311 ab FL520
    const r833 = byId(sup, "ESR833").properties;
    assert.equal(r833.restriction, "RESTRICTED");
    assert.equal(r833.applicability[0].startDateTime, "2025-11-10T06:00:00.000Z");
    assert.equal(r833.applicability[0].endDateTime, "2027-08-31T21:00:00.000Z");
    assert.match(r833.applicability[0].schedule[0], /MON – FRI 0600 – 2100/);
    assert.equal(r833._notamEligible, true);
    assert.match(r833.infoUrl, /^https:\/\/aro\.lfv\.se\//);
    assert.equal(byId(sup, "ESR34").properties.restriction, "PROHIBITED");
    assert.equal(byId(sup, "ESD891").properties.restriction, "CONDITIONAL");
    const d653 = byId(sup, "ESD653").properties;
    assert.equal(d653.lowerMeters, 79.2);
    assert.equal(d653.lowerReference, "AGL");
  });

  it("AIP SUP: mehrere Aktivierungszeiträume derselben Geometrie werden zusammengeführt", () => {
    // Abgeleitet aus einem echten Feature: zweiter Zeitraum mit eigener ID.
    const a = wfs.SUP.find((f: any) => f.properties.ID === "ESR833_1");
    const b = JSON.parse(JSON.stringify(a));
    b.properties.ID = "ESR833_2";
    b.properties.FROM = "2027-09-01T06:00Z";
    b.properties.TO = "2027-09-30T21:00Z";
    const out = normalizeSwedishWfsFeatures("SUP", [a, b], NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].properties.applicability.length, 2);
  });

  it("NOTAM: nur Luftraumbeschränkungen, Einstufung nach Text/Q-Code", () => {
    const n = ofLayer("NOTAM");
    assert.deepEqual(n.map((f) => f.properties.notamQCode).sort(), ["QRDCA", "QRRCH", "QRTCA", "QWOLW"]);
    const rt = n.find((f) => f.properties.notamQCode === "QRTCA")!.properties;
    assert.equal(rt.restriction, "PROHIBITED");
    assert.equal(rt.isNotam, true);
    assert.equal(rt.applicability[0].startDateTime, "2026-11-18T08:00:00.000Z");
    assert.equal(rt.applicability[0].endDateTime, "2026-11-19T21:00:00.000Z");
    assert.equal(rt.upperMeters, 365.8);
    assert.equal(n.find((f) => f.properties.notamQCode === "QRDCA")!.properties.restriction, "CONDITIONAL");
    assert.equal(n.find((f) => f.properties.notamQCode === "QWOLW")!.properties.restriction, "CONDITIONAL");
    assert.equal(n.find((f) => f.properties.notamQCode === "QRRCH")!.properties.restriction, "REQ_AUTHORISATION");
  });

  it("parseEd269ToGeozoneInfo: NOTAM-fähig, Höhe, Zeitplan", () => {
    const zones = parseEd269ToGeozoneInfo(all, "se", NOW.getTime());
    const notam = zones.find((z) => z.name.startsWith("NOTAM A1258"));
    assert.ok(notam);
    assert.equal(notam!.notamEligible, true);
    assert.equal(notam!.restriction, "PROHIBITED");
    assert.equal(notam!.validEndTs, Date.parse("2026-11-19T21:00:00Z"));
    assert.deepEqual(notam!.scheduleText, ["18-19 0800-2100"]);
    const ctr = zones.find((z) => z.name === "SUNDSVALL CTR");
    assert.equal(ctr!.lowerReference, "AGL");
    assert.match(ctr!.details, /unter 50 m über Grund/);
    const sup = zones.find((z) => z.name.startsWith("ESR833"));
    assert.ok(sup!.links?.some((l) => l.label === "AIP SUP öffnen"));
  });
});

describe("Schweden – ED-318: Datenstand und zweite Adresse", () => {
  it("Quellenzeile zeigt das Datum aus metadata.issued", () => {
    assert.equal(ed318IssuedDateDe(ed318), "29.10.2026");
    const feats = normalizeEd318Collection(ed318, new Date("2026-11-15T12:00:00Z"));
    assert.ok(feats.length > 0);
    for (const f of feats) {
      assert.match(f.properties.message, /Quelle: LFV Drönarkartan \/ Transportstyrelsen \(ED-318, Datenstand 29\.10\.2026\), CC BY 4\.0\./);
      assert.equal(f.properties.datasetIssued, "2026-10-29T00:00:00Z");
    }
    const noMeta = normalizeEd318Collection({ ...ed318, metadata: undefined }, new Date("2026-11-15T12:00:00Z"));
    assert.match(noMeta[0].properties.message, /\(ED-318\), CC BY 4\.0\./);
  });

  it("dronechart.lfv.se fällt aus → daim.lfv.se", async () => {
    const calls: string[] = [];
    const body = await fetchSwedenEd318(async (url) => {
      calls.push(url);
      if (url === SE_ED318_URL) throw new Error("HTTP 503");
      return ed318;
    });
    assert.deepEqual(calls, [SE_ED318_URL, SE_ED318_FALLBACK_URL]);
    assert.equal(body, ed318);
    assert.equal(SE_ED318_FALLBACK_URL, "https://daim.lfv.se/echarts/dronechart/data/uas_zones_ED318.json");
  });
});
