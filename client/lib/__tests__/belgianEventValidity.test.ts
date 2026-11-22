// Belgische Veranstaltungs-Sperrzonen (TEMPORARY-NO-FLY-ZONE): vergangene
// Events verwerfen, bekannte Termine datieren, dauerhafte Zonen nie anfassen.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DRONEGUIDE_WINDOW_VALID_FLAG,
  applyBelgianEventValidity,
  applyDroneguideEventWindow,
  belgianEventVerdict,
  datesInText,
  eventYearFromProps,
} from "../../../shared/belgianEventValidity";
import { parseEd269ToGeozoneInfo } from "../ed269";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const EV = "TEMPORARY-NO-FLY-ZONE";

const square = [[[4.3, 50.8], [4.4, 50.8], [4.4, 50.9], [4.3, 50.9], [4.3, 50.8]]];
const feat = (props: Record<string, unknown>) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: square },
  properties: { restriction: "PROHIBITED", ...props },
});

describe("Datum/Jahr aus Text", () => {
  it("erkennt dd/mm/yyyy-Bereiche, ISO und ausgeschriebene Monate (en/fr/nl)", () => {
    assert.deepEqual(datesInText("18/07/2025 - 27/07/2025"), [Date.UTC(2025, 6, 18), Date.UTC(2025, 6, 27)]);
    assert.deepEqual(datesInText("21 July 2026 - Te Deum"), [Date.UTC(2026, 6, 21)]);
    assert.deepEqual(datesInText("21 juillet 2026"), [Date.UTC(2026, 6, 21)]);
    assert.deepEqual(datesInText("3 mei 2027"), [Date.UTC(2027, 4, 3)]);
    assert.deepEqual(datesInText("2026-12-14"), [Date.UTC(2026, 11, 14)]);
    assert.deepEqual(datesInText("EBR52 - PETIT-RŒULX, 400 FT"), []);
    assert.deepEqual(datesInText("31/02/2026"), [], "ungültiger Tag");
  });

  it("Jahr aus Name bzw. skeyes-Code G<JJ>…", () => {
    assert.equal(eventYearFromProps({ name: "Tomorrowland 2025" }), 2025);
    assert.equal(eventYearFromProps({ name: "Police activities", code: "G25-195" }), 2025);
    assert.equal(eventYearFromProps({ name: "Gentse Feesten", code: "G26131" }), 2026);
    assert.equal(eventYearFromProps({ name: "EBR49-ZUTENDAAL", code: "AH_R49" }), null);
  });
});

describe("belgianEventVerdict", () => {
  it("Event mit vergangenem Datum im Namen → verwerfen", () => {
    const v = belgianEventVerdict({ type: EV, name: "21 July 2026 - Défilé" }, NOW);
    assert.equal(v.action, "drop");
  });

  it("Event mit künftigem Datum → datiert (Start/Ende gesetzt)", () => {
    const v = belgianEventVerdict({ type: EV, name: "Marathon", description: "06/12/2026 - 07/12/2026" }, NOW);
    assert.equal(v.action, "date");
    if (v.action !== "date") return;
    assert.ok(v.validStartTs <= Date.UTC(2026, 11, 6) && v.validStartTs > Date.UTC(2026, 11, 5));
    assert.equal(v.validEndTs, Date.UTC(2026, 11, 8));
  });

  it("vergangenes Veranstaltungsjahr → verwerfen; laufendes Jahr ohne Datum → behalten", () => {
    assert.equal(belgianEventVerdict({ type: EV, name: "Tomorrowland 2025", code: "G25072" }, NOW).action, "drop");
    assert.equal(belgianEventVerdict({ type: EV, name: "Tomorrowland 2026", code: "G26072" }, NOW).action, "keep");
  });

  it("von Droneguide bestätigte Zone wird nicht über das Jahr verworfen", () => {
    const v = belgianEventVerdict({ type: EV, name: "Memorial Day", code: "2026", [DRONEGUIDE_WINDOW_VALID_FLAG]: true }, Date.parse("2027-03-01T00:00:00Z"));
    assert.equal(v.action, "keep");
  });

  it("Quelle datiert (skeyes validEndTs) → unverändert", () => {
    assert.equal(belgianEventVerdict({ type: EV, name: "Police activities 2025", validEndTs: NOW + 1000 }, NOW).action, "keep");
  });

  it("dauerhafte Zonen werden nie verworfen – auch mit Jahr/Datum im Text", () => {
    for (const type of ["CIV_AF_UNCONTROLLED", "CIV_CTR_VLL1", "MIL_DOMAIN", "CIV_PRISON", "NOTAM", "FANC"]) {
      assert.equal(belgianEventVerdict({ type, name: "Zone 2019", description: "since 01/01/2020" }, NOW).action, "keep", type);
    }
  });
});

