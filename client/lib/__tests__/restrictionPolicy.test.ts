// B2: Geschlossene Einstufung + EINE Policy-Tabelle.
//  - Policy-Tabelle vollständig und gemäß Plan (docs/pruefung-umbau-plan.md),
//  - normalizeRestriction bildet alle Schreibweisen auf die Union ab,
//  - JEDE Länder-Normalisierung (alle Fixtures) liefert nur Union-Werte – im
//    Normalisierer-Ergebnis und nach parseEd269ToGeozoneInfo,
//  - DE-/FR-/NL-/LU-Text-Heuristiken liefern Union-Werte,
//  - Planungsliste: PROHIBITED → NO-GO außer mit Begründung, NO_RESTRICTION
//    nur Info, Radar-Reiter und Liste bewerten dieselbe Zone gleich.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  RESTRICTIONS,
  RESTRICTION_POLICY,
  assessZoneRestriction,
  deRestrictionForLayer,
  isRestriction,
  maxRestrictionVerdict,
  normalizeRestriction,
  restrictionFromText,
  zoneRestriction,
  type Restriction,
} from "../../../shared/restrictionPolicy";
import { normalizeEd269Restriction, ed269RestrictionColors } from "../../../shared/ed269Restriction";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { computeGeozoneTabSeverity, assessGeozoneForRadar } from "../geozoneSeverity";
import { classifyPlanningZones, buildProhibitedOverrideNote } from "../restrictionPlanning";
import { classifyGeozoneAltitude } from "../../../shared/geozoneAltitudeFilter";
import { frRestrictionFromText } from "../frZoneTypes";
import { nlRestriction, dipulZoneFromFeature, parseChIdentifyResponse, parseLuWmsToGeozoneInfo } from "../geozoneQueries";
import { czZoneFromStored, deZoneFromStored, frZoneFromStored } from "../geozoneTiles/tileZones";
import { luRestrictionFromResponsibility, mergeLuxembourgOgc } from "../../../shared/irishLuxGeozones";

import { normalizePortugueseZones } from "../../../shared/portugueseGeozones";
import { normalizeSwissEd269, normalizeSwissActivityZones, stripBom } from "../../../shared/swissGeozones";
import { cleanBelgianGeometry } from "../../../shared/belgianGeozones";
import { normalizeBulgarianZones, normalizeBulgarianBulatsaZonesWithStats } from "../../../shared/bulgarianGeozones";
import { normalizeCyprusZones } from "../../../shared/cypriotGeozones";
import { normalizeItalianZones } from "../../../shared/italianGeozones";
import { norwayFeaturesFromBody } from "../geozoneDirect/norwaySource";
import { normalizeLatvianZones } from "../../../shared/latvianGeozones";
import { normalizeSpanishFeatures, type EsRawFeature } from "../../../shared/spanishGeozones";
import { unitedKingdomFeaturesFromKml } from "../geozoneDirect/ukSource";
import { normalizeGodroneFeature } from "../../../shared/dutchGeozones";
import { croatiaFeaturesFromPushes } from "../geozoneDirect/croatiaSource";
import { normalizeIcelandicZones } from "../../../shared/icelandicGeozones";
import { ed318ZonesToFeatures } from "../../../shared/ed318Pure";
import { SE_WFS_LAYERS, normalizeSwedishWfsFeatures } from "../../../shared/swedishGeozones";
import { SI_LAYERS, normalizeSloveniaLayersWithStats } from "../../../shared/slovenianGeozones";
import { normalizeSlovakiaWithStats } from "../../../shared/slovakGeozones";
import { finlandFeaturesFromBody } from "../geozoneDirect/finlandSource";
import { polandFeaturesFromKml } from "../geozoneDirect/polandSource";
import { normalizeRomanianGeozones } from "../../../shared/romanianGeozones";
import { normalizeMalteseImport } from "../../../shared/malteseGeozones";
import { normalizeEnaireInsigniasFeature, tagEsInsigniasFeature } from "../../../shared/spanishGeozones";

