import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

import {
  SK_GEOZONE_ATTRIBUTION,
  SK_GEOZONE_SOURCE_LABEL,
  SK_LPS_AIRSPACE_LAYER_URL,
  classifySkLps,
  decideSkDuRestriction,
  decodeSkDuArchive,
  findSkDuZipUrl,
  normalizeSlovakiaWithStats,
  parseSkDuHeight,
  parseSkDuValidity,
  skArcgisPage,
  skLimit,
  skLowerAboveDroneHeight,
  skLpsQueryUrl,
  skTitleCase,
  translateSkDuRestriction,
  translateSkLpsName,
} from "../../../shared/slovakGeozones";
import { parseKmlPlacemarks } from "../../../shared/kmlParse";
import { loadSlovakia } from "../geozoneDirect/slovakiaSource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Gekürzte ECHTE Auszüge (abgerufen 2026-11-15):
//  - LPS SR VFRM_popup/MapServer/5 (f=geojson, outSR=4326): 22 von 178
//    Lufträumen, Attribute und Geometrien unverändert. Enthält je Typ
//    mindestens einen Vertreter, u. a. RAS/MRVA, RAS/NPZ, RAS/ATZ, RAS/RMZ,
//    RAS ohne LOCALTYPE (Artillerie), FBZ, FIR-P, sowie LZPP als CTR UND ATZ.
//  - Dopravný úrad „Aktuálne - 30.10.2026.kml“: 10 von 275 Placemarks,
//    Ordnerstruktur und Beschreibungen unverändert.
const lpsBody = JSON.parse(readFileSync(join(__dirname, "fixtures/sk-lps-arcgis-sample.json"), "utf8"));
const lps: any[] = lpsBody.features;
const duKml = readFileSync(join(__dirname, "fixtures/sk-du-uas-zones-sample.kml"), "utf8");
const NOW = Date.parse("2026-11-15T12:00:00Z");

const rawByIdent = (ident: string, type?: string) =>
  lps.find((f) => f.properties.IDENT_TXT === ident && (!type || f.properties.TYPE_CODE === type));
const byId = (features: any[], id: string) => features.find((f) => f.properties.identifier === id);

describe("slovakGeozones – Höhen (AIXM DISTVERT*)", () => {
  it("rechnet FT/MSL, FT/SFC und Flugflächen in Meter um", () => {
    assert.deepEqual(skLimit(5000, "FT", "MSL"), { meters: 1524, reference: "MSL", label: "5000 ft MSL" });
    assert.deepEqual(skLimit(0, "FT", "SFC"), { meters: 0, reference: "AGL", label: "GND" });
    const agl = skLimit(1000, "FT", "SFC")!;
    assert.equal(agl.reference, "AGL");
    assert.ok(Math.abs(agl.meters! - 304.8) < 1e-9);
    const fl = skLimit(245, "FL", "STD")!;
    assert.equal(fl.reference, "STD");
    assert.equal(fl.label, "FL 245");
    assert.ok(Math.abs(fl.meters! - 7467.6) < 1e-6);
    assert.equal(skLimit(null, null, null), undefined);
  });

  it("Höhenfilter: > 500 ft AGL, > 2800 m MSL, Flugflächen mit Druckreserve", () => {
    assert.equal(skLowerAboveDroneHeight(skLimit(1000, "FT", "SFC")), true); // R40, KOŠICE TMA 2
    assert.equal(skLowerAboveDroneHeight(skLimit(400, "FT", "SFC")), false);
    assert.equal(skLowerAboveDroneHeight(skLimit(9500, "FT", "MSL")), true); // TRA5 = 2895,6 m
    assert.equal(skLowerAboveDroneHeight(skLimit(8000, "FT", "MSL")), false); // 2438 m < Gerlach + 120 m
    assert.equal(skLowerAboveDroneHeight(skLimit(125, "FL", "STD")), true);
    assert.equal(skLowerAboveDroneHeight(skLimit(95, "FL", "STD")), false); // nur mit Reserve
    assert.equal(skLowerAboveDroneHeight(skLimit(0, "FT", "SFC")), false);
  });
});

