import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminSourceSuffix,
  geozoneBadgeLabel,
  filterGeozoneDetailLines,
  attributionLabel,
  weatherSourceLabel,
} from "../sourceAttribution";

// Regressionsschutz: Normale Piloten dürfen KEINE Hinweise auf die
// zugrunde liegenden Datenquellen (Wetter, NOTAMs, Geozonen, Live-Verkehr)
// sehen — diese sind nur für Admins sichtbar. Diese Helfer kapseln die
// render-time-Entscheidungen, die zuvor inline über ~12 Screens dupliziert
// waren. Spiegelt die Nutzung in StandaloneLiveTrafficScreen + NotamsScreen.

// Stellvertretend für Object.values(ED269_SOURCE_LABELS).
const ED269_LABELS = [
  "Austro Control (ED-269)",
  "skeyes / Droneguide (ED-269)",
  "Trafikstyrelsen (Dänemark)",
];

// adminSourceSuffix: angehängter Quellen-Erläuterungstext (Wetter-/NOTAM-/
// Verkehrs-Info-Panel) nur für Admins.

test("adminSourceSuffix: Pilot sieht KEINEN Quellen-Suffix", () => {
  assert.equal(adminSourceSuffix("Daten von DFS dipul", false), "");
});

test("adminSourceSuffix: Admin sieht den Quellen-Suffix (mit Trenner)", () => {
  assert.equal(
    adminSourceSuffix("Daten von DFS dipul", true),
    "\n\nDaten von DFS dipul",
  );
});

test("adminSourceSuffix: leerer/fehlender Quelltext -> kein Suffix (auch für Admin)", () => {
  assert.equal(adminSourceSuffix("", true), "");
  assert.equal(adminSourceSuffix(undefined, true), "");
  assert.equal(adminSourceSuffix(null, true), "");
});

test("adminSourceSuffix: eigener Trenner wird übernommen", () => {
  assert.equal(adminSourceSuffix("Quelle X", true, " — "), " — Quelle X");
});

// geozoneBadgeLabel: ED-269-Quellen-Label nur für Admins; Piloten sehen das
// neutrale "Geozone".

test("geozoneBadgeLabel: Pilot sieht 'Geozone' statt des ED-269-Quell-Labels", () => {
  assert.equal(
    geozoneBadgeLabel("skeyes / Droneguide (ED-269)", false, ED269_LABELS),
    "Geozone",
  );
});

test("geozoneBadgeLabel: Admin sieht das echte ED-269-Quell-Label", () => {
  assert.equal(
    geozoneBadgeLabel("skeyes / Droneguide (ED-269)", true, ED269_LABELS),
    "skeyes / Droneguide (ED-269)",
  );
});

test("geozoneBadgeLabel: Nicht-ED-269-Label bleibt für Piloten unverändert", () => {
  // WMS-Layer-Labels (z. B. CTR) sind keine Quellenangaben -> nicht maskiert.
  assert.equal(geozoneBadgeLabel("Kontrollzone (CTR)", false, ED269_LABELS), "Kontrollzone (CTR)");
});

// filterGeozoneDetailLines: "Quelle: …"-Zeilen nur für Admins; leere Zeilen
// immer raus.

test("filterGeozoneDetailLines: Pilot sieht KEINE Quelle-Zeile", () => {
  const details = "Status: Aktiv\nQuelle: dipul WMS\nHöhe: 100 m";
  assert.deepEqual(filterGeozoneDetailLines(details, false), [
    "Status: Aktiv",
    "Höhe: 100 m",
  ]);
});

test("filterGeozoneDetailLines: Admin sieht die Quelle-Zeile", () => {
  const details = "Status: Aktiv\nQuelle: dipul WMS\nHöhe: 100 m";
  assert.deepEqual(filterGeozoneDetailLines(details, true), [
    "Status: Aktiv",
    "Quelle: dipul WMS",
    "Höhe: 100 m",
  ]);
});

test("filterGeozoneDetailLines: Filter ist case-insensitive ('quelle:'/'QUELLE:')", () => {
  const details = "quelle: x\nQUELLE: y\nName: Z";
  assert.deepEqual(filterGeozoneDetailLines(details, false), ["Name: Z"]);
});

test("filterGeozoneDetailLines: leere Zeilen werden immer entfernt", () => {
  const details = "Status: Aktiv\n\n   \nHöhe: 100 m";
  assert.deepEqual(filterGeozoneDetailLines(details, true), [
    "Status: Aktiv",
    "Höhe: 100 m",
  ]);
});

// attributionLabel: Admin sieht den quellenhaltigen Text (z. B. "… auf
// dipul.de"), Pilot den neutralen Text ohne Quellenhinweis. Spiegelt die
// Nutzung in PlanningNotamsScreen / PreCheckOverviewScreen (Link-Labels),
// PlanningRestrictionsScreen (Fehlermeldung + "Temporär (dipul)"-Badge).

test("attributionLabel: Pilot sieht den neutralen Text (kein dipul.de)", () => {
  assert.equal(
    attributionLabel(false, "Karte und Details auf dipul.de", "Karte und Details ansehen"),
    "Karte und Details ansehen",
  );
});

test("attributionLabel: Admin sieht den quellenhaltigen Text", () => {
  assert.equal(
    attributionLabel(true, "Karte und Details auf dipul.de", "Karte und Details ansehen"),
    "Karte und Details auf dipul.de",
  );
});

test("attributionLabel: Pilot-Badge zeigt 'Temporär' ohne Quelle, Admin 'Temporär (dipul)'", () => {
  assert.equal(attributionLabel(false, "Temporär (dipul)", "Temporär"), "Temporär");
  assert.equal(attributionLabel(true, "Temporär (dipul)", "Temporär"), "Temporär (dipul)");
});

// weatherSourceLabel: Wetterquelle (DFS dipul / DWD BrightSky) nur für Admins.
// Spiegelt HourlyForecastTable (ohne Prefix/Modell) + PlanningDetailsScreen
// (mit Prefix "Quelle: " + Modell "(ICON-D2)" nur für dipul).

test("weatherSourceLabel: Pilot sieht KEIN Wetter-Quellen-Label", () => {
  assert.equal(weatherSourceLabel("dipul", false), "");
  assert.equal(weatherSourceLabel("brightsky", false), "");
});

test("weatherSourceLabel: Admin sieht das Basis-Label (ohne Prefix/Modell)", () => {
  assert.equal(weatherSourceLabel("dipul", true), "DFS dipul");
  assert.equal(weatherSourceLabel("brightsky", true), "DWD BrightSky");
});

test("weatherSourceLabel: leere/fehlende Quelle -> kein Label (auch für Admin)", () => {
  assert.equal(weatherSourceLabel("", true), "");
  assert.equal(weatherSourceLabel(undefined, true), "");
  assert.equal(weatherSourceLabel(null, true), "");
});

test("weatherSourceLabel: Prefix + Modell (ICON-D2 nur für dipul)", () => {
  assert.equal(
    weatherSourceLabel("dipul", true, { withModel: true, prefix: "Quelle: " }),
    "Quelle: DFS dipul (ICON-D2)",
  );
  assert.equal(
    weatherSourceLabel("brightsky", true, { withModel: true, prefix: "Quelle: " }),
    "Quelle: DWD BrightSky",
  );
});

console.log("sourceAttribution (mobile): alle Tests definiert");
