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
offline-Strategie, Flags (z. B. frequentis2100-Platzhalter für AT/EE/LT);
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
