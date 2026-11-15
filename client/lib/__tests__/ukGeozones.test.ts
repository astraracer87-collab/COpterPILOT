import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GB_GEOZONE_SOURCE_LABEL,
  UK_AIP_KML_URL,
  formatUkLimitDe,
  normalizeUkKmlWithStats,
  parseUkDescription,
  parseUkLimit,
  parseUkLimitPrefix,
  splitUkActivities,
  translateUkActivity,
} from "../../../shared/ukGeozones";
import { kmlClosedLineRing, parseKmlPlacemarks } from "../../../shared/kmlParse";
import { unitedKingdomFeaturesFromKml } from "../geozoneDirect/ukSource";
import { ED269_DIRECT_COUNTRIES } from "../geozoneDirect/ed269Sources";
import { ED269_SOURCE_LABELS, parseEd269ToGeozoneInfo } from "../ed269";
import { detectCountryFromCoordinates, hasOwnMap } from "../../../shared/countryDetection";

// Gekürzter ECHTER Auszug aus der Live-KML (Google My Maps „UK AIP“,
// abgerufen 2026-11-15): 13 von 1069 Placemarks, Originalbeschreibungen und
// -geometrien unverändert (nur Styles entfernt).
const kml = readFileSync(join(__dirname, "fixtures/gb-uk-aip-sample.kml"), "utf8");
const byName = (features: any[], prefix: string) => features.find((f) => String(f.properties.name).startsWith(prefix));

describe("ukGeozones – Höhenangaben", () => {
  it("liest SFC/GND, FT ALT/AMSL (MSL), FT AGL, FL (STD), Meter und UNL", () => {
    assert.deepEqual(parseUkLimit("SFC"), { meters: 0, reference: "AGL", raw: "SFC" });
    assert.equal(parseUkLimit("2000 FT ALT")?.reference, "MSL");
    assert.equal(parseUkLimit("2000 FT ALT")?.meters, 609.6);
    assert.equal(parseUkLimit("10,000 FT ALT")?.meters, 3048);
    assert.equal(parseUkLimit("405 FT AMSL")?.reference, "MSL");
    assert.equal(parseUkLimit("400 FT AGL")?.reference, "AGL");
    assert.equal(parseUkLimit("400 FT SFC")?.reference, "AGL");
    const fl = parseUkLimit("FL100");
    assert.equal(fl?.reference, "STD");
    assert.equal(fl?.meters, 3048);
    assert.equal(parseUkLimit("FL 90")?.flightLevel, 90);
    assert.equal(parseUkLimit("150 M AMSL")?.meters, 150);
    assert.equal(parseUkLimit("UNL")?.unlimited, true);
  });

  it("trennt die Untergrenze von der direkt folgenden Bemerkung", () => {
    const r = parseUkLimitPrefix("SFC FRZ Active H24. Unmanned aircraft …");
    assert.equal(r.limit?.meters, 0);
    assert.equal(r.rest, "FRZ Active H24. Unmanned aircraft …");
    const r2 = parseUkLimitPrefix("750 FT ALT When active, entry …");
    assert.equal(r2.limit?.meters, 228.6);
    assert.equal(r2.rest, "When active, entry …");
  });

  it("formatiert deutsch", () => {
    assert.equal(formatUkLimitDe(parseUkLimit("SFC")), "Boden (GND)");
    assert.equal(formatUkLimitDe(parseUkLimit("2000 FT ALT")), "2.000 ft MSL (≈ 610 m)");
    assert.equal(formatUkLimitDe(parseUkLimit("2000 FT AGL")), "2.000 ft über Grund (≈ 610 m)");
    assert.equal(formatUkLimitDe(parseUkLimit("UNL")), "unbegrenzt");
  });
});

describe("ukGeozones – Aktivitäten", () => {
  it("teilt an „ / “, lässt „Electronic/Optical Hazards“ zusammen", () => {
    assert.deepEqual(
      splitUkActivities("Ordnance, Munitions and Explosives / Para Dropping / Electronic/Optical Hazards."),
      ["Ordnance, Munitions and Explosives", "Para Dropping", "Electronic/Optical Hazards"],
    );
  });

  it("übersetzt alle in den Live-Daten vorkommenden Phrasen", () => {
    const live = [
      "Unmanned Aircraft System (UAS)", "Unmanned Aircraft system (UAS)", "Unmanned Aircraft Systems (UAS)",
      "Ordnance, Munitions and Explosives", "Ordnance, Munitions and Explosives (OME)", "Ordnance Munitions and Explosives",
      "Ordnance, Munitions & Explosives (OME)", "Ordnance, Munitions Explosives",
      "High Energy Manoeuvres", "Electronic/Optical Hazards", "Electronic/optical hazards", "Electrical/Optical Hazards",
      "Para Dropping", "Target Towing", "Balloons", "Test and Evaluation", "Spaceflight Activities",
    ];
    for (const p of live) assert.ok(translateUkActivity(p).known, p);
    assert.equal(translateUkActivity("Para Dropping").de, "Fallschirmabsprünge");
    assert.equal(translateUkActivity("Ordnance, Munitions & Explosives (OME)").de, "Munition und Sprengstoff");
    assert.equal(translateUkActivity("Unmanned Aircraft System (UAS)").de, "Unbemannte Luftfahrzeuge (UAS)");
    assert.equal(translateUkActivity("Something New").known, false);
  });
});

