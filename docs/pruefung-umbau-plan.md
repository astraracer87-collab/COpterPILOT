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
