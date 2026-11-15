import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildManualRestrictionParams,
  forwardManualRestrictionParams,
  initialRestrictionChoice,
  initialRestrictionNotes,
  isManualRestrictionAnswered,
  shouldShowManualRestrictionSummary,
  shouldShowNoRestrictionCard,
  deriveDetailsRestrictionStatus,
  deriveAlphaTangoRestrictionStatus,
  buildExemptionNote,
  composeRestrictionNotes,
  decideLocationContinueTarget,
  decidePlanningAbortAction,
  decidePlanningBackAction,
  type ManualRestriction,
  type ManualRestrictionParams,
  type LocationContinueInput,
} from "../manualRestrictionFlow";
import { hasOwnMap, setCountryAccessAvailable } from "../../../shared/countryDetection";

// Modelliert die Navigations-Kette Standort -> DateTime -> Restrictions, indem die
// reinen Schritt-Helfer hintereinander angewendet werden. Liefert das, was
// PlanningRestrictions schließlich als manuelle Antwort sieht.
function threadThroughFlow(manual: ManualRestriction | null): ManualRestrictionParams {
  const locationParams = buildManualRestrictionParams(manual);
  const dateTimeParams = forwardManualRestrictionParams(locationParams);
  return dateTimeParams;
}

describe("Manuelle Einschränkungs-Antwort wird durch den Planungs-Flow getragen", () => {
  it("trägt 'approved' + Notiz von Standort über DateTime bis Restrictions", () => {
    const manual: ManualRestriction = { status: "approved", note: "Offizielle Karte geprüft" };
    const params = threadThroughFlow(manual);
    assert.equal(params.restrictionStatus, "approved");
    assert.equal(params.restrictionNotes, "Offizielle Karte geprüft");
  });

  it("trägt 'limited' + Notiz durch den gesamten Flow", () => {
    const manual: ManualRestriction = { status: "limited", note: "Naturschutzgebiet im Umkreis" };
    const params = threadThroughFlow(manual);
    assert.equal(params.restrictionStatus, "limited");
    assert.equal(params.restrictionNotes, "Naturschutzgebiet im Umkreis");
  });

  it("setzt restrictionNotes auf undefined, wenn keine Notiz angegeben wurde", () => {
    const manual: ManualRestriction = { status: "approved", note: "" };
    const params = threadThroughFlow(manual);
    assert.equal(params.restrictionStatus, "approved");
    assert.equal(params.restrictionNotes, undefined);
  });

  it("trimmt Notizen und behandelt reine Whitespace-Notizen als leer", () => {
    const params = threadThroughFlow({ status: "limited", note: "   " });
    assert.equal(params.restrictionNotes, undefined);
    const params2 = threadThroughFlow({ status: "limited", note: "  Randnotiz  " });
    assert.equal(params2.restrictionNotes, "Randnotiz");
  });

  it("hängt keinen restrictionStatus an, wenn keine manuelle Antwort vorliegt", () => {
    const params = threadThroughFlow(null);
    assert.equal(params.restrictionStatus, undefined);
    assert.equal(params.restrictionNotes, undefined);
    assert.deepEqual(buildManualRestrictionParams(null), {});
  });
});

describe("PlanningRestrictions initialisiert seine Auswahl aus dem eingehenden Param", () => {
  it("übernimmt 'approved' als Initialauswahl statt neu zu fragen", () => {
    assert.equal(initialRestrictionChoice("approved"), "approved");
  });

  it("übernimmt 'limited' als Initialauswahl", () => {
    assert.equal(initialRestrictionChoice("limited"), "limited");
  });

  it("startet ohne eingehenden Param mit null (Auswahl noch offen)", () => {
    assert.equal(initialRestrictionChoice(undefined), null);
    assert.equal(initialRestrictionChoice(null), null);
  });

  it("übernimmt die durchgereichte Notiz als Initialwert des Notizfelds", () => {
    assert.equal(initialRestrictionNotes("Naturschutzgebiet im Umkreis"), "Naturschutzgebiet im Umkreis");
    assert.equal(initialRestrictionNotes(undefined), "");
    assert.equal(initialRestrictionNotes(null), "");
  });
});

