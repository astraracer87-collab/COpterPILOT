import type { DroneClass, DroneType, WeatherLimits } from "@/lib/storage";

export type LicenseLevel = "L0" | "L1" | "L2";
export type ConstraintId =
  | "C_OPEN_A1"
  | "C_FLEX_A2_A3"
  | "C_DIST_A3"
  | "C_FPV_SPOT"
  | "C_LEGACY_A1"
  | "C_LEGACY_A3"
  | "C_SPECIFIC";

export const LICENSE_LEVEL_LABELS: Record<LicenseLevel, string> = {
  L0: "Keine Lizenz (nur e-ID & Versicherung)",
  L1: "A1/A3 Kompetenznachweis",
  L2: "A2 Fernpilotenzeugnis",
};

export const CONSTRAINT_LABELS: Record<ConstraintId, string> = {
  C_OPEN_A1: "A1: Flug nah an Menschen erlaubt. Kein Überflug von Menschenmengen.",
  C_FLEX_A2_A3: "Hybrid: Mit A2-Zeugnis 30m Abstand. Ohne A2 150m Abstand (A3).",
  C_DIST_A3: "A3: Mindestens 150m Abstand zu Wohn-/Gewerbegebieten.",
  C_FPV_SPOT: "FPV: Flug nur mit Spotter erlaubt.",
  C_LEGACY_A1: "Bestandsdrohne <250g: Flug in A1 dauerhaft erlaubt.",
  C_LEGACY_A3: "Bestandsdrohne >250g: 150m Abstand zu Menschen/Gebäuden (A3).",
  C_SPECIFIC: "Specific: Nur mit SORA/LUC-Genehmigung.",
};

export interface DronePreset {
  model: string;
  manufacturer: string;
  year: number;
  classMark: DroneClass;
  mtomGrams: number;
  maxWindMs: number;
  minTemp: number;
  droneType: DroneType;
  hasLidar: boolean;
  hasCameraOrSensor: boolean;
  hasRemoteId: boolean;
  altitudeLocked120m: boolean;
  minLicenseLevel: LicenseLevel;
  constraintId: ConstraintId;
  notes?: string;
  manualUrl?: string;
}

