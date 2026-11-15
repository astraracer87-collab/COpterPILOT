import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SI_ARCGIS_BASE,
  SI_GEOZONE_SOURCE_LABEL,
  SI_LAYERS,
  decideSiRestriction,
  foldSl,
  normalizeSloveniaFeature,
  normalizeSloveniaLayersWithStats,
  parseSiAllowedUpTo,
  siLayerByKey,
  siLayerUrl,
  sloveniaArcgisPage,
  sloveniaQueryUrl,
  translateSiPhrase,
  translateSiRegulation,
  translateSiZoneName,
  type SiLayerDef,
} from "../../../shared/slovenianGeozones";
import { loadSlovenia } from "../geozoneDirect/sloveniaSource";
import { parseEd269ToGeozoneInfo } from "../ed269";

// Gekürzter ECHTER Auszug der 18 Zonen-Layer der WebMap „UAS GEO ZONES - May
// 2026“ (abgerufen 2026-11-15, f=geojson, outSR=4326): je Ebene 1–2 Features,
// Attribute und Geometrien unverändert (nur beim Triglav-Nationalpark wurde die
// sehr große Geometrie entfernt).
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/si-caa-arcgis-sample.json"), "utf8"));
const layerFc = (key: string) => fixture.layers[key];
const L = (key: string) => siLayerByKey(key) as SiLayerDef;
const rawOf = (key: string, i = 0) => layerFc(key).features[i];
const SQUARE = {
  type: "Polygon",
  coordinates: [[[13.8, 46.3], [13.9, 46.3], [13.9, 46.4], [13.8, 46.4], [13.8, 46.3]]],
};

function allFixtureLayers() {
  return SI_LAYERS.map((layer) => ({ layer, features: layerFc(layer.key)?.features ?? [] }));
}

/** Deutscher Teil der Meldung (ohne Originaltext). */
function germanPart(message: string): string {
  return message.split("Originaltext der Behörde:")[0];
}

describe("slovenianGeozones – Layer-Konfiguration", () => {
  it("nutzt die Layer der aktuellen UAS-Karte (nicht die GAT-Karte 2021)", () => {
    assert.equal(SI_LAYERS.length, 18);
    const services = SI_LAYERS.map((l) => l.service);
    assert.ok(services.includes("CTR_WGS_24/FeatureServer/0"));
    assert.ok(services.includes("UAS_URSIKS/FeatureServer/0"));
    assert.ok(services.includes("GO_09_SND/FeatureServer/0"));
    for (const old of ["restricted_danger", "CTR_AIRAC_AMDT_108_2021", "TMZ_areas", "Danger_corridor_LJD2", "gat_jan2021", "Pozidano", "FIR2"]) {
      assert.ok(!services.some((s) => s.startsWith(old)), old);
    }
    assert.equal(new Set(SI_LAYERS.map((l) => l.key)).size, SI_LAYERS.length);
    for (const l of SI_LAYERS) assert.ok(layerFc(l.key), `Fixture für ${l.key}`);
  });

  it("baut Query-URLs (GeoJSON, WGS84, alle Felder, Paging, ohne Präzisionskürzung)", () => {
    const u = new URL(sloveniaQueryUrl(L("ctr"), 1000, 500));
    assert.equal(`${u.origin}${u.pathname}`, `${SI_ARCGIS_BASE}/CTR_WGS_24/FeatureServer/0/query`);
    assert.equal(u.searchParams.get("f"), "geojson");
    assert.equal(u.searchParams.get("outSR"), "4326");
    assert.equal(u.searchParams.get("outFields"), "*");
    assert.equal(u.searchParams.get("resultOffset"), "1000");
    assert.equal(u.searchParams.get("resultRecordCount"), "500");
    assert.equal(u.searchParams.get("geometryPrecision"), null);
    assert.equal(u.searchParams.get("maxAllowableOffset"), null);
    assert.equal(siLayerUrl(L("tnp")), `${SI_ARCGIS_BASE}/UAS_GEO_ZONES___March_2022_WFL1/FeatureServer/12`);
  });

  it("wertet ArcGIS-Seiten aus und wirft bei Fehlerobjekten", () => {
    assert.deepEqual(sloveniaArcgisPage({ features: [1], exceededTransferLimit: true }), { features: [1], exceeded: true });
    assert.deepEqual(sloveniaArcgisPage({ features: [], properties: { exceededTransferLimit: true } }), { features: [], exceeded: true });
    assert.throws(() => sloveniaArcgisPage({ error: { code: 400, message: "Invalid URL" } }), /ArcGIS-Fehler 400: Invalid URL/);
  });
});

