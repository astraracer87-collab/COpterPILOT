import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ed269IsActiveAt,
  ed269ScheduleFromProps,
  ed269InactiveInfoText,
  isZoneActiveAt,
  isZoneActiveInContext,
  zoneActivityAt,
  zoneEndedLongAgo,
  zoneTimeReferences,
  type ZoneActivityInput,
} from "../../../shared/ed269Restriction";
import { calculateSolarTimes } from "../../../shared/solar";
import { parseEd269ToGeozoneInfo } from "../ed269";
import { computeGeozoneTabSeverity, isGeozoneActiveForRadar } from "../geozoneSeverity";
import { czZoneFromStored, deZoneFromStored } from "../geozoneTiles/tileZones";
import { parseLuWmsToGeozoneInfo } from "../geozoneQueries";

// Gekürzte Fixture nach dem Dronespace-Feed (MTMA LOXZ4): Winter- und
// Sommereintrag mit unterschiedlichen UTC-Zeiten (Mo–Do).
const LOXZ4 = {
  name: "MTMA LOXZ4",
  type: "COMMON",
  restriction: "REQ_AUTHORISATION",
  applicability: [
    {
      permanent: "NO",
      startDateTime: "2026-10-25T01:00:00Z",
      endDateTime: "2027-03-28T00:59:59Z",
      schedule: [{ day: ["MON", "TUE", "WED", "THU"], startTime: "07:00Z", endTime: "15:30Z" }],
    },
    {
      permanent: "NO",
      startDateTime: "2026-03-29T01:00:00Z",
      endDateTime: "2026-10-25T00:59:59Z",
      schedule: [{ day: ["MON", "TUE", "WED", "THU"], startTime: "06:00Z", endTime: "14:30Z" }],
    },
  ],
};

const at = (iso: string) => new Date(iso);

describe("ed269IsActiveAt – LOXZ4 (Schedule Mo–Do)", () => {
  it("Do 10:00Z aktiv", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-11-19T10:00:00Z")), true);
  });
  it("Sa 10:00Z inaktiv", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-11-21T10:00:00Z")), false);
  });
  it("Do 16:00Z inaktiv", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-11-19T16:00:00Z")), false);
  });
  it("Ende ist exklusiv (Do 15:30Z inaktiv, 15:29Z aktiv)", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-11-19T15:29:00Z")), true);
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-11-19T15:30:00Z")), false);
  });
});

describe("ed269IsActiveAt – Winter- vs. Sommereintrag", () => {
  it("Winter: Do 15:00Z aktiv, 06:30Z inaktiv", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-12-03T15:00:00Z")), true);
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-12-03T06:30:00Z")), false);
  });
  it("Sommer: Do 06:30Z aktiv, 15:00Z inaktiv", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-07-02T06:30:00Z")), true);
    assert.equal(ed269IsActiveAt(LOXZ4, at("2026-07-02T15:00:00Z")), false);
  });
  it("außerhalb beider Gültigkeitsfenster inaktiv", () => {
    assert.equal(ed269IsActiveAt(LOXZ4, at("2027-06-03T10:00:00Z")), false);
  });
});

