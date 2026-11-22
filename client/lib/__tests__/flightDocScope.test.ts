import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveFlightTimeDocuments } from "../../../shared/archivedDocuments";

const profile = {
  allgemeinverfuegung: [{ bundesland: "Hessen", expirationDate: "2030-01-01", document: null }],
  documentArchive: [],
};

describe("AV nur im passenden Bundesland", () => {
  it("Flug im Ausland: keine Hessen-AV", () => {
    const docs = resolveFlightTimeDocuments(profile as never, { flightDateISO: "2026-11-22", outsideGermany: true });
    assert.equal(docs.filter((d) => d.type === "av").length, 0);
  });
  it("Flug in Bayern: keine Hessen-AV", () => {
    const docs = resolveFlightTimeDocuments(profile as never, { flightDateISO: "2026-11-22", bundesland: "Bayern" });
    assert.equal(docs.filter((d) => d.type === "av").length, 0);
  });
  it("Flug in Hessen: Hessen-AV", () => {
    const docs = resolveFlightTimeDocuments(profile as never, { flightDateISO: "2026-11-22", bundesland: "Hessen" });
    assert.equal(docs.filter((d) => d.type === "av").length, 1);
  });
});