describe("Karten-Anzeige in PlanningRestrictions bei manueller Antwort", () => {
  it("unterdrückt die grüne 'Keine Einschränkungen'-Karte zugunsten der manuellen Zusammenfassung", () => {
    const hasManualRestriction = isManualRestrictionAnswered("approved");
    assert.equal(hasManualRestriction, true);

    const state = {
      loading: false,
      error: false,
      hasAnyRestrictions: false,
      hasManualRestriction,
    };
    assert.equal(shouldShowManualRestrictionSummary(state), true);
    assert.equal(shouldShowNoRestrictionCard(state), false);
  });

  it("zeigt die grüne 'Keine Einschränkungen'-Karte, wenn keine manuelle Antwort vorliegt", () => {
    const state = {
      loading: false,
      error: false,
      hasAnyRestrictions: false,
      hasManualRestriction: isManualRestrictionAnswered(null),
    };
    assert.equal(shouldShowManualRestrictionSummary(state), false);
    assert.equal(shouldShowNoRestrictionCard(state), true);
  });

  it("zeigt keine der beiden Standort-Karten, solange noch geladen wird", () => {
    const state = {
      loading: true,
      error: false,
      hasAnyRestrictions: false,
      hasManualRestriction: true,
    };
    assert.equal(shouldShowManualRestrictionSummary(state), false);
    assert.equal(shouldShowNoRestrictionCard(state), false);
  });

  it("zeigt keine der beiden Standort-Karten, wenn eigene Geozonen-Daten gefunden wurden", () => {
    const state = {
      loading: false,
      error: false,
      hasAnyRestrictions: true,
      hasManualRestriction: true,
    };
    assert.equal(shouldShowManualRestrictionSummary(state), false);
    assert.equal(shouldShowNoRestrictionCard(state), false);
  });
});

describe("PlanningRestrictions leitet den restrictionStatus für PlanningDetails ab", () => {
  it("übernimmt die manuelle Antwort 'approved' unverändert in den Details-Param", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: "approved",
        allCoveredByAV: false,
        allUncoveredExempted: false,
      }),
      "approved",
    );
  });

  it("übernimmt die manuelle Antwort 'limited' unverändert in den Details-Param", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: "limited",
        allCoveredByAV: false,
        allUncoveredExempted: false,
      }),
      "limited",
    );
  });

  it("eine explizite Auswahl hat Vorrang vor der AV-Abdeckung", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: "limited",
        allCoveredByAV: true,
        allUncoveredExempted: true,
      }),
      "limited",
    );
  });

  it("'nofly' ergibt keinen Status (undefined) im Details-Param", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: "nofly",
        allCoveredByAV: true,
        allUncoveredExempted: true,
      }),
      undefined,
    );
  });

  it("ohne Auswahl, aber mit AV-Abdeckung aller Zonen -> 'approved'", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: null,
        allCoveredByAV: true,
        allUncoveredExempted: false,
      }),
      "approved",
    );
  });

  it("ohne Auswahl, aber alle ungedeckten Zonen per Ausnahme freigegeben -> 'approved'", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: undefined,
        allCoveredByAV: false,
        allUncoveredExempted: true,
      }),
      "approved",
    );
  });

  it("ohne Auswahl und ohne AV-Abdeckung/Ausnahme -> undefined", () => {
    assert.equal(
      deriveDetailsRestrictionStatus({
        restrictionChoice: null,
        allCoveredByAV: false,
        allUncoveredExempted: false,
      }),
      undefined,
    );
  });
});

