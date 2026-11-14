import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isValidSetupGuideStatus,
  setupGuideKey,
  shouldOfferSetupGuide,
  SETUP_GUIDE_KEY_PREFIX,
} from "../setupGuideKey";

describe("setupGuideKey (mobile)", () => {
  it("hängt die User-ID an den Basis-Schlüssel an", () => {
    assert.equal(setupGuideKey("user-a"), `${SETUP_GUIDE_KEY_PREFIX}:user-a`);
  });

  it("nutzt ohne User-ID nur den Basis-Schlüssel", () => {
    assert.equal(setupGuideKey(null), SETUP_GUIDE_KEY_PREFIX);
    assert.equal(setupGuideKey(undefined), SETUP_GUIDE_KEY_PREFIX);
  });

  it("trennt verschiedene Konten in verschiedene Schlüssel", () => {
    assert.notEqual(setupGuideKey("user-a"), setupGuideKey("user-b"));
    // Der anonyme Schlüssel kollidiert mit keinem konto-spezifischen Schlüssel,
    // daher unterdrückt Offline-Nutzung kein angemeldetes Konto.
    assert.notEqual(setupGuideKey(null), setupGuideKey("user-a"));
  });
});

describe("isValidSetupGuideStatus", () => {
  it("akzeptiert nur completed/skipped", () => {
    assert.equal(isValidSetupGuideStatus("completed"), true);
    assert.equal(isValidSetupGuideStatus("skipped"), true);
    assert.equal(isValidSetupGuideStatus(null), false);
    assert.equal(isValidSetupGuideStatus(""), false);
    assert.equal(isValidSetupGuideStatus("done"), false);
  });
});

describe("shouldOfferSetupGuide", () => {
  it("bietet den Assistenten nur bei fehlendem Status an (Kurzform)", () => {
    assert.equal(shouldOfferSetupGuide(null), true);
    assert.equal(shouldOfferSetupGuide("completed"), false);
    assert.equal(shouldOfferSetupGuide("skipped"), false);
  });

  it("bietet ihn echten Erstnutzern an (kein Status, keine Daten)", () => {
    assert.equal(
      shouldOfferSetupGuide({ serverStatus: null, localStatus: null, hasContent: false }),
      true,
    );
    // Leeres Objekt = alles unbekannt -> Erstnutzer.
    assert.equal(shouldOfferSetupGuide({}), true);
  });

  it("unterdrückt ihn bei konto-gebundenem Server-Status (geräteunabhängig)", () => {
    assert.equal(
      shouldOfferSetupGuide({ serverStatus: "completed", localStatus: null }),
      false,
    );
    assert.equal(
      shouldOfferSetupGuide({ serverStatus: "skipped", localStatus: null }),
      false,
    );
  });

  it("unterdrückt ihn bei lokalem Status (Offline-Fallback)", () => {
    assert.equal(
      shouldOfferSetupGuide({ serverStatus: null, localStatus: "completed" }),
      false,
    );
  });

  it("unterdrückt ihn für Bestandskonten mit bereits gepflegten Daten", () => {
    assert.equal(
      shouldOfferSetupGuide({ serverStatus: null, localStatus: null, hasContent: true }),
      false,
    );
  });

  it("bietet ihn NICHT an, solange der Inhaltsstatus noch nicht aufgelöst ist", () => {
    // Inhaltsprüfung läuft noch (Server-Abruf/Abgleich nicht fertig) -> im Zweifel
    // nicht anbieten, auch wenn (noch) kein Inhalt gemeldet wird.
    assert.equal(
      shouldOfferSetupGuide({
        serverStatus: null,
        localStatus: null,
        hasContent: false,
        contentResolved: false,
      }),
      false,
    );
  });

  it("bietet ihn an, wenn der Inhaltsstatus aufgelöst und das Konto leer ist", () => {
    assert.equal(
      shouldOfferSetupGuide({
        serverStatus: null,
        localStatus: null,
        hasContent: false,
        contentResolved: true,
      }),
      true,
    );
  });

  it("ein gesetzter Status sticht den noch nicht aufgelösten Inhalt", () => {
    assert.equal(
      shouldOfferSetupGuide({ serverStatus: "completed", contentResolved: false }),
      false,
    );
    assert.equal(
      shouldOfferSetupGuide({ localStatus: "skipped", contentResolved: false }),
      false,
    );
  });
});
