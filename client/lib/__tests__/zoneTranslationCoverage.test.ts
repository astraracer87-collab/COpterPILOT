// Übersetzungsabdeckung aller Fixtures über den Anzeigepfad (client/lib/ed269.ts):
// jede angezeigte Behördenzeile und jeder Zonenname muss deutsch, übersetzt
// (Wörterbuch/Muster) oder bewusst unverändert sein (Kennungen, Kontakte,
// Eigennamen) – mindestens 98 %. Dazu Integrität des Wörterbuchs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { hasGermanFor, translationKey } from "../../../shared/zoneTranslate";
import { stripHtml } from "../../../shared/geozoneKit/text";
import { ORIGINAL_TEXT_HEADING } from "../../../shared/geozoneKit/messages";
import { parseEd269ToGeozoneInfo } from "../ed269";

import { normalizePortugueseZones } from "../../../shared/portugueseGeozones";
import { normalizeSwissEd269, normalizeSwissActivityZones, stripBom } from "../../../shared/swissGeozones";
import { normalizeBulgarianZones, normalizeBulgarianBulatsaZonesWithStats } from "../../../shared/bulgarianGeozones";
import { normalizeCyprusZones } from "../../../shared/cypriotGeozones";
import { IT_WFS_LAYER_NFZ, IT_WFS_LAYER_NOTAM, IT_WFS_LAYER_ZONES, normalizeItalianWfs, normalizeItalianZones } from "../../../shared/italianGeozones";
import { norwayFeaturesFromBody } from "../geozoneDirect/norwaySource";
import { normalizeLatvianZones } from "../../../shared/latvianGeozones";
import { normalizeSpanishFeatures, normalizeEnaireInsigniasFeature, tagEsInsigniasFeature, type EsRawFeature } from "../../../shared/spanishGeozones";
import { unitedKingdomFeaturesFromKml } from "../geozoneDirect/ukSource";
import { normalizeUkAixm } from "../../../shared/ukGeozones";
import { parseAixmDatasetSync } from "../../../shared/geozoneKit/aixm";
import { normalizeGodroneFeature } from "../../../shared/dutchGeozones";
import { croatiaFeaturesFromPushes } from "../geozoneDirect/croatiaSource";
import { mergeIcelandicZoneLayers, normalizeIcelandicZones } from "../../../shared/icelandicGeozones";
import { ed318ZonesToFeatures } from "../../../shared/ed318Pure";
import { SE_WFS_LAYERS, normalizeSwedishWfsFeatures } from "../../../shared/swedishGeozones";
import { normalizeSloveniaLayersWithStats, resolveSloveniaLayersFromWebmap } from "../../../shared/slovenianGeozones";
import { normalizeDanishLiveLayers } from "../../../shared/danishGeozones";
import { mergeNorwayDataLayers } from "../../../shared/norwegianGeozones";
import { normalizeSlovakiaWithStats } from "../../../shared/slovakGeozones";
import { finlandFeaturesFromBody } from "../geozoneDirect/finlandSource";
import { polandFeaturesFromKml } from "../geozoneDirect/polandSource";
import { normalizeRomanianGeozones } from "../../../shared/romanianGeozones";
import { normalizeMalteseImport } from "../../../shared/malteseGeozones";
import { normalizePansaZonesJson } from "../../../shared/polishGeozones";
import { mergeLuxembourgOgc, normalizeLuxembourgOgc } from "../../../shared/irishLuxGeozones";

const FIX = path.join(__dirname, "fixtures");
const DOCS_FIX = path.join(__dirname, "..", "..", "..", "docs", "fixtures");
const json = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const text = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");
const NOW = new Date("2026-11-15T12:00:00Z");
const esRaw = (layer: EsRawFeature["layer"], fc: any): EsRawFeature[] => fc.features.map((feature: any) => ({ layer, feature }));

