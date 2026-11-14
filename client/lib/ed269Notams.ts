import type { DipulTempRestriction, GeozoneFeatureInfo } from "@/lib/geozones";

const NOTAM_VALIDITY_MAX_MS = 30 * 86400000;

export function ed269ZonesToNotamRestrictions(
  zones: GeozoneFeatureInfo[],
): DipulTempRestriction[] {
  const now = Date.now();
  const out: DipulTempRestriction[] = [];
  for (const z of zones) {
    const vs = z.validStartTs;
    const ve = z.validEndTs;
    if (!z.notamEligible && (vs == null || ve == null)) continue;
    if (!z.notamEligible && ve! - vs! >= NOTAM_VALIDITY_MAX_MS) continue;
    if (ve != null && ve < now) continue;

    let centerLat: number | null = null;
    let centerLon: number | null = null;
    const ring = z.polygonGroups?.[0]?.[0] ?? z.polygonRings?.[0];
    if (ring && ring.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const [lon, lat] of ring) {
        sx += lon;
        sy += lat;
      }
      centerLon = sx / ring.length;
      centerLat = sy / ring.length;
    }

    out.push({
      id: `ed269-${z.country ?? ""}-${z.featureId ?? z.name}`,
      extRef: z.featureId ?? "",
      name: z.name || "Geozone",
      names: [z.name].filter(Boolean) as string[],
      genNames: [],
      type: "N",
      legalRef: "",
      legalExplanation: z.details || "",
      category: "notam",
      lowerAlt: z.lowerMeters ?? 0,
      lowerAltRef: "",
      lowerAltUnit: "m",
      upperAlt: z.upperMeters ?? 0,
      upperAltRef: "",
      upperAltUnit: "m",
      status: vs == null || vs <= now ? "active" : "upcoming",
      startTs: vs == null ? null : new Date(vs).toISOString(),
      endTs: ve == null ? null : new Date(ve).toISOString(),
      endTsIndefinite: false,
      validityUnknown: z.notamEligible && (vs == null || ve == null),
      recurRules: null,
      scheduleText: z.scheduleText,
      centerLat,
      centerLon,
      radiusM: null,
      polygonRings: z.polygonRings ?? null,
      polygonGroups: z.polygonGroups ?? null,
    });
  }
  return out;
}

export function formatBelgianNotamValidityRange(
  restriction: Pick<
    DipulTempRestriction,
    "id" | "startTs" | "endTs" | "endTsIndefinite" | "validityUnknown"
  >,
): string | null {
  if (!restriction.id.toLowerCase().startsWith("ed269-be-")) return null;
  if (restriction.validityUnknown) {
    return "Gültigkeit im Quelldatensatz nicht angegeben";
  }

  const format = (value: string) =>
    new Date(value).toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels",
    });
  const start = restriction.startTs ? format(restriction.startTs) : null;
  const end = restriction.endTs ? format(restriction.endTs) : null;

  if (start && end) return `${start} — ${end} (Ortszeit Belgien)`;
  if (start && restriction.endTsIndefinite) {
    return `${start} — unbefristet (Ortszeit Belgien)`;
  }
  if (start) return `Ab ${start} (Ortszeit Belgien)`;
  if (end) return `Bis ${end} (Ortszeit Belgien)`;
  return "";
}
