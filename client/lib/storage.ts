import AsyncStorage from "@react-native-async-storage/async-storage";

const BRIEFINGS_KEY = "@preflight/briefings";
const SETTINGS_KEY = "@preflight/settings";
const DRONES_KEY = "@preflight/drones";
const SELECTED_DRONE_KEY = "@preflight/selected_drone";
const FLIGHT_SESSIONS_KEY = "@preflight/flight_sessions";
const LOGBOOK_KEY = "@preflight/logbook";
const DRONE_HISTORY_KEY = "@preflight/drone_history";
const SYNC_STATUS_KEY = "@preflight/sync_status";
const PILOT_PROFILE_KEY = "@preflight/pilot_profile";

async function getLocalData<T>(key: string): Promise<T | null> {
  try {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function saveLocalData<T>(key: string, data: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(data));
}

export interface AssessmentReason {
  type: "go" | "caution" | "nogo";
  message: string;
}

export interface WindAtAltitudeSnapshot {
  height: number;
  speed: number;
  gust?: number;
  direction: number;
}

export interface ValueAtAltitudeSnapshot {
  height: number;
  value: number;
}

export interface WeatherSnapshot {
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
  kpIndex?: number;
  windAtAltitude?: WindAtAltitudeSnapshot[];
  temperatureAtAltitude?: ValueAtAltitudeSnapshot[];
}

export interface Briefing {
  id: string;
  createdAt: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  countryIso?: string;
  mapUrl?: string;
  status: "go" | "caution" | "nogo";
  hasRestrictions: boolean;
  restrictionNotes?: string;
  weatherData?: WeatherSnapshot;
  reasons?: AssessmentReason[];
  completed: boolean;
  droneId?: string;
}

export interface WeatherLimits {
  maxWind: number;
  maxGusts: number;
  maxRain: number;
  minTemp: number;
  minCloudCeiling: number;
  minVisibility: number;
}

export type DroneClass = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "legacy";
export type DroneType = "selfie" | "standard" | "fpv_only" | "hybrid_fpv";
export type OpenCategory = "A1" | "A2" | "A3";

export interface DroneCompliance {
  operatorRegistered: boolean;
  eIdLabeledOnDrone: boolean;
  insuranceActive: boolean;
  competencyA1A3: boolean;
  certificateA2: boolean;
  remoteIdConfigured: boolean;
  spotterConfirmed?: boolean;
}

export interface PilotCompliance {
  insuranceActive: boolean;
  operatorRegistered: boolean;
  competencyA1A3: boolean;
  certificateA2: boolean;
}

export interface DroneProfile {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  classMark: DroneClass;
  mtomGrams: number;
  hasCameraOrSensor: boolean;
  droneType: DroneType;
  openCategory: OpenCategory;
  hasRemoteId: boolean;
  altitudeLocked120m: boolean;
  compliance: DroneCompliance;
  limits: WeatherLimits;
  createdAt: string;
  updatedAt: string;
}

export interface TcasLevelSettings {
  radiusKm: number;
  visual: boolean;
  audio: boolean;
  haptic: boolean;
}

export interface ProximityAlarmSettings {
  enabled: boolean;
  maxAltitudeM: number;
  radiusKm: number;
  approachRadiusM: number;
  ta: TcasLevelSettings;
  ra: TcasLevelSettings;
  tcasTimeEnabled: boolean;
  taTimeSec: number;
  raTimeSec: number;
  taTimeEnabled?: boolean;
  raTimeEnabled?: boolean;
}

export interface Settings {
  windUnit: "m/s" | "km/h";
  tempUnit: "C" | "F";
  limits: WeatherLimits;
  preferGermany: boolean;
  /**
   * ISO-2 Code des Landes, in dem der Pilot fliegt.
   * Steuert Karten-Zentrierung, NOTAM/Geozonen-Filter und Standard-Vorauswahl
   * in Flugplanung & Pre-Check. Default: "DE".
   */
  preferredCountryIso: string;
  proximityAlarm: ProximityAlarmSettings;
}

export type SessionPhase = "planning" | "preflight" | "hover" | "postlanding" | "debriefing" | "completed";

export interface PlanningData {
  plannedDate: string;
  plannedTime: string;
  flightPurpose?: string;
  maxAltitude?: number;
  maxDistance?: number;
  radiusKm?: number;
  estimatedDuration?: number;
  routeDescription?: string;
  forecastWeather?: WeatherSnapshot;
  checklistCompleted: string[];
  checklistPresented?: string[];
  isFpvFlight?: boolean;
}

export interface PreflightData {
  actualWeather?: WeatherSnapshot;
  checklistCompleted: string[];
  checklistPresented?: string[];
  equipmentNotes?: string;
  completedAt?: string;
}

export interface HoverCheckData {
  checklistCompleted?: string[];
  controlsOk?: boolean;
  signalOk?: boolean;
  hoverStable?: boolean;
  takeoffTime?: string;
  landingTime?: string;
  skippedFlightCheck?: boolean;
}

export interface PostLandingData {
  checklistCompleted: string[];
  uasPoweredOff: boolean;
  controllerPoweredOff: boolean;
  damageChecked: boolean;
}

export interface DebriefingData {
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
}

export interface TrafficLogData {
  startTime: number;
  endTime: number | null;
  centerLatitude: number;
  centerLongitude: number;
  innerRadiusM: number;
  outerRadiusM: number;
  aircraft: Array<{
    icao24: string;
    callsign: string;
    firstSeen: number;
    lastSeen: number;
    minAltitudeM: number;
    maxAltitudeM: number;
    closestDistanceKm: number;
    zone: "inner" | "outer" | "approach";
    trail: Array<{
      latitude: number;
      longitude: number;
      altitudeM: number;
      timestamp: number;
      speedKmh?: number;
      heading?: number;
    }>;
  }>;
  mapSnapshotBase64?: string;
}

export interface FlightSession {
  id: string;
  droneId: string;
  createdAt: string;
  updatedAt: string;
  currentPhase: SessionPhase;
  latitude: number;
  longitude: number;
  locationName?: string;
  countryIso?: string;
  mapUrl?: string;
  hasRestrictions: boolean;
  restrictionNotes?: string;
  detectedGeozones?: string[];
  savedGeozoneFeatures?: SavedGeozoneFeature[];
  savedDipulRestrictions?: SavedDipulRestriction[];
  status: "go" | "caution" | "nogo";
  reasons?: AssessmentReason[];
  planning?: PlanningData;
  preflight?: PreflightData;
  hoverCheck?: HoverCheckData;
  postLanding?: PostLandingData;
  debriefing?: DebriefingData;
  trafficLog?: TrafficLogData;
}

export interface SavedGeozoneFeature {
  layerLabel: string;
  name: string;
  details: string;
}

export interface SavedDipulRestriction {
  id: string;
  name: string;
  names: string[];
  category: "military" | "notam" | "nature" | "other";
  legalRef: string;
  legalExplanation: string;
  lowerAlt: number;
  lowerAltRef: string;
  upperAlt: number;
  upperAltRef: string;
  status: "active" | "upcoming";
  startTs: string | null;
  endTs: string | null;
  endTsIndefinite: boolean;
}

export interface LogbookEntry {
  id: string;
  sessionId: string;
  droneId: string;
  droneName: string;
  droneClass: DroneClass;
  createdAt: string;
  flightDate: string;
  locationName?: string;
  latitude: number;
  longitude: number;
  takeoffTime?: string;
  landingTime?: string;
  flightDurationMinutes?: number;
  maxAltitude?: number;
  weatherConditions?: WeatherSnapshot;
  incidentOccurred: boolean;
  incidentDescription?: string;
  maintenanceRequired: boolean;
  maintenanceNotes?: string;
  notes?: string;
  planning?: PlanningData;
  preflight?: PreflightData;
  hoverCheck?: HoverCheckData;
  postLanding?: PostLandingData;
  debriefing?: DebriefingData;
  hasRestrictions?: boolean;
  restrictionNotes?: string;
  detectedGeozones?: string[];
  savedGeozoneFeatures?: SavedGeozoneFeature[];
  savedDipulRestrictions?: SavedDipulRestriction[];
  status?: "go" | "caution" | "nogo";
  trafficLog?: TrafficLogData;
}

export const DEFAULT_LIMITS: WeatherLimits = {
  maxWind: 10,
  maxGusts: 12,
  maxRain: 0.5,
  minTemp: 0,
  minCloudCeiling: 120,
  minVisibility: 1500,
};

export const DEFAULT_PROXIMITY_ALARM: ProximityAlarmSettings = {
  enabled: true,
  maxAltitudeM: 500,
  radiusKm: 5,
  approachRadiusM: 2000,
  ta: { radiusKm: 3, visual: true, audio: true, haptic: true },
  ra: { radiusKm: 1, visual: true, audio: true, haptic: true },
  tcasTimeEnabled: true,
  taTimeSec: 40,
  raTimeSec: 30,
  taTimeEnabled: true,
  raTimeEnabled: true,
};

export const DEFAULT_SETTINGS: Settings = {
  windUnit: "m/s",
  tempUnit: "C",
  limits: DEFAULT_LIMITS,
  preferGermany: true,
  preferredCountryIso: "DE",
  proximityAlarm: DEFAULT_PROXIMITY_ALARM,
};

export const DEFAULT_COMPLIANCE: DroneCompliance = {
  operatorRegistered: false,
  eIdLabeledOnDrone: false,
  insuranceActive: false,
  competencyA1A3: false,
  certificateA2: false,
  remoteIdConfigured: false,
  spotterConfirmed: false,
};

export async function getBriefings(): Promise<Briefing[]> {
  try {
    const data = await AsyncStorage.getItem(BRIEFINGS_KEY);
    if (data) {
      const briefings: Briefing[] = JSON.parse(data);
      return briefings.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
    return [];
  } catch (error) {
    console.error("Error loading briefings:", error);
    return [];
  }
}

export async function getBriefing(id: string): Promise<Briefing | null> {
  const briefings = await getBriefings();
  return briefings.find((b) => b.id === id) || null;
}

export async function saveBriefing(briefing: Omit<Briefing, "id">): Promise<Briefing> {
  const briefings = await getBriefings();
  const newBriefing: Briefing = {
    ...briefing,
    id: generateId(),
  };
  briefings.unshift(newBriefing);
  await AsyncStorage.setItem(BRIEFINGS_KEY, JSON.stringify(briefings));
  return newBriefing;
}

export async function updateBriefing(id: string, updates: Partial<Briefing>): Promise<void> {
  const briefings = await getBriefings();
  const index = briefings.findIndex((b) => b.id === id);
  if (index !== -1) {
    briefings[index] = { ...briefings[index], ...updates };
    await AsyncStorage.setItem(BRIEFINGS_KEY, JSON.stringify(briefings));
  }
}

export async function deleteBriefing(id: string): Promise<void> {
  const briefings = await getBriefings();
  const filtered = briefings.filter((b) => b.id !== id);
  await AsyncStorage.setItem(BRIEFINGS_KEY, JSON.stringify(filtered));
}

export async function getSettings(): Promise<Settings> {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        limits: { ...DEFAULT_LIMITS, ...(parsed.limits || {}) },
        proximityAlarm: {
          ...DEFAULT_PROXIMITY_ALARM,
          ...(parsed.proximityAlarm || {}),
          ta: { ...DEFAULT_PROXIMITY_ALARM.ta, ...(parsed.proximityAlarm?.ta || {}) },
          ra: { ...DEFAULT_PROXIMITY_ALARM.ra, ...(parsed.proximityAlarm?.ra || {}) },
          tcasTimeEnabled: true,
          taTimeEnabled: parsed.proximityAlarm?.taTimeEnabled ?? (parsed.proximityAlarm?.tcasTimeEnabled ?? true),
          raTimeEnabled: parsed.proximityAlarm?.raTimeEnabled ?? (parsed.proximityAlarm?.tcasTimeEnabled ?? true),
        },
      };
    }
    return DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Error loading settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
}

