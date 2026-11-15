import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BG_BULATSA_ZONES_LAYER,
  BG_CAA_ZONES_LAYER,
  BG_GEOZONE_SOURCE_LABEL,
  BG_WFS_URL,
  bgBulatsaRestriction,
  bgCaaHeights,
  bgLowerAboveDroneHeights,
  bgPreciseGeometry,
  bgTextProhibits,
  bgValidity,
  bgZoneCategory,
  bulgariaWfsCsvUrl,
  bulgariaWfsHasMore,
  bulgariaWfsUrl,
  decideBgRestriction,
  formatBgLimitDe,
  hasCyrillic,
  mergeBulgarianFeatures,
  normalizeBulgarianBulatsaZonesWithStats,
  normalizeBulgarianZones,
  normalizeBulgarianZonesWithStats,
  parseBgLimit,
  parseBulgariaWfsCsv,
  parseCsv,
  splitBgSentences,
  translateBgApplicant,
  translateBgContact,
  translateBgSentence,
  translateBgText,
  translateBgZoneName,
  transliterateBulgarian,
} from "../../../shared/bulgarianGeozones";
import { fetchBulgaria, loadBulgaria } from "../geozoneDirect/bulgariaSource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Gekürzter ECHTER Abzug des WFS uas.caa.bg (2026-11-15T03:00Z): 35 von 888
// CAA-Zonen (alle Text-/Höhen-/Einstufungsvarianten der Live-Daten, inkl.
// buffer_wkt, Loch-Polygon, englischer Texte, Freitext-„information“) samt der
// zugehörigen CSV-Zeilen (volle Präzision) sowie 7 von 16 BULATSA-Gebieten
// (inkl. is_deleted=true und kurzzeitigem LBD301).
const fx = JSON.parse(readFileSync(join(__dirname, "fixtures/bg-caa-wfs-sample.json"), "utf8"));
const NOW = new Date("2026-11-15T03:00:00Z");
const csvMap = parseBulgariaWfsCsv(fx.caaCsv);
const zones = normalizeBulgarianZones(fx.caa, { now: NOW, preciseWkt: csvMap });
const byName = (name: string) => zones.find((f) => f.properties.nameOriginal === name || f.properties.name === name);
const rawByName = (name: string) => fx.caa.features.find((f: any) => f.properties.name === name);
const clone = (x: any) => JSON.parse(JSON.stringify(x));

describe("bulgarianGeozones – WFS-URLs, Paging, CSV", () => {
  it("baut GeoJSON- und CSV-URLs (WFS 2.0, EPSG:4326, Paging)", () => {
    const u = bulgariaWfsUrl(BG_CAA_ZONES_LAYER, { count: 1000, startIndex: 1000 });
    assert.ok(u.startsWith(`${BG_WFS_URL}?service=WFS&version=2.0.0&request=GetFeature`));
    assert.ok(u.includes("typeNames=caa-uas:VGeoCAAZonesPublic"));
    assert.ok(u.includes("srsName=EPSG:4326"));
    assert.ok(u.includes("outputFormat=application%2Fjson"));
    assert.ok(u.includes("count=1000") && u.includes("startIndex=1000"));
    assert.ok(!bulgariaWfsUrl(BG_CAA_ZONES_LAYER, { startIndex: 0 }).includes("startIndex"));
    const c = bulgariaWfsCsvUrl(BG_BULATSA_ZONES_LAYER, { count: 1000 });
    assert.ok(c.includes("outputFormat=csv") && c.includes("propertyName=zone_id,shape"));
  });

  it("Paging-Entscheidung über numberMatched bzw. Seitengröße", () => {
    assert.equal(bulgariaWfsHasMore({ features: [1, 2], numberMatched: 888 }, 2, 2), true);
    assert.equal(bulgariaWfsHasMore({ features: [1, 2], numberMatched: 2 }, 2, 2), false);
    assert.equal(bulgariaWfsHasMore({ features: [1, 2] }, 2, 2), true);
    assert.equal(bulgariaWfsHasMore({ features: [1] }, 3, 2), false);
    assert.equal(bulgariaWfsHasMore({ features: [] }, 0, 2), false);
  });

  it("CSV-Parser: Anführungszeichen, \"\" und Zeilenumbrüche", () => {
    assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi""\nnext"\r\n1,2'), [
      ["a", "b"],
      ["x, y", 'say "hi"\nnext'],
      ["1", "2"],
    ]);
  });

  it("CSV des echten WFS → FID → WKT (alle Fixture-Zonen)", () => {
    assert.equal(csvMap.size, fx.caa.features.length);
    const wkt = csvMap.get("VGeoCAAZonesPublic.2")!;
    assert.ok(wkt.startsWith("POLYGON ((24.08893095127379 43.732312734659196"));
  });
});