describe("AlphaTango-Override leitet den restrictionStatus ab", () => {
  it("ohne Auswahl ist der Fallback 'limited' (dokumentierter Verstoß)", () => {
    assert.equal(deriveAlphaTangoRestrictionStatus(null), "limited");
    assert.equal(deriveAlphaTangoRestrictionStatus(undefined), "limited");
  });

  it("übernimmt eine explizite Auswahl unverändert", () => {
    assert.equal(deriveAlphaTangoRestrictionStatus("approved"), "approved");
    assert.equal(deriveAlphaTangoRestrictionStatus("limited"), "limited");
  });

  it("'nofly' ergibt auch im Override-Fall undefined", () => {
    assert.equal(deriveAlphaTangoRestrictionStatus("nofly"), undefined);
  });
});

describe("restrictionNotes werden für den Details-Param zusammengesetzt", () => {
  it("baut die Ausnahmegenehmigungs-Notiz aus Namen (Fallback auf layerLabel)", () => {
    assert.equal(
      buildExemptionNote([
        { name: "Naturschutzgebiet A", layerLabel: "NSG" },
        { name: "", layerLabel: "Wohngebiet" },
      ]),
      "Ausnahmegenehmigung für: Naturschutzgebiet A, Wohngebiet",
    );
  });

  it("ergibt ohne (benennbare) Geozonen eine leere Notiz", () => {
    assert.equal(buildExemptionNote([]), "");
    assert.equal(buildExemptionNote([{ name: "", layerLabel: "" }]), "");
  });

  it("verbindet Ausnahme- und Pilotennotiz mit ' — '", () => {
    assert.equal(
      composeRestrictionNotes(["Ausnahmegenehmigung für: NSG", "Wind beachten"]),
      "Ausnahmegenehmigung für: NSG — Wind beachten",
    );
  });

  it("filtert leere/whitespace-Teile heraus und trimmt", () => {
    assert.equal(
      composeRestrictionNotes(["", "  ", "  nur Pilotennotiz  "]),
      "nur Pilotennotiz",
    );
  });

  it("ergibt undefined, wenn keine Notiz übrig bleibt", () => {
    assert.equal(composeRestrictionNotes(["", "   ", undefined, null]), undefined);
    assert.equal(composeRestrictionNotes([]), undefined);
  });

  it("hängt im AlphaTango-Fall die Verstoß-Notiz an", () => {
    const alphaTangoNote =
      "FR-Flug ohne AlphaTango-Registrierung an der Drohne gestartet (Pilot hat trotz Hinweis fortgesetzt — Verstoß gegen DGAC-Pflicht ab MTOM 800 g).";
    assert.equal(
      composeRestrictionNotes(["", "Eigene Notiz", alphaTangoNote]),
      `Eigene Notiz — ${alphaTangoNote}`,
    );
  });
});

describe("Eigener Gegenprüfungs-Schritt: Routing nach 'Standort bestätigen'", () => {
  const base: LocationContinueInput = {
    countryLocked: false,
    hasOwnMapData: true,
    crossCheckEnabled: true,
  };

  it("Land mit eigenen Daten + Einstellung an -> eigener Gegenprüfungs-Schritt", () => {
    assert.equal(decideLocationContinueTarget(base), "crosscheck");
  });

  it("Einstellung aus -> direkt zu Datum/Zeit (keine Gegenprüfung)", () => {
    assert.equal(
      decideLocationContinueTarget({ ...base, crossCheckEnabled: false }),
      "datetime",
    );
  });

  it("Land ohne eigene Daten -> direkt zu Datum/Zeit (manualRestriction-Flow bleibt im Standort-Schritt)", () => {
    assert.equal(
      decideLocationContinueTarget({ ...base, hasOwnMapData: false }),
      "datetime",
    );
  });

  it("gesperrtes (nicht freigeschaltetes) Land -> keine Gegenprüfung", () => {
    assert.equal(
      decideLocationContinueTarget({ ...base, countryLocked: true }),
      "datetime",
    );
  });
});

