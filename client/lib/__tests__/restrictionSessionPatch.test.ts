import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRestrictionSessionPatch } from "../manualRestrictionFlow";
import { storedChecksFor } from "../flightChecks";
import { aggregate } from "../../../shared/checks";

// Review-Fix 1: Einschränkungs-Ergebnis -> Flug-Session -> Gesamturteil.
describe("buildRestrictionSessionPatch", () => {
  it("aus der Einschränkungs-Stufe: alle Felder explizit (auch undefined)", () => {
    const p = buildRestrictionSessionPatch({ hasRestrictions: true, restrictionNotes: "Notiz" });
    assert.deepEqual(Object.keys(p).sort(), ["hasRestrictions", "restrictionNotes", "restrictionStatus", "restrictionVerdict"]);
    assert.equal(p.restrictionVerdict, undefined);
    assert.equal(p.hasRestrictions, true);
    assert.equal(p.restrictionStatus, undefined);
    assert.equal(p.restrictionNotes, "Notiz");
  });

  it("manuelle Angabe 'limited' ohne erkannte Zone zählt als Einschränkung", () => {
    const p = buildRestrictionSessionPatch({ hasRestrictions: false, restrictionStatus: "limited" });
    assert.equal(p.hasRestrictions, true);
  });

  it("Policy-Urteil (B2) wird gespeichert; ein veraltetes nogo wird überschrieben", () => {
    assert.equal(buildRestrictionSessionPatch({ hasRestrictions: true, restrictionVerdict: "nogo" }).restrictionVerdict, "nogo");
    const cleared = buildRestrictionSessionPatch({ hasRestrictions: false });
    assert.ok("restrictionVerdict" in cleared);
    assert.equal(cleared.restrictionVerdict, undefined);
  });

  it("ohne Params (Direkteinstieg) bleibt die Session unverändert", () => {
    assert.deepEqual(buildRestrictionSessionPatch({}), {});
  });

  // B4: restrictionAssessmentInput entfällt – PlanningResult liest die
  // gespeicherten Felder über storedChecksFor (Rückfall ohne CheckResults).
  it("storedChecksFor leitet aus den gespeicherten Feldern dasselbe Urteil ab", () => {
    assert.equal(aggregate(storedChecksFor({ hasRestrictions: true }, "planning")).verdict, "caution");
    assert.equal(aggregate(storedChecksFor(null, "planning")).verdict, "go");
    assert.equal(aggregate(storedChecksFor({ hasRestrictions: true, restrictionVerdict: "nogo" }, "planning")).verdict, "nogo");
    assert.equal(aggregate(storedChecksFor({ hasRestrictions: true, restrictionStatus: "approved" }, "planning")).verdict, "go");
  });
});
