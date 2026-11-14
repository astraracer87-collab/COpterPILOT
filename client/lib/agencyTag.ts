import { AircraftState } from "@/lib/opensky";

/**
 * Classifies an aircraft into a behördliche Kennzeichnung (agency tag) based on
 * military flag, operator name, callsign and registration heuristics.
 *
 * Single source of truth shared by all live traffic views so that the same
 * Militär / Polizei / Rettung / Küstenwache / Anonymisiert badges show up
 * regardless of which screen the user entered from.
 */
export function getAgencyTag(ac: AircraftState): string | undefined {
  const cs = (ac.callsign || "").trim().toUpperCase();
  const op = (ac.operator || "").toLowerCase();
  const cn = (ac.cn || "").toUpperCase();
  if (ac.military) return "Militär";
  if (cn === "POL" || /polizei|police|bundespolizei|bpol|gendarm/i.test(op) || /^IBIS\d|^PHX\d|^PIROL\d/.test(cs)) return "Polizei";
  if (/feuerwehr|fire|rettung|rescue|drf|adac|christoph|sar/i.test(op) || /^CHRISTOPH|^CHX\d|^DRF\d|^SAR\d/.test(cs)) return "Rettung";
  if (/coast.?guard|coastguard|kustwacht|k(ü|u)stenwache|garde.?c(ô|o)ti(è|e)re|douane|guardia.?costera|guardia.?costiera|guarda.?costeira|landhelgisg|frontex/i.test(op) || /^(NCG|COBRA|FNGC|ICEGUARD|RESCUE|PROTECTOR|FRONTEX)\s?\d/.test(cs) || /^TF-?(SIF|GNA|LIF)/.test(cs)) return "Küstenwache";
  if (ac.pia || ac.ladd) return "Anonymisiert";
  return undefined;
}

/**
 * Badge background color for a given agency tag. Single source of truth shared
 * by the native map info bubble and the (web-visible) aircraft list cards so the
 * Behörden-Kennzeichnung looks identical regardless of platform / view mode.
 */
export function agencyTagColor(tag: string): string {
  switch (tag) {
    case "Küstenwache":
      return "rgba(0,150,136,0.9)";
    default:
      return "rgba(0,122,255,0.85)";
  }
}
