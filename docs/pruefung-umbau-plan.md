# Umbau der Prüflogik – Plan (Stand 2026-11-15)

Grundlage: Logik-Review und Vollständigkeits-Abgleich mit der Replit-Fassung
(2026-11-15). Die Sicherheitskorrekturen 1–8 sind umgesetzt (Commit 8e5b670).
Dieses Dokument beschreibt den weiteren Umbau (Teil B) und die
Aktualisierungsstrategie (Teil A). Jeder Schritt: klein, eigener Commit,
komplette Testsuite grün (tsc, jest, alle node:test-Dateien in
client/lib/__tests__).

## Offene Befunde aus dem Review (nach Korrekturen 1–8)

- **Aktivität (B7 im Review):** drei verschiedene Aktivitätsprüfungen.
  `geozoneIsActiveAt` (shared/ed269Restriction.ts) wertet nur
  `ed269Applicability`; Zonen mit reinem `validStartTs`/`validEndTs` gelten als
  aktiv. Radar-Reiter/Hervorhebung (client/lib/geozoneSeverity.ts,
  StandaloneLiveTrafficScreen `isZoneFutureOnly`) parsen Detailtext
  („Status: Inaktiv“, „Von:“). Zeitbezug je Screen unterschiedlich (Planung:
  geplante Zeit; Pre-Check: jetzt ODER geplant; Pre-Check-Karte: jetzt;
  Standort-Vorschau: keiner). `isGeozoneExpired` wird schon beim Parsen mit
  `Date.now()` angewandt (client/lib/ed269.ts).
- **Einstufung (B8, I1, I2, I8):** Planungsliste wertet `restriction` nicht
  aus (alles orange); RESTRICTED hat drei Bedeutungen; „Info“ je Land anders;
  unbekannte Werte werden durchgereicht; temporäre Zonen im Radar immer orange.
- **Höhen (B3, B9, B10):** `upperReference` geht verloren
  (GeozoneFeatureInfo hat kein Feld); CZ (tileZones.ts) kennt FL/STD nicht;
  `ed269LimitMeters` kennt FL nicht; unbekannter Bezug wird AGL (unsicher);
  Gelände nur am Mittelpunkt statt Maximum im Radius.
- **Struktur (I4, I5, S4, S5):** Länderlisten an ~10 Stellen
  (VECTOR_ISOS doppelt in PlanningRestrictionsScreen, ED269_DIRECT_COUNTRIES,
  ED269_SOURCE_LABELS, GEOZONE_VECTOR_COUNTRY_MIN_ZOOM,
  OWN_MAP_DATA_COUNTRIES, COUNTRY_GEOZONE_CONFIGS, dataSources …);
  Sonderfälle per `iso ===` im gemeinsamen Code; doppelte Helfer
  (round1 6×, cleanText 4×, applyAltitudes 3×, eigene Höhenparser in ~10
  Normalisierern, 0.3048 in 13 Dateien).
- **Kleinkram:** Ausnahme-Schlüssel hängt am Listenindex (S1); AlphaTango
  doppelt geprüft (I7); Zeitplan-Anzeige „Uhr“ statt UTC (I9);
  `NO_FLY_TEXT_RE` zu grob (I10); toter Offline-Rückfall (S6); stille Kürzung
  auf 1200 Zonen (S7).
- **Tests:** drei Lib-Tests scheitern an Dateien aus der Replit-Fassung
  (belgianAirportDonut → attached_assets, energyInfrastructureFlightRules →
  web/src/lib/ed269Popup, geozoneSmoothFactorBehavior → leaflet); node:test-
  Suite ist nicht in `npm test`.

## Zielmodell

```ts
type Restriction = "PROHIBITED"|"RESTRICTED"|"REQ_AUTHORISATION"|"CONDITIONAL"|"NATURE"|"NO_RESTRICTION"|"UNKNOWN";
type VRef = "AGL"|"MSL"|"UNKNOWN";
interface Height { m: number|null; ref: VRef; text: string }   // null = GND bzw. UNL je Seite
```

Policy-Tabelle (shared/restrictionPolicy.ts) – einzige Quelle für Farbe,
Label, Listenfarbe, Radar-Reiter und Urteil:

| Einstufung | Schwere | Urteil, wenn aktiv und erreichbar |
|---|---|---|
| PROHIBITED | 4 | NO-GO (mit Begründung überschreibbar) |
| RESTRICTED | 3 | Freigabe nötig → CAUTION + Pflichtbestätigung |
| REQ_AUTHORISATION | 3 | wie RESTRICTED; AV/Genehmigung kann abdecken |
| CONDITIONAL | 2 | CAUTION, Auflagen zeigen |
| NATURE | 2 | CAUTION |
| UNKNOWN | 2 | CAUTION |
| NO_RESTRICTION | 1 | nur Info |

Prüfkette: `CheckResult { id, severity: info|caution|nogo|unknown, title,
detail, source, zoneRefs?, overridable? }`, `aggregate()` = max(severity),
`unknown` ≥ caution; Ergebnis in der Flugsession.

Quellen-Registry (client/lib/geozoneSources/registry.ts): je Quelle iso[],
label, attribution, licence, links, kind, fetch, normalise, refresh-Policy,
offline-Strategie, Flags (z. B. frequentis2100-Platzhalter für AT/LT – EE geprüft, ohne);
alle Länderlisten werden daraus abgeleitet.

## Teil B – Schritte

- **B0 (S)** Drei veraltete Tests reparieren/anpassen; node:test-Suite in
  `npm test` aufnehmen (Skript, das alle Dateien ausführt).
- **B1 (M)** Eine Aktivitätsprüfung `zoneActivityAt(zone, date)` →
  active|inactive|unknown (Applicability, validStart/End, Zeitplan); überall
  verwenden; Textparse-Varianten löschen; je Kontext ein Zeitbezug (Radar:
  jetzt; Planung: geplante Zeit; Pre-Check: beides); Ablauf nicht mehr beim
  Parsen mit Date.now() entscheiden.
- **B2 (M)** Geschlossene Einstufung + Policy-Tabelle; Liste, Karte,
  Radar-Reiter, Urteil über die Policy; PROHIBITED → NO-GO (überschreibbar);
  Test: jede Normalisierung liefert nur Werte der Union.
- **B3 (M)** Ein Höhenparser `parseHeight` (m/ft/FL, GND/SFC/UNL,
  AGL/AMSL/MSL/STD/WGS84/HEI); `upperReference` im Modell; UNKNOWN wird nie
  ausgeblendet; MSL→AGL mit maximaler Geländehöhe im Radius bzw. Marge;
  Bezug im Höhen-Label.
- **B4 (M)** Prüfkette mit CheckResult und Aggregation; Planung und
  Pre-Check umstellen; Ergebnis in der Session.
- **B5 (M)** Quellen-Registry; alle Länderlisten daraus ableiten;
  Sonderfälle als Flags; Datenalter je Quelle.
- **B6 (L)** Normalisierer schrittweise auf gemeinsame Bausteine
  (shared/geozoneKit: heights, text, messages, arcgis, wfs, kml, wkt).