export async function getDrones(): Promise<DroneProfile[]> {
  const drones = await getLocalData<DroneProfile[]>(DRONES_KEY) || [];
  return drones.map(drone => ({
    ...drone,
    droneType: drone.droneType || "standard" as DroneType,
    hasRemoteId: drone.hasRemoteId ?? false,
    altitudeLocked120m: drone.altitudeLocked120m ?? false,
  })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getDrone(id: string): Promise<DroneProfile | null> {
  const drones = await getDrones();
  return drones.find((d) => d.id === id) || null;
}

export async function saveDrone(drone: Omit<DroneProfile, "id" | "createdAt" | "updatedAt">): Promise<DroneProfile> {
  const drones = await getLocalData<DroneProfile[]>(DRONES_KEY) || [];
  const now = new Date().toISOString();
  const newDrone: DroneProfile = {
    ...drone,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  drones.unshift(newDrone);
  await saveLocalData(DRONES_KEY, drones);
  return newDrone;
}

export async function updateDrone(id: string, updates: Partial<DroneProfile>): Promise<void> {
  const drones = await getLocalData<DroneProfile[]>(DRONES_KEY) || [];
  const index = drones.findIndex((d) => d.id === id);
  if (index !== -1) {
    drones[index] = { ...drones[index], ...updates, updatedAt: new Date().toISOString() };
    await saveLocalData(DRONES_KEY, drones);
  }
}

export async function deleteDrone(id: string): Promise<void> {
  const drones = await getLocalData<DroneProfile[]>(DRONES_KEY) || [];
  const filtered = drones.filter((d) => d.id !== id);
  await saveLocalData(DRONES_KEY, filtered);
  const selectedId = await getSelectedDroneId();
  if (selectedId === id) {
    await setSelectedDroneId(null);
  }
}

export async function getSelectedDroneId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SELECTED_DRONE_KEY);
  } catch (error) {
    console.error("Error getting selected drone:", error);
    return null;
  }
}

