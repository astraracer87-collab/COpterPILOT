import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRestrictionSessionPatch, restrictionAssessmentInput } from "../manualRestrictionFlow";

// Review-Fix 1: Einschränkungs-Ergebnis -> Flug-Session -> Gesamturteil.
describe("buildRestrictionSessionPatch", () => {
  it("aus der Einschränkungs-Stufe: alle drei Felder explizit (auch undefined)", () => {
    const p = buildRestrictionSessionPatch({ hasRestrictions: true, restrictionNotes: "Notiz" });
    assert.deepEqual(Object.keys(p).sort(), ["hasRestrictions", "restrictionNotes", "restrictionStatus"]);
    assert.equal(p.hasRestrictions, true);
    assert.equal(p.restrictionStatus, undefined);
    assert.equal(p.restrictionNotes, "Notiz");
  });

  it("manuelle Angabe 'limited' ohne erkannte Zone zählt als Einschränkung", () => {
    const p = buildRestrictionSessionPatch({ hasRestrictions: false, restrictionStatus: "limited" });
    assert.equal(p.hasRestrictions, true);
  });

  it("ohne Params (Direkteinstieg) bleibt die Session unverändert", () => {
    assert.deepEqual(buildRestrictionSessionPatch({}), {});
  });

  it("restrictionAssessmentInput liest die gespeicherten Werte", () => {
    assert.deepEqual(restrictionAssessmentInput({ hasRestrictions: true }), { hasRestrictions: true, restrictionStatus: undefined });
    assert.deepEqual(restrictionAssessmentInput(null), { hasRestrictions: false, restrictionStatus: undefined });
  });
});