describe("slovakGeozones – LPS-Typzuordnung (RAS gemischt)", () => {
  it("trennt RAS nach LOCALTYPE_TXT: ATZ/RMZ bleiben, MRVA/NPZ entfallen", () => {
    assert.deepEqual(classifySkLps(rawByIdent("LZJS").properties), { kind: "atz", restriction: "REQ_AUTHORISATION" });
    assert.deepEqual(classifySkLps(rawByIdent("LZJSRMZ").properties), { kind: "rmz", restriction: "CONDITIONAL" });
    assert.equal(classifySkLps(rawByIdent("LZSLZPP001").properties).excluded, "mrva");
    assert.equal(classifySkLps(rawByIdent("EUNPZ7").properties).excluded, "npz");
    assert.deepEqual(classifySkLps(rawByIdent("LZSZUZANA").properties), { kind: "artillery", restriction: "RESTRICTED" });
  });

  it("übrige Typen", () => {
    const k = (ident: string, type?: string) => classifySkLps(rawByIdent(ident, type).properties);
    assert.equal(k("LZP1").restriction, "PROHIBITED");
    assert.deepEqual(k("FAUNA1"), { kind: "fauna", restriction: "REQ_AUTHORISATION" });
    assert.deepEqual(k("LZR24"), { kind: "restricted", restriction: "RESTRICTED" });
    assert.deepEqual(k("LZD1"), { kind: "danger", restriction: "CONDITIONAL" });
    assert.deepEqual(k("C"), { kind: "danger", restriction: "CONDITIONAL" }); // D-OTHER
    assert.deepEqual(k("LZTRA3"), { kind: "tra", restriction: "RESTRICTED" });
    assert.deepEqual(k("LZIB"), { kind: "ctr", restriction: "REQ_AUTHORISATION" });
    assert.deepEqual(k("LZIB1"), { kind: "tma", restriction: "REQ_AUTHORISATION" });
    assert.deepEqual(k("LZBBGLD1"), { kind: "glider", restriction: "CONDITIONAL" });
    assert.deepEqual(k("LZBBPJA17"), { kind: "parachute", restriction: "CONDITIONAL" });
    assert.equal(k("LZTSA1Z").excluded, "fbz");
    assert.equal(k("LZRUTOL").excluded, "fir_part");
    assert.deepEqual(classifySkLps({ TYPE_CODE: "XYZ" }), { kind: "unknown", restriction: "REQ_AUTHORISATION" });
  });

  it("deutsche Zonennamen", () => {
    assert.equal(skTitleCase("NOVÉ ZÁMKY"), "Nové Zámky");
    assert.equal(skTitleCase("Turecký Vrch Peter"), "Turecký Vrch Peter");
    assert.equal(translateSkLpsName(rawByIdent("LZJS").properties, "atz"), "Flugplatzverkehrszone (ATZ) Jasna (LZJS)");
    assert.equal(translateSkLpsName(rawByIdent("LZP1").properties, "prohibited"), "Luftsperrgebiet LZP1 Mochovce");
    assert.equal(translateSkLpsName(rawByIdent("FAUNA1").properties, "fauna"), "Faunaschutz: Tatra-Nationalpark (TANAP) (FAUNA1)");
    assert.equal(translateSkLpsName(rawByIdent("LZIB1").properties, "tma"), "Nahkontrollbereich (TMA) Bratislava 1 (LZIB1)");
    assert.equal(translateSkLpsName(rawByIdent("C").properties, "danger"), "Gefahrengebiet C Schleudersitz-Erprobungsgebiet");
    assert.equal(translateSkLpsName(rawByIdent("UKLU").properties, "ctr"), "Kontrollzone Uzhhorod West (UKLU)");
  });
});

