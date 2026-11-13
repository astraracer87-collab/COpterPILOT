import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTION_PHASE_ORDER,
  buildLogbookPayload,
  completeFlightSession,
  computeFlightDurationMinutes,
  isResumableSession,
  nextExecutionPhase,
} from "../flightPhases";
import type {
  DebriefingData,
  DroneSummary,
  FlightSession,
  SessionPhase,
  WeatherSnapshot,
} from "../flightTypes";

const sampleWeather: WeatherSnapshot = {
  temperature: 18,
  windSpeed: 4,
  windGust: 7,
  rain: 0,
  cloudCover: 30,
  humidity: 60,
};

function makeSession(overrides: Partial<FlightSession> = {}): FlightSession {
  return {
    id: "sess-1",
    droneId: "drone-1",
    currentPhase: "preflight",
    latitude: 50.5,
    longitude: 9.0,
    locationName: "Modellflugplatz Nord",
    countryIso: "DE",
    hasRestrictions: false,
    restrictionNotes: null,
    status: "go",
    planning: {
      plannedDate: "2026-04-18",
      plannedTime: "12:00",
      maxAltitude: 100,
      checklistCompleted: [],
      forecastWeather: { ...sampleWeather, windSpeed: 3 },
    },
    preflight: {
      actualWeather: sampleWeather,
      checklistCompleted: ["a"],
      completedAt: "2026-04-18T11:55:00.000Z",
    },
    hoverCheck: {
      takeoffTime: "2026-04-18T12:00:00.000Z",
      landingTime: "2026-04-18T12:18:30.000Z",
      hoverStable: true,
      checklistCompleted: ["h1"],
    },
    postLanding: {
      checklistCompleted: ["p1"],
      uasPoweredOff: true,
      controllerPoweredOff: true,
      damageChecked: true,
    },
    createdAt: "2026-04-18T11:00:00.000Z",
    updatedAt: "2026-04-18T12:18:30.000Z",
    ...overrides,
  };
}

const sampleDrone: Pick<DroneSummary, "id" | "name" | "classMark"> = {
  id: "drone-1",
  name: "Mavic 3",
  classMark: "C1",
};

describe("EXECUTION_PHASE_ORDER", () => {
  it("matches the expected execution sequence", () => {
    assert.deepEqual(EXECUTION_PHASE_ORDER, [
      "preflight",
      "hover",
      "monitoring",
      "postlanding",
      "debriefing",
      "completed",
    ]);
  });
});

describe("nextExecutionPhase", () => {
  it("advances through the full phase chain", () => {
    let phase: SessionPhase | null = "preflight";
    const visited: SessionPhase[] = [phase];
    while (phase) {
      const next = nextExecutionPhase(phase);
      if (!next) break;
      visited.push(next);
      phase = next;
    }
    assert.deepEqual(visited, [
      "preflight",
      "hover",
      "monitoring",
      "postlanding",
      "debriefing",
      "completed",
    ]);
  });

  it("returns null after the terminal phase", () => {
    assert.equal(nextExecutionPhase("completed"), null);
  });

  it("returns null for non-execution phases", () => {
    assert.equal(nextExecutionPhase("planning"), null);
  });
});

describe("isResumableSession (Resume-Banner)", () => {
  const activePhases: SessionPhase[] = [
    "preflight",
    "hover",
    "monitoring",
    "postlanding",
    "debriefing",
  ];
  const inactivePhases: SessionPhase[] = ["planning", "completed"];

  for (const phase of activePhases) {
    it(`shows banner for active phase "${phase}"`, () => {
      assert.equal(isResumableSession({ currentPhase: phase }), true);
    });
  }

  for (const phase of inactivePhases) {
    it(`hides banner for inactive phase "${phase}"`, () => {
      assert.equal(isResumableSession({ currentPhase: phase }), false);
    });
  }
});

describe("computeFlightDurationMinutes", () => {
  it("returns rounded minutes between takeoff and landing", () => {
    assert.equal(
      computeFlightDurationMinutes(
        "2026-04-18T12:00:00.000Z",
        "2026-04-18T12:18:30.000Z",
      ),
      19,
    );
  });

  it("returns 0 when landing equals takeoff", () => {
    assert.equal(
      computeFlightDurationMinutes(
        "2026-04-18T12:00:00.000Z",
        "2026-04-18T12:00:00.000Z",
      ),
      0,
    );
  });

  it("clamps negative durations to 0", () => {
    assert.equal(
      computeFlightDurationMinutes(
        "2026-04-18T12:10:00.000Z",
        "2026-04-18T12:00:00.000Z",
      ),
      0,
    );
  });

  it("returns undefined when timestamps are missing or invalid", () => {
    assert.equal(computeFlightDurationMinutes(undefined, undefined), undefined);
    assert.equal(
      computeFlightDurationMinutes("2026-04-18T12:00:00.000Z", null),
      undefined,
    );
    assert.equal(
      computeFlightDurationMinutes("not-a-date", "2026-04-18T12:00:00.000Z"),
      undefined,
    );
  });
});