describe("bulgarianGeozones – Geometrie (volle Präzision)", () => {
  it("ersetzt die auf 4 Stellen gerundete GeoJSON-Geometrie durch das CSV-WKT", () => {
    const aec = byName("AEC-0000002")!;
    const first = (aec.geometry.coordinates as number[][][])[0][0];
    assert.deepEqual(first, [24.08893095127379, 43.732312734659196]);
    assert.deepEqual(rawByName("AEC-0000002").geometry.coordinates[0][0], [24.0889, 43.7323]);
    assert.ok(aec.bbox && Math.abs(aec.bbox[0] - 23.4687) < 0.001);
  });

  it("ohne CSV: buffer_wkt (volle Präzision) bzw. GeoJSON als Rückfall", () => {
    const raw = rawByName("ИРТ-2000 ");
    const g = bgPreciseGeometry(raw, null)!;
    assert.deepEqual((g.coordinates as number[][][])[0][0], [23.390681, 42.651736]);
    const plain = bgPreciseGeometry(rawByName("HAIL1-0000107"), null)!;
    assert.deepEqual(plain, rawByName("HAIL1-0000107").geometry);
  });

  it("verwirft WKT mit vertauschter Achsfolge (bbox passt nicht)", () => {
    const raw = rawByName("HAIL1-0000107");
    const swapped = new Map([[raw.id, csvMap.get(raw.id)!.replace(/(\d+\.\d+) (\d+\.\d+)/g, "$2 $1")]]);
    assert.deepEqual(bgPreciseGeometry(raw, swapped), raw.geometry);
  });

  it("erhält Löcher (Maritsa Iztok 1: Außenring + Loch)", () => {
    const f = byName("Maritsa Iztok 1-0000976")!;
    assert.equal(f.geometry.type, "Polygon");
    assert.equal((f.geometry.coordinates as unknown[]).length, 2);
  });
});

