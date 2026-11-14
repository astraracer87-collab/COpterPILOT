// Pure (React-Native-freie) Logik für den manuellen Einschränkungs-Flow in der
// Flugplanung. Für Länder OHNE eigene Geozonen-Daten (hasOwnMap === false) prüft
// der Pilot im Standort-Schritt die offizielle Staatskarte selbst und beantwortet
// dort "Einschränkungen ja/nein". Diese Antwort wird als Navigations-Parameter
// (restrictionStatus + restrictionNotes) durch PlanningDateTime an
// PlanningRestrictions und weiter an PlanningDetails durchgereicht; der
// Restrictions-Schritt fragt NICHT erneut.
//
// Die Funktionen sind hier extrahiert, damit sie ohne react-native-Importe unter
// tsx getestet werden können (siehe client/lib/__tests__/manualRestrictionFlow.test.ts).

export type ManualRestrictionStatus = "approved" | "limited";

export interface ManualRestriction {
  status: ManualRestrictionStatus;
  note: string;
}

export interface ManualRestrictionParams {
  restrictionStatus?: ManualRestrictionStatus;
  restrictionNotes?: string;
}

// PlanningLocationScreen: baut die einschränkungsbezogenen Navigations-Parameter,
// die beim Weiter-Tippen an PlanningDateTime angehängt werden. Ohne manuelle
// Antwort wird ein leeres Objekt zurückgegeben (kein restrictionStatus gesetzt).
export function buildManualRestrictionParams(
  manualRestriction: ManualRestriction | null | undefined,
): ManualRestrictionParams {
  if (!manualRestriction) return {};
  const note = manualRestriction.note?.trim();
  return {
    restrictionStatus: manualRestriction.status,
    restrictionNotes: note ? note : undefined,
  };
}

// PlanningDateTimeScreen: reicht die einschränkungsbezogenen Parameter unverändert
// an PlanningRestrictions weiter (der DateTime-Schritt fragt nichts dazu ab).
export function forwardManualRestrictionParams(
  params: ManualRestrictionParams,
): ManualRestrictionParams {
  return {
    restrictionStatus: params.restrictionStatus,
    restrictionNotes: params.restrictionNotes,
  };
}

// Gegenprüfung "offizielle Staatskarte" für Länder MIT eigenen Geozonen-Daten.
// Unabhängig von restrictionStatus, damit die automatische Geozonen-/§21h-
// Erkennung NICHT beeinflusst wird. Der Pilot öffnet zusätzlich die offizielle
// Karte und beantwortet "Gibt es dort Geozonen, die einen Start verhindern
// würden?" (blocking = Ja). Das Ergebnis wird durch die Planungs-Kette gereicht
// und im Ergebnis-Schritt als Warnung angezeigt (>= caution bei blocking).
export interface OfficialMapCrossCheck {
  blocking: boolean;
  note?: string;
}

export interface CrossCheckParams {
  officialMapCrossCheck?: OfficialMapCrossCheck;
}

// PlanningLocationScreen: baut den Gegenprüfungs-Parameter für die Weiterleitung.
// Ohne Antwort wird ein leeres Objekt zurückgegeben.
export function buildCrossCheckParams(
  crossCheck: { blocking: boolean; note?: string } | null | undefined,
): CrossCheckParams {
  if (!crossCheck) return {};
  const note = crossCheck.note?.trim();
  return {
    officialMapCrossCheck: {
      blocking: crossCheck.blocking,
      note: note ? note : undefined,
    },
  };
}

// DateTime/Restrictions: reicht den Gegenprüfungs-Parameter unverändert weiter.
export function forwardCrossCheckParams(params: CrossCheckParams): CrossCheckParams {
  return { officialMapCrossCheck: params.officialMapCrossCheck };
}