export async function setSelectedDroneId(id: string | null): Promise<void> {
  try {
    if (id) {
      await AsyncStorage.setItem(SELECTED_DRONE_KEY, id);
    } else {
      await AsyncStorage.removeItem(SELECTED_DRONE_KEY);
    }
  } catch (error) {
    console.error("Error setting selected drone:", error);
    throw error;
  }
}

export async function getSelectedDrone(): Promise<DroneProfile | null> {
  const id = await getSelectedDroneId();
  if (!id) return null;
  return getDrone(id);
}

export function getDroneRequiredCompliance(drone: DroneProfile): {
  required: (keyof DroneCompliance)[];
  optional: (keyof DroneCompliance)[];
} {
  const required: (keyof DroneCompliance)[] = [];
  const optional: (keyof DroneCompliance)[] = [];

  if (drone.classMark === "C0") {
    if (drone.mtomGrams >= 250 || drone.hasCameraOrSensor) {
      required.push("eIdLabeledOnDrone");
    }
  } else {
    required.push("eIdLabeledOnDrone");
  }

  if (drone.classMark === "C1" || drone.classMark === "C2" || drone.classMark === "C3") {
    required.push("remoteIdConfigured");
  }

  if (drone.droneType === "fpv_only") {
    required.push("spotterConfirmed");
  } else if (drone.droneType === "hybrid_fpv") {
    optional.push("spotterConfirmed");
  }

  return { required, optional };
}