describe("bulgarianGeozones – Namen, Transliteration, Etiketten", () => {
  it("transliteriert nach dem amtlichen System", () => {
    assert.equal(transliterateBulgarian("Горна Оряховица"), "Gorna Oryahovitsa");
    assert.equal(transliterateBulgarian("Цалапица Щит Жълт"), "Tsalapitsa Shtit Zhalt");
    assert.equal(transliterateBulgarian("Долна Митрополия"), "Dolna Mitropolia");
    assert.equal(transliterateBulgarian("ЖЕЛЕЗНИЦА"), "ZHELEZNITSA");
    assert.equal(hasCyrillic("Sofia"), false);
  });

  it("übersetzt Zonennamen (Gattungsbegriffe deutsch, Exonyme, Eigennamen transliteriert)", () => {
    assert.equal(translateBgZoneName("София (LBSF)-0000678"), "Sofia (LBSF)-0000678");
    assert.equal(translateBgZoneName("Русе (LBRS)-0000737"), "Russe (LBRS)-0000737");
    assert.equal(translateBgZoneName("Пловдив (LBPD)-0000680"), "Plovdiv (LBPD)-0000680");
    assert.equal(translateBgZoneName("Слънчев Бряг (LBSB)-0000741"), "Slanchev Bryag (Sonnenstrand) (LBSB)-0000741");
    assert.equal(translateBgZoneName("Язовир Студен Кладенец (LBSK)-0000743"), "Stausee Studen Kladenets (LBSK)-0000743");
    assert.equal(translateBgZoneName('Вертолетно летище "Лозен" (LBLN)-0000756'), "Hubschrauberflugplatz „Lozen“ (LBLN)-0000756");
    assert.equal(
      translateBgZoneName('БВЛ МБАЛ "Д-Р Атанас Дафовски"-0001170'),
      "Hubschrauberlandeplatz (BVL) MBAL „Dr. Atanas Dafovski“-0001170",
    );
    assert.equal(translateBgZoneName('БВЛ "МБАЛ - ШУМЕН"-0001169'), "Hubschrauberlandeplatz (BVL) „MBAL - Schumen“-0001169");
    assert.equal(translateBgZoneName("ВП_Сливен-0001172"), "Hubschrauberlandeplatz Sliven-0001172");
    assert.equal(translateBgZoneName("ИРТ-2000 "), "Forschungsreaktor IRT-2000");
    assert.equal(translateBgZoneName("МВнР-0000836"), "Außenministerium (MVnR)-0000836");
    assert.equal(translateBgZoneName("Зона H001-0000062"), "Zone H001-0000062");
    assert.equal(translateBgZoneName("Марица Изток 2-0000835"), "Maritsa Iztok 2-0000835");
    assert.equal(translateBgZoneName("HAIL1-0000107"), "HAIL1-0000107");
    assert.equal(translateBgZoneName("А1"), "A1");
  });

  it("Kategorie aus dem Namen", () => {
    assert.equal(bgZoneCategory("HAIL1-0000107"), "Hagelabwehr-Station");
    assert.equal(bgZoneCategory("MIL_248-0000552"), "Militärisches Objekt");
    assert.equal(bgZoneCategory("София (LBSF)-0000678"), "Flugplatz");
    assert.equal(bgZoneCategory("AEC-0000002"), "Kernkraftwerk (AEC, Kosloduj)");
    assert.equal(bgZoneCategory("PRC_Embassy_Sofia_UAS_Geographical_Zone-0001353"), "Botschaft");
    assert.equal(bgZoneCategory("DR Zone 1-0001109"), undefined);
  });

  it("Kontaktpersonen: Dienstgrade deutsch, Namen transliteriert", () => {
    assert.equal(translateBgContact("ГД ГВА служител"), "Mitarbeiter/in der GD GVA");
    assert.equal(translateBgContact("служител"), "Mitarbeiter/in");
    assert.equal(translateBgContact("Иво Иванов"), "Ivo Ivanov");
    assert.equal(translateBgContact("полк. Диян Вълчев"), "Oberst Diyan Valchev");
    assert.equal(translateBgContact("подполковник Милен Проданов"), "Oberstleutnant Milen Prodanov");
    assert.equal(translateBgContact("К-н III ранг Атанас Георгиев"), "Korvettenkapitän Atanas Georgiev");
    assert.equal(translateBgContact("оф. канд. Свилен Русев"), "Offiziersanwärter Svilen Rusev");
    assert.equal(translateBgContact("к-н Илиян Петров"), "Hauptmann Iliyan Petrov");
    assert.equal(translateBgContact("лейт. Цветелин Гетовски"), "Leutnant Tsvetelin Getovski");
    assert.equal(translateBgContact("полковник доц. д-р инж. СтанчоСтанчев"), "Oberst Doz. Dr. Ing. Stancho Stanchev");
    assert.equal(translateBgContact("Wei Linlin"), "Wei Linlin");
  });

  it("Antragsteller/Zoneninhaber", () => {
    assert.match(translateBgApplicant("ГД ГВА"), /^GD GVA \(Generaldirektion Zivilluftfahrtverwaltung/);
    assert.equal(translateBgApplicant("СВ.."), "Landstreitkräfte (SV)");
    assert.equal(translateBgApplicant("ВА."), "Militärakademie (VA)");
    assert.equal(translateBgApplicant('"Пристанищен комплекс-Русе"ЕАД'), "Hafenkomplex Russe EAD");
    assert.equal(translateBgApplicant("А1 BULGARIA"), "A1 Bulgaria"); // kyrillisches А
    assert.equal(translateBgApplicant("A1 BULGARIA "), "A1 Bulgaria");
    assert.equal(translateBgApplicant("Национална гвардейска част"), "Nationalgarde-Einheit");
    assert.equal(translateBgApplicant("Неизвестна фирма"), "Neizvestna firma");
  });
});

describe("bulgarianGeozones – Texte (Wörterbuch)", () => {
  it("übersetzt alle Satzvarianten der Live-Daten (Zahlen-Platzhalter)", () => {
    assert.equal(
      translateBgText(
        "Полети в тази зона могат да се изпълняват само след разрешение от ГД ГВА. Минимален интервал от време за подаване на заявление е 5 работни дни преди планираната дата.",
      ).de.join(" "),
      "Flüge in dieser Zone dürfen nur nach Genehmigung der GD GVA (bulgarische Zivilluftfahrtbehörde) durchgeführt werden. Der Antrag ist mindestens 5 Arbeitstage vor dem geplanten Datum einzureichen.",
    );
    assert.equal(
      translateBgSentence("Минимален интервал от време за подаване на заявление е 1 месец преди планираната дата."),
      "Der Antrag ist mindestens 1 Monat vor dem geplanten Datum einzureichen.",
    );
    assert.equal(
      translateBgSentence("Полети в тази зона над 50м могат да се изпълняват само след разрешение от ГД ГВА."),
      "Flüge in dieser Zone oberhalb von 50 m dürfen nur nach Genehmigung der GD GVA (bulgarische Zivilluftfahrtbehörde) durchgeführt werden.",
    );
    assert.equal(
      translateBgText(
        "Полети в тази зона могат да се изпълнят само след специално разрешение на ГД ГВА. Минималният интервал от време, необходим между заявката за разрешение и започването на работа в зоната е 3 раб. дни.",
      ).de.join(" "),
      "Flüge in dieser Zone dürfen nur nach besonderer Genehmigung der GD GVA (bulgarische Zivilluftfahrtbehörde) durchgeführt werden. Zwischen dem Genehmigungsantrag und dem Beginn der Tätigkeit in der Zone müssen mindestens 3 Arbeitstage liegen.",
    );
    assert.equal(
      translateBgSentence("Да се уведомява лицето за контакт за планираната дейност 45 дни предварително"),
      "Die Kontaktperson ist 45 Tage im Voraus über die geplante Tätigkeit zu benachrichtigen.",
    );
    assert.equal(
      translateBgSentence("Зона за сигурност забранена за полети на БЛС от земната повърхност до височина 120 метра"),
      "Sicherheitszone: UAS-Flüge sind von der Erdoberfläche bis 120 m Höhe verboten.",
    );
    assert.deepEqual(translateBgText("Warning! You are entering a restricted area!").de, [
      "Achtung!",
      "Sie fliegen in ein Beschränkungsgebiet ein!",
    ]);
    assert.equal(translateBgSentence("Непознат текст."), null);
  });

  it("mehrzeiliger Text (ИРТ-2000) wird satzweise übersetzt", () => {
    const t = translateBgText(rawByName("ИРТ-2000 ").properties.message);
    assert.equal(t.untranslated.length, 0);
    assert.equal(t.de.length, 3);
    assert.equal(splitBgSentences("a. Б.\nв").length, 3);
  });

  it("jeder bulgarische/englische Text der Fixture ist übersetzt", () => {
    for (const f of fx.caa.features) {
      for (const k of ["message", "restriction_conditions", "information"]) {
        const v = f.properties[k];
        if (!v || /^Identifier:/.test(v)) continue;
        assert.deepEqual(translateBgText(v).untranslated, [], `${f.properties.name}.${k}`);
      }
    }
    for (const f of zones) assert.equal(f.properties.bgUntranslated, undefined, f.properties.name);
  });

  it("Flugverbot im Text erkennen (ohne „освен“-Ausnahme)", () => {
    assert.equal(bgTextProhibits("Забраняват се полетите с безпилотни летателни системи в установената зона."), true);
    assert.equal(bgTextProhibits("Забраняват се полетите с безпилотни летателни системи в установената зона, освен с тези на заявителя."), false);
    assert.equal(bgTextProhibits("Зона, забранена за полети на БЛС от земната повърхност до височина 120 метра"), true);
    assert.equal(bgTextProhibits(null), false);
  });
});

describe("bulgarianGeozones – Einstufung", () => {
  it("Tabelle: Code + Text (strengere Angabe gewinnt)", () => {
    const m = (name: string) => byName(name)!.properties;
    assert.equal(m("HAIL1-0000107").restriction, "REQ_AUTHORISATION");
    assert.equal(m("DR Zone 1-0001109").restriction, "PROHIBITED");
    assert.equal(m("DR Zone 1-0001109").originalRestriction, "REQ_AUTHORISATION");
    assert.equal(m("DR Zone 1-0001109").restrictionEscalated, true);
    assert.equal(m("MIL_248-0000552").restriction, "PROHIBITED"); // CONDITIONAL + Flugverbot
    assert.equal(m("MIL301-0000581").restriction, "CONDITIONAL");
    assert.equal(m("Elatsite-0001166").restriction, "REQ_AUTHORISATION"); // „освен с тези на заявителя“
    assert.equal(m("ERM1-0001161").restriction, "REQ_AUTHORISATION");
    assert.equal(m("MIL_269-0001364").restriction, "PROHIBITED"); // PROHIBITED + Anmeldetext
    assert.equal(m("MIL_269-0001364").originalRestriction, undefined);
    assert.equal(decideBgRestriction({ restriction_code: "NO_RESTRICTION" }).restriction, "REQ_AUTHORISATION");
    assert.equal(decideBgRestriction({}).restriction, "REQ_AUTHORISATION");
    assert.match(m("DR Zone 1-0001109").message, /Hinweis zur Einstufung: Der Behördentext verbietet UAS-Flüge/);
  });

  it("BULATSA: LBP → verboten, sonst genehmigungspflichtig", () => {
    assert.equal(bgBulatsaRestriction("LBP1"), "PROHIBITED");
    assert.equal(bgBulatsaRestriction("LBR1"), "REQ_AUTHORISATION");
    assert.equal(bgBulatsaRestriction("LBD301"), "REQ_AUTHORISATION");
    assert.equal(bgBulatsaRestriction("Bezmer MATZ"), "REQ_AUTHORISATION");
  });
});

describe("bulgarianGeozones – Höhen und Gültigkeit", () => {
  it("CAA-Höhen aus vertical_min_agl/vertical_max_agl (Meter AGL)", () => {
    assert.equal(byName("София (LBSF)-0000679")!.properties.lowerMeters, 0);
    assert.equal(byName("София (LBSF)-0000678")!.properties.lowerMeters, 50);
    assert.equal(byName("София (LBSF)-0000678")!.properties.upperMeters, 120);
    assert.equal(byName("MIL151-0000495")!.properties.upperMeters, 8000);
    assert.equal(byName("Optics-0001160")!.properties.upperMeters, undefined); // 0/0 → ohne Obergrenze
    assert.equal(byName("HAIL1-0000107")!.properties.lowerReference, "AGL");
    const h = bgCaaHeights({ message: "Полети в тази зона над 50м могат …" });
    assert.equal(h.lower.meters, 50);
  });

  it("BULATSA-Höhenangaben", () => {
    assert.deepEqual(parseBgLimit("GND"), { meters: 0, reference: "AGL", raw: "GND" });
    const fl = parseBgLimit("FL165")!;
    assert.equal(fl.fl, 165);
    assert.equal(Math.round(fl.meters), 5029);
    assert.equal(parseBgLimit("3000FT AMSL")!.reference, "MSL");
    assert.equal(parseBgLimit("1200FT")!.reference, "MSL");
    assert.equal(parseBgLimit("500 FT AGL")!.reference, "AGL");
    assert.equal(parseBgLimit("UNL"), null);
    assert.equal(formatBgLimitDe(fl), "FL 165 (≈ 5029 m AMSL)");
    assert.equal(formatBgLimitDe(parseBgLimit("5000FT")), "5000 ft AMSL (≈ 1524 m)");
  });

  it("Untergrenze weit über Drohnenhöhen (> 500 ft AGL bzw. > FL125) → verwerfen", () => {
    assert.equal(bgLowerAboveDroneHeights(parseBgLimit("500FT AGL")), false);
    assert.equal(bgLowerAboveDroneHeights(parseBgLimit("600FT AGL")), true);
    assert.equal(bgLowerAboveDroneHeights(parseBgLimit("3000FT AMSL")), false);
    assert.equal(bgLowerAboveDroneHeights(parseBgLimit("FL125")), false);
    assert.equal(bgLowerAboveDroneHeights(parseBgLimit("FL130")), true);
    const raw = clone(rawByName("HAIL1-0000107"));
    raw.properties.vertical_min_agl = 200;
    raw.properties.vertical_max_agl = 400;
    const r = normalizeBulgarianZonesWithStats([raw], { now: NOW });
    assert.equal(r.features.length, 0);
    assert.deepEqual(r.dropped, [{ name: "HAIL1-0000107", reason: "above_drone_heights" }]);
  });

  it("Gültigkeit: vergangener Beginn bei Dauerzonen kein Zeitfenster, Zukunft/Ende schon, abgelaufen → verworfen", () => {
    assert.equal(byName("HAIL1-0000107")!.properties.validStartTs, undefined);
    assert.equal(byName("HAIL1-0000107")!.properties.applicability, undefined);
    const future = clone(rawByName("HAIL1-0000107"));
    future.properties.immediate_period_start = "2026-12-01T00:00:00Z";
    future.properties.immediate_period_end = "2026-12-31T00:00:00Z";
    const f = normalizeBulgarianZones([future], { now: NOW })[0];
    assert.equal(f.properties.validStartTs, Date.parse("2026-12-01T00:00:00Z"));
    assert.equal(f.properties.validEndTs, Date.parse("2026-12-31T00:00:00Z"));
    assert.equal(f.properties.applicability[0].permanent, "NO");
    assert.match(f.properties.message, /Gültig: ab 01\.12\.2026 00:00 UTC bis 31\.12\.2026 00:00 UTC/);
    const expired = clone(rawByName("HAIL1-0000107"));
    expired.properties.immediate_period_end = "2026-11-01T00:00:00Z";
    assert.deepEqual(normalizeBulgarianZonesWithStats([expired], { now: NOW }).dropped[0].reason, "expired");
    const deleted = clone(rawByName("HAIL1-0000107"));
    deleted.properties.is_deleted = true;
    assert.deepEqual(normalizeBulgarianZonesWithStats([deleted], { now: NOW }).dropped[0].reason, "deleted");
    assert.equal(bgValidity({ immediate_period_end: "2036-12-31T00:00:00Z", immediate_period_start: "2026-01-09T00:00:00Z" }, NOW).longTermEnd, true);
  });

  it("BULATSA: gelöschte verworfen, AIP-Gebiete dauerhaft, LBD301 mit Zeitfenster", () => {
    const r = normalizeBulgarianBulatsaZonesWithStats(fx.bulatsa, {
      now: NOW,
      preciseWkt: parseBulgariaWfsCsv(fx.bulatsaCsv),
    });
    assert.deepEqual(r.dropped, [{ name: "LBD_BlackSea_Zone 3", reason: "deleted" }]);
    assert.equal(r.features.length, 6);
    const lbr1 = r.features.find((f) => f.properties.name === "LBR1")!;
    assert.equal(lbr1.properties.identifier, "BG-ATS-1001");
    assert.equal(lbr1.properties.validEndTs, undefined);
    assert.equal(lbr1.properties.lowerMeters, 0);
    assert.equal(Math.round(lbr1.properties.upperMeters), 5029);
    assert.equal(lbr1.properties.upperReference, "MSL");
    assert.match(lbr1.properties.message, /Gültig: dauerhaft \(laut Quelle bis 31\.12\.2036/);
    const lbd = r.features.find((f) => f.properties.name === "LBD301")!;
    assert.equal(lbd.properties.validStartTs, Date.parse("2026-11-14T16:07:00Z"));
    assert.equal(lbd.properties.validEndTs, Date.parse("2026-11-15T06:00:00Z"));
    assert.equal(r.features.find((f) => f.properties.name === "LBP1")!.properties.restriction, "PROHIBITED");
    // Nach Ablauf verschwindet LBD301.
    const later = normalizeBulgarianBulatsaZonesWithStats(fx.bulatsa, { now: new Date("2026-11-15T07:00:00Z") });
    assert.ok(later.dropped.some((d) => d.name === "LBD301" && d.reason === "expired"));
  });
});

describe("bulgarianGeozones – Normalisierung und Beschreibung", () => {
  it("alle Fixture-Zonen normalisiert, Kennung/Quelle/Kontakt gesetzt", () => {
    assert.equal(zones.length, fx.caa.features.length);
    const sofia = byName("София (LBSF)-0000678")!;
    assert.equal(sofia.properties.name, "Sofia (LBSF)-0000678");
    assert.equal(sofia.properties.identifier, "BG-444");
    assert.equal(sofia.properties.source, BG_GEOZONE_SOURCE_LABEL);
    assert.equal(sofia.properties.contactEmail, "uas@caa.bg");
    assert.equal(sofia.properties.infoUrl, "https://uas.caa.bg");
    // zone_id statt id (ИРТ-2000: id 4299, zone_id 1057)
    assert.equal(byName("ИРТ-2000")!.properties.identifier, "BG-1057");
  });

  it("Dedupe über zone_id", () => {
    const raw = rawByName("HAIL1-0000107");
    const r = normalizeBulgarianZonesWithStats([raw, clone(raw)], { now: NOW });
    assert.equal(r.features.length, 1);
    assert.equal(r.dropped[0].reason, "duplicate");
    const merged = mergeBulgarianFeatures(r.features, r.features);
    assert.equal(merged.length, 1);
  });

  it("deutsche Beschreibung + vollständiger Originaltext; localizedMessages de zuerst, dann bg", () => {
    const f = byName("ИРТ-2000")!;
    const msg: string = f.properties.message;
    const [de, original] = msg.split("\nOriginaltext der Behörde:\n");
    assert.ok(!hasCyrillic(de.replace(/ГД ГВА/g, "")), de);
    assert.match(de, /^Typ: Flugverbotszone/);
    assert.match(de, /Kategorie: Forschungsreaktor/);
    assert.match(de, /Bestimmung: Nicht genehmigte Flüge unbemannter und bemannter Luftfahrzeuge/);
    assert.match(de, /Antragsteller\/Zoneninhaber: INRNE/);
    assert.ok(original.includes(rawByName("ИРТ-2000 ").properties.message.trim()));
    const loc = f.properties.extendedProperties.localizedMessages;
    assert.equal(loc[0].language, "de");
    assert.equal(loc[0].message, msg);
    assert.equal(loc[1].language, "bg");
    const kukush = byName("A1 KUKUSH")!;
    assert.doesNotMatch(kukush.properties.message, /Bedingung:/); // leere restriction_conditions
  });
});

describe("bulgarianGeozones – Zusammenspiel mit ed269.ts", () => {
  it("parseEd269ToGeozoneInfo: keine Neuübersetzung, Original genau einmal", () => {
    const info = parseEd269ToGeozoneInfo(zones as any, "BG");
    assert.equal(info.length, zones.length);
    for (const z of info) {
      const n = z.details.split("Originaltext der Behörde:").length - 1;
      assert.ok(n <= 1, `${z.name}: ${n}× Originaltext`);
    }
    const sofia = info.find((z) => z.featureId === "BG-444")!;
    assert.equal(sofia.name, "Sofia (LBSF)-0000678");
    assert.equal(sofia.restriction, "REQ_AUTHORISATION");
    assert.equal(sofia.lowerMeters, 50);
    assert.equal(sofia.upperMeters, 120);
    assert.equal(sofia.lowerReference, "AGL");
    assert.match(sofia.details, /Flüge in dieser Zone oberhalb von 50 m dürfen nur nach Genehmigung/);
    assert.ok(sofia.details.includes("Полети в тази зона над 50м"));
    assert.ok(sofia.links?.some((l) => l.url === "mailto:uas@caa.bg"));
    const embassy = info.find((z) => z.name.startsWith("PRC_Embassy"))!;
    assert.equal(embassy.restriction, "PROHIBITED");
    assert.match(embassy.details, /zum Schutz diplomatischer Einrichtungen verboten/);
  });
});

describe("bulgariaSource – Abruf", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  const empty = { type: "FeatureCollection", features: [], totalFeatures: 0, numberMatched: 0, numberReturned: 0, crs: null };
  const layerOf = (url: string) => decodeURIComponent(url).match(/typeNames=([^&]+)/)?.[1] ?? "";

  it("loadBulgaria: Hauptlayer + BULATSA + CSV-Präzision, _country=bg", async () => {
    const urls: string[] = [];
    const out = await loadBulgaria(
      {
        json: async (url) => {
          urls.push(url);
          const l = layerOf(url);
          if (l === BG_CAA_ZONES_LAYER) return fx.caa;
          if (l === BG_BULATSA_ZONES_LAYER) return fx.bulatsa;
          return empty;
        },
        text: async (url) => {
          urls.push(url);
          return layerOf(url) === BG_CAA_ZONES_LAYER ? fx.caaCsv : fx.bulatsaCsv;
        },
      },
      NOW,
    );
    assert.equal(out.length, fx.caa.features.length + 6);
    assert.ok(out.every((f) => f.properties._country === "bg" && Array.isArray(f.bbox)));
    const aec = out.find((f) => f.properties.identifier === "BG-2")!;
    assert.deepEqual((aec.geometry.coordinates as number[][][])[0][0], [24.08893095127379, 43.732312734659196]);
    assert.ok(urls.some((u) => u.includes("outputFormat=csv")));
    assert.ok(urls.some((u) => u.includes("VGeoFlightZonesPublic")));
  });

  it("loadBulgaria: leerer Hauptlayer → Fehler", async () => {
    await assert.rejects(loadBulgaria({ json: async () => empty, text: async () => "" }, NOW), /keine Zonen/);
  });

  it("loadBulgaria: Fehler bei Zusatzlayern und CSV kosten die Hauptzonen nicht", async () => {
    const out = await loadBulgaria(
      {
        json: async (url) => {
          if (layerOf(url) === BG_CAA_ZONES_LAYER) return fx.caa;
          throw new Error("HTTP 500");
        },
        text: async () => {
          throw new Error("HTTP 500");
        },
      },
      NOW,
    );
    assert.equal(out.length, fx.caa.features.length);
    const aec = out.find((f) => f.properties.identifier === "BG-2")!;
    assert.deepEqual((aec.geometry.coordinates as number[][][])[0][0], [24.0889, 43.7323]); // GeoJSON-Rückfall
  });

  it("loadBulgaria: WFS-Paging über numberMatched", async () => {
    const feats = fx.caa.features;
    const pages: number[] = [];
    const out = await loadBulgaria(
      {
        json: async (url) => {
          if (layerOf(url) !== BG_CAA_ZONES_LAYER) return empty;
          const start = Number(url.match(/startIndex=(\d+)/)?.[1] ?? 0);
          pages.push(start);
          // Server simuliert 1000er-Seiten mit 1200 Treffern (Wiederholung der Fixture mit neuen zone_ids).
          const n = Math.min(1000, 1200 - start);
          const page = Array.from({ length: n }, (_, i) => {
            const f = clone(feats[(start + i) % feats.length]);
            f.id = `VGeoCAAZonesPublic.x${start + i}`;
            f.properties.zone_id = 100000 + start + i;
            return f;
          });
          return { ...fx.caa, features: page, numberMatched: 1200, numberReturned: n };
        },
        text: async () => "FID,zone_id,shape\n",
      },
      NOW,
    );
    assert.deepEqual(pages, [0, 1000]);
    assert.equal(out.length, 1200);
  });

  it("fetchBulgaria (globales fetch): GeoJSON + CSV über uas.caa.bg", async () => {
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      assert.ok(url.startsWith(BG_WFS_URL));
      const l = layerOf(url);
      const csv = url.includes("outputFormat=csv");
      const body = l === BG_CAA_ZONES_LAYER ? (csv ? fx.caaCsv : fx.caa) : csv ? "FID,zone_id,shape\n" : empty;
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const out = await fetchBulgaria();
    assert.equal(out.length, fx.caa.features.length);
    assert.ok(out.every((f) => f.properties._country === "bg"));
  });
});