describe("ed269IsActiveAt – Sonderfälle", () => {
  it("permanent YES ist immer aktiv", () => {
    const p = { applicability: [{ permanent: "YES", schedule: [{ day: ["MON"], startTime: "07:00Z", endTime: "08:00Z" }] }] };
    assert.equal(ed269IsActiveAt(p, at("2026-11-21T23:00:00Z")), true);
  });
  it("ohne applicability aktiv", () => {
    assert.equal(ed269IsActiveAt({ name: "CTR LOWW" }, at("2026-11-21T23:00:00Z")), true);
    assert.equal(ed269IsActiveAt({ applicability: [] }, at("2026-11-21T23:00:00Z")), true);
  });
  it("Fenster ohne Schedule: start ≤ date ≤ end, fehlende Grenze offen", () => {
    const p = { applicability: [{ permanent: "NO", startDateTime: "2026-12-01T00:00:00Z" }] };
    assert.equal(ed269IsActiveAt(p, at("2026-11-30T12:00:00Z")), false);
    assert.equal(ed269IsActiveAt(p, at("2030-01-01T00:00:00Z")), true);
  });
  it("ANY und HH:MM ohne Z", () => {
    const p = { applicability: [{ permanent: "NO", schedule: [{ day: ["ANY"], startTime: "06:00", endTime: "14:30" }] }] };
    assert.equal(ed269IsActiveAt(p, at("2026-11-21T10:00:00Z")), true);
    assert.equal(ed269IsActiveAt(p, at("2026-11-21T15:00:00Z")), false);
  });
  it("über Mitternacht: Wochentag bezieht sich auf den Beginn", () => {
    const p = { applicability: [{ permanent: "NO", schedule: [{ day: ["FRI"], startTime: "22:00Z", endTime: "04:00Z" }] }] };
    assert.equal(ed269IsActiveAt(p, at("2026-11-20T23:00:00Z")), true); // Fr 23:00
    assert.equal(ed269IsActiveAt(p, at("2026-11-21T03:00:00Z")), true); // Sa 03:00
    assert.equal(ed269IsActiveAt(p, at("2026-11-21T05:00:00Z")), false);
    assert.equal(ed269IsActiveAt(p, at("2026-11-20T03:00:00Z")), false); // Fr 03:00 (Do kein Tag)
  });
  it("Austro-Control-Platzhalter (MATZ bis 2100) gilt als dauerhaft aktiv", () => {
    const p = {
      name: "MATZ LOXZ",
      applicability: [{ permanent: "NO", startDateTime: "2030-01-01T00:00:00Z", endDateTime: "2100-12-31T23:59:59Z" }],
    };
    assert.equal(ed269IsActiveAt(p, at("2026-11-21T10:00:00Z")), true);
  });
});

describe("Schedule-Text und geparste Zonen", () => {
  it("formatiert Mo–Do mit UTC", () => {
    assert.deepEqual(ed269ScheduleFromProps(LOXZ4), ["Mo–Do · 07:00–15:30 UTC", "Mo–Do · 06:00–14:30 UTC"]);
  });
  it("parseEd269ToGeozoneInfo trägt die Aktivitätsinfo und zoneActivityAt wertet sie aus", () => {
    const ring = [[16.0, 48.0], [16.1, 48.0], [16.1, 48.1], [16.0, 48.0]];
    const [z] = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: LOXZ4 }],
      "AT",
      NOW.getTime(),
    );
    assert.ok(Array.isArray(z.ed269Applicability));
    assert.equal(zoneActivityAt(z, at("2026-11-19T10:00:00Z")), "active");
    assert.equal(zoneActivityAt(z, at("2026-11-21T10:00:00Z")), "inactive");
    assert.equal(
      ed269InactiveInfoText({ scheduleText: ["Mo–Do · 07:00–15:30 UTC"] }),
      "zeitweise aktiv – Mo–Do · 07:00–15:30 UTC (zur geplanten Zeit inaktiv)",
    );
  });
  it("Zonen ohne Aktivitätsinfo gelten als aktiv", () => {
    assert.equal(zoneActivityAt({}, at("2026-11-21T10:00:00Z")), "active");
    assert.equal(isZoneActiveAt({}, at("2026-11-21T10:00:00Z")), true);
  });
});

// ---------------------------------------------------------------------------
// zoneActivityAt: eine Prüfung für alle Zonen
// ---------------------------------------------------------------------------

const DAY = 86400000;
const NOW = at("2026-11-15T10:00:00Z");
const RING: [number, number][] = [[48.0, 16.0], [48.0, 16.1], [48.1, 16.1], [48.0, 16.0]];