export function getPilotRequiredCompliance(drone: DroneProfile): {
  required: (keyof PilotCompliance)[];
  optional: (keyof PilotCompliance)[];
} {
  const required: (keyof PilotCompliance)[] = [];
  const optional: (keyof PilotCompliance)[] = [];

  required.push("insuranceActive");
  if (drone.classMark === "C0") {
    if (drone.mtomGrams >= 250 || drone.hasCameraOrSensor) {
      required.push("operatorRegistered");
    }
  } else {
    required.push("operatorRegistered");
  }

  if (drone.classMark !== "C0") {
    required.push("competencyA1A3");
  }

  if (drone.classMark === "C2" && drone.openCategory === "A2") {
    required.push("certificateA2");
  }

  return { required, optional };
}

export function getPilotComplianceValues(pilot: PilotProfile): PilotCompliance {
  return {
    insuranceActive: pilot.insuranceActive,
    operatorRegistered: pilot.operatorRegistered || !!pilot.operatorId,
    competencyA1A3: pilot.licenseA1A3,
    certificateA2: pilot.licenseA2,
  };
}

export function getRequiredCompliance(drone: DroneProfile): {
  required: (keyof DroneCompliance)[];
  optional: (keyof DroneCompliance)[];
} {
  const droneReq = getDroneRequiredCompliance(drone);
  const pilotReq = getPilotRequiredCompliance(drone);
  return {
    required: [...pilotReq.required as (keyof DroneCompliance)[], ...droneReq.required],
    optional: [...pilotReq.optional as (keyof DroneCompliance)[], ...droneReq.optional],
  };
}

export function getComplianceStatus(drone: DroneProfile, pilot?: PilotProfile): "green" | "yellow" | "red" {
  const droneReq = getDroneRequiredCompliance(drone);
  const missingDroneRequired = droneReq.required.filter(key => !drone.compliance[key]);
  const missingDroneOptional = droneReq.optional.filter(key => !drone.compliance[key]);

  if (pilot) {
    const pilotReq = getPilotRequiredCompliance(drone);
    const pilotValues = getPilotComplianceValues(pilot);
    const missingPilotRequired = pilotReq.required.filter(key => !pilotValues[key]);
    if (missingDroneRequired.length > 0 || missingPilotRequired.length > 0) return "red";
    if (missingDroneOptional.length > 0) return "yellow";
    return "green";
  }

  const missingLegacy = droneReq.required.filter(key => !drone.compliance[key]);
  if (missingLegacy.length > 0) return "red";
  if (missingDroneOptional.length > 0) return "yellow";
  return "green";
}

