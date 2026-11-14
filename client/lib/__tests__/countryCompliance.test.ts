import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getSupportedCountries,
  getCountryRuleSet,
  checkCountryCompliance,
  NATIONAL_SYSTEM_COUNTRIES,
} from "../countryCompliance";
import type { ComplianceItem } from "../countryCompliance";
import type { DroneProfile, PilotProfile } from "@/lib/storage";
import { DFLIGHT_ITALY_GUIDE, type DflightGuide } from "../dflightItalyGuide";

// Diese Suite schützt die Länder-Regel-Zusammenfassungen vor Drift in der
// Vollständigkeit. Jedes EASA-Land soll mindestens einen Karten-Link sowie einen
// Registrierungs-, Höhen- und Behörden-Hinweis bereitstellen, und kein
// fixedHint-`id` darf länderübergreifend doppelt vorkommen.

// EASA-Länder = unterstützte Länder, die NICHT auf ein eigenes nationales System
// ohne EU-Anerkennung setzen.
function isEasaCountry(iso: string): boolean {
  return !NATIONAL_SYSTEM_COUNTRIES.has(iso);
}

const SUPPORTED = getSupportedCountries();
const EASA = SUPPORTED.filter(({ iso }) => isEasaCountry(iso));

function hintIds(iso: string): string[] {
  return (getCountryRuleSet(iso)?.fixedHints ?? []).map((h) => h.id);
}

describe("COUNTRY_RULES Vollständigkeit der Länder-Zusammenfassungen", () => {
  it("erfasst EASA-Länder (Kerngruppe ist vorhanden)", () => {
    const isos = EASA.map((c) => c.iso);
    assert.ok(
      EASA.length >= 30,
      `erwartet >= 30 EASA-Länder, gefunden ${EASA.length}`,
    );
    for (const expected of [
      "DE",
      "FR",
      "IT",
      "CH",
      "AT",
      "ES",
      "LU",
      "NL",
      "AL",
      "IS",
      "NO",
      "MK",
    ]) {
      assert.ok(
        isos.includes(expected),
        `${expected} sollte ein EASA-Land sein`,
      );
    }
  });

  for (const { iso, label } of EASA) {
    describe(`${iso} (${label})`, () => {
      const rs = getCountryRuleSet(iso)!;
      const ids = hintIds(iso);

      it("hat einen Karten-Link (mapUrl + mapLabel)", () => {
        assert.ok(rs.mapUrl, `${iso}: mapUrl fehlt`);
        assert.ok(rs.mapLabel, `${iso}: mapLabel fehlt`);
      });

      it("hat einen Registrierungs-Hinweis", () => {
        assert.ok(
          ids.some((id) => id.endsWith("_hint_registration")),
          `${iso}: kein _hint_registration (vorhandene: ${ids.join(", ")})`,
        );
      });

      it("hat einen Höhen-Hinweis", () => {
        assert.ok(
          ids.some((id) => id.endsWith("_hint_height")),
          `${iso}: kein _hint_height (vorhandene: ${ids.join(", ")})`,
        );
      });

      it("hat einen Behörden-Hinweis", () => {
        assert.ok(
          ids.some((id) => id.endsWith("_hint_authority")),
          `${iso}: kein _hint_authority (vorhandene: ${ids.join(", ")})`,
        );
      });
    });
  }
});

