// UK-Primärquelle: NATS-Digitaldatensatz AIXM 5.1 (docs/uk-geozones-integration.md §7).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

import { Sha256, parseSha256File, sha256Hex } from "../../../shared/sha256";
import {
  AixmIntegrityError,
  AixmMemberSplitter,
  aixmLengthToMeters,
  aixmPosList,
  densifyArc,
  densifyCircle,
  destinationPoint,
  distanceM,
  parseAixmDataset,
  parseAixmDatasetSync,
  parseAixmZip,
  ringAreaM2,
  type AixmDataset,
  type LonLat,
} from "../../../shared/geozoneKit/aixm";
import {
  GB_GEOZONE_SOURCE_LABEL,
  normalizeUkAixmWithStats,
  translateUkTimesSentence,
  ukAixmCandidateDates,
  ukAixmZipUrl,
  ukZoneGroupStem,
} from "../../../shared/ukGeozones";
import { loadUnitedKingdom, type UkFetchEnv, type UkHttpResponse, getLastUkFetchReport } from "../geozoneDirect/ukSource";
import { parseEd269ToGeozoneInfo, zoneActivityAt } from "../ed269";
import { temporarySourceOf, geozoneRefreshPolicy } from "../../../shared/geozoneSourceMeta";

// Gekürzter ECHTER Auszug aus EG_UAS_FR_DS_AREA1_FULL_20261029_XML.zip (NATS,
// abgerufen 2026-11-15): 11 Airspaces + 1 GeoBorder, siehe Kopfkommentar der Datei.
const FIXTURE = join(__dirname, "fixtures/gb-nats-aixm-sample.xml");
const xml = readFileSync(FIXTURE, "utf8");
const kml = readFileSync(join(__dirname, "fixtures/gb-uk-aip-sample.kml"), "utf8");
const ds: AixmDataset = parseAixmDatasetSync(xml);
const byDes = (d: string) => ds.airspaces.find((a) => a.designator === d)!;
const ring = (d: string): LonLat[] => byDes(d).volumes[0].polygons[0][0];

function natsZip(xmlText: string, opts: { sha?: string | null; name?: string } = {}): Uint8Array {
  const name = opts.name ?? "EG_UAS_FR_DS_AREA1_FULL_20261029";
  const bytes = strToU8(xmlText);
  const files: Record<string, Uint8Array> = { [`${name}.xml`]: bytes, "export-filter.xml": strToU8("<ImpExpConfiguration/>") };
  const sha = opts.sha === undefined ? createHash("sha256").update(bytes).digest("hex") : opts.sha;
  if (sha !== null) files[`${name}.sha256`] = strToU8(`${sha} *${name}.xml\n`);
  return zipSync(files);
}