- **B7 (S)** Kleinkram: Ausnahme-Schlüssel per featureId, AlphaTango eine
  Quelle, UTC-Anzeige, NO_FLY_TEXT_RE, toter Rückfall, Hinweis bei Kürzung.

## Teil A – Aktualisieren bei Bedarf

- Gespeicherten Stand sofort zeigen, online im Hintergrund nachziehen
  (stale-while-revalidate), ausgelöst bei Planung/Karte im Land und bei
  Länderwechsel laut GPS (inkl. Nachbarn im Umkreis).
- Dauerhafte vs. temporäre Zonen trennen: temporäre bei Netz immer frisch,
  offline mit Altershinweis.
- Große Pakete (DE/FR/CZ): vorher günstig auf neue Fassung prüfen
  (ETag/Last-Modified/Publikationsordner); Download nur im WLAN, außer der
  Nutzer erlaubt mobile Daten.
- Datenalter je Land in Planung und Pre-Check; Schwellen → Warnung +
  Bestätigung (über die Coverage-Mechanik aus Korrektur 4).
- Zweigleisig (Product Owner): dauerhafte Zonen lokal zuerst (schnell),
  online im Hintergrund auf neue Fassung prüfen; temporäre Zonen online
  zuerst; Land ohne Speicher → online direkt und dabei zwischenspeichern.
  Die schnelle lokale Antwort darf nie ein GO sein, das später still kippt:
  ändert sich das Urteil durch neue Daten, deutlicher Hinweis.
- Wetter, METAR/TAF, NOTAMs, Kp ebenfalls speichern (Product Owner):
  offline < 24 h anzeigen mit „Stand …“ (Wind/Böen ab 6 h Alter deutlicher
  Hinweis; METAR > 2 h nur grau; TAF bis Gültigkeitsende; NOTAMs nur noch
  gültige); ≥ 24 h ausblenden mit Hinweis „Gerät online bringen“.
  Offline-Daten zählen im Urteil höchstens als CAUTION („vor dem Start online
  neu prüfen“); fehlend/zu alt = unbekannt.

## Funde aus B0/B1 (2026-11-15)

- Sonnenstand-Fehler behoben (shared/solar.ts): Okt–März lagen Sonnenauf- und
  -untergang auf dem Vortag (Zeitgleichung nicht normalisiert) – betraf Nacht-
  und Tageslichtprüfung app-weit, schon in der Replit-Fassung.
- Offen für B6/B7: client/lib/ed269Notams.ts vertauscht beim Zonenmittelpunkt
  Breite/Länge ([lat, lon] als [lon, lat] gelesen); NOTAM-Screens haben noch
  eine eigene Aktiv-/Bald-aktiv-Logik für NOTAM-Datensätze.

## Funde/Entscheidungen aus B2 (2026-11-15)

- Einstufung + Policy: shared/restrictionPolicy.ts (`Restriction`,
  `normalizeRestriction`, `RESTRICTION_POLICY`, `zoneRestriction`,
  `assessZoneRestriction`). Planungsliste: client/lib/restrictionPlanning.ts;
  Radar-Reiter: client/lib/geozoneSeverity.ts – beide über
  `assessZoneRestriction` (gleiche Reiterfarbe je Zone).
- Reiter rot = aktive Zone mit Schwere ≥ 3 ohne AV-Abdeckung (Verbot,
  Sperrgebiet, Genehmigungspflicht). Folge: ausländische REQ_AUTHORISATION-
  Zonen und DE-CTR/Flughäfen färben den Reiter jetzt rot (bisher orange).
- DE (dipul hat keine Einstufung, Ableitung aus dem Layer): ED-R RESTRICTED;
  CTR/Flughäfen REQ_AUTHORISATION; Flugplätze/HEMS, Modellflug, Hängegleiter
  CONDITIONAL; temporäre Betriebseinschränkungen PROHIBITED (außer Text nennt
  Genehmigung/Zustimmung); alle übrigen § 21h-Kategorien inkl. Naturschutz
  REQ_AUTHORISATION (AV-Abdeckung weiter nur über isDe21hZoneAvEligible).
  Fachlich zu bestätigen.
- Urteil: `restrictionVerdict` (nogo|caution|info) in Route-Params und
  Flugsession; `assessWeather` (Kontext) macht aus "nogo" ein NO-GO. Planung:
  Flugverbot mit Begründung übersteuerbar (Notiz im Protokoll). Pre-Check
  reicht das Urteil bis ResultsScreen durch (dort Bestätigung des NO-GO).
- Offen: FlightCheck-RestrictionsScreen und Pdf-Export färben noch nicht
  nach Policy; Ausnahme-Schlüssel ist jetzt inhaltsbasiert
  (Teil von S1), featureId-Pflicht folgt in B7.

## Funde/Entscheidungen aus B3 (2026-11-15)

- Ein Höhenparser: shared/heights.ts (`FT_M`, `VRef`, `Height`, `parseHeight`,
  `parseHeightRange`, `normalizeVRef`, `heightFromMeters`, `withSourceText`,
  `formatHeightDe`, `formatHeightRangeDe`, `capUnlimited`). Bezüge:
  AGL/SFC/GND/HEI/AGND/HGT/ASFC/n.p.t. → AGL; AMSL/MSL/ALT/QNH/n.p.m. → MSL;
  WGS84 → MSL mit `datum: "WGS84"` (Geoidundulation Europa ≈ +35…55 m);
  STD/FL → MSL mit `datum: "STD"` (Druckhöhe); leer/unbekannt → UNKNOWN
  (kein stiller AGL-Rückfall mehr). 0 ohne Bezug bzw. über Grund = GND.
- Modell: GeozoneFeatureInfo hat `lower`/`upper` (Height) und
  `upperReference`; `lowerMeters`/`upperMeters`/`lowerReference` bleiben
  befüllt. Gemappt in parseEd269ToGeozoneInfo (inkl. Bezug aus `altitudeText`,
  `lower`/`upper`-Anzeige-String und AT/LT `properties.geometry`), CZ
  (tileZones.ts, FL/STD jetzt korrekt, FL660 = unbegrenzt), DE dipul
  (dipulZoneFromFeature: Live-WFS und Kachelspeicher), CH-Identify. LU-WMS
  (nur „Lower limit (meter)“ ohne Bezug) und FR (`limite` = max. Flughöhe,
  kein Volumen) bewusst nicht.
- Höhen-Label mit Bezug: „GND – 1500 ft AMSL (457 m)“, „FL65 – FL95“,
  „50 m (Bezug unbekannt) – …“, „… – unbegrenzt“.
- Filter (isZoneReachable): UNKNOWN-Untergrenze wird nie ausgeblendet.
  MSL→AGL mit Gelände-MAXIMUM im Radius (`fetchTerrainEstimate`: Mitte + 2×8
  Punkte in einem Open-Meteo-Aufruf, Cache im Speicher) + 30 m; nur Mitte
  bekannt (offline/Altaufruf) → Mitte + 150 m; STD-Grenzen −300 m,
  WGS84 −60 m. Obergrenze blendet nur aus, wenn sie MSL ist und sicher unter
  dem Gelände-MINIMUM (−100 m) liegt, und nur mit mehreren Stützpunkten; AGL-
  Obergrenzen nie (CZ „Höhengrenze 0 m“).
