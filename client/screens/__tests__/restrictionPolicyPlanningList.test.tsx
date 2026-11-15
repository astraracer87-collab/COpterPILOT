/**
 * B2: Planungsliste über die Policy-Tabelle – mit der ECHTEN DE-AV-Logik
 * (isDe21hZoneAvEligible aus storage.ts, nur unter Jest importierbar).
 *  - REQ_AUTHORISATION (DE Wohngrundstücke/Bahn) wird durch die Landes-AV
 *    gedeckt – nur in DE, nie für ausländische Zonen gleicher Bezeichnung.
 *  - ED-R (RESTRICTED) und CTR sind nie AV-gedeckt.
 *  - DE-Temporär (PROHIBITED) → NO-GO, außer mit Begründung.
 *  - NO_RESTRICTION → nur Info, keine Bestätigung.
 *  - Radar-Reiter und Liste ergeben für dieselbe Zone dieselbe Farbe.
 */
import { isDe21hZoneAvEligible } from "@/lib/storage";
import { dipulZoneFromFeature } from "@/lib/geozoneQueries";
import { classifyPlanningZones } from "@/lib/restrictionPlanning";
import { computeGeozoneTabSeverity } from "@/lib/geozoneSeverity";
import { RESTRICTION_POLICY, zonePolicy } from "../../../shared/restrictionPolicy";
import type { GeozoneFeatureInfo } from "../../../shared/geozoneFeatureInfo";

const SQUARE = { type: "Polygon", coordinates: [[[13.4, 52.5], [13.41, 52.5], [13.41, 52.51], [13.4, 52.51], [13.4, 52.5]]] };

function deZone(layer: string, label: string, props: Record<string, unknown> = {}): GeozoneFeatureInfo {
  const z = dipulZoneFromFeature(
    { id: `${layer}.1`, geometry: SQUARE, properties: { name: `${label} Test`, ...props } },
    { id: layer, wmsLayer: layer, label, defaultEnabled: true },
  );
  if (!z) throw new Error("keine Zone");
  return z;
}

// Wie PlanningRestrictionsScreen.isGeozoneCoveredByAV bei gültiger A2 + Landes-AV.
const coveredWithAv = (gz: GeozoneFeatureInfo) => zonePolicy(gz).coverableByAuthorisation && isDe21hZoneAvEligible(gz);

describe("Planungsliste (Policy) mit DE-Landes-AV", () => {
  it("REQ_AUTHORISATION: DE Wohngrundstücke/Bahn AV-gedeckt, CTR/Naturschutz nicht", () => {
    const wohn = deZone("wohngrundstuecke", "Wohngrundstücke");
    const bahn = deZone("bahnanlagen", "Bahnanlagen");
    const ctr = deZone("kontrollzonen", "Kontrollzonen (CTR)");
    const natur = deZone("naturschutzgebiete", "Naturschutzgebiete");
    for (const z of [wohn, bahn, ctr, natur]) expect(z.restriction).toBe("REQ_AUTHORISATION");
    const c = classifyPlanningZones([wohn, bahn, ctr, natur], { isCoveredByAV: coveredWithAv });
    expect(c.coveredZones).toEqual([wohn, bahn]);
    expect(c.uncoveredZones).toEqual([ctr, natur]);
    expect(c.confirmationZones).toEqual([ctr, natur]);
    expect(c.verdict).toBe("caution");
    // Ohne gültige AV ist nichts gedeckt.
    const none = classifyPlanningZones([wohn], { isCoveredByAV: () => false });
    expect(none.uncoveredZones).toEqual([wohn]);
  });

  it("ausländische REQ_AUTHORISATION-Zone mit DE-Bezeichnung ist nie AV-gedeckt", () => {
    const foreign: GeozoneFeatureInfo = { ...deZone("bahnanlagen", "Bahnanlagen"), country: "CZ" };
    const c = classifyPlanningZones([foreign], { isCoveredByAV: coveredWithAv });
    expect(c.coveredZones).toEqual([]);
    expect(c.uncoveredZones).toEqual([foreign]);
  });

  it("ED-R (RESTRICTED) ist nie AV-gedeckt und verlangt Bestätigung", () => {
    const edr = deZone("flugbeschraenkungsgebiete", "Flugbeschränkungsgebiete (ED-R)");
    expect(edr.restriction).toBe("RESTRICTED");
    const c = classifyPlanningZones([edr], { isCoveredByAV: () => true });
    expect(c.confirmationZones).toEqual([edr]);
    expect(c.verdict).toBe("caution");
  });

  it("DE-Temporär (PROHIBITED) → NO-GO, mit Begründung CAUTION", () => {
    const temp = deZone("temporaere_betriebseinschraenkungen", "Temporäre Beschränkungen");
    expect(temp.restriction).toBe("PROHIBITED");
    expect(classifyPlanningZones([temp], { isCoveredByAV: coveredWithAv }).verdict).toBe("nogo");
    expect(
      classifyPlanningZones([temp], { isCoveredByAV: coveredWithAv, overrideReason: () => "Genehmigung Polizei Az. 7" }).verdict,
    ).toBe("caution");
  });

  it("NO_RESTRICTION → nur Info ohne Bestätigung", () => {
    const info: GeozoneFeatureInfo = { layerLabel: "Info", name: "Info-Zone", details: "", restriction: "NO_RESTRICTION", country: "AT" };
    const c = classifyPlanningZones([info], { isCoveredByAV: coveredWithAv });
    expect(c.infoZones).toEqual([info]);
    expect(c.confirmationZones).toEqual([]);
    expect(c.verdict).toBe("info");
    expect(c.assessment(info).policy.color).toBe(RESTRICTION_POLICY.NO_RESTRICTION.color);
  });

  it("Radar-Reiter = Listenbewertung für dieselbe DE-Zone (mit/ohne AV)", () => {
    const zones = [
      deZone("wohngrundstuecke", "Wohngrundstücke"),
      deZone("kontrollzonen", "Kontrollzonen (CTR)"),
      deZone("flugplaetze", "Flugplätze"),
      deZone("flugbeschraenkungsgebiete", "Flugbeschränkungsgebiete (ED-R)"),
      deZone("temporaere_betriebseinschraenkungen", "Temporäre Beschränkungen"),
    ];
    for (const av of [true, false]) {
      const isCoveredByAV = av ? coveredWithAv : () => false;
      for (const z of zones) {
        const tab = computeGeozoneTabSeverity([z], { isCoveredByAV });
        const list = classifyPlanningZones([z], { isCoveredByAV }).assessment(z);
        expect([z.layerLabel, av, tab]).toEqual([z.layerLabel, av, list.tab]);
      }
    }
    // Wohngrundstücke: ohne AV rot (wie bisher), mit AV orange.
    expect(computeGeozoneTabSeverity([zones[0]], { isCoveredByAV: () => false })).toBe("red");
    expect(computeGeozoneTabSeverity([zones[0]], { isCoveredByAV: coveredWithAv })).toBe("orange");
    // Flugplätze („bedingt zulässig“) bleiben orange.
    expect(computeGeozoneTabSeverity([zones[2]], { isCoveredByAV: () => false })).toBe("orange");
  });
});