describe("slovakGeozones – LPS-Normalisierung", () => {
  const { features, dropped } = normalizeSlovakiaWithStats({ lps, now: NOW });

  it("übernimmt ATZ und RMZ unter RAS, verwirft MRVA und NPZ ausdrücklich", () => {
    const atz = byId(features, "SK-LPS-RAS-ATZ-LZJS");
    assert.equal(atz.properties.restriction, "REQ_AUTHORISATION");
    const rmz = byId(features, "SK-LPS-RAS-RMZ-LZJSRMZ");
    assert.equal(rmz.properties.restriction, "CONDITIONAL");
    assert.match(rmz.properties.message, /Zweiwege-Funkverbindung/);
    assert.equal(features.some((f) => f.properties.skLocalType === "MRVA" || f.properties.skLocalType === "NPZ"), false);
    // MRVA LZPP 001 liegt bei 3000 ft MSL (< 2800 m) – fällt nach Typ, nicht nach Höhe.
    assert.deepEqual(dropped.find((d) => d.name === "LZSLZPP001"), { source: "lps", name: "LZSLZPP001", reason: "mrva" });
    assert.equal(dropped.find((d) => d.name === "EUNPZ7")?.reason, "npz");
  });

  it("Zählung je LOCALTYPE_TXT (RAS) im Auszug", () => {
    const kept: Record<string, number> = {};
    for (const f of features) if (f.properties.skTypeCode === "RAS") kept[f.properties.skLocalType ?? "-"] = (kept[f.properties.skLocalType ?? "-"] ?? 0) + 1;
    assert.deepEqual(kept, { ATZ: 2, RMZ: 1, "-": 1 });
  });

  it("Höhenfilter und ausgeschlossene Typen", () => {
    const reasons = Object.fromEntries(dropped.map((d) => [d.name, d.reason]));
    assert.equal(reasons.LZR40, "above_drone_height"); // 1000 ft SFC
    assert.equal(reasons.LZTRA5, "above_drone_height"); // 9500 ft MSL
    assert.equal(reasons.LZTSA1Z, "fbz");
    assert.equal(reasons.LZRUTOL, "fir_part");
    const tra = byId(features, "SK-LPS-TRA-LZTRA3");
    assert.equal(tra.properties.lowerMeters, 1524);
    assert.equal(tra.properties.lowerReference, "MSL");
    assert.equal(tra.properties.upperReference, "STD");
    assert.match(tra.properties.message, /dauerhaft aktiv/);
  });

  it("Dedupe über TYPE_CODE+IDENT_TXT: LZPP als CTR und ATZ getrennt, echte Doppel verworfen", () => {
    assert.ok(byId(features, "SK-LPS-CTR-LZPP"));
    assert.ok(byId(features, "SK-LPS-RAS-ATZ-LZPP"));
    const again = normalizeSlovakiaWithStats({ lps: [...lps, rawByIdent("LZP1")], now: NOW });
    assert.equal(again.features.length, features.length);
    assert.equal(again.dropped.filter((d) => d.reason === "duplicate").length, 1);
  });

  it("ohne DÚ-Daten bleiben die slowakischen LPS-CTR erhalten (Fallback)", () => {
    const ctr = byId(features, "SK-LPS-CTR-LZIB");
    assert.equal(ctr.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.properties.name, "Kontrollzone Štefánik (LZIB)");
  });

  it("deutsche Meldung, Originaltext, volle Präzision", () => {
    const p1 = byId(features, "SK-LPS-P-LZP1");
    assert.equal(p1.properties.restriction, "PROHIBITED");
    assert.equal(p1.properties.upperMeters, 1524);
    assert.match(p1.properties.message, /^Typ: Luftsperrgebiet \(P\)/);
    assert.match(p1.properties.message, /Vertikale Grenzen laut Behörde: GND \(Boden\) – 5000 ft MSL \(1524 m MSL\)/);
    assert.match(p1.properties.message, /Aktivität: Kernkraftanlage/);
    assert.match(p1.properties.message, /\nOriginaltext der Behörde:\n/);
    assert.equal(p1.properties.extendedProperties.localizedMessages[0].language, "de");
    assert.equal(p1.properties.message.includes("siehe Originaltext"), false);
    const raw = rawByIdent("LZP1").geometry.coordinates[0];
    assert.deepEqual(p1.geometry.coordinates[0][1], [raw[1][0], raw[1][1]]);
    assert.equal(p1.geometry.coordinates[0][1].length, 2);
    const fauna = byId(features, "SK-LPS-PROTECT-FAUNA1");
    assert.match(fauna.properties.message, /§ 15 Abs\. 2 lit\. d Gesetz Nr\. 543\/2002/);
    const atz = byId(features, "SK-LPS-RAS-ATZ-LZJS");
    assert.match(atz.properties.message, /Funkfrequenz: 130,130 MHz \(CTAF\)/);
  });

  it("alle Aktivitätscodes im Auszug sind übersetzt", () => {
    for (const f of features) assert.equal(f.properties.message.split("Originaltext der Behörde:")[0].includes("siehe Originaltext"), false, f.properties.identifier);
  });
});

