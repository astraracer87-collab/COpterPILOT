// B4: Prüfkette – Aggregation, Builder und Konsistenz Planung ↔ Pre-Check.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregate,
  sessionReasonsFromChecks,
  replaceCheckCategories,
  checksFor,
  geozoneChecks,
  legacyGeozoneChecks,
  coverageChecks,
  formatCoverageDataAges,
  formatDataAgeDe,
  notamChecks,
  officialMapCrossCheckChecks,
  complianceChecks,
  RESTRICTION_NOGO_TEXT,
  RESTRICTION_LIMITED_TEXT,
  RESTRICTION_UNCLEAR_TEXT,
  NOTAM_STATUS_UNKNOWN_TEXT,
  ALL_CHECKS_CLEAR_TEXT,
  type CheckResult,
  type CheckSeverity,
} from "../../../shared/checks";
import { classifyPlanningZones } from "../restrictionPlanning";
import { assessWeather } from "../assessment";
import {
  evaluateFlight,
  evaluateZones,
  nightChecks,
  storedChecksFor,
  weatherChecks,
  WEATHER_UNKNOWN_TEXT,
  type FlightEvaluationInput,
} from "../flightChecks";

const r = (id: string, severity: CheckSeverity, extra: Partial<CheckResult> = {}): CheckResult => ({
  id,
  category: "other",
  severity,
  title: id,
  detail: "",
  ...extra,
});

describe("aggregate (Tabelle)", () => {
  const table: Array<[string, CheckResult[], "go" | "caution" | "nogo"]> = [
    ["leer → GO", [], "go"],
    ["nur info → GO", [r("a", "info"), r("b", "info")], "go"],
    ["caution → CAUTION", [r("a", "info"), r("b", "caution")], "caution"],
    ["unknown ≥ caution → CAUTION", [r("a", "unknown")], "caution"],
    ["nogo → NO-GO", [r("a", "caution"), r("b", "nogo")], "nogo"],
    ["nogo überschrieben → CAUTION", [r("a", "nogo", { overriddenBy: { reason: "Az. 1", at: "t" } })], "caution"],
    ["nogo mit leerer Begründung bleibt NO-GO", [r("a", "nogo", { overriddenBy: { reason: "  ", at: "t" } })], "nogo"],
    ["überschrieben + offenes nogo → NO-GO", [r("a", "nogo", { overriddenBy: { reason: "x", at: "t" } }), r("b", "nogo")], "nogo"],
    ["unknown + info → CAUTION", [r("a", "info"), r("b", "unknown")], "caution"],
  ];
  for (const [name, input, verdict] of table) {
    it(name, () => assert.equal(aggregate(input).verdict, verdict));
  }

  it("Gründe ohne info, stabil nach Schwere absteigend", () => {
    const agg = aggregate([
      r("c1", "caution"),
      r("i", "info"),
      r("u1", "unknown"),
      r("n", "nogo"),
      r("c2", "caution"),
      r("o", "nogo", { overriddenBy: { reason: "x", at: "t" } }),
      r("u2", "unknown"),
    ]);
    assert.deepEqual(agg.reasons.map((x) => x.id), ["n", "u1", "u2", "c1", "c2", "o"]);
  });

  it("requiresConfirmation aus den Gründen", () => {
    assert.equal(aggregate([r("a", "caution", { requiresConfirmation: true })]).requiresConfirmation, true);
    assert.equal(aggregate([r("a", "info", { requiresConfirmation: true })]).requiresConfirmation, false);
  });

  it("Session-Gründe: nogo/caution bzw. ein GO-Grund", () => {
    assert.deepEqual(sessionReasonsFromChecks([r("a", "info")]), [{ type: "go", message: ALL_CHECKS_CLEAR_TEXT }]);
    assert.deepEqual(sessionReasonsFromChecks([r("a", "unknown"), r("b", "nogo")]), [
      { type: "nogo", message: "b" },
      { type: "caution", message: "a" },
    ]);
    const ov = sessionReasonsFromChecks([r("a", "nogo", { overriddenBy: { reason: "Az. 9", at: "t" } })]);
    assert.equal(ov[0].type, "caution");
    assert.match(ov[0].message, /Begründung: Az\. 9/);
  });

  it("replaceCheckCategories ersetzt nur Kategorie + Kontext", () => {
    const existing = [
      r("g-plan", "caution", { category: "geozone", context: "planning" }),
      r("g-pre", "caution", { category: "geozone", context: "precheck" }),
      r("w-plan", "caution", { category: "weather", context: "planning" }),
    ];
    const next = replaceCheckCategories(existing, [r("g-new", "info", { category: "geozone", context: "planning" })], ["geozone"], "planning");
    assert.deepEqual(next.map((x) => x.id), ["g-pre", "w-plan", "g-new"]);
    assert.deepEqual(checksFor(next, "planning", ["geozone"]).map((x) => x.id), ["g-new"]);
  });
});