describe("Droneguide-Zeitfenster (uaszone ab jetzt)", () => {
  const all = [
    { id: "uuid-tml", code: "G26072" },
    { id: "uuid-r49", code: "AH_R49" },
    { id: "uuid-tmp-old", code: "Temporary" },
    { id: "uuid-tmp-new", code: "Temporary" },
  ];
  const valid = [
    { id: "uuid-r49", code: "AH_R49" },
    { id: "uuid-tmp-new", code: "Temporary" },
  ];

  it("fehlende Event-Zonen fallen weg – auch die skeyes-Live-Zone gleichen Codes", () => {
    const features = [
      feat({ type: EV, uniqueIdentifier: "G26072", code: "G26072", name: "Tomorrowland 2026", _live: true }),
      feat({ type: EV, uniqueIdentifier: "uuid-r49", code: "AH_R49", name: "EBR49-ZUTENDAAL" }),
      feat({ type: EV, uniqueIdentifier: "uuid-tmp-old", code: "Temporary", name: "Ronde van Vlaanderen 2026" }),
      feat({ type: EV, uniqueIdentifier: "uuid-tmp-new", code: "Temporary", name: "Neues Event" }),
      feat({ type: "CIV_AF_UNCONTROLLED", uniqueIdentifier: "uuid-af", code: "EBXX", name: "Flugplatz" }),
    ];
    const out = applyDroneguideEventWindow(features, all, valid);
    const names = out.map((f) => f.properties.name);
    assert.deepEqual(names, ["EBR49-ZUTENDAAL", "Neues Event", "Flugplatz"]);
    assert.equal(out[0].properties[DRONEGUIDE_WINDOW_VALID_FLAG], true);
    assert.equal(out[2].properties[DRONEGUIDE_WINDOW_VALID_FLAG], undefined, "Dauerzone unverändert");
  });

  it("ohne Fensterdaten (Abfrage fehlgeschlagen = nicht aufgerufen) bleibt alles", () => {
    const features = [feat({ type: EV, uniqueIdentifier: "x", code: "G26072", name: "Tomorrowland 2026" })];
    assert.equal(applyDroneguideEventWindow(features, [], []).length, 1);
  });
});

describe("Lesen aus dem Gerätespeicher (parseEd269ToGeozoneInfo, BE)", () => {
  it("vergangene Events fallen weg, künftige werden datiert, Dauerzonen bleiben", () => {
    const zones = parseEd269ToGeozoneInfo(
      [
        feat({ type: EV, code: "G26A159", name: "21 July 2026 - Te Deum" }),
        feat({ type: EV, code: "G25-195", name: "Police activities" }),
        feat({ type: EV, code: "X1", name: "Weihnachtsmarkt", description: "05/12/2026 - 24/12/2026" }),
        feat({ type: "MIL_DOMAIN", code: "M1", name: "Kaserne 2019" }),
      ],
      "BE",
      NOW,
    );
    const byName = Object.fromEntries(zones.map((z) => [z.name, z]));
    assert.equal(byName["21 July 2026 - Te Deum"], undefined);
    assert.equal(byName["Police activities"], undefined);
    assert.ok(byName["Weihnachtsmarkt"], "künftiges Event bleibt");
    assert.equal(byName["Weihnachtsmarkt"].validEndTs, Date.UTC(2026, 11, 25));
    assert.ok(byName["Kaserne 2019"], "Dauerzone bleibt");
  });

  it("andere Länder unberührt", () => {
    const zones = parseEd269ToGeozoneInfo([feat({ type: EV, name: "21 July 2026 - Te Deum" })], "AT", NOW);
    assert.equal(zones.length, 1);
  });

  it("applyBelgianEventValidity mutiert die Eingabe nicht", () => {
    const f = feat({ type: EV, name: "Event", description: "05/12/2026" });
    const [out] = applyBelgianEventValidity([f], NOW);
    assert.equal((f.properties as any).validEndTs, undefined);
    assert.equal(out.properties.validEndTs, Date.UTC(2026, 11, 6));
  });
});
