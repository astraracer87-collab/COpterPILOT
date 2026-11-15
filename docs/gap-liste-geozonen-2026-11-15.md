# Gap-Liste Geozonen: Doku (DE-Verifikation 15.11.2026) vs. App-Code

Stand: 2026-11-15. Abgleich aller Länder-Dokumente gegen die Implementierung
(nur gelesen). Nachtrag 2026-11-15: P1 LT, IT (2×), EE sowie P2 MT-Höhen und
AT-`hidden` umgesetzt (✅); GR-Import bleibt offen. Nachtrag 2: P2 PL (JSON,
Aktivierungen, Höhenbezug entschieden) und MT online per DDP umgesetzt (✅). Nachtrag 3: GB auf NATS-AIXM umgestellt (✅). PO-Antworten zu den 8 Prüfpunkten als verifiziert übernommen.
Zurückgestellt (PO-Entscheidung): GR-Vektordatei, SI Pozidano.

Legende: **BUG** = Code widerspricht verifizierter Doku · **FEHLT** =
drohnenrelevante Daten ignoriert · **VERB.** = optional · Aufwand S/M/L ·
Test: F = Fixture im Repo, F+ = neue Fixture von EU-IP nötig, G = nur Gerät/EU-IP.

## P1 – zuerst

| Land | Typ | Befund | Fix | Aufwand / Test |
|---|---|---|---|---|
| LT | ✅ ERLEDIGT (BUG) | „Outside Lithuania“ (weltumspannendes PROHIBITED-Polygon) wird nicht gefiltert (`client/lib/geozoneDirect/ed269Sources.ts` fetchLithuania; `client/lib/ed269.ts` filtert nur `hidden`). Bbox-Abfrage zieht es in jede LT-Abfrage → Nachbarländer an der Grenze fälschlich rot. | Verwerfen bei `name === "Outside Lithuania"`; allgemein PROHIBITED-Polygone mit Welt-Bbox (>90° Länge) bei Frequentis-Ländern verwerfen. **Umgesetzt:** `fetchLithuania` verwirft „Outside Lithuania“; Registry-Flag `frequentisAvm` (AT/EE/LT) → `dropFrequentisSystemFeatures` verwirft beim Abruf `hidden === true` und PROHIBITED-Polygone mit bbox > 90° Länge oder > 45° Breite (Test `frequentisSystemFeatures.test.ts`, handgebaut). | S · F (+ G für Live-Namen) |
| IT | ✅ ERLEDIGT (BUG) | Code lädt nur den ED-269-Download – für normale Konten 401. Fehlermeldung beschuldigt fälschlich die Zugangsdaten. Normalisierer/Fixture nur ED-269 (handgebaut). | WFS `https://www.d-flight.it/maps/wms?service=WFS&version=2.0.0&request=GetFeature&typeNames=D-FLIGHT:ATM09_INFO&outputFormat=application/json&srsName=EPSG:4326`, Paging count/startIndex, 3.876 Zonen, Felder `lower_limit_m`/`upper_limit_m`, `rule`/`regola`/`type`/`subtype`/`valid_from`/`valid_to`; ED-269 nur optional für Operator-Rollen, bei 401 ohne Fehlermeldung auf WFS. Falle: bbox EPSG:4326 = minLat,minLon. Offen: CSRF-Header für /maps/wms? Password-Grant erlaubt? sonst In-App-Login (Auth-Code+PKCE). **Umgesetzt:** WFS ist Hauptweg (`normalizeItalianWfs` in `shared/italianGeozones.ts`, `fetchItalyWith` in `client/lib/geozoneDirect/italySource.ts`); /maps/wms nur mit Bearer (Doku: CSRF dort nicht nötig), bei 401/403 ein Wiederholversuch mit neuem Token + CSRF-Headern; ED-269 optional zuerst, 401/403 still → WFS (danach in der Sitzung nicht erneut); nur ein fehlgeschlagener Login meldet Zugangsdaten-Fehler. Password-Grant laut Doku verifiziert → bleibt; falls d-flight ihn abschaltet: Meldung „d-flight-Anmeldung per App nicht möglich – bitte melden“. ATM09: Höhenklasse 0 m → PROHIBITED, > 0 → CONDITIONAL + `maxFlightHeightAglM` (Annahme AGL, Doku nennt keinen Bezug), Zone ohne Obergrenze. Fixture handgebaut nach den dokumentierten Feldnamen – **echte Fixture (F+) weiter offen**. | M (L mit Auth-Code) · F+ / G |
| IT | ✅ ERLEDIGT (FEHLT) | Layer `NO_FLY_ZONE` (16.134 temporäre Verbotszonen, `viewparams=start_nfz:<jetzt>;end_nfz:9999-12-31T00:00;`), `NOTAM` (18), optional CTR/ATZ/P/R/D/AREE_MILITARI/PARCHI/PROTECT_NATURE. | mit demselben Token per WFS. **Umgesetzt:** NO_FLY_ZONE → PROHIBITED (temporär, Gültigkeit), NOTAM → RESTRICTED bzw. PROHIBITED bei Verbotstext; beide optional (Fehler nur im Log). Feldnamen von NFZ/NOTAM in der Doku nicht beschrieben → tolerant gelesen, live prüfen. CTR/ATZ/P/R/D usw. weiter offen. | M · F+ |
| GR | BUG | Import liest die Worker-Ausgabe nicht: Höhen `lower_ft_agl`/`upper_ft_agl`/`*_ft_msl` (Worker) vs. `alt_agl_*_ft` (App); Luftraum-Ebenen `hellas_TMA/ATZ/r/p/c/d` fallen heraus. | beide Feldnamen-Varianten, Hellas-Ebenen mappen (P→PROHIBITED, R→RESTRICTED, D→CONDITIONAL …). (GR selbst zurückgestellt; Import-Fix ist klein.) | S · F |
| EE | ✅ ERLEDIGT (Lizenz) | Registry: „schriftlich bestätigt“; Doku: nur mündlich. | Text korrigiert: „Freigabe von EANS mündlich erteilt, schriftliche Bestätigung ausstehend“, `writtenPermission: false`. | S |