- Neu ausblendbar auf dem Radar: DE-Kachelzonen mit Untergrenze über der
  erreichbaren Höhe (bisher ohne Höhen). Planung filtert DE weiterhin nicht.
- Ersetzt durch parseHeight: ed269LimitMeters (kennt jetzt FL),
  ed269VolumeLimitMeters/ed269VerticalReference (ed269Pure), ed318Altitude
  (Bezug fehlt → UNKNOWN), czLimitMeters (tileZones).
- TODO B6 (eigene Höhenparser/0.3048, auf shared/heights.ts umstellen):
  swedishGeozones (parseSwedishAltitude, ed318LayerAltitudes, wfsAltitudes –
  Default ft/AMSL!), spanishGeozones (parseEsAltitude, esReference: leer → AGL),
  polishGeozones (parsePolishAltitude/Range), croatianGeozones
  (parseHrAltitude), belgianGeozones (belgianAltitudeMeters/-Reference),
  dutchGeozones (godroneAltitudeMeters/-Reference), swissGeozones
  (verticalRef), slovakGeozones (HEIGHT_RE, ref), bulgarianGeozones,
  cypriotGeozones, irishLuxGeozones, ukGeozones, slovenianGeozones,
  icelandicGeozones, latvian/finnish/norwegian (über ed269Pure schon
  zentral), geozoneImport (über ed318Altitude schon zentral). Dabei je Land
  prüfen, wo ein fehlender Bezug heute still zu AGL wird.
- Offen: Geländeschätzung nicht dauerhaft gespeichert (App-Neustart offline →
  keine Geländehöhe → MSL-Zonen bleiben sichtbar, sicher); ED-269-Zonen mit
  mehreren Höhenbändern weiter als getrennte Features.

## Stand B4 (2026-11-15)

- Prüfkette: shared/checks/ (`types.ts`: `CheckSeverity`, `CheckCategory`,
  `CheckResult` mit `overriddenBy`, `dataAge`, `context`; `aggregate.ts`:
  `aggregate` – NO-GO nur bei nicht überschriebenem nogo, `unknown` ≥ CAUTION,
  Gründe stabil nach Schwere –, `sessionReasonsFromChecks`,
  `replaceCheckCategories` je Kategorie + Kontext; `builders.ts`:
  `geozoneChecks`, `legacyGeozoneChecks`, `coverageChecks`, `notamChecks`,
  `officialMapCrossCheckChecks`, `complianceChecks` sowie die Texte
  RESTRICTION_NOGO_TEXT, NOTAM_STATUS_UNKNOWN_TEXT, Abdeckungs-Warntexte).
- client/lib/flightChecks.ts: `weatherChecks`/`nightChecks` kapseln
  assessWeather/`assessNightFlight` (Schwellen unverändert; assessWeather
  markiert Warnungen mit `severe`/`nogo`), `evaluateZones` (Aktivität im
  Kontext, optional Erreichbarkeit, Policy-Klassifizierung),
  `storedChecksFor` (gespeicherte Befunde des Kontexts, sonst Rückfall auf
  hasRestrictions/restrictionStatus/restrictionVerdict/notamStatusUnknown) und
  `evaluateFlight` – EINE Bewertung für PlanningResult und ResultsScreen.
- Session: `checkResults` (je Befund `context` planning|precheck; beide
  bleiben nebeneinander erhalten) und `verdict`; Altfelder bleiben befüllt.
  Planung: PlanningRestrictions schreibt geozone/coverage/compliance (bestehende
  Session sofort, sonst Route-Param `checkResults`), PlanningDetails ergänzt
  notam, PlanningResult Wetter/Nacht/Gegenprüfung, Urteil, Gründe. Pre-Check:
  PreCheckOverview schreibt geozone/coverage/notam (Kontext precheck),
  ResultsScreen ergänzt Wetter/Nacht (Zeit: jetzt). Route-Params bleiben
  Rückfall (z. B. Pfad über FlightCheck-RestrictionsScreen ohne Session).
- Override: PROHIBITED mit Begründung = nogo-Befund mit `overriddenBy`
  {reason, at} → CAUTION. Dokumentierter Unterschied Planung/Pre-Check nur im
  Zeitbezug (Zonen: geplant vs. jetzt ODER geplant; Nacht: geplant vs. jetzt),
  Test client/lib/__tests__/flightChecks.test.ts.
- I6: Nachtflug-Regel überall mit dem Land aus dem Standort
  (`nightFlightCountry`, countryIso nur Rückfall) – auch im Nacht-Dialog der
  Einschränkungs-Stufe.
- Für den Piloten sichtbar: PlanningResult zeigt eine Karte „Prüfergebnis“
  mit allen Befunden (inkl. Info, z. B. veraltete Daten) statt der Warnliste
  im Wetterkasten und der Einzelkarten Gegenprüfung/NOTAM; Pre-Check prüft
  jetzt Nacht (jetzt), wertet einen NOTAM-Abfragefehler als unbekannt
  (CAUTION) und übernimmt eine „startverhindernde“ Gegenprüfung aus der
  Planung; Flugverbot mit Begründung ergibt auch bei Auswahl „Genehmigung
  liegt vor“ CAUTION (bisher GO); Protokoll-Gründe sind die Befundtexte
  (NO-GO-Gründe als „nogo“).
- Offen: FlightCheck-RestrictionsScreen schreibt noch keine Befunde (Rückfall
  über Route-Params); Pre-Check filtert Zonen weiter ohne Höhe/Gelände
  (`evaluateZones` kann es, `reachability` ungenutzt); FR-AlphaTango nur
  Info-Befund (wirkt wie bisher über den Einschränkungsstatus); Datenalter für
  Wetter/NOTAM folgt mit Teil A.

## Stand B5 (2026-11-15)