const FIX = path.join(__dirname, "fixtures");
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const text = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");
const NOW = new Date("2026-11-15T12:00:00Z");

describe("Policy-Tabelle", () => {
  it("vollständig: jede Einstufung hat alle Felder", () => {
    assert.deepEqual(Object.keys(RESTRICTION_POLICY).sort(), [...RESTRICTIONS].sort());
    assert.equal(RESTRICTIONS.length, 7);
    for (const r of RESTRICTIONS) {
      const p = RESTRICTION_POLICY[r];
      assert.ok([1, 2, 3, 4].includes(p.severity), r);
      assert.ok(p.labelDe.length > 0 && p.explanationDe.length > 0, r);
      assert.match(p.color, /^#[0-9A-F]{6}$/i, r);
      assert.match(p.fill, /^rgba\(/, r);
      assert.match(p.stroke, /^rgba\(/, r);
      assert.ok(["nogo", "caution", "info"].includes(p.verdict), r);
      assert.equal(typeof p.requiresConfirmation, "boolean");
      assert.equal(typeof p.coverableByAuthorisation, "boolean");
    }
  });

  it("Werte gemäß Plan", () => {
    const P = RESTRICTION_POLICY;
    assert.deepEqual(
      RESTRICTIONS.map((r) => [r, P[r].severity, P[r].verdict]),
      [
        ["PROHIBITED", 4, "nogo"],
        ["RESTRICTED", 3, "caution"],
        ["REQ_AUTHORISATION", 3, "caution"],
        ["CONDITIONAL", 2, "caution"],
        ["NATURE", 2, "caution"],
        ["NO_RESTRICTION", 1, "info"],
        ["UNKNOWN", 2, "caution"],
      ],
    );
    assert.equal(P.PROHIBITED.overridableWithReason, true);
    assert.equal(P.PROHIBITED.coverableByAuthorisation, false);
    assert.equal(P.RESTRICTED.requiresConfirmation, true);
    assert.equal(P.RESTRICTED.coverableByAuthorisation, false);
    assert.equal(P.RESTRICTED.labelDe, "Sperr-/Beschränkungsgebiet – Freigabe nötig");
    assert.equal(P.REQ_AUTHORISATION.coverableByAuthorisation, true);
    assert.equal(P.REQ_AUTHORISATION.requiresConfirmation, true);
    assert.equal(P.NO_RESTRICTION.requiresConfirmation, false);
    // Nur REQ_AUTHORISATION ist abdeckbar, nur PROHIBITED überschreibbar.
    assert.deepEqual(RESTRICTIONS.filter((r) => P[r].coverableByAuthorisation), ["REQ_AUTHORISATION"]);
    assert.deepEqual(RESTRICTIONS.filter((r) => P[r].overridableWithReason), ["PROHIBITED"]);
  });

  it("Kartenfarben kommen aus der Policy (ed269RestrictionColors)", () => {
    for (const r of RESTRICTIONS) {
      assert.deepEqual(ed269RestrictionColors(r), { fill: RESTRICTION_POLICY[r].fill, stroke: RESTRICTION_POLICY[r].stroke });
    }
  });

  it("maxRestrictionVerdict", () => {
    assert.equal(maxRestrictionVerdict([]), "info");
    assert.equal(maxRestrictionVerdict(["info", "caution"]), "caution");
    assert.equal(maxRestrictionVerdict(["caution", "nogo", "info"]), "nogo");
  });
});

describe("normalizeRestriction", () => {
  const cases: [unknown, Restriction][] = [
    ["REQ_AUTH", "REQ_AUTHORISATION"],
    ["REQ_AUTHORISATION", "REQ_AUTHORISATION"],
    ["REQ_AUTHORIZATION", "REQ_AUTHORISATION"],
    ["req-authorization", "REQ_AUTHORISATION"],
    ["AUTHORISATION", "REQ_AUTHORISATION"],
    ["Authorization", "REQ_AUTHORISATION"],
    ["REQUIRES_AUTHORISATION", "REQ_AUTHORISATION"],
    ["PROHIBITED", "PROHIBITED"],
    ["forbidden", "PROHIBITED"],
    ["NO FLY", "PROHIBITED"],
    ["RESTRICTED", "RESTRICTED"],
    ["CONDITIONAL", "CONDITIONAL"],
    ["CONDITIONS", "CONDITIONAL"],
    ["NO_RESTRICTION", "NO_RESTRICTION"],
    ["NONE", "NO_RESTRICTION"],
    ["INFORMATION", "NO_RESTRICTION"],
    ["INFO", "NO_RESTRICTION"],
    ["NATURE", "NATURE"],
    ["Natura 2000", "NATURE"],
    ["NATURSCHUTZ", "NATURE"],
    ["UNKNOWN", "UNKNOWN"],
    ["", "UNKNOWN"],
    ["   ", "UNKNOWN"],
    [null, "UNKNOWN"],
    [undefined, "UNKNOWN"],
    ["COMMON", "UNKNOWN"],
    ["WHATEVER", "UNKNOWN"],
    [{ type: "PROHIBITED" }, "PROHIBITED"],
    [{ type: "REQ_AUTHORIZATION" }, "REQ_AUTHORISATION"],
    [{}, "UNKNOWN"],
  ];
  for (const [raw, want] of cases) {
    it(`${JSON.stringify(raw)} → ${want}`, () => {
      assert.equal(normalizeRestriction(raw), want);
      assert.equal(normalizeEd269Restriction(raw), want);
    });
  }
});

// ---------------------------------------------------------------------------
// Alle Fixtures durch ihre Normalisierer
// ---------------------------------------------------------------------------

function slovakLps(): any[] {
  return json("sk-lps-arcgis-sample.json").features;
}

const esRaw = (layer: EsRawFeature["layer"], fc: any): EsRawFeature[] =>
  fc.features.map((feature: any) => ({ layer, feature }));

const FIXTURE_SOURCES: { fixture: string[]; iso: string; features: () => any[] }[] = [
  { fixture: ["anac-pt-ed269-sample.json"], iso: "PT", features: () => normalizePortugueseZones(json("anac-pt-ed269-sample.json")) },
  { fixture: ["bazl-ch-ed269-sample.json"], iso: "CH", features: () => normalizeSwissEd269(json("bazl-ch-ed269-sample.json")) },
  {
    fixture: ["bazl-ch-activity-sample.geojson"],
    iso: "CH",
    features: () => normalizeSwissActivityZones(JSON.parse(stripBom(text("bazl-ch-activity-sample.geojson")))),
  },
  {
    fixture: ["be-skeyes-ebaw-donut-sample.json"],
    iso: "BE",
    features: () => json("be-skeyes-ebaw-donut-sample.json").features.map((f: any) => ({ ...f, geometry: cleanBelgianGeometry(f.geometry) })),
  },
  {
    fixture: ["be-skeyes-round-angular-sample.json"],
    iso: "BE",
    features: () => {
      const fc = json("be-skeyes-round-angular-sample.json");
      return Array.isArray(fc) ? fc : fc.features;
    },
  },
  {
    fixture: ["bg-caa-wfs-sample.json"],
    iso: "BG",
    features: () => {
      const fx = json("bg-caa-wfs-sample.json");
      return [
        ...normalizeBulgarianZones(fx.caa, { now: NOW }),
        ...normalizeBulgarianBulatsaZonesWithStats(fx.bulatsa, { now: NOW }).features,
      ];
    },
  },
  { fixture: ["cy-dca-arcgis-sample.json"], iso: "CY", features: () => normalizeCyprusZones(json("cy-dca-arcgis-sample.json")) },
  { fixture: ["dflight-it-ed269-sample.json"], iso: "IT", features: () => normalizeItalianZones(json("dflight-it-ed269-sample.json"), NOW) },
  { fixture: ["dronesoner-no-ed269-sample.json"], iso: "NO", features: () => norwayFeaturesFromBody(json("dronesoner-no-ed269-sample.json")) },
  { fixture: ["drz-lv-ed269-sample.json"], iso: "LV", features: () => normalizeLatvianZones(json("drz-lv-ed269-sample.json"), NOW) },
  {
    fixture: ["es-enaire-arcgis-sample.json"],
    iso: "ES",
    features: () => {
      const arc = json("es-enaire-arcgis-sample.json");
      return normalizeSpanishFeatures(
        [
          ...esRaw("ZGUAS_Aero", arc.aeroPage1),
          ...esRaw("ZGUAS_Aero", arc.aeroPage2),
          ...esRaw("ZGUAS_Urbano", arc.urbano),
          ...esRaw("ZGUAS_Infraestructuras", arc.infra),
        ],
        NOW,
      );
    },
  },
  {
    fixture: ["es-enaire-wfs-sample.json"],
    iso: "ES",
    features: () => normalizeSpanishFeatures(esRaw("ZGUAS_Urbano", json("es-enaire-wfs-sample.json").ZGUAS_Urbano), NOW),
  },
  { fixture: ["gb-uk-aip-sample.kml"], iso: "GB", features: () => unitedKingdomFeaturesFromKml(text("gb-uk-aip-sample.kml")) },
  {
    fixture: ["godrone-amsterdam.json"],
    iso: "NL",
    features: () => json("godrone-amsterdam.json").features.map((f: any) => normalizeGodroneFeature(f)).filter(Boolean),
  },
  { fixture: ["hr-amc-signalr-sample.json"], iso: "HR", features: () => croatiaFeaturesFromPushes(json("hr-amc-signalr-sample.json"), NOW) as any[] },
  { fixture: ["is-samgongustofa-wfs-sample.json"], iso: "IS", features: () => normalizeIcelandicZones(json("is-samgongustofa-wfs-sample.json")) },
  {
    fixture: ["lu-ogc-1927-1928-sample.json"],
    iso: "LU",
    features: () => {
      const fx = json("lu-ogc-1927-1928-sample.json");
      return mergeLuxembourgOgc([fx.c1927, fx.c1928]) as any[];
    },
  },
  { fixture: ["se-ed318-sample.json"], iso: "SE", features: () => ed318ZonesToFeatures(json("se-ed318-sample.json"), { idPrefix: "SE", now: NOW }) },
  {
    fixture: ["se-wfs-sample.json"],
    iso: "SE",
    features: () => {
      const wfs = json("se-wfs-sample.json");
      return SE_WFS_LAYERS.flatMap(({ layer }) => normalizeSwedishWfsFeatures(layer, wfs[layer], NOW));
    },
  },
  {
    fixture: ["si-caa-arcgis-sample.json"],
    iso: "SI",
    features: () => {
      const fx = json("si-caa-arcgis-sample.json");
      return normalizeSloveniaLayersWithStats(
        SI_LAYERS.map((layer) => ({ layer, features: fx.layers[layer.key]?.features ?? [] })),
      ).features;
    },
  },
  {
    fixture: ["sk-du-uas-zones-sample.kml", "sk-lps-arcgis-sample.json"],
    iso: "SK",
    features: () => normalizeSlovakiaWithStats({ duKml: text("sk-du-uas-zones-sample.kml"), lps: slovakLps(), now: NOW.getTime() }).features,
  },
  { fixture: ["traficom-uas-zones-sample.json"], iso: "FI", features: () => finlandFeaturesFromBody(json("traficom-uas-zones-sample.json"), NOW) },
  { fixture: ["pansa_kml_sample.kml"], iso: "PL", features: () => polandFeaturesFromKml(text("pansa_kml_sample.kml")) },
  {
    fixture: ["ro_zones_sample.geojson", "ro_notam_sample.geojson"],
    iso: "RO",
    features: () => normalizeRomanianGeozones(json("ro_zones_sample.geojson"), json("ro_notam_sample.geojson"), NOW).features,
  },
  { fixture: ["mt_zones_sample.geojson"], iso: "MT", features: () => normalizeMalteseImport(json("mt_zones_sample.geojson").features) },
  {
    // ENAIRE Layer 0 = Flugplatz-Bezugspunkte (keine Zonen): echte Attribute je
    // Zonen-Layer mit kleiner Fläche um den Punkt geprüft.
    fixture: ["enaire_aero_layer0_sample.geojson"],
    iso: "ES",
    features: () =>
      json("enaire_aero_layer0_sample.geojson").features.flatMap((f: any, i: number) => {
        const [lon, lat] = f.geometry.coordinates;
        const poly = { ...f, geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat]]] } };
        return ["es_aerodromos", "es_urbano", "es_enp0", "es_notam"].map((key) => normalizeEnaireInsigniasFeature(tagEsInsigniasFeature({ ...poly, id: i + 1 }, key), NOW)).filter(Boolean);
      }),
  },
];