describe("buildLogbookPayload", () => {
  const debriefing: DebriefingData = {
    flightDurationMinutes: 19,
    takeoffTime: "2026-04-18T12:00:00.000Z",
    landingTime: "2026-04-18T12:18:30.000Z",
    incidentOccurred: false,
    maintenanceRequired: false,
    generalNotes: "Glatter Flug",
    batteryUsedPercent: 22,
  };

  it("includes correct duration and weather snapshot", () => {
    const payload = buildLogbookPayload(makeSession(), sampleDrone, debriefing);
    assert.equal(payload.flightDurationMinutes, 19);
    assert.deepEqual(payload.weatherConditions, sampleWeather);
    assert.equal(payload.takeoffTime, "2026-04-18T12:00:00.000Z");
    assert.equal(payload.landingTime, "2026-04-18T12:18:30.000Z");
    assert.equal(payload.flightDate, "2026-04-18");
    assert.equal(payload.droneName, "Mavic 3");
    assert.equal(payload.droneClass, "C1");
    assert.equal(payload.notes, "Glatter Flug");
    assert.equal(payload.sessionId, "sess-1");
    assert.deepEqual(payload.debriefing, debriefing);
  });

  it("falls back to forecast weather when actual is missing", () => {
    const session = makeSession({
      preflight: undefined,
    });
    const payload = buildLogbookPayload(session, sampleDrone, debriefing);
    assert.deepEqual(payload.weatherConditions, {
      ...sampleWeather,
      windSpeed: 3,
    });
  });

  it("uses takeoff date when no planning date is set", () => {
    const session = makeSession({ planning: undefined });
    const payload = buildLogbookPayload(session, sampleDrone, debriefing);
    assert.equal(payload.flightDate, "2026-04-18");
  });

  it("propagates incident/maintenance fields and clears empty strings", () => {
    const debriefingWithIssues: DebriefingData = {
      ...debriefing,
      incidentOccurred: true,
      incidentDescription: "Vogelzug",
      maintenanceRequired: true,
      maintenanceNotes: "Propeller prüfen",
      generalNotes: "",
    };
    const payload = buildLogbookPayload(
      makeSession(),
      sampleDrone,
      debriefingWithIssues,
    );
    assert.equal(payload.incidentOccurred, true);
    assert.equal(payload.incidentDescription, "Vogelzug");
    assert.equal(payload.maintenanceRequired, true);
    assert.equal(payload.maintenanceNotes, "Propeller prüfen");
    assert.equal(payload.notes, null);
  });
});

describe("completeFlightSession (integration)", () => {
  const debriefing: DebriefingData = {
    flightDurationMinutes: 19,
    takeoffTime: "2026-04-18T12:00:00.000Z",
    landingTime: "2026-04-18T12:18:30.000Z",
    incidentOccurred: false,
    maintenanceRequired: false,
    generalNotes: "Glatter Flug",
  };

  it("posts the logbook entry and marks the session as completed", async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const fakeApi = async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      return { ok: true };
    };

    const session = makeSession();
    const payload = await completeFlightSession(
      session,
      sampleDrone,
      debriefing,
      fakeApi,
    );

    assert.equal(calls.length, 2);

    const post = calls[0];
    assert.equal(post.method, "POST");
    assert.equal(post.path, "/api/logbook");
    const body = post.body as Record<string, unknown>;
    assert.equal(body.sessionId, session.id);
    assert.equal(body.flightDurationMinutes, 19);
    assert.deepEqual(body.weatherConditions, sampleWeather);
    assert.equal(body.droneName, "Mavic 3");
    assert.deepEqual(payload, body);

    const put = calls[1];
    assert.equal(put.method, "PUT");
    assert.equal(put.path, `/api/sessions/${session.id}`);
    assert.deepEqual(put.body, {
      currentPhase: "completed",
      debriefing,
    });
  });

  it("does not call the session update if the logbook POST fails", async () => {
    const calls: string[] = [];
    const fakeApi = async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (path === "/api/logbook") throw new Error("boom");
      return {};
    };

    await assert.rejects(
      () =>
        completeFlightSession(
          makeSession(),
          sampleDrone,
          debriefing,
          fakeApi,
        ),
      /boom/,
    );
    assert.deepEqual(calls, ["POST /api/logbook"]);
  });
});

describe("execution flow integration", () => {
  it("reaches the logbook entry after stepping through every phase", () => {
    let session = makeSession({ currentPhase: "preflight" });
    const steps: SessionPhase[] = [session.currentPhase];

    while (session.currentPhase !== "completed") {
      const next = nextExecutionPhase(session.currentPhase);
      if (!next) break;
      session = { ...session, currentPhase: next };
      steps.push(next);

      // Resume banner must be visible during every active phase
      // and disappear after the flight is completed.
      const expectedBanner = next !== "completed";
      assert.equal(isResumableSession(session), expectedBanner);
    }

    assert.deepEqual(steps, [
      "preflight",
      "hover",
      "monitoring",
      "postlanding",
      "debriefing",
      "completed",
    ]);

    const debriefing: DebriefingData = {
      flightDurationMinutes: computeFlightDurationMinutes(
        session.hoverCheck?.takeoffTime,
        session.hoverCheck?.landingTime,
      ),
      takeoffTime: session.hoverCheck?.takeoffTime,
      landingTime: session.hoverCheck?.landingTime,
      incidentOccurred: false,
      maintenanceRequired: false,
    };
    const payload = buildLogbookPayload(session, sampleDrone, debriefing);
    assert.equal(payload.flightDurationMinutes, 19);
    assert.deepEqual(payload.weatherConditions, sampleWeather);
    assert.equal(payload.sessionId, session.id);
  });
});
