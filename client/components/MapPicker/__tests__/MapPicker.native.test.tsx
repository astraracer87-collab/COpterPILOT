/**
 * Stellt sicher, dass der Standort-Picker (jetzt Leaflet/WebView statt nativer
 * MapKit-Kacheln) GENAU EINE Geozonen-Kachel-URL pro Land in den WebView
 * schiebt — und NICHT eine pro WMS-Layer. Diese Bündelung ist die
 * Abstürz-Vermeidung: das dipul-WMS scheitert ab ~28 Layern, deshalb fasst der
 * Server alle Layer eines Landes zu einer Kachel zusammen.
 *
 * Architektur-Hinweis: Die Kachel-URLs stecken nicht mehr in <UrlTile>-
 * Komponenten, sondern im JSON, das die Komponente per `injectJavaScript`
 * (window.__apply(...)) in die Karte schiebt. Der Test fängt diese Aufrufe ab.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { getViewportCountries } from "@/lib/geozones";
import MapPicker from "../MapPicker.native";

// react-native-webview lädt native Module — im Test durch einen Platzhalter
// ersetzt: er meldet sofort "ready" (wie die echte Karte nach dem Laden) und
// reicht eine injectJavaScript-Falle über den Ref durch, damit wir den
// vollständigen, in die Karte geschobenen Zustand prüfen können.
const injectedScripts: string[] = [];

jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  const WebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: (js: string) => {
        injectedScripts.push(js);
      },
    }));
    React.useEffect(() => {
      props.onMessage?.({ nativeEvent: { data: JSON.stringify({ type: "ready" }) } });
    }, []);
    return React.createElement(View, null, props.children);
  });
  WebView.displayName = "WebView";
  return { __esModule: true, WebView };
});

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

// useAuth liefert hier einen Voll-Zugriff (allCountries), damit die Tests die
// Kachel-Bündelung prüfen, ohne dass Länder als gesperrt gegraut werden.
jest.mock("@/lib/auth", () => ({
  useAuth: jest.fn(() => ({ entitlement: { active: true, allCountries: true, countries: [] } })),
}));
const mockedUseAuth = require("@/lib/auth").useAuth as jest.Mock;

jest.mock("expo-location", () => ({
  __esModule: true,
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: () => {} }),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => React.createElement(View, props) };
});

jest.mock("@/components/CtrInfoCard", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { __esModule: true, default: (props: any) => React.createElement(View, props) };
});

const GEOZONE_TILE_MARKER = "/api/proxy/geozone-tiles/";
const ENERGY_TILE_MARKER = "/api/proxy/energy-infrastructure-tiles/";

// Liefert die Geozonen-Kachel-URLs aus dem ZULETZT injizierten __apply-Zustand.
// Die JSON-String-Werte sind durch Anführungszeichen begrenzt; ein Split daran
// isoliert jeden String-Literal sauber.
function geozoneTileUrls(): string[] {
  const last = [...injectedScripts].reverse().find((js) => js.includes("window.__apply"));
  if (!last) return [];
  return last.split('"').filter((token) => token.includes(GEOZONE_TILE_MARKER));
}

function isoOf(url: string): string | null {
  const match = url.match(/\/geozone-tiles\/([a-z]{2})\//);
  return match ? match[1] : null;
}

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  renderedTrees.push(tree);
  return tree;
}

const renderedTrees: ReactTestRenderer[] = [];

afterEach(async () => {
  // Let the persisted basemap preference settle before tearing down mounted
  // pickers so their async initial load cannot update a finished Jest runtime.
  await act(async () => {
    await Promise.resolve();
  });
  for (const tree of renderedTrees.splice(0)) {
    act(() => tree.unmount());
  }
  mockedUseAuth.mockReturnValue({
    entitlement: { active: true, allCountries: true, countries: [] },
  });
});

const BERLIN = {
  latitude: 52.52,
  longitude: 13.405,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

// Bodensee-Region: Karten-Mitte liegt nahe der DE/CH-Grenze, daher liefert
// getViewportCountries zwei Länder.
const BODENSEE = {
  latitude: 47.55,
  longitude: 9.18,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

describe("MapPicker.native Geozonen-Overlay (WebView)", () => {
  beforeEach(() => {
    injectedScripts.length = 0;
  });

  it("schiebt EINE Kachel-URL pro Land, auch wenn mehrere Layer gewählt sind (Einzelland)", () => {
    const manyLayers = [
      "kontrollzonen",
      "flugbeschraenkungsgebiete",
      "flughaefen",
      "flugplaetze",
      "naturschutzgebiete",
      "militaerische_anlagen",
    ];
    render(<MapPicker initialRegion={BERLIN} geozoneLayers={manyLayers} countryIso="DE" />);

    const urls = geozoneTileUrls();
    // Genau EINE Kachel-URL fürs Land — nicht eine pro Layer.
    expect(urls).toHaveLength(1);
    expect(isoOf(urls[0])).toBe("de");
    // Alle gewählten Layer stecken in derselben Kachel-URL.
    for (const layer of manyLayers) {
      expect(decodeURIComponent(urls[0])).toContain(layer);
    }
  });

  it("buendelt auch den Standardfall (alle Layer, keine Auswahl) in EINE Kachel", () => {
    render(<MapPicker initialRegion={BERLIN} geozoneLayers={[]} />);
    const urls = geozoneTileUrls();
    expect(urls).toHaveLength(1);
    expect(isoOf(urls[0])).toBe("de");
    // Bestaetigt, dass es sich wirklich um viele Layer in einer URL handelt.
    const layerParam = decodeURIComponent(urls[0].split("layers=")[1] ?? "");
    expect(layerParam.split(",").length).toBeGreaterThan(10);
  });

  it("laedt die deutsche Anlagen-Kachelebene fuer einen freigeschalteten DE-Ausschnitt", () => {
    render(<MapPicker initialRegion={BERLIN} allCountriesGeozones />);
    const last = [...injectedScripts].reverse().find((js) => js.includes("window.__apply")) ?? "";
    expect(last).toContain(ENERGY_TILE_MARKER);
    expect(last).toContain("?supplemental=1");
  });

  it("zeigt die deutsche Anlagen-Kachelebene ausserhalb Deutschlands nicht", () => {
    render(
      <MapPicker
        initialRegion={{ latitude: 48.8566, longitude: 2.3522, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
        allCountriesGeozones
      />,
    );
    const last = [...injectedScripts].reverse().find((js) => js.includes("window.__apply")) ?? "";
    expect(last).not.toContain(ENERGY_TILE_MARKER);
  });

  it("fordert deutsche Anlagen-Kacheln bei gesperrtem Deutschland nicht an", () => {
    mockedUseAuth.mockReturnValue({
      entitlement: { active: true, allCountries: false, countries: ["FR"] },
    });
    render(<MapPicker initialRegion={BERLIN} allCountriesGeozones />);
    const last = [...injectedScripts].reverse().find((js) => js.includes("window.__apply")) ?? "";
    expect(last).not.toContain(ENERGY_TILE_MARKER);
    expect(geozoneTileUrls()).toHaveLength(0);
  });

  it("Viewport-Modus: EINE Kachel pro erkanntem Land (Einzelland-Mitte)", () => {
    const expected = getViewportCountries(
      BERLIN.latitude,
      BERLIN.longitude,
      BERLIN.latitudeDelta,
      BERLIN.longitudeDelta,
    );
    expect(expected).toEqual(["DE"]);

    render(<MapPicker initialRegion={BERLIN} allCountriesGeozones />);
    const urls = geozoneTileUrls();
    const isos = urls.map(isoOf);

    expect(urls).toHaveLength(expected.length);
    expect(isos).toEqual(expected.map((c) => c.toLowerCase()));
  });

  it("Viewport-Modus: EINE Kachel pro Land an der Grenze (Mehrländer-Mitte), nicht pro Layer", () => {
    const expected = getViewportCountries(
      BODENSEE.latitude,
      BODENSEE.longitude,
      BODENSEE.latitudeDelta,
      BODENSEE.longitudeDelta,
    );
    // Sanity: dieser Ausschnitt liefert tatsächlich mehrere Länder.
    expect(expected.length).toBeGreaterThanOrEqual(2);

    render(<MapPicker initialRegion={BODENSEE} allCountriesGeozones />);
    const urls = geozoneTileUrls();
    const isos = urls.map((u) => isoOf(u));

    // Eine Kachel pro Land — Anzahl == Anzahl Länder.
    expect(urls).toHaveLength(expected.length);
    // Jedes Land genau einmal (keine Duplikate, keine Kachel-pro-Layer).
    expect(new Set(isos).size).toBe(expected.length);
    expect(new Set(isos)).toEqual(new Set(expected.map((c) => c.toLowerCase())));
  });
});