describe("Jede Länder-Normalisierung liefert nur Union-Werte (alle Fixtures)", () => {
  it("alle Fixture-Dateien sind abgedeckt", () => {
    const covered = new Set(FIXTURE_SOURCES.flatMap((s) => s.fixture));
    const files = fs.readdirSync(FIX).filter((f) => !f.startsWith("."));
    assert.deepEqual(files.filter((f) => !covered.has(f)), [], "Fixture ohne Union-Test");
  });

  for (const src of FIXTURE_SOURCES) {
    it(`${src.fixture.join(" + ")} (${src.iso})`, () => {
      const features = src.features();
      assert.ok(features.length > 0, "Normalisierer liefert Features");
      for (const f of features) {
        const raw = f?.properties?.restriction;
        if (raw !== undefined && typeof raw !== "object") {
          assert.ok(isRestriction(raw), `${src.iso}: Normalisierer liefert ${JSON.stringify(raw)} (${f?.properties?.name})`);
        }
      }
      const infos = parseEd269ToGeozoneInfo(features as any[], src.iso);
      assert.ok(infos.length > 0, "parseEd269ToGeozoneInfo liefert Zonen");
      for (const z of infos) {
        assert.ok(isRestriction(z.restriction), `${src.iso}: ${z.name} → ${String(z.restriction)}`);
        assert.equal(z.fillColor, RESTRICTION_POLICY[z.restriction].fill, `${src.iso}: Farbe aus Policy`);
      }
    });
  }

  it("Kachelspeicher (DE/FR/CZ) und WMS-Pfade (CH/LU/NL) liefern Union-Werte", () => {
    const square = { type: "Polygon", coordinates: [[[8, 50], [8.01, 50], [8.01, 50.01], [8, 50.01], [8, 50]]] };
    const de = deZoneFromStored({ id: "kontrollzonen.1", geometry: square, properties: { name: "CTR X" } });
    const fr = frZoneFromStored({ id: "fr.1", geometry: square, properties: { limite: "Vol interdit", remarque: "Zone interdite" } });
    const cz = czZoneFromStored({ geometry: { ...square, layer: { lower: 0, upper: 120, uom: "m" } }, properties: { identifier: "LKR1", type: "REQ_AUTHORIZATION" } });
    const czUnknown = czZoneFromStored({ geometry: { ...square, layer: {} }, properties: { identifier: "LKX", type: "SOMETHING" } });
    assert.equal(de?.restriction, "REQ_AUTHORISATION");
    assert.equal(fr?.restriction, "PROHIBITED");
    assert.equal(cz?.restriction, "REQ_AUTHORISATION");
    assert.equal(czUnknown?.restriction, "UNKNOWN");
    assert.equal(czUnknown?.restrictionRaw, "SOMETHING");
    const ch = parseChIdentifyResponse(
      { results: [{ layerBodId: "x", attributes: { zone_name_de: "A", zone_restriction: "REQ_AUTHORIZATION" } }, { layerBodId: "x", attributes: { zone_name_de: "Sperrgebiet B" } }] },
      {},
    );
    assert.deepEqual(ch.map((z) => z.restriction), ["REQ_AUTHORISATION", "PROHIBITED"]);
    const lu = parseLuWmsToGeozoneInfo([{ "Zone Identifier": "Z1", Responsability: "Zone interdite" }, { "Zone Identifier": "Z2" }]);
    assert.deepEqual(lu.map((z) => z.restriction), ["PROHIBITED", "UNKNOWN"]);
    for (const z of [de, fr, cz, czUnknown, ...ch, ...lu]) assert.ok(isRestriction(z?.restriction));
  });
});

