/**
 * Sichert die Verdrahtung des "Zurück"-Header-Buttons im FlightPlanning-Navigator
 * gegen eine stille Regression ab (Task #625/#630).
 *
 * Hintergrund: Beim Direkteinstieg (Fortsetzen/Bearbeiten aus den Briefings)
 * springt der Pilot per rootNav.navigate("FlightPlanning", { screen: … }) mitten
 * in den Stack. "Zurück" darf dann NICHT auf einen nie gesehenen Schritt
 * (PlanningDroneSelect) zurückblättern, sondern muss das ganze Modal über den
 * Eltern-Navigator verlassen. Die reine Entscheidung (decidePlanningBackAction)
 * ist in client/lib/__tests__/manualRestrictionFlow.test.ts abgedeckt; HIER wird
 * die tatsächliche Verdrahtung geprüft:
 *   1. Der Navigator reicht route.params?.directEntry an den Button durch.
 *   2. Der Button liest navigation.getParent()/canGoBack() und ruft beim
 *      Direkteinstieg parent.goBack() (Modal verlassen), im Normalfall
 *      navigation.goBack() (ein Schritt im eigenen Stack).
 *
 * Statt den nativen Header zu rendern (native-stack rendert Header nativ, nicht
 * im JS-Baum) fängt der Test die je Stack.Screen übergebenen `options` ab,
 * löst headerLeft mit einer Fake-Navigation auf und drückt den echten Button.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

// --- native-stack abfangen: je Screen den name->options-Eintrag merken --------
const recordedOptions: Record<string, any> = {};
jest.mock("@react-navigation/native-stack", () => {
  const ReactLocal = require("react");
  return {
    __esModule: true,
    createNativeStackNavigator: () => ({
      Navigator: ({ children }: any) =>
        ReactLocal.createElement(ReactLocal.Fragment, null, children),
      Screen: (props: any) => {
        recordedOptions[props.name] = props.options;
        return null;
      },
    }),
  };
});

// --- leichte Stubs für Navigator-Abhängigkeiten -------------------------------
jest.mock("@/hooks/useScreenOptions", () => ({
  __esModule: true,
  useScreenOptions: () => ({}),
}));
jest.mock("@/lib/flightPlanningMode", () => ({
  __esModule: true,
  setFlightPlanningMode: jest.fn(),
}));
// WeatherSnapshot/WeatherLimits werden nur als Typen importiert; storage.ts ist
// schwergewichtig (api/AsyncStorage) und wird hier neutralisiert.
jest.mock("@/lib/storage", () => ({ __esModule: true }));

// Alle vom Navigator importierten Screens durch leere Komponenten ersetzen, damit
// das Importieren des Navigators keine nativen Module (Maps/WebView/…) lädt. Die
// Screens werden im Test nie gerendert (Navigator-Mock rendert sie nicht).
const SCREEN_MODULES = [
  "PlanningDroneSelectScreen",
  "PlanningCountrySelectScreen",
  "PlanningLocationScreen",
  "PlanningCrossCheckScreen",
  "PlanningAreaOverviewScreen",
  "PlanningMapScreen",
  "PlanningDateTimeScreen",
  "PlanningRestrictionsScreen",
  "PlanningDetailsScreen",
  "PlanningFpvSelectScreen",
  "PlanningChecklistScreen",
  "PlanningResultScreen",
  "PlanningNotamsScreen",
  "StandaloneLiveTrafficScreen",
  "PlanningNotamMapScreen",
  "PlanningZoneFocusScreen",
  "NaturschutzMapScreen",
  "GoDroneMapScreen",
  "PlanningExternalMapScreen",
  "DflightItalyGuideScreen",
];
for (const name of SCREEN_MODULES) {
  jest.mock(`@/screens/${name}`, () => ({ __esModule: true, default: () => null }));
}

// require (statt import), damit die NICHT-gehoisteten Screen-Mocks oben bereits
// registriert sind, bevor der Navigator (und damit seine Screen-Imports) lädt.
const FlightPlanningNavigator = require("../FlightPlanningNavigator").default;

// Fake-Navigation: ein Eltern-Navigator (RootStack), der zurück kann, plus eigener
// Stack. goBack beider Ebenen ist beobachtbar.
function makeNavigation(opts?: {
  parentCanGoBack?: boolean;
  selfCanGoBack?: boolean;
  hasParent?: boolean;
}) {
  const parentGoBack = jest.fn();
  const selfGoBack = jest.fn();
  const parent = {
    goBack: parentGoBack,
    canGoBack: () => opts?.parentCanGoBack ?? true,
  };
  const navigation = {
    goBack: selfGoBack,
    canGoBack: () => opts?.selfCanGoBack ?? true,
    getParent: () => ((opts?.hasParent ?? true) ? parent : undefined),
  };
  return { navigation, parentGoBack, selfGoBack };
}

// Löst headerLeft für einen Screen mit gegebenem directEntry-Param auf, rendert
// den Button und liefert seine onPress-Funktion + die goBack-Spione.
function pressBackButton(
  screenName: string,
  directEntry: boolean | undefined,
  navOpts?: Parameters<typeof makeNavigation>[0],
) {
  const optionsFactory = recordedOptions[screenName];
  if (typeof optionsFactory !== "function") {
    throw new Error(`Screen ${screenName} hat keine options-Factory (Verdrahtung geändert?)`);
  }
  const { navigation, parentGoBack, selfGoBack } = makeNavigation(navOpts);
  const route = { params: directEntry === undefined ? {} : { directEntry } };
  const resolved = optionsFactory({ navigation, route });
  if (typeof resolved.headerLeft !== "function") {
    throw new Error(`Screen ${screenName} hat keinen headerLeft (Verdrahtung geändert?)`);
  }

  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(resolved.headerLeft());
  });
  // Das erste pressbare Element mit onPress ist der "Zurück"-Button.
  const pressable = tree.root.find(
    (n) => typeof n.props?.onPress === "function" && n.props?.hitSlop !== undefined,
  );
  act(() => {
    pressable.props.onPress();
  });
  act(() => {
    tree.unmount();
  });
  return { parentGoBack, selfGoBack };
}

// Screens, deren "Zurück" per Direkteinstieg das Modal verlassen muss.
const DIRECT_ENTRY_SCREENS = [
  "PlanningDateTime",
  "PlanningDetails",
  "PlanningChecklist",
];

beforeAll(() => {
  // Navigator einmal rendern -> füllt recordedOptions über die Screen-Mocks.
  // Wichtig: create und unmount in GETRENNTEN act-Blöcken — wird im selben Block
  // sofort wieder ge-unmountet, committen die Screen-Kinder nicht (recordedOptions
  // bliebe leer).
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(React.createElement(FlightPlanningNavigator));
  });
  act(() => {
    tree.unmount();
  });
});

describe("FlightPlanning 'Zurück'-Button: Direkteinstieg verlässt das Modal sauber", () => {
  it("registriert für die Direkteinstiegs-Screens eine headerLeft-Verdrahtung", () => {
    for (const screen of DIRECT_ENTRY_SCREENS) {
      expect(typeof recordedOptions[screen]).toBe("function");
    }
  });

  for (const screen of DIRECT_ENTRY_SCREENS) {
    it(`${screen}: directEntry=true -> Eltern-goBack (Modal verlassen), NICHT eigener Stack`, () => {
      const { parentGoBack, selfGoBack } = pressBackButton(screen, true);
      expect(parentGoBack).toHaveBeenCalledTimes(1);
      expect(selfGoBack).not.toHaveBeenCalled();
    });

    it(`${screen}: ohne directEntry -> ein Schritt im eigenen Stack, NICHT Modal verlassen`, () => {
      const { parentGoBack, selfGoBack } = pressBackButton(screen, undefined);
      expect(selfGoBack).toHaveBeenCalledTimes(1);
      expect(parentGoBack).not.toHaveBeenCalled();
    });

    it(`${screen}: directEntry=false -> ein Schritt im eigenen Stack (Neu-Planungs-Flow)`, () => {
      const { parentGoBack, selfGoBack } = pressBackButton(screen, false);
      expect(selfGoBack).toHaveBeenCalledTimes(1);
      expect(parentGoBack).not.toHaveBeenCalled();
    });
  }

  it("PlanningDateTime: Direkteinstieg OHNE eigene Stack-History verlässt trotzdem das Modal", () => {
    const { parentGoBack, selfGoBack } = pressBackButton("PlanningDateTime", true, {
      selfCanGoBack: false,
      parentCanGoBack: true,
    });
    expect(parentGoBack).toHaveBeenCalledTimes(1);
    expect(selfGoBack).not.toHaveBeenCalled();
  });
});
