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
  /**
   * Charakteristische Dimension (CD) in Metern: längste gerade Verbindung
   * zwischen zwei Punkten der UAS-Geometrie, einschließlich Propeller/Rotoren
   * in ungünstigster Stellung. Beim Multicopter ist dies die Rotorspitzen-
   * Diagonale; bei Cinewhoops zählt ein weiter außen liegender Schutzring mit.
   */
  charDimensionM: number;
  notes?: string;
  manualUrl?: string;
  // ─── Optische Daten für ND-Filter-Finder / Kameraplanung ────────────────────
  /** Sensor-Bezeichnung (z. B. "1/1.3-inch CMOS"). */
  sensor?: string;
  /** Feste Blendenzahl oder Default-Blende bei variabler Blende (z. B. 1.8, 2.8). */
  apertureValue?: number;
  /** True wenn die Drohne eine variable Blende hat (Mavic 3 / 4 Pro). */
  hasVariableAperture?: boolean;
  /** Horizontaler FOV in Grad. */
  fovDeg?: number;
  /** Brennweite umgerechnet auf KB (35 mm-Äquivalent), in mm. */
  focalLength35mmEquiv?: number;
  /**
   * Kompatible ND-Filter-Stärken im Hersteller-Ökosystem (z. B. ["ND4","ND8","ND16","ND32"]).
   * Wird vom ND-Finder genutzt, um auf das nächstgrößere verfügbare Filter zu snappen.
   */
  filterEcosystem?: string[];
  /**
   * Mehrere Kameras (z. B. Air 3S Wide + Tele, Mavic 3/4 Pro Triple-Cam).
   * Wenn gesetzt und länger als 1, zeigt der ND-Finder eine Kamera-Auswahl.
   * Die oberen Top-Level-Felder (sensor/aperture/...) dienen als Default
   * (= erste Kamera) für Abwärtskompatibilität.
   */
  cameras?: CameraSpec[];
}

export interface CameraSpec {
  /** Anzeigename, z. B. "Weitwinkel 24 mm" oder "Tele 70 mm". */
  name: string;
  sensor: string;
  apertureValue: number;
  hasVariableAperture?: boolean;
  fovDeg?: number;
  /** Brennweite KB-Äquivalent in mm. */
  focalLength35mmEquiv?: number;
  /** Optional eigenes Filter-Ökosystem, sonst greift filterEcosystem des Presets. */
  filterEcosystem?: string[];
}

const DJI_ECO_MINI_4 = ["ND4", "ND8", "ND16", "ND32", "ND64", "ND128", "ND256"];
const DJI_ECO_AIR_3 = ["ND8", "ND16", "ND32", "ND64", "ND128", "ND256"];
const DJI_ECO_MAVIC_3 = ["ND4", "ND8", "ND16", "ND32", "ND64", "ND128", "ND256", "ND400", "ND1000"];
const DJI_ECO_AVATA = ["ND4", "ND8", "ND16", "ND32"];
const DJI_ECO_FPV = ["ND4", "ND8", "ND16", "ND32"];

