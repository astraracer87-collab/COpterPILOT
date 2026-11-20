// Herstellerlogos (assets/images/logos). Fehlt ein Logo, zeigt die App den
// Herstellernamen als Schriftzug (siehe ManufacturerBadge).
import type { ImageSourcePropType } from "react-native";

/** Logos je Hersteller (Schlüssel: normalisierter Name, siehe manufacturerKey) */
const LOGOS: Record<string, ImageSourcePropType> = {
  dji: require("../../assets/images/logos/logo-dji.png"),
  betafpv: require("../../assets/images/logos/logo-betafpv.png"),
  autel: require("../../assets/images/logos/logo-autel.png"),
  antigravity: require("../../assets/images/logos/logo-antigravity.png"),
  hoverair: require("../../assets/images/logos/logo-hoverair.png"),
  potensic: require("../../assets/images/logos/logo-potensic.png"),
};

export function manufacturerKey(name: string | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getManufacturerLogo(name: string | undefined): ImageSourcePropType | null {
  const k = manufacturerKey(name);
  return k ? (LOGOS[k] ?? null) : null;
}

/** Einfarbige Logos: werden in der Textfarbe eingefärbt (hell/dunkel) */
const MONOCHROME = new Set(["dji", "antigravity", "hoverair", "potensic"]);
export function isMonochromeLogo(name: string | undefined): boolean {
  return MONOCHROME.has(manufacturerKey(name));
}