// Wie restrictionPolicy.test.ts: jede Fixture durch ihren Normalisierer
const SOURCES: { fixture: string; iso: string; features: () => any[] }[] = [
  { fixture: "anac-pt-ed269-sample.json", iso: "PT", features: () => normalizePortugueseZones(json("anac-pt-ed269-sample.json")) },
  { fixture: "bazl-ch-ed269-sample.json", iso: "CH", features: () => normalizeSwissEd269(json("bazl-ch-ed269-sample.json")) },
  { fixture: "bazl-ch-activity-sample.geojson", iso: "CH", features: () => normalizeSwissActivityZones(JSON.parse(stripBom(text("bazl-ch-activity-sample.geojson")))) },
  { fixture: "be-skeyes-ebaw-donut-sample.json", iso: "BE", features: () => json("be-skeyes-ebaw-donut-sample.json").features },
  { fixture: "be-skeyes-round-angular-sample.json", iso: "BE", features: () => { const fc = json("be-skeyes-round-angular-sample.json"); return Array.isArray(fc) ? fc : fc.features; } },
  {
    fixture: "bg-caa-wfs-sample.json",
    iso: "BG",
    features: () => {
      const fx = json("bg-caa-wfs-sample.json");
      return [...normalizeBulgarianZones(fx.caa, { now: NOW }), ...normalizeBulgarianBulatsaZonesWithStats(fx.bulatsa, { now: NOW }).features];
    },
  },
  { fixture: "cy-dca-arcgis-sample.json", iso: "CY", features: () => normalizeCyprusZones(json("cy-dca-arcgis-sample.json")) },
  { fixture: "dflight-it-ed269-sample.json", iso: "IT", features: () => normalizeItalianZones(json("dflight-it-ed269-sample.json"), NOW) },
  {
    fixture: "dflight-it-wfs-sample.json",
    iso: "IT",
    features: () => {
      const wfs = json("dflight-it-wfs-sample.json");
      return [...normalizeItalianWfs(wfs.ATM09_INFO, IT_WFS_LAYER_ZONES, NOW), ...normalizeItalianWfs(wfs.NO_FLY_ZONE, IT_WFS_LAYER_NFZ, NOW), ...normalizeItalianWfs(wfs.NOTAM, IT_WFS_LAYER_NOTAM, NOW)];
    },
  },
  { fixture: "dronesoner-no-ed269-sample.json", iso: "NO", features: () => norwayFeaturesFromBody(json("dronesoner-no-ed269-sample.json")) },
  { fixture: "drz-lv-ed269-sample.json", iso: "LV", features: () => normalizeLatvianZones(json("drz-lv-ed269-sample.json"), NOW) },
  {
    fixture: "es-enaire-arcgis-sample.json",
    iso: "ES",
    features: () => {
      const a = json("es-enaire-arcgis-sample.json");
      return normalizeSpanishFeatures([...esRaw("ZGUAS_Aero", a.aeroPage1), ...esRaw("ZGUAS_Aero", a.aeroPage2), ...esRaw("ZGUAS_Urbano", a.urbano), ...esRaw("ZGUAS_Infraestructuras", a.infra)], NOW);
    },
  },
  { fixture: "es-enaire-wfs-sample.json", iso: "ES", features: () => normalizeSpanishFeatures(esRaw("ZGUAS_Urbano", json("es-enaire-wfs-sample.json").ZGUAS_Urbano), NOW) },
  { fixture: "gb-uk-aip-sample.kml", iso: "GB", features: () => unitedKingdomFeaturesFromKml(text("gb-uk-aip-sample.kml")) },
  { fixture: "gb-nats-aixm-sample.xml", iso: "GB", features: () => normalizeUkAixm(parseAixmDatasetSync(text("gb-nats-aixm-sample.xml"))) as any[] },
  { fixture: "godrone-amsterdam.json", iso: "NL", features: () => json("godrone-amsterdam.json").features.map((f: any) => normalizeGodroneFeature(f)).filter(Boolean) },
  { fixture: "hr-amc-signalr-sample.json", iso: "HR", features: () => croatiaFeaturesFromPushes(json("hr-amc-signalr-sample.json"), NOW) as any[] },
  { fixture: "is-samgongustofa-wfs-sample.json", iso: "IS", features: () => normalizeIcelandicZones(json("is-samgongustofa-wfs-sample.json")) },
  {
    fixture: "is-samgongustofa-ice-isl-sample.json",
    iso: "IS",
    features: () => {
      const fx = json("is-samgongustofa-ice-isl-sample.json");
      return mergeIcelandicZoneLayers(normalizeIcelandicZones(fx.ice), normalizeIcelandicZones(fx.isl));
    },
  },
  { fixture: "lu-ogc-1927-1928-sample.json", iso: "LU", features: () => { const fx = json("lu-ogc-1927-1928-sample.json"); return mergeLuxembourgOgc([fx.c1927, fx.c1928]) as any[]; } },
  { fixture: "docs/lu_zones_1928_sample.geojson", iso: "LU", features: () => normalizeLuxembourgOgc(JSON.parse(fs.readFileSync(path.join(DOCS_FIX, "lu_zones_1928_sample.geojson"), "utf8"))) },
  { fixture: "se-ed318-sample.json", iso: "SE", features: () => ed318ZonesToFeatures(json("se-ed318-sample.json"), { idPrefix: "SE", now: NOW }) },
  { fixture: "se-wfs-sample.json", iso: "SE", features: () => { const wfs = json("se-wfs-sample.json"); return SE_WFS_LAYERS.flatMap(({ layer }) => normalizeSwedishWfsFeatures(layer, wfs[layer], NOW)); } },
  {
    fixture: "si-caa-arcgis-sample.json",
    iso: "SI",
    features: () => {
      const fx = json("si-caa-arcgis-sample.json");
      const { layers } = resolveSloveniaLayersFromWebmap(json("si-caa-webmap-sample.json"));
      return normalizeSloveniaLayersWithStats(layers.map((layer) => ({ layer, features: fx.layers[layer.key]?.features ?? [] }))).features;
    },
  },
  {
    fixture: "sk-du-uas-zones-sample.kml",
    iso: "SK",
    features: () =>
      normalizeSlovakiaWithStats({
        duKml: text("sk-du-uas-zones-sample.kml"),
        lps: json("sk-lps-arcgis-sample.json").features,
        now: Date.parse("2026-11-15T12:00:00Z"),
        reservations: json("sk-lps-reservations-sample.json").reservations.features,
        reservationHealth: { ok: true },
      }).features,
  },
  {
    fixture: "dk-dronezoner-live-sample.json",
    iso: "DK",
    features: () => {
      const fx = json("dk-dronezoner-live-sample.json");
      return normalizeDanishLiveLayers({ awareness: fx.awareness.features, disabled: fx.disabled.features, corridors: fx.corridors.features }, Date.parse("2026-11-15T16:20:00Z"));
    },
  },
  {
    fixture: "no-dronesoner-data-sample.json",
    iso: "NO",
    features: () => {
      const fx = json("no-dronesoner-data-sample.json");
      const files = Object.fromEntries(Object.entries(fx.files).map(([k, v]: [string, any]) => [k, v.features]));
      return mergeNorwayDataLayers([], files, { now: Date.parse("2026-11-15T16:30:00Z") }).features;
    },
  },
  { fixture: "traficom-uas-zones-sample.json", iso: "FI", features: () => finlandFeaturesFromBody(json("traficom-uas-zones-sample.json"), NOW) },
  { fixture: "pansa_kml_sample.kml", iso: "PL", features: () => polandFeaturesFromKml(text("pansa_kml_sample.kml")) },
  { fixture: "pansa_zones_json_handbuilt.json", iso: "PL", features: () => normalizePansaZonesJson(json("pansa_zones_json_handbuilt.json"), NOW.getTime()).features },
  { fixture: "ro_zones_sample.geojson", iso: "RO", features: () => normalizeRomanianGeozones(json("ro_zones_sample.geojson"), json("ro_notam_sample.geojson"), NOW).features },
  { fixture: "mt_zones_sample.geojson", iso: "MT", features: () => normalizeMalteseImport(json("mt_zones_sample.geojson").features) },
  {
    fixture: "enaire_aero_layer0_sample.geojson",
    iso: "ES",
    features: () =>
      json("enaire_aero_layer0_sample.geojson").features.flatMap((f: any, i: number) => {
        const [lon, lat] = f.geometry.coordinates;
        const poly = { ...f, geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat]]] } };
        return ["es_aerodromos", "es_urbano", "es_enp0", "es_notam"].map((key) => normalizeEnaireInsigniasFeature(tagEsInsigniasFeature({ ...poly, id: i + 1 }, key), NOW)).filter(Boolean);
      }),
  },
  {
    fixture: "es-enaire-notam-handbuilt.geojson",
    iso: "ES",
    features: () => json("es-enaire-notam-handbuilt.geojson").features.map((f: any) => normalizeEnaireInsigniasFeature(tagEsInsigniasFeature(f, "es_notam"), NOW)).filter(Boolean),
  },
];

