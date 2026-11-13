export type WeatherLimits = {
  maxWind: number;
  maxGusts: number;
  maxRain: number;
  minTemp: number;
  minCloudCeiling: number;
  minVisibility: number;
};

export type WeatherSnapshot = {
  temperature: number;
  windSpeed: number;
  windGust?: number;
  rain: number;
  cloudCover: number;
  humidity: number;
};

export type AssessmentReason = {
  type: "go" | "caution" | "nogo";
  message: string;
};

export type RestrictionStatus = "none" | "approved" | "limited";

export type WizardData = {
  droneId: string | null;
  countryIso: string;
  latitude: number | null;
  longitude: number | null;
  locationName: string;
  plannedDate: string;
  plannedTime: string;
  durationMinutes: number;
  maxAltitude: number;
  hasRestrictions: boolean;
  restrictionStatus: RestrictionStatus;
  restrictionNotes: string;
  isFpvFlight: boolean;
  flightPurpose: string;
  checklistCompleted: string[];
  forecastWeather?: WeatherSnapshot;
  notamCount?: number;
  notamCheckedAt?: string;
};

export type FlightSession = {
  id: string;
  droneId: string;
  currentPhase: string;
  latitude: number;
  longitude: number;
  locationName: string | null;
  countryIso: string | null;
  mapUrl: string | null;
  hasRestrictions: boolean;
  restrictionNotes: string | null;
  status: string;
  reasons: AssessmentReason[] | null;
  planning: Partial<WizardData> | null;
  createdAt: string;
  updatedAt: string;
};

export type Drone = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  classMark: string;
  mtomGrams: number;
  openCategory: string;
  droneType: string;
  limits: WeatherLimits;
};