describe("slovakGeozones – DÚ-Geozonen (KML)", () => {
  it("Höhen, Gültigkeit und Beschränkung", () => {
    assert.deepEqual(parseSkDuHeight("GND - 120m AGL"), {
      lowerMeters: 0,
      lowerReference: "AGL",
      upperMeters: 120,
      upperReference: "AGL",
      label: "Boden (GND) bis 120 m über Grund (AGL)",
    });
    const ctr = parseSkDuHeight("30 - 120m AGL")!;
    assert.equal(ctr.lowerMeters, 30);
    assert.equal(ctr.lowerReference, "AGL");
    const msl = parseSkDuHeight("GND - 5000ft AMSL")!;
    assert.equal(msl.upperMeters, 1524);
    assert.equal(msl.upperReference, "MSL");
    assert.equal(parseSkDuHeight("irgendwas"), null);

    assert.deepEqual(parseSkDuValidity("stála permanent"), { permanent: true, de: "dauerhaft" });
    const t = parseSkDuValidity("10.11.2026 06:00 GMT+1 – 10.11.2026 18:00 GMT+1");
    assert.equal(t.start, "2026-11-10T05:00:00Z");
    assert.equal(t.end, "2026-11-10T17:00:00Z");
    const twr = parseSkDuValidity(
      "Počas prevádzkových hodín stanovišťa riadenia letovej prevádzky (TWR) Poprad During operations hours of the Poprad air traffic control Tower (TWR)",
    );
    assert.equal(twr.permanent, true);
    assert.equal(twr.unparsedSchedule, true);
    assert.match(twr.de, /TWR\) Poprad/);

    assert.equal(
      decideSkDuRestriction({ headerSk: "ZAKÁZANÁ PREVÁDZKA UAS", headerEn: "", restrictionSk: "", restrictionEn: "" }).restriction,
      "PROHIBITED",
    );
    assert.deepEqual(
      decideSkDuRestriction({ headerSk: "PODMIENENÁ PREVÁDZKA UAS", headerEn: "", restrictionSk: "", restrictionEn: "" }),
      { restriction: "REQ_AUTHORISATION", fromDefault: false },
    );
    assert.equal(translateSkDuRestriction("Zákaz vykonávania civilných letov UAS"), "Zivile UAS-Flüge sind verboten.");
    assert.equal(translateSkDuRestriction("unbekannt"), null);
  });

  it("normalisiert alle Placemarks des Auszugs (befristete abgelaufen)", () => {
    assert.equal(parseKmlPlacemarks(duKml).length, 10);
    const { features, dropped } = normalizeSlovakiaWithStats({ duKml, now: NOW });
    assert.equal(features.length, 8);
    assert.deepEqual(dropped.map((d) => [d.name, d.reason]).sort(), [["PUAS0159M", "expired"], ["PUAS0160M", "expired"]]);

    const ctr = byId(features, "SK-DU-RUAS001-LZBACTR-D");
    assert.equal(ctr.properties.name, "Kontrollzone Štefánik (RUAS001-LZBACTR-D)");
    assert.equal(ctr.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.properties.lowerMeters, 30);
    assert.equal(ctr.properties.upperMeters, 120);
    assert.match(ctr.properties.message, /Kategorie „speziell“/);
    assert.match(ctr.properties.message, /mehr als 5 km vom Flughafen entfernt und bis 30 m/);
    assert.match(ctr.properties.message, /Ordner: Aktuálne \/ Stále \/ CTR/);

    const ad = byId(features, "SK-DU-RUAS001-LZBAAD-D");
    assert.equal(ad.properties.name, "Flughafen Bratislava - M. R. Štefánik – Flughafenbereich (RUAS001-LZBAAD-D)");
    assert.equal(ad.geometry.type, "Polygon"); // Umriss-LineString ignoriert
    assert.equal(ad.geometry.coordinates[0][0].length, 2);

    const pp = byId(features, "SK-DU-RUAS003-LZPPCTR-D");
    assert.equal(pp.properties.applicability, undefined);
    assert.match(pp.properties.message, /Betriebszeiten der Flugverkehrskontrollstelle \(TWR\) Piešťany/);

    assert.equal(byId(features, "SK-DU-RUAS019M").properties.upperMeters, 500);
    assert.match(byId(features, "SK-DU-RUAS019M").properties.message, /Verteidigungsministeriums/);
    assert.equal(byId(features, "SK-DU-RUAS120M").properties.name, "Kritische Infrastruktur RUAS120M");
    assert.equal(byId(features, "SK-DU-RUAS004M").properties.name, "Schutzobjekt RUAS004M");
    assert.equal(byId(features, "SK-DU-R00001D").properties.name, "Zoo Bojnice (R00001D)");
    assert.equal(byId(features, "SK-DU-PUAS001-D").properties.restriction, "PROHIBITED");
    for (const f of features) {
      assert.equal(f.properties.message.split("Originaltext der Behörde:")[0].includes("siehe Originaltext"), false, f.properties.identifier);
    }
  });

  it("befristete Zone innerhalb des Zeitraums mit applicability (UTC)", () => {
    const { features } = normalizeSlovakiaWithStats({ duKml, now: Date.parse("2026-11-10T10:00:00Z") });
    const t = byId(features, "SK-DU-PUAS0159M");
    assert.equal(t.properties.restriction, "PROHIBITED");
    assert.equal(t.properties.upperReference, "MSL");
    assert.deepEqual(t.properties.applicability, [
      { permanent: "NO", startDateTime: "2026-11-10T05:00:00Z", endDateTime: "2026-11-10T17:00:00Z" },
    ]);
  });

  it("kombiniert: LPS-CTR werden durch DÚ-CTR-Geozonen ersetzt, UKLU bleibt", () => {
    const { features, dropped } = normalizeSlovakiaWithStats({ duKml, lps, now: NOW });
    assert.equal(byId(features, "SK-LPS-CTR-LZIB"), undefined);
    assert.equal(byId(features, "SK-LPS-CTR-LZPP"), undefined);
    assert.ok(byId(features, "SK-LPS-CTR-UKLU"));
    assert.ok(byId(features, "SK-LPS-RAS-ATZ-LZPP"));
    assert.deepEqual(dropped.filter((d) => d.reason === "covered_by_du").map((d) => d.name).sort(), ["LZIB", "LZPP"]);
    assert.equal(new Set(features.map((f) => f.properties.identifier)).size, features.length);
  });
});