export function getDefaultLimitsForClass(classMark: DroneClass): WeatherLimits {
  switch (classMark) {
    case "C0":
      return { maxWind: 8, maxGusts: 10, maxRain: 0.3, minTemp: 5, minCloudCeiling: 120, minVisibility: 500 };
    case "C1":
      return { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: 0, minCloudCeiling: 120, minVisibility: 1000 };
    case "C2":
      return { maxWind: 12, maxGusts: 15, maxRain: 0.5, minTemp: -5, minCloudCeiling: 120, minVisibility: 2000 };
    case "C3":
    case "C4":
      return { maxWind: 15, maxGusts: 18, maxRain: 1.0, minTemp: -10, minCloudCeiling: 120, minVisibility: 5000 };
    case "C5":
    case "C6":
      return { maxWind: 18, maxGusts: 22, maxRain: 1.5, minTemp: -15, minCloudCeiling: 120, minVisibility: 8000 };
    case "legacy":
    default:
      return { maxWind: 10, maxGusts: 12, maxRain: 0.5, minTemp: 0, minCloudCeiling: 120, minVisibility: 1500 };
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function getFlightSessions(): Promise<FlightSession[]> {
  const sessions = await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY) || [];
  return sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getFlightSession(id: string): Promise<FlightSession | null> {
  const sessions = await getFlightSessions();
  return sessions.find((s) => s.id === id) || null;
}

export async function getActiveSessions(): Promise<FlightSession[]> {
  const sessions = await getFlightSessions();
  return sessions.filter(s => s.currentPhase !== "completed");
}

export async function getTodaysSessions(): Promise<FlightSession[]> {
  const sessions = await getFlightSessions();
  const today = new Date().toISOString().split("T")[0];
  return sessions.filter(s => {
    const sessionDate = s.planning?.plannedDate || s.createdAt.split("T")[0];
    return sessionDate === today;
  });
}

export async function createFlightSession(
  session: Omit<FlightSession, "id" | "createdAt" | "updatedAt">
): Promise<FlightSession> {
  const sessions = await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY) || [];
  const now = new Date().toISOString();
  const newSession: FlightSession = {
    ...session,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  sessions.unshift(newSession);
  await saveLocalData(FLIGHT_SESSIONS_KEY, sessions);
  return newSession;
}

export async function updateFlightSession(
  id: string,
  updates: Partial<FlightSession>
): Promise<FlightSession | null> {
  const sessions = await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY) || [];
  const index = sessions.findIndex((s) => s.id === id);
  if (index !== -1) {
    sessions[index] = {
      ...sessions[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await saveLocalData(FLIGHT_SESSIONS_KEY, sessions);
    return sessions[index];
  }
  return null;
}

export async function deleteFlightSession(id: string): Promise<void> {
  const sessions = await getLocalData<FlightSession[]>(FLIGHT_SESSIONS_KEY) || [];
  const filtered = sessions.filter((s) => s.id !== id);
  await saveLocalData(FLIGHT_SESSIONS_KEY, filtered);
}

export async function getLogbook(): Promise<LogbookEntry[]> {
  const entries = await getLocalData<LogbookEntry[]>(LOGBOOK_KEY) || [];
  return entries.sort(
    (a, b) => new Date(b.flightDate).getTime() - new Date(a.flightDate).getTime()
  );
}

export async function getLogbookEntry(id: string): Promise<LogbookEntry | null> {
  const entries = await getLogbook();
  return entries.find((e) => e.id === id) || null;
}

export async function createLogbookEntry(
  entry: Omit<LogbookEntry, "id" | "createdAt">
): Promise<LogbookEntry> {
  const entries = await getLocalData<LogbookEntry[]>(LOGBOOK_KEY) || [];
  const newEntry: LogbookEntry = {
    ...entry,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  entries.unshift(newEntry);
  await saveLocalData(LOGBOOK_KEY, entries);
  return newEntry;
}

export async function updateLogbookEntry(
  id: string,
  updates: Partial<LogbookEntry>
): Promise<void> {
  const entries = await getLocalData<LogbookEntry[]>(LOGBOOK_KEY) || [];
  const index = entries.findIndex((e) => e.id === id);
  if (index !== -1) {
    entries[index] = { ...entries[index], ...updates };
    await saveLocalData(LOGBOOK_KEY, entries);
  }
}

export async function deleteLogbookEntry(id: string): Promise<void> {
  const entries = await getLocalData<LogbookEntry[]>(LOGBOOK_KEY) || [];
  const filtered = entries.filter((e) => e.id !== id);
  await saveLocalData(LOGBOOK_KEY, filtered);
}

export async function completeSessionWithLogEntry(
  sessionId: string,
  debriefing: DebriefingData
): Promise<LogbookEntry | null> {
  const session = await getFlightSession(sessionId);
  if (!session) return null;

  const drone = await getDrone(session.droneId);
  if (!drone) return null;

  await updateFlightSession(sessionId, {
    currentPhase: "completed",
    debriefing,
  });

  const logEntry = await createLogbookEntry({
    sessionId,
    droneId: session.droneId,
    droneName: drone.name,
    droneClass: drone.classMark,
    flightDate: session.planning?.plannedDate || new Date().toISOString().split("T")[0],
    locationName: session.locationName,
    latitude: session.latitude,
    longitude: session.longitude,
    takeoffTime: debriefing.takeoffTime || session.hoverCheck?.takeoffTime,
    landingTime: debriefing.landingTime || session.hoverCheck?.landingTime,
    flightDurationMinutes: debriefing.flightDurationMinutes,
    maxAltitude: session.planning?.maxAltitude,
    weatherConditions: session.preflight?.actualWeather || session.planning?.forecastWeather,
    incidentOccurred: debriefing.incidentOccurred,
    incidentDescription: debriefing.incidentDescription,
    maintenanceRequired: debriefing.maintenanceRequired,
    maintenanceNotes: debriefing.maintenanceNotes,
    notes: debriefing.generalNotes,
    planning: session.planning,
    preflight: session.preflight,
    hoverCheck: session.hoverCheck,
    postLanding: session.postLanding,
    debriefing,
    hasRestrictions: session.hasRestrictions,
    restrictionNotes: session.restrictionNotes,
    detectedGeozones: session.detectedGeozones,
    savedGeozoneFeatures: session.savedGeozoneFeatures,
    savedDipulRestrictions: session.savedDipulRestrictions,
    status: session.status,
    trafficLog: session.trafficLog,
  });

  return logEntry;
}

export async function archiveSessionToLogbook(
  sessionId: string
): Promise<LogbookEntry | null> {
  const session = await getFlightSession(sessionId);
  if (!session) return null;

  const drone = await getDrone(session.droneId);
  if (!drone) return null;

  await updateFlightSession(sessionId, {
    currentPhase: "completed",
  });

  const logEntry = await createLogbookEntry({
    sessionId,
    droneId: session.droneId,
    droneName: drone.name,
    droneClass: drone.classMark,
    flightDate: session.planning?.plannedDate || new Date().toISOString().split("T")[0],
    locationName: session.locationName,
    latitude: session.latitude,
    longitude: session.longitude,
    weatherConditions: session.preflight?.actualWeather || session.planning?.forecastWeather,
    incidentOccurred: session.debriefing?.incidentOccurred || false,
    incidentDescription: session.debriefing?.incidentDescription,
    maintenanceRequired: session.debriefing?.maintenanceRequired || false,
    maintenanceNotes: session.debriefing?.maintenanceNotes,
    notes: session.debriefing?.generalNotes || "Direkt in Logbook archiviert",
    takeoffTime: session.hoverCheck?.takeoffTime || session.debriefing?.takeoffTime,
    landingTime: session.hoverCheck?.landingTime || session.debriefing?.landingTime,
    flightDurationMinutes: session.debriefing?.flightDurationMinutes,
    maxAltitude: session.planning?.maxAltitude,
    planning: session.planning,
    preflight: session.preflight,
    hoverCheck: session.hoverCheck,
    postLanding: session.postLanding,
    debriefing: session.debriefing,
    hasRestrictions: session.hasRestrictions,
    restrictionNotes: session.restrictionNotes,
    detectedGeozones: session.detectedGeozones,
    savedGeozoneFeatures: session.savedGeozoneFeatures,
    savedDipulRestrictions: session.savedDipulRestrictions,
    status: session.status,
    trafficLog: session.trafficLog,
  });

  return logEntry;
}

export type DroneEventType = "repair" | "inspection" | "cleaning" | "rotor_change" | "damage" | "replacement" | "other";

export interface DroneHistoryEntry {
  id: string;
  droneId: string;
  eventType: DroneEventType;
  description: string;
  date: string;
  createdAt: string;
}

export async function getDroneHistory(droneId: string): Promise<DroneHistoryEntry[]> {
  const json = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
  if (!json) return [];
  const allHistory: DroneHistoryEntry[] = JSON.parse(json);
  return allHistory
    .filter(entry => entry.droneId === droneId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function addDroneHistoryEntry(
  droneId: string,
  data: { eventType: DroneEventType; description: string; date: string }
): Promise<DroneHistoryEntry> {
  const json = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
  const history: DroneHistoryEntry[] = json ? JSON.parse(json) : [];
  
  const newEntry: DroneHistoryEntry = {
    id: Date.now().toString(),
    droneId,
    eventType: data.eventType,
    description: data.description,
    date: data.date,
    createdAt: new Date().toISOString(),
  };
  
  history.push(newEntry);
  await AsyncStorage.setItem(DRONE_HISTORY_KEY, JSON.stringify(history));
  return newEntry;
}

export async function deleteDroneHistoryEntry(droneId: string, entryId: string): Promise<void> {
  const json = await AsyncStorage.getItem(DRONE_HISTORY_KEY);
  if (!json) return;
  const history: DroneHistoryEntry[] = JSON.parse(json);
  const filtered = history.filter(entry => !(entry.id === entryId && entry.droneId === droneId));
  await AsyncStorage.setItem(DRONE_HISTORY_KEY, JSON.stringify(filtered));
}

export async function migrateLocalDataToServer(): Promise<{ 
  success: boolean; 
  dronesSync: number; 
  sessionsSync: number; 
  logbookSync: number;
  error?: string;
}> {
  return { success: true, dronesSync: 0, sessionsSync: 0, logbookSync: 0 };
}

export async function resetSyncStatus(): Promise<void> {
  await AsyncStorage.removeItem(SYNC_STATUS_KEY);
}

export const BUNDESLAENDER = [
  "Baden-Württemberg",
  "Bayern",
  "Berlin",
  "Brandenburg",
  "Bremen",
  "Hamburg",
  "Hessen",
  "Mecklenburg-Vorpommern",
  "Niedersachsen",
  "Nordrhein-Westfalen",
  "Rheinland-Pfalz",
  "Saarland",
  "Sachsen",
  "Sachsen-Anhalt",
  "Schleswig-Holstein",
  "Thüringen",
] as const;

export type Bundesland = typeof BUNDESLAENDER[number];

export const AV_GEOZONE_TYPES = [
  { id: "naturschutzgebiete", label: "Naturschutzgebiete" },
  { id: "nationalparks", label: "Nationalparks" },
  { id: "vogelschutzgebiete", label: "Vogelschutzgebiete" },
  { id: "ffh-gebiete", label: "FFH-Gebiete" },
  { id: "wohngrundstuecke", label: "Wohngrundstücke" },
  { id: "bahnanlagen", label: "Bahnanlagen" },
  { id: "bundesautobahnen", label: "Bundesautobahnen" },
  { id: "bundesstrassen", label: "Bundesstraßen" },
  { id: "industrieanlagen", label: "Industrieanlagen" },
  { id: "krankenhaeuser", label: "Krankenhäuser" },
  { id: "stromleitungen", label: "Stromleitungen" },
  { id: "kraftwerke", label: "Kraftwerke" },
  { id: "freibaeder", label: "Freibäder / Badestrände" },
] as const;

export interface AdditionalDoc {
  title: string;
  url: string;
  icon: "file-text" | "download" | "info" | "shield" | "book-open" | "map";
}

export interface BundeslandAvInfo {
  behorde: string;
  antragUrl: string;
  infoUrl?: string;
  pdfUrl?: string;
  additionalDocs?: AdditionalDoc[];
}

export const GENERAL_UAS_RESOURCES: AdditionalDoc[] = [
  {
    title: "EU-Drohnenverordnung FAQ (DJI)",
    url: "https://enterprise-insights.dji.com/hubfs/2024%20EU%20Event%20Download/regulation%20FAQ.pdf?hsLang=de",
    icon: "book-open",
  },
  {
    title: "dipul.de - Anträge & Behördendienste",
    url: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    icon: "file-text",
  },
];

export const BUNDESLAND_AV_INFO: Record<string, BundeslandAvInfo> = {
  "Baden-Württemberg": {
    behorde: "Regierungspräsidium Stuttgart",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    infoUrl: "https://rp.baden-wuerttemberg.de/rps/abt4/ref46/drohnen/",
  },
  "Bayern": {
    behorde: "Regierung von Oberbayern - Luftamt Südbayern",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    infoUrl: "https://www.regierung.oberbayern.bayern.de/aufgaben/wirtschaft/luftverkehr/",
  },
  "Berlin": {
    behorde: "Senatsverwaltung für Umwelt, Mobilität, Verbraucher- und Klimaschutz",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Brandenburg": {
    behorde: "Ministerium für Infrastruktur und Landesplanung",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Bremen": {
    behorde: "Senator für Wirtschaft, Arbeit und Häfen",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Hamburg": {
    behorde: "Behörde für Wirtschaft und Innovation",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Hessen": {
    behorde: "Regierungspräsidium Kassel",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    pdfUrl: "https://rp-kassel.hessen.de/sites/rp-kassel.hessen.de/files/2022-11/for_uas_gemeinsame_allgemeinerlaubnis_luftvo_rev5_0.pdf",
  },
  "Mecklenburg-Vorpommern": {
    behorde: "Landesamt für zentrale Aufgaben und Technik der Polizei, Brand- und Katastrophenschutz",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Niedersachsen": {
    behorde: "Niedersächsische Landesbehörde für Straßenbau und Verkehr",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Nordrhein-Westfalen": {
    behorde: "Bezirksregierung Düsseldorf",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
    infoUrl: "https://www.brd.nrw.de/themen/verkehr/luftverkehr",
    additionalDocs: [
      {
        title: "UAS-Betrieb Fliegerhorst Nörvenich (Bundeswehr)",
        url: "https://www.bundeswehr.de/resource/blob/5822982/e2b2d7c06566274d0562f2ec541274f2/download-pdf-infoblatt-dronenfluege-taktisches-luftwaffengeschwader-31-boelcke-data.pdf",
        icon: "shield",
      },
    ],
  },
  "Rheinland-Pfalz": {
    behorde: "Landesbetrieb Mobilität Rheinland-Pfalz",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Saarland": {
    behorde: "Ministerium für Wirtschaft, Innovation, Digitales und Energie",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Sachsen": {
    behorde: "Landesdirektion Sachsen",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Sachsen-Anhalt": {
    behorde: "Landesverwaltungsamt Sachsen-Anhalt",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Schleswig-Holstein": {
    behorde: "Landesbetrieb Straßenbau und Verkehr Schleswig-Holstein",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
  "Thüringen": {
    behorde: "Thüringer Landesamt für Bau und Verkehr",
    antragUrl: "https://dipul.de/homepage/de/antraege-behoerdendienste/einflug-in-geografische-gebiete/",
  },
};

export interface Allgemeinverfuegung {
  enabled: boolean;
  bundeslaender: Bundesland[];
  geozoneTypes: string[];
  notes?: string;
}

export const LICENSE_COUNTRIES = [
  { code: "DE", label: "Deutschland", flag: "DE" },
  { code: "AT", label: "\u00D6sterreich", flag: "AT" },
  { code: "CH", label: "Schweiz", flag: "CH" },
  { code: "LU", label: "Luxemburg", flag: "LU" },
  { code: "NL", label: "Niederlande", flag: "NL" },
  { code: "BE", label: "Belgien", flag: "BE" },
  { code: "FR", label: "Frankreich", flag: "FR" },
  { code: "PL", label: "Polen", flag: "PL" },
  { code: "CZ", label: "Tschechien", flag: "CZ" },
  { code: "DK", label: "D\u00E4nemark", flag: "DK" },
  { code: "IT", label: "Italien", flag: "IT" },
  { code: "ES", label: "Spanien", flag: "ES" },
  { code: "SE", label: "Schweden", flag: "SE" },
  { code: "PT", label: "Portugal", flag: "PT" },
  { code: "IE", label: "Irland", flag: "IE" },
  { code: "GR", label: "Griechenland", flag: "GR" },
  { code: "FI", label: "Finnland", flag: "FI" },
  { code: "HR", label: "Kroatien", flag: "HR" },
  { code: "BG", label: "Bulgarien", flag: "BG" },
  { code: "RO", label: "Rum\u00E4nien", flag: "RO" },
  { code: "HU", label: "Ungarn", flag: "HU" },
  { code: "SK", label: "Slowakei", flag: "SK" },
  { code: "SI", label: "Slowenien", flag: "SI" },
  { code: "LT", label: "Litauen", flag: "LT" },
  { code: "LV", label: "Lettland", flag: "LV" },
  { code: "EE", label: "Estland", flag: "EE" },
  { code: "CY", label: "Zypern", flag: "CY" },
  { code: "MT", label: "Malta", flag: "MT" },
  { code: "NO", label: "Norwegen", flag: "NO" },
  { code: "IS", label: "Island", flag: "IS" },
  { code: "LI", label: "Liechtenstein", flag: "LI" },
] as const;

export type LicenseCountryCode = typeof LICENSE_COUNTRIES[number]["code"];

export interface LicenseDetails {
  firstName: string;
  lastName: string;
  identificationNumber: string;
  expirationDate: string;
  country?: LicenseCountryCode;
}

const DEFAULT_LICENSE_DETAILS: LicenseDetails = {
  firstName: "",
  lastName: "",
  identificationNumber: "",
  expirationDate: "",
  country: "DE",
};

export interface CountrySpecificPilot {
  insuranceCH1Mio: boolean;
  insuranceATSzr: boolean;
  alphaTangoFR: boolean;
  dFlightIT: boolean;
  caaUK: boolean;
}

export const DEFAULT_COUNTRY_SPECIFIC: CountrySpecificPilot = {
  insuranceCH1Mio: false,
  insuranceATSzr: false,
  alphaTangoFR: false,
  dFlightIT: false,
  caaUK: false,
};

export interface PilotProfile {
  name: string;
  pilotId: string;
  operatorId: string;
  licenseA1A3: boolean;
  licenseA2: boolean;
  licenseSTS: boolean;
  licenseA1A3Details: LicenseDetails;
  licenseA2Details: LicenseDetails;
  allgemeinverfuegung: Allgemeinverfuegung;
  countrySpecific: CountrySpecificPilot;
  insuranceActive: boolean;
  operatorRegistered: boolean;
}

const DEFAULT_PILOT_PROFILE: PilotProfile = {
  name: "",
  pilotId: "",
  operatorId: "",
  licenseA1A3: false,
  licenseA2: false,
  licenseSTS: false,
  licenseA1A3Details: { ...DEFAULT_LICENSE_DETAILS },
  licenseA2Details: { ...DEFAULT_LICENSE_DETAILS },
  allgemeinverfuegung: {
    enabled: false,
    bundeslaender: [],
    geozoneTypes: [],
  },
  countrySpecific: { ...DEFAULT_COUNTRY_SPECIFIC },
  insuranceActive: false,
  operatorRegistered: false,
};

export async function getPilotProfile(): Promise<PilotProfile> {
  const data = await getLocalData<PilotProfile>(PILOT_PROFILE_KEY);
  if (!data) return { ...DEFAULT_PILOT_PROFILE };
  return {
    ...DEFAULT_PILOT_PROFILE,
    ...data,
    licenseA1A3Details: { ...DEFAULT_LICENSE_DETAILS, ...(data.licenseA1A3Details || {}) },
    licenseA2Details: { ...DEFAULT_LICENSE_DETAILS, ...(data.licenseA2Details || {}) },
    allgemeinverfuegung: {
      ...DEFAULT_PILOT_PROFILE.allgemeinverfuegung,
      ...(data.allgemeinverfuegung || {}),
    },
    countrySpecific: {
      ...DEFAULT_COUNTRY_SPECIFIC,
      ...(data.countrySpecific || {}),
    },
  };
}

export async function savePilotProfile(profile: PilotProfile): Promise<void> {
  await saveLocalData(PILOT_PROFILE_KEY, profile);
}

export async function getFlightCountForDrone(droneId: string): Promise<number> {
  const entries = await getLocalData<LogbookEntry[]>(LOGBOOK_KEY) || [];
  return entries.filter((e) => e.droneId === droneId).length;
}

export async function getFlightCountsForDrones(droneIds: string[]): Promise<Record<string, number>> {
  const entries = await getLocalData<LogbookEntry[]>(LOGBOOK_KEY) || [];
  const counts: Record<string, number> = {};
  for (const id of droneIds) {
    counts[id] = 0;
  }
  for (const entry of entries) {
    if (entry.droneId in counts) {
      counts[entry.droneId]++;
    }
  }
  return counts;
}

export function isLicenseComplete(details: LicenseDetails): boolean {
  return !!(
    details.firstName.trim() &&
    details.lastName.trim() &&
    details.identificationNumber.trim() &&
    details.expirationDate.trim()
  );
}