describe("slovenianGeozones – Übersetzung", () => {
  it("übersetzt alle live vorkommenden Beschränkungs-/Ausnahme-/Grund-Angaben (SL und EN)", () => {
    const cases: [string, string][] = [
      ["prepovedano", "UAS-Flüge verboten"],
      [" Prohibited", "UAS-Flüge verboten"],
      ["Forbidden", "UAS-Flüge verboten"],
      ["dovoljenje TNP  (glej info)", "Genehmigung des Triglav-Nationalparks (TNP) – siehe Informationen"],
      ["posebna kategorija: soglasje KZPS", "nur Kategorie „speziell“ mit Zustimmung von Slovenia Control (KZPS)"],
      ["specific category only: approval SloveniaControl", "nur Kategorie „speziell“ mit Zustimmung von Slovenia Control (KZPS)"],
      ["Odprto 24/7", "entfällt – rund um die Uhr in Betrieb (24/7), die Einschränkungen gelten jederzeit"],
      ["izven obratovalnega časa veljajo splošna UAS pravila", "außerhalb der Betriebszeiten gelten die allgemeinen UAS-Regeln"],
      ["Dovoljenje TEŠ", "Genehmigung der TEŠ (Thermokraftwerk Šoštanj)"],
      ["dovoljenje uprave za jedrsko var.", "Genehmigung der slowenischen Behörde für nukleare Sicherheit (URSJV)"],
      ["Nuclear Safety Administration approval ", "Genehmigung der slowenischen Behörde für nukleare Sicherheit (URSJV)"],
      ["soglasje upravljalca letališča (glej kontakt)", "Zustimmung des Flugplatzbetreibers (siehe Kontakt)"],
      ["dovoljenje upravljalca vzletisca", "Genehmigung des Flugfeldbetreibers"],
      ["Lastne potrebe ali predhodna odobritev.", "nur für eigene Zwecke der Gefängnisverwaltung (URSIKS) oder mit vorheriger Genehmigung"],
      [" Varovanje", "Objektschutz (Sicherheit)"],
      ["varnost in varovanje", "Sicherheit und Objektschutz"],
      ["dovoljeno do višine 50 m AGL (nad terenom)", "bis 50 m über Grund (AGL) erlaubt; darüber nur mit Genehmigung"],
    ];
    for (const [src, de] of cases) assert.equal(translateSiPhrase(src), de, src);
    assert.equal(translateSiPhrase("neznano besedilo"), null);
    assert.equal(translateSiPhrase(""), null);
  });

  it("übersetzt Rechtsgrundlagen, Nummern bleiben", () => {
    assert.equal(
      translateSiRegulation("Sklep Vlade RS, št. 24200-2/2017-4; Zakon o zasebnem varovanju (Uradni list RS, št.17/11);  Uredbe o obveznem organiziranju varovanja (Uradni list RS, št. 80/12)"),
      "Beschluss der Regierung der Republik Slowenien Nr. 24200-2/2017-4; Gesetz über private Sicherheitsdienste (Amtsblatt der Republik Slowenien Nr. 17/11); Verordnung über die Pflicht zur Einrichtung eines Sicherheitsdienstes (Amtsblatt der Republik Slowenien Nr. 80/12)",
    );
    assert.equal(translateSiRegulation("Uradni list RS, št. 195/20 in 31/21"), "Amtsblatt der Republik Slowenien Nr. 195/20 und 31/21");
    assert.equal(
      translateSiRegulation("sklep Vlade Republike Slovenije št. 24000-1/2025/3 z dne 15.5.2025"),
      "Beschluss der Regierung der Republik Slowenien Nr. 24000-1/2025/3 vom 15.5.2025",
    );
    assert.equal(translateSiRegulation("Zakon o izvrševanju kazenskih sankcij (ZIKS-1)"), "Gesetz über den Vollzug strafrechtlicher Sanktionen (ZIKS-1)");
  });

  it("übersetzt Zonennamen (Gattung deutsch, Eigennamen bleiben)", () => {
    assert.equal(translateSiZoneName("Triglavski narodni park (TNP)"), "Triglav-Nationalpark (TNP)");
    assert.equal(translateSiZoneName("Kontrolirana cona (CTR Ljubljana)"), "Kontrollzone (CTR Ljubljana)");
    assert.equal(translateSiZoneName("L JR6B restricted"), "Flugbeschränkungsgebiet LJR6B");
    assert.equal(translateSiZoneName("LJR 6C restricted"), "Flugbeschränkungsgebiet LJR6C");
    assert.equal(translateSiZoneName("LJD1 - Danger area"), "Gefahrengebiet LJD1");
    assert.equal(translateSiZoneName("Prepovedana cona - Nuklearna elektrarna Krsko"), "Verbotszone – Kernkraftwerk Krško");
    assert.equal(translateSiZoneName("Letalisce Ljubljana", L("aerodrome_ifr"), "Aerodrome Ljubljana - LJLJ"), "Flughafen Ljubljana (LJLJ)");
    assert.equal(translateSiZoneName("Letalisce Bovec", L("aerodrome_vfr")), "Flugplatz Bovec");
    assert.equal(translateSiZoneName("Veržej-Veržej", L("airfield")), "Flugfeld Veržej-Veržej");
    assert.equal(translateSiZoneName("Tolmin civilna zaščita", L("pis_heliport")), "Hubschrauberlandeplatz Zivilschutz Tolmin");
    assert.equal(translateSiZoneName("Heliport SB Celje", L("heliport")), "Hubschrauberlandeplatz Allgemeines Krankenhaus (SB) Celje");
    assert.equal(translateSiZoneName("Kamionsko pretakališče", L("sermin")), "Petrol-Terminal Sermin – Lkw-Abfüllstation");
    assert.equal(translateSiZoneName("Varovano območje Petrol d.d. - jug", L("sermin")), "Sicherheitsbereich Petrol d.d. – Süd");
    assert.equal(translateSiZoneName("SND RAČE"), "Erdöllager Rače (SND)");
    assert.equal(translateSiZoneName("SND_ZALOG"), "Erdöllager Zalog (SND)");
    assert.equal(translateSiZoneName("TEŠ"), "Thermokraftwerk Šoštanj (TEŠ)");
    assert.equal(translateSiZoneName(" Premogovnik Velenje"), "Kohlebergwerk Velenje (Premogovnik Velenje)");
    assert.equal(foldSl("Šoštanj Žalec Čatež"), "Sostanj Zalec Catez");
  });
});