describe("slovakGeozones – Abruf", () => {
  it("Query-URL und Seitenauswertung", () => {
    const u = new URL(skLpsQueryUrl(1000, 500));
    assert.equal(`${u.origin}${u.pathname}`, `${SK_LPS_AIRSPACE_LAYER_URL}/query`);
    assert.equal(u.searchParams.get("f"), "geojson");
    assert.equal(u.searchParams.get("outSR"), "4326");
    assert.equal(u.searchParams.get("resultOffset"), "1000");
    assert.equal(u.searchParams.get("geometryPrecision"), null);
    assert.deepEqual(skArcgisPage({ features: [1], properties: { exceededTransferLimit: true } }), { features: [1], exceeded: true });
    assert.throws(() => skArcgisPage({ error: { code: 400, message: "Invalid" } }), /ArcGIS-Fehler 400/);
  });

  it("findet den ZIP-Link der DÚ-Seite (https, kodiert)", () => {
    const html =
      '<p><a href="http://letectvo.nsat.sk/wp-content/uploads/sites/2/2026/10/Aktuálne-30.10.2026.zip">KML – Aktuálne zemepisné oblasti</a></p>';
    assert.equal(
      findSkDuZipUrl(html),
      "https://letectvo.nsat.sk/wp-content/uploads/sites/2/2026/10/Aktu%C3%A1lne-30.10.2026.zip",
    );
    assert.equal(findSkDuZipUrl("<p>nichts</p>"), null);
  });

  it("entpackt ZIP und liest KML direkt", () => {
    const zip = zipSync({ "Aktuálne - 30.10.2026.kml": strToU8(duKml) });
    assert.equal(decodeSkDuArchive(zip), duKml);
    assert.equal(decodeSkDuArchive(strToU8(duKml)), duKml);
  });

  const html = '<a href="http://letectvo.nsat.sk/wp-content/uploads/sites/2/2026/10/Aktuálne-30.10.2026.zip">KML</a>';
  const zipBytes = zipSync({ "a.kml": strToU8(duKml) });

  it("loadSlovakia kombiniert beide Quellen und taggt das Land", async () => {
    const urls: string[] = [];
    const out = await loadSlovakia({
      now: NOW,
      json: async (url) => {
        urls.push(url);
        return lpsBody;
      },
      text: async () => html,
      bytes: async (url) => {
        urls.push(url);
        return zipBytes;
      },
    });
    assert.ok(out.length > 20);
    assert.ok(out.every((f: any) => f.properties._country === "sk" && Array.isArray(f.bbox)));
    assert.ok(out.some((f: any) => f.properties.skSource === "du"));
    assert.ok(out.some((f: any) => f.properties.skSource === "lps"));
    assert.equal(urls.filter((u) => u.includes("/MapServer/5/query")).length, 1); // < Seitengröße → eine Seite
  });

  it("fällt bei DÚ-Ausfall auf LPS zurück und wirft, wenn beide leer sind", async () => {
    const out = await loadSlovakia({
      now: NOW,
      json: async () => lpsBody,
      text: async () => {
        throw new Error("HTTP 503");
      },
    });
    assert.ok(out.some((f: any) => f.properties.identifier === "SK-LPS-CTR-LZIB"));
    await assert.rejects(
      loadSlovakia({ json: async () => ({ features: [] }), text: async () => "<p></p>" }),
      /keine Zonen/,
    );
  });
});

describe("slovakGeozones – Darstellung über parseEd269ToGeozoneInfo", () => {
  it("deutsche Meldung wird nicht erneut übersetzt, Originaltext nur einmal", () => {
    const { features } = normalizeSlovakiaWithStats({ duKml, lps, now: NOW });
    const info = parseEd269ToGeozoneInfo(features, "SK");
    assert.equal(info.length, features.length);
    const ctr = info.find((z) => z.featureId === "SK-DU-RUAS001-LZBACTR-D")!;
    assert.equal(ctr.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.lowerMeters, 30);
    assert.equal(ctr.details.split("Originaltext der Behörde:").length, 2);
    assert.match(ctr.details, /Beschränkung laut Behörde: Ziviler UAS-Betrieb nur in der Kategorie „speziell“/);
    const tma = info.find((z) => z.featureId === "SK-LPS-TMA-P-LZIB1")!;
    assert.equal(tma.lowerReference, "MSL");
    assert.ok(Math.abs((tma.lowerMeters ?? 0) - 457.2) < 1e-6);
    assert.equal(SK_GEOZONE_SOURCE_LABEL, "Dopravný úrad SR / LPS SR");
    assert.equal(SK_GEOZONE_ATTRIBUTION, "© LPS SR");
  });
});
