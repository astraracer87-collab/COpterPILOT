# Gap-Liste Geozonen: Doku (DE-Verifikation 15.11.2026) vs. App-Code

Stand: 2026-11-15. Abgleich aller Länder-Dokumente gegen die Implementierung
(nur gelesen). PO-Antworten zu den 8 Prüfpunkten als verifiziert übernommen.
Zurückgestellt (PO-Entscheidung): GR-Vektordatei, SI Pozidano.

Legende: **BUG** = Code widerspricht verifizierter Doku · **FEHLT** =
drohnenrelevante Daten ignoriert · **VERB.** = optional · Aufwand S/M/L ·
Test: F = Fixture im Repo, F+ = neue Fixture von EU-IP nötig, G = nur Gerät/EU-IP.

## P1 – zuerst

| Land | Typ | Befund | Fix | Aufwand / Test |
|---|---|---|---|---|
| LT | BUG | „Outside Lithuania“ (weltumspannendes PROHIBITED-Polygon) wird nicht gefiltert (`client/lib/geozoneDirect/ed269Sources.ts` fetchLithuania; `client/lib/ed269.ts` filtert nur `hidden`). Bbox-Abfrage zieht es in jede LT-Abfrage → Nachbarländer an der Grenze fälschlich rot. | Verwerfen bei `name === "Outside Lithuania"`; allgemein PROHIBITED-Polygone mit Welt-Bbox (>90° Länge) bei Frequentis-Ländern verwerfen. | S · F (+ G für Live-Namen) |
| IT | BUG | Code lädt nur den ED-269-Download – für normale Konten 401. Fehlermeldung beschuldigt fälschlich die Zugangsdaten. Normalisierer/Fixture nur ED-269 (handgebaut). | WFS `https://www.d-flight.it/maps/wms?service=WFS&version=2.0.0&request=GetFeature&typeNames=D-FLIGHT:ATM09_INFO&outputFormat=application/json&srsName=EPSG:4326`, Paging count/startIndex, 3.876 Zonen, Felder `lower_limit_m`/`upper_limit_m`, `rule`/`regola`/`type`/`subtype`/`valid_from`/`valid_to`; ED-269 nur optional für Operator-Rollen, bei 401 ohne Fehlermeldung auf WFS. Falle: bbox EPSG:4326 = minLat,minLon. Offen: CSRF-Header für /maps/wms? Password-Grant erlaubt? sonst In-App-Login (Auth-Code+PKCE). | M (L mit Auth-Code) · F+ / G |
| IT | FEHLT | Layer `NO_FLY_ZONE` (16.134 temporäre Verbotszonen, `viewparams=start_nfz:<jetzt>;end_nfz:9999-12-31T00:00;`), `NOTAM` (18), optional CTR/ATZ/P/R/D/AREE_MILITARI/PARCHI/PROTECT_NATURE. | mit demselben Token per WFS | M · F+ |
| GR | BUG | Import liest die Worker-Ausgabe nicht: Höhen `lower_ft_agl`/`upper_ft_agl`/`*_ft_msl` (Worker) vs. `alt_agl_*_ft` (App); Luftraum-Ebenen `hellas_TMA/ATZ/r/p/c/d` fallen heraus. | beide Feldnamen-Varianten, Hellas-Ebenen mappen (P→PROHIBITED, R→RESTRICTED, D→CONDITIONAL …). (GR selbst zurückgestellt; Import-Fix ist klein.) | S · F |
| EE | BUG (Lizenz) | Registry: „schriftlich bestätigt“; Doku: nur mündlich. | Text korrigieren oder Bestätigung beschaffen. | S |

## P2 – fehlende Daten, Robustheit

