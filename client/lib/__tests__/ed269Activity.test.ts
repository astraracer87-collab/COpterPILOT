import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ed269IsActiveAt,
  ed269ScheduleFromProps,
  ed269InactiveInfoText,
  geozoneIsActiveAt,
} from "../../../shared/ed269Restriction";
import { parseEd269ToGeozoneInfo } from "../ed269";

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
  it("parseEd269ToGeozoneInfo trägt die Aktivitätsinfo und geozoneIsActiveAt wertet sie aus", () => {
    const ring = [[16.0, 48.0], [16.1, 48.0], [16.1, 48.1], [16.0, 48.0]];
    const [z] = parseEd269ToGeozoneInfo(
      [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: LOXZ4 }],
      "AT",
    );
    assert.ok(Array.isArray(z.ed269Applicability));
    assert.equal(geozoneIsActiveAt(z, at("2026-11-19T10:00:00Z")), true);
    assert.equal(geozoneIsActiveAt(z, at("2026-11-21T10:00:00Z")), false);
    assert.equal(
      ed269InactiveInfoText({ scheduleText: ["Mo–Do · 07:00–15:30 UTC"] }),
      "zeitweise aktiv – Mo–Do · 07:00–15:30 UTC (zur geplanten Zeit inaktiv)",
    );
  });
  it("Zonen ohne Aktivitätsinfo gelten als aktiv", () => {
    assert.equal(geozoneIsActiveAt({}, at("2026-11-21T10:00:00Z")), true);
  });
});