describe("hasOwnMap klassifiziert Länder ohne eigene Geozonen-Daten korrekt", () => {
  it("BE (Belgien) hat jetzt eigene skeyes/Droneguide-Daten -> eigene Karte", () => {
    assert.equal(hasOwnMap("BE"), true);
  });

  it("weitere datenlose Länder werden als ohne eigene Karte erkannt", () => {
    for (const iso of ["CZ", "HU", "GR", "RO"]) {
      assert.equal(hasOwnMap(iso), false, `${iso} sollte keine eigene Karte haben`);
    }
  });

  it("IT (d-flight) zählt nur mit eingetragenem Zugang als eigene Karte", () => {
    setCountryAccessAvailable("IT", false);
    assert.equal(hasOwnMap("IT"), false);
    setCountryAccessAvailable("IT", true);
    assert.equal(hasOwnMap("it"), true);
    setCountryAccessAvailable("IT", false);
  });

  it("Länder mit eigenen Daten lösen den manuellen Flow NICHT aus", () => {
    for (const iso of ["DE", "FR", "CH", "LU", "NL", "AT", "BE", "DK", "ES", "PL", "LT", "GB"]) {
      assert.equal(hasOwnMap(iso), true, `${iso} sollte eine eigene Karte haben`);
    }
  });

  it("behandelt fehlende/leere ISO defensiv als ohne eigene Karte", () => {
    assert.equal(hasOwnMap(undefined), false);
    assert.equal(hasOwnMap(null), false);
    assert.equal(hasOwnMap(""), false);
  });
});

describe("'Planung abbrechen' verlässt den Flow aus jedem Einstieg zuverlässig", () => {
  // Neu-Planungs-Pfad: FlightPlanning-Modal mit mehreren Schritten, darunter der
  // Main-Tab auf dem RootStack. Eltern (RootStack) kann zurück -> ganzes Modal zu.
  it("schließt das ganze Modal, wenn der Eltern-Navigator zurück kann", () => {
    assert.equal(
      decidePlanningAbortAction({
        hasParent: true,
        parentCanGoBack: true,
        selfCanGoBack: true,
      }),
      "parentGoBack",
    );
  });

  // Fortsetzen/Bearbeiten: Direkteinstieg per rootNav.navigate("FlightPlanning",
  // { screen: … }) springt auf einen späteren Schritt. Eltern (RootStack) hat den
  // Main-Tab darunter und kann zurück; der eigene Stack hat ggf. nur diesen einen
  // Screen (selfCanGoBack=false) — trotzdem wird über den Eltern abgebrochen.
  it("bricht auch beim Direkteinstieg über den Eltern-Navigator ab", () => {
    assert.equal(
      decidePlanningAbortAction({
        hasParent: true,
        parentCanGoBack: true,
        selfCanGoBack: false,
      }),
      "parentGoBack",
    );
  });

  // Defensiv: Eltern existiert, kann aber nicht zurück (kein Screen darunter).
  // Dann darf der Abbruch NICHT zum stillen No-Op werden, sondern fällt auf den
  // eigenen Stack zurück.
  it("fällt auf den eigenen Stack zurück, wenn der Eltern nicht zurück kann", () => {
    assert.equal(
      decidePlanningAbortAction({
        hasParent: true,
        parentCanGoBack: false,
        selfCanGoBack: true,
      }),
      "selfGoBack",
    );
  });

  // Kein Eltern-Navigator vorhanden -> eigener Stack wird zurückgeblättert.
  it("nutzt den eigenen Stack, wenn kein Eltern-Navigator existiert", () => {
    assert.equal(
      decidePlanningAbortAction({
        hasParent: false,
        parentCanGoBack: false,
        selfCanGoBack: true,
      }),
      "selfGoBack",
    );
  });

  // Weder Eltern noch eigener Stack können zurück: explizit "none" statt eines
  // verdeckten No-Ops, damit der Aufrufer nichts Falsches versucht.
  it("liefert 'none', wenn nirgends zurückgeblättert werden kann", () => {
    assert.equal(
      decidePlanningAbortAction({
        hasParent: false,
        parentCanGoBack: false,
        selfCanGoBack: false,
      }),
      "none",
    );
    assert.equal(
      decidePlanningAbortAction({
        hasParent: true,
        parentCanGoBack: false,
        selfCanGoBack: false,
      }),
      "none",
    );
  });
});