| Land | Typ | Befund | Fix | Aufwand / Test |
|---|---|---|---|---|
| AT (EE, LT) | VERB. | `sys_*`/`hidden` erst nach der Nähe-Begrenzung gefiltert → Welt-/Landes-Bbox kann echte Zonen aus der 1200er-Liste verdrängen; belegt Speicher. | `hidden` schon beim Abruf verwerfen; AT-Grenze aus sys_1/2 optional für Ländererkennung. | S · F+ |
| AT | VERB. | `authorityRequirementConditions` („EXCLUDED/…/MTOM_G_MAX=249“) nicht angezeigt. | als Infotext, nicht als Freigabe. | S · F |
| AT/EE/LT/SE | VERB. | Kein ETag/If-None-Match. | ETag-Sync. | S · G |
| PL | FEHLT | KML (1.774) statt JSON `/v1/zones` (3.170: + TRA 374, RPA 316, MRT 151, TSA, TMA, CTR/ATZ/MCTR, RMZ, P/R/D). Drohnenrelevant: RPA-Ampel (`etc.status`/`custom_color`, Unterzonen `etc.master`), bodennahe P/R/D, MRT. Kreise `etc.primitive`. | Auf `/v1/zones` + `/v1/zones/types` umstellen; Ausgrauen per Höhe (nicht Typname); zeitgesteuerte Typen (TRA/TSA/MRT) nicht pauschal dauerhaft. | M · F+ |
| PL | FEHLT | Aktivierungen `/v1/activ/timeslices`, `/activations`, `/v1/notams` (Join über Zonenname, `acts.H24`). Laut Doku §9.3 erst nach schriftlicher PANSA-Freigabe. | nach Freigabe | M · F+ |
| PL | prüfen | Höhenbezug `/v1/zones` laut Doku ft AMSL, Plausibilität spricht eher für AGL. Bis geklärt: „unbekannt“ (nie ausblenden). | gegen `/v1/zones/filtered?max_height=` prüfen | S · G |
| MT | FEHLT | Online per DDP `Zones.getFilteredZones({managedZones:true})` über WebSocket (`wss://tmcad.idronect.com/websocket`); auf dem Gerät machbar; Headless/US bekam „no access“ → nur Gerätetest. | DDP-Client, Import bleibt Rückfall. | M · F / G |
| MT | FEHLT | `auto_limit_m` aus Namenstext nur bei 9 LUQA-Zonen; sonst flächig nach `forbidden`. `maxHeight` = Luftraumdecke in ft (Beschriftung korrigieren). Normalisiertes Übergabe-Schema (`_raw`) wird nicht erkannt. | Parser + Beschriftung + Schema-Variante | S · F |
| GB | FEHLT | AIXM 5.1 (NATS, 1.069) statt Google-KML (Bögen vereinfacht → Lücken FRZ/RPZ). | AIRAC-Dateiname, SHA-256, Parser mit ArcByCenterPoint/CircleByCenterPoint-Verdichtung, `gml:pos` lat/lon tauschen, FRZ+RPZ gruppieren; KML Rückfall. | L · F+ |
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
| EE | nur mündlich | schriftlich | korrigieren |
| IT | „nur persönlicher Gebrauch“; Einbindungsfreigabe offen | schriftlich | klären; Modell „eigener Login je Nutzer“ dokumentieren |
| GR | CC BY-NC-ND 4.0 | – | zurückgestellt |
| MT | automatischer Abruf erst nach TMCAD-Freigabe; Kontakt-E-Mails | Import | bei Online-Umstellung Freigabe + Datenschutzhinweis |
| LT | Lizenz nicht angegeben | schriftlich | Beleg ablegen |
| PL | dynamische Endpunkte nur mit schriftlicher Freigabe | schriftlich | Umfang prüfen vor `/v1/zones`/`/v1/activ` |
| GB | NATS-Bedingungen für AIXM | NATS/CAA | bei Umstieg prüfen |
| IE | Freigabe evtl. nur alter Weg; NPWS eigene Lizenz | schriftlich | bestätigen |
| NO | OSM-Anteile → ODbL-Vermerk | NLOD | ergänzen, falls `/data/` genutzt |
| ES | „© ENAIRE – AIS“ | „© ENAIRE“ | angleichen |
| SK | „VFR Manual, LPS SR, š. p.“ | – | ergänzen |
| SE | „LFV / Transportstyrelsen“ + Datenstand | CC BY 4.0 | Datenstand anzeigen |
| PT | ProCiv eigene Freigabe | – | nicht einbinden |

## Server-Frage (Entscheidung PO: ohne Server)

Ohne Server nicht/eingeschränkt: GR-Vektor, SI Pozidano offline (beide
zurückgestellt). Alles andere läuft auf dem Gerät; ETag + WLAN-Regeln
genügen. Kein Server nötig: IT (eigener Login), MT (DDP), LV (drz.lv), CZ (ED-318).