describe("COUNTRY_RULES Konsistenz", () => {
  it("jedes unterstützte Land hat mapUrl + mapLabel", () => {
    for (const { iso } of SUPPORTED) {
      const rs = getCountryRuleSet(iso)!;
      assert.ok(rs.mapUrl, `${iso}: mapUrl fehlt`);
      assert.ok(rs.mapLabel, `${iso}: mapLabel fehlt`);
    }
  });

  it("keine doppelten fixedHint-id-Werte über alle Länder", () => {
    const owner = new Map<string, string>();
    const duplicates: string[] = [];
    for (const { iso } of SUPPORTED) {
      const rs = getCountryRuleSet(iso)!;
      for (const hint of rs.fixedHints) {
        const previous = owner.get(hint.id);
        if (previous) {
          duplicates.push(`${hint.id} (${previous} & ${iso})`);
        } else {
          owner.set(hint.id, iso);
        }
      }
    }
    assert.deepEqual(duplicates, [], `doppelte Hint-ids: ${duplicates.join(", ")}`);
  });

  it("jeder fixedHint hat id, category, level, title und description", () => {
    for (const { iso } of SUPPORTED) {
      const rs = getCountryRuleSet(iso)!;
      for (const hint of rs.fixedHints) {
        assert.ok(hint.id, `${iso}: Hint ohne id`);
        assert.ok(hint.category, `${iso}/${hint.id}: category fehlt`);
        assert.ok(hint.level, `${iso}/${hint.id}: level fehlt`);
        assert.ok(hint.title, `${iso}/${hint.id}: title fehlt`);
        assert.ok(hint.description, `${iso}/${hint.id}: description fehlt`);
      }
    }
  });
});

// Registry aller hinterlegten In-App-Anleitungen. Wenn ein guide-Feld auf einen
// Schlüssel verweist, der hier nicht existiert, ist die Verknüpfung tot.
const KNOWN_GUIDES: Record<string, DflightGuide> = {
  "dflight-it": DFLIGHT_ITALY_GUIDE,
};

// Diese Suite schützt den gesamten Anleitungs-/Hinweis-Bereich (nicht nur
// Italien) vor Drift: jedes Item mit actionUrl muss eine https-URL UND ein
// actionLabel haben, und jedes guide-Feld muss auf eine real existierende
// Anleitung verweisen. Geprüft werden sowohl fixedHints als auch die dynamisch
// von rules erzeugten Items (inkl. der EU_BASE_RULES) für alle Länder.

// Drohne/Pilot-Stubs mit allen verschachtelten Feldern, die die rules abfragen,
// damit kein Zugriff auf undefined crasht. Casts, weil wir absichtlich nur die
// in den rules verwendeten Felder belegen.
function makeDrone(overrides: Record<string, unknown> = {}): DroneProfile {
  return {
    name: "Test-Drohne",
    mtomGrams: 900,
    hasRemoteId: false,
    classMark: "legacy",
    alphaTangoDocument: null,
    dflightDocument: null,
    compliance: { remoteIdConfigured: false },
    ...overrides,
  } as unknown as DroneProfile;
}

function makePilot(overrides: Record<string, unknown> = {}): PilotProfile {
  return {
    operatorId: "",
    operatorRegistered: false,
    licenseA1A3: false,
    licenseA2: false,
    insuranceActive: false,
    countrySpecific: {},
    ...overrides,
  } as unknown as PilotProfile;
}

// Mehrere Varianten, damit möglichst alle bedingten rule-Items (mit actionUrl /
// guide) tatsächlich erzeugt und mitgeprüft werden.
const PROFILE_VARIANTS: { drone: DroneProfile; pilot: PilotProfile }[] = [
  // Alles fehlt -> löst die meisten Error-Items aus (Registrierung, Versicherung …).
  { drone: makeDrone(), pilot: makePilot() },
  // Schwere Drohne ohne Remote-ID -> Balise/Signalmodul-Items.
  {
    drone: makeDrone({ mtomGrams: 1200, hasRemoteId: false }),
    pilot: makePilot(),
  },
  // Alles vorhanden -> ruhiger Pfad, deckt fixedHints unverändert ab.
  {
    drone: makeDrone({
      mtomGrams: 500,
      hasRemoteId: true,
      classMark: "C2",
      alphaTangoDocument: "doc",
      dflightDocument: "doc",
      compliance: { remoteIdConfigured: true },
    }),
    pilot: makePilot({
      operatorId: "DE123",
      operatorRegistered: true,
      licenseA1A3: true,
      licenseA2: true,
      insuranceActive: true,
      countrySpecific: {
        insuranceCH1Mio: true,
        insuranceATSzr: true,
        caaUK: true,
      },
    }),
  },
];

