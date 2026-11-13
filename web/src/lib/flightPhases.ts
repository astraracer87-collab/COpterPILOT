import {
  ACTIVE_PHASES,
  type DebriefingData,
  type DroneSummary,
  type FlightSession,
  type SessionPhase,
} from "./flightTypes";

export const EXECUTION_PHASE_ORDER: SessionPhase[] = [
  "preflight",
  "hover",
  "monitoring",
  "postlanding",
  "debriefing",
  "completed",
];

export function nextExecutionPhase(current: SessionPhase): SessionPhase | null {
  const i = EXECUTION_PHASE_ORDER.indexOf(current);
  if (i < 0 || i >= EXECUTION_PHASE_ORDER.length - 1) return null;
  return EXECUTION_PHASE_ORDER[i + 1];
}

export function isResumableSession(
  session: Pick<FlightSession, "currentPhase">,
): boolean {
  return ACTIVE_PHASES.includes(session.currentPhase as SessionPhase);
}

export function computeFlightDurationMinutes(
  takeoffISO?: string | null,
  landingISO?: string | null,
): number | undefined {
  if (!takeoffISO || !landingISO) return undefined;
  const t = Date.parse(takeoffISO);
  const l = Date.parse(landingISO);
  if (isNaN(t) || isNaN(l)) return undefined;
  return Math.max(0, Math.round((l - t) / 60000));
}

export type LogbookPayload = ReturnType<typeof buildLogbookPayload>;

export type ApiCaller = <T = unknown>(
  method: string,
  path: string,
  body?: unknown,
) => Promise<T>;

/**
 * Performs the two side effects that finish a flight session:
 *   1. POST /api/logbook with the full payload
 *   2. PUT  /api/sessions/:id  to mark the session as completed
 * Extracted from Flight.tsx so it can be exercised by tests without
 * mounting the React tree.
 */
export async function completeFlightSession(
  session: FlightSession,
  drone: Pick<DroneSummary, "id" | "name" | "classMark">,
  debriefing: DebriefingData,
  api: ApiCaller,
): Promise<LogbookPayload> {
  const payload = buildLogbookPayload(session, drone, debriefing);
  await api("POST", "/api/logbook", payload);
  await api("PUT", `/api/sessions/${session.id}`, {
    currentPhase: "completed",
    debriefing,
  });
  return payload;
}

export function buildLogbookPayload(
  session: FlightSession,
  drone: Pick<DroneSummary, "id" | "name" | "classMark">,
  debriefing: DebriefingData,
) {
  const flightDate =
    session.planning?.plannedDate ||
    (session.hoverCheck?.takeoffTime
      ? new Date(session.hoverCheck.takeoffTime).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10));
  const weatherConditions =
    session.preflight?.actualWeather ||
    session.planning?.forecastWeather ||
    null;
  return {
    sessionId: session.id,
    droneId: session.droneId,
    droneName: drone.name,
    droneClass: drone.classMark,
    flightDate,
    locationName: session.locationName,
    latitude: session.latitude,
    longitude: session.longitude,
    takeoffTime: session.hoverCheck?.takeoffTime || null,
    landingTime:
      debriefing.landingTime || session.hoverCheck?.landingTime || null,
    flightDurationMinutes: debriefing.flightDurationMinutes ?? null,
    maxAltitude: session.planning?.maxAltitude ?? null,
    weatherConditions,
    incidentOccurred: debriefing.incidentOccurred,
    incidentDescription: debriefing.incidentDescription || null,
    maintenanceRequired: debriefing.maintenanceRequired,
    maintenanceNotes: debriefing.maintenanceNotes || null,
    notes: debriefing.generalNotes || null,
    planning: session.planning,
    preflight: session.preflight,
    hoverCheck: session.hoverCheck,
    postLanding: session.postLanding,
    debriefing,
    hasRestrictions: session.hasRestrictions,
    restrictionNotes: session.restrictionNotes,
    status: session.status,
  };
}