describe("'Zurück'-Header verhält sich beim Direkteinstieg vorhersehbar", () => {
  // Direkteinstieg (Fortsetzen/Bearbeiten): RN hat unter dem Ziel-Screen einen nie
  // gesehenen Schritt (initialRouteName, z.B. PlanningDroneSelect) initialisiert
  // (selfCanGoBack=true). "Zurück" darf NICHT dorthin springen, sondern verlässt
  // über den Eltern (RootStack) das ganze Modal.
  it("verlässt das Modal beim Direkteinstieg trotz eigenem Stack-History", () => {
    assert.equal(
      decidePlanningBackAction({
        directEntry: true,
        hasParent: true,
        parentCanGoBack: true,
        selfCanGoBack: true,
      }),
      "parentGoBack",
    );
  });

  // Direkteinstieg, aber RN hat NUR den Ziel-Screen initialisiert
  // (selfCanGoBack=false). Auch hier: Modal über den Eltern verlassen.
  it("verlässt das Modal beim Direkteinstieg ohne eigene Stack-History", () => {
    assert.equal(
      decidePlanningBackAction({
        directEntry: true,
        hasParent: true,
        parentCanGoBack: false,
        selfCanGoBack: false,
      }),
      "none",
    );
    assert.equal(
      decidePlanningBackAction({
        directEntry: true,
        hasParent: true,
        parentCanGoBack: true,
        selfCanGoBack: false,
      }),
      "parentGoBack",
    );
  });

  // Defensiv: Direkteinstieg, Eltern kann nicht zurück, aber eigener Stack schon
  // -> lieber einen Schritt zurück als stiller No-Op.
  it("fällt beim Direkteinstieg auf den eigenen Stack zurück, wenn der Eltern nicht zurück kann", () => {
    assert.equal(
      decidePlanningBackAction({
        directEntry: true,
        hasParent: true,
        parentCanGoBack: false,
        selfCanGoBack: true,
      }),
      "selfGoBack",
    );
  });

  // Normaler Neu-Planungs-Flow (kein Direkteinstieg): "Zurück" geht einen Schritt
  // im eigenen Stack zurück, NICHT aus dem Modal heraus.
  it("geht im normalen Flow einen Schritt im eigenen Stack zurück", () => {
    assert.equal(
      decidePlanningBackAction({
        directEntry: false,
        hasParent: true,
        parentCanGoBack: true,
        selfCanGoBack: true,
      }),
      "selfGoBack",
    );
  });

  // Normaler Flow, aber eigener Stack kann ausnahmsweise nicht zurück
  // -> Modal über den Eltern schließen statt No-Op.
  it("schließt im normalen Flow das Modal, wenn der eigene Stack nicht zurück kann", () => {
    assert.equal(
      decidePlanningBackAction({
        directEntry: false,
        hasParent: true,
        parentCanGoBack: true,
        selfCanGoBack: false,
      }),
      "parentGoBack",
    );
  });

  // Weder eigener Stack noch Eltern können zurück -> explizit "none".
  it("liefert 'none', wenn nirgends zurückgeblättert werden kann", () => {
    assert.equal(
      decidePlanningBackAction({
        directEntry: false,
        hasParent: false,
        parentCanGoBack: false,
        selfCanGoBack: false,
      }),
      "none",
    );
  });
});
