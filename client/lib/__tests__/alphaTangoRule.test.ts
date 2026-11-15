// B7 (Review I7): EINE Regel für „AlphaTango fehlt“ – Compliance-Liste
// (fr_alphatango), Drohnenliste (getAlphaTangoFrStatus) und Planungssperre
// (PlanningRestrictionsScreen → isAlphaTangoMissing) urteilen gleich.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  alphaTangoRequirementReason,
  checkCountryCompliance,
  getAlphaTangoFrStatus,
  isAlphaTangoMissing,
} from "../countryCompliance";
import type { DroneProfile, PilotProfile } from "@/lib/storage";

const drone = (o: Record<string, unknown>): DroneProfile =>
  ({
    name: "D",
    mtomGrams: 500,
    hasRemoteId: false,
    classMark: "legacy",
    alphaTangoDocument: null,
    dflightDocument: null,
    compliance: { remoteIdConfigured: false },
    ...o,
  }) as unknown as DroneProfile;

const pilot = {
  operatorId: "FR1",
  operatorRegistered: true,
  licenseA1A3: true,
  licenseA2: true,
  insuranceActive: true,
  countrySpecific: {},
} as unknown as PilotProfile;

const hasFrItem = (d: DroneProfile) => checkCountryCompliance(d, pilot, "FR").items.some((i) => i.id === "fr_alphatango");

describe("AlphaTango – eine Quelle für Pflicht und Erledigt", () => {
  const cases: [string, DroneProfile, boolean][] = [
    ["< 800 g ohne Remote-ID", drone({}), false],
    ["≥ 800 g ohne Bestätigung", drone({ mtomGrams: 900 }), true],
    ["≥ 800 g mit FRA-Nummer, ohne Bestätigung (Sperre jetzt wie Liste)", drone({ mtomGrams: 900, alphaTangoId: "UAS-FR-1" }), true],
    ["≥ 800 g mit Bestätigung", drone({ mtomGrams: 900, alphaTangoDocument: "doc" }), false],
    ["< 800 g mit Remote-ID (Sperre jetzt wie Liste)", drone({ hasRemoteId: true }), true],
    ["< 800 g mit externem Remote-ID-Modul", drone({ compliance: { remoteIdConfigured: true } }), true],
  ];
  for (const [label, d, missing] of cases) {
    it(label, () => {
      assert.equal(isAlphaTangoMissing(d), missing);
      assert.equal(hasFrItem(d), missing, "Compliance-Liste urteilt gleich");
      assert.equal(getAlphaTangoFrStatus(d) === "required-open", missing, "Drohnenliste urteilt gleich");
    });
  }

  it("Begründung nennt Gewicht bzw. Remote-ID", () => {
    assert.match(alphaTangoRequirementReason(drone({ mtomGrams: 900 })), /900 g/);
    assert.match(alphaTangoRequirementReason(drone({ hasRemoteId: true })), /Remote-ID/);
  });
});