// --- Eigener Gegenprüfungs-Schritt nach dem "Standort bestätigen" --------------
//
// Die Gegenprüfung der offiziellen Staatskarte ist ein EIGENER, klar
// beschrifteter Planungs-Schritt zwischen Standort und Datum/Zeit (App:
// PlanningCrossCheck-Screen, Web: Wizard-Schritt "Gegenprüfung"). Er erscheint
// NUR für Länder MIT eigenen Geozonen-Daten (hasOwnMap) und nur, wenn die
// Einstellung `officialMapCrossCheck` aktiv ist (Default an). Länder OHNE eigene
// Daten behalten ihren bestehenden manualRestriction-Flow im Standort-Schritt.
//
// Die reine Routing-Entscheidung ist hier extrahiert, damit sie ohne
// react-native-Importe unter tsx testbar ist und App↔Web identisch bleibt.

export type LocationContinueTarget = "crosscheck" | "datetime";

export interface LocationContinueInput {
  // Das erkannte Land ist nicht freigeschaltet (Paywall) -> kein Weiter.
  countryLocked: boolean;
  // Das Land hat eigene Geozonen-Daten (hasOwnMap) -> Gegenprüfung sinnvoll.
  hasOwnMapData: boolean;
  // Einstellung `officialMapCrossCheck` ist aktiv (Default an).
  crossCheckEnabled: boolean;
}

// Nach "Standort bestätigen": entscheidet, ob der eigene Gegenprüfungs-Schritt
// dazwischengeschaltet wird oder direkt zum Datum/Zeit-Schritt gesprungen wird.
//   - Land mit eigenen Daten + Einstellung an + freigeschaltet -> "crosscheck"
//   - sonst (Land ohne eigene Daten / Einstellung aus)          -> "datetime"
// Ein gesperrtes Land wird bereits vorher abgefangen; defensiv führt es hier
// ebenfalls nicht zur Gegenprüfung.
export function decideLocationContinueTarget(
  input: LocationContinueInput,
): LocationContinueTarget {
  if (!input.countryLocked && input.hasOwnMapData && input.crossCheckEnabled) {
    return "crosscheck";
  }
  return "datetime";
}

// PlanningRestrictionsScreen: Initialwert der Auswahl aus dem eingehenden Param.
export function initialRestrictionChoice(
  manualRestrictionStatus: ManualRestrictionStatus | null | undefined,
): ManualRestrictionStatus | "nofly" | null {
  return manualRestrictionStatus ?? null;
}

// PlanningRestrictionsScreen: Initialwert des Notizfelds aus dem eingehenden Param.
export function initialRestrictionNotes(
  manualRestrictionNotes: string | null | undefined,
): string {
  return manualRestrictionNotes ?? "";
}

// True, wenn im Standort-Schritt bereits eine manuelle Antwort gegeben wurde.
export function isManualRestrictionAnswered(
  manualRestrictionStatus: ManualRestrictionStatus | null | undefined,
): boolean {
  return manualRestrictionStatus != null;
}

export interface RestrictionCardState {
  loading: boolean;
  error: boolean;
  hasAnyRestrictions: boolean;
  hasManualRestriction: boolean;
}

// Zeigt die Zusammenfassung der manuellen Antwort (statt der grünen
// "Keine Einschränkungen"-Karte), wenn keine eigenen Daten gefunden wurden, aber
// eine manuelle Antwort vorliegt.
export function shouldShowManualRestrictionSummary(state: RestrictionCardState): boolean {
  return !state.loading && !state.error && !state.hasAnyRestrictions && state.hasManualRestriction;
}

// Zeigt die grüne "Keine Einschränkungen"-Karte nur, wenn keine eigenen Daten
// gefunden wurden UND keine manuelle Antwort vorliegt.
export function shouldShowNoRestrictionCard(state: RestrictionCardState): boolean {
  return !state.loading && !state.error && !state.hasAnyRestrictions && !state.hasManualRestriction;
}

// In PlanningRestrictions getroffene Auswahl: die manuelle Antwort ("approved" |
// "limited"), "nofly" (Flug nicht möglich) oder null/undefined (noch offen).
export type RestrictionChoice = ManualRestrictionStatus | "nofly" | null | undefined;

export interface DetailsRestrictionStatusInput {
  // Aktuelle Auswahl in PlanningRestrictions (ggf. aus manueller Antwort vorbelegt).
  restrictionChoice: RestrictionChoice;
  // Alle betroffenen Geozonen sind durch eine Allgemeinerlaubnis (AV) gedeckt.
  allCoveredByAV: boolean;
  // Alle nicht durch AV gedeckten Geozonen wurden per Ausnahmegenehmigung freigegeben.
  allUncoveredExempted: boolean;
}

