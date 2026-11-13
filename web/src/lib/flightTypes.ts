export type SessionPhase =
  | "planning"
  | "preflight"
  | "hover"
  | "monitoring"
  | "postlanding"
  | "debriefing"
  | "completed";

export type WeatherSnapshot = {
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
  kpIndex?: number;
};

export type PlanningData = {
  plannedDate: string;
  plannedTime: string;
  flightPurpose?: string;
  maxAltitude?: number;
  maxDistance?: number;
  estimatedDuration?: number;
  routeDescription?: string;
  forecastWeather?: WeatherSnapshot;
  checklistCompleted: string[];
  checklistPresented?: string[];
  isFpvFlight?: boolean;
};

export type PreflightData = {
  actualWeather?: WeatherSnapshot;
  checklistCompleted: string[];
  checklistPresented?: string[];
  equipmentNotes?: string;
  completedAt?: string;
};

export type HoverCheckData = {
  checklistCompleted?: string[];
  controlsOk?: boolean;
  signalOk?: boolean;
  hoverStable?: boolean;
  takeoffTime?: string;
  landingTime?: string;
  skippedFlightCheck?: boolean;
  skipReason?: string;
};

export type PostLandingData = {
  checklistCompleted: string[];
  uasPoweredOff: boolean;
  controllerPoweredOff: boolean;
  damageChecked: boolean;
};

export type DebriefingData = {
  flightDurationMinutes?: number;
  takeoffTime?: string;
  landingTime?: string;
  incidentOccurred: boolean;
  incidentDescription?: string;
  maintenanceRequired: boolean;
  maintenanceNotes?: string;
  generalNotes?: string;
  batteryUsedPercent?: number;
  checklistCompleted?: string[];
};

export type FlightSession = {
  id: string;
  droneId: string;
  currentPhase: SessionPhase;
  latitude: number;
  longitude: number;
  locationName: string | null;
  countryIso: string | null;
  hasRestrictions: boolean;
  restrictionNotes: string | null;
  status: string;
  planning?: PlanningData;
  preflight?: PreflightData;
  hoverCheck?: HoverCheckData;
  postLanding?: PostLandingData;
  debriefing?: DebriefingData;
  createdAt: string;
  updatedAt: string;
};

export type DroneSummary = {
  id: string;
  name: string;
  classMark: string;
  manufacturer: string | null;
  model: string | null;
  limits: {
    maxWind: number;
    maxGusts: number;
    maxRain: number;
    minTemp: number;
    minCloudCeiling: number;
    minVisibility: number;
  };
};

export const PHASE_LABELS: Record<SessionPhase, string> = {
  planning: "Planung",
  preflight: "Pre-Flight",
  hover: "Hover-Check",
  monitoring: "Im Flug",
  postlanding: "Nach Landung",
  debriefing: "Debriefing",
  completed: "Abgeschlossen",
};

export const ACTIVE_PHASES: SessionPhase[] = [
  "preflight",
  "hover",
  "monitoring",
  "postlanding",
  "debriefing",
];