/** Angezeigte Behördentexte wie client/lib/ed269.ts (Meldung inkl. Originalblock, Grund, Name). */
function displayedTexts(features: any[]): { lines: string[]; names: string[] } {
  const lines: string[] = [];
  const names: string[] = [];
  for (const f of features) {
    const p: any = f?.properties ?? {};
    if (p.hidden === true || !f?.geometry) continue;
    const name = translationKey(String(p.name || p.identifier || p.zoneId || ""));
    if (name) names.push(name);
    const loc = p.extendedProperties?.localizedMessages;
    let message = "";
    if (Array.isArray(loc) && loc.length) {
      const pick =
        loc.find((m: any) => String(m?.language || "").toLowerCase().startsWith("de")) ??
        loc.find((m: any) => String(m?.language || "").toLowerCase().startsWith("en")) ??
        loc[0];
      message = stripHtml(String(pick?.message || pick?.text || ""));
    }
    if (!message) message = stripHtml(String(p.message || p.reason || p.description || ""));
    if (p.reason) message += `\nGrund: ${stripHtml(String(p.reason))}`;
    for (const raw of message.split("\n")) {
      const k = translationKey(raw);
      if (k && k !== ORIGINAL_TEXT_HEADING && /[A-Za-zÀ-ÿĀ-žΑ-ωА-я]{3}/.test(k)) lines.push(k);
    }
  }
  return { lines: [...new Set(lines)], names: [...new Set(names)] };
}