## P2 – fehlende Daten, Robustheit

| Land | Typ | Befund | Fix | Aufwand / Test |
|---|---|---|---|---|
| AT (EE, LT) | ✅ ERLEDIGT (VERB.) | `sys_*`/`hidden` erst nach der Nähe-Begrenzung gefiltert → Welt-/Landes-Bbox kann echte Zonen aus der 1200er-Liste verdrängen; belegt Speicher. | `hidden` schon beim Abruf verwerfen; AT-Grenze aus sys_1/2 optional für Ländererkennung. **Umgesetzt** (mit LT, P1); AT-Grenze aus sys_1/2 wird NICHT separat gespeichert (kein Nutzer im Code). | S · F+ |
| AT | VERB. | `authorityRequirementConditions` („EXCLUDED/…/MTOM_G_MAX=249“) nicht angezeigt. | als Infotext, nicht als Freigabe. | S · F |
| AT/EE/LT/SE | VERB. | Kein ETag/If-None-Match. | ETag-Sync. | S · G |
| PL | ✅ ERLEDIGT (FEHLT) | KML (1.774) statt JSON `/v1/zones` (3.170: + TRA 374, RPA 316, MRT 151, TSA, TMA, CTR/ATZ/MCTR, RMZ, P/R/D). Drohnenrelevant: RPA-Ampel (`etc.status`/`custom_color`, Unterzonen `etc.master`), bodennahe P/R/D, MRT. Kreise `etc.primitive`. | Auf `/v1/zones` + `/v1/zones/types` umstellen; Ausgrauen per Höhe (nicht Typname); zeitgesteuerte Typen (TRA/TSA/MRT) nicht pauschal dauerhaft. **Umgesetzt:** `fetchPoland` lädt JSON (`/v1/zones` + `/v1/zones/types`, Login unverändert, beide Header), KML bleibt Rückfall (`loadPoland`, `client/lib/geozoneDirect/polandSource.ts`); Normalisierer `normalizePansaZonesJson` (`shared/polishGeozones.ts`): Beschränkung per `PL_TYPE_TABLE` (MTMA/MATZ wie TMA/ATZ, sonst Kategorie aus `/v1/zones/types`, sonst vorsorglich Genehmigung), RPA-Ampel/Farbe als Text + `plRpaStatus`/`plRpaColor` (Beschränkung bleibt RPA → Genehmigung, Doku nennt keine Zuordnung), Unterzonen `etc.master` → „Teil von …“, Kreise aus `etc.primitive` (geozoneKit `wktCircleRing`), `start`/`stop` → Gültigkeit, nur FIS verworfen (alles andere bleibt, Ausgrauen per Höhe). Zonen/Typen 6 h im Speicher (Doku: 1×/Tag). Fixture **handgebaut** aus den dokumentierten Feldern (`docs/fixtures/pansa_zones_json_handbuilt.json`) – echte Antwort (F+) mit `pansa_geozones.py --dump-dir` von EU-IP nachliefern. | M · F+ |
| PL | ✅ ERLEDIGT (FEHLT) | Aktivierungen `/v1/activ/timeslices`, `/activations`, `/v1/notams` (Join über Zonenname, `acts.H24`). Laut Doku §9.3 erst nach schriftlicher PANSA-Freigabe – **Freigabe vom PO bestätigt (2026-11-15)**. | **Umgesetzt:** zeitgesteuerte Typen (`PL_TIME_CONTROLLED_TYPES` TRA/TSA/TS/TR/MRT/EA, ohne `acts.H24`) erhalten applicability-Fenster aus Timeslices/AUP/UUP/NOTAM (Join über `name`); nach dem Abdeckungshorizont (spätestes Fensterende, max. 36 h nach Abruf) wieder vorsorglich aktiv; ohne Aktivierungsdaten (Abruf fehlgeschlagen) aktiv + Hinweis „Aktivierung prüfen (AUP)“. Andere Typen bleiben dauerhaft, Fenster nur als Text. NOTAMs ohne Zone mit eigener Geometrie → temporäre Zone (`isNotam`), ohne Geometrie nur gezählt. Aktivierungen/NOTAMs bei jedem Abruf neu (ED-269-Takt: 6 h, Prüfung 10 min). Feldnamen von NOTAM-Text/-Geometrie nicht dokumentiert → tolerant gelesen, live prüfen. | M · F+ |
| PL | prüfen (entschieden) | Höhenbezug `/v1/zones` laut Doku ft AMSL, Plausibilität spricht eher für AGL. | **Entscheidung (JSON-Weg):** Untergrenze > 0 als MSL laut Doku – in beiden Lesarten vorsichtig (MSL → AGL zieht die höchste Geländehöhe ab; wäre der Wert AGL, wird nur weniger ausgegraut, nie fälschlich; ohne Gelände nie ausgeblendet). Obergrenze ohne Bezug (UNKNOWN), weil eine MSL-Obergrenze unter dem Gelände ausblenden würde. KML-Weg unverändert UNKNOWN. Weiter gegen `/v1/zones/filtered?max_height=` prüfen. | S · G |
| MT | ✅ ERLEDIGT (FEHLT) | Online per DDP `Zones.getFilteredZones({managedZones:true})` über WebSocket (`wss://tmcad.idronect.com/websocket`); auf dem Gerät machbar; Headless/US bekam „no access“ → nur Gerätetest. | DDP-Client, Import bleibt Rückfall. **Umgesetzt:** `client/lib/geozoneDirect/maltaSource.ts` (connect → method id "1" → Ping/Pong → result, Zeitlimit 45 s, Origin-Header `https://tmcad.idronect.com` als RN-WebSocket-3. Argument), Ergebnis (flightArea + Felder) durch `normalizeMalteseImport(…, { origin: "online" })`. Registry MT: Vektor-Quelle (`ed269-store`, kein Import-Gate, `temporary: "none"`, Vollland-Laden), Import bleibt Rückfall (Hinweis in den Offline-Einstellungen). Test mit nachgespielter DDP-Sitzung aus `mt_zones_sample.geojson`. **Nur Gerätetest:** ob der DDP-Aufruf aus der App (EU) Zonen liefert. | M · F / G |
| MT | ✅ ERLEDIGT (BUG/FEHLT) | `maxHeight` ist die Luftraumdecke (ft), der Code nimmt sie als Obergrenze (`shared/malteseGeozones.ts` upperMeters = maxH) → Zone künstlich begrenzt. `auto_limit_m` nur bei den 9 LUQA-Zonen; sonst flächig nach `forbidden`. Normalisiertes Übergabe-Schema (`_raw`) wird nicht erkannt. | Nicht-LUQA: Obergrenze weglassen (unbegrenzt), `maxHeight` nur als Info „Luftraumdecke X ft“; LUQA: Hinweis „Auto-Freigabe bis X m AGL“, Zone bleibt REQ_AUTHORISATION; Schema-Variante ergänzen. **Umgesetzt:** keine Obergrenze mehr (unbegrenzt), Info „Luftraumdecke X ft“ (`airspaceCeilingFt`); LUQA „Auto Authorised maximum XX m AGL“ → `auto_limit_m` + Hinweis „Auto-Freigabe bis XX m AGL“, bleibt REQ_AUTHORISATION, kein `maxFlightHeightAglM`; `maltaImportVariant` erkennt „handover“ (label/kontakt_email/auto_limit_m/_raw). Höhenwerte vor Festverdrahtung weiter gegen die Malta-AIP prüfen. | S · F |
| GB | ✅ ERLEDIGT (FEHLT) | AIXM 5.1 (NATS, 1.069) statt Google-KML (Bögen vereinfacht → Lücken FRZ/RPZ). | AIRAC-Dateiname, SHA-256, Parser mit ArcByCenterPoint/CircleByCenterPoint-Verdichtung, `gml:pos` lat/lon tauschen, FRZ+RPZ gruppieren; KML Rückfall. **Umgesetzt:** `shared/geozoneKit/aixm.ts` (streamend: fflate-Unzip → SHA-256 `shared/sha256.ts` gegen die `.sha256` im ZIP → hasMember-Blöcke mit Pausen), Normalisierung `normalizeUkAixmWithStats` (shared/ukGeozones.ts), Abruf `client/lib/geozoneDirect/ukSource.ts` (laufender AIRAC-Zyklus ≤ heute, sonst Vorgänger; If-Modified-Since → 304; jeder Fehler → KML). **Doku-Korrektur:** Bogenwinkel sind Peilungen (ab Nord, im Uhrzeigersinn), Richtung = Vorzeichen end−start; Radien auf WGS84 (Vincenty). Geprüft gegen das NATS-KML: alle 1.069 Flächen ±1,2 %, 6 Küstenlinien-Zonen (GeoBorder-Verweise) aufgelöst. Echte Fixture `gb-nats-aixm-sample.xml` (11 Gebiete + 1 GeoBorder). FRZ+RPZ: gemeinsamer Stamm (`ukGroup`, 138 Gruppen), Geometrien getrennt. | L · F |
| SI | BUG/Robustheit | Dienste fest verdrahtet; CAA tauscht Dienste → Abruf bricht. | Layer zur Laufzeit aus Web-Map `14c35a6c…/data` lesen. | M · F+ |
| SK | FEHLT | Live-Reservierungen `Hosted/Reservation_(Public)2/FeatureServer/0` (Join airspace↔IDENT_TXT) → R/TRA nur aktiv, wenn gebucht. Name `(Public)` vs `(Public)2` prüfen. | | M · F+ |
| DK | FEHLT? | NOTAMs (`active/awareness/disabled_notams`) und 186 Anflugkorridore (`Ind__og_udflyvningsplaner/188`); prüfen, ob im Export enthalten. | | M · F+ |
| NO | FEHLT? | `/data/`: `luftrom_ctr_tiz`, `obs_fareomrader`, `obs_sanntid_fareomrader` (live), `forbud_notam`, `notam_status.json`. | mit ED-269 abgleichen, fehlende Ebenen ergänzen | M · F+ |
| IS | mögl. BUG | App: `dronemap_isl_geom` (271); Webseite: `gis.natt.is` `dronemap_ice_geom` (171, UGZ-…). | beide tolerieren, Layer der Webseite bevorzugen | S · G |
| SE | prüfen | Zweite URL `daim.lfv.se/echarts/dronechart/data/uas_zones_ED318.json` als Rückfall. | | S · G |
| LV | ok | drz.lv (offizieller ED-269) behalten; Referer-Proxy nicht verwenden. Veralteter Kommentar zu SR/SS. | | S · F |
| CZ | ok | ED-318 bleibt; AES-Weg nicht verwenden. | | – |