describe("Heuristiken ohne strukturierte Einstufung", () => {
  it("DE dipul: Layer → Einstufung (Semantik der bisherigen DE-Logik)", () => {
    assert.equal(deRestrictionForLayer("flugbeschraenkungsgebiete"), "RESTRICTED");
    assert.equal(deRestrictionForLayer("Flugbeschränkungsgebiete (ED-R)"), "RESTRICTED");
    assert.equal(deRestrictionForLayer("kontrollzonen"), "REQ_AUTHORISATION");
    assert.equal(deRestrictionForLayer("flughaefen"), "REQ_AUTHORISATION");
    assert.equal(deRestrictionForLayer("flugplaetze"), "CONDITIONAL");
    assert.equal(deRestrictionForLayer("modellflugplaetze"), "CONDITIONAL");
    assert.equal(deRestrictionForLayer("haengegleiter"), "CONDITIONAL");
    assert.equal(deRestrictionForLayer("temporaere_betriebseinschraenkungen"), "PROHIBITED");
    assert.equal(
      deRestrictionForLayer("temporaere_betriebseinschraenkungen", "Betrieb mit Genehmigung der Stelle zulässig"),
      "REQ_AUTHORISATION",
    );
    for (const l of ["wohngrundstuecke", "bahnanlagen", "bundesautobahnen", "binnenwasserstrassen", "industrieanlagen", "kraftwerke", "naturschutzgebiete", "nationalparks", "behoerden", "krankenhaeuser", "freibaeder"]) {
      assert.equal(deRestrictionForLayer(l), "REQ_AUTHORISATION", l);
    }
    const z = dipulZoneFromFeature(
      { id: "bahnanlagen.1", geometry: { type: "Polygon", coordinates: [[[8, 50], [8.01, 50], [8.01, 50.01], [8, 50]]] }, properties: { type_code: "RAILWAY" } },
      { id: "bahnanlagen", wmsLayer: "bahnanlagen", label: "Bahnanlagen", defaultEnabled: true },
    );
    assert.equal(z?.restriction, "REQ_AUTHORISATION");
    assert.equal(z?.restrictionRaw, "RAILWAY");
  });

  it("FR DGAC: limite/Typ → Einstufung", () => {
    assert.equal(frRestrictionFromText("Vol interdit", ""), "PROHIBITED");
    assert.equal(frRestrictionFromText("0", "aérodrome"), "PROHIBITED");
    assert.equal(frRestrictionFromText("50", "aérodrome de Toussus"), "CONDITIONAL");
    assert.equal(frRestrictionFromText("", "CTR aérodrome"), "REQ_AUTHORISATION");
    assert.equal(frRestrictionFromText("", "centrale nucléaire"), "PROHIBITED");
    assert.equal(frRestrictionFromText("", "parc national"), "NATURE");
    assert.equal(frRestrictionFromText("", ""), "CONDITIONAL");
  });

  it("NL PDOK / LU / Text-Rückfall", () => {
    assert.equal(nlRestriction("Verboden", ""), "PROHIBITED");
    assert.equal(nlRestriction("", "Verboden voor open categorie"), "PROHIBITED");
    assert.equal(nlRestriction("Beperking", ""), "RESTRICTED");
    assert.equal(nlRestriction("", "Toegestaan met beperkingen"), "CONDITIONAL");
    assert.equal(nlRestriction("Natura2000", ""), "NATURE");
    assert.equal(nlRestriction("CTR", ""), "REQ_AUTHORISATION");
    assert.equal(nlRestriction("", ""), "UNKNOWN");
    assert.equal(luRestrictionFromResponsibility("Demande d'autorisation"), "REQ_AUTHORISATION");
    assert.equal(luRestrictionFromResponsibility("Vol interdit"), "PROHIBITED");
    assert.equal(luRestrictionFromResponsibility("DAC"), "CONDITIONAL");
    assert.equal(restrictionFromText("Flugverbot über dem Gelände"), "PROHIBITED");
    assert.equal(restrictionFromText("Vor dem Flug bei der Provinz prüfen"), "UNKNOWN");
    assert.equal(restrictionFromText(""), "UNKNOWN");
  });

  it("zoneRestriction: strukturiert vor Text, DE aus Layer, Hinweis-Zonen = Info", () => {
    assert.equal(zoneRestriction({ restriction: "CONDITIONAL", details: "Flugverbot" }), "CONDITIONAL");
    assert.equal(zoneRestriction({ restriction: "REQ_AUTHORIZATION" }), "REQ_AUTHORISATION");
    assert.equal(zoneRestriction({ details: "Flugverbot" }), "PROHIBITED");
    assert.equal(zoneRestriction({ country: "DE", layerLabel: "Flugbeschränkungsgebiete (ED-R)" }), "RESTRICTED");
    assert.equal(zoneRestriction({ restriction: "PROHIBITED", informationalOnly: true }), "NO_RESTRICTION");
  });

  it("Höhen-Klassifizierung: Text-Verbot nur ohne strukturierte Einstufung, RESTRICTED sticht Höhentext", () => {
    assert.equal(classifyGeozoneAltitude({ details: "Flugverbot" }).kind, "noFly");
    assert.equal(classifyGeozoneAltitude({ restriction: "CONDITIONAL", details: "gesperrt bei Veranstaltungen. Maximale Flughöhe 50 m" }).kind, "altitudeLimit");
    assert.equal(classifyGeozoneAltitude({ restriction: "RESTRICTED", details: "Maximale Flughöhe 50 m" }).kind, "unknown");
    assert.equal(classifyGeozoneAltitude({ restriction: "PROHIBITED" }).kind, "noFly");
  });
});

