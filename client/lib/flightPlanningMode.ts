export type FlightPlanningMode = "planning" | "preflight";

let currentMode: FlightPlanningMode = "planning";

export function setFlightPlanningMode(mode: FlightPlanningMode) {
  currentMode = mode;
}

export function getFlightPlanningMode(): FlightPlanningMode {
  return currentMode;
}

export function consumeFlightPlanningMode(): FlightPlanningMode {
  const m = currentMode;
  currentMode = "planning";
  return m;
}