// Sammelt für ein Land alle möglichen ComplianceItems (rules + fixedHints) über
// alle Profil-Varianten, dedupliziert nach id.
function collectItems(iso: string): ComplianceItem[] {
  const byId = new Map<string, ComplianceItem>();
  for (const { drone, pilot } of PROFILE_VARIANTS) {
    const result = checkCountryCompliance(drone, pilot, iso);
    for (const item of result.items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

describe("Länder-Anleitungen/Hinweise: actionUrl-Verknüpfungen sind gültig", () => {
  for (const { iso, label } of SUPPORTED) {
    const items = collectItems(iso);
    const withUrl = items.filter((i) => i.actionUrl != null);

    it(`${iso} (${label}): jedes actionUrl-Item ist konsistent`, () => {
      for (const item of withUrl) {
        assert.ok(
          item.actionUrl!.startsWith("https://"),
          `${iso}/${item.id}: actionUrl ist keine https-URL: ${item.actionUrl}`,
        );
        assert.ok(
          !/(xxx|todo|placeholder|example\.com|<|>)/i.test(item.actionUrl!),
          `${iso}/${item.id}: actionUrl wirkt wie ein Platzhalter: ${item.actionUrl}`,
        );
        assert.ok(
          typeof item.actionLabel === "string" && item.actionLabel.trim().length > 0,
          `${iso}/${item.id}: actionLabel fehlt trotz actionUrl`,
        );
      }
    });
  }

  it("mapUrl ist überall eine gültige https-URL ohne Platzhalter", () => {
    for (const { iso } of SUPPORTED) {
      const rs = getCountryRuleSet(iso)!;
      assert.ok(
        rs.mapUrl!.startsWith("http://") || rs.mapUrl!.startsWith("https://"),
        `${iso}: mapUrl ist keine URL: ${rs.mapUrl}`,
      );
      assert.ok(
        !/(xxx|todo|placeholder|example\.com|<|>)/i.test(rs.mapUrl!),
        `${iso}: mapUrl wirkt wie ein Platzhalter: ${rs.mapUrl}`,
      );
    }
  });
});

describe("Länder-Anleitungen: guide-Felder verweisen auf reale Anleitungen", () => {
  it("jedes guide-Feld verweist auf eine registrierte Anleitung", () => {
    let guideRefs = 0;
    for (const { iso } of SUPPORTED) {
      for (const item of collectItems(iso)) {
        if (item.guide == null) continue;
        guideRefs += 1;
        assert.ok(
          item.guide in KNOWN_GUIDES,
          `${iso}/${item.id}: guide "${item.guide}" ist nicht registriert (bekannt: ${Object.keys(KNOWN_GUIDES).join(", ")})`,
        );
      }
    }
    // Sicherstellen, dass der Test überhaupt etwas prüft (aktuell IT).
    assert.ok(guideRefs > 0, "kein einziges guide-Feld gefunden — Test wirkungslos?");
  });

  it("jede registrierte Anleitung ist inhaltlich vollständig", () => {
    for (const [key, guide] of Object.entries(KNOWN_GUIDES)) {
      assert.ok(guide, `Anleitung "${key}" ist undefined`);
      assert.ok(guide.title.trim().length > 0, `${key}: title fehlt`);
      assert.ok(guide.intro.trim().length > 0, `${key}: intro fehlt`);
      assert.ok(guide.steps.length > 0, `${key}: keine Schritte`);
      assert.ok(
        guide.portalUrl.startsWith("https://"),
        `${key}: portalUrl ist keine https-URL: ${guide.portalUrl}`,
      );
      assert.ok(guide.portalLabel.trim().length > 0, `${key}: portalLabel fehlt`);
    }
  });
});