// PlanningRestrictionsScreen.navigateToDetails: leitet den restrictionStatus für den
// Logbuch-/Planungs-Eintrag ab.
//   - "nofly"            -> undefined (kein Status, Flug nicht möglich)
//   - "approved"/"limited" (explizit gewählt) -> unverändert übernommen
//   - keine Auswahl, aber alle Zonen AV-gedeckt ODER alle Ausnahmen erteilt -> "approved"
//   - sonst              -> undefined
export function deriveDetailsRestrictionStatus(
  input: DetailsRestrictionStatusInput,
): ManualRestrictionStatus | undefined {
  const { restrictionChoice, allCoveredByAV, allUncoveredExempted } = input;
  if (restrictionChoice === "nofly") return undefined;
  if (restrictionChoice === "approved" || restrictionChoice === "limited") {
    return restrictionChoice;
  }
  return allCoveredByAV || allUncoveredExempted ? "approved" : undefined;
}

// PlanningRestrictionsScreen.navigateToDetailsWithAlphaTangoOverride: wie oben, aber
// im FR/AlphaTango-Override-Fall ist der Fallback ohne explizite Auswahl "limited"
// (es liegt ein dokumentierter Verstoß vor), nicht "approved".
//   - "nofly"            -> undefined
//   - "approved"/"limited" (explizit gewählt) -> unverändert übernommen
//   - keine Auswahl      -> "limited"
export function deriveAlphaTangoRestrictionStatus(
  restrictionChoice: RestrictionChoice,
): ManualRestrictionStatus | undefined {
  if (restrictionChoice === "nofly") return undefined;
  if (restrictionChoice === "approved" || restrictionChoice === "limited") {
    return restrictionChoice;
  }
  return "limited";
}

// --- "Planung abbrechen": Flow zuverlässig verlassen ---------------------------
//
// Der FlightPlanning-Navigator wird immer als Modal-Screen auf dem RootStack
// gemountet (RootStackNavigator). Ein Planungs-Screen (z.B. PlanningRestrictions)
// liegt also IM FlightPlanning-Stack, dessen Eltern-Navigator der RootStack ist.
// "Planung abbrechen" soll den GESAMTEN Planungs-Flow verlassen — unabhängig vom
// Einstieg (Neu-Planung ab PlanningDroneSelect, oder Fortsetzen/Bearbeiten, das
// per rootNav.navigate("FlightPlanning", { screen: … }) direkt auf einen späteren
// Schritt springt). Daher wird der Eltern-Navigator (RootStack) zurückgeblättert,
// was das ganze Modal schließt — nicht nur ein Screen innerhalb des Stacks.
//
// Bisher rief der Abbruch bedingungslos parent.goBack() auf, sobald ein Eltern-
// Navigator existierte. Konnte der Eltern-Navigator nicht zurückblättern (z.B.
// kein darunterliegender Screen), war der Abbruch ein "stiller No-Op" (Dialog
// schließt, aber nichts passiert) — und es wurde NICHT auf den eigenen Stack
// zurückgefallen. Diese reine Entscheidung wählt deshalb defensiv:
//   - Eltern vorhanden UND kann zurück  -> Eltern zurück (ganzes Modal schließen)
//   - sonst eigener Stack kann zurück   -> eigenen Screen zurück
//   - sonst                             -> keine Aktion (echter No-Op vermeidbar)
export type PlanningAbortAction = "parentGoBack" | "selfGoBack" | "none";

export interface PlanningAbortInput {
  // Ein Eltern-Navigator existiert (navigation.getParent() != null).
  hasParent: boolean;
  // Der Eltern-Navigator kann tatsächlich zurückblättern (parent.canGoBack()).
  parentCanGoBack: boolean;
  // Der eigene Navigator kann zurückblättern (navigation.canGoBack()).
  selfCanGoBack: boolean;
}

export function decidePlanningAbortAction(
  input: PlanningAbortInput,
): PlanningAbortAction {
  if (input.hasParent && input.parentCanGoBack) return "parentGoBack";
  if (input.selfCanGoBack) return "selfGoBack";
  return "none";
}