## P3 – klein

- LU: Reihenfolge umdrehen (OGC zuerst, defekter ED-269-Feed nur noch selten).
- IE: CONDITIONAL-Ausnahmezonen (Modellflug) Hinweistext.
- PT: native ED-318-Variante optional.
- ES: NOTAM-Filter `itemB`/`itemC`; Dienstnamen dynamisch aus Web-Map.
- RO: Höhenschichten RZ 1001/1002 und RZ-2xxx-Aktivierung per NOTAM prüfen.

## Lizenzen / Freigaben (Datenquellen-Seite)

| Land | Doku | Registry | Handlung |
|---|---|---|---|
| EE | nur mündlich | mündlich, schriftliche Bestätigung ausstehend (`writtenPermission: false`) | ✅ korrigiert; schriftliche Bestätigung beschaffen |
| IT | „nur persönlicher Gebrauch“ | schriftlich – **vom PO bestätigt (2026-11-15)** für: jeder Nutzer mit eigenem d-flight-Konto zum persönlichen Gebrauch, keine Weitergabe der Daten | ✅ Text in Registry/Datenquellen; Beleg im Repo ablegen |
| GR | CC BY-NC-ND 4.0 | – | zurückgestellt |
| MT | automatischer Abruf erst nach TMCAD-Freigabe; Kontakt-E-Mails | Freigabe laut PO (Doku-Kopf); Lizenztext „automatisierter Abruf laut Freigabe von Transport Malta (vom PO bestätigt)“; Hinweis: Kontakt-E-Mails werden dem Piloten für Genehmigungsanfragen angezeigt | ✅ Registry/Datenquellen angepasst; Datenschutzerklärung (`shared/privacyPolicy.ts`) **nicht** geändert – Rechtstext, PO/Recht entscheiden |
| LT | Lizenz nicht angegeben | schriftlich | Beleg ablegen |
| PL | dynamische Endpunkte nur mit schriftlicher Freigabe | schriftlich – **vom PO bestätigt (2026-11-15)** für: statische Zonen über `/v1/zones` und KML, Zonentypen, Aktivierungen/NOTAM-Endpunkte wie dokumentiert | ✅ Lizenztext angepasst; Code nutzt jetzt /v1/zones, /v1/zones/types, Aktivierungen und NOTAMs (KML Rückfall) |
| GB | NATS-Bedingungen für AIXM | Registry: „© NATS – For aviation use only, Access/Usage Unrestricted, Not for resale“ (Metadaten des Datensatzes) | ✅ Text übernommen; NATS-AGB der Webseite und Weitergabe (kommerziell) noch gegen die UK-Vereinbarung prüfen |
| IE | Freigabe evtl. nur alter Weg; NPWS eigene Lizenz | schriftlich | bestätigen |
| NO | OSM-Anteile → ODbL-Vermerk | NLOD | ergänzen, falls `/data/` genutzt |
| ES | „© ENAIRE – AIS“ | „© ENAIRE“ | angleichen |
| SK | „VFR Manual, LPS SR, š. p.“ | – | ergänzen |
| SE | „LFV / Transportstyrelsen“ + Datenstand | CC BY 4.0 | Datenstand anzeigen |
| PT | ProCiv eigene Freigabe | – | nicht einbinden |

## Hosting-Falle (falls später statische Dateien)

`.github/workflows/android-apk.yml` löscht bei jedem Push den Release „latest“
samt Anhängen. Datendateien nie dort ablegen, sondern eigener Release-Tag
(z. B. `geodata`, `gh release upload geodata <datei> --clobber`).

## Server-Frage (Entscheidung PO: ohne Server)

Ohne Server nicht/eingeschränkt: GR-Vektor, SI Pozidano offline (beide
zurückgestellt). Alles andere läuft auf dem Gerät; ETag + WLAN-Regeln
genügen. Kein Server nötig: IT (eigener Login), MT (DDP), LV (drz.lv), CZ (ED-318).
