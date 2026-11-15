import assert from "node:assert/strict";
import { getInfrastructureFlightGuidance, infrastructureFlightGuidanceText } from "../../../shared/energyInfrastructureFlightRules";
import { supplementalInfrastructureAsGeozones } from "../energyInfrastructureZones";
import { computeGeozoneTabSeverity, isProhibitionZone } from "../geozoneSeverity";
import type { GermanEnergyInfrastructureItem, InfrastructureKind } from "../../../shared/germanEnergyInfrastructure";
// Die HTML-Popup-Darstellung (buildEd269PopupHtml) gehörte zur Web-App der
// Replit-Fassung und ist nicht Teil dieses Repos. Die Darstellung in der App
// prüft client/components/__tests__/InfrastructureFlightGuidance.test.tsx.

const item: GermanEnergyInfrastructureItem = {
  id: "foreign", kind: "wind_turbine", name: "Anlage", source: "OpenStreetMap",
  geometry: { type: "Point", coordinates: [8, 50] },
  officialMatch: "not_found", distanceMeters: 10, taggedHeightM: 190,
};
const cases = [
  { iso: "BE", positive: /Droneguide.*OPEN und SPECIFIC/s, negative: /allein belegt keine solche Zone/, source: "mobilit.belgium.be" },
  { iso: "CH", positive: /Netzebene 2.*750 m.*Ausnahmen/s, negative: /weder Netzebene 2.*keine pauschale/s, source: "fedlex.admin.ch" },
  { iso: "FR", positive: /Art\. 4 Nr\. 3.*Zustimmung/s, negative: /belegt weder diese Kennzeichnung noch eine Genehmigungspflicht/, source: "legifrance.gouv.fr" },
  { iso: "LU", positive: /vorherige Genehmigung oder eine Meldung/, negative: /allein belegt keine dieser Anforderungen/, source: "legilux.public.lu" },
  { iso: "NL", positive: /150 m.*Stromübertragungssystems/s, negative: /Nicht pauschal auf Verteilungsleitungen oder jede Windanlage/, source: "wetten.overheid.nl" },
];
for (const { iso, positive, negative, source } of cases) {
  for (const kind of ["wind_turbine", "power_line", "power_mast"] as InfrastructureKind[]) {
    const record = { ...item, kind, ...(kind === "power_line" ? { geometry: { type: "LineString", coordinates: [[8, 50], [8.1, 50]] } } : {}) };
    const [zone] = supplementalInfrastructureAsGeozones(iso, [record]);
    const guidance = zone.infrastructureFlightGuidance!;
    assert.ok(guidance, `${iso}/${kind} has verified legal guidance`);
    assert.match(zone.applicationText!, positive, iso);
    assert.match(zone.applicationText!, negative, `${iso} never presumes a legal classification`);
    assert.match(zone.applicationText!, /sperrt die Flugplanung nicht und gibt sie nicht frei/);
    assert.doesNotMatch(zone.applicationText!, /§\s*21h/);
    assert.equal(zone.informationalOnly, true);
    assert.equal(zone.restriction, "NO_RESTRICTION", "informational hint is policy info only");
    assert.equal(zone.upperMeters, undefined);
    assert.equal(zone.lowerMeters, undefined);
    assert.deepEqual(zone.polygonGroups, []);
    assert.deepEqual(zone.infrastructureGeometry, record.geometry);
    assert.equal(isProhibitionZone(zone), false);
    assert.equal(computeGeozoneTabSeverity([zone], {
      isCoveredByAV: () => { throw Error("No legal gating for an infrastructure hint"); },
    }), "blue");
    assert.equal(guidance.checkedOn, "2026-10-12");
    assert.ok(zone.links?.some((link) => link.url.includes(source)));
    for (const rule of guidance.rules) {
      assert.ok(rule.condition && rule.legalBasis && rule.sources.length);
      assert.match(rule.condition, /^Nur/);
      rule.sources.forEach((link) => assert.match(link.url, /^https:\/\//));
    }
    const obstacle = guidance.rules.find((rule) => rule.id.endsWith("-obstacle"));
    assert.equal(!!obstacle, kind !== "power_line", "a line does not have a proven obstacle-top height");
    if (obstacle) {
      assert.match(obstacle.condition, /höher als 105 m.*50 m.*auf Antrag/);
      assert.match(obstacle.guidance, /15 m.*nachgewiesen.*Keine automatische Freigabe/s);
    }
    const a3 = guidance.rules.find((rule) => rule.id.endsWith("-A3"))!;
    assert.match(a3.condition, /Nur beim Betrieb in A3/);
    assert.match(a3.guidance, /150 m/);
    assert.match(a3.guidance, /einzelne Anlage allein|kein pauschaler/);
  }
  assert.deepEqual(supplementalInfrastructureAsGeozones(iso, [
    { ...item, officialMatch: "unknown" }, { ...item, officialMatch: "matched" },
  ]), [], `${iso}: unchanged source comparison gate`);
  const [low] = supplementalInfrastructureAsGeozones(iso, [{ ...item, taggedHeightM: 90, operatorName: "Betreiber" }]);
  assert.equal(low.upperMeters, undefined, "height/name alone cannot grant an exception");
  assert.equal(low.restriction, "NO_RESTRICTION", "low height cannot grant clearance either");
}
assert.equal(getInfrastructureFlightGuidance("DE", "wind_turbine"), undefined, "German adapter remains separate");
assert.equal(getInfrastructureFlightGuidance("AT", "power_mast"), undefined, "do not expand country scope");
assert.equal(getInfrastructureFlightGuidance("DK", "power_line"), undefined);
assert.equal(getInfrastructureFlightGuidance("XX", "power_line"), undefined);
assert.equal(getInfrastructureFlightGuidance("nl", "power_line")?.rules[0].id, "NL-transmission");
const nl = getInfrastructureFlightGuidance("NL", "power_mast")!;
assert.match(infrastructureFlightGuidanceText(nl), /keine Freigabe allein durch Betreiberzustimmung/);
assert.match(nl.rules[0].legalBasis, /Energiewet.*1\. Januar 2026/);
assert.match(infrastructureFlightGuidanceText(getInfrastructureFlightGuidance("CH", "wind_turbine")!), /10 oder mehr.*100 m/);
console.log("Country-specific infrastructure guidance: positive/negative scope, and safe planning semantics passed");
