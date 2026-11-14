import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getKpAssessment, getKpForHour, getKpLabel, getKpRiskLabel } from "../kpindex";

describe("Kp-Farbskala und Hinweise", () => {
  it("ordnet 0–2 grün und 3–4 gelb ein", () => {
    assert.equal(getKpAssessment(2.99).color, "#34C759");
    assert.equal(getKpAssessment(3).color, "#FFD60A");
    assert.equal(getKpAssessment(4.99).color, "#FFD60A");
    assert.equal(getKpLabel(3), "Erhöht");
  });

  it("ordnet Kp 5 orange und ab 6 rot ein", () => {
    assert.equal(getKpAssessment(5).color, "#FF9500");
    assert.equal(getKpAssessment(5.99).color, "#FF9500");
    assert.equal(getKpAssessment(6).color, "#FF3B30");
    assert.equal(getKpAssessment(8).color, "#FF3B30");
    assert.equal(getKpLabel(5), "Stark erhöht");
    assert.equal(getKpLabel(6), "Sturm");
  });

  it("formuliert Störungen ab Kp 5 als möglich, nicht als sicher", () => {
    assert.equal(getKpRiskLabel(2), "Ruhig");
    assert.equal(getKpRiskLabel(4), "Erhöht");
    assert.equal(getKpRiskLabel(5), "Störungen möglich");
    const kp5Text = getKpAssessment(5).description.toLowerCase();
    const kp6Text = getKpAssessment(6).description.toLowerCase();
    assert.ok(kp5Text.includes("auftreten") && kp5Text.includes("aber nicht"));
    assert.ok(kp6Text.includes("nicht sicher"));
  });

  it("verwendet für einen geplanten Flug keine weit entfernte Prognose", () => {
    const timeline = [
      { timestamp: "2026-10-09T12:00:00Z", value: 5 },
      { timestamp: "2026-10-09T15:00:00Z", value: 6 },
    ];
    assert.equal(getKpForHour(timeline, new Date("2026-10-09T13:30:00Z"), 3 * 60 * 60 * 1000), 5);
    assert.equal(getKpForHour(timeline, new Date("2026-10-11T12:00:00Z"), 3 * 60 * 60 * 1000), null);
    assert.equal(getKpForHour(timeline, new Date("2026-10-11T12:00:00Z")), 6);
  });
});
