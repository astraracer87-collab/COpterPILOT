import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DFLIGHT_ITALY_GUIDE } from "../dflightItalyGuide";
import { getCountryRuleSet } from "../countryCompliance";
import type { ComplianceItem } from "../countryCompliance";

// Diese Suite schützt den In-App-Anleitungsinhalt zur D-Flight-/ENAC-
// Registrierung für Italien und seine Verknüpfung mit den IT-Compliance-
// Hinweisen. Sie soll vor Drift bewahren: die Anleitung muss vollständig
// bleiben (nummerierte Schritte mit Details, Hinweise, Portal-Link) und darf
// keine Emojis enthalten; die IT-Items it_dflight und it_hint_registration
// müssen weiterhin per guide==="dflight-it" auf die Anleitung verweisen.

// Erfasst die gängigen Emoji-Unicode-Bereiche (inkl. Symbole, Piktogramme,
// Transport, Flaggen und Variation-Selectors).
const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/u;

function collectGuideStrings(): string[] {
  const g = DFLIGHT_ITALY_GUIDE;
  const out: string[] = [
    g.title,
    g.subtitle,
    g.intro,
    g.portalUrl,
    g.portalLabel,
    g.sourceNote,
    ...g.notes,
  ];
  for (const step of g.steps) {
    out.push(step.title, ...step.details);
  }
  return out;
}

describe("DFLIGHT_ITALY_GUIDE Vollständigkeit", () => {
  it("hat Titel, Untertitel und Intro", () => {
    assert.ok(DFLIGHT_ITALY_GUIDE.title.length > 0, "title fehlt");
    assert.ok(DFLIGHT_ITALY_GUIDE.subtitle.length > 0, "subtitle fehlt");
    assert.ok(DFLIGHT_ITALY_GUIDE.intro.length > 0, "intro fehlt");
  });

  it("hat mehrere nummerierbare Schritte mit Details", () => {
    assert.ok(
      DFLIGHT_ITALY_GUIDE.steps.length >= 5,
      `erwartet >= 5 Schritte, gefunden ${DFLIGHT_ITALY_GUIDE.steps.length}`,
    );
    DFLIGHT_ITALY_GUIDE.steps.forEach((step, i) => {
      assert.ok(step.title.length > 0, `Schritt ${i + 1}: title fehlt`);
      assert.ok(
        step.details.length > 0,
        `Schritt ${i + 1}: keine details`,
      );
      step.details.forEach((d, j) =>
        assert.ok(d.length > 0, `Schritt ${i + 1}.${j + 1}: leerer Detail-Text`),
      );
    });
  });

  it("hat Hinweise (notes)", () => {
    assert.ok(
      DFLIGHT_ITALY_GUIDE.notes.length > 0,
      "keine notes hinterlegt",
    );
    DFLIGHT_ITALY_GUIDE.notes.forEach((n, i) =>
      assert.ok(n.length > 0, `note ${i + 1} ist leer`),
    );
  });

  it("verlinkt das D-Flight-Portal per https-URL", () => {
    assert.ok(
      DFLIGHT_ITALY_GUIDE.portalUrl.startsWith("https://"),
      `portalUrl ist keine https-URL: ${DFLIGHT_ITALY_GUIDE.portalUrl}`,
    );
    assert.ok(
      /d-flight\.it/.test(DFLIGHT_ITALY_GUIDE.portalUrl),
      `portalUrl verweist nicht auf d-flight.it: ${DFLIGHT_ITALY_GUIDE.portalUrl}`,
    );
    assert.ok(
      DFLIGHT_ITALY_GUIDE.portalLabel.length > 0,
      "portalLabel fehlt",
    );
  });

  it("enthält keine Emojis", () => {
    for (const s of collectGuideStrings()) {
      assert.ok(
        !EMOJI_PATTERN.test(s),
        `Emoji gefunden in: ${JSON.stringify(s)}`,
      );
    }
  });
});

describe("IT-Compliance-Items verweisen auf die Anleitung", () => {
  const ruleSet = getCountryRuleSet("IT");

  it("Italien-Regelsatz existiert", () => {
    assert.ok(ruleSet, "kein Regelsatz für IT gefunden");
  });

  it("it_dflight (Regel ohne hinterlegtes Dokument) hat guide==='dflight-it'", () => {
    // Drohne ohne dflightDocument auslösen, damit die Regel das Item liefert.
    const drone = {} as Parameters<(typeof ruleSet)["rules"][number]>[0];
    const pilot = {} as Parameters<(typeof ruleSet)["rules"][number]>[1];
    const items = ruleSet!.rules
      .map((rule) => rule(drone, pilot))
      .filter((item): item is ComplianceItem => item != null);
    const dflight = items.find((item) => item.id === "it_dflight");
    assert.ok(dflight, "it_dflight wurde nicht erzeugt");
    assert.equal(
      dflight!.guide,
      "dflight-it",
      "it_dflight verweist nicht auf die Anleitung",
    );
  });

  it("it_hint_registration hat guide==='dflight-it'", () => {
    const reg = ruleSet!.fixedHints.find(
      (hint) => hint.id === "it_hint_registration",
    );
    assert.ok(reg, "it_hint_registration nicht gefunden");
    assert.equal(
      reg!.guide,
      "dflight-it",
      "it_hint_registration verweist nicht auf die Anleitung",
    );
  });
});