// --- "Zurück"-Header-Button: vorhersehbar verlassen ---------------------------
//
// Anders als der Abbruch-Dialog (decidePlanningAbortAction) wird der reguläre
// "Zurück"-Button je Planungs-Screen unterschiedlich erwartet:
//   - Im Neu-Planungs-Flow (PlanningDroneSelect -> … -> Screen) soll "Zurück"
//     EINEN Schritt im eigenen Stack zurückgehen.
//   - Beim Direkteinstieg (Fortsetzen/Bearbeiten per
//     rootNav.navigate("FlightPlanning", { screen: … })) springt der Pilot mitten
//     in den Stack. Es gibt KEINEN sinnvollen vorherigen Planungsschritt, den er
//     selbst durchlaufen hat. Je nach React-Navigation-Initialisierung liegt
//     darunter entweder gar nichts (nur Ziel-Screen) oder ein nie gesehener Schritt
//     (initialRouteName, z.B. PlanningDroneSelect). In beiden Fällen ist die
//     einzig vorhersehbare Aktion: das ganze Modal sauber verlassen (Eltern zurück).
//
// Die Entscheidung hängt deshalb am expliziten `directEntry`-Flag (vom Aufrufer in
// BriefingsScreen gesetzt), NICHT an selfCanGoBack — das wäre nicht aussagekräftig,
// weil der Direkteinstieg je nach RN-Init mal mit und mal ohne darunterliegenden
// Screen initialisiert wird.
export type PlanningBackAction = "parentGoBack" | "selfGoBack" | "none";

export interface PlanningBackInput {
  // Der Screen wurde per Direkteinstieg (Fortsetzen/Bearbeiten) angesprungen.
  directEntry: boolean;
  // Ein Eltern-Navigator existiert (navigation.getParent() != null).
  hasParent: boolean;
  // Der Eltern-Navigator kann tatsächlich zurückblättern (parent.canGoBack()).
  parentCanGoBack: boolean;
  // Der eigene Navigator kann zurückblättern (navigation.canGoBack()).
  selfCanGoBack: boolean;
}

export function decidePlanningBackAction(
  input: PlanningBackInput,
): PlanningBackAction {
  // Direkteinstieg: ganzes Modal verlassen — unabhängig davon, ob RN unter dem
  // Ziel-Screen noch einen (nie gesehenen) Schritt initialisiert hat.
  if (input.directEntry) {
    if (input.hasParent && input.parentCanGoBack) return "parentGoBack";
    // Defensiv: ohne zurückblätterbaren Eltern lieber den eigenen Stack nutzen,
    // statt ein stiller No-Op zu werden.
    if (input.selfCanGoBack) return "selfGoBack";
    return "none";
  }
  // Normaler Flow: einen Schritt im eigenen Stack zurück.
  if (input.selfCanGoBack) return "selfGoBack";
  // Fallback: eigener Stack kann nicht zurück -> Modal schließen.
  if (input.hasParent && input.parentCanGoBack) return "parentGoBack";
  return "none";
}

export interface ExemptedGeozoneLike {
  name?: string | null;
  layerLabel?: string | null;
}

// Baut die "Ausnahmegenehmigung für: …"-Notiz aus den per Ausnahme freigegebenen
// Geozonen. Leere/namelose Einträge werden übersprungen; ohne Einträge entsteht eine
// leere Zeichenkette (die beim Zusammensetzen herausgefiltert wird).
export function buildExemptionNote(
  exemptedGeozones: ExemptedGeozoneLike[],
): string {
  const names = exemptedGeozones
    .map((gz) => gz.name || gz.layerLabel || "")
    .filter(Boolean);
  return names.length > 0 ? `Ausnahmegenehmigung für: ${names.join(", ")}` : "";
}

// Setzt die restrictionNotes für den Details-Param zusammen: leere/whitespace-Teile
// fallen weg, der Rest wird mit " — " verbunden. Ergibt sich nichts, wird undefined
// zurückgegeben (kein leerer String im Eintrag).
export function composeRestrictionNotes(
  parts: (string | null | undefined)[],
): string | undefined {
  const joined = parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" — ");
  return joined || undefined;
}