const PROHIBITED = { layerLabel: "Temporäre Betriebseinschränkungen", name: "Sperrzone", details: "", restriction: "PROHIBITED", country: "DE" };
const REQ_AUTH = { layerLabel: "Kontrollzonen (CTR)", name: "CTR Test", details: "", restriction: "REQ_AUTHORISATION", country: "DE" };
const INFO = { layerLabel: "Info", name: "Info-Zone", details: "", restriction: "NO_RESTRICTION", country: "AT" };

describe("geozoneChecks", () => {
  it("offenes Flugverbot → nogo mit zoneRefs, überschreibbar", () => {
    const cls = classifyPlanningZones([PROHIBITED], { isCoveredByAV: () => false });
    const res = geozoneChecks({ context: "planning", classes: [cls], hasRestrictions: true });
    const p = res.find((x) => x.id === "geozone:prohibited")!;
    assert.equal(p.severity, "nogo");
    assert.equal(p.title, RESTRICTION_NOGO_TEXT);
    assert.deepEqual(p.zoneRefs, ["Sperrzone"]);
    assert.equal(p.overridable, true);
    assert.equal(aggregate(res).verdict, "nogo");
  });

  it("Override mit Begründung → overriddenBy, Urteil CAUTION", () => {
    const cls = classifyPlanningZones([PROHIBITED], { isCoveredByAV: () => false, overrideReason: () => "Az. 1" });
    const res = geozoneChecks({
      context: "planning",
      classes: [cls],
      overrideOf: () => ({ reason: "Az. 1", at: "2026-11-15T10:00:00.000Z" }),
      hasRestrictions: true,
    });
    const ov = res.find((x) => x.id.startsWith("geozone:prohibited-override"))!;
    assert.deepEqual(ov.overriddenBy, { reason: "Az. 1", at: "2026-11-15T10:00:00.000Z" });
    assert.equal(res.some((x) => x.id === "geozone:prohibited"), false);
    assert.equal(aggregate(res).verdict, "caution");
  });

  it("Status wie bisher assessWeather: approved → info, limited/ungeklärt → caution, keine → info", () => {
    const cls = classifyPlanningZones([REQ_AUTH], { isCoveredByAV: () => false });
    const s = (st: "approved" | "limited" | undefined, has = true) =>
      geozoneChecks({ context: "planning", classes: [cls], hasRestrictions: has, restrictionStatus: st }).find((x) => x.id === "geozone:status")!;
    assert.equal(s("approved").severity, "info");
    assert.equal(s("limited").title, RESTRICTION_LIMITED_TEXT);
    assert.equal(s(undefined).title, RESTRICTION_UNCLEAR_TEXT);
    assert.deepEqual(s(undefined).zoneRefs, ["CTR Test"]);
    assert.equal(s(undefined, false).severity, "info");
    // Manuelle Angabe "limited" ohne erkannte Zone zählt als Einschränkung.
    assert.equal(s("limited", false).severity, "caution");
  });

  it("AV-gedeckte DE-Zone + approved → GO", () => {
    const cls = classifyPlanningZones([REQ_AUTH], { isCoveredByAV: () => true });
    assert.equal(cls.coveredZones.length, 1);
    assert.equal(aggregate(geozoneChecks({ context: "planning", classes: [cls], hasRestrictions: true, restrictionStatus: "approved" })).verdict, "go");
  });

  it("Rückfall legacyGeozoneChecks = Einzelfelder", () => {
    assert.equal(aggregate(legacyGeozoneChecks({ hasRestrictions: true, restrictionVerdict: "nogo", restrictionStatus: "approved" }, "planning")).verdict, "nogo");
    assert.equal(aggregate(legacyGeozoneChecks({ hasRestrictions: true }, "planning")).verdict, "caution");
    assert.equal(aggregate(legacyGeozoneChecks({ hasRestrictions: false }, "planning")).verdict, "go");
  });
});

