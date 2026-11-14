/**
 * Berechtigungs-Ausgrauen auf dem nativen Radar (TrafficMapView.native).
 *
 * Hintergrund (Task #522/#542): Auf Mobile tragen die Geozonen-Kachel-Requests
 * KEIN Session-Cookie (react-native-maps/WebView laden die Kacheln direkt),
 * daher kann das Server-Gate dort nicht greifen. Das Ausgrauen gesperrter
 * Nachbarländer MUSS deshalb clientseitig passieren:
 *   1. ein gesperrtes Land darf KEINE Geozonen-Kachel in die Karte schieben, und
 *   2. der Hinweis "Land freischalten" (testID `hint-locked-countries`) muss es
 *      benennen.
 * Schaltet man das Add-on frei, muss dasselbe Land sichtbar werden (seine
 * Kachel-URL erscheint) und der Hinweis verschwinden.
 *
 * Architektur-Hinweis: Das Radar rendert die Karte (wie der MapPicker) in einem
 * WebView-Leaflet und schiebt den vollständigen Zustand per
 * injectJavaScript(window.__apply(<json>)) hinein. Der Test fängt diese Aufrufe
 * ab und prüft das `geo`-Array (eine Kachel-URL pro freigeschaltetem Land).
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { getViewportCountries } from "@/lib/geozones";
import {
  getEnergyInfrastructureCenterForViewport,
  getRadarEnergyInfrastructureItems,
  type GermanEnergyInfrastructureItem,
} from "../../../shared/germanEnergyInfrastructure";
import type { CountryEntitlementView } from "../../../shared/countryEntitlements";

// useAuth liefert das pro Test gesetzte Entitlement. Eine veränderbare Variable
// erlaubt es, zwischen "nur DE" und "alle Länder" umzuschalten.
let mockEntitlement: CountryEntitlementView | null = null;
jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ entitlement: mockEntitlement }),
}));

// react-native-webview lädt native Module — Platzhalter: meldet sofort "ready"
// (wie die echte Karte nach dem Laden) und reicht eine injectJavaScript-Falle
// über den Ref durch, damit wir den in die Karte geschobenen Zustand prüfen.
const injectedScripts: string[] = [];
let latestWebViewProps: any = null;
jest.mock("react-native-webview", () => {
  const React = require("react");
  const { View } = require("react-native");
  const WebView = React.forwardRef((props: any, ref: any) => {
    latestWebViewProps = props;
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

// aviationWeather zieht transitiv metar-taf-parser (ESM) — im Test stubben, da
// für das Länder-Ausgrauen irrelevant.
jest.mock("@/lib/aviationWeather", () => ({
  __esModule: true,
  fetchAirportStationsInArea: jest.fn().mockResolvedValue([]),
}));

jest.mock("expo-location", () => ({
  __esModule: true,
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: () => {} }),
  watchHeadingAsync: jest.fn().mockResolvedValue({ remove: () => {} }),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: any) => React.createElement(View, props) };
});

// Kind-Komponenten, die native Module ziehen — neutralisieren.
jest.mock("@/components/CtrInfoCard", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { __esModule: true, default: (props: any) => React.createElement(View, props) };
});
jest.mock("@/components/AirportWeatherSheet", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { __esModule: true, default: (props: any) => React.createElement(View, props) };
});

import TrafficMapView from "../TrafficMapView.native";

// Bodensee-Region: Karten-Mitte nahe der DE/CH-Grenze -> Viewport liefert beide
// Länder, sodass CH als Nachbarland gesperrt/freigeschaltet werden kann.
const BODENSEE = {
  latitude: 47.55,
  longitude: 9.18,
  latDelta: 0.5,
  lonDelta: 0.5,
};

let currentTree: ReactTestRenderer | null = null;
function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  currentTree = tree;
  return tree;
}

// Liefert die ISO-Codes der Geozonen-Kacheln aus dem ZULETZT injizierten
// window.__apply(<json>)-Zustand. Das `geo`-Array hält ein Objekt {u: url, ...}
// pro freigeschaltetem Land; die URL trägt den Ländercode im Pfad.
function pushedGeozoneIsos(): string[] {
  const last = [...injectedScripts].reverse().find((js) => js.includes("window.__apply"));
  if (!last) return [];
  const start = last.indexOf("window.__apply(");
  const json = last.slice(start + "window.__apply(".length, last.lastIndexOf(")"));
  let state: any;
  try {
    state = JSON.parse(json);
  } catch {
    return [];
  }
  const geo: Array<{ u?: string }> = Array.isArray(state?.geo) ? state.geo : [];
  return geo
    .map((g) => {
      const m = typeof g.u === "string" ? g.u.match(/\/geozone-tiles\/([a-z]{2})\//) : null;
      return m ? m[1].toUpperCase() : null;
    })
    .filter((iso): iso is string => iso != null);
}

function latestInjectedMapState(): any {
  const last = [...injectedScripts].reverse().find((js) => js.includes("window.__apply"));
  if (!last) return null;
  const start = last.indexOf("window.__apply(");
  try {
    return JSON.parse(last.slice(start + "window.__apply(".length, last.lastIndexOf(")")));
  } catch {
    return null;
  }
}

function infrastructureItem(
  id: string,
  officialMatch: GermanEnergyInfrastructureItem["officialMatch"],
  kind: GermanEnergyInfrastructureItem["kind"] = "wind_turbine",
): GermanEnergyInfrastructureItem {
  return {
    id,
    kind,
    name: id,
    source: "OpenStreetMap",
    geometry: { type: "Point", coordinates: [13, 52] },
    distanceMeters: 100,
    officialMatch,
  };
}

function infrastructureSource(status: "available" | "stale" | "partial" | "unavailable") {
  return { status, updatedAt: null };
}

// react-test-renderer listet pro <View testID> sowohl die Composite- als auch
// die Host-Instanz auf; für "sichtbar?" zählt daher nur, ob mindestens ein
// Treffer existiert.
function lockedHintShown(tree: ReactTestRenderer): boolean {
  return (
    tree.root.findAll(
      (node) => node.props?.testID === "hint-locked-countries",
      { deep: true },
    ).length > 0
  );
}

// Sammelt alle gerenderten Text-Strings (Host-"Text"-Knoten) im Baum. Robust
// gegen zirkuläre TestInstance-Referenzen (kein JSON.stringify der Props).
function allRenderedText(tree: ReactTestRenderer): string {
  const texts: string[] = [];
  tree.root.findAll(
    (node) => {
      if (node.type === "Text") {
        const kids = node.props?.children;
        const flat = Array.isArray(kids) ? kids : [kids];
        for (const k of flat) {
          if (typeof k === "string" || typeof k === "number") texts.push(String(k));
        }
      }
      return false;
    },
    { deep: true },
  );
  return texts.join(" ");
}

beforeEach(() => {
  injectedScripts.length = 0;
  latestWebViewProps = null;
  // Netzwerk-Effekte (ED-269/Elevation/Wetter) ins Leere laufen lassen.
  jest.spyOn(global, "fetch" as any).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  } as any);
});

afterEach(() => {
  if (currentTree) {
    act(() => {
      currentTree?.unmount();
    });
    currentTree = null;
  }
  jest.restoreAllMocks();
});

describe("TrafficMapView.native Länder-Ausgrauen (Radar)", () => {
  it("Sanity: der Bodensee-Ausschnitt liefert DE UND CH", () => {
    const isos = getViewportCountries(
      BODENSEE.latitude,
      BODENSEE.longitude,
      BODENSEE.latDelta,
      BODENSEE.lonDelta,
    );
    expect(isos).toContain("DE");
    expect(isos).toContain("CH");
  });

  it("Nur-DE-Abo: CH ist gesperrt -> keine CH-Kachel, Hinweis nennt die Schweiz", () => {
    mockEntitlement = { active: true, allCountries: false, countries: ["DE"] };

    const tree = render(
      <TrafficMapView
        latitude={BODENSEE.latitude}
        longitude={BODENSEE.longitude}
        latDelta={BODENSEE.latDelta}
        lonDelta={BODENSEE.lonDelta}
        countryIso="DE"
        markers={[]}
      />,
    );

    const isos = pushedGeozoneIsos();
    // Freigeschaltetes Land wird gezeichnet ...
    expect(isos).toContain("DE");
    // ... das gesperrte Nachbarland NICHT.
    expect(isos).not.toContain("CH");

    // Hinweis sichtbar und benennt das gesperrte Land.
    expect(lockedHintShown(tree)).toBe(true);
    expect(allRenderedText(tree)).toContain("Schweiz");
  });

  it("Voll-Zugriff (allCountries): CH ist freigeschaltet -> CH-Kachel erscheint, kein Hinweis", () => {
    mockEntitlement = { active: true, allCountries: true, countries: [] };

    const tree = render(
      <TrafficMapView
        latitude={BODENSEE.latitude}
        longitude={BODENSEE.longitude}
        latDelta={BODENSEE.latDelta}
        lonDelta={BODENSEE.lonDelta}
        countryIso="DE"
        markers={[]}
      />,
    );

    const isos = pushedGeozoneIsos();
    expect(isos).toContain("DE");
    // Das zuvor gesperrte Land rendert jetzt seine Geozonen.
    expect(isos).toContain("CH");

    // Kein Freischalt-Hinweis mehr.
    expect(lockedHintShown(tree)).toBe(false);
  });

  it("CH-Add-on freigeschaltet: gezielt nur CH dazugebucht -> CH sichtbar, kein Hinweis", () => {
    mockEntitlement = { active: true, allCountries: false, countries: ["DE", "CH"] };

    const tree = render(
      <TrafficMapView
        latitude={BODENSEE.latitude}
        longitude={BODENSEE.longitude}
        latDelta={BODENSEE.latDelta}
        lonDelta={BODENSEE.lonDelta}
        countryIso="DE"
        markers={[]}
      />,
    );

    const isos = pushedGeozoneIsos();
    expect(isos).toContain("DE");
    expect(isos).toContain("CH");
    expect(lockedHintShown(tree)).toBe(false);
  });
});

// This suite inspects the injected map geometry, not native network reachability.
jest.mock("@/lib/geozones", () => ({
  ...jest.requireActual("@/lib/geozones"),
  queryEd269CachedFeatures: jest.fn(async () => []),
}));

describe("TrafficMapView.native ergänzende Infrastruktur", () => {
  it("Belgische Ergänzungen nutzen normale Vektoren und bleiben neben amtlichen Rasterkacheln sichtbar", () => {
    mockEntitlement = { active: true, allCountries: true, countries: [] };
    const tower = { ...infrastructureItem("tower-gap", "not_found", "power_mast"),
      name: "Mast", geometry: { type: "Point", coordinates: [4.38, 50.87] } };
    const line = { ...infrastructureItem("line-gap", "not_found", "power_line"),
      name: "Leitung", geometry: { type: "LineString", coordinates: [[4.38,50.87],[4.381,50.871]] } };
    render(<TrafficMapView latitude={50.87} longitude={4.38} latDelta={0.01} lonDelta={0.01}
      countryIso="BE" markers={[]} energyInfrastructure={[tower, line,
        infrastructureItem("unknown", "unknown"), infrastructureItem("matched", "matched")]} />);
    const state = latestInjectedMapState();
    const mast = state.vz.find((zone: any) => zone.t === "Mast");
    const powerLine = state.vz.find((zone: any) => zone.t === "Leitung");
    expect(state.energy).toEqual([]);
    expect(state.windBuffers).toEqual([]);
    expect(mast.hide).toBe(false);
    expect(mast.r).toEqual([]);
    expect(mast.p).toEqual([[50.87,4.38]]);
    expect(powerLine.hide).toBe(false);
    expect(powerLine.r).toEqual([]);
    expect(powerLine.l).toEqual([[[50.87,4.38],[50.871,4.381]]]);
    expect(state.vz.some((zone: any) => ["unknown", "matched"].includes(zone.t))).toBe(false);
    expect(mast.d.join("\n")).toContain("Infrastrukturhinweis");
    expect(mast.d.join("\n")).not.toContain("21h");
  });
  it("Ergänzende Anlagen: Toggle und amtlicher Layer lassen nur bestätigte Lücken durch", () => {
    const items = [
      infrastructureItem("verified-wind-gap", "not_found"),
      infrastructureItem("official-match", "matched"),
      infrastructureItem("unknown-wind", "unknown"),
      infrastructureItem("unavailable-power", "not_found", "power_line"),
    ];
    const sources = {
      officialWind: infrastructureSource("available"),
      officialPower: infrastructureSource("unavailable"),
    };
    const statusKeyByKind = {
      wind_turbine: "officialWind",
      power_line: "officialPower",
    } as const;

    expect(getRadarEnergyInfrastructureItems(true, items, sources, statusKeyByKind).map((item) => item.id))
      .toEqual(["verified-wind-gap"]);
    expect(getRadarEnergyInfrastructureItems(false, items, sources, statusKeyByKind)).toEqual([]);
    expect(getRadarEnergyInfrastructureItems(true, items, undefined, statusKeyByKind)).toEqual([]);

    const frenchPowerLine = infrastructureItem("french-power-gap", "not_found", "power_line");
    expect(
      getRadarEnergyInfrastructureItems(
        true,
        [frenchPowerLine],
        { ignFrancePower: infrastructureSource("available") },
        { power_line: "ignFrancePower" },
      ).map((item) => item.id),
    ).toEqual(["french-power-gap"]);
  });

  it("Belgische Hochspannungsleitungen und Masten werden bei vollständigem NGI-Layer freigeschaltet", () => {
    const belgianLine = infrastructureItem("ngi-line-gap", "not_found", "power_line");
    const belgianTower = infrastructureItem("ngi-tower-gap", "not_found", "power_mast");
    const sources = { ngiBelgiumPower: infrastructureSource("available") };
    const statusKeyByKind = {
      power_line: "ngiBelgiumPower",
      power_mast: "ngiBelgiumPower",
    } as const;

    expect(
      getRadarEnergyInfrastructureItems(
        true,
        [belgianLine, belgianTower],
        sources,
        statusKeyByKind,
      ).map((item) => item.id),
    ).toEqual(["ngi-line-gap", "ngi-tower-gap"]);
    expect(
      getRadarEnergyInfrastructureItems(
        true,
        [belgianLine, belgianTower],
        { ngiBelgiumPower: infrastructureSource("partial") },
        statusKeyByKind,
      ),
    ).toEqual([]);
  });

  it("Leaflet erhält weder amtlich gefundene noch unbekannte OSM-Anlagen", () => {
    const visibleGap = infrastructureItem("verified-wind-gap", "not_found");
    const tree = render(
      <TrafficMapView
        latitude={52}
        longitude={13}
        latDelta={0.2}
        lonDelta={0.2}
        countryIso="DE"
        markers={[]}
        energyInfrastructure={[
          visibleGap,
          { ...infrastructureItem("official-match", "matched"), geometry: { type: "Point", coordinates: [13.02, 52] } },
          infrastructureItem("unknown", "unknown"),
        ]}
      />,
    );

    expect(latestInjectedMapState()?.energy?.map((item: any) => item.id))
      .toEqual([]);
    expect(latestInjectedMapState()?.vz?.map((zone: any) => zone.t))
      .toEqual([visibleGap.name]);
    expect(latestInjectedMapState()?.vz?.[0]?.r?.[0]?.[0]?.length).toBeGreaterThan(3);
    expect(latestWebViewProps?.source?.html).toContain("energyLayer.clearLayers()");
    expect(tree).toBeTruthy();
  });

  it("weit entferntes Panning aktualisiert das Abfragezentrum und entfernt alte Marker", () => {
    const initialCenter = { latitude: 52, longitude: 13 };
    const onViewportChange = jest.fn();
    const tree = render(
      <TrafficMapView
        latitude={initialCenter.latitude}
        longitude={initialCenter.longitude}
        latDelta={0.2}
        lonDelta={0.2}
        countryIso="DE"
        markers={[]}
        energyInfrastructure={[infrastructureItem("old-area-marker", "not_found")]}
        onViewportChange={onViewportChange}
      />,
    );

    act(() => {
      latestWebViewProps.onMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: "region",
            lat: 48,
            lon: 9,
            latDelta: 0.4,
            lonDelta: 0.6,
          }),
        },
      });
    });

    const bbox = {
      latMin: 47.8,
      latMax: 48.2,
      lonMin: 8.7,
      lonMax: 9.3,
    };
    expect(onViewportChange).toHaveBeenCalledWith(bbox);
    const nextCenter = getEnergyInfrastructureCenterForViewport(initialCenter, bbox);
    expect(nextCenter).toEqual({ latitude: 48, longitude: 9 });

    act(() => {
      tree.update(
        <TrafficMapView
          latitude={nextCenter.latitude}
          longitude={nextCenter.longitude}
          latDelta={0.4}
          lonDelta={0.6}
          countryIso="DE"
          markers={[]}
          energyInfrastructure={[]}
          onViewportChange={onViewportChange}
        />,
      );
    });

    expect(latestInjectedMapState()?.energy).toEqual([]);
    expect(latestInjectedMapState()?.user).toEqual([48, 9]);
  });
});