describe("slovenianGeozones – Beschränkung und Höhen", () => {
  it("leitet die Beschränkung aus der Behördenangabe ab (vorsichtig)", () => {
    assert.equal(decideSiRestriction("prepovedano", "forbidden", L("airfield")).restriction, "PROHIBITED");
    const ctr = decideSiRestriction("dovoljeno do višine 50 m AGL (nad terenom)", "allowed up to a height of 50 m AGL (above ground level)", L("ctr"));
    assert.deepEqual(ctr, { restriction: "REQ_AUTHORISATION", lowerMeters: 50, fromDefault: false });
    assert.equal(decideSiRestriction("dovoljenje za modelarske aktivnosti za člane modelskega kluba", "", L("model")).restriction, "CONDITIONAL");
    assert.deepEqual(decideSiRestriction("", "", L("restricted")), { restriction: "REQ_AUTHORISATION", fromDefault: true });
    assert.deepEqual(decideSiRestriction("", "", L("danger")), { restriction: "CONDITIONAL", fromDefault: true });
    assert.deepEqual(decideSiRestriction("nekaj", "", undefined), { restriction: "REQ_AUTHORISATION", fromDefault: true });
    assert.equal(parseSiAllowedUpTo("allowed up to a height of 50 m AGL"), 50);
    assert.equal(parseSiAllowedUpTo("prepovedano"), undefined);
  });
});