describe("kmlParse – LineStrings", () => {
  it("geschlossene Linie mit ≥ 3 Punkten wird Ring, A→B→A-Wand nicht", () => {
    assert.ok(kmlClosedLineRing([[0, 0], [1, 0], [1, 1], [0, 0]]));
    assert.equal(kmlClosedLineRing([[0, 0, 3048], [1, 1, 20116.8], [0, 0, 3048]]), null);
    assert.equal(kmlClosedLineRing([[0, 0], [1, 0], [1, 1], [0, 1]]), null); // offen
  });

  it("liest LineStrings aus MultiGeometry (3D-Wände der Fixture)", () => {
    const pm = parseKmlPlacemarks(kml).find((p) => p.name === "EGD613B CENTRAL COMPLEX")!;
    assert.equal(pm.lineStrings?.length, 3);
    assert.equal(pm.polygons.length, 2); // Boden + Decke, identisch
  });
});

describe("ukGeozones – Normalisierung der echten Fixture", () => {
  const { features, dropped } = normalizeUkKmlWithStats(kml);

  it("Folder → restriction, Zonen oberhalb FL125 verworfen", () => {
    assert.equal(features.length, 12);
    assert.deepEqual(dropped, [{ name: "EGD712A NORTHERN COMPLEX", reason: "lower_msl", lower: "FL245" }]);
    assert.equal(byName(features, "EGP611").properties.restriction, "PROHIBITED");
    assert.equal(byName(features, "EGD001").properties.restriction, "CONDITIONAL");
    assert.equal(byName(features, "EGR1U001A").properties.restriction, "REQ_AUTHORISATION");
    for (const f of features) {
      assert.equal(f.properties.source, GB_GEOZONE_SOURCE_LABEL);
      assert.ok(!/inoffiziell|unofficial/i.test(f.properties.message));
    }
  });

  it("MultiGeometry: Wandlinien verworfen, doppelte Polygone entfernt", () => {
    const f = byName(features, "EGD613B");
    assert.equal(f.geometry.type, "Polygon");
    assert.equal(f.geometry.coordinates[0].length, 4);
    assert.equal(f.properties.lowerMeters, 3048);
    assert.equal(f.properties.lowerReference, "STD");
  });

  it("Höhen und Bezüge", () => {
    const d001 = byName(features, "EGD001").properties;
    assert.equal(d001.lowerMeters, 0);
    assert.equal(d001.lowerReference, "AGL");
    assert.equal(d001.upperMeters, 304.8);
    assert.equal(d001.upperReference, "MSL");
    const frz = byName(features, "EGR1U001A").properties;
    assert.equal(frz.upperReference, "AGL");
    assert.equal(frz.ukFrz, true);
    const iom = byName(features, "EGR4U011A").properties;
    assert.equal(iom.upperMeters, undefined); // UNL
    const hra = byName(features, "EGR610B").properties;
    assert.equal(hra.lowerMeters, 228.6);
    assert.equal(hra.lowerReference, "MSL");
  });

  it("deutsche Nachricht mit Aktivität, Funk, Kontakt, Zuständigkeit und Original", () => {
    const m: string = byName(features, "EGD001").properties.message;
    assert.match(m, /^Typ: Gefahrengebiet \(Danger Area/);
    assert.match(m, /Höhe laut AIP: Boden \(GND\) bis 1\.000 ft MSL \(≈ 305 m\)/);
    assert.match(m, /Aktivität: Munition und Sprengstoff/);
    assert.match(m, /Funk\/Dienst: SUACS: Culdrose APP auf 134\.055 MHz wenn besetzt; sonst SUAAIS: London Information auf 124\.750 MHz/);
    assert.match(m, /Kontakt: Vorabinformation \/ Buchung: Culdrose Operations, Tel: 01326-552415/);
    assert.match(m, /Zuständig: DAATM \(HQ Navy\)/);
    assert.match(m, /\nOriginaltext der Behörde:\n[\s\S]*Upper limit: 1000 FT ALT/);
    assert.equal((m.match(/Originaltext der Behörde/g) ?? []).length, 1);
  });

  it("FRZ-, Gefängnis- und NSA-Texte übersetzt", () => {
    const frz: string = byName(features, "EGR1U001A").properties.message;
    assert.match(frz, /Flugbeschränkungszone \(FRZ\) des Flugplatzes – durchgehend aktiv \(H24\)/);
    assert.match(frz, /nur mit Genehmigung der zuständigen Flugverkehrsdienststelle oder des Flugplatzbetreibers/);
    assert.match(frz, /Kontaktdaten: siehe AIP Teil 3 \(Flugplätze\), Abschnitt AD 2\.2/);
    const mil: string = byName(features, "EGR1U007A").properties.message;
    assert.match(mil, /Kontaktdaten: siehe UK MIL AIP Teil 3 \(Flugplätze\)/);
    const hmp = byName(features, "EGR1U049").properties;
    assert.match(hmp.message, /Justizvollzugsanstalt \(HMP\)/);
    assert.match(hmp.message, /Rechtsgrundlage: SI 2023\/1101/);
    assert.match(hmp.message, /Geländehöhe am Standort: 405 ft MSL/);
    assert.equal(hmp.contactEmail, "drone.RFZapplication@justice.gov.uk");
    const nsa = byName(features, "EGR1U084").properties;
    assert.match(nsa.message, /National Security Act/);
    assert.equal(nsa.applicationUrl, "https://portal.caa.co.uk");
    const exempt: string = byName(features, "EGR105").properties.message;
    assert.match(exempt, /Ausnahmen bzw\. Bedingungen/);
  });

  it("Vertikalgrenzen der Danger Areas übersetzt", () => {
    const m: string = byName(features, "EGD123").properties.message;
    assert.match(m, /Vertikale Grenze: 3\.000 ft MSL \(≈ 914 m\) – durchgehend \(H24\)/);
    assert.match(m, /Gelegentlich per NOTAM bis 50\.000 ft MSL/);
    assert.match(m, /Rechtsgrundlage: SI 1963\/1293, SI 1981\/1882/);
  });

  it("Beschreibung zerlegt Abschnitte", () => {
    const pm = parseKmlPlacemarks(kml).find((p) => p.name === "EGD001 TREVOSE HEAD")!;
    const d = parseUkDescription(pm.description);
    assert.deepEqual(d.activities, ["Ordnance, Munitions and Explosives"]);
    assert.equal(d.authority, "DAATM (HQ Navy)");
    assert.match(d.lateral, /^501918N 0053042W/);
  });
});

describe("ukGeozones – App-Pfad", () => {
  it("finalisiert mit _country gb + bbox und läuft durch parseEd269ToGeozoneInfo", () => {
    const features = unitedKingdomFeaturesFromKml(kml);
    assert.equal(features.length, 12);
    assert.ok(features.every((f) => f.properties?._country === "gb" && Array.isArray(f.bbox)));
    const infos = parseEd269ToGeozoneInfo(features, "GB");
    assert.equal(infos.length, 12);
    const p611 = infos.find((i) => i.featureId === "EGP611")!;
    assert.equal(p611.restriction, "PROHIBITED");
    assert.equal(p611.layerLabel, "UK AIP (CAA)");
    assert.equal(p611.lowerReference, "AGL");
    // Deutsche Nachricht wird nicht nochmals übersetzt; Original genau einmal.
    assert.equal((p611.details.match(/Originaltext der Behörde/g) ?? []).length, 1);
    assert.ok(p611.links?.some((l) => l.url === "https://portal.caa.co.uk"));
    const hra = infos.find((i) => i.featureId === "EGR610B")!;
    assert.equal(hra.lowerReference, "MSL");
  });

  it("GB ist als Vektor-Land mit Quellenlabel und Ländererkennung registriert", () => {
    assert.ok((ED269_DIRECT_COUNTRIES as readonly string[]).includes("gb"));
    assert.equal(ED269_SOURCE_LABELS.GB, "UK AIP (CAA)");
    assert.ok(hasOwnMap("GB"));
    assert.equal(UK_AIP_KML_URL, "https://www.google.com/maps/d/kml?mid=1BktWMPYNuh6N5_IPngyq8jW80nAWXI8d&forcekml=1");
    assert.equal(detectCountryFromCoordinates(51.507, -0.128), "GB"); // London
    assert.equal(detectCountryFromCoordinates(54.597, -5.93), "GB"); // Belfast
    assert.equal(detectCountryFromCoordinates(53.35, -6.26), "IE"); // Dublin
    assert.equal(detectCountryFromCoordinates(50.726, 1.614), "FR"); // Boulogne-sur-Mer
  });
});