// ---------------------------------------------------------------------------
// Planungsliste + Radar-Reiter
// ---------------------------------------------------------------------------

const zone = (restriction: Restriction, extra: Record<string, unknown> = {}) => ({
  layerLabel: "L",
  name: `Zone ${restriction}`,
  details: "",
  restriction,
  ...extra,
});

describe("Planungsliste über die Policy", () => {
  it("PROHIBITED → NO-GO, außer mit dokumentierter Begründung", () => {
    const z = zone("PROHIBITED");
    const open = classifyPlanningZones([z], { isCoveredByAV: () => true });
    assert.equal(open.verdict, "nogo");
    assert.deepEqual(open.openProhibitedZones, [z]);
    // Ausnahme-Haken und AV decken kein Verbot.
    const exempted = classifyPlanningZones([z], { isCoveredByAV: () => true, isExempted: () => true });
    assert.equal(exempted.verdict, "nogo");
    assert.deepEqual(exempted.exemptedZones, []);
    // Leere Begründung zählt nicht.
    assert.equal(classifyPlanningZones([z], { isCoveredByAV: () => false, overrideReason: () => "   " }).verdict, "nogo");
    const overridden = classifyPlanningZones([z], { isCoveredByAV: () => false, overrideReason: () => "Sondergenehmigung Az. 42" });
    assert.equal(overridden.verdict, "caution");
    assert.deepEqual(overridden.overriddenZones, [z]);
    assert.deepEqual(overridden.confirmationZones, []);
    assert.equal(
      buildProhibitedOverrideNote(overridden.overriddenZones, () => "Sondergenehmigung Az. 42"),
      "Flugverbot bewusst übersteuert: Zone PROHIBITED (Begründung: Sondergenehmigung Az. 42)",
    );
  });

  it("NO_RESTRICTION → nur Info, keine Bestätigung, kein AV-Check", () => {
    const z = zone("NO_RESTRICTION");
    const c = classifyPlanningZones([z], {
      isCoveredByAV: () => {
        throw new Error("Info-Zone darf nicht in die AV-Prüfung");
      },
    });
    assert.deepEqual(c.infoZones, [z]);
    assert.deepEqual(c.uncoveredZones, []);
    assert.deepEqual(c.confirmationZones, []);
    assert.equal(c.verdict, "info");
  });

  it("REQ_AUTHORISATION: AV deckt (wenn Abdeckungs-Callback zustimmt), RESTRICTED nie", () => {
    const req = zone("REQ_AUTHORISATION", { country: "DE", layerLabel: "Wohngrundstücke" });
    const restricted = zone("RESTRICTED", { country: "DE", layerLabel: "Flugbeschränkungsgebiete (ED-R)" });
    const c = classifyPlanningZones([req, restricted], { isCoveredByAV: () => true });
    assert.deepEqual(c.coveredZones, [req]);
    assert.deepEqual(c.uncoveredZones, [restricted]);
    assert.deepEqual(c.confirmationZones, [restricted]);
    assert.equal(c.verdict, "caution");
    // Einzelgenehmigung erledigt eine Freigabepflicht.
    const e = classifyPlanningZones([restricted], { isCoveredByAV: () => false, isExempted: () => true });
    assert.deepEqual(e.exemptedZones, [restricted]);
    assert.equal(e.verdict, "info");
  });

  it("CONDITIONAL/NATURE/UNKNOWN → CAUTION ohne Pflichtbestätigung", () => {
    const zs = (["CONDITIONAL", "NATURE", "UNKNOWN"] as Restriction[]).map((r) => zone(r));
    const c = classifyPlanningZones(zs, { isCoveredByAV: () => false });
    assert.equal(c.verdict, "caution");
    assert.deepEqual(c.confirmationZones, []);
    assert.equal(c.uncoveredZones.length, 3);
  });
});