describe("zoneActivityAt – hartes Gültigkeitsfenster (validStartTs/validEndTs)", () => {
  const tomorrow: ZoneActivityInput = { validStartTs: NOW.getTime() + DAY, validEndTs: NOW.getTime() + 2 * DAY };
  it("Zone nur mit Fenster ab morgen: jetzt inaktiv, morgen aktiv", () => {
    assert.equal(zoneActivityAt(tomorrow, NOW), "inactive");
    assert.equal(zoneActivityAt(tomorrow, new Date(NOW.getTime() + DAY + 3600000)), "active");
    assert.equal(zoneActivityAt(tomorrow, new Date(NOW.getTime() + 3 * DAY)), "inactive");
  });
  it("gestern abgelaufen: inaktiv; Ende inklusive", () => {
    const expired = { validStartTs: NOW.getTime() - 3 * DAY, validEndTs: NOW.getTime() - DAY };
    assert.equal(zoneActivityAt(expired, NOW), "inactive");
    assert.equal(zoneActivityAt(expired, new Date(NOW.getTime() - DAY)), "active");
  });
  it("nur Beginn bzw. nur Ende: offene Grenze", () => {
    assert.equal(zoneActivityAt({ validStartTs: NOW.getTime() - DAY, validEndTs: null }, NOW), "active");
    assert.equal(zoneActivityAt({ validStartTs: null, validEndTs: NOW.getTime() + DAY }, NOW), "active");
  });
  it("Fenster schlägt applicability: außerhalb des Fensters inaktiv trotz permanentem Eintrag", () => {
    const z = { ...tomorrow, ed269Applicability: [{ permanent: "YES" }] };
    assert.equal(zoneActivityAt(z, NOW), "inactive");
  });
  it("widersprüchlich/unlesbar -> unknown, zählt als aktiv", () => {
    const contradictory = { validStartTs: NOW.getTime() + DAY, validEndTs: NOW.getTime() - DAY };
    assert.equal(zoneActivityAt(contradictory, NOW), "unknown");
    assert.equal(isZoneActiveAt(contradictory, NOW), true);
    const badDate = { ed269Applicability: [{ permanent: "NO", startDateTime: "kaputt" }] };
    assert.equal(zoneActivityAt(badDate, NOW), "unknown");
    assert.equal(zoneActivityAt({}, new Date(NaN)), "unknown");
  });
  it("ein aktiver Eintrag gewinnt gegen einen unlesbaren", () => {
    const z = { ed269Applicability: [{ permanent: "NO", startDateTime: "kaputt" }, { permanent: "YES" }] };
    assert.equal(zoneActivityAt(z, NOW), "active");
  });
});

describe("zoneActivityAt – Zeitplan (schedule)", () => {
  const sched = { ed269Applicability: LOXZ4.applicability };
  it("LOXZ4: Do aktiv, Sa inaktiv", () => {
    assert.equal(zoneActivityAt(sched, at("2026-11-19T10:00:00Z")), "active");
    assert.equal(zoneActivityAt(sched, at("2026-11-21T10:00:00Z")), "inactive");
  });
});

