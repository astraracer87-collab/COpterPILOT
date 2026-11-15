import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decodeXmlEntities,
  htmlToText,
  kmlDescriptionTable,
  parseKmlCoordinates,
  parseKmlPlacemarks,
  parseXml,
} from "../../../shared/kmlParse";
import {
  PL_GEOZONE_SOURCE_LABEL,
  buildPansaKmlUrl,
  classifyPolishTypeText,
  classifyPolishTypeValue,
  normalizePolishKml,
  parsePansaLoginToken,
  parsePolishAltitude,
  parsePolishAltitudeRange,
  parsePolishDate,
} from "../../../shared/polishGeozones";
import { polandFeaturesFromKml, PANSA_KML_REQUEST_URL } from "../geozoneDirect/polandSource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Handgemachte Fixture nach der in docs/pansa-pl-api-integration.md
// beschriebenen Struktur (KML, Folder je Typ, ExtendedData). NICHT aus einem
// echten Abruf – sobald von einer PL-/EU-IP möglich, durch echte Antwort ersetzen.
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- PANSA DroneMap export -->
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>DroneMap</name>
  <Style id="DRA-P"><PolyStyle><color>7f0000ff</color></PolyStyle></Style>
  <Style id="style_DRAR_G2"><PolyStyle><color>7f00a5ff</color></PolyStyle></Style>
  <Folder>
    <name>DRA-P</name>
    <Placemark id="DRAP-EPWA-CTR1KM">
      <name>EPWA CTR1KM</name>
      <description><![CDATA[<p>Strefa zakazu lotów dronów wokół lotniska Warszawa-Okęcie.</p>]]></description>
      <styleUrl>#DRA-P</styleUrl>
      <ExtendedData>
        <Data name="type"><value>CTR1KM</value></Data>
        <Data name="lowerLimit"><value>GND</value></Data>
        <Data name="upperLimit"><value>UNL</value></Data>
      </ExtendedData>
      <Polygon>
        <extrude>0</extrude>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs><LinearRing><coordinates>
          20.95,52.15,0 21.00,52.15,0 21.00,52.18,0 20.95,52.18,0 20.95,52.15,0
        </coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
    <Placemark id="DRAP-EPKK-ATZ6KM">
      <name>EPKK ATZ6KM</name>
      <ExtendedData>
        <SchemaData schemaUrl="#zones">
          <SimpleData name="kategoria">G1</SimpleData>
          <SimpleData name="max">100</SimpleData>
          <SimpleData name="uom">ft</SimpleData>
          <SimpleData name="reference">AGL</SimpleData>
        </SchemaData>
      </ExtendedData>
      <MultiGeometry>
        <Polygon>
          <outerBoundaryIs><LinearRing><coordinates>19.70,50.00 19.90,50.00 19.90,50.15 19.70,50.15</coordinates></LinearRing></outerBoundaryIs>
          <innerBoundaryIs><LinearRing><coordinates>19.78,50.06 19.82,50.06 19.82,50.09 19.78,50.09 19.78,50.06</coordinates></LinearRing></innerBoundaryIs>
        </Polygon>
        <Polygon>
          <outerBoundaryIs><LinearRing><coordinates>19.95,50.20 20.00,50.20 20.00,50.25 19.95,50.20</coordinates></LinearRing></outerBoundaryIs>
        </Polygon>
        <Point><coordinates>19.80,50.08</coordinates></Point>
      </MultiGeometry>
    </Placemark>
  </Folder>
  <kml:Folder>
    <kml:name>DRA-R</kml:name>
    <kml:Placemark>
      <kml:name>DRA-R Elektrownia Bełchatów &amp; okolice</kml:name>
      <kml:description>&lt;table&gt;&lt;tr&gt;&lt;td&gt;Dolna granica&lt;/td&gt;&lt;td&gt;GND&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Górna granica&lt;/td&gt;&lt;td&gt;150 m n.p.t.&lt;/td&gt;&lt;/tr&gt;&lt;tr&gt;&lt;td&gt;Uwagi&lt;/td&gt;&lt;td&gt;Wymagana zgoda zarządzającego&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</kml:description>
      <kml:styleUrl>#style_DRAR_G2</kml:styleUrl>
      <kml:Polygon>
        <kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>19.30,51.25 19.36,51.25 19.36,51.28 19.30,51.28 19.30,51.25</kml:coordinates></kml:LinearRing></kml:outerBoundaryIs>
      </kml:Polygon>
    </kml:Placemark>
    <!-- Dublette (gleiche ID + Geometrie) -->
    <Placemark id="DRAR-001"><name>DRA-R Zakład</name>
      <ExtendedData><Data name="Typ"><value>DRA-R</value></Data><Data name="Wysokość"><value>0-120 m AGL</value></Data>
        <Data name="validFrom"><value>01.11.2026</value></Data><Data name="validTo"><value>2099-12-31T23:59:00Z</value></Data></ExtendedData>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>18.60,54.35 18.62,54.35 18.62,54.36 18.60,54.35</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
    <Placemark id="DRAR-001"><name>DRA-R Zakład</name>
      <ExtendedData><Data name="Typ"><value>DRA-R</value></Data></ExtendedData>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>18.60,54.35 18.62,54.35 18.62,54.36 18.60,54.35</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </kml:Folder>
  <Folder>
    <name>DRA-I</name>
    <Placemark>
      <name>Rezerwat przyrody Łężczok</name>
      <Polygon>
        <altitudeMode>relativeToGround</altitudeMode>
        <outerBoundaryIs><LinearRing><coordinates>18.25,50.12,120 18.28,50.12,120 18.28,50.14,120 18.25,50.14,120 18.25,50.12,120</coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Folder>
  <Folder><name>CTR</name>
    <Placemark><name>EPWA CTR</name><ExtendedData><Data name="type"><value>CTR</value></Data></ExtendedData>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>20.8,52.0 21.2,52.0 21.2,52.3 20.8,52.0</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Folder>
  <Placemark><name>Bez typu</name>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>17.0,51.0 17.1,51.0 17.1,51.1 17.0,51.0</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
  <Placemark><name>Nur Punkt</name><Point><coordinates>17.0,51.0</coordinates></Point></Placemark>