export const DJI_PRESETS: DronePreset[] = [
  { model: "Neo 2", manufacturer: "DJI", year: 2025, classMark: "C0", mtomGrams: 145, maxWindMs: 8.0, minTemp: -10, droneType: "hybrid_fpv", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.182, notes: "AI-Tracking. CD = Außenring Propellerschutzkäfig (JSON dji-neo-2: 182 mm).", manualUrl: "https://www.dji.com/de/neo-2/downloads",
    sensor: "1/2-inch CMOS", apertureValue: 2.8, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: [] },
  { model: "Neo", manufacturer: "DJI", year: 2024, classMark: "C0", mtomGrams: 135, maxWindMs: 8.0, minTemp: 0, droneType: "hybrid_fpv", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.178, notes: "Einsteiger / Selfie. CD = Außenring Propellerschutzkäfig (JSON dji-neo: 178 mm).", manualUrl: "https://www.dji.com/de/neo/downloads",
    sensor: "1/2-inch CMOS", apertureValue: 2.8, fovDeg: 117.6, focalLength35mmEquiv: 14, filterEcosystem: [] },
  { model: "Mini 5 Pro", manufacturer: "DJI", year: 2025, classMark: "C0", mtomGrams: 249, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: true, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.40, notes: "Lidar-Nachtsicht. CD = Außenmaß mit Propellern (400 mm; ALOS ≈151 m).", manualUrl: "https://www.dji.com/de/mini-5-pro/downloads",
    sensor: "1-inch CMOS", apertureValue: 1.8, fovDeg: 80, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MINI_4 },
  { model: "Mini 4 Pro", manufacturer: "DJI", year: 2023, classMark: "C0", mtomGrams: 249, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.3884, notes: "Omnidirektional. CD ≈0,39 m inklusive Propeller (ALOS ≈147 m).", manualUrl: "https://www.dji.com/de/mini-4-pro/downloads",
    sensor: "1/1.3-inch CMOS", apertureValue: 1.7, fovDeg: 82.1, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MINI_4 },
  { model: "Mini 4K", manufacturer: "DJI", year: 2024, classMark: "C0", mtomGrams: 249, maxWindMs: 8.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.21, notes: "Budget 4K. CD aus JSON (213 mm).", manualUrl: "https://www.dji.com/de/mini-4k/downloads",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 83, focalLength35mmEquiv: 24, filterEcosystem: ["ND8", "ND16", "ND32", "ND64"] },
  { model: "Mini 3 Pro", manufacturer: "DJI", year: 2022, classMark: "C0", mtomGrams: 249, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.305, notes: "Vertikal-Modus. CD aus JSON (305 mm).", manualUrl: "https://www.dji.com/de/mini-3-pro/downloads",
    sensor: "1/1.3-inch CMOS", apertureValue: 1.7, fovDeg: 82.1, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MINI_4 },
  { model: "Mini 3", manufacturer: "DJI", year: 2022, classMark: "C0", mtomGrams: 248, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.305, notes: "CD aus JSON (305 mm).", manualUrl: "https://www.dji.com/de/mini-3/downloads",
    sensor: "1/1.3-inch CMOS", apertureValue: 1.7, fovDeg: 82.1, focalLength35mmEquiv: 24, filterEcosystem: ["ND4", "ND8", "ND16", "ND32"] },
  { model: "Mini 2 SE", manufacturer: "DJI", year: 2023, classMark: "C0", mtomGrams: 246, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: true, minLicenseLevel: "L0", constraintId: "C_OPEN_A1", charDimensionM: 0.21, notes: "Budget. CD aus JSON (213 mm).", manualUrl: "https://www.dji.com/de/mini-2-se/downloads",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 83, focalLength35mmEquiv: 24, filterEcosystem: ["ND8", "ND16", "ND32", "ND64"] },
  { model: "Mini 2", manufacturer: "DJI", year: 2020, classMark: "legacy", mtomGrams: 249, maxWindMs: 10.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L0", constraintId: "C_LEGACY_A1", charDimensionM: 0.21, notes: "4K Mini. CD aus JSON (213 mm).", manualUrl: "https://www.dji.com/de/mini-2/downloads",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 83, focalLength35mmEquiv: 24, filterEcosystem: ["ND8", "ND16", "ND32", "ND64"] },
  { model: "Mini SE", manufacturer: "DJI", year: 2021, classMark: "legacy", mtomGrams: 249, maxWindMs: 8.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L0", constraintId: "C_LEGACY_A1", charDimensionM: 0.21, notes: "CD aus JSON (213 mm).", manualUrl: "https://www.dji.com/de/dji-mini-se/downloads",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 83, focalLength35mmEquiv: 24 },
  { model: "Mavic Mini", manufacturer: "DJI", year: 2019, classMark: "legacy", mtomGrams: 249, maxWindMs: 8.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L0", constraintId: "C_LEGACY_A1", charDimensionM: 0.21, notes: "Erste <250g. CD aus JSON (213 mm).",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 83, focalLength35mmEquiv: 24 },

  { model: "Air 3S", manufacturer: "DJI", year: 2024, classMark: "C1", mtomGrams: 724, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: true, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", charDimensionM: 0.58, notes: "Lidar / Dual-Cam. CD = Außenmaß mit Propellern (580 mm; ALOS ≈210 m).", manualUrl: "https://www.dji.com/de/air-3s/downloads",
    sensor: "1-inch CMOS", apertureValue: 1.8, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_AIR_3,
    cameras: [
      { name: "Weitwinkel 24 mm", sensor: "1-inch CMOS", apertureValue: 1.8, fovDeg: 84, focalLength35mmEquiv: 24 },
      { name: "Mittlere Tele 70 mm", sensor: "1/1.3-inch CMOS", apertureValue: 2.8, fovDeg: 35, focalLength35mmEquiv: 70 },
    ] },
  { model: "Air 3", manufacturer: "DJI", year: 2023, classMark: "C1", mtomGrams: 720, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", charDimensionM: 0.395, notes: "24mm + 70mm. CD aus JSON (395 mm).", manualUrl: "https://www.dji.com/de/air-3/downloads",
    sensor: "1/1.3-inch CMOS Dual", apertureValue: 1.7, fovDeg: 82, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_AIR_3,
    cameras: [
      { name: "Weitwinkel 24 mm", sensor: "1/1.3-inch CMOS", apertureValue: 1.7, fovDeg: 82, focalLength35mmEquiv: 24 },
      { name: "Mittlere Tele 70 mm", sensor: "1/1.3-inch CMOS", apertureValue: 2.8, fovDeg: 35, focalLength35mmEquiv: 70 },
    ] },
  { model: "Air 2S", manufacturer: "DJI", year: 2021, classMark: "C1", mtomGrams: 595, maxWindMs: 10.7, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", charDimensionM: 0.35, notes: "1-Zoll Sensor. CD aus JSON (354 mm).", manualUrl: "https://www.dji.com/de/air-2s/downloads",
    sensor: "1-inch CMOS", apertureValue: 2.8, fovDeg: 88, focalLength35mmEquiv: 22, filterEcosystem: ["ND4", "ND8", "ND16", "ND32", "ND64", "ND128"] },
  { model: "Mavic 3 Classic", manufacturer: "DJI", year: 2022, classMark: "C1", mtomGrams: 895, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", charDimensionM: 0.388, notes: "Zertifiziert. CD aus JSON (388 mm).", manualUrl: "https://www.dji.com/de/mavic-3-classic/downloads",
    sensor: "4/3 CMOS Hasselblad", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MAVIC_3 },
  { model: "Mavic 3", manufacturer: "DJI", year: 2021, classMark: "C1", mtomGrams: 895, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_OPEN_A1", charDimensionM: 0.388, notes: "Erste C1 Drohne. CD aus JSON (388 mm).", manualUrl: "https://www.dji.com/de/mavic-3/downloads",
    sensor: "4/3 CMOS Hasselblad", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MAVIC_3 },

  { model: "Mavic 4 Pro", manufacturer: "DJI", year: 2025, classMark: "C2", mtomGrams: 942, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: true, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 0.402, notes: "Triple-Cam / Lidar. CD aus JSON (402 mm).", manualUrl: "https://www.dji.com/de/mavic-4-pro/downloads",
    sensor: "4/3 CMOS Hasselblad", apertureValue: 2.0, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 28, filterEcosystem: DJI_ECO_MAVIC_3,
    cameras: [
      { name: "Hasselblad 28 mm", sensor: "4/3 CMOS Hasselblad", apertureValue: 2.0, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 28 },
      { name: "Mittlere Tele 70 mm", sensor: "1/1.3-inch CMOS", apertureValue: 2.8, fovDeg: 35, focalLength35mmEquiv: 70 },
      { name: "Tele 168 mm", sensor: "1/1.5-inch CMOS", apertureValue: 2.8, fovDeg: 15, focalLength35mmEquiv: 168 },
    ] },
  { model: "Mavic 3 Pro", manufacturer: "DJI", year: 2023, classMark: "C2", mtomGrams: 958, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 0.388, notes: "Erstmals 3 Kameras. CD aus JSON (388 mm).", manualUrl: "https://www.dji.com/de/mavic-3-pro/downloads",
    sensor: "4/3 CMOS Hasselblad", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MAVIC_3,
    cameras: [
      { name: "Hasselblad 24 mm", sensor: "4/3 CMOS Hasselblad", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24 },
      { name: "Mittlere Tele 70 mm", sensor: "1/1.3-inch CMOS", apertureValue: 2.8, fovDeg: 35, focalLength35mmEquiv: 70 },
      { name: "Tele 166 mm", sensor: "1/2-inch CMOS", apertureValue: 3.4, fovDeg: 15, focalLength35mmEquiv: 166 },
    ] },
  { model: "Mavic 3 Enterprise", manufacturer: "DJI", year: 2022, classMark: "C2", mtomGrams: 1050, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 0.388, notes: "Wärmebild / Enterprise. CD aus JSON (388 mm).", manualUrl: "https://www.dji.com/de/mavic-3-enterprise/downloads",
    sensor: "4/3 CMOS", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: DJI_ECO_MAVIC_3 },
  { model: "Mavic 3T", manufacturer: "DJI", year: 2022, classMark: "C2", mtomGrams: 1050, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 0.612, notes: "Wärmebild / Enterprise. CD ≈ 0,61 m inklusive Propeller (ALOS ≈220 m).", manualUrl: "https://www.dji.com/de/mavic-3-enterprise/downloads",
    sensor: "1/2-inch CMOS + Wärmebild", apertureValue: 2.8, fovDeg: 84, focalLength35mmEquiv: 24 },
  { model: "Matrice 30T", manufacturer: "DJI", year: 2022, classMark: "C2", mtomGrams: 3998, maxWindMs: 15.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 1.05, notes: "Industrie / Wärmebild. CD = Außenmaß inklusive Propeller (1,05 m; ALOS ≈363 m).", manualUrl: "https://www.dji.com/de/matrice-30/downloads",
    sensor: "1/2-inch CMOS Wide", apertureValue: 2.8, fovDeg: 84, focalLength35mmEquiv: 24 },
  { model: "Matrice 4T", manufacturer: "DJI", year: 2025, classMark: "C2", mtomGrams: 1420, maxWindMs: 12.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 0.72, notes: "Enterprise-Wärmebild. CD = 0,72 m inklusive Propeller (ALOS ≈255 m). Laserentfernungsmesser, kein LiDAR.", manualUrl: "https://www.dji.com/de/matrice-4-series/downloads",
    sensor: "1/1.3-inch CMOS + Wärmebild", apertureValue: 1.7, fovDeg: 82, focalLength35mmEquiv: 24 },
  { model: "Matrice 4TD", manufacturer: "DJI", year: 2025, classMark: "C2", mtomGrams: 2090, maxWindMs: 12.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FLEX_A2_A3", charDimensionM: 0.81, notes: "Dock 3 / Wärmebild. CD = 0,81 m inklusive Propeller (ALOS ≈285 m). Laserentfernungsmesser, kein LiDAR.", manualUrl: "https://dl.djicdn.com/downloads/DJI_Dock_3/UM/20250610/DJI_Matrice_4D_Series_User_Manual_DJI_Dock_3_v1.2_en.pdf",
    sensor: "1/1.3-inch CMOS + Wärmebild", apertureValue: 1.7, fovDeg: 82, focalLength35mmEquiv: 24 },

  { model: "Inspire 3", manufacturer: "DJI", year: 2023, classMark: "C3", mtomGrams: 3995, maxWindMs: 14.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_DIST_A3", charDimensionM: 0.695, notes: "Profi-Kino. CD aus JSON (695 mm).", manualUrl: "https://www.dji.com/de/inspire-3/downloads",
    sensor: "Full-frame X9-8K Air", apertureValue: 2.8, fovDeg: 64, focalLength35mmEquiv: 18, filterEcosystem: ["ND4", "ND8", "ND16", "ND32", "ND64", "ND128", "ND256", "ND400", "ND1000"] },
  { model: "Matrice 350 RTK", manufacturer: "DJI", year: 2023, classMark: "C3", mtomGrams: 9200, maxWindMs: 12.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_DIST_A3", charDimensionM: 0.895, notes: "Schwerlast / Vermessung. CD aus JSON (895 mm).", manualUrl: "https://www.dji.com/de/matrice-350-rtk/downloads",
    sensor: "Payload-abhängig" },

  { model: "Avata 360", manufacturer: "DJI", year: 2025, classMark: "C1", mtomGrams: 485, maxWindMs: 10.7, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", charDimensionM: 0.245, notes: "FPV 360° (Spotter Pflicht). CD = Außenring Cinewhoop (JSON: 245 mm).", manualUrl: "https://www.dji.com/de/avata-360/downloads",
    sensor: "1/1.3-inch CMOS 360", apertureValue: 2.8, fovDeg: 360, focalLength35mmEquiv: 8, filterEcosystem: DJI_ECO_AVATA },
  { model: "Avata 2", manufacturer: "DJI", year: 2024, classMark: "C1", mtomGrams: 377, maxWindMs: 10.7, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", charDimensionM: 0.25, notes: "FPV (Spotter Pflicht). CD = Außenring Cinewhoop (250 mm; ALOS ≈102 m).", manualUrl: "https://www.dji.com/de/avata-2/downloads",
    sensor: "1/1.3-inch CMOS", apertureValue: 2.8, fovDeg: 155, focalLength35mmEquiv: 12, filterEcosystem: DJI_ECO_AVATA },
  { model: "Avata", manufacturer: "DJI", year: 2022, classMark: "legacy", mtomGrams: 410, maxWindMs: 10.7, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", charDimensionM: 0.188, notes: "Cinewhoop. CD = Außenring (JSON: 188 mm).", manualUrl: "https://www.dji.com/de/avata/downloads",
    sensor: "1/1.7-inch CMOS", apertureValue: 2.8, fovDeg: 155, focalLength35mmEquiv: 12, filterEcosystem: DJI_ECO_AVATA },
  { model: "FPV", manufacturer: "DJI", year: 2021, classMark: "legacy", mtomGrams: 795, maxWindMs: 13.5, minTemp: -10, droneType: "fpv_only", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_FPV_SPOT", charDimensionM: 0.245, notes: "Hybrid-FPV. CD aus JSON (245 mm).", manualUrl: "https://www.dji.com/de/dji-fpv/downloads",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 150, focalLength35mmEquiv: 14.66, filterEcosystem: DJI_ECO_FPV },

  { model: "Mavic Air 2", manufacturer: "DJI", year: 2020, classMark: "legacy", mtomGrams: 570, maxWindMs: 10.7, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.354, notes: "Starker Allrounder. CD aus JSON (354 mm).", manualUrl: "https://www.dji.com/de/mavic-air-2/downloads",
    sensor: "1/2-inch CMOS", apertureValue: 2.8, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: ["ND4", "ND8", "ND16", "ND32"] },
  { model: "Mavic Air", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 430, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.21, notes: "CD aus JSON (213 mm).",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 85, focalLength35mmEquiv: 24 },
  { model: "Mavic 2 Pro", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 907, maxWindMs: 10.5, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.354, notes: "Hasselblad-Optik. CD aus JSON (354 mm).",
    sensor: "1-inch CMOS Hasselblad", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 77, focalLength35mmEquiv: 28, filterEcosystem: ["ND4", "ND8", "ND16", "ND32", "ND64"] },
  { model: "Mavic 2 Zoom", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 905, maxWindMs: 10.5, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.354, notes: "2x Optischer Zoom. CD aus JSON (354 mm).",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 83, focalLength35mmEquiv: 24, filterEcosystem: ["ND4", "ND8", "ND16", "ND32"] },
  { model: "Mavic Pro Platinum", manufacturer: "DJI", year: 2017, classMark: "legacy", mtomGrams: 734, maxWindMs: 10.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.335, notes: "Leise Propeller. CD wie Mavic Pro (335 mm).",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.2, fovDeg: 78.8, focalLength35mmEquiv: 26 },
  { model: "Mavic Pro", manufacturer: "DJI", year: 2016, classMark: "legacy", mtomGrams: 734, maxWindMs: 10.5, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.335, notes: "Erste Faltbare. CD aus JSON (335 mm).",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.2, fovDeg: 78.8, focalLength35mmEquiv: 26 },
  { model: "Spark", manufacturer: "DJI", year: 2017, classMark: "legacy", mtomGrams: 300, maxWindMs: 13.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.17, notes: "Gestensteuerung. CD aus JSON (170 mm).",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.6, fovDeg: 81.9, focalLength35mmEquiv: 25 },
  { model: "Phantom 4 Pro V2.0", manufacturer: "DJI", year: 2018, classMark: "legacy", mtomGrams: 1375, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.35, notes: "Profi-Klassiker. CD aus JSON (350 mm).",
    sensor: "1-inch CMOS", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24, filterEcosystem: ["ND4", "ND8", "ND16", "ND32"] },
  { model: "Phantom 4 Advanced", manufacturer: "DJI", year: 2017, classMark: "legacy", mtomGrams: 1368, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.35,
    sensor: "1-inch CMOS", apertureValue: 2.8, hasVariableAperture: true, fovDeg: 84, focalLength35mmEquiv: 24 },
  { model: "Phantom 3 Professional", manufacturer: "DJI", year: 2015, classMark: "legacy", mtomGrams: 1280, maxWindMs: 10.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.35, notes: "4K Klassiker.",
    sensor: "1/2.3-inch CMOS", apertureValue: 2.8, fovDeg: 94, focalLength35mmEquiv: 20 },
  { model: "Inspire 2", manufacturer: "DJI", year: 2016, classMark: "legacy", mtomGrams: 3440, maxWindMs: 10.0, minTemp: -10, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: false, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_LEGACY_A3", charDimensionM: 0.60, notes: "Profi-Kino.",
    sensor: "Payload (X4S/X5S/X7)" },

  { model: "FlyCart 30", manufacturer: "DJI", year: 2023, classMark: "legacy", mtomGrams: 65000, maxWindMs: 12.0, minTemp: -20, droneType: "standard", hasLidar: false, hasCameraOrSensor: false, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_SPECIFIC", charDimensionM: 2.80, notes: "Transportdrohne (SORA)", manualUrl: "https://www.dji.com/de/flycart-30/downloads" },
  { model: "Agras T50", manufacturer: "DJI", year: 2023, classMark: "legacy", mtomGrams: 52000, maxWindMs: 6.0, minTemp: 0, droneType: "standard", hasLidar: false, hasCameraOrSensor: true, hasRemoteId: true, altitudeLocked120m: false, minLicenseLevel: "L1", constraintId: "C_SPECIFIC", charDimensionM: 2.85, notes: "Agrar-Sprühdrohne (SORA)", manualUrl: "https://www.dji.com/de/t50/downloads" },
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
    maxTemp: 40,
    minCloudCeiling: maxAltitude,
    minVisibility: maxDistance,
  };
}

export function searchPresets(query: string): DronePreset[] {
  const lowerQuery = query.toLowerCase();
  const compactQuery = lowerQuery.replace(/[\s\-_/()]/g, "");
  return ALL_PRESETS.filter(
    (p) =>
      p.model.toLowerCase().includes(lowerQuery) ||
      p.manufacturer.toLowerCase().includes(lowerQuery) ||
      `${p.manufacturer} ${p.model}`.toLowerCase().includes(lowerQuery) ||
      `${p.manufacturer}${p.model}`.toLowerCase().replace(/[\s\-_/()]/g, "").includes(compactQuery)
  );
}

export function findPresetForDrone(droneName: string, manufacturer?: string, model?: string): DronePreset | null {
  const norm = (s: string) => s.toLowerCase().replace(/[-_/()]/g, " ").replace(/\s+/g, " ").trim();
  const compact = (s: string) => norm(s).replace(/\s/g, "");
  const name = norm(droneName);
  const mfr = manufacturer ? norm(manufacturer) : "";
  const mdl = model ? norm(model) : "";

  if (mfr && mdl) {
    const exact = ALL_PRESETS.find(
      (p) => compact(p.manufacturer) === compact(mfr) && compact(p.model) === compact(mdl)
    );
    if (exact) return exact;
  }

  const fullMatch = ALL_PRESETS.find(
    (p) => compact(`${p.manufacturer} ${p.model}`) === compact(name)
  );
  if (fullMatch) return fullMatch;

  const modelOnly = mdl || name;
  const modelMatch = ALL_PRESETS.find((p) => compact(p.model) === compact(modelOnly));
  if (modelMatch) return modelMatch;

  const containsMatch = [...ALL_PRESETS]
    .sort((a, b) => compact(b.model).length - compact(a.model).length)
    .find((p) => compact(p.model).length >= 3 && compact(name).includes(compact(p.model)));
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