describe("zoneActivityAt – Sonnenauf-/-untergang (SR/SS)", () => {
  const srss: ZoneActivityInput = {
    polygonGroups: [[RING]],
    ed269Applicability: [
      { permanent: "NO", schedule: [{ day: ["ANY"], startTime: "Sonnenaufgang", endTime: "Sonnenuntergang", startEvent: "SR", endEvent: "SS" }] },
    ],
  };
  const solar = calculateSolarTimes(48.033, 16.067, at("2026-11-15T12:00:00Z"));
  it("Sonnenzeiten berechenbar und am selben Tag (Regression: Winter lag auf dem Vortag)", () => {
    assert.ok(solar.sunrise && solar.sunset);
    assert.equal(solar.sunrise!.toISOString().slice(0, 10), "2026-11-15");
    assert.equal(solar.sunset!.toISOString().slice(0, 10), "2026-11-15");
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2026, m, 15, 12));
      const s = calculateSolarTimes(48, 16, d);
      assert.equal(s.sunrise!.getUTCDate(), 15, `Monat ${m + 1}: Sonnenaufgang am 15.`);
      assert.ok(s.sunrise!.getTime() < d.getTime() && d.getTime() < s.sunset!.getTime(), `Monat ${m + 1}: Mittag ist Tag`);
    }
  });
  it("Mittag aktiv, Nacht inaktiv, kurz vor/nach SR/SS", () => {
    assert.equal(zoneActivityAt(srss, at("2026-11-15T11:00:00Z")), "active");
    assert.equal(zoneActivityAt(srss, at("2026-11-15T22:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(srss, at("2026-11-15T02:00:00Z")), "inactive");
    assert.equal(zoneActivityAt(srss, new Date(solar.sunrise!.getTime() - 10 * 60000)), "inactive");
    assert.equal(zoneActivityAt(srss, new Date(solar.sunrise!.getTime() + 10 * 60000)), "active");
    assert.equal(zoneActivityAt(srss, new Date(solar.sunset!.getTime() - 10 * 60000)), "active");
    assert.equal(zoneActivityAt(srss, new Date(solar.sunset!.getTime() + 10 * 60000)), "inactive");
  });
  it("ohne Geometrie: konservativ ganztägig aktiv", () => {
    const noGeom = { ed269Applicability: srss.ed269Applicability };
    assert.equal(zoneActivityAt(noGeom, at("2026-11-15T22:00:00Z")), "active");
  });
  it("SS–SR (Nachtzone) über Mitternacht", () => {
    const night = { polygonGroups: [[RING]], ed269Applicability: [{ permanent: "NO", schedule: [{ day: ["ANY"], startEvent: "SS", endEvent: "SR" }] }] };
    assert.equal(zoneActivityAt(night, at("2026-11-15T22:00:00Z")), "active");
    assert.equal(zoneActivityAt(night, at("2026-11-15T11:00:00Z")), "inactive");
  });
});

describe("Zeitbezug je Kontext", () => {
  const planned = at("2026-11-21T10:00:00Z"); // Sa – LOXZ4 inaktiv
  const thursday = at("2026-11-19T10:00:00Z"); // Do – LOXZ4 aktiv
  const z = { ed269Applicability: LOXZ4.applicability };
  it("now / planned / precheck", () => {
    assert.deepEqual(zoneTimeReferences({ kind: "now", now: thursday }), [thursday]);
    assert.deepEqual(zoneTimeReferences({ kind: "planned", planned: null, now: thursday }), [thursday]);
    assert.deepEqual(zoneTimeReferences({ kind: "planned", planned, now: thursday }), [planned]);
    assert.deepEqual(zoneTimeReferences({ kind: "precheck", planned, now: thursday }), [thursday, planned]);
    assert.equal(isZoneActiveInContext(z, { kind: "planned", planned, now: thursday }), false);
    // Pre-Check: jetzt aktiv ODER geplant aktiv
    assert.equal(isZoneActiveInContext(z, { kind: "precheck", planned, now: thursday }), true);
    assert.equal(isZoneActiveInContext(z, { kind: "precheck", planned: thursday, now: planned }), true);
    assert.equal(isZoneActiveInContext(z, { kind: "precheck", planned, now: planned }), false);
  });
});

describe("Konsistenz: Karte, Liste, Radar-Reiter und Urteil antworten gleich", () => {
  const zones: (ZoneActivityInput & { layerLabel: string; name: string; details: string })[] = [
    { layerLabel: "T", name: "morgen", details: "", validStartTs: NOW.getTime() + DAY, validEndTs: NOW.getTime() + 2 * DAY },
    { layerLabel: "T", name: "abgelaufen", details: "", validStartTs: NOW.getTime() - 2 * DAY, validEndTs: NOW.getTime() - 3600000 },
    { layerLabel: "T", name: "Zeitplan", details: "", ed269Applicability: LOXZ4.applicability },
    { layerLabel: "T", name: "dauerhaft", details: "" },
    { layerLabel: "T", name: "SR/SS", details: "", polygonGroups: [[RING]], ed269Applicability: [{ permanent: "NO", schedule: [{ day: ["ANY"], startEvent: "SR", endEvent: "SS" }] }] },
  ];
  const times = [NOW, at("2026-11-19T10:00:00Z"), at("2026-11-21T22:00:00Z"), new Date(NOW.getTime() + DAY + 60000)];
  it("gleiches Ergebnis je Zone und Zeitpunkt", () => {
    for (const z of zones) {
      for (const t of times) {
        const truth = zoneActivityAt(z, t) !== "inactive";
        // Karte (TrafficMapView `ia`, MapPicker): Kontext now
        assert.equal(isZoneActiveInContext(z, { kind: "now", now: t }), truth, `${z.name} Karte`);
        // Planungsliste: Kontext planned
        assert.equal(isZoneActiveInContext(z, { kind: "planned", planned: t }), truth, `${z.name} Planung`);
        // Pre-Check mit identischem jetzt/geplant
        assert.equal(isZoneActiveInContext(z, { kind: "precheck", planned: t, now: t }), truth, `${z.name} Pre-Check`);
        // Radar-Reiter/Hervorhebung
        assert.equal(isGeozoneActiveForRadar(z, t), truth, `${z.name} Radar`);
        const sev = computeGeozoneTabSeverity([z], { isCoveredByAV: () => false, now: t.getTime() });
        assert.equal(sev, truth ? "orange" : "blue", `${z.name} Reiter`);
      }
    }
  });
});

describe("Alle strukturierten Pfade tragen das Zeitfenster", () => {
  it("DE dipul (Kachel/WFS): start_time/end_time", () => {
    const z = deZoneFromStored({
      id: "temporaere_betriebseinschraenkungen.1",
      geometry: { type: "Polygon", coordinates: [[[8, 50], [8.1, 50], [8.1, 50.1], [8, 50]]] },
      properties: { name: "Temp", start_time: "2026-11-16T08:00:00Z", end_time: "2026-11-16T12:00:00Z" },
    });
    assert.ok(z);
    assert.equal(z!.validStartTs, Date.parse("2026-11-16T08:00:00Z"));
    assert.equal(zoneActivityAt(z!, NOW), "inactive");
    assert.equal(zoneActivityAt(z!, at("2026-11-16T10:00:00Z")), "active");
  });
  it("CZ ED-318: limitedApplicability mit Zeitplan", () => {
    const z = czZoneFromStored({
      geometry: { type: "Polygon", coordinates: [[[14, 50], [14.1, 50], [14.1, 50.1], [14, 50.1], [14, 50]]], layer: { lower: 0, upper: 120, uom: "m" } },
      properties: {
        identifier: "LKR1", name: [{ lang: "cs", text: "Test" }], type: "REQ_AUTHORISATION",
        limitedApplicability: [{ startDateTime: "2026-11-01T00:00:00Z", endDateTime: "2026-12-31T00:00:00Z", schedule: [{ day: ["MON"], startTime: "08:00", endTime: "12:00" }] }],
      },
    }, NOW.getTime());
    assert.ok(z);
    assert.ok(Array.isArray(z!.ed269Applicability));
    assert.equal(zoneActivityAt(z!, at("2026-11-16T09:00:00Z")), "active"); // Mo
    assert.equal(zoneActivityAt(z!, at("2026-11-17T09:00:00Z")), "inactive"); // Di
  });
  it("LU WMS temporär: Fenster statt Textparse", () => {
    const [z] = parseLuWmsToGeozoneInfo([
      { "Zone Identifier": "EL-TSA1", "Start date and time": "16/11/2026 08:00", "End date and time": "16/11/2026 12:00", Activity: "INACTIVE" },
    ]);
    assert.ok(z.validStartTs != null && z.validEndTs != null);
    assert.equal(zoneActivityAt(z, NOW), "inactive");
    assert.equal(zoneActivityAt(z, new Date(z.validStartTs! + 3600000)), "active");
  });
});

describe("Speicher: nur lange abgelaufene Zonen verwerfen", () => {
  it("zoneEndedLongAgo", () => {
    const now = NOW.getTime();
    assert.equal(zoneEndedLongAgo({ validEndTs: now - 3600000 }, now), false);
    assert.equal(zoneEndedLongAgo({ validEndTs: now - 2 * DAY }, now), true);
    assert.equal(zoneEndedLongAgo({}, now), false);
    assert.equal(zoneEndedLongAgo({ ed269Applicability: [{ permanent: "NO", endDateTime: "2026-11-01T00:00:00Z" }] }, now), true);
    assert.equal(zoneEndedLongAgo({ ed269Applicability: [{ permanent: "YES", endDateTime: "2026-11-01T00:00:00Z" }] }, now), false);
  });
});