describe("coverageChecks / notamChecks / crossCheck / compliance", () => {
  const label = (iso: string) => ({ DE: "Deutschland", AT: "Österreich" } as Record<string, string>)[iso] ?? iso;

  it("missing/error/unsupported/partial → unknown; ok ohne Stand → nichts; stale → CAUTION mit Datenalter (B5)", () => {
    const now = Date.UTC(2026, 10, 3);
    const res = coverageChecks({
      context: "planning",
      sources: [
        { iso: "DE", status: "partial", note: "Wohngrundstücke offline nicht gespeichert – nicht geprüft" },
        { iso: "AT", status: "stale", fetchedAt: Date.UTC(2026, 10, 1) },
        { iso: "CZ", status: "missing" },
        { iso: "PL", status: "ok" },
      ],
      countryLabel: label,
      now,
    });
    assert.deepEqual(res.map((x) => [x.id, x.severity]), [
      ["coverage:DE:partial", "unknown"],
      ["coverage:AT:stale", "caution"],
      ["coverage:CZ:missing", "unknown"],
    ]);
    assert.match(res[0].title, /Deutschland unvollständig: Wohngrundstücke/);
    assert.deepEqual(res[1].dataAge, { fetchedAt: "2026-11-01T00:00:00.000Z", stale: true, ageMs: 2 * 86_400_000 });
    assert.match(res[1].title, /Österreich nicht aktuell \(Stand: vor 48 h|Österreich nicht aktuell \(Stand: vor 2 Tagen/);
    assert.equal(aggregate(res).verdict, "caution");
  });

  it("veraltete Daten allein ergeben CAUTION; aktuelle Daten nur Info „Stand: vor X h“", () => {
    const now = Date.UTC(2026, 10, 15, 12);
    const stale = coverageChecks({
      context: "precheck",
      sources: [{ iso: "AT", status: "stale", fetchedAt: now - 30 * 3_600_000 }],
      countryLabel: label,
      now,
    });
    assert.equal(stale[0].severity, "caution");
    assert.equal(aggregate(stale).verdict, "caution");
    const fresh = coverageChecks({
      context: "precheck",
      sources: [{ iso: "AT", status: "ok", fetchedAt: now - 5 * 3_600_000 }],
      countryLabel: label,
      now,
    });
    assert.deepEqual(fresh.map((x) => [x.id, x.severity]), [["coverage:AT:age", "info"]]);
    assert.match(fresh[0].title, /^Geozonen-Daten Österreich: Stand: vor 5 h \(/);
    assert.deepEqual(fresh[0].dataAge, { fetchedAt: new Date(now - 5 * 3_600_000).toISOString(), stale: false, ageMs: 5 * 3_600_000 });
    assert.equal(aggregate(fresh).verdict, "go");
  });

  it("formatDataAgeDe / formatCoverageDataAges", () => {
    assert.equal(formatDataAgeDe(0), "vor 1 Min.");
    assert.equal(formatDataAgeDe(25 * 60_000), "vor 25 Min.");
    assert.equal(formatDataAgeDe(3 * 3_600_000), "vor 3 h");
    assert.equal(formatDataAgeDe(47 * 3_600_000), "vor 47 h");
    assert.equal(formatDataAgeDe(30 * 86_400_000), "vor 30 Tagen");
    const now = Date.UTC(2026, 10, 15, 12);
    const line = formatCoverageDataAges(
      [
        { iso: "AT", status: "ok", fetchedAt: now - 3 * 3_600_000 },
        { iso: "DE", status: "stale", fetchedAt: now - 30 * 86_400_000 },
        { iso: "CZ", status: "missing" },
        { iso: "PL", status: "ok" },
      ],
      label,
      now,
    );
    assert.match(line, /^Österreich: Stand: vor 3 h \(\d\d\.\d\d\.2026\) · Deutschland: Stand: vor 30 Tagen \(\d\d\.\d\d\.2026\) – veraltet$/);
  });

  it("manuell geklärtes Land und Abfragefehler", () => {
    assert.deepEqual(coverageChecks({ context: "planning", sources: [{ iso: "HU", status: "unsupported" }], resolvedIsos: ["HU"] }), []);
    const failed = coverageChecks({ context: "precheck", sources: [], queryFailed: true, primaryIso: "DE", countryLabel: label });
    assert.equal(failed[0].severity, "unknown");
    assert.match(failed[0].title, /Deutschland nicht verfügbar/);
    assert.deepEqual(coverageChecks({ context: "planning", sources: [], queryFailed: true, primaryIso: "DE", resolvedIsos: ["DE"] }), []);
  });

  it("NOTAM: Fehlschlag → unknown, Anzahl → info, nicht abgefragt → nichts", () => {
    const failed = notamChecks({ context: "planning", failed: true, count: null });
    assert.equal(failed[0].severity, "unknown");
    assert.equal(failed[0].title, NOTAM_STATUS_UNKNOWN_TEXT);
    assert.equal(notamChecks({ context: "planning", failed: false, count: 3 })[0].severity, "info");
    assert.deepEqual(notamChecks({ context: "planning", failed: false, count: null }), []);
  });

  it("Gegenprüfung blocking → caution; Compliance nur Info", () => {
    assert.equal(officialMapCrossCheckChecks({ blocking: true, note: "X" }, "planning")[0].severity, "caution");
    assert.deepEqual(officialMapCrossCheckChecks({ blocking: false }, "planning"), []);
    assert.equal(complianceChecks({ alphaTangoMissingAcknowledged: true }, "planning")[0].severity, "info");
  });
});

// Neutrales Wetter (wie die Tests in planningRestrictionVerdict).
const LIMITS = { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: -10, maxTemp: 40, minCloudCeiling: 0, minVisibility: 0 };
function weather(over: Record<string, number> = {}) {
  return {
    latitude: 52.52,
    longitude: 13.4,
    calculationTime: "2026-06-15T10:00:00Z",
    forecasts: [{
      timestamp: "2026-06-15T10:00:00Z",
      temperature: 20, humidity: 50, windSpeed: 2, windGust: 3, windDirection: 0,
      windAtAltitude: [], temperatureAtAltitude: [{ height: 2, value: 20 }],
      humidityAtAltitude: [{ height: 2, value: 50 }], cloudCoverAtAltitude: [],
      rain: 0, snow: 0, cloudCover: 10, pressure: 1013,
      ...over,
    }],
  } as any;
}

describe("weatherChecks / nightChecks (Adapter, Schwellen unverändert)", () => {
  it("gleiche Warnungen wie assessWeather (ohne Einschränkungs-/Nachtteil)", () => {
    for (const over of [{}, { windSpeed: 9 }, { windSpeed: 11 }, { windGust: 13 }, { rain: 1 }, { temperature: -12 }, { temperature: -1, humidity: 90 }]) {
      const w = weather(over);
      const ref = assessWeather(w, LIMITS, false, undefined, 6.5, 100);
      const res = weatherChecks({ context: "planning", weather: w, limits: LIMITS, kpIndex: 6.5, maxAltitude: 100 });
      const nonInfo = res.filter((x) => x.severity !== "info");
      assert.deepEqual(nonInfo.map((x) => x.title), ref.warnings.map((x) => x.message), JSON.stringify(over));
      assert.equal(aggregate(res).verdict, ref.status, JSON.stringify(over));
      assert.equal(aggregate(res).requiresConfirmation, ref.requiresConfirmation, JSON.stringify(over));
    }
  });

  it("Gewitter am Flugplatz (METAR) → nogo wie bisher", () => {
    const metar: any = { name: "Test", icao: "EDDT", distanceKm: 5, hasThunderstorm: true, phenomenaText: "TS" };
    const res = weatherChecks({ context: "precheck", weather: weather(), limits: LIMITS, airportMetar: metar });
    assert.equal(aggregate(res).verdict, "nogo");
  });

  it("ohne Wetterdaten → unknown (CAUTION)", () => {
    const res = weatherChecks({ context: "planning", weather: null, limits: LIMITS, maxAltitude: 100 });
    assert.equal(res[0].title, WEATHER_UNKNOWN_TEXT);
    assert.equal(aggregate(res).verdict, "caution");
  });

  it("Nacht: DE Blinklicht → caution, NL/FR Verbot → nogo, Land aus dem Standort", () => {
    const night = new Date("2026-06-15T23:30:00Z");
    assert.equal(aggregate(nightChecks({ context: "planning", at: night, latitude: 52.52, longitude: 13.4 })).verdict, "caution");
    assert.equal(aggregate(nightChecks({ context: "planning", at: night, latitude: 52.37, longitude: 4.9 })).verdict, "nogo");
    // Falscher countryIso-Rückfall wird ignoriert, wenn der Standort erkannt wird.
    assert.equal(aggregate(nightChecks({ context: "planning", at: night, latitude: 48.85, longitude: 2.35, countryIso: "DE" })).verdict, "nogo");
    const day = new Date("2026-06-15T10:00:00Z");
    assert.deepEqual(nightChecks({ context: "planning", at: day, latitude: 48.85, longitude: 2.35 }), []);
  });
});

describe("Konsistenz: gleiche Eingaben → gleiches Urteil in Planung und Pre-Check", () => {
  const DAY = new Date("2026-06-15T10:00:00Z");
  const NIGHT = new Date("2026-06-15T23:30:00Z");

  function bothContexts(zones: any[], opts: { coverage?: any[]; notamFailed?: boolean; weather?: any; at?: Date; planned?: Date; now?: Date } = {}) {
    const run = (context: "planning" | "precheck") => {
      const timeContext = context === "planning"
        ? { kind: "planned" as const, planned: opts.planned ?? DAY, now: opts.now ?? DAY }
        : { kind: "precheck" as const, planned: opts.planned ?? DAY, now: opts.now ?? DAY };
      const z = evaluateZones({ context, timeContext, zones, isCoveredByAV: () => false });
      const stored = [
        ...z.checks,
        ...coverageChecks({ context, sources: opts.coverage ?? [{ iso: "DE", status: "ok" }] }),
        ...notamChecks({ context, failed: !!opts.notamFailed, count: opts.notamFailed ? null : 0 }),
      ];
      const input: FlightEvaluationInput = {
        context,
        at: opts.at ?? DAY,
        latitude: 52.52,
        longitude: 13.4,
        weather: opts.weather === undefined ? weather() : opts.weather,
        limits: LIMITS,
        maxAltitude: 100,
        stored,
      };
      return evaluateFlight(input).verdict;
    };
    return { planning: run("planning"), precheck: run("precheck") };
  }

  const cases: Array<[string, any[], Parameters<typeof bothContexts>[1], "go" | "caution" | "nogo"]> = [
    ["alles frei", [], {}, "go"],
    ["Flugverbot", [PROHIBITED], {}, "nogo"],
    ["Genehmigungspflicht", [REQ_AUTH], {}, "caution"],
    ["Info-Zone", [INFO], {}, "go"],
    ["Abdeckung fehlt", [], { coverage: [{ iso: "DE", status: "missing" }] }, "caution"],
    ["NOTAM unbekannt", [], { notamFailed: true }, "caution"],
    ["Starkwind", [], { weather: weather({ windSpeed: 11 }) }, "caution"],
    ["ohne Wetter", [], { weather: null }, "caution"],
    ["Nacht DE", [], { at: NIGHT }, "caution"],
  ];
  for (const [name, zones, opts, verdict] of cases) {
    it(name, () => {
      const v = bothContexts(zones, opts);
      assert.equal(v.planning, verdict);
      assert.equal(v.precheck, verdict);
    });
  }

  it("dokumentierter Unterschied: Zone nur JETZT aktiv zählt im Pre-Check, nicht in der Planung", () => {
    const now = new Date("2026-06-15T10:00:00Z");
    const planned = new Date("2026-06-20T10:00:00Z");
    const temporary = {
      ...PROHIBITED,
      validStartTs: Date.parse("2026-06-15T08:00:00Z"),
      validEndTs: Date.parse("2026-06-15T12:00:00Z"),
    };
    const v = bothContexts([temporary], { now, planned });
    assert.equal(v.planning, "go");
    assert.equal(v.precheck, "nogo");
  });

  it("storedChecksFor: gespeicherte Befunde des Kontexts haben Vorrang vor Einzelfeldern", () => {
    const cls = classifyPlanningZones([PROHIBITED], { isCoveredByAV: () => false });
    const pre = geozoneChecks({ context: "precheck", classes: [cls], hasRestrictions: true });
    // Einzelfelder sagen "frei" – die gespeicherten Pre-Check-Befunde gewinnen.
    assert.equal(aggregate(storedChecksFor({ checkResults: pre, hasRestrictions: false }, "precheck")).verdict, "nogo");
    // Planungs-Kontext hat keine eigenen Befunde → Rückfall auf Einzelfelder.
    assert.equal(aggregate(storedChecksFor({ checkResults: pre, hasRestrictions: false }, "planning")).verdict, "go");
    assert.equal(aggregate(storedChecksFor({ notamStatusUnknown: true }, "planning")).verdict, "caution");
  });
});
