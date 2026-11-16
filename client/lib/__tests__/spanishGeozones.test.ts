import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ES_GEOZONE_ATTRIBUTION,
  ES_GEOZONE_SOURCE_LABEL,
  esArcgisPage,
  esAttributeReader,
  esDateIso,
  esDays,
  esEnsureLonLat,
  esReasonText,
  esRestriction,
  esTimeUtc,
  normalizeSpanishFeatures,
  parseEsAltitude,
  type EsRawFeature,
} from "../../../shared/spanishGeozones";
import { parseEd269ToGeozoneInfo, ed269IsActiveAt } from "../ed269";

// Handgebaute Fixtures nach ENAIRE-Spec v3.1 (servais.enaire.es aus der
// Sandbox per WAF gesperrt) – Feldnamen exakt wie in der Doku §4.
const FIX = path.join(__dirname, "fixtures");
const arc = JSON.parse(fs.readFileSync(path.join(FIX, "es-enaire-arcgis-sample.json"), "utf8"));
const wfs = JSON.parse(fs.readFileSync(path.join(FIX, "es-enaire-wfs-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T12:00:00Z");

const byId = (features: any[], id: string) => features.find((f) => f.properties.identifier === id);
const raw = (layer: EsRawFeature["layer"], fc: any): EsRawFeature[] => fc.features.map((feature: any) => ({ layer, feature }));
const allArcgisRaw = (): EsRawFeature[] => [
  ...raw("ZGUAS_Aero", arc.aeroPage1),
  ...raw("ZGUAS_Aero", arc.aeroPage2),
  ...raw("ZGUAS_Urbano", arc.urbano),
  ...raw("ZGUAS_Infraestructuras", arc.infra),
];

describe("Spanien – Höhen (Lower/Upper + UOM + Reference)", () => {
  it("Meter/Fuß/FL und Bezüge", () => {
    assert.deepEqual(parseEsAltitude(120, "M", "AGL"), { meters: 120, reference: "AGL", text: "120 m AGL" });
    assert.deepEqual(parseEsAltitude(0, "M", "AGL"), { meters: 0, reference: "AGL", text: "GND" });
    assert.deepEqual(parseEsAltitude(0, "FT", "SFC"), { meters: 0, reference: "AGL", text: "GND" });
    assert.deepEqual(parseEsAltitude(3000, "FT", "AMSL"), { meters: 914.4, reference: "MSL", text: "3000 ft AMSL" });
    assert.equal(parseEsAltitude(500, "M", "WGS84")?.reference, "MSL");
    assert.deepEqual(parseEsAltitude(100, "FL", "STD"), { meters: 3048, reference: "MSL", text: "FL 100" });
    assert.equal(parseEsAltitude("100", "", "STD")?.meters, 3048);
    assert.equal(parseEsAltitude("GND", "M", "AGL")?.meters, 0);
    assert.equal(parseEsAltitude("UNL", "M", "AMSL")?.unlimited, true);
    assert.equal(parseEsAltitude("FL195", null, null)?.meters, 5943.6);
    assert.equal(parseEsAltitude(null, "M", "AGL"), null);
    assert.equal(parseEsAltitude("abc", "M", "AGL"), null);
  });
});

describe("Spanien – Beschränkung (Type)", () => {
  it("ED-318-Werte, spanische Klartexte, Layer-Default", () => {
    assert.equal(esRestriction("PROHIBITED", "ZGUAS_Urbano"), "PROHIBITED");
    assert.equal(esRestriction("REQ_AUTHORIZATION", "ZGUAS_Urbano"), "REQ_AUTHORISATION");
    assert.equal(esRestriction("REQ_AUTHORISATION", "ZGUAS_Urbano"), "REQ_AUTHORISATION");
    assert.equal(esRestriction("CONDITIONAL", "ZGUAS_Aero"), "CONDITIONAL");
    assert.equal(esRestriction("NO_RESTRICTION", "ZGUAS_Aero"), "NO_RESTRICTION");
    assert.equal(esRestriction("Prohibida", "ZGUAS_Aero"), "PROHIBITED");
    assert.equal(esRestriction("Requiere autorización", "ZGUAS_Urbano"), "REQ_AUTHORISATION");
    assert.equal(esRestriction("Condicionada", "ZGUAS_Aero"), "CONDITIONAL");
    assert.equal(esRestriction("Sin restricción", "ZGUAS_Aero"), "NO_RESTRICTION");
    assert.equal(esRestriction(null, "ZGUAS_Aero"), "REQ_AUTHORISATION");
    assert.equal(esRestriction("", "ZGUAS_Urbano"), "CONDITIONAL");
    assert.equal(esRestriction("COMMON", "ZGUAS_Infraestructuras"), "REQ_AUTHORISATION");
  });
});

describe("Spanien – Hilfsfunktionen", () => {
  it("Attribute tolerant lesen (Schreibweise, Präfix, leere Werte)", () => {
    const get = esAttributeReader({ "esri:Name_Authority": "ADIF", identifier: "X1", Message: "  ", Lower: 0 });
    assert.equal(get("Name_Authority"), "ADIF");
    assert.equal(get("NAMEAUTHORITY"), "ADIF");
    assert.equal(get("Identifier"), "X1");
    assert.equal(get("Message"), undefined);
    assert.equal(get("Lower"), 0);
  });
  it("Datum (Epoch-ms und ISO), Tage, Uhrzeiten", () => {
    assert.equal(esDateIso(1793491200000), "2026-11-01T00:00:00.000Z");
    assert.equal(esDateIso("1793491200000"), "2026-11-01T00:00:00.000Z");
    assert.equal(esDateIso("2026-11-01T00:00:00Z"), "2026-11-01T00:00:00.000Z");
    assert.equal(esDateIso(""), null);
    assert.deepEqual(esDays("MON"), ["MON"]);
    assert.deepEqual(esDays("LUN,MAR,MIÉ,JUE,VIE"), ["MON", "TUE", "WED", "THU", "FRI"]);
    assert.deepEqual(esDays("ANY"), ["ANY"]);
    assert.equal(esTimeUtc("08:00"), "08:00Z");
    assert.equal(esTimeUtc("0700"), "07:00Z");
    assert.equal(esTimeUtc("8:30:00Z"), "08:30Z");
    assert.equal(esTimeUtc("SR"), null);
  });
  it("Gründe → Deutsch", () => {
    assert.equal(esReasonText("AIR_TRAFFIC,EMERGENCY"), "Luftverkehr, Notfall");
    assert.equal(esReasonText("SENSITIVE; OTHER"), "Sensibles Objekt, Sonstiges");
    assert.equal(esReasonText(null), "");
  });
  it("Lat/Lon-Achsenfolge (WFS) wird erkannt und gedreht", () => {
    const g = esEnsureLonLat({ type: "Polygon", coordinates: [[[40.4, -3.7], [40.5, -3.7], [40.5, -3.6], [40.4, -3.7]]] });
    assert.deepEqual(g.coordinates[0][0], [-3.7, 40.4]);
    const ok = { type: "Polygon", coordinates: [[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]] };
    assert.equal(esEnsureLonLat(ok), ok);
    // Kanaren
    assert.deepEqual(esEnsureLonLat({ type: "Polygon", coordinates: [[[28.1, -15.4]]] }).coordinates[0][0], [-15.4, 28.1]);
  });
  it("ArcGIS-Seite: exceededTransferLimit (oben/properties) und Fehlerobjekt", () => {
    assert.equal(esArcgisPage(arc.aeroPage1).exceeded, true);
    assert.equal(esArcgisPage(arc.aeroPage2).exceeded, false);
    assert.equal(esArcgisPage({ features: [], exceededTransferLimit: true }).exceeded, true);
    assert.throws(() => esArcgisPage(arc.arcgisError), /ArcGIS-Fehler 500/);
  });
});

describe("Spanien – Normalisierung (ArcGIS-GeoJSON, 3 Layer)", () => {
  const feats = normalizeSpanishFeatures(allArcgisRaw(), NOW);

  it("abgelaufene, zu hohe und doppelte Zonen entfallen", () => {
    assert.equal(byId(feats, "LER81"), undefined); // Ende 2026-11-01
    assert.equal(byId(feats, "LER55"), undefined); // Untergrenze 2000 ft AGL
    assert.equal(feats.filter((f) => f.properties.identifier === "LEMD01").length, 1);
    assert.equal(feats.filter((f) => f.properties.identifier === "LED101").length, 1); // 3 Zeilen → 1 Zone
    assert.deepEqual(
      feats.map((f) => f.properties.identifier).sort(),
      ["LED101", "LEMD01", "LEP160", "LER70", "ZGUAS_INF_ADIF_0001", "ZGUAS_INF_CN_ALMARAZ", "ZGUAS_URB_08019", "ZGUAS_URB_28079"],
    );
  });

  it("Aero: Genehmigung, Höhen, spanischer Text unverändert, Behörde", () => {
    const p = byId(feats, "LEMD01").properties;
    assert.equal(p.restriction, "REQ_AUTHORISATION");
    assert.equal(p.originalType, "REQ_AUTHORIZATION");
    assert.equal(p.name, "MADRID/BARAJAS (LEMD) - ZONA DE CONTROL");
    assert.equal(p.zoneId, "ES-LEMD01");
    assert.equal(p.lowerMeters, 0);
    assert.equal(p.lowerReference, "AGL");
    assert.equal(p.upperMeters, 120);
    assert.equal(p.upperReference, "AGL");
    assert.equal(p.altitudeText, "GND – 120 m AGL");
    assert.equal(p.reason, "Luftverkehr");
    assert.equal(p.applicability, undefined); // dauerhaft
    assert.match(p.message, /^Flug nur mit Genehmigung\. Genehmigung bei ENAIRE \(mind\. 5 Tage vorher beantragen\)\./);
    assert.ok(p.message.includes(arc.aeroPage1.features[0].properties.Message));
    assert.ok(p.message.includes("Coordinación previa con ENAIRE."));
    assert.match(p.message, /Genehmigung: ENAIRE · División de Espacio Aéreo - Coordinación UAS · Kontakt: Oficina de coordinación UAS · Tel\.: \+34 913 213 000 · E-Mail: ais@enaire\.es · Web: https:\/\/drones\.enaire\.es · Vorlauf: 5 Tage/);
    assert.equal(p.contactEmail, "ais@enaire.es");
    assert.equal(p.zoneAuthority.length, 1);
    assert.equal(p.zoneAuthority[0].email, undefined);
    assert.equal(p.zoneAuthority[0].siteURL, "https://drones.enaire.es");
    assert.equal(p.source, ES_GEOZONE_SOURCE_LABEL);
    assert.equal(p.attribution, ES_GEOZONE_ATTRIBUTION);
    assert.equal(p.sourceLayer, "ZGUAS_Aero");
    assert.equal(p.legalBasis, "Real Decreto 517/2024, Art. 37, 41, 42");
    assert.equal(p.country, "ESP");
    assert.equal(p.datasetIssued, "2026-10-29T00:00:00.000Z");
    assert.equal(p.datasetValidTo, "2026-11-26T00:00:00.000Z");
  });

  it("Verbot mit Obergrenze in ft AMSL", () => {
    const p = byId(feats, "LEP160").properties;
    assert.equal(p.restriction, "PROHIBITED");
    assert.equal(p.upperMeters, 914.4);
    assert.equal(p.upperReference, "MSL");
    assert.equal(p.lowerReference, "AGL");
    assert.match(p.message, /^Flugverbot für UAS\./);
  });

  it("DailyPeriod-Zeilen → ein Zeitplan (Mo+Di gleiche Uhrzeit, Sa SR–SS)", () => {
    const p = byId(feats, "LED101").properties;
    assert.equal(p.restriction, "CONDITIONAL");
    assert.equal(p.applicability.length, 1);
    const a = p.applicability[0];
    assert.equal(a.permanent, "NO");
    assert.equal(a.startDateTime, "2026-01-01T00:00:00.000Z");
    assert.equal(a.endDateTime, undefined);
    assert.deepEqual(a.schedule, [
      { day: ["MON", "TUE"], startTime: "08:00Z", endTime: "15:00Z" },
      { day: ["SAT"], startTime: "Sonnenaufgang", endTime: "Sonnenuntergang", startEvent: "SR", endEvent: "SS" },
    ]);
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-16T10:00:00Z")), true); // Montag
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-16T16:00:00Z")), false); // Montag nach 15Z
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-15T10:00:00Z")), false); // Sonntag
    assert.equal(ed269IsActiveAt(p, new Date("2026-11-21T07:00:00Z")), true); // Samstag (Ereignis → konservativ ganztägig)
  });

  it("künftige temporäre Zone mit FL-Obergrenze", () => {
    const p = byId(feats, "LER70").properties;
    assert.equal(p.restriction, "PROHIBITED");
    assert.equal(p.upperMeters, 3048);
    assert.equal(p.upperReference, "MSL");
    assert.equal(p.reason, "Luftverkehr, Notfall");
    assert.deepEqual(p.applicability, [
      { permanent: "NO", startDateTime: "2026-12-01T09:00:00.000Z", endDateTime: "2026-12-20T18:00:00.000Z" },
    ]);
    assert.equal(ed269IsActiveAt(p, NOW), false);
    assert.equal(ed269IsActiveAt(p, new Date("2026-12-10T12:00:00Z")), true);
  });

  it("Urbano: Vorab-Mitteilung, Type leer → CONDITIONAL", () => {
    const p = byId(feats, "ZGUAS_URB_28079").properties;
    assert.equal(p.restriction, "CONDITIONAL");
    assert.match(p.message, /Vorab-Mitteilung an Ministerio del Interior \(mind\. 5 Tage vorher\)/);
    assert.match(p.message, /requiere comunicación previa al Ministerio del Interior/);
    assert.equal(p.contactEmail, "uas@interior.es");
    assert.equal(p.legalBasis, "Real Decreto 517/2024, Art. 40");
    const b = byId(feats, "ZGUAS_URB_08019").properties;
    assert.equal(b.restriction, "CONDITIONAL");
    assert.equal(b.originalType, null);
  });

  it("Infraestructuras: Genehmigung ADIF, URL/E-Mail bereinigt, MultiPolygon", () => {
    const p = byId(feats, "ZGUAS_INF_ADIF_0001").properties;
    assert.equal(p.restriction, "REQ_AUTHORISATION");
    assert.equal(p.zoneAuthority[0].siteURL, "https://www.adif.es");
    assert.equal(p.contactEmail, "uas@adif.es");
    assert.match(p.message, /Genehmigung bei ADIF \(mind\. 48 Std\. vorher beantragen\)/);
    assert.equal(p.reason, "Sensibles Objekt, Sonstiges");
    const n = byId(feats, "ZGUAS_INF_CN_ALMARAZ");
    assert.equal(n.properties.restriction, "PROHIBITED"); // „PROHIBIDA“
    assert.equal(n.geometry.type, "MultiPolygon");
    assert.equal(n.geometry.coordinates.length, 2);
  });

  it("layerübergreifendes Dedupe über Identifier", () => {
    const dup = JSON.parse(JSON.stringify(arc.urbano.features[0]));
    const out = normalizeSpanishFeatures(
      [...raw("ZGUAS_Urbano", arc.urbano), { layer: "ZGUAS_Infraestructuras", feature: dup }],
      NOW,
    );
    assert.equal(out.filter((f) => f.properties.identifier === "ZGUAS_URB_28079").length, 1);
  });

  it("parseEd269ToGeozoneInfo versteht das Ergebnis", () => {
    const zones = parseEd269ToGeozoneInfo(feats, "es", NOW.getTime());
    const z = zones.find((x) => x.featureId === "ES-LEMD01");
    assert.ok(z);
    assert.equal(z!.restriction, "REQ_AUTHORISATION");
    assert.equal(z!.upperMeters, 120);
    assert.equal(z!.lowerReference, "AGL");
    assert.match(z!.details, /Zuständige Stelle: ENAIRE/);
    assert.match(z!.details, /Rechtsgrundlage: Real Decreto 517\/2024/);
    assert.ok(z!.links?.some((l) => l.url === "mailto:ais@enaire.es"));
    assert.ok(z!.links?.some((l) => l.url === "https://drones.enaire.es/"));
    const sched = zones.find((x) => x.featureId === "ES-LED101");
    assert.deepEqual(sched?.scheduleText, ["Mo, Di · 08:00–15:00 UTC", "Sa · Sonnenaufgang–Sonnenuntergang"]);
    const temp = zones.find((x) => x.featureId === "ES-LER70");
    assert.equal(temp?.validStartTs, Date.parse("2026-12-01T09:00:00Z"));
    assert.equal(temp?.validEndTs, Date.parse("2026-12-20T18:00:00Z"));
  });
});

describe("Spanien – Normalisierer: WFS-artige Attribute (GeoJSON)", () => {
  const feats = normalizeSpanishFeatures(raw("ZGUAS_Urbano", wfs.ZGUAS_Urbano), NOW);
  it("Präfix-Felder, ISO-Datum, Lat/Lon-Drehung, spanische Tage", () => {
    assert.equal(feats.length, 2);
    const p = byId(feats, "ZGUAS_URB_46250");
    assert.equal(p.properties.restriction, "CONDITIONAL");
    assert.equal(p.properties.upperMeters, 120);
    assert.deepEqual(p.geometry.coordinates[0][0], [-0.436, 39.41]);
    assert.deepEqual(p.properties.applicability[0].schedule, [
      { day: ["MON", "TUE", "WED", "THU", "FRI"], startTime: "07:00Z", endTime: "19:00Z" },
    ]);
    assert.equal(p.properties.datasetIssued, "2026-10-29T00:00:00.000Z");
  });
});