</Document>
</kml>`;

describe("kmlParse", () => {
  it("Entities, CDATA, Kommentare, Namespaces", () => {
    assert.equal(decodeXmlEntities("a &amp; b &#261; &#x142; &lt;x&gt; &foo;"), "a & b ą ł <x> &foo;");
    const root = parseXml(`<?xml version="1.0"?><!DOCTYPE x><a:r x='1' y="&quot;2&quot;"><!-- c --><b>t<![CDATA[<i>]]></b><c/></a:r>`);
    const r = root.children[0];
    assert.equal(r.name, "r");
    assert.deepEqual(r.attrs, { x: "1", y: '"2"' });
    assert.equal(r.children[0].text, "t<i>");
    assert.equal(r.children[1].name, "c");
  });
  it("Koordinaten: lon,lat[,alt], Leerzeichen um Kommas, Ungültiges verworfen", () => {
    assert.deepEqual(parseKmlCoordinates(" 19.1,50.2,10\n19.2, 50.3  x,y 500,1 19.3,50.4 "), [
      [19.1, 50.2, 10],
      [19.2, 50.3],
      [19.3, 50.4],
    ]);
  });
  it("Placemarks mit Folder-Pfad, ExtendedData, MultiGeometry und Löchern", () => {
    const pms = parseKmlPlacemarks(KML);
    assert.equal(pms.length, 9);
    const ctr1 = pms[0];
    assert.equal(ctr1.id, "DRAP-EPWA-CTR1KM");
    assert.deepEqual(ctr1.folders, ["DroneMap", "DRA-P"]);
    assert.equal(ctr1.data.type, "CTR1KM");
    assert.equal(ctr1.polygons[0].altitudeMode, "clampToGround");
    assert.equal(ctr1.polygons[0].rings[0].length, 5);
    const atz = pms[1];
    assert.equal(atz.polygons.length, 2);
    assert.equal(atz.polygons[0].rings.length, 2, "innerBoundaryIs als Loch");
    // offener Ring wird geschlossen
    const r0 = atz.polygons[0].rings[0];
    assert.deepEqual(r0[0], r0[r0.length - 1]);
    assert.equal(atz.otherGeometryCount, 1);
    assert.equal(atz.data.kategoria, "G1");
    assert.equal(pms[2].name, "DRA-R Elektrownia Bełchatów & okolice");
    assert.match(pms[2].description ?? "", /<table>/);
    assert.equal(pms[8].polygons.length, 0);
  });
  it("Beschreibungs-Tabelle und HTML → Text", () => {
    assert.deepEqual(kmlDescriptionTable("<table><tr><th>Górna:</th><td>120 m</td></tr><tr><td>x</td></tr></table>"), {
      Górna: "120 m",
    });
    assert.equal(htmlToText("<p>Ala&nbsp;ma</p><br/>kota"), "Ala ma\nkota");
  });
});

describe("polishGeozones – Bausteine", () => {
  it("Typ-Mapping", () => {
    assert.equal(classifyPolishTypeValue("DRA-P")?.restriction, "PROHIBITED");
    assert.equal(classifyPolishTypeValue("MCTR2KM")?.restriction, "PROHIBITED");
    assert.equal(classifyPolishTypeValue("drar")?.restriction, "REQ_AUTHORISATION");
    assert.equal(classifyPolishTypeValue("DRA_I")?.restriction, "CONDITIONAL");
    assert.equal(classifyPolishTypeValue("R")?.cls, "AIRSPACE");
    assert.equal(classifyPolishTypeText("EPWA CTR")?.cls, "AIRSPACE");
    assert.equal(classifyPolishTypeText("EPWA CTR6KM")?.code, "CTR6KM");
    assert.equal(classifyPolishTypeText("#style_DRAR_G2")?.cls, "DRAR");
    // Einzelbuchstaben nie aus Freitext
    assert.equal(classifyPolishTypeText("EP R 12 Park"), null);
    assert.equal(classifyPolishTypeText("DRAPERY"), null);
  });
  it("Höhen", () => {
    assert.deepEqual(parsePolishAltitude("GND"), { meters: 0, reference: "AGL" });
    assert.deepEqual(parsePolishAltitude("UNL"), { unlimited: true });
    assert.deepEqual(parsePolishAltitude("120 m AGL"), { meters: 120, reference: "AGL" });
    assert.deepEqual(parsePolishAltitude("500 ft AMSL"), { meters: 152.4, reference: "AMSL" });
    assert.deepEqual(parsePolishAltitude("FL95"), { meters: 2895.6, reference: "AMSL" });
    assert.deepEqual(parsePolishAltitude("300 m n.p.m."), { meters: 300, reference: "AMSL" });
    assert.deepEqual(parsePolishAltitude("100", "ft", "AGL"), { meters: 30.5, reference: "AGL" });
    const [lo, up] = parsePolishAltitudeRange("0-120 m AGL");
    assert.deepEqual(lo, { meters: 0, reference: "AGL" });
    assert.deepEqual(up, { meters: 120, reference: "AGL" });
    const [lo2, up2] = parsePolishAltitudeRange("GND - 1000 ft AMSL");
    assert.equal(lo2?.meters, 0);
    assert.deepEqual(up2, { meters: 304.8, reference: "AMSL" });
  });
  it("Datum, Token, URL", () => {
    assert.equal(parsePolishDate("01.11.2026"), Date.UTC(2026, 10, 1));
    assert.equal(parsePolishDate("2099-12-31T23:59:00Z"), Date.UTC(2099, 11, 31, 23, 59));
    assert.equal(parsePolishDate("bzdura"), null);
    assert.equal(parsePansaLoginToken({ token: "abc.def.ghi" }), "abc.def.ghi");
    assert.equal(parsePansaLoginToken('{"data":{"accessToken":"xyz"}}'), "xyz");
    assert.equal(parsePansaLoginToken({}), null);
    assert.equal(
      PANSA_KML_REQUEST_URL,
      "https://api.dronemap.pansa.pl/v1/kml/filtered?extrude=false&types=DRAP,DRAR,DRAI&max=3000",
    );
    assert.match(buildPansaKmlUrl(["DRAP"], 120), /types=DRAP&max=120$/);
  });
});

describe("polishGeozones – KML → Zonen", () => {
  const features = normalizePolishKml(KML);
  const byName = (n: string) => features.find((f) => f.properties.name === n)!;

  it("Auswahl: Dublette entfernt, CTR ohne includeAirspace verworfen, Punkt ignoriert", () => {
    assert.deepEqual(
      features.map((f) => f.properties.name),
      ["EPWA CTR1KM", "EPKK ATZ6KM", "DRA-R Elektrownia Bełchatów & okolice", "DRA-R Zakład", "Rezerwat przyrody Łężczok", "Bez typu"],
    );
    const withAir = normalizePolishKml(KML, { includeAirspace: true, unknownAs: "skip" });
    const ctr = withAir.find((f) => f.properties.name === "EPWA CTR")!;
    assert.equal(ctr.properties.restriction, "NO_RESTRICTION");
    assert.equal(ctr.properties.plAirspace, true);
    assert.equal(withAir.some((f) => f.properties.name === "Bez typu"), false);
  });

  it("DRAP aus ExtendedData, GND–UNL, Polnisch unverändert", () => {
    const f = byName("EPWA CTR1KM");
    assert.equal(f.properties.restriction, "PROHIBITED");
    assert.equal(f.properties.plZoneType, "CTR1KM");
    assert.equal(f.properties.lowerMeters, 0);
    assert.equal(f.properties.upperMeters, undefined);
    assert.equal(f.properties.source, PL_GEOZONE_SOURCE_LABEL);
    assert.match(f.properties.message, /^Strefa zakazu lotów dronów wokół lotniska Warszawa-Okęcie\./);
    assert.equal(f.geometry.type, "Polygon");
  });

  it("ATZ6KM: MultiPolygon mit Loch, Kategorie G1, 100 ft → 30,5 m", () => {
    const f = byName("EPKK ATZ6KM");
    assert.equal(f.properties.restriction, "PROHIBITED");
    assert.equal(f.geometry.type, "MultiPolygon");
    assert.equal(f.geometry.coordinates[0].length, 2);
    assert.equal(f.properties.plGeozoneCategory, "G1");
    assert.equal(f.properties.upperMeters, 30.5);
    assert.equal(f.properties.plAltitudeSource, "extendedData");
  });

  it("DRAR: Typ aus Name/Folder, Höhen aus Beschreibungs-Tabelle (n.p.t. = AGL)", () => {
    const f = byName("DRA-R Elektrownia Bełchatów & okolice");
    assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f.properties.upperMeters, 150);
    assert.equal(f.properties.upperReference, "AGL");
    assert.equal(f.properties.plAltitudeSource, "description");
    assert.equal(f.properties.plGeozoneCategory, "G2");
    assert.match(f.properties.message, /Uwagi: Wymagana zgoda zarządzającego/);
  });

  it("DRAR mit Bereichsfeld und Gültigkeit", () => {
    const f = byName("DRA-R Zakład");
    assert.equal(f.properties.lowerMeters, 0);
    assert.equal(f.properties.upperMeters, 120);
    assert.equal(f.properties.validStartTs, Date.UTC(2026, 10, 1));
    assert.equal(f.properties.validEndTs, Date.UTC(2099, 11, 31, 23, 59));
  });

  it("DRAI → CONDITIONAL, Obergrenze aus relativeToGround-Höhe", () => {
    const f = byName("Rezerwat przyrody Łężczok");
    assert.equal(f.properties.restriction, "CONDITIONAL");
    assert.equal(f.properties.upperMeters, 120);
    assert.equal(f.properties.plAltitudeSource, "geometry");
    // Koordinaten 2D
    assert.equal(f.geometry.coordinates[0][0].length, 2);
  });

  it("unbekannter Typ → vorsorglich REQ_AUTHORISATION", () => {
    const f = byName("Bez typu");
    assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f.properties.plTypeUnknown, true);
  });

  it("finalize + parseEd269ToGeozoneInfo lesen die Zonen", () => {
    const fin = polandFeaturesFromKml(KML);
    assert.equal(fin.length, 6);
    assert.ok(fin.every((f) => f.properties._country === "pl" && Array.isArray(f.bbox)));
    const infos = parseEd269ToGeozoneInfo(fin, "pl");
    assert.equal(infos.length, 6);
    const ctr = infos.find((z) => z.featureId === "DRAP-EPWA-CTR1KM")!;
    assert.equal(ctr.restriction, "PROHIBITED");
    assert.equal(ctr.lowerMeters, 0);
    assert.equal(ctr.country, "PL");
    const atz = infos.find((z) => z.featureId === "DRAP-EPKK-ATZ6KM")!;
    assert.equal(atz.polygonGroups.length, 2);
    assert.equal(atz.polygonGroups[0].length, 2);
  });
});
