// Schnellauswahl Standard-Kits für „Vorhandene ND-Filter“ (Drohne einrichten).
// Die Hervorhebung eines Kit-Chips wird ausschließlich aus der aktuellen
// Auswahl abgeleitet: hervorgehoben ist genau das Kit, dessen Filtermenge der
// Auswahl exakt entspricht – bei leerer oder abweichender Auswahl keines.

export interface NdKit {
  id: string;
  label: string;
  filters: string[];
}

export const DJI_STANDARD_KIT: NdKit = { id: "dji-standard", label: "DJI-Standard", filters: ["ND8", "ND32", "ND128"] };
export const FPV_STANDARD_KIT: NdKit = { id: "fpv-standard", label: "FPV-Standard", filters: ["ND8", "ND16", "ND32"] };

/** Kits in Anzeigereihenfolge; das Hersteller-Set des Presets (falls vorhanden) zuerst. */
export function buildNdKits(preset?: { model: string; filterEcosystem?: string[] | null } | null): NdKit[] {
  const kits: NdKit[] = [];
  if (preset?.filterEcosystem && preset.filterEcosystem.length > 0) {
    kits.push({ id: "preset", label: `${preset.model}-Set`, filters: [...preset.filterEcosystem] });
  }
  kits.push(DJI_STANDARD_KIT, FPV_STANDARD_KIT);
  return kits;
}

export function sameNdSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** id des Kits, das der Auswahl exakt entspricht; null bei leerer/abweichender Auswahl. */
export function activeNdKitId(selected: readonly string[], kits: readonly NdKit[]): string | null {
  if (selected.length === 0) return null;
  return kits.find((k) => sameNdSet(k.filters, selected))?.id ?? null;
}

/** Kit antippen: Auswahl wird genau auf die Filter des Kits gesetzt. */
export function applyNdKitSelection(kit: NdKit): string[] {
  return [...kit.filters];
}