describe("sha256 (pure TS)", () => {
  it("bekannte Testvektoren", () => {
    assert.equal(sha256Hex(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(sha256Hex(strToU8("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(
      sha256Hex(strToU8("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("stimmt bei beliebigen Längen und Stückelungen mit node:crypto überein", () => {
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 70_001]) {
      const buf = new Uint8Array(randomBytes(n));
      const ref = createHash("sha256").update(buf).digest("hex");
      assert.equal(sha256Hex(buf), ref, `n=${n}`);
      const h = new Sha256();
      for (let i = 0; i < n; i += 37) h.update(buf.subarray(i, Math.min(n, i + 37)));
      assert.equal(h.digestHex(), ref, `chunked n=${n}`);
    }
  });

  it("liest .sha256-Dateien im NATS-Format", () => {
    const r = parseSha256File("AD569A9B91627F0C467B6392959F5524577BFA92AE15F9B08E51E3232F5D9783 *EG_UAS_FR_DS_AREA1_FULL_20261029.xml\n");
    assert.equal(r?.hash, "ad569a9b91627f0c467b6392959f5524577bfa92ae15f9b08e51e3232f5d9783");
    assert.equal(r?.fileName, "EG_UAS_FR_DS_AREA1_FULL_20261029.xml");
    assert.equal(parseSha256File("kein hash"), null);
  });
});

describe("AIXM-Parser – Grundlagen", () => {
  it("gml:pos „lat lon“ → [lon, lat]", () => {
    assert.deepEqual(aixmPosList("51.6813694 -1.9814111"), [[-1.9814111, 51.6813694]]);
    assert.deepEqual(aixmPosList("1 2 3 4"), [[2, 1], [4, 3]]);
  });

  it("Radius-Einheiten", () => {
    assert.equal(aixmLengthToMeters(2, "[nmi_i]"), 3704);
    assert.equal(aixmLengthToMeters(1000, "[ft_i]"), 304.8);
    assert.equal(aixmLengthToMeters(2300, "m"), 2300);
    assert.equal(aixmLengthToMeters(1.5, "KM"), 1500);
    assert.equal(aixmLengthToMeters(1, "furlong"), null);
  });

  it("Bogen: Peilung ab Nord, Richtung aus dem Vorzeichen, 3°-Schritte", () => {
    const c: LonLat = [0, 52];
    const cw = densifyArc(c, 1852, 0, 90);
    assert.equal(cw.length, 31); // 90°/3° + 1
    assert.ok(cw[0][1] > 52 && Math.abs(cw[0][0]) < 1e-9); // Start Nord
    assert.ok(cw[cw.length - 1][0] > 0 && Math.abs(cw[cw.length - 1][1] - 52) < 1e-4); // Ende Ost
    assert.ok(cw[15][0] > 0 && cw[15][1] > 52); // über Nordost (im Uhrzeigersinn)
    const ccw = densifyArc(c, 1852, 0, -90);
    assert.ok(ccw[15][0] < 0 && ccw[15][1] > 52); // über Nordwest (gegen den Uhrzeigersinn)
    for (const p of cw) assert.ok(Math.abs(distanceM(c, p) - 1852) < 6); // Kugel vs. Ellipsoid
    const circle = densifyCircle(c, 1000);
    assert.equal(circle.length, 121);
    assert.deepEqual(circle[0], circle[circle.length - 1]);
  });

  it("Zielpunkt auf dem WGS84-Ellipsoid (Vincenty): 1 NM nach Nord bei 52° ≈ 0,01665° Breite", () => {
    const p = destinationPoint([0, 52], 1852, 0);
    assert.ok(Math.abs(p[1] - 52 - 0.016646) < 0.00002, String(p[1] - 52));
  });

  it("Splitter liefert dieselben Blöcke bei beliebiger Stückelung", () => {
    const whole = new AixmMemberSplitter().push(xml);
    assert.equal(whole.length, 12);
    const sp = new AixmMemberSplitter();
    const parts: string[] = [];
    for (let i = 0; i < xml.length; i += 997) parts.push(...sp.push(xml.slice(i, i + 997)));
    assert.deepEqual(parts, whole);
  });
});

describe("AIXM-Parser – echte NATS-Fixture", () => {
  it("liest Lufträume, GeoBorder, Kennungen, Typen, AIRAC", () => {
    assert.equal(ds.airspaces.length, 11);
    assert.equal(ds.borders.length, 1);
    assert.equal(ds.validTime, "2026-10-29T00:00:00Z");
    const e = byDes("EGR1U010E");
    assert.equal(e.type, "R");
    assert.equal(e.localType, "RPZ");
    assert.equal(e.name, "KEMBLE RWY 26G");
    assert.equal(e.uuid, "e58f41d8-9c6c-4ff6-9e5e-ed6b78bcacbf");
    assert.equal(byDes("EGR312").localType, undefined); // xsi:nil
    assert.deepEqual(byDes("EGR312").volumes[0].upper, { value: "2100", uom: "FT", reference: "MSL", height: byDes("EGR312").volumes[0].upper!.height });
    assert.equal(byDes("EGR312").volumes[0].upper!.height!.ref, "MSL");
    assert.equal(byDes("EGR1U010E").volumes[0].upper!.height!.ref, "AGL"); // SFC, nie pauschal
    assert.equal(byDes("EGD323G").volumes[0].lower!.uom, "FL");
  });

  it("Kreis (EGR312): Mittelpunkt getauscht, Radius 2 NM, geschlossen", () => {
    const r = ring("EGR312");
    const c: LonLat = [-2.80417, 53.77611];
    assert.equal(r.length, 121);
    assert.deepEqual(r[0], r[r.length - 1]);
    for (const p of r) assert.ok(Math.abs(distanceM(c, p) - 3704) < 15);
  });

  it("Bogen (EGR1U010E): beginnt/endet an den Nachbarpunkten – Peilungs-Konvention bestätigt", () => {
    const r = ring("EGR1U010E");
    // Ringpunkte vor/nach dem Bogen laut Datei
    const before: LonLat = [-2.003553944, 51.669930611];
    const after: LonLat = [-2.006303056, 51.678757056];
    const iB = r.findIndex((p) => distanceM(p, before) < 1);
    const iA = r.findIndex((p) => distanceM(p, after) < 1);
    assert.ok(iB >= 0 && iA > iB);
    // Bogenpunkte (iB+1 … iA-1) liegen auf 2 NM um den Mittelpunkt, und
    // die Bogenenden schließen nahtlos (< 15 m) an die Nachbarpunkte an.
    const center: LonLat = [-2.0570083, 51.6680611];
    assert.ok(Math.abs(distanceM(center, r[iB]) - 3704) < 15);
    assert.ok(Math.abs(distanceM(center, r[iA]) - 3704) < 15);
    // Mit „mathematischen“ Winkeln (ab Ost, gegen den Uhrzeigersinn) läge der Bogen woanders:
    const wrong = densifyArc(center, 3704, 86.76, 71.24, { angles: "math" });
    assert.ok(distanceM(wrong[0], before) > 1000);
    const right = densifyArc(center, 3704, 86.76, 71.24);
    assert.ok(distanceM(right[0], before) < 15 && distanceM(right[right.length - 1], after) < 15);
  });

  it("Flächen stimmen mit dem amtlichen NATS-KML überein (±1 %)", () => {
    // ringAreaM2 der NATS-KML-Polygone (EG_UAS_FR_DS_AREA1_FULL_20261029_KML.zip)
    const natsKml: Record<string, number> = {
      EGR1U010A: 42863150, EGR1U010B: 2118360, EGR1U010E: 1708059, EGR312: 42842721, EGD218A: 394528136,
      EGP611: 42821140, EGD401: 15596476, EGR1U005A: 63902658, EGD410: 2597609, EGD442: 16499204, EGD323G: 579771202,
    };
    for (const [d, ref] of Object.entries(natsKml)) {
      const a = ringAreaM2(ring(d));
      assert.ok(Math.abs(a - ref) / ref < 0.01, `${d}: ${a} vs ${ref}`);
    }
  });

  it("negative Winkel (EGR1U005A), Radius in ft (EGD410) und m (EGD442)", () => {
    assert.match(xml, /startAngle uom="deg">-/);
    for (const d of ["EGR1U005A", "EGD410", "EGD442"]) {
      const r = ring(d);
      assert.ok(r.length > 20, d);
      assert.deepEqual(r[0], r[r.length - 1]);
    }
  });

  it("GeoBorder-Verweis (EGD401 → UK RIVER 1) wird aufgelöst", () => {
    const a = byDes("EGD401");
    assert.equal(a.unresolvedBorders, undefined);
    assert.ok(ring("EGD401").length >= 11);
    // Ohne die Grenze bleibt der Verweis offen und wird gemeldet
    const without = parseAixmDatasetSync(xml.replace(/<message:hasMember[^>]*>\s*<aixm:GeoBorder[\s\S]*?<\/message:hasMember>/, ""));
    assert.deepEqual(without.airspaces.find((x) => x.designator === "EGD401")!.unresolvedBorders, ["88fae693-c53c-491f-8df1-dd5a2400f14e"]);
  });

  it("asynchrones Parsen gibt dem JS-Thread Pausen und liefert dasselbe", async () => {
    let yields = 0;
    const r = await parseAixmDataset(xml, { yieldEvery: 3, yieldFn: async () => void yields++ });
    assert.ok(yields >= 3);
    assert.equal(r.airspaces.length, 11);
    assert.deepEqual(r.airspaces.map((a) => a.designator), ds.airspaces.map((a) => a.designator));
  });
});

describe("AIXM-ZIP + SHA-256", () => {
  it("entpackt streamend und prüft die Prüfsumme", async () => {
    let yields = 0;
    const r = await parseAixmZip(natsZip(xml), { requireSha256: true, zipChunkBytes: 4096, yieldEvery: 2, yieldFn: async () => void yields++ });
    assert.equal(r.sha256.ok, true);
    assert.equal(r.sha256.actual, createHash("sha256").update(strToU8(xml)).digest("hex"));
    assert.equal(r.xmlName, "EG_UAS_FR_DS_AREA1_FULL_20261029.xml");
    assert.equal(r.airspaces.length, 11);
    assert.ok(yields > 3);
  });

  it("falsche Prüfsumme → AixmIntegrityError", async () => {
    await assert.rejects(parseAixmZip(natsZip(xml, { sha: "0".repeat(64) }), { yieldFn: async () => {} }), AixmIntegrityError);
  });

  it("fehlende Prüfsumme nur mit requireSha256 ein Fehler", async () => {
    const zip = natsZip(xml, { sha: null });
    const r = await parseAixmZip(zip, { yieldFn: async () => {} });
    assert.equal(r.sha256.ok, null);
    await assert.rejects(parseAixmZip(zip, { requireSha256: true, yieldFn: async () => {} }), AixmIntegrityError);
  });
});

describe("ukGeozones – AIXM-Normalisierung", () => {
  const r = normalizeUkAixmWithStats(ds);
  const f = (d: string) => r.features.find((x) => x.properties.identifier === d)!;

  it("Einstufung je Typ: P → PROHIBITED, R/FRZ/RPZ → REQ_AUTHORISATION, D → CONDITIONAL", () => {
    assert.equal(r.airac, "2026-10-29");
    assert.equal(f("EGP611").properties.restriction, "PROHIBITED");
    assert.equal(f("EGR1U010A").properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f("EGR1U010E").properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f("EGR312").properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f("EGD218A").properties.restriction, "CONDITIONAL");
    for (const x of r.features) {
      assert.equal(x.properties.source, GB_GEOZONE_SOURCE_LABEL);
      assert.equal(x.properties.ukDataset, "NATS-AIXM");
      assert.equal(x.properties.ukAirac, "2026-10-29");
    }
  });

  it("Höhen mit Einheit und Bezug (SFC → AGL, MSL, FL → STD verworfen oberhalb FL125)", () => {
    const rpz = f("EGR1U010E").properties;
    assert.equal(rpz.lowerMeters, 0);
    assert.equal(rpz.lowerReference, "AGL");
    assert.equal(rpz.upperMeters, 609.6);
    assert.equal(rpz.upperReference, "AGL");
    assert.equal(rpz.ukUpperLimit, "2000 FT SFC");
    const springfields = f("EGR312").properties;
    assert.equal(springfields.upperMeters, 640.1);
    assert.equal(springfields.upperReference, "MSL");
    assert.deepEqual(
      r.dropped.map((d) => [d.name.split(" ")[0], d.reason]),
      [["EGD323G", "lower_msl"]],
    );
    assert.match(f("EGR1U010E").properties.message, /Höhe laut AIP: Boden \(GND\) bis 2\.000 ft über Grund \(≈ 610 m\)/);
  });

  it("FRZ + RPZ eines Flugplatzes: gemeinsamer Stamm, getrennte Geometrien", () => {
    assert.equal(ukZoneGroupStem("EGR1U010B", "RPZ"), "EGR1U010");
    assert.equal(ukZoneGroupStem("EGR1U108", "FRZ"), "EGR1U108");
    assert.equal(ukZoneGroupStem("EGR312", undefined), undefined);
    assert.equal(r.groups, 1);
    const members = ["EGR1U010A", "EGR1U010B", "EGR1U010E"];
    for (const d of members) {
      const p = f(d).properties;
      assert.equal(p.ukGroup, "EGR1U010");
      assert.equal(p.ukGroupName, "KEMBLE");
      assert.deepEqual(p.ukGroupMembers, members);
      assert.match(p.message, /Gehört zu: Flugbeschränkungszone KEMBLE \(EGR1U010\) – FRZ und Runway Protection Zones bilden rechtlich EINE zusammenhängende Zone/);
      assert.match(p.message, /Teile: EGR1U010A FRZ, EGR1U010B RPZ \(RWY 08\), EGR1U010E RPZ \(RWY 26G\)/);
      assert.equal(f(d).geometry.type, "Polygon");
    }
    assert.match(f("EGR1U010E").properties.message, /^Typ: Runway Protection Zone \(RPZ\) – Teil der Flugbeschränkungszone/);
    assert.match(f("EGR1U010A").properties.message, /^Typ: Flugbeschränkungszone \(FRZ\) um einen Flugplatz/);
    assert.equal(f("EGR312").properties.ukGroup, undefined);
  });

  it("deutsche Meldung mit Originaltext; vorhandenes UK-Wörterbuch greift", () => {
    const m: string = f("EGR1U010A").properties.message;
    assert.match(m, /Flugbeschränkungszone \(FRZ\) des Flugplatzes – durchgehend aktiv \(H24\)/);
    assert.match(m, /Quelle: UK AIP \(CAA\) – NATS-Digitaldatensatz .*AIRAC 29\.10\.2026/);
    assert.match(m, /\nOriginaltext der Behörde:\nUpper limit: 2000 FT SFC\nLower limit: SFC\n\nFRZ Active H24/);
    assert.equal((m.match(/Originaltext der Behörde/g) ?? []).length, 1);
    const loc = f("EGR1U010A").properties.extendedProperties.localizedMessages;
    assert.deepEqual(loc.map((x: any) => x.language), ["de", "en"]);
    assert.equal(f("EGR312").properties.applicationUrl, "https://portal.caa.co.uk");
  });

  it("Aktivierung: Status + Zeitplan SS–SR → applicability (zoneActivityAt)", () => {
    const p = f("EGD218A").properties;
    assert.equal(p.ukActivation, "OTHER");
    assert.deepEqual(p.applicability, [{ schedule: [{ startEvent: "SS", endEvent: "SR" }] }]);
    assert.match(
      p.message,
      /Aktivierung: besondere Regelung \(siehe Zeiten\/Hinweise\) – Zeiten: Sonnenuntergang bis Sonnenaufgang – Aktivierung per NOTAM\. – Nur nachts \(HN/,
    );
    const [info] = parseEd269ToGeozoneInfo([{ ...f("EGD218A"), properties: { ...p } } as any], "GB");
    assert.equal(zoneActivityAt(info, new Date("2026-11-15T12:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(info, new Date("2026-11-15T23:00:00Z")), "active");
  });

  it("AIP-Zeiten deutsch (UTC, Klammer = Sommer)", () => {
    assert.equal(
      translateUkTimesSentence("Mon-Thu 0800-1700 (0700-1600), Fri 0800-1400 (0700-1300); and as activated by NOTAM."),
      "Mo–Do 0800–1700 (Sommer 0700–1600), Fr 0800–1400 (Sommer 0700–1300) sowie bei Aktivierung per NOTAM (Zeiten UTC).",
    );
    assert.equal(translateUkTimesSentence("Mon-Sat SR to SS."), "Mo–Sa Sonnenaufgang bis Sonnenuntergang (Zeiten UTC).");
    assert.equal(translateUkTimesSentence("In the period 0001 hours on 16th May"), null);
  });

  it("App-Pfad: parseEd269ToGeozoneInfo", () => {
    const infos = parseEd269ToGeozoneInfo(r.features as any, "GB");
    assert.equal(infos.length, r.features.length);
    const frz = infos.find((i) => i.featureId === "EGR1U010A")!;
    assert.equal(frz.restriction, "REQ_AUTHORISATION");
    assert.equal(frz.lowerReference, "AGL");
    assert.match(frz.details, /Gehört zu: Flugbeschränkungszone KEMBLE/);
    assert.equal((frz.details.match(/Originaltext der Behörde/g) ?? []).length, 1);
  });
});

describe("ukSource – Dateiwahl, bedingter Abruf, Rückfall auf KML", () => {
  it("wählt den laufenden AIRAC-Zyklus (nächster liegt schon online, gilt aber noch nicht)", () => {
    assert.deepEqual(ukAixmCandidateDates(Date.UTC(2026, 10, 15, 12)), ["20261029", "20261001"]);
    assert.deepEqual(ukAixmCandidateDates(Date.UTC(2026, 10, 26, 0, 30)), ["20261126", "20261029"]);
    assert.equal(
      ukAixmZipUrl("20261029"),
      "https://nats-uk.ead-it.com/cms-nats/export/sites/default/en/Publications/digital-datasets/UAS_AREA_1/EG_UAS_FR_DS_AREA1_FULL_20261029_XML.zip",
    );
  });

  const NOW = Date.UTC(2026, 10, 15, 12);
  function env(over: Partial<UkFetchEnv> & { responses?: Record<string, UkHttpResponse> }): UkFetchEnv & { calls: { url: string; ims?: string }[]; logs: string[] } {
    const calls: { url: string; ims?: string }[] = [];
    const logs: string[] = [];
    return {
      now: () => NOW,
      async getBytes(url, ims) {
        calls.push({ url, ims });
        return over.responses?.[url] ?? { status: 404 };
      },
      async getText() {
        return kml;
      },
      async stored() {
        return null;
      },
      log: (m) => logs.push(m),
      ...over,
      calls,
      logs,
    };
  }

  it("AIXM ok → AIXM-Zonen (_country gb, bbox)", async () => {
    const e = env({ responses: { [ukAixmZipUrl("20261029")]: { status: 200, bytes: natsZip(xml) } } });
    const fs = await loadUnitedKingdom(e, { yieldFn: async () => {} });
    assert.equal(fs.length, 10);
    assert.ok(fs.every((x) => x.properties?._country === "gb" && Array.isArray(x.bbox) && x.properties?.ukDataset === "NATS-AIXM"));
    assert.equal(getLastUkFetchReport()?.source, "aixm");
    assert.equal(e.calls[0].ims, undefined);
  });

  it("laufender Zyklus fehlt (404) → Vorgänger", async () => {
    const e = env({ responses: { [ukAixmZipUrl("20261001")]: { status: 200, bytes: natsZip(xml) } } });
    const fs = await loadUnitedKingdom(e, { yieldFn: async () => {} });
    assert.equal(fs.length, 10);
    assert.deepEqual(e.calls.map((c) => c.url), [ukAixmZipUrl("20261029"), ukAixmZipUrl("20261001")]);
  });

  it("gleicher AIRAC-Stand gespeichert → If-Modified-Since, 304 → gespeicherte Zonen ohne Download", async () => {
    const stored = { fetchedAt: NOW - 3600_000, features: [{ type: "Feature", geometry: null, properties: { ukDataset: "NATS-AIXM", ukAirac: "2026-10-29" } }] as any[] };
    const e = env({ stored: async () => stored, responses: { [ukAixmZipUrl("20261029")]: { status: 304 } } });
    const fs = await loadUnitedKingdom(e);
    assert.equal(fs, stored.features);
    assert.equal(e.calls[0].ims, new Date(NOW - 3600_000).toUTCString());
    assert.equal(getLastUkFetchReport()?.source, "aixm-not-modified");
  });

  it("älterer Stand gespeichert → kein If-Modified-Since (voller Download des neuen Zyklus)", async () => {
    const stored = { fetchedAt: NOW - 3600_000, features: [{ type: "Feature", geometry: null, properties: { ukDataset: "NATS-AIXM", ukAirac: "2026-10-01" } }] as any[] };
    const e = env({ stored: async () => stored, responses: { [ukAixmZipUrl("20261029")]: { status: 200, bytes: natsZip(xml) } } });
    await loadUnitedKingdom(e, { yieldFn: async () => {} });
    assert.equal(e.calls[0].ims, undefined);
  });

  it("AIXM scheitert (Prüfsumme falsch / nicht gefunden / Netzfehler) → KML-Rückfall", async () => {
    const cases: Partial<UkFetchEnv & { responses: Record<string, UkHttpResponse> }>[] = [
      { responses: { [ukAixmZipUrl("20261029")]: { status: 200, bytes: natsZip(xml, { sha: "f".repeat(64) }) } } },
      { responses: {} },
      { getBytes: async () => { throw new Error("Network request failed"); } },
      { responses: { [ukAixmZipUrl("20261029")]: { status: 200, bytes: strToU8("<html>Wartung</html>") } } },
    ];
    for (const c of cases) {
      const e = env(c);
      const fs = await loadUnitedKingdom(e, { yieldFn: async () => {} });
      assert.equal(fs.length, 12); // KML-Fixture
      assert.ok(fs.every((x) => x.properties?.ukDataset === undefined));
      assert.equal(getLastUkFetchReport()?.source, "kml");
      assert.ok(e.logs.some((l) => /Rückfall auf die NATS-Karte/.test(l)));
    }
  });

  it("beides scheitert → Fehler (gespeicherter Bestand bleibt)", async () => {
    const e = env({ getText: async () => "<html/>" });
    await assert.rejects(loadUnitedKingdom(e, { yieldFn: async () => {} }), /kein KML/);
  });
});

describe("Registry GB", () => {
  it("keine temporären Zonen im Datensatz → kein 10-min-Neuladen; Warnung nach AIRAC-Zyklus", () => {
    assert.equal(temporarySourceOf("GB"), "none");
    assert.equal(geozoneRefreshPolicy("GB")?.staleWarnAfterMs, 28 * 86_400_000);
  });
});

// Optional: Vergleich mit dem echten Gesamtdatensatz, wenn lokal vorhanden
// (UK_AIXM_ZIP=/pfad/EG_UAS_FR_DS_AREA1_FULL_<datum>_XML.zip npm run test:lib).
const REAL_ZIP = process.env.UK_AIXM_ZIP;
describe("NATS-Gesamtdatensatz (optional)", { skip: !REAL_ZIP || !existsSync(REAL_ZIP) }, () => {
  it("1.069 Lufträume wie die KML, SHA-256 ok, Höhenfilter", async () => {
    const t = Date.now();
    const r = await parseAixmZip(new Uint8Array(readFileSync(REAL_ZIP!)), { requireSha256: true });
    const n = normalizeUkAixmWithStats(r);
    console.log(`[uk-aixm] ${r.airspaces.length} Lufträume, ${n.features.length} Zonen, ${n.groups} FRZ/RPZ-Gruppen, ${Date.now() - t} ms`);
    assert.equal(r.sha256.ok, true);
    assert.equal(r.airspaces.length, 1069);
    assert.ok(r.airspaces.every((a) => !a.unresolvedBorders));
  });
});