export const DJI_PRESETS: DronePreset[] = [
  { model: "Neo 2", manufacturer: "DJI", year: 2025, classMark: "C0", mtomGrams: 145, maxWindMs: 8.0, minTemp: -10, droneType: "hybrid_fpv", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "AI-Tracking", manualUrl: "https://www.dji.com/de/neo-2/downloads" },
  { model: "Neo", manufacturer: "DJI", year: 2024, classMark: "C0", mtomGrams: 135, maxWindMs: 8.0, minTemp: 0, droneType: "hybrid_fpv", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "Einsteiger / Selfie", manualUrl: "https://www.dji.com/de/neo/downloads" },
  { model: "Mini 5 Pro", manufacturer: "DJI", year: 2025, classMark: "C0", mtomGrams: 249, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: true, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "Lidar-Nachtsicht", manualUrl: "https://www.dji.com/de/mini-5-pro/downloads" },
  { model: "Mini 4 Pro", manufacturer: "DJI", year: 2023, classMark: "C0", mtomGrams: 249, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "Omnidirektional", manualUrl: "https://www.dji.com/de/mini-4-pro/downloads" },
  { model: "Mini 4K", manufacturer: "DJI", year: 2024, classMark: "C0", mtomGrams: 249, maxWindMs: 8.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "Budget 4K", manualUrl: "https://www.dji.com/de/mini-4k/downloads" },
  { model: "Mini 3 Pro", manufacturer: "DJI", year: 2022, classMark: "C0", mtomGrams: 249, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "Vertikal-Modus", manualUrl: "https://www.dji.com/de/mini-3-pro/downloads" },
  { model: "Mini 3", manufacturer: "DJI", year: 2022, classMark: "C0", mtomGrams: 248, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", manualUrl: "https://www.dji.com/de/mini-3/downloads" },
  { model: "Mini 2 SE", manufacturer: "DJI", year: 2023, classMark: "C0", mtomGrams: 246, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", notes: "Budget", manualUrl: "https://www.dji.com/de/mini-2-se/downloads" },
  { model: "Mini 2", manufacturer: "DJI", year: 2020, classMark: "legacy", mtomGrams: 249, maxWindMs: 10.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L0", constraintId: "C_LEGACY_A1", notes: "4K Mini", manualUrl: "https://www.dji.com/de/mini-2/downloads" },
  { model: "Mini SE", manufacturer: "DJI", year: 2021, classMark: "legacy", mtomGrams: 249, maxWindMs: 8.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L0", constraintId: "C_LEGACY_A1", manualUrl: "https://www.dji.com/de/dji-mini-se/downloads" },
  { model: "Mavic Mini", manufacturer: "DJI", year: 2019, classMark: "legacy", mtomGrams: 249, maxWindMs: 8.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L0", constraintId: "C_LEGACY_A1", notes: "Erste <250g" },

  { model: "Air 3S", manufacturer: "DJI", year: 2024, classMark: "C1", mtomGrams: 724, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: true, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", notes: "Lidar / Dual-Cam", manualUrl: "https://www.dji.com/de/air-3s/downloads" },
  { model: "Air 3", manufacturer: "DJI", year: 2023, classMark: "C1", mtomGrams: 720, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", notes: "24mm + 70mm", manualUrl: "https://www.dji.com/de/air-3/downloads" },
  { model: "Air 2S", manufacturer: "DJI", year: 2021, classMark: "C1", mtomGrams: 595, maxWindMs: 10.7, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", notes: "1-Zoll Sensor", manualUrl: "https://www.dji.com/de/air-2s/downloads" },
  { model: "Mavic 3 Classic", manufacturer: "DJI", year: 2022, classMark: "C1", mtomGrams: 895, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", notes: "Zertifiziert", manualUrl: "https://www.dji.com/de/mavic-3-classic/downloads" },
  { model: "Mavic 3", manufacturer: "DJI", year: 2021, classMark: "C1", mtomGrams: 895, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", notes: "Erste C1 Drohne", manualUrl: "https://www.dji.com/de/mavic-3/downloads" },

  { model: "Mavic 4 Pro", manufacturer: "DJI", year: 2025, classMark: "C2", mtomGrams: 942, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: true, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", notes: "Triple-Cam / Lidar", manualUrl: "https://www.dji.com/de/mavic-4-pro/downloads" },
  { model: "Mavic 3 Pro", manufacturer: "DJI", year: 2023, classMark: "C2", mtomGrams: 958, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", notes: "Erstmals 3 Kameras", manualUrl: "https://www.dji.com/de/mavic-3-pro/downloads" },
  { model: "Mavic 3 Enterprise", manufacturer: "DJI", year: 2022, classMark: "C2", mtomGrams: 1050, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", notes: "Wärmebild / Enterprise", manualUrl: "https://www.dji.com/de/mavic-3-enterprise/downloads" },
  { model: "Matrice 30T", manufacturer: "DJI", year: 2022, classMark: "C2", mtomGrams: 3998, maxWindMs: 15.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", notes: "Industrie / Wärmebild", manualUrl: "https://www.dji.com/de/matrice-30/downloads" },

  { model: "Inspire 3", manufacturer: "DJI", year: 2023, classMark: "C3", mtomGrams: 3995, maxWindMs: 14.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_DIST_A3", notes: "Profi-Kino", manualUrl: "https://www.dji.com/de/inspire-3/downloads" },
  { model: "Matrice 350 RTK", manufacturer: "DJI", year: 2023, classMark: "C3", mtomGrams: 9200, maxWindMs: 12.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_DIST_A3", notes: "Schwerlast / Vermessung", manualUrl: "https://www.dji.com/de/matrice-350-rtk/downloads" },

  { model: "Avata 360", manufacturer: "DJI", year: 2025, classMark: "C1", mtomGrams: 485, maxWindMs: 10.7, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", notes: "FPV 360° (Spotter Pflicht)", manualUrl: "https://www.dji.com/de/avata-360/downloads" },
  { model: "Avata 2", manufacturer: "DJI", year: 2024, classMark: "C1", mtomGrams: 377, maxWindMs: 10.7, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", notes: "FPV (Spotter Pflicht)", manualUrl: "https://www.dji.com/de/avata-2/downloads" },
  { model: "Avata", manufacturer: "DJI", year: 2022, classMark: "legacy", mtomGrams: 410, maxWindMs: 10.7, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", notes: "Cinewhoop", manualUrl: "https://www.dji.com/de/avata/downloads" },
  { model: "FPV", manufacturer: "DJI", year: 2021, classMark: "legacy", mtomGrams: 795, maxWindMs: 13.5, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", notes: "Hybrid-FPV", manualUrl: "https://www.dji.com/de/dji-fpv/downloads" },

  { model: "Mavic Air 2", manufacturer: "DJI", year: 2020, classMark: "legacy", mtomGrams: 570, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Starker Allrounder", manualUrl: "https://www.dji.com/de/mavic-air-2/downloads" },
  { model: "Mavic Air", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 430, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3" },
  { model: "Mavic 2 Pro", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 907, maxWindMs: 10.5, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Hasselblad-Optik" },
  { model: "Mavic 2 Zoom", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 905, maxWindMs: 10.5, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "2x Optischer Zoom" },
  { model: "Mavic Pro Platinum", manufacturer: "DJI", year: 2017, classMark: "legacy", mtomGrams: 734, maxWindMs: 10.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Leise Propeller" },
  { model: "Mavic Pro", manufacturer: "DJI", year: 2016, classMark: "legacy", mtomGrams: 734, maxWindMs: 10.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Erste Faltbare" },
  { model: "Spark", manufacturer: "DJI", year: 2017, classMark: "legacy", mtomGrams: 300, maxWindMs: 13.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Gestensteuerung" },
  { model: "Phantom 4 Pro V2.0", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 1375, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Profi-Klassiker" },
  { model: "Phantom 4 Advanced", manufacturer: "DJI", year: 2017, classMark: "legacy", mtomGrams: 1368, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3" },
  { model: "Phantom 3 Professional", manufacturer: "DJI", year: 2015, classMark: "legacy", mtomGrams: 1280, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "4K Klassiker" },
  { model: "Inspire 2", manufacturer: "DJI", year: 2016, classMark: "legacy", mtomGrams: 3440, maxWindMs: 10.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", notes: "Profi-Kino" },

  { model: "FlyCart 30", manufacturer: "DJI", year: 2023, classMark: "legacy", mtomGrams: 65000, maxWindMs: 12.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: false, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_SPECIFIC", notes: "Transportdrohne (SORA)", manualUrl: "https://www.dji.com/de/flycart-30/downloads" },
  { model: "Agras T50", manufacturer: "DJI", year: 2023, classMark: "legacy", mtomGrams: 52000, maxWindMs: 6.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_SPECIFIC", notes: "Agrar-Sprühdrohne (SORA)", manualUrl: "https://www.dji.com/de/t50/downloads" },
];

export const ALL_PRESETS = [...DJI_PRESETS];

export function getMaxAltitudeForClass(classMark: DroneClass | string): number {
  switch (classMark) {
    case "C0":
    case "C1":
    case "C2":
    case "C3":
    case "C4":
    case "C5":
    case "C6":
    case "legacy":
    default:
      return 120;
  }
}

export function getMaxDistanceForClass(classMark: DroneClass | string): number {
  switch (classMark) {
    case "C0":
      return 500;
    case "C1":
      return 1000;
    case "C2":
      return 2000;
    case "C3":
    case "C4":
      return 5000;
    case "C5":
    case "C6":
      return 8000;
    case "legacy":
    default:
      return 1000;
  }
}

export function getPresetLimits(preset: DronePreset): WeatherLimits {
  const maxAltitude = getMaxAltitudeForClass(preset.classMark);
  const maxDistance = getMaxDistanceForClass(preset.classMark);
  return {
    maxWind: preset.maxWindMs,
    maxGusts: Math.round(preset.maxWindMs * 1.2 * 10) / 10,
    maxRain: 0.5,
    minTemp: preset.minTemp,
    minCloudCeiling: maxAltitude,
    minVisibility: maxDistance,
  };
}

export function searchPresets(query: string): DronePreset[] {
  const lowerQuery = query.toLowerCase();
  return ALL_PRESETS.filter(
    (p) =>
      p.model.toLowerCase().includes(lowerQuery) ||
      p.manufacturer.toLowerCase().includes(lowerQuery) ||
      `${p.manufacturer} ${p.model}`.toLowerCase().includes(lowerQuery)
  );
}

export function findPresetForDrone(droneName: string, manufacturer?: string, model?: string): DronePreset | null {
  const norm = (s: string) => s.toLowerCase().replace(/[-_/()]/g, " ").replace(/\s+/g, " ").trim();
  const name = norm(droneName);
  const mfr = manufacturer ? norm(manufacturer) : "";
  const mdl = model ? norm(model) : "";

  if (mfr && mdl) {
    const exact = ALL_PRESETS.find(
      (p) => norm(p.manufacturer) === mfr && norm(p.model) === mdl
    );
    if (exact) return exact;
  }

  const fullMatch = ALL_PRESETS.find(
    (p) => norm(`${p.manufacturer} ${p.model}`) === name
  );
  if (fullMatch) return fullMatch;

  const modelOnly = mdl || name;
  const modelMatch = ALL_PRESETS.find((p) => norm(p.model) === modelOnly);
  if (modelMatch) return modelMatch;

  const containsMatch = ALL_PRESETS.find((p) => {
    const pModel = norm(p.model);
    return name.includes(pModel) && pModel.length >= 3;
  });
  if (containsMatch) return containsMatch;

  return null;
}

export function getDefaultCategoryForPreset(preset: DronePreset): "A1" | "A2" | "A3" {
  switch (preset.constraintId) {
    case "C_OPEN_A1":
    case "C_LEGACY_A1":
    case "C_FPV_SPOT":
      return "A1";
    case "C_FLEX_A2_A3":
      return "A3";
    case "C_DIST_A3":
    case "C_LEGACY_A3":
    case "C_SPECIFIC":
      return "A3";
    default:
      return "A3";
  }
}

export const DRONE_CLASS_INFO: Record<DroneClass, { label: string; description: string }> = {
  C0: { label: "C0", description: "< 250g, Open A1" },
  C1: { label: "C1", description: "< 900g, Open A1" },
  C2: { label: "C2", description: "< 4kg, Open A2/A3" },
  C3: { label: "C3", description: "< 25kg, Open A3" },
  C4: { label: "C4", description: "< 25kg, Open A3" },
  C5: { label: "C5", description: "Special Category" },
  C6: { label: "C6", description: "Special Category" },
  legacy: { label: "Bestandsdrohne", description: "Ohne EU-Klasse" },
};

export const DRONE_TYPE_INFO: Record<DroneType, { label: string; spotterRequired: boolean }> = {
  selfie: { label: "Selfie-Drohne", spotterRequired: false },
  standard: { label: "Standard", spotterRequired: false },
  fpv_only: { label: "Nur FPV", spotterRequired: true },
  hybrid_fpv: { label: "Hybrid (FPV optional)", spotterRequired: false },
};