describe("Übersetzungsabdeckung aller Fixtures (Anzeigepfad, ≥ 98 %)", () => {
  it("alle Fixture-Dateien sind erfasst", () => {
    const covered = new Set(SOURCES.map((s) => s.fixture));
    // Teil-Fixtures, die über eine Haupt-Fixture laufen
    for (const f of ["si-caa-webmap-sample.json", "sk-lps-arcgis-sample.json", "sk-lps-reservations-sample.json", "ro_notam_sample.geojson", "es-enaire-webmap-handbuilt.json"]) covered.add(f);
    const files = fs.readdirSync(FIX).filter((f) => !f.startsWith("."));
    assert.deepEqual(files.filter((f) => !covered.has(f)), []);
  });

  const allLines: { iso: string; text: string; ok: boolean }[] = [];
  const allNames: { iso: string; text: string; ok: boolean }[] = [];
  for (const src of SOURCES) {
    it(`${src.fixture} (${src.iso})`, () => {
      const features = src.features();
      const { lines, names } = displayedTexts(features);
      for (const l of lines) allLines.push({ iso: src.iso, text: l, ok: hasGermanFor(l, "line") });
      for (const n of names) allNames.push({ iso: src.iso, text: n, ok: hasGermanFor(n, "name") });
      // Anzeige: genau so viele „(nicht übersetzt)“-Hinweise wie fehlende Zeilen (höchstens)
      const infos = parseEd269ToGeozoneInfo(features, src.iso);
      const marks = infos.reduce((n, z) => n + (z.details.match(/\(nicht übersetzt\)/g)?.length ?? 0), 0);
      const missing = lines.filter((l) => !hasGermanFor(l, "line")).length;
      if (missing === 0) assert.equal(marks, 0, `${src.fixture}: Kennzeichnung ohne fehlende Zeile`);
    });
  }

  it("mindestens 98 % der Zeilen und Namen deutsch bzw. bewusst unverändert", (t) => {
    const pct = (xs: { ok: boolean }[]) => (xs.length ? (100 * xs.filter((x) => x.ok).length) / xs.length : 100);
    const missL = allLines.filter((x) => !x.ok);
    const missN = allNames.filter((x) => !x.ok);
    t.diagnostic(`Zeilen ${allLines.length - missL.length}/${allLines.length} (${pct(allLines).toFixed(1)} %), Namen ${allNames.length - missN.length}/${allNames.length} (${pct(allNames).toFixed(1)} %)`);
    for (const x of [...missL, ...missN]) t.diagnostic(`nicht übersetzt (${x.iso}): ${x.text.slice(0, 160)}`);
    assert.ok(allLines.length > 1000 && allNames.length > 300, "Fixtures geladen");
    assert.ok(pct(allLines) >= 98, `Zeilen nur ${pct(allLines).toFixed(1)} %`);
    assert.ok(pct(allNames) >= 98, `Namen nur ${pct(allNames).toFixed(1)} %`);
  });
});