describe("Radar-Reiter und Liste bewerten dieselbe Zone gleich", () => {
  const expectedTab: Record<Restriction, "red" | "orange" | "blue"> = {
    PROHIBITED: "red",
    RESTRICTED: "red",
    REQ_AUTHORISATION: "red",
    CONDITIONAL: "orange",
    NATURE: "orange",
    UNKNOWN: "orange",
    NO_RESTRICTION: "blue",
  };
  for (const r of RESTRICTIONS) {
    it(`${r}: Reiter = Listen-Bewertung`, () => {
      const z = zone(r);
      const radar = computeGeozoneTabSeverity([z], { isCoveredByAV: () => false, now: NOW.getTime() });
      const list = classifyPlanningZones([z], { isCoveredByAV: () => false }).assessment(z);
      assert.equal(radar, expectedTab[r]);
      assert.equal(list.tab, radar);
      assert.equal(assessGeozoneForRadar(z, { isCoveredByAV: () => false, now: NOW }).policy.color, list.policy.color);
      assert.equal(list.policy.color, RESTRICTION_POLICY[r].color);
    });
  }

  it("AV-gedeckte Genehmigungspflicht: Reiter orange, Liste 'abgedeckt'", () => {
    const z = zone("REQ_AUTHORISATION", { country: "DE", layerLabel: "Bahnanlagen" });
    assert.equal(computeGeozoneTabSeverity([z], { isCoveredByAV: () => true, now: NOW.getTime() }), "orange");
    const c = classifyPlanningZones([z], { isCoveredByAV: () => true });
    assert.deepEqual(c.coveredZones, [z]);
    assert.equal(c.assessment(z).tab, "orange");
    // RESTRICTED ist kein reines Höhenlimit mehr: AV deckt nie, Reiter rot.
    const r = zone("RESTRICTED");
    assert.equal(computeGeozoneTabSeverity([r], { isCoveredByAV: () => true, now: NOW.getTime() }), "red");
  });

  it("inaktive Zone: blau, unabhängig von der Einstufung", () => {
    const z = zone("PROHIBITED", { validStartTs: NOW.getTime() + 86400000 });
    assert.equal(computeGeozoneTabSeverity([z], { isCoveredByAV: () => false, now: NOW.getTime() }), "blue");
    assert.equal(assessZoneRestriction(z, { active: false }).verdict, "info");
  });
});
