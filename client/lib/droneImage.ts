import type { ImageSourcePropType } from "react-native";

const IMAGES: Record<string, ImageSourcePropType> = {
  "dji-avata":      require("../../assets/images/drones/dji-avata.png"),
  "dji-avata-2":    require("../../assets/images/drones/dji-avata-2.png"),
  "dji-avata-360":  require("../../assets/images/drones/dji-avata-360.png"),
  "dji-neo":        require("../../assets/images/drones/dji-neo.png"),
  "dji-neo-2":      require("../../assets/images/drones/dji-neo-2.png"),
  "dji-mini-2":     require("../../assets/images/drones/dji-mini-2.png"),
  "dji-mini-3":     require("../../assets/images/drones/dji-mini-3.png"),
  "dji-mini-4":     require("../../assets/images/drones/dji-mini-4.png"),
  "dji-mini-4k":    require("../../assets/images/drones/dji-mini-4k.png"),
  "dji-mini-5":     require("../../assets/images/drones/dji-mini-5.png"),
  "dji-air-3s":     require("../../assets/images/drones/dji-air-3s.png"),
  "dji-lito-1":     require("../../assets/images/drones/dji-lito-1.png"),
  "dji-mavic-4-pro":require("../../assets/images/drones/dji-mavic-4-pro.png"),
  "dji-inspire-3":  require("../../assets/images/drones/dji-inspire-3.png"),
  "dji-flip":       require("../../assets/images/drones/dji-flip.png"),
  "dji-flycart-30": require("../../assets/images/drones/dji-flycart-30.png"),
  "dji-mini-se":    require("../../assets/images/drones/dji-mini-se.png"),
  "dji-air-3":      require("../../assets/images/drones/dji-air-3.png"),
  "dji-air-2s":     require("../../assets/images/drones/dji-air-2s.png"),
  "dji-agras-t50":  require("../../assets/images/drones/dji-agras-t50.png"),
  "dji-fpv":        require("../../assets/images/drones/dji-fpv.png"),
  "dji-inspire-2":  require("../../assets/images/drones/dji-inspire-2.png"),
};

const MODEL_TO_KEY: Array<[RegExp, string]> = [
  [/avata\s*360/i,     "dji-avata-360"],
  [/avata\s*2/i,       "dji-avata-2"],
  [/avata/i,           "dji-avata"],
  [/neo\s*2/i,         "dji-neo-2"],
  [/neo/i,             "dji-neo"],
  [/mini\s*5/i,        "dji-mini-5"],
  [/mini\s*4\s*k/i,    "dji-mini-4k"],
  [/mini\s*4/i,        "dji-mini-4"],
  [/mini\s*3/i,        "dji-mini-3"],
  [/mini\s*2/i,        "dji-mini-2"],
  [/mini\s*se|mavic\s*mini/i, "dji-mini-se"],
  [/air\s*3\s*s/i,     "dji-air-3s"],
  [/air\s*3/i,         "dji-air-3"],
  [/air\s*2\s*s|mavic\s*air\s*2/i, "dji-air-2s"],
  [/mavic\s*4\s*pro/i, "dji-mavic-4-pro"],
  [/inspire\s*3/i,     "dji-inspire-3"],
  [/inspire\s*2/i,     "dji-inspire-2"],
  [/agras/i,           "dji-agras-t50"],
  [/^\s*(dji\s*)?fpv\s*$/i, "dji-fpv"],
  [/lito\s*1/i,        "dji-lito-1"],
  [/flip/i,            "dji-flip"],
  [/fly\s*cart/i,      "dji-flycart-30"],
];

export function getDroneImage(
  manufacturer: string | undefined,
  model: string | undefined
): ImageSourcePropType | null {
  const mfr = (manufacturer ?? "").toLowerCase();
  const mdl = (model ?? "").toLowerCase();
  if (mfr && !mfr.includes("dji")) return null;

  const search = mdl || mfr;
  for (const [regex, key] of MODEL_TO_KEY) {
    if (regex.test(search)) return IMAGES[key] ?? null;
  }
  return null;
}