describe("slovenianGeozones – Normalisierung echter Daten", () => {
  const { features, dropped } = normalizeSloveniaLayersWithStats(allFixtureLayers());
  const byId = (id: string) => features.find((f) => f.properties.identifier === id);

  it("normalisiert alle Fixture-Zonen; TNP ohne Geometrie wird verworfen", () => {
    assert.equal(features.length, 20);
    assert.deepEqual(dropped, [{ layer: "tnp", name: "Triglavski narodni park (TNP)", reason: "no_geometry" }]);
    const counts: Record<string, number> = {};
    for (const f of features) counts[f.properties.restriction] = (counts[f.properties.restriction] ?? 0) + 1;
    assert.deepEqual(counts, { REQ_AUTHORISATION: 4, PROHIBITED: 14, CONDITIONAL: 2 });
    for (const f of features) {
      assert.equal(f.properties.source, SI_GEOZONE_SOURCE_LABEL);
      assert.equal(f.properties.country, "SVN");
      assert.ok(/^SI-[a-z_]+-\d+$/.test(f.properties.identifier), f.properties.identifier);
    }
  });

  it("CTR: Genehmigung ab 50 m AGL, deutsche Ausnahmen, Original", () => {
    const f = byId("SI-ctr-1")!;
    assert.equal(f.properties.name, "Kontrollzone (CTR Ljubljana)");
    assert.equal(f.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(f.properties.lowerMeters, 50);
    assert.equal(f.properties.lowerReference, "AGL");
    assert.equal(f.properties.upperMeters, undefined);
    assert.equal(f.properties.contactEmail, "info@sloveniacontrol.si");
    const m = f.properties.message as string;
    assert.match(m, /^Typ: Kontrollzone \(CTR\) – UAS-Flüge nur mit Genehmigung/);
    assert.match(m, /Während der Betriebszeit der Kontrollzone: nur Kategorie „speziell“ mit Zustimmung von Slovenia Control \(KZPS\)/);
    assert.match(m, /Außerhalb der Betriebszeit: entfällt – rund um die Uhr/);
    assert.match(m, /\nOriginaltext der Behörde:\nEbene: CTR\nOBMOCJE: Kontrolirana cona \(CTR Ljubljana\)/);
    assert.match(m, /UAS_restriction2: allowed up to a height of 50 m AGL \(above ground level\)/);
    const maribor = byId("SI-ctr-2")!;
    assert.match(maribor.properties.message, /Außerhalb der Betriebszeit: außerhalb der Betriebszeiten gelten die allgemeinen UAS-Regeln/);
    assert.equal(maribor.properties.contactEmail, "info@mbx-airport.si");
  });

  it("Restricted/Danger: NOTAM-Hinweis und Link, vorsichtige Einstufung", () => {
    const r = byId("SI-restricted-2")!;
    assert.equal(r.properties.name, "Flugbeschränkungsgebiet LJR6B");
    assert.equal(r.properties.restriction, "REQ_AUTHORISATION");
    assert.equal(r.properties.notamsUrl, "https://www.sloveniacontrol.si/Strani/Zapore.aspx");
    assert.match(r.properties.message, /Aktivierung per NOTAM/);
    const d = byId("SI-danger-1")!;
    assert.equal(d.properties.name, "Gefahrengebiet LJD1");
    assert.equal(d.properties.restriction, "CONDITIONAL");
  });

  it("Verbotszonen mit Ausnahmen, Grund und Rechtsgrundlage", () => {
    const tes = byId("SI-tes-1")!;
    assert.equal(tes.properties.restriction, "PROHIBITED");
    assert.equal(tes.properties.lowerMeters, 0);
    assert.equal(tes.properties.upperMeters, undefined);
    assert.match(tes.properties.message, /Ausnahmen: Genehmigung der TEŠ \(Thermokraftwerk Šoštanj\)/);
    assert.match(tes.properties.message, /Grund: Objektschutz \(Sicherheit\)/);
    assert.match(tes.properties.message, /Rechtsgrundlage: Beschluss der Regierung der Republik Slowenien Nr\. 24200-2\/2017-4; Gesetz über private Sicherheitsdienste/);
    const eles = byId("SI-eles-5")!;
    assert.equal(eles.properties.applicationUrl, "https://www.eles.si/pogoji-letenja-brezpilotnih-zrakoplovov");
    const ifr = byId("SI-aerodrome_ifr-1")!;
    assert.equal(ifr.properties.name, "Flughafen Ljubljana (LJLJ)");
    assert.equal(ifr.properties.restriction, "PROHIBITED");
    const heli = byId("SI-heliport-1")!;
    assert.match(heli.properties.message, /Unterkategorie A2/);
    const port = byId("SI-port_koper-3")!;
    assert.equal(port.geometry.coordinates.length, 2, "Loch bleibt erhalten");
    assert.match(port.properties.message, /Amtsblatt der Republik Slowenien Nr\. 195\/20 und 31\/21/);
  });

  it("URSIKS: Obergrenze aus „Visina“ (150 m)", () => {
    const f = byId("SI-ursiks-5")!;
    assert.equal(f.properties.name, "Justizvollzugsanstalt (GO.08 URSIKS)");
    assert.equal(f.properties.upperMeters, 150);
    assert.equal(f.properties.lowerMeters, 0);
    assert.match(f.properties.message, /Höhe laut Behörde: Boden \(GND\) bis 150 m/);
  });

  it("Modellfluggelände: CONDITIONAL", () => {
    const f = byId("SI-model-3")!;
    assert.equal(f.properties.name, "Modellfluggelände MD Ventus, Vipava");
    assert.equal(f.properties.restriction, "CONDITIONAL");
    assert.match(f.properties.message, /Modellflug nur für Mitglieder des Modellflugvereins/);
    assert.equal(f.properties.contactEmail, "zides.david@siol.net");
  });

  it("TNP (echte Attribute): Verbot, Info-Link", () => {
    const raw = { ...rawOf("tnp"), geometry: SQUARE };
    const f = normalizeSloveniaFeature(raw, L("tnp"))!;
    assert.equal(f.properties.name, "Triglav-Nationalpark (TNP)");
    assert.equal(f.properties.restriction, "PROHIBITED");
    assert.equal(f.properties.infoUrl, "https://www.tnp.si/en/learn/");
    assert.match(f.properties.message, /Ausnahmen \(Kategorie „offen“ und „speziell“\): Genehmigung des Triglav-Nationalparks/);
  });

  it("kein Text im deutschen Teil bleibt unübersetzt", () => {
    const tnp = normalizeSloveniaFeature({ ...rawOf("tnp"), geometry: SQUARE }, L("tnp"))!;
    for (const f of [...features, tnp]) {
      const de = germanPart(f.properties.message);
      assert.ok(!/siehe Originaltext/.test(de), `${f.properties.identifier}: ${de}`);
      assert.ok(!/\b(prepovedano|forbidden|prohibited|dovoljenje|soglasje|approval|varovanje|security|Uradni list)\b/i.test(de.replace(/https?:\S+/g, "").replace(/^(?:Kontakt|Quelle):.*$/gm, "")), de);
      const loc = f.properties.extendedProperties.localizedMessages;
      assert.equal(loc[0].language, "de");
      assert.equal(loc[0].message, f.properties.message);
      assert.equal(loc[1].language, "sl");
    }
  });

  it("Dedupe über OBJECTID/FID und identische Geometrie je Layer", () => {
    const ctr = layerFc("ctr").features;
    const res = normalizeSloveniaLayersWithStats([
      { layer: L("ctr"), features: [ctr[0], ctr[0], { ...ctr[1], properties: { ...ctr[1].properties, OBJECTID: 99 }, geometry: ctr[0].geometry }] },
    ]);
    assert.equal(res.features.length, 1);
    assert.deepEqual(res.dropped.map((d) => d.reason), ["duplicate", "duplicate"]);
  });

  it("parseEd269ToGeozoneInfo übernimmt deutsche Meldung ohne Doppelung", () => {
    const info = parseEd269ToGeozoneInfo(features, "SI");
    assert.equal(info.length, features.length);
    const ctr = info.find((z) => z.featureId === "SI-ctr-1")!;
    assert.equal(ctr.name, "Kontrollzone (CTR Ljubljana)");
    assert.equal(ctr.restriction, "REQ_AUTHORISATION");
    assert.equal(ctr.lowerMeters, 50);
    assert.equal(ctr.altitudeLabel, "50 m AGL – unbegrenzt");
    assert.equal(ctr.details.split("Originaltext der Behörde:").length, 2, "Original genau einmal");
    assert.ok(ctr.links?.some((l) => l.url === "mailto:info@sloveniacontrol.si"));
    const r = info.find((z) => z.featureId === "SI-restricted-2")!;
    assert.ok(r.links?.some((l) => l.url === "https://www.sloveniacontrol.si/Strani/Zapore.aspx"));
  });
});

describe("sloveniaSource – loadSlovenia", () => {
  const mockFetch = (failKey?: string) => async (url: string) => {
    const layer = SI_LAYERS.find((l) => url.startsWith(`${siLayerUrl(l)}/query`));
    if (!layer) throw new Error(`unerwartete URL ${url}`);
    if (layer.key === failKey) throw new Error("HTTP 500");
    const offset = Number(new URL(url).searchParams.get("resultOffset"));
    const fc = layerFc(layer.key);
    return offset > 0 ? { ...fc, features: [] } : fc;
  };

  it("lädt alle Layer, normalisiert und taggt mit „si“", async () => {
    const out = await loadSlovenia(mockFetch());
    assert.equal(out.length, 20);
    for (const f of out) {
      assert.equal(f.properties._country, "si");
      assert.ok(Array.isArray(f.bbox) && f.bbox.length === 4);
    }
  });

  it("paginiert bei exceededTransferLimit", async () => {
    const urls: string[] = [];
    const fc = layerFc("ctr");
    const fetchJson = async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("resultOffset"));
      if (offset === 0) return { ...fc, features: [fc.features[0]], exceededTransferLimit: true };
      if (offset === 1) return { ...fc, features: [fc.features[1]] };
      return { ...fc, features: [] };
    };
    const out = await loadSlovenia(fetchJson, [L("ctr")]);
    assert.equal(out.length, 2);
    assert.equal(urls.length, 2);
  });

  it("wirft, wenn ein Layer dauerhaft fehlschlägt (kein Teilbestand)", async () => {
    await assert.rejects(loadSlovenia(mockFetch("ctr")), /CAA Slovenia: 1 Ebene\(n\) nicht abrufbar: CTR \(HTTP 500\)/);
  });

  it("wirft bei leerer Antwort", async () => {
    await assert.rejects(loadSlovenia(async () => ({ type: "FeatureCollection", features: [] })), /keine Zonen/);
  });
});