- Quellen-Registry, zweigeteilt:
  - **shared/geozoneSourceMeta.ts** (ohne Importe, damit shared/*Geozones.ts
    und ed269Restriction.ts sie ohne Zyklus nutzen können): je Quelle `iso`,
    `aliases` (LI → CH), `labelDe`, `kind` ("ed269-vector" | "tiled" (DE/FR/CZ)
    | "wms" | "xyz-raster" (HU) | "import-only" (RO) | "login" (IT)),
    `refresh` {maxAgeMs, staleWarnAfterMs} (ED-269-Gerätecache 24 h/24 h,
    Kachelspeicher 28 d/28 d, Import: kein Abruf, Warnung ab 24 h), `offline`
    (ed269-store | tile-store | import | raster-tiles), `vectorMinZoom`,
    Flags (`loadsFullCountry` AT/BE, `accessGate` login IT / pack CZ / import
    RO mit `accessHint`, `manualCheckOnly` HU, `frequentisPlaceholder` AT/LT,
    `notamFromApplicability` AT, `notamFromLiveFlag` BE, `bundledFallback` BE,
    `notamListOrder` BE/AT/DK) sowie Anbieter/Lizenz/Freigabe/Link für
    „Datenquellen & Lizenzen“. Abgeleitete Listen: `ED269_FETCH_ISOS`,
    `ED269_STORE_ISOS(_WITH_ALIASES)`, `OWN_MAP_SOURCE_ISOS`,
    `ACCESS_GATED_SOURCE_ISOS`, `TILE_STORE_SOURCE_ISOS`,
    `GEOZONE_IMPORT_ONLY_SOURCE_ISOS`, `VECTOR_MIN_ZOOM_BY_ISO`,
    `FULL_COUNTRY_VECTOR_ISOS`, `NOTAM_LIST_SOURCE_ISOS`, `isEd269VectorIso`,
    `isSourceDataStale`, `resolveGeozoneSourceIso`.
  - **client/lib/geozoneSources/registry.ts** (RN-frei, unter tsx testbar):
    `GEOZONE_SOURCES` = Kern + `sourceLabel`, `attributions`,
    `tileAttribution` (TILE_STORE_ATTRIBUTION), `wms` (Verweis auf
    geozoneSources/wmsConfigs.ts – die WMS-/XYZ-Konfigurationen von DE, CH, LU,
    NL, FR, HU, unverändert aus geozones.ts verschoben), `fetch`
    (ED269_FETCHERS in geozoneDirect/ed269Sources.ts), `bundled`,
    `manualCheckHint`; `ed269SourceLabels()`, `buildCountryGeozoneConfigs()`,
    `getSourceDataStatus(iso)` → {fetchedAt, ageMs, stale, kind, imported?}
    aus ed269Store (getEd269DatasetStatus inkl. Import) bzw. Kachelspeicher-
    Metadaten.
- Abgeleitet statt hart kodiert: ED269_DIRECT_COUNTRIES, ED269_SOURCE_LABELS,
  VECTOR_ISOS (PlanningRestrictions, 2×) → `isEd269VectorIso`,
  OWN_MAP_DATA_COUNTRIES + zugangsgebundene Länder (hasOwnMap unverändert),
  GEOZONE_VECTOR_COUNTRY_MIN_ZOOM / Vollland-Laden, TILE_STORE_ISOS (Typ
  `TileStoreIso` bleibt, Test hält ihn synchron), GEOZONE_IMPORT_ONLY_ISOS,
  COUNTRY_GEOZONE_CONFIGS (gleiche Schlüssel/Reihenfolge), GEOZONE_COUNTRY_WMS
  (geozoneTileUrl.ts), dataSources (GEOZONE_SOURCE_META, geozoneCountries),
  Offline-Arten (geozoneOfflineKind) und Kachel-Attribution, NotamsScreen
  (BE/AT/DK), LI-Sonderfälle (geozones, geozoneCoverage, ed269Store,
  ed269Sources, RcOfflineMaps), BE-Bundle, AT-NOTAM-Eignung, IT-Fehlertext,
  HU-Hinweis in der Planung. Frequentis-Platzhalter wird jetzt einmal in
  `fetchEd269CountryFeatures` per Flag angewandt (statt in fetchAustria/
  fetchLithuania). Geprüft: EE-Feed (utm.eans.ee, 233 Zonen) ohne
  2100-Platzhalter; AT 5 (MATZ/MCTR); LT-Feed hinter Cloudflare nicht
  abrufbar – Flag bleibt wie bisher gesetzt.
- Datenalter (einzige Verhaltensänderung): Abdeckungsquellen tragen den Stand
  (ED-269 wie bisher, jetzt auch Kachelspeicher DE/FR/CZ);
  `coverageChecks` erzeugt für aktuelle gespeicherte Daten einen Info-Befund
  „Geozonen-Daten <Land>: Stand: vor X h (TT.MM.JJJJ)“ (`dataAge.ageMs`),
  veraltete Daten (> staleWarnAfterMs) sind jetzt **CAUTION** (bisher Info).
  Planung und Pre-Check zeigen unter den Geozonen eine Zeile „Geozonen-Daten –
  <Land>: Stand: …“ (`formatCoverageDataAges`), bei veralteten Daten orange.
  Folge: ein Kachelpaket älter als 28 Tage bzw. ein ED-269-Bestand oder
  RO-Import älter als 24 h ergibt CAUTION; ebenso der ED-269-Rückfall „aus
  Offline-Paket“ (war schon "stale").
- Bewusst nicht umgestellt (quellenspezifische Implementierung, B6): die
  Abfragezweige je Land in queryGeozonesForCountry (DE/CH/LU/NL/FR), CZ-
  Sonderwege in tileStore/tileStoreCore, CountryDetailScreen (d-flight-Hilfe),
  der Legacy-Layer-Katalog für die einmalige Migration
  (NATIVE_GEOZONE_LAYER_CATALOG).

### Ein Land hinzufügen

1. **shared/geozoneSourceMeta.ts**: eine Zeile in `GEOZONE_SOURCE_META`
   (iso, labelDe, kind, refresh, offline, ggf. Flags/Mindestzoom, Anbieter,
   Lizenz, writtenPermission, url). Für einen normalen Vektor-Feed reicht
   `...vector`.
2. **Quellmodul**: Normalisierer in shared/<land>Geozones.ts (Label- und
   Attributions-Konstanten) und Abruf in client/lib/geozoneDirect/<land>Source.ts;
   die Abruf-Funktion in `ED269_FETCHERS` (geozoneDirect/ed269Sources.ts)
   eintragen.
3. **client/lib/geozoneSources/registry.ts**: Eintrag in `CLIENT_PARTS`
   (sourceLabel, attributions; WMS-Länder zusätzlich `wms` in wmsConfigs.ts)
   und den ISO-Code in `CountryIsoWithGeozones` (wmsConfigs.ts) – der
   Compiler erzwingt beides.
4. Fertig: Karte, Prüfung, hasOwnMap, Offline-Paket, Datenquellen, Quellen-
   Label, Höhenfilter und Datenalter ergeben sich aus der Registry.
   `client/lib/__tests__/geozoneSourceRegistry.test.ts` prüft Label/
   Attribution/Lizenz und dass jede Abruf-Funktion in der Registry steht; die
   Schnappschüsse der alten Listen dort bewusst um das neue Land ergänzen.

## Stand B6 (2026-11-15)

- **shared/geozoneKit/** (neu, `index.ts` exportiert alles):
  - `heights.ts`: Re-Export von shared/heights.ts (parseHeight,
    parseHeightRange, normalizeVRef, FT_M …) plus `ftToM`, `mToFt`, `flToM`.
  - `text.ts`: `round1`, `roundTo`, `collapseWhitespace` (früher `clean` in
    BG/SI/SK), `cleanText(v, { br, tags: "strip"|"space", paragraphs })` (die
    Varianten aus SE/ES/HR/ed318Pure als Optionen), `stripHtml` (früher doppelt
    in client/lib/ed269.ts und ed269Pure `stripEd269Html` – beide re-exportieren).
  - `messages.ts`: `ORIGINAL_TEXT_HEADING` („Originaltext der Behörde:“, jetzt
    genau eine Stelle), `appendOriginalText`/`messageWithOriginal` (Leerzeile +
    Überschrift + Text; `always` für SI/SK), `localizedMessages`/
    `localizedExtendedProperties` („de“ zuerst, dann Quellsprache; CH mit
    `deLanguage: "de-CH"`), Zeilenbausteine `pushHints`, `sourceLineDe`,
    `heightLineDe`, `originalBlock`, `SEE_ORIGINAL_DE`, `NO_HEIGHT_LINE_DE`.
    Genutzt von CY, SI, SK, BG, UK, HR, CH und client/lib/ed269.ts.
  - `arcgis.ts`: `arcgisQueryUrl` (Parameterreihenfolge wie bisher),
    `arcgisPage` (exceededTransferLimit oben/unter properties, ArcGIS-{error} →
    Error), `fetchArcgisPaged` (resultOffset = bisher geladen). CY, SI, SK und
    der ES-Rückfall nutzen sie; `cyprusArcgisPage`/`sloveniaArcgisPage`/
    `skArcgisPage`/`esArcgisPage` und die Query-URL-Funktionen bleiben als dünne
    Hüllen (Tests, Aufrufer).
  - `wfs.ts`: `wfsGetFeatureUrl` (IS mit `encodeOutputFormat: false` – URL
    bleibt byte-gleich), `wfsHasMore` (numberMatched/totalFeatures, sonst
    Seitengröße), `wfsHasMoreStrict` (ES: kurze Seite beendet immer),
    `fetchWfsPaged`, Achsfolge `ensureLonLat`/`looksLatLon`/`swapAxes`
    (ES `esEnsureLonLat` = Spanien-Grenzen). IS, BG und ES-WFS nutzen sie.
  - `kml.ts`/`wkt.ts`: die bisherigen shared/kmlParse.ts/wktParse.ts (dorthin
    verschoben; die alten Pfade re-exportieren). Länder importieren jetzt aus
    geozoneKit.
- Höhen: SE, ES, PL, HR, BE, NL, CH, SK, BG, CY, IE/LU, UK (SI/IS haben keine
  Einheiten-Umrechnung) rechnen Einheiten/Flugflächen nur noch über
  `parseHeight`; alle privaten `0.3048`-Konstanten und `round1`-Kopien sind
  weg (FT_M einmal in shared/heights.ts; auch client/lib/notams, assessment,
  obstacles, traffic/sources, aviationWeatherDecode, NotamsScreen nutzen FT_M).
  Die landesspezifische **Grammatik** (welche Schreibweisen die Quelle
  zulässt, z. B. LFV „2500“ = ft AMSL, UK-Präfix „2000 FT ALT <Rest>“,
  griechische Höhen-Phrasen CY, DÚ-Bereich SK, PL-Bereich mit Einheit am Ende)
  bleibt bewusst je Land als Prüf-Regex, damit die Ergebnisse identisch bleiben.
- Verhaltensgleichheit geprüft: Vergleichsskript (temporär, gelöscht) hat für
  alle 25 Fixtures die Normalisierer-Ausgabe und `parseEd269ToGeozoneInfo` vor/
  nach dem Umbau verglichen (23 Fixture-Sätze inkl. PL-KML aus dem Test, BE über
  normalizeBelgianFeatures, SE eigene ED-318-Normalisierung) sowie Batterien
  aller Höhenfunktionen (~100 000 Eingabekombinationen Wert × Einheit × Bezug)
  und die ArcGIS-/WFS-URLs und Paging-Entscheidungen: **identisch**. Einzige
  Abweichung nach B7: ES-Zeitplan „Sonnenaufgang–Sonnenuntergang Uhr“ →
  „… Sonnenuntergang“ (I9, gewollt).
- Gefunden, **unverändert gelassen** (stiller AGL-Rückfall bei fehlendem
  Bezug, mit ⚠️-Kommentar markiert; fachlich zu entscheiden): ES
  `esReference` (leer → AGL), SE `ed318LayerAltitudes` (leer → AGL), CH
  `verticalRef` (alles außer AMSL/MSL/WGS84 → AGL), CY Texthöhen ohne „MSL“ →
  AGL, IE `layer.lower/upperReference` fehlt → AGL, SK DÚ-Obergrenze ohne
  Bezug → AGL. SI nennt die AGL-Annahme im Text; UK und BG-BULATSA werten
  fehlenden Bezug vorsichtig als MSL; PL lässt ihn leer.
- Bewusst nicht vereinheitlicht: NL `stripHtml` (andere Semantik, keine
  Entities), SE-WFS-Paging (WFS 1.1.0/maxFeatures, nicht in der Liste),
  BG-CSV-Paging (Seiten × Seitengröße), Polen-Bereichsparser.

## Stand B7 (2026-11-15)

- **ed269Notams**: Zonenmittelpunkt las [lat, lon] als [lon, lat] – behoben
  (Test client/lib/__tests__/ed269Notams.test.ts).
- **NOTAM-Status aus Zonen**: `ed269ZonesToNotamRestrictions` entscheidet
  aktiv/zukünftig über `zoneActivityAt` (jetzt) statt nur `validStartTs ≤ jetzt`;
  abgelaufen über `zoneEndedLongAgo(…, 0)` (auch alle applicability-Fenster
  vorbei). Verhaltensänderung: gültige Zone, deren Zeitfenster erst später
  beginnt, erscheint als „Zukünftig“ (bisher „Aktiv“). DE-dipul-NOTAMs
  (`status` der DFS-Datensätze) und LU-TSA („Status:“ im Datensatz) behalten
  ihre eigene Datensatz-Logik – das sind Meldungen der Quelle, keine Zonen.
  PlanningNotamsScreen bleibt auf „jetzt“ (Liste der Meldungen, nicht Urteil).
- **AlphaTango (I7)**: eine Regel `isAlphaTangoMissing` (= Pflicht laut
  `needsAlphaTangoRegistration` – ≥ 800 g ODER Remote-ID – und keine
  Bestätigung hinterlegt) für Compliance-Liste (fr_alphatango), Drohnenliste
  (`getAlphaTangoFrStatus`) und Planungssperre; Begründungstext
  `alphaTangoRequirementReason`. Compliance-Liste unverändert streng.
  **Verhaltensänderung Planungssperre**: greift jetzt auch bei < 800 g mit
  Remote-ID und wenn nur die FRA-Nummer, aber keine Bestätigung hinterlegt ist
  (bisher: nur ≥ 800 g ohne FRA-Nummer). Test alphaTangoRule.test.ts.
- **Zeitplan-Anzeige (I9)**: Uhrzeiten in `ed269ScheduleFromProps` heißen
  „UTC“ statt „Uhr“ – die Aktivitätsprüfung wertet jede Uhrzeit als UTC.
  Reine Sonnenereignisse ohne Zusatz. Angepasste Tests (gewollt): AT
  „08:30–10:45 UTC“, IT „08:00–18:00 UTC“, ES „Sonnenaufgang–Sonnenuntergang“.
- **Toter Offline-Rückfall (S6)**: `queryEd269CachedFeaturesWithStatus` liest
  ED-269-Länder nur noch aus dem Gerätebestand (ed269Store). Der Rückfall auf
  die Features des Offline-Pakets (vorab offline „ok“ ohne Datenalter, danach
  „stale“) ist entfernt, ebenso `getOfflinePackFeatures`. Das Paket entsteht
  aus genau diesem Bestand; offline gilt jetzt dessen Alter (ok/stale), ohne
  Bestand „missing“ (Abdeckungslücke) – auch ein entfernter RO-Import wird
  nicht mehr aus dem Paket wiederbelebt. Offen: offlinePacks.ts schreibt die
  (jetzt ungenutzten) Features weiter ins Paket.
- **Kürzung auf 1200 Zonen (S7)**: `queryEd269Features`/`queryIndex`
  melden die Kürzung (`stats`), `Ed269StatusResult`/Abdeckungsquelle tragen
  `truncated` und die Notiz „Nur die nächstgelegenen 1200 Zonen angezeigt –
  hineinzoomen“ (`geozoneTruncationHint`; erscheint im Datenstand-Befund).
  Radar/Live-Karte (TrafficMapView) und MapPicker zeigen den Hinweis als
  Kartenbanner, Planung und Pre-Check als Zeile unter dem Datenstand
  (`formatCoverageTruncation`). Test geozoneTruncation.test.ts.
- **Toter Code**: AccountScreen, DroneFoundLinkScreen (registriert, aber nie
  angesteuert – kein navigate, kein Deep-Link) samt Routen und
  foundNotifications.ts entfernt. **Geblieben** (live importiert): api.ts
  (storage.ts, geozones.ts), api-client.ts (api.ts, subscription.ts),
  subscription.ts (auth, FeatureGate, Paywall, Map, PlanningLocation …).
- Nicht Teil dieses Schritts (aus der B7-Zeile oben): Ausnahme-Schlüssel per
  featureId (S1) und `NO_FLY_TEXT_RE` (I10).

## Stand A (2026-11-15)

### Geozonen zweigleisig (stale-while-revalidate)

- **Policy** (shared/geozoneSourceMeta.ts): `GeozoneRefreshPolicy` trennt
  dauerhafte und temporäre Zonen – `maxAgeMs` (online neu laden: ED-269 jetzt
  **6 h** statt 24 h, Kachelspeicher 28 Tage), `staleWarnAfterMs` (dauerhafte
  Zonen: **28 Tage** = AIRAC, ED-269 bisher 24 h), `temporaryMaxAgeMs`
  (**10 min**) und `temporaryStaleAfterMs` (**24 h**). Neu je Quelle:
  `temporary` ("dataset" = im ED-269-Bestand, "separate" = DE eigener Abruf,
  "none" = FR/CZ/HU/RO; Standard aus `kind`, `temporarySourceOf`) und
  `largeDataset` (NL-Feed ≈ 23 MB; Kachelspeicher immer groß,
  `isLargeGeozoneDataset`); `isTemporaryDataStale`, `TEMPORARY_ZONES_STALE_NOTE`.
- **Regel „temporär“** (shared/geozoneTemporary.ts, `isTemporaryGeozoneProps`
  für Roh-Features, `isTemporaryGeozone` für GeozoneFeatureInfo): temporär ist
  eine Zone, wenn (1) die Quelle sie NOTAM-artig markiert (`isNotam` EE/NO/SE,
  `_notamEligible`, Registry-Flags `notamFromLiveFlag` BE / `notamFromApplicability`
  AT über `ed269IsNotamEligible`), (2) sie aus einer Temporär-Ebene stammt
  (dipul `temporaere_betriebseinschraenkungen` = „Temporäre Beschränkungen“,
  LU-TSA) oder (3) ihr Gültigkeitsfenster (Start UND Ende) kürzer als 30 Tage
  ist (gleiche Grenze wie die NOTAM-Liste). HR-Reservierungen, IS-Sperrungen,
  LV/ES-NOTAM-Ebenen fallen über ihr Gültigkeitsfenster/`isNotam` darunter.
  Alles andere (kein Fenster, „permanent“, Frequentis-Platzhalter 2100,
  NL-AIRAC-Gültigkeit) ist dauerhaft.
- **Abdeckung** (`storedCoverageStatus`, client/lib/geozoneCoverage.ts):
  dauerhafte Zonen > 28 Tage → "stale" (CAUTION wie bisher); sonst temporäre
  Zonen > 24 h bzw. nie geladen → **"partial" „Temporäre Beschränkungen nicht
  aktuell (Stand …)“** → Befund unbekannt (≥ CAUTION, Abdeckungslücke mit
  manueller Klärung in der Planung). ED-269: Stand der temporären Zonen = Stand
  des Bestands (nicht bei Datei-Import); DE-Kachelpaket: Stand des eigenen
  Abrufs der temporären Betriebseinschränkungen (`getDeTempStatus`,
  temp.json; nur wenn die Ebene abgefragt wurde). `getSourceDataStatus` liefert
  zusätzlich `temporaryFetchedAt`/`temporaryStale`.
- **Hintergrund-Aktualisierung** (client/lib/geozoneSources/revalidate.ts,
  RN-frei, Umgebung austauschbar): `revalidateGeozoneSources(isos, purpose)`
  mit `purpose` "check" (Planung/Pre-Check), "map" (Radar/Karte), "manual"
  („Jetzt aktualisieren“):
  - ED-269-Land: neu laden, wenn älter als 6 h (Karte) bzw. 10 min (Prüfung,
    weil die temporären Zonen im Bestand stecken; nicht beim großen NL-Feed);
    ohne Bestand sofort laden; Fehlschlag 2 min gedrosselt; offline nie.
  - Großer Bestand: vorhandenen nur im WLAN bzw. mit Erlaubnis erneuern, sonst
    „Neue Fassung verfügbar – wird im WLAN geladen“ (`getPendingWifiUpdates`).
  - Kachelpaket: erst günstige Versionsprüfung `tileStoreVersionCheck`
    (Alter > 28 Tage; **DE/FR: Paket vor Beginn des aktuellen AIRAC-Zyklus**
    – `airacCycleStart`, Bezug AIRAC 2401 = 25.01.2024; dipul-WFS kennt weder
    ETag noch Last-Modified; **FR zusätzlich Trefferzahl** des WFS
    (resultType=hits) gegen die beim Download gespeicherte `source.matched`;
    **CZ: Veröffentlichungsordner** der ŘLP-Indexseite wie bisher), höchstens
    alle 30 min; Download nur im WLAN bzw. mit Erlaubnis. DE: temporäre
    Betriebseinschränkungen bei Prüfungen online frisch (≤ 10 min).
  - `refreshDueTileStores` (App-Start) beachtet die neue Erlaubnis ebenfalls.
- **Einstellung** „Große Pakete auch über mobile Daten laden“
  (RcOfflineMapsScreen, Abschnitt „Geozonen aktualisieren“;
  geozoneSources/largePackSetting.ts, AsyncStorage). Verbindungsart über
  das vorhandene @react-native-community/netinfo (`type` wifi/ethernet) –
  expo-network war nicht nötig.
- **Auslöser**: `useGeozoneRevalidation` (Hook) beim Öffnen und bei jedem
  Länderwechsel (Länder im Umkreis inkl. Nachbarn, `getCountriesInRadius`, auf
  ~1 km gerundet) in Planung/Einschränkungen und Pre-Check ("check") sowie im
  Radar (GPS, "map"). Kartenansichten nutzen weiter das SWR des Gerätecaches
  (jetzt 6 h).
- **Land ohne Speicher**: DE ohne Kachelpaket fragt online den dipul-WFS und
  speichert das Ergebnis je Standort (0,05°, offlineResultCache
  "geozones-live"); offline gilt dieser Stand mit Alter (28 Tage/24 h wie
  oben), ohne Stand → Abdeckungslücke statt „keine Zonen“. ED-269-Länder laden
  wie bisher den Datensatz.
- **Urteil kippt nie still**: Ereignis `onGeozoneDataChanged` (aus
  `onEd269Downloaded`, `onTileStoreChange`, neu `onDeTempChange` bei
  inhaltlich geänderten temporären DE-Zonen). Planung (PlanningRestrictions)
  und Pre-Check (PreCheckOverview) laden bei einem relevanten Ereignis neu
  (`dataVersion`) und vergleichen das Urteil (shared/checks/verdictChange.ts,
  `verdictWatchReducer`: Vergleich nur mit einem Ergebnis, das auf den neuen
  Daten beruht). Bei Änderung – **in jede Richtung, auch zu GO** – roter
  Hinweis „Neue Geozonen-Daten – Prüfergebnis hat sich geändert (vorher …,
  jetzt …). Bitte Ergebnis erneut prüfen.“ (GeozoneDataChangedBanner).

### Wetter, METAR/TAF, NOTAM, Kp offline (Product Owner)

- **Speicher** client/lib/offlineResultCache.ts: letzter erfolgreicher Abruf je
  Standort (`offlineLocationKey`, 0,05°) mit `fetchedAt`, AsyncStorage,
  größenbegrenzt und LRU je Art (z. B. Wetter 20 Einträge/600 kB, NOTAMs 20/800 kB,
  Kp 1). `fetchWithOfflineCache`: online abrufen + speichern; offline bzw. bei
  Fehler gespeicherter Stand < 24 h mit `offline: { fetchedAt, cached: true }`.
- **Schwellen/Texte** shared/offlineDataPolicy.ts: < 24 h anzeigen;
  Vorhersage „Offline-Vorhersage von HH:MM“; Wind/Böen ab 6 h deutlicher
  Hinweis; METAR > 2 h nur grau (`greyOnly`, nicht bewertet); TAF bis
  Gültigkeitsende (`tafValidUntil`); NOTAMs nur noch gültige
  (`stillValidNotams`); Kp mit Alter; ≥ 24 h ausgeblendet mit „Gerät online
  bringen, um … zu prüfen“; `formatSourceStand` = einheitliche „Stand“-Zeile.
- **Angebunden**: `fetchWeather` (Radar, Pre-Check-Wetter), 
  `fetchWeatherForecastWithSource` (Planung, Schlüssel Standort + Stunde),
  `fetchHourlyForecasts` (Standort + Fenster), `fetchKpIndex`/`fetchKpTimeline`
  (global), `fetchNotams` (ersetzt den alten 24-h-dataCache-Rückfall; Offline-
  Paket nur noch, wenn < 24 h, und nur gültige NOTAMs; auch bei HTTP-Fehler),
  `fetchAirportWeather` (METAR/TAF je ICAO), `fetchNearestAirportMetar`,
  DIPUL-Temporärbeschränkungen (vorhandener dataCache, jetzt mit Stand und nur
  noch gültige).
- **Prüfkette**: `weatherChecks` (flightChecks.ts) liest `weather.offline`,
  `kpOfflineFetchedAt` und `airportMetar.offline/greyOnly`; neue Builder
  `offlineDataCheck`/`offlineExpiredCheck` (shared/checks/builders.ts),
  `notamChecks({ offlineFetchedAt })`. Offline-Daten → je Quelle CAUTION
  „<Quelle> – Offline-Daten (Stand HH:MM) – vor dem Start online neu prüfen“
  (Urteil nie GO); Wetter ab 6 h zusätzlich „Wind-/Böendaten älter als 6 h …“
  (rot, Bestätigung); zu alt/fehlend = unbekannt (Wetter: „Gerät online
  bringen, um das Wetter zu prüfen“; Kp-Wert ≥ 24 h wird nicht verwendet).
  **Auslegung „höchstens CAUTION“**: Offline-Daten machen das Urteil nie
  besser als CAUTION; Befunde, die die Offline-Daten selbst auslösen (z. B.
  Wind über Limit, Gewitter in einer < 2 h alten METAR), bleiben so streng wie
  online (ein NO-GO wird nicht abgeschwächt). Planung: `WeatherSnapshot.offline`
  geht über die Session in PlanningResult; Pre-Check: `WeatherData.offline` und
  neuer Route-Param `kpOfflineFetchedAt` (Weather → FpvSelect/Checklist → Results).

### UI

- Komponente `DataStandLines` („Stand“-Zeilen je Quelle + „Jetzt
  aktualisieren“): Planung Details (Wetter/Kp/NOTAMs, Aktualisieren bei
  Offline-Daten), PlanningResult (Vorhersage), Pre-Check-Übersicht
  (NOTAMs/Stundenwerte + Geozonen „Jetzt aktualisieren“), Pre-Check-Wetter
  (Wetter/Kp; offline ohne Stand: „Gerät online bringen, um das Wetter zu
  prüfen …“), Planung Einschränkungen (Geozonen „Jetzt aktualisieren“,
  wartende WLAN-Updates). Radar-Seitenpanel: Stand-Zeilen für Wetter/Kp/NOTAMs,
  im Geozonen-Panel „Jetzt aktualisieren“ und wartende WLAN-Updates. Die
  B5-Zeile „Geozonen-Daten – …“ wird jetzt auch bei „partial“ orange.

### Tests

- client/lib/__tests__/geozoneRevalidate.test.ts: Schwellen dauerhaft/
  temporär, Regel „temporär“, Neuladen je Zweck, Orchestrierung mit
  gemocktem Netz/Zeit (offline, Drossel, NL/Kachelpaket nur im WLAN bzw. mit
  Erlaubnis, Versionsprüfung), SWR mit echtem Gerätecache (Antwort sofort aus
  dem Bestand, Hintergrund-Download ersetzt, Ereignis, Urteil GO → NO-GO wird
  gemeldet, auch Wechsel zu GO), AIRAC-Stichtage, FR-Trefferzahl, Stand der
  temporären DE-Zonen online/offline.
- client/lib/__tests__/offlineData.test.ts: Schwellen (frisch, 6 h, 24 h,
  METAR 2 h, TAF-Gültigkeit, NOTAM-Gültigkeit), Speicher (Offline/Fehler,
  24-h-Grenze, LRU, Größenbegrenzung), Prüfkette (CAUTION, Wind-Hinweis mit
  Bestätigung, unbekannt ab 24 h, NO-GO bleibt, Kp, METAR grau, NOTAMs,
  evaluateFlight).
- notamFetchStatus.test.tsx: Offline-Stand < 24 h nur gültige NOTAMs, ≥ 24 h
  failed. geozoneSourceRegistry.test.ts an die neue Policy angepasst (gewollt).

### Offen / fachlich zu bestätigen

- Prüfungen laden ED-269-Bestände mit temporären Zonen nach 10 min neu – auch
  mittelgroße Feeds (ES, PL, SE, DK …) über mobile Daten; nur NL ist als groß
  markiert.
- Temporär-Regel gilt für alle ED-269-Vektorquellen („dataset“), auch wenn
  ein Feed nie temporäre Zonen enthält: nach 24 h ohne Netz → Abdeckung
  „partial“ (bisher „stale“ ab 24 h, beides ≥ CAUTION).
- FR: AIRAC-Stichtag als Versionssignal angenommen; die Trefferzahl-Prüfung
  greift erst für nach diesem Stand geladene Pakete (`source.matched`).
- Kartenansichten außerhalb des Radars (MapScreen, Planungskarten) haben
  keinen eigenen Auslöser/Hinweis, nur das 6-h-SWR des Gerätecaches.
  FlightCheck-RestrictionsScreen ist nicht angebunden.
- Kp-Vorhersage (`fetchKpTimeline`) wird offline ohne eigenen Stand genutzt;
  PlanningResult bewertet Kp weiterhin nicht (unverändert).
- Stundenwerte/Vorhersage offline nur für bereits abgefragte Fenster bzw.
  Stunden (Schlüssel Standort + Zeit); die Radar-/Pre-Check-Wettervorhersage
  (24 h je Standort) ist davon unabhängig.

## Stand Länder-Update PL/RO/MT/GR/ES (2026-11-15)

Grundlage: die von DE-IP verifizierten Doku-Stände und die echten Fixtures in
`docs/fixtures/` (Kopien in `client/lib/__tests__/fixtures/`).

- **PL** (shared/polishGeozones.ts, geozoneDirect/polandSource.ts): Login-
  Antwort `access_token`; KML-Abruf mit `x-api-key` UND Bearer; `max=500`
  (`max` = Höhengrenze in m, ≥ 500 = ungefiltert, wie die offizielle Karte/Doku)
  – bewusst ungefiltert, der Höhenfilter der App entscheidet. Typ und Höhen aus
  der `<description>` („Type: DRAP, Min: 0 ft, Max: 600 ft“), Beschränkung über
  die kodierte Typ-Tabelle `PL_TYPE_TABLE` (34 Typen aus `/v1/zones/types`,
  7 PROHIBITED / 18 REQ_AUTHORISATION / 9 NO_RESTRICTION; DRAI ist jetzt Info,
  CTR1KM/ATZ6KM/MCTR2KM Genehmigung). Höhen ft → m, **Bezug unbekannt**
  (UNKNOWN, nie ausgeblendet). Deutsche Meldung + Originaltext. Info-Lufträume
  nur mit `includeAirspace`; Verbots-/Genehmigungstypen werden nie verworfen.
- **RO** (shared/romanianGeozones.ts, geozoneDirect/romaniaSource.ts): Online-
  Abruf statt Nur-Import (`kind` ed269-vector, kein Zugangs-Gate, `hasOwnMap`
  wie andere Vektorländer): statischer Zonensatz (RESTRICTED → Genehmigung,
  Kontakt, Höhen) + NOTAM-UAV-WFS als temporäre Zonen (`isNotam`,
  applicability aus dfrom/dto, „D) DAILY hhmm-hhmm“ → Zeitplan, Höhen aus F/G).
  Verbindungsfehler: „ROMATSA nicht erreichbar – Datei-Import nutzen“. Datei-
  Import bleibt Rückfall (ROMATSA-Datei wird mit demselben Normalisierer
  erkannt; ein erfolgreicher Online-Abruf ersetzt den Import).
- **MT** (shared/malteseGeozones.ts): Nur-Import-Land (`import-only`, Gate
  „import“, manuelle Prüfung bis zum Import). Import erkennt Roh-Export und
  `normalisieren.py`-Ausgabe; forbidden → PROHIBITED, sonst REQ_AUTHORISATION;
  Höhen ohne Einheit/Bezug: Untergrenze vorsichtig als ft, Obergrenze
  vorsichtig als m, Bezug UNKNOWN. Keine DDP-Abfragen.
- **GR** (shared/geozoneLayerCatalog.ts, shared/greekGeozones.ts): Bild-Overlay
  (`xyz-raster`, `manualCheckOnly`, Hinweis wie HU) über den DAGR-MapServer-WMS
  mit `WMS_DATE_FROM/TO` = heute 00:00 bis morgen 24:00 (Platzhalter in der
  Kachel-Vorlage, beim Bauen gefüllt: `fillGeozoneDatePlaceholders`). Zusätzlich
  Import der `dagr_geozonen.py`-Ausgabe (Gate „import“; mit Import zählen die
  Vektorzonen wie bei MT). Bildkacheln werden nicht offline gespeichert
  (zeitgefiltert). Bot-Schutz: ob die Kacheln in der App laden, auf dem Gerät
  prüfen. `GEOZONE_IMPORT_ONLY_SOURCE_ISOS` = Quellen mit `offline: "import"`
  (MT, GR); `OWN_MAP_SOURCE_ISOS` enthält Bild-Overlays mit Import-Gate.
- **ES** (shared/spanishGeozones.ts `ES_INSIGNIAS_LAYERS`, geozoneTiles/*):
  Kachelspeicher-Land (`tiled`, `liveVectorQuery`, `temporary: "separate"`,
  Mindestzoom 10). Teile `base` (Aero 1,2,3,4,6,10 + Urbano 11), `infra`,
  `enp` (abwählbar, `TILE_STORE_OPTIONAL_PARTS`), Download über ArcGIS-Paging
  (Zähl-Abfrage, OBJECTID-Reihenfolge, volle Präzision, gekappte Seiten werden
  im Auftrag weitergeblättert). NOTAM (NOTAM_UAS_APP_V3/1) live mit 10-min-
  Cache, offline `es/temp.json` (Stand → temporäre Zonen). Ohne Paket:
  bbox-Live-Abfragen je Ausschnitt (geozoneTiles/esLive.ts, 10-min-Cache) +
  Speicherung je Standort (offlineResultCache „geozones-live“). Paket ohne
  infra/enp: online live ergänzt, offline „partial“. Layer 0 (Bezugspunkte)
  wird nicht gespeichert. Entfernt: AIP-ZIP-Pfad und alter FeatureServer/WFS
  (`insigniads/…/SRV_UAS_ZG_data_V2`) samt `normalizeSpanishEd318`,
  `esLayerIdsFromService`, geozoneDirect/spainSource.ts (ES steht nicht mehr
  in ED269_FETCHERS). Zeilen mit gleichem Identifier bleiben getrennte Zonen
  (sicher bei Zeitfenstern, ggf. Doppelanzeige).
- Offen: PL-Höhenbezug, ES-Feldnamen der Zonen-Layer und Paketgrößen, MT-
  Höheneinheit, GR-Kacheln/Ebenen-Semantik, RO-TLS auf Android – auf dem Gerät
  bzw. mit den Betreibern klären.