describe("Wörterbuch shared/data/zoneTranslationsDe.json", () => {
  const raw = fs.readFileSync(path.join(__dirname, "..", "..", "..", "shared", "data", "zoneTranslationsDe.json"), "utf8");
  const d = JSON.parse(raw) as { lines: Record<string, string>; names: Record<string, string>; unchangedNames: string[] };

  it("kompakt, sortiert, nur lines/names/unchangedNames", () => {
    assert.deepEqual(Object.keys(d), ["lines", "names", "unchangedNames"]);
    assert.equal(raw, JSON.stringify(d), "kompaktes JSON ohne Einrückung");
    const sorted = (a: string[]) => a.every((x, i) => i === 0 || a[i - 1] < x);
    assert.ok(sorted(Object.keys(d.lines)), "lines sortiert");
    assert.ok(sorted(Object.keys(d.names)), "names sortiert");
    assert.ok(sorted(d.unchangedNames), "unchangedNames sortiert");
  });

  it("keine leeren Werte, Schlüssel und Werte normalisiert", () => {
    for (const [k, v] of [...Object.entries(d.lines), ...Object.entries(d.names)]) {
      assert.ok(typeof v === "string" && v.trim().length > 0, `leer: ${k}`);
      assert.equal(translationKey(k), k, `Schlüssel nicht normalisiert: ${JSON.stringify(k)}`);
      assert.equal(translationKey(v), v, `Wert nicht normalisiert: ${JSON.stringify(k)}`);
    }
    for (const n of d.unchangedNames) assert.equal(translationKey(n), n, `unchangedNames nicht normalisiert: ${n}`);
  });

  it("unchangedNames eindeutig und nicht zugleich übersetzt", () => {
    assert.equal(new Set(d.unchangedNames).size, d.unchangedNames.length);
    for (const n of d.unchangedNames) assert.ok(!(n in d.names), `doppelt: ${n}`);
  });
});
